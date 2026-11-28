import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Chess } from 'chess.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { EngineSession, PositionEval } from '../src/engine/uci.js';
import type { ReviewEngine, ReviewBookSource } from '../src/review/service.js';
import { ReviewService } from '../src/review/service.js';
import { GameStorage } from '../src/storage.js';
import { GameStore } from '../src/store.js';
import { normalizeFen } from '../src/shared/openings.js';
import type { EngineStatus, ReviewState } from '../src/shared/protocol.js';

const createdDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-review-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function availableStatus(): EngineStatus {
  return {
    phase: 'available',
    name: 'Fakefish',
    version: 'test',
    path: '/fake/stockfish',
    managed: false,
    depth: 14,
    download: null,
    error: null
  };
}

function fakeAnalysis(fen: string): PositionEval {
  const chess = new Chess(fen);
  const move = chess.moves({ verbose: true })[0];
  if (!move) return { bestMoveUci: null, lines: [], depth: 14 };
  const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
  return {
    bestMoveUci: uci,
    lines: [{ multipv: 1, cp: 0, mate: null, pv: [uci], depth: 14, bound: false }],
    depth: 14
  };
}

class FakeEngine implements ReviewEngine {
  readonly calls: string[] = [];
  fail = false;

  status(): EngineStatus {
    return this.fail
      ? { ...availableStatus(), phase: 'failed', error: 'fake engine unavailable' }
      : availableStatus();
  }

  subscribe(): () => void {
    return () => undefined;
  }

  retry(): void {
    this.fail = false;
  }

  waitForEngine(): Promise<EngineSession> {
    if (this.fail) return Promise.reject(new Error('fake engine unavailable'));
    const session: EngineSession = {
      engineName: 'Fakefish',
      analyze: (fen: string) => {
        this.calls.push(fen);
        return Promise.resolve(fakeAnalysis(fen));
      },
      dispose: () => Promise.resolve()
    };
    return Promise.resolve(session);
  }
}

function finishedGame(store: GameStore): string {
  const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
  store.move(created.game.id, 'e4');
  store.move(created.game.id, 'e5');
  store.resign(created.game.id, undefined, 'white');
  return created.game.id;
}

describe('ReviewService', () => {
  it('analyzes a finished game, reports progress, and persists the review', async () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir, autoTick: false });
    const engine = new FakeEngine();
    const service = new ReviewService({
      store,
      engine,
      storage: store.storage,
      autoAnalyze: false
    });
    const gameId = finishedGame(store);

    expect(service.state(gameId).phase).toBe('idle');
    const started = service.start(gameId);
    expect(['queued', 'running']).toContain(started.phase);

    const done = await service.waitForCompletion(gameId, 2_000);
    expect(done.phase).toBe('complete');
    expect(done.review?.moveCount).toBe(2);
    expect(done.review?.moves).toHaveLength(2);
    expect(done.review?.accuracy.white).toBeGreaterThan(0);
    expect(engine.calls).toHaveLength(3);

    const saved = new GameStorage(dir).loadReview(gameId);
    expect(saved?.moves).toHaveLength(2);

    const reloaded = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: store.storage,
      autoAnalyze: false
    });
    expect(reloaded.state(gameId).phase).toBe('complete');
    expect(reloaded.state(gameId).review?.engineName).toBe('Fakefish');

    service.dispose();
    store.dispose();
  });

  it('starts automatically when a game ends', async () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir, autoTick: false });
    const service = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: store.storage
    });

    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    const gameId = created.game.id;
    store.move(gameId, 'd4');

    const completed = new Promise<ReviewState>((resolve) => {
      service.subscribe((id, state) => {
        if (id === gameId && state.phase === 'complete') resolve(state);
      });
    });

    store.resign(gameId, undefined, 'black');
    const state = await completed;
    expect(state.review?.moves[0]?.san).toBe('d4');

    service.dispose();
    store.dispose();
  });

  it('refuses to review a running game', () => {
    const store = new GameStore();
    const service = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: null,
      autoAnalyze: false
    });
    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    expect(() => service.start(created.game.id)).toThrow(/still running/i);
    service.dispose();
    store.dispose();
  });

  it('reports a failed review when the engine is unavailable', async () => {
    const store = new GameStore();
    const engine = new FakeEngine();
    engine.fail = true;
    const service = new ReviewService({
      store,
      engine,
      storage: null,
      autoAnalyze: false
    });
    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    store.move(created.game.id, 'e4');
    store.resign(created.game.id, undefined, 'white');

    service.start(created.game.id);
    const state = await service.waitForCompletion(created.game.id, 2_000);
    expect(state.phase).toBe('failed');
    expect(state.error).toMatch(/unavailable/);

    service.dispose();
    store.dispose();
  });

  it('re-labels cached reviews once an opening book is available', async () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir, autoTick: false });
    const gameId = finishedGame(store);

    const first = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: store.storage,
      autoAnalyze: false
    });
    first.start(gameId);
    await first.waitForCompletion(gameId, 2_000);
    first.dispose();

    const storage = store.storage;
    expect(storage).not.toBeNull();
    const before = storage?.loadReview(gameId);
    expect(before?.book).toBeNull();
    expect(before?.moves.some((move) => move.quality === 'book')).toBe(false);

    const snapshot = store.get(gameId).toSnapshot();
    const chess = new Chess(snapshot.initialFen);
    const book = new Map<string, { eco: string; name: string } | null>();
    for (const move of snapshot.moves) {
      chess.move(move.san);
      const key = normalizeFen(chess.fen());
      if (key) book.set(key, { eco: 'B00', name: "King's Pawn Game" });
    }

    const openings: ReviewBookSource = {
      waitForBook: () => Promise.resolve(book),
      loadedBook: () => ({ book, key: 'test-commit' })
    };
    const reloaded = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: store.storage,
      openings,
      autoAnalyze: false
    });

    const state = reloaded.state(gameId);
    expect(state.phase).toBe('complete');
    expect(state.review?.book).toBe('test-commit');
    expect(state.review?.moves.map((move) => move.quality)).toEqual(['book', 'book']);
    expect(state.review?.moves[0]?.baseQuality).toBeDefined();
    expect(state.review?.counts.white.book).toBe(1);
    expect(state.review?.counts.black.book).toBe(1);
    expect(state.review?.opening).toEqual({ eco: 'B00', name: "King's Pawn Game" });

    // The refreshed labels are persisted, so the next boot reads them as-is.
    expect(storage?.loadReview(gameId)?.book).toBe('test-commit');

    reloaded.dispose();
    store.dispose();
  });

  it('drops a review when the game is deleted', async () => {
    const store = new GameStore();
    const service = new ReviewService({
      store,
      engine: new FakeEngine(),
      storage: null,
      autoAnalyze: false
    });
    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    store.move(created.game.id, 'e4');
    store.resign(created.game.id, undefined, 'white');
    service.start(created.game.id);
    await service.waitForCompletion(created.game.id, 2_000);

    store.delete(created.game.id);
    expect(() => service.state(created.game.id)).toThrow(/not found/i);

    service.dispose();
    store.dispose();
  });
});

