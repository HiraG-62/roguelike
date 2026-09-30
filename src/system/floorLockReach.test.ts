import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, RoomState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { Tile, TILE_SIZE, createMap, toIndex } from "../map/grid";
import { createEnemy } from "./enemies";
import { updateRooms } from "./floor";
import { isSolidTile } from "./physics";

/**
 * 扉タイルで分かれた塊の部屋: 左の区画 A（x 5..8）と右の区画 B（x 10..13）の間に、塊に属さない床の 1 列（x = 9）がある。
 * その列は塊に 8 近傍で接するので扉タイルになり、封鎖すると A と B は歩いて行き来できない。
 */
const ROW_TOP = 5;
const ROW_BOTTOM = 8;
const A_LEFT = 5;
const A_RIGHT = 8;
const DOOR_COLUMN = 9;
const B_RIGHT = 13;
const STRAY_CHECK_TICKS = Math.round(1 / FIXED_DT);
/** 間隔の区切りに当たらない tick（波の湧きの寄せだけを見たいとき） */
const OFF_BEAT_TICK = 1;

function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

function splitBlobState(): { state: GameState; room: RoomState } {
  const state = createGame(1);
  const map = createMap(24, 14);
  map.tiles.fill(Tile.Wall);
  const tiles: number[] = [];
  const doors: number[] = [];
  for (let y = ROW_TOP; y <= ROW_BOTTOM; y++) {
    for (let x = A_LEFT; x <= B_RIGHT; x++) {
      map.tiles[toIndex(map, x, y)] = Tile.Floor;
      if (x === DOOR_COLUMN) doors.push(toIndex(map, x, y));
      else tiles.push(toIndex(map, x, y));
    }
  }
  state.map = map;
  const room: RoomState = {
    rect: { x: A_LEFT, y: ROW_TOP, w: B_RIGHT - A_LEFT + 1, h: ROW_BOTTOM - ROW_TOP + 1 },
    cleared: false,
    locked: false,
    doorTiles: doors,
    kind: "challenge",
    wave: 0,
    used: false,
    tiles: new Set(tiles),
  };
  state.rooms = [room];
  state.lockedTiles = new Set();
  state.enemies = [];
  // 区画 A の中（扉から 2 マス以上）に立つ
  state.player.body.pos = tileCenter(6, 6);
  return { state, room };
}

/** テスト側で持つ独立の到達判定（プレイヤーのタイルから 4 近傍、壁と封鎖中の扉は通れない） */
function reachableSet(state: GameState): Set<number> {
  const map = state.map;
  const sx = Math.floor(state.player.body.pos.x / TILE_SIZE);
  const sy = Math.floor(state.player.body.pos.y / TILE_SIZE);
  const seen = new Set<number>([toIndex(map, sx, sy)]);
  const queue = [{ x: sx, y: sy }];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (!c) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (isSolidTile(state, nx, ny) || seen.has(toIndex(map, nx, ny))) continue;
      seen.add(toIndex(map, nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

function tileOf(state: GameState, e: Enemy): number {
  return toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE));
}

function livingOwn(state: GameState): Enemy[] {
  return state.enemies.filter((e) => e.roomIndex === 0 && e.hp > 0);
}

/** 入室して封鎖させ、1 波目の湧きは消して空の封鎖状態にする */
function lockAndEmpty(state: GameState, room: RoomState): void {
  state.tick = OFF_BEAT_TICK;
  updateRooms(state, FIXED_DT);
  expect(room.locked, "部屋が封鎖される").toBe(true);
  state.enemies = [];
}

function addStray(state: GameState, key: string, pos: { x: number; y: number }): Enemy {
  const e = createEnemy(state, enemyDef(key), pos, 0, false);
  state.enemies.push(e);
  return e;
}

describe("封鎖した塊の部屋で扉の向こうに残った敵", () => {
  it("扉で分かれた向こう側の敵は、1 秒ごとの見回りで届く側の一番近いタイルへ寄せられる", () => {
    const { state, room } = splitBlobState();
    lockAndEmpty(state, room);
    const stray = addStray(state, "slime", tileCenter(11, 6));

    state.tick = OFF_BEAT_TICK;
    updateRooms(state, FIXED_DT);
    expect(stray.body.pos, "区切りでない tick では寄せない").toEqual(tileCenter(11, 6));

    state.tick = STRAY_CHECK_TICKS;
    updateRooms(state, FIXED_DT);
    expect(stray.body.pos, "元の位置（x=11, y=6）に一番近い届くタイルは扉の手前（x=8, y=6）").toEqual(tileCenter(A_RIGHT, 6));
    expect(reachableSet(state).has(tileOf(state, stray)), "届く").toBe(true);
  });

  it("寄せた敵は倒せるので、扉の向こうに残った敵を倒せば部屋が制圧される", () => {
    const { state, room } = splitBlobState();
    lockAndEmpty(state, room);
    const stray = addStray(state, "slime", tileCenter(12, 7));
    state.tick = STRAY_CHECK_TICKS;
    updateRooms(state, FIXED_DT);
    expect(reachableSet(state).has(tileOf(state, stray)), "寄せられて届く").toBe(true);

    for (let n = 0; n < 10 && !room.cleared; n++) {
      for (const e of livingOwn(state)) e.hp = 0;
      state.tick += 1;
      updateRooms(state, FIXED_DT);
    }
    expect(room.cleared, "制圧される").toBe(true);
    expect(room.locked, "扉が開く").toBe(false);
  });

  it("波の湧きの直後にも、届かない側の敵を寄せる（見回りの区切りでなくても）", () => {
    const { state, room } = splitBlobState();
    lockAndEmpty(state, room);
    // 生きた敵がいないので次の波が湧く（湧きは乱数で A・B のどちらにも出る）
    state.tick = OFF_BEAT_TICK;
    updateRooms(state, FIXED_DT);
    expect(room.wave, "次の波が湧く").toBeGreaterThan(1);
    const spawned = livingOwn(state);
    expect(spawned.length, "敵が湧く").toBeGreaterThan(0);
    const reach = reachableSet(state);
    for (const e of spawned) expect(reach.has(tileOf(state, e)), `敵 ${e.id} が届く側にいる`).toBe(true);
  });

  it("届く側にいる敵は動かさない", () => {
    const { state, room } = splitBlobState();
    lockAndEmpty(state, room);
    const near = addStray(state, "slime", tileCenter(7, 7));
    state.tick = STRAY_CHECK_TICKS;
    updateRooms(state, FIXED_DT);
    expect(near.body.pos, "位置はそのまま").toEqual(tileCenter(7, 7));
  });

  it("壁をすり抜ける敵が壁の中にいる間は寄せない", () => {
    const { state, room } = splitBlobState();
    lockAndEmpty(state, room);
    const wisp = addStray(state, "wisp", tileCenter(11, ROW_TOP - 1));
    expect(state.map.tiles[tileOf(state, wisp)], "置いた所は壁").toBe(Tile.Wall);
    state.tick = STRAY_CHECK_TICKS;
    updateRooms(state, FIXED_DT);
    expect(wisp.body.pos, "壁の中は通り抜けの途中").toEqual(tileCenter(11, ROW_TOP - 1));
  });

  it("封鎖の瞬間に扉の向こうの区画にいた敵も、封鎖と同時に届く側へ寄せる", () => {
    const { state, room } = splitBlobState();
    const stray = addStray(state, "slime", tileCenter(12, 6));
    state.tick = OFF_BEAT_TICK;
    updateRooms(state, FIXED_DT);
    expect(room.locked, "部屋が封鎖される").toBe(true);
    const reach = reachableSet(state);
    expect(reach.has(tileOf(state, stray)), "封鎖直後に届く").toBe(true);
    for (const e of livingOwn(state)) expect(reach.has(tileOf(state, e)), `敵 ${e.id} が届く側にいる`).toBe(true);
  });

  it("同じ入力なら同じ結果になる（決定性）", () => {
    const run = (): string => {
      const { state, room } = splitBlobState();
      lockAndEmpty(state, room);
      addStray(state, "slime", tileCenter(13, 5));
      addStray(state, "bat", tileCenter(11, 8));
      addStray(state, "slime", tileCenter(10, 7));
      for (let tick = 0; tick < STRAY_CHECK_TICKS * 3; tick++) {
        state.tick = tick + OFF_BEAT_TICK;
        updateRooms(state, FIXED_DT);
      }
      return JSON.stringify(state.enemies.map((e) => [e.id, e.body.pos.x, e.body.pos.y]));
    };
    expect(run(), "2 回の結果が一致").toBe(run());
  });
});
