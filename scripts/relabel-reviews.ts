/**
 * Recompute opening-book labels on saved reviews. Useful after the opening
 * dataset is added or re-pinned: it reuses the stored engine evaluations, so no
 * Stockfish run (and no 80 MB download) is needed.
 *
 * Usage: pnpm reviews:relabel [--data-dir=<path>]
 */
import { OpeningService } from '../src/openings/service.js';
import { annotateWithBook } from '../src/review/annotate.js';
import { GameStorage, resolveDataDir } from '../src/storage.js';

const override = process.argv
  .find((value) => value.startsWith('--data-dir='))
  ?.slice('--data-dir='.length);
const dataDir = override ? override : resolveDataDir();

const storage = new GameStorage(dataDir);
const snapshots = storage.load();
console.log(`Data directory: ${dataDir}`);
console.log(`Saved games: ${snapshots.length}`);

if (snapshots.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const openings = new OpeningService({ dataDir, log: (message) => console.log(message) });
await openings.ensure();

const loaded = openings.loadedBook();
if (!loaded) {
  throw new Error(openings.statusInfo().error ?? 'The opening book is not ready.');
}

let updated = 0;
let unchanged = 0;
let missing = 0;
let skipped = 0;
let bookMoves = 0;

for (const snapshot of snapshots) {
  const review = storage.loadReview(snapshot.id);
  if (!review) {
    missing += 1;
    continue;
  }
  if (review.moveCount !== snapshot.moves.length) {
    console.warn(`Skipping ${snapshot.id}: review does not match the saved game.`);
    skipped += 1;
    continue;
  }
  if (review.book === loaded.key) {
    unchanged += 1;
    continue;
  }

  const annotated = annotateWithBook({
    review,
    initialFen: snapshot.initialFen,
    moves: snapshot.moves,
    book: loaded.book,
    bookKey: loaded.key
  });
  storage.saveReview(annotated);

  const count = annotated.moves.filter((move) => move.quality === 'book').length;
  bookMoves += count;
  updated += 1;
  const name = annotated.opening
    ? `${annotated.opening.name} (${annotated.opening.eco})`
    : 'left theory immediately';
  console.log(`  ${snapshot.id}: ${count} book move(s) — ${name}`);
}

console.log(
  `Updated ${updated} review(s), ${bookMoves} book move(s); ` +
    `${unchanged} already current, ${missing} without a review, ${skipped} skipped.`
);
