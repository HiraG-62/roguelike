import { describe, expect, it } from "vitest";
import type { SaveBridge } from "./bridge";
import { FLUSH_DELAY_MS, FileStorage, type Scheduler } from "./fileStorage";

/** 呼び出しを記録するだけの bridge */
function fakeBridge(): SaveBridge & { writes: [string, string][]; removes: string[]; syncs: Record<string, string>[] } {
  const writes: [string, string][] = [];
  const removes: string[] = [];
  const syncs: Record<string, string>[] = [];
  return {
    writes,
    removes,
    syncs,
    readAll: () => ({}),
    write: (key, value) => {
      writes.push([key, value]);
      return Promise.resolve();
    },
    remove: (key) => {
      removes.push(key);
      return Promise.resolve();
    },
    writeAllSync: (entries) => {
      syncs.push({ ...entries });
    },
    openSaveFolder: () => Promise.resolve(),
  };
}

/** 予約だけ記録し、実行はテストが決める */
function manualScheduler(): { schedule: Scheduler; delays: number[] } {
  const delays: number[] = [];
  return { delays, schedule: (_fn, ms) => void delays.push(ms) };
}

describe("FileStorage", () => {
  it("初期値を getItem で読める", () => {
    const storage = new FileStorage(fakeBridge(), { "roguelike.profile.v1": "{\"a\":1}" }, manualScheduler().schedule);
    expect(storage.getItem("roguelike.profile.v1")).toBe("{\"a\":1}");
    expect(storage.getItem("roguelike.skills.v1"), "無いキーは null").toBeNull();
    expect(storage.length).toBe(1);
  });

  it("setItem の直後は bridge.write が呼ばれず、flush でキーごとに 1 回だけ呼ばれる", async () => {
    const bridge = fakeBridge();
    const scheduler = manualScheduler();
    const storage = new FileStorage(bridge, {}, scheduler.schedule);
    storage.setItem("roguelike.profile.v1", "p");
    storage.setItem("roguelike.skills.v1", "s");
    expect(bridge.writes, "setItem 直後は書かない").toHaveLength(0);
    expect(scheduler.delays, "遅延書き込みの予約は 1 回だけ").toEqual([FLUSH_DELAY_MS]);
    await storage.flush();
    expect(bridge.writes).toEqual([
      ["roguelike.profile.v1", "p"],
      ["roguelike.skills.v1", "s"],
    ]);
    await storage.flush();
    expect(bridge.writes, "dirty が無ければ書かない").toHaveLength(2);
  });

  it("同じキーへの連続 setItem は 1 回の write に潰れる", async () => {
    const bridge = fakeBridge();
    const storage = new FileStorage(bridge, {}, manualScheduler().schedule);
    storage.setItem("roguelike.profile.v1", "1");
    storage.setItem("roguelike.profile.v1", "2");
    storage.setItem("roguelike.profile.v1", "3");
    await storage.flush();
    expect(bridge.writes, "最後の値だけ").toEqual([["roguelike.profile.v1", "3"]]);
  });

  it("flush 後の setItem は改めて遅延書き込みを予約する", async () => {
    const scheduler = manualScheduler();
    const storage = new FileStorage(fakeBridge(), {}, scheduler.schedule);
    storage.setItem("roguelike.profile.v1", "1");
    await storage.flush();
    storage.setItem("roguelike.profile.v1", "2");
    expect(scheduler.delays, "2 回目の予約").toHaveLength(2);
  });

  it("flushSync は dirty なキーだけを writeAllSync に渡す", () => {
    const bridge = fakeBridge();
    const storage = new FileStorage(bridge, { "roguelike.codex.v1": "c" }, manualScheduler().schedule);
    storage.setItem("roguelike.profile.v1", "p");
    storage.flushSync();
    expect(bridge.syncs, "変更したキーだけ").toEqual([{ "roguelike.profile.v1": "p" }]);
    storage.flushSync();
    expect(bridge.syncs, "dirty が無ければ呼ばない").toHaveLength(1);
  });

  it("removeItem は bridge.remove を呼ぶ", async () => {
    const bridge = fakeBridge();
    const storage = new FileStorage(bridge, { "roguelike.replays.v1": "[]" }, manualScheduler().schedule);
    storage.removeItem("roguelike.replays.v1");
    expect(storage.getItem("roguelike.replays.v1")).toBeNull();
    await storage.flush();
    expect(bridge.removes).toEqual(["roguelike.replays.v1"]);
    expect(bridge.writes).toHaveLength(0);
  });
});
