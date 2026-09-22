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
  castCooldown,
  formatVariant,
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
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone } from "./types";

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

describe("resolveCast", () => {
  it("リンクが多いほど素の CD が長い（1 本ごと +15%）", () => {
    const def = SKILL_DEFS.whirl;
    const cds = [0, 1, 2, 3].map((links) => castCooldown(def, resolveCast(def, stone("whirl", links), [])));
    for (let i = 1; i < cds.length; i++) expect(cds[i]).toBeGreaterThan(cds[i - 1] ?? 0);
    expect(cds[0]).toBeCloseTo(SKILL.whirl.cooldown);
    expect(cds[3]).toBeCloseTo(SKILL.whirl.cooldown * (1 + SKILL.linkCooldownPenalty * 3));
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
    const def = SKILL_DEFS.frag;
    const p = resolveCast(def, stone("frag", 1), ["multiCharge", "bloodPrice"]);
    expect(p.charges).toBe(1 + SKILL.modifier.multiCharge.extraCharges);
    expect(p.hpCostFraction).toBe(0);
    expect(activeModifiers(SKILL_DEFS.parry, 3, ["echo", "bloodPrice"])).toEqual(["bloodPrice"]);
  });

  it("反響は defense / buff に付かない", () => {
    expect(canAttach(SKILL_DEFS.parry, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.bloodPact, "echo")).toBe(false);
    expect(canAttach(SKILL_DEFS.whirl, "echo")).toBe(true);
  });

  it("修飾子 2 個の組み合わせ（多重 + 血の代償）", () => {
    const p = resolveCast(SKILL_DEFS.frag, stone("frag", 2), ["multiCharge", "bloodPrice"]);
    const m = SKILL.modifier;
    expect(p.damageMul).toBeCloseTo(m.multiCharge.damageMul * m.bloodPrice.damageMul);
    expect(p.hpCostFraction).toBeCloseTo(m.bloodPrice.hpFraction);
    expect(p.cooldownMul).toBeCloseTo((1 + SKILL.linkCooldownPenalty * 2) * m.multiCharge.cooldownMul);
  });

  it("全スキル・全修飾子に定義がある", () => {
    for (const key of SKILL_KEYS) expect(SKILL_DEFS[key].key).toBe(key);
    expect(SKILL_KEYS).toHaveLength(14);
    expect(Object.keys(MODIFIERS)).toEqual([...MODIFIER_KEYS]);
    expect(MODIFIER_KEYS).toHaveLength(10);
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

  it("cooldownVsPotency: CD x0.7 なら効果量 x0.75", () => {
    const p = resolveCast(SKILL_DEFS.haste, stone("haste", 0, { variants: [{ axis: "cooldownVsPotency", value: 1 }] }), []);
    expect(p.cooldownMul).toBeCloseTo(0.7);
    expect(p.potencyMul).toBeCloseTo(0.75);
    expect(formatVariant({ axis: "cooldownVsPotency", value: 1 })).toBe("Cooldown -30% / Potency -25%");
  });

  it("新刻印符の効果（貫通・反動・連鎖・呪い・遅延・拡大）", () => {
    const m = SKILL.modifier;
    const spiral = resolveCast(SKILL_DEFS.spiral, stone("spiral", 1), ["pierce"]);
    expect(spiral.pierce).toBe(m.pierce.count);
    expect(spiral.areaMul).toBeCloseTo(m.pierce.areaMul);
    const recoil = resolveCast(SKILL_DEFS.frag, stone("frag", 1), ["recoil"]);
    expect(recoil.recoil).toBe(m.recoil.speed);
    expect(recoil.damageMul).toBeCloseTo(m.recoil.damageMul);
    const chain = resolveCast(SKILL_DEFS.whirl, stone("whirl", 1), ["chainReset"]);
    expect(chain.killRefund).toBe(true);
    expect(chain.cooldownMul).toBeCloseTo((1 + SKILL.linkCooldownPenalty) * m.chainReset.cooldownMul);
    const curse = resolveCast(SKILL_DEFS.thunder, stone("thunder", 1), ["curse"]);
    expect(curse.curse).toEqual({ duration: m.curse.duration, bonus: m.curse.bonus });
    const delay = resolveCast(SKILL_DEFS.quake, stone("quake", 1), ["delay"]);
    expect(delay.delay).toEqual({ time: m.delay.time, damageMul: m.delay.damageMul });
    const expand = resolveCast(SKILL_DEFS.frostField, stone("frostField", 1), ["expand"]);
    expect(expand.areaMul).toBeCloseTo(m.expand.areaMul);
  });
});

describe("相性表", () => {
  /** 付けられない組み合わせ（これ以外はすべて付く） */
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
    expect(a.loadout).toEqual(a.stones.map((s) => s.id));
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
    expect(loaded.loadout).toEqual([null, "good"]);
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
