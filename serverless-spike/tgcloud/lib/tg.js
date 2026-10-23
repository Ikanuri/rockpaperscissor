// Telegram helpers for the game slice: rich/classic inline edits with the custom-emoji rule.
import { api } from 'sdk';

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// InlineKeyboardMarkup -> <tg-button-row> html (same mapping as the Cloudflare bot's telegram.ts).
export function kbToRichHtml(kb) {
  return kb.inline_keyboard.map((row) => {
    const buttons = row.map((btn) => {
      const attrs = [];
      if (btn.style) attrs.push(`style="${escAttr(btn.style)}"`);
      if (btn.callback_data) attrs.push(`type="callback_data" data="${escAttr(btn.callback_data)}"`);
      else if (btn.url) attrs.push(`type="url" url="${escAttr(btn.url)}"`);
      else if (btn.switch_inline_query_current_chat !== undefined) {
        attrs.push(`type="switch_inline_query_current_chat" query="${escAttr(btn.switch_inline_query_current_chat)}"`);
      }
      return `<tg-button ${attrs.join(' ')}>${escHtml(btn.text)}</tg-button>`;
    }).join('');
    return `<tg-button-row>${buttons}</tg-button-row>`;
  }).join('');
}

// Classic HTML has no <hr>.
export function stripHr(html) {
  return html.replace(/<hr\s*\/?>/g, '\n──────────');
}

function benign(e) {
  return e && e.code === 400 && /not modified/i.test(e.description || '');
}

export async function editInlineClassic(inlineMessageId, html, markup) {
  try {
    await api.editMessageText({
      inline_message_id: inlineMessageId,
      text: stripHr(html),
      parse_mode: 'HTML',
      ...(markup ? { reply_markup: markup } : {}),
    });
  } catch (e) {
    if (!benign(e)) console.error('editInlineClassic failed: ' + String((e && e.description) || e));
  }
}

// Inline messages: rich_message shows a custom emoji only as its fallback glyph there (verified),
// so anything containing <tg-emoji> goes classic; everything else may use rich.
export async function editInline(inlineMessageId, html, markup) {
  if (!html.includes('<tg-emoji')) {
    try {
      await api.editMessageText({
        inline_message_id: inlineMessageId,
        rich_message: { html: html + (markup ? kbToRichHtml(markup) : '') },
      });
      return;
    } catch (e) {
      if (benign(e)) return;
      console.error('rich edit failed, falling back to classic: ' + String((e && e.description) || e));
    }
  }
  await editInlineClassic(inlineMessageId, html, markup);
}
