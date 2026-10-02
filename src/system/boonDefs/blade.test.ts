import { describe, expect, it } from "vitest";
import { type EventInput, type EventKind, enemyTarget, pushEvent, pushPlayerEvent } from "../../core/events";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE, FEEL, PLAYER } from "../../data/tuning";
import { BOON_ACTIONS, BOONS, type BoonKey } from "../boonDefs";
import { updateBoonRules } from "../boonRules";
import { boonSwingCombo, comboAfterHurt, grantBoon, onBoonDash } from "../boons";
import { registerComboHit } from "../combat";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { arena, placeEnemy } from "../testHelpers";
import { BOON_KEYS_BLADE, BOONS_BLADE } from "./blade";

/** 刃鳴の札（docs/ideas/boon-impl.md 2-6）: 構成・各札の発火・研鑽の数え・決定性 */

const B = BOON_LINEAGE.blade;
const BIG_HP = 10_000;
const NEAR = 20;
const DASH_TIME = 0.2;
const LAST_COMBO = PLAYER.melee.length - 1;

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** 攻撃しない・倒れない敵 */
function dummy(state: GameState, dx = NEAR, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
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

function playerShots(state: GameState): number {
  return state.projectiles.filter((p) => p.owner === "player").length;
}

describe("刃鳴の札の構成", () => {
  const defs = BOON_KEYS_BLADE.map((k) => BOONS_BLADE[k]);

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

  it("全札が系譜 blade・何が変わるか・1 文字のアイコンを持ち、BOONS に載っている", () => {
    for (const d of defs) {
      expect(d.lineage, d.key).toBe("blade");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      expect(d.icon.length, `${d.key} のアイコンは 1 文字`).toBe(1);
      expect(BOONS[d.key], `${d.key} は集約の表で上書きされている`).toBe(d);
    }
  });
});

describe("刃鳴の加護", () => {
  it("重ね刃: 左の連撃の命中に分身の追撃、右では出ない", () => {
    const state = cleanArena();
    give(state, "layeredEdge");
    const e = dummy(state);
    state.player.attack.lane = "secondary";
    fire(state, "onSwingHit", e);
    expect(e.hp, "右").toBe(BIG_HP);
    state.player.attack.lane = "primary";
    fire(state, "onSwingHit", e);
    expect(e.hp, "左").toBeLessThan(BIG_HP);
  });

  it("断裂波: 放出で衝撃波", () => {
    const state = cleanArena();
    give(state, "finisherWave");
    const before = playerShots(state);
    fire(state, "onRelease");
    expect(playerShots(state)).toBe(before + 1);
  });

  it("抜き胴: ダッシュですり抜けた敵を 1 度だけ斬る（旧フックの経路）", () => {
    const state = cleanArena();
    give(state, "passCut");
    const e = dummy(state, 0);
    state.player.dashTimer = DASH_TIME;
    onBoonDash(state);
    updateBoonRules(state, FIXED_DT);
    const after = e.hp;
    expect(after, "斬る").toBeLessThan(BIG_HP);
    updateBoonRules(state, FIXED_DT);
    expect(e.hp, "同じダッシュでは 1 度だけ").toBe(after);
  });

  it("重畳: スキルの命中に追撃が 2 回重なる", () => {
    const state = cleanArena();
    give(state, "bladeLayered");
    const e = dummy(state);
    fire(state, "onSkillHit", e);
    const once = BIG_HP - e.hp;
    expect(once, "追撃").toBeGreaterThan(0);
    const strikes = BOONS.bladeLayered.rules?.filter((r) => r.when === "onSkillHit" && r.then.kind === "strike").length;
    expect(strikes, "2 回").toBe(2);
  });

  it("百刃: 奥義の後だけ、振りの命中に分身の追撃", () => {
    const state = cleanArena();
    give(state, "hundredBlades");
    const e = dummy(state);
    fire(state, "onSwingHit", e);
    expect(e.hp, "奥義の前").toBe(BIG_HP);
    pushPlayerEvent(state, "onBurst", "burst");
    fire(state, "onSwingHit", e);
    expect(e.hp, "奥義の後").toBeLessThan(BIG_HP);
    state.time += B.hundredBlades.window + 1;
    const hp = e.hp;
    state.ruleIcd.clear();
    fire(state, "onSwingHit", e);
    expect(e.hp, "window を過ぎたら出ない").toBe(hp);
  });
});

describe("刃鳴の摂理", () => {
  it("専心: 振りが常に最終段（ダッシュ攻撃は除く）", () => {
    const state = cleanArena();
    expect(boonSwingCombo(state, 0, false), "持っていない").toBe(0);
    give(state, "finisherOnly");
    expect(boonSwingCombo(state, 0, false)).toBe(LAST_COMBO);
    expect(boonSwingCombo(state, 0, true), "ダッシュ攻撃").toBe(0);
  });

  it("双撃波: 双撃で衝撃波", () => {
    const state = cleanArena();
    give(state, "bladeTwinWave");
    const e = dummy(state);
    const before = playerShots(state);
    fire(state, "onTwinStrike", e, { tag: "secondary" });
    expect(playerShots(state)).toBe(before + 1);
  });

  it("連撃波: コンボが every の倍数に届いた時だけ衝撃波", () => {
    const state = cleanArena();
    give(state, "comboWave");
    const before = playerShots(state);
    fire(state, "onComboHit", undefined, { amount: B.comboWave.every - 1 });
    expect(playerShots(state), "届いていない").toBe(before);
    fire(state, "onComboHit", undefined, { amount: B.comboWave.every });
    expect(playerShots(state), "届いた").toBe(before + 1);
  });
});

describe("刃鳴の研鑽", () => {
  it("連綿: コンボを伸ばすと最高記録が残り、every ごとに近接の増", () => {
    const state = cleanArena();
    give(state, "bladeStreak");
    for (let i = 0; i < B.bladeStreak.every * 2; i++) registerComboHit(state);
    resolveRules(state, 0);
    expect(state.boonRun.tallies.bladeStreak, "最大コンボ").toBe(B.bladeStreak.every * 2);
    state.combo.count = 0;
    registerComboHit(state);
    resolveRules(state, 0);
    expect(state.boonRun.tallies.bladeStreak, "小さいコンボで下がらない").toBe(B.bladeStreak.every * 2);
    const e = dummy(state);
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, e);
    expect(out.increased, "2 段").toBeCloseTo(B.bladeStreak.amount * 2);
  });

  it("影打: 撃破を数え、every 体ごとに追撃が 1 本ずつ増える（最大 max）", () => {
    const hitDamage = (kills: number): number => {
      const state = cleanArena();
      give(state, "bladeShadow");
      const e = dummy(state);
      for (let i = 0; i < kills; i++) fire(state, "onKill", e);
      expect(state.boonRun.tallies.bladeShadow ?? 0, "撃破の数").toBe(kills);
      fire(state, "onSwingHit", e);
      return BIG_HP - e.hp;
    };
    const one = hitDamage(B.bladeShadow.every);
    expect(hitDamage(B.bladeShadow.every - 1), "数えが足りない").toBe(0);
    expect(one, "1 体").toBeGreaterThan(0);
    expect(hitDamage(B.bladeShadow.every * B.bladeShadow.max), "最大").toBe(one * B.bladeShadow.max);
    expect(hitDamage(B.bladeShadow.every * (B.bladeShadow.max + 2)), "上限").toBe(one * B.bladeShadow.max);
  });
});

describe("刃鳴の真髄: 不断", () => {
  it("取った時からコンボの猶予が延び、被弾では半分残る", () => {
    const state = cleanArena();
    const base = state.stats.comboWindowBonus;
    grantBoon(state, "comboKeeper");
    expect(state.stats.comboWindowBonus - base, "猶予が延びる").toBeCloseTo(B.comboKeeper.windowBonus);
    registerComboHit(state);
    expect(state.combo.timer, "時間では切れない").toBeGreaterThan(FEEL.comboWindow + B.comboKeeper.windowBonus / 2);
    state.combo.count = 10;
    expect(comboAfterHurt(state), "被弾で半分").toBe(5);
  });
});

describe("刃鳴の決定性", () => {
  function run(seed: number): { tallies: Record<string, number>; hp: number; shots: number; rng: number } {
    const state = cleanArena(seed);
    for (const k of ["layeredEdge", "bladeStreak", "bladeShadow", "comboWave", "comboKeeper"] as const) give(state, k);
    const e = dummy(state);
    state.player.attack.lane = "primary";
    for (let i = 0; i < B.comboWave.every; i++) registerComboHit(state);
    resolveRules(state, 0);
    for (let i = 0; i < B.bladeShadow.every; i++) fire(state, "onKill", e);
    fire(state, "onSwingHit", e);
    return { tallies: { ...state.boonRun.tallies }, hp: e.hp, shots: playerShots(state), rng: state.rng.next() };
  }

  it("同じ seed なら同じ数え・生命・弾・乱数列", () => {
    const a = run(17);
    expect(a.tallies.bladeStreak, "コンボを数える").toBe(B.comboWave.every);
    expect(a).toEqual(run(17));
  });
});
