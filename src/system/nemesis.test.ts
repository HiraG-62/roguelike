import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type EliteKind, type Enemy, type GameState, ROAMING_ROOM } from "../core/state";
import { dist } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { NEMESIS } from "../data/tuning";
import { createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { damageEnemy } from "./combat";
import { eliteDisplayName } from "./elites";
import { ascend, descend, withBaseAreaMul } from "./floor";
import { createNemesisRun } from "./nemesis";
import { type RunMetaSetup, emptyRunMeta } from "./runMeta";
import type { RunSetup } from "./runSetup";
import { withInput } from "./testHelpers";

const SEED = 4242;

function metaWith(elites: EliteKind[] = [], depth = 5, key = "wolf"): RunMetaSetup {
  return { ...emptyRunMeta(), nemesis: { key, elites, depth } };
}

function start(startDepth: number, runMeta?: RunMetaSetup, seed = SEED): GameState {
  const setup: RunSetup = { origin: "wanderer", modifiers: [], startDepth, ...(runMeta ? { runMeta } : {}) };
  return withBaseAreaMul(() => createGame(seed, String(seed), createEmptyProfile(), createDefaultSkillProfile(), setup));
}

function nemeses(state: GameState): Enemy[] {
  return state.enemies.filter((e) => e.nemesis === true);
}

function goDown(state: GameState): void {
  withBaseAreaMul(() => descend(state));
}

describe("仇", () => {
  it("出る階は max(minDepth, 倒された深度 − depthLead, 敵の minDepth)", () => {
    expect(createNemesisRun({ key: "wolf", elites: [], depth: 9 })?.spawnDepth).toBe(9 - NEMESIS.depthLead);
    expect(createNemesisRun({ key: "wolf", elites: [], depth: 1 })?.spawnDepth, "敵の minDepth より浅くしない").toBe(enemyDef("wolf").minDepth);
    expect(createNemesisRun({ key: "kingSlime", elites: [], depth: 5 }), "ボスは仇にしない").toBeNull();
    expect(createNemesisRun(null)).toBeNull();
  });

  it("仇は spawnDepth 以上の初めての階で、開始から最も遠い眠った陣に 1 体だけ出る", () => {
    const state = start(3, metaWith());
    expect(state.nemesis?.spawnDepth).toBe(4);
    expect(nemeses(state), "spawnDepth より浅い階には出ない").toHaveLength(0);
    goDown(state);
    const found = nemeses(state);
    expect(found, "1 体だけ").toHaveLength(1);
    const e = found[0] as Enemy;
    expect(state.nemesis?.placed).toBe(true);
    expect(state.nemesis?.enemyId).toBe(e.id);
    const startPos = state.player.body.pos;
    const jin = state.jins.find((j) => j.id === e.jinId);
    expect(jin?.roomIndex, "部屋の陣").not.toBe(ROAMING_ROOM);
    const sleeping = state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM && j.phase === "sleeping");
    const farthest = Math.max(...sleeping.map((j) => dist(j.center, startPos)));
    expect(dist(jin?.center ?? startPos, startPos), "開始から最も遠い陣").toBe(farthest);
    goDown(state);
    expect(nemeses(state), "次の階には 2 体目を出さない").toHaveLength(0);
  });

  it("仇は記録の修飾子に 1 つ足し、猛と生命の倍率を持つ", () => {
    const state = start(4, metaWith(["hasted"]));
    const e = nemeses(state)[0];
    expect(e, "仇がいる").toBeDefined();
    if (!e) return;
    expect(e.elite, "記録の修飾子が主").toBe("hasted");
    expect(e.eliteExtra, "1 つ足す").toBeDefined();
    expect(e.grade, "猛").toBe("strong");
    const plain = start(4, metaWith([]));
    const single = nemeses(plain)[0];
    expect(single?.elite, "記録が空なら 1 つだけ").toBeDefined();
    expect(single?.eliteExtra, "記録が空なら添えなし").toBeUndefined();
  });

  it("修飾子 2 つの仇は修飾子を増やさず、生命の倍率だけ上がる", () => {
    const one = nemeses(start(4, metaWith(["hasted"])))[0];
    const two = nemeses(start(4, metaWith(["hasted", "shielded"])))[0];
    expect(two?.elite).toBe("hasted");
    expect(two?.eliteExtra).toBe("shielded");
    expect(one && two && two.maxHp > one.maxHp, "頭打ちの仇は生命が多い").toBe(true);
  });

  it("ボスの階・最深の間には出さず、次の階へ持ち越す", () => {
    const boss = start(5, metaWith([], 6));
    expect(boss.nemesis?.spawnDepth).toBe(5);
    expect(nemeses(boss), "ボスの階には出ない").toHaveLength(0);
    expect(boss.nemesis?.placed).toBe(false);
    goDown(boss);
    expect(nemeses(boss), "次の階で出る").toHaveLength(1);
    const final = start(21, metaWith([], 22));
    expect(nemeses(final), "最深の間には出ない").toHaveLength(0);
  });

  it("上り階段で戻った階に 2 体目を出さない", () => {
    const state = start(4, metaWith());
    expect(nemeses(state)).toHaveLength(1);
    withBaseAreaMul(() => ascend(state));
    expect(nemeses(state), "戻った階").toHaveLength(0);
    goDown(state);
    expect(nemeses(state), "降り直した階").toHaveLength(0);
  });

  it("倒すと遺物と鍵が落ち avenged になる", () => {
    const state = start(4, metaWith());
    const e = nemeses(state)[0];
    if (!e) throw new Error("仇がいない");
    const items = state.floorItems.length;
    const keys = state.pickups.filter((p) => p.kind === "key").length;
    damageEnemy(state, e, e.hp * 10, { x: 1, y: 0 }, 0);
    // ヒットストップが明けるまで進める
    for (let i = 0; i < 30 && state.enemies.includes(e); i++) step(state, withInput({}), FIXED_DT);
    expect(state.nemesis?.avenged, "仇討ち").toBe(true);
    expect(state.floorItems.length - items, "遺物").toBeGreaterThanOrEqual(NEMESIS.rewardItems);
    expect(state.pickups.filter((p) => p.kind === "key").length - keys, "鍵").toBeGreaterThanOrEqual(NEMESIS.rewardKeys);
  });

  it("runMeta が空なら敵の配置・乱数の消費が今と同じ（仇が出ない階も同じ）", () => {
    const none = start(4);
    const empty = start(4, emptyRunMeta());
    const notYet = start(4, metaWith([], 12));
    const layout = (s: GameState): string => s.enemies.map((e) => `${e.id}:${e.defKey}:${e.body.pos.x}:${e.body.pos.y}:${e.maxHp}`).join(",");
    expect(layout(empty)).toBe(layout(none));
    expect(layout(notYet), "仇がまだ出ない階").toBe(layout(none));
    expect(empty.rng.next()).toBe(none.rng.next());
    expect(notYet.rng.next()).toBe(start(4).rng.next());
  });

  it("同じ seed と runMeta なら同じ位置・同じ修飾子", () => {
    const a = nemeses(start(4, metaWith(["hasted"])))[0];
    const b = nemeses(start(4, metaWith(["hasted"])))[0];
    expect(a && b && { id: a.id, pos: a.body.pos, elite: a.elite, extra: a.eliteExtra, hp: a.maxHp }).toEqual(
      b && { id: b.id, pos: b.body.pos, elite: b.elite, extra: b.eliteExtra, hp: b.maxHp },
    );
  });

  it("名札の頭に仇・", () => {
    const e = nemeses(start(4, metaWith()))[0];
    expect(e && eliteDisplayName(e).startsWith("仇・")).toBe(true);
  });
});
