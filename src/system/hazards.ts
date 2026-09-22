import { type GameState, type Hazard, type HazardKind, allocId, pushSfx } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { BOSS, ENEMY_AI, STATUS } from "../data/tuning";
import { TILE_SIZE, toIndex } from "../map/grid";
import { damagePlayer } from "./combat";
import { shake, spawnBurst, spawnRing } from "./effects";
import { overlapsWall } from "./physics";

/**
 * 敵が地面に残す攻撃: 爆弾 / レーザー / 衝撃波リング / ボスの着地予告 / 骨の壁。
 * 判定はすべてプレイヤーに対してだけ行う（敵同士は巻き込まない）
 */

const EXPLODE_PARTICLES = 20;
const EXPLODE_SPEED = 170;
const EXPLODE_SHAKE = 4;
const LASER_PARTICLE_INTERVAL = 3;
const BURN_PARTICLE_INTERVAL = 4;
const BURN_PARTICLE_SPEED = 30;

interface HazardSpec {
  kind: HazardKind;
  pos: Vec;
  to?: Vec;
  radius: number;
  time: number;
  damage: number;
  tile?: number;
  sourceId?: number;
}

function addHazard(state: GameState, spec: HazardSpec): Hazard {
  const h: Hazard = {
    id: allocId(state),
    kind: spec.kind,
    pos: { ...spec.pos },
    to: { ...(spec.to ?? spec.pos) },
    radius: spec.radius,
    time: spec.time,
    maxTime: spec.time,
    damage: spec.damage,
    spent: false,
    tile: spec.tile ?? -1,
    sourceId: spec.sourceId,
  };
  state.hazards.push(h);
  return h;
}

export function spawnBomb(
  state: GameState,
  pos: Vec,
  damage: number,
  sourceId?: number,
  fuse: number = ENEMY_AI.bomber.fuse,
  radius: number = ENEMY_AI.bomber.radius,
): Hazard {
  return addHazard(state, { kind: "bomb", pos, radius, time: fuse, damage, sourceId });
}

export function spawnLaser(state: GameState, from: Vec, to: Vec, time: number, damage: number, sourceId?: number): Hazard {
  return addHazard(state, { kind: "laser", pos: from, to, radius: ENEMY_AI.laser.width / 2, time, damage, sourceId });
}

/** 広がる衝撃波。縁だけに判定があるのでダッシュで抜けられる */
export function spawnShockwave(state: GameState, pos: Vec, radius: number, damage: number, sourceId?: number): Hazard {
  return addHazard(state, { kind: "shockwave", pos, radius, time: ENEMY_AI.golem.ringTime, damage, sourceId });
}

/** ボスの着地予告（見た目だけ。縮む影） */
export function spawnLanding(state: GameState, pos: Vec, radius: number, time: number): Hazard {
  return addHazard(state, { kind: "landing", pos, radius, time, damage: 0 });
}

/** 一時的な壁タイル。lockedTiles を流用し、時間切れで消える */
export function spawnBoneWall(state: GameState, tx: number, ty: number): Hazard | null {
  const tile = toIndex(state.map, tx, ty);
  if (state.lockedTiles.has(tile)) return null;
  const pos = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
  // プレイヤーや敵を閉じ込めないよう、誰かが重なっているマスには出さない
  const half = TILE_SIZE / 2;
  const bodies = [state.player.body, ...state.enemies.map((e) => e.body)];
  for (const b of bodies) {
    if (Math.abs(b.pos.x - pos.x) < half + b.radius && Math.abs(b.pos.y - pos.y) < half + b.radius) return null;
  }
  state.lockedTiles.add(tile);
  return addHazard(state, { kind: "boneWall", pos, radius: half, time: BOSS.boneLord.wallDuration, damage: 0, tile });
}

/** プレイヤーが炎をまとう演出（wisp） */
export function spawnPlayerBurn(state: GameState): void {
  const existing = state.hazards.find((h) => h.kind === "playerBurn");
  if (existing) {
    existing.time = existing.maxTime;
    return;
  }
  addHazard(state, { kind: "playerBurn", pos: state.player.body.pos, radius: 0, time: ENEMY_AI.wisp.burnDuration, damage: 0 });
}

/** プレイヤーだけを巻き込む爆発 */
export function explodeHostile(state: GameState, pos: Vec, radius: number, damage: number, color: string): void {
  spawnRing(state, pos, radius, color, STATUS.fxLife);
  spawnBurst(state, pos, color, EXPLODE_PARTICLES, EXPLODE_SPEED, 0.4, 2.5);
  shake(state, EXPLODE_SHAKE);
  pushSfx(state, "explode");
  const p = state.player.body;
  if (dist(p.pos, pos) < radius + p.radius) damagePlayer(state, damage, pos);
}

/** 線分 a-b（太さ halfWidth*2）と円の当たり判定 */
export function segmentCircleHit(a: Vec, b: Vec, halfWidth: number, c: Vec, r: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.y - a.y) * aby) / len2));
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  const dx = c.x - px;
  const dy = c.y - py;
  const rr = halfWidth + r;
  return dx * dx + dy * dy < rr * rr;
}

/** 衝撃波の現在の半径 */
export function shockwaveRadius(h: Hazard): number {
  const t = h.maxTime > 0 ? 1 - h.time / h.maxTime : 1;
  return h.radius * Math.min(1, Math.max(0, t));
}

/** 壁に当たるまでレーザーを伸ばした終点 */
export function laserEnd(state: GameState, from: Vec, dir: Vec, maxLen: number): Vec {
  const stepLen = TILE_SIZE / 4;
  let end = { ...from };
  for (let d = stepLen; d <= maxLen; d += stepLen) {
    const q = { x: from.x + dir.x * d, y: from.y + dir.y * d };
    if (overlapsWall(state, q.x, q.y, 1)) break;
    end = q;
  }
  return end;
}

export function updateHazards(state: GameState, dt: number): void {
  for (const h of state.hazards) {
    h.time -= dt;
    switch (h.kind) {
      case "bomb":
        if (h.time <= 0) explodeHostile(state, h.pos, h.radius, h.damage, ENEMY_AI.bomber.color);
        break;
      case "laser":
        tickLaser(state, h);
        break;
      case "shockwave":
        tickShockwave(state, h);
        break;
      case "boneWall":
        if (h.time <= 0) removeBoneWall(state, h);
        break;
      case "playerBurn":
        h.pos = { ...state.player.body.pos };
        if (state.tick % BURN_PARTICLE_INTERVAL === 0) {
          spawnBurst(state, h.pos, STATUS.burnColor, 1, BURN_PARTICLE_SPEED, 0.35, 1.5);
        }
        break;
      case "landing":
        break;
    }
  }
  state.hazards = state.hazards.filter((h) => h.time > 0);
}

function tickLaser(state: GameState, h: Hazard): void {
  if (state.tick % LASER_PARTICLE_INTERVAL === 0) spawnBurst(state, h.to, ENEMY_AI.laser.color, 2, 60, 0.2, 1.5);
  const p = state.player.body;
  if (!segmentCircleHit(h.pos, h.to, h.radius, p.pos, p.radius)) return;
  // 被弾後無敵があるので照射中に何度も当たることはない
  damagePlayer(state, h.damage, h.pos);
}

function tickShockwave(state: GameState, h: Hazard): void {
  if (h.spent) return;
  const r = shockwaveRadius(h);
  const p = state.player.body;
  const d = dist(p.pos, h.pos);
  const half = ENEMY_AI.golem.ringThickness / 2;
  if (Math.abs(d - r) > half + p.radius) return;
  const result = damagePlayer(state, h.damage, h.pos);
  if (result !== "ignored") h.spent = true;
}

function removeBoneWall(state: GameState, h: Hazard): void {
  state.lockedTiles.delete(h.tile);
  spawnBurst(state, h.pos, BOSS.boneLord.color, 6, 60, 0.3, 1.5);
}

/** フロア移動時など: 骨の壁を即座に消す */
export function clearHazards(state: GameState): void {
  for (const h of state.hazards) if (h.kind === "boneWall") state.lockedTiles.delete(h.tile);
  state.hazards = [];
}
