import { createRng, hashSeed, type Rng } from "../core/rng";
import { formatAffix, isConversionKey, isKeystoneKey } from "./affixes";
import { baseLean, traitColorOf } from "./colors";
import { fluxClassOf, inversionChance, rollFlux, rollInvertedFlux, sigmaAt } from "./flux";
import { VESSEL_CAPACITY, refluxTrait, rollTraitOfColor, type TraitRollOptions } from "./generator";
import { ensureGrowthFields } from "./migrate";
import { nameItem } from "./names";
import { maybeInscribe } from "./provenance";
import { isTriggerKey } from "./triggers";
import {
  TRAIT_COLORS,
  type AffixRoll,
  type Item,
  type Profile,
  type TraitColor,
} from "./types";

/**
 * クラフト（純ロジック）。docs/LOOT_DESIGN.md「クラフト（残響）」。
 * 原則: ランダムに性質を「足す」操作は無い。性質が増える経路は来歴（芽）だけ。
 * 通貨は色ごとの残響（紅響 / 蒼響 / 翠響 / 金響 / 冥響）。分解（砕く）で、性質の色に応じて得る。
 * 6 操作: 砕く / 染め / 鎮め / 煽り / 削ぎ / 移し。どれも何かを得て何かを失う。
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

export const ECHO_OPS = ["shatter", "dye", "calm", "stir", "pare", "transfer"] as const;
export type EchoOp = (typeof ECHO_OPS)[number];

export const ECHO_OP_LABEL: Readonly<Record<EchoOp, string>> = {
  shatter: "砕く",
  dye: "染め",
  calm: "鎮め",
  stir: "煽り",
  pare: "削ぎ",
  transfer: "移し",
};

/** 操作の説明（UI のツールチップ用。動詞で語る） */
export const ECHO_OP_HINT: Readonly<Record<EchoOp, string>> = {
  shatter: "遺物を砕き、性質の色の残響を得る",
  dye: "性質 1 つを、残響の色の別の性質に置き換える（揺らぎは引き継ぐ）",
  calm: "性質 1 つの揺らぎを半分にし、期待値へ寄せる（反転も解ける）。代わりに余白が 1 減る",
  stir: "性質 1 つの揺らぎを大きく引き直す。反転することもある",
  pare: "性質 1 つを消し、余白を 1 戻す",
  transfer: "銘か芽吹いた性質 1 つを、同じ部位の別の遺物へ移す。元の遺物は失われる",
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
  | { op: "transfer"; item: Item; target: Item; what: TransferWhat };

/** 操作ごとの専用 RNG。同じ item.id / counter なら同じ結果 */
export function craftRng(itemId: string, counter: number): Rng {
  return createRng(hashSeed(`${itemId}#${counter}`));
}

function traitAt(item: Item, index: number): AffixRoll | undefined {
  return item.affixes[index];
}

/** 操作のコスト。砕くは null（無料）。対象の性質が無い・色が無い場合も null */
export function echoCost(req: EchoRequest): EchoCost | null {
  switch (req.op) {
    case "shatter":
      return null;
    case "dye":
      return { color: req.color, amount: DYE_COST };
    case "calm":
    case "pare": {
      const roll = traitAt(req.item, req.traitIndex);
      const color = roll === undefined ? undefined : traitColorOf(roll);
      if (color === undefined) return null;
      return { color, amount: req.op === "calm" ? CALM_COST : PARE_COST };
    }
    case "stir":
      return { color: UMBRA, amount: STIR_COST };
    case "transfer":
      return { color: UMBRA, amount: TRANSFER_COST };
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

/** 染め: index の性質を、color の別の性質に置き換える。揺らぎ（flux）は引き継ぐ */
export function dyeTrait(item: Item, index: number, color: TraitColor, rng: Rng): Item | null {
  const roll = traitAt(item, index);
  if (roll === undefined || traitColorOf(roll) === color) return null;
  const used = new Set(item.affixes.map((r) => r.key));
  const fresh = rollTraitOfColor(rng, item.slot, color, used, traitOptions(item, roll.origin));
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
  shatter: "砕けるものがない",
  dye: "その性質はすでにその色か、置き換えられる性質がない",
  calm: "鎮める揺らぎがないか、余白が足りない",
  stir: "煽れる性質がない（誓約は揺らがない）",
  pare: "削ぐ性質がない",
  transfer: "移せない（同じ部位の別の遺物へ、銘は無銘へ、芽は余白のある遺物へ）",
};

export function echoBlockMessage(reason: EchoRejectReason, req: EchoRequest): string {
  if (reason === "invalid") return INVALID_MESSAGE[req.op];
  const cost = echoCost(req);
  return cost === null ? INVALID_MESSAGE[req.op] : `${ECHO_LABEL[cost.color]}が${cost.amount}必要`;
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
  }
}

function gainedText(gained: EchoWallet): string {
  return TRAIT_COLORS.filter((c) => gained[c] > 0)
    .map((c) => `${ECHO_LABEL[c]} +${gained[c]}`)
    .join("・");
}

function changeNote(req: EchoRequest, after: Item): string {
  if (req.op === "transfer") return `${req.item.name} → ${after.name}`;
  if (req.op === "shatter") return "";
  const before = traitAt(req.item, req.traitIndex);
  if (req.op === "pare") return before === undefined ? "" : `- ${formatAffix(before)}`;
  const now = traitAt(after, req.traitIndex);
  return now === undefined ? "" : formatAffix(now);
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
    req.op === "transfer" ? { ...req, item: source, target: ensureGrowthFields({ ...req.target }) } : { ...req, item: source };
  const after = runEchoOp(normalized, craftRng(req.item.id, state.counter));
  if (after === null) return { ok: false, op, reason: "invalid", message: echoBlockMessage("invalid", req) };
  if (cost !== null) state.echoes[cost.color] -= cost.amount;
  state.counter += 1;
  const consumedIds = req.op === "transfer" ? [req.item.id] : [];
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
