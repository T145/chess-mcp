import { Chess, SQUARES } from 'chess.js';
import type { PieceSymbol, Square } from 'chess.js';

import { MATE_CP, accuracyFromWinDrop, winProbability } from '../shared/eval.js';
import { materialBalance } from '../shared/material.js';
import {
  MOVE_QUALITIES,
  type Color,
  type GameStatus,
  type MoveQuality,
  type MoveRecord,
  type MoveReview,
  type ReviewSummary
} from '../shared/protocol.js';
import type { PositionEval, RawEngineLine } from '../engine/uci.js';

export interface ReviewInput {
  gameId: string;
  initialFen: string;
  moves: MoveRecord[];
  /** FEN before each move, plus the final position (length moves.length + 1). */
  fens: string[];
  /** One engine result per FEN. */
  analyses: PositionEval[];
  finalStatus: GameStatus;
  engineName: string;
  depth: number;
  durationMs: number;
  now?: number;
}

export const REVIEW_THRESHOLDS = {
  /** Win-probability drop thresholds, in percentage points. */
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  /** Only-move gap that upgrades the engine's top move to "great". */
  greatGap: 10,
  /** Material (in pawns) sacrificed for "brilliant". */
  brilliantSacrifice: 1,
  /** The mover must still have at least this win probability for "brilliant". */
  brilliantWinFloor: 50
} as const;

function emptyCounts(): Record<MoveQuality, number> {
  return {
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    forced: 0
  };
}

function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function lineAt(analysis: PositionEval | undefined, multipv: number): RawEngineLine | undefined {
  if (!analysis) return undefined;
  return analysis.lines.find((line) => line.multipv === multipv);
}

/** Convert a side-to-move score to White's point of view. */
function lineCpWhite(line: RawEngineLine, fen: string): number {
  const sign = turnOf(fen) === 'white' ? 1 : -1;
  if (line.mate !== null) return sign * MATE_CP;
  return sign * (line.cp ?? 0);
}

function evalCpWhite(analysis: PositionEval | undefined, fen: string): number {
  const best = lineAt(analysis, 1) ?? analysis?.lines[0];
  return best ? lineCpWhite(best, fen) : 0;
}

function playedUci(move: MoveRecord): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

const SQUARE_SET = new Set<string>(SQUARES);

function isSquare(value: string): value is Square {
  return SQUARE_SET.has(value);
}

function promotionFromUci(value: string | undefined): PieceSymbol | undefined {
  const piece = value?.toLowerCase();
  if (piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n') return piece;
  return undefined;
}

function moveFromUci(chess: Chess, uci: string): ReturnType<Chess['move']> | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(uci);
  const from = match?.[1];
  const to = match?.[2];
  if (!from || !to || !isSquare(from) || !isSquare(to)) return null;
  try {
    return chess.move({ from, to, promotion: promotionFromUci(match?.[3]) });
  } catch {
    return null;
  }
}

function sanForUci(fen: string, uci: string): string | null {
  return moveFromUci(new Chess(fen), uci)?.san ?? null;
}

function fenAfterUci(fen: string, uci: string): string | null {
  return moveFromUci(new Chess(fen), uci)?.after ?? null;
}

/**
 * A "brilliant" move is the engine's top choice and gives up at least a pawn in
 * the engine's main line while the mover stays at or above 50% win probability.
 */
function isSacrifice(input: ReviewInput, index: number): boolean {
  const move = input.moves[index];
  const beforeFen = input.fens[index];
  const afterFen = input.fens[index + 1];
  if (!move || !beforeFen || !afterFen) return false;

  const reply = input.analyses[index + 1]?.bestMoveUci;
  if (!reply) return false;

  const replyFen = fenAfterUci(afterFen, reply);
  if (!replyFen) return false;

  const sign = move.color === 'white' ? 1 : -1;
  const before = sign * materialBalance(beforeFen);
  const afterReply = sign * materialBalance(replyFen);
  return before - afterReply >= REVIEW_THRESHOLDS.brilliantSacrifice;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function qualityOrder(): readonly MoveQuality[] {
  return MOVE_QUALITIES;
}

/**
 * Turn a sequence of engine evaluations into the move labels, per-move accuracy,
 * side accuracy, and the white-POV evaluation graph used by the UI.
 */
export function buildReview(input: ReviewInput): ReviewSummary {
  const { fens, analyses, moves } = input;
  if (fens.length !== moves.length + 1 || analyses.length !== fens.length) {
    throw new Error('Review analysis does not match the game positions.');
  }

  const evalGraph = fens.map((fen, index) => {
    const last = index === fens.length - 1 && fens.length > 1;
    if (last && input.finalStatus.phase === 'checkmate') {
      return input.finalStatus.winner === 'white' ? MATE_CP : -MATE_CP;
    }
    if (last && (input.finalStatus.phase === 'draw' || input.finalStatus.phase === 'stalemate')) {
      return 0;
    }
    return evalCpWhite(analyses[index], fen);
  });

  const counts: Record<Color, Record<MoveQuality, number>> = {
    white: emptyCounts(),
    black: emptyCounts()
  };
  const accuracies: Record<Color, number[]> = { white: [], black: [] };
  const reviews: MoveReview[] = [];

  moves.forEach((move, index) => {
    const fen = fens[index] ?? input.initialFen;
    const analysis = analyses[index];
    const bestLine = lineAt(analysis, 1) ?? analysis?.lines[0];
    const secondLine = lineAt(analysis, 2);
    const bestMoveUci = analysis?.bestMoveUci ?? bestLine?.pv[0] ?? null;
    const isBest =
      bestMoveUci !== null && bestMoveUci.toLowerCase() === playedUci(move).toLowerCase();
    const legalMoves = new Chess(fen).moves().length;
    const forced = legalMoves <= 1;

    const beforeCp = evalGraph[index] ?? 0;
    const afterCp = evalGraph[index + 1] ?? beforeCp;
    const sign = move.color === 'white' ? 1 : -1;
    const beforeMover = sign * beforeCp;
    const afterMover = sign * afterCp;
    const cpLoss = Math.max(0, beforeMover - afterMover);
    const winBefore = winProbability(beforeMover);
    const winAfter = winProbability(afterMover);
    const winDrop = Math.max(0, winBefore - winAfter);
    const accuracy = accuracyFromWinDrop(winDrop);

    const gap =
      bestLine && secondLine
        ? winProbability(sign * lineCpWhite(bestLine, fen)) -
          winProbability(sign * lineCpWhite(secondLine, fen))
        : 0;

    const brilliant =
      isBest &&
      !forced &&
      winAfter >= REVIEW_THRESHOLDS.brilliantWinFloor &&
      isSacrifice(input, index);
    const missedMate =
      beforeMover >= MATE_CP - 100 && afterMover < MATE_CP - 100;

    let quality: MoveQuality;
    if (forced) quality = 'forced';
    else if (missedMate) quality = afterMover <= 0 ? 'blunder' : 'mistake';
    else if (brilliant) quality = 'brilliant';
    else if (isBest && gap >= REVIEW_THRESHOLDS.greatGap) quality = 'great';
    else if (isBest) quality = 'best';
    else if (winDrop < REVIEW_THRESHOLDS.excellent) quality = 'excellent';
    else if (winDrop < REVIEW_THRESHOLDS.good) quality = 'good';
    else if (winDrop < REVIEW_THRESHOLDS.inaccuracy) quality = 'inaccuracy';
    else if (winDrop < REVIEW_THRESHOLDS.mistake) quality = 'mistake';
    else quality = 'blunder';

    counts[move.color][quality] += 1;
    accuracies[move.color].push(accuracy);

    reviews.push({
      ply: index + 1,
      color: move.color,
      san: move.san,
      uci: playedUci(move),
      quality,
      evalBeforeCp: beforeCp,
      evalAfterCp: afterCp,
      cpLoss,
      winBefore: round1(winBefore),
      winAfter: round1(winAfter),
      accuracy: round1(accuracy),
      bestMoveUci,
      bestMoveSan: bestMoveUci ? sanForUci(fen, bestMoveUci) : null,
      pv: bestLine?.pv ?? [],
      depth: bestLine?.depth ?? analysis?.depth ?? 0
    });
  });

  return {
    version: 1,
    gameId: input.gameId,
    moveCount: moves.length,
    engineName: input.engineName,
    depth: input.depth,
    createdAt: input.now ?? Date.now(),
    durationMs: input.durationMs,
    accuracy: {
      white: average(accuracies.white),
      black: average(accuracies.black)
    },
    counts,
    evalGraph,
    moves: reviews
  };
}

