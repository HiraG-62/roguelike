import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { RELIC } from "../data/tuning";
import { affixDef } from "./affixes";
import { baseDef } from "./bases";
import { generateItem } from "./generator";
import { UNIQUES, uniqueDef } from "./named";
import { computeStats } from "./stats";
import { DEFAULT_STATS, type Item, type Slot, createEmptyEquipment } from "./types";

/** 固有を Rule / Modifier / apply ではなく engine の分岐（system/namedRelics.ts）だけで持つ遺物 */
const ENGINE_ONLY = new Set(["reverseHourglass", "sixCoins", "jizo", "boneCrown"]);

/** 部位の配り（docs/ideas/relics-7d-plan.md 3 章） */
const SLOT_COUNTS: Readonly<Partial<Record<Slot, number>>> = { mainHand: 4, amulet: 5, head: 3, ring: 3, armor: 2, boots: 1 };

/** 加護の 3 枠目を開く遺物 */
const GRACE_SLOTS: Readonly<Record<string, string>> = {
  twinSerpent: "secondary",
  emptyScabbard: "dash",
  pilgrimBeads: "skill",
  bellTongue: "ultimate",
  plainBlade: "primary",
};

function namedItem(key: string): Item {
  const def = uniqueDef(key);
  if (def === undefined) throw new Error(`遺物 ${key} が無い`);
  const slot = baseDef(def.baseKey)?.slot;
  if (slot === undefined) throw new Error(`${key} のベースが無い`);
  return { id: key, seed: 1, baseKey: def.baseKey, slot, rarity: "unique", itemLevel: 10, name: def.name, implicit: null, affixes: [], foundDepth: 10, foundAt: 0, namedKey: key };
}

function equipped(key: string): ReturnType<typeof computeStats> {
  const item = namedItem(key);
  return computeStats({ ...createEmptyEquipment(), [item.slot]: item });
}

describe("名のある遺物 18（段取り 7d）", () => {
  it("18 個、key と名前が重ならない", () => {
    expect(UNIQUES).toHaveLength(18);
    expect(new Set(UNIQUES.map((u) => u.key)).size).toBe(18);
    expect(new Set(UNIQUES.map((u) => u.name)).size).toBe(18);
  });

  it("部位の配り: 右手 4・首飾り 5・頭 3・指輪 3・体 2・足 1", () => {
    for (const [slot, count] of Object.entries(SLOT_COUNTS)) {
      expect(UNIQUES.filter((u) => baseDef(u.baseKey)?.slot === slot), slot).toHaveLength(count);
    }
  });

  it("全部が Rule / Modifier / apply / engine の分岐のどれかと、変わるもの（changes）と語を持つ", () => {
    for (const u of UNIQUES) {
      const own = (u.rules?.length ?? 0) > 0 || (u.modifiers?.length ?? 0) > 0 || u.apply !== undefined || ENGINE_ONLY.has(u.key);
      expect(own, `${u.key} の固有`).toBe(true);
      expect(u.changes, `${u.key} の changes`).toBeDefined();
      expect(u.keywords, `${u.key} の語`).toBeDefined();
      expect(u.flavor?.length ?? 0, `${u.key} の銘の一文`).toBeGreaterThan(0);
    }
  });

  it("Rule / Modifier の持ち主は自分（item）で、id は全体で重ならない", () => {
    const ids: string[] = [];
    for (const u of UNIQUES) {
      for (const r of u.rules ?? []) {
        expect(r.owner, u.key).toEqual({ kind: "item", key: u.key });
        ids.push(r.id);
      }
      for (const m of u.modifiers ?? []) {
        expect(m.owner, u.key).toEqual({ kind: "item", key: u.key });
        ids.push(m.id);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("固定の性質は今の AFFIXES にある（性質のレーンが足す twinEdge などは統合で足す）", () => {
    for (const u of UNIQUES) for (const spec of u.affixes) expect(affixDef(spec.key), `${u.key}/${spec.key}`).toBeDefined();
  });

  it("加護の 3 枠目を開く遺物は設計どおり", () => {
    const actual = Object.fromEntries(UNIQUES.filter((u) => u.graceSlot !== undefined).map((u) => [u.key, u.graceSlot]));
    expect(actual).toEqual(GRACE_SLOTS);
  });
});

describe("名のある遺物の固有を装備の集計に畳む", () => {
  it("双頭の蛇: Rule と Modifier が stats に載り、右の枠が 1 つ開く", () => {
    const stats = equipped("twinSerpent");
    expect(stats.rules.map((r) => r.owner.key)).toContain("twinSerpent");
    expect(stats.modifiers.map((m) => m.owner.key)).toContain("twinSerpent");
    expect(stats.graceSlotBonus.secondary).toBe(1);
  });

  it("招き猫・欲の皮: 銭の倍が apply で掛かる", () => {
    const cat = equipped("luckyCat");
    expect(cat.coinMagnetMul).toBeCloseTo(DEFAULT_STATS.coinMagnetMul * RELIC.luckyCat.magnetMul);
    expect(cat.coinGainMul).toBeCloseTo(DEFAULT_STATS.coinGainMul * RELIC.luckyCat.gainMul);
    expect(cat.coinSpillMul).toBeCloseTo(DEFAULT_STATS.coinSpillMul * RELIC.luckyCat.spillMul);
    expect(equipped("greedHide").coinSpillMul).toBeCloseTo(DEFAULT_STATS.coinSpillMul * RELIC.greedHide.spillMul);
  });

  it("装備を外せば固有は残らない", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.rules).toEqual([]);
    expect(stats.graceSlotBonus).toEqual({});
  });
});

describe("無地の刃の生成", () => {
  it("性質が付かず、余白が固有の値（器の容量まで）", () => {
    const rng = createRng(11);
    let found: Item | undefined;
    for (let i = 0; i < 400 && found === undefined; i++) {
      const item = generateItem(rng, { itemLevel: 20, foundDepth: 20, rarityBoost: 1000, slot: "mainHand", now: 0 });
      if (item.namedKey === "plainBlade") found = item;
    }
    expect(found, "無地の刃が出る").toBeDefined();
    expect(found?.affixes).toEqual([]);
    expect(found?.margin).toBe(RELIC.plainBlade.margin);
  });
});
