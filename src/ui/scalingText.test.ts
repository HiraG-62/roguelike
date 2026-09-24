import { describe, expect, it } from "vitest";
import { MOVESET_KEYS, MOVESETS, SHOT_KEYS, SHOT_TYPES } from "../data/weapons";
import { ATTR_KEYS, DEFAULT_STATS, type Attributes, type PlayerStats } from "../loot/types";
import { SKILL, SKILL_DEFS } from "../skills/data";
import { SKILL_KEYS } from "../skills/types";
import { deriveAttributes, scaled, withRatio } from "../system/attributes";
import { shotScaling } from "../system/player";
import {
  NO_SCALING_NOTE,
  SKILL_SCALING_LABEL,
  SKILL_STEP_LABEL,
  attributeReferences,
  buffFormula,
  chunksText,
  formatCoef,
  formulaText,
  isScaling,
  mainAttrs,
  mainReferenceChunks,
  movesetFormulas,
  ratioFormula,
  scalingFormula,
  shotFormulas,
  skillBlock,
  skillFormulas,
  skillScalingKeys,
} from "./scalingText";

/** 実効値を直接与えた stats（逓減を通さず、式の数だけを見る） */
function statsWith(eff: Partial<Attributes>): PlayerStats {
  const base = deriveAttributes(DEFAULT_STATS);
  return { ...base, attributesEff: { ...base.attributesEff, ...eff } };
}

const BASE_STATS = deriveAttributes(DEFAULT_STATS);

describe("係数の書式", () => {
  it("小数 2 桁まで、末尾の 0 は落とす", () => {
    expect(formatCoef(1.3)).toBe("1.3");
    expect(formatCoef(1.456)).toBe("1.46");
    expect(formatCoef(2)).toBe("2");
    expect(formatCoef(0.1 + 0.2)).toBe("0.3");
  });
});

describe("計算式の組み立て", () => {
  it("基礎値とステータスの項を並べ、左に今の値を出す", () => {
    const f = scalingFormula(statsWith({ str: 5, dex: 7.5 }), "power", "威力", { base: 10, str: 1.3, dex: 0.2 });
    expect(f.value, "10 + 1.3×5 + 0.2×7.5").toBeCloseTo(18);
    expect(f.terms.map((t) => t.attr), "参照するステータス").toEqual(["str", "dex"]);
    expect(f.terms[0]?.contribution, "筋力の寄与").toBeCloseTo(6.5);
    expect(formulaText(f)).toBe("威力 18 = 10+筋力×1.3+技巧×0.2");
  });

  it("ステータスを参照しなければ「変わらない」と書く", () => {
    const f = scalingFormula(BASE_STATS, "power", "威力", { base: 12 });
    expect(f.terms, "項が無い").toHaveLength(0);
    expect(formulaText(f)).toBe(`威力 12${NO_SCALING_NOTE}`);
  });

  it("基礎値が 0 なら項から始め、負の係数は引き算にする", () => {
    const f = scalingFormula(statsWith({ str: 10, vit: 10 }), "power", "威力", { base: 0, str: 2, vit: -0.5 });
    expect(formulaText(f)).toBe("威力 15 = 筋力×2-体力×0.5");
  });

  it("怯み値は「基礎値での値 + 係数」をステータス 0 のときの値に直して出す", () => {
    const stats = statsWith({ vit: 10 });
    const f = ratioFormula(stats, "poise", "怯み値", 20, { vit: 0.8 });
    expect(f.base, "20 - 0.8×5").toBeCloseTo(16);
    expect(f.value, "withRatio と同じ").toBeCloseTo(withRatio(stats, 20, { vit: 0.8 }));
    expect(formulaText(f)).toBe("怯み値 24 = 16+体力×0.8");
  });

  it("型の倍率は括弧の外に掛ける", () => {
    const f = scalingFormula(statsWith({ dex: 5 }), "power", "威力", { base: 2, dex: 0.4 }, 0.5);
    expect(f.value).toBeCloseTo(2);
    expect(formulaText(f)).toBe("威力 2 = (2+技巧×0.4) ×0.5");
  });

  it("強化の効果量は負にしない", () => {
    const f = buffFormula(statsWith({ spi: 0 }), "強化の効果量", { base: -1, spi: 0.1 });
    expect(f.value).toBe(0);
  });

  it("主に参照は係数の大きい順で、参照が無ければ「変わらない」", () => {
    const a = scalingFormula(BASE_STATS, "power", "威力", { base: 1, str: 0.2, vit: 1 });
    const b = scalingFormula(BASE_STATS, "poise", "怯み値", { base: 1, spi: 5 });
    expect(mainAttrs([a, b]), "威力の式があれば威力だけで決める").toEqual(["vit", "str"]);
    expect(mainAttrs([b]), "威力が無ければ全部").toEqual(["spi"]);
    const none = chunksText(mainReferenceChunks([scalingFormula(BASE_STATS, "power", "威力", { base: 3 })]));
    expect(none.length, "参照なしでも文字を出す").toBeGreaterThan(0);
  });
});

describe("武器種の計算式", () => {
  it("全武器種で行動が 1 つ以上あり、各行動は威力と怯み値の式を持ち、名前が重ならない", () => {
    for (const key of MOVESET_KEYS) {
      const actions = movesetFormulas(BASE_STATS, MOVESETS[key], "single");
      expect(actions.length, key).toBeGreaterThan(0);
      const names = actions.map((a) => a.name);
      expect(new Set(names).size, `${key} の行動名が重なる`).toBe(names.length);
      for (const a of actions) {
        expect(a.formulas.map((f) => f.kind), `${key} ${a.name}`).toEqual(["power", "poise"]);
        for (const f of a.formulas) expect(Number.isFinite(f.value), `${key} ${a.name} ${f.label}`).toBe(true);
      }
    }
  });

  it("連撃の段の威力は scaled と一致し、まとめた段は同じ式", () => {
    for (const key of MOVESET_KEYS) {
      const m = MOVESETS[key];
      const actions = movesetFormulas(BASE_STATS, m, "single");
      m.steps.forEach((step, i) => {
        const action = actions.find((a) => a.name === `${i + 1} 段目` || inRange(a.name, i + 1));
        expect(action, `${key} ${i + 1} 段目が見つからない`).toBeDefined();
        expect(action?.formulas[0]?.value, `${key} ${i + 1} 段目の威力`).toBeCloseTo(scaled(BASE_STATS, step.scaling));
        expect(action?.formulas[1]?.value, `${key} ${i + 1} 段目の怯み値`).toBeCloseTo(withRatio(BASE_STATS, step.poise, step.poiseRatio));
      });
    }
  });

  it("射撃の型の威力は system の shotScaling × 型の倍率と一致する", () => {
    const stats = statsWith({ dex: 12, str: 3 });
    for (const key of SHOT_KEYS) {
      const f = shotFormulas(stats, key, "射撃").formulas[0];
      const expected = scaled(stats, shotScaling({ ...stats, shot: key })) * SHOT_TYPES[key].damageMul;
      expect(f?.value, key).toBeCloseTo(expected);
    }
  });
});

function inRange(name: string, n: number): boolean {
  const m = /^(\d+)〜(\d+) 段目$/.exec(name);
  if (m === null) return false;
  return n >= Number(m[1]) && n <= Number(m[2]);
}

/** 数値ブロックの中の Scaling を深さを問わずすべて拾い、[親のキー, 自分のキー] を返す */
function collectScalingPaths(v: unknown, path: readonly string[], out: string[][]): void {
  if (typeof v !== "object" || v === null) return;
  if (isScaling(v)) {
    out.push([...path]);
    return;
  }
  for (const [k, x] of Object.entries(v)) collectScalingPaths(x, [...path, k], out);
}

describe("スキルの計算式", () => {
  it("数値ブロックの Scaling のキーはすべて見出しの表にある（未知のキーはここで落とす）", () => {
    const paths: string[][] = [];
    collectScalingPaths(SKILL, [], paths);
    expect(paths.length, "Scaling が 1 つ以上ある").toBeGreaterThan(0);
    for (const p of paths) {
      const last = p[p.length - 1] ?? "";
      const parent = p[p.length - 2] ?? "";
      const known = last in SKILL_SCALING_LABEL || (last === "scaling" && parent in SKILL_STEP_LABEL);
      expect(known, `見出しの無い Scaling: ${p.join(".")}`).toBe(true);
    }
  });

  it("Scaling は数値ブロックの直下か近接の振りの中だけにある（深い所の係数を拾い漏らさない）", () => {
    for (const key of SKILL_KEYS) {
      const block = skillBlock(key);
      if (block === undefined) continue;
      const paths: string[][] = [];
      collectScalingPaths(block, [], paths);
      const { scalings, steps } = skillScalingKeys(block);
      expect(scalings.length + steps.length, `${key} の Scaling の数`).toBe(paths.length);
    }
  });

  it("全スキルで式が作れ、値は有限。数値ブロックの Scaling の数だけ威力・強化の式が出る", () => {
    for (const key of SKILL_KEYS) {
      const formulas = skillFormulas(BASE_STATS, key);
      for (const f of formulas) expect(Number.isFinite(f.value), `${key} ${f.label}`).toBe(true);
      const block = skillBlock(key);
      const { scalings, steps } = block === undefined ? { scalings: [], steps: [] } : skillScalingKeys(block);
      const fromBlock = formulas.filter((f) => f.kind === "power" || f.kind === "buff").length;
      const expected = scalings.length + steps.length + (SKILL_DEFS[key].buffScaling !== undefined && !scalings.includes("buff") ? 1 : 0);
      expect(fromBlock, `${key} の威力・強化の式の数`).toBe(expected);
    }
  });

  it("怯み値を持つスキルは怯み値の式を出し、係数付きの状態異常は効果量の式を出す", () => {
    for (const key of SKILL_KEYS) {
      const def = SKILL_DEFS[key];
      const formulas = skillFormulas(BASE_STATS, key);
      if (def.poise > 0) expect(formulas.some((f) => f.kind === "poise"), `${key} の怯み値`).toBe(true);
      const withRatioCount = (def.applies ?? []).filter((a) => a.ratio !== undefined).length;
      expect(formulas.filter((f) => f.kind === "potency").length, `${key} の効果量`).toBe(withRatioCount);
    }
  });
});

describe("ステータスごとの参照している行動", () => {
  it("名前が出るのは、そのステータスを参照する式を持つ行動があるときだけ", () => {
    const skills = SKILL_KEYS.slice(0, 4);
    for (const key of MOVESET_KEYS) {
      const moveset = MOVESETS[key];
      const refs = attributeReferences(BASE_STATS, { moveset, shot: "single", skills });
      expect(refs.map((r) => r.attr), "全ステータスを順に").toEqual([...ATTR_KEYS]);
      const all = [...movesetFormulas(BASE_STATS, moveset, "single").flatMap((a) => a.formulas), ...skills.flatMap((k) => skillFormulas(BASE_STATS, k))];
      for (const r of refs) {
        const referenced = all.some((f) => f.terms.some((t) => t.attr === r.attr));
        // バーストの参照は武器・スキルと別に数える
        if (referenced) expect(r.names.length, `${key} ${r.attr}`).toBeGreaterThan(0);
        expect(new Set(r.names).size, `${key} ${r.attr} の名前が重なる`).toBe(r.names.length);
      }
    }
  });
});
