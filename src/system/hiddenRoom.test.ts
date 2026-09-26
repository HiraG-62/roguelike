import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { GameState, HiddenRoom } from "../core/state";
import { BOSS, HIDDEN_ROOM } from "../data/tuning";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import { UNREACHABLE, distanceField, tileOf } from "../map/pathing";
import { buildFloor, descend } from "./floor";
import { planHidden, updateHiddenRoom } from "./hiddenRoom";
import { stairsChoiceAt } from "./specialRooms";
import { arena, slayFloorLord } from "./testHelpers";

/** ボスも階の主も出ない rooms 型の階を作る（HIDDEN_ROOM.minDepth 以上・BOSS.interval の倍数を避ける） */
function roomsFloor(seed: number, depth = 3): GameState {
  const state = arena(seed);
  state.depth = depth;
  buildFloor(state, "rooms");
  return state;
}

/** rng.chance を強制的に true にして隠し部屋を計画させる（テスト専用。抽選自体は planHiddenRoom のまま） */
function forceHidden(state: GameState): HiddenRoom {
  state.hiddenRoom = null;
  state.rng = { ...state.rng, chance: () => true };
  planHidden(state);
  const hr = state.hiddenRoom;
  if (!hr) throw new Error("隠し部屋が計画されなかった（テストの前提が崩れている）");
  return hr;
}

function doorCenterPx(state: GameState, hr: HiddenRoom): { x: number; y: number } {
  return {
    x: ((hr.doorTile % state.map.width) + 0.5) * TILE_SIZE,
    y: (Math.floor(hr.doorTile / state.map.width) + 0.5) * TILE_SIZE,
  };
}

/** プレイヤーを扉タイルへ重ねて openHold 秒ぶん更新する */
function openByStanding(state: GameState, hr: HiddenRoom): void {
  state.player.body.pos = doorCenterPx(state, hr);
  const steps = Math.ceil(HIDDEN_ROOM.openHold / FIXED_DT) + 2;
  for (let i = 0; i < steps; i++) updateHiddenRoom(state, FIXED_DT);
}

describe("隠し部屋", () => {
  it("計画直後はポケット・扉が壁のままで、経路も通れない", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    expect(getTile(state.map, hr.doorTile % state.map.width, Math.floor(hr.doorTile / state.map.width))).toBe(Tile.Wall);
    for (const t of hr.tiles) {
      expect(getTile(state.map, t % state.map.width, Math.floor(t / state.map.width))).toBe(Tile.Wall);
    }
    const start = tileOf(state.map, state.player.body.pos);
    const field = distanceField(state.map, start);
    expect(field[hr.doorTile] ?? UNREACHABLE, "扉タイルへは経路が届かない").toBe(UNREACHABLE);
  });

  it("5 の倍数の階（ボス階）には計画しない", () => {
    const state = roomsFloor(9, BOSS.interval);
    state.hiddenRoom = null;
    state.rng = { ...state.rng, chance: () => true };
    planHidden(state);
    expect(state.hiddenRoom).toBeNull();
  });

  it("扉に体を押し当てて openHold 秒で開き、階段と遺物が出て state.stairs に行き先が入る", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    const itemsBefore = state.floorItems.length;
    openByStanding(state, hr);
    expect(hr.opened).toBe(true);
    expect(getTile(state.map, hr.doorTile % state.map.width, Math.floor(hr.doorTile / state.map.width))).toBe(Tile.Floor);
    expect(getTile(state.map, hr.stairsTile % state.map.width, Math.floor(hr.stairsTile / state.map.width))).toBe(Tile.StairsDown);
    expect(state.stairs.some((s) => s.tile === hr.stairsTile && s.nextKind === hr.nextKind), "行き先が登録される").toBe(true);
    expect(state.floorItems.length - itemsBefore, "遺物が items 個落ちる").toBe(HIDDEN_ROOM.items);
  });

  it("離れている間は hold が進まず、押し当て続けている間だけ進む", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    const door = doorCenterPx(state, hr);
    state.player.body.pos = { x: door.x + 1000, y: door.y };
    updateHiddenRoom(state, FIXED_DT);
    expect(hr.hold).toBe(0);
    state.player.body.pos = door;
    updateHiddenRoom(state, FIXED_DT);
    expect(hr.hold).toBeGreaterThan(0);
    expect(hr.opened, "openHold にはまだ届かない").toBe(false);
  });

  it("hintRadius に入ると一度だけ手がかり（ログ・音）が出る", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    const door = doorCenterPx(state, hr);
    state.player.body.pos = { x: door.x + HIDDEN_ROOM.hintRadius - 1, y: door.y };
    updateHiddenRoom(state, FIXED_DT);
    expect(hr.hinted).toBe(true);
    expect(state.sfx).toContain("hiddenHint");
    state.sfx = [];
    updateHiddenRoom(state, FIXED_DT);
    expect(state.sfx, "2 回目は出さない").not.toContain("hiddenHint");
  });

  it("開いた階段からは、その階の主を倒さなくても次の階へ行ける", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    openByStanding(state, hr);
    expect(state.boss?.defeated ?? false, "階の主はまだ倒していない").toBe(false);
    const depthBefore = state.depth;
    descend(state, stairsChoiceAt(state, hr.stairsTile));
    expect(state.depth, "次の階へ進める").toBe(depthBefore + 1);
  });

  it("先に開いた隠し部屋の階段は、階の主を倒して分岐の階段が出ても置き直されない", () => {
    const state = roomsFloor(9);
    const hr = forceHidden(state);
    const pending = state.stairs.filter((s) => s.tile < 0).length;
    openByStanding(state, hr);
    slayFloorLord(state);
    expect(state.boss?.defeated).toBe(true);
    expect(state.stairs.some((s) => s.tile < 0), "階段はすべて置かれた").toBe(false);
    expect(stairsChoiceAt(state, hr.stairsTile), "隠し部屋の階段の行き先が残る").toBe(hr.nextKind);
    const forks = state.stairs.filter((s) => s.tile !== hr.stairsTile);
    expect(forks.length, "最後の部屋の階段は分岐の数を超えない").toBeLessThanOrEqual(pending);
    for (const s of forks) expect(hr.tiles, "分岐の階段はポケットの中には無い").not.toContain(s.tile);
  });

  it("同じ seed・状態なら同じ場所を計画する（決定的）", () => {
    const a = roomsFloor(9);
    const b = roomsFloor(9);
    const hrA = forceHidden(a);
    const hrB = forceHidden(b);
    expect(hrA.doorTile).toBe(hrB.doorTile);
    expect(hrA.stairsTile).toBe(hrB.stairsTile);
    expect(hrA.nextKind).toBe(hrB.nextKind);
  });
});
