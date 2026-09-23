import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { ENEMY_AI } from "../data/tuning";
import { addFloatingText, shake, spawnBurst, spawnRing } from "./effects";
import { explodeHostile, spawnLanding, spawnShockwave } from "./hazards";
import { applyStagger, initEnemyPoise } from "./poise";
import { applyStatus, hasStatus, isSilenced } from "./statusEffects";
import { consumeCorpse, fanDirections, findFreeSpot, fireEnemyBullet, followersOf, nearestCorpse, reviveCorpse } from "./enemyTraits";

/**
 * 2026-09-24 に足した behavior の固有処理（docs/ideas/enemies.md）。
 * 状態機械（chase → windup → strike → recover）は enemies.ts が回し、ここは各段の中身だけを持つ
 */

/** ai.move: 骨拾いが死骸を食べている */
export const SCAVENGER_EATING = 1;
/** ai.move: 喰らう宝箱の技（噛みつき / 舌） */
export const MIMIC_BITE = 0;
export const MIMIC_TONGUE = 1;
/** 育って壁に掛かったとき押し出す距離の上限（伸ばした分に対する倍率。角では斜めに押すので √2 より少し大きく） */
const GROW_PUSH_MUL = 1.5;
/** 押し出し先を探す刻み（px） */
const GROW_PUSH_STEP = 0.25;

// -----------------------------------------------------------------------------
// 自爆（導火鼠・結晶ダニ）
// -----------------------------------------------------------------------------

/** 予備動作の始まり: 爆ぜる範囲を影で見せる */
export function telegraphKamikaze(state: GameState, e: Enemy, def: EnemyDef): void {
  const ex = def.explode;
  if (!ex) return;
  spawnLanding(state, e.body.pos, ex.radius, e.phaseTimer, e.id, true);
}

/** 自分ごと爆ぜる。撃破ではないので報酬・死骸は出ない（vanished） */
export function detonate(state: GameState, e: Enemy, def: EnemyDef): void {
  const ex = def.explode;
  if (!ex) return;
  const source = { defKey: def.key, roomIndex: e.roomIndex };
  explodeHostile(state, e.body.pos, ex.radius, ex.damage + depthDamageBonus(state.depth), ex.color, source);
  e.vanished = true;
  e.hp = 0;
}

// -----------------------------------------------------------------------------
// 残像打ち: 少し前のプレイヤーの位置を狙う
// -----------------------------------------------------------------------------

/** プレイヤーの位置を一定間隔で記録する（古いものから捨てる） */
export function recordTrail(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const t = ENEMY_AI.echoStriker;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer += t.sampleInterval;
  const trail = ai.points ?? [];
  trail.push({ ...state.player.body.pos });
  const keep = Math.ceil(t.delay / t.sampleInterval) + 1;
  while (trail.length > keep) trail.shift();
  ai.points = trail;
}

/** 狙う位置: delay 秒前（記録が足りなければ今の位置） */
export function echoTarget(state: GameState, e: Enemy): Vec {
  const oldest = e.ai?.points?.[0];
  return oldest ? { ...oldest } : { ...state.player.body.pos };
}

export function telegraphEcho(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.target = echoTarget(state, e);
  spawnLanding(state, ai.target, ENEMY_AI.echoStriker.radius, e.phaseTimer, e.id);
}

export function strikeEcho(state: GameState, e: Enemy, def: EnemyDef): void {
  const t = ENEMY_AI.echoStriker;
  const target = e.ai?.target ?? state.player.body.pos;
  explodeHostile(state, target, t.radius, t.damage + depthDamageBonus(state.depth), t.color, {
    defKey: def.key,
    roomIndex: e.roomIndex,
  });
}

// -----------------------------------------------------------------------------
// 沈黙の修道士: 足元の円が炸裂すると沈黙
// -----------------------------------------------------------------------------

export function telegraphSilence(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.target = { ...state.player.body.pos };
  spawnLanding(state, ai.target, ENEMY_AI.silencer.radius, e.phaseTimer, e.id);
}

export function strikeSilence(state: GameState, e: Enemy): void {
  const s = ENEMY_AI.silencer;
  const target = e.ai?.target ?? state.player.body.pos;
  spawnRing(state, target, s.radius, s.color, 0.3);
  spawnBurst(state, target, s.color, 12, 80, 0.4, 1.5);
  pushSfx(state, "enemyShoot");
  const p = state.player.body;
  if (dist(p.pos, target) > s.radius + p.radius) return;
  applyStatus(state, { kind: "player" }, { kind: "silence", stacks: 1, duration: s.duration, potency: 0 }, "enemy");
}

// -----------------------------------------------------------------------------
// 霜砕き: 冷えている相手にだけ大技
// -----------------------------------------------------------------------------

/** プレイヤーが冷気か凍結なら砕きを狙う */
export function frostCrusherReady(state: GameState): boolean {
  const bag = state.player.status;
  return hasStatus(bag, "chill") || hasStatus(bag, "freeze");
}

export function strikeShockRing(state: GameState, e: Enemy, radius: number, damage: number, color: string): void {
  spawnShockwave(state, e.body.pos, radius, damage + depthDamageBonus(state.depth), e.id);
  spawnBurst(state, e.body.pos, color, 14, 110, 0.4, 2.5);
  shake(state, 4);
}

// -----------------------------------------------------------------------------
// 群れの長・楽団長: 取り巻きに一斉に攻撃させる
// -----------------------------------------------------------------------------

/**
 * 取り巻きを一斉に予備動作へ入れる。各自の予備動作はそのまま見せるので、号令 1 つを読めば全員の攻撃がわかる。
 * begin は enemies.ts の予備動作の入口（循環 import を避けるため引数で受ける）
 */
export function rallyFollowers(
  state: GameState,
  leader: Enemy,
  begin: (state: GameState, e: Enemy, def: EnemyDef, dir: Vec) => void,
): void {
  for (const f of followersOf(state, leader)) {
    if (f.phase !== "chase" && f.phase !== "recover") continue;
    const dir = normalize(sub(state.player.body.pos, f.body.pos), f.strikeDir);
    f.attackCooldown = 0;
    begin(state, f, enemyDef(f.defKey), dir);
  }
  spawnRing(state, leader.body.pos, 40, "#ffffff", 0.35);
}

/** 楽団長の指揮棒の一振り: 扇の弾 */
export function conductorVolley(state: GameState, e: Enemy): void {
  const c = ENEMY_AI.conductor;
  if (isSilenced(e)) return;
  const damage = c.bulletDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, c.bulletCount, c.spreadDeg)) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed: c.bulletSpeed, damage, color: c.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

// -----------------------------------------------------------------------------
// 骨拾い: 死骸を食べて育つ
// -----------------------------------------------------------------------------

/** 育った段（0..maxGrowth）。ai.counter に持つ（骨拾いは連続攻撃を持たない） */
export function scavengerGrowth(e: Enemy): number {
  return e.ai?.counter ?? 0;
}

/** 死骸があればそちらへ向かう向き。無ければ undefined（プレイヤーを追う） */
export function scavengerHeading(state: GameState, e: Enemy): Vec | undefined {
  if (scavengerGrowth(e) >= ENEMY_AI.scavenger.maxGrowth) return undefined;
  const corpse = nearestCorpse(state, e.body.pos, ENEMY_AI.scavenger.seekRadius, e.roomIndex);
  if (!corpse) return undefined;
  return normalize(sub(corpse.pos, e.body.pos));
}

/** 死骸に届いていれば食べ始める（隙として recover を使う。攻撃ではないので予告の ! は出さない） */
export function tryStartEating(state: GameState, e: Enemy): boolean {
  const s = ENEMY_AI.scavenger;
  const ai = e.ai;
  if (!ai || scavengerGrowth(e) >= s.maxGrowth) return false;
  const corpse = nearestCorpse(state, e.body.pos, s.eatRange + e.body.radius, e.roomIndex);
  if (!corpse) return false;
  consumeCorpse(state, corpse);
  ai.move = SCAVENGER_EATING;
  e.phase = "recover";
  e.phaseTimer = s.eatTime;
  return true;
}

/** 食べ終わり: 1 段育つ（HP・接触ダメージ・体の大きさ）。壁際で体を大きくできなければ育たない */
export function finishEating(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai || ai.move !== SCAVENGER_EATING) return;
  const s = ENEMY_AI.scavenger;
  ai.move = 0;
  const growth = Math.min(s.maxGrowth, ai.counter + 1);
  if (!growBody(state, e, def.radius + growth * s.radiusPerGrowth)) return;
  ai.counter = growth;
  const bonus = Math.round(e.maxHp * s.hpPerGrowth);
  e.maxHp += bonus;
  e.hp += bonus;
  e.lastHp = e.hp;
  addFloatingText(state, e.body.pos, "育った", s.color, 1, 0.8);
  spawnBurst(state, e.body.pos, s.color, 10, 70, 0.3, 1.5);
}

/**
 * 体を radius まで大きくする。壁に掛かるなら、伸ばした分（斜めの角を考えて GROW_PUSH_MUL 倍まで）だけ壁から離れる位置へ押し出す。
 * 押し出せなければ大きくしない（false）。壁際で育って壁にめり込まないように
 */
function growBody(state: GameState, e: Enemy, radius: number): boolean {
  const grown = Math.max(0, radius - e.body.radius);
  const spot = findFreeSpot(state, e.body.pos, radius, grown * GROW_PUSH_MUL, GROW_PUSH_STEP);
  if (!spot) return false;
  e.body.pos = spot;
  e.body.radius = radius;
  return true;
}

/** 骨拾いは育つほど噛みつきが重い */
export function contactDamageOf(e: Enemy, def: EnemyDef): number {
  if (def.behavior !== "scavenger") return def.contactDamage;
  return Math.round(def.contactDamage * (1 + scavengerGrowth(e) * ENEMY_AI.scavenger.damagePerGrowth));
}

// -----------------------------------------------------------------------------
// 墓守の鐘: 鳴るたびに頭上の数字が減り、0 で死骸を 1 体蘇らせる
// -----------------------------------------------------------------------------

/** 残りの鳴る回数（ai.counter。0 は未初期化なので rings から始める） */
export function bellCount(e: Enemy): number {
  const c = e.ai?.counter ?? 0;
  return c > 0 ? c : ENEMY_AI.graveBell.rings;
}

export function ringBell(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const g = ENEMY_AI.graveBell;
  const left = bellCount(e) - 1;
  spawnRing(state, e.body.pos, 30, g.color, 0.4);
  pushSfx(state, "enemyWindup");
  if (left > 0) {
    ai.counter = left;
    addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 10 }, String(left), g.color, 1.2, 0.8);
    return;
  }
  ai.counter = g.rings;
  const corpse = nearestCorpse(state, e.body.pos, Infinity, e.roomIndex);
  if (!corpse) return;
  reviveCorpse(state, corpse);
  addFloatingText(state, corpse.pos, "蘇った", g.color, 1.1, 0.9);
}

// -----------------------------------------------------------------------------
// 喰らう宝箱: 噛みつき（突進）と舌（短いレーザー）を交互に
// -----------------------------------------------------------------------------

export function nextMimicMove(e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.move = ai.move === MIMIC_BITE ? MIMIC_TONGUE : MIMIC_BITE;
}

export function isMimicTongue(e: Enemy): boolean {
  return e.ai?.move === MIMIC_TONGUE;
}

// -----------------------------------------------------------------------------
// 鎧の中身: HP が減ると鎧が割れ、亡霊（別の敵定義）になる
// -----------------------------------------------------------------------------

/** HP が閾値を切っていたら変身する。変わったら true */
export function transformIfBroken(state: GameState, e: Enemy, def: EnemyDef): boolean {
  const t = def.transformTo;
  if (!t || e.hp <= 0 || e.hp > e.maxHp * t.hpRatio) return false;
  const next = enemyDef(t.key);
  e.defKey = next.key;
  e.body.radius = next.radius;
  e.phase = "chase";
  e.attackCooldown = next.attackInterval;
  initEnemyPoise(e, state.depth);
  const h = ENEMY_AI.hollowArmor;
  spawnBurst(state, e.body.pos, h.color, 24, 150, 0.5, 2.5);
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 12 }, "鎧が割れた", h.color, 1.3, 1);
  shake(state, 5);
  pushSfx(state, "guardBreak");
  // 割れた瞬間は隙（自傷扱い: 拘束上限を数えない）
  applyStagger(state, e, h.breakStagger, { selfInflicted: true });
  return true;
}

