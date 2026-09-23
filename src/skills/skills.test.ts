import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { PROFILE_KEY } from "../loot/profile";
import {
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  SKILL_WEIGHTS,
  activeModifiers,
  canAttach,
  castBurden,
  castInterval,
  formatVariant,
  modifierVerb,
  resolveCast,
} from "./data";
import { generateSkillStone, rollRuneModifier, stoneFromSeed } from "./generator";
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

/** docs/COMBAT_DESIGN.md B-4 の表: 型・コスト（CD 型は CD）・最低間隔・怯み値 */
const B4_TABLE: Record<SkillKey, { resource: SkillResource; cost: number; cooldown: number; interval: number; poise: number }> = {
  whirl: { resource: "mana", cost: 18, cooldown: 0, interval: 0.6, poise: 6 },
  lunge: { resource: "cooldown", cost: 0, cooldown: 3, interval: 0.3, poise: 20 },
  frag: { resource: "mana", cost: 22, cooldown: 0, interval: 0.5, poise: 30 },
  railshot: { resource: "mana", cost: 25, cooldown: 0, interval: 0.8, poise: 25 },
  parry: { resource: "cooldown", cost: 0, cooldown: 3.5, interval: 0.3, poise: 40 },
  bloodPact: { resource: "cooldown", cost: 0, cooldown: 12, interval: 0.3, poise: 0 },
  quake: { resource: "mana", cost: 24, cooldown: 0, interval: 0.6, poise: 45 },
  thunder: { resource: "mana", cost: 20, cooldown: 0, interval: 0.5, poise: 15 },
  gravityWell: { resource: "mana", cost: 30, cooldown: 0, interval: 1, poise: 20 },
  mines: { resource: "mana", cost: 12, cooldown: 0, interval: 0.3, poise: 25 },
  haste: { resource: "cooldown", cost: 0, cooldown: 11, interval: 0.3, poise: 0 },
  chainHook: { resource: "mana", cost: 14, cooldown: 0, interval: 0.5, poise: 15 },
  spiral: { resource: "mana", cost: 28, cooldown: 0, interval: 1.1, poise: 2 },
  frostField: { resource: "mana", cost: 26, cooldown: 0, interval: 0.8, poise: 0 },
};

describe("スキルの分類（マナ型 / CD 型）", () => {
  it("マナ型 10 / CD 型 4", () => {
    const mana = SKILL_KEYS.filter((k) => SKILL_DEFS[k].resource === "mana");
    expect(mana, "マナ型の数").toHaveLength(10);
    expect(SKILL_KEYS.length - mana.length, "CD 型の数").toBe(4);
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

  it("付与: 撃ち抜き=脆弱 / 雷撃=感電 2 / 引力球=沈黙 / 鎖鎌=出血 1。他は付与なし", () => {
    const kinds = (key: SkillKey): string[] => (SKILL_DEFS[key].applies ?? []).map((a) => `${a.kind}:${a.stacks}`);
    expect(kinds("railshot")).toEqual(["vulnerable:1"]);
    expect(kinds("thunder")).toEqual(["shock:2"]);
    expect(kinds("gravityWell")).toEqual(["silence:1"]);
    expect(kinds("chainHook")).toEqual(["bleed:1"]);
    const others = SKILL_KEYS.filter((k) => !["railshot", "thunder", "gravityWell", "chainHook"].includes(k));
    for (const key of others) expect(SKILL_DEFS[key].applies, `${key} に付与がある`).toBeUndefined();
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
    expect(SKILL_KEYS).toHaveLength(14);
    expect(Object.keys(MODIFIERS)).toEqual([...MODIFIER_KEYS]);
    expect(MODIFIER_KEYS).toHaveLength(11);
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
    expect(formatVariant({ axis: "cooldownVsPotency", value: 1 }, SKILL_DEFS.haste)).toBe("CD -30% / 効果量 -25%");
  });

  it("負担の変異軸の表示はマナ型で「コスト」、CD 型で「CD」", () => {
    const roll = { axis: "cooldownVsDamage", value: 1 } as const;
    expect(formatVariant(roll, SKILL_DEFS.whirl)).toBe("コスト -30% / ダメージ -25%");
    expect(formatVariant(roll, SKILL_DEFS.lunge)).toBe("CD -30% / ダメージ -25%");
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

describe("相性表", () => {
  /**
   * 付けられない組み合わせ（これ以外はすべて付く）。
   * マナ化（docs/COMBAT_DESIGN.md B-5）では効果を読み替えるだけで、付けられる組み合わせは変えていない
   */
  const FORBIDDEN: Record<ModifierKey, readonly SkillKey[]> = {
    multiCharge: [],
    bloodPrice: [],
    comboFuel: [],
    echo: ["parry", "bloodPact", "haste"],
    pierce: ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact", "quake", "thunder", "gravityWell", "mines", "haste", "frostField"],
    recoil: ["lunge", "parry", "bloodPact", "haste"],
    chainReset: ["parry", "bloodPact", "haste"],
    curse: ["bloodPact", "haste"],
    delay: ["lunge", "parry", "bloodPact", "haste", "spiral"],
    expand: ["lunge", "railshot", "parry", "bloodPact", "haste", "chainHook", "spiral"],
    charge: ["parry", "bloodPact", "haste", "spiral"],
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

describe("生成の重み", () => {
  it("新スキルも抽選され、全 14 種が出る。重みに沿って初期 6 種がやや多い", () => {
    const rng = createRng(123);
    const counts = new Map<SkillKey, number>();
    const n = 7000;
    for (let i = 0; i < n; i++) {
      const s = generateSkillStone(rng, { foundDepth: 1, now: 0 });
      counts.set(s.skillKey, (counts.get(s.skillKey) ?? 0) + 1);
    }
    for (const key of SKILL_KEYS) expect(counts.get(key) ?? 0).toBeGreaterThan(0);
    const total = SKILL_KEYS.reduce((sum, k) => sum + SKILL_WEIGHTS[k], 0);
    for (const key of SKILL_KEYS) {
      const expected = (SKILL_WEIGHTS[key] / total) * n;
      expect(Math.abs((counts.get(key) ?? 0) - expected)).toBeLessThan(expected * 0.25);
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

  it("刻印符の抽選は装着スキルに付くものだけ（加速 + 血の契約なら 3 種の汎用だけ）", () => {
    const rng = createRng(4);
    const seen = new Set<ModifierKey>();
    for (let i = 0; i < SAMPLE_COUNT; i++) seen.add(rollRuneModifier(rng, ["haste", "bloodPact"]));
    expect([...seen].sort()).toEqual(["bloodPrice", "comboFuel", "multiCharge"]);
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
