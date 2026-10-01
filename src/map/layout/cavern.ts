/**
 * 階の型「大洞窟」（cavern）。大広間（楕円 1〜2 個）と衛星の小洞を先に置き、通り道を芯として固定したまま
 * セルオートマトンで縁を育て、広間の中に岩の島（遮蔽物）を置く。見本 genCavern（docs/ideas/previews/map-preview.html）の移植。
 * - 拡縮（map-gen-impl.md 2-4）: 長さは frame.unit 倍、小洞とループの個数は frame.countMul 倍、道幅は据え置き。
 *   広間の中の岩の島は広間の面積（unit²）に比例させて密度を保つ
 * - 決定性（2-5）: 乱数は渡された rng だけ、雑音は frame.noiseSeed。距離は Math.sqrt
 * - 部屋（ノード）= 広間と小洞。開始と主の間は、完成した地図の上で歩く距離が最も遠い 2 つのうち、大きい方を主の間にする
 * 数値は data/balance/world/MAP_LAYOUT/cavern.json
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { addLoops, blob, clamp, connectAll, farthestPair, makeGrid, mstEdges, poisson, polyline, sealBorder, tidy, vnoise, wander, type Grid, type Vec } from "./shapes";
import { Cell, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.cavern;

/** 地図の端から広間の中心までに空ける余白（タイル） */
const HALL_EDGE_PAD = 2;
/** 小洞を置く範囲の外周の余白（タイル） */
const SAT_EDGE_PAD = 4;
/** 小洞が広間の縁にかからないよう、広間の楕円の距離（1 = 縁）がこれ未満の所には置かない */
const SAT_HALL_CLEAR = 1.25;

/** 広間の縁を揺らす雑音（楕円の距離に足す）の周期と振れ幅 */
const WOBBLE_PERIOD = 5;
const WOBBLE_AMP = 0.4;
/** 広間: 楕円の距離がこれ未満は必ず床、これ未満は確率 HALL_EDGE_PROB で床 */
const HALL_CORE = 0.62;
const HALL_EDGE = 1.2;
const HALL_EDGE_PROB = 0.64;
/** 小洞: 半径に対する距離がこれ未満は必ず床、これ未満は確率 SAT_EDGE_PROB で床 */
const SAT_CORE = 0.8;
const SAT_EDGE = 1.6;
const SAT_EDGE_PROB = 0.58;
/** どこでもない所が最初に床になる確率 / 通り道のそば（PATH_NEAR 以内）の確率 */
const BASE_PROB = 0.2;
const PATH_NEAR_PROB = 0.5;
/** 通り道のそばとみなす半径（タイル。道幅と同じく据え置き） */
const PATH_NEAR = 3.2;
/** 通り道の蛇行（辺の長さに対するずれの割合）と細分回数 */
const PATH_WIG = 0.18;
const PATH_WANDER_DEPTH = 3;
/** セルオートマトン: 回数と、壁が増える・残る閾値（旧洞窟と同じ） */
const CA_STEPS = 4;
const CA_BIRTH = 5;
const CA_SURVIVE = 4;
/** 岩の島の縁の揺れの割合。島を置く位置は広間の中心からの割合（半径に対して） */
const ISLAND_AMP = 0.3;
const ISLAND_NEAR = 0.25;
const ISLAND_SPAN = 0.4;
/** 岩の島の雑音の種を noiseSeed からずらす量 */
const WOBBLE_SEED_SHIFT = 1;
const ISLAND_SEED_SHIFT = 50;
/** 広間を最も傾けた楕円の外接を取る余裕（タイル） */
const BBOX_PAD = 1;

interface Hall extends Vec {
  rx: number;
  ry: number;
  cos: number;
  sin: number;
}

interface Satellite extends Vec {
  r: number;
}

export const generateCavern: LayoutGenerator = (rng, frame) => {
  const halls = placeHalls(rng, frame);
  const sats = placeSatellites(rng, frame, halls);
  const pts: Vec[] = [...halls, ...sats];
  const edges = addLoops(pts, mstEdges(pts), Math.round(P.loopCount * frame.countMul), P.loopMaxLen * frame.unit);

  const { force, prob } = fieldOf(frame, halls, sats);
  carvePaths(rng, frame, pts, edges, force, prob);

  const g = makeGrid(frame.width, frame.height, Cell.Wall);
  for (let y = 1; y < frame.height - 1; y++) {
    for (let x = 1; x < frame.width - 1; x++) {
      const i = y * frame.width + x;
      g.cells[i] = force[i] || rng.next() < (prob[i] ?? 0) ? Cell.Floor : Cell.Wall;
    }
  }
  for (let k = 0; k < CA_STEPS; k++) {
    g.cells = smoothStep(g);
    for (let i = 0; i < force.length; i++) if (force[i]) g.cells[i] = Cell.Floor;
  }
  placeIslands(rng, frame, g, halls);
  sealBorder(g);
  tidy(g);
  connectAll(g, P.minKeep);

  const nodes = nodesOf(frame, g, halls, sats);
  if (!nodes) return null;
  return { cells: g.cells, shallow: new Uint8Array(frame.width * frame.height), nodes };
};

/** 広間: 確率で 1 つ（大）か 2 つ（中）。楕円の向きの cos / sin は 1 回だけ求めて持つ（セルごとに求めない） */
function placeHalls(rng: Rng, frame: LayoutFrame): Hall[] {
  const { width: w, height: h, unit: u } = frame;
  if (rng.next() < P.singleHallChance) {
    const rx = (P.singleRx + rng.next() * P.singleRxSpan) * u;
    const ry = (P.singleRy + rng.next() * P.singleRySpan) * u;
    const x = clamp(w * (0.3 + rng.next() * 0.4), rx * 0.8 + 3, w - rx * 0.8 - 4);
    const y = h * (0.4 + rng.next() * 0.2);
    return [hallOf(x, y, rx, ry, (rng.next() - 0.5) * P.singleTilt)];
  }
  const axis = (rng.next() - 0.5) * P.pairAxisTilt;
  const dist = (P.pairDist + rng.next() * P.pairDistSpan) * u;
  const cx = w / 2 + (rng.next() - 0.5) * 6 * u;
  const cy = h / 2 + (rng.next() - 0.5) * 4 * u;
  const out: Hall[] = [];
  for (const sign of [-1, 1]) {
    const rx = (P.pairRx + rng.next() * P.pairRxSpan) * u;
    const ry = (P.pairRy + rng.next() * P.pairRySpan) * u;
    const x = clamp(cx + sign * Math.cos(axis) * dist, rx + HALL_EDGE_PAD, w - rx - HALL_EDGE_PAD - 1);
    const y = clamp(cy + sign * Math.sin(axis) * dist * 0.6, ry + HALL_EDGE_PAD, h - ry - HALL_EDGE_PAD - 1);
    out.push(hallOf(x, y, rx, ry, (rng.next() - 0.5) * P.pairTilt));
  }
  return out;
}

function hallOf(x: number, y: number, rx: number, ry: number, ang: number): Hall {
  return { x, y, rx, ry, cos: Math.cos(ang), sin: Math.sin(ang) };
}

/** 楕円の中心からの距離（1 = 縁） */
function ellipseDist(h: Hall, x: number, y: number): number {
  const dx = x - h.x;
  const dy = y - h.y;
  const u = (dx * h.cos + dy * h.sin) / h.rx;
  const v = (-dx * h.sin + dy * h.cos) / h.ry;
  return Math.sqrt(u * u + v * v);
}

function placeSatellites(rng: Rng, frame: LayoutFrame, halls: readonly Hall[]): Satellite[] {
  const { width: w, height: h, unit: u } = frame;
  const maxN = Math.max(1, Math.round(P.satMax * frame.countMul));
  const spots = poisson(rng, P.satMinDist * u, SAT_EDGE_PAD, SAT_EDGE_PAD, w - SAT_EDGE_PAD - 1, h - SAT_EDGE_PAD - 1, maxN, (p) =>
    halls.some((hall) => ellipseDist(hall, p.x, p.y) < SAT_HALL_CLEAR),
  );
  return spots.map((p) => ({ x: p.x, y: p.y, r: (P.satRadius + rng.next() * P.satRadiusSpan) * u }));
}

/** 広間と小洞の周りの「必ず床（force）」と「床になる確率（prob）」。塊ごとの外接矩形の中だけを回す */
function fieldOf(frame: LayoutFrame, halls: readonly Hall[], sats: readonly Satellite[]): { force: Uint8Array; prob: Float32Array } {
  const { width: w, height: h, noiseSeed } = frame;
  const force = new Uint8Array(w * h);
  const prob = new Float32Array(w * h).fill(BASE_PROB);
  const seed = noiseSeed + WOBBLE_SEED_SHIFT;
  const wobble = (x: number, y: number): number => (vnoise(x, y, WOBBLE_PERIOD, seed) - 0.5) * WOBBLE_AMP;
  const raise = (i: number, p: number): void => {
    if (p > (prob[i] ?? 0)) prob[i] = p;
  };
  for (const hall of halls) {
    const reach = Math.max(hall.rx, hall.ry) * (HALL_EDGE + WOBBLE_AMP / 2) + BBOX_PAD;
    forBox(w, h, hall.x, hall.y, reach, (x, y, i) => {
      const e = ellipseDist(hall, x + 0.5, y + 0.5) + wobble(x, y);
      if (e < HALL_CORE) force[i] = 1;
      else if (e < HALL_EDGE) raise(i, HALL_EDGE_PROB);
    });
  }
  for (const sat of sats) {
    const reach = sat.r * (SAT_EDGE + WOBBLE_AMP / 2) + BBOX_PAD;
    forBox(w, h, sat.x, sat.y, reach, (x, y, i) => {
      const dx = x + 0.5 - sat.x;
      const dy = y + 0.5 - sat.y;
      const d = Math.sqrt(dx * dx + dy * dy) / sat.r + wobble(x, y);
      if (d < SAT_CORE) force[i] = 1;
      else if (d < SAT_EDGE) raise(i, SAT_EDGE_PROB);
    });
  }
  return { force, prob };
}

/** (cx, cy) を中心に半径 reach の外接矩形のうち、外周を除く内側のマスを走査する */
function forBox(w: number, h: number, cx: number, cy: number, reach: number, visit: (x: number, y: number, i: number) => void): void {
  const x0 = Math.max(1, Math.floor(cx - reach));
  const x1 = Math.min(w - 2, Math.ceil(cx + reach));
  const y0 = Math.max(1, Math.floor(cy - reach));
  const y1 = Math.min(h - 2, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(x, y, y * w + x);
}

/** 通り道（広間と小洞を結ぶ蛇行した道）を芯にする: 道の上は必ず床、そばは床になりやすい */
function carvePaths(rng: Rng, frame: LayoutFrame, pts: readonly Vec[], edges: readonly [number, number][], force: Uint8Array, prob: Float32Array): void {
  const path = makeGrid(frame.width, frame.height, Cell.Wall);
  const near = makeGrid(frame.width, frame.height, Cell.Wall);
  for (const [a, b] of edges) {
    const pa = pts[a];
    const pb = pts[b];
    if (!pa || !pb) continue;
    const way = wander(rng, pa, pb, PATH_WIG, PATH_WANDER_DEPTH);
    polyline(path, way, P.pathRadius + rng.next() * P.pathRadiusSpan, Cell.Floor);
    polyline(near, way, PATH_NEAR, Cell.Floor);
  }
  for (let i = 0; i < force.length; i++) {
    if (path.cells[i] === Cell.Floor) force[i] = 1;
    else if (near.cells[i] === Cell.Floor && PATH_NEAR_PROB > (prob[i] ?? 0)) prob[i] = PATH_NEAR_PROB;
  }
}

/**
 * セルオートマトン 1 手（shapes の caStep と同じ規則）。caStep は 8 近傍を配列の分解で回すので広い地図では 1 手 10ms を超える。
 * ここは穴が無く（0 = 床・1 = 壁だけ）外周が壁なので、近傍の合計をそのまま壁の数にして展開した足し算で済ませる。外周は壁のまま
 */
function smoothStep(g: Grid): Uint8Array {
  const { w, h, cells } = g;
  const out = new Uint8Array(cells.length).fill(Cell.Wall);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const up = i - w;
      const down = i + w;
      const walls =
        (cells[up - 1] ?? 1) + (cells[up] ?? 1) + (cells[up + 1] ?? 1) + (cells[i - 1] ?? 1) + (cells[i + 1] ?? 1) + (cells[down - 1] ?? 1) + (cells[down] ?? 1) + (cells[down + 1] ?? 1);
      const wall = cells[i] === Cell.Wall ? walls >= CA_SURVIVE : walls >= CA_BIRTH;
      out[i] = wall ? Cell.Wall : Cell.Floor;
    }
  }
  return out;
}

/** 広間の中の岩の島（遮蔽物）。数は広間の面積（unit²）に比例 */
function placeIslands(rng: Rng, frame: LayoutFrame, g: Grid, halls: readonly Hall[]): void {
  const countMul = frame.unit * frame.unit;
  for (const hall of halls) {
    const n = Math.round((P.islandCount + Math.floor(rng.next() * P.islandCountSpan)) * countMul);
    for (let k = 0; k < n; k++) {
      const a = rng.next() * Math.PI * 2;
      const rr = ISLAND_NEAR + rng.next() * ISLAND_SPAN;
      const r = (P.islandRadius + rng.next() * P.islandRadiusSpan) * frame.unit;
      blob(g, hall.x + Math.cos(a) * hall.rx * rr, hall.y + Math.sin(a) * hall.ry * rr, r, frame.noiseSeed + ISLAND_SEED_SHIFT + k, ISLAND_AMP, Cell.Wall);
    }
  }
}

/** ノード = 広間と小洞。歩く距離が最も遠い 2 つのうち、大きい方を主の間、もう一方を開始にする。選べなければ null */
function nodesOf(frame: LayoutFrame, g: Grid, halls: readonly Hall[], sats: readonly Satellite[]): LayoutNode[] | null {
  const sizes = [...halls.map((hall) => Math.sqrt(hall.rx * hall.ry)), ...sats.map((s) => s.r)];
  const pts: Vec[] = [...halls, ...sats];
  const pair = farthestPair(g, pts);
  if (!pair) return null;
  const [a, b] = pair;
  const lord = (sizes[a] ?? 0) >= (sizes[b] ?? 0) ? a : b;
  const start = lord === a ? b : a;
  const lordGrow = Math.ceil(frame.lordRadius * P.lordGrowMul);
  return pts.map((p, i) => {
    const hall = halls[i];
    const grow = hall ? Math.round((hall.rx + hall.ry) * P.hallGrowMul) : Math.ceil((sizes[i] ?? 0) * P.satGrowMul);
    const role = i === lord ? "lord" : i === start ? "start" : "room";
    return { x: p.x, y: p.y, role, grow: role === "lord" ? Math.max(grow, lordGrow) : grow };
  });
}
