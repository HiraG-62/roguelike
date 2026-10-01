import { describe, expect, it } from "vitest";
import { REACH } from "../data/tuning";
import { addTally, grantBoon } from "../system/boons";
import { refreshRunStats } from "../system/runSetup";
import { arena } from "../system/testHelpers";
import { affixDef } from "./affixes";
import { scaledNominalAt } from "./flux";
import { REACH_DEFS, hasReach, reachMeasures, reachedKeys } from "./reach";
import { computeStats } from "./stats";
import { DEFAULT_STATS, REACH_KEYS, type Equipment, type Item, type ReachKey, type Slot, createEmptyEquipment } from "./types";

/** 厳選の到達点（docs/ideas/deep-impl.md 2-4）: 装備だけの性質の合計が閾値に届くか */

const NOW = 1_700_000_000_000;
const PERCENT = 100;
/** 深度 21 の期待値の遺物 2 つでは届かない（章の間の終わり） */
const CHAPTER_END_DEPTH = 21;
/** 深度 40 の期待値より 1.4 倍上振れした遺物 2 つなら届く（深みの拾い物） */
const DEEP_DEPTH = 40;
const UPSIDE = 1.4;
const PAIR = 2;

function makeItem(slot: Slot, key: string, value: number): Item {
  return {
    id: `reach-${slot}-${key}`,
    seed: 0,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 1,
    name: "Test",
    implicit: null,
    affixes: [{ key, value }],
    foundDepth: 1,
    foundAt: NOW,
  };
}

/** 各軸の主な性質を、その性質が宿れる部位 2 つへ 1 つずつ置く */
const PAIR_SLOTS: Readonly<Record<ReachKey, readonly [Slot, Slot]>> = {
  chain: ["ring", "amulet"],
  burn: ["mainHand", "ring"],
  morale: ["mainHand", "amulet"],
};

function mainAffixKey(key: ReachKey): string {
  const affix = REACH_DEFS[key].affixes[0];
  if (affix === undefined) throw new Error(`${key} の主な性質が無い`);
  return affix;
}

function equipPair(key: ReachKey, each: number): Equipment {
  const equipment = createEmptyEquipment();
  const [a, b] = PAIR_SLOTS[key];
  equipment[a] = makeItem(a, mainAffixKey(key), each);
  equipment[b] = makeItem(b, mainAffixKey(key), each);
  return equipment;
}

/** 深度 depth の期待値 × mul の値を 2 つ持った装備の stats */
function statsAtNominal(key: ReachKey, depth: number, mul: number): ReturnType<typeof computeStats> {
  const def = affixDef(mainAffixKey(key));
  if (def === undefined) throw new Error(`${mainAffixKey(key)} が無い`);
  const nominal = scaledNominalAt(def, depth).nominal;
  return computeStats(equipPair(key, nominal * mul));
}

describe("到達の測る量（computeStats の reach）", () => {
  it("装備が空なら 3 軸とも 0 で、到達しない", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.reach, "測る量は 0").toEqual({ chain: 0, burn: 0, morale: 0 });
    expect(reachedKeys(stats), "到達なし").toEqual([]);
  });

  it("既定の stats は到達しない", () => {
    for (const key of REACH_KEYS) expect(hasReach(DEFAULT_STATS, key), key).toBe(false);
  });

  it("連鎖係数・燃焼の重ねの上限・戦意の上限の合計が閾値に届くと到達、届かないと到達しない", () => {
    const chainAbove = (REACH.chain * PERCENT) / PAIR;
    const chainBelow = chainAbove - 1;
    expect(hasReach(computeStats(equipPair("chain", chainAbove)), "chain"), "連鎖係数が閾値ちょうど").toBe(true);
    expect(hasReach(computeStats(equipPair("chain", chainBelow)), "chain"), "連鎖係数が閾値の手前").toBe(false);

    const burnAbove = Math.ceil(REACH.burn / PAIR);
    expect(hasReach(computeStats(equipPair("burn", burnAbove)), "burn"), "燃焼の重ねの上限が閾値以上").toBe(true);
    expect(hasReach(computeStats(equipPair("burn", burnAbove - 1)), "burn"), "燃焼の重ねの上限が閾値の手前").toBe(false);

    const moraleAbove = REACH.morale / PAIR;
    expect(hasReach(computeStats(equipPair("morale", moraleAbove)), "morale"), "戦意の上限が閾値ちょうど").toBe(true);
    expect(hasReach(computeStats(equipPair("morale", moraleAbove - 1)), "morale"), "戦意の上限が閾値の手前").toBe(false);
  });

  it("測る量は各軸の性質だけを数え、他の軸には入らない", () => {
    const stats = computeStats(equipPair("morale", REACH.morale));
    expect(stats.reach.morale, "戦意の上限").toBeGreaterThanOrEqual(REACH.morale);
    expect(stats.reach.chain, "連鎖係数は 0").toBe(0);
    expect(stats.reach.burn, "燃焼の重ねの上限は 0").toBe(0);
    expect(reachedKeys(stats), "到達は戦意だけ").toEqual(["morale"]);
  });

  it("reachMeasures は stats の値から測り直しても computeStats の reach と同じ", () => {
    const stats = computeStats(equipPair("burn", REACH.burn));
    expect(reachMeasures(stats)).toEqual(stats.reach);
  });

  it("閾値は深度 21 の期待値の遺物 2 つでは届かず、深度 40 の期待値 ×1.4 の遺物 2 つなら届く", () => {
    for (const key of REACH_KEYS) {
      expect(hasReach(statsAtNominal(key, CHAPTER_END_DEPTH, 1), key), `${key}: 深度 ${CHAPTER_END_DEPTH} の期待値 2 つ`).toBe(false);
      expect(hasReach(statsAtNominal(key, DEEP_DEPTH, UPSIDE), key), `${key}: 深度 ${DEEP_DEPTH} の期待値 ×${UPSIDE} 2 つ`).toBe(true);
    }
  });
});

describe("到達は装備だけで決まる", () => {
  it("祝福の研鑽で連鎖係数が増えても、stats.reach は変わらない", () => {
    const state = arena(5);
    const equipment = state.profile.equipment;
    equipment.ring = makeItem("ring", "chainSource", (REACH.chain * PERCENT) / PAIR - 1);
    refreshRunStats(state);
    const before = state.stats.reach.chain;
    expect(before, "装備だけで連鎖係数がある").toBeGreaterThan(0);

    grantBoon(state, "thunderLink");
    addTally(state, "thunderLink", 1000);
    expect(state.stats.chainCoefBonus, "祝福が連鎖係数を足した").toBeGreaterThan(before);
    expect(state.stats.reach.chain, "測る量は装備のまま").toBe(before);
    expect(hasReach(state.stats, "chain"), "祝福では届かない").toBe(false);
  });

  it("装備が封じられている間（素手の起点）は到達しない", () => {
    const state = arena(5);
    state.profile.equipment = equipPair("morale", REACH.morale);
    refreshRunStats(state);
    expect(hasReach(state.stats, "morale"), "封じていなければ届く").toBe(true);

    state.origin = "unarmed";
    refreshRunStats(state);
    expect(state.stats.reach, "封じの間は 0").toEqual({ chain: 0, burn: 0, morale: 0 });
    expect(hasReach(state.stats, "morale"), "封じの間は届かない").toBe(false);
  });
});
