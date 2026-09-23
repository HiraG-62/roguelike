import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { rectCenterPx } from "../map/grid";
import { withInput } from "../system/testHelpers";
import { buildRoomLookup, paintExplored } from "./minimap";

const RGBA = 4;
const ALPHA = 3;
const NO_BOSS = -1;

function paintedTiles(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i * RGBA < data.length; i++) if (data[i * RGBA + ALPHA]) out.push(i);
  return out;
}

describe("ミニマップ", () => {
  it("探索済みタイルだけを塗り、2 回目以降は差分だけ塗る", () => {
    const state = createGame(11);
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
    const state = createGame(11);
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
});
