/**
 * End-to-end check of the pinned opening dataset: installs it into a temporary
 * data directory (so the pinned byte sizes and SHA-256 digests are verified
 * against the live upstream), builds the book, and spot-checks a known opening.
 *
 * Run with `pnpm openings:check` after bumping `src/openings/release.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Chess } from 'chess.js';

import { OpeningService } from '../src/openings/service.js';
import { bookForFens, deepestOpening } from '../src/shared/openings.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'chess-mcp-openings-check-'));
const service = new OpeningService({ dataDir, log: (message) => console.log(message) });

try {
  await service.ensure();
  const status = service.statusInfo();
  if (status.phase !== 'ready') {
    throw new Error(status.error ?? `The opening book is ${status.phase}.`);
  }

  const chess = new Chess();
  const fens = [chess.fen()];
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
    chess.move(san);
    fens.push(chess.fen());
  }

  const book = await service.waitForBook();
  if (!book) throw new Error('The opening book did not load.');

  const plies = bookForFens(fens, book);
  const opening = deepestOpening(plies);
  console.log(`positions=${status.positions} bookPlies=${plies.filter((ply) => ply.book).length}`);
  console.log(`ruy-lopez=${opening?.eco ?? 'none'} ${opening?.name ?? ''}`);

  if (!plies.every((ply) => ply.book)) {
    throw new Error('The Ruy Lopez line was not fully recognised as book.');
  }
  if (opening?.eco !== 'C60') {
    throw new Error(`Expected ECO C60 for the Ruy Lopez, got ${opening?.eco ?? 'none'}.`);
  }
  console.log('Opening dataset OK.');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
