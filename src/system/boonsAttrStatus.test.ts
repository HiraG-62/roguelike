import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { BOONS, boonWeight, equipmentTags, rollBoonOptions } from "./boons";

describe("装備タグと抽選", () => {
  it("筋力の性質は attr と stagger、出血の proc は bleed のタグになる", () => {
    const tags = equipmentTags({
      ...DEFAULT_STATS,
      attributes: { ...DEFAULT_STATS.attributes, str: 9 },
      statusProcs: [{ kind: "bleed", chance: 0.2, stacks: 1, duration: 4, potency: 1, on: "melee" }],
    });
    expect(tags.has("attr")).toBe(true);
    expect(tags.has("stagger")).toBe(true);
    expect(tags.has("bleed")).toBe(true);
    expect(tags.has("poison")).toBe(false);
  });

  it("タグが一致すると重みが上がる（崩しは stagger で上がる）", () => {
    const base = boonWeight(BOONS.crumble, equipmentTags(DEFAULT_STATS), []);
    const tagged = boonWeight(BOONS.crumble, equipmentTags({ ...DEFAULT_STATS, poiseDamageMul: 1.2 }), []);
    expect(tagged).toBeGreaterThan(base);
  });

  it("同じ seed なら状態異常の装備でも抽選は同じ結果", () => {
    const procs: PlayerStats["statusProcs"] = [
      { kind: "poison", chance: 0.2, stacks: 1, duration: 5, potency: 0, on: "any" },
      { kind: "bleed", chance: 0.2, stacks: 1, duration: 4, potency: 1, on: "any" },
    ];
    const roll = (): string[][] => {
      const state = createGame(42);
      state.stats = { ...state.stats, statusProcs: procs, attributes: { ...state.stats.attributes, spi: 12 } };
      return Array.from({ length: 5 }, () => rollBoonOptions(state));
    };
    expect(roll()).toEqual(roll());
  });
});
