import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import {
  ENGINE_RELEASE,
  selectReleaseAsset,
  unsupportedPlatformMessage,
  type ReleaseAsset
} from './releases.js';
import { managedEnginePath } from './locate.js';
import { probeEngine } from './uci.js';

export interface InstallProgress {
  receivedBytes: number;
  totalBytes: number;
  percent: number | null;
}

export interface InstallResult {
  path: string;
  name: string;
}

export interface EngineInstallerOptions {
  dataDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  probe?: (command: string) => Promise<{ name: string } | null>;
  now?: () => number;
  onProgress?: (progress: InstallProgress) => void;
  log?: (message: string) => void;
}

const DOWNLOAD_TIMEOUT_MS = 300_000;
const LOCK_STALE_MS = 10 * 60_000;

/** Reject archive entries that could escape the extraction directory. */
export function isSafeArchivePath(entry: string): boolean {
  if (!entry || entry.startsWith('/') || entry.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(entry)) return false;
  return !entry.split(/[\\/]/).includes('..');
}

function archiveEntries(archivePath: string): string[] {
  const result = spawnSync('tar', ['-tf', archivePath], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`Could not inspect the engine archive: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((entry) => entry.length > 0);
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractArchive(archivePath: string, destination: string, asset: ReleaseAsset): void {
  const fromTar = spawnSync('tar', ['-xf', archivePath, '-C', destination], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (fromTar.status === 0) return;

  if (asset.format === 'zip') {
    const folder = path.dirname(archivePath);
    const script =
      `Expand-Archive -LiteralPath ${powershellQuote(archivePath)} ` +
      `-DestinationPath ${powershellQuote(destination)} -Force`;
    const fromPowershell = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { cwd: folder, encoding: 'utf8', windowsHide: true }
    );
    if (fromPowershell.status === 0) return;
  }

  throw new Error(
    `Could not extract ${asset.file}. Make sure "tar" is available. ${fromTar.stderr.trim()}`
  );
}

function findEngineCandidates(root: string, platform: NodeJS.Platform): string[] {
  const found: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const name = entry.name.toLowerCase();
      if (platform === 'win32') {
        if (name.endsWith('.exe') && name.includes('stockfish')) found.push(full);
      } else if (!path.extname(name) && name.includes('stockfish')) {
        found.push(full);
      }
    }
  };

  visit(root);
  return found.toSorted((a, b) => {
    const universal = Number(b.includes('universal')) - Number(a.includes('universal'));
    return universal !== 0 ? universal : b.length - a.length;
  });
}

function acquireLock(lockPath: string, now: () => number): void {
  mkdirSync(path.dirname(lockPath), { recursive: true });

  const attempt = (): boolean => {
    try {
      const descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: now() }));
      closeSync(descriptor);
      return true;
    } catch {
      return false;
    }
  };

  if (attempt()) return;

  try {
    const stats = statSync(lockPath);
    if (now() - stats.mtimeMs > LOCK_STALE_MS) {
      rmSync(lockPath, { force: true });
      if (attempt()) return;
    }
  } catch {
    // The lock disappeared between checks; fall through to the error.
  }

  throw new Error('Another Stockfish download is already in progress.');
}

interface DownloadOptions {
  fetchImpl: typeof fetch;
  onProgress?: (progress: InstallProgress) => void;
}

async function downloadAsset(
  asset: ReleaseAsset,
  destination: string,
  options: DownloadOptions
): Promise<void> {
  const response = await options.fetchImpl(asset.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Engine download failed (HTTP ${response.status}).`);
  }

  const hash = createHash('sha256');
  const reader = response.body.getReader();
  const handle = await open(destination, 'w');
  let received = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- the response stream is consumed sequentially
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      received += chunk.length;
      // oxlint-disable-next-line no-await-in-loop -- sequential file writes keep the hash order
      await handle.write(chunk);
      options.onProgress?.({
        receivedBytes: received,
        totalBytes: asset.bytes,
        percent: asset.bytes > 0 ? (received / asset.bytes) * 100 : null
      });
    }
  } finally {
    await handle.close();
  }

  if (received !== asset.bytes) {
    throw new Error(`Engine download was incomplete (${received} of ${asset.bytes} bytes).`);
  }
  if (hash.digest('hex') !== asset.sha256) {
    throw new Error('Engine download failed its SHA-256 checksum. Nothing was installed.');
  }
}

/**
 * Downloads and installs the pinned Stockfish release into the app's data
 * directory. All side effects are injectable so tests never touch the network.
 */
export class EngineInstaller {
  readonly asset: ReleaseAsset | null;
  readonly targetPath: string;
  private readonly engineRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetchImpl: typeof fetch;
  private readonly probe: (command: string) => Promise<{ name: string } | null>;
  private readonly now: () => number;
  private readonly onProgress: ((progress: InstallProgress) => void) | undefined;
  private readonly log: (message: string) => void;

  constructor(options: EngineInstallerOptions) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.engineRoot = path.join(path.resolve(options.dataDir), 'engine');
    this.asset = selectReleaseAsset(this.platform, this.arch);
    this.targetPath = managedEnginePath(
      path.resolve(options.dataDir),
      ENGINE_RELEASE.tag,
      this.platform
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probe = options.probe ?? ((command) => probeEngine(command));
    this.now = options.now ?? (() => Date.now());
    this.onProgress = options.onProgress;
    this.log = options.log ?? (() => undefined);
  }

  /** True when the managed binary exists and answers a UCI handshake. */
  async isInstalled(): Promise<{ name: string } | null> {
    if (!existsSync(this.targetPath)) return null;
    return this.probe(this.targetPath);
  }

  async install(): Promise<InstallResult> {
    const already = await this.isInstalled();
    if (already) return { path: this.targetPath, name: already.name };

    const asset = this.asset;
    if (!asset) throw new Error(unsupportedPlatformMessage(this.platform, this.arch));

    mkdirSync(this.engineRoot, { recursive: true });
    const lockPath = path.join(this.engineRoot, '.install.lock');
    acquireLock(lockPath, this.now);

    const stamp = `${process.pid}-${Math.random().toString(16).slice(2)}`;
    const archivePath = path.join(this.engineRoot, `.download-${asset.file}`);
    const temporaryDirectory = path.join(this.engineRoot, `.tmp-${stamp}`);

    try {
      this.log(`Downloading ${ENGINE_RELEASE.name} (${Math.round(asset.bytes / 1_000_000)} MB)…`);
      await downloadAsset(asset, archivePath, {
        fetchImpl: this.fetchImpl,
        ...(this.onProgress ? { onProgress: this.onProgress } : {})
      });

      const entries = archiveEntries(archivePath);
      if (entries.length === 0) throw new Error('The engine archive was empty.');
      if (!entries.every((entry) => isSafeArchivePath(entry))) {
        throw new Error('The engine archive contained an unsafe path.');
      }

      mkdirSync(temporaryDirectory, { recursive: true });
      extractArchive(archivePath, temporaryDirectory, asset);

      const candidates = findEngineCandidates(temporaryDirectory, this.platform);
      if (candidates.length === 0) {
        throw new Error('The engine archive did not contain a Stockfish binary.');
      }

      let binary: string | null = null;
      let name: string | null = null;
      for (const candidate of candidates) {
        // oxlint-disable-next-line no-await-in-loop -- only the first working binary is kept
        const probed = await this.probe(candidate);
        if (probed) {
          binary = candidate;
          name = probed.name;
          break;
        }
      }
      if (!binary || !name) {
        throw new Error('The downloaded Stockfish binary did not start.');
      }

      chmodSync(binary, 0o755);
      mkdirSync(path.dirname(this.targetPath), { recursive: true });
      if (existsSync(this.targetPath)) rmSync(this.targetPath, { force: true });
      renameSync(binary, this.targetPath);

      writeFileSync(
        path.join(path.dirname(this.targetPath), 'install.json'),
        `${JSON.stringify(
          {
            version: ENGINE_RELEASE.tag,
            asset: asset.file,
            sha256: asset.sha256,
            installedAt: this.now()
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      this.log(`Installed ${name} at ${this.targetPath}`);
      return { path: this.targetPath, name };
    } finally {
      rmSync(archivePath, { force: true });
      rmSync(temporaryDirectory, { recursive: true, force: true });
      rmSync(lockPath, { force: true });
    }
  }
}

