import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ACTION, ATTR, PLAYER } from "../data/tuning";
import { SKILL } from "../skills/data";
import { computeStats } from "../loot/stats";
import {
  ATTR_KEYS,
  DEFAULT_STATS,
  createEmptyEquipment,
  uniformAttributes,
  type AttrKey,
  type PlayerStats,
  type Scaling,
} from "../loot/types";
import { addRunAttributes, buffPotencyMul, deriveAttributes, effectiveAttr, scaled } from "./attributes";
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

  it("20 を超えると傾き 0.5、40 を超えると 0.25", () => {
    expect(effectiveAttr(21), "knee1 の直後は 0.5 刻み").toBe(20.5);
    expect(effectiveAttr(40), "knee2 ちょうどで実効 30").toBe(30);
    expect(effectiveAttr(41), "knee2 の直後は 0.25 刻み").toBe(30.25);
    expect(effectiveAttr(60), "60 は 30 + 20 × 0.25").toBe(35);
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
    expect(out.attributesEff.dex).toBe(30);
    expect(out.attributes.dex, "生の値は残す").toBe(40);
  });

  it("筋力: 怯み値倍率 +3% / ノックバック +2%（1 点あたり）", () => {
    const out = deriveAttributes(statsWith("str", RAW_PLUS_10));
    expect(out.poiseDamageMul).toBeCloseTo(1.3, FLOAT_DIGITS);
    expect(out.knockbackMul).toBeCloseTo(1.2, FLOAT_DIGITS);
  });

  it("技巧: 移動 +0.5% / 連射 +1% / ダッシュ CD −1%（下限 ×0.7）", () => {
    const out = deriveAttributes(statsWith("dex", RAW_PLUS_10));
    expect(out.moveSpeedMul).toBeCloseTo(1.05, FLOAT_DIGITS);
    expect(out.fireRateMul).toBeCloseTo(1.1, FLOAT_DIGITS);
    expect(out.dashCooldownMul).toBeCloseTo(0.9, FLOAT_DIGITS);
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

  it("精神: 最大マナ +6 / 自然回復 +0.45 / 会心率 +0.4%", () => {
    const out = deriveAttributes(statsWith("mnd", RAW_PLUS_10));
    expect(out.maxMana).toBe(DEFAULT_STATS.maxMana + 60);
    // mndManaRegen は QA 2026-09-23 の 2 巡目調整で 0.3 → 0.45（src/data/tuning.ts ATTR 参照）
    expect(out.manaRegen).toBeCloseTo(DEFAULT_STATS.manaRegen + 4.5, FLOAT_DIGITS);
    expect(out.critChance).toBeCloseTo(DEFAULT_STATS.critChance + 0.04, FLOAT_DIGITS);
  });

  it("霊力: 状態異常の効果量 +3% / buff の効果量 +2%", () => {
    const out = deriveAttributes(statsWith("spi", RAW_PLUS_10));
    expect(out.statusPotencyMul).toBeCloseTo(1.3, FLOAT_DIGITS);
    expect(buffPotencyMul(out)).toBeCloseTo(1.2, FLOAT_DIGITS);
    expect(buffPotencyMul(deriveAttributes(computeStats(createEmptyEquipment()))), "基礎値では 1").toBe(1);
  });
});

describe("addRunAttributes（ラン内振り分け）", () => {
  it("生の値に足し、入力は書き換えない", () => {
    const base = computeStats(createEmptyEquipment());
    const alloc = { ...uniformAttributes(0), str: 3, spi: 1 };
    const out = addRunAttributes(base, alloc);
    expect(out.attributes).toEqual({ str: 8, dex: 5, vit: 5, mnd: 5, spi: 6 });
    expect(base.attributes, "入力の attributes が変わった").toEqual(uniformAttributes(ATTR.base));
  });
});

describe("applyStats への組み込み", () => {
  it("開始時の state.stats は基礎値なら computeStats と一致する", () => {
    const state = createGame(1);
    expect(state.stats).toEqual(computeStats(createEmptyEquipment()));
    expect(state.player.mana, "マナは満タンで始まる").toBe(DEFAULT_STATS.maxMana);
  });

  it("振り分けが派生に反映され、何度呼んでも二重に掛からない", () => {
    const state = createGame(1);
    state.runAttributes.alloc.str = 10;
    const equip = computeStats(state.profile.equipment);
    applyStats(state, equip);
    applyStats(state, equip);
    expect(state.stats.attributes.str).toBe(15);
    expect(state.stats.poiseDamageMul).toBeCloseTo(1.3, FLOAT_DIGITS);
    expect(state.boonRun.baseStats?.attributes.str, "祝福の基準 stats は振り分け前").toBe(ATTR.base);
  });
});

// ---------------------------------------------------------------------------
// 基礎値での威力の一致（docs/COMBAT_DESIGN.md F-3 の 3）
// ---------------------------------------------------------------------------

interface BaselineRow {
  label: string;
  /**
   * 基準として固定した威力（tuning / SKILL の値）。
   * 元は「段階 0 前に実測した威力」だったが、QA 2026-09-23 のバランス調整
   * （通常攻撃 scaling.base −20%、マナ型スキル damage.base +10%、さらにマナ型スキルはコスト −15% /
   * damage.base +15%（通算 +26%）。docs/COMBAT_DESIGN.md B-7）で
   * 対象レーンの基礎値が変わったため、「調整後の scaling / SKILL の値を基礎ステータスで評価した値」に更新した
   */
  pinned: number;
  /** 設計書 A-6 / B-4 の係数表 */
  scaling: Scaling;
  /**
   * 今の威力の出どころ。段階 1 で damage を Scaling に置き換えたレーンは、
   * ここを「scaled(基礎値の stats, 新しい定義)」に差し替える
   */
  current: () => number;
}

/** 基礎値の stats で係数表を評価する（Scaling に置き換え済みの行が使う） */
function atBase(s: Scaling): number {
  return scaled(deriveAttributes(computeStats(createEmptyEquipment())), s);
}

const BASELINE: readonly BaselineRow[] = [
  { label: "近接 1 段", pinned: 7.8, scaling: { base: 4.8, str: 0.6 }, current: () => atBase(PLAYER.melee[0].scaling) },
  { label: "近接 2 段", pinned: 7.8, scaling: { base: 4.8, str: 0.6 }, current: () => atBase(PLAYER.melee[1].scaling) },
  { label: "近接 3 段", pinned: 15.6, scaling: { base: 9.6, str: 1.2 }, current: () => atBase(PLAYER.melee[2].scaling) },
  { label: "ダッシュ攻撃", pinned: 11.2, scaling: { base: 7.2, str: 0.8 }, current: () => atBase(ACTION.dashAttack.scaling) },
  { label: "射撃（1 発）", pinned: 4.3, scaling: { base: 2.8, dex: 0.3 }, current: () => atBase(PLAYER.shoot.scaling) },
  { label: "バースト", pinned: 34, scaling: { base: 24, mnd: 1, spi: 1 }, current: () => atBase(PLAYER.special.scaling) },
  { label: "壁叩きつけ", pinned: 10, scaling: { base: 7, str: 0.6 }, current: () => ACTION.wallSplat.damage },
  { label: "旋風斬り（1 回転）", pinned: 7.8, scaling: { base: 3.8, str: 0.4, spi: 0.4 }, current: () => atBase(SKILL.whirl.damage) },
  { label: "突進斬り", pinned: 16, scaling: { base: 8, str: 1, dex: 0.6 }, current: () => atBase(SKILL.lunge.damage) },
  { label: "グレネード", pinned: 29.2, scaling: { base: 15.2, dex: 1.4, spi: 1.4 }, current: () => atBase(SKILL.frag.damage) },
  { label: "撃ち抜き", pinned: 33.7, scaling: { base: 17.7, dex: 2, spi: 1.2 }, current: () => atBase(SKILL.railshot.damage) },
  { label: "パリィ（衝撃波）", pinned: 12, scaling: { base: 6, str: 0.6, spi: 0.6 }, current: () => atBase(SKILL.parry.damage) },
  { label: "地裂き", pinned: 24.7, scaling: { base: 12.7, str: 1.6, spi: 0.8 }, current: () => atBase(SKILL.quake.damage) },
  { label: "雷撃", pinned: 26.7, scaling: { base: 12.7, dex: 1.2, spi: 1.6 }, current: () => atBase(SKILL.thunder.damage) },
  { label: "引力球（tick）", pinned: 3.3, scaling: { base: 1.3, spi: 0.4 }, current: () => atBase(SKILL.gravityWell.tickDamage) },
  { label: "引力球（破裂）", pinned: 20.1, scaling: { base: 10.1, spi: 2 }, current: () => atBase(SKILL.gravityWell.burstDamage) },
  { label: "地雷", pinned: 22.1, scaling: { base: 10.1, dex: 1.2, spi: 1.2 }, current: () => atBase(SKILL.mines.damage) },
  { label: "鎖鎌", pinned: 15.6, scaling: { base: 7.6, str: 1, dex: 0.6 }, current: () => atBase(SKILL.chainHook.damage) },
  { label: "回転弾幕（1 発）", pinned: 5.5, scaling: { base: 2.5, dex: 0.3, spi: 0.3 }, current: () => atBase(SKILL.spiral.damage) },
  { label: "氷結地帯（tick）", pinned: 4.3, scaling: { base: 1.3, spi: 0.6 }, current: () => atBase(SKILL.frostField.tickDamage) },
];

describe("基礎値のステータスで全攻撃・全スキルの威力が QA 2026-09-23 のバランス調整後の値と一致する", () => {
  const baseStats = deriveAttributes(computeStats(createEmptyEquipment()));

  it("基礎値の実効値は全ステータス 5", () => {
    for (const k of ATTR_KEYS) expect(baseStats.attributesEff[k], k).toBe(ATTR.base);
  });

  it.each(BASELINE)("$label: 今の威力が段階 0 前の値のまま", (row) => {
    expect(row.current(), `${row.label} の威力が変わった`).toBeCloseTo(row.pinned, FLOAT_DIGITS);
  });

  it.each(BASELINE)("$label: 係数表を基礎値で評価すると段階 0 前の値になる", (row) => {
    expect(scaled(baseStats, row.scaling), `${row.label} の係数表がずれている`).toBeCloseTo(row.pinned, FLOAT_DIGITS);
  });
});
