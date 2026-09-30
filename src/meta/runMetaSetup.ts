import { isDailySeedText } from "../core/replay";
import type { ProfileMeta, RunHistoryEntry } from "../loot/types";
import { type NemesisSpec, type RunMetaSetup, emptyRunMeta, sanitizeNemesisSpec } from "../system/runMeta";
import type { CodexSave } from "./codex";
import type { QuestSave } from "./quests";
import { tierPerks } from "./tierRewards";
import { lockedRunContent } from "./unlocks";

/**
 * 保存データから RunSetup.runMeta を組む（main.ts の withRunMeta がラン開始のたびに呼ぶ。docs/ideas/meta-impl.md 2-8）。
 * 組んだ値はリプレイに記録されるので、ここは乱数も時刻も使わない
 */

export interface RunMetaSources {
  /** プロフィールの履歴（新しい順） */
  history: readonly RunHistoryEntry[];
  /** デイリー（今日の挑戦）なら true。デイリーは記録を競うので何も持ち込まない（封じも見返りも無し） */
  daily: boolean;
  /** 図鑑（章ボスの撃破 = 解放の条件） */
  codex: Readonly<CodexSave>;
  /** 依頼（達成 = 解放の条件） */
  quests: Readonly<QuestSave>;
  /** プロフィールの統計（踏破の回数・最高位階 = 位階の見返り） */
  meta: Readonly<Pick<ProfileMeta, "clears" | "bestClearTier">>;
}

const CAUSE_DEFEATED = "defeated";

/**
 * 仇の種: 新しい順に見て、デイリーの行は飛ばし、最初の「力尽きた」行の grudge（無ければ null）。
 * それより先に仇を討った行（離脱・踏破）に当たったら null、離脱・踏破は飛ばす。
 * 仇を討った後に力尽きたランは、討った後の死なのでその行の grudge を使う。消えた敵・仇になれない敵・未知の修飾子は捨てる
 */
export function nemesisFromHistory(history: readonly RunHistoryEntry[]): NemesisSpec | null {
  for (const h of history) {
    if (isDailySeedText(h.seedText)) continue;
    if (h.cause === CAUSE_DEFEATED) {
      return h.grudge ? sanitizeNemesisSpec({ key: h.grudge.key, elites: h.grudge.elites, depth: h.depth }) : null;
    }
    if (h.avenged === true) return null;
  }
  return null;
}

export function buildRunMeta(sources: RunMetaSources): RunMetaSetup {
  const meta = emptyRunMeta();
  if (sources.daily) return meta;
  meta.nemesis = nemesisFromHistory(sources.history);
  const locked = lockedRunContent({ codex: sources.codex, quests: sources.quests });
  meta.lockedRooms = locked.lockedRooms;
  meta.lockedContractors = locked.lockedContractors;
  meta.lockedEvents = locked.lockedEvents;
  meta.perks = tierPerks(sources.meta);
  return meta;
}
