import { ROAMING_ROOM, type Enemy, type GameState } from "../core/state";
import { type Vec, dist, normalize, sub } from "../core/vec";
import { type EnemyBehavior, type EnemyDef, enemyDef } from "../data/enemies";
import { ROAM } from "../data/tuning";
import { Tile, rectCenterPx, toIndex } from "../map/grid";
import { nextWaypoint } from "../map/pathing";
import { farFromPlayer, moveEnemy } from "./enemies";
import { ROOM_LOCKS } from "./roomTypes";
import { isHalted } from "./statusEffects";

/**
 * 開放型フロアの徘徊（memo/20260924-1.md「優先的」2）。どの塊にも属さない敵（roomIndex = ROAMING_ROOM）を
 * 塊の間をゆっくり歩かせる（気付く距離に入れば enemies.ts が chase にする）。塊の制圧（その塊の敵の全滅）を妨げない。
 * 生成時の配置は陣（system/jinSpawn.ts）が受け持ち、ここは通路タイルの一覧と長蛇（通路を歩く陣）の歩行だけを持つ。
 * 乱数は state.rng だけで、呼び出し順は floor.ts の updateRooms で固定
 */

/** どの塊にも属さない敵の roomIndex（core/state.ts から re-export。import 元が多いのでここは変えない） */
export { ROAMING_ROOM };

/** その場から動かない・隠れている・時間で消える敵は徘徊させない */
const NO_ROAM_BEHAVIORS: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["graveBell", "inert", "mimic", "hollowArmor"]);

/** 徘徊（長蛇）にできる敵か */
export function canRoam(def: EnemyDef): boolean {
  return !def.boss && !def.timid && def.speed > 0 && !NO_ROAM_BEHAVIORS.has(def.behavior);
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

// -----------------------------------------------------------------------------
// 通路タイル（C-1: 部屋と通路の区別を消し、どこでも敵に出会うようにする。長蛇の置き場所）
// -----------------------------------------------------------------------------

/** 各床タイルが部屋の内側かどうかの印。矩形の部屋は外周 1 マスを除いた内側、塊の部屋は room.tiles */
function markRoomInterior(state: GameState): Uint8Array {
  const map = state.map;
  const owned = new Uint8Array(map.tiles.length);
  for (const room of state.rooms) {
    if (room.tiles) {
      for (const t of room.tiles) owned[t] = 1;
      continue;
    }
    const r = room.rect;
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) owned[toIndex(map, x, y)] = 1;
    }
  }
  return owned;
}

/** どの部屋の内側でもない床タイル（通路・扉前後）の index 一覧（昇順） */
export function corridorTileList(state: GameState): number[] {
  const map = state.map;
  const owned = markRoomInterior(state);
  const out: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === Tile.Floor && owned[i] === 0) out.push(i);
  }
  return out;
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

/** 長蛇の後ろは先頭の目的地を写す（列で歩く。乱数を引くのは先頭だけ）。先頭と陣に属さない徘徊は選び直す */
function retarget(state: GameState, e: Enemy): void {
  if (!e.ai) return;
  const headRoam = columnHead(state, e)?.ai?.roam;
  e.ai.roam = headRoam ? { ...headRoam } : (pickRoamTarget(state) ?? { ...e.body.pos });
  e.ai.roamStuck = 0;
}

/**
 * 同じ陣で歩いている徘徊のうち id が最小の者（長蛇の先頭）。自分が先頭・陣に属さないなら undefined。
 * 先頭が倒れる・気付いて離れると次の者が先頭になる
 */
function columnHead(state: GameState, e: Enemy): Enemy | undefined {
  if (e.jinId === undefined) return undefined;
  let head: Enemy | undefined;
  for (const o of state.enemies) {
    if (o.jinId !== e.jinId || o.hp <= 0 || o.phase !== "idle" || o.roomIndex !== ROAMING_ROOM) continue;
    if (!head || o.id < head.id) head = o;
  }
  return head === e ? undefined : head;
}
