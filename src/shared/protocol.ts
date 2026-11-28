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

export interface MoveClocks {
  whiteMs: number;
  blackMs: number;
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  color: Color;
  promotion?: string;
  /**
   * Clock banks after this move was played. Present for timed games, so the
   * review can show the clock as it stood at any point in the game.
   */
  clocks?: MoveClocks;
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
  /** FEN the game started from; used for opening-book matching on the client. */
  initialFen: string;
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

/** An opening name and its ECO code, as published by the opening-book data. */
export interface OpeningInfo {
  eco: string;
  name: string;
}

/** Move labels produced by the review engine, best-to-worst display order. */
export const MOVE_QUALITIES = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
  'forced'
] as const;

export type MoveQuality = (typeof MOVE_QUALITIES)[number];

export interface MoveReview {
  /** 1-based ply (half-move) number. */
  ply: number;
  color: Color;
  san: string;
  uci: string;
  quality: MoveQuality;
  /** Evaluation before the move, in centipawns from White's point of view. */
  evalBeforeCp: number;
  /** Evaluation after the move, in centipawns from White's point of view. */
  evalAfterCp: number;
  /** Centipawns lost by the mover (never negative). */
  cpLoss: number;
  /** Win probability for the mover before the move, 0-100. */
  winBefore: number;
  /** Win probability for the mover after the move, 0-100. */
  winAfter: number;
  /** Per-move accuracy, 0-100. */
  accuracy: number;
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  pv: string[];
  depth: number;
  /** Deepest named book position reached by this move, if the game was in book. */
  opening?: OpeningInfo | null;
  /**
   * The engine-derived label that was replaced by "book", so cached reviews can
   * be re-annotated (or un-booked) without running Stockfish again.
   */
  baseQuality?: MoveQuality;
}

export interface ReviewSummary {
  version: 1;
  gameId: string;
  moveCount: number;
  engineName: string;
  depth: number;
  createdAt: number;
  durationMs: number;
  accuracy: Record<Color, number>;
  counts: Record<Color, Record<MoveQuality, number>>;
  /** White-POV centipawn evaluation after 0..n plies (index 0 is the start). */
  evalGraph: number[];
  moves: MoveReview[];
  /** Deepest opening named by the book, or null when the game left theory early. */
  opening?: OpeningInfo | null;
  /**
   * Identity of the dataset used for book labels (the upstream commit). Absent
   * on reviews saved before opening detection existed, or null when the book was
   * unavailable; either way the labels are refreshed once a book is loaded.
   */
  book?: string | null;
}

export type ReviewPhase = 'idle' | 'queued' | 'running' | 'complete' | 'failed';

export interface ReviewState {
  gameId: string;
  phase: ReviewPhase;
  /** Positions analyzed so far, and the total number of positions. */
  done: number;
  total: number;
  review: ReviewSummary | null;
  error: string | null;
}

export type EnginePhase = 'available' | 'installing' | 'unavailable' | 'failed';

export type OpeningPhase = 'disabled' | 'idle' | 'downloading' | 'ready' | 'failed';

/** Provenance of the downloaded opening data. */
export interface OpeningSource {
  name: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  commit: string;
}

export interface OpeningStatus {
  phase: OpeningPhase;
  /** Number of positions in the loaded book, 0 until it is ready. */
  positions: number;
  source: OpeningSource | null;
  error: string | null;
}

export interface EngineDownload {
  receivedBytes: number;
  totalBytes: number;
  /** Null while the total size is unknown. */
  percent: number | null;
}

export interface EngineStatus {
  phase: EnginePhase;
  name: string | null;
  version: string | null;
  path: string | null;
  /** True when the binary was fetched into the app's data directory. */
  managed: boolean;
  depth: number;
  download: EngineDownload | null;
  error: string | null;
}

export type WsServerMessage =
  | { type: 'hello'; serverTime: number }
  | { type: 'snapshot'; games: PublicGame[] }
  | { type: 'game'; game: PublicGame }
  | { type: 'deleted'; id: string }
  | { type: 'review'; id: string; review: ReviewState }
  | { type: 'engine'; engine: EngineStatus };

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
