import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BUILTIN_THEME,
  PIECE_CODES,
  RUNTIME_THEMES,
  themeEntry,
  type PieceCode,
  type RuntimeThemeDefinition,
  type ThemeAssetStatus,
  type ThemeCatalogEntry,
  type ThemeCatalogResponse
} from '../shared/themes.js';

const CHESSCOM_BASE = 'https://images.chesscomfiles.com/chess-themes/pieces';
const LICHESS_BASE = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece';
const USER_AGENT = 'Mozilla/5.0 (compatible; chess-mcp/0.1; theme-assets)';
const ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;
const PIECE_CODE_SET: ReadonlySet<string> = new Set(PIECE_CODES);

export interface ThemeAssetServiceOptions {
  dataDir: string;
  /** False when the user disabled automatic downloads. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

interface DownloadFailures {
  count: number;
}

function isAsset(file: string, extension: 'svg' | 'png'): boolean {
  try {
    const bytes = readFileSync(file);
    if (extension === 'png') {
      return (
        bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG'
      );
    }
    return bytes.includes('<svg');
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the runtime piece sets (permissive Lichess SVGs and local Chess.com /
 * Neo Angle PNGs). Files live in `<data-dir>/themes/<theme-id>/<piece>.<ext>`
 * and are served by the HTTP app at `/theme-assets/<theme-id>/<file>`.
 */
export class ThemeAssetService {
  readonly root: string;
  private readonly enabled: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly complete = new Set<string>();
  private status: ThemeAssetStatus;
  private inFlight: Promise<void> | null = null;

  constructor(options: ThemeAssetServiceOptions) {
    this.root = path.join(path.resolve(options.dataDir), 'themes');
    this.enabled = options.enabled ?? true;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? (() => undefined);
    this.status = {
      phase: this.enabled ? 'idle' : 'disabled',
      ready: 0,
      total: RUNTIME_THEMES.length,
      error: null
    };
  }

  statusInfo(): ThemeAssetStatus {
    return { ...this.status };
  }

  /** Download any missing runtime theme files. Safe to call repeatedly. */
  ensureAll(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.downloadAll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  catalog(): ThemeCatalogResponse {
    const themes: ThemeCatalogEntry[] = [
      themeEntry(BUILTIN_THEME),
      ...RUNTIME_THEMES.filter((theme) => this.isComplete(theme)).map((theme) =>
        themeEntry(theme, `/theme-assets/${theme.id}`)
      )
    ];

    return { themes, status: this.statusInfo() };
  }

  /** Absolute path for a complete runtime theme asset, or null. */
  assetFile(themeId: string, file: string): string | null {
    const theme = RUNTIME_THEMES.find((candidate) => candidate.id === themeId);
    if (!theme) return null;
    const suffix = `.${theme.extension}`;
    if (!file.endsWith(suffix)) return null;
    const code = file.slice(0, -suffix.length);
    if (!PIECE_CODE_SET.has(code)) return null;

    const target = path.join(this.root, theme.id, `${code}.${theme.extension}`);
    return existsSync(target) && isAsset(target, theme.extension) ? target : null;
  }

  private isComplete(theme: RuntimeThemeDefinition): boolean {
    if (this.complete.has(theme.id)) return true;
    const done = PIECE_CODES.every((code) =>
      isAsset(path.join(this.root, theme.id, `${code}.${theme.extension}`), theme.extension)
    );
    if (done) this.complete.add(theme.id);
    return done;
  }

  private async downloadAll(): Promise<void> {
    this.status = { ...this.status, phase: 'downloading', error: null };
    this.log(`Themes: checking ${RUNTIME_THEMES.length} runtime sets in ${this.root}`);
    const failures: DownloadFailures = { count: 0 };
    await this.processThemes(0, failures);

    const ready = RUNTIME_THEMES.filter((theme) => this.isComplete(theme)).length;
    this.status = {
      phase: ready > 0 ? 'ready' : 'failed',
      ready,
      total: RUNTIME_THEMES.length,
      error: failures.count > 0 ? `${failures.count} theme(s) could not be downloaded` : null
    };
    this.log(`Themes: ${ready}/${RUNTIME_THEMES.length} runtime sets ready`);
  }

  private async processThemes(index: number, failures: DownloadFailures): Promise<void> {
    const theme = RUNTIME_THEMES[index];
    if (!theme) return;
    if (!this.isComplete(theme)) {
      try {
        await this.downloadTheme(theme);
      } catch (error) {
        failures.count += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Theme ${theme.id} failed: ${message}`);
      }
    }
    await this.processThemes(index + 1, failures);
  }

  private async downloadTheme(theme: RuntimeThemeDefinition): Promise<void> {
    const directory = path.join(this.root, theme.id);
    await mkdir(directory, { recursive: true });
    await Promise.all(
      PIECE_CODES.map(async (code) => {
        const target = path.join(directory, `${code}.${theme.extension}`);
        if (isAsset(target, theme.extension)) return;
        const bytes = await this.fetchAsset(theme, code);
        await writeFile(target, bytes);
      })
    );
    this.complete.delete(theme.id);
    if (this.isComplete(theme)) this.complete.add(theme.id);
  }

  private async fetchAsset(theme: RuntimeThemeDefinition, code: PieceCode): Promise<Buffer> {
    const source = theme.assetSource;
    const url =
      source.type === 'lichess'
        ? `${LICHESS_BASE}/${source.directory}/${code}.svg`
        : source.type === 'chesscom'
          ? `${CHESSCOM_BASE}/${source.slug}/150/${code.toLowerCase()}.png`
          : source.files[code];
    return this.fetchFile(url, theme.extension);
  }

  private async fetchFile(
    url: string,
    extension: 'svg' | 'png',
    attempt = 1
  ): Promise<Buffer> {
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

      if (extension === 'svg') {
        const text = await response.text();
        if (!text.includes('<svg')) throw new Error(`expected an SVG at ${url}`);
        return Buffer.from(text, 'utf8');
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const isPngBytes =
        bytes.length > 8 &&
        bytes[0] === 0x89 &&
        bytes.subarray(1, 4).toString('latin1') === 'PNG';
      if (!isPngBytes) throw new Error(`expected a PNG at ${url}`);
      return bytes;
    } catch (error) {
      if (attempt >= ATTEMPTS) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message, { cause: error });
      }
      await sleep(300 * attempt);
      return this.fetchFile(url, extension, attempt + 1);
    }
  }
}
