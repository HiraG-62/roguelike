import { isDailySeedText } from "../core/replay";
import type { RunHistoryEntry } from "../loot/types";
import { type NemesisSpec, type RunMetaSetup, emptyRunMeta, sanitizeNemesisSpec } from "../system/runMeta";

/**
 * 保存データから RunSetup.runMeta を組む（main.ts の withRunMeta がラン開始のたびに呼ぶ。docs/ideas/meta-impl.md 2-8）。
 * 組んだ値はリプレイに記録されるので、ここは乱数も時刻も使わない
 */

export interface RunMetaSources {
  /** プロフィールの履歴（新しい順） */
  history: readonly RunHistoryEntry[];
  /** デイリー（今日の挑戦）なら true。デイリーは記録を競うので何も持ち込まない */
  daily: boolean;
}

const CAUSE_DEFEATED = "defeated";

/**
 * 仇の種: 新しい順に見て、デイリーの行は飛ばし、仇を討った行に当たったら null、離脱・踏破は飛ばし、
 * 最初の「力尽きた」行の grudge（無ければ null）。消えた敵・仇になれない敵・未知の修飾子は捨てる
 */
export function nemesisFromHistory(history: readonly RunHistoryEntry[]): NemesisSpec | null {
  for (const h of history) {
    if (isDailySeedText(h.seedText)) continue;
    if (h.avenged === true) return null;
    if (h.cause !== CAUSE_DEFEATED) continue;
    if (!h.grudge) return null;
    return sanitizeNemesisSpec({ key: h.grudge.key, elites: h.grudge.elites, depth: h.depth });
  }
  return null;
}

export function buildRunMeta(sources: RunMetaSources): RunMetaSetup {
  const meta = emptyRunMeta();
  if (sources.daily) return meta;
  meta.nemesis = nemesisFromHistory(sources.history);
  return meta;
}
