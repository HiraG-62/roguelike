import { describe, expect, it } from "vitest";
import type { RunHistoryEntry } from "../loot/types";
import { isEmptyRunMeta } from "../system/runMeta";
import { ARC } from "../data/tuning";
import { createCodexSave } from "./codex";
import { QUEST_KEYS, createQuestSave } from "./quests";
import { type RunMetaSources, buildRunMeta, nemesisFromHistory } from "./runMetaSetup";

const DAILY_SEED = "2026-09-30";

function row(partial: Partial<RunHistoryEntry>): RunHistoryEntry {
  return { date: 0, seedText: "abc", depth: 6, kills: 0, score: 0, bestCombo: 0, durationSec: 0, cause: "defeated", ...partial };
}

/** 章ボスを全部倒し、依頼を全部達成した保存データ（解放制の封じが空になる） */
function openSources(partial: Pick<RunMetaSources, "history" | "daily">): RunMetaSources {
  const codex = createCodexSave();
  for (const c of ARC.chapters) codex.enemyKills[c.boss] = 1;
  const quests = createQuestSave();
  for (const k of QUEST_KEYS) quests.completed[k] = 1;
  return { ...partial, codex, quests, meta: {} };
}

describe("仇の種の選び方", () => {
  it("直近の力尽きた履歴の grudge が仇になる", () => {
    const history = [row({ depth: 7, grudge: { key: "wolf", elites: ["hasted"] } }), row({ grudge: { key: "slime", elites: [] } })];
    expect(nemesisFromHistory(history)).toEqual({ key: "wolf", elites: ["hasted"], depth: 7 });
  });

  it("仇を討った履歴より前の死は仇にしない", () => {
    const history = [row({ cause: "abandoned", avenged: true }), row({ grudge: { key: "wolf", elites: [] } })];
    expect(nemesisFromHistory(history)).toBeNull();
  });

  it("仇を討った後に力尽きたランは、その死の相手が次の仇になる", () => {
    const history = [row({ avenged: true, depth: 7, grudge: { key: "slime", elites: [] } }), row({ grudge: { key: "wolf", elites: [] } })];
    expect(nemesisFromHistory(history)).toEqual({ key: "slime", elites: [], depth: 7 });
  });

  it("離脱・踏破の履歴は飛ばし、デイリーの履歴は数えない", () => {
    const history = [
      row({ cause: "abandoned" }),
      row({ cause: "cleared" }),
      row({ seedText: DAILY_SEED, grudge: { key: "slime", elites: [] } }),
      row({ seedText: DAILY_SEED, avenged: true }),
      row({ depth: 9, grudge: { key: "wolf", elites: [] } }),
    ];
    expect(nemesisFromHistory(history)).toEqual({ key: "wolf", elites: [], depth: 9 });
  });

  it("直近の力尽きた行に grudge が無ければ仇は無い", () => {
    expect(nemesisFromHistory([row({}), row({ grudge: { key: "wolf", elites: [] } })])).toBeNull();
  });

  it("消えた敵・ボス・未知の修飾子は捨てる", () => {
    expect(nemesisFromHistory([row({ grudge: { key: "nope", elites: [] } })]), "消えた敵").toBeNull();
    expect(nemesisFromHistory([row({ grudge: { key: "kingSlime", elites: [] } })]), "ボス").toBeNull();
    expect(nemesisFromHistory([row({ grudge: { key: "wolf", elites: ["nope", "shielded"] } })])?.elites, "未知の修飾子").toEqual(["shielded"]);
  });

  it("デイリーの runMeta は空、通常は仇を持つ", () => {
    const history = [row({ grudge: { key: "wolf", elites: [] } })];
    expect(isEmptyRunMeta(buildRunMeta(openSources({ history, daily: true })))).toBe(true);
    expect(buildRunMeta(openSources({ history, daily: false })).nemesis?.key).toBe("wolf");
    expect(isEmptyRunMeta(buildRunMeta(openSources({ history: [], daily: false }))), "履歴が無ければ空").toBe(true);
  });
});

describe("解放制と位階の見返りの持ち込み", () => {
  it("空の保存データでは要素を封じ、踏破の見返りは無い（今までのセーブにも効く）", () => {
    const meta = buildRunMeta({ history: [], daily: false, codex: createCodexSave(), quests: createQuestSave(), meta: {} });
    expect(meta.lockedContractors.length, "契約者").toBe(6);
    expect(meta.lockedRooms.length, "部屋").toBe(15);
    expect(meta.lockedEvents.length, "出来事").toBe(19);
    expect(meta.perks).toEqual([]);
  });

  it("デイリーは封じも見返りも持ち込まない", () => {
    const meta = buildRunMeta({ history: [], daily: true, codex: createCodexSave(), quests: createQuestSave(), meta: { clears: 3, bestClearTier: 12 } });
    expect(isEmptyRunMeta(meta)).toBe(true);
  });

  it("踏破した最高位階に応じて見返りが入る", () => {
    const meta = buildRunMeta({ ...openSources({ history: [], daily: false }), meta: { clears: 1, bestClearTier: 10 } });
    expect(meta.perks).toEqual(["market", "exit"]);
  });

  it("同じ保存データなら同じ runMeta になる（記録に載るので決定的）", () => {
    const a = buildRunMeta({ history: [], daily: false, codex: createCodexSave(), quests: createQuestSave(), meta: {} });
    const b = buildRunMeta({ history: [], daily: false, codex: createCodexSave(), quests: createQuestSave(), meta: {} });
    expect(a).toEqual(b);
  });
});
