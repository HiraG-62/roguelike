import { describe, expect, it } from "vitest";
import { type GameEvent, enemyTarget } from "../core/events";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { type Rule, SCOPE_ANY } from "../core/rules";
import type { GameState } from "../core/state";
import { FORM, STATUS, SYNERGY } from "../data/tuning";
import { REACH_DEFS } from "../loot/reach";
import type { ReachKey } from "../loot/types";
import { gainMorale, tickMorale } from "./morale";
import { resolveRules } from "./rules";
import { applyStatus, findStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

/** 到達の効き先 3 か所（rules.ts の連鎖 / statusEffects.ts の重ねの上限 / morale.ts の冷め）。届いていなければ今までどおり */

const NEAR = 20;
const TRIALS = 400;
const BIG_STACKS = 30;
const LONG = 10;
const COLD_SECONDS = 6;
const CHAIN_COEF = 0.3;
const RULE_CHANCE = 0.5;

/** 指定した軸だけ閾値に届いた stats にする（装備を経由せず到達だけを切り替える。null なら全部届かない） */
function withReach(state: GameState, key: ReachKey | null): void {
  const reach = { chain: 0, burn: 0, morale: 0 };
  if (key !== null) reach[key] = REACH_DEFS[key].threshold;
  state.stats = { ...state.stats, reach: Object.freeze(reach) };
}

function makeRule(chance: number): Rule {
  return {
    id: "test:reach:0",
    when: "onMeleeHit",
    if: [],
    chance,
    icd: 0,
    scope: SCOPE_ANY,
    owner: { kind: "boon", key: "test" },
    then: { kind: "restoreMana", magnitude: 1, quiet: true },
  };
}

function cleanArena(seed = 11): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function chainedHit(e: ReturnType<typeof placeEnemy>, visits: readonly number[], coef: number): GameEvent {
  return {
    kind: "onMeleeHit",
    actor: "player",
    depth: 1,
    source: { kind: "player", key: "test" },
    ...enemyTarget(e),
    visits,
    coef,
  };
}

/** 連鎖係数 coef のイベントを trials 回流し、Rule が起きた回数を返す */
function countFires(reach: ReachKey | null, visits: (id: number) => readonly number[] = () => [], coef = CHAIN_COEF): number {
  const state = cleanArena();
  withReach(state, reach);
  const e = placeEnemy(state, "slime", NEAR);
  const rule = makeRule(RULE_CHANCE);
  let fired = 0;
  for (let i = 0; i < TRIALS; i++) {
    state.pendingEvents.push(chainedHit(e, visits(e.id), coef));
    // 語の窓を毎回明けて回数上限に掛けない
    resolveRules(state, SYNERGY.keywordWindow, [rule]);
    fired += state.ruleRun.keywordUse.get("mana") ?? 0;
  }
  return fired;
}

describe("無尽（連鎖が衰えない）", () => {
  it("連鎖係数 0.3 の効果から起きた Rule も元の確率で起きる", () => {
    const fired = countFires("chain");
    expect(fired, "元の確率 0.5 前後").toBeGreaterThan(TRIALS * 0.4);
    expect(fired, "元の確率 0.5 前後").toBeLessThan(TRIALS * 0.6);
  });

  it("到達していなければ連鎖係数が掛かって確率が下がる（今までどおり）", () => {
    const fired = countFires(null);
    expect(fired, "0.5 × 0.3 = 0.15 前後").toBeLessThan(TRIALS * 0.3);
  });

  it("無尽でも同じ敵への訪問回数で連鎖は止まる", () => {
    const fired = countFires("chain", (id) => [id, id]);
    expect(fired, "同じ敵への 2 度目は起きない").toBe(0);
  });
});

describe("燎原（燃焼の重ねの上限なし）", () => {
  function burnStacks(reach: ReachKey | null): { enemy: number | undefined; player: number | undefined } {
    const state = arena(5);
    withReach(state, reach);
    const e = placeEnemy(state, "slime", NEAR);
    e.hp = 1_000_000;
    e.maxHp = 1_000_000;
    const burn = { kind: "burn", stacks: BIG_STACKS, duration: LONG, potency: 1 } as const;
    applyStatus(state, { kind: "enemy", enemy: e }, burn, "player");
    applyStatus(state, { kind: "player" }, burn, "enemy");
    return { enemy: findStatus(e.status, "burn")?.stacks, player: findStatus(state.player.status, "burn")?.stacks };
  }

  it("敵の燃焼が上限を越えて重なり、プレイヤーの燃焼は 1 のまま", () => {
    const stacks = burnStacks("burn");
    expect(stacks.enemy, "敵は付与した重ねのまま").toBe(BIG_STACKS);
    expect(stacks.enemy, "通常の上限を越える").toBeGreaterThan(STATUS.burnMaxStacks);
    expect(stacks.player, "プレイヤーの燃焼は 1").toBe(1);
  });

  it("到達していなければ燃焼の上限で止まる（今までどおり）", () => {
    expect(burnStacks(null).enemy).toBe(STATUS.burnMaxStacks);
  });
});

describe("常在（戦意が冷めない）", () => {
  /** 連刃の熱を溜め、冷めの秒を十分に過ぎるまで進めたあとの値 */
  function moraleAfterCooling(reach: ReachKey | null): { before: number; after: number } {
    const state = arena(5, { moveset: "twinBlades" });
    withReach(state, reach);
    gainMorale(state, "meleeHit");
    const before = state.player.morale.value;
    const steps = Math.ceil((FORM.flurry.decayDelaySec + COLD_SECONDS) / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      tickMorale(state, EMPTY_INPUT, FIXED_DT);
    }
    return { before, after: state.player.morale.value };
  }

  it("戦意が時間で冷めない", () => {
    const { before, after } = moraleAfterCooling("morale");
    expect(before, "熱が溜まっている").toBeGreaterThan(0);
    expect(after, "冷めの秒を過ぎても減らない").toBe(before);
  });

  it("到達していなければ冷める（今までどおり）", () => {
    const { before, after } = moraleAfterCooling(null);
    expect(after, "冷めの秒を過ぎたら減る").toBeLessThan(before);
  });
});
