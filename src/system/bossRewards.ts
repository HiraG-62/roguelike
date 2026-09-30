import { type GameState, allocId, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { BOSS } from "../data/tuning";
import { generateItem } from "../loot/generator";
import type { Item } from "../loot/types";
import { generateSkillStone } from "../skills/generator";
import type { SkillKey, SkillStone } from "../skills/types";
import { dropFlask, gainCoins, gainKey } from "./economy";
import { overlapsWall } from "./physics";
import { dropRune } from "./skills";

/**
 * 固有の報酬（規則 6。docs/ideas/boss-impl.md 2-7）: 誰を倒したかで撃破の報酬が変わる。
 * 章ボス 4 と最深の主だけが持つ（深みの回転の 5 体はレア 2 だけ）。数は BOSS.rules.rewards
 */

export type BossRewardKind = "flask" | "purse" | "rune" | "stone" | "named";

export const BOSS_REWARD_KIND: Readonly<Partial<Record<string, BossRewardKind>>> = {
  kingSlime: "flask",
  thiefKing: "purse",
  oilKing: "rune",
  mirrorKnight: "stone",
  deepLord: "named",
};

/** 報酬を置く位置の、撃破位置からのずらし（px。レア 2 は左右に出るので下へ並べる） */
const REWARD_DROP_Y = 16;
const REWARD_SPREAD_X = 10;
const REWARD_WALL_RADIUS = 2;

/** ボスの撃破（boss.ts の onBossDeath の major）から 1 回。固有の報酬が無いボスは何もしない */
export function grantBossReward(state: GameState, key: string, pos: Vec): void {
  const r = BOSS.rules.rewards;
  switch (BOSS_REWARD_KIND[key]) {
    case "flask":
      for (let i = 0; i < r.flasks; i++) dropFlask(state, rewardPos(state, pos, i));
      return;
    case "purse":
      gainCoins(state, r.purseBase + r.pursePerDepth * state.depth, "room");
      for (let i = 0; i < r.keys; i++) gainKey(state);
      return;
    case "rune":
      for (let i = 0; i < r.runes; i++) dropRune(state, rewardPos(state, pos, i));
      return;
    case "stone":
      dropFreshStone(state, rewardPos(state, pos, 0));
      return;
    case "named":
      dropNamedRelic(state, rewardPos(state, pos, 0));
      return;
    default:
      return;
  }
}

/** i 番目の報酬の位置: 撃破位置の下に左右交互に並べる。壁に掛かれば撃破位置 */
function rewardPos(state: GameState, pos: Vec, i: number): Vec {
  const side = i % 2 === 0 ? 1 : -1;
  const p = { x: pos.x + side * Math.ceil(i / 2) * REWARD_SPREAD_X, y: pos.y + REWARD_DROP_Y };
  return overlapsWall(state, p.x, p.y, REWARD_WALL_RADIUS) ? { ...pos } : p;
}

/** 持っている（装着中・所持中の）スキルと違う石が出るまで stoneRerolls 回まで引き直す */
function dropFreshStone(state: GameState, pos: Vec): void {
  const owned = new Set<SkillKey>(state.skills.profile.stones.map((s) => s.skillKey));
  let stone = rollStone(state);
  for (let i = 0; i < BOSS.rules.rewards.stoneRerolls && owned.has(stone.skillKey); i++) stone = rollStone(state);
  state.skills.floorStones.push({ id: allocId(state), stone, pos, bobTime: 0, warned: false });
  pushSfx(state, "lootRare");
}

function rollStone(state: GameState): SkillStone {
  // now は決定性に影響しない（id と foundAt の表示用）
  return generateSkillStone(state.rng, { foundDepth: state.depth, now: Date.now(), moveset: state.stats.moveset });
}

/** 名のある遺物（namedKey を持つ）が出るまで namedAttempts 回まで引き直す */
function dropNamedRelic(state: GameState, pos: Vec): void {
  let item = rollRelic(state);
  for (let i = 0; i < BOSS.rules.rewards.namedAttempts && item.namedKey === undefined; i++) item = rollRelic(state);
  state.floorItems.push({ id: allocId(state), item, pos, bobTime: 0 });
  pushSfx(state, "lootRare");
}

function rollRelic(state: GameState): Item {
  const depth = state.depth;
  return generateItem(state.rng, {
    itemLevel: depth + 1,
    rarityBoost: BOSS.rules.rewards.namedBoost,
    foundDepth: depth,
    now: Date.now(),
    excludeNamed: state.lockedRelics,
  });
}
