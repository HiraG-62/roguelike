import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { ULTIMATE } from "../data/tuning";
import { ULTIMATES } from "../data/ultimates";
import { FORMS } from "../data/weaponForms";
import { type ButtonKey, MOVESETS, type PinDef } from "../data/weapons";
import { cancelAttack, damageEnemy } from "./combat";
import { timedAttackSpeedMul } from "./morale";
import { pinCount, stickPin } from "./pins";
import { dashCooldownTime, playerMoveset } from "./player";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { endUltimate, tryUltimate } from "./ultimates";

/**
 * 手裏剣の技の一式（docs/ideas/gun-bases-review.md 0-5・2-9）: 交互の連撃・左の 3 連射と右の扇の 3 本・刺さり崩しと戦意・
 * 大手裏剣の食い込み・連ね投げ・抜け斬りの気力・奥義 3 本を、本物の定義（MOVESETS.shuriken）で確かめる
 */

const TOUGH_HP = 99999;
const MAX_STEPS = 600;
const STAR = MOVESETS.shuriken;
const STAR_STEPS = STAR.steps.length;

function tough(e: Enemy): Enemy {
  e.attackCooldown = 99;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  e.phase = "idle";
  return e;
}

/** 1 ステップだけ押し、次のステップで離す（右は押しっぱなしの差で押した瞬間を取る） */
function press(state: GameState, button: ButtonKey): void {
  step(state, withInput(button === "primary" ? { attackPressed: true, attackHeld: true } : { shootHeld: true }), FIXED_DT);
  step(state, withInput({}), FIXED_DT);
}

function runUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) step(state, withInput({}), FIXED_DT);
  expect(done(), "条件に届いた").toBe(true);
}

/** 振りの active で次を押し、次の振りが始まるまで進める */
function chain(state: GameState, button: ButtonKey): void {
  const a = state.player.attack;
  runUntil(state, () => a.phase === "active");
  press(state, button);
  runUntil(state, () => a.phase === "windup");
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((p) => p.owner === "player");
}

/** 振りが弾を出す（active に入る）まで進める */
function throwOnce(state: GameState, button: ButtonKey): Projectile[] {
  press(state, button);
  runUntil(state, () => playerShots(state).length > 0);
  return playerShots(state);
}

describe("手裏剣の連撃（交互）", () => {
  it("同じ手を続けても段はそのまま、左右を替えたときだけ段が進み、最後の段は同じ手でも続かない", () => {
    const state = arena(5, { moveset: "shuriken" });
    const a = state.player.attack;
    press(state, "primary");
    expect([a.step, a.lane]).toEqual([0, "primary"]);
    chain(state, "primary");
    expect([a.step, a.lane], "左 → 左").toEqual([0, "primary"]);
    chain(state, "secondary");
    expect([a.step, a.lane], "左 → 右").toEqual([1, "secondary"]);
    chain(state, "secondary");
    expect([a.step, a.lane], "右 → 右").toEqual([1, "secondary"]);
    chain(state, "primary");
    expect([a.step, a.lane], "右 → 左（大手裏剣）").toEqual([STAR_STEPS - 1, "primary"]);
    runUntil(state, () => a.phase === "active");
    press(state, "primary");
    runUntil(state, () => a.phase === "none");
    expect([a.step, a.phase], "大手裏剣の後は連撃が終わる").toEqual([0, "none"]);
  });

  it("押しっぱなしでは投げ続けない（左を押し続けても 1 回）", () => {
    const state = arena(5, { moveset: "shuriken" });
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 0; i < 120; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    const stars = state.projectiles.filter((p) => p.owner === "player" && p.radius <= 3);
    expect(stars.length, "1 回の投げ（3 連射）までしか出ない").toBeLessThanOrEqual(STAR.steps[0]?.cast?.throw.bullet.burst?.count ?? 0);
  });

  it("連撃の本数は 3 本 → 4 本 → 大手裏剣 1 本で、右も同じ（左は連射の数、右は扇の数）", () => {
    expect(STAR.steps.map((s) => (s.cast?.throw.count ?? 0) * (s.cast?.throw.bullet.burst?.count ?? 1))).toEqual([3, 4, 1]);
    expect(STAR.steps2.map((s) => (s.kind === "swing" ? s.step.cast?.throw.count : undefined))).toEqual([3, 4, 1]);
  });
});

describe("左は 3 連射、右は扇の 3 本", () => {
  it("左は同じ向きへ 1 本ずつ間を置いて 3 本続けて投げる（同時に並べない）", () => {
    const state = arena(5, { moveset: "shuriken" });
    const first = throwOnce(state, "primary");
    expect(first, "投げた瞬間は 1 本").toHaveLength(1);
    const burst = STAR.steps[0]?.cast?.throw.bullet.burst;
    expect(burst?.count, "3 連射").toBe(3);
    const seen: Projectile[] = [...first];
    const firedAt = [0];
    for (let i = 0; i < 60 && seen.length < 3; i++) {
      step(state, withInput({}), FIXED_DT);
      for (const p of playerShots(state)) if (!seen.includes(p)) {
        seen.push(p);
        firedAt.push(i + 1);
      }
    }
    expect(seen, "続けて 3 本").toHaveLength(3);
    const dirs = new Set(seen.map((p) => Math.atan2(p.vel.y, p.vel.x).toFixed(4)));
    expect(dirs.size, "全部同じ向き").toBe(1);
    expect(firedAt[0]! < firedAt[1]! && firedAt[1]! < firedAt[2]!, "1 本ずつ間を置いて投げた").toBe(true);
  });

  it("右は向きの違う 3 本が扇に広がる", () => {
    const state = arena(5, { moveset: "shuriken" });
    const shots = throwOnce(state, "secondary");
    expect(shots, "3 本").toHaveLength(3);
    const dirs = new Set(shots.map((p) => Math.atan2(p.vel.y, p.vel.x).toFixed(4)));
    expect(dirs.size, "向きは 3 つに分かれる").toBe(3);
  });

  it("小さな手裏剣は貫通せず敵に刺さる（pin）", () => {
    for (const s of STAR.steps.slice(0, 2)) {
      const bullet = s.cast?.throw.bullet;
      expect(bullet?.pin?.kind, "刺さる").toBe("shuriken");
      expect(bullet?.pierceBonus, "貫通しない").toBe(0);
    }
  });
});

describe("刺さり崩し（8 本で怯み、戦意）", () => {
  const pin = STAR.steps[0]?.cast?.throw.bullet.pin as PinDef;

  it("同じ敵に 8 本刺さると怯んで刺さりが消え、戦意が 1 溜まる。3 秒で抜ける", () => {
    expect(pin.staggerAt, "8 本で崩す").toBe(8);
    expect(pin.sec, "3 秒で抜ける").toBe(3);
    const state = arena(5, { moveset: "shuriken" });
    const e = tough(placeEnemy(state, "boar", 30));
    for (let i = 0; i < 7; i++) expect(stickPin(state, e, pin, 0, 1), `${i + 1} 本目`).toBe("stuck");
    expect(state.player.morale.value, "怯ませるまで戦意は溜まらない").toBe(0);
    expect(stickPin(state, e, pin, 0, 1), "8 本目").toBe("staggered");
    expect(pinCount(state, e, "shuriken"), "刺さりが消える").toBe(0);
    expect(state.player.morale.value, "戦意 +1").toBe(1);
    state.time += pin.sec + 0.1;
    expect(pinCount(state, e), "抜けた").toBe(0);
  });

  it("本物の投げ 3 回（3 + 4 + 3 = 10 本）が止まった敵に刺さって怯ませる", () => {
    const state = arena(5, { moveset: "shuriken" });
    const e = tough(placeEnemy(state, "boar", 24));
    for (const button of ["primary", "secondary", "primary"] as const) {
      press(state, button);
      runUntil(state, () => state.player.attack.phase === "none");
    }
    for (let i = 0; i < 60; i++) step(state, withInput({}), FIXED_DT);
    expect(state.player.morale.value + pinCount(state, e, "shuriken"), "刺さった（崩した分は戦意へ）").toBeGreaterThan(0);
  });

  it("戦意は最大 3、放つには 3", () => {
    const m = FORMS.star.morale;
    expect([m.numbers.max, m.numbers.releaseMin]).toEqual([3, 3]);
    expect(m.gain.map((g) => g.kind)).toEqual(["pinStagger"]);
    expect(m.release.kind).toBe("timed");
  });
});

describe("大手裏剣（食い込んで 6 回）", () => {
  it("当てた敵に食い込んで 6 回当たる", () => {
    const state = arena(5, { moveset: "shuriken" });
    const e = tough(placeEnemy(state, "boar", 22));
    // 1 段目 → 右で 2 段目 → 左で 3 段目（大手裏剣）
    press(state, "primary");
    chain(state, "secondary");
    chain(state, "primary");
    let most = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      step(state, withInput({}), FIXED_DT);
      for (const p of playerShots(state)) most = Math.max(most, p.shot?.grind?.done ?? 0);
    }
    expect(STAR.steps[2]?.cast?.throw.bullet.grind?.hits, "6 回").toBe(6);
    expect(most, "食い込みで 6 回当たった").toBe(6);
    expect(e.hp, "傷を受けた").toBeLessThan(TOUGH_HP);
  });
});

describe("連ね投げ（満ちた後の次の投げで 2 秒、投げの間隔が半分）", () => {
  it("戦意が満ちた次の投げで始まり、2 秒のあいだ振りの秒が半分になって、窓が閉じる", () => {
    const state = arena(5, { moveset: "shuriken" });
    state.player.morale.value = FORMS.star.morale.numbers.max;
    expect(timedAttackSpeedMul(state), "満ちただけでは始まらない").toBe(1);
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    expect(state.player.morale.value, "戦意を使う").toBe(0);
    expect(timedAttackSpeedMul(state), "窓の間は 2 倍").toBe(2);
    const windup = STAR.steps[0]?.windup ?? 0;
    expect(state.player.attack.timer, "予備動作が半分").toBeLessThanOrEqual(windup / 2 + 1e-9);
    const sec = FORMS.star.morale.release.kind === "timed" ? FORMS.star.morale.release.sec : 0;
    expect(sec, "2 秒").toBe(2);
    for (let t = 0; t < sec - 0.2; t += FIXED_DT) step(state, withInput({}), FIXED_DT);
    expect(timedAttackSpeedMul(state), "まだ窓の中").toBe(2);
    for (let t = 0; t < 0.5; t += FIXED_DT) step(state, withInput({}), FIXED_DT);
    expect(timedAttackSpeedMul(state), "窓が閉じる").toBe(1);
  });

  it("戦意が満ちていなければ始まらない", () => {
    const state = arena(5, { moveset: "shuriken" });
    state.player.morale.value = FORMS.star.morale.numbers.max - 1;
    press(state, "primary");
    expect(timedAttackSpeedMul(state)).toBe(1);
  });
});

describe("抜け斬り（ダッシュ攻撃）", () => {
  const dash = STAR.dashAttack;

  /** 道筋に count 体を並べてダッシュ攻撃を 1 回振る。戻った気力 */
  function passCut(count: number): number {
    const state = arena(5, { moveset: "shuriken", maxMana: 1000 });
    state.player.mana = 0;
    for (let i = 0; i < count; i++) tough(placeEnemy(state, "boar", 14 + i * 12, 0));
    state.player.dashAttackQueued = true;
    step(state, withInput({}), FIXED_DT);
    expect(state.player.dashStrike, "ダッシュ攻撃").toBe(true);
    runUntil(state, () => state.player.attack.phase === "none");
    return state.player.mana;
  }

  it("すり抜けて斬る段で、斬った敵の数だけ気力が戻る", () => {
    expect(dash.passThrough, "すり抜ける").toBe(true);
    expect(dash.manaPerTarget, "1 体ごとの気力").toBeGreaterThan(0);
    const one = passCut(1);
    const three = passCut(3);
    expect(one, "1 体で戻る").toBeGreaterThan(0);
    expect(three, "3 体は 1 体の 3 倍近く戻る").toBeGreaterThan(one * 2.5);
  });

  it("途中で止められた抜け斬りの道筋と気力の頭打ちの外しは残らない", () => {
    const state = arena(5, { moveset: "shuriken" });
    state.player.dashAttackQueued = true;
    step(state, withInput({}), FIXED_DT);
    const a = state.player.attack;
    expect(a.passFrom, "抜け斬りの道筋").toBeDefined();
    expect(a.uncappedMana, "頭打ちを外す").toBe(true);
    cancelAttack(state);
    expect(a.passFrom, "道筋は消える").toBeUndefined();
    expect(a.uncappedMana, "頭打ちは戻る").toBeUndefined();
  });
});

describe("奥義 3 本", () => {
  function ready(key: string): GameState {
    const state = arena(5, { moveset: "shuriken" });
    state.profile.ultimates = { shuriken: key };
    state.player.energy = ULTIMATE.common.cost;
    return state;
  }

  it("奥義は一撃 2 本と持続 1 本", () => {
    expect(ULTIMATES.shuriken.map((u) => [u.key, u.kind])).toEqual([
      ["shuriken.eightfold", "instant"],
      ["shuriken.greatWheel", "instant"],
      ["shuriken.dragonBlade", "sustain"],
    ]);
  });

  it("八方手裏剣は全周へ 16 本の刺さる手裏剣を投げる", () => {
    const state = ready("shuriken.eightfold");
    expect(tryUltimate(state)).toBe(true);
    const shots = playerShots(state);
    expect(shots, "16 本").toHaveLength(16);
    expect(shots.every((p) => p.shot?.pin?.kind === "shuriken"), "全部刺さる").toBe(true);
    const dirs = new Set(shots.map((p) => Math.atan2(p.vel.y, p.vel.x).toFixed(3)));
    expect(dirs.size, "全周へ別々の向き").toBe(16);
  });

  it("大車輪は巨大な手裏剣が自分の周りを 2 周する", () => {
    const state = ready("shuriken.greatWheel");
    expect(tryUltimate(state)).toBe(true);
    const wheel = playerShots(state);
    expect(wheel, "1 本").toHaveLength(1);
    const orbit = wheel[0]?.shot?.orbit;
    expect(orbit?.laps, "2 周").toBe(2);
    const radius = orbit?.radius ?? 0;
    const e = tough(placeEnemy(state, "boar", radius));
    const fixed = { ...e.body.pos };
    let turned = 0;
    let last = Math.atan2((wheel[0]?.pos.y ?? 0) - state.player.body.pos.y, (wheel[0]?.pos.x ?? 0) - state.player.body.pos.x);
    for (let i = 0; i < MAX_STEPS && playerShots(state).length > 0; i++) {
      // 敵は動かさない（寄ってきて輪の外へ出ないように）
      e.body.pos = { ...fixed };
      step(state, withInput({}), FIXED_DT);
      const pr = playerShots(state)[0];
      if (!pr) break;
      const now = Math.atan2(pr.pos.y - state.player.body.pos.y, pr.pos.x - state.player.body.pos.x);
      let d = now - last;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turned += Math.abs(d);
      last = now;
    }
    expect(turned / (2 * Math.PI), "およそ 2 周回った").toBeGreaterThan(1.7);
    expect(TOUGH_HP - e.hp, "回る間に当たる").toBeGreaterThan(0);
    expect(playerShots(state), "回り切ると消える").toHaveLength(0);
  });

  it("龍刃は刀を抜いて左右とも斬りになり、終わると手裏剣へ戻る", () => {
    const state = ready("shuriken.dragonBlade");
    expect(playerMoveset(state).key, "始める前は手裏剣").toBe("shuriken");
    expect(tryUltimate(state)).toBe(true);
    const katana = MOVESETS.katana;
    const moveset = playerMoveset(state);
    expect(moveset.key, "刀の絵").toBe("katana");
    expect(moveset.steps.length, "左は刀の段").toBe(katana.steps.length);
    expect(moveset.steps2.length, "右も刀の段").toBe(katana.steps2.length);
    expect(moveset.chainAdvance, "交互の連撃でなく普通の連撃").toBeUndefined();
    expect(moveset.dashAttack?.reach, "ダッシュ攻撃も刀（絵と動きを揃える）").toBe(katana.dashAttack?.reach);
    expect(moveset.dashAttack?.passThrough, "抜け斬りではない").toBe(katana.dashAttack?.passThrough);
    expect(moveset.steps.every((s) => s.cast === undefined), "左は投げず斬る").toBe(true);

    // 発動のヒットストップが明けてから、左を押すと投げずに斬る（敵に当たり、気力が戻る）
    runUntil(state, () => state.hitstop <= 0);
    const e = tough(placeEnemy(state, "boar", 14));
    state.player.mana = 0;
    press(state, "primary");
    runUntil(state, () => state.player.attack.phase === "none");
    expect(playerShots(state), "手裏剣は出ない").toHaveLength(0);
    expect(e.hp, "斬った").toBeLessThan(TOUGH_HP);
    expect(state.player.mana, "斬りで気力が戻る").toBeGreaterThan(0);

    endUltimate(state, "manual");
    expect(playerMoveset(state).key, "終わったら手裏剣").toBe("shuriken");
  });

  it("龍刃が刀の 4 段目の途中で終わっても、すぐ手裏剣の 1 段目から投げられる", () => {
    const state = ready("shuriken.dragonBlade");
    expect(tryUltimate(state)).toBe(true);
    runUntil(state, () => state.hitstop <= 0);
    const a = state.player.attack;
    const katanaSteps = MOVESETS.katana.steps.length;
    expect(katanaSteps, "刀は手裏剣より段が多い").toBeGreaterThan(STAR_STEPS);
    press(state, "primary");
    for (let i = 1; i < katanaSteps; i++) chain(state, "primary");
    expect(a.step, "刀の最後の段を振っている").toBe(katanaSteps - 1);
    endUltimate(state, "manual");
    expect(a.step, "連撃の段は頭へ戻る").toBe(0);
    press(state, "primary");
    expect(a.phase, "押した次のステップで振り始める").not.toBe("none");
    expect(a.step, "手裏剣の 1 段目").toBe(0);
  });
});

describe("ダッシュ: 再使用は倍、倒すとすぐ使える", () => {
  it("手裏剣を持つ間はダッシュの再使用時間が倍になる", () => {
    const star = arena(5, { moveset: "shuriken" });
    const sword = arena(5, { moveset: "sword" });
    expect(STAR.dashCooldownMul, "倍").toBe(2);
    expect(dashCooldownTime(star.stats)).toBeCloseTo(dashCooldownTime(sword.stats) * 2, 6);
  });

  it("敵を倒すとダッシュの回数がすべて戻る（他の武器種では戻らない）", () => {
    for (const moveset of ["shuriken", "sword"] as const) {
      const state = arena(5, { moveset });
      const e = placeEnemy(state, "boar", 30);
      state.player.dashChargesLeft = 0;
      state.player.dashCooldown = dashCooldownTime(state.stats);
      expect(damageEnemy(state, e, e.hp + 1, { x: 1, y: 0 }, 0), `${moveset} 倒した`).toBe(true);
      // 倒した瞬間のヒットストップが明けてから出来事が流れる。戻りの秒（倍）より十分短い間だけ進める
      for (let i = 0; i < 30; i++) step(state, withInput({}), FIXED_DT);
      expect(30 * FIXED_DT, "自然に戻るより短い").toBeLessThan(dashCooldownTime(state.stats));
      const left = state.player.dashChargesLeft;
      if (moveset === "shuriken") expect(left, "全部戻る").toBe(state.stats.dashCharges);
      else expect(left, "剣は戻らない").toBe(0);
    }
  });
});
