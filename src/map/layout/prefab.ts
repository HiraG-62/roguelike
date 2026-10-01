/**
 * 階の型「断片の組み合わせ」（prefab）。手で描いた部屋の断片（prefabPieces.ts の PREFABS）を回転・反転・拡大して置き、
 * 緩和と空き地への差し込みのあと、扉どうしを折れた廊下でつなぐ（廊下を先に掘って、断片を上から押す）。
 * 見本（docs/ideas/previews/map-preview.html の genPrefab）の移植。拡縮（docs/ideas/map-gen-impl.md 2-4・2-5）:
 * - 断片は手描きの寸法なので、unit（1〜2 のとき）の分だけ確率で 2 倍に拡大する（地図が広いほど大きな部屋になる）。unit が 2 以上なら常に 2 倍
 * - 断片の数は countMul 倍。ただし拡大した分だけ 1 つが占める面積が増えるので (unit ÷ 平均の拡大率)² で割り戻す
 * - 空き地探しは「試行 × 全マス × 置いた断片」を避け、乱択の点（insertSamples）を置いた断片と突き合わせる
 * 部屋（ノード）は断片の床（'.' '~' 'D'）を所属タイルにして渡す。柱・穴・断片の外の廊下は部屋に入らない。
 * 雑音は使わないので noiseSeed は読まない。乱数は引数の rng だけ
 */
import type { Rng } from "../../core/rng";
import { terrainCode } from "../../core/terrain";
import { MAP_LAYOUT } from "../../data/tuning";
import { PIECE_CHARS, POOL_KEYS, PREFABS, type PieceKey } from "./prefabPieces";
import { type Grid, addLoops, clamp, connectAll, isInner, makeGrid, mstEdges } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.prefab;

/** 断片の拡大率の上限（手描きの 1 マスを 2x2 にする） */
const MAX_PIECE_SCALE = 2;
/** 開始・主の間の位置の乱数の余白（地図の縁からのタイル） */
const EDGE_MARGIN_X = 6;
const EDGE_MARGIN_Y = 5;
/** 開始・主の間を地図の端の近くに置くとき、端から断片の縁までの余白 */
const END_MARGIN = 2;
/** 緩和の「動きやすさ」: 開始・主の間は動きにくく、ほかは均等 */
const ANCHOR_WEIGHT = 0.15;
/** 断片と地図の縁の最小の余白（緩和） */
const FIT_MARGIN = 1.5;
/** 廊下の曲がり方を決める確率（先に横へ行くか、先に縦へ行くか） */
const HORIZONTAL_FIRST_CHANCE = 0.5;
/** 扉の外へ出る長さ（扉の内側の縁から廊下の始点まで）。タイル */
const DOOR_REACH = 2;
/** 開始・主の間を置く向き（横長か縦長か）を決めるときの符号の確率 */
const SIGN_CHANCE = 0.5;

type Dir = "up" | "down" | "left" | "right";

/** 向き・拡大を決めた断片の文字の格子 */
export interface Oriented {
  w: number;
  h: number;
  /** grid[y][x] = 文字 */
  grid: string[][];
}

/** 扉の組（2 マス幅）の座標（断片の左上が原点） */
export interface Door {
  /** 廊下の始点（扉の内側の縁のマス。幅 2 の廊下の左上） */
  ix: number;
  iy: number;
  /** 縁の外 DOOR_REACH マスの点 */
  ox: number;
  oy: number;
}

interface Piece {
  key: PieceKey;
  o: Oriented;
  doors: Door[];
  /** 中心（緩和で動かす。実数） */
  cx: number;
  cy: number;
  /** 置き場所（左上。整数。緩和のあと決まる） */
  x0: number;
  y0: number;
}

function rotate90(grid: string[][]): string[][] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const out: string[][] = Array.from({ length: w }, () => Array.from({ length: h }, () => PIECE_CHARS.none as string));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const row = out[x];
      if (row) row[h - 1 - y] = grid[y]?.[x] ?? PIECE_CHARS.none;
    }
  }
  return out;
}

function scaleUp(grid: string[][], k: number): string[][] {
  if (k === 1) return grid;
  const out: string[][] = [];
  for (const row of grid) {
    const wide = row.flatMap((c) => Array.from({ length: k }, () => c));
    for (let i = 0; i < k; i++) out.push(wide.slice());
  }
  return out;
}

/** 断片を回転（90 度を rot 回）・反転・拡大した格子にする */
export function orient(key: PieceKey, rot: number, mirror: boolean, scale: number): Oriented {
  const rows = PREFABS[key].rows;
  const w0 = Math.max(...rows.map((r) => r.length));
  let grid = rows.map((r) => Array.from({ length: w0 }, (_, x) => r[x] ?? PIECE_CHARS.none));
  if (mirror) grid = grid.map((r) => r.slice().reverse());
  for (let r = 0; r < rot; r++) grid = rotate90(grid);
  grid = scaleUp(grid, scale);
  return { w: grid[0]?.length ?? 0, h: grid.length, grid };
}

/** 扉の文字を 4 近傍の塊に分ける。塊 = 扉 1 つ（拡大しても 1 つ） */
function doorGroups(o: Oriented): { x0: number; y0: number; x1: number; y1: number }[] {
  const seen = new Uint8Array(o.w * o.h);
  const groups: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      if (o.grid[y]?.[x] !== PIECE_CHARS.door || seen[y * o.w + x]) continue;
      const g = { x0: x, y0: y, x1: x, y1: y };
      const stack = [[x, y]] as [number, number][];
      seen[y * o.w + x] = 1;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop() ?? [0, 0];
        g.x0 = Math.min(g.x0, cx);
        g.x1 = Math.max(g.x1, cx);
        g.y0 = Math.min(g.y0, cy);
        g.y1 = Math.max(g.y1, cy);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= o.w || ny >= o.h || seen[ny * o.w + nx] || o.grid[ny]?.[nx] !== PIECE_CHARS.door) continue;
          seen[ny * o.w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      groups.push(g);
    }
  }
  return groups;
}

/** 扉の塊が縁のどちらを向くか。横に長い塊は上下、縦に長い塊は左右。縁にぴったりなら迷わず、そうでなければ近い方 */
function doorFacing(g: { x0: number; y0: number; x1: number; y1: number }, o: Oriented): Dir {
  if (g.x1 - g.x0 >= g.y1 - g.y0) return g.y0 <= o.h - 1 - g.y1 ? "up" : "down";
  return g.x0 <= o.w - 1 - g.x1 ? "left" : "right";
}

/** 断片の扉の一覧。廊下の幅（corridorWidth）で通れるよう、塊の真ん中に始点を置く。扉が無ければ中心を 1 つの扉とみなす */
export function doorsOf(o: Oriented): Door[] {
  const out: Door[] = [];
  for (const g of doorGroups(o)) {
    const dir = doorFacing(g, o);
    const horizontal = dir === "up" || dir === "down";
    const span = horizontal ? g.x1 - g.x0 + 1 : g.y1 - g.y0 + 1;
    const along = Math.floor((span - P.corridorWidth) / 2);
    const ix = horizontal ? g.x0 + along : dir === "left" ? g.x0 : g.x1;
    const iy = horizontal ? (dir === "up" ? g.y0 : g.y1) : g.y0 + along;
    const ox = dir === "left" ? ix - DOOR_REACH : dir === "right" ? ix + DOOR_REACH : ix;
    const oy = dir === "up" ? iy - DOOR_REACH : dir === "down" ? iy + DOOR_REACH : iy;
    out.push({ ix, iy, ox, oy });
  }
  if (out.length > 0) return out;
  const cx = Math.floor(o.w / 2);
  const cy = Math.floor(o.h / 2);
  return [{ ix: cx, iy: cy, ox: cx, oy: cy }];
}

function makePiece(rng: Rng, key: PieceKey, upChance: number): Piece {
  const rot = rng.int(0, 3);
  const mirror = rng.chance(0.5);
  const scale = rng.chance(upChance) ? MAX_PIECE_SCALE : 1;
  const o = orient(key, rot, mirror, scale);
  return { key, o, doors: doorsOf(o), cx: 0, cy: 0, x0: 0, y0: 0 };
}

/** 2 つの断片の外接矩形が gap マス以上離れているか（整数の置き場所） */
function apart(a: Piece, b: Piece, gap: number): boolean {
  return a.x0 + a.o.w + gap <= b.x0 || b.x0 + b.o.w + gap <= a.x0 || a.y0 + a.o.h + gap <= b.y0 || b.y0 + b.o.h + gap <= a.y0;
}

function fit(p: Piece, w: number, h: number): void {
  p.cx = clamp(p.cx, p.o.w / 2 + FIT_MARGIN, w - p.o.w / 2 - FIT_MARGIN);
  p.cy = clamp(p.cy, p.o.h / 2 + FIT_MARGIN, h - p.o.h / 2 - FIT_MARGIN);
}

/** 矩形の緩和: 重なりを小さい軸の方向へ押し離す（余白 relaxGap マス）。開始・主の間（添字 0・1）は動きにくい */
function relaxPieces(pieces: Piece[], w: number, h: number): void {
  pieces.forEach((p) => fit(p, w, h));
  for (let it = 0; it < P.relaxIters; it++) {
    let moved = false;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        if (!a || !b) continue;
        const ox = (a.o.w + b.o.w) / 2 + P.relaxGap - Math.abs(a.cx - b.cx);
        const oy = (a.o.h + b.o.h) / 2 + P.relaxGap - Math.abs(a.cy - b.cy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const wa = i < 2 ? ANCHOR_WEIGHT : 0.5;
        const wb = 1 - wa;
        if (ox < oy) {
          const s = a.cx < b.cx ? -1 : 1;
          a.cx += s * ox * wa;
          b.cx -= s * ox * wb;
        } else {
          const s = a.cy < b.cy ? -1 : 1;
          a.cy += s * oy * wa;
          b.cy -= s * oy * wb;
        }
      }
    }
    pieces.forEach((p) => fit(p, w, h));
    if (!moved) break;
  }
}

/** 初期の中心。開始と主の間は地図の向かい合う端の近く、ほかは地図のどこか */
function startingCenters(rng: Rng, pieces: Piece[], w: number, h: number): void {
  const horizontal = rng.chance(P.horizontalChance);
  const sign = rng.chance(SIGN_CHANCE) ? 1 : -1;
  pieces.forEach((p, i) => {
    if (i >= 2) {
      p.cx = EDGE_MARGIN_X + rng.next() * (w - 2 * EDGE_MARGIN_X);
      p.cy = EDGE_MARGIN_Y + rng.next() * (h - 2 * EDGE_MARGIN_Y);
      return;
    }
    const s = i === 0 ? -sign : sign;
    p.cx = horizontal ? w / 2 + s * (w / 2 - p.o.w / 2 - END_MARGIN) : EDGE_MARGIN_X + rng.next() * (w - 2 * EDGE_MARGIN_X);
    p.cy = horizontal ? EDGE_MARGIN_Y + rng.next() * (h - 2 * EDGE_MARGIN_Y) : h / 2 + s * (h / 2 - p.o.h / 2 - END_MARGIN);
  });
}

/** 緩和した中心を整数の置き場所（地図の中）に直す */
function snapToGrid(p: Piece, w: number, h: number): void {
  p.x0 = clamp(Math.round(p.cx - p.o.w / 2), 1, w - p.o.w - 1);
  p.y0 = clamp(Math.round(p.cy - p.o.h / 2), 1, h - p.o.h - 1);
}

/** まだ重なる断片は捨てる（開始・主の間は残す） */
function keepApart(pieces: Piece[]): Piece[] {
  const placed: Piece[] = [];
  pieces.forEach((p, i) => {
    if (i < 2 || placed.every((b) => apart(p, b, P.keepGap))) placed.push(p);
  });
  return placed;
}

/** 空いた所へ追加で差し込む（地図を埋めて床の割合を保つ）。乱択の点を置いた断片と突き合わせる */
function insertPieces(rng: Rng, placed: Piece[], w: number, h: number, want: number, tries: number, upChance: number): void {
  for (let t = 0; t < tries && placed.length < want; t++) {
    const p = makePiece(rng, rng.pick(POOL_KEYS), upChance);
    const xSpan = w - p.o.w - 2 * END_MARGIN;
    const ySpan = h - p.o.h - 2 * END_MARGIN;
    if (xSpan < 1 || ySpan < 1) continue;
    for (let s = 0; s < P.insertSamples; s++) {
      p.x0 = END_MARGIN + Math.floor(rng.next() * xSpan);
      p.y0 = END_MARGIN + Math.floor(rng.next() * ySpan);
      if (!placed.every((b) => apart(p, b, P.relaxGap))) continue;
      p.cx = p.x0 + p.o.w / 2;
      p.cy = p.y0 + p.o.h / 2;
      placed.push(p);
      break;
    }
  }
}

/** 幅 w の正方形の筆（左上が (x, y)）で廊下を塗る */
function brush(cg: Grid, x: number, y: number, w: number): void {
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      if (isInner(cg, x + i, y + j)) cg.cells[(y + j) * cg.w + x + i] = Cell.Floor;
    }
  }
}

/** (x0, y0) から (x1, y1) までの縦か横の線を筆でなぞる */
function stroke(cg: Grid, x0: number, y0: number, x1: number, y1: number, w: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= n; s++) {
    const t = n === 0 ? 0 : s / n;
    brush(cg, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), w);
  }
}

interface AbsDoor {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}

function absoluteDoors(p: Piece): AbsDoor[] {
  return p.doors.map((d) => ({ ix: p.x0 + d.ix, iy: p.y0 + d.iy, ox: p.x0 + d.ox, oy: p.y0 + d.oy }));
}

/** 2 つの断片の扉のうち、縁の外の点どうしが一番近い組 */
function nearestDoors(a: Piece, b: Piece): [AbsDoor, AbsDoor] | null {
  let best: [AbsDoor, AbsDoor] | null = null;
  let bestDist = Infinity;
  for (const da of absoluteDoors(a)) {
    for (const db of absoluteDoors(b)) {
      const d = Math.abs(da.ox - db.ox) + Math.abs(da.oy - db.oy);
      if (d < bestDist) {
        bestDist = d;
        best = [da, db];
      }
    }
  }
  return best;
}

/** 辺（断片の組）ごとに、扉の組のうち一番近いもの同士を L 字（折れ曲がり）の廊下でつなぐ */
function carveCorridors(rng: Rng, placed: Piece[], edges: readonly (readonly [number, number])[], w: number, h: number): Grid {
  const cg = makeGrid(w, h, Cell.Wall);
  const wide = rng.chance(P.wideChance) ? P.wideCorridorWidth : P.corridorWidth;
  for (const [ia, ib] of edges) {
    const a = placed[ia];
    const b = placed[ib];
    const pair = a && b ? nearestDoors(a, b) : null;
    if (!pair) continue;
    const [da, db] = pair;
    const width = ia === 0 || ib === 0 ? P.corridorWidth : wide;
    stroke(cg, da.ix, da.iy, da.ox, da.oy, P.corridorWidth);
    stroke(cg, db.ix, db.iy, db.ox, db.oy, P.corridorWidth);
    if (rng.chance(HORIZONTAL_FIRST_CHANCE)) {
      stroke(cg, da.ox, da.oy, db.ox, da.oy, width);
      stroke(cg, db.ox, da.oy, db.ox, db.oy, width);
    } else {
      stroke(cg, da.ox, da.oy, da.ox, db.oy, width);
      stroke(cg, da.ox, db.oy, db.ox, db.oy, width);
    }
  }
  return cg;
}

/** 廊下の上に断片を押す（柱は廊下より強い）。浅い地形は shallow に写す */
function pressPieces(g: Grid, shallow: Uint8Array, placed: readonly Piece[]): void {
  const water = terrainCode("water");
  for (const p of placed) {
    for (let y = 0; y < p.o.h; y++) {
      for (let x = 0; x < p.o.w; x++) {
        const c = p.o.grid[y]?.[x] ?? PIECE_CHARS.none;
        const gx = p.x0 + x;
        const gy = p.y0 + y;
        if (c === PIECE_CHARS.none || !isInner(g, gx, gy)) continue;
        const i = gy * g.w + gx;
        if (c === PIECE_CHARS.wall) g.cells[i] = Cell.Wall;
        else if (c === PIECE_CHARS.pit) g.cells[i] = Cell.Pit;
        else {
          g.cells[i] = Cell.Floor;
          if (c === PIECE_CHARS.shallow) shallow[i] = water;
        }
      }
    }
  }
}

/** 断片の床（'.' '~' 'D'）のうち、出来上がりで床のまま残ったマス */
function floorTilesOf(g: Grid, p: Piece): number[] {
  const out: number[] = [];
  for (let y = 0; y < p.o.h; y++) {
    for (let x = 0; x < p.o.w; x++) {
      const c = p.o.grid[y]?.[x] ?? PIECE_CHARS.none;
      if (c === PIECE_CHARS.none || c === PIECE_CHARS.wall || c === PIECE_CHARS.pit) continue;
      const i = (p.y0 + y) * g.w + p.x0 + x;
      if (g.cells[i] === Cell.Floor) out.push(i);
    }
  }
  return out;
}

/** 断片 1 つが取る面積から決める、断片の数の倍率。拡大した断片は面積が大きいので、数は (unit ÷ 平均の拡大率)² で割り戻す */
function countScale(frame: LayoutFrame, upChance: number): number {
  const meanScale = 1 + upChance * (MAX_PIECE_SCALE - 1);
  return frame.countMul * (frame.unit / meanScale) ** 2;
}

export const generatePrefab: LayoutGenerator = (rng, frame) => {
  const { width: w, height: h } = frame;
  const upChance = clamp(frame.unit - 1, 0, 1);
  const mul = countScale(frame, upChance);
  const n = Math.max(2, Math.round((P.baseCount + rng.int(0, P.baseSpan - 1)) * mul));
  const keys: PieceKey[] = ["start", "boss"];
  for (let i = 0; i < n - 2; i++) keys.push(rng.pick(POOL_KEYS));
  const pieces = keys.map((key) => makePiece(rng, key, upChance));

  startingCenters(rng, pieces, w, h);
  relaxPieces(pieces, w, h);
  pieces.forEach((p) => snapToGrid(p, w, h));
  const placed = keepApart(pieces);
  const [start, boss] = placed;
  if (!start || !boss || !apart(start, boss, 1)) return null;
  const want = Math.round((P.fillCount + rng.int(0, P.fillSpan - 1)) * mul);
  insertPieces(rng, placed, w, h, want, Math.round(P.insertTries * frame.countMul), upChance);

  const centers = placed.map((p) => ({ x: p.x0 + p.o.w / 2, y: p.y0 + p.o.h / 2 }));
  const edges = addLoops(centers, mstEdges(centers), Math.round(P.loops * frame.countMul), P.loopMaxLen * frame.unit);
  const cg = carveCorridors(rng, placed, edges, w, h);
  const g = makeGrid(w, h, Cell.Wall);
  for (let i = 0; i < g.cells.length; i++) if (cg.cells[i] === Cell.Floor) g.cells[i] = Cell.Floor;
  const shallow = new Uint8Array(w * h);
  pressPieces(g, shallow, placed);
  connectAll(g, P.minKeep);
  return draftOf(g, shallow, placed);
};

/** 断片 = 部屋。先頭が開始、その次が主の間（置いた順がそのままノードの順） */
function draftOf(g: Grid, shallow: Uint8Array, placed: readonly Piece[]): LayoutDraft | null {
  const nodes: LayoutNode[] = [];
  for (const [i, p] of placed.entries()) {
    const tiles = floorTilesOf(g, p);
    const role = i === 0 ? "start" : i === 1 ? "lord" : "room";
    if (tiles.length === 0) {
      if (role !== "room") return null;
      continue;
    }
    nodes.push({ x: p.x0 + p.o.w / 2, y: p.y0 + p.o.h / 2, role, grow: 0, tiles });
  }
  return { cells: g.cells, shallow, nodes };
}
