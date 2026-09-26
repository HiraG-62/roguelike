import { describe, expect, it } from "vitest";
import { ATTR, ATTR_GAIN } from "../data/tuning";
import { COLOR_ATTR, describeResonance, resolveResonance, resonanceAttributes, type ColorWeights } from "./resonance";
import { computeStats } from "./stats";
import { ATTR_KEYS, TRAIT_COLORS, createEmptyEquipment, uniformAttributes, type AffixRoll, type Item, type Slot } from "./types";

/** 共鳴のステータス加算（docs/COMBAT_DESIGN.md A-3） */

function w(partial: Partial<ColorWeights>): ColorWeights {
  return { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0, ...partial };
}

function makeItem(slot: Slot, affixes: AffixRoll[]): Item {
  return {
    id: `ra-${slot}`,
    seed: 1,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes,
    foundDepth: 10,
    foundAt: 0,
  };
}

const melee = (value = 20): AffixRoll => ({ key: "meleeDamagePct", value, nominal: value, flux: 0 });
const ranged = (value = 20): AffixRoll => ({ key: "rangedDamagePct", value, nominal: value, flux: 0 });
const life = (value = 20): AffixRoll => ({ key: "maxLife", value, nominal: value, flux: 0 });
const crit = (value = 5): AffixRoll => ({ key: "critChance", value, nominal: value, flux: 0 });

describe("共鳴のステータス加算", () => {
  it("支配: その色のステータスだけ +3（紅 = 筋力）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = makeItem("mainHand", [melee(), { key: "meleeDamageFlat", value: 4, nominal: 4, flux: 0 }]);
    eq.ring = makeItem("ring", [{ key: "attackSpeed", value: 10, nominal: 10, flux: 0 }, crit(10)]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind, "紅の支配が成立する").toBe("dominant");
    expect(stats.attributes, "筋力だけが上がる").toEqual({
      ...uniformAttributes(ATTR.base),
      str: ATTR.base + ATTR_GAIN.resonanceDominant,
    });
  });

  it("二重: 2 色それぞれ +2（紅 + 翠 = 筋力と体力）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = makeItem("mainHand", [melee(), { key: "damageVsStaggered", value: 20, nominal: 20, flux: 0 }]);
    eq.armor = makeItem("armor", [life(), { key: "hpRegen", value: 1, nominal: 1, flux: 0 }]);
    eq.boots = makeItem("boots", [ranged()]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind, "紅と翠の二重が成立する").toBe("dual");
    const plus = ATTR.base + ATTR_GAIN.resonanceDual;
    expect(stats.attributes, "筋力と体力が上がる").toEqual({ ...uniformAttributes(ATTR.base), str: plus, vit: plus });
  });

  it("散光: 5 色ぶんのステータス +1（防御は色を持たないので変わらない）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = makeItem("mainHand", [melee()]);
    eq.boots = makeItem("boots", [ranged()]);
    eq.armor = makeItem("armor", [life()]);
    eq.ring = makeItem("ring", [crit()]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind, "散光が成立する").toBe("scatter");
    expect(stats.attributes, "5 色ぶんのステータスが上がる").toEqual({
      ...uniformAttributes(ATTR.base + ATTR_GAIN.resonanceScatter),
      def: ATTR.base,
    });
  });

  it("共鳴なしは加算しない", () => {
    expect(resonanceAttributes(resolveResonance(w({ crimson: 1 }))), "重み不足").toEqual(uniformAttributes(0));
    expect(computeStats(createEmptyEquipment()).attributes, "装備なし").toEqual(uniformAttributes(ATTR.base));
  });

  it("5 色それぞれの支配が、対応するステータス 1 つだけに入る", () => {
    for (const c of TRAIT_COLORS) {
      const bonus = resonanceAttributes(resolveResonance(w({ [c]: 10 })));
      for (const k of ATTR_KEYS) {
        const expected = k === COLOR_ATTR[c] ? ATTR_GAIN.resonanceDominant : 0;
        expect(bonus[k], `${c} の支配で ${k}`).toBe(expected);
      }
    }
  });

  it("共鳴の説明に加算の行が入り、共鳴なしでは足さない", () => {
    const dom = describeResonance(resolveResonance(w({ crimson: 10 })));
    expect(dom.some((l) => l.includes(`+${ATTR_GAIN.resonanceDominant}`)), "支配の加算行").toBe(true);
    const scatter = describeResonance(resolveResonance(w({ crimson: 2, azure: 2, jade: 2, gold: 2, umbra: 2 })));
    expect(scatter.some((l) => l.includes(`+${ATTR_GAIN.resonanceScatter}`)), "散光の加算行").toBe(true);
    const none = describeResonance(resolveResonance(w({})));
    expect(none, "共鳴なしの説明は 2 行のまま").toHaveLength(2);
  });
});
