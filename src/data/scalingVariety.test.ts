import { describe, expect, it } from "vitest";
import "../core/game";
import { ATTR_KEYS, COMBAT_ATTR_KEYS, type AttrKey, type AttrRatio, type Scaling } from "../loot/types";
import { SKILL, SKILL_ATTACK, SKILL_DEFS } from "../skills/data";
import { scaledAtBase } from "../system/attributes";
import { combat as combatJson, skills as skillsJson, ultimates as ultimatesJson, weapons as weaponsJson } from "./balance/assembled.gen";
import { PLAYER } from "./tuning";
import { BULLETS } from "../loot/bullets";
import { MOVESETS, movesetAttrTotals } from "./weapons";

/**
 * 行動ごとの係数の振り直し（docs/COMBAT_DESIGN.md A-10、2026-09-24）。
 * 参照ステータスは行動の中身から決める（筋力 = 重さ・押し込み / 技巧 = 速さ・精度・刃 / 体力 = 体を張る /
 * 精神 = 集中・溜め / 霊力 = 魔法・闇・状態異常）。今の係数表の参照先と制約を検査する。
 */

const FLOAT_DIGITS = 6;
/** 怯み値の係数は「怯み値 × 3% / 点」前後（丸めの誤差を含めて 2〜4%） */
const POISE_RATIO_MIN = 0.02;
const POISE_RATIO_MAX = 0.04;
/**
 * ステータスを参照しない（基礎値だけの）行動。道具・仕掛け・固定の爆発に限る
 * （JSON のパス。振り直し前の表に無い弾は bullets.<ベース>.* / steps2[n].throw.bullet.* で書く）
 */
const FIXED_ACTIONS: readonly string[] = [
  "skills.SKILL.mines.damage",
  "skills.EXTRA_SKILL_TUNING.powderKeg.damage",
  "skills.EXTRA_SKILL_TUNING.turret.damage",
  "weapons.WEAPON.bullets.mineLauncher.scaling",
  "weapons.WEAPON.bullets.caltrops.scaling",
  "weapons.WEAPON.movesets.trapper.steps2[0].throw.bullet.scaling",
  // 仕掛けの撒き散らしは設置弾（仕掛け）なので固定値
  "weapons.WEAPON.movesets.trapper.steps2[0].throw.scaling",
];

/** 右レーンの段・派生の係数表 */
const LANE_TABLE = /^weapons\.WEAPON\.movesets\.\w+\.(steps2\[\d+\]\.(step|throw)|branches\.\w+\.step)\.scaling$/;
/** 陰陽師・巫女のジョブ固有派生の係数表 */
const NEW_JOB_BRANCH_TABLE = /^weapons\.WEAPON\.jobBranches\.(onmyoji|miko)\.scaling$/;

const ATTR_FIELDS = new Set(["base", ...ATTR_KEYS]);

function isScaling(v: unknown): v is Scaling {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.base === "number" && Object.keys(r).every((k) => ATTR_FIELDS.has(k));
}

/** JSON の中の Scaling をパスつきで全部拾う（振り直し前の表と同じパスの書き方） */
function collectPaths(v: unknown, path: string, out: Map<string, Scaling>): Map<string, Scaling> {
  if (Array.isArray(v)) {
    v.forEach((c, i) => collectPaths(c, `${path}[${i}]`, out));
    return out;
  }
  if (isScaling(v)) {
    out.set(path, v);
    return out;
  }
  if (v && typeof v === "object") {
    for (const [k, c] of Object.entries(v)) if (k !== "_note") collectPaths(c, `${path}.${k}`, out);
  }
  return out;
}

function collectScalings(v: unknown, out: Scaling[] = []): Scaling[] {
  if (isScaling(v)) {
    out.push(v);
    return out;
  }
  if (v && typeof v === "object") for (const c of Object.values(v)) collectScalings(c, out);
  return out;
}

function coefSum(s: Readonly<AttrRatio>): number {
  return ATTR_KEYS.reduce((a, k) => a + (s[k] ?? 0), 0);
}

function refs(s: Readonly<AttrRatio>): AttrKey[] {
  return ATTR_KEYS.filter((k) => (s[k] ?? 0) > 0);
}

/** 係数が最大のステータス（同率なら全部） */
function mainAttrs(s: Readonly<AttrRatio>): AttrKey[] {
  const max = Math.max(...ATTR_KEYS.map((k) => s[k] ?? 0));
  if (max <= 0) return [];
  return ATTR_KEYS.filter((k) => (s[k] ?? 0) === max);
}

function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 当たり判定を持たない純粋な詠唱・投げ（size 0 で cast を持つ振り）か */
function isPureCast(step: unknown): boolean {
  return isRecordValue(step) && step.size === 0 && step.cast !== undefined;
}

/**
 * 純粋な詠唱・投げの振り（手裏剣の左右・戦輪の近投げ・強化投げ）の係数表のパス。
 * 振りそのものは当たらず弾（cast）が威力を持つので、振りの係数表は形を満たすだけの基礎値
 */
function pureCastPaths(): Set<string> {
  const out = new Set<string>();
  const movesets: unknown = weaponsJson.WEAPON.movesets;
  if (!isRecordValue(movesets)) return out;
  for (const [key, m] of Object.entries(movesets)) {
    if (!isRecordValue(m)) continue;
    const steps = Array.isArray(m.steps) ? m.steps : [];
    steps.forEach((step: unknown, i) => {
      if (isPureCast(step)) out.add(`weapons.WEAPON.movesets.${key}.steps[${i}].scaling`);
    });
    const lane = Array.isArray(m.steps2) ? m.steps2 : [];
    lane.forEach((s: unknown, i) => {
      if (isRecordValue(s) && isPureCast(s.step)) out.add(`weapons.WEAPON.movesets.${key}.steps2[${i}].step.scaling`);
    });
  }
  return out;
}

const CURRENT = new Map<string, Scaling>();
collectPaths(weaponsJson, "weapons", CURRENT);
collectPaths(skillsJson, "skills", CURRENT);
collectPaths(combatJson, "combat", CURRENT);
collectPaths(ultimatesJson, "ultimates", CURRENT);

interface Action {
  readonly label: string;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
}

/** 武器種ごとの全行動（左の段・ダッシュ攻撃・派生・溜め・右レーンの段） */
function movesetActions(key: keyof typeof MOVESETS): Action[] {
  const m = MOVESETS[key];
  const out: Action[] = [];
  m.steps.forEach((s, i) => out.push({ label: `weapons.WEAPON.movesets.${key}.steps[${i}].poiseRatio`, ...s }));
  out.push({ label: `weapons.WEAPON.movesets.${key}.dashAttack.poiseRatio`, ...m.dashAttack });
  for (const b of m.branches) out.push({ label: `weapons.WEAPON.movesets.${key}.branches.${b.key}.step.poiseRatio`, ...b.step });
  if (m.charge) out.push({ label: `weapons.WEAPON.movesets.${key}.charge.step.poiseRatio`, ...m.charge.step });
  // 右レーン（アクション 2）の振り・弾・溜めの段
  m.steps2.forEach((s, i) => {
    const label = `weapons.WEAPON.movesets.${key}.steps2[${i}].poiseRatio`;
    if (s.kind === "swing") out.push({ label, ...s.step });
    if (s.kind === "volley") out.push({ label, ...s.throw });
    if (s.kind === "charge") out.push({ label, ...s.charge.step });
  });
  return out;
}

const MOVESET_KEYS = Object.keys(MOVESETS) as (keyof typeof MOVESETS)[];
const WEAPON_ACTIONS: readonly Action[] = MOVESET_KEYS.flatMap(movesetActions);

/** 与ダメを持つスキルの係数表 */
const SKILL_BLOCKS: Readonly<Record<string, unknown>> = SKILL;
const SKILL_SCALINGS: readonly { key: string; scaling: Scaling }[] = Object.values(SKILL_DEFS)
  .filter((d) => SKILL_ATTACK[d.key] !== null)
  .flatMap((d) => collectScalings(SKILL_BLOCKS[d.key]).map((scaling) => ({ key: d.key, scaling })));

const SHOT_SCALINGS: readonly Scaling[] = Object.values(BULLETS).map((s) => s.scaling ?? PLAYER.shoot.scaling);

const ALL_SCALINGS: readonly Scaling[] = [...WEAPON_ACTIONS.map((a) => a.scaling), ...SKILL_SCALINGS.map((s) => s.scaling), ...SHOT_SCALINGS];

describe("係数表の関係", () => {
  it("右レーンとジョブ派生の係数表がある", () => {
    const paths = [...CURRENT.keys()];
    expect(paths.some((path) => LANE_TABLE.test(path)), "weapons.WEAPON.movesets の右レーン・派生").toBe(true);
    expect(paths.some((path) => NEW_JOB_BRANCH_TABLE.test(path)), "weapons.WEAPON.jobBranches.onmyoji / miko").toBe(true);
  });

  it("全行動の基礎値での威力と係数は有限で非負", () => {
    expect(CURRENT.size, "係数表が見つかる").toBeGreaterThan(0);
    for (const [path, scaling] of CURRENT) {
      expect(Number.isFinite(scaledAtBase(scaling)), `${path} の基礎値`).toBe(true);
      expect(scaledAtBase(scaling), `${path} の基礎値`).toBeGreaterThanOrEqual(0);
      expect(coefSum(scaling), `${path} の係数合計`).toBeGreaterThanOrEqual(0);
    }
  });

  it("弾はどれも基礎値で 1 発の威力が共通の係数表と同じ", () => {
    for (const s of Object.values(BULLETS)) {
      expect(scaledAtBase(s.scaling ?? PLAYER.shoot.scaling), `weapons.WEAPON.bullets.${s.key}.scaling の基礎値での威力`).toBeCloseTo(scaledAtBase(PLAYER.shoot.scaling), FLOAT_DIGITS);
    }
  });
});

describe("参照ステータスが行動ごとに違う", () => {
  // 「5 色 = 5 ステータス」の枠は防御 def を含まないので、この判定は COMBAT_ATTR_KEYS で見る
  it("武器種ごとの主な参照先（全行動の係数の合計が最大のステータス）が 5 ステータスすべてに散らばる", () => {
    const mains = new Set<AttrKey>();
    for (const key of MOVESET_KEYS) {
      // 集計は本体の movesetAttrTotals（地金の武器の主参照と同じ）を使う
      const all = movesetAttrTotals(key);
      const total: Partial<Record<AttrKey, number>> = {};
      for (const k of COMBAT_ATTR_KEYS) total[k] = all[k];
      for (const k of mainAttrs(total)) mains.add(k);
    }
    expect([...mains].sort(), "武器種の主な参照先").toEqual([...COMBAT_ATTR_KEYS].sort());
  });

  it("武器種の 1 段目の参照ステータスの組は 6 種類以上ある（全武器種が同じ型ではない）", () => {
    const sigs = new Set<string>();
    for (const key of MOVESET_KEYS) {
      const first = MOVESETS[key].steps[0];
      if (first) sigs.add(refs(first.scaling).join("+"));
    }
    expect(sigs.size, [...sigs].join(" / ")).toBeGreaterThanOrEqual(6);
  });

  it("5 ステータスそれぞれを主に参照する行動が、武器とスキルの両方にある", () => {
    for (const k of COMBAT_ATTR_KEYS) {
      expect(WEAPON_ACTIONS.some((a) => mainAttrs(a.scaling).includes(k)), `${k} を主に参照する武器の行動`).toBe(true);
      expect(SKILL_SCALINGS.some((s) => mainAttrs(s.scaling).includes(k)), `${k} を主に参照するスキル`).toBe(true);
    }
  });

  it("防御 def を主に参照する行動がある（盾のダッシュ攻撃）", () => {
    expect(WEAPON_ACTIONS.some((a) => mainAttrs(a.scaling).includes("def")), "防御を主に参照する武器の行動").toBe(true);
  });

  it("3 種以上を参照する行動と、5 種すべてを参照する行動がある", () => {
    expect(ALL_SCALINGS.filter((s) => refs(s).length >= 3).length, "3 種以上を参照する行動").toBeGreaterThanOrEqual(5);
    expect(ALL_SCALINGS.some((s) => refs(s).length === COMBAT_ATTR_KEYS.length), "5 種すべてを参照する行動").toBe(true);
  });

  it("ステータスを参照しない行動は数個（3〜8）だけで、表に挙げたもの（当たらない純粋な投げの振りは除く）", () => {
    const pure = pureCastPaths();
    const fixed = [...CURRENT].filter(([p, s]) => coefSum(s) === 0 && !pure.has(p)).map(([p]) => p);
    expect(fixed.sort()).toEqual([...FIXED_ACTIONS].sort());
    expect(fixed.length).toBeGreaterThanOrEqual(3);
    // 設置弾は器ごとに弾を持つので、置き撃ち筒・撒き菱筒・撒き散らしの 3 つに分かれる
    expect(fixed.length).toBeLessThanOrEqual(8);
  });
});

describe("怯み値・状態異常の係数", () => {
  it("武器の段の怯み値の係数は、合計が怯み値 × 2〜4% / 点に収まる", () => {
    const withRatio = WEAPON_ACTIONS.filter((a) => a.poiseRatio !== undefined);
    expect(withRatio.length, "怯み値の係数を持つ段").toBeGreaterThan(0);
    for (const a of withRatio) {
      const sum = coefSum(a.poiseRatio ?? {});
      expect(sum, `${a.label}`).toBeGreaterThanOrEqual(a.poise * POISE_RATIO_MIN);
      expect(sum, `${a.label}`).toBeLessThanOrEqual(a.poise * POISE_RATIO_MAX);
    }
  });

  it("スキルの怯み値の係数は SkillDef に通り、合計が怯み値 × 2〜4% / 点に収まる", () => {
    const withRatio = Object.values(SKILL_DEFS).filter((d) => d.poiseRatio !== undefined);
    expect(withRatio.length, "怯み値の係数を持つスキル").toBeGreaterThan(20);
    for (const d of withRatio) {
      const sum = coefSum(d.poiseRatio ?? {});
      expect(sum, d.key).toBeGreaterThanOrEqual(d.poise * POISE_RATIO_MIN);
      expect(sum, d.key).toBeLessThanOrEqual(d.poise * POISE_RATIO_MAX);
    }
  });

  it("状態異常の効果量の係数は非負で、霊力以外を参照するものもある", () => {
    const ratios = Object.values(SKILL_DEFS).flatMap((d) => (d.applies ?? []).flatMap((a) => (a.ratio ? [a.ratio] : [])));
    expect(ratios.length, "効果量の係数を持つ付与").toBeGreaterThan(0);
    for (const r of ratios) for (const k of ATTR_KEYS) expect(r[k] ?? 0).toBeGreaterThanOrEqual(0);
    expect(ratios.some((r) => refs(r).some((k) => k !== "spi")), "霊力以外を参照する効果量の係数").toBe(true);
  });
});
