import { formatEval, winProbability } from '../../../src/shared/eval';

interface EvalBarProps {
  /** White-POV evaluation in centipawns. */
  cp: number;
  orientation: 'white' | 'black';
  /** Height in pixels; the bar plus its label match the board. */
  height: number;
}

/** Vertical evaluation bar, white advantage growing from White's side. */
export function EvalBar({ cp, orientation, height }: EvalBarProps) {
  const whitePercent = Math.max(0, Math.min(100, winProbability(cp)));
  const whiteAtBottom = orientation === 'white';
  const label = formatEval(cp);
  const barHeight = Math.max(0, height - 18);

  return (
    <div
      className="flex shrink-0 flex-col items-center"
      style={{ height }}
      title={`Evaluation ${label}`}
    >
      <div
        className="relative w-5 overflow-hidden rounded-[2px] border border-line bg-slate-900"
        style={{ height: barHeight }}
      >
        <div
          className={`absolute inset-x-0 bg-slate-100 transition-[height] duration-300 ${
            whiteAtBottom ? 'bottom-0' : 'top-0'
          }`}
          style={{ height: `${whitePercent}%` }}
        />
        <div className="absolute inset-x-0 top-1/2 h-px bg-accent/70" aria-hidden />
      </div>
      <span className="mt-0.5 font-mono text-[9px] font-bold leading-none text-ink">{label}</span>
    </div>
  );
}
