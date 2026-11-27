#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';

import express from 'express';
import type { ViteDevServer } from 'vite';

import { EngineManager } from './engine/manager.js';
import { ReviewService } from './review/service.js';
import { createApp } from './server/app.js';
import { attachWebSocket, closeWebSocketServer } from './server/ws.js';
import { resolveDataDir } from './storage.js';
import { GameStore } from './store.js';

interface CliOptions {
  dev: boolean;
  port: number;
  dataDir: string;
  /** Explicit Stockfish path; null means auto-detect then download. */
  enginePath: string | null;
  engineDepth: number;
  /** Allow the automatic Stockfish download when no engine is found. */
  engineDownload: boolean;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: chess-mcp [options]',
    '',
    'Options:',
    '  --port <number>  Port to listen on (default: 3000, env: PORT)',
    '  --data-dir <dir> Directory for saved games (env: CHESS_MCP_DATA_DIR)',
    '  --engine <path>  Use a local Stockfish binary (env: CHESS_MCP_ENGINE)',
    '  --engine-depth <n>  Analysis depth per position (default: 14)',
    '  --no-engine-download  Never download Stockfish automatically',
    '  --dev            Serve the React app with Vite middleware (no build needed)',
    '  -h, --help       Show this help',
    '',
    'By default games are saved to "Saved Games/chess-mcp" on Windows,',
    '"~/Library/Application Support/chess-mcp" on macOS, and',
    '"$XDG_DATA_HOME/chess-mcp" (or "~/.local/share/chess-mcp") on Linux.',
    '',
    'The server always binds to 127.0.0.1. Open the printed URL in a browser.',
    'MCP clients connect to http://127.0.0.1:<port>/mcp using Streamable HTTP.',
    '',
    'When no Stockfish is found, the official release is downloaded once into',
    'the data directory so finished games can be reviewed.'
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const envDepth = Number(process.env.CHESS_MCP_ENGINE_DEPTH ?? 14);
  const options: CliOptions = {
    dev: false,
    port: Number(process.env.PORT ?? 3000),
    dataDir: resolveDataDir(),
    enginePath: process.env.CHESS_MCP_ENGINE?.trim() || null,
    engineDepth: Number.isInteger(envDepth) ? envDepth : 14,
    engineDownload: process.env.CHESS_MCP_NO_ENGINE_DOWNLOAD !== '1',
    help: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--dev') {
      options.dev = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--port') {
      const value = argv[index + 1];
      if (!value) throw new Error('--port needs a number');
      options.port = Number(value);
      index += 1;
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg === '--data-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('--data-dir needs a path');
      options.dataDir = path.resolve(value);
      index += 1;
    } else if (arg.startsWith('--data-dir=')) {
      const value = arg.slice('--data-dir='.length);
      if (!value) throw new Error('--data-dir needs a path');
      options.dataDir = path.resolve(value);
    } else if (arg === '--engine') {
      const value = argv[index + 1];
      if (!value) throw new Error('--engine needs a path');
      options.enginePath = path.resolve(value);
      index += 1;
    } else if (arg.startsWith('--engine=')) {
      const value = arg.slice('--engine='.length);
      if (!value) throw new Error('--engine needs a path');
      options.enginePath = path.resolve(value);
    } else if (arg === '--engine-depth') {
      const value = argv[index + 1];
      if (!value) throw new Error('--engine-depth needs a number');
      options.engineDepth = Number(value);
      index += 1;
    } else if (arg.startsWith('--engine-depth=')) {
      options.engineDepth = Number(arg.slice('--engine-depth='.length));
    } else if (arg === '--no-engine-download') {
      options.engineDownload = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (
    !Number.isInteger(options.engineDepth) ||
    options.engineDepth < 4 ||
    options.engineDepth > 30
  ) {
    throw new Error(`Invalid engine depth: ${options.engineDepth}. Use 4-30.`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const store = new GameStore({ dataDir: options.dataDir });
  const engine = new EngineManager({
    dataDir: options.dataDir,
    explicitPath: options.enginePath,
    autoInstall: options.engineDownload,
    depth: options.engineDepth,
    log: (message) => console.log(message)
  });
  const review = new ReviewService({
    store,
    engine,
    storage: store.storage,
    depth: options.engineDepth,
    log: (message) => console.log(message)
  });
  const { app, mcpHandler } = createApp(store, { review });
  const server = createHttpServer(app);
  const wss = attachWebSocket(server, store, { allowViteHmr: options.dev, review });

  let vite: ViteDevServer | null = null;

  if (options.dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      configFile: path.resolve(process.cwd(), 'vite.config.ts'),
      server: {
        middlewareMode: true,
        ws: { server }
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const webDist = path.resolve(process.cwd(), 'dist', 'web');
    const indexHtml = path.join(webDist, 'index.html');
    if (existsSync(indexHtml)) {
      app.use(express.static(webDist));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
          next();
          return;
        }
        res.sendFile(indexHtml);
      });
    } else {
      console.warn('Web UI is not built. Run "npm run build" or start with "npm run dev".');
      app.use((_req, res) => {
        res
          .status(503)
          .type('text/plain')
          .send('Web UI not built. Run "npm run build" or start with "npm run dev".\n');
      });
    }
  }

  server.on('error', (error) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });

  server.listen(options.port, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    console.log(`Chess MCP is running at http://127.0.0.1:${port}`);
    console.log(`MCP endpoint: http://127.0.0.1:${port}/mcp (Streamable HTTP)`);
    console.log(`Saved games: ${options.dataDir}`);
    if (options.dev) console.log('Vite dev middleware is active (HMR enabled).');
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received; shutting down...`);

    try {
      if (vite) await vite.close();
      await closeWebSocketServer(wss);
      await mcpHandler.close();
      review.dispose();
      await engine.dispose();
      store.dispose();
    } catch (error) {
      console.error('Shutdown error:', error);
    }

    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
