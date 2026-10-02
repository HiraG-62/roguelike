import { type DamageKind, type Enemy, type GameState, type VaultKind, pushLog, pushSfx } from "../core/state";
import { type Vec, normalize, scale, sub } from "../core/vec";
import { formatAmount } from "../core/units";
import type { HurtCause } from "../core/hurt";
import { noteHurt } from "./deathCause";
import { enemyDef, isBossClass } from "../data/enemies";
import { behaviorOf } from "./behaviors/registry";
import { ACTION, BOON_LINEAGE, ENERGY, FEEL, HEAL, KEYSTONE, MANA, PLAYER, POISE, ROOM_KIND, STATUS } from "../data/tuning";
import { recordRun, saveProfile } from "../loot/profile";
import { recordProvenance } from "../loot/provenance";
import { addFloatingText, hitstop, shake, spawnBurst, spawnDirectional, spawnRing, addHeadLabel } from "./effects";
import { comboDamageText, damageTextKind, damageTextLook, justFx, noteDotDamage, onHitFx, spawnDeathFx } from "./effects";
import { type HitFamily, type HitWeight, hitSfxName, skipsThump } from "./effects";
import { cameraKick } from "./camera";
import { roomInCombat } from "./engagement";
import { emitNoise } from "./noise";
import { KS, hasKeystone, healMul, regenAllowed } from "./keystones";
import { rollEnemyDrop } from "./loot";
import { applyOnHitStatus, enemyDamageMul, explodeOnKill, findStatus, hasStatus, removeStatus } from "./statusEffects";
import { enemyStatusTakenMul, onPlayerHurtStatus, playerStatusTakenMul } from "./statusEffects";
import { isAllied } from "./rules";
import { addPoise, isStaggered } from "./poise";
import { gainMana } from "./mana";
import { isStrike, shieldsMerchant } from "./merchantAi";
import { fireTrigger } from "./triggers";
import { pushComboEvent, pushEvent, pushHitEvents, pushKillEvents, pushPlayerEvent, pushShatterEvent } from "../core/events";
import { onTraitHit, onTraitKill, onTraitStagger, traitElementMul, traitIncomingMul, traitPoiseMul } from "./traitHooks";
import { relicDeferDelay, relicForgiveOnKill, relicIncomingMul, relicPayWithCoins, relicRevive } from "./namedRelics";
import { buildContext, collectMore, collectTraitIncreased, finishBreakdown, increasedFactor, poiseIncreasedMul } from "./damageMods";
import type { DamageBreakdown } from "../core/damage";
import { interceptEnemyDamage } from "./elites";
import { boonJustEligible, comboAfterHurt, hasBoon, onBoonKill } from "./boons";
import { MOON_REPRIEVE_KEY, MOON_TOTALITY_KEY } from "./boonDefs/moon";
import { BOONS } from "./boonDefs";
import { guardDamageMul, tryParry } from "./weaponArts";
import type { AttackProfile } from "../core/element";
import { type ElementAffinity, type OutgoingElement, defenseReduction, enemyAttackOf, outgoingElement, playerMitigationMul, resolveAttack, rollElementAffinity, showAffinity } from "./elementCombat";
import { wardIncomingMul } from "./dashForms";
import { noteUltimateKill, ultimateBlocksEnergy, ultimateIncomingMul } from "./ultimates";
import type { ButtonKey, MovesetKey } from "../data/weapons";
import { chargeArmorOf } from "./morale";
import { noteHitMoments, noteRiposte } from "./moments";
import { noteBraceBlockMana, noteHitMana } from "./manaSources";
import { shareLinkedDamage } from "./formMarks";
import { dropCoins, spillCoins } from "./economy";
import { containerBroken } from "./containers";
import { bossOnAnswer } from "./boss";
import { noteBossFightHit } from "./bossRecord";

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
/** 怯ませた一撃の演出（数字の大きさ・粒子数） */
const HEAVY_TEXT_SCALE = 1.4;
const HEAVY_PARTICLES = 10;
const LIGHT_PARTICLES = 5;
const SHATTER_TEXT = "砕き";
/** 氷獄の溜めの種類 */
const ICE_VAULT: VaultKind = "ice";
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
  /** この命中で溜まる奥義ゲージ（近接は meleeHitEnergy、射撃は弾の Projectile.energy。省略は溜めない） */
  energy?: number;
  /** 既定は proc（on-hit 効果なし） */
  kind?: DamageKind;
  crit?: boolean;
  /** burn tick など: 数字・ヒットストップ・揺れ・コンボ加算なし */
  silent?: boolean;
  /** カウンターヒット / JUST カウンター: knight の盾を無視して通す（GUARD BREAK） */
  guardBreak?: boolean;
  /**
   * 出端の命中（system/readTiming.ts の yellowAt）。怯み値は溜め、墨入れに入っていて溢れても墨入れの攻撃は止めず技の後へ先送りする
   * （PoiseHitOptions.readStart）。重い得物の出端でも「下絵は打って止められる」を残しつつ、墨入れを止めるのは受け流しだけの約束を守る
   */
  readStart?: boolean;
  /** 出端の止め（FEEL.hitstopCounter）を入れる。通常命中の上限の例外。多段の 2 発目以降には付けない */
  counterStop?: boolean;
  /** 武器種の最終段・フィニッシュ派生の命中（docs/ideas/combat-feel-design.md D-2）。showHit のヒットストップに反映 */
  finisher?: boolean;
  /**
   * 命中音の質感（system/effects.ts の hitSfxName）。近接は武器種の系統 × 段の重さ、未指定は従来の hit / hitHeavy。
   * 射撃は weight: "heavy" のときだけ bulletHitHeavy に差し替える（family は使わない）
   */
  impact?: { family: HitFamily; weight: HitWeight; weapon?: MovesetKey };
  /** 終撃のヒットストップの底上げ（武器の重さの hitstopFinisher。省略は FEEL.hitstopFinisher） */
  finisherHitstop?: number;
  /** 戦意を使った放出の一撃（system/morale.ts。onFinisher の tag） */
  release?: boolean;
  /** 当てたレーン（双撃の判定。近接の振り・レーンの弾だけ。system/moments.ts） */
  lane?: ButtonKey;
  /** 墨印を記す弾（書の左の字）の命中。記すだけで、この命中では墨印を読まない */
  inscribes?: boolean;
}

/** rollOutgoing の追加指定。skill はスキル由来（スキルの増 increased.skill が足される） */
export interface OutgoingOptions {
  skill?: boolean;
  /**
   * 攻撃ジャンルと属性（docs/COMBAT_DESIGN.md A-8）。省略時は近接 = 武器種、射撃 = 銃の弾、スキル = 無属性の物理、
   * proc = 素性なし（防御・耐性を掛けない）。null を渡すと素性なし
   */
  attack?: AttackProfile | null;
  /** 放出の一撃（与ダメのタグ release が付く） */
  release?: boolean;
  /** 必ず会心にする（長銃の満ちた 1 発）。会心の乱数は従来どおり引く */
  forceCrit?: boolean;
  /** 出端の一撃（与ダメのタグ counter が付く） */
  counter?: boolean;
}

export interface OutgoingHit {
  amount: number;
  crit: boolean;
  /** 属性の弱点 / 耐性に当たったか（素性なし・敵なしは neutral） */
  affinity: ElementAffinity;
  /** 増・倍・敵側の内訳（表示・テスト・QA 用） */
  breakdown: DamageBreakdown;
}

/** コンボ数からスコア倍率。5 ヒットごとに +0.5 */
export function comboMultiplier(count: number): number {
  return 1 + Math.floor(count / COMBO_SCORE_STEP) * COMBO_SCORE_BONUS;
}

export function registerComboHit(state: GameState): void {
  if (hasKeystone(state, KS.mushin)) return;
  state.combo.count += 1;
  state.combo.timer = FEEL.comboWindow + state.stats.comboWindowBonus;
  state.combo.popTimer = COMBO_POP_TIME;
  state.combo.best = Math.max(state.combo.best, state.combo.count);
  pushComboEvent(state);
}

/**
 * プレイヤー由来の与ダメを増と倍で仕上げる（docs/ideas/scaling-impl.md 2-1。集め方は system/damageMods.ts）。
 * base は tuning の基礎値（melee / ranged は flat をここで足す）。
 * 乱数の順は従来と同じ: 会心 → 賭博師 → 属性の抽選
 */
export function rollOutgoing(
  state: GameState,
  enemy: Enemy | null,
  base: number,
  kind: DamageKind,
  opts: OutgoingOptions = {},
): OutgoingHit {
  const s = state.stats;
  const skill = opts.skill === true;
  let raw = base;
  if (kind === "melee") raw = base + s.meleeDamageFlat;
  if (kind === "ranged") raw = base + s.rangedDamageFlat;
  const ctx = buildContext(enemy, kind, opts);
  const { more, crit } = collectMore(state, enemy, ctx, skill, opts.forceCrit === true);
  ctx.crit = crit;
  // 性質の加算は敵の状態を読むので、状態異常を付けうる属性の抽選より前に数える
  const trait = collectTraitIncreased(state, enemy, ctx, skill);
  const element = enemy ? genreAndElement(state, enemy, kind, opts) : null;
  const shares = element?.shares ?? [];
  const breakdown = finishBreakdown(raw, increasedFactor(state, ctx, trait, shares), more, element?.mul ?? 1, MIN_DAMAGE);
  return { amount: breakdown.amount, crit, affinity: element?.affinity ?? "neutral", breakdown };
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
  // 従魔（眷属の Rule 効果 tameEnemy）はプレイヤーの攻撃でも巻き添えでも傷つかない
  if (enemy.hp <= 0 || isAllied(state, enemy)) return false;
  const kind = opts.kind ?? "proc";
  // 怒っていない商人: 巻き添え・交戦中の一撃は受け止め、平時の 1 発目は警告だけ（system/merchantAi.ts）
  if (shieldsMerchant(state, enemy, isStrike(kind, opts.silent))) return false;
  const poise = (opts.poise ?? 0) * traitPoiseMul(state, enemy, kind, opts.crit === true) * poiseIncreasedMul(state, enemy);
  const intercepted = interceptEnemyDamage(state, enemy, amount, knockDir, kind, opts.guardBreak, poise);
  if (intercepted <= 0) return false;
  // 凍結中の被弾は「砕き」。継続ダメージ（silent）では砕けない
  const shatter = !opts.silent && hasStatus(enemy.status, "freeze");
  amount = takenDamage(enemy, intercepted, shatter, enemyStatusTakenMul(state, enemy));
  amount = pacifistMercyClamp(state, enemy, amount);
  const def = enemyDef(enemy.defKey);
  enemy.hp -= amount;
  // 砕きで凍結が消える前に積む（砕く一撃そのものも溜めに入る）
  stashFrozenDamage(state, enemy, amount);
  if (shatter) shatterFreeze(state, enemy);
  const shatterPoise = shatter ? STATUS.freeze.shatterPoise : 0;
  const heavy = addPoise(state, enemy, poise + shatterPoise, { ignoreSuperArmor: opts.ignoreSuperArmor, canExecute: true, readStart: opts.readStart });
  if (heavy) onTraitStagger(state, enemy);
  // 反応ルール（間合い取り）。怯み値を入れた後に呼ぶので、この一撃で怯んだ敵は動かさない
  if (!opts.silent && kind !== "proc") behaviorOf(def).onStruck(state, enemy, def);

  const dir = normalize(knockDir);
  if (!opts.silent) {
    enemy.hitFlash = ENEMY_HIT_FLASH;
    // 怯んでいない敵は押し出しすぎない（殴っても射程外へ逃げない）
    const knockMul = isStaggered(enemy) ? 1 : POISE.knockbackUnstaggered;
    if (knockForce > 0) enemy.knock = scale(dir, knockForce * knockMul);
    // 壺・木箱を割ってもコンボは伸びない（割って回るだけでコンボを保てないように）
    if (def.container === undefined) registerComboHit(state);
    showHit(state, enemy, amount, dir, def.color, opts, heavy);
    onHitFx(state, enemy, opts);
  }
  if (opts.silent) noteDotDamage(state, enemy, amount);

  if (opts.energy !== undefined && opts.energy > 0) gainEnergy(state, opts.energy);
  if (kind === "melee") {
    pushSfx(state, opts.impact ? hitSfxName(opts.impact.family, opts.impact.weight, opts.impact.weapon) : heavy ? "hitHeavy" : "hit");
    // 命中の低域のドン（docs/ideas/combat-feel-design.md D-5）。重撃は hitHeavy / 重い impact が既に低域を持つ。
    // 刃・鞭打は高域の「ザシュッ」「ピシッ」が主役で、ドンを重ねると埋もれて鈍い音にしか聞こえないので重ねない
    if (!heavy && !skipsThump(opts.impact?.family)) pushSfx(state, "hitThump");
  }
  if (kind === "ranged") pushSfx(state, opts.impact?.weight === "heavy" ? "bulletHitHeavy" : "bulletHit");
  if (!opts.silent && (kind === "melee" || kind === "ranged")) emitNoise(state, enemy.body.pos, "hit");
  if (kind === "melee" && !opts.silent) applyRegain(state);
  if (kind !== "proc") {
    applyLifeOnHit(state, amount);
    applyOnHitStatus(state, enemy, { kind, skill: opts.skill, crit: opts.crit, inscribes: opts.inscribes });
    onTraitHit(state, enemy, kind, opts.skill === true);
  }

  if (kind !== "proc" || opts.skill) pushHitEvents(state, enemy, kind, opts.skill === true, opts.crit === true, amount);
  noteHitMoments(state, enemy, { kind, skill: opts.skill, silent: opts.silent, finisher: opts.finisher, release: opts.release, lane: opts.lane });
  // 流儀の気力の源: 背面の命中・遠い命中（system/manaSources.ts）
  noteHitMana(state, enemy, kind, opts.skill === true, opts.silent === true);
  // 一蓮托生: 鎖で繋いだ敵どうしで与ダメを分け合う（system/formMarks.ts）
  shareLinkedDamage(state, enemy, amount, kind, opts.silent === true);
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

/**
 * 氷獄（docs/ideas/boon-impl.md 2-6）: 凍った敵に与えた傷を Enemy.vault（ice）に写して溜める（与えた傷はそのまま入る）。
 * 溜めを出す Rule（releaseVault ice）を持つときだけ積み、砕きの Rule が一度に出す。別の種類の溜めがある敵には積まない
 */
function stashFrozenDamage(state: GameState, enemy: Enemy, amount: number): void {
  if (amount <= 0 || !hasStatus(enemy.status, "freeze")) return;
  if (enemy.vault !== undefined && enemy.vault.kind !== ICE_VAULT) return;
  if (!holdsVaultRelease(state, ICE_VAULT)) return;
  enemy.vault = { kind: ICE_VAULT, amount: (enemy.vault?.amount ?? 0) + amount };
}

/** 持っている祝福のどれかが、その種類の溜めを出す Rule（releaseVault）を持つか */
function holdsVaultRelease(state: GameState, kind: VaultKind): boolean {
  return state.boons.some((key) => (BOONS[key].rules ?? []).some((r) => r.then.kind === "releaseVault" && r.then.vault === kind));
}

/** 砕き: 凍結を解き（冷気免疫が付く）、氷の破片を散らす */
function shatterFreeze(state: GameState, enemy: Enemy): void {
  removeStatus(state, { kind: "enemy", enemy }, "freeze");
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 8 }, SHATTER_TEXT, STATUS.chillColor, 1.2, 0.6, "status");
  spawnBurst(state, enemy.body.pos, STATUS.chillColor, SHATTER_PARTICLES, 140, 0.4, 2);
  pushSfx(state, "freeze");
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
  addFloatingText(state, enemy.body.pos, formatAmount(amount), look.color, look.scale, undefined, textKind);
  spawnDirectional(state, enemy.body.pos, dir, color, heavy ? HEAVY_PARTICLES : LIGHT_PARTICLES, 140);
  const base = opts.hitstopSteps ?? FEEL.hitstopLight;
  let steps = (heavy ? Math.max(base, FEEL.hitstopHeavy) : base) + (opts.crit ? PLAYER.critHitstopBonus : 0);
  // 武器種の最終段・フィニッシュ派生の命中は、他の値より軽ければ底上げする（docs/ideas/combat-feel-design.md D-2）
  if (opts.finisher) steps = Math.max(steps, opts.finisherHitstop ?? FEEL.hitstopFinisher);
  // 通常命中は 1 か所で上限を掛ける（段の JSON の hitstop が 269 か所あるので個別には直さない）
  if (!heavy && !opts.finisher && !opts.crit) steps = Math.min(steps, FEEL.hitstopNormalMax);
  // 出端は読みの報酬なので上限の例外（止めの表: 出端 5）
  if (opts.counterStop === true) steps = Math.max(steps, FEEL.hitstopCounter);
  hitstop(state, steps);
  shake(state, heavy ? FEEL.shakeHeavy : FEEL.shakeLight);
  // 重撃は攻撃方向へカメラを押す（docs/ideas/combat-feel-design.md D-3）
  if (heavy) cameraKick(state, dir, FEEL.kickHeavy);
}

/**
 * 近接 1 命中で溜まる奥義ゲージ。「1 秒ぶんの振りで ENERGY.perSwingSec」を段の基礎秒（攻撃速度の倍率を掛ける前）と
 * 多段数で割り振る。速い武器ほど 1 命中が小さくなり、同じ時間殴れば武器種によらずほぼ同じだけ溜まる
 */
export function meleeHitEnergy(baseSec: number, hits: number): number {
  return clampEnergy((ENERGY.perSwingSec * baseSec) / Math.max(1, hits));
}

/** 射撃の弾 1 発が命中で溜める奥義ゲージ。射撃間隔の基礎秒を 1 回に出る弾数で割り、近接より rangedRatio だけ低くする */
export function shotHitEnergy(intervalSec: number, bullets: number): number {
  return clampEnergy((ENERGY.perSwingSec * ENERGY.rangedRatio * intervalSec) / Math.max(1, bullets));
}

function clampEnergy(v: number): number {
  return Math.min(ENERGY.maxPerHit, Math.max(ENERGY.minPerHit, v));
}

/** 必殺ゲージを増やす（energyGainMul 込み） */
export function gainEnergy(state: GameState, amount: number): void {
  const p = state.player;
  // 持続の奥義の最中は貯めない（殴り続けて終わらなくなるのを防ぐ）
  if (ultimateBlocksEnergy(state)) return;
  p.energy = Math.min(p.maxEnergy, p.energy + amount * state.stats.energyGainMul);
}

/** 撃破の止めを長くする節目: 精鋭・ボス・陣の大将・陣の最後の 1 体（普通の撃破は短く切って手数のテンポを守る） */
function killIsMark(state: GameState, enemy: Enemy, boss: boolean): boolean {
  if (boss || enemy.elite !== undefined) return true;
  if (enemy.jinId === undefined) return false;
  const jin = state.jins.find((j) => j.id === enemy.jinId);
  if (jin?.leaderId === enemy.id) return true;
  return !state.enemies.some((o) => o !== enemy && o.hp > 0 && o.jinId === enemy.jinId);
}

function killEnemy(state: GameState, enemy: Enemy, dir: Vec): void {
  const def = enemyDef(enemy.defKey);
  // 壺・木箱は撃破数・得点・コンボ・来歴・ドロップ抽選に数えず、銭と瓶だけ（system/containers.ts）
  if (def.container !== undefined) return containerBroken(state, enemy);
  // 鐘の蘇生体は撃破数・ドロップ・来歴の撃破に数えない（蘇生と撃破を繰り返して稼がせない）
  const counted = enemy.revived !== true;
  if (counted) state.kills += 1;
  noteUltimateKill(state);
  const gained = Math.round(def.score * comboMultiplier(state.combo.count));
  state.score += gained;
  spawnBurst(state, enemy.body.pos, def.color, 18, 160, 0.5, 2.5);
  spawnBurst(state, enemy.body.pos, "#ffffff", 6, 90, 0.25, 1.5);
  // 攻撃方向へ飛ぶ破片（docs/ideas/combat-feel-design.md D-5）
  spawnDirectional(state, enemy.body.pos, dir, def.color, KILL_DIRECTIONAL_PARTICLES, KILL_DIRECTIONAL_SPEED);
  hitstop(state, killIsMark(state, enemy, def.boss === true) ? FEEL.hitstopKillMark : FEEL.hitstopKill);
  shake(state, FEEL.shakeHeavy);
  cameraKick(state, dir, FEEL.kickHeavy);
  pushSfx(state, "kill");

  applyLifeOnKill(state);
  gainMana(state, MANA.onKill + state.stats.manaOnKill);
  if (counted) rollEnemyDrop(state, enemy);
  dropCoins(state, enemy);
  explodeOnKill(state, enemy);
  fireTrigger(state, "onKill", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  pushKillEvents(state, enemy);
  onBoonKill(state, enemy);
  onTraitKill(state, enemy);
  relicForgiveOnKill(state);
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
  addFloatingText(state, pos, c.text, c.color, c.textScale, c.textLife, "notice");
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
  // 壺・木箱は戦いの相手ではない（そばを通っただけで自然回復を止めない）
  return state.enemies.some((e) => e.hp > 0 && enemyDef(e.defKey).container === undefined && near(e.body.pos.x, e.body.pos.y));
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

/** parried = 受け流した（弾は消え、攻撃した敵は止まる。避けた dodged と同じく「当たり判定は済んだ」扱い） */
export type PlayerHitResult = "hit" | "dodged" | "ignored" | "parried";

export interface DamagePlayerOptions {
  /** true なら無敵中でも JUST 回避（スロー・ゲージ）を発生させない。単に "ignored" 扱い（Reaper の常時接触が稼ぎ場にならないように） */
  noJust?: boolean;
  /** 被弾の出どころ（死因の元。system/deathCause.ts）。省略は attacker から推定（いれば一撃、いなければ余波） */
  cause?: HurtCause;
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
    // 不退の構えで受けた量は盾持ちの気力の源（system/manaSources.ts）
    noteBraceBlockMana(state, amount);
    if (!opts.noJust && (p.dashTimer > 0 || boonJustEligible(state)) && !p.dodgedThisDash) {
      justDodge(state, attacker);
      if (attacker) bossOnAnswer(state, attacker, "just");
      return "dodged";
    }
    return "ignored";
  }
  // 受け流し（共通の窓と剣の右 1 段目の構え）は被弾を無効化、盾の構えは前からの被ダメを減らす（system/weaponArts.ts）
  if (tryParry(state, attacker, fromPos)) return "parried";

  // 重打の溜め中は堅く、押されない（docs/ideas/weapon-forms-impl.md 3-4）
  const chargeArmor = chargeArmorOf(state);
  const raw =
    amount *
    playerTakenMul(state) *
    enemyDamageMul(attacker) *
    traitIncomingMul(state, attacker) *
    relicIncomingMul(state) *
    guardDamageMul(state, fromPos, amount, attacker) *
    ultimateIncomingMul(state, fromPos) *
    // 護り足（巫女の流儀のダッシュ）の結界
    wardIncomingMul(state) *
    (chargeArmor?.damageTakenMul ?? 1);
  const taken = relicPayWithCoins(state, mitigate(state, raw, enemyAttackOf(attacker)));
  p.hp = Math.max(0, p.hp - takeNowOrDefer(state, taken));
  noteHurt(state, attacker, opts.cause);
  spillCoins(state, fromPos);
  addRegain(state, taken);
  onPlayerHurtStatus(state);
  recordProvenance(state, { kind: "hurt" });
  noteBossFightHit(state);
  p.invulnTimer = PLAYER.hurtInvuln;
  p.hitFlash = PLAYER_HIT_FLASH;
  const away = normalize(sub(p.body.pos, fromPos));
  // 鉄塊化（skills/forms.ts）は押されず、振りも止まらない
  const braced = state.skills.shape?.key === "ironForm";
  if (!braced && !chargeArmor?.noKnock && !(state.stats.traits.unmoving > 0)) p.knock = scale(away, PLAYER.hurtKnockback);
  if (!braced) cancelAttack(state);
  state.combo.count = comboAfterHurt(state);
  if (state.combo.count === 0) state.combo.timer = 0;

  addFloatingText(state, p.body.pos, `-${taken}`, COLOR_HURT, 1.3, undefined, "normal");
  spawnBurst(state, p.body.pos, COLOR_HURT, 12, 150, 0.4, 2);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeHurt);
  state.flash = Math.max(state.flash, 0.35);

  if (p.hp <= 0) {
    killPlayer(state);
    return "hit";
  }
  pushSfx(state, "hurt");
  if (chargeArmor) noteRiposte(state, "chargeEndure", attacker);
  reflectThorns(state, attacker);
  fireTrigger(state, "onHurt", { pos: { ...p.body.pos }, targetId: attacker?.id });
  pushEvent(state, { kind: "onHurt", actor: "enemy", pos: { ...p.body.pos }, targetId: attacker?.id, sourceId: attacker?.id, source: { kind: "enemy", key: attacker?.defKey ?? "" }, amount: taken });
  return "hit";
}

/** プレイヤーが受けるダメージの倍率（脆弱） */
function playerTakenMul(state: GameState): number {
  return (hasStatus(state.player.status, "vulnerable") ? STATUS.vulnerable.mul : 1) * playerStatusTakenMul(state);
}

/**
 * 状態異常の継続ダメージ（燃焼・毒・出血・蒸発）。無敵・ノックバック・コンボ切れ・リゲインを起こさない。
 * 0 になったら倒れる
 */
export function damagePlayerDot(state: GameState, amount: number, cause?: HurtCause): void {
  const p = state.player;
  if (state.status !== "playing" || amount <= 0) return;
  p.hp = Math.max(0, p.hp - amount);
  noteHurt(state, undefined, cause);
  if (p.hp > 0) return;
  killPlayer(state);
}

// -----------------------------------------------------------------------------
// 遅れて来る傷（月蝕の系譜。docs/ideas/boon-impl.md 2-6）
// -----------------------------------------------------------------------------

/** 遅れて来た傷の数字の大きさ（被弾の数字より少し小さく、別の出来事に見せる） */
const DEFERRED_TEXT_SCALE = 1.1;
/** 皆既の溜め（宣告） */
const DOOM_VAULT: VaultKind = "doom";

/** 執行猶予: 受けた傷を今は減らさず Player.deferredDamage へ回す（被弾の硬直・無敵・コンボ切れはその場で起きる）。今減らす量を返す */
function takeNowOrDefer(state: GameState, taken: number): number {
  const delay = hasBoon(state, MOON_REPRIEVE_KEY) ? BOON_LINEAGE.moon.moonReprieve.delay : relicDeferDelay(state);
  if (taken <= 0 || delay === undefined) return taken;
  const p = state.player;
  (p.deferredDamage ??= []).push({ amount: taken, due: state.time + delay });
  return 0;
}

/** 毎ステップ（player.ts の updatePlayer）: 期限の来た遅れて来る傷を払い、宣告の溜め（皆既）を写して明けた分を出す */
export function tickDelayedDamage(state: GameState): void {
  payDeferredDamage(state);
  const echo = hasBoon(state, MOON_TOTALITY_KEY);
  for (const e of state.enemies) {
    if (e.hp > 0) tickDoomVault(state, e, echo);
  }
}

/** 期限の来た傷をまとめて受ける（継続ダメージと同じく無敵・硬直を起こさず、0 になれば倒れる） */
function payDeferredDamage(state: GameState): void {
  const p = state.player;
  const list = p.deferredDamage;
  if (list === undefined || list.length === 0) return;
  const due = list.filter((d) => d.due <= state.time).reduce((sum, d) => sum + d.amount, 0);
  if (due <= 0) return;
  p.deferredDamage = list.filter((d) => d.due > state.time);
  addFloatingText(state, p.body.pos, `-${due}`, COLOR_HURT, DEFERRED_TEXT_SCALE, undefined, "normal");
  damagePlayerDot(state, due, { kind: "deferred", key: "" });
}

/**
 * 皆既: 宣告の間に与えた傷（宣告を付けた時の生命 − 今の生命）を Enemy.vault（doom）に写し、宣告が明けたら echoRatio 倍で出す。
 * 宣告の付け直しは溜めが減ることで分かる（付け直しの瞬間の生命から数え直す）ので、その時も前の溜めを出す。別の種類の溜めがある敵には写さない
 */
function tickDoomVault(state: GameState, e: Enemy, echo: boolean): void {
  const held = e.vault?.kind === DOOM_VAULT ? e.vault.amount : undefined;
  if (held !== undefined && (doomDamage(e) ?? -1) < held) releaseDoomVault(state, e, held);
  if (!echo) return;
  const now = doomDamage(e);
  if (now === undefined) return;
  if (e.vault !== undefined && e.vault.kind !== DOOM_VAULT) return;
  e.vault = { kind: DOOM_VAULT, amount: now };
}

/** 今の宣告の間に減った生命。宣告が無ければ undefined */
function doomDamage(e: Enemy): number | undefined {
  const mark = findStatus(e.status, "doom")?.hpMark;
  return mark === undefined ? undefined : Math.max(0, mark - e.hp);
}

function releaseDoomVault(state: GameState, e: Enemy, held: number): void {
  delete e.vault;
  const amount = Math.round(held * BOON_LINEAGE.moon.moonTotality.echoRatio);
  if (amount < 1) return;
  spawnRing(state, e.body.pos, e.body.radius * 2, BOON_LINEAGE.moon.moonTotality.color, STATUS.fxLife);
  damageEnemy(state, e, amount, { x: 0, y: 0 }, 0, { hitstopSteps: 0 });
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
  if (relicRevive(state)) return;
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
  state.slowmo = Math.max(state.slowmo, FEEL.justDodgeSlowmo);
  gainEnergy(state, ENERGY.just);
  gainMana(state, MANA.onJust);
  registerComboHit(state);
  addHeadLabel(state, p.body.pos, "見切り！", COLOR_JUST, 0.7);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  justFx(state);
  state.flash = Math.max(state.flash, 0.2);
  pushSfx(state, "just");
  fireTrigger(state, "onJustDodge", { pos: { ...p.body.pos } });
  pushPlayerEvent(state, "onJustDodge", "just", { sourceId: attacker?.id });
  noteRiposte(state, "justDodge", attacker);
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
  if (shown > 0) addFloatingText(state, p.body.pos, `+${shown}`, COLOR_HEAL, 1.2, undefined, "normal");
  spawnBurst(state, p.body.pos, COLOR_HEAL, 10, 80, 0.5, 2);
  pushSfx(state, "heal");
  return gained;
}
