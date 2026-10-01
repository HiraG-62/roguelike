/**
 * 階の型「掘り手の迷い道」（drunk）。開始から主の間へ 1 本目の掘り手（幅 2）を通し、以降は掘った所から壁へ向かって
 * 別の掘り手（幅 1 か 2。曲がり癖・直進癖は階ごと）を出して細道の網を作る。掘り手の終点にときどき溜まりを掘る。
 * 見本 genDrunk（docs/ideas/previews/map-preview.html）の移植。
 * - 拡縮（map-gen-impl.md 2-4）: 間隔・寿命・溜まりの半径は frame.unit 倍、目印・掘り手の試行・部屋の数は frame.countMul 倍、
 *   掘る幅（1 か 2）と床の目標の割合は据え置き
 * - 決定性（2-5）: 乱数は渡された rng だけ。距離は Math.sqrt。掘る順序は rng の消費順のとおり
 * - 部屋（ノード）= 開始・主の間と、溜まりのうち間隔を空けて選んだもの。細道は部屋に属さない通路になる
 * 数値は data/balance/world/MAP_LAYOUT/drunk.json
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { clamp, connectAll, makeGrid, poisson, sealBorder, tidy, type Grid, type Vec } from "./shapes";
import { Cell, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.drunk;

/** 4 方向（0 = 東・1 = 南・2 = 西・3 = 北。+1 が右回り）。dir ^ 1 ではなく (dir + 2) % 4 が逆向き */
const DIR_X = [1, 0, -1, 0] as const;
const DIR_Y = [0, 1, 0, -1] as const;
const DIR_COUNT = 4;

/** 開始・主の間を地図の端のどこに置くか: 端から空ける余白（タイル） */
const EDGE_PAD = 4;
/** 掘ってよい範囲の余白（これより外周側は掘らない） */
const DIG_PAD = 2;
/** 1 本目の掘り手の寿命（歩）と幅。行き先に着けば途中で止まる */
const MAIN_LIFE = 2000;
const MAIN_BRUSH = 2;
/** 向きの先読みで壁を確かめる距離（マス）: 近い方 / 遠い方 */
const LOOK_NEAR = 1;
const LOOK_MID = 3;
const OUT_NEAR = 2;
const OUT_FAR = 4;
/** 掘り手が行き先の方へ向きを直す確率（目印へ向かうとき） */
const AIM_CHANCE = 0.4;
/** 掘り手が既に掘った道へ入ったとき、合流として止まる確率 */
const JOIN_STOP_CHANCE = 0.75;
/** 合流を数え始める歩数（出発した場所の道を合流と見ないため） */
const JOIN_AFTER = 4;
/** 目印に着いたとみなす距離（マンハッタン） */
const ARRIVE_DIST = 2;
/** 溜まりの半径（小数）から掘る範囲の整数の幅を取るときの余裕（マス） */
const POOL_RANGE_PAD = 1;

/** 足し掘りする溜まりの場所探しの試行（部屋 1 つあたり） */
const ADD_POOL_TRIES = 30;

interface Pool extends Vec {
  r: number;
}

/** 掘りの状態。carved は掘ったマスの番号（枝の出発点を引く）、floor は掘った床の数 */
interface Dig {
  g: Grid;
  rng: Rng;
  carved: number[];
  floor: number;
  pools: Pool[];
  turnChance: number;
  /** 長さの倍率（frame.unit）。溜まりの半径に掛ける */
  unit: number;
}

export const generateDrunk: LayoutGenerator = (rng, frame) => {
  const { width: w, height: h, unit, countMul } = frame;
  const g = makeGrid(w, h, Cell.Wall);
  const edge = rng.int(0, DIR_COUNT - 1);
  const start = alongEdge(rng.next(), edge, w, h);
  const lord = alongEdge(rng.next(), edge ^ 1, w, h);
  const waypoints = poisson(rng, P.waypointMinDist * unit, EDGE_PAD, EDGE_PAD, w - EDGE_PAD - 1, h - EDGE_PAD - 1, Math.max(1, Math.round(P.waypointMax * countMul)));
  const target = (P.targetFloor + rng.next() * P.targetFloorSpan) * w * h;
  const wideChance = P.wideChance + rng.next() * P.wideChanceSpan;
  const dig: Dig = { g, rng, carved: [], floor: 0, pools: [], turnChance: P.turnChance + rng.next() * P.turnChanceSpan, unit };

  walk(dig, start.x, start.y, 0, MAIN_BRUSH, MAIN_LIFE, lord, false, P.poolChance);
  branchOut(dig, frame, waypoints, target, wideChance);
  // 開始と主の間の前だけ広げる（主の間は FLOOR_LORD.arenaRadius が入る広さ）。記録せず、ノードは別に作る
  pool(dig, start.x, start.y, P.startPool * unit, false);
  pool(dig, lord.x, lord.y, P.lordPool * unit, false);

  const rooms = pickRooms(dig, frame, start, lord);
  tidy(g);
  sealBorder(g);
  connectAll(g, P.minKeep);
  return { cells: g.cells, shallow: new Uint8Array(w * h), nodes: nodesOf(frame, start, lord, rooms) };
};

/** 端 edge（0 = 左・1 = 右・2 = 上・3 = 下）に沿った位置 t（0..1）。開始と主の間は反対の端に置く */
function alongEdge(t: number, edge: number, w: number, h: number): Vec {
  const y = EDGE_PAD + Math.floor(t * (h - 9));
  const x = EDGE_PAD + Math.floor(t * (w - 10));
  if (edge === 0) return { x: EDGE_PAD, y };
  if (edge === 1) return { x: w - 6, y };
  return edge === 2 ? { x, y: EDGE_PAD } : { x, y: h - 6 };
}

/** 掘った道の途中から壁の方へ枝の掘り手を出す。床が目標に届くか、試行の上限で止まる */
function branchOut(dig: Dig, frame: LayoutFrame, waypoints: readonly Vec[], target: number, wideChance: number): void {
  const { rng } = dig;
  const tries = Math.round(P.walkerMax * frame.countMul);
  for (let n = 0; n < tries && dig.floor < target; n++) {
    const origin = dig.carved[rng.int(0, dig.carved.length - 1)];
    if (origin === undefined) return;
    const ox = origin % frame.width;
    const oy = Math.floor(origin / frame.width);
    // 壁へ向かって掘り出す（4 方向のうち 2 マス先と 4 マス先が壁の向き）
    const outs = [0, 1, 2, 3].filter((d) => ahead(dig, ox, oy, d, OUT_NEAR) === Cell.Wall && ahead(dig, ox, oy, d, OUT_FAR) === Cell.Wall);
    if (outs.length === 0) continue;
    const pick = rng.next() < P.waypointChance && waypoints.length > 0 ? rng.pick(waypoints) : null;
    const dir = outs[rng.int(0, outs.length - 1)] ?? 0;
    const brush = rng.next() < wideChance ? 2 : 1;
    const life = Math.round((P.walkerLife + Math.floor(rng.next() * P.walkerLifeSpan)) * frame.unit);
    const goal = pick ? { x: Math.round(pick.x), y: Math.round(pick.y) } : null;
    walk(dig, ox, oy, dir, brush, life, goal, true, goal ? P.waypointPoolChance : P.poolChance);
  }
}

/**
 * 掘り手: 向きを保って進み、ときどき左右へ曲がる。前が既に道なら壁の側へ曲がり（広場にしない）、
 * それでも道へ出たら合流として止まる（ループになる）。終点に確率で溜まりを掘る
 */
function walk(dig: Dig, startX: number, startY: number, startDir: number, brush: number, life: number, goal: Vec | null, joinStop: boolean, poolChance: number): void {
  const { g, rng } = dig;
  let x = startX;
  let y = startY;
  let dir = startDir;
  for (let step = 0; step < life; step++) {
    digBrush(dig, x, y, brush);
    if (goal && Math.abs(x - goal.x) + Math.abs(y - goal.y) < ARRIVE_DIST) break;
    if (goal && rng.next() < AIM_CHANCE) dir = aimAt(rng, x, y, goal);
    else if (rng.next() < dig.turnChance) dir = (dir + (rng.next() < 0.5 ? 1 : 3)) % DIR_COUNT;
    if (!goal && ahead(dig, x, y, dir, LOOK_MID) === Cell.Floor) dir = turnToWall(dig, x, y, dir);
    if (ahead(dig, x, y, dir, LOOK_NEAR) < 0) dir = (dir + 2) % DIR_COUNT;
    const stepX = DIR_X[dir] ?? 0;
    const stepY = DIR_Y[dir] ?? 0;
    const nx = clamp(x + stepX, DIG_PAD, g.w - 4);
    const ny = clamp(y + stepY, DIG_PAD, g.h - 4);
    const joined = step > JOIN_AFTER && cellAt(g, nx, ny) === Cell.Floor && (brush === 1 || cellAt(g, clamp(nx + stepX, 0, g.w - 1), clamp(ny + stepY, 0, g.h - 1)) === Cell.Floor);
    x = nx;
    y = ny;
    if (joinStop && joined && rng.next() < JOIN_STOP_CHANCE) return;
  }
  if (rng.next() < poolChance) pool(dig, x, y, (P.poolRadius + rng.next() * P.poolRadiusSpan) * dig.unit, true);
}

/** 行き先の向き（x と y の差の大きい軸の方へ。ゆらぎは乱数 2 回） */
function aimAt(rng: Rng, x: number, y: number, goal: Vec): number {
  const dx = goal.x - x;
  const dy = goal.y - y;
  if (Math.abs(dx) * (0.5 + rng.next()) > Math.abs(dy) * (0.5 + rng.next())) return dx > 0 ? 0 : 2;
  return dy > 0 ? 1 : 3;
}

/** 前が道のとき、左右のうち 3 マス先まで壁の側があればそちらへ曲がる。無ければそのまま */
function turnToWall(dig: Dig, x: number, y: number, dir: number): number {
  const sides = [1, 3].map((t) => (dir + t) % DIR_COUNT).filter((d) => ahead(dig, x, y, d, LOOK_MID) === Cell.Wall && ahead(dig, x, y, d, LOOK_NEAR) === Cell.Wall);
  if (sides.length === 0) return dir;
  return sides[dig.rng.int(0, sides.length - 1)] ?? dir;
}

/** (x, y) から k マス先のセル。範囲外は -1 */
function ahead(dig: Dig, x: number, y: number, dir: number, k: number): number {
  const nx = x + (DIR_X[dir] ?? 0) * k;
  const ny = y + (DIR_Y[dir] ?? 0) * k;
  if (nx < DIG_PAD || ny < DIG_PAD || nx > dig.g.w - 4 || ny > dig.g.h - 4) return -1;
  return cellAt(dig.g, nx, ny);
}

function cellAt(g: Grid, x: number, y: number): number {
  return g.cells[y * g.w + x] ?? Cell.Wall;
}

/** (x, y) を左上に brush x brush を掘る。掘ってよい範囲の外は掘らない */
function digBrush(dig: Dig, x: number, y: number, brush: number): void {
  const { g } = dig;
  for (let j = 0; j < brush; j++) {
    for (let i = 0; i < brush; i++) {
      const nx = x + i;
      const ny = y + j;
      if (nx < DIG_PAD || ny < DIG_PAD || nx > g.w - 3 || ny > g.h - 3) continue;
      const k = ny * g.w + nx;
      if (g.cells[k] !== Cell.Wall) continue;
      g.cells[k] = Cell.Floor;
      dig.floor++;
      dig.carved.push(k);
    }
  }
}

/** 溜まり（円）を掘る。record なら部屋の候補として覚える */
function pool(dig: Dig, x: number, y: number, r: number, record: boolean): void {
  const range = Math.ceil(r) + POOL_RANGE_PAD;
  for (let j = -range; j <= range; j++) {
    for (let i = -range; i <= range; i++) if (Math.sqrt(i * i + j * j) < r) digBrush(dig, x + i, y + j, 1);
  }
  if (record) dig.pools.push({ x, y, r });
}

/**
 * 部屋にする溜まりを選ぶ: 掘り手の終点にできた溜まりを（掘った順に）間隔を空けて採り、roomCount に足りなければ
 * 掘った道の上の離れた所に溜まりを足し掘りする（細道の網は合流で止まる掘り手が多く、終点の溜まりだけでは部屋が足りない）
 */
function pickRooms(dig: Dig, frame: LayoutFrame, start: Vec, lord: Vec): Pool[] {
  const { rng } = dig;
  const want = Math.max(1, Math.round(P.roomCount * frame.countMul));
  const minSq = (P.roomMinDist * frame.unit) ** 2;
  const taken: Vec[] = [start, lord];
  const rooms: Pool[] = [];
  const free = (p: Vec): boolean => taken.every((q) => (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) >= minSq);
  const take = (p: Pool): void => {
    taken.push(p);
    rooms.push(p);
  };
  for (const p of dig.pools) if (rooms.length < want && free(p)) take(p);
  const tries = ADD_POOL_TRIES * want;
  for (let n = 0; n < tries && rooms.length < want; n++) {
    const at = dig.carved[rng.int(0, dig.carved.length - 1)];
    if (at === undefined) break;
    const p = { x: at % frame.width, y: Math.floor(at / frame.width), r: (P.poolRadius + rng.next() * P.poolRadiusSpan) * frame.unit };
    if (!free(p)) continue;
    pool(dig, p.x, p.y, p.r, false);
    take(p);
  }
  return rooms;
}

/** ノード = 開始・主の間と、選んだ溜まり */
function nodesOf(frame: LayoutFrame, start: Vec, lord: Vec, rooms: readonly Pool[]): LayoutNode[] {
  const growOf = (r: number): number => Math.ceil(r * P.poolGrowMul) + 2;
  const lordGrow = Math.max(growOf(P.lordPool * frame.unit), Math.ceil(frame.lordRadius * P.lordGrowMul));
  return [
    { x: start.x + 0.5, y: start.y + 0.5, role: "start", grow: growOf(P.startPool * frame.unit) },
    { x: lord.x + 0.5, y: lord.y + 0.5, role: "lord", grow: lordGrow },
    ...rooms.map((p): LayoutNode => ({ x: p.x + 0.5, y: p.y + 0.5, role: "room", grow: growOf(p.r) })),
  ];
}
