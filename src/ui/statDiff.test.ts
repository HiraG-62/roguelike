import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { basesForSlot } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { innateAt } from "../loot/innate";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS, type Item } from "../loot/types";
import { applyStats } from "../system/player";
import { formatStatValue, projectedStats, readInnateStat, statChangesOf } from "./statDiff";

const DEPTH = 5;
/** 1 回の許容（毎フレーム焦点の札 1 枚ぶんだけ呼ぶ。16ms の目安の 1 割強） */
const PER_CALL_LIMIT_MS = 2;

function armor(seed: number): Item {
  const base = basesForSlot("armor", 99)[0];
  if (!base) throw new Error("base missing");
  const item = generateItem(createRng(seed), { baseKey: base.key, itemLevel: DEPTH, foundDepth: DEPTH, now: 0 });
  return { ...item, id: `a${seed}`, affixes: [] };
}

/** 地金の行が違う防具の組（今 = a、候補 = b） */
function pair(): [Item, Item] {
  for (let seed = 10; seed < 120; seed++) {
    const a = armor(seed);
    const b = armor(seed + 200);
    if (innateAt(a, DEPTH).length > 0 && innateAt(b, DEPTH).length > 0) return [a, b];
  }
  throw new Error("地金のある防具が見つからない");
}

function stateWith(worn: Item | null): GameState {
  const state = createGame(1);
  state.depth = DEPTH;
  state.profile.equipment = { ...state.profile.equipment, armor: worn };
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  return state;
}

describe("地金の値の読み取り", () => {
  it("防御力・ステータス・属性耐性の key から今のステータスの値を読む", () => {
    const stats = { ...DEFAULT_STATS, armor: 12, attributes: { ...DEFAULT_STATS.attributes, str: 9 }, resist: { ...DEFAULT_STATS.resist, fire: 15 } };
    expect(readInnateStat(stats, "armorFlat")).toEqual({ value: 12, unit: "" });
    expect(readInnateStat(stats, "attr_str")).toEqual({ value: 9, unit: "" });
    expect(readInnateStat(stats, "res_fire")).toEqual({ value: 15, unit: "%" });
    expect(readInnateStat(stats, "attr_nope"), "知らない語").toBeNull();
    expect(readInnateStat(stats, "critChance"), "地金に無い key").toBeNull();
  });

  it("値は小数 1 桁まで、整数なら小数を出さない", () => {
    expect(formatStatValue(12, "")).toBe("12");
    expect(formatStatValue(10.44, "")).toBe("10.4");
    expect(formatStatValue(-5, "%")).toBe("-5%");
  });
});

describe("付けたときのステータスの変わり方（statChangesOf）", () => {
  it("「今の値 → 付けた後の値」が体の書付と同じ stats から数えた値になる", () => {
    const [a, b] = pair();
    const state = stateWith(a);
    const result = statChangesOf(state, b, a);
    expect(result.changes.length, "変わる項目がある").toBeGreaterThan(0);
    expect(result.changes.length, "上限まで").toBeLessThanOrEqual(MENU_BUDGET.innateDiffs);
    const after = projectedStats(state, { ...state.profile.equipment, armor: b });
    for (const c of result.changes) {
      const now = readInnateStat(state.stats, c.key);
      const next = readInnateStat(after, c.key);
      expect(now, `${c.key} は今の値を読める`).not.toBeNull();
      expect(c.before, `${c.key} の今の値は実際のステータス`).toBe(formatStatValue(now?.value ?? NaN, now?.unit ?? ""));
      expect(c.after, `${c.key} の後の値`).toBe(formatStatValue(next?.value ?? NaN, next?.unit ?? ""));
      expect(c.before, `${c.key} は変わる`).not.toBe(c.after);
      expect(c.rises, `${c.key} の向き`).toBe((next?.value ?? 0) > (now?.value ?? 0));
    }
  });

  it("下がる項目も同じ形で出る（候補と今を入れ替えると向きが逆になる）", () => {
    const [a, b] = pair();
    const forward = statChangesOf(stateWith(a), b, a).changes;
    const backward = statChangesOf(stateWith(b), a, b).changes;
    for (const f of forward) {
      const r = backward.find((c) => c.key === f.key);
      if (r === undefined) continue;
      expect(r.before, `${f.key}: 逆は後の値から始まる`).toBe(f.after);
      expect(r.after, `${f.key}: 逆は今の値へ戻る`).toBe(f.before);
      expect(r.rises, `${f.key}: 向きが逆`).toBe(!f.rises);
    }
  });

  it("同じ遺物どうしなら変わる項目は無く、空の部位への装備は上がる項目だけ", () => {
    const [a] = pair();
    expect(statChangesOf(stateWith(a), a, a)).toEqual({ changes: [], more: 0 });
    const fromEmpty = statChangesOf(stateWith(null), a, null);
    expect(fromEmpty.changes.length).toBeGreaterThan(0);
    expect(fromEmpty.changes.every((c) => c.rises)).toBe(true);
  });

  it("画面に出す前に stats の合算を 1 つの指標へまとめていない（項目ごとの行）", () => {
    const [a, b] = pair();
    const { changes } = statChangesOf(stateWith(a), b, a);
    expect(new Set(changes.map((c) => c.key)).size, "項目は重ならない").toBe(changes.length);
    expect(changes.every((c) => c.label.length > 0), "項目名がある").toBe(true);
  });

  it("候補の頁が毎フレーム呼んでも軽い（1 回 2ms 未満の目安）", () => {
    const [a, b] = pair();
    const state = stateWith(a);
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) statChangesOf(state, b, a);
    const per = (performance.now() - t0) / runs;
    expect(per, `1 回 ${per.toFixed(2)}ms`).toBeLessThan(PER_CALL_LIMIT_MS);
  });
});

