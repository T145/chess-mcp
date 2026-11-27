import { useState, type FormEvent } from 'react';

import type { CreateGameColor } from '../../../src/shared/protocol';
import { api } from '../lib/api';
import { mergeGame } from '../lib/live';
import { getPlayerName, saveIdentity, setPlayerName } from '../lib/player';
import { navigate } from '../lib/router';
import { Dialog } from './Dialog';

const COLORS: Array<{ value: CreateGameColor; label: string; hint: string }> = [
  { value: 'white', label: 'White', hint: 'You move first' },
  { value: 'black', label: 'Black', hint: 'Opponent moves first' },
  { value: 'random', label: 'Random', hint: 'Let the server decide' },
  { value: 'none', label: 'Open board', hint: 'No seat yet — invite two players' }
];

export function NewGameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(getPlayerName());
  const [color, setColor] = useState<CreateGameColor>('white');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim() || 'Player';
      setPlayerName(trimmed);
      const created = await api.createGame({ name: trimmed, color });
      if (created.seat && created.token) {
        saveIdentity(created.game.id, { seat: created.seat, token: created.token });
      }
      mergeGame(created.game);
      onClose();
      navigate(`/game/${created.game.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New game">
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Your name
          </span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="Player"
          />
        </label>

        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Play as
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setColor(option.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  color === option.value
                    ? 'border-accent/70 bg-accent/10'
                    : 'border-line bg-panel-2 hover:border-slate-500/60'
                }`}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs leading-5 text-muted">
          After creating, you can copy an agent prompt (MCP over Streamable HTTP) or share the game
          link with another human. Everything stays on this machine.
        </p>

        {error && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create game'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
