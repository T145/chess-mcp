import { describe, expect, it } from 'vitest';

import type { GameClock } from '../src/shared/protocol.js';
import {
  TIME_CONTROL_CATEGORIES,
  TIME_CONTROL_PRESETS,
  describeTimeControl,
  findTimeControlPreset,
  formatClockTime,
  remainingMs,
  toClockConfig
} from '../src/shared/timeControl.js';

describe('time control presets', () => {
  it('mirrors the ranked categories and options', () => {
    const byCategory: Record<string, string[]> = {};
    for (const category of TIME_CONTROL_CATEGORIES) {
      byCategory[category.id] = TIME_CONTROL_PRESETS.filter(
        (preset) => preset.category === category.id
      ).map((preset) => preset.label);
    }

    expect(byCategory).toEqual({
      bullet: ['1 min', '1 + 1', '2 + 1'],
      blitz: ['3 min', '3 + 2', '5 min'],
      rapid: ['10 min', '10 + 5', '15 + 10'],
      daily: ['1 day', '3 days', '7 days']
    });
  });

  it('looks presets up case-insensitively and rejects unknown ids', () => {
    expect(findTimeControlPreset('10+5')?.baseMs).toBe(600_000);
    expect(findTimeControlPreset(' 3D ')?.category).toBe('daily');
    expect(findTimeControlPreset('99+1')).toBeNull();
  });

  it('caps daily banks so time does not accumulate', () => {
    const day = findTimeControlPreset('1d');
    expect(day?.bankCapMs).toBe(86_400_000);
    expect(day ? toClockConfig(day).bankCapMs : null).toBe(86_400_000);
    expect(day ? 'id' in toClockConfig(day) : true).toBe(false);
  });
});

describe('clock helpers', () => {
  const clock: GameClock = {
    category: 'blitz',
    label: '3 + 2',
    baseMs: 180_000,
    incrementMs: 2_000,
    whiteMs: 180_000,
    blackMs: 120_000,
    turn: 'white',
    turnStartedAt: 1_000
  };

  it('charges only the side to move for elapsed time', () => {
    expect(remainingMs(clock, 'white', 1_000)).toBe(180_000);
    expect(remainingMs(clock, 'white', 31_000)).toBe(150_000);
    expect(remainingMs(clock, 'black', 31_000)).toBe(120_000);
  });

  it('never reports negative time and freezes a stopped clock', () => {
    expect(remainingMs(clock, 'white', 10_000_000)).toBe(0);
    expect(remainingMs({ ...clock, turnStartedAt: null }, 'white', 10_000_000)).toBe(180_000);
  });

  it('formats mm:ss, tenths under 20s, and daily values', () => {
    expect(formatClockTime(600_000, 'rapid')).toBe('10:00');
    expect(formatClockTime(65_400, 'blitz')).toBe('1:05');
    expect(formatClockTime(9_850, 'blitz')).toBe('0:09.8');
    expect(formatClockTime(86_400_000, 'daily')).toBe('1d 0h');
    expect(formatClockTime(3_600_000, 'daily')).toBe('1h');
  });

  it('describes increments and the daily per-move allowance', () => {
    expect(describeTimeControl(clock)).toBe('3 + 2');
    expect(
      describeTimeControl({ category: 'daily', label: '3 days', baseMs: 1, incrementMs: 1 })
    ).toBe('3 days per move');
  });
});
