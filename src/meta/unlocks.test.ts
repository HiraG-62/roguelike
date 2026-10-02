import { describe, expect, it } from "vitest";
import { ARC, ROOM_KIND } from "../data/tuning";
import { CONTRACTOR_KEYS } from "../system/contractors";
import { RUN_EVENT_KEYS } from "../system/runEvents";
import { ROOM_KIND_LABEL } from "../system/specialRooms";
import { createCodexSave } from "./codex";
import { QUEST_KEYS, QUESTS, createQuestSave } from "./quests";
import { CONTRACTOR_UNLOCKS, EVENT_UNLOCKS, ROOM_UNLOCKS, isUnlocked, lockedRunContent, questUnlockLabels, unlockHint, unlockNewsLines } from "./unlocks";

function sources() {
  return { codex: createCodexSave(), quests: createQuestSave() };
}

const EXTRA_ROOMS = Object.keys(ROOM_KIND.extra);

describe("解放制の表", () => {
  it("契約者 9・追加の部屋 20・ランイベント 28 を全部持つ", () => {
    expect(Object.keys(CONTRACTOR_UNLOCKS).sort(), "契約者").toEqual([...CONTRACTOR_KEYS].sort());
    expect(Object.keys(ROOM_UNLOCKS).sort(), "追加の部屋").toEqual([...EXTRA_ROOMS].sort());
    expect(Object.keys(EVENT_UNLOCKS).sort(), "ランイベント").toEqual([...RUN_EVENT_KEYS].sort());
    expect(CONTRACTOR_KEYS.length).toBe(9);
    expect(EXTRA_ROOMS.length).toBe(20);
    expect(RUN_EVENT_KEYS.length).toBe(28);
  });

  it("章の条件は ARC の章の範囲に収まり、依頼の条件は実在の依頼を指す", () => {
    const tables = [...Object.values(CONTRACTOR_UNLOCKS), ...Object.values(ROOM_UNLOCKS), ...Object.values(EVENT_UNLOCKS)];
    for (const c of tables) {
      if (c.kind === "chapterBoss") {
        expect(c.chapter, "章").toBeGreaterThanOrEqual(1);
        expect(c.chapter, "章").toBeLessThanOrEqual(ARC.chapters.length);
      }
      if (c.kind === "quest") expect(QUEST_KEYS, "依頼").toContain(c.quest);
    }
  });

  it("契約者の依頼の割り当ては重ならない", () => {
    const quests = Object.values(CONTRACTOR_UNLOCKS).flatMap((c) => (c.kind === "quest" ? [c.quest] : []));
    expect(new Set(quests).size, "依頼の重複").toBe(quests.length);
  });
});

describe("解放の判定", () => {
  it("空の保存データでは契約者 3・部屋 5・出来事 9 だけが開いている", () => {
    const locked = lockedRunContent(sources());
    expect(CONTRACTOR_KEYS.length - locked.lockedContractors.length, "契約者").toBe(3);
    expect(EXTRA_ROOMS.length - locked.lockedRooms.length, "部屋").toBe(5);
    expect(RUN_EVENT_KEYS.length - locked.lockedEvents.length, "出来事").toBe(9);
  });

  it("章 1 の主を倒すと部屋 5・出来事 7 が開く", () => {
    const src = sources();
    const before = lockedRunContent(src);
    src.codex.enemyKills[ARC.chapters[0]?.boss ?? ""] = 1;
    const after = lockedRunContent(src);
    expect(before.lockedRooms.length - after.lockedRooms.length, "部屋").toBe(5);
    expect(before.lockedEvents.length - after.lockedEvents.length, "出来事").toBe(7);
    expect(after.lockedContractors, "契約者は変わらない").toEqual(before.lockedContractors);
  });

  it("章の主を全部倒すと部屋・出来事の封じが空になる", () => {
    const src = sources();
    for (const c of ARC.chapters.slice(0, 3)) src.codex.enemyKills[c.boss] = 2;
    const locked = lockedRunContent(src);
    expect(locked.lockedRooms).toEqual([]);
    expect(locked.lockedEvents).toEqual([]);
  });

  it("依頼を達成すると対応の契約者が開く", () => {
    const src = sources();
    expect(lockedRunContent(src).lockedContractors, "最初は封じている").toContain("ferryman");
    src.quests.completed.thunderRing = 1;
    const locked = lockedRunContent(src);
    expect(locked.lockedContractors).not.toContain("ferryman");
    expect(locked.lockedContractors.length, "他の契約者は封じたまま").toBe(5);
  });

  it("封じの並びは表の順で、同じ保存データなら同じ", () => {
    expect(lockedRunContent(sources())).toEqual(lockedRunContent(sources()));
    expect(lockedRunContent(sources()).lockedRooms.slice(0, 2), "表の順").toEqual(["forge", "exchange"]);
  });

  it("isUnlocked: 最初から / 章 / 依頼", () => {
    const src = sources();
    expect(isUnlocked({ kind: "start" }, src)).toBe(true);
    expect(isUnlocked({ kind: "chapterBoss", chapter: 99 }, src), "無い章は開かない").toBe(false);
    expect(isUnlocked({ kind: "quest", quest: "burnout" }, src)).toBe(false);
    src.quests.completed.burnout = 1;
    expect(isUnlocked({ kind: "quest", quest: "burnout" }, src)).toBe(true);
  });
});

describe("解放の文", () => {
  it("unlockHint は開く条件を語り、最初から開いているものは空", () => {
    expect(unlockHint({ kind: "start" })).toBe("");
    expect(unlockHint({ kind: "chapterBoss", chapter: 1 })).toContain("を倒すと現れる");
    expect(unlockHint({ kind: "quest", quest: "burnout" })).toContain(QUESTS.burnout.name);
  });

  it("questUnlockLabels は依頼で開く契約者だけを返す", () => {
    expect(questUnlockLabels("thunderRing")).toHaveLength(1);
    expect(questUnlockLabels("kingslayer"), "契約者に繋がらない依頼").toEqual([]);
    for (const key of QUEST_KEYS) for (const l of questUnlockLabels(key)) expect(l).toContain("がランに現れる");
  });

  it("新しく開いた分だけ知らせの行になり、何も開かなければ空", () => {
    const src = sources();
    const before = lockedRunContent(src);
    expect(unlockNewsLines(before, lockedRunContent(src)), "変化なし").toEqual([]);
    src.codex.enemyKills[ARC.chapters[0]?.boss ?? ""] = 1;
    src.quests.completed.thunderRing = 1;
    const lines = unlockNewsLines(before, lockedRunContent(src));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("部屋 5");
    expect(lines[0]).toContain("出来事 7");
    expect(lines[0]).toContain("契約者");
  });

  it("追加の部屋の名前は全部引ける（図鑑・知らせが名前を引く前提）", () => {
    for (const kind of EXTRA_ROOMS) expect(ROOM_KIND_LABEL[kind as keyof typeof ROOM_KIND_LABEL], kind).toBeTruthy();
  });
});
