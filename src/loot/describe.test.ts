import { describe, expect, it } from "vitest";
import type { StatusProc } from "../core/status";
import { ATTRIBUTE_HINT, describeAttribute, describeStatusProc, describeTrait } from "./describe";
import { ATTR_KEYS, TRAIT_COLOR_HEX } from "./types";

function proc(partial: Partial<StatusProc>): StatusProc {
  return { kind: "bleed", chance: 0.12, stacks: 1, duration: 4, potency: 2, on: "melee", ...partial };
}

describe("ステータスの一言", () => {
  it("5 種すべてに一言があり、動詞（伸びる / 増え / 深まる …）で語る", () => {
    for (const k of ATTR_KEYS) {
      expect(ATTRIBUTE_HINT[k].length, k).toBeGreaterThan(0);
      expect(ATTRIBUTE_HINT[k], k).toMatch(/(伸びる|増え|冴える|深まり|重くなる|立ち直る)/);
    }
  });

  it("describeAttribute は表示名・色を返す", () => {
    const str = describeAttribute("str");
    expect(str.label).toBe("筋力");
    expect(str.color).toBe("crimson");
    expect(str.hex).toBe(TRAIT_COLOR_HEX.crimson);
    expect(describeAttribute("spi").color).toBe("umbra");
  });

  it("ステータスの性質の行には一言が付く。他の性質には付かない", () => {
    const line = describeTrait({ key: "attr_str", value: 4, color: "crimson" });
    expect(line.text).toBe(`筋力 +4（${ATTRIBUTE_HINT.str}）`);
    expect(line.hue).toBe("crimson");
    expect(describeTrait({ key: "meleeDamagePct", value: 20 }).text).toBe("近接ダメージ +20%");
  });
});

describe("状態異常の付与の説明", () => {
  it("判定する攻撃と確率と動詞で語る", () => {
    expect(describeStatusProc(proc({}))).toBe("近接命中時 12% で出血させる");
    expect(describeStatusProc(proc({ kind: "silence", on: "ranged", chance: 0.1 }))).toBe("射撃命中時 10% で沈黙させる");
    expect(describeStatusProc(proc({ kind: "vulnerable", on: "skill", chance: 0.2 }))).toBe("スキル命中時 20% で脆弱にする");
    expect(describeStatusProc(proc({ kind: "poison", on: "any", chance: 0.085 }))).toBe("命中時 8.5% で毒を与える");
  });

  it("会心時のみのものは「会心時」", () => {
    expect(describeStatusProc(proc({ kind: "fear", on: "any", chance: 0.3, requiresCrit: true }))).toBe(
      "会心時 30% で恐怖させる",
    );
  });
});
