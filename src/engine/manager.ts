import type { EngineStatus } from '../shared/protocol.js';
import { EngineInstaller } from './install.js';
import type { InstallProgress } from './install.js';
import { engineCandidates } from './locate.js';
import { ENGINE_RELEASE } from './releases.js';
import { UciEngine, probeEngine } from './uci.js';
import type { EngineSession } from './uci.js';

export interface EngineManagerOptions {
  dataDir: string | null;
  explicitPath?: string | null;
  /** Download the managed Stockfish release when no local engine is found. */
  autoInstall?: boolean;
  /** Analysis depth reported in the UI/API. */
  depth?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  log?: (message: string) => void;
  probe?: (command: string) => Promise<{ name: string } | null>;
  createSession?: (command: string) => Promise<EngineSession>;
  installer?: EngineInstaller | null;
  /** Called when a managed Stockfish install begins, e.g. to warm theme assets. */
  onInstallStart?: () => void | Promise<void>;
  /** Tests pass false and call start() themselves. */
  autoStart?: boolean;
}

function initialState(depth: number): EngineStatus {
  return {
    phase: 'unavailable',
    name: null,
    version: null,
    path: null,
    managed: false,
    depth,
    download: null,
    error: null
  };
}

/**
 * Owns engine discovery, the optional automatic download, and the single live
 * UCI session. Review jobs wait on {@link waitForEngine} while an install runs.
 */
export class EngineManager {
  private readonly depth: number;
  private readonly autoInstall: boolean;
  private readonly candidates: string[];
  private readonly probe: (command: string) => Promise<{ name: string } | null>;
  private readonly createSession: (command: string) => Promise<EngineSession>;
  private readonly installer: EngineInstaller | null;
  private readonly onInstallStart: (() => void | Promise<void>) | undefined;
  private readonly log: (message: string) => void;
  private readonly listeners = new Set<(status: EngineStatus) => void>();
  private state: EngineStatus;
  private session: EngineSession | null = null;
  private resolution: Promise<EngineSession | null> = Promise.resolve(null);
  private started = false;
  private installRequested = false;
  private disposed = false;
  private lastPercent = -1;

  constructor(options: EngineManagerOptions) {
    this.depth = options.depth ?? 14;
    this.autoInstall = options.autoInstall ?? true;
    this.log = options.log ?? (() => undefined);
    this.state = initialState(this.depth);
    this.probe = options.probe ?? ((command) => probeEngine(command));
    this.createSession = options.createSession ?? ((command) => UciEngine.start(command));
    this.onInstallStart = options.onInstallStart;

    this.candidates = engineCandidates({
      explicitPath: options.explicitPath ?? null,
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.home ? { home: options.home } : {})
    });

    this.installer =
      options.installer ??
      (options.dataDir
        ? new EngineInstaller({
            dataDir: options.dataDir,
            ...(options.platform ? { platform: options.platform } : {}),
            ...(options.arch ? { arch: options.arch } : {}),
            log: this.log,
            onProgress: (progress) => this.updateDownload(progress)
          })
        : null);

    if (options.autoStart !== false) this.start();
  }

  status(): EngineStatus {
    return { ...this.state, ...(this.state.download ? { download: { ...this.state.download } } : {}) };
  }

  subscribe(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Begin discovery/downloading. Safe to call repeatedly. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.resolution = this.resolve();
    void this.resolution;
  }

  /** Wait for an engine, including any in-flight automatic download. */
  async waitForEngine(): Promise<EngineSession> {
    this.start();
    const session = await this.resolution;
    if (!session) {
      throw new Error(this.state.error ?? 'Stockfish is not available.');
    }
    return session;
  }

  /** Retry discovery (and the download, if one is configured). */
  retry(): void {
    if (this.disposed || this.state.phase === 'installing') return;
    this.installRequested = true;
    void this.session?.dispose();
    this.session = null;
    this.started = false;
    this.lastPercent = -1;
    this.state = {
      ...initialState(this.depth),
      phase: this.installer ? 'installing' : 'unavailable',
      version: this.installer ? ENGINE_RELEASE.name : null
    };
    this.notify();
    this.start();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    const session = this.session;
    this.session = null;
    await session?.dispose();
  }

  private async resolve(): Promise<EngineSession | null> {
    try {
      for (const candidate of this.candidates) {
        // oxlint-disable-next-line no-await-in-loop -- probing spawns processes; do it one at a time
        const probed = await this.probe(candidate);
        if (probed) return this.activate(candidate, probed.name, false);
      }

      if (this.installer) {
        const installed = await this.installer.isInstalled();
        if (installed) {
          this.log(`Engine found: ${installed.name} (managed)`);
          return await this.activate(this.installer.targetPath, installed.name, true);
        }

        if (this.autoInstall || this.installRequested) {
          this.lastPercent = -1;
          this.update({
            phase: 'installing',
            version: ENGINE_RELEASE.name,
            download: { receivedBytes: 0, totalBytes: this.installer.asset?.bytes ?? 0, percent: null },
            error: null
          });
          const hook = (async () => {
            try {
              await this.onInstallStart?.();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.log(`Install hook failed: ${message}`);
            }
          })();
          const result = await this.installer.install();
          void hook;
          return await this.activate(result.path, result.name, true);
        }
      }

      const message = this.installer
        ? `Stockfish was not found. Use --engine <path> or restart with downloads enabled to install ${ENGINE_RELEASE.name}.`
        : 'Stockfish was not found. Install it and start the server with --engine <path>.';
      this.update({ phase: 'unavailable', error: message, download: null });
      this.log(message);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update({ phase: 'failed', error: message, download: null });
      this.log(`Engine setup failed: ${message}`);
      return null;
    }
  }

  private async activate(
    command: string,
    probedName: string,
    managed: boolean
  ): Promise<EngineSession> {
    if (this.disposed) throw new Error('Engine manager is shut down.');
    if (this.session) {
      const previous = this.session;
      this.session = null;
      await previous.dispose();
    }

    const session = await this.createSession(command);
    this.session = session;
    this.update({
      phase: 'available',
      name: session.engineName || probedName,
      version: managed ? ENGINE_RELEASE.name : null,
      path: command,
      managed,
      download: null,
      error: null
    });
    this.log(`Engine ready: ${session.engineName || probedName} at ${command}`);
    return session;
  }

  private updateDownload(progress: InstallProgress): void {
    const percent = progress.percent;
    if (percent !== null && percent < 100 && percent - this.lastPercent < 1) return;
    this.lastPercent = percent ?? this.lastPercent;
    this.update({
      phase: 'installing',
      version: ENGINE_RELEASE.name,
      managed: true,
      download: {
        receivedBytes: progress.receivedBytes,
        totalBytes: progress.totalBytes,
        percent
      }
    });
  }

  private update(patch: Partial<EngineStatus>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.log(`Engine listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

