import { describe, expect, it } from "vitest";
import type { EventKind, GameEvent } from "../../core/events";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE } from "../../data/tuning";
import { stoneFromSeed } from "../../skills/generator";
import { updatePlacedSkills } from "../../skills/placed";
import { onTurretShoot, placeKeg, placeTurret } from "../../skills/summons";
import type { CastParams } from "../../skills/types";
import { BOON_ACTIONS, type BoonDef } from "../boonDefs";
import { updateEnemies } from "../enemies";
import { applyModifiers } from "../modifiers";
import { applyStagger } from "../poise";
import { focusTarget, isAllied, resolveRules } from "../rules";
import { skillHit } from "../../skills/hit";
import { updateBoons } from "../boons";
import { applyStatus, chainLightning, hasStatus } from "../statusEffects";
import { createSkillRunState, resolveSlot, updateSkills } from "../skills";
import { arena, placeEnemy, withInput } from "../testHelpers";
import { BOONS_HORDE, BOON_KEYS_HORDE, HORDE_TALLY, STAKE_TALLY } from "./horde";

/** 眷属の 11 枚（docs/ideas/boon-impl.md 2-6）の構成、各札の効果、従魔の AI の検査 */

const H = BOON_LINEAGE.horde;
const CARDS: readonly BoonDef[] = BOON_KEYS_HORDE.map((k) => BOONS_HORDE[k]);
const NEAR = 20;
/** 開始部屋の中に収まる距離 */
const FAR = 60;
const BIG_HP = 10_000;
const LONG = 999;

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey: "commonWhirl" }), variants: [], links: 0 };
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id, null, null, null], stones: [stone] });
  updateSkills(state, withInput({}), 0);
  return state;
}

function params(state: GameState): CastParams {
  const p = resolveSlot(state, 0)?.params;
  if (!p) throw new Error("石が無い");
  return p;
}

function sturdy(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "slime", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.attackCooldown = LONG;
  return e;
}

function eventOf(state: GameState, kind: EventKind, target?: Enemy): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return { kind, actor: "player", pos, depth: 0, source: { kind: "player", key: "test" }, ...(target ? { targetId: target.id } : {}) };
}

function fireCard(state: GameState, def: BoonDef, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, def.rules ?? []);
}

function kegAt(state: GameState, dx: number, dy = 0): void {
  const p = state.player.body.pos;
  placeKeg(state, { x: p.x + dx, y: p.y + dy }, params(state));
}

describe("眷属の札の構成", () => {
  it("11 枚: 加護 5（行動ごとに 1 枚）・摂理 3・研鑽 2・真髄 1、全て眷属", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: string): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")]).toEqual([5, 3, 2, 1]);
    expect(CARDS.filter((d) => d.card === "grace").map((d) => d.action).sort()).toEqual([...BOON_ACTIONS].sort());
    for (const d of CARDS) {
      expect(d.lineage, `${d.key}`).toBe("horde");
      expect(d.changes, `${d.key}`).toBeDefined();
      expect(d.keywords, `${d.key}`).toBeDefined();
    }
  });

  it("研鑽は数え（tally）と per tally を持つ", () => {
    for (const d of CARDS.filter((x) => x.card === "temper")) {
      expect((d.rules ?? []).some((r) => r.then.kind === "tally"), `${d.key} の数え`).toBe(true);
      expect((d.modifiers ?? []).some((m) => m.per?.count.kind === "tally"), `${d.key} の読み手`).toBe(true);
    }
  });
});

describe("眷属の札の効果", () => {
  it("采配: 左の命中で従魔・砲台の狙いがその敵へ向く", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.player.attack.lane = "primary";
    fireCard(state, BOONS_HORDE.rallyCall, eventOf(state, "onSwingHit", e));
    expect(focusTarget(state)?.id).toBe(e.id);
  });

  it("供物: 戦意を使うと最も近い設置物が爆ぜる", () => {
    const state = cleanArena();
    kegAt(state, NEAR);
    const e = sturdy(state, NEAR + 4);
    fireCard(state, BOONS_HORDE.offering, eventOf(state, "onRelease"));
    expect(state.skills.kegs.length, "爆ぜて消える").toBe(0);
    expect(e.hp, "爆風").toBeLessThan(BIG_HP);
  });

  it("歩く杭: ダッシュを終えた次のステップで最も近い設置物が足元へ移る。持っていなければ動かない", () => {
    const state = cleanArena();
    kegAt(state, FAR);
    kegAt(state, FAR * 2);
    const p = state.player.body.pos;
    const dashEnd = (s: GameState): void => {
      s.recent.onDashEnd = { lastTime: s.time, count: 1 };
      s.time += FIXED_DT;
      updatePlacedSkills(s, FIXED_DT);
    };
    dashEnd(state);
    expect(state.skills.kegs[0]?.pos.x, "持っていない").toBeCloseTo(p.x + FAR);
    state.boons.push("walkingStake");
    dashEnd(state);
    expect(state.skills.kegs[0]?.pos, "近い方が足元へ").toEqual({ ...p });
    expect(state.skills.kegs[1]?.pos.x, "遠い方は残る").toBeCloseTo(p.x + FAR * 2);
  });

  it("居残り: 全スロットに刻印符「延命」を足す札", () => {
    expect(BOONS_HORDE.lingerOn.grantsModifier).toBe("linger");
  });

  it("従魔: 奥義で周りの怯んだ敵を count 体まで従える", () => {
    const state = cleanArena();
    const list = [1, 2, 3, 4].map((i) => sturdy(state, NEAR * i));
    for (const e of list) applyStagger(state, e, 5);
    fireCard(state, BOONS_HORDE.thrall, eventOf(state, "onBurst"));
    const allied = list.filter((e) => isAllied(state, e)).length;
    expect(allied, "上限まで").toBe(Math.min(H.thrall.count, list.length));
  });

  it("十字砲火: 設置物どうしの線に触れた敵が傷つき、従魔は傷つかない", () => {
    const state = cleanArena();
    kegAt(state, -40, -30);
    kegAt(state, -40, 30);
    const foe = sturdy(state, -40, 0);
    const ally = sturdy(state, -40, 10);
    ally.allyUntil = state.time + LONG;
    const off = sturdy(state, 60, 60);
    state.boons.push("crossfire");
    state.tick = 0;
    updatePlacedSkills(state, FIXED_DT);
    expect(foe.hp, "線の上").toBeLessThan(BIG_HP);
    expect(ally.hp, "従魔").toBe(BIG_HP);
    expect(off.hp, "線の外").toBe(BIG_HP);
  });

  it("頭領: 従魔・設置物 1 つにつき与ダメの増（上限 cap）", () => {
    const state = cleanArena();
    kegAt(state, FAR);
    kegAt(state, -FAR);
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, null, BOONS_HORDE.packLeader.modifiers);
    expect(out.increased).toBeCloseTo(Math.min(H.packLeader.cap, H.packLeader.amount * 2));
  });

  it("庇い手: 従魔・設置物がいる間の被弾でリゲインを取り戻し、いなければ取り戻さない", () => {
    const hurt = (withKeg: boolean): number => {
      const state = cleanArena();
      if (withKeg) kegAt(state, FAR);
      const p = state.player;
      p.hp = p.maxHp - 20;
      p.regainPool = 20;
      p.regainTimer = 1;
      fireCard(state, BOONS_HORDE.guardian, eventOf(state, "onHurt"));
      return p.hp;
    };
    expect(hurt(true), "取り戻す").toBeGreaterThan(hurt(false));
  });

  it("群: 撃破のたび従魔・設置物の数の最高を記録し、従魔の与ダメの倍に効く", () => {
    const state = cleanArena();
    kegAt(state, FAR);
    kegAt(state, -FAR);
    fireCard(state, BOONS_HORDE.hordeTally, eventOf(state, "onKill"));
    expect(state.boonRun.tallies[HORDE_TALLY], "設置物 2").toBe(2);
    state.skills.kegs = [];
    fireCard(state, BOONS_HORDE.hordeTally, eventOf(state, "onKill"));
    expect(state.boonRun.tallies[HORDE_TALLY], "最高を残す").toBe(2);
    const out = applyModifiers(state, { tags: new Set(["minion"]) }, null, BOONS_HORDE.hordeTally.modifiers);
    expect(out.more[0]?.mul).toBeCloseTo(1 + H.hordeTally.amount * 2);
  });

  it("杭: スキルを撃つたび場の従魔・設置物の数を足し、every につきスキルの与ダメの増", () => {
    const state = cleanArena();
    kegAt(state, FAR);
    kegAt(state, -FAR);
    fireCard(state, BOONS_HORDE.stakeTally, eventOf(state, "onSkillCast"));
    fireCard(state, BOONS_HORDE.stakeTally, eventOf(state, "onSkillCast"));
    expect(state.boonRun.tallies[STAKE_TALLY], "2 + 2").toBe(4);
    state.boonRun.tallies[STAKE_TALLY] = H.stakeTally.every * 3;
    const out = applyModifiers(state, { tags: new Set(["skill"]) }, null, BOONS_HORDE.stakeTally.modifiers);
    expect(out.increased).toBeCloseTo(H.stakeTally.amount * 3);
  });

  it("百鬼: 従魔・設置物がいる間の撃破で周りの怯んだ敵が従う。いなければ従わない", () => {
    const tame = (withKeg: boolean): boolean => {
      const state = cleanArena();
      if (withKeg) kegAt(state, -FAR);
      const e = sturdy(state, NEAR);
      applyStagger(state, e, 5);
      fireCard(state, BOONS_HORDE.hundredDemons, eventOf(state, "onKill"));
      return isAllied(state, e);
    };
    expect(tame(true)).toBe(true);
    expect(tame(false)).toBe(false);
  });
});

describe("従魔の AI（system/enemies.ts の updateAlly）", () => {
  /** 従魔 1 体と敵 1 体を置き、steps だけ敵の AI を回す */
  function runAlly(seed: number, steps: number): { state: GameState; ally: Enemy; foe: Enemy; windups: number } {
    const state = cleanArena(seed);
    const ally = placeEnemy(state, "slime", NEAR);
    ally.allyUntil = state.time + LONG;
    ally.attackCooldown = 0;
    const foe = sturdy(state, FAR, 0);
    let windups = 0;
    for (let i = 0; i < steps; i++) {
      foe.attackCooldown = LONG;
      updateEnemies(state, FIXED_DT);
      state.time += FIXED_DT;
      if (ally.phase === "windup" || ally.phase === "strike") windups++;
    }
    return { state, ally, foe, windups };
  }

  it("従魔は他の敵へ寄って殴り、プレイヤーを狙わない", () => {
    const hp = arena(3).player.hp;
    const { state, foe, windups } = runAlly(3, 240);
    expect(foe.hp, "敵が殴られる").toBeLessThan(BIG_HP);
    expect(windups, "プレイヤーへの予備動作に入らない").toBe(0);
    expect(state.player.hp, "プレイヤーは無傷").toBe(hp);
  });

  it("号令の狙いがあれば、近い敵より狙いを優先する", () => {
    const state = cleanArena();
    const ally = placeEnemy(state, "slime", 0, NEAR);
    ally.allyUntil = state.time + LONG;
    const near = sturdy(state, 0, NEAR * 2);
    const marked = sturdy(state, 0, -FAR);
    state.boonRun.focus = { id: marked.id, until: state.time + LONG };
    const before = ally.body.pos.y;
    for (let i = 0; i < 10; i++) updateEnemies(state, FIXED_DT);
    expect(ally.body.pos.y, "狙いの方へ動く").toBeLessThan(before);
    expect(near.hp).toBe(BIG_HP);
  });

  it("砲台は号令の狙いへ撃つ", () => {
    const state = cleanArena();
    const p = state.player.body.pos;
    placeTurret(state, { ...p }, params(state));
    const marked = sturdy(state, 0, -FAR);
    state.boonRun.focus = { id: marked.id, until: state.time + LONG };
    onTurretShoot(state);
    const shot = state.skills.shots[state.skills.shots.length - 1];
    expect(shot?.vel.y ?? 0, "上（狙い）へ飛ぶ").toBeLessThan(0);
    expect(Math.abs(shot?.vel.x ?? 1), "向き（右）ではない").toBeLessThan(1e-6);
  });

  it("同じ seed なら従魔の動きと殴った量が同じ", () => {
    const a = runAlly(11, 120);
    const b = runAlly(11, 120);
    expect([a.foe.hp, a.ally.body.pos, a.state.rng.next()]).toEqual([b.foe.hp, b.ally.body.pos, b.state.rng.next()]);
  });
});

describe("従魔はこちらの攻撃で傷つかず、従えられない相手がいる", () => {
  /** 怯ませた頑丈な敵を置く */
  function staggered(state: GameState, dx: number, dy = 0): Enemy {
    const e = sturdy(state, dx, dy);
    applyStagger(state, e, LONG);
    return e;
  }

  it("階の主は怯んでいても従えない（主の部屋が主を倒す前に制圧扱いにならない）", () => {
    const state = cleanArena();
    const lord = staggered(state, NEAR);
    const other = staggered(state, -NEAR);
    state.boss = { enemyId: lord.id, name: "主", roomIndex: 0, introTimer: 0, defeated: false, major: false };
    fireCard(state, BOONS_HORDE.thrall, eventOf(state, "onBurst"));
    expect(isAllied(state, lord), "階の主").toBe(false);
    expect(isAllied(state, other), "ふつうの敵は従う").toBe(true);
  });

  it("連鎖雷は従魔へ跳ばず、その先の敵へ届く", () => {
    const state = cleanArena();
    const ally = sturdy(state, NEAR);
    ally.allyUntil = state.time + LONG;
    const foe = sturdy(state, NEAR * 2);
    chainLightning(state, { ...state.player.body.pos }, 10, undefined, { maxTargets: 1 });
    expect(ally.hp, "従魔は無傷").toBe(BIG_HP);
    expect(foe.hp, "1 跳びが敵に使われる").toBeLessThan(BIG_HP);
  });

  it("スキルの命中とこちらの状態異常は従魔に何も起こさない（気力も戻らない）", () => {
    const state = cleanArena();
    const ally = sturdy(state, NEAR);
    ally.allyUntil = state.time + LONG;
    state.player.mana = 0;
    const killed = skillHit(state, ally, params(state), { base: 50, kind: "melee", dir: { x: 1, y: 0 }, knockback: 0, stagger: false });
    expect(killed).toBe(false);
    expect(ally.hp).toBe(BIG_HP);
    expect(state.player.mana, "命中の気力の源が起きない").toBe(0);
    const burn = { kind: "burn" as const, stacks: 1, duration: 3, potency: 5 };
    expect(applyStatus(state, { kind: "enemy", enemy: ally }, burn, "player")).toBe(false);
    expect(hasStatus(ally.status, "burn")).toBe(false);
  });

  it("抜き胴は従魔を斬らず、時間切れで敵に戻った敵は斬る", () => {
    const state = cleanArena();
    state.boons = ["passCut"];
    const ally = sturdy(state, 0);
    ally.allyUntil = state.time + LONG;
    const former = sturdy(state, 0, 1);
    former.allyUntil = state.time - 1;
    state.player.dashTimer = 1;
    updateBoons(state, FIXED_DT);
    expect(ally.hp, "従魔").toBe(BIG_HP);
    expect(former.hp, "敵に戻った敵").toBeLessThan(BIG_HP);
  });
});
