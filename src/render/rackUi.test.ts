import { describe, expect, it } from "vitest";
import { SPRITES } from "../data/sprites";
import { spriteDots } from "../data/sprites/dots";
import { BASES } from "../loot/bases";
import { baseHasBullet } from "../loot/bullets";
import { BULLET_FX } from "./fxMotions";

/** 弾の飛ぶ絵がまだ無い器（段 5-A で投擲物の器に弾を持たせた。絵は段 7 で scripts/fx/sheets/<武器種>.mjs の bullets に足す） */
const UNDRAWN_BULLETS = ["ringBlades", "fangRings", "kunai"] as const;

describe("武器掛けの器のカードの絵", () => {
  it("和紙の札は密度 2 の 1 フレーム", () => {
    expect(SPRITES["rack.paper"], "札").toHaveLength(1);
    expect(spriteDots("rack.paper"), "密度").toBe(2);
  });

  it("弾を持つ器はすべて札に重ねる弾の飛ぶ絵を持つ（絵の無い投擲物の器を除く）", () => {
    const missing = BASES.filter((b) => baseHasBullet(b) && BULLET_FX.get(b.key) === undefined).map((b) => b.key);
    expect(missing, "弾の絵の無い器").toEqual([...UNDRAWN_BULLETS]);
  });
});
