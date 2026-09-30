import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { BOSS } from "../data/tuning";
import { generateSkillStone } from "../skills/generator";
import { bossEnemy, deepRotation } from "./boss";
import { BOSS_REWARD_KIND, grantBossReward } from "./bossRewards";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { buildFloor } from "./floor";

const R = BOSS.rules.rewards;
/** 最深の間の深度（章 4 × 5 階 + 1） */
const FINAL_DEPTH = 21;

function rewardState(seed = 7, depth = 10): GameState {
  const state = createGame(seed);
  state.depth = depth;
  return state;
}

/** 報酬で増えうるものの数 */
function snapshot(state: GameState): Record<string, number> {
  return {
    flasks: state.pickups.filter((p) => p.kind === "flask").length,
    coins: state.economy.coins,
    keys: state.economy.keys,
    runes: state.skills.runes.length,
    stones: state.skills.floorStones.length,
    items: state.floorItems.length,
  };
}

describe("固有の報酬", () => {
  it("スライム王は瓶、盗賊王は銭と鍵、油壺の王は刻印符、鏡の騎士はスキル石、最深の主は名のある遺物を落とす", () => {
    const pos = { x: 0, y: 0 };
    const cases: readonly (readonly [string, (b: Record<string, number>, a: Record<string, number>) => void])[] = [
      ["kingSlime", (b, a) => expect(a.flasks, "瓶").toBe((b.flasks ?? 0) + R.flasks)],
      [
        "thiefKing",
        (b, a) => {
          expect(a.coins, "銭").toBeGreaterThan(b.coins ?? 0);
          expect(a.keys, "鍵").toBe((b.keys ?? 0) + R.keys);
        },
      ],
      ["oilKing", (b, a) => expect(a.runes, "刻印符").toBe((b.runes ?? 0) + R.runes)],
      ["mirrorKnight", (b, a) => expect(a.stones, "スキル石").toBe((b.stones ?? 0) + 1)],
      ["deepLord", (b, a) => expect(a.items, "遺物").toBe((b.items ?? 0) + 1)],
    ];
    for (const [key, check] of cases) {
      const state = rewardState(7, key === "deepLord" ? FINAL_DEPTH : 10);
      const before = snapshot(state);
      grantBossReward(state, key, pos);
      check(before, snapshot(state));
    }
  });

  it("最深の主の遺物は名のある遺物", () => {
    const state = rewardState(7, FINAL_DEPTH);
    grantBossReward(state, "deepLord", { x: 0, y: 0 });
    expect(state.floorItems.at(-1)?.item.namedKey).toBeDefined();
  });

  it("盗賊王の銭は深いほど多い", () => {
    const shallow = rewardState(7, 10);
    const deep = rewardState(7, 30);
    grantBossReward(shallow, "thiefKing", { x: 0, y: 0 });
    grantBossReward(deep, "thiefKing", { x: 0, y: 0 });
    expect(deep.economy.coins).toBeGreaterThan(shallow.economy.coins);
  });

  it("鏡の騎士の石は持っているスキルと違う", () => {
    // 同じ seed の別の state で、引き直さなければ出る石を先に知る
    const probe = rewardState(9);
    const first = generateSkillStone(probe.rng, { foundDepth: probe.depth, now: 0, moveset: probe.stats.moveset });
    const state = rewardState(9);
    state.skills.profile.stones = [generateSkillStone(createRng(1), { foundDepth: 1, now: 0, skillKey: first.skillKey })];
    grantBossReward(state, "mirrorKnight", { x: 0, y: 0 });
    const dropped = state.skills.floorStones.at(-1)?.stone.skillKey;
    expect(dropped).toBeDefined();
    expect(dropped, "持っているスキルを避ける").not.toBe(first.skillKey);
  });

  it("深みの回転のボスは固有の報酬を持たない", () => {
    const chapterKeys = ["kingSlime", "thiefKing", "oilKing", "mirrorKnight"];
    const deepOnly = deepRotation().filter((k) => !chapterKeys.includes(k));
    expect(deepOnly.length).toBe(5);
    for (const key of deepOnly) {
      expect(BOSS_REWARD_KIND[key], key).toBeUndefined();
      const state = rewardState();
      const before = snapshot(state);
      grantBossReward(state, key, { x: 0, y: 0 });
      expect(snapshot(state), key).toEqual(before);
    }
  });

  it("スライム王を倒すと撃破の場に瓶が出る", () => {
    const state = createGame(21);
    state.depth = BOSS.interval;
    buildFloor(state);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("no boss");
    const before = state.pickups.filter((p) => p.kind === "flask").length;
    damageEnemy(state, boss, boss.hp + 1, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.pickups.filter((p) => p.kind === "flask").length).toBe(before + R.flasks);
  });
});
