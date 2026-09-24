/**
 * 保存先の唯一の入口。ブラウザ版は localStorage、Electron 版は bootstrap.ts が FileStorage を差し込む。
 * 各ストア（loot/profile.ts など）は storage 引数を省略したときだけここを通る（テストは MemoryStorage を明示的に渡す）。
 *
 * リプレイ再生中の書き込み抑止もここで持つ。Storage.prototype へのモンキーパッチは
 * FileStorage（Storage.prototype を継承しない）に効かないため、返す Storage 自体を包んで判定する。
 */

let injected: Storage | null = null;
/** キー → ガードの重なり数。入れ子のガードを片方だけ解除しても残りが効くように数える */
const blocked = new Map<string, number>();

/** Storage を包み、ガード中のキーへの setItem / removeItem を捨てる薄いラッパ */
class GuardedStorage implements Storage {
  constructor(private readonly inner: Storage) {}

  get length(): number {
    return this.inner.length;
  }

  clear(): void {
    this.inner.clear();
  }

  getItem(key: string): string | null {
    return this.inner.getItem(key);
  }

  key(index: number): string | null {
    return this.inner.key(index);
  }

  removeItem(key: string): void {
    if (blocked.has(key)) return;
    this.inner.removeItem(key);
  }

  setItem(key: string, value: string): void {
    if (blocked.has(key)) return;
    this.inner.setItem(key, value);
  }
}

/** Cookie ブロックや sandbox iframe では localStorage の getter 自体が SecurityError を投げるので握りつぶす */
export function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 保存先を差し込む。null で差し込みを外し localStorage へ戻す */
export function setSaveStorage(storage: Storage | null): void {
  injected = storage;
}

/** 差し込み済みならそれ、無ければ localStorage（触れなければ null）。ガード付きで返す */
export function saveStorage(): Storage | null {
  const target = injected ?? localStorageOrNull();
  return target ? new GuardedStorage(target) : null;
}

/** 指定キーへの書き込みを捨てる。戻り値で解除（2 回呼んでも 1 回分だけ戻す） */
export function guardSaveWrites(keys: readonly string[]): () => void {
  const unique = [...new Set(keys)];
  for (const key of unique) blocked.set(key, (blocked.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of unique) releaseKey(key);
  };
}

function releaseKey(key: string): void {
  const count = blocked.get(key) ?? 0;
  if (count <= 1) {
    blocked.delete(key);
    return;
  }
  blocked.set(key, count - 1);
}
