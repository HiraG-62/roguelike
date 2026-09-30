import { describe, expect, it } from "vitest";
import { type GameEvent, pushEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE, STATUS } from "../../data/tuning";
import { BOONS, BOON_ACTIONS, type BoonDef, type BoonKey } from "../boonDefs";
import { damageEnemy } from "../combat";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { applyStatus, hasStatus, statusStacks } from "../statusEffects";
import { terrainAt } from "../terrain";
import { arena, placeEnemy } from "../testHelpers";
import { BOON_KEYS_FROST } from "./frost";

/** 霜枷の札 11 枚（docs/ideas/boon-impl.md 2-6）の構成と、各札の効果が起点で起きること */

const L = BOON_LINEAGE.frost;
const NEAR = 20;
const MID = 50;
const BIG_HP = 10_000;
const CHILL_TIME = 2;

const CARDS: readonly BoonDef[] = BOON_KEYS_FROST.map((k) => BOONS[k]);

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

function chill(state: GameState, e: Enemy, stacks = 1): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks, duration: CHILL_TIME, potency: 0 }, "player");
}

function freeze(state: GameState, e: Enemy): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "freeze", stacks: 1, duration: STATUS.freeze.duration, potency: 0 }, "player");
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

/** 凍った敵を一撃で砕く（onShatter が積まれる） */
function shatter(state: GameState, e: Enemy, amount = 10): void {
  damageEnemy(state, e, amount, { x: 1, y: 0 }, 0, { kind: "melee" });
}

describe("霜枷の札の構成", () => {
  it("11 枚: 加護 5（行動が全部違う）・摂理 3・研鑽 2・真髄 1", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: BoonDef["card"]): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")], "加護 / 摂理 / 研鑽 / 真髄").toEqual([5, 3, 2, 1]);
    const actions = CARDS.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護の行動は 5 つ全部").toEqual([...BOON_ACTIONS].sort());
  });

  it("全札が系譜 frost・changes・効果を持ち、呪いではない", () => {
    for (const d of CARDS) {
      expect(d.lineage, d.key).toBe("frost");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      expect((d.rules?.length ?? 0) + (d.modifiers?.length ?? 0), `${d.key} の効果`).toBeGreaterThan(0);
      if (d.card !== "grace") expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
    }
  });
});

describe("霜枷の加護", () => {
  it("霜息: 攻撃 1 の振りの命中で冷気、攻撃 2 では付かない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.player.attack.lane = "secondary";
    fireCard(state, "frostBreath", eventOn(state, "onSwingHit", e));
    expect(hasStatus(e.status, "chill"), "攻撃 2").toBe(false);
    state.player.attack.lane = "primary";
    fireCard(state, "frostBreath", eventOn(state, "onSwingHit", e));
    expect(statusStacks(e.status, "chill"), "攻撃 1").toBe(L.frostBreath.stacks);
  });

  it("砕氷の鐘: 放出で近くの凍った敵だけを砕く", () => {
    const state = cleanArena();
    const frozen = sturdy(state, NEAR);
    const calm = sturdy(state, NEAR, 15);
    freeze(state, frozen);
    state.events = [];
    fireCard(state, "shatterBell", eventOn(state, "onRelease"));
    expect(hasStatus(frozen.status, "freeze"), "砕けた").toBe(false);
    expect(frozen.hp, "一撃").toBeLessThan(BIG_HP);
    expect(calm.hp, "凍っていない敵には当てない").toBe(BIG_HP);
    expect(state.pendingEvents.some((ev) => ev.kind === "onShatter" && ev.targetId === frozen.id), "砕きのイベント").toBe(true);
  });

  it("凍て足: ダッシュの始まりに氷床、終わりに周りの敵へ冷気", () => {
    const state = cleanArena();
    const start = { ...state.player.body.pos };
    const e = sturdy(state, NEAR);
    fireCard(state, "frostFeet", eventOn(state, "onDash"), eventOn(state, "onDashEnd"));
    expect(terrainAt(state, start.x, start.y), "氷床").toBe("ice");
    expect(hasStatus(e.status, "chill"), "冷気").toBe(true);
  });

  it("凍て刺し: スキルで砕くと周りへ冷気 2 重ね、スキル以外の砕きでは起きない", () => {
    const state = cleanArena();
    const frozen = sturdy(state, NEAR);
    const other = sturdy(state, NEAR + 20);
    fireCard(state, "frostPierce", eventOn(state, "onShatter", frozen));
    expect(hasStatus(other.status, "chill"), "スキル以外").toBe(false);
    state.time += 1;
    pushEvent(state, { kind: "onSkillHit", actor: "player", pos: { ...frozen.body.pos }, targetId: frozen.id, source: { kind: "skill", key: "test" } });
    pushEvent(state, { kind: "onShatter", actor: "player", pos: { ...frozen.body.pos }, targetId: frozen.id, source: { kind: "player", key: "shatter" } });
    resolveRules(state, 0, BOONS.frostPierce.rules ?? []);
    expect(statusStacks(other.status, "chill"), "2 重ね").toBe(L.frostPierce.stacks);
  });

  it("永冬: 奥義で周りの敵を凍結させる", () => {
    const state = cleanArena();
    const e = sturdy(state, MID);
    fireCard(state, "eternalWinter", eventOn(state, "onBurst"));
    expect(hasStatus(e.status, "freeze")).toBe(true);
  });
});

describe("霜枷の摂理", () => {
  it("氷砕: 砕きでその場から氷の破片が飛ぶ", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    const before = state.projectiles.length;
    fireCard(state, "chillShatter", eventOn(state, "onShatter", e));
    expect(state.projectiles.length - before).toBe(L.chillShatter.shards);
  });

  it("霜読み: 冷えた敵が予備動作に入ると冷気がさらに重なる", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, "frostRead", eventOn(state, "onEnemyWindup", e));
    expect(hasStatus(e.status, "chill"), "冷えていない敵").toBe(false);
    chill(state, e);
    fireCard(state, "frostRead", eventOn(state, "onEnemyWindup", e));
    expect(statusStacks(e.status, "chill")).toBe(1 + L.frostRead.stacks);
  });

  it("氷継ぎ: 冷えた敵の撃破で残りの冷気を近くの敵へ移す", () => {
    const state = cleanArena();
    const dead = sturdy(state, NEAR);
    const next = sturdy(state, NEAR + 30);
    const snap = [{ kind: "chill" as const, stacks: 2, potency: 0, time: 1.5 }];
    dead.hp = 0;
    fireCard(state, "iceRelay", eventOn(state, "onKill", dead, { targetStatus: snap }));
    expect(hasStatus(next.status, "chill")).toBe(true);
  });
});

describe("霜枷の研鑽", () => {
  it("砕片: 砕きで数え、数えにつき冷えた敵への倍", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    freeze(state, e);
    state.events = [];
    shatter(state, e);
    resolveRules(state, 0, BOONS.frostShards.rules ?? []);
    expect(state.boonRun.tallies.frostShards, "砕き 1 回").toBe(1);
    state.boonRun.tallies.frostShards = L.frostShards.every * 3;
    const cold = sturdy(state, MID);
    chill(state, cold);
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, cold, BOONS.frostShards.modifiers ?? []);
    expect(out.more[0]?.mul, "3 段").toBeCloseTo(1 + L.frostShards.perStep * 3);
  });

  it("厳寒: 自分が凍結させた回数を数え、数えにつき凍った敵への増", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    chill(state, e, STATUS.chill.maxStacks);
    expect(hasStatus(e.status, "freeze"), "冷気が満ちて凍結").toBe(true);
    resolveRules(state, 0, BOONS.frostDeep.rules ?? []);
    expect(state.boonRun.tallies.frostDeep, "凍結 1 回").toBe(1);
    state.boonRun.tallies.frostDeep = L.frostDeep.every * 2;
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, e, BOONS.frostDeep.modifiers ?? []);
    expect(out.increased, "2 段").toBeCloseTo(L.frostDeep.perStep * 2);
  });
});

describe("霜枷の真髄", () => {
  /** 凍った敵へ継続ダメージと砕く一撃を入れ、砕きの Rule を照合するまで */
  function prisonRun(hold: boolean): { enemy: Enemy; vault: number | undefined } {
    const state = cleanArena();
    if (hold) state.boons.push("frostPrison");
    const e = sturdy(state, NEAR);
    freeze(state, e);
    damageEnemy(state, e, 10, { x: 0, y: 0 }, 0, { silent: true });
    shatter(state, e, 20);
    const vault = e.vault?.amount;
    resolveRules(state, 0, BOONS.frostPrison.rules ?? []);
    return { enemy: e, vault };
  }

  it("氷獄: 凍った敵に与えた傷（継続ダメージと砕く一撃）が溜まり、砕きで倍率を掛けて一度に出る", () => {
    const held = prisonRun(true);
    const plain = prisonRun(false);
    expect(plain.vault, "持っていなければ溜めない").toBeUndefined();
    const dealt = BIG_HP - plain.enemy.hp;
    expect(held.vault, "与えた傷がそのまま溜まる").toBe(dealt);
    expect(BIG_HP - held.enemy.hp, "溜めの解放").toBeCloseTo(dealt + dealt * L.frostPrison.releaseMul, 0);
    expect(held.enemy.vault, "空になる").toBeUndefined();
  });
});

describe("霜枷の決定性", () => {
  function run(seed: number): { hp: number[]; tallies: Record<string, number>; rng: number } {
    const state = cleanArena(seed);
    state.boons.push(...BOON_KEYS_FROST);
    state.player.attack.lane = "primary";
    const enemies = [sturdy(state, NEAR), sturdy(state, NEAR + 15), sturdy(state, MID)];
    const [a, b] = enemies;
    if (a === undefined || b === undefined) throw new Error("敵が無い");
    freeze(state, b);
    state.events.push(eventOn(state, "onSwingHit", a), eventOn(state, "onRelease"), eventOn(state, "onBurst"));
    resolveRules(state, 0);
    shatter(state, a);
    resolveRules(state, 0);
    return { hp: enemies.map((e) => e.hp), tallies: { ...state.boonRun.tallies }, rng: state.rng.next() };
  }

  it("同じ seed と同じイベント列なら同じ結果", () => {
    const first = run(13);
    expect(first.hp.some((hp) => hp < BIG_HP), "何かが効いている").toBe(true);
    expect(run(13)).toEqual(first);
  });
});
