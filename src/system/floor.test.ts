import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { enemiesForDepth, enemyDef } from "../data/enemies";
import type { GameState, RoomState } from "../core/state";
import { rectCenterPx, TILE_SIZE } from "../map/grid";
import { eliteChance } from "./elites";
import { createEnemy } from "./enemies";
import { enemyCount, updateRooms } from "./floor";
import { overlapsWall } from "./physics";

describe("depth 2 の難度調整", () => {
  it("湧き数は base 2 + floor(depth * 0.8)（depth1:2, depth2:3, depth5:6）", () => {
    const state = createGame(1);
    for (const [depth, expected] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ] as const) {
      state.depth = depth;
      expect(enemyCount(state)).toBe(expected);
    }
  });

  it("knight は depth 2 では出ない（minDepth が 3 に）", () => {
    expect(enemiesForDepth(2).some((d) => d.key === "knight")).toBe(false);
    expect(enemiesForDepth(3).some((d) => d.key === "knight")).toBe(true);
  });

  it("エリートは depth 2 では出ない（ELITE.minDepth が 3 に）", () => {
    expect(eliteChance(2)).toBe(0);
    expect(eliteChance(3)).toBeGreaterThan(0);
  });
});

/** 開始部屋以外で kind="normal" かつ doorTiles を持つ、ロック可能な部屋を探す */
function findLockableRoom(state: GameState): { room: RoomState; index: number } | null {
  for (let i = 1; i < state.rooms.length; i++) {
    const room = state.rooms[i]!;
    if (room.kind === "normal" && room.doorTiles.length > 0) return { room, index: i };
  }
  return null;
}

const SEARCH_SEEDS = 50;

describe("扉タイル上の敵とロック", () => {
  it("扉タイルに AABB が掛かっている敵はロック時に部屋の中心方向へ押し込まれ、壁（ロック済み扉含む）に重ならない", () => {
    let found: { state: GameState; room: RoomState; index: number } | null = null;
    for (let seed = 0; seed < SEARCH_SEEDS && !found; seed++) {
      const state = createGame(seed);
      const hit = findLockableRoom(state);
      if (hit) found = { state, ...hit };
    }
    if (!found) throw new Error("no lockable room found");
    const { state, room, index } = found;

    const doorTile = room.doorTiles[0]!;
    const tx = doorTile % state.map.width;
    const ty = Math.floor(doorTile / state.map.width);
    const pos = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };

    // 扉タイルのど真ん中に敵を置く（ロック前は壁ではないので overlapsWall は false のはず）
    const e = createEnemy(state, enemyDef("slime"), pos, index, false);
    state.enemies.push(e);
    expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius)).toBe(false);

    // プレイヤーを部屋の中心へ動かしてロックさせる
    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked).toBe(true);
    // 押し込みに成功していれば生存したまま壁に重ならない。消された場合（hp<=0）は対象外
    if (e.hp > 0) {
      expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius)).toBe(false);
    }
  });

  it("プレイヤー自身が扉タイルに掛かっている間はロックされない（二重の保険）", () => {
    let found: { state: GameState; room: RoomState; index: number } | null = null;
    for (let seed = 0; seed < SEARCH_SEEDS && !found; seed++) {
      const state = createGame(seed);
      const hit = findLockableRoom(state);
      if (hit) found = { state, ...hit };
    }
    if (!found) throw new Error("no lockable room found");
    const { state, room } = found;

    const doorTile = room.doorTiles[0]!;
    const tx = doorTile % state.map.width;
    const ty = Math.floor(doorTile / state.map.width);
    state.player.body.pos = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
    updateRooms(state, FIXED_DT);

    expect(room.locked).toBe(false);
  });
});
