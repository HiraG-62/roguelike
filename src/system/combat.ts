import { type DamageKind, type Enemy, type GameState, pushLog, pushSfx } from "../core/state";
import { type Vec, normalize, scale, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { FEEL, PLAYER } from "../data/tuning";
import { recordRun, saveProfile } from "../loot/profile";
import { addFloatingText, hitstop, shake, spawnBurst, spawnDirectional } from "./effects";
import { KS, berserkerMul, gamblerMul, hasKeystone, healMul } from "./keystones";
import { rollEnemyDrop } from "./loot";
import { applyOnHitStatus, explodeOnKill } from "./statusEffects";
import { fireTrigger } from "./triggers";

export const COLOR_DAMAGE = "#ffffff";
export const COLOR_HURT = "#ff5050";
export const COLOR_JUST = "#60e0ff";
export const COLOR_HEAL = "#70e070";

const ENEMY_HIT_FLASH = 0.09;
const STAGGER_TIME = 0.4;
const COMBO_POP_TIME = 0.15;
/** コンボ 5 ヒットごとにスコア倍率 +0.5 */
const COMBO_SCORE_STEP = 5;
const COMBO_SCORE_BONUS = 0.5;
const MIN_DAMAGE = 1;
const MIN_PLAYER_DAMAGE = 1;
const PLAYER_HIT_FLASH = 0.12;
const DEATH_SLOWMO = 1.2;
/** JUST 回避で得るゲージ（近接ヒット何回ぶんか） */
const JUST_ENERGY_HITS = 2;

export interface HitOptions {
  stagger?: boolean;
  hitstopSteps?: number;
  /** 必殺ゲージを貯めるか（近接のみ true） */
  buildsEnergy?: boolean;
  /** 既定は proc（on-hit 効果なし） */
  kind?: DamageKind;
  crit?: boolean;
  /** burn tick など: 数字・ヒットストップ・揺れ・コンボ加算なし */
  silent?: boolean;
}

export interface OutgoingHit {
  amount: number;
  crit: boolean;
}

/** コンボ数からスコア倍率。5 ヒットごとに +0.5 */
export function comboMultiplier(count: number): number {
  return 1 + Math.floor(count / COMBO_SCORE_STEP) * COMBO_SCORE_BONUS;
}

export function registerComboHit(state: GameState): void {
  state.combo.count += 1;
  state.combo.timer = FEEL.comboWindow + state.stats.comboWindowBonus;
  state.combo.popTimer = COMBO_POP_TIME;
  state.combo.best = Math.max(state.combo.best, state.combo.count);
}

/** コンボによる与ダメ倍率 */
export function comboDamageMul(state: GameState): number {
  const s = state.stats;
  return 1 + Math.min(s.comboDamageCap, state.combo.count * s.comboDamagePerStack);
}

/**
 * プレイヤー由来の与ダメを stats / バフ / キーストーンで仕上げる。
 * base は tuning の基礎値（melee / ranged は flat と mul をここで足す）
 */
export function rollOutgoing(state: GameState, enemy: Enemy | null, base: number, kind: DamageKind): OutgoingHit {
  const s = state.stats;
  const p = state.player;
  let amount = base;
  if (kind === "melee") amount = (base + s.meleeDamageFlat) * s.meleeDamageMul;
  if (kind === "ranged") amount = (base + s.rangedDamageFlat) * s.rangedDamageMul;

  let crit = false;
  if (kind !== "proc") {
    if (enemy?.phase === "stagger") amount *= s.damageVsStaggeredMul;
    amount *= comboDamageMul(state);
    if (p.justTimer > 0) amount *= s.justDodgeDamageMul;
    if (p.buffs.damage.time > 0) amount *= p.buffs.damage.mul;
    crit = state.rng.chance(s.critChance);
    if (crit) amount *= s.critMul;
  }
  amount *= berserkerMul(state);
  amount *= gamblerMul(state);
  return { amount: Math.max(MIN_DAMAGE, Math.round(amount)), crit };
}

/** 敵にダメージ。倒したら true。配列からの除去は enemies 側で行う */
export function damageEnemy(
  state: GameState,
  enemy: Enemy,
  amount: number,
  knockDir: Vec,
  knockForce: number,
  opts: HitOptions = {},
): boolean {
  if (enemy.hp <= 0) return false;
  const def = enemyDef(enemy.defKey);
  const kind = opts.kind ?? "proc";
  enemy.hp -= amount;

  if (!opts.silent) {
    enemy.hitFlash = ENEMY_HIT_FLASH;
    const dir = normalize(knockDir);
    if (knockForce > 0) enemy.knock = scale(dir, knockForce);
    if (opts.stagger && enemy.phase !== "spawning") {
      enemy.phase = "stagger";
      enemy.phaseTimer = STAGGER_TIME;
    }
    registerComboHit(state);
    showHit(state, enemy, amount, dir, def.color, opts);
  }

  if (opts.buildsEnergy) gainEnergy(state, PLAYER.energyPerHit);
  if (kind === "melee") pushSfx(state, opts.stagger ? "hitHeavy" : "hit");
  if (kind === "ranged") pushSfx(state, "bulletHit");
  if (kind === "melee" && state.stats.lifeOnHit > 0) healPlayer(state, state.stats.lifeOnHit, { silent: true });
  if (kind !== "proc") applyOnHitStatus(state, enemy);

  if (enemy.hp > 0) return false;
  killEnemy(state, enemy);
  return true;
}

function showHit(state: GameState, enemy: Enemy, amount: number, dir: Vec, color: string, opts: HitOptions): void {
  const baseScale = opts.stagger ? 1.4 : 1;
  const textScale = opts.crit ? Math.max(baseScale, PLAYER.critTextScale) : baseScale;
  const textColor = opts.crit ? PLAYER.critColor : COLOR_DAMAGE;
  addFloatingText(state, enemy.body.pos, String(amount), textColor, textScale);
  spawnDirectional(state, enemy.body.pos, dir, color, opts.stagger ? 10 : 5, 140);
  const steps = (opts.hitstopSteps ?? FEEL.hitstopLight) + (opts.crit ? PLAYER.critHitstopBonus : 0);
  hitstop(state, steps);
  shake(state, opts.stagger ? FEEL.shakeHeavy : FEEL.shakeLight);
}

/** 必殺ゲージを増やす（energyGainMul 込み） */
export function gainEnergy(state: GameState, amount: number): void {
  const p = state.player;
  p.energy = Math.min(p.maxEnergy, p.energy + amount * state.stats.energyGainMul);
}

function killEnemy(state: GameState, enemy: Enemy): void {
  const def = enemyDef(enemy.defKey);
  state.kills += 1;
  const gained = Math.round(def.score * comboMultiplier(state.combo.count));
  state.score += gained;
  spawnBurst(state, enemy.body.pos, def.color, 18, 160, 0.5, 2.5);
  spawnBurst(state, enemy.body.pos, "#ffffff", 6, 90, 0.25, 1.5);
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 6 }, `+${gained}`, "#ffd75f", 1.1, 0.8);
  hitstop(state, FEEL.hitstopKill);
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "kill");

  if (state.stats.lifeOnKill > 0) healPlayer(state, state.stats.lifeOnKill);
  rollEnemyDrop(state, enemy);
  explodeOnKill(state, enemy);
  fireTrigger(state, "onKill", { pos: { ...enemy.body.pos }, targetId: enemy.id });
}

export type PlayerHitResult = "hit" | "dodged" | "ignored";

/** 被ダメ計算: armor を引いてから damageTakenMul。最低 1 */
export function mitigate(state: GameState, amount: number): number {
  const s = state.stats;
  return Math.max(MIN_PLAYER_DAMAGE, Math.round((amount - s.armor) * s.damageTakenMul));
}

/** プレイヤーへのダメージ。無敵中はジャスト回避判定だけ行う。attacker は thorns の反射先 */
export function damagePlayer(state: GameState, amount: number, fromPos: Vec, attacker?: Enemy): PlayerHitResult {
  const p = state.player;
  if (state.status !== "playing") return "ignored";
  if (p.invulnTimer > 0 || p.buffs.invuln > 0) {
    if (p.dashTimer > 0 && !p.dodgedThisDash) {
      justDodge(state);
      return "dodged";
    }
    return "ignored";
  }

  const taken = mitigate(state, amount);
  p.hp = Math.max(0, p.hp - taken);
  p.invulnTimer = PLAYER.hurtInvuln;
  p.hitFlash = PLAYER_HIT_FLASH;
  const away = normalize(sub(p.body.pos, fromPos));
  if (!hasKeystone(state, KS.juggernaut)) p.knock = scale(away, PLAYER.hurtKnockback);
  cancelAttack(state);
  state.combo.count = 0;
  state.combo.timer = 0;

  addFloatingText(state, p.body.pos, `-${taken}`, COLOR_HURT, 1.3);
  spawnBurst(state, p.body.pos, COLOR_HURT, 12, 150, 0.4, 2);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeHurt);
  state.flash = Math.max(state.flash, 0.35);

  if (p.hp <= 0) {
    killPlayer(state);
    return "hit";
  }
  pushSfx(state, "hurt");
  reflectThorns(state, attacker);
  fireTrigger(state, "onHurt", { pos: { ...p.body.pos }, targetId: attacker?.id });
  return "hit";
}

function reflectThorns(state: GameState, attacker: Enemy | undefined): void {
  const thorns = state.stats.thorns;
  if (!attacker || thorns <= 0 || attacker.hp <= 0) return;
  const dir = sub(attacker.body.pos, state.player.body.pos);
  const hit = rollOutgoing(state, attacker, thorns, "proc");
  damageEnemy(state, attacker, hit.amount, dir, 0);
}

function killPlayer(state: GameState): void {
  const p = state.player;
  state.status = "dead";
  state.deathTimer = 0;
  spawnBurst(state, p.body.pos, "#ffffff", 40, 220, 0.9, 3);
  state.slowmo = DEATH_SLOWMO;
  pushSfx(state, "death");
  pushLog(state, `You died on depth ${state.depth}.`, COLOR_HURT);
  recordRunOnce(state);
}

/**
 * ラン結果をプロフィールに記録して保存する（1 ランにつき 1 回）。
 * runs は createGame で既に数えているので recordRun による加算は打ち消す
 */
export function recordRunOnce(state: GameState): void {
  if (state.runRecorded) return;
  state.runRecorded = true;
  const profile = state.profile;
  const runsBefore = profile.meta.runs;
  recordRun(profile, { depth: state.depth, kills: state.kills, score: state.score });
  profile.meta.runs = runsBefore;
  saveProfile(profile);
}

function justDodge(state: GameState): void {
  const p = state.player;
  p.dodgedThisDash = true;
  p.justTimer = state.stats.justDodgeWindow;
  state.slowmo = Math.max(state.slowmo, FEEL.justDodgeSlowmo);
  gainEnergy(state, PLAYER.energyPerHit * JUST_ENERGY_HITS);
  registerComboHit(state);
  addFloatingText(state, p.body.pos, "JUST!", COLOR_JUST, 1.5, 0.7);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  state.flash = Math.max(state.flash, 0.2);
  pushSfx(state, "just");
  fireTrigger(state, "onJustDodge", { pos: { ...p.body.pos } });
}

export function cancelAttack(state: GameState): void {
  const a = state.player.attack;
  a.phase = "none";
  a.timer = 0;
  a.buffered = false;
  a.hitIds.clear();
}

export interface HealOptions {
  /** 数字と粒子を出さない（regen / life on hit） */
  silent?: boolean;
}

/** 回復。ks_berserker で半減。実際に回復した量を返す */
export function healPlayer(state: GameState, amount: number, opts: HealOptions = {}): number {
  const p = state.player;
  if (state.status !== "playing") return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount * healMul(state));
  const gained = p.hp - before;
  if (gained <= 0 || opts.silent) return gained;
  const shown = Math.round(gained);
  if (shown > 0) addFloatingText(state, p.body.pos, `+${shown}`, COLOR_HEAL, 1.2);
  spawnBurst(state, p.body.pos, COLOR_HEAL, 10, 80, 0.5, 2);
  pushSfx(state, "heal");
  return gained;
}
