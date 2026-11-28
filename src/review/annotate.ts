import { bookForMoves, deepestOpening, type OpeningBook } from '../shared/openings.js';
import type {
  Color,
  MoveQuality,
  MoveRecord,
  MoveReview,
  ReviewSummary
} from '../shared/protocol.js';
import { emptyCounts } from './classify.js';

export interface BookAnnotationInput {
  review: ReviewSummary;
  initialFen: string;
  moves: readonly MoveRecord[];
  book: OpeningBook;
  /** Dataset identity recorded on the review, e.g. the upstream commit. */
  bookKey: string;
}

/**
 * Recompute the book labels of an existing review without touching its engine
 * data (evaluations, accuracy, best moves). Used to refresh reviews saved before
 * opening detection existed, and to re-label when the dataset changes.
 *
 * `baseQuality` records the engine's verdict for book moves, so removing a line
 * from the dataset restores the original label instead of leaving "book".
 */
export function annotateWithBook(input: BookAnnotationInput): ReviewSummary {
  const { review, moves, book, bookKey } = input;

  if (moves.length !== review.moves.length) return { ...review, book: null };

  const plies = bookForMoves(input.initialFen, moves, book);
  if (plies.length !== review.moves.length) return { ...review, book: null };

  const counts: Record<Color, Record<MoveQuality, number>> = {
    white: emptyCounts(),
    black: emptyCounts()
  };

  const annotated: MoveReview[] = review.moves.map((move, index) => {
    const ply = plies[index];
    // Reviews produced by the very first book build stored "book" without the
    // original label; there is no way to recover it from the stored data.
    const base: MoveQuality =
      move.baseQuality ?? (move.quality === 'book' ? 'excellent' : move.quality);
    const quality: MoveQuality = ply?.book && base !== 'forced' ? 'book' : base;

    counts[move.color][quality] += 1;

    return {
      ...move,
      quality,
      ...(quality === 'book' ? { baseQuality: base } : {}),
      opening: ply?.opening ?? null
    };
  });

  return {
    ...review,
    counts,
    moves: annotated,
    opening: deepestOpening(plies),
    book: bookKey
  };
}
