import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../loot/types";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_KEY,
  type AchievementContext,
  availableTitles,
  createAchievementSave,
  currentTitleLabel,
  evaluateAchievements,
  loadAchievements,
  parseAchievementSave,
  saveAchievements,
  selectTitle,
} from "./achievements";
import { createCodexSave } from "./codex";
import { QUEST_KEYS, createQuestSave } from "./quests";
import { MemoryStorage } from "./testStorage";

function context(): AchievementContext {
  return { codex: createCodexSave(), quests: createQuestSave(), meta: createEmptyProfile().meta };
}

describe("実績: 定義", () => {
  it("30 種以上あり、key と名前が重ならない", () => {
    expect(ACHIEVEMENTS.length, "30 種以上").toBeGreaterThanOrEqual(30);
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size, "key").toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size, "名前").toBe(ACHIEVEMENTS.length);
  });

  it("何もしていなければ 1 つも解除されない", () => {
    const save = createAchievementSave();
    expect(evaluateAchievements(context(), save, 1), "解除なし").toEqual([]);
  });
});

describe("実績: 判定", () => {
  it("履歴・図鑑・依頼から解除し、2 回目は解除しない", () => {
    const meta = { ...createEmptyProfile().meta, runs: 10, bestDepth: 3 };
    const ctx = { ...context(), meta };
    ctx.codex.reactions.vaporize = 100;
    ctx.codex.chains["burn>melee>chill"] = 1;
    ctx.quests.completed.burnout = 1;
    const save = createAchievementSave();
    const unlocked = evaluateAchievements(ctx, save, 50);
    for (const key of ["firstRun", "tenRuns", "depth3", "reaction1", "vaporize100", "chain1", "chain3", "quest1"]) {
      expect(unlocked, `${key} を解除`).toContain(key);
    }
    expect(unlocked, "50 回はまだ").not.toContain("fiftyRuns");
    expect(save.unlocked.tenRuns, "解除の時刻").toBe(50);
    expect(evaluateAchievements(ctx, save, 60), "2 回目は無し").toEqual([]);
  });

  it("すべての依頼を達成すると「何でも屋」と「百の出自」", () => {
    const ctx = context();
    for (const key of QUEST_KEYS) ctx.quests.completed[key] = 1;
    const unlocked = evaluateAchievements(ctx, createAchievementSave(), 1);
    expect(unlocked, "全依頼").toContain("questAll");
    expect(unlocked, "全起点").toContain("originsAll");
  });
});

describe("実績: 称号", () => {
  it("解除した実績と依頼の称号を名乗れ、名乗れないものは選べない", () => {
    const ach = createAchievementSave();
    const quests = createQuestSave();
    expect(selectTitle(ach, quests, "a:firstRun"), "未解除は名乗れない").toBe(false);
    ach.unlocked.firstRun = 1;
    quests.completed.burnout = 1;
    const ids = availableTitles(ach, quests).map((t) => t.id);
    expect(ids, "実績と依頼の称号").toEqual(["a:firstRun", "q:burnout"]);
    expect(selectTitle(ach, quests, "q:burnout"), "依頼の称号を名乗る").toBe(true);
    expect(currentTitleLabel(ach, quests), "表示名がある").not.toBeNull();
    expect(selectTitle(ach, quests, null), "外す").toBe(true);
    expect(currentTitleLabel(ach, quests), "外した").toBeNull();
  });
});

describe("実績: 永続化", () => {
  it("保存して読み直すと同じ内容に戻り、壊れたデータは既定へ落とす", () => {
    const storage = new MemoryStorage();
    const save = createAchievementSave();
    save.unlocked.firstRun = 3;
    save.title = "a:firstRun";
    saveAchievements(save, storage);
    expect(loadAchievements(storage), "往復").toEqual(save);
    storage.setItem(ACHIEVEMENTS_KEY, "[");
    expect(loadAchievements(storage), "壊れた JSON").toEqual(createAchievementSave());
    const parsed = parseAchievementSave({ version: 1, unlocked: { firstRun: 1, nope: 2 }, title: "x:bad" });
    expect(parsed?.unlocked, "未知の実績は捨てる").toEqual({ firstRun: 1 });
    expect(parsed?.title, "形の悪い称号は外す").toBeNull();
  });
});
