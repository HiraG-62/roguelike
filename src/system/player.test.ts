import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import type { StatusEffect } from "../core/status";
import { MANA, PLAYER, STATUS, TRIGGER, ULTIMATE, WEAPON } from "../data/tuning";
import { damagePlayer } from "./combat";
import { KS } from "./keystones";
import { applyStatus } from "./statusEffects";
import { fireTrigger } from "./triggers";
import { type ButtonKey, MOVESETS, MOVESET_KEYS, isGun } from "../data/weapons";
import { grantBoon } from "./boons";
import type { FrameInput } from "../core/input";
import {
  type MeleeStep,
  dashCooldownTime,
  hookCombo,
  isPlayerStaggered,
  meleeChargeLevel,
  meleeContact,
  meleeStep,
  playerMoveset,
  shotDamage,
} from "./player";
import { ultimateDamage } from "./ultimates";
import { collectRules } from "./rules";
import { hasStatus } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 無効化手段の整理と手触り（docs/COMBAT_DESIGN.md C 章・段階 1 の L4）。
 * ダッシュ無敵の短縮、弾斬り、近接のマナ回収、プレイヤーの怯み、バースト・トリガーの無敵
 */

/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
/** 予備動作を数フレームに伸ばす振りの速さの倍率 */
const SLOW_SWING = 0.2;
/** 近接 1 振りを振り切るまでのステップ数 */
const SWING_STEPS = 20;
/** 予備動作を十分長く保つ */
const LONG_WINDUP = 10;
/** 1 振りで同時に当てる敵の数（回収上限を超える数） */
const CROWD = MANA.meleeTargetCap + 1;
const STAGGER_TIME = 1;

/** 各ボタンを、前の段が出て振りが先行入力を受ける（active / recover で予約が無い）ようになってから 1 回ずつ押す */
function pressInRhythm(state: GameState, presses: readonly ButtonKey[], maxWait = 60): void {
  for (const button of presses) {
    for (let i = 0; i < maxWait; i++) {
      const a = state.player.attack;
      const ready = a.phase === "none" || ((a.phase === "active" || a.phase === "recover") && !a.buffered && a.pendingBranch < 0);
      if (ready) break;
      step(state, withInput({}), FIXED_DT);
    }
    step(state, withInput(button === "primary" ? { attackPressed: true } : { shootHeld: true }), FIXED_DT);
  }
}

function passive(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

/** マナの自然回復を切った闘技場（命中による増加だけを測る） */
function manaArena(): GameState {
  const state = arena(5, { manaRegen: 0 });
  state.player.mana = 0;
  return state;
}

function swing(state: GameState): void {
  for (let i = 0; i < SWING_STEPS; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
}

function enemyBullet(state: GameState, dx: number): Projectile {
  const p = state.player.body.pos;
  const pr: Projectile = {
    id: state.nextId++,
    owner: "enemy",
    pos: { x: p.x + dx, y: p.y },
    vel: { x: -135, y: 0 },
    radius: 3,
    damage: 8,
    life: 3,
    color: "#e070ff",
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
  };
  state.projectiles.push(pr);
  return pr;
}

/** プレイヤーを怯ませる（付与元は L3 の敵の攻撃。ここでは状態だけを作る） */
function staggerPlayer(state: GameState): void {
  const effect: StatusEffect = {
    kind: "stagger",
    stacks: 1,
    time: STAGGER_TIME,
    maxTime: STAGGER_TIME,
    potency: 0,
    source: "enemy",
    acc: 0,
    tick: 0,
  };
  state.player.status.effects.push(effect);
}

describe("ダッシュの無敵（前半 0.10 秒だけ）", () => {
  it("ダッシュ直後は JUST 回避になる", () => {
    const state = arena();
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.player.dashTimer, "ダッシュ中").toBeGreaterThan(0);
    expect(damagePlayer(state, 10, { x: 0, y: 0 }), "無敵の窓の中").toBe("dodged");
    expect(state.player.dodgedThisDash, "このダッシュで JUST を取った").toBe(true);
  });

  it("無敵は invulnTime で切れ、ダッシュ中でも 0.10 秒後は被弾する", () => {
    const state = arena();
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.player.invulnTimer, "無敵はダッシュ全長ではなく invulnTime").toBeCloseTo(PLAYER.dash.invulnTime);
    while (state.player.invulnTimer > 0) step(state, withInput({}), FIXED_DT);
    expect(state.player.dashTimer, "まだダッシュの後半").toBeGreaterThan(0);
    const hp = state.player.hp;
    expect(damagePlayer(state, 10, { x: 0, y: 0 }), "後半は被弾する").toBe("hit");
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("ダッシュ後の猶予無敵は無く、CD は 0.45 秒", () => {
    const state = arena();
    expect(dashCooldownTime(state.stats), "基礎のダッシュ CD").toBeCloseTo(PLAYER.dash.cooldown);
    expect(PLAYER.dash.cooldown).toBeCloseTo(0.45);
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    while (state.player.dashTimer > 0) step(state, withInput({}), FIXED_DT);
    expect(state.player.invulnTimer, "終了直後に無敵が残らない").toBe(0);
  });
});

describe("弾斬り（性質 bulletCut）", () => {
  it("bulletCut があると近接の active で敵弾が消え、撃ち返しはしない", () => {
    const state = arena(5, { bulletCut: 1 });
    const pr = enemyBullet(state, 22);
    swing(state);
    expect(pr.owner, "撃ち返さない").toBe("enemy");
    expect(state.projectiles.includes(pr) && pr.life > 0, "敵弾が消えている").toBe(false);
    expect(state.player.hp, "被弾しない").toBe(state.player.maxHp);
  });
});

describe("近接命中のマナ回収", () => {
  it("段ごとに onMelee のマナが増える", () => {
    const state = manaArena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.hp = 1000;
    e.maxHp = 1000;
    swing(state);
    expect(e.hp, "当たっている").toBeLessThan(1000);
    expect(state.player.mana, "1 段目の回収量").toBeCloseTo(MANA.onMelee[0] ?? 0);
  });

  it("カウンターヒットなら倍", () => {
    const state = manaArena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    e.phaseTimer = LONG_WINDUP;
    swing(state);
    expect(state.player.mana, "カウンターの回収量").toBeCloseTo((MANA.onMelee[0] ?? 0) * MANA.onCounterMul);
  });

  it("静寂の誓い（ks_silentVow）があると近接命中でマナが戻らない", () => {
    const state = manaArena();
    state.stats = { ...state.stats, keystones: [KS.silentVow] };
    const e = passive(placeEnemy(state, "boar", 14));
    e.hp = 1000;
    e.maxHp = 1000;
    swing(state);
    expect(e.hp, "当たっている").toBeLessThan(1000);
    expect(state.player.mana, "回収なし").toBe(0);
  });

  it("1 振りで回収する敵は meleeTargetCap 体まで", () => {
    const state = manaArena();
    const crowd: Enemy[] = [];
    for (let i = 0; i < CROWD; i++) {
      const e = passive(placeEnemy(state, "boar", 14, (i - (CROWD - 1) / 2) * 2));
      e.hp = 1000;
      e.maxHp = 1000;
      crowd.push(e);
    }
    swing(state);
    expect(crowd.every((e) => e.hp < 1000), "全員に当たっている").toBe(true);
    expect(state.player.mana, "上限ぶんだけ回収").toBeCloseTo((MANA.onMelee[0] ?? 0) * MANA.meleeTargetCap);
  });
});

describe("プレイヤーの怯み（被弾硬直）", () => {
  it("怯み中は近接・ダッシュ・射撃・バーストが出ない", () => {
    const state = arena();
    staggerPlayer(state);
    state.player.energy = ULTIMATE.common.cost;
    expect(isPlayerStaggered(state.player)).toBe(true);
    step(state, withInput({ attackPressed: true, dashPressed: true, shootHeld: true, specialPressed: true }), FIXED_DT);
    const p = state.player;
    expect(p.attack.phase, "近接が出ない").toBe("none");
    expect(p.dashTimer, "ダッシュしない").toBe(0);
    expect(state.projectiles.filter((pr) => pr.owner === "player"), "射撃しない").toHaveLength(0);
    expect(p.energy, "バーストを撃たない").toBe(ULTIMATE.common.cost);
  });

  it("怯み中の移動は staggerMoveMul 倍", () => {
    const moved = (staggered: boolean): number => {
      const state = arena();
      if (staggered) staggerPlayer(state);
      const x = state.player.body.pos.x;
      step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
      return state.player.body.pos.x - x;
    };
    const normal = moved(false);
    expect(normal, "通常は動く").toBeGreaterThan(0);
    expect(moved(true) / normal, "怯み中の移動倍率").toBeCloseTo(PLAYER.staggerMoveMul);
  });

  it("怯んでいなければ普通に行動できる", () => {
    const state = arena();
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).not.toBe("none");
  });
});

describe("プレイヤーの冷気による移動速度低下", () => {
  it("冷気を付与すると移動距離が減る", () => {
    const moved = (chilled: boolean): number => {
      const state = arena();
      if (chilled) {
        applyStatus(
          state,
          { kind: "player" },
          { kind: "chill", stacks: 1, duration: STATUS.chill.duration, potency: STATUS.chill.slowPerStack },
          "enemy",
        );
      }
      const x = state.player.body.pos.x;
      step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
      return state.player.body.pos.x - x;
    };
    const normal = moved(false);
    expect(normal, "通常は動く").toBeGreaterThan(0);
    expect(moved(true), "冷気中は移動距離が減る").toBeLessThan(normal);
  });
});

describe("射撃・バーストの威力と怯み値", () => {
  it("射撃弾は係数で評価した威力と怯み値を持つ", () => {
    const state = arena(5, { moveset: "sidearm" });
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    const shot = state.projectiles.find((pr) => pr.owner === "player");
    if (!shot) throw new Error("射撃弾が出ていない");
    expect(shot.damage, "基礎値の射撃威力").toBeCloseTo(shotDamage(state.stats));
    expect(shot.poise, "射撃の怯み値").toBeCloseTo(PLAYER.shoot.poise * state.stats.poiseDamageMul);
  });

  it("バーストは burstDamageMul を掛け、無敵は 0.15 秒", () => {
    const state = arena(5, { burstDamageMul: 2 });
    const scaling = ULTIMATE.defs.sword.fullMoon.nova.scaling;
    expect(ultimateDamage(state.stats, scaling), "バースト威力 × burstDamageMul").toBeCloseTo(ultimateDamage({ ...state.stats, burstDamageMul: 1 }, scaling) * 2);
    state.player.energy = ULTIMATE.common.cost;
    step(state, withInput({ specialPressed: true }), FIXED_DT);
    expect(state.player.energy, "ゲージを消費した").toBe(0);
    expect(state.player.invulnTimer, "バースト後の無敵").toBeCloseTo(ULTIMATE.common.invuln);
  });
});

describe("トリガー効果の無敵の上限", () => {
  it("invuln の持続は TRIGGER.invulnMax で切られる", () => {
    const state = arena(5, {
      triggers: [{ trigger: "onDash", condition: "always", effect: "invuln", magnitude: 2, duration: 2, chance: 1 }],
    });
    fireTrigger(state, "onDash", { pos: { ...state.player.body.pos } });
    expect(state.player.buffs.invuln, "上限で切られる").toBeCloseTo(TRIGGER.invulnMax);
  });
});

// ---------------------------------------------------------------------------
// 武器種（src/data/weapons.ts）
// ---------------------------------------------------------------------------

/** 1 コンボを振り切るまでの上限ステップ */
const COMBO_MAX_STEPS = 600;
/** 近接を当て続けても倒れない・怯まない敵 */
const TOUGH_HP = 99999;
const TOUGH_POISE = 99999;
/** 全武器種の全段に入る正面の距離 */
const FRONT_DIST = 12;

function tough(e: Enemy): Enemy {
  passive(e);
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  e.poise.max = TOUGH_POISE;
  return e;
}

/** 形の内側（正面）の点までの距離。形ごとの reach / size の意味に合わせる */
function insideDistance(s: MeleeStep): number {
  switch (s.shape.kind) {
    case "box":
    case "circle":
      return s.reach;
    case "arc":
      return s.reach * 0.7;
    case "thrust":
      return s.reach * 0.8;
  }
}

/** 近接の連撃ボタン（どの武器種も左） */
function meleePress(): Partial<FrameInput> {
  return { attackPressed: true };
}

/** 連撃ボタンを押し続けてコンボを最終段まで振り切る。敵は毎フレーム自分の正面 FRONT_DIST へ戻す（踏み込みで前に出るため） */
function runCombo(state: GameState, e: Enemy): number {
  const last = MOVESETS[state.stats.moveset].steps.length - 1;
  let maxStep = 0;
  for (let i = 0; i < COMBO_MAX_STEPS; i++) {
    const p = state.player.body.pos;
    e.body.pos = { x: p.x + FRONT_DIST, y: p.y };
    e.knock = { x: 0, y: 0 };
    step(state, withInput(meleePress()), FIXED_DT);
    maxStep = Math.max(maxStep, state.player.attack.step);
    if (maxStep === last && state.player.attack.phase === "none") break;
  }
  return maxStep;
}

/**
 * 右だけを 1 フレームおきに押し続けて右レーンを最終段まで進める（右の「押した瞬間」は前フレームとの差で取るため）。
 * 右レーンで振った・出した段の最大の添字を返す
 */
function runRightLane(state: GameState, e: Enemy): number {
  const last = MOVESETS[state.stats.moveset].steps2.length - 1;
  let maxStep = 0;
  for (let i = 0; i < COMBO_MAX_STEPS; i++) {
    const p = state.player.body.pos;
    e.body.pos = { x: p.x + FRONT_DIST, y: p.y };
    e.knock = { x: 0, y: 0 };
    step(state, withInput({ shootHeld: i % 2 === 0 }), FIXED_DT);
    const a = state.player.attack;
    if (a.phase !== "none" && a.lane === "secondary" && a.branch < 0) maxStep = Math.max(maxStep, a.step);
    if (maxStep === last && a.phase === "none") break;
  }
  return maxStep;
}

describe("武器種: 右レーン（アクション 2）の各段", () => {
  for (const key of MOVESET_KEYS) {
    if (isGun(MOVESETS[key])) continue;
    it(`${MOVESETS[key].name}（${key}）: 右を押し続けると右レーンの最終段まで振り、正面の敵に当たる`, () => {
      const state = arena(5, { moveset: key });
      const e = tough(placeEnemy(state, "boar", FRONT_DIST));
      const maxStep = runRightLane(state, e);
      expect(maxStep, "右レーンの最終段まで進んだ").toBe(MOVESETS[key].steps2.length - 1);
      expect(state.player.meleeHitCount, "右の振りが当たった").toBeGreaterThan(0);
    });
  }
});

describe("武器種: 各段が当たる", () => {
  for (const key of MOVESET_KEYS) {
    // 銃の家系は近接の段を持たない（射撃は projectiles.test.ts / 下の「二丁拳銃」で見る）
    if (isGun(MOVESETS[key])) continue;
    it(`${MOVESETS[key].name}（${key}）: 押し続けると最終段まで振り、全段が正面の敵に当たる（多段ヒットは回数ぶん）`, () => {
      const state = arena(5, { moveset: key });
      const e = tough(placeEnemy(state, "boar", FRONT_DIST));
      const maxStep = runCombo(state, e);
      const steps = MOVESETS[key].steps;
      const hits = steps.reduce((sum, s) => sum + (s.hits ?? 1), 0);
      expect(maxStep, "最終段まで進んだ").toBe(steps.length - 1);
      expect(state.player.attack.branch, "派生は出ていない").toBe(-1);
      expect(state.player.meleeHitCount, "段ごとのヒット数の合計だけ当たった").toBe(hits);
      expect(e.hp, "威力が入った").toBeLessThan(TOUGH_HP);
    });

    it(`${MOVESETS[key].name}（${key}）: 各段の形は正面に届き、真後ろの遠くには届かない`, () => {
      const state = arena(5, { moveset: key });
      const p = state.player;
      p.attack.dir = { x: 1, y: 0 };
      const steps = MOVESETS[key].steps.map((_, i) => meleeStep(state.stats, i));
      for (const [i, s] of steps.entries()) {
        if (!s) throw new Error(`${key} の ${i + 1} 段目が無い`);
        const front = { x: p.body.pos.x + insideDistance(s), y: p.body.pos.y };
        const behind = { x: p.body.pos.x - 60, y: p.body.pos.y };
        expect(meleeContact(p, s, front, 4), `${i + 1} 段目が正面に届く`).not.toBe("none");
        expect(meleeContact(p, s, behind, 4), `${i + 1} 段目は背後の遠くに届かない`).toBe("none");
      }
    });
  }
});

describe("武器種: 形とリーチ", () => {
  it("扇は角度の内側だけに当たる（大剣 150°）", () => {
    const state = arena(5, { moveset: "greatsword" });
    const p = state.player;
    p.attack.dir = { x: 1, y: 0 };
    const s = meleeStep(state.stats, 0);
    if (!s) throw new Error("段が無い");
    const r = s.reach * 0.8;
    const at = (deg: number) => ({ x: p.body.pos.x + Math.cos((deg * Math.PI) / 180) * r, y: p.body.pos.y + Math.sin((deg * Math.PI) / 180) * r });
    expect(meleeContact(p, s, at(60), 1), "60° は扇の内側").toBe("hit");
    expect(meleeContact(p, s, at(120), 1), "120° は扇の外側").toBe("none");
  });

  it("突きは細長い: 槍は剣より遠くに届き、横には届かない", () => {
    const spear = arena(5, { moveset: "spear" });
    const sword = arena(5, { moveset: "sword" });
    for (const st of [spear, sword]) st.player.attack.dir = { x: 1, y: 0 };
    const far = (st: GameState) => ({ x: st.player.body.pos.x + 40, y: st.player.body.pos.y });
    const side = (st: GameState) => ({ x: st.player.body.pos.x + 10, y: st.player.body.pos.y + 14 });
    const sp = meleeStep(spear.stats, 0);
    const sw = meleeStep(sword.stats, 0);
    if (!sp || !sw) throw new Error("段が無い");
    expect(meleeContact(spear.player, sp, far(spear), 2), "槍は 40 先に届く").not.toBe("none");
    expect(meleeContact(sword.player, sw, far(sword), 2), "剣は 40 先に届かない").toBe("none");
    expect(meleeContact(spear.player, sp, side(spear), 2), "槍は横に届かない").toBe("none");
    expect(meleeContact(sword.player, sw, side(sword), 2), "剣は横にも届く").toBe("hit");
  });

  it("槍の穂先で当てると怯み値が 2 倍", () => {
    const poiseAt = (dist: number): number => {
      const state = arena(5, { moveset: "spear" });
      const e = tough(placeEnemy(state, "boar", dist));
      for (let i = 0; i < 20; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
      expect(state.player.meleeHitCount, `${dist} で当たった`).toBe(1);
      return e.poise.damage;
    };
    const root = poiseAt(FRONT_DIST);
    const tip = poiseAt(MOVESETS.spear.steps[0]!.reach - 2);
    expect(tip, "穂先は根元の 2 倍").toBeCloseTo(root * (MOVESETS.spear.tip?.poiseMul ?? 0), 0);
  });

  it("鞭は根元だとマナが戻らない（先端だけ回収）", () => {
    const manaAt = (dist: number): number => {
      const state = arena(5, { moveset: "whip", manaRegen: 0 });
      state.player.mana = 0;
      tough(placeEnemy(state, "boar", dist));
      for (let i = 0; i < 30; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
      return state.player.mana;
    };
    expect(manaAt(FRONT_DIST), "根元ではマナ 0").toBe(0);
    expect(manaAt(MOVESETS.whip.steps[0]!.reach - 2), "先端でマナが戻る").toBeGreaterThan(0);
  });

  it("大鎌は敵を手前へ引き寄せ、拳のダッシュ攻撃は背後へ投げる", () => {
    const scythe = arena(5, { moveset: "scythe" });
    const e1 = tough(placeEnemy(scythe, "boar", 20));
    for (let i = 0; i < 30 && scythe.player.meleeHitCount === 0; i++) step(scythe, withInput({ attackPressed: i === 0 }), FIXED_DT);
    expect(e1.knock.x, "大鎌: 自分の方（-x）へ飛ぶ").toBeLessThan(0);

    const fists = arena(5, { moveset: "fists" });
    const e2 = tough(placeEnemy(fists, "boar", FRONT_DIST));
    fists.player.dashAttackQueued = true;
    for (let i = 0; i < 30 && fists.player.meleeHitCount === 0; i++) step(fists, withInput({}), FIXED_DT);
    expect(fists.player.dashStrike || fists.player.meleeHitCount > 0, "ダッシュ攻撃が出た").toBe(true);
    expect(e2.knock.x, "拳の投げ: 背後（-x）へ飛ぶ").toBeLessThan(0);
  });

  it("双剣の 5 段は最終段だけが祝福の最終段（combo 2）になる", () => {
    const twin = MOVESETS.twinBlades;
    expect(hookCombo(twin, 0)).toBe(0);
    expect(hookCombo(twin, 2), "途中の段は 1").toBe(1);
    expect(hookCombo(twin, 3), "途中の段は 1").toBe(1);
    expect(hookCombo(twin, 4), "最終段は 2").toBe(2);
    expect(hookCombo(MOVESETS.sword, 2), "剣の 3 段目は従来どおり 2").toBe(2);
  });
});

describe("武器種: 大剣の溜め", () => {
  /** 攻撃キーを frames だけ押し続けてから離す */
  function holdAndRelease(state: GameState, frames: number): void {
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 1; i < frames; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    step(state, withInput({}), FIXED_DT);
  }

  it("押している間は振らず、溜めの段が時間で上がる", () => {
    const state = arena(5, { moveset: "greatsword" });
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 0; i < 30; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(state.player.attack.phase, "溜め中は振らない").toBe("none");
    expect(state.player.attack.charging, "溜めている").toBe(true);
    expect(meleeChargeLevel(state), "0.5 秒で 1 段").toBe(1);
    expect(state.sfx, "段が上がった音").toContain("chargeLevel");
  });

  it("段に届いて離すと溜め攻撃（最終段扱い）、届かず離すと通常の 1 段目", () => {
    const charged = arena(5, { moveset: "greatsword" });
    holdAndRelease(charged, 55);
    expect(charged.player.attack.chargeLevel, "0.9 秒で 2 段").toBe(2);
    expect(charged.player.attack.combo, "溜め攻撃は最終段として祝福に渡る").toBe(2);

    const tap = arena(5, { moveset: "greatsword" });
    step(tap, withInput({ attackPressed: true }), FIXED_DT);
    expect(tap.player.attack.chargeLevel, "tap は溜めなし").toBe(0);
    expect(tap.player.attack.phase, "tap はすぐ振る").toBe("windup");
    expect(tap.player.attack.step).toBe(0);
  });

  it("溜めるほど威力・怯み値・リーチが伸びる", () => {
    const state = arena(5, { moveset: "greatsword" });
    const tap = meleeStep(state.stats, 0);
    const lv1 = meleeStep(state.stats, 0, false, 1);
    const lv3 = meleeStep(state.stats, 0, false, 3);
    if (!tap || !lv1 || !lv3) throw new Error("段が無い");
    expect(lv3.damage).toBeGreaterThan(lv1.damage);
    expect(lv1.damage).toBeGreaterThan(tap.damage);
    expect(lv3.poise).toBeGreaterThan(lv1.poise);
    expect(lv3.reach).toBeGreaterThan(lv1.reach);
  });

  it("溜め攻撃は正面の敵に当たり、tap より多く削る", () => {
    const lossWith = (frames: number): number => {
      const state = arena(5, { moveset: "greatsword" });
      const e = tough(placeEnemy(state, "boar", 20));
      if (frames > 0) holdAndRelease(state, frames);
      else step(state, withInput({ attackPressed: true }), FIXED_DT);
      for (let i = 0; i < 40; i++) step(state, withInput({}), FIXED_DT);
      return TOUGH_HP - e.hp;
    };
    expect(lossWith(80), "3 段の溜め").toBeGreaterThan(lossWith(0));
  });

  it("ダッシュで溜めが消える", () => {
    const state = arena(5, { moveset: "greatsword" });
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    step(state, withInput({ attackHeld: true, dashPressed: true }), FIXED_DT);
    expect(state.player.attack.charging, "ダッシュで溜めを捨てた").toBe(false);
  });
});

describe("武器種: コンボ派生（左右の組み合わせ）", () => {
  /** frames 列の各フレームの入力で進める */
  function play(state: GameState, frames: readonly Partial<FrameInput>[]): void {
    for (const f of frames) step(state, withInput(f), FIXED_DT);
  }
  const idle = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({}));
  const branchKey = (state: GameState): string | undefined =>
    MOVESETS[state.stats.moveset].branches[state.player.attack.branch]?.key;
  /** 今振っている右レーンの段の key（右の振りでなければ undefined） */
  const laneKey = (state: GameState): string | undefined =>
    state.player.attack.lane === "secondary" && state.player.attack.branch < 0 ? playerMoveset(state).steps2[state.player.attack.step]?.key : undefined;

  /** 派生が出るまで（最大 n フレーム）空の入力で進める */
  function untilBranch(state: GameState, n = 60): void {
    for (let i = 0; i < n && state.player.attack.branch < 0; i++) step(state, withInput({}), FIXED_DT);
  }

  it("windup 中の連打では派生が出ない（振りは 1 段）", () => {
    // 振りを遅くして予備動作を数フレームに伸ばす
    const state = arena(5, { attackSpeedMul: SLOW_SWING });
    play(state, [{ attackPressed: true }]);
    expect(state.player.attack.phase, "1 段目の予備動作中").toBe("windup");
    // 予備動作中に左 2 回と右: 押した数だけなら「左左左右」「左左右」だが、出た段は 1 つだけ
    play(state, [{ attackPressed: true }, { attackPressed: true }]);
    expect(state.player.attack.phase, "まだ予備動作中").toBe("windup");
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.inputs, "出た段は左 1 つ").toEqual(["primary"]);
    let maxStep = 0;
    let branched = false;
    for (let i = 0; i < 60; i++) {
      step(state, withInput({}), FIXED_DT);
      maxStep = Math.max(maxStep, state.player.attack.step);
      branched ||= state.player.attack.branch >= 0 || state.player.attack.pendingBranch >= 0;
    }
    expect(branched, "派生は出ない").toBe(false);
    expect(maxStep, "振りは 1 段だけ").toBe(0);
  });

  it("L→L の 2 段が出た後の R で派生が出る", () => {
    const state = arena(5);
    pressInRhythm(state, ["primary", "primary"]);
    for (let i = 0; i < 60 && state.player.attack.buffered; i++) step(state, withInput({}), FIXED_DT);
    expect(state.player.attack.inputs, "左 2 段が出た").toEqual(["primary", "primary"]);
    pressInRhythm(state, ["secondary"]);
    untilBranch(state);
    expect(branchKey(state)).toBe("crossCut");
    expect(state.player.attack.inputs, "派生が出たら列を捨てる").toEqual([]);
  });

  it("先行入力で予約中の段は派生の列に含め、その段を出してから派生を出す", () => {
    const state = arena(5);
    pressInRhythm(state, ["primary", "primary"]);
    // 2 段目の左はまだ予約（1 段目の振りの最中）
    expect(state.player.attack.buffered, "2 段目は先行入力").toBe(true);
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.pendingBranch, "予約中の段を含めて左左右が成立").toBeGreaterThanOrEqual(0);
    const steps: number[] = [];
    for (let i = 0; i < 90 && state.player.attack.branch < 0; i++) {
      step(state, withInput({}), FIXED_DT);
      if (state.player.attack.phase === "windup" && state.player.attack.branch < 0) steps.push(state.player.attack.step);
    }
    expect(steps, "派生の前に 2 段目を振った").toContain(1);
    expect(branchKey(state)).toBe("crossCut");
  });

  it("剣: 左・左・右で十字断ち（フィニッシュとして祝福に最終段を渡す）", () => {
    const state = arena(5);
    play(state, [{ attackPressed: true }, ...idle(4), { attackPressed: true }, ...idle(4), { shootHeld: true }]);
    untilBranch(state);
    expect(branchKey(state)).toBe("crossCut");
    expect(state.player.attack.combo, "フィニッシュは combo 2").toBe(2);
  });

  it("剣: 右（受け流し）・左・左で踏み込み斬りになり、前へ踏み込む", () => {
    const state = arena(5);
    const x0 = state.player.body.pos.x;
    play(state, [{ shootHeld: true }, {}, { attackPressed: true }, ...idle(5), { attackPressed: true }]);
    untilBranch(state);
    expect(branchKey(state)).toBe("steppingCut");
    play(state, idle(20));
    expect(state.player.body.pos.x - x0, "踏み込んだ").toBeGreaterThan(10);
  });

  it("剣: 受け流しの窓が閉じてから入力の窓も切れた後の左は普通の 1 段目", () => {
    const state = arena(5);
    const parry = MOVESETS.sword.steps2[0];
    const windowSec = parry.kind === "hold" ? (parry.hold.parry?.windowSec ?? 0) : 0;
    const waitSteps = Math.ceil((windowSec + WEAPON.chainWindow) / FIXED_DT) + 2;
    play(state, [{ shootHeld: true }, ...idle(waitSteps), { attackPressed: true }]);
    expect(state.player.attack.branch, "派生にならない").toBe(-1);
    expect(state.player.attack.step).toBe(0);
    expect(state.player.attack.lane).toBe("primary");
  });

  it("大剣: 右クリックは射撃ではなく右レーンの薙ぎ払い", () => {
    const state = arena(5, { moveset: "greatsword" });
    play(state, [{ shootHeld: true }, { shootHeld: true }]);
    expect(laneKey(state)).toBe("sweep");
    expect(state.projectiles.filter((pr) => pr.owner === "player").length, "撃たない").toBe(0);
  });

  it("杖: 左で杖打ち、右で魔弾。左左右で魔力撃", () => {
    const state = arena(5, { moveset: "wand" });
    play(state, [{ attackPressed: true, attackHeld: true }]);
    expect(state.player.attack.phase, "左で振った").toBe("windup");
    expect(state.projectiles.filter((pr) => pr.owner === "player").length, "左では撃たない").toBe(0);
    play(state, [...idle(4), { attackPressed: true }, ...idle(4), { shootHeld: true }]);
    untilBranch(state);
    expect(branchKey(state)).toBe("arcaneStrike");

    const bolt = arena(5, { moveset: "wand" });
    play(bolt, [{ shootHeld: true }]);
    expect(bolt.projectiles.filter((pr) => pr.owner === "player").length, "右だけなら魔弾を 1 発").toBe(1);
    expect(bolt.player.attack.phase, "右では振らない").toBe("none");
  });

  it("続く派生（踏み込み斬り）の後は指定の段から連撃が続く", () => {
    const state = arena(5);
    play(state, [{ shootHeld: true }, {}, { attackPressed: true }, ...idle(5), { attackPressed: true }]);
    untilBranch(state);
    expect(branchKey(state)).toBe("steppingCut");
    for (let i = 0; i < 60 && state.player.attack.phase !== "recover"; i++) step(state, withInput({}), FIXED_DT);
    play(state, [{ attackPressed: true }]);
    for (let i = 0; i < 60 && state.player.attack.branch >= 0; i++) step(state, withInput({}), FIXED_DT);
    expect(state.player.attack.step, "3 段目へ続いた").toBe(MOVESETS.sword.branches.find((b) => b.key === "steppingCut")?.next);
  });
});

describe("左右アクションの共有の段カウンタ（docs/ideas/ougi-and-dual-actions.md 4.2）", () => {
  /**
   * presses を 1 つずつ、押せる時点（振っていない・構えている・振りの active / recover で先行入力が空）で押し、
   * 振り始め（windup）に入った段を（段の添字, レーン, 派生）で記録する
   */
  function swingLog(state: GameState, presses: readonly ButtonKey[]): { step: number; lane: ButtonKey; branch: number }[] {
    const log: { step: number; lane: ButtonKey; branch: number }[] = [];
    const queue = [...presses];
    let last = "";
    let pressedLast = false;
    for (let i = 0; i < COMBO_MAX_STEPS; i++) {
      const a = state.player.attack;
      const swinging = (a.phase === "active" || a.phase === "recover") && !a.buffered && a.pendingBranch < 0;
      const ready: boolean = !pressedLast && !a.charging && (a.phase === "none" || swinging);
      const next: ButtonKey | undefined = ready ? queue.shift() : undefined;
      pressedLast = next !== undefined;
      step(state, withInput(next === undefined ? {} : next === "primary" ? { attackPressed: true } : { shootHeld: true }), FIXED_DT);
      if (a.phase === "windup") {
        const sig = `${a.step}:${a.lane}:${a.branch}`;
        if (sig !== last) log.push({ step: a.step, lane: a.lane, branch: a.branch });
        last = sig;
      } else if (a.phase === "none") last = "";
      if (queue.length === 0 && a.phase === "none" && !state.player.art.holding) break;
    }
    return log;
  }

  it("右を押すと右レーンの段が出て、段カウンタは左右で共有される（左右左 = 1・2・3 段目）", () => {
    // 大剣は左右左を名前付き派生にしていない（左は tap で振る）
    const log = swingLog(arena(5, { moveset: "greatsword" }), ["primary", "secondary", "primary"]);
    expect(log.map((l) => [l.step, l.lane])).toEqual([
      [0, "primary"],
      [1, "secondary"],
      [2, "primary"],
    ]);
    expect(log.every((l) => l.branch < 0), "左右左は名前付き派生ではない").toBe(true);
  });

  it("同じ段で左と右は別の振りになる（剣の 3 段目: 左は斬り、右は斬り上げ）", () => {
    const left = arena(5);
    const right = arena(5);
    const lLog = swingLog(left, ["primary", "primary", "primary"]);
    const rLog = swingLog(right, ["primary", "primary", "secondary"]);
    expect(lLog[2], "左左左の 3 段目").toEqual({ step: 2, lane: "primary", branch: -1 });
    // 左左右は名前付き派生（十字断ち）なので、右の 3 段目は右右右で見る
    const rr = arena(5);
    const rrLog = swingLog(rr, ["secondary", "secondary", "secondary"]);
    expect(rrLog.map((l) => [l.step, l.lane]), "右右右 = 受け流し・返し斬り・斬り上げ").toEqual([
      [1, "secondary"],
      [2, "secondary"],
    ]);
    const leftStep = meleeStep(left.stats, 2, false, 0, -1, MOVESETS.sword, "primary");
    const rightStep = meleeStep(right.stats, 2, false, 0, -1, MOVESETS.sword, "secondary");
    expect(leftStep?.shape.kind, "左の 3 段目は箱の斬り").toBe("box");
    expect(rightStep?.shape.kind, "右の 3 段目は扇の斬り上げ").toBe("arc");
    expect(rLog.some((l) => l.branch >= 0), "左左右は十字断ち").toBe(true);
  });

  it("名前付き派生は 3 入力以上で、長い列が先に一致する（右左左 → 踏み込み斬り）", () => {
    const state = arena(5);
    const log = swingLog(state, ["secondary", "primary", "primary"]);
    const moveset = playerMoveset(state);
    const names = log.map((l) => (l.branch >= 0 ? moveset.branches[l.branch]?.key : `${l.lane}:${l.step}`));
    expect(names, "右（受け流し）→ 左の 2 段目 → 踏み込み斬り").toEqual(["primary:1", "steppingCut"]);
  });

  it("右レーンの最終段は終撃として扱われる（得物の誉れが乗る）", () => {
    const energyAfterRightFinisher = (withBoon: boolean): number => {
      const state = arena(5);
      state.job = "swordsman";
      // 祝福は装備の stats から畳み直す。空の装備は素手（拳）になるので、arena の剣の stats を装備の stats として使わせる
      state.boonRun.baseStats = state.stats;
      if (withBoon) grantBoon(state, "favoredPride");
      const e = tough(placeEnemy(state, "boar", FRONT_DIST));
      const log = swingLog(state, ["secondary", "secondary", "secondary"]);
      expect(log.at(-1), "右の 3 段目（斬り上げ）まで振った").toEqual({ step: 2, lane: "secondary", branch: -1 });
      expect(e.hp, "当たった").toBeLessThan(TOUGH_HP);
      return state.player.energy;
    };
    const state = arena(5);
    expect(hookCombo(MOVESETS.sword, 2, "secondary"), "右の最終段は combo 2").toBe(2);
    expect(hookCombo(MOVESETS.sidearm, 2, "secondary"), "銃の右レーンの最終段も終撃").toBe(2);
    expect(hookCombo(MOVESETS.sidearm, 0, "primary"), "銃の左（反転撃ち）は連撃ではない").toBe(0);
    expect(state.player.energy).toBe(0);
    expect(energyAfterRightFinisher(true), "得物の誉れで奥義ゲージが増える").toBeGreaterThan(energyAfterRightFinisher(false));
  });

  it("ジョブ派生 左左左右 は右レーンの 4 段目を上書きする", () => {
    const state = arena(5, { moveset: "spear" });
    state.job = "lancer";
    const log = swingLog(state, ["primary", "primary", "primary", "secondary"]);
    const moveset = playerMoveset(state);
    const last = log.at(-1);
    expect(last?.branch ?? -1, "4 手目は派生").toBeGreaterThanOrEqual(0);
    expect(moveset.branches[last?.branch ?? -1]?.key, "槍の右 4 段目（大突き）ではなくジョブの派生").toBe("job.lancer");
    const plain = arena(5, { moveset: "spear" });
    const plainLog = swingLog(plain, ["primary", "primary", "primary", "secondary"]);
    const plainLast = plainLog.at(-1);
    // 見習いでは末尾の左左右（石突き回し）が一致する。どちらでも 4 手目が右レーンの 4 段目（大突き）にはならない
    expect(MOVESETS.spear.branches[plainLast?.branch ?? -1]?.key, "見習いは末尾の左左右").toBe("spearSweep");
    expect(log.some((l) => l.lane === "secondary" && l.step === 3 && l.branch < 0), "右の 4 段目は振らない").toBe(false);
  });
});

describe("武器種: 手触り（ヒットストップ・揺れ・残像）", () => {
  it("鉈の命中で画面が揺れ、振りの残像の線が出る", () => {
    const state = arena(5, { moveset: "cleaver" });
    tough(placeEnemy(state, "boar", FRONT_DIST));
    for (let i = 0; i < 20 && state.player.meleeHitCount === 0; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
    expect(state.player.meleeHitCount).toBe(1);
    expect(state.camera.shake, "揺れた").toBeGreaterThan(0);
    expect(state.shapes.some((s) => s.kind === "line"), "残像の線").toBe(true);
  });

  it("1 振りで多段ヒットする段は同じ敵に hits 回当たる", () => {
    const state = arena(5, { moveset: "fists" });
    const e = tough(placeEnemy(state, "boar", FRONT_DIST));
    const multi = meleeStep(state.stats, 3);
    if (!multi) throw new Error("段が無い");
    expect(multi.hits, "拳の 4 段目は 3 回").toBe(3);
    runCombo(state, e);
    expect(state.player.meleeHitCount).toBe(MOVESETS.fists.steps.reduce((sum, s) => sum + (s.hits ?? 1), 0));
  });
});

describe("武器種の文法拡張（docs/ideas/combat-feel-design.md B-0）", () => {
  const playerShotCount = (state: GameState): number => state.projectiles.filter((pr) => pr.owner === "player").length;
  const branchKeyOf = (state: GameState): string | undefined => playerMoveset(state).branches[state.player.attack.branch]?.key;
  /** 派生が出るまで（最大 n フレーム）空の入力で進める */
  function untilBranch(state: GameState, n = 90): void {
    for (let i = 0; i < n && state.player.attack.branch < 0; i++) step(state, withInput({}), FIXED_DT);
  }
  /** 左左左右（ジョブ固有の派生の入力）を、前の段が実際に出てから押す（派生は出た段の列で照合する） */
  function pressJobSequence(state: GameState): void {
    pressInRhythm(state, ["primary", "primary", "primary", "secondary"]);
  }

  it("applies を持つ段の命中で状態異常が付く（斧の最終段で出血）", () => {
    const state = arena(5, { moveset: "axe" });
    const e = tough(placeEnemy(state, "boar", FRONT_DIST));
    runCombo(state, e);
    expect(hasStatus(e.status, "bleed"), "最終段で出血した").toBe(true);
  });

  it("鎖鎌の分銅（右）は離れた敵を引き寄せ、崩勢を付ける", () => {
    const state = arena(5, { moveset: "chainSickle" });
    const e = tough(placeEnemy(state, "boar", 50));
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(state.player.attack.lane, "右レーンの 1 段目").toBe("secondary");
    expect(playerMoveset(state).steps2[state.player.attack.step]?.key).toBe("chainWeight");
    for (let i = 0; i < 30 && state.player.meleeHitCount === 0; i++) step(state, withInput({}), FIXED_DT);
    expect(state.player.meleeHitCount, "50 先の敵に届いた").toBe(1);
    expect(e.knock.x, "自分の方（-x）へ引いた").toBeLessThan(0);
    expect(hasStatus(e.status, "broken"), "崩勢").toBe(true);
  });

  it("右クリックが溜めの武器種（刀）は右の長押しで溜まり居合を振り、左は連撃", () => {
    const state = arena(5, { moveset: "katana" });
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    for (let i = 0; i < 30; i++) step(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(state.player.attack.charging, "右の押しっぱなしで溜めている").toBe(true);
    expect(meleeChargeLevel(state), "0.5 秒で 1 段").toBe(1);
    expect(playerShotCount(state), "刀は撃たない").toBe(0);
    step(state, withInput({}), FIXED_DT);
    expect(state.player.attack.chargeLevel, "離すと居合").toBe(1);
    expect(state.player.attack.phase).toBe("windup");

    const tap = arena(5, { moveset: "katana" });
    step(tap, withInput({ attackPressed: true }), FIXED_DT);
    expect(tap.player.attack.charging, "左は溜めない").toBe(false);
    expect(tap.player.attack.phase, "左はすぐ振る").toBe("windup");
    expect(tap.player.attack.chargeLevel).toBe(0);
  });

  it("戦鎚は大剣と同じく左の長押しで溜まる", () => {
    const state = arena(5, { moveset: "hammer" });
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 0; i < 40; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(meleeChargeLevel(state), "0.68 秒で 1 段").toBe(1);
  });

  it("二丁拳銃は左で撃ち、銃口が左右交互になる。右は乱れ撃ち", () => {
    const left = arena(5, { moveset: "gunner" });
    step(left, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    expect(playerShotCount(left), "左で撃った").toBe(1);
    expect(left.player.attack.phase, "近接は振らない").toBe("none");

    const right = arena(5, { moveset: "gunner" });
    step(right, withInput({ shootHeld: true }), FIXED_DT);
    expect(playerShotCount(right), "右は乱れ撃ち（全周に 8 発）").toBe(8);

    const both = arena(5, { moveset: "gunner" });
    const cooldownSteps = Math.ceil(PLAYER.shoot.cooldown / FIXED_DT) + 1;
    for (let i = 0; i <= cooldownSteps; i++) step(both, withInput({ attackHeld: true }), FIXED_DT);
    const shots = both.projectiles.filter((pr) => pr.owner === "player");
    expect(shots.length, "2 発撃った").toBe(2);
    const [a, b] = shots;
    if (!a || !b) throw new Error("弾が足りない");
    expect(Math.sign(a.pos.y - both.player.body.pos.y), "1 発目と 2 発目は逆の銃口").not.toBe(Math.sign(b.pos.y - both.player.body.pos.y));
  });

  it("二丁拳銃はダッシュ中の押下で反転撃ち（ダッシュ攻撃）を出す", () => {
    const state = arena(5, { moveset: "gunner" });
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    let struck = false;
    for (let i = 0; i < 30 && !struck; i++) {
      step(state, withInput({}), FIXED_DT);
      struck = state.player.dashStrike;
    }
    expect(struck, "ダッシュの後に反転撃ちが出た").toBe(true);
  });

  it("ジョブ固有の派生: 剣士は左左左右で固有の派生を振る（見習いは出ない）", () => {
    const state = arena(5);
    state.job = "swordsman";
    pressJobSequence(state);
    untilBranch(state);
    expect(branchKeyOf(state)).toBe("job.swordsman");

    const none = arena(5);
    pressJobSequence(none);
    untilBranch(none);
    expect(branchKeyOf(none), "見習いにはジョブの派生が無い").not.toBe("job.none");
  });

  it("ジョブの派生と同じ入力の派生を武器種が持つなら武器種が優先される（双剣の交差斬り）", () => {
    const state = arena(5, { moveset: "twinBlades" });
    state.job = "shadow";
    pressJobSequence(state);
    untilBranch(state);
    expect(branchKeyOf(state)).toBe("crossing");
  });

  it("武器種の rules は持っている武器種のものだけが集まる", () => {
    const hammer = arena(5, { moveset: "hammer" });
    const hammerIds = collectRules(hammer).map((r) => r.id);
    expect(hammerIds.some((id) => id.startsWith("player:moveset.hammer:")), "戦鎚の固有効果").toBe(true);
    expect(hammerIds.some((id) => id.startsWith("player:moveset.axe:")), "斧の固有効果は入らない").toBe(false);
    const sword = arena(5);
    expect(collectRules(sword).some((r) => r.id.startsWith("player:moveset.")), "剣は固有効果なし").toBe(false);
  });
});
