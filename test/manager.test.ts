import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EngineManager } from '../src/engine/manager.js';
import type { EngineInstaller } from '../src/engine/install.js';
import type { EngineSession } from '../src/engine/uci.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-manager-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('EngineManager install hook', () => {
  it('runs the hook when a managed engine install begins', async () => {
    let hooks = 0;
    const session = {
      engineName: 'Stockfish test',
      analyze: () => Promise.reject(new Error('unused')),
      dispose: () => Promise.resolve()
    } as unknown as EngineSession;
    const installer = {
      isInstalled: () => Promise.resolve(null),
      install: () => Promise.resolve({ path: '/fake/stockfish', name: 'Stockfish test' }),
      asset: null
    } as unknown as EngineInstaller;

    const manager = new EngineManager({
      dataDir: tempDir(),
      installer,
      platform: 'linux',
      arch: 'x64',
      autoInstall: true,
      autoStart: false,
      probe: () => Promise.resolve(null),
      createSession: () => Promise.resolve(session),
      onInstallStart: () => {
        hooks += 1;
      }
    });

    manager.start();
    await manager.waitForEngine();
    expect(hooks).toBe(1);
    await manager.dispose();
  });
});
