import { Chess, SQUARES, type Square } from 'chess.js';
import { Chessboard, getRelativeCoords } from 'react-chessboard';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { MoveInput, MoveRecord, PublicGame } from '../../../src/shared/protocol';
import { createPieceRenderers, PieceImage } from '../lib/pieceRenderers';
import { usePieceTheme } from '../lib/pieceThemes';

interface BoardProps {
  game: PublicGame;
  orientation: 'white' | 'black';
  canMove: boolean;
  onMove: (move: MoveInput) => void;
  /** Review mode: show this FEN instead of the live game position. */
  position?: string;
  /** Review mode: highlight this move instead of the game's last move. */
  lastMove?: MoveRecord | null;
  /** Review mode: draw a green arrow to the engine's recommended move. */
  bestMove?: { from: string; to: string } | null;
}

interface PendingPromotion {
  from: string;
  to: string;
}

interface ArrowGeometry {
  stem: string;
  head: string;
}

interface Point {
  x: number;
  y: number;
}

const SQUARE_NAME = /^[a-h][1-8]$/;

function formatPoint(point: Point): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

/**
 * A knight is the only piece that changes file and rank by 1 and 2, so the
 * shape can be inferred from the squares alone. Returns the elbow of the L
 * (travelling the two-square leg first), or null for every other move.
 */
function knightElbow(fromSquare: string, toSquare: string, from: Point, to: Point): Point | null {
  if (!SQUARE_NAME.test(fromSquare) || !SQUARE_NAME.test(toSquare)) return null;
  const files = Math.abs(fromSquare.charCodeAt(0) - toSquare.charCodeAt(0));
  const ranks = Math.abs(fromSquare.charCodeAt(1) - toSquare.charCodeAt(1));
  if (!((files === 1 && ranks === 2) || (files === 2 && ranks === 1))) return null;
  return ranks > files ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
}

const BOARD_VIEWBOX = 2048;
const BOARD_COLUMNS = 8;
const BOARD_ROWS = 8;
const SQUARE_SIZE = BOARD_VIEWBOX / BOARD_COLUMNS;

/**
 * Build a clean arrow with a stem that stops at the triangle's base. Drawing
 * the head separately avoids react-chessboard's marker/stem overlap. Knight
 * arrows turn at a sharp right angle so they trace the piece's L-shaped path.
 */
function arrowGeometry(
  orientation: 'white' | 'black',
  fromSquare: string,
  toSquare: string
): ArrowGeometry | null {
  if (fromSquare === toSquare) return null;
  if (!SQUARE_NAME.test(fromSquare) || !SQUARE_NAME.test(toSquare)) return null;
  const from = getRelativeCoords(orientation, BOARD_VIEWBOX, BOARD_COLUMNS, BOARD_ROWS, fromSquare);
  const to = getRelativeCoords(orientation, BOARD_VIEWBOX, BOARD_COLUMNS, BOARD_ROWS, toSquare);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1) return null;

  const elbow = knightElbow(fromSquare, toSquare, from, to);

  // The head always follows the stem's final leg — the short leg of a knight's L.
  const approachX = elbow ? to.x - elbow.x : dx;
  const approachY = elbow ? to.y - elbow.y : dy;
  const approachLength = Math.hypot(approachX, approachY);
  const ux = approachX / approachLength;
  const uy = approachY / approachLength;
  const px = -uy;
  const py = ux;

  // Leave the origin square along the first leg (the long one for a knight).
  const leadX = elbow ? elbow.x - from.x : dx;
  const leadY = elbow ? elbow.y - from.y : dy;
  const leadLength = Math.hypot(leadX, leadY);
  const start = {
    x: from.x + (leadX / leadLength) * SQUARE_SIZE * 0.12,
    y: from.y + (leadY / leadLength) * SQUARE_SIZE * 0.12
  };
  const tip = {
    x: to.x - ux * SQUARE_SIZE * 0.28,
    y: to.y - uy * SQUARE_SIZE * 0.28
  };
  const base = {
    x: tip.x - ux * SQUARE_SIZE * 0.24,
    y: tip.y - uy * SQUARE_SIZE * 0.24
  };
  const halfWidth = SQUARE_SIZE * 0.16;
  const left = { x: base.x + px * halfWidth, y: base.y + py * halfWidth };
  const right = { x: base.x - px * halfWidth, y: base.y - py * halfWidth };

  let stem: string;
  if (elbow) {
    // Sharp right-angle elbow so the arrow traces the piece's L-shaped path.
    stem = `M${formatPoint(start)} L${formatPoint(elbow)} L${formatPoint(base)}`;
  } else {
    stem = `M${formatPoint(start)} L${formatPoint(base)}`;
  }

  return {
    stem,
    head: `${formatPoint(tip)} ${formatPoint(left)} ${formatPoint(right)}`
  };
}

const LIGHT_SQUARE = '#f0d9b5';
const DARK_SQUARE = '#b58863';
const SQUARE_SET = new Set<string>(SQUARES);

function isSquare(value: string): value is Square {
  return SQUARE_SET.has(value);
}

function kingSquare(chess: Chess, color: 'w' | 'b'): string | null {
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.type === 'k' && piece.color === color) return piece.square;
    }
  }
  return null;
}

export function Board({
  game,
  orientation,
  canMove,
  onMove,
  position,
  lastMove: lastMoveOverride,
  bestMove
}: BoardProps) {
  const fen = position ?? game.fen;
  const lastMove = lastMoveOverride === undefined ? game.lastMove : lastMoveOverride;
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const promotionDialog = useRef<HTMLDialogElement>(null);
  const [positionFen, setPositionFen] = useState(fen);
  const pieceTheme = usePieceTheme();
  const pieces = useMemo(() => createPieceRenderers(pieceTheme), [pieceTheme]);

  // Adjust transient UI state during render when the server position changes.
  // This avoids an effect that would cause an extra render pass.
  if (positionFen !== fen) {
    setPositionFen(fen);
    setSelected(null);
    setPendingPromotion(null);
  }

  useEffect(() => {
    const dialog = promotionDialog.current;
    if (!dialog) return;
    if (pendingPromotion && !dialog.open) dialog.showModal();
    if (!pendingPromotion && dialog.open) dialog.close();
  }, [pendingPromotion]);

  const destinationMoves = useMemo(() => {
    if (!selected || !isSquare(selected)) return [];
    try {
      return chess.moves({ square: selected, verbose: true });
    } catch {
      return [];
    }
  }, [chess, selected]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};

    if (lastMove) {
      styles[lastMove.from] = { background: 'rgba(255, 213, 79, 0.28)' };
      styles[lastMove.to] = { background: 'rgba(255, 213, 79, 0.36)' };
    }

    if (selected) {
      styles[selected] = {
        ...styles[selected],
        background: 'rgba(127, 166, 80, 0.42)'
      };
    }

    for (const move of destinationMoves) {
      const capture = Boolean(move.captured);
      styles[move.to] = {
        ...styles[move.to],
        background: capture
          ? 'radial-gradient(circle, transparent 54%, rgba(13, 16, 20, 0.28) 55%)'
          : 'radial-gradient(circle, rgba(13, 16, 20, 0.22) 18%, transparent 19%)'
      };
    }

    if (chess.inCheck()) {
      const king = kingSquare(chess, chess.turn());
      if (king) {
        styles[king] = {
          ...styles[king],
          background: 'radial-gradient(circle, rgba(224, 93, 93, 0.85) 12%, transparent 68%)'
        };
      }
    }

    return styles;
  }, [chess, destinationMoves, lastMove, selected]);

  const needsPromotion = (from: string, to: string): boolean => {
    if (!isSquare(from) || !isSquare(to)) return false;
    const piece = chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    const targetRank = to[1];
    return (
      (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')
    );
  };

  const attemptMove = (from: string, to: string): boolean => {
    if (!canMove || !isSquare(from) || !isSquare(to)) return false;

    const legal = chess.moves({ square: from, verbose: true }).some((move) => move.to === to);
    if (!legal) return false;

    if (needsPromotion(from, to)) {
      setPendingPromotion({ from, to });
      setSelected(null);
      return false;
    }

    setSelected(null);
    onMove({ from, to });
    return true;
  };

  const onPieceDrop = ({
    sourceSquare,
    targetSquare
  }: {
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean => {
    if (!targetSquare) return false;
    return attemptMove(sourceSquare, targetSquare);
  };

  const onSquareClick = ({
    piece,
    square
  }: {
    piece: { pieceType: string } | null;
    square: string;
  }) => {
    if (!canMove) return;

    if (selected) {
      if (square === selected) {
        setSelected(null);
        return;
      }
      if (attemptMove(selected, square)) return;
    }

    if (!piece) {
      setSelected(null);
      return;
    }

    if (piece.pieceType.startsWith(chess.turn())) {
      setSelected(square === selected ? null : square);
    } else {
      setSelected(null);
    }
  };

  const playPromotion = (promotion: 'q' | 'r' | 'b' | 'n') => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    onMove({ from, to, promotion });
  };

  const promotionColor = chess.turn() === 'w' ? 'white' : 'black';

  // Played moves are shown by the lit from/to squares, so the arrow is reserved
  // for the engine's recommendation in review mode.
  const arrowColor = 'rgba(124, 240, 109, 0.9)';
  const arrowShape = bestMove ? arrowGeometry(orientation, bestMove.from, bestMove.to) : null;

  return (
    <div className="board-shell relative">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          pieces,
          allowDragging: canMove && !pendingPromotion,
          canDragPiece: ({ piece }) =>
            canMove && !pendingPromotion && piece.pieceType.startsWith(chess.turn()),
          onPieceDrop,
          onSquareClick,
          squareStyles,
          lightSquareStyle: { backgroundColor: LIGHT_SQUARE },
          darkSquareStyle: { backgroundColor: DARK_SQUARE },
          dropSquareStyle: { boxShadow: 'inset 0 0 0 3px rgba(255,255,255,0.55)' },
          animationDurationInMs: 180,
          showAnimations: true,
          showNotation: true,
          boardStyle: { borderRadius: 0 },
          allowDrawingArrows: false
        }}
      />
      {arrowShape && (
        <svg
          viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
          className="pointer-events-none absolute inset-0 z-30 h-full w-full"
          aria-hidden="true"
        >
          <path
            d={arrowShape.stem}
            fill="none"
            stroke={arrowColor}
            strokeWidth={SQUARE_SIZE * 0.1}
            strokeLinecap="round"
            strokeLinejoin="miter"
          />
          <polygon points={arrowShape.head} fill={arrowColor} />
        </svg>
      )}

      <dialog
        ref={promotionDialog}
        className="dialog-panel rounded-xl border border-line bg-panel p-5 text-ink shadow-2xl"
        onCancel={(event) => {
          event.preventDefault();
          setPendingPromotion(null);
        }}
        onClose={() => setPendingPromotion(null)}
      >
        <p className="mb-3 text-sm font-semibold">Promote pawn to</p>
        <div className="grid grid-cols-4 gap-2">
          {(['q', 'r', 'b', 'n'] as const).map((piece) => (
            <button
              key={piece}
              type="button"
              className="btn btn-secondary flex h-14 items-center justify-center"
              onClick={() => playPromotion(piece)}
              aria-label={`Promote to ${piece}`}
            >
              <PieceImage
                theme={pieceTheme}
                color={promotionColor}
                kind={piece}
                className="h-10 w-10"
              />
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
