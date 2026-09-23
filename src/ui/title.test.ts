import { describe, expect, it } from "vitest";
import type { Item, RunHistoryEntry } from "../loot/types";
import { REPLAY_VERSION, type ReplayData } from "../core/replay";
import { KEYBIND_SLOTS, REBINDABLE_ACTIONS } from "../core/input";
import {
  type RawKeyEvent,
  KEYBINDS_ROWS,
  isActionRow,
  keybindsItemAt,
  keybindsLayout,
  keybindsScrollFor,
  keybindsVisibleCount,
  appendSeedChar,
  backspaceSeedChar,
  buildHistoryEntry,
  cancelSeedInput,
  commitSeedInput,
  createSeedInputState,
  cycleIndex,
  edgeDir,
  REPLAY_SPEEDS,
  dailyBestIndices,
  isDailyEntry,
  moveHistoryCursor,
  PAUSE_MENU_ITEMS,
  SETTINGS_ITEMS,
  pauseMenuItemAt,
  pauseMenuLayout,
  processMenuKeys,
  replayAvailability,
  settingsItemAt,
  settingsLayout,
  settingsRowSide,
  shiftReplaySpeed,
  startSeedInput,
  summarizeRunItems,
} from "./title";

function key(code: string, k = code): RawKeyEvent {
  return { code, key: k };
}

describe("seed input", () => {
  it("N 相当の startSeedInput でモードに入る", () => {
    const s = createSeedInputState("abc");
    expect(s.active).toBe(false);
    startSeedInput(s);
    expect(s.active).toBe(true);
  });

  it("文字の追加・削除ができる", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    appendSeedChar(s, "a");
    appendSeedChar(s, "1");
    expect(s.text).toBe("a1");
    backspaceSeedChar(s);
    expect(s.text).toBe("a");
  });

  it("非アクティブ中は追加・削除を無視する", () => {
    const s = createSeedInputState("seed");
    appendSeedChar(s, "x");
    backspaceSeedChar(s);
    expect(s.text).toBe("seed");
  });

  it("英数字以外や上限超えの追加は無視する", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    appendSeedChar(s, "!");
    appendSeedChar(s, "");
    appendSeedChar(s, "ab");
    expect(s.text).toBe("");
    for (let i = 0; i < 20; i++) appendSeedChar(s, "x");
    expect(s.text.length).toBeLessThanOrEqual(16);
  });

  it("確定すると非アクティブになり値を返す", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    appendSeedChar(s, "z");
    const result = commitSeedInput(s, "fallback");
    expect(result).toBe("z");
    expect(s.active).toBe(false);
    expect(s.text).toBe("z");
  });

  it("空文字で確定すると fallback になる", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    const result = commitSeedInput(s, "fallback");
    expect(result).toBe("fallback");
    expect(s.text).toBe("fallback");
  });

  it("キャンセルすると確定前の文字列に戻る", () => {
    const s = createSeedInputState("old");
    startSeedInput(s);
    appendSeedChar(s, "x");
    cancelSeedInput(s, "old");
    expect(s.active).toBe(false);
    expect(s.text).toBe("old");
  });
});

describe("processMenuKeys", () => {
  it("非入力中は N/H/O/M/T/Escape をホットキーとして拾う", () => {
    const s = createSeedInputState("seed");
    const hotkeys = processMenuKeys(
      [key("KeyN"), key("KeyH"), key("KeyO"), key("KeyM"), key("KeyT"), key("Escape")],
      s,
    );
    expect(hotkeys).toEqual({
      escape: true,
      n: true,
      h: true,
      o: true,
      m: true,
      t: true,
      d: false,
      p: false,
      s: false,
      clear: false,
      arrowX: 0,
      arrowY: 0,
    });
  });

  it("D/P/S と矢印キーを拾う", () => {
    const s = createSeedInputState("seed");
    const hotkeys = processMenuKeys([key("KeyD"), key("KeyP"), key("KeyS"), key("ArrowUp"), key("ArrowRight")], s);
    expect(hotkeys.d).toBe(true);
    expect(hotkeys.p).toBe(true);
    expect(hotkeys.s).toBe(true);
    expect(hotkeys.arrowY).toBe(-1);
    expect(hotkeys.arrowX).toBe(1);
  });

  it("シード入力中の D/P/S は文字として扱う", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    const hotkeys = processMenuKeys([key("KeyD", "d"), key("KeyP", "p"), key("KeyS", "s")], s);
    expect(s.text).toBe("dps");
    expect(hotkeys.d || hotkeys.p || hotkeys.s).toBe(false);
  });

  it("入力中は英数字を seedInput に積み、N/H/O/M/T はホットキーにならない", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    const hotkeys = processMenuKeys([key("KeyN", "n"), key("Digit1", "1"), key("KeyH", "h")], s);
    expect(s.text).toBe("n1h");
    expect(hotkeys.n).toBe(false);
    expect(hotkeys.h).toBe(false);
  });

  it("入力中の Backspace / Escape は文字操作として扱われる", () => {
    const s = createSeedInputState("");
    startSeedInput(s);
    appendSeedChar(s, "a");
    const hotkeys = processMenuKeys([key("Backspace"), key("Escape")], s);
    expect(s.text).toBe("");
    expect(hotkeys.escape).toBe(true);
  });
});

describe("edgeDir / cycleIndex", () => {
  it("0 から非0 への変化だけを拾う", () => {
    expect(edgeDir(0, 1)).toBe(1);
    expect(edgeDir(0, -1)).toBe(-1);
    expect(edgeDir(1, 1)).toBe(0);
    expect(edgeDir(0, 0)).toBe(0);
  });

  it("範囲内で折り返す", () => {
    expect(cycleIndex(0, -1, 4)).toBe(3);
    expect(cycleIndex(3, 1, 4)).toBe(0);
    expect(cycleIndex(1, 1, 4)).toBe(2);
  });
});

describe("buildHistoryEntry", () => {
  it("死亡なら defeated、それ以外は abandoned になる", () => {
    const base = {
      seedText: "abc",
      depth: 3,
      kills: 10,
      score: 500,
      combo: { best: 7 },
      time: 120.4,
    };
    const dead = buildHistoryEntry({ ...base, status: "dead" as const }, 1000);
    expect(dead).toEqual({
      date: 1000,
      seedText: "abc",
      depth: 3,
      kills: 10,
      score: 500,
      bestCombo: 7,
      durationSec: 120.4,
      cause: "defeated",
    });
    const abandoned = buildHistoryEntry({ ...base, status: "playing" as const }, 2000);
    expect(abandoned.cause).toBe("abandoned");
  });
});

describe("summarizeRunItems", () => {
  function item(overrides: Partial<Item>): Item {
    return {
      id: "id",
      seed: 1,
      baseKey: "sword",
      slot: "weapon",
      rarity: "normal",
      itemLevel: 1,
      name: "Sword",
      implicit: null,
      affixes: [],
      foundDepth: 1,
      foundAt: 0,
      ...overrides,
    };
  }

  it("runStartedAt 以降のものだけをレアリティ別に数える", () => {
    const items = [
      item({ id: "a", rarity: "normal", foundAt: 100 }),
      item({ id: "b", rarity: "rare", foundAt: 200 }),
      item({ id: "c", rarity: "rare", foundAt: 50 }),
      item({ id: "d", rarity: "unique", foundAt: 300 }),
    ];
    const summary = summarizeRunItems(items, 100);
    expect(summary.total).toBe(3);
    expect(summary.byRarity).toEqual({ normal: 1, magic: 0, rare: 1, unique: 1 });
  });
});

function historyEntry(seedText: string, score: number, depth = 1): RunHistoryEntry {
  return { date: 0, seedText, depth, kills: 0, score, bestCombo: 0, durationSec: 0 };
}

describe("daily history", () => {
  it("日付形式のシードだけをデイリーとみなす", () => {
    expect(isDailyEntry(historyEntry("2026-09-23", 0))).toBe(true);
    expect(isDailyEntry(historyEntry("abc123", 0))).toBe(false);
    expect(isDailyEntry(historyEntry("2026-9-23", 0))).toBe(false);
  });

  it("デイリーの日付ごとに最高スコアの行を選ぶ", () => {
    const history = [
      historyEntry("2026-09-23", 100),
      historyEntry("abc", 999),
      historyEntry("2026-09-23", 300),
      historyEntry("2026-09-22", 50),
      historyEntry("2026-09-23", 300, 1),
    ];
    expect([...dailyBestIndices(history)].sort()).toEqual([2, 3]);
  });
});

describe("history cursor / replay speed", () => {
  it("カーソルは端で止まり、空なら 0", () => {
    expect(moveHistoryCursor(0, -1, 5)).toBe(0);
    expect(moveHistoryCursor(4, 1, 5)).toBe(4);
    expect(moveHistoryCursor(2, 1, 5)).toBe(3);
    expect(moveHistoryCursor(3, 1, 0)).toBe(0);
  });

  it("再生速度は 1x / 2x / 4x の間で端で止まる", () => {
    expect(REPLAY_SPEEDS).toEqual([1, 2, 4]);
    expect(shiftReplaySpeed(1, 1)).toBe(2);
    expect(shiftReplaySpeed(2, 1)).toBe(4);
    expect(shiftReplaySpeed(4, 1)).toBe(4);
    expect(shiftReplaySpeed(1, -1)).toBe(1);
  });
});

describe("リプレイの再生可否", () => {
  function fakeReplay(version: number): ReplayData {
    return { version } as unknown as ReplayData;
  }

  it("リプレイが保存されていなければ none", () => {
    expect(replayAvailability(null)).toBe("none");
  });

  it("現行バージョンの記録なら playable", () => {
    expect(replayAvailability(fakeReplay(REPLAY_VERSION))).toBe("playable");
  });

  it("旧バージョンの記録なら old（再生不可）", () => {
    expect(replayAvailability(fakeReplay(REPLAY_VERSION - 1))).toBe("old");
  });
});

describe("ポーズメニューのレイアウトと当たり判定", () => {
  const ITEM_GAP = 18;

  it("各項目の矩形内の座標で index が返る", () => {
    const layout = pauseMenuLayout(ITEM_GAP);
    layout.items.forEach((rect, i) => {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      expect(pauseMenuItemAt(cx, cy, ITEM_GAP)).toBe(i);
    });
  });

  it("パネル外の座標では null になる", () => {
    const layout = pauseMenuLayout(ITEM_GAP);
    expect(pauseMenuItemAt(layout.panel.x - 10, layout.panel.y, ITEM_GAP)).toBeNull();
    expect(pauseMenuItemAt(0, 0, ITEM_GAP)).toBeNull();
  });

  it("描画と同じ行間なので隣接行にはみ出さない（境界のずれが半行未満）", () => {
    const layout = pauseMenuLayout(ITEM_GAP);
    for (let i = 0; i < layout.items.length - 1; i++) {
      const a = layout.items[i];
      const b = layout.items[i + 1];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (!a || !b) continue;
      // 隣り合う行の境界がぴったり接していて重なりも隙間も無い
      expect(a.y + a.h).toBeCloseTo(b.y, 5);
    }
  });

  it("項目数は PAUSE_MENU_ITEMS と一致する", () => {
    expect(pauseMenuLayout(ITEM_GAP).items.length).toBe(PAUSE_MENU_ITEMS.length);
  });
});

describe("設定画面のレイアウトと当たり判定", () => {
  const ROW_GAP = 18;

  it("各行の矩形内の座標で index が返る", () => {
    const layout = settingsLayout(ROW_GAP);
    layout.rows.forEach((rect, i) => {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      expect(settingsItemAt(cx, cy, ROW_GAP)).toBe(i);
    });
  });

  it("パネル外の座標では null になる", () => {
    const layout = settingsLayout(ROW_GAP);
    expect(settingsItemAt(layout.panel.x - 10, layout.panel.y, ROW_GAP)).toBeNull();
    expect(settingsItemAt(0, 0, ROW_GAP)).toBeNull();
  });

  it("行数は SETTINGS_ITEMS（close 含む）と一致する", () => {
    expect(settingsLayout(ROW_GAP).rows.length).toBe(SETTINGS_ITEMS.length);
  });

  it("左半分は -1、右半分は 1 を返す", () => {
    const layout = settingsLayout(ROW_GAP);
    const centerX = layout.panel.x + layout.panel.w / 2;
    expect(settingsRowSide(centerX - 1)).toBe(-1);
    expect(settingsRowSide(centerX + 1)).toBe(1);
  });
});

describe("Delete / Backspace のホットキー", () => {
  it("非入力中の Delete / Backspace は clear になる", () => {
    const s = createSeedInputState("seed");
    expect(processMenuKeys([key("Delete")], s).clear).toBe(true);
    expect(processMenuKeys([key("Backspace")], s).clear).toBe(true);
  });

  it("シード入力中の Backspace は文字削除で、clear にならない", () => {
    const s = createSeedInputState("ab");
    startSeedInput(s);
    const hotkeys = processMenuKeys([key("Backspace")], s);
    expect(s.text).toBe("a");
    expect(hotkeys.clear).toBe(false);
  });
});

describe("設定画面の項目", () => {
  it("キー設定の項目があり、閉じるは最後", () => {
    expect(SETTINGS_ITEMS).toContain("keybinds");
    expect(SETTINGS_ITEMS[SETTINGS_ITEMS.length - 1]).toBe("close");
  });

  it("行がパネル内に収まる", () => {
    const layout = settingsLayout(18);
    const last = layout.rows[layout.rows.length - 1];
    expect(last, "最後の行がある").toBeDefined();
    if (!last) return;
    expect(last.y + last.h, "最後の行がパネル下端を越えない").toBeLessThanOrEqual(layout.panel.y + layout.panel.h);
  });
});

describe("キー設定画面のレイアウトと当たり判定", () => {
  const ROW_GAP = 13;
  const WIDE_GAP = 20;

  it("行は変更可能なアクション + 既定に戻す + 閉じる", () => {
    expect(KEYBINDS_ROWS.length).toBe(REBINDABLE_ACTIONS.length + 2);
    expect(KEYBINDS_ROWS.filter((r) => !isActionRow(r))).toEqual(["reset", "close"]);
  });

  it("列の数は KEYBIND_SLOTS と同じで、パネル内に収まる", () => {
    const layout = keybindsLayout(ROW_GAP);
    expect(layout.slots.length).toBe(KEYBIND_SLOTS);
    for (const col of layout.slots) {
      expect(col.x + col.w, "列がパネル右端を越えない").toBeLessThanOrEqual(layout.panel.x + layout.panel.w);
    }
  });

  it("パネルは 480x270 に収まる", () => {
    const { panel } = keybindsLayout(ROW_GAP);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.w).toBeLessThanOrEqual(480);
    expect(panel.y + panel.h).toBeLessThanOrEqual(270);
  });

  it("アクション行の列の上なら行と列が返る", () => {
    const layout = keybindsLayout(ROW_GAP);
    const row = layout.rows[2];
    const col = layout.slots[1];
    expect(row && col, "行と列がある").toBeTruthy();
    if (!row || !col) return;
    const hit = keybindsItemAt(col.x + col.w / 2, row.rect.y + row.rect.h / 2, ROW_GAP);
    expect(hit).toEqual({ row: 2, slot: 1 });
  });

  it("アクション名の上なら列は null", () => {
    const layout = keybindsLayout(ROW_GAP);
    const row = layout.rows[0];
    if (!row) throw new Error("行が無い");
    const hit = keybindsItemAt(layout.panel.x + 4, row.rect.y + row.rect.h / 2, ROW_GAP);
    expect(hit).toEqual({ row: 0, slot: null });
  });

  it("既定に戻す / 閉じる の行は列を持たない", () => {
    const layout = keybindsLayout(ROW_GAP);
    const closeIndex = KEYBINDS_ROWS.indexOf("close");
    const row = layout.rows.find((r) => r.index === closeIndex);
    const col = layout.slots[0];
    if (!row || !col) throw new Error("閉じるの行が見えていない");
    expect(keybindsItemAt(col.x + 2, row.rect.y + row.rect.h / 2, ROW_GAP)).toEqual({ row: closeIndex, slot: null });
  });

  it("パネル外では null", () => {
    expect(keybindsItemAt(0, 0, ROW_GAP)).toBeNull();
  });

  it("行間が広いとスクロールし、カーソルに追従する", () => {
    const visible = keybindsVisibleCount(WIDE_GAP);
    expect(visible, "行間が広いと全行は収まらない").toBeLessThan(KEYBINDS_ROWS.length);
    const last = KEYBINDS_ROWS.length - 1;
    const scroll = keybindsScrollFor(last, 0, WIDE_GAP);
    expect(scroll, "最下段が見える位置までスクロールする").toBe(KEYBINDS_ROWS.length - visible);
    expect(keybindsScrollFor(0, scroll, WIDE_GAP), "先頭に戻ると 0 に戻る").toBe(0);
    expect(keybindsScrollFor(scroll + 1, scroll, WIDE_GAP), "見えている行では動かない").toBe(scroll);
  });

  it("スクロール中の当たり判定はスクロール後の行 index を返す", () => {
    const scroll = 3;
    const layout = keybindsLayout(WIDE_GAP, scroll);
    const first = layout.rows[0];
    if (!first) throw new Error("行が無い");
    expect(first.index).toBe(scroll);
    const hit = keybindsItemAt(layout.panel.x + 4, first.rect.y + first.rect.h / 2, WIDE_GAP, scroll);
    expect(hit?.row).toBe(scroll);
  });

  it("小さい文字の行間なら全行が 1 画面に収まる", () => {
    expect(keybindsVisibleCount(ROW_GAP)).toBe(KEYBINDS_ROWS.length);
  });
});
