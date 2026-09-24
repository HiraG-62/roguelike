import { describe, expect, it } from "vitest";
import { type GameEvent, enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { type EnemyRule, type Rule, type RuleCondition, SCOPE_ANY } from "../core/rules";
import { step } from "../core/game";
import type { GameState } from "../core/state";
import { type EnemyCombatDef, enemyCombat } from "../data/enemyCombat";
import { BOON, STATUS, SYNERGY } from "../data/tuning";
import { ruleFromTrigger } from "../loot/triggers";
import type { TriggeredEffect } from "../loot/types";
import { BOONS, type BoonDef } from "./boonDefs";
import { slashBase, updateBoonRules } from "./boonRules";
import { onBoonKill } from "./boons";
import { collectRules, resolveRules, ruleConditionsMet } from "./rules";
import { applyBurn, chainLightning, findStatus, hasStatus } from "./statusEffects";
import { arena, engageStartRoom, placeEnemy } from "./testHelpers";
import { placeTerrain, terrainAt } from "./terrain";
import { fireTrigger, tickTriggerCooldowns } from "./triggers";

/** 統一ルール文法（src/core/rules.ts）と resolveRules（src/system/rules.ts）の検査 */

const NEAR = 20;
const MID = 40;
/** 戦闘中の回復の上限（最大 HP 100 × HEAL.sustainCapRatio = 4 / 秒）に掛からない量 */
const HEAL = 4;
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

  it("1 ステップの上限を超えたイベントは捨て、捨てた数を droppedEvents に数える", () => {
    const state = cleanArena();
    const over = 3;
    for (let i = 0; i < SYNERGY.maxEventsPerStep + over; i++) pushPlayerEvent(state, "onDash", "dash");
    expect(state.events.length, "上限で止まる").toBe(SYNERGY.maxEventsPerStep);
    expect(state.ruleRun.droppedEvents, "超えた分だけ数える").toBe(over);
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
    // 定義に置いた本物の rules は検査の後で戻す
    const saved = [first.rules, second.rules] as const;
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
      first.rules = saved[0];
      second.rules = saved[1];
    }
  });

  it("step の中で祝福の Rule が照合される", () => {
    const def = BOONS.reaperCup as BoonDef;
    const saved = def.rules;
    def.rules = [makeRule({ when: "onDash", then: { kind: "heal", magnitude: HEAL } }, "boon:reaperCup:0")];
    try {
      const state = cleanArena();
      state.boons = ["reaperCup"];
      state.player.hp = LOW_HP;
      pushPlayerEvent(state, "onDash", "dash");
      step(state, EMPTY_INPUT, FIXED_DT);
      expect(state.player.hp, "step の resolveRules で回復").toBeGreaterThanOrEqual(LOW_HP + HEAL);
    } finally {
      def.rules = saved;
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

describe("祝福の Rule 化（旧フックと同じ結果。BoonDef.rules）", () => {
  /** 祝福の定義に置いた Rule（無ければテストを失敗させる） */
  function rulesOf(key: keyof typeof BOONS): readonly Rule[] {
    const rules = BOONS[key].rules;
    if (rules === undefined) throw new Error(`${key} に rules が無い`);
    return rules;
  }

  it("野火: 燃えている敵の撃破で周囲へ同じ強さ・同じ持続の燃焼", () => {
    const state = cleanArena();
    const dying = placeEnemy(state, "slime", NEAR);
    const near = placeEnemy(state, "slime", MID);
    applyBurn(state, dying, 4, STATUS.burnDuration);
    const potency = findStatus(dying.status, "burn")?.potency ?? -1;
    dying.hp = 0;
    pushEvent(state, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(dying, true) });
    resolveRules(state, 0, rulesOf("burnSpread"));
    const b = findStatus(near.status, "burn");
    // 旧フックは付与済みの強さを applyBurn へそのまま渡していた（霊力の倍率が掛かる）
    expect(b?.potency, "強さが同じ").toBeCloseTo(potency * state.stats.statusPotencyMul);
    expect(b?.time, "持続が同じ").toBeCloseTo(STATUS.burnDuration);
  });

  it("帯電疾走: ダッシュ開始で旧フックと同じ連鎖雷（近接 1 段目 × dashShockRatio）", () => {
    const setup = (): { state: GameState; e: ReturnType<typeof placeEnemy> } => {
      const state = cleanArena();
      return { state, e: placeEnemy(state, "golem", NEAR) };
    };
    const hook = setup();
    chainLightning(hook.state, hook.state.player.body.pos, slashBase(hook.state) * BOON.dashShockRatio);
    const rule = setup();
    pushPlayerEvent(rule.state, "onDash", "dash");
    resolveRules(rule.state, 0, rulesOf("dashShock"));
    expect(hook.e.hp, "旧フックの式で削れる").toBeLessThan(hook.e.maxHp);
    expect(rule.e.hp, "同じだけ削れる").toBe(hook.e.hp);
  });

  it("屠りの盃: 撃破で reaperCupKillMana（回収の倍率込み）だけ気力が戻る", () => {
    const state = cleanArena();
    state.player.mana = 0;
    const e = placeEnemy(state, "slime", NEAR);
    e.hp = 0;
    pushEvent(state, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(e, true) });
    resolveRules(state, 0, rulesOf("reaperCup"));
    expect(state.player.mana, "同じだけ戻る").toBeCloseTo(BOON.reaperCupKillMana * state.stats.manaGainMul);
  });

  it("direct の Rule は深さ・減衰・語の上限・深さの上限の外で、連鎖に記録しない", () => {
    const state = cleanArena();
    state.player.mana = 0;
    const rule = makeRule({ when: "onDash", then: { kind: "restoreMana", magnitude: 1, quiet: true }, direct: true });
    for (let i = 0; i < SYNERGY.keywordBudget + 2; i++) state.pendingEvents.push(rawEvent(state, "onDash", SYNERGY.maxDepth));
    resolveRules(state, 0, [rule]);
    const expected = (SYNERGY.keywordBudget + 2) * state.stats.manaGainMul;
    expect(state.player.mana, "深さの上限でも等倍で上限なしに起きる").toBeCloseTo(expected);
    expect(state.chains, "連鎖に記録しない").toHaveLength(0);
  });

  it("direct の効果が起こしたイベントは深さを進めない（フックが起こした出来事と同じ）", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", NEAR);
    e.hp = 1;
    const rule = makeRule({ when: "onMeleeHit", then: { kind: "strike", magnitude: 5 }, direct: true });
    pushEvent(state, { kind: "onMeleeHit", actor: "player", source: { kind: "player", key: "melee" }, ...enemyTarget(e) });
    resolveRules(state, 0, [rule]);
    const kill = state.events.find((ev) => ev.kind === "onKill");
    expect(kill, "追撃で倒れて撃破が積まれる").toBeDefined();
    expect(kill?.depth, "深さ 0 のまま次ステップへ").toBe(0);
    expect(kill?.source.kind, "出どころは上書きしない").toBe("player");
    expect(state.pendingEvents, "持ち越しにならない").toHaveLength(0);
  });

  it("group: 同じイベントで同じ group の Rule は 1 つだけ起きる", () => {
    const state = cleanArena();
    const a = makeRule({ when: "onDash", then: { kind: "wave", magnitude: 5 }, group: "g", direct: true }, "test:g:0");
    const b = makeRule({ when: "onDash", then: { kind: "wave", magnitude: 5 }, group: "g", direct: true }, "test:g:1");
    const before = state.projectiles.length;
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [a, b]);
    expect(state.projectiles.length - before, "1 本だけ").toBe(1);
  });
});

describe("文法の拡張（祝福 第 2 弾の条件）", () => {
  /** 敵を対象にした条件の照合 */
  function holds(state: GameState, c: RuleCondition, target?: ReturnType<typeof placeEnemy>): boolean {
    const subject = target ? { pos: { ...target.body.pos }, targetId: target.id } : { pos: { ...state.player.body.pos } };
    return ruleConditionsMet(state, [c], subject);
  }

  it("武器種・弾の性質・ジョブ・得意武器・否定", () => {
    const state = cleanArena();
    state.stats.moveset = "spear";
    state.stats.bullet = "mineLauncher";
    state.job = "lancer";
    expect(holds(state, { kind: "moveset", movesets: ["spear", "whip"] }), "槍は一致").toBe(true);
    expect(holds(state, { kind: "moveset", movesets: ["sword"] }), "剣は不一致").toBe(false);
    expect(holds(state, { kind: "bullet", has: ["mine"] }), "設置弾は一致").toBe(true);
    expect(holds(state, { kind: "bullet", has: ["lob", "charge"] }), "曲射・溜め撃ちは不一致").toBe(false);
    expect(holds(state, { kind: "job", jobs: ["lancer"] }), "槍兵は一致").toBe(true);
    expect(holds(state, { kind: "favoredWeapon" }), "槍兵の槍は得意").toBe(true);
    expect(holds(state, { kind: "not", condition: { kind: "favoredWeapon" } }), "否定は反転する").toBe(false);
  });

  it("振りの段・溜めの段・溜め中・コンボ派生は AttackState を読む", () => {
    const state = cleanArena();
    const a = state.player.attack;
    a.step = 4;
    a.chargeLevel = 0;
    a.charging = false;
    a.branch = -1;
    expect(holds(state, { kind: "swingStep", atLeast: 4 }), "5 段目").toBe(true);
    expect(holds(state, { kind: "swingStep", atLeast: 5 }), "6 段目ではない").toBe(false);
    expect(holds(state, { kind: "chargedSwing", atLeast: 1 }), "溜めていない").toBe(false);
    expect(holds(state, { kind: "branchSwing" }), "派生ではない").toBe(false);
    a.chargeLevel = 2;
    a.charging = true;
    a.branch = 0;
    expect(holds(state, { kind: "chargedSwing", atLeast: 2 }), "溜め 2 段").toBe(true);
    expect(holds(state, { kind: "charging" }), "溜め中").toBe(true);
    expect(holds(state, { kind: "branchSwing" }), "派生").toBe(true);
  });

  it("自分の足元・対象の足元の地形（any は地形の上ならどれでも）", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "golem", MID);
    expect(holds(state, { kind: "selfOnTerrain", terrain: "any" }), "地形なし").toBe(false);
    const p = state.player.body.pos;
    placeTerrain(state, p.x, p.y, "ice", 1, 0);
    placeTerrain(state, e.body.pos.x, e.body.pos.y, "oil", 1, 0);
    expect(holds(state, { kind: "selfOnTerrain", terrain: "ice" }), "自分は氷床").toBe(true);
    expect(holds(state, { kind: "selfOnTerrain", terrain: "any" }), "any も真").toBe(true);
    expect(holds(state, { kind: "targetOnTerrain", terrain: "oil" }, e), "敵は油の上").toBe(true);
    expect(holds(state, { kind: "targetOnTerrain", terrain: "water" }, e), "水ではない").toBe(false);
  });

  it("弱点 / 耐性と主な属性は武器種（変換込み）で決まる", () => {
    const state = cleanArena();
    const eye = placeEnemy(state, "eye", MID);
    state.stats.moveset = "scythe";
    expect(holds(state, { kind: "attackElement", element: "dark", via: "melee" }), "大鎌は闇").toBe(true);
    expect(holds(state, { kind: "targetAffinity", affinity: "weak", via: "melee" }, eye), "目玉は闇が弱点").toBe(true);
    state.stats.moveset = "wand";
    expect(holds(state, { kind: "targetAffinity", affinity: "resist", via: "melee" }, eye), "目玉は光に耐性").toBe(true);
    state.stats.moveset = "sword";
    expect(holds(state, { kind: "targetAffinity", affinity: "weak", via: "melee" }, eye), "剣は無属性で等倍").toBe(false);
    expect(holds(state, { kind: "targetAffinity", affinity: "weak", via: "melee" }), "対象なしは偽").toBe(false);
  });

  it("交戦中の部屋の種類・階の種類", () => {
    const state = cleanArena();
    expect(holds(state, { kind: "engagedIn", rooms: ["normal"] }), "交戦していない").toBe(false);
    engageStartRoom(state);
    const kind = state.rooms[0]?.kind ?? "normal";
    expect(holds(state, { kind: "engagedIn", rooms: [kind] }), "開始部屋で交戦中").toBe(true);
    state.floorKind = "glacier";
    expect(holds(state, { kind: "floorKind", kinds: ["glacier", "forge"] }), "氷河の階").toBe(true);
    expect(holds(state, { kind: "floorKind", kinds: ["rooms"] }), "部屋の階ではない").toBe(false);
  });

  it("徘徊: 生きていれば所属で、倒れた後は撃破の記録で見る（記録は時間で消える）", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", MID);
    e.roomIndex = -1;
    expect(holds(state, { kind: "targetRoamer" }, e), "生きた徘徊").toBe(true);
    onBoonKill(state, e);
    e.hp = 0;
    state.enemies = [];
    expect(holds(state, { kind: "targetRoamer" }, e), "倒れた直後も徘徊と分かる").toBe(true);
    updateBoonRules(state, BOON.roamerKillMemory + 0.1);
    expect(holds(state, { kind: "targetRoamer" }, e), "記録が消えたら偽").toBe(false);
  });
});

describe("文法の拡張（祝福 第 2 弾の効果）", () => {
  it("地形を置く・火をつける・広げる", () => {
    const state = cleanArena();
    const p = state.player.body.pos;
    const place = makeRule({ when: "onDash", then: { kind: "placeTerrain", terrain: "oil", magnitude: 0, radius: 1, duration: 0 } }, "test:t:0");
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [place]);
    expect(terrainAt(state, p.x, p.y), "油が置かれる").toBe("oil");
    const ignite = makeRule({ when: "onDash", then: { kind: "igniteTerrain", magnitude: 0, radius: 1 } }, "test:t:1");
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [ignite]);
    expect(terrainAt(state, p.x, p.y), "油に火がつく").toBe("fire");
    const spread = makeRule({ when: "onDash", then: { kind: "spreadTerrain", magnitude: 0, radius: 40 } }, "test:t:2");
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [spread]);
    expect(terrainAt(state, p.x + 32, p.y), "足元の炎が周りへ広がる").toBe("fire");
  });

  it("地形の無い所で広げても何も置かない", () => {
    const state = cleanArena();
    const p = state.player.body.pos;
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [makeRule({ when: "onDash", then: { kind: "spreadTerrain", magnitude: 0, radius: 40 } })]);
    expect(terrainAt(state, p.x, p.y), "地形なしのまま").toBe("none");
  });

  it("自分への状態・ダッシュの回数・追撃・衝撃波", () => {
    const state = cleanArena();
    const p = state.player;
    const e = placeEnemy(state, "golem", NEAR);
    p.dashChargesLeft = 0;
    const rules = [
      makeRule({ when: "onMeleeHit", then: { kind: "selfStatus", status: "haste", magnitude: 0, duration: 2 } }, "test:s:0"),
      makeRule({ when: "onMeleeHit", then: { kind: "refillDash", magnitude: 0, count: 1 } }, "test:s:1"),
      makeRule({ when: "onMeleeHit", then: { kind: "strike", magnitude: 5 } }, "test:s:2"),
      makeRule({ when: "onMeleeHit", then: { kind: "wave", magnitude: 5 } }, "test:s:3"),
    ];
    const before = state.projectiles.length;
    pushEvent(state, { kind: "onMeleeHit", actor: "player", source: { kind: "player", key: "melee" }, ...enemyTarget(e) });
    resolveRules(state, 0, rules);
    expect(hasStatus(p.status, "haste"), "加速が付く").toBe(true);
    expect(p.dashChargesLeft, "ダッシュが 1 戻る").toBe(1);
    expect(e.hp, "追撃で削れる").toBeLessThan(e.maxHp);
    expect(state.projectiles.length, "衝撃波が 1 つ出る").toBe(before + 1);
  });

  it(`第 2 弾の Rule は ICD が ${BOON.ruleMinIcd} 秒以上`, () => {
    const state = cleanArena();
    state.boons = ["leyLine"];
    const [rule] = collectRules(state);
    expect(rule?.icd ?? 0, "ICD の下限").toBeGreaterThanOrEqual(BOON.ruleMinIcd);
  });
});
