export type Choice = 'rock' | 'paper' | 'scissors';
export type GameMode = 'single' | 'best_of_3';
export type GameStatus = 'waiting' | 'playing' | 'done';

export interface RoundRecord {
  hostChoice: Choice;
  opponentChoice: Choice;
}

export interface GameSession {
  gameId: string;
  hostUserId: number;
  hostName: string;
  hostChoice: Choice | null;
  opponentUserId: number | null;
  opponentName: string | null;
  opponentChoice: Choice | null;
  hostInlineMessageId: string;
  opponentInlineMessageId: string | null;
  status: GameStatus;
  mode: GameMode;
  currentRound: number;
  hostScore: number;
  opponentScore: number;
  rounds: RoundRecord[];
  createdAt: number;
  chainId?: string;
  lockedToUsername?: string;
}

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  choices?: { rock: number; paper: number; scissors: number };
}

export interface ChainEntry {
  hostUserId: number;
  hostName: string;
  opponentUserId: number;
  opponentName: string;
  hostChoice: Choice;
  opponentChoice: Choice;
  winner: 'host' | 'opponent' | 'draw';
}

export interface ChainMeta {
  hostUserId: number;
  opponentUserId: number;
  mode: GameMode;
}

export interface Env {
  GAME_SESSIONS: KVNamespace;
  BOT_TOKEN: string;
  BOT_USERNAME: string;
  BOT_OWNER_ID: string;
  STICKER_ROCK: string;
  STICKER_PAPER: string;
  STICKER_SCISSORS: string;
  CUSTOM_EMOJI_ROCK: string;
  CUSTOM_EMOJI_PAPER: string;
  CUSTOM_EMOJI_SCISSORS: string;
  WEBHOOK_SECRET?: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  is_bot: boolean;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  inline_query?: InlineQuery;
  chosen_inline_result?: ChosenInlineResult;
  callback_query?: CallbackQuery;
  message?: TelegramMessage;
}

export interface InlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset: string;
  chat_type?: string;
}

export interface ChosenInlineResult {
  result_id: string;
  from: TelegramUser;
  inline_message_id?: string;
  query: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  inline_message_id?: string;
  message?: TelegramMessage;
  data?: string;
  chat_instance: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  switch_inline_query_current_chat?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineQueryResultArticle {
  type: 'article';
  id: string;
  title: string;
  description?: string;
  input_message_content: {
    message_text: string;
    parse_mode?: string;
  };
  reply_markup?: InlineKeyboardMarkup;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

export interface InlineQueryResultCachedSticker {
  type: 'sticker';
  id: string;
  sticker_file_id: string;
  reply_markup?: InlineKeyboardMarkup;
  input_message_content?: {
    message_text: string;
    parse_mode?: string;
  };
}

export type InlineResult = InlineQueryResultArticle | InlineQueryResultCachedSticker;
