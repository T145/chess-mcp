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
  const listRef = useRef<HTMLDivElement>(null);
  const hasAgent = game.seats.white.kind === 'llm' || game.seats.black.kind === 'llm';
  // The server withholds move notes until the game is over; say so instead of
  // leaving the dotted annotations a mystery.
  const notesHidden = hasAgent && game.status.phase === 'playing';

  useEffect(() => {
    const list = listRef.current;
    if (!list || game.moves.length === 0) return;
    list.scrollTop = list.scrollHeight;
  }, [game.moves.length]);

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {notesHidden && (
        <p className="shrink-0 border-b border-line px-3 py-1.5 text-[11px] leading-4 text-muted">
          Move notes are hidden until the game ends.
        </p>
      )}
      <div
        ref={listRef}
        className="scroll-thin h-56 overflow-y-auto px-2 py-1 font-mono text-[13px] lg:h-auto lg:min-h-0 lg:flex-1"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center font-sans text-xs text-muted">No moves yet.</p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.number}
              className={`grid grid-cols-[2.2rem_1fr_1fr] gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 ${
                index === rows.length - 1 ? 'bg-white/6' : ''
              }`}
            >
              <span className="text-muted">{row.number}.</span>
              <MoveCell move={row.white} />
              <MoveCell move={row.black} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
