import type { Rng } from "../core/rng";
import type {
  AffixKind,
  AffixRoll,
  Slot,
  TriggerCondition,
  TriggerEffectKind,
  TriggeredEffect,
  TriggerKind,
} from "./types";

/**
 * トリガー文法: trigger × condition × effect で条件付き効果を生成する。
 * docs/LOOT_DESIGN.md「設計哲学」4 / docs/ideas/build-diversity.md 3 章を参照。
 *
 * AffixRoll へのエンコード（可逆）:
 *   key    = "tr:<trigger>:<condition>:<effect>[:<every>][:x<count>]"
 *   value  = magnitude
 *   value2 = duration(0.1 秒単位) × 1000 + chance(1/1000 単位)
 *            例: duration 3.5s・chance 0.4 → 35 × 1000 + 400 = 35400
 */

export const TRIGGER_KEY_PREFIX = "tr:";
const KEY_SEPARATOR = ":";
const COUNT_MARK = "x";
/** chance は 1/1000 単位 */
export const CHANCE_SCALE = 1000;
/** duration は 0.1 秒単位 */
const DURATION_SCALE = 10;
/** 発動確率の全体範囲 */
export const MIN_TRIGGER_CHANCE = 0.15;
export const MAX_TRIGGER_CHANCE = 0.6;
/** 動的アフィックスの tier（UI 表示用。文法生成物は tier を持たない） */
const TRIGGER_TIER = 1;
/** magnitude のロール幅（基準値に対する倍率） */
const MAGNITUDE_VARIANCE_MIN = 0.85;
const MAGNITUDE_VARIANCE_MAX = 1.15;
const VARIANCE_STEPS = 100;
const DURATION_DECIMALS = 1;
const PERCENT_SCALE = 100;

// ---------------------------------------------------------------------------
// 語彙
// ---------------------------------------------------------------------------

interface NumRange {
  min: number;
  max: number;
}

interface TriggerSpec {
  /** 表示（everyNthMeleeHit は every を差し込む） */
  text: (every: number | undefined) => string;
  /** 発動確率（MIN_TRIGGER_CHANCE..MAX_TRIGGER_CHANCE の内側）。高頻度のトリガーほど低い */
  chance: NumRange;
  /** everyNthMeleeHit の N */
  every?: NumRange;
}

interface EffectSpec {
  /** itemLevel 0 での基準値 */
  base: number;
  /** itemLevel 1 あたりの基準値増加率 */
  perLevel: number;
  decimals: number;
  /** magnitude の上限（% 系の暴走防止） */
  cap?: number;
  count?: NumRange;
  /** 秒 */
  duration?: NumRange;
  text: (magnitude: string, count: number | undefined, duration: string | undefined) => string;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${n}${suffixes[n % 10] ?? "th"}`;
}

export const TRIGGER_SPECS: Readonly<Record<TriggerKind, TriggerSpec>> = {
  onMeleeHit: { text: () => "On melee hit", chance: { min: 0.15, max: 0.25 } },
  onShoot: { text: () => "On shoot", chance: { min: 0.15, max: 0.2 } },
  onKill: { text: () => "On kill", chance: { min: 0.3, max: 0.5 } },
  onJustDodge: { text: () => "On JUST dodge", chance: { min: 0.4, max: 0.6 } },
  onDash: { text: () => "On dash", chance: { min: 0.25, max: 0.4 } },
  onHurt: { text: () => "When hit", chance: { min: 0.3, max: 0.5 } },
  onRoomClear: { text: () => "On room clear", chance: { min: 0.4, max: 0.6 } },
  everyNthMeleeHit: {
    text: (every) => `Every ${ordinal(every ?? 0)} melee hit`,
    chance: { min: 0.4, max: 0.6 },
    every: { min: 4, max: 8 },
  },
};

export const CONDITION_TEXT: Readonly<Record<TriggerCondition, string>> = {
  always: "",
  aboveHalfHp: " (above 50% HP)",
  belowHalfHp: " (below 50% HP)",
  comboAbove10: " (10+ combo)",
  roomLocked: " (in a locked room)",
  fullEnergy: " (full energy)",
};

export const EFFECT_SPECS: Readonly<Record<TriggerEffectKind, EffectSpec>> = {
  shockwave: { base: 12, perLevel: 0.08, decimals: 0, text: (m) => `release a shockwave (${m} dmg)` },
  spawnBullets: {
    base: 5,
    perLevel: 0.08,
    decimals: 0,
    count: { min: 3, max: 6 },
    text: (m, c) => `fire ${c ?? 0} bullets (${m} dmg each)`,
  },
  chainLightning: { base: 10, perLevel: 0.08, decimals: 0, text: (m) => `call chain lightning (${m} dmg)` },
  burnNearby: {
    base: 4,
    perLevel: 0.08,
    decimals: 0,
    duration: { min: 2, max: 4 },
    text: (m, _c, d) => `ignite nearby enemies (${m} dps for ${d ?? "0"}s)`,
  },
  freezeNearby: {
    base: 30,
    perLevel: 0.02,
    decimals: 0,
    cap: 80,
    duration: { min: 1.5, max: 2.5 },
    text: (m, _c, d) => `chill nearby enemies by ${m}% for ${d ?? "0"}s`,
  },
  explode: { base: 16, perLevel: 0.08, decimals: 0, text: (m) => `explode (${m} dmg)` },
  heal: { base: 4, perLevel: 0.05, decimals: 0, text: (m) => `heal ${m} HP` },
  damageBuff: {
    base: 15,
    perLevel: 0.03,
    decimals: 0,
    cap: 60,
    duration: { min: 3, max: 5 },
    text: (m, _c, d) => `gain +${m}% damage for ${d ?? "0"}s`,
  },
  speedBuff: {
    base: 15,
    perLevel: 0.02,
    decimals: 0,
    cap: 40,
    duration: { min: 2, max: 4 },
    text: (m, _c, d) => `gain +${m}% move speed for ${d ?? "0"}s`,
  },
  energy: { base: 8, perLevel: 0.04, decimals: 0, text: (m) => `gain ${m} energy` },
  invuln: {
    base: 0.4,
    perLevel: 0,
    decimals: 1,
    text: (m) => `become invulnerable for ${m}s`,
  },
};

const TRIGGER_KINDS = Object.keys(TRIGGER_SPECS) as TriggerKind[];
const CONDITIONS = Object.keys(CONDITION_TEXT) as TriggerCondition[];
const EFFECT_KINDS = Object.keys(EFFECT_SPECS) as TriggerEffectKind[];

function isTriggerKind(s: string): s is TriggerKind {
  return Object.hasOwn(TRIGGER_SPECS, s);
}
function isCondition(s: string): s is TriggerCondition {
  return Object.hasOwn(CONDITION_TEXT, s);
}
function isEffectKind(s: string): s is TriggerEffectKind {
  return Object.hasOwn(EFFECT_SPECS, s);
}

/** スロットごとに出るトリガー（その部位らしい起点に寄せる）。ring / amulet は全部 */
export const SLOT_TRIGGERS: Readonly<Record<Slot, readonly TriggerKind[]>> = {
  weapon: ["onMeleeHit", "everyNthMeleeHit", "onKill", "onJustDodge"],
  gun: ["onShoot", "onKill", "onJustDodge"],
  armor: ["onHurt", "onKill", "onRoomClear"],
  boots: ["onDash", "onJustDodge", "onRoomClear"],
  ring: TRIGGER_KINDS,
  amulet: TRIGGER_KINDS,
};

// ---------------------------------------------------------------------------
// 組み合わせ表
// ---------------------------------------------------------------------------

/** 敵がいないと意味がない（部屋クリア時には使えない）効果 */
const OFFENSIVE_EFFECTS: ReadonlySet<TriggerEffectKind> = new Set([
  "shockwave",
  "spawnBullets",
  "chainLightning",
  "burnNearby",
  "freezeNearby",
  "explode",
]);
/** 無敵はここからしか出さない（常時無敵化を防ぐ） */
const INVULN_TRIGGERS: ReadonlySet<TriggerKind> = new Set(["onHurt", "onJustDodge"]);

/** 相性の悪い組み合わせを除外する */
export function isCompatible(trigger: TriggerKind, condition: TriggerCondition, effect: TriggerEffectKind): boolean {
  // 射撃で弾を出す → その弾でまた発動、の無限ループ気味
  if (trigger === "onShoot" && effect === "spawnBullets") return false;
  // 撃破で爆発 → 爆発で撃破 → …の連鎖暴走
  if (trigger === "onKill" && effect === "explode") return false;
  // クリア時には敵がいない / 部屋はロック解除される
  if (trigger === "onRoomClear" && OFFENSIVE_EFFECTS.has(effect)) return false;
  if (trigger === "onRoomClear" && condition === "roomLocked") return false;
  if (effect === "invuln" && !INVULN_TRIGGERS.has(trigger)) return false;
  // 無意味な条件
  if (effect === "heal" && condition === "aboveHalfHp") return false;
  if (effect === "energy" && condition === "fullEnergy") return false;
  return true;
}

export interface TriggerShape {
  trigger: TriggerKind;
  condition: TriggerCondition;
  effect: TriggerEffectKind;
}

/** 有効な trigger × condition × effect の全組み合わせ */
export const TRIGGER_GRAMMAR: readonly TriggerShape[] = TRIGGER_KINDS.flatMap((trigger) =>
  CONDITIONS.flatMap((condition) =>
    EFFECT_KINDS.filter((effect) => isCompatible(trigger, condition, effect)).map((effect) => ({
      trigger,
      condition,
      effect,
    })),
  ),
);

/** スロットで出うる組み合わせ */
export function grammarForSlot(slot: Slot): TriggerShape[] {
  const allowed = SLOT_TRIGGERS[slot];
  return TRIGGER_GRAMMAR.filter((shape) => allowed.includes(shape.trigger));
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function roundTo(v: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(v * scale) / scale;
}

function rollFloat(rng: Rng, range: NumRange, decimals: number): number {
  const scale = 10 ** decimals;
  return rng.int(Math.round(range.min * scale), Math.round(range.max * scale)) / scale;
}

function rollMagnitude(rng: Rng, spec: EffectSpec, itemLevel: number): number {
  const variance =
    MAGNITUDE_VARIANCE_MIN +
    (rng.int(0, VARIANCE_STEPS) / VARIANCE_STEPS) * (MAGNITUDE_VARIANCE_MAX - MAGNITUDE_VARIANCE_MIN);
  const raw = spec.base * (1 + spec.perLevel * itemLevel) * variance;
  const capped = spec.cap === undefined ? raw : Math.min(spec.cap, raw);
  const minimum = 10 ** -spec.decimals;
  return Math.max(minimum, roundTo(capped, spec.decimals));
}

function rollChance(rng: Rng, range: NumRange): number {
  const min = Math.max(MIN_TRIGGER_CHANCE, range.min);
  const max = Math.min(MAX_TRIGGER_CHANCE, range.max);
  return rng.int(Math.round(min * CHANCE_SCALE), Math.round(max * CHANCE_SCALE)) / CHANCE_SCALE;
}

/** 組み合わせを 1 つ具体化する。magnitude は itemLevel でスケール */
export function rollTriggerEffect(rng: Rng, shape: TriggerShape, itemLevel: number): TriggeredEffect {
  const triggerSpec = TRIGGER_SPECS[shape.trigger];
  const effectSpec = EFFECT_SPECS[shape.effect];
  const result: TriggeredEffect = {
    trigger: shape.trigger,
    condition: shape.condition,
    effect: shape.effect,
    magnitude: rollMagnitude(rng, effectSpec, itemLevel),
    chance: rollChance(rng, triggerSpec.chance),
  };
  if (triggerSpec.every !== undefined) result.every = rng.int(triggerSpec.every.min, triggerSpec.every.max);
  if (effectSpec.count !== undefined) result.count = rng.int(effectSpec.count.min, effectSpec.count.max);
  if (effectSpec.duration !== undefined) result.duration = rollFloat(rng, effectSpec.duration, DURATION_DECIMALS);
  return result;
}

/** 文法から条件付き効果を 1 つ生成する（スロット制限なし） */
export function generateTrigger(rng: Rng, itemLevel: number): TriggeredEffect {
  return rollTriggerEffect(rng, rng.pick(TRIGGER_GRAMMAR), itemLevel);
}

/**
 * スロットに合ったトリガーを生成し、AffixRoll にエンコードして返す。
 * kind はアフィックス枠（prefix / suffix）のどちらに入れるか。
 */
export function generateTriggerRoll(rng: Rng, itemLevel: number, slot: Slot, kind: AffixKind = "prefix"): AffixRoll {
  const effect = rollTriggerEffect(rng, rng.pick(grammarForSlot(slot)), itemLevel);
  return triggerToRoll(effect, kind);
}

// ---------------------------------------------------------------------------
// AffixRoll とのエンコード / デコード
// ---------------------------------------------------------------------------

export function isTriggerKey(key: string): boolean {
  return key.startsWith(TRIGGER_KEY_PREFIX);
}

export function triggerKey(effect: TriggeredEffect): string {
  const parts: string[] = [effect.trigger, effect.condition, effect.effect];
  if (effect.every !== undefined) parts.push(String(effect.every));
  if (effect.count !== undefined) parts.push(`${COUNT_MARK}${effect.count}`);
  return TRIGGER_KEY_PREFIX + parts.join(KEY_SEPARATOR);
}

function encodeValue2(effect: TriggeredEffect): number {
  const durationUnits = Math.round((effect.duration ?? 0) * DURATION_SCALE);
  return durationUnits * CHANCE_SCALE + Math.round(effect.chance * CHANCE_SCALE);
}

export function triggerToRoll(effect: TriggeredEffect, kind: AffixKind): AffixRoll {
  return {
    key: triggerKey(effect),
    kind,
    tier: TRIGGER_TIER,
    value: effect.magnitude,
    value2: encodeValue2(effect),
  };
}

/** 数字だけの部品 → every、"x<数字>" → count。それ以外は null で不正扱い */
function parseParams(params: readonly string[]): { every?: number; count?: number } | null {
  const out: { every?: number; count?: number } = {};
  for (const part of params) {
    if (/^\d+$/.test(part)) {
      out.every = Number(part);
      continue;
    }
    if (part.startsWith(COUNT_MARK) && /^\d+$/.test(part.slice(COUNT_MARK.length))) {
      out.count = Number(part.slice(COUNT_MARK.length));
      continue;
    }
    return null;
  }
  return out;
}

/** AffixRoll から TriggeredEffect を復元する。不正な key は null */
export function decodeTriggerRoll(roll: AffixRoll): TriggeredEffect | null {
  if (!isTriggerKey(roll.key)) return null;
  const [trigger, condition, effect, ...rest] = roll.key.slice(TRIGGER_KEY_PREFIX.length).split(KEY_SEPARATOR);
  if (trigger === undefined || !isTriggerKind(trigger)) return null;
  if (condition === undefined || !isCondition(condition)) return null;
  if (effect === undefined || !isEffectKind(effect)) return null;
  const params = parseParams(rest);
  if (params === null) return null;

  const value2 = roll.value2 ?? 0;
  const durationUnits = Math.floor(value2 / CHANCE_SCALE);
  const result: TriggeredEffect = {
    trigger,
    condition,
    effect,
    magnitude: roll.value,
    chance: (value2 % CHANCE_SCALE) / CHANCE_SCALE,
  };
  if (params.every !== undefined) result.every = params.every;
  if (params.count !== undefined) result.count = params.count;
  if (durationUnits > 0) result.duration = durationUnits / DURATION_SCALE;
  return result;
}

/** 例: "On kill (below 50% HP): 40% chance to gain +25% damage for 3s" */
export function formatTrigger(effect: TriggeredEffect): string {
  const effectSpec = EFFECT_SPECS[effect.effect];
  const head = `${TRIGGER_SPECS[effect.trigger].text(effect.every)}${CONDITION_TEXT[effect.condition]}`;
  const body = effectSpec.text(
    effect.magnitude.toFixed(effectSpec.decimals),
    effect.count,
    effect.duration === undefined ? undefined : String(effect.duration),
  );
  if (effect.chance >= 1) return `${head}: ${body}`;
  const chancePct = roundTo(effect.chance * PERCENT_SCALE, 1);
  return `${head}: ${chancePct}% chance to ${body}`;
}
