import { type Enemy, type GameState, type RoomState, allocId, pushLog, pushSfx } from "../core/state";
import { normalize, sub } from "../core/vec";
import { enemiesForDepth, type EnemyDef } from "../data/enemies";
import { BOSS, ROOM, ROOM_KIND } from "../data/tuning";
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
import { addFloatingText, shake, spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { heartsAllowed } from "./keystones";
import { dropDepthReward, dropRoomReward, updateFloorItems } from "./loot";
import { recordProvenance } from "../loot/provenance";
import { fireTrigger } from "./triggers";
import { circlesOverlap, overlapsTiles, overlapsWall } from "./physics";
import { announceBoss, isBossDepth, setupBossRoom, updateBossIntro } from "./boss";
import { finalizeLinks, rollElite } from "./elites";
import {
  applyBoonFloorRules,
  boonHeartsAllowed,
  extraEliteRoll,
  offerBoons,
  onBoonEnemySpawned,
  onBoonHeartPickup,
  onBoonRoomClear,
  onBoonRoomLock,
  onBossSpawned,
} from "./boons";
import { resetExplored, revealAround } from "./explore";
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
  setupShrine,
  startWave,
  startsEmpty,
  updateShrines,
} from "./roomTypes";

const START_ROOM = 0;
/** 開始部屋の次の部屋（rooms 型では通路で最初に繋がる部屋）は必ず通常の戦闘部屋にする */
const FIRST_FIGHT_ROOM = 1;
const PICKUP_RADIUS = 6;
const LOCK_SHAKE = 3;
const AMBUSH_SHAKE = 6;
const MIN_WAVE_ENEMIES = 1;
const TEXT_LIFT = 10;
const DEPTH_COLOR = "#ffd75f";

/** 新しいフロアを生成してプレイヤーを配置する */
export function buildFloor(state: GameState): void {
  state.floorKind = chooseFloorKind(state.depth, state.rng);
  state.map = generateMap(mapShapeOf(state.floorKind), state.rng, generatorOptions(state.depth));
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
  // 前の階に残したアイテムは失われる
  state.floorItems = [];
  resetExplored(state);

  const start = state.rooms[START_ROOM];
  if (start) {
    start.cleared = true;
    state.player.body.pos = rectCenterPx(start.rect);
  }
  snapCamera(state);

  const bossRoom = bossRoomIndex(state);
  const last = state.rooms.length - 1;
  const reserved = new Set([START_ROOM, FIRST_FIGHT_ROOM, last]);
  assignRoomKinds(state, reserved);
  applyBoonFloorRules(state, reserved);
  state.rooms.forEach((room, i) => {
    if (i === START_ROOM) return;
    if (i === bossRoom) {
      setupBossRoom(state, i);
      onBossSpawned(state);
      return;
    }
    if (room.kind === "shrine") setupShrine(state, room);
    if (startsEmpty(room.kind)) return;
    populateRoom(state, room, i);
  });
  revealAround(state);
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

function generatorOptions(depth: number): GeneratorOptions {
  if (!isBossDepth(depth)) return DEFAULT_GENERATOR_OPTIONS;
  return { ...DEFAULT_GENERATOR_OPTIONS, lastRoomMin: { w: BOSS.roomMinW, h: BOSS.roomMinH } };
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
  return Math.min(ROOM.maxEnemies, ROOM.baseEnemies + Math.floor(state.depth * ROOM.enemiesPerDepth));
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
    if (roomEnemyCount(state, index) >= ROOM.maxEnemies) break;
    spawnGroup(state, room, index, spawning);
  }
}

function pickEnemy(state: GameState): EnemyDef {
  const pool = enemiesForDepth(state.depth);
  const total = pool.reduce((s, d) => s + d.weight, 0);
  let roll = state.rng.next() * total;
  for (const def of pool) {
    roll -= def.weight;
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

/** 部屋のロック/解除、階段、ピックアップ */
export function updateRooms(state: GameState, dt: number): void {
  const p = state.player.body.pos;
  revealAround(state);
  state.rooms.forEach((room, i) => {
    if (room.cleared) return;
    if (!room.locked) {
      if (insideRoom(state, room, p.x, p.y, ROOM.enterMargin)) enterRoom(state, room, i);
      return;
    }
    const alive = state.enemies.some((e) => e.roomIndex === i && e.hp > 0);
    if (alive) return;
    if (hasMoreWaves(room)) {
      startWave(state, room, () => spawnWave(state, room, i));
      return;
    }
    clearRoom(state, room);
  });

  updateShrines(state);
  updateBossIntro(state, dt);
  updatePickups(state, dt);
  updateFloorItems(state, dt);
  checkStairs(state);
}

function enterRoom(state: GameState, room: RoomState, index: number): void {
  if (room.kind === "treasure") {
    openTreasure(state, room);
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

/**
 * ドアタイルをロックで壁扱いにする直前に、ドアタイル上に AABB が掛かっている敵を
 * 部屋の中心方向へ 1 タイルぶんずつ最大 DOOR_PUSH_MAX_TRIES 回押し込む。
 * 押し込めなければ（壁に阻まれる等）その敵をその場で配列から取り除く
 * （以前は hp = 0 にするだけだったため、次フレームの死亡処理まで「壁に埋まった死体」が
 * 1 フレーム残っていた。死亡演出やドロップも通常の撃破経路を通らないので、
 * 静かに取り除く方が実態に合う）
 */
function pushEnemiesOffDoorTiles(state: GameState, room: RoomState, index: number): void {
  if (room.doorTiles.length === 0) return;
  const center = rectCenterPx(room.rect);
  let removed = false;
  for (const e of state.enemies) {
    if (e.roomIndex !== index || e.hp <= 0) continue;
    if (!circleOnDoorTiles(state, room, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    if (!pushEnemyTowardCenter(state, room, e, center)) {
      e.hp = 0;
      removed = true;
    }
  }
  if (removed) state.enemies = state.enemies.filter((e) => e.hp > 0);
}

/** 1 タイルぶんずつ中心方向へ動かす。壁に阻まれたら諦め、ドアタイルから外れたら成功 */
function pushEnemyTowardCenter(state: GameState, room: RoomState, e: Enemy, center: { x: number; y: number }): boolean {
  const dir = normalize(sub(center, e.body.pos));
  for (let i = 0; i < DOOR_PUSH_MAX_TRIES; i++) {
    const nx = e.body.pos.x + dir.x * TILE_SIZE;
    const ny = e.body.pos.y + dir.y * TILE_SIZE;
    if (overlapsWall(state, nx, ny, e.body.radius)) break;
    e.body.pos.x = nx;
    e.body.pos.y = ny;
    if (!circleOnDoorTiles(state, room, nx, ny, e.body.radius)) return true;
  }
  return !circleOnDoorTiles(state, room, e.body.pos.x, e.body.pos.y, e.body.radius);
}

function lockRoom(state: GameState, room: RoomState, index: number): void {
  pushEnemiesOffDoorTiles(state, room, index);
  room.locked = true;
  for (const t of room.doorTiles) state.lockedTiles.add(t);
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.phase === "idle") e.phase = "chase";
  }
  onBoonRoomLock(state, index);
  if (state.boss && state.boss.roomIndex === index) {
    announceBoss(state);
    return;
  }
  if (room.kind === "challenge") {
    startWave(state, room, () => spawnWave(state, room, index));
    applyCurse(state, index);
    return;
  }
  // 増援を telegraph 付きで湧かせる。伏兵部屋は最初は無人で、通常の 2 倍が一気に湧く
  const ambush = room.kind === "ambush";
  const ratio = ambush ? ROOM_KIND.ambushEnemyMul : ROOM.reinforcementRatio;
  const extra = Math.round(enemyCount(state) * ratio);
  spawnCapped(state, room, index, true, extra);
  finalizeLinks(state, index);
  applyCurse(state, index);
  shake(state, ambush ? AMBUSH_SHAKE : LOCK_SHAKE);
  if (ambush) announceAmbush(state);
  else addFloatingText(state, p2(state), "封鎖", "#ff8080", 1.2, 0.8);
  pushSfx(state, "roomLock");
}

/** challenge の 1 波ぶん（telegraph 付き） */
function spawnWave(state: GameState, room: RoomState, index: number): void {
  const count = Math.max(MIN_WAVE_ENEMIES, Math.round(enemyCount(state) * ROOM_KIND.challengeWaveMul));
  for (let i = 0; i < count; i++) spawnGroup(state, room, index, true);
  finalizeLinks(state, index);
}

function clearRoom(state: GameState, room: RoomState): void {
  room.locked = false;
  room.cleared = true;
  for (const t of room.doorTiles) state.lockedTiles.delete(t);
  state.score += ROOM.clearBonus;
  addFloatingText(state, p2(state), "制圧", "#ffd75f", 1.5, 1);
  state.flash = Math.max(state.flash, 0.25);
  pushSfx(state, "roomClear");
  const center = rewardAnchor(state, room);
  dropRoomReward(state, center);
  fireTrigger(state, "onRoomClear", { pos: { ...state.player.body.pos } });
  onBoonRoomClear(state);
  recordProvenance(state, { kind: "roomClear" });
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

/** 部屋の報酬を置く点。中心が階段（最後の部屋・ボス部屋）なら隣の床へずらす */
function rewardAnchor(state: GameState, room: RoomState): { x: number; y: number } {
  const c = rectCenterPx(room.rect);
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
  if (!boonHeartsAllowed(state)) return;
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
  descend(state);
  // 祝福 3 択は階段で降りたときだけ（descend 直呼びのテストや生成処理は止めない）
  offerBoons(state);
}

export function descend(state: GameState): void {
  state.depth += 1;
  recordProvenance(state, { kind: "floorClear" });
  state.score += ROOM.clearBonus * state.depth;
  buildFloor(state);
  state.flash = 1;
  const label = FLOOR_KIND_LABEL[state.floorKind];
  addFloatingText(state, p2(state), `地下 ${state.depth} 階・${label}`, DEPTH_COLOR, 2, 1.2);
  pushSfx(state, "descend");
  dropDepthReward(state);
  pushLog(state, `地下${state.depth}階へ降りた（${label}）。`, DEPTH_COLOR);
}
