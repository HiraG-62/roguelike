/**
 * 武器種のモーション → エフェクトのシート（docs/ideas/fx-sprites.md 5 章）。
 * 表の中身は生成器の各アトラス（scripts/fx/sheets/<武器種>.mjs の FX）が持ち、src/data/fx/<key>.gen.json に書かれる。
 * ここではそれを検査して型を付ける。載っていない武器種・モーションは今までの手続きの描画のまま（段階的に置き換える）
 */
import type { Element } from "../core/element";
import { type ButtonKey, MOVESETS, type MovesetDef, type MovesetKey, meleeChargeOf } from "../data/weapons";
import { FX_MOVESET_RAW, FX_SHEETS, type FxSheetKey } from "../data/fxSheets.gen";
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

/** JSON 由来の表（文字列のまま）。FX_MOVESET_RAW の各要素はこの形に収まる */
interface RawMotion {
  readonly sheet: string;
  readonly pivot: string;
  readonly base: number;
  readonly measure: string;
}

interface RawMovesetFx {
  readonly moveset: string;
  readonly motions: Readonly<Record<string, RawMotion>>;
  readonly hit: string;
  readonly hitHeavy: string;
  readonly parry?: string;
}

function isSheetKey(key: string | undefined): key is FxSheetKey {
  return key !== undefined && Object.hasOwn(FX_SHEETS, key);
}

function isMovesetKey(key: string): key is MovesetKey {
  return Object.hasOwn(MOVESETS, key);
}

function toMotion(raw: RawMotion): FxMotion | undefined {
  if (!isSheetKey(raw.sheet)) return undefined;
  if (raw.pivot !== "self" && raw.pivot !== "anchor") return undefined;
  if (raw.measure !== "reach" && raw.measure !== "size") return undefined;
  return { sheet: raw.sheet, pivot: raw.pivot, base: raw.base, measure: raw.measure };
}

/** 表を検査して型を付ける。壊れた行（無いシート・知らない原点）は読み飛ばす（テストが件数で落とす） */
export function buildMovesetFx(raws: readonly (RawMovesetFx | null)[]): Partial<Record<MovesetKey, MovesetFx>> {
  const out: Partial<Record<MovesetKey, MovesetFx>> = {};
  for (const raw of raws) {
    if (!raw || !isMovesetKey(raw.moveset) || !isSheetKey(raw.hit) || !isSheetKey(raw.hitHeavy)) continue;
    const motions: Record<string, FxMotion> = {};
    for (const [key, m] of Object.entries(raw.motions)) {
      const motion = toMotion(m);
      if (motion) motions[key] = motion;
    }
    out[raw.moveset] = { motions, hit: raw.hit, hitHeavy: raw.hitHeavy, parry: isSheetKey(raw.parry) ? raw.parry : undefined };
  }
  return out;
}

export const MOVESET_FX: Readonly<Partial<Record<MovesetKey, MovesetFx>>> = buildMovesetFx(FX_MOVESET_RAW);

/** 武器種のエフェクトが載っているアトラス（遅延読み込みの単位）。表が無ければ undefined */
export function movesetAtlas(moveset: MovesetKey): string | undefined {
  const fx = MOVESET_FX[moveset];
  return fx ? FX_SHEETS[fx.hit].atlas : undefined;
}

export interface MotionRef {
  lane: ButtonKey;
  step: number;
  branch: number;
  dashStrike: boolean;
  chargeLevel: number;
}

/** 今の振りのモーションの key（l:<段> / r:<右の段の key> / branch:<派生の key> / dash / charge）。判定の順は player.ts の stepDef と同じ */
export function motionKey(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): string {
  if (ref.dashStrike) return "dash";
  if (ref.branch >= 0) return `branch:${moveset.branches[ref.branch]?.key ?? ref.branch}`;
  if (ref.chargeLevel > 0 && meleeChargeOf(moveset)) return "charge";
  if (ref.lane === "secondary") return `r:${moveset.steps2[ref.step]?.key ?? ref.step}`;
  return `l:${ref.step}`;
}

export function motionFx(moveset: Readonly<MovesetDef>, ref: Readonly<MotionRef>): FxMotion | undefined {
  return MOVESET_FX[moveset.key]?.motions[motionKey(moveset, ref)];
}

/**
 * 武器種の振りのモーションの key をすべて並べる（表の網羅の検査用）。
 * 左の段・ダッシュ攻撃・右の振りの段（swing だけ。構え・投げ・溜めは手続きの描画）・派生・溜め攻撃
 */
export function swingMotionKeys(moveset: Readonly<MovesetDef>): string[] {
  const keys = moveset.steps.map((_, i) => `l:${i}`);
  if (moveset.dashAttack) keys.push("dash");
  moveset.steps2.forEach((s, i) => {
    if (s.kind === "swing" && !s.step.cast) keys.push(`r:${s.key ?? i}`);
  });
  for (const b of moveset.branches) if (!b.step.cast) keys.push(`branch:${b.key}`);
  if (meleeChargeOf(moveset)) keys.push("charge");
  return keys;
}

/** 属性 → 配色。属性が無ければ鋼 */
export function rampOfElement(element: Element): FxRampKey {
  return element === "none" ? "steel" : element;
}
