import { describe, expect, it } from "vitest";
import "../core/game";
import type { Scaling } from "../loot/types";
import { SKILL, SKILL_ATTACK, SKILL_DEFS } from "../skills/data";
import { EXTRA_SKILL_TUNING } from "../skills/tuning";
import { scaledAtBase } from "../system/attributes";
import { PLAYER } from "./tuning";
import { BURST_ATTACK, MOVESETS } from "./weapons";
import { BULLETS } from "../loot/bullets";

/**
 * 攻撃ジャンルと係数表（docs/COMBAT_DESIGN.md A-8 / A-10）。
 * 参照ステータスはジャンルで縛らない（行動ごとに自由）。ここでは係数表の形と素性の有無だけを検査する
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

/** 係数は有限・非負で、ステータスが基礎値のときの威力は負にならない */
function expectSane(scalings: readonly Scaling[], label: string): void {
  for (const s of scalings) {
    for (const [k, v] of Object.entries(s)) {
      expect(Number.isFinite(v), `${label}: ${k} が有限でない`).toBe(true);
      if (k !== "base") expect(v, `${label}: ${k} の係数が負`).toBeGreaterThanOrEqual(0);
    }
    expect(scaledAtBase(s), `${label}: 基礎値での威力が負 ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(0);
  }
}

describe("武器種・銃の弾・必殺の係数", () => {
  it("武器種の全段・ダッシュ攻撃・派生・溜めの係数表が正しい形", () => {
    for (const m of Object.values(MOVESETS)) {
      const steps = [...m.steps, m.dashAttack, ...m.branches.map((b) => b.step), ...(m.charge ? [m.charge.step] : [])];
      expectSane(steps.map((s) => s.scaling), m.key);
    }
  });

  it("弾と必殺の係数表が正しい形", () => {
    expectSane([PLAYER.shoot.scaling, PLAYER.special.scaling], "射撃・必殺");
    for (const s of Object.values(BULLETS)) if (s.scaling) expectSane([s.scaling], s.key);
  });

  it("必殺の素性は範囲・魔法", () => {
    expect(BURST_ATTACK.genre).toEqual({ range: "area", quality: "arcane" });
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

  it("与ダメを持つスキルは係数表を持ち、形が正しい（参照ステータスはジャンルで縛らない。A-10）", () => {
    const blocks: Readonly<Record<string, unknown>> = { ...SKILL, ...EXTRA_SKILL_TUNING };
    for (const def of Object.values(SKILL_DEFS)) {
      const atk = SKILL_ATTACK[def.key];
      if (!atk) continue;
      const scalings = collectScalings(blocks[def.key]);
      expect(scalings.length, `${def.key} の Scaling が見つからない`).toBeGreaterThan(0);
      expectSane(scalings, def.key);
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
