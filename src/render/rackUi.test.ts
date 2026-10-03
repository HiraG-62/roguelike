import { describe, expect, it } from "vitest";
import { SPRITES } from "../data/sprites";
import { spriteDots } from "../data/sprites/dots";
import { BASES, baseFamily } from "../loot/bases";
import { bulletIconKey } from "./rackUi";

describe("武器掛けの器のカードの弾丸アイコン", () => {
  const gunBases = BASES.filter((b) => baseFamily(b) === "gun");

  it("銃の器はすべて弾丸アイコンを持つ", () => {
    const missing = gunBases.filter((b) => SPRITES[bulletIconKey(b.key)] === undefined).map((b) => b.key);
    expect(missing, "弾丸アイコンの無い器").toEqual([]);
  });

  it("弾丸アイコンは全て同じ寸法・密度 2 の 1 フレーム", () => {
    const sizes = new Set<string>();
    for (const b of gunBases) {
      const key = bulletIconKey(b.key);
      const frames = SPRITES[key] ?? [];
      expect(frames, `${key} のフレーム数`).toHaveLength(1);
      expect(spriteDots(key), `${key} の密度`).toBe(2);
      const frame = frames[0] ?? [];
      sizes.add(`${frame[0]?.length ?? 0}x${frame.length}`);
    }
    expect([...sizes], "寸法が揃う").toHaveLength(1);
  });
});
