import { describe, expect, it } from "vitest";
import type { RuleEffect } from "../core/rules";
import { BOON } from "../data/tuning";
import { BOONS } from "./boonDefs";
import {
  BOON_GRADES,
  BOON_GRADE_LABEL,
  GRADE_TOP,
  boonGradeMul,
  canRaiseGrade,
  clampGrade,
  gradeChances,
  gradeIcdMul,
  gradeMagnitudeMul,
  gradeRadiusMul,
  gradedEffect,
  isGraded,
  rollGrade,
  ruleOwnerGrade,
  temperGrade,
} from "./boonGrade";
import { createRng } from "../core/rng";
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

describe("格 1〜5 と錬磨（docs/ideas/boon-impl.md 2-5）", () => {
  const ROLLS = 2000;
  const HUGE = 10;

  it("倍率の列は 5 要素で、格が上がるほど効果量が増える", () => {
    expect(BOON_GRADES).toHaveLength(GRADE_TOP);
    for (const list of [BOON.gradeMagnitudeMul, BOON.gradeRadiusMul, BOON.gradeIcdMul]) expect(list).toHaveLength(GRADE_TOP);
    for (const g of BOON_GRADES) {
      expect(gradeIcdMul(g)).toBe(BOON.gradeIcdMul[g - 1]);
      if (g > 1) expect(gradeMagnitudeMul(g), `格 ${g}`).toBeGreaterThan(gradeMagnitudeMul((g - 1) as typeof g));
    }
    expect(BOON_GRADE_LABEL[4].length, "至高のラベル").toBeGreaterThan(0);
    expect(BOON_GRADE_LABEL[5].length, "極致のラベル").toBeGreaterThan(0);
  });

  it("格 4・5 は抽選（と下駄）では出ない", () => {
    const rng = createRng(7);
    for (let i = 0; i < ROLLS; i++) expect(rollGrade(rng, DEEPEST, HUGE, 1)).toBeLessThanOrEqual(3);
    expect(clampGrade(HUGE), "下駄を足しても 3 で止まる").toBe(3);
  });

  it("錬磨は 1 段ずつ上げて極致（5）で止まる", () => {
    expect([1, 2, 3, 4, 5].map((g) => temperGrade(g as 1 | 2 | 3 | 4 | 5))).toEqual([2, 3, 4, 5, 5]);
    expect(canRaiseGrade(4)).toBe(true);
    expect(canRaiseGrade(GRADE_TOP)).toBe(false);
  });
});
