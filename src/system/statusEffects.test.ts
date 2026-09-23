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
  applyOnHitStatus,
  applyStatus,
  chillFactor,
  enemyDamageMul,
  enemyStatusTakenMul,
  findStatus,
  goodStatusCount,
  hasStatus,
  inflictOnPlayer,
  lastExpired,
  onPlayerHurtStatus,
  playerCanCast,
  playerPoiseDealtMul,
  playerStatusMoveMul,
  playerStatusOutgoingMul,
  playerStatusTakenMul,
  statusCount,
  statusStacks,
  statusTimeLeft,
  totalStacks,
  updateStatusEffects,
} from "./statusEffects";
import { TRAIT_COLORS } from "../loot/types";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { step } from "../core/game";
import { descend } from "./floor";

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

  it("地形・伝播（env）の行動停止も上限に数え、自傷（self）だけが上限の外", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("freeze", STATUS.ccBudget), "env");
    expect(applyStatus(state, on(e), apply("paralyze", 0.5), "env"), "env で使い切った後は env も付かない").toBe(false);
    expect(applyStatus(state, on(e), apply("paralyze", 0.5), "player"), "player も付かない").toBe(false);
    expect(applyStatus(state, on(e), apply("stagger", 0.5), "self"), "自傷の怯みは入る").toBe(true);
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

  it("性質由来の毒は potency を割合として使い、霊力（statusPotencyMul）が掛かる", () => {
    const state = arena(5, { statusPotencyMul: 2 });
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("poison", 5, 1, STATUS.poison.hpRatioPerSec), "player");
    updateStatusEffects(state, 1);
    expect(BIG_HP - e.hp).toBe(BIG_HP * STATUS.poison.hpRatioPerSec * 2);
  });
});

describe("出血と階の移動", () => {
  it("出血中に階を降りても、新しい階への瞬間移動は移動距離に数えない", () => {
    const state = arena();
    state.player.hp = state.player.maxHp;
    applyStatus(state, PLAYER, apply("bleed", 10, 3, 1), "enemy");
    const hp = state.player.hp;
    descend(state);
    updateStatusEffects(state, FIXED_DT);
    expect(hasStatus(state.player.status, "bleed"), "出血は残る").toBe(true);
    expect(state.player.hp, "動いていないので削れない").toBe(hp);
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

  it("静寂の誓いでは射撃の命中でマナが戻らない", () => {
    const state = arena(5, { keystones: ["ks_silentVow"] });
    state.player.mana = 0;
    const t = sturdy(state, "golem", 60);
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
    updateProjectiles(state, FIXED_DT);
    expect(state.player.mana).toBe(0);
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

// -----------------------------------------------------------------------------
// 2026-09-24 追加の状態異常（docs/ideas/status-and-terrain.md 1・6 章）
// -----------------------------------------------------------------------------

describe("追加の状態異常: 付く相手", () => {
  it("良い状態は敵に付かず、敵専用の印（烙印・宣告・彩痕…）はプレイヤーに付かない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (const kind of ["haste", "harden", "wrath", "fury", "charged"] as const) {
      expect(applyStatus(state, on(e), apply(kind, 2), "player"), `${kind} は敵に付かない`).toBe(false);
      expect(applyStatus(state, PLAYER, apply(kind, 2), "player"), `${kind} はプレイヤーに付く`).toBe(true);
    }
    const enemyOnly = ["brand", "broken", "doom", "siphon", "hue", "scorch", "blaze", "venom", "hemorrhage", "encase", "exposed", "enfeeble"] as const;
    for (const kind of enemyOnly) {
      expect(applyStatus(state, PLAYER, apply(kind, 2), "enemy"), `${kind} はプレイヤーに付かない`).toBe(false);
    }
  });

  it("良い状態の持続は体力（statusTakenMul）で縮まない。悪い状態は縮む", () => {
    const state = arena(5, { statusTakenMul: 0.5 });
    applyStatus(state, PLAYER, apply("haste", 3), "player");
    applyStatus(state, PLAYER, apply("wet", 4), "env");
    expect(findStatus(state.player.status, "haste")?.time).toBe(3);
    expect(findStatus(state.player.status, "wet")?.time).toBe(2);
  });
});

describe("追加の状態異常: 効果", () => {
  it("濡れは 3 まで積み、3 で浸水（移動と行動が遅い）が上乗せされる", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < 5; i++) applyStatus(state, on(e), apply("wet", STATUS.wet.duration), "env");
    expect(statusStacks(e.status, "wet")).toBe(STATUS.wet.maxStacks);
    expect(hasStatus(e.status, "soaked")).toBe(true);
    expect(chillFactor(e)).toBeCloseTo(1 - STATUS.soaked.slow, 5);
  });

  it("加速は移動 ×1.2、硬化は移動 ×0.85・被ダメ ×0.8・敵の攻撃で怯まない", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("haste", 3), "player");
    expect(playerStatusMoveMul(state)).toBeCloseTo(STATUS.haste.moveMul, 5);
    state.player.status.effects = [];
    applyStatus(state, PLAYER, apply("harden", 2), "player");
    expect(playerStatusMoveMul(state)).toBeCloseTo(STATUS.harden.moveMul, 5);
    expect(playerStatusTakenMul(state)).toBeCloseTo(STATUS.harden.takenMul, 5);
    expect(applyStatus(state, PLAYER, apply("stagger", 0.3), "enemy"), "硬化中は怯まない").toBe(false);
  });

  it("氷鎧: 硬化中は冷気 1 スタックごとに被ダメがさらに下がる", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("harden", 2), "player");
    applyStatus(state, PLAYER, apply("chill", 2, 2), "enemy");
    expect(playerStatusTakenMul(state)).toBeCloseTo(STATUS.harden.takenMul - STATUS.harden.iceArmorPerChill * 2, 5);
  });

  it("腐食: プレイヤーは被ダメ +3% × スタック。敵は毒の上限が腐食ぶん伸び（溶解）、出血の上限 +2（裂傷）", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("corrode", 6, 2), "env");
    expect(playerStatusTakenMul(state)).toBeCloseTo(1 + STATUS.corrode.playerTakenPerStack * 2, 5);
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("corrode", 6, 2), "player");
    for (let i = 0; i < 10; i++) {
      applyStatus(state, on(e), apply("poison", 5), "player");
      applyStatus(state, on(e), apply("bleed", 4, 1, 1), "player");
    }
    expect(statusStacks(e.status, "poison")).toBe(STATUS.poison.maxStacks + 2);
    expect(statusStacks(e.status, "bleed")).toBe(STATUS.bleed.maxStacks + STATUS.lacerate.extraStacks);
  });

  it("無力（弱体の昇華）の敵の与ダメは ×0.5", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("enfeeble", 4), "player");
    expect(enemyDamageMul(e)).toBe(STATUS.enfeeble.mul);
  });

  it("露呈は脆弱込みで被ダメ ×1.4（脆弱の差分だけを返す）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("exposed", 4), "player");
    expect(enemyStatusTakenMul(state, e)).toBeCloseTo(STATUS.exposed.mul, 5);
    applyStatus(state, on(e), apply("vulnerable", 4), "player");
    expect(enemyStatusTakenMul(state, e) * STATUS.vulnerable.mul).toBeCloseTo(STATUS.exposed.mul, 5);
  });

  it("怒気は与える怯み値 +10% × スタック。5 で激昂に変わる（怒気は消える）", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("wrath", 6, 2), "player");
    expect(playerPoiseDealtMul(state)).toBeCloseTo(1 + STATUS.wrath.poisePerStack * 2, 5);
    applyStatus(state, PLAYER, apply("wrath", 6, 3), "player");
    expect(hasStatus(state.player.status, "wrath")).toBe(false);
    expect(hasStatus(state.player.status, "fury")).toBe(true);
    expect(playerPoiseDealtMul(state)).toBeCloseTo(STATUS.fury.poiseMul, 5);
    expect(playerStatusOutgoingMul(state)).toBeCloseTo(STATUS.fury.damageMul, 5);
    expect(playerStatusTakenMul(state)).toBeCloseTo(STATUS.fury.takenMul, 5);
  });

  it("逆上: 怒気が付いている間に怯むと怒気 +2。怒気が無ければ何も起きない。被弾でも +1", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("stagger", 0.3), "enemy");
    expect(hasStatus(state.player.status, "wrath"), "怒気は自然には付かない").toBe(false);
    state.player.status.effects = [];
    applyStatus(state, PLAYER, apply("wrath", 6, 1), "player");
    applyStatus(state, PLAYER, apply("stagger", 0.3), "enemy");
    expect(statusStacks(state.player.status, "wrath")).toBe(1 + STATUS.wrath.onStagger);
    onPlayerHurtStatus(state);
    expect(statusStacks(state.player.status, "wrath")).toBe(1 + STATUS.wrath.onStagger + STATUS.wrath.onHurt);
  });

  it("帯電: 近接の命中で 1 回ぶん使い、別の敵へ連鎖雷・当てた敵に感電", () => {
    const state = arena();
    const a = sturdy(state, "golem", 30);
    const b = sturdy(state, "golem", 30, 30);
    applyStatus(state, PLAYER, apply("charged", 5, 2, 10), "player");
    applyOnHitStatus(state, a, { kind: "melee" });
    expect(statusStacks(state.player.status, "charged")).toBe(1);
    expect(b.hp, "連鎖雷が隣へ飛ぶ").toBeLessThan(BIG_HP);
    expect(hasStatus(a.status, "shock")).toBe(true);
  });

  it("加速は攻撃が当たるたびに延びる（上限 maxTime）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, PLAYER, apply("haste", 1), "player");
    applyOnHitStatus(state, e, { kind: "melee" });
    expect(findStatus(state.player.status, "haste")?.time).toBeCloseTo(1 + STATUS.haste.extendOnHit, 5);
    for (let i = 0; i < 30; i++) applyOnHitStatus(state, e, { kind: "melee" });
    expect(findStatus(state.player.status, "haste")?.time).toBe(STATUS.haste.maxTime);
  });

  it("烙印は射撃・スキルの命中で全スタックを起爆する（近接では起爆しない）。ダメージは次のステップで入る", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("brand", 4, 3), "player");
    applyOnHitStatus(state, e, { kind: "melee" });
    expect(statusStacks(e.status, "brand"), "近接では起爆しない").toBe(3);
    applyOnHitStatus(state, e, { kind: "ranged" });
    expect(hasStatus(e.status, "brand")).toBe(false);
    expect(e.hp, "on-hit の最中はまだ減らない").toBe(BIG_HP);
    updateStatusEffects(state, FIXED_DT);
    expect(BIG_HP - e.hp).toBe(3 * STATUS.brand.damagePerStack);
    expect(e.poise.damage).toBeCloseTo(3 * STATUS.brand.poisePerStack, 5);
  });

  it("吸魔: この敵への命中でマナが戻り、沈黙中は倍（魔断）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    state.player.mana = 0;
    applyStatus(state, on(e), apply("siphon", 5), "player");
    applyOnHitStatus(state, e, { kind: "melee" });
    expect(state.player.mana).toBeCloseTo(STATUS.siphon.manaPerHit, 5);
    applyStatus(state, on(e), apply("silence", 3), "player");
    applyOnHitStatus(state, e, { kind: "melee" });
    expect(state.player.mana).toBeCloseTo(STATUS.siphon.manaPerHit * (1 + STATUS.siphon.silencedMul), 5);
  });

  it("宣告: 切れた瞬間、付与中に減った HP の 30%（脆弱中は 50%）をまとめて与える", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    const b = sturdy(state, "golem", 30, 40);
    applyStatus(state, on(a), apply("doom", 1), "player");
    applyStatus(state, on(b), apply("doom", 1), "player");
    applyStatus(state, on(b), apply("vulnerable", 4), "player");
    a.hp -= 100;
    b.hp -= 100;
    updateStatusEffects(state, 1.01);
    expect(BIG_HP - 100 - a.hp).toBe(Math.round(100 * STATUS.doom.ratio));
    expect(BIG_HP - 100 - b.hp).toBe(Math.round(Math.round(100 * STATUS.doom.vulnerableRatio) * STATUS.vulnerable.mul));
  });

  it("彩痕: 共鳴と同じ色なら被ダメ ×1.15。対応する状態異常が入ると色爆（蒼 = 冷気 +2）で彩痕は消える", () => {
    const state = arena();
    state.stats.resonance = { ...state.stats.resonance, kind: "dominant", colors: ["azure"] };
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("hue", 6, 1, TRAIT_COLORS.indexOf("azure")), "player");
    expect(enemyStatusTakenMul(state, e)).toBeCloseTo(STATUS.hue.takenMul, 5);
    applyChill(state, e, 0, 2);
    expect(hasStatus(e.status, "hue")).toBe(false);
    expect(statusStacks(e.status, "chill")).toBe(1 + STATUS.hue.burstChill);
  });
});

describe("状態異常を参照する語彙（6 章）", () => {
  it("異常数・総スタックは悪い状態だけを数え、良い状態・怯み・堅守は数えない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("poison", 5, 3), "player");
    applyStatus(state, on(e), apply("bleed", 4, 2, 1), "player");
    applyStatus(state, on(e), apply("stagger", 0.5), "player");
    expect(statusCount(e.status)).toBe(2);
    expect(totalStacks(e.status)).toBe(5);
    applyStatus(state, PLAYER, apply("haste", 3), "player");
    applyStatus(state, PLAYER, apply("charged", 3, 2), "player");
    expect(goodStatusCount(state.player.status)).toBe(2);
    expect(statusCount(state.player.status)).toBe(0);
  });

  it("残り時間は指定した種類か、悪い状態の最長", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("poison", 5), "player");
    applyStatus(state, on(e), apply("vulnerable", 2), "player");
    expect(statusTimeLeft(e.status, "vulnerable")).toBe(2);
    expect(statusTimeLeft(e.status)).toBe(5);
    expect(statusTimeLeft(e.status, "burn")).toBe(0);
  });

  it("直前に消えた状態異常は種類と理由を返し、lastEndedWindow 秒を過ぎると返さない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("vulnerable", 0.5), "player");
    updateStatusEffects(state, 0.6);
    expect(lastExpired(state, e.status)).toMatchObject({ kind: "vulnerable", cause: "expire" });
    state.tick += Math.ceil(STATUS.lastEndedWindow / FIXED_DT) + 1;
    expect(lastExpired(state, e.status)).toBeUndefined();
  });
});
