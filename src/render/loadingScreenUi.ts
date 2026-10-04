/**
 * 読み込み画面「絵巻」の描画（docs/ideas/loading-screen.md）。段取りは ui/loadingScreen.ts、紙と山水の画素は loadingScrollArt.ts。
 * 暗い墨染めの地に巻物を置き、右の軸が開きに合わせて転がる。題箋に行き先（縦書き）、広げきったら朱印、下に Tips 1 項目。
 * 絵は密度 2（1 ドット = 論理 0.5px）の画素で作り、論理座標へ縮めて置く。文字は drawText
 */
import type { FloorKind } from "../core/state";
import { RENDER_SCALE, VIEW_H, VIEW_W } from "../core/view";
import { LOADING } from "../data/tuning";
import { type LoadingScreen, loadingAlpha, loadingPromptVisible, loadingTitle, sealAge, verticalCells } from "../ui/loadingScreen";
import { SCROLL_BAND, SCROLL_H, SCROLL_W, scrollPixels } from "./loadingScrollArt";
import { h32, hf, pack, vnoise } from "./mapNoise";
import type { MapStyle } from "./mapTypes";
import { keyLabel } from "../core/input";
import { TEXT, drawText, textLineHeight, wrapText } from "./pixelText";

/** 絵のドット → 論理 px */
const DOT = 0.5;
/** 巻物の紙の左上（論理 px） */
const PAPER_X = 75;
const PAPER_Y = 48;
const PAPER_W = SCROLL_W * DOT;
const PAPER_H = SCROLL_H * DOT;
/** 閉じているときに見えている紙の幅（論理 px） */
const CLOSED_W = 3;
/** 軸（論理 px）。木の円柱と金の軸先 */
const ROLLER_W = 9;
const ROLLER_OVER = 3;
const ROLLER_CAP = 5;
/** 開いた紙の端の、軸の落とす影の幅（論理 px） */
const ROLLER_SHADE_W = 5;
const ROLLER_SHADE_ALPHA = 0.35;
/** 巻物の下の影 */
const DROP_SHADOW_H = 4;
const DROP_SHADOW_ALPHA = 0.5;
/** 題箋（紙の右寄り。論理 px） */
const SLIP_X = 368;
const SLIP_W = 22;
const SLIP_Y = PAPER_Y + SCROLL_BAND * DOT + 6;
const SLIP_H = 124;
const SLIP_PAD_TOP = 6;
const SLIP_SUB_GAP = 3;
const SLIP_COLOR = "#e9e2d0";
const SLIP_EDGE = "#8a7a5a";
const SLIP_INK = "#0b0a0d";
const SLIP_SUB_INK = "#3a3438";
/** 朱印（論理 px の一辺）と押す弾みの大きさ */
const SEAL_SIZE = 18;
const SEAL_POP = 0.7;
const SEAL_WOBBLE = 0.04;
const SEAL_WOBBLE_DECAY = 18;
const SEAL_WOBBLE_FREQ = 60;
const SEAL_Y = SLIP_Y + SLIP_H - SEAL_SIZE / 2 - 3;
/** 朱印は画面の実際の細かさ（論理 1px = RENDER_SCALE ドット）で作る。ドットフォントの 16 ドットでは画数の多い字が潰れる */
export const SEAL_DOTS = SEAL_SIZE * RENDER_SCALE;
const SHU = [200, 58, 42] as const;
/** 刻んだ線の内の色（紙の地が覗く） */
const SEAL_CARVE = [236, 226, 206] as const;
/** 印の縁の欠けの幅と、刻んだ線の太さ（印の一辺に対する割合） */
const SEAL_CHIP = 0.04;
const SEAL_STROKE = 0.085;
/**
 * 「淵」を篆刻ふうの線で（白文印）。座標は印の内側を 0..1 にした折れ線。
 * 左は三水（点・点・はね）、右は二本の縦の囲みに中の縦・横と上下の払い
 */
const SEAL_GLYPH: readonly (readonly [number, number][])[] = [
  [
    [0.1, 0.12],
    [0.2, 0.24],
  ],
  [
    [0.06, 0.38],
    [0.18, 0.47],
  ],
  [
    [0.06, 0.9],
    [0.22, 0.62],
  ],
  [
    [0.34, 0.06],
    [0.34, 0.94],
  ],
  [
    [0.9, 0.06],
    [0.9, 0.94],
  ],
  [
    [0.34, 0.5],
    [0.9, 0.5],
  ],
  [
    [0.62, 0.06],
    [0.62, 0.94],
  ],
  [
    [0.45, 0.18],
    [0.55, 0.38],
  ],
  [
    [0.79, 0.18],
    [0.69, 0.38],
  ],
  [
    [0.45, 0.84],
    [0.56, 0.62],
  ],
  [
    [0.79, 0.84],
    [0.68, 0.62],
  ],
];
/** 字を置く印の内側の余白（割合） */
const SEAL_INSET = 0.15;
/** 刻んだ線の縁を荒らす度合い（刀の跡） */
const SEAL_ROUGH = 0.18;
/** Tips（巻物の下） */
const TIP_Y = PAPER_Y + PAPER_H + 14;
const TIP_W = 310;
const TIP_GAP = 4;
const TIP_HEAD_COLOR = "#c8a050";
const TIP_BODY_COLOR = "#e8e2d4";
const TIP_HEAD = "心得";
/** 「クリックで進む」の案内（Tips の下） */
const PROMPT_Y = 250;
const PROMPT_COLOR = "#9a948a";
/** 行の高さの下限（論理 px） */
const TEXT_TITLE_MIN = 15;
const TEXT_SMALL_MIN = 10;
/** 地（墨染め）の色 */
const GROUND = [20, 18, 22] as const;
const FIBER_A = [28, 26, 32] as const;
const FIBER_B = [16, 14, 18] as const;
const GROUND_SEED = 6;
/** 地の周辺の暗さ（中心からの距離の 2 乗に掛ける） */
const VIGNETTE = 0.35;

/** 紙の絵の鍵（同じ絵を作り直さない） */
export interface LoadingArt {
  style: MapStyle;
  floorKind: FloorKind | null;
  seed: number;
}

function makeCanvas(w: number, h: number, pixels: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D context unavailable");
  const img = new ImageData(w, h);
  new Uint32Array(img.data.buffer).set(pixels);
  g.putImageData(img, 0, 0);
  return canvas;
}

/** 墨染めの地（繊維と周辺の暗さ）。画面ぶんのドット */
function groundPixels(): Uint32Array {
  const w = VIEW_W / DOT;
  const h = VIEW_H / DOT;
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = vnoise(x, y * 30, 50, GROUND_SEED);
      const speck = h32(x, y, GROUND_SEED) % 1000 > 985;
      const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / 1.2;
      const k = 1 - VIGNETTE * d * d;
      const c = f > 0.72 ? FIBER_A : f < 0.24 || speck ? FIBER_B : GROUND;
      out[y * w + x] = pack(c[0] * k, c[1] * k, c[2] * k);
    }
  }
  return out;
}

/** 点 (px, py) から線分 a-b までの距離 */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * 朱印の画素（size x size ドット、行優先）。欠けと擦れのある朱の四角に「淵」を白く刻む。
 * 透明（0）は欠け、SEAL_CARVE の色は刻んだ線
 */
export function sealPixels(size: number): Uint32Array {
  const out = new Uint32Array(size * size);
  const chip = Math.max(1, Math.round(size * SEAL_CHIP));
  const inner = size * (1 - SEAL_INSET * 2);
  const half = (size * SEAL_STROKE) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if ((edge < chip && hf(x, y, 5) > 0.55) || hf(x, y, 6) > 0.97) continue;
      const u = (x - size * SEAL_INSET) / inner;
      const v = (y - size * SEAL_INSET) / inner;
      let d = Number.POSITIVE_INFINITY;
      for (const line of SEAL_GLYPH) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (!a || !b) continue;
          d = Math.min(d, segmentDistance(u, v, a[0], a[1], b[0], b[1]) * inner);
        }
      }
      const rough = (vnoise(x, y, size * 0.06, 9) - 0.5) * half * SEAL_ROUGH * 4;
      if (d <= half + rough) {
        out[y * size + x] = pack(SEAL_CARVE[0], SEAL_CARVE[1], SEAL_CARVE[2]);
        continue;
      }
      const k = 0.88 + vnoise(x, y, size * 0.1, 5) * 0.18;
      out[y * size + x] = pack(SHU[0] * k, SHU[1] * k, SHU[2] * k);
    }
  }
  return out;
}

/** 木の円柱（左右に明暗）と上下の金の軸先 */
function drawRoller(ctx: CanvasRenderingContext2D, x: number): void {
  const cols = ROLLER_W / DOT;
  for (let k = 0; k < cols; k++) {
    const u = k / (cols - 1);
    const lum = 0.45 + 0.55 * Math.sin(u * Math.PI) - (u > 0.7 ? 0.2 : 0);
    const cx = x + k * DOT;
    ctx.fillStyle = `rgb(${Math.round(58 * lum + 10)},${Math.round(36 * lum + 6)},${Math.round(24 * lum + 4)})`;
    ctx.fillRect(cx, PAPER_Y - ROLLER_OVER, DOT, PAPER_H + ROLLER_OVER * 2);
    ctx.fillStyle = `rgb(${Math.round(200 * lum)},${Math.round(160 * lum)},${Math.round(80 * lum)})`;
    ctx.fillRect(cx, PAPER_Y - ROLLER_OVER - ROLLER_CAP, DOT, ROLLER_CAP);
    ctx.fillRect(cx, PAPER_Y + PAPER_H + ROLLER_OVER, DOT, ROLLER_CAP);
  }
}

export class LoadingScreenLayer {
  private ground: HTMLCanvasElement | null = null;
  private seal: HTMLCanvasElement | null = null;
  private paper: HTMLCanvasElement | null = null;
  private paperKey = "";

  private paperFor(art: LoadingArt): HTMLCanvasElement {
    const key = `${art.style}|${art.floorKind ?? ""}|${art.seed}`;
    if (this.paper && this.paperKey === key) return this.paper;
    this.paper = makeCanvas(SCROLL_W, SCROLL_H, scrollPixels(art));
    this.paperKey = key;
    return this.paper;
  }

  /** 読み込み画面を描く（薄れる段は不透明度を下げて、後ろの階の画面に重ねる）。ctx は論理座標 */
  draw(ctx: CanvasRenderingContext2D, ls: LoadingScreen, art: LoadingArt): void {
    const alpha = loadingAlpha(ls);
    if (alpha <= 0) return;
    this.ground ??= makeCanvas(VIEW_W / DOT, VIEW_H / DOT, groundPixels());
    this.seal ??= makeCanvas(SEAL_DOTS, SEAL_DOTS, sealPixels(SEAL_DOTS));
    const paper = this.paperFor(art);
    const prevAlpha = ctx.globalAlpha;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.ground, 0, 0, VIEW_W, VIEW_H);

    // 紙の開き（論理 px の幅）。開いた所だけ紙と絵を見せる
    const openW = Math.round((CLOSED_W + (PAPER_W - CLOSED_W) * ls.open) / DOT) * DOT;
    ctx.fillStyle = `rgba(0,0,0,${DROP_SHADOW_ALPHA})`;
    ctx.fillRect(PAPER_X + DROP_SHADOW_H, PAPER_Y + PAPER_H, openW, DROP_SHADOW_H);
    ctx.drawImage(paper, 0, 0, openW / DOT, SCROLL_H, PAPER_X, PAPER_Y, openW, PAPER_H);
    ctx.fillStyle = `rgba(0,0,0,${ROLLER_SHADE_ALPHA})`;
    for (let k = 1; k <= ROLLER_SHADE_W / DOT; k++) ctx.fillRect(PAPER_X + openW - k * DOT, PAPER_Y + SCROLL_BAND * DOT, DOT, PAPER_H - SCROLL_BAND * DOT * 2);

    // 題箋は紙がそこまで開いてから
    if (PAPER_X + openW > SLIP_X + SLIP_W) this.drawSlip(ctx, ls);
    drawRoller(ctx, PAPER_X - ROLLER_W);
    drawRoller(ctx, PAPER_X + openW);
    this.drawTip(ctx, ls);
    if (loadingPromptVisible(ls)) drawText(ctx, `クリック / ${keyLabel("confirm", { first: true })} で進む`, VIEW_W / 2, PROMPT_Y, TEXT.SMALL, PROMPT_COLOR, "center", "top");
    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmooth;
  }

  private drawSlip(ctx: CanvasRenderingContext2D, ls: LoadingScreen): void {
    ctx.fillStyle = SLIP_COLOR;
    ctx.fillRect(SLIP_X, SLIP_Y, SLIP_W, SLIP_H);
    ctx.fillStyle = SLIP_EDGE;
    ctx.fillRect(SLIP_X, SLIP_Y, SLIP_W, 1);
    ctx.fillRect(SLIP_X, SLIP_Y + SLIP_H - 1, SLIP_W, 1);
    ctx.fillRect(SLIP_X, SLIP_Y, 1, SLIP_H);
    ctx.fillRect(SLIP_X + SLIP_W - 1, SLIP_Y, 1, SLIP_H);
    const { title, sub } = loadingTitle(ls.place);
    const cx = SLIP_X + SLIP_W / 2;
    const titleH = Math.max(TEXT_TITLE_MIN, textLineHeight(TEXT.TITLE));
    let y = SLIP_Y + SLIP_PAD_TOP;
    for (const cell of verticalCells(title)) {
      drawText(ctx, cell, cx, y, TEXT.TITLE, SLIP_INK, "center", "top");
      y += titleH;
    }
    if (sub !== "") {
      y += SLIP_SUB_GAP;
      const subH = Math.max(TEXT_SMALL_MIN, textLineHeight(TEXT.SMALL));
      for (const cell of verticalCells(sub)) {
        drawText(ctx, cell, cx, y, TEXT.SMALL, SLIP_SUB_INK, "center", "top");
        y += subH;
      }
    }
    this.drawSeal(ctx, sealAge(ls));
  }

  private drawSeal(ctx: CanvasRenderingContext2D, age: number | null): void {
    if (age === null || !this.seal) return;
    const t = Math.min(1, age / LOADING.sealSec);
    const settled = age - LOADING.sealSec;
    const scale = t < 1 ? 1 + SEAL_POP * (1 - t * t) : 1 + SEAL_WOBBLE * Math.exp(-settled * SEAL_WOBBLE_DECAY) * Math.sin(settled * SEAL_WOBBLE_FREQ);
    const size = Math.round(SEAL_SIZE * scale * RENDER_SCALE) / RENDER_SCALE;
    const cx = SLIP_X + SLIP_W / 2;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, 0.3 + t);
    ctx.drawImage(this.seal, cx - size / 2, SEAL_Y - size / 2, size, size);
    ctx.globalAlpha = prev;
  }

  private drawTip(ctx: CanvasRenderingContext2D, ls: LoadingScreen): void {
    const tip = ls.tip;
    if (!tip) return;
    const cx = VIEW_W / 2;
    const lineH = Math.max(TEXT_SMALL_MIN, textLineHeight(TEXT.SMALL));
    drawText(ctx, `${TIP_HEAD} ・ ${tip.term}`, cx, TIP_Y, TEXT.SMALL, TIP_HEAD_COLOR, "center", "top");
    wrapText(tip.body, TIP_W, TEXT.SMALL).forEach((line, i) => {
      drawText(ctx, line, cx, TIP_Y + lineH + TIP_GAP + i * lineH, TEXT.SMALL, TIP_BODY_COLOR, "center", "top");
    });
  }
}
