import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  BOOK_HEADER,
  parseBookText,
  serializeBook,
  type LoadedBook,
  type OpeningBook
} from '../shared/openings.js';
import type { OpeningSource, OpeningStatus } from '../shared/protocol.js';
import { buildOpeningBook } from './build.js';
import { OpeningsInstaller } from './install.js';

export interface OpeningServiceOptions {
  dataDir: string;
  /** False when the user disabled automatic downloads. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  installer?: OpeningsInstaller;
  log?: (message: string) => void;
}

/**
 * Owns the downloaded opening data: installs it on first boot, builds a
 * position-indexed book once, caches the derived text in the data directory,
 * and exposes it to the review pipeline and the HTTP API.
 */
export class OpeningService {
  private readonly installer: OpeningsInstaller;
  private readonly enabled: boolean;
  private readonly log: (message: string) => void;
  private readonly source: OpeningSource;
  private status: OpeningStatus;
  private bookData: OpeningBook | null = null;
  private text: string | null = null;
  private tag: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: OpeningServiceOptions) {
    this.enabled = options.enabled ?? true;
    this.log = options.log ?? (() => undefined);
    this.installer =
      options.installer ??
      new OpeningsInstaller({
        dataDir: options.dataDir,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        log: this.log
      });

    const release = this.installer.release;
    this.source = {
      name: release.name,
      license: release.license,
      licenseUrl: release.licenseUrl,
      sourceUrl: release.sourceUrl,
      commit: release.commit
    };
    this.status = {
      phase: this.enabled ? 'idle' : 'disabled',
      positions: 0,
      source: this.source,
      error: null
    };
  }

  statusInfo(): OpeningStatus {
    return { ...this.status, source: this.status.source ? { ...this.status.source } : null };
  }

  /** Download (if needed) and load the book. Safe to call repeatedly. */
  ensure(): Promise<void> {
    if (!this.enabled || this.bookData) return Promise.resolve();
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Resolve with the loaded book, or null when the data is unavailable. */
  async waitForBook(): Promise<OpeningBook | null> {
    await this.ensure();
    return this.bookData;
  }

  book(): OpeningBook | null {
    return this.bookData;
  }

  /** The loaded book plus the identity to record on reviews, or null. */
  loadedBook(): LoadedBook | null {
    return this.bookData ? { book: this.bookData, key: this.installer.release.commit } : null;
  }

  /** Serialized book for the web app, or null before it is ready. */
  bookText(): string | null {
    return this.text;
  }

  etag(): string | null {
    return this.tag;
  }

  /** Retry after a failed download (used by the API's install endpoint). */
  retry(): void {
    if (!this.enabled || this.inFlight) return;
    this.bookData = null;
    this.text = null;
    this.tag = null;
    this.status = { phase: 'idle', positions: 0, source: this.source, error: null };
    void this.ensure();
  }

  private async load(): Promise<void> {
    this.status = { ...this.status, phase: 'downloading', error: null };

    try {
      if (!this.installer.isInstalled()) {
        this.log(`Openings: fetching ${this.installer.release.name}…`);
        await this.installer.install();
      }

      const text = this.readOrBuildBook();
      const book = parseBookText(text);
      if (book.size === 0) throw new Error('The opening data contained no positions.');

      this.bookData = book;
      this.text = text;
      this.tag = `"${createHash('sha256').update(text).digest('hex').slice(0, 32)}"`;
      this.status = { phase: 'ready', positions: book.size, source: this.source, error: null };
      this.log(`Openings: ${book.size} positions ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { phase: 'failed', positions: 0, source: this.source, error: message };
      this.log(`Openings setup failed: ${message}`);
    }
  }

  /** Use the cached derived book when it is intact, else rebuild from the TSVs. */
  private readOrBuildBook(): string {
    if (existsSync(this.installer.cachePath)) {
      const cached = readFileSync(this.installer.cachePath, 'utf8');
      if (cached.startsWith(`${BOOK_HEADER}\n`)) return cached;
    }

    const text = serializeBook(buildOpeningBook(this.installer.sourceTexts()));
    const temporary = `${this.installer.cachePath}.tmp`;
    try {
      mkdirSync(path.dirname(this.installer.cachePath), { recursive: true });
      writeFileSync(temporary, text, 'utf8');
      rmSync(this.installer.cachePath, { force: true });
      renameSync(temporary, this.installer.cachePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Openings: could not cache the derived book (${message})`);
    }
    return text;
  }
}
