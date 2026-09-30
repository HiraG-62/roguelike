import { describe, expect, it } from "vitest";
import { BOON_ACTIONS, BOON_KEYS, BOON_META, BOONS, type BoonDef, LINEAGE_KEYS } from "./boonDefs";

/**
 * 系譜と札の種類の仮の写し（段取り 7a、docs/ideas/boon-impl.md 2-1）。
 * 7b で系譜ごとに作り直すまで、今の祝福がすべて提示の器に載っていることを確かめる
 */

const ALL: readonly BoonDef[] = BOON_KEYS.map((k) => BOONS[k]);
/** 系譜を持たない据え置きの札（呪い付き・芯） */
const isFixedAside = (d: BoonDef): boolean => d.cursed || d.core === true;
/** 通常の札（呪い・芯・legacy・融合 以外） */
const NORMAL = ALL.filter((d) => !isFixedAside(d) && d.legacy !== true && d.fusion === undefined);
/** 提示に重みで出る札（加護・摂理・研鑽） */
const isDrawn = (d: BoonDef): boolean => d.card === "grace" || d.card === "law" || d.card === "temper";
/** 提示に出る札の下限（系譜の 3 択が埋まる） */
const MIN_DRAWN_PER_LINEAGE = 3;

describe("系譜と札の種類の写し（boonDefs.ts の BOON_META）", () => {
  it("呪い付き・芯以外の全ての祝福が写しの表に載っている", () => {
    const missing = ALL.filter((d) => !isFixedAside(d) && BOON_META[d.key] === undefined).map((d) => d.key);
    expect(missing, "表に無い祝福").toEqual([]);
  });

  it("呪い付き・芯は系譜も札の種類も持たない", () => {
    for (const d of ALL.filter(isFixedAside)) {
      expect(BOON_META[d.key], `${d.key} は表に載せない`).toBeUndefined();
      expect(d.card, `${d.key} の札の種類`).toBeUndefined();
    }
  });

  it("通常の札は系譜と札の種類を持ち、何が変わるかを持つ", () => {
    for (const d of NORMAL) {
      expect(d.lineage, `${d.key} の系譜`).toBeDefined();
      expect(d.card, `${d.key} の札の種類`).toBeDefined();
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
    }
  });

  it("加護は行動を持ち、加護以外は行動を持たない", () => {
    for (const d of ALL) {
      if (d.card === "grace") expect(BOON_ACTIONS, `${d.key} の行動`).toContain(d.action);
      else expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
    }
  });

  it("各系譜に提示に出る札が 3 枚以上ある", () => {
    for (const lineage of LINEAGE_KEYS) {
      const drawn = NORMAL.filter((d) => d.lineage === lineage && isDrawn(d));
      expect(drawn.length, `${lineage} の提示に出る札`).toBeGreaterThanOrEqual(MIN_DRAWN_PER_LINEAGE);
    }
  });

  it("昇華は系譜ごとに 1 枚まで", () => {
    for (const lineage of LINEAGE_KEYS) {
      const apexes = NORMAL.filter((d) => d.lineage === lineage && d.card === "apex");
      expect(apexes.length, `${lineage} の昇華`).toBeLessThanOrEqual(1);
    }
  });

  it("旧系譜の 4 段目は昇華、1〜3 段目は同じ系譜の提示に出る札", () => {
    for (const d of NORMAL.filter((x) => x.after !== undefined)) {
      const prev = BOONS[d.after ?? d.key];
      expect(prev.lineage, `${d.key} の前段は同じ系譜`).toBe(d.lineage);
      expect(isDrawn(prev), `${prev.key} は昇華ではない`).toBe(true);
    }
    expect(BOONS.scorchedEarth.card).toBe("apex");
    expect(BOONS.hundredBlades.card).toBe("apex");
  });

  it("融合は違う 2 系譜を持ち、系譜は持たず、枠を取らない（摂理扱い）。組は重ならない", () => {
    const fusions = ALL.filter((d) => d.fusion !== undefined && d.legacy !== true);
    expect(fusions.length, "融合がある").toBeGreaterThan(0);
    const pairs = new Set<string>();
    for (const d of fusions) {
      const [a, b] = d.fusion ?? [];
      expect(a, `${d.key} の組`).not.toBe(b);
      expect(d.lineage, `${d.key} は系譜を持たない`).toBeUndefined();
      expect(d.card, `${d.key} は摂理扱い`).toBe("law");
      const pair = [a, b].sort().join("+");
      expect(pairs.has(pair), `${d.key} の組 ${pair} が重なる`).toBe(false);
      pairs.add(pair);
    }
  });

  it("legacy の札は系譜・札の種類を持たない（提示に出ないが持っていれば動く）", () => {
    for (const d of ALL.filter((x) => x.legacy === true)) {
      expect(d.card, `${d.key}`).toBeUndefined();
      expect(d.lineage, `${d.key}`).toBeUndefined();
    }
  });
});
