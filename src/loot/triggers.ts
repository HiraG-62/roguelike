import type { Rng } from "../core/rng";
import { type EventSource, triggerEventKind } from "../core/events";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY } from "../core/rules";
import { STATUS_LABEL, type StatusKind } from "../core/status";
import { PLAYER, TRIGGER } from "../data/tuning";
import type {
  AffixRoll,
  Slot,
  TraitColor,
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
 *   key    = "tr:<trigger>:<condition>:<effect>[:<every>][:x<count>][:@<status>]"
 *   value  = magnitude
 *   value2 = duration(0.1 秒単位) × 1000 + chance(1/1000 単位)
 *            例: duration 3.5s・chance 0.4 → 35 × 1000 + 400 = 35400
 */

export const TRIGGER_KEY_PREFIX = "tr:";
const KEY_SEPARATOR = ":";
const COUNT_MARK = "x";
/** inflict の状態異常の印（"@poison"） */
const STATUS_MARK = "@";
/** chance は 1/1000 単位 */
export const CHANCE_SCALE = 1000;
/** duration は 0.1 秒単位 */
const DURATION_SCALE = 10;
/** 発動確率の全体範囲 */
export const MIN_TRIGGER_CHANCE = 0.15;
export const MAX_TRIGGER_CHANCE = 0.6;
/** magnitude のロール幅（基準値に対する倍率） */
const MAGNITUDE_VARIANCE_MIN = 0.85;
const MAGNITUDE_VARIANCE_MAX = 1.15;
const VARIANCE_STEPS = 100;
const DURATION_DECIMALS = 1;
const PERCENT_SCALE = 100;
/** ダメージ系トリガー効果の magnitude 上限（base の何倍まで itemLevel で伸ばせるか） */
const DAMAGE_EFFECT_CAP_MUL = 4;
/** heal トリガー効果の magnitude 上限（PLAYER.maxHp に対する割合） */
const HEAL_EFFECT_CAP_RATIO = 0.3;

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
  /** status は inflict の状態異常の表示名 */
  text: (magnitude: string, count: number | undefined, duration: string | undefined, status: string) => string;
}

export const TRIGGER_SPECS: Readonly<Record<TriggerKind, TriggerSpec>> = {
  onMeleeHit: { text: () => "近接命中時", chance: { min: 0.15, max: 0.25 } },
  onShoot: { text: () => "射撃時", chance: { min: 0.15, max: 0.2 } },
  onKill: { text: () => "撃破時", chance: { min: 0.3, max: 0.5 } },
  onJustDodge: { text: () => "見切り時", chance: { min: 0.4, max: 0.6 } },
  onDash: { text: () => "ダッシュ時", chance: { min: 0.25, max: 0.4 } },
  onHurt: { text: () => "被弾時", chance: { min: 0.3, max: 0.5 } },
  onRoomClear: { text: () => "部屋制圧時", chance: { min: 0.4, max: 0.6 } },
  everyNthMeleeHit: {
    text: (every) => `${every ?? 0}回に1回の近接攻撃時`,
    chance: { min: 0.4, max: 0.6 },
    every: { min: 4, max: 8 },
  },
  onStagger: { text: () => "敵を怯ませた時", chance: { min: 0.35, max: 0.55 } },
  onCounter: { text: () => "カウンター時", chance: { min: 0.4, max: 0.6 } },
};

export const CONDITION_TEXT: Readonly<Record<TriggerCondition, string>> = {
  always: "",
  aboveHalfHp: "（生命 50% 以上）",
  belowHalfHp: "（生命 50% 未満）",
  comboAbove10: "（10 コンボ以上）",
  roomLocked: "（部屋で交戦中）",
  fullEnergy: "（必殺ゲージ満タン）",
  manaFull: "（気力満タン）",
  manaLow: "（気力残りわずか）",
  selfAfflicted: "（自分が状態異常中）",
  targetInWindup: "（相手が予備動作中）",
  targetGuarded: "（相手が堅守中）",
  targetMultiStatus: "（相手の状態異常が 2 種以上）",
  targetElite: "（相手が精鋭）",
};

export const EFFECT_SPECS: Readonly<Record<TriggerEffectKind, EffectSpec>> = {
  shockwave: {
    base: 12,
    perLevel: 0.08,
    decimals: 0,
    cap: 12 * DAMAGE_EFFECT_CAP_MUL,
    text: (m) => `衝撃波を放つ（${m} ダメージ）`,
  },
  spawnBullets: {
    base: 5,
    perLevel: 0.08,
    decimals: 0,
    cap: 5 * DAMAGE_EFFECT_CAP_MUL,
    count: { min: 3, max: 6 },
    text: (m, c) => `弾丸を${c ?? 0}発放つ（各${m} ダメージ）`,
  },
  chainLightning: {
    base: 10,
    perLevel: 0.08,
    decimals: 0,
    cap: 10 * DAMAGE_EFFECT_CAP_MUL,
    text: (m) => `連鎖雷を呼ぶ（${m} ダメージ）`,
  },
  burnNearby: {
    base: 4,
    perLevel: 0.08,
    decimals: 0,
    cap: 4 * DAMAGE_EFFECT_CAP_MUL,
    duration: { min: 2, max: 4 },
    text: (m, _c, d) => `周囲の敵を炎上させる（${m} ダメージ/秒、${d ?? "0"} 秒間）`,
  },
  freezeNearby: {
    base: 30,
    perLevel: 0.02,
    decimals: 0,
    cap: 80,
    duration: { min: 1.5, max: 2.5 },
    text: (m, _c, d) => `周囲の敵を${m}%凍結させる（${d ?? "0"} 秒間）`,
  },
  explode: {
    base: 16,
    perLevel: 0.08,
    decimals: 0,
    cap: 16 * DAMAGE_EFFECT_CAP_MUL,
    text: (m) => `爆発する（${m} ダメージ）`,
  },
  heal: {
    base: 4,
    perLevel: 0.05,
    decimals: 0,
    cap: PLAYER.maxHp * HEAL_EFFECT_CAP_RATIO,
    text: (m) => `生命を${m}回復する`,
  },
  damageBuff: {
    base: 15,
    perLevel: 0.03,
    decimals: 0,
    cap: 60,
    duration: { min: 3, max: 5 },
    text: (m, _c, d) => `${d ?? "0"} 秒間ダメージ +${m}%`,
  },
  speedBuff: {
    base: 15,
    perLevel: 0.02,
    decimals: 0,
    cap: 40,
    duration: { min: 2, max: 4 },
    text: (m, _c, d) => `${d ?? "0"} 秒間移動速度 +${m}%`,
  },
  energy: { base: 8, perLevel: 0.04, decimals: 0, text: (m) => `必殺ゲージを${m}獲得する` },
  invuln: {
    // 上限は TRIGGER.invulnMax（docs/COMBAT_DESIGN.md C-1 の 13）。揺らぎの上振れは decode 側でも切る
    base: 0.35,
    perLevel: 0,
    decimals: 1,
    cap: TRIGGER.invulnMax,
    text: (m) => `${m} 秒間無敵になる`,
  },
  restoreMana: { base: 4, perLevel: 0.04, decimals: 0, cap: 16, text: (m) => `気力を${m}回収する` },
  addPoise: { base: 12, perLevel: 0.05, decimals: 0, cap: 48, text: (m) => `相手に怯み値${m}を与える` },
  inflict: {
    base: 2.5,
    perLevel: 0.02,
    decimals: 1,
    cap: 5,
    text: (m, _c, _d, status) => `相手を${status}にする（${m} 秒）`,
  },
  cleanse: { base: 1, perLevel: 0, decimals: 0, cap: 1, text: () => "自分の状態異常を 1 つ解除する" },
  extendStatus: { base: 1, perLevel: 0.02, decimals: 1, cap: 3, text: (m) => `相手の状態異常を${m}秒延ばす` },
  skillHaste: {
    base: 0.5,
    perLevel: 0.01,
    decimals: 1,
    cap: 1.5,
    text: (m) => `スキルの再使用時間と最低間隔を${m}秒縮める`,
  },
  volley: {
    base: 60,
    perLevel: 0.01,
    decimals: 0,
    cap: 150,
    count: { min: 1, max: 2 },
    text: (m, c) => `照準の方向へ弾を${c ?? 1}発撃つ（射撃の${m}%）`,
  },
  healMissing: { base: 30, perLevel: 0, decimals: 0, cap: 100, text: (m) => `失った生命の${m}%を回復する` },
};

/** 文法（ドロップ・芽・染め）から出さない効果。誓約・固定の性質が直接使う */
const FIXED_ONLY_EFFECTS: ReadonlySet<TriggerEffectKind> = new Set(["healMissing"]);

/**
 * 効果 inflict で付けられる状態異常。怯み・堅守は怯み値の系統なので除く。
 * 2026-09 に core/status.ts へ足された種類（濡れ・烙印など）は状態異常レーンの仕様が固まってから足す
 */
export const INFLICT_KINDS: readonly StatusKind[] = [
  "burn",
  "chill",
  "freeze",
  "shock",
  "paralyze",
  "poison",
  "bleed",
  "vulnerable",
  "weaken",
  "fear",
  "silence",
];

/** inflict の色（状態異常の付与の性質 procX と同じ割り当て） */
export const INFLICT_COLOR: Readonly<Partial<Record<StatusKind, TraitColor>>> = {
  burn: "crimson",
  bleed: "crimson",
  chill: "azure",
  freeze: "azure",
  silence: "azure",
  shock: "gold",
  paralyze: "gold",
  fear: "gold",
  weaken: "jade",
  poison: "umbra",
  vulnerable: "umbra",
};

function isInflictKind(s: string): s is StatusKind {
  return (INFLICT_KINDS as readonly string[]).includes(s);
}

/** inflict で選べる状態異常。color を指定したらその色のものだけ（その色が無ければ全部） */
export function inflictKindsOfColor(color: TraitColor | undefined): readonly StatusKind[] {
  if (color === undefined) return INFLICT_KINDS;
  const matched = INFLICT_KINDS.filter((k) => INFLICT_COLOR[k] === color);
  return matched.length > 0 ? matched : INFLICT_KINDS;
}

const TRIGGER_KINDS = Object.keys(TRIGGER_SPECS) as TriggerKind[];
const CONDITIONS = Object.keys(CONDITION_TEXT) as TriggerCondition[];
const EFFECT_KINDS = (Object.keys(EFFECT_SPECS) as TriggerEffectKind[]).filter((e) => !FIXED_ONLY_EFFECTS.has(e));

function isTriggerKind(s: string): s is TriggerKind {
  return Object.hasOwn(TRIGGER_SPECS, s);
}
function isCondition(s: string): s is TriggerCondition {
  return Object.hasOwn(CONDITION_TEXT, s);
}
function isEffectKind(s: string): s is TriggerEffectKind {
  return Object.hasOwn(EFFECT_SPECS, s);
}

/**
 * スロットごとに出るトリガー（その部位らしい起点に寄せる）。ring / amulet は全部。
 * 右手は近接・銃どちらの家系も乗るので両方の起点を持つ（旧 weapon + gun の合併）。
 * 左手（offHand）は今はベースが無く出番が無い
 */
export const SLOT_TRIGGERS: Readonly<Record<Slot, readonly TriggerKind[]>> = {
  mainHand: ["onMeleeHit", "everyNthMeleeHit", "onShoot", "onKill", "onJustDodge", "onStagger", "onCounter"],
  offHand: [],
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
/** 敵に向けて使う効果（対象がいなければ周囲の敵へ）。部屋クリア時には敵がいない */
const TARGETED_EFFECTS: ReadonlySet<TriggerEffectKind> = new Set(["addPoise", "inflict", "extendStatus", "volley"]);
/** 対象（敵）を見る条件 */
const TARGET_CONDITIONS: ReadonlySet<TriggerCondition> = new Set([
  "targetInWindup",
  "targetGuarded",
  "targetMultiStatus",
  "targetElite",
]);
/** 対象の敵を持つ起点（被弾は攻撃してきた敵） */
const TARGETED_TRIGGERS: ReadonlySet<TriggerKind> = new Set([
  "onMeleeHit",
  "everyNthMeleeHit",
  "onKill",
  "onStagger",
  "onCounter",
  "onHurt",
]);

/** 対象を見る条件が成り立ち得る組か（常に真・常に偽になる組を外す） */
function targetConditionFits(trigger: TriggerKind, condition: TriggerCondition): boolean {
  if (!TARGET_CONDITIONS.has(condition)) return true;
  if (!TARGETED_TRIGGERS.has(trigger)) return false;
  // カウンターは予備動作中の敵にしか起きない（常に真）/ 怯むと予備動作は取り消される（常に偽）/ 被弾は攻撃の後
  if (condition === "targetInWindup") return trigger !== "onCounter" && trigger !== "onStagger" && trigger !== "onHurt";
  // 攻撃してきた敵が堅守中というのはほぼ起きない
  if (condition === "targetGuarded") return trigger !== "onHurt";
  return true;
}

/** 2026-09 追加の効果の相性（docs/ideas/loot-expansion.md 6 章の除外表） */
function newEffectFits(trigger: TriggerKind, condition: TriggerCondition, effect: TriggerEffectKind): boolean {
  if (trigger === "onRoomClear" && TARGETED_EFFECTS.has(effect)) return false;
  // 射撃で弾を撃つ → その弾の射撃でまた、の連鎖
  if (trigger === "onShoot" && effect === "volley") return false;
  // 満タンに回収しても溢れるだけ / 枯渇中に縮めても撃てない
  if (condition === "manaFull" && effect === "restoreMana") return false;
  if (condition === "manaLow" && effect === "skillHaste") return false;
  // 怯んだ直後の敵には怯み値が溜まらない
  if (trigger === "onStagger" && effect === "addPoise") return false;
  // 払う状態異常が無ければ空振りなので、自分が状態異常中のときだけ
  if (effect === "cleanse") return condition === "selfAfflicted";
  return true;
}

/** 相性の悪い組み合わせを除外する */
export function isCompatible(trigger: TriggerKind, condition: TriggerCondition, effect: TriggerEffectKind): boolean {
  if (FIXED_ONLY_EFFECTS.has(effect)) return false;
  if (!targetConditionFits(trigger, condition)) return false;
  if (!newEffectFits(trigger, condition, effect)) return false;
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

/** スロットごとの組み合わせ（文法が大きいので毎回の抽選で絞り直さない） */
const GRAMMAR_BY_SLOT = new Map<Slot, readonly TriggerShape[]>();

/** スロットで出うる組み合わせ */
export function grammarForSlot(slot: Slot): readonly TriggerShape[] {
  const cached = GRAMMAR_BY_SLOT.get(slot);
  if (cached !== undefined) return cached;
  const allowed = SLOT_TRIGGERS[slot];
  const shapes = TRIGGER_GRAMMAR.filter((shape) => allowed.includes(shape.trigger));
  GRAMMAR_BY_SLOT.set(slot, shapes);
  return shapes;
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

/**
 * 組み合わせを 1 つ具体化する。magnitude は itemLevel でスケール。
 * inflict は状態異常の種類もここで選ぶ（statusColor を渡すとその色の種類から）
 */
export function rollTriggerEffect(
  rng: Rng,
  shape: TriggerShape,
  itemLevel: number,
  statusColor?: TraitColor,
): TriggeredEffect {
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
  if (shape.effect === "inflict") result.status = rng.pick(inflictKindsOfColor(statusColor));
  return result;
}

/** 文法から条件付き効果を 1 つ生成する（スロット制限なし） */
export function generateTrigger(rng: Rng, itemLevel: number): TriggeredEffect {
  return rollTriggerEffect(rng, rng.pick(TRIGGER_GRAMMAR), itemLevel);
}

/** スロットに合ったトリガーを生成し、AffixRoll にエンコードして返す */
export function generateTriggerRoll(rng: Rng, itemLevel: number, slot: Slot): AffixRoll {
  const effect = rollTriggerEffect(rng, rng.pick(grammarForSlot(slot)), itemLevel);
  return triggerToRoll(effect);
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
  if (effect.status !== undefined) parts.push(`${STATUS_MARK}${effect.status}`);
  return TRIGGER_KEY_PREFIX + parts.join(KEY_SEPARATOR);
}

function encodeValue2(effect: TriggeredEffect): number {
  const durationUnits = Math.round((effect.duration ?? 0) * DURATION_SCALE);
  return durationUnits * CHANCE_SCALE + Math.round(effect.chance * CHANCE_SCALE);
}

export function triggerToRoll(effect: TriggeredEffect): AffixRoll {
  return {
    key: triggerKey(effect),
    value: effect.magnitude,
    value2: encodeValue2(effect),
  };
}

interface TriggerParams {
  every?: number;
  count?: number;
  status?: StatusKind;
}

/** 数字だけの部品 → every、"x<数字>" → count、"@<種類>" → status。それ以外は null で不正扱い */
function parseParams(params: readonly string[]): TriggerParams | null {
  const out: TriggerParams = {};
  for (const part of params) {
    const status = part.startsWith(STATUS_MARK) ? part.slice(STATUS_MARK.length) : "";
    if (isInflictKind(status)) {
      out.status = status;
      continue;
    }
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

/**
 * magnitude を効果の上限で切る。生成後の揺らぎ（generator.ts の rollTriggerTrait）や旧セーブで
 * 上限を超えた値も、適用と表示の時点で上限に揃える（無敵を常時化させない）
 */
function capMagnitude(effect: TriggerEffectKind, magnitude: number): number {
  const cap = EFFECT_SPECS[effect].cap;
  return cap === undefined ? magnitude : Math.min(cap, magnitude);
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
  // inflict は種類が無いと何も付けられない（壊れたデータ）
  if (effect === "inflict" && params.status === undefined) return null;

  const value2 = roll.value2 ?? 0;
  const durationUnits = Math.floor(value2 / CHANCE_SCALE);
  const result: TriggeredEffect = {
    trigger,
    condition,
    effect,
    magnitude: capMagnitude(effect, roll.value),
    chance: (value2 % CHANCE_SCALE) / CHANCE_SCALE,
  };
  if (params.every !== undefined) result.every = params.every;
  if (params.count !== undefined) result.count = params.count;
  if (params.status !== undefined) result.status = params.status;
  if (durationUnits > 0) result.duration = durationUnits / DURATION_SCALE;
  return result;
}

/** 例: "撃破時（HP 50% 未満）: 40% で3.5 秒間ダメージ +25%を得る" */
export function formatTrigger(effect: TriggeredEffect): string {
  const effectSpec = EFFECT_SPECS[effect.effect];
  const head = `${TRIGGER_SPECS[effect.trigger].text(effect.every)}${CONDITION_TEXT[effect.condition]}`;
  const body = effectSpec.text(
    effect.magnitude.toFixed(effectSpec.decimals),
    effect.count,
    effect.duration === undefined ? undefined : String(effect.duration),
    effect.status === undefined ? "" : STATUS_LABEL[effect.status],
  );
  if (effect.chance >= 1) return `${head}: ${body}`;
  const chancePct = roundTo(effect.chance * PERCENT_SCALE, 1);
  return `${head}: ${chancePct}% で${body}`;
}

// ---------------------------------------------------------------------------
// 統一ルール文法への読み替え（docs/ideas/synergy-web.md 3-1）
// ---------------------------------------------------------------------------

/**
 * 装備トリガーを統一ルール（src/core/rules.ts）の形に読み替える。tr: の保存形式は変えない。
 * everyNthMeleeHit は「近接命中 + 条件 nthMeleeHit」、条件 always は空の if になる。
 * id は index とトリガー内容を混ぜる（装備の入れ替えで別のトリガーが同じ ICD を引き継がない）
 */
export function ruleFromTrigger(t: Readonly<TriggeredEffect>, index: number): Rule {
  const owner: EventSource = { kind: "item", key: triggerKey(t) };
  const conditions: RuleCondition[] = [];
  if (t.trigger === "everyNthMeleeHit") conditions.push({ kind: "nthMeleeHit", every: t.every ?? 0 });
  if (t.condition !== "always") conditions.push({ kind: "trigger", condition: t.condition });
  const then: RuleEffect = { kind: t.effect, magnitude: t.magnitude };
  if (t.duration !== undefined) then.duration = t.duration;
  if (t.count !== undefined) then.count = t.count;
  if (t.status !== undefined) then.status = t.status;
  return {
    id: `${owner.kind}:${owner.key}:${index}`,
    when: triggerEventKind(t.trigger),
    if: conditions,
    then,
    chance: t.chance,
    icd: TRIGGER.icd,
    scope: SCOPE_ANY,
    owner,
  };
}
