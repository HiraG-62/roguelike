import { describe, expect, it } from "vitest";
import type { Enemy, GameState } from "../core/state";
import { FORMS, type FormDef, type FormKey } from "../data/weaponForms";
import type { BulletDef, PinDef } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { emitVolley } from "./player";
import { detonatePins, drivePins, livePins, pinCount, stickPin } from "./pins";
import { isStaggered } from "./poise";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy } from "./testHelpers";

/** 刺さる飛び物（system/pins.ts）: 刺さり・上限・抜け・刺さり崩し・叩き込み・炸裂 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const STEP = 1 / 60;
const KUNAI: PinDef = { kind: "kunai", max: 3, sec: 5, driveMul: 2 };
const SHURIKEN: PinDef = { kind: "shuriken", max: 8, sec: 3, driveMul: 1, staggerAt: 8 };
const STUCK_DAMAGE = 10;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

/** 型の戦意の溜まり方を一時的に差し替えて body を回す（終わったら戻す） */
function withFormGain(key: FormKey, gain: FormDef["morale"]["gain"], body: () => void): void {
  const forms = FORMS as Record<FormKey, FormDef>;
  const saved = forms[key];
  forms[key] = { ...saved, morale: { ...saved.morale, gain, derived: false } };
  try {
    body();
  } finally {
    forms[key] = saved;
  }
}

function pinShot(pin: PinDef): BulletDef {
  return { ...bulletDef("pistol"), key: "test.pin", name: "試しの刺さる弾", pin, pierceBonus: 0 };
}

function flyAll(state: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) updateProjectiles(state, STEP);
}

describe("刺さる弾", () => {
  it("当たった弾は消えて敵に刺さり、刺さったときの威力と向きを持つ", () => {
    const state = arena();
    const e = tough(placeEnemy(state, "boar", 40));
    emitVolley(state, pinShot(KUNAI), 0, undefined, { damage: STUCK_DAMAGE, recoil: false, lane: "primary" });
    flyAll(state, 0.5);
    expect(state.projectiles.filter((p) => p.owner === "player").length, "刺さった弾は消える").toBe(0);
    const pins = livePins(state, e);
    expect(pins.length, "1 本刺さる").toBe(1);
    expect(pins[0]?.kind).toBe("kunai");
    expect(pins[0]?.damage ?? 0, "刺さったときの威力").toBeGreaterThan(0);
    expect(Math.abs(pins[0]?.angle ?? 1), "右へ飛んだ向き").toBeLessThan(0.01);
  });

  it("上限を超えたら古い順に抜け、秒が過ぎたら抜ける", () => {
    const state = arena();
    const e = tough(placeEnemy(state, "boar", 40));
    for (let i = 0; i < KUNAI.max + 1; i++) {
      stickPin(state, e, KUNAI, 0, i + 1);
      state.time += 1;
    }
    expect(pinCount(state, e, "kunai"), "上限で頭打ち").toBe(KUNAI.max);
    expect(livePins(state, e).map((p) => p.damage), "1 本目が抜けた").toEqual([2, 3, 4]);
    // 2 本目は 1 秒目に刺さったので 6 秒目で抜ける
    state.time = 1 + KUNAI.sec;
    expect(livePins(state, e).map((p) => p.damage), "刺さってから sec 秒で抜ける").toEqual([3, 4]);
    state.time = 10 + KUNAI.sec;
    expect(pinCount(state, e), "全部抜ける").toBe(0);
  });

  it("種類ごとに数える（クナイの上限は手裏剣を抜かない）", () => {
    const state = arena();
    const e = tough(placeEnemy(state, "boar", 40));
    stickPin(state, e, SHURIKEN, 0, 1);
    for (let i = 0; i < KUNAI.max + 2; i++) stickPin(state, e, KUNAI, 0, 1);
    expect(pinCount(state, e, "shuriken")).toBe(1);
    expect(pinCount(state, e, "kunai")).toBe(KUNAI.max);
  });
});

describe("刺さり崩し", () => {
  it("同じ敵に 8 本刺さると怯み、刺さりが消え、戦意が溜まる", () => {
    withFormGain("blade", [{ kind: "pinStagger", amount: 1 }], () => {
      const state = arena();
      const e = tough(placeEnemy(state, "boar", 40));
      const before = state.player.morale.value;
      for (let i = 0; i < SHURIKEN.max - 1; i++) expect(stickPin(state, e, SHURIKEN, 0, 1), `${i + 1} 本目`).toBe("stuck");
      expect(isStaggered(e), "7 本では怯まない").toBe(false);
      expect(stickPin(state, e, SHURIKEN, 0, 1), "8 本目").toBe("staggered");
      expect(isStaggered(e), "8 本で怯む").toBe(true);
      expect(pinCount(state, e, "shuriken"), "刺さりが消える").toBe(0);
      expect(state.player.morale.value, "戦意 +1").toBe(before + 1);
    });
  });
});

describe("叩き込みと炸裂", () => {
  it("叩き込みは刺さった本数ぶん追撃（刺さったときの威力 × 倍率）を入れ、刺さりが消え、戦意が本数ぶん溜まる", () => {
    withFormGain("blade", [{ kind: "pinDriven", amount: 1 }], () => {
      const state = arena();
      const e = tough(placeEnemy(state, "boar", 40));
      for (let i = 0; i < KUNAI.max; i++) stickPin(state, e, KUNAI, 0, STUCK_DAMAGE);
      const hp = e.hp;
      const driven = drivePins(state, e, { x: 1, y: 0 });
      expect(driven, "刺さった本数").toBe(KUNAI.max);
      expect(hp - e.hp, "1 本ごとに威力 × 倍率").toBeCloseTo(KUNAI.max * STUCK_DAMAGE * KUNAI.driveMul, 0);
      expect(pinCount(state, e), "刺さりが消える").toBe(0);
      expect(state.player.morale.value, "叩き込んだ本数ぶん").toBe(KUNAI.max);
      expect(drivePins(state, e, { x: 1, y: 0 }), "刺さりが無ければ 0").toBe(0);
    });
  });

  it("炸裂は敵すべての刺さりを爆ぜさせて消す", () => {
    const state = arena();
    const a = tough(placeEnemy(state, "boar", 40));
    const b = tough(placeEnemy(state, "boar", -40));
    stickPin(state, a, KUNAI, 0, STUCK_DAMAGE);
    stickPin(state, a, KUNAI, 0, STUCK_DAMAGE);
    stickPin(state, b, KUNAI, 0, STUCK_DAMAGE);
    const hpA = a.hp;
    const hpB = b.hp;
    expect(detonatePins(state, 3), "爆ぜた本数").toBe(3);
    expect(hpA - a.hp).toBeCloseTo(2 * STUCK_DAMAGE * 3, 0);
    expect(hpB - b.hp).toBeCloseTo(STUCK_DAMAGE * 3, 0);
    expect(pinCount(state, a) + pinCount(state, b)).toBe(0);
  });

  it("刺さったまま味方になった敵（従魔）は炸裂で傷つけない", () => {
    const state = arena();
    const ally = tough(placeEnemy(state, "boar", 40));
    stickPin(state, ally, KUNAI, 0, STUCK_DAMAGE);
    ally.allyUntil = state.time + 10;
    const hp = ally.hp;
    expect(detonatePins(state, 3), "爆ぜない").toBe(0);
    expect(ally.hp, "傷つかない").toBe(hp);
  });
});
