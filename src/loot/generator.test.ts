import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { affixDef, implicitDef, isConversionKey, isKeystoneKey, keystoneDef } from "./affixes";
import { baseDef } from "./bases";
import { COLOR_ADJECTIVE, traitColorOf } from "./colors";
import { INVERSION_MIN_DEPTH, fluxClassOf, powerScaleAt } from "./flux";
import {
  MAX_FOUND_TRAITS,
  MAX_MARGIN,
  MIN_MARGIN,
  UNIQUES,
  VOW_MIN_TRAITS,
  generateItem,
  rollTraitCount,
  rollUniqueAffixes,
  rollTraitOfColor,
  uniquesFor,
  type GenerateOptions,
} from "./generator";
import { isTriggerKey } from "./triggers";
import { computeStats } from "./stats";
import { DEFAULT_STATS, SLOTS, TRAIT_COLORS, createEmptyEquipment, createEmptyProvenance, type Item } from "./types";

const NOW = 1_700_000_000_000;
const MANY = 1000;
const HIGH_LEVEL = 40;
const SHALLOW = 3;
const DEEP = 25;
/** 名のある遺物の数の下限（2026-09 の拡張で 16 → 46） */
const MIN_NAMED_COUNT = 40;

function opts(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { itemLevel: 10, foundDepth: 5, now: NOW, ...overrides };
}

function generateMany(count: number, seed: number, o: Partial<GenerateOptions> = {}): Item[] {
  const rng = createRng(seed);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 1 + (i % HIGH_LEVEL);
    items.push(generateItem(rng, opts({ itemLevel: depth, foundDepth: depth, ...o })));
  }
  return items;
}

/** 涸れ井戸の指輪の器（性質は呼び出し側で差し込む） */
function driedWellItem(): Item {
  return {
    id: "driedWell",
    seed: 0,
    baseKey: "sapphireRing",
    slot: "ring",
    rarity: "unique",
    itemLevel: 10,
    name: "涸れ井戸の指輪",
    implicit: null,
    affixes: [],
    foundDepth: 10,
    foundAt: NOW,
  };
}

function withoutId(item: Item): Omit<Item, "id"> {
  const { id: _id, ...rest } = item;
  return rest;
}

function meanAbsFlux(items: readonly Item[]): number {
  const fluxes = items.flatMap((it) => it.affixes.filter((r) => r.inverted !== true).map((r) => Math.abs(r.flux ?? 0)));
  return fluxes.reduce((a, b) => a + b, 0) / Math.max(1, fluxes.length);
}

function meanCount(items: readonly Item[]): number {
  return items.reduce((sum, it) => sum + it.affixes.length, 0) / Math.max(1, items.length);
}

describe("generateItem: 決定性と基本形", () => {
  it("同 seed 同 opts で同一アイテム（id の連番部分を除く）", () => {
    const a = generateItem(createRng(42), opts({ itemLevel: 18, foundDepth: 16 }));
    const b = generateItem(createRng(42), opts({ itemLevel: 18, foundDepth: 16 }));
    expect(withoutId(a)).toEqual(withoutId(b));
    expect(a.id.split("-")[0]).toBe(b.id.split("-")[0]);
  });

  it("1000 個生成して例外なし・id ユニーク", () => {
    const items = generateMany(MANY, 1);
    expect(new Set(items.map((i) => i.id)).size).toBe(MANY);
  });

  it("prefix / suffix / tier を持たない。各性質は色を持ち、key は重複しない", () => {
    for (const item of generateMany(MANY, 2)) {
      expect(new Set(item.affixes.map((r) => r.key)).size, item.name).toBe(item.affixes.length);
      for (const roll of item.affixes) {
        expect(roll.kind).toBeUndefined();
        expect(roll.tier).toBeUndefined();
        expect(TRAIT_COLORS).toContain(traitColorOf(roll));
      }
    }
  });

  it("新形式のフィールド（来歴・余白・芽）が初期化されている", () => {
    for (const item of generateMany(200, 3)) {
      expect(item.provenance).toEqual(createEmptyProvenance());
      expect(item.margin).toBeGreaterThanOrEqual(item.namedKey === undefined ? MIN_MARGIN : 1);
      // 襤褸（marginBonus）は器の容量まで余白が多い
      expect(item.margin).toBeLessThanOrEqual(MAX_MARGIN + (baseDef(item.baseKey)?.marginBonus ?? 0));
      expect(item.marginMax).toBe(item.margin);
      expect(item.milestones).toEqual([]);
      expect(item.buds).toEqual([]);
      expect(item.budOffer).toBeNull();
      expect(item.inscription).toBeUndefined();
    }
  });

  it("性質の数は 0..MAX_FOUND_TRAITS（名のある遺物を除く）", () => {
    for (const item of generateMany(MANY, 4)) {
      if (item.namedKey !== undefined) continue;
      expect(item.affixes.length).toBeLessThanOrEqual(MAX_FOUND_TRAITS);
    }
  });

  it("slot 指定が守られ、ベースと implicit が実在する", () => {
    const rng = createRng(5);
    for (const slot of SLOTS) {
      for (let i = 0; i < 50; i++) {
        const item = generateItem(rng, opts({ slot }));
        expect(item.slot).toBe(slot);
        expect(baseDef(item.baseKey)?.slot).toBe(slot);
        if (item.implicit !== null) expect(implicitDef(item.implicit.key)).toBeDefined();
      }
    }
  });

  it("itemLevel が低くても（0 以下でも）生成できる", () => {
    expect(() => generateItem(createRng(6), opts({ itemLevel: 0, foundDepth: 0 }))).not.toThrow();
    expect(() => generateItem(createRng(6), opts({ itemLevel: -5, foundDepth: 0 }))).not.toThrow();
  });
});

describe("generateItem: 揺らぎ", () => {
  it("表の性質の値は nominal × (1 + flux) を丸めたもの", () => {
    for (const item of generateMany(MANY, 7)) {
      for (const roll of item.affixes) {
        if (isKeystoneKey(roll.key) || isTriggerKey(roll.key)) continue;
        expect(roll.nominal, roll.key).toBeDefined();
        expect(roll.flux, roll.key).toBeDefined();
        const expected = (roll.nominal ?? 0) * (1 + (roll.flux ?? 0));
        const step = 10 ** -(affixDef(roll.key)?.decimals ?? 0);
        expect(Math.abs(roll.value - expected), roll.key).toBeLessThanOrEqual(step);
      }
    }
  });

  it("深いほど性質の数が多く、揺らぎ（|flux| の平均）が大きい", () => {
    const shallow = generateMany(MANY, 8, { itemLevel: SHALLOW, foundDepth: SHALLOW });
    const deep = generateMany(MANY, 8, { itemLevel: DEEP, foundDepth: DEEP });
    expect(meanCount(deep)).toBeGreaterThan(meanCount(shallow));
    expect(meanAbsFlux(deep)).toBeGreaterThan(meanAbsFlux(shallow) * 2);
  });

  it("boost（ボス・宝物庫）で揺らぎが大きくなる", () => {
    const calm = generateMany(MANY, 9, { itemLevel: 10, foundDepth: 10, rarityBoost: 0 });
    const wild = generateMany(MANY, 9, { itemLevel: 10, foundDepth: 10, rarityBoost: 6 });
    expect(meanAbsFlux(wild)).toBeGreaterThan(meanAbsFlux(calm));
  });

  it(`反転は発見深度 ${INVERSION_MIN_DEPTH} 未満では出ず、以降は一定確率で出る（値は負・色は冥・分類は反転あり）`, () => {
    const shallow = generateMany(MANY, 10, { itemLevel: INVERSION_MIN_DEPTH - 1, foundDepth: INVERSION_MIN_DEPTH - 1 });
    expect(shallow.some((it) => it.affixes.some((r) => r.inverted === true))).toBe(false);

    const deep = generateMany(MANY, 10, { itemLevel: DEEP, foundDepth: DEEP });
    const inverted = deep.flatMap((it) => it.affixes.filter((r) => r.inverted === true));
    expect(inverted.length).toBeGreaterThan(0);
    for (const r of inverted) {
      expect(r.value).toBeLessThan(0);
      expect(r.flux ?? 0).toBeLessThan(-1);
      expect(traitColorOf(r)).toBe("umbra");
      expect(isConversionKey(r.key) || isTriggerKey(r.key)).toBe(false);
    }
    for (const it of deep) if (it.affixes.some((r) => r.inverted === true)) expect(it.rarity).toBe("unique");
  });

  it("rarity は揺らぎの見た目の分類（fluxClassOf）で、静・揺・荒のどれも出る", () => {
    const items = generateMany(MANY, 11);
    for (const it of items) expect(it.rarity).toBe(fluxClassOf(it.affixes));
    const classes = new Set(items.map((it) => it.rarity));
    for (const r of ["normal", "magic", "rare"] as const) expect(classes.has(r), r).toBe(true);
  });
});

describe("generateItem: 色・誓約・名前", () => {
  it("ベースの色の傾き: 短剣（金寄り）は長剣（紅寄り）より金の性質が多い", () => {
    const share = (baseKey: string, color: string): number => {
      const rng = createRng(12);
      let hit = 0;
      let total = 0;
      for (let i = 0; i < 3000; i++) {
        const item = generateItem(rng, opts({ slot: "weapon", itemLevel: 12, foundDepth: 12 }));
        if (item.baseKey !== baseKey) continue;
        for (const r of item.affixes) {
          total++;
          if (traitColorOf(r) === color) hit++;
        }
      }
      return hit / Math.max(1, total);
    };
    expect(share("dagger", "gold")).toBeGreaterThan(share("longsword", "gold"));
  });

  it(`誓約は性質 ${VOW_MIN_TRAITS} 個以上のときだけ付き、1 つまで（名のある遺物を除く）`, () => {
    let seen = 0;
    for (const item of generateMany(3000, 13)) {
      if (item.namedKey !== undefined) continue;
      const vows = item.affixes.filter((r) => isKeystoneKey(r.key));
      expect(vows.length).toBeLessThanOrEqual(1);
      if (vows.length > 0) {
        seen++;
        expect(item.affixes.length).toBeGreaterThanOrEqual(VOW_MIN_TRAITS);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("無銘の名前は「{最も多い色の形容}{ベース名}」、性質が無ければベース名", () => {
    for (const item of generateMany(300, 14)) {
      if (item.namedKey !== undefined) continue;
      const base = baseDef(item.baseKey)?.name ?? "";
      expect(item.name.endsWith(base)).toBe(true);
      if (item.affixes.length === 0) expect(item.name).toBe(base);
      else expect(Object.values(COLOR_ADJECTIVE).some((adj) => item.name.startsWith(adj))).toBe(true);
    }
  });

  it("高 boost・深層では名のある遺物が出る。固有名・固定の性質・反転なし", () => {
    const items = generateMany(2000, 15, { itemLevel: HIGH_LEVEL, foundDepth: HIGH_LEVEL, rarityBoost: 6 });
    const named = items.filter((it) => it.namedKey !== undefined);
    expect(named.length).toBeGreaterThan(0);
    for (const it of named) {
      const def = UNIQUES.find((u) => u.key === it.namedKey);
      expect(def).toBeDefined();
      expect(it.name).toBe(def?.name);
      expect(it.affixes.some((r) => r.inverted === true)).toBe(false);
      for (const r of it.affixes) expect(r.origin).toBe("named");
    }
  });
});

describe("rollTraitCount / rollTraitOfColor", () => {
  it("rollTraitCount は 0..MAX_FOUND_TRAITS", () => {
    const rng = createRng(16);
    for (let i = 0; i < MANY; i++) {
      const n = rollTraitCount(rng, i % HIGH_LEVEL);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(MAX_FOUND_TRAITS);
    }
  });

  it("指定色の性質を返し、used の key は出さない", () => {
    const rng = createRng(17);
    for (const slot of SLOTS) {
      for (const color of TRAIT_COLORS) {
        const used = new Set(["meleeDamagePct"]);
        const roll = rollTraitOfColor(rng, slot, color, used, { depth: 15, foundDepth: 15, allowInversion: false, origin: "bud" });
        expect(roll, `${slot}/${color}`).toBeDefined();
        if (roll === undefined) continue;
        expect(traitColorOf(roll)).toBe(color);
        expect(used.has(roll.key)).toBe(false);
      }
    }
  });

  it("トリガーの候補が既出の key と衝突したら、同じ色の表の性質に回す（候補なしにしない）", () => {
    const traitOpts = { depth: 15, foundDepth: 15, allowInversion: false, origin: "bud" as const };
    let checked = 0;
    for (let seed = 0; seed < MANY && checked < 5; seed++) {
      const first = rollTraitOfColor(createRng(seed), "weapon", "crimson", new Set(), traitOpts);
      if (first === undefined || !isTriggerKey(first.key)) continue;
      // 同じ乱数列で、さっき引いたトリガーを既出にする → 衝突する
      const again = rollTraitOfColor(createRng(seed), "weapon", "crimson", new Set([first.key]), traitOpts);
      expect(again, `seed ${seed}`).toBeDefined();
      if (again === undefined) continue;
      expect(isTriggerKey(again.key), "表の性質に回っている").toBe(false);
      expect(traitColorOf(again)).toBe("crimson");
      checked++;
    }
    expect(checked, "トリガーを引く seed が見つかった").toBeGreaterThan(0);
  });
});

describe("名のある遺物の定義", () => {
  it(`${MIN_NAMED_COUNT} 個以上あり、key が重複せず、ベース・性質・誓約が実在する`, () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(MIN_NAMED_COUNT);
    expect(new Set(UNIQUES.map((u) => u.key)).size, "key の重複").toBe(UNIQUES.length);
    for (const u of UNIQUES) {
      expect(baseDef(u.baseKey), u.key).toBeDefined();
      for (const spec of u.affixes) expect(affixDef(spec.key), `${u.key}/${spec.key}`).toBeDefined();
      if (u.keystone !== undefined) expect(keystoneDef(u.keystone), u.key).toBeDefined();
    }
  });

  it("各スロットに 2 つ以上ある", () => {
    for (const slot of SLOTS) {
      expect(UNIQUES.filter((u) => baseDef(u.baseKey)?.slot === slot).length, slot).toBeGreaterThanOrEqual(2);
    }
  });

  it("涸れ井戸の指輪が生成でき、最大マナが減り撃破のマナとコスト軽減が付く", () => {
    const def = UNIQUES.find((u) => u.key === "driedWell");
    expect(def, "driedWell が定義されている").toBeDefined();
    if (def === undefined) return;
    const affixes = rollUniqueAffixes(createRng(7), def, def.minLevel);
    expect(affixes.map((r) => r.key)).toEqual(["manaDrought", "manaCostPct"]);
    const stats = computeStats({ ...createEmptyEquipment(), ring: { ...driedWellItem(), affixes } });
    // 値は揺らぐので方向だけを見る（曲線の期待値は深度 10 で 最大マナ −31 / 撃破でマナ +10 / コスト −15%。
    // 生成時に装備の強さの係数 powerScaleAt を掛ける）
    expect(affixes[0]?.nominal2 ?? 0, "最大マナの期待値は −30 × 係数 前後").toBeGreaterThanOrEqual(28 * powerScaleAt(def.minLevel));
    expect(stats.maxMana, "最大マナが基礎より減る").toBeLessThan(DEFAULT_STATS.maxMana);
    expect(stats.manaOnKill, "撃破でマナが増える").toBeGreaterThan(0);
    expect(stats.manaCostMul, "スキルのコストが下がる").toBeLessThan(1);
  });

  it("uniquesFor はそのスロット・深度で解禁済みのものだけを返す", () => {
    for (const u of uniquesFor("weapon", 10)) {
      expect(u.minLevel).toBeLessThanOrEqual(10);
      expect(baseDef(u.baseKey)?.slot).toBe("weapon");
    }
  });
});

describe("generateItem: ベース指定と素の器", () => {
  it("baseKey と plain を指定すると性質 0 でそのベースになる（implicit は残る）", () => {
    const item = generateItem(createRng(9), { baseKey: "katana", plain: true, itemLevel: 20, foundDepth: 1, now: 0 });
    expect(item.baseKey, "指定したベース").toBe("katana");
    expect(item.slot, "スロットはベースのもの").toBe("weapon");
    expect(item.affixes, "性質なし").toEqual([]);
    expect(item.namedKey, "名のある遺物にならない").toBeUndefined();
    expect(item.implicit?.key, "implicit はベースの個性として残る").toBe(baseDef("katana")?.implicitKey);
  });

  it("baseKey だけを指定すると性質は通常どおり抽選される", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      generateItem(createRng(100 + i), { baseKey: "leather", itemLevel: 10, foundDepth: 1, now: 0 }),
    );
    expect(items.every((it) => it.baseKey === "leather"), "ベースは固定").toBe(true);
    expect(items.some((it) => it.affixes.length > 0), "性質を持つものがある").toBe(true);
  });

  it("未知の baseKey は throw する", () => {
    expect(() => generateItem(createRng(1), { baseKey: "nope", plain: true, itemLevel: 1, foundDepth: 1, now: 0 })).toThrow();
  });

  it("省略時の生成結果は従来と同じ（baseKey: undefined を渡しても同じ乱数の引き方）", () => {
    for (let seed = 0; seed < 30; seed++) {
      const a = generateItem(createRng(seed), { itemLevel: 6, foundDepth: 4, now: 0 });
      const b = generateItem(createRng(seed), { itemLevel: 6, foundDepth: 4, now: 0, baseKey: undefined, plain: undefined });
      expect({ ...b, id: a.id }, `seed ${seed}`).toEqual(a);
    }
  });
});
