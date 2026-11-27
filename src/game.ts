import { Chess, SQUARES } from 'chess.js';
import type { Color as ChessColor, Move, PieceSymbol, Square } from 'chess.js';

import { UserError } from './errors.js';
import type {
  Color,
  GameStatus,
  MoveInput,
  MoveRecord,
  PublicGame,
  PublicSeat,
  SeatKind
} from './shared/protocol.js';

export interface SeatState {
  kind: SeatKind;
  name: string;
  tokenHash?: string;
}

export interface GameInit {
  id: string;
  seats: Record<Color, SeatState>;
  fen?: string;
  now?: number;
}

/**
 * Serializable form of a game. It includes the seat token hashes, so saved
 * games keep their seat ownership after a restart. Never send this to clients.
 */
export interface GameSnapshot {
  version: 1;
  id: string;
  initialFen: string;
  seats: Record<Color, SeatState>;
  moves: MoveRecord[];
  status: GameStatus;
  drawOffer: Color | null;
  createdAt: number;
  updatedAt: number;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SQUARE_SET = new Set<string>(SQUARES);

function isSquare(value: string): value is Square {
  return SQUARE_SET.has(value);
}

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function toColor(color: ChessColor): Color {
  return color === 'w' ? 'white' : 'black';
}

function promotionSymbol(value: string | undefined): PieceSymbol | undefined {
  if (!value) return undefined;
  const piece = value.toLowerCase();
  if (piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n') {
    return piece;
  }
  throw new UserError(`Invalid promotion piece "${value}". Use q, r, b, or n.`);
}

function parseMoveInput(chess: Chess, input: MoveInput): Move {
  if (typeof input === 'object' && input !== null) {
    const { from, to } = input;
    if (!isSquare(from) || !isSquare(to)) {
      throw new UserError('A move object needs valid "from" and "to" squares.');
    }
    return chess.move({
      from,
      to,
      promotion: promotionSymbol(input.promotion)
    });
  }

  const text = input.trim();
  if (!text) throw new UserError('Move is empty.');

  const uci = /^([a-h][1-8])[\s-]?([a-h][1-8])([qrbnQRBN])?$/.exec(text);
  if (uci) {
    const from = uci[1];
    const to = uci[2];
    if (!from || !to || !isSquare(from) || !isSquare(to)) {
      throw new UserError('UCI move needs valid "from" and "to" squares.');
    }
    return chess.move({
      from,
      to,
      promotion: promotionSymbol(uci[3])
    });
  }

  return chess.move(text.replace(/0/g, 'O'));
}

function statusFromPosition(chess: Chess): GameStatus {
  if (chess.isCheckmate()) {
    return {
      phase: 'checkmate',
      winner: opposite(toColor(chess.turn())),
      reason: 'checkmate'
    };
  }
  if (chess.isStalemate()) {
    return { phase: 'stalemate', winner: null, reason: 'stalemate' };
  }
  if (chess.isInsufficientMaterial()) {
    return { phase: 'draw', winner: null, reason: 'insufficient material' };
  }
  if (chess.isThreefoldRepetition()) {
    return { phase: 'draw', winner: null, reason: 'threefold repetition' };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { phase: 'draw', winner: null, reason: 'fifty-move rule' };
  }
  if (chess.isDraw()) {
    return { phase: 'draw', winner: null, reason: 'draw' };
  }
  return { phase: 'playing', winner: null, reason: '' };
}

export class Game {
  readonly id: string;
  readonly createdAt: number;
  readonly initialFen: string;
  readonly seats: Record<Color, SeatState>;

  private readonly chess: Chess;
  private moves: MoveRecord[] = [];
  private lastMove: MoveRecord | null = null;
  private status: GameStatus;
  private drawOffer: Color | null = null;
  private updatedAt: number;

  constructor(init: GameInit) {
    this.id = init.id;
    this.createdAt = init.now ?? Date.now();
    this.updatedAt = this.createdAt;
    this.initialFen = init.fen ?? START_FEN;
    this.seats = init.seats;
    this.chess = new Chess(this.initialFen);
    this.status = statusFromPosition(this.chess);
    this.syncPgnHeaders();
  }

  /**
   * Rebuild a game from a snapshot by replaying its moves from the initial
   * position. Throws if the snapshot contains an illegal move.
   */
  static fromSnapshot(snapshot: GameSnapshot): Game {
    const game = new Game({
      id: snapshot.id,
      seats: {
        white: { ...snapshot.seats.white },
        black: { ...snapshot.seats.black }
      },
      fen: snapshot.initialFen,
      now: snapshot.createdAt
    });

    for (const move of snapshot.moves) {
      game.chess.move(move.san);
      game.moves.push({ ...move });
    }

    game.lastMove = game.moves.at(-1) ?? null;
    game.drawOffer = snapshot.drawOffer;
    game.status =
      snapshot.status.phase === 'playing'
        ? statusFromPosition(game.chess)
        : { ...snapshot.status };
    game.updatedAt = snapshot.updatedAt;
    return game;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return toColor(this.chess.turn());
  }

  get moveCount(): number {
    return this.moves.length;
  }

  get currentStatus(): GameStatus {
    return { ...this.status };
  }

  get currentDrawOffer(): Color | null {
    return this.drawOffer;
  }

  get isPlaying(): boolean {
    return this.status.phase === 'playing';
  }

  legalMoves(): string[] {
    return this.isPlaying ? this.chess.moves() : [];
  }

  syncPgnHeaders(): void {
    this.chess.setHeader('White', this.seats.white.name);
    this.chess.setHeader('Black', this.seats.black.name);
  }

  applyMove(input: MoveInput): MoveRecord {
    if (!this.isPlaying) {
      throw new UserError(`The game is over (${this.status.reason}). No more moves are allowed.`);
    }

    let move: Move;
    try {
      move = parseMoveInput(this.chess, input);
    } catch (error) {
      if (error instanceof UserError) throw error;
      const legal = this.legalMoves();
      throw new UserError(
        `Illegal move "${typeof input === 'string' ? input : JSON.stringify(input)}". ` +
          `Legal moves: ${legal.length > 0 ? legal.join(', ') : 'none'}`
      );
    }

    const record: MoveRecord = {
      san: move.san,
      from: move.from,
      to: move.to,
      color: toColor(move.color),
      ...(move.promotion ? { promotion: move.promotion } : {})
    };

    this.moves.push(record);
    this.lastMove = record;
    this.drawOffer = null;
    this.status = statusFromPosition(this.chess);
    this.updatedAt = Date.now();
    return { ...record };
  }

  resign(color: Color): void {
    if (!this.isPlaying) {
      throw new UserError(`The game is already over (${this.status.reason}).`);
    }
    this.status = {
      phase: 'resigned',
      winner: opposite(color),
      reason: `${color} resigned`
    };
    this.drawOffer = null;
    this.updatedAt = Date.now();
  }

  offerDraw(color: Color): void {
    if (!this.isPlaying) {
      throw new UserError(`The game is already over (${this.status.reason}).`);
    }
    if (this.drawOffer === color) {
      throw new UserError(`${color} has already offered a draw.`);
    }
    this.drawOffer = color;
    this.updatedAt = Date.now();
  }

  acceptDraw(color: Color): void {
    if (!this.isPlaying) {
      throw new UserError(`The game is already over (${this.status.reason}).`);
    }
    if (!this.drawOffer) {
      throw new UserError('There is no pending draw offer.');
    }
    if (this.drawOffer === color) {
      throw new UserError('You cannot accept your own draw offer.');
    }
    this.status = { phase: 'draw', winner: null, reason: 'agreement' };
    this.drawOffer = null;
    this.updatedAt = Date.now();
  }

  declineDraw(color: Color): void {
    if (!this.drawOffer) {
      throw new UserError('There is no pending draw offer.');
    }
    if (this.drawOffer === color) {
      throw new UserError('You cannot decline your own draw offer.');
    }
    this.drawOffer = null;
    this.updatedAt = Date.now();
  }

  toSnapshot(): GameSnapshot {
    return {
      version: 1,
      id: this.id,
      initialFen: this.initialFen,
      seats: {
        white: { ...this.seats.white },
        black: { ...this.seats.black }
      },
      moves: this.moves.map((move) => ({ ...move })),
      status: { ...this.status },
      drawOffer: this.drawOffer,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  toPublic(): PublicGame {
    const seats: Record<Color, PublicSeat> = {
      white: { kind: this.seats.white.kind, name: this.seats.white.name },
      black: { kind: this.seats.black.kind, name: this.seats.black.name }
    };

    return {
      id: this.id,
      fen: this.chess.fen(),
      turn: this.turn,
      inCheck: this.chess.inCheck(),
      status: { ...this.status },
      seats,
      moves: this.moves.map((move) => ({ ...move })),
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      drawOffer: this.drawOffer,
      legalMoves: this.legalMoves(),
      pgn: this.chess.pgn(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  boardAscii(): string {
    const rows = this.chess.board();
    const lines: string[] = ['  +------------------------+'];
    rows.forEach((row, index) => {
      const rank = 8 - index;
      const cells = row.map((piece) => {
        if (!piece) return '.';
        return piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      });
      lines.push(`${rank} | ${cells.join(' ')} |`);
    });
    lines.push('  +------------------------+');
    lines.push('    a b c d e f g h');
    return lines.join('\n');
  }
}
