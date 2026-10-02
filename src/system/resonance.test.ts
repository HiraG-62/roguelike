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
  easeOfRing,
  hueResonates,
  refreshResonance,
  TWIN_RING_IMPLICIT,
  resonanceBySource,
  resonanceEaseOf,
  resonanceOrigins,
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

describe("双頭の指輪: あと 1 つで揃う共鳴の成立", () => {
  /** burn は源 2・糧 1（糧が足りない）、shock は源 1・糧 2（源が足りない）、poison は源 0・糧 0 */
  const counts = countProfiles([kw(["burn", "shock"], ["burn"]), kw(["burn"], ["shock"]), kw([], ["shock"])]);

  it("指輪なし（ease 0）では何も成立しない", () => {
    expect(resonanceSteps(counts)).toEqual([]);
  });

  it("ease 1 は源 + 糧の多い順（同数は KEYWORDS 順）の 1 語だけ 1 段にする。表示の源・糧の数は実際のまま", () => {
    const steps = resonanceSteps(counts, 1);
    expect(steps).toHaveLength(1);
    const first = steps[0];
    expect(first?.step).toBe(1);
    expect(first ? counts[first.keyword].produces : -1).toBe(first?.produces);
    expect(first ? counts[first.keyword].consumes : -1).toBe(first?.consumes);
  });

  it("ease 2 なら足りない語 2 つが成立し、両方足りない語（源 0・糧 0）は成立しない", () => {
    const eased = resonanceSteps(counts, 2).map((s) => s.keyword);
    expect(eased.sort()).toEqual(["burn", "shock"]);
    const both = countProfiles([kw(["poison"], []), kw([], ["poison"])]);
    expect(resonanceSteps(both, 2), "源 1・糧 1 は両側が足りない").toEqual([]);
  });

  it("成立済みの語や、あと 2 つ以上足りない語には効かない（成立済みの段は変わらない）", () => {
    const full = countProfiles([kw(["burn"], ["burn"]), kw(["burn"], ["burn"])]);
    expect(resonanceSteps(full, 2)).toEqual(resonanceSteps(full));
  });

  it("resonanceEaseOf: 指輪の implicit の値を RESONANCE.ringEaseMax で切って読み、指輪が無ければ 0", () => {
    const state = bareArena();
    expect(resonanceEaseOf(state)).toBe(0);
    const ring = relicWith("ring", []);
    state.profile.equipment.ring = { ...ring, implicit: { key: TWIN_RING_IMPLICIT, value: 1 } };
    expect(resonanceEaseOf(state)).toBe(1);
    state.profile.equipment.ring = { ...ring, implicit: { key: TWIN_RING_IMPLICIT, value: 4 } };
    expect(resonanceEaseOf(state), "旧セーブの値 4 は上限で切る").toBe(RESONANCE.ringEaseMax);
    state.profile.equipment.ring = { ...ring, implicit: { key: "implicit.boneRing", value: 3 } };
    expect(resonanceEaseOf(state), "別の implicit は数えない").toBe(0);
  });

  it("双頭の指輪を着けると、糧が 1 つ足りない語が 1 段で成立する（装備の付け替えで数え直す）", () => {
    const state = bareArena();
    const plan = COUNTED.flatMap((k) => {
      const boons = fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks - 1);
      return boons && boons.length > 0 ? [{ k, boons }] : [];
    })[0];
    if (!plan) throw new Error("糧が 1 つ足りない数えの組が見つからない");
    state.boons = plan.boons;
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(stepOf(state, plan.k), "指輪なし").toBe(0);
    const ring = relicWith("ring", []);
    state.profile.equipment.ring = { ...ring, implicit: { key: TWIN_RING_IMPLICIT, value: RESONANCE.ringEaseMax } };
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(stepOf(state, plan.k), "指輪で成立").toBeGreaterThanOrEqual(1);
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

  it("stats へ畳む語の段がステップの数え直しで変わったら、その場で stats を畳み直す", () => {
    const state = bareArena();
    const plan = KEYWORD_STAT.flatMap((k) => {
      const boons = fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks);
      return boons ? [{ k, boons }] : [];
    })[0];
    if (!plan) throw new Error("stats へ畳む語をそろえる祝福が無い");
    // applyStats を通さずに出どころを足す（符の拾い・移しと同じく、数え直しは updateSkills が拾う）
    state.boons = plan.boons;
    updateSkills(state, withInput({}), 0);
    expect(stepOf(state, plan.k), "共鳴が立つ").toBeGreaterThan(0);
    const folded = structuredClone(state.stats);
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(folded, "装備を付け替えたときと同じ stats になっている").toEqual(state.stats);
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

  it("出どころが変わらなければ 2 回目の数え直しは段を置き直さない（false）", () => {
    const state = bareArena();
    refreshResonance(state);
    const steps = state.boonRun.resonance;
    expect(refreshResonance(state)).toBe(false);
    expect(state.boonRun.resonance, "段の列は同じ参照のまま").toBe(steps);
  });

  it("装備の性質を同じ配列の中で差し替えても数え直す（闇市の差し替えの形）", () => {
    const state = bareArena();
    const plan = COUNTED.flatMap((k) => {
      const def = AFFIXES.find((d) => consumesOf(d, k) && d.slots.includes("ring"));
      const filler = AFFIXES.find((d) => d.slots.includes("ring") && d.keywords !== undefined && !profileTouches(d.keywords, k));
      const boons = def && filler ? fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks - 1) : null;
      return def && filler && boons ? [{ k, def, filler, boons }] : [];
    })[0];
    if (!plan) throw new Error("数えの組が見つからない");
    state.boons = plan.boons;
    const ring = relicWith("ring", [plan.filler]);
    state.profile.equipment.ring = ring;
    refreshResonance(state);
    expect(stepOf(state, plan.k), "糧が 1 つ足りない").toBe(0);
    ring.affixes[0] = { key: plan.def.key, value: 1 };
    expect(refreshResonance(state), "差し替えで段が変わる").toBe(true);
    expect(stepOf(state, plan.k)).toBe(1);
  });

  it("段の列を外から置き換えたら数え直して戻す", () => {
    const state = bareArena();
    const k = COUNTED.find((w) => fillWithBoons(state, w, RESONANCE.minSources, RESONANCE.minSinks) !== null);
    if (!k) throw new Error("語が無い");
    state.boons = fillWithBoons(state, k, RESONANCE.minSources, RESONANCE.minSinks) ?? [];
    refreshResonance(state);
    expect(stepOf(state, k)).toBe(1);
    state.boonRun.resonance = [];
    expect(refreshResonance(state)).toBe(true);
    expect(stepOf(state, k), "置き換えた後も元の段に戻る").toBe(1);
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

describe("出どころ付きの共鳴の数え（resonanceBySource）", () => {
  /** 本物の state（祝福・ジョブ・型・遺物・石）で数え、身元の無い数えと突き合わせる */
  function richState(): GameState {
    const state = bareArena();
    state.profile.equipment.ring = relicWith("ring", AFFIXES.filter((d) => d.slots.includes("ring") && d.keywords !== undefined).slice(0, 2));
    state.boons = BOON_KEYS.slice(0, 6);
    equipRune(state, SKILL_KEYS[0] ?? "dashStrike", MODIFIER_KEYS[0] ?? "wide");
    return state;
  }

  it("語ごとの出どころの数が countKeywords の数と一致し、段が resonanceSteps と一致する", () => {
    const state = richState();
    const by = resonanceBySource(state);
    const counts = countKeywords(state);
    for (const k of KEYWORDS) {
      expect(by[k].produces.length, `${k} の源`).toBe(counts[k].produces);
      expect(by[k].consumes.length, `${k} の糧`).toBe(counts[k].consumes);
      expect(by[k].amplifies.length, `${k} の強め`).toBe(counts[k].amplifies);
    }
    const expected = new Map(resonanceSteps(counts, resonanceEaseOf(state)).map((s) => [s.keyword, s.step] as const));
    for (const k of KEYWORDS) expect(by[k].step, `${k} の段`).toBe(expected.get(k) ?? 0);
  });

  it("refreshResonance が置く段（boonRun.resonance）と同じ段になる", () => {
    const state = richState();
    refreshResonance(state);
    const by = resonanceBySource(state);
    const fromBy = KEYWORDS.filter((k) => by[k].step > 0).map((k) => ({ keyword: k, step: by[k].step }));
    expect(fromBy).toEqual(state.boonRun.resonance.map((s) => ({ keyword: s.keyword, step: s.step })));
  });

  it("出どころの身元は種類と識別子を持つ（遺物 = id と部位、石 = 枠の位置、祝福 = key、ジョブ・型）", () => {
    const state = richState();
    const origins = resonanceOrigins(state).map((o) => o.origin);
    const ring = state.profile.equipment.ring;
    expect(origins.find((o) => o.kind === "relic"), "遺物").toEqual({ kind: "relic", id: ring?.id, slot: "ring" });
    expect(origins.find((o) => o.kind === "stone")?.index, "石の枠の位置").toBe(0);
    expect(origins.filter((o) => o.kind === "boon").map((o) => o.id), "祝福").toEqual(state.boons);
    expect(origins.find((o) => o.kind === "job")?.id, "ジョブ").toBe(state.job);
    expect(origins.find((o) => o.kind === "form"), "型").toBeDefined();
  });

  it("語の写しはキャッシュの同じ参照で、出どころが変わらなければ数え直さない", () => {
    const state = richState();
    const a = resonanceOrigins(state).map((o) => o.profile);
    const b = resonanceOrigins(state).map((o) => o.profile);
    expect(a.length).toBe(b.length);
    a.forEach((p, i) => expect(p, `${i} 番目の参照`).toBe(b[i]));
    refreshResonance(state);
    expect(refreshResonance(state), "出どころが変わらなければ数え直さない").toBe(false);
  });

  it("素手の封印中は遺物の出どころが無い", () => {
    const state = richState();
    state.origin = "unarmed";
    state.depth = 1;
    expect(resonanceOrigins(state).some((o) => o.origin.kind === "relic")).toBe(false);
  });

  it("easeOfRing: 双頭の指輪の implicit を ringEaseMax で切り、指輪なし・別の implicit は 0", () => {
    const ring = relicWith("ring", []);
    expect(easeOfRing(null)).toBe(0);
    expect(easeOfRing({ ...ring, implicit: { key: TWIN_RING_IMPLICIT, value: 1 } })).toBe(1);
    expect(easeOfRing({ ...ring, implicit: { key: TWIN_RING_IMPLICIT, value: 9 } })).toBe(RESONANCE.ringEaseMax);
    expect(easeOfRing({ ...ring, implicit: { key: "implicit.boneRing", value: 3 } })).toBe(0);
  });
});
