import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { dist } from "../core/vec";
import { updatePlayer } from "../system/player";
import { createSkillRunState, updateSkills } from "../system/skills";
import { terrainAt } from "../system/terrain";
import { arena, withInput } from "../system/testHelpers";
import { ART_DEFS } from "./arts";
import type { ArtAct, ArtActsTransform } from "./arts/types";
import { MODIFIERS, NO_NUMBERS, SKILL, SKILL_DEFS, canAttach } from "./data";
import { stoneFromSeed } from "./generator";
import { LEGACY_SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone } from "./types";

/**
 * 行為の列・起点を変える刻印符（段取り 7c。docs/ideas/skills-7c-plan.md 4 章）。
 * transform は純関数として行為の列で、弾の操り（旋回・戻り刃）と軌跡は実際の発動（updatePlayer → castSlot → castArt）で検証する
 */

function transformOf(key: ModifierKey): ArtActsTransform {
  const t = MODIFIERS[key].transform;
  if (!t) throw new Error(`${key} に transform が無い`);
  return t;
}

function run(key: ModifierKey, acts: readonly ArtAct[]): ArtAct[] {
  return transformOf(key)(acts, NO_NUMBERS);
}

function first(acts: readonly ArtAct[]): ArtAct {
  const a = acts[0];
  if (!a) throw new Error("行為が無い");
  return a;
}

const W = SKILL.modifier;

describe("行為の列の transform（純関数）", () => {
  it("同じ入力に同じ出力を返し、元の列を書き換えない", () => {
    for (const key of ["split", "orbit", "tripleHit", "recall", "toTarget", "toNova"] as const) {
      const acts = ART_DEFS.commonKnifeFan.acts;
      const before = JSON.stringify(acts);
      expect(run(key, acts), key).toEqual(run(key, acts));
      expect(JSON.stringify(acts), `${key} は元の列を変えない`).toBe(before);
    }
  });

  it("分裂: 弾の数を倍にし 1 発を軽く、扇は重ならない向きに並べる", () => {
    const shot = first(ART_DEFS.commonKnifeFan.acts);
    const split = first(run("split", [shot]));
    expect(split.count).toBe(shot.count * W.split.countMul);
    expect(split.damage?.base).toBeCloseTo((shot.damage?.base ?? 0) * W.split.damageMul);
    const arc = first(ART_DEFS.commonCrescent.acts);
    const fan = run("split", [arc]);
    expect(fan).toHaveLength(W.split.countMul);
    expect(fan.map((a) => a.angleDeg - arc.angleDeg)).toEqual([-arc.deg, 0, arc.deg]);
    expect(new Set(fan.map((a) => a.name)).size, "行為の名前は技の中で一意").toBe(fan.length);
  });

  it("重ね打ち: 弾以外の与ダメの行為の段を倍にし、1 段を軽く", () => {
    const ring = first(ART_DEFS.commonWhirl.acts);
    const heavy = first(run("tripleHit", [ring]));
    expect(heavy.hits).toBe(ring.hits * W.tripleHit.hitsMul);
    expect(heavy.damage?.base).toBeCloseTo((ring.damage?.base ?? 0) * W.tripleHit.damageMul);
    const shot = first(ART_DEFS.commonKnifeFan.acts);
    expect(first(run("tripleHit", [shot])), "弾はそのまま").toEqual(shot);
  });

  it("照準起点は自分の周りの行為を照準地点へ、足元起点は照準地点の行為を自分へ（跳躍は変えない）", () => {
    expect(first(run("toTarget", ART_DEFS.commonWhirl.acts)).anchor).toBe("target");
    expect(first(run("toNova", ART_DEFS.commonThunderclap.acts)).anchor).toBe("self");
    expect(run("toNova", ART_DEFS.commonBlink.acts), "跳躍の行き先は変えない").toEqual([...ART_DEFS.commonBlink.acts]);
  });
});

describe("行為の列を変える符の相性", () => {
  it("技の行為の列で決まる（変わらない技・手書きのスキルには付かない）", () => {
    expect(canAttach(SKILL_DEFS.commonKnifeFan, "split")).toBe(true);
    expect(canAttach(SKILL_DEFS.commonCrescent, "split")).toBe(true);
    expect(canAttach(SKILL_DEFS.commonWhirl, "split"), "弾も扇も無い").toBe(false);
    expect(canAttach(SKILL_DEFS.commonKnifeFan, "orbit")).toBe(true);
    expect(canAttach(SKILL_DEFS.commonWhirl, "orbit")).toBe(false);
    expect(canAttach(SKILL_DEFS.commonLunge, "trail")).toBe(true);
    expect(canAttach(SKILL_DEFS.commonBlink, "trail")).toBe(true);
    expect(canAttach(SKILL_DEFS.commonWhirl, "trail")).toBe(false);
    expect(canAttach(SKILL_DEFS.commonBlink, "toNova"), "跳躍だけの技は足元起点で変わらない").toBe(false);
    for (const key of ["split", "orbit", "tripleHit", "recall", "trail"] as const) {
      expect(LEGACY_SKILL_KEYS.some((k) => canAttach(SKILL_DEFS[k], key)), `${key} は手書きに付かない`).toBe(false);
    }
  });

  it("技だけに付く符は 5 枚（分裂・旋回・重ね打ち・戻り刃・軌跡）", () => {
    const artOnly = (Object.keys(MODIFIERS) as ModifierKey[]).filter((k) => !LEGACY_SKILL_KEYS.some((s) => canAttach(SKILL_DEFS[s], k)));
    expect(artOnly.sort()).toEqual(["orbit", "recall", "split", "trail", "tripleHit"]);
  });
});

// ---------------------------------------------------------------------------
// 実際の発動
// ---------------------------------------------------------------------------

let seed = 1500;

function makeStone(key: SkillKey): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
}

function skillArena(key: SkillKey, modifiers: ModifierKey[], stateSeed = 5): GameState {
  const state = arena(stateSeed);
  const stone = makeStone(key);
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
  const slot = state.skills.slots[0];
  if (slot) slot.runModifiers = [...modifiers];
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function cast(state: GameState): void {
  updatePlayer(state, withInput({ skill1Pressed: true }), FIXED_DT);
}

function runFor(state: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) updatePlayer(state, withInput({}), FIXED_DT);
}

describe("旋回・戻り刃・軌跡（発動）", () => {
  it("旋回: 弾が自分の周りの円周上を回り続け、寿命で消える", () => {
    const state = skillArena("commonKnifeFan", ["orbit"]);
    cast(state);
    expect(state.skills.steers?.length ?? 0, "操る弾がある").toBeGreaterThan(0);
    runFor(state, W.orbit.life / 2);
    const me = state.player.body.pos;
    expect(state.skills.shots.length).toBeGreaterThan(0);
    for (const s of state.skills.shots) expect(dist(s.pos, me), "円周上").toBeCloseTo(W.orbit.radius, 0);
    runFor(state, W.orbit.life);
    expect(state.skills.shots).toHaveLength(0);
    expect(state.skills.steers ?? [], "操りも片付く").toHaveLength(0);
  });

  it("戻り刃: 元の寿命ぶん飛んでから折り返し、手元に着くと消える", () => {
    const state = skillArena("commonKnifeFan", ["recall"]);
    cast(state);
    const out = first(ART_DEFS.commonKnifeFan.acts).life;
    runFor(state, out * 0.9);
    const me = state.player.body.pos;
    const far = Math.max(...state.skills.shots.map((s) => dist(s.pos, me)));
    runFor(state, out * 0.5);
    const back = Math.max(0, ...state.skills.shots.map((s) => dist(s.pos, me)));
    expect(back, "戻ってきている").toBeLessThan(far);
    expect(state.skills.steers?.every((st) => st.returning) ?? true).toBe(true);
    runFor(state, out * W.recall.lifeMul);
    expect(state.skills.shots, "手元に着いて消える").toHaveLength(0);
  });

  it("軌跡: 踏み込みの通り道に攻撃の属性の地形が残る", () => {
    const state = skillArena("commonLunge", ["trail"]);
    const from = { ...state.player.body.pos };
    cast(state);
    const to = state.player.body.pos;
    expect(dist(from, to), "前提: 踏み込んだ").toBeGreaterThan(W.trail.step);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    expect(terrainAt(state, mid.x, mid.y)).not.toBe("none");
    const plain = skillArena("commonLunge", []);
    const start = { ...plain.player.body.pos };
    cast(plain);
    const end = plain.player.body.pos;
    expect(terrainAt(plain, (start.x + end.x) / 2, (start.y + end.y) / 2), "符が無ければ残らない").toBe("none");
  });

  it("同じ seed・同じ操作なら同じ弾の位置（決定性）", () => {
    const play = (): number[] => {
      const state = skillArena("commonKnifeFan", ["orbit", "split"], 9);
      cast(state);
      runFor(state, 0.4);
      return state.skills.shots.flatMap((s) => [s.pos.x, s.pos.y]);
    };
    expect(play()).toEqual(play());
  });
});
