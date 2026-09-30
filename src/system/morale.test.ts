import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { FORM, PARRY, WEAPON } from "../data/tuning";
import { MOVESETS, meleeChargeOf } from "../data/weapons";
import { damagePlayer, rollOutgoing } from "./combat";
import { gainMorale, moraleGauge, moraleMax } from "./morale";
import { applyStats, currentMeleeStep, meleeStep, playerMoveset, updatePlayer } from "./player";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 戦意（docs/ideas/weapon-forms-impl.md 3-2 / 3-4。system/morale.ts）。5a の 4 型（剣・連刃・重打・長銃）で
 * 「溜まる → 充溢 → 放出で倍率 → 0」を、実際の入力（updatePlayer）と状態で確かめる
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const HIT = 10;
/** 振りを待つ上限のステップ */
const SETTLE_STEPS = 120;
const EPS = 1e-6;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

/** プレイヤーだけを n ステップ進め、その間に積まれたイベントを返す（イベントは step の照合で消えるので自分で集める） */
function run(state: GameState, input: Partial<FrameInput>, n = 1): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    updatePlayer(state, withInput(input), FIXED_DT);
    state.time += FIXED_DT;
    out.push(...state.events);
    state.events.length = 0;
  }
  return out;
}

function kinds(events: readonly GameEvent[], kind: GameEvent["kind"]): GameEvent[] {
  return events.filter((e) => e.kind === kind);
}

/** 右レーンの index 段目を次に押せるようにする（段カウンタは窓が切れると 0 に戻るので窓も開ける） */
function readyLaneStep(state: GameState, index: number): void {
  const a = state.player.attack;
  a.step = index;
  a.inputTimer = WEAPON.chainWindow;
}

/** 共通の受け流しの窓を開けて被弾を受け流す */
function parryOnce(state: GameState, attacker: Enemy): void {
  state.player.parry.window = PARRY.windowSec;
  state.player.invulnTimer = 0;
  expect(damagePlayer(state, HIT, attacker.body.pos, attacker), "受け流した").toBe("parried");
}

/** 振りが終わる（待機に戻る）まで進める */
function settle(state: GameState): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) out.push(...run(state, {}));
  return out;
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

describe("戦意: 剣（応報）", () => {
  it("受け流し 3 回で充溢し、返し斬りで応報をすべて使って届く距離と多段が伸びる", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    for (let i = 0; i < 3; i++) parryOnce(state, e);
    expect(state.player.morale.value, "受け流し 3 回で応報 3").toBe(FORM.blade.max);
    expect(kinds(run(state, {}), "onBrim"), "満ちた瞬間に充溢").toHaveLength(1);
    expect(kinds(run(state, {}), "onBrim"), "満ちたままでは充溢を繰り返さない").toHaveLength(0);

    readyLaneStep(state, 1);
    const events = run(state, { shootHeld: true });
    const release = kinds(events, "onRelease");
    expect(release, "返し斬りの振り始めで放出").toHaveLength(1);
    expect(release[0]?.amount, "応報をすべて使う").toBe(FORM.blade.max);
    expect(state.player.morale.value, "使い切って 0").toBe(0);

    const plain = meleeStep(state.stats, 1, false, 0, -1, playerMoveset(state), "secondary");
    const now = currentMeleeStep(state);
    if (!plain || !now) throw new Error("返し斬りの段が無い");
    const units = FORM.blade.max;
    expect(now.release, "放出の振り").toBe(true);
    expect(now.reach / plain.reach, "届く距離").toBeCloseTo(1 + FORM.blade.perUnit.reachMul * units);
    expect(now.hits - plain.hits, "多段の追加").toBe(Math.floor(FORM.blade.perUnit.hitsAdd * units));
  });

  it("返しが無ければ返し斬りはただの段（放出しない）", () => {
    const state = arena(5);
    readyLaneStep(state, 1);
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease"), "放出しない").toHaveLength(0);
    expect(currentMeleeStep(state)?.release, "放出の振りでない").toBeUndefined();
  });

  it("連刃は受け流しで戦意が溜まらない（応手の一覧に無い出来事）", () => {
    const state = arena(5, { moveset: "twinBlades" });
    const e = tough(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    parryOnce(state, e);
    expect(state.player.morale.value).toBe(0);
  });
});

describe("戦意: 連刃（熱）", () => {
  it("通常の振りの命中で熱が溜まる", () => {
    const state = arena(5, { moveset: "twinBlades" });
    tough(placeEnemy(state, "slime", 12));
    run(state, { attackPressed: true });
    settle(state);
    expect(state.player.morale.value, "1 段目の命中で熱").toBeGreaterThanOrEqual(FORM.flurry.gain.meleeHit);
    expect(state.player.morale.value % FORM.flurry.gain.meleeHit, "命中 1 回ずつの熱").toBe(0);
  });

  it("手を止めて冷めの秒を過ぎると冷める", () => {
    const state = arena(5, { moveset: "twinBlades" });
    gainMorale(state, "meleeHit");
    const heat = state.player.morale.value;
    run(state, {}, stepsFor(FORM.flurry.decayDelaySec) - 1);
    expect(state.player.morale.value, "冷めの秒までは減らない").toBe(heat);
    run(state, {}, stepsFor(1));
    expect(state.player.morale.value, "過ぎたら冷める").toBeLessThan(heat);
  });

  it("熱 100 で右の最終段（乱舞の段）が威力 ×2.5 の放出になり、熱は 0 に戻る", () => {
    const state = arena(5, { moveset: "twinBlades" });
    state.player.morale.value = FORM.flurry.max;
    const last = MOVESETS.twinBlades.steps2.length - 1;
    readyLaneStep(state, last);
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")[0]?.amount, "熱をすべて使う").toBe(FORM.flurry.max);
    const plain = meleeStep(state.stats, last, false, 0, -1, playerMoveset(state), "secondary");
    const now = currentMeleeStep(state);
    if (!plain || !now) throw new Error("右の最終段が無い");
    expect(now.damage / plain.damage, "威力の倍率").toBeCloseTo(1 + FORM.flurry.perUnit.damageMul * FORM.flurry.max);
    expect(state.player.morale.value).toBe(0);
  });
});

describe("戦意: 重打（溜め）", () => {
  it("溜めの段が戦意になり、最大段で充溢、離した最大段の溜め攻撃が放出と終撃を出す", () => {
    const state = arena(5, { moveset: "greatsword" });
    const e = tough(placeEnemy(state, "slime", 16));
    const levels = meleeChargeOf(MOVESETS.greatsword)?.levels ?? [];
    const last = levels[levels.length - 1];
    if (!last) throw new Error("大剣は溜めを持つ");
    expect(moraleMax(state), "上限は溜めの段数").toBe(levels.length);
    const charged = run(state, { attackPressed: true, attackHeld: true }).concat(run(state, { attackHeld: true }, stepsFor(last.time) + 2));
    expect(state.player.morale.value, "溜めの段がそのまま戦意").toBe(levels.length);
    expect(kinds(charged, "onBrim"), "最大段で充溢").toHaveLength(1);

    const swing = run(state, {}).concat(settle(state));
    expect(kinds(swing, "onRelease")[0]?.amount, "放出の量は溜めの段").toBe(levels.length);
    const finisher = kinds(swing, "onFinisher");
    expect(finisher.length, "終撃").toBeGreaterThan(0);
    expect(finisher[0]?.targetId).toBe(e.id);
    expect(finisher[0]?.tag, "放出の一撃").toBe("release");
    expect(state.player.morale.value, "溜め終わったら 0（溜め込まない）").toBe(0);
  });

  it("溜め中は被ダメが軽く押されず、耐えた被弾が応手になる", () => {
    const state = arena(5, { moveset: "greatsword" });
    const e = tough(placeEnemy(state, "boar", 30));
    const before = state.player.hp;
    damagePlayer(state, HIT, e.body.pos, e);
    const plainTaken = before - state.player.hp;
    state.player.invulnTimer = 0;
    state.player.knock = { x: 0, y: 0 };
    run(state, { attackPressed: true, attackHeld: true });
    expect(state.player.attack.charging, "溜め中").toBe(true);
    const hp = state.player.hp;
    state.events.length = 0;
    damagePlayer(state, HIT, e.body.pos, e);
    expect(hp - state.player.hp, "溜め中の被ダメは軽い").toBeLessThan(plainTaken);
    expect(state.player.knock, "押されない").toEqual({ x: 0, y: 0 });
    expect(state.events.filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag), "耐えた応手").toEqual(["chargeEndure"]);
  });

  it("導出の型は出来事で戦意を溜め込まない", () => {
    const state = arena(5, { moveset: "greatsword" });
    gainMorale(state, "riposte");
    gainMorale(state, "meleeHit");
    expect(state.player.morale.value).toBe(0);
  });
});

describe("戦意: 長銃（狙い）", () => {
  const rifle = { moveset: "longarm" as const, bullet: "rifle" };

  it("止まっていると狙いが溜まって満ち、動くと減って構えが解ける", () => {
    const state = arena(5, rifle);
    const fill = stepsFor(FORM.rifle.max / FORM.rifle.gain.still) + 1;
    const events = run(state, {}, fill);
    expect(state.player.morale.value, "満ちた").toBe(FORM.rifle.max);
    expect(state.player.morale.primed, "次の 1 発が放出").toBe(true);
    expect(kinds(events, "onBrim"), "充溢").toHaveLength(1);
    run(state, { move: { x: 1, y: 0 } }, stepsFor(0.25));
    expect(state.player.morale.value, "動くと減る").toBeLessThan(FORM.rifle.max);
    expect(state.player.morale.primed, "満ちていなければ構えない").toBe(false);
  });

  it("満ちた 1 発は威力と貫通が増え、必ず会心で終撃になり、狙いは 0 に戻る", () => {
    const state = arena(5, rifle);
    run(state, { attackHeld: true });
    const normal = playerShots(state)[0];
    if (!normal) throw new Error("普通の 1 発が出ない");
    state.projectiles.length = 0;
    state.player.shootCooldown = 0;
    run(state, {}, stepsFor(FORM.rifle.max / FORM.rifle.gain.still) + 1);
    expect(state.player.morale.primed).toBe(true);
    const events = run(state, { attackHeld: true });
    const shot = playerShots(state)[0];
    if (!shot) throw new Error("満ちた 1 発が出ない");
    const units = FORM.rifle.max;
    expect(kinds(events, "onRelease")[0]?.amount, "狙いをすべて使う").toBe(units);
    expect(shot.damage / normal.damage, "威力").toBeCloseTo(1 + FORM.rifle.perUnit.damageMul * units);
    expect(shot.pierceLeft - normal.pierceLeft, "貫通").toBe(Math.floor(FORM.rifle.perUnit.pierceAdd * units + EPS));
    expect(shot.release, "放出の弾（終撃・会心）").toEqual({ finisher: true, crit: true });
    expect(normal.release, "普通の弾は放出でない").toBeUndefined();
    expect(state.player.morale.value).toBe(0);
  });

  it("放出の弾の会心は会心率 0 でも必ず出る", () => {
    const state = arena(5, rifle);
    const e = placeEnemy(state, "slime", 40);
    expect(rollOutgoing(state, e, 10, "ranged").crit, "会心率 0").toBe(false);
    expect(rollOutgoing(state, e, 10, "ranged", { forceCrit: true, release: true }).crit, "会心を強制").toBe(true);
  });
});

describe("戦意の共通", () => {
  it("骨の型（5b で埋める）は出来事で溜まらず、HUD には出さない", () => {
    const state = arena(5, { moveset: "axe" });
    gainMorale(state, "meleeHit");
    gainMorale(state, "riposte");
    expect(state.player.morale.value).toBe(0);
    expect(moraleGauge(state).active).toBe(false);
  });

  it("上限の加算と溜まりやすさの倍率が効く", () => {
    const state = arena(5, { moveset: "twinBlades", moraleMaxAdd: 20, moraleGainMul: 2 });
    expect(moraleMax(state)).toBe(FORM.flurry.max + 20);
    gainMorale(state, "meleeHit");
    expect(state.player.morale.value).toBe(FORM.flurry.gain.meleeHit * 2);
  });

  it("武器種を持ち替えると戦意は捨てられる", () => {
    const state = arena(5, { moveset: "twinBlades" });
    state.player.morale.value = 50;
    applyStats(state, { ...state.stats, moveset: "sword" });
    expect(state.player.morale.value).toBe(0);
  });

  it("HUD の材料は型のゲージの名・量・上限・放出できるか", () => {
    const state = arena(5);
    expect(moraleGauge(state)).toEqual({ label: "応報", value: 0, max: FORM.blade.max, ready: false, active: true });
    state.player.morale.value = FORM.blade.releaseMin;
    expect(moraleGauge(state).ready).toBe(true);
  });
});
