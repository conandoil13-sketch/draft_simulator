export type Rng = {
  next: () => number;
};

export function createSeededRng(seed: string): Rng {
  let state = hashSeed(seed);

  return {
    next: () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  };
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng.next() * (max - min + 1)) + min;
}

export function randomFloat(rng: Rng, min: number, max: number): number {
  return rng.next() * (max - min) + min;
}

export function pickOne<T>(rng: Rng, values: readonly T[]): T {
  return values[randomInt(rng, 0, values.length - 1)];
}

export function maybe<T>(rng: Rng, probability: number, value: T, fallback: T): T {
  return rng.next() < probability ? value : fallback;
}

export function weightedPick<T>(rng: Rng, entries: readonly { value: T; weight: number }[]): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng.next() * total;

  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.value;
    }
  }

  return entries[entries.length - 1].value;
}

export function uniquePicks<T>(rng: Rng, values: readonly T[], count: number): T[] {
  const pool = [...values];
  const picks: T[] = [];

  while (pool.length > 0 && picks.length < count) {
    const index = randomInt(rng, 0, pool.length - 1);
    const [value] = pool.splice(index, 1);
    picks.push(value);
  }

  return picks;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
