import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { BossRecord } from "../core/state";
import { BOSS } from "../data/tuning";
import { bossEnemy } from "../system/boss";
import { BOSS_THREATS } from "../system/bossKit";
import { buildFloor } from "../system/floor";
import {
  BOSS_STAGE_COUNT,
  BOSS_TARGETS,
  type BossFight,
  MIN_HITS_FOR_SHARE,
  buildBossLogSection,
  buildBossProbeLines,
  deepLordStageOff,
  emptyBossRun,
  emptyStageHits,
  isIndirectHurt,
  median,
  missesThreat,
  noteStageHit,
  pearson,
  recordBossRun,
  stageAdvancedByAct,
  summarizeBossLog,
  summarizeFights,
  threatShare,
} from "./bossMetrics";

const NEAR = BOSS.rules.nearDist - 1;
const MID = (BOSS.rules.nearDist + BOSS.rules.farDist) / 2;
const FAR = BOSS.rules.farDist + 1;

function fight(over: Partial<BossFight> = {}): BossFight {
  return {
    key: "kingSlime",
    depth: 5,
    seed: 1,
    outcome: "defeated",
    seconds: 60,
    hits: 5,
    downs: 2,
    stageSeconds: [20, 20, 20],
    stageHits: [emptyStageHits(), emptyStageHits(), emptyStageHits()],
    transitions: [],
    minionKills: 0,
    ...over,
  };
}

describe("中央値と相関", () => {
  it("中央値は奇数個で真ん中、偶数個で真ん中 2 つの平均、空なら null", () => {
    expect(median([3, 1, 2]), "奇数個").toBe(2);
    expect(median([4, 1, 3, 2]), "偶数個").toBe(2.5);
    expect(median([]), "空").toBeNull();
  });

  it("相関は同じ向きで 1、逆向きで -1、3 組未満や一定の列は null", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 5);
    expect(pearson([1, 2], [1, 2]), "2 組").toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3]), "片方が一定").toBeNull();
  });
});

describe("段階ごとの被弾の数え方", () => {
  it("間合い（近い・中・遠い）と静止中と地形・影・柵を数える", () => {
    const t = emptyStageHits();
    noteStageHit(t, NEAR, 0, false);
    noteStageHit(t, MID, BOSS.rules.stillSec, true);
    noteStageHit(t, FAR, BOSS.rules.stillSec - 0.1, true);
    expect(t, "3 件の内訳").toEqual({ hits: 3, near: 1, mid: 1, far: 1, still: 1, indirect: 2 });
  });

  it("地形・影・柵・余波などは間接、敵の一撃・射撃・死神は間接でない", () => {
    for (const kind of ["hazard", "terrain", "blast", "fall", "status", "linger", "deferred"] as const) {
      expect(isIndirectHurt(kind), kind).toBe(true);
    }
    for (const kind of ["strike", "shot", "reaper", "event"] as const) {
      expect(isIndirectHurt(kind), kind).toBe(false);
    }
    expect(isIndirectHurt(undefined)).toBe(false);
  });

  it("危ない間合いに合う被弾の割合を段階の帯で出し、被弾が少ない段階は外れても印を付けない", () => {
    const t = emptyStageHits();
    for (let i = 0; i < MIN_HITS_FOR_SHARE; i++) noteStageHit(t, FAR, 0, false);
    expect(threatShare(t, "far"), "遠い被弾 100%").toBe(1);
    expect(threatShare(t, "near"), "近い被弾 0%").toBe(0);
    expect(missesThreat(t, "near"), "被弾 5 回で近い被弾が 0% なら外れ").toBe(true);
    expect(missesThreat(t, "far"), "遠い被弾が 100% なら合う").toBe(false);
    const few = emptyStageHits();
    noteStageHit(few, FAR, 0, false);
    expect(missesThreat(few, "near"), "被弾 1 回は判定しない").toBe(false);
    expect(threatShare(emptyStageHits(), "still"), "被弾 0 は null").toBeNull();
  });

  it("章ボス 4 と最深の主の段階の危ない間合いが表に載る（BOSS_THREATS の全段階）", () => {
    for (const key of Object.keys(BOSS_THREATS)) {
      expect(BOSS_THREATS[key]?.length, key).toBe(BOSS_STAGE_COUNT);
    }
  });
});

describe("行為で進んだ段階の見分け", () => {
  it("生命が閾値より上で進んでいれば行為、閾値以下なら生命で進んだ", () => {
    expect(stageAdvancedByAct("kingSlime", 1, BOSS.kingSlime.phase2Ratio - 0.01), "スライム王の第 1→2 は生命").toBe(false);
    expect(stageAdvancedByAct("kingSlime", 2, BOSS.kingSlime.phase3Ratio + 0.2), "分裂体が 0 体で第 3 段階").toBe(true);
    expect(stageAdvancedByAct("thiefKing", 2, BOSS.thiefKing.phase3Ratio + 0.2), "追い詰めで開き直り").toBe(true);
    expect(stageAdvancedByAct("oilKing", 2, BOSS.oilKing.phase3Ratio - 0.01), "油壺の王の第 2→3 が生命").toBe(false);
    expect(stageAdvancedByAct("mirrorKnight", 1, BOSS.mirrorKnight.phase2Ratio + 0.2), "壁激突で盾割れ").toBe(true);
  });

  it("最深の主の第 1→2 段階は門柱の行為だけで進み、第 2→3 は生命", () => {
    expect(stageAdvancedByAct("deepLord", 1, 1), "生命が満タンでも門柱で進む").toBe(true);
    expect(stageAdvancedByAct("deepLord", 2, BOSS.deepLord.phase3Ratio - 0.01)).toBe(false);
  });

  it("閾値の表に無いボス・段階は null", () => {
    expect(stageAdvancedByAct("boneLord", 1, 0.5)).toBeNull();
    expect(stageAdvancedByAct("kingSlime", 3, 0.5)).toBeNull();
  });
});

describe("フル QA の bossLog の集計", () => {
  const rec = (key: string, seconds: number, hits: number, downs: number): BossRecord => ({ key, depth: 5, seconds, hits, downs });

  it("ボスごとに戦闘数・撃破数・死亡数・秒と被弾とダウンの中央値を出す", () => {
    const a = emptyBossRun();
    a.records.push(rec("kingSlime", 50, 4, 2), rec("kingSlime", 70, 6, 3));
    a.diedIn.push({ key: "kingSlime", depth: 5, seconds: 30, hits: 9 });
    const b = emptyBossRun();
    b.records.push(rec("kingSlime", 60, 5, 2), rec("thiefKing", 90, 5, 2));
    const summary = summarizeBossLog([a, b]);
    const slime = summary.find((s) => s.key === "kingSlime");
    expect(slime?.fights, "撃破 3 + 死亡 1").toBe(4);
    expect(slime?.defeats).toBe(3);
    expect(slime?.deaths).toBe(1);
    expect(slime?.secondsMedian, "撃破の秒 50 / 60 / 70").toBe(60);
    expect(slime?.hitsMedian).toBe(5);
    expect(summary.map((s) => s.key), "章の順").toEqual(["kingSlime", "thiefKing"]);
  });

  it("report の表に NaN・Infinity が出ず、秒・被弾に * が付かず、装備の注記がある", () => {
    const a = emptyBossRun();
    a.records.push(rec("kingSlime", 20, 4, 2), rec("thiefKing", 200, 12, 2));
    const md = buildBossLogSection([a], 10, 4).join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md.startsWith("## ボス")).toBe(true);
    const slimeLine = md.split("\n").find((l) => l.startsWith("| kingSlime |")) ?? "";
    expect(slimeLine, "目標の外の秒にも * が付かない").toContain("| 20.0 |");
    const thiefLine = md.split("\n").find((l) => l.startsWith("| thiefKing |")) ?? "";
    expect(thiefLine, "目標の外の秒・被弾にも * が付かない").toContain("| 200.0 | 12.0 |");
    expect(md, "目標の秒の列が無い").not.toContain("目標の秒");
    expect(md, "装備の注記がある").toContain("itemLevel 20 固定");
  });

  it("ボス戦が 1 度も無ければ、その旨を 1 行で書く", () => {
    const md = buildBossLogSection([emptyBossRun()], 5, 0).join("\n");
    expect(md).toContain("1 度も起きなかった");
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it("踏破率はラン数に対する最深の主の撃破数、ボス戦の死は死亡したランに対する割合で書く", () => {
    const t = emptyBossRun();
    t.records.push(rec("deepLord", 150, 5, 2));
    t.diedIn.push({ key: "kingSlime", depth: 5, seconds: 20, hits: 9 });
    const md = buildBossLogSection([t], 20, 5).join("\n");
    expect(md).toContain("1 / 20（5%");
    expect(md).toContain("1 / 死亡したラン 5（20%");
  });

  it("recordBossRun は bossLog を写し、ボスの封鎖中に力尽きた戦いを 1 件積む", () => {
    const state = createGame(3);
    state.depth = BOSS.interval;
    buildFloor(state);
    const boss = bossEnemy(state);
    if (!state.boss || !boss) throw new Error("ボス部屋がない");
    state.bossLog.push(rec("thiefKing", 80, 5, 2));
    state.boss.lockedAt = 10;
    state.boss.hits = 7;
    state.time = 55;

    const alive = emptyBossRun();
    recordBossRun(alive, state);
    expect(alive.records, "bossLog は写す").toHaveLength(1);
    expect(alive.diedIn, "生きていれば戦いを積まない").toHaveLength(0);

    state.status = "dead";
    const dead = emptyBossRun();
    recordBossRun(dead, state);
    expect(dead.diedIn).toEqual([{ key: boss.defKey, depth: BOSS.interval, seconds: 45, hits: 7 }]);

    state.boss.defeated = true;
    const won = emptyBossRun();
    recordBossRun(won, state);
    expect(won.diedIn, "倒した後に力尽きても、ボス戦の死には数えない").toHaveLength(0);
  });
});

describe("probe の集計", () => {
  it("撃破の秒は撃破した戦いだけ、被弾・ダウンは全戦の中央値で、封鎖しなかった戦いは入らない", () => {
    const fights = [
      fight({ seconds: 40, hits: 4, downs: 2 }),
      fight({ seconds: 60, hits: 6, downs: 3, seed: 2 }),
      fight({ outcome: "died", seconds: 10, hits: 12, downs: 0, seed: 3 }),
      fight({ outcome: "unlocked", seconds: 0, hits: 0, downs: 0, seed: 4 }),
    ];
    const s = summarizeFights(fights)[0];
    expect(s?.fights, "unlocked は数えない").toBe(3);
    expect(s?.defeats).toBe(2);
    expect(s?.deaths).toBe(1);
    expect(s?.secondsMedian, "撃破の 40 / 60").toBe(50);
    expect(s?.hitsMedian, "被弾 4 / 6 / 12").toBe(6);
    expect(s?.downsMedian, "ダウン 2 / 3 / 0").toBe(2);
  });

  it("行為で進んだ段階の割合と、取り巻き数と撃破秒の相関を出す", () => {
    const fights = [
      fight({ seconds: 50, minionKills: 6, transitions: [{ from: 1, byAct: false }, { from: 2, byAct: true }] }),
      fight({ seconds: 70, minionKills: 3, seed: 2, transitions: [{ from: 1, byAct: false }, { from: 2, byAct: false }] }),
      fight({ seconds: 90, minionKills: 0, seed: 3, transitions: [{ from: 1, byAct: false }] }),
    ];
    const s = summarizeFights(fights)[0];
    expect(s?.transitions).toBe(5);
    expect(s?.actTransitions).toBe(1);
    expect(s?.minionCorrelation ?? 0, "倒した方が短いので負").toBeLessThan(0);
  });

  it("段階ごとの被弾は戦いをまたいで足し、秒の割合の段階の並びを保つ", () => {
    const a = fight();
    noteStageHit(a.stageHits[0] ?? emptyStageHits(), NEAR, 0, false);
    const b = fight({ seed: 2, stageSeconds: [10, 30, 0] });
    noteStageHit(b.stageHits[0] ?? emptyStageHits(), FAR, 0, true);
    const s = summarizeFights([a, b])[0];
    expect(s?.stageHits[0]?.hits, "第 1 段階の被弾").toBe(2);
    expect(s?.stageHits[0]).toMatchObject({ near: 1, far: 1, indirect: 1 });
    expect(s?.stageSeconds, "段階ごとの秒の合計").toEqual([30, 50, 20]);
  });

  it("表に NaN・Infinity が出ず、目標の幅の外に * が付く", () => {
    const short = fight({ seconds: 10 });
    const md = buildBossProbeLines([short, fight({ key: "deepLord", depth: 21, outcome: "died", seconds: 30 })], "試験").join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md.startsWith("## ボス")).toBe(true);
    const line = md.split("\n").find((l) => l.startsWith("| kingSlime | 1 |")) ?? "";
    expect(line, "10 秒はスライム王の目標 40〜90 の外").toContain("| 10.0* |");
    expect(BOSS_TARGETS.kingSlime?.seconds).toEqual([40, 90]);
  });

  it("測れた戦いが無ければその旨を書く", () => {
    const md = buildBossProbeLines([fight({ outcome: "unlocked" })], "試験").join("\n");
    expect(md).toContain("測れた戦いが無かった");
  });

  it("最深の主の段階の長さが 3:4:3 から大きく外れると知らせる", () => {
    const even = summarizeFights([fight({ key: "deepLord", stageSeconds: [30, 40, 30] })])[0];
    const stuck = summarizeFights([fight({ key: "deepLord", stageSeconds: [90, 5, 5] })])[0];
    if (!even || !stuck) throw new Error("集計が無い");
    expect(deepLordStageOff(even), "3:4:3 ぴったり").toBe(false);
    expect(deepLordStageOff(stuck), "第 1 段階が 9 割").toBe(true);
    expect(deepLordStageOff(summarizeFights([fight({ key: "deepLord", stageSeconds: [0, 0, 0] })])[0] ?? even), "総秒 0").toBe(false);
  });
});
