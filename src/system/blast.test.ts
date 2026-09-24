import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { BLAST_FALLOFF, ENEMY_AI, STATUS } from "../data/tuning";
import { stoneFromSeed } from "../skills/generator";
import { blastFalloff, blastMulAt } from "./blast";
import { spawnBomb, updateHazards } from "./hazards";
import { updatePlayer } from "./player";
import { createSkillRunState, grenadeRadius, updateSkills } from "./skills";
import { explodeAt } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

const RADIUS = 100;
const BIG_HP = 1000;

describe("blastFalloff", () => {
  it("爆心は 1、内側の半径までは 1", () => {
    expect(blastFalloff(0, RADIUS)).toBe(1);
    expect(blastFalloff(RADIUS * BLAST_FALLOFF.innerRatio, RADIUS)).toBe(1);
  });

  it("内側から縁に向けて線形に下がり、縁で edgeMul", () => {
    const inner = RADIUS * BLAST_FALLOFF.innerRatio;
    const mid = (inner + RADIUS) / 2;
    expect(blastFalloff(mid, RADIUS)).toBeCloseTo((1 + BLAST_FALLOFF.edgeMul) / 2);
    expect(blastFalloff(RADIUS, RADIUS)).toBeCloseTo(BLAST_FALLOFF.edgeMul);
  });

  it("半径の外は edgeMul のまま（当てるかどうかは呼び出し側の判定）", () => {
    expect(blastFalloff(RADIUS * 2, RADIUS)).toBeCloseTo(BLAST_FALLOFF.edgeMul);
  });

  it("半径 0 以下は 1", () => {
    expect(blastFalloff(10, 0)).toBe(1);
  });

  it("blastMulAt は中心間距離から対象の半径を差し引く", () => {
    const c = { x: 0, y: 0 };
    expect(blastMulAt(c, RADIUS, { x: RADIUS + 10, y: 0 }, 10), "縁に触れただけなら edgeMul").toBeCloseTo(BLAST_FALLOFF.edgeMul);
    expect(blastMulAt(c, RADIUS, { x: 20, y: 0 }, 30), "爆心を体で覆えば 1").toBe(1);
  });
});

/** 爆弾をプレイヤーから dx の位置に置いて爆発させ、受けたダメージを返す */
function bombLoss(dx: number): number {
  const state = arena();
  const p = state.player.body.pos;
  spawnBomb(state, { x: p.x + dx, y: p.y }, 40);
  const hp = state.player.hp;
  const steps = Math.ceil(ENEMY_AI.bomber.fuse / FIXED_DT) + 2;
  for (let i = 0; i < steps; i++) updateHazards(state, FIXED_DT);
  return hp - state.player.hp;
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

describe("爆発の距離減衰（state で確認）", () => {
  it("敵の爆弾: 爆心にいると縁より多く受ける", () => {
    const edge = ENEMY_AI.bomber.radius + 4;
    const center = bombLoss(0);
    const rim = bombLoss(edge);
    expect(rim, "縁でも当たる").toBeGreaterThan(0);
    expect(center, "爆心の方が重い").toBeGreaterThan(rim);
  });

  it("範囲爆発（装備・祝福の爆発）: 爆心の敵は縁の敵より多く受ける", () => {
    const state = arena();
    const near = tough(state, 60);
    const far = tough(state, 60, STATUS.explodeRadius + near.body.radius - 1);
    explodeAt(state, near.body.pos, STATUS.explodeRadius, 50);
    const nearLoss = BIG_HP - near.hp;
    const farLoss = BIG_HP - far.hp;
    expect(farLoss, "縁の敵にも当たる").toBeGreaterThan(0);
    expect(nearLoss, "爆心の敵の方が重い").toBeGreaterThan(farLoss);
  });

  it("グレネード: 着弾点の敵は縁の敵より多く受ける", () => {
    const state = arena(5);
    const stone = { ...stoneFromSeed(101, { foundDepth: 1, now: 0, skillKey: "frag" }), variants: [], links: 0 };
    state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
    updateSkills(state, withInput({}), 0);
    state.player.mana = state.stats.maxMana;
    const p = state.player.body.pos;
    updatePlayer(state, withInput({ skill1Pressed: true, aimScreen: toScreen(state, { x: p.x + 60, y: p.y }) }), FIXED_DT);
    const g = state.skills.grenades[0];
    expect(g, "グレネードが出る").toBeDefined();
    if (!g) return;
    const radius = grenadeRadius(g.params);
    const near = tough(state, 0);
    near.body.pos = { ...g.to };
    const far = tough(state, 0);
    far.body.pos = { x: g.to.x, y: g.to.y + radius + far.body.radius - 1 };
    for (let i = 0; i < 120 && state.skills.grenades.length > 0; i++) updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.grenades, "爆発した").toHaveLength(0);
    const nearLoss = BIG_HP - near.hp;
    const farLoss = BIG_HP - far.hp;
    expect(farLoss, "縁の敵にも当たる").toBeGreaterThan(0);
    expect(nearLoss, "着弾点の敵の方が重い").toBeGreaterThan(farLoss);
  });
});
