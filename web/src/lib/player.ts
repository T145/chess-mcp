import type { Color } from '../../../src/shared/protocol';

export interface PlayerIdentity {
  seat: Color;
  token: string;
}

const NAME_KEY = 'chess-mcp:name';

function playerKey(gameId: string): string {
  return `chess-mcp:player:${gameId}`;
}

export function getPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || 'Player';
  } catch {
    return 'Player';
  }
}

export function setPlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40) || 'Player');
  } catch {
    // Storage can be unavailable in private browsing; the app still works.
  }
}

export function getIdentity(gameId: string): PlayerIdentity | null {
  try {
    const raw = localStorage.getItem(playerKey(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
    if ((parsed.seat === 'white' || parsed.seat === 'black') && typeof parsed.token === 'string') {
      return { seat: parsed.seat, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveIdentity(gameId: string, identity: PlayerIdentity): void {
  try {
    localStorage.setItem(playerKey(gameId), JSON.stringify(identity));
  } catch {
    // Ignore storage failures; the seat token then only lives in memory.
  }
}
