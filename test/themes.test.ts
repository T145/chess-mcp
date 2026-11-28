import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.js';
import {
  BUILTIN_THEME,
  LOCAL_THEMES,
  OPEN_THEMES,
  PIECE_CODES,
  RUNTIME_THEMES
} from '../src/shared/themes.js';
import { GameStore } from '../src/store.js';
import { ThemeAssetService } from '../src/themes/service.js';

const createdDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-themes-'));
  createdDirs.push(dir);
  return dir;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

type FetchInput = Parameters<typeof fetch>[0];

function fakeFetch(input: FetchInput): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return Promise.resolve(url.endsWith('.svg') ? new Response(SVG) : new Response(PNG));
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('theme catalog', () => {
  it('has unique ids and the expected sets', () => {
    const ids = [BUILTIN_THEME, ...OPEN_THEMES, ...LOCAL_THEMES].map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OPEN_THEMES).toHaveLength(10);
    expect(LOCAL_THEMES).toHaveLength(41);
    expect(LOCAL_THEMES.some((theme) => theme.name === 'Classic')).toBe(false);
    expect(LOCAL_THEMES.some((theme) => theme.name === 'Icy Sea')).toBe(false);
    expect(LOCAL_THEMES.some((theme) => theme.name === 'Neo Angle')).toBe(true);
    expect(RUNTIME_THEMES).toHaveLength(51);
    expect(PIECE_CODES).toHaveLength(12);
  });
});

describe('ThemeAssetService', () => {
  it('downloads the runtime sets once and exposes them in the catalog', async () => {
    const dir = tempDir();
    let requests = 0;
    const service = new ThemeAssetService({
      dataDir: dir,
      fetchImpl: (input) => {
        requests += 1;
        return fakeFetch(input);
      },
      log: () => undefined
    });

    const before = service.catalog();
    expect(before.themes).toHaveLength(1);
    expect(before.status.phase).toBe('idle');

    await service.ensureAll();

    const after = service.catalog();
    expect(after.themes).toHaveLength(52);
    expect(after.status.phase).toBe('ready');
    expect(after.status.ready).toBe(RUNTIME_THEMES.length);
    expect(requests).toBe(RUNTIME_THEMES.length * PIECE_CODES.length);

    const png = service.assetFile('chesscom-neo', 'wK.png');
    expect(png).not.toBeNull();
    expect(png && existsSync(png)).toBe(true);
    const svg = service.assetFile('chessnut', 'wK.svg');
    expect(svg).not.toBeNull();
    expect(svg && existsSync(svg)).toBe(true);
    expect(service.assetFile('chesscom-neo', '../evil.png')).toBeNull();

    await service.ensureAll();
    expect(requests).toBe(RUNTIME_THEMES.length * PIECE_CODES.length);
  });

  it('does nothing when downloads are disabled', async () => {
    let requests = 0;
    const service = new ThemeAssetService({
      dataDir: tempDir(),
      enabled: false,
      fetchImpl: (input) => {
        requests += 1;
        return fakeFetch(input);
      }
    });

    await service.ensureAll();
    const catalog = service.catalog();
    expect(catalog.themes).toHaveLength(1);
    expect(catalog.status.phase).toBe('disabled');
    expect(requests).toBe(0);
  });

  it('serves the catalog and runtime assets over HTTP', async () => {
    const service = new ThemeAssetService({
      dataDir: tempDir(),
      fetchImpl: (input) => fakeFetch(input)
    });
    await service.ensureAll();

    const { app, mcpHandler } = createApp(new GameStore(), { themes: service });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const catalog = (await (await fetch(`${base}/api/themes`)).json()) as {
        themes: unknown[];
      };
      expect(catalog.themes).toHaveLength(52);

      const asset = await fetch(`${base}/theme-assets/chesscom-neo/wK.png`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('image/png');
      expect((await asset.arrayBuffer()).byteLength).toBe(PNG.length);

      const svg = await fetch(`${base}/theme-assets/chessnut/wK.svg`);
      expect(svg.status).toBe(200);
      expect(svg.headers.get('content-type')).toContain('image/svg+xml');
      expect(await svg.text()).toContain('<svg');

      const missing = await fetch(`${base}/theme-assets/chesscom-neo/../../evil.png`);
      expect(missing.status).toBe(404);
    } finally {
      await mcpHandler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
