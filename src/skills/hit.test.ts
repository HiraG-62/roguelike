import { describe, expect, it } from "vitest";
import type { Enemy } from "../core/state";
import type { StatusKind } from "../core/status";
import { arena, placeEnemy } from "../system/testHelpers";
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
  it("スキル由来として rollOutgoing に渡る（skillDamageMul が掛かる）", () => {
    const plain = damageDealt("frag");
    expect(plain, "前提: 当たっている").toBeGreaterThan(0);
    expect(damageDealt("frag", { skillDamageMul: 2 })).toBeCloseTo(plain * 2, 0);
  });

  it("怯み値はスキルの基礎怯み値 × poiseDamageMul で溜まる", () => {
    const base = poiseDealt("quake", 1);
    expect(base, "前提: 怯み値が溜まる").toBeGreaterThan(0);
    expect(poiseDealt("quake", 1.5)).toBeCloseTo(base * 1.5);
    expect(poiseDealt("mines", 1) / base, "スキルごとの比").toBeCloseTo(SKILL.mines.poise / SKILL.quake.poise);
  });

  it("spec の poise で上書きできる（引力球の tick は 0）", () => {
    expect(poiseDealt("gravityWell", 1, 0)).toBe(0);
  });

  it("SkillDef.applies を命中した敵に付ける（撃ち抜き = 脆弱、雷撃 = 感電 2）", () => {
    const rail = setup();
    skillHit(rail.state, rail.enemy, paramsFor("railshot"), spec);
    expect(statusOf(rail.enemy, "vulnerable"), "脆弱").toBeDefined();
    const thunder = setup();
    skillHit(thunder.state, thunder.enemy, paramsFor("thunder"), spec);
    expect(statusOf(thunder.enemy, "shock")?.stacks, "感電 2").toBe(SKILL.thunder.shockStacks);
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
    skillHit(whirl.state, whirl.enemy, paramsFor("whirl"), { ...spec, kind: "melee" });
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
    skillHit(state, enemy, paramsFor("thunder"), spec);
    expect(enemy.hp).toBeLessThanOrEqual(0);
    expect(appliedKinds(enemy)).toEqual([]);
  });
});
