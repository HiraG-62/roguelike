import { describe, expect, it } from "vitest";
// 図鑑（meta/codex）を最初に読むと system の import の輪の途中（biomes）から初期化が始まって壊れるので、先に core/game 側（bossHall）から読む
import { type HallOutcome, hallBossKeys } from "../system/bossHall";
import { ENEMIES } from "../data/enemies";
import { ARC } from "../data/tuning";
import { createCodexSave } from "../meta/codex";
import { addHallResult, createHubSave, hallRecordOf } from "../meta/hubStore";
import { hallKeyOfEntry, hallResultLines, hallTabs } from "./bossHall";

const FIRST_BOSS = ARC.chapters[0]?.boss ?? "";
const BOSS_COUNT = ENEMIES.filter((d) => d.boss === true).length;

function outcome(partial: Partial<HallOutcome>): HallOutcome {
  return { done: true, won: true, locked: true, seconds: 30, hits: 2, downs: 1, ...partial };
}

describe("ボスの間の一覧", () => {
  it("候補を全部並べ、未撃破のボスは ？？？ で挑めない", () => {
    const codex = createCodexSave();
    codex.enemyKills[FIRST_BOSS] = 1;
    const tab = hallTabs(codex, createHubSave())[0];
    expect(tab?.entries.map((e) => e.key), "候補の順").toEqual(hallBossKeys());
    expect(tab?.entries.length, "ボスの数を超えない").toBeLessThanOrEqual(BOSS_COUNT);
    const [first, second] = tab?.entries ?? [];
    expect(first?.known, "倒したボス").toBe(true);
    expect(hallKeyOfEntry(first), "倒したボスは挑める").toBe(FIRST_BOSS);
    expect(second?.known, "倒していないボス").toBe(false);
    expect(second?.name, "名前を伏せる").toBe("？？？");
    expect(hallKeyOfEntry(second), "倒していないボスは挑めない").toBeNull();
    expect(hallKeyOfEntry(undefined), "行が無い").toBeNull();
  });

  it("記録があれば最速と被弾、無ければ未撃破", () => {
    const codex = createCodexSave();
    codex.enemyKills[FIRST_BOSS] = 1;
    const before = hallTabs(codex, createHubSave())[0]?.entries[0];
    expect(before?.info, "記録なし").toBe("未撃破");
    const save = addHallResult(createHubSave(), FIRST_BOSS, outcome({ seconds: 42.25, hits: 3 }));
    const after = hallTabs(codex, save)[0]?.entries[0];
    expect(after?.info, "最速と被弾").toContain("42.3");
    expect(after?.info, "被弾の数").toContain("3");
  });
});

describe("ボスの間の結果の行", () => {
  it("初めての撃破は最速の更新を示す", () => {
    const lines = hallResultLines(outcome({ seconds: 30 }), undefined);
    expect(lines, "見出しと最速").toHaveLength(2);
    expect(lines[1], "更新").toContain("更新");
  });

  it("前の最速より速ければ更新、遅ければ前の最速を出す", () => {
    const record = hallRecordOf(addHallResult(createHubSave(), FIRST_BOSS, outcome({ seconds: 30 })), FIRST_BOSS);
    expect(hallResultLines(outcome({ seconds: 20 }), record)[1], "速い").toContain("更新");
    const slower = hallResultLines(outcome({ seconds: 40 }), record)[1];
    expect(slower, "遅い").not.toContain("更新");
    expect(slower, "前の最速").toContain("30.0");
  });

  it("力尽きたら見出しは撃破ではなく、最速の記録が無ければ 1 行", () => {
    const lost = hallResultLines(outcome({ won: false, seconds: 12 }), undefined);
    expect(lost, "1 行").toHaveLength(1);
    expect(lost[0], "撃破ではない").not.toContain("撃破");
  });
});
