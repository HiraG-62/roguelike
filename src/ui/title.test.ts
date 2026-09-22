import { describe, expect, it } from "vitest";
import type { Item, RunHistoryEntry } from "../loot/types";
import {
  type RawKeyEvent,
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
  processMenuKeys,
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
