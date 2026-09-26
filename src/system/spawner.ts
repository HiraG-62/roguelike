import type { Enemy, GameState } from "../core/state";
import { type Vec, dist, normalize, sub } from "../core/vec";
import { type EnemyBehavior, type EnemyDef, enemyDef } from "../data/enemies";
import { MAP_SIZE, ROAM } from "../data/tuning";
import { VIEW_H, VIEW_W } from "../core/view";
import { TILE_SIZE, Tile, rectCenterPx, toIndex } from "../map/grid";
import { nextWaypoint } from "../map/pathing";
import { farFromPlayer, moveEnemy } from "./enemies";
import { spawnSpot } from "./enemyTraits";
import { overlapsWall } from "./physics";
import { ROOM_LOCKS } from "./roomTypes";
import { isHalted } from "./statusEffects";

/**
 * 開放型フロアの徘徊と増援（memo/20260924-1.md「優先的」2）。
 * 塊に置いた敵の一部を「徘徊」にし、塊の間をゆっくり歩かせる（気付く距離に入れば enemies.ts が chase にする）。
 * 時間経過で画面外に少しずつ増援が湧く（上限あり）。徘徊はどの塊にも属さない（roomIndex = ROAMING_ROOM）ので、
 * 塊の制圧（その塊の敵の全滅）を妨げない。乱数は state.rng だけで、呼び出し順は floor.ts の updateRooms で固定
 */

/** どの塊にも属さない敵の roomIndex */
export const ROAMING_ROOM = -1;

/** その場から動かない・隠れている・時間で消える敵は徘徊させない */
const NO_ROAM_BEHAVIORS: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["graveBell", "inert", "mimic", "hollowArmor"]);

function canRoam(def: EnemyDef): boolean {
  return !def.boss && !def.timid && !NO_ROAM_BEHAVIORS.has(def.behavior);
}

/** 深度と階の広さで決まる徘徊の上限（広い階は 面積の倍率 ^ MAP_SIZE.roamCapExp 倍。密度が薄くなりすぎないように） */
export function roamCap(depth: number, areaMul = 1): number {
  const base = Math.min(ROAM.capMax, ROAM.capBase + Math.floor(depth * ROAM.capPerDepth));
  return Math.round(base * areaMul ** MAP_SIZE.roamCapExp);
}

export function roamerCount(state: GameState): number {
  return state.enemies.filter((e) => e.roomIndex === ROAMING_ROOM && e.hp > 0).length;
}

// -----------------------------------------------------------------------------
// 目的地
// -----------------------------------------------------------------------------

/** 開始の塊（floor.ts の START_ROOM）。プレイヤーが降り立つ所なので徘徊の行き先にしない（開始直後に歩いてこないように） */
const START_ROOM = 0;

/** 徘徊の行き先にできる塊（封鎖しない種類。開始の塊・ボス部屋は除く） */
function roamableRooms(state: GameState): number[] {
  return state.rooms.map((_, i) => i).filter((i) => {
    const room = state.rooms[i];
    return room !== undefined && i !== START_ROOM && !ROOM_LOCKS[room.kind] && state.boss?.roomIndex !== i;
  });
}

/** 塊の中心を 1 つ選ぶ。行き先が無ければ null */
export function pickRoamTarget(state: GameState): Vec | null {
  const rooms = roamableRooms(state);
  if (rooms.length === 0) return null;
  const room = state.rooms[rooms[state.rng.int(0, rooms.length - 1)] ?? -1];
  return room ? rectCenterPx(room.rect) : null;
}

/** 敵を徘徊にする（塊から外し、目的地を決める） */
export function makeRoamer(state: GameState, e: Enemy): void {
  e.roomIndex = ROAMING_ROOM;
  if (!e.ai) return;
  e.ai.roam = pickRoamTarget(state) ?? { ...e.body.pos };
  e.ai.roamStuck = 0;
}

/**
 * フロア生成時: 塊に置いた敵の一部を徘徊にする。skip の塊（開始・ボス）と封鎖する種類の塊は対象外。
 * 塊を空にすると入っただけで制圧になるので、各塊に 1 体は残す
 */
export function assignRoamers(state: GameState, skip: ReadonlySet<number>): void {
  const left = new Map<number, number>();
  for (const e of state.enemies) left.set(e.roomIndex, (left.get(e.roomIndex) ?? 0) + 1);
  for (const e of state.enemies) {
    const room = state.rooms[e.roomIndex];
    if (!room || skip.has(e.roomIndex) || ROOM_LOCKS[room.kind]) continue;
    if (!canRoam(enemyDef(e.defKey))) continue;
    if (!state.rng.chance(ROAM.fraction)) continue;
    const count = left.get(e.roomIndex) ?? 0;
    if (count <= 1) continue;
    left.set(e.roomIndex, count - 1);
    makeRoamer(state, e);
  }
}

// -----------------------------------------------------------------------------
// 歩かせる（塊の中心への距離場を下る。map/pathing.ts）
// -----------------------------------------------------------------------------

/** 1 ステップで期待する移動量のこの割合より進めていなければ詰まりとみなす */
const STUCK_PROGRESS_RATIO = 0.3;

/**
 * 毎ステップ: idle の徘徊を目的地へ歩かせる。気付いて chase になった敵は enemies.ts に任せる。
 * プレイヤーから遠い（enemies.ts の眠りの距離）徘徊は ROAM.sleepRoamEvery ステップに 1 回、その分の dt でまとめて歩かせる
 * （止めると遠くの徘徊が寄ってこなくなる。間引く番は tick と id で決まるので決定的）
 */
export function updateRoamers(state: GameState, dt: number): void {
  const every = Math.max(1, ROAM.sleepRoamEvery);
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase !== "idle" || !e.ai?.roam || isHalted(e)) continue;
    if (!farFromPlayer(state, e)) {
      stepRoamer(state, e, dt);
      continue;
    }
    if ((state.tick + e.id) % every !== 0) continue;
    stepRoamer(state, e, dt * every);
  }
}

function stepRoamer(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  const goal = ai?.roam;
  if (!ai || !goal) return;
  const next = dist(e.body.pos, goal) <= ROAM.reach ? null : nextWaypoint(state.map, e.body.pos, goal);
  if (!next) {
    retarget(state, e);
    return;
  }
  const def = enemyDef(e.defKey);
  const dir = normalize(sub(next, e.body.pos));
  const speed = def.speed * ROAM.speedMul;
  const before = { ...e.body.pos };
  moveEnemy(state, e, def, dir.x * speed * dt, dir.y * speed * dt);
  if (dir.x !== 0) e.facing = dir;
  const moved = dist(before, e.body.pos);
  ai.roamStuck = moved < speed * dt * STUCK_PROGRESS_RATIO ? (ai.roamStuck ?? 0) + dt : 0;
  if (ai.roamStuck >= ROAM.stuckTime) retarget(state, e);
}

function retarget(state: GameState, e: Enemy): void {
  if (!e.ai) return;
  e.ai.roam = pickRoamTarget(state) ?? { ...e.body.pos };
  e.ai.roamStuck = 0;
}

// -----------------------------------------------------------------------------
// 増援
// -----------------------------------------------------------------------------

/**
 * この step で増援を出す時刻をまたぐか。floorTime（updateReaper が進める）の reinforceDelay 秒後から
 * reinforceInterval 秒ごと。5 の倍数の階（major）と、階の主の部屋を封鎖している間は出さない
 * （部屋の戦いに徘徊が混ざらないように）。bossRoomLocked は system/floorLord.ts と同じ式だが、
 * spawner.ts → floorLord.ts → elites.ts → spawner.ts の循環 import を避けてここへ直に書く
 */
export function reinforceDue(state: GameState, dt: number): boolean {
  const b = state.boss;
  if (b?.major || (b !== null && state.rooms[b.roomIndex]?.locked === true)) return false;
  const t0 = state.floorTime - ROAM.reinforceDelay;
  const t1 = t0 + dt;
  if (t1 < 0) return false;
  return Math.floor(t1 / ROAM.reinforceInterval) !== Math.floor(t0 / ROAM.reinforceInterval);
}

/** 封鎖する種類の塊・封鎖中の塊のタイルか（増援をそこへ湧かせると閉じ込められる） */
function inLockingRoom(state: GameState, tx: number, ty: number): boolean {
  const index = toIndex(state.map, tx, ty);
  return state.rooms.some((room, i) => {
    if (!room.locked && !ROOM_LOCKS[room.kind] && state.boss?.roomIndex !== i) return false;
    if (room.tiles) return room.tiles.has(index);
    const r = room.rect;
    return tx >= r.x - 1 && ty >= r.y - 1 && tx <= r.x + r.w && ty <= r.y + r.h;
  });
}

/**
 * カメラの表示範囲（+ offscreenMargin）の内側か。カメラはマップ端で止まり、プレイヤーが画面の中心から外れるので、
 * プレイヤーからの距離だけでは画面の角に湧いてしまう。camera.pos は step が決定的に動かす（揺れの offset は見ない）
 */
function onScreen(state: GameState, pos: Vec): boolean {
  const c = state.camera.pos;
  return Math.abs(pos.x - c.x) < VIEW_W / 2 + ROAM.offscreenMargin && Math.abs(pos.y - c.y) < VIEW_H / 2 + ROAM.offscreenMargin;
}

/**
 * 増援の位置。プレイヤーから minSpawnDist 以上離れ、画面の外の床から選び、壁は spawnSpot で避ける。
 * 見つからなければ null
 */
export function roamSpawnPoint(state: GameState, radius: number): Vec | null {
  const map = state.map;
  const p = state.player.body.pos;
  for (let n = 0; n < ROAM.spawnAttempts; n++) {
    const i = state.rng.int(0, map.tiles.length - 1);
    if (map.tiles[i] !== Tile.Floor || state.lockedTiles.has(i)) continue;
    const tx = i % map.width;
    const ty = Math.floor(i / map.width);
    if (inLockingRoom(state, tx, ty)) continue;
    const want = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
    const pos = spawnSpot(state, want, want, radius);
    if (overlapsWall(state, pos.x, pos.y, radius) || dist(pos, p) < ROAM.minSpawnDist || onScreen(state, pos)) continue;
    return pos;
  }
  return null;
}
