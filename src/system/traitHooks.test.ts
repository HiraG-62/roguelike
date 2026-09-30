import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { KEYSTONE, POISE, TRIGGER } from "../data/tuning";
import { DEFAULT_STATS, createLootRuntime, type TraitStats } from "../loot/types";
import { applyRoll } from "../loot/affixes";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { buildContext } from "./damageMods";
import { applyModifiers } from "./modifiers";
import { KS } from "./keystones";
import { gainMana } from "./mana";
import { applyStatus, hasStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";
import { SKILL_DEFS, baseCastParams } from "../skills/data";
import {
  afflictionKinds,
  tickTraitClocks,
  traitIncomingMul,
  traitManaGainMul,
  traitOutgoingMul,
  traitPoiseMul,
} from "./traitHooks";

/** 性質のルール変更（system/traitHooks.ts）の検査。数値は stats.traits に直接入れる */

const FAR = 200;
const NEAR = 20;

function withTraits(partial: Partial<TraitStats>, keystones: string[] = []): GameState {
  const state = arena(5, { traits: { ...DEFAULT_STATS.traits, ...partial }, keystones });
  for (const r of state.rooms) r.locked = false;
  return state;
}

function guard(state: GameState, enemy: ReturnType<typeof placeEnemy>): void {
  applyStatus(state, { kind: "enemy", enemy }, { kind: "guarded", stacks: 1, duration: 5, potency: 0 }, "env");
}

describe("与ダメージの性質", () => {
  it("多彩（Modifier）: 相手の状態異常 1 種ごとに増", () => {
    const state = withTraits({});
    applyRoll(state.stats, { key: "kaleidoscope", value: 10 });
    const e = placeEnemy(state, "slime", FAR);
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased).toBeCloseTo(0);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 5, potency: 0.01 }, "player");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "weaken", stacks: 1, duration: 5, potency: 0.25 }, "player");
    expect(afflictionKinds(e.status)).toBe(2);
    expect(applyModifiers(state, buildContext(e, "melee"), e).increased).toBeCloseTo(0.2);
  });

  it("満ち潮（Modifier）: 気力が満ちている間のスキルだけ", () => {
    const state = withTraits({});
    applyRoll(state.stats, { key: "fullTide", value: 30 });
    state.player.mana = state.stats.maxMana;
    expect(applyModifiers(state, buildContext(null, "ranged", { skill: true }), null).increased).toBeCloseTo(0.3);
    expect(applyModifiers(state, buildContext(null, "ranged"), null).increased, "スキル以外には効かない").toBeCloseTo(0);
    state.player.mana = 0;
    expect(applyModifiers(state, buildContext(null, "ranged", { skill: true }), null).increased, "満ちていない").toBeCloseTo(0);
  });

  it("封鎖の熱（Modifier）: 交戦中の部屋でだけ", () => {
    const state = withTraits({});
    applyRoll(state.stats, { key: "lockdownFury", value: 20 });
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased).toBeCloseTo(0);
    const room = state.rooms[0];
    if (room) room.locked = true;
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased).toBeCloseTo(0.2);
  });

  it("溜めの芯: 溜めの段 1 つにつき近接だけ", () => {
    const state = withTraits({ chargedMeleeMul: 0.1 });
    state.player.attack.chargeLevel = 2;
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1.2);
    expect(traitOutgoingMul(state, null, "ranged", false), "射撃には掛けない").toBeCloseTo(1);
    expect(traitOutgoingMul(state, null, "melee", true), "スキルには掛けない").toBeCloseTo(1);
  });

  it("rollOutgoing に乗る（堅守崩し）", () => {
    const state = withTraits({});
    applyRoll(state.stats, { key: "guardedBane", value: 100 });
    const e = placeEnemy(state, "slime", FAR);
    const plain = rollOutgoing(state, e, 10, "melee").amount;
    guard(state, e);
    expect(rollOutgoing(state, e, 10, "melee").amount).toBe(plain * 2);
  });
});

describe("怯み値の性質", () => {
  it("剥がし: 堅守の半減を近接・射撃とも打ち消す", () => {
    const state = withTraits({ guardPierce: 1 });
    const e = placeEnemy(state, "slime", FAR);
    guard(state, e);
    expect(traitPoiseMul(state, e, "ranged", false)).toBeCloseTo(1 / POISE.guardedMul);
    expect(traitPoiseMul(state, e, "melee", false)).toBeCloseTo(1 / POISE.guardedMul);
  });

  it("楔: 蓄積が半分以上なら +、未満は等倍（罰は無い）", () => {
    const state = withTraits({ wedgePoiseMul: 0.6 });
    const e = placeEnemy(state, "slime", FAR);
    e.poise.damage = 0;
    expect(traitPoiseMul(state, e, "melee", false)).toBeCloseTo(1);
    e.poise.damage = e.poise.max * TRIGGER.trait.wedgeRatio;
    expect(traitPoiseMul(state, e, "melee", false)).toBeCloseTo(1.6);
  });

  it("誓約: 揺るがぬは 0、読み勝ちは予備動作中の近接だけ", () => {
    const unshaken = withTraits({}, [KS.unshaken]);
    const e1 = placeEnemy(unshaken, "slime", FAR);
    expect(traitPoiseMul(unshaken, e1, "melee", false)).toBe(0);

    const read = withTraits({}, [KS.readOath]);
    const e3 = placeEnemy(read, "slime", FAR);
    e3.phase = "chase";
    expect(traitPoiseMul(read, e3, "melee", false)).toBe(0);
    expect(traitOutgoingMul(read, e3, "melee", false)).toBeCloseTo(KEYSTONE.readOffWindupDamageMul);
    e3.phase = "windup";
    expect(traitPoiseMul(read, e3, "melee", false)).toBeCloseTo(KEYSTONE.readPoiseMul);
  });
});

describe("怯ませた瞬間・撃破・カウンター", () => {
  it("汲み上げ: 敵を怯ませるとマナ、onStagger のトリガーと来歴", () => {
    const state = withTraits({ manaOnStagger: 7 });
    state.player.mana = 0;
    state.player.hp = 50;
    state.stats.triggers.push({ trigger: "onStagger", condition: "always", effect: "energy", magnitude: 9, chance: 1 });
    const e = placeEnemy(state, "slime", FAR);
    e.phase = "chase";
    const energy = state.player.energy;
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", poise: e.poise.max * 10 });
    expect(state.player.mana).toBeCloseTo(7 * state.stats.manaGainMul);
    expect(state.player.energy).toBeGreaterThan(energy);
  });

  it("崩れの反響: 基本の「怯みの伝播」より外の敵にも怯み値", () => {
    const state = withTraits({ staggerQuake: 10 });
    const target = placeEnemy(state, "slime", FAR);
    // 伝播（POISE.spreadRadius）の外、反響（TRIGGER.trait.staggerQuakeRadius）の内
    const near = placeEnemy(state, "slime", FAR + (POISE.spreadRadius + TRIGGER.trait.staggerQuakeRadius) / 2 + NEAR / 2);
    target.phase = "chase";
    near.phase = "chase";
    damageEnemy(state, target, 1, { x: 1, y: 0 }, 0, { kind: "melee", poise: target.poise.max * 10 });
    expect(near.poise.damage).toBeGreaterThan(0);
  });

  it("幕引き: 殲滅の瞬間にエネルギーと敵弾", () => {
    const state = withTraits({ lastKillClearsBullets: 1, lastKillEnergy: 20 });
    const room = state.rooms[0];
    if (room === undefined) throw new Error("部屋が無い");
    room.locked = true;
    const e = placeEnemy(state, "slime", FAR);
    e.roomIndex = 0;
    state.projectiles.push({
      id: 999,
      owner: "enemy",
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      radius: 2,
      damage: 1,
      life: 1,
      color: "#fff",
      kind: "proc",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    state.player.energy = 0;
    damageEnemy(state, e, e.hp + 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(state.player.energy).toBeGreaterThanOrEqual(20);
    expect(state.projectiles.every((p) => p.owner !== "enemy" || p.life <= 0), "敵弾が消える").toBe(true);
  });

  it("病みの誓い: 倒れた敵の状態異常が周囲へ移る", () => {
    const state = withTraits({}, [KS.contagion]);
    const dead = placeEnemy(state, "slime", FAR);
    const near = placeEnemy(state, "slime", FAR + NEAR);
    applyStatus(state, { kind: "enemy", enemy: dead }, { kind: "poison", stacks: 2, duration: 4, potency: 0.01 }, "player");
    damageEnemy(state, dead, dead.hp + 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(afflictionKinds(near.status)).toBe(1);
  });
});

describe("被ダメージの性質", () => {
  it("構え: 近接を振っている間だけ被ダメージが減る", () => {
    const state = withTraits({ stanceGuard: 0.3 });
    state.player.attack.phase = "none";
    expect(traitIncomingMul(state)).toBeCloseTo(1);
    state.player.attack.phase = "windup";
    expect(traitIncomingMul(state)).toBeCloseTo(0.7);
    state.player.attack.phase = "active";
    expect(traitIncomingMul(state)).toBeCloseTo(0.7);
  });

  it("踏ん張り: 立ち止まっている間だけ被ダメージが減る", () => {
    const state = withTraits({ unmoving: 0.2 });
    state.player.body.vel = { x: 0, y: 0 };
    expect(traitIncomingMul(state)).toBeCloseTo(0.8);
    state.player.body.vel = { x: 30, y: 0 };
    expect(traitIncomingMul(state), "動いている").toBeCloseTo(1);
  });

  it("身代わり: マナを払えたら被ダメージ半減、払えなければ不発で何も減らない", () => {
    const state = withTraits({ manaShieldCost: 10 });
    state.player.mana = 15;
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(TRIGGER.trait.manaShieldMul);
    expect(state.player.mana).toBe(5);
    expect(traitIncomingMul(state, undefined)).toBe(1);
    expect(state.player.mana).toBe(5);
  });

  it("damagePlayer に乗る", () => {
    const plain = withTraits({});
    const shielded = withTraits({ manaShieldCost: 5 });
    shielded.player.mana = 50;
    damagePlayer(plain, 40, { x: 0, y: 0 });
    damagePlayer(shielded, 40, { x: 0, y: 0 });
    expect(plain.player.maxHp - plain.player.hp).toBeGreaterThan(shielded.player.maxHp - shielded.player.hp);
  });
});

describe("マナの性質", () => {
  it("気力の回収倍率を持つ性質は無い（口だけ残す）", () => {
    expect(traitManaGainMul(withTraits({}))).toBe(1);
  });

  it("溢れ: 満タンで溢れた分が必殺ゲージへ", () => {
    const state = withTraits({ manaOverflowToEnergy: 1 });
    state.player.mana = state.stats.maxMana - 2;
    state.player.energy = 0;
    gainMana(state, 10);
    expect(state.player.mana).toBe(state.stats.maxMana);
    expect(state.player.energy).toBeCloseTo(8 * state.stats.energyGainMul);
  });
});

describe("作業領域を使う性質（余韻斬り・形見・撃ち込み杭）", () => {
  it("作業領域は createPlayer で初期化されている", () => {
    const state = withTraits({});
    expect(state.player.loot).toEqual(createLootRuntime());
  });

  it("余韻斬り: コンボが途切れた瞬間に衝撃波（途切れる前は出ない）", () => {
    const state = withTraits({ comboBreakWave: 2 });
    const e = placeEnemy(state, "slime", NEAR);
    const hp = e.hp;
    state.combo.count = 10;
    tickTraitClocks(state, 1 / 60);
    expect(e.hp, "続いている間は何もしない").toBe(hp);
    state.combo.count = 0;
    tickTraitClocks(state, 1 / 60);
    expect(e.hp).toBeLessThan(hp);
  });

  it("余韻斬り: 短いコンボ（最低数未満）では出ない", () => {
    const state = withTraits({ comboBreakWave: 2 });
    const e = placeEnemy(state, "slime", NEAR);
    const hp = e.hp;
    state.combo.count = TRIGGER.trait.comboBreakMin - 1;
    tickTraitClocks(state, 1 / 60);
    state.combo.count = 0;
    tickTraitClocks(state, 1 / 60);
    expect(e.hp).toBe(hp);
  });

  it("形見: 状態異常の敵を倒すと、その種類を次の命中に乗せる（回数で尽きる）", () => {
    const state = withTraits({ inheritCharges: 1 });
    const dead = placeEnemy(state, "slime", FAR);
    applyStatus(state, { kind: "enemy", enemy: dead }, { kind: "weaken", stacks: 1, duration: 4, potency: 0.25 }, "player");
    damageEnemy(state, dead, dead.hp + 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(state.player.loot.inherited?.kind).toBe("weaken");
    const next = placeEnemy(state, "slime", FAR + 60);
    damageEnemy(state, next, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(hasStatus(next.status, "weaken")).toBe(true);
    expect(state.player.loot.inherited).toBeNull();
  });

  it("撃ち込み杭: 射撃で刺さり、近接で本数ぶん爆ぜる（上限あり）", () => {
    const state = withTraits({ stakeDamage: 5 });
    const e = placeEnemy(state, "golem", FAR);
    for (let i = 0; i < TRIGGER.trait.stakeMax + 3; i++) damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(e.stuckShots).toBe(TRIGGER.trait.stakeMax);
    const hp = e.hp;
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hp - e.hp).toBeGreaterThanOrEqual(5 * TRIGGER.trait.stakeMax);
    expect(e.stuckShots).toBe(0);
  });
});

describe("ハブ性質（設置物・低 HP・祝福）", () => {
  it("置き土産: 氷結地帯の中での近接が冷気を乗せる", () => {
    const state = withTraits({ placedInfuse: 3 });
    const e = placeEnemy(state, "golem", NEAR);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hasStatus(e.status, "chill"), "設置物が無ければ乗らない").toBe(false);
    state.skills.fields.push({ pos: { ...state.player.body.pos }, timer: 3, total: 3, tick: 0, params: fieldParams(state) });
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hasStatus(e.status, "chill")).toBe(true);
  });

  it("血の署名: HP が半分を切っている間だけスキルが速く明ける", () => {
    const state = withTraits({ lowHpSkillHaste: 1 });
    for (const slot of state.skills.slots) slot.cooldownLeft = 2;
    tickTraitClocks(state, 0.5);
    expect(state.skills.slots[0]?.cooldownLeft).toBe(2);
    state.player.hp = state.player.maxHp * 0.3;
    tickTraitClocks(state, 0.5);
    expect(state.skills.slots[0]?.cooldownLeft).toBeCloseTo(1.5);
  });

});

/** 氷結地帯の既定の発動パラメータ（範囲の倍率 1） */
function fieldParams(state: GameState): GameState["skills"]["fields"][number]["params"] {
  void state;
  return baseCastParams(SKILL_DEFS.frostField);
}
