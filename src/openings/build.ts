import { Chess } from 'chess.js';

import { normalizeFen, type OpeningBook } from '../shared/openings.js';
import type { OpeningInfo } from '../shared/protocol.js';

export interface OpeningSourceText {
  name: string;
  text: string;
}

/** `1.` / `1...` tokens, exactly as they appear in the dataset's PGN column. */
const MOVE_NUMBER = /\d+\.(?:\.\.)?/g;

/**
 * Turn the five ECO TSVs (`eco\tname\tpgn`) into a position-keyed book.
 *
 * Every intermediate position of every line is indexed, so a game that follows
 * a known line is recognised even when the dataset never names that prefix. The
 * first line to name a position wins; later transpositions only fill in blanks.
 */
export function buildOpeningBook(sources: readonly OpeningSourceText[]): OpeningBook {
  const book = new Map<string, OpeningInfo | null>();

  for (const source of sources) {
    for (const rawLine of source.text.split('\n')) {
      const line = rawLine.trimEnd();
      if (line.length === 0 || line.startsWith('eco\t')) continue;

      const [eco, name, pgn] = line.split('\t');
      if (!eco || !name || !pgn) continue;

      const chess = new Chess();
      const keys: string[] = [];
      let valid = true;

      for (const token of pgn.replace(MOVE_NUMBER, ' ').split(/\s+/)) {
        if (token.length === 0) continue;
        try {
          chess.move(token);
        } catch {
          valid = false;
          break;
        }
        const key = normalizeFen(chess.fen());
        if (!key) {
          valid = false;
          break;
        }
        keys.push(key);
      }

      if (!valid || keys.length === 0) continue;

      for (const key of keys.slice(0, -1)) {
        if (!book.has(key)) book.set(key, null);
      }
      const last = keys.at(-1);
      if (last && !book.get(last)) book.set(last, { eco, name });
    }
  }

  return book;
}
