import { type Enemy, type FloorKind, type GameState, type RoomState, allocId, pushLog, pushSfx } from "../core/state";
import { pushPlayerEvent } from "../core/events";
import { normalize, sub } from "../core/vec";
import { enemiesForDepth, type EnemyDef } from "../data/enemies";
import { ATTR_GAIN, BOSS, CAVE, ROOM, ROOM_KIND } from "../data/tuning";
import type { CaveShapeOptions } from "../map/cave";
import { DEFAULT_GENERATOR_OPTIONS, type GeneratorOptions, generateMap } from "../map/generator";
import {
  type GameMap,
  type Rect,
  TILE_SIZE,
  Tile,
  getTile,
  inBounds,
  isWalkable,
  rectCenterPx,
  rectContainsPx,
  toIndex,
} from "../map/grid";
import { snapCamera } from "./camera";
import { COLOR_HEAL, healPlayer } from "./combat";
import { addFloatingText, resetFloorEffects, roomClearFx, roomLockFx, shake, spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { heartsAllowed } from "./keystones";
import { dropDepthReward, dropRoomReward, updateFloorItems } from "./loot";
import { recordProvenance } from "../loot/provenance";
import { fireTrigger } from "./triggers";
import { circlesOverlap, overlapsTiles, overlapsWall } from "./physics";
import { announceBoss, isBossDepth, setupBossRoom, updateBossIntro } from "./boss";
import { dropGreedyLootAtPlayer, finalizeLinks, rescueCarried, rollElite, takeGreedyLoot } from "./elites";
import {
  applyBoonFloorRules,
  boonHeartsAllowed,
  extraEliteRoll,
  offerBoons,
  onBoonEnemySpawned,
  onBoonHeartPickup,
  onBoonRoomClear,
  onBoonRoomLock,
  onBoonWaveStart,
  onBossSpawned,
} from "./boons";
import { resetExplored, revealAround } from "./explore";
import { descendMana } from "./mana";
import { grantAttributePoints } from "../ui/attributeAlloc";
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
import { ROAMING_ROOM, assignRoamers, makeRoamer, reinforceDue, roamCap, roamSpawnPoint, roamerCount, updateRoamers } from "./spawner";
import { biomeEnemyWeight, isInvertedDepth, placeBiomeTerrain, placeOssuaryCorpses } from "./biomes";
import {
  assignExtraRoomKinds,
  clearSpecialRoom,
  enterSpecialRoom,
  ensureForkStairs,
  lockSpecialRoom,
  placeAscend,
  planForkStairs,
  roomHooks,
  setupSpecialRoom,
  stairsChoiceAt,
  updateSpecialRooms,
} from "./specialRooms";
import { onFloorStart, onRoomCleared, onRoomLocked, onRunEnemySpawned } from "./runEvents";
import { hasMod, onOriginDescend, refreshRunStats, tierScoreMul } from "./runSetup";
import { gainShards, onContractsFloorReached, onContractsRoomCleared, placeContractor, updateContractors } from "./contractors";
import { CONTRACT, FLOOR_KIND } from "../data/tuning";
import { enemyDef } from "../data/enemies";

const START_ROOM = 0;
/** 開始部屋の次の部屋（rooms 型では通路で最初に繋がる部屋）は必ず通常の戦闘部屋にする */
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
  state.map = generateMap(mapShapeOf(state.floorKind), state.rng, generatorOptions(state.depth, state.floorKind));
  state.rooms = state.map.rooms.map((rect, i) => createRoomState(state.map, rect, state.map.roomTiles?.[i]));
  state.lockedTiles = new Set();
  state.hazards = [];
  state.boss = null;
  state.floorTime = 0;
  state.reaper = null;
  state.enemies = [];
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

  const bossRoom = bossRoomIndex(state);
  const last = state.rooms.length - 1;
  const reserved = new Set([START_ROOM, FIRST_FIGHT_ROOM, last]);
  assignRoomKinds(state, reserved);
  assignExtraRoomKinds(state, reserved);
  applyBoonFloorRules(state, reserved);
  state.rooms.forEach((room, i) => {
    if (i === START_ROOM) return;
    if (i === bossRoom) {
      setupBossRoom(state, i);
      onBossSpawned(state);
      return;
    }
    if (room.kind === "shrine") setupShrine(state, room);
    setupSpecialRoom(state, room);
    if (startsEmpty(room.kind)) return;
    populateRoom(state, room, i);
  });
  revealAround(state);
  // ここから下の乱数は部屋の中身が決まった後に引く（既存の部屋・敵の配置の乱数消費を変えない）
  const ends = new Set([START_ROOM, last]);
  placeBiomeTerrain(state, ends);
  placeOssuaryCorpses(state, ends);
  planForkStairs(state);
  assignRoamers(state, new Set([START_ROOM, bossRoom]));
  clearEmptyOpenRooms(state);
  onFloorStart(state);
  // 契約者と上り階段は最後に置く（それより前の乱数消費を変えない）
  placeContractor(state);
  placeAscend(state);
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

function createRoomState(map: GameMap, rect: Rect, tileList: readonly number[] | undefined): RoomState {
  return {
    rect,
    cleared: false,
    locked: false,
    doorTiles: tileList ? findBlobDoorTiles(map, tileList) : findDoorTiles(map, rect),
    kind: "normal",
    wave: 0,
    used: false,
    tiles: tileList ? new Set(tileList) : undefined,
  };
}

/** バイオームごとの洞窟の形（tuning の CAVE.biome。無い種別は既定のまま） */
const CAVE_BY_KIND: Readonly<Partial<Record<FloorKind, Partial<CaveShapeOptions>>>> = CAVE.biome;

function generatorOptions(depth: number, kind: FloorKind): GeneratorOptions {
  const cave = CAVE_BY_KIND[kind];
  const base = cave ? { ...DEFAULT_GENERATOR_OPTIONS, cave } : DEFAULT_GENERATOR_OPTIONS;
  if (!isBossDepth(depth)) return base;
  return { ...base, lastRoomMin: { w: BOSS.roomMinW, h: BOSS.roomMinH } };
}

/** ボス階なら最後の部屋（階段の部屋）。それ以外は -1 */
function bossRoomIndex(state: GameState): number {
  const last = state.rooms.length - 1;
  if (!isBossDepth(state.depth) || last <= START_ROOM) return -1;
  return last;
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

const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** 塊の部屋の出入口 = 塊に 8 近傍で接する、塊の外の床（斜めのすり抜けも塞ぐ） */
function findBlobDoorTiles(map: GameMap, tiles: readonly number[]): number[] {
  const inRoom = new Set(tiles);
  const doors = new Set<number>();
  for (const i of tiles) {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = toIndex(map, nx, ny);
      if (!inRoom.has(ni)) doors.add(ni);
    }
  }
  return [...doors].sort((a, b) => a - b);
}

export function enemyCount(state: GameState): number {
  return Math.min(maxEnemiesFor(state.depth), ROOM.baseEnemies + Math.floor(state.depth * ROOM.enemiesPerDepth));
}

/** 部屋の敵数の上限。無限の深み（FLOOR_KIND.deepDepth 以降）では上限を外して数でも押す */
export function maxEnemiesFor(depth: number): number {
  return ROOM.maxEnemies + (depth >= FLOOR_KIND.deepDepth ? FLOOR_KIND.deepMaxEnemiesBonus : 0);
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
    onBoonEnemySpawned(state, e);
    onRunEnemySpawned(state, e);
    rollElite(state, e);
    if (extraEliteRoll(state, e)) rollElite(state, e);
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

function pickEnemy(state: GameState): EnemyDef {
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

/** 部屋のロック/解除・開放型の交戦と制圧、徘徊と増援、階段、ピックアップ */
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
  if (reinforceDue(state, dt)) spawnRoamReinforcement(state);
  updateShrines(state);
  updateSpecialRooms(state, dt);
  updateContractors(state, dt);
  ensureForkStairs(state);
  updateBossIntro(state, dt);
  updatePickups(state, dt);
  updateFloorItems(state, dt);
  checkStairs(state);
}

function updateLockedRoom(state: GameState, room: RoomState, index: number): void {
  if (roomAlive(state, index)) return;
  if (hasMoreWaves(room)) {
    startWave(state, room, () => spawnWave(state, room, index));
    onBoonWaveStart(state, room);
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
    else if (!roomLocks(state, index) && roomNoticed(state, index)) engageRoom(state, room, index);
  }
  if (room.cleared || room.locked || !room.engaged) return;
  if (!roomAlive(state, index)) clearRoom(state, room, index);
}

function roomAlive(state: GameState, index: number): boolean {
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0);
}

/** 部屋の敵のどれかがプレイヤーに気付いた（idle から抜けた） */
function roomNoticed(state: GameState, index: number): boolean {
  return state.enemies.some((e) => e.roomIndex === index && e.hp > 0 && e.phase !== "idle");
}

/**
 * 封鎖しない部屋の交戦開始。部屋の敵をまとめて起こし、封鎖と同じフック（祝福・ルール・ランイベント・呪い）を通す
 * （「封鎖時」を条件にする祝福やイベントを、開放型でも部屋ごとに 1 回起こすため）
 */
function engageRoom(state: GameState, room: RoomState, index: number): void {
  room.engaged = true;
  if (!roomAlive(state, index)) return;
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.phase === "idle") e.phase = "chase";
  }
  onBoonRoomLock(state, index);
  pushPlayerEvent(state, "onRoomLock", "room", { tag: room.kind, source: { kind: "room", key: room.kind } });
  onRoomLocked(state, index);
  applyCurse(state, index);
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

function lockRoom(state: GameState, room: RoomState, index: number): void {
  const rescued = pushEnemiesOffDoorTiles(state, room, index);
  room.locked = true;
  for (const t of room.doorTiles) state.lockedTiles.add(t);
  // 扉を閉じた後に置く（閉じる前だと扉タイルの上に落ちて、制圧まで壁の中に埋まる）
  dropGreedyLootAtPlayer(state, rescued);
  roomLockFx(state, index, room.kind === "horde");
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.phase === "idle") e.phase = "chase";
  }
  onBoonRoomLock(state, index);
  pushPlayerEvent(state, "onRoomLock", "room", { tag: room.kind, source: { kind: "room", key: room.kind } });
  onRoomLocked(state, index);
  if (state.boss && state.boss.roomIndex === index) {
    announceBoss(state);
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
  else addFloatingText(state, p2(state), "封鎖", "#ff8080", 1.2, 0.8);
  pushSfx(state, "roomLock");
}

/** challenge / arena / horde の 1 波ぶん（telegraph 付き） */
function spawnWave(state: GameState, room: RoomState, index: number): void {
  const count = Math.max(MIN_WAVE_ENEMIES, Math.round(enemyCount(state) * waveMul(room.kind)));
  for (let i = 0; i < count; i++) spawnGroup(state, room, index, true);
  finalizeLinks(state, index);
}

const HORDE_SHAKE = 6;
const HORDE_TEXT_SCALE = 1.5;
const HORDE_TEXT_LIFE = 1.2;

/** 巣窟の封鎖: 大きく揺らして名前を出す */
function announceHorde(state: GameState): void {
  shake(state, HORDE_SHAKE);
  addFloatingText(state, p2(state), "巣窟！", ROOM_KIND.hordeColor, HORDE_TEXT_SCALE, HORDE_TEXT_LIFE);
  pushLog(state, "巣窟に踏み込んだ。群れが湧き出す。", ROOM_KIND.hordeColor);
  pushSfx(state, "ambush");
}

function clearRoom(state: GameState, room: RoomState, index: number): void {
  room.locked = false;
  room.cleared = true;
  for (const t of room.doorTiles) state.lockedTiles.delete(t);
  state.score += ROOM.clearBonus;
  addFloatingText(state, p2(state), "制圧", "#ffd75f", 1.5, 1);
  state.flash = Math.max(state.flash, 0.25);
  pushSfx(state, "roomClear");
  roomClearFx(state, index);
  const center = clearAnchor(state, room);
  dropRoomReward(state, center);
  fireTrigger(state, "onRoomClear", { pos: { ...state.player.body.pos } });
  pushPlayerEvent(state, "onRoomClear", "room", { tag: room.kind, source: { kind: "room", key: room.kind } });
  onBoonRoomClear(state, room);
  recordProvenance(state, { kind: "roomClear" });
  onContractsRoomCleared(state, room);
  onRoomCleared(state, room, index);
  clearSpecialRoom(state, room, center);
  // 試練: rare 確定 + ハート確定
  if (room.kind === "challenge") {
    dropRareItem(state, center);
    dropHeart(state, center);
    return;
  }
  if (state.rng.chance(ROOM.heartDropChance)) dropHeart(state, center);
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
  const p = state.player.body;
  for (const pk of state.pickups) {
    pk.bobTime += dt;
    // ks_vampire: ハートは触れても消えない
    if (!heartsAllowed(state)) continue;
    if (!circlesOverlap(pk.pos.x, pk.pos.y, pk.radius, p.pos.x, p.pos.y, p.radius)) continue;
    healPlayer(state, ROOM.heartHeal);
    onBoonHeartPickup(state);
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
  descend(state, stairsChoiceAt(state, toIndex(state.map, tx, ty)));
  // 祝福 3 択は階段で降りたときだけ（descend 直呼びのテストや生成処理は止めない）
  if (fresh) offerBoons(state);
}

/** 次の階へ。nextKind は分岐路の階段の行き先（省略時は深度の規則で抽選） */
export function descend(state: GameState, nextKind?: FloorKind): void {
  const strata = state.runEvents.strata;
  // 上り階段で戻ってから降り直した階は、振り分け点・スコア・来歴・階層到達の報酬を二重に取らない
  const fresh = state.depth + 1 > strata.deepest;
  // buildFloor が state.boss を消すので、ボス撃破の判定は先に行う
  if (fresh) grantAttributePoints(state, floorAttributePoints(state));
  state.depth += 1;
  strata.revisit = false;
  strata.fresh = fresh;
  if (fresh) {
    strata.deepest = state.depth;
    recordProvenance(state, { kind: "floorClear" });
    state.score += Math.round(ROOM.clearBonus * state.depth * tierScoreMul(state));
  }
  buildFloor(state, nextKind);
  // 起点の階ごとの報酬（死神の友の振り分け点）も初めての階だけ。降り直しでは stats の封印・解除だけ合わせ直す
  if (fresh) onOriginDescend(state);
  else refreshRunStats(state);
  descendMana(state);
  onContractsFloorReached(state);
  state.flash = 1;
  const label = FLOOR_KIND_LABEL[state.floorKind];
  pushSfx(state, "descend");
  if (fresh) {
    dropDepthReward(state);
    gainShards(state, CONTRACT.shardsPerFloor);
  }
  pushLog(state, `地下${state.depth}階へ降りた（${label}）。`, DEPTH_COLOR);
  if (fresh && state.depth === FLOOR_KIND.invertedDepth) announceInverted(state);
}

/** 反転層に初めて着いた */
function announceInverted(state: GameState): void {
  addFloatingText(state, p2(state), "反転層", FLOOR_KIND.invertedColor, 2, 1.6);
  pushLog(state, "世界が裏返った。反転層では敵が精鋭になりやすく、遺物は反転しやすい。", FLOOR_KIND.invertedColor);
}

/**
 * 上り階段で 1 つ浅い階へ戻る（docs/ideas/run-expansion.md 4 章 #6）。戻った階は作り直され、敵は半分、
 * 死神の猶予は FLOOR_KIND.revisitReaperHeadStart 秒進んだ状態で始まる。祝福の 3 択・振り分け点・階層到達の報酬は出ない
 */
export function ascend(state: GameState): void {
  const strata = state.runEvents.strata;
  if (state.depth <= 1) return;
  strata.returns += 1;
  strata.revisit = true;
  strata.fresh = false;
  state.depth -= 1;
  buildFloor(state);
  thinRevisitedFloor(state);
  onContractsFloorReached(state);
  state.flash = 1;
  const label = FLOOR_KIND_LABEL[state.floorKind];
  addFloatingText(state, p2(state), `地下 ${state.depth} 階へ帰還`, FLOOR_KIND.ascendColor, 2, 1.2);
  pushSfx(state, "descend");
  pushLog(state, `浅い層へ戻った（地下${state.depth}階・${label}、帰還 ${strata.returns}/${FLOOR_KIND.ascendMaxReturns}）。`, FLOOR_KIND.ascendColor);
}

/** 戻った階: ボス以外の敵を 1 体おきに除き（乱数を使わない）、死神を早める */
function thinRevisitedFloor(state: GameState): void {
  let keep = false;
  state.enemies = state.enemies.filter((e) => {
    if (enemyDef(e.defKey).boss) return true;
    keep = !keep;
    return keep;
  });
  state.floorTime += FLOOR_KIND.revisitReaperHeadStart;
}

/** 反転層か（HUD・描画が読む） */
export function invertedLayer(state: GameState): boolean {
  return isInvertedDepth(state.depth);
}

/**
 * 階段で得るステータスの振り分け点（docs/COMBAT_DESIGN.md A-3）。階層到達 +1、この階のボスを倒していれば +2。
 * ボス撃破の瞬間（boss.ts）ではなく降りるときにまとめて渡す（ボス部屋は撃破しないと階段に届かない）
 */
export function floorAttributePoints(state: GameState): number {
  const boss = state.boss?.defeated === true ? ATTR_GAIN.perBoss : 0;
  return ATTR_GAIN.perFloor + boss;
}

// -----------------------------------------------------------------------------
// 特別な部屋・ランイベントが使う湧かせ処理（specialRooms.ts の roomHooks へ差し込む）
// -----------------------------------------------------------------------------

/**
 * 時間経過の増援: 画面外の床に 1 抽選ぶん（群れは複数体）を徘徊として湧かせる。徘徊の上限（roamCap）を超えない。
 * 画面外なので予告（spawning）は付けない
 */
function spawnRoamReinforcement(state: GameState): void {
  const cap = roamCap(state.depth);
  if (roamerCount(state) >= cap) return;
  const def = pickEnemy(state);
  const n = def.swarm ? state.rng.int(def.swarm.min, def.swarm.max) : 1;
  for (let k = 0; k < n && roamerCount(state) < cap; k++) {
    const pos = roamSpawnPoint(state, def.radius);
    if (!pos) return;
    const e = createEnemy(state, def, pos, ROAMING_ROOM, false);
    onBoonEnemySpawned(state, e);
    onRunEnemySpawned(state, e);
    rollElite(state, e);
    if (extraEliteRoll(state, e)) rollElite(state, e);
    state.enemies.push(e);
    makeRoamer(state, e);
  }
}

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
  onBoonEnemySpawned(state, e);
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
}
