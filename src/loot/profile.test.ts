import { describe, expect, it } from "vitest";
import { STASH_CAPACITY } from "../data/tuning";
import {
  HISTORY_LIMIT,
  PROFILE_KEY,
  REMOVED_BASE_KEYS,
  addToStash,
  equipItem,
  loadProfile,
  pushRunHistory,
  recordClear,
  recordRun,
  returnLoaned,
  salvageItem,
  saveProfile,
  sanitizeUltimateChoices,
  ultimateChoice,
  unequipItem,
} from "./profile";
import { ULTIMATES, defaultUltimate } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import { baseDef } from "./bases";
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
    slot: "mainHand",
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
    expect(loaded.equipment.mainHand).toBeNull();
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
    profile.equipment.mainHand = oldWeapon;
    const newWeapon = makeItem({ id: "new", name: "New Sword" });
    addToStash(profile, newWeapon);

    const removed = equipItem(profile, "new");

    expect(removed).toEqual(oldWeapon);
    expect(profile.equipment.mainHand).toEqual(newWeapon);
    expect(profile.stash).toEqual([oldWeapon]);
  });

  it("装備先が空なら入れ替えなしで装備する", () => {
    const profile = createEmptyProfile();
    const weapon = makeItem({ id: "new" });
    addToStash(profile, weapon);

    const removed = equipItem(profile, "new");

    expect(removed).toBeNull();
    expect(profile.equipment.mainHand).toEqual(weapon);
    expect(profile.stash).toEqual([]);
  });

  it("存在しない itemId では何もしない", () => {
    const profile = createEmptyProfile();
    expect(equipItem(profile, "nope")).toBeNull();
  });

  it("unequipItem は装備を外して stash に戻す", () => {
    const profile = createEmptyProfile();
    const weapon = makeItem({ id: "w" });
    profile.equipment.mainHand = weapon;

    unequipItem(profile, "mainHand");

    expect(profile.equipment.mainHand).toBeNull();
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

describe("旧セーブの weapon / gun スロット（docs/ideas/weapon-redesign.md 5.3）", () => {
  it("旧 weapon スロットの遺物は右手へ、旧 gun スロットの遺物は倉庫へ移る", () => {
    const storage = new MemoryStorage();
    const raw = {
      version: 1,
      equipment: {
        weapon: { ...makeItem({ id: "old-weapon", baseKey: "shortsword" }), slot: "weapon" },
        gun: { ...makeItem({ id: "old-gun", baseKey: "pistol" }), slot: "gun" },
        armor: null,
        boots: null,
        ring: null,
        amulet: null,
      },
      stash: [],
      meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0 },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const loaded = loadProfile(storage);
    expect(loaded.equipment.mainHand?.id, "weapon が右手を取る").toBe("old-weapon");
    expect(loaded.stash.map((it) => it.id), "gun は倉庫へ落ちる").toEqual(["old-gun"]);
  });

  it("gun スロットの文字列を持つアイテムは mainHand として読める（冪等）", () => {
    const storage = new MemoryStorage();
    const raw = {
      version: 1,
      equipment: {
        weapon: null,
        gun: { ...makeItem({ id: "g", baseKey: "pistol" }), slot: "gun" },
        armor: null,
        boots: null,
        ring: null,
        amulet: null,
      },
      stash: [],
      meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0 },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const once = loadProfile(storage);
    expect(once.stash[0]?.slot, "倉庫でも mainHand として読める").toBe("mainHand");
    saveProfile(once, storage);
    const twice = loadProfile(storage);
    expect(twice, "書き戻すと新形式のまま冪等").toEqual(once);
  });
});

describe("消した器の遺物（docs/ideas/gun-bases-review.md 0-1。移行は作らない）", () => {
  it("消した器（投擲・旧戦輪の 7 つ）はベースの表に無い", () => {
    expect(REMOVED_BASE_KEYS.size).toBe(7);
    for (const key of REMOVED_BASE_KEYS) expect(baseDef(key), key).toBeUndefined();
  });

  it("消した器の遺物は装備からも倉庫からも読み込みで捨て、他の遺物は残す", () => {
    const storage = new MemoryStorage();
    const raw = {
      version: 1,
      equipment: {
        mainHand: makeItem({ id: "old-ring", baseKey: "returnChakram" }),
        armor: null,
        boots: null,
        ring: null,
        amulet: null,
      },
      stash: [makeItem({ id: "old-knives", baseKey: "throwingKnives" }), makeItem({ id: "kept", baseKey: "kunai" })],
      meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0 },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const loaded = loadProfile(storage);
    expect(loaded.equipment.mainHand, "装備の消した器は外れる").toBeNull();
    expect(loaded.stash.map((it) => it.id), "倉庫の消した器は捨てる").toEqual(["kept"]);
  });
});

describe("借り物（武器掛け）", () => {
  function loanedItem(id: string): Item {
    return { ...migrateItem(makeItem({ id, slot: "mainHand", baseKey: "whip" })), loaned: true };
  }

  it("loaned の品は saveProfile で書かれない（装備からも倉庫からも除く）", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    profile.equipment.mainHand = loanedItem("loan-a");
    addToStash(profile, loanedItem("loan-b"));
    addToStash(profile, migrateItem(makeItem({ id: "own" })));
    saveProfile(profile, storage);
    const loaded = loadProfile(storage);
    expect(loaded.equipment.mainHand, "装備の借り物は書かない").toBeNull();
    expect(loaded.stash.map((it) => it.id), "倉庫の借り物も書かない").toEqual(["own"]);
    expect(profile.equipment.mainHand?.id, "手元の profile は書き換えない").toBe("loan-a");
  });

  it("returnLoaned は借り物を外し、借り物が無ければ何もしない", () => {
    const profile = createEmptyProfile();
    profile.equipment.mainHand = loanedItem("loan");
    addToStash(profile, migrateItem(makeItem({ id: "own" })));
    expect(returnLoaned(profile), "外した").toBe(true);
    expect(profile.equipment.mainHand, "装備から消える").toBeNull();
    expect(profile.stash.map((it) => it.id), "自分の品は残る").toEqual(["own"]);
    expect(returnLoaned(profile), "2 回目は何もしない").toBe(false);
  });
});

describe("奥義の選択（Profile.ultimates）", () => {
  /** 武器種の最後の奥義（本数に依存しない。1 本しか無ければ既定と同じ） */
  function lastUltimateKey(moveset: (typeof MOVESET_KEYS)[number]): string {
    const set = ULTIMATES[moveset];
    return (set[set.length - 1] ?? set[0]).key;
  }

  it("不正な奥義の key や武器種違いの組は捨てて既定へ落ちる", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    const good = lastUltimateKey("sword");
    const other = lastUltimateKey("greatsword");
    const raw = {
      ...profile,
      ultimates: { sword: good, greatsword: "no-such-ultimate", spear: other, notAMoveset: good, whip: 42 },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const loaded = loadProfile(storage);
    expect(loaded.ultimates, "正しい組だけ残る").toEqual({ sword: good });
    expect(ultimateChoice(loaded, "greatsword").key, "知らない key は既定").toBe(defaultUltimate("greatsword").key);
    expect(ultimateChoice(loaded, "spear").key, "武器種違いは既定").toBe(defaultUltimate("spear").key);
    expect(sanitizeUltimateChoices("壊れた値"), "オブジェクトでなければ欄ごと捨てる").toBeUndefined();
    expect(sanitizeUltimateChoices({ spear: other }), "1 組も残らなければ欄ごと捨てる").toBeUndefined();
  });

  it("奥義を選んでいない武器種は 1 本目が既定", () => {
    const profile = createEmptyProfile();
    for (const k of MOVESET_KEYS) {
      expect(ultimateChoice(profile, k).key, `${k} は 1 本目`).toBe(ULTIMATES[k][0].key);
    }
    const storage = new MemoryStorage();
    saveProfile(profile, storage);
    expect(loadProfile(storage).ultimates, "選んでいなければ欄は書かれない").toBeUndefined();
  });
});

describe("履歴の段取り 9 の任意項目と踏破の記録", () => {
  function entry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
    return { date: 1, seedText: "abc", depth: 4, kills: 0, score: 0, bestCombo: 0, durationSec: 0, cause: "defeated", ...overrides };
  }

  it("履歴の新しい欄が保存と読み込みで往復する", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    pushRunHistory(
      profile,
      entry({
        killer: { kind: "strike", key: "wolf", elites: ["hasted"], nemesis: true },
        grudge: { key: "wolf", elites: ["hasted"] },
        avenged: true,
        tier: 3,
        job: "brawler",
        hurts: 0,
        justDodges: 4,
        counters: 2,
        noHurtFloors: 1,
      }),
    );
    recordClear(profile, 3);
    saveProfile(profile, storage);
    expect(loadProfile(storage), "往復").toEqual(profile);
    expect(loadProfile(storage).meta.history?.[0]?.hurts, "被弾 0 も残す").toBe(0);
  });

  it("壊れた新しい欄は捨て、欄の無い旧データも読める", () => {
    const storage = new MemoryStorage();
    const raw = {
      ...createEmptyProfile(),
      meta: {
        runs: 1,
        bestDepth: 2,
        totalKills: 0,
        bestScore: 0,
        clears: "x",
        bestClearTier: 5,
        history: [
          entry({}),
          { ...entry({}), killer: { kind: "nope", key: "wolf" }, grudge: { key: 3 }, avenged: "yes", tier: -2, job: 7, hurts: -1, justDodges: Number.NaN },
        ],
      },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    const loaded = loadProfile(storage);
    expect(loaded.meta.history, "旧データの行と、壊れた欄を捨てた行").toEqual([entry({}), entry({})]);
    expect(loaded.meta.clears, "壊れた踏破の回数は無し").toBeUndefined();
    expect(loaded.meta.bestClearTier, "踏破していなければ最高位階も無し").toBeUndefined();
  });

  it("recordClear は踏破の回数と最高位階を更新する", () => {
    const profile = createEmptyProfile();
    recordClear(profile, 4);
    recordClear(profile, 2);
    expect(profile.meta.clears).toBe(2);
    expect(profile.meta.bestClearTier, "最高位階は下がらない").toBe(4);
    const plain = createEmptyProfile();
    recordClear(plain, 0);
    expect(plain.meta.clears).toBe(1);
    expect(plain.meta.bestClearTier, "位階 0 の踏破は書かない").toBeUndefined();
  });
});
