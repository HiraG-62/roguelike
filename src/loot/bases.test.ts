import { describe, expect, it } from "vitest";
import { MOVESET_KEYS, SHOT_KEYS } from "../data/weapons";
import { BASES, basesForSlot } from "./bases";

/** 序盤のベース解禁（docs/ideas/combat-feel-design.md A-2）: 1 ランの浅い階でも武器種・射撃の型に触れられる */

/** 武器種ごとに、この itemLevel 以下で出る器が 1 つはある */
const EARLY_WEAPON_LEVEL = 3;
/** 射撃の型ごとに、この itemLevel 以下で出る器が 1 つはある */
const EARLY_GUN_LEVEL = 4;
/** itemLevel 3 の武器ドロップに混ざる武器種の下限 */
const EARLY_MOVESET_VARIETY = 4;

function earliest(match: (b: (typeof BASES)[number]) => boolean): number {
  return Math.min(...BASES.filter(match).map((b) => b.minLevel));
}

describe("序盤のベース解禁", () => {
  it(`すべての武器種に minLevel ${EARLY_WEAPON_LEVEL} 以下のベースがある`, () => {
    for (const key of MOVESET_KEYS) {
      expect(earliest((b) => b.slot === "weapon" && b.moveset === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_WEAPON_LEVEL);
    }
  });

  it(`すべての射撃の型に minLevel ${EARLY_GUN_LEVEL} 以下のベースがある`, () => {
    for (const key of SHOT_KEYS) {
      expect(earliest((b) => b.slot === "gun" && b.shot === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_GUN_LEVEL);
    }
  });

  it(`basesForSlot("weapon", ${EARLY_WEAPON_LEVEL}) に ${EARLY_MOVESET_VARIETY} 種類以上の武器種が含まれる`, () => {
    const movesets = new Set(basesForSlot("weapon", EARLY_WEAPON_LEVEL).map((b) => b.moveset));
    expect(movesets.size).toBeGreaterThanOrEqual(EARLY_MOVESET_VARIETY);
  });
});
