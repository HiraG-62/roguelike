import { type Enemy, type GameState, pushSfx } from "../core/state";
import { pushReactionEvent } from "../core/events";
import { REACTION_LABEL, type ReactionKey, type StatusBag, type StatusEffect, type StatusEndCause, type StatusKind, type StatusSource } from "../core/status";
import { STATUS } from "../data/tuning";
import { TRAIT_COLORS, type TraitColor } from "../loot/types";
import { healPlayer } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { gainMana } from "./mana";
import {
  type OnHitContext,
  type Reaction,
  type StatusTarget,
  applyStatus,
  bagOf,
  chainLightning,
  consumeStacks,
  convertStatus,
  enemiesInRadius,
  findStatus,
  hasStatus,
  hurtEnemy,
  hurtTarget,
  isBossTarget,
  nearestEnemyWithin,
  removeStatus,
  statusStacks,
  targetAlive,
  targetPos,
} from "./statusEffects";
import { igniteTerrainAt, placeTerrain } from "./terrain";

/**
 * 反応と昇華（docs/ideas/status-and-terrain.md 2・5 章）。statusEffects.ts の applyStatus が付与の前後に呼ぶ。
 * 各反応のコメントは「出す側（消費される状態）/ 食う側（反応を起こして残る状態）」を書く。
 * 両方消える反応は「両消」、状態が付いている間ずっと効くものは「常時」（ICD なし）
 */

/** 反応ごとの ICD（秒）。0 = 常時の反応か、付与そのものが上限で絞られている反応 */
const REACTION_ICD: Readonly<Record<ReactionKey, number>> = {
  vaporize: 0, // 既存の蒸発は ICD なしのまま（燃焼・冷気の付与が onHitIcd で絞られている）
  steam: STATUS.reactionIcd,
  quench: STATUS.reactionIcd,
  conduct: STATUS.reactionIcd,
  ignite: STATUS.reactionIcd,
  kindle: STATUS.reactionIcd,
  miasma: STATUS.reactionIcd,
  shatterBleed: 0, // 砕きそのものが凍結 1 回に 1 度
  cauterize: STATUS.reactionIcd,
  dissolve: 0,
  lacerate: 0,
  collapse: 0,
  exposeDoom: 0,
  wither: 0,
  frostPoison: 0,
  panic: 0,
  brandBurst: 0, // 烙印を全部使い切るので連打にならない
  thaw: 0,
  rage: 0,
  discharge: 0,
  iceArmor: 0,
  hueBurst: 0, // 彩痕を消費する
  manaCut: 0,
  rally: STATUS.reactionIcd,
};

const REACTION_TEXT_COLOR = "#ffe8a0";
const REACTION_TEXT_SCALE = 0.8;
const REACTION_TEXT_LIFE = 0.5;
const STEAM_COLOR = "#e8f0ff";
const STEAM_PARTICLES = 8;
const BLAZE_COLOR = "#ff6020";
const SHARD_COLOR = "#c0f0ff";
const SHARD_PARTICLES = 16;
const BRAND_COLOR = "#ff5040";
const TERRAIN_IGNITE_RADIUS = 8;
/** 彩痕の色 → 色爆を起こす状態異常（docs/ideas/status-and-terrain.md 2 章 #20） */
const HUE_TRIGGER: Readonly<Record<TraitColor, StatusKind>> = {
  crimson: "burn",
  azure: "chill",
  jade: "poison",
  gold: "shock",
  umbra: "vulnerable",
};

// -----------------------------------------------------------------------------
// ICD と記録
// -----------------------------------------------------------------------------

/** 反応を起こせるか判定し、起こせるなら ICD と「直前の反応」を記録する */
function fire(state: GameState, target: StatusTarget, key: ReactionKey, showText = true): boolean {
  const bag = bagOf(state, target);
  const icd = bag.reactionIcd ?? {};
  if ((icd[key] ?? 0) > 0) return false;
  if (REACTION_ICD[key] > 0) {
    icd[key] = REACTION_ICD[key];
    bag.reactionIcd = icd;
  }
  bag.lastReaction = { key, tick: state.tick };
  pushReactionEvent(state, enemyOf(target), key);
  if (showText) addFloatingText(state, targetPos(state, target), REACTION_LABEL[key], REACTION_TEXT_COLOR, REACTION_TEXT_SCALE, REACTION_TEXT_LIFE);
  return true;
}

export function tickReactionIcd(bag: StatusBag, dt: number): void {
  const icd = bag.reactionIcd;
  if (!icd) return;
  for (const key of Object.keys(icd) as ReactionKey[]) {
    const left = (icd[key] ?? 0) - dt;
    if (left > 0) icd[key] = left;
    else delete icd[key];
  }
}

function isPlayer(target: StatusTarget): boolean {
  return target.kind === "player";
}

/** 昇華できる対象（敵のうちボス以外。ボスは凍結しないのと同じ扱い） */
function canSublimate(target: StatusTarget): boolean {
  return target.kind === "enemy" && !isBossTarget(target);
}

function enemyOf(target: StatusTarget): Enemy | null {
  return target.kind === "enemy" ? target.enemy : null;
}

// -----------------------------------------------------------------------------
// 付与の前（付与そのものを止める・消費する反応）
// -----------------------------------------------------------------------------

/** 付与の前の反応。consumed = 反応で使い切った（付与は成功扱い）/ blocked = 付かない */
export function reactBefore(
  state: GameState,
  target: StatusTarget,
  kind: StatusKind,
  potency: number,
  duration: number,
  source: StatusSource,
): Reaction {
  if (kind === "burn") return beforeBurn(state, target, potency, duration, source);
  if (kind === "chill") return beforeChill(state, target);
  return "none";
}

function beforeBurn(state: GameState, target: StatusTarget, potency: number, duration: number, source: StatusSource): Reaction {
  const bag = bagOf(state, target);
  if (hasStatus(bag, "freeze")) {
    // 凍結は解ける（砕きなし）。燃焼はそのまま付く。氷棺なら融解して水たまりを残す
    thaw(state, target);
    removeStatus(state, target, "freeze", "consume");
    return "none";
  }
  const scorched = hasStatus(bag, "scorch");
  // 浸水: 燃焼は一切付かない（灼熱だけは濡れで消えない）
  if (!scorched && hasStatus(bag, "soaked")) return "blocked";
  if (!scorched && hasStatus(bag, "wet")) {
    steam(state, target, source);
    return "consumed";
  }
  if (!hasStatus(bag, "chill")) return "none";
  // 蒸発（両消）: 燃焼の残りダメージの一部を即時。灼熱中は大蒸発
  removeStatus(state, target, "chill", "consume");
  vaporize(state, target, potency * duration * (scorched ? STATUS.scorch.vaporizeMul : 1));
  return "consumed";
}

function beforeChill(state: GameState, target: StatusTarget): Reaction {
  const bag = bagOf(state, target);
  if (hasStatus(bag, "freeze")) return countEncase(state, target);
  // 奮起（出す側: 冷気 / 食う側: 加速）: 加速中の冷気は付かず、加速が延びる
  const haste = findStatus(bag, "haste");
  if (haste && fire(state, target, "rally", false)) {
    haste.time = Math.min(STATUS.haste.maxTime, haste.time + STATUS.haste.chillExtend);
    haste.maxTime = Math.max(haste.maxTime, haste.time);
    return "consumed";
  }
  const burn = findStatus(bag, "burn");
  if (!burn) return "none";
  // 蒸発（両消）
  const remaining = burn.potency * burn.time * (hasStatus(bag, "scorch") ? STATUS.scorch.vaporizeMul : 1);
  removeStatus(state, target, "burn", "consume");
  vaporize(state, target, remaining);
  return "consumed";
}

/** 蒸発: 燃焼の残りダメージの一部を即時に与える */
function vaporize(state: GameState, target: StatusTarget, burnLeft: number): void {
  fire(state, target, "vaporize", false);
  const amount = Math.round(burnLeft * STATUS.vaporizeRatio);
  spawnBurst(state, targetPos(state, target), STEAM_COLOR, STEAM_PARTICLES + 2, 70, 0.4, 2);
  pushSfx(state, "burn");
  if (amount <= 0) return;
  hurtTarget(state, target, amount);
}

/**
 * 蒸気（出す側: 濡れ 1 / 食う側: 燃焼。燃焼は付かない）: 濡れていると燃焼が付かない。
 * プレイヤー由来なら湯気で周囲の敵の狙いが鈍る（弱体）
 */
function steam(state: GameState, target: StatusTarget, source: StatusSource): void {
  consumeStacks(state, target, "wet", 1);
  spawnBurst(state, targetPos(state, target), STEAM_COLOR, STEAM_PARTICLES, 50, 0.4, 2);
  if (source !== "player" || !fire(state, target, "steam")) return;
  const weaken = { kind: "weaken" as const, stacks: 1, duration: STATUS.steam.weakenDuration, potency: 0 };
  for (const e of enemiesInRadius(state, targetPos(state, target), STATUS.steam.radius)) {
    applyStatus(state, { kind: "enemy", enemy: e }, weaken, source);
  }
}

/**
 * 氷棺（昇華: 凍結中の冷気）: 凍結中に冷気が encase.threshold 回入ると氷棺。凍結は延ばさない（拘束上限を守る）。
 * 冷気は凍結の中に吸われる（付与は成功扱い）
 */
function countEncase(state: GameState, target: StatusTarget): Reaction {
  const bag = bagOf(state, target);
  const freeze = findStatus(bag, "freeze");
  if (!freeze || !canSublimate(target)) return "blocked";
  freeze.reapplied = (freeze.reapplied ?? 0) + 1;
  if (freeze.reapplied >= STATUS.encase.threshold && !hasStatus(bag, "encase")) {
    applyStatus(state, target, { kind: "encase", stacks: 1, duration: freeze.time, potency: 0 }, "env");
  }
  return "consumed";
}

/** 融解（出す側: 氷棺 / 食う側: 燃焼）: 氷棺が燃焼で解けると足元に水たまり */
function thaw(state: GameState, target: StatusTarget): void {
  const bag = bagOf(state, target);
  if (!hasStatus(bag, "encase")) return;
  removeStatus(state, target, "encase", "consume");
  fire(state, target, "thaw");
  const pos = targetPos(state, target);
  placeTerrain(state, pos.x, pos.y, "water", STATUS.encase.thawRadius);
}

// -----------------------------------------------------------------------------
// 付与の後（付いた状態と既にある状態の反応・昇華）
// -----------------------------------------------------------------------------

export function reactAfter(state: GameState, target: StatusTarget, kind: StatusKind, source: StatusSource): void {
  if (!targetAlive(state, target)) return;
  switch (kind) {
    case "burn":
      afterBurn(state, target, source);
      break;
    case "oiled":
      if (hasStatus(bagOf(state, target), "burn")) ignite(state, target, source);
      break;
    case "wet":
      afterWet(state, target);
      break;
    case "chill":
      quench(state, target);
      break;
    case "shock":
      afterShock(state, target, source);
      break;
    case "poison":
      sublimateAt(state, target, "poison", STATUS.poison.maxStacks, "venom", STATUS.venom.duration, 0, source);
      break;
    case "bleed": {
      const bleed = findStatus(bagOf(state, target), "bleed");
      const potency = bleed ? Math.max(1, bleed.potency) * bleed.stacks : 0;
      sublimateAt(state, target, "bleed", STATUS.bleed.maxStacks, "hemorrhage", STATUS.hemorrhage.duration, potency, source);
      break;
    }
    case "vulnerable":
      sublimateOnReapply(state, target, "vulnerable", STATUS.exposed.threshold, "exposed", STATUS.exposed.duration, source);
      break;
    case "weaken":
      sublimateOnReapply(state, target, "weaken", STATUS.enfeeble.threshold, "enfeeble", STATUS.enfeeble.duration, source);
      break;
    case "broken":
      // 崩勢は堅守を食う: 付いた瞬間に堅守が外れる
      removeStatus(state, target, "guarded", "consume");
      break;
    case "stagger":
      rage(state, target);
      break;
    case "wrath":
      afterWrath(state, target);
      break;
    default:
      break;
  }
  if (targetAlive(state, target)) hueBurst(state, target, kind, source);
}

function afterBurn(state: GameState, target: StatusTarget, source: StatusSource): void {
  const bag = bagOf(state, target);
  if (hasStatus(bag, "oiled")) ignite(state, target, source);
  if (hasStatus(bag, "poison")) miasma(state, target, source);
  if (hasStatus(bag, "bleed")) cauterize(state, target);
  if (!targetAlive(state, target)) return;
  sublimateAt(state, target, "burn", STATUS.burnMaxStacks, "scorch", STATUS.scorch.duration, 0, source);
  const pos = targetPos(state, target);
  igniteTerrainAt(state, pos.x, pos.y, TERRAIN_IGNITE_RADIUS);
}

/**
 * 炎上（出す側: 油膜 / 食う側: 燃焼）: 油膜の敵に燃焼が入ると炎上（燃焼 dps × 2、周囲の油膜の敵・油の地形へ燃え移る）。
 * プレイヤーは炎上しない（油膜が消えるだけ）
 */
function ignite(state: GameState, target: StatusTarget, source: StatusSource): void {
  if (!fire(state, target, "ignite")) return;
  const burn = findStatus(bagOf(state, target), "burn");
  removeStatus(state, target, "oiled", "consume");
  const dps = Math.max(STATUS.blaze.minDps, (burn?.potency ?? 0) * STATUS.blaze.dpsMul);
  applyStatus(state, target, { kind: "blaze", stacks: 1, duration: STATUS.blaze.duration, potency: dps }, source);
  spawnBurst(state, targetPos(state, target), BLAZE_COLOR, STEAM_PARTICLES, 90, 0.4, 2);
  pushSfx(state, "burn");
}

/** 毒霧（出す側: 毒 / 食う側: 燃焼）: 毒の全スタックを雲（毒沼の地形）にして周囲へ毒 1 ずつ。敵にだけ起きる */
function miasma(state: GameState, target: StatusTarget, source: StatusSource): void {
  const e = enemyOf(target);
  if (!e || !fire(state, target, "miasma")) return;
  const poison = findStatus(e.status, "poison");
  removeStatus(state, target, "poison", "consume");
  const pos = e.body.pos;
  placeTerrain(state, pos.x, pos.y, "bog", STATUS.miasma.terrainRadius, STATUS.miasma.duration);
  const spread = { kind: "poison" as const, stacks: 1, duration: STATUS.poison.duration, potency: poison?.potency ?? 0 };
  for (const other of enemiesInRadius(state, pos, STATUS.miasma.radius)) {
    if (other.id === e.id) continue;
    applyStatus(state, { kind: "enemy", enemy: other }, spread, source === "player" ? "env" : source);
  }
}

/** 焼灼（出す側: 出血 / 食う側: 燃焼）: 出血を焼き止め、残りを即時ダメージに。自分にも起きる（小さく） */
function cauterize(state: GameState, target: StatusTarget): void {
  if (!fire(state, target, "cauterize")) return;
  const bleed = findStatus(bagOf(state, target), "bleed");
  if (!bleed) return;
  const amount = bleed.stacks * Math.max(1, bleed.potency) * bleed.time * STATUS.cauterize.perStackSec;
  removeStatus(state, target, "bleed", "consume");
  hurtTarget(state, target, isPlayer(target) ? amount * STATUS.cauterize.playerMul : amount);
}

/** 濡れた後: 燃えていれば火が消える（蒸気と同じ。灼熱は消えない）、3 で浸水へ昇華 */
function afterWet(state: GameState, target: StatusTarget): void {
  const bag = bagOf(state, target);
  if (!hasStatus(bag, "scorch") && (hasStatus(bag, "burn") || hasStatus(bag, "blaze"))) {
    removeStatus(state, target, "burn", "consume");
    removeStatus(state, target, "blaze", "consume");
    consumeStacks(state, target, "wet", 1);
    spawnBurst(state, targetPos(state, target), STEAM_COLOR, STEAM_PARTICLES, 50, 0.4, 2);
    return;
  }
  // 浸水はプレイヤーにも付く（水の中では動きが重い）
  if (statusStacks(bag, "wet") < STATUS.wet.maxStacks) return;
  applyStatus(state, target, { kind: "soaked", stacks: 1, duration: STATUS.soaked.duration, potency: 0 }, "env");
}

/** 急冷（出す側: 濡れ / 食う側: 冷気）: 濡れを全部使って冷気 +2。濡れ 3 なら冷気を上限まで積む（敵は即凍結） */
function quench(state: GameState, target: StatusTarget): void {
  const bag = bagOf(state, target);
  const wet = findStatus(bag, "wet");
  const chill = findStatus(bag, "chill");
  if (!wet || !chill || !fire(state, target, "quench")) return;
  const cap = isPlayer(target) ? STATUS.chill.playerMaxStacks : STATUS.chill.maxStacks;
  const bonus = wet.stacks >= STATUS.wet.maxStacks ? cap : STATUS.quench.chillBonus;
  chill.stacks = Math.min(cap, chill.stacks + bonus);
  removeStatus(state, target, "wet", "consume");
}

function afterShock(state: GameState, target: StatusTarget, source: StatusSource): void {
  const bag = bagOf(state, target);
  const e = enemyOf(target);
  if (!e) return;
  // 浸水中の感電は即麻痺（拘束上限の範囲内）
  if (hasStatus(bag, "soaked") && !isBossTarget(target)) {
    convertStatus(state, target, "shock", "paralyze", STATUS.paralyze.duration, source);
    return;
  }
  if (hasStatus(bag, "wet")) conduct(state, e, source);
  // 引火（出す側: なし / 食う側: 油膜）: 油膜の敵に感電が入ると燃焼 → そのまま炎上へつながる
  if (hasStatus(e.status, "oiled") && fire(state, target, "kindle")) {
    applyStatus(state, target, { kind: "burn", stacks: 1, duration: STATUS.kindle.duration, potency: STATUS.kindle.dps }, source);
  }
}

/** 拡散（出す側: 濡れ 1 / 食う側: 感電）: 濡れた敵に感電が入った瞬間、広い連鎖雷。濡れた敵を優先して飛ぶ */
function conduct(state: GameState, e: Enemy, source: StatusSource): void {
  const target: StatusTarget = { kind: "enemy", enemy: e };
  if (!fire(state, target, "conduct")) return;
  const shock = findStatus(e.status, "shock");
  consumeStacks(state, target, "wet", 1);
  const damage = shock && shock.potency > 0 ? shock.potency : STATUS.conduct.damage;
  chainLightning(state, e.body.pos, damage, e.id, {
    radius: STATUS.shockRadius * STATUS.conduct.radiusMul,
    maxTargets: STATUS.shockMaxTargets + STATUS.conduct.extraTargets,
    prefer: (other) => hasStatus(other.status, "wet"),
  });
  if (source === "player") pushSfx(state, "shock");
}

/** 逆上（出す側: 怯み（自）/ 食う側: 怒気）: 怒気が付いている間に自分が怯むと怒気 +2 */
function rage(state: GameState, target: StatusTarget): void {
  if (!isPlayer(target) || !hasStatus(bagOf(state, target), "wrath")) return;
  fire(state, target, "rage", false);
  applyStatus(state, target, { kind: "wrath", stacks: STATUS.wrath.onStagger, duration: STATUS.wrath.duration, potency: 0 }, "env");
}

/** 激昂（昇華: 怒気 5）: 怒気を使い切って激昂 */
function afterWrath(state: GameState, target: StatusTarget): void {
  if (statusStacks(bagOf(state, target), "wrath") < STATUS.wrath.maxStacks) return;
  convertStatus(state, target, "wrath", "fury", STATUS.fury.duration, "env");
}

/** 昇華（上乗せ型）: from が threshold スタックに届いたら上位の状態を足す（元の状態は残る） */
function sublimateAt(
  state: GameState,
  target: StatusTarget,
  from: StatusKind,
  threshold: number,
  to: StatusKind,
  duration: number,
  potency: number,
  source: StatusSource,
): void {
  if (!canSublimate(target)) return;
  if (statusStacks(bagOf(state, target), from) < threshold) return;
  applyStatus(state, target, { kind: to, stacks: 1, duration, potency }, source);
}

/** 昇華（付け直し型）: 付いている間に threshold 回付け直すと上位の状態を足す（脆弱 → 露呈、弱体 → 無力） */
function sublimateOnReapply(
  state: GameState,
  target: StatusTarget,
  from: StatusKind,
  threshold: number,
  to: StatusKind,
  duration: number,
  source: StatusSource,
): void {
  if (!canSublimate(target)) return;
  const effect = findStatus(bagOf(state, target), from);
  if (!effect || (effect.reapplied ?? 0) < threshold) return;
  effect.reapplied = 0;
  applyStatus(state, target, { kind: to, stacks: 1, duration, potency: 0 }, source);
}

// -----------------------------------------------------------------------------
// 彩痕と色爆
// -----------------------------------------------------------------------------

function hueColor(effect: StatusEffect): TraitColor | undefined {
  return TRAIT_COLORS[Math.round(effect.potency)];
}

/** 彩痕の色がプレイヤーの共鳴（支配・二重）の色と同じか。同じなら被ダメ ×hue.takenMul */
export function hueMatchesResonance(state: GameState, e: Enemy): boolean {
  const hue = findStatus(e.status, "hue");
  if (!hue) return false;
  const color = hueColor(hue);
  return color !== undefined && state.stats.resonance.colors.includes(color);
}

/** 色爆（出す側: 彩痕 / 食う側: 色に対応する状態異常）: 彩痕を消費して色ごとの小爆発 */
function hueBurst(state: GameState, target: StatusTarget, kind: StatusKind, source: StatusSource): void {
  const e = enemyOf(target);
  if (!e || source !== "player") return;
  const hue = findStatus(e.status, "hue");
  if (!hue) return;
  const color = hueColor(hue);
  if (!color || HUE_TRIGGER[color] !== kind) return;
  removeStatus(state, target, "hue", "consume");
  fire(state, target, "hueBurst");
  spawnRing(state, e.body.pos, STATUS.explodeRadius / 2, STATUS.explodeColor, STATUS.fxLife);
  applyHueBurst(state, target, e, color);
}

function applyHueBurst(state: GameState, target: StatusTarget, e: Enemy, color: TraitColor): void {
  switch (color) {
    case "crimson": {
      const burn = findStatus(e.status, "burn");
      if (burn) hurtEnemy(state, e, burn.potency * burn.time * STATUS.hue.burstBurnRatio);
      return;
    }
    case "azure":
      applyStatus(state, target, { kind: "chill", stacks: STATUS.hue.burstChill, duration: STATUS.chill.duration, potency: 0 }, "player");
      return;
    case "jade":
      healPlayer(state, STATUS.hue.burstHeal);
      return;
    case "gold":
      applyStatus(state, target, { kind: "paralyze", stacks: 1, duration: STATUS.paralyze.duration, potency: 0 }, "player");
      return;
    case "umbra":
      applyStatus(state, target, { kind: "doom", stacks: 1, duration: STATUS.hue.burstDoomDuration, potency: 0 }, "player");
      return;
  }
}

// -----------------------------------------------------------------------------
// 周期（延焼）
// -----------------------------------------------------------------------------

/**
 * 灼熱: 周期ごとに周囲の敵へ燃焼 1。炎上: 周期ごとに周囲の油膜の敵へ燃焼（→ 炎上）と足元の油・草に火。
 * プレイヤー由来の延焼は env にして、祝福の野火などが延焼先でさらに連鎖しないようにする
 */
export function tickSpread(state: GameState, target: StatusTarget, effect: StatusEffect, dt: number): void {
  const interval = effect.kind === "blaze" ? STATUS.blaze.spreadInterval : STATUS.scorch.spreadInterval;
  effect.tick += dt;
  if (effect.tick < interval) return;
  effect.tick -= interval;
  const pos = targetPos(state, target);
  igniteTerrainAt(state, pos.x, pos.y, TERRAIN_IGNITE_RADIUS);
  const burn = findStatus(bagOf(state, target), "burn");
  const potency = Math.max(STATUS.kindle.dps, burn?.potency ?? 0);
  const spread = { kind: "burn" as const, stacks: 1, duration: STATUS.burnDuration, potency };
  const radius = effect.kind === "blaze" ? STATUS.blaze.spreadRadius : STATUS.scorch.spreadRadius;
  const selfId = target.kind === "enemy" ? target.enemy.id : -1;
  for (const other of enemiesInRadius(state, pos, radius)) {
    if (other.id === selfId) continue;
    if (effect.kind === "blaze" && !hasStatus(other.status, "oiled")) continue;
    applyStatus(state, { kind: "enemy", enemy: other }, spread, effect.source === "player" ? "env" : effect.source);
  }
}

// -----------------------------------------------------------------------------
// 解除・撃破
// -----------------------------------------------------------------------------

/** 状態異常が外れた瞬間の反応（statusEffects.ts の endEffect から呼ぶ） */
export function onEffectEnded(state: GameState, target: StatusTarget, effect: StatusEffect, cause: StatusEndCause): void {
  if (effect.kind === "freeze") onFreezeEnded(state, target, cause);
  if (effect.kind === "doom" && cause === "expire") detonateDoom(state, target, effect);
}

/**
 * 凍結が外れた: 砕き（cause = remove）なら氷棺の破片と砕血。どの理由でも氷棺は一緒に消える。
 * 砕きは damageEnemy の最中なので、本体へのダメージは次のステップへ遅らせる
 */
function onFreezeEnded(state: GameState, target: StatusTarget, cause: StatusEndCause): void {
  const e = enemyOf(target);
  if (!e) return;
  const encased = hasStatus(e.status, "encase");
  removeStatus(state, target, "encase", "consume");
  if (cause !== "remove") return;
  if (encased) encaseShards(state, e);
  shatterBleed(state, e);
}

/** 氷棺の砕き: 周囲に氷の破片（本体の最大 HP の割合、上限つき）と怯み値 */
function encaseShards(state: GameState, e: Enemy): void {
  const damage = Math.min(STATUS.encase.shardMax, e.maxHp * STATUS.encase.shardHpRatio);
  spawnRing(state, e.body.pos, STATUS.encase.shardRadius, SHARD_COLOR, STATUS.fxLife);
  spawnBurst(state, e.body.pos, SHARD_COLOR, SHARD_PARTICLES, 160, 0.4, 2);
  pushSfx(state, "freeze");
  for (const other of enemiesInRadius(state, e.body.pos, STATUS.encase.shardRadius)) {
    if (other.id === e.id) continue;
    hurtEnemy(state, other, damage, STATUS.encase.shardPoise);
  }
}

/** 砕血（出す側: 出血 / 食う側: 凍結の砕き）: 出血の残りを即時ダメージにし、近くの 1 体へ出血 1 */
function shatterBleed(state: GameState, e: Enemy): void {
  const bleed = findStatus(e.status, "bleed");
  if (!bleed) return;
  const target: StatusTarget = { kind: "enemy", enemy: e };
  fire(state, target, "shatterBleed");
  const amount = bleed.stacks * Math.max(1, bleed.potency) * bleed.time * STATUS.shatterBleed.perStackSec;
  removeStatus(state, target, "bleed", "consume");
  hurtEnemy(state, e, amount, 0, true);
  const next = nearestEnemyWithin(state, e.body.pos, STATUS.shatterBleed.spreadRadius, e.id);
  if (!next) return;
  applyStatus(state, { kind: "enemy", enemy: next }, { kind: "bleed", stacks: 1, duration: STATUS.bleed.duration, potency: bleed.potency }, "env");
}

/**
 * 宣告の時間切れ: 付与中に減った HP の一部をまとめて与える（暴露: 脆弱中は割合が上がる）。
 * 凍結中なら damageEnemy が砕きとして扱う（凍刻）
 */
function detonateDoom(state: GameState, target: StatusTarget, effect: StatusEffect): void {
  const e = enemyOf(target);
  if (!e || e.hp <= 0 || effect.hpMark === undefined) return;
  const exposed = hasStatus(e.status, "vulnerable");
  if (exposed) fire(state, target, "exposeDoom", false);
  const ratio = exposed ? STATUS.doom.vulnerableRatio : STATUS.doom.ratio;
  const lost = Math.max(0, effect.hpMark - e.hp);
  const amount = lost * ratio;
  if (amount < 1) return;
  spawnRing(state, e.body.pos, e.body.radius * 2, BRAND_COLOR, STATUS.fxLife);
  pushSfx(state, "explode");
  hurtEnemy(state, e, amount);
}

/** 撃破された敵の状態異常の後始末（1 回だけ）: 猛毒は毒沼を残す */
export function onEnemyDeathStatus(state: GameState, e: Enemy): void {
  if (!hasStatus(e.status, "venom")) return;
  removeStatus(state, { kind: "enemy", enemy: e }, "venom", "consume");
  placeTerrain(state, e.body.pos.x, e.body.pos.y, "bog", STATUS.venom.deathTerrainRadius);
}

// -----------------------------------------------------------------------------
// プレイヤーの命中ごとの反応（on-hit。ICD の確率付与とは別に毎回）
// -----------------------------------------------------------------------------

export function onPlayerHitReactions(state: GameState, enemy: Enemy, ctx: OnHitContext): void {
  siphon(state, enemy);
  if (enemy.hp <= 0) return;
  if (ctx.kind === "ranged" || ctx.skill === true) detonateBrand(state, enemy);
  if (ctx.kind === "melee" && ctx.skill !== true) discharge(state, enemy);
  extendHaste(state);
}

/** 吸魔: この敵への命中でマナ。沈黙中は倍（魔断）。倒したら残り秒ぶんのマナ */
function siphon(state: GameState, enemy: Enemy): void {
  const effect = findStatus(enemy.status, "siphon");
  if (!effect) return;
  const silenced = hasStatus(enemy.status, "silence");
  gainMana(state, STATUS.siphon.manaPerHit * (silenced ? STATUS.siphon.silencedMul : 1));
  if (enemy.hp > 0) return;
  gainMana(state, effect.time * STATUS.siphon.manaPerSecOnKill);
  removeStatus(state, { kind: "enemy", enemy }, "siphon", "consume");
}

/** 烙爆（出す側: 烙印 / 食う側: 射撃・スキルの命中）: 全スタックを起爆。怯み中なら × staggeredMul */
function detonateBrand(state: GameState, enemy: Enemy): void {
  const brand = findStatus(enemy.status, "brand");
  if (!brand) return;
  const target: StatusTarget = { kind: "enemy", enemy };
  fire(state, target, "brandBurst");
  const perStack = brand.potency > 0 ? brand.potency : STATUS.brand.damagePerStack;
  const staggered = hasStatus(enemy.status, "stagger") ? STATUS.brand.staggeredMul : 1;
  const amount = brand.stacks * perStack * staggered;
  const poise = brand.stacks * STATUS.brand.poisePerStack;
  removeStatus(state, target, "brand", "consume");
  spawnBurst(state, enemy.body.pos, BRAND_COLOR, SHARD_PARTICLES, 120, 0.35, 2);
  pushSfx(state, "explode");
  hurtEnemy(state, enemy, amount, poise);
}

/**
 * 帯電: 近接の命中で 1 回ぶん使い、当てた敵から連鎖雷 + 感電 1。
 * 放電（出す側: 濡れ（自）/ 食う側: 帯電）: 自分が濡れていると半径 ×2、代わりに自分へ小ダメージ
 */
function discharge(state: GameState, enemy: Enemy): void {
  const player: StatusTarget = { kind: "player" };
  const charged = findStatus(state.player.status, "charged");
  if (!charged) return;
  const wet = hasStatus(state.player.status, "wet");
  const damage = charged.potency > 0 ? charged.potency : STATUS.charged.damage;
  consumeStacks(state, player, "charged", 1);
  if (wet) {
    fire(state, player, "discharge", false);
    hurtTarget(state, player, STATUS.charged.wetSelfDamage);
  }
  const radius = STATUS.shockRadius * (wet ? STATUS.charged.wetRadiusMul : 1);
  chainLightning(state, enemy.body.pos, damage, enemy.id, { radius });
  applyStatus(state, { kind: "enemy", enemy }, { kind: "shock", stacks: 1, duration: STATUS.shock.duration, potency: damage }, "player");
}

/** 加速: 攻撃が当たるたびに延びる（動き続けて殴るほど続く） */
function extendHaste(state: GameState): void {
  const haste = findStatus(state.player.status, "haste");
  if (!haste) return;
  haste.time = Math.min(STATUS.haste.maxTime, haste.time + STATUS.haste.extendOnHit);
  haste.maxTime = Math.max(haste.maxTime, haste.time);
}
