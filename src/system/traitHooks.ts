import { type MoreMul, productMore } from "../core/damage";
import type { Element } from "../core/element";
import type { DamageKind, Enemy, GameState } from "../core/state";
import type { StatusBag, StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, dist, length } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { KEYSTONE, POISE, TRIGGER } from "../data/tuning";
import { MOVESETS } from "../data/weapons";
import { recordProvenance } from "../loot/provenance";
import type { AttackMode } from "../loot/types";
import { SKILL } from "../skills/data";
import { gainEnergy, healSustained, isLastKillInEngagedRoom, pacifistMercyClamp } from "./combat";
import { addFloatingText, spawnRing } from "./effects";
import { isEngaged } from "./engagement";
import { KS, hasKeystone, oathMore } from "./keystones";
import { gainMana } from "./mana";
import { addPoise, poiseRatio } from "./poise";
import { applyStatus, enemiesInRadius, hasStatus } from "./statusEffects";
import { fireTrigger, inflictApply, shockwave } from "./triggers";
import { type OutgoingElement, dominantElement, elementShares } from "./elementCombat";
import { isFavoredWeapon } from "./jobs";
import { placeTerrain, terrainAt } from "./terrain";
import { statsBulletHas } from "../loot/bullets";

/**
 * 装備の性質（docs/ideas/relics-7d-plan.md 1 章）が持ち込むルール変更の読み取り口。
 * 数値は state.stats.traits（loot/types.ts の TraitStats）と誓約（stats.keystones）から読む。
 * 条件付きの与ダメの多くは Modifier（system/modifiers.ts）へ移したので、ここに残るのは
 * 属性の割合で伸びるもの・行動（源・作業領域）・被ダメージ・ベースの implicit が読む欄だけ。
 * combat.ts / player.ts / mana.ts からは 1 行の呼び出しだけで済むよう、判断はすべてここに置く
 */

/** 「状態異常の種類数」に数えないもの（怯み値の系統と、プレイヤーのバフ） */
const NOT_AN_AFFLICTION: ReadonlySet<StatusKind> = new Set<StatusKind>([
  "stagger",
  "guarded",
  "haste",
  "harden",
  "wrath",
  "fury",
  "charged",
]);
const SHIELD_TEXT = "身代わり";
const SHIELD_TEXT_SCALE = 0.9;
const SHIELD_TEXT_LIFE = 0.5;

/** 付いている状態異常の種類数（バフと怯み・堅守を除く） */
export function afflictionKinds(bag: Readonly<StatusBag>): number {
  const kinds = new Set<StatusKind>();
  for (const effect of bag.effects) {
    if (effect.time > 0 && !NOT_AN_AFFLICTION.has(effect.kind)) kinds.add(effect.kind);
  }
  return kinds.size;
}

/** 付いている状態異常（1 種 1 つ。バフと怯み・堅守を除く） */
export function afflictionList(bag: Readonly<StatusBag>): StatusKind[] {
  const kinds: StatusKind[] = [];
  for (const effect of bag.effects) {
    if (effect.time > 0 && !NOT_AN_AFFLICTION.has(effect.kind) && !kinds.includes(effect.kind)) kinds.push(effect.kind);
  }
  return kinds;
}

// ---------------------------------------------------------------------------
// 与ダメージ（combat.ts の rollOutgoing から）
// ---------------------------------------------------------------------------

/** 地脈の炸裂: 地形ごとに周囲へ付ける状態異常 */
const GROUND_BLAST_STATUS: Readonly<Record<Exclude<TerrainKind, "none">, StatusKind>> = {
  water: "chill",
  ice: "chill",
  oil: "burn",
  lava: "burn",
  fire: "burn",
  bog: "poison",
  grass: "poison",
  mud: "chill",
  rubble: "broken",
  // 煙は床の地形ではない（terrainAt が返さない）ので引かれない。Record の網羅のためだけに置く
  smoke: "weaken",
};
/** 「燃えている」とみなす状態異常 */
const BURNING_STATUS: readonly StatusKind[] = ["burn", "blaze", "scorch"];
/** 属性ごとに関係の深い状態異常（逆撫で・崩れの属性。elementCombat.ts の低確率の付与と同じ対応） */
const ELEMENT_STATUS: Readonly<Partial<Record<Element, StatusKind>>> = {
  fire: "burn",
  ice: "chill",
  lightning: "shock",
  poison: "poison",
  dark: "weaken",
  light: "vulnerable",
};
/** 半分（表裏の生命の境目） */
const HALF = 0.5;
/** トリガーの内部クールダウンは最大でもこの割合までしか縮めない（常時発動にしない） */
const TRIGGER_ICD_CUT_MAX = 0.9;
/** 立ち止まっているとみなす速さ（px/秒）。踏ん張りの被ダメの減り */
const STILL_SPEED = 0;

/** 自分の足元の地形 */
function playerGround(state: GameState): TerrainKind {
  const p = state.player.body.pos;
  return terrainAt(state, p.x, p.y);
}

/** 敵の足元の地形 */
function enemyGround(state: GameState, enemy: Enemy): TerrainKind {
  return terrainAt(state, enemy.body.pos.x, enemy.body.pos.y);
}

function isBurning(enemy: Enemy): boolean {
  return BURNING_STATUS.some((kind) => hasStatus(enemy.status, kind));
}

/** 攻撃手段（持ち替えの判定）。proc は数えない */
export function attackMode(kind: DamageKind, skill: boolean): AttackMode | null {
  if (kind === "proc") return null;
  if (skill) return "skill";
  return kind === "melee" ? "melee" : "ranged";
}

/** 直前と違う手段か / 同じ手段が続いたか（直前が無ければどちらでもない） */
function modeShift(state: GameState, mode: AttackMode | null): "switched" | "repeated" | "first" {
  const last = state.player.loot.lastMode;
  if (mode === null || last === null) return "first";
  return last === mode ? "repeated" : "switched";
}

/** 近接の振りの形（溜めの段・派生）。スキルの命中には掛けない */
function meleeFormBonus(state: GameState): number {
  const t = state.stats.traits;
  const a = state.player.attack;
  let bonus = 0;
  if (a.chargeLevel > 0) bonus += t.chargedMeleeMul * a.chargeLevel;
  if (a.branch >= 0) bonus += t.branchDamageMul;
  return bonus;
}

/** 散弾の射撃が近い敵に当たったとき（ベースのラッパ銃） */
function spreadCloseBonus(state: GameState, enemy: Enemy | null): number {
  const t = state.stats.traits;
  if (enemy === null || t.spreadCloseMul === 0 || !statsBulletHas(state.stats, "spread")) return 0;
  return dist(state.player.body.pos, enemy.body.pos) <= TRIGGER.trait.spreadCloseRange ? t.spreadCloseMul : 0;
}

/** 旧共鳴「天秤」「表裏」の欄（色の共鳴の廃止後は書く所が無く 0。loot/types.ts の旧欄と一緒に消す） */
function rhythmBonus(state: GameState): number {
  const t = state.stats.traits;
  const p = state.player;
  let bonus = 0;
  if (t.alternateDamageStep > 0) bonus += Math.min(t.alternateDamageCap, p.loot.alternateStacks * t.alternateDamageStep);
  if (t.highHpDamageMul > 0 && p.hp >= p.maxHp * HALF) bonus += t.highHpDamageMul;
  return bonus;
}

/**
 * 誓約の倍（読み勝ち。楔・遠間などの常時の倍は Modifier〈keystones.ts の keystoneModifiers〉）。
 * 1 つの誓約につき 1 要素（system/damageMods.ts の collectMore が集める）。proc（燃焼・トリガーの衝撃波など）には掛けない
 */
export function keystoneMore(state: GameState, enemy: Enemy | null, kind: DamageKind): MoreMul[] {
  const out: MoreMul[] = [];
  if (kind === "proc" || state.stats.keystones.length === 0) return out;
  if (enemy !== null && kind === "melee" && hasKeystone(state, KS.readOath) && enemy.phase !== "windup") {
    out.push(oathMore(KS.readOath, KEYSTONE.readOffWindupDamageMul));
  }
  return out;
}

/**
 * 性質の欄が持つ与ダメの加算（地形の上の敵・振りの形・散弾・共鳴の拍子）。増として装備の増と足す（system/damageMods.ts）。
 * proc（燃焼・トリガーの衝撃波など）には掛けない（既存の会心・コンボと同じ扱い）
 */
export function traitIncreased(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  if (kind === "proc") return 0;
  const t = state.stats.traits;
  let bonus = rhythmBonus(state);
  if (enemy !== null && t.enemyOnTerrainMul !== 0 && enemyGround(state, enemy) !== "none") bonus += t.enemyOnTerrainMul;
  if (kind === "melee" && !skill) bonus += meleeFormBonus(state);
  if (kind === "ranged" && !skill) bonus += spreadCloseBonus(state, enemy);
  return bonus;
}

/**
 * 性質・誓約だけの与ダメの倍率（装備の増を含まない。テストと見積もり用）。
 * 実際の与ダメは system/damageMods.ts が装備の増と traitIncreased を足してから誓約の倍を掛ける
 */
export function traitOutgoingMul(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  if (kind === "proc") return 1;
  const mul = Math.max(TRIGGER.trait.minMul, 1 + traitIncreased(state, enemy, kind, skill));
  return mul * productMore(keystoneMore(state, enemy, kind));
}

// ---------------------------------------------------------------------------
// 属性（combat.ts の genreAndElement から。out は敵の防御と属性耐性を掛けた倍率と内訳）
// ---------------------------------------------------------------------------

function shareOf(out: OutgoingElement, element: Element): number {
  return out.shares.find((s) => s.element === element)?.share ?? 0;
}

/** 通電: 濡れ / 油膜の敵へ。雷 / 炎の割合だけさらに伸びる */
function soakedBonus(state: GameState, enemy: Enemy, out: OutgoingElement): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.wetConductMul > 0 && (hasStatus(enemy.status, "wet") || hasStatus(enemy.status, "soaked"))) {
    bonus += t.wetConductMul * (1 + shareOf(out, "lightning"));
  }
  if (t.oiledIgniteMul > 0 && hasStatus(enemy.status, "oiled")) bonus += t.oiledIgniteMul * (1 + shareOf(out, "fire"));
  return bonus;
}

/** 攻撃の主な属性の状態異常を付ける（無属性・対応の無い属性なら何もしない） */
function inflictElement(state: GameState, enemy: Enemy, element: Element | undefined, seconds: number): void {
  const kind = element === undefined ? undefined : ELEMENT_STATUS[element];
  if (kind === undefined || seconds <= 0) return;
  applyStatus(state, { kind: "enemy", enemy }, inflictApply(kind, seconds), "player");
}

/** 弱点・耐性の命中で起きること（弱点の気力・逆撫で・来歴） */
function onAffinity(state: GameState, enemy: Enemy, out: OutgoingElement): void {
  const t = state.stats.traits;
  if (out.affinity === "weak") {
    if (t.weakHitMana > 0) gainMana(state, t.weakHitMana);
    recordProvenance(state, { kind: "weakHit" });
    return;
  }
  if (out.affinity !== "resist") return;
  if (t.resistedInflict > 0) inflictElement(state, enemy, dominantElement(out.shares)?.element, t.resistedInflict);
  recordProvenance(state, { kind: "resistedHit" });
}

/**
 * 性質による属性まわりの倍率（弱点刺し・通電）。
 * 弱点の気力・逆撫での付与・来歴の記録もここで起こす（1 命中につき 1 回呼ばれる）。proc には掛けない
 */
export function traitElementMul(state: GameState, enemy: Enemy, out: OutgoingElement, kind: DamageKind): number {
  if (kind === "proc") return 1;
  const t = state.stats.traits;
  onAffinity(state, enemy, out);
  const affinityBonus = out.affinity === "weak" ? t.weakDamageMul : 0;
  return Math.max(TRIGGER.trait.elementMinMul, 1 + affinityBonus + soakedBonus(state, enemy, out));
}

// ---------------------------------------------------------------------------
// 怯み値（combat.ts の damageEnemy から）
// ---------------------------------------------------------------------------

function poiseBonus(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.wedgePoiseMul !== 0 && poiseRatio(enemy) >= TRIGGER.trait.wedgeRatio) bonus += t.wedgePoiseMul;
  if (kind === "ranged") bonus += t.rangedPoiseMul;
  if (crit) bonus += t.critPoiseMul;
  if (kind === "melee") bonus += t.chargedPoiseMul * state.player.attack.chargeLevel;
  return bonus + alternatePoiseBonus(state, kind);
}

/**
 * 持ち替えの怯み値（旧 共鳴の星座が持ち込んだ欄。今は書く所が無く 0。loot/types.ts の旧欄と一緒に消す）。
 * damageEnemy はスキルかどうかを渡さないので、近接 / 射撃の区別だけで見る
 */
function alternatePoiseBonus(state: GameState, kind: DamageKind): number {
  const t = state.stats.traits;
  if (t.alternatePoiseMul === 0 && t.repeatPoisePenalty === 0) return 0;
  const shift = modeShift(state, attackMode(kind, false));
  if (shift === "switched") return t.alternatePoiseMul;
  if (shift === "repeated") return -t.repeatPoisePenalty;
  return 0;
}

/** 堅守の半減を打ち消す倍率。ratio = 1 で堅守が無いのと同じになる */
function guardCompensation(enemy: Enemy, ratio: number): number {
  if (ratio <= 0 || !hasStatus(enemy.status, "guarded")) return 1;
  const guarded = enemyDef(enemy.defKey).boss === true ? POISE.bossGuardedMul : POISE.guardedMul;
  return 1 + (1 / guarded - 1) * Math.min(1, ratio);
}

function keystonePoiseMul(state: GameState, enemy: Enemy, kind: DamageKind): number {
  if (state.stats.keystones.length === 0) return 1;
  if (hasKeystone(state, KS.unshaken)) return 0;
  if (kind === "melee" && hasKeystone(state, KS.readOath)) return enemy.phase === "windup" ? KEYSTONE.readPoiseMul : 0;
  return 1;
}

/** 性質・誓約による怯み値の倍率（剥がしは堅守の半減を近接・射撃とも打ち消す） */
export function traitPoiseMul(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const base = Math.max(TRIGGER.trait.minMul, 1 + poiseBonus(state, enemy, kind, crit));
  const pierce = guardCompensation(enemy, state.stats.traits.guardPierce);
  return base * pierce * keystonePoiseMul(state, enemy, kind);
}

// ---------------------------------------------------------------------------
// 出来事（怯ませた / 撃破 / カウンター）
// ---------------------------------------------------------------------------

/** 崩れの反響: 周囲の敵にも怯み値。ここで怯んだ敵からは連鎖させない */
function staggerQuake(state: GameState, enemy: Enemy, amount: number): void {
  if (amount <= 0) return;
  spawnRing(state, enemy.body.pos, TRIGGER.trait.staggerQuakeRadius, TRIGGER.shockwaveColor, TRIGGER.icd);
  for (const other of enemiesInRadius(state, enemy.body.pos, TRIGGER.trait.staggerQuakeRadius)) {
    if (other.id !== enemy.id) addPoise(state, other, amount);
  }
}

/** 敵を怯ませた瞬間（combat.ts の damageEnemy で怯み値が耐性を超えたとき） */
export function onTraitStagger(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (t.manaOnStagger > 0) gainMana(state, t.manaOnStagger);
  staggerQuake(state, enemy, t.staggerQuake);
  if (t.elementBreak > 0) inflictElement(state, enemy, weaponElement(state), t.elementBreak);
  fireTrigger(state, "onStagger", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  recordProvenance(state, { kind: "stagger" });
}

/** 武器（近接の通常攻撃）の主な属性。属性の変換を含む */
function weaponElement(state: GameState): Element | undefined {
  const atk = MOVESETS[state.stats.moveset].attack;
  return dominantElement(elementShares(state.stats, atk, false))?.element;
}

/** 病みの誓い: 死んだ敵の状態異常を周囲の敵へ移す（残り秒と効果量はそのまま） */
function spreadAfflictions(state: GameState, enemy: Enemy): void {
  const effects = enemy.status.effects.filter((e) => e.time > 0 && !NOT_AN_AFFLICTION.has(e.kind));
  if (effects.length === 0) return;
  for (const other of enemiesInRadius(state, enemy.body.pos, KEYSTONE.contagionRadius)) {
    if (other.id === enemy.id) continue;
    for (const e of effects) {
      applyStatus(state, { kind: "enemy", enemy: other }, { kind: e.kind, stacks: e.stacks, duration: e.time, potency: e.potency }, "env");
    }
  }
}

/** 殲滅（交戦中の部屋の最後の 1 体）の性質 */
function onLastKill(state: GameState): void {
  const t = state.stats.traits;
  if (t.lastKillEnergy > 0) gainEnergy(state, t.lastKillEnergy);
  if (t.lastKillClearsBullets > 0) {
    for (const pr of state.projectiles) if (pr.owner === "enemy") pr.life = 0;
  }
  recordProvenance(state, { kind: "lastKill" });
}

/** 敵を倒した瞬間（combat.ts の killEnemy から。敵はまだ配列に残っていて状態異常も読める） */
export function onTraitKill(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (t.inheritCharges > 0) inheritAffliction(state, enemy, t.inheritCharges);
  if (hasKeystone(state, KS.contagion)) spreadAfflictions(state, enemy);
  if (enemy.elite !== undefined) recordProvenance(state, { kind: "eliteKill" });
  if (isFavoredWeapon(state.stats, state.job)) recordProvenance(state, { kind: "favoredKill" });
  onGroundKill(state, enemy);
  if (isLastKillInEngagedRoom(state, enemy)) onLastKill(state);
}

/** 足元の撃破（地脈の炸裂・残り火・来歴） */
function onGroundKill(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  const ground = enemyGround(state, enemy);
  if (ground !== "none") {
    recordProvenance(state, { kind: "terrainKill" });
    if (t.terrainKillBlast > 0) groundBlast(state, enemy.body.pos, ground, t.terrainKillBlast);
  }
  if (t.burningKillFire > 0 && isBurning(enemy)) {
    placeTerrain(state, enemy.body.pos.x, enemy.body.pos.y, "fire", TRIGGER.trait.burningKillFireRadius, t.burningKillFire);
  }
}

/** 地脈の炸裂: 衝撃波と、地形に応じた状態異常。連鎖で爆ぜ続けないよう内部クールダウンを持つ */
function groundBlast(state: GameState, pos: Vec, ground: Exclude<TerrainKind, "none">, damage: number): void {
  const loot = state.player.loot;
  if (loot.terrainBlastIcd > 0) return;
  loot.terrainBlastIcd = TRIGGER.trait.terrainBlastIcd;
  const at = { ...pos };
  const apply = inflictApply(GROUND_BLAST_STATUS[ground], TRIGGER.trait.terrainBlastStatusSec);
  for (const e of enemiesInRadius(state, at, TRIGGER.trait.terrainBlastRadius)) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  shockwave(state, at, damage);
}

/** カウンターが成立した瞬間（player.ts の近接命中から） */
export function onTraitCounter(state: GameState, enemy: Enemy): void {
  fireTrigger(state, "onCounter", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  recordProvenance(state, { kind: "counter" });
}

// ---------------------------------------------------------------------------
// 被ダメージ（combat.ts の damagePlayer から）
// ---------------------------------------------------------------------------

/** 身代わり: マナを払えたら被ダメージを減らす。払えなければ不発（何も減らさない） */
function manaShieldMul(state: GameState): number {
  const cost = state.stats.traits.manaShieldCost;
  const p = state.player;
  if (cost <= 0 || p.mana < cost) return 1;
  p.mana -= cost;
  addFloatingText(state, { x: p.body.pos.x, y: p.body.pos.y - 8 }, SHIELD_TEXT, TRIGGER.trait.manaShieldColor, SHIELD_TEXT_SCALE, SHIELD_TEXT_LIFE);
  return TRIGGER.trait.manaShieldMul;
}

/** 性質による被ダメージ倍率（足元・交戦・構え・踏ん張り・表裏・身代わり）。身代わりはここでマナを払う */
export function traitIncomingMul(state: GameState, _attacker?: Enemy): number {
  const t = state.stats.traits;
  const p = state.player;
  let mul = 1;
  if (t.terrainGuard > 0 && playerGround(state) !== "none") mul *= 1 - t.terrainGuard;
  if (t.engagedGuard > 0 && isEngaged(state)) mul *= 1 - t.engagedGuard;
  if (t.stanceGuard > 0 && (p.attack.phase === "windup" || p.attack.phase === "active")) mul *= 1 - t.stanceGuard;
  if (t.unmoving > 0 && length(p.body.vel) <= STILL_SPEED) mul *= 1 - t.unmoving;
  if (t.lowHpGuard > 0 && p.hp < p.maxHp * HALF) mul *= 1 - t.lowHpGuard;
  return Math.max(TRIGGER.trait.minMul, mul) * manaShieldMul(state);
}

// ---------------------------------------------------------------------------
// マナ（mana.ts の gainMana から）
// ---------------------------------------------------------------------------

/**
 * 性質による気力の回収倍率。今は倍を持つ性質が無い（底打ちは段取り 7d で消えた）。
 * mana.ts の呼び出しは口として残す（性質・誓約で戻すときにここへ足す）
 */
export function traitManaGainMul(_state: GameState): number {
  return 1;
}

/** 溢れ: 満タンで捨てられた回収を必殺ゲージへ移す */
export function spillManaOverflow(state: GameState, overflow: number): void {
  const ratio = state.stats.traits.manaOverflowToEnergy;
  if (ratio <= 0 || overflow <= 0) return;
  gainEnergy(state, overflow * ratio);
}

// ---------------------------------------------------------------------------
// 時間（system/triggers.ts の tickTriggerCooldowns から毎ステップ）
// ---------------------------------------------------------------------------

/** 毎ステップの性質（余韻斬り・血の署名・持ち替え・足元） */
export function tickTraitClocks(state: GameState, dt: number): void {
  tickComboBreak(state);
  tickLowHpHaste(state, dt);
  tickLootTimers(state, dt);
  tickGroundMend(state, dt);
  tickIceTrail(state);
}

/** 天秤の重なりの残り秒と、地脈の炸裂の内部クールダウン */
function tickLootTimers(state: GameState, dt: number): void {
  const loot = state.player.loot;
  loot.terrainBlastIcd = Math.max(0, loot.terrainBlastIcd - dt);
  if (loot.alternateTimer <= 0) return;
  loot.alternateTimer = Math.max(0, loot.alternateTimer - dt);
  if (loot.alternateTimer === 0) loot.alternateStacks = 0;
}

/** 土の息: 地形の上に立つ間の回復（戦闘中も。回復の共通上限を受ける） */
function tickGroundMend(state: GameState, dt: number): void {
  const regen = state.stats.traits.terrainRegen;
  const p = state.player;
  if (regen <= 0 || p.hp >= p.maxHp || playerGround(state) === "none") return;
  healSustained(state, regen * dt, { silent: true });
}

/** 霜の轍: ダッシュ中、足元に氷床を置く */
function tickIceTrail(state: GameState): void {
  const seconds = state.stats.traits.dashIceTrail;
  const p = state.player;
  if (seconds <= 0 || p.dashTimer <= 0) return;
  placeTerrain(state, p.body.pos.x, p.body.pos.y, "ice", TRIGGER.trait.iceTrailRadius, seconds);
}

/** 装備トリガーの内部クールダウンに掛ける倍率（旧 星座「鏡像」の欄。system/triggers.ts の fireTrigger） */
export function traitTriggerIcdMul(state: GameState): number {
  return 1 - Math.min(TRIGGER_ICD_CUT_MAX, Math.max(0, state.stats.traits.triggerIcdCut));
}

/** 余韻斬り: コンボが途切れた瞬間（前のステップより 0 に落ちた）、そのコンボ数に応じた衝撃波 */
function tickComboBreak(state: GameState): void {
  const loot = state.player.loot;
  const now = state.combo.count;
  const before = loot.lastCombo;
  loot.lastCombo = now;
  const per = state.stats.traits.comboBreakWave;
  if (per <= 0 || now > 0 || before < TRIGGER.trait.comboBreakMin) return;
  shockwave(state, state.player.body.pos, per * Math.min(before, TRIGGER.trait.comboBreakCap));
}

/** 血の署名: HP が半分を切っている間、スキルの再使用時間と最低間隔が速く明ける */
function tickLowHpHaste(state: GameState, dt: number): void {
  const haste = state.stats.traits.lowHpSkillHaste;
  const p = state.player;
  if (haste <= 0 || p.hp >= p.maxHp * TRIGGER.trait.lowHpRatio) return;
  const extra = dt * haste;
  for (const slot of state.skills.slots) {
    slot.cooldownLeft = Math.max(0, slot.cooldownLeft - extra);
    slot.intervalLeft = Math.max(0, slot.intervalLeft - extra);
  }
}

// ---------------------------------------------------------------------------
// 命中ごと（combat.ts の damageEnemy から。近接・射撃・スキルの命中だけ。proc は来ない）
// ---------------------------------------------------------------------------

/**
 * 撃ち込み杭・形見・置き土産。damageEnemy の中から呼ばれるので、ここで damageEnemy を呼び直さない
 * （同じ敵の撃破処理が 2 回走るのを避け、杭の爆ぜは HP を直接削って外側の撃破判定に任せる）
 */
export function onTraitHit(state: GameState, enemy: Enemy, kind: DamageKind, skill = false): void {
  const mode = attackMode(kind, skill);
  if (enemy.hp > 0) {
    const t = state.stats.traits;
    if (t.stakeDamage > 0) stake(state, enemy, kind, t.stakeDamage);
    applyInherited(state, enemy);
    if (kind === "melee" && t.placedInfuse > 0) infuseFromPlaced(state, enemy, t.placedInfuse);
    if (kind === "melee" && !skill) onMeleeFormHit(state);
    if (kind === "ranged" && !skill) onShotHit(state, enemy);
  }
  trackMode(state, mode);
}

/** 派生の冴え（気力）と、溜め・派生の来歴 */
function onMeleeFormHit(state: GameState): void {
  const t = state.stats.traits;
  const a = state.player.attack;
  if (a.chargeLevel > 0) recordProvenance(state, { kind: "chargedHit" });
  if (a.branch >= 0) {
    if (t.branchHitMana > 0) gainMana(state, t.branchHitMana);
    recordProvenance(state, { kind: "branchHit" });
  }
}

/** 連射の烙印（弾の性質で決まる付与）。確率は性質を持つときだけ引く（乱数列を変えない） */
function onShotHit(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (t.rapidBrandChance <= 0 || !statsBulletHas(state.stats, "rapid") || !state.rng.chance(t.rapidBrandChance)) return;
  applyStatus(state, { kind: "enemy", enemy }, { kind: "brand", stacks: 1, duration: TRIGGER.trait.rapidBrandSec, potency: 0 }, "player");
}

/** 持ち替え: 手替えの呼吸の気力、天秤の重なり。最後に直前の手段を更新する */
function trackMode(state: GameState, mode: AttackMode | null): void {
  if (mode === null) return;
  const loot = state.player.loot;
  const t = state.stats.traits;
  const switched = modeShift(state, mode) === "switched";
  if (switched && t.switchMana > 0) gainMana(state, t.switchMana);
  const crossed = switched && mode !== "skill" && loot.lastMode !== "skill";
  if (crossed && t.alternateDamageStep > 0) {
    loot.alternateStacks += 1;
    loot.alternateTimer = TRIGGER.trait.alternateWindow;
  }
  loot.lastMode = mode;
}

/** 撃ち込み杭: 射撃で刺し、近接で爆ぜさせる */
function stake(state: GameState, enemy: Enemy, kind: DamageKind, perShot: number): void {
  const stuck = enemy.stuckShots ?? 0;
  if (kind === "ranged") {
    enemy.stuckShots = Math.min(TRIGGER.trait.stakeMax, stuck + 1);
    return;
  }
  if (kind !== "melee" || stuck <= 0) return;
  enemy.stuckShots = 0;
  const raw = Math.round(perShot * stuck);
  const amount = pacifistMercyClamp(state, enemy, raw);
  if (amount <= 0) return;
  enemy.hp -= amount;
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - 10 }, `杭 ${amount}`, TRIGGER.trait.stakeColor, 1.2, 0.6);
  spawnRing(state, enemy.body.pos, enemy.body.radius * 2, TRIGGER.trait.stakeColor, TRIGGER.icd);
}

/** 形見: 倒した敵の状態異常を 1 種受け継ぐ（付いた順の最初のもの） */
function inheritAffliction(state: GameState, enemy: Enemy, charges: number): void {
  const kind = afflictionList(enemy.status)[0];
  if (kind === undefined) return;
  state.player.loot.inherited = { kind, charges: Math.max(1, Math.round(charges)) };
}

function applyInherited(state: GameState, enemy: Enemy): void {
  const inherited = state.player.loot.inherited;
  if (inherited === null || inherited.charges <= 0) return;
  applyStatus(state, { kind: "enemy", enemy }, inflictApply(inherited.kind, TRIGGER.trait.inheritDuration), "player");
  inherited.charges -= 1;
  if (inherited.charges <= 0) state.player.loot.inherited = null;
}

interface PlacedZone {
  pos: Vec;
  radius: number;
  status: StatusKind;
}

/** 状態異常を持つ自分の設置物（引力球 = 沈黙・氷結地帯 = 冷気）の範囲 */
function placedZones(state: GameState): PlacedZone[] {
  const rs = state.skills;
  return [
    ...rs.wells.map((w) => ({ pos: w.pos, radius: SKILL.gravityWell.radius * w.params.areaMul, status: "silence" as const })),
    ...rs.fields.map((f) => ({ pos: f.pos, radius: SKILL.frostField.radius * f.params.areaMul, status: "chill" as const })),
  ];
}

/** 置き土産: 自分が設置物の範囲内にいれば、近接がその状態異常を乗せる */
function infuseFromPlaced(state: GameState, enemy: Enemy, seconds: number): void {
  const p = state.player.body.pos;
  for (const zone of placedZones(state)) {
    if (dist(p, zone.pos) > zone.radius) continue;
    applyStatus(state, { kind: "enemy", enemy }, inflictApply(zone.status, seconds), "player");
  }
}
