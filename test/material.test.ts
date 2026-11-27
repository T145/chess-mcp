import { describe, expect, it } from 'vitest';

import { readMaterial } from '../src/shared/material.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('readMaterial', () => {
  it('reports no captures at the start of a game', () => {
    const material = readMaterial(START_FEN);

    expect(material.white.captured).toEqual([]);
    expect(material.black.captured).toEqual([]);
    expect(material.white.value).toBe(0);
    expect(material.black.value).toBe(0);
    expect(material.advantage).toBe(0);
  });

  it('counts a captured pawn for the side that took it', () => {
    // 1. e4 d5 2. exd5
    const fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    const moves = [
      { san: 'e4', from: 'e2', to: 'e4', color: 'white' as const },
      { san: 'd5', from: 'd7', to: 'd5', color: 'black' as const },
      { san: 'exd5', from: 'e4', to: 'd5', color: 'white' as const }
    ];

    const material = readMaterial(fen, moves);

    expect(material.white.captured).toEqual(['p']);
    expect(material.white.value).toBe(1);
    expect(material.black.captured).toEqual([]);
    expect(material.advantage).toBe(1);
  });

  it('orders captured pieces by value and sums their points', () => {
    // Black is missing its queen and a pawn.
    const fen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    const material = readMaterial(fen);

    expect(material.white.captured).toEqual(['q']);
    expect(material.white.value).toBe(9);

    const both = readMaterial('rnb1kbnr/ppppppp1/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(both.white.captured).toEqual(['q', 'p']);
    expect(both.white.value).toBe(10);
  });

  it('reports a black advantage when white has lost material', () => {
    // White is missing both rooks (a1 and h1).
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBN1 w kq - 0 1';

    const material = readMaterial(fen);

    expect(material.black.captured).toEqual(['r', 'r']);
    expect(material.black.value).toBe(10);
    expect(material.advantage).toBe(-10);
  });

  it('accounts for promoted pawns instead of counting them as captures', () => {
    // White has an extra queen on a4 and only seven pawns after a7-a8=Q.
    const fen = 'rnbqkbnr/pppppppp/8/8/Q7/8/PPPPPPP1/RNBQKBNR w - - 0 1';
    const moves = [{ san: 'a8=Q', from: 'a7', to: 'a8', color: 'white' as const, promotion: 'q' }];

    const material = readMaterial(fen, moves);

    expect(material.white.captured).toEqual([]);
    expect(material.black.captured).toEqual([]);
    expect(material.advantage).toBe(0);
  });

  it('still counts captures made before a promotion', () => {
    // White promoted on a8 and is also missing the h2 pawn.
    const fen = 'rnbqkbnr/pppppppp/8/8/Q7/8/PPPPPP2/RNBQKBNR w - - 0 1';
    const moves = [{ san: 'a8=Q', from: 'a7', to: 'a8', color: 'white' as const, promotion: 'q' }];

    const material = readMaterial(fen, moves);

    expect(material.black.captured).toEqual(['p']);
    expect(material.black.value).toBe(1);
  });

  it('treats an unreadable FEN as an empty board', () => {
    const material = readMaterial('');

    expect(material.white.captured).toHaveLength(15);
    expect(material.black.captured).toHaveLength(15);
    expect(material.advantage).toBe(0);
  });
});
