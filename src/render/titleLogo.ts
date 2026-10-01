/**
 * タイトル画面の題字（墨書きの「墨淵」）を塗る。字形は生成済みの二値マスク（data/sprites/titleLogo.ts）で、
 * ここは明るい紙色の塗り（影・縁・上下の明暗）と周りの墨の飛沫、6 秒ごとに走る光の筋だけを持つ。
 * 動かない部分は 1 枚の canvas に焼いてキャッシュし、光の筋だけ毎フレーム重ねる。
 */
import { RENDER_SCALE } from "../core/view";
import { TITLE_LOGO_ROWS } from "../data/sprites/titleLogo";
import { Pen, hh } from "./titlePaint";

/** 紙色の塗り（題字は暗い岩の上に明るく浮かせる） */
const PAPER = {
  shadow: "#050407",
  top: "#fff4d0",
  hi: "#ece4d2",
  mid: "#dcd2bc",
  lo: "#b8ae98",
  shine: "#ffffff",
} as const;

/** 明暗の境（字の高さに対する割合）: 上の 4 割が hi、〜 75% が mid、残りが lo */
const SHADE_HI_UNTIL = 0.4;
const SHADE_MID_UNTIL = 0.75;
/** 光の筋: 周期・走る時間（秒）・筋の太さ（ドット）・斜め具合 */
const SHINE_PERIOD = 6;
const SHINE_RUN_SECONDS = 1.3;
const SHINE_WIDTH = 2;
const SHINE_SLANT = 0.6;
const SHINE_OVERSHOOT = 6;
const SHINE_TAIL = 8;
/** 墨の飛沫の数・大きさ・出る確率・縦の範囲・横にはみ出す量 */
const SPATTER_COUNT = 9;
const SPATTER_BIG_CHANCE = 0.3;
const SPATTER_SHOW_CHANCE = 0.55;
const SPATTER_TOP = 0.2;
const SPATTER_SPAN = 0.8;
const SPATTER_MARGIN_X = 8;
/** 飛沫の配置の種（見た目の固定。座標ハッシュ） */
const SPATTER_SEED = 3;
/** 焼いた canvas の余白（飛沫・影・縁がはみ出す分） */
const BAKE_PAD = 10;

export interface LogoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LOGO_W = TITLE_LOGO_ROWS[0]?.length ?? 0;
const LOGO_H = TITLE_LOGO_ROWS.length;

function filled(i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= LOGO_W || j >= LOGO_H) return false;
  return TITLE_LOGO_ROWS[j]?.[i] === "#";
}

function bodyColor(i: number, j: number): string {
  const f = j / LOGO_H;
  const base = f < SHADE_HI_UNTIL ? PAPER.hi : f < SHADE_MID_UNTIL ? PAPER.mid : PAPER.lo;
  const up = filled(i, j - 1);
  const down = filled(i, j + 1);
  if (!up && down) return PAPER.top;
  if (up && !down) return PAPER.lo;
  return base;
}

function paintLogo(pen: Pen): void {
  for (let j = 0; j < LOGO_H; j++) {
    for (let i = 0; i < LOGO_W; i++) {
      if (filled(i, j)) pen.rectRaw(BAKE_PAD + i + 1, BAKE_PAD + j + 1, 1, 1, PAPER.shadow);
    }
  }
  for (let j = 0; j < LOGO_H; j++) {
    for (let i = 0; i < LOGO_W; i++) {
      if (filled(i, j)) pen.rectRaw(BAKE_PAD + i, BAKE_PAD + j, 1, 1, bodyColor(i, j));
    }
  }
  for (let i = 0; i < SPATTER_COUNT; i++) {
    const w = LOGO_W + SPATTER_MARGIN_X * 2;
    const px = BAKE_PAD - SPATTER_MARGIN_X + hh(i, SPATTER_SEED, 1) * w;
    const py = BAKE_PAD + LOGO_H * (SPATTER_TOP + hh(i, SPATTER_SEED, 2) * SPATTER_SPAN);
    const size = hh(i, SPATTER_SEED, 3) < SPATTER_BIG_CHANCE ? 2 : 1;
    if (hh(i, SPATTER_SEED, 4) < SPATTER_SHOW_CHANCE) pen.rect(px, py, size, size, PAPER.lo);
  }
}

let baked: HTMLCanvasElement | null = null;

function bakedLogo(): HTMLCanvasElement {
  if (baked) return baked;
  const canvas = document.createElement("canvas");
  canvas.width = (LOGO_W + BAKE_PAD * 2) * RENDER_SCALE;
  canvas.height = (LOGO_H + BAKE_PAD * 2) * RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  paintLogo(new Pen(ctx));
  baked = canvas;
  return canvas;
}

/** 光の筋の位置（ドット単位。走っていない間は null） */
export function shinePosition(time: number): number | null {
  const cycle = (time + 1000) % SHINE_PERIOD;
  if (cycle >= SHINE_RUN_SECONDS) return null;
  return (cycle / SHINE_RUN_SECONDS) * (LOGO_W + LOGO_H + SHINE_TAIL) - SHINE_OVERSHOOT;
}

/** 題字の上端中央を (cx, top) に置いて描く。戻り値は字の外接矩形（添えの文字の位置決め用） */
export function drawTitleLogo(ctx: CanvasRenderingContext2D, cx: number, top: number, time: number): LogoBox {
  const x = Math.round(cx - LOGO_W / 2);
  ctx.drawImage(bakedLogo(), x - BAKE_PAD, top - BAKE_PAD, LOGO_W + BAKE_PAD * 2, LOGO_H + BAKE_PAD * 2);
  const shine = shinePosition(time);
  if (shine !== null) {
    const pen = new Pen(ctx);
    for (let j = 0; j < LOGO_H; j++) {
      for (let i = 0; i < LOGO_W; i++) {
        if (!filled(i, j)) continue;
        const s = i - j * SHINE_SLANT - shine;
        if (s >= 0 && s < SHINE_WIDTH) pen.rectRaw(x + i, top + j, 1, 1, PAPER.shine);
      }
    }
  }
  return { x, y: top, w: LOGO_W, h: LOGO_H };
}
