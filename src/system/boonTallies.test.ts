import { afterEach, describe, expect, it } from "vitest";
import { type GameEvent, pushPlayerEvent } from "../core/events";
import { FIXED_DT } from "../core/loop";
import { type Modifier, type Rule, SCOPE_ANY } from "../core/rules";
import { step } from "../core/game";
import type { GameState } from "../core/state";
import { SYNERGY } from "../data/tuning";
import { BOONS, type BoonDef, type BoonKey, type TemperStat } from "./boonDefs";
import { addTally, foldBoonStats, temperAmount } from "./boons";
import { applyModifiers, countPer } from "./modifiers";
import { applyStats } from "./player";
import { resolveRules } from "./rules";
import { arena, withInput } from "./testHelpers";

/** 研鑽の数え（Rule 効果 tally）・Modifier の per tally・BoonDef.temperStat の検査（docs/ideas/boon-impl.md 2-1） */

/** 定義を一時的に差し替える祝福（Rule だけの祝福で、foldBoonStats の個別の分岐を持たない） */
const HOST: BoonKey = "emberSeed";
const OWNER = { kind: "boon", key: HOST } as const;
const TALLY = "ash";
const EVERY = 3;
const GRADE_DIVINE = 3;

/** テストの中だけで BOONS の 1 件を差し替える（afterEach で戻す） */
const table = BOONS as Record<BoonKey, BoonDef>;
const original = table[HOST];
afterEach(() => {
  table[HOST] = original;
});

function withDef(partial: Partial<BoonDef>): void {
  table[HOST] = { ...original, ...partial };
}

function tallyRule(partial: Partial<Rule> = {}, then: Partial<Rule["then"]> = {}): Rule {
  return {
    id: "boon:emberSeed:tally",
    when: "onKill",
    if: [],
    then: { kind: "tally", magnitude: 1, key: TALLY, ...then },
    chance: 1,
    icd: 0,
    scope: SCOPE_ANY,
    owner: OWNER,
    ...partial,
  };
}

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function killEvent(state: GameState, amount?: number): GameEvent {
  return {
    kind: "onKill",
    actor: "player",
    pos: { ...state.player.body.pos },
    depth: 0,
    source: { kind: "player", key: "kill" },
    ...(amount !== undefined ? { amount } : {}),
  };
}

describe("数え（tally）", () => {
  it("add はイベントのたびに magnitude を足す", () => {
    const state = cleanArena();
    const kills = 3;
    for (let i = 0; i < kills; i++) state.events.push(killEvent(state));
    resolveRules(state, 0, [tallyRule()]);
    expect(state.boonRun.tallies[TALLY], "3 回の撃破で 3").toBe(kills);
  });

  it("max は最高記録だけを残す（scaleBy eventAmount）", () => {
    const state = cleanArena();
    const rule = tallyRule({ when: "onKill" }, { mode: "max", scaleBy: "eventAmount" });
    for (const amount of [5, 8, 3]) state.events.push(killEvent(state, amount));
    resolveRules(state, 0, [rule]);
    expect(state.boonRun.tallies[TALLY], "5 / 8 / 3 の最高").toBe(8);
  });

  it("格は数えに掛からない", () => {
    const state = cleanArena();
    state.boonRun.grades[HOST] = GRADE_DIVINE;
    state.events.push(killEvent(state));
    resolveRules(state, 0, [tallyRule()]);
    expect(state.boonRun.tallies[TALLY], "神威でも 1 撃破 = 1").toBe(1);
  });

  it("語の上限を超える数のイベントでも数え漏らさず、連鎖の記録にも残さない", () => {
    const state = cleanArena();
    const kills = SYNERGY.keywordBudget + 3;
    for (let i = 0; i < kills; i++) state.events.push(killEvent(state));
    resolveRules(state, 0, [tallyRule()]);
    expect(state.boonRun.tallies[TALLY], "全部数える").toBe(kills);
    expect(state.chains.length, "数えは連鎖に数えない").toBe(0);
    expect(state.pendingEvents.length, "何も起こさない").toBe(0);
  });

  it("連鎖の深さの上限にあるイベントも数える", () => {
    const state = cleanArena();
    state.pendingEvents.push({ ...killEvent(state), depth: SYNERGY.maxDepth });
    resolveRules(state, 0, [tallyRule()]);
    expect(state.boonRun.tallies[TALLY]).toBe(1);
  });

  it("key が無い数えは何もしない", () => {
    const state = cleanArena();
    state.events.push(killEvent(state));
    resolveRules(state, 0, [tallyRule({}, { key: undefined })]);
    expect(Object.keys(state.boonRun.tallies).length).toBe(0);
  });
});

describe("Modifier の per tally", () => {
  const perTally: Modifier = {
    id: "boon:emberSeed:mod",
    kind: "more",
    tag: "all",
    amount: 0.01,
    per: { count: { kind: "tally", key: TALLY }, every: 5 },
    if: [],
    owner: OWNER,
  };

  it("数え 5 につき倍 +0.01", () => {
    const state = cleanArena();
    const tallied = 12;
    state.boonRun.tallies[TALLY] = tallied;
    expect(countPer(state, { kind: "tally", key: TALLY }, null), "数えをそのまま返す").toBe(tallied);
    const out = applyModifiers(state, { tags: new Set(["melee"]) }, null, [perTally]);
    expect(out.more[0]?.mul, "12 / 5 = 2 段").toBeCloseTo(1.02);
  });

  it("数えの無い key は 0", () => {
    const state = cleanArena();
    expect(countPer(state, { kind: "tally", key: "none" }, null)).toBe(0);
  });
});

describe("研鑽の stats（temperStat）", () => {
  const temper: TemperStat = { tally: TALLY, stat: "maxMana", per: 1, every: EVERY };

  it("foldBoonStats が per × floor(数え / every) を足す", () => {
    const state = cleanArena();
    withDef({ temperStat: temper });
    const base = foldBoonStats(state.stats, [HOST], { ...state.boonRun, tallies: {} });
    const grown = foldBoonStats(state.stats, [HOST], { ...state.boonRun, tallies: { [TALLY]: 7 } });
    expect(grown.maxMana - base.maxMana, "7 / 3 = 2 段").toBe(2);
  });

  it("cap で足す量を止める", () => {
    expect(temperAmount({ ...temper, cap: 3 }, 100), "上限 3").toBe(3);
    expect(temperAmount(temper, EVERY - 1), "every 未満は 0").toBe(0);
  });

  it("持っていない研鑽は畳まない", () => {
    const state = cleanArena();
    withDef({ temperStat: temper });
    const out = foldBoonStats(state.stats, [], { ...state.boonRun, tallies: { [TALLY]: 30 } });
    expect(out.maxMana).toBe(foldBoonStats(state.stats, [], state.boonRun).maxMana);
  });

  it("addTally は段が変わった時だけ stats を畳み直す", () => {
    const state = cleanArena();
    withDef({ temperStat: temper });
    state.boons.push(HOST);
    applyStats(state, state.stats);
    const before = state.stats.maxMana;
    addTally(state, TALLY, EVERY - 1);
    expect(state.stats.maxMana, "段に届かないうちは変わらない").toBe(before);
    addTally(state, TALLY, 1);
    expect(state.stats.maxMana, "3 で 1 段").toBe(before + 1);
    addTally(state, TALLY, 1, "max");
    expect(state.boonRun.tallies[TALLY], "max は小さい値で下げない").toBe(EVERY);
  });
});

describe("決定性", () => {
  /** ダッシュで数える祝福を持って、同じ入力列を流す */
  function run(seed: number): { tally: number | undefined; rng: number } {
    const state = cleanArena(seed);
    withDef({ rules: [tallyRule({ when: "onDash" })] });
    state.boons.push(HOST);
    const dashes = 3;
    for (let i = 0; i < dashes * 20; i++) {
      state.player.dashChargesLeft = state.stats.dashCharges;
      state.player.dashCooldown = 0;
      step(state, withInput({ dashPressed: i % 20 === 0, move: { x: 1, y: 0 } }), FIXED_DT);
    }
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0);
    return { tally: state.boonRun.tallies[TALLY], rng: state.rng.next() };
  }

  it("同じ seed と入力なら同じ数えと乱数列", () => {
    const a = run(11);
    const b = run(11);
    expect(a.tally, "ダッシュを数える").toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});
