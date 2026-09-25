import type { EventSource } from "../core/events";
import type { Rng } from "../core/rng";
import type { RuleEffect, RuleEffectKind } from "../core/rules";
import type { GameState } from "../core/state";
import { BOON } from "../data/tuning";
import type { BoonDef, BoonKey } from "./boonDefs";

/**
 * 祝福の格（docs/ideas/boon-power-up.md 3-2）。提示ごとに札 1 枚ずつ抽選し、取得した祝福の効果量・半径・ICD に掛ける。
 * 強さは格（深いほど高い格が出る）、方向性は芯で分けて持たせる。state.boons は変えず、格は boonRun.grades に別に持つ
 */

/** 1 = 並 / 2 = 大祝福 / 3 = 神威 */
export type BoonGrade = 1 | 2 | 3;

export const BOON_GRADES: readonly BoonGrade[] = [1, 2, 3];

const GRADE_MIN: BoonGrade = 1;
const GRADE_GRAND: BoonGrade = 2;
const GRADE_MAX: BoonGrade = 3;
/** 格の抽選が始まる深度（祝福の提示は深度 2 から。ここを 0 段目として perDepth を積む） */
const GRADE_DEPTH_ORIGIN = 2;

/** 表示ラベル（並は語を出さない） */
export const BOON_GRADE_LABEL: Readonly<Record<BoonGrade, string>> = { 1: "", 2: "大祝福", 3: "神威" };

/** 数値を格に丸める（下駄を足した後に 3 で止める） */
export function clampGrade(value: number): BoonGrade {
  if (value >= GRADE_MAX) return GRADE_MAX;
  if (value >= GRADE_GRAND) return GRADE_GRAND;
  return GRADE_MIN;
}

/** 大祝福・神威の出る確率（shift は芯などの加算。合計が 1 を超えないよう神威を優先して詰める） */
export function gradeChances(depth: number, shift = 0): { grand: number; divine: number } {
  const d = Math.max(0, depth - GRADE_DEPTH_ORIGIN);
  const divine = Math.min(1, Math.min(BOON.gradeDivineMax, BOON.gradeDivineBase + BOON.gradeDivinePerDepth * d) + shift);
  const grandRaw = Math.min(BOON.gradeGrandMax, BOON.gradeGrandBase + BOON.gradeGrandPerDepth * d) + shift;
  return { divine, grand: Math.max(0, Math.min(1 - divine, grandRaw)) };
}

/**
 * 格を 1 つ抽選する。乱数は 1 回だけ引き、神威 → 大祝福 → 並の順に区間で分ける（確率は表のとおりの「その格が出る率」）。
 * boost（試練・ボス階の直後・呪いの 4 枚目など）は抽選結果に足して 3 で止める
 */
export function rollGrade(rng: Rng, depth: number, boost = 0, shift = 0): BoonGrade {
  const { grand, divine } = gradeChances(depth, shift);
  const roll = rng.next();
  const rolled = roll < divine ? GRADE_MAX : roll < divine + grand ? GRADE_GRAND : GRADE_MIN;
  return clampGrade(rolled + boost);
}

/**
 * 格の対象か。呪い付きは常に格なし（代償まで膨らませない）。graded を明示すればそれに従い、
 * 省略時は効果量を持つ Rule が 1 つでもあれば対象（Rule 型は applyRuleEffect の 1 か所で格が効くので自動で opt-in）
 */
export function isGraded(def: Readonly<BoonDef>): boolean {
  if (def.cursed) return false;
  if (def.graded !== undefined) return def.graded;
  return def.rules?.some((r) => r.then.magnitude > 0) ?? false;
}

function gradeValue(list: readonly number[], grade: BoonGrade): number {
  return list[grade - 1] ?? 1;
}

export function gradeMagnitudeMul(grade: BoonGrade): number {
  return gradeValue(BOON.gradeMagnitudeMul, grade);
}

export function gradeRadiusMul(grade: BoonGrade): number {
  return gradeValue(BOON.gradeRadiusMul, grade);
}

export function gradeIcdMul(grade: BoonGrade): number {
  return gradeValue(BOON.gradeIcdMul, grade);
}

/**
 * 格で縮めた ICD。ruleMinIcd を下限に残す。元の ICD がもともと下限より短い（0 など）なら元のまま
 * （格で長くはしない）
 */
export function gradedIcd(icd: number, grade: BoonGrade): number {
  if (icd <= 0) return icd;
  return Math.min(icd, Math.max(BOON.ruleMinIcd, icd * gradeIcdMul(grade)));
}

/** 取得済みの祝福の格（持っていない・格なしなら並） */
export function boonGradeOf(state: GameState, key: BoonKey): BoonGrade {
  return state.boonRun.grades[key] ?? GRADE_MIN;
}

/** フック型・数値型の祝福が自分の倍率に掛ける効果量の倍率（graded: true の祝福が読む） */
export function boonGradeMul(state: GameState, key: BoonKey): number {
  return gradeMagnitudeMul(boonGradeOf(state, key));
}

/** Rule の持ち主の格（祝福以外の Rule は並）。system/rules.ts が効果量・半径・ICD に掛ける */
export function ruleOwnerGrade(state: GameState, owner: Readonly<EventSource>): BoonGrade {
  if (owner.kind !== "boon") return GRADE_MIN;
  const grades: Readonly<Record<string, BoonGrade | undefined>> = state.boonRun.grades;
  return grades[owner.key] ?? GRADE_MIN;
}

/** 無敵時間を与える効果（回避の無敵・被弾の無敵・長い加護）。秒は duration ?? magnitude で読まれる */
const INVULN_EFFECTS: ReadonlySet<RuleEffectKind> = new Set<RuleEffectKind>(["iframes", "invuln", "ward"]);

/** 半径を持つ効果の半径だけを格で広げた写し（元の定義は書き換えない）。並・半径なしならそのまま返す。無敵時間の効果は秒を固定する */
export function gradedEffect(effect: Readonly<RuleEffect>, grade: BoonGrade): Readonly<RuleEffect> {
  if (grade === GRADE_MIN) return effect;
  // 無敵の秒は格で伸ばさない（×2.2 で常時無敵に近づく）。秒を duration に固定し、効果量の倍率が秒へ流れないようにする
  if (INVULN_EFFECTS.has(effect.kind)) return { ...effect, duration: effect.duration ?? effect.magnitude };
  if (effect.radius === undefined) return effect;
  return { ...effect, radius: effect.radius * gradeRadiusMul(grade) };
}
