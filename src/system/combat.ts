import { type DamageKind, type Enemy, type GameState, pushLog, pushSfx } from "../core/state";
import { type Vec, normalize, scale, sub } from "../core/vec";
import { enemyDef, isBossClass } from "../data/enemies";
import { ACTION, FEEL, HEAL, KEYSTONE, MANA, PLAYER, POISE, ROOM_KIND, STATUS } from "../data/tuning";
import { recordRun, saveProfile } from "../loot/profile";
import { recordProvenance } from "../loot/provenance";
import { addFloatingText, hitstop, shake, spawnBurst, spawnDirectional, spawnRing } from "./effects";
import { comboDamageText, damageTextKind, damageTextLook, justFx, noteDotDamage, onHitFx, spawnDeathFx } from "./effects";
import { cameraKick } from "./camera";
import { roomInCombat } from "./engagement";
import { KS, berserkerMul, bladeOathMul, gamblerMul, hasKeystone, healMul, regenAllowed } from "./keystones";
import { rollEnemyDrop } from "./loot";
import { applyOnHitStatus, enemyDamageMul, explodeOnKill, hasStatus, removeStatus } from "./statusEffects";
import { enemyStatusTakenMul, onPlayerHurtStatus, playerStatusOutgoingMul, playerStatusTakenMul } from "./statusEffects";
import { addPoise, isStaggered } from "./poise";
import { gainMana } from "./mana";
import { fireTrigger } from "./triggers";
import { pushComboEvent, pushEvent, pushHitEvents, pushKillEvents, pushPlayerEvent, pushShatterEvent } from "../core/events";
import { onTraitHit, onTraitKill, onTraitStagger, traitElementMul, traitIncomingMul, traitOutgoingMul, traitPoiseMul } from "./traitHooks";
import { interceptEnemyDamage } from "./elites";
import { WAVE3_SKILL_TUNING } from "../skills/tuning3";
import { boonJustEligible, comboAfterHurt, onBoonComboHit, onBoonCrit, onBoonJust, onBoonKill, onBoonShatter, tryRevive } from "./boons";
import { boonForcesCrit, boonPoise } from "./boonRules";
import { guardDamageMul, tryParry } from "./weaponArts";
import type { AttackProfile } from "../core/element";
import { type ElementAffinity, type OutgoingElement, defenseReduction, enemyAttackOf, outgoingElement, playerMitigationMul, resolveAttack, rollElementAffinity, showAffinity } from "./elementCombat";

export const COLOR_DAMAGE = "#ffffff";
export const COLOR_HURT = "#ff5050";
export const COLOR_JUST = "#60e0ff";
export const COLOR_HEAL = "#70e070";

const ENEMY_HIT_FLASH = 0.09;
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
/** 怯ませた一撃の演出（数字の大きさ・粒子数） */
const HEAVY_TEXT_SCALE = 1.4;
const HEAVY_PARTICLES = 10;
const LIGHT_PARTICLES = 5;
const SHATTER_TEXT = "砕き";
const SHATTER_PARTICLES = 12;
/** 撃破の瞬間、攻撃方向へ飛ぶ破片（docs/ideas/combat-feel-design.md D-5） */
const KILL_DIRECTIONAL_PARTICLES = 8;
const KILL_DIRECTIONAL_SPEED = 220;
/** lifeOnHit は「与ダメの %」 */
const PERCENT = 100;

export interface HitOptions {
  /** 最終の怯み値（poiseDamageMul 込み）。0 / 未指定は怯み値なし */
  poise?: number;
  /** 壁叩きつけなど: 強靭を無視する */
  ignoreSuperArmor?: boolean;
  /** スキル由来の命中（性質の on-hit 付与で on: "skill" を判定する） */
  skill?: boolean;
  hitstopSteps?: number;
  /** 必殺ゲージを貯めるか（近接のみ true） */
  buildsEnergy?: boolean;
  /** 既定は proc（on-hit 効果なし） */
  kind?: DamageKind;
  crit?: boolean;
  /** burn tick など: 数字・ヒットストップ・揺れ・コンボ加算なし */
  silent?: boolean;
  /** カウンターヒット / JUST カウンター: knight の盾を無視して通す（GUARD BREAK） */
  guardBreak?: boolean;
  /** 武器種の最終段・フィニッシュ派生の命中（docs/ideas/combat-feel-design.md D-2）。showHit のヒットストップに反映 */
  finisher?: boolean;
}

/** rollOutgoing の追加指定。skill はスキル由来（skillDamageMul を掛ける） */
export interface OutgoingOptions {
  skill?: boolean;
  /**
   * 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。省略時は近接 = 武器種、射撃 = 射撃の型、スキル = 無属性の物理、
   * proc = 素性なし（防御・耐性を掛けない）。null を渡すと素性なし
   */
  attack?: AttackProfile | null;
}

export interface OutgoingHit {
  amount: number;
  crit: boolean;
  /** 属性の弱点 / 耐性に当たったか（素性なし・敵なしは neutral） */
  affinity: ElementAffinity;
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
  onBoonComboHit(state);
  pushComboEvent(state);
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
export function rollOutgoing(
  state: GameState,
  enemy: Enemy | null,
  base: number,
  kind: DamageKind,
  opts: OutgoingOptions = {},
): OutgoingHit {
  const s = state.stats;
  const p = state.player;
  let amount = base;
  if (kind === "melee") amount = (base + s.meleeDamageFlat) * s.meleeDamageMul;
  if (kind === "ranged") amount = (base + s.rangedDamageFlat) * s.rangedDamageMul;
  if (opts.skill) amount *= s.skillDamageMul;
  if (hasStatus(p.status, "weaken")) amount *= 1 - STATUS.weaken.mul;
  amount *= playerStatusOutgoingMul(state);
  // 霊体化（skills/forms.ts）はすり抜ける代わりに与ダメが落ちる。forms.ts を import すると循環の評価順が崩れるので state を直に見る
  if (state.skills.shape?.key === "wraithForm") amount *= WAVE3_SKILL_TUNING.wraithForm.outgoingMul;

  let crit = false;
  if (kind !== "proc") {
    if (enemy && isStaggered(enemy)) amount *= s.damageVsStaggeredMul;
    amount *= comboDamageMul(state);
    if (p.justTimer > 0) amount *= s.justDodgeDamageMul;
    if (p.buffs.damage.time > 0) amount *= p.buffs.damage.mul;
    crit = state.rng.chance(s.critChance) || boonForcesCrit(state, enemy, kind);
    if (crit) amount *= s.critMul;
  }
  amount *= berserkerMul(state);
  amount *= gamblerMul(state);
  // ks_bladeOath（近間の誓い）: 近接・射撃・スキルに効く。素性なしの proc は距離を測る意味が薄いので対象外
  if (kind !== "proc" || opts.skill) amount *= bladeOathMul(state, enemy);
  amount *= traitOutgoingMul(state, enemy, kind, opts.skill === true);
  const element = enemy ? genreAndElement(state, enemy, kind, opts) : null;
  if (element) amount *= element.mul;
  return { amount: Math.max(MIN_DAMAGE, Math.round(amount)), crit, affinity: element?.affinity ?? "neutral" };
}

/** A-8: 敵の防御（質軸）と属性耐性の倍率。弱点 / 耐性の表示と、属性が呼ぶ状態異常の抽選もここで起こす */
function genreAndElement(state: GameState, enemy: Enemy, kind: DamageKind, opts: OutgoingOptions): OutgoingElement | null {
  const skill = opts.skill === true;
  const atk = resolveAttack(state.stats, kind, skill, opts.attack);
  if (!atk) return null;
  const out = outgoingElement(state.stats, enemy, atk, skill);
  out.mul *= traitElementMul(state, enemy, out, kind);
  showAffinity(state, enemy, out.affinity);
  rollElementAffinity(state, enemy, out.shares);
  return out;
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
  const kind = opts.kind ?? "proc";
  const poise = boonPoise(state, enemy, kind, opts.poise ?? 0) * traitPoiseMul(state, enemy, kind, opts.crit === true);
  const intercepted = interceptEnemyDamage(state, enemy, amount, knockDir, kind, opts.guardBreak, poise);
  if (intercepted <= 0) return false;
  // 凍結中の被弾は「砕き」。継続ダメージ（silent）では砕けない
  const shatter = !opts.silent && hasStatus(enemy.status, "freeze");
  amount = takenDamage(enemy, intercepted, shatter, enemyStatusTakenMul(state, enemy));
  amount = pacifistMercyClamp(state, enemy, amount);
  const def = enemyDef(enemy.defKey);
  enemy.hp -= amount;
  if (shatter) shatterFreeze(state, enemy);
  const shatterPoise = shatter ? STATUS.freeze.shatterPoise : 0;
  const heavy = addPoise(state, enemy, poise + shatterPoise, { ignoreSuperArmor: opts.ignoreSuperArmor, canExecute: true });
  if (heavy) onTraitStagger(state, enemy);

  const dir = normalize(knockDir);
  if (!opts.silent) {
    enemy.hitFlash = ENEMY_HIT_FLASH;
    // 怯んでいない敵は押し出しすぎない（殴っても射程外へ逃げない）
    const knockMul = isStaggered(enemy) ? 1 : POISE.knockbackUnstaggered;
    if (knockForce > 0) enemy.knock = scale(dir, knockForce * knockMul);
    registerComboHit(state);
    showHit(state, enemy, amount, dir, def.color, opts, heavy);
    onHitFx(state, enemy, opts);
  }
  if (opts.silent) noteDotDamage(state, enemy, amount);

  if (opts.buildsEnergy) gainEnergy(state, PLAYER.energyPerHit);
  if (kind === "melee") {
    pushSfx(state, heavy ? "hitHeavy" : "hit");
    // 命中の低域のドン（docs/ideas/combat-feel-design.md D-5）。重撃は hitHeavy が既に低域を持つ
    if (!heavy) pushSfx(state, "hitThump");
  }
  if (kind === "ranged") pushSfx(state, "bulletHit");
  if (kind === "melee" && !opts.silent) applyRegain(state);
  if (kind !== "proc") {
    applyLifeOnHit(state, amount);
    applyOnHitStatus(state, enemy, { kind, skill: opts.skill, crit: opts.crit });
    onTraitHit(state, enemy, kind, opts.skill === true);
  }

  if (opts.crit) onBoonCrit(state, enemy, amount);
  if (kind !== "proc" || opts.skill) pushHitEvents(state, enemy, kind, opts.skill === true, opts.crit === true, amount);
  if (enemy.hp > 0) return false;
  spawnDeathFx(state, enemy, opts);
  killEnemy(state, enemy, dir);
  return true;
}

/** 受ける側の倍率: 脆弱・砕き・ボスのダウン中 */
function takenDamage(enemy: Enemy, amount: number, shatter: boolean, statusMul = 1): number {
  let mul = statusMul;
  if (hasStatus(enemy.status, "vulnerable")) mul *= STATUS.vulnerable.mul;
  if (shatter) mul *= STATUS.freeze.shatterDamageMul;
  if (isBossClass(enemyDef(enemy.defKey)) && isStaggered(enemy)) mul *= POISE.bossDownDamageMul;
  if (mul === 1) return amount;
  return Math.max(MIN_DAMAGE, Math.round(amount * mul));
}

/**
 * ks_pacifist（不殺）: 怯んでいない敵の生命を pacifistMercyHp 未満にしない。
 * 怯み値を持たない敵（怯まない敵）は対象外にして詰みを防ぐ。怯み中なら通常どおり倒しきれる
 */
export function pacifistMercyClamp(state: GameState, enemy: Enemy, amount: number): number {
  if (!hasKeystone(state, KS.pacifist) || enemy.poise.max <= 0 || isStaggered(enemy)) return amount;
  const room = enemy.hp - KEYSTONE.pacifistMercyHp;
  return Math.max(0, Math.min(amount, room));
}

/** 砕き: 凍結を解き（冷気免疫が付く）、氷の破片を散らす */
function shatterFreeze(state: GameState, enemy: Enemy): void {
  removeStatus(state, { kind: "enemy", enemy }, "freeze");
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 8 }, SHATTER_TEXT, STATUS.chillColor, 1.2, 0.6);
  spawnBurst(state, enemy.body.pos, STATUS.chillColor, SHATTER_PARTICLES, 140, 0.4, 2);
  pushSfx(state, "freeze");
  onBoonShatter(state, enemy);
  pushShatterEvent(state, enemy);
}

/** heavy = この一撃で怯んだ。数字・粒子・揺れを大きくし、ヒットストップも重くする */
function showHit(state: GameState, enemy: Enemy, amount: number, dir: Vec, color: string, opts: HitOptions, heavy: boolean): void {
  const baseScale = heavy ? HEAVY_TEXT_SCALE : 1;
  const textScale = opts.crit ? Math.max(baseScale, PLAYER.critTextScale) : baseScale;
  const textColor = opts.crit ? PLAYER.critColor : COLOR_DAMAGE;
  const comboText = comboDamageText(state.combo.count, textColor, textScale, opts.crit === true);
  const textKind = damageTextKind(state, enemy, opts);
  const look = damageTextLook(textKind, comboText);
  addFloatingText(state, enemy.body.pos, String(amount), look.color, look.scale, undefined, textKind);
  spawnDirectional(state, enemy.body.pos, dir, color, heavy ? HEAVY_PARTICLES : LIGHT_PARTICLES, 140);
  const base = opts.hitstopSteps ?? FEEL.hitstopLight;
  let steps = (heavy ? Math.max(base, FEEL.hitstopHeavy) : base) + (opts.crit ? PLAYER.critHitstopBonus : 0);
  // 武器種の最終段・フィニッシュ派生の命中は、他の値より軽ければ底上げする（docs/ideas/combat-feel-design.md D-2）
  if (opts.finisher) steps = Math.max(steps, FEEL.hitstopFinisher);
  hitstop(state, steps);
  shake(state, heavy ? FEEL.shakeHeavy : FEEL.shakeLight);
  // 重撃は攻撃方向へカメラを押す（docs/ideas/combat-feel-design.md D-3）
  if (heavy) cameraKick(state, dir, FEEL.kickHeavy);
}

/** 必殺ゲージを増やす（energyGainMul 込み） */
export function gainEnergy(state: GameState, amount: number): void {
  const p = state.player;
  p.energy = Math.min(p.maxEnergy, p.energy + amount * state.stats.energyGainMul);
}

function killEnemy(state: GameState, enemy: Enemy, dir: Vec): void {
  const def = enemyDef(enemy.defKey);
  // 鐘の蘇生体は撃破数・ドロップ・来歴の撃破に数えない（蘇生と撃破を繰り返して稼がせない）
  const counted = enemy.revived !== true;
  if (counted) state.kills += 1;
  const gained = Math.round(def.score * comboMultiplier(state.combo.count));
  state.score += gained;
  spawnBurst(state, enemy.body.pos, def.color, 18, 160, 0.5, 2.5);
  spawnBurst(state, enemy.body.pos, "#ffffff", 6, 90, 0.25, 1.5);
  // 攻撃方向へ飛ぶ破片（docs/ideas/combat-feel-design.md D-5）
  spawnDirectional(state, enemy.body.pos, dir, def.color, KILL_DIRECTIONAL_PARTICLES, KILL_DIRECTIONAL_SPEED);
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 6 }, `+${gained}`, "#ffd75f", 1.1, 0.8);
  hitstop(state, FEEL.hitstopKill);
  shake(state, FEEL.shakeHeavy);
  cameraKick(state, dir, FEEL.kickHeavy);
  pushSfx(state, "kill");

  applyLifeOnKill(state);
  gainMana(state, MANA.onKill + state.stats.manaOnKill);
  if (counted) rollEnemyDrop(state, enemy);
  explodeOnKill(state, enemy);
  fireTrigger(state, "onKill", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  pushKillEvents(state, enemy);
  onBoonKill(state, enemy);
  onTraitKill(state, enemy);
  if (counted) recordProvenance(state, { kind: "kill", enemyKey: enemy.defKey, boss: def.boss === true });
  if (isLastKillInEngagedRoom(state, enemy)) lastKillFx(state, enemy);
}

/**
 * 交戦中（封鎖中・開放型の交戦中）の部屋で、この敵が最後の 1 体か（challenge は最終波のみ）。
 * 倒した瞬間は hp <= 0 なので「生きた敵が残る」ではなく部屋の交戦状態（roomInCombat）で見る
 */
export function isLastKillInEngagedRoom(state: GameState, enemy: Enemy): boolean {
  const room = state.rooms[enemy.roomIndex];
  if (!room || !roomInCombat(room)) return false;
  if (room.kind === "challenge" && room.wave < ROOM_KIND.challengeWaves) return false;
  return !state.enemies.some((e) => e !== enemy && e.hp > 0 && e.roomIndex === enemy.roomIndex);
}

/** ラストキル・スロー: スロー + 強いフラッシュ + 大きな CLEAR */
function lastKillFx(state: GameState, enemy: Enemy): void {
  const c = ACTION.lastKill;
  state.slowmo = Math.max(state.slowmo, c.slowmo);
  state.flash = Math.max(state.flash, c.flash);
  const pos = { x: enemy.body.pos.x, y: enemy.body.pos.y - c.textOffsetY };
  addFloatingText(state, pos, c.text, c.color, c.textScale, c.textLife);
  spawnRing(state, enemy.body.pos, c.ringRadius, c.color, c.ringLife);
  spawnBurst(state, enemy.body.pos, c.color, c.particles, 220, 0.6, 2.5);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "lastKill");
}

/** リゲイン: 被弾の猶予中なら近接ヒットで取り戻せる分を回復する */
function applyRegain(state: GameState): void {
  const p = state.player;
  if (p.regainTimer <= 0 || p.regainPool <= 0) return;
  const amount = Math.min(p.regainStep, p.regainPool);
  p.regainPool -= amount;
  healPlayer(state, amount, { silent: true });
  // 満タンになったら取り戻す分は残さない
  p.regainPool = Math.min(p.regainPool, p.maxHp - p.hp);
  spawnBurst(state, p.body.pos, ACTION.regain.color, ACTION.regain.particles, 60, 0.35, 1.5);
}

/** 被弾で取り戻せる分を積む。猶予中の追加被弾はプールに足し、猶予を延ばす */
function addRegain(state: GameState, taken: number): void {
  const p = state.player;
  const r = ACTION.regain;
  const wasActive = p.regainTimer > 0 && p.regainPool > 0;
  p.regainPool = (wasActive ? p.regainPool : 0) + taken * r.poolRatio;
  p.regainStep = (wasActive ? p.regainStep : 0) + taken * r.perHitRatio;
  p.regainTimer = r.window;
}

/** リゲインの猶予を進める。切れたら取り戻せる分は消える */
export function tickRegain(state: GameState, dt: number): void {
  const p = state.player;
  if (p.regainTimer <= 0) return;
  p.regainTimer = Math.max(0, p.regainTimer - dt);
  if (p.regainTimer > 0) return;
  p.regainPool = 0;
  p.regainStep = 0;
}

/**
 * 命中時の回復: 与ダメージ（dealt）の stats.lifeOnHit %。
 * 多段ヒットで回復し放題にならないよう、戦闘中の回復の共通上限（healSustained）を通す
 */
function applyLifeOnHit(state: GameState, dealt: number): void {
  const pct = state.stats.lifeOnHit;
  if (pct <= 0 || dealt <= 0) return;
  healSustained(state, (dealt * pct) / PERCENT, { silent: true });
}

/** 撃破時の回復: コンボが HEAL.killHealMinCombo 以上のときだけ（雑に 1 体倒すだけでは戻らない） */
function applyLifeOnKill(state: GameState): void {
  const amount = state.stats.lifeOnKill;
  if (amount <= 0 || state.combo.count < HEAL.killHealMinCombo) return;
  healSustained(state, amount);
}

/**
 * 戦闘中の回復（命中時・撃破時・祝福の撃破回復など）。HEAL.sustainWindow 秒ごとに
 * 最大 HP の HEAL.sustainCapRatio までしか戻らない。窓の残り時間は player.ts の tickTimers が進める
 * （state の lifeOnHitWindow を共通の窓として使う）。実際に回復した量を返す
 */
export function healSustained(state: GameState, amount: number, opts: HealOptions = {}): number {
  if (amount <= 0 || state.status !== "playing") return 0;
  const p = state.player;
  const w = p.lifeOnHitWindow;
  if (w.timer <= 0) {
    w.timer = HEAL.sustainWindow;
    w.healed = 0;
  }
  const cap = p.maxHp * HEAL.sustainCapRatio;
  const actual = Math.min(amount, Math.max(0, cap - w.healed));
  if (actual <= 0) return 0;
  w.healed += actual;
  return healPlayer(state, actual, opts);
}

/** 生きた敵（と死神）が radius 内にいるか。HP 自然回復を止める判定 */
export function enemyNearPlayer(state: GameState, radius: number): boolean {
  const pos = state.player.body.pos;
  const r2 = radius * radius;
  const near = (x: number, y: number): boolean => (x - pos.x) ** 2 + (y - pos.y) ** 2 <= r2;
  if (state.reaper && near(state.reaper.pos.x, state.reaper.pos.y)) return true;
  return state.enemies.some((e) => e.hp > 0 && near(e.body.pos.x, e.body.pos.y));
}

/**
 * 戦闘中か: 封鎖中の部屋がある、または MANA.combatRadius 内に生きた敵（死神を含む）がいる。
 * マナの自然回復（mana.ts の tickMana）と同じ判定。開放型マップでは封鎖がほぼ無いので距離で見る
 */
export function inCombat(state: GameState): boolean {
  return state.rooms.some((r) => r.locked) || enemyNearPlayer(state, MANA.combatRadius);
}

/** HP 自然回復が働くか: 誓約で禁じられておらず、戦闘中でない */
export function hpRegenAllowed(state: GameState): boolean {
  return regenAllowed(state) && !inCombat(state);
}

/** HP 自然回復を 1 ステップ進める（player.ts の tickTimers から呼ぶ） */
export function tickHpRegen(state: GameState, dt: number): void {
  const regen = state.stats.hpRegen;
  if (regen <= 0 || !hpRegenAllowed(state)) return;
  healPlayer(state, regen * dt, { silent: true });
}

export type PlayerHitResult = "hit" | "dodged" | "ignored";

export interface DamagePlayerOptions {
  /** true なら無敵中でも JUST 回避（スロー・ゲージ）を発生させない。単に "ignored" 扱い（Reaper の常時接触が稼ぎ場にならないように） */
  noJust?: boolean;
}

/** armor の被ダメ軽減率（PoE 風の逓減式）。0..ARMOR_MAX_REDUCTION */
export function armorReduction(armor: number): number {
  return defenseReduction(armor);
}

/** 被ダメ計算: 攻撃の質で防御 / 魔防を選び、属性耐性を掛けてから damageTakenMul。最低 1（docs/COMBAT_DESIGN.md A-8） */
export function mitigate(state: GameState, amount: number, attack: AttackProfile | null = null): number {
  const s = state.stats;
  const reduced = amount * playerMitigationMul(s, attack);
  return Math.max(MIN_PLAYER_DAMAGE, Math.round(reduced * s.damageTakenMul));
}

/** プレイヤーへのダメージ。無敵中はジャスト回避判定だけ行う。attacker は thorns の反射先 */
export function damagePlayer(
  state: GameState,
  amount: number,
  fromPos: Vec,
  attacker?: Enemy,
  opts: DamagePlayerOptions = {},
): PlayerHitResult {
  const p = state.player;
  if (state.status !== "playing") return "ignored";
  if (p.invulnTimer > 0 || p.buffs.invuln > 0) {
    if (!opts.noJust && (p.dashTimer > 0 || boonJustEligible(state)) && !p.dodgedThisDash) {
      justDodge(state, attacker);
      return "dodged";
    }
    return "ignored";
  }
  // 右クリックの固有技: 受け流しの窓は無効化、盾の構えは前からの被ダメを減らす（system/weaponArts.ts）
  if (tryParry(state, attacker)) return "ignored";

  const raw = amount * playerTakenMul(state) * enemyDamageMul(attacker) * traitIncomingMul(state, attacker) * guardDamageMul(state, fromPos);
  const taken = mitigate(state, raw, enemyAttackOf(attacker));
  p.hp = Math.max(0, p.hp - taken);
  addRegain(state, taken);
  onPlayerHurtStatus(state);
  recordProvenance(state, { kind: "hurt" });
  p.invulnTimer = PLAYER.hurtInvuln;
  p.hitFlash = PLAYER_HIT_FLASH;
  const away = normalize(sub(p.body.pos, fromPos));
  // 鉄塊化（skills/forms.ts）は押されず、振りも止まらない
  const braced = state.skills.shape?.key === "ironForm";
  if (!braced && !hasKeystone(state, KS.juggernaut)) p.knock = scale(away, PLAYER.hurtKnockback);
  if (!braced) cancelAttack(state);
  state.combo.count = comboAfterHurt(state);
  if (state.combo.count === 0) state.combo.timer = 0;

  addFloatingText(state, p.body.pos, `-${taken}`, COLOR_HURT, 1.3);
  spawnBurst(state, p.body.pos, COLOR_HURT, 12, 150, 0.4, 2);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeHurt);
  state.flash = Math.max(state.flash, 0.35);

  if (p.hp <= 0 && !tryRevive(state)) {
    killPlayer(state);
    return "hit";
  }
  pushSfx(state, "hurt");
  reflectThorns(state, attacker);
  fireTrigger(state, "onHurt", { pos: { ...p.body.pos }, targetId: attacker?.id });
  pushEvent(state, { kind: "onHurt", actor: "enemy", pos: { ...p.body.pos }, targetId: attacker?.id, sourceId: attacker?.id, source: { kind: "enemy", key: attacker?.defKey ?? "" } });
  return "hit";
}

/** プレイヤーが受けるダメージの倍率（脆弱） */
function playerTakenMul(state: GameState): number {
  return (hasStatus(state.player.status, "vulnerable") ? STATUS.vulnerable.mul : 1) * playerStatusTakenMul(state);
}

/**
 * 状態異常の継続ダメージ（燃焼・毒・出血・蒸発）。無敵・ノックバック・コンボ切れ・リゲインを起こさない。
 * 0 になったら再起を試し、だめなら倒れる
 */
export function damagePlayerDot(state: GameState, amount: number): void {
  const p = state.player;
  if (state.status !== "playing" || amount <= 0) return;
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp > 0 || tryRevive(state)) return;
  killPlayer(state);
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
  // 拠点では倒れない（ラン記録も書かない）。満タンに戻して続ける
  if (state.sandbox) {
    p.hp = p.maxHp;
    return;
  }
  state.status = "dead";
  state.deathTimer = 0;
  spawnBurst(state, p.body.pos, "#ffffff", 40, 220, 0.9, 3);
  state.slowmo = DEATH_SLOWMO;
  pushSfx(state, "death");
  pushLog(state, `力尽きた（地下${state.depth}階）。`, COLOR_HURT);
  recordRunOnce(state);
}

/**
 * ラン結果をプロフィールに記録して保存する（1 ランにつき 1 回）。
 * runs は createGame で既に数えているので recordRun による加算は打ち消す
 */
export function recordRunOnce(state: GameState): void {
  if (state.sandbox || state.runRecorded) return;
  state.runRecorded = true;
  const profile = state.profile;
  const runsBefore = profile.meta.runs;
  recordRun(profile, { depth: state.depth, kills: state.kills, score: state.score });
  profile.meta.runs = runsBefore;
  saveProfile(profile);
}

function justDodge(state: GameState, attacker: Enemy | undefined): void {
  const p = state.player;
  p.dodgedThisDash = true;
  p.justTimer = state.stats.justDodgeWindow;
  // 直後に攻撃を押すと回避した敵へ瞬間移動斬り（player.ts の tryJustCounter）
  p.justCounterTimer = ACTION.justCounter.window;
  p.justCounterTargetId = attacker && attacker.hp > 0 ? attacker.id : null;
  state.slowmo = Math.max(state.slowmo, FEEL.justDodgeSlowmo);
  gainEnergy(state, PLAYER.energyPerHit * JUST_ENERGY_HITS);
  gainMana(state, MANA.onJust);
  registerComboHit(state);
  addFloatingText(state, p.body.pos, "見切り！", COLOR_JUST, 1.5, 0.7);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  justFx(state);
  state.flash = Math.max(state.flash, 0.2);
  pushSfx(state, "just");
  onBoonJust(state);
  fireTrigger(state, "onJustDodge", { pos: { ...p.body.pos } });
  pushPlayerEvent(state, "onJustDodge", "just", { sourceId: attacker?.id });
  recordProvenance(state, { kind: "just" });
}

export function cancelAttack(state: GameState): void {
  const p = state.player;
  p.dashAttackQueued = false;
  p.dashStrike = false;
  const a = p.attack;
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
