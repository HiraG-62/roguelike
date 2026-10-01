import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ARC } from "../data/tuning";
import { BOONS } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { boonRows, coreRows, lineageBoonRows, temperCount } from "./effectsList";

describe("祝福の行（書付「系譜」「祝福」）", () => {
  it("持っている祝福を名前・格・効果の説明つきで出す（芯は除く）", () => {
    const state = createGame(1);
    state.boons.push("emberSeed");
    state.boonRun.grades.emberSeed = 2;
    const rows = boonRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(BOONS.emberSeed.name);
    expect(rows[0]?.info, "格").toBe("大祝福");
    expect(rows[0]?.detail, "効果の説明").toBe(BOONS.emberSeed.desc);
  });

  it("研鑽の札の info に今の数えを出す（小数は切り捨て。研鑽でない札には出さない）", () => {
    const state = createGame(1);
    state.boons.push("ashBlaze", "emberSeed");
    state.boonRun.tallies.ashBlaze = 7.9;
    const rows = boonRows(state);
    expect(rows.find((r) => r.key === "boon:ashBlaze")?.info, "格・数え").toBe(`${BOON_GRADE_LABEL[boonGradeOf(state, "ashBlaze")]}・7`);
    expect(rows.find((r) => r.key === "boon:emberSeed")?.info, "研鑽でない札は格だけ").toBe(BOON_GRADE_LABEL[boonGradeOf(state, "emberSeed")]);
  });

  it("〜につきで数える研鑽の札も、その数えを出す", () => {
    const state = createGame(1);
    state.boons.push("earnTally");
    state.economy.earned.kill = 123;
    expect(boonRows(state)[0]?.info.endsWith("・123")).toBe(true);
  });

  it("深みでは上限を持つ札の説明に「最大なし」を足し、章の間は足さない", () => {
    const state = createGame(1);
    state.boons.push("miser", "emberSeed");
    state.depth = ARC.floorsPerChapter * ARC.maxChapter;
    expect(boonRows(state).some((r) => r.detail.includes("最大なし")), "章の間").toBe(false);
    state.depth += 2;
    const rows = boonRows(state);
    expect(rows.find((r) => r.key === "boon:miser")?.detail, "上限を持つ札").toContain("（深み: 最大なし）");
    expect(rows.find((r) => r.key === "boon:emberSeed")?.detail, "上限の無い札").toBe(BOONS.emberSeed.desc);
  });

  it("芯を持っていれば coreRows に 1 件出る", () => {
    const state = createGame(1);
    expect(coreRows(state)).toHaveLength(0);
    state.boons.push("coreTempo");
    const rows = coreRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(BOONS.coreTempo.name);
    // 芯は祝福の一覧（boonRows）には出さない（二重に数えない）
    expect(boonRows(state).some((r) => r.key.includes("coreTempo"))).toBe(false);
  });


  it("系譜の行はその系譜の札だけで、研鑽の数えを返す", () => {
    const state = createGame(1);
    state.boons.push("ashBlaze", "emberSeed");
    state.boonRun.tallies.ashBlaze = 7.9;
    const lineage = BOONS.ashBlaze.lineage;
    if (lineage === undefined) throw new Error("灰の研鑽に系譜が無い");
    const keys = lineageBoonRows(state, lineage).map((r) => r.key);
    expect(keys, "その系譜の札").toContain("boon:ashBlaze");
    for (const key of keys) {
      const def = BOONS[key.replace("boon:", "") as keyof typeof BOONS];
      expect(def.lineage === lineage || def.fusion?.includes(lineage) === true, key).toBe(true);
    }
    expect(temperCount(state, BOONS.ashBlaze), "研鑽の数え").toBe(7);
    expect(temperCount(state, BOONS.emberSeed), "研鑽でない札").toBeNull();
  });
});
