import type { Enemy } from "../core/state";
import { STATUS_KINDS, type StatusBag, type StatusKind } from "../core/status";
import { poiseRatio } from "../system/poise";
import { findStatus } from "../system/statusEffects";
import { TEXT, drawText, textWidth } from "./pixelText";

/**
 * 状態異常と怯みゲージの描画（docs/COMBAT_DESIGN.md E-4 HUD）。state は読むだけ。
 * 敵: 頭上に「文字 1 字 + スタック数」の列、HP バーの下に怯みゲージ（蓄積が耐性の半分を超えたら出す）。
 * プレイヤー: HUD に 8×8 の枠の列（右下にスタック数、下線が残り時間で縮む）
 */

/** 状態異常の 1 文字表記（docs/GLOSSARY.md の表記の頭文字） */
export const STATUS_GLYPH: Readonly<Record<StatusKind, string>> = {
  burn: "燃",
  chill: "冷",
  freeze: "凍",
  shock: "雷",
  paralyze: "痺",
  poison: "毒",
  bleed: "血",
  vulnerable: "脆",
  weaken: "弱",
  fear: "恐",
  silence: "沈",
  stagger: "怯",
  guarded: "堅",
};

export const STATUS_COLOR: Readonly<Record<StatusKind, string>> = {
  burn: "#ff8030",
  chill: "#80c8ff",
  freeze: "#c0f0ff",
  shock: "#c0e0ff",
  paralyze: "#f0f070",
  poison: "#90e050",
  bleed: "#e04040",
  vulnerable: "#ff80c0",
  weaken: "#b0a0ff",
  fear: "#c070ff",
  silence: "#a0a0c0",
  stagger: "#f8d848",
  guarded: "#d0d0d0",
};

/** 怯みゲージを出し始める蓄積の割合（小さな蓄積で頭上をうるさくしない） */
export const POISE_GAUGE_SHOW_RATIO = 0.5;
const POISE_GAUGE_COLOR = "#f8d848";
const POISE_GAUGE_BG = "#302810";
const POISE_GAUGE_H = 1;
/** 敵の頭上の列: 文字の間隔と、スプライト上端からの高さ */
const ENEMY_ICON_GAP = 1;
const ENEMY_ICON_RISE = 9;
/** プレイヤーの枠（論理 px） */
const PLAYER_CELL = 8;
const PLAYER_CELL_GAP = 1;
const PLAYER_CELL_BG = "#101018";
const PLAYER_CELL_ALPHA = 0.8;
const PLAYER_TIMER_H = 1;
const COLOR_STACKS = "#ffffff";

export interface StatusIcon {
  kind: StatusKind;
  glyph: string;
  color: string;
  stacks: number;
  /** 残り時間の割合 0..1 */
  ratio: number;
}

/** 表示する状態異常の一覧（STATUS_KINDS の順）。描画しない側でもテストできるよう純関数にしておく */
export function statusIcons(bag: Readonly<StatusBag>): StatusIcon[] {
  const icons: StatusIcon[] = [];
  for (const kind of STATUS_KINDS) {
    const effect = findStatus(bag, kind);
    if (!effect) continue;
    const ratio = effect.maxTime > 0 ? Math.max(0, Math.min(1, effect.time / effect.maxTime)) : 0;
    icons.push({ kind, glyph: STATUS_GLYPH[kind], color: STATUS_COLOR[kind], stacks: effect.stacks, ratio });
  }
  return icons;
}

/** 怯みゲージを出すか（耐性があり、蓄積が半分を超えた） */
export function poiseGaugeVisible(e: Enemy): boolean {
  return e.poise.max > 0 && poiseRatio(e) >= POISE_GAUGE_SHOW_RATIO;
}

function iconLabel(icon: StatusIcon): string {
  return icon.stacks > 1 ? `${icon.glyph}${icon.stacks}` : icon.glyph;
}

/** 敵の頭上に状態異常の列を中央揃えで描く。top はスプライトの上端 */
export function drawEnemyStatus(ctx: CanvasRenderingContext2D, e: Enemy, cx: number, top: number): void {
  // 大半の敵は何も付いていない。毎フレームの配列生成を避ける
  if (e.status.effects.length === 0) return;
  const icons = statusIcons(e.status);
  if (icons.length === 0) return;
  const m = TEXT.SMALL;
  const widths = icons.map((icon) => textWidth(iconLabel(icon), m));
  const total = widths.reduce((sum, w) => sum + w, 0) + ENEMY_ICON_GAP * (icons.length - 1);
  let x = Math.round(cx - total / 2);
  const y = Math.round(top - ENEMY_ICON_RISE);
  icons.forEach((icon, i) => {
    drawText(ctx, iconLabel(icon), x, y, m, icon.color);
    x += (widths[i] ?? 0) + ENEMY_ICON_GAP;
  });
}

/** 怯みゲージ（細い黄色、蓄積 / 耐性）。見せる条件を満たさなければ何もしない */
export function drawPoiseGauge(ctx: CanvasRenderingContext2D, e: Enemy, cx: number, y: number, w: number): void {
  if (!poiseGaugeVisible(e)) return;
  const left = Math.round(cx - w / 2);
  const top = Math.round(y);
  ctx.fillStyle = POISE_GAUGE_BG;
  ctx.fillRect(left, top, w, POISE_GAUGE_H);
  ctx.fillStyle = POISE_GAUGE_COLOR;
  ctx.fillRect(left, top, Math.round(w * poiseRatio(e)), POISE_GAUGE_H);
}

/** ボスの HP バーの下に常に出す怯みゲージ（ダウンの近さを読ませる） */
export function drawBossPoiseGauge(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number, w: number): void {
  if (e.poise.max <= 0) return;
  ctx.fillStyle = POISE_GAUGE_BG;
  ctx.fillRect(x, y, w, POISE_GAUGE_H);
  ctx.fillStyle = POISE_GAUGE_COLOR;
  ctx.fillRect(x, y, Math.round(w * poiseRatio(e)), POISE_GAUGE_H);
}

/** プレイヤーの状態異常の列（左上 x, y から右へ）。枠に 1 文字、右下にスタック数、下線が残り時間 */
export function drawPlayerStatusRow(ctx: CanvasRenderingContext2D, bag: Readonly<StatusBag>, x: number, y: number): void {
  if (bag.effects.length === 0) return;
  const m = TEXT.SMALL;
  statusIcons(bag).forEach((icon, i) => {
    const cx = x + i * (PLAYER_CELL + PLAYER_CELL_GAP);
    ctx.globalAlpha = PLAYER_CELL_ALPHA;
    ctx.fillStyle = PLAYER_CELL_BG;
    ctx.fillRect(cx, y, PLAYER_CELL, PLAYER_CELL);
    ctx.globalAlpha = 1;
    drawText(ctx, icon.glyph, cx + PLAYER_CELL / 2, y + PLAYER_CELL / 2, m, icon.color, "center", "middle");
    if (icon.stacks > 1) drawText(ctx, String(icon.stacks), cx + PLAYER_CELL, y + PLAYER_CELL, m, COLOR_STACKS, "right", "bottom");
    ctx.fillStyle = icon.color;
    ctx.fillRect(cx, y + PLAYER_CELL - PLAYER_TIMER_H, Math.round(PLAYER_CELL * icon.ratio), PLAYER_TIMER_H);
  });
}
