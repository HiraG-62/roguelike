import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { updatePlayer } from "../system/player";
import { createSkillRunState, resolveSlot, updateSkills } from "../system/skills";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { SKILL, SKILL_DEFS, burdenLinks, castBurden, maxStoneLinks, resolveCast, wearBonusLinks, wearPowerMul } from "./data";
import { stoneFromSeed } from "./generator";
import { WEAR_TUNING } from "./tuning2";
import type { SkillKey, SkillStone, StoneWear } from "./types";
import { chooseBud, noteWearCast, wearSummary } from "./wear";

/** スキル石の使い込み（docs/ideas/skills-expansion.md 5 章）: 発動・命中の記録、節目の芽、芽の効果 */

function stone(skillKey: SkillKey, links: number, wear?: StoneWear): SkillStone {
  return { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey }), variants: [], links, ...(wear ? { wear } : {}) };
}

function withStone(s: SkillStone): GameState {
  const state = arena(5);
  state.skills = createSkillRunState({ version: 1, loadout: [s.id, null, null, null], stones: [s] });
  updateSkills(state, withInput({}), 0);
  return state;
}

const FIRST = WEAR_TUNING.milestones[0] ?? 0;

describe("使い込みの記録", () => {
  it("手動で撃つと発動回数、敵に当たると命中数が増える", () => {
    const s = stone("whirl", 0);
    const state = withStone(s);
    const e = placeEnemy(state, "golem", 15, 0);
    e.hp = 999;
    e.phase = "idle";
    state.player.mana = state.stats.maxMana;
    updatePlayer(state, withInput({ skill1Pressed: true }), FIXED_DT);
    for (let i = 0; i < 60; i++) updatePlayer(state, withInput({}), FIXED_DT);
    expect(s.wear?.casts).toBe(1);
    expect(s.wear?.hits ?? 0).toBeGreaterThan(0);
  });

  it("節目に届くと芽が 1 つ出る。1 発で多くに当てた石は威力、撃ち続けた石は枠", () => {
    const spread = stone("whirl", 1, { casts: FIRST - 1, hits: FIRST * 4, buds: [] });
    const state = withStone(spread);
    expect(noteWearCast(state, 0)).toBe("power");
    const lone = stone("haste", 1, { casts: FIRST - 1, hits: 0, buds: [] });
    const other = withStone(lone);
    expect(noteWearCast(other, 0)).toBe("link");
    expect(lone.links, "枠の芽でリンクが増える").toBe(2);
  });

  it("節目の前では芽が出ない。芽は節目の数まで", () => {
    const s = stone("whirl", 0, { casts: 0, hits: 0, buds: [] });
    const state = withStone(s);
    expect(noteWearCast(state, 0)).toBeNull();
    const done = stone("whirl", 0, { casts: 9999, hits: 0, buds: ["link", "power"] });
    expect(noteWearCast(withStone(done), 0)).toBeNull();
    expect(done.wear?.buds).toHaveLength(WEAR_TUNING.milestones.length);
  });

  it("枠の芽が上限なら次の芽は威力に替わる", () => {
    const s = stone("haste", 2, { casts: 100, hits: 0, buds: ["link"] });
    expect(chooseBud(s, s.wear ?? { casts: 0, hits: 0, buds: [] })).toBe("power");
  });
});

describe("芽の効果", () => {
  it("威力の芽は威力と効果量を伸ばす", () => {
    const s = stone("whirl", 0, { casts: 0, hits: 0, buds: ["power"] });
    const p = resolveCast(SKILL_DEFS.whirl, s, []);
    expect(p.damageMul).toBeCloseTo(1 + WEAR_TUNING.powerPerBud);
    expect(p.potencyMul).toBeCloseTo(1 + WEAR_TUNING.powerPerBud);
    expect(wearPowerMul(s)).toBeCloseTo(1 + WEAR_TUNING.powerPerBud);
  });

  it("枠の芽で増えたリンクは負担に数えず、上限を 1 超えて持てる", () => {
    const s = stone("whirl", SKILL.maxLinks + 1, { casts: 0, hits: 0, buds: ["link"] });
    expect(wearBonusLinks(s)).toBe(1);
    expect(maxStoneLinks(s)).toBe(SKILL.maxLinks + 1);
    expect(burdenLinks(s)).toBe(SKILL.maxLinks);
    const cost = castBurden(SKILL_DEFS.whirl, resolveCast(SKILL_DEFS.whirl, s, [])).cost;
    expect(cost).toBeCloseTo(SKILL.whirl.cost * (1 + SKILL.linkBurdenPenalty * SKILL.maxLinks));
  });

  it("ラン中に威力の芽が出ると、次の発動から効く（覚え書きを作り直す）", () => {
    const s = stone("whirl", 0, { casts: FIRST - 1, hits: FIRST * 4, buds: [] });
    const state = withStone(s);
    const before = resolveSlot(state, 0)?.params.damageMul ?? 0;
    noteWearCast(state, 0);
    const after = resolveSlot(state, 0)?.params.damageMul ?? 0;
    expect(after / before).toBeCloseTo(1 + WEAR_TUNING.powerPerBud);
  });

  it("装備画面の 1 行は発動・命中・芽・次の節目を語る", () => {
    const s = stone("whirl", 0, { casts: 3, hits: 10, buds: ["power"] });
    const text = wearSummary(s);
    expect(text).toContain("3");
    expect(text).toContain("10");
    expect(wearSummary(stone("whirl", 0))).toContain(String(FIRST));
  });
});
