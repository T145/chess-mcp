import { useEffect, useRef } from 'react';

import type { MoveRecord, PublicGame } from '../../../src/shared/protocol';
import { movePairs } from '../lib/status';

function MoveCell({ move }: { move: MoveRecord | null }) {
  if (!move) return <span />;
  if (!move.note) return <span className="text-ink">{move.san}</span>;

  return (
    <span
      className="cursor-help border-b border-dotted border-accent/60 text-ink"
      title={move.note}
      aria-label={`${move.san}: ${move.note}`}
    >
      {move.san}
      <span className="ml-0.5 text-accent-strong" aria-hidden>
        •
      </span>
    </span>
  );
}

export function MoveList({ game }: { game: PublicGame }) {
  const rows = movePairs(game.moves);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (game.moves.length > 0) {
      endRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [game.moves.length]);

  return (
    <div className="rounded-xl border border-line bg-[#10151b]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Moves</span>
        <span className="text-[11px] text-muted">{game.moves.length} plies</span>
      </div>
      <div className="scroll-thin h-40 overflow-y-auto px-2 py-1 font-mono text-[13px]">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center font-sans text-xs text-muted">No moves yet.</p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.number}
              className={`grid grid-cols-[2.2rem_1fr_1fr] gap-1 rounded px-1.5 py-0.5 ${
                index === rows.length - 1 ? 'bg-white/4' : ''
              }`}
            >
              <span className="text-muted">{row.number}.</span>
              <MoveCell move={row.white} />
              <MoveCell move={row.black} />
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
