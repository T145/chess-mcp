import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  OPENINGS_RELEASE,
  openingFileUrl,
  type OpeningRelease,
  type OpeningSourceFile
} from './release.js';
import type { OpeningSourceText } from './build.js';

const ATTEMPTS = 3;
const TIMEOUT_MS = 60_000;

export interface OpeningsProgress {
  file: string;
  receivedBytes: number;
  totalBytes: number;
  percent: number | null;
}

export interface OpeningsInstallerOptions {
  dataDir: string;
  /** Tests pin a fixture release instead of the real upstream dataset. */
  release?: OpeningRelease;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  onProgress?: (progress: OpeningsProgress) => void;
  now?: () => number;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Downloads the pinned ECO TSVs into `<data-dir>/openings/<tag>/`. Every file is
 * checked against a pinned byte size and SHA-256 before it is written, and each
 * write is atomic, so a failed download never leaves a half-usable book.
 */
export class OpeningsInstaller {
  readonly release: OpeningRelease;
  /** Directory holding this release's files and the derived book cache. */
  readonly directory: string;
  /** Derived, locally generated book text (fast path on later boots). */
  readonly cachePath: string;
  readonly manifestPath: string;

  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly onProgress: ((progress: OpeningsProgress) => void) | undefined;
  private readonly now: () => number;

  constructor(options: OpeningsInstallerOptions) {
    this.release = options.release ?? OPENINGS_RELEASE;
    this.directory = path.join(path.resolve(options.dataDir), 'openings', this.release.tag);
    this.cachePath = path.join(this.directory, 'book.tsv');
    this.manifestPath = path.join(this.directory, 'install.json');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? (() => undefined);
    this.onProgress = options.onProgress;
    this.now = options.now ?? (() => Date.now());
  }

  filePath(name: string): string {
    return path.join(this.directory, name);
  }

  /** True when a source file exists with the pinned size and digest. */
  verify(file: OpeningSourceFile): boolean {
    try {
      const bytes = readFileSync(this.filePath(file.name));
      return bytes.length === file.bytes && sha256(bytes) === file.sha256;
    } catch {
      return false;
    }
  }

  isInstalled(): boolean {
    return this.release.files.every((file) => this.verify(file));
  }

  /** Read every verified source file, throwing if one is missing or corrupt. */
  sourceTexts(): OpeningSourceText[] {
    return this.release.files.map((file) => {
      if (!this.verify(file)) {
        throw new Error(`Opening data ${file.name} is missing or corrupt.`);
      }
      return { name: file.name, text: readFileSync(this.filePath(file.name), 'utf8') };
    });
  }

  async install(): Promise<void> {
    mkdirSync(this.directory, { recursive: true });

    for (const file of this.release.files) {
      if (this.verify(file)) continue;
      // oxlint-disable-next-line no-await-in-loop -- downloads are sequential to keep progress ordered
      await this.download(file);
    }

    writeFileSync(
      this.manifestPath,
      `${JSON.stringify(
        {
          source: this.release.sourceUrl,
          commit: this.release.commit,
          license: this.release.license,
          files: this.release.files.map((file) => ({ name: file.name, sha256: file.sha256 })),
          installedAt: this.now()
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    this.log(`Openings: installed ${this.release.name} (${this.release.files.length} files)`);
  }

  private async download(file: OpeningSourceFile): Promise<void> {
    const target = this.filePath(file.name);
    const temporary = `${target}.tmp`;

    try {
      const bytes = await this.fetchFile(file);
      if (bytes.length !== file.bytes) {
        throw new Error(
          `${file.name} was ${bytes.length} bytes, expected ${file.bytes}. Nothing was installed.`
        );
      }
      if (sha256(bytes) !== file.sha256) {
        throw new Error(`${file.name} failed its SHA-256 checksum. Nothing was installed.`);
      }

      writeFileSync(temporary, bytes);
      rmSync(target, { force: true });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private async fetchFile(file: OpeningSourceFile, attempt = 1): Promise<Buffer> {
    try {
      const response = await this.fetchImpl(openingFileUrl(file, this.release), {
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${file.name}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      this.onProgress?.({
        file: file.name,
        receivedBytes: bytes.length,
        totalBytes: file.bytes,
        percent: file.bytes > 0 ? (bytes.length / file.bytes) * 100 : null
      });
      return bytes;
    } catch (error) {
      if (attempt >= ATTEMPTS) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not download ${file.name}: ${message}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      return this.fetchFile(file, attempt + 1);
    }
  }
}
