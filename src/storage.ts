import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';

import type { GameSnapshot, SeatState } from './game.js';
import { MOVE_QUALITIES } from './shared/protocol.js';
import type {
  Color,
  GameClock,
  GamePhase,
  GameStatus,
  MoveClocks,
  MoveQuality,
  MoveRecord,
  MoveReview,
  OpeningInfo,
  ReviewSummary,
  SeatKind,
  TimeControlCategory
} from './shared/protocol.js';

const SNAPSHOT_VERSION = 1;
const SAFE_ID = /^[\w-]{1,64}$/;

export interface DataDirOptions {
  platform?: NodeJS.Platform;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Pick the OS-appropriate place for saved games:
 * - Windows: %USERPROFILE%\Saved Games\chess-mcp
 * - macOS:   ~/Library/Application Support/chess-mcp
 * - Linux:   $XDG_DATA_HOME/chess-mcp (default ~/.local/share/chess-mcp)
 *
 * Set CHESS_MCP_DATA_DIR to override the location on any platform.
 */
export function resolveDataDir(options: DataDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const home = options.homedir ?? osHomedir();
  const env = options.env ?? process.env;

  const override = env.CHESS_MCP_DATA_DIR?.trim();
  if (override) return path.resolve(override);

  if (platform === 'win32') {
    return path.join(home, 'Saved Games', 'chess-mcp');
  }

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'chess-mcp');
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const base = xdgDataHome ? path.resolve(xdgDataHome) : path.join(home, '.local', 'share');
  return path.join(base, 'chess-mcp');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

function isSeatKind(value: unknown): value is SeatKind {
  return value === 'human' || value === 'llm' || value === 'open';
}

function isPhase(value: unknown): value is GamePhase {
  return (
    value === 'playing' ||
    value === 'checkmate' ||
    value === 'stalemate' ||
    value === 'draw' ||
    value === 'resigned' ||
    value === 'timeout'
  );
}

function isTimeControlCategory(value: unknown): value is TimeControlCategory {
  return value === 'bullet' || value === 'blitz' || value === 'rapid' || value === 'daily';
}

/** Returns null for a missing or malformed clock; the game then loads untimed. */
function parseClock(value: unknown): GameClock | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;

  const { category, label, baseMs, incrementMs, bankCapMs, whiteMs, blackMs, turn, turnStartedAt } =
    value;
  if (!isTimeControlCategory(category) || typeof label !== 'string') return null;
  if (!isColor(turn)) return null;
  if (!isFiniteNumber(baseMs) || !isFiniteNumber(incrementMs)) return null;
  if (!isFiniteNumber(whiteMs) || !isFiniteNumber(blackMs)) return null;
  if (bankCapMs !== undefined && bankCapMs !== null && !isFiniteNumber(bankCapMs)) return null;
  if (turnStartedAt !== null && turnStartedAt !== undefined && !isFiniteNumber(turnStartedAt)) {
    return null;
  }

  return {
    category,
    label,
    baseMs,
    incrementMs,
    ...(isFiniteNumber(bankCapMs) ? { bankCapMs } : {}),
    whiteMs,
    blackMs,
    turn,
    turnStartedAt: isFiniteNumber(turnStartedAt) ? turnStartedAt : null
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSeat(value: unknown): SeatState | null {
  if (!isRecord(value)) return null;
  const { kind, name, tokenHash } = value;
  if (!isSeatKind(kind) || typeof name !== 'string') return null;
  if (tokenHash !== undefined && typeof tokenHash !== 'string') return null;
  return {
    kind,
    name,
    ...(typeof tokenHash === 'string' ? { tokenHash } : {})
  };
}

function parseMoveClocks(value: unknown): MoveClocks | null {
  if (!isRecord(value)) return null;
  const { whiteMs, blackMs } = value;
  if (!isFiniteNumber(whiteMs) || !isFiniteNumber(blackMs)) return null;
  return { whiteMs, blackMs };
}

function parseMove(value: unknown): MoveRecord | null {
  if (!isRecord(value)) return null;
  const { san, from, to, color, promotion, clocks, note } = value;
  if (
    typeof san !== 'string' ||
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !isColor(color)
  ) {
    return null;
  }
  if (promotion !== undefined && typeof promotion !== 'string') return null;
  if (note !== undefined && typeof note !== 'string') return null;

  let parsedClocks: MoveClocks | undefined;
  if (clocks !== undefined) {
    const parsed = parseMoveClocks(clocks);
    if (!parsed) return null;
    parsedClocks = parsed;
  }

  return {
    san,
    from,
    to,
    color,
    ...(typeof promotion === 'string' ? { promotion } : {}),
    ...(parsedClocks ? { clocks: parsedClocks } : {}),
    ...(typeof note === 'string' && note.length > 0 ? { note } : {})
  };
}

function parseStatus(value: unknown): GameStatus | null {
  if (!isRecord(value)) return null;
  const { phase, winner, reason } = value;
  if (!isPhase(phase) || typeof reason !== 'string') return null;
  if (winner !== null && !isColor(winner)) return null;
  return { phase, winner, reason };
}

/**
 * Validate untrusted JSON (read from disk) before it becomes a GameSnapshot.
 * Returns null when the shape is not recognized so corrupt files are skipped.
 */
export function parseSnapshot(value: unknown): GameSnapshot | null {
  if (!isRecord(value)) return null;

  const { version, id, initialFen, seats, moves, status, drawOffer, clock, createdAt, updatedAt } =
    value;

  if (version !== SNAPSHOT_VERSION) return null;
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
  if (typeof initialFen !== 'string' || !isRecord(seats) || !Array.isArray(moves)) return null;

  const white = parseSeat(seats.white);
  const black = parseSeat(seats.black);
  const parsedStatus = parseStatus(status);
  if (!white || !black || !parsedStatus) return null;

  let parsedDrawOffer: Color | null = null;
  if (drawOffer !== null) {
    if (!isColor(drawOffer)) return null;
    parsedDrawOffer = drawOffer;
  }

  if (!isFiniteNumber(createdAt) || !isFiniteNumber(updatedAt)) return null;

  const parsedMoves: MoveRecord[] = [];
  for (const raw of moves) {
    const move = parseMove(raw);
    if (!move) return null;
    parsedMoves.push(move);
  }

  return {
    version: SNAPSHOT_VERSION,
    id,
    initialFen,
    seats: { white, black },
    moves: parsedMoves,
    status: parsedStatus,
    drawOffer: parsedDrawOffer,
    clock: parseClock(clock),
    createdAt,
    updatedAt
  };
}

function isMoveQuality(value: unknown): value is MoveQuality {
  return typeof value === 'string' && (MOVE_QUALITIES as readonly string[]).includes(value);
}

/**
 * Tolerant opening parser: absent becomes null (older reviews), but a present
 * value with the wrong shape invalidates the file.
 */
function parseOpeningInfo(value: unknown): OpeningInfo | null | false {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return false;
  const { eco, name } = value;
  if (typeof eco !== 'string' || typeof name !== 'string') return false;
  return { eco, name };
}

function parseMoveReview(value: unknown): MoveReview | null {
  if (!isRecord(value)) return null;
  const {
    ply,
    color,
    san,
    uci,
    quality,
    evalBeforeCp,
    evalAfterCp,
    cpLoss,
    winBefore,
    winAfter,
    accuracy,
    bestMoveUci,
    bestMoveSan,
    pv,
    depth,
    opening,
    baseQuality
  } = value;

  if (!isFiniteNumber(ply) || !Number.isInteger(ply) || ply < 1) return null;
  if (!isColor(color) || !isMoveQuality(quality)) return null;
  if (typeof san !== 'string' || typeof uci !== 'string') return null;
  if (
    !isFiniteNumber(evalBeforeCp) ||
    !isFiniteNumber(evalAfterCp) ||
    !isFiniteNumber(cpLoss) ||
    !isFiniteNumber(winBefore) ||
    !isFiniteNumber(winAfter) ||
    !isFiniteNumber(accuracy) ||
    !isFiniteNumber(depth)
  ) {
    return null;
  }
  if (bestMoveUci !== null && typeof bestMoveUci !== 'string') return null;
  if (bestMoveSan !== null && typeof bestMoveSan !== 'string') return null;
  if (!Array.isArray(pv) || !pv.every((entry) => typeof entry === 'string')) return null;

  const parsedOpening = parseOpeningInfo(opening);
  if (parsedOpening === false) return null;
  if (baseQuality !== undefined && !isMoveQuality(baseQuality)) return null;

  return {
    ply,
    color,
    san,
    uci,
    quality,
    evalBeforeCp,
    evalAfterCp,
    cpLoss,
    winBefore,
    winAfter,
    accuracy,
    bestMoveUci,
    bestMoveSan,
    pv,
    depth,
    opening: parsedOpening,
    ...(isMoveQuality(baseQuality) ? { baseQuality } : {})
  };
}

function parseQualityCounts(value: unknown): Record<MoveQuality, number> | null {
  if (!isRecord(value)) return null;
  const counts: Record<MoveQuality, number> = {
    book: 0,
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    forced: 0
  };
  for (const quality of MOVE_QUALITIES) {
    const count = value[quality];
    // Reviews saved before a label existed simply do not have its key.
    if (count === undefined) {
      counts[quality] = 0;
      continue;
    }
    if (!isFiniteNumber(count) || count < 0 || !Number.isInteger(count)) return null;
    counts[quality] = count;
  }
  return counts;
}

/** Validate a review file read from disk; returns null for anything malformed. */
export function parseReviewSummary(value: unknown): ReviewSummary | null {
  if (!isRecord(value)) return null;

  const {
    version,
    gameId,
    moveCount,
    engineName,
    depth,
    createdAt,
    durationMs,
    accuracy,
    counts,
    evalGraph,
    moves,
    opening,
    book
  } = value;

  if (version !== 1) return null;
  if (typeof gameId !== 'string' || !SAFE_ID.test(gameId)) return null;
  if (!isFiniteNumber(moveCount) || !Number.isInteger(moveCount) || moveCount < 0) return null;
  if (typeof engineName !== 'string') return null;
  if (!isFiniteNumber(depth) || !isFiniteNumber(createdAt) || !isFiniteNumber(durationMs)) {
    return null;
  }
  if (!isRecord(accuracy)) return null;
  const whiteAccuracy = accuracy.white;
  const blackAccuracy = accuracy.black;
  if (!isFiniteNumber(whiteAccuracy) || !isFiniteNumber(blackAccuracy)) return null;

  if (!isRecord(counts)) return null;
  const whiteCounts = parseQualityCounts(counts.white);
  const blackCounts = parseQualityCounts(counts.black);
  if (!whiteCounts || !blackCounts) return null;

  if (!Array.isArray(evalGraph) || !evalGraph.every((entry) => isFiniteNumber(entry))) {
    return null;
  }
  if (evalGraph.length !== moveCount + 1) return null;

  if (!Array.isArray(moves)) return null;
  const parsedMoves: MoveReview[] = [];
  for (const raw of moves) {
    const move = parseMoveReview(raw);
    if (!move) return null;
    parsedMoves.push(move);
  }
  if (parsedMoves.length !== moveCount) return null;

  const parsedOpening = parseOpeningInfo(opening);
  if (parsedOpening === false) return null;
  if (book !== undefined && book !== null && typeof book !== 'string') return null;

  return {
    version: 1,
    gameId,
    moveCount,
    engineName,
    depth,
    createdAt,
    durationMs,
    accuracy: { white: whiteAccuracy, black: blackAccuracy },
    counts: { white: whiteCounts, black: blackCounts },
    evalGraph,
    moves: parsedMoves,
    opening: parsedOpening,
    book: typeof book === 'string' ? book : null
  };
}

/**
 * Stores one JSON file per game under <dataDir>/games. Failures are logged and
 * swallowed so a read-only disk never takes down the chess server.
 */
export class GameStorage {
  readonly dataDir: string;
  private readonly gamesDir: string;
  private readonly reviewsDir: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.gamesDir = path.join(this.dataDir, 'games');
    this.reviewsDir = path.join(this.dataDir, 'reviews');
  }

  load(): GameSnapshot[] {
    let entries: string[];
    try {
      entries = readdirSync(this.gamesDir);
    } catch {
      return [];
    }

    const snapshots: GameSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(this.gamesDir, entry);
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        const snapshot = parseSnapshot(parsed);
        if (snapshot) snapshots.push(snapshot);
        else console.warn(`Ignoring saved game with an invalid format: ${file}`);
      } catch (error) {
        console.warn(`Ignoring unreadable saved game ${file}:`, error);
      }
    }
    return snapshots;
  }

  save(snapshot: GameSnapshot): void {
    try {
      mkdirSync(this.gamesDir, { recursive: true });
      const file = this.fileFor(snapshot.id);
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      renameSync(temporary, file);
    } catch (error) {
      console.error(`Failed to save game ${snapshot.id} to ${this.dataDir}:`, error);
    }
  }

  remove(id: string): void {
    try {
      rmSync(this.fileFor(id), { force: true });
      rmSync(this.reviewFileFor(id), { force: true });
    } catch (error) {
      console.error(`Failed to delete saved game ${id} from ${this.dataDir}:`, error);
    }
  }

  loadReview(gameId: string): ReviewSummary | null {
    const file = this.reviewFileFor(gameId);
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const review = parseReviewSummary(parsed);
      if (!review) console.warn(`Ignoring saved review with an invalid format: ${file}`);
      return review;
    } catch {
      return null;
    }
  }

  saveReview(review: ReviewSummary): void {
    try {
      mkdirSync(this.reviewsDir, { recursive: true });
      const file = this.reviewFileFor(review.gameId);
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
      renameSync(temporary, file);
    } catch (error) {
      console.error(`Failed to save review for ${review.gameId} to ${this.dataDir}:`, error);
    }
  }

  removeReview(gameId: string): void {
    try {
      rmSync(this.reviewFileFor(gameId), { force: true });
    } catch (error) {
      console.error(`Failed to delete saved review ${gameId} from ${this.dataDir}:`, error);
    }
  }

  private fileFor(id: string): string {
    const safeId = SAFE_ID.test(id) ? id : encodeURIComponent(id);
    return path.join(this.gamesDir, `${safeId}.json`);
  }

  private reviewFileFor(gameId: string): string {
    const safeId = SAFE_ID.test(gameId) ? gameId : encodeURIComponent(gameId);
    return path.join(this.reviewsDir, `${safeId}.json`);
  }
}

