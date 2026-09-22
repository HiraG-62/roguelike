import { describe, expect, it } from "vitest";
import { createGame, descend, getPlayer, movePlayer } from "./state";
import { Tile, getTile, setTile } from "../map/grid";

describe("createGame", () => {
  it("同じ seed なら同じ初期状態", () => {
    const a = createGame(99);
    const b = createGame(99);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(getPlayer(a).pos).toEqual(getPlayer(b).pos);
  });

  it("プレイヤーは床の上から始まる", () => {
    const state = createGame(5);
    const { x, y } = getPlayer(state).pos;
    expect(getTile(state.map, x, y)).toBe(Tile.Floor);
  });
});

describe("movePlayer", () => {
  it("壁には進めない", () => {
    const state = createGame(5);
    const player = getPlayer(state);
    setTile(state.map, player.pos.x + 1, player.pos.y, Tile.Wall);
    const before = { ...player.pos };
    expect(movePlayer(state, { dx: 1, dy: 0 })).toBe(false);
    expect(player.pos).toEqual(before);
  });

  it("床には進める", () => {
    const state = createGame(5);
    const player = getPlayer(state);
    setTile(state.map, player.pos.x + 1, player.pos.y, Tile.Floor);
    const before = { ...player.pos };
    expect(movePlayer(state, { dx: 1, dy: 0 })).toBe(true);
    expect(player.pos).toEqual({ x: before.x + 1, y: before.y });
  });
});

describe("descend", () => {
  it("階段の上でなければ何も起きない", () => {
    const state = createGame(5);
    expect(descend(state)).toBe(false);
    expect(state.depth).toBe(1);
  });

  it("階段の上なら depth が増えて新しいマップになる", () => {
    const state = createGame(5);
    const player = getPlayer(state);
    setTile(state.map, player.pos.x, player.pos.y, Tile.StairsDown);
    const oldTiles = Array.from(state.map.tiles);
    expect(descend(state)).toBe(true);
    expect(state.depth).toBe(2);
    expect(Array.from(state.map.tiles)).not.toEqual(oldTiles);
    const { x, y } = player.pos;
    expect(getTile(state.map, x, y)).toBe(Tile.Floor);
  });
});
