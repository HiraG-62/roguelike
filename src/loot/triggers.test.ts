import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import {
  EFFECT_SPECS,
  MAX_TRIGGER_CHANCE,
  MIN_TRIGGER_CHANCE,
  SLOT_TRIGGERS,
  TRIGGER_GRAMMAR,
  decodeTriggerRoll,
  formatTrigger,
  generateTrigger,
  generateTriggerRoll,
  isCompatible,
  rollTriggerEffect,
  triggerToRoll,
} from "./triggers";
import { SLOTS } from "./types";

const MANY = 1000;
const LOW_LEVEL = 1;
const HIGH_LEVEL = 40;

describe("トリガー文法", () => {
  it("組み合わせ表は相性の悪い組み合わせを含まない", () => {
    expect(isCompatible("onShoot", "always", "spawnBullets")).toBe(false);
    expect(isCompatible("onKill", "always", "explode")).toBe(false);
    expect(isCompatible("onRoomClear", "always", "shockwave")).toBe(false);
    expect(isCompatible("onRoomClear", "roomLocked", "heal")).toBe(false);
    expect(isCompatible("onMeleeHit", "always", "invuln")).toBe(false);
    for (const shape of TRIGGER_GRAMMAR) {
      expect(isCompatible(shape.trigger, shape.condition, shape.effect)).toBe(true);
    }
  });

  it("十分な数の組み合わせがある", () => {
    expect(TRIGGER_GRAMMAR.length).toBeGreaterThan(300);
  });

  it("itemLevel が高くても magnitude は effect ごとの cap を超えない", () => {
    const rng = createRng(7);
    const veryHighLevel = 200;
    for (let i = 0; i < 20; i++) {
      for (const shape of TRIGGER_GRAMMAR) {
        const effect = rollTriggerEffect(rng, shape, veryHighLevel);
        const spec = EFFECT_SPECS[effect.effect];
        if (spec.cap !== undefined) expect(effect.magnitude).toBeLessThanOrEqual(spec.cap);
      }
    }
  });

  it("同 seed で同じ効果、生成物は有効な組み合わせで chance は 0.15〜0.6", () => {
    expect(generateTrigger(createRng(5), 10)).toEqual(generateTrigger(createRng(5), 10));
    const rng = createRng(8);
    for (let i = 0; i < MANY; i++) {
      const t = generateTrigger(rng, 1 + (i % HIGH_LEVEL));
      expect(isCompatible(t.trigger, t.condition, t.effect)).toBe(true);
      expect(t.chance).toBeGreaterThanOrEqual(MIN_TRIGGER_CHANCE);
      expect(t.chance).toBeLessThanOrEqual(MAX_TRIGGER_CHANCE);
      expect(t.magnitude).toBeGreaterThan(0);
      if (t.trigger === "everyNthMeleeHit") expect(t.every).toBeDefined();
      if (t.effect === "spawnBullets") expect(t.count).toBeDefined();
    }
  });

  it("magnitude は itemLevel でスケールする", () => {
    const total = (level: number): number => {
      const rng = createRng(77);
      let sum = 0;
      for (let i = 0; i < MANY; i++) {
        const t = generateTrigger(rng, level);
        if (t.effect === "shockwave" || t.effect === "chainLightning") sum += t.magnitude;
      }
      return sum;
    };
    expect(total(HIGH_LEVEL)).toBeGreaterThan(total(LOW_LEVEL) * 2);
  });

  it("generateTriggerRoll はスロットに合ったトリガーだけを出す", () => {
    const rng = createRng(21);
    for (const slot of SLOTS) {
      for (let i = 0; i < 200; i++) {
        const roll = generateTriggerRoll(rng, 20, slot, "suffix");
        expect(roll.kind).toBe("suffix");
        const decoded = decodeTriggerRoll(roll);
        expect(decoded).not.toBeNull();
        if (decoded === null) continue;
        expect(SLOT_TRIGGERS[slot]).toContain(decoded.trigger);
      }
    }
  });

  it("AffixRoll へのエンコード → デコードで元に戻る（可逆）", () => {
    const rng = createRng(13);
    for (let i = 0; i < MANY; i++) {
      const effect = generateTrigger(rng, 1 + (i % HIGH_LEVEL));
      const roll = triggerToRoll(effect, "prefix");
      expect(roll.key.startsWith(`tr:${effect.trigger}:${effect.condition}:${effect.effect}`)).toBe(true);
      expect(decodeTriggerRoll(roll)).toEqual(effect);
    }
  });

  it("不正な key は null", () => {
    const bad = [
      "tr:onKill:always",
      "tr:onKill:nope:heal",
      "tr:onKill:always:heal:zz",
      "ks_blink",
      "tr_onKill_always_heal",
    ];
    for (const key of bad) {
      expect(decodeTriggerRoll({ key, kind: "prefix", tier: 1, value: 1, value2: 300 }), key).toBeNull();
    }
  });

  it("formatTrigger が日本語文を作る", () => {
    expect(
      formatTrigger({
        trigger: "everyNthMeleeHit",
        every: 5,
        condition: "comboAbove10",
        effect: "shockwave",
        magnitude: 30,
        chance: 0.5,
      }),
    ).toBe("5回に1回の近接攻撃時（10 コンボ以上）: 50% で衝撃波を放つ（30 ダメージ）");
    expect(
      formatTrigger({
        trigger: "onKill",
        condition: "belowHalfHp",
        effect: "damageBuff",
        magnitude: 25,
        duration: 3.5,
        chance: 0.4,
      }),
    ).toBe("撃破時（HP 50% 未満）: 40% で3.5 秒間ダメージ +25%を得る");
  });
});
