import { REACH_DEFS, hasReach } from "../loot/reach";
import { REACH_KEYS, type PlayerStats } from "../loot/types";
import type { EffectRow } from "./effectsList";

/** 届いた到達の右寄せの表示（届いていなければ「今 / 閾値」） */
const REACHED_INFO = "到達";

/**
 * 書付「体」に出す到達の行。装備だけで数えた量が 0 の軸は出さない（狙っていない軸を並べない）。
 * 拠点でもラン中でも同じ値（stats.reach は装備だけ）
 */
export function reachRows(stats: Readonly<PlayerStats>): EffectRow[] {
  const rows: EffectRow[] = [];
  for (const key of REACH_KEYS) {
    const def = REACH_DEFS[key];
    const value = stats.reach[key];
    if (value <= 0) continue;
    const now = def.format(value);
    const goal = def.format(def.threshold);
    rows.push({
      key: `reach:${key}`,
      name: def.name,
      info: hasReach(stats, key) ? REACHED_INFO : `${now}/${goal}`,
      detail: `${def.measureLabel} ${now} / ${goal}: ${def.effect}`,
    });
  }
  return rows;
}
