import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { ENEMY_SCALE, INNATE } from "../data/tuning";
import { MOVESETS, movesetMainAttrs } from "../data/weapons";
import { ATTR_TRAIT_PREFIX, RESIST_TRAIT_PREFIX } from "./affixes";
import { BASES, baseDef, basesForSlot, type BaseItemDef } from "./bases";
import { stirTrait } from "./crafting";
import { describeItem, innateLines, itemColorBar } from "./describe";
import { UNIQUES, generateItem, type GenerateOptions } from "./generator";
import {
  INNATE_ARMOR_KEY,
  collectInnate,
  innateAt,
  innateLeanAttrs,
  innateLuckOf,
  innateMeanBudget,
  recoverInnateLuck,
  rollInnate,
  rollInnateBudget,
  weaponLeanAttrs,
} from "./innate";
import { migrateItem } from "./migrate";
import { loadProfile, PROFILE_KEY } from "./profile";
import { computeStats } from "./stats";
import { emptyProfile } from "../core/keywords";
import { relicKeywords } from "../system/keywords";
import { ATTR_KEYS, LOOT_SLOTS, SLOTS, createEmptyEquipment, createEmptyProfile, type AffixRoll, type AttrKey, type Item, type Slot } from "./types";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { ascend, descend } from "../system/floor";

const NOW = 1_700_000_000_000;
const SAMPLES = 2000;

function mustBase(key: string): BaseItemDef {
  const base = baseDef(key);
  if (base === undefined) throw new Error(`base ${key} が無い`);
  return base;
}

/** 地金の行を 1 点あたりの値で割り戻した点の合計（防御力の確定分は予算を使わないので引く） */
function spentPoints(base: BaseItemDef, rolls: readonly AffixRoll[]): number {
  let points = 0;
  for (const r of rolls) {
    if (r.key.startsWith(ATTR_TRAIT_PREFIX)) points += r.value / INNATE.pointValue.attr;
    else if (r.key.startsWith(RESIST_TRAIT_PREFIX)) points += r.value / INNATE.pointValue.resist;
    else if (r.key === INNATE_ARMOR_KEY && base.slot !== "mainHand") {
      const slot = base.slot as keyof typeof INNATE.armor.base;
      points += (r.value - INNATE.armor.base[slot]) / INNATE.armor.perPoint[slot];
    }
  }
  return Math.round(points);
}

function attrOf(roll: AffixRoll): AttrKey | undefined {
  if (!roll.key.startsWith(ATTR_TRAIT_PREFIX)) return undefined;
  const k = roll.key.slice(ATTR_TRAIT_PREFIX.length);
  return (ATTR_KEYS as readonly string[]).includes(k) ? (k as AttrKey) : undefined;
}

/** その部位で、あるステータスが出た回数 */
function attrCounts(base: BaseItemDef, depth: number, seed: number): Record<AttrKey, number> {
  const counts = Object.fromEntries(ATTR_KEYS.map((k) => [k, 0])) as Record<AttrKey, number>;
  const rng = createRng(seed);
  for (let i = 0; i < SAMPLES; i++) {
    for (const r of rollInnate(rng, base, depth, 0, false).rolls) {
      const a = attrOf(r);
      if (a !== undefined) counts[a] += 1;
    }
  }
  return counts;
}

function gen(seed: number, opts: Partial<GenerateOptions> = {}): Item {
  return generateItem(createRng(seed), { itemLevel: 10, foundDepth: 10, now: NOW, ...opts });
}

describe("地金の抽選", () => {
  it("同じ seed なら同じ地金になる", () => {
    const base = mustBase("chain");
    expect(rollInnate(createRng(42), base, 12, 0, false)).toEqual(rollInnate(createRng(42), base, 12, 0, false));
    expect(gen(7).innate, "generateItem も同じ").toEqual(gen(7).innate);
  });

  it("plain（借り物・初期武器）は地金なし", () => {
    expect(rollInnate(createRng(1), mustBase("chain"), 10, 0, true).rolls).toEqual([]);
    const item = generateItem(createRng(3), { baseKey: "shortsword", plain: true, itemLevel: 5, foundDepth: 5, now: NOW });
    expect(item.innate, "plain の生成").toEqual([]);
  });

  it("防具は必ず防御力が付き、武器には防御力の行が無い", () => {
    const rng = createRng(9);
    for (const base of BASES) {
      for (let i = 0; i < 20; i++) {
        const rolls = rollInnate(rng, base, 1 + i, 0, false).rolls;
        const armor = rolls.filter((r) => r.key === INNATE_ARMOR_KEY);
        if (base.slot === "mainHand") expect(armor.length, `${base.key} に防御力`).toBe(0);
        else {
          expect(armor.length, `${base.key} の防御力`).toBe(1);
          expect(armor[0]?.value ?? 0, `${base.key} の防御力の値`).toBeGreaterThan(0);
        }
        for (const r of rolls) expect(r.origin, "出自は地金").toBe("innate");
      }
    }
  });

  it("予算の期待値に上限は無く、深みでは敵の生命と同じ指数で伸びる", () => {
    const deep = ENEMY_SCALE.deepDepth;
    expect(innateMeanBudget(deep + 10), "深み 10 階").toBeCloseTo(innateMeanBudget(deep) * ENEMY_SCALE.deepHpGrowth ** 10, 6);
    expect(innateMeanBudget(60), "深度 60 でも伸びる").toBeGreaterThan(innateMeanBudget(40));
    expect(innateMeanBudget(20), "深度 20 は base + perDepth × 20").toBeCloseTo(INNATE.budget.base + INNATE.budget.perDepth * 20, 6);
  });

  it("上振れ（luck）の平均はほぼ 1", () => {
    const rng = createRng(17);
    const base = mustBase("chain");
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += rollInnate(rng, base, 10, 0, false).luck;
    expect(sum / SAMPLES).toBeCloseTo(1, 1);
  });

  it("深度が深いほど予算の平均が増える", () => {
    let prev = -1;
    for (const depth of [1, 3, 5, 8, 10, 15, 20, 30]) {
      const rng = createRng(depth);
      let sum = 0;
      for (let i = 0; i < SAMPLES; i++) sum += rollInnateBudget(rng, depth, 0);
      const mean = sum / SAMPLES;
      expect(mean, `深度 ${depth} の平均予算`).toBeGreaterThan(prev);
      expect(innateMeanBudget(depth), `深度 ${depth} の期待値`).toBeGreaterThan(0);
      prev = mean;
    }
  });

  it("boost（ボス・宝物庫）で予算が上振れする", () => {
    const mean = (boost: number): number => {
      const rng = createRng(5);
      let sum = 0;
      for (let i = 0; i < SAMPLES; i++) sum += rollInnateBudget(rng, 10, boost);
      return sum / SAMPLES;
    };
    expect(mean(2), "boost 2 の平均").toBeGreaterThan(mean(0));
  });

  it("予算が同じなら項目が増えるほど 1 項目の値は薄まる（項目数 × 値 は予算を超えない）", () => {
    const base = mustBase("hood");
    const rng = createRng(21);
    for (let i = 0; i < SAMPLES; i++) {
      const rolls = rollInnate(rng, base, 20, 0, false).rolls.filter((r) => r.key !== INNATE_ARMOR_KEY);
      const maxLines = INNATE.maxLines.head;
      expect(rolls.length, "項目数の上限").toBeLessThanOrEqual(maxLines);
      expect(spentPoints(base, rolls), "点の合計").toBeLessThanOrEqual(Math.round(innateMeanBudget(20) * INNATE.budget.highScale));
    }
  });

  it("防具の部位ごとに出やすいステータスがある（頭 = 筋力・技巧 / 体 = 体力 / 足 = 技巧・体力 / 指輪 = 精神 / 首飾り = 霊力）", () => {
    const cases: readonly [string, readonly AttrKey[]][] = [
      ["hood", ["str", "dex"]],
      ["chain", ["vit"]],
      ["sandals", ["dex", "vit"]],
      ["ironRing", ["mnd"]],
      ["jadeAmulet", ["spi"]],
    ];
    for (const [key, lean] of cases) {
      const base = mustBase(key);
      expect(innateLeanAttrs(base), `${key} の傾き`).toEqual(lean);
      const counts = attrCounts(base, 15, 77);
      const others = ATTR_KEYS.filter((k) => !lean.includes(k));
      for (const k of lean) {
        for (const o of others) expect(counts[k], `${key}: ${k} は ${o} より出やすい`).toBeGreaterThan(counts[o]);
      }
    }
  });

  it("防御 def の重みは全部位で傾きなし（傾いたステータスより出にくい）", () => {
    for (const slot of LOOT_SLOTS) {
      for (const base of basesForSlot(slot, 1).slice(0, 1)) expect(innateLeanAttrs(base), slot).not.toContain("def");
    }
  });

  it("武器は武器種の主参照のステータスが出やすい", () => {
    for (const key of ["dagger", "greatsword", "wand", "pistol", "towerShield"]) {
      const base = mustBase(key);
      const lean = weaponLeanAttrs(base);
      expect(lean.length, `${key} の主参照`).toBeGreaterThan(0);
      expect(lean.length).toBeLessThanOrEqual(INNATE.weaponLeanTop);
      const counts = attrCounts(base, 15, 99);
      const others = ATTR_KEYS.filter((k) => !lean.includes(k));
      for (const k of lean) for (const o of others) expect(counts[k], `${key}: ${k} は ${o} より出やすい`).toBeGreaterThan(counts[o]);
    }
  });

  it("武器種の主参照は係数の合計の上位（movesetMainAttrs）", () => {
    for (const key of Object.keys(MOVESETS) as (keyof typeof MOVESETS)[]) {
      const top = movesetMainAttrs(key, 2);
      expect(top.length, key).toBeLessThanOrEqual(2);
      expect(new Set(top).size, `${key} の重複`).toBe(top.length);
    }
  });

  it("属性耐性は部位の上限（resistLines）までしか付かない", () => {
    const rng = createRng(33);
    for (const key of ["hood", "chain", "plate", "sandals", "ironRing", "jadeAmulet", "dagger"]) {
      const base = mustBase(key);
      const limit = (INNATE.resistLines as Partial<Record<Slot, number>>)[base.slot] ?? 0;
      for (let i = 0; i < 500; i++) {
        const resists = rollInnate(rng, base, 30, 2, false).rolls.filter((r) => r.key.startsWith(RESIST_TRAIT_PREFIX));
        expect(resists.length, `${key} の耐性の数`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("generateItem は state.rng を 1 回だけ引く（地金を足しても消費数は変わらない）", () => {
    const a = createRng(123);
    const b = createRng(123);
    generateItem(a, { itemLevel: 12, foundDepth: 12, now: NOW, rarityBoost: 2 });
    b.int(0, 0xffffffff);
    expect(a.next(), "生成後の乱数の位置").toBe(b.next());
  });

  it("名のある遺物にも地金が付く（防具なら防御力）", () => {
    let named: Item | undefined;
    for (let seed = 1; seed < 200 && named === undefined; seed++) {
      const item = generateItem(createRng(seed), { itemLevel: 30, foundDepth: 30, now: NOW, rarityBoost: 5, slot: "armor" });
      if (item.namedKey !== undefined) named = item;
    }
    expect(named, "名のある遺物が出る").toBeDefined();
    expect(named?.innate?.some((r) => r.key === INNATE_ARMOR_KEY), "防御力").toBe(true);
  });
});

describe("地金の集計と表示", () => {
  const innate: AffixRoll[] = [
    { key: INNATE_ARMOR_KEY, value: 3, origin: "innate" },
    { key: "attr_str", value: 2, origin: "innate" },
    { key: "res_fire", value: 8, origin: "innate" },
  ];
  const armorItem: Item = {
    id: "innate-armor",
    seed: 1,
    baseKey: "chain",
    slot: "armor",
    rarity: "normal",
    itemLevel: 5,
    name: "鎖帷子",
    implicit: null,
    affixes: [],
    innate,
    foundDepth: 5,
    foundAt: NOW,
  };

  it("地金は computeStats に乗る（拾った深度では拾った時の値）", () => {
    const base = computeStats(createEmptyEquipment(), armorItem.itemLevel);
    const stats = computeStats({ ...createEmptyEquipment(), armor: armorItem }, armorItem.itemLevel);
    expect(stats.attributes.str - base.attributes.str, "筋力").toBe(2);
    expect(stats.resist.fire - base.resist.fire, "炎耐性").toBe(8);
    expect(stats.armor, "防御力").toBeGreaterThan(base.armor);
    expect(collectInnate({ ...createEmptyEquipment(), armor: armorItem }, armorItem.itemLevel)).toEqual(innate);
  });

  it("地金は色の配合・共鳴の語に数えない", () => {
    expect(relicKeywords(armorItem), "性質が無いので語なし").toEqual(emptyProfile());
    expect(itemColorBar(armorItem.affixes), "色の配合").toEqual([]);
  });

  it("innate の無い旧形式の遺物も集計できる", () => {
    const { innate: _dropped, ...legacy } = armorItem;
    expect(computeStats({ ...createEmptyEquipment(), armor: legacy }).attributes.str).toBe(computeStats(createEmptyEquipment()).attributes.str);
  });

  it("describeItem は地金の行を持つ", () => {
    expect(describeItem(armorItem).innate).toEqual(innateLines(armorItem));
    expect(innateLines(armorItem, armorItem.itemLevel).length).toBe(3);
    expect(innateLines({ slot: "armor", itemLevel: 1 })).toEqual([]);
  });
});

describe("持ち込み: 地金は今の深度で決め直す（innateAt）", () => {
  /** core-synthesis 3-1 の例: 深度 8 で拾った、筋力 6 割・体力 4 割・上振れ ×1.3 の遺物 */
  const carried: Item = {
    id: "innate-carried",
    seed: 2,
    baseKey: "dagger",
    slot: "mainHand",
    rarity: "normal",
    itemLevel: 8,
    name: "短剣",
    implicit: null,
    affixes: [],
    innate: [
      { key: `${ATTR_TRAIT_PREFIX}str`, value: 3, origin: "innate" },
      { key: `${ATTR_TRAIT_PREFIX}vit`, value: 2, origin: "innate" },
    ],
    innateLuck: 1.3,
    foundDepth: 8,
    foundAt: NOW,
  };

  function attrsAt(item: Item, depth: number): Partial<Record<AttrKey, number>> {
    const out: Partial<Record<AttrKey, number>> = {};
    for (const r of innateAt(item, depth)) {
      const a = attrOf(r);
      if (a !== undefined) out[a] = r.value;
    }
    return out;
  }

  it("深度 1 では小さく、深度 8 / 15 / 20 で 3-1 の例のとおり伸びる", () => {
    expect(attrsAt(carried, 1), "深度 1: 予算 1 点").toEqual({ str: 1 });
    expect(attrsAt(carried, 8), "深度 8: 筋力 +3・体力 +2").toEqual({ str: 3, vit: 2 });
    expect(attrsAt(carried, 15), "深度 15: 筋力 +5・体力 +3").toEqual({ str: 5, vit: 3 });
    expect(attrsAt(carried, 20), "深度 20: 筋力 +6・体力 +4").toEqual({ str: 6, vit: 4 });
  });

  it("computeStats は渡した深度で地金を畳む（既定は深度 1）", () => {
    const eq = { ...createEmptyEquipment(), mainHand: carried };
    const bare = computeStats({ ...createEmptyEquipment(), mainHand: { ...carried, innate: [] } }, 20);
    expect(computeStats(eq).attributes.str - bare.attributes.str, "既定の深度 1").toBe(1);
    expect(computeStats(eq, 20).attributes.str - bare.attributes.str, "深度 20").toBe(6);
    expect(computeStats(eq, 20).attributes.vit - bare.attributes.vit, "深度 20 の体力").toBe(4);
  });

  it("生成した遺物は、拾った深度では Item.innate と同じ行になる", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const level = 1 + (seed % 30);
      const item = gen(seed, { itemLevel: level, foundDepth: level, rarityBoost: seed % 4 });
      expect(innateAt(item, item.itemLevel), `seed ${seed} 深度 ${level}`).toEqual(item.innate);
    }
  });

  it("配分の比が保たれる（深い階でも項目は増えず、各項目の点は比 × 予算から 1 点未満しかずれない）", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const item = gen(seed, { itemLevel: 5, foundDepth: 5 });
      const base = mustBase(item.baseKey);
      // 防御力の枠に配った点も配分に数える（確定分は spentPoints が引く）
      const source = item.innate ?? [];
      const sourceTotal = spentPoints(base, source);
      if (sourceTotal === 0) continue;
      for (const depth of [12, 30]) {
        const rows = innateAt(item, depth);
        const total = Math.round(innateMeanBudget(depth) * innateLuckOf(item));
        for (const r of rows) expect(source.map((s) => s.key), `seed ${seed}: 新しい項目 ${r.key}`).toContain(r.key);
        for (const s of source) {
          const now = rows.find((r) => r.key === s.key);
          const expected = (spentPoints(base, [s]) / sourceTotal) * total;
          expect(Math.abs(spentPoints(base, now ? [now] : []) - expected), `seed ${seed} 深度 ${depth} ${s.key}`).toBeLessThan(1);
        }
      }
    }
  });

  it("防具の防御力は確定分を残し、配った点のぶんだけ深度で伸びる", () => {
    let armor: Item | undefined;
    for (let seed = 1; seed < 300 && armor === undefined; seed++) {
      const g = gen(seed, { slot: "armor", itemLevel: 10, foundDepth: 10 });
      const row = g.innate?.find((r) => r.key === INNATE_ARMOR_KEY);
      if (row !== undefined && row.value > INNATE.armor.base.armor) armor = g;
    }
    expect(armor, "防御力に点が配られた体の遺物").toBeDefined();
    if (armor === undefined) return;
    const armorAt = (d: number): number => innateAt(armor, d).find((r) => r.key === INNATE_ARMOR_KEY)?.value ?? 0;
    expect(armorAt(1), "深度 1 でも確定分は残る").toBeGreaterThanOrEqual(INNATE.armor.base.armor);
    expect(armorAt(25), "深度 25").toBeGreaterThan(armorAt(10));
  });

  it("上振れの無い旧アイテムは innate の点から復元し、拾った深度では同じ行になる", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const level = 1 + (seed % 20);
      const { innateLuck, ...legacy } = gen(seed, { itemLevel: level, foundDepth: level });
      const recovered = recoverInnateLuck(legacy);
      if ((legacy.innate ?? []).length > 0) {
        // 復元は整数に丸めた点からなので、丸めの半点ぶんまでずれてよい
        expect(Math.abs(recovered - (innateLuck ?? 0)), `seed ${seed}`).toBeLessThanOrEqual(0.5 / innateMeanBudget(level) + 1e-9);
      }
      expect(innateAt(legacy, level), `seed ${seed} の拾った深度`).toEqual(legacy.innate);
      expect(migrateItem(legacy).innateLuck, `seed ${seed} の migrateItem`).toBeCloseTo(recovered, 9);
    }
    expect(recoverInnateLuck({ slot: "armor", itemLevel: 5 }), "地金が無ければ既定").toBe(1);
  });

  it("壊れた上振れは行から復元する", () => {
    const broken = { ...carried, innateLuck: Number.NaN };
    expect(innateLuckOf(broken)).toBeCloseTo(5 / innateMeanBudget(8), 9);
    expect(innateLuckOf({ ...carried, innateLuck: -1 })).toBeCloseTo(5 / innateMeanBudget(8), 9);
  });

  it("rng を引かない純関数で、遺物を書き換えない", () => {
    const item = gen(40, { slot: "head", itemLevel: 6, foundDepth: 6 });
    const before = structuredClone(item);
    const a = innateAt(item, 25);
    const b = innateAt(item, 25);
    expect(a, "同じ入力で同じ行").toEqual(b);
    expect(item, "遺物はそのまま").toEqual(before);
    expect(innateAt.length, "rng を受け取らない").toBe(2);
  });

  it("階を降りると装備の地金が伸び、上り階段で戻ると縮む", () => {
    const profile = createEmptyProfile();
    profile.equipment.mainHand = carried;
    const state = createGame(7, "7", profile);
    const strAt = (): number => state.boonRun.baseStats?.attributes.str ?? 0;
    const atDepth1 = strAt();
    while (state.depth < 8) descend(state);
    expect(strAt() - atDepth1, "深度 8 は深度 1 より筋力 +2").toBe(2);
    ascend(state);
    expect(state.depth).toBe(7);
    expect(strAt(), "深度 7 は深度 8 以下").toBeLessThanOrEqual(atDepth1 + 2);
  });
});

describe("クラフトで地金は変わらない", () => {
  it("煽りの後も innate が同じ", () => {
    let item: Item | undefined;
    for (let seed = 1; seed < 200 && item === undefined; seed++) {
      const g = gen(seed, { slot: "armor", itemLevel: 15, foundDepth: 15 });
      if (g.affixes.length >= 2 && g.namedKey === undefined) item = g;
    }
    expect(item, "性質 2 つ以上の遺物").toBeDefined();
    if (item === undefined) return;
    const before = structuredClone(item.innate);
    const results = [stirTrait(item, 0, createRng(2))];
    for (const r of results) if (r !== null) expect(r.innate, "クラフト後の地金").toEqual(before);
  });
});

describe("旧セーブ", () => {
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
      return [...this.map.keys()][index] ?? null;
    }
    removeItem(key: string): void {
      this.map.delete(key);
    }
    setItem(key: string, value: string): void {
      this.map.set(key, value);
    }
  }

  it("head も innate も無い旧セーブが読め、頭は空・地金は空になる", () => {
    const legacy = gen(8, { slot: "armor" });
    const { innate: _dropped, ...raw } = legacy;
    const profile = createEmptyProfile();
    const { head: _head, ...equipment } = { ...profile.equipment, armor: raw };
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, equipment, stash: [raw] }));
    const loaded = loadProfile(storage);
    expect(loaded.equipment.head, "頭は空").toBeNull();
    expect(loaded.equipment.armor?.innate, "装備の地金").toEqual([]);
    expect(loaded.stash[0]?.innate, "倉庫の地金").toEqual([]);
  });

  it("地金を持つ遺物は保存して読み直しても同じ", () => {
    const item = gen(12, { slot: "head" });
    expect(item.innate?.length ?? 0, "地金がある").toBeGreaterThan(0);
    const profile = createEmptyProfile();
    profile.equipment.head = item;
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
    expect(loadProfile(storage).equipment.head?.innate).toEqual(item.innate);
    expect(loadProfile(storage).equipment.head?.innateLuck, "上振れも保存される").toBe(item.innateLuck);
  });

  it("migrateItem は innate を補い、冪等", () => {
    const { innate: _dropped, ...raw } = gen(3);
    const once = migrateItem(raw);
    expect(once.innate).toEqual([]);
    expect(migrateItem(once)).toEqual(once);
  });
});

describe("部位「頭」", () => {
  it("頭は SLOTS にあり、表示名は 頭 / 体 / 足", () => {
    expect(SLOTS).toContain("head");
    expect(LOOT_SLOTS).toContain("head");
    expect(SLOT_LABEL.head).toBe("頭");
    expect(SLOT_LABEL.armor).toBe("体");
    expect(SLOT_LABEL.boots).toBe("足");
  });

  it("頭のベースが 5 種以上あり、設計の 5 種がそろう", () => {
    const keys = BASES.filter((b) => b.slot === "head").map((b) => b.key);
    for (const k of ["hood", "leatherCap", "ironHelm", "circlet", "maskedVisor"]) expect(keys, k).toContain(k);
    expect(basesForSlot("head", 1).length, "深度 1 で出る頭").toBeGreaterThan(0);
  });

  it("頭の名のある遺物が 3 つある", () => {
    const heads = UNIQUES.filter((u) => baseDef(u.baseKey)?.slot === "head").map((u) => u.key);
    expect(heads).toEqual(expect.arrayContaining(["starReader", "jizo", "boneCrown"]));
  });

  it("頭の遺物が生成でき、性質も付く（体の性質を引く）", () => {
    let traits = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const item = gen(seed, { slot: "head", itemLevel: 12, foundDepth: 12 });
      expect(item.slot).toBe("head");
      expect(baseDef(item.baseKey)?.slot).toBe("head");
      traits += item.affixes.length;
    }
    expect(traits, "頭の性質").toBeGreaterThan(0);
  });
});
