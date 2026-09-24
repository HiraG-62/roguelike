import type { Element } from "../core/element";
import type { DamageKind, Enemy, GameState } from "../core/state";
import type { StatusBag, StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, dist } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { KEYSTONE, POISE, TRIGGER } from "../data/tuning";
import { MOVESETS } from "../data/weapons";
import { recordProvenance } from "../loot/provenance";
import type { AttackMode, TraitColor, TraitStats } from "../loot/types";
import { SKILL } from "../skills/data";
import { BOONS, type BoonTag } from "./boonDefs";
import { gainEnergy, healSustained, isLastKillInEngagedRoom, pacifistMercyClamp } from "./combat";
import { addFloatingText, spawnRing } from "./effects";
import { isEngaged } from "./engagement";
import { KS, hasKeystone } from "./keystones";
import { gainMana } from "./mana";
import { addPoise, isStaggered, poiseRatio } from "./poise";
import { applyStatus, enemiesInRadius, hasStatus } from "./statusEffects";
import { fireTrigger, inflictApply, shockwave } from "./triggers";
import { type OutgoingElement, dominantElement, elementShares, enemyAttackOf, enemyElementMul } from "./elementCombat";
import { isFavoredWeapon } from "./jobs";
import { placeTerrain, terrainAt } from "./terrain";
import { statsBulletHas } from "../loot/bullets";

/**
 * 装備の性質（docs/ideas/loot-expansion.md）が持ち込むルール変更の読み取り口。
 * 数値は state.stats.traits（loot/types.ts の TraitStats）と誓約（stats.keystones）から読む。
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

/**
 * 対象と場に応じた加算（性質）。全ヒットで呼ばれるので、性質が 0 の項目は状態を調べない
 * （QA のヘッドレス周回の速度を落とさない）
 */
function targetBonus(state: GameState, enemy: Enemy): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.damagePerStatusKind !== 0) bonus += afflictionKinds(enemy.status) * t.damagePerStatusKind;
  if (t.windupDamageMul !== 0 || t.offWindupPenalty !== 0) {
    bonus += enemy.phase === "windup" ? t.windupDamageMul : -t.offWindupPenalty;
  }
  if (t.guardedDamageMul !== 0 && hasStatus(enemy.status, "guarded")) bonus += t.guardedDamageMul;
  if (t.bossDamageMul !== 0 || t.nonBossPenalty !== 0) {
    bonus += enemyDef(enemy.defKey).boss === true ? t.bossDamageMul : -t.nonBossPenalty;
  }
  if (t.brokenMul !== 0 && hasStatus(enemy.status, "broken")) bonus += t.brokenMul;
  if (t.enemyOnTerrainMul !== 0 && enemyGround(state, enemy) !== "none") bonus += t.enemyOnTerrainMul;
  return bonus;
}

// ---------------------------------------------------------------------------
// 第 2 弾: 武器種・銃の弾・ジョブ・地形・新しい状態異常・持ち替え
// ---------------------------------------------------------------------------

/** 水たまり・氷床（滑り足・滑りの誓い） */
const SLICK_GROUND: ReadonlySet<TerrainKind> = new Set<TerrainKind>(["water", "ice"]);
/** 燃える地形（熾火の誓い） */
const BURNING_GROUND: ReadonlySet<TerrainKind> = new Set<TerrainKind>(["fire", "lava", "oil"]);
/** 「燃えている」とみなす状態異常 */
const BURNING_STATUS: readonly StatusKind[] = ["burn", "blaze", "scorch"];
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

/** 今の武器種がジョブの得意武器か（見習いは得意武器を持たない） */
function holdsFavored(state: GameState): boolean {
  return isFavoredWeapon(state.stats, state.job);
}

/** 今の武器種が溜めを持つか（溜めずに振った近接の減少はこの武器種だけに掛ける） */
function weaponCharges(state: GameState): boolean {
  return MOVESETS[state.stats.moveset].charge !== undefined;
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

/** 近接の振りの形（溜め・派生）。スキルの命中には掛けない */
function meleeFormBonus(state: GameState): number {
  const t = state.stats.traits;
  const a = state.player.attack;
  let bonus = 0;
  if (a.chargeLevel > 0) bonus += t.chargedMeleeMul * a.chargeLevel;
  else if (t.unchargedPenalty !== 0 && weaponCharges(state)) bonus -= t.unchargedPenalty;
  if (a.branch >= 0) bonus += t.branchDamageMul;
  return bonus;
}

/** 散弾の射撃の間合い（近い敵へ + / 遠い敵へ −） */
function spreadRangeBonus(state: GameState, enemy: Enemy | null): number {
  const t = state.stats.traits;
  if (enemy === null || !statsBulletHas(state.stats, "spread") || (t.spreadCloseMul === 0 && t.spreadFarPenalty === 0)) return 0;
  const close = dist(state.player.body.pos, enemy.body.pos) <= TRIGGER.trait.spreadCloseRange;
  return close ? t.spreadCloseMul : -t.spreadFarPenalty;
}

/** 烙印（起爆の手）: 射撃・スキルだけが起爆するので、その 2 つにだけ掛ける */
function brandBonus(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  const t = state.stats.traits;
  if (enemy === null || (t.brandedMul === 0 && t.unbrandedPenalty === 0)) return 0;
  if (kind !== "ranged" && !skill) return 0;
  if (hasStatus(enemy.status, "brand")) return t.brandedMul;
  return kind === "ranged" && !skill ? -t.unbrandedPenalty : 0;
}

/** 足元の地形（地の利・滑り足） */
function footingBonus(state: GameState): number {
  const t = state.stats.traits;
  if (t.terrainDamageMul === 0 && t.offTerrainPenalty === 0 && t.slickDamageMul === 0) return 0;
  const ground = playerGround(state);
  let bonus = 0;
  if (t.terrainDamageMul !== 0 || t.offTerrainPenalty !== 0) bonus += ground !== "none" ? t.terrainDamageMul : -t.offTerrainPenalty;
  if (SLICK_GROUND.has(ground)) bonus += t.slickDamageMul;
  return bonus;
}

/** ジョブ（流派の型・無所属） */
function jobBonus(state: GameState): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.favoredDamageMul !== 0 || t.unfavoredPenalty !== 0) bonus += holdsFavored(state) ? t.favoredDamageMul : -t.unfavoredPenalty;
  if (t.noJobDamageMul !== 0 || t.jobPenalty !== 0) bonus += state.job === "none" ? t.noJobDamageMul : -t.jobPenalty;
  return bonus;
}

/** 天秤（紅と蒼の拮抗）: 近接と射撃を交互に当て続けた回数ぶん。表裏: 生命が半分以上 */
function rhythmBonus(state: GameState): number {
  const t = state.stats.traits;
  const p = state.player;
  let bonus = 0;
  if (t.alternateDamageStep > 0) bonus += Math.min(t.alternateDamageCap, p.loot.alternateStacks * t.alternateDamageStep);
  if (t.highHpDamageMul > 0 && p.hp >= p.maxHp * HALF) bonus += t.highHpDamageMul;
  return bonus;
}

/** 第 2 弾の与ダメージの加算（武器の形・銃の弾・烙印・足元・ジョブ・持ち替えの拍子） */
function wave2Bonus(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  let bonus = footingBonus(state) + jobBonus(state) + rhythmBonus(state) + brandBonus(state, enemy, kind, skill);
  if (kind === "melee" && !skill) bonus += meleeFormBonus(state);
  if (kind === "ranged" && !skill) bonus += spreadRangeBonus(state, enemy);
  return bonus;
}

function fieldBonus(state: GameState, kind: DamageKind): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.damagePerSelfStatus !== 0) bonus += afflictionKinds(state.player.status) * t.damagePerSelfStatus;
  if (t.lockedDamageMul !== 0 || t.unlockedPenalty !== 0) {
    bonus += isEngaged(state) ? t.lockedDamageMul : -t.unlockedPenalty;
  }
  if (kind === "ranged" && (t.darkRangedMul !== 0 || t.lightRangedPenalty !== 0)) {
    bonus += state.floorKind === "dark" ? t.darkRangedMul : -t.lightRangedPenalty;
  }
  if (t.reaperDamageMul !== 0 && state.reaper !== null) bonus += t.reaperDamageMul;
  return bonus + boonEchoBonus(state);
}

/** 祝福の響き: 色ごとの対応タグ（冥は呪い付きの祝福） */
const BOON_ECHO_TAGS: Readonly<Record<Exclude<TraitColor, "umbra">, readonly BoonTag[]>> = {
  crimson: ["melee", "burn"],
  azure: ["ranged", "dash", "mana"],
  jade: ["hp", "room"],
  gold: ["combo", "crit", "energy", "shock"],
};

const BOON_ECHO_FIELD: Readonly<Record<TraitColor, keyof TraitStats>> = {
  crimson: "boonEchoCrimson",
  azure: "boonEchoAzure",
  jade: "boonEchoJade",
  gold: "boonEchoGold",
  umbra: "boonEchoUmbra",
};

function boonMatchesColor(key: GameState["boons"][number], color: TraitColor): boolean {
  const def = BOONS[key];
  if (color === "umbra") return def.cursed;
  return def.tags.some((tag) => BOON_ECHO_TAGS[color].includes(tag));
}

/** 祝福の響き: 色に対応する祝福 1 つにつき +、対応しない祝福 1 つにつき − */
function boonEchoBonus(state: GameState): number {
  const t = state.stats.traits;
  let bonus = 0;
  for (const color of Object.keys(BOON_ECHO_FIELD) as TraitColor[]) {
    const per = t[BOON_ECHO_FIELD[color]];
    if (per === 0) continue;
    const matched = state.boons.filter((key) => boonMatchesColor(key, color)).length;
    bonus += per * matched - TRIGGER.trait.boonEchoOffPenalty * (state.boons.length - matched);
  }
  return bonus;
}

function skillBonus(state: GameState): number {
  const t = state.stats.traits;
  const max = state.stats.maxMana;
  if (max <= 0 || (t.fullManaSkillMul === 0 && t.lowManaSkillMul === 0)) return 0;
  const ratio = Math.min(1, state.player.mana / max);
  const full = ratio >= 1 ? t.fullManaSkillMul : 0;
  return full + t.lowManaSkillMul * (1 - ratio);
}

/** 武器・地形の誓約（鉄・溜め・滑り・熾火） */
function wave2KeystoneMul(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  let mul = 1;
  const melee = kind === "melee" && !skill;
  if (melee && hasKeystone(state, KS.ironOath)) mul *= holdsFavored(state) ? KEYSTONE.ironFavoredMul : KEYSTONE.ironUnfavoredMul;
  if (melee && hasKeystone(state, KS.chargeOath)) mul *= chargeOathMul(state);
  if (hasKeystone(state, KS.slickOath)) mul *= SLICK_GROUND.has(playerGround(state)) ? KEYSTONE.slickOnMul : KEYSTONE.slickOffMul;
  if (enemy !== null && hasKeystone(state, KS.emberOath)) {
    const lit = isBurning(enemy) || BURNING_GROUND.has(enemyGround(state, enemy));
    mul *= lit ? KEYSTONE.emberOnMul : KEYSTONE.emberOffMul;
  }
  return mul;
}

function chargeOathMul(state: GameState): number {
  const level = state.player.attack.chargeLevel;
  if (level > 0) return 1 + KEYSTONE.chargeOathPerLevel * level;
  return weaponCharges(state) ? KEYSTONE.chargeOathUnchargedMul : 1;
}

/** 誓約の掛け算（楔・読み勝ち・背水・死神 + 第 2 弾の武器・地形） */
function keystoneOutgoingMul(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  if (state.stats.keystones.length === 0) return 1;
  let mul = wave2KeystoneMul(state, enemy, kind, skill);
  if (enemy !== null && hasKeystone(state, KS.wedgeOath) && !isStaggered(enemy)) mul *= KEYSTONE.wedgeUnstaggeredMul;
  if (enemy !== null && kind === "melee" && hasKeystone(state, KS.readOath) && enemy.phase !== "windup") {
    mul *= KEYSTONE.readOffWindupDamageMul;
  }
  if (hasKeystone(state, KS.backwater) && isEngaged(state)) mul *= KEYSTONE.backwaterDamageMul;
  if (hasKeystone(state, KS.reaperOath)) {
    mul *= state.reaper === null ? KEYSTONE.reaperOathDamageMul : KEYSTONE.reaperOathHuntedMul;
  }
  return mul;
}

/**
 * 性質・誓約による与ダメージ倍率。proc（燃焼・トリガーの衝撃波など）には掛けない
 * （既存の会心・コンボと同じ扱い）
 */
export function traitOutgoingMul(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  if (kind === "proc") return 1;
  let bonus = fieldBonus(state, kind) + wave2Bonus(state, enemy, kind, skill);
  if (enemy !== null) bonus += targetBonus(state, enemy);
  if (skill) bonus += skillBonus(state);
  const mul = Math.max(TRIGGER.trait.minMul, 1 + bonus);
  return mul * keystoneOutgoingMul(state, enemy, kind, skill);
}

// ---------------------------------------------------------------------------
// 属性（combat.ts の genreAndElement から。out は敵の防御と属性耐性を掛けた倍率と内訳）
// ---------------------------------------------------------------------------

function shareOf(out: OutgoingElement, element: Element): number {
  return out.shares.find((s) => s.element === element)?.share ?? 0;
}

/** 通電・引火: 濡れ / 油膜の敵へ。雷 / 炎の割合だけさらに伸びる */
function soakedBonus(state: GameState, enemy: Enemy, out: OutgoingElement): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.wetConductMul > 0 && (hasStatus(enemy.status, "wet") || hasStatus(enemy.status, "soaked"))) {
    bonus += t.wetConductMul * (1 + shareOf(out, "lightning"));
  }
  if (t.oiledIgniteMul > 0 && hasStatus(enemy.status, "oiled")) bonus += t.oiledIgniteMul * (1 + shareOf(out, "fire"));
  return bonus;
}

/** 耐性による減少を ratio だけ打ち消す倍率（ratio = 1 で耐性が無いのと同じ。弱点は触らない） */
function resistCompensation(enemy: Enemy, out: OutgoingElement, ratio: number): number {
  if (ratio <= 0 || out.affinity !== "resist") return 1;
  const elementMul = enemyElementMul(enemy, out.shares);
  if (elementMul <= 0 || elementMul >= 1) return 1;
  return 1 + (1 / elementMul - 1) * Math.min(1, ratio);
}

/** 属性の誓約（弱点・無） */
function keystoneElementMul(state: GameState, enemy: Enemy, out: OutgoingElement): number {
  if (state.stats.keystones.length === 0) return 1;
  let mul = 1;
  if (hasKeystone(state, KS.weakOath)) mul *= out.affinity === "weak" ? KEYSTONE.weakOathWeakMul : KEYSTONE.weakOathOtherMul;
  if (hasKeystone(state, KS.nullOath)) {
    const elementMul = enemyElementMul(enemy, out.shares);
    if (elementMul > 0) mul /= elementMul;
  }
  return mul;
}

/** 攻撃の主な属性の状態異常を付ける（無属性・対応の無い属性なら何もしない） */
function inflictElement(state: GameState, enemy: Enemy, element: Element | undefined, seconds: number): void {
  const kind = element === undefined ? undefined : ELEMENT_STATUS[element];
  if (kind === undefined || seconds <= 0) return;
  applyStatus(state, { kind: "enemy", enemy }, inflictApply(kind, seconds), "player");
}

/** 弱点・耐性の命中で起きること（弱点読み・逆撫で・来歴） */
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
 * 性質・誓約による属性まわりの倍率（弱点刺し・耐性破り・通電・引火・弱点の誓い・無の誓い）。
 * 弱点読みのマナ・逆撫での付与・来歴の記録もここで起こす（1 命中につき 1 回呼ばれる）。proc には掛けない
 */
export function traitElementMul(state: GameState, enemy: Enemy, out: OutgoingElement, kind: DamageKind): number {
  if (kind === "proc") return 1;
  const t = state.stats.traits;
  onAffinity(state, enemy, out);
  const affinityBonus = out.affinity === "weak" ? t.weakDamageMul : -t.nonWeakPenalty;
  const mul = Math.max(TRIGGER.trait.elementMinMul, 1 + affinityBonus + soakedBonus(state, enemy, out));
  return mul * resistCompensation(enemy, out, t.resistPierce) * keystoneElementMul(state, enemy, out);
}

// ---------------------------------------------------------------------------
// 怯み値（combat.ts の damageEnemy から）
// ---------------------------------------------------------------------------

function poiseBonus(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.fearPoiseMul !== 0 && hasStatus(enemy.status, "fear")) bonus += t.fearPoiseMul;
  if (t.silencedPoiseMul !== 0 && hasStatus(enemy.status, "silence")) bonus += t.silencedPoiseMul;
  if (t.vulnerablePoiseMul !== 0 && hasStatus(enemy.status, "vulnerable")) bonus += t.vulnerablePoiseMul;
  if (t.guardedPoiseMul !== 0 && hasStatus(enemy.status, "guarded")) bonus += t.guardedPoiseMul;
  if (t.wedgePoiseMul !== 0 || t.wedgePenalty !== 0) {
    bonus += poiseRatio(enemy) >= TRIGGER.trait.wedgeRatio ? t.wedgePoiseMul : -t.wedgePenalty;
  }
  if (kind === "ranged") bonus += t.rangedPoiseMul;
  if (crit) bonus += t.critPoiseMul;
  return bonus + wave2PoiseBonus(state, enemy, kind);
}

/**
 * 第 2 弾の怯み値（我流・散弾押し・溜め崩し・腐食の爪・持ち替え）。
 * damageEnemy はスキルかどうかを渡さないので、持ち替えは近接 / 射撃の区別だけで見る
 */
function wave2PoiseBonus(state: GameState, enemy: Enemy, kind: DamageKind): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (kind === "melee") {
    if (t.unfavoredPoiseMul !== 0 || t.favoredPoisePenalty !== 0) bonus += holdsFavored(state) ? -t.favoredPoisePenalty : t.unfavoredPoiseMul;
    bonus += t.chargedPoiseMul * state.player.attack.chargeLevel;
  }
  if (kind === "ranged" && statsBulletHas(state.stats, "spread")) bonus += t.spreadPoiseMul;
  if (t.corrodePoiseMul !== 0 && hasStatus(enemy.status, "corrode")) bonus += t.corrodePoiseMul;
  if (t.alternatePoiseMul !== 0 || t.repeatPoisePenalty !== 0) {
    const shift = modeShift(state, attackMode(kind, false));
    if (shift === "switched") bonus += t.alternatePoiseMul;
    if (shift === "repeated") bonus -= t.repeatPoisePenalty;
  }
  return bonus;
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
  let mul = 1;
  if (kind === "melee" && hasKeystone(state, KS.ironOath) && holdsFavored(state)) mul *= KEYSTONE.ironFavoredPoiseMul;
  if (hasKeystone(state, KS.chokehold)) mul *= guardCompensation(enemy, 1);
  if (kind === "melee" && hasKeystone(state, KS.readOath)) mul *= enemy.phase === "windup" ? KEYSTONE.readPoiseMul : 0;
  return mul;
}

/** 性質・誓約による怯み値の倍率（剥がし撃ちは堅守の半減を射撃だけ打ち消す） */
export function traitPoiseMul(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const base = Math.max(TRIGGER.trait.minMul, 1 + poiseBonus(state, enemy, kind, crit));
  const pierce = kind === "ranged" ? guardCompensation(enemy, state.stats.traits.guardPierce) : 1;
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
  if (t.healOnStagger > 0) healSustained(state, t.healOnStagger);
  staggerQuake(state, enemy, t.staggerQuake);
  if (t.placedExtend > 0) extendPlacedNear(state, enemy.body.pos, t.placedExtend);
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
  if (t.lastKillManaRatio > 0) gainMana(state, state.stats.maxMana * t.lastKillManaRatio);
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
  if (t.silencedKillMana > 0 && hasStatus(enemy.status, "silence")) gainMana(state, t.silencedKillMana);
  if (hasKeystone(state, KS.contagion)) spreadAfflictions(state, enemy);
  if (enemy.elite !== undefined) recordProvenance(state, { kind: "eliteKill" });
  onWave2Kill(state, enemy);
  if (isLastKillInEngagedRoom(state, enemy)) onLastKill(state);
}

/** 第 2 弾の撃破（流派の糧・宣告の鐘・封鎖の火花・地脈の炸裂・残り火・来歴） */
function onWave2Kill(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (holdsFavored(state)) {
    if (t.favoredKillMana > 0) gainMana(state, t.favoredKillMana);
    recordProvenance(state, { kind: "favoredKill" });
  }
  if (t.doomKillMana > 0 && hasStatus(enemy.status, "doom")) gainMana(state, t.doomKillMana);
  if (t.engagedKillEnergy > 0 && isEngaged(state)) gainEnergy(state, t.engagedKillEnergy);
  const ground = enemyGround(state, enemy);
  if (ground !== "none") {
    recordProvenance(state, { kind: "terrainKill" });
    if (t.terrainKillBlast > 0) groundBlast(state, enemy.body.pos, ground, t.terrainKillBlast);
  }
  const fireSec = Math.max(t.burningKillFire, hasKeystone(state, KS.emberOath) ? KEYSTONE.emberKillFireSec : 0);
  if (fireSec > 0 && isBurning(enemy)) {
    placeTerrain(state, enemy.body.pos.x, enemy.body.pos.y, "fire", TRIGGER.trait.burningKillFireRadius, fireSec);
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

/** 性質による被ダメージ倍率（弱体の盾・第 2 弾の足元・交戦・属性・表裏・構えの誓い・身代わり）。身代わりはここでマナを払う */
export function traitIncomingMul(state: GameState, attacker: Enemy | undefined): number {
  const t = state.stats.traits;
  let mul = 1;
  if (attacker !== undefined && (t.weakenedGuard > 0 || t.weakenedExposure > 0)) {
    mul *= hasStatus(attacker.status, "weaken") ? 1 - t.weakenedGuard : 1 + t.weakenedExposure;
  }
  mul *= wave2IncomingMul(state, attacker);
  return Math.max(TRIGGER.trait.minMul, mul) * manaShieldMul(state);
}

function wave2IncomingMul(state: GameState, attacker: Enemy | undefined): number {
  const t = state.stats.traits;
  const p = state.player;
  let mul = 1;
  if (t.terrainGuard > 0 && playerGround(state) !== "none") mul *= 1 - t.terrainGuard;
  if (t.engagedGuard > 0 || t.roamExposure > 0) mul *= isEngaged(state) ? 1 - t.engagedGuard : 1 + t.roamExposure;
  if (attacker !== undefined && (t.elementalGuard > 0 || t.physicalExposure > 0)) {
    const element = enemyAttackOf(attacker)?.element ?? "none";
    mul *= element !== "none" ? 1 - t.elementalGuard : 1 + t.physicalExposure;
  }
  if (t.lowHpGuard > 0 && p.hp < p.maxHp * HALF) mul *= 1 - t.lowHpGuard;
  if (hasKeystone(state, KS.stanceOath)) {
    const swinging = p.attack.phase === "windup" || p.attack.phase === "active";
    mul *= swinging ? KEYSTONE.stanceGuardMul : KEYSTONE.stanceExposedMul;
  }
  return mul;
}

// ---------------------------------------------------------------------------
// マナ（mana.ts の gainMana から）
// ---------------------------------------------------------------------------

/** 底打ち: マナが少ない間の回収倍率 */
export function traitManaGainMul(state: GameState): number {
  const t = state.stats.traits;
  if (t.lowManaGainMul <= 0) return 1;
  const low = state.player.mana < state.stats.maxMana * TRIGGER.trait.lowManaRatio;
  return low ? 1 + t.lowManaGainMul : 1;
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

/** 毎ステップの性質（死神の誓い・余韻斬り・血の署名・第 2 弾の持ち替え・足元） */
export function tickTraitClocks(state: GameState, dt: number): void {
  tickReaperOath(state, dt);
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

/** 土の息・土の誓い: 地形の上に立つ間の回復（戦闘中も。回復の共通上限を受ける） */
function tickGroundMend(state: GameState, dt: number): void {
  const regen = state.stats.traits.terrainRegen + (hasKeystone(state, KS.earthOath) ? KEYSTONE.earthRegenPerSec : 0);
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

/** 鏡像: 装備トリガーの内部クールダウンに掛ける倍率（system/triggers.ts の fireTrigger） */
export function traitTriggerIcdMul(state: GameState): number {
  return 1 - Math.min(TRIGGER_ICD_CUT_MAX, Math.max(0, state.stats.traits.triggerIcdCut));
}

/** 死神の誓い: 死神の時計（floorTime）を速める。reaper.ts は floorTime だけを見て出現を決める */
function tickReaperOath(state: GameState, dt: number): void {
  if (!hasKeystone(state, KS.reaperOath) || state.reaper !== null) return;
  state.floorTime += dt * (KEYSTONE.reaperOathClockMul - 1);
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

/** 溜め崩し・派生の冴え（必殺ゲージ・気力）と来歴 */
function onMeleeFormHit(state: GameState): void {
  const t = state.stats.traits;
  const a = state.player.attack;
  if (a.chargeLevel > 0) {
    if (t.chargedHitEnergy > 0) gainEnergy(state, t.chargedHitEnergy * a.chargeLevel);
    recordProvenance(state, { kind: "chargedHit" });
  }
  if (a.branch >= 0) {
    if (t.branchHitMana > 0) gainMana(state, t.branchHitMana);
    recordProvenance(state, { kind: "branchHit" });
  }
}

/** 追尾の毒・連射の烙印（弾の性質で決まる付与）。確率は性質を持つときだけ引く（乱数列を変えない） */
function onShotHit(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  const target = { kind: "enemy" as const, enemy };
  if (t.homingPoison > 0 && statsBulletHas(state.stats, "homing")) applyStatus(state, target, inflictApply("poison", t.homingPoison), "player");
  if (t.rapidBrandChance > 0 && statsBulletHas(state.stats, "rapid") && state.rng.chance(t.rapidBrandChance)) {
    applyStatus(state, target, { kind: "brand", stacks: 1, duration: TRIGGER.trait.rapidBrandSec, potency: 0 }, "player");
  }
}

/** 持ち替え: 手替えの呼吸・鎖の気力、天秤の重なり。最後に直前の手段を更新する */
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

/** 状態異常を持つ自分の設置物（雷撃 = 感電・引力球 = 沈黙・氷結地帯 = 冷気）の範囲 */
function placedZones(state: GameState): PlacedZone[] {
  const rs = state.skills;
  return [
    ...rs.strikes.map((s) => ({ pos: s.pos, radius: SKILL.thunder.radius * s.params.areaMul, status: "shock" as const })),
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

/** 杭打ち: 怯ませた敵の近くの設置物（引力球・氷結地帯・地雷）を長持ちさせる */
function extendPlacedNear(state: GameState, pos: Vec, seconds: number): void {
  const rs = state.skills;
  const near = (at: Vec): boolean => dist(at, pos) <= TRIGGER.trait.placedExtendRadius;
  for (const w of rs.wells) {
    if (!near(w.pos)) continue;
    w.timer += seconds;
    w.total = Math.max(w.total, w.timer);
  }
  for (const f of rs.fields) {
    if (!near(f.pos)) continue;
    f.timer += seconds;
    f.total = Math.max(f.total, f.timer);
  }
  for (const m of rs.mines) if (near(m.pos)) m.life += seconds;
}
