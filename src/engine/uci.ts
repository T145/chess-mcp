import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';

/** A score line reported by the engine, still from the side-to-move's POV. */
export interface RawEngineLine {
  multipv: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
  bound: boolean;
}

export interface PositionEval {
  bestMoveUci: string | null;
  lines: RawEngineLine[];
  depth: number;
}

export interface AnalyzeOptions {
  depth: number;
  multipv?: number;
  /** Upper bound for a single search, in milliseconds. */
  movetimeMs?: number;
}

export interface EngineSession {
  readonly engineName: string;
  analyze(fen: string, options: AnalyzeOptions): Promise<PositionEval>;
  dispose(): Promise<void>;
}

export interface EngineSessionOptions {
  timeoutMs?: number;
  threads?: number;
  hashMb?: number;
  multipv?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

interface ParsedInfo {
  multipv: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
  bound: boolean;
}

/** Parse an engine `info` line, returning null for lines without a score. */
export function parseInfoLine(line: string): ParsedInfo | null {
  if (!line.startsWith('info ')) return null;

  const tokens = line.trim().split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let pv: string[] = [];
  let bound = false;
  let scoreType: 'cp' | 'mate' | null = null;
  let scoreValue = 0;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token) {
      case 'depth': {
        depth = Number(tokens[index + 1] ?? 0);
        index += 1;
        break;
      }
      case 'multipv': {
        multipv = Number(tokens[index + 1] ?? 1);
        index += 1;
        break;
      }
      case 'score': {
        const type = tokens[index + 1];
        const value = Number(tokens[index + 2] ?? 0);
        if (type === 'cp' || type === 'mate') {
          scoreType = type;
          scoreValue = value;
        }
        index += 2;
        break;
      }
      case 'lowerbound':
      case 'upperbound': {
        bound = true;
        break;
      }
      case 'pv': {
        pv = tokens.slice(index + 1);
        index = tokens.length;
        break;
      }
      default:
        break;
    }
  }

  if (scoreType === null || !Number.isFinite(scoreValue)) return null;

  return {
    depth: Number.isFinite(depth) ? depth : 0,
    multipv: Number.isFinite(multipv) && multipv > 0 ? multipv : 1,
    cp: scoreType === 'cp' ? scoreValue : null,
    mate: scoreType === 'mate' ? scoreValue : null,
    pv,
    bound
  };
}

/** Parse a `bestmove` line, returning the UCI move or null. */
export function parseBestMove(line: string): string | null {
  const match = /^bestmove\s+(\S+)/.exec(line.trim());
  const move = match?.[1];
  return move && move !== '(none)' ? move : null;
}

interface SearchState {
  resolve: (result: PositionEval) => void;
  reject: (error: Error) => void;
  lines: Map<number, RawEngineLine>;
  timer: NodeJS.Timeout;
}

/**
 * Minimal UCI client for a Stockfish process. One engine instance runs one
 * search at a time; callers are serialized internally.
 */
export class UciEngine implements EngineSession {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly readline: Interface;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly waiters = new Set<(error: Error) => void>();
  private readonly chain: { current: Promise<unknown> } = { current: Promise.resolve() };
  private search: SearchState | null = null;
  private multipv: number;
  private disposed = false;
  private name = 'Stockfish';

  private constructor(process: ChildProcessWithoutNullStreams, multipv: number) {
    this.process = process;
    this.multipv = multipv;
    this.readline = createInterface({ input: process.stdout });
    this.readline.on('line', (line) => this.handleLine(line));

    process.on('error', (error) => this.failAll(error));
    process.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      this.engineFailed(new Error(`Stockfish exited (${reason}).`));
    });
  }

  static async start(
    command: string,
    options: EngineSessionOptions = {}
  ): Promise<UciEngine> {
    const process = spawn(command, [], { stdio: 'pipe', windowsHide: true });
    const multipv = options.multipv ?? 1;
    const engine = new UciEngine(process, multipv);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      engine.write('uci');
      await engine.waitForLine((line) => line === 'uciok', timeoutMs);
      engine.write(`setoption name Threads value ${options.threads ?? 1}`);
      engine.write(`setoption name Hash value ${options.hashMb ?? 64}`);
      engine.write(`setoption name MultiPV value ${multipv}`);
      engine.write('ucinewgame');
      engine.write('isready');
      await engine.waitForLine((line) => line === 'readyok', timeoutMs);
      return engine;
    } catch (error) {
      await engine.dispose();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  get engineName(): string {
    return this.name;
  }

  analyze(fen: string, options: AnalyzeOptions): Promise<PositionEval> {
    const run = this.chain.current.then(() => this.runSearch(fen, options));
    this.chain.current = run.catch(() => undefined);
    return run;
  }

  private runSearch(fen: string, options: AnalyzeOptions): Promise<PositionEval> {
    if (this.disposed) return Promise.reject(new Error('Stockfish is not running.'));

    const multipv = options.multipv ?? this.multipv;
    if (multipv !== this.multipv) {
      this.multipv = multipv;
      this.write(`setoption name MultiPV value ${multipv}`);
    }

    return new Promise<PositionEval>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.write('stop');
        this.finishSearch(new Error(`Engine search exceeded ${options.movetimeMs ?? 30_000} ms.`));
      }, options.movetimeMs ?? 30_000);

      this.search = { resolve, reject, lines: new Map(), timer };
      this.write(`position fen ${fen}`);
      const movetime = options.movetimeMs ? ` movetime ${options.movetimeMs}` : '';
      this.write(`go depth ${options.depth}${movetime}`);
    });
  }

  private handleLine(line: string): void {
    if (line.startsWith('id name ')) {
      this.name = line.slice('id name '.length).trim();
    }

    for (const listener of this.lineListeners) listener(line);

    if (line.startsWith('bestmove ')) {
      this.finishSearch(null, parseBestMove(line));
      return;
    }

    const info = parseInfoLine(line);
    if (!info || !this.search || info.bound || info.pv.length === 0) return;

    this.search.lines.set(info.multipv, {
      multipv: info.multipv,
      cp: info.cp,
      mate: info.mate,
      pv: info.pv,
      depth: info.depth,
      bound: info.bound
    });
  }

  private finishSearch(error: Error | null, bestMoveUci: string | null = null): void {
    const search = this.search;
    if (!search) return;
    this.search = null;
    clearTimeout(search.timer);

    if (error) {
      search.reject(error);
      return;
    }

    const lines = [...search.lines.values()].toSorted((a, b) => a.multipv - b.multipv);
    search.resolve({
      bestMoveUci,
      lines,
      depth: lines.reduce((max, line) => Math.max(max, line.depth), 0)
    });
  }

  private write(command: string): void {
    if (this.disposed || !this.process.stdin.writable) return;
    try {
      this.process.stdin.write(`${command}\n`);
    } catch {
      // The exit handler reports the process failure.
    }
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, line?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.lineListeners.delete(listener);
        this.waiters.delete(fail);
        if (error) reject(error);
        else resolve(line ?? '');
      };
      const listener = (line: string): void => {
        if (predicate(line)) finish(undefined, line);
      };
      const fail = (error: Error): void => finish(error);
      const timer = setTimeout(() => {
        finish(new Error(`Stockfish did not respond within ${timeoutMs} ms.`));
      }, timeoutMs);

      this.lineListeners.add(listener);
      this.waiters.add(fail);
    });
  }

  private failAll(error: Error): void {
    for (const fail of this.waiters) fail(error);
    this.finishSearch(error);
  }

  /** An unexpected exit invalidates the engine for all future searches. */
  private engineFailed(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(error);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failAll(new Error('Stockfish was stopped.'));
    this.readline.close();

    try {
      this.process.stdin.write('quit\n');
    } catch {
      // Nothing left to flush.
    }

    if (this.process.exitCode === null) {
      await Promise.race([
        once(this.process, 'exit').then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000).unref())
      ]);
    }
    if (this.process.exitCode === null) this.process.kill();
  }
}

/** Spawn a UCI engine just long enough to confirm it works. */
export async function probeEngine(
  command: string,
  timeoutMs = 10_000
): Promise<{ name: string } | null> {
  try {
    const engine = await UciEngine.start(command, { timeoutMs });
    const name = engine.engineName;
    await engine.dispose();
    return { name };
  } catch {
    return null;
  }
}

