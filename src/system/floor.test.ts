import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { enemiesForDepth, enemyDef } from "../data/enemies";
import type { GameState, RoomState } from "../core/state";
import { Tile, createMap, rectCenterPx, TILE_SIZE, toIndex } from "../map/grid";
import { eliteChance } from "./elites";
import { createEnemy } from "./enemies";
import { buildFloor, descend, enemyCount, updateRooms } from "./floor";
import { FLOOR_KIND, ROAM, ROOM, ROOM_KIND } from "../data/tuning";
import { grantBoon } from "./boons";
import { ROAMING_ROOM, reinforceDue, roamCap, roamerCount, updateRoamers } from "./spawner";
import { nextWaypoint } from "../map/pathing";
import { terrainCode } from "../core/terrain";
import { biomeEnemyWeight, floorKindCandidates } from "./biomes";
import { stairsTilesValid } from "./specialRooms";
import { overlapsWall } from "./physics";
import { engagedRoomIndex, isEngaged } from "./engagement";
import { isLastKillInEngagedRoom } from "./combat";
import { VIEW_H, VIEW_W } from "../core/view";

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

/**
 * 開始部屋以外で kind="normal" かつ doorTiles を持つ部屋を探し、封鎖する種類（伏兵）にする
 * （開放型フロアでは通常の部屋は封鎖しない）
 */
function findLockableRoom(state: GameState): { room: RoomState; index: number } | null {
  for (let i = 1; i < state.rooms.length; i++) {
    const room = state.rooms[i]!;
    if (room.kind !== "normal" || room.cleared || room.doorTiles.length === 0) continue;
    room.kind = "ambush";
    return { room, index: i };
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
    kind: "ambush",
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
      kind: "ambush",
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

describe("分岐路（階段ごとの行き先）", () => {
  it("最後の部屋に 1〜3 個の階段が置かれ、行き先は次の階の候補から重複なしで選ばれる", () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(seed);
      expect(state.stairs.length, `seed=${seed}`).toBeGreaterThanOrEqual(1);
      expect(state.stairs.length).toBeLessThanOrEqual(FLOOR_KIND.forkMax);
      const kinds = state.stairs.map((s) => s.nextKind);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const k of kinds) expect(floorKindCandidates(state.depth + 1)).toContain(k);
      expect(stairsTilesValid(state)).toBe(true);
      const last = state.rooms[state.rooms.length - 1]!;
      for (const s of state.stairs) {
        const x = s.tile % state.map.width;
        const y = Math.floor(s.tile / state.map.width);
        const inRect = x >= last.rect.x && x < last.rect.x + last.rect.w && y >= last.rect.y && y < last.rect.y + last.rect.h;
        expect(last.tiles ? last.tiles.has(s.tile) : inRect, "最後の部屋（塊）の中").toBe(true);
      }
    }
  });

  it("同じ seed なら同じ分岐（決定的）", () => {
    expect(createGame(33).stairs).toEqual(createGame(33).stairs);
  });

  it("階段を踏むと、その階段の行き先のフロア種別へ降りる", () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(seed);
      const choice = state.stairs[state.stairs.length - 1];
      if (!choice || state.stairs.length < 2) continue;
      const x = ((choice.tile % state.map.width) + 0.5) * TILE_SIZE;
      const y = (Math.floor(choice.tile / state.map.width) + 0.5) * TILE_SIZE;
      state.player.body.pos = { x, y };
      updateRooms(state, FIXED_DT);
      expect(state.depth).toBe(2);
      expect(state.floorKind).toBe(choice.nextKind);
      return;
    }
    throw new Error("分岐のある seed が見つからない");
  });

  it("descend に行き先を渡すとそのバイオームになり、地形が置かれる", () => {
    const state = createGame(8);
    state.depth = 4;
    descend(state, "forge");
    expect(state.floorKind).toBe("forge");
    let lava = 0;
    for (let i = 0; i < state.terrain.kinds.length; i++) if (state.terrain.kinds[i] === terrainCode("lava")) lava++;
    expect(lava).toBeGreaterThan(0);
  });

  it("骨の墓所は最初から部屋に死骸が転がっている", () => {
    const state = createGame(8);
    state.depth = 4;
    descend(state, "ossuary");
    expect(state.corpses.filter((c) => c.depth === state.depth).length).toBeGreaterThan(0);
  });

  it("バイオームのファミリーの敵は出やすい", () => {
    const def = enemyDef("fireSlime");
    expect(biomeEnemyWeight(def, "forge")).toBe(def.weight * FLOOR_KIND.familyMul);
    expect(biomeEnemyWeight(def, "rooms")).toBe(def.weight);
  });

  it("ボス階は撃破まで行き先だけ決まっていて、撃破で中央の階段の横に分岐の階段が置かれる", () => {
    const state = createGame(5);
    state.depth = 2;
    descend(state);
    expect(state.depth).toBe(3);
    expect(state.boss).not.toBeNull();
    expect(state.stairs.every((s) => s.tile < 0)).toBe(true);
    const room = state.rooms[state.boss!.roomIndex]!;
    const c = { x: Math.floor(room.rect.x + room.rect.w / 2), y: Math.floor(room.rect.y + room.rect.h / 2) };
    state.map.tiles[toIndex(state.map, c.x, c.y)] = Tile.StairsDown;
    state.boss!.defeated = true;
    state.player.body.pos = rectCenterPx(state.rooms[0]!.rect);
    updateRooms(state, FIXED_DT);
    expect(state.stairs.length).toBeGreaterThanOrEqual(1);
    expect(state.stairs.every((s) => s.tile >= 0)).toBe(true);
    expect(stairsTilesValid(state)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 開放型フロア（memo/20260924-1.md「優先的」1〜2）
// -----------------------------------------------------------------------------

/** 敵のいる、封鎖しない未制圧の部屋 */
function openRoomWithEnemies(state: GameState): number {
  const index = state.rooms.findIndex(
    (r, i) => i > 0 && r.kind === "normal" && !r.cleared && state.enemies.some((e) => e.roomIndex === i && e.hp > 0),
  );
  if (index < 0) throw new Error("敵のいる通常の部屋が無い");
  return index;
}

function killRoomEnemies(state: GameState, index: number): void {
  for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
}

/** 巣窟のあるフロアを seed 総当たりで探す */
function floorWithHorde(depth: number): { state: GameState; index: number } {
  for (let seed = 0; seed < SEARCH_SEEDS * 4; seed++) {
    const state = createGame(seed);
    state.depth = depth;
    buildFloor(state);
    const index = state.rooms.findIndex((r) => r.kind === "horde");
    if (index >= 0) return { state, index };
  }
  throw new Error("巣窟のあるフロアが見つからない");
}

describe("開放型フロア: 封鎖しない部屋の交戦と制圧", () => {
  it("1 階は洞窟の形で、通常の部屋に入っても封鎖せず、部屋の敵がまとめて起きる", () => {
    const state = createGame(4);
    expect(state.floorKind).toBe("cave");
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);
    expect(room.locked, "封鎖しない").toBe(false);
    expect(state.lockedTiles.size, "扉は閉じない").toBe(0);
    expect(room.engaged, "交戦が始まる").toBe(true);
    const idle = state.enemies.filter((e) => e.roomIndex === index && e.phase === "idle");
    expect(idle, "部屋の敵は全員起きる").toHaveLength(0);
  });

  it("部屋の外にいても、部屋の敵が気付けば交戦が始まる", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    const first = state.enemies.find((e) => e.roomIndex === index)!;
    first.phase = "chase";
    updateRooms(state, FIXED_DT);
    expect(room.engaged).toBe(true);
    expect(state.enemies.filter((e) => e.roomIndex === index && e.phase === "idle")).toHaveLength(0);
  });

  it("部屋の敵を全滅させると 1 回だけ制圧し、湧水（onBoonRoomClear）と得点が 1 回だけ入る", () => {
    const state = createGame(4);
    grantBoon(state, "springWell");
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    killRoomEnemies(state, index);
    state.player.mana = 0;
    const score = state.score;
    updateRooms(state, FIXED_DT);
    expect(room.cleared, "全滅で制圧").toBe(true);
    expect(state.player.mana, "湧水でマナが満ちる").toBe(state.stats.maxMana);
    expect(state.score - score, "制圧の得点").toBe(ROOM.clearBonus);
    state.player.mana = 0;
    updateRooms(state, FIXED_DT);
    updateRooms(state, FIXED_DT);
    expect(state.player.mana, "2 回目は起きない").toBe(0);
    expect(state.score - score, "得点も 1 回だけ").toBe(ROOM.clearBonus);
  });

  it("交戦していない部屋は、敵がいても制圧されない。敵を置けなかった通常の部屋は最初から制圧済み", () => {
    for (let seed = 0; seed < 10; seed++) {
      const state = createGame(seed);
      state.rooms.forEach((room, i) => {
        if (room.kind !== "normal" || i === 0) return;
        const has = state.enemies.some((e) => e.roomIndex === i);
        expect(room.cleared, `seed=${seed} room=${i}`).toBe(!has);
      });
    }
  });
});

/** 部屋の所属タイル（塊）か矩形の中心のピクセル座標。塊の矩形中心は所属タイルとは限らない */
function roomTilePx(state: GameState, room: RoomState): { x: number; y: number } {
  const first = room.tiles?.values().next().value;
  if (first === undefined) return rectCenterPx(room.rect);
  const tx = first % state.map.width;
  const ty = Math.floor(first / state.map.width);
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

describe("交戦中（isEngaged）: 封鎖中 または 開放型の交戦中", () => {
  it("入室前は交戦中でない。外で気付かれても、入るまでは交戦中でない。入ると交戦中、全滅で制圧して解ける", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    state.player.invulnTimer = 999;
    expect(isEngaged(state), "入室前").toBe(false);
    state.enemies.find((e) => e.roomIndex === index)!.phase = "chase";
    updateRooms(state, FIXED_DT);
    expect(room.engaged, "気付かれて交戦が始まる").toBe(true);
    // 部屋の敵から離れた所へ置く（気付いた敵が近くにいれば部屋の外でも交戦中になるため）
    for (const e of state.enemies) if (e.roomIndex === index) e.body.pos = { x: -10_000, y: -10_000 };
    expect(isEngaged(state), "部屋の外で、気付いた敵も近くにいなければ交戦中でない").toBe(false);
    state.player.body.pos = roomTilePx(state, room);
    expect(isEngaged(state), "交戦の始まった部屋に入ると交戦中").toBe(true);
    expect(engagedRoomIndex(state), "今いる交戦中の部屋").toBe(index);
    killRoomEnemies(state, index);
    expect(isEngaged(state), "生きた敵がいなければ交戦中でない").toBe(false);
    updateRooms(state, FIXED_DT);
    expect(room.cleared, "全滅で制圧").toBe(true);
    expect(isEngaged(state), "制圧後").toBe(false);
  });

  it("部屋の外（通路）でも、その部屋の気付いた敵が近くで生きている間は交戦中。離れるか倒すと解ける", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    state.player.invulnTimer = 999;
    const chaser = state.enemies.find((e) => e.roomIndex === index)!;
    chaser.phase = "chase";
    updateRooms(state, FIXED_DT);
    expect(room.engaged).toBe(true);
    for (const e of state.enemies) if (e.roomIndex === index) e.body.pos = { x: -10_000, y: -10_000 };
    const p = state.player.body.pos;
    expect(isEngaged(state), "部屋の外で敵が遠い").toBe(false);
    chaser.body.pos = { x: p.x + ROAM.engageLeash - 1, y: p.y };
    expect(engagedRoomIndex(state), "追ってきた敵が近くにいれば、その部屋で交戦中").toBe(index);
    chaser.body.pos = { x: p.x + ROAM.engageLeash + 1, y: p.y };
    expect(isEngaged(state), "引き離すと交戦中でない").toBe(false);
    chaser.body.pos = { x: p.x + 1, y: p.y };
    chaser.hp = 0;
    expect(isEngaged(state), "倒すと交戦中でない").toBe(false);
  });

  it("徘徊の敵（どの部屋にも属さない）が近くにいても交戦中にはならない", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    const e = state.enemies.find((x) => x.roomIndex === index)!;
    e.roomIndex = ROAMING_ROOM;
    e.phase = "chase";
    e.body.pos = { x: state.player.body.pos.x + 1, y: state.player.body.pos.y };
    expect(isEngaged(state)).toBe(false);
  });

  it("封鎖中の部屋は敵がいない波の合間でも交戦中", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    killRoomEnemies(state, index);
    state.rooms[index]!.locked = true;
    expect(isEngaged(state)).toBe(true);
    expect(engagedRoomIndex(state)).toBe(index);
  });

  it("殲滅: 交戦中の部屋の最後の 1 体なら真、交戦前や他の敵が残るなら偽", () => {
    const state = createGame(4);
    const index = openRoomWithEnemies(state);
    const room = state.rooms[index]!;
    const members = state.enemies.filter((e) => e.roomIndex === index);
    const last = members[0]!;
    for (const e of members) if (e !== last) e.hp = 0;
    last.hp = 0;
    expect(isLastKillInEngagedRoom(state, last), "交戦前").toBe(false);
    room.engaged = true;
    expect(isLastKillInEngagedRoom(state, last), "交戦中の最後の 1 体").toBe(true);
    const other = members[1];
    if (other) {
      other.hp = 1;
      expect(isLastKillInEngagedRoom(state, last), "他の敵が残る").toBe(false);
    }
  });
});

describe("開放型フロア: 徘徊", () => {
  it("生成時に一部の敵が徘徊（どの部屋にも属さない）になり、目的地は封鎖しない部屋の中心。開始の部屋には敵がいない", () => {
    let roamers = 0;
    for (let seed = 0; seed < 20; seed++) {
      const state = createGame(seed);
      const start = state.rooms[0]!;
      for (const e of state.enemies) {
        const tx = Math.floor(e.body.pos.x / TILE_SIZE);
        const ty = Math.floor(e.body.pos.y / TILE_SIZE);
        expect(start.tiles?.has(toIndex(state.map, tx, ty)) ?? false, `seed=${seed} 開始の部屋に敵`).toBe(false);
        if (e.roomIndex !== ROAMING_ROOM) continue;
        roamers++;
        const roam = e.ai?.roam;
        expect(roam, "徘徊の目的地").toBeDefined();
        const centers = state.rooms.filter((r, i) => i !== 0 && !ROOM_KIND.locks[r.kind]).map((r) => rectCenterPx(r.rect));
        expect(centers.some((c) => c.x === roam!.x && c.y === roam!.y), "目的地は開始以外の封鎖しない部屋の中心").toBe(true);
      }
      // 徘徊を抜いても、敵を置いた部屋には 1 体以上残る
      state.rooms.forEach((room, i) => {
        if (i === 0 || room.cleared || room.kind !== "normal") return;
        expect(state.enemies.some((e) => e.roomIndex === i), `seed=${seed} room=${i}`).toBe(true);
      });
    }
    expect(roamers, "徘徊が出る").toBeGreaterThan(0);
  });

  it("idle の徘徊は目的地へ近づき、壁に埋まらない。気付いて chase になった敵は動かさない", () => {
    const state = createGame(7);
    state.player.body.pos = { x: -9999, y: -9999 };
    const roamer = state.enemies.find((e) => e.roomIndex === ROAMING_ROOM && e.ai?.roam);
    if (!roamer) throw new Error("徘徊がいない");
    const goal = { ...roamer.ai!.roam! };
    const before = Math.hypot(roamer.body.pos.x - goal.x, roamer.body.pos.y - goal.y);
    for (let i = 0; i < 60; i++) {
      updateRoamers(state, FIXED_DT);
      expect(overlapsWall(state, roamer.body.pos.x, roamer.body.pos.y, roamer.body.radius), "壁に埋まらない").toBe(false);
      if (roamer.ai!.roam!.x !== goal.x || roamer.ai!.roam!.y !== goal.y) break;
    }
    const after = Math.hypot(roamer.body.pos.x - goal.x, roamer.body.pos.y - goal.y);
    expect(after, "目的地へ近づく").toBeLessThan(before);
    roamer.phase = "chase";
    const pos = { ...roamer.body.pos };
    updateRoamers(state, FIXED_DT);
    expect(roamer.body.pos, "chase は enemies.ts の担当").toEqual(pos);
  });

  it("経路の次の点は目的地までの歩数が減るタイル", () => {
    const state = createGame(7);
    const goal = rectCenterPx(state.rooms[state.rooms.length - 1]!.rect);
    const from = rectCenterPx(state.rooms[0]!.rect);
    let pos = from;
    for (let i = 0; i < 400; i++) {
      const next = nextWaypoint(state.map, pos, goal);
      expect(next, "連結しているので経路がある").not.toBeNull();
      if (!next || (next.x === goal.x && next.y === goal.y)) return;
      pos = next;
    }
    throw new Error("目的地に着かない");
  });
});

describe("開放型フロア: 時間経過の増援", () => {
  it("reinforceDelay 秒後から reinforceInterval 秒ごとに増援の時刻が来る（ボス階は来ない）", () => {
    const state = createGame(3);
    state.floorTime = ROAM.reinforceDelay - FIXED_DT / 2;
    expect(reinforceDue(state, FIXED_DT)).toBe(true);
    state.floorTime = ROAM.reinforceDelay + FIXED_DT;
    expect(reinforceDue(state, FIXED_DT)).toBe(false);
    state.floorTime = ROAM.reinforceDelay + ROAM.reinforceInterval - FIXED_DT / 2;
    expect(reinforceDue(state, FIXED_DT)).toBe(true);
    state.floorTime = ROAM.reinforceDelay - 1;
    expect(reinforceDue(state, FIXED_DT)).toBe(false);
  });

  it("増援は画面外の壁でない床に徘徊として湧き、徘徊の上限を超えない", () => {
    const state = createGame(3);
    state.enemies = state.enemies.filter((e) => e.roomIndex !== ROAMING_ROOM);
    const cap = roamCap(state.depth);
    for (let n = 0; n < cap * 3; n++) {
      state.floorTime = ROAM.reinforceDelay + n * ROAM.reinforceInterval - FIXED_DT / 2;
      updateRooms(state, FIXED_DT);
      expect(roamerCount(state), "上限").toBeLessThanOrEqual(cap);
    }
    expect(roamerCount(state), "上限まで湧く").toBe(cap);
    const p = state.player.body.pos;
    for (const e of state.enemies.filter((x) => x.roomIndex === ROAMING_ROOM)) {
      expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius), "壁に埋まらない").toBe(false);
      expect(Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y), "プレイヤーから離れる").toBeGreaterThanOrEqual(ROAM.minSpawnDist);
      const c = state.camera.pos;
      const inView = Math.abs(e.body.pos.x - c.x) < VIEW_W / 2 && Math.abs(e.body.pos.y - c.y) < VIEW_H / 2;
      expect(inView, "カメラの表示範囲の外（画面の角にも湧かない）").toBe(false);
      expect(e.ai?.roam, "徘徊の目的地").toBeDefined();
    }
  });

  it("同じ seed と同じ時間経過なら同じ増援（決定的）", () => {
    const run = (): string => {
      const state = createGame(12);
      for (let n = 0; n < 3; n++) {
        state.floorTime = ROAM.reinforceDelay + n * ROAM.reinforceInterval - FIXED_DT / 2;
        updateRooms(state, FIXED_DT);
      }
      return JSON.stringify(state.enemies.map((e) => [e.defKey, e.body.pos, e.roomIndex, e.ai?.roam]));
    };
    expect(run()).toBe(run());
  });
});

describe("巣窟（モンスターハウス）", () => {
  it("最初は無人で、入ると封鎖して波で湧き、全波を倒すと制圧・rare 以上が落ちて扉が開く", () => {
    const { state, index } = floorWithHorde(5);
    const room = state.rooms[index]!;
    expect(state.enemies.filter((e) => e.roomIndex === index), "最初は無人").toHaveLength(0);
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    expect(room.locked, "入ると封鎖").toBe(true);
    expect(room.wave).toBe(1);
    const firstWave = state.enemies.filter((e) => e.roomIndex === index).length;
    expect(firstWave, "大量に湧く").toBeGreaterThanOrEqual(Math.round(enemyCount(state) * ROOM_KIND.hordeWaveMul) - 1);
    for (let w = 1; w < ROOM_KIND.hordeWaves; w++) {
      killRoomEnemies(state, index);
      updateRooms(state, FIXED_DT);
      expect(room.wave, "次の波").toBe(w + 1);
    }
    const items = state.floorItems.length;
    killRoomEnemies(state, index);
    updateRooms(state, FIXED_DT);
    expect(room.cleared, "全波で制圧").toBe(true);
    expect(room.locked).toBe(false);
    expect(state.lockedTiles.size, "扉が開く").toBe(0);
    const dropped = state.floorItems.slice(items).map((f) => f.item.rarity);
    expect(dropped.some((r) => r === "rare" || r === "unique"), "rare 以上が確定で落ちる").toBe(true);
  });

  it("巣窟は浅い階に出ず、深い階ほど多く（0〜2 個）、広い塊だけがなる", () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const depth of [1, 2, 5]) {
        const state = createGame(seed);
        state.depth = depth;
        buildFloor(state);
        const hordes = state.rooms.filter((r) => r.kind === "horde");
        const max = depth < ROOM_KIND.hordeMinDepth ? 0 : depth < ROOM_KIND.hordeSecondDepth ? 1 : 2;
        expect(hordes.length, `seed=${seed} depth=${depth}`).toBeLessThanOrEqual(max);
        for (const r of hordes) expect(r.tiles ? r.tiles.size : r.rect.w * r.rect.h).toBeGreaterThanOrEqual(ROOM_KIND.hordeMinTiles);
      }
    }
  });
});
