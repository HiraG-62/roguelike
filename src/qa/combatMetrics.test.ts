import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { arena, placeEnemy } from "../system/testHelpers";
import {
  buildCombatSection,
  buildDeathCauseByBandSection,
  countEngagedEnemies,
  createCombatRecorder,
  depthBandOf,
  emptyCombatTally,
  summarizeEngagements,
} from "./combatMetrics";

describe("深度帯", () => {
  it("深度 1-2 / 3-5 / 6 以上に分ける", () => {
    expect(depthBandOf(1)).toBe("1-2");
    expect(depthBandOf(2)).toBe("1-2");
    expect(depthBandOf(3)).toBe("3-5");
    expect(depthBandOf(5)).toBe("3-5");
    expect(depthBandOf(6)).toBe("6+");
    expect(depthBandOf(13)).toBe("6+");
  });
});

describe("予備動作から攻撃への完遂", () => {
  it("予備動作 → strike で完遂に数え、予備動作 → 追跡（取り消し）は数えない", () => {
    const state = arena(1);
    const e = placeEnemy(state, "slime", 40);
    const rec = createCombatRecorder();
    e.phase = "windup";
    rec.afterStep(state, FIXED_DT);
    e.phase = "strike";
    rec.afterStep(state, FIXED_DT);
    e.phase = "recover";
    rec.afterStep(state, FIXED_DT);
    e.phase = "windup";
    rec.afterStep(state, FIXED_DT);
    e.phase = "chase";
    rec.afterStep(state, FIXED_DT);
    const t = rec.tally["1-2"];
    expect(t.windups, "予備動作の開始").toBe(2);
    expect(t.strikes, "完遂は 1 回だけ").toBe(1);
  });

  it("strike を経ず隙へ直接進む攻撃も完遂に数え、同じ予備動作を二重に数えない", () => {
    const state = arena(1);
    const e = placeEnemy(state, "eye", 40);
    const rec = createCombatRecorder();
    e.phase = "windup";
    rec.afterStep(state, FIXED_DT);
    rec.afterStep(state, FIXED_DT);
    e.phase = "recover";
    rec.afterStep(state, FIXED_DT);
    expect(rec.tally["1-2"].windups).toBe(1);
    expect(rec.tally["1-2"].strikes).toBe(1);
  });

  it("予備動作中に倒された敵は完遂に数えない", () => {
    const state = arena(1);
    const e = placeEnemy(state, "slime", 40);
    const rec = createCombatRecorder();
    e.phase = "windup";
    rec.afterStep(state, FIXED_DT);
    state.enemies = [];
    rec.afterStep(state, FIXED_DT);
    expect(rec.tally["1-2"].windups).toBe(1);
    expect(rec.tally["1-2"].strikes).toBe(0);
  });

  it("深度帯ごとに分けて数える", () => {
    const state = arena(1);
    state.depth = 7;
    const e = placeEnemy(state, "slime", 40);
    const rec = createCombatRecorder();
    e.phase = "windup";
    rec.afterStep(state, FIXED_DT);
    expect(rec.tally["6+"].windups).toBe(1);
    expect(rec.tally["1-2"].windups).toBe(0);
  });
});

describe("ヒットストップで止まった step", () => {
  it("step の直前に hitstop が立っていた step だけを数える", () => {
    const state = arena(1);
    const rec = createCombatRecorder();
    state.hitstop = 2;
    rec.beforeStep(state);
    rec.afterStep(state, FIXED_DT);
    state.hitstop = 0;
    rec.beforeStep(state);
    rec.afterStep(state, FIXED_DT);
    expect(rec.tally["1-2"].steps).toBe(2);
    expect(rec.tally["1-2"].hitstopSteps).toBe(1);
  });
});

describe("交戦の区間", () => {
  it("交戦中の敵が 1 体以上の連続区間を 1 回とし、idle の敵は数えない", () => {
    const state = arena(1);
    const e = placeEnemy(state, "slime", 40);
    e.phase = "chase";
    const idle = placeEnemy(state, "slime", 80);
    idle.phase = "idle";
    expect(countEngagedEnemies(state), "idle は除く").toBe(1);
    const rec = createCombatRecorder();
    for (let i = 0; i < 30; i++) rec.afterStep(state, FIXED_DT);
    state.enemies = [idle];
    for (let i = 0; i < 10; i++) rec.afterStep(state, FIXED_DT);
    state.enemies = [e];
    for (let i = 0; i < 6; i++) rec.afterStep(state, FIXED_DT);
    rec.finish();
    const t = rec.tally["1-2"];
    expect(t.engagementSeconds, "30 step と、途切れたあとの 6 step").toHaveLength(2);
    expect(t.engagementSeconds[0]).toBeCloseTo(30 * FIXED_DT, 5);
    expect(t.engagementSeconds[1]).toBeCloseTo(6 * FIXED_DT, 5);
    expect(t.engagedSteps, "交戦中の step 数").toBe(36);
    expect(t.steps, "観測した step 数").toBe(46);
  });

  it("交戦中のままラン（観測）が終わっても最後の区間を閉じる", () => {
    const state = arena(1);
    placeEnemy(state, "slime", 40).phase = "chase";
    const rec = createCombatRecorder();
    for (let i = 0; i < 5; i++) rec.afterStep(state, FIXED_DT);
    rec.finish();
    expect(rec.tally["1-2"].engagementSeconds).toHaveLength(1);
  });

  it("交戦の長さの要約は平均・中央値・最大を出し、空なら 0", () => {
    expect(summarizeEngagements([])).toEqual({ count: 0, mean: 0, median: 0, max: 0 });
    const s = summarizeEngagements([1, 5, 3]);
    expect(s.count).toBe(3);
    expect(s.mean).toBeCloseTo(3, 5);
    expect(s.median).toBe(3);
    expect(s.max).toBe(5);
    expect(summarizeEngagements([1, 2, 3, 10]).median, "偶数個は中央 2 つの平均").toBeCloseTo(2.5, 5);
  });
});

describe("フル QA の表", () => {
  it("戦闘の基準の表は帯 3 つと全体の行を出し、観測が無くても NaN を出さない", () => {
    const lines = buildCombatSection([emptyCombatTally()]);
    const md = lines.join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(lines.filter((l) => /^\| (1-2|3-5|6\+|全体) \|/.test(l))).toHaveLength(4);
  });

  it("死因の表は深度帯ごとに件数の多い順で並べる", () => {
    const md = buildDeathCauseByBandSection([
      { depth: 1, cause: "slime" },
      { depth: 2, cause: "bat" },
      { depth: 2, cause: "bat" },
      { depth: 8, cause: "reaper" },
    ]).join("\n");
    expect(md).toContain("| 1-2 | 3 | bat×2, slime×1 |");
    expect(md).toContain("| 3-5 | 0 | - |");
    expect(md).toContain("| 6+ | 1 | reaper×1 |");
  });
});
