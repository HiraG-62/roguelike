import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState, Projectile } from "../core/state";
import { length } from "../core/vec";
import { PLAYER, ULTIMATE, WEAPON } from "../data/tuning";
import { defaultUltimate, isUltimateKey, ultimateDef } from "../data/ultimates";
import { MOVESETS, actionCooldown, laneChainWindow } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { sanitizeUltimateChoices, ultimateChoice } from "../loot/profile";
import { currentShot } from "./player";
import { arena, withInput } from "./testHelpers";
import { tryUltimate, ultimateShot } from "./ultimates";

/**
 * クナイの通常の投げの弾速・杖の氷の連射の入力の窓・クナイの奥義「暗器」・消した武器種の奥義の key を、実際の入力（step）と数値で確かめる
 */

/** 投げ物の通常の投げは素の銃弾（PLAYER.shoot.speed）のこの割合より遅い（目で追える速さ） */
const THROWN_SPEED_CAP = 0.7;
/** 氷の段の窓は、共有の間（laneGap）と段の再使用が明けた後にこの秒以上の猶予を残す */
const ICE_CHAIN_SLACK = 0.5;
const SLACK_STEPS = 2;
/** 消した武器種（投擲・旧戦輪）の奥義の key（差し替え前のセーブに残っている） */
const OLD_THROWN_ULTIMATE = "thrown.swiftToss";
const OLD_WAR_RING_ULTIMATE = "warRing.headsman";
const HIDDEN_ARMS = "kunai.hiddenArms";

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);
const idle = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({}));

function play(state: GameState, frames: readonly Partial<FrameInput>[]): void {
  for (const f of frames) step(state, withInput(f), FIXED_DT);
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

/** 左を 1 回押して出た弾 */
function throwOnce(state: GameState): Projectile[] {
  play(state, [{ attackPressed: true, attackHeld: true }]);
  return playerShots(state);
}

describe("クナイの通常の投げの弾速", () => {
  it("クナイの弾は素の銃弾より遅く、射程（弾速 × 寿命）は素の銃弾以上を保つ", () => {
    const shot = bulletDef("kunai");
    expect(shot.speedMul, "弾速").toBeLessThan(THROWN_SPEED_CAP);
    expect(shot.speedMul * shot.lifeMul, "射程").toBeGreaterThanOrEqual(1);
  });

  it("クナイを左で投げた弾は設定どおりの遅さで飛ぶ", () => {
    const state = arena(5, { moveset: "kunai", bullet: "kunai" });
    const [pr] = throwOnce(state);
    if (!pr) throw new Error("投げていない");
    const expected = PLAYER.shoot.speed * bulletDef("kunai").speedMul * state.stats.projectileSpeedMul;
    expect(length(pr.vel), "弾速").toBeCloseTo(expected, 0);
    expect(length(pr.vel), "素の銃弾より遅い").toBeLessThan(PLAYER.shoot.speed * state.stats.projectileSpeedMul);
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

describe("クナイの奥義「暗器」", () => {
  function ready(): GameState {
    const state = arena(5, { moveset: "kunai", bullet: "kunai" });
    state.profile.ultimates = { kunai: HIDDEN_ARMS };
    state.player.energy = ULTIMATE.common.cost;
    return state;
  }

  it("持続中は投げが 1 本増える（弾の挙動はそのまま）", () => {
    const state = ready();
    const shot = currentShot(state.stats);
    const mod = ULTIMATE.defs.kunai.hiddenArms.shot;
    expect(tryUltimate(state), "発動する").toBe(true);
    const boosted = ultimateShot(state, shot);
    expect(boosted.pellets, "弾数").toBe(shot.pellets + mod.pelletsAdd);
    expect(boosted.key, "弾の挙動はそのまま").toBe(shot.key);
  });

  it("持続中に左で投げると、クナイが 1 本多く出る", () => {
    const plain = arena(5, { moveset: "kunai", bullet: "kunai" });
    const base = throwOnce(plain).length;
    const state = ready();
    tryUltimate(state);
    // 発動のヒットストップ中は入力を読まないので明けてから投げる
    state.hitstop = 0;
    expect(throwOnce(state).length, "1 本多い").toBe(base + ULTIMATE.defs.kunai.hiddenArms.shot.pelletsAdd);
  });
});

describe("消した武器種（投擲・旧戦輪）の奥義の key", () => {
  it("消した武器種の奥義の key は捨てられ、移した奥義は戦輪の key で引ける", () => {
    expect(isUltimateKey(OLD_THROWN_ULTIMATE), "投擲の奥義は定義に無い").toBe(false);
    expect(isUltimateKey(OLD_WAR_RING_ULTIMATE), "旧 戦輪の奥義は定義に無い").toBe(false);
    expect(sanitizeUltimateChoices({ thrown: OLD_THROWN_ULTIMATE }), "保存から落とす").toBeUndefined();
    expect(sanitizeUltimateChoices({ ringBlades: OLD_WAR_RING_ULTIMATE }), "旧 key は戦輪の選択にも残らない").toBeUndefined();
    expect(ultimateChoice({ ultimates: { ringBlades: OLD_WAR_RING_ULTIMATE } }, "ringBlades").key, "既定へ").toBe(defaultUltimate("ringBlades").key);
    expect(ultimateDef("ringBlades.headsman")?.name, "断頭輪は戦輪へ移した").toBe("断頭輪");
    expect(ultimateDef("ringBlades.ringDance")?.name, "輪舞は戦輪へ移した").toBe("輪舞");
  });
});
