import { describe, expect, it } from "vitest";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { TERRAIN_MUD_SMOKE } from "../data/tuning";
import { updatePlayer } from "../system/player";
import { createSkillRunState, updateSkills } from "../system/skills";
import { igniteTerrainAt, terrainAt, terrainMoveMul } from "../system/terrain";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { SKILL, SKILL_DEFS, canAttach, resolveCast } from "./data";
import { stoneFromSeed } from "./generator";
import type { ModifierKey, SkillKey, SkillStone } from "./types";

/**
 * 第 4 弾: スキル「泥沼」と、地裂きの刻印符「地崩れ」。実際の発動（updatePlayer → updateSkills → castSlot）を通して
 * 地形・怯み値・状態で検証する（崩れる床そのものの規則は system/terrain.test.ts）
 */

const BIG_HP = 1000;

interface Loadout {
  key: SkillKey;
  links?: number;
  modifiers?: ModifierKey[];
}

let seed = 900;

function makeStone(l: Loadout): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: l.key }), variants: [], links: l.links ?? 0 };
}

function skillArena(slots: Loadout[]): GameState {
  const state = arena(5);
  const stones = slots.map(makeStone);
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
  slots.forEach((l, i) => {
    const slot = state.skills.slots[i];
    if (slot) slot.runModifiers = [...(l.modifiers ?? [])];
  });
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function toScreen(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

function run(state: GameState, seconds: number, input: FrameInput = withInput({})): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updatePlayer(state, input, FIXED_DT);
}

function cast(state: GameState, at?: Vec, slot = 0): void {
  const aim = at ? { aimScreen: toScreen(state, at) } : {};
  updatePlayer(state, withInput({ skill1Pressed: slot === 0, skill2Pressed: slot === 1, ...aim }), FIXED_DT);
}

function ahead(state: GameState, dx: number, dy = 0): Vec {
  return { x: state.player.body.pos.x + dx, y: state.player.body.pos.y + dy };
}

describe("泥沼（mire）", () => {
  it("気力型で、照準地点に泥を広げ、中の敵の足を遅くする", () => {
    expect(SKILL_DEFS.mire.resource).toBe("mana");
    const state = skillArena([{ key: "mire" }]);
    const e = tough(state, 60);
    const mana = state.player.mana;
    cast(state, { ...e.body.pos });
    expect(state.player.mana, "気力を払う").toBeLessThan(mana);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y), "敵の足元が泥").toBe("mud");
    expect(terrainMoveMul(state, e.body.pos), "泥の中は遅い").toBe(TERRAIN_MUD_SMOKE.mud.moveMul);
    expect(state.skills.mires, "領域が 1 つ置かれる").toHaveLength(1);
  });

  it("泥の上に立つ敵へ周期ごとに怯み値が溜まる", () => {
    const state = skillArena([{ key: "mire" }]);
    const e = tough(state, 60);
    cast(state, { ...e.body.pos });
    expect(e.poise.damage, "置いた瞬間は怯み値なし（泥沼自体の怯み値は 0）").toBe(0);
    run(state, SKILL.mire.tickEvery * 2 + FIXED_DT);
    expect(e.poise.damage, "周期の怯み値が溜まる").toBeGreaterThan(0);
  });

  it("泥が燃えて固まると、その上の敵には怯み値が入らない", () => {
    const state = skillArena([{ key: "mire" }]);
    const e = tough(state, 60);
    cast(state, { ...e.body.pos });
    igniteTerrainAt(state, e.body.pos.x, e.body.pos.y, SKILL.mire.terrainRadius * 2);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y), "固まって泥が消える").toBe("none");
    expect(e.status.effects.some((s) => s.kind === "paralyze"), "固まった泥で麻痺").toBe(true);
    run(state, SKILL.mire.tickEvery * 2 + FIXED_DT);
    expect(e.poise.damage).toBe(0);
  });

  it("持続が切れると領域は消える", () => {
    const state = skillArena([{ key: "mire" }]);
    tough(state, 60);
    cast(state, ahead(state, 60));
    run(state, SKILL.mire.terrainTime + FIXED_DT * 2);
    expect(state.skills.mires ?? []).toHaveLength(0);
  });
});

describe("地裂きの刻印符「地崩れ」（crumble）", () => {
  it("地裂きにだけ付く", () => {
    expect(canAttach(SKILL_DEFS.quake, "crumble")).toBe(true);
    expect(canAttach(SKILL_DEFS.whirl, "crumble")).toBe(false);
    expect(canAttach(SKILL_DEFS.mire, "crumble")).toBe(false);
  });

  it("負担が増え、発動の旗が立つ", () => {
    const stone = makeStone({ key: "quake", links: 1 });
    const plain = resolveCast(SKILL_DEFS.quake, makeStone({ key: "quake", links: 1 }), []);
    const p = resolveCast(SKILL_DEFS.quake, stone, ["crumble"]);
    expect(p.crumble).toBe(true);
    expect(p.burdenMul).toBeCloseTo(plain.burdenMul * SKILL.modifier.crumble.burdenMul);
  });

  it("命中した敵までの地割れが崩れる床になる（外れれば残らない）", () => {
    const state = skillArena([{ key: "quake", links: 1, modifiers: ["crumble"] }]);
    tough(state, 30);
    const mid = ahead(state, 14);
    cast(state);
    run(state, SKILL.quake.windup + FIXED_DT * 3);
    expect(terrainAt(state, mid.x, mid.y), "プレイヤーと敵の間").toBe("rubble");

    const miss = skillArena([{ key: "quake", links: 1, modifiers: ["crumble"] }]);
    const far = ahead(miss, 14);
    cast(miss);
    run(miss, SKILL.quake.windup + FIXED_DT * 3);
    expect(terrainAt(miss, far.x, far.y), "当たらなければ床は変わらない").toBe("none");
  });

  it("刻印符が無ければ崩れる床は残らない", () => {
    const state = skillArena([{ key: "quake", links: 1 }]);
    tough(state, 30);
    const mid = ahead(state, 14);
    cast(state);
    run(state, SKILL.quake.windup + FIXED_DT * 3);
    expect(terrainAt(state, mid.x, mid.y)).toBe("none");
  });
});
