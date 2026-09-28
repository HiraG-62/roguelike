/**
 * 鞭の縄（高精細のプレイヤーの組み立て。docs/ideas/player-sprites.md 5 章）。振り抜いた鞭のしなる線はエフェクトが描き、
 * その線が薄れた後の戻しで、伸びた縄が垂れながら手元へ巻き戻る姿をここで作る。座標は組み立ての空間（絵のドット、右向き）
 */
import type { Pt } from "./playerRig";

/** 戻しのうち縄を描き始める進み（エフェクトの線が薄れ始める頃）と、手元へ巻き戻り切る進み */
const ROPE_FROM = 0.1;
const ROPE_UNTIL = 0.72;
/** 縄の点の数・垂れの最大（ドット）・残るうねりの振れ幅（ドット）と周期 */
const ROPE_POINTS = 28;
const ROPE_SAG = 16;
const ROPE_WAVE = 2.5;
const ROPE_WAVES = 1.5;
/** 縄の太さ（半径、ドット）: 手元 → 先 */
const ROPE_R0 = 1.1;
const ROPE_R1 = 0.6;

export interface RopeInput {
  /** 縄の出る所（鞭の柄の先。組み立ての空間） */
  readonly from: Pt;
  /** 縄の出る向き（rad。柄の向き） */
  readonly angle: number;
  /** 伸び切った縄の長さ（ドット） */
  readonly length: number;
  /** 戻しの進み（0 → 1） */
  readonly t: number;
}

function smooth(k: number): number {
  const u = Math.min(1, Math.max(0, k));
  return u * u * (3 - 2 * u);
}

/** 戻しの縄の巻き戻りの進み（0 = 伸び切り、1 = 手元へ戻り切り）。描かない間は null */
export function ropeProgress(t: number): number | null {
  if (t < ROPE_FROM || t >= ROPE_UNTIL) return null;
  return (t - ROPE_FROM) / (ROPE_UNTIL - ROPE_FROM);
}

/**
 * 戻しの縄の折れ線。伸び切った真っ直ぐな線（エフェクトの線の続き）から、先が重く垂れつつ手元へ縮む。
 * 残ったうねりは縮むほど消える。描かない間は空
 */
export function ropePoints(i: RopeInput): Pt[] {
  const k = ropeProgress(i.t);
  if (k === null) return [];
  const len = i.length * (1 - smooth(k));
  if (len < 1) return [];
  const ux = Math.cos(i.angle);
  const uy = Math.sin(i.angle);
  const sag = ROPE_SAG * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (len / Math.max(1, i.length));
  const out: Pt[] = [];
  for (let n = 0; n <= ROPE_POINTS; n++) {
    const s = n / ROPE_POINTS;
    const wave = ROPE_WAVE * (1 - k) * Math.sin(Math.PI * 2 * (s * ROPE_WAVES + k * 2)) * s;
    out.push({
      x: i.from.x + ux * len * s - uy * wave,
      y: i.from.y + uy * len * s + ux * wave + sag * s * s,
    });
  }
  return out;
}

/** 縄の画素の色の番号: 0 = 輪郭、1〜3 = 革（暗・基・明） */
export type RopeInk = 0 | 1 | 2 | 3;
export interface RopePixel {
  readonly x: number;
  readonly y: number;
  readonly ink: RopeInk;
}

/** 折れ線を太さのある縄の画素にする（整数の格子。外周の 1 ドットは輪郭、上の縁を明るく） */
export function ropePixels(points: readonly Pt[]): RopePixel[] {
  if (points.length < 2) return [];
  const cells = new Map<string, RopePixel>();
  const put = (x: number, y: number, ink: RopeInk): void => {
    const key = `${x},${y}`;
    const had = cells.get(key);
    // 塗りは輪郭を上書きし、輪郭は塗りを上書きしない。塗りどうしは先に塗った方（手元側）を残す
    if (had && (ink === 0 || had.ink !== 0)) return;
    cells.set(key, { x, y, ink });
  };
  const last = points.length - 1;
  for (let n = 0; n < last; n++) {
    const a = points[n];
    const b = points[n + 1];
    if (!a || !b) continue;
    const r = ROPE_R0 + (ROPE_R1 - ROPE_R0) * (n / last);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let q = 0; q <= steps; q++) {
      const cx = a.x + ((b.x - a.x) * q) / steps;
      const cy = a.y + ((b.y - a.y) * q) / steps;
      const reach = Math.ceil(r + 1);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = Math.floor(cx) + dx;
          const y = Math.floor(cy) + dy;
          const ex = x + 0.5 - cx;
          const ey = y + 0.5 - cy;
          const d = Math.hypot(ex, ey);
          if (d <= r) put(x, y, ey < -r * 0.35 ? 3 : ey > r * 0.35 ? 1 : 2);
          else if (d <= r + 1) put(x, y, 0);
        }
      }
    }
  }
  return [...cells.values()];
}
