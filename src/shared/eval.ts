/** Centipawn value used for "mate" evaluations in review maths and graphs. */
export const MATE_CP = 10_000;

/** Lichess-style logistic curve: cp (mover POV) to win probability, 0-100. */
export function winProbability(cp: number): number {
  const clamped = Math.max(-2_000, Math.min(2_000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Per-move accuracy from the drop in win probability (Lichess-derived). */
export function accuracyFromWinDrop(winDrop: number): number {
  const drop = Math.max(0, winDrop);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
}

/** Human-readable evaluation, e.g. "+1.20", "-0.35", or "M". */
export function formatEval(cp: number): string {
  if (Math.abs(cp) >= MATE_CP - 100) return cp > 0 ? '+M' : '-M';
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
