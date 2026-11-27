import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { UserError } from './errors.js';
import { formatGameLine, formatState, formatTokenNotice } from './format.js';
import type { Game } from './game.js';
import type { Color } from './shared/protocol.js';
import type { GameStore } from './store.js';

const GAME_ID = z.string().min(1).describe('Game id, for example "3f9c2a1b".');
const SEAT_TOKEN = z
  .string()
  .min(1)
  .optional()
  .describe('Seat token returned by create_game or join_game. Required in seated games.');

interface WaitResult {
  game: Game;
  timedOut: boolean;
  yourTurn: boolean;
}

function waitForMove(
  store: GameStore,
  gameId: string,
  sincePly: number | undefined,
  timeoutSeconds: number,
  seat?: Color
): Promise<WaitResult> {
  const initial = store.get(gameId);
  const baseline = sincePly ?? initial.moveCount;

  if (seat && initial.isPlaying && initial.turn === seat) {
    return Promise.resolve({ game: initial, timedOut: false, yourTurn: true });
  }

  if (initial.moveCount > baseline || !initial.isPlaying) {
    return Promise.resolve({ game: initial, timedOut: false, yourTurn: false });
  }

  return new Promise<WaitResult>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const dispose of cleanups) dispose();
    };

    const finish = (result: WaitResult): void => {
      if (settled) return;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      finish({ game: store.get(gameId), timedOut: true, yourTurn: false });
    }, timeoutSeconds * 1_000);

    cleanups.push(
      store.subscribe((event) => {
        if (event.type === 'deleted' && event.id === gameId) {
          fail(new UserError(`Game ${gameId} was deleted while waiting.`));
          return;
        }
        if (event.type !== 'game' || event.game.id !== gameId) return;
        if (event.game.moves.length > baseline || event.game.status.phase !== 'playing') {
          finish({ game: store.get(gameId), timedOut: false, yourTurn: false });
        }
      })
    );
  });
}

export function createMcpServer(store: GameStore): McpServer {
  const server = new McpServer({
    name: 'chess-mcp',
    version: '0.1.0'
  });

  server.registerTool(
    'create_game',
    {
      title: 'Create a chess game',
      description:
        'Create a standard chess game and claim the white seat, black seat, or no seat (hotseat). ' +
        'Returns a game id and a seat token. Keep the token and pass it to make_move, draw, and resign.',
      inputSchema: z.object({
        as: z
          .enum(['white', 'black', 'none'])
          .default('white')
          .describe('Seat to claim. Use "none" to leave both seats open for hotseat play.'),
        name: z.string().min(1).max(40).default('LLM').describe('Display name for your seat.')
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ as, name }) => {
      const created = store.create({ as, name, kind: 'llm' });
      const lines = [`Created game ${created.game.id}.`];

      if (created.seat && created.token) {
        lines.push('', formatTokenNotice(created.seat, name, created.token));
        lines.push(
          '',
          `Your opponent can join the open seat or watch at the local web app. Use get_game or wait_for_move next.`
        );
      } else {
        lines.push(
          '',
          'Both seats are open. Use join_game with the game id to claim a seat.'
        );
      }

      lines.push('', formatState(store.get(created.game.id)));
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.registerTool(
    'join_game',
    {
      title: 'Join an open seat',
      description:
        'Claim an open white or black seat in an existing game. Returns the game state and a seat token. ' +
        'Keep the token and pass it to make_move, draw, and resign.',
      inputSchema: z.object({
        game_id: GAME_ID,
        seat: z.enum(['white', 'black']).describe('Open seat to claim.'),
        name: z.string().min(1).max(40).describe('Your display name.')
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ game_id, seat, name }) => {
      const joined = store.join(game_id, seat, name, 'llm');
      return {
        content: [
          {
            type: 'text',
            text: [
              `Joined game ${joined.game.id} as ${seat}.`,
              '',
              formatTokenNotice(seat, name, joined.token),
              '',
              formatState(store.get(joined.game.id))
            ].join('\n')
          }
        ]
      };
    }
  );

  server.registerTool(
    'list_games',
    {
      title: 'List active games',
      description: 'List active chess games with players, turn, status, and last move.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async () => {
      const games = store.list();
      const text =
        games.length === 0
          ? 'No active games. Use create_game to start one.'
          : games.map(formatGameLine).join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'get_game',
    {
      title: 'Get a game',
      description:
        'Get the full state of a game: board, players, turn, check/result status, FEN, PGN, and legal moves.',
      inputSchema: z.object({ game_id: GAME_ID }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ game_id }) => {
      const game = store.get(game_id);
      return { content: [{ type: 'text', text: formatState(game) }] };
    }
  );

  server.registerTool(
    'make_move',
    {
      title: 'Make a move',
      description:
        'Play a move in SAN (e4, Nf3, O-O, e8=Q) or UCI (e2e4, e7e8q) notation. ' +
        'Seat tokens are required in seated games and are checked against the side to move.',
      inputSchema: z.object({
        game_id: GAME_ID,
        move: z
          .string()
          .min(1)
          .describe('SAN or UCI move. Examples: "Nf3", "O-O", "e2e4", "e7e8q".'),
        seat_token: SEAT_TOKEN
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ game_id, move, seat_token }) => {
      const updated = store.move(game_id, move, seat_token);
      const played = updated.lastMove?.san ?? move;
      return {
        content: [
          {
            type: 'text',
            text: `Played ${played}.\n\n${formatState(store.get(game_id), { includePgn: false })}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'wait_for_move',
    {
      title: 'Wait for the opponent',
      description:
        'Wait for the next move, the game to end, or the timeout. Pass your seat_token: ' +
        'if it is already your turn, this returns immediately. Otherwise it blocks until the ' +
        'opponent moves, then returns the updated board for your make_move call.',
      inputSchema: z.object({
        game_id: GAME_ID,
        since_ply: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Return immediately if the game already has more plies than this.'),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .default(30)
          .describe('Maximum time to wait, in seconds.'),
        seat_token: SEAT_TOKEN,
        seat: z
          .enum(['white', 'black'])
          .optional()
          .describe('Only for hotseat games where no seat token exists.')
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async ({ game_id, since_ply, timeout_seconds, seat_token, seat }) => {
      let playerSeat: Color | undefined;
      if (seat_token) playerSeat = store.playerSeat(game_id, seat_token);
      else if (seat) playerSeat = seat;

      const result = await waitForMove(store, game_id, since_ply, timeout_seconds, playerSeat);
      const status = result.game.currentStatus;
      const prefix = result.yourTurn
        ? 'It is your turn. Call make_move now.'
        : status.phase !== 'playing'
          ? `The game is over: ${status.reason}.`
          : result.timedOut
            ? `No move within ${timeout_seconds} seconds. Call wait_for_move again if the game is still active.`
            : 'Move received.';
      return {
        content: [
          {
            type: 'text',
            text: `${prefix}\n\n${formatState(result.game, { includePgn: false })}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'draw',
    {
      title: 'Offer, accept, or decline a draw',
      description:
        'Manage a draw offer. "offer" proposes a draw, "accept" agrees to the opponent’s offer, ' +
        'and "decline" rejects it. Seat tokens are required in seated games.',
      inputSchema: z.object({
        game_id: GAME_ID,
        action: z.enum(['offer', 'accept', 'decline']),
        seat_token: SEAT_TOKEN,
        seat: z
          .enum(['white', 'black'])
          .optional()
          .describe('Only for hotseat games where no seat token exists.')
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ game_id, action, seat_token, seat }) => {
      store.draw(game_id, action, seat_token, seat);
      const message =
        action === 'offer'
          ? 'Draw offered.'
          : action === 'accept'
            ? 'Draw accepted.'
            : 'Draw offer declined.';
      return {
        content: [
          {
            type: 'text',
            text: `${message}\n\n${formatState(store.get(game_id), { includePgn: false })}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'resign',
    {
      title: 'Resign a game',
      description: 'Resign from a game. Seat tokens are required in seated games.',
      inputSchema: z.object({
        game_id: GAME_ID,
        seat_token: SEAT_TOKEN,
        seat: z
          .enum(['white', 'black'])
          .optional()
          .describe('Only for hotseat games where no seat token exists.')
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ game_id, seat_token, seat }) => {
      store.resign(game_id, seat_token, seat);
      return {
        content: [
          {
            type: 'text',
            text: `Resigned.\n\n${formatState(store.get(game_id), { includePgn: false })}`
          }
        ]
      };
    }
  );

  return server;
}
