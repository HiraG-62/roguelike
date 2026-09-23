import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { TRIGGER } from "../data/tuning";
import type { TriggeredEffect } from "../loot/types";
import { applyStatus, findStatus, hasStatus } from "./statusEffects";
import { arena, engageStartRoom, placeEnemy } from "./testHelpers";
import { conditionMet, fireTrigger, inflictApply } from "./triggers";

/** トリガー文法の発火（2026-09 追加の条件と効果）の検査 */

const FAR = 100;

function withTrigger(effect: Omit<TriggeredEffect, "chance">): GameState {
  const state = arena(5, { triggers: [{ ...effect, chance: 1 }] });
  for (const r of state.rooms) r.locked = false;
  return state;
}

describe("条件", () => {
  it("roomLocked（交戦中）: 封鎖しない部屋の交戦でも真、交戦していなければ偽", () => {
    const state = withTrigger({ trigger: "onHurt", condition: "roomLocked", effect: "speedBuff", magnitude: 10, duration: 1 });
    expect(conditionMet(state, "roomLocked", { pos: state.player.body.pos }), "交戦前").toBe(false);
    engageStartRoom(state);
    expect(conditionMet(state, "roomLocked", { pos: state.player.body.pos }), "交戦中").toBe(true);
  });

  it("対象を見る条件: 予備動作中・堅守中・状態異常 2 種以上・エリート", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", FAR);
    const ctx = { pos: e.body.pos, targetId: e.id };
    e.phase = "chase";
    expect(conditionMet(state, "targetInWindup", ctx)).toBe(false);
    e.phase = "windup";
    expect(conditionMet(state, "targetInWindup", ctx)).toBe(true);
    expect(conditionMet(state, "targetInWindup", { pos: e.body.pos }), "対象が無ければ偽").toBe(false);
    expect(conditionMet(state, "targetMultiStatus", ctx)).toBe(false);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 5, potency: 0.01 }, "player");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "weaken", stacks: 1, duration: 5, potency: 0.25 }, "player");
    expect(conditionMet(state, "targetMultiStatus", ctx)).toBe(true);
    expect(conditionMet(state, "targetElite", ctx)).toBe(false);
    e.elite = "hasted";
    expect(conditionMet(state, "targetElite", ctx)).toBe(true);
  });

  it("マナ満タン・マナ残りわずか・自分が状態異常中", () => {
    const state = arena();
    state.player.mana = state.stats.maxMana;
    expect(conditionMet(state, "manaFull")).toBe(true);
    expect(conditionMet(state, "manaLow")).toBe(false);
    state.player.mana = 0;
    expect(conditionMet(state, "manaLow")).toBe(true);
    expect(conditionMet(state, "selfAfflicted")).toBe(false);
    applyStatus(state, { kind: "player" }, { kind: "poison", stacks: 1, duration: 3, potency: 0.005 }, "enemy");
    expect(conditionMet(state, "selfAfflicted")).toBe(true);
  });
});

describe("効果", () => {
  it("restoreMana: マナを回収する", () => {
    const state = withTrigger({ trigger: "onDash", condition: "always", effect: "restoreMana", magnitude: 12 });
    state.player.mana = 0;
    fireTrigger(state, "onDash", { pos: state.player.body.pos });
    expect(state.player.mana).toBeCloseTo(12 * state.stats.manaGainMul);
  });

  it("addPoise: 対象に怯み値、対象がいなければ周囲の敵へ", () => {
    const state = withTrigger({ trigger: "onJustDodge", condition: "always", effect: "addPoise", magnitude: 5 });
    const e = placeEnemy(state, "slime", 10);
    e.phase = "chase";
    fireTrigger(state, "onJustDodge", { pos: state.player.body.pos });
    expect(e.poise.damage).toBeGreaterThan(0);
  });

  it("inflict: 指定の状態異常を付ける。行動停止系は長さを抑える", () => {
    const state = withTrigger({ trigger: "onMeleeHit", condition: "always", effect: "inflict", magnitude: 3, status: "vulnerable" });
    const e = placeEnemy(state, "slime", FAR);
    fireTrigger(state, "onMeleeHit", { pos: e.body.pos, targetId: e.id });
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
    expect(inflictApply("freeze", 5).duration).toBe(TRIGGER.inflictHaltMax);
    expect(inflictApply("burn", 3).potency).toBe(TRIGGER.inflictBurnDps);
  });

  it("cleanse: 自分の状態異常を 1 つ払う", () => {
    const state = withTrigger({ trigger: "onHurt", condition: "selfAfflicted", effect: "cleanse", magnitude: 1 });
    applyStatus(state, { kind: "player" }, { kind: "poison", stacks: 1, duration: 3, potency: 0.005 }, "enemy");
    fireTrigger(state, "onHurt", { pos: state.player.body.pos });
    expect(hasStatus(state.player.status, "poison")).toBe(false);
  });

  it("extendStatus: 状態異常を延ばす（上限あり、行動停止は延ばさない）", () => {
    const state = withTrigger({ trigger: "onMeleeHit", condition: "always", effect: "extendStatus", magnitude: 2 });
    const e = placeEnemy(state, "slime", FAR);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 3, potency: 0.01 }, "player");
    fireTrigger(state, "onMeleeHit", { pos: e.body.pos, targetId: e.id });
    expect(findStatus(e.status, "poison")?.time).toBeCloseTo(5);
  });

  it("skillHaste: 全スロットの再使用時間と最低間隔を縮める", () => {
    const state = withTrigger({ trigger: "onKill", condition: "always", effect: "skillHaste", magnitude: 1 });
    for (const slot of state.skills.slots) {
      slot.cooldownLeft = 3;
      slot.intervalLeft = 0.5;
    }
    fireTrigger(state, "onKill", { pos: state.player.body.pos });
    for (const slot of state.skills.slots) {
      expect(slot.cooldownLeft).toBeCloseTo(2);
      expect(slot.intervalLeft).toBe(0);
    }
  });

  it("volley: 照準の方向へ射撃の弾（kind ranged）を撃つ", () => {
    const state = withTrigger({ trigger: "onDash", condition: "always", effect: "volley", magnitude: 100, count: 2 });
    const before = state.projectiles.length;
    fireTrigger(state, "onDash", { pos: state.player.body.pos });
    const shots = state.projectiles.slice(before);
    expect(shots).toHaveLength(2);
    for (const s of shots) {
      expect(s.kind).toBe("ranged");
      expect(s.owner).toBe("player");
      expect(s.vel.x, "向き（右）へ飛ぶ").toBeGreaterThan(0);
    }
  });

  it("healMissing: 失った HP の割合を回復する", () => {
    const state = withTrigger({ trigger: "onRoomClear", condition: "always", effect: "healMissing", magnitude: 50 });
    state.player.hp = state.player.maxHp - 40;
    fireTrigger(state, "onRoomClear", { pos: state.player.body.pos });
    expect(state.player.hp).toBeCloseTo(state.player.maxHp - 20);
  });

  it("内部クールダウンで同じトリガーは連続しない", () => {
    const state = withTrigger({ trigger: "onDash", condition: "always", effect: "restoreMana", magnitude: 5 });
    state.player.mana = 0;
    fireTrigger(state, "onDash", { pos: state.player.body.pos });
    fireTrigger(state, "onDash", { pos: state.player.body.pos });
    expect(state.player.mana).toBeCloseTo(5 * state.stats.manaGainMul);
  });
});
