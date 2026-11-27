import { describe, expect, it } from 'vitest';

import { describeStatus, formatGameLine, formatState } from '../src/format.js';
import { Game } from '../src/game.js';
import type { ClockConfig } from '../src/shared/protocol.js';

function game(clock?: ClockConfig): Game {
  return new Game({
    id: 'fmt00001',
    seats: {
      white: { kind: 'human', name: 'Alice' },
      black: { kind: 'llm', name: 'Cline' }
    },
    now: Date.now(),
    clock: clock ?? null
  });
}

const RAPID: ClockConfig = {
  category: 'rapid',
  label: '10 + 5',
  baseMs: 600_000,
  incrementMs: 5_000
};

describe('MCP text formatting', () => {
  it('shows the clock in game state and list lines', () => {
    const timed = game(RAPID);
    const state = formatState(timed, { includePgn: false });

    expect(state).toContain('Clock: 10 + 5 (+5s) — White');
    expect(state).toContain('· Black 10:00 · White to move');
    expect(formatGameLine(timed.toPublic())).toContain('| 10 + 5 |');
  });

  it('omits the clock line for untimed games', () => {
    expect(formatState(game(), { includePgn: false })).not.toContain('Clock:');
  });

  it('describes a timeout result', () => {
    const timed = game({ ...RAPID, baseMs: 1_000, incrementMs: 0 });
    timed.settleClock(Date.now() + 2_000);

    expect(describeStatus(timed.toPublic())).toBe(
      'Timeout — Black wins (white ran out of time).'
    );
    expect(formatState(timed, { includePgn: false })).toContain('Clock: 10 + 5 — White 0:00');
  });
});
