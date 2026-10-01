import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE, STATUS } from "../../data/tuning";
import { BOONS, BOON_ACTIONS, type BoonDef, type BoonKey } from "../boonDefs";
import { foldBoonStats, grantBoon } from "../boons";
import { applyModifiers } from "../modifiers";
import { addPoise } from "../poise";
import { resolveRules } from "../rules";
import { applyStatus, chainLightning, hasStatus, statusStacks } from "../statusEffects";
import { arena, placeEnemy } from "../testHelpers";
import { BOON_KEYS_THUNDER } from "./thunder";

/** 雷鳴の札 11 枚（docs/ideas/boon-impl.md 2-6）の構成と、各札の効果が起点で起きること */

const L = BOON_LINEAGE.thunder;
const NEAR = 20;
const HOP = 30;
const BIG_HP = 10_000;
const SHOCK_TIME = 2;
const CHAIN_DAMAGE = 10;

const CARDS: readonly BoonDef[] = BOON_KEYS_THUNDER.map((k) => BOONS[k]);

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

function shock(state: GameState, e: Enemy, source: "player" | "env" = "player"): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "shock", stacks: 1, duration: SHOCK_TIME, potency: 1 }, source);
}

function eventOn(state: GameState, kind: GameEvent["kind"], target?: Enemy, extra: Partial<GameEvent> = {}): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return { kind, actor: "player", pos, depth: 0, source: { kind: "player", key: "test" }, ...(target ? { targetId: target.id } : {}), ...extra };
}

/** その札の Rule だけで照合する（旧フックや他の札を混ぜない） */
function fireCard(state: GameState, key: BoonKey, ...events: GameEvent[]): void {
  state.events.push(...events);
  resolveRules(state, 0, BOONS[key].rules ?? []);
}

/** 対象と、連鎖が跳ぶ先の 2 体 */
function pair(state: GameState): { target: Enemy; next: Enemy } {
  return { target: sturdy(state, NEAR), next: sturdy(state, NEAR + HOP) };
}

describe("雷鳴の札の構成", () => {
  it("11 枚: 加護 5（行動が全部違う）・摂理 3・研鑽 2・真髄 1", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: BoonDef["card"]): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")], "加護 / 摂理 / 研鑽 / 真髄").toEqual([5, 3, 2, 1]);
    const actions = CARDS.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護の行動は 5 つ全部").toEqual([...BOON_ACTIONS].sort());
  });

  it("全札が系譜 thunder・changes・効果を持ち、呪いではない", () => {
    for (const d of CARDS) {
      expect(d.lineage, d.key).toBe("thunder");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      expect((d.rules?.length ?? 0) + (d.modifiers?.length ?? 0) + (d.temperStat ? 1 : 0) + (d.addStats ? 1 : 0), `${d.key} の効果`).toBeGreaterThan(0);
      if (d.card !== "grace") expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
    }
  });
});

describe("雷鳴の加護", () => {
  it("帯電の刃: 攻撃 1 の振りの命中で、対象から隣の敵へ雷が跳ぶ（対象には当てない）", () => {
    const state = cleanArena();
    const { target, next } = pair(state);
    state.player.attack.lane = "secondary";
    fireCard(state, "chargedBlade", eventOn(state, "onSwingHit", target));
    expect(next.hp, "攻撃 2").toBe(BIG_HP);
    state.player.attack.lane = "primary";
    fireCard(state, "chargedBlade", eventOn(state, "onSwingHit", target));
    expect(next.hp, "跳んだ先").toBeLessThan(BIG_HP);
    expect(target.hp, "対象には当てない").toBe(BIG_HP);
  });

  it("雷落とし: 応手で相手に雷が落ち、感電を付ける", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, "boltDrop", eventOn(state, "onRiposte", e));
    expect(e.hp, "落雷").toBeLessThan(BIG_HP);
    expect(statusStacks(e.status, "shock"), "感電").toBe(L.boltDrop.stacks);
  });

  it("静電気: ダッシュの終わりに自分から雷が跳ぶ", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, "staticDash", eventOn(state, "onDashEnd"));
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("雷跳ね: スキルの命中で対象から隣の敵へ雷が跳ぶ", () => {
    const state = cleanArena();
    const { target, next } = pair(state);
    fireCard(state, "thunderLeap", eventOn(state, "onSkillHit", target));
    expect(next.hp).toBeLessThan(BIG_HP);
  });

  it("雷神の鼓: 奥義で周りの敵すべてに感電を重ね、雷を放つ", () => {
    const state = cleanArena();
    const a = sturdy(state, NEAR);
    const b = sturdy(state, -NEAR * 2);
    fireCard(state, "thunderDrum", eventOn(state, "onBurst"));
    for (const e of [a, b]) expect(statusStacks(e.status, "shock"), "感電").toBe(L.thunderDrum.stacks);
    expect(a.hp, "近い敵に雷").toBeLessThan(BIG_HP);
  });
});

describe("雷鳴の摂理", () => {
  it("会心雷撃: 会心の一撃で対象から雷が跳ぶ", () => {
    const state = cleanArena();
    const { target, next } = pair(state);
    fireCard(state, "critChain", eventOn(state, "onCrit", target, { amount: 40 }));
    expect(next.hp).toBeLessThan(BIG_HP);
  });

  it("落雷予告: 自分が麻痺させた敵に雷が落ち、地形の麻痺では落ちない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "paralyze", stacks: 1, duration: 1, potency: 0 }, "env");
    resolveRules(state, 0, BOONS.thunderMark.rules ?? []);
    expect(e.hp, "地形").toBe(BIG_HP);
    const other = sturdy(state, -NEAR);
    for (let i = 0; i < STATUS.shock.maxStacks; i++) shock(state, other);
    expect(hasStatus(other.status, "paralyze"), "感電が満ちて麻痺").toBe(true);
    resolveRules(state, 0, BOONS.thunderMark.rules ?? []);
    expect(other.hp, "落雷").toBeLessThan(BIG_HP);
  });

  it("崩雷: 敵を怯ませると、その敵から雷が跳ぶ", () => {
    const state = cleanArena();
    const { target, next } = pair(state);
    addPoise(state, target, target.poise.max * 2);
    expect(state.events.some((ev) => ev.kind === "onStagger"), "怯み").toBe(true);
    resolveRules(state, 0, BOONS.collapseChain.rules ?? []);
    expect(next.hp).toBeLessThan(BIG_HP);
  });
});

describe("雷鳴の研鑽", () => {
  it("連雷: 感電した敵の撃破を数え、段ごとに連鎖係数が上がる", () => {
    const state = cleanArena();
    const snap = [{ kind: "shock" as const, stacks: 1, potency: 1, time: 1 }];
    const kills = 3;
    for (let i = 0; i < kills; i++) state.events.push(eventOn(state, "onKill", undefined, { targetStatus: snap }));
    state.events.push(eventOn(state, "onKill"));
    resolveRules(state, 0, BOONS.thunderLink.rules ?? []);
    expect(state.boonRun.tallies.thunderLink, "感電した敵だけ").toBe(kills);
    const grown = foldBoonStats(state.stats, ["thunderLink"], { ...state.boonRun, tallies: { thunderLink: L.thunderLink.every * 2 } });
    expect(grown.chainCoefBonus - state.stats.chainCoefBonus, "2 段").toBeCloseTo(L.thunderLink.perStep * 2);
  });

  it("蓄電: 自分が付けた感電を数え、数えにつき感電した敵への倍", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    shock(state, e);
    shock(state, e, "env");
    resolveRules(state, 0, BOONS.thunderCharge.rules ?? []);
    expect(state.boonRun.tallies.thunderCharge, "自分の 1 回だけ").toBe(1);
    state.boonRun.tallies.thunderCharge = L.thunderCharge.every * 4;
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, e, BOONS.thunderCharge.modifiers ?? []);
    expect(out.more[0]?.mul, "4 段").toBeCloseTo(1 + L.thunderCharge.perStep * 4);
  });
});

describe("雷鳴の真髄", () => {
  it("還雷: 取った時から連鎖が同じ敵へ戻れる回数が増える", () => {
    const state = cleanArena();
    expect(state.stats.chainRevisits, "取る前").toBe(0);
    grantBoon(state, "thunderReturn");
    expect(state.stats.chainRevisits, "戻れる回数").toBe(L.thunderReturn.revisits);
  });

  /** 起点の敵から 2 体へ連鎖させ、各敵の減った生命を返す */
  function chainOnce(revisits: number): number[] {
    const state = cleanArena();
    state.stats.chainRevisits = revisits;
    const origin = sturdy(state, NEAR);
    const first = sturdy(state, NEAR + HOP);
    const second = sturdy(state, NEAR + HOP * 2);
    chainLightning(state, origin.body.pos, CHAIN_DAMAGE, origin.id, { maxTargets: 2 });
    return [origin, first, second].map((e) => BIG_HP - e.hp);
  }

  it("連鎖する雷は戻れる回数が 1 以上なら最後の敵から来た道を戻る（起点の敵まで）", () => {
    const [originPlain, firstPlain, secondPlain] = chainOnce(0);
    const [originBack, firstBack, secondBack] = chainOnce(1);
    expect(originPlain, "戻らなければ起点には当たらない").toBe(0);
    expect(originBack, "起点へ戻る").toBeGreaterThan(0);
    expect(firstBack, "途中の敵は 2 回").toBeGreaterThan(firstPlain ?? 0);
    expect(secondBack, "最後の敵は 1 回のまま").toBe(secondPlain);
  });
});

describe("雷鳴の決定性", () => {
  function run(seed: number): { hp: number[]; tallies: Record<string, number>; rng: number } {
    const state = cleanArena(seed);
    state.boons.push(...BOON_KEYS_THUNDER);
    state.player.attack.lane = "primary";
    const enemies = [sturdy(state, NEAR), sturdy(state, NEAR + HOP), sturdy(state, -NEAR)];
    const [a] = enemies;
    if (a === undefined) throw new Error("敵が無い");
    state.events.push(eventOn(state, "onComboHit"), eventOn(state, "onSwingHit", a), eventOn(state, "onBurst"), eventOn(state, "onDashEnd"));
    resolveRules(state, 0);
    state.events.push(eventOn(state, "onCrit", a, { amount: 30 }));
    resolveRules(state, 0);
    return { hp: enemies.map((e) => e.hp), tallies: { ...state.boonRun.tallies }, rng: state.rng.next() };
  }

  it("同じ seed と同じイベント列なら同じ結果", () => {
    const first = run(13);
    expect(first.hp.some((hp) => hp < BIG_HP), "何かが効いている").toBe(true);
    expect(run(13)).toEqual(first);
  });
});
