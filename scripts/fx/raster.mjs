// 1 フレームの絵（段の番号の格子）を作る道具。docs/ideas/fx-sprites.md 3 章
//
// 絵は「段」（1〜7。暗 → 明、0 は透明）の格子で持つ。形は「正準座標」で書く:
//   原点 = 原点（pivot）、+x = 攻撃の向き、+y = 時計回りの側（画面の下）、単位は絵のドット（論理 0.5px）
// paint が方向ごとに回して塗るので、形の関数は向きを気にしなくてよい

export const LEVEL_MAX = 7;
/** 明るさ v（0..1）→ 段 の境目。v がこれ以上で 1 段ずつ上がる（1 始まり） */
const LEVEL_EDGES = [0.1, 0.2, 0.32, 0.46, 0.62, 0.8];
/** 4x4 の順序ディザ（0..15） */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 整数座標のハッシュ → [0, 1)（決定的。Math.random は使わない） */
export function hash2(ix, iy, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 1 次元のハッシュ */
export function hash1(i, seed = 0) {
  return hash2(i, 0x51ed, seed);
}

/** 格子の値を滑らかに補間したノイズ → [0, 1) */
export function valueNoise(x, y, cell, seed = 0) {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** 明るさ → 段（1..7） */
export function levelOf(v) {
  let level = 1;
  for (const edge of LEVEL_EDGES) if (v >= edge) level++;
  return level;
}

/** 角を (-π, π] に */
export function wrapAngle(a) {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** 点 (px, py) から線分 (ax, ay)-(bx, by) までの距離と、線分上の位置 t（0..1） */
export function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len2) : 0;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return { d: Math.hypot(ex, ey), t };
}

/**
 * 1 フレームの作業面。w x h の格子、原点は (cx, cy)。angle は方向（ラジアン）。
 * 正準座標 ↔ 格子座標の変換を持つ
 */
export class Frame {
  constructor(w, h, angle) {
    this.w = w;
    this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;
    this.angle = angle;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.grid = new Uint8Array(w * h);
  }

  /** 正準座標 → 格子座標（実数） */
  toGrid(x, y) {
    return { x: this.cx + x * this.cos - y * this.sin, y: this.cy + x * this.sin + y * this.cos };
  }

  /** 格子座標（実数）→ 正準座標 */
  toCanon(gx, gy) {
    const dx = gx - this.cx;
    const dy = gy - this.cy;
    return { x: dx * this.cos + dy * this.sin, y: -dx * this.sin + dy * this.cos };
  }

  get(ix, iy) {
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.grid[iy * this.w + ix] ?? 0;
  }

  set(ix, iy, level) {
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.grid[iy * this.w + ix] = level;
  }

  /** 明るい方を残す（重ね塗りの既定） */
  raise(ix, iy, level) {
    if (level > this.get(ix, iy)) this.set(ix, iy, level);
  }
}

/**
 * 形の関数 fn(x, y) を正準座標で超標本化して塗る。fn は内側なら明るさ v（0..1）、外側なら負を返す。
 * 標本の半分以上が内側のドットだけを塗り（輪郭のジャギーを整える）、明るさは内側の標本の平均に順序ディザを足して段にする。
 * bounds（正準座標の {x0, y0, x1, y1}）を渡すと、その回した外接矩形の中だけを調べる
 */
export function paint(frame, fn, opts = {}) {
  const samples = opts.samples ?? 3;
  const dither = opts.dither ?? 0.04;
  const mode = opts.mode ?? "raise";
  const box = opts.bounds ? gridBox(frame, opts.bounds) : { x0: 0, y0: 0, x1: frame.w - 1, y1: frame.h - 1 };
  const inv = 1 / samples;
  const need = (samples * samples) / 2;
  for (let iy = box.y0; iy <= box.y1; iy++) {
    for (let ix = box.x0; ix <= box.x1; ix++) {
      let inside = 0;
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = frame.toCanon(ix + (sx + 0.5) * inv, iy + (sy + 0.5) * inv);
          const v = fn(c.x, c.y);
          if (v < 0) continue;
          inside++;
          sum += v;
        }
      }
      if (inside < need) continue;
      const b = (BAYER4[(iy & 3) * 4 + (ix & 3)] ?? 0) / 16 - 0.5;
      const level = levelOf(clamp01(sum / inside + b * dither * 2));
      if (mode === "set") frame.set(ix, iy, level);
      else if (mode === "erase") frame.set(ix, iy, 0);
      else frame.raise(ix, iy, level);
    }
  }
}

/** 正準座標の矩形を回した外接矩形（格子の整数範囲。作業面で切る） */
function gridBox(frame, b) {
  const pts = [frame.toGrid(b.x0, b.y0), frame.toGrid(b.x1, b.y0), frame.toGrid(b.x0, b.y1), frame.toGrid(b.x1, b.y1)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - 1),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - 1),
    x1: Math.min(frame.w - 1, Math.ceil(Math.max(...xs)) + 1),
    y1: Math.min(frame.h - 1, Math.ceil(Math.max(...ys)) + 1),
  };
}

/**
 * 画面に揃った形を格子に直接押す（光点の十字など。回すと崩れる小さな形はこちら）。
 * pattern は文字列の行（'.' は透明、'1'〜'7' は段）。(x, y) は正準座標の中心
 */
export function stamp(frame, x, y, pattern) {
  const g = frame.toGrid(x, y);
  const h = pattern.length;
  const w = pattern[0]?.length ?? 0;
  const ox = Math.round(g.x - w / 2);
  const oy = Math.round(g.y - h / 2);
  for (let r = 0; r < h; r++) {
    const row = pattern[r] ?? "";
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (!ch || ch === ".") continue;
      frame.raise(ox + c, oy + r, Number(ch));
    }
  }
}

/** 正準座標の 1 ドットを塗る */
export function dot(frame, x, y, level) {
  const g = frame.toGrid(x, y);
  frame.raise(Math.floor(g.x), Math.floor(g.y), level);
}

/** 画面に揃った光点（十字の閃き）。size 1〜4 */
export function glint(frame, x, y, size) {
  const patterns = {
    1: ["7"],
    2: [".6.", "676", ".6."],
    3: ["..5..", "..6..", "56765", "..6..", "..5.."],
    4: ["...4...", "...5...", "..565..", "4567654", "..565..", "...5...", "...4..."],
  };
  stamp(frame, x, y, patterns[size] ?? patterns[1]);
}

/**
 * 仕上げの掃除: 周りに誰もいない暗いドット（段 3 以下）を消し、上下左右がすべて同じ段なのに
 * 1 つだけ違うドット（ざらつき）を周りに揃える。明るい孤立点（火花・光点）は意図なので残す
 */
export function cleanup(frame) {
  const { w, h } = frame;
  const src = frame.grid.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (src[y * w + x] ?? 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      if (!v) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy)) neighbors++;
      if (neighbors === 0 && v <= 3) {
        frame.grid[y * w + x] = 0;
        continue;
      }
      const n = at(x, y - 1);
      if (n && n === at(x, y + 1) && n === at(x - 1, y) && n === at(x + 1, y) && Math.abs(n - v) === 1) frame.grid[y * w + x] = n;
    }
  }
}

/** 不透明なドットの外接矩形。空なら null */
export function trimBox(frame) {
  let x0 = frame.w;
  let y0 = frame.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      if (!frame.grid[y * frame.w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
