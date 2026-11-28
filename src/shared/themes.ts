export type PieceColor = 'white' | 'black';
export type PieceKind = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export const PIECE_CODES = [
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP'
] as const;

export type PieceCode = (typeof PIECE_CODES)[number];

const PIECE_KEYS: Record<PieceColor, Record<PieceKind, PieceCode>> = {
  white: { k: 'wK', q: 'wQ', r: 'wR', b: 'wB', n: 'wN', p: 'wP' },
  black: { k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP' }
};

export function pieceCode(color: PieceColor, kind: PieceKind): PieceCode {
  return PIECE_KEYS[color][kind];
}

export type ThemeKind = 'builtin' | 'open' | 'local';

export interface ThemeMetadata {
  id: string;
  name: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
  sourceUrl: string;
}

/** A resolved theme as sent to the web app. */
export interface BuiltinCatalogEntry extends ThemeMetadata {
  kind: 'builtin';
}

export interface RuntimeCatalogEntry extends ThemeMetadata {
  kind: 'open' | 'local';
  baseUrl: string;
  extension: 'svg' | 'png';
}

export type ThemeCatalogEntry = BuiltinCatalogEntry | RuntimeCatalogEntry;

export interface BuiltinThemeDefinition extends ThemeMetadata {
  kind: 'builtin';
}

export type ThemeAssetSource =
  | { type: 'lichess'; directory: string }
  | { type: 'chesscom'; slug: string }
  | { type: 'files'; files: Record<PieceCode, string> };

export interface RuntimeThemeDefinition extends ThemeMetadata {
  kind: 'open' | 'local';
  extension: 'svg' | 'png';
  assetSource: ThemeAssetSource;
}

export interface OpenThemeDefinition extends RuntimeThemeDefinition {
  kind: 'open';
}

export interface LocalThemeDefinition extends RuntimeThemeDefinition {
  kind: 'local';
}

export type ThemeDefinition = BuiltinThemeDefinition | RuntimeThemeDefinition;

export type ThemeAssetPhase = 'disabled' | 'idle' | 'downloading' | 'ready' | 'failed';

export interface ThemeAssetStatus {
  phase: ThemeAssetPhase;
  ready: number;
  total: number;
  error: string | null;
}

export interface ThemeCatalogResponse {
  themes: ThemeCatalogEntry[];
  status: ThemeAssetStatus;
}

export const BUILTIN_THEME: BuiltinThemeDefinition = {
  id: 'default',
  name: 'Default',
  author: 'Colin M.L. Burnett (Cburnett)',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
  source: 'Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces',
  kind: 'builtin'
};

function openTheme(
  id: string,
  name: string,
  author: string,
  license: string,
  licenseUrl: string,
  directory: string
): OpenThemeDefinition {
  return {
    id,
    name,
    author,
    license,
    licenseUrl,
    source: 'Lichess',
    sourceUrl: `https://github.com/lichess-org/lila/tree/master/public/piece/${directory}`,
    kind: 'open',
    extension: 'svg',
    assetSource: { type: 'lichess', directory }
  };
}

const LICHESS_CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
const LICHESS_CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const LICHESS_CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const CHESS_ART_MIT = 'https://github.com/maurimo/chess-art/blob/main/LICENSE';

export const OPEN_THEMES: readonly OpenThemeDefinition[] = [
  openTheme(
    'chessnut',
    'Chessnut',
    'Alexis Luengas',
    'Apache-2.0',
    'https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt',
    'chessnut'
  ),
  openTheme('kiwen-suwi', 'Kiwen Suwi', 'neverRare', 'CC BY 4.0', LICHESS_CC_BY_4, 'kiwen-suwi'),
  openTheme('rhosgfx', 'Rhosgfx', 'RhosGFX', 'CC0 1.0', LICHESS_CC0, 'rhosgfx'),
  openTheme('papercut', 'Papercut', 'Nikolay Anzarov', 'CC BY 4.0', LICHESS_CC_BY_4, 'papercut'),
  openTheme('totoy', 'Totoy', 'Kosal Sen', 'CC BY 4.0', LICHESS_CC_BY_4, 'totoy'),
  openTheme('firi', 'Firi', 'James Faure', 'CC BY 4.0', LICHESS_CC_BY_4, 'firi'),
  openTheme('shapes', 'Shapes', 'flugsio', 'CC BY-SA 4.0', LICHESS_CC_BY_SA_4, 'shapes'),
  openTheme('fantasy', 'Fantasy', 'Maurizio Monge', 'MIT', CHESS_ART_MIT, 'fantasy'),
  openTheme('spatial', 'Spatial', 'Maurizio Monge', 'MIT', CHESS_ART_MIT, 'spatial'),
  openTheme('celtic', 'Celtic', 'Maurizio Monge', 'MIT', CHESS_ART_MIT, 'celtic')
];

function chesscomTheme(slug: string, name: string): LocalThemeDefinition {
  return {
    id: `chesscom-${slug}`,
    name,
    author: 'Chess.com',
    license: 'All rights reserved',
    licenseUrl: 'https://www.chess.com/legal',
    source: 'Chess.com',
    sourceUrl: 'https://www.chess.com',
    kind: 'local',
    extension: 'png',
    assetSource: { type: 'chesscom', slug }
  };
}

export const CHESSCOM_THEMES: readonly LocalThemeDefinition[] = [
  chesscomTheme('neo', 'NEO'),
  chesscomTheme('wood', 'Wood'),
  chesscomTheme('glass', 'Glass'),
  chesscomTheme('alpha', 'Alpha'),
  chesscomTheme('book', 'Book'),
  chesscomTheme('bubblegum', 'Bubblegum'),
  chesscomTheme('cases', 'Cases'),
  chesscomTheme('club', 'Club'),
  chesscomTheme('condal', 'Condal'),
  chesscomTheme('dash', 'Dash'),
  chesscomTheme('game_room', 'Game Room'),
  chesscomTheme('gothic', 'Gothic'),
  chesscomTheme('graffiti', 'Graffiti'),
  chesscomTheme('light', 'Light'),
  chesscomTheme('lolz', 'Lolz'),
  chesscomTheme('marble', 'Marble'),
  chesscomTheme('maya', 'Maya'),
  chesscomTheme('metal', 'Metal'),
  chesscomTheme('modern', 'Modern'),
  chesscomTheme('nature', 'Nature'),
  chesscomTheme('newspaper', 'Newspaper'),
  chesscomTheme('ocean', 'Ocean'),
  chesscomTheme('sky', 'Sky'),
  chesscomTheme('space', 'Space'),
  chesscomTheme('tigers', 'Tigers'),
  chesscomTheme('tournament', 'Tournament'),
  chesscomTheme('vintage', 'Vintage'),
  chesscomTheme('8_bit', '8 Bit'),
  chesscomTheme('neo_wood', 'Neo Wood'),
  chesscomTheme('neon', 'Neon'),
  chesscomTheme('3d_chesskid', '3D Chesskid'),
  chesscomTheme('3d_plastic', '3D Plastic'),
  chesscomTheme('3d_staunton', '3D Staunton'),
  chesscomTheme('3d_wood', '3D Wood'),
  chesscomTheme('chesskid', 'Chesskid'),
  chesscomTheme('clash_chess', 'Clash Chess'),
  chesscomTheme('dark', 'Dark'),
  chesscomTheme('blindfold', 'Blindfold'),
  chesscomTheme('luca', 'Luca'),
  chesscomTheme('bases', 'Bases')
];

const NEO_ANGLE_BASE = 'https://neuedeutsche.com/pieces/piece-stroke-angle';

const NEO_ANGLE_FILES: Record<PieceCode, string> = {
  wK: `${NEO_ANGLE_BASE}-light-king.png`,
  wQ: `${NEO_ANGLE_BASE}-light-queen.png`,
  wR: `${NEO_ANGLE_BASE}-light-rook.png`,
  wB: `${NEO_ANGLE_BASE}-light-bishop.png`,
  wN: `${NEO_ANGLE_BASE}-light-knight.png`,
  wP: `${NEO_ANGLE_BASE}-light-pawn.png`,
  bK: `${NEO_ANGLE_BASE}-dark-king.png`,
  bQ: `${NEO_ANGLE_BASE}-dark-queen.png`,
  bR: `${NEO_ANGLE_BASE}-dark-rook.png`,
  bB: `${NEO_ANGLE_BASE}-dark-bishop.png`,
  bN: `${NEO_ANGLE_BASE}-dark-knight.png`,
  bP: `${NEO_ANGLE_BASE}-dark-pawn.png`
};

export const NEO_ANGLE_THEME: LocalThemeDefinition = {
  id: 'chesscom-neo_angle',
  name: 'Neo Angle',
  author: 'Wolf Bōese (NeueDeutsche)',
  license: 'All rights reserved',
  licenseUrl: 'https://neuedeutsche.com/neo-angle/',
  source: 'NeueDeutsche',
  sourceUrl: 'https://neuedeutsche.com/neo-angle/',
  kind: 'local',
  extension: 'png',
  assetSource: { type: 'files', files: NEO_ANGLE_FILES }
};

export const LOCAL_THEMES: readonly LocalThemeDefinition[] = [
  ...CHESSCOM_THEMES,
  NEO_ANGLE_THEME
];

export const RUNTIME_THEMES: readonly RuntimeThemeDefinition[] = [
  ...OPEN_THEMES,
  ...LOCAL_THEMES
];

export const ALL_THEMES: readonly ThemeDefinition[] = [
  BUILTIN_THEME,
  ...RUNTIME_THEMES
];

export function themeEntry(theme: ThemeDefinition, baseUrl?: string): ThemeCatalogEntry {
  const metadata: ThemeMetadata = {
    id: theme.id,
    name: theme.name,
    author: theme.author,
    license: theme.license,
    licenseUrl: theme.licenseUrl,
    source: theme.source,
    sourceUrl: theme.sourceUrl
  };
  if (theme.kind === 'open') {
    return { ...metadata, kind: 'open', baseUrl: baseUrl ?? `/theme-assets/${theme.id}`, extension: theme.extension };
  }
  if (theme.kind === 'local') {
    return { ...metadata, kind: 'local', baseUrl: baseUrl ?? `/theme-assets/${theme.id}`, extension: theme.extension };
  }
  return { ...metadata, kind: 'builtin' };
}

/** Catalog with only the always-available built-in set. */
export function baseThemeCatalog(): ThemeCatalogResponse {
  return {
    themes: [themeEntry(BUILTIN_THEME)],
    status: {
      phase: 'disabled',
      ready: 0,
      total: RUNTIME_THEMES.length,
      error: null
    }
  };
}
