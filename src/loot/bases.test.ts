import { describe, expect, it } from "vitest";
import { BULLET_FEATURES, MOVESETS, MOVESET_KEYS, bulletFeatures, shootsPrimary } from "../data/weapons";
import { BASES, baseDef, baseFamily, basesForSlot } from "./bases";
import { BULLETS, bulletDef } from "./bullets";

/** 序盤のベース解禁（docs/ideas/combat-feel-design.md A-2）: 1 ランの浅い階でも武器種・銃の弾に触れられる */

/** 武器種ごとに、この itemLevel 以下で出る器が 1 つはある */
const EARLY_WEAPON_LEVEL = 3;
/** 銃の家系・弾の性質ごとに、この itemLevel 以下で出る器が 1 つはある */
const EARLY_GUN_LEVEL = 4;
/** itemLevel 3 の武器ドロップに混ざる武器種の下限 */
const EARLY_MOVESET_VARIETY = 4;

function earliest(match: (b: (typeof BASES)[number]) => boolean): number {
  return Math.min(...BASES.filter(match).map((b) => b.minLevel));
}

describe("序盤のベース解禁", () => {
  it(`左で振る武器種のすべてに minLevel ${EARLY_WEAPON_LEVEL} 以下のベースがある`, () => {
    for (const key of MOVESET_KEYS) {
      if (shootsPrimary(MOVESETS[key])) continue;
      expect(earliest((b) => b.slot === "mainHand" && b.moveset === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_WEAPON_LEVEL);
    }
  });

  it(`左で撃つ武器種のすべてに minLevel ${EARLY_GUN_LEVEL} 以下のベースがある`, () => {
    for (const key of MOVESET_KEYS.filter((k) => shootsPrimary(MOVESETS[k]))) {
      expect(earliest((b) => b.slot === "mainHand" && b.moveset === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_GUN_LEVEL);
    }
  });

  it(`弾の性質ごとに minLevel ${EARLY_GUN_LEVEL} 以下の器がある`, () => {
    // 刺さる・弧の弾は投擲物の器が撃つ。器への配線は段 6（docs/ideas/gun-bases-review.md 4 章）で、それまでは除く
    const pending: ReadonlySet<string> = new Set(["pin", "arc"]);
    for (const f of BULLET_FEATURES.filter((x) => !pending.has(x))) {
      expect(earliest((b) => BULLETS[b.key] !== undefined && bulletFeatures(bulletDef(b.key)).includes(f)), `${f} の一番早い器`).toBeLessThanOrEqual(EARLY_GUN_LEVEL);
    }
  });

  it(`basesForSlot("mainHand", ${EARLY_WEAPON_LEVEL}) に ${EARLY_MOVESET_VARIETY} 種類以上の武器種が含まれる`, () => {
    const movesets = new Set(basesForSlot("mainHand", EARLY_WEAPON_LEVEL).map((b) => b.moveset));
    expect(movesets.size).toBeGreaterThanOrEqual(EARLY_MOVESET_VARIETY);
  });
});

describe("右手ベースの家系（武器の群）", () => {
  it("家系は近接・銃・投擲物の 3 つで、右手以外は持たない", () => {
    const sword = baseDef("longsword");
    const pistol = baseDef("pistol");
    const knives = baseDef("throwingKnives");
    if (sword === undefined || pistol === undefined || knives === undefined) throw new Error("ベースが無い");
    expect(baseFamily(sword), "長剣").toBe("melee");
    expect(baseFamily(pistol), "拳銃").toBe("gun");
    expect(baseFamily(knives), "投げ短剣").toBe("throwing");
    for (const base of BASES) {
      if (base.moveset === undefined) expect(baseFamily(base), `${base.key} は右手以外`).toBeUndefined();
      else expect(MOVESETS[base.moveset], `${base.key} の武器種`).toBeDefined();
    }
  });
});
