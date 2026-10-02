import { describe, expect, it } from "vitest";
import type { Enemy } from "../core/state";
import type { StatusKind } from "../core/status";
import { arena, increasedWith, placeEnemy } from "../system/testHelpers";
import { SKILL, SKILL_DEFS, resolveCast } from "./data";
import { stoneFromSeed } from "./generator";
import { skillHit } from "./hit";
import type { CastParams, SkillKey } from "./types";

/**
 * スキル命中の共通入口が、戦闘の新しい口（docs/COMBAT_DESIGN.md A-6 / B-4 / D-2 / E-5）へ
 * 正しい値を渡しているかを、敵に残った結果（HP・怯み値・状態異常）で検証する
 */

const BIG_HP = 1000;
const HIT_BASE = 10;
/** 丸めの誤差が倍率の比較に効かない大きさ */
const HIT_BASE_BIG = 100;

function paramsFor(key: SkillKey): CastParams {
  const stone = { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
  return resolveCast(SKILL_DEFS[key], stone, []);
}

function setup(): { state: ReturnType<typeof arena>; enemy: ReturnType<typeof placeEnemy> } {
  const state = arena();
  const enemy = placeEnemy(state, "golem", 20);
  enemy.hp = BIG_HP;
  enemy.maxHp = BIG_HP;
  enemy.phase = "idle";
  // 属性の相性の抽選（ELEMENT.affinity、命中の 1 割で属性の状態異常を付ける）を外す。
  // applies の検証が乱数の位置しだい（感電 2 + 相性の感電 1 で麻痺に変わる等）にならないように
  state.rng = { ...state.rng, chance: () => false };
  return { state, enemy };
}

const spec = { base: HIT_BASE, kind: "ranged" as const, dir: { x: 1, y: 0 }, knockback: 0, stagger: false };

function statusOf(e: Enemy, kind: StatusKind): { stacks: number; potency: number } | undefined {
  return e.status.effects.find((s) => s.kind === kind && s.time > 0);
}

/** 怯み・堅守（怯み値の結果）以外に付いている状態異常 */
function appliedKinds(e: Enemy): StatusKind[] {
  return e.status.effects.filter((s) => s.kind !== "stagger" && s.kind !== "guarded").map((s) => s.kind);
}

/** 1 回当てて減った HP（コンボ倍率が乗らないようにコンボは 0 から） */
function damageDealt(key: SkillKey, statsPatch: Partial<ReturnType<typeof arena>["stats"]> = {}): number {
  const { state, enemy } = setup();
  state.stats = { ...state.stats, ...statsPatch };
  state.combo.count = 0;
  skillHit(state, enemy, paramsFor(key), { ...spec, base: HIT_BASE_BIG });
  return BIG_HP - enemy.hp;
}

/** 1 回当てて溜まった怯み値 */
function poiseDealt(key: SkillKey, poiseDamageMul: number, override?: number): number {
  const { state, enemy } = setup();
  state.stats = { ...state.stats, poiseDamageMul };
  skillHit(state, enemy, paramsFor(key), { ...spec, poise: override });
  return enemy.poise.damage;
}

describe("skillHit が戦闘の口へ渡す値", () => {
  it("スキル由来として rollOutgoing に渡る（スキルの増が足される）", () => {
    const plain = damageDealt("mines");
    expect(plain, "前提: 当たっている").toBeGreaterThan(0);
    expect(damageDealt("mines", { increased: increasedWith({ skill: 1 }) })).toBeCloseTo(plain * 2, 0);
  });

  it("素性が null のスキル（伝染など）が当てても、敵の防御を素通ししない", () => {
    const noCrit = { critChance: 0 };
    const shadow = damageDealt("contagion", noCrit);
    expect(shadow, "ゴーレムの防御で減る").toBeLessThan(HIT_BASE_BIG);
    expect(shadow, "既定（無属性の物理）と同じ").toBe(damageDealt("rout", noCrit));
  });

  it("怯み値はスキルの基礎怯み値 × poiseDamageMul で溜まる", () => {
    const base = poiseDealt("chainHook", 1);
    expect(base, "前提: 怯み値が溜まる").toBeGreaterThan(0);
    expect(poiseDealt("chainHook", 1.5)).toBeCloseTo(base * 1.5);
    expect(poiseDealt("mines", 1) / base, "スキルごとの比").toBeCloseTo(SKILL.mines.poise / SKILL.chainHook.poise);
  });

  it("spec の poise で上書きできる（引力球の tick は 0）", () => {
    expect(poiseDealt("gravityWell", 1, 0)).toBe(0);
  });

  it("SkillDef.applies を命中した敵に付ける（処断 = 沈黙、雷鳴 = 感電）", () => {
    const verdict = setup();
    skillHit(verdict.state, verdict.enemy, paramsFor("verdict"), spec);
    expect(statusOf(verdict.enemy, "silence"), "沈黙").toBeDefined();
    const thunder = setup();
    skillHit(thunder.state, thunder.enemy, paramsFor("commonThunderclap"), spec);
    const shock = SKILL_DEFS.commonThunderclap.applies?.find((a) => a.kind === "shock");
    expect(shock, "前提: 雷鳴は感電を付ける").toBeDefined();
    expect(statusOf(thunder.enemy, "shock")?.stacks, "感電").toBe(shock?.stacks);
  });

  it("付与の効果量は potencyMul（血の代償など）で伸びる", () => {
    const plain = setup();
    skillHit(plain.state, plain.enemy, paramsFor("chainHook"), { ...spec, kind: "melee" });
    const boosted = setup();
    skillHit(boosted.state, boosted.enemy, { ...paramsFor("chainHook"), potencyMul: 2 }, { ...spec, kind: "melee" });
    const base = statusOf(plain.enemy, "bleed")?.potency ?? 0;
    expect(base, "前提: 出血が付く").toBeGreaterThan(0);
    expect(statusOf(boosted.enemy, "bleed")?.potency).toBeCloseTo(base * 2);
  });

  it("applies: null なら付けない（引力球の破裂）。付与を持たないスキルも付けない", () => {
    const well = setup();
    skillHit(well.state, well.enemy, paramsFor("gravityWell"), { ...spec, applies: null });
    expect(appliedKinds(well.enemy)).toEqual([]);
    const whirl = setup();
    skillHit(whirl.state, whirl.enemy, paramsFor("commonWhirl"), { ...spec, kind: "melee" });
    expect(appliedKinds(whirl.enemy)).toEqual([]);
  });

  it("引力球の tick は沈黙を付ける", () => {
    const { state, enemy } = setup();
    skillHit(state, enemy, paramsFor("gravityWell"), { ...spec, poise: 0 });
    expect(statusOf(enemy, "silence")).toBeDefined();
  });

  it("倒した敵には付けない", () => {
    const { state, enemy } = setup();
    enemy.hp = 1;
    skillHit(state, enemy, paramsFor("commonThunderclap"), spec);
    expect(enemy.hp).toBeLessThanOrEqual(0);
    expect(appliedKinds(enemy)).toEqual([]);
  });
});

describe("刻印符: 命中ごとの効果", () => {
  const m = SKILL.modifier;

  /** 同じ条件で 1 回当てて減った HP */
  function hitDamage(params: CastParams, extra: Partial<Parameters<typeof skillHit>[3]> = {}, facing = { x: 1, y: 0 }): number {
    const { state, enemy } = setup();
    enemy.facing = facing;
    state.combo.count = 0;
    skillHit(state, enemy, params, { ...spec, base: HIT_BASE_BIG, kind: "melee", ...extra });
    return BIG_HP - enemy.hp;
  }

  it("怯み値の倍率（poiseMul）が溜まる怯み値に掛かる", () => {
    const base = poiseDealt("chainHook", 1);
    const doubled = setup();
    skillHit(doubled.state, doubled.enemy, { ...paramsFor("chainHook"), poiseMul: 2 }, spec);
    expect(doubled.enemy.poise.damage).toBeCloseTo(base * 2);
    const none = setup();
    skillHit(none.state, none.enemy, { ...paramsFor("chainHook"), poiseMul: 0 }, spec);
    expect(none.enemy.poise.damage).toBe(0);
  });

  it("手繰りはノックバックの向きを反転する", () => {
    const pull = setup();
    skillHit(pull.state, pull.enemy, { ...paramsFor("chainHook"), knockbackMul: -1 }, { ...spec, knockback: 200 });
    expect(pull.enemy.knock.x, "発動側へ引かれる").toBeLessThan(0);
  });

  it("付ける状態異常の持続は statusDurationMul で伸びる", () => {
    const plain = setup();
    skillHit(plain.state, plain.enemy, paramsFor("verdict"), spec);
    const long = setup();
    skillHit(long.state, long.enemy, { ...paramsFor("verdict"), statusDurationMul: 2 }, spec);
    const t0 = plain.enemy.status.effects.find((e) => e.kind === "silence")?.time ?? 0;
    const t1 = long.enemy.status.effects.find((e) => e.kind === "silence")?.time ?? 0;
    expect(t0, "前提: 沈黙が付く").toBeGreaterThan(0);
    expect(t1).toBeGreaterThan(t0);
  });

  it("巡り: 命中ごとに払ったコストの一部が戻り、上限を超えない", () => {
    const { state, enemy } = setup();
    state.player.mana = 0;
    const paid = 20;
    const params = { ...paramsFor("commonWhirl"), manaPaid: paid, refundPerHit: m.refund.perHit, refundPool: { left: paid }, hitRefundPool: { left: paid * m.refund.cap } };
    for (let i = 0; i < 10; i++) skillHit(state, enemy, params, spec);
    expect(state.player.mana).toBeCloseTo(paid * m.refund.cap);
  });

  /** 1 体目（20px）の近くに 2 体目（40px）を置く */
  function twoEnemies(): { state: ReturnType<typeof arena>; enemy: Enemy; other: Enemy } {
    const { state, enemy } = setup();
    const other = placeEnemy(state, "golem", 40);
    other.hp = BIG_HP;
    other.maxHp = BIG_HP;
    other.phase = "idle";
    return { state, enemy, other };
  }

  it("連鎖: 命中した敵から、まだ当てていない近くの敵へ跳ぶ（発動 1 回の残り回数まで）", () => {
    const { state, enemy, other } = twoEnemies();
    const params = { ...paramsFor("commonWhirl"), chain: true, chainPool: { left: 1 } };
    skillHit(state, enemy, params, { ...spec, base: HIT_BASE_BIG });
    expect(other.hp, "跳んだ先に当たる").toBeLessThan(BIG_HP);
    expect(params.chainPool.left, "1 回使った").toBe(0);
    const before = other.hp;
    skillHit(state, enemy, params, { ...spec, base: HIT_BASE_BIG });
    expect(other.hp, "残り回数が 0 なら跳ばない").toBe(before);
  });

  it("爆ぜ: 命中点の周りの敵にも当たり、爆ぜの命中からは爆ぜない", () => {
    const { state, enemy, other } = twoEnemies();
    const params = { ...paramsFor("commonWhirl"), burst: true, burstPool: { left: 3 } };
    skillHit(state, enemy, params, { ...spec, base: HIT_BASE_BIG });
    expect(other.hp, "隣にも当たる").toBeLessThan(BIG_HP);
    expect(params.burstPool.left, "1 回の命中で 1 回だけ").toBe(2);
  });

  it("会心の確定（刺し穿ち）は critMul を掛ける", () => {
    const plain = hitDamage(paramsFor("exploit"));
    expect(hitDamage(paramsFor("exploit"), { forceCrit: true }) / plain).toBeCloseTo(DEFAULT_CRIT_MUL, 1);
  });

  it("命中した敵 id を発動の記録（hitLog）に残す", () => {
    const { state, enemy } = setup();
    const params = paramsFor("commonWhirl");
    skillHit(state, enemy, params, spec);
    expect(params.hitLog.has(enemy.id)).toBe(true);
  });
});

const DEFAULT_CRIT_MUL = arena().stats.critMul;
