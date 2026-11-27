import { createHash, randomBytes } from 'node:crypto';

import { UserError } from './errors.js';
import { Game, type SeatState } from './game.js';
import { generateGameId } from './ids.js';
import { GameStorage } from './storage.js';
import type {
  ClockConfig,
  Color,
  DrawAction,
  MoveInput,
  PublicGame,
  SeatKind
} from './shared/protocol.js';

export interface CreateGameOptions {
  as: Color | 'none';
  name: string;
  kind: SeatKind;
  /** Omit or pass null for an untimed game. */
  timeControl?: ClockConfig | null;
}

export interface GameStoreOptions {
  /** Directory for saved games. Omit or pass null to keep games in memory only. */
  dataDir?: string | null;
  /** Set false to disable the background flag-fall ticker (tests drive tick()). */
  autoTick?: boolean;
}

export interface CreatedGame {
  game: PublicGame;
  seat: Color | null;
  token: string | null;
}

export interface JoinedGame {
  game: PublicGame;
  seat: Color;
  token: string;
}

export interface SwappedSeats {
  game: PublicGame;
  /** The seat the caller holds after the swap. */
  seat: Color;
}

export type StoreEvent =
  | { type: 'game'; game: PublicGame }
  | { type: 'deleted'; id: string };

type Listener = (event: StoreEvent) => void;

const MAX_GAMES = 200;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(18).toString('hex');
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 40);
  return trimmed || 'Player';
}

function openSeat(): SeatState {
  return { kind: 'open', name: 'Open' };
}

export class GameStore {
  private readonly games = new Map<string, Game>();
  private readonly listeners = new Set<Listener>();
  private readonly storage: GameStorage | null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(options: GameStoreOptions = {}) {
    this.storage = options.dataDir ? new GameStorage(options.dataDir) : null;
    if (this.storage) this.restore();
    if (options.autoTick !== false) {
      this.ticker = setInterval(() => this.tick(), 1_000);
      // Never keep the process (or a test run) alive just for the clock.
      this.ticker.unref?.();
    }
  }

  /** Stop the background clock ticker. */
  dispose(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /** Flag any game whose side to move has run out of time. */
  tick(now: number = Date.now()): void {
    for (const game of this.games.values()) {
      if (game.settleClock(now)) this.publish(game);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): PublicGame[] {
    const now = Date.now();
    for (const game of this.games.values()) game.settleClock(now);
    return [...this.games.values()]
      .map((game) => game.toPublic())
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Game {
    const key = id.trim().toLowerCase();
    const game = this.games.get(key);
    if (!game) {
      throw new UserError(`Game not found: ${id}. Use list_games to see active games.`);
    }
    // Lazy flag-fall: a read must never report a move that is already illegal.
    game.settleClock();
    return game;
  }

  getPublic(id: string): PublicGame {
    return this.get(id).toPublic();
  }

  playerSeat(id: string, token: string): Color {
    const seat = this.seatForToken(this.get(id), token);
    if (!seat) throw new UserError('Invalid seat token for this game.');
    return seat;
  }

  create(options: CreateGameOptions): CreatedGame {
    this.evictIfNeeded();

    const id = generateGameId((candidate) => this.games.has(candidate));
    const name = cleanName(options.name);

    if (options.as === 'none') {
      const game = new Game({
        id,
        seats: { white: openSeat(), black: openSeat() },
        clock: options.timeControl ?? null
      });
      this.games.set(id, game);
      this.publish(game);
      return { game: game.toPublic(), seat: null, token: null };
    }

    const token = newToken();
    const caller: SeatState = {
      kind: options.kind,
      name,
      tokenHash: hashToken(token)
    };
    const seats: Record<Color, SeatState> =
      options.as === 'white'
        ? { white: caller, black: openSeat() }
        : { white: openSeat(), black: caller };

    const game = new Game({ id, seats, clock: options.timeControl ?? null });
    this.games.set(id, game);
    this.publish(game);
    return { game: game.toPublic(), seat: options.as, token };
  }

  join(id: string, seat: Color, name: string, kind: SeatKind): JoinedGame {
    const game = this.get(id);
    const target = game.seats[seat];
    if (target.kind !== 'open') {
      throw new UserError(`The ${seat} seat is already claimed by ${target.name}.`);
    }

    const token = newToken();
    game.seats[seat] = {
      kind,
      name: cleanName(name),
      tokenHash: hashToken(token)
    };
    game.syncPgnHeaders();
    // Both seats are filled now, so the clock can start.
    game.startClock();
    this.publish(game);
    return { game: game.toPublic(), seat, token };
  }

  /**
   * Swap the white and black seats. Each seat keeps its name and token hash, so
   * both players simply change colour and keep the token they already hold.
   */
  swapSeats(id: string, token: string): SwappedSeats {
    const game = this.get(id);
    const before = this.seatForToken(game, token);
    if (!before) throw new UserError('Invalid seat token for this game.');

    game.swapSeats();
    this.publish(game);
    return { game: game.toPublic(), seat: before === 'white' ? 'black' : 'white' };
  }

  move(id: string, move: MoveInput, token?: string, note?: string): PublicGame {
    const game = this.get(id);
    const seat = this.resolveMoveSeat(game, token);

    if (seat !== game.turn) {
      throw new UserError(`It is ${game.turn}'s turn, not ${seat}'s.`);
    }

    game.applyMove(move, Date.now(), note);
    this.publish(game);
    return game.toPublic();
  }

  resign(id: string, token?: string, seat?: Color): PublicGame {
    const game = this.get(id);
    const acting = this.resolveActionSeat(game, token, seat);
    game.resign(acting);
    this.publish(game);
    return game.toPublic();
  }

  draw(id: string, action: DrawAction, token?: string, seat?: Color): PublicGame {
    const game = this.get(id);
    const acting = this.resolveActionSeat(game, token, seat);

    if (action === 'offer') game.offerDraw(acting);
    else if (action === 'accept') game.acceptDraw(acting);
    else game.declineDraw(acting);

    this.publish(game);
    return game.toPublic();
  }

  delete(id: string): void {
    const game = this.get(id);
    this.games.delete(game.id);
    this.storage?.remove(game.id);
    this.emit({ type: 'deleted', id: game.id });
  }

  private resolveMoveSeat(game: Game, token: string | undefined): Color {
    if (token) {
      const seat = this.seatForToken(game, token);
      if (!seat) throw new UserError('Invalid seat token for this game.');
      return seat;
    }

    if (this.isHotseat(game)) return game.turn;

    throw new UserError(
      'A seat token is required. Create or join a game to receive one, then pass it as "token"/"seat_token".'
    );
  }

  private resolveActionSeat(game: Game, token: string | undefined, seat: Color | undefined): Color {
    if (token) {
      const matched = this.seatForToken(game, token);
      if (!matched) throw new UserError('Invalid seat token for this game.');
      return matched;
    }

    if (!seat) {
      throw new UserError('Pass a seat token, or specify "seat" for a hotseat game.');
    }

    if (game.seats[seat].kind !== 'open') {
      throw new UserError(`The ${seat} seat is claimed; a seat token is required.`);
    }

    return seat;
  }

  private seatForToken(game: Game, token: string): Color | null {
    const hash = hashToken(token);
    if (game.seats.white.tokenHash === hash) return 'white';
    if (game.seats.black.tokenHash === hash) return 'black';
    return null;
  }

  private isHotseat(game: Game): boolean {
    return game.seats.white.kind === 'open' && game.seats.black.kind === 'open';
  }

  private publish(game: Game): void {
    this.storage?.save(game.toSnapshot());
    this.emit({ type: 'game', game: game.toPublic() });
  }

  private restore(): void {
    if (!this.storage) return;

    for (const snapshot of this.storage.load()) {
      if (this.games.has(snapshot.id)) continue;
      try {
        this.games.set(snapshot.id, Game.fromSnapshot(snapshot));
      } catch (error) {
        console.error(`Skipping saved game ${snapshot.id}: could not replay its moves.`, error);
      }
    }
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('GameStore listener failed:', error);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.games.size < MAX_GAMES) return;

    const all = [...this.games.values()];
    const victim =
      all.filter((game) => !game.isPlaying).toSorted((a, b) => a.createdAt - b.createdAt)[0] ??
      all.toSorted((a, b) => a.createdAt - b.createdAt)[0];

    if (victim) {
      this.games.delete(victim.id);
      this.storage?.remove(victim.id);
      this.emit({ type: 'deleted', id: victim.id });
    }
  }
}
