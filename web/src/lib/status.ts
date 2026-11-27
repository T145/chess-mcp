import type { Color, PublicGame, PublicSeat } from '../../../src/shared/protocol';

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function describeStatus(game: PublicGame): string {
  const { status } = game;
  if (status.phase === 'playing') {
    return `${capitalize(game.turn)} to move${game.inCheck ? ' — check!' : ''}`;
  }
  if (status.phase === 'checkmate') {
    return `Checkmate — ${capitalize(status.winner ?? '')} wins`;
  }
  if (status.phase === 'resigned') {
    return `Resignation — ${capitalize(status.winner ?? '')} wins`;
  }
  if (status.phase === 'timeout') {
    return `Timeout — ${capitalize(status.winner ?? '')} wins`;
  }
  return `Draw — ${status.reason}`;
}

export function isFinished(game: PublicGame): boolean {
  return game.status.phase !== 'playing';
}

export function seatLabel(seat: PublicSeat): string {
  if (seat.kind === 'open') return 'Open seat';
  return seat.name;
}

export function seatKindLabel(seat: PublicSeat): string {
  if (seat.kind === 'llm') return 'LLM';
  if (seat.kind === 'human') return 'Human';
  return 'Open';
}

export function resultLabel(game: PublicGame): string | null {
  if (game.status.phase === 'playing') return null;
  if (
    game.status.phase === 'checkmate' ||
    game.status.phase === 'resigned' ||
    game.status.phase === 'timeout'
  ) {
    return `${capitalize(game.status.winner ?? '')} wins`;
  }
  return 'Draw';
}

export function movePairs(moves: PublicGame['moves']): Array<{
  number: number;
  white: PublicGame['moves'][number] | null;
  black: PublicGame['moves'][number] | null;
}> {
  const rows: Array<{
    number: number;
    white: PublicGame['moves'][number] | null;
    black: PublicGame['moves'][number] | null;
  }> = [];
  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: moves[index] ?? null,
      black: moves[index + 1] ?? null
    });
  }
  return rows;
}

export function activeColor(game: PublicGame): Color | null {
  return game.status.phase === 'playing' ? game.turn : null;
}
