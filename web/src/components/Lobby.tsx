import { useState } from 'react';

import type { Color, PublicGame } from '../../../src/shared/protocol';
import { api } from '../lib/api';
import { mergeGame, useLive } from '../lib/live';
import { getPlayerName, saveIdentity } from '../lib/player';
import { Link, navigate } from '../lib/router';
import {
  activeColor,
  describeStatus,
  resultLabel,
  seatKindLabel,
  seatLabel
} from '../lib/status';
import { ChevronRightIcon, PlusIcon } from './Icons';

function SeatRow({ game, color }: { game: PublicGame; color: Color }) {
  const seat = game.seats[color];
  const active = activeColor(game) === color;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          color === 'white' ? 'bg-slate-100' : 'bg-slate-700 ring-1 ring-slate-500'
        } ${active ? 'live-dot ring-2 ring-accent/50' : ''}`}
        aria-hidden
      />
      <span className="w-10 text-[10px] font-bold uppercase tracking-wider text-muted">{color}</span>
      <span className={`min-w-0 flex-1 truncate ${seat.kind === 'open' ? 'text-muted' : 'font-medium'}`}>
        {seatLabel(seat)}
      </span>
      <span className={`chip ${seat.kind === 'llm' ? 'chip-llm' : seat.kind === 'open' ? 'chip-open' : ''}`}>
        {seatKindLabel(seat)}
      </span>
    </div>
  );
}

interface GameCardProps {
  game: PublicGame;
  onJoin: (game: PublicGame, seat: Color) => void;
  joining: boolean;
}

function GameCard({ game, onJoin, joining }: GameCardProps) {
  const openSeats = (['white', 'black'] as const).filter(
    (color) => game.seats[color].kind === 'open'
  );
  const finished = game.status.phase !== 'playing';
  const result = resultLabel(game);

  return (
    <article className="panel fade-up flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-wide text-muted">{game.id}</span>
        {finished ? (
          <span className="chip">{result ?? 'Finished'}</span>
        ) : (
          <span className="chip chip-llm">{describeStatus(game)}</span>
        )}
      </div>

      <div className="space-y-1.5">
        <SeatRow game={game} color="black" />
        <SeatRow game={game} color="white" />
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2 text-[11px] text-muted">
        <span>
          {game.moves.length} plies
          {game.lastMove ? ` · last ${game.lastMove.san}` : ''}
        </span>
        <span>{new Date(game.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {openSeats.map((seat) => (
          <button
            key={seat}
            type="button"
            className="btn btn-secondary flex-1 py-1.5 text-xs"
            disabled={joining}
            onClick={() => onJoin(game, seat)}
          >
            Join {seat}
          </button>
        ))}
        <Link to={`/game/${game.id}`} className="btn btn-primary flex-1 py-1.5 text-xs">
          {finished ? 'Review' : openSeats.length > 0 ? 'Watch' : 'Open game'}
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

export function Lobby({ onNewGame }: { onNewGame: () => void }) {
  const { games, connected } = useLive();
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = Object.values(games).toSorted((a, b) => b.updatedAt - a.updatedAt);
  const active = sorted.filter((game) => game.status.phase === 'playing').length;

  const join = async (game: PublicGame, seat: Color): Promise<void> => {
    setJoining(game.id);
    setError(null);
    try {
      const result = await api.joinGame(game.id, { name: getPlayerName(), seat });
      saveIdentity(game.id, { seat, token: result.token });
      mergeGame(result.game);
      navigate(`/game/${game.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
      <section className="flex flex-col gap-6 py-10 sm:py-14 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-amber-400'}`} />
            {connected ? 'Live updates connected' : 'Reconnecting…'}
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Play chess with <span className="text-accent-strong">any LLM</span>.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted sm:text-base">
            Create a board, then invite an agent over MCP or a second human in the browser. Watch
            LLM-vs-LLM games move by move — everything runs locally.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm">
            <span className="font-semibold text-ink">{active}</span>{' '}
            <span className="text-muted">live {active === 1 ? 'game' : 'games'}</span>
          </div>
          <button type="button" className="btn btn-primary px-4 py-2.5" onClick={onNewGame}>
            <PlusIcon className="h-4 w-4" />
            New game
          </button>
        </div>
      </section>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Games</h2>
          <span className="text-xs text-muted">{sorted.length} total</span>
        </div>

        {sorted.length === 0 ? (
          <div className="panel flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-3 text-5xl" aria-hidden>
              ♞
            </div>
            <h3 className="text-lg font-semibold">No games yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Create a board as White, Black, or an open hotseat. Then paste the invite prompt into
              your MCP-enabled agent.
            </p>
            <button type="button" className="btn btn-primary mt-5" onClick={onNewGame}>
              <PlusIcon className="h-4 w-4" />
              Create the first game
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onJoin={(target, seat) => void join(target, seat)}
                joining={joining === game.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
