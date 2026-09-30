import { createRng, hashSeed, type Rng } from "../core/rng";
import { formatAffix, isConversionKey, isKeystoneKey } from "./affixes";
import { baseLean, traitColorOf } from "./colors";
import { fluxClassOf, inversionChance, rollFlux, rollInvertedFlux, sigmaAt } from "./flux";
import { refluxTrait } from "./generator";
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
 * 5 操作: 砕く / 注ぎ（来歴を育てる）/ 移し / 呼び戻し / 煽り（反転を狙う）。どれも何かを得て何かを失う。
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

export const ECHO_OPS = ["shatter", "pour", "transfer", "recall", "stir"] as const;
export type EchoOp = (typeof ECHO_OPS)[number];

export const ECHO_OP_LABEL: Readonly<Record<EchoOp, string>> = {
  shatter: "砕く",
  pour: "注ぎ",
  transfer: "移し",
  recall: "呼び戻し",
  stir: "煽り",
};

/** 操作の説明（UI のツールチップ用。動詞で語る） */
export const ECHO_OP_HINT: Readonly<Record<EchoOp, string>> = {
  shatter: "遺物を砕き、性質の色の残響を得る",
  pour: "遺物を捧げ、来歴の半分を同じ部位の別の遺物へ注ぐ",
  transfer: "銘か芽吹いた性質 1 つを、同じ部位の別の遺物へ移す。元の遺物は失われる",
  recall: "過去の芽で選ばなかった方に取り直す",
  stir: "性質 1 つの揺らぎを引き直す。反転することもある",
};

/** 煽り: 冥響 */
export const STIR_COST = 2;
/** 移し: 冥響 */
export const TRANSFER_COST = 3;
/** 呼び戻し: 冥響（注ぎは無料） */
export const RECALL_COST = 5;
/** 注ぎで移す来歴の割合（端数は切り捨て） */
export const POUR_SHARE = 0.5;
/** 煽りの σ 倍率と、反転の最低確率（浅い遺物でも反転し得る） */
export const STIR_SIGMA_SCALE = 1.2;
export const STIR_MIN_INVERSION_CHANCE = 0.1;
/** 砕く: 性質 1 つにつきその色の残響 */
export const SHATTER_PER_TRAIT = 1;
/** 砕く: 性質の無い遺物はベースの傾きの色（無ければ紅）を 1 */
export const SHATTER_EMPTY_YIELD = 1;
const SHATTER_FALLBACK_COLOR: TraitColor = "crimson";

const UMBRA: TraitColor = "umbra";

export interface EchoCost {
  color: TraitColor;
  amount: number;
}

/** 移す対象。銘か、芽吹いた性質（source.affixes の index） */
export type TransferWhat = { kind: "inscription" } | { kind: "bud"; traitIndex: number };

export type EchoRequest =
  | { op: "shatter"; item: Item }
  | { op: "pour"; item: Item; target: Item }
  | { op: "transfer"; item: Item; target: Item; what: TransferWhat }
  | { op: "recall"; item: Item; budIndex: number }
  | { op: "stir"; item: Item; traitIndex: number };

/** 操作ごとの専用 RNG。同じ item.id / counter なら同じ結果 */
export function craftRng(itemId: string, counter: number): Rng {
  return createRng(hashSeed(`${itemId}#${counter}`));
}

function traitAt(item: Item, index: number): AffixRoll | undefined {
  return item.affixes[index];
}

/** 操作のコスト。砕く・注ぎは null（無料） */
export function echoCost(req: EchoRequest): EchoCost | null {
  switch (req.op) {
    case "shatter":
    case "pour":
      return null;
    case "recall":
      return { color: UMBRA, amount: RECALL_COST };
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
// 呼び戻し・注ぎ
// ---------------------------------------------------------------------------

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
  pour: "注げません（来歴のある遺物から、同じ部位の別の遺物へ）",
  transfer: "移せません（同じ部位の別の遺物へ。銘は無銘の遺物へ、芽は余白のある遺物へ）",
  recall: "呼び戻せません（1 つの遺物に 1 回だけ。選んだ芽が残っていて、選ばなかった方が重ならない場合のみ）",
  stir: "煽れる性質がありません（誓約は対象外）",
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
    case "stir":
      return stirTrait(req.item, req.traitIndex, rng);
    case "transfer":
      return transferGrowth(req.item, req.target, req.what);
    case "recall":
      return recallBud(req.item, req.budIndex);
    case "pour":
      return pourGrowth(req.item, req.target);
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
    case "stir": {
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
