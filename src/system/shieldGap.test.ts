import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { POISE } from "../data/tuning";
import { deflectProjectile } from "./elites";
import { isStaggered } from "./poise";
import { markWindupStart, noteCommit } from "./readTiming";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 盾隙（docs/ideas/reading-core-impl.md 2-5）: 盾持ちは黄の間だけ盾を下げ、弾は怯み値を溜めて押し返さない */

const LONG_WINDUP = 10;
const KNIGHT_DX = 60;
const SHOT_POISE = 8;

/** プレイヤーの方（-x）を向いた盾騎士 */
function knightAt(state: GameState, dx = KNIGHT_DX): Enemy {
  const e = placeEnemy(state, "knight", dx);
  e.facing = { x: -1, y: 0 };
  e.phase = "chase";
  return e;
}

/** 盾の正面（プレイヤー側から敵へ）に来る弾 */
function frontShot(state: GameState, e: Enemy, extra: Partial<Projectile> = {}): Projectile {
  return {
    id: state.nextId++,
    owner: "player",
    pos: { x: e.body.pos.x - 10, y: e.body.pos.y },
    vel: { x: 200, y: 0 },
    radius: 2,
    damage: 5,
    life: 1,
    color: "#ffffff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
    poise: SHOT_POISE,
    ...extra,
  };
}

function enterWindup(state: GameState, e: Enemy): void {
  e.phase = "windup";
  markWindupStart(state, e);
  e.windupTotal = LONG_WINDUP;
  e.phaseTimer = LONG_WINDUP;
}

describe("盾隙: 黄の間は盾を下げる", () => {
  it("黄の間は正面の弾が通り、盾を構えている間は消える", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    expect(deflectProjectile(state, frontShot(state, e), e), "構えている").toBe(true);
    enterWindup(state, e);
    state.time = 2;
    const pr = frontShot(state, e);
    expect(deflectProjectile(state, pr, e), "黄の間は盾が無い").toBe(false);
    expect(pr.life, "弾は消えない").toBeGreaterThan(0);
  });

  it("赤になると盾が上がり、弾は消える", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    enterWindup(state, e);
    state.time = 2;
    e.phaseTimer = 0.01;
    noteCommit(state, e);
    state.time = 2 + FIXED_DT * 2;
    expect(deflectProjectile(state, frontShot(state, e), e), "赤").toBe(true);
  });
});

describe("盾隙: 弾で受けたとき", () => {
  it("怯み値を shotBlockMul 倍で溜め、ダメージは通らない", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    const pr = frontShot(state, e);
    deflectProjectile(state, pr, e);
    expect(e.poise.damage, "溜まった怯み値").toBeGreaterThan(0);
    expect(e.poise.damage, "近接の blockMul と同じ半分の見込み").toBeLessThanOrEqual(SHOT_POISE * POISE.shotBlockMul * 3);
    expect(pr.life, "弾は消える").toBe(0);
  });

  it("撃ち続けると盾が崩れて怯む", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    for (let i = 0; i < 200 && !isStaggered(e); i++) deflectProjectile(state, frontShot(state, e), e);
    expect(isStaggered(e), "崩れた").toBe(true);
  });

  it("押し返さない（弾で近寄らせない答えを消す）", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    deflectProjectile(state, frontShot(state, e), e);
    expect(e.knock.x, "押し返し x").toBe(0);
    expect(e.knock.y, "押し返し y").toBe(0);
  });

  it("弾の受けは浮き文字を出さない", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    const before = state.texts.length;
    deflectProjectile(state, frontShot(state, e), e);
    expect(state.texts.length, "浮き文字").toBe(before);
  });

  it("wallHit は 1 体 0.15 秒に 1 回まで", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    state.sfx.length = 0;
    deflectProjectile(state, frontShot(state, e), e);
    deflectProjectile(state, frontShot(state, e), e);
    expect(state.sfx.filter((s) => s === "wallHit"), "同じ時刻の 2 発").toHaveLength(1);
    state.sfx.length = 0;
    state.time = 1.2;
    deflectProjectile(state, frontShot(state, e), e);
    expect(state.sfx.filter((s) => s === "wallHit"), "0.15 秒後").toHaveLength(1);
    state.sfx.length = 0;
    state.time = 1.25;
    deflectProjectile(state, frontShot(state, e), e);
    expect(state.sfx.filter((s) => s === "wallHit"), "0.05 秒後は間引く").toHaveLength(0);
  });
});

describe("盾隙: 盾を抜ける弾", () => {
  it("零距離の短銃弾（pointBlank）は構えている盾を抜ける", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    const pr = frontShot(state, e, { pointBlank: true });
    expect(deflectProjectile(state, pr, e), "盾を抜ける").toBe(false);
  });

  it("出端の弾（黄で撃った放出の弾）は、飛ぶ間に赤になっても盾を抜ける", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    enterWindup(state, e);
    state.time = 2;
    const firedAt = state.time;
    e.phaseTimer = 0.01;
    noteCommit(state, e);
    state.time = 2 + FIXED_DT * 3;
    const pr = frontShot(state, e, { release: { finisher: false, crit: false }, firedAt });
    expect(deflectProjectile(state, pr, e), "出端").toBe(false);
  });

  it("放出でない弾は、黄で撃っても赤になった盾に止められる", () => {
    const state = arena();
    state.time = 1;
    const e = knightAt(state);
    enterWindup(state, e);
    state.time = 2;
    e.phaseTimer = 0.01;
    noteCommit(state, e);
    state.time = 2 + FIXED_DT * 3;
    expect(deflectProjectile(state, frontShot(state, e, { firedAt: 2 }), e), "普通の弾").toBe(true);
  });

  it("短銃を盾持ちの零距離で撃つと弾に pointBlank が付き、離れて撃つと付かない", () => {
    const near = arena(5, { moveset: "sidearm" });
    // 弾の線から外して置く（すぐ盾に当たって消えないように）。距離だけが零距離の内側
    placeEnemy(near, "knight", 12, 24);
    step(near, withInput({ attackHeld: true, attackPressed: true }), FIXED_DT);
    const nearShot = near.projectiles.find((p) => p.owner === "player");
    expect(nearShot?.pointBlank, "零距離").toBe(true);

    const far = arena(5, { moveset: "sidearm" });
    placeEnemy(far, "knight", 12, 90);
    step(far, withInput({ attackHeld: true, attackPressed: true }), FIXED_DT);
    const farShot = far.projectiles.find((p) => p.owner === "player");
    expect(farShot, "弾が出た").toBeDefined();
    expect(farShot?.pointBlank, "離れている").not.toBe(true);
  });
});
