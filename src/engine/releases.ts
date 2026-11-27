/**
 * Pinned Stockfish release. Asset names, sizes, and SHA-256 digests come from
 * the official GitHub release metadata, so a download can be verified without
 * calling the GitHub API at runtime.
 */
export const ENGINE_RELEASE = {
  tag: 'sf_19',
  name: 'Stockfish 19'
} as const;

export type ArchiveFormat = 'tar.gz' | 'zip';

export interface ReleaseAsset {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  format: ArchiveFormat;
}

const BASE_URL = `https://github.com/official-stockfish/Stockfish/releases/download/${ENGINE_RELEASE.tag}`;

function asset(file: string, sha256: string, bytes: number, format: ArchiveFormat): ReleaseAsset {
  return { file, url: `${BASE_URL}/${file}`, sha256, bytes, format };
}

const WINDOWS_X64 = asset(
  'stockfish-windows-x86-64-universal.zip',
  '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7',
  81_431_614,
  'zip'
);

const WINDOWS_ARM64 = asset(
  'stockfish-windows-arm64-universal.zip',
  '8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401',
  80_190_536,
  'zip'
);

const MACOS_UNIVERSAL = asset(
  'stockfish-macos-universal.tar.gz',
  'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
  82_323_876,
  'tar.gz'
);

const LINUX_X64 = asset(
  'stockfish-linux-x86-64-universal.tar.gz',
  '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f',
  81_388_977,
  'tar.gz'
);

const LINUX_ARM64 = asset(
  'stockfish-linux-arm64-universal.tar.gz',
  'fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01',
  80_181_250,
  'tar.gz'
);

const LINUX_RISCV64 = asset(
  'stockfish-linux-riscv64-universal.tar.gz',
  'd4b4d118c003bc669a939d9fb208e3ef6b367730fd79a70dbc278b18475df3d1',
  80_241_608,
  'tar.gz'
);

/**
 * Pick the universal release for a platform. Stockfish 19 binaries detect CPU
 * features (AVX2, BMI2, ...) at startup, so there is no variant to choose.
 */
export function selectReleaseAsset(platform: string, arch: string): ReleaseAsset | null {
  if (platform === 'win32' && arch === 'x64') return WINDOWS_X64;
  if (platform === 'win32' && arch === 'arm64') return WINDOWS_ARM64;
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return MACOS_UNIVERSAL;
  if (platform === 'linux' && arch === 'x64') return LINUX_X64;
  if (platform === 'linux' && arch === 'arm64') return LINUX_ARM64;
  if (platform === 'linux' && arch === 'riscv64') return LINUX_RISCV64;
  return null;
}

export function unsupportedPlatformMessage(platform: string, arch: string): string {
  return (
    `No automatic Stockfish download is available for ${platform}/${arch}. ` +
    'Install Stockfish yourself and start the server with --engine <path>.'
  );
}
