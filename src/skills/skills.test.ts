import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { PROFILE_KEY } from "../loot/profile";
import {
  BODY_SKILL_KEYS,
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  SKILL_MIN_DEPTH,
  SKILL_WEIGHTS,
  activeModifiers,
  canAttach,
  castBurden,
  castInterval,
  formatVariant,
  modifierLinkCost,
  modifierVerb,
  resolveCast,
} from "./data";
import { generateSkillStone, makeRuneItem, rollRuneDrop, rollRuneModifier, runeDropChance, stoneFromSeed } from "./generator";
import {
  SKILL_PROFILE_KEY,
  addStone,
  createDefaultSkillProfile,
  equipStone,
  loadSkillProfile,
  salvageStone,
  saveSkillProfile,
} from "./persistence";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillResource, type SkillStone } from "./types";

/** テスト用の最小 Storage */
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function stone(skillKey: SkillKey, links: number, overrides: Partial<SkillStone> = {}): SkillStone {
  return { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey }), variants: [], links, ...overrides };
}

const SAMPLE_COUNT = 300;

describe("スキル石の生成", () => {
  it("同じ seed なら同じ石になる（決定性）", () => {
    const a = generateSkillStone(createRng(42), { foundDepth: 3, now: 1000 });
    const b = generateSkillStone(createRng(42), { foundDepth: 3, now: 1000 });
    expect(a).toEqual(b);
  });

  it("リンクは 0..3、変異軸はスキルが許す軸から重複なしで 0..2 本、値は -1..1", () => {
    const rng = createRng(7);
    const seenLinks = new Set<number>();
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = generateSkillStone(rng, { foundDepth: 1, now: 0 });
      seenLinks.add(s.links);
      expect(s.links).toBeGreaterThanOrEqual(0);
      expect(s.links).toBeLessThanOrEqual(SKILL.maxLinks);
      expect(s.variants.length).toBeLessThanOrEqual(2);
      const axes = s.variants.map((v) => v.axis);
      expect(new Set(axes).size).toBe(axes.length);
      for (const v of s.variants) {
        expect(SKILL_DEFS[s.skillKey].axes).toContain(v.axis);
        expect(Math.abs(v.value)).toBeLessThanOrEqual(1);
        expect(v.value).not.toBe(0);
      }
    }
    expect(seenLinks.size).toBeGreaterThanOrEqual(3);
  });

  it("刻印符は装着中スキルに付けられるものだけから選ぶ", () => {
    const rng = createRng(3);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const key = rollRuneModifier(rng, ["parry", "bloodPact"]);
      expect(key).not.toBe("echo");
    }
  });
});

/**
 * docs/COMBAT_DESIGN.md B-4 の表: 型・コスト（CD 型は CD）・最低間隔・怯み値。
 * マナ型のコストは QA 2026-09-23 の 2 巡目調整で一律 -15%（src/skills/data.ts SKILL 冒頭のコメント参照）
 */
const B4_TABLE: Record<SkillKey, { resource: SkillResource; cost: number; cooldown: number; interval: number; poise: number }> = {
  whirl: { resource: "mana", cost: 13.0, cooldown: 0, interval: 0.6, poise: 6 },
  lunge: { resource: "cooldown", cost: 0, cooldown: 3, interval: 0.3, poise: 20 },
  frag: { resource: "mana", cost: 15.9, cooldown: 0, interval: 0.5, poise: 30 },
  railshot: { resource: "mana", cost: 18.1, cooldown: 0, interval: 0.8, poise: 25 },
  parry: { resource: "cooldown", cost: 0, cooldown: 3.5, interval: 0.3, poise: 40 },
  bloodPact: { resource: "cooldown", cost: 0, cooldown: 12, interval: 0.3, poise: 0 },
  quake: { resource: "mana", cost: 20.4, cooldown: 0, interval: 0.6, poise: 45 },
  thunder: { resource: "mana", cost: 17, cooldown: 0, interval: 0.5, poise: 15 },
  gravityWell: { resource: "mana", cost: 25.5, cooldown: 0, interval: 1, poise: 20 },
  mines: { resource: "mana", cost: 10.2, cooldown: 0, interval: 0.3, poise: 25 },
  haste: { resource: "cooldown", cost: 0, cooldown: 11, interval: 0.3, poise: 0 },
  chainHook: { resource: "mana", cost: 11.9, cooldown: 0, interval: 0.5, poise: 15 },
  spiral: { resource: "mana", cost: 23.8, cooldown: 0, interval: 1.1, poise: 2 },
  frostField: { resource: "mana", cost: 22.1, cooldown: 0, interval: 0.8, poise: 0 },
  // 大拡張（docs/ideas/skills-expansion.md 1 章。満月の砲と枯渇の刃の実コストは発動時に決まる）
  contagion: { resource: "mana", cost: 14, cooldown: 0, interval: 0.6, poise: 0 },
  unravel: { resource: "mana", cost: 16, cooldown: 0, interval: 0.6, poise: 8 },
  kindle: { resource: "mana", cost: 14, cooldown: 0, interval: 0.6, poise: 10 },
  prismShard: { resource: "mana", cost: 12, cooldown: 0, interval: 0.5, poise: 8 },
  fullMoon: { resource: "mana", cost: 80, cooldown: 0, interval: 1, poise: 40 },
  dregsBlade: { resource: "mana", cost: 0, cooldown: 0, interval: 0.6, poise: 8 },
  shadowStep: { resource: "mana", cost: 10, cooldown: 0, interval: 0.5, poise: 0 },
  powderKeg: { resource: "mana", cost: 12, cooldown: 0, interval: 0.4, poise: 35 },
  swordGrave: { resource: "mana", cost: 16, cooldown: 0, interval: 0.5, poise: 12 },
  iceBreaker: { resource: "mana", cost: 16, cooldown: 0, interval: 0.6, poise: 35 },
  bloodlet: { resource: "mana", cost: 12, cooldown: 0, interval: 0.6, poise: 5 },
  harvest: { resource: "mana", cost: 14, cooldown: 0, interval: 0.5, poise: 6 },
  discharge: { resource: "mana", cost: 18, cooldown: 0, interval: 0.8, poise: 15 },
  rout: { resource: "mana", cost: 10, cooldown: 0, interval: 0.4, poise: 6 },
  verdict: { resource: "mana", cost: 18, cooldown: 0, interval: 0.7, poise: 35 },
  exploit: { resource: "mana", cost: 12, cooldown: 0, interval: 0.5, poise: 20 },
  strip: { resource: "mana", cost: 12, cooldown: 0, interval: 0.5, poise: 6 },
  lastStand: { resource: "mana", cost: 16, cooldown: 0, interval: 0.7, poise: 30 },
  comboChain: { resource: "mana", cost: 14, cooldown: 0, interval: 0.6, poise: 6 },
  grudge: { resource: "mana", cost: 16, cooldown: 0, interval: 0.7, poise: 5 },
  guillotine: { resource: "mana", cost: 18, cooldown: 0, interval: 0.7, poise: 35 },
  ricochet: { resource: "mana", cost: 12, cooldown: 0, interval: 0.5, poise: 10 },
  galeSlash: { resource: "mana", cost: 12, cooldown: 0, interval: 0.5, poise: 12 },
  scatterSigil: { resource: "mana", cost: 14, cooldown: 0, interval: 0.6, poise: 4 },
  stomp: { resource: "mana", cost: 14, cooldown: 0, interval: 0.8, poise: 40 },
  threadReel: { resource: "mana", cost: 14, cooldown: 0, interval: 0.7, poise: 8 },
  meteorDive: { resource: "mana", cost: 22, cooldown: 0, interval: 1, poise: 45 },
  swallowFlip: { resource: "cooldown", cost: 0, cooldown: 5, interval: 0.3, poise: 15 },
  boneRing: { resource: "cooldown", cost: 0, cooldown: 10, interval: 0.3, poise: 0 },
  backflow: { resource: "cooldown", cost: 0, cooldown: 12, interval: 0.3, poise: 5 },
  scarRoar: { resource: "cooldown", cost: 0, cooldown: 10, interval: 0.3, poise: 10 },
  manaSpring: { resource: "cooldown", cost: 0, cooldown: 14, interval: 0.3, poise: 0 },
  turret: { resource: "mana", cost: 18, cooldown: 0, interval: 0.6, poise: 3 },
  // 第 2 弾（地形・新しい状態異常・属性・武器種・変身・空間）
  waterJar: { resource: "mana", cost: 14, cooldown: 0, interval: 0.5, poise: 5 },
  oilPot: { resource: "mana", cost: 13, cooldown: 0, interval: 0.5, poise: 4 },
  scorchLine: { resource: "mana", cost: 19, cooldown: 0, interval: 0.7, poise: 10 },
  iceSlide: { resource: "cooldown", cost: 0, cooldown: 7, interval: 0.3, poise: 12 },
  levelGround: { resource: "mana", cost: 19, cooldown: 0, interval: 0.7, poise: 30 },
  emberDraw: { resource: "mana", cost: 15, cooldown: 0, interval: 0.5, poise: 8 },
  bogCall: { resource: "mana", cost: 20, cooldown: 0, interval: 0.8, poise: 0 },
  mire: { resource: "mana", cost: 18, cooldown: 0, interval: 0.8, poise: 0 },
  brandSear: { resource: "mana", cost: 14, cooldown: 0, interval: 0.5, poise: 10 },
  brandBlast: { resource: "mana", cost: 18, cooldown: 0, interval: 0.6, poise: 10 },
  breakKick: { resource: "mana", cost: 13, cooldown: 0, interval: 0.5, poise: 28 },
  collapseHammer: { resource: "mana", cost: 19, cooldown: 0, interval: 0.7, poise: 35 },
  tideSlash: { resource: "mana", cost: 14, cooldown: 0, interval: 0.5, poise: 10 },
  flashFreeze: { resource: "mana", cost: 19, cooldown: 0, interval: 0.7, poise: 15 },
  hueEtch: { resource: "mana", cost: 15, cooldown: 0, interval: 0.5, poise: 8 },
  hueRelease: { resource: "mana", cost: 18, cooldown: 0, interval: 0.6, poise: 12 },
  siphonMark: { resource: "mana", cost: 11, cooldown: 0, interval: 0.5, poise: 4 },
  doomSentence: { resource: "mana", cost: 18, cooldown: 0, interval: 0.8, poise: 6 },
  shiftingEdge: { resource: "mana", cost: 15, cooldown: 0, interval: 0.5, poise: 10 },
  weaponArt: { resource: "mana", cost: 22, cooldown: 0, interval: 0.8, poise: 25 },
  titanForm: { resource: "cooldown", cost: 0, cooldown: 18, interval: 0.3, poise: 30 },
  swiftForm: { resource: "cooldown", cost: 0, cooldown: 16, interval: 0.3, poise: 12 },
  spiritForm: { resource: "cooldown", cost: 0, cooldown: 16, interval: 0.3, poise: 15 },
  wardStake: { resource: "mana", cost: 15, cooldown: 0, interval: 0.4, poise: 3 },
  // 第 3 弾の変身（砲身化は 1 発ぶん、業火の化身は最初の 1 秒ぶんを発動で払う）
  wolfForm: { resource: "cooldown", cost: 0, cooldown: 18, interval: 0.3, poise: 15 },
  wraithForm: { resource: "cooldown", cost: 0, cooldown: 15, interval: 0.3, poise: 0 },
  siegeForm: { resource: "mana", cost: 8, cooldown: 0, interval: 0.3, poise: 30 },
  ironForm: { resource: "cooldown", cost: 0, cooldown: 16, interval: 0.3, poise: 40 },
  pyreForm: { resource: "mana", cost: 6, cooldown: 0, interval: 0.3, poise: 0 },
};

describe("スキルの分類（マナ型 / CD 型）", () => {
  it("マナ型 60 / CD 型 16（大拡張でマナ型 +28・CD 型 +5、第 2 弾でマナ型 +19・CD 型 +4、第 3 弾の変身でマナ型 +2・CD 型 +3、第 4 弾の泥沼でマナ型 +1）", () => {
    const mana = SKILL_KEYS.filter((k) => SKILL_DEFS[k].resource === "mana");
    expect(mana, "マナ型の数").toHaveLength(60);
    expect(SKILL_KEYS.length - mana.length, "CD 型の数").toBe(16);
  });

  it.each(SKILL_KEYS)("%s: 型・コスト・CD・最低間隔・怯み値が B-4 の表どおり", (key) => {
    const def = SKILL_DEFS[key];
    const row = B4_TABLE[key];
    const burden = castBurden(def, resolveCast(def, stone(key, 0), []));
    expect(def.resource, "型").toBe(row.resource);
    expect(burden.cost, "コスト").toBeCloseTo(row.cost);
    expect(burden.cooldown, "CD").toBeCloseTo(row.cooldown);
    expect(def.minInterval, "最低間隔").toBeCloseTo(row.interval);
    expect(def.poise, "怯み値").toBe(row.poise);
    if (row.resource === "mana") expect(def.charges, "マナ型はチャージを使わない").toBe(1);
  });

  it("付与: 既存 9 種と第 2 弾（濡れ・油膜・燃焼・冷気・毒・烙印・崩勢・彩痕・吸魔・宣告）の表どおり。他は付与なし", () => {
    const kinds = (key: SkillKey): string[] => (SKILL_DEFS[key].applies ?? []).map((a) => `${a.kind}:${a.stacks}`);
    const table: Partial<Record<SkillKey, string[]>> = {
      railshot: ["vulnerable:1"],
      thunder: ["shock:2"],
      gravityWell: ["silence:1"],
      chainHook: ["bleed:1"],
      fullMoon: ["vulnerable:1"],
      powderKeg: ["burn:1"],
      iceBreaker: ["chill:2"],
      verdict: ["silence:1"],
      threadReel: ["weaken:1"],
      waterJar: ["wet:2"],
      oilPot: ["oiled:1"],
      scorchLine: ["burn:1"],
      iceSlide: ["chill:1"],
      bogCall: ["poison:1"],
      brandSear: ["brand:2"],
      breakKick: ["broken:1"],
      tideSlash: ["wet:2"],
      hueEtch: ["hue:1"],
      siphonMark: ["siphon:1"],
      doomSentence: ["doom:1"],
    };
    for (const key of SKILL_KEYS) {
      const want = table[key];
      if (want) expect(kinds(key), key).toEqual(want);
      else expect(SKILL_DEFS[key].applies, `${key} に付与がある`).toBeUndefined();
    }
  });

  it("アイコンは 1 文字で重複しない", () => {
    const icons = SKILL_KEYS.map((k) => SKILL_DEFS[k].icon);
    for (const icon of icons) expect([...icon], icon).toHaveLength(1);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("resolveCast", () => {
  it("リンクが多いほど負担が重い（1 本ごと +15%）。マナ型はコスト、CD 型は CD", () => {
    const whirl = SKILL_DEFS.whirl;
    const costs = [0, 1, 2, 3].map((links) => castBurden(whirl, resolveCast(whirl, stone("whirl", links), [])).cost);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1] ?? 0);
    expect(costs[0]).toBeCloseTo(SKILL.whirl.cost);
    expect(costs[3]).toBeCloseTo(SKILL.whirl.cost * (1 + SKILL.linkBurdenPenalty * 3));
    const lunge = SKILL_DEFS.lunge;
    const cd = castBurden(lunge, resolveCast(lunge, stone("lunge", 2), []));
    expect(cd.cooldown).toBeCloseTo(SKILL.lunge.cooldown * (1 + SKILL.linkBurdenPenalty * 2));
    expect(cd.cost, "CD 型はコスト 0").toBe(0);
  });

  it("変異は得失が釣り合う（範囲 x1.4 なら威力 x0.7）", () => {
    const p = resolveCast(SKILL_DEFS.whirl, stone("whirl", 0, { variants: [{ axis: "areaVsDamage", value: 1 }] }), []);
    expect(p.areaMul).toBeCloseTo(1.4);
    expect(p.damageMul).toBeCloseTo(0.7);
  });

  it("スキルに無い変異軸は無視する", () => {
    const p = resolveCast(SKILL_DEFS.bloodPact, stone("bloodPact", 0, { variants: [{ axis: "areaVsDamage", value: 1 }] }), []);
    expect(p.areaMul).toBe(1);
    expect(p.damageMul).toBe(1);
  });

  it("修飾子はリンク数まで・付けられるものだけ効く", () => {
    const def = SKILL_DEFS.lunge;
    const p = resolveCast(def, stone("lunge", 1), ["multiCharge", "bloodPrice"]);
    expect(p.charges).toBe(1 + SKILL.modifier.multiCharge.extraCharges);
    expect(p.hpCostFraction).toBe(0);
    expect(activeModifiers(SKILL_DEFS.parry, 3, ["echo", "bloodPrice"])).toEqual(["bloodPrice"]);
  });

  it("反響は defense / buff に付かない", () => {
    expect(canAttach(SKILL_DEFS.parry, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.bloodPact, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.whirl, "echo")).toBe(true);
  });

  it("修飾子 2 個の組み合わせ（CD 型に多重 + 血の代償）", () => {
    const p = resolveCast(SKILL_DEFS.lunge, stone("lunge", 2), ["multiCharge", "bloodPrice"]);
    const m = SKILL.modifier;
    expect(p.damageMul).toBeCloseTo(m.multiCharge.damageMul * m.bloodPrice.damageMul);
    expect(p.hpCostFraction).toBeCloseTo(m.bloodPrice.hpFraction);
    expect(p.burdenMul, "CD 型の血の代償は負担に触れない").toBeCloseTo((1 + SKILL.linkBurdenPenalty * 2) * m.multiCharge.burdenMul);
  });

  it("多重の読み替え: マナ型はコスト ×0.6・最低間隔 ×0.5・威力 ×0.7（チャージは増えない）", () => {
    const m = SKILL.modifier.multiCharge;
    const def = SKILL_DEFS.frag;
    const p = resolveCast(def, stone("frag", 1), ["multiCharge"]);
    expect(p.charges, "チャージは増えない").toBe(1);
    expect(p.damageMul).toBeCloseTo(m.damageMul);
    expect(castBurden(def, p).cost).toBeCloseTo(SKILL.frag.cost * (1 + SKILL.linkBurdenPenalty) * m.manaBurdenMul);
    expect(castInterval(def, p)).toBeCloseTo(SKILL.frag.minInterval * m.intervalMul);
    expect(castBurden(def, p).cooldown, "マナ型の CD は 0 のまま").toBe(0);
  });

  it("多重の読み替え: CD 型は現行どおりチャージ +2・CD ×1.3（最低間隔は変わらない）", () => {
    const m = SKILL.modifier.multiCharge;
    const def = SKILL_DEFS.lunge;
    const p = resolveCast(def, stone("lunge", 0, { links: 1 }), ["multiCharge"]);
    expect(p.charges).toBe(1 + m.extraCharges);
    expect(castBurden(def, p).cooldown).toBeCloseTo(SKILL.lunge.cooldown * (1 + SKILL.linkBurdenPenalty) * m.burdenMul);
    expect(castInterval(def, p)).toBeCloseTo(SKILL.lunge.minInterval);
  });

  it("血の代償の読み替え: マナ型はコスト ×0.5", () => {
    const def = SKILL_DEFS.thunder;
    const p = resolveCast(def, stone("thunder", 1), ["bloodPrice"]);
    expect(castBurden(def, p).cost).toBeCloseTo(SKILL.thunder.cost * (1 + SKILL.linkBurdenPenalty) * SKILL.modifier.bloodPrice.manaBurdenMul);
    expect(p.hpCostFraction).toBeCloseTo(SKILL.modifier.bloodPrice.hpFraction);
  });

  it("連鎖の読み替え: マナ型は撃破でコストの 50% を返す・負担 ×1.2、CD 型はチャージ返却・負担 ×1.35", () => {
    const m = SKILL.modifier.chainReset;
    const mana = resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["chainReset"]);
    expect(mana.killManaRefund).toBeCloseTo(m.manaRefund);
    expect(mana.killRefund, "マナ型はチャージを返さない").toBe(false);
    expect(mana.burdenMul).toBeCloseTo((1 + SKILL.linkBurdenPenalty) * m.manaBurdenMul);
    const cd = resolveCast(SKILL_DEFS.lunge, stone("lunge", 1), ["chainReset"]);
    expect(cd.killRefund).toBe(true);
    expect(cd.killManaRefund).toBe(0);
    expect(cd.burdenMul).toBeCloseTo((1 + SKILL.linkBurdenPenalty) * m.burdenMul);
  });

  it("反響・拡大は負担に掛かる（マナ型ならコスト）", () => {
    const echo = resolveCast(SKILL_DEFS.frag, stone("frag", 1), ["echo"]);
    expect(castBurden(SKILL_DEFS.frag, echo).cost).toBeCloseTo(SKILL.frag.cost * (1 + SKILL.linkBurdenPenalty) * SKILL.modifier.echo.burdenMul);
    const expand = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["expand"]);
    expect(castBurden(SKILL_DEFS.quake, expand).cost).toBeCloseTo(
      SKILL.quake.cost * (1 + SKILL.linkBurdenPenalty) * SKILL.modifier.expand.burdenMul,
    );
  });

  it("刻印符の説明はマナ型で読み替えたものを出す", () => {
    expect(modifierVerb("multiCharge", SKILL_DEFS.frag)).toBe(MODIFIERS.multiCharge.manaVerb);
    expect(modifierVerb("multiCharge", SKILL_DEFS.lunge)).toBe(MODIFIERS.multiCharge.verb);
    expect(modifierVerb("pierce", SKILL_DEFS.spiral), "読み替えの無いものは verb のまま").toBe(MODIFIERS.pierce.verb);
  });

  it("全スキル・全修飾子に定義がある", () => {
    for (const key of SKILL_KEYS) expect(SKILL_DEFS[key].key).toBe(key);
    expect(SKILL_KEYS).toHaveLength(76);
    expect(Object.keys(MODIFIERS)).toEqual([...MODIFIER_KEYS]);
    expect(MODIFIER_KEYS).toHaveLength(53);
    for (const key of MODIFIER_KEYS) expect(MODIFIERS[key].key).toBe(key);
  });

  it("新スキルの変異軸は 2〜3 本で、すべて得失が効くパラメータを持つ", () => {
    const added: SkillKey[] = ["quake", "thunder", "gravityWell", "mines", "haste", "chainHook", "spiral", "frostField"];
    for (const key of added) {
      const def = SKILL_DEFS[key];
      expect(def.axes.length).toBeGreaterThanOrEqual(2);
      expect(def.axes.length).toBeLessThanOrEqual(3);
      // buff は威力を持たないので Damage 側の軸を持たない
      if (def.damageKind === "none") for (const a of def.axes) expect(a.endsWith("Potency")).toBe(true);
    }
  });

  it("cooldownVsPotency: 負担 x0.7 なら効果量 x0.75", () => {
    const p = resolveCast(SKILL_DEFS.haste, stone("haste", 0, { variants: [{ axis: "cooldownVsPotency", value: 1 }] }), []);
    expect(p.burdenMul).toBeCloseTo(0.7);
    expect(p.potencyMul).toBeCloseTo(0.75);
    expect(formatVariant({ axis: "cooldownVsPotency", value: 1 }, SKILL_DEFS.haste)).toBe("再使用 -30% / 効果量 -25%");
  });

  it("負担の変異軸の表示はマナ型で「コスト」、CD 型で「CD」", () => {
    const roll = { axis: "cooldownVsDamage", value: 1 } as const;
    expect(formatVariant(roll, SKILL_DEFS.whirl)).toBe("コスト -30% / ダメージ -25%");
    expect(formatVariant(roll, SKILL_DEFS.lunge)).toBe("再使用 -30% / ダメージ -25%");
  });

  it("定刻・燃料化で資源が差し替わると、表示も差し替え後の資源で出す", () => {
    const roll = { axis: "cooldownVsDamage", value: 1 } as const;
    const timeLocked = resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["timeLock"]);
    expect(timeLocked.resource, "定刻でマナ型が CD 型になる").toBe("cooldown");
    expect(formatVariant(roll, SKILL_DEFS.whirl, timeLocked.resource)).toBe("再使用 -30% / ダメージ -25%");
    expect(modifierVerb("multiCharge", SKILL_DEFS.whirl, timeLocked.resource)).toBe(MODIFIERS.multiCharge.verb);
    const fueled = resolveCast(SKILL_DEFS.lunge, stone("lunge", 1), ["fuelize"]);
    expect(fueled.resource, "燃料化で CD 型がマナ型になる").toBe("mana");
    expect(formatVariant(roll, SKILL_DEFS.lunge, fueled.resource)).toBe("コスト -30% / ダメージ -25%");
    expect(modifierVerb("multiCharge", SKILL_DEFS.lunge, fueled.resource)).toBe(MODIFIERS.multiCharge.manaVerb);
  });

  it("新刻印符の効果（貫通・反動・連鎖・呪い・遅延・拡大）", () => {
    const m = SKILL.modifier;
    const spiral = resolveCast(SKILL_DEFS.spiral, stone("spiral", 1), ["pierce"]);
    expect(spiral.pierce).toBe(m.pierce.count);
    expect(spiral.areaMul).toBeCloseTo(m.pierce.areaMul);
    const recoil = resolveCast(SKILL_DEFS.frag, stone("frag", 1), ["recoil"]);
    expect(recoil.recoil).toBe(m.recoil.speed);
    expect(recoil.damageMul).toBeCloseTo(m.recoil.damageMul);
    const chain = resolveCast(SKILL_DEFS.lunge, stone("lunge", 1), ["chainReset"]);
    expect(chain.killRefund).toBe(true);
    expect(chain.burdenMul).toBeCloseTo((1 + SKILL.linkBurdenPenalty) * m.chainReset.burdenMul);
    const curse = resolveCast(SKILL_DEFS.thunder, stone("thunder", 1), ["curse"]);
    expect(curse.curse).toEqual({ duration: m.curse.duration, bonus: m.curse.bonus });
    const delay = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["delay"]);
    expect(delay.delay).toEqual({ time: m.delay.time, damageMul: m.delay.damageMul });
    const expand = resolveCast(SKILL_DEFS.frostField, stone("frostField", 1), ["expand"]);
    expect(expand.areaMul).toBeCloseTo(m.expand.areaMul);
  });

  it("溜め: resolveCast 自体は素通し（実際の倍率は発動時に system/skills.ts が掛ける）", () => {
    const p = resolveCast(SKILL_DEFS.frag, stone("frag", 1), ["charge"]);
    expect(p.damageMul).toBe(1);
    expect(p.areaMul).toBe(1);
  });
});

describe("大拡張の刻印符（resolveCast）", () => {
  const m = SKILL.modifier;
  const link = (n: number): number => 1 + SKILL.linkBurdenPenalty * n;

  it("型替え符はリンクを 2 本使い、1 スロットに 1 枚まで", () => {
    expect(modifierLinkCost("toStaged")).toBe(2);
    expect(modifierLinkCost("heavy")).toBe(1);
    expect(activeModifiers(SKILL_DEFS.whirl, 1, ["toStaged"]), "リンク 1 では効かない").toEqual([]);
    expect(activeModifiers(SKILL_DEFS.whirl, 3, ["toStaged", "toThrown"]), "2 枚目の型替え符は効かない").toEqual(["toStaged"]);
    expect(activeModifiers(SKILL_DEFS.whirl, 3, ["heavy", "toStaged"]), "1 + 2 = 3 本").toEqual(["heavy", "toStaged"]);
    expect(activeModifiers(SKILL_DEFS.whirl, 2, ["heavy", "toStaged"]), "残り 1 本には入らない").toEqual(["heavy"]);
  });

  it("排他の組は古い方だけが効く（重撃 / 軽打、至近 / 遠当て、突き放し / 手繰り、溜め / 段階溜め）", () => {
    expect(activeModifiers(SKILL_DEFS.whirl, 3, ["feather", "heavy"])).toEqual(["feather"]);
    expect(activeModifiers(SKILL_DEFS.railshot, 3, ["longshot", "pointBlank"])).toEqual(["longshot"]);
    expect(activeModifiers(SKILL_DEFS.quake, 3, ["repel", "tether"])).toEqual(["repel"]);
    expect(activeModifiers(SKILL_DEFS.quake, 3, ["charge", "toStaged"])).toEqual(["charge"]);
  });

  it("定刻: マナ型を CD 型に変える（CD = コスト x0.3 秒、連打間隔 x1.5）。多重は CD 型として読み替わる", () => {
    const def = SKILL_DEFS.frag;
    const p = resolveCast(def, stone("frag", 2), ["multiCharge", "timeLock"]);
    expect(p.resource).toBe("cooldown");
    const burden = castBurden(def, p);
    expect(burden.cost, "マナは使わない").toBe(0);
    expect(burden.cooldown).toBeCloseTo(SKILL.frag.cost * m.timeLock.cooldownPerCost * link(2) * m.multiCharge.burdenMul);
    expect(p.charges, "多重は CD 型の読み（チャージ +2）").toBe(1 + m.multiCharge.extraCharges);
    expect(castInterval(def, p)).toBeCloseTo(SKILL.frag.minInterval * m.timeLock.intervalMul);
  });

  it("燃料化: CD 型をマナ型に変える（コスト = CD x5、チャージ 1）。パリィには付かない", () => {
    const def = SKILL_DEFS.haste;
    const p = resolveCast(def, stone("haste", 1), ["fuelize"]);
    expect(p.resource).toBe("mana");
    expect(castBurden(def, p).cost).toBeCloseTo(SKILL.haste.cooldown * m.fuelize.costPerCooldown * link(1));
    expect(castBurden(def, p).cooldown).toBe(0);
    expect(canAttach(SKILL_DEFS.parry, "fuelize")).toBe(false);
  });

  it("定刻とマナ経済の刻印符は同時に効かない", () => {
    expect(activeModifiers(SKILL_DEFS.frag, 3, ["timeLock", "refund", "dryFire"])).toEqual(["timeLock"]);
  });

  it("重撃は怯み値 x2・威力 x0.8・連打間隔 x1.5、軽打は負担 x0.6・怯み値 0", () => {
    const heavy = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["heavy"]);
    expect(heavy.poiseMul).toBeCloseTo(m.heavy.poiseMul);
    expect(heavy.damageMul).toBeCloseTo(m.heavy.damageMul);
    expect(castInterval(SKILL_DEFS.quake, heavy)).toBeCloseTo(SKILL.quake.minInterval * m.heavy.intervalMul);
    const feather = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["feather"]);
    expect(feather.poiseMul).toBe(0);
    expect(castBurden(SKILL_DEFS.quake, feather).cost).toBeCloseTo(SKILL.quake.cost * link(1) * m.feather.burdenMul);
  });

  it("延命・伝播は付与を持つスキルにだけ付く", () => {
    expect(canAttach(SKILL_DEFS.thunder, "linger")).toBe(true);
    expect(canAttach(SKILL_DEFS.whirl, "linger")).toBe(false);
    expect(canAttach(SKILL_DEFS.iceBreaker, "spread")).toBe(true);
    const p = resolveCast(SKILL_DEFS.thunder, stone("thunder", 1), ["linger"]);
    expect(p.statusDurationMul).toBeCloseTo(m.linger.durationMul);
    expect(p.damageMul).toBeCloseTo(m.linger.damageMul);
  });

  it("マナの払い方が特殊なスキル（満月の砲・枯渇の刃）にはコストを動かす刻印符が付かない", () => {
    for (const mod of ["deferred", "refund", "bloodTithe", "spillover", "bladeFeed", "timeLock", "overheat"] as const) {
      expect(canAttach(SKILL_DEFS.fullMoon, mod), `満月の砲 + ${mod}`).toBe(false);
      expect(canAttach(SKILL_DEFS.dregsBlade, mod), `枯渇の刃 + ${mod}`).toBe(false);
    }
    expect(canAttach(SKILL_DEFS.dregsBlade, "dryFire"), "渇き撃ちは枯渇の刃と噛み合う").toBe(true);
  });

  it("旗を立てるだけの刻印符（背面・至近・遠当て・散り際・着地衝撃・追撃・返金・後払い）", () => {
    expect(resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["flank"]).flank).toBe(true);
    expect(resolveCast(SKILL_DEFS.spiral, stone("spiral", 1), ["pointBlank"]).rangeBias).toBe("pointBlank");
    expect(resolveCast(SKILL_DEFS.railshot, stone("railshot", 1), ["longshot"]).rangeBias).toBe("longshot");
    expect(resolveCast(SKILL_DEFS.frag, stone("frag", 1), ["lastGasp"]).lastGasp).toBeCloseTo(m.lastGasp.damageMul);
    expect(resolveCast(SKILL_DEFS.lunge, stone("lunge", 1), ["landing"]).landing).toBe(true);
    expect(resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["followUp"]).followUp).toBe(true);
    const refund = resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["refund"]);
    expect(refund.refundPerHit).toBeCloseTo(m.refund.perHit);
    expect(refund.damageMul).toBeCloseTo(m.refund.damageMul);
    expect(resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["deferred"]).deferredMul).toBeCloseTo(m.deferred.costMul);
  });

  it("手繰りはノックバックの倍率を負にする（向きを反転する印）", () => {
    const p = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["tether"]);
    expect(p.knockbackMul).toBeLessThan(0);
  });

  it("投げ込みは持続・発動時間を縮めて威力を上げる", () => {
    const p = resolveCast(SKILL_DEFS.gravityWell, stone("gravityWell", 2), ["toLobbed"]);
    expect(p.reshape).toBe("toLobbed");
    expect(p.durationMul).toBeCloseTo(m.toLobbed.durationMul);
    expect(p.damageMul).toBeCloseTo(m.toLobbed.damageMul);
  });

  it("新しい刻印符の説明はマナ型で読み替える（軽打・散り際・着地衝撃・巡り）", () => {
    expect(modifierVerb("feather", SKILL_DEFS.whirl)).toContain("コスト");
    expect(modifierVerb("feather", SKILL_DEFS.lunge)).toContain("再使用時間");
  });
});

describe("相性表", () => {
  /**
   * 付けられない組み合わせ（これ以外はすべて付く）。
   * マナ化（docs/COMBAT_DESIGN.md B-5）では効果を読み替えるだけで、付けられる組み合わせは変えていない
   */
  const FORBIDDEN: Record<ModifierKey, readonly SkillKey[]> = {
    multiCharge: [],
    bloodPrice: [],
    comboFuel: [],
    echo: ["parry", "bloodPact", "haste", "shadowStep", "boneRing", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    pierce: ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "frostField", "contagion", "kindle", "fullMoon", "dregsBlade", "shadowStep", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "discharge", "verdict", "exploit", "lastStand", "comboChain", "grudge", "guillotine", "galeSlash", "stomp", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "flashFreeze", "hueEtch", "hueRelease", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    recoil: ["lunge", "parry", "bloodPact", "haste", "shadowStep", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    chainReset: ["parry", "bloodPact", "haste", "boneRing", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    curse: ["bloodPact", "haste", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    delay: ["lunge", "parry", "bloodPact", "haste", "spiral", "shadowStep", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    expand: ["lunge", "railshot", "parry", "bloodPact", "haste", "chainHook", "spiral", "unravel", "prismShard", "fullMoon", "shadowStep", "harvest", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "guillotine", "ricochet", "galeSlash", "scatterSigil", "threadReel", "swallowFlip", "boneRing", "backflow", "manaSpring", "turret", "iceSlide", "emberDraw", "brandSear", "breakKick", "tideSlash", "hueEtch", "siphonMark", "shiftingEdge", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    charge: ["parry", "bloodPact", "haste", "spiral", "boneRing", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    deferred: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    refund: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    bloodTithe: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm"],
    spillover: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    dryFire: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    bladeFeed: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm"],
    timeLock: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm"],
    fuelize: ["whirl", "frag", "railshot", "parry", "quake", "thunder", "gravityWell", "mines", "chainHook", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "shadowStep", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "meteorDive", "turret", "waterJar", "oilPot", "scorchLine", "levelGround", "emberDraw", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "wardStake", "siegeForm", "pyreForm"],
    overheat: ["lunge", "parry", "bloodPact", "haste", "fullMoon", "dregsBlade", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "ironForm"],
    heavy: ["bloodPact", "haste", "frostField", "contagion", "shadowStep", "boneRing", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    feather: ["bloodPact", "haste", "frostField", "contagion", "shadowStep", "boneRing", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    repel: ["lunge", "bloodPact", "haste", "shadowStep", "meteorDive", "swallowFlip", "backflow", "manaSpring", "iceSlide", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    tether: ["lunge", "bloodPact", "haste", "shadowStep", "meteorDive", "swallowFlip", "backflow", "manaSpring", "iceSlide", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    linger: ["whirl", "lunge", "frag", "parry", "bloodPact", "quake", "mines", "haste", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "dregsBlade", "shadowStep", "swordGrave", "bloodlet", "harvest", "discharge", "rout", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "levelGround", "emberDraw", "brandBlast", "collapseHammer", "flashFreeze", "hueRelease", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm", "mire"],
    spread: ["whirl", "lunge", "frag", "parry", "bloodPact", "quake", "mines", "haste", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "dregsBlade", "shadowStep", "swordGrave", "bloodlet", "harvest", "discharge", "rout", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "levelGround", "emberDraw", "brandBlast", "collapseHammer", "flashFreeze", "hueRelease", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm", "mire"],
    followUp: ["bloodPact", "haste", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    lastGasp: ["lunge", "parry", "bloodPact", "haste", "shadowStep", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "iceSlide", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    sustain: ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact", "quake", "thunder", "haste", "chainHook", "spiral", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "shadowStep", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "scorchLine", "iceSlide", "levelGround", "emberDraw", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "siegeForm", "pyreForm"],
    landing: ["whirl", "frag", "railshot", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "chainHook", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "boneRing", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "levelGround", "emberDraw", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    desperate: ["bloodPact", "haste", "lastStand", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    attune: [],
    cycle: [],
    flank: ["frag", "railshot", "bloodPact", "thunder", "gravityWell", "mines", "haste", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "shadowStep", "powderKeg", "swordGrave", "bloodlet", "harvest", "discharge", "rout", "strip", "ricochet", "scatterSigil", "threadReel", "meteorDive", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "emberDraw", "bogCall", "mire", "brandBlast", "tideSlash", "flashFreeze", "hueRelease", "siphonMark", "doomSentence", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    pointBlank: ["whirl", "lunge", "frag", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "frostField", "contagion", "kindle", "dregsBlade", "shadowStep", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "discharge", "verdict", "exploit", "lastStand", "comboChain", "grudge", "guillotine", "stomp", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "flashFreeze", "hueEtch", "hueRelease", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    longshot: ["whirl", "lunge", "frag", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "frostField", "contagion", "kindle", "dregsBlade", "shadowStep", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "discharge", "verdict", "exploit", "lastStand", "comboChain", "grudge", "guillotine", "stomp", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "flashFreeze", "hueEtch", "hueRelease", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    toThrown: ["lunge", "frag", "railshot", "parry", "bloodPact", "thunder", "gravityWell", "mines", "haste", "chainHook", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "shadowStep", "powderKeg", "swordGrave", "bloodlet", "harvest", "discharge", "rout", "strip", "grudge", "ricochet", "galeSlash", "scatterSigil", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "emberDraw", "bogCall", "mire", "brandBlast", "tideSlash", "flashFreeze", "hueRelease", "siphonMark", "doomSentence", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    toLobbed: ["whirl", "lunge", "railshot", "parry", "bloodPact", "quake", "haste", "chainHook", "spiral", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "shadowStep", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "scorchLine", "iceSlide", "levelGround", "emberDraw", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    toStaged: ["parry", "bloodPact", "haste", "spiral", "boneRing", "backflow", "scarRoar", "manaSpring", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    fireInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "shiftingEdge", "weaponArt", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    iceInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "shiftingEdge", "weaponArt", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    stormInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "shiftingEdge", "weaponArt", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    venomInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "shiftingEdge", "weaponArt", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    breakInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "breakKick", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    hueInfuse: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "hueEtch", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    leyline: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    jobMastery: [],
    weaponBond: ["bloodPact", "haste", "contagion", "shadowStep", "boneRing", "manaSpring", "shiftingEdge", "weaponArt", "wolfForm", "wraithForm", "ironForm", "pyreForm"],
    formSurge: ["titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    formLinger: ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "chainHook", "spiral", "frostField", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "shadowStep", "powderKeg", "swordGrave", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "emberDraw", "bogCall", "mire", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "wardStake", "siegeForm", "pyreForm"],
    // 地崩れは地裂き専用
    crumble: SKILL_KEYS.filter((k) => k !== "quake"),
    toNova: ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact", "quake", "mines", "haste", "chainHook", "spiral", "contagion", "unravel", "kindle", "prismShard", "fullMoon", "dregsBlade", "shadowStep", "iceBreaker", "bloodlet", "harvest", "discharge", "rout", "verdict", "exploit", "strip", "lastStand", "comboChain", "grudge", "guillotine", "ricochet", "galeSlash", "scatterSigil", "stomp", "threadReel", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "scorchLine", "iceSlide", "levelGround", "emberDraw", "brandSear", "brandBlast", "breakKick", "collapseHammer", "tideSlash", "flashFreeze", "hueEtch", "hueRelease", "siphonMark", "doomSentence", "shiftingEdge", "weaponArt", "titanForm", "swiftForm", "spiritForm", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    toTrap: ["lunge", "frag", "parry", "bloodPact", "thunder", "gravityWell", "mines", "haste", "spiral", "frostField", "contagion", "kindle", "shadowStep", "powderKeg", "swordGrave", "bloodlet", "discharge", "grudge", "meteorDive", "swallowFlip", "boneRing", "backflow", "scarRoar", "manaSpring", "turret", "waterJar", "oilPot", "scorchLine", "iceSlide", "levelGround", "bogCall", "mire", "brandBlast", "flashFreeze", "hueRelease", "doomSentence", "titanForm", "swiftForm", "spiritForm", "wardStake", "wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
  };

  it("全スキル x 全刻印符が表どおり", () => {
    for (const mod of MODIFIER_KEYS) {
      for (const key of SKILL_KEYS) {
        expect({ mod, key, ok: canAttach(SKILL_DEFS[key], mod) }).toEqual({ mod, key, ok: !FORBIDDEN[mod].includes(key) });
      }
    }
  });

  it("どのスキルにも付く刻印符が 3 つ以上ある（拾っても死に札になりにくい）", () => {
    for (const key of SKILL_KEYS) {
      expect(MODIFIER_KEYS.filter((m) => canAttach(SKILL_DEFS[key], m)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("付けられない刻印符はリンクがあっても効かない", () => {
    const p = resolveCast(SKILL_DEFS.railshot, stone("railshot", 2), ["pierce", "expand"]);
    expect(p.pierce).toBe(0);
    expect(p.areaMul).toBe(1);
  });
});

describe("同時発動の排他グループ", () => {
  it("SKILL.gcd（全スロット共通の最低間隔）は無い", () => {
    expect("gcd" in SKILL, "共通最低間隔の定数は廃止").toBe(false);
  });

  it("body は BODY_SKILL_KEYS のスキルだけに付き、ほかは省略（並行して撃てる）", () => {
    for (const key of SKILL_KEYS) {
      const expected = BODY_SKILL_KEYS.includes(key) ? "body" : undefined;
      expect(SKILL_DEFS[key].exclusiveGroup, key).toBe(expected);
    }
  });

  it("近接・移動の本動作は body、設置・強化は body でない", () => {
    for (const key of ["whirl", "lunge", "quake", "chainHook", "shadowStep", "meteorDive"] as const) {
      expect(SKILL_DEFS[key].exclusiveGroup, `${key} は本動作`).toBe("body");
    }
    for (const key of ["frag", "mines", "thunder", "haste", "bloodPact", "turret"] as const) {
      expect(SKILL_DEFS[key].exclusiveGroup, `${key} は並行可`).toBeUndefined();
    }
  });
});

describe("刻印符のドロップ（rollRuneDrop）", () => {
  it("エリート・ボス・図書館・巣窟は通常の敵より出やすく、通常の敵は深度で少し増える（上限あり）", () => {
    const normal = runeDropChance(1, "normal");
    for (const source of ["elite", "boss", "library", "nest"] as const) {
      expect(runeDropChance(1, source), source).toBeGreaterThan(normal);
    }
    expect(runeDropChance(10, "normal"), "深いほど増える").toBeGreaterThan(normal);
    expect(runeDropChance(1000, "normal"), "上限").toBeCloseTo(SKILL.drop.runeOnKill.normal + SKILL.drop.runeOnKillDepthCap);
  });

  it("確率 1 なら装着中スキルに付けられる種類が出て、0 なら null。外れでも乱数は 1 回だけ引く", () => {
    const hit = rollRuneDrop({ ...createRng(3), chance: () => true }, 1, "boss", ["frag"]);
    expect(hit).not.toBeNull();
    if (hit) expect(canAttach(SKILL_DEFS.frag, hit)).toBe(true);
    let calls = 0;
    const rng = createRng(3);
    const counted = { ...rng, chance: (p: number) => (calls++, rng.chance(0 * p)) };
    expect(rollRuneDrop(counted, 1, "normal")).toBeNull();
    expect(calls).toBe(1);
  });

  it("同じ seed なら同じ結果（決定性）", () => {
    const a = Array.from({ length: 50 }, (_, i) => rollRuneDrop(createRng(i), 5, "elite"));
    const b = Array.from({ length: 50 }, (_, i) => rollRuneDrop(createRng(i), 5, "elite"));
    expect(a).toEqual(b);
  });

  it("所持品の刻印符は種類・id・foundAt を持つ", () => {
    const r = makeRuneItem("echo", 42, 1000);
    expect(r.modifier).toBe("echo");
    expect(r.foundAt).toBe(1000);
    expect(r.id).not.toBe(makeRuneItem("echo", 43, 1000).id);
  });
});

describe("生成の重み", () => {
  it("深い層では全 75 種が出る。重みに沿って初期 6 種がやや多い", () => {
    const rng = createRng(123);
    const counts = new Map<SkillKey, number>();
    const n = 24000;
    for (let i = 0; i < n; i++) {
      const s = generateSkillStone(rng, { foundDepth: 5, now: 0 });
      counts.set(s.skillKey, (counts.get(s.skillKey) ?? 0) + 1);
    }
    for (const key of SKILL_KEYS) expect(counts.get(key) ?? 0).toBeGreaterThan(0);
    const total = SKILL_KEYS.reduce((sum, k) => sum + SKILL_WEIGHTS[k], 0);
    for (const key of SKILL_KEYS) {
      const expected = (SKILL_WEIGHTS[key] / total) * n;
      expect(Math.abs((counts.get(key) ?? 0) - expected)).toBeLessThan(expected * 0.25);
    }
  });

  it("浅い層では SKILL_MIN_DEPTH より深いスキルが出ない", () => {
    const rng = createRng(77);
    for (let i = 0; i < SAMPLE_COUNT * 3; i++) {
      const s = generateSkillStone(rng, { foundDepth: 1, now: 0 });
      expect(SKILL_MIN_DEPTH[s.skillKey], s.skillKey).toBeLessThanOrEqual(1);
    }
  });

  it("新スキルの石も seed から決定的（変異軸はそのスキルの軸だけ）", () => {
    for (const key of ["quake", "haste", "spiral"] as const) {
      const a = stoneFromSeed(77, { foundDepth: 2, now: 5, skillKey: key });
      expect(stoneFromSeed(77, { foundDepth: 2, now: 5, skillKey: key })).toEqual(a);
      for (const v of a.variants) expect(SKILL_DEFS[key].axes).toContain(v.axis);
    }
  });

  it("初期プロフィールは旋風斬り + グレネードのまま", () => {
    expect(createDefaultSkillProfile().stones.map((s) => s.skillKey)).toEqual(["whirl", "frag"]);
  });

  it("刻印符の抽選は装着スキルに付くものだけ（加速 + 血の契約なら汎用の 7 種と燃料化だけ）", () => {
    const rng = createRng(4);
    const seen = new Set<ModifierKey>();
    for (let i = 0; i < SAMPLE_COUNT; i++) seen.add(rollRuneModifier(rng, ["haste", "bloodPact"]));
    expect([...seen].sort()).toEqual(["attune", "bloodPrice", "comboFuel", "cycle", "formSurge", "fuelize", "jobMastery", "multiCharge"]);
  });

  it("型替え符は通常の刻印符より出にくい", () => {
    const rng = createRng(8);
    const counts = new Map<ModifierKey, number>();
    for (let i = 0; i < 20000; i++) {
      const k = rollRuneModifier(rng, ["whirl"]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.get("toStaged") ?? 0, "段階溜めも出る").toBeGreaterThan(0);
    expect(counts.get("toStaged") ?? 0, "型替え符は通常の半分未満").toBeLessThan((counts.get("multiCharge") ?? 0) / 2);
  });
});

describe("スキル石の永続化", () => {
  it("round-trip で同じ内容が戻る", () => {
    const storage = new MemoryStorage();
    const profile = createDefaultSkillProfile();
    const extra = generateSkillStone(createRng(9), { foundDepth: 4, now: 123 });
    expect(addStone(profile, extra)).toBe(true);
    equipStone(profile, extra.id, 1);
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage)).toEqual(profile);
  });

  it("壊れた JSON・version 違いは初期プロフィール（旋風斬りとグレネードを装着）", () => {
    const storage = new MemoryStorage();
    storage.setItem(SKILL_PROFILE_KEY, "{broken");
    const a = loadSkillProfile(storage);
    expect(a.stones.map((s) => s.skillKey)).toEqual(["whirl", "frag"]);
    expect(a.loadout).toEqual([...a.stones.map((s) => s.id), null, null]);
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 99, stones: [], loadout: [] }));
    expect(loadSkillProfile(storage)).toEqual(createDefaultSkillProfile());
  });

  it("壊れた石は捨て、loadout の不正な id は空にする", () => {
    const storage = new MemoryStorage();
    const good = stone("lunge", 2, { id: "good" });
    storage.setItem(
      SKILL_PROFILE_KEY,
      JSON.stringify({ version: 1, loadout: ["missing", "good"], stones: [good, { id: "bad", skillKey: "nope" }] }),
    );
    const loaded = loadSkillProfile(storage);
    expect(loaded.stones).toEqual([good]);
    expect(loaded.loadout).toEqual([null, "good", null, null]);
  });

  it("旧 2 スロットの loadout は 4 スロットに null で埋まる（装着はそのまま）", () => {
    const storage = new MemoryStorage();
    const a = stone("whirl", 1, { id: "a" });
    const b = stone("frag", 1, { id: "b" });
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["a", "b"], stones: [a, b] }));
    const loaded = loadSkillProfile(storage);
    expect(loaded.loadout, "2 要素が 4 要素に").toEqual(["a", "b", null, null]);
    expect(loaded.loadout).toHaveLength(SKILL.slots);
    expect(equipStone(loaded, "a", 3), "新しいスロット 4 にも装着できる").toBe(true);
    expect(loaded.loadout).toEqual([null, "b", null, "a"]);
  });

  it("初期プロフィールも 4 スロット（3 / 4 は空）", () => {
    const profile = createDefaultSkillProfile();
    expect(profile.loadout).toHaveLength(SKILL.slots);
    expect(profile.loadout.slice(2)).toEqual([null, null]);
  });

  it("装備プロフィール（roguelike.profile.v1）には触れない", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, "equipment");
    saveSkillProfile(createDefaultSkillProfile(), storage);
    expect(storage.getItem(PROFILE_KEY)).toBe("equipment");
    expect(storage.length).toBe(2);
  });

  it("分解すると装着も外れる", () => {
    const profile = createDefaultSkillProfile();
    const id = profile.loadout[0];
    if (!id) throw new Error("starter missing");
    expect(salvageStone(profile, id)).toBe(true);
    expect(profile.loadout[0]).toBeNull();
    expect(profile.stones.some((s) => s.id === id)).toBe(false);
  });
});
