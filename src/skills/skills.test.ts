import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { PROFILE_KEY } from "../loot/profile";
import { MODIFIERS, SKILL, SKILL_DEFS, activeModifiers, canAttach, castCooldown, resolveCast } from "./data";
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
import { SKILL_KEYS, type SkillKey, type SkillStone } from "./types";

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
    expect(Object.keys(MODIFIERS)).toHaveLength(4);
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
