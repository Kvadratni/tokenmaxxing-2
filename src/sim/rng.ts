/**
 * Deterministic RNG (mulberry32).
 *
 * The entire generator state is a single int32 which lives in
 * `RunState.rngState`, so a run replays byte-for-byte from its seed as long as
 * the same call sequence is made. Nothing under `src/sim` may reach for the
 * ambient random source or the wall clock.
 */

const MULBERRY_INC = 0x6d2b79f5;
const UINT32 = 2 ** 32;

/** Anything holding a mutable `rngState` cursor — in practice `RunState`. */
export interface RngHolder {
  rngState: number;
}

export interface Rng {
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, n). Returns 0 for n <= 0. */
  nextInt(n: number): number;
  /** Uniform in [min, max). */
  nextRange(min: number, max: number): number;
  /** Uniform element, or undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined;
  /** Weighted element; entries with non-positive/non-finite weight are skipped. */
  weightedPick<T>(arr: readonly T[], weightFn: (item: T) => number): T | undefined;
  /** Fisher-Yates copy. */
  shuffled<T>(arr: readonly T[]): T[];
  /** Current cursor (mirrors the holder). */
  readonly state: number;
}

/** Coerce anything into a usable int32 seed. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  const i = Math.trunc(seed) | 0;
  return i === 0 ? 1 : i;
}

/** Deterministic 32-bit avalanche — used to derive one seed from another. */
export function hash32(n: number): number {
  let x = normalizeSeed(n);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x | 0;
}

/**
 * Bind a generator to a state holder. Every draw advances `holder.rngState`,
 * so persisting/copying the holder persists/copies the stream position.
 */
export function createRng(holder: RngHolder): Rng {
  function nextFloat(): number {
    const a = (holder.rngState + MULBERRY_INC) | 0;
    holder.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  function nextInt(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(nextFloat() * Math.floor(n));
  }

  function nextRange(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
    if (max <= min) return min;
    return min + nextFloat() * (max - min);
  }

  function pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[nextInt(arr.length)];
  }

  function weightedPick<T>(arr: readonly T[], weightFn: (item: T) => number): T | undefined {
    let total = 0;
    for (const item of arr) {
      const w = weightFn(item);
      if (Number.isFinite(w) && w > 0) total += w;
    }
    // No viable candidate: return without consuming the stream, so the caller's
    // RNG cursor stays predictable.
    if (total <= 0) return undefined;

    let roll = nextFloat() * total;
    let last: T | undefined;
    for (const item of arr) {
      const w = weightFn(item);
      if (!Number.isFinite(w) || w <= 0) continue;
      last = item;
      roll -= w;
      if (roll <= 0) return item;
    }
    return last;
  }

  function shuffled<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = nextInt(i + 1);
      const a = out[i] as T;
      const b = out[j] as T;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  return {
    nextFloat,
    nextInt,
    nextRange,
    pick,
    weightedPick,
    shuffled,
    get state(): number {
      return holder.rngState;
    },
  };
}

/** Standalone generator with its own cursor — handy for tests and tooling. */
export function standaloneRng(seed: number): Rng {
  return createRng({ rngState: normalizeSeed(seed) });
}
