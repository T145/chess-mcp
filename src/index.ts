#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';

import express from 'express';
import type { ViteDevServer } from 'vite';

import { createApp } from './server/app.js';
import { attachWebSocket, closeWebSocketServer } from './server/ws.js';
import { resolveDataDir } from './storage.js';
import { GameStore } from './store.js';

interface CliOptions {
  dev: boolean;
  port: number;
  dataDir: string;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: chess-mcp [options]',
    '',
    'Options:',
    '  --port <number>  Port to listen on (default: 3000, env: PORT)',
    '  --data-dir <dir> Directory for saved games (env: CHESS_MCP_DATA_DIR)',
    '  --dev            Serve the React app with Vite middleware (no build needed)',
    '  -h, --help       Show this help',
    '',
    'By default games are saved to "Saved Games/chess-mcp" on Windows,',
    '"~/Library/Application Support/chess-mcp" on macOS, and',
    '"$XDG_DATA_HOME/chess-mcp" (or "~/.local/share/chess-mcp") on Linux.',
    '',
    'The server always binds to 127.0.0.1. Open the printed URL in a browser.',
    'MCP clients connect to http://127.0.0.1:<port>/mcp using Streamable HTTP.'
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dev: false,
    port: Number(process.env.PORT ?? 3000),
    dataDir: resolveDataDir(),
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
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error(`Invalid port: ${options.port}`);
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
  const { app, mcpHandler } = createApp(store);
  const server = createHttpServer(app);
  const wss = attachWebSocket(server, store, { allowViteHmr: options.dev });

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
