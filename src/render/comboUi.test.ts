import { describe, expect, it } from "vitest";
import { comboPips, formatBranchHints } from "./comboUi";

describe("comboPips（docs/ideas/combat-feel-design.md D-1）", () => {
  it("攻撃中は現在の段までピップが塗られ、最終段だけ final", () => {
    const pips = comboPips(3, 1, true);
    expect(pips.map((p) => p.filled)).toEqual([true, true, false]);
    expect(pips.map((p) => p.final)).toEqual([false, false, true]);
  });

  it("攻撃していなければ全て空", () => {
    const pips = comboPips(3, 2, false);
    expect(pips.every((p) => !p.filled)).toBe(true);
  });
});

describe("formatBranchHints", () => {
  it("左右のボタンを日本語ラベルにして繋げる", () => {
    const text = formatBranchHints([
      { button: "primary", name: "踏み込み斬り" },
      { button: "secondary", name: "十字断ち" },
    ]);
    expect(text).toBe("左: 踏み込み斬り / 右: 十字断ち");
  });

  it("空の配列は空文字", () => {
    expect(formatBranchHints([])).toBe("");
  });
});
