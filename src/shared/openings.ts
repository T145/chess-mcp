import { Chess, DEFAULT_POSITION } from 'chess.js';

import type { MoveRecord, OpeningInfo } from './protocol.js';

/**
 * Position-keyed opening book. Keys are FEN fields 1-4 (placement, side to move,
 * castling rights, en-passant target) with the move counters stripped, so the
 * same position reached by different move orders matches the same entry.
 *
 * A null value means "this position is on a known line but no line ends here":
 * still a book move, just without a name of its own.
 */
export type OpeningBook = ReadonlyMap<string, OpeningInfo | null>;

export interface BookPly {
  /** True while the game follows the book from the initial position. */
  book: boolean;
  /** Deepest named book position at or before this ply. */
  opening: OpeningInfo | null;
}

export const BOOK_FORMAT_VERSION = 1;
export const BOOK_HEADER = `# chess-mcp openings v${BOOK_FORMAT_VERSION}`;

const FEN_PLACEMENT = /^[1-8pnbrqkPNBRQK/]+$/i;
const STANDARD_START = normalizeFen(DEFAULT_POSITION);

/** Reduce a FEN to its position key, or null when it is not a usable FEN. */
export function normalizeFen(fen: string): string | null {
  const parts = fen.trim().split(/\s+/);
  const [placement, turn, castling, enPassant] = parts;
  if (!placement || !turn || !castling || !enPassant) return null;
  if (!FEN_PLACEMENT.test(placement)) return null;
  if (turn !== 'w' && turn !== 'b') return null;
  return `${placement} ${turn} ${castling} ${enPassant}`;
}

/** True for the standard initial position (move counters are ignored). */
export function isStandardStart(fen: string): boolean {
  return normalizeFen(fen) === STANDARD_START;
}

function noBookPlies(count: number): BookPly[] {
  return Array.from({ length: count }, () => ({ book: false, opening: null }));
}

/** The loaded dataset plus the identity recorded on reviews. */
export interface LoadedBook {
  book: OpeningBook;
  /** The upstream commit (or otherwise stable tag) the book was built from. */
  key: string;
}

/** Parse the text produced by {@link serializeBook}. */
export function parseBookText(text: string): OpeningBook {
  const book = new Map<string, OpeningInfo | null>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith('#')) continue;
    const [key, eco, name] = line.split('\t');
    if (!key) continue;
    book.set(key, eco && name ? { eco, name } : null);
  }
  return book;
}

/** Stable text form: one `<key>` or `<key>\t<eco>\t<name>` record per line. */
export function serializeBook(book: OpeningBook): string {
  const lines = [BOOK_HEADER];
  for (const key of [...book.keys()].toSorted()) {
    const entry = book.get(key);
    lines.push(entry ? `${key}\t${entry.eco}\t${entry.name}` : key);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Classify each position after `fens[i]` (so the result is indexed by move).
 * Book recognition is a contiguous prefix: once a position leaves the book,
 * every later ply is treated as out of book even if it transposes back in.
 */
export function bookForFens(fens: readonly string[], book: OpeningBook): BookPly[] {
  const start = fens[0];
  if (!start || !isStandardStart(start)) return noBookPlies(Math.max(0, fens.length - 1));

  const plies: BookPly[] = [];
  let inBook = true;
  let named: OpeningInfo | null = null;

  for (let index = 1; index < fens.length; index += 1) {
    const fen = fens[index];
    const key = fen ? normalizeFen(fen) : null;
    const entry = key ? book.get(key) : undefined;

    if (inBook && entry !== undefined) {
      if (entry) named = entry;
      plies.push({ book: true, opening: named });
    } else {
      inBook = false;
      plies.push({ book: false, opening: null });
    }
  }

  return plies;
}

/** Replay the moves from `initialFen` and classify the resulting positions. */
export function bookForMoves(
  initialFen: string,
  moves: readonly MoveRecord[],
  book: OpeningBook
): BookPly[] {
  if (moves.length === 0) return [];

  let chess: Chess;
  try {
    chess = new Chess(initialFen);
  } catch {
    return noBookPlies(moves.length);
  }

  const fens: string[] = [chess.fen()];
  for (const move of moves) {
    try {
      chess.move(move.san);
    } catch {
      const plies = bookForFens(fens, book);
      while (plies.length < moves.length) plies.push({ book: false, opening: null });
      return plies;
    }
    fens.push(chess.fen());
  }

  return bookForFens(fens, book);
}

/** The most advanced opening named anywhere in the game. */
export function deepestOpening(plies: readonly BookPly[]): OpeningInfo | null {
  for (let index = plies.length - 1; index >= 0; index -= 1) {
    const opening = plies[index]?.opening;
    if (opening) return opening;
  }
  return null;
}

/**
 * 1-based ply of the first move that leaves the book, or null when the game
 * stayed in theory. Only the first deviation counts: once out of book, later
 * moves are not "leaving theory" again.
 */
export function firstBookDeviationPly(plies: readonly BookPly[]): number | null {
  for (let index = 0; index < plies.length; index += 1) {
    if (plies[index]?.book) continue;
    return index + 1;
  }
  return null;
}

export interface BookContinuation {
  uci: string;
  san: string;
  /** Opening name of the resulting position, when the dataset names it. */
  opening: OpeningInfo | null;
  /** Position after the move; already verified to be in the book. */
  fenAfter: string;
}

/**
 * Every legal move from `fen` whose resulting position is in the book. This is
 * how the app knows which move theory expects at a given position.
 */
export function bookContinuations(fen: string, book: OpeningBook): BookContinuation[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }

  const continuations: BookContinuation[] = [];

  for (const move of chess.moves({ verbose: true })) {
    const played = chess.move(move.san);
    const after = chess.fen();
    const key = normalizeFen(after);
    const entry = key ? book.get(key) : undefined;
    chess.undo();

    if (entry !== undefined) {
      continuations.push({
        uci: `${played.from}${played.to}${played.promotion ?? ''}`,
        san: played.san,
        opening: entry,
        fenAfter: after
      });
    }
  }

  return continuations;
}

/** How much follow-up theory a continuation leads to (a popularity proxy). */
function followUpTheory(continuation: BookContinuation, book: OpeningBook): number {
  return bookContinuations(continuation.fenAfter, book).length;
}

/** 1-based ply of the last move that stayed in book, or null. */
export function lastBookPly(plies: readonly BookPly[]): number | null {
  for (let index = plies.length - 1; index >= 0; index -= 1) {
    if (plies[index]?.book) return index + 1;
  }
  return null;
}

/** FEN after `ply` moves, or null when the ply is out of range or illegal. */
export function fenAfterPly(
  initialFen: string,
  moves: readonly { san: string }[],
  ply: number
): string | null {
  if (ply < 0 || ply > moves.length) return null;
  try {
    const chess = new Chess(initialFen);
    for (let index = 0; index < ply; index += 1) {
      const move = moves[index];
      if (!move) return null;
      chess.move(move.san);
    }
    return chess.fen();
  } catch {
    return null;
  }
}

/**
 * Deep link to the position on Lichess's analysis board. Its opening explorer
 * uses the same dataset as this app, so the opening name and moves line up.
 */
export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/standard/${fen.trim().replaceAll(' ', '_')}`;
}

/**
 * The move theory expects from `fen`, or null when the position has no book
 * continuation. The dataset carries no move frequencies, so among several book
 * moves we prefer a named one, then the branch with the most follow-up theory,
 * then the alphabetically first SAN so the result is deterministic.
 */
export function bookMoveFor(fen: string, book: OpeningBook): BookContinuation | null {
  const options = bookContinuations(fen, book);
  const first = options[0];
  if (!first) return null;
  if (options.length === 1) return first;

  let best = first;
  let bestNamed = first.opening ? 1 : 0;
  let bestWeight = followUpTheory(first, book);

  for (const option of options.slice(1)) {
    const named = option.opening ? 1 : 0;
    const weight = followUpTheory(option, book);
    const better =
      named > bestNamed ||
      (named === bestNamed && weight > bestWeight) ||
      (named === bestNamed && weight === bestWeight && option.san < best.san);

    if (better) {
      best = option;
      bestNamed = named;
      bestWeight = weight;
    }
  }

  return best;
}
