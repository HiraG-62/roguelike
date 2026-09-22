import { DEFAULT_STATS, type Equipment, type PlayerStats } from "./types";

/**
 * 装備から PlayerStats を畳み込む。
 * TODO(loot-core): 暫定スタブ。ベースの implicit とアフィックスを適用する実装に置き換える。
 */
export function computeStats(_equipment: Equipment): PlayerStats {
  return { ...DEFAULT_STATS };
}
