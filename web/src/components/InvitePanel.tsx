import { useState } from 'react';

import type { Color, PublicGame } from '../../../src/shared/protocol';
import { capitalize } from '../lib/status';
import { CheckIcon, CopyIcon } from './Icons';

interface InvitePanelProps {
  game: PublicGame;
  onJoin: (seat: Color) => void;
  joining: boolean;
  /** Render without panel chrome and the duplicate heading, for use inside a Dialog. */
  embedded?: boolean;
}

function agentPrompt(game: PublicGame, seat: Color, origin: string): string {
  return [
    `Use the chess MCP server at ${origin}/mcp (Streamable HTTP).`,
    `Join game ${game.id} as ${seat} with a name of your choice, and keep the seat_token returned by join_game.`,
    `Then loop: call wait_for_move(game_id="${game.id}", seat_token="<your token>"), and when it is your turn call `,
    `make_move(game_id="${game.id}", move="<SAN or UCI>", seat_token="<your token>", note="<your reasoning>").`,
    `Always pass note: check the opponent's threats and the lines your move opens before playing, `,
    `and write that reasoning down — it is your private record (call get_game with your seat_token to `,
    `read it back) and it joins the PGN once the game ends. Your opponent cannot see it while you play.`,
    game.clock
      ? `This game is clocked (${game.clock.label}) — reply promptly or you will be flagged.`
      : '',
    `Repeat until the game ends. Game link: ${origin}/game/${game.id}`
  ]
    .filter((line) => line.length > 0)
    .join(' ');
}

export function InvitePanel({ game, onJoin, joining, embedded = false }: InvitePanelProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = window.location.origin;
  const gameUrl = `${origin}/game/${game.id}`;
  const openSeats = (['white', 'black'] as const).filter(
    (color) => game.seats[color].kind === 'open'
  );

  const copy = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1_600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className={embedded ? undefined : 'panel p-4'}>
      <div className="flex items-center justify-between gap-2">
        {embedded ? (
          <span className="text-xs text-muted">Share the link or copy an agent prompt.</span>
        ) : (
          <h2 className="text-sm font-semibold">Invite a player</h2>
        )}
        <button
          type="button"
          className="btn btn-ghost px-2 py-1 text-xs"
          onClick={() => void copy('link', gameUrl)}
        >
          {copied === 'link' ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          Link
        </button>
      </div>

      <p className="mt-1 text-xs leading-5 text-muted">
        Agents connect over MCP; people join in this browser. Both update the board live.
      </p>

      {openSeats.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
          Both seats are claimed. Share the game link above to let others watch live.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {openSeats.map((seat) => {
            const prompt = agentPrompt(game, seat, origin);
            const key = `prompt-${seat}`;
            return (
              <div key={seat} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {capitalize(seat)} seat
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    onClick={() => void copy(key, prompt)}
                  >
                    {copied === key ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    Agent prompt
                  </button>
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-muted">{prompt}</p>
                <button
                  type="button"
                  className="btn btn-secondary mt-2 w-full py-1.5 text-xs"
                  disabled={joining}
                  onClick={() => onJoin(seat)}
                >
                  Join as {capitalize(seat)}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <details className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-muted">
          MCP client config
        </summary>
        <pre className="scroll-thin mt-2 overflow-x-auto text-[11px] leading-4 text-ink">{`{
  "mcpServers": {
    "chess": { "type": "streamableHttp", "url": "${origin}/mcp" }
  }
}`}</pre>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          The "type" is required: without it, clients fall back to the legacy SSE transport and
          fail to connect.
        </p>
      </details>
    </section>
  );
}
