import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { type StatusApply, type StatusBag, createStatusBag } from "../core/status";
import { MANA, STATUS } from "../data/tuning";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { updateEnemies } from "./enemies";
import { spawnBomb, updateHazards } from "./hazards";
import { isStaggered } from "./poise";
import { updateProjectiles } from "./projectiles";
import {
  type StatusTarget,
  applyBurn,
  applyChill,
  applyStatus,
  chillFactor,
  findStatus,
  hasStatus,
  inflictOnPlayer,
  playerCanCast,
  statusStacks,
  updateStatusEffects,
} from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { step } from "../core/game";

const BIG_HP = 100000;
const PLAYER: StatusTarget = { kind: "player" };

function bagWith(effects: StatusBag["effects"]): StatusBag {
  return { ...createStatusBag(), effects };
}

function sturdy(state: GameState, key: string, dx = 30, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

function on(e: Enemy): StatusTarget {
  return { kind: "enemy", enemy: e };
}

function apply(kind: StatusApply["kind"], duration: number, stacks = 1, potency = 0): StatusApply {
  return { kind, stacks, duration, potency };
}

describe("読み出し", () => {
  it("hasStatus / statusStacks は残り時間のある効果だけを見る", () => {
    const bag = bagWith([
      { kind: "poison", stacks: 3, time: 2, maxTime: 5, potency: 0, source: "enemy", acc: 0, tick: 0 },
      { kind: "burn", stacks: 1, time: 0, maxTime: 3, potency: 4, source: "player", acc: 0, tick: 0 },
    ]);
    expect(hasStatus(bag, "poison")).toBe(true);
    expect(statusStacks(bag, "poison")).toBe(3);
    expect(hasStatus(bag, "burn"), "残り 0 秒は付いていない扱い").toBe(false);
    expect(statusStacks(bag, "burn")).toBe(0);
    expect(hasStatus(bag, "stagger")).toBe(false);
  });

  it("新しい敵とプレイヤーは空の StatusBag を持つ", () => {
    const state = createGame(1);
    expect(state.player.status).toEqual(createStatusBag());
    for (const e of state.enemies) {
      expect(e.status, `敵 ${e.id} の StatusBag`).toEqual(createStatusBag());
      expect(e.poise.damage, `敵 ${e.id} の怯み蓄積`).toBe(0);
    }
  });
});

describe("スタック規則（E-2）", () => {
  it("冷気は付与ごとに +1、敵は 5 で凍結に変わる（冷気は消える）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < 4; i++) applyChill(state, e, 0, STATUS.chill.duration);
    expect(statusStacks(e.status, "chill")).toBe(4);
    expect(chillFactor(e)).toBeCloseTo(1 - STATUS.chill.slowPerStack * 4, 5);
    applyChill(state, e, 0, STATUS.chill.duration);
    expect(hasStatus(e.status, "chill")).toBe(false);
    expect(findStatus(e.status, "freeze")?.time).toBeCloseTo(STATUS.freeze.duration, 5);
  });

  it("冷気の遅さは付与時の値（既存の chillSlow）が下限", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyChill(state, e, 0.5, 2);
    expect(chillFactor(e)).toBeCloseTo(0.5, 5);
  });

  it("プレイヤーの冷気は 3、毒は 3 スタックまで。敵の毒は 5 まで", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < 8; i++) {
      applyStatus(state, PLAYER, apply("chill", 2), "enemy");
      applyStatus(state, PLAYER, apply("poison", 5), "enemy");
      applyStatus(state, on(e), apply("poison", 5), "player");
    }
    expect(statusStacks(state.player.status, "chill")).toBe(STATUS.chill.playerMaxStacks);
    expect(statusStacks(state.player.status, "poison")).toBe(STATUS.poison.playerMaxStacks);
    expect(statusStacks(e.status, "poison")).toBe(STATUS.poison.maxStacks);
  });

  it("感電は 3 で麻痺に変わり、麻痺が解けると感電免疫", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < 3; i++) applyStatus(state, on(e), apply("shock", STATUS.shock.duration), "player");
    expect(hasStatus(e.status, "shock")).toBe(false);
    expect(hasStatus(e.status, "paralyze")).toBe(true);
    updateStatusEffects(state, STATUS.paralyze.duration + 0.01);
    expect(applyStatus(state, on(e), apply("shock", 1), "player"), "感電免疫").toBe(false);
    updateStatusEffects(state, STATUS.paralyze.shockImmuneAfter);
    expect(applyStatus(state, on(e), apply("shock", 1), "player")).toBe(true);
  });

  it("燃焼は強い dps を採用し、持続は延長する。出血は 3 スタックまで", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyBurn(state, e, 3, 1);
    applyBurn(state, e, 8, 3);
    applyBurn(state, e, 5, 2);
    expect(findStatus(e.status, "burn")?.potency).toBe(8);
    expect(findStatus(e.status, "burn")?.time).toBe(3);
    for (let i = 0; i < 5; i++) applyStatus(state, on(e), apply("bleed", 4, 1, 1), "player");
    expect(statusStacks(e.status, "bleed")).toBe(STATUS.bleed.maxStacks);
  });

  it("脆弱・弱体は重ねず持続だけ延ばす。怯み・凍結・麻痺・恐怖は付いている間は付け直せない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("vulnerable", 4), "player");
    applyStatus(state, on(e), apply("vulnerable", 2), "player");
    expect(findStatus(e.status, "vulnerable")?.time).toBe(4);
    expect(statusStacks(e.status, "vulnerable")).toBe(1);
    expect(applyStatus(state, on(e), apply("paralyze", 0.3), "player")).toBe(true);
    expect(applyStatus(state, on(e), apply("paralyze", 0.3), "player"), "麻痺中に麻痺は付かない").toBe(false);
  });
});

describe("免疫", () => {
  it("凍結が解けると冷気免疫 3 秒、恐怖が解けると恐怖免疫 6 秒", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    applyStatus(state, on(e), apply("fear", 0.5), "player");
    updateStatusEffects(state, STATUS.freeze.duration + 0.01);
    expect(applyStatus(state, on(e), apply("chill", 2), "player"), "冷気免疫").toBe(false);
    expect(applyStatus(state, on(e), apply("fear", 0.5), "player"), "恐怖免疫").toBe(false);
    updateStatusEffects(state, STATUS.freeze.chillImmuneAfter);
    expect(applyStatus(state, on(e), apply("chill", 2), "player")).toBe(true);
    expect(applyStatus(state, on(e), apply("fear", 0.5), "player"), "恐怖免疫は 6 秒").toBe(false);
  });

  it("ボスは凍結・恐怖を受けず、冷気の遅さは bossMaxSlow で止まる。麻痺は短い", () => {
    const state = arena();
    const boss = sturdy(state, "kingSlime", 80);
    for (let i = 0; i < 6; i++) applyChill(state, boss, 0, 2);
    expect(hasStatus(boss.status, "freeze")).toBe(false);
    expect(chillFactor(boss)).toBeCloseTo(1 - STATUS.chill.bossMaxSlow, 5);
    expect(applyStatus(state, on(boss), apply("fear", 2), "player")).toBe(false);
    applyStatus(state, on(boss), apply("paralyze", STATUS.paralyze.duration), "player");
    expect(findStatus(boss.status, "paralyze")?.time).toBeCloseTo(STATUS.paralyze.bossDuration, 5);
  });

  it("プレイヤーには凍結・麻痺・恐怖が付かない", () => {
    const state = arena();
    for (const kind of ["freeze", "paralyze", "fear"] as const) {
      expect(applyStatus(state, PLAYER, apply(kind, 1), "enemy"), kind).toBe(false);
    }
  });

  it("鬼火の恐怖は 2 倍の時間効く", () => {
    const state = arena();
    const e = sturdy(state, "wisp");
    applyStatus(state, on(e), apply("fear", STATUS.fear.duration), "player");
    expect(findStatus(e.status, "fear")?.time).toBeCloseTo(STATUS.fear.duration * STATUS.fear.wispMul, 5);
  });
});

describe("相互作用（E-3）", () => {
  it("燃焼中に冷気: 両方消え、燃焼の残りダメージの 50% を即時に与える（蒸発）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyBurn(state, e, 10, 3);
    const before = e.hp;
    applyChill(state, e, 0, 2);
    expect(hasStatus(e.status, "burn")).toBe(false);
    expect(hasStatus(e.status, "chill")).toBe(false);
    expect(before - e.hp).toBe(Math.round(10 * 3 * STATUS.vaporizeRatio));
  });

  it("冷気中に燃焼: 同じく蒸発する", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyChill(state, e, 0, 2);
    const before = e.hp;
    applyBurn(state, e, 10, 3);
    expect(hasStatus(e.status, "burn") || hasStatus(e.status, "chill")).toBe(false);
    expect(before - e.hp).toBe(Math.round(10 * 3 * STATUS.vaporizeRatio));
  });

  it("凍結中に燃焼: 凍結が解け（砕きなし）、燃焼は付く", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    const before = e.hp;
    applyBurn(state, e, 4, 3);
    expect(hasStatus(e.status, "freeze")).toBe(false);
    expect(hasStatus(e.status, "burn")).toBe(true);
    expect(e.hp, "砕きのダメージは無い").toBe(before);
  });

  it("感電 + 冷気: 感電の周期ごとに冷気 +1", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("shock", STATUS.shock.duration), "player");
    applyChill(state, e, 0, 2);
    updateStatusEffects(state, STATUS.shock.interval);
    expect(statusStacks(e.status, "chill")).toBe(2);
  });

  it("毒 + 出血: 毒がある間は出血ダメージ × 1.5", () => {
    const state = arena();
    const moved = 100;
    const plain = sturdy(state, "golem", 30, -40);
    const poisoned = sturdy(state, "golem", 30, 40);
    // 毒そのものの継続ダメージが混ざらないよう最大 HP を小さくする
    for (const e of [plain, poisoned]) e.maxHp = 1;
    applyStatus(state, on(poisoned), apply("poison", 5), "player");
    for (const e of [plain, poisoned]) applyStatus(state, on(e), apply("bleed", 4, 1, 1), "player");
    for (const e of [plain, poisoned]) e.body.pos.x += moved;
    updateStatusEffects(state, FIXED_DT);
    const expected = (moved / STATUS.bleed.distance) * 1;
    expect(BIG_HP - plain.hp).toBe(expected);
    expect(BIG_HP - poisoned.hp).toBe(expected * STATUS.bleed.poisonMul);
  });

  it("脆弱 + 怯み: 乗算（× 1.2 × damageVsStaggeredMul）", () => {
    const state = arena(5, { damageVsStaggeredMul: 2 });
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("stagger", 1), "player");
    applyStatus(state, on(e), apply("vulnerable", 4), "player");
    const out = rollOutgoing(state, e, 10, "melee");
    const before = e.hp;
    damageEnemy(state, e, out.amount, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(before - e.hp).toBe(Math.round(10 * 2 * STATUS.vulnerable.mul));
  });

  it("恐怖中に怯み: 怯みが優先し、恐怖の残り時間は止まる", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("fear", 1), "player");
    applyStatus(state, on(e), apply("stagger", 0.5), "player");
    updateStatusEffects(state, 0.3);
    expect(findStatus(e.status, "fear")?.time).toBe(1);
    updateStatusEffects(state, 0.3);
    updateStatusEffects(state, 0.3);
    expect(findStatus(e.status, "fear")?.time).toBeCloseTo(0.7, 5);
  });

  it("沈黙を予備動作中の浮遊眼に: 予備動作を取り消す。沈黙中は射撃の予備動作に入らない", () => {
    const state = arena();
    const e = sturdy(state, "eye", 60);
    e.phase = "windup";
    e.phaseTimer = 1;
    applyStatus(state, on(e), apply("silence", STATUS.silence.enemyDuration), "player");
    expect(e.phase).toBe("chase");
    e.attackCooldown = 0;
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "沈黙中は撃てない").toBe("chase");
  });

  it("凍結中に被弾: 砕き（与ダメ × 1.5、怯み値 +20、凍結は解除）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    const before = e.hp;
    damageEnemy(state, e, 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(before - e.hp).toBe(10 * STATUS.freeze.shatterDamageMul);
    expect(e.poise.damage).toBe(STATUS.freeze.shatterPoise);
    expect(hasStatus(e.status, "freeze")).toBe(false);
    expect(state.texts.some((t) => t.text === "砕き")).toBe(true);
  });
});

describe("拘束上限", () => {
  it("行動停止系は直近 3 秒に合計 2 秒まで。超える付与は切り詰め、使い切ったら付かない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("freeze", 1.2), "player");
    applyStatus(state, on(e), apply("stagger", 1.0), "player");
    expect(findStatus(e.status, "stagger")?.time, "残り 0.8 秒に切り詰め").toBeCloseTo(STATUS.ccBudget - 1.2, 5);
    expect(applyStatus(state, on(e), apply("paralyze", 0.5), "player"), "使い切った").toBe(false);
    expect(isStaggered(e)).toBe(true);
    updateStatusEffects(state, STATUS.ccWindow);
    expect(applyStatus(state, on(e), apply("paralyze", 0.5), "player"), "窓が明けたら付く").toBe(true);
  });
});

describe("敵 → プレイヤー（E-4）", () => {
  it("スライムの接触の毒は深度 4 から", () => {
    const state = arena();
    const source = { defKey: "slime", roomIndex: 0 };
    inflictOnPlayer(state, source, "contact");
    expect(hasStatus(state.player.status, "poison")).toBe(false);
    state.depth = 4;
    inflictOnPlayer(state, source, "contact");
    expect(statusStacks(state.player.status, "poison")).toBe(1);
  });

  it("猪の突進は出血 2 と怯み、攻撃の種類が違えば付かない", () => {
    const state = arena();
    inflictOnPlayer(state, { defKey: "boar", roomIndex: 0 }, "bullet");
    expect(state.player.status.effects).toHaveLength(0);
    inflictOnPlayer(state, { defKey: "boar", roomIndex: 0 }, "contact");
    expect(statusStacks(state.player.status, "bleed")).toBe(2);
    expect(hasStatus(state.player.status, "stagger")).toBe(true);
    expect(playerCanCast(state), "怯み中はスキル不可").toBe(false);
  });

  it("持続は statusTakenMul（体力）で短くなる", () => {
    const state = arena(5, { statusTakenMul: 0.5 });
    inflictOnPlayer(state, { defKey: "boneLord", roomIndex: 0 }, "bullet");
    expect(findStatus(state.player.status, "weaken")?.time).toBeCloseTo(3 * 0.5, 5);
  });

  it("爆弾ゴブリンの爆弾で脆弱（投げた本人が倒れていても種類で引く）", () => {
    const state = arena();
    const bomber = placeEnemy(state, "bomber", 60);
    spawnBomb(state, { ...state.player.body.pos }, 5, bomber.id);
    state.enemies = [];
    updateHazards(state, 5);
    expect(hasStatus(state.player.status, "vulnerable")).toBe(true);
  });

  it("鬼火に触れると燃焼し、燃焼は無敵を作らず HP を削る", () => {
    const state = arena();
    const wisp = placeEnemy(state, "wisp", 0);
    wisp.phase = "chase";
    wisp.attackCooldown = 99;
    updateEnemies(state, FIXED_DT);
    expect(hasStatus(state.player.status, "burn")).toBe(true);
    state.player.invulnTimer = 0;
    const hp = state.player.hp;
    state.enemies = [];
    updateStatusEffects(state, 1);
    expect(hp - state.player.hp).toBe(3);
    expect(state.player.invulnTimer).toBe(0);
  });

  it("プレイヤーの脆弱で被ダメ × 1.2、敵の弱体で与ダメ × 0.75", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 60);
    applyStatus(state, PLAYER, apply("vulnerable", 4), "enemy");
    let hp = state.player.hp;
    damagePlayer(state, 10, e.body.pos, e);
    expect(hp - state.player.hp).toBe(12);
    state.player.invulnTimer = 0;
    state.player.status.effects = [];
    applyStatus(state, on(e), apply("weaken", 4), "player");
    hp = state.player.hp;
    damagePlayer(state, 10, e.body.pos, e);
    expect(hp - state.player.hp).toBe(Math.round(10 * (1 - STATUS.weaken.mul)));
  });

  it("プレイヤーが弱体なら与ダメ × 0.75、沈黙ならスキル不可", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, PLAYER, apply("weaken", 3), "enemy");
    expect(rollOutgoing(state, e, 20, "melee").amount).toBe(15);
    applyStatus(state, PLAYER, apply("silence", 1), "enemy");
    expect(playerCanCast(state)).toBe(false);
  });
});

describe("継続ダメージ", () => {
  it("毒は最大 HP × 1% × スタック / 秒（ボスは 0.3%）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const boss = sturdy(state, "boneLord", 80);
    for (const t of [e, boss]) applyStatus(state, on(t), apply("poison", 5, 2), "player");
    updateStatusEffects(state, 1);
    expect(BIG_HP - e.hp).toBe(BIG_HP * STATUS.poison.hpRatioPerSec * 2);
    expect(BIG_HP - boss.hp).toBe(BIG_HP * STATUS.poison.bossHpRatioPerSec * 2);
  });
});

describe("on-hit と性質の statusProcs", () => {
  it("statusProcs は on の種類が合う命中でだけ判定する", () => {
    const procs = [{ kind: "vulnerable" as const, chance: 1, stacks: 1, duration: 4, potency: 0, on: "melee" as const }];
    const state = arena(5, { statusProcs: procs });
    const e = sturdy(state, "golem");
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(hasStatus(e.status, "vulnerable")).toBe(false);
    updateStatusEffects(state, STATUS.onHitIcd);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });
});

describe("マナの回収（B-1）", () => {
  it("撃破で onKill、JUST 回避で onJust", () => {
    const state = arena();
    state.player.mana = 0;
    const e = placeEnemy(state, "slime", 60);
    damageEnemy(state, e, e.hp, { x: 1, y: 0 }, 0);
    expect(state.player.mana).toBe(MANA.onKill);
    const p = state.player;
    p.dashTimer = 0.1;
    p.invulnTimer = 0.1;
    p.dodgedThisDash = false;
    expect(damagePlayer(state, 10, { x: 0, y: 0 })).toBe("dodged");
    expect(state.player.mana).toBe(MANA.onKill + MANA.onJust);
  });

  it("射撃弾の命中 1 体ごとに onShot、1 回の射撃で shotVolleyCap 回まで", () => {
    const state = arena();
    state.player.mana = 0;
    const targets = [-60, -30, 30, 60, 90].map((dy) => sturdy(state, "golem", 60, dy));
    for (const t of targets) {
      state.projectiles.push({
        id: state.nextId++,
        owner: "player",
        pos: { ...t.body.pos },
        vel: { x: 1, y: 0 },
        radius: 2,
        damage: 1,
        life: 1,
        color: "#fff",
        kind: "ranged",
        hitIds: new Set(),
        pierceLeft: 0,
      });
    }
    updateProjectiles(state, FIXED_DT);
    expect(state.player.mana).toBeCloseTo(MANA.onShot * MANA.shotVolleyCap, 5);
  });
});

describe("決定性", () => {
  it("同じ seed と入力なら、状態異常と怯みを含めて同じ結果になる", () => {
    function run(): string {
      const state = arena(11, { burnChance: 0.5, burnDps: 6, chillChance: 0.5, chillSlow: 0.2, shockChance: 0.5, shockDamage: 4 });
      for (const [dx, dy] of [[14, 0], [20, 12], [20, -12]] as const) {
        const e = placeEnemy(state, "slime", dx, dy);
        e.hp = 500;
        e.maxHp = 500;
      }
      for (let i = 0; i < 240; i++) step(state, withInput({ attackPressed: i % 12 === 0 }), FIXED_DT);
      return JSON.stringify(
        state.enemies.map((e) => ({ hp: e.hp, poise: e.poise, status: e.status, phase: e.phase })),
      );
    }
    expect(run()).toBe(run());
  });
});
