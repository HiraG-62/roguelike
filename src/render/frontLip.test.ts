import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { Tile, TILE_SIZE, createMap } from "../map/grid";
import { arena, placeEnemy } from "../system/testHelpers";
import { LIP_BODY_PAD_DOWN, lipRects } from "./frontLip";
import type { LightView } from "./mapLight";

/** 上 10 行が床・下が壁の 30x20 の地図（南の壁の上端は y = 10 マス） */
function withSouthWall(): GameState {
  const state = arena(5);
  const map = createMap(30, 20);
  map.tiles.fill(Tile.Wall);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) map.tiles[y * 30 + x] = Tile.Floor;
  state.map = map;
  return state;
}

const WALL_TOP = 10 * TILE_SIZE;
const VIEW: LightView = { x: 0, y: 0, w: 480, h: 270 };

function putPlayer(state: GameState, x: number, y: number): void {
  state.player.body.pos = { x, y };
}

describe("lipRects（縁を描き直す範囲）", () => {
  it("壁から遠い体は範囲に入らず、何も描き直さない", () => {
    const state = withSouthWall();
    putPlayer(state, 15 * TILE_SIZE, 3 * TILE_SIZE);
    expect(lipRects(state, VIEW, []), "壁の近くに体が無い").toEqual([]);
  });

  it("南の壁に張り付いた自分の矩形は、足元の縁（壁の上端の前後）を覆う", () => {
    const state = withSouthWall();
    const r = state.player.body.radius;
    putPlayer(state, 15 * TILE_SIZE, WALL_TOP - r);
    const rects = lipRects(state, VIEW, []);
    expect(rects.length, "自分の 1 つ").toBe(1);
    const rect = rects[0];
    expect(rect, "矩形がある").toBeDefined();
    if (!rect) return;
    expect(rect.y, "壁の上端より上から").toBeLessThan(WALL_TOP - 3);
    expect(rect.y + rect.h, "壁の天面の帯 7px を覆う").toBeGreaterThanOrEqual(WALL_TOP + 7);
    expect(rect.x, "横は体の中心を含む").toBeLessThan(15 * TILE_SIZE);
    expect(rect.x + rect.w).toBeGreaterThan(15 * TILE_SIZE);
    expect(LIP_BODY_PAD_DOWN, "下の余白が天面の帯より広い").toBeGreaterThanOrEqual(7);
  });

  it("壁の近くの敵は範囲に入り、潜っている敵・画面外の敵は入らない", () => {
    const state = withSouthWall();
    putPlayer(state, 15 * TILE_SIZE, 2 * TILE_SIZE);
    const near = placeEnemy(state, "slime", 0, WALL_TOP - 2 * TILE_SIZE - 6);
    expect(lipRects(state, VIEW, []).length, "近い敵 1 体").toBe(1);
    near.hidden = true;
    expect(lipRects(state, VIEW, []).length, "潜行中は描かないので範囲に入れない").toBe(0);
    near.hidden = false;
    expect(lipRects(state, { ...VIEW, x: 10_000 }, []).length, "画面外").toBe(0);
  });

  it("out は呼ぶたびに空にしてから足す（使い回してよい）", () => {
    const state = withSouthWall();
    putPlayer(state, 15 * TILE_SIZE, WALL_TOP - state.player.body.radius);
    const out: LightView[] = [];
    lipRects(state, VIEW, out);
    lipRects(state, VIEW, out);
    expect(out.length, "増えない").toBe(1);
  });

  it("決定的（同じ入力で同じ矩形）", () => {
    const state = withSouthWall();
    putPlayer(state, 15 * TILE_SIZE, WALL_TOP - state.player.body.radius);
    const a = JSON.stringify(lipRects(state, VIEW, []));
    expect(JSON.stringify(lipRects(state, VIEW, [])), "同じ").toBe(a);
  });

  it("近い体の矩形は 1 つに束ね、束ねた後の矩形どうしは重ならない（暗がりが 2 回掛からない）", () => {
    const state = withSouthWall();
    const r = state.player.body.radius;
    putPlayer(state, 15 * TILE_SIZE, WALL_TOP - r);
    placeEnemy(state, "slime", 10, 0);
    placeEnemy(state, "slime", 200, 0);
    const rects = lipRects(state, VIEW, []);
    expect(rects.length, "自分と近い敵は 1 つ、遠い敵は別").toBe(2);
    const [a, b] = rects;
    if (!a || !b) return;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap, "重ならない").toBe(false);
  });
});
