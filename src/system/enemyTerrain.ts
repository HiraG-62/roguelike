import { type Enemy, type GameState, type RallyKind, type TerrainSeed, pushSfx } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import { type Vec, dist } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { ENEMY_AI, TERRAIN } from "../data/tuning";
import { spawnRing } from "./effects";
import { blastEnemies, explodeHostile, spawnLanding } from "./hazards";
import { type InflictSource, applyStatus, chainLightning } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";

/**
 * 敵が作る場（docs/ideas/enemies.md「シナジーの作法」）: 地形の予約・両陣営に当たる炸裂・鼓舞・潜行。
 * 敵の地形は敵にも効く（地形の層そのものが両方に効く）ので、プレイヤーは押し込み・引き寄せ・点火で敵の仕掛けを武器にできる。
 * 地形も攻撃と同じく、置く前に予告の影を出す（テレグラフ原則）
 */

// -----------------------------------------------------------------------------
// 地形の予約
// -----------------------------------------------------------------------------

export interface SeedOptions {
  /** 置くまでの秒（既定 ENEMY_AI.terrainSeed.delay） */
  delay?: number;
  /** 置いた地形の持続（既定は地形ごとの TERRAIN.placedDuration） */
  duration?: number;
  /** 影を出さない（爆弾の円など、別の予告が既に出ているとき） */
  quiet?: boolean;
}

/** 予告の影を出し、delay 秒後に地形を置く */
export function seedTerrain(state: GameState, pos: Vec, kind: TerrainKind, radius: number, opts: SeedOptions = {}): void {
  const delay = opts.delay ?? ENEMY_AI.terrainSeed.delay;
  if (!opts.quiet) spawnLanding(state, pos, radius, delay);
  const seeds = state.terrainSeeds ?? [];
  seeds.push({
    pos: { ...pos },
    kind,
    radius,
    time: delay,
    duration: opts.duration ?? TERRAIN.placedDuration[kind],
    depth: state.depth,
  });
  state.terrainSeeds = seeds;
}

/** 時間の来た予約を置く。階が変わった予約は捨てる */
export function updateTerrainSeeds(state: GameState, dt: number): void {
  const seeds = state.terrainSeeds;
  if (!seeds || seeds.length === 0) return;
  const due: TerrainSeed[] = [];
  const keep: TerrainSeed[] = [];
  for (const s of seeds) {
    if (s.depth !== state.depth) continue;
    s.time -= dt;
    (s.time <= 0 ? due : keep).push(s);
  }
  state.terrainSeeds = keep;
  for (const s of due) placeTerrain(state, s.pos.x, s.pos.y, s.kind, s.radius, s.duration);
}

// -----------------------------------------------------------------------------
// 両陣営に当たる炸裂
// -----------------------------------------------------------------------------

/**
 * プレイヤーと敵の両方に当たる炸裂（自爆・吐いた玉・落下・炸裂の予告の後）。
 * 敵の攻撃を敵の群れへ誘導すれば武器になる（1 体の敵に得をするビルドを用意する）。excludeId は撃った本人
 */
export function blastBoth(
  state: GameState,
  pos: Vec,
  radius: number,
  damage: number,
  color: string,
  source: InflictSource | undefined,
  excludeId?: number,
): void {
  explodeHostile(state, pos, radius, damage, color, source);
  blastEnemies(state, pos, radius, damage, excludeId);
}

// -----------------------------------------------------------------------------
// 鼓舞（帯電・急かし・旗の加護）
// -----------------------------------------------------------------------------

export function giveRally(e: Enemy, kind: RallyKind, time: number): void {
  if (e.rally && e.rally.kind === kind) {
    e.rally.time = Math.max(e.rally.time, time);
    return;
  }
  e.rally = { kind, time };
}

export function hasRally(e: Enemy, kind: RallyKind): boolean {
  return e.rally !== undefined && e.rally.kind === kind && e.rally.time > 0;
}

/** 動かない設置物（旗・地雷・卵…）には鼓舞を掛けない（掛けても意味がない） */
function rallyable(e: Enemy): boolean {
  const def = enemyDef(e.defKey);
  return def.speed > 0 && !def.boss;
}

/** from の周り radius の味方に鼓舞を掛ける。掛けた数を返す */
export function rallyAround(state: GameState, from: Enemy, kind: RallyKind, radius: number, time: number): number {
  let count = 0;
  for (const o of state.enemies) {
    if (o === from || o.hp <= 0 || o.phase === "spawning" || !rallyable(o)) continue;
    if (dist(o.body.pos, from.body.pos) > radius) continue;
    giveRally(o, kind, time);
    count += 1;
  }
  return count;
}

/** 鼓舞の時間経過・旗の加護の掛け直し・急かしの攻撃間隔の進み（enemies.ts の updateEnemies から） */
export function updateRallies(state: GameState, dt: number): void {
  const extraHaste = dt * (ENEMY_AI.bellImp.hasteMul - 1);
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const def = enemyDef(e.defKey);
    if (def.aura && e.phase !== "spawning") rallyAround(state, e, def.aura.kind, def.aura.radius, ENEMY_AI.banner.rallyTime);
    const r = e.rally;
    if (!r) continue;
    // 急かし: 次の攻撃までの間隔だけを速める（予備動作は縮めない。テレグラフ原則）
    if (r.kind === "hastened") e.attackCooldown = Math.max(0, e.attackCooldown - extraHaste);
    r.time -= dt;
    if (r.time <= 0) e.rally = undefined;
  }
}

/** 旗の加護: 被ダメージの倍率（elites.ts の interceptEnemyDamage が掛ける） */
export function rallyTakenMul(e: Enemy): number {
  return hasRally(e, "warded") ? ENEMY_AI.banner.takenMul : 1;
}

/** 帯電した敵の接触は感電を付ける（雷鬼火の鼓舞。enemies.ts の接触から） */
export function onRallyContact(state: GameState, e: Enemy): void {
  if (!hasRally(e, "charged")) return;
  const c = ENEMY_AI.charged;
  applyStatus(state, { kind: "player" }, { kind: "shock", stacks: 1, duration: c.contactShock, potency: 0 }, "enemy");
}

/**
 * 死に際の鼓舞: 雷鬼火は周りを帯電させる。帯電した敵が倒れると、周りの敵へ連鎖雷が走る
 * （帯電した群れはプレイヤーの感電ビルドの導線になる。咎める側と得をする側の両方）
 */
export function onRallyDeath(state: GameState, e: Enemy, def: EnemyDef): void {
  if (e.vanished) return;
  if (def.deathRally) {
    const r = def.deathRally;
    if (rallyAround(state, e, r.kind, r.radius, r.time) > 0) {
      spawnRing(state, e.body.pos, r.radius, ENEMY_AI.charged.color, 0.4);
      pushSfx(state, "shock");
    }
  }
  if (hasRally(e, "charged")) chainLightning(state, e.body.pos, ENEMY_AI.charged.deathChainDamage, e.id);
}

// -----------------------------------------------------------------------------
// 地形に乗った性質（沼鬼火の足・苔ゴーレムの胞子・倒れた跡）
// -----------------------------------------------------------------------------

/** この地形の上では足が速い */
export function terrainSpeedMul(state: GameState, e: Enemy, def: EnemyDef): number {
  const t = def.terrainSpeed;
  if (!t) return 1;
  return t.on.includes(terrainAt(state, e.body.pos.x, e.body.pos.y)) ? t.mul : 1;
}

/** 被弾した直後なら足元に胞子（小さな地形）を出す。ai.timer を間隔に使う（胞子を出す敵は ai.timer を他で使わない） */
export function tickSpores(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const kind = def.sporeOnHit;
  const ai = e.ai;
  if (!kind || !ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  if (e.hitFlash <= 0 || ai.timer > 0) return;
  ai.timer = ENEMY_AI.spore.cooldown;
  seedTerrain(state, e.body.pos, kind, ENEMY_AI.spore.radius, { delay: ENEMY_AI.terrainSeed.delay / 2 });
}

/** 倒れた跡に地形を残す（自爆・時間切れで消えたときは残さない） */
export function dropDeathTerrain(state: GameState, e: Enemy, def: EnemyDef): void {
  const drop = def.deathTerrain;
  if (!drop || e.vanished) return;
  seedTerrain(state, e.body.pos, drop.kind, drop.radius);
}
