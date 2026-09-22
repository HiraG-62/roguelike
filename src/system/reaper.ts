import { type GameState, type RoomKind, pushLog, pushSfx } from "../core/state";
import { type Vec, fromAngle, length, normalize, sub } from "../core/vec";
import { REAPER } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { circlesOverlap } from "./physics";

/**
 * 追跡者: 同じフロアに一定秒いると湧く、無敵で壁をすり抜ける死神。
 * 猶予秒数は REAPER.appearAfter に部屋数（treasure/shrine を除く）* REAPER.appearPerRoom を足したもの。
 * 階段を降りる（buildFloor で消える）まで追ってくる
 */

const FULL_CIRCLE = Math.PI * 2;
const WARN_TEXT = "THE REAPER COMES";
const SPAWN_PARTICLES = 30;
const TRAIL_INTERVAL = 5;
/** 警告中のパルス音の間隔（tick）。60fps 想定でおよそ 1.5 秒ごと */
const WARN_PULSE_INTERVAL_TICKS = 90;

/** 出現猶予の計算から除外する部屋種別（探索コストが低い部屋） */
const GRACE_EXCLUDED_KINDS = new Set<RoomKind>(["treasure", "shrine"]);

/** このフロアで Reaper が出現するまでの猶予秒（部屋数ボーナス込み） */
export function reaperAppearAfter(state: GameState): number {
  const rooms = state.rooms.filter((r) => !GRACE_EXCLUDED_KINDS.has(r.kind)).length;
  return REAPER.appearAfter + rooms * REAPER.appearPerRoom;
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
    if (state.floorTime >= reaperAppearAfter(state)) spawnReaper(state);
    return;
  }
  const r = state.reaper;
  r.animTime += dt;
  const p = state.player.body;
  const to = sub(p.pos, r.pos);
  if (length(to) > 0) {
    const dir = normalize(to);
    r.pos.x += dir.x * REAPER.speed * dt;
    r.pos.y += dir.y * REAPER.speed * dt;
  }
  if (state.tick % TRAIL_INTERVAL === 0) spawnBurst(state, r.pos, REAPER.color, 1, 20, 0.6, 2);
  if (circlesOverlap(r.pos.x, r.pos.y, r.radius, p.pos.x, p.pos.y, p.radius)) {
    // Reaper は無敵で常に接触するため、JUST 回避（スロー + ゲージ）を成立させない。無敵中は単に無視
    damagePlayer(state, REAPER.damage, r.pos, undefined, { noJust: true });
  }
}

function spawnReaper(state: GameState): void {
  const pos = spawnPoint(state);
  state.reaper = { pos, radius: REAPER.radius, animTime: 0 };
  spawnBurst(state, pos, REAPER.color, SPAWN_PARTICLES, 120, 0.8, 2.5);
  addFloatingText(state, { x: state.player.body.pos.x, y: state.player.body.pos.y - 20 }, WARN_TEXT, REAPER.color, 1.5, 2);
  pushLog(state, "You lingered too long. The Reaper comes.", REAPER.color);
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
