import type { Vec } from "../core/vec";
import type { FormationLayout } from "../data/formations";

/**
 * 陣形の並び（docs/ideas/jin-impl.md 2-6）。正面を +x、原点を陣の中心とした相対座標を返す純関数（乱数なし）。
 * 返す順 = 置く順（正面から）。system/jinSpawn.ts が陣の向き（facing）で回して中心に足す。
 * 形の外接矩形の中心を原点に寄せる（どの形でも中心 = 塊の中心に陣が収まるように）
 */

const DEG = Math.PI / 180;
/** 雁行・鶴翼の斜めの踏み出し（間隔に対する前後方向の比） */
const SLANT = 0.7;
/** 偃月の弧の開き（正面の反対側を中心に ±この角度） */
const ARC_HALF_DEG = 70;
/** 偃月の弧の半径（間隔の倍率） */
const ARC_RADIUS_MUL = 1.5;
/** 方円の輪の半径（間隔の倍率）。人数が多ければ周の長さから広げる */
const RING_RADIUS_MUL = 1.2;

export function layoutOffsets(layout: FormationLayout, count: number, spacing: number): Vec[] {
  if (count <= 0) return [];
  return centered(rawOffsets(layout, count, spacing));
}

function rawOffsets(layout: FormationLayout, n: number, s: number): Vec[] {
  switch (layout) {
    case "wedge":
      return wedge(n, s);
    case "vee":
      return vee(n, s);
    case "arc":
      return arc(n, s);
    case "line":
      return range(n).map((k) => ({ x: -k * s, y: 0 }));
    case "ring":
      return ring(n, s);
    case "diagonal":
      return range(n).map((k) => ({ x: -k * s * SLANT, y: k * s * SLANT }));
    case "column":
      return range(n).map((k) => ({ x: -k * s, y: 0 }));
    case "twoRows":
      return twoRows(n, s);
    case "single":
      return range(n).map(() => ({ x: 0, y: 0 }));
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** 魚鱗: 頂点が正面の三角。1, 2, 3… の列を後ろへ */
function wedge(n: number, s: number): Vec[] {
  const out: Vec[] = [];
  for (let row = 0; out.length < n; row++) {
    for (let j = 0; j <= row && out.length < n; j++) out.push({ x: -row * s, y: (j - row / 2) * s });
  }
  return out;
}

/**
 * 鶴翼: 奥（後ろ）の頂点から左右の翼が前へ開く V。翼の先（正面）から置き、最後が奥の頂点
 * （先に書いたスロットが翼、後に書いたスロットが奥に来る）
 */
function vee(n: number, s: number): Vec[] {
  const arm = Math.ceil((n - 1) / 2);
  const out: Vec[] = [];
  for (let k = arm; k >= 1 && out.length < n - 1; k--) {
    out.push({ x: k * s * SLANT, y: -k * s });
    if (out.length < n - 1) out.push({ x: k * s * SLANT, y: k * s });
  }
  out.push({ x: 0, y: 0 });
  return out;
}

/** 偃月: 先頭 1 + 後ろの弧 */
function arc(n: number, s: number): Vec[] {
  const out: Vec[] = [{ x: 0, y: 0 }];
  const rest = n - 1;
  const r = s * ARC_RADIUS_MUL;
  for (let i = 0; i < rest; i++) {
    const t = rest === 1 ? 0.5 : i / (rest - 1);
    const a = Math.PI + (-ARC_HALF_DEG + 2 * ARC_HALF_DEG * t) * DEG;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** 方円: 中心 1 + 周りの輪 */
function ring(n: number, s: number): Vec[] {
  const out: Vec[] = [{ x: 0, y: 0 }];
  const rest = n - 1;
  const r = Math.max(s * RING_RADIUS_MUL, (rest * s) / (2 * Math.PI));
  for (let i = 0; i < rest; i++) {
    const a = (i / rest) * 2 * Math.PI;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** 衡軛: 前列を先に埋め、残りを後列 */
function twoRows(n: number, s: number): Vec[] {
  const front = Math.ceil(n / 2);
  const back = n - front;
  const row = (count: number, x: number): Vec[] => range(count).map((j) => ({ x, y: (j - (count - 1) / 2) * s }));
  return [...row(front, 0), ...row(back, -s)];
}

/** 外接矩形の中心を原点へ */
function centered(points: Vec[]): Vec[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

/** 正面 +x の相対座標を facing（単位ベクトル）の向きへ回す */
export function rotateToFacing(offset: Vec, facing: Vec): Vec {
  return { x: offset.x * facing.x - offset.y * facing.y, y: offset.x * facing.y + offset.y * facing.x };
}
