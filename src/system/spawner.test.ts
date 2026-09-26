import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { Enemy, GameState } from "../core/state";
import { MAP_SIZE, ROAM } from "../data/tuning";
import { TILE_SIZE, Tile, toIndex } from "../map/grid";
import { updateRooms, withBaseAreaMul } from "./floor";
import { ROAMING_ROOM, roamCap } from "./spawner";

/**
 * 通路への初期配置（populateCorridors）・部屋の制圧との独立・徘徊の上限式・生成の決定性（設計書 3.4 C-1〜C-4）
 */

/** 部屋の内側（矩形は外周 1 マスを除く、塊は room.tiles）かどうか。spawner.ts の markRoomInterior と同じ考え方 */
function inRoomInterior(state: GameState, tileIndex: number): boolean {
  return state.rooms.some((room) => {
    if (room.tiles) return room.tiles.has(tileIndex);
    const r = room.rect;
    const x = tileIndex % state.map.width;
    const y = Math.floor(tileIndex / state.map.width);
    return x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1;
  });
}

function tileOf(state: GameState, e: Enemy): number {
  return toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE));
}

/** 生成直後（まだ 1 step も動いていない）の徘徊のうち、通路（どの部屋の内側でもない床）に立っているもの */
function corridorRoamers(state: GameState): Enemy[] {
  return state.enemies.filter((e) => e.roomIndex === ROAMING_ROOM && !inRoomInterior(state, tileOf(state, e)));
}

/** 通路の床タイル数（どの部屋の内側でもない Tile.Floor）。populateCorridors の want の分母と同じ数え方 */
function corridorTileCount(state: GameState): number {
  const map = state.map;
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === Tile.Floor && !inRoomInterior(state, i)) n++;
  }
  return n;
}

describe("通路への初期配置（spawner.ts の populateCorridors）", () => {
  it("通路の床タイル数に応じた数（corridorPerTiles ごとに 1 体、上限 corridorMax）だけ通路に徘徊が立ち、部屋の内側には置かない", () => {
    let sawCorridorRoamer = false;
    for (let seed = 0; seed < 15; seed++) {
      const state = createGame(seed);
      const roamers = corridorRoamers(state);
      const want = Math.min(ROAM.corridorMax, Math.floor(corridorTileCount(state) / ROAM.corridorPerTiles));
      expect(roamers.length, `seed=${seed} 通路の徘徊は式の上限を超えない`).toBeLessThanOrEqual(want);
      for (const e of roamers) {
        expect(inRoomInterior(state, tileOf(state, e)), `seed=${seed} 部屋の内側に置かない`).toBe(false);
      }
      if (roamers.length > 0) sawCorridorRoamer = true;
    }
    expect(sawCorridorRoamer, "いずれかの seed で通路に徘徊が立つ").toBe(true);
  });

  it("上限の式: min(corridorMax, floor(通路タイル数 / corridorPerTiles))", () => {
    const state = withBaseAreaMul(() => createGame(9));
    const tiles = corridorTileCount(state);
    const want = Math.min(ROAM.corridorMax, Math.floor(tiles / ROAM.corridorPerTiles));
    expect(corridorRoamers(state).length).toBeLessThanOrEqual(want);
    expect(want).toBeLessThanOrEqual(ROAM.corridorMax);
  });

  it("通路の徘徊はどの部屋にも属さない（roomIndex = ROAMING_ROOM）ので、部屋の制圧（全滅判定）に関わらない", () => {
    // 通路に徘徊が立つ広い階を探す
    let found: { state: GameState; roamers: Enemy[] } | null = null;
    for (let seed = 0; seed < 20 && !found; seed++) {
      const state = createGame(seed);
      const roamers = corridorRoamers(state);
      if (roamers.length > 0) found = { state, roamers };
    }
    if (!found) throw new Error("通路に徘徊が立つ seed が見つからない");
    const { state, roamers } = found;
    for (const e of roamers) expect(e.roomIndex, "部屋に属さない").toBe(ROAMING_ROOM);
    // 通常の部屋を 1 つ選び、その部屋の敵だけ全滅させる。通路の徘徊は生かしたまま
    const index = state.rooms.findIndex((r, i) => i > 0 && r.kind === "normal" && state.enemies.some((e) => e.roomIndex === i));
    if (index < 0) throw new Error("敵のいる通常の部屋が無い");
    const room = state.rooms[index];
    if (!room) throw new Error("部屋が無い");
    room.engaged = true;
    for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
    expect(roamers.some((e) => e.hp > 0), "通路の徘徊は生きたまま").toBe(true);
    updateRooms(state, 1 / 60);
    expect(state.rooms[index]?.cleared, "通路に徘徊が残っていても部屋は制圧扱いになる").toBe(true);
  });

  it("同じ seed なら通路の徘徊の数・位置・敵の種類が同じ（決定的）", () => {
    const a = corridorRoamers(createGame(6)).map((e) => ({ defKey: e.defKey, x: e.body.pos.x, y: e.body.pos.y }));
    const b = corridorRoamers(createGame(6)).map((e) => ({ defKey: e.defKey, x: e.body.pos.x, y: e.body.pos.y }));
    expect(b).toEqual(a);
  });
});

describe("徘徊の上限の式（roamCap）", () => {
  it("capBase + floor(depth * capPerDepth) を capMax で頭打ちにし、面積の倍率 ^ roamCapExp を掛けて四捨五入する", () => {
    for (const depth of [0, 1, 3, 10, 40]) {
      const base = Math.min(ROAM.capMax, ROAM.capBase + Math.floor(depth * ROAM.capPerDepth));
      expect(roamCap(depth, 1)).toBe(base);
      const areaMul = 4;
      expect(roamCap(depth, areaMul)).toBe(Math.round(base * areaMul ** MAP_SIZE.roamCapExp));
    }
  });
});
