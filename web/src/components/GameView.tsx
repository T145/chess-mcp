import { useCallback, useMemo, useState, type CSSProperties } from 'react';

import type { Color, DrawAction, MoveInput, PublicGame } from '../../../src/shared/protocol';
import { readMaterial } from '../../../src/shared/material';
import { api } from '../lib/api';
import { mergeGame, removeGame, useLive } from '../lib/live';
import {
  getIdentity,
  getPlayerName,
  saveIdentity,
  type PlayerIdentity
} from '../lib/player';
import { Link, navigate } from '../lib/router';
import { activeColor, describeStatus, resultLabel } from '../lib/status';
import { Board } from './Board';
import { CheckIcon, CopyIcon, FlipIcon, FlagIcon, HandshakeIcon, SwapIcon, TrashIcon } from './Icons';
import { InvitePanel } from './InvitePanel';
import { MoveList } from './MoveList';
import { PlayerCard } from './PlayerCard';

const BOARD_FRAME_STYLE: CSSProperties = { maxWidth: 'min(76vh, 680px)' };

function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function drawSeatFor(
  turn: Color,
  drawOffer: Color | null,
  hotseat: boolean,
  action: DrawAction
): Color | undefined {
  if (!hotseat) return undefined;
  if (action === 'offer') return turn;
  return drawOffer ? opposite(drawOffer) : undefined;
}

function statusHint(
  game: PublicGame,
  hotseat: boolean,
  canMove: boolean,
  result: string | null
): string {
  if (game.status.phase !== 'playing') return result ?? 'Game over';
  if (hotseat) return 'Hotseat: move either side';
  return canMove ? 'Your move' : 'Waiting for the opponent';
}

export function GameView({ gameId }: { gameId: string }) {
  const { games, loaded } = useLive();
  const game = games[gameId];

  if (!game) {
    if (!loaded) {
      return (
        <div className="mx-auto max-w-5xl px-4 py-16">
          <div className="h-8 w-52 animate-pulse rounded-lg bg-panel" />
          <div className="mt-6 aspect-square w-full max-w-2xl animate-pulse rounded-2xl bg-panel" />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">Game not found</h1>
        <p className="mt-2 text-sm text-muted">
          The game may have been deleted, or the server was restarted (games are in memory).
        </p>
        <Link to="/" className="btn btn-primary mt-6">
          Back to lobby
        </Link>
      </div>
    );
  }

  return <GameSession key={game.id} game={game} gameId={gameId} />;
}

function GameSession({ game, gameId }: { game: PublicGame; gameId: string }) {
  const [identity, setIdentity] = useState<PlayerIdentity | null>(() => getIdentity(gameId));
  const [orientation, setOrientation] = useState<'white' | 'black'>(
    () => identity?.seat ?? 'white'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(
    async (action: () => Promise<{ game: PublicGame }>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        mergeGame(result.game);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const mySeat = identity?.seat ?? null;
  const hotseat = game.seats.white.kind === 'open' && game.seats.black.kind === 'open';
  const canMove =
    game.status.phase === 'playing' && (mySeat === game.turn || (hotseat && mySeat === null));
  const isSpectator = mySeat === null && !hotseat;
  const turnColor = activeColor(game);
  const topColor: Color = orientation === 'white' ? 'black' : 'white';
  const bottomColor: Color = opposite(topColor);
  const material = useMemo(() => readMaterial(game.fen, game.moves), [game.fen, game.moves]);
  // Colors can only be exchanged before the first move, and only by a seated player.
  const canSwapColors =
    identity !== null && game.status.phase === 'playing' && game.moves.length === 0;

  const makeMove = useCallback(
    (move: MoveInput): void => {
      void run(() => api.move(game.id, move, identity?.token));
    },
    [game.id, identity?.token, run]
  );

  const join = useCallback(
    (seat: Color): void => {
      void run(async () => {
        const result = await api.joinGame(game.id, { name: getPlayerName(), seat });
        const next = { seat, token: result.token };
        saveIdentity(game.id, next);
        setIdentity(next);
        setOrientation(seat);
        return result;
      });
    },
    [game.id, run]
  );

  const swapColors = useCallback((): void => {
    if (!identity) return;
    const { token } = identity;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.swapSeats(game.id, token);
        const next = { seat: result.seat, token };
        saveIdentity(game.id, next);
        setIdentity(next);
        setOrientation(result.seat);
        mergeGame(result.game);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, [game.id, identity]);

  const draw = useCallback(
    (action: DrawAction): void => {
      const seat = drawSeatFor(game.turn, game.drawOffer, hotseat, action);
      void run(() => api.draw(game.id, action, identity?.token, seat));
    },
    [game.drawOffer, game.id, game.turn, hotseat, identity?.token, run]
  );

  const resign = useCallback((): void => {
    if (!window.confirm('Resign this game?')) return;
    void run(() => api.resign(game.id, identity?.token));
  }, [game.id, identity?.token, run]);

  const deleteGame = useCallback((): void => {
    if (!window.confirm('Delete this game for everyone?')) return;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await api.deleteGame(game.id);
        removeGame(game.id);
        navigate('/');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, [game.id]);

  const copyPgn = useCallback(async (): Promise<void> => {
    if (!game.pgn) return;
    try {
      await navigator.clipboard.writeText(game.pgn);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }, [game.pgn]);

  const handleCopyPgn = useCallback((): void => {
    void copyPgn();
  }, [copyPgn]);

  const flipBoard = useCallback((): void => {
    setOrientation((current) => (current === 'white' ? 'black' : 'white'));
  }, []);

  const handleAcceptDraw = useCallback((): void => draw('accept'), [draw]);
  const handleDeclineDraw = useCallback((): void => draw('decline'), [draw]);
  const handleOfferDraw = useCallback((): void => draw('offer'), [draw]);

  const canRespondToDraw = Boolean(
    game.drawOffer && (hotseat || (mySeat !== null && game.drawOffer !== mySeat))
  );
  const myPendingOffer = Boolean(game.drawOffer && mySeat !== null && game.drawOffer === mySeat);
  const result = resultLabel(game);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link to="/" className="btn btn-ghost -ml-2 px-2">
          ← Lobby
        </Link>
        <span className="chip">Game {game.id}</span>
        {hotseat && <span className="chip chip-open">Hotseat</span>}
        {isSpectator && <span className="chip">Spectator</span>}
        {(game.seats.white.kind === 'llm' || game.seats.black.kind === 'llm') && (
          <span className="chip chip-llm">LLM game</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canSwapColors && (
            <button
              type="button"
              className="btn btn-ghost px-2"
              onClick={swapColors}
              disabled={busy}
              title="Swap seats before the first move"
            >
              <SwapIcon className="h-4 w-4" />
              Swap colors
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost px-2"
            onClick={flipBoard}
            title="Flip board"
          >
            <FlipIcon className="h-4 w-4" />
            Flip
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mx-auto w-full" style={BOARD_FRAME_STYLE}>
            <PlayerCard
              color={topColor}
              game={game}
              captured={material[topColor].captured}
              advantage={topColor === 'white' ? material.advantage : -material.advantage}
              isActive={turnColor === topColor}
              isYou={mySeat === topColor}
              isBottom={false}
            />
            <div className="my-2.5">
              <Board
                game={game}
                orientation={orientation}
                canMove={canMove && !busy}
                onMove={makeMove}
              />
            </div>
            <PlayerCard
              color={bottomColor}
              game={game}
              captured={material[bottomColor].captured}
              advantage={bottomColor === 'white' ? material.advantage : -material.advantage}
              isActive={turnColor === bottomColor}
              isYou={mySeat === bottomColor}
              isBottom
            />

            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{describeStatus(game)}</p>
                <p className="text-xs text-muted">{statusHint(game, hotseat, canMove, result)}</p>
              </div>
              {game.status.phase === 'playing' && game.inCheck && (
                <span className="chip chip-open">Check</span>
              )}
              {result && <span className="chip chip-llm">{result}</span>}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Status</p>
                <p className="mt-1 text-sm font-semibold">{describeStatus(game)}</p>
              </div>
              {result && <span className="chip chip-llm">{result}</span>}
            </div>

            {game.drawOffer && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-xs text-amber-100/90">
                  {myPendingOffer
                    ? 'Draw offer sent. Waiting for the opponent.'
                    : `Draw offered by ${game.drawOffer}.`}
                </p>
                {canRespondToDraw && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary flex-1 py-1.5 text-xs"
                      disabled={busy}
                      onClick={handleAcceptDraw}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary flex-1 py-1.5 text-xs"
                      disabled={busy}
                      onClick={handleDeclineDraw}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            )}

            {game.status.phase === 'playing' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(mySeat || hotseat) && (
                  <button
                    type="button"
                    className="btn btn-secondary flex-1 text-xs"
                    disabled={busy || Boolean(game.drawOffer)}
                    onClick={handleOfferDraw}
                  >
                    <HandshakeIcon className="h-4 w-4" />
                    {hotseat ? `Offer draw (${game.turn})` : 'Offer draw'}
                  </button>
                )}
                {mySeat && (
                  <button
                    type="button"
                    className="btn btn-danger text-xs"
                    disabled={busy}
                    onClick={resign}
                  >
                    <FlagIcon className="h-4 w-4" />
                    Resign
                  </button>
                )}
              </div>
            )}

            {game.status.phase !== 'playing' && (
              <p className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
                This game is finished. Start a new one from the lobby to play again.
              </p>
            )}
          </section>

          <MoveList game={game} />

          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1 text-xs"
              disabled={!game.pgn}
              onClick={handleCopyPgn}
            >
              {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              {copied ? 'PGN copied' : 'Copy PGN'}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-2.5 text-xs text-muted hover:text-red-300"
              onClick={deleteGame}
              title="Delete game"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>

          {(game.seats.white.kind === 'open' || game.seats.black.kind === 'open') && (
            <InvitePanel game={game} onJoin={join} joining={busy} />
          )}
        </aside>
      </div>
    </div>
  );
}
