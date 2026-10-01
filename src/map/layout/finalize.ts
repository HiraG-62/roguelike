/**
 * 型の下書き（Cell 配列 + ノード）を GameMap に変換する共通の後処理（docs/ideas/map-gen-impl.md 2-1）。
 * - 部屋 = ノードの所属タイル。tiles を持つノードはそれを種に、持たないノードは (x, y) から grow マスまで育てる
 * - 部屋どうしは 8 近傍で 1 マス離す（接するタイルは両方の部屋から外す。扉で封鎖できる間隔）
 * - 並びは 開始 → 歩いて近い順 → 主の間。階段は主の間の核（壁・穴から最も遠い床）
 * 乱数を使わない純関数。作れなければ null（開始か主の間が欠けた・育たなかった）
 */
import { MAP_LAYOUT } from "../../data/tuning";
import { type GameMap, Tile, createMap } from "../grid";
import {
  CONTESTED,
  type Grid,
  NO_OWNER,
  type RegionRoom,
  buildRoom,
  growRooms,
  orderFromStart,
  tilesOfOwners,
  touchesOtherOwner,
  wallDistance,
} from "../regions";
import { sealBorder } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutKind, type LayoutNode } from "./types";

/** (x, y) が床でなかったとき、近くの床を探す範囲（チェビシェフ距離。ノードの座標は小数・縁寄りのことがある） */
const SNAP_RADIUS = 2;

interface Seed {
  node: LayoutNode;
  tiles: number[];
}

export function finalizeLayout(kind: LayoutKind, draft: LayoutDraft, frame: LayoutFrame, minNodeTiles: number = MAP_LAYOUT.minNodeTiles): GameMap | null {
  const { width: w, height: h } = frame;
  if (draft.cells.length !== w * h) return null;
  const grid: Grid = { w, h, cells: draft.cells.slice() };
  sealBorder(grid);

  const seeds = seedNodes(grid, draft.nodes);
  if (!seeds) return null;
  const owners = growRooms(
    grid,
    seeds.map((s) => s.tiles),
    // tiles を持つノードは領域が決まっているので育てない
    seeds.map((s) => (s.node.tiles ? 0 : Math.max(0, Math.floor(s.node.grow)))),
  );
  separateRooms(grid, owners);

  const tilesByOwner = tilesOfOwners(owners, seeds.length);
  const kept = keepRooms(seeds, tilesByOwner, minNodeTiles);
  if (!kept) return null;

  const map = createMap(w, h);
  for (let i = 0; i < grid.cells.length; i++) map.tiles[i] = tileOf(grid.cells[i] ?? Cell.Wall);
  const dist = wallDistance(grid);
  const build = (tiles: number[]): RegionRoom => buildRoom(map, tiles, dist, tiles);
  const start = build(kept.start);
  const lord = build(kept.lord);
  const middle = orderFromStart(grid, [start, ...kept.rooms.map(build)]).filter((r) => r !== start);
  const ordered = [start, ...middle, lord];

  map.rooms = ordered.map((r) => r.rect);
  map.roomTiles = ordered.map((r) => r.tiles);
  map.tiles[lord.core] = Tile.StairsDown;
  copyShallow(map, draft.shallow);
  map.layout = kind;
  return map;
}

function tileOf(cell: number): Tile {
  if (cell === Cell.Floor) return Tile.Floor;
  if (cell === Cell.Pit) return Tile.Pit;
  return Tile.Wall;
}

/**
 * ノードごとの種のタイルを決める。種が取れないノードは捨てる（開始・主の間が取れない、
 * 開始や主の間が 1 つでない場合は null）。同じタイルを狙うノードは先に書いた方が取る
 */
function seedNodes(g: Grid, nodes: readonly LayoutNode[]): Seed[] | null {
  const claimed = new Uint8Array(g.cells.length);
  const seeds: Seed[] = [];
  for (const node of nodes) {
    const tiles = node.tiles ? node.tiles.filter((t) => usable(g, claimed, t)) : snapToFloor(g, claimed, node);
    if (tiles.length === 0) {
      if (node.role !== "room") return null;
      continue;
    }
    for (const t of tiles) claimed[t] = 1;
    seeds.push({ node, tiles });
  }
  const starts = seeds.filter((s) => s.node.role === "start").length;
  const lords = seeds.filter((s) => s.node.role === "lord").length;
  return starts === 1 && lords === 1 ? seeds : null;
}

function usable(g: Grid, claimed: Uint8Array, tile: number): boolean {
  return tile >= 0 && tile < g.cells.length && g.cells[tile] === Cell.Floor && !claimed[tile];
}

/** ノードの座標のマス（床でなければ近くの床）。走査順は固定（y → x） */
function snapToFloor(g: Grid, claimed: Uint8Array, node: LayoutNode): number[] {
  const cx = Math.floor(node.x);
  const cy = Math.floor(node.y);
  let best = -1;
  let bestRank = Infinity;
  for (let dy = -SNAP_RADIUS; dy <= SNAP_RADIUS; dy++) {
    for (let dx = -SNAP_RADIUS; dx <= SNAP_RADIUS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const tile = y * g.w + x;
      const rank = dx * dx + dy * dy;
      if (rank < bestRank && usable(g, claimed, tile)) {
        best = tile;
        bestRank = rank;
      }
    }
  }
  return best < 0 ? [] : [best];
}

/** 別の部屋と 8 近傍で接するタイルを両方の部屋から外す（growRooms の取り合いの規則を、直に渡された所属タイルにも） */
function separateRooms(g: Grid, owners: Int16Array): void {
  const clash: number[] = [];
  for (let i = 0; i < owners.length; i++) {
    const id = owners[i] ?? NO_OWNER;
    if (id >= 0 && touchesOtherOwner(g, owners, i, id)) clash.push(i);
  }
  for (const i of clash) owners[i] = CONTESTED;
}

interface KeptRooms {
  start: number[];
  lord: number[];
  rooms: number[][];
}

/** 開始・主の間と、minNodeTiles 以上に育った部屋だけ残す。開始か主の間のタイルが無ければ null */
function keepRooms(seeds: readonly Seed[], tilesByOwner: readonly number[][], minNodeTiles: number): KeptRooms | null {
  let start: number[] | undefined;
  let lord: number[] | undefined;
  const rooms: number[][] = [];
  seeds.forEach((seed, id) => {
    const tiles = tilesByOwner[id] ?? [];
    if (seed.node.role === "start") start = tiles;
    else if (seed.node.role === "lord") lord = tiles;
    else if (tiles.length >= minNodeTiles) rooms.push(tiles);
  });
  if (!start || start.length === 0 || !lord || lord.length === 0) return null;
  return { start, lord, rooms };
}

function copyShallow(map: GameMap, shallow: Uint8Array): void {
  if (shallow.length !== map.tiles.length) return;
  const out = new Uint8Array(shallow.length);
  let any = false;
  for (let i = 0; i < shallow.length; i++) {
    const v = shallow[i] ?? 0;
    // 浅い地形は床の上にだけ重なる（壁・穴に残すと地形の自然配置が壁に置かれる）
    if (v === 0 || map.tiles[i] !== Tile.Floor) continue;
    out[i] = v;
    any = true;
  }
  if (any) map.shallow = out;
}
