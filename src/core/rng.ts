/**
 * seedable PRNG (mulberry32)。
 * 同じ seed から同じ乱数列を再現できる。Math.random は使わない。
 */
export interface Rng {
  /** [0, 1) の float */
  next(): number;
  /** [min, max] の整数（両端含む） */
  int(min: number, max: number): number;
  /** 確率 p で true */
  chance(p: number): boolean;
  /** 配列から 1 要素を選ぶ */
  pick<T>(arr: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      const item = arr[Math.floor(next() * arr.length)];
      if (item === undefined) throw new Error("pick: empty array");
      return item;
    },
  };
}

/** 文字列 seed を 32bit 整数に変換する (FNV-1a) */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
