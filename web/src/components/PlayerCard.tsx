import type { Color, PublicGame } from '../../../src/shared/protocol';
import type { MaterialPiece } from '../../../src/shared/material';
import { seatKindLabel, seatLabel } from '../lib/status';

const PIECE_GLYPHS: Record<Color, Record<MaterialPiece, string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

const PIECE_NAMES: Record<MaterialPiece, string> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn'
};

function capturedLabel(pieces: MaterialPiece[]): string {
  const counts = new Map<MaterialPiece, number>();
  for (const piece of pieces) counts.set(piece, (counts.get(piece) ?? 0) + 1);
  return [...counts]
    .map(([piece, count]) => `${count} ${PIECE_NAMES[piece]}${count === 1 ? '' : 's'}`)
    .join(', ');
}

/** Stable keys for repeated piece glyphs without relying on array indexes. */
function capturedGlyphs(pieces: MaterialPiece[]): Array<{ key: string; piece: MaterialPiece }> {
  const seen = new Map<MaterialPiece, number>();
  return pieces.map((piece) => {
    const occurrence = (seen.get(piece) ?? 0) + 1;
    seen.set(piece, occurrence);
    return { key: `${piece}${occurrence}`, piece };
  });
}

interface PlayerCardProps {
  color: Color;
  game: PublicGame;
  /** Pieces this player has captured, most valuable first. */
  captured: MaterialPiece[];
  /** This player's net material lead in pawns; only shown when positive. */
  advantage: number;
  isActive: boolean;
  isYou: boolean;
  isBottom: boolean;
}

export function PlayerCard({
  color,
  game,
  captured,
  advantage,
  isActive,
  isYou,
  isBottom
}: PlayerCardProps) {
  const seat = game.seats[color];
  const initial = seatLabel(seat).charAt(0).toUpperCase();
  const chipClass =
    seat.kind === 'llm' ? 'chip chip-llm' : seat.kind === 'open' ? 'chip chip-open' : 'chip';
  const capturedColor: Color = color === 'white' ? 'black' : 'white';
  const label = captured.length > 0 ? `Captured ${capturedLabel(captured)}` : null;

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
        <div className="mt-1 flex min-h-[1.1rem] flex-wrap items-center gap-1" aria-label={label ?? undefined}>
          {capturedGlyphs(captured).map(({ key, piece }) => (
            <span
              key={key}
              className={`text-base leading-none ${
                capturedColor === 'white' ? 'text-slate-100' : 'text-slate-400'
              }`}
              aria-hidden
            >
              {PIECE_GLYPHS[capturedColor][piece]}
            </span>
          ))}
          {advantage > 0 && (
            <span className="ml-0.5 text-[11px] font-bold text-accent-strong" aria-label={`Material lead ${advantage}`}>
              +{advantage}
            </span>
          )}
        </div>
      </div>
      {isActive && <span className="h-2.5 w-2.5 rounded-full bg-accent live-dot" aria-label="to move" />}
    </div>
  );
}
