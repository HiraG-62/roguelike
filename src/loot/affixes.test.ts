import { describe, expect, it } from "vitest";
import {
  AFFIXES,
  IMPLICITS,
  KEYSTONES,
  KEYSTONE_KEY_PREFIX,
  affixDef,
  affixDefForRoll,
  applyRoll,
  formatAffix,
  implicitDef,
  keystoneConflicts,
  keystoneDef,
  keystoneToRoll,
  resolveKeystones,
  traitsFor,
} from "./affixes";
import { affixColor } from "./colors";
import { BASES, baseDef, basesForSlot } from "./bases";
import { KS } from "../system/keystones";
import { DEFAULT_STATS, LOOT_SLOTS, TRAIT_COLORS, type PlayerStats } from "./types";

const MIN_AFFIX_COUNT = 60;
const MIN_TRADEOFF_COUNT = 13;
const MIN_KEYSTONE_COUNT = 6;
const MIN_TRAITS_PER_SLOT = 6;
const FIRST_LEVEL = 1;
const MIN_BASES_PER_SLOT = 8;

describe("アフィックス定義", () => {
  it(`${MIN_AFFIX_COUNT} 種以上ある`, () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(MIN_AFFIX_COUNT);
  });

  it("key が affix / implicit を通して重複しない", () => {
    const keys = [...AFFIXES.map((a) => a.key), ...IMPLICITS.map((i) => i.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全 def の期待値曲線が空でなく、各点で min≤max（2 値も）", () => {
    for (const def of AFFIXES) {
      expect(def.curve.length, def.key).toBeGreaterThan(0);
      for (const point of def.curve) {
        expect(point.min, def.key).toBeLessThanOrEqual(point.max);
        if (point.min2 !== undefined || point.max2 !== undefined) {
          expect(point.min2, def.key).toBeDefined();
          expect(point.max2, def.key).toBeDefined();
          expect(point.min2 ?? 0, def.key).toBeLessThanOrEqual(point.max2 ?? 0);
        }
      }
    }
  });

  it("2 値ラベルを持つ def は曲線の全点に value2 の幅がある", () => {
    for (const def of AFFIXES) {
      if (!def.label.includes("{v2}")) continue;
      for (const point of def.curve) expect(point.min2, def.key).toBeDefined();
    }
  });

  it(`各スロットで深度 1 から ${MIN_TRAITS_PER_SLOT} 種以上抽選できる`, () => {
    for (const slot of LOOT_SLOTS) {
      expect(traitsFor(slot, FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(MIN_TRAITS_PER_SLOT);
    }
  });

  it("affixDef で引ける。prefix / suffix の区別は無い", () => {
    const def = affixDef("meleeDamagePct");
    expect(def).toBeDefined();
    expect(def && "kind" in def).toBe(false);
    expect(affixDef("does-not-exist")).toBeUndefined();
  });

  it("全 def に色があり、5 色のどれか。紅 / 蒼 / 翠 / 金 がそれぞれ 5 種以上、冥も 1 種以上", () => {
    const counts = new Map<string, number>();
    for (const def of AFFIXES) {
      const color = affixColor(def);
      expect(TRAIT_COLORS, def.key).toContain(color);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    for (const c of ["crimson", "azure", "jade", "gold"]) expect(counts.get(c) ?? 0, c).toBeGreaterThanOrEqual(5);
    expect(counts.get("umbra") ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("色の意味: 近接は紅 / 射撃・機動・冷気は蒼 / 生存は翠 / 会心・コンボは金", () => {
    const colorOf = (key: string): string | undefined => {
      const def = affixDef(key);
      return def === undefined ? undefined : affixColor(def);
    };
    expect(colorOf("meleeDamagePct")).toBe("crimson");
    expect(colorOf("rangedDamagePct")).toBe("azure");
    expect(colorOf("moveSpeed")).toBe("azure");
    expect(colorOf("chill")).toBe("azure");
    expect(colorOf("maxLife")).toBe("jade");
    expect(colorOf("critChance")).toBe("gold");
    expect(colorOf("comboWindow")).toBe("gold");
  });

  it("formatAffix が 1 値 / 2 値 / 小数 / implicit を整形する", () => {
    expect(formatAffix({ key: "meleeDamagePct", kind: "prefix", tier: 1, value: 25 })).toBe(
      "近接ダメージ +25%",
    );
    expect(formatAffix({ key: "burn", kind: "prefix", tier: 2, value: 12, value2: 9 })).toBe(
      "12%の確率で炎上（9ダメージ/秒）",
    );
    expect(formatAffix({ key: "hpRegen", kind: "suffix", tier: 3, value: 1.5 })).toBe(
      "生命自然回復 +1.5/秒（敵が近くにいない間）",
    );
    expect(formatAffix({ key: "implicit.shortsword", kind: "prefix", tier: 1, value: 10 })).toBe(
      "近接ダメージ +10%",
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
    expect(formatAffix(roll)).toBe("近接ダメージ +60%、攻撃速度 -12%");
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

  it("誓約（旧キーストーン）の AffixRoll は value 0・色は冥で保存され、formatAffix は【誓約】形式", () => {
    const def = keystoneDef("ks_glassCannon");
    expect(def).toBeDefined();
    if (def === undefined) return;
    const roll = keystoneToRoll(def);
    expect(roll).toEqual({ key: "ks_glassCannon", value: 0, color: "umbra" });
    expect(affixDefForRoll(roll)?.source).toBe("keystone");
    expect(formatAffix(roll)).toBe(`【誓約】${def.name}: ${def.description}`);
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
    expect(formatAffix(roll)).toBe("見切り時: 40% で衝撃波を放つ（25 ダメージ）");
  });

  it("不正な key は undefined", () => {
    expect(affixDefForRoll({ key: "tr:bogus:always:heal", kind: "prefix", tier: 1, value: 1 })).toBeUndefined();
    expect(affixDefForRoll({ key: "nothing", kind: "prefix", tier: 1, value: 1 })).toBeUndefined();
  });
});

describe("ベースアイテム定義", () => {
  it("各スロットに 8 種以上あり、ilvl 1 で最低 1 種出る", () => {
    for (const slot of LOOT_SLOTS) {
      const count = BASES.filter((b) => b.slot === slot).length;
      expect(count, slot).toBeGreaterThanOrEqual(MIN_BASES_PER_SLOT);
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
    expect(baseDef("greatsword")?.slot).toBe("mainHand");
    expect(baseDef("nope")).toBeUndefined();
  });
});

describe("マナの性質", () => {
  const fresh = (): PlayerStats => ({ ...DEFAULT_STATS, keystones: [], triggers: [], statusProcs: [] });

  it("各性質が対応する stat を動かす", () => {
    const s = fresh();
    applyRoll(s, { key: "maxManaFlat", value: 10 });
    applyRoll(s, { key: "manaRegenFlat", value: 0.5 });
    applyRoll(s, { key: "manaGainPct", value: 20 });
    applyRoll(s, { key: "manaOnKillFlat", value: 3 });
    expect(s.maxMana, "最大マナ").toBe(DEFAULT_STATS.maxMana + 10);
    expect(s.manaRegen, "マナ自然回復").toBeCloseTo(DEFAULT_STATS.manaRegen + 0.5);
    expect(s.manaGainMul, "マナ回収").toBeCloseTo(1.2);
    expect(s.manaOnKill, "撃破でマナ").toBe(3);
  });

  it("スキルのコスト −% は代償としてスキル威力も下げる", () => {
    const s = fresh();
    applyRoll(s, { key: "manaCostPct", value: 20, value2: 10 });
    expect(s.manaCostMul).toBeCloseTo(0.8);
    expect(s.skillDamageMul).toBeCloseTo(0.9);
    expect(formatAffix({ key: "manaCostPct", value: 20, value2: 10 })).toBe("スキルのコスト -20%、スキル威力 -10%");
  });

  it("気力自然回復は小数 1 桁で表示する", () => {
    expect(formatAffix({ key: "manaRegenFlat", value: 0.3 })).toBe("気力自然回復 +0.3/秒");
  });

  it("mana タグの性質は蒼、代償付きでも蒼", () => {
    for (const key of ["maxManaFlat", "manaRegenFlat", "manaGainPct", "manaCostPct", "manaOnKillFlat", "manaDrought"]) {
      const def = affixDef(key);
      expect(def, key).toBeDefined();
      if (def === undefined) continue;
      expect(def.tags, key).toContain("mana");
      expect(def.tags, key).toContain("skill");
      expect(affixColor(def), key).toBe("azure");
    }
  });

  it("深度 1 の最大マナは +6〜10、深度 26 は +30 前後", () => {
    const def = affixDef("maxManaFlat");
    const shallow = def?.curve.find((p) => p.depth === 1);
    const deep = def?.curve.find((p) => p.depth === 26);
    expect(shallow?.min).toBe(6);
    expect(shallow?.max).toBe(10);
    expect(((deep?.min ?? 0) + (deep?.max ?? 0)) / 2).toBe(30);
  });

  it("渇きの誓約は静寂の誓いと排他（mana グループ）", () => {
    expect(keystoneDef(KS.thirst)?.exclusiveGroup).toBe("mana");
    expect(resolveKeystones([KS.silentVow, KS.thirst])).toEqual([KS.thirst]);
  });
});
