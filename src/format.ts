import type { Game, NoteVisibility } from './game.js';
import { formatEval } from './shared/eval.js';
import { MOVE_QUALITIES } from './shared/protocol.js';
import type { Color, PublicGame, ReviewState, ReviewSummary } from './shared/protocol.js';
import { describeTimeControl, formatClockLine } from './shared/timeControl.js';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function describeStatus(game: PublicGame): string {
  const { status } = game;

  if (status.phase === 'playing') {
    return `${capitalize(game.turn)} to move.${game.inCheck ? ' Check!' : ''}`;
  }
  if (status.phase === 'checkmate') {
    return `Checkmate — ${capitalize(status.winner ?? '')} wins.`;
  }
  if (status.phase === 'resigned') {
    return `Resignation — ${capitalize(status.winner ?? '')} wins (${status.reason}).`;
  }
  if (status.phase === 'timeout') {
    return `Timeout — ${capitalize(status.winner ?? '')} wins (${status.reason}).`;
  }
  return `Draw — ${status.reason}.`;
}

export function formatSeat(game: PublicGame, color: Color): string {
  const seat = game.seats[color];
  return seat.kind === 'open' ? 'Open seat' : `${seat.name} (${seat.kind})`;
}

function legalMovesLine(game: PublicGame): string {
  if (game.legalMoves.length === 0) return 'Legal moves: none';
  const shown = game.legalMoves.slice(0, 60);
  const suffix = game.legalMoves.length > shown.length ? ', …' : '';
  return `Legal moves (${game.legalMoves.length}): ${shown.join(', ')}${suffix}`;
}

export interface FormatStateOptions {
  includePgn?: boolean;
  /**
   * Which move notes the text state may contain: `true` for all, `false` for
   * none, or a colour for that player's notes only. Defaults to none, so a view
   * never leaks reasoning unless the caller opted in.
   */
  revealNotes?: NoteVisibility;
}

export function formatState(game: Game, options: FormatStateOptions = {}): string {
  const state = game.toPublic({ revealNotes: options.revealNotes ?? false });
  const lastMove = state.lastMove
    ? `${state.lastMove.san} (${state.lastMove.from}${state.lastMove.to})`
    : 'none';

  const lines = [
    `Game ${state.id}`,
    `White: ${formatSeat(state, 'white')}`,
    `Black: ${formatSeat(state, 'black')}`,
    `Status: ${describeStatus(state)}`,
    `Last move: ${lastMove}`,
    '',
    game.boardAscii(),
    '',
    `FEN: ${state.fen}`
  ];

  if (state.lastMove?.note) {
    lines.push(`Last move note: ${state.lastMove.note}`);
  }

  if (state.clock) {
    lines.push(formatClockLine(state.clock, state.turn, Date.now()));
  }

  lines.push(legalMovesLine(state));

  if (state.drawOffer) {
    lines.push(`Draw offer pending from ${state.drawOffer}.`);
  }

  if (options.includePgn !== false && state.pgn) {
    lines.push('', 'PGN:', state.pgn);
  }

  return lines.join('\n');
}

export function formatGameLine(game: PublicGame): string {
  const last = game.lastMove ? ` | last ${game.lastMove.san}` : '';
  const clock = game.clock ? ` | ${describeTimeControl(game.clock)}` : '';
  return (
    `${game.id} | White: ${formatSeat(game, 'white')} | Black: ${formatSeat(game, 'black')} | ` +
    `${describeStatus(game)}${last}${clock} | ${game.moves.length} plies`
  );
}

export function formatTokenNotice(color: Color, name: string, token: string): string {
  return [
    `You are ${color} (${name}).`,
    `Seat token: ${token}`,
    'Keep this token secret and pass it as seat_token on every make_move, resign, and draw call.'
  ].join('\n');
}

function plyLabel(ply: number, color: Color): string {
  const moveNumber = Math.ceil(ply / 2);
  return color === 'white' ? `${moveNumber}.` : `${moveNumber}...`;
}

const QUALITY_LABELS = {
  book: 'book',
  brilliant: 'brilliant',
  great: 'great',
  best: 'best',
  excellent: 'excellent',
  good: 'good',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  blunder: 'blunder',
  forced: 'forced'
} as const;

function countsLine(review: ReviewSummary, color: Color): string {
  const counts = review.counts[color];
  const parts = MOVE_QUALITIES.filter(
    (quality) => quality !== 'forced' && counts[quality] > 0
  ).map((quality) => `${counts[quality]} ${QUALITY_LABELS[quality]}`);
  return `${capitalize(color)}: ${parts.length > 0 ? parts.join(', ') : 'no notable moves'}`;
}

/** Compact report used by the MCP tool and the terminal. */
export function formatReview(review: ReviewSummary): string {
  const lines = [
    `Review of game ${review.gameId} (${review.engineName}, depth ${review.depth}) in ${(
      review.durationMs / 1_000
    ).toFixed(1)}s`,
    `Accuracy: White ${review.accuracy.white.toFixed(1)}% · Black ${review.accuracy.black.toFixed(1)}%`,
    countsLine(review, 'white'),
    countsLine(review, 'black')
  ];

  const moments = review.moves.filter((move) =>
    ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'].includes(move.quality)
  );
  if (moments.length > 0) {
    lines.push('', 'Key moments:');
    for (const move of moments.slice(0, 25)) {
      const best =
        move.bestMoveSan && move.bestMoveSan !== move.san ? `, best ${move.bestMoveSan}` : '';
      lines.push(
        `  ${plyLabel(move.ply, move.color)} ${move.san} ${move.quality}` +
          ` (${formatEval(move.evalBeforeCp)} → ${formatEval(move.evalAfterCp)}${best})`
      );
    }
    if (moments.length > 25) lines.push(`  … ${moments.length - 25} more`);
  }

  return lines.join('\n');
}

/** Human-readable state for a review that may not be complete yet. */
export function formatReviewState(state: ReviewState): string {
  if (state.phase === 'complete' && state.review) return formatReview(state.review);
  if (state.phase === 'failed') {
    return `Review failed for game ${state.gameId}: ${state.error ?? 'unknown error'}`;
  }
  if (state.phase === 'running' || state.phase === 'queued') {
    const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    return (
      `Review of game ${state.gameId} is ${state.phase === 'queued' ? 'queued' : 'running'} ` +
      `(${state.done}/${state.total} positions, ${percent}%). Call review_game again to wait for it.`
    );
  }
  return `No review yet for game ${state.gameId}. Call review_game to start one.`;
}
