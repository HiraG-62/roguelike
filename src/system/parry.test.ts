import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { PARRY } from "../data/tuning";
import { damagePlayer } from "./combat";
import { fireEnemyBullet } from "./enemyTraits";
import { parryLocksDash, parryMoveMul } from "./parry";
import { applyStatus, statusStacks } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { artLocksActions, artMoveMul } from "./weaponArts";

/**
 * 全武器共通の受け流し（system/parry.ts）。実際の入力（step）を通して、窓・硬直・敵の止め方・弾・入力の縛りを
 * 状態と数値で確かめる。剣の右 1 段目の構えの受け流しは weaponArts.test.ts
 */

const NO_ATTACK_COOLDOWN = 99;
const HIT = 10;
const TOUCH_DX = 10;
const BULLET_SPEED = 60;
const BULLET_DX = 6;
/** 弾が届くまで進める（窓 0.2 秒の内側） */
const BULLET_STEPS = 6;
const BOSS_KEY = "kingSlime";
/** 予備動作の総秒と残り。残りが総秒の commitRatio（0.6）を切っているのでコミット済み */
const WINDUP_TOTAL = 1;
const WINDUP_LEFT_COMMITTED = 0.3;
const STRIKE_TIME = 0.5;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

function play(state: GameState, frames: readonly Partial<FrameInput>[]): void {
  for (const f of frames) step(state, withInput(f), FIXED_DT);
}

const idle = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({}));

/** 攻撃を出さない敵（次の攻撃の開始を止め、置いた phase だけで振る舞わせる） */
function calm(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

/** コミット済みの予備動作中にする（怯み値では崩せない） */
function committedWindup(e: Enemy): Enemy {
  e.phase = "windup";
  e.windupTotal = WINDUP_TOTAL;
  e.phaseTimer = WINDUP_LEFT_COMMITTED;
  return e;
}

/** プレイヤーへ向かう突進中にする */
function strikingAtPlayer(e: Enemy): Enemy {
  e.phase = "strike";
  e.phaseTimer = STRIKE_TIME;
  e.strikeDir = { x: -1, y: 0 };
  e.windupTotal = WINDUP_TOTAL;
  return e;
}

function isStaggeredEnemy(e: Enemy): boolean {
  return statusStacks(e.status, "stagger") > 0;
}

describe("受け流しの構え", () => {
  it("押すと窓が開き、窓の間は攻撃・ダッシュが出せず移動が遅くなる", () => {
    const state = arena(5);
    play(state, [{ parryPressed: true }]);
    expect(state.player.parry.window, "窓が開いた").toBeGreaterThan(0);
    expect(artLocksActions(state), "攻撃・射撃を塞ぐ").toBe(true);
    expect(parryLocksDash(state), "ダッシュを塞ぐ").toBe(true);
    expect(artMoveMul(state), "移動は窓の倍率").toBe(PARRY.windowMoveMul);
    expect(parryMoveMul(state)).toBe(PARRY.windowMoveMul);

    play(state, [{ dashPressed: true }]);
    expect(state.player.dashTimer, "ダッシュは出ない").toBe(0);
    expect(state.player.dashChargesLeft, "ダッシュの回数を消費しない").toBe(state.stats.dashCharges);
    play(state, [{ attackPressed: true }]);
    expect(state.player.attack.phase, "攻撃は出ない").toBe("none");
  });

  it("振っている間・ダッシュ中・怯み中は構えられない", () => {
    const swinging = arena(5);
    play(swinging, [{ attackPressed: true }]);
    expect(swinging.player.attack.phase, "振り始めた").not.toBe("none");
    play(swinging, [{ parryPressed: true }]);
    expect(swinging.player.parry.window, "振り中は押せない").toBe(0);

    const dashing = arena(5);
    play(dashing, [{ dashPressed: true }, { parryPressed: true }]);
    expect(dashing.player.dashTimer, "ダッシュ中").toBeGreaterThan(0);
    expect(dashing.player.parry.window, "ダッシュ中は押せない").toBe(0);

    const held = arena(5);
    applyStatus(held, { kind: "player" }, { kind: "stagger", stacks: 1, duration: 1, potency: 0 }, "env");
    play(held, [{ parryPressed: true }]);
    expect(held.player.parry.window, "怯み中は押せない").toBe(0);
  });

  it("窓の間に被弾が無ければ外れ、硬直の間は攻撃・ダッシュが出ず足が止まる", () => {
    const state = arena(5);
    play(state, [{ parryPressed: true }, ...idle(stepsFor(PARRY.windowSec) + 1)]);
    expect(state.player.parry.window, "窓が閉じた").toBe(0);
    expect(state.player.parry.recover, "外した硬直").toBeGreaterThan(0);
    expect(artMoveMul(state), "硬直の間は足が止まる").toBe(PARRY.recoverMoveMul);

    play(state, [{ attackPressed: true, dashPressed: true }]);
    expect(state.player.attack.phase, "硬直の間は振れない").toBe("none");
    expect(state.player.dashTimer, "硬直の間はダッシュできない").toBe(0);
    play(state, [{ parryPressed: true }]);
    expect(state.player.parry.window, "硬直の間は連打で構え直せない").toBe(0);

    play(state, idle(stepsFor(PARRY.recoverSec) + 1));
    expect(state.player.parry.recover, "硬直が解けた").toBe(0);
    play(state, [{ attackPressed: true }]);
    expect(state.player.attack.phase, "硬直が解ければ振れる").not.toBe("none");
  });

  it("窓を過ぎた被弾は通る", () => {
    const state = arena(5);
    const e = calm(placeEnemy(state, "boar", TOUCH_DX));
    play(state, [{ parryPressed: true }, ...idle(stepsFor(PARRY.windowSec) + 1)]);
    const hp = state.player.hp;
    expect(damagePlayer(state, HIT, e.body.pos, e), "被弾する").toBe("hit");
    expect(state.player.hp, "生命が減る").toBeLessThan(hp);
  });
});

describe("受け流しの成功", () => {
  it("窓の中の被弾は無効になり、敵が怯み、カウンター扱いのイベントと無敵が出る", () => {
    const state = arena(5);
    const e = calm(placeEnemy(state, "boar", TOUCH_DX));
    play(state, [{ parryPressed: true }]);
    const hp = state.player.hp;
    state.events.length = 0;
    expect(damagePlayer(state, HIT, e.body.pos, e), "受け流した").toBe("parried");
    expect(state.player.hp, "生命が減らない").toBe(hp);
    expect(isStaggeredEnemy(e), "敵が怯む").toBe(true);
    expect(state.events.some((ev) => ev.kind === "onCounter"), "カウンター扱い").toBe(true);
    expect(state.player.invulnTimer, "成功の直後は無敵").toBeGreaterThan(0);
    expect(state.player.parry.window, "窓は閉じる").toBe(0);
    expect(state.sfx, "受け流しの音").toContain("counter");

    play(state, idle(stepsFor(PARRY.recoverSec) + 5));
    expect(state.player.parry.recover, "成功なら硬直しない").toBe(0);
  });

  it("成功すると気力が戻る", () => {
    const state = arena(5);
    const e = calm(placeEnemy(state, "boar", TOUCH_DX));
    state.player.mana = 0;
    play(state, [{ parryPressed: true }]);
    damagePlayer(state, HIT, e.body.pos, e);
    expect(state.player.mana, "気力が増える").toBeGreaterThan(0);
  });

  it("コミット済みの予備動作でも受け流せば怯む（怯み値では崩せない攻撃を止められる）", () => {
    const state = arena(5);
    const e = committedWindup(calm(placeEnemy(state, "boar", TOUCH_DX)));
    play(state, [{ parryPressed: true }]);
    damagePlayer(state, HIT, e.body.pos, e);
    expect(isStaggeredEnemy(e), "怯んだ").toBe(true);
    expect(e.phase, "予備動作は取り消される").toBe("chase");
    expect(e.attackCooldown, "次の攻撃まで間が空く").toBeGreaterThan(0);
  });

  it("攻撃の最中（strike）の突進に触れても受け流せて、敵は隙（recover）に上書きされず怯んだまま", () => {
    const state = arena(5);
    const e = strikingAtPlayer(calm(placeEnemy(state, "boar", TOUCH_DX)));
    const hp = state.player.hp;
    play(state, [{ parryPressed: true }]);
    expect(state.player.hp, "触れても生命が減らない").toBe(hp);
    expect(isStaggeredEnemy(e), "敵が怯む").toBe(true);
    expect(e.phase, "強撃は取り消されて追跡へ戻る（隙で上書きされない）").toBe("chase");
    expect(e.attackCooldown, "次の攻撃まで間が空く").toBeGreaterThan(0);
  });

  it("敵の弾は受け流されて消える", () => {
    const state = arena(5);
    play(state, [{ parryPressed: true }]);
    const pos = state.player.body.pos;
    fireEnemyBullet(state, { pos: { x: pos.x + BULLET_DX, y: pos.y }, dir: { x: -1, y: 0 }, speed: BULLET_SPEED, damage: HIT, color: "#ffffff" });
    const hp = state.player.hp;
    play(state, idle(BULLET_STEPS));
    const bullet = state.projectiles.find((pr) => pr.owner === "enemy");
    expect(bullet === undefined || bullet.life <= 0, "弾が消えた").toBe(true);
    expect(state.player.hp, "生命が減らない").toBe(hp);
  });

  it("ボスは怯まず、怯み値だけが入る（受け流しで毎回ダウンはしない）", () => {
    const state = arena(5);
    const boss = committedWindup(calm(placeEnemy(state, BOSS_KEY, TOUCH_DX)));
    boss.poise.damage = 0;
    play(state, [{ parryPressed: true }]);
    damagePlayer(state, HIT, boss.body.pos, boss);
    expect(isStaggeredEnemy(boss), "ダウンしない").toBe(false);
    expect(boss.poise.damage, "コミット済みでも怯み値が入る").toBeGreaterThan(0);
    expect(boss.poise.damage, "ダウンのゲージを満たし切らない").toBeLessThan(boss.poise.max);
  });

  it("窓の外の被弾は敵を怯ませない", () => {
    const state = arena(5);
    const e = calm(placeEnemy(state, "boar", TOUCH_DX));
    damagePlayer(state, HIT, e.body.pos, e);
    expect(isStaggeredEnemy(e), "受け流しでは怯まない").toBe(false);
  });
});
