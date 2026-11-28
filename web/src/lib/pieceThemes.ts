import { useSyncExternalStore } from 'react';

import { api } from './api';

import {
  BUILTIN_THEME,
  baseThemeCatalog,
  pieceCode,
  themeEntry,
  type BuiltinCatalogEntry,
  type PieceColor,
  type PieceKind,
  type ThemeCatalogEntry
} from '../../../src/shared/themes';

export type { PieceCode, PieceColor, PieceKind, ThemeCatalogEntry } from '../../../src/shared/themes';

export type PieceTheme = ThemeCatalogEntry;
export type AssetPieceTheme = Exclude<ThemeCatalogEntry, { kind: 'builtin' }>;

const builtinEntry = themeEntry(BUILTIN_THEME);
if (builtinEntry.kind !== 'builtin') throw new Error('Built-in theme metadata is invalid');

export const BUILTIN_PIECE_THEME: BuiltinCatalogEntry = builtinEntry;
export const DEFAULT_PIECE_THEME = BUILTIN_PIECE_THEME;
export const pieceKey = pieceCode;

const STORAGE_KEY = 'chess-mcp:piece-theme';
const DEFAULT_THEME_ID = BUILTIN_THEME.id;

function sortThemes(themes: readonly ThemeCatalogEntry[]): ThemeCatalogEntry[] {
  const builtin =
    themes.find((theme) => theme.id === DEFAULT_THEME_ID) ?? BUILTIN_PIECE_THEME;
  const rest = themes
    .filter((theme) => theme.id !== DEFAULT_THEME_ID)
    .toSorted((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  return [builtin, ...rest];
}

const FALLBACK_THEMES = sortThemes(baseThemeCatalog().themes);

function readStoredId(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

interface CatalogState {
  themes: readonly ThemeCatalogEntry[];
  selectedId: string;
}

let state: CatalogState = {
  themes: FALLBACK_THEMES,
  selectedId: readStoredId()
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getThemesSnapshot(): readonly ThemeCatalogEntry[] {
  return state.themes;
}

function getSelectedSnapshot(): ThemeCatalogEntry {
  return (
    state.themes.find((theme) => theme.id === state.selectedId) ??
    state.themes[0] ??
    BUILTIN_PIECE_THEME
  );
}

function getFallbackSnapshot(): readonly ThemeCatalogEntry[] {
  return FALLBACK_THEMES;
}

function getFallbackSelectedSnapshot(): ThemeCatalogEntry {
  return BUILTIN_PIECE_THEME;
}

export function usePieceThemes(): readonly ThemeCatalogEntry[] {
  return useSyncExternalStore(subscribe, getThemesSnapshot, getFallbackSnapshot);
}

export function usePieceTheme(): ThemeCatalogEntry {
  return useSyncExternalStore(subscribe, getSelectedSnapshot, getFallbackSelectedSnapshot);
}

export function isBuiltinPieceTheme(theme: ThemeCatalogEntry): theme is BuiltinCatalogEntry {
  return theme.kind === 'builtin';
}

/** Build the static URL for one piece in a runtime theme. */
export function pieceUrl(theme: AssetPieceTheme, color: PieceColor, kind: PieceKind): string {
  const code = pieceKey(color, kind);
  return `${theme.baseUrl}/${code}.${theme.extension}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTheme(value: unknown): ThemeCatalogEntry | null {
  if (!isRecord(value)) return null;
  const { id, name, author, license, licenseUrl, source, sourceUrl, kind } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof author !== 'string' ||
    typeof license !== 'string' ||
    typeof licenseUrl !== 'string' ||
    typeof source !== 'string' ||
    typeof sourceUrl !== 'string'
  ) {
    return null;
  }

  const metadata = { id, name, author, license, licenseUrl, source, sourceUrl };
  if (kind === 'builtin') return { ...metadata, kind };
  if (
    (kind === 'open' || kind === 'local') &&
    typeof value.baseUrl === 'string' &&
    (value.extension === 'svg' || value.extension === 'png')
  ) {
    return { ...metadata, kind, baseUrl: value.baseUrl, extension: value.extension };
  }
  return null;
}

function parseCatalog(value: unknown): ThemeCatalogEntry[] {
  if (!isRecord(value) || !Array.isArray(value.themes)) return [];
  const parsed = value.themes
    .map(parseTheme)
    .filter((theme): theme is ThemeCatalogEntry => theme !== null);
  if (parsed.length === 0) return [];
  const hasBuiltin = parsed.some((theme) => theme.id === DEFAULT_THEME_ID);
  return hasBuiltin ? parsed : [BUILTIN_PIECE_THEME, ...parsed];
}

let pendingLoad: Promise<void> | null = null;

/**
 * Refresh the catalog from the server. The first paint uses only the built-in
 * theme; runtime sets appear as their files become available.
 */
export function loadThemeCatalog(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (pendingLoad) return pendingLoad;

  pendingLoad = (async () => {
    try {
      const raw: unknown = await api.getThemes();
      const parsed = parseCatalog(raw);
      if (parsed.length === 0) return;

      const themes = sortThemes(parsed);
      const changed =
        themes.length !== state.themes.length ||
        themes.some((theme, index) => theme.id !== state.themes[index]?.id);
      if (!changed) return;

      state = { ...state, themes };
      emit();
    } catch {
      // Keep the fallback catalog when the API is unavailable.
    }
  })().finally(() => {
    pendingLoad = null;
  });

  return pendingLoad;
}

export function setPieceTheme(id: string): void {
  if (id === state.selectedId || !state.themes.some((theme) => theme.id === id)) return;
  state = { ...state, selectedId: id };
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing can reject writes; the in-memory choice still applies.
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const selectedId = event.newValue?.trim() || DEFAULT_THEME_ID;
    if (selectedId === state.selectedId) return;
    state = { ...state, selectedId };
    emit();
  });

  void loadThemeCatalog();
}
