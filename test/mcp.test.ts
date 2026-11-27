import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/mcp.js';
import { GameStore } from '../src/store.js';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function textOf(result: ToolResult): string {
  const blocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function gameIdFrom(text: string): string {
  const id = /Created game ([a-f0-9]{8})/.exec(text)?.[1];
  if (!id) throw new Error(`No game id in: ${text}`);
  return id;
}

function tokenFrom(text: string): string {
  const token = /Seat token: ([a-f0-9]+)/.exec(text)?.[1];
  if (!token) throw new Error(`No token in: ${text}`);
  return token;
}

interface Harness {
  store: GameStore;
  connect: () => Promise<Client>;
  close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const store = new GameStore();
  const handler = createMcpHandler(() => createMcpServer(store));
  const clients: Client[] = [];

  const connect = async (): Promise<Client> => {
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init))
    });
    const client = new Client(
      { name: 'vitest', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  const close = async (): Promise<void> => {
    await Promise.all(clients.map((client) => client.close()));
    await handler.close();
  };

  return { store, connect, close };
}

async function createSeatedGame(a: Client, b: Client) {
  const created = await a.callTool({
    name: 'create_game',
    arguments: { as: 'white', name: 'Alice' }
  });
  const createdText = textOf(created);
  const gameId = gameIdFrom(createdText);
  const whiteToken = tokenFrom(createdText);

  const joined = await b.callTool({
    name: 'join_game',
    arguments: { game_id: gameId, seat: 'black', name: 'Bob' }
  });
  const blackToken = tokenFrom(textOf(joined));

  return { gameId, whiteToken, blackToken };
}

describe('MCP tools', () => {
  it('creates, joins, and plays moves with seat tokens', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const b = await harness.connect();
      const { gameId, whiteToken, blackToken } = await createSeatedGame(a, b);

      const moved = await a.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e4', seat_token: whiteToken }
      });
      expect(moved.isError).toBeFalsy();
      expect(textOf(moved)).toContain('Played e4.');
      expect(textOf(moved)).toContain('Black to move.');

      const outOfTurn = await a.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e5', seat_token: whiteToken }
      });
      expect(outOfTurn.isError).toBe(true);
      expect(textOf(outOfTurn)).toMatch(/black's turn/i);

      const illegal = await b.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e9', seat_token: blackToken }
      });
      expect(illegal.isError).toBe(true);
      expect(textOf(illegal)).toMatch(/illegal move/i);
    } finally {
      await harness.close();
    }
  });

  it('waits for the opponent and returns the updated board', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const b = await harness.connect();
      const { gameId, whiteToken, blackToken } = await createSeatedGame(a, b);

      await a.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e4', seat_token: whiteToken }
      });

      const waiting = a.callTool({
        name: 'wait_for_move',
        arguments: {
          game_id: gameId,
          since_ply: 1,
          timeout_seconds: 5,
          seat_token: whiteToken
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      const blackMove = await b.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e5', seat_token: blackToken }
      });
      expect(blackMove.isError).toBeFalsy();

      const result = await waiting;
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('Move received.');
      expect(textOf(result)).toContain('e5');
      expect(textOf(result)).toContain('White to move.');
    } finally {
      await harness.close();
    }
  });

  it('returns immediately from wait_for_move when it is the caller’s turn', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const b = await harness.connect();
      const { gameId, whiteToken } = await createSeatedGame(a, b);

      const result = await a.callTool({
        name: 'wait_for_move',
        arguments: { game_id: gameId, seat_token: whiteToken, timeout_seconds: 5 }
      });

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('It is your turn.');
      expect(textOf(result)).toContain('White to move.');
    } finally {
      await harness.close();
    }
  });

  it('lists games and returns full game state', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const b = await harness.connect();
      const { gameId } = await createSeatedGame(a, b);

      const list = await a.callTool({ name: 'list_games', arguments: {} });
      expect(textOf(list)).toContain(gameId);
      expect(textOf(list)).toContain('Alice');
      expect(textOf(list)).toContain('Bob');

      const state = await a.callTool({ name: 'get_game', arguments: { game_id: gameId } });
      expect(textOf(state)).toContain(`Game ${gameId}`);
      expect(textOf(state)).toContain('FEN:');
      expect(textOf(state)).toContain('Legal moves');

      const missing = await a.callTool({ name: 'get_game', arguments: { game_id: 'deadbeef' } });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toMatch(/not found/i);
    } finally {
      await harness.close();
    }
  });

  it('negotiates draws and resignations', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const b = await harness.connect();
      const first = await createSeatedGame(a, b);

      await a.callTool({
        name: 'draw',
        arguments: { game_id: first.gameId, action: 'offer', seat_token: first.whiteToken }
      });
      const accepted = await b.callTool({
        name: 'draw',
        arguments: { game_id: first.gameId, action: 'accept', seat_token: first.blackToken }
      });
      expect(textOf(accepted)).toContain('Draw accepted.');
      expect(textOf(accepted)).toContain('Draw — agreement.');

      const second = await createSeatedGame(a, b);
      const resigned = await b.callTool({
        name: 'resign',
        arguments: { game_id: second.gameId, seat_token: second.blackToken }
      });
      expect(textOf(resigned)).toContain('Resigned.');
      expect(textOf(resigned)).toContain('White wins');
    } finally {
      await harness.close();
    }
  });

  it('creates clocked games from a preset and rejects unknown presets', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();

      const created = await a.callTool({
        name: 'create_game',
        arguments: { as: 'white', name: 'Alice', time_control: '3+2' }
      });
      const text = textOf(created);
      expect(created.isError).toBeFalsy();
      expect(text).toContain('Clock: 3 + 2 (+2s) — White');

      const gameId = gameIdFrom(text);
      expect(harness.store.getPublic(gameId).clock).toMatchObject({
        category: 'blitz',
        label: '3 + 2',
        baseMs: 180_000,
        incrementMs: 2_000,
        turn: 'white'
      });

      const bad = await a.callTool({
        name: 'create_game',
        arguments: { as: 'white', name: 'Alice', time_control: '99+1' }
      });
      expect(bad.isError).toBe(true);
      expect(textOf(bad)).toMatch(/unknown time control/i);
    } finally {
      await harness.close();
    }
  });

  it('supports open hotseat games without tokens', async () => {
    const harness = await setup();
    try {
      const a = await harness.connect();
      const created = await a.callTool({
        name: 'create_game',
        arguments: { as: 'none', name: 'Hotseat' }
      });
      const text = textOf(created);
      const gameId = gameIdFrom(text);
      expect(text).toContain('Both seats are open');

      const moved = await a.callTool({
        name: 'make_move',
        arguments: { game_id: gameId, move: 'e4' }
      });
      expect(textOf(moved)).toContain('Played e4.');

      const resigned = await a.callTool({
        name: 'resign',
        arguments: { game_id: gameId, seat: 'white' }
      });
      expect(textOf(resigned)).toContain('Black wins');
    } finally {
      await harness.close();
    }
  });
});
