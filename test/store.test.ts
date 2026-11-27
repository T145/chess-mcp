import { describe, expect, it } from 'vitest';

import { GameStore } from '../src/store.js';

function seatedGame(store: GameStore) {
  const white = store.create({ as: 'white', name: 'Alice', kind: 'human' });
  const black = store.join(white.game.id, 'black', 'Bob', 'human');
  return { id: white.game.id, whiteToken: white.token ?? '', blackToken: black.token };
}

describe('GameStore', () => {
  it('creates a game with a short id, a claimed seat, and a token', () => {
    const store = new GameStore();
    const created = store.create({ as: 'white', name: '  Alice  ', kind: 'human' });

    expect(created.game.id).toMatch(/^[a-f0-9]{8}$/);
    expect(created.seat).toBe('white');
    expect(created.token).toMatch(/^[a-f0-9]{36}$/);
    expect(created.game.seats.white).toEqual({ kind: 'human', name: 'Alice' });
    expect(created.game.seats.black).toEqual({ kind: 'open', name: 'Open' });
  });

  it('creates an open hotseat game without a token', () => {
    const store = new GameStore();
    const created = store.create({ as: 'none', name: 'ignored', kind: 'human' });

    expect(created.seat).toBeNull();
    expect(created.token).toBeNull();
    expect(created.game.seats.white.kind).toBe('open');
    expect(created.game.seats.black.kind).toBe('open');
  });

  it('enforces seat tokens and turn order', () => {
    const store = new GameStore();
    const { id, whiteToken, blackToken } = seatedGame(store);

    expect(() => store.move(id, 'e4')).toThrow(/seat token/i);
    expect(() => store.move(id, 'e4', 'not-a-token')).toThrow(/invalid seat token/i);
    expect(() => store.move(id, 'e5', whiteToken)).toThrow(/illegal move/i);

    store.move(id, 'e4', whiteToken);
    expect(() => store.move(id, 'Nf3', whiteToken)).toThrow(/black's turn/i);
    store.move(id, 'e5', blackToken);

    expect(store.getPublic(id).moves.map((move) => move.san)).toEqual(['e4', 'e5']);
  });

  it('allows tokenless moves in a hotseat game', () => {
    const store = new GameStore();
    const { id } = { id: store.create({ as: 'none', name: 'Hotseat', kind: 'human' }).game.id };

    store.move(id, 'e4');
    store.move(id, 'e5');
    store.move(id, 'Nf3');

    expect(store.getPublic(id).moves).toHaveLength(3);
  });

  it('prevents joining an occupied seat', () => {
    const store = new GameStore();
    const { id } = seatedGame(store);

    expect(() => store.join(id, 'white', 'Mallory', 'human')).toThrow(/already claimed/i);
  });

  it('swaps seats and keeps each player’s token with them', () => {
    const store = new GameStore();
    const { id, whiteToken, blackToken } = seatedGame(store);

    const swapped = store.swapSeats(id, whiteToken);

    expect(swapped.seat).toBe('black');
    expect(swapped.game.seats.white).toEqual({ kind: 'human', name: 'Bob' });
    expect(swapped.game.seats.black).toEqual({ kind: 'human', name: 'Alice' });
    expect(store.playerSeat(id, whiteToken)).toBe('black');
    expect(store.playerSeat(id, blackToken)).toBe('white');
    expect(swapped.game.pgn).toContain('[White "Bob"]');
    expect(swapped.game.pgn).toContain('[Black "Alice"]');

    // Alice now has Black, so she cannot move first.
    expect(() => store.move(id, 'e4', whiteToken)).toThrow(/white's turn/i);
    store.move(id, 'e4', blackToken);
    expect(store.getPublic(id).moves[0]?.san).toBe('e4');
  });

  it('refuses to swap seats once the first move is played', () => {
    const store = new GameStore();
    const { id, whiteToken } = seatedGame(store);
    store.move(id, 'e4', whiteToken);

    expect(() => store.swapSeats(id, whiteToken)).toThrow(/before the first move/i);
  });

  it('refuses to swap seats with an invalid token', () => {
    const store = new GameStore();
    const { id } = seatedGame(store);

    expect(() => store.swapSeats(id, 'not-a-token')).toThrow(/invalid seat token/i);
  });

  it('creates a timed game and flags the side to move on tick', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({
      as: 'white',
      name: 'Alice',
      kind: 'human',
      timeControl: { category: 'bullet', label: '1 min', baseMs: 60_000, incrementMs: 0 }
    });
    store.join(created.game.id, 'black', 'Bob', 'human');
    const startedAt = store.getPublic(created.game.id).clock?.turnStartedAt ?? 0;
    expect(created.game.clock?.whiteMs).toBe(60_000);
    expect(startedAt).toBeGreaterThan(0);

    const phases: string[] = [];
    store.subscribe((event) => {
      if (event.type === 'game') phases.push(event.game.status.phase);
    });

    store.tick(startedAt + 59_000);
    expect(store.getPublic(created.game.id).status.phase).toBe('playing');

    store.tick(startedAt + 60_000);
    expect(store.getPublic(created.game.id).status).toEqual({
      phase: 'timeout',
      winner: 'black',
      reason: 'white ran out of time'
    });
    expect(phases).toContain('timeout');
    store.dispose();
  });

  it('keeps each clock bank attached to its colour when seats swap', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({
      as: 'white',
      name: 'Alice',
      kind: 'human',
      timeControl: { category: 'rapid', label: '10 + 5', baseMs: 600_000, incrementMs: 5_000 }
    });
    store.join(created.game.id, 'black', 'Bob', 'human');
    const before = store.getPublic(created.game.id).clock;

    const swapped = store.swapSeats(created.game.id, created.token ?? '');

    expect(swapped.seat).toBe('black');
    expect(swapped.game.clock).toEqual(before);
    store.dispose();
  });

  it('waits for a second seat before starting the clock', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({
      as: 'white',
      name: 'Alice',
      kind: 'human',
      timeControl: { category: 'rapid', label: '10 min', baseMs: 600_000, incrementMs: 0 }
    });
    const { id } = created.game;

    expect(store.getPublic(id).clock?.turnStartedAt).toBeNull();
    store.tick(Date.now() + 3_600_000);
    expect(store.getPublic(id).status.phase).toBe('playing');

    store.join(id, 'black', 'Bob', 'human');
    expect(store.getPublic(id).clock?.turnStartedAt).not.toBeNull();
    store.dispose();
  });

  it('starts a hotseat clock on the first move', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({
      as: 'none',
      name: 'Hotseat',
      kind: 'human',
      timeControl: { category: 'blitz', label: '5 min', baseMs: 300_000, incrementMs: 0 }
    });

    expect(store.getPublic(created.game.id).clock?.turnStartedAt).toBeNull();
    store.move(created.game.id, 'e4');
    expect(store.getPublic(created.game.id).clock?.turnStartedAt).not.toBeNull();
    store.dispose();
  });

  it('skips the clock entirely for untimed games', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({ as: 'white', name: 'Alice', kind: 'human' });

    store.tick(Date.now() + 86_400_000);

    expect(store.getPublic(created.game.id).status.phase).toBe('playing');
    expect(store.getPublic(created.game.id).clock).toBeNull();
    store.dispose();
  });

  it('handles resign and draw actions with seat tokens', () => {
    const store = new GameStore();
    const { id, whiteToken, blackToken } = seatedGame(store);

    store.draw(id, 'offer', whiteToken);
    expect(store.getPublic(id).drawOffer).toBe('white');
    store.draw(id, 'accept', blackToken);
    expect(store.getPublic(id).status).toEqual({
      phase: 'draw',
      winner: null,
      reason: 'agreement'
    });

    const second = seatedGame(store);
    store.resign(second.id, second.blackToken);
    expect(store.getPublic(second.id).status.winner).toBe('white');
  });

  it('requires explicit seats for hotseat resign and draw actions', () => {
    const store = new GameStore();
    const { id } = { id: store.create({ as: 'none', name: 'Hotseat', kind: 'human' }).game.id };

    expect(() => store.resign(id)).toThrow(/seat/i);
    store.resign(id, undefined, 'white');
    expect(store.getPublic(id).status.winner).toBe('black');
  });

  it('hides move notes from public views until the game ends', () => {
    const store = new GameStore();
    const { id, whiteToken, blackToken } = seatedGame(store);

    store.move(id, 'e4', whiteToken, 'Controls the centre; watch ...d5');

    expect(store.getPublic(id).lastMove?.note).toBeUndefined();
    expect(store.getPublic(id).moves[0]?.note).toBeUndefined();
    expect(store.getPublic(id).pgn).not.toContain('Controls the centre');
    expect(store.list()[0]?.moves[0]?.note).toBeUndefined();

    // The notes are still stored on the game itself (agents and snapshots keep them).
    expect(store.get(id).toPublic({ revealNotes: true }).lastMove?.note).toBe(
      'Controls the centre; watch ...d5'
    );

    store.resign(id, blackToken);

    expect(store.getPublic(id).moves[0]?.note).toBe('Controls the centre; watch ...d5');
    expect(store.getPublic(id).pgn).toContain('{Controls the centre; watch ...d5}');
  });

  it('publishes game and delete events', () => {
    const store = new GameStore();
    const events: string[] = [];
    const unsubscribe = store.subscribe((event) => {
      events.push(event.type === 'game' ? `game:${event.game.moves.length}` : `deleted:${event.id}`);
    });

    const created = store.create({ as: 'none', name: 'Hotseat', kind: 'human' });
    store.move(created.game.id, 'e4');
    store.delete(created.game.id);
    unsubscribe();

    expect(events).toEqual([`game:0`, `game:1`, `deleted:${created.game.id}`]);
  });

  it('lists newest activity first and deletes games', () => {
    const store = new GameStore();
    const first = store.create({ as: 'none', name: 'First', kind: 'human' });
    const second = store.create({ as: 'none', name: 'Second', kind: 'human' });

    store.move(first.game.id, 'e4');
    const listed = store.list();
    expect(listed[0]?.id).toBe(first.game.id);
    expect(listed).toHaveLength(2);

    store.delete(first.game.id);
    expect(store.list().map((game) => game.id)).toEqual([second.game.id]);
    expect(() => store.get(first.game.id)).toThrow(/not found/i);
  });
});
