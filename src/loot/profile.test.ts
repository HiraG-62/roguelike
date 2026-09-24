import { describe, expect, it } from "vitest";
import { STASH_CAPACITY } from "../data/tuning";
import {
  HISTORY_LIMIT,
  PROFILE_KEY,
  addToStash,
  equipItem,
  loadProfile,
  pushRunHistory,
  recordRun,
  returnLoaned,
  salvageItem,
  saveProfile,
  unequipItem,
} from "./profile";
import { migrateItem } from "./migrate";
import { createEmptyProfile } from "./types";
import type { Item, RunHistoryEntry } from "./types";

/** テスト用の Storage モック（Map ベース） */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "shortsword",
    slot: "weapon",
    rarity: "normal",
    itemLevel: 1,
    name: "Shortsword",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    ...overrides,
  };
}

describe("addToStash", () => {
  it("STASH_CAPACITY に達すると追加できず false を返す", () => {
    const profile = createEmptyProfile();
    for (let i = 0; i < STASH_CAPACITY; i++) {
      expect(addToStash(profile, makeItem({ id: `item-${i}` }))).toBe(true);
    }
    expect(profile.stash).toHaveLength(STASH_CAPACITY);
    expect(addToStash(profile, makeItem({ id: "overflow" }))).toBe(false);
    expect(profile.stash).toHaveLength(STASH_CAPACITY);
  });
});

describe("loadProfile / saveProfile", () => {
  it("何も無ければ空プロフィールを返す", () => {
    const storage = new MemoryStorage();
    expect(loadProfile(storage)).toEqual(createEmptyProfile());
  });

  it("保存 → 読み込みで内容が一致する（round-trip）", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    addToStash(profile, migrateItem(makeItem()));
    saveProfile(profile, storage);
    expect(loadProfile(storage)).toEqual(profile);
  });

  it("壊れた JSON は空プロフィールとして扱う", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, "{not json");
    expect(loadProfile(storage)).toEqual(createEmptyProfile());
  });

  it("version が不一致なら空プロフィールとして扱う", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify({ ...createEmptyProfile(), version: 999 }));
    expect(loadProfile(storage)).toEqual(createEmptyProfile());
  });

  it("不正なアイテムは除外して読み込む", () => {
    const storage = new MemoryStorage();
    const raw = {
      version: 1,
      equipment: {
        weapon: { id: "bad", slot: "not-a-slot" },
        gun: null,
        armor: null,
        boots: null,
        ring: null,
        amulet: null,
      },
      stash: [makeItem({ id: "good" }), { id: "bad2" }, "not-an-object"],
      meta: { runs: 1, bestDepth: 2, totalKills: 3, bestScore: 4 },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const loaded = loadProfile(storage);
    expect(loaded.equipment.weapon).toBeNull();
    expect(loaded.stash).toEqual([migrateItem(makeItem({ id: "good" }))]);
    expect(loaded.meta).toEqual({ runs: 1, bestDepth: 2, totalKills: 3, bestScore: 4, history: [] });
  });

  it("setItem が例外を投げても握りつぶす", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };
    expect(() => saveProfile(createEmptyProfile(), storage)).not.toThrow();
  });

  it("localStorage が無い環境（テスト実行時）では引数省略でも例外を投げない", () => {
    expect(() => saveProfile(createEmptyProfile())).not.toThrow();
    expect(() => loadProfile()).not.toThrow();
  });
});

describe("equipItem / unequipItem", () => {
  it("stash から装備し、同スロットの既存装備は stash に戻る（入れ替え）", () => {
    const profile = createEmptyProfile();
    const oldWeapon = makeItem({ id: "old", name: "Old Sword" });
    profile.equipment.weapon = oldWeapon;
    const newWeapon = makeItem({ id: "new", name: "New Sword" });
    addToStash(profile, newWeapon);

    const removed = equipItem(profile, "new");

    expect(removed).toEqual(oldWeapon);
    expect(profile.equipment.weapon).toEqual(newWeapon);
    expect(profile.stash).toEqual([oldWeapon]);
  });

  it("装備先が空なら入れ替えなしで装備する", () => {
    const profile = createEmptyProfile();
    const weapon = makeItem({ id: "new" });
    addToStash(profile, weapon);

    const removed = equipItem(profile, "new");

    expect(removed).toBeNull();
    expect(profile.equipment.weapon).toEqual(weapon);
    expect(profile.stash).toEqual([]);
  });

  it("存在しない itemId では何もしない", () => {
    const profile = createEmptyProfile();
    expect(equipItem(profile, "nope")).toBeNull();
  });

  it("unequipItem は装備を外して stash に戻す", () => {
    const profile = createEmptyProfile();
    const weapon = makeItem({ id: "w" });
    profile.equipment.weapon = weapon;

    unequipItem(profile, "weapon");

    expect(profile.equipment.weapon).toBeNull();
    expect(profile.stash).toEqual([weapon]);
  });
});

describe("salvageItem", () => {
  it("stash からアイテムを削除する", () => {
    const profile = createEmptyProfile();
    addToStash(profile, makeItem({ id: "a" }));
    addToStash(profile, makeItem({ id: "b" }));

    expect(salvageItem(profile, "a")).toBe(true);
    expect(profile.stash.map((it) => it.id)).toEqual(["b"]);
  });

  it("存在しない itemId は false", () => {
    const profile = createEmptyProfile();
    expect(salvageItem(profile, "nope")).toBe(false);
  });
});

describe("recordRun", () => {
  it("meta を集計する", () => {
    const profile = createEmptyProfile();
    recordRun(profile, { depth: 3, kills: 5, score: 100 });
    recordRun(profile, { depth: 1, kills: 2, score: 200 });
    expect(profile.meta).toEqual({ runs: 2, bestDepth: 3, totalKills: 7, bestScore: 200, history: [] });
  });
});

describe("pushRunHistory", () => {
  function historyEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
    return {
      date: 1,
      seedText: "abc",
      depth: 1,
      kills: 0,
      score: 0,
      bestCombo: 0,
      durationSec: 0,
      ...overrides,
    };
  }

  it("先頭に追加され、新しいものが先頭に来る", () => {
    const profile = createEmptyProfile();
    pushRunHistory(profile, historyEntry({ date: 1 }));
    pushRunHistory(profile, historyEntry({ date: 2 }));
    expect(profile.meta.history?.map((h) => h.date)).toEqual([2, 1]);
  });

  it("最新 HISTORY_LIMIT 件だけ残す", () => {
    const profile = createEmptyProfile();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      pushRunHistory(profile, historyEntry({ date: i }));
    }
    expect(profile.meta.history).toHaveLength(HISTORY_LIMIT);
    expect(profile.meta.history?.[0]?.date).toBe(HISTORY_LIMIT + 4);
  });
});

describe("history の保存・読み込み", () => {
  it("round trip する", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    pushRunHistory(profile, historyEntryForRoundTrip());
    saveProfile(profile, storage);
    const loaded = loadProfile(storage);
    expect(loaded.meta.history).toEqual(profile.meta.history);
  });

  it("history が壊れている/欠けていても loadProfile は落ちない", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        version: 1,
        equipment: {},
        stash: [],
        meta: { runs: 1, bestDepth: 1, totalKills: 0, bestScore: 0, history: [{ broken: true }, "nope"] },
      }),
    );
    const loaded = loadProfile(storage);
    expect(loaded.meta.history).toEqual([]);

    storage.setItem(
      PROFILE_KEY,
      JSON.stringify({ version: 1, equipment: {}, stash: [], meta: { runs: 1, bestDepth: 1, totalKills: 0, bestScore: 0 } }),
    );
    expect(loadProfile(storage).meta.history).toEqual([]);
  });
});

function historyEntryForRoundTrip(): RunHistoryEntry {
  return {
    date: 12345,
    seedText: "seed",
    depth: 4,
    kills: 20,
    score: 999,
    bestCombo: 12,
    durationSec: 88.5,
    cause: "defeated",
  };
}

describe("localStorage getter が例外を投げる環境", () => {
  it("loadProfile / saveProfile が落ちない", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(loadProfile()).toEqual(createEmptyProfile());
      expect(() => saveProfile(createEmptyProfile())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("借り物（武器掛け）", () => {
  function loanedItem(id: string): Item {
    return { ...migrateItem(makeItem({ id, slot: "weapon", baseKey: "whip" })), loaned: true };
  }

  it("loaned の品は saveProfile で書かれない（装備からも倉庫からも除く）", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    profile.equipment.weapon = loanedItem("loan-a");
    addToStash(profile, loanedItem("loan-b"));
    addToStash(profile, migrateItem(makeItem({ id: "own" })));
    saveProfile(profile, storage);
    const loaded = loadProfile(storage);
    expect(loaded.equipment.weapon, "装備の借り物は書かない").toBeNull();
    expect(loaded.stash.map((it) => it.id), "倉庫の借り物も書かない").toEqual(["own"]);
    expect(profile.equipment.weapon?.id, "手元の profile は書き換えない").toBe("loan-a");
  });

  it("returnLoaned は借り物を外し、借り物が無ければ何もしない", () => {
    const profile = createEmptyProfile();
    profile.equipment.weapon = loanedItem("loan");
    addToStash(profile, migrateItem(makeItem({ id: "own" })));
    expect(returnLoaned(profile), "外した").toBe(true);
    expect(profile.equipment.weapon, "装備から消える").toBeNull();
    expect(profile.stash.map((it) => it.id), "自分の品は残る").toEqual(["own"]);
    expect(returnLoaned(profile), "2 回目は何もしない").toBe(false);
  });
});
