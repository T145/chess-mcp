# chess-mcp

A local chess web app **and** MCP server for humans vs LLMs and LLM vs LLM games.

- Open a board in the browser, play moves, watch games update live.
- Invite any MCP-capable agent (Cline, Claude Code, etc.) into the other seat with one copy-paste prompt.
- Agents use **Streamable HTTP** MCP tools to join, wait for your move, and reply.
- Two agents can play each other while you spectate in real time.
- Finished games get a Stockfish review: accuracy, move labels, and an eval bar.
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
--data-dir <dir>  Directory for saved games and the engine (env: CHESS_MCP_DATA_DIR)
--engine <path>   Use a local Stockfish binary (env: CHESS_MCP_ENGINE)
--engine-depth <n>  Analysis depth per position (default: 14)
--no-engine-download  Never download Stockfish automatically
--dev             Serve the React app with Vite middleware (HMR, no build)
-h, --help        Show help
```

The server always binds to `127.0.0.1`. Open the printed URL in a browser.

### Saved games

Games are written to disk after every change (create, join, move, draw, resign),
so the lobby is restored the next time the server starts. Each game is a small
JSON file under `<data-dir>/games/<game-id>.json`; completed reviews are stored
next to them under `<data-dir>/reviews/<game-id>.json`.

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

`make_move` takes an optional `note` (up to 500 characters). It is stored with the move and
written into the PGN as a `{comment}`:

```text
1. e4 {Controls the centre; watch ...d5} e5 2. Nf3 {Develops, eyes d5}
```

Notes are private while the game is running. An agent only receives its **own** notes —
`make_move` echoes the note back, and `get_game` with your `seat_token` returns your notes as
`Last move note: …` and as PGN comments. The opponent's notes are withheld from
`wait_for_move`/`get_game`, and the web interface shows none at all. A hotseat game (both
seats open) has a single operator, so that operator reads all of its own notes. Once the game
ends every note becomes public, in the web move list and in the PGN.

Writing the plan down before moving is a cheap check: it forces the threats and the
piece you are about to expose into the sentence, which is exactly where hasty moves go
wrong. Agents should send a note on every move, even a short one.

Seat tokens are returned once by `create_game`/`join_game`. Keep them in the
conversation and pass them on every mutating tool call. In a hotseat game
(both seats open) tokens are not required.

## Game review

When a game ends, the server analyses every position with Stockfish and stores a
review alongside the game. Open the **Review** tab on the game page (or call the
`review_game` MCP tool) to see:

- accuracy for both players, plus counts of brilliant / great / best / excellent /
  good / inaccuracy / mistake / blunder moves;
- an evaluation graph and a **vertical eval bar to the left of the board**;
- move badges plus the complete annotated move list; click any move (or use the
  navigation buttons) to step through the game on the board, with the clock as
  it stood after that move.

### Engine setup

The server looks for Stockfish in this order:

1. `--engine <path>` or `CHESS_MCP_ENGINE`;
2. `stockfish` on `PATH`;
3. common install folders (`/usr/games`, `/usr/bin`, `/usr/local/bin`,
   `/opt/homebrew/bin`, `%LOCALAPPDATA%\Stockfish`, `Program Files\Stockfish`);
4. a previously downloaded binary in `<data-dir>/engine/sf_19/`.

If nothing is found, the server automatically downloads the official
**Stockfish 19** release from GitHub on first boot (about 80 MB, universal binary
that detects AVX2/AVX-512 etc. itself). Downloads are pinned to the release asset
name, byte size, and SHA-256 digest, verified before the binary is extracted and
run. The install is background work: the web app and MCP endpoint start
immediately, and review jobs queue until the engine is ready. Pass
`--no-engine-download` to disable this and use `--engine` for a local build.

The engine is GPL-3.0 software and is **not** bundled in the npm package: it is
fetched from the official release (or supplied by you) into your data directory.
The project itself stays Apache-2.0.

Analysis uses depth 14 and MultiPV 2 by default, one review at a time. Labels are
heuristic (win-probability loss, only-move detection, and a material-sacrifice
check for brilliant moves), not a clone of Chess.com's proprietary algorithm.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_game` | Create a game and claim white, black, or no seat (`none`), with an optional `time_control` preset. Returns a game id and seat token. |
| `join_game` | Claim an open seat. Returns a seat token. |
| `list_games` | List active games with players, turn, status, and last move. |
| `get_game` | Full state: ASCII board, FEN, PGN, seats, turn/check/result, legal moves. Pass `seat_token` to include your own move notes. |
| `make_move` | Play SAN (`Nf3`, `O-O`, `e8=Q`) or UCI (`e2e4`, `e7e8q`). Optional `note` records your reasoning privately until the game ends. Enforces turn and seat token. |
| `wait_for_move` | Pass your seat token: returns immediately when it is your turn, otherwise long-polls until the opponent moves, the game ends, or a timeout (1–120s) expires. |
| `draw` | `offer`, `accept`, or `decline` a draw. |
| `resign` | Resign. |
| `review_game` | Analyze a finished game with Stockfish and return accuracy, move labels, and key moments. Waits briefly for the engine download/analysis. |

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
| `GET /api/engine` | Engine status: available / installing / unavailable / failed, download progress, depth |
| `POST /api/engine/install` | Retry the automatic Stockfish install |
| `GET /api/games/:id/review` | Review state, loading a saved review if present |
| `POST /api/games/:id/review` | Start (or reuse) a review; `400` while the game is running |
| `DELETE /api/games/:id` | Delete a game |
| `GET /ws` | WebSocket: `snapshot`, `game`, `deleted`, `review`, `engine`, `hello` messages |

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
        ├─ shared in-memory GameStore (chess.js rules, seats, tokens)
        └─ ReviewService → Stockfish (UCI child process, auto-downloaded)
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
- **Reviews are a separate artifact.** Analysis runs in one background job at a
  time, results are cached in memory and `<data-dir>/reviews/`, and progress is
  broadcast over the WebSocket. A saved review is reused after a restart.
- **No ratings, accounts, chat, or remote access.** The server is loopback-only;
  the Stockfish binary is the only external download and it is pinned by digest.

### Source layout

```text
src/
  index.ts            CLI, HTTP server, engine/review wiring, static serving
  mcp.ts              MCP tool registration (including review_game)
  game.ts             chess.js wrapper: moves, status, draw/resign, PGN, ASCII board
  storage.ts          Game + review JSON persistence, directory resolution
  store.ts            GameStore: ids, seats, token hashes, events, limits, restore
  format.ts           Text formatting for MCP tool results and reviews
  server/app.ts       Express REST routes + MCP mount + error handling
  server/ws.ts        WebSocket server, Origin check, review/engine broadcast
  engine/             Stockfish locate/download/verify, UCI client, lifecycle
  review/             Move classification, accuracy, review queue/persistence
  shared/protocol.ts  Types shared by server and web
  shared/eval.ts      Win-probability/accuracy maths and eval formatting
web/src/              React app: lobby, game view, board, review panel, live store
test/                 Rules, store, review, engine, MCP, REST/WebSocket tests
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
| `pnpm test` | Vitest: rules, store, review/engine, MCP round-trip, REST + WebSocket |
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

- Oxlint with type-aware rules: **0 warnings, 0 errors** across 54 files and
  287 rules.
- TypeScript: server, web, and test configs all clean.
- Rules tests: Fool's mate, castling, en passant, promotion, draws,
  resignation, illegal moves, PGN and ASCII output.
- Store tests: seat tokens, turn order, hotseat, events, lookup, deletion.
- Storage tests: per-platform save directories, save/reload round-trips (including
  seat tokens, draw offers, and finished games), review round-trips, corrupt-file
  tolerance, deletion.
- Review tests: UCI parsing, release selection, checksum/size rejection,
  win-probability bands, brilliant/great detection, mate scores, auto-start on
  game end, engine-unavailable failures, persistence and reuse.
- MCP tests: two in-process clients create/join/play, `wait_for_move` resolves
  on the opponent's move, errors are `isError`.
- API tests: real HTTP server + WebSocket broadcast + validation errors, engine
  and review routes when no engine is configured.
- **119/119 Vitest tests pass.**

The server was also smoke-tested over the wire with the official MCP client
(`tools/list`, `create_game`, `join_game`, UCI moves, `get_game`) and the UI was
checked in a headless browser, including a live WebSocket move update.

## Security and limitations

- Binds to `127.0.0.1` only; do not expose it publicly without adding auth and
  TLS. There is no remote access mode.
- Seat tokens are high-entropy and only their SHA-256 hashes are stored (in
  memory and in saved game files); public game state never includes them.
- Game deletion is available to anyone on the local machine.
- Saved games and reviews live in the current user's profile (see
  [Saved games](#saved-games)); the server does not encrypt them.
- The first run downloads the official Stockfish release (~80 MB) into the data
  directory. The URL, byte size, and SHA-256 digest are pinned in
  `src/engine/releases.ts`; the download is verified before extraction, and
  archive paths are checked for traversal. Use `--no-engine-download` or
  `--engine <path>` to avoid or replace the download.
- Stockfish runs as a local child process. Only the configured path is executed;
  no part of an HTTP/MCP request can choose the binary.
- The MCP server has no resources or prompts; all state is returned by tools.

## License

Apache-2.0. See [LICENSE](./LICENSE).

