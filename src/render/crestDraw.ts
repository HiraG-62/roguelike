import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import { RESONANCE } from "../data/tuning";
import type { CrestBead, CrestShape } from "../ui/crestShape";
import { miniCrestRows } from "../ui/crestShape";
import type { MenuTextRole, MenuTextRun } from "../ui/menuBudget";
import type { BandDelta } from "../ui/tryOn";
import { tileHash } from "./renderMath";
import { type PixelTextAlign, TEXT, type TextSizeKey, drawText, truncateText } from "./pixelText";

/**
 * 装備画面（装束と紋）の描画の部品（docs/ideas/inventory-v2/E-impl.md 4-3 E2）。見本 E.html の
 * R / box / disc / diamond / line / brackets と、紋の部品 band / bandMorph / bead / glyphDisc / stepDots を移したもの。
 * 動きは ui.time（秒）と座標だけで作る（state.rng も実時間も使わない）。
 * 色の表 MENU_INK と文字の記録（情報の予算のテスト用）もここに置き、render/inventoryUi.ts が再 export する
 * （頁の描画がどれも読むので、いちばん下の層に置いて循環 import を作らない）
 */

/** 墨染めの帳と漆の縁の色（見本 E.html の :root と同じ） */
export const MENU_INK = {
  paper: "#141216",
  fiberA: "#1c1a20",
  fiberB: "#100e12",
  card: "#1e1b22",
  card2: "#2a2630",
  rule: "#3a3640",
  text: "#e8e2d4",
  sub: "#9a948a",
  dim: "#5c5852",
  focus: "#fff4d0",
  shu: "#c83a2a",
  gold: "#c8a050",
  goldHi: "#f0d890",
  goldLo: "#7a5a28",
  frame1: "#2a282c",
  frame2: "#b0342c",
  frame3: "#c8a050",
  up: "#8fd08a",
  down: "#ff7a70",
  bud: "#6cd080",
  budStem: "#3a8a50",
  litFill: "#3a3428",
  gem: "#3a2e46",
} as const;

// -----------------------------------------------------------------------------
// 文字（pixelText を通し、情報の予算のテストのために記録する）
// -----------------------------------------------------------------------------

export interface MenuTextOptions {
  size: TextSizeKey;
  color: string;
  /** 予算の数え方（ui/menuBudget.ts）。sentence = 文 / label = 数を含みうる短い文字 / ornament = 丸印の 1 字など */
  role: MenuTextRole;
  align?: PixelTextAlign;
  /** 幅に収まらなければ末尾を … で切る */
  maxW?: number;
  /** y を文字の上端（top）か中央（middle）で読む */
  baseline?: "top" | "middle";
}

interface MenuDrawRecord {
  runs: MenuTextRun[];
  marks: number;
}

/** captureMenuDraw の間だけ描いた文字と印を記録する（テスト専用の入口。描画そのものは変えない） */
let recording: MenuDrawRecord | null = null;

/** 装備画面の文字 1 つ。y は上端（baseline = middle なら中央） */
export function menuText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: MenuTextOptions): void {
  const m = TEXT[opts.size];
  const shown = opts.maxW === undefined ? text : truncateText(text, opts.maxW, m);
  if (shown === "") return;
  drawText(ctx, shown, x, y, m, opts.color, opts.align ?? "left", opts.baseline ?? "top");
  recording?.runs.push({ text: shown, y, body: opts.size !== "SMALL", role: opts.role });
}

/** 印（部位・石・行動・系譜・丸印）を描いたら数える（情報の予算の「印 28」） */
export function noteMarks(n = 1): void {
  if (recording !== null) recording.marks += n;
}

/** fn の間に描いた文字と印を集める（render のテストが情報の予算を数える。終われば記録を外す） */
export function captureMenuDraw(fn: () => void): MenuDrawRecord {
  const prev = recording;
  const rec: MenuDrawRecord = { runs: [], marks: 0 };
  recording = rec;
  try {
    fn();
  } finally {
    recording = prev;
  }
  return rec;
}

// -----------------------------------------------------------------------------
// 塗りの道具（論理 480x270。整数の座標に寄せて 1 ドットの線を崩さない）
// -----------------------------------------------------------------------------

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

/** 1 ドットの枠 */
export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  px(ctx, x, y, w, 1, color);
  px(ctx, x, y + h - 1, w, 1, color);
  px(ctx, x, y, 1, h, color);
  px(ctx, x + w - 1, y, 1, h, color);
}

/** 破線の枠（2 ドット描いて 1 ドット空ける） */
const DASH_ON = 2;
const DASH_STEP = 3;
export function dashBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  for (let i = 0; i < w; i += DASH_STEP) {
    px(ctx, x + i, y, Math.min(DASH_ON, w - i), 1, color);
    px(ctx, x + i, y + h - 1, Math.min(DASH_ON, w - i), 1, color);
  }
  for (let j = 0; j < h; j += DASH_STEP) {
    px(ctx, x, y + j, 1, Math.min(DASH_ON, h - j), color);
    px(ctx, x + w - 1, y + j, 1, Math.min(DASH_ON, h - j), color);
  }
}

/** 行 j の円の半幅（ドットの中心で測る） */
function discHalf(r: number, j: number): number {
  const dy = j + 0.5 - r;
  if (Math.abs(dy) > r) return -1;
  return Math.sqrt(r * r - dy * dy);
}

/** 円（直径 d）。ring = 縁の色（幅 ringW）、fill = 中の色（null なら塗らない）。行ごとの区間で塗る */
export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, ring: string | null, fill: string | null, ringW = 1): void {
  const r = d / 2;
  for (let j = 0; j < d; j++) {
    const outer = discHalf(r, j);
    if (outer < 0) continue;
    const x0 = Math.round(r - outer);
    const x1 = Math.round(r + outer);
    const inner = discHalf(r - ringW, j - ringW);
    const innerOk = inner >= 0 && j >= ringW && j < d - ringW;
    const i0 = innerOk ? Math.max(x0, Math.round(r - inner)) : x1;
    const i1 = innerOk ? Math.min(x1, Math.round(r + inner)) : x1;
    if (ring !== null) {
      px(ctx, x + x0, y + j, i0 - x0, 1, ring);
      px(ctx, x + i1, y + j, x1 - i1, 1, ring);
    }
    if (fill !== null) px(ctx, x + i0, y + j, i1 - i0, 1, fill);
  }
}

/** 菱形（直径 d）。縁 1.3 ドットを ring、中を fill */
export function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, ring: string, fill: string): void {
  const r = d / 2;
  for (let j = 0; j < d; j++) {
    const half = r - Math.abs(j + 0.5 - r);
    if (half <= 0) continue;
    const x0 = Math.round(r - half);
    const x1 = Math.round(r + half);
    const innerHalf = half - 1.3;
    if (innerHalf <= 0) {
      px(ctx, x + x0, y + j, x1 - x0, 1, ring);
      continue;
    }
    const i0 = Math.round(r - innerHalf);
    const i1 = Math.round(r + innerHalf);
    px(ctx, x + x0, y + j, i0 - x0, 1, ring);
    px(ctx, x + i0, y + j, i1 - i0, 1, fill);
    px(ctx, x + i1, y + j, x1 - i1, 1, ring);
  }
}

/** 線（Bresenham）。dotted なら 2 ドットおきに抜く */
export function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, dotted = false): void {
  let x0 = Math.round(ax);
  let y0 = Math.round(ay);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; ; n++) {
    if (!dotted || (n >> 1) % 2 === 0) px(ctx, x0, y0, 1, 1, color);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** 焦点の角括弧（四隅の L 字） */
const BRACKET_LEN = 3;
export function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  const l = BRACKET_LEN;
  px(ctx, x - 1, y - 1, l, 1, color);
  px(ctx, x - 1, y - 1, 1, l, color);
  px(ctx, x + w - l + 1, y - 1, l, 1, color);
  px(ctx, x + w, y - 1, 1, l, color);
  px(ctx, x - 1, y + h, l, 1, color);
  px(ctx, x - 1, y + h - l + 1, 1, l, color);
  px(ctx, x + w - l + 1, y + h, l, 1, color);
  px(ctx, x + w, y + h - l + 1, 1, l, color);
}

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), HEX_RADIX);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & CHANNEL_MAX, (n >> 8) & CHANNEL_MAX, n & CHANNEL_MAX];
}

/** 2 色を a（0..1）で混ぜる（#rrggbb どうし） */
export function mixHex(hex: string, to: string, a: number): string {
  const p = channels(hex);
  const q = channels(to);
  const out = p.map((v, i) => Math.round(v + ((q[i] ?? 0) - v) * a));
  return `#${out.map((v) => Math.max(0, Math.min(CHANNEL_MAX, v)).toString(HEX_RADIX).padStart(2, "0")).join("")}`;
}

const BLACK = "#000000";
const WHITE = "#ffffff";

/** 点滅（周期 period 秒の前半だけ true） */
export function blinkOn(time: number, period = 0.6): boolean {
  return Math.floor(time / period) % 2 === 0;
}

// -----------------------------------------------------------------------------
// 紋の部品
// -----------------------------------------------------------------------------

/** 丸印の字の大きさ（丸の直径で選ぶ） */
function glyphSize(d: number): TextSizeKey {
  if (d >= 36) return "TITLE";
  if (d >= 22) return "BODY";
  return "SMALL";
}

/** 丸の縁が太くなる直径 */
const THICK_RING_D = 24;

/** 系統の丸印（中心 cx, cy・直径 d）。伏流は縁を墨に */
export function drawGlyphDisc(
  ctx: CanvasRenderingContext2D,
  keyword: Keyword,
  cx: number,
  cy: number,
  d: number,
  color: string,
  opts: { under?: boolean; focus?: boolean } = {},
): void {
  const x = Math.round(cx - d / 2);
  const y = Math.round(cy - d / 2);
  disc(ctx, x, y, d, opts.under === true ? MENU_INK.dim : color, MENU_INK.paper, d >= THICK_RING_D ? 2 : 1);
  if (opts.focus === true) disc(ctx, x - 2, y - 2, d + 4, MENU_INK.focus, null);
  menuText(ctx, KEYWORD_DEFS[keyword].glyph, x + d / 2, cy, {
    size: glyphSize(d),
    color: opts.under === true ? MENU_INK.sub : color,
    role: "ornament",
    align: "center",
    baseline: "middle",
  });
  noteMarks();
}

/** 段の点（上限 RESONANCE.maxSteps 個。立った段は色、残りは墨の枠） */
export function drawStepDots(ctx: CanvasRenderingContext2D, x: number, y: number, step: number, color: string, s = 3, gap = 3): void {
  for (let i = 0; i < RESONANCE.maxSteps; i++) {
    if (i < step) px(ctx, x + i * (s + gap), y, s, s, color);
    else box(ctx, x + i * (s + gap), y, s, s, MENU_INK.dim);
  }
}

/** 光の走る周期（ドット）と、伏流の点線の動き（秒あたりのコマ） */
const SHINE_PERIOD = 18;
const SHINE_W = 3;
const SHINE_FRAME = 0.11;
const UNDER_FRAME = 0.22;
const UNDER_PHASES = 4;

/** 帯（段で太さ 2 / 4 / 6px、光の走る速さも段。段 0 は伏流の点線） */
export function drawBand(ctx: CanvasRenderingContext2D, x0: number, x1: number, cy: number, step: number, color: string, time: number, opts: { dimColor?: string } = {}): void {
  if (step <= 0) {
    const ph = Math.floor(time / UNDER_FRAME) % UNDER_PHASES;
    for (let x = x0; x < x1; x++) if (((x + ph) >> 1) % 2 === 0) px(ctx, x, cy, 1, 1, opts.dimColor ?? MENU_INK.dim);
    return;
  }
  const t = step * 2;
  const top = cy - t / 2;
  px(ctx, x0, top, x1 - x0, t, color);
  const hi = mixHex(color, WHITE, 0.55);
  const ph = Math.floor(time / SHINE_FRAME) * step;
  const inset = t > 2 ? 1 : 0;
  for (let x = x0; x < x1; x++) {
    if ((((x - ph) % SHINE_PERIOD) + SHINE_PERIOD) % SHINE_PERIOD < SHINE_W) px(ctx, x, top + inset, 1, Math.max(1, t - 2 * inset), hi);
  }
  px(ctx, x0, top, x1 - x0, 1, mixHex(color, WHITE, 0.2));
  px(ctx, x0, top + t - 1, x1 - x0, 1, mixHex(color, BLACK, 0.35));
}

/** 比べるときの帯の変化の 1 コマの秒と、最後のコマ */
const MORPH_FRAME = 0.09;
const MORPH_FRAMES = 3;
/** ひびの数 */
const CRACKS = 4;

/** 帯の変化（4 コマ。太る ▲ / ひび ▼ / 消える / 新しく立つ）。start = 焦点が動いた ui.time */
export function drawBandMorph(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  cy: number,
  delta: Readonly<BandDelta>,
  color: string,
  time: number,
  start: number,
): void {
  const f = Math.max(0, Math.min(MORPH_FRAMES, Math.floor((time - start) / MORPH_FRAME)));
  const fromT = delta.from * 2;
  const toT = delta.to * 2;
  if (delta.change === "gone") {
    if (f === 0) {
      drawBand(ctx, x0, x1, cy, delta.from, color, time);
      return;
    }
    const keep = f === 1 ? 2 : f === 2 ? 4 : Number.POSITIVE_INFINITY;
    const shade = mixHex(color, BLACK, 0.5);
    for (let x = x0; x < x1; x++) for (let y = cy - fromT / 2; y < cy + fromT / 2; y++) if ((x + y) % keep === 0) px(ctx, x, y, 1, 1, shade);
    if (f >= MORPH_FRAMES) drawBand(ctx, x0, x1, cy, 0, color, time, { dimColor: MENU_INK.down });
    return;
  }
  if (delta.change === "new") {
    drawBand(ctx, x0, x1, cy, 0, color, time);
    if (f === 0) return;
    const w = Math.round((x1 - x0) * Math.min(1, (f + 1) / (MORPH_FRAMES + 1)));
    const mid = (x0 + x1) >> 1;
    drawBand(ctx, mid - (w >> 1), mid + (w >> 1), cy, Math.max(1, Math.round(delta.to * Math.min(1, f / MORPH_FRAMES))), color, time);
    return;
  }
  if (delta.change === "up" || delta.change === "crack") {
    drawBand(ctx, x0, x1, cy, f >= MORPH_FRAMES ? delta.to : delta.from, color, time);
    if (delta.change === "up" && f >= MORPH_FRAMES) px(ctx, x0, cy - toT / 2 - 1, x1 - x0, 1, mixHex(color, WHITE, 0.6));
    if (delta.change === "crack" && f >= 2) {
      for (let i = 0; i < CRACKS; i++) {
        // ひびの位置は座標のハッシュで決める（描画で rng を使わない）
        const x = x0 + 6 + (tileHash(i, cy) % Math.max(1, x1 - x0 - 12));
        px(ctx, x, cy - toT / 2 - 1, 1, toT + 2, MENU_INK.paper);
        px(ctx, x + 1, cy - 1, 1, 2, MENU_INK.down);
      }
    }
    return;
  }
  drawBand(ctx, x0, x1, cy, delta.to, color, time);
}

/** 珠の調子: lit = 焦点の物（白く）/ ink = 焦点以外（墨に沈む）/ n = ふつう */
export type BeadTone = "lit" | "ink" | "n";

function beadRing(tone: BeadTone, inkColor: string): string {
  if (tone === "lit") return MENU_INK.focus;
  return tone === "ink" ? inkColor : MENU_INK.sub;
}

/** 珠（出どころ）12px か 8px。遺物 = 角 / 石 = 菱形 / 祝福 = 小札 / 流儀・型 = 二重丸。glyph は 12px の遺物の角に載せる 1 字 */
export function drawBead(ctx: CanvasRenderingContext2D, bead: Readonly<CrestBead>, x: number, y: number, size: 12 | 8, tone: BeadTone, glyph?: string): void {
  if (size === 8) {
    drawMiniBead(ctx, bead, x, y, tone);
    return;
  }
  const ring = beadRing(tone, MENU_INK.dim);
  const fill = tone === "lit" ? MENU_INK.litFill : MENU_INK.card;
  switch (bead.shape) {
    case "relic":
      px(ctx, x, y, 12, 12, fill);
      box(ctx, x, y, 12, 12, ring);
      if (glyph !== undefined) menuText(ctx, glyph, x + 6, y + 6, { size: "SMALL", color: tone === "ink" ? MENU_INK.dim : tone === "lit" ? MENU_INK.focus : bead.color, role: "ornament", align: "center", baseline: "middle" });
      else px(ctx, x + 4, y + 4, 4, 4, tone === "ink" ? MENU_INK.dim : bead.color);
      return;
    case "stone":
      diamond(ctx, x, y, 12, ring, tone === "lit" ? MENU_INK.litFill : MENU_INK.card2);
      px(ctx, x + 5, y + 5, 2, 2, tone === "ink" ? MENU_INK.dim : bead.color);
      return;
    case "boon": {
      const col = tone === "ink" ? MENU_INK.dim : tone === "lit" ? MENU_INK.focus : bead.color;
      px(ctx, x + 2, y + 1, 8, 11, col);
      px(ctx, x + 5, y + 1, 2, 2, MENU_INK.paper);
      px(ctx, x + 3, y + 4, 6, 1, mixHex(col, BLACK, 0.45));
      if (tone === "lit") box(ctx, x + 1, y, 10, 13, MENU_INK.focus);
      return;
    }
    case "origin":
      disc(ctx, x, y, 12, ring, fill);
      disc(ctx, x + 3, y + 3, 6, ring, null);
      return;
  }
}

/** 写しの珠（8px。字を載せない） */
function drawMiniBead(ctx: CanvasRenderingContext2D, bead: Readonly<CrestBead>, x: number, y: number, tone: BeadTone): void {
  const ring = beadRing(tone, MENU_INK.rule);
  switch (bead.shape) {
    case "relic":
      px(ctx, x, y, 8, 8, tone === "lit" ? MENU_INK.focus : MENU_INK.card);
      box(ctx, x, y, 8, 8, ring);
      if (tone !== "lit") px(ctx, x + 3, y + 3, 2, 2, tone === "ink" ? MENU_INK.rule : bead.color);
      return;
    case "stone":
      diamond(ctx, x, y, 8, ring, tone === "lit" ? MENU_INK.focus : MENU_INK.card2);
      return;
    case "boon": {
      const col = tone === "ink" ? MENU_INK.rule : tone === "lit" ? MENU_INK.focus : bead.color;
      px(ctx, x + 1, y, 6, 8, col);
      px(ctx, x + 3, y, 2, 1, MENU_INK.paper);
      return;
    }
    case "origin":
      disc(ctx, x, y, 8, ring, tone === "lit" ? MENU_INK.focus : null);
      px(ctx, x + 3, y + 3, 2, 2, ring);
      return;
  }
}

/** 畳んだ珠（中に点 1〜3） */
export function drawOverflowBead(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, tone: BeadTone, d = 12): void {
  const c = tone === "ink" ? MENU_INK.dim : MENU_INK.sub;
  px(ctx, x, y, d, d, MENU_INK.card);
  box(ctx, x, y, d, d, c);
  const big = d >= 12;
  const s = big ? 2 : 1;
  for (let i = 0; i < Math.min(3, n); i++) px(ctx, x + (big ? 3 + i * 3 : 1 + i * 2), y + (d >> 1) - 1, s, s, c);
}

/** 伏流の「＋」（破線の枠と十字） */
export function drawPlusBead(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, lit: boolean): void {
  const c = lit ? MENU_INK.focus : color;
  dashBox(ctx, x, y, 12, 12, c);
  px(ctx, x + 5, y + 3, 2, 6, c);
  px(ctx, x + 3, y + 5, 6, 2, c);
}

// -----------------------------------------------------------------------------
// 紋の写し（装束の右）と畳んだ帯（系統の頁の上・祝福の 3 択）
// -----------------------------------------------------------------------------

/** 写しの寸法（rect の左上からのずれ。見本 E.html の miniCrest: 帯 318〜422・丸印 370・源 306 から左・糧 426 から右） */
const MINI = {
  bandX0: 56,
  bandX1: 160,
  discX: 108,
  srcX: 44,
  sinkX: 164,
  ampX: 122,
  beadGap: 10,
  steppedDisc: 16,
  underDisc: 12,
  stepDotsX: 100,
  stepDotsDy: 22,
  ampDy: -13,
  markW: 10,
} as const;

const MINI_BEADS = 4;
const MINI_AMPS = 2;

export interface MiniCrestOptions {
  /** 焦点の物の珠の key（白く光らせ、他の珠を墨に沈める）。null なら全部ふつう */
  litKey: string | null;
  /** 外すと細る帯（▼ / 消 で点滅） */
  changes: readonly BandDelta[];
  time: number;
}

function toneOf(bead: Readonly<CrestBead>, litKey: string | null): BeadTone {
  if (litKey === null) return "n";
  return bead.key === litKey ? "lit" : "ink";
}

/** 片側の珠の列（上限を超えたら最後を畳んだ珠に。焦点の物が畳まれていればその珠を出す） */
function drawMiniSide(ctx: CanvasRenderingContext2D, list: readonly CrestBead[], overflow: number, x0: number, dir: 1 | -1, y: number, litKey: string | null): void {
  list.slice(0, MINI_BEADS).forEach((b, i) => drawBead(ctx, b, x0 + dir * i * MINI.beadGap, y, 8, toneOf(b, litKey)));
  if (overflow <= 0) return;
  const i = Math.min(list.length, MINI_BEADS - 1);
  drawOverflowBead(ctx, x0 + dir * i * MINI.beadGap, y, overflow, litKey === null ? "n" : "ink", 8);
}

/** 紋の写し（名前を出さない）。帯の当たりは ui/crestShape.ts の miniCrestRows と同じ */
export function drawMiniCrest(ctx: CanvasRenderingContext2D, shape: Readonly<CrestShape>, rect: { x: number; y: number; w: number; h: number }, opts: Readonly<MiniCrestOptions>): void {
  px(ctx, rect.x - 6, rect.y, 1, rect.h + 2, MENU_INK.rule);
  const on = blinkOn(opts.time);
  for (const mini of miniCrestRows(shape, rect)) {
    const { row, cy } = mini;
    const color = KEYWORD_DEFS[row.keyword].color;
    const change = opts.changes.find((d) => d.keyword === row.keyword);
    const thinning = change !== undefined && (change.change === "crack" || change.change === "gone");
    const stepNow = thinning && !on ? change.to : row.step;
    const touches = opts.litKey !== null && [...row.produces, ...row.consumes, ...row.amplifies].some((b) => b.key === opts.litKey);
    const dimmed = opts.litKey !== null && !touches;
    drawMiniSide(ctx, row.produces, row.overflow.produces, rect.x + MINI.srcX, -1, cy - 4, opts.litKey);
    drawMiniSide(ctx, row.consumes, row.overflow.consumes, rect.x + MINI.sinkX, 1, cy - 4, opts.litKey);
    if (row.undercurrent) {
      drawBand(ctx, rect.x + MINI.bandX0, rect.x + MINI.bandX1, cy, 0, color, opts.time);
      drawGlyphDisc(ctx, row.keyword, rect.x + MINI.discX, cy, MINI.underDisc, color, { under: true });
    } else {
      const c = dimmed ? mixHex(color, BLACK, 0.6) : color;
      drawBand(ctx, rect.x + MINI.bandX0, rect.x + MINI.bandX1, cy, stepNow, c, opts.time);
      drawGlyphDisc(ctx, row.keyword, rect.x + MINI.discX, cy, MINI.steppedDisc, dimmed ? mixHex(color, BLACK, 0.45) : color);
      drawStepDots(ctx, rect.x + MINI.stepDotsX, mini.rect.y + MINI.stepDotsDy, stepNow, dimmed ? MENU_INK.dim : color);
      row.amplifies.slice(0, MINI_AMPS).forEach((b, i) => drawBead(ctx, b, rect.x + MINI.ampX + i * MINI.beadGap, cy + MINI.ampDy, 8, toneOf(b, opts.litKey)));
    }
    if (thinning) menuText(ctx, change.change === "gone" ? "消" : "▼", rect.x, cy, { size: "SMALL", color: MENU_INK.down, role: "ornament", baseline: "middle" });
  }
}

/** 畳んだ帯の 1 本の幅（丸印 12px + 段の点） */
export const FOLDED_BAND_W = 44;
const FOLDED_DISC = 12;

export interface FoldedBandsOptions {
  /** 開いている系統（下に白い線） */
  current?: Keyword | null;
  /** 太る系統（▲。祝福の 3 択の写し） */
  rising?: readonly Keyword[];
  /** 薄く敷く（3 択の札の後ろ） */
  faint?: boolean;
}

/** 畳んだ帯を横に並べる（x, y は左上。1 本 FOLDED_BAND_W） */
export function drawFoldedBands(ctx: CanvasRenderingContext2D, shape: Readonly<CrestShape>, x: number, y: number, opts: Readonly<FoldedBandsOptions> = {}): void {
  shape.rows.forEach((row, i) => {
    const bx = x + i * FOLDED_BAND_W;
    const base = KEYWORD_DEFS[row.keyword].color;
    const color = opts.faint === true ? mixHex(base, MENU_INK.paper, 0.5) : base;
    drawGlyphDisc(ctx, row.keyword, bx + FOLDED_DISC / 2 + 1, y + FOLDED_DISC / 2 + 2, FOLDED_DISC, color, { under: row.undercurrent });
    if (row.undercurrent) line(ctx, bx + 17, y + 8, bx + 28, y + 8, MENU_INK.dim, true);
    else drawStepDots(ctx, bx + 17, y + 7, row.step, color, 2, 2);
    if (opts.current === row.keyword) px(ctx, bx, y + FOLDED_DISC + 5, FOLDED_DISC + 2, 1, MENU_INK.focus);
    if (opts.rising?.includes(row.keyword) === true) menuText(ctx, "▲", bx + 30, y + 2, { size: "SMALL", color: MENU_INK.up, role: "ornament" });
  });
}

// -----------------------------------------------------------------------------
// 焦点と長押し（どの頁も使う）
// -----------------------------------------------------------------------------

/** 焦点の角括弧（当たりの矩形の外側） */
export function drawFocusBrackets(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }): void {
  brackets(ctx, rect.x, rect.y, rect.w, rect.h, MENU_INK.focus);
}

/** 長押しの進み（矩形の縁を左上から時計回りに塗る。ratio 0..1） */
export function drawHoldRing(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, ratio: number): void {
  const x = rect.x - 2;
  const y = rect.y - 2;
  const w = rect.w + 4;
  const h = rect.h + 4;
  const total = (w + h) * 2;
  let left = Math.round(total * Math.max(0, Math.min(1, ratio)));
  const color = MENU_INK.shu;
  const run = (n: number, draw: (len: number) => void): void => {
    const len = Math.min(n, left);
    if (len > 0) draw(len);
    left -= len;
  };
  run(w, (len) => px(ctx, x, y, len, 1, color));
  run(h, (len) => px(ctx, x + w - 1, y, 1, len, color));
  run(w, (len) => px(ctx, x + w - len, y + h - 1, len, 1, color));
  run(h, (len) => px(ctx, x, y + h - len, 1, len, color));
}
