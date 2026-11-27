export type Color = 'white' | 'black';
export type SeatKind = 'human' | 'llm' | 'open';
export type GamePhase = 'playing' | 'checkmate' | 'stalemate' | 'draw' | 'resigned';
export type DrawAction = 'offer' | 'accept' | 'decline';
export type CreateGameColor = Color | 'random' | 'none';

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

export interface ApiError {
  error: string;
}
