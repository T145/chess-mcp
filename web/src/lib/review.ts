import type { MoveQuality, ReviewSummary } from '../../../src/shared/protocol';

export interface QualityStyle {
  symbol: string;
  label: string;
  className: string;
}

export const QUALITY_STYLES: Record<MoveQuality, QualityStyle> = {
  brilliant: { symbol: '!!', label: 'Brilliant', className: 'text-cyan-300' },
  great: { symbol: '!', label: 'Great', className: 'text-sky-300' },
  best: { symbol: '★', label: 'Best', className: 'text-emerald-300' },
  excellent: { symbol: '✓', label: 'Excellent', className: 'text-emerald-200/80' },
  good: { symbol: '', label: 'Good', className: 'text-ink' },
  inaccuracy: { symbol: '?!', label: 'Inaccuracy', className: 'text-amber-300' },
  mistake: { symbol: '?', label: 'Mistake', className: 'text-orange-300' },
  blunder: { symbol: '??', label: 'Blunder', className: 'text-red-400' },
  forced: { symbol: '', label: 'Forced', className: 'text-muted' }
};

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
