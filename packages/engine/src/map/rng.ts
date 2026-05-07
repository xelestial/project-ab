/**
 * Injectable RNG interface for deterministic terrain generation.
 *
 * Production: MathRng (Math.random)
 * Tests:      SeededRng (xorshift32 — deterministic, seedable)
 */

export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
  randInt(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
}

export class MathRng implements Rng {
  next(): number { return Math.random(); }
  randInt(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]!; }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/** xorshift32 — fast, seedable, uniform. */
export class SeededRng implements Rng {
  private s: number;

  constructor(seed: number) {
    // Ensure non-zero state (xorshift is undefined for 0)
    this.s = (seed >>> 0) || 1;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 0x100000000;
  }

  randInt(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]!; }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}
