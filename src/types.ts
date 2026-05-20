export type Choice = 'rock' | 'paper' | 'scissors';
export type GameMode = 'single' | 'best_of_3';
export type GameStatus = 'waiting' | 'playing' | 'done';
export type DonatorTier = 'free' | 'basic' | 'premium';

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
}

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

export interface DonatorRecord {
  tier: DonatorTier;
  expiry: number;
  method: 'stars' | 'stripe' | 'manual';
}

export interface LeaderboardEntry {
  userId: number;
  name: string;
  wins: number;
  total: number;
}

export interface ThumbConfig {
  type: 'url' | 'gif' | 'sticker';
  value: string;
}

export interface GameConfig {
  countdown: Record<'1' | '2' | '3', string>;
  reveal: Record<Choice, string>;
  article: Record<Choice, string>;
  sticker: Record<Choice, string | null>;
  thumb: Record<Choice, ThumbConfig | null>;
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
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FEATURE_FLAGS?: string;
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
  successful_payment?: SuccessfulPayment;
}

export interface TelegramUpdate {
  update_id: number;
  inline_query?: InlineQuery;
  chosen_inline_result?: ChosenInlineResult;
  callback_query?: CallbackQuery;
  message?: TelegramMessage;
  pre_checkout_query?: PreCheckoutQuery;
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

export interface PreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface RematchMeta {
  hostUserId: number;
  hostName: string;
  opponentUserId: number;
  opponentName: string;
  mode: GameMode;
  hostInlineMessageId: string;
  opponentInlineMessageId: string;
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

export interface InlineQueryResultCachedGif {
  type: 'gif';
  id: string;
  gif_file_id: string;
  title?: string;
  input_message_content: {
    message_text: string;
    parse_mode?: string;
  };
  reply_markup?: InlineKeyboardMarkup;
}

export type InlineResult =
  | InlineQueryResultArticle
  | InlineQueryResultCachedSticker
  | InlineQueryResultCachedGif;
