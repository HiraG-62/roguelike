import { describe, expect, it } from "vitest";
import type { Enemy, GameState } from "../core/state";
import { ENEMIES } from "../data/enemies";
import { ENEMY_COMBAT } from "../data/enemyCombat";
import { ELITE, POISE, STATUS } from "../data/tuning";
import { damageEnemy, rollOutgoing } from "./combat";
import { interceptEnemyDamage, makeElite, updateElites } from "./elites";
import { updateEnemies } from "./enemies";
import { addPoise, applyStagger, basePoiseMax, bossPoiseGrowth, isStaggered } from "./poise";
import { applyStatus, findStatus, hasStatus, updateStatusEffects } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

const BIG_HP = 100000;
/** 近接 1 / 2 / 3 段の基礎怯み値（docs/COMBAT_DESIGN.md D-2） */
const COMBO_POISE = [8, 8, 22] as const;

function sturdy(state: GameState, key: string, dx = 30): Enemy {
  const e = placeEnemy(state, key, dx);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

/** 怯み値だけを乗せた 1 ダメージの近接 */
function poke(state: GameState, e: Enemy, poise: number, knockForce = 0): void {
  damageEnemy(state, e, 1, { x: 1, y: 0 }, knockForce, { kind: "melee", poise });
}

function comboOnce(state: GameState, e: Enemy): boolean[] {
  return COMBO_POISE.map((p) => {
    poke(state, e, p);
    return isStaggered(e);
  });
}

describe("怯みの蓄積（D-1）", () => {
  it("スライム（耐性 25）は 3 段（8 + 8 + 22）の 3 段目で怯み、蓄積は 0 に戻る", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    expect(e.poise.max, "深度 1 の耐性は表の値").toBe(ENEMY_COMBAT.slime?.poise);
    expect(comboOnce(state, e), "1・2 段目では怯まず 3 段目で怯む").toEqual([false, false, true]);
    expect(e.poise.damage).toBe(0);
    expect(findStatus(e.status, "stagger")?.time).toBeCloseTo(ENEMY_COMBAT.slime?.staggerTime ?? 0, 5);
  });

  it("怯みが解けると堅守が付き、堅守中は同じ 3 段を当てても怯まない（固め続けられない）", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    comboOnce(state, e);
    updateStatusEffects(state, (ENEMY_COMBAT.slime?.staggerTime ?? 0) + 0.01);
    expect(isStaggered(e)).toBe(false);
    expect(findStatus(e.status, "guarded")?.time, "堅守は guardedTime 秒").toBeCloseTo(POISE.guardedTime, 1);
    expect(comboOnce(state, e), "(8 + 8 + 22) × 0.5 = 19 < 25").toEqual([false, false, false]);
    expect(e.poise.damage).toBeCloseTo(38 * POISE.guardedMul, 5);
  });

  it("最後に怯み値を受けてから decayDelay 秒は減らず、その後は毎秒 耐性 × decayRate ずつ減る", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    poke(state, e, 16);
    updateStatusEffects(state, POISE.decayDelay / 2);
    expect(e.poise.damage, "猶予中は減らない").toBe(16);
    updateStatusEffects(state, POISE.decayDelay / 2);
    updateStatusEffects(state, 0.5);
    expect(e.poise.damage).toBeLessThan(16);
    expect(e.poise.damage).toBeGreaterThanOrEqual(16 - e.poise.max * POISE.decayRate * 1.0 - 1e-9);
    updateStatusEffects(state, 5);
    expect(e.poise.damage, "やがて 0 まで減る").toBe(0);
  });

  it("強靭: 予備動作中は superArmorMul 倍しか溜まらず、ignoreSuperArmor なら等倍", () => {
    const state = arena();
    const e = sturdy(state, "boar");
    e.phase = "windup";
    e.phaseTimer = 10;
    // 予備動作はプレイヤー（左）を向いている（背面の一撃にならない）
    e.strikeDir = { x: -1, y: 0 };
    poke(state, e, 20);
    expect(e.poise.damage).toBeCloseTo(20 * (ENEMY_COMBAT.boar?.superArmorMul ?? 0), 5);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { poise: 20, ignoreSuperArmor: true });
    expect(e.poise.damage).toBeCloseTo(20 * (ENEMY_COMBAT.boar?.superArmorMul ?? 0) + 20, 5);
  });

  it("怯んでいない敵へのノックバックは knockbackUnstaggered 倍、怯ませた一撃と怯み中は等倍", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    poke(state, e, 0, 100);
    expect(Math.hypot(e.knock.x, e.knock.y)).toBeCloseTo(100 * POISE.knockbackUnstaggered, 5);
    poke(state, e, 100, 100);
    expect(isStaggered(e)).toBe(true);
    expect(Math.hypot(e.knock.x, e.knock.y), "怯ませた一撃は押し出す").toBeCloseTo(100, 5);
  });

  it("怯み中は与ダメ × damageVsStaggeredMul（rollOutgoing の判定は状態異常 stagger）", () => {
    const state = arena(5, { damageVsStaggeredMul: 2 });
    const e = sturdy(state, "slime");
    expect(rollOutgoing(state, e, 10, "melee").amount).toBe(10);
    applyStagger(state, e, 1);
    expect(rollOutgoing(state, e, 10, "melee").amount).toBe(20);
  });
});

describe("怯みと AI（D-4）", () => {
  it("怯むと予備動作は取り消され、怯み中は動かず攻撃間隔も進まない。解けたら追跡から出直す", () => {
    const state = arena();
    const e = sturdy(state, "slime", 60);
    e.phase = "windup";
    e.phaseTimer = 10;
    applyStagger(state, e, 0.5);
    expect(e.phase, "予備動作は取り消し").toBe("chase");
    const interval = e.attackCooldown;
    const pos = { ...e.body.pos };
    updateEnemies(state, 0.2);
    expect(e.body.pos).toEqual(pos);
    expect(e.attackCooldown, "怯み中は攻撃間隔が進まない").toBe(interval);
    updateStatusEffects(state, 0.6);
    updateEnemies(state, 0.1);
    expect(e.body.pos, "解けたら動き出す").not.toEqual(pos);
  });

  it("猪の壁激突などの自傷の怯みは拘束上限を数えず、解けても堅守が付かない", () => {
    const state = arena();
    const e = sturdy(state, "boar");
    expect(applyStagger(state, e, POISE.chargerWallStagger, { selfInflicted: true })).toBe(true);
    expect(e.status.ccSpent).toBe(0);
    updateStatusEffects(state, POISE.chargerWallStagger + 0.01);
    expect(isStaggered(e)).toBe(false);
    expect(hasStatus(e.status, "guarded"), "自傷の後は堅守なし").toBe(false);
  });
});

describe("敵ごとの耐性（D-3）", () => {
  it("全敵に ENEMY_COMBAT のエントリがある", () => {
    for (const def of ENEMIES) {
      expect(ENEMY_COMBAT[def.key], `${def.key} の戦闘パラメータ`).toBeDefined();
    }
  });

  it("耐性は深度で伸び、エリートは × eliteMul（迅速は据え置き）", () => {
    expect(basePoiseMax("slime", 4)).toBeCloseTo(25 * (1 + POISE.depthScale * 3), 5);
    const state = arena();
    const a = sturdy(state, "slime");
    const b = sturdy(state, "slime", 50);
    makeElite(a, "explosive");
    makeElite(b, "hasted");
    expect(a.poise.max).toBeCloseTo(25 * POISE.eliteMul, 5);
    expect(b.poise.max).toBe(25);
  });

  it("鬼火は怯まない（耐性なし・stagger 免疫）", () => {
    const state = arena();
    const e = sturdy(state, "wisp");
    expect(addPoise(state, e, 999)).toBe(false);
    expect(applyStagger(state, e, 1)).toBe(false);
  });

  it("障壁のエリートは障壁が残っている間は溜まらず、障壁が割れると怯む", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 60);
    makeElite(e, "shielded");
    poke(state, e, 999);
    expect(e.poise.damage).toBe(0);
    expect(isStaggered(e)).toBe(false);
    damageEnemy(state, e, e.shieldMax ?? 0, { x: 1, y: 0 }, 0);
    updateElites(state);
    expect(findStatus(e.status, "stagger")?.time).toBeCloseTo(ELITE.shieldBreakStagger, 5);
  });

  it("スライム王の空中（strike）は怯み値が溜まらない", () => {
    const state = arena();
    const e = sturdy(state, "kingSlime", 80);
    e.phase = "strike";
    e.phaseTimer = 1;
    poke(state, e, 500);
    expect(e.poise.damage).toBe(0);
  });
});

describe("ボスのダウン", () => {
  it("耐性を超えるとダウン（長い怯み）、ダウンのたびに耐性 × 1.5（上限 × 3）", () => {
    const state = arena();
    const e = sturdy(state, "kingSlime", 80);
    const base = e.poise.max;
    poke(state, e, base);
    expect(findStatus(e.status, "stagger")?.time, "ダウン秒").toBeCloseTo(ENEMY_COMBAT.kingSlime?.staggerTime ?? 0, 5);
    expect(e.poise.downs).toBe(1);
    expect(e.poise.max).toBeCloseTo(base * POISE.bossPoiseGrowth, 5);
    expect(bossPoiseGrowth(10), "成長の上限").toBe(POISE.bossPoiseGrowthMax);
  });

  it("ダウン中は被ダメ × bossDownDamageMul、解けると堅守は bossGuardedTime 秒・受け × bossGuardedMul", () => {
    const state = arena();
    const e = sturdy(state, "boneLord", 80);
    poke(state, e, e.poise.max);
    const before = e.hp;
    damageEnemy(state, e, 20, { x: 1, y: 0 }, 0);
    expect(before - e.hp).toBe(Math.round(20 * POISE.bossDownDamageMul));
    updateStatusEffects(state, (ENEMY_COMBAT.boneLord?.staggerTime ?? 0) + 0.01);
    expect(findStatus(e.status, "guarded")?.time).toBeCloseTo(POISE.bossGuardedTime, 1);
    poke(state, e, 100);
    expect(e.poise.damage).toBeCloseTo(100 * POISE.bossGuardedMul, 5);
  });
});

describe("盾騎士のガードブレイク", () => {
  function frontKnight(state: GameState): Enemy {
    const k = sturdy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    return k;
  }

  it("正面の近接はブロック（ダメージ 0）でも怯み値の blockMul 倍は溜まる", () => {
    const state = arena();
    const k = frontKnight(state);
    const hp = k.hp;
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", poise: 20 });
    expect(k.hp).toBe(hp);
    expect(k.poise.damage).toBeCloseTo(20 * POISE.blockMul, 5);
  });

  it("盾の上から怯みが溢れたら「ガードブレイク」表示 + 怯み。怯んだ騎士は盾で防げない", () => {
    const state = arena();
    const k = frontKnight(state);
    const hp = k.hp;
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", poise: 60 });
    expect(isStaggered(k)).toBe(false);
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", poise: 60 });
    expect(isStaggered(k), "30 + 30 ≥ 50").toBe(true);
    expect(k.hp, "溢れた一撃もダメージは 0").toBe(hp);
    expect(state.texts.some((t) => t.text === "ガードブレイク")).toBe(true);
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee"), "怯み中は盾が下りる").toBe(10);
  });
});

describe("拘束上限と怯み", () => {
  it("拘束上限を使い切っている間は怯まず、蓄積は満杯のまま次の機会を待つ", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    e.status.ccWindowLeft = STATUS.ccWindow;
    e.status.ccSpent = STATUS.ccBudget;
    poke(state, e, 30);
    expect(isStaggered(e)).toBe(false);
    expect(e.poise.damage).toBe(e.poise.max);
    // 窓の終わりまで進める（減衰の猶予内に収める）
    e.status.ccWindowLeft = 0.01;
    updateStatusEffects(state, 0.02);
    poke(state, e, 1);
    expect(isStaggered(e), "窓が明けたら怯む").toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 怯みの拡張（docs/ideas/status-and-terrain.md 4 章）
// -----------------------------------------------------------------------------

function applyTo(state: GameState, e: Enemy, kind: "broken" | "corrode" | "weaken" | "vulnerable", stacks = 1): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind, stacks, duration: 5, potency: 0 }, "player");
}

describe("処刑", () => {
  it("怯み中で HP が 25% 以下の敵に重い一撃（怯み値 20 以上）を当てると即死し、マナが戻り周囲に恐怖", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 30);
    const near = placeEnemy(state, "slime", 30, 40);
    applyStagger(state, e, 1);
    e.hp = Math.floor(e.maxHp * POISE.executeHpRatio);
    state.player.mana = 0;
    poke(state, e, POISE.executeMinPoise);
    expect(e.hp).toBe(0);
    expect(state.player.mana).toBeGreaterThanOrEqual(POISE.executeMana);
    expect(hasStatus(near.status, "fear")).toBe(true);
    expect(state.texts.some((t) => t.text === "処刑")).toBe(true);
  });

  it("軽い一撃・HP が多い・怯んでいない・ボスは処刑しない", () => {
    const state = arena();
    const light = placeEnemy(state, "golem", 30);
    applyStagger(state, light, 1);
    light.hp = Math.floor(light.maxHp * POISE.executeHpRatio);
    poke(state, light, POISE.executeMinPoise - 1);
    expect(light.hp).toBeGreaterThan(0);

    const healthy = placeEnemy(state, "golem", 30, 40);
    applyStagger(state, healthy, 1);
    poke(state, healthy, POISE.executeMinPoise);
    expect(healthy.hp).toBeGreaterThan(0);

    const standing = placeEnemy(state, "golem", 30, -40);
    standing.hp = Math.floor(standing.maxHp * POISE.executeHpRatio);
    poke(state, standing, POISE.executeMinPoise);
    expect(standing.hp).toBeGreaterThan(0);

    const boss = sturdy(state, "boneLord", 80);
    applyStagger(state, boss, 1);
    boss.hp = Math.floor(boss.maxHp * 0.1);
    poke(state, boss, POISE.executeMinPoise);
    expect(boss.hp).toBeGreaterThan(0);
  });
});

describe("堅守を崩す手段", () => {
  it("背面の一撃: 攻撃中の敵を背後から殴ると堅守を無視して × backstabMul", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "guarded", stacks: 1, duration: 2, potency: 0 }, "env");
    e.phase = "recover";
    // 敵はプレイヤー（左）と反対の右を向いて攻撃している
    e.strikeDir = { x: 1, y: 0 };
    poke(state, e, 10);
    expect(e.poise.damage).toBeCloseTo(10 * POISE.backstabMul, 5);
  });

  it("正面からは堅守が効く（攻撃中でなければ背面の判定はしない）", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "guarded", stacks: 1, duration: 2, potency: 0 }, "env");
    poke(state, e, 10);
    expect(e.poise.damage).toBeCloseTo(10 * POISE.guardedMul, 5);
  });

  it("崩勢は受ける怯み値 × 1.3、腐食は +8% × スタック", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    const b = sturdy(state, "golem", 30);
    applyTo(state, a, "broken");
    applyTo(state, b, "corrode", 3);
    poke(state, a, 10);
    poke(state, b, 10);
    expect(a.poise.damage).toBeCloseTo(10 * STATUS.broken.poiseMul, 5);
    expect(b.poise.damage).toBeCloseTo(10 * (1 + STATUS.corrode.poisePerStack * 3), 5);
  });

  it("萎縮（弱体 + 脆弱）の敵は予備動作中でも強靭が効かない", () => {
    const state = arena();
    const e = sturdy(state, "boar");
    e.phase = "windup";
    e.phaseTimer = 10;
    e.strikeDir = { x: -1, y: 0 };
    applyTo(state, e, "weaken");
    applyTo(state, e, "vulnerable");
    poke(state, e, 10);
    expect(e.poise.damage).toBeCloseTo(10, 5);
  });

  it("怒気のスタックぶん与える怯み値が増える", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, { kind: "player" }, { kind: "wrath", stacks: 2, duration: 5, potency: 0 }, "player");
    poke(state, e, 10);
    expect(e.poise.damage).toBeCloseTo(10 * (1 + STATUS.wrath.poisePerStack * 2), 5);
  });
});

describe("怯みの伝播", () => {
  it("怯んだ瞬間、周囲の敵に怯み値が入る（伝播先からはさらに伝播しない）", () => {
    const state = arena();
    const a = sturdy(state, "slime");
    const b = sturdy(state, "golem", 30);
    b.body.pos.y += 20;
    const c = sturdy(state, "golem", 30);
    c.body.pos.y += 60;
    poke(state, a, a.poise.max);
    expect(isStaggered(a)).toBe(true);
    expect(b.poise.damage).toBeCloseTo(POISE.spreadPoise, 5);
    expect(c.poise.damage, "半径の外").toBe(0);
  });
});
