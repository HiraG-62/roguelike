/**
 * 階の型「谷・川筋」（river）。地図を横切る川（穴）を 1 本蛇行させ、両岸に河原（谷底の床）と脇の洞を開け、
 * 橋と浅瀬でだけ渡れる。開始は片岸の上流、主の間は向こう岸の下流の洞（渡らないと着かない）。
 * 見本（docs/ideas/previews/map-preview.html の genRiver）の移植。数値は data/balance/world/MAP_LAYOUT/river.json。
 *
 * 性能（map-gen-impl.md 2-5）: 見本は全マス × 折れ線の全区間で最近点を探して 200x115 で 116ms かかった。
 * ここでは折れ線を 0.5 マスおきの標本にして、標本の位置を種にした「最も近い標本」の伝播（多点の距離変換）で
 * 川までの距離・岸・流れの位置を全マス一度に出し、洞の置き場・道の検査・橋の位置はその表を引くだけにする。
 */
import type { Rng } from "../../core/rng";
import { terrainCode } from "../../core/terrain";
import { MAP_LAYOUT } from "../../data/tuning";
import { NEIGHBORS_8 } from "../regions";
import { addLoops, blob, chaikin, clamp, connectAll, line, makeGrid, mstEdges, poisson, polyline, tidy, vnoise, wander } from "./shapes";
import type { Grid, Vec } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.river;

/** 川の蛇行: 中点を法線へずらす幅（辺の長さに対する割合）と細分回数（アルゴリズムの細部なので定数） */
const RIVER_WIG = 0.2;
const RIVER_DEPTH = 4;
/** 角を丸める回数 */
const RIVER_SMOOTH = 2;
/** 川の途中の点を地図の縁から離しておく割合（川が縁に張り付いて片岸が無くならないように） */
const MARGIN_X = 0.12;
const MARGIN_Y = 0.15;
/** 川の両端を地図の外へ出す距離（縁まで必ず川が届く） */
const OUTSIDE = 3;
/** 中心線の標本の間隔（マス）。半幅 1 マス強より十分細かい */
const SAMPLE_STEP = 0.5;
/** 川幅の雑音: 流れの位置 t（0..1）に掛ける周波数と格子の周期 */
const WIDTH_NOISE_FREQ = 40;
const WIDTH_NOISE_PERIOD = 6;
/** 河原の縁の雑音の周期（× unit）と、河原の岩の雑音の周期（マス） */
const VALLEY_PERIOD = 9;
const HOLE_PERIOD = 3;
/** 雑音の種のずらし（同じ noiseSeed から用途ごとに別の雑音を取る） */
const SEED_WIDTH = 9;
const SEED_VALLEY = 3;
const SEED_HOLE = 4;
const SEED_ROOM = 20;
/** 洞の形（見本のまま）: 縁の揺れ・楕円の伸び */
const ROOM_AMP = 0.3;
const ROOM_SX = 1.15;
const ROOM_SY = 0.9;
/** 洞どうしの道の曲がり（wander の幅と細分回数） */
const ROAD_WIG = 0.16;
const ROAD_DEPTH = 3;
/** 河原へ降りる道の曲がりと半径 */
const SHORE_WIG = 0.12;
const SHORE_DEPTH = 2;
const SHORE_RADIUS = 1.15;
/** 河原へ降りる道が岸の何マス内側に着くか */
const SHORE_LAND = 1;
/** 洞の部屋に育てる幅の下限（タイル） */
const MIN_ROOM_GROW = 4;
/** 地図の内側とみなす余白（橋・浅瀬を置く標本の範囲） */
const CROSS_MARGIN = 4;
/** 渡り場所の間隔は、両端を除いた区間の中央に置く */
const CROSS_STEP = 0.5;
/** 浅瀬に水の地形を重ねる範囲の、岸からの許容（rd がこれ未満） */
const FORD_WATER_RD = 0.3;
/** 洞の置き場の探索範囲（地図の縁からの余白） */
const ROOM_MARGIN_LO = 3.5;
const ROOM_MARGIN_HI = 4.5;

/** 川の中心線の標本（構造体の配列にすると 1 標本ごとにオブジェクトができるので、列ごとの配列で持つ） */
interface Centerline {
  count: number;
  x: Float64Array;
  y: Float64Array;
  /** 流れの向き（単位ベクトル） */
  tx: Float64Array;
  ty: Float64Array;
  /** 上流 0 → 下流 1 */
  t: Float64Array;
  /** その標本での川の半幅（unit 倍済み） */
  hw: Float64Array;
  /** 折れ線の長さ（マス） */
  length: number;
}

/** 全マスの「最も近い標本」と、その標本までの距離 */
interface RiverField {
  /** 川の中心線までの距離 */
  dist: Float64Array;
  src: Int32Array;
  /** 川の縁までの符号つき距離（負 = 川の中） */
  rd: Float32Array;
}

interface Room {
  x: number;
  y: number;
  r: number;
  ang: number;
  /** 川に対してどちらの岸か（-1 / 1） */
  side: number;
  /** 最も近い標本の添字 */
  near: number;
  /** 中心線までの距離 */
  d: number;
}

export const generateRiver: LayoutGenerator = (rng, frame) => {
  const { width: w, height: h, unit: u, noiseSeed } = frame;
  const cl = centerline(riverPath(rng, w, h), frame);
  const field = riverField(w, h, cl);
  if (!field) return null;

  const g = makeGrid(w, h, Cell.Wall);
  const shallow = new Uint8Array(w * h);
  const valleyWidth = (P.valleyMin + P.valleyVar * rng.next()) * u;
  carveRiverAndValley(g, field, valleyWidth, u, noiseSeed);

  const rooms = placeRooms(rng, field, cl, valleyWidth, frame);
  const left = rooms.filter((r) => r.side < 0);
  const right = rooms.filter((r) => r.side > 0);
  if (left.length === 0 || right.length === 0) return null;
  for (const r of rooms) blob(g, r.x, r.y, r.r, noiseSeed + SEED_ROOM, ROOM_AMP, Cell.Floor, { sx: ROOM_SX, sy: ROOM_SY, ang: r.ang, only: Cell.Wall });
  linkRooms(rng, g, field, left, frame);
  linkRooms(rng, g, field, right, frame);
  linkShore(rng, g, cl, rooms, left, right, u);
  placeCrossings(rng, g, shallow, field, cl, frame);

  tidy(g);
  fillPinches(g);
  connectAll(g, P.keepFragment);

  const upstream = left.reduce((a, b) => (cl.t[b.near] ?? 0) < (cl.t[a.near] ?? 0) ? b : a);
  const downstream = right.reduce((a, b) => (cl.t[b.near] ?? 0) > (cl.t[a.near] ?? 0) ? b : a);
  const nodes: LayoutNode[] = rooms.map((r) => ({
    x: r.x,
    y: r.y,
    role: r === upstream ? "start" : r === downstream ? "lord" : "room",
    grow: Math.max(MIN_ROOM_GROW, Math.round(r.r * P.roomGrow)),
  }));
  const draft: LayoutDraft = { cells: g.cells, shallow, nodes };
  return draft;
};

// ---------------------------------------------------------------------------
// 川の中心線
// ---------------------------------------------------------------------------

/** 横・縦・斜めの 3 通りのどれかで地図を横切る折れ線（両端は地図の外） */
function riverPath(rng: Rng, w: number, h: number): Vec[] {
  const mode = Math.floor(rng.next() * 3);
  let a: Vec;
  let b: Vec;
  if (mode === 0) {
    a = { x: -OUTSIDE, y: h * (0.3 + rng.next() * 0.4) };
    b = { x: w + OUTSIDE - 1, y: h * (0.3 + rng.next() * 0.4) };
  } else if (mode === 1) {
    a = { x: w * (0.3 + rng.next() * 0.4), y: -OUTSIDE };
    b = { x: w * (0.3 + rng.next() * 0.4), y: h + OUTSIDE - 1 };
  } else {
    const up = rng.next() < 0.5;
    a = { x: -OUTSIDE, y: h * (up ? 0.15 + rng.next() * 0.2 : 0.65 + rng.next() * 0.2) };
    b = { x: w * (0.6 + rng.next() * 0.3), y: up ? h + OUTSIDE - 1 : -OUTSIDE };
  }
  const pts = wander(rng, a, b, RIVER_WIG, RIVER_DEPTH);
  // 地図が大きいと蛇行の振れ幅も大きくなり、川が地図の外へ出て片岸が消える。途中の点だけ内側に戻す
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (!p) continue;
    p.x = clamp(p.x, w * MARGIN_X, w * (1 - MARGIN_X));
    p.y = clamp(p.y, h * MARGIN_Y, h * (1 - MARGIN_Y));
  }
  return chaikin(pts, RIVER_SMOOTH);
}

/** 折れ線を SAMPLE_STEP おきの標本にする。半幅は流れの位置の雑音で太くなったり細くなったりする */
function centerline(pts: readonly Vec[], frame: LayoutFrame): Centerline {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    cum.push((cum[i - 1] ?? 0) + (a && b ? Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) : 0));
  }
  const length = cum[cum.length - 1] ?? 0;
  const count = Math.max(2, Math.floor(length / SAMPLE_STEP) + 1);
  const cl: Centerline = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    tx: new Float64Array(count),
    ty: new Float64Array(count),
    t: new Float64Array(count),
    hw: new Float64Array(count),
    length,
  };
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const s = Math.min(length, k * SAMPLE_STEP);
    while (seg < pts.length - 1 && (cum[seg] ?? 0) < s) seg++;
    const a = pts[seg - 1];
    const b = pts[seg];
    if (!a || !b) continue;
    const segLen = (cum[seg] ?? 0) - (cum[seg - 1] ?? 0) || 1;
    const f = clamp((s - (cum[seg - 1] ?? 0)) / segLen, 0, 1);
    cl.x[k] = a.x + (b.x - a.x) * f;
    cl.y[k] = a.y + (b.y - a.y) * f;
    cl.tx[k] = (b.x - a.x) / segLen;
    cl.ty[k] = (b.y - a.y) / segLen;
    const t = length > 0 ? s / length : 0;
    cl.t[k] = t;
    cl.hw[k] = (P.halfWidthBase + P.halfWidthVar * vnoise(t * WIDTH_NOISE_FREQ, 3, WIDTH_NOISE_PERIOD, frame.noiseSeed + SEED_WIDTH)) * frame.unit;
  }
  return cl;
}

/**
 * 全マスの「最も近い標本」を求める。標本のあるマスを種に、8 近傍へ「標本の位置までの正確な距離」が縮むかぎり伝える
 * （待ち行列つきの緩和。誤差は 1 マスに満たず、全マスで数回しか訪れない）。標本が地図の中に無ければ null
 */
function riverField(w: number, h: number, cl: Centerline): RiverField | null {
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n + 1);
  const queued = new Uint8Array(n);
  let head = 0;
  let tail = 0;
  const push = (i: number): void => {
    if (queued[i]) return;
    queued[i] = 1;
    queue[tail] = i;
    tail = tail === n ? 0 : tail + 1;
  };
  const dist2At = (x: number, y: number, s: number): number => {
    const dx = x + 0.5 - (cl.x[s] ?? 0);
    const dy = y + 0.5 - (cl.y[s] ?? 0);
    return Math.sqrt(dx * dx + dy * dy);
  };
  let seeded = false;
  for (let s = 0; s < cl.count; s++) {
    const x = Math.floor(cl.x[s] ?? 0);
    const y = Math.floor(cl.y[s] ?? 0);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    const d = dist2At(x, y, s);
    if (d >= (dist[i] ?? Infinity)) continue;
    dist[i] = d;
    src[i] = s;
    seeded = true;
    push(i);
  }
  if (!seeded) return null;
  while (head !== tail) {
    const c = queue[head] ?? 0;
    head = head === n ? 0 : head + 1;
    queued[c] = 0;
    const s = src[c] ?? -1;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      const d = dist2At(nx, ny, s);
      if (d >= (dist[ni] ?? Infinity)) continue;
      dist[ni] = d;
      src[ni] = s;
      push(ni);
    }
  }
  const rd = new Float32Array(n);
  for (let i = 0; i < n; i++) rd[i] = (dist[i] ?? Infinity) - (cl.hw[src[i] ?? 0] ?? 0);
  return { dist, src, rd };
}

/** 標本 s から見て (px, py) がどちらの岸か（-1 / 1） */
function sideOf(cl: Centerline, s: number, px: number, py: number): number {
  const cross = (cl.tx[s] ?? 0) * (py - (cl.y[s] ?? 0)) - (cl.ty[s] ?? 0) * (px - (cl.x[s] ?? 0));
  return cross >= 0 ? 1 : -1;
}

function cellOf(w: number, h: number, x: number, y: number): number {
  return clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1);
}

// ---------------------------------------------------------------------------
// 川・河原・洞
// ---------------------------------------------------------------------------

/** 川（穴）と、その両岸の河原（谷底の床）。谷の壁は川に沿って続き、河原の縁は雑音で波打つ */
function carveRiverAndValley(g: Grid, field: RiverField, valleyWidth: number, u: number, noiseSeed: number): void {
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      const rd = field.rd[i] ?? Infinity;
      if (rd < 0) {
        g.cells[i] = Cell.Pit;
        continue;
      }
      const reach = valleyWidth + P.valleyNoise * u * vnoise(x, y, VALLEY_PERIOD * u, noiseSeed + SEED_VALLEY);
      // 岸のふち（valleyKeep）は岩を開けず、川に沿った幅のある道を必ず残す（岩の欠けで河原が 1 マス幅に細ると、橋まで歩けなくなる）
      if (rd < P.valleyKeep || (rd < reach && vnoise(x, y, HOLE_PERIOD, noiseSeed + SEED_HOLE) > P.valleyHole)) g.cells[i] = Cell.Floor;
    }
  }
}

/** 河原の外側（谷の壁の向こう）に洞の位置を Poisson で置く。どちらの岸かは最も近い標本で決まる */
function placeRooms(rng: Rng, field: RiverField, cl: Centerline, valleyWidth: number, frame: LayoutFrame): Room[] {
  const { width: w, height: h, unit: u, countMul } = frame;
  const clear = valleyWidth + P.roomClear * u;
  const points = poisson(
    rng,
    P.roomSpacing * u,
    ROOM_MARGIN_LO,
    ROOM_MARGIN_LO,
    w - ROOM_MARGIN_HI,
    h - ROOM_MARGIN_HI,
    Math.round(P.roomMax * countMul),
    (p) => (field.rd[cellOf(w, h, p.x, p.y)] ?? Infinity) < clear,
  );
  return points.map((p) => {
    const i = cellOf(w, h, p.x, p.y);
    const near = field.src[i] ?? 0;
    return {
      x: p.x,
      y: p.y,
      r: (P.roomRadiusMin + P.roomRadiusVar * rng.next()) * u,
      ang: rng.next() * 3,
      side: sideOf(cl, near, p.x, p.y),
      near,
      d: field.dist[i] ?? 0,
    };
  });
}

/** 同じ岸の洞どうしを最小全域木 + ループで結ぶ。川の縁に触れる道は彫らずに捨てる（岸を越えない） */
function linkRooms(rng: Rng, g: Grid, field: RiverField, rooms: readonly Room[], frame: LayoutFrame): void {
  const edges = addLoops(rooms, mstEdges(rooms), Math.round(P.roomLoops * frame.countMul), P.roomLoopLen * frame.unit);
  for (const [a, b] of edges) {
    const ra = rooms[a];
    const rb = rooms[b];
    if (!ra || !rb) continue;
    const path = wander(rng, ra, rb, ROAD_WIG, ROAD_DEPTH);
    const radius = P.roadRadiusMin + P.roadRadiusVar * rng.next();
    if (path.some((p) => (field.rd[cellOf(g.w, g.h, p.x, p.y)] ?? Infinity) < P.roadClear)) continue;
    polyline(g, path, radius, Cell.Floor, { only: Cell.Wall });
  }
}

/** 川に近い洞は河原へ降りる道を持つ。どちらの岸も、川にいちばん近い洞は必ず持つ（河原と洞を切らさない） */
function linkShore(rng: Rng, g: Grid, cl: Centerline, rooms: readonly Room[], left: readonly Room[], right: readonly Room[], u: number): void {
  const nearest = (side: readonly Room[]): Room | undefined => side.reduce<Room | undefined>((a, b) => (!a || b.d < a.d ? b : a), undefined);
  const forced = new Set<Room>([nearest(left), nearest(right)].filter((r): r is Room => r !== undefined));
  for (const r of rooms) {
    if (r.d >= P.shoreReach * u && !forced.has(r)) continue;
    const qx = cl.x[r.near] ?? 0;
    const qy = cl.y[r.near] ?? 0;
    const len = r.d || 1;
    const hw = (cl.hw[r.near] ?? 0) + SHORE_LAND;
    const end = { x: qx + ((r.x - qx) / len) * hw, y: qy + ((r.y - qy) / len) * hw };
    polyline(g, wander(rng, r, end, SHORE_WIG, SHORE_DEPTH), SHORE_RADIUS, Cell.Floor, { only: Cell.Wall });
  }
}

// ---------------------------------------------------------------------------
// 橋と浅瀬
// ---------------------------------------------------------------------------

/** 渡れる場所（橋 2 本以上 + 浅瀬 1 か所以上）を、川に沿って間隔をあけて置く。橋の本数は川の長さに比例 */
function placeCrossings(rng: Rng, g: Grid, shallow: Uint8Array, field: RiverField, cl: Centerline, frame: LayoutFrame): void {
  const { width: w, height: h, unit: u } = frame;
  const bridges = Math.max(2, Math.round((P.bridgeBase + (rng.next() < P.bridgeExtraChance ? 1 : 0)) * (cl.length / (P.bridgeSpan * u))));
  const fords = Math.max(1, Math.round(bridges / P.fordPerBridges));
  const total = bridges + fords;
  const fordSlots = pickFordSlots(rng, total, fords);
  const water = terrainCode("water");
  for (let k = 0; k < total; k++) {
    const target = (k + CROSS_STEP + (rng.next() - 0.5) * P.crossJitter) / total;
    const s = sampleNear(cl, target, w, h);
    if (s < 0) continue;
    const px = cl.x[s] ?? 0;
    const py = cl.y[s] ?? 0;
    // 流れに垂直な向き
    const nx = -(cl.ty[s] ?? 0);
    const ny = cl.tx[s] ?? 0;
    const reach = (cl.hw[s] ?? 0) + P.bridgeOver;
    if (fordSlots.has(k)) {
      carveFord(g, shallow, field, { px, py, nx, ny, reach }, water);
      continue;
    }
    line(g, px - nx * reach, py - ny * reach, px + nx * reach, py + ny * reach, P.bridgeRadius, Cell.Floor);
  }
}

/** 浅瀬の位置（渡り場所の何番目か）。両端は橋にして、間隔をあけて fords 個 */
function pickFordSlots(rng: Rng, total: number, fords: number): Set<number> {
  const slots = new Set<number>();
  const lo = 1;
  const hi = Math.max(lo, total - 2);
  for (let j = 0; j < fords; j++) {
    const ideal = Math.floor(((j + 0.35 + 0.3 * rng.next()) * total) / fords);
    let slot = clamp(ideal, lo, hi);
    while (slots.has(slot) && slot < hi) slot++;
    while (slots.has(slot) && slot > lo) slot--;
    slots.add(slot);
  }
  return slots;
}

/** 流れの位置 target（0..1）にいちばん近く、地図の内側にある標本の添字（無ければ -1） */
function sampleNear(cl: Centerline, target: number, w: number, h: number): number {
  let best = -1;
  let bestGap = Infinity;
  for (let s = 0; s < cl.count; s++) {
    const x = cl.x[s] ?? 0;
    const y = cl.y[s] ?? 0;
    if (x < CROSS_MARGIN || y < CROSS_MARGIN || x > w - CROSS_MARGIN - 1 || y > h - CROSS_MARGIN - 1) continue;
    const gap = Math.abs((cl.t[s] ?? 0) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}

interface CrossSite {
  px: number;
  py: number;
  nx: number;
  ny: number;
  reach: number;
}

/** 浅瀬: 川幅いっぱいを太い帯（fordRadius）で床にし、川だった所に水の地形を重ねる */
function carveFord(g: Grid, shallow: Uint8Array, field: RiverField, site: CrossSite, water: number): void {
  const { px, py, nx, ny, reach } = site;
  line(g, px - nx * reach, py - ny * reach, px + nx * reach, py + ny * reach, P.fordRadius, Cell.Floor);
  const box = reach + P.fordHalfLen + 1;
  const x0 = Math.max(1, Math.floor(px - box));
  const x1 = Math.min(g.w - 2, Math.ceil(px + box));
  const y0 = Math.max(1, Math.floor(py - box));
  const y1 = Math.min(g.h - 2, Math.ceil(py + box));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * g.w + x;
      if (g.cells[i] !== Cell.Floor || (field.rd[i] ?? Infinity) >= FORD_WATER_RD) continue;
      const along = (x + 0.5 - px) * -ny + (y + 0.5 - py) * nx;
      if (Math.abs(along) < P.fordHalfLen) shallow[i] = water;
    }
  }
}

// ---------------------------------------------------------------------------
// 仕上げ
// ---------------------------------------------------------------------------

/**
 * 2x2 の 4 マスのうち床が 3 つで壁が 1 つなら、その壁を床にする（壁の出っ張りの角を削る）。
 * 彫り跡のつなぎ目（道と道・道と洞）が角どうしだけで触れていると、幅 2 の窓が通れず
 * 開始から主の間までの道が切れるため。判定は埋める前の格子で行う（連鎖して壁が崩れるのを避ける）。穴は触らない
 */
function fillPinches(g: Grid): void {
  const before = g.cells.slice();
  for (let y = 1; y < g.h - 2; y++) {
    for (let x = 1; x < g.w - 2; x++) {
      const a = y * g.w + x;
      const cells = [a, a + 1, a + g.w, a + g.w + 1];
      const wall = cells.filter((i) => before[i] === Cell.Wall);
      const floors = cells.filter((i) => before[i] === Cell.Floor);
      if (wall.length === 1 && floors.length === 3) g.cells[wall[0] ?? a] = Cell.Floor;
    }
  }
}
