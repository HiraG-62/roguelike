import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { FORM } from "../data/tuning";
import { FORMS, PISTOL_PRIMED, powderLevelOf } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import type { PlayerStats } from "../loot/types";
import { gunNumbersOf, packLevel, startReload, tickMagazine } from "./magazine";
import { noteBlast, tickMorale } from "./morale";
import { overlapsWall } from "./physics";
import { currentMeleeStep, meleeStep, playerMoveset, updatePlayer } from "./player";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 銃の型と戦意（docs/ideas/gun-bases-review.md 0-4・4-3。system/morale.ts・system/moments.ts）。
 * 短銃の早込めと強装填・長銃の関門・装薬の詰め・擲弾の炸裂を、弾倉（system/magazine.ts）と実際の入力で確かめる
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const EPS = 1e-6;
/** 込め・振りを待つ上限のステップ */
const SETTLE_STEPS = 600;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT - 1e-9);
/** 反動を測るのに後ろへ空いているべき幅と、その床を探す範囲（px） */
const OPEN_SPAN = 200;
const OPEN_SEARCH = 400;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

/** 弾倉を器に合わせて作り直した稽古場 */
function gunArena(stats: Partial<PlayerStats>): GameState {
  const state = arena(5, stats);
  tickMagazine(state, withInput({}), 0);
  return state;
}

/** プレイヤーと弾を n ステップ進め、その間に積まれたイベントを返す */
function run(state: GameState, input: Partial<FrameInput>, n = 1): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    updatePlayer(state, withInput(input), FIXED_DT);
    updateProjectiles(state, FIXED_DT);
    state.time += FIXED_DT;
    out.push(...state.events);
    state.events.length = 0;
  }
  return out;
}

function kinds(events: readonly GameEvent[], kind: GameEvent["kind"]): GameEvent[] {
  return events.filter((e) => e.kind === kind);
}

/** 再使用を空けて引き金を 1 回引き、そのとき出た自分の弾を返す */
function fire(state: GameState): { shots: Projectile[]; events: GameEvent[] } {
  state.player.shootCooldown = 0;
  const before = new Set(state.projectiles.map((pr) => pr.id));
  const events = run(state, { attackPressed: true, attackHeld: true });
  const shots = state.projectiles.filter((pr) => pr.owner === "player" && !before.has(pr.id));
  return { shots, events };
}

function firstShot(state: GameState): Projectile {
  const shot = fire(state).shots[0];
  if (!shot) throw new Error("弾が出ない");
  return shot;
}

function hand0(state: GameState): GameState["player"]["magazine"]["hands"][0] {
  return state.player.magazine.hands[0];
}

/** 込めが終わるまで進める */
function settleReload(state: GameState): void {
  for (let i = 0; i < SETTLE_STEPS && hand0(state).reloadLeft > 0; i++) run(state, {});
}

/** 弾倉を 1 発減らしてから込め直す（リロード後の 1 発目を作る） */
function reloadFresh(state: GameState): void {
  hand0(state).rounds -= 1;
  startReload(state, 0);
  settleReload(state);
}

describe("短銃（早込め）", () => {
  const sidearm = { moveset: "sidearm" as const, bullet: "pistol" };

  function quickReloadOnce(state: GameState): GameEvent[] {
    const q = gunNumbersOf("sidearm")?.quickReload;
    const sec = BULLETS.pistol?.magazine?.reloadSec;
    if (!q || sec === undefined) throw new Error("短銃の早込めが無い");
    hand0(state).rounds = 0;
    startReload(state, 0);
    run(state, {}, stepsFor(sec * q.from + q.sec / 2));
    return run(state, { reloadPressed: true });
  }

  it("早込めで +1（最大 3）、満ちるとその弾倉が強装填で全弾 1.5 倍・怯み値 1.5 倍。1 発目だけが放出の弾", () => {
    expect(FORMS.pistol.morale.gain.map((g) => g.kind), "早込めで溜まる").toEqual(["quickReload"]);
    expect(FORM.pistol.max, "上限 3").toBe(3);
    const plain = firstShot(gunArena(sidearm));
    const state = gunArena(sidearm);
    quickReloadOnce(state);
    expect(state.player.morale.value, "1 回目").toBe(1);
    quickReloadOnce(state);
    expect(state.player.morale.value, "2 回目").toBe(2);
    expect(state.player.magazine.primed, "満ちる前は強装填でない").toBe(false);
    const events = quickReloadOnce(state);
    expect(kinds(events, "onRelease")[0]?.amount, "満ちた 3 を使って放出").toBe(FORM.pistol.max);
    expect(state.player.morale.value, "使い切る").toBe(0);
    expect(state.player.magazine.primed, "その込めの弾倉が強装填").toBe(true);

    const first = firstShot(state);
    expect(first.damage / plain.damage, "1 発目の威力").toBeCloseTo(PISTOL_PRIMED.damageMul);
    expect((first.poise ?? 0) / (plain.poise ?? 1), "1 発目の怯み値").toBeCloseTo(PISTOL_PRIMED.poiseMul);
    expect(first.release, "1 発目は放出の弾（終撃）").toEqual({ finisher: true, crit: false });
    const second = firstShot(state);
    expect(second.damage / plain.damage, "2 発目も強い").toBeCloseTo(PISTOL_PRIMED.damageMul);
    expect((second.poise ?? 0) / (plain.poise ?? 1), "2 発目の怯み値").toBeCloseTo(PISTOL_PRIMED.poiseMul);
    expect(second.release, "2 発目は放出の弾でない").toBeUndefined();
  });

  it("込め直すと強装填は終わる（強いのはその弾倉だけ）", () => {
    const state = gunArena(sidearm);
    state.player.magazine.primed = true;
    hand0(state).rounds = 0;
    startReload(state, 0);
    run(state, {});
    expect(state.player.magazine.primed, "込めを始めた弾倉は新しい弾倉").toBe(false);
  });

  it("早込めの同じステップに左で撃っても、その 1 発目から強装填", () => {
    const q = gunNumbersOf("sidearm")?.quickReload;
    const sec = BULLETS.pistol?.magazine?.reloadSec;
    if (!q || sec === undefined) throw new Error("短銃の早込めが無い");
    const state = gunArena(sidearm);
    state.player.morale.value = FORM.pistol.max - 1;
    hand0(state).rounds = 0;
    startReload(state, 0);
    run(state, {}, stepsFor(sec * q.from + q.sec / 2));
    // 左の押下は早込めに使われ、押しっぱなしの射撃が同じステップで出る
    const { shots } = fire(state);
    expect(state.player.magazine.primed, "強装填").toBe(true);
    const shot = shots[0];
    if (shot) expect(shot.release, "同じステップの 1 発目も放出の弾").toEqual({ finisher: true, crit: false });
  });
});

describe("長銃（狙い）の関門", () => {
  it("溜めでない器: 満ちていてもリロード後の 1 発目でなければ放出しない", () => {
    const state = gunArena({ moveset: "longarm", bullet: "rifle" });
    state.player.morale.value = FORM.rifle.max;
    run(state, {});
    expect(firstShot(state).release, "込め終えたままの 1 発目は放出").toBeDefined();
    state.player.morale.value = FORM.rifle.max;
    run(state, {});
    expect(state.player.morale.primed, "満ちて構えている").toBe(true);
    expect(firstShot(state).release, "リロード後の 1 発目でない").toBeUndefined();
    expect(state.player.morale.value, "戦意は残る").toBe(FORM.rifle.max);
    reloadFresh(state);
    expect(firstShot(state).release, "込め直した後の 1 発目は放出").toBeDefined();
    expect(state.player.morale.value, "使い切る").toBe(0);
  });

  it("溜めの器: 最大段の 1 発だけが放出", () => {
    const levels = BULLETS.matchlock?.charge?.levels ?? [];
    const first = levels[0];
    const last = levels[levels.length - 1];
    if (!first || !last) throw new Error("火縄銃に溜めが無い");
    const state = gunArena({ moveset: "longarm", bullet: "matchlock" });
    state.player.morale.value = FORM.rifle.max;
    run(state, {});
    const shotOf = (holdSec: number): Projectile => {
      state.player.shootCooldown = 0;
      const before = new Set(state.projectiles.map((pr) => pr.id));
      run(state, { attackHeld: true }, stepsFor(holdSec));
      run(state, {});
      const shot = state.projectiles.find((pr) => pr.owner === "player" && !before.has(pr.id));
      if (!shot) throw new Error("溜め撃ちが出ない");
      return shot;
    };
    expect(shotOf(first.time + FIXED_DT * 2).release, "1 段の溜め撃ちは放出でない").toBeUndefined();
    expect(state.player.morale.value, "戦意は残る").toBe(FORM.rifle.max);
    expect(shotOf(last.time + FIXED_DT * 4).release, "最大段は放出").toBeDefined();
    expect(state.player.morale.value, "使い切る").toBe(0);
  });
});

describe("装薬（詰め）", () => {
  const cannon = { moveset: "cannon" as const, bullet: "shotgun" };

  /** 満ちた弾倉でリロードを押し続けて levels 段まで詰める */
  function packTo(state: GameState, levels: number): void {
    const pack = gunNumbersOf("cannon")?.pack;
    if (!pack) throw new Error("砲に詰めが無い");
    run(state, { reloadPressed: true, reloadHeld: true });
    run(state, { reloadHeld: true }, stepsFor(pack.levelSec * levels) - 1);
    run(state, {});
  }

  /** 後ろ（-x）に反動の最大より広く空いた床へ立たせる（稽古場の開始位置は壁が近い） */
  function standInOpen(state: GameState): void {
    const p = state.player.body;
    const clear = (x: number, y: number): boolean => {
      for (let d = 0; d <= OPEN_SPAN; d += 2) if (overlapsWall(state, x - d, y, p.radius)) return false;
      return true;
    };
    for (let y = p.pos.y - OPEN_SEARCH; y <= p.pos.y + OPEN_SEARCH; y += 8) {
      for (let x = p.pos.x - OPEN_SEARCH; x <= p.pos.x + OPEN_SEARCH; x += 8) {
        if (!clear(x, y)) continue;
        p.pos = { x, y };
        return;
      }
    }
    throw new Error("反動を測れる床が無い");
  }

  /** 撃って跳んだ距離（押しが消えるまで進めた x の差） */
  function recoilOf(state: GameState): { shot: Projectile[]; distance: number } {
    standInOpen(state);
    const x = state.player.body.pos.x;
    const { shots } = fire(state);
    run(state, {}, stepsFor(1));
    return { shot: shots, distance: x - state.player.body.pos.x };
  }

  it("詰め 1/2/3 段の次の 1 発は粒・倍率・反動が段の表のとおり", () => {
    const plainState = gunArena(cannon);
    const plain = recoilOf(plainState);
    const plainShot = plain.shot[0];
    if (!plainShot) throw new Error("普通の 1 発が出ない");
    let lastDistance = plain.distance;
    for (const levels of [1, 2, 3]) {
      const row = powderLevelOf(levels);
      if (!row) throw new Error(`詰め ${levels} 段の表が無い`);
      const state = gunArena(cannon);
      packTo(state, levels);
      expect(packLevel(state), `${levels} 段詰めた`).toBe(levels);
      expect(state.player.morale.value, `戦意「詰め」は ${levels}`).toBe(levels);
      const { shot, distance } = recoilOf(state);
      const head = shot[0];
      if (!head) throw new Error("詰めた 1 発が出ない");
      expect(shot.length - plain.shot.length, `${levels} 段の粒`).toBe(row.pelletsAdd);
      expect(head.damage / plainShot.damage, `${levels} 段の威力`).toBeCloseTo(row.damageMul);
      expect((head.poise ?? 0) / (plainShot.poise ?? 1), `${levels} 段の怯み値`).toBeCloseTo(row.damageMul);
      expect(head.release, "放出の弾（終撃）").toEqual({ finisher: true, crit: false });
      // 押しの減衰をステップで足すので表の距離よりわずかに長い
      expect(distance - plain.distance, `${levels} 段の反動`).toBeGreaterThan(row.recoilPx * 0.9);
      expect(distance - plain.distance, `${levels} 段の反動`).toBeLessThan(row.recoilPx * 1.3);
      expect(distance, "段が上がるほど遠く跳ぶ").toBeGreaterThan(lastDistance);
      lastDistance = distance;
      expect(state.player.morale.value, "詰めを使い切る").toBe(0);
    }
  });

  it("零距離砲でも詰めを使い、詰めの段は消えて詰め直せる", () => {
    const index = MOVESETS.cannon.steps2.findIndex((s) => s.key === "pointBlank");
    expect(index, "砲の右に零距離砲").toBeGreaterThanOrEqual(0);
    const state = gunArena(cannon);
    packTo(state, 2);
    state.player.attack.step = index;
    state.player.attack.inputTimer = 1;
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")[0]?.amount, "詰めた 2 段を放つ").toBe(2);
    expect(state.player.morale.value, "使い切る").toBe(0);
    expect(packLevel(state), "詰めの段も消える").toBe(0);
    const step = playerMoveset(state).steps2[index];
    const now = currentMeleeStep(state);
    const plain = meleeStep(state.stats, index, false, 0, -1, playerMoveset(state), "secondary");
    const releaseBase = meleeStep(state.stats, index, false, 0, -1, playerMoveset(state), "secondary", {
      damageMul: 1, poiseMul: 1, reachMul: 1, hitsAdd: 0, knockbackMul: 1, pierceAdd: 0,
    });
    if (step?.kind === "swing" && now && plain && releaseBase) expect(now.damage / releaseBase.damage, "振りの威力も段の表").toBeCloseTo(powderLevelOf(2)?.damageMul ?? 0);
  });

  it("詰めていなければ次の 1 発はただの 1 発", () => {
    const state = gunArena(cannon);
    const { shots, events } = fire(state);
    expect(kinds(events, "onRelease"), "放出しない").toHaveLength(0);
    expect(shots[0]?.release, "放出の弾でない").toBeUndefined();
  });
});

describe("擲弾（炸裂）", () => {
  const grenade = { moveset: "grenade" as const, bullet: "grenadeLauncher" };

  /** 自分の曲射弾をその場で炸裂させる（寿命の尽きた曲射は落ちた所で炸裂する） */
  function blastAt(state: GameState, dx: number): void {
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 9000 + state.projectiles.length,
      owner: "player",
      pos: { x: p.x + dx, y: p.y },
      vel: { x: 0, y: 0 },
      radius: 3,
      damage: 1,
      // 次の updateProjectiles で寿命が尽きて炸裂する
      life: FIXED_DT / 2,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
      shot: { key: "grenadeLauncher", lifeTotal: 1 },
    });
    updateProjectiles(state, FIXED_DT);
  }

  it("敵を巻き込んだ炸裂だけ +1、空撃ちでは溜まらない", () => {
    expect(FORMS.shell.morale.gain.map((g) => g.kind), "炸裂で溜まる").toEqual(["blastHit"]);
    const state = gunArena(grenade);
    blastAt(state, 60);
    expect(state.player.morale.value, "空撃ち").toBe(0);
    tough(placeEnemy(state, "slime", 60));
    blastAt(state, 60);
    expect(state.player.morale.value, "巻き込んだ").toBe(1);
    noteBlast(state, 0);
    expect(state.player.morale.value, "巻き込んだ数 0 は数えない").toBe(1);
  });

  it("4 秒巻き込まないと毎秒 1 冷める", () => {
    const state = gunArena(grenade);
    state.player.morale.value = FORM.shell.max;
    state.player.morale.sinceGain = 0;
    for (let i = 0; i < stepsFor(FORM.shell.decayDelaySec) - 1; i++) tickMorale(state, withInput({}), FIXED_DT);
    expect(state.player.morale.value, "4 秒までは冷めない").toBe(FORM.shell.max);
    for (let i = 0; i < stepsFor(1) + 1; i++) tickMorale(state, withInput({}), FIXED_DT);
    expect(state.player.morale.value, "その後 1 秒で 1 つ冷める").toBeCloseTo(FORM.shell.max - FORM.shell.decayPerSec, 1);
  });

  it("6 で筒払いが放出。満ちていなければただの段", () => {
    const index = MOVESETS.grenade.steps2.findIndex((s) => s.key === "tubeBash");
    expect(index, "擲弾の右に筒払い").toBeGreaterThanOrEqual(0);
    const short = gunArena(grenade);
    short.player.morale.value = FORM.shell.releaseMin - 1;
    short.player.attack.step = index;
    short.player.attack.inputTimer = 1;
    expect(kinds(run(short, { shootHeld: true }), "onRelease"), "5 では放たない").toHaveLength(0);

    const state = gunArena(grenade);
    state.player.morale.value = FORM.shell.max;
    state.player.attack.step = index;
    state.player.attack.inputTimer = 1;
    const events = run(state, { shootHeld: true });
    expect(kinds(events, "onRelease")[0]?.amount, "6 を放つ").toBe(FORM.shell.max);
    const now = currentMeleeStep(state);
    const plain = meleeStep(state.stats, index, false, 0, -1, playerMoveset(state), "secondary");
    if (!now || !plain) throw new Error("筒払いの段が無い");
    const releaseBase = meleeStep(state.stats, index, false, 0, -1, playerMoveset(state), "secondary", {
      damageMul: 1, poiseMul: 1, reachMul: 1, hitsAdd: 0, knockbackMul: 1, pierceAdd: 0,
    });
    if (!releaseBase) throw new Error("放出用の段が無い");
    expect(now.damage / releaseBase.damage, "戦意による威力").toBeCloseTo(1 + FORM.shell.perUnit.damageMul * FORM.shell.max, 5);
    expect(state.player.morale.value + EPS, "使い切る").toBeLessThan(1);
  });
});

describe("仕掛け（置いた弾）は今のまま", () => {
  it("仕掛けだけの型で、放出は起爆の段", () => {
    expect(FORMS.artillery.morale.gain.map((g) => g.kind), "置いた弾").toEqual(["placedShots"]);
    expect(FORMS.artillery.morale.release, "起爆").toEqual({ kind: "laneStep", keys: ["detonate"] });
    expect(MOVESETS.trapper.form, "仕掛け").toBe("artillery");
    expect(MOVESETS.cannon.form, "砲は装薬").toBe("powder");
    expect(MOVESETS.grenade.form, "擲弾は擲弾").toBe("shell");
  });
});
