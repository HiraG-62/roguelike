import { describe, expect, it } from "vitest";
import { type EventInput, type EventKind, enemyTarget, pushEvent, pushPlayerEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE, POISE, STATUS } from "../../data/tuning";
import { BOON_ACTIONS, BOONS, type BoonKey } from "../boonDefs";
import { applyModifiers, applyPoiseModifiers } from "../modifiers";
import { type MeleeStep, releaseSlamMul } from "../player";
import { addPoise, applyStagger } from "../poise";
import { resolveRules } from "../rules";
import { findStatus, hasStatus, statusStacks } from "../statusEffects";
import { terrainAt } from "../terrain";
import { arena, placeEnemy } from "../testHelpers";
import { BOON_KEYS_EARTH, BOONS_EARTH } from "./earth";

/** 大地の札（docs/ideas/boon-impl.md 2-6）: 構成・各札の発火・研鑽の数え・決定性 */

const E = BOON_LINEAGE.earth;
const BIG_HP = 10_000;
const NEAR = 20;
const FAR = 200;
const STAGGER_TIME = 2;

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** 攻撃しない・倒れない敵 */
function dummy(state: GameState, dx = NEAR, dy = 0, key = "golem"): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function give(state: GameState, key: BoonKey): void {
  if (!state.boons.includes(key)) state.boons.push(key);
}

function fire(state: GameState, kind: EventKind, target?: Enemy, extra: Partial<EventInput> = {}): void {
  const where = target === undefined ? { pos: { ...state.player.body.pos } } : enemyTarget(target, true);
  pushEvent(state, { kind, actor: "player", source: { kind: "player", key: "test" }, ...where, ...extra });
  resolveRules(state, 0);
}

function moreOf(state: GameState, tag: "melee" | "ranged", e: Enemy): number {
  return applyModifiers(state, { tags: new Set([tag]) }, e).more.reduce((m, x) => m * x.mul, 1);
}

/** 処刑できる敵（怯み中で生命が少ない。処刑の効く種類） */
function executable(state: GameState): Enemy {
  const e = placeEnemy(state, "slime", NEAR);
  e.phase = "idle";
  applyStagger(state, e, STAGGER_TIME);
  e.hp = 1;
  return e;
}

describe("大地の札の構成", () => {
  const defs = BOON_KEYS_EARTH.map((k) => BOONS_EARTH[k]);

  it("11 枚: 加護 5（行動ごとに 1 枚）・摂理 3・研鑽 2・真髄 1", () => {
    expect(defs.length).toBe(11);
    const count = (card: string): number => defs.filter((d) => d.card === card).length;
    expect(count("grace"), "加護").toBe(5);
    expect(count("law"), "摂理").toBe(3);
    expect(count("temper"), "研鑽").toBe(2);
    expect(count("apex"), "真髄").toBe(1);
    const actions = defs.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護は行動 5 つに 1 枚ずつ").toEqual([...BOON_ACTIONS].sort());
  });

  it("全札が系譜 earth・何が変わるか・効果（rules か modifiers）を持ち、BOONS に載っている", () => {
    for (const d of defs) {
      expect(d.lineage, d.key).toBe("earth");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      expect(d.icon.length, `${d.key} のアイコンは 1 文字`).toBe(1);
      expect((d.rules?.length ?? 0) + (d.modifiers?.length ?? 0), `${d.key} の効果`).toBeGreaterThan(0);
      expect(BOONS[d.key], `${d.key} は集約の表で上書きされている`).toBe(d);
    }
  });
});

describe("大地の加護", () => {
  it("地脈: 左の連撃の命中で怯み値が入り、右では入らない", () => {
    const state = cleanArena();
    give(state, "leyLine");
    const e = dummy(state);
    state.player.attack.lane = "secondary";
    fire(state, "onSwingHit", e);
    expect(e.poise.damage, "右").toBe(0);
    state.player.attack.lane = "primary";
    fire(state, "onSwingHit", e);
    expect(e.poise.damage, "左").toBeGreaterThan(0);
  });

  it("壁際: 放出の一撃だけ吹き飛ばしが強くなる", () => {
    const state = cleanArena();
    const release = { release: true } as MeleeStep;
    const normal = { release: false } as MeleeStep;
    expect(releaseSlamMul(state, release), "持っていない").toBe(1);
    give(state, "earthWallSlam");
    expect(releaseSlamMul(state, release)).toBe(E.earthWallSlam.knockMul);
    expect(releaseSlamMul(state, normal), "放出でない").toBe(1);
  });

  it("壁際: 放出の後の壁叩きつけに追撃、放出が無ければ出ない", () => {
    const state = cleanArena();
    give(state, "earthWallSlam");
    const e = dummy(state);
    fire(state, "onWallSlam", e);
    expect(e.hp, "放出していない").toBe(BIG_HP);
    pushPlayerEvent(state, "onRelease", "morale");
    fire(state, "onWallSlam", e);
    expect(e.hp, "追撃").toBeLessThan(BIG_HP);
  });

  it("足場崩し: ダッシュを終えた足元が崩れる床になる", () => {
    const state = cleanArena();
    give(state, "footBreak");
    const p = state.player.body.pos;
    fire(state, "onDashEnd");
    expect(terrainAt(state, p.x, p.y)).toBe("rubble");
  });

  it("震撼: スキルの命中で怯み値が入る", () => {
    const state = cleanArena();
    give(state, "earthQuake");
    const e = dummy(state);
    fire(state, "onSkillHit", e);
    expect(e.poise.damage).toBeGreaterThan(0);
  });

  it("大地の怒り: 奥義で部屋の敵すべてに怯み値", () => {
    const state = cleanArena();
    give(state, "earthWrath");
    const a = dummy(state, NEAR);
    const b = dummy(state, FAR);
    fire(state, "onBurst", undefined, { room: a.roomIndex });
    expect(a.poise.damage).toBeGreaterThan(0);
    expect(b.poise.damage).toBeGreaterThan(0);
  });
});

describe("大地の摂理", () => {
  it("崩し: 怯ませた敵が脆弱になる", () => {
    const state = cleanArena();
    give(state, "crumble");
    const e = dummy(state);
    fire(state, "onStagger", e);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });

  it("力の簒奪: 処刑すると自分に怒気（与える怯み値が増える）", () => {
    const state = cleanArena();
    give(state, "usurp");
    const e = executable(state);
    addPoise(state, e, POISE.executeMinPoise, { canExecute: true });
    expect(e.executed, "処刑").toBe(true);
    resolveRules(state, 0);
    expect(statusStacks(state.player.status, "wrath"), "怒気").toBe(E.usurp.wrathStacks);
    expect(E.usurp.wrathStacks, "激昂に昇華しない数").toBeLessThan(STATUS.wrath.maxStacks);
  });

  it("領域: 近い敵には倍、遠い敵には減", () => {
    const state = cleanArena();
    give(state, "earthDomain");
    const near = dummy(state, NEAR);
    const far = dummy(state, FAR);
    expect(moreOf(state, "melee", near)).toBeCloseTo(E.earthDomain.nearMul);
    expect(moreOf(state, "ranged", far)).toBeCloseTo(E.earthDomain.farMul);
  });
});

describe("大地の研鑽", () => {
  it("斬獲: 処刑で数えが増え、every ごとに怯み値の倍が上がる", () => {
    const state = cleanArena();
    give(state, "earthTrophy");
    for (let i = 0; i < E.earthTrophy.every; i++) {
      addPoise(state, executable(state), POISE.executeMinPoise, { canExecute: true });
      resolveRules(state, 0);
    }
    expect(state.boonRun.tallies.earthTrophy, "処刑の数").toBe(E.earthTrophy.every);
    const e = dummy(state);
    const more = applyPoiseModifiers(state, e).more.reduce((m, x) => m * x.mul, 1);
    expect(more, "1 段").toBeCloseTo(1 + E.earthTrophy.amount);
  });

  it("破壁: 壁叩きつけで数えが増え、every ごとに近接の倍が上がる", () => {
    const state = cleanArena();
    give(state, "earthRampart");
    const e = dummy(state);
    for (let i = 0; i < E.earthRampart.every; i++) fire(state, "onWallSlam", e);
    expect(state.boonRun.tallies.earthRampart).toBe(E.earthRampart.every);
    expect(moreOf(state, "melee", e), "1 段").toBeCloseTo(1 + E.earthRampart.amount);
    expect(moreOf(state, "ranged", e), "射撃には効かない").toBe(1);
  });
});

describe("大地の真髄: 激震", () => {
  it("怯んだ敵を倒すと周りの敵が怯み、衝撃波が当たる。怯んでいない敵の撃破では起きない", () => {
    const state = cleanArena();
    give(state, "earthTremor");
    const victim = dummy(state, NEAR);
    const other = dummy(state, NEAR, NEAR);
    fire(state, "onKill", victim);
    expect(hasStatus(other.status, "stagger"), "怯んでいない敵の撃破").toBe(false);
    applyStagger(state, victim, STAGGER_TIME);
    fire(state, "onKill", victim);
    expect(hasStatus(other.status, "stagger"), "周りが怯む").toBe(true);
    expect(findStatus(other.status, "stagger")?.time ?? 0).toBeGreaterThan(0);
    expect(other.hp, "衝撃波").toBeLessThan(BIG_HP);
  });
});

describe("大地の決定性", () => {
  function run(seed: number): { tallies: Record<string, number>; poise: number; hp: number; rng: number } {
    const state = cleanArena(seed);
    for (const k of ["leyLine", "earthTrophy", "earthRampart", "earthTremor", "crumble"] as const) give(state, k);
    const e = dummy(state);
    state.player.attack.lane = "primary";
    fire(state, "onSwingHit", e);
    fire(state, "onWallSlam", e);
    const victim = executable(state);
    addPoise(state, victim, POISE.executeMinPoise, { canExecute: true });
    resolveRules(state, 0);
    resolveRules(state, 0);
    return { tallies: { ...state.boonRun.tallies }, poise: e.poise.damage, hp: e.hp, rng: state.rng.next() };
  }

  it("同じ seed なら同じ数え・怯み値・生命・乱数列", () => {
    const a = run(13);
    expect(a.tallies.earthTrophy, "処刑を数える").toBe(1);
    expect(a).toEqual(run(13));
  });
});
