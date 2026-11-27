import type { ClockConfig, Color, GameClock, TimeControlCategory } from './protocol.js';

export interface TimeControlPreset extends ClockConfig {
  id: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Presets mirror the ranked categories on Chess.com: Bullet, Blitz, Rapid and
 * Daily. Daily presets behave as "N days per move": the bank is capped at N days
 * so time never accumulates between moves.
 */
export const TIME_CONTROL_PRESETS: readonly TimeControlPreset[] = [
  { id: '1+0', category: 'bullet', label: '1 min', baseMs: MINUTE, incrementMs: 0 },
  { id: '1+1', category: 'bullet', label: '1 + 1', baseMs: MINUTE, incrementMs: 1_000 },
  { id: '2+1', category: 'bullet', label: '2 + 1', baseMs: 2 * MINUTE, incrementMs: 1_000 },
  { id: '3+0', category: 'blitz', label: '3 min', baseMs: 3 * MINUTE, incrementMs: 0 },
  { id: '3+2', category: 'blitz', label: '3 + 2', baseMs: 3 * MINUTE, incrementMs: 2_000 },
  { id: '5+0', category: 'blitz', label: '5 min', baseMs: 5 * MINUTE, incrementMs: 0 },
  { id: '10+0', category: 'rapid', label: '10 min', baseMs: 10 * MINUTE, incrementMs: 0 },
  { id: '10+5', category: 'rapid', label: '10 + 5', baseMs: 10 * MINUTE, incrementMs: 5_000 },
  { id: '15+10', category: 'rapid', label: '15 + 10', baseMs: 15 * MINUTE, incrementMs: 10_000 },
  {
    id: '1d',
    category: 'daily',
    label: '1 day',
    baseMs: DAY,
    incrementMs: DAY,
    bankCapMs: DAY
  },
  {
    id: '3d',
    category: 'daily',
    label: '3 days',
    baseMs: 3 * DAY,
    incrementMs: 3 * DAY,
    bankCapMs: 3 * DAY
  },
  {
    id: '7d',
    category: 'daily',
    label: '7 days',
    baseMs: 7 * DAY,
    incrementMs: 7 * DAY,
    bankCapMs: 7 * DAY
  }
];

export const TIME_CONTROL_CATEGORIES: readonly {
  id: TimeControlCategory;
  label: string;
}[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'daily', label: 'Daily' }
];

export function findTimeControlPreset(id: string): TimeControlPreset | null {
  const key = id.trim().toLowerCase();
  return TIME_CONTROL_PRESETS.find((preset) => preset.id === key) ?? null;
}

/** Strip the preset id so the result matches the persisted ClockConfig shape. */
export function toClockConfig(preset: TimeControlPreset): ClockConfig {
  return {
    category: preset.category,
    label: preset.label,
    baseMs: preset.baseMs,
    incrementMs: preset.incrementMs,
    ...(preset.bankCapMs !== undefined ? { bankCapMs: preset.bankCapMs } : {})
  };
}

export function timeControlIds(): string {
  return TIME_CONTROL_PRESETS.map((preset) => preset.id).join(', ');
}

/** Describe a clock's pace, e.g. "10 + 5" or "3 days per move". */
export function describeTimeControl(clock: ClockConfig): string {
  if (clock.category === 'daily') return `${clock.label} per move`;
  const seconds = Math.round(clock.incrementMs / 1_000);
  return seconds > 0 ? `${Math.round(clock.baseMs / 60_000)} + ${seconds}` : clock.label;
}

/**
 * Remaining time for a colour at a given instant, clamped at zero. The stored
 * value is the bank when that side's turn began, so the side to move is charged
 * for the time elapsed since {@link GameClock.turnStartedAt}.
 */
export function remainingMs(clock: GameClock, color: Color, now: number): number {
  const bank = color === 'white' ? clock.whiteMs : clock.blackMs;
  const startedAt = clock.turnStartedAt;
  // Only the colour on the move is charged; the other clock is frozen.
  if (startedAt === null || clock.turn !== color) return Math.max(0, bank);
  const elapsed = Math.max(0, now - startedAt);
  return Math.max(0, bank - elapsed);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Format a clock value for the UI and MCP text. */
export function formatClockTime(ms: number, category: TimeControlCategory): string {
  const clamped = Math.max(0, ms);

  if (category === 'daily') {
    const totalHours = Math.floor(clamped / 3_600_000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) return `${days}d ${hours}h`;
    if (totalHours > 0) return `${hours}h`;
    return `${Math.max(0, Math.floor(clamped / 60_000))}m`;
  }

  const totalSeconds = Math.floor(clamped / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (clamped < 20_000) {
    const tenths = Math.floor((clamped % 1_000) / 100);
    return `${minutes}:${pad(seconds)}.${tenths}`;
  }
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** One-line summary used in MCP tool output. */
export function formatClockLine(clock: GameClock, turn: Color, now: number): string {
  const increment = clock.incrementMs > 0 ? ` (+${Math.round(clock.incrementMs / 1_000)}s)` : '';
  return (
    `Clock: ${describeTimeControl(clock)}${increment} — ` +
    `White ${formatClockTime(remainingMs(clock, 'white', now), clock.category)} · ` +
    `Black ${formatClockTime(remainingMs(clock, 'black', now), clock.category)} · ` +
    `${turn === 'white' ? 'White' : 'Black'} to move`
  );
}
