import { type Enemy, type FloorKind, type GameState, type RoomState, allocId, pushLog, pushSfx } from "../core/state";
import { pushPlayerEvent } from "../core/events";
import { FIXED_DT } from "../core/loop";
import type { Rng } from "../core/rng";
import { normalize, sub } from "../core/vec";
import { enemiesForDepth, type EnemyDef } from "../data/enemies";
import { BOSS, CAVE, DEEP, FLOOR_LORD, HEAL, MAP_SIZE, ROAM, ROOM, ROOM_KIND } from "../data/tuning";
import { type CaveShapeOptions, carveArena } from "../map/cave";
import { DEFAULT_GENERATOR_OPTIONS, type GeneratorOptions, generateMap, scaleGeneratorOptions } from "../map/generator";
import {
  type GameMap,
  type Rect,
  TILE_SIZE,
  Tile,
  getTile,
  inBounds,
  isPassableTile,
  isWalkable,
  rectCenterPx,
  rectContainsPx,
  toIndex,
} from "../map/grid";
import { generateLayoutMap } from "../map/layout/index";
import { generateLordHallMap } from "../map/layout/lordHall";
import { chooseLayout } from "../map/layout/select";
import type { FloorLayout, LayoutContext } from "../map/layout/types";
import { snapCamera } from "./camera";
import { COLOR_HEAL, healPlayer } from "./combat";
import { addFloatingText, lordPullFx, resetFloorEffects, roomClearFx, roomLockFx, shake, spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { heartsAllowed } from "./keystones";
import { coreBlocksHearts } from "./boonCores";
import { dropDepthReward, dropRoomReward, updateFloorItems } from "./loot";
import { recordProvenance } from "../loot/provenance";
import { fireTrigger } from "./triggers";
import { circlesOverlap, isSolidTile, overlapsTiles, overlapsWall } from "./physics";
import { announceBoss, bossKeyForDepth, isBossDepth, setupBossRoom, updateBossIntro } from "./boss";
import { setupFloorLordRoom } from "./floorLord";
import { chapterOf, deepFloorOf, heartChanceOf, isDeepDepth, skipsFloorLord } from "./chapters";
import { announceDeep } from "./deep";
import { planHidden, updateHiddenRoom } from "./hiddenRoom";
import { dropGreedyLootAtPlayer, finalizeLinks, rescueCarried, rollElite, takeGreedyLoot } from "./elites";
import { applyBoonFloorRules, boonHeartsAllowed, stairsGradeBoost } from "./boons";
import { isAllied } from "./rules";
import { resetExplored, revealAround } from "./explore";
import { descendMana } from "./mana";
import {
  FLOOR_KIND_LABEL,
  announceAmbush,
  applyCurse,
  assignRoomKinds,
  chooseFloorKind,
  dropRareItem,
  hasMoreWaves,
  mapShapeOf,
  openTreasure,
  roomLocks,
  setupShrine,
  startWave,
  startsEmpty,
  updateShrines,
  waveMul,
} from "./roomTypes";
import { updateRoamers } from "./spawner";
import { roomClearText } from "./jin";
import { createBossJin, planJins, updateJinPhases, updateLookouts, wakeJin } from "./jinSpawn";
import { biomeEnemyWeight, isInvertedDepth, placeBiomeTerrain, placeOssuaryCorpses } from "./biomes";
import {
  assignExtraRoomKinds,
  placeDonationShrine,
  clearSpecialRoom,
  enterSpecialRoom,
  ensureForkStairs,
  lockSpecialRoom,
  placeAscend,
  planForkStairs,
  roomHooks,
  setupSpecialRoom,
  stairsChoiceAt,
  stairsRewardAt,
  updateSpecialRooms,
} from "./specialRooms";
import { type ExitReward, applyDangerReward, applyExitArrival, applyExitDanger, offerArrivalChoices, replacesArrivalRelic } from "./exits";
import { onFloorStart, onRoomCleared, onRoomLocked, onRunEnemySpawned } from "./runEvents";
import { hasMod, onOriginDescend, refreshRunStats, tierScoreMul } from "./runSetup";
import { onContractsFloorReached, onContractsRoomCleared, placeContractor, updateContractors } from "./contractors";
import { placeContainers } from "./containers";
import { placeMerchants, updateMerchants } from "./merchants";
import { grantFloorArrival, onRoomClearedCoins, updateCoinPickups } from "./economy";
import { FLOOR_KIND } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { onRelicFloorStart } from "./namedRelics";
import { announceChapterAhead, clearRun, updateFinale } from "./finale";
import { placeNemesis } from "./nemesis";

const START_ROOM = 0;
/** 開始部屋の次の部屋（rooms 型では通路で最初に繋がる部屋）は必ず通常の部屋（陣の候補）にする */
const FIRST_FIGHT_ROOM = 1;
const PICKUP_RADIUS = 6;
const LOCK_SHAKE = 3;
const AMBUSH_SHAKE = 6;
const MIN_WAVE_ENEMIES = 1;
const TEXT_LIFT = 10;
const DEPTH_COLOR = "#ffd75f";

/** 新しいフロアを生成してプレイヤーを配置する。kind は分岐路で選んだ行き先（省略時は深度の規則で抽選） */
export function buildFloor(state: GameState, kind?: FloorKind): void {
  installRoomHooks();
  // 強欲のが抱えていた物は敵ごと消さず、新しい階のプレイヤーの足元へ届ける（system/elites.ts）
  const stolen = takeGreedyLoot(state);
  state.floorKind = kind ?? chooseFloorKind(state.depth, state.rng);
  state.floorAreaMul = rollAreaMul(state.rng, state.depth);
  // 型の抽選は面積の抽選の後（docs/ideas/map-gen-impl.md 2-5 の乱数の順）。前の階の型は上書きする前に読む
  state.map = generateFloorMap(state, chooseLayout(state.rng, floorLayoutContext(state)));
  state.floorLayout = state.map.layout ?? LEGACY_LAYOUT;
  // 洞窟の最後の塊（階段の部屋）が狭いと階の主の戦いが窮屈になるので広げる（rooms 型・major は何もしない。乱数を使わない）
  if (!isBossDepth(state.depth) && !skipsFloorLord(state.depth) && state.map.rooms.length - 1 > START_ROOM) {
    carveArena(state.map, state.map.rooms.length - 1, FLOOR_LORD.arenaRadius);
  }
  const doorIndex = createDoorIndex(state.map);
  state.rooms = state.map.rooms.map((rect, i) => createRoomState(state.map, rect, i, doorIndex));
  state.lockedTiles = new Set();
  state.hazards = [];
  state.boss = null;
  state.hiddenRoom = null;
  state.floorTime = 0;
  state.reaper = null;
  state.enemies = [];
  state.jins = [];
  state.projectiles = [];
  state.pickups = [];
  state.particles = [];
  state.texts = [];
  state.shapes = [];
  // 前の階に残したアイテム・スキル石は失われる。スキル石もここで捨てる（skills.ts の syncTracking は次のステップに
  // 階の変化を拾うので、そこで捨てると下の dropGreedyLootAtPlayer が届けた石まで消えてしまう）
  state.floorItems = [];
  state.skills.floorStones = [];
  resetExplored(state);
  resetFloorEffects(state);

  const start = state.rooms[START_ROOM];
  if (start) {
    start.cleared = true;
    state.player.body.pos = rectCenterPx(start.rect);
    // 出血は前ステップからの移動距離で削る。階をまたぐ瞬間移動を移動として数えない
    const status = state.player.status;
    if (status.bleedFrom) status.bleedFrom = { ...state.player.body.pos };
  }
  snapCamera(state);
  dropGreedyLootAtPlayer(state, stolen);

  // 章の休符（章の 1 階目）は階の主を出さない。最後の部屋は主のいない通常の部屋になる
  const lordless = !isBossDepth(state.depth) && skipsFloorLord(state.depth);
  const bossRoom = lordless ? -1 : bossRoomIndex(state);
  const last = state.rooms.length - 1;
  const reserved = new Set([START_ROOM, FIRST_FIGHT_ROOM, last]);
  assignRoomKinds(state, reserved);
  assignExtraRoomKinds(state, reserved);
  applyBoonFloorRules(state, reserved);
  // 出口の予告「危険」: 巣窟 / 闘技場 / 試練を 1 つ強制する（部屋の準備の前）
  applyExitDanger(state, reserved);
  state.rooms.forEach((room, i) => {
    if (i === START_ROOM) return;
    if (i === bossRoom) {
      if (isBossDepth(state.depth)) setupBossRoom(state, i);
      else setupFloorLordRoom(state, i);
      return;
    }
    if (room.kind === "shrine") setupShrine(state, room);
    setupSpecialRoom(state, room);
    // 通常の部屋は陣（planJins）が受け持つ。特別な部屋で最初から敵がいる種類（巣・潮の間など）は従来どおり
    if (startsEmpty(room.kind) || room.kind === "normal") return;
    populateRoom(state, room, i);
  });
  // ボス階の専用の部屋は入口 → 前室 → 主の間の 1 本道で、道中の戦闘を置かない（docs/ideas/lordhall-design.md 8 章）
  if (state.floorLayout !== LORD_HALL_LAYOUT) planJins(state, new Set([START_ROOM, bossRoom]));
  revealAround(state);
  // ここから下の乱数は部屋の中身が決まった後に引く（既存の部屋・敵の配置の乱数消費を変えない）
  const ends = new Set([START_ROOM, last]);
  placeBiomeTerrain(state, ends);
  placeOssuaryCorpses(state, ends);
  planForkStairs(state);
  clearEmptyOpenRooms(state);
  onFloorStart(state);
  // 契約者と上り階段は最後に置く（それより前の乱数消費を変えない）
  placeContractor(state);
  placeAscend(state);
  // 章の境の休符の祠は乱数を使わないので置く順は問わない（契約者の後ろに置いて既存の抽選に触れない）
  placeDonationShrine(state);
  // 隠し部屋の計画は一番最後（それより前の乱数消費を変えないため）
  planHidden(state);
  // 市の商人は隠し部屋の後（それより前の乱数消費を変えない。system/merchants.ts）
  placeMerchants(state);
  // 壺・木箱は商人の台座を避けて最後に置く（それより前の乱数消費を変えない。system/containers.ts）
  placeContainers(state);
  // 名のある遺物の階の到着（賽の目は装備しているときだけ乱数を引く。それより前の乱数消費を変えない）
  onRelicFloorStart(state);
  // 仇は陣が揃った後に足す（仇のいないランは何もしない。それより前の乱数消費を変えない。system/nemesis.ts）
  placeNemesis(state);
  // 出口の予告はこの階を作るためだけに使う。次の階へ持ち越さない
  state.pendingExit = null;
}

/**
 * 敵を置けなかった封鎖しない通常の部屋（小さすぎる塊など）は最初から制圧済みにする。
 * 残すと入っただけで制圧（報酬）になってしまう
 */
function clearEmptyOpenRooms(state: GameState): void {
  state.rooms.forEach((room, i) => {
    if (room.cleared || roomLocks(state, i) || room.kind !== "normal") return;
    if (!state.enemies.some((e) => e.roomIndex === i)) room.cleared = true;
  });
}

function createRoomState(map: GameMap, rect: Rect, index: number, doorIndex: DoorIndex): RoomState {
  const tileList = map.roomTiles?.[index];
  return {
    rect,
    cleared: false,
    locked: false,
    doorTiles: tileList ? roomBlobDoorTiles(doorIndex, index, tileList) : findDoorTiles(map, rect),
    kind: "normal",
    wave: 0,
    used: false,
    tiles: tileList ? new Set(tileList) : undefined,
  };
}

/** バイオームごとの洞窟の形（tuning の CAVE.biome。無い種別は既定のまま） */
const CAVE_BY_KIND: Readonly<Partial<Record<FloorKind, Partial<CaveShapeOptions>>>> = CAVE.biome;

/** 面積の倍率の抽選範囲（BALANCE.world.MAP_SIZE の一部。テストで範囲を差し替えられるように型を切り出す） */
export interface AreaMulRange {
  areaMulMin: number;
  areaMulMax: number;
}

/** withBaseAreaMul の間だけ使う抽選範囲（null なら MAP_SIZE） */
let areaMulOverride: AreaMulRange | null = null;
const BASE_AREA_MUL: AreaMulRange = { areaMulMin: 1, areaMulMax: 1 };

/**
 * fn の間だけ面積の倍率を 1（基準の大きさ・乱数を引かない）にする。テストの小さな検証場（system/testHelpers.ts の arena）が
 * 広いマップの生成と形のばらつきに左右されないように。ゲーム本体からは呼ばない
 */
export function withBaseAreaMul<T>(fn: () => T): T {
  const saved = areaMulOverride;
  areaMulOverride = BASE_AREA_MUL;
  try {
    return fn();
  } finally {
    areaMulOverride = saved;
  }
}

/**
 * この階の面積の倍率を range の範囲で抽選する（マップ生成の直前に rng から 1 回）。
 * ボス階は基準の大きさのまま（ボス部屋までの道のりを伸ばさず、ボス階の形を変えない）。
 * ボス階と、範囲が 1 点（min = max）のときは乱数を引かない（既存の seed の乱数の流れを変えない）
 */
export function rollAreaMul(rng: Rng, depth: number, range: AreaMulRange = areaMulOverride ?? MAP_SIZE): number {
  if (isBossDepth(depth)) return 1;
  if (range.areaMulMax <= range.areaMulMin) return range.areaMulMin;
  return range.areaMulMin + rng.next() * (range.areaMulMax - range.areaMulMin);
}

/**
 * 毎階、最後の部屋（階段の部屋）を主の大きさ以上にする。5 の倍数の階（major）は BOSS.roomMinW/H、
 * それ以外（階の主）は FLOOR_LORD.roomMinW/H（rooms 型だけが読む。cave 型は map/cave.ts の carveArena で広げる）
 */
function generatorOptions(depth: number, kind: FloorKind, areaMul: number): GeneratorOptions {
  const cave = CAVE_BY_KIND[kind];
  const base = scaleGeneratorOptions(cave ? { ...DEFAULT_GENERATOR_OPTIONS, cave } : DEFAULT_GENERATOR_OPTIONS, areaMul);
  const min = isBossDepth(depth) ? { w: BOSS.roomMinW, h: BOSS.roomMinH } : { w: FLOOR_LORD.roomMinW, h: FLOOR_LORD.roomMinH };
  return { ...base, lastRoomMin: min };
}

/** 旧生成器（フロア種別の MAP_SHAPE の rooms / cave）の型名 */
const LEGACY_LAYOUT: FloorLayout = "legacy";
/** ボス階の専用の部屋の型名 */
const LORD_HALL_LAYOUT: FloorLayout = "lordHall";

/** この階の型を選ぶ文脈。previous は前の階で実際に使った型（state.floorLayout を上書きする前に読む） */
export function floorLayoutContext(state: GameState): LayoutContext {
  return {
    depth: state.depth,
    chapter: chapterOf(state.depth),
    isDeep: isDeepDepth(state.depth),
    isBossFloor: isBossDepth(state.depth),
    floorKind: state.floorKind,
    previous: state.floorLayout,
  };
}

/**
 * 型 layout でこの階の地図を作る（docs/ideas/map-gen-impl.md 2-5）。型の生成器が作れなければ（検査に全部落ちた）
 * 同じ rng のまま旧生成器へ落ちる。返す地図の layout は実際に使った型。型の areaScale で地図が要求より小さいことがある
 */
export function generateFloorMap(state: GameState, layout: FloorLayout): GameMap {
  const options = generatorOptions(state.depth, state.floorKind, state.floorAreaMul ?? 1);
  switch (layout) {
    case "legacy":
      return legacyFloorMap(state, options);
    case "lordHall":
      // 手描きの格子を並べるだけで乱数を引かない（docs/ideas/lordhall-design.md 5 章）
      return generateLordHallMap(bossKeyForDepth(state.depth));
    default:
      return generateLayoutMap(layout, state.rng, options.width, options.height) ?? legacyFloorMap(state, options);
  }
}

function legacyFloorMap(state: GameState, options: GeneratorOptions): GameMap {
  const map = generateMap(mapShapeOf(state.floorKind), state.rng, options);
  map.layout = LEGACY_LAYOUT;
  return map;
}

/** 最後の部屋（階段の部屋。毎階、階の主かボスが出る）。部屋が 1 つしか無ければ -1 */
function bossRoomIndex(state: GameState): number {
  const last = state.rooms.length - 1;
  return last <= START_ROOM ? -1 : last;
}

/** 部屋の外周 1 マス外側にある床 = 出入口 */
function findDoorTiles(map: GameMap, r: Rect): number[] {
  const tiles: number[] = [];
  for (let x = r.x - 1; x <= r.x + r.w; x++) {
    for (const y of [r.y - 1, r.y + r.h]) {
      if (isWalkable(map, x, y)) tiles.push(toIndex(map, x, y));
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (const x of [r.x - 1, r.x + r.w]) {
      if (isWalkable(map, x, y)) tiles.push(toIndex(map, x, y));
    }
  }
  return tiles;
}

/** 8 近傍の差分。x と y を別の表にして内側のループで組を分解しない（並びは扉の候補の順を変えないよう旧来と同じ） */
const N8_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const N8_DY = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const N8_COUNT = 8;

/** findBlobDoorTiles の印。マップごとに 1 枚を使い回し、呼ぶたびに印の番号を 2 つ進める（部屋 = stamp、扉 = stamp + 1） */
interface DoorMarks {
  mark: Uint32Array;
  stamp: number;
}
const doorMarks = new WeakMap<GameMap, DoorMarks>();
const MARKS_PER_CALL = 2;

function doorMarksOf(map: GameMap): DoorMarks {
  let marks = doorMarks.get(map);
  if (!marks) {
    marks = { mark: new Uint32Array(map.tiles.length), stamp: 0 };
    doorMarks.set(map, marks);
  }
  marks.stamp += MARKS_PER_CALL;
  return marks;
}

/**
 * どれかの部屋の所属タイルか（1 = 所属）。階ごとに 1 回作って全部の部屋の扉探しで共有する
 * （部屋ごとに「他の部屋のタイルの Set」を作り直すと、部屋の数の 2 乗で重くなるため）
 */
export function roomTileMask(map: GameMap): Uint8Array {
  const mask = new Uint8Array(map.tiles.length);
  for (const list of map.roomTiles ?? []) for (const t of list) mask[t] = 1;
  return mask;
}

/**
 * 塊の部屋の出入口 = 塊に 8 近傍で接する、塊の外の床（斜めのすり抜けも塞ぐ）。
 * 広いマップでは部屋もタイルも多いので、Set ではなく使い回しの印の配列で数える。inAnyRoom は roomTileMask(map)
 */
export function findBlobDoorTiles(map: GameMap, tiles: readonly number[], inAnyRoom: Uint8Array = roomTileMask(map)): number[] {
  return dropPocketDoors(map, tiles, blobDoorCandidates(map, tiles), inAnyRoom).sort((a, b) => a - b);
}

/** 扉の候補: 塊に 8 近傍で接する、塊の外の床（重複なし。並びは塊のタイル順 × 近傍の順） */
function blobDoorCandidates(map: GameMap, tiles: readonly number[]): number[] {
  const { mark, stamp } = doorMarksOf(map);
  const roomStamp = stamp;
  const doorStamp = stamp + 1;
  const { width, height, tiles: cells } = map;
  for (const i of tiles) mark[i] = roomStamp;
  const doors: number[] = [];
  for (const i of tiles) {
    const x = i % width;
    const y = Math.floor(i / width);
    for (let k = 0; k < N8_COUNT; k++) {
      const nx = x + (N8_DX[k] ?? 0);
      const ny = y + (N8_DY[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!isPassableTile(cells[ni] ?? Tile.Wall) || mark[ni] === roomStamp || mark[ni] === doorStamp) continue;
      mark[ni] = doorStamp;
      doors.push(ni);
    }
  }
  return doors;
}

/**
 * 袋の扉を除く: 扉の候補から、部屋の外の床を 8 近傍で辿っても他の部屋のタイルに行き着かない成分（塊の中の首・柱の裏の窪み・
 * 主の間に取り込まれた床）に属するものを外す。封鎖しても外へ出られないので、閉じると部屋の中に見えない壁ができるだけになる
 */
function dropPocketDoors(map: GameMap, tiles: readonly number[], doors: readonly number[], inAnyRoom: Uint8Array): number[] {
  const own = new Set(tiles);
  const seen = new Set<number>();
  const keep: number[] = [];
  const doorSet = new Set(doors);
  for (const d of doors) {
    if (seen.has(d)) continue;
    const comp = [d];
    seen.add(d);
    let exit = false;
    for (let head = 0; head < comp.length; head++) {
      const i = comp[head] ?? 0;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (let k = 0; k < N8_COUNT; k++) {
        const nx = x + (N8_DX[k] ?? 0);
        const ny = y + (N8_DY[k] ?? 0);
        if (!isWalkable(map, nx, ny)) continue;
        const ni = toIndex(map, nx, ny);
        if (own.has(ni) || seen.has(ni)) continue;
        // 自分のタイルは上で除いたので、ここで部屋の所属なら他の部屋
        if (inAnyRoom[ni] === 1) {
          exit = true;
          continue;
        }
        seen.add(ni);
        comp.push(ni);
      }
    }
    if (!exit) continue;
    for (const c of comp) if (doorSet.has(c)) keep.push(c);
  }
  return keep;
}

/** タイルの持ち主: どの部屋のタイルでもない */
const NO_ROOM = -1;
/** タイルの持ち主: 2 つ以上の部屋が同じタイルを持つ */
const SHARED_ROOM = -2;
/** 部屋の外の床の成分が、2 つ以上の部屋（の持ち主の値）に接する */
const MANY_ROOMS = -3;
/** 部屋の外の床でないタイルの成分番号 */
const NO_COMPONENT = -1;

/**
 * 階ごとの扉探しの下ごしらえ。部屋ごとに袋の扉を探すと、部屋の外の床（通路網）を部屋の数だけ辿り直して重い
 * （通路の多い型で buildFloor の半分を超えた）。部屋の外の床の 8 近傍の成分と「その成分が接する部屋」を 1 回だけ数えて共有する
 */
interface DoorIndex {
  map: GameMap;
  /** タイルの持ち主の部屋（NO_ROOM / 部屋の番号 / SHARED_ROOM） */
  owner: Int32Array;
  inAnyRoom: Uint8Array;
  /** 部屋の外の床の成分（最初に塊の部屋の扉を探すときに作る） */
  outside: OutsideComponents | null;
}

interface OutsideComponents {
  /** タイルの成分番号（部屋の外の床でなければ NO_COMPONENT） */
  label: Int32Array;
  /** 成分ごとの接する部屋（NO_ROOM / 部屋の番号 / SHARED_ROOM / MANY_ROOMS） */
  touches: number[];
}

function createDoorIndex(map: GameMap): DoorIndex {
  const owner = new Int32Array(map.tiles.length).fill(NO_ROOM);
  const inAnyRoom = new Uint8Array(map.tiles.length);
  (map.roomTiles ?? []).forEach((list, room) => {
    for (const t of list) {
      inAnyRoom[t] = 1;
      const o = owner[t] ?? NO_ROOM;
      owner[t] = o === NO_ROOM || o === room ? room : SHARED_ROOM;
    }
  });
  return { map, owner, inAnyRoom, outside: null };
}

/** 成分の接する部屋に room を足す。違う部屋が 2 つ揃ったら MANY_ROOMS */
function mergeTouch(current: number, room: number): number {
  return current === NO_ROOM || current === room ? room : MANY_ROOMS;
}

/** 部屋の外の床（通れる・どの部屋のタイルでもない）を 8 近傍でつないだ成分と、成分ごとの接する部屋（通れる部屋のタイルだけ数える） */
function labelOutside(index: DoorIndex): OutsideComponents {
  const { map, owner, inAnyRoom } = index;
  const { width, height, tiles: cells } = map;
  const label = new Int32Array(cells.length).fill(NO_COMPONENT);
  const touches: number[] = [];
  const queue = new Int32Array(cells.length);
  for (let start = 0; start < cells.length; start++) {
    if (label[start] !== NO_COMPONENT || inAnyRoom[start] === 1 || !isPassableTile(cells[start] ?? Tile.Wall)) continue;
    const id = touches.length;
    let touch = NO_ROOM;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++] ?? 0;
      const x = i % width;
      const y = Math.floor(i / width);
      for (let k = 0; k < N8_COUNT; k++) {
        const nx = x + (N8_DX[k] ?? 0);
        const ny = y + (N8_DY[k] ?? 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!isPassableTile(cells[ni] ?? Tile.Wall)) continue;
        if (inAnyRoom[ni] === 1) {
          touch = mergeTouch(touch, owner[ni] ?? NO_ROOM);
          continue;
        }
        if (label[ni] !== NO_COMPONENT) continue;
        label[ni] = id;
        queue[tail++] = ni;
      }
    }
    touches.push(touch);
  }
  return { label, touches };
}

/**
 * 部屋 room（所属タイル tiles = map.roomTiles[room]）の扉。結果は findBlobDoorTiles と同じ。
 * 扉の候補がどれも部屋の外の床で、部屋のタイルを他の部屋と共有していなければ、候補の成分が自分以外の部屋に接するかで袋を見分ける
 * （袋の判定 = 成分を辿って他の部屋のタイルに行き着くか、と同じ）。そうでない珍しい形は部屋ごとに辿る元のやり方に任せる
 */
function roomBlobDoorTiles(index: DoorIndex, room: number, tiles: readonly number[]): number[] {
  const doors = blobDoorCandidates(index.map, tiles);
  if (!sharesComponents(index, room, tiles, doors)) {
    return dropPocketDoors(index.map, tiles, doors, index.inAnyRoom).sort((a, b) => a - b);
  }
  index.outside ??= labelOutside(index);
  const { label, touches } = index.outside;
  return doors.filter((d) => leadsElsewhere(touches[label[d] ?? NO_COMPONENT] ?? NO_ROOM, room)).sort((a, b) => a - b);
}

/** 共有の成分で袋を見分けられるか: 部屋のタイルを他の部屋と共有せず、扉の候補がどれも他の部屋のタイルでない */
function sharesComponents(index: DoorIndex, room: number, tiles: readonly number[], doors: readonly number[]): boolean {
  for (const t of tiles) if (index.owner[t] !== room) return false;
  for (const d of doors) if (index.inAnyRoom[d] === 1) return false;
  return true;
}

/** 成分の接する部屋に、room 以外の部屋があるか */
function leadsElsewhere(touch: number, room: number): boolean {
  return touch === MANY_ROOMS || (touch !== NO_ROOM && touch !== room);
}

/** 部屋に置く敵の抽選回数。広い階（部屋も大きい）は 面積の倍率 ^ MAP_SIZE.roomEnemiesExp 倍（倍率 1 なら基準と同じ） */
export function enemyCount(state: GameState): number {
  const base = ROOM.baseEnemies + Math.floor(state.depth * ROOM.enemiesPerDepth);
  const areaMul = state.floorAreaMul ?? 1;
  const scaled = areaMul === 1 ? base : Math.round(base * areaMul ** MAP_SIZE.roomEnemiesExp);
  return Math.min(maxEnemiesFor(state.depth), scaled);
}

/** 部屋の敵数の上限。深み（最深の間の次の階から）では上限を上げて数でも押す */
export function maxEnemiesFor(depth: number): number {
  return ROOM.maxEnemies + (isDeepDepth(depth) ? DEEP.maxEnemiesBonus : 0);
}

function populateRoom(state: GameState, room: RoomState, index: number): void {
  const count = enemyCount(state);
  for (let i = 0; i < count; i++) spawnGroup(state, room, index, false);
  finalizeLinks(state, index);
}

/** 1 回の抽選ぶんを湧かせる。群れる敵（bat）は複数体 */
function spawnGroup(state: GameState, room: RoomState, index: number, spawning: boolean): void {
  const def = pickEnemy(state);
  const n = def.swarm ? state.rng.int(def.swarm.min, def.swarm.max) : 1;
  for (let k = 0; k < n; k++) {
    const pos = randomFreePoint(state, room, index, def.radius);
    if (!pos) continue;
    const e = createEnemy(state, def, pos, index, spawning);
    if (spawning) e.phaseTimer = ROOM.spawnTelegraph;
    onRunEnemySpawned(state, e);
    rollElite(state, e);
    state.enemies.push(e);
  }
}

/** 部屋にいる生存中の敵の実体数（群れも 1 体ずつ数える） */
function roomEnemyCount(state: GameState, index: number): number {
  return state.enemies.filter((e) => e.roomIndex === index && e.hp > 0).length;
}

/**
 * spawnGroup を最大 rolls 回試すが、部屋の敵実体数が ROOM.maxEnemies に達したら
 * それ以上は湧かせない（bat の群れは 1 抽選で複数体出るため、通常の抽選回数だけでは上限を守れない）
 */
function spawnCapped(state: GameState, room: RoomState, index: number, spawning: boolean, rolls: number): void {
  for (let i = 0; i < rolls; i++) {
    if (roomEnemyCount(state, index) >= maxEnemiesFor(state.depth)) break;
    spawnGroup(state, room, index, spawning);
  }
}

export function pickEnemy(state: GameState): EnemyDef {
  const pool = enemiesForDepth(state.depth);
  const weight = (d: EnemyDef): number => biomeEnemyWeight(d, state.floorKind);
  const total = pool.reduce((s, d) => s + weight(d), 0);
  let roll = state.rng.next() * total;
  for (const def of pool) {
    roll -= weight(def);
    if (roll <= 0) return def;
  }
  return pool[pool.length - 1] ?? pool[0]!;
}

const FREE_POINT_ATTEMPTS = 30;
/** プレイヤーの近くに湧かせない距離 */
const SPAWN_CLEARANCE = 40;

function randomFreePoint(state: GameState, room: RoomState, index: number, radius: number): { x: number; y: number } | null {
  for (let i = 0; i < FREE_POINT_ATTEMPTS; i++) {
    const { x, y } = randomPointIn(state, room, index);
    if (!circleInRoomTiles(state, room, x, y, radius)) continue;
    if (overlapsWall(state, x, y, radius)) continue;
    const p = state.player.body.pos;
    if (circlesOverlap(x, y, radius, p.x, p.y, SPAWN_CLEARANCE)) continue;
    if (state.enemies.some((e) => circlesOverlap(x, y, radius, e.body.pos.x, e.body.pos.y, e.body.radius))) continue;
    return { x, y };
  }
  return null;
}

/**
 * 候補点。矩形の部屋は外周 1 マス内側、塊の部屋（洞窟）は所属タイル全体から選ぶ
 * （rect は塊に内接する小さな正方形なので、そこだけだと湧き場所が足りない）
 */
function randomPointIn(state: GameState, room: RoomState, index: number): { x: number; y: number } {
  const tiles = room.tiles ? state.map.roomTiles?.[index] : undefined;
  if (tiles && tiles.length > 0) {
    const t = tiles[state.rng.int(0, tiles.length - 1)] ?? 0;
    const tx = t % state.map.width;
    const ty = Math.floor(t / state.map.width);
    return { x: (tx + state.rng.next()) * TILE_SIZE, y: (ty + state.rng.next()) * TILE_SIZE };
  }
  const r = room.rect;
  return {
    x: (r.x + 1 + state.rng.next() * (r.w - 2)) * TILE_SIZE,
    y: (r.y + 1 + state.rng.next() * (r.h - 2)) * TILE_SIZE,
  };
}

/** 半径 r の AABB が塊の所属タイルに収まるか（扉タイルに掛かっているとロックで壁に埋まる）。r < TILE_SIZE 前提 */
function circleInRoomTiles(state: GameState, room: RoomState, x: number, y: number, r: number): boolean {
  if (!room.tiles) return true;
  return (
    pxInRoomTiles(state, room, x - r, y - r) &&
    pxInRoomTiles(state, room, x + r, y - r) &&
    pxInRoomTiles(state, room, x - r, y + r) &&
    pxInRoomTiles(state, room, x + r, y + r)
  );
}

/** 塊の部屋なら所属タイル上か。矩形の部屋は常に true */
function pxInRoomTiles(state: GameState, room: RoomState, px: number, py: number): boolean {
  if (!room.tiles) return true;
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  return inBounds(state.map, tx, ty) && room.tiles.has(toIndex(state.map, tx, ty));
}

/**
 * 中心と 8 方向 margin 先の点。margin(10) > 半径(5) なので、9 点が全て塊の中なら
 * プレイヤーの AABB は扉タイルに掛からない（斜めを省くと凹んだ角でロックした扉に埋まる）
 */
const ENTER_PROBES = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** 部屋の内側に margin 以上入り込んでいるか（扉を跨いでいる間はロックしない） */
export function insideRoom(state: GameState, room: RoomState, px: number, py: number, margin: number): boolean {
  if (!room.tiles) return rectContainsPx(room.rect, px, py, margin);
  return ENTER_PROBES.every(([dx, dy]) => pxInRoomTiles(state, room, px + dx * margin, py + dy * margin));
}

/** 部屋のロック/解除・開放型の交戦と制圧、徘徊と陣の進行、階段、ピックアップ */
export function updateRooms(state: GameState, dt: number): void {
  revealAround(state);
  state.rooms.forEach((room, i) => {
    if (room.cleared) return;
    if (room.locked) {
      updateLockedRoom(state, room, i);
      return;
    }
    updateOpenRoom(state, room, i);
  });

  updateRoamers(state, dt);
  updateJinPhases(state);
  updateLookouts(state);
  updateShrines(state);
  updateSpecialRooms(state, dt);
  updateContractors(state, dt);
  updateMerchants(state, dt);
  ensureForkStairs(state);
  updateBossIntro(state, dt);
  updatePickups(state, dt);
  updateFloorItems(state, dt);
  updateHiddenRoom(state, dt);
  checkStairs(state);
  updateFinale(state);
}

/** 封鎖中に扉の向こうへ取り残された敵がいないかを見る間隔（tick。約 1 秒。整数の tick で数えるので浮動小数の比較が無い） */
const STRAY_CHECK_TICKS = Math.max(1, Math.round(1 / FIXED_DT));

function updateLockedRoom(state: GameState, room: RoomState, index: number): void {
  // 閉じた扉の向こう（壁すり抜けの敵が出た、塊が扉で分かれた）の敵は倒せず、制圧が永遠に終わらない。足元から届く側へ戻す
  if (state.tick % STRAY_CHECK_TICKS === 0) pullStraysInside(state, room, index, false);
  if (roomAlive(state, index)) return;
  if (hasMoreWaves(room)) {
    startWave(state, room, () => spawnWave(state, room, index));
    return;
  }
  clearRoom(state, room, index);
}

/**
 * 封鎖していない部屋: 入る（または部屋の敵が気付く）と交戦が始まり、部屋の敵の全滅で制圧（1 部屋 1 回）。
 * 封鎖する種類は入った時点で enterRoom が封鎖する
 */
function updateOpenRoom(state: GameState, room: RoomState, index: number): void {
  const p = state.player.body.pos;
  if (!room.engaged) {
    if (insideRoom(state, room, p.x, p.y, ROOM.enterMargin)) enterRoom(state, room, index);
    else if (lordProvoked(state, index)) summonIntoLordHall(state, room, index);
    else if (!roomLocks(state, index) && roomNoticed(state, index)) engageRoom(state, room, index);
  }
  if (room.cleared || room.locked || !room.engaged) return;
  if (!roomAlive(state, index)) clearRoom(state, room, index);
}

/** 部屋にまだ生きた敵がいるか（従魔は制圧の数に入れない） */
function roomAlive(state: GameState, index: number): boolean {
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0 && !isAllied(state, e));
}

/** 部屋の敵のどれかがプレイヤーに気付いた（idle から抜けた） */
function roomNoticed(state: GameState, index: number): boolean {
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0 && e.phase !== "idle");
}

/**
 * ボス階の主の間が、封鎖前に傷を負ったか（門の通路は主の立つ中央へまっすぐ向くので、入らずに撃てる）。
 * 主の間の敵は主（と双子の相方）だけで、封鎖前の主の間でプレイヤー以外に主を傷つけるものは無いので、
 * 「HP が減った」をプレイヤーの攻撃の印にする（combat.ts の被弾の流れに手を入れずに済む）。
 * 通常の階の階の主（陣の部屋）は対象にしない
 */
function lordProvoked(state: GameState, index: number): boolean {
  const boss = state.boss;
  if (state.floorLayout !== "lordHall" || !boss || boss.roomIndex !== index || boss.defeated) return false;
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0 && e.hp < e.maxHp && !isAllied(state, e));
}

/**
 * 封鎖前の狙撃への答え: 主の間の外にいるプレイヤーを主の間の口の内側へ引き込み、そのまま封鎖する。
 * 主を起こして外へ追わせる案は採らない（ボスの技・記録・登場演出はどれも封鎖した主の間の中で戦う前提で、
 * 外で戦うと封鎖の時刻が付かず記録が残らない・取り巻きや仕掛けが主の間に出る）。寄せ先が無ければ封鎖しない（締め出さない）
 */
function summonIntoLordHall(state: GameState, room: RoomState, index: number): void {
  const to = summonSpot(state, room);
  if (!to) return;
  const body = state.player.body;
  lordPullFx(state, body.pos, to);
  body.pos = to;
  body.vel = { x: 0, y: 0 };
  snapCamera(state);
  lockRoom(state, room, index);
}

/**
 * 引き込み先: 部屋に入ったとみなされ（ROOM.enterMargin）、壁・扉・生きた敵に重ならない部屋のタイルの中心のうち、
 * プレイヤーに一番近いもの（同じ距離は部屋タイルの走査順で先。乱数は使わない）
 */
function summonSpot(state: GameState, room: RoomState): { x: number; y: number } | null {
  const p = state.player.body.pos;
  const r = state.player.body.radius;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const t of roomTileIndices(state, room)) {
    const c = tileCenterPx(state, t);
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d >= bestD || !summonSpotFree(state, room, c.x, c.y, r)) continue;
    best = c;
    bestD = d;
  }
  return best;
}

function summonSpotFree(state: GameState, room: RoomState, x: number, y: number, r: number): boolean {
  if (!insideRoom(state, room, x, y, ROOM.enterMargin)) return false;
  if (overlapsWall(state, x, y, r) || circleOnDoorTiles(state, room, x, y, r)) return false;
  return !state.enemies.some((e) => e.hp > 0 && circlesOverlap(x, y, r, e.body.pos.x, e.body.pos.y, e.body.radius));
}

/**
 * 封鎖しない部屋の交戦開始。部屋の敵をまとめて起こし、封鎖と同じフック（祝福・ルール・ランイベント・呪い）を通す
 * （「封鎖時」を条件にする祝福やイベントを、開放型でも部屋ごとに 1 回起こすため）
 */
function engageRoom(state: GameState, room: RoomState, index: number): void {
  room.engaged = true;
  if (!roomAlive(state, index)) return;
  wakeRoom(state, index);
  pushPlayerEvent(state, "onRoomLock", "room", { tag: room.kind, room: index, source: { kind: "room", key: room.kind } });
  onRoomLocked(state, index);
  applyCurse(state, index);
}

/**
 * 部屋の敵をまとめて起こす: 塊に乗った陣は wakeJin（気付いた者の近くだけ。残りは後詰）、陣に属さない敵（特別な部屋の湧き）も起こす
 */
function wakeRoom(state: GameState, index: number): void {
  for (const jin of state.jins) {
    if (jin.roomIndex === index) wakeJin(state, jin);
  }
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.jinId === undefined && e.phase === "idle") e.phase = "chase";
  }
}

function enterRoom(state: GameState, room: RoomState, index: number): void {
  if (room.kind === "treasure") {
    openTreasure(state, room);
    return;
  }
  if (enterSpecialRoom(state, room)) return;
  if (!roomLocks(state, index)) {
    engageRoom(state, room, index);
    return;
  }
  // 保険: プレイヤーがドアタイルに掛かっている間はロックを次フレームへ延期
  // （enterMargin/insideRoom で通常は防げているはずだが、念のため二重に確認）
  const p = state.player.body;
  if (circleOnDoorTiles(state, room, p.pos.x, p.pos.y, p.radius)) return;
  lockRoom(state, room, index);
}

const DOOR_PUSH_MAX_TRIES = 3;

/**
 * 中心 (x, y) 半径 r の AABB が room のいずれかのドアタイルに掛かっているか。
 * isSolidTile / overlapsWall と同じ AABB 走査（overlapsTiles）で判定する。
 * 以前は円と矩形の厳密な重なり（boxCircleOverlap）で判定していたが、それだと
 * isSolidTile 側（AABB 判定）より厳しく、斜め隅では「AABB は壁タイルに重なっているのに
 * ここでは重なっていない」と判定がズレ、ロック時に押し出されない敵が壁に埋まっていた
 * （QA report.md 付録「ドアタイル上でロックされた敵が壁の中判定になる」）
 */
function circleOnDoorTiles(state: GameState, room: RoomState, x: number, y: number, r: number): boolean {
  return overlapsTiles(state, x, y, r, room.doorTiles);
}

/** 強欲のが抱えていた物（system/elites.ts の rescueCarried が取り上げる） */
type CarriedLoot = ReturnType<typeof rescueCarried>;
/** 何も抱えていない（呼び出しごとに新しく作り、共有の配列を持たない） */
function nothingCarried(): CarriedLoot {
  return { items: [], stones: [] };
}

/**
 * ドアタイルをロックで壁扱いにする直前に、ドアタイル上に AABB が掛かっている敵を押し出す。
 * 所属（roomIndex）を問わず全ての敵が対象。以前は自室の敵だけを見ていたため、プレイヤーを
 * 追って隣室から来た敵が扉タイル上にいるとそのまま壁に埋まっていた（QA seed=50025/50028）。
 * - 自室の敵: 部屋の中へ。外へ出すと封鎖中の部屋から倒せない敵が生まれ、制圧できなくなる
 * - 他室の敵: 部屋の外へ（元いた側）。無理なら部屋の中へ（倒せば済むので害はない）
 * この step で撃破済み（hp <= 0）の敵も押し出す。配列からの除去と死亡時処理（爆発・エリート死亡）は
 * 次の updateEnemies で行われるため、それまでの 1 フレームは扉の上に残ってしまう（QA seed=50020）。
 * どちらにも押し出せない生存中の敵はその場で配列から取り除く
 * （hp = 0 だけだと次フレームの死亡処理まで「壁に埋まった死体」が残り、死亡演出やドロップも
 * 通常の撃破経路を通らないので、静かに取り除く方が実態に合う）。
 * 撃破済みの敵は死亡時処理を飛ばさないよう取り除かない
 */
function pushEnemiesOffDoorTiles(state: GameState, room: RoomState, index: number): CarriedLoot {
  if (room.doorTiles.length === 0) return nothingCarried();
  const center = rectCenterPx(room.rect);
  const stuck = new Set<Enemy>();
  for (const e of state.enemies) {
    if (!circleOnDoorTiles(state, room, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const inward = normalize(sub(center, e.body.pos));
    const outward = { x: -inward.x, y: -inward.y };
    const pushed = e.roomIndex === index
      ? pushEnemyToward(state, room, e, inward)
      : pushEnemyToward(state, room, e, outward) || pushEnemyToward(state, room, e, inward);
    if (!pushed && e.hp > 0) stuck.add(e);
  }
  if (stuck.size === 0) return nothingCarried();
  // 強欲のが抱えていた遺物・スキル石は敵と一緒に消さない（撃破の経路を通らないので取り上げ、lockRoom が足元へ落とす）
  const rescued = rescueCarried(stuck);
  state.enemies = state.enemies.filter((e) => !stuck.has(e));
  return rescued;
}

const CARDINALS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

/**
 * dir 側へ押し出す。まず dir そのもの、次に dir と同じ向きの成分を持つ軸方向を試す
 * （細い通路の扉では斜めの dir だと 1 歩目で壁に当たるため、軸方向の候補が要る）。
 * 逆向きの軸は試さない（自室の敵を部屋の外へ出さないため）。失敗時は元の位置に戻す
 */
function pushEnemyToward(state: GameState, room: RoomState, e: Enemy, dir: { x: number; y: number }): boolean {
  const axes = CARDINALS.filter((c) => c.x * dir.x + c.y * dir.y > 0).sort((a, b) => b.x * dir.x + b.y * dir.y - (a.x * dir.x + a.y * dir.y));
  for (const d of [dir, ...axes]) {
    if (pushEnemyAlong(state, room, e, d)) return true;
  }
  return false;
}

/** 1 タイルぶんずつ d 方向へ動かす。壁に阻まれたら元の位置に戻して諦め、ドアタイルから外れたら成功 */
function pushEnemyAlong(state: GameState, room: RoomState, e: Enemy, d: { x: number; y: number }): boolean {
  const ox = e.body.pos.x;
  const oy = e.body.pos.y;
  let x = ox;
  let y = oy;
  for (let i = 0; i < DOOR_PUSH_MAX_TRIES; i++) {
    x += d.x * TILE_SIZE;
    y += d.y * TILE_SIZE;
    if (overlapsWall(state, x, y, e.body.radius)) break;
    if (circleOnDoorTiles(state, room, x, y, e.body.radius)) continue;
    e.body.pos.x = x;
    e.body.pos.y = y;
    return true;
  }
  e.body.pos.x = ox;
  e.body.pos.y = oy;
  return false;
}

/** 敵の中心が部屋（塊ならその所属タイル、矩形なら rect）の上か */
function enemyInRoom(state: GameState, room: RoomState, e: Enemy): boolean {
  const { x, y } = e.body.pos;
  if (room.tiles) return pxInRoomTiles(state, room, x, y);
  return rectContainsPx(room.rect, x, y);
}

/** 部屋の床タイル（塊なら所属タイル、矩形なら rect 内）の添字。走査順は決定的 */
function roomTileIndices(state: GameState, room: RoomState): number[] {
  if (room.tiles) return [...room.tiles];
  const r = room.rect;
  const out: number[] = [];
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (inBounds(state.map, tx, ty)) out.push(toIndex(state.map, tx, ty));
    }
  }
  return out;
}

/** 寄せ先に使えるか: 部屋に収まり、壁・扉に重ならない。avoidEnemies なら他の生きた敵にも重ならない */
function strayTargetFree(state: GameState, room: RoomState, e: Enemy, x: number, y: number, avoidEnemies: boolean): boolean {
  const r = e.body.radius;
  if (!room.tiles && !rectContainsPx(room.rect, x, y, r)) return false;
  if (!circleInRoomTiles(state, room, x, y, r)) return false;
  if (overlapsWall(state, x, y, r) || circleOnDoorTiles(state, room, x, y, r)) return false;
  if (!avoidEnemies) return true;
  return !state.enemies.some((o) => o !== e && o.hp > 0 && circlesOverlap(x, y, r, o.body.pos.x, o.body.pos.y, o.body.radius));
}

/** タイル添字の中心（px） */
function tileCenterPx(state: GameState, t: number): { x: number; y: number } {
  return { x: ((t % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(t / state.map.width) + 0.5) * TILE_SIZE };
}

/** reachableFromPlayer の印: 届く床（寄せ先・敵の位置に使える） */
const REACH_FLOOR = 1;
/** reachableFromPlayer の印: 骨の壁（通り抜けて先を数えるが、寄せ先にも「届く敵の位置」にもしない） */
const REACH_BONE_WALL = 2;

/** 骨の壁（ボス・骨猪・柵が立てる一時の壁。lockedTiles に入る）のタイル */
function boneWallTiles(state: GameState): ReadonlySet<number> {
  const out = new Set<number>();
  for (const h of state.hazards) if (h.kind === "boneWall") out.add(h.tile);
  return out;
}

/**
 * プレイヤーのタイルから 4 近傍で歩いて届くタイルの印（壁と封鎖中の扉で塞がる）。
 * 骨の壁は崩せば・待てば通れるので塞がない扱いにする（塞ぐと、骨の壁で区切られた側の敵や、
 * 骨の壁に囲まれたプレイヤーの周りへ部屋の敵が毎秒寄せられて、壁で分断する技が成り立たない）。
 * 配列はタイル数ぶんの 1 枚だけ。プレイヤーが部屋の外、または壁・扉の上にいるとき（押し出し中など）は判定できないので null
 */
function reachableFromPlayer(state: GameState, room: RoomState): Uint8Array | null {
  const map = state.map;
  const p = state.player.body.pos;
  // 部屋の外にいる（扉の向こうへ出た）なら「届く側」は外の世界になってしまい、部屋の敵を全員外へ寄せかねない
  if (!insideRoom(state, room, p.x, p.y, 0)) return null;
  const sx = Math.floor(p.x / TILE_SIZE);
  const sy = Math.floor(p.y / TILE_SIZE);
  if (isSolidTile(state, sx, sy)) return null;
  const bone = boneWallTiles(state);
  const reach = new Uint8Array(map.tiles.length);
  const queue: number[] = [toIndex(map, sx, sy)];
  reach[queue[0] ?? 0] = REACH_FLOOR;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (const c of CARDINALS) {
      const nx = x + c.x;
      const ny = y + c.y;
      // 穴も塞ぐ（川・池の向こう岸の敵は歩いて届かないので寄せる）
      if (!inBounds(map, nx, ny) || !isPassableTile(getTile(map, nx, ny))) continue;
      const ni = toIndex(map, nx, ny);
      if (reach[ni] !== 0) continue;
      const isBone = bone.has(ni);
      if (state.lockedTiles.has(ni) && !isBone) continue;
      reach[ni] = isBone ? REACH_BONE_WALL : REACH_FLOOR;
      queue.push(ni);
    }
  }
  return reach;
}

/** 敵の中心のタイルに届けるか（マップ外は届かない） */
function reachesEnemy(state: GameState, reach: Uint8Array, e: Enemy): boolean {
  const tx = Math.floor(e.body.pos.x / TILE_SIZE);
  const ty = Math.floor(e.body.pos.y / TILE_SIZE);
  return inBounds(state.map, tx, ty) && reach[toIndex(state.map, tx, ty)] === REACH_FLOOR;
}

/** 壁をすり抜ける敵が壁（か穴）の中にいる（通り抜けの途中。寄せると毎秒瞬間移動するので見逃す） */
function phasingInWall(state: GameState, e: Enemy): boolean {
  if (!enemyDef(e.defKey).phasing) return false;
  const tx = Math.floor(e.body.pos.x / TILE_SIZE);
  const ty = Math.floor(e.body.pos.y / TILE_SIZE);
  return !inBounds(state.map, tx, ty) || !isPassableTile(getTile(state.map, tx, ty));
}

/**
 * 寄せ先: 部屋の床タイルのうち、届くもの（reach）の中でプレイヤーから一番遠い空き地点
 * （ROAM.minSpawnDist 以上離れた点があれば必ずそれが選ばれる。目の前に湧かせないため）。
 * 空きが無ければ部屋の中心付近の空き、それも無ければ中心
 */
function strayTarget(state: GameState, room: RoomState, e: Enemy, reach: Uint8Array | null): { x: number; y: number } {
  const p = state.player.body.pos;
  let best: { x: number; y: number } | null = null;
  let bestD = -1;
  for (const t of roomTileIndices(state, room)) {
    if (reach && reach[t] !== REACH_FLOOR) continue;
    const { x, y } = tileCenterPx(state, t);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= bestD || !strayTargetFree(state, room, e, x, y, true)) continue;
    best = { x, y };
    bestD = d;
    if (d >= ROAM.minSpawnDist) break;
  }
  if (best) return best;
  const center = rectCenterPx(room.rect);
  return findFreeSpot(state, center, e.body.radius) ?? center;
}

/**
 * 寄せ先: 届く部屋タイルのうち、敵の元の位置に一番近いタイルの中心（同じ距離は部屋タイルの走査順で先）。
 * まず他の敵に重ならない所、無ければ重なってよい所、それも無ければ届く最寄りのタイルの中心。届くタイルが 1 つも無ければ null
 */
function nearestReachableTarget(state: GameState, room: RoomState, e: Enemy, reach: Uint8Array): { x: number; y: number } | null {
  const from = e.body.pos;
  const pick = (accept: (x: number, y: number) => boolean): { x: number; y: number } | null => {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const t of roomTileIndices(state, room)) {
      if (reach[t] !== REACH_FLOOR) continue;
      const c = tileCenterPx(state, t);
      const d = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
      // 近さで足切りしてから空きを調べる（空きの判定は生きた敵の全走査なので、全タイルでは呼ばない）
      if (d >= bestD || !accept(c.x, c.y)) continue;
      best = c;
      bestD = d;
    }
    return best;
  };
  return (
    pick((x, y) => strayTargetFree(state, room, e, x, y, true)) ??
    pick((x, y) => strayTargetFree(state, room, e, x, y, false)) ??
    pick(() => true)
  );
}

/**
 * 寄せる敵か。atLock（封鎖の瞬間）は部屋の外にいる自室の敵も対象。
 * どちらでも、足元（プレイヤーのタイル）から歩いて届かない敵は対象にする（閉じた扉の向こうに残った・塊が扉で分かれた）。
 * 壁の中を通り抜けている最中の敵は見逃す（reach が null = プレイヤーが判定できない位置なら部屋の外の判定だけ）
 */
function isStray(state: GameState, room: RoomState, e: Enemy, reach: Uint8Array | null, atLock: boolean): boolean {
  if (atLock && !enemyInRoom(state, room, e)) return true;
  if (!reach || reachesEnemy(state, reach, e)) return false;
  return !phasingInWall(state, e);
}

/**
 * 自室の生きた敵のうち、封鎖の扉越しに倒せなくなったものを中へ寄せる。roomAlive は roomIndex だけで数えるので、
 * 外に出た自室の敵（追跡で出た雑魚、抱えて逃げた強欲の）や、扉で分かれた塊の向こうの敵が残ると制圧できなくなる。
 * 封鎖の瞬間（atLock）の外の敵はプレイヤーから遠い所へ、それ以外は元の位置に一番近い届く所へ寄せる。
 * 決定性のため敵 id 順に処理し、乱数は使わない。扉を閉じた後（lockedTiles に入った後）に呼ぶ
 */
function pullStraysInside(state: GameState, room: RoomState, index: number, atLock: boolean): void {
  const own = state.enemies.filter((e) => e.roomIndex === index && e.hp > 0 && !isAllied(state, e));
  if (own.length === 0) return;
  const reach = reachableFromPlayer(state, room);
  const strays = own.filter((e) => isStray(state, room, e, reach, atLock)).sort((a, b) => a.id - b.id);
  for (const e of strays) {
    const outside = atLock && !enemyInRoom(state, room, e);
    const to = (reach && !outside ? nearestReachableTarget(state, room, e, reach) : null) ?? strayTarget(state, room, e, reach);
    e.body.pos.x = to.x;
    e.body.pos.y = to.y;
  }
}

function lockRoom(state: GameState, room: RoomState, index: number): void {
  const rescued = pushEnemiesOffDoorTiles(state, room, index);
  room.locked = true;
  for (const t of room.doorTiles) state.lockedTiles.add(t);
  // 扉を閉じた後に寄せる（届くかどうかを閉じた扉込みで数えるため）
  pullStraysInside(state, room, index, true);
  // 扉を閉じた後に置く（閉じる前だと扉タイルの上に落ちて、制圧まで壁の中に埋まる）
  dropGreedyLootAtPlayer(state, rescued);
  roomLockFx(state, index, room.kind === "horde");
  wakeRoom(state, index);
  pushPlayerEvent(state, "onRoomLock", "room", { tag: room.kind, room: index, source: { kind: "room", key: room.kind } });
  onRoomLocked(state, index);
  if (state.boss && state.boss.roomIndex === index) {
    announceBoss(state);
    // 階の主（major でない）は取り巻きを連れる。5 の倍数の階のボスは今までどおり単騎
    if (!state.boss.major) {
      spawnCapped(state, room, index, true, Math.round(enemyCount(state) * FLOOR_LORD.escortRatio));
      finalizeLinks(state, index);
      const escorts = state.enemies.filter((e) => e.roomIndex === index);
      createBossJin(state, index, state.boss.enemyId, escorts);
    }
    return;
  }
  if (room.kind === "challenge" || room.kind === "arena" || room.kind === "horde") {
    startWave(state, room, () => spawnWave(state, room, index));
    applyCurse(state, index);
    if (room.kind === "horde") announceHorde(state);
    return;
  }
  // 増援を telegraph 付きで湧かせる。伏兵部屋は最初は無人で、通常の 2 倍が一気に湧く。
  // 護衛・鏡は自分で湧かせる（lockSpecialRoom が true）
  const ambush = room.kind === "ambush";
  const ratio = ambush ? ROOM_KIND.ambushEnemyMul : ROOM.reinforcementRatio;
  const extra = Math.round(enemyCount(state) * ratio);
  if (!lockSpecialRoom(state, room, index)) spawnCapped(state, room, index, true, extra);
  finalizeLinks(state, index);
  applyCurse(state, index);
  shake(state, ambush ? AMBUSH_SHAKE : LOCK_SHAKE);
  if (ambush) announceAmbush(state);
  else addFloatingText(state, p2(state), "封鎖", "#ff8080", 1.2, 0.8, "notice");
  pushSfx(state, "roomLock");
}

/** challenge / arena / horde の 1 波ぶん（telegraph 付き） */
function spawnWave(state: GameState, room: RoomState, index: number): void {
  const count = Math.max(MIN_WAVE_ENEMIES, Math.round(enemyCount(state) * waveMul(room.kind)));
  for (let i = 0; i < count; i++) spawnGroup(state, room, index, true);
  finalizeLinks(state, index);
  // 前の波の取り残しを次の波で放置しない（届かない敵は倒せず、この波も終われない）
  pullStraysInside(state, room, index, false);
}

const HORDE_SHAKE = 6;
const HORDE_TEXT_SCALE = 1.5;
const HORDE_TEXT_LIFE = 1.2;

/** 巣窟の封鎖: 大きく揺らして名前を出す */
function announceHorde(state: GameState): void {
  shake(state, HORDE_SHAKE);
  addFloatingText(state, p2(state), "巣窟！", ROOM_KIND.hordeColor, HORDE_TEXT_SCALE, HORDE_TEXT_LIFE, "notice");
  pushLog(state, "巣窟に踏み込んだ。群れが湧き出す。", ROOM_KIND.hordeColor);
  pushSfx(state, "ambush");
}

function clearRoom(state: GameState, room: RoomState, index: number): void {
  room.locked = false;
  room.cleared = true;
  for (const t of room.doorTiles) state.lockedTiles.delete(t);
  state.score += ROOM.clearBonus;
  addFloatingText(state, p2(state), roomClearText(state, index), "#ffd75f", 1.5, 1, "notice");
  state.flash = Math.max(state.flash, 0.25);
  pushSfx(state, "roomClear");
  roomClearFx(state, index);
  const center = clearAnchor(state, room);
  dropRoomReward(state, center);
  fireTrigger(state, "onRoomClear", { pos: { ...state.player.body.pos } });
  pushPlayerEvent(state, "onRoomClear", "room", { tag: room.kind, source: { kind: "room", key: room.kind } });
  recordProvenance(state, { kind: "roomClear" });
  onContractsRoomCleared(state, room);
  onRoomClearedCoins(state, room, index);
  onRoomCleared(state, room, index);
  clearSpecialRoom(state, room, center);
  applyDangerReward(state, room, center);
  // 試練: rare 確定 + ハート確定
  if (room.kind === "challenge") {
    dropRareItem(state, center);
    dropHeart(state, center);
    return;
  }
  if (state.rng.chance(heartChanceOf(state.depth))) dropHeart(state, center);
}

/** 報酬を置く点から階段までずらす量（タイル）。階段の上に置くと拾う前に降りてしまう */
const STAIRS_AVOID_OFFSETS = [
  [0, 1.5],
  [0, -1.5],
  [1.5, 0],
  [-1.5, 0],
] as const;
const REWARD_CLEARANCE = 4;

/**
 * 制圧の報酬を置く点。プレイヤーが部屋の中なら部屋の中心、外（追ってきた敵を通路で倒した）ならプレイヤーの足元
 * （開放型では部屋から離れた所で制圧が起こるので、中心に置くと取りに戻らされる）
 */
function clearAnchor(state: GameState, room: RoomState): { x: number; y: number } {
  const p = state.player.body.pos;
  if (insideRoom(state, room, p.x, p.y, 0)) return rewardAnchor(state, rectCenterPx(room.rect));
  return rewardAnchor(state, { ...p });
}

/** 報酬を置く点。階段の上なら隣の床へずらす */
function rewardAnchor(state: GameState, c: { x: number; y: number }): { x: number; y: number } {
  if (!onStairs(state, c.x, c.y)) return c;
  for (const [dx, dy] of STAIRS_AVOID_OFFSETS) {
    const q = { x: c.x + dx * TILE_SIZE, y: c.y + dy * TILE_SIZE };
    if (!overlapsWall(state, q.x, q.y, REWARD_CLEARANCE) && !onStairs(state, q.x, q.y)) return q;
  }
  return c;
}

function onStairs(state: GameState, px: number, py: number): boolean {
  return getTile(state.map, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE)) === Tile.StairsDown;
}

function dropHeart(state: GameState, pos: { x: number; y: number }): void {
  if (!boonHeartsAllowed(state) || hasMod(state, "dryFountain")) return;
  state.pickups.push({ id: allocId(state), kind: "heart", pos: { ...pos }, radius: PICKUP_RADIUS, bobTime: 0 });
}

function p2(state: GameState): { x: number; y: number } {
  return { x: state.player.body.pos.x, y: state.player.body.pos.y - TEXT_LIFT };
}

function updatePickups(state: GameState, dt: number): void {
  updateCoinPickups(state, dt);
  const p = state.player.body;
  for (const pk of state.pickups) {
    if (pk.kind !== "heart") continue;
    pk.bobTime += dt;
    // ks_vampire: ハートは触れても消えない
    if (!heartsAllowed(state) || coreBlocksHearts(state)) continue;
    if (!circlesOverlap(pk.pos.x, pk.pos.y, pk.radius, p.pos.x, p.pos.y, p.radius)) continue;
    healPlayer(state, ROOM.heartHeal);
    spawnBurst(state, pk.pos, COLOR_HEAL, 12, 100, 0.4, 2);
    pk.radius = 0;
  }
  state.pickups = state.pickups.filter((pk) => pk.radius > 0);
}

function checkStairs(state: GameState): void {
  const p = state.player.body.pos;
  const tx = Math.floor(p.x / TILE_SIZE);
  const ty = Math.floor(p.y / TILE_SIZE);
  if (getTile(state.map, tx, ty) !== Tile.StairsDown) return;
  // 上り階段で戻ってから降り直した階では 3 択を出さない（戻る → 降りるの往復で祝福を稼がせない）
  const fresh = state.depth + 1 > state.runEvents.strata.deepest;
  const tile = toIndex(state.map, tx, ty);
  const reward = stairsRewardAt(state, tile);
  descend(state, stairsChoiceAt(state, tile), reward);
  // 祝福の 3 択・錬磨は階段で降りたときだけ（descend 直呼びのテストや生成処理は止めない）。
  // 3 択は祝福の出口を選んだ階だけ。ボス階を抜けた直後の提示は格が 1 段上がる
  if (fresh) offerArrivalChoices(state, reward, stairsGradeBoost(isBossDepth(state.depth - 1)));
}

/**
 * 次の階へ。nextKind は分岐路の階段の行き先（省略時は深度の規則で抽選）。
 * reward は出口の予告（省略 = 予告なし）。初めて着いた階だけ、buildFloor と到着報酬で確定する
 */
export function descend(state: GameState, nextKind?: FloorKind, reward?: ExitReward): void {
  const strata = state.runEvents.strata;
  // 上り階段で戻ってから降り直した階は、スコア・来歴・階層到達の報酬を二重に取らない
  const fresh = state.depth + 1 > strata.deepest;
  state.depth += 1;
  strata.revisit = false;
  strata.fresh = fresh;
  // buildFloor が危険な部屋づくりに読み、末尾で消す。降り直した階は報酬を二重に取らない
  state.pendingExit = fresh ? (reward ?? null) : null;
  if (fresh) {
    strata.deepest = state.depth;
    recordProvenance(state, { kind: "floorClear" });
    state.score += Math.round(ROOM.clearBonus * state.depth * tierScoreMul(state));
  }
  buildFloor(state, nextKind);
  // 起点の階ごとの報酬（死神の友の銭）も初めての階だけ
  if (fresh) onOriginDescend(state);
  // 持ち込んだ遺物の地金を今の深度で決め直す（降り直しでも封印・解除を合わせ直す）
  refreshRunStats(state);
  descendMana(state);
  if (fresh) healOnDescend(state);
  onContractsFloorReached(state);
  state.flash = 1;
  const label = FLOOR_KIND_LABEL[state.floorKind];
  pushSfx(state, "descend");
  if (fresh) {
    // 遺物の出口は到着報酬の遺物を確定にして置き換える（二重に落とさない）
    if (!replacesArrivalRelic(reward)) dropDepthReward(state);
    grantFloorArrival(state);
    applyExitArrival(state, reward);
  }
  pushLog(state, `地下${state.depth}階へ降りた（${label}）。`, DEPTH_COLOR);
  if (fresh && state.depth === FLOOR_KIND.invertedDepth) announceInverted(state);
  if (fresh) announceChapterAhead(state);
  if (fresh && deepFloorOf(state.depth) === 1) announceDeep(state);
}

/** 降階の回復（初めて着いた階だけ）。失った生命（maxHp - hp）の HEAL.descendHealRatio を戻す */
function healOnDescend(state: GameState): void {
  const missing = state.player.maxHp - state.player.hp;
  if (missing <= 0) return;
  healPlayer(state, missing * HEAL.descendHealRatio);
}

/** 反転層に初めて着いた */
function announceInverted(state: GameState): void {
  addFloatingText(state, p2(state), "反転層", FLOOR_KIND.invertedColor, 2, 1.6, "notice");
  pushLog(state, "世界が裏返った。反転層では敵が精鋭になりやすく、遺物は反転しやすい。", FLOOR_KIND.invertedColor);
}

/**
 * 上り階段で 1 つ浅い階へ戻る（docs/ideas/run-expansion.md 4 章 #6）。戻った階は作り直され、敵は半分、
 * 死神の猶予は FLOOR_KIND.revisitReaperHeadStart 秒進んだ状態で始まる。祝福の 3 択・階層到達の報酬は出ない
 */
export function ascend(state: GameState): void {
  const strata = state.runEvents.strata;
  if (state.depth <= 1) return;
  strata.returns += 1;
  strata.revisit = true;
  strata.fresh = false;
  state.depth -= 1;
  buildFloor(state);
  // 地金は今いる階の深度に合わせる（浅い階へ戻れば縮む）
  refreshRunStats(state);
  thinRevisitedFloor(state);
  recordProvenance(state, { kind: "returned" });
  onContractsFloorReached(state);
  state.flash = 1;
  const label = FLOOR_KIND_LABEL[state.floorKind];
  addFloatingText(state, p2(state), `地下 ${state.depth} 階へ帰還`, FLOOR_KIND.ascendColor, 2, 1.2, "notice");
  pushSfx(state, "descend");
  pushLog(state, `浅い層へ戻った（地下${state.depth}階・${label}、帰還 ${strata.returns}/${FLOOR_KIND.ascendMaxReturns}）。`, FLOOR_KIND.ascendColor);
}

/** 戻った階: ボス・階の主以外の敵を 1 体おきに除き（乱数を使わない）、死神を早める */
function thinRevisitedFloor(state: GameState): void {
  let keep = false;
  state.enemies = state.enemies.filter((e) => {
    if (enemyDef(e.defKey).boss || state.boss?.enemyId === e.id) return true;
    keep = !keep;
    return keep;
  });
  state.floorTime += FLOOR_KIND.revisitReaperHeadStart;
}

/** 反転層か（HUD・描画が読む） */
export function invertedLayer(state: GameState): boolean {
  return isInvertedDepth(state.depth);
}

// -----------------------------------------------------------------------------
// 特別な部屋・ランイベントが使う湧かせ処理（specialRooms.ts の roomHooks へ差し込む）
// -----------------------------------------------------------------------------

/** 部屋に追加で湧かせる（部屋の敵数の上限は守る） */
function spawnReinforcements(state: GameState, index: number, rolls: number, spawning: boolean): void {
  const room = state.rooms[index];
  if (!room || rolls <= 0) return;
  spawnCapped(state, room, index, spawning, rolls);
  finalizeLinks(state, index);
}

/** 決まった種類を 1 体だけ湧かせる（巣の主・鏡像）。置ける場所が無ければ null */
function spawnEnemyAt(state: GameState, def: EnemyDef, index: number): Enemy | null {
  const room = state.rooms[index];
  if (!room) return null;
  const pos = randomFreePoint(state, room, index, def.radius);
  if (!pos) return null;
  const e = createEnemy(state, def, pos, index, true);
  e.phaseTimer = ROOM.spawnTelegraph;
  onRunEnemySpawned(state, e);
  state.enemies.push(e);
  return e;
}

/**
 * 特別な部屋・ランイベントへ湧かせ処理を差し込む。モジュールの読み込み順（循環 import）に左右されないよう、
 * トップレベルではなく buildFloor の頭で毎回差し込む（同じ関数を入れ直すだけなので何度呼んでもよい）
 */
function installRoomHooks(): void {
  roomHooks.spawnReinforcements = spawnReinforcements;
  roomHooks.spawnEnemyAt = spawnEnemyAt;
  roomHooks.enemyCount = enemyCount;
  roomHooks.dropHeart = dropHeart;
  roomHooks.ascend = ascend;
  roomHooks.surface = clearRun;
}
