import type { Color, MoveRecord } from './protocol.js';

export type MaterialPiece = 'q' | 'r' | 'b' | 'n' | 'p';

/** Conventional point values, used for the material advantage badge. */
export const MATERIAL_VALUES: Record<MaterialPiece, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };

/** Pieces in display order: most valuable first. */
export const MATERIAL_ORDER: readonly MaterialPiece[] = ['q', 'r', 'b', 'n', 'p'];

const STARTING_ARMY: Record<MaterialPiece, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };

export interface MaterialTally {
  /** Pieces this side captured, most valuable first (an opponent's losses). */
  captured: MaterialPiece[];
  /** Total point value of {@link captured}. */
  value: number;
}

export interface MaterialSummary {
  /** What each side captured: `white.captured` lists black's lost pieces. */
  white: MaterialTally;
  black: MaterialTally;
  /** Net material in pawns. Positive means white is ahead. */
  advantage: number;
}

function emptyCounts(): Record<MaterialPiece, number> {
  return { q: 0, r: 0, b: 0, n: 0, p: 0 };
}

function pieceFromChar(char: string): MaterialPiece | null {
  const piece = char.toLowerCase();
  if (piece === 'p' || piece === 'n' || piece === 'b' || piece === 'r' || piece === 'q') {
    return piece;
  }
  return null;
}

/**
 * Static material balance of a position in pawns, positive for White. Unlike
 * {@link readMaterial} this only looks at the FEN, so it also handles promotions
 * and mid-game positions without needing the move list.
 */
export function materialBalance(fen: string): number {
  const placement = fen.split(' ')[0] ?? '';
  let balance = 0;

  for (const char of placement) {
    const piece = pieceFromChar(char);
    if (!piece) continue;
    balance += char === char.toUpperCase() ? MATERIAL_VALUES[piece] : -MATERIAL_VALUES[piece];
  }

  return balance;
}

/** Counts the pieces each colour has on the board in the FEN placement field. */
function countOnBoard(placement: string): Record<Color, Record<MaterialPiece, number>> {
  const counts: Record<Color, Record<MaterialPiece, number>> = {
    white: emptyCounts(),
    black: emptyCounts()
  };

  for (const char of placement) {
    const piece = pieceFromChar(char);
    if (!piece) continue;
    const color: Color = char === char.toUpperCase() ? 'white' : 'black';
    counts[color][piece] += 1;
  }

  return counts;
}

/**
 * Starting army for each colour, adjusted for promotions. A promoted pawn is
 * no longer a pawn and the promoted piece is one that was never captured, so
 * this keeps the "missing pieces" maths exact.
 */
function expectedArmy(moves: readonly MoveRecord[]): Record<Color, Record<MaterialPiece, number>> {
  const white: Record<MaterialPiece, number> = { ...STARTING_ARMY };
  const black: Record<MaterialPiece, number> = { ...STARTING_ARMY };

  for (const move of moves) {
    if (!move.promotion) continue;
    const promoted = pieceFromChar(move.promotion);
    if (!promoted) continue;
    const army = move.color === 'white' ? white : black;
    army.p -= 1;
    army[promoted] += 1;
  }

  return { white, black };
}

function tally(missing: Record<MaterialPiece, number>): MaterialTally {
  const captured: MaterialPiece[] = [];
  let value = 0;

  for (const piece of MATERIAL_ORDER) {
    const count = Math.max(0, missing[piece]);
    for (let index = 0; index < count; index += 1) {
      captured.push(piece);
      value += MATERIAL_VALUES[piece];
    }
  }

  return { captured, value };
}

/**
 * Works out what each side has captured by comparing the pieces left on the
 * board with the army each side started with (plus any promotions).
 */
export function readMaterial(fen: string, moves: readonly MoveRecord[] = []): MaterialSummary {
  const placement = fen.split(' ')[0] ?? '';
  const onBoard = countOnBoard(placement);
  const expected = expectedArmy(moves);

  const missing: Record<Color, Record<MaterialPiece, number>> = {
    white: emptyCounts(),
    black: emptyCounts()
  };

  for (const color of ['white', 'black'] as const) {
    for (const piece of MATERIAL_ORDER) {
      missing[color][piece] = expected[color][piece] - onBoard[color][piece];
    }
  }

  // White's captures are the black pieces that are gone, and vice versa.
  const white = tally(missing.black);
  const black = tally(missing.white);

  return { white, black, advantage: white.value - black.value };
}
