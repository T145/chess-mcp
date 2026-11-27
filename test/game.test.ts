import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { Game } from '../src/game.js';
import type { ClockConfig } from '../src/shared/protocol.js';
import { GameStore } from '../src/store.js';

function makeGame(fen?: string): Game {
  return new Game({
    id: 'testgame',
    seats: {
      white: { kind: 'human', name: 'White Player' },
      black: { kind: 'human', name: 'Black Player' }
    },
    ...(fen ? { fen } : {})
  });
}

function timedGame(overrides: Partial<ClockConfig> = {}, now = 0): Game {
  return new Game({
    id: 'timedgame',
    seats: {
      white: { kind: 'human', name: 'White Player' },
      black: { kind: 'human', name: 'Black Player' }
    },
    now,
    clock: {
      category: 'blitz',
      label: '3 + 2',
      baseMs: 180_000,
      incrementMs: 2_000,
      ...overrides
    }
  });
}

describe('Game rules', () => {
  it('detects Fool’s mate and records SAN', () => {
    const game = makeGame();
    game.applyMove('f3');
    game.applyMove('e5');
    game.applyMove('g4');
    const mate = game.applyMove('Qh4#');

    expect(mate.san).toBe('Qh4#');
    expect(game.currentStatus).toEqual({
      phase: 'checkmate',
      winner: 'black',
      reason: 'checkmate'
    });
    expect(() => game.applyMove('Kf2')).toThrow(/game is over/i);
  });

  it('accepts UCI notation and normalizes to SAN', () => {
    const game = makeGame();
    const move = game.applyMove('e2e4');

    expect(move.san).toBe('e4');
    expect(move.from).toBe('e2');
    expect(move.to).toBe('e4');
    expect(game.toPublic().fen).toContain(' b ');
  });

  it('rejects illegal moves with legal options', () => {
    const game = makeGame();
    expect(() => game.applyMove('e5')).toThrow(/Illegal move/);
    expect(() => game.applyMove('e5')).toThrow(/Legal moves:/);
    expect(game.moveCount).toBe(0);
  });

  it('handles castling', () => {
    const game = makeGame();
    for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']) {
      game.applyMove(move);
    }
    expect(game.toPublic().moves.at(-1)?.san).toBe('O-O');
    expect(game.toPublic().moves).toHaveLength(7);
  });

  it('handles en passant', () => {
    const game = makeGame();
    for (const move of ['e4', 'a6', 'e5', 'd5', 'exd6']) {
      game.applyMove(move);
    }
    const last = game.toPublic().moves.at(-1);
    expect(last?.san).toBe('exd6');
    const position = new Chess(game.toPublic().fen);
    expect(position.get('d5')).toBeUndefined();
    expect(position.get('d6')?.type).toBe('p');
  });

  it('handles promotion', () => {
    const game = makeGame('8/P7/8/8/8/8/7k/K7 w - - 0 1');
    const move = game.applyMove('a8=Q');

    expect(move.promotion).toBe('q');
    expect(game.toPublic().fen).toMatch(/^Q7/);
  });

  it('detects insufficient material on an empty board', () => {
    const game = makeGame('7k/8/8/8/8/8/8/K7 w - - 0 1');
    expect(game.currentStatus).toEqual({
      phase: 'draw',
      winner: null,
      reason: 'insufficient material'
    });
    expect(game.legalMoves()).toEqual([]);
  });

  it('supports draw offers and acceptance', () => {
    const game = makeGame();
    game.offerDraw('white');
    expect(game.currentDrawOffer).toBe('white');
    game.acceptDraw('black');
    expect(game.currentStatus).toEqual({
      phase: 'draw',
      winner: null,
      reason: 'agreement'
    });
    expect(game.currentDrawOffer).toBeNull();
  });

  it('clears a draw offer when a move is played', () => {
    const game = makeGame();
    game.offerDraw('white');
    game.applyMove('e4');
    expect(game.toPublic().drawOffer).toBeNull();
  });

  it('supports resignation', () => {
    const game = makeGame();
    game.resign('white');
    expect(game.currentStatus).toEqual({
      phase: 'resigned',
      winner: 'black',
      reason: 'white resigned'
    });
  });

  it('renders a readable ASCII board and PGN', () => {
    const game = makeGame();
    game.applyMove('e4');

    expect(game.boardAscii()).toContain('8 | r n b q k b n r |');
    expect(game.boardAscii()).toContain('a b c d e f g h');
    expect(game.toPublic().pgn).toContain('1. e4');
  });

  it('swaps seats before the first move and refuses afterwards', () => {
    const game = makeGame();

    game.swapSeats();

    expect(game.toPublic().seats.white).toEqual({ kind: 'human', name: 'Black Player' });
    expect(game.toPublic().seats.black).toEqual({ kind: 'human', name: 'White Player' });
    expect(game.toPublic().pgn).toContain('[White "Black Player"]');
    expect(game.toPublic().pgn).toContain('[Black "White Player"]');

    game.applyMove('e4');
    expect(() => game.swapSeats()).toThrow(/before the first move/i);
  });

  it('leaves the PGN result open while the game is running', () => {
    const game = makeGame();
    game.applyMove('e4');

    expect(game.toPublic().pgn).toContain('[Result "*"]');
    expect(game.toPublic().pgn.trimEnd()).toMatch(/\*$/);
  });

  it('writes the PGN result when checkmate ends the game', () => {
    const game = makeGame();
    for (const move of ['f3', 'e5', 'g4', 'Qh4#']) {
      game.applyMove(move);
    }

    expect(game.toPublic().pgn).toContain('[Result "0-1"]');
    expect(game.toPublic().pgn.trimEnd()).toMatch(/0-1$/);
  });

  it('writes the PGN result when a player resigns', () => {
    const game = makeGame();
    game.applyMove('e4');
    game.resign('black');

    expect(game.toPublic().pgn).toContain('[Result "1-0"]');
    expect(game.toPublic().pgn.trimEnd()).toMatch(/1-0$/);
  });

  it('writes the PGN result when a draw is agreed', () => {
    const game = makeGame();
    game.applyMove('e4');
    game.applyMove('e5');
    game.offerDraw('white');
    game.acceptDraw('black');

    expect(game.toPublic().pgn).toContain('[Result "1/2-1/2"]');
    expect(game.toPublic().pgn.trimEnd()).toMatch(/1\/2-1\/2$/);
  });

  it('keeps the PGN result across a snapshot round trip', () => {
    const game = makeGame();
    game.applyMove('e4');
    game.resign('white');

    const restored = Game.fromSnapshot(game.toSnapshot());

    expect(restored.currentStatus).toEqual(game.currentStatus);
    expect(restored.toPublic().pgn).toContain('[Result "0-1"]');
    expect(restored.toPublic().pgn.trimEnd()).toMatch(/0-1$/);
  });
});

describe('Game clock', () => {
  it('starts both sides at the base time and runs the side to move', () => {
    const game = timedGame({}, 1_000);

    expect(game.toPublic().clock).toMatchObject({
      whiteMs: 180_000,
      blackMs: 180_000,
      turnStartedAt: 1_000
    });
  });

  it('banks elapsed time and adds the increment after each move', () => {
    const game = timedGame({ baseMs: 60_000, incrementMs: 1_000 }, 0);

    game.applyMove('e4', 5_000);
    expect(game.toPublic().clock).toMatchObject({
      whiteMs: 56_000,
      blackMs: 60_000,
      turnStartedAt: 5_000
    });

    game.applyMove('e5', 8_000);
    expect(game.toPublic().clock).toMatchObject({
      whiteMs: 56_000,
      blackMs: 58_000,
      turnStartedAt: 8_000
    });
  });

  it('flags the side to move when its time expires', () => {
    const game = timedGame({ baseMs: 10_000, incrementMs: 0 }, 0);

    expect(game.settleClock(9_999)).toBe(false);
    expect(() => game.applyMove('e4', 10_000)).toThrow(/game is over/i);

    expect(game.currentStatus).toEqual({
      phase: 'timeout',
      winner: 'black',
      reason: 'white ran out of time'
    });
    expect(game.toPublic().clock?.whiteMs).toBe(0);
    expect(game.toPublic().clock?.turnStartedAt).toBeNull();
    expect(game.toPublic().pgn).toContain('[Result "0-1"]');
  });

  it('stops the clock when the game ends another way', () => {
    const game = timedGame({}, 0);
    for (const [move, at] of [
      ['f3', 1_000],
      ['e5', 2_000],
      ['g4', 3_000],
      ['Qh4#', 4_000]
    ] as const) {
      game.applyMove(move, at);
    }

    expect(game.currentStatus.phase).toBe('checkmate');
    expect(game.toPublic().clock?.turnStartedAt).toBeNull();
    expect(game.toPublic().pgn).toContain('[Result "0-1"]');
  });

  it('caps daily games at their per-move allowance', () => {
    const day = 86_400_000;
    const game = timedGame(
      { category: 'daily', label: '1 day', baseMs: day, incrementMs: day, bankCapMs: day },
      0
    );

    game.applyMove('e4', 10_000);

    expect(game.toPublic().clock?.whiteMs).toBe(day);
  });

  it('saves move notes, cleans them, and writes them as PGN comments', () => {
    const game = makeGame();
    game.applyMove('e4', Date.now(), '  Controls the centre {and d5}\n then Nf3 ');

    expect(game.toPublic({ revealNotes: true }).lastMove?.note).toBe(
      'Controls the centre and d5 then Nf3'
    );
    expect(game.toPublic({ revealNotes: true }).pgn).toContain(
      '1. e4 {Controls the centre and d5 then Nf3}'
    );
    expect(game.toPublic({ revealNotes: true }).pgn).toContain('[Result "*"]');
  });

  it('annotates only the moves that carry a note', () => {
    const game = makeGame();
    game.applyMove('e4', Date.now(), '   ');
    game.applyMove('e5');
    game.applyMove('Nf3', Date.now(), 'Develops and eyes e5');

    const all = game.toPublic({ revealNotes: true });
    expect(all.moves.filter((move) => move.note)).toHaveLength(1);
    expect(all.pgn).not.toContain('e4 {');
    expect(all.pgn).toContain('2. Nf3 {Develops and eyes e5}');
  });

  it('caps note length', () => {
    const game = makeGame();
    game.applyMove('e4', Date.now(), 'x'.repeat(700));

    expect(game.toPublic({ revealNotes: true }).lastMove?.note).toHaveLength(500);
  });

  it('hides notes by default and can show a single seat’s notes', () => {
    const game = makeGame();
    game.applyMove('e4', Date.now(), 'White plan');
    game.applyMove('e5', Date.now(), 'Black plan');

    // The default public view carries no reasoning at all.
    const hidden = game.toPublic();
    expect(hidden.moves.map((move) => move.note)).toEqual([undefined, undefined]);
    expect(hidden.lastMove?.note).toBeUndefined();
    expect(hidden.pgn).not.toContain('White plan');
    expect(hidden.pgn).not.toContain('Black plan');

    // An agent reading as one seat only gets that seat's notes.
    const white = game.toPublic({ revealNotes: 'white' });
    expect(white.moves.map((move) => move.note)).toEqual(['White plan', undefined]);
    expect(white.lastMove?.note).toBeUndefined();
    expect(white.pgn).toContain('1. e4 {White plan}');
    expect(white.pgn).not.toContain('Black plan');

    const black = game.toPublic({ revealNotes: 'black' });
    expect(black.moves.map((move) => move.note)).toEqual([undefined, 'Black plan']);
    expect(black.lastMove?.note).toBe('Black plan');
    expect(black.pgn).not.toContain('White plan');

    // The notes themselves are still stored, so the finished game reveals them.
    game.resign('white');
    expect(game.toPublic({ revealNotes: true }).pgn).toContain('1. e4 {White plan}');
    expect(game.toPublic({ revealNotes: true }).pgn).toContain('e5 {Black plan}');
  });

  it('keeps the clock paused when restoring a game with an open seat', () => {
    const openSeat = { kind: 'open' as const, name: 'Open' };
    const game = new Game({
      id: 'openclock',
      seats: { white: openSeat, black: { kind: 'human', name: 'Taylor' } },
      now: 1_000,
      clock: {
        category: 'rapid',
        label: '10 min',
        baseMs: 600_000,
        incrementMs: 0
      }
    });
    expect(game.toPublic().clock?.turnStartedAt).toBeNull();

    // A stale snapshot from an older server claims the clock was running.
    const snapshot = game.toSnapshot();
    if (!snapshot.clock) throw new Error('expected the game to have a clock');
    snapshot.clock = { ...snapshot.clock, turnStartedAt: 5_000, whiteMs: 590_000 };

    const restored = Game.fromSnapshot(snapshot);

    expect(restored.toPublic().seats.white.kind).toBe('open');
    expect(restored.toPublic().clock?.turnStartedAt).toBeNull();
    expect(restored.toPublic().clock?.whiteMs).toBe(590_000);
    expect(restored.settleClock(9_999_999)).toBe(false);
    expect(restored.currentStatus.phase).toBe('playing');
  });

  it('resumes the clock when restoring a fully seated game', () => {
    const game = timedGame({}, 1_000);
    const restored = Game.fromSnapshot(game.toSnapshot());

    expect(restored.toPublic().clock?.turnStartedAt).not.toBeNull();
  });

  it('keeps a solo mover’s clock paused until the opponent sits down', () => {
    const store = new GameStore({ autoTick: false });
    const created = store.create({
      as: 'white',
      name: 'Alice',
      kind: 'human',
      timeControl: { category: 'rapid', label: '10 min', baseMs: 600_000, incrementMs: 0 }
    });
    const { id } = created.game;

    store.move(id, 'e4', created.token ?? '');
    const paused = store.getPublic(id);
    expect(paused.turn).toBe('black');
    expect(paused.clock?.turn).toBe('black');
    expect(paused.clock?.turnStartedAt).toBeNull();

    store.join(id, 'black', 'Bob', 'human');
    const running = store.getPublic(id);
    expect(running.clock?.turnStartedAt).not.toBeNull();
    expect(running.clock?.blackMs).toBe(600_000);
    store.dispose();
  });

  it('keeps untimed games without a clock', () => {
    expect(makeGame().toPublic().clock).toBeNull();
  });
});
