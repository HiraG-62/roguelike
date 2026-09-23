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

describe("大拡張の刻印符: 命中ごとの効果", () => {
  const m = SKILL.modifier;

  /** 同じ条件で 1 回当てて減った HP */
  function hitDamage(params: CastParams, extra: Partial<Parameters<typeof skillHit>[3]> = {}, facing = { x: 1, y: 0 }): number {
    const { state, enemy } = setup();
    enemy.facing = facing;
    state.combo.count = 0;
    skillHit(state, enemy, params, { ...spec, base: HIT_BASE_BIG, kind: "melee", ...extra });
    return BIG_HP - enemy.hp;
  }

  it("背面: 敵の背後からは x1.5、正面からは x0.8", () => {
    const { state, enemy } = setup();
    const params = { ...paramsFor("whirl"), flank: true };
    const behind = { x: enemy.body.pos.x - 10, y: enemy.body.pos.y };
    const front = { x: enemy.body.pos.x + 10, y: enemy.body.pos.y };
    const plain = hitDamage(paramsFor("whirl"));
    expect(hitDamage(params, { from: behind }) / plain, "背後").toBeCloseTo(m.flank.backMul, 1);
    expect(hitDamage(params, { from: front }) / plain, "正面").toBeCloseTo(m.flank.frontMul, 1);
    expect(state.skills.marks.size, "前提: 追撃の印は付かない").toBe(0);
  });

  it("至近: 発動位置から近い敵は強く、遠い敵は弱い。遠当ては逆", () => {
    const { enemy } = setup();
    const near = { ...paramsFor("spiral"), origin: { x: enemy.body.pos.x - 10, y: enemy.body.pos.y } };
    const far = { ...near, origin: { x: enemy.body.pos.x - 200, y: enemy.body.pos.y } };
    const plain = hitDamage(paramsFor("spiral"), { kind: "ranged" });
    expect(hitDamage({ ...near, rangeBias: "pointBlank" }, { kind: "ranged" }) / plain).toBeCloseTo(m.pointBlank.nearMul, 1);
    expect(hitDamage({ ...far, rangeBias: "pointBlank" }, { kind: "ranged" }) / plain).toBeCloseTo(m.pointBlank.farMul, 1);
    expect(hitDamage({ ...far, rangeBias: "longshot" }, { kind: "ranged" }) / plain).toBeCloseTo(m.longshot.farMul, 1);
    expect(hitDamage({ ...near, rangeBias: "longshot" }, { kind: "ranged" })).toBeLessThan(plain);
  });

  it("重撃は怯み値を倍、軽打は 0 にする", () => {
    const base = poiseDealt("quake", 1);
    const heavy = setup();
    skillHit(heavy.state, heavy.enemy, { ...paramsFor("quake"), poiseMul: m.heavy.poiseMul }, spec);
    expect(heavy.enemy.poise.damage).toBeCloseTo(base * m.heavy.poiseMul);
    const feather = setup();
    skillHit(feather.state, feather.enemy, { ...paramsFor("quake"), poiseMul: 0 }, spec);
    expect(feather.enemy.poise.damage).toBe(0);
  });

  it("手繰りはノックバックの向きを反転する。突き放しは壁叩きつけを狙える", () => {
    const pull = setup();
    skillHit(pull.state, pull.enemy, { ...paramsFor("quake"), knockbackMul: -1 }, { ...spec, knockback: 200 });
    expect(pull.enemy.knock.x, "発動側へ引かれる").toBeLessThan(0);
    const push = setup();
    skillHit(push.state, push.enemy, { ...paramsFor("quake"), repel: true, knockbackMul: m.repel.knockbackMul }, { ...spec, knockback: 200 });
    const plain = setup();
    skillHit(plain.state, plain.enemy, paramsFor("quake"), { ...spec, knockback: 200 });
    expect(push.enemy.knock.x).toBeGreaterThan(plain.enemy.knock.x * m.repel.knockbackMul);
    expect(push.enemy.wallSplat, "壁叩きつけの印").toBe(true);
  });

  it("延命: 付ける状態異常の持続が伸びる", () => {
    const plain = setup();
    skillHit(plain.state, plain.enemy, paramsFor("railshot"), spec);
    const long = setup();
    skillHit(long.state, long.enemy, { ...paramsFor("railshot"), statusDurationMul: m.linger.durationMul }, spec);
    const t0 = plain.enemy.status.effects.find((e) => e.kind === "vulnerable")?.time ?? 0;
    const t1 = long.enemy.status.effects.find((e) => e.kind === "vulnerable")?.time ?? 0;
    expect(t0, "前提: 脆弱が付く").toBeGreaterThan(0);
    expect(t1).toBeGreaterThan(t0);
  });

  it("伝播: 付けた状態異常が近くの 1 体にも付く", () => {
    const { state, enemy } = setup();
    const other = placeEnemy(state, "golem", 40);
    other.hp = BIG_HP;
    other.maxHp = BIG_HP;
    other.phase = "idle";
    skillHit(state, enemy, { ...paramsFor("railshot"), spread: true }, spec);
    expect(statusOf(other, "vulnerable"), "隣にも脆弱").toBeDefined();
  });

  it("返金: 命中ごとに払ったコストの一部が戻り、上限を超えない", () => {
    const { state, enemy } = setup();
    state.player.mana = 0;
    const paid = 20;
    const params = { ...paramsFor("whirl"), manaPaid: paid, refundPerHit: m.refund.perHit, refundPool: { left: paid }, hitRefundPool: { left: paid * m.refund.cap } };
    for (let i = 0; i < 10; i++) skillHit(state, enemy, params, spec);
    expect(state.player.mana).toBeCloseTo(paid * m.refund.cap);
  });

  it("追撃: 命中した敵に印が付く", () => {
    const { state, enemy } = setup();
    skillHit(state, enemy, { ...paramsFor("whirl"), followUp: true }, spec);
    expect(state.skills.marks.get(enemy.id)?.power).toBeCloseTo(HIT_BASE * m.followUp.powerRatio);
  });

  it("散り際: 倒すと同じスキルの予約が積まれ、1 回の発動で上限まで", () => {
    const { state, enemy } = setup();
    const params = { ...paramsFor("frag"), lastGasp: m.lastGasp.damageMul, gaspPool: { left: 1 } };
    enemy.hp = 1;
    skillHit(state, enemy, params, spec);
    expect(state.skills.gasps).toHaveLength(1);
    expect(state.skills.gasps[0]?.params.lastGasp, "写しからは起きない").toBeNull();
    const second = placeEnemy(state, "golem", 30);
    second.hp = 1;
    skillHit(state, second, params, spec);
    expect(state.skills.gasps, "上限 1").toHaveLength(1);
  });

  it("会心の確定（刺し穿ち）は critMul を掛ける", () => {
    const plain = hitDamage(paramsFor("exploit"));
    expect(hitDamage(paramsFor("exploit"), { forceCrit: true }) / plain).toBeCloseTo(DEFAULT_CRIT_MUL, 1);
  });

  it("命中した敵 id を発動の記録（hitLog）に残す", () => {
    const { state, enemy } = setup();
    const params = paramsFor("whirl");
    skillHit(state, enemy, params, spec);
    expect(params.hitLog.has(enemy.id)).toBe(true);
  });
});

const DEFAULT_CRIT_MUL = arena().stats.critMul;
