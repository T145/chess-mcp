import type {
  Color,
  CreateGameColor,
  CreateGameResponse,
  DrawAction,
  JoinGameResponse,
  MoveInput,
  PublicGame
} from '../../../src/shared/protocol';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- responses are produced by this app's own typed API
  return data as T;
}

export const api = {
  listGames(): Promise<{ games: PublicGame[] }> {
    return request('/api/games');
  },

  getGame(id: string): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}`);
  },

  createGame(body: { name: string; color: CreateGameColor }): Promise<CreateGameResponse> {
    return request('/api/games', { method: 'POST', body: JSON.stringify(body) });
  },

  joinGame(id: string, body: { name: string; seat: Color }): Promise<JoinGameResponse> {
    return request(`/api/games/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  move(id: string, move: MoveInput, token?: string): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}/moves`, {
      method: 'POST',
      body: JSON.stringify({ move, token })
    });
  },

  draw(
    id: string,
    action: DrawAction,
    token?: string,
    seat?: Color
  ): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}/draw`, {
      method: 'POST',
      body: JSON.stringify({ action, token, seat })
    });
  },

  resign(id: string, token?: string, seat?: Color): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}/resign`, {
      method: 'POST',
      body: JSON.stringify({ token, seat })
    });
  },

  deleteGame(id: string): Promise<{ ok: true }> {
    return request(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};
