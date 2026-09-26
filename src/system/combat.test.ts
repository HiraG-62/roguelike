import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { ENERGY, HEAL, MANA, PLAYER, STATUS } from "../data/tuning";
import { MOVESETS, type MovesetKey } from "../data/weapons";
import { currentBullet } from "../loot/bullets";
import type { TriggeredEffect } from "../loot/types";
import { armorReduction, damageEnemy, damagePlayer, healSustained, hpRegenAllowed, inCombat, meleeHitEnergy, rollOutgoing, shotHitEnergy, tickHpRegen } from "./combat";
import { updateEnemies } from "./enemies";
import { KS, payOverclock, payOverclockShoot } from "./keystones";
import { applyStats, dashTime, meleeStep } from "./player";
import { applyStagger } from "./poise";
import { updateProjectiles } from "./projectiles";
import { applyBurn, applyChill, applyOnHitStatus, updateStatusEffects } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { fireTrigger } from "./triggers";

/** 1 段目を振り切るまで回す */
function swingOnce(state: ReturnType<typeof arena>): void {
  step(state, withInput({ attackPressed: true }), FIXED_DT);
  for (let i = 0; i < 20; i++) step(state, withInput({}), FIXED_DT);
}

function meleeDamageWith(meleeDamageMul: number): number {
  const state = arena(5, { meleeDamageMul });
  const e = placeEnemy(state, "boar", 14);
  const before = e.hp;
  swingOnce(state);
  return before - e.hp;
}

describe("stats → 近接", () => {
  it("meleeDamageMul でダメージが増える", () => {
    const base = meleeDamageWith(1);
    const doubled = meleeDamageWith(2);
    // 実ダメージは Math.round 後の整数（combat.ts）。QA 2026-09-23 の近接基礎値調整で
    // scaled 値が端数（7.8）になったため、生の scaled 値ではなく丸め後の値と比較する
    const raw = meleeStep(arena().stats, 0)?.damage ?? 0;
    expect(base).toBe(Math.round(raw));
    // 丸めは倍率を掛けた後の 1 回だけなので、丸め後の値の 2 倍ではなく生の値の 2 倍を丸めたもの
    expect(doubled).toBe(Math.round(raw * 2));
  });

  it("近接の各段で slash / hit の効果音が push される", () => {
    const state = arena();
    placeEnemy(state, "boar", 14);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.sfx).toContain("slash1");
    const heard = new Set(state.sfx);
    for (let i = 0; i < 20; i++) {
      step(state, withInput({}), FIXED_DT);
      for (const s of state.sfx) heard.add(s);
    }
    // 近接の命中は武器種ごとの音（既定の武器は剣）
    expect(heard.has("hitW_sword_light")).toBe(true);
  });

  it("impact を渡すと系統と重さに応じた命中音の名前が積まれる", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 999);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", impact: { family: "blunt", weight: "heavy" } });
    expect(state.sfx).toContain("hitBluntHeavy");
    expect(state.sfx).not.toContain("hit");
    expect(state.sfx).not.toContain("hitHeavy");
  });

  it("impact に武器種を渡すと武器種ごとの命中音（hitW_<武器種>_<重さ>）が積まれる", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 999);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", impact: { family: "slash", weight: "mid", weapon: "katana" } });
    expect(state.sfx).toContain("hitW_katana_mid");
    expect(state.sfx).not.toContain("hitSlashMid");
  });

  it("怯まない近接ヒットには低域の hitThump が足される（重撃は hitHeavy 自身が低域を持つため足さない）", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 999);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(state.sfx).toContain("hitThump");
    state.sfx.length = 0;
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", poise: e.poise.max * 10 });
    expect(state.sfx).not.toContain("hitThump");
  });

  it("刃・鞭打の命中には hitThump を重ねない（高域の斬撃音が低域に埋もれないように）。打撃には重ねる", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 999);
    for (const family of ["slash", "lash"] as const) {
      state.sfx.length = 0;
      damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", impact: { family, weight: "light" } });
      expect(state.sfx, family).not.toContain("hitThump");
    }
    state.sfx.length = 0;
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", impact: { family: "blunt", weight: "light" } });
    expect(state.sfx).toContain("hitThump");
  });
});

describe("stats → 射撃", () => {
  it("projectileCount 3 で弾が 3 発出る", () => {
    const state = arena(5, { projectileCount: 3, moveset: "sidearm" });
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    const shots = state.projectiles.filter((pr) => pr.owner === "player");
    expect(shots).toHaveLength(3);
    const angles = shots.map((pr) => Math.atan2(pr.vel.y, pr.vel.x)).sort((a, b) => a - b);
    expect(angles[2]! - angles[0]!).toBeCloseTo((PLAYER.projectileSpreadDeg * 2 * Math.PI) / 180, 5);
    expect(state.sfx).toContain("shoot");
  });

  it("pierce 1 なら並んだ 2 体を貫通し、pierce 0 なら 1 体で止まる", () => {
    for (const pierce of [0, 1]) {
      const state = arena(5, { pierce, moveset: "sidearm" });
      const a = placeEnemy(state, "boar", 20);
      const b = placeEnemy(state, "boar", 40);
      const hpA = a.hp;
      const hpB = b.hp;
      step(state, withInput({ attackHeld: true }), FIXED_DT);
      for (let i = 0; i < 30; i++) updateProjectiles(state, FIXED_DT);
      expect(a.hp).toBeLessThan(hpA);
      if (pierce > 0) expect(b.hp).toBeLessThan(hpB);
      else expect(b.hp).toBe(hpB);
    }
  });
});

describe("状態異常", () => {
  it("burn で HP が時間とともに減り、数字は出ない", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 60);
    const before = e.hp;
    applyBurn(state, e, 10, 3);
    state.texts = [];
    for (let i = 0; i < 60; i++) updateStatusEffects(state, FIXED_DT);
    expect(before - e.hp).toBeGreaterThanOrEqual(9);
    expect(before - e.hp).toBeLessThanOrEqual(10);
    expect(state.texts).toHaveLength(0);
  });

  it("chill で phaseTimer の進行が遅くなる", () => {
    const state = arena();
    const normal = placeEnemy(state, "boar", 60, -30);
    const chilled = placeEnemy(state, "boar", 60, 30);
    for (const e of [normal, chilled]) {
      e.phase = "windup";
      e.phaseTimer = 1;
    }
    applyChill(state, chilled, 0.5, 2);
    updateEnemies(state, 0.1);
    expect(normal.phaseTimer).toBeCloseTo(0.9, 5);
    expect(chilled.phaseTimer).toBeCloseTo(0.95, 5);
  });

  it("on-hit 判定（burn/chill/shock）は同じ敵に対して 0.2 秒に 1 回まで（9 発同時ヒットで 1 回だけ判定）", () => {
    const state = arena(5, { burnChance: 1, burnDps: 10 });
    const e = placeEnemy(state, "boar", 60);
    let chanceCalls = 0;
    const original = state.rng.chance.bind(state.rng);
    state.rng.chance = (p: number) => {
      chanceCalls += 1;
      return original(p);
    };

    for (let i = 0; i < 9; i++) applyOnHitStatus(state, e);
    // ICD 中は 2 回目以降 rng すら引かない → burn の判定は 1 回だけ
    expect(chanceCalls).toBe(1);
    expect(e.status.procIcd).toBeCloseTo(STATUS.onHitIcd, 5);

    // ICD が明けたら再び判定できる
    updateStatusEffects(state, STATUS.onHitIcd);
    applyOnHitStatus(state, e);
    expect(chanceCalls).toBe(2);
  });
});

describe("トリガー", () => {
  const energyOnHit: TriggeredEffect = {
    trigger: "onMeleeHit",
    condition: "always",
    effect: "energy",
    magnitude: 10,
    chance: 1,
  };

  it("ICD 中は同じトリガーが発動しない", () => {
    const state = arena(5, { triggers: [energyOnHit] });
    const ctx = { pos: { ...state.player.body.pos } };
    fireTrigger(state, "onMeleeHit", ctx);
    fireTrigger(state, "onMeleeHit", ctx);
    expect(state.player.energy).toBe(10);
    // ICD が明けるまで待つ
    for (let i = 0; i < 30; i++) step(state, withInput({}), FIXED_DT);
    fireTrigger(state, "onMeleeHit", ctx);
    expect(state.player.energy).toBe(20);
  });

  it("condition を満たさないと発動しない", () => {
    const state = arena(5, { triggers: [{ ...energyOnHit, condition: "belowHalfHp" }] });
    fireTrigger(state, "onMeleeHit", { pos: { ...state.player.body.pos } });
    expect(state.player.energy).toBe(0);
  });

  it("ICD は内容ベースのキーで管理され、装備変更で index がずれても他のトリガーに残らない", () => {
    const state = arena(5, { triggers: [energyOnHit] });
    const ctx = { pos: { ...state.player.body.pos } };
    fireTrigger(state, "onMeleeHit", ctx);
    expect(state.player.energy).toBe(10);

    // 装備変更で index 0 が全く別のトリガーに入れ替わる（旧実装なら index 0 の ICD を誤って引き継ぐ）
    const healOnMeleeHit: TriggeredEffect = {
      trigger: "onMeleeHit",
      condition: "always",
      effect: "heal",
      // 戦闘中の回復の上限（最大 HP の HEAL.sustainCapRatio / 秒）に掛からない量
      magnitude: 3,
      chance: 1,
    };
    state.stats = { ...state.stats, triggers: [healOnMeleeHit] };
    state.player.hp = 50;
    fireTrigger(state, "onMeleeHit", ctx);
    expect(state.player.hp).toBe(53);
  });
});

describe("キーストーン", () => {
  it("ks_pacifist では近接が振れる", () => {
    const state = arena(5, { keystones: [KS.pacifist] });
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).not.toBe("none");
  });

  it("ks_pacifist: 怯んでいない敵の生命を1未満にできない", () => {
    const state = arena(5, { keystones: [KS.pacifist] });
    const e = placeEnemy(state, "boar", 14);
    e.hp = 5;
    const killed = damageEnemy(state, e, 999, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(killed).toBe(false);
    expect(e.hp).toBe(1);
  });

  it("ks_pacifist: 怯み中の敵はそのまま倒せる", () => {
    const state = arena(5, { keystones: [KS.pacifist] });
    const e = placeEnemy(state, "boar", 14);
    e.hp = 5;
    applyStagger(state, e, 1);
    const killed = damageEnemy(state, e, 999, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(killed).toBe(true);
    expect(e.hp).toBeLessThanOrEqual(0);
  });

  it("ks_pacifist: 怯まない敵（怯みゲージを持たない）は制限なく倒せる", () => {
    const state = arena(5, { keystones: [KS.pacifist] });
    const e = placeEnemy(state, "boar", 14);
    e.poise.max = 0;
    e.hp = 5;
    const killed = damageEnemy(state, e, 999, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(killed).toBe(true);
  });

  it("ks_bladeOath（近間の誓い）: 距離で与ダメージが変わる", () => {
    const near = arena(5, { keystones: [KS.bladeOath], critChance: 0 });
    const eNear = placeEnemy(near, "boar", 10);
    const far = arena(5, { keystones: [KS.bladeOath], critChance: 0 });
    const eFar = placeEnemy(far, "boar", 100);
    const base = arena(5, { critChance: 0 });
    const eBase = placeEnemy(base, "boar", 10);
    const nearHit = rollOutgoing(near, eNear, 10, "melee");
    const farHit = rollOutgoing(far, eFar, 10, "melee");
    const baseHit = rollOutgoing(base, eBase, 10, "melee");
    expect(nearHit.amount).toBeGreaterThan(baseHit.amount);
    expect(farHit.amount).toBeLessThan(baseHit.amount);
  });

  it("ks_bladeOath: 射撃・固有技を封じない", () => {
    const state = arena(5, { keystones: [KS.bladeOath], moveset: "sidearm" });
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(state.projectiles.filter((pr) => pr.owner === "player").length).toBeGreaterThan(0);
  });

  it("ks_blink ではダッシュが一瞬で移動し、無敵が付かない", () => {
    const state = arena(5, { keystones: [KS.blink] });
    const x0 = state.player.body.pos.x;
    step(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    const moved = state.player.body.pos.x - x0;
    expect(moved).toBeGreaterThan(PLAYER.dash.speed * dashTime(state.stats) * 0.5);
    expect(state.player.dashTimer).toBe(0);
    expect(state.player.invulnTimer).toBe(0);
  });

  it("ks_juggernaut では被弾ノックバックを受けない", () => {
    const state = arena(5, { keystones: [KS.juggernaut] });
    const p = state.player.body.pos;
    damagePlayer(state, 10, { x: p.x - 10, y: p.y });
    expect(state.player.knock).toEqual({ x: 0, y: 0 });
  });
});

describe("ks_overclock", () => {
  it("射撃は 3 発ごとに 1 HP、近接は 1 振りごとに 1 HP を消費する", () => {
    const state = arena(5, { keystones: [KS.overclock] });
    state.player.hp = 100;

    payOverclockShoot(state);
    payOverclockShoot(state);
    expect(state.player.hp).toBe(100);
    payOverclockShoot(state);
    expect(state.player.hp).toBe(99);
    payOverclockShoot(state);
    payOverclockShoot(state);
    expect(state.player.hp).toBe(99);
    payOverclockShoot(state);
    expect(state.player.hp).toBe(98);

    payOverclock(state, PLAYER.overclockHpCost);
    expect(state.player.hp).toBe(97);
  });
});

describe("ks_vampire + ks_pacifist", () => {
  it("不殺でも近接は振れ、vampire の life on hit は射撃ヒットでも近接ヒットでも発動する", () => {
    const state = arena(5, { keystones: [KS.vampire, KS.pacifist], lifeOnHit: 3, moveset: "sidearm" });
    state.player.hp = 50;
    placeEnemy(state, "boar", 20);
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    for (let i = 0; i < 10; i++) step(state, withInput({}), FIXED_DT);
    expect(state.player.hp).toBeGreaterThan(50);
  });
});

describe("生存 stats", () => {
  it("armor と damageTakenMul で被ダメが減る（最低 1）", () => {
    const state = arena(5, { armor: 5, damageTakenMul: 0.5 });
    const p = state.player.body.pos;
    damagePlayer(state, 25, { x: p.x - 10, y: p.y });
    // armor 5: reduction = 5/(5+50) ≈ 9.09% → 25 * 0.9091 * 0.5 ≈ 11.36 → round 11
    expect(state.player.maxHp - state.player.hp).toBe(11);
    state.player.invulnTimer = 0;
    const hp = state.player.hp;
    damagePlayer(state, 1, { x: p.x - 10, y: p.y });
    expect(hp - state.player.hp).toBe(1);
  });

  it("armorReduction は逓減式で、armor 20 で約 29%、armor 150 で上限 75%", () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(20)).toBeCloseTo(20 / 70, 3);
    expect(armorReduction(20)).toBeCloseTo(0.2857, 3);
    expect(armorReduction(150)).toBeCloseTo(0.75, 5);
    // さらに積んでも上限を超えない
    expect(armorReduction(10000)).toBe(0.75);
  });

  it("ダッシュはチャージ制で、回数ぶん連続で出せる", () => {
    const state = arena(5, { dashCharges: 2 });
    step(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.dashChargesLeft).toBe(1);
    // ダッシュが終わるまで待ってからもう一度
    while (state.player.dashTimer > 0) step(state, withInput({}), FIXED_DT);
    step(state, withInput({ dashPressed: true, move: { x: -1, y: 0 } }), FIXED_DT);
    expect(state.player.dashChargesLeft).toBe(0);
  });

  it("死亡時にラン記録が 1 回だけ保存される", () => {
    const state = arena();
    const p = state.player.body.pos;
    state.player.hp = 1;
    const runs = state.profile.meta.runs;
    damagePlayer(state, 50, { x: p.x - 10, y: p.y });
    expect(state.status).toBe("dead");
    expect(state.sfx).toContain("death");
    expect(state.profile.meta.runs).toBe(runs);
    expect(state.profile.meta.bestDepth).toBe(1);
    state.kills = 99;
    damagePlayer(state, 50, { x: p.x - 10, y: p.y });
    expect(state.profile.meta.totalKills).toBe(0);
  });
});

describe("スモーク（全効果盛り）", () => {
  it("状態異常・トリガー・キーストーン込みで長時間回しても例外が出ない", async () => {
    const { createGame } = await import("../core/game");
    const { createRng } = await import("../core/rng");
    const rng = createRng(77);
    const state = createGame(77);
    const always = { condition: "always" as const, chance: 1 };
    state.stats = {
      ...state.stats,
      burnChance: 0.5,
      burnDps: 5,
      chillChance: 0.5,
      chillSlow: 0.4,
      shockChance: 0.5,
      shockDamage: 6,
      explodeOnKillChance: 0.5,
      explodeDamage: 10,
      projectileCount: 3,
      pierce: 2,
      hpRegen: 2,
      thorns: 5,
      dashCharges: 3,
      keystones: [KS.gambler, KS.overclock],
      triggers: [
        { ...always, trigger: "onKill", effect: "shockwave", magnitude: 10 },
        { ...always, trigger: "onMeleeHit", effect: "chainLightning", magnitude: 5 },
        { ...always, trigger: "onShoot", effect: "burnNearby", magnitude: 3, duration: 2 },
        { ...always, trigger: "everyNthMeleeHit", every: 3, effect: "spawnBullets", magnitude: 4, count: 6 },
        { ...always, trigger: "onDash", effect: "freezeNearby", magnitude: 40, duration: 2 },
        { ...always, trigger: "onHurt", effect: "invuln", magnitude: 0.5 },
        { ...always, trigger: "onRoomClear", effect: "heal", magnitude: 10 },
        { ...always, trigger: "onJustDodge", effect: "damageBuff", magnitude: 30, duration: 3 },
      ],
    };
    for (let i = 0; i < 4000; i++) {
      step(
        state,
        withInput({
          move: { x: rng.int(-1, 1), y: rng.int(-1, 1) },
          attackPressed: rng.chance(0.15),
          dashPressed: rng.chance(0.05),
          shootHeld: rng.chance(0.3),
          specialPressed: rng.chance(0.02),
        }),
        FIXED_DT,
      );
      state.sfx = [];
      if (state.status === "dead") break;
    }
    expect(state.tick).toBeGreaterThan(0);
    expect(Number.isFinite(state.player.hp)).toBe(true);
  });
});

describe("回復の設計（与ダメの % 回復・共通上限・条件付き撃破回復・非戦闘時の自然回復）", () => {
  /** 共通上限の窓（1 秒）ぶんの上限量 */
  const capOf = (state: ReturnType<typeof arena>): number => state.player.maxHp * HEAL.sustainCapRatio;

  it("射撃のヒットでも回復する（銃の家系に付く性質が無効にならない）", () => {
    const state = arena(5, { lifeOnHit: 3, moveset: "sidearm" });
    state.player.hp = 50;
    placeEnemy(state, "boar", 20);
    for (let i = 0; i < 10; i++) step(state, withInput({ attackHeld: i === 0 }), FIXED_DT);
    expect(state.player.hp, "射撃の命中で回復する").toBeGreaterThan(50);
  });

  it("lifeOnHit は与ダメージの % を回復する", () => {
    const state = arena(5, { lifeOnHit: 3 });
    state.player.hp = 50;
    const e = placeEnemy(state, "boar", 14);
    e.hp = 100000;
    damageEnemy(state, e, 100, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(state.player.hp, "与ダメ 100 の 3% = 3 回復").toBeCloseTo(53);
  });

  it("戦闘中の回復は 1 秒あたり最大 HP の HEAL.sustainCapRatio が上限（多段ヒットで回復し放題にしない）", () => {
    const state = arena(5, { lifeOnHit: 10 });
    state.player.hp = 50;
    const e = placeEnemy(state, "boar", 14);
    e.hp = 100000;
    for (let i = 0; i < 9; i++) damageEnemy(state, e, 100, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(state.player.hp, "9 ヒットしても上限までしか戻らない").toBeCloseTo(50 + capOf(state));
  });

  it("上限の窓が明けると再び回復できる", () => {
    const state = arena(5, { lifeOnHit: 10 });
    state.player.hp = 50;
    const e = placeEnemy(state, "boar", 14);
    e.hp = 100000;
    damageEnemy(state, e, 100, { x: 1, y: 0 }, 0, { kind: "ranged" });
    const afterFirst = state.player.hp;
    state.player.lifeOnHitWindow.timer = 0;
    damageEnemy(state, e, 100, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(state.player.hp, "窓が明けた後の命中で上限ぶん戻る").toBeCloseTo(afterFirst + capOf(state));
  });

  it("healSustained は命中時回復と上限を共有する（祝福の撃破回復も同じ窓）", () => {
    const state = arena(5, { lifeOnHit: 10 });
    state.player.hp = 50;
    const e = placeEnemy(state, "boar", 14);
    e.hp = 100000;
    damageEnemy(state, e, 100, { x: 1, y: 0 }, 0, { kind: "ranged" });
    const healed = healSustained(state, 10);
    expect(healed, "命中時回復で上限を使い切った後は戻らない").toBe(0);
  });

  it("撃破時HP回復はコンボ HEAL.killHealMinCombo 未満では発動しない", () => {
    const state = arena(5, { lifeOnKill: 3 });
    state.player.hp = 50;
    const e = placeEnemy(state, "slime", 14);
    state.combo.count = 0;
    damageEnemy(state, e, e.hp, { x: 1, y: 0 }, 0);
    expect(e.hp, "倒している").toBeLessThanOrEqual(0);
    expect(state.player.hp, "コンボが足りないので回復しない").toBe(50);
  });

  it("撃破時HP回復はコンボ HEAL.killHealMinCombo 以上で発動する", () => {
    const state = arena(5, { lifeOnKill: 3 });
    state.player.hp = 50;
    const e = placeEnemy(state, "slime", 14);
    state.combo.count = HEAL.killHealMinCombo;
    damageEnemy(state, e, e.hp, { x: 1, y: 0 }, 0);
    expect(state.player.hp, "コンボが足りているので回復する").toBeCloseTo(53);
  });

  it("HP自然回復は近くに生きた敵がいる間は止まる", () => {
    const state = arena(5, { hpRegen: 2 });
    state.player.hp = 50;
    placeEnemy(state, "boar", MANA.combatRadius - 10);
    expect(hpRegenAllowed(state), "敵が近い").toBe(false);
    tickHpRegen(state, 1);
    expect(state.player.hp, "敵が近いので回復しない").toBe(50);
  });

  it("HP自然回復は近くに敵がいなければ働く（遠くの敵・倒れた敵は数えない）", () => {
    const state = arena(5, { hpRegen: 2 });
    state.player.hp = 50;
    placeEnemy(state, "boar", MANA.combatRadius + 40);
    const dead = placeEnemy(state, "boar", 10);
    dead.hp = 0;
    expect(hpRegenAllowed(state), "近くに生きた敵がいない").toBe(true);
    tickHpRegen(state, 1);
    expect(state.player.hp, "毎秒 2 回復する").toBeCloseTo(52);
  });

  it("封鎖中の部屋があればHP自然回復しない（マナの自然回復と同じ戦闘判定）", () => {
    const state = arena(5, { hpRegen: 2 });
    state.player.hp = 50;
    const room = state.rooms[0];
    if (room === undefined) throw new Error("部屋が無い");
    room.locked = true;
    expect(inCombat(state), "封鎖中は戦闘中").toBe(true);
    tickHpRegen(state, 1);
    expect(state.player.hp, "封鎖中は回復しない").toBe(50);
  });

  it("狂戦士・吸血の誓約では敵がいなくてもHP自然回復しない", () => {
    const state = arena(5, { hpRegen: 2, keystones: [KS.berserker] });
    state.player.hp = 50;
    tickHpRegen(state, 1);
    expect(state.player.hp, "誓約で自然回復が止まる").toBe(50);
  });
});

describe("applyStats", () => {
  it("HP 割合を丸めずに維持する", () => {
    const state = arena();
    state.player.hp = 33;
    applyStats(state, { ...state.stats, maxHp: 50 });
    expect(state.player.hp).toBeCloseTo(16.5);
  });

  it("死亡中は HP を戻さない", () => {
    const state = arena();
    state.player.hp = 0;
    state.status = "dead";
    applyStats(state, { ...state.stats, maxHp: 150 });
    expect(state.player.hp).toBe(0);
    expect(state.player.maxHp).toBe(150);
  });
});

describe("奥義ゲージの溜まり方（ENERGY）", () => {
  /** 型の 1 段目〜最終段を 1 巡振り続けたとき、1 秒あたりに 1 体へ当てて溜まる量（攻撃速度の倍率は掛けない基礎秒） */
  function energyPerSecond(key: MovesetKey): number {
    const steps = MOVESETS[key].steps;
    let sec = 0;
    let gain = 0;
    for (const s of steps) {
      const t = s.windup + s.active + s.recover;
      const hits = Math.max(1, s.hits ?? 1);
      sec += t;
      gain += meleeHitEnergy(t, hits) * hits;
    }
    return gain / sec;
  }

  it("同じ 1 秒殴り続けたとき双剣と大剣の獲得量が ±20% に収まる", () => {
    const twin = energyPerSecond("twinBlades");
    const great = energyPerSecond("greatsword");
    expect(twin / great, `双剣 ${twin.toFixed(1)} / 大剣 ${great.toFixed(1)}`).toBeGreaterThan(0.8);
    expect(twin / great, `双剣 ${twin.toFixed(1)} / 大剣 ${great.toFixed(1)}`).toBeLessThan(1.2);
  });

  it("速い段ほど 1 命中の獲得量が小さく、下限と上限で切られる", () => {
    expect(meleeHitEnergy(0.2, 1), "速い段").toBeLessThan(meleeHitEnergy(0.6, 1));
    expect(meleeHitEnergy(0.001, 1), "下限").toBe(ENERGY.minPerHit);
    expect(meleeHitEnergy(10, 1), "上限").toBe(ENERGY.maxPerHit);
    expect(meleeHitEnergy(0.4, 2), "多段は 1 命中ぶんに割る").toBeCloseTo(meleeHitEnergy(0.2, 1), 5);
  });

  it("近接の命中で段の基礎秒に応じたゲージが溜まり、攻撃速度を上げても 1 命中の量は変わらない", () => {
    const gains = [1, 2].map((attackSpeedMul) => {
      const state = arena(5, { moveset: "greatsword", attackSpeedMul });
      const e = placeEnemy(state, "boar", 14);
      e.hp = 5000;
      step(state, withInput({ attackPressed: true }), FIXED_DT);
      for (let i = 0; i < 40 && state.player.energy === 0; i++) step(state, withInput({}), FIXED_DT);
      return state.player.energy;
    });
    const s0 = MOVESETS.greatsword.steps[0];
    const expected = s0 ? meleeHitEnergy(s0.windup + s0.active + s0.recover, Math.max(1, s0.hits ?? 1)) : 0;
    expect(gains[0], "大剣 1 段目の 1 命中").toBeCloseTo(expected, 5);
    expect(gains[1], "攻撃速度 2 倍でも 1 命中の量は同じ").toBeCloseTo(expected, 5);
  });

  it("射撃の命中で奥義ゲージが溜まる", () => {
    const state = arena(5, { moveset: "sidearm" });
    const e = placeEnemy(state, "boar", 30);
    e.hp = 5000;
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    const shot = state.projectiles.find((pr) => pr.owner === "player");
    const bullet = currentBullet(state.stats);
    const expected = shotHitEnergy(PLAYER.shoot.cooldown * bullet.cooldownMul, state.stats.projectileCount + bullet.pellets);
    expect(shot?.energy, "弾が溜める量を持つ").toBeCloseTo(expected, 5);
    for (let i = 0; i < 30 && state.player.energy === 0; i++) updateProjectiles(state, FIXED_DT);
    expect(e.hp, "当たっている").toBeLessThan(5000);
    expect(state.player.energy, "射撃の命中で溜まる").toBeCloseTo(expected, 5);
    expect(expected, "近接より低い割合").toBeLessThan(meleeHitEnergy(PLAYER.shoot.cooldown * bullet.cooldownMul, 1) + 1e-9);
  });
});
