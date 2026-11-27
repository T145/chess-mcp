import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { Game } from '../src/game.js';

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
});
