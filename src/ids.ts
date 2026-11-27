import { randomBytes } from 'node:crypto';

export function generateGameId(isTaken: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = randomBytes(4).toString('hex');
    if (!isTaken(id)) return id;
  }
  return randomBytes(8).toString('hex');
}
