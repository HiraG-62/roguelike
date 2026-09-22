import {
  type AffixKind,
  type AffixRoll,
  type Equipment,
  type Item,
  type Profile,
  type ProfileMeta,
  type Slot,
  SLOTS,
  createEmptyEquipment,
  createEmptyProfile,
} from "./types";

/** localStorage のキー。バージョンが変わったら数値を上げる */
export const PROFILE_KEY = "roguelike.profile.v1";

const CURRENT_VERSION = 1;
const AFFIX_KINDS: readonly AffixKind[] = ["prefix", "suffix"];

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

function isAffixRoll(v: unknown): v is AffixRoll {
  if (!isRecord(v)) return false;
  if (typeof v.key !== "string") return false;
  if (!AFFIX_KINDS.includes(v.kind as AffixKind)) return false;
  if (typeof v.tier !== "number") return false;
  if (typeof v.value !== "number") return false;
  if (v.value2 !== undefined && typeof v.value2 !== "number") return false;
  return true;
}

/** Item として最低限成立しているかを検証する。壊れていたら null */
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
  if (implicit !== null && !isAffixRoll(implicit)) return null;
  if (!Array.isArray(affixes) || !affixes.every(isAffixRoll)) return null;
  if (typeof foundDepth !== "number") return null;
  if (typeof foundAt !== "number") return null;
  return {
    id,
    seed,
    baseKey,
    slot,
    rarity,
    itemLevel,
    name,
    implicit: implicit as AffixRoll | null,
    affixes: affixes as AffixRoll[],
    foundDepth,
    foundAt,
  };
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

function sanitizeMeta(v: unknown): ProfileMeta {
  if (!isRecord(v)) return { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0 };
  const runs = typeof v.runs === "number" ? v.runs : 0;
  const bestDepth = typeof v.bestDepth === "number" ? v.bestDepth : 0;
  const totalKills = typeof v.totalKills === "number" ? v.totalKills : 0;
  const bestScore = typeof v.bestScore === "number" ? v.bestScore : 0;
  return { runs, bestDepth, totalKills, bestScore };
}

/** localStorage が存在しない環境（テスト等）でも安全に取得するためのヘルパー */
function defaultStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
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

/** stash にアイテムを追加する */
export function addToStash(profile: Profile, item: Item): void {
  profile.stash.push(item);
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
