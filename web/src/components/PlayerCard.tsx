import type { Color, PublicGame, TimeControlCategory } from '../../../src/shared/protocol';
import type { MaterialPiece } from '../../../src/shared/material';
import { formatClockTime } from '../../../src/shared/timeControl';
import { PieceImage } from '../lib/pieceRenderers';
import { usePieceTheme } from '../lib/pieceThemes';
import { seatKindLabel, seatLabel } from '../lib/status';

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
  /** Remaining clock time in ms, or null for an untimed game. */
  clockMs: number | null;
  clockCategory: TimeControlCategory | null;
  clockActive: boolean;
  isActive: boolean;
  isYou: boolean;
}

export function PlayerCard({
  color,
  game,
  captured,
  advantage,
  clockMs,
  clockCategory,
  clockActive,
  isActive,
  isYou
}: PlayerCardProps) {
  const seat = game.seats[color];
  const theme = usePieceTheme();
  const initial = seatLabel(seat).charAt(0).toUpperCase();
  const chipClass =
    seat.kind === 'llm' ? 'chip chip-llm' : seat.kind === 'open' ? 'chip chip-open' : 'chip';
  const capturedColor: Color = color === 'white' ? 'black' : 'white';
  const label = captured.length > 0 ? `Captured ${capturedLabel(captured)}` : null;
  const lowTime = clockMs !== null && clockMs < 20_000;
  const clockClass = `rounded-md border px-2 py-1 font-mono text-sm font-semibold tabular-nums ${
    lowTime
      ? 'border-danger/50 bg-danger/15 text-red-200'
      : 'border-line bg-panel-2 text-ink'
  } ${clockActive ? 'ring-1 ring-accent/50' : ''}`;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
        isActive ? 'border-accent/50 bg-accent/10' : 'border-line bg-panel'
      }`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
          color === 'white'
            ? 'border-slate-300/30 bg-slate-100 text-slate-900'
            : 'border-slate-500/40 bg-slate-800 text-slate-100'
        }`}
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 leading-tight">
          <span className="truncate text-[13px] font-semibold">{seatLabel(seat)}</span>
          {isYou && (
            <span className="shrink-0 rounded bg-accent/15 px-1 text-[9px] font-bold tracking-wider text-accent-strong">
              YOU
            </span>
          )}
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted">{color}</span>
          <span className={`${chipClass} shrink-0`}>{seatKindLabel(seat)}</span>
        </div>
        <div
          className="mt-0.5 flex min-h-[0.9rem] flex-wrap items-center gap-x-0.5 gap-y-0 text-[13px] leading-none"
          aria-label={label ?? undefined}
          title={label ?? undefined}
        >
          {capturedGlyphs(captured).map(({ key, piece }) => (
            <PieceImage
              key={key}
              theme={theme}
              color={capturedColor}
              kind={piece}
              className="h-3.5 w-3.5"
            />
          ))}
          {advantage > 0 && (
            <span
              className="ml-0.5 text-[11px] font-bold text-accent-strong"
              aria-label={`Material lead ${advantage}`}
            >
              +{advantage}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {clockMs !== null && clockCategory !== null && (
          <span
            className={clockClass}
            aria-label={`${formatClockTime(clockMs, clockCategory)} remaining`}
          >
            {formatClockTime(clockMs, clockCategory)}
          </span>
        )}
        {isActive && (
          <span className="h-2.5 w-2.5 rounded-full bg-accent live-dot" aria-label="to move" />
        )}
      </div>
    </div>
  );
}
