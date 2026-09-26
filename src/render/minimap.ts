import type { GameState, RoomKind } from "../core/state";
import type { Vec } from "../core/vec";
import { MINIMAP, REAPER, RUN_EVENT } from "../data/tuning";
import { type GameMap, TILE_SIZE, Tile, rectCenter, toIndex } from "../map/grid";
import { bountyTargetId } from "../system/runEvents";
import { ROOM_KIND_COLOR } from "../system/specialRooms";

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
/** 階の主（major でないボス）の部屋の色。ボスより控えめな橙 */
const FLOOR_LORD_RGB: Rgb = [224, 136, 48];
const FOUNTAIN_RGB: Rgb = [120, 200, 255];
/** 伏兵は見た目 normal と同じ色（ミニマップでもバレない） */
const ROOM_RGB: Readonly<Record<RoomKind, Rgb>> = {
  normal: [150, 150, 170],
  ambush: [150, 150, 170],
  treasure: [236, 196, 64],
  challenge: [240, 132, 56],
  shrine: [96, 170, 240],
  // 台座の部屋は床の色で見分ける。戦う特別な部屋は床は通常色で、中央の記号（ROOM_MARK）で示す
  altar: [176, 120, 220],
  library: [110, 160, 220],
  gamble: [220, 190, 80],
  forge: [220, 130, 70],
  exchange: [90, 200, 170],
  curseShrine: [140, 70, 200],
  watchtower: [200, 200, 150],
  reaperNest: [110, 60, 160],
  arena: [150, 150, 170],
  resonance: [150, 150, 170],
  escort: [150, 150, 170],
  escape: [150, 150, 170],
  nest: [150, 150, 170],
  mirror: [150, 150, 170],
  horde: [150, 150, 170],
  // 第 2 弾: 台座の部屋（封印庫・属性の祭壇・試し場・反転の間）は床の色、戦う部屋（霧・潮）は記号で示す
  vault: [110, 200, 220],
  elementAltar: [220, 200, 110],
  dummyHall: [190, 150, 100],
  invertHall: [150, 90, 210],
  fogRoom: [150, 150, 170],
  tideRoom: [150, 150, 170],
};

/** 部屋の中央に打つ 3x3 の記号（行ごとの 3 ビット。1 = 塗る）。無い種類は打たない */
const ROOM_MARK: Readonly<Partial<Record<RoomKind, readonly [number, number, number]>>> = {
  altar: [0b010, 0b111, 0b010],
  library: [0b111, 0b101, 0b111],
  gamble: [0b101, 0b010, 0b101],
  forge: [0b111, 0b010, 0b010],
  exchange: [0b110, 0b011, 0b110],
  curseShrine: [0b101, 0b111, 0b101],
  watchtower: [0b010, 0b010, 0b111],
  reaperNest: [0b111, 0b111, 0b010],
  arena: [0b101, 0b010, 0b101],
  resonance: [0b010, 0b101, 0b010],
  escort: [0b010, 0b111, 0b101],
  escape: [0b100, 0b110, 0b111],
  nest: [0b111, 0b101, 0b101],
  mirror: [0b101, 0b101, 0b111],
  horde: [0b111, 0b000, 0b111],
  vault: [0b111, 0b101, 0b010],
  elementAltar: [0b010, 0b101, 0b111],
  dummyHall: [0b110, 0b010, 0b011],
  invertHall: [0b111, 0b010, 0b111],
  fogRoom: [0b101, 0b000, 0b101],
  tideRoom: [0b000, 0b101, 0b010],
};
const MARK_SIZE = 3;
const MARK_BITS_TOP = 0b100;
const COLOR_MARK_DEFAULT = "#ffffff";
const OPAQUE = 255;
const RGBA = 4;

/** ミニマップの縮尺と画面上の大きさ（px）。縮尺は 1 タイル = scale px */
export interface MinimapSize {
  scale: number;
  w: number;
  h: number;
}

/**
 * 広いマップでも画面を塞がないよう、MINIMAP.maxWidth / maxHeight に収まるまで縮める（拡大はしない）。
 * DOM に依存しない純粋な処理
 */
export function minimapSize(map: Pick<GameMap, "width" | "height">): MinimapSize {
  const scale = Math.min(1, MINIMAP.maxWidth / map.width, MINIMAP.maxHeight / map.height);
  return { scale, w: Math.max(1, Math.ceil(map.width * scale)), h: Math.max(1, Math.ceil(map.height * scale)) };
}

/** タイル index → ミニマップの画素 index（縮めたときは複数のタイルが 1 画素に重なり、後から塗った色が残る） */
function pixelOf(map: GameMap, size: MinimapSize, tile: number): number {
  const x = Math.floor((tile % map.width) * size.scale);
  const y = Math.floor(Math.floor(tile / map.width) * size.scale);
  return y * size.w + x;
}

/**
 * exploredLog の from 番目以降のタイルを data（RGBA、大きさは minimapSize。縮尺 1 なら 1 タイル = 1px）に塗る。
 * 塗り終えた位置を返す。DOM に依存しない純粋な処理（テスト用に切り出し）
 */
export function paintExplored(
  data: Uint8ClampedArray,
  state: GameState,
  lookup: RoomLookup,
  bossRoom: number,
  from: number,
): number {
  const log = state.exploredLog;
  const size = minimapSize(state.map);
  for (let n = from; n < log.length; n++) {
    const tile = log[n] ?? 0;
    const [r, g, b] = tileColor(state, lookup, bossRoom, tile);
    const o = pixelOf(state.map, size, tile) * RGBA;
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
  if (room === bossRoom) return state.boss?.major ? BOSS_RGB : FLOOR_LORD_RGB;
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
 * 1 タイル = 1px（広いマップは minimapSize の縮尺）のミニマップ。探索済みタイルだけを事前生成の ImageData に塗り、
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
    return MARGIN + minimapSize(state.map).h + BG_PAD;
  }

  draw(target: CanvasRenderingContext2D, state: GameState, lookup: RoomLookup, viewW: number): void {
    this.sync(state, lookup);
    const { map } = state;
    const size = minimapSize(map);
    const x0 = viewW - MARGIN - size.w;
    const y0 = MARGIN;
    target.globalAlpha = BG_ALPHA;
    target.fillStyle = COLOR_BG;
    target.fillRect(x0 - BG_PAD, y0 - BG_PAD, size.w + BG_PAD * 2, size.h + BG_PAD * 2);
    target.globalAlpha = 1;
    target.strokeStyle = COLOR_FRAME;
    target.lineWidth = 1;
    target.strokeRect(x0 - BG_PAD - 0.5, y0 - BG_PAD - 0.5, size.w + BG_PAD * 2 + 1, size.h + BG_PAD * 2 + 1);
    target.drawImage(this.canvas, x0, y0);

    // 点と記号は縮めても大きさを変えない（位置だけ縮尺に合わせる）
    target.fillStyle = COLOR_STAIRS;
    for (const i of this.stairs) {
      if (!state.explored[i]) continue;
      const sx = Math.floor((i % map.width) * size.scale);
      const sy = Math.floor(Math.floor(i / map.width) * size.scale);
      target.fillRect(x0 + sx - STAIRS_HALF, y0 + sy - STAIRS_HALF, STAIRS_DOT, STAIRS_DOT);
    }
    this.drawRoomMarks(target, state, x0, y0, size.scale);
    this.dot(target, x0, y0, size.scale, state.player.body.pos, COLOR_PLAYER);
    if (state.reaper) this.dot(target, x0, y0, size.scale, state.reaper.pos, REAPER.color);
    const bounty = state.enemies.find((e) => e.id === bountyTargetId(state));
    if (bounty) this.dot(target, x0, y0, size.scale, bounty.body.pos, RUN_EVENT.activeColor);
  }

  /** 探索済みの特別な部屋の中央に種類の記号を打つ */
  private drawRoomMarks(target: CanvasRenderingContext2D, state: GameState, x0: number, y0: number, scale: number): void {
    for (const room of state.rooms) {
      const mark = ROOM_MARK[room.kind];
      if (!mark) continue;
      const c = rectCenter(room.rect);
      if (!state.explored[toIndex(state.map, c.x, c.y)]) continue;
      const mx = x0 + Math.floor(c.x * scale);
      const my = y0 + Math.floor(c.y * scale);
      target.fillStyle = ROOM_KIND_COLOR[room.kind] ?? COLOR_MARK_DEFAULT;
      for (let row = 0; row < MARK_SIZE; row++) {
        const bits = mark[row] ?? 0;
        for (let col = 0; col < MARK_SIZE; col++) {
          if (!(bits & (MARK_BITS_TOP >> col))) continue;
          target.fillRect(mx - 1 + col, my - 1 + row, 1, 1);
        }
      }
    }
  }

  private dot(target: CanvasRenderingContext2D, x0: number, y0: number, scale: number, pos: Vec, color: string): void {
    target.fillStyle = color;
    const x = Math.round(x0 + (pos.x / TILE_SIZE) * scale - DOT_HALF);
    const y = Math.round(y0 + (pos.y / TILE_SIZE) * scale - DOT_HALF);
    target.fillRect(x, y, DOT, DOT);
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
    const size = minimapSize(map);
    this.map = map;
    this.canvas.width = size.w;
    this.canvas.height = size.h;
    this.image = this.ctx.createImageData(size.w, size.h);
    this.cursor = 0;
    this.bossRoom = state.boss?.roomIndex ?? NO_ROOM;
    this.stairsKey = "";
    this.ctx.clearRect(0, 0, size.w, size.h);
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
