import { describe, expect, it } from "vitest";
import { chargeGauge, comboPips, controlHint, formatBranchHints, hudHintText } from "./comboUi";
import { MOVESETS } from "../data/weapons";
import { bulletDef } from "../loot/bullets";

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

describe("controlHint（左右の次の段と押し方の案内）", () => {
  it("剣は右で受け流し、刀は右の長押しで居合、大剣は左の長押しで溜め", () => {
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"))).toBe("左: 1 段目 / 右: 受け流し");
    expect(controlHint(MOVESETS.katana, bulletDef("pistol"))).toBe("左: 1 段目 / 右 長押し: 居合");
    expect(controlHint(MOVESETS.greatsword, bulletDef("pistol"))).toBe("左 長押し: 溜め / 右: 薙ぎ払い");
  });

  it("段カウンタの次の段を左右それぞれ出す（剣の 2 段目: 左は 2 段目、右は返し斬り）", () => {
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"), 1)).toBe("左: 2 段目 / 右: 返し斬り");
    expect(controlHint(MOVESETS.wand, bulletDef("pistol"), 2)).toBe("左: 3 段目 / 右: 大魔弾");
    expect(controlHint(MOVESETS.sidearm, bulletDef("pistol"), 9), "右レーンを超えたら 1 段目").toBe("左: 射撃 / 右 長押し: 狙い撃ち");
  });

  it("右の段の再使用中は残り秒を添える", () => {
    expect(controlHint(MOVESETS.axe, bulletDef("pistol"), 0, 0.84)).toBe("左: 1 段目 / 右: 投擲（あと 0.8 秒）");
  });

  it("溜めて撃つ弾の型は銃の家系のときだけ左の長押しを案内する", () => {
    expect(controlHint(MOVESETS.longarm, bulletDef("matchlock"))).toBe("左 長押し: 溜め撃ち / 右: 銃剣突き");
    expect(controlHint(MOVESETS.sword, bulletDef("matchlock")), "剣は撃たない").toBe("左: 1 段目 / 右: 受け流し");
  });
});

describe("hudHintText（案内の 1 行）", () => {
  it("成立しそうな派生があればそれを、無ければ左右の次の段を出す", () => {
    expect(hudHintText(MOVESETS.sword, ["primary", "primary"], bulletDef("pistol"), 2, 0)).toBe("右: 十字断ち");
    expect(hudHintText(MOVESETS.sword, ["secondary", "primary"], bulletDef("pistol"), 2, 0)).toBe("左: 踏み込み斬り");
    expect(hudHintText(MOVESETS.sword, [], bulletDef("pistol"), 0, 0)).toBe("左: 1 段目 / 右: 受け流し");
    expect(hudHintText(MOVESETS.greatsword, [], bulletDef("pistol"), 0, 0)).toBe("左 長押し: 溜め / 右: 薙ぎ払い");
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
