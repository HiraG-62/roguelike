/**
 * 階の型「島と桟道」（isle）。穴（海）の中に Voronoi の区画で島を作り、細い桟道（穴の上の床）で結ぶ。
 * 島 = 1 つの部屋（所属タイルは島の床そのもの）なので、島どうしを分ける水路が部屋の間隔になり、
 * 扉になるのは桟道の端だけ（島の縁に接する、島に属さない床は桟道しか無い）。
 * 「多島」（小さな島がたくさん・水路は細い）と「大島」（大きな島が少し・水路は広い）の 2 系統。
 * 見本（docs/ideas/previews/map-preview.html の genIslands）の移植。数値は data/balance/world/MAP_LAYOUT/isle.json。
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { NEIGHBORS_4 } from "../regions";
import { addLoops, blob, connectAll, farthestPair, makeGrid, mstEdges, poisson, polyline, relax, sealBorder, voronoiCarve } from "./shapes";
import type { Grid, Vec, VoronoiSite } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.isle;

type Variant = typeof P.many;

/** 島の中心を置く範囲の余白（左 / 上 / 右 / 下。見本のまま） */
const MARGIN_LEFT = 4;
const MARGIN_TOP = 3.5;
const MARGIN_RIGHT = 5;
const MARGIN_BOTTOM = 4.5;
/** 島の中心を押し離す回数と、そのときの最小間隔の余裕（間隔 × これ） */
const RELAX_ITERS = 30;
const RELAX_SPACING = 1.08;
/** Voronoi の区画を床にする範囲（地図の縁から何マス内側か） */
const SEA_MARGIN = 2;
/** 桟道が折れるのに要る、両端の座標の差の最小（マス） */
const BEND_MIN_SPAN = 4;
/** 雑音の種のずらし（用途ごとに別の雑音を取る） */
const SEED_ISLAND = 7;
const SEED_STONE = 9;
/** 飛び石の縁の揺れ */
const STONE_AMP = 0.25;
/** 飛び石を置く範囲の余白（マス） */
const STONE_MARGIN = 3;

export const generateIsle: LayoutGenerator = (rng, frame) => {
  const { width: w, height: h, unit: u, countMul, noiseSeed } = frame;
  const variant = rng.next() < P.manyChance ? P.many : P.big;
  const g = makeGrid(w, h, Cell.Pit);
  sealBorder(g);

  const sites = placeIslands(rng, variant, frame);
  if (sites.length < 2) return null;
  const gap = (variant.gapMin + variant.gapVar * rng.next()) * u;
  const owner = voronoiCarve(g, sites, gap, noiseSeed + SEED_ISLAND, P.edge, (x, y) => x >= SEA_MARGIN && y >= SEA_MARGIN && x <= w - 1 - SEA_MARGIN && y <= h - 1 - SEA_MARGIN);

  fillPockets(g, owner);

  const loops = Math.round((P.loopMin + Math.floor(rng.next() * P.loopVar)) * countMul);
  const edges = addLoops(sites, mstEdges(sites), loops, variant.spacing * P.loopLen * u);
  for (const [a, b] of edges) {
    const from = sites[a];
    const to = sites[b];
    if (from && to) layPlank(rng, g, from, to);
  }
  scatterStones(rng, g, frame);

  connectAll(g, P.keepFragment);
  restoreSea(g);

  const pair = farthestPair(g, sites);
  if (!pair) return null;
  const nodes = islandNodes(g, sites, owner, pair);
  return { cells: g.cells, shallow: new Uint8Array(w * h), nodes } satisfies LayoutDraft;
};

/** 島の中心を Poisson で置いて押し離し、半径を振る */
function placeIslands(rng: Rng, variant: Variant, frame: LayoutFrame): VoronoiSite[] {
  const { width: w, height: h, unit: u, countMul } = frame;
  const spacing = variant.spacing * u;
  const x1 = w - MARGIN_RIGHT;
  const y1 = h - MARGIN_BOTTOM;
  const pts = poisson(rng, spacing, MARGIN_LEFT, MARGIN_TOP, x1, y1, Math.round(variant.maxCount * countMul));
  relax(pts, RELAX_ITERS, spacing * RELAX_SPACING, MARGIN_LEFT, MARGIN_TOP, x1, y1);
  return pts.map((p) => ({ x: p.x, y: p.y, r: (variant.radiusMin + variant.radiusVar * rng.next()) * u }));
}

/**
 * 海につながらない穴（島の縁の雑音でできた島の中の欠け）を床にして、囲んでいる島のものにする。
 * 残しておくと、そこを桟道が通ったとき「島に属さない床」が島の内側にでき、島の中に扉ができてしまう
 */
function fillPockets(g: Grid, owner: Int16Array): void {
  const sea = new Uint8Array(g.cells.length);
  const stack: number[] = [];
  const seed = (x: number, y: number): void => {
    const i = y * g.w + x;
    if (g.cells[i] !== Cell.Pit || sea[i]) return;
    sea[i] = 1;
    stack.push(i);
  };
  for (let x = 1; x < g.w - 1; x++) {
    seed(x, 1);
    seed(x, g.h - 2);
  }
  for (let y = 1; y < g.h - 1; y++) {
    seed(1, y);
    seed(g.w - 2, y);
  }
  while (stack.length > 0) {
    const i = stack.pop() ?? 0;
    const x = i % g.w;
    const y = Math.floor(i / g.w);
    for (const [dx, dy] of NEIGHBORS_4) seed(x + dx, y + dy);
  }
  const pockets: number[] = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === Cell.Pit && !sea[i]) pockets.push(i);
  let pending = pockets;
  // 縁から内側へ、囲んでいる島の所属を伝える（欠けは小さいので数回で終わる）
  while (pending.length > 0) {
    const next: number[] = [];
    for (const i of pending) {
      const x = i % g.w;
      const y = Math.floor(i / g.w);
      const id = NEIGHBORS_4.map(([dx, dy]) => owner[(y + dy) * g.w + x + dx] ?? -1).find((o) => o >= 0);
      if (id === undefined) {
        next.push(i);
        continue;
      }
      owner[i] = id;
      g.cells[i] = Cell.Floor;
    }
    if (next.length === pending.length) return; // どの島にも接しない穴は残す
    pending = next;
  }
}

/** 桟道: 島の中心から中心へ直線か、1 回だけ折れる線（板の道らしく）。穴の上も島の上も床にする */
function layPlank(rng: Rng, g: Grid, a: Vec, b: Vec): void {
  const bendable = Math.abs(a.x - b.x) > BEND_MIN_SPAN && Math.abs(a.y - b.y) > BEND_MIN_SPAN;
  const bent = bendable && rng.next() < P.bendChance;
  if (!bent) {
    polyline(g, [a, b], P.plankRadius, Cell.Floor);
    return;
  }
  const corner = rng.next() < 0.5 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  polyline(g, [a, corner, b], P.plankRadius, Cell.Floor);
}

/** 飛び石の小島（海にだけ。島に触れないよう離す）。小さいものは connectAll が海に戻し、残ったものは桟道でつながる */
function scatterStones(rng: Rng, g: Grid, frame: LayoutFrame): void {
  const count = Math.round(P.stoneCount * frame.countMul);
  for (let k = 0; k < count; k++) {
    const x = STONE_MARGIN + rng.next() * (g.w - STONE_MARGIN * 2);
    const y = STONE_MARGIN + rng.next() * (g.h - STONE_MARGIN * 2);
    const r = P.stoneRadiusMin + P.stoneRadiusVar * rng.next();
    if (floorNear(g, x, y, r + P.stoneClear)) continue;
    blob(g, x, y, r, frame.noiseSeed + SEED_STONE, STONE_AMP, Cell.Floor, { only: Cell.Pit });
  }
}

/** (x, y) から radius マス以内（正方形）に床があるか */
function floorNear(g: Grid, x: number, y: number, radius: number): boolean {
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(g.w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(g.h - 1, Math.ceil(y + radius));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) if (g.cells[yy * g.w + xx] === Cell.Floor) return true;
  }
  return false;
}

/** connectAll が小さな欠片を埋めた壁を、海（穴）に戻す。島の外は岩ではなく海だけ（地図の縁の壁は finalize が閉じる） */
function restoreSea(g: Grid): void {
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      if (g.cells[i] === Cell.Wall) g.cells[i] = Cell.Pit;
    }
  }
}

/** 島ごとのノード。所属タイルは島の床（水路に区切られているので他の島とは接しない）。開始と主の間は歩いて最も遠い 2 島 */
function islandNodes(g: Grid, sites: readonly VoronoiSite[], owner: Int16Array, pair: readonly [number, number]): LayoutNode[] {
  const tiles: number[][] = sites.map(() => []);
  for (let i = 0; i < owner.length; i++) {
    const k = owner[i] ?? -1;
    if (k >= 0 && g.cells[i] === Cell.Floor) tiles[k]?.push(i);
  }
  const [start, lord] = pair;
  const nodes: LayoutNode[] = [];
  sites.forEach((site, k) => {
    const own = tiles[k] ?? [];
    if (own.length === 0) return;
    nodes.push({ x: site.x, y: site.y, role: k === start ? "start" : k === lord ? "lord" : "room", grow: 0, tiles: own });
  });
  return nodes;
}
