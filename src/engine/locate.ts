import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Split a PATH-like environment variable, matching Windows' case-insensitive keys. */
function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw =
    (env.PATH ?? env.Path ?? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]) ??
    '';
  return raw.split(path.delimiter).filter(Boolean);
}

/** Look for a binary by name on PATH without spawning anything. */
export function findOnPath(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const found: string[] = [];
  const extensions = platform === 'win32' ? ['', '.exe'] : [''];

  for (const directory of pathEntries(env)) {
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = path.join(directory, name.endsWith('.exe') ? name : `${name}${extension}`);
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

function executableNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['stockfish.exe'] : ['stockfish'];
}

function scanDirectory(directory: string, platform: NodeJS.Platform): string[] {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .filter((file) => {
        const name = path.basename(file).toLowerCase();
        return platform === 'win32' ? name.endsWith('.exe') && name.includes('stockfish') : name.includes('stockfish');
      });
  } catch {
    return [];
  }
}

/** Well-known install locations that are not always on PATH. */
export function commonEnginePaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return [
      ...scanDirectory(path.join(localAppData, 'Stockfish'), platform),
      ...scanDirectory(path.join(programFiles, 'Stockfish'), platform),
      ...scanDirectory(path.join(programFilesX86, 'Stockfish'), platform)
    ];
  }

  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin/stockfish',
      '/usr/local/bin/stockfish',
      path.join(home, 'Applications', 'Stockfish.app', 'Contents', 'MacOS', 'stockfish')
    ].filter((file) => existsSync(file));
  }

  return ['/usr/games/stockfish', '/usr/bin/stockfish', '/usr/local/bin/stockfish'].filter((file) =>
    existsSync(file)
  );
}

/**
 * Ordered candidates for a local engine: an explicit path wins, then PATH, then
 * common install folders. Duplicates are removed; the list may be empty.
 */
export function engineCandidates(options: {
  explicitPath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();

  const explicit = options.explicitPath?.trim();
  const candidates = [
    ...(explicit ? [path.resolve(explicit)] : []),
    ...findOnPath(executableNames(platform), env, platform),
    ...commonEnginePaths(platform, env, home)
  ];

  return [...new Set(candidates)];
}

/** Default location of an engine downloaded by this app. */
export function managedEnginePath(dataDir: string, tag: string, platform: NodeJS.Platform): string {
  const extension = platform === 'win32' ? '.exe' : '';
  return path.join(dataDir, 'engine', tag, `stockfish${extension}`);
}
