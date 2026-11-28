import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import type { PositionEval } from '../src/engine/uci.js';
import { annotateWithBook } from '../src/review/annotate.js';
import { buildReview } from '../src/review/classify.js';
import { normalizeFen, type OpeningBook } from '../src/shared/openings.js';
import type { GameStatus, MoveRecord, ReviewSummary } from '../src/shared/protocol.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PLAYING: GameStatus = { phase: 'playing', winner: null, reason: '' };
const SANS = ['e4', 'e5', 'Nf3'];

function key(fen: string): string {
  const value = normalizeFen(fen);
  if (!value) throw new Error(`bad fen: ${fen}`);
  return value;
}

function bestEval(fen: string, uci: string | null): PositionEval {
  return {
    bestMoveUci: uci,
    lines: uci ? [{ multipv: 1, cp: 0, mate: null, pv: [uci], depth: 14, bound: false }] : [],
    depth: 14
  };
}

interface Fixture {
  review: ReviewSummary;
  fens: string[];
  moves: MoveRecord[];
}

/** Build a review with no book: every move is engine-best, accuracy 100. */
function reviewWithoutBook(): Fixture {
  const chess = new Chess(START);
  const fens = [chess.fen()];
  const moves: MoveRecord[] = [];
  const ucis: string[] = [];

  for (const san of SANS) {
    const move = chess.move(san);
    ucis.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    moves.push({
      san,
      from: move.from,
      to: move.to,
      color: move.color === 'w' ? 'white' : 'black'
    });
    fens.push(chess.fen());
  }

  // Analysis i belongs to position i; its best move is the move actually played.
  const analyses = fens.map((fen, index) => bestEval(fen, ucis[index] ?? null));

  const review = buildReview({
    gameId: 'annotate-me',
    initialFen: START,
    moves,
    fens,
    analyses,
    finalStatus: PLAYING,
    engineName: 'Fakefish',
    depth: 14,
    durationMs: 1,
    now: 1
  });

  return { review, fens, moves };
}

function bookFor(fens: readonly string[]): OpeningBook {
  return new Map([
    [key(fens[1] as string), { eco: 'B00', name: "King's Pawn Game" }],
    [key(fens[2] as string), { eco: 'C20', name: 'Open Game' }],
    [key(fens[3] as string), { eco: 'C44', name: "King's Knight Opening" }]
  ]);
}

describe('annotateWithBook', () => {
  it('turns engine labels into book labels and records the base verdict', () => {
    const { review, fens, moves } = reviewWithoutBook();
    expect(review.moves.map((move) => move.quality)).toEqual(['best', 'best', 'best']);
    expect(review.book).toBeNull();

    const annotated = annotateWithBook({
      review,
      initialFen: START,
      moves,
      book: bookFor(fens),
      bookKey: 'commit-1'
    });

    expect(annotated.moves.map((move) => move.quality)).toEqual(['book', 'book', 'book']);
    expect(annotated.moves.map((move) => move.baseQuality)).toEqual(['best', 'best', 'best']);
    expect(annotated.counts.white.book).toBe(2);
    expect(annotated.counts.black.book).toBe(1);
    expect(annotated.counts.white.best).toBe(0);
    expect(annotated.opening).toEqual({ eco: 'C44', name: "King's Knight Opening" });
    expect(annotated.book).toBe('commit-1');
    // Engine data is untouched.
    expect(annotated.accuracy).toEqual(review.accuracy);
    expect(annotated.evalGraph).toEqual(review.evalGraph);
    expect(annotated.moves[0]?.bestMoveUci).toBe(review.moves[0]?.bestMoveUci);
  });

  it('is idempotent for the same dataset', () => {
    const { review, fens, moves } = reviewWithoutBook();
    const book = bookFor(fens);
    const once = annotateWithBook({ review, initialFen: START, moves, book, bookKey: 'c1' });
    const twice = annotateWithBook({ review: once, initialFen: START, moves, book, bookKey: 'c1' });
    expect(twice.moves).toEqual(once.moves);
    expect(twice.counts).toEqual(once.counts);
  });

  it('restores the engine label when a line leaves the dataset', () => {
    const { review, fens, moves } = reviewWithoutBook();
    const annotated = annotateWithBook({
      review,
      initialFen: START,
      moves,
      book: bookFor(fens),
      bookKey: 'c1'
    });

    const smaller = new Map([[key(fens[1] as string), { eco: 'B00', name: "King's Pawn Game" }]]);
    const reduced = annotateWithBook({
      review: annotated,
      initialFen: START,
      moves,
      book: smaller,
      bookKey: 'c2'
    });

    expect(reduced.moves.map((move) => move.quality)).toEqual(['book', 'best', 'best']);
    expect(reduced.counts.white.book).toBe(1);
    expect(reduced.counts.black.best).toBe(1);
    expect(reduced.book).toBe('c2');
  });

  it('refuses to annotate a review that does not match the game', () => {
    const { review, fens } = reviewWithoutBook();
    const annotated = annotateWithBook({
      review,
      initialFen: START,
      moves: [],
      book: bookFor(fens),
      bookKey: 'c1'
    });
    expect(annotated.book).toBeNull();
    expect(annotated.moves).toEqual(review.moves);
  });
});
