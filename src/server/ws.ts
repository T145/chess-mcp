import type { IncomingMessage, Server } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import type { WsServerMessage } from '../shared/protocol.js';
import type { GameStore, StoreEvent } from '../store.js';

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return ALLOWED_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function send(socket: WebSocket, message: WsServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The client disappeared between the readyState check and send.
  }
}

function broadcast(clients: Iterable<WebSocket>, message: WsServerMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        // Ignore broken sockets; the close handler removes them.
      }
    }
  }
}

export interface WebSocketOptions {
  allowViteHmr?: boolean;
}

export function attachWebSocket(
  server: Server,
  store: GameStore,
  options: WebSocketOptions = {}
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    if (pathname !== '/ws') {
      if (!options.allowViteHmr) socket.destroy();
      return;
    }

    if (!originAllowed(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket) => {
    socket.on('error', () => {
      // The close event cleans up the connection.
    });
    send(socket, { type: 'hello', serverTime: Date.now() });
    send(socket, { type: 'snapshot', games: store.list() });
  });

  const unsubscribe = store.subscribe((event: StoreEvent) => {
    const message: WsServerMessage =
      event.type === 'game'
        ? { type: 'game', game: event.game }
        : { type: 'deleted', id: event.id };
    broadcast(wss.clients, message);
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, 30_000);
  heartbeat.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  return wss;
}

export function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) client.terminate();
  return new Promise((resolve) => wss.close(() => resolve()));
}
