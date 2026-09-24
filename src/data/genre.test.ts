import { describe, expect, it } from "vitest";
import "../core/game";
import type { AttackGenre } from "../core/element";
import type { Scaling } from "../loot/types";
import { SKILL, SKILL_ATTACK, SKILL_DEFS } from "../skills/data";
import { EXTRA_SKILL_TUNING } from "../skills/tuning";
import { scaledAtBase, scalingFitsGenre } from "../system/attributes";
import { PLAYER } from "./tuning";
import { BURST_ATTACK, MOVESETS, SHOT_TYPES } from "./weapons";

/**
 * 攻撃ジャンルと参照ステータスの揃え（docs/COMBAT_DESIGN.md A-8）。
 * 「ジャンルごとに参照ステータスをある程度揃える」を、全攻撃の Scaling がジャンルの主か副を含むことで固定する
 */

const ATTR_FIELDS = new Set(["base", "str", "dex", "vit", "mnd", "spi"]);

function isScaling(v: unknown): v is Scaling {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.base === "number" && Object.keys(r).every((k) => ATTR_FIELDS.has(k));
}

/** 定義ブロックの中の Scaling をすべて拾う（damage / tickDamage / shardDamage …） */
function collectScalings(v: unknown, out: Scaling[] = []): Scaling[] {
  if (isScaling(v)) {
    out.push(v);
    return out;
  }
  if (v && typeof v === "object") for (const child of Object.values(v)) collectScalings(child, out);
  return out;
}

function expectFits(scalings: readonly Scaling[], genre: AttackGenre, label: string): void {
  for (const s of scalings) expect(scalingFitsGenre(s, genre), `${label}: ${JSON.stringify(s)} が ${genre.range}・${genre.quality} の参照ステータスを含まない`).toBe(true);
}

describe("武器種・射撃の型・必殺のジャンル", () => {
  it("武器種の全段・ダッシュ攻撃・派生・溜めがジャンルの参照ステータスで伸びる", () => {
    for (const m of Object.values(MOVESETS)) {
      const steps = [...m.steps, m.dashAttack, ...m.branches.map((b) => b.step), ...(m.charge ? [m.charge.step] : [])];
      expectFits(steps.map((s) => s.scaling), m.attack.genre, m.key);
    }
  });

  it("射撃の型はすべて射撃の Scaling（技巧）と揃う", () => {
    for (const s of Object.values(SHOT_TYPES)) expectFits([PLAYER.shoot.scaling], s.attack.genre, s.key);
  });

  it("必殺は範囲・魔法（精神 + 霊力）", () => {
    expectFits([PLAYER.special.scaling], BURST_ATTACK.genre, "必殺");
  });
});

describe("スキルのジャンル", () => {
  it("与ダメを持つスキルは素性を持ち、持たないスキルは null", () => {
    for (const def of Object.values(SKILL_DEFS)) {
      const atk = SKILL_ATTACK[def.key];
      if (def.damageKind === "none") expect(atk, `${def.key}`).toBeNull();
      else expect(atk, `${def.key}`).not.toBeNull();
    }
  });

  it("スキルの Scaling はすべて素性のジャンルの参照ステータスを含む", () => {
    const blocks: Readonly<Record<string, unknown>> = { ...SKILL, ...EXTRA_SKILL_TUNING };
    for (const def of Object.values(SKILL_DEFS)) {
      const atk = SKILL_ATTACK[def.key];
      if (!atk) continue;
      const scalings = collectScalings(blocks[def.key]);
      expect(scalings.length, `${def.key} の Scaling が見つからない`).toBeGreaterThan(0);
      expectFits(scalings, atk.genre, def.key);
    }
  });

  it("霊力以外（筋力・技巧・体力）を参照するスキルもある", () => {
    const blocks: Readonly<Record<string, unknown>> = { ...SKILL, ...EXTRA_SKILL_TUNING };
    const all = Object.values(SKILL_DEFS).flatMap((d) => collectScalings(blocks[d.key]));
    for (const attr of ["str", "dex", "vit"] as const) {
      expect(all.some((s) => (s[attr] ?? 0) > 0), `${attr} を参照するスキル`).toBe(true);
    }
  });

  it("ジャンルの付与で既定ステータスの威力は変わらない（Scaling の数値は触っていない）", () => {
    // 回帰の目印: 地裂き（範囲・物理）は基礎値で 12.7 + 1.6*5 + 0.8*5
    expect(scaledAtBase(SKILL.quake.damage)).toBeCloseTo(12.7 + 1.6 * 5 + 0.8 * 5);
  });
});
