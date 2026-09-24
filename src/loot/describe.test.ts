import { describe, expect, it } from "vitest";
import { emptyProfile, kw, mergeProfiles } from "../core/keywords";
import type { StatusProc } from "../core/status";
import {
  ATTRIBUTE_HINT,
  SYNERGY_PARTNER_MAX,
  type SynergyBuild,
  type SynergyElement,
  describeAttribute,
  describeStatusProc,
  describeSynergy,
  describeTrait,
} from "./describe";
import { ATTR_KEYS, TRAIT_COLOR_HEX, createEmptyProvenance, type AffixRoll, type Item } from "./types";

function proc(partial: Partial<StatusProc>): StatusProc {
  return { kind: "bleed", chance: 0.12, stacks: 1, duration: 4, potency: 2, on: "melee", ...partial };
}

describe("ステータスの一言", () => {
  it("5 種すべてに一言があり、何が上がるか（上がる / 増え / 短くなる）を書く", () => {
    for (const k of ATTR_KEYS) {
      expect(ATTRIBUTE_HINT[k].length, k).toBeGreaterThan(0);
      expect(ATTRIBUTE_HINT[k], k).toMatch(/(上がる|増え|短くなる)/);
    }
  });

  it("describeAttribute は表示名・色を返す", () => {
    const str = describeAttribute("str");
    expect(str.label).toBe("筋力");
    expect(str.color).toBe("crimson");
    expect(str.hex).toBe(TRAIT_COLOR_HEX.crimson);
    expect(describeAttribute("spi").color).toBe("umbra");
  });

  it("ステータスの性質の行には一言が付く。他の性質には付かない", () => {
    const line = describeTrait({ key: "attr_str", value: 4, color: "crimson" });
    expect(line.text).toBe(`筋力 +4（${ATTRIBUTE_HINT.str}）`);
    expect(line.hue).toBe("crimson");
    expect(describeTrait({ key: "meleeDamagePct", value: 20 }).text).toBe("近接ダメージ +20%");
  });
});

describe("状態異常の付与の説明", () => {
  it("判定する攻撃と確率と動詞で語る", () => {
    expect(describeStatusProc(proc({}))).toBe("近接命中時 12% で出血させる");
    expect(describeStatusProc(proc({ kind: "silence", on: "ranged", chance: 0.1 }))).toBe("射撃命中時 10% で沈黙させる");
    expect(describeStatusProc(proc({ kind: "vulnerable", on: "skill", chance: 0.2 }))).toBe("スキル命中時 20% で脆弱にする");
    expect(describeStatusProc(proc({ kind: "poison", on: "any", chance: 0.085 }))).toBe("命中時 8.5% で毒を与える");
  });

  it("会心時のみのものは「会心時」", () => {
    expect(describeStatusProc(proc({ kind: "fear", on: "any", chance: 0.3, requiresCrit: true }))).toBe(
      "会心時 30% で恐怖させる",
    );
  });
});

// ---------------------------------------------------------------------------
// 「相性」（describeSynergy）
// ---------------------------------------------------------------------------

function synergyItem(affixes: AffixRoll[]): Item {
  return {
    id: "syn-1",
    seed: 1,
    baseKey: "test",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 10,
    name: "試しの剣",
    implicit: null,
    affixes,
    foundDepth: 3,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 0,
    marginMax: 0,
    milestones: [],
    buds: [],
    budOffer: null,
  };
}

const burnRoll: AffixRoll = { key: "burn", value: 20, value2: 5, nominal: 20, flux: 0, origin: "found" };
const lifeOnKillRoll: AffixRoll = { key: "lifeOnKill", value: 5, nominal: 5, flux: 0, origin: "found" };

function buildOf(elements: SynergyElement[]): SynergyBuild {
  return { profile: mergeProfiles(emptyProfile(), ...elements.map((e) => e.keywords)), elements };
}

describe("describeSynergy: 遺物とビルドの相性", () => {
  it("遺物が出す語で、ビルドの飢えを埋める語を fills に、食う相手の祝福を partners に返す", () => {
    const build = buildOf([{ kind: "boon", name: "燃やし食い", keywords: kw([], ["burn"]) }]);
    const d = describeSynergy(synergyItem([burnRoll]), build);
    expect(d.produces, "燃焼の性質は燃焼を出す").toContain("burn");
    expect(d.fills, "飢えている燃焼を埋める").toEqual(["burn"]);
    expect(d.partners, "燃焼を糧にする祝福と相性がよい").toEqual(["燃やし食い"]);
  });

  it("遺物の糧のうち、ビルドの溢れを feeds に返す", () => {
    const build = buildOf([{ kind: "skill", name: "撃破を出す石", keywords: kw(["kill"]) }]);
    const d = describeSynergy(synergyItem([lifeOnKillRoll]), build);
    expect(d.consumes, "撃破時回復は撃破を食う").toContain("kill");
    expect(d.feeds, "余っている撃破を食う").toEqual(["kill"]);
    expect(d.partners, "撃破が源のスキル石と相性がよい").toEqual(["撃破を出す石"]);
  });

  it("相手はスキル石と祝福だけ、最大 SYNERGY_PARTNER_MAX まで、要素の並び順", () => {
    const eater = (name: string, kind: SynergyElement["kind"]): SynergyElement => ({ kind, name, keywords: kw([], ["burn"]) });
    const build = buildOf([eater("遺物", "item"), eater("共鳴", "resonance"), eater("A", "skill"), eater("B", "boon"), eater("C", "boon"), eater("D", "boon")]);
    const d = describeSynergy(synergyItem([burnRoll]), build);
    expect(d.partners, "遺物・共鳴は相手に数えない").toEqual(["A", "B", "C"]);
    expect(d.partners.length, "上限").toBe(SYNERGY_PARTNER_MAX);
  });

  it("関係が無ければ fills / feeds / partners は空", () => {
    const build = buildOf([{ kind: "boon", name: "無関係", keywords: kw(["dash"], ["just"]) }]);
    const d = describeSynergy(synergyItem([burnRoll]), build);
    expect(d.fills, "埋める穴なし").toEqual([]);
    expect(d.feeds, "受け皿なし").toEqual([]);
    expect(d.partners, "相手なし").toEqual([]);
  });
});
