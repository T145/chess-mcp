export type Color = 'white' | 'black';
export type SeatKind = 'human' | 'llm' | 'open';
export type GamePhase =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'resigned'
  | 'timeout';
export type DrawAction = 'offer' | 'accept' | 'decline';
export type CreateGameColor = Color | 'random' | 'none';
export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'daily';

/** A time control as chosen when the game is created. */
export interface ClockConfig {
  category: TimeControlCategory;
  label: string;
  baseMs: number;
  incrementMs: number;
  /**
   * Ceiling for a player's remaining time. Daily games use it to model a
   * "N days per move" allowance instead of a growing bank.
   */
  bankCapMs?: number;
}

/** Live clock state: each colour's bank plus when the current turn started. */
export interface GameClock extends ClockConfig {
  whiteMs: number;
  blackMs: number;
  /** Colour whose clock is running. */
  turn: Color;
  /** Epoch ms when the side to move started thinking; null once the game ends. */
  turnStartedAt: number | null;
}


export interface PublicSeat {
  kind: SeatKind;
  name: string;
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  color: Color;
  promotion?: string;
  /**
   * Optional reasoning the mover attached to this move (empty for human moves).
   * It is private to the mover while the game is running: agents only receive
   * their own notes, and the web app receives none until the game is over.
   */
  note?: string;
}

export interface GameStatus {
  phase: GamePhase;
  winner: Color | null;
  reason: string;
}

export interface PublicGame {
  id: string;
  fen: string;
  turn: Color;
  inCheck: boolean;
  status: GameStatus;
  seats: Record<Color, PublicSeat>;
  moves: MoveRecord[];
  lastMove: MoveRecord | null;
  drawOffer: Color | null;
  legalMoves: string[];
  pgn: string;
  /** Null when the game was created without a clock. */
  clock: GameClock | null;
  createdAt: number;
  updatedAt: number;
}

export type WsServerMessage =
  | { type: 'hello'; serverTime: number }
  | { type: 'snapshot'; games: PublicGame[] }
  | { type: 'game'; game: PublicGame }
  | { type: 'deleted'; id: string };

export interface CreateGameRequest {
  name: string;
  color: CreateGameColor;
  /** Preset id such as "10+5", or omit/null for an untimed game. */
  timeControl?: string | null;
}

export interface JoinSeatRequest {
  name: string;
  seat: Color;
}

export type MoveInput =
  | string
  | {
      from: string;
      to: string;
      promotion?: 'q' | 'r' | 'b' | 'n';
    };

export interface MoveRequest {
  move: MoveInput;
  token?: string;
  /**
   * Optional reasoning for this move. It is saved with the move and readable by
   * the mover (not the opponent) until the game ends, when it joins the PGN.
   */
  note?: string;
}

export interface DrawRequest {
  action: DrawAction;
  token?: string;
  seat?: Color;
}

export interface ResignRequest {
  token?: string;
  seat?: Color;
}

export interface CreateGameResponse {
  game: PublicGame;
  seat: Color | null;
  token: string | null;
}

export interface JoinGameResponse {
  game: PublicGame;
  seat: Color;
  token: string;
}

export interface SwapSeatsRequest {
  token: string;
}

export interface SwapSeatsResponse {
  game: PublicGame;
  /** The seat the caller holds after the swap. */
  seat: Color;
}

export interface ApiError {
  error: string;
}
