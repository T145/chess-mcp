import type { Color } from '../../../src/shared/protocol';

export interface PlayerIdentity {
  seat: Color;
  token: string;
}

const NAME_KEY = 'chess-mcp:name';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  if (!isRecord(value)) return false;
  return (
    (value.seat === 'white' || value.seat === 'black') && typeof value.token === 'string'
  );
}

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
    const parsed: unknown = JSON.parse(raw);
    return isPlayerIdentity(parsed) ? { seat: parsed.seat, token: parsed.token } : null;
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
