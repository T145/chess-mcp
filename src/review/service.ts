import { Chess } from 'chess.js';

import type { EngineSession, PositionEval } from '../engine/uci.js';
import { UserError } from '../errors.js';
import type { GameStorage } from '../storage.js';
import type { GameStore, StoreEvent } from '../store.js';
import type {
  EngineStatus,
  MoveRecord,
  ReviewState,
  ReviewSummary
} from '../shared/protocol.js';
import { buildReview } from './classify.js';

/** The subset of EngineManager the review queue needs (easy to fake in tests). */
export interface ReviewEngine {
  status(): EngineStatus;
  subscribe(listener: (status: EngineStatus) => void): () => void;
  retry(): void;
  waitForEngine(): Promise<EngineSession>;
}

export interface ReviewServiceOptions {
  store: GameStore;
  engine: ReviewEngine;
  storage: GameStorage | null;
  depth?: number;
  /** Start a review when a game finishes in this process. */
  autoAnalyze?: boolean;
  log?: (message: string) => void;
}

type ReviewListener = (gameId: string, state: ReviewState) => void;

function completeState(review: ReviewSummary): ReviewState {
  return {
    gameId: review.gameId,
    phase: 'complete',
    done: review.moveCount + 1,
    total: review.moveCount + 1,
    review,
    error: null
  };
}

function positionFens(initialFen: string, moves: readonly MoveRecord[]): string[] {
  const chess = new Chess(initialFen);
  const fens = [chess.fen()];
  for (const move of moves) {
    chess.move(move.san);
    fens.push(chess.fen());
  }
  return fens;
}

/**
 * Queues one review at a time, caches completed reviews, persists them, and
 * broadcasts progress. Engine installation is awaited automatically.
 */
export class ReviewService {
  private readonly store: GameStore;
  private readonly engine: ReviewEngine;
  private readonly storage: GameStorage | null;
  private readonly depth: number;
  private readonly log: (message: string) => void;
  private readonly states = new Map<string, ReviewState>();
  private readonly listeners = new Set<ReviewListener>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly unsubscribeStore: () => void;
  private running = false;

  constructor(options: ReviewServiceOptions) {
    this.store = options.store;
    this.engine = options.engine;
    this.storage = options.storage;
    this.depth = options.depth ?? 14;
    this.log = options.log ?? (() => undefined);
    this.unsubscribeStore =
      options.autoAnalyze === false
        ? () => undefined
        : this.store.subscribe((event) => this.onStoreEvent(event));
  }

  subscribe(listener: ReviewListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeEngine(listener: (status: EngineStatus) => void): () => void {
    return this.engine.subscribe(listener);
  }

  engineStatus(): EngineStatus {
    return this.engine.status();
  }

  retryEngineInstall(): void {
    this.engine.retry();
  }

  /** Current state, loading a saved review lazily. */
  state(gameId: string): ReviewState {
    const game = this.store.get(gameId);
    const current = this.states.get(gameId);
    if (current) return current;

    const stored = this.storedReview(gameId, game.moveCount);
    if (stored) {
      const state = completeState(stored);
      this.states.set(gameId, state);
      return state;
    }

    return {
      gameId,
      phase: 'idle',
      done: 0,
      total: game.moveCount + 1,
      review: null,
      error: null
    };
  }

  /** Start (or reuse) a review. Only finished games can be reviewed. */
  start(gameId: string): ReviewState {
    const game = this.store.get(gameId);
    if (game.isPlaying) {
      throw new UserError('The game is still running. Reviews are available after it ends.');
    }
    if (game.moveCount === 0) {
      throw new UserError('The game has no moves to review.');
    }

    const existing = this.states.get(gameId);
    if (existing?.phase === 'running' || existing?.phase === 'queued') return existing;
    if (existing?.phase === 'complete' && existing.review?.moveCount === game.moveCount) {
      return existing;
    }

    const stored = this.storedReview(gameId, game.moveCount);
    if (stored) {
      const state = completeState(stored);
      this.states.set(gameId, state);
      this.emit(state);
      return state;
    }

    this.cancelled.delete(gameId);
    const queued: ReviewState = {
      gameId,
      phase: 'queued',
      done: 0,
      total: game.moveCount + 1,
      review: null,
      error: null
    };
    this.states.set(gameId, queued);
    this.emit(queued);

    if (!this.queued.has(gameId)) {
      this.queued.add(gameId);
      this.queue.push(gameId);
      this.pump();
    }
    return queued;
  }

  /** Resolve when a review finishes, fails, or the timeout expires. */
  waitForCompletion(gameId: string, timeoutMs: number): Promise<ReviewState> {
    const current = this.states.get(gameId);
    if (!current) return Promise.reject(new UserError(`No review is queued for ${gameId}.`));
    if (current.phase === 'complete' || current.phase === 'failed') {
      return Promise.resolve(current);
    }

    return new Promise<ReviewState>((resolve) => {
      let settled = false;
      const finish = (state: ReviewState): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      };
      const unsubscribe = this.subscribe((id, state) => {
        if (id === gameId && (state.phase === 'complete' || state.phase === 'failed')) {
          finish(state);
        }
      });
      const timer = setTimeout(() => {
        finish(this.states.get(gameId) ?? current);
      }, timeoutMs);
    });
  }

  dispose(): void {
    this.unsubscribeStore();
    this.listeners.clear();
    this.queue.length = 0;
    this.queued.clear();
  }

  private storedReview(gameId: string, moveCount: number): ReviewSummary | null {
    const review = this.storage?.loadReview(gameId) ?? null;
    if (!review || review.gameId !== gameId || review.moveCount !== moveCount) return null;
    return review;
  }

  private onStoreEvent(event: StoreEvent): void {
    if (event.type === 'deleted') {
      this.cancelled.add(event.id);
      this.states.delete(event.id);
      this.queued.delete(event.id);
      return;
    }

    const game = event.game;
    if (game.status.phase === 'playing' || game.moves.length === 0) return;
    if (this.states.has(game.id) || this.cancelled.has(game.id)) return;

    const stored = this.storedReview(game.id, game.moves.length);
    if (stored) {
      const state = completeState(stored);
      this.states.set(game.id, state);
      this.emit(state);
      return;
    }

    try {
      this.start(game.id);
    } catch (error) {
      this.log(
        `Could not start review for ${game.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private pump(): void {
    if (this.running) return;

    let gameId = this.queue.shift();
    while (gameId && this.cancelled.has(gameId)) gameId = this.queue.shift();
    if (!gameId) return;

    this.running = true;
    this.queued.delete(gameId);
    void this.analyze(gameId)
      .catch((error: unknown) => this.fail(gameId, error))
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private async analyze(gameId: string): Promise<void> {
    if (this.cancelled.has(gameId)) return;

    const game = this.store.get(gameId);
    const snapshot = game.toSnapshot();
    const fens = positionFens(snapshot.initialFen, snapshot.moves);
    const current = this.states.get(gameId);
    if (!current) return;

    this.set({
      ...current,
      phase: 'running',
      done: 0,
      total: fens.length,
      error: null
    });

    const startedAt = Date.now();
    const session = await this.engine.waitForEngine();
    const analyses: PositionEval[] = [];

    for (const [index, fen] of fens.entries()) {
      if (this.cancelled.has(gameId)) return;
      // oxlint-disable-next-line no-await-in-loop -- engine searches are serialized
      analyses.push(await session.analyze(fen, { depth: this.depth, multipv: 2 }));
      const state = this.states.get(gameId);
      if (!state) return;
      this.set({ ...state, phase: 'running', done: index + 1, total: fens.length });
    }

    if (this.cancelled.has(gameId)) return;

    const review = buildReview({
      gameId,
      initialFen: snapshot.initialFen,
      moves: snapshot.moves,
      fens,
      analyses,
      finalStatus: game.currentStatus,
      engineName: session.engineName,
      depth: this.depth,
      durationMs: Date.now() - startedAt
    });

    this.storage?.saveReview(review);
    this.set(completeState(review));
    this.log(`Review ready for ${gameId} (${review.moveCount} moves).`);
  }

  private fail(gameId: string, error: unknown): void {
    if (this.cancelled.has(gameId)) {
      this.states.delete(gameId);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const current = this.states.get(gameId);
    if (!current) return;

    this.set({ ...current, phase: 'failed', error: message, review: null });
    this.log(`Review failed for ${gameId}: ${message}`);
  }

  private set(state: ReviewState): void {
    this.states.set(state.gameId, state);
    this.emit(state);
  }

  private emit(state: ReviewState): void {
    for (const listener of this.listeners) {
      try {
        listener(state.gameId, state);
      } catch (error) {
        this.log(`Review listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

