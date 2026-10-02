// 地図の焼き付け用の雑音・座標ハッシュ（docs/ideas/previews/map-preview.html の h32 / hf / vnoise / vor / pack）。
// すべて決定的で、割り当てを起こさない。Math.random・state.rng は使わない（不変条件 2・3）。

const U32 = 4294967296;

/** 色を ImageData 用の 32bit に詰める（ABGR のリトルエンディアン = メモリ上は R, G, B, A） */
export function pack(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 座標と種から 32bit の符号なし整数を作る */
export function h32(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** h32 を 0 以上 1 未満の実数にしたもの */
export function hf(x: number, y: number, s: number): number {
  return h32(x, y, s) / U32;
}

/** 周期 p の値雑音（0..1）。格子の値を滑らかに補間する */
export function vnoise(x: number, y: number, p: number, s: number): number {
  const fx = x / p;
  const fy = y / p;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hf(ix, iy, s);
  const b = hf(ix + 1, iy, s);
  const c = hf(ix, iy + 1, s);
  const d = hf(ix + 1, iy + 1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** vor の出力。呼び出し側が 1 つ持って使い回す（毎ドットの割り当てを避ける） */
export interface VorOut {
  /** 最も近い特徴点までの距離 */
  d1: number;
  /** 2 番目に近い特徴点までの距離 */
  d2: number;
  /** 最も近い特徴点のセルのハッシュ（模様の変種に使う） */
  id: number;
  /** 最も近い特徴点の座標 */
  cx: number;
  cy: number;
}

export function createVorOut(): VorOut {
  return { d1: 0, d2: 0, id: 0, cx: 0, cy: 0 };
}

/** ボロノイ（セル幅 cell）。結果は out を書き換えて返す */
export function vor(x: number, y: number, cell: number, s: number, out: VorOut): VorOut {
  const gx0 = Math.floor(x / cell);
  const gy0 = Math.floor(y / cell);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  let px = 0;
  let py = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = gx0 + i;
      const gy = gy0 + j;
      const hh = h32(gx, gy, s);
      const fx = (gx + 0.12 + ((hh & 1023) / 1024) * 0.76) * cell;
      const fy = (gy + 0.12 + (((hh >>> 10) & 1023) / 1024) * 0.76) * cell;
      const dx = x - fx;
      const dy = y - fy;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hh;
        px = fx;
        py = fy;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  out.d1 = Math.sqrt(d1);
  out.d2 = Math.sqrt(d2);
  out.id = id;
  out.cx = px;
  out.cy = py;
  return out;
}

/** 文字列（テーマの key など）を種にする 32bit ハッシュ（FNV-1a） */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
