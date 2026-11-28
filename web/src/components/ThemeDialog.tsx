import { useEffect } from 'react';

import { PieceImage } from '../lib/pieceRenderers';
import {
  loadThemeCatalog,
  setPieceTheme,
  usePieceTheme,
  usePieceThemes,
  type PieceColor,
  type PieceKind,
  type PieceTheme
} from '../lib/pieceThemes';
import { Dialog } from './Dialog';
import { CheckIcon } from './Icons';

const PREVIEW = [
  { color: 'white', kind: 'k', light: true },
  { color: 'black', kind: 'q', light: false },
  { color: 'white', kind: 'n', light: false },
  { color: 'black', kind: 'p', light: true }
] as const satisfies readonly { color: PieceColor; kind: PieceKind; light: boolean }[];

function ThemePreview({ theme }: { theme: PieceTheme }) {
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-md border border-line">
      {PREVIEW.map((cell) => (
        <div
          key={`${cell.color}-${cell.kind}`}
          className="flex aspect-square items-center justify-center"
          style={{ backgroundColor: cell.light ? '#f0d9b5' : '#b58863' }}
        >
          <PieceImage
            theme={theme}
            color={cell.color}
            kind={cell.kind}
            className="h-[84%] w-[84%]"
          />
        </div>
      ))}
    </div>
  );
}

export function ThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selected = usePieceTheme();
  const themes = usePieceThemes();

  useEffect(() => {
    if (!open) return undefined;
    void loadThemeCatalog();
    const timer = window.setInterval(() => void loadThemeCatalog(), 1_500);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Piece theme"
      closeButton
      scrollable
      widthClass="max-w-2xl"
    >
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">Piece theme</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const active = theme.id === selected.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPieceTheme(theme.id)}
                className={`rounded-xl border p-2 text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-panel-2 hover:border-muted/40'
                }`}
              >
                <ThemePreview theme={theme} />
                <span className="mt-2 flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{theme.name}</span>
                  {active && <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-accent-strong" />}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted">
                  by {theme.author}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted">
                  {theme.license} · {theme.source}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </Dialog>
  );
}
