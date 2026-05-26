export type Choice = 'rock' | 'paper' | 'scissors';
export type GameMode = 'single' | 'best_of_3' | 'best_of_5' | 'best_of_7';
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
  ranked?: boolean;
  tournamentId?: string;
  tournamentMatchId?: string;
  isOpen?: boolean;
  hostBadge?: string;
  opponentBadge?: string;
}

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  choices?: { rock: number; paper: number; scissors: number };

  // Overall streak
  currentStreak?: number;
  longestStreak?: number;
  longestStreakOpponent?: string;

  // Day period (index = days since RELEASE_DATE)
  dayIndex?: number;
  dayWins?: number;
  dayLosses?: number;
  dayDraws?: number;
  dayStreak?: number;
  longestDayStreak?: number;

  // Week period (index = weeks since RELEASE_DATE)
  weekIndex?: number;
  weekWins?: number;
  weekLosses?: number;
  weekDraws?: number;
  weekStreak?: number;
  longestWeekStreak?: number;

  // Month period (index = months since RELEASE_DATE)
  monthIndex?: number;
  monthWins?: number;
  monthLosses?: number;
  monthDraws?: number;
  monthStreak?: number;
  longestMonthStreak?: number;

  // Best single-opponent streak ever
  longestVsStreak?: number;
  longestVsOpponentId?: number;
  longestVsOpponentName?: string;

  // ELO rating — only set/updated for ranked games
  rating?: number;
  achievements?: Record<string, number>;
  shieldUsedDayIndex?: number;
  lastNotifiedStreak?: number;
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
  ranked?: boolean;
}

export interface VsStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  currentStreak?: number;
  longestStreak?: number;
}

export interface LastGameRecord {
  opponentId: number;
  opponentName: string;
  myChoice: Choice;
  opponentChoice: Choice;
  outcome: 'win' | 'loss' | 'draw';
  ranked: boolean;
  at: number;
}

export interface OpenChallenge {
  gameId: string;
  hostName: string;
  hostUserId: number;
  createdAt: number;
}

export interface LmsPlayer {
  userId: number;
  name: string;
  choice: Choice | null;
  inlineMessageId: string;
  active: boolean;
}

export interface LmsRoundRecord {
  choices: Array<{ userId: number; choice: Choice }>;
  eliminated: number[];
  isChaos: boolean;
}

export interface LmsSession {
  gameId: string;
  hostUserId: number;
  maxPlayers: number;
  players: LmsPlayer[];
  status: 'waiting' | 'playing' | 'done';
  currentRound: number;
  roundHistory: LmsRoundRecord[];
  createdAt: number;
}

export interface TeamPlayer {
  userId: number;
  name: string;
  choice: Choice | null;
  inlineMessageId: string;
}

export interface TeamSession {
  gameId: string;       // T + 6 chars
  chatId: number;       // group chat for dice tiebreaker
  teamSize: number;     // players per team
  teamA: TeamPlayer[];
  teamB: TeamPlayer[];
  status: 'waiting' | 'playing' | 'done';
  currentRound: number;
  scoreA: number;
  scoreB: number;
  mode: GameMode;
  hostUserId: number;
  createdAt: number;
}

export interface TournamentPlayer {
  userId: number;
  name: string;
}

export interface TournamentMatch {
  matchId: string;
  p1: TournamentPlayer;
  p2: TournamentPlayer;
  winner: TournamentPlayer | null;
  gameCode: string | null;
}

export interface TournamentSession {
  tournamentId: string;
  chatId: number;
  hostUserId: number;
  players: TournamentPlayer[];
  maxPlayers: number;
  status: 'joining' | 'active' | 'done';
  currentRound: number;
  rounds: TournamentMatch[][];
  winner: TournamentPlayer | null;
  signupMessageId: number | null;
  createdAt: number;
}

export interface TeamDiceWaitState {
  gameId: string;
  chatId: number;
  teamSession: TeamSession;
  tieA: Array<{ userId: number; name: string; choice: Choice }> | null;
  tieB: Array<{ userId: number; name: string; choice: Choice }> | null;
  rollsA: Array<{ userId: number; roll: number }>;
  rollsB: Array<{ userId: number; roll: number }>;
  resolvedA: { choice: Choice; notes: string[] } | null;
  resolvedB: { choice: Choice; notes: string[] } | null;
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
  FEATURE_FLAGS: string;
  WEBHOOK_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
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
  chat: { id: number; type: string; title?: string; username?: string };
  text?: string;
  sticker?: { file_id: string; file_unique_id: string; type?: string; custom_emoji_id?: string; is_video?: boolean; is_animated?: boolean };
  animation?: { file_id: string; file_unique_id: string };
  entities?: Array<{ type: string; offset: number; length: number; custom_emoji_id?: string }>;
  successful_payment?: SuccessfulPayment;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  dice?: { emoji: string; value: number };
  via_bot?: TelegramUser;
  reply_markup?: {
    inline_keyboard: Array<Array<{
      text: string;
      callback_data?: string;
      url?: string;
      switch_inline_query_current_chat?: string;
    }>>;
  };
}

export type PendingAction =
  | 'setsticker'
  | 'setemoji_reveal'
  | 'setthumb_gif'
  | 'setthumb_sticker'
  | 'setglobal_sticker'
  | 'setglobal_emoji_reveal'
  | 'setglobal_thumb_gif'
  | 'setglobal_thumb_sticker';

export interface PendingConfig {
  action: PendingAction;
  choice: Choice;
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

export interface InlineQueryResultCachedGif {
  type: 'gif';
  id: string;
  gif_file_id: string;
  title?: string;
  caption?: string;
  reply_markup?: InlineKeyboardMarkup;
  input_message_content?: {
    message_text: string;
    parse_mode?: string;
  };
}

export type InlineResult = InlineQueryResultArticle | InlineQueryResultCachedSticker | InlineQueryResultCachedGif;

export interface LeaderboardEntry {
  userId: number;
  name: string;
  wins: number;
  total: number;
}

export type ThumbType = 'url' | 'gif' | 'sticker';

export interface ThumbConfig {
  type: ThumbType;
  value: string;
}

export interface GameConfig {
  reveal: Record<Choice, string>;
  sticker: Partial<Record<Choice, string>>;
  thumb: Partial<Record<Choice, ThumbConfig>>;
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
}
