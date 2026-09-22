import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "../core/input";
import { ReplayRecorder, type ReplayData } from "../core/replay";
import { createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { REPLAY_LIMIT, REPLAY_STORE_KEY, findReplayForEntry, loadReplays, pushReplay } from "./replayStore";

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  /** これを超える長さの値は書き込めない（容量超過の再現） */
  constructor(private readonly maxValueLength = Number.POSITIVE_INFINITY) {}
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (value.length > this.maxValueLength) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
}

function makeReplay(endedAt: number, seedText = `seed${endedAt}`): ReplayData {
  const recorder = new ReplayRecorder({ seedText, startedAt: endedAt - 1, daily: false }, createEmptyProfile(), createDefaultSkillProfile());
  recorder.record({ ...EMPTY_INPUT, move: { x: 1, y: 0 } });
  return recorder.finish({ depth: 1, kills: 0, score: endedAt }, endedAt);
}

describe("replayStore", () => {
  it("最新が先頭で、REPLAY_LIMIT 件までしか残らない", () => {
    const storage = new MemoryStorage();
    for (let i = 1; i <= REPLAY_LIMIT + 3; i++) pushReplay(makeReplay(i), storage);
    const loaded = loadReplays(storage);
    expect(REPLAY_LIMIT).toBe(10);
    expect(loaded).toHaveLength(REPLAY_LIMIT);
    expect(loaded[0]?.endedAt).toBe(REPLAY_LIMIT + 3);
    expect(loaded[REPLAY_LIMIT - 1]?.endedAt).toBe(4);
  });

  it("保存 → 読み込みで内容が変わらない", () => {
    const storage = new MemoryStorage();
    const replay = makeReplay(5);
    pushReplay(replay, storage);
    expect(loadReplays(storage)).toEqual([replay]);
  });

  it("壊れたデータ・壊れた要素は捨てる", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPLAY_STORE_KEY, "{not json");
    expect(loadReplays(storage)).toEqual([]);
    storage.setItem(REPLAY_STORE_KEY, JSON.stringify([makeReplay(1), { version: 1 }, 3]));
    expect(loadReplays(storage)).toHaveLength(1);
  });

  it("容量超過なら古いものから捨てて保存する", () => {
    const one = JSON.stringify([makeReplay(1)]).length;
    const storage = new MemoryStorage(one * 2 + 10);
    for (let i = 1; i <= 5; i++) pushReplay(makeReplay(i), storage);
    const loaded = loadReplays(storage);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThanOrEqual(2);
    expect(loaded[0]?.endedAt).toBe(5);
  });

  it("履歴エントリの date と seedText で対応するリプレイを探す", () => {
    const replays = [makeReplay(10, "a"), makeReplay(20, "b")];
    expect(findReplayForEntry(replays, { date: 20, seedText: "b" })?.endedAt).toBe(20);
    expect(findReplayForEntry(replays, { date: 20, seedText: "a" })).toBeNull();
  });
});
