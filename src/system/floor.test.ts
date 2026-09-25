import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT } from "../core/input";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import { generateSkillStone } from "../skills/generator";
import { FIXED_DT } from "../core/loop";
import { enemiesForDepth, enemyDef } from "../data/enemies";
import type { Enemy, GameState, RoomState } from "../core/state";
import { Tile, createMap, rectCenterPx, TILE_SIZE, toIndex } from "../map/grid";
import { eliteChance, makeElite } from "./elites";
import { createEnemy } from "./enemies";
import { type AreaMulRange, ascend, buildFloor, descend, enemyCount, maxEnemiesFor, rollAreaMul, updateRooms, withBaseAreaMul } from "./floor";
import { dropItem } from "./loot";
import { updateRunEvents } from "./runEvents";
import { BOSS, FLOOR_KIND, MAP_SIZE, ROAM, ROOM, ROOM_KIND } from "../data/tuning";
import { grantBoon } from "./boons";
import { resolveRules } from "./rules";
import { ROAMING_ROOM, reinforceDue, roamCap, roamerCount, updateRoamers } from "./spawner";
import { nextWaypoint } from "../map/pathing";
import { terrainCode } from "../core/terrain";
import { FLOOR_KINDS, biomeEnemyWeight, floorKindCandidates, floorKindWeight, isInvertedDepth } from "./biomes";
import { stairsTilesValid, updateSpecialRooms } from "./specialRooms";
import { overlapsWall } from "./physics";
import { engagedRoomIndex, isEngaged } from "./engagement";
import { isLastKillInEngagedRoom } from "./combat";
import { VIEW_H, VIEW_W } from "../core/view";

/** 広いマップ（面積 3.5〜5 倍）を何十枚も作るテストの制限時間（ms）。既定の 5 秒では並列実行の負荷で足りない */
const WIDE_FLOOR_LOOP_TIMEOUT = 30_000;

/** 予定の広さ（MAP_SIZE の _note）。設定値に依らずに抽選の仕組みを確かめる */
const WIDE_RANGE: AreaMulRange = { areaMulMin: 3.5, areaMulMax: 5 };
const ROLL_SAMPLES = 20;

describe("マップの広さ（MAP_SIZE）", () => {
  it("面積の倍率は範囲に収まり、抽選ごとに変わる", () => {
    const rng = createRng(1);
    const muls = new Set<number>();
    for (let n = 0; n < ROLL_SAMPLES; n++) {
      const mul = rollAreaMul(rng, 1, WIDE_RANGE);
      expect(mul, "下限").toBeGreaterThanOrEqual(WIDE_RANGE.areaMulMin);
      expect(mul, "上限").toBeLessThanOrEqual(WIDE_RANGE.areaMulMax);
      muls.add(mul);
    }
    expect(muls.size, "広さが変わる").toBeGreaterThan(1);
  });

  it("ボス階と、範囲が 1 点のときは乱数を引かない", () => {
    const rng = createRng(2);
    expect(rollAreaMul(rng, BOSS.interval, WIDE_RANGE), "ボス階は基準の大きさ").toBe(1);
    expect(rollAreaMul(rng, 1, { areaMulMin: 2, areaMulMax: 2 })).toBe(2);
    expect(rng.next(), "乱数を消費しない").toBe(createRng(2).next());
  });

  it("buildFloor は抽選した倍率を state に残し、マップは √倍率 倍の大きさになる", () => {
    for (let seed = 0; seed < 4; seed++) {
      const state = createGame(seed);
      const mul = state.floorAreaMul ?? 1;
      expect(mul, `seed=${seed} 下限`).toBeGreaterThanOrEqual(MAP_SIZE.areaMulMin);
      expect(mul, `seed=${seed} 上限`).toBeLessThanOrEqual(MAP_SIZE.areaMulMax);
      expect(state.map.width, `seed=${seed} 幅`).toBe(Math.round(MAP_SIZE.baseWidth * Math.sqrt(mul)));
      expect(state.map.height, `seed=${seed} 高さ`).toBe(Math.round(MAP_SIZE.baseHeight * Math.sqrt(mul)));
    }
  });

  it("同じ seed で 2 回 buildFloor するとマップの大きさと形が一致する", () => {
    const a = createGame(21);
    const b = createGame(21);
    a.depth = 2;
    b.depth = 2;
    buildFloor(a);
    buildFloor(b);
    expect(a.floorAreaMul).toBe(b.floorAreaMul);
    expect([a.map.width, a.map.height]).toEqual([b.map.width, b.map.height]);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
  });

  it("ボス階は基準の大きさのまま", () => {
    const state = createGame(4);
    state.depth = BOSS.interval;
    buildFloor(state);
    expect(state.floorAreaMul).toBe(1);
    expect([state.map.width, state.map.height]).toEqual([MAP_SIZE.baseWidth, MAP_SIZE.baseHeight]);
  });

  it("部屋の敵の抽選回数は 面積の倍率 ^ roomEnemiesExp 倍（倍率 1 は基準のまま、部屋の上限は超えない）", () => {
    const state = createGame(3);
    state.depth = 2;
    state.floorAreaMul = 1;
    const base = enemyCount(state);
    expect(base, "倍率 1 は基準").toBe(Math.min(maxEnemiesFor(2), ROOM.baseEnemies + Math.floor(2 * ROOM.enemiesPerDepth)));
    state.floorAreaMul = 4;
    expect(enemyCount(state)).toBe(Math.min(maxEnemiesFor(2), Math.round(base * 4 ** MAP_SIZE.roomEnemiesExp)));
  });

  it("withBaseAreaMul の間は基準の大きさで乱数を引かず、抜けると元の抽選に戻る", () => {
    const small = withBaseAreaMul(() => createGame(5));
    expect(small.floorAreaMul).toBe(1);
    expect([small.map.width, small.map.height]).toEqual([MAP_SIZE.baseWidth, MAP_SIZE.baseHeight]);
    const wide = createGame(5);
    expect(wide.floorAreaMul, "抜けた後は MAP_SIZE の範囲").toBeGreaterThanOrEqual(MAP_SIZE.areaMulMin);
  });

  it("徘徊の上限は広い階ほど 面積の倍率 ^ roamCapExp 倍に増える", () => {
    const depth = 2;
    expect(roamCap(depth, 1)).toBe(roamCap(depth));
    expect(roamCap(depth, 4)).toBe(Math.round(roamCap(depth) * 4 ** MAP_SIZE.roamCapExp));
    expect(roamCap(depth, 4)).toBeGreaterThan(roamCap(depth));
  });
});

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

// -----------------------------------------------------------------------------
// 強欲のが抱えた物を失わない経路（system/elites.ts）
// -----------------------------------------------------------------------------

/** 強欲のに遺物 1 つとスキル石 1 つを抱えさせる。id は他と重ならない大きな値 */
function greedyCarrying(state: GameState, pos: { x: number; y: number }, roomIndex: number): { e: Enemy; itemId: number; stoneId: number } {
  const e = createEnemy(state, enemyDef("slime"), pos, roomIndex, false);
  makeElite(e, "greedy");
  const itemId = 90_001;
  const stoneId = 90_002;
  const item = generateItem(createRng(itemId), { itemLevel: 3, foundDepth: 3, now: 0 });
  const stone = generateSkillStone(createRng(stoneId), { foundDepth: 3, now: 0 });
  e.carried = {
    items: [{ id: itemId, item, pos: { ...pos }, bobTime: 0 }],
    stones: [{ id: stoneId, stone, pos: { ...pos }, bobTime: 0, warned: false }],
  };
  state.enemies.push(e);
  return { e, itemId, stoneId };
}

describe("強欲のが抱えた物は消えない", () => {
  it("抱えたまま階を移ると、遺物もスキル石も次の階の足元に残る（次のステップの片付けで石が消えない）", () => {
    const state = createGame(3);
    // skills.ts の syncTracking は最初のステップで今の階を覚えるだけなので、降りる前に 1 ステップ進めておく
    step(state, EMPTY_INPUT, FIXED_DT);
    const { itemId, stoneId } = greedyCarrying(state, { ...state.player.body.pos }, 0);
    descend(state);
    for (let i = 0; i < 3; i++) step(state, EMPTY_INPUT, FIXED_DT);
    expect(state.floorItems.map((f) => f.id), "遺物が届く").toContain(itemId);
    expect(state.skills.floorStones.map((f) => f.id), "スキル石も届いて残る").toContain(stoneId);
  });

  it("前の階の床に残したスキル石は階を移ると失われる", () => {
    const state = createGame(3);
    step(state, EMPTY_INPUT, FIXED_DT);
    const stone = generateSkillStone(createRng(7), { foundDepth: 1, now: 0 });
    state.skills.floorStones.push({ id: 90_010, stone, pos: { ...state.player.body.pos }, bobTime: 0, warned: false });
    descend(state);
    expect(state.skills.floorStones.some((f) => f.id === 90_010), "降りた時点で消える").toBe(false);
  });

  it("扉に埋まって取り除かれる強欲のが抱えていた物は、扉が閉じた後にプレイヤーの足元へ落ちる", () => {
    const { state, room } = corridorRoomState();
    const map = state.map;
    // 通路と部屋の中を塞ぎ、扉の上の敵をどちらへも押し出せないようにする
    for (let x = DOOR_TX + 1; x <= CORRIDOR_END_TX; x++) map.tiles[toIndex(map, x, DOOR_TY)] = Tile.Wall;
    for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) map.tiles[toIndex(map, x, y)] = Tile.Wall;
    const { e, itemId, stoneId } = greedyCarrying(state, doorCenter(), OTHER_ROOM);
    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);
    expect(room.locked, "部屋がロックされる").toBe(true);
    expect(state.enemies.includes(e), "押し出せない敵は取り除かれる").toBe(false);
    expect(state.floorItems.map((f) => f.id), "遺物は床に残る").toContain(itemId);
    expect(state.skills.floorStones.map((f) => f.id), "スキル石も床に残る").toContain(stoneId);
    const door = room.doorTiles[0]!;
    for (const pos of [...state.floorItems.map((f) => f.pos), ...state.skills.floorStones.map((f) => f.pos)]) {
      const tile = toIndex(map, Math.floor(pos.x / TILE_SIZE), Math.floor(pos.y / TILE_SIZE));
      expect(tile, "閉じた扉の上には落とさない").not.toBe(door);
    }
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
    // 湧水は BoonDef.rules（onRoomClear）。step と同じくステップ末の照合まで通す
    resolveRules(state, 0);
    expect(room.cleared, "全滅で制圧").toBe(true);
    expect(state.player.mana, "湧水でマナが満ちる").toBe(state.stats.maxMana);
    expect(state.score - score, "制圧の得点").toBe(ROOM.clearBonus);
    state.player.mana = 0;
    updateRooms(state, FIXED_DT);
    updateRooms(state, FIXED_DT);
    resolveRules(state, 0);
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
      // プレイヤーから遠い徘徊は tick で間引いて歩く（ROAM.sleepRoamEvery）ので、step と同じく tick を進める
      state.tick += 1;
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
    const cap = roamCap(state.depth, state.floorAreaMul);
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
    }, WIDE_FLOOR_LOOP_TIMEOUT);
});

// -----------------------------------------------------------------------------
// 階層構造（反転層・戻る・無限の深み）
// -----------------------------------------------------------------------------

describe("反転層", () => {
  it("深度 invertedDepth からバイオームの重みが逆順になる", () => {
    const n = FLOOR_KINDS.length;
    FLOOR_KINDS.forEach((kind, i) => {
      expect(floorKindWeight(kind, FLOOR_KIND.invertedDepth - 1), `${kind} 浅い`).toBe(FLOOR_KIND.weight[kind]);
      const mirrored = FLOOR_KINDS[n - 1 - i];
      if (!mirrored) throw new Error("mirrored");
      expect(floorKindWeight(kind, FLOOR_KIND.invertedDepth), `${kind} 反転層`).toBe(FLOOR_KIND.weight[mirrored]);
    });
    expect(isInvertedDepth(FLOOR_KIND.invertedDepth - 1)).toBe(false);
    expect(isInvertedDepth(FLOOR_KIND.invertedDepth)).toBe(true);
  });

  it("反転層では落ちた遺物がもう 1 回反転の抽選を受ける（済ませた id は二度と引かない）", () => {
    const state = createGame(9);
    state.depth = FLOOR_KIND.invertedDepth + 4;
    buildFloor(state, "rooms");
    state.floorItems = [];
    const before = state.nextId;
    for (let i = 0; i < 20; i++) dropItem(state, { ...state.player.body.pos });
    updateRunEvents(state, FIXED_DT);
    expect(state.runEvents.strata.lastItemId, "済ませた id").toBeGreaterThanOrEqual(before);
    const snapshot = JSON.stringify(state.floorItems);
    updateRunEvents(state, FIXED_DT);
    expect(JSON.stringify(state.floorItems), "二度目は引かない").toBe(snapshot);
  });

  it("反転層に初めて降りると告げる", () => {
    const state = createGame(9);
    state.depth = FLOOR_KIND.invertedDepth - 1;
    state.runEvents.strata.deepest = state.depth;
    descend(state, "cave");
    expect(state.depth).toBe(FLOOR_KIND.invertedDepth);
    expect(state.log.some((l) => l.text.includes("反転層")), "ログ").toBe(true);
  });
});

describe("無限の深み", () => {
  it("深みでは部屋の敵数の上限が外れる", () => {
    expect(maxEnemiesFor(FLOOR_KIND.deepDepth)).toBe(ROOM.maxEnemies + FLOOR_KIND.deepMaxEnemiesBonus);
    expect(maxEnemiesFor(FLOOR_KIND.deepDepth - 1)).toBe(ROOM.maxEnemies);
    const state = createGame(1);
    state.depth = FLOOR_KIND.deepDepth + 10;
    expect(enemyCount(state)).toBeGreaterThan(ROOM.maxEnemies);
  });
});

describe("戻る（上り階段）", () => {
  it("戻ると 1 つ浅い階が作り直され、帰還の印・死神の前倒し・回数が付く", () => {
    const state = createGame(5);
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    expect(state.depth, "浅い階").toBe(5);
    expect(state.runEvents.strata.revisit, "帰還").toBe(true);
    expect(state.runEvents.strata.returns).toBe(1);
    expect(state.floorTime, "死神の前倒し").toBeGreaterThanOrEqual(FLOOR_KIND.revisitReaperHeadStart);
  });

  it("戻った階は敵が半分になる（乱数を使わず 1 体おきに除く）", () => {
    const a = createGame(5);
    const b = createGame(5);
    a.depth = 6;
    b.depth = 6;
    a.runEvents.strata.deepest = 6;
    b.runEvents.strata.deepest = 6;
    buildFloor(a, "rooms");
    buildFloor(b, "rooms");
    a.depth = 6;
    ascend(a);
    // 同じ乱数の流れで深度 5 を普通に作ったときと比べる
    b.depth = 5;
    buildFloor(b);
    expect(a.enemies.length, "半分").toBe(Math.ceil(b.enemies.length / 2));
  });

  it("戻ってから降り直した階では、振り分け点・階層到達の報酬を二重に取らない", () => {
    const state = createGame(5);
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    const points = state.runAttributes.unspent;
    const score = state.score;
    descend(state, "rooms");
    expect(state.depth).toBe(6);
    expect(state.runAttributes.unspent, "振り分け点").toBe(points);
    expect(state.score, "スコア").toBe(score);
    expect(state.runEvents.strata.revisit, "帰還の印は消える").toBe(false);
    descend(state, "rooms");
    expect(state.runAttributes.unspent, "初めての階では点が入る").toBeGreaterThan(points);
  });

  it("上り階段は乗り続けたときだけ戻る（通りすがりでは戻らない）", () => {
    let state: GameState | null = null;
    for (const seed of [5, 7, 9, 11, 13]) {
      const s = createGame(seed);
      s.depth = 5;
      buildFloor(s, "rooms");
      if (s.rooms[s.rooms.length - 1]?.special?.props.some((p) => p.kind === "ascend")) {
        state = s;
        break;
      }
    }
    if (!state) throw new Error("上り階段を置ける seed が無い");
    const last = state.rooms[state.rooms.length - 1];
    const prop = last?.special?.props.find((p) => p.kind === "ascend");
    if (!prop) throw new Error("上り階段");
    state.player.body.pos = { ...prop.pos };
    updateSpecialRooms(state, FLOOR_KIND.ascendHold / 2);
    expect(state.depth, "まだ戻らない").toBe(5);
    state.player.body.pos = rectCenterPx(state.rooms[0]?.rect ?? { x: 0, y: 0, w: 1, h: 1 });
    updateSpecialRooms(state, FIXED_DT);
    expect(prop.hold, "離れると戻る").toBe(0);
    state.player.body.pos = { ...prop.pos };
    for (let t = 0; t < FLOOR_KIND.ascendHold + FIXED_DT * 2 && state.depth === 5; t += FIXED_DT) updateSpecialRooms(state, FIXED_DT);
    expect(state.depth, "戻った").toBe(4);
  });
});

describe("戻る（上り階段）: 降り直しの 3 択", () => {
  /** 開始部屋の中心を階段にして立たせ、階段の判定を 1 回通す（ボス階でも階段を用意する） */
  function stepOnStairs(state: GameState): void {
    const r = state.rooms[0]?.rect;
    if (!r) throw new Error("部屋が無い");
    const c = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
    state.map.tiles[toIndex(state.map, c.x, c.y)] = Tile.StairsDown;
    state.player.body.pos = { x: (c.x + 0.5) * TILE_SIZE, y: (c.y + 0.5) * TILE_SIZE };
    state.enemies = [];
    updateRooms(state, FIXED_DT);
  }

  it("戻ってから階段で降り直しても祝福の 3 択は出ず、初めての階へ降りると出る", () => {
    const state = createGame(5);
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    stepOnStairs(state);
    expect(state.depth, "降り直した").toBe(6);
    expect(state.boonChoice, "降り直しでは 3 択なし").toBeNull();
    stepOnStairs(state);
    expect(state.depth, "初めての階").toBe(7);
    expect(state.boonChoice, "初めての階では 3 択").not.toBeNull();
  });
});

describe("戻る（上り階段）: 階層到達の報酬", () => {
  it("初めての階だけ strata.fresh が立ち、戻った階・降り直した階では立たない", () => {
    const state = createGame(5);
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    expect(state.runEvents.strata.fresh, "戻った階").toBe(false);
    descend(state, "rooms");
    expect(state.runEvents.strata.fresh, "降り直した階").toBe(false);
    descend(state, "rooms");
    expect(state.runEvents.strata.fresh, "初めての階").toBe(true);
  });

  it("起点「死神の友」の振り分け点は降り直しでは入らない", () => {
    const state = createGame(5);
    state.origin = "reaperFriend";
    state.depth = 6;
    state.runEvents.strata.deepest = 6;
    buildFloor(state, "rooms");
    ascend(state);
    const points = state.runAttributes.unspent;
    descend(state, "rooms");
    expect(state.runAttributes.unspent, "降り直し").toBe(points);
    descend(state, "rooms");
    expect(state.runAttributes.unspent, "初めての階では入る").toBeGreaterThan(points);
  });
});

describe("封鎖時に部屋の外にいる自室の敵を中へ寄せる", () => {
  /** 最小マップの部屋 rect (5..8, 5..8) の中に中心があるか */
  function inRoomRect(room: RoomState, e: Enemy): boolean {
    const r = room.rect;
    const { x, y } = e.body.pos;
    return x >= r.x * TILE_SIZE && x < (r.x + r.w) * TILE_SIZE && y >= r.y * TILE_SIZE && y < (r.y + r.h) * TILE_SIZE;
  }
  const CORRIDOR_TX = 12;
  function corridorPos(): { x: number; y: number } {
    return { x: (CORRIDOR_TX + 0.5) * TILE_SIZE, y: (DOOR_TY + 0.5) * TILE_SIZE };
  }

  it("封鎖時に外（通路）にいる自室の敵は部屋の中の空き地点へ移り、他室の敵は動かない", () => {
    const { state, room } = corridorRoomState();
    const own = createEnemy(state, enemyDef("slime"), corridorPos(), 0, false);
    const other = createEnemy(state, enemyDef("slime"), { x: (CORRIDOR_END_TX + 0.5) * TILE_SIZE, y: (DOOR_TY + 0.5) * TILE_SIZE }, OTHER_ROOM, false);
    state.enemies.push(own, other);
    const otherBefore = { ...other.body.pos };

    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked, "部屋が封鎖される").toBe(true);
    expect(inRoomRect(room, own), "自室の敵は部屋の中へ入る").toBe(true);
    expect(overlapsWall(state, own.body.pos.x, own.body.pos.y, own.body.radius), "壁（閉じた扉）に重ならない").toBe(false);
    expect(other.body.pos, "他室の敵はそのまま").toEqual(otherBefore);
  });

  it("強欲のが外で抱えたまま封鎖されても、中へ寄せられて倒せば制圧できる", () => {
    const { state, room } = corridorRoomState();
    const { e, itemId } = greedyCarrying(state, corridorPos(), 0);

    state.player.body.pos = rectCenterPx(room.rect);
    updateRooms(state, FIXED_DT);

    expect(room.locked, "部屋が封鎖される").toBe(true);
    expect(inRoomRect(room, e), "強欲のは部屋の中へ入る").toBe(true);
    expect(e.carried?.items.map((f) => f.id), "抱えた物はそのまま").toContain(itemId);

    // 部屋の中にいるので倒せる。伏兵で湧いた分も含め自室の敵を全て倒すと制圧される
    for (const en of state.enemies) if (en.roomIndex === 0) en.hp = 0;
    updateRooms(state, FIXED_DT);
    expect(room.cleared, "制圧できる").toBe(true);
  });
});
