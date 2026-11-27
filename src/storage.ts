import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';

import type { GameSnapshot, SeatState } from './game.js';
import type {
  Color,
  GameClock,
  GamePhase,
  GameStatus,
  MoveRecord,
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

function parseMove(value: unknown): MoveRecord | null {
  if (!isRecord(value)) return null;
  const { san, from, to, color, promotion } = value;
  if (
    typeof san !== 'string' ||
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !isColor(color)
  ) {
    return null;
  }
  if (promotion !== undefined && typeof promotion !== 'string') return null;
  return {
    san,
    from,
    to,
    color,
    ...(typeof promotion === 'string' ? { promotion } : {})
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

/**
 * Stores one JSON file per game under <dataDir>/games. Failures are logged and
 * swallowed so a read-only disk never takes down the chess server.
 */
export class GameStorage {
  readonly dataDir: string;
  private readonly gamesDir: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.gamesDir = path.join(this.dataDir, 'games');
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
    } catch (error) {
      console.error(`Failed to delete saved game ${id} from ${this.dataDir}:`, error);
    }
  }

  private fileFor(id: string): string {
    const safeId = SAFE_ID.test(id) ? id : encodeURIComponent(id);
    return path.join(this.gamesDir, `${safeId}.json`);
  }
}

