import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { PLAYER } from "../data/tuning";
import { bulletDef } from "../loot/bullets";
import { overlapsWall } from "./physics";
import { shotChargeLevel, shotDamage } from "./player";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 弾（src/loot/bullets.ts。銃のベースごと）の出方と飛び方 */

const NO_ATTACK_COOLDOWN = 99;
const TOUGH_HP = 99999;
/** 壁を探す上限（px） */
const WALL_SEARCH = 2000;

/** その弾を撃つ器（ベースの key）を持たせる */
function shooter(bullet: string): GameState {
  return arena(5, { bullet, moveset: "sidearm" });
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
  step(state, withInput({ attackHeld: true }), FIXED_DT);
  return playerShots(state);
}

describe("弾の挙動: 単発・連射・散弾・貫通", () => {
  it("単発は現行と同じ 1 発で、型の作業領域を持たない", () => {
    const state = shooter("pistol");
    const shots = fireOnce(state);
    expect(shots.length).toBe(1);
    expect(shots[0]?.shot, "単発は従来の弾のまま").toBeUndefined();
    expect(shots[0]?.damage).toBeCloseTo(shotDamage(state.stats));
    expect(state.player.shootCooldown, "間隔は PLAYER.shoot.cooldown").toBeCloseTo(PLAYER.shoot.cooldown);
  });

  it("連射は間隔が短く、1 発が軽い", () => {
    const state = shooter("smg");
    const shots = fireOnce(state);
    expect(state.player.shootCooldown, "間隔が半分").toBeCloseTo(PLAYER.shoot.cooldown * bulletDef("smg").cooldownMul);
    expect(shots[0]?.damage ?? 0, "単発より軽い").toBeLessThan(shotDamage(state.stats));
  });

  it("散弾は弾数が増え、反動で大きく後ろへ跳ねる", () => {
    const spread = shooter("shotgun");
    const single = shooter("pistol");
    const shots = fireOnce(spread);
    fireOnce(single);
    expect(shots.length, "1 + pellets 発").toBe(1 + bulletDef("shotgun").pellets);
    expect(spread.player.knock.x, "後ろ（-x）へ跳ねる").toBeLessThan(single.player.knock.x);
    expect(shots[0]?.life ?? 0, "射程が短い").toBeLessThan(PLAYER.shoot.life);
  });

  it("貫通は敵を 2 体抜け、1 発が重い", () => {
    const state = shooter("rifle");
    const shots = fireOnce(state);
    expect(shots[0]?.pierceLeft, "貫通 +2").toBe(bulletDef("rifle").pierceBonus);
    expect(shots[0]?.damage ?? 0).toBeGreaterThan(shotDamage(state.stats));
  });
});

describe("弾の挙動: 追尾", () => {
  it("正面から外れた敵へ弾が曲がる", () => {
    const state = shooter("blowgun");
    tough(placeEnemy(state, "boar", 70, 40));
    const shots = fireOnce(state);
    const shot = shots[0];
    if (!shot) throw new Error("弾が出ていない");
    expect(state.player.facing.y, "撃った向きはまっすぐ +x").toBe(0);
    for (let i = 0; i < 10; i++) step(state, withInput({}), FIXED_DT);
    expect(shot.vel.y, "敵のいる +y へ曲がった").toBeGreaterThan(0);
  });
});

describe("弾の挙動: 跳弾", () => {
  /** 自分から +x 方向の最初の壁の手前に、壁へ向かう弾を置く */
  function bulletIntoWall(state: GameState, shot: string | null): Projectile {
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
      ...(shot ? { shot: { key: shot, bouncesLeft: bulletDef(shot).bounce?.count } } : {}),
    };
    state.projectiles.push(pr);
    return pr;
  }

  it("壁で跳ね返り、威力と怯み値が上がる", () => {
    const state = shooter("ricochetGun");
    const pr = bulletIntoWall(state, "ricochetGun");
    for (let i = 0; i < 3; i++) updateProjectiles(state, FIXED_DT);
    const mul = bulletDef("ricochetGun").bounce?.mul ?? 0;
    expect(pr.life, "弾は残る").toBeGreaterThan(0);
    expect(pr.vel.x, "向きが反転").toBeLessThan(0);
    expect(pr.shot?.bouncesLeft, "残り回数が減る").toBe((bulletDef("ricochetGun").bounce?.count ?? 0) - 1);
    expect(pr.damage, "威力が上がる").toBeCloseTo(10 * mul);
    expect(pr.poise, "怯み値が上がる").toBeCloseTo(2 * mul);
  });

  it("跳弾でない弾は壁で消える", () => {
    const state = shooter("pistol");
    const pr = bulletIntoWall(state, null);
    for (let i = 0; i < 3; i++) updateProjectiles(state, FIXED_DT);
    expect(pr.life).toBeLessThanOrEqual(0);
  });
});

describe("弾の挙動: チャージ", () => {
  function holdShoot(state: GameState, frames: number): void {
    for (let i = 0; i < frames; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
  }

  it("押している間は撃たず、離すと撃つ", () => {
    const state = shooter("matchlock");
    holdShoot(state, 10);
    expect(playerShots(state).length, "溜め中は撃たない").toBe(0);
    expect(state.player.shotCharging).toBe(true);
    step(state, withInput({}), FIXED_DT);
    const shots = playerShots(state);
    expect(shots.length, "離して撃った").toBe(1);
    expect(shots[0]?.damage ?? 0, "段に届かない tap は弱い").toBeCloseTo(shotDamage(state.stats) * bulletDef("matchlock").damageMul);
  });

  it("溜めるほど弾が大きく、貫通し、重くなる", () => {
    const state = shooter("matchlock");
    holdShoot(state, 50);
    expect(shotChargeLevel(state), "0.83 秒で 2 段").toBe(2);
    step(state, withInput({}), FIXED_DT);
    const shot = playerShots(state)[0];
    const lv2 = bulletDef("matchlock").charge?.levels[1];
    if (!shot || !lv2) throw new Error("弾か段が無い");
    expect(shot.radius).toBe(lv2.radius);
    expect(shot.pierceLeft).toBe(lv2.pierceBonus);
    expect(shot.damage).toBeCloseTo(shotDamage(state.stats) * lv2.damageMul);
  });
});

describe("弾の挙動: 設置弾", () => {
  it("床で止まり、近づいた敵を巻き込んで炸裂する", () => {
    const state = shooter("mineLauncher");
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
    const state = shooter("mineLauncher");
    const mine = fireOnce(state)[0];
    if (!mine) throw new Error("弾が出ていない");
    const fuseSteps = Math.ceil((bulletDef("mineLauncher").mine?.fuse ?? 0) / FIXED_DT) + 2;
    for (let i = 0; i < fuseSteps; i++) step(state, withInput({}), FIXED_DT);
    expect(state.projectiles.includes(mine), "消えた").toBe(false);
  });
});

describe("弾の挙動: 三点・回転刃・曲射（docs/ideas/combat-feel-design.md B-2）", () => {
  /** 三点の弾の間隔（ステップ） */
  const BURST_GAP_STEPS = 3;

  it("三点は 1 押しで 3 発が 3 ステップおきに出て、押しっぱなしでも次は再使用を待つ", () => {
    const state = shooter("burstRifle");
    const counts: number[] = [];
    for (let i = 0; i < 12; i++) {
      step(state, withInput({ attackHeld: true }), FIXED_DT);
      counts.push(playerShots(state).length);
    }
    const firedAt = counts.map((c, i) => (c > (counts[i - 1] ?? 0) ? i : -1)).filter((i) => i >= 0);
    expect(firedAt, "0・3・6 ステップ目に 1 発ずつ").toEqual([0, BURST_GAP_STEPS, BURST_GAP_STEPS * 2]);
    expect(counts[counts.length - 1], "4 発目は出ない").toBe(bulletDef("burstRifle").burst?.count);
    expect(state.player.shootCooldown, "次の 3 発までは待つ").toBeGreaterThan(0);
  });

  it("回転刃は寿命の半ばで折り返して手元へ戻り、行きと帰りで同じ敵に当たる", () => {
    const state = shooter("returnChakram");
    const e = tough(placeEnemy(state, "boar", 40));
    const blade = fireOnce(state)[0];
    if (!blade) throw new Error("弾が出ていない");
    let farthest = 0;
    let hitsOut = 0;
    for (let i = 0; i < 240 && blade.life > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      e.body.pos = { x: state.player.body.pos.x + 40, y: state.player.body.pos.y };
      e.knock = { x: 0, y: 0 };
      farthest = Math.max(farthest, blade.pos.x - state.player.body.pos.x);
      if (!blade.shot?.returning) hitsOut = TOUGH_HP - e.hp;
    }
    expect(hitsOut, "行きで当たった").toBeGreaterThan(0);
    expect(TOUGH_HP - e.hp, "帰りでもう一度当たった").toBeGreaterThan(hitsOut);
    expect(farthest, "遠くまで飛んだ").toBeGreaterThan(40);
    expect(blade.life, "手元に戻って消えた").toBeLessThanOrEqual(0);
    expect(state.projectiles.includes(blade), "配列から消えた").toBe(false);
  });

  it("曲射は照準の距離で炸裂し、飛行中は敵に当たらない", () => {
    const state = shooter("mortar");
    const onPath = tough(placeEnemy(state, "boar", 30));
    const atTarget = tough(placeEnemy(state, "boar", 90));
    // 照準はプレイヤーから +x へ 90（世界座標 → 画面座標は screenToWorld の逆）
    const cam = state.camera;
    const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
    const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
    const p = state.player.body.pos;
    step(state, withInput({ attackHeld: true, aimScreen: { x: p.x + 90 + ox, y: p.y + oy } }), FIXED_DT);
    const shell = playerShots(state)[0];
    if (!shell) throw new Error("弾が出ていない");
    for (let i = 0; i < 120 && shell.life > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      onPath.body.pos = { x: state.player.body.pos.x + 30, y: state.player.body.pos.y };
      onPath.knock = { x: 0, y: 0 };
      atTarget.knock = { x: 0, y: 0 };
    }
    expect(onPath.hp, "通り道の敵には当たらない").toBe(TOUGH_HP);
    expect(atTarget.hp, "着弾点の敵に爆風が当たった").toBeLessThan(TOUGH_HP);
    expect(state.sfx).toContain("explode");
  });
});
