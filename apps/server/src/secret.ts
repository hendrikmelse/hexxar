import { createHash, timingSafeEqual } from 'node:crypto';

/** Compare two strings without leaking, through timing, how much of the guess was right. */
export function sameSecret(a: string, b: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
