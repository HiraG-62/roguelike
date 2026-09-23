import { QUEST_KEYS, type QuestSave, createQuestSave, isQuestKey } from "./quests";
import { isRecord, readJson, sanitizeCount, writeJson } from "./storage";

/** 依頼の永続化。壊れたデータ・未知の version は黙って既定（何も達成していない）へ落とす */
export const QUEST_KEY = "roguelike.quests.v1";
const CURRENT_VERSION = 1;

export function parseQuestSave(parsed: unknown): QuestSave | null {
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return null;
  const save = createQuestSave();
  const completed = isRecord(parsed.completed) ? parsed.completed : {};
  for (const key of QUEST_KEYS) {
    if (completed[key] !== undefined) save.completed[key] = sanitizeCount(completed[key]);
  }
  save.active = isQuestKey(parsed.active) ? parsed.active : null;
  return save;
}

export function loadQuests(storage?: Storage): QuestSave {
  return parseQuestSave(readJson(QUEST_KEY, storage)) ?? createQuestSave();
}

export function saveQuests(save: QuestSave, storage?: Storage): void {
  writeJson(QUEST_KEY, save, storage);
}
