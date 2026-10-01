import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Body, GameState } from "../core/state";
import { terrainCode } from "../core/terrain";
import { rayEnd } from "../skills/geom";
import { type GameMap, TILE_SIZE, Tile, createMap, isPassableTile, isWalkable, setTile, toIndex } from "../map/grid";
import { UNREACHABLE, chaseHeading, distanceField, lineOfSight, walkLine } from "../map/pathing";
import { revealAround } from "./explore";
import { overlapsShotWall, overlapsWall, isSolidTile, moveBody } from "./physics";
import { updateProjectiles } from "./projectiles";
import { terrainAt, updateTerrain } from "./terrain";
import { arena } from "./testHelpers";

/** 穴（Tile.Pit）の当たり・経路・弾・探索（docs/ideas/map-gen-impl.md 2-2）。# 壁 / . 床 / ~ 穴 */

const GLYPH_TILE: Readonly<Record<string, Tile>> = { "#": Tile.Wall, ".": Tile.Floor, "~": Tile.Pit };

function mapOf(rows: readonly string[]): GameMap {
  const map = createMap(rows[0]?.length ?? 0, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) setTile(map, x, y, GLYPH_TILE[row[x] ?? "#"] ?? Tile.Wall);
  });
  map.rooms = [{ x: 1, y: 1, w: map.width - 2, h: map.height - 2 }];
  return map;
}

/** 開始部屋に立った状態の地図だけを手作りの小さなものに替える */
function stateOn(map: GameMap): GameState {
  const state = arena();
  state.map = map;
  state.lockedTiles = new Set<number>();
  state.explored = new Uint8Array(map.width * map.height);
  state.exploredLog = [];
  return state;
}

function px(tile: number): number {
  return (tile + 0.5) * TILE_SIZE;
}

function bodyAt(x: number, y: number, radius = 6): Body {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, radius };
}

/** 縦の川（x = 4）を 1 マスだけ残して渡れない地図。行 5 に渡れる所がある */
const RIVER_WITH_FORD = ["#########", "#...~...#", "#...~...#", "#...~...#", "#...~...#", "#.......#", "#########"];
const RIVER_NO_FORD = ["#########", "#...~...#", "#...~...#", "#...~...#", "#...~...#", "#...~...#", "#########"];

describe("穴の体の当たり", () => {
  it("体は穴の手前で止まる（壁と同じ）", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    const body = bodyAt(px(2), px(2));
    const result = moveBody(state, body, TILE_SIZE * 5, 0);
    expect(result.hitX, "穴に当たる").toBe(true);
    expect(body.pos.x + body.radius, "穴タイル (x=4) の左端より内側").toBeLessThanOrEqual(TILE_SIZE * 4);
  });

  it("穴のタイルは通行不能・体の重なりに数える。タイルとしては通れない", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    expect(isSolidTile(state, 4, 2)).toBe(true);
    expect(overlapsWall(state, px(4), px(2), 2)).toBe(true);
    expect(isPassableTile(Tile.Pit)).toBe(false);
    expect(isWalkable(state.map, 4, 2)).toBe(false);
  });
});

describe("穴を越えるもの", () => {
  it("弾の壁判定は穴を数えず、壁は数える", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    expect(overlapsShotWall(state, px(4), px(2), 2), "穴の上").toBe(false);
    expect(overlapsShotWall(state, px(0), px(2), 2), "壁の上").toBe(true);
  });

  it("封鎖の扉は弾の壁判定でも壁", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    state.lockedTiles.add(toIndex(state.map, 2, 2));
    expect(overlapsShotWall(state, px(2), px(2), 2)).toBe(true);
  });

  it("プレイヤーの弾は穴を抜けて飛び続ける", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    state.projectiles = [
      {
        id: 9001,
        owner: "player",
        pos: { x: px(2), y: px(2) },
        vel: { x: 120, y: 0 },
        radius: 2,
        damage: 5,
        life: 3,
        color: "#fff",
        kind: "ranged",
        hitIds: new Set(),
        pierceLeft: 0,
      },
    ];
    // 穴 (x=4、右端 80px) を越えた先・外周の壁 (128px) の手前で止める
    for (let i = 0; i < 120 && (state.projectiles[0]?.pos.x ?? 0) < TILE_SIZE * 5.5; i++) {
      updateProjectiles(state, FIXED_DT);
      if (state.projectiles.length === 0) break;
    }
    const pr = state.projectiles[0];
    expect(pr, "穴で消えない").toBeDefined();
    expect(pr?.pos.x ?? 0, "穴の向こうまで進む").toBeGreaterThanOrEqual(TILE_SIZE * 5.5);
  });

  it("光線の終点は穴を越えて壁の手前まで届く", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    const end = rayEnd(state, { x: px(2), y: px(2) }, { x: 1, y: 0 }, TILE_SIZE * 20);
    expect(end.x, "穴 (x=4) を越える").toBeGreaterThan(TILE_SIZE * 5);
    expect(end.x, "外周の壁 (x=8) の手前").toBeLessThanOrEqual(TILE_SIZE * 8);
  });

  it("視線は穴を通し、壁は遮る", () => {
    const map = mapOf(["#########", "#...~...#", "#...#...#", "#########"]);
    expect(lineOfSight(map, { x: px(2), y: px(1) }, { x: px(6), y: px(1) }), "穴越しは見える").toBe(true);
    expect(lineOfSight(map, { x: px(2), y: px(2) }, { x: px(6), y: px(2) }), "壁越しは見えない").toBe(false);
  });
});

describe("穴を避ける経路", () => {
  it("距離場は穴を迂回し、渡れる所が無ければ届かない", () => {
    const ford = mapOf(RIVER_WITH_FORD);
    const goal = toIndex(ford, 6, 2);
    const field = distanceField(ford, goal);
    const from = toIndex(ford, 2, 2);
    // 直線なら 4 歩、浅瀬の行 5 まで下って渡って戻るので遠回りになる
    expect(field[from], "穴を通らない迂回の歩数").toBeGreaterThan(4);
    expect(field[toIndex(ford, 4, 2)], "穴のタイルは距離場に載らない").toBe(UNREACHABLE);

    const noFord = mapOf(RIVER_NO_FORD);
    const blocked = distanceField(noFord, toIndex(noFord, 6, 2));
    expect(blocked[toIndex(noFord, 2, 2)], "渡れない川の向こうには届かない").toBe(UNREACHABLE);
  });

  it("walkLine は穴を横切る線分を通さず、床だけの線分は通す", () => {
    const map = mapOf(RIVER_WITH_FORD);
    expect(walkLine(map, { x: px(2), y: px(2) }, { x: px(6), y: px(2) }), "穴を横切る").toBe(false);
    expect(walkLine(map, { x: px(1), y: px(5) }, { x: px(7), y: px(5) }), "渡れる行").toBe(true);
    expect(lineOfSight(map, { x: px(2), y: px(2) }, { x: px(6), y: px(2) }), "視線は通る").toBe(true);
  });

  it("chaseHeading は川の向こうの目標へ直進せず、渡れる所へ回る", () => {
    const map = mapOf(RIVER_WITH_FORD);
    // 縁（x=3）に立つ。直進すれば穴に張り付くので、渡れる行（下）へ向かう
    const pos = { x: px(3), y: px(3) };
    const target = { x: px(6), y: px(3) };
    const heading = chaseHeading(map, pos, target, { x: 1, y: 0 });
    expect(heading.y, "渡れる行（下）へ向かう").toBeGreaterThan(0.5);
  });

  it("chaseHeading は壁も穴も無ければ直進のまま", () => {
    const map = mapOf(["#######", "#.....#", "#######"]);
    const dir = { x: 1, y: 0 };
    expect(chaseHeading(map, { x: px(1), y: px(1) }, { x: px(5), y: px(1) }, dir)).toEqual(dir);
  });
});

describe("穴の探索と浅瀬", () => {
  it("探索で穴のタイルも塗る（川・池が地図に出る）", () => {
    const state = stateOn(mapOf(RIVER_NO_FORD));
    state.player.body.pos = { x: px(2), y: px(2) };
    revealAround(state);
    expect(state.explored[toIndex(state.map, 4, 2)], "穴を塗る").toBe(1);
    expect(state.explored[toIndex(state.map, 0, 2)], "壁は塗らない").toBe(0);
  });

  it("地図の浅い地形が地形の層へ写る（自然配置より先）", () => {
    const map = mapOf(RIVER_NO_FORD);
    const water = terrainCode("water");
    const shallow = new Uint8Array(map.width * map.height);
    shallow[toIndex(map, 2, 3)] = water;
    map.shallow = shallow;
    const state = stateOn(map);
    updateTerrain(state, FIXED_DT);
    expect(terrainAt(state, px(2), px(3)), "浅瀬は水").toBe("water");
  });
});
