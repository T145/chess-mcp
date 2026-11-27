import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GameStorage, parseSnapshot, resolveDataDir } from '../src/storage.js';
import { GameStore } from '../src/store.js';

const createdDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-test-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveDataDir', () => {
  it('uses the Saved Games folder on Windows', () => {
    const dir = resolveDataDir({
      platform: 'win32',
      homedir: 'C:\\Users\\alice',
      env: {}
    });
    expect(dir).toBe(path.join('C:\\Users\\alice', 'Saved Games', 'chess-mcp'));
  });

  it('uses Application Support on macOS', () => {
    const dir = resolveDataDir({
      platform: 'darwin',
      homedir: '/Users/alice',
      env: {}
    });
    expect(dir).toBe(path.join('/Users/alice', 'Library', 'Application Support', 'chess-mcp'));
  });

  it('uses the XDG data directory on Linux', () => {
    const fallback = resolveDataDir({
      platform: 'linux',
      homedir: '/home/alice',
      env: {}
    });
    expect(fallback).toBe(path.join('/home/alice', '.local', 'share', 'chess-mcp'));

    const xdg = resolveDataDir({
      platform: 'linux',
      homedir: '/home/alice',
      env: { XDG_DATA_HOME: '/data' }
    });
    expect(xdg).toBe(path.join(path.resolve('/data'), 'chess-mcp'));
  });

  it('honors CHESS_MCP_DATA_DIR on every platform', () => {
    const dir = resolveDataDir({
      platform: 'win32',
      homedir: 'C:\\Users\\alice',
      env: { CHESS_MCP_DATA_DIR: 'custom-saves' }
    });
    expect(dir).toBe(path.resolve('custom-saves'));
  });
});

describe('GameStorage', () => {
  it('saves, reloads, and removes games', () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir });
    const created = store.create({ as: 'white', name: 'Alice', kind: 'human' });
    const joined = store.join(created.game.id, 'black', 'Bob', 'human');
    store.move(created.game.id, 'e4', created.token ?? '', 'King pawn, eyes d5');

    const files = readdirSync(path.join(dir, 'games'));
    expect(files).toEqual([`${created.game.id}.json`]);

    const reloaded = new GameStore({ dataDir: dir });
    const game = reloaded.getPublic(created.game.id);
    expect(game.moves.map((move) => move.san)).toEqual(['e4']);
    expect(game.moves[0]?.note).toBe('King pawn, eyes d5');
    expect(game.pgn).toContain('1. e4 {King pawn, eyes d5}');
    expect(game.seats).toEqual({
      white: { kind: 'human', name: 'Alice' },
      black: { kind: 'human', name: 'Bob' }
    });

    // Original seat tokens still authorize moves after a restart.
    reloaded.move(created.game.id, 'e5', joined.token);
    expect(reloaded.getPublic(created.game.id).moves.map((move) => move.san)).toEqual([
      'e4',
      'e5'
    ]);

    reloaded.delete(created.game.id);
    expect(readdirSync(path.join(dir, 'games'))).toEqual([]);
    expect(new GameStore({ dataDir: dir }).list()).toEqual([]);
  });

  it('persists draw offers and finished games', () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir });

    const drawn = store.create({ as: 'white', name: 'Alice', kind: 'human' });
    const black = store.join(drawn.game.id, 'black', 'Bob', 'human');
    store.draw(drawn.game.id, 'offer', drawn.token ?? '');

    const resigned = store.create({ as: 'black', name: 'Carol', kind: 'llm' });
    store.join(resigned.game.id, 'white', 'Dave', 'human');
    store.resign(resigned.game.id, resigned.token ?? '');

    const reloaded = new GameStore({ dataDir: dir });
    expect(reloaded.getPublic(drawn.game.id).drawOffer).toBe('white');
    reloaded.draw(drawn.game.id, 'accept', black.token);
    expect(reloaded.getPublic(drawn.game.id).status).toEqual({
      phase: 'draw',
      winner: null,
      reason: 'agreement'
    });

    expect(reloaded.getPublic(resigned.game.id).status).toEqual({
      phase: 'resigned',
      winner: 'white',
      reason: 'black resigned'
    });
  });

  it('persists clocks and resumes them without charging downtime', () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir, autoTick: false });
    const created = store.create({
      as: 'white',
      name: 'Alice',
      kind: 'human',
      timeControl: { category: 'rapid', label: '10 + 5', baseMs: 600_000, incrementMs: 5_000 }
    });
    const gameId = created.game.id;
    store.join(gameId, 'black', 'Bob', 'human');
    store.move(gameId, 'e4', created.token ?? '');

    const saved = new GameStorage(dir).load()[0];
    expect(saved?.clock?.label).toBe('10 + 5');
    expect(saved?.clock?.whiteMs).toBeGreaterThanOrEqual(600_000);

    const reloaded = new GameStore({ dataDir: dir, autoTick: false });
    const restored = reloaded.getPublic(gameId);
    expect(restored.clock?.label).toBe('10 + 5');
    expect(restored.clock?.blackMs).toBe(600_000);
    expect(restored.clock?.turnStartedAt).not.toBeNull();

    // Older saved games have no clock field and must still load, untimed.
    const legacy: Record<string, unknown> = { ...store.get(gameId).toSnapshot() };
    delete legacy.clock;
    expect(parseSnapshot(legacy)?.clock).toBeNull();

    reloaded.dispose();
    store.dispose();
  });

  it('does not start a clock for a saved game with an open seat', () => {
    const dir = tempDir();
    const store = new GameStore({ dataDir: dir, autoTick: false });
    const created = store.create({
      as: 'black',
      name: 'Taylor',
      kind: 'human',
      timeControl: { category: 'rapid', label: '10 min', baseMs: 600_000, incrementMs: 0 }
    });
    expect(created.game.clock?.turnStartedAt).toBeNull();

    const reloaded = new GameStore({ dataDir: dir, autoTick: false });
    const restored = reloaded.getPublic(created.game.id);

    expect(restored.seats.white.kind).toBe('open');
    expect(restored.clock?.turnStartedAt).toBeNull();
    expect(restored.clock?.whiteMs).toBe(600_000);
    expect(restored.status.phase).toBe('playing');

    reloaded.tick(Date.now() + 3_600_000);
    expect(reloaded.getPublic(created.game.id).status.phase).toBe('playing');

    reloaded.dispose();
    store.dispose();
  });

  it('skips corrupt or invalid files instead of failing to start', () => {
    const dir = tempDir();
    const storage = new GameStorage(dir);
    const gamesDir = path.join(dir, 'games');

    // Saving one valid game creates the directory.
    const store = new GameStore({ dataDir: dir });
    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    writeFileSync(path.join(gamesDir, 'broken.json'), '{ not json');
    writeFileSync(path.join(gamesDir, 'wrong-shape.json'), JSON.stringify({ version: 99 }));

    const loaded = storage.load();
    expect(loaded.map((snapshot) => snapshot.id)).toEqual([created.game.id]);
    expect(parseSnapshot({ version: 99 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});
