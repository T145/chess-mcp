/**
 * The pinned opening dataset. Byte sizes and SHA-256 digests were computed from
 * the files at this exact commit, so a download is verified before it is used.
 * Source: https://github.com/lichess-org/chess-openings (CC0-1.0).
 */
export interface OpeningSourceFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface OpeningRelease {
  /** Short tag used as the on-disk directory name. */
  tag: string;
  commit: string;
  name: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  files: readonly OpeningSourceFile[];
}

const RAW_BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings';

export const OPENINGS_RELEASE: OpeningRelease = {
  tag: '48a8c0e',
  commit: '48a8c0e733facfdc9a3723fe882e51ec28014074',
  name: 'Lichess opening names',
  license: 'CC0-1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl: 'https://github.com/lichess-org/chess-openings',
  files: [
    {
      name: 'a.tsv',
      bytes: 67_257,
      sha256: '3282e4c9155289a29224f9a85fba0decb46efa35c2fa5e39662d2ac48fb0f793'
    },
    {
      name: 'b.tsv',
      bytes: 78_137,
      sha256: '2744a3890879bd9dce79093147fe5b6c3a9d9d42a3388af698e67b6829be1c48'
    },
    {
      name: 'c.tsv',
      bytes: 132_304,
      sha256: '447bbd4b15d68067b150faf12bf66aa14b18582cf80d736aaa7c0081131806ef'
    },
    {
      name: 'd.tsv',
      bytes: 73_318,
      sha256: '1cf4057a8aece94f27bb3f278ad410ee2844831a642364eeceaafa091dbcceda'
    },
    {
      name: 'e.tsv',
      bytes: 44_061,
      sha256: '48c6f6645b031a5937c8386839debab0e2e48837251687ba1afb6369677f8546'
    }
  ]
};

export function openingFileUrl(file: OpeningSourceFile, release: OpeningRelease): string {
  return `${RAW_BASE}/${release.commit}/${file.name}`;
}
