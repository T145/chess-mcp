import type { Game } from './game.js';
import type { Color, PublicGame } from './shared/protocol.js';

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

export function formatState(game: Game, options: { includePgn?: boolean } = {}): string {
  const state = game.toPublic();
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
    `FEN: ${state.fen}`,
    legalMovesLine(state)
  ];

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
  return (
    `${game.id} | White: ${formatSeat(game, 'white')} | Black: ${formatSeat(game, 'black')} | ` +
    `${describeStatus(game)}${last} | ${game.moves.length} plies`
  );
}

export function formatTokenNotice(color: Color, name: string, token: string): string {
  return [
    `You are ${color} (${name}).`,
    `Seat token: ${token}`,
    'Keep this token secret and pass it as seat_token on every make_move, resign, and draw call.'
  ].join('\n');
}
