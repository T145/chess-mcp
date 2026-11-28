import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpeningsInstaller } from '../src/openings/install.js';
import { OpeningService } from '../src/openings/service.js';
import type { OpeningRelease } from '../src/openings/release.js';

const createdDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-openings-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FIXTURES = [
  {
    name: 'a.tsv',
    text: [
      'eco\tname\tpgn',
      "B00\tKing's Pawn Game\t1. e4",
      'C60\tRuy Lopez\t1. e4 e5 2. Nf3 Nc6 3. Bb5',
      ''
    ].join('\n')
  },
  {
    name: 'b.tsv',
    text: ['eco\tname\tpgn', "D00\tQueen's Pawn Game\t1. d4 d5", ''].join('\n')
  }
];

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function fixtureRelease(): OpeningRelease {
  return {
    tag: 'fixture',
    commit: 'fixture',
    name: 'Fixture openings',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://example.test/openings',
    files: FIXTURES.map((file) => ({
      name: file.name,
      bytes: Buffer.byteLength(file.text, 'utf8'),
      sha256: sha256(file.text)
    }))
  };
}

function fakeFetch(overrides: Record<string, string> = {}): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const href = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const name = href.split('/').at(-1) ?? '';
    const body = overrides[name] ?? FIXTURES.find((file) => file.name === name)?.text;
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200 });
  });
}

describe('openings installer', () => {
  it('downloads, verifies, and installs the source files', async () => {
    const fetchImpl = fakeFetch();
    const installer = new OpeningsInstaller({
      dataDir: tempDir(),
      release: fixtureRelease(),
      fetchImpl: fetchImpl
    });

    expect(installer.isInstalled()).toBe(false);
    await installer.install();

    expect(installer.isInstalled()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(FIXTURES.length);
    expect(readFileSync(installer.filePath('a.tsv'), 'utf8')).toBe(FIXTURES[0]?.text);
    expect(installer.sourceTexts()).toHaveLength(FIXTURES.length);
    expect(existsSync(installer.manifestPath)).toBe(true);
  });

  it('reuses verified files instead of downloading them again', async () => {
    const fetchImpl = fakeFetch();
    const installer = new OpeningsInstaller({
      dataDir: tempDir(),
      release: fixtureRelease(),
      fetchImpl: fetchImpl
    });

    await installer.install();
    await installer.install();
    expect(fetchImpl).toHaveBeenCalledTimes(FIXTURES.length);
  });

  it('rejects a file whose digest does not match and leaves nothing behind', async () => {
    const installer = new OpeningsInstaller({
      dataDir: tempDir(),
      release: fixtureRelease(),
      fetchImpl: fakeFetch({ 'a.tsv': 'eco\tname\tpgn\nB00\tTampered\t1. e4\n' })
    });

    await expect(installer.install()).rejects.toThrow(/SHA-256|expected/);
    expect(installer.isInstalled()).toBe(false);
    expect(readdirSync(installer.directory).some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});

describe('opening service', () => {
  it('installs the data, builds the book once, and serves it with a stable ETag', async () => {
    const dataDir = tempDir();
    const installer = new OpeningsInstaller({
      dataDir,
      release: fixtureRelease(),
      fetchImpl: fakeFetch()
    });
    const service = new OpeningService({ dataDir, installer });

    expect(service.statusInfo().phase).toBe('idle');
    await service.ensure();

    const status = service.statusInfo();
    expect(status.phase).toBe('ready');
    expect(status.positions).toBeGreaterThan(0);
    expect(status.source?.license).toBe('CC0-1.0');

    const text = service.bookText();
    expect(text?.startsWith('# chess-mcp openings v1\n')).toBe(true);
    const etag = service.etag();
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);

    const book = await service.waitForBook();
    expect(book?.size).toBe(status.positions);
    expect(service.etag()).toBe(etag);
  });

  it('reads the cached book on the next boot without refetching', async () => {
    const dataDir = tempDir();
    const firstFetch = fakeFetch();
    const first = new OpeningsInstaller({
      dataDir,
      release: fixtureRelease(),
      fetchImpl: firstFetch
    });
    await new OpeningService({ dataDir, installer: first }).ensure();

    const secondFetch = fakeFetch();
    const second = new OpeningsInstaller({
      dataDir,
      release: fixtureRelease(),
      fetchImpl: secondFetch
    });
    const service = new OpeningService({ dataDir, installer: second });
    await service.ensure();

    expect(service.statusInfo().phase).toBe('ready');
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('stays disabled when downloads are switched off', async () => {
    const service = new OpeningService({ dataDir: tempDir(), enabled: false });
    await service.ensure();

    expect(service.statusInfo().phase).toBe('disabled');
    expect(service.bookText()).toBeNull();
    expect(await service.waitForBook()).toBeNull();
  });
});
