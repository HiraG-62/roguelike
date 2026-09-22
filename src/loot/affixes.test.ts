import { describe, expect, it } from "vitest";
import {
  AFFIXES,
  IMPLICITS,
  KEYSTONES,
  KEYSTONE_KEY_PREFIX,
  affixDef,
  affixDefForRoll,
  applyRoll,
  affixesFor,
  formatAffix,
  implicitDef,
  keystoneConflicts,
  keystoneDef,
  keystoneToRoll,
  resolveKeystones,
} from "./affixes";
import { BASES, baseDef, basesForSlot } from "./bases";
import { KS } from "../system/keystones";
import { DEFAULT_STATS, SLOTS } from "./types";

const MIN_AFFIX_COUNT = 35;
const MIN_TRADEOFF_COUNT = 8;
const MIN_KEYSTONE_COUNT = 6;
const KIND_LIMIT = 3;
const FIRST_LEVEL = 1;

describe("アフィックス定義", () => {
  it(`${MIN_AFFIX_COUNT} 種以上ある`, () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(MIN_AFFIX_COUNT);
  });

  it("key が affix / implicit を通して重複しない", () => {
    const keys = [...AFFIXES.map((a) => a.key), ...IMPLICITS.map((i) => i.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全 def の tiers が minLevel 昇順（最下位 tier → T1）かつ min≤max", () => {
    for (const def of AFFIXES) {
      expect(def.tiers.length, def.key).toBeGreaterThan(0);
      // index 0 = T1 なので、末尾（最下位）から先頭に向かって minLevel が昇順
      const levelsLowToHigh = [...def.tiers].reverse().map((t) => t.minLevel);
      const sorted = [...levelsLowToHigh].sort((a, b) => a - b);
      expect(levelsLowToHigh, def.key).toEqual(sorted);
      for (const tier of def.tiers) {
        expect(tier.min, def.key).toBeLessThanOrEqual(tier.max);
        if (tier.min2 !== undefined || tier.max2 !== undefined) {
          expect(tier.min2, def.key).toBeDefined();
          expect(tier.max2, def.key).toBeDefined();
          expect(tier.min2 ?? 0, def.key).toBeLessThanOrEqual(tier.max2 ?? 0);
        }
      }
    }
  });

  it("2 値ラベルを持つ def は全 tier に value2 のロール幅がある", () => {
    for (const def of AFFIXES) {
      if (!def.label.includes("{v2}")) continue;
      for (const tier of def.tiers) expect(tier.min2, def.key).toBeDefined();
    }
  });

  it("各スロットで ilvl 1 から prefix / suffix が 3 種以上抽選できる", () => {
    for (const slot of SLOTS) {
      expect(affixesFor(slot, "prefix", FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(KIND_LIMIT);
      expect(affixesFor(slot, "suffix", FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(KIND_LIMIT);
    }
  });

  it("affixDef で引ける", () => {
    expect(affixDef("meleeDamagePct")?.kind).toBe("prefix");
    expect(affixDef("does-not-exist")).toBeUndefined();
  });

  it("formatAffix が 1 値 / 2 値 / 小数 / implicit を整形する", () => {
    expect(formatAffix({ key: "meleeDamagePct", kind: "prefix", tier: 1, value: 25 })).toBe(
      "+25% melee damage",
    );
    expect(formatAffix({ key: "burn", kind: "prefix", tier: 2, value: 12, value2: 9 })).toBe(
      "12% chance to burn for 9 damage per second",
    );
    expect(formatAffix({ key: "hpRegen", kind: "suffix", tier: 3, value: 1.5 })).toBe(
      "+1.5 HP regenerated per second",
    );
    expect(formatAffix({ key: "implicit.shortsword", kind: "prefix", tier: 1, value: 10 })).toBe(
      "+10% melee damage",
    );
  });
});

describe("トレードオフ付きアフィックス", () => {
  const tradeoffs = AFFIXES.filter((a) => a.tags.includes("tradeoff"));

  it(`${MIN_TRADEOFF_COUNT} 種以上あり、label に利得と代償の両方の値を出す`, () => {
    expect(tradeoffs.length).toBeGreaterThanOrEqual(MIN_TRADEOFF_COUNT);
    for (const def of tradeoffs) {
      expect(def.label, def.key).toContain("{v}");
      expect(def.label, def.key).toContain("{v2}");
    }
  });

  it("利得と代償が表示され、stats にも両方反映される", () => {
    const roll = { key: "crushing", kind: "prefix" as const, tier: 1, value: 60, value2: 12 };
    expect(formatAffix(roll)).toBe("+60% melee damage, -12% attack speed");
    const stats = { ...DEFAULT_STATS, keystones: [], triggers: [] };
    applyRoll(stats, roll);
    expect(stats.meleeDamageMul).toBeCloseTo(1.6);
    expect(stats.attackSpeedMul).toBeCloseTo(0.88);
  });
});

describe("キーストーン", () => {
  it(`${MIN_KEYSTONE_COUNT} 種以上あり、key が ks_ 始まりで一意、排他グループを持つ`, () => {
    expect(KEYSTONES.length).toBeGreaterThanOrEqual(MIN_KEYSTONE_COUNT);
    expect(new Set(KEYSTONES.map((k) => k.key)).size).toBe(KEYSTONES.length);
    for (const ks of KEYSTONES) {
      expect(ks.key.startsWith(KEYSTONE_KEY_PREFIX)).toBe(true);
      expect(ks.exclusiveGroup.length).toBeGreaterThan(0);
    }
    // 排他が意味を持つよう、2 つ以上入っているグループがある
    expect(keystoneConflicts(KEYSTONES.map((k) => k.key)).length).toBeGreaterThan(0);
  });

  it("AffixRoll は suffix / tier 1 / value 0 で保存され、formatAffix は [Keystone] 形式", () => {
    const def = keystoneDef("ks_glassCannon");
    expect(def).toBeDefined();
    if (def === undefined) return;
    const roll = keystoneToRoll(def);
    expect(roll).toEqual({ key: "ks_glassCannon", kind: "suffix", tier: 1, value: 0 });
    expect(affixDefForRoll(roll)?.source).toBe("keystone");
    expect(formatAffix(roll)).toBe(`[Keystone] Glass Cannon: ${def.description}`);
  });

  it("apply で keystones に積み、数値効果も掛ける", () => {
    const stats = { ...DEFAULT_STATS, keystones: [], triggers: [] };
    applyRoll(stats, { key: "ks_pacifist", kind: "suffix", tier: 1, value: 0 });
    expect(stats.keystones).toEqual(["ks_pacifist"]);
    expect(stats.rangedDamageMul).toBeCloseTo(3);
    expect(stats.projectileCount).toBe(2);
  });

  it("resolveKeystones は同グループ後勝ち・重複と未知 key を除去（勝者の出現順）", () => {
    expect(resolveKeystones(["ks_glassCannon", "ks_blink", "ks_juggernaut", "ks_blink", "ks_nope"])).toEqual([
      "ks_juggernaut",
      "ks_blink",
    ]);
  });

  it("戦闘側と合意した 8 key が指定の排他グループで定義されている", () => {
    const agreed: Record<string, string> = {
      ks_glassCannon: "body",
      ks_juggernaut: "body",
      ks_vampire: "body",
      ks_berserker: "tempo",
      ks_gambler: "tempo",
      ks_overclock: "tempo",
      ks_blink: "style",
      ks_pacifist: "style",
    };
    for (const [key, group] of Object.entries(agreed)) {
      expect(keystoneDef(key)?.exclusiveGroup, key).toBe(group);
    }
  });

  it("戦闘側（src/system/keystones.ts の KS）が参照する key が全て定義されている", () => {
    for (const key of Object.values(KS)) expect(keystoneDef(key), key).toBeDefined();
  });

  it("keystoneConflicts は衝突グループだけを返す", () => {
    const conflicts = keystoneConflicts(["ks_glassCannon", "ks_juggernaut", "ks_gambler"]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.map((k) => k.key)).toEqual(["ks_glassCannon", "ks_juggernaut"]);
  });
});

describe("affixDefForRoll（動的アフィックス）", () => {
  it("固定テーブルに無いトリガー key を復元・整形できる", () => {
    const roll = { key: "tr:onJustDodge:always:shockwave", kind: "prefix" as const, tier: 1, value: 25, value2: 400 };
    expect(affixDefForRoll(roll)?.source).toBe("trigger");
    expect(formatAffix(roll)).toBe("On JUST dodge: 40% chance to release a shockwave (25 dmg)");
  });

  it("不正な key は undefined", () => {
    expect(affixDefForRoll({ key: "tr:bogus:always:heal", kind: "prefix", tier: 1, value: 1 })).toBeUndefined();
    expect(affixDefForRoll({ key: "nothing", kind: "prefix", tier: 1, value: 1 })).toBeUndefined();
  });
});

describe("ベースアイテム定義", () => {
  it("各スロットに 4〜5 種あり、ilvl 1 で最低 1 種出る", () => {
    for (const slot of SLOTS) {
      const count = BASES.filter((b) => b.slot === slot).length;
      expect(count, slot).toBeGreaterThanOrEqual(4);
      expect(count, slot).toBeLessThanOrEqual(5);
      expect(basesForSlot(slot, FIRST_LEVEL).length, slot).toBeGreaterThan(0);
    }
  });

  it("implicitKey が全て実在する", () => {
    for (const base of BASES) {
      if (base.implicitKey === undefined) continue;
      expect(implicitDef(base.implicitKey), base.key).toBeDefined();
    }
  });

  it("baseDef で引ける", () => {
    expect(baseDef("greatsword")?.slot).toBe("weapon");
    expect(baseDef("nope")).toBeUndefined();
  });
});
