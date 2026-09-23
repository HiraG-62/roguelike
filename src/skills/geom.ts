import type { Enemy, GameState } from "../core/state";
import { type Vec, add, angle, length, normalize, scale, sub } from "../core/vec";
import { overlapsWall } from "../system/physics";
import { enemiesInRadius } from "../system/statusEffects";

/** スキルの当たり判定に使う幾何の小道具（扇・線分・壁までの光線） */

const FULL_TURN = Math.PI * 2;
/** 壁を探る刻み（px） */
const WALL_PROBE = 2;

/** 角度差を -π..π に */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= FULL_TURN;
  while (d < -Math.PI) d += FULL_TURN;
  return d;
}

/** 点から線分までの距離 */
export function distToSegment(pt: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return length(sub(pt, a));
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * ab.x + (pt.y - a.y) * ab.y) / len2));
  return length(sub(pt, add(a, scale(ab, t))));
}

/** 線分上で pt に最も近い点の割合（0..1） */
export function segmentT(pt: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return 0;
  return Math.max(0, Math.min(1, ((pt.x - a.x) * ab.x + (pt.y - a.y) * ab.y) / len2));
}

/** 扇（中心・向き・半径・半角）に入る敵。密着している敵は角度を問わない */
export function enemiesInCone(state: GameState, center: Vec, dir: Vec, radius: number, halfAngle: number): Enemy[] {
  const base = angle(dir);
  const bodyR = state.player.body.radius;
  return enemiesInRadius(state, center, radius).filter((e) => {
    const to = sub(e.body.pos, center);
    if (length(to) <= bodyR + e.body.radius) return true;
    return Math.abs(angleDiff(angle(to), base)) <= halfAngle;
  });
}

/** 線分（from → to、太さ halfWidth）に触れる敵 */
export function enemiesOnSegment(state: GameState, from: Vec, to: Vec, halfWidth: number): Enemy[] {
  return state.enemies.filter(
    (e) => e.hp > 0 && e.phase !== "spawning" && distToSegment(e.body.pos, from, to) <= e.body.radius + halfWidth,
  );
}

/** 壁に当たるまでの光線の終点（最大 maxLength） */
export function rayEnd(state: GameState, origin: Vec, dir: Vec, maxLength: number, step = WALL_PROBE): Vec {
  const d = normalize(dir, { x: 1, y: 0 });
  let end = { ...origin };
  for (let t = step; t <= maxLength; t += step) {
    const next = add(origin, scale(d, t));
    if (overlapsWall(state, next.x, next.y, 0)) break;
    end = next;
  }
  return end;
}

/** 照準地点を最大射程と壁の手前で切り詰める */
export function clampAim(state: GameState, from: Vec, target: Vec, maxRange: number): Vec {
  const delta = sub(target, from);
  const dir = normalize(delta, state.player.facing);
  return rayEnd(state, from, dir, Math.min(length(delta), maxRange));
}

/** 照準地点に最も近い敵（pickRadius 以内）。出現中は対象外 */
export function enemyNear(state: GameState, pos: Vec, pickRadius: number): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning") continue;
    const d = length(sub(e.body.pos, pos)) - e.body.radius;
    if (d > pickRadius || d >= bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}
