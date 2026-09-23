import {
  LEGACY_CURRENCIES,
  convertLegacyWallet,
  createEchoWallet,
  type EchoCraftState,
  type EchoWallet,
  type LegacyWallet,
} from "./crafting";
import { TRAIT_COLORS } from "./types";

/**
 * クラフトの残響（通貨）とクラフト回数の永続化。profile（roguelike.profile.v1）とは別キーで持つ。
 * version 1（旧通貨 dust / shard / essence / relic）は読み込み時に残響へ換算する（crafting.ts の convertLegacyWallet）。
 * version 1 の wallet は読み込み時に換算するだけで、保存し直すと消える。
 */

export const CRAFT_KEY = "roguelike.craft.v1";
const CURRENT_VERSION = 2;
const LEGACY_VERSION = 1;

export interface CraftSave extends EchoCraftState {
  version: typeof CURRENT_VERSION;
}

export function createCraftSave(): CraftSave {
  return { version: CURRENT_VERSION, echoes: createEchoWallet(), counter: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 非負の整数に丸める。壊れた値は 0 */
function sanitizeCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

/** 旧 version 1 の通貨。無ければ全部 0 */
function sanitizeLegacyWallet(v: unknown): LegacyWallet {
  const wallet: LegacyWallet = { dust: 0, shard: 0, essence: 0, relic: 0 };
  if (!isRecord(v)) return wallet;
  for (const currency of LEGACY_CURRENCIES) wallet[currency] = sanitizeCount(v[currency]);
  return wallet;
}

function sanitizeEchoes(v: unknown): EchoWallet {
  const echoes = createEchoWallet();
  if (!isRecord(v)) return echoes;
  for (const color of TRAIT_COLORS) echoes[color] = sanitizeCount(v[color]);
  return echoes;
}

function addEchoes(a: EchoWallet, b: Readonly<EchoWallet>): EchoWallet {
  const out = { ...a };
  for (const color of TRAIT_COLORS) out[color] += b[color];
  return out;
}

/** localStorage が無い / 触れない環境では null（profile.ts と同じ方針） */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 保存データ（v1 / v2）を CraftSave にする。旧 wallet は残響へ換算して足す。壊れていれば null */
export function parseCraftSave(parsed: unknown): CraftSave | null {
  if (!isRecord(parsed)) return null;
  if (parsed.version !== CURRENT_VERSION && parsed.version !== LEGACY_VERSION) return null;
  const legacy = sanitizeLegacyWallet(parsed.wallet);
  const echoes = addEchoes(sanitizeEchoes(parsed.echoes), convertLegacyWallet(legacy));
  return { version: CURRENT_VERSION, echoes, counter: sanitizeCount(parsed.counter) };
}

/** 保存された残響を読み込む。無い / 壊れている / 未知の version なら空 */
export function loadCraft(storage?: Storage): CraftSave {
  const target = storage ?? defaultStorage();
  if (!target) return createCraftSave();
  let parsed: unknown;
  try {
    const raw = target.getItem(CRAFT_KEY);
    if (!raw) return createCraftSave();
    parsed = JSON.parse(raw);
  } catch {
    return createCraftSave();
  }
  return parseCraftSave(parsed) ?? createCraftSave();
}

/** 保存する。容量超過などの失敗は握りつぶす */
export function saveCraft(save: CraftSave, storage?: Storage): void {
  const target = storage ?? defaultStorage();
  if (!target) return;
  try {
    target.setItem(CRAFT_KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("saveCraft failed", err);
  }
}
