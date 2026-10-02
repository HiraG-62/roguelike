import type { FloatTextKind } from "../core/state";
import { FLOAT_TEXT } from "../data/tuning";

/**
 * 浮き文字の大きさ・濃さ（純関数）。大きさは呼び出し側の scale ではなく種類で決める。
 * 133 か所の呼び出しが個別に倍率を持つと、1.0 を少しでも超えた文字がドット整数倍率の切り上げで 12px に跳ね、
 * 画面が文字で埋まるため。数値は src/data/balance/feel/FLOAT_TEXT.json
 */

/** 種類を省いた浮き文字は label（技名・自分の状態・拾い物の名前）として小さく描く */
const DEFAULT_KIND: FloatTextKind = "label";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * 文字の高さ（論理 px）。会心の数字だけ、出た瞬間に critPop.scale 倍へ弾んで time 秒かけて戻る。
 * age は出てからの秒
 */
export function floatTextPx(kind: FloatTextKind | undefined, crit: boolean, age: number): number {
  const base = FLOAT_TEXT.px[kind ?? DEFAULT_KIND];
  if (!crit) return base;
  const pop = FLOAT_TEXT.critPop;
  return base * (1 + (pop.scale - 1) * (1 - clamp01(age / pop.time)));
}

/** 会心の数字の左右の揺れ（論理 px）。fade は消えかけで小さくする 0..1、index は文字ごとの位相 */
export function floatTextShake(time: number, index: number, fade: number): number {
  const pop = FLOAT_TEXT.critPop;
  // + 0 は -0（Object.is で 0 と違う）を 0 に直すため
  return Math.round(Math.sin(time * pop.shakeSpeed + index) * pop.shake * fade) + 0;
}

/** 種類ごとの濃さ（0..1）。label だけ控えめ */
export function floatTextAlpha(kind: FloatTextKind | undefined): number {
  const k = kind ?? DEFAULT_KIND;
  return k === "label" ? FLOAT_TEXT.alpha.label : 1;
}
