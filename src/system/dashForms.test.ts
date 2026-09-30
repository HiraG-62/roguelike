import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { type Vec, sub } from "../core/vec";
import { DASH_FORM_KEYS, DASH_FORM_NAMES, JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { DASH_FORM, PLAYER } from "../data/tuning";
import { grantBoon } from "./boons";
import { damagePlayer } from "./combat";
import { dashFormOf, dashFormText } from "./dashForms";
import { isDashing } from "./player";
import { isBehind } from "./poise";
import { hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 流儀のダッシュの形（src/system/dashForms.ts）の検査 */

const RIGHT: Vec = { x: 1, y: 0 };
/** ダッシュが終わるまで回す上限のステップ数 */
const MAX_DASH_STEPS = 120;
/** 振りが持続（active）に入るまで回す上限のステップ数 */
const MAX_SWING_STEPS = 60;
/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
const HURT = 20;
/** 距離の比の許し（壁・ステップの刻みのずれ） */
const RATIO_DIGITS = 1;

function jobArena(job: JobKey): GameState {
  const state = arena();
  state.job = job;
  return state;
}

function passive(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function press(state: GameState, input: Partial<FrameInput>): void {
  step(state, withInput(input), FIXED_DT);
}

/** ダッシュを押してから終わるまで回し、動いた量を返す */
function dashOnce(state: GameState, move: Vec = RIGHT): Vec {
  const from = { ...state.player.body.pos };
  press(state, { dashPressed: true, move });
  for (let i = 0; i < MAX_DASH_STEPS && isDashing(state.player); i++) press(state, {});
  return sub(state.player.body.pos, from);
}

/** 左を押して振りが持続に入るまで回す */
function swingToActive(state: GameState): void {
  press(state, { attackPressed: true });
  for (let i = 0; i < MAX_SWING_STEPS && state.player.attack.phase !== "active"; i++) press(state, {});
}

describe("ダッシュの形の定義", () => {
  it("すべての形に表示名と説明があり、見習い以外の流儀は既定でない形を持つ", () => {
    for (const form of DASH_FORM_KEYS) {
      expect(DASH_FORM_NAMES[form].length, `${form} の名前`).toBeGreaterThan(0);
      expect(dashFormText(form).length, `${form} の説明`).toBeGreaterThan(0);
    }
    for (const job of JOB_KEYS) expect(DASH_FORM_KEYS, `${job} の形`).toContain(JOBS[job].dash);
    expect(new Set(Object.values(DASH_FORM_NAMES)).size, "名前が重ならない").toBe(DASH_FORM_KEYS.length);
  });

  it("流儀の形を今のジョブから引く", () => {
    const state = jobArena("hunter");
    expect(dashFormOf(state)).toBe("leap");
  });
});

describe("ダッシュの形の動き", () => {
  it("駆け（見習い）: 既定の距離を進む", () => {
    const moved = dashOnce(jobArena("none"));
    expect(moved.x / (PLAYER.dash.speed * PLAYER.dash.time), "既定の距離").toBeCloseTo(1, RATIO_DIGITS);
  });

  it("詰め足（剣士）: 短く、振りの持続の途中でも出せ、次の左で続きの段が出る", () => {
    const base = dashOnce(jobArena("none"));
    const moved = dashOnce(jobArena("swordsman"));
    expect(moved.x / base.x, "距離の倍率").toBeCloseTo(DASH_FORM.step.distanceMul, RATIO_DIGITS);
    const plain = jobArena("none");
    swingToActive(plain);
    press(plain, { dashPressed: true, move: RIGHT });
    expect(isDashing(plain.player), "見習いは中の重さの持続を取り消せない").toBe(false);
    const state = jobArena("swordsman");
    swingToActive(state);
    expect(state.player.attack.step, "1 段目を振っている").toBe(0);
    press(state, { dashPressed: true, move: RIGHT });
    expect(isDashing(state.player), "持続の途中でも出せる").toBe(true);
    for (let i = 0; i < MAX_DASH_STEPS && isDashing(state.player); i++) press(state, {});
    press(state, { attackPressed: true });
    expect(state.player.attack.step, "ダッシュの後の左は 2 段目").toBe(1);
    expect(state.player.dashStrike, "ダッシュ攻撃ではない").toBe(false);
  });

  it("退き足（狩人）: 入力と逆へ跳び、前を向いたまま元の足元に設置弾を置く", () => {
    const state = jobArena("hunter");
    const from = { ...state.player.body.pos };
    const moved = dashOnce(state);
    expect(moved.x, "入力と逆へ").toBeLessThan(0);
    expect(state.player.facing.x, "向きは入力の方").toBeGreaterThan(0);
    const trap = state.projectiles.find((pr) => pr.owner === "player" && pr.shot?.key === "mineLauncher");
    expect(trap?.pos, "元の足元に設置弾").toEqual(from);
  });

  it("紙一重（拳闘士）: 短く、無敵がダッシュの終わりまで続く", () => {
    const base = dashOnce(jobArena("none"));
    const state = jobArena("brawler");
    press(state, { dashPressed: true, move: RIGHT });
    expect(state.player.invulnTimer, "無敵がダッシュの残りを覆う").toBeGreaterThanOrEqual(state.player.dashTimer);
    const moved = dashOnce(jobArena("brawler"));
    expect(moved.x / base.x, "距離の倍率").toBeCloseTo(DASH_FORM.slip.distanceMul, RATIO_DIGITS);
  });

  it("不退（盾持ち）: 動かずに構え、構えの中の被弾は見切りになる。祝福「鉄壁の構え」と重ねても 1 回だけ構える", () => {
    const state = jobArena("shieldBearer");
    grantBoon(state, "dashGuard");
    const charges = state.player.dashChargesLeft;
    const moved = dashOnce(state);
    expect(Math.abs(moved.x), "動かない").toBeLessThan(1);
    expect(state.player.dashChargesLeft, "回数は 1 回だけ減る").toBe(charges - 1);
    expect(state.boonRun.guardTimer, "構えている").toBeGreaterThan(0);
    expect(damagePlayer(state, HURT, { x: state.player.body.pos.x + 10, y: state.player.body.pos.y }), "見切り").toBe("dodged");
    expect(state.player.hp, "被弾しない").toBe(state.player.maxHp);
  });

  it("霧隠れ（呪術師）: すり抜けた敵を弱体にする", () => {
    const state = jobArena("hexer");
    const e = passive(placeEnemy(state, "golem", 30));
    dashOnce(state);
    expect(hasStatus(e.status, "weaken"), "すり抜けた敵").toBe(true);
    const plain = jobArena("none");
    const f = passive(placeEnemy(plain, "golem", 30));
    dashOnce(plain);
    expect(hasStatus(f.status, "weaken"), "見習いは付けない").toBe(false);
  });

  it("跳び越え（槍兵）: 着地でダッシュ攻撃を出す", () => {
    const state = jobArena("lancer");
    dashOnce(state);
    expect(state.player.attack.phase, "振っている").not.toBe("none");
    expect(state.player.dashStrike, "ダッシュ攻撃").toBe(true);
  });

  it("転移（術士）: その場でダッシュの距離を移り、ダッシュの時間を持たない", () => {
    const state = jobArena("invoker");
    const from = { ...state.player.body.pos };
    press(state, { dashPressed: true, move: RIGHT });
    expect(isDashing(state.player), "駆けない").toBe(false);
    // 同じステップの歩きの分だけずれる
    const walk = PLAYER.speed * FIXED_DT;
    const expected = PLAYER.dash.speed * PLAYER.dash.time * DASH_FORM.blink.distanceMul;
    expect(Math.abs(state.player.body.pos.x - from.x - expected), "一瞬で移る").toBeLessThanOrEqual(walk);
  });

  it("影潜り（影）: 潜っている間は攻撃が出ず、出た直後は向きを問わず背面から当たる", () => {
    const state = jobArena("shadow");
    const e = passive(placeEnemy(state, "golem", -60));
    press(state, { dashPressed: true, move: RIGHT });
    press(state, { attackPressed: true });
    expect(state.player.dashAttackQueued, "ダッシュ攻撃を予約しない").toBe(false);
    expect(isBehind(state, e), "潜っている間も背面扱い").toBe(true);
    for (let i = 0; i < MAX_DASH_STEPS && isDashing(state.player); i++) press(state, {});
    expect(state.player.attack.phase, "攻撃は出ていない").toBe("none");
    expect(isBehind(state, e), "出た直後は背面").toBe(true);
    const until = state.player.moment.backstabUntil;
    state.time = until;
    expect(isBehind(state, e), "時間が過ぎたら元どおり").toBe(false);
  });

  it("瓶投げ（錬金術師）: 元いた所に油を撒く", () => {
    const state = jobArena("alchemist");
    const from = { ...state.player.body.pos };
    expect(terrainAt(state, from.x, from.y), "撒く前").not.toBe("oil");
    dashOnce(state);
    expect(terrainAt(state, from.x, from.y), "元いた所").toBe("oil");
  });
});
