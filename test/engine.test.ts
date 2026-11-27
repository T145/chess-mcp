import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  engineCandidates,
  findOnPath,
  managedEnginePath
} from '../src/engine/locate.js';
import { isSafeArchivePath } from '../src/engine/install.js';
import { ENGINE_RELEASE, selectReleaseAsset, unsupportedPlatformMessage } from '../src/engine/releases.js';
import { parseBestMove, parseInfoLine } from '../src/engine/uci.js';
import { materialBalance } from '../src/shared/material.js';

describe('UCI parsing', () => {
  it('parses a cp line with a principal variation', () => {
    const info = parseInfoLine(
      'info depth 14 seldepth 20 multipv 1 score cp 34 nodes 1200 nps 50000 pv e2e4 e7e5 g1f3'
    );
    expect(info).toEqual({
      depth: 14,
      multipv: 1,
      cp: 34,
      mate: null,
      pv: ['e2e4', 'e7e5', 'g1f3'],
      bound: false
    });
  });

  it('parses mate scores, multipv, and bound markers', () => {
    const mate = parseInfoLine('info depth 20 multipv 2 score mate -3 pv h7h8q');
    expect(mate?.mate).toBe(-3);
    expect(mate?.cp).toBeNull();
    expect(mate?.multipv).toBe(2);

    const bound = parseInfoLine('info depth 10 score cp 99 lowerbound pv e2e4');
    expect(bound?.bound).toBe(true);
    expect(bound?.cp).toBe(99);
  });

  it('ignores lines without a score', () => {
    expect(parseInfoLine('info depth 10 currmove e2e4')).toBeNull();
    expect(parseInfoLine('uciok')).toBeNull();
  });

  it('parses bestmove and (none)', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseBestMove('bestmove (none)')).toBeNull();
  });
});

describe('release selection', () => {
  it('pins universal assets per platform', () => {
    expect(selectReleaseAsset('win32', 'x64')?.file).toBe(
      'stockfish-windows-x86-64-universal.zip'
    );
    expect(selectReleaseAsset('win32', 'arm64')?.file).toBe(
      'stockfish-windows-arm64-universal.zip'
    );
    expect(selectReleaseAsset('darwin', 'arm64')?.file).toBe('stockfish-macos-universal.tar.gz');
    expect(selectReleaseAsset('darwin', 'x64')?.file).toBe('stockfish-macos-universal.tar.gz');
    expect(selectReleaseAsset('linux', 'x64')?.file).toBe('stockfish-linux-x86-64-universal.tar.gz');
    expect(selectReleaseAsset('linux', 'arm64')?.file).toBe(
      'stockfish-linux-arm64-universal.tar.gz'
    );
    expect(selectReleaseAsset('freebsd', 'x64')).toBeNull();
    expect(unsupportedPlatformMessage('freebsd', 'x64')).toMatch(/--engine/);
  });

  it('uses the pinned release URL and digest', () => {
    const asset = selectReleaseAsset('linux', 'x64');
    expect(asset?.url).toBe(
      `https://github.com/official-stockfish/Stockfish/releases/download/${ENGINE_RELEASE.tag}/${asset?.file}`
    );
    expect(asset?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset?.bytes).toBeGreaterThan(1_000_000);
  });
});

describe('engine location', () => {
  it('rejects archive paths that escape the target directory', () => {
    expect(isSafeArchivePath('stockfish/stockfish-linux')).toBe(true);
    expect(isSafeArchivePath('../outside')).toBe(false);
    expect(isSafeArchivePath('/tmp/outside')).toBe(false);
    expect(isSafeArchivePath('C:\\Windows\\evil.exe')).toBe(false);
    expect(isSafeArchivePath('folder/../../evil')).toBe(false);
  });

  it('finds executables on PATH and strips duplicates', () => {
    const env = { PATH: ['/one', '/two'].join(path.delimiter) };
    const found = findOnPath(['stockfish'], env, 'linux');
    expect(found.every((file) => file.endsWith('stockfish'))).toBe(true);
    expect(new Set(found).size).toBe(found.length);
  });

  it('always tries an explicit engine first', () => {
    const explicit = path.resolve('bin/stockfish');
    const candidates = engineCandidates({
      explicitPath: explicit,
      env: { PATH: '' },
      platform: 'linux',
      home: '/home/nobody'
    });
    expect(candidates[0]).toBe(explicit);
    expect(candidates.filter((candidate) => candidate === explicit)).toHaveLength(1);
  });

  it('places the managed binary under the data directory', () => {
    expect(managedEnginePath('/data', 'sf_19', 'win32')).toBe(
      path.join('/data', 'engine', 'sf_19', 'stockfish.exe')
    );
    expect(managedEnginePath('/data', 'sf_19', 'linux')).toBe(
      path.join('/data', 'engine', 'sf_19', 'stockfish')
    );
  });
});

describe('materialBalance', () => {
  it('reports White material from the FEN alone', () => {
    expect(materialBalance('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(0);
    expect(materialBalance('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(9);
  });
});
