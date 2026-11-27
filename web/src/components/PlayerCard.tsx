import type { Color, PublicGame } from '../../../src/shared/protocol';
import { seatKindLabel, seatLabel } from '../lib/status';

interface PlayerCardProps {
  color: Color;
  game: PublicGame;
  isActive: boolean;
  isYou: boolean;
  isBottom: boolean;
}

export function PlayerCard({ color, game, isActive, isYou, isBottom }: PlayerCardProps) {
  const seat = game.seats[color];
  const initial = seatLabel(seat).charAt(0).toUpperCase();
  const chipClass =
    seat.kind === 'llm' ? 'chip chip-llm' : seat.kind === 'open' ? 'chip chip-open' : 'chip';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        isActive ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel'
      } ${isBottom ? '' : 'order-first'}`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
          color === 'white'
            ? 'border-slate-300/30 bg-slate-100 text-slate-900'
            : 'border-slate-500/40 bg-slate-800 text-slate-100'
        }`}
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{seatLabel(seat)}</span>
          {isYou && <span className="text-[10px] font-bold tracking-wider text-accent-strong">YOU</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted">
            {color}
          </span>
          <span className={chipClass}>{seatKindLabel(seat)}</span>
        </div>
      </div>
      {isActive && <span className="h-2.5 w-2.5 rounded-full bg-accent live-dot" aria-label="to move" />}
    </div>
  );
}
