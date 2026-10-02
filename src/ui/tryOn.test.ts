import { describe, expect, it } from "vitest";
import { KEYWORDS, type Keyword, type KeywordProfile, kw } from "../core/keywords";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { MENU_BUDGET, RESONANCE } from "../data/tuning";
import { AFFIXES, type AffixDef } from "../loot/affixes";
import { basesForSlot } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { computeStats } from "../loot/stats";
import { createEmptyEquipment, type Item, type Slot } from "../loot/types";
import { stoneFromSeed } from "../skills/generator";
import { SKILL_KEYS, type SkillKey } from "../skills/types";
import { BOON_KEYS } from "../system/boonDefs";
import { applyStats } from "../system/player";
import {
  RESONANCE_EXCLUDED,
  TWIN_RING_IMPLICIT,
  resonanceBySource,
  resonanceBySourceOf,
  type OriginProfile,
} from "../system/resonance";
import { createSkillRunState } from "../system/skills";
import { arena } from "../system/testHelpers";
import {
  beadsOfBand,
  compareBands,
  compareFit,
  crestBands,
  foldBeads,
  keywordsOfOrigin,
  sameOrigin,
  thinnedKeywords,
  tryOn,
  tryOnBase,
  type TryOnBase,
} from "./tryOn";

const EXCLUDED = new Set<Keyword>(RESONANCE_EXCLUDED);
const COUNTED: readonly Keyword[] = KEYWORDS.filter((k) => !EXCLUDED.has(k));
const MIN_P = RESONANCE.minSources;
const MIN_C = RESONANCE.minSinks;

// -----------------------------------------------------------------------------
// 純粋な出どころ列（身元だけで組む）
// -----------------------------------------------------------------------------

function fake(id: string, profile: KeywordProfile): OriginProfile {
  return { origin: { kind: "boon", id }, profile };
}

/** 語 keywords を、源 MIN_P 個・糧 MIN_C 個の出どころで揃えて 1 段にする */
function standing(prefix: string, keywords: readonly Keyword[]): OriginProfile[] {
  const out: OriginProfile[] = [];
  for (let i = 0; i < MIN_P; i++) out.push(fake(`${prefix}-p${i}`, kw(keywords)));
  for (let i = 0; i < MIN_C; i++) out.push(fake(`${prefix}-c${i}`, kw([], keywords)));
  return out;
}

function stepOfBy(by: ReturnType<typeof resonanceBySourceOf>, k: Keyword): number {
  return by[k].step;
}

describe("紋の帯の並び（crestBands）", () => {
  it("段の立った系統は段の高い順 → 出どころの多い順 → KEYWORDS 順で、上限本数で切る", () => {
    const [a, b, c, d, e, f] = COUNTED;
    if (!a || !b || !c || !d || !e || !f) throw new Error("語が足りない");
    // a・b・c は 1 段、d は強め 1 つで 2 段、e は 1 段で出どころが多い、f は上限の外へ溢れる
    const sources = [
      ...standing("x", [a, b, c, d, e, f]),
      fake("amp", { produces: [], consumes: [], amplifies: [d] }),
      fake("extra", kw([e])),
    ];
    const bands = crestBands(resonanceBySourceOf(sources));
    const stepped = bands.filter((x) => !x.undercurrent).map((x) => x.keyword);
    expect(stepped, "段の高い d が先頭、次に出どころの多い e、残りは KEYWORDS 順").toEqual([d, e, a, b]);
    expect(stepped.length, "段の立った帯の上限").toBe(MENU_BUDGET.bands.stepped);
    expect(stepped, "上限の外の c・f は帯にならない").not.toContain(f);
  });

  it("伏流は源か糧を 1 つ以上持つが段の立っていない系統で、足りない数の少ない順に上限本数まで", () => {
    const [a, b, c, d] = COUNTED;
    if (!a || !b || !c || !d) throw new Error("語が足りない");
    // a は源だけ 1、b は源 MIN_P・糧 0（糧だけ足りない）、c は源 MIN_P 糧 MIN_C - 1（あと 1 つ）、d は何も無い
    const sources: OriginProfile[] = [fake("a", kw([a]))];
    for (let i = 0; i < MIN_P; i++) sources.push(fake(`b${i}`, kw([b])));
    for (let i = 0; i < MIN_P; i++) sources.push(fake(`c${i}`, kw([c])));
    for (let i = 0; i < MIN_C - 1; i++) sources.push(fake(`cc${i}`, kw([], [c])));
    const bands = crestBands(resonanceBySourceOf(sources));
    const under = bands.filter((x) => x.undercurrent);
    expect(under.map((x) => x.keyword), "あと 1 つの c が先頭。上限本数で切る").toEqual([c, b].slice(0, MENU_BUDGET.bands.undercurrent));
    expect(under[0]?.short, "足りない数").toBe(1);
    expect(bands.some((x) => x.keyword === d), "何も持たない系統は帯にならない").toBe(false);
  });

  it("数えない語（色・反転・無属性）は帯にならない", () => {
    const excluded = RESONANCE_EXCLUDED[0];
    if (!excluded) throw new Error("数えない語が無い");
    const bands = crestBands(resonanceBySourceOf(standing("x", [excluded])));
    expect(bands).toEqual([]);
  });

  it("帯は段 → 伏流の順に並び、各帯は出どころの列を持つ", () => {
    const [a, b] = COUNTED;
    if (!a || !b) throw new Error("語が足りない");
    const bands = crestBands(resonanceBySourceOf([...standing("x", [a]), fake("y", kw([b]))]));
    expect(bands.map((x) => [x.keyword, x.undercurrent])).toEqual([
      [a, false],
      [b, true],
    ]);
    expect(bands[0]?.origins.produces.map((o) => o.id)).toEqual(Array.from({ length: MIN_P }, (_, i) => `x-p${i}`));
  });
});

describe("珠の畳み（foldBeads・beadsOfBand）", () => {
  const origins = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "boon" as const, id: `b${i}` }));

  it("上限以内ならそのまま並べ、畳まない", () => {
    const col = foldBeads(origins(4), 4);
    expect(col.shown.length).toBe(4);
    expect(col.folded).toBe(0);
    expect(col.foldDots).toBe(0);
  });

  it("上限を超えたら畳んだ珠 1 つぶんの枠を空け、残りを畳む（点は 1〜3）", () => {
    const col = foldBeads(origins(5), 4);
    expect(col.shown.map((o) => o.id)).toEqual(["b0", "b1", "b2"]);
    expect(col.folded).toBe(2);
    expect(col.foldDots).toBe(2);
    expect(foldBeads(origins(9), 4).foldDots, "点は 3 まで").toBe(3);
  });

  it("帯の珠は源・糧・強めの上限（予算の JSON）で畳む", () => {
    const [a] = COUNTED;
    if (!a) throw new Error("語が無い");
    const many: OriginProfile[] = [];
    for (let i = 0; i < MENU_BUDGET.beads.source + 2; i++) many.push(fake(`p${i}`, kw([a])));
    for (let i = 0; i < MIN_C; i++) many.push(fake(`c${i}`, kw([], [a])));
    const band = crestBands(resonanceBySourceOf(many))[0];
    if (!band) throw new Error("帯が無い");
    const beads = beadsOfBand(band);
    expect(beads.source.shown.length + (beads.source.folded > 0 ? 1 : 0), "源の珠の見た目の数").toBeLessThanOrEqual(MENU_BUDGET.beads.source);
    expect(beads.source.folded).toBeGreaterThan(0);
    expect(beads.sink.folded, "糧は畳まない").toBe(0);
  });
});

describe("出どころの照合", () => {
  it("sameOrigin は種類・識別子・部位・枠の位置が全部同じときだけ真", () => {
    expect(sameOrigin({ kind: "relic", id: "i1", slot: "ring" }, { kind: "relic", id: "i1", slot: "ring" })).toBe(true);
    expect(sameOrigin({ kind: "relic", id: "i1", slot: "ring" }, { kind: "relic", id: "i1", slot: "amulet" })).toBe(false);
    expect(sameOrigin({ kind: "stone", id: "s", index: 0 }, { kind: "stone", id: "s", index: 1 })).toBe(false);
    expect(sameOrigin({ kind: "boon", id: "x" }, { kind: "job", id: "x" })).toBe(false);
  });

  it("keywordsOfOrigin はその出どころが関わる系統を KEYWORDS 順に返す", () => {
    const [a, b, c] = COUNTED;
    if (!a || !b || !c) throw new Error("語が足りない");
    const sources = [fake("s1", kw([c], [a])), fake("s2", kw([b]))];
    const by = resonanceBySourceOf(sources);
    expect(keywordsOfOrigin(by, { kind: "boon", id: "s1" })).toEqual([a, c]);
    expect(keywordsOfOrigin(by, { kind: "boon", id: "none" })).toEqual([]);
  });
});

describe("動く紋（compareBands）", () => {
  it("太る・ひび・消える・新しく立つ・動かないを段の差で分ける", () => {
    const [a, b, c, d] = COUNTED;
    if (!a || !b || !c || !d) throw new Error("語が足りない");
    // before: a は強め 1 つで 2 段、b は 1 段、c は 1 段、d は立たない
    const before = [...standing("x", [a, b, c]), fake("amp", { produces: [], consumes: [], amplifies: [a] })];
    // after: 強めが外れて a は 1 段へ（ひび）、b の糧が外れて消える、d が新しく立つ、c は同じ
    const after = [
      ...before.filter((s) => s.origin.id !== "amp" && s.origin.id !== "x-c0"),
      fake("x-c0", kw([], [a, c])),
      ...standing("y", [d]),
    ];
    const result = compareBands(resonanceBySourceOf(before), resonanceBySourceOf(after));
    const change = (k: Keyword) => result.deltas.find((x) => x.keyword === k)?.change;
    expect(change(a), "強めを失った a はひび").toBe("crack");
    expect(change(b), "糧を失った b は消える").toBe("gone");
    expect(change(c), "c は動かない").toBe("same");
    expect(change(d), "d は新しく立つ").toBe("new");
    expect(result.summary).toEqual({ lost: 1, cracked: 1, gained: 1 });
  });

  it("行が上限を超えたら、動かない行を後ろから落として動く帯を必ず残す", () => {
    const six = COUNTED.slice(0, 6);
    const [a, b, c, d, e, f] = six;
    if (!a || !b || !c || !d || !e || !f) throw new Error("語が足りない");
    const under = COUNTED[6];
    const under2 = COUNTED[7];
    if (!under || !under2) throw new Error("語が足りない");
    const before = [...standing("x", [a, b, c, d]), fake("u", kw([under, under2]))];
    // e・f が強め 2 つで 3 段になり、段の立った上位 4 本を取る
    const after = [...before, ...standing("y", [e, f]), fake("amp1", { produces: [], consumes: [], amplifies: [e, f] }), fake("amp2", { produces: [], consumes: [], amplifies: [e, f] })];
    const result = compareBands(resonanceBySourceOf(before), resonanceBySourceOf(after));
    expect(result.before.length, "前の帯は段 4 + 伏流 2").toBe(MENU_BUDGET.bands.stepped + MENU_BUDGET.bands.undercurrent);
    expect(result.deltas.length, "動く紋の行の上限").toBe(MENU_BUDGET.morphRows);
    const moved = result.deltas.filter((x) => x.change === "new").map((x) => x.keyword);
    expect(moved.sort(), "新しく立つ e・f は残る").toEqual([e, f].sort());
    const keys = result.deltas.map((x) => x.keyword);
    expect(keys, "動かない伏流から落ちる").not.toContain(under);
    expect(keys).not.toContain(under2);
  });

  it("compareFit は失う系統が少ない順 → ひびが少ない順 → 太る系統が多い順", () => {
    const base = { lost: 0, cracked: 0, gained: 0 };
    expect(compareFit({ ...base, lost: 1 }, { ...base, lost: 0, gained: 5 })).toBeGreaterThan(0);
    expect(compareFit({ ...base, cracked: 1 }, { ...base, cracked: 2 })).toBeLessThan(0);
    expect(compareFit({ ...base, gained: 3 }, { ...base, gained: 1 })).toBeLessThan(0);
    expect(compareFit(base, base)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// state を使った試着
// -----------------------------------------------------------------------------

function bareArena(): GameState {
  const state = arena();
  state.profile.equipment = createEmptyEquipment();
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  return state;
}

/** 部位 slot の遺物に、語を持つ性質を載せる（id は区別のため付け直す） */
function relicWith(slot: Slot, id: string, defs: readonly AffixDef[]): Item {
  const base = basesForSlot(slot, 99)[0];
  if (!base) throw new Error(`base missing: ${slot}`);
  const item = generateItem(createRng(1), { baseKey: base.key, plain: true, itemLevel: 5, foundDepth: 5, now: 0 });
  return { ...item, id, affixes: defs.map((d) => ({ key: d.key, value: 1 })) };
}

/** 語 k を食うだけ（出さない・強めない）性質か */
function consumesOnly(def: AffixDef, k: Keyword): boolean {
  const p = def.keywords;
  return p?.consumes.includes(k) === true && !p.produces.includes(k) && !p.amplifies.includes(k);
}

/** 語 k の源が MIN_P・糧が MIN_C - 1 のビルド（糧があと 1 つ足りない） */
function oneShortBase(k: Keyword): TryOnBase {
  const sources: OriginProfile[] = [];
  for (let i = 0; i < MIN_P; i++) sources.push(fake(`p${i}`, kw([k])));
  for (let i = 0; i < MIN_C - 1; i++) sources.push(fake(`c${i}`, kw([], [k])));
  return { sources, ease: 0, sealed: false, stoneModifiers: [], stoneDwells: [] };
}

const RING_AFFIXES = AFFIXES.filter((d) => d.slots.includes("ring") && d.keywords !== undefined);

describe("試着（tryOn）", () => {
  function richState(): GameState {
    const state = bareArena();
    state.boons = BOON_KEYS.slice(0, 8);
    state.profile.equipment.ring = relicWith("ring", "ring-now", RING_AFFIXES.slice(0, 2));
    return state;
  }

  it("同じ物に替えても何も変わらない", () => {
    const state = richState();
    const ring = state.profile.equipment.ring;
    if (!ring) throw new Error("指輪が無い");
    const result = tryOn(tryOnBase(state), { kind: "relic", slot: "ring", item: ring });
    expect(result.deltas.every((d) => d.change === "same")).toBe(true);
    expect(result.summary).toEqual({ lost: 0, cracked: 0, gained: 0 });
  });

  it("試着の結果は、実際に付け替えて数えた結果と一致する（段・出どころの列とも）", () => {
    const state = richState();
    const base = tryOnBase(state);
    for (let i = 0; i < 6; i++) {
      const candidate = relicWith("ring", `ring-c${i}`, RING_AFFIXES.slice(i, i + 3));
      const tried = tryOn(base, { kind: "relic", slot: "ring", item: candidate });
      const real = bareArena();
      real.boons = state.boons;
      real.profile.equipment.ring = candidate;
      expect(tried.after, `候補 ${i}`).toEqual(crestBands(resonanceBySource(real)));
    }
  });

  it("state を変えない（装備・祝福・段の列・出どころの基準）", () => {
    const state = richState();
    const snapshot = structuredClone({ equipment: state.profile.equipment, boons: state.boons, resonance: state.boonRun.resonance });
    const base = tryOnBase(state);
    const sourcesBefore = base.sources.map((s) => s.origin.id);
    tryOn(base, { kind: "relic", slot: "ring", item: relicWith("ring", "ring-x", RING_AFFIXES.slice(2, 5)) });
    tryOn(base, { kind: "relic", slot: "ring", item: null });
    tryOn(base, { kind: "stone", index: 0, skillKey: SKILL_KEYS[0] ?? "dashStrike" });
    expect({ equipment: state.profile.equipment, boons: state.boons, resonance: state.boonRun.resonance }).toEqual(snapshot);
    expect(base.sources.map((s) => s.origin.id), "基準の列は変わらない").toEqual(sourcesBefore);
  });

  it("外すと細る系統（ひび・消える）が引け、外した部位のぶん出どころが減る", () => {
    const state = richState();
    const base = tryOnBase(state);
    const ring = state.profile.equipment.ring;
    if (!ring) throw new Error("指輪が無い");
    const removed = tryOn(base, { kind: "relic", slot: "ring", item: null });
    const by = resonanceBySource(state);
    const fromRing = keywordsOfOrigin(by, { kind: "relic", id: ring.id, slot: "ring" });
    expect(fromRing.length, "指輪はどれかの系統に関わる").toBeGreaterThan(0);
    for (const d of thinnedKeywords(removed)) {
      expect(fromRing, `細る ${d.keyword} は指輪の関わる系統`).toContain(d.keyword);
      expect(d.to, "段は下がる").toBeLessThan(d.from);
    }
    const bare = bareArena();
    bare.boons = state.boons;
    expect(removed.after, "外した結果は指輪が無い数え").toEqual(crestBands(resonanceBySource(bare)));
  });

  it("糧があと 1 つ足りない系統に、その糧を持つ遺物を付けると新しく立つ", () => {
    const [k] = COUNTED.filter((w) => RING_AFFIXES.some((d) => consumesOnly(d, w)));
    if (!k) throw new Error("糧になる語が無い");
    const def = RING_AFFIXES.find((d) => consumesOnly(d, k));
    if (!def) throw new Error("性質が無い");
    const base = oneShortBase(k);
    expect(stepOfBy(resonanceBySourceOf(base.sources), k), "糧が 1 つ足りない").toBe(0);
    const result = tryOn(base, { kind: "relic", slot: "ring", item: relicWith("ring", "ring-fill", [def]) });
    expect(result.deltas.find((d) => d.keyword === k)?.change, "新しく立つ").toBe("new");
    expect(result.after.some((b) => b.keyword === k && !b.undercurrent), "紋の帯にも段の立った帯として出る").toBe(true);
  });

  it("素手の封印中は遺物の試着が何も変えない", () => {
    const state = richState();
    state.origin = "unarmed";
    state.depth = 1;
    const base = tryOnBase(state);
    expect(base.sealed).toBe(true);
    const result = tryOn(base, { kind: "relic", slot: "ring", item: relicWith("ring", "ring-s", RING_AFFIXES.slice(0, 4)) });
    expect(result.deltas.every((d) => d.change === "same")).toBe(true);
  });

  it("双頭の指輪に替えると、あと 1 つで揃う系統が成立する（ease を数え直す）", () => {
    const [k] = COUNTED;
    if (!k) throw new Error("語が無い");
    const base = oneShortBase(k);
    const ring = { ...relicWith("ring", "ring-twin", []), implicit: { key: TWIN_RING_IMPLICIT, value: RESONANCE.ringEaseMax } };
    const result = tryOn(base, { kind: "relic", slot: "ring", item: ring });
    expect(result.deltas.find((d) => d.keyword === k)?.change).toBe("new");
    const plain = tryOn(base, { kind: "relic", slot: "ring", item: relicWith("ring", "ring-plain", []) });
    expect(plain.deltas.find((d) => d.keyword === k)?.change, "ふつうの指輪では立たない").not.toBe("new");
  });

  it("石の枠の試着は、実際に石を替えて数えた結果と一致する（枠の符は引き継ぐ）", () => {
    const withStone = (skillKey: SkillKey): GameState => {
      const state = bareArena();
      state.boons = BOON_KEYS.slice(0, 6);
      const stone = { ...stoneFromSeed(900, { foundDepth: 1, now: 0, skillKey }), variants: [], links: 2 };
      state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
      return state;
    };
    const first = SKILL_KEYS[0];
    if (!first) throw new Error("スキルが無い");
    const baseState = withStone(first);
    const base = tryOnBase(baseState);
    for (const key of SKILL_KEYS.slice(1, 8)) {
      const tried = tryOn(base, { kind: "stone", index: 0, skillKey: key });
      expect(tried.after, `石 ${key}`).toEqual(crestBands(resonanceBySource(withStone(key))));
    }
    const removed = tryOn(base, { kind: "stone", index: 0, skillKey: null });
    const empty = bareArena();
    empty.boons = baseState.boons;
    empty.skills = createSkillRunState({ version: 1, loadout: [], stones: [] });
    expect(removed.after, "外した結果は石が無い数え").toEqual(crestBands(resonanceBySource(empty)));
  });
});
