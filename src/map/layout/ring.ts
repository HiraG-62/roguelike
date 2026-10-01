/**
 * 階の型「環状」（ring）。大岩か池（池は穴）の芯を輪の道が回り、輪の外に岩の帯を残して外側を Voronoi の部屋に割る。
 * 芯を突っ切る近道（岩はトンネル、池は桟道）と、岩の芯の祠。見本は docs/ideas/previews/map-preview.html の genRing。
 * 拡縮（docs/ideas/map-gen-impl.md 2-4）: 芯の数は countMul で 1 → 2（8 の字）→ 3（鎖）、芯・岩の帯・部屋の長さは unit 倍、
 * 部屋の数は countMul 倍。道幅（輪・戸口・近道）は据え置き。数値は data/balance/world/MAP_LAYOUT/ring.json
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { type Grid, type Vec, type VoronoiSite, clamp, connectAll, disc, farthestPair, line, makeGrid, mstEdges, poisson, sealBorder, vnoise, voronoiCarve } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.ring;

/** 雑音の種の足し方（frame.noiseSeed に足す。型の中で重ならないように） */
const SEED_CORE_EDGE = 2;
const SEED_BAND = 3;
const SEED_ROOMS = 30;
/** 雑音の周期（タイル。縁の細かい揺れなので unit 倍しない） */
const CORE_NOISE_PERIOD = 6;
const BAND_NOISE_PERIOD = 4;
/** 芯の数の上限（鎖） */
const MAX_CORES = 3;
/** 近道・輪へ降りる口の道筋を歩く刻み（タイル） */
const WALK_STEP = 0.5;
/** 戸口が輪や芯を横切らないかの標本の間隔（タイル） */
const CROSS_STEP = 1;
/** 輪に近い部屋がこれ未満なら、全部が輪へ降りる口を持つ（少ないと外の部屋が孤立しやすい） */
const MIN_NEAR_FOR_RANDOM = 4;
/** 地図の縁と輪の外縁の最小の間（タイル） */
const EDGE_MARGIN = 3;
/** 部屋の種が最低限要る数（これ未満は作り直し） */
const MIN_SITES = 4;
/** 主の間に選べる部屋の下限 = π r² × (validate.lordFill + この余裕)。finalize で取り合いのマスが外れても検査に通るように */
const LORD_FILL_MARGIN = 0.15;
/** 祠の部屋として数える最小のタイル数（これ未満なら部屋にしない） */
const SHRINE_MIN_TILES = 12;
/** 池の芯でない所の岩・池を分ける、芯の縁からの距離の下限（芯の中 = 負） */
const INSIDE_CORE = 0;

interface Core {
  x: number;
  y: number;
  rx: number;
  ry: number;
  cos: number;
  sin: number;
}

interface RingLayout {
  cores: Core[];
  pond: boolean;
  /** 輪の道の幅（タイル。芯の縁から外へ） */
  bandWidth: number;
  /** 岩の帯の外縁（芯の縁からの距離）。この外が部屋 */
  outer: number;
}

function param(values: readonly number[], index: number): number {
  return values[index] ?? values[values.length - 1] ?? 0;
}

/** 芯の数（1 → 2 の 8 の字 → 3 の鎖）。countMul × coreDensity の整数部に、小数部の分だけ確率（roll = 乱数 0..1）で 1 つ足す */
export function ringCoreCount(countMul: number, roll: number): number {
  return clamp(Math.floor(countMul * P.coreDensity + roll), 1, MAX_CORES);
}

/** 芯の縁からの符号付きの距離の近似（負 = 芯の中）。楕円の半径 rho との差 */
function coreDistance(c: Core, px: number, py: number): number {
  const dx = px - c.x;
  const dy = py - c.y;
  const u = dx * c.cos + dy * c.sin;
  const w = -dx * c.sin + dy * c.cos;
  const r = Math.sqrt(u * u + w * w) || 0.001;
  const a = u / r / c.rx;
  const b = w / r / c.ry;
  return r - 1 / Math.sqrt(a * a + b * b);
}

function nearestCore(cores: readonly Core[], x: number, y: number): Core | undefined {
  let best: Core | undefined;
  let bestD = Infinity;
  for (const c of cores) {
    const d = coreDistance(c, x, y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** 芯の列（1〜3 個を横に並べる）と輪の幅・岩の帯を決める。地図に収まらなければ null */
function planRing(rng: Rng, frame: LayoutFrame): RingLayout | null {
  const { width: w, height: h, unit, countMul } = frame;
  const count = ringCoreCount(countMul, rng.next());
  const pond = rng.chance(P.pondChance);
  let cx = w / 2 + (rng.next() - 0.5) * P.centerJitterX * w;
  const cy = h / 2 + (rng.next() - 0.5) * P.centerJitterY * h;
  const bandWidth = P.bandWidth + rng.next() * P.bandWidthSpread;
  const rockWidth = (P.rockWidth + rng.next() * P.rockWidthSpread) * unit;
  const tilt = (rng.next() - 0.5) * P.coreTilt * unit;
  const k = count - 1;

  const shapes = Array.from({ length: count }, () => ({
    rx: (param(P.coreRxMin, k) + rng.next() * param(P.coreRxSpread, k)) * unit,
    ry: (param(P.coreRyMin, k) + rng.next() * param(P.coreRySpread, k)) * unit,
    ang: (rng.next() - 0.5) * param(P.coreAngle, k),
  }));
  // 芯の縁どうしの間は輪の幅の約 2 倍（輪が接して 8 の字・鎖になる）
  const offsets: number[] = [0];
  for (let i = 1; i < count; i++) {
    const a = shapes[i - 1];
    const b = shapes[i];
    if (!a || !b) return null;
    const gap = bandWidth * (P.coreGapMul + rng.next() * P.coreGapSpread);
    offsets.push((offsets[i - 1] ?? 0) + a.rx + b.rx + gap);
  }
  const first = shapes[0];
  const last = shapes[count - 1];
  if (!first || !last) return null;
  const span = (offsets[count - 1] ?? 0) + first.rx + last.rx;
  const half = span / 2 + bandWidth + EDGE_MARGIN;
  if (half * 2 > w) return null;
  cx = clamp(cx, half, w - half);
  const left = cx - span / 2 + first.rx;
  const reachY = Math.max(...shapes.map((s) => s.ry)) + bandWidth + EDGE_MARGIN + Math.abs(tilt);
  if (reachY * 2 > h) return null;
  const cyClamped = clamp(cy, reachY, h - reachY);

  const cores: Core[] = shapes.map((s, i) => ({
    x: left + (offsets[i] ?? 0),
    y: cyClamped + (i - (count - 1) / 2) * tilt,
    rx: s.rx,
    ry: s.ry,
    cos: Math.cos(s.ang),
    sin: Math.sin(s.ang),
  }));
  return { cores, pond, bandWidth, outer: bandWidth + rockWidth };
}

/** 各マスの、芯の縁からの距離（負 = 芯の中）。縁は雑音で少し揺らす */
function distanceField(frame: LayoutFrame, cores: readonly Core[]): Float32Array {
  const { width: w, height: h, noiseSeed } = frame;
  const field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d = Infinity;
      for (const c of cores) d = Math.min(d, coreDistance(c, x + 0.5, y + 0.5));
      field[y * w + x] = d + (vnoise(x, y, CORE_NOISE_PERIOD, noiseSeed + SEED_CORE_EDGE) - 0.5) * P.coreEdgeNoise;
    }
  }
  return field;
}

function carveBand(g: Grid, field: Float32Array, bandWidth: number, noiseSeed: number): void {
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const d = field[y * g.w + x] ?? 0;
      if (d >= INSIDE_CORE && d < bandWidth + (vnoise(x, y, BAND_NOISE_PERIOD, noiseSeed + SEED_BAND) - 0.5) * P.bandNoise) g.cells[y * g.w + x] = Cell.Floor;
    }
  }
}

/** 部屋の種から芯の中心の側へ、輪の道の中ほどまで歩いた点 */
function ringEntry(room: Vec, core: Core, at: (x: number, y: number) => number, bandWidth: number): Vec {
  const dx = core.x - room.x;
  const dy = core.y - room.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let t = 0;
  while (t < len && at(room.x + (dx / len) * t, room.y + (dy / len) * t) > bandWidth * 0.5) t += WALK_STEP;
  return { x: room.x + (dx / len) * t, y: room.y + (dy / len) * t };
}

/**
 * 外側の部屋の戸口: 輪に近い部屋は輪へ降りる口を持ち、部屋どうしは最小全域木で戸口をつなぐ。
 * 輪や芯を横切る辺は彫らず、代わりに両端の部屋が輪へ降りる口を持つ（つなぎ直し connectAll の細い道に頼らない）。
 * 輪へ降りる口を持つ部屋どうしの戸口は省けることがある（輪でつながるので）
 */
function carveDoors(rng: Rng, g: Grid, ring: RingLayout, sites: readonly VoronoiSite[], at: (x: number, y: number) => number): void {
  const spoked = new Set<number>();
  const spoke = (i: number): void => {
    const s = sites[i];
    if (!s || spoked.has(i)) return;
    const core = nearestCore(ring.cores, s.x, s.y);
    if (!core) return;
    const p = ringEntry(s, core, at, ring.bandWidth);
    line(g, s.x, s.y, p.x, p.y, P.spokeRadius, Cell.Floor);
    spoked.add(i);
  };
  const near: number[] = [];
  sites.forEach((s, i) => {
    if (at(s.x, s.y) < ring.outer + s.r + P.nearSlack) near.push(i);
  });
  for (const i of near) if (rng.next() < P.spokeChance || near.length < MIN_NEAR_FOR_RANDOM) spoke(i);
  for (const [ia, ib] of mstEdges(sites)) {
    const a = sites[ia];
    const b = sites[ib];
    if (!a || !b) continue;
    if (crossesRing(a, b, ring.outer - 0.5, at)) {
      spoke(ia);
      spoke(ib);
      continue;
    }
    if (spoked.has(ia) && spoked.has(ib) && rng.next() < P.linkSkipChance) continue;
    line(g, a.x, a.y, b.x, b.y, P.linkRadius, Cell.Floor);
  }
}

function crossesRing(a: Vec, b: Vec, limit: number, at: (x: number, y: number) => number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / CROSS_STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (at(a.x + dx * t, a.y + dy * t) < limit) return true;
  }
  return false;
}

/** 芯を突っ切る近道（芯ごとに 1〜2 本。岩ならトンネル、池なら桟道）。芯の中心から両側へ輪の道の中ほどまで */
function carveShortcuts(rng: Rng, g: Grid, ring: RingLayout, at: (x: number, y: number) => number): void {
  for (const core of ring.cores) {
    const count = 1 + (rng.next() < P.shortcutExtraChance ? 1 : 0);
    const reach = Math.max(core.rx, core.ry) * 2 + ring.bandWidth * 2;
    for (let s = 0; s < count; s++) {
      const a = rng.next() * Math.PI + (rng.next() - 0.5) * 0.6 + (s * Math.PI) / 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      let t0 = 0;
      let t1 = 0;
      while (t0 < reach && at(core.x - ux * t0, core.y - uy * t0) < ring.bandWidth * 0.5) t0 += WALK_STEP;
      while (t1 < reach && at(core.x + ux * t1, core.y + uy * t1) < ring.bandWidth * 0.5) t1 += WALK_STEP;
      line(g, core.x - ux * t0, core.y - uy * t0, core.x + ux * t1, core.y + uy * t1, P.shortcutRadius, Cell.Floor);
    }
  }
}

/** 岩の芯の祠（開けた円）を作り、その床を部屋の所属タイルにしたノードを返す */
function carveShrines(rng: Rng, g: Grid, ring: RingLayout, unit: number): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  if (ring.pond) return nodes;
  const r = P.shrineRadius * unit;
  for (const core of ring.cores) {
    if (!(rng.next() < P.shrineChance)) continue;
    disc(g, core.x, core.y, r, Cell.Floor);
    const tiles: number[] = [];
    const rr = r * r;
    for (let y = Math.max(1, Math.floor(core.y - r)); y <= Math.min(g.h - 2, Math.ceil(core.y + r)); y++) {
      for (let x = Math.max(1, Math.floor(core.x - r)); x <= Math.min(g.w - 2, Math.ceil(core.x + r)); x++) {
        const dx = x + 0.5 - core.x;
        const dy = y + 0.5 - core.y;
        if (dx * dx + dy * dy < rr && g.cells[y * g.w + x] === Cell.Floor) tiles.push(y * g.w + x);
      }
    }
    if (tiles.length >= SHRINE_MIN_TILES) nodes.push({ x: core.x, y: core.y, role: "room", grow: 0, tiles });
  }
  return nodes;
}

function fillPond(g: Grid, field: Float32Array): void {
  for (let i = 0; i < g.cells.length; i++) {
    if ((field[i] ?? 0) < INSIDE_CORE && g.cells[i] === Cell.Wall) g.cells[i] = Cell.Pit;
  }
}

/** 部屋の種ごとの所属タイル（昇順） */
function tilesBySite(owner: Int16Array, count: number): number[][] {
  const out: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < owner.length; i++) {
    const id = owner[i] ?? -1;
    if (id >= 0) out[id]?.push(i);
  }
  return out;
}

/** 開始と主の間: 主の間に足りる広さの部屋のうち、歩く距離が最も遠い 2 つ（輪をはさんで向かい合いやすい） */
function pickStartAndLord(g: Grid, sites: readonly VoronoiSite[], tiles: readonly number[][], lordRadius: number): [number, number] | null {
  const need = Math.ceil(Math.PI * lordRadius * lordRadius * (MAP_LAYOUT.validate.lordFill + LORD_FILL_MARGIN));
  const eligible: number[] = [];
  sites.forEach((_, i) => {
    if ((tiles[i]?.length ?? 0) >= need) eligible.push(i);
  });
  const pair = farthestPair(
    g,
    eligible.map((i) => sites[i] ?? { x: -1, y: -1 }),
  );
  if (!pair) return null;
  const a = eligible[pair[0]];
  const b = eligible[pair[1]];
  if (a === undefined || b === undefined) return null;
  return a < b ? [a, b] : [b, a];
}

export const generateRing: LayoutGenerator = (rng, frame) => {
  const { width: w, height: h, unit, countMul } = frame;
  const ring = planRing(rng, frame);
  if (!ring) return null;
  const g = makeGrid(w, h, Cell.Wall);
  const field = distanceField(frame, ring.cores);
  const at = (x: number, y: number): number => field[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)] ?? 0;

  carveBand(g, field, ring.bandWidth, frame.noiseSeed);

  // 輪の外: 岩の帯の外を Voronoi で部屋に割る。所属タイルはそのまま部屋のノードに渡す
  const margin = P.roomMargin;
  const points = poisson(rng, P.roomMinDist * unit, margin, margin, w - margin - 1, h - margin - 1, Math.round(P.roomCount * countMul), (p) => at(p.x, p.y) < ring.outer + P.roomAvoidMargin);
  if (points.length < MIN_SITES) return null;
  const sites: VoronoiSite[] = points.map((p) => ({ x: p.x, y: p.y, r: (P.roomRadius + rng.next() * P.roomRadiusSpread) * unit }));
  const owner = voronoiCarve(g, sites, P.roomWallGap, frame.noiseSeed + SEED_ROOMS, P.roomEdgeAmp, (x, y) => (field[y * w + x] ?? 0) >= ring.outer);

  carveDoors(rng, g, ring, sites, at);
  carveShortcuts(rng, g, ring, at);
  const shrines = carveShrines(rng, g, ring, unit);
  if (ring.pond) fillPond(g, field);
  sealBorder(g);
  connectAll(g, P.minKeep);

  // つなぎ直しで埋められた小さな部屋の欠片は所属から外す
  const tiles = tilesBySite(owner, sites.length).map((mine) => mine.filter((t) => g.cells[t] === Cell.Floor));
  const pair = pickStartAndLord(g, sites, tiles, frame.lordRadius);
  if (!pair) return null;
  const nodes: LayoutNode[] = [];
  sites.forEach((s, i) => {
    const mine = tiles[i] ?? [];
    if (mine.length === 0) return;
    const role = i === pair[0] ? "start" : i === pair[1] ? "lord" : "room";
    nodes.push({ x: s.x, y: s.y, role, grow: 0, tiles: mine });
  });
  nodes.push(...shrines);
  return { cells: g.cells, shallow: new Uint8Array(w * h), nodes } satisfies LayoutDraft;
};
