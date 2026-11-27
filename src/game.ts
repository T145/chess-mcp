import { Chess, SQUARES } from 'chess.js';
import type { Color as ChessColor, Move, PieceSymbol, Square } from 'chess.js';

import { UserError } from './errors.js';
import type {
  ClockConfig,
  Color,
  GameClock,
  GameStatus,
  MoveInput,
  MoveRecord,
  PublicGame,
  PublicSeat,
  SeatKind
} from './shared/protocol.js';
import { remainingMs } from './shared/timeControl.js';

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
  /** Omit for an untimed game. */
  clock?: ClockConfig | null;
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
  clock: GameClock | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Which move notes to reveal: `true` = everyone's, `false` = none, or a colour
 * to reveal only that player's notes (what an agent sees during a live game).
 */
export type NoteVisibility = boolean | Color;

export interface PublicGameOptions {
  /**
   * Which move notes the view may contain. Defaults to none, so callers have to
   * opt in and a new view cannot leak reasoning by accident. Agents pass their
   * own seat while a game runs; everything may be shown once it ends.
   */
  revealNotes?: NoteVisibility;
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

/**
 * PGN Result tag value for a game status. `*` means the game is still running,
 * otherwise it is the standard `1-0`, `0-1`, or `1/2-1/2` score.
 */
function pgnResult(status: GameStatus): string {
  if (status.phase === 'playing') return '*';
  if (status.winner === 'white') return '1-0';
  if (status.winner === 'black') return '0-1';
  return '1/2-1/2';
}

function cleanNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  // PGN comments cannot contain braces or newlines, and notes stay short.
  const cleaned = note
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** True when a viewer with this visibility setting may read the move's note. */
function maySeeNote(move: MoveRecord, revealNotes: NoteVisibility): boolean {
  if (revealNotes === true) return true;
  if (revealNotes === false) return false;
  return move.color === revealNotes;
}

/** Copy a move record, keeping its note only when the caller may see it. */
function publicMoveRecord(move: MoveRecord, revealNotes: NoteVisibility): MoveRecord {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    color: move.color,
    ...(move.promotion ? { promotion: move.promotion } : {}),
    ...(move.note && maySeeNote(move, revealNotes) ? { note: move.note } : {})
  };
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
  private clock: GameClock | null = null;
  private updatedAt: number;

  constructor(init: GameInit) {
    this.id = init.id;
    this.createdAt = init.now ?? Date.now();
    this.updatedAt = this.createdAt;
    this.initialFen = init.fen ?? START_FEN;
    this.seats = init.seats;
    this.chess = new Chess(this.initialFen);
    this.status = statusFromPosition(this.chess);
    if (init.clock) {
      this.clock = {
        category: init.clock.category,
        label: init.clock.label,
        baseMs: init.clock.baseMs,
        incrementMs: init.clock.incrementMs,
        ...(init.clock.bankCapMs !== undefined ? { bankCapMs: init.clock.bankCapMs } : {}),
        whiteMs: init.clock.baseMs,
        blackMs: init.clock.baseMs,
        turn: this.turn,
        // Do not charge anyone for the time spent inviting an opponent.
        turnStartedAt: this.isPlaying && this.bothSeatsClaimed ? this.createdAt : null
      };
    }
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
    if (snapshot.clock) {
      // Resume a live game from its saved banks, but keep the clock paused when
      // a seat is still open (or the game never started): time spent waiting for
      // an opponent, or while the server was down, is not charged.
      game.clock = {
        ...snapshot.clock,
        turn: game.turn,
        turnStartedAt: game.isPlaying && game.bothSeatsClaimed ? Date.now() : null
      };
    }
    game.syncPgnHeaders();
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

  get currentClock(): GameClock | null {
    return this.clock ? { ...this.clock } : null;
  }

  /** True once both colours have someone in the seat. */
  get bothSeatsClaimed(): boolean {
    return this.seats.white.kind !== 'open' && this.seats.black.kind !== 'open';
  }

  /** True while one colour is seated and the other seat is still open. */
  private get awaitingOpponent(): boolean {
    const open = Number(this.seats.white.kind === 'open') + Number(this.seats.black.kind === 'open');
    return open === 1;
  }

  /**
   * Begin the clock. Called when the second seat is filled, or on the first move
   * of a hotseat game, so time spent waiting for an opponent is free.
   */
  startClock(now: number = Date.now()): void {
    if (!this.clock || this.clock.turnStartedAt !== null || !this.isPlaying) return;
    if (this.awaitingOpponent) return;
    this.clock = { ...this.clock, turn: this.turn, turnStartedAt: now };
  }

  /**
   * Charge the side to move for the time spent so far. When the bank is empty
   * the game ends on time. Returns true when this call ended the game.
   */
  settleClock(now: number = Date.now()): boolean {
    if (!this.clock || this.clock.turnStartedAt === null || !this.isPlaying) return false;

    const turn = this.turn;
    if (remainingMs(this.clock, turn, now) > 0) return false;

    this.clock = {
      ...this.clock,
      whiteMs: turn === 'white' ? 0 : this.clock.whiteMs,
      blackMs: turn === 'black' ? 0 : this.clock.blackMs,
      turnStartedAt: null
    };
    this.status = {
      phase: 'timeout',
      winner: opposite(turn),
      reason: `${turn} ran out of time`
    };
    this.drawOffer = null;
    this.syncPgnHeaders();
    this.updatedAt = now;
    return true;
  }

  private stopClock(): void {
    if (this.clock && this.clock.turnStartedAt !== null) {
      this.clock = { ...this.clock, turnStartedAt: null };
    }
  }

  legalMoves(): string[] {
    return this.isPlaying ? this.chess.moves() : [];
  }

  /**
   * Keep the PGN header tags in sync with the seats and the game result. Call
   * this after anything that changes a player name or the game status, since
   * chess.js writes the `Result` tag straight from its header map.
   */
  syncPgnHeaders(): void {
    this.chess.setHeader('White', this.seats.white.name);
    this.chess.setHeader('Black', this.seats.black.name);
    this.chess.setHeader('Result', pgnResult(this.status));
  }

  /**
   * Exchange the two seats, keeping each player's name and seat token with
   * them. Only allowed before the first move, so nobody changes sides in the
   * middle of a game.
   */
  swapSeats(): void {
    if (!this.isPlaying) {
      throw new UserError(`The game is already over (${this.status.reason}).`);
    }
    if (this.moves.length > 0) {
      throw new UserError('Colors can only be swapped before the first move.');
    }

    const white = this.seats.white;
    this.seats.white = this.seats.black;
    this.seats.black = white;
    this.syncPgnHeaders();
    this.updatedAt = Date.now();
  }

  applyMove(input: MoveInput, now: number = Date.now(), note?: string): MoveRecord {
    this.settleClock(now);
    this.startClock(now);
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

    const cleanedNote = cleanNote(note);
    const record: MoveRecord = {
      san: move.san,
      from: move.from,
      to: move.to,
      color: toColor(move.color),
      ...(move.promotion ? { promotion: move.promotion } : {}),
      ...(cleanedNote ? { note: cleanedNote } : {})
    };

    this.moves.push(record);
    this.lastMove = record;
    this.drawOffer = null;
    this.status = statusFromPosition(this.chess);
    this.settleTurnClock(record.color, now);
    this.syncPgnHeaders();
    this.updatedAt = now;
    return { ...record };
  }

  /** Bank the mover's remaining time, add the increment, and start the next turn. */
  private settleTurnClock(color: Color, now: number): void {
    if (!this.clock) return;

    const startedAt = this.clock.turnStartedAt ?? now;
    const spent = Math.max(0, now - startedAt);
    const bank = color === 'white' ? this.clock.whiteMs : this.clock.blackMs;
    let remaining = Math.max(0, bank - spent) + this.clock.incrementMs;
    if (this.clock.bankCapMs !== undefined) {
      remaining = Math.min(remaining, this.clock.bankCapMs);
    }

    this.clock = {
      ...this.clock,
      whiteMs: color === 'white' ? remaining : this.clock.whiteMs,
      blackMs: color === 'black' ? remaining : this.clock.blackMs,
      turn: color === 'white' ? 'black' : 'white',
      // Do not start the absent opponent's clock before they sit down.
      turnStartedAt: this.isPlaying && !this.awaitingOpponent ? now : null
    };
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
    this.stopClock();
    this.syncPgnHeaders();
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
    this.stopClock();
    this.syncPgnHeaders();
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
      clock: this.clock ? { ...this.clock } : null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * PGN including the move notes the caller may read, as `{comments}` — the
   * usual place for annotations. Private on purpose: a caller has to state whose
   * notes it may see. chess.js has no comment API, so comments are spliced into
   * its movetext in move order.
   */
  private pgnWithNotes(revealNotes: NoteVisibility): string {
    const pgn = this.chess.pgn();
    const visible = this.moves.filter((move) => move.note && maySeeNote(move, revealNotes));
    if (visible.length === 0) return pgn;

    const bodyStart = pgn.indexOf('\n\n');
    let output = pgn;
    let cursor = bodyStart === -1 ? 0 : bodyStart + 2;

    for (const move of visible) {
      if (!move.note) continue;
      const at = output.indexOf(move.san, cursor);
      if (at === -1) continue;
      const after = at + move.san.length;
      const comment = ` {${move.note}}`;
      output = output.slice(0, after) + comment + output.slice(after);
      cursor = after + comment.length;
    }

    return output;
  }

  toPublic(options: PublicGameOptions = {}): PublicGame {
    const revealNotes = options.revealNotes ?? false;
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
      moves: this.moves.map((move) => publicMoveRecord(move, revealNotes)),
      lastMove: this.lastMove ? publicMoveRecord(this.lastMove, revealNotes) : null,
      drawOffer: this.drawOffer,
      legalMoves: this.legalMoves(),
      pgn: this.pgnWithNotes(revealNotes),
      clock: this.clock ? { ...this.clock } : null,
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
