import { Chess, SQUARES, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';

import type { MoveInput, PublicGame } from '../../../src/shared/protocol';

interface BoardProps {
  game: PublicGame;
  orientation: 'white' | 'black';
  canMove: boolean;
  onMove: (move: MoveInput) => void;
}

interface PendingPromotion {
  from: string;
  to: string;
}

const LIGHT_SQUARE = '#ebecd0';
const DARK_SQUARE = '#739552';
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

export function Board({ game, orientation, canMove, onMove }: BoardProps) {
  const chess = useMemo(() => new Chess(game.fen), [game.fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const promotionDialog = useRef<HTMLDialogElement>(null);
  const [positionFen, setPositionFen] = useState(game.fen);

  // Adjust transient UI state during render when the server position changes.
  // This avoids an effect that would cause an extra render pass.
  if (positionFen !== game.fen) {
    setPositionFen(game.fen);
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

    if (game.lastMove) {
      styles[game.lastMove.from] = { background: 'rgba(255, 213, 79, 0.28)' };
      styles[game.lastMove.to] = { background: 'rgba(255, 213, 79, 0.36)' };
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

    if (game.inCheck) {
      const king = kingSquare(chess, chess.turn());
      if (king) {
        styles[king] = {
          ...styles[king],
          background: 'radial-gradient(circle, rgba(224, 93, 93, 0.85) 12%, transparent 68%)'
        };
      }
    }

    return styles;
  }, [chess, destinationMoves, game.inCheck, game.lastMove, selected]);

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

  return (
    <div className="board-shell">
      <Chessboard
        options={{
          position: game.fen,
          boardOrientation: orientation,
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
          arrows:
            game.lastMove && game.lastMove.from !== game.lastMove.to
              ? [
                  {
                    startSquare: game.lastMove.from,
                    endSquare: game.lastMove.to,
                    color: 'rgba(255, 213, 79, 0.72)'
                  }
                ]
              : []
        }}
      />

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
              className="btn btn-secondary h-14 text-2xl uppercase"
              onClick={() => playPromotion(piece)}
              aria-label={`Promote to ${piece}`}
            >
              {piece}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
