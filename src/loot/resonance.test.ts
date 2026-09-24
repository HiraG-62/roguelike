import { describe, expect, it } from "vitest";
import {
  DOMINANT_EFFECTS,
  DUAL_EFFECTS,
  INVERTED_COLOR_WEIGHT,
  OFF_COLOR_DAMPING,
  TRAIT_WEIGHT_MAX,
  adjustForResonance,
  colorWeights,
  describeResonance,
  dualKey,
  resolveResonance,
  traitWeight,
  type ColorWeights,
} from "./resonance";
import { scaleFlat } from "./flux";
import { computeStats, equipmentResonance } from "./stats";
import { TRAIT_COLORS, createEmptyEquipment, type AffixRoll, type Item, type Slot } from "./types";

function w(partial: Partial<ColorWeights>): ColorWeights {
  return { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0, ...partial };
}

function makeItem(slot: Slot, affixes: AffixRoll[]): Item {
  return {
    id: `r-${slot}`,
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

describe("resolveResonance: 境界", () => {
  it("重みの合計が 3 未満なら共鳴しない", () => {
    expect(resolveResonance(w({ crimson: 2 })).kind).toBe("none");
  });

  it("支配: 1 色がちょうど 50% で成立、49% では不成立", () => {
    const dom = resolveResonance(w({ crimson: 50, azure: 25, jade: 25 }));
    expect(dom.kind).toBe("dominant");
    expect(dom.colors).toEqual(["crimson"]);
    expect(resolveResonance(w({ crimson: 49, azure: 26, jade: 25 })).kind).not.toBe("dominant");
  });

  it("二重: 上位 2 色がそれぞれ 30% 以上。色は TRAIT_COLORS 順", () => {
    const dual = resolveResonance(w({ gold: 40, crimson: 30, jade: 30 }));
    expect(dual.kind).toBe("dual");
    expect(dual.colors).toEqual(["crimson", "gold"]);
    // 2 色目が 29% なら二重にならない（紅 45% があるので散光でもない。3 色目が 22% 未満なら三和音でもない）
    expect(resolveResonance(w({ crimson: 45, azure: 29, jade: 15, gold: 11 })).kind).toBe("none");
  });

  it("散光: すべての色が 30% 未満", () => {
    expect(resolveResonance(w({ crimson: 20, azure: 20, jade: 20, gold: 20, umbra: 20 })).kind).toBe("scatter");
    expect(resolveResonance(w({ crimson: 26, azure: 26, jade: 24, gold: 24 })).kind).toBe("scatter");
    expect(resolveResonance(w({ crimson: 29, azure: 29, jade: 21, gold: 21 })).kind).toBe("scatter");
    // 紅 30%・蒼 29% は散光にも二重にも届かないが、反対色の均衡なので拮抗（天秤）になる
    const balanced = resolveResonance(w({ crimson: 30, azure: 29, jade: 21, gold: 20 }));
    expect(balanced.kind).toBe("dual");
    expect(balanced.form).toBe("balance");
    expect(resolveResonance(w({ crimson: 31, azure: 19, jade: 29, gold: 21 })).kind, "反対色が均衡していなければなし").toBe("none");
  });

  it("配合比の合計は 1", () => {
    const r = resolveResonance(w({ crimson: 3, azure: 1 }));
    expect(TRAIT_COLORS.reduce((s, c) => s + r.ratios[c], 0)).toBeCloseTo(1);
  });
});

describe("重み", () => {
  it("強く振れた性質ほど重い（|value / nominal|、上限あり）。反転は 2 倍", () => {
    expect(traitWeight({ key: "meleeDamagePct", value: 30, nominal: 20 })).toBeCloseTo(1.5);
    expect(traitWeight({ key: "meleeDamagePct", value: 999, nominal: 1 })).toBe(TRAIT_WEIGHT_MAX);
    expect(traitWeight({ key: "meleeDamagePct", value: -10, nominal: 20, inverted: true })).toBeCloseTo(0.5 * INVERTED_COLOR_WEIGHT);
  });

  it("反転した性質は冥として数える。implicit は数えない", () => {
    const weights = colorWeights([
      { key: "meleeDamagePct", value: -10, nominal: 20, flux: -1.5, inverted: true, color: "umbra" },
      { key: "implicit.shortsword", value: 10 },
    ]);
    expect(weights.umbra).toBeCloseTo(1);
    expect(weights.crimson).toBe(0);
  });
});

describe("computeStats と共鳴", () => {
  it("支配: 他の色の性質は 75% に弱まり、支配の効果（灼極）が乗る", () => {
    const eq = createEmptyEquipment();
    eq.weapon = makeItem("weapon", [melee(), { key: "meleeDamageFlat", value: 4, nominal: 4, flux: 0 }]);
    eq.ring = makeItem("ring", [{ key: "attackSpeed", value: 10, nominal: 10, flux: 0 }, crit(10)]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind).toBe("dominant");
    expect(stats.resonance.colors).toEqual(["crimson"]);
    expect(stats.critChance).toBeCloseTo(0.05 + 0.1 * OFF_COLOR_DAMPING);
    // 共鳴の効果値には装備の強さの係数（FLUX.globalScale）が掛かる
    expect(stats.meleeDamageMul).toBeCloseTo(1 + 0.2 + scaleFlat(0.1, 4));
    expect(stats.triggers.some((t) => t.trigger === "everyNthMeleeHit" && t.effect === "burnNearby")).toBe(true);
  });

  it("冥の支配（虚極）: 反転した性質の負の値を正として扱う", () => {
    const eq = createEmptyEquipment();
    eq.ring = makeItem("ring", [
      { key: "maxLife", value: -30, nominal: 40, flux: -1.75, inverted: true, color: "umbra" },
      { key: "ks_gambler", value: 0, color: "umbra" },
      { key: "ks_blink", value: 0, color: "umbra" },
    ]);
    const stats = computeStats(eq);
    expect(stats.resonance.colors).toEqual(["umbra"]);
    expect(stats.maxHp).toBe(130);
  });

  it("二重: 組み合わせの効果が乗る（紅 + 翠 = 血潮で命中時 HP 回復 +1）", () => {
    const eq = createEmptyEquipment();
    // 紅 2 : 翠 2 : 蒼 1 = 40% / 40% / 20%（50% ちょうどは支配になるので 3 色目を混ぜる）
    eq.weapon = makeItem("weapon", [melee(), { key: "damageVsStaggered", value: 20, nominal: 20, flux: 0 }]);
    eq.armor = makeItem("armor", [life(), { key: "hpRegen", value: 1, nominal: 1, flux: 0 }]);
    eq.gun = makeItem("gun", [ranged()]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind).toBe("dual");
    expect(stats.resonance.colors).toEqual(["crimson", "jade"]);
    expect(stats.lifeOnHit, "与ダメの 1% × 係数").toBeCloseTo(scaleFlat(1, 4));
  });

  it("散光: 主要倍率が少しずつ伸びる（支配/二重よりかなり高かったため半分に調整済み）", () => {
    const eq = createEmptyEquipment();
    eq.weapon = makeItem("weapon", [melee()]);
    eq.gun = makeItem("gun", [ranged()]);
    eq.armor = makeItem("armor", [life()]);
    eq.ring = makeItem("ring", [crit()]);
    const stats = computeStats(eq);
    expect(stats.resonance.kind).toBe("scatter");
    expect(stats.moveSpeedMul).toBeCloseTo(1.025);
    expect(equipmentResonance(eq).kind).toBe("scatter");
  });

  it("散光: 反転した性質の値を 0 にする（代償を打ち消すが正の効果には転じない）", () => {
    const rolls = [
      melee(),
      ranged(),
      life(),
      crit(),
      { key: "meleeDamagePct", value: -15, nominal: 20, flux: -1.75, inverted: true, color: "umbra" as const },
    ];
    const res = resolveResonance(colorWeights(rolls));
    expect(res.kind).toBe("scatter");
    const adjusted = adjustForResonance(rolls, res);
    const invertedOut = adjusted.find((r) => r.inverted === true);
    expect(invertedOut?.value).toBeCloseTo(0);
  });

  it("虚極（冥の支配）: 反転を正にする効果に加え、深度に関係なく効くエネルギー獲得ボーナスも持つ", () => {
    const eq = createEmptyEquipment();
    eq.ring = makeItem("ring", [
      { key: "maxLife", value: -30, nominal: 40, flux: -1.75, inverted: true, color: "umbra" },
      { key: "ks_gambler", value: 0, color: "umbra" },
      { key: "ks_blink", value: 0, color: "umbra" },
    ]);
    const stats = computeStats(eq);
    expect(stats.resonance.colors).toEqual(["umbra"]);
    expect(stats.energyGainMul).toBeCloseTo(1 + scaleFlat(0.15, 4));
  });

  it("adjustForResonance は元の roll を変えない", () => {
    const rolls = [melee(), melee(), crit(10)];
    const res = resolveResonance(colorWeights(rolls));
    const adjusted = adjustForResonance(rolls, res);
    expect(rolls[2]?.value).toBe(10);
    expect(adjusted[2]?.value).toBeCloseTo(10 * OFF_COLOR_DAMPING);
  });
});

describe("効果の定義と表示", () => {
  it("支配 5 種・二重 10 種がそろっている", () => {
    expect(Object.keys(DOMINANT_EFFECTS)).toHaveLength(TRAIT_COLORS.length);
    expect(Object.keys(DUAL_EFFECTS)).toHaveLength(10);
    for (let i = 0; i < TRAIT_COLORS.length; i++) {
      for (let j = i + 1; j < TRAIT_COLORS.length; j++) {
        const a = TRAIT_COLORS[i];
        const b = TRAIT_COLORS[j];
        if (a === undefined || b === undefined) continue;
        expect(DUAL_EFFECTS[dualKey(b, a)], `${a}+${b}`).toBeDefined();
      }
    }
  });

  it("describeResonance は名前と動詞の行を返し、支配では減衰も伝える", () => {
    const dom = describeResonance(resolveResonance(w({ crimson: 10 })));
    expect(dom[0]).toContain("灼極");
    expect(dom.some((l) => l.includes("75%"))).toBe(true);
    const none = describeResonance(resolveResonance(w({})));
    expect(none[0]).toBe("共鳴なし");
  });
});
