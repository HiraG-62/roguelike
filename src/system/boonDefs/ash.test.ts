import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE } from "../../data/tuning";
import { BOONS, BOON_ACTIONS, type BoonDef, type BoonKey } from "../boonDefs";
import { foldBoonStats } from "../boons";
import { damageEnemy } from "../combat";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { applyStatus, findStatus, hasStatus, statusStacks } from "../statusEffects";
import { terrainAt } from "../terrain";
import { arena, placeEnemy } from "../testHelpers";
import { BOON_KEYS_ASH } from "./ash";

/** 灰燼の札 11 枚（docs/ideas/boon-impl.md 2-6）の構成と、各札の効果が起点で起きること */

const L = BOON_LINEAGE.ash;
const NEAR = 20;
const MID = 50;
const BIG_HP = 10_000;
const BURN_DPS = 5;
const BURN_TIME = 3;

const CARDS: readonly BoonDef[] = BOON_KEYS_ASH.map((k) => BOONS[k]);

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function sturdy(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "slime", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

function burn(state: GameState, e: Enemy, stacks = 1): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks, duration: BURN_TIME, potency: BURN_DPS }, "player");
}

/** 対象つきのイベント（対象が無ければ自分の位置）。撃破は倒れた瞬間の状態異常を写す */
function eventOn(state: GameState, kind: GameEvent["kind"], target?: Enemy, extra: Partial<GameEvent> = {}): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return { kind, actor: "player", pos, depth: 0, source: { kind: "player", key: "test" }, ...(target ? { targetId: target.id } : {}), ...extra };
}

/** 倒れた敵の写し（燃焼 stacks 重ね） */
function burntKill(state: GameState, at: Enemy, stacks = 1): GameEvent {
  const snap = [{ kind: "burn" as const, stacks, potency: BURN_DPS, time: BURN_TIME }];
  return eventOn(state, "onKill", undefined, { pos: { ...at.body.pos }, targetStatus: snap });
}

/** その札の Rule だけで照合する（旧フックや他の札を混ぜない） */
function fireCard(state: GameState, key: BoonKey, ...events: GameEvent[]): void {
  state.events.push(...events);
  resolveRules(state, 0, BOONS[key].rules ?? []);
}

describe("灰燼の札の構成", () => {
  it("11 枚: 加護 5（行動が全部違う）・摂理 3・研鑽 2・真髄 1", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: BoonDef["card"]): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")], "加護 / 摂理 / 研鑽 / 真髄").toEqual([5, 3, 2, 1]);
    const actions = CARDS.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護の行動は 5 つ全部").toEqual([...BOON_ACTIONS].sort());
  });

  it("全札が系譜 ash・changes・効果（Rule か Modifier か研鑽の stats）を持ち、呪いではない", () => {
    for (const d of CARDS) {
      expect(d.lineage, d.key).toBe("ash");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      const effects = (d.rules?.length ?? 0) + (d.modifiers?.length ?? 0) + (d.temperStat ? 1 : 0);
      expect(effects, `${d.key} の効果`).toBeGreaterThan(0);
      if (d.card !== "grace") expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
    }
  });

  it("研鑽は数えの Rule を持ち、格を持たない", () => {
    for (const d of CARDS.filter((x) => x.card === "temper")) {
      expect(d.rules?.some((r) => r.then.kind === "tally"), `${d.key} の数え`).toBe(true);
      expect(d.graded, d.key).toBe(false);
    }
  });
});

describe("灰燼の加護", () => {
  it("火種: 攻撃 1 の終撃で燃焼、攻撃 2 では付かない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.player.attack.lane = "secondary";
    fireCard(state, "emberSeed", eventOn(state, "onFinisher", e));
    expect(hasStatus(e.status, "burn"), "攻撃 2").toBe(false);
    state.player.attack.lane = "primary";
    fireCard(state, "emberSeed", eventOn(state, "onFinisher", e));
    expect(findStatus(e.status, "burn")?.time, "持続").toBeCloseTo(L.emberSeed.duration);
  });

  it("炎陣: 放出で足元に炎、炎の上に立つ間だけ与ダメの増", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    const mods = BOONS.ashCircle.modifiers ?? [];
    const before = applyModifiers(state, { tags: new Set(["melee"]) }, e, mods).increased;
    expect(before, "炎の外").toBe(0);
    const p = state.player.body.pos;
    fireCard(state, "ashCircle", eventOn(state, "onRelease"));
    expect(terrainAt(state, p.x, p.y), "足元").toBe("fire");
    expect(applyModifiers(state, { tags: new Set(["melee"]) }, e, mods).increased, "炎の上").toBeCloseTo(L.ashCircle.increased);
  });

  it("火渡り: ダッシュの始まりの場所に炎を置き、終わりの足元には置かない", () => {
    const state = cleanArena();
    const start = { ...state.player.body.pos };
    const end = { x: start.x + 40, y: start.y };
    fireCard(state, "fireWalk", eventOn(state, "onDash"), eventOn(state, "onDashEnd", undefined, { pos: end }));
    expect(terrainAt(state, start.x, start.y), "始まり").toBe("fire");
    expect(terrainAt(state, end.x, end.y), "終わり").toBe("none");
  });

  it("火柱: スキルの命中で燃焼、燃えている敵なら爆発が周りに届く", () => {
    const state = cleanArena();
    const target = sturdy(state, NEAR);
    const other = sturdy(state, NEAR + 10);
    fireCard(state, "firePillar", eventOn(state, "onSkillHit", target));
    expect(hasStatus(target.status, "burn"), "燃焼").toBe(true);
    expect(other.hp, "爆発").toBeLessThan(BIG_HP);
  });

  it("焦土: 奥義で燃焼を起爆して即座にダメージ、燃焼は消える", () => {
    const state = cleanArena();
    const e = sturdy(state, MID);
    burn(state, e);
    fireCard(state, "scorchedEarth", eventOn(state, "onBurst"));
    expect(hasStatus(e.status, "burn"), "消える").toBe(false);
    expect(e.hp, "起爆").toBeLessThan(BIG_HP);
  });
});

describe("灰燼の摂理", () => {
  it("延焼: 燃えている敵に当てると近くの敵へ燃焼が移り、燃えていなければ移らない", () => {
    const state = cleanArena();
    const target = sturdy(state, NEAR);
    const other = sturdy(state, NEAR + 15);
    fireCard(state, "wildfire", eventOn(state, "onMeleeHit", target));
    expect(hasStatus(other.status, "burn"), "燃えていない").toBe(false);
    burn(state, target);
    fireCard(state, "wildfire", eventOn(state, "onRangedHit", target));
    expect(hasStatus(other.status, "burn"), "移る").toBe(true);
  });

  it("野火: 燃えている敵の撃破で周りへ燃焼を重ねごと移す", () => {
    const state = cleanArena();
    const dead = sturdy(state, NEAR);
    const other = sturdy(state, NEAR + 20);
    fireCard(state, "burnSpread", burntKill(state, dead, 2));
    expect(statusStacks(other.status, "burn"), "2 重ね").toBe(2);
  });

  it("燠火: 燃えている敵の撃破でその場に炎が残る", () => {
    const state = cleanArena();
    const dead = sturdy(state, NEAR);
    const at = { ...dead.body.pos };
    fireCard(state, "embers", burntKill(state, dead));
    expect(terrainAt(state, at.x, at.y)).toBe("fire");
  });
});

describe("灰燼の研鑽", () => {
  it("余燼: 燃えている敵を倒すと数え、数えにつき燃えている敵への倍", () => {
    const state = cleanArena();
    const victim = placeEnemy(state, "slime", NEAR);
    burn(state, victim);
    state.events = [];
    damageEnemy(state, victim, BIG_HP, { x: 1, y: 0 }, 0);
    expect(victim.hp, "倒れた").toBeLessThanOrEqual(0);
    resolveRules(state, 0, BOONS.ashCinder.rules ?? []);
    expect(state.boonRun.tallies.ashCinder, "撃破で 1").toBe(1);

    state.boonRun.tallies.ashCinder = L.ashCinder.every * 2;
    const mods = BOONS.ashCinder.modifiers ?? [];
    const hot = sturdy(state, MID);
    const cold = sturdy(state, MID, 20);
    burn(state, hot);
    expect(applyModifiers(state, { tags: new Set(["melee"]) }, hot, mods).more[0]?.mul, "2 段").toBeCloseTo(1 + L.ashCinder.perStep * 2);
    expect(applyModifiers(state, { tags: new Set(["melee"]) }, cold, mods).more.length, "燃えていない敵").toBe(0);
  });

  it("火勢: 自分が付けた燃焼を数え（地形の燃焼は数えない）、段ごとに状態異常の強さが上がる", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    burn(state, e);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: BURN_TIME, potency: BURN_DPS }, "env");
    resolveRules(state, 0, BOONS.ashBlaze.rules ?? []);
    expect(state.boonRun.tallies.ashBlaze, "自分の 1 回だけ").toBe(1);
    const base = foldBoonStats(state.stats, ["ashBlaze"], { ...state.boonRun, tallies: {} }).statusPotencyMul;
    const grown = foldBoonStats(state.stats, ["ashBlaze"], { ...state.boonRun, tallies: { ashBlaze: L.ashBlaze.every * 3 } }).statusPotencyMul;
    expect(grown - base, "3 段").toBeCloseTo(L.ashBlaze.perStep * 3);
  });
});

describe("灰燼の真髄", () => {
  it("劫火: 燃焼の重ねにつく倍と、撃破で広い範囲へ燃焼を移す", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    const stacks = 3;
    burn(state, e, stacks);
    const more = applyModifiers(state, { tags: new Set(["melee"]) }, e, BOONS.ashInferno.modifiers ?? []).more[0]?.mul;
    expect(more, "3 重ね").toBeCloseTo(1 + L.ashInferno.stackMore * stacks);

    const far = sturdy(state, NEAR + L.ashInferno.radius - 10);
    fireCard(state, "ashInferno", burntKill(state, e, 2));
    expect(statusStacks(far.status, "burn"), "野火より遠くへ 2 重ね").toBe(2);
  });
});

describe("灰燼の決定性", () => {
  function run(seed: number): { hp: number[]; tallies: Record<string, number>; rng: number } {
    const state = cleanArena(seed);
    state.boons.push(...BOON_KEYS_ASH);
    state.player.attack.lane = "primary";
    const enemies = [sturdy(state, NEAR), sturdy(state, NEAR + 15), sturdy(state, MID)];
    const [a, b] = enemies;
    if (a === undefined || b === undefined) throw new Error("敵が無い");
    state.events.push(eventOn(state, "onFinisher", a), eventOn(state, "onSkillHit", b), eventOn(state, "onRelease"), eventOn(state, "onBurst"));
    resolveRules(state, 0);
    state.events.push(eventOn(state, "onMeleeHit", a));
    resolveRules(state, 0);
    return { hp: enemies.map((e) => e.hp), tallies: { ...state.boonRun.tallies }, rng: state.rng.next() };
  }

  it("同じ seed と同じイベント列なら同じ結果", () => {
    const first = run(13);
    expect(first.hp.some((hp) => hp < BIG_HP), "何かが効いている").toBe(true);
    expect(run(13)).toEqual(first);
  });
});
