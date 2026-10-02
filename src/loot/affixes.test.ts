import { createIncreased } from "../core/damage";
import { describe, expect, it } from "vitest";
import {
  AFFIXES,
  CONVERSION_AFFIXES,
  IMPLICITS,
  INNATE_LINE_DEFS,
  KEYSTONES,
  KEYSTONE_KEY_PREFIX,
  PROVENANCE_TRAIT_KEYS,
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
  type AffixDef,
} from "./affixes";
import { affixColor } from "./colors";
import { BASES, baseDef, basesForSlot } from "./bases";
import { nominalAt } from "./flux";
import { KS } from "../system/keystones";
import { KEYSTONE } from "../data/tuning";
import { DEFAULT_STATS, LOOT_SLOTS, TRAIT_COLORS, type AffixRoll, type PlayerStats } from "./types";

const MIN_TRADEOFF_COUNT = 13;
const MIN_TRAITS_PER_SLOT = 6;
const FIRST_LEVEL = 1;
const MIN_BASES_PER_SLOT = 8;
/** 期待値で振るときの深度 */
const SAMPLE_DEPTH = 10;
/** 抽選に出ないことを確かめる深い深度 */
const DEEP = 30;

/** 条件の族 25（docs/ideas/relics-7d-plan.md 1-2） */
const CONDITION_KEYS = [
  "damageVsStaggered",
  "guardedBane",
  "readAhead",
  "kaleidoscope",
  "brandDetonator",
  "conductor",
  "terrainHunter",
  "prismEdge",
  "downHunter",
  "fullTide",
  "desperation",
  "moraleSurge",
  "fever",
  "lockdownFury",
  "groundRooted",
  "finisherEdge",
  "releaseEdge",
  "riposteEdge",
  "twinEdge",
  "firstStrikeEdge",
  "branchArt",
  "chargeCore",
  "comboDamage",
  "justDodgeDamage",
  "purse",
];

/** 性質の数（条件の族 25 + 行動 43 + 来歴 3）・転じ 12 + 属性の変換 6・誓約 */
const AFFIX_COUNT = 71;
const CONVERSION_COUNT = 18;
const KEYSTONE_COUNT = 20;
const BEHAVIOR_COUNT = 43;

/** 深度 SAMPLE_DEPTH の期待値で振った性質（反転なし） */
function nominalRoll(def: AffixDef): AffixRoll {
  const n = nominalAt(def, SAMPLE_DEPTH);
  const roll: AffixRoll = { key: def.key, value: n.nominal };
  if (n.nominal2 !== undefined) roll.value2 = n.nominal2;
  return roll;
}

/** 空の stats（配列・表を共有しない） */
function freshStats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    keystones: [],
    triggers: [],
    statusProcs: [],
    modifiers: [],
    rules: [],
    increased: createIncreased(),
    more: [],
    attributes: { ...DEFAULT_STATS.attributes },
    resist: { ...DEFAULT_STATS.resist },
    infuse: { ...DEFAULT_STATS.infuse },
    traits: { ...DEFAULT_STATS.traits },
    statusStackCapBonus: {},
  };
}

/**
 * 性質が上げてよい基礎の欄（源・ルールの欄）。これ以外の数値の欄を良い向きに動かしたら「無条件に数値を上げる」性質。
 * traits.*（ルール変更の欄）・statusProcs・triggers・rules・条件付きの modifiers は行動・条件の族の欄なので見ない
 */
const SOURCE_FIELDS: ReadonlySet<string> = new Set([
  "burnChance",
  "burnDps",
  "chillChance",
  "chillSlow",
  "shockChance",
  "shockDamage",
  "explodeOnKillChance",
  "explodeDamage",
  "bulletCut",
  "chainCoefBonus",
  "chainRevisits",
  "moraleMaxAdd",
]);
/** 小さいほど良い欄（代償で上がるのは「悪くなる」向き） */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["dashCooldownMul", "manaCostMul", "damageTakenMul", "statusTakenMul"]);
/** 条件付きの増のタグ（怯み中・ボス・精鋭・放出）。それ以外のタグの増は無条件 */
const CONDITIONAL_TAGS: ReadonlySet<string> = new Set(["vsStaggered", "vsBoss", "vsElite", "release"]);

/** 基礎の数値の欄で良い向きに動いたもの */
function numericGains(before: PlayerStats, after: PlayerStats): string[] {
  const prevTable = before as unknown as Readonly<Record<string, unknown>>;
  const gains: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    const prev = prevTable[key];
    if (typeof value !== "number" || typeof prev !== "number" || SOURCE_FIELDS.has(key)) continue;
    const better = LOWER_IS_BETTER.has(key) ? value < prev : value > prev;
    if (better) gains.push(key);
  }
  return gains;
}

/** 表（増・ステータス・耐性）と倍・条件の無い Modifier で良くなったもの */
function tableGains(before: PlayerStats, after: PlayerStats): string[] {
  const gains: string[] = [];
  for (const tag of Object.keys(after.increased) as (keyof PlayerStats["increased"])[]) {
    if (!CONDITIONAL_TAGS.has(tag) && after.increased[tag] > before.increased[tag]) gains.push(`increased.${tag}`);
  }
  for (const k of Object.keys(after.attributes) as (keyof PlayerStats["attributes"])[]) {
    if (after.attributes[k] > before.attributes[k]) gains.push(`attributes.${k}`);
  }
  for (const e of Object.keys(after.resist) as (keyof PlayerStats["resist"])[]) {
    if (after.resist[e] > before.resist[e]) gains.push(`resist.${e}`);
  }
  if (after.more.length > 0) gains.push("more");
  for (const m of after.modifiers) if (m.if.length === 0 && m.per === undefined) gains.push(`modifier:${m.id}`);
  return gains;
}

/** 性質を 1 つ当てて、無条件に良くなった欄の名前を返す */
function unconditionalGains(def: AffixDef): string[] {
  const before = freshStats();
  const after = freshStats();
  applyRoll(after, nominalRoll(def));
  return [...numericGains(before, after), ...tableGains(before, after)];
}

describe("性質 71（段取り 7d）", () => {
  it(`性質 ${AFFIX_COUNT}・転じと属性の変換 ${CONVERSION_COUNT}・誓約 ${KEYSTONE_COUNT}`, () => {
    expect(AFFIXES.length, "性質").toBe(AFFIX_COUNT);
    expect(CONVERSION_AFFIXES.length, "転じ + 属性の変換").toBe(CONVERSION_COUNT);
    expect(KEYSTONES.length, "誓約").toBe(KEYSTONE_COUNT);
  });

  it("無条件に数値を上げない（来歴を除く。代償は基礎の欄を下げる向きだけ）", () => {
    for (const def of AFFIXES) {
      if (PROVENANCE_TRAIT_KEYS.has(def.key)) continue;
      expect(unconditionalGains(def), def.key).toEqual([]);
    }
  });

  it("全性質（転じ・属性の変換を含む）が keywords を持つ", () => {
    for (const def of [...AFFIXES, ...CONVERSION_AFFIXES]) expect(def.keywords, def.key).toBeDefined();
  });

  it("条件の族は condition タグを持ち、代償（tradeoff）を持たない。それ以外の性質は condition タグを持たない", () => {
    const tagged = AFFIXES.filter((d) => d.tags.includes("condition")).map((d) => d.key);
    expect(new Set(tagged)).toEqual(new Set(CONDITION_KEYS));
    for (const key of CONDITION_KEYS) expect(affixDef(key)?.tags, key).not.toContain("tradeoff");
    expect(AFFIXES.length - CONDITION_KEYS.length - PROVENANCE_TRAIT_KEYS.size, "行動").toBe(BEHAVIOR_COUNT);
  });

  it("新しい行動の性質は対応する欄を動かす（連鎖・戦意・燃焼の重ね・構え・踏ん張り）", () => {
    const s = freshStats();
    applyRoll(s, { key: "chainSource", value: 20 });
    applyRoll(s, { key: "chainReturn", value: 1 });
    applyRoll(s, { key: "moraleCap", value: 10 });
    applyRoll(s, { key: "burnStack", value: 2 });
    applyRoll(s, { key: "stanceGuard", value: 15 });
    applyRoll(s, { key: "unmoving", value: 10 });
    expect(s.chainCoefBonus).toBeCloseTo(0.2);
    expect(s.chainRevisits).toBe(1);
    expect(s.moraleMaxAdd).toBe(10);
    expect(s.statusStackCapBonus.burn).toBe(2);
    expect(s.traits.stanceGuard).toBeCloseTo(0.15);
    expect(s.traits.unmoving).toBeCloseTo(0.1);
  });

  it("目覚め専用の性質は無い", () => {
    expect(AFFIXES.filter((d) => d.awakening === true)).toEqual([]);
  });

  it("地金の行（ステータス・耐性・防御力）は affixDef で引けるが、抽選の表には無い", () => {
    for (const def of INNATE_LINE_DEFS) {
      expect(affixDef(def.key), def.key).toBe(def);
      expect(AFFIXES, def.key).not.toContain(def);
      for (const slot of LOOT_SLOTS) expect(traitsFor(slot, DEEP), `${slot}/${def.key}`).not.toContain(def);
    }
  });
});

describe("アフィックス定義", () => {
  it("key が affix / 変換 / 地金の行 / implicit を通して重複しない", () => {
    const keys = [...AFFIXES, ...CONVERSION_AFFIXES, ...INNATE_LINE_DEFS].map((a) => a.key).concat(IMPLICITS.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全 def の期待値曲線が空でなく、各点で min≤max（2 値も）", () => {
    for (const def of [...AFFIXES, ...CONVERSION_AFFIXES]) {
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

  it("2 値ラベルを持つ def は曲線の全点に value2 の幅があり、1 値ラベルは value2 を持たない", () => {
    for (const def of [...AFFIXES, ...CONVERSION_AFFIXES]) {
      const two = def.label.includes("{v2}");
      for (const point of def.curve) expect(point.min2 !== undefined, def.key).toBe(two);
    }
  });

  it(`各スロットで深度 1 から ${MIN_TRAITS_PER_SLOT} 種以上抽選できる`, () => {
    for (const slot of LOOT_SLOTS) {
      expect(traitsFor(slot, FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(MIN_TRAITS_PER_SLOT);
    }
  });

  it("affixDef で引ける。prefix / suffix の区別は無い", () => {
    const def = affixDef("damageVsStaggered");
    expect(def).toBeDefined();
    expect(def && "kind" in def).toBe(false);
    expect(affixDef("does-not-exist")).toBeUndefined();
    expect(affixDef("meleeDamagePct"), "消えた性質").toBeUndefined();
  });

  it("全 def に色があり、5 色のどれか。紅 / 蒼 / 翠 / 金 / 冥 がそれぞれ 5 種以上", () => {
    const counts = new Map<string, number>();
    for (const def of AFFIXES) {
      const color = affixColor(def);
      expect(TRAIT_COLORS, def.key).toContain(color);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    for (const c of TRAIT_COLORS) expect(counts.get(c) ?? 0, c).toBeGreaterThanOrEqual(5);
  });

  it("formatAffix が 1 値 / 2 値 / 小数 / implicit を整形する", () => {
    expect(formatAffix({ key: "damageVsStaggered", kind: "prefix", tier: 1, value: 25 })).toBe("怯み中の敵へのダメージ +25%");
    expect(formatAffix({ key: "burn", kind: "prefix", tier: 2, value: 12, value2: 9 })).toBe("12%の確率で炎上（9ダメージ/秒）");
    expect(formatAffix({ key: "switchBreath", kind: "suffix", tier: 3, value: 1.5 })).toBe(
      "手替えの呼吸: 直前と違う攻撃手段（近接・射撃・スキル）で当てるたびに気力 +1.5",
    );
    expect(formatAffix({ key: "implicit.shortsword", kind: "prefix", tier: 1, value: 10 })).toBe("近接ダメージ +10%");
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
    const roll = { key: "rotBurst", kind: "prefix" as const, tier: 1, value: 20, value2: 6 };
    expect(formatAffix(roll)).toBe("腐爆: 状態異常が 2 種以上の敵への近接命中で爆発する（20 ダメージ）、近接ダメージ -6%");
    const stats = freshStats();
    applyRoll(stats, roll);
    expect(stats.triggers.map((t) => t.magnitude)).toEqual([20]);
    expect(stats.increased.melee).toBeCloseTo(-0.06);
  });

  it("見切りの息吹は見切りとカウンター（受け流し・出端）の両方で気力を戻す", () => {
    const stats = freshStats();
    applyRoll(stats, { key: "justBreath", kind: "prefix", tier: 1, value: 6, value2: 10 });
    const restores = stats.triggers.filter((t) => t.effect === "restoreMana");
    expect(restores.map((t) => t.trigger).sort()).toEqual(["onCounter", "onJustDodge"]);
    for (const t of restores) expect(t.magnitude).toBe(6);
  });
});

describe("キーストーン", () => {
  it(`${KEYSTONE_COUNT} 種あり、key が ks_ 始まりで一意、排他グループを持つ`, () => {
    expect(KEYSTONES.length).toBe(KEYSTONE_COUNT);
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
    const stats = freshStats();
    applyRoll(stats, { key: "ks_pacifist", kind: "suffix", tier: 1, value: 0 });
    expect(stats.keystones).toEqual(["ks_pacifist"]);
    expect(stats.poiseDamageMul).toBeCloseTo(DEFAULT_STATS.poiseDamageMul * KEYSTONE.pacifistPoiseMul);
  });

  it("resolveKeystones は同グループ後勝ち・重複と未知 key を除去（勝者の出現順）", () => {
    expect(resolveKeystones(["ks_glassCannon", "ks_blink", "ks_vampire", "ks_blink", "ks_nope"])).toEqual(["ks_vampire", "ks_blink"]);
  });

  it("戦闘側と合意した key が指定の排他グループで定義されている", () => {
    const agreed: Record<string, string> = {
      ks_glassCannon: "body",
      ks_vampire: "body",
      ks_gambler: "tempo",
      ks_overclock: "tempo",
      ks_mushin: "tempo",
      ks_instant: "tempo",
      ks_blink: "style",
      ks_pacifist: "style",
      ks_farOath: "style",
      ks_poverty: "coin",
      ks_goldCage: "coin",
      ks_alms: "coin",
    };
    for (const [key, group] of Object.entries(agreed)) {
      expect(keystoneDef(key)?.exclusiveGroup, key).toBe(group);
    }
  });

  it("戦闘側（src/system/keystones.ts の KS）が参照する key が全て定義されている", () => {
    for (const key of Object.values(KS)) expect(keystoneDef(key), key).toBeDefined();
    expect(Object.values(KS).length, "KS は誓約と同じ数").toBe(KEYSTONES.length);
  });

  it("keystoneConflicts は衝突グループだけを返す", () => {
    const conflicts = keystoneConflicts(["ks_glassCannon", "ks_vampire", "ks_gambler"]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.map((k) => k.key)).toEqual(["ks_glassCannon", "ks_vampire"]);
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
