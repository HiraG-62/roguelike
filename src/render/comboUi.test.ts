import { describe, expect, it } from "vitest";
import { chargeGauge, comboPips, controlHint, formatBranchHints, hudHintText, releaseStepKeys } from "./comboUi";
import { FORMS, movesetsOfForm } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { arena } from "../system/testHelpers";

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
    expect(controlHint(MOVESETS.wand, bulletDef("pistol"), 2)).toBe("左: 二連火矢 / 右: 長氷槍");
    expect(controlHint(MOVESETS.sidearm, bulletDef("pistol"), 9), "右レーンを超えたら 1 段目").toBe("左: 射撃 / 右: 短刀斬り");
  });

  it("右の段の再使用中は残り秒を添える", () => {
    expect(controlHint(MOVESETS.axe, bulletDef("pistol"), 0, 0.84)).toBe("左: 1 段目 / 右: 投擲（あと 0.8 秒）");
  });

  it("溜めて撃つ弾の型は銃の家系のときだけ左の長押しを案内する", () => {
    expect(controlHint(MOVESETS.longarm, bulletDef("matchlock"))).toBe("左 長押し: 溜め撃ち / 右: 銃剣突き");
    expect(controlHint(MOVESETS.sword, bulletDef("matchlock")), "剣は撃たない").toBe("左: 1 段目 / 右: 受け流し");
  });
});

describe("放出の段の印（戦意）", () => {
  it("右の次の段が放出の段なら「（放出）」を添え、そうでなければ添えない", () => {
    const keys = ["returnCut"];
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"), 1, 0, keys), "剣の 2 段目の右は返し斬り").toBe("左: 2 段目 / 右: 返し斬り（放出）");
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"), 0, 0, keys), "1 段目の右は受け流し").toBe("左: 1 段目 / 右: 受け流し");
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"), 1), "印の材料が無ければ従来どおり").toBe("左: 2 段目 / 右: 返し斬り");
  });

  it("再使用の残り秒は印の後ろに続く", () => {
    expect(controlHint(MOVESETS.sword, bulletDef("pistol"), 1, 0.5, ["returnCut"])).toBe("左: 2 段目 / 右: 返し斬り（放出）（あと 0.5 秒）");
  });

  it("派生の案内が出ている間は印を足さない", () => {
    expect(hudHintText(MOVESETS.sword, ["primary", "primary"], bulletDef("pistol"), 2, 0, ["returnCut"])).toBe("右: 十字断ち");
  });

  it("剣は放出の段の key を返し、放出が右の段でない型（長銃・重打）は空", () => {
    expect(releaseStepKeys(arena(5, { moveset: "sword" })), "剣").toContain("returnCut");
    expect(releaseStepKeys(arena(5, { moveset: "longarm", bullet: "rifle" })), "長銃は次の左が放出").toEqual([]);
    expect(releaseStepKeys(arena(5, { moveset: "greatsword" })), "重打は最大の溜めが放出").toEqual([]);
  });

  it("戦意が溜まらない骨の型では、放出の段が右レーンにあっても印を出さない", () => {
    // 型の実装が進むと骨の型は減る（無くなれば検証するものが無い）
    const bone = Object.values(FORMS).find((f) => f.morale.gain.length === 0);
    const moveset = bone === undefined ? undefined : movesetsOfForm(bone.key)[0];
    if (moveset === undefined) return;
    expect(releaseStepKeys(arena(5, { moveset })), `${moveset} の型は戦意が溜まらない`).toEqual([]);
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
