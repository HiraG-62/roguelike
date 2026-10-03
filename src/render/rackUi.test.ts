import { describe, expect, it } from "vitest";
import { SPRITES } from "../data/sprites";
import { spriteDots } from "../data/sprites/dots";
import { BASES, baseFamily } from "../loot/bases";
import { BULLET_FX } from "./fxMotions";

describe("武器掛けの器のカードの絵", () => {
  it("和紙の札は密度 2 の 1 フレーム", () => {
    expect(SPRITES["rack.paper"], "札").toHaveLength(1);
    expect(spriteDots("rack.paper"), "密度").toBe(2);
  });

  it("銃の器はすべて札に重ねる弾の飛ぶ絵を持つ", () => {
    const missing = BASES.filter((b) => baseFamily(b) === "gun" && BULLET_FX.get(b.key) === undefined).map((b) => b.key);
    expect(missing, "弾の絵の無い器").toEqual([]);
  });
});
