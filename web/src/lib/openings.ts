import { useSyncExternalStore } from 'react';

import { parseBookText, type OpeningBook } from '../../../src/shared/openings';
import { api } from './api';

const RETRY_MS = 2_000;
/** ~30 s of retries, which covers the first-boot download. */
const MAX_ATTEMPTS = 15;

let book: OpeningBook | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OpeningBook | null {
  return book;
}

function getServerSnapshot(): null {
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBook(attempt: number): Promise<void> {
  if (book || attempt > MAX_ATTEMPTS) return;

  try {
    const text = await api.getOpeningsBook();
    if (text) {
      const parsed = parseBookText(text);
      if (parsed.size > 0) {
        book = parsed;
        emit();
        return;
      }
    }
  } catch {
    // The server may still be starting; fall through to the retry.
  }

  await sleep(RETRY_MS);
  return fetchBook(attempt + 1);
}

/**
 * Fetch the opening book once the server has downloaded it. Retries for ~30 s
 * because the first boot fetches it in the background, and stays resolved after
 * that so a game page can safely call it on every move.
 */
export function loadOpeningsBook(): Promise<void> {
  if (typeof window === 'undefined' || book) return Promise.resolve();
  if (pending) return pending;

  pending = fetchBook(1).finally(() => {
    pending = null;
  });
  return pending;
}

export function useOpeningBook(): OpeningBook | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
