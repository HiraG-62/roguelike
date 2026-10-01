import { describe, expect, it } from "vitest";
import { dropCursedItem } from "./blackMarket";
import { arena } from "./testHelpers";

/** 闇市の反転の遺物（system/blackMarket.ts の dropCursedItem）は、反転した性質を必ず持つ */

const SEEDS = 600;
const POS = { x: 100, y: 100 };

function dropAt(seed: number, depth: number) {
  const state = arena(seed);
  state.depth = depth;
  return dropCursedItem(state, POS);
}

describe("闇市の反転の遺物", () => {
  it("seed を変えて数百回作っても、必ず反転した性質を持つ", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const item = dropAt(seed, 1 + (seed % 12));
      expect(item.affixes.some((r) => r.inverted === true), `seed ${seed} の品に反転が無い`).toBe(true);
    }
  });

  it("同じ seed・同じ深度なら同じ品になる（決定性）", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = dropAt(seed, 5);
      const b = dropAt(seed, 5);
      expect(b.baseKey, `seed ${seed} のベース`).toBe(a.baseKey);
      expect(b.affixes, `seed ${seed} の性質`).toEqual(a.affixes);
    }
  });
});
