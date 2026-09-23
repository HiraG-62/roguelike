import { STASH_CAPACITY } from "../data/tuning";
import { migrateItem } from "./migrate";
import {
  type AffixRoll,
  type BudChoice,
  type BudOffer,
  type Equipment,
  type Item,
  type Profile,
  type ProfileMeta,
  type Provenance,
  type RunHistoryEntry,
  type Slot,
  SLOTS,
  TRAIT_COLORS,
  type TraitColor,
  type TraitOrigin,
  createEmptyEquipment,
  createEmptyProfile,
  createEmptyProvenance,
} from "./types";

/** localStorage のキー。バージョンが変わったら数値を上げる */
export const PROFILE_KEY = "roguelike.profile.v1";

/**
 * プロフィールの version は 1 のまま据え置く（キーも同じ）。
 * アイテム単位で旧形式（prefix / suffix / tier）を検出し、読み込み時に migrateItem で新形式へ変換する
 */
const CURRENT_VERSION = 1;
const TRAIT_ORIGINS: readonly TraitOrigin[] = ["found", "bud", "named"];
const BUD_OPTION_COUNT = 2;
/** ラン履歴の保持件数（最新が先頭） */
export const HISTORY_LIMIT = 20;

/** 記録された run の結果。recordRun の入力 */
export interface RunResult {
  depth: number;
  kills: number;
  score: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isSlot(v: unknown): v is Slot {
  return typeof v === "string" && (SLOTS as readonly string[]).includes(v);
}

function isColor(v: unknown): v is TraitColor {
  return typeof v === "string" && (TRAIT_COLORS as readonly string[]).includes(v);
}

function isOrigin(v: unknown): v is TraitOrigin {
  return typeof v === "string" && (TRAIT_ORIGINS as readonly string[]).includes(v);
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function nonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** AffixRoll として成立しているかを検証し、既知のフィールドだけのコピーを返す。壊れていたら null */
function sanitizeRoll(v: unknown): AffixRoll | null {
  if (!isRecord(v)) return null;
  if (typeof v.key !== "string") return null;
  if (typeof v.value !== "number") return null;
  if (v.value2 !== undefined && typeof v.value2 !== "number") return null;
  const roll: AffixRoll = { key: v.key, value: v.value };
  if (typeof v.value2 === "number") roll.value2 = v.value2;
  // 旧形式の kind / tier は migrateItem が tier → 揺らぎの換算に使う
  if (v.kind === "prefix" || v.kind === "suffix") roll.kind = v.kind;
  const tier = optionalNumber(v.tier);
  if (tier !== undefined) roll.tier = tier;
  if (isColor(v.color)) roll.color = v.color;
  const nominal = optionalNumber(v.nominal);
  if (nominal !== undefined) roll.nominal = nominal;
  const nominal2 = optionalNumber(v.nominal2);
  if (nominal2 !== undefined) roll.nominal2 = nominal2;
  const flux = optionalNumber(v.flux);
  if (flux !== undefined) roll.flux = flux;
  if (v.inverted === true) roll.inverted = true;
  if (isOrigin(v.origin)) roll.origin = v.origin;
  return roll;
}

function sanitizeProvenance(v: unknown): Provenance | undefined {
  if (!isRecord(v)) return undefined;
  const p = createEmptyProvenance();
  p.kills = nonNegativeInt(v.kills);
  p.justDodges = nonNegativeInt(v.justDodges);
  p.hurtTaken = nonNegativeInt(v.hurtTaken);
  p.bosses = nonNegativeInt(v.bosses);
  p.roomsCleared = nonNegativeInt(v.roomsCleared);
  p.floorsCleared = nonNegativeInt(v.floorsCleared);
  p.deepest = nonNegativeInt(v.deepest);
  if (isRecord(v.killsByEnemy)) {
    for (const [key, n] of Object.entries(v.killsByEnemy)) p.killsByEnemy[key] = nonNegativeInt(n);
  }
  return p;
}

function sanitizeOptions(v: unknown): [AffixRoll, AffixRoll] | null {
  if (!Array.isArray(v) || v.length !== BUD_OPTION_COUNT) return null;
  const a = sanitizeRoll(v[0]);
  const b = sanitizeRoll(v[1]);
  return a === null || b === null ? null : [a, b];
}

function sanitizeBudOffer(v: unknown): BudOffer | null {
  if (!isRecord(v) || typeof v.milestone !== "string") return null;
  const options = sanitizeOptions(v.options);
  return options === null ? null : { milestone: v.milestone, options };
}

function sanitizeBuds(v: unknown): BudChoice[] {
  if (!Array.isArray(v)) return [];
  const out: BudChoice[] = [];
  for (const raw of v) {
    const offer = sanitizeBudOffer(raw);
    if (offer === null || !isRecord(raw)) continue;
    out.push({ ...offer, chosen: raw.chosen === 1 ? 1 : 0 });
  }
  return out;
}

function sanitizeStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 新形式の成長フィールド（来歴・余白・芽・銘）。provenance が無ければ旧形式なので何もしない */
function copyGrowthFields(item: Item, v: Record<string, unknown>): void {
  const provenance = sanitizeProvenance(v.provenance);
  if (provenance === undefined) return;
  item.provenance = provenance;
  item.margin = nonNegativeInt(v.margin);
  item.marginMax = Math.max(item.margin, nonNegativeInt(v.marginMax));
  item.milestones = sanitizeStrings(v.milestones);
  item.buds = sanitizeBuds(v.buds);
  item.budOffer = sanitizeBudOffer(v.budOffer);
  if (typeof v.inscription === "string" && v.inscription.length > 0) item.inscription = v.inscription;
  if (typeof v.namedKey === "string") item.namedKey = v.namedKey;
}

/** Item として最低限成立しているかを検証し、新形式へ移行して返す。壊れていたら null */
function sanitizeItem(v: unknown): Item | null {
  if (!isRecord(v)) return null;
  const { id, seed, baseKey, slot, rarity, itemLevel, name, implicit, affixes, foundDepth, foundAt } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof seed !== "number") return null;
  if (typeof baseKey !== "string" || baseKey.length === 0) return null;
  if (!isSlot(slot)) return null;
  if (rarity !== "normal" && rarity !== "magic" && rarity !== "rare" && rarity !== "unique") return null;
  if (typeof itemLevel !== "number") return null;
  if (typeof name !== "string") return null;
  const implicitRoll = implicit === null ? null : sanitizeRoll(implicit);
  if (implicit !== null && implicitRoll === null) return null;
  if (!Array.isArray(affixes)) return null;
  const rolls = affixes.map(sanitizeRoll);
  if (rolls.some((r) => r === null)) return null;
  if (typeof foundDepth !== "number") return null;
  if (typeof foundAt !== "number") return null;
  const item: Item = {
    id,
    seed,
    baseKey,
    slot,
    rarity,
    itemLevel,
    name,
    implicit: implicitRoll,
    affixes: rolls.filter((r): r is AffixRoll => r !== null),
    foundDepth,
    foundAt,
  };
  copyGrowthFields(item, v);
  return migrateItem(item);
}

function sanitizeEquipment(v: unknown): Equipment {
  const out = createEmptyEquipment();
  if (!isRecord(v)) return out;
  for (const slot of SLOTS) {
    const item = sanitizeItem(v[slot]);
    if (item && item.slot === slot) out[slot] = item;
  }
  return out;
}

function sanitizeStash(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const out: Item[] = [];
  for (const raw of v) {
    const item = sanitizeItem(raw);
    if (item) out.push(item);
  }
  return out;
}

/** RunHistoryEntry として最低限成立しているかを検証する。壊れていたら null */
function sanitizeHistoryEntry(v: unknown): RunHistoryEntry | null {
  if (!isRecord(v)) return null;
  const { date, seedText, depth, kills, score, bestCombo, durationSec, cause } = v;
  if (typeof date !== "number") return null;
  if (typeof seedText !== "string") return null;
  if (typeof depth !== "number") return null;
  if (typeof kills !== "number") return null;
  if (typeof score !== "number") return null;
  if (typeof bestCombo !== "number") return null;
  if (typeof durationSec !== "number") return null;
  if (cause !== undefined && typeof cause !== "string") return null;
  const entry: RunHistoryEntry = { date, seedText, depth, kills, score, bestCombo, durationSec };
  if (typeof cause === "string") entry.cause = cause;
  return entry;
}

function sanitizeHistory(v: unknown): RunHistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: RunHistoryEntry[] = [];
  for (const raw of v) {
    const entry = sanitizeHistoryEntry(raw);
    if (entry) out.push(entry);
  }
  return out.slice(0, HISTORY_LIMIT);
}

function sanitizeMeta(v: unknown): ProfileMeta {
  if (!isRecord(v)) return { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] };
  const runs = typeof v.runs === "number" ? v.runs : 0;
  const bestDepth = typeof v.bestDepth === "number" ? v.bestDepth : 0;
  const totalKills = typeof v.totalKills === "number" ? v.totalKills : 0;
  const bestScore = typeof v.bestScore === "number" ? v.bestScore : 0;
  const history = sanitizeHistory(v.history);
  return { runs, bestDepth, totalKills, bestScore, history };
}

/**
 * localStorage が存在しない環境（テスト等）でも安全に取得するためのヘルパー。
 * Cookie ブロックや sandbox iframe では localStorage の getter 自体が SecurityError を投げるので握りつぶす
 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 保存されたプロフィールを読み込む。無い/壊れている/version 不一致なら空プロフィール */
export function loadProfile(storage?: Storage): Profile {
  const target = storage ?? defaultStorage();
  if (!target) return createEmptyProfile();

  let raw: string | null;
  try {
    raw = target.getItem(PROFILE_KEY);
  } catch {
    return createEmptyProfile();
  }
  if (!raw) return createEmptyProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyProfile();
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return createEmptyProfile();

  return {
    version: CURRENT_VERSION,
    equipment: sanitizeEquipment(parsed.equipment),
    stash: sanitizeStash(parsed.stash),
    meta: sanitizeMeta(parsed.meta),
  };
}

/** プロフィールを保存する。容量超過などの失敗は握りつぶす。localStorage が無い環境では何もしない */
export function saveProfile(profile: Profile, storage?: Storage): void {
  const target = storage ?? defaultStorage();
  if (!target) return;
  try {
    target.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn("saveProfile failed", err);
  }
}

/** stash にアイテムを追加する。STASH_CAPACITY を超える場合は追加せず false を返す */
export function addToStash(profile: Profile, item: Item): boolean {
  if (profile.stash.length >= STASH_CAPACITY) return false;
  profile.stash.push(item);
  return true;
}

/**
 * stash のアイテムを装備する。同スロットに装備済みがあれば入れ替えて stash へ戻す。
 * 戻り値は外した装備（無ければ null）。itemId が stash に無ければ何もせず null
 */
export function equipItem(profile: Profile, itemId: string): Item | null {
  const idx = profile.stash.findIndex((it) => it.id === itemId);
  if (idx < 0) return null;
  const item = profile.stash[idx];
  if (!item) return null;
  profile.stash.splice(idx, 1);

  const previous = profile.equipment[item.slot];
  profile.equipment[item.slot] = item;
  if (previous) profile.stash.push(previous);
  return previous;
}

/** 装備スロットを外して stash に戻す */
export function unequipItem(profile: Profile, slot: Slot): void {
  const item = profile.equipment[slot];
  if (!item) return;
  profile.equipment[slot] = null;
  profile.stash.push(item);
}

/** stash のアイテムを分解（削除）する。成功したら true */
export function salvageItem(profile: Profile, itemId: string): boolean {
  const idx = profile.stash.findIndex((it) => it.id === itemId);
  if (idx < 0) return false;
  profile.stash.splice(idx, 1);
  return true;
}

/** ラン終了時のメタ集計を更新する */
export function recordRun(profile: Profile, result: RunResult): void {
  const meta = profile.meta;
  meta.runs += 1;
  meta.bestDepth = Math.max(meta.bestDepth, result.depth);
  meta.totalKills += result.kills;
  meta.bestScore = Math.max(meta.bestScore, result.score);
}

/** ラン履歴の先頭に 1 件追加し、最新 HISTORY_LIMIT 件だけ残す */
export function pushRunHistory(profile: Profile, entry: RunHistoryEntry): void {
  const history = profile.meta.history ?? [];
  history.unshift(entry);
  profile.meta.history = history.slice(0, HISTORY_LIMIT);
}
