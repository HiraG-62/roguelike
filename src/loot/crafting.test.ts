import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import {
  CONVERSION_AFFIXES,
  CORRUPTED_KEY,
  affixDef,
  formatAffix,
  isConversionKey,
  isKeystoneKey,
} from "./affixes";
import {
  CRAFT_COSTS,
  addSalvageCurrency,
  annulItem,
  applyCraftResult,
  augmentItem,
  corruptItem,
  craft,
  createWallet,
  fuseItems,
  fuseSlotCount,
  isCorrupted,
  reforgeItem,
  type CraftState,
  type Wallet,
} from "./crafting";
import { CRAFT_KEY, createCraftSave, loadCraft, saveCraft } from "./craftingStore";
import { CONVERSION_AFFIX_CHANCE, UNIQUES, generateItem } from "./generator";
import { computeStats } from "./stats";
import {
  DEFAULT_STATS,
  createEmptyEquipment,
  createEmptyProfile,
  type AffixRoll,
  type Equipment,
  type Item,
} from "./types";

const NOW = 1_700_000_000_000;
const RICH = 100;
const MANY = 200;

function rich(): Wallet {
  return { dust: RICH, shard: RICH, essence: RICH, relic: RICH };
}

function state(wallet: Wallet = rich()): CraftState {
  return { wallet, counter: 0 };
}

function roll(key: string, kind: AffixRoll["kind"], tier: number, value: number, value2?: number): AffixRoll {
  const r: AffixRoll = { key, kind, tier, value };
  if (value2 !== undefined) r.value2 = value2;
  return r;
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "weapon",
    rarity: "rare",
    itemLevel: 20,
    name: "Storm Fang",
    implicit: null,
    affixes: [
      roll("meleeDamagePct", "prefix", 3, 35),
      roll("meleeDamageFlat", "prefix", 4, 5),
      roll("attackSpeed", "suffix", 3, 8),
      roll("critChance", "suffix", 3, 4),
    ],
    foundDepth: 10,
    foundAt: 0,
    ...overrides,
  };
}

function equip(item: Item): Equipment {
  const eq = createEmptyEquipment();
  eq[item.slot] = item;
  return eq;
}

function statsWith(affixes: AffixRoll[], slot: Item["slot"] = "ring"): ReturnType<typeof computeStats> {
  return computeStats(equip(makeItem({ slot, baseKey: "ironRing", affixes })));
}

// ---------------------------------------------------------------------------
// 変換アフィックス
// ---------------------------------------------------------------------------

describe("変換アフィックス", () => {
  it("8 種以上あり、すべて convert 段階・conversion タグ・cv_ 接頭辞", () => {
    expect(CONVERSION_AFFIXES.length).toBeGreaterThanOrEqual(8);
    for (const def of CONVERSION_AFFIXES) {
      expect(isConversionKey(def.key)).toBe(true);
      expect(def.stage).toBe("convert");
      expect(def.tags).toContain("conversion");
      expect(affixDef(def.key)).toBe(def);
    }
  });

  it("表示は動詞で語る", () => {
    for (const def of CONVERSION_AFFIXES) {
      const tier = def.tiers[0];
      if (!tier) throw new Error(def.key);
      const text = formatAffix(roll(def.key, def.kind, 1, tier.min, tier.min2));
      expect(text).toMatch(/(変換|消費)/);
    }
    expect(formatAffix(roll("cv_meleeToBurn", "prefix", 2, 40))).toBe("近接ダメージの40%を炎上に変換");
  });

  it("melee → burn: 近接倍率の一部を burn に移す（scale の後に掛かる）", () => {
    const s = statsWith([roll("meleeDamagePct", "prefix", 1, 50), roll("cv_meleeToBurn", "prefix", 2, 40)], "amulet");
    // 1.5 * 0.6 = 0.9、移した 0.6 → burn DPS 6、chance 0.4 * 0.5 = 0.2
    expect(s.meleeDamageMul).toBeCloseTo(0.9, 5);
    expect(s.burnDps).toBeCloseTo(6, 5);
    expect(s.burnChance).toBeCloseTo(0.2, 5);
  });

  it("crit chance → crit multiplier: chance が 0 になり、1% あたり v% の倍率になる", () => {
    const s = statsWith([roll("critChance", "suffix", 1, 10), roll("cv_critToMultiplier", "prefix", 1, 5)]);
    // chance 0.15 → multiplier +0.75
    expect(s.critChance).toBe(0);
    expect(s.critMul).toBeCloseTo(DEFAULT_STATS.critMul + 0.75, 5);
  });

  it("max HP → armor: 30% の HP を 1/3 の armor に", () => {
    const s = statsWith([roll("cv_lifeToArmor", "prefix", 2, 30)], "armor");
    expect(s.maxHp).toBe(70);
    expect(s.armor).toBeCloseTo(10, 5);
  });

  it("dash charges → 距離: チャージは 1 に、距離はチャージ数に比例", () => {
    const s = computeStats(
      equip(
        makeItem({
          slot: "boots",
          baseKey: "boots",
          affixes: [roll("dashCharge", "suffix", 1, 1), roll("cv_chargesToDistance", "suffix", 3, 50)],
        }),
      ),
    );
    expect(s.dashCharges).toBe(1);
    // 2 チャージ × 50% = +100%（boots の implicit は無し）
    expect(s.dashDistanceMul).toBeCloseTo(2, 5);
  });

  it("spread → pierce: 弾数に比例して射撃ダメージが減り、pierce が増える", () => {
    const s = statsWith([roll("projectiles", "suffix", 1, 2, 0), roll("cv_splitToPierce", "suffix", 1, 10, 3)], "amulet");
    expect(s.projectileCount).toBe(3);
    expect(s.pierce).toBe(3);
    expect(s.rangedDamageMul).toBeCloseTo(0.8, 5);
  });

  it("move speed の超過分 → attack speed", () => {
    const s = statsWith([roll("moveSpeed", "prefix", 1, 20), roll("cv_speedToAttack", "suffix", 1, 50)], "amulet");
    expect(s.moveSpeedMul).toBeCloseTo(1.1, 5);
    expect(s.attackSpeedMul).toBeCloseTo(1.1, 5);
  });

  it("combo damage → JUST damage、life on hit → energy", () => {
    const combo = statsWith([roll("comboDamage", "prefix", 1, 2, 40), roll("cv_comboToJust", "prefix", 1, 50)]);
    expect(combo.comboDamageCap).toBeCloseTo(0.2, 5);
    expect(combo.justDodgeDamageMul).toBeCloseTo(1 + 0.2 * 1.5, 5);
    const leech = statsWith([roll("lifeOnHit", "prefix", 1, 4), roll("cv_leechToEnergy", "suffix", 1, 50)]);
    expect(leech.lifeOnHit).toBeCloseTo(2, 5);
    expect(leech.energyGainMul).toBeCloseTo(1 + 2 * 0.15, 5);
  });

  it("rare の抽選に変換が混ざり、1 アイテムに 1 つまで。unique にも組み込まれている", () => {
    expect(CONVERSION_AFFIX_CHANCE).toBeGreaterThan(0);
    const rng = createRng(3);
    let seen = 0;
    for (let i = 0; i < 2000; i++) {
      const item = generateItem(rng, { itemLevel: 30, rarityBoost: 4, foundDepth: 30, now: NOW });
      const conversions = item.affixes.filter((a) => isConversionKey(a.key));
      if (item.rarity !== "unique") expect(conversions.length).toBeLessThanOrEqual(1);
      if (item.rarity === "rare" && conversions.length > 0) seen++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(UNIQUES.some((u) => u.affixes.some((a) => isConversionKey(a.key)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// クラフト操作
// ---------------------------------------------------------------------------

describe("通貨", () => {
  it("分解で rarity に応じた通貨が 1 増える", () => {
    const wallet = createWallet();
    expect(addSalvageCurrency(wallet, makeItem({ rarity: "normal" }))).toBe("dust");
    expect(addSalvageCurrency(wallet, makeItem({ rarity: "magic" }))).toBe("shard");
    expect(addSalvageCurrency(wallet, makeItem({ rarity: "rare" }))).toBe("essence");
    expect(addSalvageCurrency(wallet, makeItem({ rarity: "unique" }))).toBe("relic");
    expect(wallet).toEqual({ dust: 1, shard: 1, essence: 1, relic: 1 });
  });

  it("round-trip（別キー roguelike.craft.v1）", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
    const save = createCraftSave();
    save.wallet = { dust: 3, shard: 2, essence: 1, relic: 7 };
    save.counter = 12;
    saveCraft(save, storage);
    expect(store.has(CRAFT_KEY)).toBe(true);
    expect(loadCraft(storage)).toEqual(save);
  });

  it("壊れたデータは空に戻す（負数や非数は 0）", () => {
    const storage = {
      getItem: () => JSON.stringify({ version: 1, wallet: { dust: -3, shard: "x", essence: 2.7 }, counter: "no" }),
      setItem: () => {},
    } as unknown as Storage;
    expect(loadCraft(storage)).toEqual({ version: 1, wallet: { dust: 0, shard: 0, essence: 2, relic: 0 }, counter: 0 });
    const broken = { getItem: () => "{oops", setItem: () => {} } as unknown as Storage;
    expect(loadCraft(broken)).toEqual(createCraftSave());
  });
});

describe("craft: 共通", () => {
  it("同じ item.id / counter なら同じ結果（決定的）で、counter と通貨が進む", () => {
    const a = state();
    const b = state();
    const ra = craft(a, { op: "reforge", item: makeItem(), bestDepth: 0, now: NOW });
    const rb = craft(b, { op: "reforge", item: makeItem(), bestDepth: 0, now: NOW });
    expect(ra).toEqual(rb);
    expect(a.counter).toBe(1);
    expect(a.wallet.shard).toBe(RICH - CRAFT_COSTS.reforge.amount);
  });

  it("counter が違えば別の結果になりうる", () => {
    const results = new Set<string>();
    const s = state();
    for (let i = 0; i < 10; i++) {
      const r = craft(s, { op: "reforge", item: makeItem(), bestDepth: 0, now: NOW });
      if (r.ok) results.add(JSON.stringify(r.item.affixes));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it("通貨不足は拒否し、何も消費しない", () => {
    for (const op of ["reforge", "augment", "annul", "corrupt"] as const) {
      const s = state(createWallet());
      const r = craft(s, { op, item: makeItem(), bestDepth: 0, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("insufficient");
      expect(s.counter).toBe(0);
      expect(s.wallet).toEqual(createWallet());
    }
  });

  it("適用できない操作（normal の Reforge など）は通貨を消費しない", () => {
    const s = state();
    const r = craft(s, { op: "reforge", item: makeItem({ rarity: "normal", affixes: [] }), bestDepth: 0, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
    expect(s.wallet).toEqual(rich());
  });

  it("corrupted は二度とクラフトできない（Fuse の相手でも拒否）", () => {
    const s = state();
    const first = craft(s, { op: "corrupt", item: makeItem(), bestDepth: 0, now: NOW });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(isCorrupted(first.item)).toBe(true);
    for (const op of ["reforge", "augment", "annul", "corrupt"] as const) {
      const r = craft(s, { op, item: first.item, bestDepth: 0, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("corrupted");
    }
    const fuse = craft(s, { op: "fuse", item: makeItem({ id: "x" }), partner: first.item, bestDepth: 0, now: NOW });
    expect(fuse.ok).toBe(false);
  });

  it("applyCraftResult: 単体操作は同じ位置で置き換え、Fuse は 2 つを 1 つにする", () => {
    const profile = createEmptyProfile();
    profile.stash.push(makeItem({ id: "a" }), makeItem({ id: "b" }), makeItem({ id: "c" }));
    const s = state();
    const annul = craft(s, { op: "annul", item: makeItem({ id: "b" }), bestDepth: 0, now: NOW });
    expect(applyCraftResult(profile, annul)).toBe(true);
    expect(profile.stash.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(profile.stash[1]?.affixes).toHaveLength(3);

    const fuse = craft(s, { op: "fuse", item: makeItem({ id: "a" }), partner: makeItem({ id: "c" }), bestDepth: 0, now: NOW });
    expect(applyCraftResult(profile, fuse)).toBe(true);
    expect(profile.stash).toHaveLength(2);
    expect(profile.stash.some((i) => i.id === "a" || i.id === "c")).toBe(false);
  });
});

describe("Reforge", () => {
  it("rarity を保ち、itemLevel は元と bestDepth の高い方。tier は itemLevel で縛られる", () => {
    for (let i = 0; i < MANY; i++) {
      const result = reforgeItem(makeItem({ itemLevel: 5 }), createRng(i), 12);
      if (!result) throw new Error("reforge failed");
      expect(result.item.rarity).toBe("rare");
      expect(result.item.itemLevel).toBe(12);
      for (const r of result.item.affixes) {
        const def = affixDef(r.key);
        if (def === undefined) continue;
        expect(def.tiers[r.tier - 1]?.minLevel ?? Infinity).toBeLessThanOrEqual(12);
      }
    }
    expect(reforgeItem(makeItem({ itemLevel: 30 }), createRng(1), 3)?.item.itemLevel).toBe(30);
  });

  it("magic は名前も付け替わる", () => {
    const magic = makeItem({ rarity: "magic", name: "Vicious Longsword", affixes: [roll("meleeDamagePct", "prefix", 3, 35)] });
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) names.add(reforgeItem(magic, createRng(i), 0)?.item.name ?? "");
    expect(names.size).toBeGreaterThan(1);
  });
});

describe("Augment", () => {
  it("空き枠に 1 つ追加する。枠が埋まっていれば拒否", () => {
    const result = augmentItem(makeItem(), createRng(1));
    expect(result?.item.affixes).toHaveLength(5);
    const full = makeItem({
      rarity: "magic",
      affixes: [roll("meleeDamagePct", "prefix", 3, 35), roll("attackSpeed", "suffix", 3, 8)],
    });
    expect(augmentItem(full, createRng(1))).toBeNull();
    expect(augmentItem(makeItem({ rarity: "normal", affixes: [] }), createRng(1))).toBeNull();
  });

  it("prefix / suffix の上限と key の重複なしを守る", () => {
    for (let i = 0; i < MANY; i++) {
      let item = makeItem();
      for (let n = 0; n < 4; n++) item = augmentItem(item, createRng(i * 10 + n))?.item ?? item;
      const prefixes = item.affixes.filter((a) => a.kind === "prefix" && !isKeystoneKey(a.key));
      const suffixes = item.affixes.filter((a) => a.kind === "suffix" && !isKeystoneKey(a.key));
      expect(prefixes.length).toBeLessThanOrEqual(3);
      expect(suffixes.length).toBeLessThanOrEqual(3);
      const keys = item.affixes.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("Annul", () => {
  it("ランダムに 1 つ消す。空なら拒否", () => {
    expect(annulItem(makeItem(), createRng(1))?.item.affixes).toHaveLength(3);
    expect(annulItem(makeItem({ affixes: [] }), createRng(1))).toBeNull();
  });
});

describe("Corrupt", () => {
  it("どの結果でも corrupted マーカーが付き、4 種の結果がすべて起こりうる", () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < MANY; i++) {
      const result = corruptItem(makeItem(), createRng(i));
      outcomes.add(result.outcome);
      expect(isCorrupted(result.item)).toBe(true);
      expect(result.item.affixes.filter((a) => a.key === CORRUPTED_KEY)).toHaveLength(1);
    }
    expect([...outcomes].sort()).toEqual(["conversion", "exalt", "keystone", "nothing"]);
  });

  it("exalt: tier が 1 段上がり、通常アフィックスの 1 つが負になる", () => {
    for (let i = 0; i < MANY; i++) {
      const result = corruptItem(makeItem(), createRng(i));
      if (result.outcome !== "exalt") continue;
      const body = result.item.affixes.filter((a) => a.key !== CORRUPTED_KEY);
      expect(body.map((a) => a.tier)).toEqual(makeItem().affixes.map((a) => a.tier - 1));
      expect(body.filter((a) => a.value < 0)).toHaveLength(1);
      return;
    }
    throw new Error("exalt not rolled");
  });

  it("負の値は符号を整えて表示する", () => {
    expect(formatAffix(roll("meleeDamagePct", "prefix", 1, -40))).toBe("近接ダメージ -40%");
  });

  it("keystone: キーストーンが 1 つだけになる", () => {
    for (let i = 0; i < MANY; i++) {
      const result = corruptItem(makeItem(), createRng(i));
      if (result.outcome !== "keystone") continue;
      expect(result.item.affixes.filter((a) => isKeystoneKey(a.key))).toHaveLength(1);
      return;
    }
    throw new Error("keystone not rolled");
  });
});

describe("Fuse", () => {
  const other = (): Item =>
    makeItem({
      id: "item-2",
      rarity: "magic",
      affixes: [roll("burn", "suffix", 3, 8, 6), roll("damageVsStaggered", "prefix", 3, 20)],
    });

  it("枠は元の合計より 1 少なく、rarity は高い方・slot は同じ・名前は再生成", () => {
    expect(fuseSlotCount(makeItem(), other())).toBe(5);
    for (let i = 0; i < MANY; i++) {
      const result = fuseItems(makeItem(), other(), createRng(i), NOW);
      if (!result) throw new Error("fuse failed");
      expect(result.item.affixes.length).toBeLessThanOrEqual(5);
      expect(result.item.affixes.length).toBeGreaterThan(0);
      expect(result.item.rarity).toBe("rare");
      expect(result.item.slot).toBe("weapon");
      expect(result.item.id).not.toBe("item-1");
      const prefixes = result.item.affixes.filter((a) => a.kind === "prefix").length;
      expect(prefixes).toBeLessThanOrEqual(3);
      const keys = result.item.affixes.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("magic 同士は magic の枠（1+1）に収まる", () => {
    const a = other();
    const b = { ...other(), id: "item-3", affixes: [roll("attackSpeed", "suffix", 3, 8), roll("meleeDamagePct", "prefix", 3, 30)] };
    const result = fuseItems(a, b, createRng(5), NOW);
    expect(result?.item.affixes).toHaveLength(2);
  });

  it("違うスロット・同じアイテム・両方アフィックス無しは拒否", () => {
    expect(fuseItems(makeItem(), makeItem({ id: "g", slot: "gun", baseKey: "pistol" }), createRng(1), NOW)).toBeNull();
    expect(fuseItems(makeItem(), makeItem(), createRng(1), NOW)).toBeNull();
    const empty = (id: string): Item => makeItem({ id, rarity: "normal", affixes: [] });
    expect(fuseItems(empty("a"), empty("b"), createRng(1), NOW)).toBeNull();
  });

  it("craft 経由では essence を 1 消費し、両方の id を consumedIds に返す", () => {
    const s = state();
    const r = craft(s, { op: "fuse", item: makeItem(), partner: other(), bestDepth: 0, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.consumedIds).toEqual(["item-1", "item-2"]);
    expect(s.wallet.essence).toBe(RICH - CRAFT_COSTS.fuse.amount);
  });
});
