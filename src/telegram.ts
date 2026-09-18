import type { InlineKeyboardMarkup, InlineResult } from './types';

const API = 'https://api.telegram.org/bot';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function call(
  token: string,
  method: string,
  body: Record<string, unknown>,
  maxRetryWait = 10_000
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const data = await res.json<{ parameters?: { retry_after?: number } }>();
      const wait = Math.min((data.parameters?.retry_after ?? 5) * 1000, maxRetryWait);
      if (wait <= 0) return;
      await sleep(wait);
      continue;
    }
    if (!res.ok) console.error(`[tg:${method}]`, await res.text());
    return;
  }
}

export function answerInlineQuery(
  token: string,
  queryId: string,
  results: InlineResult[]
): Promise<void> {
  return call(token, 'answerInlineQuery', {
    inline_query_id: queryId,
    results,
    cache_time: 0,
  });
}

export function answerCallbackQuery(
  token: string,
  callbackId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  return call(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text && { text }),
    show_alert: showAlert,
  });
}

export function editInlineMessage(
  token: string,
  inlineMessageId: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  maxRetryWait?: number
): Promise<void> {
  return call(token, 'editMessageText', {
    inline_message_id: inlineMessageId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  }, maxRetryWait);
}

interface RichMessageButton {
  text: string;
  style?: 'primary' | 'success' | 'danger';
  callback_data?: string;
  url?: string;
  switch_inline_query_current_chat?: string;
}

type RichText =
  | string
  | RichText[]
  | { type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code'; text: RichText }
  | { type: 'url'; text: RichText; url: string }
  | { type: 'custom_emoji'; custom_emoji_id: string; alternative_text: string };

type RichBlock =
  | { type: 'paragraph'; text: RichText }
  | { type: 'expandable_blockquote'; text: RichText }
  | { type: 'blockquote'; blocks: RichBlock[] }
  | { type: 'pre'; text: RichText; language?: string }
  | { type: 'divider' }
  | { type: 'buttons'; buttons: RichMessageButton[] };

// escHtml() only ever escapes &, <, > — reverse exactly that (nothing more) for plain-text leaves.
function unescapeBasicHtml(s: string): string {
  return s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

// Generic parser for classic-HTML-mode content, matching exactly the tag set Telegram's own
// parse_mode: 'HTML' supports (see entitiesToHtml() in message.ts, which is the only producer of
// this markup — owner-authored footer text converted from their native Telegram formatting, plus
// the bot's own hardcoded <b>/<tg-emoji>/<blockquote> strings). Handles arbitrary nesting (e.g.
// <b>bold <i>and italic</i></b>), unlike a single-pattern regex scan.
interface TextNode { kind: 'text'; text: string }
interface TagNode { kind: 'tag'; tag: string; attrs: Record<string, string | true>; children: ParsedNode[] }
type ParsedNode = TextNode | TagNode;

const TAG_RE = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)(?:="([^"]*)")?/g;

function parseNodes(html: string): ParsedNode[] {
  const root: ParsedNode[] = [];
  const stack: ParsedNode[][] = [root];
  let lastIndex = 0;
  for (const m of html.matchAll(TAG_RE)) {
    if (m.index! > lastIndex) stack[stack.length - 1].push({ kind: 'text', text: html.slice(lastIndex, m.index) });
    const [, closeTag, openTag, attrStr] = m;
    if (closeTag) {
      if (stack.length > 1) stack.pop();
    } else if (openTag) {
      const attrs: Record<string, string | true> = {};
      for (const am of (attrStr ?? '').matchAll(ATTR_RE)) attrs[am[1]] = am[2] !== undefined ? am[2] : true;
      const node: TagNode = { kind: 'tag', tag: openTag.toLowerCase(), attrs, children: [] };
      stack[stack.length - 1].push(node);
      // hr is a void element (no closing tag, e.g. <hr> or <hr/>) — never wait for </hr>
      if (node.tag !== 'hr') stack.push(node.children);
    }
    lastIndex = m.index! + m[0].length;
  }
  if (lastIndex < html.length) stack[stack.length - 1].push({ kind: 'text', text: html.slice(lastIndex) });
  return root;
}

function nodesToRichText(nodes: ParsedNode[]): RichText {
  const parts = nodes.map(nodeToRichText).filter(p => !(typeof p === 'string' && p === ''));
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : parts;
}

function nodeToRichText(node: ParsedNode): RichText {
  if (node.kind === 'text') return unescapeBasicHtml(node.text);
  switch (node.tag) {
    case 'b': case 'strong': return { type: 'bold', text: nodesToRichText(node.children) };
    case 'i': case 'em': return { type: 'italic', text: nodesToRichText(node.children) };
    case 'u': case 'ins': return { type: 'underline', text: nodesToRichText(node.children) };
    case 's': case 'strike': case 'del': return { type: 'strikethrough', text: nodesToRichText(node.children) };
    case 'tg-spoiler': return { type: 'spoiler', text: nodesToRichText(node.children) };
    case 'code': return { type: 'code', text: nodesToRichText(node.children) };
    case 'a': {
      const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
      return href ? { type: 'url', text: nodesToRichText(node.children), url: href } : nodesToRichText(node.children);
    }
    case 'tg-emoji': {
      const id = typeof node.attrs['emoji-id'] === 'string' ? node.attrs['emoji-id'] : '';
      const alt = node.children.map(c => c.kind === 'text' ? unescapeBasicHtml(c.text) : '').join('');
      return id ? { type: 'custom_emoji', custom_emoji_id: id, alternative_text: alt } : alt;
    }
    default: return nodesToRichText(node.children);
  }
}

function nodesToBlocks(nodes: ParsedNode[]): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: ParsedNode[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: nodesToRichText(paragraph) });
      paragraph = [];
    }
  };

  for (const node of nodes) {
    if (node.kind === 'text') {
      const lines = node.text.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) flush();
        if (line) paragraph.push({ kind: 'text', text: line });
      });
    } else if (node.tag === 'blockquote') {
      flush();
      if (node.attrs.expandable) {
        blocks.push({ type: 'expandable_blockquote', text: nodesToRichText(node.children) });
      } else {
        blocks.push({ type: 'blockquote', blocks: nodesToBlocks(node.children) });
      }
    } else if (node.tag === 'pre') {
      flush();
      let content = node.children;
      let language: string | undefined;
      if (content.length === 1 && content[0].kind === 'tag' && content[0].tag === 'code') {
        const codeNode = content[0];
        const cls = typeof codeNode.attrs.class === 'string' ? codeNode.attrs.class : '';
        const langMatch = /language-(\S+)/.exec(cls);
        if (langMatch) language = langMatch[1];
        content = codeNode.children;
      }
      blocks.push({ type: 'pre', text: nodesToRichText(content), ...(language && { language }) });
    } else if (node.tag === 'hr') {
      flush();
      blocks.push({ type: 'divider' });
    } else {
      paragraph.push(node);
    }
  }
  flush();
  return blocks;
}

function htmlToBlocks(html: string): RichBlock[] {
  return nodesToBlocks(parseNodes(html));
}

// InlineKeyboardButton fields map 1:1 onto RichMessageButton (confirmed against the Bot API
// spec) — callback_data still fires a normal callback_query, so handleCallbackQuery needs no
// changes. One InputRichBlockButtons block == one button row.
function keyboardToButtonBlocks(kb: InlineKeyboardMarkup): RichBlock[] {
  return kb.inline_keyboard.map(row => ({
    type: 'buttons',
    buttons: row.map(btn => ({
      text: btn.text,
      ...(btn.style && { style: btn.style }),
      ...(btn.callback_data && { callback_data: btn.callback_data }),
      ...(btn.url && { url: btn.url }),
      ...(btn.switch_inline_query_current_chat !== undefined && { switch_inline_query_current_chat: btn.switch_inline_query_current_chat }),
    })),
  }));
}

// Bot API 10.1+ rich message rendering on inline messages, used bot-wide for every game mode.
// Text and buttons both render through InputRichMessage.blocks: text via the general recursive
// HTML parser above (parseNodes/nodesToRichText/nodesToBlocks — full classic-HTML-mode tag set,
// arbitrary nesting), buttons as InputRichBlockButtons (RichMessageButton fields map 1:1 onto
// InlineKeyboardButton, callback_data still fires a normal callback_query). Falls back to plain
// editInlineMessage (identical html + the original InlineKeyboardMarkup) if the API rejects
// rich_message for any reason, so an imperfect guess at formatting nuances never breaks the
// message or its buttons.
// Confirmed broken: donator custom emoji (<tg-emoji>) inside an INLINE message's rich_message
// renders as missing/blank for every viewer — including a viewer with real Telegram Premium
// looking at an opponent's already-set custom emoji, which rendered fine before this bot's Rich
// Message rollout. Regular chat messages (editMessageRich/sendMessageRich, chat_id + message_id
// or a fresh send) do NOT have this problem — confirmed working in PM. So only
// editInlineMessageRich skips straight to the classic path when custom emoji is present; the
// other two rich variants keep using rich_message even with <tg-emoji>. Root cause isn't fully
// understood (undocumented, not testable live from here) — this is an evidence-based workaround,
// not a real fix.
export async function editInlineMessageRich(
  token: string,
  inlineMessageId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'editMessageText', { inline_message_id: inlineMessageId }, html, replyMarkup,
    classicHtml => editInlineMessage(token, inlineMessageId, classicHtml, replyMarkup),
    /* skipRichForTgEmoji */ true);
}

// <hr> (InputRichBlockDivider) isn't a tag classic parse_mode: 'HTML' understands — Telegram
// rejects the whole message if it's present there. Needed whenever we fall back to the classic
// path, since a message can combine a footer's <hr> with content that forces the classic route.
function stripHrForClassic(html: string): string {
  return html.replace(/<hr\s*\/?>/g, '\n──────────');
}

// Shared by every rich-message variant: builds the blocks payload, posts it, and falls back to
// the caller's plain (non-rich) equivalent if the API rejects it for any reason.
async function richRequest(
  token: string,
  method: string,
  target: Record<string, unknown>,
  html: string,
  replyMarkup: InlineKeyboardMarkup | undefined,
  fallback: (classicHtml: string) => Promise<void>,
  skipRichForTgEmoji = false
): Promise<void> {
  if (skipRichForTgEmoji && html.includes('<tg-emoji')) {
    await fallback(stripHrForClassic(html));
    return;
  }
  const blocks = [...htmlToBlocks(html), ...(replyMarkup ? keyboardToButtonBlocks(replyMarkup) : [])];
  try {
    const res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, rich_message: { blocks } }),
    });
    const data = await res.json<{ ok: boolean; description?: string }>();
    if (res.ok && data.ok) return;
    console.error(`[tg:${method}Rich] rejected, falling back to plain text/buttons:`, JSON.stringify(data));
  } catch (e) {
    console.error(`[tg:${method}Rich] error, falling back to plain text/buttons:`, e);
  }
  await fallback(stripHrForClassic(html));
}

// Same rich-message rendering as editInlineMessageRich, but for a regular chat message
// (chat_id + message_id) instead of an inline message — used by /guide navigation, which edits
// a normal message the bot sent in a DM/group, not an inline result. Custom emoji is confirmed
// working here, so unlike editInlineMessageRich this never skips the rich attempt.
export async function editMessageRich(
  token: string,
  chatId: number,
  messageId: number,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'editMessageText', { chat_id: chatId, message_id: messageId }, html, replyMarkup,
    classicHtml => editMessage(token, chatId, messageId, classicHtml, replyMarkup));
}

// Sends a brand-new rich message (Bot API 10.3's sendRichMessage) instead of editing an existing
// one — used for the first-time display of content like /credits or /guide's main menu, where
// there's no prior message to edit yet. Custom emoji confirmed working here too.
export async function sendMessageRich(
  token: string,
  chatId: number,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await richRequest(token, 'sendRichMessage', { chat_id: chatId }, html, replyMarkup,
    classicHtml => sendMessage(token, chatId, classicHtml, replyMarkup));
}

export function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
}

// Bot API 10.2+ ephemeral messages: visible only to receiverUserId within the group chat.
export async function sendEphemeralMessage(
  token: string,
  chatId: number,
  receiverUserId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  try {
    const res = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ephemeral_message_parameters: { receiver_user_id: receiverUserId },
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:sendEphemeralMessage]', await res.text());
      return null;
    }
    const data = await res.json<{ ok: boolean; result?: { ephemeral_message_id?: number } }>();
    if (!data.ok) {
      console.error('[tg:sendEphemeralMessage] ok=false', JSON.stringify(data));
      return null;
    }
    return data.result?.ephemeral_message_id ?? null;
  } catch (e) {
    console.error('[tg:sendEphemeralMessage] error', e);
    return null;
  }
}

export async function editEphemeralMessageText(
  token: string,
  chatId: number,
  ephemeralMessageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<boolean> {
  try {
    const res = await fetch(`${API}${token}/editEphemeralMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ephemeral_message_id: ephemeralMessageId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:editEphemeralMessageText]', await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[tg:editEphemeralMessageText] error', e);
    return false;
  }
}

export function answerPreCheckoutQuery(
  token: string,
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  return call(token, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(errorMessage && { error_message: errorMessage }),
  });
}

export async function getChatInfo(
  token: string,
  chatId: number
): Promise<{ first_name?: string; username?: string } | null> {
  try {
    const res = await fetch(`${API}${token}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) return null;
    const data = await res.json<{ ok: boolean; result?: { first_name?: string; username?: string } }>();
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export function setMyCommands(
  token: string,
  commands: Array<{ command: string; description: string }>,
  scope: Record<string, unknown>,
  language_code?: string
): Promise<void> {
  return call(token, 'setMyCommands', { commands, scope, ...(language_code ? { language_code } : {}) });
}

export function sendInvoice(
  token: string,
  chatId: number,
  title: string,
  description: string,
  payload: string,
  currency: string,
  prices: Array<{ label: string; amount: number }>
): Promise<void> {
  return call(token, 'sendInvoice', {
    chat_id: chatId,
    title,
    description,
    payload,
    provider_token: '',
    currency,
    prices,
  });
}

export function sendChatAction(
  token: string,
  chatId: number,
  action: string
): Promise<void> {
  return call(token, 'sendChatAction', { chat_id: chatId, action });
}

export function sendPoll(
  token: string,
  chatId: number,
  question: string,
  options: string[],
  isAnonymous = true
): Promise<void> {
  return call(token, 'sendPoll', {
    chat_id: chatId,
    question,
    options,
    is_anonymous: isAnonymous,
  });
}

export async function sendDice(
  token: string,
  chatId: number,
  emoji = '🎲'
): Promise<number> {
  const res = await fetch(`${API}${token}/sendDice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, emoji }),
  });
  if (!res.ok) {
    console.error('[tg:sendDice]', await res.text());
    return 0;
  }
  const data = await res.json<{ result?: { dice?: { value?: number } } }>();
  return data.result?.dice?.value ?? 0;
}

export async function sendMessageForId(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  try {
    const res = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    if (!res.ok) {
      console.error('[tg:sendMessageForId]', await res.text());
      return null;
    }
    const data = await res.json<{ ok: boolean; result?: { message_id: number } }>();
    if (!data.ok) {
      console.error('[tg:sendMessageForId] ok=false', JSON.stringify(data));
      return null;
    }
    return data.result?.message_id ?? null;
  } catch {
    return null;
  }
}

export function editMessage(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  return call(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup && { reply_markup: replyMarkup }),
  });
}

export async function getChatMember(
  token: string,
  chatId: number,
  userId: number
): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${API}${token}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    if (!res.ok) return null;
    const data = await res.json<{ ok: boolean; result?: { status: string } }>();
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export function pinChatMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<void> {
  return call(token, 'pinChatMessage', {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: true,
  });
}

export function unpinChatMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<void> {
  return call(token, 'unpinChatMessage', { chat_id: chatId, message_id: messageId });
}
