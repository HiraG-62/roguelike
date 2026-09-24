import { SAVE_FILES } from "./fileEnvelope";

/**
 * Electron 内の localStorage → セーブファイルの初回移行。
 * ファイル側に既知キーが 1 つも無いときだけ roguelike.* を写す（2 回目以降の起動で二重に走らない）。
 * 写した後も source は消さない（安全側）。写したキーを返す
 */

const KEY_PREFIX = "roguelike.";

export function migrateFromLocalStorage(target: Storage, source: Storage | null): string[] {
  if (!source) return [];
  const known = Object.keys(SAVE_FILES);
  if (known.some((key) => target.getItem(key) !== null)) return [];
  const copied: string[] = [];
  for (const key of sourceKeys(source)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const value = source.getItem(key);
    if (value === null) continue;
    target.setItem(key, value);
    copied.push(key);
  }
  return copied;
}

/** 写している間に index がずれないよう先に列挙する */
function sourceKeys(source: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const key = source.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}
