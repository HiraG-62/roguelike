import { describe, expect, it } from "vitest";
import { type GameEvent, enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { type EnemyRule, type Rule, SCOPE_ANY } from "../core/rules";
import { step } from "../core/game";
import type { GameState } from "../core/state";
import { type EnemyCombatDef, enemyCombat } from "../data/enemyCombat";
import { STATUS, SYNERGY } from "../data/tuning";
import { ruleFromTrigger } from "../loot/triggers";
import type { TriggeredEffect } from "../loot/types";
import { BOONS, type BoonDef } from "./boonDefs";
import { BOON_RULE_EXAMPLES } from "./boonRules";
import { onBoonDash, onBoonKill } from "./boons";
import { collectRules, resolveRules } from "./rules";
import { applyBurn, findStatus, hasStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";
import { fireTrigger, tickTriggerCooldowns } from "./triggers";

/** 統一ルール文法（src/core/rules.ts）と resolveRules（src/system/rules.ts）の検査 */

const NEAR = 20;
const MID = 40;
const HEAL = 8;
const LOW_HP = 10;
const ONE_SECOND = 1;

/** 確定・ICD なしの Rule を組む */
function makeRule(partial: Partial<Rule> & Pick<Rule, "when" | "then">, id = "test:rule:0"): Rule {
  return { id, if: [], chance: 1, icd: 0, scope: SCOPE_ANY, owner: { kind: "boon", key: "test" }, ...partial };
}

/** createGame の床組みで積まれたイベントを捨てた、敵のいない部屋 */
function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function rawEvent(state: GameState, kind: GameEvent["kind"], depth: number): GameEvent {
  return { kind, actor: "player", pos: { ...state.player.body.pos }, depth, source: { kind: "player", key: "test" } };
}

describe("イベントの積み方", () => {
  it("pushEvent は今ステップの events に深さ 0 で積み、recent を更新する", () => {
    const state = cleanArena();
    pushPlayerEvent(state, "onDash", "dash");
    pushPlayerEvent(state, "onDash", "dash");
    expect(state.events.length, "2 件積まれる").toBe(2);
    expect(state.events[0]?.depth, "操作が直接起こしたものは深さ 0").toBe(0);
    expect(state.recent.onDash?.count, "窓の中で 2 回").toBe(2);
  });

  it("step 中の system がイベントを積み、resolveRules が照合後に空にする", () => {
    const state = cleanArena();
    state.player.dashChargesLeft = 1;
    step(state, { ...EMPTY_INPUT, dashPressed: true, move: { x: 1, y: 0 } }, FIXED_DT);
    expect(state.recent.onDash, "ダッシュで onDash が記録される").toBeDefined();
    expect(state.events.length, "照合後の events は空").toBe(0);
  });
});

describe("持ち越しと深さ", () => {
  it("効果が起こしたイベントは深さ +1 で次ステップへ持ち越され、同ステップでは照合しない", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", NEAR);
    const blast = makeRule({ when: "onDash", then: { kind: "explode", magnitude: 9999 } }, "test:blast:0");
    const onKill = makeRule({ when: "onKill", then: { kind: "heal", magnitude: HEAL } }, "test:heal:0");
    state.player.hp = LOW_HP;
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [blast, onKill]);
    expect(e.hp, "爆発で倒れる").toBeLessThanOrEqual(0);
    expect(state.player.hp, "撃破の Rule は同ステップでは起きない").toBe(LOW_HP);
    const carried = state.pendingEvents.find((ev) => ev.kind === "onKill");
    expect(carried?.depth, "撃破イベントは深さ 1 で持ち越し").toBe(1);
    expect(carried?.source.kind, "出どころは Rule の持ち主").toBe("boon");

    resolveRules(state, 0, [blast, onKill]);
    expect(state.player.hp, "次ステップで照合され、深さ 1 なので回復は × chainDecay").toBeCloseTo(LOW_HP + HEAL * SYNERGY.chainDecay);
  });

  it(`深さ ${SYNERGY.maxDepth} 以上のイベントは Rule を起こさない`, () => {
    const state = cleanArena();
    const heal = makeRule({ when: "onDash", then: { kind: "heal", magnitude: HEAL } });
    state.player.hp = LOW_HP;
    state.pendingEvents.push(rawEvent(state, "onDash", SYNERGY.maxDepth));
    resolveRules(state, 0, [heal]);
    expect(state.player.hp, "打ち切り").toBe(LOW_HP);
    state.pendingEvents.push(rawEvent(state, "onDash", SYNERGY.maxDepth - 1));
    resolveRules(state, 0, [heal]);
    expect(state.player.hp, "1 段手前は起きる").toBeGreaterThan(LOW_HP);
  });

  it("効果量は深さごとに × chainDecay で減る", () => {
    for (let depth = 0; depth < SYNERGY.maxDepth; depth++) {
      const state = cleanArena();
      state.player.hp = LOW_HP;
      state.pendingEvents.push(rawEvent(state, "onDash", depth));
      resolveRules(state, 0, [makeRule({ when: "onDash", then: { kind: "heal", magnitude: HEAL } })]);
      expect(state.player.hp - LOW_HP, `深さ ${depth}`).toBeCloseTo(HEAL * SYNERGY.chainDecay ** depth);
    }
  });

  it("成立した連鎖を chains に上限つきで残す", () => {
    const state = cleanArena();
    const rules = Array.from({ length: SYNERGY.chainLog + 2 }, (_, i) =>
      makeRule({ when: "onDash", then: { kind: "damageBuff", magnitude: 1 }, keyword: `k${i}` }, `test:chain:${i}`),
    );
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, rules);
    expect(state.chains.length, "上限で切る").toBe(SYNERGY.chainLog);
    expect(state.chains.at(-1)?.keyword, "新しいものが後ろ").toBe(`k${SYNERGY.chainLog + 1}`);
  });
});

describe("ICD の 3 層", () => {
  it("Rule ごとの ICD: 窓の間は 1 回、時間が経てば再び起きる", () => {
    const state = cleanArena();
    const rule = makeRule({ when: "onDash", then: { kind: "heal", magnitude: 1 }, icd: ONE_SECOND });
    state.player.hp = LOW_HP;
    pushPlayerEvent(state, "onDash", "dash");
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [rule]);
    expect(state.player.hp, "同じ ICD の中では 1 回").toBe(LOW_HP + 1);
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, ONE_SECOND, [rule]);
    expect(state.player.hp, "ICD が明けたら起きる").toBe(LOW_HP + 2);
  });

  it(`語ごとの回数上限: 1 語は ${SYNERGY.keywordWindow} 秒に ${SYNERGY.keywordBudget} 回まで`, () => {
    const state = cleanArena();
    const a = makeRule({ when: "onDash", then: { kind: "restoreMana", magnitude: 1 } }, "test:manaA:0");
    const b = makeRule({ when: "onDash", then: { kind: "restoreMana", magnitude: 1 } }, "test:manaB:0");
    for (let i = 0; i < SYNERGY.keywordBudget; i++) pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [a, b]);
    expect(state.ruleRun.keywordUse.get("mana"), "2 本の Rule を合わせて上限で止まる").toBe(SYNERGY.keywordBudget);
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, SYNERGY.keywordWindow, [a, b]);
    expect(state.ruleRun.keywordUse.get("mana"), "窓が変われば数え直す").toBe(2);
  });

  it("敵ごとの procIcd: 対象へ状態異常を入れる Rule は既存の on-hit ICD に従う", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", NEAR);
    const rule = makeRule({ when: "onMeleeHit", then: { kind: "inflict", magnitude: 2, status: "weaken" } });
    e.status.procIcd = STATUS.onHitIcd;
    pushEvent(state, { kind: "onMeleeHit", actor: "player", source: { kind: "player", key: "melee" }, ...enemyTarget(e) });
    resolveRules(state, 0, [rule]);
    expect(hasStatus(e.status, "weaken"), "procIcd 中は付かない").toBe(false);
    e.status.procIcd = 0;
    pushEvent(state, { kind: "onMeleeHit", actor: "player", source: { kind: "player", key: "melee" }, ...enemyTarget(e) });
    resolveRules(state, 0, [rule]);
    expect(hasStatus(e.status, "weaken"), "明けていれば付く").toBe(true);
    expect(e.status.procIcd, "付けたら procIcd を張る").toBe(STATUS.onHitIcd);
  });
});

describe("照合順", () => {
  it("祝福の Rule は取得順に照合される（BoonDef.rules）", () => {
    const first = BOONS.reaperCup as BoonDef;
    const second = BOONS.burnSpread as BoonDef;
    first.rules = [makeRule({ when: "onDash", then: { kind: "damageBuff", magnitude: 1 }, keyword: "first" }, "boon:reaperCup:0")];
    second.rules = [makeRule({ when: "onDash", then: { kind: "damageBuff", magnitude: 1 }, keyword: "second" }, "boon:burnSpread:0")];
    try {
      const state = cleanArena();
      state.boons = ["burnSpread", "reaperCup"];
      expect(collectRules(state).map((r) => r.id), "取得順").toEqual(["boon:burnSpread:0", "boon:reaperCup:0"]);
      pushPlayerEvent(state, "onDash", "dash");
      resolveRules(state, 0);
      expect(state.chains.map((c) => c.keyword), "照合も取得順").toEqual(["second", "first"]);
    } finally {
      delete first.rules;
      delete second.rules;
    }
  });

  it("step の中で祝福の Rule が照合される", () => {
    const def = BOONS.reaperCup as BoonDef;
    def.rules = [makeRule({ when: "onDash", then: { kind: "heal", magnitude: HEAL } }, "boon:reaperCup:0")];
    try {
      const state = cleanArena();
      state.boons = ["reaperCup"];
      state.player.hp = LOW_HP;
      pushPlayerEvent(state, "onDash", "dash");
      step(state, EMPTY_INPUT, FIXED_DT);
      expect(state.player.hp, "step の resolveRules で回復").toBeGreaterThanOrEqual(LOW_HP + HEAL);
    } finally {
      delete def.rules;
    }
  });

  it("同じ seed と同じイベント列なら確率つきの Rule も同じ結果になる", () => {
    const run = (): string[] => {
      const state = cleanArena(11);
      const rules = [
        makeRule({ when: "onDash", then: { kind: "damageBuff", magnitude: 1 }, chance: 0.5, keyword: "a" }, "test:a:0"),
        makeRule({ when: "onDash", then: { kind: "speedBuff", magnitude: 1 }, chance: 0.5, keyword: "b" }, "test:b:0"),
      ];
      const fired: string[] = [];
      for (let i = 0; i < 30; i++) {
        pushPlayerEvent(state, "onDash", "dash");
        resolveRules(state, ONE_SECOND, rules);
        fired.push(state.chains.map((c) => c.keyword).join(","));
        state.chains = [];
      }
      return fired;
    };
    expect(run(), "2 回とも同じ").toEqual(run());
  });
});

describe("敵の Rule", () => {
  it("この敵が対象のイベントで照合され、効果は予告付きの爆弾になる", () => {
    const def: EnemyCombatDef = enemyCombat("slime");
    const fuse = 0.6;
    const rule: EnemyRule = {
      id: "enemy:slime:0",
      when: "onEnemyDeath",
      if: [],
      then: { kind: "hazardBomb", magnitude: 5, duration: fuse, radius: 30 },
      chance: 1,
      icd: 0,
      scope: SCOPE_ANY,
      owner: { kind: "enemy", key: "slime" },
    };
    def.rules = [rule];
    try {
      const state = cleanArena();
      const e = placeEnemy(state, "slime", MID);
      e.hp = 0;
      pushEvent(state, { kind: "onEnemyDeath", actor: "enemy", source: { kind: "enemy", key: "slime" }, ...enemyTarget(e, true) });
      resolveRules(state, 0, []);
      const bomb = state.hazards.find((h) => h.kind === "bomb");
      expect(bomb?.time, "導火線 = 予告の秒").toBeCloseTo(fuse);
      expect(bomb?.pos, "倒れた位置").toEqual(e.body.pos);
    } finally {
      delete def.rules;
    }
  });
});

describe("装備トリガーとの等価", () => {
  const heal: TriggeredEffect = { trigger: "onKill", condition: "belowHalfHp", effect: "heal", magnitude: 1, chance: 0.5 };

  it("ruleFromTrigger: everyNthMeleeHit は近接命中 + nthMeleeHit、always は空の条件", () => {
    const nth = ruleFromTrigger({ trigger: "everyNthMeleeHit", every: 4, condition: "always", effect: "heal", magnitude: 3, chance: 0.4 }, 2);
    expect(nth.when).toBe("onMeleeHit");
    expect(nth.if, "条件は nth だけ").toEqual([{ kind: "nthMeleeHit", every: 4 }]);
    expect(nth.then).toEqual({ kind: "heal", magnitude: 3 });
    expect(ruleFromTrigger(heal, 0).if, "条件を運ぶ").toEqual([{ kind: "trigger", condition: "belowHalfHp" }]);
  });

  it("同じ seed なら fireTrigger と resolveRules（ruleFromTrigger）の発火が一致する", () => {
    const viaTrigger = arena(7, { triggers: [heal] });
    const viaRule = arena(7);
    const rule = ruleFromTrigger(heal, 0);
    const history = (state: GameState, fire: () => void, tick: () => void): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        state.player.hp = LOW_HP;
        fire();
        out.push(state.player.hp);
        tick();
      }
      return out;
    };
    const a = history(
      viaTrigger,
      () => fireTrigger(viaTrigger, "onKill", { pos: viaTrigger.player.body.pos }),
      () => tickTriggerCooldowns(viaTrigger, ONE_SECOND),
    );
    const b = history(
      viaRule,
      () => {
        pushPlayerEvent(viaRule, "onKill", "kill");
        resolveRules(viaRule, 0, [rule]);
      },
      () => resolveRules(viaRule, ONE_SECOND, []),
    );
    expect(a.some((hp) => hp > LOW_HP), "確率で何度か起きる").toBe(true);
    expect(b, "同じ乱数列で同じ回に起きる").toEqual(a);
  });
});

describe("祝福の Rule 化の見本（今のフックと同じ結果）", () => {
  it("野火: 燃えている敵の撃破で周囲へ同じ強さの燃焼", () => {
    const setup = (): { state: GameState; dying: ReturnType<typeof placeEnemy>; near: ReturnType<typeof placeEnemy> } => {
      const state = cleanArena();
      const dying = placeEnemy(state, "slime", NEAR);
      const near = placeEnemy(state, "slime", MID);
      applyBurn(state, dying, 4, STATUS.burnDuration);
      dying.hp = 0;
      return { state, dying, near };
    };
    const hook = setup();
    hook.state.boons = ["burnSpread"];
    onBoonKill(hook.state, hook.dying);
    const rule = setup();
    pushEvent(rule.state, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(rule.dying, true) });
    resolveRules(rule.state, 0, BOON_RULE_EXAMPLES.burnSpread);
    const a = findStatus(hook.near.status, "burn");
    const b = findStatus(rule.near.status, "burn");
    expect(a, "フックで燃える").toBeDefined();
    expect(b?.potency, "強さが同じ").toBeCloseTo(a?.potency ?? -1);
    expect(b?.time, "持続が同じ").toBeCloseTo(a?.time ?? -1);
  });

  it("帯電疾走: ダッシュ開始で同じ連鎖雷", () => {
    const setup = (): { state: GameState; e: ReturnType<typeof placeEnemy> } => {
      const state = cleanArena();
      return { state, e: placeEnemy(state, "golem", NEAR) };
    };
    const hook = setup();
    hook.state.boons = ["dashShock"];
    onBoonDash(hook.state);
    const rule = setup();
    pushPlayerEvent(rule.state, "onDash", "dash");
    resolveRules(rule.state, 0, BOON_RULE_EXAMPLES.dashShock);
    expect(hook.e.hp, "フックで削れる").toBeLessThan(hook.e.maxHp);
    expect(rule.e.hp, "同じだけ削れる").toBe(hook.e.hp);
  });

  it("屠りの盃: 撃破で同じだけマナが戻る", () => {
    const setup = (): { state: GameState; e: ReturnType<typeof placeEnemy> } => {
      const state = cleanArena();
      state.player.mana = 0;
      const e = placeEnemy(state, "slime", NEAR);
      e.hp = 0;
      return { state, e };
    };
    const hook = setup();
    hook.state.boons = ["reaperCup"];
    onBoonKill(hook.state, hook.e);
    const rule = setup();
    pushEvent(rule.state, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(rule.e, true) });
    resolveRules(rule.state, 0, BOON_RULE_EXAMPLES.reaperCup);
    expect(hook.state.player.mana, "フックで戻る").toBeGreaterThan(0);
    expect(rule.state.player.mana, "同じだけ戻る").toBeCloseTo(hook.state.player.mana);
  });
});
