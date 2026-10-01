import type { GameState } from "../core/state";
import { MOMENT } from "../data/tuning";
import { moraleGauge, moraleReleaseMin } from "../system/morale";
import { TEXT, drawText, textLineHeight, truncateText } from "./pixelText";
import type { HudRect } from "./renderMath";

/**
 * 戦意の HUD（docs/ideas/weapon-forms-impl.md 5a-B）。気力バーの右隣に、型の名のゲージ（応報・熱・溜め・狙い）を出す。
 * 満ちる量は 1 本のバーで、放出できる間（放出の最低に届いた間）は色を点滅させる。
 * 溜まる出来事を持たない型（骨の型）は描かない。state を読むだけで、乱数は使わない
 */

const COLOR_MORALE = "#c8a860";
const COLOR_MORALE_BG = "#302818";
const COLOR_MORALE_MARK = "#181008";
const COLOR_MORALE_RELEASE_MARK = "#fff0c0";
const COLOR_LABEL = "#d8c8a0";

export const MORALE_BAR_W = 36;
export const MORALE_BAR_H = 4;
/** バーとラベルの間 */
const LABEL_GAP = 3;
/** ラベルの最大幅（画面中央のヒット数の表示に掛からない範囲。長い名は切り詰める） */
const LABEL_MAX_W = 30;
/** ラベルの行の最小の高さ（倍率が小さくても詰まり過ぎない） */
const LINE_MIN = 10;
/** ラベルの基準線がバーの上端から下がる分（行の下端から文字の下がりを引いた位置） */
const LABEL_DESCENT = 2;
/** 単位の目盛りを引く上限（多いと 1px の線が潰れる） */
const MARK_UNITS_MAX = 12;
/** 点滅の周期（tick。renderer.ts の HUD_BLINK_TICKS と同じ） */
export const MORALE_BLINK_TICKS = 20;
/** 放出できる間の枠の太さ（論理 px） */
const READY_FRAME = 1;

export interface MoraleHudLayout {
  readonly bar: HudRect;
  readonly labelX: number;
  readonly labelBaseline: number;
  readonly labelMaxW: number;
}

/** 配置（x, y はバーの左上。気力バーの行に揃える）。行高は Math.max(定数, textLineHeight) */
export function moraleHudLayout(x: number, y: number, lineH: number): MoraleHudLayout {
  const line = Math.max(LINE_MIN, lineH);
  const bar: HudRect = { x, y, w: MORALE_BAR_W, h: MORALE_BAR_H };
  return { bar, labelX: x + MORALE_BAR_W + LABEL_GAP, labelBaseline: y + line - LABEL_DESCENT, labelMaxW: LABEL_MAX_W };
}

/** 満ちた割合（0..1）。上限 0 のときは空 */
export function moraleRatio(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

export interface MoraleMarks {
  /** 単位の区切り（0..1、内側だけ） */
  readonly units: readonly number[];
  /** 放出の最低の位置（0..1）。上限と同じ・0 以下なら null（目盛りを引く意味が無い） */
  readonly release: number | null;
}

/** 目盛りの位置。単位が多い型は区切りを省き、放出の最低だけ出す */
export function moraleMarks(max: number, releaseMin: number): MoraleMarks {
  const units = max > 1 && max <= MARK_UNITS_MAX ? Array.from({ length: max - 1 }, (_, i) => (i + 1) / max) : [];
  const release = max > 0 && releaseMin > 0 && releaseMin < max ? releaseMin / max : null;
  return { units, release };
}

/** 放出できる間の点滅の位相（前半が点灯）。tick だけで決まる（乱数を使わない） */
export function moraleBlinkOn(tick: number): boolean {
  return tick % MORALE_BLINK_TICKS < MORALE_BLINK_TICKS / 2;
}

/** 放出できる間のバーの色。点灯で放出の浮き文字の色、消灯で充溢の色（色は MOMENT） */
export function moraleFillColor(ready: boolean, blinkOn: boolean): string {
  if (!ready) return COLOR_MORALE;
  return blinkOn ? MOMENT.release.color : MOMENT.brim.color;
}

export function drawMoraleHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  if (state.status !== "playing") return;
  const gauge = moraleGauge(state);
  if (!gauge.active || gauge.max <= 0) return;
  const m = TEXT.SMALL;
  const layout = moraleHudLayout(x, y, textLineHeight(m));
  const { bar } = layout;
  ctx.fillStyle = COLOR_MORALE_BG;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.fillStyle = moraleFillColor(gauge.ready, moraleBlinkOn(state.tick));
  ctx.fillRect(bar.x, bar.y, Math.round(bar.w * moraleRatio(gauge.value, gauge.max)), bar.h);
  const marks = moraleMarks(gauge.max, moraleReleaseMin(state));
  ctx.fillStyle = COLOR_MORALE_MARK;
  for (const u of marks.units) ctx.fillRect(bar.x + Math.round(bar.w * u), bar.y, 1, bar.h);
  if (marks.release !== null) {
    ctx.fillStyle = COLOR_MORALE_RELEASE_MARK;
    ctx.fillRect(bar.x + Math.round(bar.w * marks.release), bar.y, 1, bar.h);
  }
  if (gauge.ready) {
    ctx.strokeStyle = moraleFillColor(true, !moraleBlinkOn(state.tick));
    // 線の太さは既定の 1（他の HUD の枠と同じ）。0.5 ずらして 1px の線をバーの外に引く
    ctx.strokeRect(bar.x - READY_FRAME / 2, bar.y - READY_FRAME / 2, bar.w + READY_FRAME, bar.h + READY_FRAME);
  }
  drawText(ctx, truncateText(gauge.label, layout.labelMaxW, m), layout.labelX, layout.labelBaseline, m, COLOR_LABEL);
}
