import { type GameState, type RoomKind, pushSfx } from "../core/state";
import { type Vec, fromAngle } from "../core/vec";
import { ORIGIN, REAPER, RUN_MOD } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { boonReaperDelay } from "./boonRules";
import { initReaperVariant, reaperBodyVisible, tickReaper } from "./reaperVariants";
import { hasMod } from "./runSetup";
import { isPropRoom } from "./specialRooms";

/**
 * 追跡者: 同じフロアに一定秒いると湧く、無敵で壁をすり抜ける死神。
 * 猶予秒数は REAPER.appearAfter に部屋数（treasure/shrine/台座の部屋を除く）* REAPER.appearPerRoom を足したもの。
 * 洞窟では塊が部屋なので塊の数で数える（開放型でも探索すべき塊の数に比例させる）。
 * 階段を降りる（buildFloor で消える）まで追ってくる
 */

const FULL_CIRCLE = Math.PI * 2;
const WARN_TEXT = "死神が来る";
const SPAWN_PARTICLES = 30;
const TRAIL_INTERVAL = 5;
/** 警告中のパルス音の間隔（tick）。60fps 想定でおよそ 1.5 秒ごと */
const WARN_PULSE_INTERVAL_TICKS = 90;

/** 出現猶予の計算から除外する部屋種別（探索コストが低い部屋。台座だけの部屋も含む） */
const GRACE_EXCLUDED_KINDS = new Set<RoomKind>(["treasure", "shrine"]);

function excludedFromGrace(kind: RoomKind): boolean {
  return GRACE_EXCLUDED_KINDS.has(kind) || isPropRoom(kind);
}

/** このフロアで Reaper が出現するまでの猶予秒（部屋数ボーナス込み。縛り「急かす死神」で縮む） */
export function reaperAppearAfter(state: GameState): number {
  const rooms = state.rooms.filter((r) => !excludedFromGrace(r.kind)).length;
  const base = REAPER.appearAfter + rooms * REAPER.appearPerRoom + boonReaperDelay(state);
  return hasMod(state, "hastyReaper") ? base * RUN_MOD.hastyReaperMul : base;
}

/** 起点「死神の友」: 階に入った直後から出ている（足は遅い） */
function reaperFromStart(state: GameState): boolean {
  return state.origin === "reaperFriend";
}

function reaperSpeed(state: GameState): number {
  return reaperFromStart(state) ? REAPER.speed * ORIGIN.reaperFriendSpeedMul : REAPER.speed;
}

/** Reaper 出現までの残り秒（出現済みなら 0） */
export function reaperTimeLeft(state: GameState): number {
  return Math.max(0, reaperAppearAfter(state) - state.floorTime);
}

/** HUD に残り時間を出すべきか（出現の REAPER.warnMargin 秒前から） */
export function reaperWarning(state: GameState): boolean {
  return state.reaper === null && reaperTimeLeft(state) <= REAPER.warnMargin;
}

export function updateReaper(state: GameState, dt: number): void {
  if (state.status !== "playing") return;
  state.floorTime += dt;
  if (!state.reaper) {
    if (reaperWarning(state) && state.tick % WARN_PULSE_INTERVAL_TICKS === 0) pushSfx(state, "reaperWarnPulse");
    if (reaperFromStart(state) || state.floorTime >= reaperAppearAfter(state)) spawnReaper(state);
    return;
  }
  const r = state.reaper;
  r.animTime += dt;
  // 動きと接触はバリアントごと（src/system/reaperVariants.ts。既定の死神は直進して触れると痛い）
  tickReaper(state, r, reaperSpeed(state), dt);
  if (reaperBodyVisible(r) && state.tick % TRAIL_INTERVAL === 0) spawnBurst(state, r.pos, REAPER.color, 1, 20, 0.6, 2);
}

/** 死神を呼ぶ（時間切れ・死神の巣の箱・死神の友） */
export function spawnReaper(state: GameState): void {
  const pos = spawnPoint(state);
  const reaper = { pos, radius: REAPER.radius, animTime: 0 };
  state.reaper = reaper;
  // バリアント（鎖・取り立て屋・双子・影・静か）を決め、種類をログで告げる
  initReaperVariant(state, reaper);
  spawnBurst(state, pos, REAPER.color, SPAWN_PARTICLES, 120, 0.8, 2.5);
  addFloatingText(state, { x: state.player.body.pos.x, y: state.player.body.pos.y - 20 }, WARN_TEXT, REAPER.color, 1.5, 2);
  shake(state, 4);
  pushSfx(state, "enemyWindup");
  pushSfx(state, "reaperAppear");
}

/** プレイヤーから一定距離の点（マップ内に収める） */
function spawnPoint(state: GameState): Vec {
  const p = state.player.body.pos;
  const dir = fromAngle(state.rng.next() * FULL_CIRCLE);
  const maxX = state.map.width * TILE_SIZE - REAPER.radius;
  const maxY = state.map.height * TILE_SIZE - REAPER.radius;
  return {
    x: Math.max(REAPER.radius, Math.min(maxX, p.x + dir.x * REAPER.spawnDist)),
    y: Math.max(REAPER.radius, Math.min(maxY, p.y + dir.y * REAPER.spawnDist)),
  };
}
