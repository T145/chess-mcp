import type { CSSProperties } from 'react';
import { defaultPieces, type PieceRenderObject } from 'react-chessboard';

import {
  isBuiltinPieceTheme,
  pieceKey,
  pieceUrl,
  type PieceColor,
  type PieceKind,
  type PieceTheme
} from './pieceThemes';

const RENDERERS = [
  ['wK', 'white', 'k'],
  ['wQ', 'white', 'q'],
  ['wR', 'white', 'r'],
  ['wB', 'white', 'b'],
  ['wN', 'white', 'n'],
  ['wP', 'white', 'p'],
  ['bK', 'black', 'k'],
  ['bQ', 'black', 'q'],
  ['bR', 'black', 'r'],
  ['bB', 'black', 'b'],
  ['bN', 'black', 'n'],
  ['bP', 'black', 'p']
] as const satisfies readonly (readonly [string, PieceColor, PieceKind])[];

/**
 * react-chessboard expects a map of FEN piece keys ("wK", "bP", ...) to render
 * functions. The built-in theme is the library's own map; vendored sets become
 * images that fill the square and let the board's drag layer handle input.
 */
export function createPieceRenderers(theme: PieceTheme): PieceRenderObject {
  if (isBuiltinPieceTheme(theme)) return defaultPieces;

  const renderers: PieceRenderObject = {};
  for (const [key, color, kind] of RENDERERS) {
    renderers[key] = (props) => (
      <img
        src={pieceUrl(theme, color, kind)}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          ...props?.svgStyle
        }}
      />
    );
  }
  return renderers;
}

interface PieceImageProps {
  theme: PieceTheme;
  color: PieceColor;
  kind: PieceKind;
  className?: string;
  style?: CSSProperties;
}

/** One themed piece for previews, captured rows, and the promotion chooser. */
export function PieceImage({ theme, color, kind, className, style }: PieceImageProps) {
  if (isBuiltinPieceTheme(theme)) {
    const key = pieceKey(color, kind);
    const renderPiece = defaultPieces[key];
    if (!renderPiece) return null;
    return (
      <span className={className} aria-hidden style={{ display: 'inline-flex', ...style }}>
        {renderPiece({ svgStyle: { width: '100%', height: '100%' } })}
      </span>
    );
  }

  return (
    <img
      src={pieceUrl(theme, color, kind)}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ objectFit: 'contain', pointerEvents: 'none', ...style }}
    />
  );
}
