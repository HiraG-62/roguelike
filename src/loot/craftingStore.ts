import { CURRENCIES, createWallet, type CraftState, type Wallet } from "./crafting";

/**
 * クラフト通貨とクラフト回数の永続化。profile（roguelike.profile.v1）とは別キーで持つ
 * （profile の形式を変えずに追加できるように）。
 */

export const CRAFT_KEY = "roguelike.craft.v1";
const CURRENT_VERSION = 1;

export interface CraftSave extends CraftState {
  version: typeof CURRENT_VERSION;
}

export function createCraftSave(): CraftSave {
  return { version: CURRENT_VERSION, wallet: createWallet(), counter: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 非負の整数に丸める。壊れた値は 0 */
function sanitizeCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function sanitizeWallet(v: unknown): Wallet {
  const wallet = createWallet();
  if (!isRecord(v)) return wallet;
  for (const currency of CURRENCIES) wallet[currency] = sanitizeCount(v[currency]);
  return wallet;
}

/** localStorage が無い / 触れない環境では null（profile.ts と同じ方針） */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 保存された通貨を読み込む。無い / 壊れている / version 不一致なら空 */
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
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return createCraftSave();
  return { version: CURRENT_VERSION, wallet: sanitizeWallet(parsed.wallet), counter: sanitizeCount(parsed.counter) };
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
