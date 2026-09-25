import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { STATUS, TRIGGER, WEAPON } from "../data/tuning";
import {
  ATTR_COLOR,
  ATTR_TRAIT_PREFIX,
  AFFIXES,
  CONVERSION_AFFIXES,
  affixDef,
  formatAffix,
  keystoneConflicts,
  keystoneDef,
  resolveKeystones,
  traitsFor,
} from "./affixes";
import { affixColor } from "./colors";
import { nominalAt } from "./flux";
import { generateItem } from "./generator";
import { computeStats } from "./stats";
import { ATTR_KEYS, DEFAULT_STATS, LOOT_SLOTS, createEmptyEquipment, type AffixRoll, type Equipment, type Item } from "./types";

/**
 * 戦闘再設計 L5（装備の追随）で足した性質: ステータス・ステータスの変換・状態異常の付与・弾斬り・マナの誓約。
 * docs/COMBAT_DESIGN.md A-3 / E-5 / F-2
 */

const NOW = 1_700_000_000_000;
const BASE = DEFAULT_STATS.attributes.str;

function roll(key: string, value: number, value2?: number): AffixRoll {
  const r: AffixRoll = { key, value };
  if (value2 !== undefined) r.value2 = value2;
  return r;
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "ironRing",
    slot: "ring",
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes: [],
    foundDepth: 10,
    foundAt: 0,
    ...overrides,
  };
}

function equip(...items: Item[]): Equipment {
  const eq = createEmptyEquipment();
  for (const item of items) eq[item.slot] = item;
  return eq;
}

/** 性質 2 つまでなら共鳴しない（MIN_RESONANCE_WEIGHT 未満）ので、性質の数値だけを見られる */
function statsWith(affixes: AffixRoll[]): ReturnType<typeof computeStats> {
  return computeStats(equip(makeItem({ affixes })));
}

const STATUS_TRAIT_KEYS = ["procBleed", "procPoison", "procVulnerable", "procWeaken", "procSilence", "procFear"];

describe("ステータスの性質（attr_*）", () => {
  const attrDefs = ATTR_KEYS.map((k) => affixDef(`${ATTR_TRAIT_PREFIX}${k}`));

  it("5 種あり、通常の抽選プール（AFFIXES）に入っている", () => {
    for (const [i, def] of attrDefs.entries()) {
      expect(def, ATTR_KEYS[i]).toBeDefined();
      expect(AFFIXES, ATTR_KEYS[i]).toContain(def);
    }
  });

  it("期待値曲線は深度 1: 2 → 10: 5 → 20: 8", () => {
    for (const def of attrDefs) {
      if (def === undefined) throw new Error("定義が無い");
      expect(nominalAt(def, 1).nominal, def.key).toBeCloseTo(2);
      expect(nominalAt(def, 10).nominal, def.key).toBeCloseTo(5);
      expect(nominalAt(def, 20).nominal, def.key).toBeCloseTo(8);
      expect(nominalAt(def, 15).nominal, `${def.key} は深度で単調に伸びる`).toBeGreaterThan(5);
    }
  });

  it("色は 紅 = 筋力 / 蒼 = 技巧 / 翠 = 体力 / 金 = 精神 / 冥 = 霊力", () => {
    const expected = { str: "crimson", dex: "azure", vit: "jade", mnd: "gold", spi: "umbra" } as const;
    for (const k of ATTR_KEYS) {
      const def = affixDef(`${ATTR_TRAIT_PREFIX}${k}`);
      if (def === undefined) throw new Error(k);
      expect(affixColor(def), k).toBe(expected[k]);
      expect(ATTR_COLOR[k], k).toBe(expected[k]);
    }
  });

  it("computeStats で attributes（生の値）に加算される。他の既存フィールドは動かさない", () => {
    const s = statsWith([roll("attr_str", 4), roll("attr_spi", 3)]);
    expect(s.attributes.str).toBe(BASE + 4);
    expect(s.attributes.spi).toBe(BASE + 3);
    expect(s.attributes.dex).toBe(BASE);
    // 右手が空なので素手の倍率だけが掛かる
    expect(s.meleeDamageMul).toBe(DEFAULT_STATS.meleeDamageMul * WEAPON.unarmed.damageMul);
  });

  it("複数の部位の同じステータスは合算される", () => {
    const s = computeStats(
      equip(
        makeItem({ affixes: [roll("attr_vit", 3)] }),
        makeItem({ id: "item-2", slot: "armor", baseKey: "leather", affixes: [roll("attr_vit", 5)] }),
      ),
    );
    expect(s.attributes.vit).toBe(BASE + 8);
  });

  it("表示は「筋力 +N」", () => {
    expect(formatAffix(roll("attr_str", 5))).toBe("筋力 +5");
    expect(formatAffix(roll("attr_mnd", 3))).toBe("精神 +3");
  });

  it("各スロットで少なくとも 1 種のステータスが抽選できる", () => {
    for (const slot of LOOT_SLOTS) {
      const attrs = traitsFor(slot, 1).filter((d) => d.key.startsWith(ATTR_TRAIT_PREFIX));
      expect(attrs.length, slot).toBeGreaterThan(0);
    }
  });
});

describe("ステータスの変換（cv_*To*）", () => {
  const attrConversions = CONVERSION_AFFIXES.filter((d) => d.tags.includes("attribute"));

  it("5 種あり、各ステータスが 1 回ずつ移し元・移し先になる", () => {
    expect(attrConversions).toHaveLength(5);
    const froms = new Set<string>();
    const tos = new Set<string>();
    for (const def of attrConversions) {
      const before = computeStats(createEmptyEquipment()).attributes;
      const after = statsWith([roll(def.key, 50)]).attributes;
      for (const k of ATTR_KEYS) {
        if (after[k] < before[k]) froms.add(k);
        if (after[k] > before[k]) tos.add(k);
      }
    }
    expect(froms.size).toBe(5);
    expect(tos.size).toBe(5);
  });

  it("技巧の 50% を筋力として扱う（技巧は 50% 減る）", () => {
    const s = statsWith([roll("attr_dex", 5), roll("cv_dexToStr", 50)]);
    // 技巧 5 + 5 = 10 → 半分の 5 を筋力へ
    expect(s.attributes.dex).toBe(5);
    expect(s.attributes.str).toBe(BASE + 5);
  });

  it("色は移し先のステータスの色、表示は「変換」の動詞", () => {
    const def = affixDef("cv_strToSpi");
    if (def === undefined) throw new Error("cv_strToSpi が無い");
    expect(affixColor(def)).toBe("umbra");
    expect(formatAffix(roll("cv_strToSpi", 50))).toBe("筋力の50%を霊力に変換");
  });

  it("期待値は 50%", () => {
    for (const def of attrConversions) expect(nominalAt(def, 10).nominal, def.key).toBe(50);
  });
});

describe("状態異常を付ける性質（statusProcs）", () => {
  it("6 種あり、抽選プールに入っている", () => {
    for (const key of STATUS_TRAIT_KEYS) {
      const def = affixDef(key);
      expect(def, key).toBeDefined();
      expect(AFFIXES, key).toContain(def);
    }
  });

  it("色: 出血 = 紅 / 毒・脆弱 = 冥 / 弱体 = 翠 / 沈黙 = 蒼 / 恐怖 = 金", () => {
    const expected: Record<string, string> = {
      procBleed: "crimson",
      procPoison: "umbra",
      procVulnerable: "umbra",
      procWeaken: "jade",
      procSilence: "azure",
      procFear: "gold",
    };
    for (const [key, color] of Object.entries(expected)) {
      const def = affixDef(key);
      if (def === undefined) throw new Error(key);
      expect(affixColor(def), key).toBe(color);
    }
  });

  it("computeStats で StatusProc が積まれる（種類・判定する攻撃・確率・持続）", () => {
    const s = statsWith([roll("procBleed", 12, 2), roll("procFear", 30)]);
    expect(s.statusProcs).toHaveLength(2);
    const bleed = s.statusProcs.find((p) => p.kind === "bleed");
    expect(bleed, "出血").toBeDefined();
    expect(bleed?.on).toBe("melee");
    expect(bleed?.chance).toBeCloseTo(0.12);
    expect(bleed?.potency).toBe(2);
    expect(bleed?.duration).toBe(STATUS.bleed.duration);
    const fear = s.statusProcs.find((p) => p.kind === "fear");
    expect(fear?.requiresCrit, "恐怖は会心時のみ").toBe(true);
    expect(fear?.chance).toBeCloseTo(0.3);
  });

  it("判定する攻撃: 脆弱はスキル、沈黙は射撃、毒と弱体はどの攻撃でも", () => {
    const s = statsWith([roll("procVulnerable", 20), roll("procSilence", 10)]);
    expect(s.statusProcs.find((p) => p.kind === "vulnerable")?.on).toBe("skill");
    expect(s.statusProcs.find((p) => p.kind === "silence")?.on).toBe("ranged");
    const t = statsWith([roll("procPoison", 10), roll("procWeaken", 10)]);
    expect(t.statusProcs.map((p) => p.on)).toEqual(["any", "any"]);
  });

  it("反転などで確率が 0 以下なら積まない", () => {
    const s = statsWith([{ ...roll("procPoison", -8), inverted: true }]);
    expect(s.statusProcs).toHaveLength(0);
  });

  it("表示は効果を文で書く", () => {
    expect(formatAffix(roll("procBleed", 12, 1.5))).toBe("近接命中時 12% で出血させる（1m 動くごとに 1.5 ダメージ）");
    for (const key of STATUS_TRAIT_KEYS) {
      expect(formatAffix(roll(key, 10, 1)), key).toMatch(/(させる|にする|与え)/);
    }
  });

  it("空装備では statusProcs は空で、DEFAULT_STATS の配列を共有しない", () => {
    const a = statsWith([roll("procWeaken", 10)]);
    expect(DEFAULT_STATS.statusProcs).toHaveLength(0);
    expect(a.statusProcs).not.toBe(DEFAULT_STATS.statusProcs);
  });
});

describe("弾斬り", () => {
  it("bulletCut が 0 より大きくなり、代償にリーチが縮む", () => {
    const s = computeStats(
      equip(makeItem({ slot: "mainHand", baseKey: "shortsword", affixes: [roll("bulletCut", 10)] })),
    );
    expect(s.bulletCut).toBeGreaterThan(0);
    expect(s.meleeReachMul).toBeCloseTo(0.9);
  });

  it("右手だけに付き、色は蒼", () => {
    const def = affixDef("bulletCut");
    if (def === undefined) throw new Error("bulletCut が無い");
    expect(def.slots).toEqual(["mainHand"]);
    expect(affixColor(def)).toBe("azure");
    expect(formatAffix(roll("bulletCut", 10))).toBe("近接攻撃で敵弾を消せる（リーチ -10%）");
  });
});

describe("マナの誓約（過負荷・静寂の誓い）", () => {
  it("排他グループ mana に 2 つ定義されている", () => {
    expect(keystoneDef("ks_overdraw")?.exclusiveGroup).toBe("mana");
    expect(keystoneDef("ks_silentVow")?.exclusiveGroup).toBe("mana");
    expect(keystoneDef("ks_overdraw")?.name).toBe("過負荷");
    expect(keystoneDef("ks_silentVow")?.name).toBe("静寂の誓い");
  });

  it("同時には成立しない（後勝ち）。他のグループとは両立する", () => {
    expect(resolveKeystones(["ks_overdraw", "ks_silentVow"])).toEqual(["ks_silentVow"]);
    expect(resolveKeystones(["ks_silentVow", "ks_glassCannon"])).toEqual(["ks_silentVow", "ks_glassCannon"]);
    const conflicts = keystoneConflicts(["ks_overdraw", "ks_silentVow"]);
    expect(conflicts).toHaveLength(1);
  });

  it("過負荷: スキル威力 -10%", () => {
    const s = statsWith([{ key: "ks_overdraw", value: 0, color: "umbra" }]);
    expect(s.keystones).toEqual(["ks_overdraw"]);
    expect(s.skillDamageMul).toBeCloseTo(0.9);
  });

  it("静寂の誓い: 自然回復 ×3、スキル威力 +30%", () => {
    const s = statsWith([{ key: "ks_silentVow", value: 0, color: "umbra" }]);
    expect(s.keystones).toEqual(["ks_silentVow"]);
    expect(s.manaRegen).toBeCloseTo(DEFAULT_STATS.manaRegen * 3);
    expect(s.skillDamageMul).toBeCloseTo(1.3);
  });

  it("装備 2 部位で両方を持つと、装備順で後の方だけが効く", () => {
    const s = computeStats(
      equip(
        makeItem({ slot: "mainHand", baseKey: "shortsword", affixes: [{ key: "ks_overdraw", value: 0 }] }),
        makeItem({ id: "item-2", affixes: [{ key: "ks_silentVow", value: 0 }] }),
      ),
    );
    expect(s.keystones).toEqual(["ks_silentVow"]);
    expect(s.skillDamageMul).toBeCloseTo(1.3);
  });
});

describe("無敵の上限（energyReserve）", () => {
  it("揺らぎで上振れしても TRIGGER.invulnMax を超えない（適用と表示の両方）", () => {
    const s = statsWith([roll("energyReserve", 0.9)]);
    expect(s.triggers[0]?.magnitude).toBe(TRIGGER.invulnMax);
    expect(formatAffix(roll("energyReserve", 0.9))).toContain(`${TRIGGER.invulnMax}秒間無敵`);
  });

  it("期待値曲線も上限以内", () => {
    const def = affixDef("energyReserve");
    if (def === undefined) throw new Error("energyReserve が無い");
    for (const p of def.curve) expect(p.max, `深度 ${p.depth}`).toBeLessThanOrEqual(TRIGGER.invulnMax);
  });
});

describe("生成", () => {
  it("1000 個生成しても例外なく、新しい性質が出て、集計できる", () => {
    const rng = createRng(2026);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const depth = 1 + (i % 30);
      const item = generateItem(rng, { itemLevel: depth, foundDepth: depth, rarityBoost: i % 3, now: NOW });
      for (const a of item.affixes) seen.add(a.key);
      const stats = computeStats(equip(item));
      for (const k of ATTR_KEYS) expect(Number.isFinite(stats.attributes[k]), k).toBe(true);
    }
    for (const k of ATTR_KEYS) expect(seen.has(`${ATTR_TRAIT_PREFIX}${k}`), k).toBe(true);
    for (const key of STATUS_TRAIT_KEYS) expect(seen.has(key), key).toBe(true);
  });

  it("弾斬りは右手の生成で出る", () => {
    const rng = createRng(7);
    let found = false;
    for (let i = 0; i < 1000 && !found; i++) {
      const depth = 4 + (i % 26);
      const item = generateItem(rng, { itemLevel: depth, foundDepth: depth, slot: "mainHand", now: NOW });
      found = item.affixes.some((a) => a.key === "bulletCut");
    }
    expect(found).toBe(true);
  });
});
