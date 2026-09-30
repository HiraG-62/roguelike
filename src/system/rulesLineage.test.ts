import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import { FIXED_DT } from "../core/loop";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY } from "../core/rules";
import type { Enemy, GameState } from "../core/state";
import { ENEMIES } from "../data/enemies";
import { BOON, POISE, TRIGGER } from "../data/tuning";
import { stoneFromSeed } from "../skills/generator";
import { placeKeg } from "../skills/summons";
import type { SkillKey } from "../skills/types";
import { updateEnemies } from "./enemies";
import { overlapsWall } from "./physics";
import { addPoise, applyStagger } from "./poise";
import { focusTarget, isAllied, minionCount, resolveRules, ruleConditionsMet } from "./rules";
import { createSkillRunState, resolveSlot, updateSkills } from "./skills";
import { applyStatus } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 祝福の中身で足した効果・条件・効果量の基準・イベント（docs/ideas/boon-impl.md 2-6 末尾）の検査 */

const OWNER = { kind: "boon", key: "test" } as const;
const NEAR = 20;
const FAR = 200;
const BIG_HP = 10_000;
const DURATION = 5;

function makeRule(when: Rule["when"], then: RuleEffect, conditions: readonly RuleCondition[] = []): Rule {
  return { id: `test:${then.kind}:0`, when, if: conditions, then, chance: 1, icd: 0, scope: SCOPE_ANY, owner: OWNER };
}

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function sturdy(state: GameState, dx: number, key = "slime"): Enemy {
  const e = placeEnemy(state, key, dx);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

/** 対象つきのイベント（対象が無ければ自分の位置） */
function eventOn(state: GameState, kind: GameEvent["kind"], target?: Enemy): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return { kind, actor: "player", pos, depth: 0, source: { kind: "player", key: "test" }, ...(target ? { targetId: target.id } : {}) };
}

function fire(state: GameState, rule: Rule, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, [rule]);
}

/** スロット 0 に石を付けた状態 */
function withStone(skillKey: SkillKey): GameState {
  const state = cleanArena();
  const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey }), variants: [], links: 0 };
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id, null, null, null], stones: [stone] });
  updateSkills(state, withInput({}), 0);
  return state;
}

describe("refreshSkills", () => {
  it("再使用時間を全長の割合だけ戻し、最低間隔の残りも同じ割合で縮める", () => {
    const state = withStone("whirl");
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロットが無い");
    slot.cooldownTotal = 10;
    slot.cooldownLeft = 10;
    slot.intervalLeft = 1;
    fire(state, makeRule("onDash", { kind: "refreshSkills", magnitude: 0.2 }), eventOn(state, "onDash"));
    expect(slot.cooldownLeft, "10 秒の 20% = 2 秒戻す").toBeCloseTo(8);
    expect(slot.intervalLeft, "最低間隔も 20% 縮む").toBeCloseTo(0.8);
  });

  it("fill なら全部戻す", () => {
    const state = withStone("whirl");
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロットが無い");
    slot.cooldownTotal = 10;
    slot.cooldownLeft = 6;
    slot.intervalLeft = 1;
    fire(state, makeRule("onDash", { kind: "refreshSkills", magnitude: 0, fill: true }), eventOn(state, "onDash"));
    expect(slot.cooldownLeft).toBe(0);
    expect(slot.intervalLeft).toBe(0);
  });
});

describe("echoLast", () => {
  it("直前のスキルを気力を払わずに写しで撃ち、次の updateSkills で出る", () => {
    const state = withStone("whirl");
    state.skills.lastCast = { skillKey: "whirl", slot: 0, at: state.skills.clock, pos: { ...state.player.body.pos }, hitIds: new Set() };
    const mana = state.player.mana;
    const mul = 0.5;
    fire(state, makeRule("onDashEnd", { kind: "echoLast", magnitude: mul }), eventOn(state, "onDashEnd"));
    const echo = state.skills.echoes[0];
    expect(echo?.kind, "反響の写しを積む").toBe("echo");
    expect(echo?.params.manaPaid, "払っていない").toBe(0);
    expect(echo?.params.echo, "写しの反響は付けない").toBeNull();
    const base = resolveSlot(state, 0)?.params.damageMul ?? 0;
    expect(echo?.params.damageMul, "威力 × magnitude").toBeCloseTo(base * mul);
    expect(state.player.mana, "気力は変わらない").toBe(mana);
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.ghosts.length, "旋風の写しが出る").toBe(1);
  });

  it("直前の発動が無い・石が変わったなら撃たない", () => {
    const state = withStone("whirl");
    fire(state, makeRule("onDashEnd", { kind: "echoLast", magnitude: 1 }), eventOn(state, "onDashEnd"));
    expect(state.skills.echoes.length, "発動が無い").toBe(0);
    state.skills.lastCast = { skillKey: "lunge", slot: 0, at: 0, pos: { x: 0, y: 0 }, hitIds: new Set() };
    fire(state, makeRule("onDashEnd", { kind: "echoLast", magnitude: 1 }), eventOn(state, "onDashEnd"));
    expect(state.skills.echoes.length, "石が違う").toBe(0);
  });
});

describe("retarget", () => {
  it("対象の敵を duration 秒だけ狙いにする", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fire(state, makeRule("onSwingHit", { kind: "retarget", magnitude: 0, duration: DURATION }), eventOn(state, "onSwingHit", e));
    expect(focusTarget(state)?.id, "狙いが向く").toBe(e.id);
    state.time += DURATION;
    expect(focusTarget(state), "切れたら無い").toBeUndefined();
  });
});

describe("設置物（detonatePlaced / minions）", () => {
  it("最も近い設置物を消してその位置で爆発し、数え方 minions が減る", () => {
    const state = withStone("whirl");
    const params = resolveSlot(state, 0)?.params;
    if (!params) throw new Error("石が無い");
    const p = state.player.body.pos;
    placeKeg(state, { x: p.x + FAR, y: p.y }, params);
    placeKeg(state, { x: p.x + NEAR, y: p.y }, params);
    const e = sturdy(state, NEAR + 4);
    expect(minionCount(state), "設置物 2").toBe(2);
    const damage = 50;
    fire(state, makeRule("onRelease", { kind: "detonatePlaced", magnitude: damage, radius: 24 }), eventOn(state, "onRelease"));
    expect(minionCount(state), "1 つ消える").toBe(1);
    expect(state.skills.kegs[0]?.pos.x, "遠い方が残る").toBeCloseTo(p.x + FAR);
    expect(e.hp, "近くの敵に爆風").toBeLessThan(BIG_HP);
  });

  it("設置物が無ければ何もしない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fire(state, makeRule("onRelease", { kind: "detonatePlaced", magnitude: 50 }), eventOn(state, "onRelease"));
    expect(e.hp).toBe(BIG_HP);
  });
});

describe("tameEnemy", () => {
  it("対象の敵を duration 秒だけ味方にし、minions に数える", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fire(state, makeRule("onBurst", { kind: "tameEnemy", magnitude: 0, duration: DURATION }), eventOn(state, "onBurst", e));
    expect(isAllied(state, e), "味方").toBe(true);
    expect(minionCount(state), "従魔 1").toBe(1);
    state.time += DURATION;
    expect(isAllied(state, e), "切れたら敵に戻る").toBe(false);
  });

  it("radius があれば半径内の onlyWith の敵を近い順に count 体まで従える", () => {
    const state = cleanArena();
    const near = sturdy(state, NEAR);
    const mid = sturdy(state, NEAR * 2);
    const far = sturdy(state, NEAR * 3);
    const calm = sturdy(state, NEAR + 5);
    for (const e of [near, mid, far]) applyStagger(state, e, DURATION);
    const effect: RuleEffect = { kind: "tameEnemy", magnitude: 0, duration: DURATION, radius: NEAR * 4, onlyWith: "stagger", count: 2 };
    fire(state, makeRule("onBurst", effect), eventOn(state, "onBurst"));
    expect([near, mid, far, calm].map((e) => isAllied(state, e)), "怯んだ近い 2 体だけ").toEqual([true, true, false, false]);
  });

  it("ボス級は従えない", () => {
    const bossKey = ENEMIES.find((d) => d.boss === true)?.key;
    if (bossKey === undefined) throw new Error("ボスが無い");
    const state = cleanArena();
    const boss = sturdy(state, NEAR, bossKey);
    fire(state, makeRule("onBurst", { kind: "tameEnemy", magnitude: 0, duration: DURATION }), eventOn(state, "onBurst", boss));
    expect(isAllied(state, boss)).toBe(false);
  });
});

describe("coinShot", () => {
  it("銭を払って、払った額 × magnitude の弾を撃つ", () => {
    const state = cleanArena();
    state.economy.coins = 30;
    const before = state.projectiles.length;
    fire(state, makeRule("onRelease", { kind: "coinShot", magnitude: 2, count: 10 }), eventOn(state, "onRelease"));
    expect(state.economy.coins, "10 払う").toBe(20);
    const shot = state.projectiles[before];
    expect(shot?.damage, "10 × 2").toBe(20);
    expect(shot?.owner).toBe("player");
    expect(shot?.radius).toBe(BOON.ruleCoinShot.radius);
  });

  it("share は持ち金の割合を払い、払えなければ不発", () => {
    const state = cleanArena();
    state.economy.coins = 50;
    fire(state, makeRule("onRelease", { kind: "coinShot", magnitude: 1, share: 0.1 }), eventOn(state, "onRelease"));
    expect(state.economy.coins, "50 の 10%").toBe(45);
    state.economy.coins = 3;
    const before = state.projectiles.length;
    fire(state, makeRule("onRelease", { kind: "coinShot", magnitude: 1, count: 10 }), eventOn(state, "onRelease"));
    expect(state.economy.coins, "足りなければ払わない").toBe(3);
    expect(state.projectiles.length, "撃たない").toBe(before);
  });
});

describe("releaseVault", () => {
  it("種類の合う溜めを magnitude 倍で一度に出し、空にする", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    e.vault = { kind: "ice", amount: 40 };
    fire(state, makeRule("onShatter", { kind: "releaseVault", magnitude: 1.5, vault: "ice" }), eventOn(state, "onShatter", e));
    expect(BIG_HP - e.hp, "40 × 1.5").toBe(60);
    expect(e.vault, "空になる").toBeUndefined();
  });

  it("種類が違えば出さない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    e.vault = { kind: "doom", amount: 40 };
    fire(state, makeRule("onShatter", { kind: "releaseVault", magnitude: 1, vault: "ice" }), eventOn(state, "onShatter", e));
    expect(e.hp).toBe(BIG_HP);
    expect(e.vault?.amount).toBe(40);
  });
});

describe("効果量の基準 coins / counter", () => {
  it("coins は持ち金 × magnitude（払う Rule より前に並べれば払う前の額）", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    state.economy.coins = 40;
    const strike = makeRule("onBurst", { kind: "strike", magnitude: 1, scaleBy: "coins" });
    const spend = { ...makeRule("onBurst", { kind: "spendCoins", magnitude: 1, scaleBy: "coins" }), id: "test:spend:1" };
    state.events.push(eventOn(state, "onBurst", e));
    resolveRules(state, 0, [strike, spend]);
    expect(BIG_HP - e.hp, "40 の一撃").toBe(40);
    expect(state.economy.coins, "全部払う").toBe(0);
  });

  it("counter は数え方の今の数 × magnitude（従えた数を数えに積む）", () => {
    const state = cleanArena();
    const a = sturdy(state, NEAR);
    const b = sturdy(state, NEAR * 2);
    a.allyUntil = state.time + DURATION;
    b.allyUntil = state.time + DURATION;
    const rule = makeRule("onBurst", { kind: "tally", magnitude: 1, key: "horde", mode: "max", scaleBy: "counter", counter: { kind: "minions" } });
    fire(state, rule, eventOn(state, "onBurst"));
    expect(state.boonRun.tallies.horde, "従魔 2").toBe(2);
  });
});

describe("条件 targetWithin / counter", () => {
  it("targetWithin は対象が自分から radius 以内", () => {
    const state = cleanArena();
    const near = sturdy(state, NEAR);
    const far = sturdy(state, FAR);
    const within: RuleCondition[] = [{ kind: "targetWithin", radius: 60 }];
    expect(ruleConditionsMet(state, within, eventOn(state, "onMeleeHit", near))).toBe(true);
    expect(ruleConditionsMet(state, within, eventOn(state, "onMeleeHit", far))).toBe(false);
  });

  it("counter は数えが atLeast 以上かつ atMost 以下", () => {
    const state = cleanArena();
    state.boonRun.tallies.k = 3;
    const ev = eventOn(state, "onDash");
    const cond = (atLeast?: number, atMost?: number): RuleCondition[] => [{ kind: "counter", counter: { kind: "tally", key: "k" }, atLeast, atMost }];
    expect(ruleConditionsMet(state, cond(3), ev), "3 以上").toBe(true);
    expect(ruleConditionsMet(state, cond(4), ev), "4 以上ではない").toBe(false);
    expect(ruleConditionsMet(state, cond(undefined, 2), ev), "2 以下ではない").toBe(false);
    expect(ruleConditionsMet(state, cond(1, 3), ev), "1〜3").toBe(true);
  });
});

describe("新しいイベントと既定値", () => {
  it("処刑で onExecute を積む（対象 = 処刑した敵）", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", NEAR);
    e.maxHp = 100;
    e.hp = Math.floor(100 * POISE.executeHpRatio);
    applyStagger(state, e, 1);
    addPoise(state, e, POISE.executeMinPoise, { canExecute: true });
    expect(e.hp, "処刑される").toBe(0);
    const ev = state.events.find((x) => x.kind === "onExecute");
    expect(ev?.targetId, "対象の敵").toBe(e.id);
    expect(ev?.targetStatus?.some((s) => s.kind === "stagger"), "倒れた瞬間の状態異常を写す").toBe(true);
  });

  it("壁叩きつけで onWallSlam を積む", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "boar", 0);
    e.hp = BIG_HP;
    e.attackCooldown = BIG_HP;
    const p = state.player.body.pos;
    let x = p.x;
    while (!overlapsWall(state, x, p.y, e.body.radius)) x += 1;
    e.body.pos.x = x - 10;
    e.wallSplat = true;
    e.knock = { x: 320, y: 0 };
    let slams = 0;
    for (let i = 0; i < 10; i++) {
      updateEnemies(state, FIXED_DT);
      slams += state.events.filter((ev) => ev.kind === "onWallSlam" && ev.targetId === e.id).length;
      state.events = [];
    }
    expect(slams, "1 回だけ").toBe(1);
  });

  it("retarget の duration を省くと TRIGGER.defaultDuration 秒", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fire(state, makeRule("onSwingHit", { kind: "retarget", magnitude: 0 }), eventOn(state, "onSwingHit", e));
    expect(state.boonRun.focus?.until, "duration 省略は TRIGGER.defaultDuration").toBeCloseTo(state.time + TRIGGER.defaultDuration);
  });
});

describe("状態異常と従魔の決定性", () => {
  it("同じ seed で同じ効果を流すと同じ結果", () => {
    const once = (): { allied: boolean[]; hp: number[] } => {
      const state = cleanArena(9);
      const list = [sturdy(state, NEAR), sturdy(state, NEAR * 2)];
      for (const e of list) applyStatus(state, { kind: "enemy", enemy: e }, { kind: "stagger", stacks: 1, duration: DURATION, potency: 0 }, "player");
      fire(state, makeRule("onBurst", { kind: "tameEnemy", magnitude: 0, radius: FAR, count: 1, duration: DURATION }), eventOn(state, "onBurst"));
      return { allied: list.map((e) => isAllied(state, e)), hp: list.map((e) => e.hp) };
    };
    expect(once()).toEqual(once());
  });
});
