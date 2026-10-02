// 封鎖の扉（docs/ideas/map-visual-impl.md 1-7 節・4 章 L7）: 暗い床 + 格子の帯 + 外周だけ赤く脈打つ線（赤 = 閉じている）。
// 格子は章の差し色。ただし差し色が赤に近い章（寺院の朱・最深の間の朱・深みの色相の回転）では外周の赤と見分けが付かないので、
// 格子を章の光の色か石の明るい色へ替える。外周は格子との間に暗い 1px を挟み、脈は透けるだけでなく白へ寄せて明るさでも打つ。
// 色の決め方は純関数（テストで章ごとに格子と外周の差を測る）。描画は state を読むだけ。
import type { GameState } from "../core/state";
import { TILE_SIZE, toIndex } from "../map/grid";
import { colorB, colorG, colorR, darken, hexColor, mixColor } from "./mapTheme";
import type { MapPalette } from "./mapTypes";
import { pulse } from "./renderMath";

/** 外周の赤（脈の谷） */
export const DOOR_EDGE_RED = hexColor("#ff3030");
/** 外周の脈の山で寄せる先（白っぽい赤。明るさでも打つ） */
export const DOOR_EDGE_HOT = hexColor("#ffc8b8");
/** 脈の山で DOOR_EDGE_HOT へ寄せる割合 */
export const DOOR_EDGE_HOT_MAX = 0.5;
/** 外周の脈の速さと透け（谷でも十分に濃い） */
export const DOOR_EDGE_SPEED = 8;
export const DOOR_EDGE_MIN = 0.8;
export const DOOR_EDGE_MAX = 1;
/** 床を暗くする量と格子の濃さ */
export const DOOR_SHADE_ALPHA = 0.45;
export const DOOR_BAR_ALPHA = 0.8;
/** 外周と格子の間の暗い線の濃さ */
export const DOOR_GAP_ALPHA = 0.75;
const DOOR_GAP_COLOR = "#1a1a24";
const DOOR_SHADE_COLOR = "#000000";
const DOOR_BAR_W = 2;
const DOOR_BAR_OFFSETS = [2, 7, 12] as const;
const DOOR_EDGE_W = 1;
/** 格子の候補が外周の赤から離れているとみなす差（合成後の色の redmean 距離） */
export const DOOR_CONTRAST_MIN = 150;
/** 候補がどれも足りないとき、石の明るい色をさらに白へ寄せる量 */
const FALLBACK_LIGHTEN = 0.5;

const BYTE_MAX = 255;
const REDMEAN_BASE = 2;
const REDMEAN_GREEN = 4;
const REDMEAN_DIV = 256;

/** 2 色の redmean 距離（人の目の差に近い簡易の距離。0..約 765） */
export function colorDistance(a: number, b: number): number {
  const rm = (colorR(a) + colorR(b)) / 2;
  const dr = colorR(a) - colorR(b);
  const dg = colorG(a) - colorG(b);
  const db = colorB(a) - colorB(b);
  return Math.sqrt((REDMEAN_BASE + rm / REDMEAN_DIV) * dr * dr + REDMEAN_GREEN * dg * dg + (REDMEAN_BASE + (BYTE_MAX - rm) / REDMEAN_DIV) * db * db);
}

/** 封鎖の扉のマスの床（床の基本色を暗くした色）。格子と外周はこの上に重なる */
export function doorBaseColor(P: MapPalette): number {
  return darken(P.fB, DOOR_SHADE_ALPHA);
}

/** 格子の見える色（暗くした床に DOOR_BAR_ALPHA で重ねた色） */
export function doorBarSeen(P: MapPalette, bar: number): number {
  return mixColor(doorBaseColor(P), bar, DOOR_BAR_ALPHA);
}

/** 外周の見える色（脈の谷 = 一番目立たない時） */
export function doorEdgeSeenDim(P: MapPalette): number {
  return mixColor(doorBaseColor(P), DOOR_EDGE_RED, DOOR_EDGE_MIN);
}

/**
 * 格子の色。章の差し色 → 光の縁の色（灯を沈めた色。寺院では木の格子の茶）→ 光の色 → 石の明るい色の順に、
 * 外周の赤と十分に違う最初の色。差し色の代わりは外周より目立たない暗めの色から選ぶ
 */
export function lockedDoorBar(P: MapPalette): number {
  const edge = doorEdgeSeenDim(P);
  for (const c of [P.accent, P.lightDim, P.light, P.stoneL]) {
    if (colorDistance(doorBarSeen(P, c), edge) >= DOOR_CONTRAST_MIN) return c;
  }
  return mixColor(P.stoneL, hexColor("#ffffff"), FALLBACK_LIGHTEN);
}

function cssColor(c: number): string {
  return `rgb(${colorR(c)},${colorG(c)},${colorB(c)})`;
}

/** 格子の CSS 色（テーマが変わったときだけ呼ぶ想定） */
export function lockedDoorBarCss(P: MapPalette): string {
  return cssColor(lockedDoorBar(P));
}

export interface DoorEdgeLook {
  color: string;
  alpha: number;
}

/** 今の時刻の外周の色と透け。脈は透けと白への寄せを同じ位相で打つ */
export function lockedDoorEdge(time: number, out: DoorEdgeLook): DoorEdgeLook {
  const t = pulse(time, DOOR_EDGE_SPEED, 0, 1);
  out.alpha = DOOR_EDGE_MIN + (DOOR_EDGE_MAX - DOOR_EDGE_MIN) * t;
  out.color = cssColor(mixColor(DOOR_EDGE_RED, DOOR_EDGE_HOT, DOOR_EDGE_HOT_MAX * t));
  return out;
}

/**
 * 封鎖の扉の 1 マス。外周は隣の封鎖マスに接する辺を引かない（幅の広い扉が 1 枚の枠に読める）。
 * 外周の内側の 1px は暗い線にして、格子の帯と外周の赤を離す
 */
export function drawLockedDoor(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, bar: string, edge: DoorEdgeLook): void {
  const { map } = state;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  ctx.globalAlpha = DOOR_SHADE_ALPHA;
  ctx.fillStyle = DOOR_SHADE_COLOR;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.globalAlpha = DOOR_BAR_ALPHA;
  ctx.fillStyle = bar;
  for (const o of DOOR_BAR_OFFSETS) {
    ctx.fillRect(px + o, py, DOOR_BAR_W, TILE_SIZE);
    ctx.fillRect(px, py + o, TILE_SIZE, DOOR_BAR_W);
  }
  const locked = (dx: number, dy: number): boolean => state.lockedTiles.has(toIndex(map, x + dx, y + dy));
  const n = !locked(0, -1);
  const s = !locked(0, 1);
  const w = !locked(-1, 0);
  const e = !locked(1, 0);
  const W = DOOR_EDGE_W;
  const T = TILE_SIZE;
  ctx.globalAlpha = DOOR_GAP_ALPHA;
  ctx.fillStyle = DOOR_GAP_COLOR;
  if (n) ctx.fillRect(px, py + W, T, W);
  if (s) ctx.fillRect(px, py + T - 2 * W, T, W);
  if (w) ctx.fillRect(px + W, py, W, T);
  if (e) ctx.fillRect(px + T - 2 * W, py, W, T);
  ctx.globalAlpha = edge.alpha;
  ctx.fillStyle = edge.color;
  if (n) ctx.fillRect(px, py, T, W);
  if (s) ctx.fillRect(px, py + T - W, T, W);
  if (w) ctx.fillRect(px, py, W, T);
  if (e) ctx.fillRect(px + T - W, py, W, T);
  ctx.globalAlpha = 1;
}
