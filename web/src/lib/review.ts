import type { MoveQuality, ReviewSummary } from '../../../src/shared/protocol';

export interface QualityStyle {
  symbol: string;
  label: string;
  className: string;
  /** Chess.com's published badge filename, relative to BADGE_ROOT. */
  badge: string;
  /** Chess.com's board highlight for the from/to squares (80% alpha). */
  highlight: string;
}

export const QUALITY_STYLES: Record<MoveQuality, QualityStyle> = {
  book: {
    symbol: '',
    label: 'Book',
    className: 'text-[#d5a47d]',
    badge: 'classification-book.svg',
    // Chess.com's book badge is #D5A47D; the board uses the same tone at 80%.
    highlight: 'rgba(213, 164, 125, 0.8)'
  },
  brilliant: {
    symbol: '!!',
    label: 'Brilliant',
    className: 'text-cyan-300',
    badge: 'classification-brilliant.svg',
    highlight: 'rgba(27, 172, 166, 0.8)'
  },
  great: {
    symbol: '!',
    label: 'Great',
    className: 'text-sky-300',
    badge: 'classification-great-find.svg',
    highlight: 'rgba(92, 139, 176, 0.8)'
  },
  best: {
    symbol: '★',
    label: 'Best',
    className: 'text-emerald-300',
    badge: 'classification-best.svg',
    highlight: 'rgba(151, 189, 77, 0.8)'
  },
  excellent: {
    symbol: '✓',
    label: 'Excellent',
    className: 'text-emerald-200/80',
    badge: 'classification-excellent.svg',
    highlight: 'rgba(129, 182, 76, 0.8)'
  },
  good: {
    symbol: '',
    label: 'Good',
    className: 'text-ink',
    badge: 'classification-good.svg',
    highlight: 'rgba(149, 183, 118, 0.8)'
  },
  inaccuracy: {
    symbol: '?!',
    label: 'Inaccuracy',
    className: 'text-amber-300',
    badge: 'classification-inaccuracy.svg',
    highlight: 'rgba(247, 192, 69, 0.8)'
  },
  mistake: {
    symbol: '?',
    label: 'Mistake',
    className: 'text-orange-300',
    badge: 'classification-mistake.svg',
    highlight: 'rgba(229, 143, 42, 0.8)'
  },
  blunder: {
    symbol: '??',
    label: 'Blunder',
    className: 'text-red-400',
    badge: 'classification-blunder.svg',
    highlight: 'rgba(202, 52, 49, 0.8)'
  },
  forced: {
    symbol: '',
    label: 'Forced',
    className: 'text-muted',
    badge: 'classification-forced.svg',
    highlight: 'rgba(129, 182, 76, 0.8)'
  }
};

/**
 * Chess.com serves the move-review badges from its public CDN. The complete set
 * is mirrored into `web/public/badges` so reviews work offline; the SVGs are
 * self-contained (colour and shape baked in).
 */
export const CHESSCOM_BADGE_ROOT = 'https://www.chess.com/bundles/web/images/color-icons';
export const BADGE_ROOT = '/badges';

export function badgeUrl(quality: MoveQuality): string {
  return `${BADGE_ROOT}/${QUALITY_STYLES[quality].badge}`;
}

const BAD_QUALITIES = new Set(['inaccuracy', 'mistake', 'blunder']);

export interface BestMoveArrow {
  from: string;
  to: string;
}

/**
 * The green best-move arrow for a reviewed inaccuracy/mistake/blunder. Returns
 * null when the move was good, or when the engine's choice is the played move.
 */
export function bestMoveArrow(
  review: ReviewSummary | null,
  ply: number | null
): BestMoveArrow | null {
  if (!review || ply === null || ply < 1) return null;
  const move = review.moves[ply - 1];
  if (!move || !BAD_QUALITIES.has(move.quality)) return null;
  if (!move.bestMoveUci || move.bestMoveUci === move.uci) return null;

  const from = move.bestMoveUci.slice(0, 2);
  const to = move.bestMoveUci.slice(2, 4);
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return null;
  return { from, to };
}
