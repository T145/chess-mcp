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
