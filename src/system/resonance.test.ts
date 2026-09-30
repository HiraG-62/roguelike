import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { KEYWORDS, type Keyword, type KeywordProfile, type ResonanceStep, kw } from "../core/keywords";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { REFORGES, REFORGE_KEYS } from "../data/reforges";
import { RESONANCE } from "../data/tuning";
import { formOfKey } from "../data/weaponForms";
import { AFFIXES, type AffixDef } from "../loot/affixes";
import { basesForSlot } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS, type Item, type Slot, createEmptyEquipment } from "../loot/types";
import { MODIFIERS, SKILL_DEFS, canAttach } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey } from "../skills/types";
import { BOONS, BOON_KEYS, type BoonKey } from "./boonDefs";
import { relicKeywords, skillKeywords } from "./keywords";
import { applyModifiers, collectModifiers } from "./modifiers";
import { applyStats } from "./player";
import {
  HUE_KEYWORD,
  KEYWORD_STAT,
  KEYWORD_TAG,
  RESONANCE_EXCLUDED,
  applyResonanceStats,
  countKeywords,
  countProfiles,
  hueResonates,
  refreshResonance,
  resonanceStepOf,
  resonanceSteps,
  resonanceSummary,
  resonantHue,
} from "./resonance";
import { createSkillRunState, removeRunModifier, updateSkills } from "./skills";
import { arena, withInput } from "./testHelpers";

const EXCLUDED = new Set<Keyword>(RESONANCE_EXCLUDED);
const COUNTED: readonly Keyword[] = KEYWORDS.filter((k) => !EXCLUDED.has(k));

function source(produces: number, consumes: number, amplifies = 0): { produces: number; consumes: number; amplifies: number } {
  return { produces, consumes, amplifies };
}

/** 装備を空にした試合場（数えの基準を小さくする） */
function bareArena(): GameState {
  const state = arena();
  state.profile.equipment = createEmptyEquipment();
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  return state;
}

function stepOf(state: GameState, k: Keyword): number {
  return state.boonRun.resonance.find((s) => s.keyword === k)?.step ?? 0;
}

/** その語だけを出す（食わない・強めない）祝福と、だけを食う祝福 */
function pureBoons(k: Keyword, verb: "produces" | "consumes"): BoonKey[] {
  const other = verb === "produces" ? "consumes" : "produces";
  return BOON_KEYS.filter((b) => {
    const p = BOONS[b].keywords;
    return p[verb].includes(k) && !p[other].includes(k) && !p.amplifies.includes(k);
  });
}

/** state の今の数えに祝福を足して、語 k の源を produces・糧を consumes にそろえる（足りなければ null） */
function fillWithBoons(state: GameState, k: Keyword, produces: number, consumes: number): BoonKey[] | null {
  const base = countKeywords(state)[k];
  const needP = produces - base.produces;
  const needC = consumes - base.consumes;
  if (needP < 0 || needC < 0 || base.amplifies > 0) return null;
  const ps = pureBoons(k, "produces").slice(0, needP);
  const cs = pureBoons(k, "consumes").slice(0, needC);
  if (ps.length < needP || cs.length < needC) return null;
  return [...ps, ...cs];
}

/** 部位 slot の性質なしの遺物に affixes を載せる */
function relicWith(slot: Slot, defs: readonly AffixDef[]): Item {
  const base = basesForSlot(slot, 99)[0];
  if (!base) throw new Error(`base missing: ${slot}`);
  const item = generateItem(createRng(1), { baseKey: base.key, plain: true, itemLevel: 5, foundDepth: 5, now: 0 });
  return { ...item, affixes: defs.map((d) => ({ key: d.key, value: 1 })) };
}

function consumesOf(def: AffixDef, k: Keyword): boolean {
  return def.keywords?.consumes.includes(k) === true && !def.keywords.produces.includes(k) && !def.keywords.amplifies.includes(k);
}

describe("源と糧の共鳴: 段", () => {
  it("源 2・糧 2 で 1 段。どちらかが足りなければ 0", () => {
    expect(resonanceStepOf(source(2, 2))).toBe(1);
    expect(resonanceStepOf(source(1, 2)), "源が 1").toBe(0);
    expect(resonanceStepOf(source(2, 1)), "糧が 1").toBe(0);
    expect(resonanceStepOf(source(0, 0, 3)), "強めだけでは立たない").toBe(0);
  });

  it("強め 1 つで +1 段、源 + 糧が stepEvery ふえるごとに +1 段", () => {
    expect(resonanceStepOf(source(2, 2, 1))).toBe(1 + RESONANCE.amplifyStep);
    expect(resonanceStepOf(source(2 + RESONANCE.stepEvery, 2))).toBe(2);
    expect(resonanceStepOf(source(2 + RESONANCE.stepEvery - 1, 2)), "1 つ足りない").toBe(1);
  });

  it("段は maxSteps で止まる", () => {
    expect(resonanceStepOf(source(20, 20, 5))).toBe(RESONANCE.maxSteps);
  });

  it("出どころ 1 つは語ごと・動詞ごとに 1 と数える", () => {
    const dup: KeywordProfile = { produces: ["burn", "burn"], consumes: ["burn"], amplifies: [] };
    const counts = countProfiles([dup, kw(["burn"])]);
    expect(counts.burn).toEqual({ produces: 2, consumes: 1, amplifies: 0 });
  });

  it("色・反転・無属性は数えない。段 1 以上の語だけ KEYWORDS 順に並ぶ", () => {
    const counts = countProfiles([kw(["crimson", "shock", "burn"], ["crimson", "shock", "burn"]), kw(["crimson", "shock", "burn"], ["crimson", "shock", "burn"])]);
    const steps = resonanceSteps(counts);
    expect(steps.map((s) => s.keyword)).toEqual(["burn", "shock"]);
    expect(steps[0]).toEqual({ keyword: "burn", step: 1, produces: 2, consumes: 2, amplifies: 0 });
  });

  it("数える語はどれも、倍のタグか stats の効き先のどちらか 1 つだけを持つ", () => {
    for (const k of COUNTED) {
      const tag = KEYWORD_TAG[k] !== undefined;
      const stat = (KEYWORD_STAT as readonly Keyword[]).includes(k);
      expect(tag !== stat, `語 ${k}`).toBe(true);
    }
    for (const k of RESONANCE_EXCLUDED) expect(KEYWORD_TAG[k], `数えない語 ${k}`).toBeUndefined();
  });
});

describe("源と糧の共鳴: 効果", () => {
  it("段の倍は Modifier（出所 resonance:<語>）に出て、その語のタグの 1 撃に掛かる", () => {
    const state = arena();
    state.boonRun.resonance = [{ keyword: "burn", step: 2, produces: 3, consumes: 2, amplifies: 1 }];
    const mod = collectModifiers(state).find((m) => m.id === "resonance:burn");
    expect(mod?.kind).toBe("more");
    expect(mod?.tag).toBe("fire");
    expect(mod?.amount).toBeCloseTo(1 + (RESONANCE.stepMul - 1) * 2);
    const fire = applyModifiers(state, { tags: new Set(["fire"]) }, null);
    expect(fire.more.find((m) => m.source === "mod:resonance:burn")?.mul).toBeCloseTo(1 + (RESONANCE.stepMul - 1) * 2);
    const melee = applyModifiers(state, { tags: new Set(["melee"]) }, null);
    expect(melee.more.some((m) => m.source === "mod:resonance:burn"), "近接の 1 撃には掛からない").toBe(false);
  });

  it("倍の無い語は stats に畳む（ダッシュの再使用・見切りの猶予・気力・回復・被ダメ）", () => {
    const steps: ResonanceStep[] = KEYWORD_STAT.map((keyword) => ({ keyword, step: 2, produces: 2, consumes: 2, amplifies: 0 }));
    const stats = { ...DEFAULT_STATS };
    applyResonanceStats(stats, steps);
    const per = RESONANCE.statPerStep;
    expect(stats.dashCooldownMul).toBeCloseTo(DEFAULT_STATS.dashCooldownMul * (1 - per.dash * 2));
    expect(stats.justDodgeWindow).toBeCloseTo(DEFAULT_STATS.justDodgeWindow + per.just * 2);
    expect(stats.manaGainMul).toBeCloseTo(DEFAULT_STATS.manaGainMul + per.mana * 2);
    expect(stats.lifeOnHit).toBeCloseTo(DEFAULT_STATS.lifeOnHit + per.heal * 2);
    expect(stats.damageTakenMul).toBeCloseTo(DEFAULT_STATS.damageTakenMul * (1 - per.ward * 2));
    expect(collectModifiers({ ...arena(), boonRun: { ...arena().boonRun, resonance: steps } }).some((m) => m.id.startsWith("resonance:")), "倍は出さない").toBe(
      false,
    );
  });

  it("彩痕の色は共鳴している状態異常の語の段が最も高い色（同段は TRAIT_COLORS 順）", () => {
    const state = arena();
    expect(resonantHue(state), "共鳴なし").toBeNull();
    state.boonRun.resonance = [
      { keyword: "burn", step: 1, produces: 2, consumes: 2, amplifies: 0 },
      { keyword: "chill", step: 2, produces: 2, consumes: 2, amplifies: 1 },
      { keyword: "shock", step: 2, produces: 2, consumes: 2, amplifies: 1 },
    ];
    expect(resonantHue(state)).toBe("azure");
    expect(hueResonates(state, "crimson")).toBe(true);
    expect(hueResonates(state, "jade")).toBe(false);
    expect(HUE_KEYWORD.umbra).toBe("vulnerable");
    expect(resonanceSummary(state).length, "HUD の 1 行").toBeGreaterThan(0);
    state.boonRun.resonance = [];
    expect(resonanceSummary(state), "共鳴なしは出さない").toBe("");
  });
});

describe("源と糧の共鳴: 数え直し", () => {
  it("同じ遺物の 2 つの性質が同じ語を食っても 1 と数える", () => {
    const pair = COUNTED.flatMap((k) => {
      const defs = AFFIXES.filter((d) => consumesOf(d, k) && d.slots.includes("ring"));
      const [a, b] = defs;
      return a && b ? [{ k, a, b }] : [];
    })[0];
    if (!pair) throw new Error("同じ語を食う指輪の性質が 2 つ無い");
    const item = relicWith("ring", [pair.a, pair.b]);
    expect(relicKeywords(item).consumes.filter((k) => k === pair.k).length).toBe(1);
    const state = bareArena();
    const before = countKeywords(state)[pair.k].consumes;
    state.profile.equipment.ring = item;
    expect(countKeywords(state)[pair.k].consumes - before, "遺物 1 つ = 1").toBe(1);
  });

  it("装備の付け替え（applyStats）で数え直す", () => {
    const state = bareArena();
    const plan = COUNTED.flatMap((k) => {
      const def = AFFIXES.find((d) => consumesOf(d, k) && d.slots.includes("ring"));
      const boons = def ? fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks - 1) : null;
      return def && boons ? [{ k, def, boons }] : [];
    })[0];
    if (!plan) throw new Error("数えの組が見つからない");
    state.boons = plan.boons;
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(stepOf(state, plan.k), "糧が 1 つ足りない").toBe(0);
    state.profile.equipment.ring = relicWith("ring", [plan.def]);
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(stepOf(state, plan.k), "遺物で糧がそろう").toBe(1);
    state.profile.equipment.ring = null;
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(stepOf(state, plan.k), "外すと戻る").toBe(0);
  });

  it("符の付け替えで数え直す（外した次のステップ）", () => {
    const state = bareArena();
    const plan = (() => {
      for (const m of MODIFIER_KEYS) {
        for (const k of MODIFIERS[m].keywords.consumes) {
          if (EXCLUDED.has(k) || MODIFIERS[m].keywords.produces.includes(k) || MODIFIERS[m].keywords.amplifies.includes(k)) continue;
          const skill = SKILL_KEYS.find((s) => canAttach(SKILL_DEFS[s], m) && !profileTouches(skillKeywords(SKILL_DEFS[s]), k));
          if (!skill) continue;
          // 符を差した状態で、糧がちょうど下限になるよう祝福で埋める（符が糧の 1 つ）
          equipRune(state, skill, m);
          updateSkills(state, withInput({}), 0);
          const boons = fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks);
          if (boons) return { m, k, boons };
        }
      }
      return null;
    })();
    if (!plan) throw new Error("数えの組が見つからない");
    state.boons = plan.boons;
    updateSkills(state, withInput({}), 0);
    expect(stepOf(state, plan.k), "符で糧がそろう").toBe(1);
    removeRunModifier(state.skills, 0, plan.m);
    updateSkills(state, withInput({}), 0);
    expect(stepOf(state, plan.k), "外した次のステップで戻る").toBe(0);
  });

  it("持ち替えた型の改鋳は数えない", () => {
    const state = bareArena();
    const form = formOfKey((state.boonRun.baseStats ?? state.stats).moveset).key;
    const own = REFORGE_KEYS.find((k) => REFORGES[k].form === form);
    const other = REFORGE_KEYS.find((k) => REFORGES[k].form !== form);
    if (!own || !other) throw new Error("改鋳が無い");
    const base = countKeywords(state);
    state.reforges = [other];
    expect(countKeywords(state), "他の型の改鋳は数えない").toEqual(base);
    state.reforges = [own];
    const words = REFORGES[own].keywords;
    const first = words?.produces[0] ?? words?.consumes[0] ?? words?.amplifies[0];
    if (!first) throw new Error("改鋳の語が無い");
    const after = countKeywords(state)[first];
    const was = base[first];
    expect(after.produces + after.consumes + after.amplifies, "今の型の改鋳は数える").toBeGreaterThan(was.produces + was.consumes + was.amplifies);
  });

  it("15 型・30 改鋳はどれも語を持つ", () => {
    for (const k of REFORGE_KEYS) {
      const p = REFORGES[k].keywords;
      expect(p !== undefined && p.produces.length + p.consumes.length + p.amplifies.length > 0, `改鋳 ${k}`).toBe(true);
    }
  });

  it("同じ seed・同じ操作なら同じ共鳴", () => {
    const play = (): ResonanceStep[] => {
      const state = createGame(11);
      const k = COUNTED.find((w) => fillWithBoons(state, w, RESONANCE.minSources + 1, RESONANCE.minSinks) !== null);
      if (!k) throw new Error("語が無い");
      state.boons = fillWithBoons(state, k, RESONANCE.minSources + 1, RESONANCE.minSinks) ?? [];
      refreshResonance(state);
      for (let i = 0; i < 30; i++) step(state, withInput({}), FIXED_DT);
      return state.boonRun.resonance.map((s) => ({ ...s }));
    };
    const a = play();
    expect(a.length).toBeGreaterThan(0);
    expect(play()).toEqual(a);
  });
});

function profileTouches(p: Readonly<KeywordProfile>, k: Keyword): boolean {
  return p.produces.includes(k) || p.consumes.includes(k) || p.amplifies.includes(k);
}

/** スロット 0 に石を 1 つ付け、ラン内の符を 1 枚差す */
function equipRune(state: GameState, skill: SkillKey, m: ModifierKey): void {
  const stone = { ...stoneFromSeed(900, { foundDepth: 1, now: 0, skillKey: skill }), variants: [], links: 2 };
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
  const slot = state.skills.slots[0];
  if (!slot) throw new Error("slot missing");
  slot.runModifiers = [m];
}
