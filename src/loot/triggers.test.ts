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
import { SLOTS, TRAIT_COLORS } from "./types";
import { INFLICT_COLOR, INFLICT_KINDS } from "./triggers";
import { traitColorOf, triggerCanBeColor } from "./colors";
import { rollTraitOfColor } from "./generator";
import { TRIGGER } from "../data/tuning";

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
        const roll = generateTriggerRoll(rng, 20, slot);
        expect(roll.kind).toBeUndefined();
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
      const roll = triggerToRoll(effect);
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
    ).toBe("撃破時（生命 50% 未満）: 40% で3.5 秒間ダメージ +25%を得る");
  });

  it("invuln は生成時に TRIGGER.invulnMax を超えない", () => {
    const rng = createRng(31);
    const shapes = TRIGGER_GRAMMAR.filter((shape) => shape.effect === "invuln");
    expect(shapes.length).toBeGreaterThan(0);
    for (let i = 0; i < MANY; i++) {
      const shape = shapes[i % shapes.length];
      if (shape === undefined) continue;
      const effect = rollTriggerEffect(rng, shape, 1 + (i % HIGH_LEVEL));
      expect(effect.magnitude).toBeLessThanOrEqual(TRIGGER.invulnMax);
    }
  });

  it("上限を超えた invuln（揺らぎの上振れ・旧セーブ）は復元時に上限へ切り詰める", () => {
    const decoded = decodeTriggerRoll({ key: "tr:onHurt:always:invuln", value: 0.9, value2: 400 });
    expect(decoded?.magnitude).toBe(TRIGGER.invulnMax);
    expect(formatTrigger(decoded ?? { trigger: "onHurt", condition: "always", effect: "invuln", magnitude: 0, chance: 0 })).toBe(
      `被弾時: 40% で${TRIGGER.invulnMax} 秒間無敵になる`,
    );
  });
});

describe("トリガー文法の拡張（2026-09）", () => {
  it("新しい起点・条件・効果が文法に入り、固定専用の効果（healMissing）は出ない", () => {
    const triggers = new Set(TRIGGER_GRAMMAR.map((s) => s.trigger));
    const conditions = new Set(TRIGGER_GRAMMAR.map((s) => s.condition));
    const effects = new Set(TRIGGER_GRAMMAR.map((s) => s.effect));
    for (const t of ["onStagger", "onCounter"] as const) expect(triggers.has(t), t).toBe(true);
    for (const c of ["manaFull", "manaLow", "targetInWindup", "targetMultiStatus", "targetGuarded", "targetElite", "selfAfflicted"] as const) {
      expect(conditions.has(c), c).toBe(true);
    }
    for (const e of ["restoreMana", "addPoise", "inflict", "cleanse", "extendStatus", "skillHaste", "volley"] as const) {
      expect(effects.has(e), e).toBe(true);
    }
    expect(effects.has("healMissing")).toBe(false);
  });

  it("対象を見る条件は対象の無い起点と組まない。常に真 / 偽の組も外す", () => {
    expect(isCompatible("onShoot", "targetInWindup", "shockwave")).toBe(false);
    expect(isCompatible("onDash", "targetElite", "heal")).toBe(false);
    expect(isCompatible("onCounter", "targetInWindup", "shockwave")).toBe(false);
    expect(isCompatible("onStagger", "targetInWindup", "shockwave")).toBe(false);
    expect(isCompatible("onMeleeHit", "targetInWindup", "addPoise")).toBe(true);
    expect(isCompatible("onKill", "targetElite", "damageBuff")).toBe(true);
  });

  it("除外表: 満タン × マナ回収 / 枯渇 × スキル短縮 / 部屋クリア × 敵向け / 払いは自分が状態異常中だけ", () => {
    expect(isCompatible("onKill", "manaFull", "restoreMana")).toBe(false);
    expect(isCompatible("onKill", "manaLow", "skillHaste")).toBe(false);
    expect(isCompatible("onRoomClear", "always", "inflict")).toBe(false);
    expect(isCompatible("onShoot", "always", "volley")).toBe(false);
    expect(isCompatible("onHurt", "always", "cleanse")).toBe(false);
    expect(isCompatible("onHurt", "selfAfflicted", "cleanse")).toBe(true);
  });

  it("inflict は状態異常の種類をキーに持ち、往復で復元できる", () => {
    const rng = createRng(19);
    const shape = TRIGGER_GRAMMAR.find((s) => s.effect === "inflict");
    expect(shape).toBeDefined();
    if (shape === undefined) return;
    for (let i = 0; i < 50; i++) {
      const effect = rollTriggerEffect(rng, shape, 10);
      expect(INFLICT_KINDS).toContain(effect.status);
      const decoded = decodeTriggerRoll(triggerToRoll(effect));
      expect(decoded?.status).toBe(effect.status);
      expect(formatTrigger(effect)).toContain("にする");
    }
    expect(decodeTriggerRoll({ key: "tr:onKill:always:inflict", value: 3, value2: 1000 }), "種類の無い inflict は壊れたデータ").toBeNull();
    expect(decodeTriggerRoll({ key: "tr:onKill:always:inflict:@stagger", value: 3, value2: 1000 }), "怯みは付けられない").toBeNull();
  });

  it("芽・染めで色を指定すると、inflict もその色の状態異常を選ぶ", () => {
    const rng = createRng(23);
    for (const color of TRAIT_COLORS) {
      for (let i = 0; i < 40; i++) {
        const roll = rollTraitOfColor(rng, "ring", color, new Set(), { depth: 12, foundDepth: 12 });
        expect(roll === undefined ? undefined : traitColorOf(roll), `${color}`).toBe(color);
      }
    }
    const inflict = TRIGGER_GRAMMAR.find((s) => s.effect === "inflict" && s.condition === "always");
    expect(inflict).toBeDefined();
    if (inflict === undefined) return;
    for (const color of TRAIT_COLORS) {
      expect(triggerCanBeColor(inflict, color), color).toBe(INFLICT_KINDS.some((k) => INFLICT_COLOR[k] === color));
    }
  });
});
