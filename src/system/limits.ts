import type { GameState } from "../core/state";
import { LIMITS } from "../data/tuning";
import { placedPools } from "./rules";

/** 配列の先頭（古い方）から超えた分を消し、消した数を返す。決定性のため順序は配列の並びだけで決める */
function trimOldest(list: unknown[], limit: number): number {
  const over = list.length - limit;
  if (over <= 0) return 0;
  list.splice(0, over);
  return over;
}

/** プレイヤーの弾だけを古い順に切る。敵の弾は数が多くても回避の遊びなので消さない */
function trimPlayerProjectiles(state: GameState): number {
  const list = state.projectiles;
  let over = list.filter((p) => p.owner === "player").length - LIMITS.playerProjectiles;
  if (over <= 0) return 0;
  const removed = over;
  state.projectiles = list.filter((p) => {
    if (p.owner !== "player" || over <= 0) return true;
    over--;
    return false;
  });
  return removed;
}

/**
 * step の末尾（resolveRules の後）。弾・設置物の同時数が LIMITS を超えたら古い順に消し、
 * 消した数を ruleRun.trimmed に足す。強さの天井ではなく 1 ステップの重さの歯止め
 */
export function enforceLimits(state: GameState): void {
  let trimmed = trimPlayerProjectiles(state);
  trimmed += trimOldest(state.skills.shots, LIMITS.skillShots);
  for (const pool of placedPools(state)) trimmed += trimOldest(pool, LIMITS.placedPerPool);
  state.ruleRun.trimmed += trimmed;
}
