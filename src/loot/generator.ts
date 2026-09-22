import { createRng, type Rng } from "../core/rng";
import {
  KEYSTONES,
  affixDef,
  affixesFor,
  conversionsFor,
  implicitDef,
  isConversionKey,
  keystoneDef,
  keystoneToRoll,
  type AffixDef,
  type RollRange,
} from "./affixes";
import { baseDef, basesForSlot, type BaseItemDef } from "./bases";
import { nameItem } from "./names";
import { generateTriggerRoll } from "./triggers";
import { SLOTS, type AffixKind, type AffixRoll, type Item, type Rarity, type Slot } from "./types";

/**
 * 装備生成。純関数 + seedable RNG（docs/LOOT_DESIGN.md）。
 * 受け取った rng からアイテム seed を 1 つ引き、以降の抽選はすべてその seed の RNG で行う。
 * → Item.seed と opts があれば同じアイテムを再現できる。
 */

export interface GenerateOptions {
  itemLevel: number;
  /** 省略時はランダム */
  slot?: Slot;
  /** 0 = 通常。大きいほど magic / rare / unique が出やすい（部屋クリア報酬など） */
  rarityBoost?: number;
  foundDepth: number;
  /** epoch ms */
  now: number;
}

const MIN_ITEM_LEVEL = 1;
const UINT32_MAX = 0xffffffff;
const ID_RADIX = 36;

// ---- rarity ----
export const BASE_RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  normal: 55,
  magic: 32,
  rare: 12,
  unique: 1,
};
/** rarityBoost 1 あたりの magic 重み増加率（rare/unique は 1 倍） */
const MAGIC_BOOST_SCALE = 0.5;
/** itemLevel 1 あたりの rare 重み増加率 */
const RARE_WEIGHT_PER_LEVEL = 0.05;
/** itemLevel 1 あたりの unique 重み増加率 */
const UNIQUE_WEIGHT_PER_LEVEL = 0.08;

// ---- アフィックス数 ----
interface CountRange {
  min: number;
  max: number;
}
const AFFIX_COUNT: Readonly<Record<Rarity, CountRange>> = {
  normal: { min: 0, max: 0 },
  magic: { min: 1, max: 2 },
  rare: { min: 3, max: 6 },
  unique: { min: 0, max: 0 },
};
/** prefix / suffix それぞれの上限 */
const KIND_LIMIT: Readonly<Record<Rarity, number>> = {
  normal: 0,
  magic: 1,
  rare: 3,
  unique: 0,
};
const AFFIX_KINDS: readonly AffixKind[] = ["prefix", "suffix"];

/** prefix / suffix それぞれの上限（クラフトの枠判定用）。unique は固定セットなので rare と同じ枠で扱う */
export function affixKindLimit(rarity: Rarity): number {
  return rarity === "unique" ? KIND_LIMIT.rare : KIND_LIMIT[rarity];
}

/** 1 つ上の tier に行くごとに重みがこの倍率になる（高 tier ほど珍しい） */
const TIER_WEIGHT_DECAY = 0.55;

/** rare の各アフィックス枠がトリガー文法から生成される確率 */
export const TRIGGER_AFFIX_CHANCE = 0.25;
/** rare にランダムなキーストーンが付く確率（アフィックス枠とは別枠）。unique は UniqueDef.keystone で固定 */
export const RARE_KEYSTONE_CHANCE = 0.15;
/** rare の各アフィックス枠が変換アフィックスになる確率（1 アイテムに 1 つまで。トリガーの抽選に外れた枠のみ） */
export const CONVERSION_AFFIX_CHANCE = 0.1;

/** implicit の AffixRoll に入れる固定値（kind/tier は implicit では意味を持たない） */
const IMPLICIT_KIND: AffixKind = "prefix";
const IMPLICIT_TIER = 1;

// ---------------------------------------------------------------------------
// unique
// ---------------------------------------------------------------------------

export interface UniqueAffixSpec {
  key: string;
  /** 1 = T1。値はこの tier の範囲でロールする（minLevel は無視） */
  tier: number;
}

export interface UniqueDef {
  key: string;
  name: string;
  baseKey: string;
  minLevel: number;
  affixes: readonly UniqueAffixSpec[];
  /** 固定キーストーン（KEYSTONES の key） */
  keystone?: string;
  /** フレーバー 1 行（UI 表示は将来対応） */
  flavor?: string;
}

export const UNIQUES: readonly UniqueDef[] = [
  {
    key: "widowmaker",
    name: "Widowmaker",
    baseKey: "greatsword",
    minLevel: 14,
    keystone: "ks_berserker",
    flavor: "The lower your HP, the wider it swings.",
    affixes: [
      { key: "meleeDamagePct", tier: 2 },
      { key: "critMultiplier", tier: 2 },
      { key: "lifeOnKill", tier: 2 },
      { key: "knockback", tier: 1 },
    ],
  },
  {
    key: "hailstormEngine",
    name: "Hailstorm Engine",
    baseKey: "smg",
    minLevel: 10,
    keystone: "ks_overclock",
    flavor: "Every trigger pull costs a piece of you.",
    affixes: [
      { key: "projectiles", tier: 2 },
      { key: "fireRate", tier: 2 },
      { key: "chill", tier: 1 },
      { key: "pierce", tier: 2 },
      { key: "cv_splitToPierce", tier: 2 },
    ],
  },
  {
    key: "heartOfTheMountain",
    name: "Heart of the Mountain",
    baseKey: "plate",
    minLevel: 18,
    keystone: "ks_juggernaut",
    flavor: "Nothing moving this slowly should hit this hard.",
    affixes: [
      { key: "maxLife", tier: 2 },
      { key: "maxLifePct", tier: 2 },
      { key: "thorns", tier: 2 },
      { key: "damageTaken", tier: 2 },
      { key: "cv_lifeToArmor", tier: 2 },
    ],
  },
  {
    key: "stormstriders",
    name: "Stormstriders",
    baseKey: "greaves",
    minLevel: 14,
    keystone: "ks_blink",
    flavor: "You arrive before the thunder does.",
    affixes: [
      { key: "moveSpeed", tier: 2 },
      { key: "dashCharge", tier: 1 },
      { key: "shock", tier: 2 },
      { key: "dashCooldown", tier: 2 },
    ],
  },
  {
    key: "eyeOfTheTempest",
    name: "Eye of the Tempest",
    baseKey: "lapisAmulet",
    minLevel: 12,
    keystone: "ks_gambler",
    flavor: "Every burst is a coin flip the room can't survive.",
    affixes: [
      { key: "burstDamage", tier: 1 },
      { key: "burstRadius", tier: 1 },
      { key: "energyGain", tier: 2 },
      { key: "comboWindow", tier: 2 },
      { key: "explodeOnKill", tier: 2 },
    ],
  },

  // ---- 追加 10 種: 各スロット 2 つ以上、出始め ilvl は 4〜20 でばらす ----
  {
    key: "cinderfang",
    name: "Cinderfang",
    baseKey: "dagger",
    minLevel: 4,
    keystone: "ks_glassCannon",
    flavor: "Two cuts, then the fire finishes the job.",
    affixes: [
      { key: "attackSpeed", tier: 2 },
      { key: "burn", tier: 2 },
      { key: "cv_meleeToBurn", tier: 2 },
    ],
  },
  {
    key: "bloodletterKiss",
    name: "Bloodletter's Kiss",
    baseKey: "shortsword",
    minLevel: 8,
    keystone: "ks_vampire",
    flavor: "It never lets you bleed out alone.",
    affixes: [
      { key: "lifeOnHit", tier: 1 },
      { key: "attackSpeed", tier: 2 },
      { key: "critMultiplier", tier: 3 },
    ],
  },
  {
    key: "whisperOfTheVoid",
    name: "Whisper of the Void",
    baseKey: "rifle",
    minLevel: 9,
    keystone: "ks_pacifist",
    flavor: "It only speaks once, from very far away.",
    affixes: [
      { key: "rangedDamagePct", tier: 2 },
      { key: "pierce", tier: 1 },
      { key: "critChance", tier: 2 },
    ],
  },
  {
    key: "lastRites",
    name: "Last Rites",
    baseKey: "shotgun",
    minLevel: 15,
    keystone: "ks_overclock",
    flavor: "Every shell is administered at point-blank range.",
    affixes: [
      { key: "projectiles", tier: 1 },
      { key: "explodeOnKill", tier: 1 },
      { key: "fireRate", tier: 3 },
    ],
  },
  {
    key: "aegisOfTheUnbroken",
    name: "Aegis of the Unbroken",
    baseKey: "plate",
    minLevel: 20,
    keystone: "ks_juggernaut",
    flavor: "It has never once considered stepping aside.",
    affixes: [
      { key: "armorFlat", tier: 1 },
      { key: "maxLifePct", tier: 2 },
      { key: "damageTaken", tier: 2 },
    ],
  },
  {
    key: "wardensSilence",
    name: "Warden's Silence",
    baseKey: "chain",
    minLevel: 11,
    keystone: "ks_bladeOath",
    flavor: "It answers every question with the flat of a blade.",
    affixes: [
      { key: "maxLife", tier: 2 },
      { key: "meleeDamageFlat", tier: 2 },
      { key: "thorns", tier: 3 },
    ],
  },
  {
    key: "tempestLoader",
    name: "Tempest Loader",
    baseKey: "greaves",
    minLevel: 13,
    keystone: "ks_windWalker",
    flavor: "Spend every charge before the ground catches up.",
    affixes: [
      { key: "dashDistance", tier: 1 },
      { key: "moveSpeed", tier: 2 },
      { key: "cv_speedToAttack", tier: 2 },
    ],
  },
  {
    key: "berserkersSignet",
    name: "Berserker's Signet",
    baseKey: "bloodRing",
    minLevel: 10,
    keystone: "ks_berserker",
    flavor: "It counts your wounds so you don't have to.",
    affixes: [
      { key: "lifeOnKill", tier: 1 },
      { key: "critMultiplier", tier: 2 },
      { key: "maxLife", tier: 3 },
    ],
  },
  {
    key: "fortunesGambit",
    name: "Fortune's Gambit",
    baseKey: "goldRing",
    minLevel: 7,
    keystone: "ks_gambler",
    flavor: "The house always loses, eventually.",
    affixes: [
      { key: "critChance", tier: 2 },
      { key: "burstDamage", tier: 2 },
      { key: "energyGain", tier: 3 },
    ],
  },
  {
    key: "phaseAnchor",
    name: "Phase Anchor",
    baseKey: "onyxAmulet",
    minLevel: 14,
    keystone: "ks_blink",
    flavor: "It remembers where you were about to be.",
    affixes: [
      { key: "burstRadius", tier: 1 },
      { key: "dashCooldown", tier: 2 },
      { key: "moveSpeed", tier: 3 },
    ],
  },
];

/** slot に対応し itemLevel で解禁済みの unique */
export function uniquesFor(slot: Slot, itemLevel: number): UniqueDef[] {
  return UNIQUES.filter((u) => u.minLevel <= itemLevel && baseDef(u.baseKey)?.slot === slot);
}

// ---------------------------------------------------------------------------
// 汎用ロール
// ---------------------------------------------------------------------------

/** 重み配列から index を 1 つ選ぶ。重み合計 0 以下なら 0 */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i] ?? 0);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** [min, max] を decimals 桁刻みでロール（両端含む） */
export function rollValue(rng: Rng, min: number, max: number, decimals = 0): number {
  const scale = 10 ** decimals;
  return rng.int(Math.round(min * scale), Math.round(max * scale)) / scale;
}

interface RolledValues {
  value: number;
  value2?: number;
}

function rollRangeValues(rng: Rng, range: RollRange, decimals: number, decimals2: number): RolledValues {
  const value = rollValue(rng, range.min, range.max, decimals);
  if (range.min2 === undefined || range.max2 === undefined) return { value };
  return { value, value2: rollValue(rng, range.min2, range.max2, decimals2) };
}

function toRoll(key: string, kind: AffixKind, tier: number, values: RolledValues): AffixRoll {
  const roll: AffixRoll = { key, kind, tier, value: values.value };
  if (values.value2 !== undefined) roll.value2 = values.value2;
  return roll;
}

// ---------------------------------------------------------------------------
// 各ステップ
// ---------------------------------------------------------------------------

export function rollSlot(rng: Rng): Slot {
  return rng.pick(SLOTS);
}

export function rarityWeights(itemLevel: number, rarityBoost = 0): Record<Rarity, number> {
  const boost = Math.max(0, rarityBoost);
  return {
    normal: BASE_RARITY_WEIGHTS.normal,
    magic: BASE_RARITY_WEIGHTS.magic * (1 + boost * MAGIC_BOOST_SCALE),
    rare: BASE_RARITY_WEIGHTS.rare * (1 + boost + itemLevel * RARE_WEIGHT_PER_LEVEL),
    unique: BASE_RARITY_WEIGHTS.unique * (1 + boost + itemLevel * UNIQUE_WEIGHT_PER_LEVEL),
  };
}

export function rollRarity(rng: Rng, itemLevel: number, rarityBoost = 0): Rarity {
  const weights = rarityWeights(itemLevel, rarityBoost);
  const order: readonly Rarity[] = ["normal", "magic", "rare", "unique"];
  const index = weightedIndex(rng, order.map((r) => weights[r]));
  return order[index] ?? "normal";
}

export function rollBase(rng: Rng, slot: Slot, itemLevel: number): BaseItemDef {
  const candidates = basesForSlot(slot, itemLevel);
  if (candidates.length === 0) throw new Error(`rollBase: no base for ${slot} at ilvl ${itemLevel}`);
  return rng.pick(candidates);
}

export function rollImplicit(rng: Rng, base: BaseItemDef): AffixRoll | null {
  if (base.implicitKey === undefined) return null;
  const def = implicitDef(base.implicitKey);
  if (def === undefined) return null;
  const values = rollRangeValues(rng, def.range, def.decimals ?? 0, def.decimals2 ?? 0);
  return toRoll(def.key, IMPLICIT_KIND, IMPLICIT_TIER, values);
}

export function rollAffixCount(rng: Rng, rarity: Rarity): number {
  const range = AFFIX_COUNT[rarity];
  return rng.int(range.min, range.max);
}

/**
 * tier の index（0 = T1）を選ぶ。itemLevel で解禁済みの tier のみ対象。
 * 最下位 tier の重みを 1 とし、1 つ上がるごとに TIER_WEIGHT_DECAY 倍。
 * 解禁 tier が無ければ最下位 tier を返す。
 */
export function rollTierIndex(rng: Rng, def: AffixDef, itemLevel: number): number {
  const lowestIndex = def.tiers.length - 1;
  const available: number[] = [];
  def.tiers.forEach((tier, i) => {
    if (tier.minLevel <= itemLevel) available.push(i);
  });
  if (available.length === 0) return lowestIndex;
  const weights = available.map((i) => TIER_WEIGHT_DECAY ** (lowestIndex - i));
  return available[weightedIndex(rng, weights)] ?? lowestIndex;
}

export function rollAffixAtTier(rng: Rng, def: AffixDef, tierIndex: number): AffixRoll {
  const tier = def.tiers[tierIndex];
  if (tier === undefined) throw new Error(`rollAffixAtTier: ${def.key} has no tier index ${tierIndex}`);
  const values = rollRangeValues(rng, tier, def.decimals ?? 0, def.decimals2 ?? 0);
  return toRoll(def.key, def.kind, tierIndex + 1, values);
}

export function rollAffix(rng: Rng, def: AffixDef, itemLevel: number): AffixRoll {
  return rollAffixAtTier(rng, def, rollTierIndex(rng, def, itemLevel));
}

function countKind(rolls: readonly AffixRoll[], kind: AffixKind): number {
  return rolls.filter((r) => r.kind === kind).length;
}

interface SlotContext {
  slot: Slot;
  rarity: Rarity;
  itemLevel: number;
}

/** rare の枠をトリガー文法で埋める。key が既出なら undefined（通常アフィックスにフォールバック） */
function maybeRollTrigger(
  rng: Rng,
  ctx: SlotContext,
  kind: AffixKind,
  used: ReadonlySet<string>,
): AffixRoll | undefined {
  if (ctx.rarity !== "rare" || !rng.chance(TRIGGER_AFFIX_CHANCE)) return undefined;
  const roll = generateTriggerRoll(rng, ctx.itemLevel, ctx.slot, kind);
  return used.has(roll.key) ? undefined : roll;
}

/** rare の枠を変換アフィックスで埋める。既に変換を持つ / 候補が無ければ undefined */
function maybeRollConversion(
  rng: Rng,
  ctx: SlotContext,
  kind: AffixKind,
  used: ReadonlySet<string>,
): AffixRoll | undefined {
  if (ctx.rarity !== "rare" || !rng.chance(CONVERSION_AFFIX_CHANCE)) return undefined;
  if ([...used].some(isConversionKey)) return undefined;
  const candidates = conversionsFor(ctx.slot, ctx.itemLevel, kind).filter((d) => !used.has(d.key));
  if (candidates.length === 0) return undefined;
  return rollAffix(rng, rng.pick(candidates), ctx.itemLevel);
}

/**
 * rarity に応じた数のアフィックスを抽選する。
 * key の重複なし、prefix / suffix はそれぞれ KIND_LIMIT まで。結果は prefix → suffix の順。
 * rare の各枠は TRIGGER_AFFIX_CHANCE でトリガー文法から、外れたら CONVERSION_AFFIX_CHANCE で変換アフィックスから生成する（枠数には含む）。
 * キーストーンはここでは付けない（rollKeystone を参照）。
 */
export function rollAffixes(rng: Rng, slot: Slot, rarity: Rarity, itemLevel: number): AffixRoll[] {
  const count = rollAffixCount(rng, rarity);
  const limit = KIND_LIMIT[rarity];
  const rolls: AffixRoll[] = [];
  const used = new Set<string>();
  const candidatesOf = (kind: AffixKind): AffixDef[] =>
    affixesFor(slot, kind, itemLevel).filter((d) => !used.has(d.key));

  for (let i = 0; i < count; i++) {
    const kinds = AFFIX_KINDS.filter((k) => countKind(rolls, k) < limit && candidatesOf(k).length > 0);
    if (kinds.length === 0) break;
    const kind = rng.pick(kinds);
    const ctx: SlotContext = { slot, rarity, itemLevel };
    const roll =
      maybeRollTrigger(rng, ctx, kind, used) ??
      maybeRollConversion(rng, ctx, kind, used) ??
      rollAffix(rng, rng.pick(candidatesOf(kind)), itemLevel);
    rolls.push(roll);
    used.add(roll.key);
  }
  return [...rolls.filter((r) => r.kind === "prefix"), ...rolls.filter((r) => r.kind === "suffix")];
}

/** rare のみ RARE_KEYSTONE_CHANCE でランダムなキーストーンを 1 つ（アフィックス枠とは別） */
export function rollKeystone(rng: Rng, rarity: Rarity): AffixRoll | undefined {
  if (rarity !== "rare" || !rng.chance(RARE_KEYSTONE_CHANCE)) return undefined;
  return keystoneToRoll(rng.pick(KEYSTONES));
}

function withKeystone(affixes: AffixRoll[], keystone: AffixRoll | undefined): AffixRoll[] {
  return keystone === undefined ? affixes : [...affixes, keystone];
}

function uniqueKeystone(unique: UniqueDef): AffixRoll | undefined {
  if (unique.keystone === undefined) return undefined;
  const def = keystoneDef(unique.keystone);
  if (def === undefined) throw new Error(`unique ${unique.key}: unknown keystone ${unique.keystone}`);
  return keystoneToRoll(def);
}

export function rollUniqueAffixes(rng: Rng, unique: UniqueDef): AffixRoll[] {
  return unique.affixes.map((spec) => {
    const def = affixDef(spec.key);
    if (def === undefined) throw new Error(`unique ${unique.key}: unknown affix ${spec.key}`);
    return rollAffixAtTier(rng, def, spec.tier - 1);
  });
}

// ---------------------------------------------------------------------------
// 生成本体
// ---------------------------------------------------------------------------

/** 同一セッション内で id を確実にユニークにするための連番 */
let serial = 0;

function makeId(seed: number, now: number): string {
  const id = `${seed.toString(ID_RADIX)}-${now.toString(ID_RADIX)}-${serial.toString(ID_RADIX)}`;
  serial++;
  return id;
}

interface Rolled {
  base: BaseItemDef;
  rarity: Rarity;
  affixes: AffixRoll[];
  uniqueName?: string;
}

function rollUniqueItem(rng: Rng, slot: Slot, itemLevel: number): Rolled | undefined {
  const candidates = uniquesFor(slot, itemLevel);
  if (candidates.length === 0) return undefined;
  const unique = rng.pick(candidates);
  const base = baseDef(unique.baseKey);
  if (base === undefined) throw new Error(`unique ${unique.key}: unknown base ${unique.baseKey}`);
  const affixes = withKeystone(rollUniqueAffixes(rng, unique), uniqueKeystone(unique));
  return { base, rarity: "unique", affixes, uniqueName: unique.name };
}

function rollRegularItem(rng: Rng, slot: Slot, rarity: Rarity, itemLevel: number): Rolled {
  const base = rollBase(rng, slot, itemLevel);
  const affixes = withKeystone(rollAffixes(rng, slot, rarity, itemLevel), rollKeystone(rng, rarity));
  return { base, rarity, affixes };
}

export function generateItem(rng: Rng, opts: GenerateOptions): Item {
  const itemLevel = Math.max(MIN_ITEM_LEVEL, Math.floor(opts.itemLevel));
  const seed = rng.int(0, UINT32_MAX);
  const r = createRng(seed);

  const slot = opts.slot ?? rollSlot(r);
  const rarity = rollRarity(r, itemLevel, opts.rarityBoost ?? 0);
  // 該当 slot / itemLevel の unique が無ければ rare に落とす
  const rolled =
    (rarity === "unique" ? rollUniqueItem(r, slot, itemLevel) : undefined) ??
    rollRegularItem(r, slot, rarity === "unique" ? "rare" : rarity, itemLevel);

  const implicit = rollImplicit(r, rolled.base);
  const name = nameItem(r, rolled.base, rolled.rarity, rolled.affixes, rolled.uniqueName);

  return {
    id: makeId(seed, opts.now),
    seed,
    baseKey: rolled.base.key,
    slot,
    rarity: rolled.rarity,
    itemLevel,
    name,
    implicit,
    affixes: rolled.affixes,
    foundDepth: opts.foundDepth,
    foundAt: opts.now,
  };
}
