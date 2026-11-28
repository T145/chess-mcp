import { useEffect, useRef } from 'react';

import type { MoveQuality, MoveRecord, PublicGame } from '../../../src/shared/protocol';
import { QUALITY_STYLES } from '../lib/review';
import { movePairs } from '../lib/status';
import { MoveBadge } from './MoveBadge';

interface MoveCellProps {
  move: MoveRecord | null;
  ply: number;
  quality: MoveQuality | undefined;
  selected: boolean;
  onSelect: ((ply: number) => void) | undefined;
}

function MoveCell({ move, ply, quality, selected, onSelect }: MoveCellProps) {
  if (!move) return <span />;

  const content = (
    <>
      {quality && <MoveBadge quality={quality} size={13} className="mr-1 align-[-2px]" />}
      <span
        className={
          move.note
            ? 'border-b border-dotted border-accent/60 text-ink'
            : selected
              ? 'font-semibold text-accent-strong'
              : 'text-ink'
        }
      >
        {move.san}
      </span>
      {move.note && (
        <span className="ml-0.5 text-accent-strong" aria-hidden>
          •
        </span>
      )}
    </>
  );

  const label = `${move.san}${quality ? ` (${QUALITY_STYLES[quality].label})` : ''}`;

  if (!onSelect) {
    return (
      <span className="cursor-help" title={move.note} aria-label={move.note ? `${label}: ${move.note}` : label}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`-mx-1 rounded px-1 text-left transition-colors hover:bg-white/10 ${
        selected ? 'bg-accent/15' : ''
      }`}
      title={move.note}
      aria-label={move.note ? `${label}: ${move.note}` : label}
      onClick={() => onSelect(ply)}
    >
      {content}
    </button>
  );
}

interface MoveListProps {
  game: PublicGame;
  /** Move quality keyed by 1-based ply. */
  qualities?: Partial<Record<number, MoveQuality>>;
  selectedPly?: number | null;
  onSelectPly?: (ply: number) => void;
}

export function MoveList({ game, qualities, selectedPly, onSelectPly }: MoveListProps) {
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
              <MoveCell
                move={row.white}
                ply={index * 2 + 1}
                quality={qualities?.[index * 2 + 1]}
                selected={selectedPly === index * 2 + 1}
                onSelect={onSelectPly}
              />
              <MoveCell
                move={row.black}
                ply={index * 2 + 2}
                quality={qualities?.[index * 2 + 2]}
                selected={selectedPly === index * 2 + 2}
                onSelect={onSelectPly}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
