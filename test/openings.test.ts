import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { buildOpeningBook } from '../src/openings/build.js';
import {
  BOOK_HEADER,
  bookContinuations,
  bookForFens,
  bookForMoves,
  bookMoveFor,
  deepestOpening,
  fenAfterPly,
  firstBookDeviationPly,
  isStandardStart,
  lastBookPly,
  lichessAnalysisUrl,
  normalizeFen,
  parseBookText,
  serializeBook,
  type OpeningBook
} from '../src/shared/openings.js';
import type { MoveRecord, OpeningInfo } from '../src/shared/protocol.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function key(fen: string): string {
  const value = normalizeFen(fen);
  if (!value) throw new Error(`bad fen: ${fen}`);
  return value;
}

function replay(sans: readonly string[], start: string = START): string[] {
  const chess = new Chess(start);
  const fens = [chess.fen()];
  for (const san of sans) {
    chess.move(san);
    fens.push(chess.fen());
  }
  return fens;
}

function bookOf(entries: ReadonlyArray<[string, OpeningInfo | null]>): OpeningBook {
  return new Map(entries);
}

describe('opening book positions', () => {
  it('normalizes FENs to their position key', () => {
    expect(normalizeFen(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    expect(normalizeFen('not a fen')).toBeNull();
    expect(normalizeFen('8/8/8/8/8/8/8/8 x - - 0 1')).toBeNull();
    expect(isStandardStart(START)).toBe(true);
    expect(isStandardStart('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(false);
  });

  it('round-trips through the text format', () => {
    const book = bookOf([
      ['k1', { eco: 'B00', name: "King's Pawn Game" }],
      ['k2', null]
    ]);
    const text = serializeBook(book);
    expect(text.startsWith(`${BOOK_HEADER}\n`)).toBe(true);
    expect(parseBookText(text)).toEqual(book);
  });

  it('marks the whole prefix as book and tracks the deepest name', () => {
    const fens = replay(['e4', 'e5', 'Nf3', 'Nc6']);
    const book = bookOf([
      [key(fens[1] as string), { eco: 'B00', name: "King's Pawn Game" }],
      [key(fens[2] as string), { eco: 'C20', name: 'Open Game' }],
      [key(fens[3] as string), null],
      [key(fens[4] as string), { eco: 'C47', name: 'Four Knights Game' }]
    ]);

    const plies = bookForFens(fens, book);
    expect(plies.map((ply) => ply.book)).toEqual([true, true, true, true]);
    expect(plies[0]?.opening?.eco).toBe('B00');
    expect(plies[3]?.opening?.eco).toBe('C47');
    expect(deepestOpening(plies)).toEqual({ eco: 'C47', name: 'Four Knights Game' });
  });

  it('stops labelling at the first position outside the book', () => {
    const fens = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    const book = bookOf([
      [key(fens[1] as string), { eco: 'B00', name: "King's Pawn Game" }],
      [key(fens[2] as string), { eco: 'C20', name: 'Open Game' }]
    ]);

    const plies = bookForFens(fens, book);
    expect(plies.map((ply) => ply.book)).toEqual([true, true, false, false, false]);
    expect(plies[3]?.opening).toBeNull();
    expect(deepestOpening(plies)?.eco).toBe('C20');
  });

  it('recognises the same position reached by different move orders', () => {
    const sicilian = replay(['e4', 'c5', 'Nf3']);
    const reversed = replay(['Nf3', 'c5', 'e4']);
    const shared = key(sicilian[3] as string);
    expect(shared).toBe(key(reversed[3] as string));

    const book = bookOf([
      [key(sicilian[1] as string), { eco: 'B00', name: "King's Pawn Game" }],
      [key(sicilian[2] as string), { eco: 'B20', name: 'Sicilian Defense' }],
      [key(reversed[1] as string), { eco: 'A04', name: 'Zukertort Opening' }],
      [key(reversed[2] as string), { eco: 'B20', name: 'Sicilian Defense' }],
      [shared, { eco: 'B27', name: 'Sicilian Defense: Open' }]
    ]);

    const first = bookForFens(sicilian, book);
    const second = bookForFens(reversed, book);
    expect(first.map((ply) => ply.book)).toEqual([true, true, true]);
    expect(second.map((ply) => ply.book)).toEqual([true, true, true]);
    expect(first[2]?.opening).toEqual(second[2]?.opening);
    expect(first[2]?.opening?.eco).toBe('B27');
  });

  it('never labels a game that does not start from the standard position', () => {
    const endgame = '7k/8/8/8/8/8/8/K7 w - - 0 1';
    const fens = replay(['Kb2'], endgame);
    const book = bookOf([[key(fens[1] as string), { eco: 'A00', name: 'Test' }]]);
    expect(bookForFens(fens, book)).toEqual([{ book: false, opening: null }]);
  });

  it('produces the same labels from moves as from FENs', () => {
    const fens = replay(['e4', 'e5']);
    const book = bookOf([
      [key(fens[1] as string), { eco: 'B00', name: "King's Pawn Game" }],
      [key(fens[2] as string), { eco: 'C20', name: 'Open Game' }]
    ]);
    const moves: MoveRecord[] = [
      { san: 'e4', from: 'e2', to: 'e4', color: 'white' },
      { san: 'e5', from: 'e7', to: 'e5', color: 'black' }
    ];
    expect(bookForMoves(START, moves, book)).toEqual(bookForFens(fens, book));
    expect(bookForMoves(START, [], book)).toEqual([]);
  });
});

describe('opening book construction', () => {
  const sources = [
    {
      name: 'a.tsv',
      text: [
        'eco\tname\tpgn',
        "B00\tKing's Pawn Game\t1. e4",
        'C20\tKing\u2019s Pawn Game\t1. e4 e5',
        'C60\tRuy Lopez\t1. e4 e5 2. Nf3 Nc6 3. Bb5',
        'D00\tQueen\u2019s Pawn Game\t1. d4 d5',
        ''
      ].join('\n')
    }
  ];

  it('indexes every prefix of every line and names the final positions', () => {
    const book = buildOpeningBook(sources);
    const fens = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);

    expect(book.get(key(fens[1] as string))).toEqual({
      eco: 'B00',
      name: "King's Pawn Game"
    });
    expect(book.get(key(fens[2] as string))).toEqual({
      eco: 'C20',
      name: 'King\u2019s Pawn Game'
    });
    // Intermediate positions of the Ruy Lopez line are book, but unnamed.
    expect(book.has(key(fens[3] as string))).toBe(true);
    expect(book.get(key(fens[3] as string))).toBeNull();
    expect(book.get(key(fens[5] as string))).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
    expect(book.get(key(replay(['d4'])[1] as string))).toBeNull();
  });

  it('keeps the first name when two lines reach the same position', () => {
    const book = buildOpeningBook([
      { name: 'a.tsv', text: 'eco\tname\tpgn\nC20\tFirst Name\t1. e4 e5\n' },
      { name: 'b.tsv', text: 'eco\tname\tpgn\nC20\tSecond Name\t1. e4 e5\n' }
    ]);
    expect(book.get(key(replay(['e4', 'e5'])[2] as string))?.name).toBe('First Name');
  });

  it('skips malformed lines instead of throwing', () => {
    const book = buildOpeningBook([
      { name: 'a.tsv', text: 'eco\tname\tpgn\nB00\tBroken\t1. e4 e5 Qh9\n' }
    ]);
    expect(book.size).toBe(0);
  });
});

describe('book continuations', () => {
  const afterE4 = replay(['e4']);
  const afterE4E5 = replay(['e4', 'e5']);
  const afterE4C5 = replay(['e4', 'c5']);
  const afterC5Nf3 = replay(['e4', 'c5', 'Nf3']);
  const afterC5Nc3 = replay(['e4', 'c5', 'Nc3']);

  it('finds the legal moves that stay in the book', () => {
    const book = bookOf([
      [key(afterE4[1] as string), null],
      [key(afterE4E5[2] as string), { eco: 'C20', name: 'Open Game' }],
      [key(afterE4C5[2] as string), { eco: 'B20', name: 'Sicilian Defense' }]
    ]);

    const continuations = bookContinuations(afterE4[1] as string, book);
    expect(continuations.map((entry) => entry.san).toSorted()).toEqual(['c5', 'e5']);

    const sicilian = continuations.find((entry) => entry.san === 'c5');
    expect(sicilian?.uci).toBe('c7c5');
    expect(sicilian?.opening).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
  });

  it('returns nothing outside the dataset or for an invalid FEN', () => {
    expect(bookContinuations('not a fen', bookOf([]))).toEqual([]);
    expect(bookMoveFor(afterE4[1] as string, bookOf([]))).toBeNull();
  });

  it('prefers the continuation with the most follow-up theory', () => {
    const book = bookOf([
      [key(afterE4[1] as string), null],
      [key(afterE4E5[2] as string), { eco: 'C20', name: 'Open Game' }],
      [key(afterE4C5[2] as string), { eco: 'B20', name: 'Sicilian Defense' }],
      [key(afterC5Nf3[3] as string), { eco: 'B27', name: 'Sicilian Defense: Open' }],
      [key(afterC5Nc3[3] as string), { eco: 'B23', name: 'Sicilian Defense: Closed' }]
    ]);

    expect(bookMoveFor(afterE4[1] as string, book)?.san).toBe('c5');
  });

  it('returns the only continuation', () => {
    const book = bookOf([[key(afterE4E5[2] as string), { eco: 'C20', name: 'Open Game' }]]);
    expect(bookMoveFor(afterE4[1] as string, book)?.san).toBe('e5');
  });
});

describe('book deviation', () => {
  it('reports the first ply that leaves the book', () => {
    expect(firstBookDeviationPly([])).toBeNull();
    expect(firstBookDeviationPly([{ book: true, opening: null }])).toBeNull();
    expect(
      firstBookDeviationPly([
        { book: true, opening: null },
        { book: true, opening: null },
        { book: false, opening: null },
        { book: false, opening: null }
      ])
    ).toBe(3);
    expect(firstBookDeviationPly([{ book: false, opening: null }])).toBe(1);
  });
});

describe('opening deep links', () => {
  it('builds a Lichess analysis URL from a FEN', () => {
    expect(lichessAnalysisUrl('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(
      'https://lichess.org/analysis/standard/8/8/8/8/8/8/8/K6k_w_-_-_0_1'
    );
  });

  it('finds the last ply that stayed in book', () => {
    expect(lastBookPly([])).toBeNull();
    expect(lastBookPly([{ book: false, opening: null }])).toBeNull();
    expect(
      lastBookPly([
        { book: true, opening: null },
        { book: true, opening: null },
        { book: false, opening: null }
      ])
    ).toBe(2);
  });

  it('replays moves to the FEN after a ply', () => {
    const fens = replay(['e4', 'e5']);
    const moves = [{ san: 'e4' }, { san: 'e5' }];

    expect(fenAfterPly(START, moves, 0)).toBe(fens[0]);
    expect(fenAfterPly(START, moves, 2)).toBe(fens[2]);
    expect(fenAfterPly(START, moves, 3)).toBeNull();
    expect(fenAfterPly(START, [{ san: 'Qh9' }], 1)).toBeNull();
  });
});
