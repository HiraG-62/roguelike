import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { MENU_BUDGET } from "../data/tuning";
import { AFFIXES } from "../loot/affixes";
import { basesForSlot } from "../loot/bases";
import { describeTrait } from "../loot/describe";
import { generateItem } from "../loot/generator";
import { innateAt } from "../loot/innate";
import type { AffixRoll, Item } from "../loot/types";
import { swapDiff } from "./swapDiff";

const DEPTH = 5;
const MAIN_AFFIXES = AFFIXES.filter((d) => d.slots.includes("mainHand"));

function weapon(seed: number, affixKeys: readonly string[], overrides: Partial<Item> = {}): Item {
  const base = basesForSlot("mainHand", 99)[0];
  if (!base) throw new Error("base missing");
  const item = generateItem(createRng(seed), { baseKey: base.key, itemLevel: DEPTH, foundDepth: DEPTH, now: 0 });
  return { ...item, id: `w${seed}`, affixes: affixKeys.map((key) => ({ key, value: 1 })), ...overrides };
}

const keys = MAIN_AFFIXES.map((d) => d.key);

describe("遺物の差（swapDiff）: 得る・失う", () => {
  it("共通の性質は書かず、候補にだけある性質を得る・今にだけある性質を失うとする", () => {
    const [a, b, c] = keys;
    if (!a || !b || !c) throw new Error("性質が足りない");
    const diff = swapDiff(weapon(1, [a, b]), weapon(2, [a, c]));
    expect(diff.rows.map((r) => [r.kind, r.key])).toEqual([
      ["gain", b],
      ["lose", c],
    ]);
    expect(diff.more).toBe(0);
  });

  it("文は describeTrait の既存の文をそのまま使う", () => {
    const [a, b] = keys;
    if (!a || !b) throw new Error("性質が足りない");
    const candidate = weapon(1, [a]);
    const diff = swapDiff(candidate, weapon(2, [b]));
    const gain = diff.rows.find((r) => r.kind === "gain");
    expect(gain?.text).toBe(describeTrait(candidate.affixes[0] as AffixRoll).text);
  });

  it("値だけが違う同じ性質は畳む（共通）。反転は別の性質として得る・失うになる", () => {
    const [a] = keys;
    if (!a) throw new Error("性質が足りない");
    const same = swapDiff(weapon(1, [a]), { ...weapon(2, [a]), affixes: [{ key: a, value: 5 }] });
    expect(same.rows).toEqual([]);
    const flipped = swapDiff({ ...weapon(1, [a]), affixes: [{ key: a, value: -1, inverted: true }] }, weapon(2, [a]));
    expect(flipped.rows.map((r) => r.kind).sort()).toEqual(["gain", "lose"]);
  });

  it("得る・失うは合わせて diffRows 行まで。得るを先に最大 2 行、残りを失うに回し、溢れは「ほか n」の数", () => {
    const five = keys.slice(0, 5);
    if (five.length < 5) throw new Error("性質が足りない");
    const diff = swapDiff(weapon(1, five.slice(0, 3)), weapon(2, five.slice(3, 5)));
    expect(diff.rows.length).toBe(MENU_BUDGET.diffRows);
    expect(diff.rows.map((r) => r.kind)).toEqual(["gain", "gain", "lose"]);
    expect(diff.more, "得る 3 + 失う 2 のうち 2 つが溢れる").toBe(2);
  });

  it("失うが無いときは得るで diffRows 行まで使う", () => {
    const four = keys.slice(0, 4);
    if (four.length < 4) throw new Error("性質が足りない");
    const diff = swapDiff(weapon(1, four), weapon(2, []));
    expect(diff.rows.map((r) => r.kind)).toEqual(["gain", "gain", "gain"]);
    expect(diff.more).toBe(1);
  });

  it("得るが無ければ失うだけで diffRows 行まで", () => {
    const four = keys.slice(0, 4);
    if (four.length < 4) throw new Error("性質が足りない");
    const diff = swapDiff(weapon(1, []), weapon(2, four));
    expect(diff.rows.map((r) => r.kind)).toEqual(["lose", "lose", "lose"]);
    expect(diff.more).toBe(1);
  });

  it("空の部位（今の物が無い）なら候補の性質がすべて得る", () => {
    const two = keys.slice(0, 2);
    const diff = swapDiff(weapon(1, two), null);
    expect(diff.rows.map((r) => r.kind)).toEqual(["gain", "gain"]);
  });

  it("性質が同じなら行は無い", () => {
    const two = keys.slice(0, 2);
    const diff = swapDiff(weapon(1, two), weapon(2, two));
    expect(diff.rows).toEqual([]);
    expect(diff.more).toBe(0);
  });
});

describe("遺物の差（swapDiff）: 地金", () => {
  /** 地金の行が違う遺物（右手の別 seed）を探す */
  function pairWithInnateDifference(): [Item, Item] {
    for (let seed = 10; seed < 80; seed++) {
      const a = weapon(seed, []);
      const b = weapon(seed + 100, []);
      if (innateAt(a, DEPTH).length > 0 && innateAt(b, DEPTH).length > 0) return [a, b];
    }
    throw new Error("地金のある遺物が見つからない");
  }

  it("値の差を変わりの大きい順に並べ、上限（▲▼ 2 つ）までにする。数値は並べ替えの鍵で持つ", () => {
    const [a, b] = pairWithInnateDifference();
    const diff = swapDiff(a, b, DEPTH);
    expect(diff.innate.length).toBeLessThanOrEqual(MENU_BUDGET.innateDiffs);
    const sizes = diff.innate.map((d) => Math.abs(d.delta));
    expect(sizes, "大きい順").toEqual([...sizes].sort((x, y) => y - x));
    const valueOf = (item: Item, key: string): number => innateAt(item, DEPTH).filter((r) => r.key === key).reduce((s, r) => s + r.value, 0);
    for (const d of diff.innate) {
      expect(d.delta, d.key).toBeCloseTo(valueOf(a, d.key) - valueOf(b, d.key));
      expect(d.direction, d.key).toBe(d.delta > 0 ? "up" : "down");
    }
  });

  it("名前は値の部分を除いた表示名（「筋力」など。「+」や数を含まない）", () => {
    const [a, b] = pairWithInnateDifference();
    for (const d of swapDiff(a, b, DEPTH).innate) {
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.label, d.key).not.toMatch(/[+＋0-9{}]/);
    }
  });

  it("同じ遺物どうしなら地金の差は無く、空の部位への装備は候補の地金がすべて上がる", () => {
    const [a] = pairWithInnateDifference();
    expect(swapDiff(a, a, DEPTH).innate).toEqual([]);
    const fromEmpty = swapDiff(a, null, DEPTH);
    expect(fromEmpty.innate.every((d) => d.direction === "up")).toBe(true);
    expect(fromEmpty.innate.length).toBeGreaterThan(0);
  });
});
