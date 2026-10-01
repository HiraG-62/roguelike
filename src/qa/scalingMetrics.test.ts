import { describe, expect, it } from "vitest";
import type { DamageBreakdown, MoreMul } from "../core/damage";
import { FIXED_DT } from "../core/loop";
import { COLOR_HURT } from "../system/combat";
import { addFloatingText } from "../system/effects";
import { arena } from "../system/testHelpers";
import {
  bandScalingMetrics,
  buildLifeBalanceTable,
  buildReachSection,
  buildScalingSection,
  createScalingRecorder,
  DEATH_WINDOW_HITS,
  digestBreakdowns,
  emptyScalingTally,
  median,
} from "./scalingMetrics";

function more(source: string, mul: number): MoreMul {
  return { source, label: source, mul };
}

function breakdown(increased: number, mores: readonly MoreMul[]): DamageBreakdown {
  return { base: 10, increased, more: mores, enemyMul: 1, amount: 10 };
}

describe("深度帯ごとの被弾と撃破", () => {
  it("被弾の浮き文字のダメージと被弾時の最大 HP を、その時点の深度帯へ数える", () => {
    const state = arena(1);
    state.depth = 12;
    state.player.maxHp = 100;
    state.player.hp = 100;
    const rec = createScalingRecorder();
    rec.beforeStep(state);
    // damagePlayer が積む浮き文字（継続ダメージは文字を積まないので数えない）
    addFloatingText(state, state.player.body.pos, "-10", COLOR_HURT);
    addFloatingText(state, state.player.body.pos, "+5", "#40ff80");
    state.player.hp = 90;
    state.kills += 2;
    rec.afterStep(state);
    rec.beforeStep(state);
    rec.afterStep(state);
    const b = rec.tally.bands["11-15"];
    expect(b.steps, "2 step").toBe(2);
    expect(b.hits, "被弾は 1 回").toBe(1);
    expect(b.damage).toBe(10);
    expect(b.maxHpAtHits).toBe(100);
    expect(b.kills).toBe(2);
    expect(rec.tally.bands["1-5"].steps, "ほかの帯には入らない").toBe(0);
  });

  it("被弾で死ぬまでの回数 = 最大 HP ÷ 平均被ダメ。被弾が無ければ null", () => {
    const m = bandScalingMetrics({ steps: 3600, kills: 30, hits: 10, damage: 50, maxHpAtHits: 1000, dotDamage: 30 });
    expect(m.hitsToDie, "最大 HP 100 ÷ 平均 5").toBeCloseTo(20, 5);
    expect(m.secondsPerKill, "60 秒 ÷ 30").toBeCloseTo(3600 * FIXED_DT / 30, 5);
    expect(m.hitsPer60, "60 秒に 10 回").toBeCloseTo(10 * 60 / (3600 * FIXED_DT), 5);
    const none = bandScalingMetrics({ steps: 100, kills: 0, hits: 0, damage: 0, maxHpAtHits: 0, dotDamage: 0 });
    expect(none.hitsToDie).toBeNull();
    expect(none.secondsPerKill).toBeNull();
    expect(m.dotPer60, "60 秒に 30").toBeCloseTo(30 * 60 / (3600 * FIXED_DT), 5);
    expect(none.dotPer60, "観測した時間があれば 0").toBe(0);
  });
});

describe("継続ダメージと 1 階の生命の収支", () => {
  it("継続ダメージは、降りる前の階の深度帯へ数える（通常の被弾は数えない）", () => {
    const state = arena(1);
    state.depth = 7;
    const rec = createScalingRecorder();
    rec.beforeStep(state);
    rec.noteDamage(4, true);
    rec.noteDamage(6, false);
    state.depth = 8;
    rec.afterStep(state);
    expect(rec.tally.bands["6-10"].dotDamage, "継続ダメージだけ").toBe(4);
    expect(rec.tally.floor1.runs, "1 階ではない").toBe(0);
  });

  it("1 階では被ダメ・瓶・降階と、残りの回復（その他）を分けて数える", () => {
    const state = arena(1);
    state.depth = 1;
    state.player.maxHp = 100;
    state.player.hp = 50;
    const rec = createScalingRecorder();
    rec.beforeStep(state);
    // 被ダメ 10・瓶 30・降階 5 のあと、自然回復などで 7 増えて 50 - 10 + 30 + 5 + 7 = 82 になる
    rec.noteDamage(10, false);
    rec.noteHeal("flask", 30);
    rec.noteHeal("descend", 5);
    state.player.hp = 82;
    rec.afterStep(state);
    const f = rec.tally.floor1;
    expect(f.runs).toBe(1);
    expect(f.damage).toBe(10);
    expect(f.flask).toBe(30);
    expect(f.descend).toBe(5);
    expect(f.other, "残りの回復").toBeCloseTo(7, 5);
  });

  it("計測外の生命の減り（代償など）でその他の回復が負にならない", () => {
    const state = arena(1);
    state.depth = 1;
    state.player.hp = 50;
    const rec = createScalingRecorder();
    rec.beforeStep(state);
    state.player.hp = 40;
    rec.afterStep(state);
    expect(rec.tally.floor1.other).toBe(0);
  });

  it("表は 1 ランの平均で出し、観測が無いときも NaN を出さない", () => {
    const a = emptyScalingTally();
    a.floor1 = { runs: 1, damage: 100, flask: 30, descend: 20, other: 10 };
    const b = emptyScalingTally();
    b.floor1 = { runs: 1, damage: 60, flask: 10, descend: 0, other: 10 };
    const md = buildLifeBalanceTable([a, b]).join("\n");
    expect(md, "平均: 被ダメ 80・瓶 20・降階 10・その他 10・収支 40").toContain("| 1 階 | 2 | 80 | 20 | 10 | 10 | 40 |");
    expect(buildLifeBalanceTable([emptyScalingTally()]).join("\n")).not.toMatch(/NaN|Infinity/);
  });
});

describe("死亡時の与ダメの内訳", () => {
  it("増の Σ・倍の Π・倍の出所数を平均し、同じ出所は 1 つに畳む", () => {
    const d = digestBreakdowns(9, [
      breakdown(0.5, [more("a", 2), more("b", 1.5)]),
      breakdown(0.3, [more("a", 2), more("a", 2)]),
    ]);
    expect(d?.hits).toBe(2);
    expect(d?.increased, "(0.5 + 0.3) ÷ 2").toBeCloseTo(0.4, 5);
    expect(d?.more, "(3 + 2) ÷ 2").toBeCloseTo(2.5, 5);
    expect(d?.sources, "(2 + 1) ÷ 2").toBeCloseTo(1.5, 5);
    expect(digestBreakdowns(1, []), "与ダメが無ければ null").toBeNull();
  });

  it("直近 DEATH_WINDOW_HITS 発だけを平均する", () => {
    const rec = createScalingRecorder();
    for (let i = 0; i < DEATH_WINDOW_HITS; i++) rec.noteOutgoing(breakdown(9, []));
    for (let i = 0; i < DEATH_WINDOW_HITS; i++) rec.noteOutgoing(breakdown(1, []));
    rec.noteDeath(7);
    expect(rec.tally.death?.increased, "古い 9 は窓から出る").toBeCloseTo(1, 5);
    expect(rec.tally.death?.depth).toBe(7);
  });
});

describe("連鎖の深さと捨てられたイベント", () => {
  it("深さごとに数え、捨てられたイベントは増えた分だけ足す", () => {
    const state = arena(1);
    const rec = createScalingRecorder();
    rec.noteChain(0);
    rec.noteChain(0);
    rec.noteChain(3);
    expect(rec.tally.chainDepths).toEqual([2, 0, 0, 1]);
    rec.beforeStep(state);
    state.ruleRun.droppedEvents += 4;
    rec.afterStep(state);
    expect(rec.tally.droppedEvents).toBe(4);
  });
});

describe("表", () => {
  it("観測が無くても NaN を出さず、深度帯 5 つの行が並ぶ", () => {
    const lines = buildScalingSection("題", "注", [emptyScalingTally()]);
    const md = lines.join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(lines.filter((l) => /^\| (1-5|6-10|11-15|16-20|21\+) \|/.test(l)), "帯の表 + 死亡内訳の表").toHaveLength(10);
    expect(md).toContain("連鎖は記録されなかった");
  });

  it("到達深度は装備別の中央値と踏破率（深度 21 到達）を出す", () => {
    const md = buildReachSection("到達", ["a", "b"], [
      { label: "a", maxDepth: 3 },
      { label: "a", maxDepth: 21 },
      { label: "a", maxDepth: 5 },
      { label: "b", maxDepth: 30 },
    ]).join("\n");
    expect(md).toContain("| a | 3 | 5.0 | 21 | 33.3% |");
    expect(md).toContain("| b | 1 | 30.0 | 30 | 100.0% |");
    expect(median([1, 2, 3, 10]), "偶数個は中央 2 つの平均").toBeCloseTo(2.5, 5);
    expect(median([])).toBeNull();
  });
});
