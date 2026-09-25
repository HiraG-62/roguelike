import { describe, expect, it } from "vitest";
import type { RuleEffect } from "../core/rules";
import { BOON } from "../data/tuning";
import { BOONS } from "./boonDefs";
import {
  BOON_GRADES,
  BOON_GRADE_LABEL,
  boonGradeMul,
  gradeChances,
  gradeMagnitudeMul,
  gradeRadiusMul,
  gradedEffect,
  isGraded,
  ruleOwnerGrade,
} from "./boonGrade";
import { grantBoon } from "./boons";
import { arena } from "./testHelpers";

const DEEPEST = 100;
const RADIUS = 20;

describe("格の純関数（system/boonGrade.ts）", () => {
  it("格ごとの倍率は BOON の列の添字（格 − 1）を読む", () => {
    for (const g of BOON_GRADES) {
      expect(gradeMagnitudeMul(g)).toBe(BOON.gradeMagnitudeMul[g - 1]);
      expect(gradeRadiusMul(g)).toBe(BOON.gradeRadiusMul[g - 1]);
    }
    expect(BOON_GRADE_LABEL[1], "並は語を出さない").toBe("");
  });

  it("大祝福・神威の率は深さで上がり、上限で止まり、合計が 1 を超えない", () => {
    const shallow = gradeChances(BOON.coreDepth);
    expect(shallow.divine).toBeCloseTo(BOON.gradeDivineBase);
    expect(shallow.grand).toBeCloseTo(BOON.gradeGrandBase);
    const deep = gradeChances(DEEPEST);
    expect(deep.divine).toBeCloseTo(BOON.gradeDivineMax);
    expect(deep.grand).toBeCloseTo(BOON.gradeGrandMax);
    const shifted = gradeChances(DEEPEST, 1);
    expect(shifted.divine + shifted.grand, "加算しても 1 以下").toBeLessThanOrEqual(1);
  });

  it("半径を持つ効果だけ格で半径が広がり、元の定義は書き換えない", () => {
    const effect: RuleEffect = { kind: "explode", magnitude: 1, radius: RADIUS };
    const divine = gradedEffect(effect, 3);
    expect(divine.radius).toBeCloseTo(RADIUS * gradeRadiusMul(3));
    expect(effect.radius, "元の定義").toBe(RADIUS);
    const noRadius: RuleEffect = { kind: "strike", magnitude: 1 };
    expect(gradedEffect(noRadius, 3)).toBe(noRadius);
    expect(gradedEffect(effect, 1)).toBe(effect);
  });

  it("効果量を持たない Rule だけの祝福（試練の徒）は格の対象外", () => {
    expect(isGraded(BOONS.trialSeeker)).toBe(false);
    expect(isGraded(BOONS.dashBlast)).toBe(true);
  });

  it("Rule の持ち主の格は祝福のときだけ読み、フック型の倍率も同じ表を読む", () => {
    const state = arena(3);
    grantBoon(state, "dashBlast", 2);
    expect(ruleOwnerGrade(state, { kind: "boon", key: "dashBlast" })).toBe(2);
    expect(ruleOwnerGrade(state, { kind: "skill", key: "dashBlast" }), "祝福以外は並").toBe(1);
    expect(boonGradeMul(state, "dashBlast")).toBe(gradeMagnitudeMul(2));
    expect(boonGradeMul(state, "secondWind"), "持っていなければ並").toBe(1);
  });
});
