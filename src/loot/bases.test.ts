import { describe, expect, it } from "vitest";
import { BULLET_FEATURES, GUN_MOVESETS, MOVESET_KEYS, bulletFeatures } from "../data/weapons";
import { BASES, basesForSlot } from "./bases";
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
  it(`すべての近接武器種に minLevel ${EARLY_WEAPON_LEVEL} 以下のベースがある`, () => {
    for (const key of MOVESET_KEYS) {
      if ((GUN_MOVESETS as readonly string[]).includes(key)) continue;
      expect(earliest((b) => b.slot === "mainHand" && b.moveset === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_WEAPON_LEVEL);
    }
  });

  it(`すべての銃の家系に minLevel ${EARLY_GUN_LEVEL} 以下のベースがある`, () => {
    for (const key of GUN_MOVESETS) {
      expect(earliest((b) => b.slot === "mainHand" && b.moveset === key), `${key} の一番早い器`).toBeLessThanOrEqual(EARLY_GUN_LEVEL);
    }
  });

  it(`弾の性質ごとに minLevel ${EARLY_GUN_LEVEL} 以下の器がある`, () => {
    for (const f of BULLET_FEATURES) {
      expect(earliest((b) => BULLETS[b.key] !== undefined && bulletFeatures(bulletDef(b.key)).includes(f)), `${f} の一番早い器`).toBeLessThanOrEqual(EARLY_GUN_LEVEL);
    }
  });

  it(`basesForSlot("mainHand", ${EARLY_WEAPON_LEVEL}) に ${EARLY_MOVESET_VARIETY} 種類以上の武器種が含まれる`, () => {
    const movesets = new Set(basesForSlot("mainHand", EARLY_WEAPON_LEVEL).map((b) => b.moveset));
    expect(movesets.size).toBeGreaterThanOrEqual(EARLY_MOVESET_VARIETY);
  });
});
