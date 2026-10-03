import { describe, expect, it } from "vitest";
import { applyStatus, statusStacks } from "./statusEffects";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { beginSwingMorale } from "./morale";
import { releaseTerrainRadiusBonus } from "./morale";
import { currentShot, emitVolley } from "./player";
import { emitArtVolley } from "./weaponArts";
import type { GameEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { FORM, PARRY, WEAPON } from "../data/tuning";
import { FORMS, formOf } from "../data/weaponForms";
import { MOVESETS, meleeChargeOf } from "../data/weapons";
import { damagePlayer, rollOutgoing } from "./combat";
import { gainMorale, moraleGauge, moraleMax, placedShotCount } from "./morale";
import { startReload } from "./magazine";
import { applyStats, currentMeleeStep, meleeStep, playerMoveset, updatePlayer } from "./player";
import { detonateOwnMines } from "./weaponArts";
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
    // 溜めでない器の放出はリロード後の 1 発目だけ（関門は system/gunMorale.test.ts）。込め直しながら狙いを満たす
    startReload(state, 0);
    run(state, {}, stepsFor(FORM.rifle.max / FORM.rifle.gain.still) + 1);
    expect(state.player.magazine.fresh, "込め直した").toBe(true);
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
  it("書・鈴（5d）はスキル・設置物の命中で溜まり、右 1 段目が放出（仕組みは system/tomeBell.test.ts）", () => {
    expect(FORMS.tome.morale.gain.map((g) => g.kind), "書").toEqual(["skillHit"]);
    expect(FORMS.bell.morale.gain.map((g) => g.kind), "鈴").toEqual(["minionHit"]);
    expect(FORMS.tome.morale.release, "書の放出").toEqual({ kind: "laneStep", keys: ["freeCast"] });
    expect(FORMS.bell.morale.release, "鈴の放出").toEqual({ kind: "laneStep", keys: ["toll"] });
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

describe("戦意: 短銃（応手）", () => {
  const pistol = { moveset: "sidearm" as const, bullet: "pistol" };

  it("応手の見切りは零距離（zeroDistance）の敵だけ", () => {
    const near = arena(5, pistol);
    const eNear = tough(placeEnemy(near, "boar", FORM.pistol.zeroDistance - 5));
    near.player.dashTimer = 0.1;
    near.player.invulnTimer = 0.1;
    damagePlayer(near, HIT, eNear.body.pos, eNear);
    expect(near.events.filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag), "零距離は応手").toEqual(["justDodge"]);

    const far = arena(5, pistol);
    const eFar = tough(placeEnemy(far, "boar", FORM.pistol.zeroDistance + 40));
    far.player.dashTimer = 0.1;
    far.player.invulnTimer = 0.1;
    damagePlayer(far, HIT, eFar.body.pos, eFar);
    expect(far.events.filter((ev) => ev.kind === "onJustDodge"), "見切りそのものは距離によらず出る").toHaveLength(1);
    expect(far.events.filter((ev) => ev.kind === "onRiposte"), "遠い見切りは応手にならない").toHaveLength(0);
  });
});

describe("戦意: 仕掛け（置いた弾と一斉起爆）", () => {
  const trapper = { moveset: "trapper" as const, bullet: "mineLauncher" };
  const DETONATE_LIFE_MAX = 0.001;
  const DETONATE_STEP = MOVESETS.trapper.steps2.findIndex((s) => s.key === "detonate");

  function placeMines(state: GameState, n: number): void {
    for (let i = 0; i < n; i++) {
      state.player.shootCooldown = 0;
      run(state, { attackHeld: true });
    }
  }

  it("床の自分の設置弾の数が置いた弾になり、溜め込まずに数え直す", () => {
    const state = arena(5, trapper);
    placeMines(state, 2);
    run(state, {});
    const placed = placedShotCount(state);
    expect(placed, "置いた弾が数えられる").toBeGreaterThanOrEqual(2);
    expect(state.player.morale.value, "導出の値").toBe(Math.min(placed, FORM.artillery.max));
    state.projectiles.length = 0;
    run(state, {});
    expect(state.player.morale.value, "無くなれば 0").toBe(0);
  });

  it("起爆の段は置いた弾の数だけ放出になり、威力が乗って終撃になる。detonateOwnMines は起爆した数を返す", () => {
    const state = arena(5, trapper);
    const e = tough(placeEnemy(state, "slime", 8));
    placeMines(state, 2);
    run(state, {});
    const placed = Math.min(placedShotCount(state), FORM.artillery.max);
    expect(DETONATE_STEP, "仕掛けの右に起爆の段").toBeGreaterThanOrEqual(0);
    readyLaneStep(state, DETONATE_STEP);
    const start = run(state, { shootHeld: true });
    const plain = meleeStep(state.stats, DETONATE_STEP, false, 0, -1, playerMoveset(state), "secondary");
    const now = currentMeleeStep(state);
    if (!plain || !now) throw new Error("起爆の段が無い");
    expect(now.damage / plain.damage, "威力").toBeCloseTo(1 + FORM.artillery.perUnit.damageMul * placed);
    const events = start.concat(settle(state));
    const release = kinds(events, "onRelease");
    expect(release, "起爆の段の振り始めで放出").toHaveLength(1);
    expect(release[0]?.amount, "起爆した弾の数が放出の量").toBe(placed);
    const finisher = kinds(events, "onFinisher").filter((ev) => ev.targetId === e.id);
    expect(finisher.map((ev) => ev.tag), "放出の一撃は終撃").toContain("release");
    const fuses = state.projectiles.filter((pr) => pr.owner === "player").map((pr) => pr.life);
    expect(fuses.every((life) => life < DETONATE_LIFE_MAX), "置いた弾の信管は尽きかけ（次のステップで炸裂）").toBe(true);

    const again = arena(5, trapper);
    expect(detonateOwnMines(again), "床に弾が無ければ 0").toBe(0);
    placeMines(again, 2);
    expect(detonateOwnMines(again), "起爆した数").toBe(placedShotCount(again));
  });

  it("置いた弾が無ければ起爆の段はただの段（放出しない）", () => {
    const state = arena(5, trapper);
    readyLaneStep(state, DETONATE_STEP);
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")).toHaveLength(0);
    expect(currentMeleeStep(state)?.release).toBeUndefined();
  });

  it("仕掛けだけの型で、放出の段は起爆だけ（砲は装薬、擲弾は擲弾の型。system/gunMorale.test.ts）", () => {
    const keys = FORMS.artillery.morale.release.kind === "laneStep" ? FORMS.artillery.morale.release.keys : [];
    expect([...keys], "仕掛けの放出の段").toEqual(["detonate"]);
  });
});

// ---------------------------------------------------------------------------
// 5b-D2: 盾・扇・杖・投具
// ---------------------------------------------------------------------------

/** 右を押し続けて構える（盾・扇の構え） */
function raiseGuard(state: GameState): void {
  run(state, { shootHeld: true });
  expect(state.player.art.holding, "構えている").toBe(true);
}

/** 構えの最中の被弾（前から）。無敵は毎回戻す */
function hitGuard(state: GameState, attacker: Enemy): void {
  state.player.invulnTimer = 0;
  damagePlayer(state, HIT, attacker.body.pos, attacker);
}

/** 今の振りの段の、放出の倍率を掛けない値（放出の倍率の比較用） */
function plainStepOf(state: GameState): ReturnType<typeof meleeStep> {
  const a = state.player.attack;
  return meleeStep(state.stats, a.step, false, 0, a.branch, playerMoveset(state), a.lane);
}

describe("戦意: 盾（受け溜め）", () => {
  const shield = { moveset: "shield" as const };

  it("構えで前から受けた量が受け溜めになる。応手はコミットした攻撃を受けたときだけ", () => {
    const state = arena(5, shield);
    const e = tough(placeEnemy(state, "boar", 14));
    raiseGuard(state);
    e.phase = "windup";
    state.events.length = 0;
    hitGuard(state, e);
    expect(state.player.morale.value, "受けた量がそのまま受け溜め").toBe(HIT * FORM.bulwark.gain.guardBlock);
    expect(kinds(state.events, "onRiposte"), "確定していない予備動作は応手にならない").toHaveLength(0);

    e.phase = "strike";
    hitGuard(state, e);
    expect(state.player.morale.value, "もう 1 回受けて溜まる").toBe(HIT * 2 * FORM.bulwark.gain.guardBlock);
    const riposte = kinds(state.events, "onRiposte");
    expect(riposte, "コミットした攻撃を受けたら応手").toHaveLength(1);
    expect(riposte[0]?.tag).toBe("guardBlock");
  });

  it("後ろから受けた被弾と構えていない被弾は受け溜めにならない", () => {
    const state = arena(5, shield);
    const behind = tough(placeEnemy(state, "boar", -14));
    behind.phase = "strike";
    raiseGuard(state);
    hitGuard(state, behind);
    expect(state.player.morale.value, "後ろからは受けない").toBe(0);
    run(state, {});
    expect(state.player.art.holding, "構えを解いた").toBe(false);
    const front = tough(placeEnemy(state, "boar", 14));
    front.phase = "strike";
    hitGuard(state, front);
    expect(state.player.morale.value, "構えていなければ溜まらない").toBe(0);
  });

  it("構えを離した盾押しが放出になり、受け溜めをすべて使って威力が伸びる", () => {
    const state = arena(5, shield);
    raiseGuard(state);
    state.player.morale.value = 50;
    const events = run(state, {});
    const release = kinds(events, "onRelease");
    expect(release, "離した振りの開始で放出").toHaveLength(1);
    expect(release[0]?.amount, "受け溜めをすべて使う").toBe(50);
    expect(state.player.morale.value, "使い切って 0").toBe(0);
    const now = currentMeleeStep(state);
    const plain = plainStepOf(state);
    if (!now || !plain) throw new Error("盾押しの振りが無い");
    expect(now.release, "放出の振り").toBe(true);
    expect(now.damage / plain.damage, "威力").toBeCloseTo(1 + FORM.bulwark.perUnit.damageMul * 50);
    expect(now.poise / plain.poise, "怯み値").toBeCloseTo(1 + FORM.bulwark.perUnit.poiseMul * 50);
  });

  it("受け溜めが放出の最低に届かなければ盾押しはただの振り", () => {
    const state = arena(5, shield);
    raiseGuard(state);
    state.player.morale.value = FORM.bulwark.releaseMin - 1;
    const events = run(state, {});
    expect(kinds(events, "onRelease"), "放出しない").toHaveLength(0);
    expect(state.player.morale.value, "消費しない").toBe(FORM.bulwark.releaseMin - 1);
    expect(currentMeleeStep(state)?.release, "放出の振りでない").toBeUndefined();
  });
});

describe("戦意: 扇（風）", () => {
  const fan = { moveset: "fan" as const };

  it("払いの命中で風が溜まる", () => {
    const state = arena(5, fan);
    tough(placeEnemy(state, "slime", 12));
    run(state, { attackPressed: true });
    settle(state);
    expect(state.player.morale.value, "命中 1 回ぶんの風").toBe(FORM.warfan.gain.meleeHit);
  });

  it("払いで敵弾を消すと風が溜まり、応手（bulletCut）になる", () => {
    const state = arena(5, fan);
    const last = MOVESETS.fan.steps.length - 1;
    expect(MOVESETS.fan.steps[last]?.cutsBullets, "最終段は弾を消す").toBe(true);
    state.player.attack.step = last;
    state.player.attack.inputTimer = WEAPON.chainWindow;
    const at = state.player.body.pos;
    const bullet: Projectile = {
      id: 9001,
      owner: "enemy",
      pos: { x: at.x + 12, y: at.y },
      vel: { x: 0, y: 0 },
      radius: 3,
      damage: 5,
      life: 5,
      color: "#ff0000",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    };
    state.projectiles.push(bullet);
    run(state, { attackPressed: true });
    const events = settle(state);
    expect(bullet.life, "敵弾が消えた").toBe(0);
    expect(state.player.morale.value, "消した弾ぶんの風").toBe(FORM.warfan.gain.bulletCut);
    expect(kinds(events, "onRiposte").map((ev) => ev.tag), "応手").toEqual(["bulletCut"]);
  });

  it("構えを離した突風が放出になり、ノックバックと地形を広げる半径が風の量で伸びる", () => {
    const state = arena(5, fan);
    raiseGuard(state);
    state.player.morale.value = FORM.warfan.max;
    const events = run(state, {});
    expect(kinds(events, "onRelease")[0]?.amount, "風をすべて使う").toBe(FORM.warfan.max);
    expect(state.player.morale.value).toBe(0);
    const now = currentMeleeStep(state);
    const plain = plainStepOf(state);
    if (!now || !plain) throw new Error("突風の振りが無い");
    expect(now.knockback / plain.knockback, "ノックバック").toBeCloseTo(1 + FORM.warfan.perUnit.knockbackMul * FORM.warfan.max);
    expect(releaseTerrainRadiusBonus(state), "突風の間は地形を広げる半径が伸びる").toBeCloseTo(FORM.warfan.spreadRadiusPerUnit * FORM.warfan.max);
    settle(state);
    expect(releaseTerrainRadiusBonus(state), "振り終わったら伸びない").toBe(0);
  });

  it("風は手を止めて冷めの秒を過ぎると凪ぐ", () => {
    const state = arena(5, fan);
    gainMorale(state, "meleeHit");
    const wind = state.player.morale.value;
    run(state, {}, stepsFor(FORM.warfan.decayDelaySec) - 1);
    expect(state.player.morale.value, "冷めの秒までは減らない").toBe(wind);
    run(state, {}, stepsFor(1));
    expect(state.player.morale.value, "過ぎたら減る").toBeLessThan(wind);
  });
});

describe("戦意: 杖（術式）", () => {
  const wand = { moveset: "wand" as const };

  it("連撃の入力数が術式になり、出来事では溜め込まない", () => {
    const state = arena(5, wand);
    run(state, { attackPressed: true });
    settle(state);
    run(state, {});
    expect(state.player.morale.value, "1 手ぶん").toBe(1);
    gainMorale(state, "meleeHit");
    gainMorale(state, "riposte");
    expect(state.player.morale.value, "導出の型は溜め込まない").toBe(1);
    run(state, {}, stepsFor(WEAPON.chainWindow) + 1);
    expect(state.player.morale.value, "連撃が切れたら 0").toBe(0);
  });

  it("3 手の派生が放出になり、魔弾が術式の数だけ強い放出の弾（終撃）になる", () => {
    const state = arena(5, wand);
    run(state, { attackPressed: true });
    settle(state);
    run(state, { attackPressed: true });
    settle(state);
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")[0]?.amount, "3 手ぶんの術式").toBe(FORM.rod.max);
    const branch = MOVESETS.wand.branches[state.player.attack.branch];
    const throwDef = branch?.step.cast?.throw;
    if (!throwDef) throw new Error("杖の派生は魔弾を撃つ");
    const after = events.concat(settle(state));
    expect(kinds(after, "onRelease"), "放出は 1 回").toHaveLength(1);
    const shot = playerShots(state).find((pr) => pr.release !== undefined);
    if (!shot) throw new Error("放出の魔弾が出ない");
    expect(shot.release, "放出の弾（終撃）").toEqual({ finisher: true, crit: false });

    const plainState = arena(5, wand);
    emitArtVolley(plainState, throwDef);
    const plain = playerShots(plainState)[0];
    if (!plain) throw new Error("普通の魔弾が出ない");
    expect(shot.damage / plain.damage, "威力").toBeCloseTo(1 + FORM.rod.perUnit.damageMul * FORM.rod.max);
  });

  it("2 手では派生にならず、放出しない", () => {
    const state = arena(5, wand);
    run(state, { attackPressed: true });
    settle(state);
    const events = run(state, { attackPressed: true });
    expect(kinds(events, "onRelease"), "普通の詠唱は放出でない").toHaveLength(0);
    expect(playerShots(state).some((pr) => pr.release !== undefined)).toBe(false);
  });
});

/** 飛んでいる自分の弾を n 発、手元から離して出す（左の射撃と同じレーン） */
function throwShots(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) emitVolley(state, currentShot(state.stats), 0, undefined, { lane: "primary" });
  for (const pr of playerShots(state)) pr.pos.x += 60;
}

describe("戦意: 投擲物の型（骨。溜まる出来事は段 6 で入る。クナイ・手裏剣は入った: system/kunai.test.ts・system/shuriken.test.ts）", () => {
  it("戦輪の型は溜まる出来事を持たず、自分の弾が飛んでいても戦意は 0", () => {
    for (const moveset of ["ringBlades"] as const) {
      const state = arena(5, { moveset });
      expect(formOf(MOVESETS[moveset]).morale.gain, `${moveset} の溜まる出来事`).toEqual([]);
      throwShots(state, 2);
      run(state, {});
      expect(state.player.morale.value, `${moveset} の戦意`).toBe(0);
    }
  });

  it("クナイの型（苦無）は叩き込みで溜まり、自分の弾が飛んでいるだけでは戦意は 0", () => {
    const state = arena(5, { moveset: "kunai" });
    expect(formOf(MOVESETS.kunai).morale.gain.map((g) => g.kind)).toEqual(["pinDriven"]);
    throwShots(state, 2);
    run(state, {});
    expect(state.player.morale.value).toBe(0);
  });

  it("戦輪の型（投具）の放出の段は強化投げ", () => {
    expect(formOf(MOVESETS.ringBlades).morale.release).toEqual({ kind: "laneStep", keys: ["ringHurl"] });
  });
});

// ---------------------------------------------------------------------------
// 5b-D1: 刃斧（傷）・長柄（穂先）・鎖（繋ぎ）。印の出し入れは system/formMarks.ts
// ---------------------------------------------------------------------------

/** 敵に傷を stacks 付ける */
function wound(state: GameState, e: Enemy, stacks: number): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind: "wound", stacks, duration: 6, potency: 0 }, "player");
}

/** プレイヤーの前に動かない敵弾を置く */
function placeEnemyShot(state: GameState, dx: number): Projectile {
  const p = state.player.body.pos;
  const shot: Projectile = {
    id: 9101,
    owner: "enemy",
    pos: { x: p.x + dx, y: p.y },
    vel: { x: 0, y: 0 },
    radius: 3,
    damage: 5,
    life: 5,
    color: "#ff0000",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
  };
  state.projectiles.push(shot);
  return shot;
}

describe("戦意: 刃斧（傷）", () => {
  it("左の段の命中で傷が 1 つ付き、近くの敵の傷の最大スタックが戦意になる（導出で溜め込まない）", () => {
    const state = arena(5, { moveset: "axe" });
    const e = tough(placeEnemy(state, "slime", 14));
    run(state, { attackPressed: true });
    settle(state);
    expect(statusStacks(e.status, "wound"), "1 段目で傷 1").toBe(1);
    expect(state.player.morale.value, "近くの敵の傷").toBe(1);
    gainMorale(state, "meleeHit");
    expect(state.player.morale.value, "出来事では溜まらない").toBe(1);
  });

  it("遠くの敵の傷は数えない", () => {
    const state = arena(5, { moveset: "axe" });
    wound(state, tough(placeEnemy(state, "slime", FORM.hewer.nearPx + 40)), 3);
    run(state, {});
    expect(state.player.morale.value).toBe(0);
  });

  it("傷 5 の敵を裂くと傷の数だけ強く当たり、傷はすべて消える。傷が無ければ裂きはただの段", () => {
    const rendOn = (stacks: number): { taken: number; left: number; release: number | undefined } => {
      const state = arena(5, { moveset: "axe" });
      const e = tough(placeEnemy(state, "slime", 12));
      if (stacks > 0) wound(state, e, stacks);
      run(state, {});
      readyLaneStep(state, MOVESETS.axe.steps2.length - 1);
      const events = run(state, { shootHeld: true }).concat(settle(state));
      return { taken: TOUGH_HP - e.hp, left: statusStacks(e.status, "wound"), release: kinds(events, "onRelease")[0]?.amount };
    };
    expect(MOVESETS.axe.steps2[MOVESETS.axe.steps2.length - 1]?.key, "右の最終段は裂き").toBe("rend");
    const plain = rendOn(0);
    const rend = rendOn(FORM.hewer.max);
    expect(plain.release, "傷が無ければ放出しない").toBeUndefined();
    expect(rend.release, "放出の量は近くの傷の最大スタック").toBe(FORM.hewer.max);
    expect(rend.taken / plain.taken, "傷 1 つあたりの上乗せ").toBeCloseTo(1 + FORM.hewer.rend.damageMulPerStack * FORM.hewer.max, 1);
    expect(rend.left, "裂いた傷は消える").toBe(0);
  });
});

describe("戦意: 長柄（穂先）", () => {
  it("突きの先端（穂先）の命中で穂先が溜まり、根元の命中では溜まらない", () => {
    const reach = MOVESETS.spear.steps[0]?.reach ?? 0;
    const tipState = arena(5, { moveset: "spear" });
    tough(placeEnemy(tipState, "slime", reach));
    run(tipState, { attackPressed: true });
    settle(tipState);
    expect(tipState.player.morale.value, "穂先の命中").toBe(FORM.polearm.gain.tipHit);
    const rootState = arena(5, { moveset: "spear" });
    const root = tough(placeEnemy(rootState, "slime", 10));
    run(rootState, { attackPressed: true });
    settle(rootState);
    expect(root.hp, "根元に当たった").toBeLessThan(TOUGH_HP);
    expect(rootState.player.morale.value, "根元では溜まらない").toBe(0);
  });

  it("棍は薙ぎの外周（棒先）の命中で戦意が溜まり、懐の命中では溜まらない", () => {
    const first = MOVESETS.staff.steps[0];
    expect(first?.shape.kind, "棍の 1 段目は薙ぎ").toBe("arc");
    expect(MOVESETS.staff.tip?.sweep, "棍は薙ぎ・回しも先端を持つ").toBe(true);
    const reach = first?.reach ?? 0;
    const tipState = arena(5, { moveset: "staff" });
    tough(placeEnemy(tipState, "slime", reach));
    run(tipState, { attackPressed: true });
    settle(tipState);
    expect(tipState.player.morale.value, "棒先の命中").toBe(FORM.polearm.gain.tipHit);
    const rootState = arena(5, { moveset: "staff" });
    const root = tough(placeEnemy(rootState, "slime", 4));
    run(rootState, { attackPressed: true });
    settle(rootState);
    expect(root.hp, "懐に当たった").toBeLessThan(TOUGH_HP);
    expect(rootState.player.morale.value, "懐では溜まらない").toBe(0);
  });

  it("棍の 4 段で戦意が満ち、突きの段で放てる（ゲージの名は棒先）", () => {
    const state = arena(5, { moveset: "staff" });
    expect(moraleGauge(state).label, "棍のゲージの名").toBe("棒先");
    expect(moraleGauge(arena(5, { moveset: "spear" })).label, "槍は穂先").toBe(FORMS.polearm.morale.label);
    const reach = Math.min(...MOVESETS.staff.steps.filter((s) => s.reach > 0).map((s) => s.reach));
    tough(placeEnemy(state, "slime", reach));
    for (let i = 0; i < FORM.polearm.max; i++) {
      run(state, { attackPressed: true });
      settle(state);
    }
    expect(state.player.morale.value, "連撃で満ちる").toBe(FORM.polearm.max);
  });

  it("満ちると次の突きが放出で、貫く穂先の弾を撃って終撃になり、穂先は 0 に戻る", () => {
    const state = arena(5, { moveset: "spear" });
    state.player.morale.value = FORM.polearm.max;
    const brim = run(state, {});
    expect(kinds(brim, "onBrim"), "充溢").toHaveLength(1);
    expect(state.player.morale.primed, "次の突きが放出").toBe(true);
    const events = run(state, { attackPressed: true }).concat(settle(state));
    expect(kinds(events, "onRelease")[0]?.amount, "穂先をすべて使う").toBe(FORM.polearm.max);
    const shot = playerShots(state).find((pr) => pr.pierceLeft >= FORM.polearm.cast.throw.bullet.pierceBonus);
    expect(shot, "貫く穂先の弾").toBeDefined();
    expect(shot?.release?.finisher, "放出の弾は終撃").toBe(true);
    expect(state.player.morale.value).toBe(0);
    expect(state.player.morale.primed).toBe(false);
  });

  it("満ちても放たないのは突き以外の段（棍の薙ぎ）。突きの段で放つ", () => {
    const state = arena(5, { moveset: "staff" });
    state.player.morale.value = FORM.polearm.max;
    run(state, {});
    const spec = { lane: "primary" as const, branch: -1, chargeLevel: 0, dashStrike: false };
    const thrust = MOVESETS.staff.steps.findIndex((s) => s.shape.kind === "thrust");
    const sweep = MOVESETS.staff.steps.findIndex((s) => s.shape.kind !== "thrust");
    expect(beginSwingMorale(state, MOVESETS.staff, { ...spec, step: sweep }), "薙ぎは放出しない").toBe(0);
    expect(state.player.morale.primed, "構えは残る").toBe(true);
    expect(beginSwingMorale(state, MOVESETS.staff, { ...spec, step: thrust }), "突きで放つ").toBe(FORM.polearm.max);
  });

  it("穂先を持つ突きは敵弾を払って応手（bulletCut）になる。長柄でない型の突きは払わない", () => {
    const state = arena(5, { moveset: "spear" });
    const shot = placeEnemyShot(state, 14);
    const events = run(state, { attackPressed: true }).concat(settle(state));
    expect(shot.life, "敵弾が消えた").toBeLessThanOrEqual(0);
    expect(kinds(events, "onRiposte").map((ev) => ev.tag), "応手").toContain("bulletCut");

    const whip = arena(5, { moveset: "whip" });
    const kept = placeEnemyShot(whip, 14);
    run(whip, { attackPressed: true });
    settle(whip);
    expect(kept.life, "鞭の突きは払わない").toBeGreaterThan(0);
  });
});

describe("戦意: 鎖（繋ぎ）", () => {
  it("引き寄せの段が当たった敵が繋がり、繋いだ数が戦意になる。繋ぎは秒で解ける", () => {
    const state = arena(5, { moveset: "whip" });
    const near = tough(placeEnemy(state, "slime", 30));
    const far = tough(placeEnemy(state, "slime", 50));
    const first = MOVESETS.whip.steps2[0];
    expect(first?.kind === "swing" && first.step.pull, "右 1 段目は引き寄せ").toBe(true);
    run(state, { shootHeld: true });
    settle(state);
    expect(near.linked, "近い敵").toBe(FORM.chain.linkSec);
    expect(far.linked, "遠い敵").toBe(FORM.chain.linkSec);
    expect(state.player.morale.value, "繋いだ数").toBe(2);
    for (let i = 0; i < stepsFor(FORM.chain.linkSec) + 1; i++) updateEnemies(state, FIXED_DT);
    run(state, {});
    expect(near.linked, "解けた").toBe(0);
    expect(state.player.morale.value).toBe(0);
  });

  it("引き寄せが予備動作中の敵に当たると応手（pullInterrupt）。カウンターの応手は重ねない", () => {
    const state = arena(5, { moveset: "whip" });
    const e = tough(placeEnemy(state, "slime", 30));
    e.phase = "windup";
    e.phaseTimer = 1;
    const events = run(state, { shootHeld: true }).concat(settle(state));
    expect(kinds(events, "onRiposte").map((ev) => ev.tag)).toEqual(["pullInterrupt"]);
  });

  it("一蓮托生: 繋いだ敵に当てると他の繋いだ敵それぞれにも shareRatio 分が入る。継続ダメージ・繋いでいない敵には入らない", () => {
    const state = arena(5, { moveset: "whip" });
    const hit = tough(placeEnemy(state, "slime", 30));
    const mate = tough(placeEnemy(state, "slime", 30, 20));
    const loner = tough(placeEnemy(state, "slime", 30, -20));
    hit.linked = FORM.chain.linkSec;
    mate.linked = FORM.chain.linkSec;
    const amount = 100;
    damageEnemy(state, hit, amount, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(TOUGH_HP - hit.hp, "当てた敵は満額").toBe(amount);
    expect(TOUGH_HP - mate.hp, "繋いだ敵に分ける").toBe(Math.round(amount * FORM.chain.shareRatio));
    expect(loner.hp, "繋いでいない敵").toBe(TOUGH_HP);
    const before = mate.hp;
    damageEnemy(state, hit, amount, { x: 1, y: 0 }, 0, { kind: "melee", silent: true });
    expect(mate.hp, "継続ダメージは分けない").toBe(before);
  });

  it("束ね打ちは振り始めに繋いだ敵を前へ寄せて当て、繋いだ数が放出の量で、繋ぎは解ける", () => {
    const state = arena(5, { moveset: "whip" });
    const p = state.player.body.pos;
    const side = tough(placeEnemy(state, "slime", 0, 36));
    const back = tough(placeEnemy(state, "slime", -30, 0));
    side.linked = FORM.chain.linkSec;
    back.linked = FORM.chain.linkSec;
    run(state, {});
    expect(state.player.morale.value).toBe(2);
    const last = MOVESETS.whip.steps2.length - 1;
    expect(MOVESETS.whip.steps2[last]?.key, "右の最終段は束ね打ち").toBe("slam");
    readyLaneStep(state, last);
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")[0]?.amount, "放出の量は繋いだ数").toBe(2);
    for (const e of [side, back]) {
      expect(e.body.pos.x, "前へ寄った").toBeGreaterThan(p.x);
      expect(Math.abs(e.body.pos.y - p.y), "正面").toBeLessThan(1);
      expect(e.linked, "繋ぎは解けた").toBe(0);
    }
    settle(state);
    expect(side.hp, "寄せた敵に当たる").toBeLessThan(TOUGH_HP);
    expect(back.hp, "後ろにいた敵にも当たる").toBeLessThan(TOUGH_HP);
  });
});
