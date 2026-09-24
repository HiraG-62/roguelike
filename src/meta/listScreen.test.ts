import { describe, expect, it } from "vitest";
import { ORIGIN_KEYS } from "../system/runSetup";
import { activateOriginCursor, createOriginScreen, cursorDescription, ORIGIN_ROWS } from "../ui/origin";
import { createAchievementSave } from "./achievements";
import { createCodexSave } from "./codex";
import { type ListInput, type ListTab, createListScreen, listHitAt, listRowRect, listTabRects, listVisibleRows, stepListScreen } from "./listScreen";
import { createQuestSave, lockedOrigins } from "./quests";
import { ACHIEVEMENT_TITLE_TAB, achievementTabs, codexListTabs, metaSummaryLines, questBoardTabs, titleIdOfEntry } from "./screens";

const ROW_GAP = 12;
const NO_INPUT: ListInput = { navX: 0, navY: 0, wheel: 0, aim: null, aimMoved: false, click: false, confirm: false };

function tabsOf(counts: readonly number[]): ListTab[] {
  return counts.map((n, t) => ({
    label: `t${t}`,
    entries: Array.from({ length: n }, (_, i) => ({ key: `${t}-${i}`, known: true, name: `${i}`, info: "", detail: "" })),
  }));
}

describe("一覧画面: 操作", () => {
  it("←→ でタブを巡り、カーソルとスクロールを戻す", () => {
    const ui = createListScreen();
    const tabs = tabsOf([3, 50]);
    expect(stepListScreen(ui, tabs, { ...NO_INPUT, navX: -1 }, ROW_GAP), "タブ").toBe("tab");
    expect(ui.tab, "左端から右端へ").toBe(1);
    ui.cursor = 5;
    stepListScreen(ui, tabs, { ...NO_INPUT, navX: 1 }, ROW_GAP);
    expect(ui.cursor, "カーソルは先頭へ").toBe(0);
  });

  it("↑↓・ホイールで行を送り、端で止まり、スクロールが追う", () => {
    const ui = createListScreen();
    const tabs = tabsOf([50]);
    expect(stepListScreen(ui, tabs, { ...NO_INPUT, navY: -1 }, ROW_GAP), "上端で止まる").toBe("none");
    const visible = listVisibleRows(ROW_GAP);
    for (let i = 0; i < visible + 2; i++) stepListScreen(ui, tabs, { ...NO_INPUT, wheel: 1 }, ROW_GAP);
    expect(ui.cursor, "送った分だけ進む").toBe(visible + 2);
    expect(ui.scroll, "カーソルが見える位置までスクロール").toBe(3);
  });

  it("タブ・行のクリックと当たり判定", () => {
    const ui = createListScreen();
    const tabs = tabsOf([5, 5]);
    const tab = listTabRects(2)[1];
    if (!tab) throw new Error("タブが無い");
    const clickTab = { ...NO_INPUT, click: true, aim: { x: tab.x + 2, y: tab.y + 2 } };
    expect(stepListScreen(ui, tabs, clickTab, ROW_GAP), "タブをクリック").toBe("tab");
    const row = listRowRect(3, ROW_GAP);
    expect(listHitAt(row.x + 5, row.y + 2, 2, 5, ROW_GAP, 0), "4 行目").toEqual({ kind: "row", index: 3 });
    expect(stepListScreen(ui, tabs, { ...NO_INPUT, click: true, aim: { x: row.x + 5, y: row.y + 2 } }, ROW_GAP), "行をクリックで決定").toBe("activate");
    expect(ui.cursor, "カーソルが移る").toBe(3);
    expect(listHitAt(row.x + 5, listRowRect(7, ROW_GAP).y + 2, 2, 5, ROW_GAP, 0), "項目の無い行").toBeNull();
  });
});

describe("一覧画面: 各画面のタブ", () => {
  it("図鑑は 5 タブ（反応と連鎖は連携の頁にまとめた）、依頼は 2 タブ、実績は実績と称号", () => {
    expect(codexListTabs(createCodexSave(), new Set()).length, "図鑑").toBe(5);
    expect(questBoardTabs(createQuestSave()).length, "依頼").toBe(2);
    const ach = achievementTabs(createAchievementSave(), createQuestSave());
    expect(ach.length, "実績").toBe(2);
    const first = ach[ACHIEVEMENT_TITLE_TAB]?.entries[0];
    expect(first && titleIdOfEntry(first.key), "称号タブの先頭は「称号なし」").toBeNull();
    expect(first?.marked, "何も名乗っていなければ印が付く").toBe(true);
  });

  it("ラン終了の行: 達成・図鑑・実績がそろえば 2 行、何も無ければ 0 行", () => {
    expect(metaSummaryLines(null, 0, []), "何も無い").toEqual([]);
    const lines = metaSummaryLines({ key: "burnout", value: 50, goal: 50, done: true, newlyCompleted: true }, 3, ["firstRun"]);
    expect(lines.length, "依頼と記録の 2 行").toBe(2);
  });
});

describe("起点の解放", () => {
  it("未解放の起点は選べず、説明は依頼を示す", () => {
    const locked = lockedOrigins(createQuestSave());
    const ui = createOriginScreen(undefined, locked);
    const row = ORIGIN_ROWS.indexOf("chanter");
    ui.stage = "origin";
    ui.originCursor = row;
    expect(activateOriginCursor(ui), "決定しても変わらない").toBe("none");
    expect(ui.origin, "放浪者のまま").toBe("wanderer");
    expect(cursorDescription(ui).desc.length, "解放条件の説明がある").toBeGreaterThan(0);
  });

  it("前回の起点が未解放なら放浪者に戻し、既定の 3 起点は最初から選べる", () => {
    const locked = lockedOrigins(createQuestSave());
    expect(createOriginScreen({ origin: "gambler", modifiers: [] }, locked).origin, "放浪者へ").toBe("wanderer");
    const open = ORIGIN_KEYS.filter((o) => !locked.has(o));
    expect(open, "放浪者・剣の巡礼者・素手").toEqual(["wanderer", "swordPilgrim", "unarmed"]);
  });
});
