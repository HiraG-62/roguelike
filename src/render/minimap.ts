import type { GameState, RoomKind } from "../core/state";
import { REAPER } from "../data/tuning";
import { type GameMap, TILE_SIZE, Tile, toIndex } from "../map/grid";

/**
 * 部屋のタイル所属表。描画側（床マーク・伏兵の暗い床・泉・ミニマップ）で共有する。
 * フロアが変わったとき（state.map の参照が変わったとき）だけ作り直す
 */
export interface RoomLookup {
  map: GameMap;
  /** タイル → 部屋 index（-1 = 通路） */
  roomOf: Int16Array;
  /** 扉タイル → 部屋 index */
  doorOf: Map<number, number>;
}

const NO_ROOM = -1;

export function buildRoomLookup(state: GameState): RoomLookup {
  const { map } = state;
  const roomOf = new Int16Array(map.tiles.length).fill(NO_ROOM);
  const doorOf = new Map<number, number>();
  state.rooms.forEach((room, i) => {
    if (room.tiles) {
      for (const t of room.tiles) roomOf[t] = i;
    } else {
      const r = room.rect;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) roomOf[toIndex(map, x, y)] = i;
      }
    }
    for (const t of room.doorTiles) if (!doorOf.has(t)) doorOf.set(t, i);
  });
  return { map, roomOf, doorOf };
}

type Rgb = readonly [number, number, number];

const CORRIDOR_RGB: Rgb = [84, 84, 100];
const BOSS_RGB: Rgb = [220, 56, 56];
const FOUNTAIN_RGB: Rgb = [120, 200, 255];
/** 伏兵は見た目 normal と同じ色（ミニマップでもバレない） */
const ROOM_RGB: Readonly<Record<RoomKind, Rgb>> = {
  normal: [150, 150, 170],
  ambush: [150, 150, 170],
  treasure: [236, 196, 64],
  challenge: [240, 132, 56],
  shrine: [96, 170, 240],
};
const OPAQUE = 255;
const RGBA = 4;

/**
 * exploredLog の from 番目以降のタイルを data（RGBA、1 タイル = 1px）に塗る。塗り終えた位置を返す。
 * DOM に依存しない純粋な処理（テスト用に切り出し）
 */
export function paintExplored(
  data: Uint8ClampedArray,
  state: GameState,
  lookup: RoomLookup,
  bossRoom: number,
  from: number,
): number {
  const log = state.exploredLog;
  for (let n = from; n < log.length; n++) {
    const tile = log[n] ?? 0;
    const [r, g, b] = tileColor(state, lookup, bossRoom, tile);
    const o = tile * RGBA;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = OPAQUE;
  }
  return log.length;
}

function tileColor(state: GameState, lookup: RoomLookup, bossRoom: number, tile: number): Rgb {
  if (state.map.tiles[tile] === Tile.Fountain) return FOUNTAIN_RGB;
  const room = lookup.roomOf[tile] ?? NO_ROOM;
  if (room === NO_ROOM) return CORRIDOR_RGB;
  if (room === bossRoom) return BOSS_RGB;
  return ROOM_RGB[state.rooms[room]?.kind ?? "normal"];
}

const MARGIN = 4;
const BG_PAD = 2;
const BG_ALPHA = 0.55;
const COLOR_BG = "#000000";
const COLOR_FRAME = "#404050";
const COLOR_PLAYER = "#ffffff";
const COLOR_STAIRS = "#ffe040";
const DOT = 2;
const STAIRS_DOT = 3;
const DOT_HALF = DOT / 2;
const STAIRS_HALF = Math.floor(STAIRS_DOT / 2);

/**
 * 1 タイル = 1px のミニマップ。探索済みタイルだけを事前生成の ImageData に塗り、
 * state.exploredLog の差分（前フレームから増えた分）だけ書き換える
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private map: GameMap | null = null;
  private cursor = 0;
  private bossRoom = NO_ROOM;
  private stairs: number[] = [];
  private stairsKey = "";

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  /** 画面右上に占める高さ（HUD の文字をこの下に置く） */
  static bottom(state: GameState): number {
    return MARGIN + state.map.height + BG_PAD;
  }

  draw(target: CanvasRenderingContext2D, state: GameState, lookup: RoomLookup, viewW: number): void {
    this.sync(state, lookup);
    const { map } = state;
    const x0 = viewW - MARGIN - map.width;
    const y0 = MARGIN;
    target.globalAlpha = BG_ALPHA;
    target.fillStyle = COLOR_BG;
    target.fillRect(x0 - BG_PAD, y0 - BG_PAD, map.width + BG_PAD * 2, map.height + BG_PAD * 2);
    target.globalAlpha = 1;
    target.strokeStyle = COLOR_FRAME;
    target.lineWidth = 1;
    target.strokeRect(x0 - BG_PAD - 0.5, y0 - BG_PAD - 0.5, map.width + BG_PAD * 2 + 1, map.height + BG_PAD * 2 + 1);
    target.drawImage(this.canvas, x0, y0);

    target.fillStyle = COLOR_STAIRS;
    for (const i of this.stairs) {
      if (!state.explored[i]) continue;
      const sx = i % map.width;
      const sy = Math.floor(i / map.width);
      target.fillRect(x0 + sx - STAIRS_HALF, y0 + sy - STAIRS_HALF, STAIRS_DOT, STAIRS_DOT);
    }
    this.dot(target, x0, y0, state.player.body.pos.x, state.player.body.pos.y, COLOR_PLAYER);
    if (state.reaper) this.dot(target, x0, y0, state.reaper.pos.x, state.reaper.pos.y, REAPER.color);
  }

  private dot(target: CanvasRenderingContext2D, x0: number, y0: number, px: number, py: number, color: string): void {
    target.fillStyle = color;
    target.fillRect(Math.round(x0 + px / TILE_SIZE - DOT_HALF), Math.round(y0 + py / TILE_SIZE - DOT_HALF), DOT, DOT);
  }

  /** フロアが変わっていれば作り直し、探索ログの差分だけ塗る */
  private sync(state: GameState, lookup: RoomLookup): void {
    const { map } = state;
    if (this.map !== map || !this.image) this.reset(state);
    this.refreshStairs(state);
    const image = this.image;
    if (!image || this.cursor === state.exploredLog.length) return;
    this.cursor = paintExplored(image.data, state, lookup, this.bossRoom, this.cursor);
    this.ctx.putImageData(image, 0, 0);
  }

  private reset(state: GameState): void {
    const { map } = state;
    this.map = map;
    this.canvas.width = map.width;
    this.canvas.height = map.height;
    this.image = this.ctx.createImageData(map.width, map.height);
    this.cursor = 0;
    this.bossRoom = state.boss?.roomIndex ?? NO_ROOM;
    this.stairsKey = "";
    this.ctx.clearRect(0, 0, map.width, map.height);
  }

  /** 階段はボス撃破で後から出るので、ボスの状態が変わったときだけ探し直す */
  private refreshStairs(state: GameState): void {
    const key = `${state.boss?.defeated ?? "none"}`;
    if (key === this.stairsKey) return;
    this.stairsKey = key;
    this.stairs = [];
    state.map.tiles.forEach((t, i) => {
      if (t === Tile.StairsDown) this.stairs.push(i);
    });
  }
}
