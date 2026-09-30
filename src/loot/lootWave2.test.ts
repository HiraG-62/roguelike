import { createIncreased } from "../core/damage";
import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { MOVESET_KEYS } from "../data/weapons";
import { affixDef, applyRoll, formatAffix, implicitDef, traitsFor } from "./affixes";
import { BASES, baseDef } from "./bases";
import { BASE_LEAN } from "./colors";
import { RECALL_COST, craftEcho, createEchoWallet, echoCost, pourGrowth, pouredProvenance, recallBud, type EchoCraftState } from "./crafting";
import { rollUniqueAffixes } from "./generator";
import { fillProvenanceCounters } from "./migrate";
import { UNIQUES } from "./named";
import { loadProfile, saveProfile } from "./profile";
import { bumpProvenance, makeBudOffer, milestoneDef } from "./provenance";
import { computeStats } from "./stats";
import {
  DEFAULT_STATS,
  createEmptyEquipment,
  createEmptyProfile,
  createEmptyProvenance,
  type AffixRoll,
  type Item,
  type PlayerStats,
  type Slot,
  type TraitColor,
  type TraitStats,
} from "./types";

/**
 * 装備の第 2 弾（属性・武器種・銃の弾・地形・新しい状態異常・ジョブ・交戦中）のテスト。
 * 段取り 7d で残った性質・ベース・名のある遺物・残響（呼び戻し・注ぎ）・来歴の節目を検査する
 * （消えた性質・変換・誓約・色の共鳴の拡張・残響の 7 操作の節は外した）
 */

/** 第 2 弾で足して段取り 7d に残った性質 */
const NEW_TRAITS = [
  "prismEdge",
  "backlash",
  "conductor",
  "elementalBreak",
  "chargeCore",
  "branchArt",
  "rapidBrand",
  "brandDetonator",
  "groundRooted",
  "terrainHunter",
  "terrainBurst",
  "emberTrail",
  "frostTrail",
  "groundMend",
  "siegeGuard",
  "switchBreath",
] as const;

const NEW_BASES = [
  "katana",
  "zanbato",
  "twinDaggers",
  "halberd",
  "sickle",
  "cestus",
  "chainWhip",
  "shakujo",
  "crystalWand",
  "blunderbuss",
  "crossbow",
  "chakram",
  "handCannon",
  "caltrops",
  "seekerOrb",
  "mino",
] as const;

const PERCENT = 0.01;

function stats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    increased: createIncreased(),
    more: [],
    keystones: [],
    triggers: [],
    statusProcs: [],
    attributes: { ...DEFAULT_STATS.attributes },
    traits: { ...DEFAULT_STATS.traits },
    resist: { ...DEFAULT_STATS.resist },
    infuse: { ...DEFAULT_STATS.infuse },
    modifiers: [],
  };
}

function roll(key: string, value: number, value2?: number, color?: TraitColor): AffixRoll {
  const out: AffixRoll = { key, value, nominal: value, flux: 0, origin: "found" };
  if (value2 !== undefined) {
    out.value2 = value2;
    out.nominal2 = value2;
  }
  if (color !== undefined) out.color = color;
  return out;
}

function item(slot: Slot, affixes: AffixRoll[], overrides: Partial<Item> = {}): Item {
  return {
    id: `it-${slot}-${affixes.map((a) => a.key).join("-")}`,
    seed: 7,
    baseKey: BASES.find((b) => b.slot === slot)?.key ?? "ironRing",
    slot,
    rarity: "magic",
    itemLevel: 5,
    name: "テスト",
    implicit: null,
    affixes,
    foundDepth: 5,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 2,
    marginMax: 3,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

/** TraitStats の中で既定から動いたフィールド */
function movedTraits(s: PlayerStats): (keyof TraitStats)[] {
  return (Object.keys(DEFAULT_STATS.traits) as (keyof TraitStats)[]).filter((k) => s.traits[k] !== DEFAULT_STATS.traits[k]);
}

// ---------------------------------------------------------------------------
// 性質
// ---------------------------------------------------------------------------

describe("第 2 弾の性質（段取り 7d に残ったもの）", () => {
  it(`${NEW_TRAITS.length} 種が定義され、通常の抽選に出る`, () => {
    for (const key of NEW_TRAITS) {
      const def = affixDef(key);
      expect(def, key).toBeDefined();
      expect(def?.awakening, key).toBeUndefined();
      const slot = def?.slots[0];
      if (slot === undefined) throw new Error(key);
      expect(traitsFor(slot, 30).some((d) => d.key === key), `${key} は抽選に出る`).toBe(true);
    }
  });

  it("代償付き（tradeoff）は利得と代償の両方を表示し、{v} が残らない", () => {
    for (const key of NEW_TRAITS) {
      const def = affixDef(key);
      if (def === undefined) throw new Error(key);
      const text = formatAffix(roll(key, 10, 5));
      expect(text, key).not.toContain("{v");
      if (def.tags.includes("tradeoff")) expect(def.label, key).toContain("{v2}");
    }
  });

  it("どの性質も apply で何かを動かす（ルール変更は TraitStats、条件付きの増は Modifier、数値は PlayerStats）", () => {
    for (const key of NEW_TRAITS) {
      const s = stats();
      const before = JSON.stringify(s);
      applyRoll(s, roll(key, 10, 5));
      expect(JSON.stringify(s), `${key} が stats を動かす`).not.toBe(before);
    }
  });

  it("属性の性質はルール変更のフィールドを動かす（弱点刺しに罰は無い）", () => {
    const s = stats();
    applyRoll(s, roll("prismEdge", 40));
    applyRoll(s, roll("backlash", 3));
    expect(s.traits.weakDamageMul).toBeCloseTo(0.4);
    expect(s.traits.resistedInflict).toBe(3);
  });

  it("地の利・足場狩りは Modifier、溜めの芯・残り火は欄を動かす", () => {
    const s = stats();
    applyRoll(s, roll("groundRooted", 30));
    applyRoll(s, roll("terrainHunter", 20));
    applyRoll(s, roll("chargeCore", 20));
    applyRoll(s, roll("emberTrail", 5, 12));
    expect(s.modifiers.map((m) => m.owner.key)).toEqual(["groundRooted", "terrainHunter"]);
    expect(movedTraits(s)).toEqual(expect.arrayContaining(["chargedMeleeMul", "burningKillFire"]));
    expect(s.resist.fire, "残り火の代償は炎耐性").toBe(-12);
  });

  it("連射の烙印の確率は 100% で頭打ち", () => {
    const s = stats();
    applyRoll(s, roll("rapidBrand", 80, 10));
    applyRoll(s, roll("rapidBrand", 80, 10));
    expect(s.traits.rapidBrandChance).toBe(1);
    expect(s.increased.ranged).toBeCloseTo(-0.2);
  });
});

// ---------------------------------------------------------------------------
// ベース（名のある遺物は loot/named.ts の 18 種を named.test.ts で検査する）
// ---------------------------------------------------------------------------

describe("第 2 弾のベース（10 種以上）", () => {
  it("implicit が実在し、色の傾きを持ち、武器種・銃の弾ごとに 2 つ以上の器がある", () => {
    expect(NEW_BASES.length).toBeGreaterThanOrEqual(10);
    for (const key of NEW_BASES) {
      const base = baseDef(key);
      expect(base, key).toBeDefined();
      expect(BASE_LEAN[key], key).toBeDefined();
      if (base?.implicitKey !== undefined) expect(implicitDef(base.implicitKey), key).toBeDefined();
    }
    for (const m of MOVESET_KEYS) expect(BASES.filter((b) => b.moveset === m).length, m).toBeGreaterThanOrEqual(2);
  });

  it("implicit が個性を持つ（斬馬刀は溜め、小鎌は闇の変換、喇叭銃は散弾の間合い）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [], { baseKey: "zanbato", implicit: { key: "implicit.zanbato", value: 10 } });
    const s = computeStats(eq);
    expect(s.moveset).toBe("greatsword");
    expect(s.traits.chargedMeleeMul).toBeCloseTo(0.1);
    const eqGun = createEmptyEquipment();
    eqGun.mainHand = item("mainHand", [], { baseKey: "blunderbuss", implicit: { key: "implicit.blunderbuss", value: 20 } });
    const sGun = computeStats(eqGun);
    expect(sGun.bullet).toBe("blunderbuss");
    expect(sGun.traits.spreadCloseMul).toBeCloseTo(0.2);
    const eq2 = createEmptyEquipment();
    eq2.mainHand = item("mainHand", [], { baseKey: "sickle", implicit: { key: "implicit.sickle", value: 25 } });
    expect(computeStats(eq2).infuse.dark).toBeCloseTo(0.25);
  });
});

describe("名のある遺物（段取り 7d の 18）", () => {
  it("全て生成でき、ベースが実在し、銘の一文を持つ", () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(18);
    for (const def of UNIQUES) {
      const key = def.key;
      expect(baseDef(def.baseKey), key).toBeDefined();
      expect(def.flavor?.length ?? 0, key).toBeGreaterThan(0);
      const rolls = rollUniqueAffixes(createRng(3), def, def.minLevel);
      expect(rolls.length, key).toBe(def.affixes.length + (def.keystone === undefined ? 0 : 1));
      if (def.keystone !== undefined) expect(rolls.some((r) => r.key === def.keystone), key).toBe(true);
    }
  });

  it("key は重複しない", () => {
    const keys = UNIQUES.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 残響（呼び戻し・注ぎ）
// ---------------------------------------------------------------------------

function craftState(amount = 20): EchoCraftState {
  const echoes = createEchoWallet();
  for (const c of Object.keys(echoes) as TraitColor[]) echoes[c] = amount;
  return { echoes, counter: 0 };
}

describe("呼び戻し", () => {
  const a = { ...roll("damageVsStaggered", 10), origin: "bud" as const };
  const b = { ...roll("guardedBane", 10), origin: "bud" as const };

  it("選ばなかった方と入れ替わり、1 つの遺物に 1 回だけ", () => {
    const it = item("mainHand", [roll("burn", 5, 3), a], { buds: [{ milestone: "kills:50", options: [a, b], chosen: 0 }] });
    const out = recallBud(it, 0);
    expect(out?.affixes.map((r) => r.key)).toEqual(["burn", "guardedBane"]);
    expect(out?.buds?.[0]?.chosen).toBe(1);
    expect(out?.buds?.[0]?.recalled).toBe(true);
    expect(out === null ? null : recallBud(out, 0), "2 回目はできない").toBeNull();
  });

  it("選んだ芽を削いでいれば呼び戻せない。費用は冥響", () => {
    const it = item("mainHand", [roll("burn", 5, 3)], { buds: [{ milestone: "kills:50", options: [a, b], chosen: 0 }] });
    expect(recallBud(it, 0)).toBeNull();
    expect(echoCost({ op: "recall", item: it, budIndex: 0 })).toEqual({ color: "umbra", amount: RECALL_COST });
  });
});

describe("注ぎ", () => {
  it("来歴の半分（切り捨て）が注がれ、最深は深い方", () => {
    const src = { ...createEmptyProvenance(), kills: 51, weakHits: 9, deepest: 12, killsByEnemy: { slime: 7 } };
    const dst = { ...createEmptyProvenance(), kills: 10, deepest: 4, killsByEnemy: { slime: 1 } };
    const out = pouredProvenance(src, dst);
    expect(out.kills).toBe(10 + 25);
    expect(out.weakHits).toBe(4);
    expect(out.deepest).toBe(12);
    expect(out.killsByEnemy.slime).toBe(1 + 3);
    expect(dst.kills, "元は変えない").toBe(10);
  });

  it("同じ部位の別の遺物にだけ注げ、捧げた遺物は消える（費用なし）。届いた節目の芽が出る", () => {
    const source = item("mainHand", [], { id: "src", provenance: { ...createEmptyProvenance(), kills: 120 } });
    const target = item("mainHand", [roll("damageVsStaggered", 10)], { id: "dst", provenance: createEmptyProvenance() });
    expect(pourGrowth(source, item("ring", [], { id: "ring" }))).toBeNull();
    const state = craftState(0);
    const result = craftEcho(state, { op: "pour", item: source, target });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consumedIds).toEqual(["src"]);
    expect(result.item?.provenance?.kills).toBe(60);
    expect(result.item?.budOffer?.milestone, "撃破 50 の芽").toBe("kills:50");
    expect(target.milestones, "元の遺物の節目の配列を書き換えない").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 来歴の節目・移行
// ---------------------------------------------------------------------------

describe("第 2 弾の来歴と節目", () => {
  it("新しい出来事を数える", () => {
    const p = createEmptyProvenance();
    for (const kind of ["weakHit", "resistedHit", "terrainKill", "favoredKill", "chargedHit", "branchHit"] as const) {
      bumpProvenance(p, { kind }, 3);
    }
    expect([p.weakHits, p.resistedHits, p.terrainKills, p.favoredKills, p.chargedHits, p.branchHits]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("第 2 弾の節目は写し先の性質を名指しし、その性質が付く部位の芽の片方がそれになる（名指しの無い節目は通常の芽）", () => {
    const named: Readonly<Record<string, string>> = {
      "weakHits:150": "prismEdge",
      "resistedHits:150": "backlash",
      "terrainKills:60": "groundRooted",
      "chargedHits:100": "chargeCore",
      "branchHits:150": "branchArt",
      "weakHits:600": "prismEdge",
      "terrainKills:250": "terrainHunter",
      "favoredKills:600": "branchArt",
    };
    for (const [key, awakening] of Object.entries(named)) {
      const def = milestoneDef(key);
      if (def === undefined) throw new Error(key);
      expect(def.awakening, key).toBe(awakening);
      const slot = affixDef(awakening)?.slots[0];
      if (slot === undefined) throw new Error(awakening);
      const base = slot === "mainHand" ? { baseKey: "longsword" } : {};
      const offer = makeBudOffer(item(slot, [roll("damageVsStaggered", 10)], base), def);
      expect(offer?.options[0].key, key).toBe(awakening);
    }
    expect(milestoneDef("favoredKills:150")?.awakening, "消えた性質を名指ししていた節目").toBeUndefined();
  });

  it("欠けた第 2 弾のカウンタは 0 で補う", () => {
    const { weakHits: _w, branchHits: _b, ...old } = createEmptyProvenance();
    const p = old as ReturnType<typeof createEmptyProvenance>;
    fillProvenanceCounters(p);
    expect(p.weakHits).toBe(0);
    expect(p.branchHits).toBe(0);
  });

  it("保存と読み込みで、呼び戻し・新しい来歴が残る", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    const profile = createEmptyProfile();
    const a = { ...roll("damageVsStaggered", 10), origin: "bud" as const };
    profile.stash.push(
      item("mainHand", [a], {
        buds: [{ milestone: "kills:50", options: [a, roll("guardedBane", 5)], chosen: 0, recalled: true }],
        provenance: { ...createEmptyProvenance(), weakHits: 4, terrainKills: 2 },
      }),
    );
    saveProfile(profile, storage);
    const loaded = loadProfile(storage).stash[0];
    expect(loaded?.buds?.[0]?.recalled).toBe(true);
    expect(loaded?.provenance?.weakHits).toBe(4);
    expect(loaded?.provenance?.terrainKills).toBe(2);
  });
});

describe("数値の単位", () => {
  it("% 表示の性質は 0.01 単位で TraitStats に入る", () => {
    const s = stats();
    applyRoll(s, roll("conductor", 25));
    expect(s.traits.wetConductMul).toBeCloseTo(25 * PERCENT);
  });
});
