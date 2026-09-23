import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { generateItem } from "../loot/generator";
import type { Rarity } from "../loot/types";
import { type Rect, TILE_SIZE, Tile, rectCenter, rectCenterPx, setTile } from "../map/grid";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst, spawnRing } from "./effects";
import { createEnemy, moveEnemy } from "./enemies";
import { spawnBoneWall, spawnLanding, spawnShockwave } from "./hazards";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer, isSilenced } from "./statusEffects";

/** 階層ボス。depth が BOSS.interval の倍数の階は、階段のある最後の部屋がボス部屋になる */

const BOSS_ROTATION = ["kingSlime", "boneLord"] as const;
const FULL_CIRCLE = Math.PI * 2;
const RARE_OR_BETTER: ReadonlySet<Rarity> = new Set<Rarity>(["rare", "unique"]);
const BOSS_TEXT_COLOR = "#ff4040";
const DEFEAT_TEXT_COLOR = "#ffd75f";
const SPLIT_TEXT_COLOR = "#80ff80";
const RAGE_TEXT_COLOR = "#c0ffb0";
const PHASE_FLASH = 0.6;
const FREE_POINT_ATTEMPTS = 30;
const DROP_SPREAD = 14;
/** King Slime の着地直下でのダメージ判定半径（衝撃波の半径に対する割合） */
const SLAM_CORE_RATIO = 0.4;
const SPLIT_OFFSET = 18;
/** Bone Lord が保ちたい距離 */
const BONE_LORD_KEEP = 90;
const BONE_BULLET_RADIUS = 3;
const BONE_BULLET_LIFE = 4;
/** 骨の壁の出る位置（プレイヤーとの間の割合） */
const WALL_POS_RATIO = 0.5;
/** 技の順番: 0 = 回転弾幕のみ, 1 = 骨の壁 + 弾幕 */
const BONE_MOVE_WALLS = 1;
const BONE_MOVE_COUNT = 2;
const STAGE_ONE = 1;
const STAGE_TWO = 2;

export function isBossDepth(depth: number): boolean {
  return depth > 0 && depth % BOSS.interval === 0;
}

export function bossKeyForDepth(depth: number): string {
  const idx = Math.max(0, Math.floor(depth / BOSS.interval) - 1) % BOSS_ROTATION.length;
  return BOSS_ROTATION[idx] ?? BOSS_ROTATION[0];
}

/** 最後の部屋をボス部屋にする: 階段を隠してボスを置く */
export function setupBossRoom(state: GameState, roomIndex: number): void {
  const room = state.rooms[roomIndex];
  if (!room) return;
  const c = rectCenter(room.rect);
  setTile(state.map, c.x, c.y, Tile.Floor);
  const def = enemyDef(bossKeyForDepth(state.depth));
  const boss = createEnemy(state, def, rectCenterPx(room.rect), roomIndex, false);
  state.enemies.push(boss);
  state.boss = { enemyId: boss.id, name: def.name, roomIndex, introTimer: 0, defeated: false };
}

/** ボス部屋のロック時の演出 */
export function announceBoss(state: GameState): void {
  const b = state.boss;
  if (!b) return;
  b.introTimer = BOSS.introTime;
  shake(state, FEEL.shakeHeavy);
  state.flash = Math.max(state.flash, PHASE_FLASH);
  pushSfx(state, "roomLock");
  pushSfx(state, "enemyWindup");
  pushSfx(state, "bossAppear");
  pushLog(state, `${b.name}が現れた！`, BOSS_TEXT_COLOR);
}

export function bossEnemy(state: GameState): Enemy | undefined {
  const b = state.boss;
  if (!b) return undefined;
  return state.enemies.find((e) => e.id === b.enemyId && e.hp > 0);
}

export function updateBossIntro(state: GameState, dt: number): void {
  if (state.boss) state.boss.introTimer = Math.max(0, state.boss.introTimer - dt);
}

/** enemies.ts から毎ステップ呼ばれる */
export function updateBossEnemy(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  switch (e.phase) {
    case "spawning":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) e.phase = "chase";
      return;
    case "idle":
      if (state.rooms[e.roomIndex]?.locked) e.phase = "chase";
      return;
    default:
      break;
  }
  if (def.behavior === "kingSlime") updateKingSlime(state, e, def, dt);
  else updateBoneLord(state, e, def, dt);
}

function toChase(e: Enemy, def: EnemyDef): void {
  e.phase = "chase";
  e.attackCooldown = def.attackInterval;
}

function toPlayerDir(state: GameState, e: Enemy): Vec {
  return normalize(sub(state.player.body.pos, e.body.pos));
}

/** フェーズ移行: 敵弾を消し、光と揺れで知らせる */
function phaseShift(state: GameState, e: Enemy, text: string, color: string): void {
  if (!e.ai) return;
  e.ai.stage = STAGE_TWO;
  state.projectiles = state.projectiles.filter((p) => p.owner !== "enemy");
  state.flash = Math.max(state.flash, PHASE_FLASH);
  shake(state, FEEL.shakeSpecial);
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 16 }, text, color, 1.6, 1.2);
  spawnBurst(state, e.body.pos, color, 30, 180, 0.6, 2.5);
  pushSfx(state, "enemyWindup");
  pushSfx(state, "bossPhaseChange");
}

// -----------------------------------------------------------------------------
// King Slime: 跳躍 → 着地衝撃波。HP 50% で分裂 + 高速化
// -----------------------------------------------------------------------------

function kingSlimeSpeedMul(e: Enemy): number {
  return e.ai?.stage === STAGE_TWO ? BOSS.kingSlime.phase2SpeedMul : 1;
}

function updateKingSlime(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * ks.phase2Ratio) splitKingSlime(state, e);

  const mul = kingSlimeSpeedMul(e);
  const dir = toPlayerDir(state, e);
  switch (e.phase) {
    case "chase": {
      if (dir.x !== 0) e.facing = dir;
      moveEnemy(state, e, def, dir.x * def.speed * mul * dt, dir.y * def.speed * mul * dt);
      if (e.attackCooldown > 0) return;
      e.phase = "windup";
      e.phaseTimer = def.windup / mul;
      pushSfx(state, "enemyWindup");
      return;
    }
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) beginJump(state, e);
      return;
    case "strike": {
      // 空中: 着地点へ向かって移動する（壁は無視しない）
      const remaining = Math.max(dt, e.phaseTimer);
      const step = scale(sub(ai.target, e.body.pos), Math.min(1, dt / remaining));
      moveEnemy(state, e, def, step.x, step.y);
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) landKingSlime(state, e, def);
      return;
    }
    case "recover":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) toChase(e, def);
      return;
    default:
      return;
  }
}

function beginJump(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  const time = ai.stage === STAGE_TWO ? ks.phase2JumpTime : ks.jumpTime;
  ai.target = { ...state.player.body.pos };
  e.phase = "strike";
  e.phaseTimer = time;
  spawnLanding(state, ai.target, ks.shockRadius, time);
  spawnBurst(state, e.body.pos, enemyDef(e.defKey).color, 10, 90, 0.3, 2);
}

function landKingSlime(state: GameState, e: Enemy, def: EnemyDef): void {
  const ks = BOSS.kingSlime;
  const dmg = ks.shockDamage + depthDamageBonus(state.depth);
  spawnShockwave(state, e.body.pos, ks.shockRadius, dmg, e.id);
  spawnBurst(state, e.body.pos, def.color, 24, 160, 0.5, 3);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "wallHit");
  // 真下にいたら潰される
  const p = state.player.body;
  if (circlesOverlap(e.body.pos.x, e.body.pos.y, ks.shockRadius * SLAM_CORE_RATIO, p.pos.x, p.pos.y, p.radius)) {
    if (damagePlayer(state, dmg, e.body.pos, e) === "hit") inflictOnPlayer(state, e, "shockwave");
  }
  e.phase = "recover";
  e.phaseTimer = def.recover / kingSlimeSpeedMul(e);
}

function splitKingSlime(state: GameState, e: Enemy): void {
  phaseShift(state, e, "分裂！", SPLIT_TEXT_COLOR);
  const ks = BOSS.kingSlime;
  const slime = enemyDef("slime");
  for (let i = 0; i < ks.splitCount; i++) {
    const a = (i / ks.splitCount) * FULL_CIRCLE;
    const pos = add(e.body.pos, scale(fromAngle(a), SPLIT_OFFSET));
    const safe = overlapsWall(state, pos.x, pos.y, slime.radius) ? { ...e.body.pos } : pos;
    const minion = createEnemy(state, slime, safe, e.roomIndex, true);
    state.enemies.push(minion);
  }
}

// -----------------------------------------------------------------------------
// Bone Lord: 回転弾幕 / 骨の壁 / HP 30% 以下でテレポート連発
// -----------------------------------------------------------------------------

function updateBoneLord(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const bl = BOSS.boneLord;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * bl.teleportRatio) {
    phaseShift(state, e, "激怒", RAGE_TEXT_COLOR);
    ai.timer = bl.teleportInterval;
  }
  const dir = toPlayerDir(state, e);
  if (dir.x !== 0) e.facing = dir;

  switch (e.phase) {
    case "chase": {
      driftBoneLord(state, e, def, dir, dt);
      if (ai.stage === STAGE_TWO) {
        ai.timer -= dt;
        if (ai.timer <= 0) teleport(state, e);
      }
      if (e.attackCooldown > 0) return;
      e.phase = "windup";
      e.phaseTimer = def.windup;
      ai.counter = 0;
      pushSfx(state, "enemyWindup");
      return;
    }
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) beginBoneAttack(state, e, def);
      return;
    case "strike":
      tickBarrage(state, e, dt);
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) {
        e.phase = "recover";
        e.phaseTimer = def.recover;
      }
      return;
    case "recover":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) toChase(e, def);
      return;
    default:
      return;
  }
}

function driftBoneLord(state: GameState, e: Enemy, def: EnemyDef, dir: Vec, dt: number): void {
  const d = length(sub(state.player.body.pos, e.body.pos));
  const sign = d < BONE_LORD_KEEP ? -1 : d > BONE_LORD_KEEP * 1.5 ? 1 : 0;
  const perp = { x: -dir.y, y: dir.x };
  const move = add(scale(dir, sign), scale(perp, Math.sin(e.animTime)));
  moveEnemy(state, e, def, move.x * def.speed * dt, move.y * def.speed * dt);
}

function beginBoneAttack(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const bl = BOSS.boneLord;
  e.phase = "strike";
  e.phaseTimer = bl.volleys * bl.volleyInterval;
  ai.timer = 0;
  if (ai.move === BONE_MOVE_WALLS) raiseBoneWalls(state, e);
  ai.move = (ai.move + 1) % BONE_MOVE_COUNT;
  spawnBurst(state, e.body.pos, def.color, 8, 60, 0.3, 1.5);
}

function tickBarrage(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const bl = BOSS.boneLord;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer += bl.volleyInterval;
  // 沈黙中は弾幕を出せない（斉射の拍は進める）
  if (isSilenced(e)) return;
  const offset = ai.counter * bl.volleySpin;
  for (let i = 0; i < bl.bulletDirs; i++) {
    fireBone(state, e, fromAngle(offset + (i / bl.bulletDirs) * FULL_CIRCLE));
  }
  ai.counter += 1;
  pushSfx(state, "enemyShoot");
}

function fireBone(state: GameState, e: Enemy, dir: Vec): void {
  const bl = BOSS.boneLord;
  state.projectiles.push({
    id: allocId(state),
    owner: "enemy",
    pos: add(e.body.pos, scale(dir, e.body.radius + 2)),
    vel: scale(dir, bl.bulletSpeed),
    radius: BONE_BULLET_RADIUS,
    damage: bl.bulletDamage + depthDamageBonus(state.depth),
    life: BONE_BULLET_LIFE,
    color: bl.color,
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
    sourceId: e.id,
  });
}

/** ボスとプレイヤーの間に、狙いと直交する骨の壁を立てる */
function raiseBoneWalls(state: GameState, e: Enemy): void {
  const bl = BOSS.boneLord;
  const p = state.player.body.pos;
  const mid = add(e.body.pos, scale(sub(p, e.body.pos), WALL_POS_RATIO));
  const dir = toPlayerDir(state, e);
  const perp = { x: -dir.y, y: dir.x };
  const half = Math.floor(bl.wallLength / 2);
  for (let i = -half; i <= half; i++) {
    const q = add(mid, scale(perp, i * TILE_SIZE));
    const tx = Math.floor(q.x / TILE_SIZE);
    const ty = Math.floor(q.y / TILE_SIZE);
    if (overlapsWall(state, (tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, 1)) continue;
    const wall = spawnBoneWall(state, tx, ty);
    if (wall) spawnBurst(state, wall.pos, bl.color, 4, 50, 0.3, 1.5);
  }
}

function teleport(state: GameState, e: Enemy): void {
  const ai = e.ai;
  const room = state.rooms[e.roomIndex];
  if (!ai || !room) return;
  ai.timer = BOSS.boneLord.teleportInterval;
  const pos = randomPointInRoom(state, room.rect, e.body.radius);
  if (!pos) return;
  spawnBurst(state, e.body.pos, BOSS.boneLord.color, 14, 120, 0.4, 2);
  spawnRing(state, e.body.pos, e.body.radius * 2, BOSS.boneLord.color, 0.3);
  e.body.pos = pos;
  spawnBurst(state, pos, BOSS.boneLord.color, 14, 120, 0.4, 2);
}

function randomPointInRoom(state: GameState, r: Rect, radius: number): Vec | null {
  const p = state.player.body;
  for (let i = 0; i < FREE_POINT_ATTEMPTS; i++) {
    const x = (r.x + 1 + state.rng.next() * (r.w - 2)) * TILE_SIZE;
    const y = (r.y + 1 + state.rng.next() * (r.h - 2)) * TILE_SIZE;
    if (overlapsWall(state, x, y, radius)) continue;
    if (circlesOverlap(x, y, radius, p.pos.x, p.pos.y, BONE_LORD_KEEP / 2)) continue;
    return { x, y };
  }
  return null;
}

// -----------------------------------------------------------------------------
// 撃破
// -----------------------------------------------------------------------------

/** ボス撃破: 階段出現 + 確定レアドロップ + フラッシュとスローモーション */
export function onBossDeath(state: GameState, e: Enemy): void {
  const b = state.boss;
  if (!b || b.enemyId !== e.id || b.defeated) return;
  b.defeated = true;
  const room = state.rooms[b.roomIndex];
  if (room) {
    const c = rectCenter(room.rect);
    setTile(state.map, c.x, c.y, Tile.StairsDown);
  }
  state.flash = 1;
  state.slowmo = Math.max(state.slowmo, BOSS.defeatSlowmo);
  shake(state, FEEL.shakeSpecial);
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 20 }, `${b.name} 撃破`, DEFEAT_TEXT_COLOR, 1.8, 2);
  pushLog(state, `${b.name}を倒した。階段が現れた。`, DEFEAT_TEXT_COLOR);
  pushSfx(state, "lootRare");
  pushSfx(state, "bossDefeat");
  for (let i = 0; i < BOSS.rareDrops; i++) dropRareItem(state, e.body.pos, i);
}

/** rare 以上が出るまで引き直す（上限回数で打ち切り） */
function dropRareItem(state: GameState, pos: Vec, index: number): void {
  const depth = state.depth;
  let item = generateItem(state.rng, {
    itemLevel: depth + 1,
    rarityBoost: BOSS.rareDropBoost,
    foundDepth: depth,
    now: Date.now(),
  });
  for (let i = 0; i < BOSS.rareDropAttempts && !RARE_OR_BETTER.has(item.rarity); i++) {
    item = generateItem(state.rng, {
      itemLevel: depth + 1,
      rarityBoost: BOSS.rareDropBoost,
      foundDepth: depth,
      now: Date.now(),
    });
  }
  const side = index % 2 === 0 ? -1 : 1;
  const dropPos = { x: pos.x + side * DROP_SPREAD, y: pos.y };
  const safe = overlapsWall(state, dropPos.x, dropPos.y, 2) ? { ...pos } : dropPos;
  state.floorItems.push({ id: allocId(state), item, pos: safe, bobTime: 0 });
}
