import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ARC } from "../data/tuning";
import { BOONS } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { boonSheetRow, lineageBoonRows, temperCount } from "./effectsList";

describe("祝福の行（書付「系譜」「祝福」）", () => {
  it("祝福 1 つの行を名前・格・効果の説明つきで出す", () => {
    const state = createGame(1);
    state.boons.push("emberSeed");
    state.boonRun.grades.emberSeed = 2;
    const row = boonSheetRow(state, BOONS.emberSeed);
    expect(row.name).toBe(BOONS.emberSeed.name);
    expect(row.info, "格").toBe("大祝福");
    expect(row.detail, "効果の説明").toBe(BOONS.emberSeed.desc);
  });

  it("研鑽の札の info に今の数えを出す（小数は切り捨て。研鑽でない札には出さない）", () => {
    const state = createGame(1);
    state.boons.push("ashBlaze", "emberSeed");
    state.boonRun.tallies.ashBlaze = 7.9;
    expect(boonSheetRow(state, BOONS.ashBlaze).info, "格・数え").toBe(`${BOON_GRADE_LABEL[boonGradeOf(state, "ashBlaze")]}・7`);
    expect(boonSheetRow(state, BOONS.emberSeed).info, "研鑽でない札は格だけ").toBe(BOON_GRADE_LABEL[boonGradeOf(state, "emberSeed")]);
  });

  it("〜につきで数える研鑽の札も、その数えを出す", () => {
    const state = createGame(1);
    state.boons.push("earnTally");
    state.economy.earned.kill = 123;
    expect(boonSheetRow(state, BOONS.earnTally).info.endsWith("・123")).toBe(true);
  });

  it("深みでは上限を持つ札の説明に「最大なし」を足し、章の間は足さない", () => {
    const state = createGame(1);
    state.boons.push("miser", "emberSeed");
    state.depth = ARC.floorsPerChapter * ARC.maxChapter;
    expect(boonSheetRow(state, BOONS.miser).detail.includes("最大なし"), "章の間").toBe(false);
    state.depth += 2;
    expect(boonSheetRow(state, BOONS.miser).detail, "上限を持つ札").toContain("（深み: 最大なし）");
    expect(boonSheetRow(state, BOONS.emberSeed).detail, "上限の無い札").toBe(BOONS.emberSeed.desc);
  });

  it("系譜の行はその系譜の札だけで、芯は含まない", () => {
    const state = createGame(1);
    state.boons.push("ashBlaze", "emberSeed", "coreTempo");
    state.boonRun.tallies.ashBlaze = 7.9;
    const lineage = BOONS.ashBlaze.lineage;
    if (lineage === undefined) throw new Error("灰の研鑽に系譜が無い");
    const keys = lineageBoonRows(state, lineage).map((r) => r.key);
    expect(keys, "その系譜の札").toContain("boon:ashBlaze");
    expect(keys.some((k) => k.includes("coreTempo")), "芯は系譜の行に出さない").toBe(false);
    for (const key of keys) {
      const def = BOONS[key.replace("boon:", "") as keyof typeof BOONS];
      expect(def.lineage === lineage || def.fusion?.includes(lineage) === true, key).toBe(true);
    }
    expect(temperCount(state, BOONS.ashBlaze), "研鑽の数え").toBe(7);
    expect(temperCount(state, BOONS.emberSeed), "研鑽でない札").toBeNull();
  });
});
