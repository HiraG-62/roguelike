import type { SaveBridge } from "./bridge";

/**
 * Electron 版の保存先。起動時に全ファイルをメモリへ読み、setItem は dirty を立てて遅延でまとめて書く。
 * step の中から saveProfile などが 1 フレームに何度も呼ばれるので、setItem は同期で安価でなければならない
 */

export const FLUSH_DELAY_MS = 300;
export type Scheduler = (fn: () => void, ms: number) => void;

const defaultScheduler: Scheduler = (fn, ms) => {
  setTimeout(fn, ms);
};

export class FileStorage implements Storage {
  private readonly map: Map<string, string>;
  /** 書き出し待ちのキー。map に無いキーは remove として送る */
  private dirty = new Set<string>();
  private scheduled = false;

  constructor(
    private readonly bridge: SaveBridge,
    initial: Record<string, string>,
    private readonly schedule: Scheduler = defaultScheduler,
  ) {
    this.map = new Map(Object.entries(initial));
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
    this.markDirty(key);
  }

  removeItem(key: string): void {
    if (!this.map.has(key)) return;
    this.map.delete(key);
    this.markDirty(key);
  }

  /** 呼び出し元は無いが Storage 互換のため。全キーを remove として書き出す */
  clear(): void {
    for (const key of [...this.map.keys()]) this.removeItem(key);
  }

  /** dirty なキーを bridge へ。flush 中に来た setItem は次回に持ち越す（開始時に dirty を取り出して空にする） */
  async flush(): Promise<void> {
    this.scheduled = false;
    const keys = [...this.dirty];
    this.dirty = new Set();
    const writes = keys.map((key) => {
      const value = this.map.get(key);
      return value === undefined ? this.bridge.remove(key) : this.bridge.write(key, value);
    });
    const results = await Promise.allSettled(writes);
    results.forEach((result, i) => {
      if (result.status === "fulfilled") return;
      console.warn(`save ${keys[i] ?? "?"} failed`, result.reason);
    });
  }

  /** pagehide / beforeunload から。dirty が残っていれば同期で書き出す。remove は同期経路が無いので dirty に残し非同期の flush に任せる */
  flushSync(): void {
    const entries: Record<string, string> = {};
    let count = 0;
    for (const key of [...this.dirty]) {
      const value = this.map.get(key);
      if (value === undefined) continue;
      entries[key] = value;
      this.dirty.delete(key);
      count += 1;
    }
    if (count === 0) return;
    this.bridge.writeAllSync(entries);
  }

  private markDirty(key: string): void {
    this.dirty.add(key);
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      void this.flush();
    }, FLUSH_DELAY_MS);
  }
}
