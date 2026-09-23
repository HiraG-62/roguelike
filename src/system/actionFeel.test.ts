import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { dist } from "../core/vec";
import { ACTION, BOON, PLAYER } from "../data/tuning";
import { grantBoon } from "./boons";
import { damageEnemy, damagePlayer } from "./combat";
import { updateEnemies } from "./enemies";
import { overlapsWall } from "./physics";
import { counterPoise, meleeStep } from "./player";
import { hasStatus } from "./statusEffects";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
/** 攻撃を振り切るまでのステップ数 */
const SWING_STEPS = 20;
/** 予備動作を十分長く保つ */
const LONG_WINDUP = 10;

function passive(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function run(state: GameState, steps: number, attack = false): void {
  for (let i = 0; i < steps; i++) step(state, withInput({ attackPressed: attack && i === 0 }), FIXED_DT);
}

function swingOnce(state: GameState): void {
  run(state, SWING_STEPS, true);
}

/** 近接 n 段目（ダッシュ攻撃）の、今の stats での威力 */
function slashDamage(state: GameState, combo: number, dashStrike = false): number {
  const step = meleeStep(state.stats, combo, dashStrike);
  if (!step) throw new Error(`近接の段が無い: ${combo}`);
  return step.damage;
}

function hasText(state: GameState, text: string): boolean {
  return state.texts.some((t) => t.text === text);
}

/** 1 ステップごとの効果音を集める */
function runCollectSfx(state: GameState, steps: number, attack = false): Set<string> {
  const heard = new Set<string>();
  for (let i = 0; i < steps; i++) {
    step(state, withInput({ attackPressed: attack && i === 0 }), FIXED_DT);
    for (const s of state.sfx) heard.add(s);
  }
  return heard;
}

function enemyBullet(state: GameState, dx: number, speed: number, damage: number): Projectile {
  const p = state.player.body.pos;
  const pr: Projectile = {
    id: state.nextId++,
    owner: "enemy",
    pos: { x: p.x + dx, y: p.y },
    vel: { x: -speed, y: 0 },
    radius: 3,
    damage,
    life: 3,
    color: "#e070ff",
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
  };
  state.projectiles.push(pr);
  return pr;
}

describe("カウンターヒット", () => {
  it("windup 中の敵に近接を当てると 1.5 倍 + カウンター！", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    e.phaseTimer = LONG_WINDUP;
    const before = e.hp;
    const heard = runCollectSfx(state, SWING_STEPS, true);
    expect(before - e.hp, "カウンターの威力").toBe(Math.round(slashDamage(state, 0) * ACTION.counter.damageMul));
    expect(hasText(state, ACTION.counter.text)).toBe(true);
    expect(heard.has("counter")).toBe(true);
  });

  it("windup 以外（chase）ではカウンターにならない", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.phase = "chase";
    const before = e.hp;
    swingOnce(state);
    // 実ダメージは rollOutgoing で Math.round 済み（combat.ts）。QA 2026-09-23 の近接基礎値調整で
    // scaled 値が端数（7.8）になったため、生の値ではなく丸め後の値と比較する
    expect(before - e.hp, "通常の 1 段目の威力").toBe(Math.round(slashDamage(state, 0)));
    expect(hasText(state, ACTION.counter.text)).toBe(false);
  });

  it("カウンターは確定の怯みではなく怯み値が 2 倍になる", () => {
    const state = arena();
    const first = meleeStep(state.stats, 0);
    if (!first) throw new Error("1 段目が無い");
    expect(counterPoise(first, true), "カウンターの怯み値").toBe(first.poise * ACTION.counter.poiseMul);
    expect(counterPoise(first, false), "通常の怯み値").toBe(first.poise);

    // 猪（耐性が高い）に 1 段目のカウンターを 1 回当てても怯まない
    const e = passive(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    e.phaseTimer = LONG_WINDUP;
    for (let i = 0; i < SWING_STEPS && e.hp === e.maxHp; i++) {
      step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
    }
    expect(e.hp, "カウンターが当たっている").toBeLessThan(e.maxHp);
    expect(e.phase, "確定の怯み（旧 phase）にならない").not.toBe("stagger");
    expect(hasStatus(e.status, "stagger"), "怯みの状態異常も付かない").toBe(false);
  });
});

describe("ラストキル・スロー", () => {
  it("ロック中の部屋で最後の敵を倒すとスロー + フラッシュ + CLEAR", () => {
    const state = arena();
    const room = state.rooms[0]!;
    room.locked = true;
    room.kind = "normal";
    const e = passive(placeEnemy(state, "slime", 14));
    e.hp = 1;
    let sawSlow = false;
    let sawFlash = false;
    const heard = new Set<string>();
    for (let i = 0; i < SWING_STEPS; i++) {
      step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
      for (const s of state.sfx) heard.add(s);
      if (e.hp <= 0 && !sawSlow) {
        sawSlow = state.slowmo > 0;
        sawFlash = state.flash > ACTION.lastKill.flash / 2;
      }
    }
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(sawSlow).toBe(true);
    expect(sawFlash).toBe(true);
    expect(hasText(state, ACTION.lastKill.text)).toBe(true);
    expect(heard.has("lastKill")).toBe(true);
  });

  it("まだ敵が残っていれば出ない", () => {
    const state = arena();
    state.rooms[0]!.locked = true;
    state.rooms[0]!.kind = "normal";
    const e = passive(placeEnemy(state, "slime", 14));
    e.hp = 1;
    passive(placeEnemy(state, "slime", -80));
    swingOnce(state);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(hasText(state, ACTION.lastKill.text)).toBe(false);
  });

  it("ロックされていない部屋では出ない", () => {
    const state = arena();
    state.rooms[0]!.locked = false;
    const e = passive(placeEnemy(state, "slime", 14));
    e.hp = 1;
    swingOnce(state);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(hasText(state, ACTION.lastKill.text)).toBe(false);
  });

  it("challenge の途中の波では出ない", () => {
    const state = arena();
    const room = state.rooms[0]!;
    room.locked = true;
    room.kind = "challenge";
    room.wave = 1;
    const e = passive(placeEnemy(state, "slime", 14));
    e.hp = 1;
    swingOnce(state);
    expect(hasText(state, ACTION.lastKill.text)).toBe(false);
  });
});

describe("リゲイン", () => {
  const TAKEN = 20;

  function hurt(state: GameState): void {
    const p = state.player.body.pos;
    damagePlayer(state, TAKEN, { x: p.x - 10, y: p.y });
  }

  function meleeHit(state: GameState, e: Enemy): void {
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
  }

  it("被弾で取り戻せる分が積まれ、近接ヒットごとに被ダメの 15% 戻る", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 60));
    hurt(state);
    const p = state.player;
    expect(p.hp).toBe(p.maxHp - TAKEN);
    expect(p.regainPool).toBeCloseTo(TAKEN * ACTION.regain.poolRatio);
    expect(p.regainTimer).toBeCloseTo(ACTION.regain.window);
    meleeHit(state, e);
    expect(p.hp).toBeCloseTo(p.maxHp - TAKEN + TAKEN * ACTION.regain.perHitRatio);
  });

  it("合計で被ダメの 60% までしか戻らない", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 60));
    e.hp = 1000;
    hurt(state);
    for (let i = 0; i < 10; i++) meleeHit(state, e);
    const p = state.player;
    expect(p.hp).toBeCloseTo(p.maxHp - TAKEN + TAKEN * ACTION.regain.poolRatio);
    expect(p.regainPool).toBeCloseTo(0);
  });

  it("3 秒を過ぎると取り戻せる分は消える", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 200));
    hurt(state);
    const frames = Math.ceil((ACTION.regain.window + 0.2) / FIXED_DT);
    run(state, frames);
    const p = state.player;
    expect(p.regainPool).toBe(0);
    const hp = p.hp;
    meleeHit(state, e);
    expect(p.hp).toBe(hp);
  });

  it("射撃（ranged）では戻らない", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 60));
    hurt(state);
    const hp = state.player.hp;
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(state.player.hp).toBe(hp);
  });
});

describe("見切り斬り（祝福 justSlash）", () => {
  const ENEMY_DIST = 60;

  function justDodge(state: GameState, e: Enemy): void {
    const p = state.player;
    p.dashTimer = PLAYER.dash.time;
    p.invulnTimer = PLAYER.dash.time;
    p.dodgedThisDash = false;
    expect(damagePlayer(state, 10, e.body.pos, e)).toBe("dodged");
    state.hitstop = 0;
  }

  it("JUST 回避直後の攻撃で敵の手前へ瞬間移動して重い一撃", () => {
    const state = arena();
    grantBoon(state, "justSlash");
    const e = passive(placeEnemy(state, "boar", ENEMY_DIST));
    e.hp = 1000;
    justDodge(state, e);
    expect(state.player.justCounterTimer).toBeCloseTo(ACTION.justCounter.window);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    const d = dist(state.player.body.pos, e.body.pos);
    expect(d).toBeLessThan(ENEMY_DIST / 2);
    expect(d).toBeGreaterThanOrEqual(e.body.radius + state.player.body.radius);
    // rollOutgoing が先に Math.round するため（player.ts の justCounterStrike）、
    // ここでも生の値ではなく丸め後の値に倍率をかけてから丸める（QA 2026-09-23 の端数化で表面化）
    const expected = Math.round(Math.round(slashDamage(state, PLAYER.melee.length - 1)) * ACTION.justCounter.damageMul);
    expect(1000 - e.hp, "3 段目 × 見切り斬りの倍率").toBe(expected);
    expect(hasText(state, ACTION.justCounter.text)).toBe(true);
  });

  it("祝福が無ければ JUST 直後の攻撃は普通の 1 段目（瞬間移動しない）", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", ENEMY_DIST));
    justDodge(state, e);
    const before = { ...state.player.body.pos };
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(hasText(state, ACTION.justCounter.text), "見切り斬りの表示が出ない").toBe(false);
    expect(state.player.attack.combo, "1 段目から始まる").toBe(0);
    expect(dist(state.player.body.pos, before), "瞬間移動しない").toBeLessThan(ENEMY_DIST / 2);
  });

  it("0.4 秒を過ぎると出ない（普通の 1 段目になる）", () => {
    const state = arena();
    grantBoon(state, "justSlash");
    const e = passive(placeEnemy(state, "boar", ENEMY_DIST));
    justDodge(state, e);
    // JUST のスロー込みでもゲーム時間で 0.4 秒を超えるまで待つ
    const frames = 90;
    run(state, frames);
    expect(state.player.justCounterTimer).toBe(0);
    const before = { ...state.player.body.pos };
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(hasText(state, ACTION.justCounter.text)).toBe(false);
    expect(state.player.attack.combo).toBe(0);
    expect(dist(state.player.body.pos, before)).toBeLessThan(ENEMY_DIST / 2);
  });

  it("遠すぎる敵へは飛ばない", () => {
    const state = arena();
    grantBoon(state, "justSlash");
    const e = passive(placeEnemy(state, "boar", ACTION.justCounter.maxRange + 20));
    justDodge(state, e);
    const before = { ...state.player.body.pos };
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(hasText(state, ACTION.justCounter.text)).toBe(false);
    expect(dist(state.player.body.pos, before)).toBeLessThan(ENEMY_DIST);
  });
});

describe("弾返し（祝福 reflect）", () => {
  it("近接の active で敵弾を斬るとプレイヤー弾として反射する", () => {
    const state = arena();
    grantBoon(state, "reflect");
    const pr = enemyBullet(state, 22, 135, 8);
    const energy = state.player.energy;
    const hp = state.player.hp;
    for (let i = 0; i < 6 && pr.owner === "enemy"; i++) {
      step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
    }
    expect(pr.owner).toBe("player");
    expect(pr.kind).toBe("ranged");
    expect(pr.damage).toBe(8 * ACTION.reflect.damageMul);
    expect(Math.hypot(pr.vel.x, pr.vel.y)).toBeCloseTo(135 * ACTION.reflect.speedMul);
    expect(pr.vel.x).toBeGreaterThan(0);
    expect(state.player.energy - energy, "撃ち返しの必殺ゲージは 3 倍").toBe(ACTION.reflect.energy * BOON.parryEnergyMul);
    expect(hasText(state, ACTION.reflect.text)).toBe(true);
    expect(state.player.hp).toBe(hp);
    expect(state.projectiles).toContain(pr);
  });

  it("反射弾は敵にダメージを与え、プレイヤーには当たらない", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 40));
    const p = state.player.body.pos;
    const reflected: Projectile = {
      id: state.nextId++,
      owner: "player",
      pos: { x: p.x, y: p.y },
      vel: { x: 175, y: 0 },
      radius: 3,
      damage: 16,
      life: 1,
      color: ACTION.reflect.color,
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: ACTION.reflect.pierce,
    };
    state.projectiles.push(reflected);
    const hp = state.player.hp;
    updateProjectiles(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
    const before = e.hp;
    for (let i = 0; i < 30 && e.hp === before; i++) updateProjectiles(state, FIXED_DT);
    expect(before - e.hp).toBe(16);
  });

  it("祝福が無ければ近接は敵弾を素通りし、プレイヤーに当たる", () => {
    const state = arena();
    const pr = enemyBullet(state, 22, 135, 8);
    for (let i = 0; i < SWING_STEPS; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
    expect(pr.owner, "反射されない").toBe("enemy");
    expect(state.player.hp, "被弾する").toBeLessThan(state.player.maxHp);
  });

  it("攻撃していなければ反射されずプレイヤーに当たる", () => {
    const state = arena();
    const pr = enemyBullet(state, 22, 135, 8);
    run(state, 20);
    expect(pr.owner).toBe("enemy");
    expect(state.player.hp).toBeLessThan(state.player.maxHp);
  });
});

describe("壁叩きつけ", () => {
  /** プレイヤーから +x 方向で最初に壁に当たる x（半径 r の円の中心） */
  function wallX(state: GameState, r: number): number {
    const p = state.player.body.pos;
    let x = p.x;
    while (!overlapsWall(state, x, p.y, r)) x += 1;
    return x;
  }

  it("吹き飛び中に壁に当たると 10 ダメージ", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 0));
    e.hp = 1000;
    e.body.pos.x = wallX(state, e.body.radius) - 10;
    e.wallSplat = true;
    e.knock = { x: 320, y: 0 };
    const heard = new Set<string>();
    for (let i = 0; i < 10; i++) {
      updateEnemies(state, FIXED_DT);
      for (const s of state.sfx) heard.add(s);
    }
    expect(1000 - e.hp).toBe(ACTION.wallSplat.damage);
    expect(heard.has("wallHit")).toBe(true);
    expect(e.wallSplat).toBe(false);
  });

  it("弱い吹き飛び（フラグなし）では追加ダメージなし", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 0));
    e.hp = 1000;
    e.body.pos.x = wallX(state, e.body.radius) - 10;
    e.knock = { x: 320, y: 0 };
    for (let i = 0; i < 10; i++) updateEnemies(state, FIXED_DT);
    expect(e.hp).toBe(1000);
  });

  it("近接 3 段目のヒットで wallSplat が立つ", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.hp = 1000;
    const flagged: boolean[] = [];
    for (let i = 0; i < 80; i++) {
      step(state, withInput({ attackPressed: true }), FIXED_DT);
      flagged.push(e.wallSplat === true);
      // 敵をプレイヤーの前に戻して 3 段とも当てる
      e.body.pos = { x: state.player.body.pos.x + 14, y: state.player.body.pos.y };
    }
    expect(flagged.some((f) => f)).toBe(true);
  });
});

describe("ダッシュ攻撃", () => {
  it("ダッシュ中に攻撃を押すとダッシュ終了と同時にダッシュ攻撃が出る", () => {
    const state = arena();
    step(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.dashTimer).toBeGreaterThan(0);
    step(state, withInput({ attackPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.dashAttackQueued).toBe(true);
    expect(state.player.attack.phase).toBe("none");
    let started = false;
    for (let i = 0; i < 20 && !started; i++) {
      step(state, withInput({}), FIXED_DT);
      started = state.player.attack.phase !== "none";
    }
    expect(started).toBe(true);
    expect(state.player.dashTimer).toBe(0);
    expect(state.player.dashStrike).toBe(true);
    expect(state.player.dashAttackQueued).toBe(false);
  });

  it("ダッシュ攻撃のダメージは 1 段目と 2 段目の間", () => {
    const state = arena();
    const e = passive(placeEnemy(state, "boar", 0));
    e.hp = 1000;
    const p = state.player;
    p.dashStrike = false;
    p.dashTimer = FIXED_DT / 2;
    p.dashAttackQueued = true;
    e.body.pos = { x: p.body.pos.x + ACTION.dashAttack.reach, y: p.body.pos.y };
    run(state, SWING_STEPS);
    expect(1000 - e.hp, "ダッシュ攻撃の威力").toBe(Math.round(slashDamage(state, 0, true)));
    expect(slashDamage(state, 0, true)).toBeGreaterThan(slashDamage(state, 0));
    expect(ACTION.dashAttack.reach).toBeGreaterThan(PLAYER.melee[1]!.reach);
  });

  it("ダッシュしていなければ普通の 1 段目", () => {
    const state = arena();
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).not.toBe("none");
    expect(state.player.dashStrike).toBe(false);
  });
});
