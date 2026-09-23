import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { PLAYER } from "../data/tuning";
import { SHOT_TYPES, type ShotKey } from "../data/weapons";
import { overlapsWall } from "./physics";
import { shotChargeLevel, shotDamage } from "./player";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 射撃の型（src/data/weapons.ts の SHOT_TYPES）ごとの弾の出方と飛び方 */

const NO_ATTACK_COOLDOWN = 99;
const TOUGH_HP = 99999;
/** 壁を探す上限（px） */
const WALL_SEARCH = 2000;

function shooter(shot: ShotKey): GameState {
  return arena(5, { shot });
}

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

/** 1 フレームだけ撃つ */
function fireOnce(state: GameState): Projectile[] {
  step(state, withInput({ shootHeld: true }), FIXED_DT);
  return playerShots(state);
}

describe("射撃の型: 単発・連射・散弾・貫通", () => {
  it("単発は現行と同じ 1 発で、型の作業領域を持たない", () => {
    const state = shooter("single");
    const shots = fireOnce(state);
    expect(shots.length).toBe(1);
    expect(shots[0]?.shot, "単発は従来の弾のまま").toBeUndefined();
    expect(shots[0]?.damage).toBeCloseTo(shotDamage(state.stats));
    expect(state.player.shootCooldown, "間隔は PLAYER.shoot.cooldown").toBeCloseTo(PLAYER.shoot.cooldown);
  });

  it("連射は間隔が短く、1 発が軽い", () => {
    const state = shooter("rapid");
    const shots = fireOnce(state);
    expect(state.player.shootCooldown, "間隔が半分").toBeCloseTo(PLAYER.shoot.cooldown * SHOT_TYPES.rapid.cooldownMul);
    expect(shots[0]?.damage ?? 0, "単発より軽い").toBeLessThan(shotDamage(state.stats));
  });

  it("散弾は弾数が増え、反動で大きく後ろへ跳ねる", () => {
    const spread = shooter("spread");
    const single = shooter("single");
    const shots = fireOnce(spread);
    fireOnce(single);
    expect(shots.length, "1 + pellets 発").toBe(1 + SHOT_TYPES.spread.pellets);
    expect(spread.player.knock.x, "後ろ（-x）へ跳ねる").toBeLessThan(single.player.knock.x);
    expect(shots[0]?.life ?? 0, "射程が短い").toBeLessThan(PLAYER.shoot.life);
  });

  it("貫通は敵を 2 体抜け、1 発が重い", () => {
    const state = shooter("pierce");
    const shots = fireOnce(state);
    expect(shots[0]?.pierceLeft, "貫通 +2").toBe(SHOT_TYPES.pierce.pierceBonus);
    expect(shots[0]?.damage ?? 0).toBeGreaterThan(shotDamage(state.stats));
  });
});

describe("射撃の型: 追尾", () => {
  it("正面から外れた敵へ弾が曲がる", () => {
    const state = shooter("homing");
    tough(placeEnemy(state, "boar", 70, 40));
    const shots = fireOnce(state);
    const shot = shots[0];
    if (!shot) throw new Error("弾が出ていない");
    expect(state.player.facing.y, "撃った向きはまっすぐ +x").toBe(0);
    for (let i = 0; i < 10; i++) step(state, withInput({}), FIXED_DT);
    expect(shot.vel.y, "敵のいる +y へ曲がった").toBeGreaterThan(0);
  });
});

describe("射撃の型: 跳弾", () => {
  /** 自分から +x 方向の最初の壁の手前に、壁へ向かう弾を置く */
  function bulletIntoWall(state: GameState, shot: ShotKey | null): Projectile {
    const p = state.player.body.pos;
    let x = p.x;
    while (!overlapsWall(state, x, p.y, 2) && x < p.x + WALL_SEARCH) x += 1;
    const pr: Projectile = {
      id: state.nextId++,
      owner: "player",
      pos: { x: x - 4, y: p.y },
      vel: { x: 300, y: 0 },
      radius: 2,
      damage: 10,
      life: 1,
      color: "#ffffff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
      poise: 2,
      ...(shot ? { shot: { key: shot, bouncesLeft: SHOT_TYPES[shot].bounce?.count } } : {}),
    };
    state.projectiles.push(pr);
    return pr;
  }

  it("壁で跳ね返り、威力と怯み値が上がる", () => {
    const state = shooter("ricochet");
    const pr = bulletIntoWall(state, "ricochet");
    for (let i = 0; i < 3; i++) updateProjectiles(state, FIXED_DT);
    const mul = SHOT_TYPES.ricochet.bounce?.mul ?? 0;
    expect(pr.life, "弾は残る").toBeGreaterThan(0);
    expect(pr.vel.x, "向きが反転").toBeLessThan(0);
    expect(pr.shot?.bouncesLeft, "残り回数が減る").toBe((SHOT_TYPES.ricochet.bounce?.count ?? 0) - 1);
    expect(pr.damage, "威力が上がる").toBeCloseTo(10 * mul);
    expect(pr.poise, "怯み値が上がる").toBeCloseTo(2 * mul);
  });

  it("跳弾でない弾は壁で消える", () => {
    const state = shooter("single");
    const pr = bulletIntoWall(state, null);
    for (let i = 0; i < 3; i++) updateProjectiles(state, FIXED_DT);
    expect(pr.life).toBeLessThanOrEqual(0);
  });
});

describe("射撃の型: チャージ", () => {
  function holdShoot(state: GameState, frames: number): void {
    for (let i = 0; i < frames; i++) step(state, withInput({ shootHeld: true }), FIXED_DT);
  }

  it("押している間は撃たず、離すと撃つ", () => {
    const state = shooter("charge");
    holdShoot(state, 10);
    expect(playerShots(state).length, "溜め中は撃たない").toBe(0);
    expect(state.player.shotCharging).toBe(true);
    step(state, withInput({}), FIXED_DT);
    const shots = playerShots(state);
    expect(shots.length, "離して撃った").toBe(1);
    expect(shots[0]?.damage ?? 0, "段に届かない tap は弱い").toBeCloseTo(shotDamage(state.stats) * SHOT_TYPES.charge.damageMul);
  });

  it("溜めるほど弾が大きく、貫通し、重くなる", () => {
    const state = shooter("charge");
    holdShoot(state, 50);
    expect(shotChargeLevel(state), "0.83 秒で 2 段").toBe(2);
    step(state, withInput({}), FIXED_DT);
    const shot = playerShots(state)[0];
    const lv2 = SHOT_TYPES.charge.charge?.levels[1];
    if (!shot || !lv2) throw new Error("弾か段が無い");
    expect(shot.radius).toBe(lv2.radius);
    expect(shot.pierceLeft).toBe(lv2.pierceBonus);
    expect(shot.damage).toBeCloseTo(shotDamage(state.stats) * lv2.damageMul);
  });
});

describe("射撃の型: 設置弾", () => {
  it("床で止まり、近づいた敵を巻き込んで炸裂する", () => {
    const state = shooter("mine");
    const mine = fireOnce(state)[0];
    if (!mine) throw new Error("弾が出ていない");
    for (let i = 0; i < 60; i++) step(state, withInput({}), FIXED_DT);
    expect(mine.life, "1 秒では炸裂しない").toBeGreaterThan(0);
    expect(Math.hypot(mine.vel.x, mine.vel.y), "床で止まった").toBe(0);
    const e = tough(placeEnemy(state, "boar", 0));
    e.body.pos = { x: mine.pos.x + 8, y: mine.pos.y };
    step(state, withInput({}), FIXED_DT);
    expect(mine.life, "敵が近づいて炸裂").toBeLessThanOrEqual(0);
    expect(e.hp, "爆風が当たった").toBeLessThan(TOUGH_HP);
    expect(state.sfx).toContain("explode");
  });

  it("敵が来なくても信管が尽きたら炸裂して消える", () => {
    const state = shooter("mine");
    const mine = fireOnce(state)[0];
    if (!mine) throw new Error("弾が出ていない");
    const fuseSteps = Math.ceil((SHOT_TYPES.mine.mine?.fuse ?? 0) / FIXED_DT) + 2;
    for (let i = 0; i < fuseSteps; i++) step(state, withInput({}), FIXED_DT);
    expect(state.projectiles.includes(mine), "消えた").toBe(false);
  });
});
