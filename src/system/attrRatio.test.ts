import { describe, expect, it } from "vitest";
import type { StatusApply } from "../core/status";
import { ATTR, PLAYER } from "../data/tuning";
import { MOVESETS, type MovesetDef } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { DEFAULT_STATS, type AttrKey, type PlayerStats } from "../loot/types";
import { deriveAttributes, scaled } from "./attributes";
import { meleeStep, shotDamage } from "./player";
import { applyStatus, findStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

/**
 * 行動ごとのステータス係数（docs/COMBAT_DESIGN.md A-10）が各経路に届くことの検査。
 * ステータスは行動の強さを「固定の派生」ではなく行動ごとの係数でだけ伸ばす
 */

const BIG_HP = 100000;
const PLUS = 10;
const DIGITS = 9;

/** 実効値を 1 つだけ基礎値 + PLUS にした stats */
function statsPlus(key: AttrKey, base: PlayerStats = DEFAULT_STATS): PlayerStats {
  return deriveAttributes({ ...base, attributes: { ...base.attributes, [key]: ATTR.base + PLUS } });
}

describe("状態異常の効果量の係数（StatusApply.ratio）", () => {
  const apply: StatusApply = { kind: "burn", stacks: 1, duration: 3, potency: 4, ratio: { spi: 0.2, vit: 0.1 } };

  function potencyWith(stats: PlayerStats, a: StatusApply): number {
    const state = arena(5, stats);
    const e = placeEnemy(state, "slime", 30);
    e.hp = BIG_HP;
    e.maxHp = BIG_HP;
    applyStatus(state, { kind: "enemy", enemy: e }, a, "player");
    return findStatus(e.status, "burn")?.potency ?? Number.NaN;
  }

  it("基礎値のステータスでは元の効果量のまま", () => {
    expect(potencyWith(deriveAttributes(DEFAULT_STATS), apply)).toBeCloseTo(4, DIGITS);
  });

  it("係数を持つステータスを上げると 1 点ごとに係数ぶん増え、持たないステータスでは変わらない", () => {
    expect(potencyWith(statsPlus("spi"), apply), "霊力 +10").toBeCloseTo(4 + 0.2 * PLUS, DIGITS);
    expect(potencyWith(statsPlus("vit"), apply), "体力 +10").toBeCloseTo(4 + 0.1 * PLUS, DIGITS);
    expect(potencyWith(statsPlus("str"), apply), "筋力 +10（係数なし）").toBeCloseTo(4, DIGITS);
  });

  it("係数の無い付与はステータスで伸びない（霊力の固定の上乗せは無い）", () => {
    const plain: StatusApply = { kind: "burn", stacks: 1, duration: 3, potency: 4 };
    expect(potencyWith(statsPlus("spi"), plain)).toBeCloseTo(4, DIGITS);
  });
});

describe("近接の怯み値の係数（MeleeStepDef.poiseRatio）", () => {
  const base = MOVESETS.sword;
  const tuned: MovesetDef = { ...base, steps: base.steps.map((s) => ({ ...s, poise: 20, poiseRatio: { dex: 0.5 } })) };

  it("基礎値では段の怯み値のまま、係数のステータスで伸びる", () => {
    const atBase = meleeStep(deriveAttributes(DEFAULT_STATS), 0, false, 0, -1, tuned);
    expect(atBase?.poise).toBeCloseTo(20, DIGITS);
    const dex = meleeStep(statsPlus("dex"), 0, false, 0, -1, tuned);
    expect(dex?.poise).toBeCloseTo(20 + 0.5 * PLUS, DIGITS);
    const str = meleeStep(statsPlus("str"), 0, false, 0, -1, tuned);
    expect(str?.poise, "筋力は怯み値を固定では伸ばさない").toBeCloseTo(20, DIGITS);
  });
});

describe("弾ごとの係数（BulletDef.scaling）", () => {
  it("弾が係数表を持てばそれを、持たなければ共通の係数表を使う", () => {
    for (const shot of Object.values(BULLETS)) {
      const stats: PlayerStats = { ...statsPlus("dex"), bullet: shot.key };
      const expected = scaled(stats, shot.scaling ?? PLAYER.shoot.scaling);
      expect(shotDamage(stats), shot.key).toBeCloseTo(expected, DIGITS);
    }
  });
});

describe("武器の技の状態異常の係数（weapons.json の applies.ratio）", () => {
  it("JSON の ratio が StatusApply まで届く", () => {
    const withRatio = Object.values(MOVESETS)
      .flatMap((m) => [...m.steps, m.dashAttack, ...m.branches.map((b) => b.step)])
      .flatMap((s) => s.applies ?? [])
      .filter((a) => a.ratio !== undefined);
    expect(withRatio.length, "係数付きの付与が 1 つも無い").toBeGreaterThan(0);
  });
});
