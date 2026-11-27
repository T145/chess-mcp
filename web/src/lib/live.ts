import { useSyncExternalStore } from 'react';

import type { PublicGame, WsServerMessage } from '../../../src/shared/protocol';
import { api } from './api';

export interface LiveState {
  games: Record<string, PublicGame>;
  connected: boolean;
  loaded: boolean;
}

type Listener = () => void;

let state: LiveState = { games: {}, connected: false, loaded: false };
const listeners = new Set<Listener>();

let socket: WebSocket | null = null;
let started = false;
let retry = 0;
let retryTimer: number | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: LiveState): void {
  state = next;
  emit();
}

function toMap(games: PublicGame[]): Record<string, PublicGame> {
  const map: Record<string, PublicGame> = {};
  for (const game of games) map[game.id] = game;
  return map;
}

function handleMessage(raw: string): void {
  let message: WsServerMessage;
  try {
    message = JSON.parse(raw) as WsServerMessage;
  } catch {
    return;
  }

  if (message.type === 'snapshot') {
    setState({ ...state, games: toMap(message.games), loaded: true });
  } else if (message.type === 'game') {
    setState({
      ...state,
      games: { ...state.games, [message.game.id]: message.game },
      loaded: true
    });
  } else if (message.type === 'deleted') {
    const games = { ...state.games };
    delete games[message.id];
    setState({ ...state, games });
  }
}

function scheduleReconnect(): void {
  if (!started || retryTimer !== undefined) return;
  const delay = Math.min(1_000 * 2 ** retry, 10_000);
  retry += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, delay);
}

function connect(): void {
  if (!started) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener('open', () => {
    retry = 0;
    setState({ ...state, connected: true });
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') handleMessage(event.data);
  });

  socket.addEventListener('close', () => {
    setState({ ...state, connected: false });
    socket = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });
}

export function startLive(): void {
  if (started) return;
  started = true;
  connect();

  // The WebSocket snapshot is the primary source, but this keeps the lobby
  // useful if the socket is blocked or still connecting.
  void api
    .listGames()
    .then(({ games }) => {
      if (!state.loaded) setState({ ...state, games: toMap(games), loaded: true });
      return undefined;
    })
    .catch(() => {
      if (!state.loaded) setState({ ...state, loaded: true });
    });
}

export function mergeGame(game: PublicGame): void {
  setState({ ...state, games: { ...state.games, [game.id]: game }, loaded: true });
}

export function removeGame(id: string): void {
  if (!state.games[id]) return;
  const games = { ...state.games };
  delete games[id];
  setState({ ...state, games });
}

export const live = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): LiveState {
    return state;
  }
};

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    started = false;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    socket?.close();
  });
}
