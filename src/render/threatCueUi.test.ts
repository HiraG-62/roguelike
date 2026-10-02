import { describe, expect, it } from "vitest";
import { ENEMY_TEMPO, THREAT_CUE } from "../data/tuning";
import { arena, placeEnemy } from "../system/testHelpers";
import { ThreatCues } from "./threatCueUi";

interface Inner {
  edges: { x: number; y: number; dirX: number; dirY: number }[];
  traces: { x0: number; y0: number }[];
}
const inner = (c: ThreatCues): Inner => c as unknown as Inner;

function windupAt(key: string, dx: number, ratio: number) {
  const state = arena();
  const e = placeEnemy(state, key, dx);
  e.phase = "windup";
  e.windupTotal = 1;
  e.phaseTimer = ratio;
  e.strikeDir = { x: -1, y: 0 };
  return { state, e };
}

describe("殺気（画面外の赤の立ち上がり）", () => {
  const YELLOW = 0.95;
  const RED = ENEMY_TEMPO.commitRatio - 0.1;

  it("画面の外の敵が自分に掛かる攻撃で赤に入った瞬間だけ、その方向の縁に 1 本出る", () => {
    const { state, e } = windupAt("laserEye", 330, YELLOW);
    if (e.ai) e.ai.target = { ...state.player.body.pos };
    const cues = new ThreatCues();
    cues.update(state);
    expect(inner(cues).edges.length, "黄の間は出ない").toBe(0);
    e.phaseTimer = RED;
    cues.update(state);
    expect(inner(cues).edges.length, "赤の立ち上がり").toBe(1);
    const edge = inner(cues).edges[0];
    expect(edge?.dirX, "内側（敵と反対）へ向かう").toBeLessThan(0);
    cues.update(state);
    expect(inner(cues).edges.length, "赤のままなら増えない").toBe(1);
  });

  it("画面の中の敵・自分に掛からない敵は出ない", () => {
    const near = windupAt("laserEye", 100, YELLOW);
    if (near.e.ai) near.e.ai.target = { ...near.state.player.body.pos };
    const cues = new ThreatCues();
    cues.update(near.state);
    near.e.phaseTimer = RED;
    cues.update(near.state);
    expect(inner(cues).edges.length, "画面の中").toBe(0);

    const away = windupAt("laserEye", 330, YELLOW);
    const cues2 = new ThreatCues();
    cues2.update(away.state);
    away.e.phaseTimer = RED;
    if (away.e.ai) away.e.ai.target = { x: away.e.body.pos.x + 90, y: away.e.body.pos.y + 40 };
    cues2.update(away.state);
    expect(inner(cues2).edges.length, "自分に掛からない").toBe(0);
  });

  it("出ている時間が過ぎたら消え、同時に出る数は上限で古い物から消える", () => {
    const { state, e } = windupAt("laserEye", 330, YELLOW);
    if (e.ai) e.ai.target = { ...state.player.body.pos };
    const cues = new ThreatCues();
    cues.update(state);
    e.phaseTimer = RED;
    cues.update(state);
    state.time += THREAT_CUE.edgeSec + 0.01;
    cues.update(state);
    expect(inner(cues).edges.length).toBe(0);
    for (let i = 0; i < THREAT_CUE.edgeMax + 2; i++) {
      e.phaseTimer = YELLOW;
      cues.update(state);
      e.phaseTimer = RED;
      cues.update(state);
    }
    expect(inner(cues).edges.length).toBeLessThanOrEqual(THREAT_CUE.edgeMax);
  });
});

describe("被弾筋", () => {
  it("被弾の記録が新しくなった瞬間に、当てた敵から自分へ 1 本引き、記録が変わらなければ増やさない", () => {
    const { state, e } = windupAt("boar", 30, 0.2);
    e.phase = "strike";
    const cues = new ThreatCues();
    cues.update(state);
    state.hurt.last = { kind: "strike", key: "boar", elites: [], nemesis: false };
    cues.update(state);
    expect(inner(cues).traces.length).toBe(1);
    expect(inner(cues).traces[0]?.x0, "出どころは当てた敵").toBeCloseTo(e.body.pos.x, 5);
    cues.update(state);
    expect(inner(cues).traces.length, "同じ記録では増えない").toBe(1);
  });

  it("出どころの位置が無い被弾（状態異常・地形）は引かず、乾く時間が過ぎたら消える", () => {
    const { state, e } = windupAt("boar", 30, 0.2);
    e.phase = "strike";
    const cues = new ThreatCues();
    cues.update(state);
    state.hurt.last = { kind: "status", key: "burn", elites: [], nemesis: false };
    cues.update(state);
    expect(inner(cues).traces.length).toBe(0);
    state.hurt.last = { kind: "strike", key: "boar", elites: [], nemesis: false };
    cues.update(state);
    expect(inner(cues).traces.length).toBe(1);
    state.time += THREAT_CUE.traceSecLow + 0.01;
    cues.update(state);
    expect(inner(cues).traces.length).toBe(0);
  });

  it("最初のフレームにすでにある記録では引かない（基準を取るだけ）", () => {
    const { state, e } = windupAt("boar", 30, 0.2);
    e.phase = "strike";
    state.hurt.last = { kind: "strike", key: "boar", elites: [], nemesis: false };
    const cues = new ThreatCues();
    cues.update(state);
    expect(inner(cues).traces.length).toBe(0);
  });
});
