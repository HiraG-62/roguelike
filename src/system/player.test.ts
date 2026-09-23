import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import type { StatusEffect } from "../core/status";
import { MANA, PLAYER, TRIGGER } from "../data/tuning";
import { damagePlayer } from "./combat";
import { KS } from "./keystones";
import { fireTrigger } from "./triggers";
import { burstDamage, dashCooldownTime, isPlayerStaggered, shotDamage } from "./player";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 無効化手段の整理と手触り（docs/COMBAT_DESIGN.md C 章・段階 1 の L4）。
 * ダッシュ無敵の短縮、弾斬り、近接のマナ回収、プレイヤーの怯み、バースト・トリガーの無敵
 */

/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
/** 近接 1 振りを振り切るまでのステップ数 */
const SWING_STEPS = 20;
/** 予備動作を十分長く保つ */
const LONG_WINDUP = 10;
/** 1 振りで同時に当てる敵の数（回収上限を超える数） */
const CROWD = MANA.meleeTargetCap + 1;
const STAGGER_TIME = 1;

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
    expect(state.player.mana, "1 段目の回収量").toBeCloseTo(MANA.onMelee[0]);
  });

  it("カウンターヒットなら倍", () => {
    const state = manaArena();
    const e = passive(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    e.phaseTimer = LONG_WINDUP;
    swing(state);
    expect(state.player.mana, "カウンターの回収量").toBeCloseTo(MANA.onMelee[0] * MANA.onCounterMul);
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
    expect(state.player.mana, "上限ぶんだけ回収").toBeCloseTo(MANA.onMelee[0] * MANA.meleeTargetCap);
  });
});

describe("プレイヤーの怯み（被弾硬直）", () => {
  it("怯み中は近接・ダッシュ・射撃・バーストが出ない", () => {
    const state = arena();
    staggerPlayer(state);
    state.player.energy = PLAYER.special.cost;
    expect(isPlayerStaggered(state.player)).toBe(true);
    step(state, withInput({ attackPressed: true, dashPressed: true, shootHeld: true, specialPressed: true }), FIXED_DT);
    const p = state.player;
    expect(p.attack.phase, "近接が出ない").toBe("none");
    expect(p.dashTimer, "ダッシュしない").toBe(0);
    expect(state.projectiles.filter((pr) => pr.owner === "player"), "射撃しない").toHaveLength(0);
    expect(p.energy, "バーストを撃たない").toBe(PLAYER.special.cost);
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

describe("射撃・バーストの威力と怯み値", () => {
  it("射撃弾は係数で評価した威力と怯み値を持つ", () => {
    const state = arena();
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    const shot = state.projectiles.find((pr) => pr.owner === "player");
    if (!shot) throw new Error("射撃弾が出ていない");
    expect(shot.damage, "基礎値の射撃威力").toBeCloseTo(shotDamage(state.stats));
    expect(shot.poise, "射撃の怯み値").toBeCloseTo(PLAYER.shoot.poise * state.stats.poiseDamageMul);
  });

  it("バーストは burstDamageMul を掛け、無敵は 0.15 秒", () => {
    const state = arena(5, { burstDamageMul: 2 });
    expect(burstDamage(state.stats), "バースト威力 × burstDamageMul").toBeCloseTo(burstDamage({ ...state.stats, burstDamageMul: 1 }) * 2);
    state.player.energy = PLAYER.special.cost;
    step(state, withInput({ specialPressed: true }), FIXED_DT);
    expect(state.player.energy, "ゲージを消費した").toBe(0);
    expect(state.player.invulnTimer, "バースト後の無敵").toBeCloseTo(PLAYER.special.invuln);
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
