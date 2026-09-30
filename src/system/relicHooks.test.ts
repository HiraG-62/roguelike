import { describe, expect, it } from "vitest";
import { pushPlayerEvent } from "../core/events";
import { type Modifier, type Rule, SCOPE_ANY } from "../core/rules";
import { BOON, STATUS } from "../data/tuning";
import { applyNamedRelics, type UniqueDef } from "../loot/named";
import { ATTR_LABEL as RESONANCE_ATTR_LABEL } from "../loot/resonance";
import { computeStats } from "../loot/stats";
import { ATTR_LABEL, DEFAULT_STATS, type Item, type Slot, createEmptyEquipment } from "../loot/types";
import { createBoonRunState, graceSlotsOf } from "./boons";
import { keystoneRules } from "./keystones";
import { countPer } from "./modifiers";
import { moraleMax } from "./morale";
import { collectRules, resolveRules } from "./rules";
import { applyStatus, findStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

/** 段取り 7d の前置き（遺物の型と口）の検査。中身は後のレーンが足すので、口が既定で何もしないことと、渡せば効くことを見る */

const OWNER = { kind: "item", key: "testRelic" } as const;
const MORALE_GAIN = 2;
const BIG_STACKS = 20;
const BURN_BONUS = 2;
const LONG = 10;

function makeRule(id: string): Rule {
  return { id, when: "onDash", if: [], chance: 1, icd: 0, scope: SCOPE_ANY, owner: OWNER, then: { kind: "heal", magnitude: 1 } };
}

function makeModifier(id: string): Modifier {
  return { id, kind: "more", tag: "all", amount: 1.1, if: [], owner: OWNER };
}

function namedItem(slot: Slot, namedKey: string, margin = 0): Item {
  return {
    id: `relic-${slot}`,
    seed: 1,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 1,
    name: "test",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    namedKey,
    margin,
  };
}

function fakeDef(key: string, partial: Partial<UniqueDef>): UniqueDef {
  return { key, name: key, baseKey: "test", minLevel: 1, affixes: [], ...partial };
}

describe("名のある遺物の口（applyNamedRelics）", () => {
  it("装備スロット順に rules / modifiers を積み、加護の枠を数え、apply を呼ぶ", () => {
    const defs: Record<string, UniqueDef> = {
      ringRelic: fakeDef("ringRelic", { rules: [makeRule("ring")], modifiers: [makeModifier("ring")], graceSlot: "dash" }),
      handRelic: fakeDef("handRelic", {
        rules: [makeRule("hand")],
        graceSlot: "dash",
        apply: (s) => {
          s.coinGainMul += 1;
        },
      }),
    };
    const equipment = createEmptyEquipment();
    equipment.ring = namedItem("ring", "ringRelic");
    equipment.mainHand = namedItem("mainHand", "handRelic");
    const stats = computeStats(createEmptyEquipment());
    applyNamedRelics(stats, equipment, (k) => defs[k]);
    expect(stats.rules.map((r) => r.id), "右手 → 指輪の順").toEqual(["hand", "ring"]);
    expect(stats.modifiers.map((m) => m.id), "Modifier も積む").toEqual(["ring"]);
    expect(stats.graceSlotBonus.dash, "2 つの遺物がダッシュの枠を開く").toBe(2);
    expect(stats.coinGainMul, "apply が呼ばれる").toBe(DEFAULT_STATS.coinGainMul + 1);
    expect(DEFAULT_STATS.rules.length, "既定は汚さない").toBe(0);
    expect(DEFAULT_STATS.graceSlotBonus.dash, "既定は汚さない").toBeUndefined();
  });

  it("Rule・枠・重ねを持たない名のある遺物（六文銭）は、装備しても rules・枠・重ねの上限は空のまま", () => {
    const equipment = createEmptyEquipment();
    equipment.amulet = namedItem("amulet", "sixCoins");
    const stats = computeStats(equipment);
    expect(stats.rules.length).toBe(0);
    expect(stats.graceSlotBonus).toEqual({});
    expect(stats.statusStackCapBonus).toEqual({});
  });
});

describe("装備・誓約の Rule を集める口（collectRules）", () => {
  it("stats.rules を先頭に集める", () => {
    const state = arena(5, { rules: [makeRule("equip")] });
    expect(collectRules(state)[0]?.id, "装備の Rule が先頭").toBe("equip");
  });

  it("数値だけの誓約と未知の key は Rule を出さず、刹那は見切り時の Rule を出す", () => {
    expect(keystoneRules(["ks_glassCannon", "ks_blink", "unknown"]).length, "数値だけの誓約").toBe(0);
    expect(keystoneRules(["ks_instant"]).map((r) => r.when), "刹那").toEqual(["onJustDodge"]);
  });
});

describe("Rule 効果 gainMorale", () => {
  it("戦意を量で足し、上限で切る", () => {
    const state = arena();
    const rule: Rule = { ...makeRule("morale"), then: { kind: "gainMorale", magnitude: MORALE_GAIN } };
    pushPlayerEvent(state, "onDash", "dash");
    resolveRules(state, 0, [rule]);
    expect(state.player.morale.value, "剣の応報に足される").toBe(Math.min(moraleMax(state), MORALE_GAIN));
    expect(state.player.morale.value, "0 より大きい").toBeGreaterThan(0);
  });
});

describe("「〜につき」gearMargin", () => {
  it("装備している遺物の空いた余白を合計する", () => {
    const state = arena();
    state.profile.equipment = createEmptyEquipment();
    state.profile.equipment.head = namedItem("head", "x", 2);
    state.profile.equipment.boots = namedItem("boots", "y", 3);
    expect(countPer(state, { kind: "gearMargin" }, null)).toBe(5);
  });
});

describe("加護の枠の上乗せ（graceSlotBonus）", () => {
  it("遺物が開いた枠を足し、上限で切る", () => {
    const state = arena(5, { graceSlotBonus: { skill: 1 } });
    expect(graceSlotsOf(state, "skill")).toBe(Math.min(BOON.graceSlotsMax, BOON.graceSlots + 1));
    expect(graceSlotsOf(state, "primary"), "他の行動は変わらない").toBe(BOON.graceSlots);
    state.stats = { ...state.stats, graceSlotBonus: { skill: BIG_STACKS } };
    expect(graceSlotsOf(state, "skill"), "上限").toBe(BOON.graceSlotsMax);
  });

  it("共鳴の段はランの開始で空", () => {
    expect(createBoonRunState().resonance).toEqual([]);
  });
});

describe("重ねの上限の上乗せ（statusStackCapBonus）", () => {
  it("敵に付ける燃焼の上限だけが伸びる", () => {
    const state = arena(5, { statusStackCapBonus: { burn: BURN_BONUS } });
    const e = placeEnemy(state, "slime", 20);
    e.hp = 10_000;
    e.maxHp = 10_000;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: BIG_STACKS, duration: LONG, potency: 1 }, "player");
    expect(findStatus(e.status, "burn")?.stacks).toBe(STATUS.burnMaxStacks + BURN_BONUS);
  });

  it("既定（上乗せなし）では今の上限のまま", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    e.hp = 10_000;
    e.maxHp = 10_000;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: BIG_STACKS, duration: LONG, potency: 1 }, "player");
    expect(findStatus(e.status, "burn")?.stacks).toBe(STATUS.burnMaxStacks);
  });
});

describe("ATTR_LABEL の移動", () => {
  it("loot/resonance の re-export は loot/types と同じ表", () => {
    expect(RESONANCE_ATTR_LABEL).toBe(ATTR_LABEL);
  });
});
