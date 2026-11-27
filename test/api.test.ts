import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.js';
import { attachWebSocket, closeWebSocketServer } from '../src/server/ws.js';
import type { CreateGameResponse, JoinGameResponse, PublicGame } from '../src/shared/protocol.js';
import { GameStore } from '../src/store.js';

interface TestServer {
  base: string;
  wsUrl: string;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const store = new GameStore();
  const { app, mcpHandler } = createApp(store);
  const server = createServer(app);
  const wss = attachWebSocket(server, store);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      await closeWebSocketServer(wss);
      await mcpHandler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function post<T>(base: string, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: (await response.json()) as T };
}

function nextMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 4_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    const onMessage = (data: unknown): void => {
      try {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (predicate(message)) {
          cleanup();
          resolve(message);
        }
      } catch {
        // Ignore non-JSON frames.
      }
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error('WebSocket closed'));
    };

    socket.on('message', onMessage);
    socket.on('close', onClose);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  const snapshot = nextMessage(socket, (message) => message.type === 'snapshot');
  await once(socket, 'open');
  await snapshot;
  return socket;
}

describe('HTTP API and WebSocket', () => {
  it('reports health', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.base}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, games: 0 });
    } finally {
      await server.close();
    }
  });

  it('creates a game, joins the other seat, and validates moves', async () => {
    const server = await startServer();
    try {
      const created = await post<CreateGameResponse>(server.base, '/api/games', {
        name: 'Alice',
        color: 'white'
      });
      expect(created.status).toBe(201);
      expect(created.body.seat).toBe('white');
      expect(created.body.token).toBeTruthy();

      const gameId = created.body.game.id;
      const joined = await post<JoinGameResponse>(server.base, `/api/games/${gameId}/join`, {
        name: 'Bob',
        seat: 'black'
      });
      expect(joined.status).toBe(200);
      expect(joined.body.seat).toBe('black');
      expect(joined.body.game.seats.black).toEqual({ kind: 'human', name: 'Bob' });

      const badMove = await post<{ error: string }>(
        server.base,
        `/api/games/${gameId}/moves`,
        { move: 'd4', token: joined.body.token }
      );
      expect(badMove.status).toBe(400);
      expect(badMove.body.error).toMatch(/white's turn/i);

      const missingToken = await post<{ error: string }>(
        server.base,
        `/api/games/${gameId}/moves`,
        { move: 'e4' }
      );
      expect(missingToken.status).toBe(400);
      expect(missingToken.body.error).toMatch(/seat token/i);

      const played = await post<{ game: PublicGame }>(
        server.base,
        `/api/games/${gameId}/moves`,
        { move: 'e4', token: created.body.token }
      );
      expect(played.status).toBe(200);
      expect(played.body.game.moves[0]?.san).toBe('e4');
      expect(played.body.game.turn).toBe('black');
    } finally {
      await server.close();
    }
  });

  it('broadcasts game updates to WebSocket clients', async () => {
    const server = await startServer();
    try {
      const socket = await openSocket(server.wsUrl);
      const created = await post<CreateGameResponse>(server.base, '/api/games', {
        name: 'Alice',
        color: 'white'
      });
      const gameId = created.body.game.id;

      const update = nextMessage(
        socket,
        (message) => message.type === 'game' && (message.game as PublicGame).id === gameId
      );

      const played = await post<{ game: PublicGame }>(
        server.base,
        `/api/games/${gameId}/moves`,
        { move: 'e4', token: created.body.token }
      );
      expect(played.status).toBe(200);

      const message = await update;
      expect((message.game as PublicGame).moves[0]?.san).toBe('e4');
      socket.close();
    } finally {
      await server.close();
    }
  });

  it('returns JSON 400 for invalid request bodies and 404 for unknown routes', async () => {
    const server = await startServer();
    try {
      const invalid = await post<{ error: string }>(server.base, '/api/games', { name: '' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toContain('Invalid request');

      const missing = await fetch(`${server.base}/api/nope`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Not found' });
    } finally {
      await server.close();
    }
  });
});
