import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ARC } from "../data/tuning";
import { BOONS } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { boonRows, buffRows, coreRows, runEffectRows, statusEffectRows } from "./effectsList";

describe("効果の一覧（装備画面のステータスタブ「効果」頁）", () => {
  it("ラン中は state.player.status に付いている状態異常を残り秒つきで出す", () => {
    const state = createGame(1);
    state.player.status.effects.push({ kind: "burn", stacks: 2, time: 3.4, maxTime: 5, potency: 10, source: "player", acc: 0, tick: 0 });
    const rows = statusEffectRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name, "スタックを添える").toBe("燃焼×2");
    expect(rows[0]?.info, "残り秒").toBe("3.4秒");
  });

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

  it("一時強化（ダメージ・移動速度・無敵）が掛かっていれば出す", () => {
    const state = createGame(1);
    state.player.buffs.damage = { time: 2, mul: 1.5 };
    state.player.buffs.speed = { time: 1, mul: 1.2 };
    state.player.buffs.invuln = 0.5;
    const rows = buffRows(state);
    expect(rows.map((r) => r.name)).toEqual(["ダメージ強化", "移動速度強化", "無敵"]);
  });

  it("倍率 1（効果なし）の一時強化は出さない", () => {
    const state = createGame(1);
    state.player.buffs.damage = { time: 2, mul: 1 };
    expect(buffRows(state)).toHaveLength(0);
  });

  it("拠点（sandbox）では何も出さない", () => {
    const state = createGame(1);
    state.sandbox = true;
    state.boons.push("emberSeed");
    state.player.status.effects.push({ kind: "haste", stacks: 1, time: 1, maxTime: 1, potency: 0, source: "player", acc: 0, tick: 0 });
    expect(runEffectRows(state)).toHaveLength(0);
  });

  it("ラン中は芯 → 祝福 → 状態異常 → 一時強化の順に並ぶ", () => {
    const state = createGame(1);
    state.boons.push("coreTempo", "emberSeed");
    state.player.status.effects.push({ kind: "haste", stacks: 1, time: 1, maxTime: 1, potency: 0, source: "player", acc: 0, tick: 0 });
    state.player.buffs.invuln = 1;
    const rows = runEffectRows(state);
    expect(rows.map((r) => r.key)).toEqual(["core:coreTempo", "boon:emberSeed", "status:haste", "buff:invuln"]);
  });
});
