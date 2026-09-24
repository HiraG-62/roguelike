import { createRng, type Rng } from "../core/rng";
import {
  KEYSTONES,
  affixDef,
  conversionsFor,
  implicitDef,
  isConversionKey,
  isKeystoneKey,
  keystoneDef,
  keystoneToRoll,
  traitsFor,
  type AffixDef,
  type RollRange,
} from "./affixes";
import { baseDef, baseFamily, basesForSlot, type BaseItemDef } from "./bases";
import { BASE_LEAN_WEIGHT, affixColor, baseLean, triggerCanBeColor, triggerColor } from "./colors";
import {
  MAX_CONVERSION_FLUX,
  MIN_FLUX,
  fluxClassOf,
  fluxedValues,
  inversionChance,
  powerScaleAt,
  rollFlux,
  rollInvertedFlux,
  scaledNominalAt,
  sigmaAt,
  valueFromFlux,
  type Nominal,
} from "./flux";
import { uniquesFor, type UniqueDef } from "./named";
import { nameItem } from "./names";
import { grammarForSlot, isTriggerKey, rollTriggerEffect, triggerToRoll } from "./triggers";
import { LOOT_SLOTS, TRAIT_COLORS, createEmptyProvenance, type AffixRoll, type Item, type Slot, type TraitColor, type TraitOrigin } from "./types";

/**
 * 遺物（装備）の生成。純関数 + seedable RNG（docs/LOOT_DESIGN.md「生成」）。
 * 受け取った rng からアイテム seed を 1 つ引き、以降の抽選はすべてその seed の RNG で行う。
 * → Item.seed と opts があれば同じアイテムを再現できる。
 *
 * 手順: スロット → ベース → implicit → 性質の数（深度の期待値 + 分散）→ 余白 → 各性質
 * （色の傾き付き抽選 → 期待値 → 揺らぎ → 反転 → 異色）→ 誓約 → 名前 → 見た目の分類
 */

export interface GenerateOptions {
  /** 生成に使う深度（発見深度 + 0..2）。期待値と揺らぎ幅の入力 */
  itemLevel: number;
  /** 省略時はランダム */
  slot?: Slot;
  /**
   * 揺らぎの増幅（旧 rarityBoost。名前は呼び出し側の互換のため据え置き）。
   * 大きいほど σ が広がり「荒い」遺物が出る。名のある遺物も出やすくなる（ボス撃破・宝物庫など）
   */
  rarityBoost?: number;
  foundDepth: number;
  /** epoch ms */
  now: number;
  /** 抽選に出さない名のある遺物の key（依頼の報酬で未達成のもの）。省略・空なら従来どおり */
  excludeNamed?: readonly string[];
  /** ベースを指定する（ジョブの初期武器・武器掛けの借り物）。指定時は rollBase も名のある遺物の抽選も通さない */
  baseKey?: string;
  /** 性質 0 の素の器にする。implicit はベースの個性なので残す */
  plain?: boolean;
}

const MIN_ITEM_LEVEL = 1;
const UINT32_MAX = 0xffffffff;
const ID_RADIX = 36;

// ---- 性質の数と余白 ----
/** 性質の数の期待値 = min(COUNT_BASE + COUNT_PER_DEPTH * depth, COUNT_MAX_MEAN) */
export const COUNT_BASE = 1;
export const COUNT_PER_DEPTH = 0.12;
export const COUNT_MAX_MEAN = 3.5;
/** 性質の数の分散（三角分布の半幅） = min(COUNT_SPREAD_BASE + COUNT_SPREAD_PER_DEPTH * depth, COUNT_SPREAD_MAX) */
export const COUNT_SPREAD_BASE = 1;
export const COUNT_SPREAD_PER_DEPTH = 0.05;
export const COUNT_SPREAD_MAX = 2;
/** 拾った時点の性質の上限 */
export const MAX_FOUND_TRAITS = 5;
/** 器の容量。余白 = 容量 - 性質の数（+ 揺らぎ -1..0）を MIN_MARGIN..MAX_MARGIN に収める */
export const VESSEL_CAPACITY = 5;
export const MIN_MARGIN = 1;
export const MAX_MARGIN = 4;
const MARGIN_JITTER_MIN = -1;
const MARGIN_JITTER_MAX = 0;
/** 名のある遺物の余白 */
export const NAMED_MARGIN = 1;

// ---- 性質の中身 ----
/** 各性質がトリガー文法から生成される確率 */
export const TRIGGER_TRAIT_CHANCE = 0.25;
/** 各性質が変換の性質になる確率（1 アイテムに 1 つまで。トリガーに外れた枠のみ） */
export const CONVERSION_TRAIT_CHANCE = 0.1;
/** 性質が既定と別の色で生まれる確率（異色） */
export const OFF_COLOR_CHANCE = 0.1;
/** 性質が VOW_MIN_TRAITS 以上のとき、1 つを誓約（旧キーストーン）に置き換える確率 */
export const VOW_CHANCE = 0.08;
export const VOW_MIN_TRAITS = 3;
/** 名のある遺物・芽の性質は揺らぎが小さい（σ に掛ける） */
export const CALM_SIGMA_SCALE = 0.5;

// ---- 名のある遺物（旧 unique）の出現 ----
export const NAMED_BASE_CHANCE = 0.018;
export const NAMED_CHANCE_PER_LEVEL = 0.08;
/** boost の効きは二乗（通常ドロップでは稀、ボス撃破などで大きく伸びる） */
export const NAMED_BOOST_EXPONENT = 2;
export const NAMED_MAX_CHANCE = 0.35;

export { UNIQUES, uniqueDef, uniquesFor, type UniqueAffixSpec, type UniqueDef } from "./named";

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

/** 重み付きで 1 つ選ぶ。空なら undefined */
function weightedPick<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[weightedIndex(rng, items.map(weightOf))];
}

/** [min, max] を decimals 桁刻みでロール（両端含む） */
export function rollValue(rng: Rng, min: number, max: number, decimals = 0): number {
  const scale = 10 ** decimals;
  return rng.int(Math.round(min * scale), Math.round(max * scale)) / scale;
}

function rollRangeValues(rng: Rng, range: RollRange, decimals: number, decimals2: number): AffixRoll {
  const roll: AffixRoll = { key: "", value: rollValue(rng, range.min, range.max, decimals) };
  if (range.min2 !== undefined && range.max2 !== undefined) {
    roll.value2 = rollValue(rng, range.min2, range.max2, decimals2);
  }
  return roll;
}

// ---------------------------------------------------------------------------
// 性質 1 つのロール（生成・芽・クラフトで共有）
// ---------------------------------------------------------------------------

export interface TraitRollOptions {
  /** 期待値と σ の深度 */
  depth: number;
  /** 反転の可否を決める発見深度 */
  foundDepth: number;
  /** σ の増幅（ドロップ元の boost） */
  boost?: number;
  /** σ に掛ける倍率（芽・名のある遺物は CALM_SIGMA_SCALE） */
  sigmaScale?: number;
  /** 反転を許すか（既定 true。芽・名のある遺物は false） */
  allowInversion?: boolean;
  origin?: TraitOrigin;
}

function sigmaFor(opts: TraitRollOptions): number {
  return sigmaAt(opts.depth, opts.boost ?? 0) * (opts.sigmaScale ?? 1);
}

/** 変換は反転しない。それ以外の表の性質は発見深度に応じて反転し得る */
function canInvert(def: AffixDef, opts: TraitRollOptions): boolean {
  return (opts.allowInversion ?? true) && !isConversionKey(def.key);
}

/** 表（affixes.ts）の性質を 1 つロールする */
export function rollTableTrait(rng: Rng, def: AffixDef, opts: TraitRollOptions): AffixRoll {
  // 期待値に装備の強さの係数（flux.ts の FLUX）を掛ける。変換は割合なので掛けない
  const nominal = scaledNominalAt(def, opts.depth, !isConversionKey(def.key));
  const inverted = canInvert(def, opts) && rng.chance(inversionChance(opts.foundDepth));
  const rawFlux = inverted ? rollInvertedFlux(rng) : rollFlux(rng, sigmaFor(opts));
  const flux = isConversionKey(def.key) ? Math.min(MAX_CONVERSION_FLUX, rawFlux) : rawFlux;
  const values = fluxedValues(nominal, flux, def.decimals ?? 0, def.decimals2 ?? 0);
  const roll: AffixRoll = {
    key: def.key,
    value: values.value,
    color: inverted ? "umbra" : affixColor(def),
    nominal: nominal.nominal,
    flux,
    origin: opts.origin ?? "found",
  };
  if (values.value2 !== undefined) roll.value2 = values.value2;
  if (nominal.nominal2 !== undefined) roll.nominal2 = nominal.nominal2;
  if (inverted) roll.inverted = true;
  return roll;
}

type TriggerShape = Parameters<typeof rollTriggerEffect>[1];

/**
 * トリガー文法の性質を 1 つロールする。magnitude に揺らぎを掛ける（反転はしない）。
 * statusColor は inflict の状態異常をその色から選ぶ（芽・染めで色を合わせる）
 */
export function rollTriggerTrait(rng: Rng, shape: TriggerShape, opts: TraitRollOptions, statusColor?: TraitColor): AffixRoll {
  const effect = rollTriggerEffect(rng, shape, opts.depth, statusColor);
  const flux = rollFlux(rng, sigmaFor(opts));
  const nominal = effect.magnitude * powerScaleAt(opts.depth);
  const decimals = effectDecimals(nominal);
  const magnitude = fluxedValues({ nominal }, flux, decimals, 0).value;
  return {
    ...triggerToRoll({ ...effect, magnitude }),
    color: triggerColor(effect),
    nominal,
    flux,
    origin: opts.origin ?? "found",
  };
}

/** トリガーの magnitude の桁（1 未満の効果量は小数 1 桁、それ以外は整数） */
function effectDecimals(magnitude: number): number {
  return magnitude < 1 ? 1 : 0;
}

/**
 * 性質の揺らぎを flux に置き換えた値を作り直す（クラフトの鎮め・煽り・染め用）。
 * 期待値は roll.nominal（無ければ現在の value）。誓約・未知の key はそのまま返す。
 * 表の性質は flux < -1 で反転（色は冥）、反転が解けたら定義の既定色に戻す。トリガーは反転しない
 */
export function refluxTrait(roll: AffixRoll, flux: number): AffixRoll {
  if (isKeystoneKey(roll.key)) return roll;
  const def = affixDef(roll.key);
  if (def !== undefined) {
    const clamped = isConversionKey(def.key) ? Math.min(MAX_CONVERSION_FLUX, Math.max(MIN_FLUX, flux)) : flux;
    const nominal: Nominal = { nominal: roll.nominal ?? Math.abs(roll.value) };
    const nominal2 = roll.nominal2 ?? (roll.value2 === undefined ? undefined : Math.abs(roll.value2));
    if (nominal2 !== undefined) nominal.nominal2 = nominal2;
    const values = fluxedValues(nominal, clamped, def.decimals ?? 0, def.decimals2 ?? 0);
    const inverted = clamped < -1;
    const out: AffixRoll = { ...roll, value: values.value, nominal: nominal.nominal, flux: clamped };
    if (values.value2 !== undefined) out.value2 = values.value2;
    if (nominal.nominal2 !== undefined) out.nominal2 = nominal.nominal2;
    if (inverted) return { ...out, inverted: true, color: "umbra" };
    if (roll.inverted === true) {
      const { inverted: _dropped, ...rest } = out;
      return { ...rest, color: affixColor(def) };
    }
    return out;
  }
  if (!isTriggerKey(roll.key)) return roll;
  const safeFlux = Math.max(MIN_FLUX, flux);
  const nominal = roll.nominal ?? roll.value;
  return { ...roll, value: valueFromFlux(nominal, safeFlux, effectDecimals(nominal)), nominal, flux: safeFlux };
}

/** 誓約（旧キーストーン）。数値を持たないので揺らがない */
export function rollVowTrait(rng: Rng, exclude: ReadonlySet<string> = new Set()): AffixRoll | undefined {
  const candidates = KEYSTONES.filter((k) => !exclude.has(k.key));
  if (candidates.length === 0) return undefined;
  return keystoneToRoll(rng.pick(candidates));
}

// ---------------------------------------------------------------------------
// 候補の抽選
// ---------------------------------------------------------------------------

function leanWeight(color: TraitColor, lean: TraitColor | undefined): number {
  return color === lean ? BASE_LEAN_WEIGHT : 1;
}

interface TraitContext {
  slot: Slot;
  lean: TraitColor | undefined;
  opts: TraitRollOptions;
  /** 右手の家系（docs/ideas/weapon-redesign.md 5.2）。mainHand 以外では意味を持たない */
  family?: "melee" | "gun";
}

function pickTableDef(rng: Rng, pool: readonly AffixDef[], ctx: TraitContext, used: ReadonlySet<string>): AffixDef | undefined {
  const candidates = pool.filter((d) => !used.has(d.key));
  return weightedPick(rng, candidates, (d) => leanWeight(affixColor(d), ctx.lean));
}

function maybeRollTrigger(rng: Rng, ctx: TraitContext, used: ReadonlySet<string>): AffixRoll | undefined {
  if (!rng.chance(TRIGGER_TRAIT_CHANCE)) return undefined;
  const shape = weightedPick(rng, grammarForSlot(ctx.slot, ctx.family), (s) => leanWeight(triggerColor(s), ctx.lean));
  if (shape === undefined) return undefined;
  const roll = rollTriggerTrait(rng, shape, ctx.opts);
  return used.has(roll.key) ? undefined : roll;
}

function maybeRollConversion(rng: Rng, ctx: TraitContext, used: ReadonlySet<string>): AffixRoll | undefined {
  if (!rng.chance(CONVERSION_TRAIT_CHANCE)) return undefined;
  if ([...used].some(isConversionKey)) return undefined;
  const def = pickTableDef(rng, conversionsFor(ctx.slot, ctx.opts.depth, ctx.family), ctx, used);
  return def === undefined ? undefined : rollTableTrait(rng, def, ctx.opts);
}

function rollPlainTrait(rng: Rng, ctx: TraitContext, used: ReadonlySet<string>): AffixRoll | undefined {
  const def = pickTableDef(rng, traitsFor(ctx.slot, ctx.opts.depth, ctx.family), ctx, used);
  return def === undefined ? undefined : rollTableTrait(rng, def, ctx.opts);
}

/** 異色: OFF_COLOR_CHANCE で既定以外の色になる（反転は冥のまま） */
function maybeOffColor(rng: Rng, roll: AffixRoll): AffixRoll {
  if (roll.inverted === true || !rng.chance(OFF_COLOR_CHANCE)) return roll;
  const others = TRAIT_COLORS.filter((c) => c !== roll.color);
  return { ...roll, color: rng.pick(others) };
}

/** 性質の数: 深度の期待値 + 深度で広がる分散（三角分布）を 0..MAX_FOUND_TRAITS に収める */
export function rollTraitCount(rng: Rng, depth: number): number {
  const mean = Math.min(COUNT_BASE + COUNT_PER_DEPTH * depth, COUNT_MAX_MEAN);
  const spread = Math.min(COUNT_SPREAD_BASE + COUNT_SPREAD_PER_DEPTH * depth, COUNT_SPREAD_MAX);
  const u = rng.next() - rng.next();
  return Math.min(MAX_FOUND_TRAITS, Math.max(0, Math.round(mean + u * spread)));
}

/** 余白: 性質が少ないほど大きい */
export function rollMargin(rng: Rng, traitCount: number): number {
  const jitter = rng.int(MARGIN_JITTER_MIN, MARGIN_JITTER_MAX);
  return Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, VESSEL_CAPACITY - traitCount + jitter));
}

/**
 * count 個の性質を抽選する。key の重複なし。
 * 各枠は TRIGGER_TRAIT_CHANCE でトリガー文法、外れたら CONVERSION_TRAIT_CHANCE で変換、それ以外は表から。
 * ベースの色の傾きに合う性質は BASE_LEAN_WEIGHT 倍で選ばれる
 */
export function rollTraits(
  rng: Rng,
  slot: Slot,
  baseKey: string,
  count: number,
  opts: TraitRollOptions,
  family?: "melee" | "gun",
): AffixRoll[] {
  const ctx: TraitContext = { slot, lean: baseLean(baseKey), opts, family };
  const rolls: AffixRoll[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const roll =
      maybeRollTrigger(rng, ctx, used) ?? maybeRollConversion(rng, ctx, used) ?? rollPlainTrait(rng, ctx, used);
    if (roll === undefined) break;
    rolls.push(maybeOffColor(rng, roll));
    used.add(roll.key);
  }
  return rolls;
}

/** VOW_MIN_TRAITS 以上なら VOW_CHANCE で、性質 1 つ（トリガー以外）を誓約に置き換える */
function maybeVow(rng: Rng, traits: AffixRoll[]): AffixRoll[] {
  if (traits.length < VOW_MIN_TRAITS || !rng.chance(VOW_CHANCE)) return traits;
  const vow = rollVowTrait(rng);
  if (vow === undefined) return traits;
  const index = rng.int(0, traits.length - 1);
  return traits.map((t, i) => (i === index ? vow : t));
}

// ---------------------------------------------------------------------------
// 色を指定した性質（芽・染め）
// ---------------------------------------------------------------------------

/** 芽・染めで引ける候補のうち、トリガー文法の束の重み（表の性質の数に対する比率） */
const COLORED_TRIGGER_SHARE = 0.35;
const MIN_GROUP_WEIGHT = 1;

type ColoredGroup = "table" | "trigger" | "vow";

/**
 * 指定色の性質を 1 つロールする（used の key は除く）。
 * 候補: その色の表の性質 / その色のトリガー / 冥なら誓約。候補が無ければ任意の表の性質を指定色に染めて返す
 */
export function rollTraitOfColor(
  rng: Rng,
  slot: Slot,
  color: TraitColor,
  used: ReadonlySet<string>,
  opts: TraitRollOptions,
  family?: "melee" | "gun",
): AffixRoll | undefined {
  const tables = traitsFor(slot, opts.depth, family).filter((d) => affixColor(d) === color && !used.has(d.key));
  const shapes = grammarForSlot(slot, family).filter((s) => triggerCanBeColor(s, color));
  const vows = color === "umbra" ? KEYSTONES.filter((k) => !used.has(k.key)) : [];
  const groups: { group: ColoredGroup; weight: number }[] = [
    { group: "table", weight: tables.length },
    { group: "trigger", weight: shapes.length > 0 ? Math.max(MIN_GROUP_WEIGHT, tables.length * COLORED_TRIGGER_SHARE) : 0 },
    { group: "vow", weight: vows.length > 0 ? MIN_GROUP_WEIGHT : 0 },
  ];
  const picked = weightedPick(rng, groups.filter((g) => g.weight > 0), (g) => g.weight);
  switch (picked?.group) {
    case "table": {
      const def = rng.pick(tables);
      return rollTableTrait(rng, def, opts);
    }
    case "trigger": {
      const roll = rollTriggerTrait(rng, rng.pick(shapes), opts, color);
      if (!used.has(roll.key)) return roll;
      // 既出の key と衝突したら同じ色の表の性質に回す（芽の節目が候補なしで失われないように）
      if (tables.length > 0) return rollTableTrait(rng, rng.pick(tables), opts);
      break;
    }
    case "vow":
      return keystoneToRoll(rng.pick(vows));
    case undefined:
      break;
  }
  const fallback = traitsFor(slot, opts.depth, family).filter((d) => !used.has(d.key));
  if (fallback.length === 0) return undefined;
  return { ...rollTableTrait(rng, rng.pick(fallback), opts), color };
}

// ---------------------------------------------------------------------------
// 各ステップ
// ---------------------------------------------------------------------------

/** ドロップの部位抽選。左手（offHand）はベースが無いので対象にしない */
export function rollSlot(rng: Rng): Slot {
  return rng.pick(LOOT_SLOTS);
}

export function rollBase(rng: Rng, slot: Slot, depth: number): BaseItemDef {
  const candidates = basesForSlot(slot, depth);
  if (candidates.length === 0) throw new Error(`rollBase: no base for ${slot} at depth ${depth}`);
  return rng.pick(candidates);
}

/** implicit はベースの個性なので揺らぎを持たない（従来どおり幅の中で一様） */
export function rollImplicit(rng: Rng, base: BaseItemDef): AffixRoll | null {
  if (base.implicitKey === undefined) return null;
  const def = implicitDef(base.implicitKey);
  if (def === undefined) return null;
  return { ...rollRangeValues(rng, def.range, def.decimals ?? 0, def.decimals2 ?? 0), key: def.key };
}

export function namedChance(depth: number, boost = 0): number {
  const chance =
    NAMED_BASE_CHANCE * (1 + depth * NAMED_CHANCE_PER_LEVEL) * (1 + Math.max(0, boost)) ** NAMED_BOOST_EXPONENT;
  return Math.min(NAMED_MAX_CHANCE, chance);
}

function uniqueKeystone(unique: UniqueDef): AffixRoll | undefined {
  if (unique.keystone === undefined) return undefined;
  const def = keystoneDef(unique.keystone);
  if (def === undefined) throw new Error(`named ${unique.key}: unknown vow ${unique.keystone}`);
  return keystoneToRoll(def);
}

/** 名のある遺物の固定性質。値は揺らぐが小さく、反転しない */
export function rollUniqueAffixes(rng: Rng, unique: UniqueDef, depth: number): AffixRoll[] {
  const opts: TraitRollOptions = {
    depth: Math.max(depth, unique.minLevel),
    foundDepth: depth,
    sigmaScale: CALM_SIGMA_SCALE,
    allowInversion: false,
    origin: "named",
  };
  const traits = unique.affixes.map((spec) => {
    const def = affixDef(spec.key);
    if (def === undefined) throw new Error(`named ${unique.key}: unknown trait ${spec.key}`);
    return rollTableTrait(rng, def, opts);
  });
  const vow = uniqueKeystone(unique);
  return vow === undefined ? traits : [...traits, { ...vow, origin: "named" }];
}

// ---------------------------------------------------------------------------
// 生成本体
// ---------------------------------------------------------------------------

/** 同一セッション内で id を確実にユニークにするための連番 */
let serial = 0;

export function makeItemId(seed: number, now: number): string {
  const id = `${seed.toString(ID_RADIX)}-${now.toString(ID_RADIX)}-${serial.toString(ID_RADIX)}`;
  serial++;
  return id;
}

interface Rolled {
  base: BaseItemDef;
  affixes: AffixRoll[];
  margin: number;
  namedKey?: string;
}

function rollNamedItem(rng: Rng, slot: Slot, depth: number, exclude: readonly string[] = []): Rolled | undefined {
  const all = uniquesFor(slot, depth);
  // 除外が無ければ同じ配列のまま（従来と同じ乱数の引き方）
  const candidates = exclude.length === 0 ? all : all.filter((u) => !exclude.includes(u.key));
  if (candidates.length === 0) return undefined;
  const unique = rng.pick(candidates);
  const base = baseDef(unique.baseKey);
  if (base === undefined) throw new Error(`named ${unique.key}: unknown base ${unique.baseKey}`);
  return { base, affixes: rollUniqueAffixes(rng, unique, depth), margin: NAMED_MARGIN, namedKey: unique.key };
}

function rollRegularItem(rng: Rng, slot: Slot, opts: TraitRollOptions): Rolled {
  const base = rollBase(rng, slot, opts.depth);
  const count = rollTraitCount(rng, opts.depth);
  // 襤褸などの余白の上乗せ。器の容量は超えない
  const margin = Math.min(VESSEL_CAPACITY, rollMargin(rng, count) + (base.marginBonus ?? 0));
  const affixes = maybeVow(rng, rollTraits(rng, slot, base.key, count, opts, baseFamily(base)));
  return { base, affixes, margin };
}

/** 従来の抽選（名のある遺物 → 通常）。乱数の引き方は baseKey を足す前と同じ */
function rollRandomItem(
  rng: Rng,
  slot: Slot,
  depth: number,
  boost: number,
  opts: TraitRollOptions,
  excludeNamed: readonly string[] | undefined,
): Rolled {
  const named = rng.chance(namedChance(depth, boost)) ? rollNamedItem(rng, slot, depth, excludeNamed) : undefined;
  return named ?? rollRegularItem(rng, slot, opts);
}

/** 指定 key のベース。未知の key は呼び出し側の書き間違いなので throw してテストで気付かせる */
function fixedBaseDef(key: string): BaseItemDef {
  const base = baseDef(key);
  if (base === undefined) throw new Error(`generateItem: unknown base ${key}`);
  return base;
}

/** ベースを決め打ちした生成。plain なら性質 0 で、余白は性質 0 のときの幅 */
function rollFixedItem(rng: Rng, base: BaseItemDef, plain: boolean, opts: TraitRollOptions): Rolled {
  const count = plain ? 0 : rollTraitCount(rng, opts.depth);
  const margin = Math.min(VESSEL_CAPACITY, rollMargin(rng, count) + (base.marginBonus ?? 0));
  const traits = rollTraits(rng, base.slot, base.key, count, opts, baseFamily(base));
  return { base, affixes: plain ? traits : maybeVow(rng, traits), margin };
}

/** 誓約は常に末尾（表示の都合）。それ以外は抽選順 */
function vowsLast(affixes: readonly AffixRoll[]): AffixRoll[] {
  return [...affixes.filter((r) => !isKeystoneKey(r.key)), ...affixes.filter((r) => isKeystoneKey(r.key))];
}

export function generateItem(rng: Rng, opts: GenerateOptions): Item {
  const depth = Math.max(MIN_ITEM_LEVEL, Math.floor(opts.itemLevel));
  const seed = rng.int(0, UINT32_MAX);
  const r = createRng(seed);
  const boost = Math.max(0, opts.rarityBoost ?? 0);

  const fixedBase = opts.baseKey === undefined ? undefined : fixedBaseDef(opts.baseKey);
  const slot = fixedBase?.slot ?? opts.slot ?? rollSlot(r);
  const traitOpts: TraitRollOptions = { depth, foundDepth: opts.foundDepth, boost };
  const rolled = fixedBase
    ? rollFixedItem(r, fixedBase, opts.plain === true, traitOpts)
    : rollRandomItem(r, slot, depth, boost, traitOpts, opts.excludeNamed);
  const implicit = rollImplicit(r, rolled.base);
  const affixes = vowsLast(rolled.affixes);

  const item: Item = {
    id: makeItemId(seed, opts.now),
    seed,
    baseKey: rolled.base.key,
    slot,
    rarity: fluxClassOf(affixes),
    itemLevel: depth,
    name: "",
    implicit,
    affixes,
    foundDepth: opts.foundDepth,
    foundAt: opts.now,
    provenance: createEmptyProvenance(),
    margin: rolled.margin,
    marginMax: rolled.margin,
    milestones: [],
    buds: [],
    budOffer: null,
  };
  if (rolled.namedKey !== undefined) item.namedKey = rolled.namedKey;
  item.name = nameItem(item);
  return item;
}
