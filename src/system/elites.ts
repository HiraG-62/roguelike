import { type EliteKind, type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import { type Vec, length, normalize, scale } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ELITE, ENEMY_AI } from "../data/tuning";
import { comboMultiplier, damageEnemy } from "./combat";
import { addFloatingText, spawnBurst } from "./effects";
import { spawnBomb } from "./hazards";
import { dropItem, enemyDropChance } from "./loot";

/** エリート修飾子と、盾・反射など「被弾の前に割り込む」処理 */

export const ELITE_KINDS: readonly EliteKind[] = ["explosive", "reflective", "shielded", "hasted", "linked"];

export const ELITE_COLOR: Readonly<Record<EliteKind, string>> = {
  explosive: "#ff8030",
  reflective: "#e0e0ff",
  shielded: "#60a0ff",
  hasted: "#ffe040",
  linked: "#ff80ff",
};

export const ELITE_PREFIX: Readonly<Record<EliteKind, string>> = {
  explosive: "Explosive",
  reflective: "Reflective",
  shielded: "Shielded",
  hasted: "Hasted",
  linked: "Linked",
};

const DEG_TO_RAD = Math.PI / 180;
const BLOCK_TEXT = "BLOCK";
const BREAK_TEXT = "BREAK";
const GUARD_BREAK_TEXT = "GUARD BREAK";
const BLOCK_PARTICLES = 6;
const GUARD_BREAK_PARTICLES = 10;
const REFLECT_PARTICLES = 5;
const LINK_MIN_MEMBERS = 2;

export function eliteChance(depth: number): number {
  if (depth < ELITE.minDepth) return 0;
  return Math.min(ELITE.maxChance, ELITE.baseChance + (depth - ELITE.minDepth) * ELITE.chancePerDepth);
}

/** 生成直後の敵に確率でエリート修飾子を付ける */
export function rollElite(state: GameState, e: Enemy): void {
  if (enemyDef(e.defKey).boss) return;
  if (!state.rng.chance(eliteChance(state.depth))) return;
  makeElite(e, state.rng.pick(ELITE_KINDS));
}

export function makeElite(e: Enemy, kind: EliteKind): void {
  e.elite = kind;
  const hp = Math.round(e.maxHp * ELITE.hpMul);
  e.maxHp = hp;
  e.hp = hp;
  if (kind === "shielded") {
    // シールドは hp に上乗せして持つ（被ダメ処理を変えずに 2 段階にできる）
    const shield = Math.round(hp * ELITE.shieldRatio);
    e.shieldMax = shield;
    e.maxHp += shield;
    e.hp += shield;
  }
  e.lastHp = e.hp;
}

/** Linked が部屋に 1 体しかいなければ、同じ部屋の通常敵を 1 体相方にする */
export function finalizeLinks(state: GameState, roomIndex: number): void {
  const inRoom = state.enemies.filter((e) => e.roomIndex === roomIndex && e.hp > 0);
  const linked = inRoom.filter((e) => e.elite === "linked");
  if (linked.length !== 1) return;
  const partner = inRoom.find((e) => !e.elite && !enemyDef(e.defKey).boss);
  if (partner) {
    makeElite(partner, "linked");
    return;
  }
  // 相方がいないなら意味がないので Hasted に差し替える
  const solo = linked[0];
  if (solo) solo.elite = "hasted";
}

export function eliteSpeedMul(e: Enemy): number {
  return e.elite === "hasted" ? ELITE.speedMul : 1;
}

export function eliteWindupMul(e: Enemy): number {
  return e.elite === "hasted" ? ELITE.windupMul : 1;
}

/** 残りシールド量（Shielded 以外は 0） */
export function shieldLeft(e: Enemy): number {
  const max = e.shieldMax ?? 0;
  if (max <= 0) return 0;
  return Math.max(0, e.hp - (e.maxHp - max));
}

export function eliteDisplayName(e: Enemy): string {
  const name = enemyDef(e.defKey).name;
  return e.elite ? `${ELITE_PREFIX[e.elite]} ${name}` : name;
}

/** 毎ステップ、敵の行動より前に呼ぶ: シールド破壊と Linked の HP 共有 */
export function updateElites(state: GameState): void {
  for (const e of state.enemies) {
    if (e.shieldMax && e.shieldMax > 0 && e.hp <= e.maxHp - e.shieldMax) breakShield(state, e);
  }
  shareLinkedDamage(state);
  for (const e of state.enemies) e.lastHp = e.hp;
}

function breakShield(state: GameState, e: Enemy): void {
  const max = e.shieldMax ?? 0;
  e.maxHp -= max;
  e.shieldMax = 0;
  addFloatingText(state, e.body.pos, BREAK_TEXT, ELITE_COLOR.shielded, 1.3, 0.8);
  spawnBurst(state, e.body.pos, ELITE_COLOR.shielded, 14, 120, 0.4, 2);
  pushSfx(state, "hitHeavy");
  if (e.hp <= 0 || e.phase === "spawning") return;
  e.phase = "stagger";
  e.phaseTimer = ELITE.shieldBreakStagger;
}

/**
 * 同じ部屋の Linked は受けた「最大 HP に対する割合」を全員で共有する。
 * 前ステップからの減少ぶんを集計し、他のメンバーにも同じ割合を与える
 */
function shareLinkedDamage(state: GameState): void {
  const groups = new Map<number, Enemy[]>();
  for (const e of state.enemies) {
    if (e.elite !== "linked") continue;
    const g = groups.get(e.roomIndex) ?? [];
    g.push(e);
    groups.set(e.roomIndex, g);
  }
  for (const group of groups.values()) {
    if (group.length < LINK_MIN_MEMBERS) continue;
    const fractions = group.map((e) => Math.max(0, (e.lastHp ?? e.hp) - Math.max(0, e.hp)) / e.maxHp);
    const total = fractions.reduce((s, f) => s + f, 0);
    if (total <= 0) continue;
    group.forEach((e, i) => {
      const share = total - (fractions[i] ?? 0);
      const amount = Math.round(share * e.maxHp);
      if (amount <= 0 || e.hp <= 0) return;
      damageEnemy(state, e, amount, { x: 0, y: 0 }, 0, { silent: true });
    });
  }
}

/** 正面（facing から ±blockArc/2 以内）から来た攻撃か。dir は攻撃の進行方向 */
export function isFrontal(e: Enemy, dir: Vec): boolean {
  if (length(dir) === 0) return false;
  const incoming = scale(normalize(dir), -1);
  const f = normalize(e.facing);
  const cosHalf = Math.cos((ENEMY_AI.knight.blockArcDeg / 2) * DEG_TO_RAD);
  return incoming.x * f.x + incoming.y * f.y >= cosHalf;
}

function canBlock(e: Enemy): boolean {
  return e.defKey === "knight" && e.phase !== "stagger" && e.phase !== "spawning";
}

function showBlock(state: GameState, e: Enemy, dir: Vec): void {
  addFloatingText(state, e.body.pos, BLOCK_TEXT, ENEMY_AI.knight.blockColor, 1.1, 0.6);
  spawnBurst(state, e.body.pos, ENEMY_AI.knight.blockColor, BLOCK_PARTICLES, 90, 0.25, 1.5);
  // 盾で受けた反動で少しだけ下がる
  e.knock = scale(normalize(dir), ENEMY_AI.knight.blockPushback);
  pushSfx(state, "wallHit");
}

/** GUARD BREAK: カウンター/JUST カウンターは盾を無視してダメージが通り、代わりに大きく怯む */
function showGuardBreak(state: GameState, e: Enemy): void {
  addFloatingText(state, e.body.pos, GUARD_BREAK_TEXT, ENEMY_AI.knight.blockColor, 1.3, 0.8);
  spawnBurst(state, e.body.pos, ENEMY_AI.knight.blockColor, GUARD_BREAK_PARTICLES, 130, 0.35, 2);
  pushSfx(state, "hitHeavy");
  if (e.hp <= 0 || e.phase === "spawning") return;
  e.phase = "stagger";
  e.phaseTimer = ENEMY_AI.knight.guardBreakStagger;
}

/**
 * damageEnemy の直前に割り込む。返り値が 0 以下ならダメージ無効。
 * 近接の正面攻撃は knight の盾で防ぐ（弾は deflectProjectile が処理する）。
 * guardBreak（カウンターヒット / JUST カウンター）なら盾を無視して通す代わりに GUARD BREAK 表示 + スタガー
 */
export function interceptEnemyDamage(
  state: GameState,
  e: Enemy,
  amount: number,
  knockDir: Vec,
  kind: "melee" | "ranged" | "proc",
  guardBreak = false,
): number {
  if (kind !== "melee") return amount;
  if (!canBlock(e) || !isFrontal(e, knockDir)) return amount;
  if (guardBreak) {
    showGuardBreak(state, e);
    return amount;
  }
  showBlock(state, e, knockDir);
  return 0;
}

/**
 * プレイヤー弾が敵に当たる直前に呼ぶ。true なら弾は処理済み（ダメージを与えない）。
 * knight の正面は弾かれて消え、Reflective は向きを反転して敵弾になる
 */
export function deflectProjectile(state: GameState, pr: Projectile, e: Enemy): boolean {
  if (pr.owner !== "player") return false;
  if (canBlock(e) && isFrontal(e, pr.vel)) {
    showBlock(state, e, pr.vel);
    pr.life = 0;
    return true;
  }
  if (e.elite !== "reflective") return false;
  pr.owner = "enemy";
  pr.vel = scale(pr.vel, -1);
  pr.damage = ELITE.reflectDamage;
  pr.color = ELITE.reflectColor;
  pr.kind = "proc";
  pr.hitIds.clear();
  pr.pierceLeft = 0;
  pr.sourceId = e.id;
  spawnBurst(state, pr.pos, ELITE.reflectColor, REFLECT_PARTICLES, 80, 0.2, 1.5);
  pushSfx(state, "bulletHit");
  return true;
}

/** エリート撃破時: スコア上乗せ・追加ドロップ・Explosive の時限爆発 */
export function onEliteDeath(state: GameState, e: Enemy): void {
  if (!e.elite) return;
  const def = enemyDef(e.defKey);
  const bonus = Math.round(def.score * (ELITE.scoreMul - 1) * comboMultiplier(state.combo.count));
  state.score += bonus;
  // 通常ドロップ 1 回ぶんは killEnemy で済んでいるので残り (dropMul - 1) 倍ぶんを追加で抽選する
  const extra = Math.min(1, enemyDropChance(state, e) * (ELITE.dropMul - 1));
  if (state.rng.chance(extra)) dropItem(state, e.body.pos);
  if (e.elite === "explosive") {
    spawnBomb(state, e.body.pos, ELITE.explodeDamage, e.id, ELITE.explodeFuse, ELITE.explodeRadius);
  }
}
