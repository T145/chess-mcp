import { Chess } from 'chess.js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type {
  Color,
  DrawAction,
  MoveInput,
  MoveQuality,
  PublicGame
} from '../../../src/shared/protocol';
import { readMaterial } from '../../../src/shared/material';
import { describeTimeControl, remainingMs } from '../../../src/shared/timeControl';
import { api } from '../lib/api';
import { mergeEngine, mergeGame, mergeReview, removeGame, useLive } from '../lib/live';
import {
  getIdentity,
  getPlayerName,
  saveIdentity,
  type PlayerIdentity
} from '../lib/player';
import { Link, navigate } from '../lib/router';
import { bestMoveArrow } from '../lib/review';
import { activeColor, describeStatus, resultLabel, seatLabel } from '../lib/status';
import { Board } from './Board';
import { Dialog } from './Dialog';
import { EvalBar } from './EvalBar';
import {
  CheckIcon,
  CopyIcon,
  FlipIcon,
  FlagIcon,
  HandshakeIcon,
  PlusIcon,
  SwapIcon,
  TrashIcon
} from './Icons';
import { InvitePanel } from './InvitePanel';
import { MoveControls } from './MoveControls';
import { MoveList } from './MoveList';
import { PlayerCard } from './PlayerCard';
import { ReviewPanel } from './ReviewPanel';

type SidePanelTab = 'moves' | 'review' | 'info';

const EVAL_BAR_WIDTH = 28;

/**
 * Measures the free space next to the player cards and returns the largest
 * square that fits inside it, so the board, clocks and move list stay on one
 * screen without scrolling.
 */
function useFitSquare(reserve = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = (width: number, height: number): void => {
      const next = Math.floor(Math.min(Math.max(0, width - reserve), height));
      setSize((current) => (Math.abs(current - next) > 1 ? next : current));
    };
    const bounds = element.getBoundingClientRect();
    measure(bounds.width, bounds.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reserve]);

  return { ref, size };
}

function fenAtPly(game: PublicGame, ply: number): string {
  if (ply <= 0) return new Chess().fen();
  if (ply >= game.moves.length) return game.fen;
  const chess = new Chess();
  for (let index = 0; index < ply; index += 1) {
    const move = game.moves[index];
    if (!move) break;
    chess.move(move.san);
  }
  return chess.fen();
}

function tabClass(active: boolean): string {
  return `relative shrink-0 px-4 py-2.5 text-xs font-semibold transition-colors ${
    active
      ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent'
      : 'text-muted hover:text-ink'
  }`;
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-ink ${mono ? 'font-mono text-[11px]' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

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
  result: string | null,
  isSpectator: boolean
): string {
  if (game.status.phase !== 'playing') return result ?? 'Game over';
  if (hotseat) return 'Hotseat: move either side';
  if (isSpectator) return 'Spectating live';
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
  const { reviews, engine } = useLive();
  const reviewState = reviews[gameId] ?? null;
  const review = reviewState?.review ?? null;
  const [selectedPly, setSelectedPly] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [identity, setIdentity] = useState<PlayerIdentity | null>(() => getIdentity(gameId));
  const [orientation, setOrientation] = useState<'white' | 'black'>(
    () => identity?.seat ?? 'white'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<SidePanelTab>('moves');
  const [inviteOpen, setInviteOpen] = useState(false);
  const evalCp = review
    ? (review.evalGraph[selectedPly ?? review.evalGraph.length - 1] ?? null)
    : null;
  const { ref: boardSlotRef, size: boardSize } = useFitSquare(
    evalCp === null ? 0 : EVAL_BAR_WIDTH
  );

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
  const isReviewing = selectedPly !== null;
  const canMove =
    game.status.phase === 'playing' &&
    !isReviewing &&
    (mySeat === game.turn || (hotseat && mySeat === null));
  const isSpectator = mySeat === null && !hotseat;
  const turnColor = activeColor(game);
  const topColor: Color = orientation === 'white' ? 'black' : 'white';
  const bottomColor: Color = opposite(topColor);
  const displayFen = useMemo(
    () => (isReviewing ? fenAtPly(game, selectedPly) : game.fen),
    [game, isReviewing, selectedPly]
  );
  const displayMoves = useMemo(
    () => (isReviewing ? game.moves.slice(0, selectedPly) : game.moves),
    [game.moves, isReviewing, selectedPly]
  );
  const displayLastMove = isReviewing
    ? selectedPly > 0
      ? (game.moves[selectedPly - 1] ?? null)
      : null
    : game.lastMove;
  const material = useMemo(
    () => readMaterial(displayFen, displayMoves),
    [displayFen, displayMoves]
  );
  const qualities = useMemo(() => {
    const map: Partial<Record<number, MoveQuality>> = {};
    if (review) for (const move of review.moves) map[move.ply] = move.quality;
    return map;
  }, [review]);
  const bestArrow = useMemo(() => bestMoveArrow(review, selectedPly), [review, selectedPly]);
  // Colors can only be exchanged before the first move, and only by a seated player.
  const canSwapColors =
    identity !== null && game.status.phase === 'playing' && game.moves.length === 0;

  // Load a saved review when the finished game page opens, and keep the engine
  // status fresh even if the WebSocket is not available.
  useEffect(() => {
    if (game.status.phase === 'playing') return undefined;
    let active = true;
    void api
      .getReview(game.id)
      .then(({ review: loaded }) => {
        if (active) mergeReview(loaded);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [game.id, game.status.phase]);

  useEffect(() => {
    if (engine) return undefined;
    let active = true;
    void api
      .getEngine()
      .then(({ engine: loaded }) => {
        if (active) mergeEngine(loaded);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [engine]);

  // Tick locally between server updates so the running clock counts down; the
  // server remains the authority on flag falls.
  const clock = game.clock;
  const clockRunning = clock !== null && game.status.phase === 'playing';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clockRunning) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clockRunning]);

  /** Live clock while playing, or the recorded bank after the reviewed move. */
  const displayClockMs = (color: Color): number | null => {
    const gameClock = game.clock;
    if (!gameClock) return null;
    if (!isReviewing) return remainingMs(gameClock, color, now);
    if (selectedPly === null || selectedPly === 0) return gameClock.baseMs;
    const snapshot = game.moves[selectedPly - 1]?.clocks;
    if (!snapshot) return remainingMs(gameClock, color, now);
    return color === 'white' ? snapshot.whiteMs : snapshot.blackMs;
  };

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

  const analyzeGame = useCallback((): void => {
    setReviewBusy(true);
    setError(null);
    void api
      .startReview(game.id)
      .then(({ review: started }) => {
        mergeReview(started);
        return undefined;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setReviewBusy(false));
  }, [game.id]);

  const retryEngine = useCallback((): void => {
    setReviewBusy(true);
    setError(null);
    void (async () => {
      try {
        const installed = await api.installEngine();
        mergeEngine(installed.engine);
        const queued = await api.startReview(game.id);
        mergeReview(queued.review);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setReviewBusy(false);
      }
    })();
  }, [game.id]);

  const selectPly = useCallback((ply: number | null): void => {
    setSelectedPly(ply);
  }, []);

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
  const openSeatCount =
    (game.seats.white.kind === 'open' ? 1 : 0) + (game.seats.black.kind === 'open' ? 1 : 0);
  // Before the first measurement the board simply fills the column; afterwards
  // the player bars and board share one exact square so they line up. The eval
  // bar is reserved in review mode, and the player cards span the extra width.
  const evalVisible = evalCp !== null;
  const boardFrameStyle = boardSize > 0 ? { width: boardSize } : undefined;
  const cardFrameStyle =
    boardSize > 0 ? { width: boardSize + (evalVisible ? EVAL_BAR_WIDTH : 0) } : undefined;
  const hasAgent = game.seats.white.kind === 'llm' || game.seats.black.kind === 'llm';

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-3 pb-3 pt-2 sm:px-6 lg:pb-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="chip">Game {game.id}</span>
        {game.clock && <span className="chip">{describeTimeControl(game.clock)}</span>}
        {hotseat && <span className="chip chip-open">Hotseat</span>}
        {isSpectator && <span className="chip">Spectator</span>}
        {hasAgent && <span className="chip chip-llm">LLM game</span>}
        {selectedPly !== null && (
          <button
            type="button"
            className="chip chip-llm"
            onClick={() => selectPly(null)}
            title="Exit review navigation"
          >
            Reviewing · exit
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canSwapColors && (
            <button
              type="button"
              className="btn btn-ghost px-2 py-1 text-xs"
              onClick={swapColors}
              disabled={busy}
              title="Swap seats before the first move"
            >
              <SwapIcon className="h-3.5 w-3.5" />
              Swap
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost px-2 py-1 text-xs"
            onClick={flipBoard}
            title="Flip board"
          >
            <FlipIcon className="h-3.5 w-3.5" />
            Flip
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 shrink-0 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="mt-2 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-0 flex-col items-center gap-1.5 lg:h-full">
            <div className="w-full" style={cardFrameStyle}>
              <PlayerCard
                color={topColor}
                game={game}
                captured={material[topColor].captured}
                advantage={topColor === 'white' ? material.advantage : -material.advantage}
                clockMs={displayClockMs(topColor)}
                clockCategory={clock?.category ?? null}
                clockActive={clockRunning && !isReviewing && turnColor === topColor}
                isActive={!isReviewing && turnColor === topColor}
                isYou={mySeat === topColor}
              />
            </div>
            <div
              ref={boardSlotRef}
              className="flex w-full items-center justify-center gap-1.5 lg:min-h-0 lg:flex-1"
            >
              {evalCp !== null && boardSize > 0 && (
                <EvalBar cp={evalCp} orientation={orientation} height={boardSize} />
              )}
              <div className="w-full" style={boardFrameStyle}>
                <Board
                  game={game}
                  orientation={orientation}
                  canMove={canMove && !busy}
                  onMove={makeMove}
                  bestMove={isReviewing ? bestArrow : null}
                  {...(isReviewing
                    ? { position: displayFen, lastMove: displayLastMove }
                    : {})}
                />
              </div>
            </div>
            <div className="w-full" style={cardFrameStyle}>
              <PlayerCard
                color={bottomColor}
                game={game}
                captured={material[bottomColor].captured}
                advantage={bottomColor === 'white' ? material.advantage : -material.advantage}
                clockMs={displayClockMs(bottomColor)}
                clockCategory={clock?.category ?? null}
                clockActive={clockRunning && !isReviewing && turnColor === bottomColor}
                isActive={!isReviewing && turnColor === bottomColor}
                isYou={mySeat === bottomColor}
              />
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-2.5">
          <div className="panel flex flex-col overflow-hidden lg:min-h-0 lg:flex-1">
            <div className="flex shrink-0 items-stretch border-b border-line">
              <button
                type="button"
                aria-pressed={tab === 'moves'}
                className={tabClass(tab === 'moves')}
                onClick={() => setTab('moves')}
              >
                Moves
              </button>
              {game.status.phase !== 'playing' && (
                <button
                  type="button"
                  aria-pressed={tab === 'review'}
                  className={tabClass(tab === 'review')}
                  onClick={() => setTab('review')}
                >
                  Review
                  {review && (
                    <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent-strong">
                      ✓
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                aria-pressed={tab === 'info'}
                className={tabClass(tab === 'info')}
                onClick={() => setTab('info')}
              >
                Info
                {openSeatCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent-strong">
                    {openSeatCount}
                  </span>
                )}
              </button>
              <span className="ml-auto self-center pr-3 text-[11px] text-muted">
                {game.moves.length} plies
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{describeStatus(game)}</p>
                <p className="truncate text-[11px] text-muted">
                  {statusHint(game, hotseat, canMove, result, isSpectator)}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {game.status.phase === 'playing' && game.inCheck && (
                  <span className="chip chip-open">Check</span>
                )}
                {result && <span className="chip chip-llm">{result}</span>}
              </div>
            </div>

            {game.drawOffer && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="min-w-0 flex-1 text-[11px] leading-4 text-amber-100/90">
                  {myPendingOffer
                    ? 'Draw offer sent. Waiting for the opponent.'
                    : `Draw offered by ${game.drawOffer}.`}
                </p>
                {canRespondToDraw && (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary px-2.5 py-1 text-[11px]"
                      disabled={busy}
                      onClick={handleAcceptDraw}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary px-2.5 py-1 text-[11px]"
                      disabled={busy}
                      onClick={handleDeclineDraw}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'moves' ? (
              <MoveList
                game={game}
                qualities={qualities}
                selectedPly={selectedPly}
                onSelectPly={game.status.phase !== 'playing' ? selectPly : undefined}
              />
            ) : tab === 'review' && game.status.phase !== 'playing' ? (
              <ReviewPanel
                game={game}
                state={reviewState}
                engine={engine}
                busy={reviewBusy}
                selectedPly={selectedPly}
                onStart={analyzeGame}
                onRetryInstall={retryEngine}
                onSelectPly={selectPly}
              />
            ) : (
              <div className="scroll-thin min-h-0 space-y-3 overflow-y-auto p-3 text-xs leading-5 text-muted lg:flex-1">
                <section>
                  <h2 className="text-[11px] font-bold uppercase tracking-wider">Game info</h2>
                  <dl className="mt-2 space-y-1.5">
                    <DetailRow label="Game" value={game.id} mono />
                    <DetailRow label="White" value={seatLabel(game.seats.white)} />
                    <DetailRow label="Black" value={seatLabel(game.seats.black)} />
                    <DetailRow
                      label="Time control"
                      value={game.clock ? describeTimeControl(game.clock) : 'Untimed'}
                    />
                    <DetailRow label="Moves" value={`${game.moves.length} plies`} />
                  </dl>
                </section>

                {game.clock && game.clock.turnStartedAt === null && game.status.phase === 'playing' && (
                  <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                    Clock starts once both seats are filled.
                  </p>
                )}

                {game.status.phase !== 'playing' && game.lastMove?.note && (
                  <section className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink">
                      Last move note
                    </p>
                    <p className="mt-1 leading-5">{game.lastMove.note}</p>
                  </section>
                )}

                {game.status.phase !== 'playing' && (
                  <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                    This game is finished. Start a new one from the lobby to play again.
                  </p>
                )}

                {hasAgent && game.status.phase === 'playing' && (
                  <p className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                    Agent reasoning is revealed in the PGN once the game ends.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            {openSeatCount > 0 && (
              <button
                type="button"
                className="btn btn-primary w-full py-2 text-xs"
                disabled={busy}
                onClick={() => setInviteOpen(true)}
              >
                <PlusIcon className="h-4 w-4" />
                Invite a player
              </button>
            )}

            {game.status.phase === 'playing' ? (
              <div className="flex gap-2">
                {(mySeat || hotseat) && (
                  <button
                    type="button"
                    className="btn btn-secondary flex-1 py-1.5 text-xs"
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
                    className="btn btn-danger flex-1 py-1.5 text-xs"
                    disabled={busy}
                    onClick={resign}
                  >
                    <FlagIcon className="h-4 w-4" />
                    Resign
                  </button>
                )}
              </div>
            ) : (
              <MoveControls
                total={game.moves.length}
                selectedPly={selectedPly}
                onSelectPly={selectPly}
              />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1 py-1.5 text-xs"
                disabled={!game.pgn}
                onClick={handleCopyPgn}
              >
                {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                {copied ? 'PGN copied' : 'Copy PGN'}
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2.5 py-1.5 text-xs text-muted hover:text-red-300"
                onClick={deleteGame}
                title="Delete game"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={`Invite to game ${game.id}`}
        widthClass="max-w-lg"
      >
        <InvitePanel
          embedded
          game={game}
          joining={busy}
          onJoin={(seat) => {
            setInviteOpen(false);
            join(seat);
          }}
        />
      </Dialog>
    </div>
  );
}
