import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState, Projectile } from "../core/state";
import { length } from "../core/vec";
import { PLAYER, ULTIMATE, WEAPON } from "../data/tuning";
import { defaultUltimate, isUltimateKey, ultimateDef } from "../data/ultimates";
import { MOVESETS, actionCooldown, laneChainWindow } from "../data/weapons";
import { BASES } from "../loot/bases";
import { bulletDef } from "../loot/bullets";
import { sanitizeUltimateChoices, ultimateChoice } from "../loot/profile";
import { currentShot } from "./player";
import { arena, withInput } from "./testHelpers";
import { tryUltimate, ultimateFireRateMul, ultimateShot } from "./ultimates";

/**
 * 投擲の通常の投げの弾速・杖の氷の連射の入力の窓・投擲の奥義「早業」を、実際の入力（step）と数値で確かめる
 */

/** 投げ物の通常の投げは素の銃弾（PLAYER.shoot.speed）のこの割合より遅い（目で追える速さ） */
const THROWN_SPEED_CAP = 0.7;
/** 氷の段の窓は、共有の間（laneGap）と段の再使用が明けた後にこの秒以上の猶予を残す */
const ICE_CHAIN_SLACK = 0.5;
const SLACK_STEPS = 2;
/** 旧奥義の key（差し替え前のセーブに残っている） */
const OLD_THROWN_ULTIMATE = "thrown.returnArt";
const SWIFT_TOSS = "thrown.swiftToss";

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);
const idle = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({}));

function play(state: GameState, frames: readonly Partial<FrameInput>[]): void {
  for (const f of frames) step(state, withInput(f), FIXED_DT);
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

/** 投擲の武器種を持つベース（投げ物）の弾の key */
function thrownBulletKeys(): string[] {
  return BASES.filter((b) => b.moveset === "thrown").map((b) => b.key);
}

/** 投擲の武器種で左を 1 回押して出た弾 */
function throwOnce(state: GameState): Projectile[] {
  play(state, [{ attackPressed: true, attackHeld: true }]);
  return playerShots(state);
}

describe("投擲の通常の投げの弾速", () => {
  it("投げ物の弾はどれも素の銃弾より遅く、射程（弾速 × 寿命）は素の銃弾以上を保つ", () => {
    const keys = thrownBulletKeys();
    expect(keys.length, "投擲のベースがある").toBeGreaterThan(0);
    for (const key of keys) {
      const shot = bulletDef(key);
      expect(shot.speedMul, `${key} の弾速`).toBeLessThan(THROWN_SPEED_CAP);
      expect(shot.speedMul * shot.lifeMul, `${key} の射程`).toBeGreaterThanOrEqual(1);
    }
  });

  it("投げ短剣を左で投げた弾は設定どおりの遅さで飛ぶ", () => {
    const state = arena(5, { moveset: "thrown", bullet: "throwingKnives" });
    const [pr] = throwOnce(state);
    if (!pr) throw new Error("投げていない");
    const expected = PLAYER.shoot.speed * bulletDef("throwingKnives").speedMul * state.stats.projectileSpeedMul;
    expect(length(pr.vel), "弾速").toBeCloseTo(expected, 0);
    expect(length(pr.vel), "素の銃弾より遅い").toBeLessThan(PLAYER.shoot.speed * THROWN_SPEED_CAP);
  });
});

describe("杖の氷の連射の入力の窓", () => {
  const lane = MOVESETS.wand.steps2;

  it("氷の段（最終段を除く）の窓は共有の間と再使用より十分長い", () => {
    for (const s of lane.slice(0, -1)) {
      const window = laneChainWindow(s);
      expect(window, `${s.key} の窓は共通の窓より長い`).toBeGreaterThan(WEAPON.chainWindow);
      expect(window - Math.max(WEAPON.artDefaults.laneGap, actionCooldown(s)), `${s.key} の猶予`).toBeGreaterThanOrEqual(ICE_CHAIN_SLACK);
    }
  });

  it("上書きの無い段は全武器共通の窓のまま", () => {
    expect(laneChainWindow(MOVESETS.sword.steps2[0]), "剣の右").toBe(WEAPON.chainWindow);
    expect(laneChainWindow(undefined), "段が無い").toBe(WEAPON.chainWindow);
  });

  it("共通の窓を過ぎても氷の窓の内なら 2 段目の氷が出る", () => {
    const state = arena(5, { moveset: "wand" });
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.step, "1 段目を出して段が進む").toBe(1);
    play(state, idle(stepsFor(WEAPON.chainWindow) + SLACK_STEPS));
    expect(state.player.attack.step, "共通の窓を過ぎても段を保つ").toBe(1);
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.step, "2 段目の氷が出る").toBe(2);
  });

  it("氷の窓も切れたら 1 段目へ戻る", () => {
    const state = arena(5, { moveset: "wand" });
    play(state, [{ shootHeld: true }]);
    play(state, idle(stepsFor(laneChainWindow(lane[0])) + SLACK_STEPS));
    expect(state.player.attack.step, "1 段目へ戻る").toBe(0);
  });
});

describe("投擲の奥義「早業」", () => {
  function ready(): GameState {
    const state = arena(5, { moveset: "thrown", bullet: "throwingKnives" });
    state.profile.ultimates = { thrown: SWIFT_TOSS };
    state.player.energy = ULTIMATE.common.cost;
    return state;
  }

  it("持続中は投げ物が 1 本増え、1 体多く貫き、速く飛び、速く投げられる", () => {
    const state = ready();
    const shot = currentShot(state.stats);
    const mod = ULTIMATE.defs.thrown.swiftToss.shot;
    expect(tryUltimate(state), "発動する").toBe(true);
    const boosted = ultimateShot(state, shot);
    expect(boosted.pellets, "弾数").toBe(shot.pellets + mod.pelletsAdd);
    expect(boosted.pierceBonus, "貫通").toBe(shot.pierceBonus + mod.pierceAdd);
    expect(boosted.speedMul, "弾速").toBeCloseTo(shot.speedMul * mod.speedMul);
    expect(boosted.key, "弾の挙動はそのまま").toBe(shot.key);
    expect(ultimateFireRateMul(state), "投げる間隔が縮む").toBeGreaterThan(1);
  });

  it("持続中に左で投げると、投げ物が 1 本多く出る", () => {
    const plain = arena(5, { moveset: "thrown", bullet: "throwingKnives" });
    const base = throwOnce(plain).length;
    const state = ready();
    tryUltimate(state);
    // 発動のヒットストップ中は入力を読まないので明けてから投げる
    state.hitstop = 0;
    expect(throwOnce(state).length, "1 本多い").toBe(base + ULTIMATE.defs.thrown.swiftToss.shot.pelletsAdd);
  });

  it("旧奥義の key は捨てられ、投擲の既定の奥義に戻る", () => {
    expect(isUltimateKey(OLD_THROWN_ULTIMATE), "旧 key は定義に無い").toBe(false);
    expect(sanitizeUltimateChoices({ thrown: OLD_THROWN_ULTIMATE }), "保存から落とす").toBeUndefined();
    expect(ultimateChoice({ ultimates: { thrown: OLD_THROWN_ULTIMATE } }, "thrown").key, "既定へ").toBe(defaultUltimate("thrown").key);
    expect(ultimateDef(SWIFT_TOSS)?.kind, "早業は持続").toBe("sustain");
  });
});
