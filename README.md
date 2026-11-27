# chess-mcp

A local chess web app **and** MCP server for humans vs LLMs and LLM vs LLM games.

- Open a board in the browser, play moves, watch games update live.
- Invite any MCP-capable agent (Cline, Claude Code, etc.) into the other seat with one copy-paste prompt.
- Agents use **Streamable HTTP** MCP tools to join, wait for your move, and reply.
- Two agents can play each other while you spectate in real time.
- Everything runs on `127.0.0.1`; there is no cloud dependency and no account system.

## Requirements

- Node.js **20.19+** (Node 24 recommended)
- pnpm **11+**

## Quick start

```bash
pnpm install
pnpm dev
```

Open **http://127.0.0.1:3000**.

For a production-style run:

```bash
pnpm build
pnpm start
```

`pnpm start` serves the built React app, the REST API, the WebSocket, and the MCP
endpoint from one process.

### CLI options

```text
chess-mcp [options]

--port <number>   Port to listen on (default: 3000, env: PORT)
--data-dir <dir>  Directory for saved games (env: CHESS_MCP_DATA_DIR)
--dev             Serve the React app with Vite middleware (HMR, no build)
-h, --help        Show help
```

The server always binds to `127.0.0.1`. Open the printed URL in a browser.

### Saved games

Games are written to disk after every change (create, join, move, draw, resign),
so the lobby is restored the next time the server starts. Each game is a small
JSON file under `<data-dir>/games/<game-id>.json`.

Default locations:

| Platform | Directory |
| --- | --- |
| Windows | `%USERPROFILE%\Saved Games\chess-mcp` |
| macOS | `~/Library/Application Support/chess-mcp` |
| Linux | `$XDG_DATA_HOME/chess-mcp` (default `~/.local/share/chess-mcp`) |

Override the location with `--data-dir <path>` or the `CHESS_MCP_DATA_DIR`
environment variable. Seat ownership survives restarts: only the SHA-256 hash
of each seat token is saved, and the original token keeps working. Deleting a
game removes its saved file.

## Play against an LLM

1. Click **New game**.
2. Enter your name, pick **White** (or Black), and choose a time control (or **No clock**).
3. On the game page, open **Invite a player** and copy the **Agent prompt** for the open seat.
4. Give that prompt to an MCP-enabled agent that has the `chess` server configured.
5. Play in the browser. The agent blocks on `wait_for_move`, receives your move, and replies.
6. The board, move list, draw offers, and result update over WebSocket for every spectator.

Joined the wrong colour? Click **Swap colors** on the game page (or on the lobby card)
before the first move: both seats exchange, each player keeps their own seat token,
and the PGN tags/board orientation follow automatically. Nothing needs recreating.

### Time controls

Games can carry a clock, using the usual ranked presets:

| Category | Presets |
| --- | --- |
| Bullet | `1+0`, `1+1`, `2+1` |
| Blitz | `3+0`, `3+2`, `5+0` |
| Rapid | `10+0`, `10+5`, `15+10` |
| Daily | `1d`, `3d`, `7d` |

Pass `timeControl` (REST) or `time_control` (MCP) with the preset id; omit it for an
untimed game. The clock is enforced on the server: the side to move is charged for its
thinking time, the increment is added after each move, and when a bank reaches zero the
game ends immediately with `phase: "timeout"`, the opponent as winner, and a
`1-0`/`0-1` PGN result. Both clocks are shown next to each player and printed in MCP
tool output. Daily presets behave as "N days per move": the bank is capped at the preset
so time never accumulates between moves. Clocks are saved with the game and resume with
the saved banks after a restart (downtime is not charged).

### MCP client configuration

```json
{
  "mcpServers": {
    "chess": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

The endpoint uses **MCP Streamable HTTP** (the current transport). MCP's old
standalone HTTP+SSE transport is not used. The browser's live updates use a
separate WebSocket at `/ws`.

The `type` field is required. Clients treat a URL-only entry (`{"url": ...}`)
as the legacy SSE transport, open `GET /mcp` expecting an event stream, get
`405 Method Not Allowed`, and report the server as unavailable. Cline accepts
`"type": "streamableHttp"` (equivalently `"http"`); Claude Code and VS Code
call the same transport `"http"`. Clients that default to a ~60s tool timeout
should raise it (for example `"timeout": 150`) because `wait_for_move` can
long-poll for up to 120 seconds.

### Agent loop

```text
Use the chess MCP server at http://127.0.0.1:3000/mcp.
Join game <id> as <seat> with a name of your choice, and keep the seat_token
returned by join_game. Then loop:
  1. wait_for_move(game_id="<id>", seat_token="<token>")
  2. if it is your turn, make_move(game_id="<id>", move="<SAN or UCI>",
     seat_token="<token>", note="<why you chose it>")
Repeat until the game ends.
```

### Move notes

`make_move` takes an optional `note` (up to 500 characters). It is stored with the move,
so the opponent gets it back from `wait_for_move`/`get_game` as `Last move note: …`, it
appears in the web move list (hover the dotted move), and it is written into the PGN as a
`{comment}`:

```text
1. e4 {Controls the centre; watch ...d5} e5 2. Nf3 {Develops, eyes d5}
```

Writing the plan down before moving is a cheap check: it forces the threats and the
piece you are about to expose into the sentence, which is exactly where hasty moves go
wrong. Agents should send a note on every move, even a short one.

Seat tokens are returned once by `create_game`/`join_game`. Keep them in the
conversation and pass them on every mutating tool call. In a hotseat game
(both seats open) tokens are not required.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_game` | Create a game and claim white, black, or no seat (`none`), with an optional `time_control` preset. Returns a game id and seat token. |
| `join_game` | Claim an open seat. Returns a seat token. |
| `list_games` | List active games with players, turn, status, and last move. |
| `get_game` | Full state: ASCII board, FEN, PGN, seats, turn/check/result, legal moves. |
| `make_move` | Play SAN (`Nf3`, `O-O`, `e8=Q`) or UCI (`e2e4`, `e7e8q`). Optional `note` records your reasoning with the move. Enforces turn and seat token. |
| `wait_for_move` | Pass your seat token: returns immediately when it is your turn, otherwise long-polls until the opponent moves, the game ends, or a timeout (1–120s) expires. |
| `draw` | `offer`, `accept`, or `decline` a draw. |
| `resign` | Resign. |

Game state includes a text board, so an agent can play without extra round trips:

```text
Game 3f9c2a1b
White: Alice (human)
Black: Claude (llm)
Status: Black to move.
Last move: e4 (e2e4)

  +------------------------+
8 | r n b q k b n r |
7 | p p p p . p p p |
...
    a b c d e f g h

FEN: ...
Legal moves (20): a6, a5, ...
```

## HTTP API (used by the web app)

| Method + path | Purpose |
| --- | --- |
| `GET /api/health` | Health and active game count |
| `GET /api/games` | Public game list |
| `POST /api/games` | Create a game (`name`, `color`: white, black, random, or none; optional `timeControl` preset id) |
| `GET /api/games/:id` | Public game state |
| `POST /api/games/:id/join` | Claim `{ name, seat }` |
| `POST /api/games/:id/swap-seats` | Exchange the two seats `{ token }` — only before the first move |
| `POST /api/games/:id/moves` | Play `{ move, token? }` |
| `POST /api/games/:id/draw` | `{ action, token?, seat? }` |
| `POST /api/games/:id/resign` | `{ token?, seat? }` |
| `DELETE /api/games/:id` | Delete a game |
| `GET /ws` | WebSocket: `snapshot`, `game`, `deleted`, `hello` messages |

## Architecture

```text
Browser (React 19 + Vite + Tailwind + react-chessboard + chess.js)
  │ REST mutations + WebSocket public state
  ▼
Express 5 process (127.0.0.1:3000)
  ├─ /mcp        MCP Streamable HTTP (official TypeScript SDK v2)
  ├─ /api/*      REST for the human UI
  ├─ /ws         WebSocket live updates (server → client)
  └─ /           built React SPA
        │
        └─ shared in-memory GameStore (chess.js rules, seats, tokens)
```

Key points:

- **One source of truth.** The website and every MCP agent mutate the same
  `GameStore`. An agent spawning a separate stdio server would not see the
  website's games, which is why HTTP MCP is the product's transport.
- **Official MCP SDK v2** (`@modelcontextprotocol/server`), Streamable HTTP,
  loopback-only with Host/Origin validation from `@modelcontextprotocol/express`.
- **Seat tokens** prevent one agent from moving for the other player.
- **Saved games.** Every mutation rewrites `<data-dir>/games/<game-id>.json`, and
  saved games are reloaded at startup. The store still caps at 200 in-memory
  games and evicts the oldest finished ones (their saved files are removed too).
- **No clocks, engine analysis, ratings, accounts, chat, or remote access** in
  v1. Untimed correspondence-style play is intentional: LLM response latency
  makes clocks awkward.

### Source layout

```text
src/
  index.ts            CLI, HTTP server, Vite dev middleware / static serving
  mcp.ts              MCP tool registration
  game.ts             chess.js wrapper: moves, status, draw/resign, PGN, ASCII board
  storage.ts          Saved-game directory resolution + per-game JSON persistence
  store.ts            GameStore: ids, seats, token hashes, events, limits, restore
  format.ts           Text formatting for MCP tool results
  server/app.ts       Express REST routes + MCP mount + error handling
  server/ws.ts        WebSocket server, Origin check, broadcast
  shared/protocol.ts  Types shared by server and web
web/src/              React app: lobby, game view, board, invite panel, live store
test/                 Rules, store, MCP, REST/WebSocket tests
.oxlintrc.json        Strict Oxlint policy
.github/workflows/    CI: lint, typecheck, test, build
.vscode/              Recommended Oxc extension + lint-on-type settings
```

## Scripts

| Command | Behavior |
| --- | --- |
| `pnpm dev` | tsx watch + Vite middleware on port 3000 (HMR, no build) |
| `pnpm build` | Typecheck server and web, then build the SPA into `dist/web` |
| `pnpm start` | Run the built server and SPA |
| `pnpm lint` | Strict Oxlint; warnings and unused suppressions fail the run |
| `pnpm lint:fix` | Apply Oxlint's safe fixes |
| `pnpm typecheck` | Server, web, and test TypeScript checks |
| `pnpm test` | Vitest: rules, store, MCP round-trip, REST + WebSocket |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm check` | lint + typecheck + tests |
| `pnpm validate` | check + production build |

## Linting

Linting is enforced with [Oxlint](https://oxc.rs/docs/guide/usage/linter/).
`.oxlintrc.json` is deliberately strict:

- All **correctness**, **suspicious**, and **performance** rules are errors.
- TypeScript, React, JSX accessibility, import, promise, node, Vitest, unicorn,
  and Oxc plugins are enabled.
- Selected additional rules are errors: `eqeqeq`, `prefer-const`, `no-var`,
  `typescript/no-explicit-any`, `typescript/no-non-null-assertion`,
  `typescript/consistent-type-imports`, `import/no-cycle`,
  `import/no-duplicates`, `unicorn/prefer-node-protocol`,
  `react/self-closing-comp`, and more.
- **Type-aware linting** is enabled through `oxlint-tsgolint` (`--type-aware`).
  It catches unsafe type assertions, unnecessary conversions/assertions, unbound
  methods, and misused spreads in the server, tests, and `.tsx` components.
- `console` is banned in the web app; server/test logging is explicitly allowed.
- Test fixtures relax only `no-non-null-assertion`, `no-unsafe-type-assertion`,
  and `no-unnecessary-type-parameters` because they intentionally decode JSON
  fixtures.
- The noisy `pedantic` and `style` categories (`sort-keys`, `one-var`,
  `jsx-max-depth`, `no-magic-numbers`, etc.) stay off by design; high-signal
  rules from those categories are enabled individually.
- `--deny-warnings` and `--report-unused-disable-directives` mean a warning or a
  stale suppression fails CI.

Install the recommended **Oxc** VS Code extension (`oxc.oxc-vscode`) from the
workspace recommendations; `.vscode/settings.json` enables lint-on-type and
applies safe fixes on request. Changes are checked by
`.github/workflows/ci.yml`.

## Validation

The repository ships with:

- Oxlint with type-aware rules: **0 warnings, 0 errors** across 34 files and
  287 rules.
- TypeScript: server, web, and test configs all clean.
- Rules tests: Fool's mate, castling, en passant, promotion, draws,
  resignation, illegal moves, PGN and ASCII output.
- Store tests: seat tokens, turn order, hotseat, events, lookup, deletion.
- Storage tests: per-platform save directories, save/reload round-trips (including
  seat tokens, draw offers, and finished games), corrupt-file tolerance, deletion.
- MCP tests: two in-process clients create/join/play, `wait_for_move` resolves
  on the opponent's move, errors are `isError`.
- API tests: real HTTP server + WebSocket broadcast + validation errors.
- **37/37 Vitest tests pass.**

The server was also smoke-tested over the wire with the official MCP client
(`tools/list`, `create_game`, `join_game`, UCI moves, `get_game`) and the UI was
checked in a headless browser, including a live WebSocket move update.

## Security and limitations

- Binds to `127.0.0.1` only; do not expose it publicly without adding auth and
  TLS. There is no remote access mode.
- Seat tokens are high-entropy and only their SHA-256 hashes are stored (in
  memory and in saved game files); public game state never includes them.
- Game deletion is available to anyone on the local machine.
- Saved games live in the current user's profile (see [Saved games](#saved-games));
  the server does not encrypt them.
- The MCP server has no resources or prompts; all state is returned by tools.

## License

Apache-2.0. See [LICENSE](./LICENSE).

