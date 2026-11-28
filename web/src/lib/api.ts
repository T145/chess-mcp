import type { ThemeCatalogResponse } from '../../../src/shared/themes';
import type {
  Color,
  CreateGameColor,
  CreateGameResponse,
  DrawAction,
  EngineStatus,
  JoinGameResponse,
  MoveInput,
  OpeningStatus,
  PublicGame,
  ReviewState,
  SwapSeatsResponse
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
  let data = null;
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

  return data;
}

export const api = {
  listGames(): Promise<{ games: PublicGame[] }> {
    return request('/api/games');
  },

  getGame(id: string): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}`);
  },

  createGame(body: {
    name: string;
    color: CreateGameColor;
    timeControl?: string | null;
  }): Promise<CreateGameResponse> {
    return request('/api/games', { method: 'POST', body: JSON.stringify(body) });
  },

  joinGame(id: string, body: { name: string; seat: Color }): Promise<JoinGameResponse> {
    return request(`/api/games/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  swapSeats(id: string, token: string): Promise<SwapSeatsResponse> {
    return request(`/api/games/${encodeURIComponent(id)}/swap-seats`, {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  },

  move(id: string, move: MoveInput, token?: string, note?: string): Promise<{ game: PublicGame }> {
    return request(`/api/games/${encodeURIComponent(id)}/moves`, {
      method: 'POST',
      body: JSON.stringify({ move, token, note })
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
  },

  getEngine(): Promise<{ engine: EngineStatus }> {
    return request('/api/engine');
  },

  getThemes(): Promise<ThemeCatalogResponse> {
    return request('/api/themes', { cache: 'no-store' });
  },

  getOpenings(): Promise<{ openings: OpeningStatus }> {
    return request('/api/openings', { cache: 'no-store' });
  },

  /** Raw book text; null while the server is still downloading it. */
  async getOpeningsBook(): Promise<string | null> {
    const response = await fetch('/api/openings/book', { cache: 'no-cache' });
    if (response.status === 503) return null;
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.text();
  },

  installOpenings(): Promise<{ openings: OpeningStatus }> {
    return request('/api/openings/install', { method: 'POST' });
  },

  installEngine(): Promise<{ engine: EngineStatus }> {
    return request('/api/engine/install', { method: 'POST' });
  },

  getReview(id: string): Promise<{ review: ReviewState }> {
    return request(`/api/games/${encodeURIComponent(id)}/review`);
  },

  startReview(id: string): Promise<{ review: ReviewState }> {
    return request(`/api/games/${encodeURIComponent(id)}/review`, { method: 'POST' });
  }
};
