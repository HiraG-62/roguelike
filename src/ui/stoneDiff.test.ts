import { describe, expect, it } from "vitest";
import { MENU_BUDGET } from "../data/tuning";
import { SKILL_DEFS } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import type { SkillKey, SkillStone } from "../skills/types";
import { groupCardChips, groupSwapDiff, stoneCardChips, stoneSwapDiff } from "./stoneDiff";

/** 候補の頁のスキル石の見比べ（docs/ideas/skill-stone-hunt.md） */

const WHIRL: SkillKey = "commonWhirl";

function stone(extra: Partial<SkillStone> = {}, skillKey: SkillKey = WHIRL, seed = 1): SkillStone {
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: seed, skillKey }), variants: [], ...extra };
}

describe("札の 2 段目", () => {
  it("宿り符を先頭に金で、続けて変異を伸びる側から出す", () => {
    const chips = stoneCardChips(stone({ dwell: "echo", variants: [{ axis: "areaVsDamage", value: 0.5 }] }));
    expect(chips.map((c) => c.tone)).toEqual(["dwell", "good", "bad"]);
    expect(chips[0]?.text).toContain("宿");
    expect(chips[1]?.text).toBe("範囲+20%");
  });

  it("変異も宿り符も無ければ空（1 段の札）", () => {
    expect(stoneCardChips(stone())).toEqual([]);
  });

  it("束の札は束の中の宿り符の名前をまとめる", () => {
    expect(groupCardChips([stone(), stone({ dwell: "echo" }), stone({ dwell: "echo" })])).toHaveLength(1);
    expect(groupCardChips([stone(), stone()])).toEqual([]);
  });
});

describe("差の欄", () => {
  it("同じスキルなら量ごとに「今 → 候補」を出し、良くなる量は得る・悪くなる量は失う", () => {
    const now = stone({ variants: [{ axis: "areaVsDamage", value: 0.25 }] });
    const next = stone({ variants: [{ axis: "areaVsDamage", value: 0.5 }] });
    const diff = stoneSwapDiff(next, now);
    expect(diff.title).toContain(SKILL_DEFS[WHIRL].name);
    expect(diff.rows.find((r) => r.text.startsWith("範囲"))).toMatchObject({ tone: "gain", text: "範囲 +10% → +20%" });
    expect(diff.rows.find((r) => r.text.startsWith("威力"))?.tone).toBe("loss");
  });

  it("宿り符と使い込みの芽の違いも出し、行は予算まで（残りは「ほか n」）", () => {
    const now = stone({ dwell: "chain", wear: { casts: 0, hits: 0, buds: ["power"] }, variants: [{ axis: "areaVsDamage", value: -0.5 }] });
    const next = stone({ dwell: "echo", variants: [{ axis: "areaVsDamage", value: 0.5 }] });
    const diff = stoneSwapDiff(next, now);
    expect(diff.rows[0]).toMatchObject({ tone: "gain" });
    expect(diff.rows[0]?.text).toContain("宿り符");
    expect(diff.rows.length).toBeLessThanOrEqual(MENU_BUDGET.diffRows);
    expect(diff.rows.length + diff.more, "宿り符 2・変異 2・芽 1").toBe(5);
  });

  it("同じ個体どうしなら「同じ」と 1 行", () => {
    const s = stone({ variants: [{ axis: "areaVsDamage", value: 0.5 }] });
    expect(stoneSwapDiff({ ...s }, s).rows).toEqual([{ tone: "info", text: "変異も宿り符も同じ" }]);
  });

  it("違うスキルなら得る動詞 → 候補の変異 → 失う動詞", () => {
    const now = stone({}, "haste", 2);
    const next = stone({ variants: [{ axis: "areaVsDamage", value: 0.5 }] });
    const diff = stoneSwapDiff(next, now);
    expect(diff.rows.map((r) => r.tone)).toEqual(["gain", "info", "loss"]);
    expect(diff.rows[1]?.label).toBe("変異");
  });

  it("束の札は数と開き方を言う", () => {
    const diff = groupSwapDiff([stone(), stone({}, WHIRL, 2)], null);
    expect(diff?.title).toContain("×2");
    expect(diff?.rows.some((r) => r.label === "束")).toBe(true);
  });
});
