import { useEffect, useRef } from 'react';

import type {
  EngineStatus,
  MoveQuality,
  MoveReview,
  PublicGame,
  ReviewState,
  ReviewSummary
} from '../../../src/shared/protocol';
import { MOVE_QUALITIES } from '../../../src/shared/protocol';
import { formatEval, winProbability } from '../../../src/shared/eval';
import { fenAfterPly, lastBookPly } from '../../../src/shared/openings';
import { QUALITY_STYLES } from '../lib/review';
import { MoveBadge } from './MoveBadge';
import { OpeningLabel } from './OpeningLabel';

interface ReviewPanelProps {
  game: PublicGame;
  state: ReviewState | null;
  engine: EngineStatus | null;
  busy: boolean;
  selectedPly: number | null;
  onStart: () => void;
  onRetryInstall: () => void;
  onSelectPly: (ply: number | null) => void;
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

function AccuracyCard({ color, value }: { color: 'white' | 'black'; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{color}</p>
      <p className="mt-0.5 font-mono text-xl font-semibold text-ink">{value.toFixed(1)}%</p>
      <p className="text-[10px] text-muted">accuracy</p>
    </div>
  );
}

function EvalGraph({
  review,
  selectedPly,
  onSelectPly
}: {
  review: ReviewSummary;
  selectedPly: number | null;
  onSelectPly: (ply: number | null) => void;
}) {
  const last = review.evalGraph.length - 1;
  const xFor = (index: number): number => (last > 0 ? (index / last) * 100 : 0);
  const points = review.evalGraph
    .map((cp, index) => `${xFor(index).toFixed(2)},${(38 - (winProbability(cp) / 100) * 36).toFixed(2)}`)
    .join(' ');
  const active = selectedPly ?? last;

  return (
    <button
      type="button"
      className="block w-full cursor-crosshair rounded-lg border border-line bg-panel-2 text-left"
      aria-label="Evaluation graph. Click to jump to a move."
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
        onSelectPly(Math.max(0, Math.min(last, Math.round(ratio * last))));
      }}
    >
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-20 w-full" aria-hidden="true">
        <line x1="0" y1="20" x2="100" y2="20" stroke="#2a333f" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        <polyline
          points={points}
          fill="none"
          stroke="#98c168"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={xFor(active)}
          y1="2"
          x2={xFor(active)}
          y2="38"
          stroke="rgba(233,238,244,0.35)"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </button>
  );
}

function QualityCounts({ review, color }: { review: ReviewSummary; color: 'white' | 'black' }) {
  const counts = review.counts[color];
  const shown = MOVE_QUALITIES.filter(
    (quality: MoveQuality) => quality !== 'forced' && counts[quality] > 0
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-9 text-[10px] font-bold uppercase tracking-wider text-muted">{color}</span>
      {shown.length === 0 && <span className="text-[11px] text-muted">No notable moves</span>}
      {shown.map((quality) => {
        const style = QUALITY_STYLES[quality];
        return (
          <span
            key={quality}
            className="flex items-center gap-1 rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold"
            title={style.label}
          >
            <MoveBadge quality={quality} size={14} />
            <span className="text-ink">{counts[quality]}</span>
          </span>
        );
      })}
    </div>
  );
}

function ReviewMoveCell({
  move,
  selected,
  onSelect
}: {
  move: MoveReview | undefined;
  selected: boolean;
  onSelect: (ply: number) => void;
}) {
  if (!move) return <span />;

  const style = QUALITY_STYLES[move.quality];
  const best =
    move.bestMoveSan && move.bestMoveSan !== move.san ? ` · best ${move.bestMoveSan}` : '';
  const detail = `${style.label} · ${formatEval(move.evalBeforeCp)} → ${formatEval(move.evalAfterCp)}${best}`;

  return (
    <button
      type="button"
      data-active={selected ? 'true' : undefined}
      title={detail}
      aria-label={`${move.san}, ${detail}`}
      onClick={() => onSelect(move.ply)}
      className={`flex min-w-0 items-center gap-0.5 rounded px-1 py-0.5 text-left font-mono text-[12px] transition-colors ${
        selected ? 'bg-accent/20' : 'hover:bg-white/5'
      }`}
    >
      <span className="flex w-5 shrink-0 items-center justify-start">
        <MoveBadge quality={move.quality} size={14} />
      </span>
      <span className={selected ? 'font-semibold text-accent-strong' : 'text-ink'}>
        {move.san}
      </span>
    </button>
  );
}

/** The complete game, annotated with review labels; click any move to inspect it. */
function ReviewMoveList({
  review,
  selectedPly,
  onSelectPly
}: {
  review: ReviewSummary;
  selectedPly: number | null;
  onSelectPly: (ply: number | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedPly === null) return;
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedPly]);

  const rows: Array<{ number: number; white: MoveReview | undefined; black: MoveReview | undefined }> =
    [];
  for (let index = 0; index < review.moves.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: review.moves[index],
      black: review.moves[index + 1]
    });
  }

  return (
    <div
      ref={listRef}
      className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-line bg-panel-2/60 p-1"
    >
      {rows.map((row) => (
        <div
          key={row.number}
          className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1 rounded px-1 py-0.5"
        >
          <span className="text-[11px] text-muted">{row.number}.</span>
          <ReviewMoveCell
            move={row.white}
            selected={row.white?.ply === selectedPly}
            onSelect={onSelectPly}
          />
          <ReviewMoveCell
            move={row.black}
            selected={row.black?.ply === selectedPly}
            onSelect={onSelectPly}
          />
        </div>
      ))}
    </div>
  );
}

export function ReviewPanel({
  game,
  state,
  engine,
  busy,
  selectedPly,
  onStart,
  onRetryInstall,
  onSelectPly
}: ReviewPanelProps) {
  const review = state?.review ?? null;

  if (review) {
    const bookPlies = review.moves.map((move) => ({
      book: move.quality === 'book',
      opening: move.opening ?? null
    }));
    const bookPly = lastBookPly(bookPlies);
    const openingFen =
      bookPly === null ? null : fenAfterPly(game.initialFen, game.moves, bookPly);

    return (
      <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto p-3 lg:flex-1">
        <div className="grid grid-cols-2 gap-2">
          <AccuracyCard color="white" value={review.accuracy.white} />
          <AccuracyCard color="black" value={review.accuracy.black} />
        </div>

        <div className="space-y-1.5">
          <QualityCounts review={review} color="white" />
          <QualityCounts review={review} color="black" />
        </div>

        {review.opening && (
          <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11px] leading-4">
            <OpeningLabel opening={review.opening} fen={openingFen} />
          </p>
        )}

        <EvalGraph review={review} selectedPly={selectedPly} onSelectPly={onSelectPly} />

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-wider">Moves</h2>
            <span className="text-[10px] text-muted">{review.moves.length} plies</span>
          </div>
          <ReviewMoveList review={review} selectedPly={selectedPly} onSelectPly={onSelectPly} />
        </section>

        <p className="border-t border-line pt-2 text-[10px] text-muted">
          {review.engineName} · depth {review.depth} · {game.id} ·{' '}
          {(review.durationMs / 1_000).toFixed(1)}s
        </p>
      </div>
    );
  }

  const retry = engine?.phase === 'failed' || engine?.phase === 'unavailable';
  const action = retry ? onRetryInstall : onStart;
  const actionLabel =
    engine?.phase === 'installing'
      ? 'Downloading Stockfish…'
      : retry
        ? 'Retry Stockfish setup'
        : state?.phase === 'failed'
          ? 'Retry analysis'
          : 'Analyze game';

  return (
    <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto p-3 text-xs leading-5 text-muted lg:flex-1">
      {engine?.phase === 'installing' && (
        <ProgressBar
          percent={engine.download?.percent ?? 0}
          label={`Downloading ${engine.version ?? 'Stockfish'}`}
        />
      )}

      {state?.phase === 'running' && (
        <ProgressBar
          percent={state.total > 0 ? (state.done / state.total) * 100 : 0}
          label={`Analyzing positions ${state.done}/${state.total}`}
        />
      )}

      {state?.phase === 'queued' && (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
          Review queued{engine?.phase === 'installing' ? ' — waiting for the engine' : ''}. It
          starts automatically.
        </p>
      )}

      {(state?.error ?? engine?.error) && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-red-200">
          {state?.error ?? engine?.error}
        </p>
      )}

      {engine?.phase === 'unavailable' && (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
          No Stockfish binary was found. Restart with downloads enabled, or point the server at a
          local engine with <code className="text-ink">--engine &lt;path&gt;</code>.
        </p>
      )}

      {engine?.phase === 'available' && (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
          {engine.name ?? 'Stockfish'} is ready (depth {engine.depth}). Analyze this game to get
          accuracy, move labels, and an evaluation graph.
        </p>
      )}

      {!engine && (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
          Checking the analysis engine…
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary w-full py-2 text-xs"
        disabled={busy || engine?.phase === 'installing' || state?.phase === 'running'}
        onClick={action}
      >
        {actionLabel}
      </button>
    </div>
  );
}
