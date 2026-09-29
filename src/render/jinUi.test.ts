import { describe, expect, it } from "vitest";
import { ROAMING_ROOM, type GameState, type Jin } from "../core/state";
import { VIEW_W } from "../core/view";
import { JIN } from "../data/tuning";
import { arena, engageStartRoom, placeEnemy } from "../system/testHelpers";
import { isJinLeader, jinHudLayout, jinHudTarget, jinHudTitle, jinLeader, jinMoraleRatio } from "./jinUi";

let nextId = 1;

function makeJin(patch: Partial<Jin> = {}): Jin {
  return {
    id: nextId++,
    roomIndex: 0,
    formation: "fishScale",
    center: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    leaderId: null,
    morale: 6,
    moraleMax: 6,
    phase: "engaged",
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
    ...patch,
  };
}

/** 開始部屋で交戦中、ボスもいない状態 */
function engagedArena(): GameState {
  const state = arena();
  state.boss = null;
  state.jins = [];
  engageStartRoom(state);
  return state;
}

describe("群勢のバーの割合", () => {
  it("morale / moraleMax を 0〜1 に収める", () => {
    expect(jinMoraleRatio({ morale: 3, moraleMax: 6 }), "半分").toBe(0.5);
    expect(jinMoraleRatio({ morale: 9, moraleMax: 6 }), "合流で上限を超えても 1").toBe(1);
    expect(jinMoraleRatio({ morale: -1, moraleMax: 6 }), "負でも 0").toBe(0);
  });

  it("moraleMax が 0 以下なら 0（3a の初期値でも壊れない）", () => {
    expect(jinMoraleRatio({ morale: 0, moraleMax: 0 }), "0 割りしない").toBe(0);
    expect(jinMoraleRatio({ morale: 5, moraleMax: -1 })).toBe(0);
  });
});

describe("陣の名札の見出し", () => {
  it("陣形の表示名 + 「の陣」", () => {
    expect(jinHudTitle({ formation: "fishScale" })).toBe("魚鱗の陣");
    expect(jinHudTitle({ formation: "geese" })).toBe("雁行の陣");
  });
});

describe("名札に出す陣の選び方", () => {
  it("陣が無ければ出さない", () => {
    const state = engagedArena();
    expect(jinHudTarget(state)).toBeNull();
  });

  it("交戦中の塊に乗った陣を出す", () => {
    const state = engagedArena();
    const other = makeJin({ roomIndex: 3, center: { x: state.player.body.pos.x + 10, y: state.player.body.pos.y } });
    const mine = makeJin({ roomIndex: 0, center: { x: state.player.body.pos.x + 200, y: state.player.body.pos.y } });
    state.jins = [other, mine];
    expect(jinHudTarget(state)?.id, "近くの別の塊ではなく交戦中の塊の陣").toBe(mine.id);
  });

  it("交戦中の塊の陣が無ければ、最も近い交戦中の陣（範囲内）", () => {
    const state = engagedArena();
    const p = state.player.body.pos;
    const far = makeJin({ roomIndex: ROAMING_ROOM, center: { x: p.x + JIN.hud.range - 10, y: p.y } });
    const near = makeJin({ roomIndex: ROAMING_ROOM, center: { x: p.x + 50, y: p.y } });
    state.jins = [far, near];
    expect(jinHudTarget(state)?.id).toBe(near.id);
  });

  it("範囲外・眠っている・決着済みの陣は出さない", () => {
    const state = engagedArena();
    const p = state.player.body.pos;
    state.rooms[0]!.engaged = false;
    state.jins = [
      makeJin({ roomIndex: ROAMING_ROOM, center: { x: p.x + JIN.hud.range + 50, y: p.y } }),
      makeJin({ roomIndex: ROAMING_ROOM, center: { x: p.x + 20, y: p.y }, phase: "sleeping" }),
      makeJin({ roomIndex: ROAMING_ROOM, center: { x: p.x + 20, y: p.y }, phase: "settled", settledBy: "wipe" }),
    ];
    expect(jinHudTarget(state), "どれも対象外").toBeNull();
  });

  it("群勢が無い陣（moraleMax が 0）は出さない", () => {
    const state = engagedArena();
    state.jins = [makeJin({ roomIndex: 0, moraleMax: 0, morale: 0 })];
    expect(jinHudTarget(state)).toBeNull();
  });

  it("ボスバーが出ている間は出さない（ボスの部屋は drawBossBar に譲る）", () => {
    const state = engagedArena();
    state.jins = [makeJin({ roomIndex: 0 })];
    expect(jinHudTarget(state), "ボスなしなら出る").not.toBeNull();
    state.boss = { enemyId: 999, name: "主", roomIndex: 0, introTimer: 0, defeated: false, major: false };
    state.rooms[0]!.locked = true;
    expect(jinHudTarget(state), "封鎖したボスの部屋では出さない").toBeNull();
  });

  it("倒し終えたボスの部屋には影響しない", () => {
    const state = engagedArena();
    state.jins = [makeJin({ roomIndex: 0 })];
    state.boss = { enemyId: 999, name: "主", roomIndex: 0, introTimer: 0, defeated: true, major: false };
    expect(jinHudTarget(state)).not.toBeNull();
  });

  it("ボスの部屋の陣は、封鎖の前でも出さない", () => {
    const state = engagedArena();
    state.jins = [makeJin({ roomIndex: 0 })];
    state.boss = { enemyId: 999, name: "主", roomIndex: 0, introTimer: 0, defeated: false, major: false };
    state.rooms[0]!.locked = false;
    expect(jinHudTarget(state)).toBeNull();
  });
});

describe("大将の判定", () => {
  it("leaderId の敵が大将で、他のメンバーは大将でない", () => {
    const state = engagedArena();
    const a = placeEnemy(state, "slime", 60);
    const b = placeEnemy(state, "slime", 80);
    const jin = makeJin({ leaderId: a.id });
    a.jinId = jin.id;
    b.jinId = jin.id;
    state.jins = [jin];
    expect(isJinLeader(state, a), "大将").toBe(true);
    expect(isJinLeader(state, b), "隊員").toBe(false);
    expect(jinLeader(state, jin)?.id).toBe(a.id);
  });

  it("倒れた大将・大将のいない陣・陣に属さない敵は大将にならない", () => {
    const state = engagedArena();
    const a = placeEnemy(state, "slime", 60);
    const loner = placeEnemy(state, "slime", 90);
    const jin = makeJin({ leaderId: a.id });
    a.jinId = jin.id;
    state.jins = [jin];
    expect(isJinLeader(state, loner), "陣に属さない").toBe(false);
    a.hp = 0;
    expect(isJinLeader(state, a), "倒れた大将").toBe(false);
    expect(jinLeader(state, jin), "生きていなければ undefined").toBeUndefined();
    jin.leaderId = null;
    expect(jinLeader(state, jin), "大将のいない陣").toBeUndefined();
  });
});

describe("名札の配置", () => {
  it("行高が大きくなっても、見出し・バー・大将名が順に並んで詰まらない", () => {
    for (const lineH of [8, 10, 14, 20]) {
      const l = jinHudLayout(lineH);
      expect(l.titleBaseline, `行高 ${lineH}: 見出しはバーの上`).toBeLessThan(l.bar.y);
      expect(l.leaderBaseline - (l.bar.y + l.bar.h), `行高 ${lineH}: 大将名はバーの下で最低の行高を空ける`).toBeGreaterThanOrEqual(Math.max(10, lineH) - 1);
    }
  });

  it("バーは画面の横中央で、画面内に収まる", () => {
    const { bar } = jinHudLayout(10);
    expect(bar.x + bar.w / 2, "中央").toBe(VIEW_W / 2);
    expect(bar.x, "左端").toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.w, "右端").toBeLessThanOrEqual(VIEW_W);
  });
});
