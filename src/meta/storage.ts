/**
 * メタ進行（図鑑・依頼・実績）の localStorage 読み書きの共通部分。
 * 他の永続化（loot/profile.ts・loot/craftingStore.ts）と同じく、例外は握りつぶし、壊れたデータは null を返して既定へ落とす
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 非負の整数に丸める。壊れた値は 0 */
export function sanitizeCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

/** 文字列の配列から、許す値だけを重複なく取り出す */
export function sanitizeKeyList(v: unknown, allowed: (key: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    if (typeof item === "string" && allowed(item)) out.add(item);
  }
  return [...out];
}

/** key → 回数 の表から、許す key と正の回数だけを取り出す */
export function sanitizeCountMap(v: unknown, allowed: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [key, n] of Object.entries(v)) {
    const count = sanitizeCount(n);
    if (count > 0 && allowed(key)) out[key] = count;
  }
  return out;
}

/** localStorage が無い / 触れない環境では null */
export function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** JSON を読む。無い・壊れている・触れないなら undefined */
export function readJson(key: string, storage?: Storage): unknown {
  const target = storage ?? defaultStorage();
  if (!target) return undefined;
  try {
    const raw = target.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** JSON を書く。容量超過などの失敗は握りつぶす */
export function writeJson(key: string, value: unknown, storage?: Storage): void {
  const target = storage ?? defaultStorage();
  if (!target) return;
  try {
    target.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`save ${key} failed`, err);
  }
}
