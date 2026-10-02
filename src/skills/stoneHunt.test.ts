import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { MemoryStorage } from "../meta/testStorage";
import { createSkillRunState, effectiveSlotModifiers, slotModifierView, updateSkills, usedLinks } from "../system/skills";
import { arena, withInput } from "../system/testHelpers";
import { MODIFIERS, SKILL, SKILL_DEFS, activeModifiers, canAttach, modifierLinkCost, modifiersClash, resolveCast, slotLinks, variantEffects } from "./data";
import { dwellChance, stoneFromSeed } from "./generator";
import { addStone, createDefaultSkillProfile, disposeStone, loadSkillProfile, saveSkillProfile, SKILL_PROFILE_KEY } from "./persistence";
import { STONE_TUNING, WEAR_TUNING } from "./tuning2";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone, type StoneWear } from "./types";
import { noteWearCast } from "./wear";

/** スキル石の厳選（docs/ideas/skill-stone-hunt.md）: 変異は必ず 1 本以上・宿り符・処分（砕く / 注ぎ）・使い込みの 1 ラン 1 芽 */

const SEEDS = 4000;
const WHIRL: SkillKey = "commonWhirl";

function stone(skillKey: SkillKey, extra: Partial<SkillStone> = {}, seed = 3): SkillStone {
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: seed, skillKey }), variants: [], ...extra };
}

function withStones(stones: readonly SkillStone[]): GameState {
  const state = arena(5);
  const loadout = [stones[0]?.id ?? null, null, null, null];
  state.skills = createSkillRunState({ version: 1, loadout, stones: [...stones] });
  updateSkills(state, withInput({}), 0);
  return state;
}

/** そのスキルに付けられる、リンク 1 本の通常の符（型替え符を除く） */
function plainRunes(skillKey: SkillKey): ModifierKey[] {
  const def = SKILL_DEFS[skillKey];
  return MODIFIER_KEYS.filter((k) => canAttach(def, k) && !MODIFIERS[k].reshape && modifierLinkCost(k) === 1);
}

/** 互いにぶつからない符を n 枚 */
function compatibleRunes(skillKey: SkillKey, n: number): ModifierKey[] {
  const out: ModifierKey[] = [];
  for (const k of plainRunes(skillKey)) {
    if (out.some((o) => modifiersClash(o, k))) continue;
    out.push(k);
    if (out.length === n) break;
  }
  return out;
}

function wear(casts: number, buds: StoneWear["buds"] = []): StoneWear {
  return { casts, hits: casts * 2, buds };
}

describe("石の生成", () => {
  it("軸を持つスキルの石は変異を必ず 1 本以上持つ（「変異なし」は出ない）", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = stoneFromSeed(seed, { foundDepth: 5, now: 0 });
      if (SKILL_DEFS[s.skillKey].axes.length === 0) continue;
      expect(s.variants.length, `${s.skillKey} seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("宿り符の確率は深度 1 で最小、dwellCapDepth 以降は最大で、間は深いほど上がる", () => {
    expect(dwellChance(1)).toBeCloseTo(STONE_TUNING.dwellChanceMin);
    expect(dwellChance(STONE_TUNING.dwellCapDepth)).toBeCloseTo(STONE_TUNING.dwellChanceMax);
    expect(dwellChance(STONE_TUNING.dwellCapDepth * 3)).toBeCloseTo(STONE_TUNING.dwellChanceMax);
    expect(dwellChance(10)).toBeGreaterThan(dwellChance(2));
  });

  it("宿り符はまれで、宿るのはそのスキルに付けられる符だけ", () => {
    let dwelling = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = stoneFromSeed(seed, { foundDepth: STONE_TUNING.dwellCapDepth, now: 0 });
      if (s.dwell === undefined) continue;
      dwelling += 1;
      expect(canAttach(SKILL_DEFS[s.skillKey], s.dwell), `${s.skillKey} に ${s.dwell}`).toBe(true);
    }
    const rate = dwelling / SEEDS;
    expect(rate).toBeGreaterThan(0);
    expect(rate, "最大の確率の 2 倍は超えない").toBeLessThan(STONE_TUNING.dwellChanceMax * 2);
  });

  it("同じ seed なら同じ宿り符（決定的）", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = stoneFromSeed(seed, { foundDepth: 30, now: 0 });
      const b = stoneFromSeed(seed, { foundDepth: 30, now: 99 });
      expect(a.dwell).toBe(b.dwell);
      expect(a.variants).toEqual(b.variants);
    }
  });
});

describe("宿り符の効き方", () => {
  it("リンクを使わずに効く: リンクを埋めた符と一緒に全部効く", () => {
    const def = SKILL_DEFS[WHIRL];
    const links = slotLinks(0);
    const runes = compatibleRunes(WHIRL, links + 1);
    const dwell = runes[links];
    if (dwell === undefined) throw new Error("符が足りない");
    const chosen = runes.slice(0, links);
    const active = activeModifiers(def, links, chosen, dwell);
    expect(active).toEqual([dwell, ...chosen]);
  });

  it("ラン内で同じ符を付けても重ねて効かず、そちらはリンクも使わない", () => {
    const def = SKILL_DEFS[WHIRL];
    const [dwell, a, b] = compatibleRunes(WHIRL, 3);
    if (dwell === undefined || a === undefined || b === undefined) throw new Error("符が足りない");
    const active = activeModifiers(def, 2, [dwell, a, b], dwell);
    expect(active).toEqual([dwell, a, b]);
  });

  it("宿り符とぶつかる符は効かない（宿り符が優先）", () => {
    let found = false;
    for (const skillKey of SKILL_KEYS) {
      const def = SKILL_DEFS[skillKey];
      const pool = plainRunes(skillKey);
      for (const a of pool) {
        const b = pool.find((k) => k !== a && modifiersClash(a, k));
        if (b === undefined) continue;
        expect(activeModifiers(def, SKILL.slotLinks[0] ?? 4, [b], a)).toEqual([a]);
        found = true;
        break;
      }
      if (found) break;
    }
    expect(found, "ぶつかる符の組が 1 つはある").toBe(true);
  });

  it("発動の数値は、その符をラン内で付けたときと同じ", () => {
    const def = SKILL_DEFS[WHIRL];
    const [dwell] = compatibleRunes(WHIRL, 1);
    if (dwell === undefined) throw new Error("符が無い");
    const viaDwell = resolveCast(def, stone(WHIRL, { dwell }), [], 0);
    const viaRun = resolveCast(def, stone(WHIRL), [dwell], 0);
    expect(viaDwell.damageMul).toBeCloseTo(viaRun.damageMul);
    expect(viaDwell.areaMul).toBeCloseTo(viaRun.areaMul);
    expect(viaDwell.timeMul).toBeCloseTo(viaRun.timeMul);
    expect(viaDwell.countBonus).toBe(viaRun.countBonus);
  });

  it("スロットの実効の符の先頭に入り、リンクの使用と穴の並びには数えない", () => {
    const [dwell, run] = compatibleRunes(WHIRL, 2);
    if (dwell === undefined || run === undefined) throw new Error("符が足りない");
    const state = withStones([stone(WHIRL, { dwell })]);
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("no slot");
    slot.runModifiers.push(run);
    expect(effectiveSlotModifiers(state.skills, 0)).toEqual([dwell, run]);
    expect(usedLinks(state.skills, 0), "宿り符はリンクを使わない").toBe(modifierLinkCost(run));
    expect(slotModifierView(state, 0).map((m) => m.key), "穴には拾った符だけ").toEqual([run]);
  });
});

describe("宿り符の保存", () => {
  it("保存して読み直しても宿り符が残る。知らない符・付けられない符は無しとして読む", () => {
    const [dwell] = compatibleRunes(WHIRL, 1);
    if (dwell === undefined) throw new Error("符が無い");
    const storage = new MemoryStorage();
    const profile = createDefaultSkillProfile();
    const kept = stone(WHIRL, { dwell }, 7);
    addStone(profile, kept);
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage).stones.find((s) => s.id === kept.id)?.dwell).toBe(dwell);

    const raw = JSON.parse(storage.getItem(SKILL_PROFILE_KEY) ?? "{}") as { stones: Record<string, unknown>[] };
    for (const s of raw.stones) if (s.id === kept.id) s.dwell = "noSuchRune";
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify(raw));
    expect(loadSkillProfile(storage).stones.find((s) => s.id === kept.id)?.dwell).toBeUndefined();
  });

  it("倉庫の上限は 400", () => {
    expect(SKILL.stashCapacity).toBe(400);
  });
});

describe("処分（砕く・注ぎ）", () => {
  it("処分すると石が消え、冥響が返る（宿り符のある石は多い）", () => {
    const [dwell] = compatibleRunes(WHIRL, 1);
    if (dwell === undefined) throw new Error("符が無い");
    const profile = { version: 1 as const, loadout: [null, null, null, null], stones: [stone(WHIRL, {}, 1), stone(WHIRL, { dwell }, 2)] };
    const [plain, rare] = profile.stones;
    if (!plain || !rare) throw new Error("石が無い");
    expect(disposeStone(profile, plain.id)?.umbra).toBe(STONE_TUNING.shatterUmbra);
    expect(disposeStone(profile, rare.id)?.umbra).toBe(STONE_TUNING.shatterUmbraDwell);
    expect(profile.stones).toHaveLength(0);
  });

  it("同じスキルの石へ注ぐと使い込みの pourShare が移る（芽そのものは移さない）", () => {
    const giver = stone(WHIRL, { wear: wear(1000, ["power"]) }, 1);
    const taker = stone(WHIRL, { wear: wear(10) }, 2);
    const profile = { version: 1 as const, loadout: [taker.id, null, null, null], stones: [giver, taker] };
    const r = disposeStone(profile, giver.id, taker.id);
    expect(r?.poured).toBe(taker.id);
    expect(taker.wear?.casts).toBe(10 + Math.floor(1000 * STONE_TUNING.pourShare));
    expect(taker.wear?.hits).toBe(20 + Math.floor(2000 * STONE_TUNING.pourShare));
    expect(taker.wear?.buds, "芽は移らない").toEqual([]);
  });

  it("違うスキルの石へは注がない（冥響だけ）", () => {
    const giver = stone(WHIRL, { wear: wear(1000) }, 1);
    const taker = stone("haste", { wear: wear(10) }, 2);
    const profile = { version: 1 as const, loadout: [taker.id, null, null, null], stones: [giver, taker] };
    const r = disposeStone(profile, giver.id, taker.id);
    expect(r?.poured).toBeNull();
    expect(taker.wear?.casts).toBe(10);
  });
});

describe("使い込みの芽（装備の芽と同じ厳しさ）", () => {
  it("節目は 400 / 1600 回", () => {
    expect(WEAR_TUNING.milestones).toEqual([400, 1600]);
  });

  it("同じ石には 1 ランで芽 1 つまで。止めた節目は次のランの最初の発動で芽になる", () => {
    const s = stone(WHIRL, { wear: wear(5000) });
    const state = withStones([s]);
    expect(noteWearCast(state, 0), "1 つ目は出る").toBe("power");
    expect(noteWearCast(state, 0), "同じランの 2 つ目は止める").toBeNull();
    expect(s.wear?.buds).toHaveLength(1);
    const next = withStones([s]);
    expect(noteWearCast(next, 0), "次のランで出る").toBe("power");
    expect(s.wear?.buds).toHaveLength(2);
  });
});

describe("変異の見せ方", () => {
  it("変異の量は伸びる側を先に並べ、0 の量は出さない", () => {
    const s = stone(WHIRL, { variants: [{ axis: "areaVsDamage", value: 0.5 }] });
    const effects = variantEffects(s);
    expect(effects.map((e) => e.label)).toEqual(["範囲", "威力"]);
    expect(effects[0]?.good).toBe(true);
    expect(effects[1]?.good).toBe(false);
  });

  it("負の値なら向きが逆になる（範囲が縮み威力が伸びる）", () => {
    const s = stone(WHIRL, { variants: [{ axis: "areaVsDamage", value: -0.5 }] });
    const effects = variantEffects(s);
    expect(effects[0]).toMatchObject({ label: "威力", good: true });
    expect(effects[1]).toMatchObject({ label: "範囲", good: false });
  });
});
