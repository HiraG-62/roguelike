/**
 * タイトル画面の絵（案 A「門」。docs/ideas/title-ideas.md）: 朱の鳥居と奥へ下る石段、苔の岩肌、石灯籠、旅人の背中。
 * 背景（岩肌・苔・洞の口と石段・石畳・鳥居・石灯籠）は奥の灯の色ごとに 1 回だけ canvas に焼いて持つ。
 * 動き（奥の灯・灯籠の火・蛍・塵・外套の裾）は表示用の時間だけで描く。ばらつきは座標ハッシュで、
 * state.rng・Math.random は使わない。UI（メニュー・石碑・文字）は render/titleUi.ts。
 */
import { RENDER_SCALE, VIEW_H, VIEW_W } from "../core/view";
import {
  FLAME_PALETTE,
  FLAME_ROWS,
  TRAVELER_BACK,
  TRAVELER_LEGS_ROW,
  TRAVELER_PALETTE,
  TRAVELER_STEP_LEGS,
} from "../data/sprites/titleArt";
import { Pen, clamp, hh, mix } from "./titlePaint";

// ---- 色 ----
const INK = "#14121a";
const SHU = "#c83a2a";
const SHU_HI = "#e0583e";
const SHU_LO = "#8a2018";
const GOLD = "#c8a050";
const GOLD_LO = "#7a5a28";
const WHITE = "#ffffff";
const BLACK = "#000000";
const CAVE_BLACK = "#050407";
const ROCK_GAP = "#0c0b0f";
/** 前回の探索が無いときの奥の灯（橙の温かい色） */
export const TITLE_DEFAULT_TINT = "#ffcf8a";
const LANTERN_FLAME_TINT = "#ffb45a";
const LANTERN_CORE_HOT = "#fff0b0";
const LANTERN_CORE_BRIGHT = "#fff8e0";

// ---- 配置（論理座標。480x270） ----
const GATE_CX = VIEW_W / 2;
/** 洞の口（アーチ）の外接 */
const CAVE_X = 204;
const CAVE_Y = 92;
const CAVE_W = 72;
const CAVE_H = 114;
const CAVE_HALF = 36;
const CAVE_TOP = 92;
const CAVE_ARCH_FROM = 110;
const CAVE_ARCH_H = 18;
const CAVE_BOTTOM = 206;
/** 石段の最奥と最手前の y（段は奥ほど詰まる） */
const STAIR_FAR = 138;
const STAIR_NEAR = 206;
const STAIR_COUNT = 15;
const STAIR_DECAY = 0.8;
/** 奥の灯の中心 */
const LAMP_Y = 140;
const LAMP_BASE_R = 24;
const LAMP_BOOST_R = 26;
const FLOOR_Y = 206;
const LANTERN_L = 150;
const LANTERN_R = 330;
const LANTERN_FEET = 238;
const LANTERN_FIRE_Y = 216;

// ---- 旅人 ----
const TRAVELER_FEET = 244;
/** 歩ききったときに門へ寄る距離 */
const TRAVELER_WALK_DISTANCE = 32;
const TRAVELER_W = 16;
const TRAVELER_H = 24;
const STEP_RATE = 6;
const SWAY_RATE = 2.5;
const BOB_RATE = 2.2;
const BOB_THRESHOLD = 0.6;

const BG_CACHE = new Map<string, HTMLCanvasElement>();

function bakeBackground(tint: string): HTMLCanvasElement {
  const hit = BG_CACHE.get(tint);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = VIEW_W * RENDER_SCALE;
  canvas.height = VIEW_H * RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const pen = new Pen(ctx);
  pen.rect(0, 0, VIEW_W, VIEW_H, ROCK_GAP);
  paintRock(pen);
  paintMoss(pen);
  paintCave(pen, tint);
  paintFloor(pen);
  paintTorii(pen);
  paintStoneLantern(pen, LANTERN_L, LANTERN_FEET);
  paintStoneLantern(pen, LANTERN_R, LANTERN_FEET);
  BG_CACHE.set(tint, canvas);
  return canvas;
}

/** 岩肌の塊（丸みのある石。上ほど暗くして題字を読ませる） */
function paintRock(pen: Pen): void {
  const edgeHi = "#3e3a48";
  for (let gy = -1; gy < 15; gy++) {
    for (let gx = -1; gx < 19; gx++) {
      const x = gx * 28 + (gy % 2) * 14 + Math.floor((hh(gx, gy, 1) - 0.5) * 12);
      const y = gy * 19 + Math.floor((hh(gx, gy, 2) - 0.5) * 8);
      const w = 20 + Math.floor(hh(gx, gy, 3) * 16);
      const h = 13 + Math.floor(hh(gx, gy, 4) * 10);
      const dark = clamp(1 - y / 210, 0, 1) * 0.7;
      const base = mix(mix("#1a1820", "#23202a", hh(gx, gy, 5)), "#08070a", dark);
      pen.rect(x + 2, y, w - 4, h, base);
      pen.rect(x, y + 2, w, h - 4, base);
      pen.rect(x + 1, y + 1, w - 2, h - 2, base);
      pen.rect(x + 2, y, w - 4, 1, mix(base, edgeHi, 0.5));
      pen.rect(x, y + 2, 1, h - 4, mix(base, edgeHi, 0.3));
      pen.rect(x + 1, y + 1, 1, 1, mix(base, edgeHi, 0.4));
      pen.rect(x + 2, y + h - 1, w - 4, 1, mix(base, BLACK, 0.5));
      pen.rect(x + w - 1, y + 2, 1, h - 4, mix(base, BLACK, 0.4));
      if (hh(gx, gy, 6) >= 0.35) continue;
      const cx = x + 4 + Math.floor(hh(gx, gy, 7) * (w - 10));
      pen.rect(cx, y + 2, 1, 3, mix(base, BLACK, 0.5));
      pen.rect(cx + 1, y + 5, 1, 3, mix(base, BLACK, 0.5));
    }
  }
}

/** 苔（下の岩と門の周り） */
function paintMoss(pen: Pen): void {
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(hh(i, 1, 11) * VIEW_W);
    const y = 120 + Math.floor(hh(i, 2, 11) * 100);
    if (Math.abs(x - GATE_CX) < 52 && y < 206) continue;
    const color = hh(i, 3, 11) < 0.5 ? "#2f4a2a" : "#46663a";
    pen.rect(x, y, 2 + Math.floor(hh(i, 4, 11) * 4), 1, color);
    if (hh(i, 5, 11) < 0.3) pen.rect(x + 1, y + 1, 1, 2 + Math.floor(hh(i, 6, 11) * 4), "#2f4a2a");
  }
}

/** 洞の口（アーチ）・奥へ下る石段・縁から垂れる苔 */
function paintCave(pen: Pen, tint: string): void {
  for (let y = CAVE_TOP; y <= CAVE_BOTTOM; y++) {
    const hw = y < CAVE_ARCH_FROM ? Math.round(CAVE_HALF * Math.sqrt(Math.max(0, 1 - ((CAVE_ARCH_FROM - y) / CAVE_ARCH_H) ** 2))) : CAVE_HALF;
    pen.rect(GATE_CX - hw - 2, y, hw * 2 + 4, 1, "#2a2630");
    pen.rect(GATE_CX - hw, y, hw * 2, 1, CAVE_BLACK);
  }
  const span = STAIR_NEAR - STAIR_FAR;
  let prevY = STAIR_NEAR;
  for (let k = 1; k < STAIR_COUNT + 1; k++) {
    const yk = Math.round(STAIR_FAR + span * Math.pow(STAIR_DECAY, k));
    const wk = Math.round(10 + (62 * (prevY - STAIR_FAR)) / span);
    const near = 1 - (prevY - STAIR_FAR) / span;
    const color = mix("#16141c", tint, 0.08 + near * 0.45);
    pen.rect(GATE_CX - wk / 2, yk, wk, prevY - yk, color);
    pen.rect(GATE_CX - wk / 2, yk, wk, 1, mix(color, WHITE, 0.12));
    pen.rect(GATE_CX - wk / 2, prevY - 1, wk, 1, mix(color, BLACK, 0.4));
    prevY = yk;
    if (prevY <= STAIR_FAR + 1) break;
  }
  for (let i = 0; i < 14; i++) {
    const x = CAVE_X + Math.floor(hh(i, 9, 3) * CAVE_W);
    const len = 2 + Math.floor(hh(i, 9, 4) * 8);
    pen.rect(x, 94 + Math.abs(x - GATE_CX) / 6, 1, len, hh(i, 9, 5) < 0.5 ? "#46663a" : "#2f4a2a");
  }
}

/** 床: 門へ続く石畳 */
function paintFloor(pen: Pen): void {
  pen.rect(0, FLOOR_Y, VIEW_W, VIEW_H - FLOOR_Y, "#100e14");
  for (let y = FLOOR_Y; y < VIEW_H; y++) {
    const half = 38 + (y - FLOOR_Y) * 1.5;
    pen.rect(GATE_CX - half, y, half * 2, 1, "#1e1c25");
  }
  const seams = [209, 213, 218, 224, 231, 239, 248, 258];
  seams.forEach((sy, si) => {
    const half = 38 + (sy - FLOOR_Y) * 1.5;
    pen.rect(GATE_CX - half, sy, half * 2, 1, "#141218");
    const n = 3 + si;
    for (let v = 1; v < n; v++) {
      const x = GATE_CX - half + (half * 2 * (v + (si % 2) * 0.5)) / n;
      if (x < GATE_CX + half) pen.rect(x, sy + 1, 1, (seams[si + 1] ?? VIEW_H) - sy - 1, "#141218");
    }
  });
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hh(i, 3, 21) * VIEW_W);
    const y = 210 + Math.floor(hh(i, 4, 21) * 58);
    if (Math.abs(x - GATE_CX) > 60 + (y - FLOOR_Y) * 1.5) pen.rect(x, y, 2, 1, hh(i, 5, 21) < 0.5 ? "#2a3a26" : "#24212a");
  }
}

/** 鳥居（朱の漆） */
function paintTorii(pen: Pen): void {
  const base = "#1a1a24";
  for (const px of [190, 282]) {
    pen.rect(px - 1, 88, 10, 118, INK);
    pen.rect(px, 88, 8, 118, SHU);
    pen.rect(px, 88, 2, 118, SHU_HI);
    pen.rect(px + 6, 88, 2, 118, SHU_LO);
    pen.rect(px - 1, 196, 10, 12, base);
    pen.rect(px - 1, 196, 10, 1, "#3a3640");
  }
  pen.rect(178, 99, 124, 6, INK);
  pen.rect(179, 100, 122, 4, SHU);
  pen.rect(179, 100, 122, 1, SHU_HI);
  pen.rect(179, 103, 122, 1, SHU_LO);
  pen.rect(166, 76, 148, 3, base);
  pen.rect(162, 74, 8, 3, base);
  pen.rect(310, 74, 8, 3, base);
  pen.rect(160, 72, 4, 2, base);
  pen.rect(316, 72, 4, 2, base);
  pen.rect(168, 79, 144, 7, INK);
  pen.rect(169, 79, 142, 6, SHU);
  pen.rect(169, 79, 142, 1, SHU_HI);
  pen.rect(169, 84, 142, 1, SHU_LO);
  pen.rect(233, 85, 14, 15, INK);
  pen.rect(234, 86, 12, 13, GOLD_LO);
  pen.rect(235, 87, 10, 11, "#1a1414");
  pen.rect(238, 89, 4, 1, GOLD);
  pen.rect(239, 91, 2, 4, GOLD);
  pen.rect(237, 93, 6, 1, GOLD);
}

/** 石灯籠（足元 yb） */
function paintStoneLantern(pen: Pen, x: number, yb: number): void {
  const stone = "#3a3640";
  const hi = "#5a5660";
  const lo = "#24212a";
  pen.rect(x - 8, yb - 3, 16, 3, stone);
  pen.rect(x - 8, yb - 3, 16, 1, hi);
  pen.rect(x - 2, yb - 15, 4, 12, stone);
  pen.rect(x - 2, yb - 15, 1, 12, hi);
  pen.rect(x + 1, yb - 15, 1, 12, lo);
  pen.rect(x - 6, yb - 18, 12, 3, stone);
  pen.rect(x - 6, yb - 18, 12, 1, hi);
  pen.rect(x - 5, yb - 25, 10, 7, stone);
  pen.rect(x - 5, yb - 25, 1, 7, hi);
  pen.rect(x - 2, yb - 23, 4, 4, "#100e10");
  pen.rect(x - 9, yb - 28, 18, 3, stone);
  pen.rect(x - 9, yb - 28, 18, 1, hi);
  pen.rect(x - 6, yb - 30, 12, 2, stone);
  pen.rect(x - 1, yb - 33, 2, 3, hi);
}

// ---------------------------------------------------------------------------
// 動き（表示用の時間 time だけ）
// ---------------------------------------------------------------------------

/** 炎（3 コマ）。phase で灯ごとにずらす */
export function drawFlame(pen: Pen, time: number, cx: number, by: number, phase: number): void {
  const f = Math.floor(time * 8 + phase) % 3;
  const rows = f === 1 ? [...FLAME_ROWS.slice(1), "....."] : FLAME_ROWS;
  pen.sprite(rows, FLAME_PALETTE, cx - 2.5, by - 5 + (f === 2 ? -1 : 0), 1);
}

function drawLanternLight(pen: Pen, time: number, x: number, yb: number, phase: number): void {
  const fl = 0.85 + 0.15 * Math.sin(time * 9 + phase) * Math.sin(time * 3.1 + phase);
  pen.glow(x, yb - 21, Math.round(14 * fl), LANTERN_FLAME_TINT, 0.9);
  pen.rect(x - 2, yb - 23, 4, 4, fl > 0.9 ? LANTERN_CORE_HOT : LANTERN_FLAME_TINT);
  pen.rect(x - 1, yb - 22, 2, 2, LANTERN_CORE_BRIGHT);
}

/** 門の奥の灯。洞の口の中だけに収める（boost は開始の演出で強まる） */
function drawLamp(pen: Pen, time: number, tint: string, boost: number): void {
  const { ctx } = pen;
  ctx.save();
  ctx.beginPath();
  ctx.rect(CAVE_X, CAVE_Y, CAVE_W, CAVE_H);
  ctx.clip();
  const fl = 0.9 + 0.1 * Math.sin(time * 7) * Math.sin(time * 2.3);
  pen.glow(GATE_CX, LAMP_Y, Math.round((LAMP_BASE_R + boost * LAMP_BOOST_R) * fl), tint, 1 + boost * 0.4);
  pen.rect(GATE_CX - 1, 136, 2, 3, mix(tint, WHITE, 0.6));
  drawFlame(pen, time, GATE_CX, 138, 0);
  ctx.restore();
}

/** 苔の上を漂う蛍と、降る塵 */
function drawDrift(pen: Pen, time: number): void {
  for (let i = 0; i < 16; i++) {
    const bx = hh(i, 1, 40) * VIEW_W;
    const by = 130 + hh(i, 2, 40) * 90;
    if (Math.abs(bx - GATE_CX) < 48) continue;
    const x = bx + Math.sin(time * 0.5 + i) * 10;
    const y = by + Math.cos(time * 0.4 + i * 1.7) * 6;
    const a = 0.5 + 0.5 * Math.sin(time * 2 + i * 2.1);
    pen.alpha(a * 0.3);
    pen.rect(x - 1, y - 1, 3, 3, "#c8e878");
    pen.alpha(a);
    pen.rect(x, y, 1, 1, "#e8ffb0");
  }
  pen.alpha(0.25);
  for (let i = 0; i < 26; i++) {
    const x = (((hh(i, 3, 41) * VIEW_W + Math.sin(time * 0.3 + i) * 8) % VIEW_W) + VIEW_W) % VIEW_W;
    const y = (hh(i, 4, 41) * VIEW_H + time * (3 + (i % 4))) % VIEW_H;
    pen.rect(x, y, 1, 1, "#9a948a");
  }
  pen.alpha(1);
}

/** 旅人の背中。足元 (cx, feet)。歩き中は足を 2 枚で交互に出す */
function drawTraveler(pen: Pen, time: number, cx: number, feet: number, stepping: boolean): void {
  const phase = Math.floor(time * STEP_RATE) % 2;
  const rows = TRAVELER_BACK.slice();
  if (stepping) {
    const legs = TRAVELER_STEP_LEGS[phase];
    legs?.forEach((row, i) => {
      rows[TRAVELER_LEGS_ROW + i] = row;
    });
  }
  const bob = stepping ? phase : Math.sin(time * BOB_RATE) > BOB_THRESHOLD ? 1 : 0;
  const x = cx - TRAVELER_W / 2;
  const y = feet - TRAVELER_H + bob;
  pen.alpha(0.35);
  pen.rectRaw(cx - 6, feet - 1, 12, 2, BLACK);
  pen.alpha(1);
  pen.sprite(rows, TRAVELER_PALETTE, x, y, 1);
  // 外套の裾と襟巻きが風で揺れる（2 枚を交互に）
  const f = Math.floor(time * SWAY_RATE) % 2;
  pen.rectRaw(x + f, y + 9 + f, 1, 1, TRAVELER_PALETTE.r ?? SHU);
  pen.rectRaw(x + (f ? 0 : 1), y + 10 + f, 1, 1, TRAVELER_PALETTE.R ?? SHU_LO);
}

export interface TitleSceneView {
  /** 表示用の時間（秒） */
  time: number;
  /** 奥の灯の色（前回力尽きた章の色） */
  tint: string;
  /** 旅人の歩み（0..1） */
  walk: number;
  stepping: boolean;
  /** 奥の灯の強まり（0..1） */
  boost: number;
}

/** 背景と動きを描く（UI は含まない）。ctx は論理座標の transform 済み */
export function drawTitleScene(ctx: CanvasRenderingContext2D, view: TitleSceneView): void {
  const pen = new Pen(ctx);
  ctx.drawImage(bakeBackground(view.tint), 0, 0, VIEW_W, VIEW_H);
  drawLamp(pen, view.time, view.tint, view.boost);
  drawLanternLight(pen, view.time, LANTERN_L, LANTERN_FEET, 0);
  drawLanternLight(pen, view.time, LANTERN_R, LANTERN_FEET, 2);
  drawFlame(pen, view.time, LANTERN_L, LANTERN_FIRE_Y, 1);
  drawFlame(pen, view.time, LANTERN_R, LANTERN_FIRE_Y, 2);
  drawDrift(pen, view.time);
  // 歩みの途中でも論理 1px に揃えて置く（滲み防止）
  drawTraveler(pen, view.time, GATE_CX, Math.round(TRAVELER_FEET - view.walk * TRAVELER_WALK_DISTANCE), view.stepping);
}
