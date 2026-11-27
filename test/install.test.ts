import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EngineInstaller } from '../src/engine/install.js';
import { ENGINE_RELEASE } from '../src/engine/releases.js';

const createdDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-install-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('EngineInstaller', () => {
  it('reuses an existing managed binary without downloading', async () => {
    const dir = tempDir();
    let fetches = 0;
    const installer = new EngineInstaller({
      dataDir: dir,
      platform: 'linux',
      arch: 'x64',
      probe: () => Promise.resolve({ name: 'Stockfish 19' }),
      fetchImpl: () => {
        fetches += 1;
        return Promise.reject(new Error('should not download'));
      }
    });

    mkdirSync(path.dirname(installer.targetPath), { recursive: true });
    writeFileSync(installer.targetPath, 'fake binary');

    expect(await installer.isInstalled()).toEqual({ name: 'Stockfish 19' });
    const result = await installer.install();
    expect(result.path).toBe(installer.targetPath);
    expect(fetches).toBe(0);
  });

  it('rejects a platform without a pinned asset', async () => {
    const installer = new EngineInstaller({
      dataDir: tempDir(),
      platform: 'freebsd',
      arch: 'x64',
      probe: () => Promise.resolve(null)
    });
    await expect(installer.install()).rejects.toThrow(/--engine/);
  });

  it('rejects a download that does not match the pinned size', async () => {
    const installer = new EngineInstaller({
      dataDir: tempDir(),
      platform: 'linux',
      arch: 'x64',
      probe: () => Promise.resolve(null),
      fetchImpl: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
    });

    await expect(installer.install()).rejects.toThrow(/incomplete/);
    expect(installer.asset?.file).toBe(`stockfish-linux-x86-64-universal.tar.gz`);
    expect(ENGINE_RELEASE.tag).toBe('sf_19');
  });
});
