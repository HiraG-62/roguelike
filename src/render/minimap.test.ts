import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOSS, MINIMAP } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { buildFloor } from "../system/floor";
import { resetExplored, revealAround } from "../system/explore";
import { createRng } from "../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, generateMap, scaleGeneratorOptions } from "../map/generator";
import { withInput } from "../system/testHelpers";
import { Minimap, buildRoomLookup, minimapSize, paintExplored } from "./minimap";

const RGBA = 4;
const ALPHA = 3;
const NO_BOSS = -1;

function paintedTiles(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i * RGBA < data.length; i++) if (data[i * RGBA + ALPHA]) out.push(i);
  return out;
}

/** 基準の大きさ（縮尺 1 = 1 タイル 1px）の階。ボス階は面積の倍率が 1 のまま */
function baseSizeGame(): GameState {
  const state = createGame(11);
  state.depth = BOSS.interval;
  buildFloor(state);
  return state;
}

/** 面積 4 倍のマップに差し替えた階（MAP_SIZE の設定に依らずに縮尺を確かめる） */
const WIDE_AREA_MUL = 4;
function wideGame(): GameState {
  const state = createGame(11);
  state.map = generateMap("rooms", createRng(11), scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, WIDE_AREA_MUL));
  state.rooms = state.map.rooms.map((rect) => ({ rect, cleared: false, locked: false, doorTiles: [], kind: "normal", wave: 0, used: false, tiles: undefined }));
  const start = state.map.rooms[0];
  if (!start) throw new Error("開始部屋が無い");
  state.player.body.pos = rectCenterPx(start);
  resetExplored(state);
  revealAround(state);
  return state;
}

describe("ミニマップ", () => {
  it("探索済みタイルだけを塗り、2 回目以降は差分だけ塗る", () => {
    const state = baseSizeGame();
    const lookup = buildRoomLookup(state);
    const data = new Uint8ClampedArray(state.map.tiles.length * RGBA);
    let cursor = paintExplored(data, state, lookup, NO_BOSS, 0);
    expect(cursor).toBe(state.exploredLog.length);
    expect(paintedTiles(data).sort((a, b) => a - b)).toEqual([...state.exploredLog].sort((a, b) => a - b));

    // 何も増えていなければ何も塗らない
    expect(paintExplored(data, state, lookup, NO_BOSS, cursor)).toBe(cursor);

    const room = state.rooms[1];
    if (!room) throw new Error("room missing");
    state.player.body.pos = rectCenterPx(room.rect);
    step(state, withInput({}), FIXED_DT);
    const added = state.exploredLog.slice(cursor);
    expect(added.length).toBeGreaterThan(0);
    cursor = paintExplored(data, state, lookup, NO_BOSS, cursor);
    expect(cursor).toBe(state.exploredLog.length);
    expect(paintedTiles(data)).toHaveLength(state.exploredLog.length);
  });

  it("部屋の種類とボス部屋で色が変わり、通路は部屋と違う色", () => {
    const state = baseSizeGame();
    const lookup = buildRoomLookup(state);
    const room = state.rooms[1];
    if (!room) throw new Error("room missing");
    // 洞窟の部屋は矩形の隅が所属タイルとは限らないので、所属タイルがあればそこから取る
    const inRoom = room.tiles ? [...room.tiles][0]! : room.rect.y * state.map.width + room.rect.x;
    const corridor = lookup.roomOf.findIndex((r, i) => r === -1 && state.map.tiles[i] !== 0);
    state.exploredLog = [inRoom, corridor];
    const normal = new Uint8ClampedArray(state.map.tiles.length * RGBA);
    paintExplored(normal, state, lookup, NO_BOSS, 0);
    const boss = new Uint8ClampedArray(state.map.tiles.length * RGBA);
    paintExplored(boss, state, lookup, 1, 0);
    room.kind = "treasure";
    const treasure = new Uint8ClampedArray(state.map.tiles.length * RGBA);
    paintExplored(treasure, state, lookup, NO_BOSS, 0);
    const px = (d: Uint8ClampedArray, t: number): number[] => Array.from(d.slice(t * RGBA, t * RGBA + ALPHA));
    expect(px(normal, inRoom)).not.toEqual(px(normal, corridor));
    expect(px(boss, inRoom)).not.toEqual(px(normal, inRoom));
    expect(px(treasure, inRoom)).not.toEqual(px(normal, inRoom));
  });

  it("基準の大きさの階は縮めない（1 タイル = 1px）", () => {
    const state = baseSizeGame();
    const size = minimapSize(state.map);
    expect(size.scale).toBe(1);
    expect(size.w).toBe(state.map.width);
    expect(size.h).toBe(state.map.height);
  });

  it("広い階の縮尺は上限の大きさに収まり、画面の 4 分の 1 を塞がない", () => {
    const state = wideGame();
    const size = minimapSize(state.map);
    expect(state.map.width, "広い階").toBeGreaterThan(MINIMAP.maxWidth);
    expect(size.scale).toBeLessThan(1);
    expect(size.w).toBeLessThanOrEqual(MINIMAP.maxWidth);
    expect(size.h).toBeLessThanOrEqual(MINIMAP.maxHeight);
    expect(size.w * size.h, "画面の 4 分の 1 以下").toBeLessThanOrEqual((VIEW_W * VIEW_H) / 4);
    expect(Minimap.bottom(state), "HUD の文字はミニマップの下").toBeLessThan(VIEW_H / 2);
  });

  it("縮めても探索済みタイルは縮めた画像の中に塗られる", () => {
    const state = wideGame();
    const size = minimapSize(state.map);
    const lookup = buildRoomLookup(state);
    const data = new Uint8ClampedArray(size.w * size.h * RGBA);
    expect(state.exploredLog.length).toBeGreaterThan(0);
    paintExplored(data, state, lookup, NO_BOSS, 0);
    const painted = paintedTiles(data);
    expect(painted.length, "何か塗る").toBeGreaterThan(0);
    // 縮めたので塗った画素はタイルより少ないか同じ
    expect(painted.length).toBeLessThanOrEqual(state.exploredLog.length);
  });
});
