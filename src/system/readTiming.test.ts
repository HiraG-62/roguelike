import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { ACTION, ENEMY_TEMPO, FEEL, KEYSTONE } from "../data/tuning";
import { MOVESETS } from "../data/weapons";
import { conditionMet } from "./triggers";
import { KS } from "./keystones";
import { traitOutgoingMul, traitPoiseMul } from "./traitHooks";
import { ultimateOutgoingMul } from "./ultimates";
import { isStaggered } from "./poise";
import { NEVER_TIME, markWindupStart, noteCommit, yellowAt } from "./readTiming";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 読み合いの時刻（出端の判定。docs/ideas/reading-core-impl.md 2-2・2-3・2-4） */

const NO_ATTACK_COOLDOWN = 99;
/** 黄の間は十分長く保つ（総秒） */
const LONG_WINDUP = 10;
/** 赤（コミット窓）に入っている残り秒 */
const RED_LEFT = LONG_WINDUP * ENEMY_TEMPO.commitRatio * 0.5;
const NEAR = 14;
const SWING_STEPS = 40;

/** 敵を「いま予備動作が始まった黄」にする。始まりの時刻は今 */
function startWindup(state: GameState, e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.phase = "windup";
  markWindupStart(state, e);
  e.windupTotal = LONG_WINDUP;
  e.phaseTimer = LONG_WINDUP;
  return e;
}

/** 1 ステップ進める（攻撃キーを押すかどうかを選ぶ）。そのステップで積まれた効果音を返す */
function tick(state: GameState, attack = false): Set<string> {
  // 効果音は main.ts が drain するので、テストでは 1 ステップごとに空にして数える
  state.sfx.length = 0;
  step(state, withInput({ attackPressed: attack }), FIXED_DT);
  return new Set(state.sfx);
}

/** 敵を赤にして、赤になった時刻を記録させる */
function turnRed(state: GameState, e: Enemy): void {
  e.phaseTimer = RED_LEFT;
  noteCommit(state, e);
}

/** 型の絞り込み（代入直後の phase 比較が不要な警告にならないように） */
function phaseOf(e: Enemy): string {
  return e.phase;
}

function windupEnemy(state: GameState, dx = NEAR): Enemy {
  const e = placeEnemy(state, "boar", dx);
  return startWindup(state, e);
}

describe("yellowAt（予告が黄だったか）", () => {
  it("同じステップで予備動作が始まった敵は、まだ見えていないので黄でない（境界）", () => {
    const state = arena();
    state.time = 1;
    const e = windupEnemy(state);
    expect(yellowAt(e, 1), "始まったのと同じ時刻").toBe(false);
    expect(yellowAt(e, 1 + FIXED_DT), "次のステップ").toBe(true);
  });

  it("同じステップで赤になった敵は、そのステップの入力にとっては黄（境界）", () => {
    const state = arena();
    state.time = 1;
    const e = windupEnemy(state);
    state.time = 2;
    turnRed(state, e);
    expect(e.committedAt, "赤になった時刻").toBe(2);
    expect(yellowAt(e, 2), "赤になったのと同じステップに押した入力").toBe(true);
    expect(yellowAt(e, 2 + FIXED_DT), "次のステップ以降は赤").toBe(false);
  });

  it("予備動作でも攻撃中でもない敵は黄でない", () => {
    const state = arena();
    state.time = 1;
    const e = placeEnemy(state, "boar", NEAR);
    e.phase = "chase";
    expect(yellowAt(e, 5), "追跡中").toBe(false);
    e.phase = "recover";
    expect(yellowAt(e, 5), "隙").toBe(false);
  });

  it("攻撃中（strike）に入ったら赤の記録が付き、それより後の時刻では黄でない", () => {
    const state = arena();
    state.time = 1;
    const e = windupEnemy(state);
    state.time = 2;
    e.phase = "strike";
    noteCommit(state, e);
    expect(e.committedAt, "攻撃に入った時刻が赤の時刻").toBe(2);
    expect(yellowAt(e, 3)).toBe(false);
  });

  it("連撃の続き（最初から赤）は黄にならない", () => {
    const state = arena();
    state.time = 1;
    const e = windupEnemy(state);
    e.chainWindup = true;
    noteCommit(state, e);
    state.time = 2;
    expect(yellowAt(e, 2), "続きの予備動作").toBe(false);
  });

  it("markWindupStart は赤の記録を消す（次の予備動作は黄から始まる）", () => {
    const state = arena();
    state.time = 1;
    const e = windupEnemy(state);
    state.time = 2;
    turnRed(state, e);
    state.time = 3;
    markWindupStart(state, e);
    expect(e.windupAt).toBe(3);
    expect(e.committedAt).toBe(NEVER_TIME);
    expect(yellowAt(e, 3 + FIXED_DT)).toBe(true);
  });
});

/** src の本体ファイル（テスト以外）を再帰で集める */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("windupAt の書き漏れの検査", () => {
  it("敵の phase を windup にする所は、直後の数行のうちに markWindupStart を呼ぶ", () => {
    const root = join(__dirname, "..");
    const WINDOW = 3;
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // プレイヤーの振り（a.phase）は敵ではない
        if (!/\b\w+\.phase = "windup";/.test(line) || /\ba\.phase = "windup"/.test(line)) return;
        const near = lines.slice(i, i + WINDOW + 1).join("\n");
        if (!near.includes("markWindupStart(")) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing, "markWindupStart が無い予備動作の入り口").toEqual([]);
  });

  it("実際に予備動作へ入った敵は windupAt を持つ", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", NEAR);
    e.phase = "chase";
    e.attackCooldown = 0;
    for (let i = 0; i < 120 && phaseOf(e) !== "windup"; i++) tick(state);
    expect(phaseOf(e), "予備動作に入る").toBe("windup");
    expect(e.windupAt, "入った時刻が残る").toBeGreaterThan(NEVER_TIME);
    expect(e.windupAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(state.time);
  });
});

describe("出端（黄で振り始めた近接）", () => {
  it("黄で振り始めて、当たる時に赤になっていても出端。敵の攻撃は止まらず、技の後に怯む", () => {
    const state = arena();
    const e = windupEnemy(state);
    e.poise.max = 1;
    e.poise.damage = 0;
    // 黄のうちに振り始める
    tick(state, true);
    expect(state.player.attack.phase, "振り始めた").not.toBe("none");
    // 当たる前に敵が赤へ入る
    turnRed(state, e);
    const heard = new Set<string>();
    let sawStrike = false;
    let pendingWhileAttacking = false;
    for (let i = 0; i < SWING_STEPS && !pendingWhileAttacking; i++) {
      for (const s of tick(state)) heard.add(s);
      if (e.poise.pending && (e.phase === "windup" || e.phase === "strike") && !isStaggered(e)) pendingWhileAttacking = true;
    }
    expect(heard.has("counter"), "出端の音").toBe(true);
    expect(heard.has("hitCommitted"), "普通の命中の音は鳴らない").toBe(false);
    expect(pendingWhileAttacking, "怯み値は溜まり、赤の攻撃は止めず先送り").toBe(true);
    // 技を出し切った後で怯む
    let staggered = false;
    for (let i = 0; i < 400 && !staggered; i++) {
      tick(state);
      if (e.phase === "strike") sawStrike = true;
      staggered = isStaggered(e);
    }
    expect(sawStrike, "攻撃は出た").toBe(true);
    expect(staggered, "技の後で怯む").toBe(true);
  });

  it("出端の命中は止めが入り、onCounter は 1 回", () => {
    const state = arena();
    windupEnemy(state);
    tick(state, true);
    let hitstop = 0;
    let counters = 0;
    for (let i = 0; i < SWING_STEPS; i++) {
      step(state, withInput({}), FIXED_DT);
      hitstop = Math.max(hitstop, state.hitstop);
      counters = state.recent.onCounter?.count ?? counters;
    }
    expect(counters, "出端の出来事").toBe(1);
    expect(hitstop, "止めが入る").toBeGreaterThan(FEEL.hitstopNormalMax);
    expect(ACTION.counter.damageMul).toBeGreaterThan(1);
  });

  it("赤の間に振り始めた命中は出端でなく普通の命中。鈍い打音が 1 振りに 1 回", () => {
    const state = arena();
    const e = windupEnemy(state);
    e.poise.max = 0;
    turnRed(state, e);
    tick(state);
    let counterHeard = false;
    let committedSteps = 0;
    const before = e.hp;
    for (let i = 0; i < SWING_STEPS; i++) {
      const sfx = tick(state, i === 0);
      if (sfx.has("counter")) counterHeard = true;
      if (sfx.has("hitCommitted")) committedSteps++;
    }
    expect(before - e.hp, "命中はしている").toBeGreaterThan(0);
    expect(counterHeard, "出端の音は鳴らない").toBe(false);
    expect(committedSteps, "鈍い打音は 1 振りに 1 回").toBe(1);
    expect(state.recent.onCounter, "onCounter は出ない").toBeUndefined();
  });

  it("多段の一撃でも出端の出来事（onCounter・音）は 1 振り × 1 体に 1 回", () => {
    const multi = Object.values(MOVESETS).find((m) => m.steps.some((s) => (s.hits ?? 1) > 1));
    if (!multi) throw new Error("多段の段を持つ武器種が無い");
    const state = arena(5, { moveset: multi.key });
    state.player.attack.step = multi.steps.findIndex((s) => (s.hits ?? 1) > 1);
    const e = windupEnemy(state);
    e.hp = 100000;
    e.maxHp = 100000;
    e.poise.max = 0;
    tick(state, true);
    let counterSteps = 0;
    let count = 0;
    for (let i = 0; i < SWING_STEPS * 2; i++) {
      const sfx = tick(state);
      if (sfx.has("counter")) counterSteps++;
      count = state.recent.onCounter?.count ?? count;
    }
    expect(count, "onCounter の回数").toBe(1);
    expect(counterSteps, "出端の音の回数").toBe(1);
  });
});

describe("出端（黄のうちに撃った放出の弾）", () => {
  function shoot(state: GameState, e: Enemy, firedAt: number, release: boolean): void {
    state.projectiles.push({
      id: state.nextId++,
      owner: "player",
      pos: { ...e.body.pos },
      vel: { x: 100, y: 0 },
      radius: 3,
      damage: 5,
      life: 2,
      color: "#ffffff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
      poise: 1,
      ...(release ? { release: { finisher: false, crit: false }, firedAt } : {}),
    });
  }

  it("撃った時に黄だった敵に放出の弾が当たると、命中の時に赤でも出端", () => {
    const state = arena();
    const e = windupEnemy(state, 60);
    state.time += 0.5;
    const firedAt = state.time;
    state.time += FIXED_DT;
    turnRed(state, e);
    shoot(state, e, firedAt, true);
    tick(state);
    expect(state.recent.onCounter?.count, "出端の出来事").toBe(1);
  });

  it("放出でない弾・撃った時に赤だった弾は出端にならない", () => {
    const state = arena();
    const e = windupEnemy(state, 60);
    state.time += 0.5;
    turnRed(state, e);
    const firedAt = state.time + FIXED_DT;
    shoot(state, e, firedAt, false);
    tick(state);
    expect(state.recent.onCounter, "放出でない弾").toBeUndefined();
    const red = arena();
    const r = windupEnemy(red, 60);
    red.time += 0.5;
    turnRed(red, r);
    red.time += FIXED_DT;
    shoot(red, r, red.time, true);
    tick(red);
    expect(red.recent.onCounter, "赤のうちに撃った放出の弾").toBeUndefined();
  });
});

describe("予備動作中を条件にする報酬は黄の間だけ（C1〜C6）", () => {
  function setup(): { state: GameState; yellow: Enemy; red: Enemy } {
    const state = arena();
    const yellow = windupEnemy(state, 20);
    const red = windupEnemy(state, 40);
    state.time += 1;
    turnRed(state, red);
    state.time += FIXED_DT;
    return { state, yellow, red };
  }

  it("C1〜C4: 条件 targetInWindup（先読み・星読みの眼・狩人・起点の条件）は黄の敵だけ真", () => {
    const { state, yellow, red } = setup();
    expect(conditionMet(state, "targetInWindup", { pos: yellow.body.pos, targetId: yellow.id }), "黄").toBe(true);
    expect(conditionMet(state, "targetInWindup", { pos: red.body.pos, targetId: red.id }), "赤").toBe(false);
  });

  it("C5: 読み勝ちの誓いは、黄の間に振り始めた近接だけ怯み値 ×10。赤の間は罰", () => {
    const { state, yellow, red } = setup();
    state.stats.keystones = [KS.readOath];
    state.player.attack.startedAt = state.time - FIXED_DT / 2;
    expect(traitPoiseMul(state, yellow, "melee", false), "黄").toBeCloseTo(KEYSTONE.readPoiseMul);
    expect(traitPoiseMul(state, red, "melee", false), "赤").toBe(0);
    expect(traitOutgoingMul(state, red, "melee", false), "赤は与ダメージの罰").toBeCloseTo(KEYSTONE.readOffWindupDamageMul);
  });

  it("C6: 奥義の持続中の予備動作への倍は黄の敵だけ", () => {
    const { state, yellow, red } = setup();
    state.stats.moveset = "katana";
    state.player.ultimate.active = "katana.mushin";
    const base = ultimateOutgoingMul(state, null);
    expect(ultimateOutgoingMul(state, yellow), "黄").toBeGreaterThan(base);
    expect(ultimateOutgoingMul(state, red), "赤").toBe(base);
  });
});
