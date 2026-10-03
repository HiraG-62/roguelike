import type { Vec } from "../core/vec";
import { type GameMap, type Rect, TILE_SIZE, Tile, createMap, setTile } from "./grid";

/**
 * 武器指南書の実演の稽古場: 外周だけ壁の 1 部屋。広さは論理画面（480x270）と同じにして、
 * カメラが動かない（camera の「マップ外を映さない」で中央に留まる）ようにする。純関数で乱数を使わない
 */

/** 横 30 × 縦 17 タイル（480 x 272 px）。論理画面に合わせる */
export const DEMO_ARENA_W = 30;
export const DEMO_ARENA_H = 17;

export interface DemoArena {
  map: GameMap;
  /** 稽古場の中心（px）。実演の窓はここを中心に切り出す */
  center: Vec;
}

export function buildDemoArena(): DemoArena {
  const map = createMap(DEMO_ARENA_W, DEMO_ARENA_H);
  const room: Rect = { x: 1, y: 1, w: DEMO_ARENA_W - 2, h: DEMO_ARENA_H - 2 };
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) setTile(map, x, y, Tile.Floor);
  }
  map.rooms = [room];
  return { map, center: { x: (DEMO_ARENA_W * TILE_SIZE) / 2, y: (DEMO_ARENA_H * TILE_SIZE) / 2 } };
}
