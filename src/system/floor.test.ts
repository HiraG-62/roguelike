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
  it("湧き数は base 3 + floor(depth * 1.0)（depth1:4, depth2:5, depth5:8）。ROOM.baseEnemies は QA 2026-09-23 で 2 → 3、enemiesPerDepth は同日 2 巡目で 0.8 → 1.0", () => {
    const state = createGame(1);
    for (const [depth, expected] of [
      [1, 4],
      [2, 5],
      [3, 6],
      [4, 7],
      [5, 8],
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

/** 最小マップの部屋 (5..8, 5..8) の右壁に開いた扉 (9,6) と、その先の幅 1 の通路 (10..14, 6) */
const DOOR_TX = 9;
const DOOR_TY = 6;
const CORRIDOR_END_TX = 14;
const OTHER_ROOM = 1;

function doorCenter(): { x: number; y: number } {
  return { x: (DOOR_TX + 0.5) * TILE_SIZE, y: (DOOR_TY + 0.5) * TILE_SIZE };
}

/**
 * 壁で囲んだ部屋 1 つと細い通路だけの最小マップ。扉の中心から部屋の中心への向きは斜めなので、
 * 通路側へ押し出すには斜め方向ではなく軸方向の候補が必要になる
 */
function corridorRoomState(): { state: GameState; room: RoomState } {
  const state = createGame(1);
  const map = createMap(20, 20);
  map.tiles.fill(Tile.Wall);
  for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
  for (let x = DOOR_TX; x <= CORRIDOR_END_TX; x++) map.tiles[toIndex(map, x, DOOR_TY)] = Tile.Floor;
  state.map = map;
  const room: RoomState = {
    rect: { x: 5, y: 5, w: 4, h: 4 },
    cleared: false,
    locked: false,
    doorTiles: [toIndex(map, DOOR_TX, DOOR_TY)],
    kind: "normal",
    wave: 0,
    used: false,
  };
  state.rooms = [room];
  state.lockedTiles = new Set();
  state.enemies = [];
  return { state, room };
}

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

  it("他室所属の敵が扉タイル上にいても、ロック時に部屋の外側（通路）へ押し出され壁に埋まらない", () => {
    // QA seed=50025/50028: プレイヤーを追って隣室から来た敵（roomIndex が別）が扉の上にいると、
    // 押し出し対象が自室の敵だけだったためロック済み扉に埋まっていた
    const { state, room } = corridorRoomState();
    const e = createEnemy(state, enemyDef("slime"), doorCenter(), OTHER_ROOM, false);
    state.enemies.push(e);

    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked, "部屋がロックされる").toBe(true);
    expect(state.enemies.includes(e), "押し出せたので取り除かれない").toBe(true);
    expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius), "ロック済み扉に埋まらない").toBe(false);
    expect(e.body.pos.x - e.body.radius, "通路側（部屋の外）へ出る").toBeGreaterThanOrEqual((DOOR_TX + 1) * TILE_SIZE);
  });

  it("この step で撃破済みの敵も扉タイルから押し出し、死亡時処理のため配列には残す", () => {
    // QA seed=50020: 撃破済みの敵は次の updateEnemies まで配列に残るので、その 1 フレームだけ扉に埋まっていた
    const { state, room } = corridorRoomState();
    const dead = createEnemy(state, enemyDef("slime"), doorCenter(), 0, false);
    dead.hp = 0;
    state.enemies.push(dead);

    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked, "部屋がロックされる").toBe(true);
    expect(state.enemies.includes(dead), "撃破済みの敵は死亡時処理のため残る").toBe(true);
    expect(overlapsWall(state, dead.body.pos.x, dead.body.pos.y, dead.body.radius), "ロック済み扉に埋まらない").toBe(false);
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
