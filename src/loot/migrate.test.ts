import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { CORRUPTED_KEY } from "./affixes";
import { traitColorOf } from "./colors";
import { describeItem, describeResonance } from "./describe";
import { generateItem } from "./generator";
import { LEGACY_LIFE_ON_HIT_PCT_PER_FLAT, LEGACY_RARITY_MARGIN, LEGACY_TIER_FLUX, convertLegacyLifeOnHit, migrateItem } from "./migrate";
import { PROFILE_KEY, loadProfile, saveProfile } from "./profile";
import { computeStats } from "./stats";
import { createEmptyProfile, createEmptyProvenance, type Item } from "./types";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
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
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** 旧形式（prefix / suffix / tier / rarity）のアイテム */
function legacyRare(): Item {
  return {
    id: "old-rare",
    seed: 9,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "rare",
    itemLevel: 20,
    name: "嵐の牙",
    implicit: { key: "implicit.longsword", kind: "prefix", tier: 1, value: 40 },
    affixes: [
      { key: "meleeDamagePct", kind: "prefix", tier: 1, value: 56 },
      { key: "maxLife", kind: "prefix", tier: 3, value: -20 },
      { key: "tr:onKill:always:heal", kind: "suffix", tier: 1, value: 5, value2: 400 },
      { key: "ks_blink", kind: "suffix", tier: 1, value: 0 },
      { key: CORRUPTED_KEY, kind: "suffix", tier: 1, value: 0 },
    ],
    foundDepth: 18,
    foundAt: 123,
  };
}

describe("migrateItem", () => {
  it("tier → 揺らぎ、期待値を逆算。値は変えない", () => {
    const migrated = migrateItem(legacyRare());
    const melee = migrated.affixes.find((r) => r.key === "meleeDamagePct");
    expect(melee?.value).toBe(56);
    expect(melee?.flux).toBeCloseTo(LEGACY_TIER_FLUX[1] ?? 0);
    expect(melee?.nominal).toBeCloseTo(56 / (1 + (LEGACY_TIER_FLUX[1] ?? 0)));
    expect(melee?.kind).toBeUndefined();
    expect(melee?.tier).toBeUndefined();
    expect(melee && traitColorOf(melee)).toBe("crimson");
  });

  it("負の値（旧 Corrupt）は反転（冥）。腐敗の印は捨てる。誓約は冥", () => {
    const migrated = migrateItem(legacyRare());
    const life = migrated.affixes.find((r) => r.key === "maxLife");
    expect(life?.inverted).toBe(true);
    expect(life?.flux ?? 0).toBeLessThan(-1);
    expect(life && traitColorOf(life)).toBe("umbra");
    expect(migrated.affixes.some((r) => r.key === CORRUPTED_KEY)).toBe(false);
    expect(migrated.affixes.find((r) => r.key === "ks_blink")?.color).toBe("umbra");
    expect(migrated.rarity).toBe("unique");
  });

  it("旧 rarity → 余白、旧 rare 名 → 銘、来歴は空", () => {
    const migrated = migrateItem(legacyRare());
    expect(migrated.margin).toBe(LEGACY_RARITY_MARGIN.rare);
    expect(migrated.marginMax).toBe(LEGACY_RARITY_MARGIN.rare);
    expect(migrated.inscription).toBe("嵐の牙");
    expect(migrated.name).toBe("嵐の牙");
    expect(migrated.provenance).toEqual(createEmptyProvenance());
    expect(migrated.implicit).toEqual({ key: "implicit.longsword", value: 40 });
  });

  it("旧 unique は固有名から名のある遺物の key を引く", () => {
    const old: Item = { ...legacyRare(), rarity: "unique", name: "喪服の剣", baseKey: "greatsword" };
    expect(migrateItem(old).namedKey).toBe("widowmaker");
  });

  it("旧 unique の英語名（日本語化前）はベースと固定性質の key から名のある遺物を引く", () => {
    const old: Item = {
      ...legacyRare(),
      rarity: "unique",
      name: "Widowmaker",
      baseKey: "greatsword",
      affixes: [
        { key: "meleeDamagePct", kind: "prefix", tier: 1, value: 50 },
        { key: "critMultiplier", kind: "prefix", tier: 1, value: 40 },
        { key: "lifeOnKill", kind: "suffix", tier: 1, value: 12 },
        { key: "knockback", kind: "suffix", tier: 1, value: 30 },
        { key: "ks_berserker", kind: "suffix", tier: 1, value: 0 },
      ],
    };
    const migrated = migrateItem(old);
    expect(migrated.namedKey).toBe("widowmaker");
    expect(migrated.name).toBe("喪服の剣");
  });

  it("名のある遺物を引けない旧 unique は固有名を銘として残す", () => {
    const old: Item = { ...legacyRare(), rarity: "unique", name: "失われた遺物", baseKey: "longsword" };
    const migrated = migrateItem(old);
    expect(migrated.namedKey).toBeUndefined();
    expect(migrated.inscription).toBe("失われた遺物");
    expect(migrated.name).toBe("失われた遺物");
  });

  it("同じ旧セーブを 2 回読むと同じ結果（色・値・トリガー・誓約が保たれる）", () => {
    const storage = new MemoryStorage();
    const legacyProfile = {
      version: 1,
      equipment: { weapon: legacyRare(), gun: null, armor: null, boots: null, ring: null, amulet: null },
      stash: [],
      meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(legacyProfile));
    const first = loadProfile(storage);
    expect(loadProfile(storage)).toEqual(first);
    const weapon = first.equipment.mainHand;
    const trigger = weapon?.affixes.find((r) => r.key === "tr:onKill:always:heal");
    expect(trigger?.value).toBe(5);
    expect(trigger?.value2).toBe(400);
    expect(computeStats(first.equipment).keystones).toContain("ks_blink");
  });

  it("冪等: 新形式にもう一度掛けても変わらない。生成したアイテムも変わらない", () => {
    const once = migrateItem(legacyRare());
    expect(migrateItem(once)).toEqual(once);
    const fresh = generateItem(createRng(3), { itemLevel: 20, foundDepth: 20, now: 0 });
    expect(migrateItem(fresh)).toEqual(fresh);
  });

  it("旧 stash は読み込みで消えずに新形式になり、保存 → 読み込みで一致する（round-trip）", () => {
    const storage = new MemoryStorage();
    const legacyProfile = {
      version: 1,
      equipment: { weapon: legacyRare(), gun: null, armor: null, boots: null, ring: null, amulet: null },
      stash: [legacyRare(), { ...legacyRare(), id: "old-2", rarity: "magic", name: "獰猛な長剣" }],
      meta: { runs: 3, bestDepth: 9, totalKills: 40, bestScore: 100, history: [] },
    };
    storage.setItem(PROFILE_KEY, JSON.stringify(legacyProfile));
    const loaded = loadProfile(storage);
    expect(loaded.stash).toHaveLength(2);
    expect(loaded.equipment.mainHand?.provenance).toBeDefined();
    expect(loaded.stash[1]?.margin).toBe(LEGACY_RARITY_MARGIN.magic);
    saveProfile(loaded, storage);
    expect(loadProfile(storage)).toEqual(loaded);
    expect(() => computeStats(loaded.equipment)).not.toThrow();
  });

  it("空プロフィールはそのまま", () => {
    const storage = new MemoryStorage();
    saveProfile(createEmptyProfile(), storage);
    expect(loadProfile(storage)).toEqual(createEmptyProfile());
  });
});

describe("describeItem / describeResonance", () => {
  it("名前・副題・色の配合・性質の行・来歴を返す。反転は印付き", () => {
    const item = migrateItem(legacyRare());
    item.provenance = { ...createEmptyProvenance(), kills: 12, killsByEnemy: { slime: 10, bat: 2 }, justDodges: 3 };
    const desc = describeItem(item);
    expect(desc.name).toBe("嵐の牙");
    expect(desc.subtitle.startsWith("剣・"), "種類の行は武器種名で始まる").toBe(true);
    expect(desc.baseName, "ベース名は別に持つ").toBe("長剣");
    expect(desc.subtitle).toContain("反転あり");
    expect(desc.inscription).toBe("嵐の牙");
    expect(desc.implicit).toBeDefined();
    expect(desc.lines).toHaveLength(item.affixes.length);
    const inverted = desc.lines.find((l) => l.inverted === true);
    expect(inverted?.text.startsWith("反転")).toBe(true);
    expect(inverted?.fluxLevel).toBe(3);
    expect(desc.colorBar.reduce((s, seg) => s + seg.ratio, 0)).toBeCloseTo(1);
    expect(desc.provenanceLines[0]).toBe("地下 18 階で入手");
    expect(desc.provenanceLines.some((l) => l.startsWith("撃破 12（スライム 10"))).toBe(true);
    expect(desc.summary.length).toBeGreaterThan(0);
  });

  it("describeResonance は装備の stats.resonance を語る", () => {
    const eq = createEmptyProfile().equipment;
    expect(describeResonance(computeStats(eq).resonance)[0]).toBe("共鳴なし");
  });
});

describe("lifeOnHit の換算（固定値 → 与ダメの %）", () => {
  it("旧形式の lifeOnHit は LEGACY_LIFE_ON_HIT_PCT_PER_FLAT 倍の % になる", () => {
    const old: Item = {
      ...legacyRare(),
      affixes: [
        { key: "lifeOnHit", kind: "suffix", tier: 3, value: 2 },
        { key: "meleeDamagePct", kind: "prefix", tier: 3, value: 20 },
      ],
    };
    const migrated = migrateItem(old);
    const leech = migrated.affixes.find((r) => r.key === "lifeOnHit");
    expect(leech?.value, "2 → 3%").toBeCloseTo(2 * LEGACY_LIFE_ON_HIT_PCT_PER_FLAT);
    expect(leech?.nominal, "期待値も換算後の値から逆算する").toBeCloseTo(2 * LEGACY_LIFE_ON_HIT_PCT_PER_FLAT);
    expect(migrated.affixes.find((r) => r.key === "meleeDamagePct")?.value, "他の性質は変えない").toBe(20);
  });

  it("換算は 1 回だけ（新形式に掛け直しても値は変わらない）", () => {
    const old: Item = { ...legacyRare(), affixes: [{ key: "lifeOnHit", kind: "suffix", tier: 3, value: 2 }] };
    const once = migrateItem(old);
    const twice = migrateItem(once);
    expect(twice.affixes.find((r) => r.key === "lifeOnHit")?.value).toBe(once.affixes.find((r) => r.key === "lifeOnHit")?.value);
  });

  it("convertLegacyLifeOnHit は lifeOnHit 以外を素通しする", () => {
    const roll = { key: "lifeOnKill", value: 4 };
    expect(convertLegacyLifeOnHit(roll)).toBe(roll);
  });
});
