import { describe, expect, it } from "vitest";
import { chargeGauge, chargeHint, comboPips, formatBranchHints } from "./comboUi";
import { MOVESETS, SHOT_TYPES } from "../data/weapons";

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

describe("chargeHint（溜めの役割の案内）", () => {
  it("刀は右の長押しで溜め、大剣は左の長押しで溜め", () => {
    expect(chargeHint(MOVESETS.katana, SHOT_TYPES.single)).toBe("右 長押し: 溜め");
    expect(chargeHint(MOVESETS.greatsword, SHOT_TYPES.single)).toContain("左 長押し: 溜め");
  });

  it("二丁拳銃は左右どちらでも撃つ", () => {
    expect(chargeHint(MOVESETS.gunner, SHOT_TYPES.single)).toBe("左 / 右: 撃つ");
  });

  it("溜めて撃つ射撃の型は撃つボタンの長押しを案内する", () => {
    expect(chargeHint(MOVESETS.sword, SHOT_TYPES.charge)).toBe("右 長押し: 溜め撃ち");
  });

  it("溜めも両手撃ちも無い武器は案内しない", () => {
    expect(chargeHint(MOVESETS.sword, SHOT_TYPES.single)).toBeUndefined();
  });
});

describe("chargeGauge（溜めの目盛り）", () => {
  const levels = [{ time: 0.5 }, { time: 1 }];

  it("押している秒から進み・届いた段・段の位置を出す", () => {
    const g = chargeGauge(0.6, levels);
    expect(g?.ratio).toBeCloseTo(0.6);
    expect(g?.level).toBe(1);
    expect(g?.marks).toEqual([0.5, 1]);
  });

  it("最後の段を過ぎても進みは 1 で止まる", () => {
    expect(chargeGauge(3, levels)?.ratio).toBe(1);
    expect(chargeGauge(3, levels)?.level).toBe(2);
  });

  it("段が無ければ目盛りを出さない", () => {
    expect(chargeGauge(1, [])).toBeUndefined();
  });
});
