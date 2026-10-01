/**
 * タイトル画面の題字（墨書きの「墨淵」）を塗る。字形は生成済みの二値マスク（data/sprites/titleLogo.ts）で、
 * ここは明るい紙色の塗り（影・縁・上下の明暗）と周りの墨の飛沫、6 秒ごとに走る光の筋だけを持つ。
 * 動かない部分は 1 枚の canvas に焼いてキャッシュし、光の筋だけ毎フレーム重ねる。
 */
import { RENDER_SCALE } from "../core/view";
import { TITLE_LOGO_DOTS, TITLE_LOGO_ROWS } from "../data/sprites/titleLogo";
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
/**
 * 以下の長さは「論理 px」で書き、点（1 点 = 論理 1/TITLE_LOGO_DOTS px）に直して使う。
 * 題字の太さは約 3〜4px なので、影は 1px・上の光る縁は 0.5px・下の暗い縁は 1px で釣り合わせる
 */
const SHADOW_OFFSET = 1;
const TOP_EDGE = 0.5;
const BOTTOM_EDGE = 1;
/** 光の筋: 周期・走る時間（秒）・筋の太さ（論理 px）・斜め具合（横 / 縦）・走る範囲の前後（論理 px） */
const SHINE_PERIOD = 6;
const SHINE_RUN_SECONDS = 1.3;
const SHINE_WIDTH = 2;
const SHINE_SLANT = 0.6;
const SHINE_OVERSHOOT = 6;
const SHINE_TAIL = 8;
/** 墨の飛沫の数・出る確率・縦の範囲・横にはみ出す量（論理 px）。大きさは 1〜3 点で、大きいほど稀 */
const SPATTER_COUNT = 28;
const SPATTER_SHOW_CHANCE = 0.6;
const SPATTER_BIG_CHANCE = 0.15;
const SPATTER_MID_CHANCE = 0.4;
const SPATTER_TOP = 0.2;
const SPATTER_SPAN = 0.8;
const SPATTER_MARGIN_X = 8;
/** 飛沫の配置の種（見た目の固定。座標ハッシュ） */
const SPATTER_SEED = 3;
/**
 * かすれ（掠れ）: 筆が乾いて穂先が割れる、画の端の細い欠け。横画は右端、縦画は下端から手前へ
 * 行（列）ごとに決めた長さだけ点を抜く。抜く長さの上限・抜く行の割合・厚みの下限（これ未満の細い画は割らない）
 */
const KASURE_MAX_RUN = 9;
const KASURE_ROW_CHANCE = 0.45;
const KASURE_MIN_THICK = 5;
/** 長い画の判定: 厚みの何倍以上の長さか・数える上限 */
const KASURE_ASPECT = 2.5;
const KASURE_STROKE_LIMIT = 40;
const KASURE_SEED = 11;
/** 焼いた canvas の余白（論理 px。飛沫・影がはみ出す分） */
const BAKE_PAD = 10;

export interface LogoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DOTS = TITLE_LOGO_DOTS;
const LOGO_W = TITLE_LOGO_ROWS[0]?.length ?? 0;
const LOGO_H = TITLE_LOGO_ROWS.length;
/** 論理寸法（点の数 / 密度） */
const LOGICAL_W = LOGO_W / DOTS;
const LOGICAL_H = LOGO_H / DOTS;
/** 論理 px → 点 */
const toDots = (px: number): number => Math.max(1, Math.round(px * DOTS));
const SHADOW_DOTS = toDots(SHADOW_OFFSET);
const TOP_EDGE_DOTS = toDots(TOP_EDGE);
const BOTTOM_EDGE_DOTS = toDots(BOTTOM_EDGE);
const PAD_DOTS = BAKE_PAD * DOTS;

function filled(i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= LOGO_W || j >= LOGO_H) return false;
  return TITLE_LOGO_ROWS[j]?.[i] === "#";
}

/** 上の縁: 真上の TOP_EDGE_DOTS 点先が紙なら、字の上端から縁の太さの内側 */
function onTopEdge(i: number, j: number): boolean {
  return !filled(i, j - TOP_EDGE_DOTS);
}

/** 下の縁: 真下の BOTTOM_EDGE_DOTS 点先が紙なら、字の下端から縁の太さの内側 */
function onBottomEdge(i: number, j: number): boolean {
  return !filled(i, j + BOTTOM_EDGE_DOTS);
}

function bodyColor(i: number, j: number): string {
  if (onTopEdge(i, j)) return PAPER.top;
  if (onBottomEdge(i, j)) return PAPER.lo;
  const f = j / LOGO_H;
  return f < SHADE_HI_UNTIL ? PAPER.hi : f < SHADE_MID_UNTIL ? PAPER.mid : PAPER.lo;
}

/** i, j から dx, dy 方向へ墨が続く点の数（自分を含む。limit で打ち切る） */
function runLength(i: number, j: number, dx: number, dy: number, limit: number): number {
  let n = 0;
  while (n < limit && filled(i + dx * n, j + dy * n)) n++;
  return n;
}

/** 画の向き（dx, dy）に沿った長さと、直交する厚み。長さが厚みの数倍あるときだけ「その向きの画」 */
function strokeAlong(i: number, j: number, dx: number, dy: number): { toEnd: number; long: boolean } {
  const toEnd = runLength(i, j, dx, dy, KASURE_MAX_RUN + 1);
  const length = toEnd + runLength(i, j, -dx, -dy, KASURE_STROKE_LIMIT) - 1;
  const thick = runLength(i, j, dy, dx, KASURE_STROKE_LIMIT) + runLength(i, j, -dy, -dx, KASURE_STROKE_LIMIT) - 1;
  return { toEnd, long: thick >= KASURE_MIN_THICK && length >= thick * KASURE_ASPECT };
}

/** 横画の右端 / 縦画の下端で、行・列ごとの長さの分だけ墨を抜く。字の太さが十分な長い画だけ */
function scratched(i: number, j: number): boolean {
  const h = strokeAlong(i, j, 1, 0);
  if (h.long && hh(j, KASURE_SEED, 1) < KASURE_ROW_CHANCE && h.toEnd <= Math.floor(hh(j, KASURE_SEED, 2) * KASURE_MAX_RUN)) return true;
  const v = strokeAlong(i, j, 0, 1);
  return v.long && hh(i, KASURE_SEED, 3) < KASURE_ROW_CHANCE && v.toEnd <= Math.floor(hh(i, KASURE_SEED, 4) * KASURE_MAX_RUN);
}

/** 点 1 つぶんの矩形を塗る（座標は点単位。焼く canvas の transform が点 → 画素に直す） */
function dot(pen: Pen, i: number, j: number, w: number, h: number, color: string): void {
  pen.rectRaw(PAD_DOTS + i, PAD_DOTS + j, w, h, color);
}

/** 墨の飛沫: 字の外に散らす。字に重なる点は塗らない（字の中に濁りを作らない） */
function paintSpatter(pen: Pen): void {
  const spreadX = LOGO_W + SPATTER_MARGIN_X * 2 * DOTS;
  for (let n = 0; n < SPATTER_COUNT; n++) {
    if (hh(n, SPATTER_SEED, 4) >= SPATTER_SHOW_CHANCE) continue;
    const x = Math.floor(-SPATTER_MARGIN_X * DOTS + hh(n, SPATTER_SEED, 1) * spreadX);
    const y = Math.floor(LOGO_H * (SPATTER_TOP + hh(n, SPATTER_SEED, 2) * SPATTER_SPAN));
    const r = hh(n, SPATTER_SEED, 3);
    const size = r < SPATTER_BIG_CHANCE ? 3 : r < SPATTER_MID_CHANCE ? 2 : 1;
    if (filled(x, y)) continue;
    dot(pen, x, y, size, size, PAPER.lo);
  }
}

function paintLogo(pen: Pen): void {
  for (let j = 0; j < LOGO_H; j++) {
    for (let i = 0; i < LOGO_W; i++) {
      if (filled(i, j)) dot(pen, i + SHADOW_DOTS, j + SHADOW_DOTS, 1, 1, PAPER.shadow);
    }
  }
  for (let j = 0; j < LOGO_H; j++) {
    for (let i = 0; i < LOGO_W; i++) {
      if (filled(i, j) && !scratched(i, j)) dot(pen, i, j, 1, 1, bodyColor(i, j));
    }
  }
  paintSpatter(pen);
}

let baked: HTMLCanvasElement | null = null;

/** 焼く canvas は画素 = 点の整数倍（1 点 = RENDER_SCALE / DOTS 画素）で作り、論理座標へ縮めずに貼る */
function bakedLogo(): HTMLCanvasElement {
  if (baked) return baked;
  const pixelsPerDot = RENDER_SCALE / DOTS;
  const canvas = document.createElement("canvas");
  canvas.width = (LOGO_W + PAD_DOTS * 2) * pixelsPerDot;
  canvas.height = (LOGO_H + PAD_DOTS * 2) * pixelsPerDot;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.setTransform(pixelsPerDot, 0, 0, pixelsPerDot, 0, 0);
  ctx.imageSmoothingEnabled = false;
  paintLogo(new Pen(ctx));
  baked = canvas;
  return canvas;
}

/** 光の筋の位置（点単位。走っていない間は null） */
export function shinePosition(time: number): number | null {
  const cycle = (time + 1000) % SHINE_PERIOD;
  if (cycle >= SHINE_RUN_SECONDS) return null;
  return (cycle / SHINE_RUN_SECONDS) * (LOGO_W + LOGO_H + SHINE_TAIL * DOTS) - SHINE_OVERSHOOT * DOTS;
}

/** 題字の上端中央を (cx, top) に置いて描く。戻り値は字の外接矩形（論理座標。添えの文字の位置決め用） */
export function drawTitleLogo(ctx: CanvasRenderingContext2D, cx: number, top: number, time: number): LogoBox {
  // 横は点の格子（論理 1/DOTS px）に丸める。バックバッファは RENDER_SCALE 倍なので点は必ず整数画素に乗る
  const x = Math.round((cx - LOGICAL_W / 2) * DOTS) / DOTS;
  const pad = BAKE_PAD;
  ctx.drawImage(bakedLogo(), x - pad, top - pad, LOGICAL_W + pad * 2, LOGICAL_H + pad * 2);
  const shine = shinePosition(time);
  if (shine !== null) {
    const pen = new Pen(ctx);
    const width = SHINE_WIDTH * DOTS;
    const dotSize = 1 / DOTS;
    for (let j = 0; j < LOGO_H; j++) {
      for (let i = 0; i < LOGO_W; i++) {
        if (!filled(i, j)) continue;
        const s = i - j * SHINE_SLANT - shine;
        if (s >= 0 && s < width) pen.rectRaw(x + i * dotSize, top + j * dotSize, dotSize, dotSize, PAPER.shine);
      }
    }
  }
  return { x, y: top, w: LOGICAL_W, h: LOGICAL_H };
}
