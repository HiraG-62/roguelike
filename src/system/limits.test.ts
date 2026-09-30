import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, Projectile } from "../core/state";
import { LIMITS } from "../data/tuning";
import type { CastParams, Mine, SkillShot } from "../skills/types";
import { enforceLimits } from "./limits";
import { placedPools } from "./rules";
import { arena, withInput } from "./testHelpers";

/** 種類ごとの効果は見ないので、params は空で足りる */
const NO_PARAMS = {} as unknown as CastParams;

function projectile(id: number, owner: Projectile["owner"]): Projectile {
  return {
    id,
    owner,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    radius: 2,
    damage: 1,
    life: 100,
    color: "#fff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
  };
}

function skillShot(id: number): SkillShot {
  return {
    id,
    effect: "plain",
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    life: 100,
    radius: 2,
    power: 1,
    knockback: 0,
    color: "#fff",
    params: NO_PARAMS,
    hitIds: new Set(),
    pierceLeft: 0,
    bouncesLeft: 0,
  };
}

function mine(id: number): Mine {
  return { id, pos: { x: 0, y: 0 }, arm: 0, life: 100, params: NO_PARAMS };
}

function fill(state: GameState, projectiles: number, shots: number, mines: number): void {
  for (let i = 0; i < projectiles; i++) state.projectiles.push(projectile(i + 1, "player"));
  for (let i = 0; i < shots; i++) state.skills.shots.push(skillShot(i + 1));
  for (let i = 0; i < mines; i++) state.skills.mines.push(mine(i + 1));
}

describe("性能の歯止め（enforceLimits）", () => {
  it("プレイヤーの弾が上限を超えると古い順に消え、敵の弾は数に関わらず消えない", () => {
    const state = arena(1);
    const over = 10;
    // 敵の弾を前後に混ぜる。古い順に切るときも敵の弾は飛ばして数える
    for (let i = 0; i < 5; i++) state.projectiles.push(projectile(1000 + i, "enemy"));
    fill(state, LIMITS.playerProjectiles + over, 0, 0);
    for (let i = 0; i < 5; i++) state.projectiles.push(projectile(2000 + i, "enemy"));

    enforceLimits(state);

    const own = state.projectiles.filter((p) => p.owner === "player");
    expect(own.length, "プレイヤーの弾は上限まで").toBe(LIMITS.playerProjectiles);
    expect(own[0]?.id, "古い方から消える").toBe(over + 1);
    expect(own[own.length - 1]?.id, "新しい方は残る").toBe(LIMITS.playerProjectiles + over);
    expect(state.projectiles.filter((p) => p.owner === "enemy").length, "敵の弾は消さない").toBe(10);
    expect(state.ruleRun.trimmed, "消した数を数える").toBe(over);
  });

  it("スキルの弾と設置物も上限で古い順に消え、消した数を ruleRun.trimmed に足す", () => {
    const state = arena(2);
    fill(state, 0, LIMITS.skillShots + 3, LIMITS.placedPerPool + 4);

    enforceLimits(state);

    expect(state.skills.shots.length, "スキルの弾").toBe(LIMITS.skillShots);
    expect(state.skills.shots[0]?.id, "古い弾から消える").toBe(4);
    expect(state.skills.mines.length, "設置物の置き場ごと").toBe(LIMITS.placedPerPool);
    expect(state.skills.mines[0]?.id, "古い設置物から消える").toBe(5);
    expect(state.ruleRun.trimmed, "弾と設置物の合計").toBe(3 + 4);
  });

  it("設置物は置き場ごとに数える（別の置き場どうしは足し合わせない）", () => {
    const state = arena(3);
    const pools = placedPools(state).slice(0, 2);
    for (const pool of pools) for (let i = 0; i < LIMITS.placedPerPool; i++) pool.push({ pos: { x: 0, y: 0 } });

    enforceLimits(state);

    for (const pool of pools) expect(pool.length, "上限ちょうどは消さない").toBe(LIMITS.placedPerPool);
    expect(state.ruleRun.trimmed, "数えない").toBe(0);
  });

  it("上限に届かなければ何も消えない", () => {
    const state = arena(4);
    fill(state, LIMITS.playerProjectiles, LIMITS.skillShots, LIMITS.placedPerPool);
    const before = [state.projectiles.length, state.skills.shots.length, state.skills.mines.length];

    enforceLimits(state);

    expect([state.projectiles.length, state.skills.shots.length, state.skills.mines.length], "ちょうど上限は消さない").toEqual(before);
    expect(state.ruleRun.trimmed, "数えない").toBe(0);
  });

  it("step の末尾で効く（同じ seed と入力なら同じ要素が消える）", () => {
    const run = (): { ids: number[]; trimmed: number } => {
      const state = createGame(7);
      state.enemies = [];
      fill(state, LIMITS.playerProjectiles + 20, 0, 0);
      // (0,0) は壁で先に消えるので、立っている床に置く
      for (const p of state.projectiles) p.pos = { ...state.player.body.pos };
      step(state, withInput({}), FIXED_DT);
      return { ids: state.projectiles.map((p) => p.id), trimmed: state.ruleRun.trimmed };
    };
    const a = run();
    const b = run();
    expect(a.trimmed, "step の中で切る").toBeGreaterThanOrEqual(20);
    expect(a, "同じ結果").toEqual(b);
    expect(a.ids.includes(1), "一番古い弾は消える").toBe(false);
  });
});
