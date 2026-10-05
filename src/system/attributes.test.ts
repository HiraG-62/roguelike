import { describe, expect, it } from "vitest";
import { ratioToScaling, scaledAtBase, withRatio } from "./attributes";
import { createGame } from "../core/game";
import { ATTR } from "../data/tuning";
import { computeStats } from "../loot/stats";
import {
  ATTR_KEYS,
  DEFAULT_STATS,
  createEmptyEquipment,
  type AttrKey,
  type PlayerStats,
} from "../loot/types";
import { buffMul, deriveAttributes, effectiveAttr } from "./attributes";
import { applyStats } from "./player";

/** 素の stats（装備なし）の生ステータスを 1 つだけ変えたもの */
function statsWith(key: AttrKey, raw: number, base: PlayerStats = computeStats(createEmptyEquipment())): PlayerStats {
  return { ...base, attributes: { ...base.attributes, [key]: raw } };
}

/** 実効値が base + delta になる生の値（delta は逓減前の範囲 0..15 で使う） */
const RAW_PLUS_10 = ATTR.base + 10;
const FLOAT_DIGITS = 9;

describe("effectiveAttr（逓減）", () => {
  it("0 以下は 0、20 までは等倍", () => {
    expect(effectiveAttr(-3), "負の値は 0").toBe(0);
    expect(effectiveAttr(0), "0 は 0").toBe(0);
    expect(effectiveAttr(5), "基礎値はそのまま").toBe(5);
    expect(effectiveAttr(20), "knee1 ちょうどは等倍").toBe(20);
  });

  it("折れ点の前後で ATTR の傾きが適用される", () => {
    const atSecond = ATTR.knee1 + (ATTR.knee2 - ATTR.knee1) * ATTR.slope1;
    expect(effectiveAttr(ATTR.knee1 + 1), "knee1 の直後").toBeCloseTo(ATTR.knee1 + ATTR.slope1);
    expect(effectiveAttr(ATTR.knee2), "knee2 ちょうど").toBeCloseTo(atSecond);
    expect(effectiveAttr(ATTR.knee2 + 1), "knee2 の直後").toBeCloseTo(atSecond + ATTR.slope2);
    expect(effectiveAttr(ATTR.knee2 + 20), "knee2 以降").toBeCloseTo(atSecond + 20 * ATTR.slope2);
  });

  it("連続で単調増加（境界で飛ばない）", () => {
    let prev = effectiveAttr(0);
    for (let a = 0.5; a <= 80; a += 0.5) {
      const v = effectiveAttr(a);
      expect(v, `a=${a} で減った`).toBeGreaterThan(prev);
      expect(v - prev, `a=${a} で段差がある`).toBeLessThanOrEqual(0.5 + 1e-9);
      prev = v;
    }
  });

  it("1 つに 40 盛るより 2 つに 20 ずつの方が合計の実効値が高い", () => {
    expect(effectiveAttr(20) * 2).toBeGreaterThan(effectiveAttr(40) + effectiveAttr(0));
  });
});

describe("deriveAttributes（派生）", () => {
  it("基礎値なら全フィールドが派生前と一致する", () => {
    const base = computeStats(createEmptyEquipment());
    expect(deriveAttributes(base), "装備なし").toEqual(base);
    const tuned: PlayerStats = { ...base, knockbackMul: 1.3, maxHp: 140, critChance: 0.2, dashCooldownMul: 0.8 };
    expect(deriveAttributes(tuned), "装備で数値が動いていても基礎値なら変えない").toEqual(tuned);
  });

  it("入力を書き換えない", () => {
    const input = statsWith("str", RAW_PLUS_10);
    const snapshot = structuredClone(input);
    const out = deriveAttributes(input);
    expect(input, "入力の stats が変わった").toEqual(snapshot);
    expect(out.attributes, "attributes を共有している").not.toBe(input.attributes);
  });

  it("attributesEff に逓減後の値が入る", () => {
    const out = deriveAttributes(statsWith("dex", 40));
    expect(out.attributesEff.dex).toBeCloseTo(effectiveAttr(40));
    expect(out.attributes.dex, "生の値は残す").toBe(40);
  });

  it("筋力・霊力は体の性能を持たない（行動の強さは行動ごとの係数でだけ伸びる。A-10）", () => {
    const base = computeStats(createEmptyEquipment());
    for (const key of ["str", "spi"] as const) {
      const out = deriveAttributes(statsWith(key, RAW_PLUS_10));
      expect({ ...out, attributes: base.attributes, attributesEff: base.attributesEff }, `${key} で派生が動いた`).toEqual(base);
    }
  });

  it("行動に縛られる派生（怯み値・吹き飛ばし・連射・会心・状態異常の効果量）はステータスで動かない", () => {
    for (const key of ATTR_KEYS) {
      const out = deriveAttributes(statsWith(key, RAW_PLUS_10));
      expect(out.poiseDamageMul, `${key} → 怯み値`).toBe(1);
      expect(out.knockbackMul, `${key} → 吹き飛ばし`).toBe(1);
      expect(out.fireRateMul, `${key} → 連射`).toBe(1);
      expect(out.critChance, `${key} → 会心率`).toBe(DEFAULT_STATS.critChance);
      expect(out.statusPotencyMul, `${key} → 状態異常の効果量`).toBe(1);
    }
  });

  it("技巧: 移動とダッシュ再使用時間が ATTR の係数どおり動き、下限で止まる", () => {
    const out = deriveAttributes(statsWith("dex", RAW_PLUS_10));
    const d = effectiveAttr(RAW_PLUS_10) - ATTR.base;
    expect(out.moveSpeedMul).toBeCloseTo(1 + ATTR.dexMove * d, FLOAT_DIGITS);
    expect(out.dashCooldownMul).toBeCloseTo(Math.max(ATTR.dexDashCooldownMin, 1 - ATTR.dexDashCooldown * d), FLOAT_DIGITS);
    const huge = deriveAttributes(statsWith("dex", 200));
    expect(huge.dashCooldownMul, "ダッシュ CD の短縮は ×0.7 で止まる").toBeCloseTo(ATTR.dexDashCooldownMin, FLOAT_DIGITS);
  });

  it("体力: 最大 HP +4 / 受ける状態異常の持続 100 / (100 + 3d)（下限 ×0.5）", () => {
    const out = deriveAttributes(statsWith("vit", RAW_PLUS_10));
    expect(out.maxHp).toBe(DEFAULT_STATS.maxHp + 40);
    expect(out.statusTakenMul).toBeCloseTo(100 / 130, FLOAT_DIGITS);
    const huge = deriveAttributes(statsWith("vit", 200));
    expect(huge.statusTakenMul, "持続の短縮は ×0.5 で止まる").toBe(ATTR.vitStatusTakenMin);
  });

  it("体力が 0 でも最大 HP は 1 を下回らない", () => {
    const zero = deriveAttributes(statsWith("vit", 0));
    expect(zero.maxHp, "d = −5 で −20").toBe(DEFAULT_STATS.maxHp - 20);
    const glass = deriveAttributes(statsWith("vit", 0, { ...computeStats(createEmptyEquipment()), maxHp: 1 }));
    expect(glass.maxHp).toBe(1);
  });

  it("精神: 最大気力・自然回復が 1 点ごとに ATTR の係数ぶん伸びる", () => {
    const out = deriveAttributes(statsWith("mnd", RAW_PLUS_10));
    const d = RAW_PLUS_10 - ATTR.base;
    // 係数は 2026-09-24 のマナ経済の締め直しで変わる前提なので ATTR から読む（src/data/tuning.ts ATTR 参照）
    expect(out.maxMana).toBeCloseTo(DEFAULT_STATS.maxMana + ATTR.mndMaxMana * d, FLOAT_DIGITS);
    expect(out.manaRegen).toBeCloseTo(DEFAULT_STATS.manaRegen + ATTR.mndManaRegen * d, FLOAT_DIGITS);
  });

  it("防御: 実効値 +10 で防御力 +10・魔防 +5（ATTR.defArmor / defWarding）", () => {
    const out = deriveAttributes(statsWith("def", RAW_PLUS_10));
    expect(out.armor).toBeCloseTo(DEFAULT_STATS.armor + ATTR.defArmor * 10, FLOAT_DIGITS);
    expect(out.warding).toBeCloseTo(DEFAULT_STATS.warding + ATTR.defWarding * 10, FLOAT_DIGITS);
  });

  it("防御が 0 でも防御力・魔防は負にならない", () => {
    const zero = deriveAttributes(statsWith("def", 0));
    expect(zero.armor).toBeGreaterThanOrEqual(0);
    expect(zero.warding).toBeGreaterThanOrEqual(0);
  });
});

describe("applyStats への組み込み", () => {
  it("開始時の state.stats は基礎値なら computeStats と一致する", () => {
    const state = createGame(1);
    expect(state.stats).toEqual(computeStats(createEmptyEquipment()));
    expect(state.player.mana, "マナは満タンで始まる").toBe(DEFAULT_STATS.maxMana);
  });

  it("装備が上げた体力が派生に反映され、何度呼んでも二重に掛からない", () => {
    const state = createGame(1);
    const plain = computeStats(state.profile.equipment);
    const equip = { ...plain, attributes: { ...plain.attributes, vit: plain.attributes.vit + 10 } };
    applyStats(state, equip);
    const once = state.stats.maxHp;
    applyStats(state, equip);
    expect(state.stats.attributes.vit).toBe(ATTR.base + 10);
    expect(state.stats.maxHp, "二重に掛かった").toBe(once);
    expect(state.stats.maxHp, "体力 +10 で最大生命 +40").toBe(plain.maxHp + ATTR.vitMaxHp * 10);
    expect(state.boonRun.baseStats?.attributes.vit, "祝福の基準 stats は派生前の生値").toBe(ATTR.base + 10);
  });
});

describe("行動ごとの係数（A-10）", () => {
  const base = deriveAttributes(computeStats(createEmptyEquipment()));

  it("withRatio: 基礎値では元の値のまま、係数ぶん 1 点ごとに上乗せする", () => {
    expect(withRatio(base, 20, { str: 0.6, vit: 0.3 }), "基礎値").toBe(20);
    const strong = deriveAttributes(statsWith("str", RAW_PLUS_10));
    expect(withRatio(strong, 20, { str: 0.6, vit: 0.3 })).toBeCloseTo(26, FLOAT_DIGITS);
    expect(withRatio(strong, 20, undefined), "係数なしはステータスで伸びない").toBe(20);
  });

  it("withRatio: ステータスを下げても負にはならない", () => {
    const weak = deriveAttributes(statsWith("mnd", 0));
    expect(withRatio(weak, 1, { mnd: 1 })).toBe(0);
  });

  it("ratioToScaling: 表示用に「ステータス 0 のときの値 + 係数」へ直し、基礎値で元の値に戻る", () => {
    const s = ratioToScaling(20, { str: 0.6, dex: 0, spi: 0.4 });
    expect(s).toEqual({ base: 15, str: 0.6, spi: 0.4 });
    expect(scaledAtBase(s)).toBeCloseTo(20, FLOAT_DIGITS);
  });

  it("buffMul: 係数表が無ければ 1、あれば評価した値（負にしない）", () => {
    expect(buffMul(base, undefined)).toBe(1);
    expect(buffMul(base, { base: 0.9, spi: 0.02 })).toBeCloseTo(1, FLOAT_DIGITS);
    expect(buffMul(deriveAttributes(statsWith("spi", RAW_PLUS_10)), { base: 0.9, spi: 0.02 })).toBeCloseTo(1.2, FLOAT_DIGITS);
    expect(buffMul(base, { base: -5 })).toBe(0);
  });
});
