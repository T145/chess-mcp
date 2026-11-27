import { Chess, type Move } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { buildReview, REVIEW_THRESHOLDS } from '../src/review/classify.js';
import type { PositionEval, RawEngineLine } from '../src/engine/uci.js';
import type { Color, GameStatus, MoveRecord } from '../src/shared/protocol.js';
import { MATE_CP, winProbability } from '../src/shared/eval.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PLAYING: GameStatus = { phase: 'playing', winner: null, reason: '' };

function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** Build an engine line from a White-POV score. */
function line(fen: string, cpWhite: number, uci: string, multipv = 1): RawEngineLine {
  const cp = turnOf(fen) === 'white' ? cpWhite : -cpWhite;
  return { multipv, cp, mate: null, pv: [uci], depth: 14, bound: false };
}

function evaluation(
  fen: string,
  cpWhite: number,
  best: string | null,
  secondCpWhite?: number
): PositionEval {
  const lines = [line(fen, cpWhite, best ?? '0000', 1)];
  if (secondCpWhite !== undefined) lines.push(line(fen, secondCpWhite, 'a7a6', 2));
  return { bestMoveUci: best, lines, depth: 14 };
}

function record(move: Move): MoveRecord {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    color: move.color === 'w' ? 'white' : 'black',
    ...(move.promotion ? { promotion: move.promotion } : {})
  };
}

function oneMove(
  san: string,
  beforeCp: number,
  afterCp: number,
  best: string | null,
  secondCp?: number
) {
  const chess = new Chess(START);
  const move = chess.move(san);
  const fen0 = START;
  const fen1 = chess.fen();
  return buildReview({
    gameId: 'testgame',
    initialFen: START,
    moves: [record(move)],
    fens: [fen0, fen1],
    analyses: [evaluation(fen0, beforeCp, best, secondCp), evaluation(fen1, afterCp, 'e7e5')],
    finalStatus: PLAYING,
    engineName: 'Fakefish',
    depth: 14,
    durationMs: 10,
    now: 1
  });
}

describe('review classification', () => {
  it('labels the engine’s top move as best', () => {
    const review = oneMove('e4', 20, 20, 'e2e4');
    expect(review.moves[0]?.quality).toBe('best');
    expect(review.moves[0]?.bestMoveSan).toBe('e4');
    expect(review.accuracy.white).toBe(100);
    expect(review.evalGraph).toEqual([20, 20]);
    expect(review.counts.white.best).toBe(1);
  });

  it('classifies win-probability drops into the expected bands', () => {
    const cases: Array<[string, number, string]> = [
      ['excellent', -20, 'excellent'],
      ['good', -40, 'good'],
      ['inaccuracy', -60, 'inaccuracy'],
      ['mistake', -120, 'mistake'],
      ['blunder', -300, 'blunder']
    ];
    for (const [, drop, expected] of cases) {
      const review = oneMove('f3', 0, drop, 'e2e4');
      expect(review.moves[0]?.quality).toBe(expected);
    }
  });

  it('promotes the only good move to great', () => {
    const review = oneMove('e4', 0, 0, 'e2e4', -300);
    expect(winProbability(0) - winProbability(-300)).toBeGreaterThan(
      REVIEW_THRESHOLDS.greatGap
    );
    expect(review.moves[0]?.quality).toBe('great');
  });

  it('detects a brilliant sacrifice that keeps the mover winning', () => {
    const fen0 = '4k3/8/6p1/8/8/8/4Q3/4K3 w - - 0 1';
    const fen1 = '4k3/8/6p1/7Q/8/8/8/4K3 b - - 1 1';
    const review = buildReview({
      gameId: 'sacrifice',
      initialFen: fen0,
      moves: [{ san: 'Qh5', from: 'e2', to: 'h5', color: 'white' }],
      fens: [fen0, fen1],
      analyses: [evaluation(fen0, 200, 'e2h5'), evaluation(fen1, 200, 'g6h5')],
      finalStatus: PLAYING,
      engineName: 'Fakefish',
      depth: 14,
      durationMs: 10,
      now: 1
    });

    expect(review.moves[0]?.quality).toBe('brilliant');
    expect(review.moves[0]?.quality).not.toBe('best');
  });

  it('keeps a sound queen move as best when nothing can capture it', () => {
    const review = oneMove('e4', 0, 0, 'e2e4');
    expect(review.moves[0]?.quality).toBe('best');
  });

  it('penalizes missing a forced mate even when still winning', () => {
    const review = oneMove('f3', MATE_CP, 500, 'e2e4');
    expect(review.moves[0]?.quality).toBe('mistake');
  });

  it('uses mate scores at the end of a game', () => {
    const chess = new Chess();
    const moves: MoveRecord[] = [];
    const fens = [chess.fen()];
    for (const san of ['f3', 'e5', 'g4', 'Qh4#']) {
      moves.push(record(chess.move(san)));
      fens.push(chess.fen());
    }
    const analyses = fens.map((fen, index) =>
      index === fens.length - 1
        ? { bestMoveUci: null, lines: [], depth: 14 }
        : evaluation(fen, index === 0 ? 0 : -200, moves[index] ? `${moves[index].from}${moves[index].to}` : null)
    );
    analyses[3] = evaluation(fens[3] ?? START, 0, 'd8h4');

    const review = buildReview({
      gameId: 'fools',
      initialFen: START,
      moves,
      fens,
      analyses,
      finalStatus: { phase: 'checkmate', winner: 'black', reason: 'checkmate' },
      engineName: 'Fakefish',
      depth: 14,
      durationMs: 10,
      now: 1
    });

    expect(review.evalGraph.at(-1)).toBe(-MATE_CP);
    expect(review.moves.at(-1)?.quality).toBe('best');
    expect(review.counts.black.best).toBe(2);
  });

  it('rejects mismatched analysis input', () => {
    expect(() =>
      buildReview({
        gameId: 'bad',
        initialFen: START,
        moves: [],
        fens: [START],
        analyses: [],
        finalStatus: PLAYING,
        engineName: 'Fakefish',
        depth: 14,
        durationMs: 0
      })
    ).toThrow(/does not match/);
  });
});
