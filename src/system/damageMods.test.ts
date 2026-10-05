import { describe, expect, it } from "vitest";
import type { MoreMul } from "../core/damage";
import { MIN_INCREASED_MUL } from "../core/damage";
import { MOVESETS } from "../data/weapons";
import { KEYSTONE } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { createEmptyEquipment } from "../loot/types";
import { scaled } from "./attributes";
import { damageEnemy, rollOutgoing } from "./combat";
import { buildContext } from "./damageMods";
import { applyStagger } from "./poise";
import { arena, increasedWith, placeEnemy } from "./testHelpers";

/** 剣の左 1 段目（基礎値）の威力。probe（src/qa/probe.md）の装備なしの剣と同じ */
function swordFirstStep(state: ReturnType<typeof arena>): number {
  const first = MOVESETS.sword.steps[0];
  if (!first) throw new Error("剣の 1 段目が無い");
  return scaled(state.stats, first.scaling);
}

/** 生命を大きくした、怯みにくい敵（倒さずに何度も当てる） */
function sturdy(state: ReturnType<typeof arena>, key: string): ReturnType<typeof placeEnemy> {
  const e = placeEnemy(state, key, 20);
  e.hp = 10_000;
  e.maxHp = 10_000;
  return e;
}

/** 見本の倍（出所の文字列は内訳の並びを見るためだけの名前） */
const GLASS_HEART_MUL = 1.5;
const GLASS_HEART: MoreMul = { source: "boon:coreGlassHeart", label: "硝子の心", mul: GLASS_HEART_MUL, tags: ["melee", "ranged", "skill"] };
describe("与ダメの増と倍（rollOutgoing の内訳）", () => {
  it("装備なし深度 1 のスライムには段の基礎威力がそのまま入る", () => {
    const state = arena();
    state.depth = 1;
    const e = sturdy(state, "slime");
    const out = rollOutgoing(state, e, swordFirstStep(state), "melee");
    expect(out.amount, "威力").toBe(Math.round(swordFirstStep(state)));
    expect(out.breakdown.increased, "増なし").toBe(0);
    expect(out.breakdown.more, "倍なし").toEqual([]);
    expect(out.breakdown.enemyMul, "スライムは物理を等倍で受ける").toBe(1);
  });

  it("増は加算: 近接 +50% と スキル +50% の近接のスキルは 2.0 倍（2.25 倍にならない）", () => {
    const state = arena(5, { increased: increasedWith({ melee: 0.5, skill: 0.5 }) });
    const plain = arena();
    const out = rollOutgoing(state, null, 100, "melee", { skill: true });
    expect(out.amount).toBe(rollOutgoing(plain, null, 100, "melee", { skill: true }).amount * 2);
    expect(out.breakdown.increased, "Σ増").toBeCloseTo(1);
  });

  it("増はタグの合う 1 撃にだけ足される（近接の増は射撃・proc に効かない）", () => {
    const state = arena(5, { increased: increasedWith({ melee: 1 }) });
    expect(rollOutgoing(state, null, 100, "melee").amount, "近接").toBe(200);
    expect(rollOutgoing(state, null, 100, "ranged").amount, "射撃").toBe(100);
    expect(rollOutgoing(state, null, 100, "proc").amount, "proc").toBe(100);
  });

  it("誓約・芯・コンボ・会心が breakdown.more に出所ごとに並ぶ", () => {
    const state = arena(5, {
      keystones: ["ks_bladeOath"],
      more: [GLASS_HEART],
      comboDamagePerStack: 0.01,
      comboDamageCap: 0.5,
      critChance: 1,
    });
    state.combo.count = 10;
    const e = sturdy(state, "slime");
    const out = rollOutgoing(state, e, 100, "melee");
    expect(out.crit, "会心").toBe(true);
    expect(out.breakdown.more.map((m) => m.source)).toEqual(["boon:coreGlassHeart", "combo", "crit", "keystone:ks_bladeOath"]);
    const expected = 100 * GLASS_HEART_MUL * 1.1 * state.stats.critMul * KEYSTONE.bladeOathNearMul;
    expect(out.amount, "倍は掛け算").toBe(Math.round(expected));
  });

  it("同じ出所の倍は 2 枚積んでも 1 回だけ掛かる", () => {
    const state = arena(5, { more: [GLASS_HEART, GLASS_HEART] });
    const out = rollOutgoing(state, null, 100, "melee");
    expect(out.breakdown.more, "1 要素に畳む").toHaveLength(1);
    expect(out.amount).toBe(Math.round(100 * GLASS_HEART_MUL));
  });

  it("倍は tags の合う 1 撃にだけ掛かる（素手の倍は射撃に掛からない）", () => {
    const state = arena();
    state.stats = { ...state.stats, more: computeStats(createEmptyEquipment()).more };
    expect(rollOutgoing(state, null, 100, "ranged").amount, "射撃は等倍").toBe(100);
    expect(rollOutgoing(state, null, 100, "melee").breakdown.more.map((m) => m.source), "近接には素手").toEqual(["unarmed"]);
  });

  it("怯み中の敵に increased.vsStaggered が効き、more には出ない", () => {
    const state = arena(5, { increased: increasedWith({ vsStaggered: 0.5 }) });
    const e = sturdy(state, "golem");
    const before = rollOutgoing(state, e, 100, "melee");
    applyStagger(state, e, 1);
    const after = rollOutgoing(state, e, 100, "melee");
    expect(after.amount / before.amount, "怯み中は +50%").toBeCloseTo(1.5, 1);
    expect(after.breakdown.increased, "増に入る").toBeCloseTo(0.5);
    expect(after.breakdown.more, "倍には出ない").toEqual([]);
    expect(rollOutgoing(state, e, 100, "proc").breakdown.increased, "proc には掛けない").toBe(0);
  });

  it("増の合計は下限で止まる（代償を積んでも 0 にしない）", () => {
    const state = arena(5, { increased: increasedWith({ melee: -5 }) });
    expect(rollOutgoing(state, null, 100, "melee").amount).toBe(Math.round(100 * MIN_INCREASED_MUL));
  });

  it("1 撃のタグ: 種類・スキル・怯み中（proc 以外）・ボス", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStagger(state, e, 1);
    expect([...buildContext(e, "melee", { skill: true }).tags], "近接のスキル・怯み中").toEqual(["melee", "skill", "vsStaggered"]);
    expect([...buildContext(e, "proc").tags], "proc は怯み中を持たない").toEqual(["proc"]);
    const boss = placeEnemy(state, "kingSlime", 40);
    expect(buildContext(boss, "ranged").tags.has("vsBoss"), "ボス").toBe(true);
  });
});

describe("怯み値の増", () => {
  it("increased.poise は怯み値にだけ掛かり、与ダメは変えない", () => {
    const plain = arena();
    const boosted = arena(5, { increased: increasedWith({ poise: 1 }) });
    const a = sturdy(plain, "golem");
    const b = sturdy(boosted, "golem");
    damageEnemy(plain, a, 5, { x: 1, y: 0 }, 0, { poise: 3, kind: "melee" });
    damageEnemy(boosted, b, 5, { x: 1, y: 0 }, 0, { poise: 3, kind: "melee" });
    expect(a.poise.damage, "前提: 怯み値が入る").toBeGreaterThan(0);
    expect(b.poise.damage, "怯み値 2 倍").toBeCloseTo(a.poise.damage * 2);
    expect(b.hp, "与ダメは同じ").toBe(a.hp);
  });
});
