import { describe, expect, it } from "vitest";
import { RESONANCE } from "../data/tuning";
import { OPPOSITE_COLOR } from "./colors";
import {
  DOMINANT_EFFECTS,
  DOMINANT_RATIO,
  DUAL_EFFECTS,
  NEGATIVE_EFFECTS,
  colorWeights,
  computeResonance,
  dualKey,
  negativeInput,
  resolveResonance,
  resonanceEffect,
  resonanceRules,
} from "./resonance";
import { equipmentResonance } from "./stats";
import { createEmptyProfile, type AffixRoll, type Item, type Slot, type TraitColor } from "./types";

/**
 * 陰画の判定順（冥の支配 → 陰画 → 支配 → 二重 …）を具体的な装備で固定する。
 * 陰画は支配より先に見るので、反転を含む既存の装備は「支配」や「二重」から「陰画」へ変わりうる。
 * その境目（反転の重みの比率が RESONANCE.negativeInvertedRatio 以上か）と、反転を除いた配合で支配色を選ぶことを、
 * key・数値で確かめる。表示文字列は見ない
 */

/** 色を明示した性質。nominal 1 に対する value がそのまま配合の重みになる（traitWeight） */
function trait(key: string, color: TraitColor, weight = 1): AffixRoll {
  return { key, value: weight, nominal: 1, flux: 0, color, origin: "found" };
}

/** 反転した性質。色は冥になり、重みは |value / nominal| の 2 倍（INVERTED_COLOR_WEIGHT） */
function inverted(key: string, weight = 1): AffixRoll {
  return { key, value: -weight, nominal: 1, flux: -1.5, inverted: true, color: "umbra", origin: "found" };
}

function crimsonTraits(count: number): AffixRoll[] {
  return Array.from({ length: count }, (_, i) => trait(i % 2 === 0 ? "meleeDamagePct" : "meleeDamageFlat", "crimson"));
}

/** 配合全体の重みの合計 */
function totalWeight(rolls: readonly AffixRoll[]): number {
  const w = colorWeights(rolls);
  return w.crimson + w.azure + w.jade + w.gold + w.umbra;
}

/** 反転の重みが配合全体に占める比率（陰画の閾値と比べる値） */
function invertedRatio(rolls: readonly AffixRoll[]): number {
  return negativeInput(rolls).invertedWeight / totalWeight(rolls);
}

/** 陰画の入力を渡さずに判定した結果（陰画の段を飛ばしたときに何になっていたか） */
function withoutNegative(rolls: readonly AffixRoll[]): ReturnType<typeof resolveResonance> {
  return resolveResonance(colorWeights(rolls));
}

function item(slot: Slot, affixes: AffixRoll[]): Item {
  return {
    id: `order-${slot}`,
    seed: 1,
    baseKey: "placeholder",
    slot,
    rarity: "rare",
    itemLevel: 1,
    name: "判定順の装備",
    implicit: null,
    affixes,
    foundDepth: 13,
    foundAt: 0,
  };
}

describe("陰画の判定順（resonanceOrder）", () => {
  it("反転の重みが閾値以上なら、支配より先に、反転を除いた支配色の陰画になる", () => {
    // 表: 紅 5・翠 1。反転 2 つで冥 4。全体 10 のうち反転 4 = 40%、紅 5 = 50%
    const rolls = [...crimsonTraits(5), trait("maxLife", "jade"), inverted("moveSpeed"), inverted("rangedDamagePct")];
    expect(totalWeight(rolls), "配合の合計").toBe(10);
    expect(negativeInput(rolls).invertedWeight, "反転の重み").toBe(4);
    expect(invertedRatio(rolls), "反転の比率は閾値以上").toBeGreaterThanOrEqual(RESONANCE.negativeInvertedRatio);
    expect(negativeInput(rolls).upright.crimson / 6, "反転を除いた紅の比率").toBeGreaterThanOrEqual(DOMINANT_RATIO);

    const r = computeResonance(rolls);
    expect(r.kind, "陰画は kind = dominant で返る").toBe("dominant");
    expect(r.form, "陰画").toBe("negative");
    expect(r.colors, "反転を除いた支配色").toEqual(["crimson"]);
    expect(resonanceEffect(r), "紅の陰画の効果").toBe(NEGATIVE_EFFECTS.crimson);

    // 陰画の段が無ければ紅 50% でふつうの支配だった（判定順で共鳴が変わる例）
    const plain = withoutNegative(rolls);
    expect(plain.form, "陰画を飛ばすと変形なし").toBeUndefined();
    expect(plain.colors, "陰画を飛ばすと紅の支配").toEqual(["crimson"]);
    expect(resonanceEffect(plain), "灼極").toBe(DOMINANT_EFFECTS.crimson);
  });

  it("反転の重みが閾値未満なら、陰画にならずふつうの支配", () => {
    // 紅 7・反転 1 つで冥 2。全体 9 のうち反転 2 ≒ 22%
    const rolls = [...crimsonTraits(7), inverted("moveSpeed")];
    expect(invertedRatio(rolls), "反転の比率は閾値未満").toBeLessThan(RESONANCE.negativeInvertedRatio);
    const r = computeResonance(rolls);
    expect(r.kind).toBe("dominant");
    expect(r.form, "陰画にならない").toBeUndefined();
    expect(r.colors).toEqual(["crimson"]);
    expect(r.ratios.crimson, "紅の比率").toBeCloseTo(7 / 9);
  });

  it("反転の比率が閾値ちょうどなら陰画になり、表の性質を 1 つ足して閾値を割ると支配に戻る", () => {
    // 紅 13（3 × 4 + 1）・反転 2 つ（重み 1.75 × 2 倍 = 3.5 ずつ）で冥 7。全体 20 のうち反転 7 = 35%
    const upright = [3, 3, 3, 3, 1].map((w, i) => trait(`crimson${i}`, "crimson", w));
    const rolls = [...upright, inverted("moveSpeed", 1.75), inverted("rangedDamagePct", 1.75)];
    expect(totalWeight(rolls), "配合の合計").toBe(20);
    expect(negativeInput(rolls).invertedWeight, "反転の重み").toBe(7);
    // 閾値の値が変わったらこの装備を作り直す（境界を外さないための前提の確認）
    expect(invertedRatio(rolls), "前提: 反転の比率が閾値ちょうど").toBe(RESONANCE.negativeInvertedRatio);

    const atEdge = computeResonance(rolls);
    expect(atEdge.form, "閾値ちょうどは陰画（以上で判定）").toBe("negative");
    expect(atEdge.colors).toEqual(["crimson"]);

    const below = [...rolls, trait("meleeDamagePct", "crimson")];
    expect(invertedRatio(below), "1 つ足すと閾値未満").toBeLessThan(RESONANCE.negativeInvertedRatio);
    const plain = computeResonance(below);
    expect(plain.form, "閾値を割ると陰画にならない").toBeUndefined();
    expect(plain.kind).toBe("dominant");
    expect(plain.colors).toEqual(["crimson"]);
  });

  it("反転を除くと支配色が変わる: 全体では冥が最多の二重でも、表の支配色（紅）の陰画になる", () => {
    // 紅 3・翠 2・反転 2 つで冥 4。全体 9: 冥 44% / 紅 33% / 翠 22%。表だけなら紅 3/5 = 60%
    const rolls = [...crimsonTraits(3), trait("maxLife", "jade"), trait("hpRegen", "jade"), inverted("moveSpeed"), inverted("rangedDamagePct")];
    const plain = withoutNegative(rolls);
    expect(plain.ratios.umbra, "全体では冥が最多").toBeGreaterThan(plain.ratios.crimson);
    expect(plain.ratios.umbra, "冥は支配に届かない").toBeLessThan(DOMINANT_RATIO);
    expect(plain.kind, "陰画を飛ばすと二重").toBe("dual");
    expect(plain.colors, "紅と冥の二重").toEqual(["crimson", "umbra"]);
    expect(resonanceEffect(plain), "焦身").toBe(DUAL_EFFECTS[dualKey("crimson", "umbra")]);

    expect(invertedRatio(rolls), "反転の比率は閾値以上").toBeGreaterThanOrEqual(RESONANCE.negativeInvertedRatio);
    const r = computeResonance(rolls);
    expect(r.form, "陰画が二重より先に取る").toBe("negative");
    expect(r.colors, "支配色は冥から紅へ変わる").toEqual(["crimson"]);
  });

  it("反転が閾値以上でも、反転を除いた配合に支配色が無ければ陰画にせず以降の判定へ進む", () => {
    // 紅 3・蒼 3・翠 1・反転 2 つで冥 4。全体 11 のうち反転 4 ≒ 36% だが、表の先頭の紅は 3/7 ≒ 43% で支配に届かない
    const rolls = [...crimsonTraits(3), ...[0, 1, 2].map((i) => trait(`azure${i}`, "azure")), trait("maxLife", "jade"), inverted("moveSpeed"), inverted("rangedDamagePct")];
    expect(invertedRatio(rolls), "反転の比率は閾値以上").toBeGreaterThanOrEqual(RESONANCE.negativeInvertedRatio);
    expect(negativeInput(rolls).upright.crimson / 7, "表の紅は支配の比率未満").toBeLessThan(DOMINANT_RATIO);
    const r = computeResonance(rolls);
    expect(r.form, "陰画にならない").toBeUndefined();
    expect(r).toEqual(withoutNegative(rolls));
  });

  it("冥が支配していれば陰画より先に虚極になる（冥の支配 → 陰画 の順）", () => {
    // 紅 3・反転 2 つ（重み 1.5 × 2 倍 = 3 ずつ）で冥 6。全体 9 のうち冥 67%
    const rolls = [...crimsonTraits(3), inverted("moveSpeed", 1.5), inverted("rangedDamagePct", 1.5)];
    const r = computeResonance(rolls);
    expect(r.form, "陰画にしない").toBeUndefined();
    expect(r.colors, "冥の支配").toEqual(["umbra"]);
    expect(resonanceEffect(r), "虚極").toBe(DOMINANT_EFFECTS.umbra);
  });

  it("鏡の誓いは反転を配合に数えないので陰画にならない", () => {
    const rolls = [...crimsonTraits(5), trait("maxLife", "jade"), inverted("moveSpeed"), inverted("rangedDamagePct")];
    const rules = resonanceRules([{ key: "ks_mirror", value: 1 }]);
    expect(negativeInput(rolls, rules).invertedWeight, "反転は数えない").toBe(0);
    const r = computeResonance(rolls, rules);
    expect(r.form).toBeUndefined();
    expect(r.colors, "紅の反対色の支配").toEqual([OPPOSITE_COLOR.crimson]);
  });

  it("装備全体（部位をまたいだ性質）でも同じ順で陰画になる", () => {
    const equipment = createEmptyProfile().equipment;
    equipment.mainHand = item("mainHand", crimsonTraits(3));
    equipment.armor = item("armor", [...crimsonTraits(2), trait("maxLife", "jade")]);
    equipment.boots = item("boots", [inverted("moveSpeed")]);
    equipment.ring = item("ring", [inverted("rangedDamagePct")]);
    const r = equipmentResonance(equipment);
    expect(r.kind).toBe("dominant");
    expect(r.form, "部位をまたいでも陰画").toBe("negative");
    expect(r.colors).toEqual(["crimson"]);
  });
});
