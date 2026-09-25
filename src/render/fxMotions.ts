/**
 * 武器種のモーション → エフェクトのシート（docs/ideas/fx-sprites.md 5 章）。
 * 載っていない武器種・モーションは今までの手続きの描画のまま（段階的に置き換える）
 */
import type { Element } from "../core/element";
import type { ButtonKey, MovesetDef, MovesetKey } from "../data/weapons";
import type { FxSheetKey } from "../data/fxSheets.gen";
import type { FxRampKey } from "./fxSprites";

/** 原点: self = 自分の中心、anchor = 当たり判定の中心（meleeAnchor） */
export type FxPivot = "self" | "anchor";

export interface FxMotion {
  sheet: FxSheetKey;
  pivot: FxPivot;
  /** 絵を描いたときの当たり判定の大きさ（論理 px）。measure で今の段のどの値と比べるか */
  base: number;
  measure: "reach" | "size";
}

export interface MovesetFx {
  /** モーションの key（motionKey）→ シート */
  motions: Readonly<Record<string, FxMotion>>;
  hit: FxSheetKey;
  hitHeavy: FxSheetKey;
  parry?: FxSheetKey;
}

const self = (sheet: FxSheetKey, base: number): FxMotion => ({ sheet, pivot: "self", base, measure: "reach" });
const anchor = (sheet: FxSheetKey, base: number, measure: FxMotion["measure"] = "reach"): FxMotion => ({ sheet, pivot: "anchor", base, measure });

export const MOVESET_FX: Readonly<Partial<Record<MovesetKey, MovesetFx>>> = {
  sword: {
    motions: {
      "l:0": self("sword.l1", 16),
      "l:1": self("sword.l2", 18),
      "l:2": self("sword.l3", 22),
      dash: self("sword.dash", 26),
      "r:returnCut": self("sword.thrust", 30),
      "r:risingCut": self("sword.rising", 26),
      "branch:crossCut": anchor("sword.cross", 22),
      "branch:steppingCut": self("sword.step", 30),
      "branch:tomoe": anchor("sword.tomoe", 44, "size"),
      "branch:reverseKesa": anchor("sword.kesa", 22),
    },
    hit: "sword.hit",
    hitHeavy: "sword.hitHeavy",
    parry: "sword.parry",
  },
};

export interface MotionRef {
  lane: ButtonKey;
  step: number;
  branch: number;
  dashStrike: boolean;
}

/** 今の振りのモーションの key（l:<段> / r:<右の段の key> / branch:<派生の key> / dash） */
export function motionKey(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): string {
  if (ref.dashStrike) return "dash";
  if (ref.branch >= 0) return `branch:${moveset.branches[ref.branch]?.key ?? ref.branch}`;
  if (ref.lane === "secondary") return `r:${moveset.steps2[ref.step]?.key ?? ref.step}`;
  return `l:${ref.step}`;
}

export function motionFx(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): FxMotion | undefined {
  return MOVESET_FX[moveset.key]?.motions[motionKey(moveset, ref)];
}

/** 属性 → 配色。属性が無ければ鋼 */
export function rampOfElement(element: Element): FxRampKey {
  return element === "none" ? "steel" : element;
}
