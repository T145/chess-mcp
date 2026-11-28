import { useEffect, useState } from 'react';

import { GameView } from './components/GameView';
import { PaletteIcon, PlusIcon, WifiIcon, WifiOffIcon } from './components/Icons';
import { Lobby } from './components/Lobby';
import { NewGameDialog } from './components/NewGameDialog';
import { ThemeDialog } from './components/ThemeDialog';
import { BRAND_MARK } from './lib/brand';
import { startLive, useLive } from './lib/live';
import { Link, usePathname } from './lib/router';

export function App() {
  const pathname = usePathname();
  const { connected } = useLive();
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => {
    startLive();
  }, []);

  const gameMatch = /^\/game\/([a-f0-9]{8})$/i.exec(pathname);
  const gameId = gameMatch?.[1] ?? null;

  // On a game page the whole app is pinned to the viewport on desktop so the
  // board and sidebar never push each other below the fold. The lobby keeps
  // its normal scrolling page.
  return (
    <div
      className={`flex min-h-screen flex-col ${
        gameId ? 'lg:h-dvh lg:min-h-0 lg:overflow-hidden' : ''
      }`}
    >
      <header className="sticky top-0 z-20 shrink-0 border-b border-line/80 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src={BRAND_MARK.src}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
            />
            <span className="text-sm font-semibold tracking-tight sm:text-base">Chess MCP</span>
          </Link>

          <span className="ml-2 hidden items-center gap-1.5 text-[11px] text-muted sm:flex">
            {connected ? (
              <WifiIcon className="h-3.5 w-3.5 text-accent" />
            ) : (
              <WifiOffIcon className="h-3.5 w-3.5 text-amber-400" />
            )}
            {connected ? 'live' : 'offline'}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost px-2.5 py-1.5 text-xs sm:px-3"
              onClick={() => setThemeOpen(true)}
              title="Piece theme"
              aria-label="Piece theme"
            >
              <PaletteIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Theme</span>
            </button>
            <Link to="/" className="btn btn-ghost hidden px-3 py-1.5 text-xs sm:inline-flex">
              Lobby
            </Link>
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              onClick={() => setNewGameOpen(true)}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New game
            </button>
          </div>
        </div>
      </header>

      <main className={gameId ? 'flex-1 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden' : 'flex-1'}>
        {gameId ? (
          <GameView key={gameId.toLowerCase()} gameId={gameId.toLowerCase()} />
        ) : (
          <Lobby onNewGame={() => setNewGameOpen(true)} />
        )}
      </main>

      {!gameId && (
        <footer className="border-t border-line/70 py-4">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>
              MCP endpoint: <code className="text-ink/80">{window.location.origin}/mcp</code> (Streamable HTTP)
            </span>
            <span>Local only · games live in memory</span>
          </div>
        </footer>
      )}

      {newGameOpen && <NewGameDialog open onClose={() => setNewGameOpen(false)} />}
      {themeOpen && <ThemeDialog open onClose={() => setThemeOpen(false)} />}
    </div>
  );
}
