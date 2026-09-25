import { createRng, hashSeed, type Rng } from "../core/rng";
import { affixDef, formatAffix, isConversionKey, isKeystoneKey } from "./affixes";
import { baseDef, baseFamily } from "./bases";
import { OPPOSITE_COLOR, baseLean, traitColorOf } from "./colors";
import { fluxClassOf, inversionChance, rollFlux, rollInvertedFlux, scaledNominalAt, sigmaAt } from "./flux";
import { VESSEL_CAPACITY, refluxTrait, rollTraitOfColor, type TraitRollOptions } from "./generator";
import { PROVENANCE_COUNTERS, ensureGrowthFields } from "./migrate";
import { nameItem } from "./names";
import { maybeInscribe, offerNextBud } from "./provenance";
import { isTriggerKey } from "./triggers";
import {
  TRAIT_COLORS,
  type AffixRoll,
  type Item,
  type Profile,
  type Provenance,
  type TraitColor,
} from "./types";

/**
 * クラフト（純ロジック）。docs/LOOT_DESIGN.md「クラフト（残響）」。
 * 原則: ランダムに性質を「足す」操作は無い。性質が増える経路は来歴（芽）だけ。
 * 通貨は色ごとの残響（紅響 / 蒼響 / 翠響 / 金響 / 冥響）。分解（砕く）で、性質の色に応じて得る。
 * 12 操作: 砕く / 染め / 鎮め / 煽り / 削ぎ / 移し / 転調 / 脱色 / 呼び戻し / 注ぎ / 鍛え直し / 張り。どれも何かを得て何かを失う。
 * 乱数はゲームの state.rng ではなく専用 RNG（item.id + クラフト回数）。ゲームの決定性に影響しない。
 */

// ---------------------------------------------------------------------------
// 残響（通貨）
// ---------------------------------------------------------------------------

export type EchoWallet = Record<TraitColor, number>;

export function createEchoWallet(): EchoWallet {
  return { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0 };
}

/** 残響の表示名 */
export const ECHO_LABEL: Readonly<Record<TraitColor, string>> = {
  crimson: "紅響",
  azure: "蒼響",
  jade: "翠響",
  gold: "金響",
  umbra: "冥響",
};

// ---------------------------------------------------------------------------
// 操作とコスト
// ---------------------------------------------------------------------------

export const ECHO_OPS = [
  "shatter",
  "dye",
  "calm",
  "stir",
  "pare",
  "transfer",
  "modulate",
  // 2026-09 第 2 弾（docs/ideas/loot-expansion.md 8 章 O2〜O6）
  "bleach",
  "recall",
  "pour",
  "reforge",
  "tension",
] as const;
export type EchoOp = (typeof ECHO_OPS)[number];

export const ECHO_OP_LABEL: Readonly<Record<EchoOp, string>> = {
  shatter: "砕く",
  dye: "染め",
  calm: "鎮め",
  stir: "煽り",
  pare: "削ぎ",
  transfer: "移し",
  modulate: "転調",
  bleach: "脱色",
  recall: "呼び戻し",
  pour: "注ぎ",
  reforge: "鍛え直し",
  tension: "張り",
};

/** 操作の説明（UI のツールチップ用。動詞で語る） */
export const ECHO_OP_HINT: Readonly<Record<EchoOp, string>> = {
  shatter: "遺物を砕き、性質の色の残響を得る",
  dye: "性質 1 つを、残響の色の別の性質に置き換える",
  calm: "性質 1 つの揺らぎを半分にする。余白 -1",
  stir: "性質 1 つの揺らぎを引き直す",
  pare: "性質 1 つを消す。余白 +1",
  transfer: "銘か芽吹いた性質 1 つを、同じ部位の別の遺物へ移す。元の遺物は失われる",
  modulate: "性質 1 つの色を反対色へ変える",
  bleach: "性質 1 つを無色にする。値は 9 割",
  recall: "過去の芽で選ばなかった方に取り直す",
  pour: "遺物を捧げ、来歴の半分を同じ部位の別の遺物へ注ぐ",
  reforge: "性質 1 つの期待値を、来歴の最深で取り直す。余白の上限 -1",
  tension: "代償付きの性質 1 つの利得と代償を 1.3 倍にする",
};

/** 染め: 目標色の残響 */
export const DYE_COST = 3;
/** 鎮め: 性質の色の残響 */
export const CALM_COST = 2;
/** 煽り: 冥響 */
export const STIR_COST = 2;
/** 削ぎ: 性質の色の残響 */
export const PARE_COST = 1;
/** 移し: 冥響 */
export const TRANSFER_COST = 3;
/** 転調: 変えた先の色（反対色）の残響 */
export const MODULATE_COST = 3;
/** 脱色: 翠響 / 呼び戻し: 冥響 / 鍛え直し: 性質の色の残響 / 張り: 冥響（注ぎは無料） */
export const BLEACH_COST = 2;
export const RECALL_COST = 5;
export const REFORGE_COST = 4;
export const TENSION_COST = 2;
/** 脱色した性質の値の倍率 */
export const BLEACH_VALUE_FACTOR = 0.9;
/** 注ぎで移す来歴の割合（端数は切り捨て） */
export const POUR_SHARE = 0.5;
/** 張りで利得と代償に掛ける倍率 */
export const TENSION_FACTOR = 1.3;
/** 鍛え直しの代償（余白の上限） */
export const REFORGE_MARGIN_COST = 1;
/** 鎮めの代償（余白） */
export const CALM_MARGIN_COST = 1;
/** 削ぎで戻る余白 */
export const PARE_MARGIN_GAIN = 1;
/** 煽りの σ 倍率と、反転の最低確率（浅い遺物でも反転し得る） */
export const STIR_SIGMA_SCALE = 1.2;
export const STIR_MIN_INVERSION_CHANCE = 0.1;
/** 鎮めは flux をこの倍率にする（0 へ寄せる） */
export const CALM_FLUX_FACTOR = 0.5;
/** 砕く: 性質 1 つにつきその色の残響 */
export const SHATTER_PER_TRAIT = 1;
/** 砕く: 性質の無い遺物はベースの傾きの色（無ければ紅）を 1 */
export const SHATTER_EMPTY_YIELD = 1;
const SHATTER_FALLBACK_COLOR: TraitColor = "crimson";
/** これ以下の |flux| は 0 とみなす（鎮め済み） */
const FLUX_EPSILON = 0.005;

const UMBRA: TraitColor = "umbra";
const JADE: TraitColor = "jade";
/** 値の丸め（脱色・張りの掛け算で出る浮動小数の端数を落とす） */
const VALUE_DECIMALS = 3;

export interface EchoCost {
  color: TraitColor;
  amount: number;
}

/** 移す対象。銘か、芽吹いた性質（source.affixes の index） */
export type TransferWhat = { kind: "inscription" } | { kind: "bud"; traitIndex: number };

export type EchoRequest =
  | { op: "shatter"; item: Item }
  | { op: "dye"; item: Item; traitIndex: number; color: TraitColor }
  | { op: "calm"; item: Item; traitIndex: number }
  | { op: "stir"; item: Item; traitIndex: number }
  | { op: "pare"; item: Item; traitIndex: number }
  | { op: "transfer"; item: Item; target: Item; what: TransferWhat }
  | { op: "modulate"; item: Item; traitIndex: number }
  | { op: "bleach"; item: Item; traitIndex: number }
  | { op: "recall"; item: Item; budIndex: number }
  | { op: "pour"; item: Item; target: Item }
  | { op: "reforge"; item: Item; traitIndex: number }
  | { op: "tension"; item: Item; traitIndex: number };

/** 操作ごとの専用 RNG。同じ item.id / counter なら同じ結果 */
export function craftRng(itemId: string, counter: number): Rng {
  return createRng(hashSeed(`${itemId}#${counter}`));
}

function traitAt(item: Item, index: number): AffixRoll | undefined {
  return item.affixes[index];
}

/** 費用の色に使う性質の色。脱色済みでも元の色で払う（無色だから無料、にはしない） */
function costColorOf(roll: AffixRoll | undefined): TraitColor | undefined {
  if (roll === undefined) return undefined;
  return traitColorOf(roll.colorless === true ? { ...roll, colorless: false } : roll);
}

/** 性質の色の残響で払う操作の費用 */
function traitColorCost(item: Item, index: number, amount: number): EchoCost | null {
  const color = costColorOf(traitAt(item, index));
  return color === undefined ? null : { color, amount };
}

/** 操作のコスト。砕く・注ぎは null（無料）。対象の性質が無い・色が無い場合も null */
export function echoCost(req: EchoRequest): EchoCost | null {
  switch (req.op) {
    case "shatter":
    case "pour":
      return null;
    case "dye":
      return { color: req.color, amount: DYE_COST };
    case "calm":
      return traitColorCost(req.item, req.traitIndex, CALM_COST);
    case "pare":
      return traitColorCost(req.item, req.traitIndex, PARE_COST);
    case "reforge":
      return traitColorCost(req.item, req.traitIndex, REFORGE_COST);
    case "bleach":
      return { color: JADE, amount: BLEACH_COST };
    case "recall":
      return { color: UMBRA, amount: RECALL_COST };
    case "tension":
      return { color: UMBRA, amount: TENSION_COST };
    case "stir":
      return { color: UMBRA, amount: STIR_COST };
    case "transfer":
      return { color: UMBRA, amount: TRANSFER_COST };
    case "modulate": {
      const to = modulatedColor(traitAt(req.item, req.traitIndex));
      return to === undefined ? null : { color: to, amount: MODULATE_COST };
    }
  }
}

export function canAffordEcho(echoes: Readonly<EchoWallet>, cost: EchoCost | null): boolean {
  return cost === null || echoes[cost.color] >= cost.amount;
}

// ---------------------------------------------------------------------------
// 各操作（純関数。成立しなければ null）
// ---------------------------------------------------------------------------

/** 性質や余白が変わった後の名前・分類の付け直し */
function refreshed(item: Item): Item {
  const out = { ...item, rarity: fluxClassOf(item.affixes) };
  out.name = nameItem(out);
  return out;
}

function replaceTrait(item: Item, index: number, roll: AffixRoll): Item {
  return refreshed({ ...item, affixes: item.affixes.map((r, i) => (i === index ? roll : r)) });
}

/** 砕いて得る残響 */
export function shatterYield(item: Item): EchoWallet {
  const gained = createEchoWallet();
  for (const roll of item.affixes) {
    const color = traitColorOf(roll);
    if (color !== undefined) gained[color] += SHATTER_PER_TRAIT;
  }
  if (TRAIT_COLORS.every((c) => gained[c] === 0)) {
    gained[baseLean(item.baseKey) ?? SHATTER_FALLBACK_COLOR] += SHATTER_EMPTY_YIELD;
  }
  return gained;
}

function traitOptions(item: Item, origin: AffixRoll["origin"]): TraitRollOptions {
  return { depth: item.itemLevel, foundDepth: item.foundDepth, allowInversion: false, origin: origin ?? "found" };
}

/** アイテムの右手の家系（右手以外や moveset を持たないベースは undefined） */
function itemFamily(item: Item): "melee" | "gun" | undefined {
  const base = baseDef(item.baseKey);
  return base === undefined ? undefined : baseFamily(base);
}

/** 染め: index の性質を、color の別の性質に置き換える。揺らぎ（flux）は引き継ぐ */
export function dyeTrait(item: Item, index: number, color: TraitColor, rng: Rng): Item | null {
  const roll = traitAt(item, index);
  if (roll === undefined || traitColorOf(roll) === color) return null;
  // 提示中の芽の候補と重複すると、染めで作った性質を選んだ扱いになり得るので候補の key も避ける
  const used = new Set([...item.affixes.map((r) => r.key), ...(item.budOffer?.options.map((o) => o.key) ?? [])]);
  const fresh = rollTraitOfColor(rng, item.slot, color, used, traitOptions(item, roll.origin), itemFamily(item));
  if (fresh === undefined) return null;
  const carried = roll.flux === undefined || isKeystoneKey(fresh.key) ? fresh : refluxTrait(fresh, roll.flux);
  const colored: AffixRoll = carried.inverted === true ? carried : { ...carried, color };
  return replaceTrait(item, index, colored);
}

function hasFlux(roll: AffixRoll): boolean {
  return Math.abs(roll.flux ?? 0) > FLUX_EPSILON;
}

/** 鎮め: 揺らぎを半分にする（反転は解ける）。余白を CALM_MARGIN_COST 払う */
export function calmTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  if (roll === undefined || !hasFlux(roll) || isKeystoneKey(roll.key)) return null;
  const margin = item.margin ?? 0;
  if (margin < CALM_MARGIN_COST) return null;
  const calmed = refluxTrait(roll, (roll.flux ?? 0) * CALM_FLUX_FACTOR);
  const out = { ...replaceTrait(item, index, calmed), margin: margin - CALM_MARGIN_COST };
  maybeInscribe(out);
  return out;
}

/** 表の性質（トリガー・変換以外）なら反転し得る */
function stirCanInvert(roll: AffixRoll): boolean {
  return !isTriggerKey(roll.key) && !isConversionKey(roll.key);
}

/** 煽り: 揺らぎを σ × STIR_SIGMA_SCALE で引き直す。反転の危険がある */
export function stirTrait(item: Item, index: number, rng: Rng): Item | null {
  const roll = traitAt(item, index);
  if (roll === undefined || isKeystoneKey(roll.key)) return null;
  const chance = Math.max(inversionChance(item.foundDepth), STIR_MIN_INVERSION_CHANCE);
  const invert = stirCanInvert(roll) && rng.chance(chance);
  const flux = invert ? rollInvertedFlux(rng) : rollFlux(rng, sigmaAt(item.itemLevel) * STIR_SIGMA_SCALE);
  const stirred = refluxTrait(roll, flux);
  if (stirred === roll) return null;
  return replaceTrait(item, index, stirred);
}

/** 削ぎ: 性質 1 つを消し、余白を 1 戻す（器の容量まで） */
export function pareTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  if (roll === undefined) return null;
  const margin = Math.min(VESSEL_CAPACITY, (item.margin ?? 0) + PARE_MARGIN_GAIN);
  const affixes = item.affixes.filter((_, i) => i !== index);
  return refreshed({ ...item, affixes, margin, marginMax: Math.max(item.marginMax ?? 0, margin) });
}

/**
 * 転調で変わる先の色。反転（色は冥に固定）・誓約（遊び方そのもの）・色の無いものは変えられない
 */
export function modulatedColor(roll: AffixRoll | undefined): TraitColor | undefined {
  if (roll === undefined || roll.inverted === true || isKeystoneKey(roll.key)) return undefined;
  const color = traitColorOf(roll);
  if (color === undefined) return undefined;
  const to = OPPOSITE_COLOR[color];
  return to === color ? undefined : to;
}

/** 転調: 性質 1 つの色だけを反対色へ（値・揺らぎ・出自はそのまま）。共鳴の配合を性質を失わずに動かす */
export function modulateTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  const to = modulatedColor(roll);
  if (roll === undefined || to === undefined) return null;
  return replaceTrait(item, index, { ...roll, color: to });
}

/** 移し: 銘か芽吹いた性質を target へ。source は失われる（applyEchoResult が消す） */
export function transferGrowth(source: Item, target: Item, what: TransferWhat): Item | null {
  if (source.id === target.id || source.slot !== target.slot) return null;
  if (what.kind === "inscription") {
    if (source.inscription === undefined || target.inscription !== undefined) return null;
    return refreshed({ ...target, inscription: source.inscription });
  }
  const roll = traitAt(source, what.traitIndex);
  if (roll === undefined || roll.origin !== "bud") return null;
  if (target.affixes.some((r) => r.key === roll.key)) return null;
  const margin = target.margin ?? 0;
  if (margin <= 0) return null;
  const out = refreshed({ ...target, affixes: [...target.affixes, roll], margin: margin - 1 });
  maybeInscribe(out);
  return out;
}

// ---------------------------------------------------------------------------
// 2026-09 第 2 弾の操作（脱色・呼び戻し・注ぎ・鍛え直し・張り）
// ---------------------------------------------------------------------------

function roundValue(v: number): number {
  const scale = 10 ** VALUE_DECIMALS;
  return Math.round(v * scale) / scale;
}

/**
 * 値と期待値を factor 倍にしたコピー（期待値も掛けるので、鎮め・煽りで揺らぎを引き直しても倍率は残る）。
 * トリガーの value2 は発動確率と持続のエンコードなので触らない
 */
function scaleRollValues(roll: AffixRoll, factor: number): AffixRoll {
  const out: AffixRoll = { ...roll, value: roundValue(roll.value * factor) };
  if (roll.nominal !== undefined) out.nominal = roll.nominal * factor;
  if (roll.value2 === undefined || affixDef(roll.key) === undefined) return out;
  out.value2 = roundValue(roll.value2 * factor);
  if (roll.nominal2 !== undefined) out.nominal2 = roll.nominal2 * factor;
  return out;
}

/** 脱色できるか: 色を持つ（無色でない）・反転していない・誓約でない */
export function canBleachTrait(roll: AffixRoll | undefined): roll is AffixRoll {
  if (roll === undefined || roll.colorless === true || roll.inverted === true || isKeystoneKey(roll.key)) return false;
  return traitColorOf(roll) !== undefined;
}

/** 脱色: 無色にして共鳴の配合から外す。値は BLEACH_VALUE_FACTOR 倍 */
export function bleachTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  if (!canBleachTrait(roll)) return null;
  return replaceTrait(item, index, { ...scaleRollValues(roll, BLEACH_VALUE_FACTOR), colorless: true });
}

/** 呼び戻しをもう使ったか（1 つの遺物に 1 回） */
export function hasRecalled(item: Item): boolean {
  return (item.buds ?? []).some((b) => b.recalled === true);
}

/** 呼び戻せる芽か: 選んだ方がまだ芽吹いた性質として残っていて、選ばなかった方と同じ key が無い */
export function canRecallBud(item: Item, budIndex: number): boolean {
  const bud = item.buds?.[budIndex];
  if (bud === undefined || hasRecalled(item)) return false;
  const chosen = bud.options[bud.chosen];
  const other = bud.options[bud.chosen === 0 ? 1 : 0];
  const held = item.affixes.some((r) => r.key === chosen.key && r.origin === "bud");
  return held && !item.affixes.some((r) => r.key === other.key);
}

/** 呼び戻し: 過去の芽で選ばなかった方を取り直し、選んでいた方を失う */
export function recallBud(item: Item, budIndex: number): Item | null {
  if (!canRecallBud(item, budIndex)) return null;
  const buds = item.buds ?? [];
  const bud = buds[budIndex];
  if (bud === undefined) return null;
  const flipped: 0 | 1 = bud.chosen === 0 ? 1 : 0;
  const chosen = bud.options[bud.chosen];
  const index = item.affixes.findIndex((r) => r.key === chosen.key && r.origin === "bud");
  const affixes = item.affixes.map((r, i) => (i === index ? { ...bud.options[flipped], origin: "bud" as const } : r));
  const nextBuds = buds.map((b, i) => (i === budIndex ? { ...b, chosen: flipped, recalled: true } : b));
  return refreshed({ ...item, affixes, buds: nextBuds });
}

/** 注ぎ: source の来歴の半分を target の来歴へ足した来歴（元は変えない） */
export function pouredProvenance(source: Readonly<Provenance>, target: Readonly<Provenance>): Provenance {
  const out: Provenance = { ...target, killsByEnemy: { ...target.killsByEnemy } };
  for (const key of PROVENANCE_COUNTERS) {
    // 最深は量ではないので足さず、深い方を残す
    out[key] = key === "deepest" ? Math.max(target.deepest, source.deepest) : target[key] + Math.floor(source[key] * POUR_SHARE);
  }
  for (const [enemy, n] of Object.entries(source.killsByEnemy)) {
    out.killsByEnemy[enemy] = (out.killsByEnemy[enemy] ?? 0) + Math.floor(n * POUR_SHARE);
  }
  return out;
}

/** 注ぎ: 捧げた遺物（source）の来歴の半分を同じ部位の target へ。届いた節目の芽はその場で出す */
export function pourGrowth(source: Item, target: Item): Item | null {
  if (source.id === target.id || source.slot !== target.slot || source.provenance === undefined) return null;
  const base = ensureGrowthFields({ ...target, milestones: [...(target.milestones ?? [])], buds: [...(target.buds ?? [])] });
  const provenance = pouredProvenance(source.provenance, base.provenance ?? source.provenance);
  const out: Item = { ...base, provenance };
  offerNextBud(out);
  return out;
}

/** 性質の修飾（張り・脱色）の倍率。鍛え直しで期待値を取り直しても修飾は残す */
function modifierFactor(roll: AffixRoll): number {
  return (roll.tensed === true ? TENSION_FACTOR : 1) * (roll.colorless === true ? BLEACH_VALUE_FACTOR : 1);
}

/**
 * 鍛え直し: 期待値を来歴の最深で取り直す（揺らぎはそのまま）。余白の上限を REFORGE_MARGIN_COST 払う。
 * 期待値が上がらない（最深がまだ浅い）なら成立しない
 */
export function reforgeTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  const def = roll === undefined ? undefined : affixDef(roll.key);
  const marginMax = item.marginMax ?? 0;
  if (roll === undefined || def === undefined || isKeystoneKey(roll.key) || marginMax < REFORGE_MARGIN_COST) return null;
  const deepest = item.provenance?.deepest ?? 0;
  const fresh = scaledNominalAt(def, deepest, !isConversionKey(def.key));
  const factor = modifierFactor(roll);
  const nominal = fresh.nominal * factor;
  const current = roll.nominal ?? Math.abs(roll.value);
  if (nominal <= current) return null;
  const lifted: AffixRoll = { ...roll, nominal };
  if (fresh.nominal2 !== undefined && roll.value2 !== undefined) lifted.nominal2 = fresh.nominal2 * factor;
  const reforged = refluxTrait(lifted, roll.flux ?? 0);
  const nextMax = marginMax - REFORGE_MARGIN_COST;
  const out = { ...replaceTrait(item, index, reforged), marginMax: nextMax, margin: Math.min(item.margin ?? 0, nextMax) };
  out.reforged = (item.reforged ?? 0) + 1;
  maybeInscribe(out);
  return out;
}

/** 張れる性質: 代償付き（tradeoff）で value2 を持ち、まだ張っていない・反転していない */
export function canTension(roll: AffixRoll | undefined): roll is AffixRoll {
  if (roll === undefined || roll.tensed === true || roll.inverted === true || roll.value2 === undefined) return false;
  return affixDef(roll.key)?.tags.includes("tradeoff") === true;
}

/** 張り: 利得と代償を両方 TENSION_FACTOR 倍（期待値ごと掛けるので鎮めでは戻らない） */
export function tensionTrait(item: Item, index: number): Item | null {
  const roll = traitAt(item, index);
  if (!canTension(roll)) return null;
  return replaceTrait(item, index, { ...scaleRollValues(roll, TENSION_FACTOR), tensed: true });
}

// ---------------------------------------------------------------------------
// 実行（通貨の確認・消費・回数の更新）
// ---------------------------------------------------------------------------

export interface EchoCraftState {
  echoes: EchoWallet;
  /** クラフト回数。専用 RNG の seed に混ぜる */
  counter: number;
}

export type EchoRejectReason = "insufficient" | "invalid";

export type EchoResult =
  | {
      ok: true;
      op: EchoOp;
      before: Item;
      /** 操作後のアイテム。砕くは null */
      item: Item | null;
      /** stash / 装備から消えるアイテム（砕く・移しの元） */
      consumedIds: string[];
      /** 得た残響（砕く） */
      gained: EchoWallet;
      message: string;
    }
  | { ok: false; op: EchoOp; reason: EchoRejectReason; message: string };

const INVALID_MESSAGE: Readonly<Record<EchoOp, string>> = {
  shatter: "砕ける遺物がありません",
  dye: "その性質はすでにその色か、置き換え先の性質がありません",
  calm: "鎮める揺らぎがないか、余白が足りません",
  stir: "煽れる性質がありません（誓約は対象外）",
  pare: "削げる性質がありません",
  transfer: "移せません（同じ部位の別の遺物へ。銘は無銘の遺物へ、芽は余白のある遺物へ）",
  modulate: "転調できる性質がありません（反転した性質と誓約は対象外）",
  bleach: "脱色できる性質がありません（反転・誓約・無色の性質は対象外）",
  recall: "呼び戻せません（1 つの遺物に 1 回だけ。選んだ芽が残っていて、選ばなかった方が重ならない場合のみ）",
  pour: "注げません（来歴のある遺物から、同じ部位の別の遺物へ）",
  reforge: "鍛え直せません（来歴の最深が浅く期待値が上がらないか、余白の上限が足りません）",
  tension: "張れる性質がありません（代償付きの性質に 1 回だけ）",
};

export function echoBlockMessage(reason: EchoRejectReason, req: EchoRequest): string {
  if (reason === "invalid") return INVALID_MESSAGE[req.op];
  const cost = echoCost(req);
  return cost === null ? INVALID_MESSAGE[req.op] : `${ECHO_LABEL[cost.color]}が ${cost.amount} 必要です`;
}

function runEchoOp(req: EchoRequest, rng: Rng): Item | null {
  switch (req.op) {
    case "shatter":
      return null;
    case "dye":
      return dyeTrait(req.item, req.traitIndex, req.color, rng);
    case "calm":
      return calmTrait(req.item, req.traitIndex);
    case "stir":
      return stirTrait(req.item, req.traitIndex, rng);
    case "pare":
      return pareTrait(req.item, req.traitIndex);
    case "transfer":
      return transferGrowth(req.item, req.target, req.what);
    case "modulate":
      return modulateTrait(req.item, req.traitIndex);
    case "bleach":
      return bleachTrait(req.item, req.traitIndex);
    case "recall":
      return recallBud(req.item, req.budIndex);
    case "pour":
      return pourGrowth(req.item, req.target);
    case "reforge":
      return reforgeTrait(req.item, req.traitIndex);
    case "tension":
      return tensionTrait(req.item, req.traitIndex);
  }
}

function gainedText(gained: EchoWallet): string {
  return TRAIT_COLORS.filter((c) => gained[c] > 0)
    .map((c) => `${ECHO_LABEL[c]} +${gained[c]}`)
    .join("・");
}

function changeNote(req: EchoRequest, after: Item): string {
  switch (req.op) {
    case "transfer":
    case "pour":
      return `${req.item.name} → ${after.name}`;
    case "shatter":
      return "";
    case "recall": {
      const bud = after.buds?.[req.budIndex];
      return bud === undefined ? "" : formatAffix(bud.options[bud.chosen]);
    }
    case "pare": {
      const before = traitAt(req.item, req.traitIndex);
      return before === undefined ? "" : `- ${formatAffix(before)}`;
    }
    default: {
      const now = traitAt(after, req.traitIndex);
      return now === undefined ? "" : formatAffix(now);
    }
  }
}

/** 相手を取る操作（移し・注ぎ）は元の遺物が消える */
function consumesSource(req: EchoRequest): boolean {
  return req.op === "transfer" || req.op === "pour";
}

function shatter(state: EchoCraftState, item: Item): EchoResult {
  const gained = shatterYield(item);
  for (const c of TRAIT_COLORS) state.echoes[c] += gained[c];
  state.counter += 1;
  const message = `${ECHO_OP_LABEL.shatter}: ${item.name}（${gainedText(gained)}）`;
  return { ok: true, op: "shatter", before: item, item: null, consumedIds: [item.id], gained, message };
}

/**
 * クラフトを 1 回実行する。成功時のみ残響を消費し counter を進める。profile は触らない（applyEchoResult を参照）
 */
export function craftEcho(state: EchoCraftState, req: EchoRequest): EchoResult {
  const { op } = req;
  if (op === "shatter") return shatter(state, req.item);
  const cost = echoCost(req);
  if (!canAffordEcho(state.echoes, cost)) {
    return { ok: false, op, reason: "insufficient", message: echoBlockMessage("insufficient", req) };
  }
  const source = ensureGrowthFields({ ...req.item });
  const normalized: EchoRequest =
    req.op === "transfer" || req.op === "pour"
      ? { ...req, item: source, target: ensureGrowthFields({ ...req.target }) }
      : { ...req, item: source };
  const after = runEchoOp(normalized, craftRng(req.item.id, state.counter));
  if (after === null) return { ok: false, op, reason: "invalid", message: echoBlockMessage("invalid", req) };
  if (cost !== null) state.echoes[cost.color] -= cost.amount;
  state.counter += 1;
  const consumedIds = consumesSource(req) ? [req.item.id] : [];
  const note = changeNote(normalized, after);
  const message = note.length === 0 ? `${ECHO_OP_LABEL[op]}: ${after.name}` : `${ECHO_OP_LABEL[op]}: ${after.name}（${note}）`;
  return { ok: true, op, before: req.item, item: after, consumedIds, gained: createEchoWallet(), message };
}

function replaceInProfile(profile: Profile, item: Item): boolean {
  const index = profile.stash.findIndex((it) => it.id === item.id);
  if (index >= 0) {
    profile.stash[index] = item;
    return true;
  }
  const equipped = profile.equipment[item.slot];
  if (equipped?.id !== item.id) return false;
  profile.equipment[item.slot] = item;
  return true;
}

function removeFromProfile(profile: Profile, id: string): void {
  profile.stash = profile.stash.filter((it) => it.id !== id);
  for (const item of Object.values(profile.equipment)) {
    if (item?.id === id) profile.equipment[item.slot] = null;
  }
}

/**
 * 成功したクラフトを profile に反映する（stash と装備の両方を探す）。
 * 砕く・移しの元は消え、それ以外は同じ位置で置き換える。反映できたら true
 */
export function applyEchoResult(profile: Profile, result: EchoResult): boolean {
  if (!result.ok) return false;
  for (const id of result.consumedIds) removeFromProfile(profile, id);
  return result.item === null ? true : replaceInProfile(profile, result.item);
}

/**
 * 旧セーブ（roguelike.craft.v1 の version 1）の通貨。読み込み時の換算にだけ使う。
 * 旧クラフト API は撤去済みで、ここは移行のための定義
 */
export const LEGACY_CURRENCIES = ["dust", "shard", "essence", "relic"] as const;
export type LegacyCurrency = (typeof LEGACY_CURRENCIES)[number];
export type LegacyWallet = Record<LegacyCurrency, number>;

/** 旧通貨 → 残響の換算（1 単位あたりの点数）。点数の合計を 5 色に均等に配り、余りは TRAIT_COLORS 順に 1 ずつ */
export const LEGACY_CURRENCY_POINTS: Readonly<Record<LegacyCurrency, number>> = {
  dust: 1,
  shard: 2,
  essence: 4,
  relic: 8,
};

/** 旧 wallet を残響に換算する（旧 wallet は変えない） */
export function convertLegacyWallet(wallet: Readonly<LegacyWallet>): EchoWallet {
  const points = LEGACY_CURRENCIES.reduce((sum, c) => sum + wallet[c] * LEGACY_CURRENCY_POINTS[c], 0);
  const echoes = createEchoWallet();
  const share = Math.floor(points / TRAIT_COLORS.length);
  const remainder = points - share * TRAIT_COLORS.length;
  TRAIT_COLORS.forEach((c, i) => {
    echoes[c] = share + (i < remainder ? 1 : 0);
  });
  return echoes;
}
