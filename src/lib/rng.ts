/**
 * Small, deterministic PRNG utilities.
 *
 * Every puzzle is derived from a string seed so the same "sky" can be
 * rebuilt on any device and the daily puzzle is identical for everyone.
 */

/** xmur3 string hash -> 32-bit unsigned integer. */
export function hashString(value: string): number {
  let h = 1779033703 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export type Rng = () => number;

/** Mulberry32: tiny, fast, good enough for puzzle generation. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFromString(seed: string): Rng {
  return mulberry32(hashString(seed));
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Short, human-readable code derived from a seed (base36). */
export function shortCode(seed: string): string {
  return hashString(seed).toString(36).toUpperCase().padStart(5, '0').slice(-5);
}
