import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { type Vec, sub } from "../core/vec";
import { DASH_FORM_KEYS, DASH_FORM_NAMES, JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { DASH_FORM, PLAYER } from "../data/tuning";
import { damagePlayer } from "./combat";
import { SKILL_DEFS, resolveCast } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { placeMine, spawnWell } from "../skills/placed";
import type { CastParams, SkillKey } from "../skills/types";
import { dashFormOf, dashFormText, wardIncomingMul } from "./dashForms";
import { isDashing } from "./player";
import { isBehind } from "./poise";
import { hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { TILE_SIZE, Tile, setTile } from "../map/grid";
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
/** 被ダメージの半減の比較の許し（丸め） */
const HURT_TOLERANCE = 1;
/** 被弾の無敵が明けるまで回す上限のステップ数 */
const MAX_GRACE_STEPS = 60;
/** 距離の比の許し（壁・ステップの刻みのずれ） */
const RATIO_DIGITS = 1;

function jobArena(job: JobKey): GameState {
  const state = arena();
  // ダッシュの移動量を地図生成の壁位置から切り離す。
  const px = Math.floor(state.player.body.pos.x / TILE_SIZE);
  const py = Math.floor(state.player.body.pos.y / TILE_SIZE);
  for (let ty = py - 3; ty <= py + 3; ty++) {
    for (let tx = px - 16; tx <= px + 16; tx++) setTile(state.map, tx, ty, Tile.Floor);
  }
  state.job = job;
  return state;
}

function paramsFor(key: SkillKey): CastParams {
  const stone = { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
  return resolveCast(SKILL_DEFS[key], stone, []);
}

/** 入れ替えの相手（地雷）を自分から dx の所に置く */
function mineAt(state: GameState, dx: number): { pos: Vec } {
  const p = state.player.body.pos;
  placeMine(state, { x: p.x + dx, y: p.y }, paramsFor("mines"));
  const mine = state.skills.mines.at(-1);
  if (!mine) throw new Error("地雷が置けない");
  return mine;
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

  it("不退（盾持ち）: 動かずに構え、構えの中の被弾は見切りになる", () => {
    const state = jobArena("shieldBearer");
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
    expect(Math.abs(state.player.body.pos.x - from.x - expected), "一瞬で移る").toBeLessThanOrEqual(walk + 1e-6);
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
  it("入れ替わり（陰陽師）: 最も近い自分の設置物と位置を入れ替え、駆けずに短く無敵になる", () => {
    const state = jobArena("onmyoji");
    const from = { ...state.player.body.pos };
    const far = mineAt(state, DASH_FORM.swap.range * 0.9);
    const near = mineAt(state, DASH_FORM.swap.range * 0.4);
    const nearFrom = { ...near.pos };
    press(state, { dashPressed: true, move: { x: 0, y: 0 } });
    expect(isDashing(state.player), "駆けない").toBe(false);
    const walk = PLAYER.speed * FIXED_DT;
    expect(Math.abs(state.player.body.pos.x - nearFrom.x), "最も近い設置物の位置へ").toBeLessThanOrEqual(walk);
    expect(near.pos, "設置物は元いた所へ").toEqual(from);
    expect(far.pos.x, "遠い方は動かない").toBeGreaterThan(from.x + DASH_FORM.swap.range * 0.8);
    expect(state.player.invulnTimer, "入れ替わった直後は無敵").toBeGreaterThan(0);
  });

  it("入れ替わり（陰陽師）: 相手がいない・遠すぎるときは駆け（見習いと同じ距離）を出す", () => {
    const base = dashOnce(jobArena("none"));
    const none = jobArena("onmyoji");
    const moved = dashOnce(none);
    expect(moved.x / base.x, "相手なしは駆け").toBeCloseTo(1, RATIO_DIGITS);
    const state = jobArena("onmyoji");
    const mine = mineAt(state, DASH_FORM.swap.range * 1.5);
    const mineFrom = { ...mine.pos };
    const ran = dashOnce(state);
    expect(ran.x / base.x, "遠い相手は無視して駆ける").toBeCloseTo(1, RATIO_DIGITS);
    expect(mine.pos, "設置物は動かない").toEqual(mineFrom);
  });

  it("入れ替わり（陰陽師）: 引力球（設置物の別の種類）とも入れ替わる", () => {
    const state = jobArena("onmyoji");
    const p = state.player.body.pos;
    spawnWell(state, { x: p.x + 50, y: p.y }, paramsFor("gravityWell"));
    const well = state.skills.wells[0];
    if (!well) throw new Error("引力球が置けない");
    const from = { ...p };
    press(state, { dashPressed: true, move: { x: 0, y: 0 } });
    expect(well.pos, "引力球が元いた所へ").toEqual(from);
  });

  it("護り足（巫女）: 短く駆け、着地から結界の秒だけ被ダメージが減る", () => {
    const base = dashOnce(jobArena("none"));
    const state = jobArena("miko");
    const moved = dashOnce(state);
    expect(moved.x, "護り足は駆けより短い").toBeLessThan(base.x);
    expect(moved.x, "護り足でも前に進む").toBeGreaterThan(0);
    expect(wardIncomingMul(state), "着地の直後は結界の中").toBe(DASH_FORM.ward.incomingMul);
    const remain = state.player.moment.wardUntil - state.time;
    expect(remain, "着地から wardSec 秒").toBeGreaterThan(DASH_FORM.ward.wardSec - FIXED_DT * 3);
    expect(remain).toBeLessThanOrEqual(DASH_FORM.ward.wardSec);
    // 着地の無敵が明けてから殴られる
    for (let i = 0; i < MAX_GRACE_STEPS && state.player.invulnTimer > 0; i++) press(state, {});
    const from = { x: state.player.body.pos.x + 10, y: state.player.body.pos.y };
    const before = state.player.hp;
    damagePlayer(state, HURT * 2, from);
    const guarded = before - state.player.hp;
    const plain = jobArena("none");
    plain.player.invulnTimer = 0;
    const plainBefore = plain.player.hp;
    damagePlayer(plain, HURT * 2, from);
    const open = plainBefore - plain.player.hp;
    expect(open, "前提: 結界なしでは削られる").toBeGreaterThan(0);
    expect(Math.abs(guarded - open * DASH_FORM.ward.incomingMul), "結界の中は倍率ぶん").toBeLessThanOrEqual(HURT_TOLERANCE);
  });

  it("護り足（巫女）: 結界の秒が過ぎたら元どおり。見習いは結界を持たない", () => {
    const state = jobArena("miko");
    dashOnce(state);
    state.time = state.player.moment.wardUntil;
    expect(wardIncomingMul(state), "時間が過ぎたら等倍").toBe(1);
    const plain = jobArena("none");
    dashOnce(plain);
    expect(wardIncomingMul(plain), "見習いは結界なし").toBe(1);
  });
});
