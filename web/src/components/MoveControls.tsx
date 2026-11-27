import { ChevronRightIcon, SkipBackIcon, SkipForwardIcon } from './Icons';

interface MoveControlsProps {
  total: number;
  /** Null means "at the final position". */
  selectedPly: number | null;
  onSelectPly: (ply: number | null) => void;
}

/** Review navigation shown below the move list, like a game viewer toolbar. */
export function MoveControls({ total, selectedPly, onSelectPly }: MoveControlsProps) {
  const at = selectedPly ?? total;
  const atStart = at <= 0;
  const atEnd = at >= total;

  return (
    <div className="space-y-1">
      <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
        {at === 0 ? 'Starting position' : `Move ${at} of ${total}`}
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn btn-secondary flex-1 py-2"
          onClick={() => onSelectPly(0)}
          disabled={atStart}
          aria-label="Start of game"
          title="Start of game"
        >
          <SkipBackIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-1 py-2"
          onClick={() => onSelectPly(Math.max(0, at - 1))}
          disabled={atStart}
          aria-label="Previous move"
          title="Previous move"
        >
          <ChevronRightIcon className="h-4 w-4 rotate-180" />
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-1 py-2"
          onClick={() => onSelectPly(Math.min(total, at + 1))}
          disabled={atEnd}
          aria-label="Next move"
          title="Next move"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-1 py-2"
          onClick={() => onSelectPly(null)}
          disabled={atEnd && selectedPly === null}
          aria-label="End of game"
          title="End of game"
        >
          <SkipForwardIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
