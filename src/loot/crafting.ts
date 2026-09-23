import { createRng, hashSeed, type Rng } from "../core/rng";
import {
  KEYSTONES,
  affixDef,
  affixesFor,
  conversionsFor,
  corruptedMarkerRoll,
  formatAffix,
  isConversionKey,
  isKeystoneKey,
  isMarkerKey,
  keystoneToRoll,
} from "./affixes";
import { baseDef, type BaseItemDef } from "./bases";
import {
  affixKindLimit,
  rollAffix,
  rollAffixAtTier,
  rollAffixes,
  rollKeystone,
} from "./generator";
import { nameItem } from "./names";
import { generateTriggerRoll } from "./triggers";
import { RARITIES, type AffixKind, type AffixRoll, type Item, type Profile, type Rarity } from "./types";

/**
 * クラフト（純ロジック）。docs/ideas/build-diversity.md「6. クラフト」。
 * 原則: クラフトは「ゴールへの近道」ではなく「分岐の選択」。どの操作も何かを得て何かを失う。
 * - Reforge: tier の上限は itemLevel で縛られる（深く潜らないと上位 tier は出ない）
 * - Corrupt: 必ずリスク（結果を選べず、以降クラフト不可）
 * - Fuse: 枠が縮む（元の合計より 1 枠少ない）
 * 乱数はゲームの state.rng ではなく専用 RNG（item.id + クラフト回数）。ゲームの決定性に影響しない。
 */

// ---------------------------------------------------------------------------
// 通貨
// ---------------------------------------------------------------------------

export const CURRENCIES = ["dust", "shard", "essence", "relic"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Wallet = Record<Currency, number>;

export function createWallet(): Wallet {
  return { dust: 0, shard: 0, essence: 0, relic: 0 };
}

/** 分解で得る通貨（rarity ごと） */
export const SALVAGE_CURRENCY: Readonly<Record<Rarity, Currency>> = {
  normal: "dust",
  magic: "shard",
  rare: "essence",
  unique: "relic",
};
export const SALVAGE_AMOUNT = 1;

/** 分解した item の通貨を wallet に加える。加えた通貨を返す */
export function addSalvageCurrency(wallet: Wallet, item: Item): Currency {
  const currency = SALVAGE_CURRENCY[item.rarity];
  wallet[currency] += SALVAGE_AMOUNT;
  return currency;
}

// ---------------------------------------------------------------------------
// 操作とコスト
// ---------------------------------------------------------------------------

export const CRAFT_OPS = ["reforge", "augment", "annul", "corrupt", "fuse"] as const;
export type CraftOp = (typeof CRAFT_OPS)[number];

export interface CraftCost {
  currency: Currency;
  amount: number;
}

export const CRAFT_COSTS: Readonly<Record<CraftOp, CraftCost>> = {
  reforge: { currency: "shard", amount: 3 },
  augment: { currency: "essence", amount: 2 },
  annul: { currency: "dust", amount: 5 },
  corrupt: { currency: "relic", amount: 1 },
  fuse: { currency: "essence", amount: 1 },
};

/** Augment で追加する枠がトリガー文法から生成される確率 */
export const AUGMENT_TRIGGER_CHANCE = 0.25;

/** Fuse は元の合計枠よりこれだけ少ない枠になる */
export const FUSE_SLOT_PENALTY = 1;

export type CorruptOutcome = "keystone" | "conversion" | "exalt" | "nothing";
export const CORRUPT_OUTCOMES: readonly CorruptOutcome[] = ["keystone", "conversion", "exalt", "nothing"];

const CORRUPT_OUTCOME_TEXT: Readonly<Record<CorruptOutcome, string>> = {
  keystone: "キーストーンを書き換え",
  conversion: "変換アフィックスを獲得",
  exalt: "tierが上昇、アフィックスを1つ反転",
  nothing: "何も起きなかった",
};

const UINT32_MAX = 0xffffffff;
const ID_RADIX = 36;
const FUSED_ID_PREFIX = "fx";
const TOP_TIER = 1;

export function isCorrupted(item: Item): boolean {
  return item.affixes.some((r) => isMarkerKey(r.key));
}

export function canAfford(wallet: Wallet, op: CraftOp): boolean {
  const cost = CRAFT_COSTS[op];
  return wallet[cost.currency] >= cost.amount;
}

/** 操作ごとの専用 RNG。同じ item.id / counter なら同じ結果 */
export function craftRng(itemId: string, counter: number): Rng {
  return createRng(hashSeed(`${itemId}#${counter}`));
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 枠を占めるアフィックス（キーストーンとマーカーは別枠） */
function slotRolls(affixes: readonly AffixRoll[]): AffixRoll[] {
  return affixes.filter((r) => !isKeystoneKey(r.key) && !isMarkerKey(r.key));
}

function countKind(affixes: readonly AffixRoll[], kind: AffixKind): number {
  return slotRolls(affixes).filter((r) => r.kind === kind).length;
}

function withoutMarkers(affixes: readonly AffixRoll[]): AffixRoll[] {
  return affixes.filter((r) => !isMarkerKey(r.key));
}

/** prefix → その他（suffix・キーストーン）→ マーカーの順に並べ直す */
function sortAffixes(affixes: readonly AffixRoll[]): AffixRoll[] {
  const body = withoutMarkers(affixes);
  const markers = affixes.filter((r) => isMarkerKey(r.key));
  return [...body.filter((r) => r.kind === "prefix"), ...body.filter((r) => r.kind !== "prefix"), ...markers];
}

/** magic 名はアフィックスから決まるので付け替える。それ以外は名前を保つ */
function renamed(item: Item, affixes: readonly AffixRoll[], rng: Rng): string {
  if (item.rarity !== "magic") return item.name;
  const base = baseDef(item.baseKey);
  return base === undefined ? item.name : nameItem(rng, base, item.rarity, affixes);
}

function withAffixes(item: Item, affixes: readonly AffixRoll[], rng: Rng): Item {
  const sorted = sortAffixes(affixes);
  return { ...item, affixes: sorted, name: renamed(item, sorted, rng) };
}

/** Fisher-Yates（rng 決定的） */
function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = out[i];
    const other = out[j];
    if (tmp === undefined || other === undefined) continue;
    out[i] = other;
    out[j] = tmp;
  }
  return out;
}

function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

/** 操作の結果。null は「この対象には適用できない」 */
export interface OpResult {
  item: Item;
  /** 結果メッセージに添える補足 */
  note?: string;
}

// ---------------------------------------------------------------------------
// Reforge: 全アフィックスをロールし直す（rarity 維持）
// ---------------------------------------------------------------------------

/** unique は固定セットなので、各アフィックスの値を同じ tier の範囲でロールし直す（キーストーン・トリガーは保持） */
function rerollUniqueValues(rng: Rng, affixes: readonly AffixRoll[]): AffixRoll[] {
  return affixes.map((roll) => {
    const def = affixDef(roll.key);
    if (def === undefined || def.tiers[roll.tier - 1] === undefined) return roll;
    return rollAffixAtTier(rng, def, roll.tier - 1);
  });
}

/** itemLevel は元の itemLevel と maxLevel（profile.meta.bestDepth）の高い方 */
export function reforgeItem(item: Item, rng: Rng, maxLevel: number): OpResult | null {
  if (item.rarity === "normal") return null;
  const base = baseDef(item.baseKey);
  if (base === undefined) return null;
  const itemLevel = Math.max(item.itemLevel, Math.floor(maxLevel));
  if (item.rarity === "unique") {
    return { item: { ...item, itemLevel, affixes: rerollUniqueValues(rng, item.affixes) } };
  }
  const rolled = rollAffixes(rng, item.slot, item.rarity, itemLevel);
  const keystone = rollKeystone(rng, item.rarity);
  const affixes = sortAffixes(keystone === undefined ? rolled : [...rolled, keystone]);
  const name = nameItem(rng, base, item.rarity, affixes);
  return { item: { ...item, itemLevel, affixes, name } };
}

// ---------------------------------------------------------------------------
// Augment: 空き枠に 1 つ追加
// ---------------------------------------------------------------------------

function rollAugment(rng: Rng, item: Item, kind: AffixKind, used: ReadonlySet<string>): AffixRoll | undefined {
  if (rng.chance(AUGMENT_TRIGGER_CHANCE)) {
    const trigger = generateTriggerRoll(rng, item.itemLevel, item.slot, kind);
    if (!used.has(trigger.key)) return trigger;
  }
  const candidates = affixesFor(item.slot, kind, item.itemLevel).filter((d) => !used.has(d.key));
  if (candidates.length === 0) return undefined;
  return rollAffix(rng, rng.pick(candidates), item.itemLevel);
}

export function augmentItem(item: Item, rng: Rng): OpResult | null {
  const limit = affixKindLimit(item.rarity);
  const used = new Set(item.affixes.map((r) => r.key));
  const kinds = (["prefix", "suffix"] as const).filter(
    (k) => countKind(item.affixes, k) < limit && affixesFor(item.slot, k, item.itemLevel).some((d) => !used.has(d.key)),
  );
  if (kinds.length === 0) return null;
  const added = rollAugment(rng, item, rng.pick(kinds), used);
  if (added === undefined) return null;
  return { item: withAffixes(item, [...item.affixes, added], rng), note: `+ ${formatAffix(added)}` };
}

// ---------------------------------------------------------------------------
// Annul: ランダムに 1 つ削除
// ---------------------------------------------------------------------------

export function annulItem(item: Item, rng: Rng): OpResult | null {
  const removable = withoutMarkers(item.affixes);
  if (removable.length === 0) return null;
  const target = rng.pick(removable);
  const affixes = item.affixes.filter((r) => r !== target);
  return { item: withAffixes(item, affixes, rng), note: `- ${formatAffix(target)}` };
}

// ---------------------------------------------------------------------------
// Corrupt: 1 回きり。結果は選べない
// ---------------------------------------------------------------------------

function corruptKeystone(item: Item, rng: Rng): AffixRoll[] | null {
  const current = new Set(item.affixes.filter((r) => isKeystoneKey(r.key)).map((r) => r.key));
  const candidates = KEYSTONES.filter((k) => !current.has(k.key));
  if (candidates.length === 0) return null;
  const rest = item.affixes.filter((r) => !isKeystoneKey(r.key));
  return [...rest, keystoneToRoll(rng.pick(candidates))];
}

function corruptConversion(item: Item, rng: Rng): AffixRoll[] | null {
  const used = new Set(item.affixes.map((r) => r.key));
  const candidates = conversionsFor(item.slot, item.itemLevel).filter((d) => !used.has(d.key));
  if (candidates.length === 0) return null;
  return [...item.affixes, rollAffix(rng, rng.pick(candidates), item.itemLevel)];
}

/** 通常アフィックス（変換・トリガー・キーストーン・マーカー以外）か */
function isInvertible(roll: AffixRoll): boolean {
  return affixDef(roll.key) !== undefined && !isConversionKey(roll.key);
}

/** 全テーブルアフィックスの tier を 1 段上げ（itemLevel を超えてよい）、通常アフィックス 1 つの value を負にする */
function corruptExalt(item: Item, rng: Rng): AffixRoll[] | null {
  const raised = item.affixes.map((roll) => {
    const def = affixDef(roll.key);
    if (def === undefined || roll.tier <= TOP_TIER) return roll;
    return rollAffixAtTier(rng, def, roll.tier - 2);
  });
  const invertible = raised.filter(isInvertible);
  if (invertible.length === 0) return null;
  const victim = rng.pick(invertible);
  return raised.map((r) => (r === victim ? { ...r, value: -Math.abs(r.value) } : r));
}

function corruptAffixes(item: Item, rng: Rng, outcome: CorruptOutcome): AffixRoll[] | null {
  switch (outcome) {
    case "keystone":
      return corruptKeystone(item, rng);
    case "conversion":
      return corruptConversion(item, rng);
    case "exalt":
      return corruptExalt(item, rng);
    case "nothing":
      return null;
  }
}

export interface CorruptResult extends OpResult {
  outcome: CorruptOutcome;
}

/** 適用できない結果（キーストーン候補なし等）は「何も起きない」になる。どの結果でも corrupted になる */
export function corruptItem(item: Item, rng: Rng): CorruptResult {
  const rolled = rng.pick(CORRUPT_OUTCOMES);
  const changed = corruptAffixes(item, rng, rolled);
  const outcome: CorruptOutcome = changed === null ? "nothing" : rolled;
  const affixes = [...(changed ?? item.affixes), corruptedMarkerRoll()];
  return { item: withAffixes(item, affixes, rng), outcome, note: CORRUPT_OUTCOME_TEXT[outcome] };
}

// ---------------------------------------------------------------------------
// Fuse: 同スロットの 2 つから、合計より 1 枠少ない新アイテム
// ---------------------------------------------------------------------------

/** 両親の枠数の合計 - FUSE_SLOT_PENALTY（マーカーは数えない） */
export function fuseSlotCount(a: Item, b: Item): number {
  return Math.max(0, withoutMarkers(a.affixes).length + withoutMarkers(b.affixes).length - FUSE_SLOT_PENALTY);
}

function pickFusedAffixes(rng: Rng, pool: readonly AffixRoll[], target: number, rarity: Rarity): AffixRoll[] {
  const limit = affixKindLimit(rarity);
  const picked: AffixRoll[] = [];
  const used = new Set<string>();
  for (const roll of shuffled(rng, pool)) {
    if (picked.length >= target) break;
    if (used.has(roll.key)) continue;
    if (isKeystoneKey(roll.key)) {
      if (picked.some((r) => isKeystoneKey(r.key))) continue;
    } else if (countKind(picked, roll.kind) >= limit) {
      continue;
    }
    picked.push(roll);
    used.add(roll.key);
  }
  return picked;
}

function fusedName(rng: Rng, base: BaseItemDef, rarity: Rarity, affixes: readonly AffixRoll[]): string {
  // unique の固有名は引き継がない（別物になる）。rare と同じ生成名にする
  return nameItem(rng, base, rarity === "unique" ? "rare" : rarity, affixes);
}

export function fuseItems(a: Item, b: Item, rng: Rng, now: number): OpResult | null {
  if (a.id === b.id || a.slot !== b.slot) return null;
  const target = fuseSlotCount(a, b);
  if (target === 0) return null;
  const rarity = rarityRank(a.rarity) >= rarityRank(b.rarity) ? a.rarity : b.rarity;
  const parent = rng.pick([a, b]);
  const base = baseDef(parent.baseKey);
  if (base === undefined) return null;
  const pool = [...withoutMarkers(a.affixes), ...withoutMarkers(b.affixes)];
  const affixes = sortAffixes(pickFusedAffixes(rng, pool, target, rarity));
  const seed = rng.int(0, UINT32_MAX);
  const item: Item = {
    id: `${FUSED_ID_PREFIX}-${seed.toString(ID_RADIX)}-${hashSeed(`${a.id}+${b.id}`).toString(ID_RADIX)}`,
    seed,
    baseKey: base.key,
    slot: a.slot,
    rarity,
    itemLevel: Math.max(a.itemLevel, b.itemLevel),
    name: fusedName(rng, base, rarity, affixes),
    implicit: parent.implicit,
    affixes,
    foundDepth: Math.max(a.foundDepth, b.foundDepth),
    foundAt: Math.max(now, a.foundAt, b.foundAt),
  };
  return { item };
}

// ---------------------------------------------------------------------------
// 実行（通貨の確認・消費・回数の更新）
// ---------------------------------------------------------------------------

export interface CraftState {
  wallet: Wallet;
  /** クラフト回数。専用 RNG の seed に混ぜる */
  counter: number;
}

export interface CraftRequest {
  op: CraftOp;
  item: Item;
  /** Fuse の 2 つ目 */
  partner?: Item;
  /** Reforge の itemLevel 上限の候補（profile.meta.bestDepth） */
  bestDepth: number;
  /** Fuse で作るアイテムの foundAt（epoch ms） */
  now: number;
}

export type CraftRejectReason = "corrupted" | "insufficient" | "invalid";

export type CraftResult =
  | { ok: true; op: CraftOp; before: Item; item: Item; consumedIds: string[]; message: string }
  | { ok: false; op: CraftOp; reason: CraftRejectReason; message: string };

const OP_VERB: Readonly<Record<CraftOp, string>> = {
  reforge: "再鍛造",
  augment: "付与",
  annul: "無効化",
  corrupt: "腐敗",
  fuse: "融合",
};

const INVALID_MESSAGE: Readonly<Record<CraftOp, string>> = {
  reforge: "再鍛造対象がありません（ノーマル装備にはアフィックスがありません）",
  augment: "空いているアフィックス枠がありません",
  annul: "無効化できるアフィックスがありません",
  corrupt: "腐敗させられません",
  fuse: "融合には同じ部位でアフィックスを持つ異なる2つの装備が必要です",
};

const CORRUPTED_MESSAGE = "腐敗した装備はクラフトできません";

/** 通貨の表示名 */
const CURRENCY_LABEL: Readonly<Record<Currency, string>> = {
  dust: "塵",
  shard: "欠片",
  essence: "精髄",
  relic: "遺物",
};

/** 拒否理由の表示文 */
export function craftBlockMessage(reason: CraftRejectReason, op: CraftOp): string {
  const cost = CRAFT_COSTS[op];
  switch (reason) {
    case "corrupted":
      return CORRUPTED_MESSAGE;
    case "insufficient":
      return `${CURRENCY_LABEL[cost.currency]}が${cost.amount}必要です`;
    case "invalid":
      return INVALID_MESSAGE[op];
  }
}

function runOp(req: CraftRequest, rng: Rng): OpResult | null {
  switch (req.op) {
    case "reforge":
      return reforgeItem(req.item, rng, req.bestDepth);
    case "augment":
      return augmentItem(req.item, rng);
    case "annul":
      return annulItem(req.item, rng);
    case "corrupt":
      return corruptItem(req.item, rng);
    case "fuse":
      return req.partner === undefined ? null : fuseItems(req.item, req.partner, rng, req.now);
  }
}

function successMessage(req: CraftRequest, result: OpResult): string {
  const from = req.partner === undefined ? req.item.name : `${req.item.name} + ${req.partner.name}`;
  const head = `${OP_VERB[req.op]}: ${from} → ${result.item.name}`;
  return result.note === undefined ? head : `${head}（${result.note}）`;
}

/**
 * クラフトを 1 回実行する。成功時のみ state の通貨を消費し counter を進める。
 * corrupted のアイテム（Fuse の相手を含む）は拒否。profile は触らない（applyCraftResult を参照）
 */
export function craft(state: CraftState, req: CraftRequest): CraftResult {
  const { op } = req;
  if (isCorrupted(req.item) || (req.partner !== undefined && isCorrupted(req.partner))) {
    return { ok: false, op, reason: "corrupted", message: craftBlockMessage("corrupted", op) };
  }
  if (!canAfford(state.wallet, op)) {
    return { ok: false, op, reason: "insufficient", message: craftBlockMessage("insufficient", op) };
  }
  const result = runOp(req, craftRng(req.item.id, state.counter));
  if (result === null) return { ok: false, op, reason: "invalid", message: craftBlockMessage("invalid", op) };

  const cost = CRAFT_COSTS[op];
  state.wallet[cost.currency] -= cost.amount;
  state.counter += 1;
  const consumedIds = req.partner === undefined ? [] : [req.item.id, req.partner.id];
  return { ok: true, op, before: req.item, item: result.item, consumedIds, message: successMessage(req, result) };
}

/**
 * 成功したクラフトを stash に反映する。単体操作は同じ位置で置き換え、Fuse は 2 つを消して新アイテムを加える。
 * 反映できたら true
 */
export function applyCraftResult(profile: Profile, result: CraftResult): boolean {
  if (!result.ok) return false;
  if (result.consumedIds.length > 0) {
    const consumed = new Set(result.consumedIds);
    profile.stash = profile.stash.filter((it) => !consumed.has(it.id));
    profile.stash.push(result.item);
    return true;
  }
  const index = profile.stash.findIndex((it) => it.id === result.item.id);
  if (index < 0) return false;
  profile.stash[index] = result.item;
  return true;
}

/** UI 用: 実行可能か（通貨・corrupted・対象の有無）。理由付き */
export function craftBlockReason(wallet: Wallet, op: CraftOp, item: Item | null): CraftRejectReason | null {
  if (item === null) return "invalid";
  if (isCorrupted(item)) return "corrupted";
  if (!canAfford(wallet, op)) return "insufficient";
  return null;
}
