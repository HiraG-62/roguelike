import { ACHIEVEMENTS, type AchievementSave, availableTitles, isAchievementUnlocked } from "./achievements";
import { CODEX_TABS, CODEX_TAB_LABEL, type CodexPages, type CodexSave, codexEntries } from "./codex";
import type { ListEntry, ListTab } from "./listScreen";
import {
  QUESTS,
  QUEST_KEYS,
  type QuestKey,
  type QuestOutcome,
  type QuestSave,
  type QuestSnapshotSource,
  isQuestCompleted,
  questProgress,
  questRewardLabel,
  questSnapshot,
} from "./quests";

/** 図鑑・依頼の一覧・実績の各画面に並べるタブと項目（src/meta/listScreen.ts の形へ組み立てる） */

const NO_TITLE_KEY = "none";

export function codexListTabs(save: CodexSave, pages: CodexPages): ListTab[] {
  return CODEX_TABS.map((tab) => {
    const entries = codexEntries(save, tab, pages);
    const known = entries.filter((e) => e.known).length;
    const count = tab === "chain" ? `${known}` : `${known}/${entries.length}`;
    const empty = tab === "chain" ? "まだ連鎖をつないでいない。祝福やスキルの効果が次の効果を呼ぶと記録される。" : undefined;
    return { label: `${CODEX_TAB_LABEL[tab]} ${count}`, entries, empty };
  });
}

function questEntry(key: QuestKey, done: boolean): ListEntry {
  const def = QUESTS[key];
  return {
    key,
    known: !done,
    name: def.name,
    info: done ? "達成" : `目標 ${def.goal}`,
    detail: `${def.desc} 報酬: ${questRewardLabel(def.reward)}`,
  };
}

/** 依頼の一覧（タイトルの「依頼」）。未達成 / 達成済みの 2 タブ */
export function questBoardTabs(save: QuestSave): ListTab[] {
  const open = QUEST_KEYS.filter((k) => !isQuestCompleted(save, k));
  const done = QUEST_KEYS.filter((k) => isQuestCompleted(save, k));
  return [
    { label: `未達成 ${open.length}`, entries: open.map((k) => questEntry(k, false)), empty: "すべての依頼を達成した。" },
    { label: `達成済み ${done.length}`, entries: done.map((k) => questEntry(k, true)), empty: "まだ達成した依頼はない。ラン開始時に 1 つ受けられる。" },
  ];
}

/** 実績画面。実績の一覧と、名乗る称号を選ぶタブ */
export function achievementTabs(ach: AchievementSave, quests: QuestSave): ListTab[] {
  const unlocked = ACHIEVEMENTS.filter((a) => isAchievementUnlocked(ach, a.key)).length;
  const list: ListEntry[] = ACHIEVEMENTS.map((a) => {
    const known = isAchievementUnlocked(ach, a.key);
    return { key: a.key, known, name: a.name, info: known ? "解除" : "", detail: a.desc };
  });
  const titles = availableTitles(ach, quests);
  const titleEntries: ListEntry[] = [
    { key: NO_TITLE_KEY, known: true, name: "称号なし", info: "", detail: "称号を外す。", marked: ach.title === null },
    ...titles.map((t) => ({ key: t.id, known: true, name: t.label, info: t.from, detail: `決定で名乗る（${t.from}で得た称号）。`, marked: ach.title === t.id })),
  ];
  return [
    { label: `実績 ${unlocked}/${ACHIEVEMENTS.length}`, entries: list },
    { label: `称号 ${titles.length}`, entries: titleEntries },
  ];
}

/** 称号タブの項目 key → 名乗る称号の id（「称号なし」は null） */
export function titleIdOfEntry(key: string): string | null {
  return key === NO_TITLE_KEY ? null : key;
}

/** 実績画面の称号タブの添字 */
export const ACHIEVEMENT_TITLE_TAB = 1;

/** ポーズ画面に出す、受けている依頼の進み（受けていなければ空文字） */
export function questStatusLine(state: QuestSnapshotSource): string {
  const key = state.questRun.key;
  if (key === null) return "";
  const p = questProgress(key, questSnapshot(state));
  return `依頼「${QUESTS[key].name}」 ${p.value}/${p.goal}${p.done ? "（達成）" : ""}`;
}

/** ラン終了時の結果の行（死亡画面に出す）。何も無ければ空配列 */
export function metaSummaryLines(outcome: QuestOutcome | null, discovered: number, unlocked: readonly string[]): string[] {
  const lines: string[] = [];
  if (outcome !== null) {
    const def = QUESTS[outcome.key];
    const head = `依頼「${def.name}」 ${outcome.value}/${outcome.goal}`;
    if (outcome.newlyCompleted) lines.push(`${head} 達成！ ${questRewardLabel(def.reward)}`);
    else lines.push(outcome.done ? `${head} 達成（報酬は受け取り済み）` : `${head} 未達成（次のランへ引き継ぐ）`);
  }
  const names = unlocked.map((k) => ACHIEVEMENTS.find((a) => a.key === k)?.name ?? k);
  const extra: string[] = [];
  if (discovered > 0) extra.push(`図鑑に ${discovered} 件の記録`);
  if (names.length > 0) extra.push(`実績「${names.join("」「")}」`);
  if (extra.length > 0) lines.push(extra.join(" / "));
  return lines;
}
