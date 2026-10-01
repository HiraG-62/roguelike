/**
 * 階の型（8 種）が共有する形づくりの道具。見本（docs/ideas/previews/map-preview.html の `<gen2>`）の
 * disc / line / wander / blob / poisson / relax / mstEdges / addLoops / chaikin / caStep / tidy / voronoiCarve / connectAll を、
 * 本体の格子（Cell: 床・壁・穴）と `Rng` で動くように直したもの。
 *
 * - 乱数は引数の rng だけ。雑音（h32 / vnoise）は生成器が最初に 1 回引く noiseSeed を受ける座標ハッシュ（乱数を消費しない）
 * - 生成の内側で Math.hypot は使わない（丸めの保証が無く、エンジン差で結果が割れるため）。距離は Math.sqrt(dx * dx + dy * dy)
 * - 塗りは「書いた Cell で上書き」。穴を消さずに壁だけ掘りたいときは opts.only = Cell.Wall
 * - 座標は見本と同じ「マスの左上が整数、中心が +0.5」の実数
 */
import type { Rng } from "../../core/rng";
import { type Grid, NEIGHBORS_4, NEIGHBORS_8 } from "../regions";
import { Cell } from "./types";

export type { Grid };

export interface Vec {
  x: number;
  y: number;
}

/** relax が動かさない点（fixed = true）を持てる点 */
export interface RelaxPoint extends Vec {
  fixed?: boolean;
}

/** Voronoi の部屋の種。r は部屋の半径（雑音で揺らす前） */
export interface VoronoiSite extends Vec {
  r: number;
}

/** 辺（pts の添字の組） */
export type Edge = [number, number];

export interface PaintOptions {
  /** 指定すると、今のセルがこの Cell のマスだけを書き換える（例: Cell.Wall だけ掘る = 穴を埋めない） */
  only?: Cell;
}

export interface BlobOptions extends PaintOptions {
  /** 楕円の伸び（向きの座標系での x / y）。省略は 1 */
  sx?: number;
  sy?: number;
  /** 楕円の向き（ラジアン） */
  ang?: number;
}

/** 見本の雑音の揺れの周期（blob の縁） */
const BLOB_NOISE_PERIOD = 3.2;
/** Voronoi の縁の揺れの周期 */
const VORONOI_NOISE_PERIOD = 4;
/** poisson の試行回数の上限（見本と同じ） */
const POISSON_TRIES = 2000;
/** relax の押し離しの強さ（不足分に掛ける） */
const RELAX_PUSH = 0.25;
/** connectAll が穴を掘る太さ（2x2） */
const CARVE_OFFSETS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;
/** chaikin の角の切り方（辺の何割の所に新しい点を置くか） */
const CHAIKIN_NEAR = 0.25;

export function makeGrid(w: number, h: number, v: Cell): Grid {
  return { w, h, cells: new Uint8Array(w * h).fill(v) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 外周（1 マス）でない内側のマスか */
export function isInner(g: Grid, x: number, y: number): boolean {
  return x >= 1 && y >= 1 && x < g.w - 1 && y < g.h - 1;
}

/** 外周をすべて壁にする */
export function sealBorder(g: Grid): void {
  for (let x = 0; x < g.w; x++) {
    g.cells[x] = Cell.Wall;
    g.cells[(g.h - 1) * g.w + x] = Cell.Wall;
  }
  for (let y = 0; y < g.h; y++) {
    g.cells[y * g.w] = Cell.Wall;
    g.cells[y * g.w + g.w - 1] = Cell.Wall;
  }
}

// ---------------------------------------------------------------------------
// 座標ハッシュと雑音（乱数を消費しない）
// ---------------------------------------------------------------------------

/** 座標 (x, y) と種 s から 32bit の符号なし整数を作る */
export function h32(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

const U32_RANGE = 4294967296;

/** h32 を [0, 1) にしたもの */
export function hf(x: number, y: number, s: number): number {
  return h32(x, y, s) / U32_RANGE;
}

/** 値雑音 [0, 1]。p = 格子の周期（マス）。なめらか補間 */
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

// ---------------------------------------------------------------------------
// 塗る（円・線・折れ線・塊）
// ---------------------------------------------------------------------------

function paint(g: Grid, i: number, v: Cell, only: Cell | undefined): void {
  if (only !== undefined && g.cells[i] !== only) return;
  g.cells[i] = v;
}

/** 中心 (cx, cy)・半径 r の円を v にする。外周は触らない */
export function disc(g: Grid, cx: number, cy: number, r: number, v: Cell, opts: PaintOptions = {}): void {
  const x0 = Math.max(1, Math.floor(cx - r - 1));
  const x1 = Math.min(g.w - 2, Math.ceil(cx + r + 1));
  const y0 = Math.max(1, Math.floor(cy - r - 1));
  const y1 = Math.min(g.h - 2, Math.ceil(cy + r + 1));
  const rr = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy >= rr) continue;
      paint(g, y * g.w + x, v, opts.only);
    }
  }
}

/** 2 点の間を半径 r の円でなぞる。道幅は r の 2 倍 */
export function line(g: Grid, ax: number, ay: number, bx: number, by: number, r: number, v: Cell, opts: PaintOptions = {}): void {
  const dx = bx - ax;
  const dy = by - ay;
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    disc(g, ax + dx * t, ay + dy * t, r, v, opts);
  }
}

export function polyline(g: Grid, pts: readonly Vec[], r: number, v: Cell, opts: PaintOptions = {}): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) line(g, a.x, a.y, b.x, b.y, r, v, opts);
  }
}

/**
 * 曲がった道: 中点を法線方向へずらして depth 回細かくする。wig = 辺の長さに対するずれ（0.2 で 2 割）。
 * 乱数は細かくするたびに辺ごとに 1 回
 */
export function wander(rng: Rng, a: Vec, b: Vec, wig: number, depth: number): Vec[] {
  let pts: Vec[] = [a, b];
  for (let d = 0; d < depth; d++) {
    const out: Vec[] = [pts[0] ?? a];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      if (!p || !q) continue;
      const len = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)) || 1;
      const off = (rng.next() - 0.5) * 2 * wig * len;
      out.push({ x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * off, y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * off }, q);
    }
    pts = out;
  }
  return pts;
}

/** 雑音で縁が揺れる塊（楕円にもできる）。noiseSeed は座標ハッシュの種、amp は半径の揺れの割合 */
export function blob(g: Grid, cx: number, cy: number, r: number, noiseSeed: number, amp: number, v: Cell, opts: BlobOptions = {}): void {
  const sx = opts.sx ?? 1;
  const sy = opts.sy ?? 1;
  const ang = opts.ang ?? 0;
  const R = r * (1 + amp) * Math.max(sx, sy) + 1;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let y = Math.floor(cy - R); y <= cy + R; y++) {
    for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!isInner(g, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * ca + dy * sa) / sx;
      const w = (-dx * sa + dy * ca) / sy;
      const rr = r * (1 + (vnoise(x, y, BLOB_NOISE_PERIOD, noiseSeed) - 0.5) * 2 * amp);
      if (u * u + w * w < rr * rr) paint(g, y * g.w + x, v, opts.only);
    }
  }
}

/** 折れ線の角を切って丸くする（Chaikin。n 回。1 回ごとに点が約 2 倍。端点は動かさない） */
export function chaikin(pts: readonly Vec[], n: number): Vec[] {
  let cur: Vec[] = pts.map((p) => ({ x: p.x, y: p.y }));
  const far = 1 - CHAIKIN_NEAR;
  for (let k = 0; k < n; k++) {
    const first = cur[0];
    const last = cur[cur.length - 1];
    if (!first || !last) return cur;
    const out: Vec[] = [first];
    for (let i = 1; i < cur.length; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      if (!a || !b) continue;
      out.push({ x: a.x * far + b.x * CHAIKIN_NEAR, y: a.y * far + b.y * CHAIKIN_NEAR }, { x: a.x * CHAIKIN_NEAR + b.x * far, y: a.y * CHAIKIN_NEAR + b.y * far });
    }
    out.push(last);
    cur = out;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// 点を置く・つなぐ
// ---------------------------------------------------------------------------

/**
 * Poisson disk（投げ矢）: 互いに minD 以上離れた点を maxN 個まで置く。範囲は [x0, x1) × [y0, y1)。
 * avoid が true を返す所には置かない。乱数は試行ごとに x・y の 2 回（avoid で落ちても消費する）
 */
export function poisson(rng: Rng, minD: number, x0: number, y0: number, x1: number, y1: number, maxN: number, avoid?: (p: Vec) => boolean): Vec[] {
  const pts: Vec[] = [];
  const minSq = minD * minD;
  for (let t = 0; t < POISSON_TRIES && pts.length < maxN; t++) {
    const p = { x: x0 + rng.next() * (x1 - x0), y: y0 + rng.next() * (y1 - y0) };
    if (avoid?.(p)) continue;
    if (pts.every((q) => (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) >= minSq)) pts.push(p);
  }
  return pts;
}

/** 力学的な緩和: 近すぎる点どうしを押し離し、枠 [x0, x1] × [y0, y1] に戻す（pts を直接動かす。乱数なし） */
export function relax(pts: RelaxPoint[], iters: number, minD: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (d >= minD) continue;
        const push = (minD - d) * RELAX_PUSH;
        if (!a.fixed) {
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
        }
        if (!b.fixed) {
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
    for (const p of pts) {
      p.x = clamp(p.x, x0, x1);
      p.y = clamp(p.y, y0, y1);
    }
  }
}

/** 最小全域木（Prim）。点 0 から伸ばし、辺は [既に木に入っている点, 新しい点] */
export function mstEdges(pts: readonly Vec[]): Edge[] {
  const n = pts.length;
  const edges: Edge[] = [];
  if (n === 0) return edges;
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || (best[i] ?? 0) < (best[u] ?? 0))) u = i;
    inTree[u] = 1;
    const fu = from[u] ?? -1;
    if (fu >= 0) edges.push([fu, u]);
    const pu = pts[u];
    if (!pu) continue;
    for (let v = 0; v < n; v++) {
      const pv = pts[v];
      if (inTree[v] || !pv) continue;
      const d = (pu.x - pv.x) * (pu.x - pv.x) + (pu.y - pv.y) * (pu.y - pv.y);
      if (d < (best[v] ?? Infinity)) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  return edges;
}

/** 線分 ab と cd が（端点を除いて）交わるか */
export function segCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o = (p: Vec, q: Vec, r: Vec): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * 木にならない短い辺（maxLen 以下）を、既存の辺と交差しないものだけ k 本まで足してループを作る。
 * edges を直接書き足して返す。同じ長さなら添字の小さい組が先（安定）
 */
export function addLoops(pts: readonly Vec[], edges: Edge[], k: number, maxLen: number): Edge[] {
  const n = pts.length;
  const has = new Set(edges.map(([a, b]) => Math.min(a, b) * n + Math.max(a, b)));
  const maxSq = maxLen * maxLen;
  const cand: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (has.has(i * n + j)) continue;
      const pi = pts[i];
      const pj = pts[j];
      if (!pi || !pj) continue;
      const d = (pi.x - pj.x) * (pi.x - pj.x) + (pi.y - pj.y) * (pi.y - pj.y);
      if (d <= maxSq) cand.push([d, i, j]);
    }
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  let added = 0;
  for (const [, i, j] of cand) {
    if (added >= k) break;
    const pi = pts[i];
    const pj = pts[j];
    if (!pi || !pj) continue;
    const crosses = edges.some(([a, b]) => {
      const pa = pts[a];
      const pb = pts[b];
      return a !== i && a !== j && b !== i && b !== j && pa !== undefined && pb !== undefined && segCross(pi, pj, pa, pb);
    });
    if (crosses) continue;
    edges.push([i, j]);
    added++;
  }
  return edges;
}

// ---------------------------------------------------------------------------
// 格子の整形（セルオートマトン・岩くず・Voronoi・連結）
// ---------------------------------------------------------------------------

/** 8 近傍の壁の数（地図の外は壁。穴は壁として数えない） */
function wallCount8(g: Grid, x: number, y: number): number {
  let n = 0;
  for (const [dx, dy] of NEIGHBORS_8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || g.cells[ny * g.w + nx] === Cell.Wall) n++;
  }
  return n;
}

/**
 * セルオートマトン 1 手。壁は周囲 8 マスの壁が survive 以上なら壁のまま、床は birth 以上なら壁になる。
 * 穴は変えない。新しい配列を返す（g は変えない）
 */
export function caStep(g: Grid, birth: number, survive: number): Uint8Array {
  const out = new Uint8Array(g.cells.length);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const cur = g.cells[i] ?? Cell.Wall;
      if (cur === Cell.Pit) {
        out[i] = Cell.Pit;
        continue;
      }
      const n = wallCount8(g, x, y);
      const wall = cur === Cell.Wall ? n >= survive : n >= birth;
      out[i] = wall ? Cell.Wall : Cell.Floor;
    }
  }
  return out;
}

/** 床（や穴）に囲まれた 1 マスの岩くずを床にする（彫った跡の汚れ）。周囲 8 マスの壁が 1 以下の壁が対象 */
export function tidy(g: Grid): void {
  const next = g.cells.slice();
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      if (g.cells[i] === Cell.Wall && wallCount8(g, x, y) <= 1) next[i] = Cell.Floor;
    }
  }
  g.cells.set(next);
}

/**
 * Voronoi の部屋割り: 各マスの一番近い種の部屋に入り、2 番目との距離の差が gap 未満（境目）は壁のまま、
 * 種から r（雑音で amp だけ揺れる）より遠い所も壁のまま。mask が false を返すマスは触らない。
 * 床にしたマスの所属（種の添字）を返す（床にしなかったマスは -1）。ring / isle が部屋の所属タイルを作るのに使う
 */
export function voronoiCarve(
  g: Grid,
  sites: readonly VoronoiSite[],
  gap: number,
  noiseSeed: number,
  amp: number,
  mask?: (x: number, y: number) => boolean,
): Int16Array {
  const owner = new Int16Array(g.cells.length).fill(-1);
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      if (mask && !mask(x, y)) continue;
      let best = Infinity;
      let second = Infinity;
      let a = -1;
      for (let s = 0; s < sites.length; s++) {
        const p = sites[s];
        if (!p) continue;
        const dx = x + 0.5 - p.x;
        const dy = y + 0.5 - p.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          second = best;
          best = d;
          a = s;
        } else if (d < second) second = d;
      }
      const site = sites[a];
      if (!site) continue;
      const d1 = Math.sqrt(best);
      const d2 = Math.sqrt(second);
      if (d2 - d1 < gap) continue;
      if (d1 >= site.r * (1 + (vnoise(x, y, VORONOI_NOISE_PERIOD, noiseSeed) - 0.5) * 2 * amp)) continue;
      g.cells[y * g.w + x] = Cell.Floor;
      owner[y * g.w + x] = a;
    }
  }
  return owner;
}

/** 床の 4 近傍連結成分に番号を付ける（床でないマスは -1）。sizes[番号] = タイル数 */
function labelFloor(g: Grid): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(g.cells.length).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(g.cells.length);
  for (let start = 0; start < g.cells.length; start++) {
    if (g.cells[start] !== Cell.Floor || (lab[start] ?? -1) >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    lab[start] = id;
    while (head < tail) {
      const c = queue[head++] ?? 0;
      const x = c % g.w;
      const y = Math.floor(c / g.w);
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const ni = ny * g.w + nx;
        if (g.cells[ni] !== Cell.Floor || (lab[ni] ?? -1) >= 0) continue;
        lab[ni] = id;
        queue[tail++] = ni;
      }
    }
    sizes.push(tail);
  }
  return { lab, sizes };
}

/**
 * すべての床を 1 つにつなぐ。最大の成分を本体とし、minKeep 未満の欠片は壁で埋め、
 * それ以上の欠片は大きい順に、本体（つながり済みの床）まで最短の道を幅 2 で掘る（壁も穴も掘る。穴の上は桟道になる）。
 * 番号付けは最初の 1 回だけ。つながった分は本体に加えて次の欠片の行き先にする
 */
export function connectAll(g: Grid, minKeep: number): void {
  const { lab, sizes } = labelFloor(g);
  if (sizes.length <= 1) return;
  let main = 0;
  for (let k = 1; k < sizes.length; k++) if ((sizes[k] ?? 0) > (sizes[main] ?? 0)) main = k;

  const joined = new Uint8Array(g.cells.length);
  const members: number[][] = sizes.map(() => []);
  for (let i = 0; i < lab.length; i++) {
    const id = lab[i] ?? -1;
    if (id < 0) continue;
    members[id]?.push(i);
    if (id === main) joined[i] = 1;
  }

  const others: number[] = [];
  for (let k = 0; k < sizes.length; k++) {
    if (k === main) continue;
    if ((sizes[k] ?? 0) < minKeep) {
      for (const i of members[k] ?? []) g.cells[i] = Cell.Wall;
      continue;
    }
    others.push(k);
  }
  // 大きい欠片から（同じ大きさなら番号順）
  others.sort((a, b) => (sizes[b] ?? 0) - (sizes[a] ?? 0) || a - b);

  const prev = new Int32Array(g.cells.length);
  const stamp = new Int32Array(g.cells.length);
  const queue = new Int32Array(g.cells.length);
  let round = 0;
  for (const k of others) {
    const sources = members[k] ?? [];
    if (sources.some((i) => joined[i])) continue; // 前の道で既につながった
    round++;
    const hit = searchTunnel(g, sources, joined, prev, stamp, queue, round);
    if (hit < 0) {
      for (const i of sources) g.cells[i] = Cell.Wall;
      continue;
    }
    const carved = carveTunnel(g, prev, hit);
    absorb(g, carved, joined);
  }
}

/** sources から 4 近傍 BFS で、joined に着く最初のマスを探す（壁・穴・他の床を通る。外周は通らない）。着かなければ -1 */
function searchTunnel(g: Grid, sources: readonly number[], joined: Uint8Array, prev: Int32Array, stamp: Int32Array, queue: Int32Array, round: number): number {
  let head = 0;
  let tail = 0;
  for (const i of sources) {
    stamp[i] = round;
    prev[i] = -1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const c = queue[head++] ?? 0;
    const x = c % g.w;
    const y = Math.floor(c / g.w);
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInner(g, nx, ny)) continue;
      const ni = ny * g.w + nx;
      if (stamp[ni] === round) continue;
      stamp[ni] = round;
      prev[ni] = c;
      if (joined[ni]) return ni;
      queue[tail++] = ni;
    }
  }
  return -1;
}

/** hit から prev をたどって幅 2 の床を掘る。掘った道の出発点（欠片の側）を返す */
function carveTunnel(g: Grid, prev: Int32Array, hit: number): number {
  let origin = hit;
  for (let c = prev[hit] ?? -1; c >= 0; c = prev[c] ?? -1) {
    origin = c;
    const x = c % g.w;
    const y = Math.floor(c / g.w);
    for (const [dx, dy] of CARVE_OFFSETS) {
      if (isInner(g, x + dx, y + dy)) g.cells[(y + dy) * g.w + x + dx] = Cell.Floor;
    }
  }
  return origin;
}

/** origin から床でつながる、まだ joined でないマスを joined に加える（道が途中で他の欠片に触れていれば、それも本体になる） */
function absorb(g: Grid, origin: number, joined: Uint8Array): void {
  const stack = [origin];
  joined[origin] = 1;
  while (stack.length > 0) {
    const c = stack.pop() ?? 0;
    const x = c % g.w;
    const y = Math.floor(c / g.w);
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (g.cells[ni] !== Cell.Floor || joined[ni]) continue;
      joined[ni] = 1;
      stack.push(ni);
    }
  }
}

// ---------------------------------------------------------------------------
// 最も遠い 2 点（完成した地図の上で歩く距離を測る）
// ---------------------------------------------------------------------------

/** start から 4 近傍で歩ける床の歩数（歩けない・届かないマスは -1） */
export function bfsDistances(g: Grid, start: number): Int32Array {
  const dist = new Int32Array(g.cells.length).fill(-1);
  if (g.cells[start] !== Cell.Floor) return dist;
  const queue = new Int32Array(g.cells.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  while (head < tail) {
    const c = queue[head++] ?? 0;
    const x = c % g.w;
    const y = Math.floor(c / g.w);
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (g.cells[ni] !== Cell.Floor || (dist[ni] ?? -1) >= 0) continue;
      dist[ni] = (dist[c] ?? 0) + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/**
 * 候補の点（床の上にあるものだけ）のうち、歩く距離が最も遠い 2 点の添字を返す。
 * 見本のグラフ上の Floyd（O(n³)。川は渡れないので距離がずれる）の代わりに、完成した地図の上で BFS を 2 回
 * （最初の候補から最も遠い点 a → a から最も遠い点 b）。使える候補が 2 つ未満なら null。同じ距離なら添字の小さい方
 */
export function farthestPair(g: Grid, pts: readonly Vec[]): [number, number] | null {
  const tileOf = (p: Vec): number => Math.floor(p.y) * g.w + Math.floor(p.x);
  const usable: number[] = [];
  pts.forEach((p, i) => {
    const inside = p.x >= 0 && p.y >= 0 && p.x < g.w && p.y < g.h;
    if (inside && g.cells[tileOf(p)] === Cell.Floor) usable.push(i);
  });
  const first = usable[0];
  if (first === undefined || usable.length < 2) return null;
  const farthestFrom = (from: number): number => {
    const origin = pts[from];
    if (!origin) return from;
    const dist = bfsDistances(g, tileOf(origin));
    let bestIndex = from;
    let bestDist = -1;
    for (const i of usable) {
      const p = pts[i];
      const d = p ? (dist[tileOf(p)] ?? -1) : -1;
      if (d > bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  };
  const a = farthestFrom(first);
  const b = farthestFrom(a);
  return a === b ? null : [a, b];
}
