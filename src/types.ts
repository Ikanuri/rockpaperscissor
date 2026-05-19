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
}

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

export interface Env {
  GAME_SESSIONS: KVNamespace;
  BOT_TOKEN: string;
  BOT_USERNAME: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  is_bot: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  inline_query?: InlineQuery;
  chosen_inline_result?: ChosenInlineResult;
  callback_query?: CallbackQuery;
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
  data?: string;
  chat_instance: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
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
