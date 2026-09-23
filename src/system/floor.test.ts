import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { enemiesForDepth, enemyDef } from "../data/enemies";
import type { GameState, RoomState } from "../core/state";
import { Tile, createMap, rectCenterPx, TILE_SIZE, toIndex } from "../map/grid";
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

  it("AABB は扉タイルに掛かるが円の厳密判定では外れる斜め隅の敵も、押し込まれて壁（ロック済み扉）に重ならない", () => {
    // isSolidTile/overlapsWall は AABB（円の外接正方形）でタイルを走査するため、
    // 敵が扉タイルの斜め隅に近いと「円としては届かないが AABB は掛かる」位置ができる。
    // 押し込み判定（circleOnDoorTiles）が厳密な円判定のままだとここを見逃し、
    // ロック後に isSolidTile 側だけが「壁に埋まっている」と判定してしまう
    // （QA report.md 付録の既知バグ）。全面床の最小マップで再現する
    const state = createGame(1);
    const map = createMap(20, 20);
    map.tiles.fill(Tile.Floor);
    state.map = map;

    const room: RoomState = {
      rect: { x: 5, y: 5, w: 4, h: 4 },
      cleared: false,
      locked: false,
      doorTiles: [toIndex(map, 9, 5)],
      kind: "normal",
      wave: 0,
      used: false,
    };
    state.rooms = [room];
    state.lockedTiles = new Set();
    state.enemies = [];

    // 扉タイル (9,5) は px [144,160)×[80,96)。その左上隅 (144,80) から dx=dy=5 だけ
    // 斜めに離れた (139,75) に半径 6 の敵を置く。中心から隅までの距離は √50≈7.07 > 半径 6
    // なので円としては扉タイルに届かないが、AABB のタイル走査は (9,5) を含めてしまう
    const pos = { x: 139, y: 75 };
    const e = createEnemy(state, enemyDef("slime"), pos, 0, false);
    state.enemies.push(e);
    expect(e.body.radius).toBe(6);
    expect(overlapsWall(state, pos.x, pos.y, e.body.radius)).toBe(false);

    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked).toBe(true);
    expect(e.hp).toBeGreaterThan(0);
    expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius)).toBe(false);
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
