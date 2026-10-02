import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import { type GameState, runOver } from "../core/state";
import { ARC } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, isBossDepth } from "./boss";
import { chapterAheadLines, finalBossKey, isFinalDepth } from "./chapters";
import { announceChapterAhead, clearRun, updateFinale } from "./finale";
import { buildFloor, descend, rollAreaMul, updateRooms } from "./floor";
import type { RoomProp } from "./specialRooms";
import { slayFloorLord, withInput } from "./testHelpers";

/** 最深の間（深度 21）と踏破（system/finale.ts） */

const FINAL_DEPTH = ARC.floorsPerChapter * ARC.maxChapter + 1;

function finalFloor(seed = 21): GameState {
  const state = createGame(seed);
  state.depth = FINAL_DEPTH;
  buildFloor(state);
  return state;
}

function surfaceProp(state: GameState): RoomProp | undefined {
  for (const room of state.rooms) {
    const prop = room.special?.props.find((p) => p.kind === "surface");
    if (prop) return prop;
  }
  return undefined;
}

/** 最深の主を倒し、地上への道が出るまで進める */
function defeatFinalBoss(state: GameState): RoomProp {
  slayFloorLord(state);
  updateRooms(state, FIXED_DT);
  const prop = surfaceProp(state);
  if (!prop) throw new Error("地上への道が出ていない");
  return prop;
}

function standOn(state: GameState, prop: RoomProp): void {
  state.player.body.pos = { ...prop.pos };
}

describe("最深の間", () => {
  it("isFinalDepth は章の階数 × 章の数 + 1（深度 21）だけ", () => {
    const depths = Array.from({ length: 40 }, (_, i) => i + 1).filter(isFinalDepth);
    expect(depths).toEqual([FINAL_DEPTH]);
    expect(FINAL_DEPTH).toBe(21);
    expect(isFinalDepth(0), "拠点").toBe(false);
  });

  it("最深の間はボス階として作られ、面積は 1 倍・rooms 型・階の主でなく major のボスが ARC.finalBoss", () => {
    const state = finalFloor();
    expect(isBossDepth(FINAL_DEPTH)).toBe(true);
    expect(state.floorKind, "rooms 型").toBe("rooms");
    expect(state.boss?.major, "階の主ではなく階層ボス").toBe(true);
    expect(bossEnemy(state)?.defKey).toBe(ARC.finalBoss);
    expect(bossKeyForDepth(FINAL_DEPTH)).toBe(ARC.finalBoss);
    expect(finalBossKey(FINAL_DEPTH)).toBe(ARC.finalBoss);
    const rng = createRng(1);
    const first = createRng(1).next();
    expect(rollAreaMul(rng, FINAL_DEPTH), "面積は 1 倍").toBe(1);
    expect(rng.next(), "面積の抽選で乱数を引かない").toBe(first);
  });

  it("深度 22 は最深の間ではなく、25 は深みの回転のボス", () => {
    expect(isFinalDepth(FINAL_DEPTH + 1)).toBe(false);
    expect(finalBossKey(FINAL_DEPTH + 1)).toBeNull();
    expect(isBossDepth(FINAL_DEPTH + 1)).toBe(false);
    expect(isBossDepth(25)).toBe(true);
    expect(bossKeyForDepth(25)).toBe("boneLord");
  });
});

describe("最深の主の撃破と地上への道", () => {
  it("倒すと階段が出て、中央から右へ surfaceOffset タイルの床に地上への道が出る", () => {
    const state = finalFloor();
    expect(surfaceProp(state), "倒す前は無い").toBeUndefined();
    const prop = defeatFinalBoss(state);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!room) throw new Error("ボス部屋が無い");
    const c = rectCenter(room.rect);
    expect(getTile(state.map, c.x, c.y), "階段（深みへ）").toBe(Tile.StairsDown);
    expect(Math.floor(prop.pos.x / TILE_SIZE)).toBe(c.x + ARC.surfaceOffset);
    expect(Math.floor(prop.pos.y / TILE_SIZE)).toBe(c.y);
    expect(getTile(state.map, c.x + ARC.surfaceOffset, c.y)).toBe(Tile.Floor);
  });

  it("地上への道は 1 度しか置かれない", () => {
    const state = finalFloor();
    defeatFinalBoss(state);
    for (let i = 0; i < 5; i++) updateFinale(state);
    const count = state.rooms.flatMap((r) => r.special?.props ?? []).filter((p) => p.kind === "surface").length;
    expect(count).toBe(1);
  });

  it("最深の間でなければ、ボスを倒しても地上への道は出ない", () => {
    const state = createGame(21);
    state.depth = ARC.floorsPerChapter;
    buildFloor(state);
    slayFloorLord(state);
    updateRooms(state, FIXED_DT);
    expect(surfaceProp(state)).toBeUndefined();
  });

  it("surfaceHold 秒乗り続けると踏破になり、status が cleared でラン記録は 1 回だけ", () => {
    const state = finalFloor();
    const prop = defeatFinalBoss(state);
    state.kills = 7;
    const killsBefore = state.profile.meta.totalKills;
    standOn(state, prop);
    const frames = Math.ceil(ARC.surfaceHold / FIXED_DT) + 2;
    for (let i = 0; i < frames && state.status === "playing"; i++) updateRooms(state, FIXED_DT);
    expect(state.status).toBe("cleared");
    expect(runOver(state)).toBe(true);
    expect(state.runRecorded).toBe(true);
    expect(state.profile.meta.totalKills - killsBefore, "撃破数が 1 回だけ記録される").toBe(7);
    clearRun(state);
    expect(state.profile.meta.totalKills - killsBefore, "二重に記録しない").toBe(7);
    expect(state.log.some((l) => l.text.includes("踏破"))).toBe(true);
  });

  it("surfaceHold に届く前は踏破にならず、離れると乗った秒が 0 に戻る", () => {
    const state = finalFloor();
    const prop = defeatFinalBoss(state);
    standOn(state, prop);
    const half = Math.floor(ARC.surfaceHold / FIXED_DT / 2);
    for (let i = 0; i < half; i++) updateRooms(state, FIXED_DT);
    expect(state.status).toBe("playing");
    expect(prop.hold ?? 0, "乗っている間は秒が溜まる").toBeGreaterThan(0);
    state.player.body.pos = { x: prop.pos.x + TILE_SIZE * 6, y: prop.pos.y };
    updateRooms(state, FIXED_DT);
    expect(prop.hold, "離れたら 0").toBe(0);
    standOn(state, prop);
    for (let i = 0; i < half; i++) updateRooms(state, FIXED_DT);
    expect(state.status, "溜め直しなので踏破にならない").toBe("playing");
  });

  it("踏破の後は step が進まない（死亡と同じ扱いで、経過の演出だけ進む）", () => {
    const state = finalFloor();
    const prop = defeatFinalBoss(state);
    standOn(state, prop);
    clearRun(state);
    const time = state.time;
    const pos = { ...state.player.body.pos };
    step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.time, "時間が進まない").toBe(time);
    expect(state.player.body.pos, "動けない").toEqual(pos);
    expect(state.deathTimer, "終わりの画面の秒は進む").toBeGreaterThan(0);
  });
});

describe("章の主の予習", () => {
  it("章の休符（6 / 11 / 16）でこの章の主の階と名を出し、それ以外の階は出さない", () => {
    expect(chapterAheadLines(6)).toEqual(["この章の主: 地下 10 階 盗賊王"]);
    expect(chapterAheadLines(11)[0]).toContain("地下 15 階");
    expect([1, 2, 5, 7, 10, 21].map((d) => chapterAheadLines(d).length)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("深度 16 は鏡の騎士（20）と最深の主（21）の 2 行", () => {
    const lines = chapterAheadLines(16);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("地下 20 階");
    expect(lines[1]).toContain(`地下 ${FINAL_DEPTH} 階`);
  });

  it("休符に初めて降りたときログに出る", () => {
    const state = createGame(3);
    state.depth = 5;
    descend(state);
    expect(state.depth).toBe(6);
    expect(state.log.some((l) => l.color === ARC.aheadColor && l.text.includes("地下 10 階"))).toBe(true);
    const logged = state.log.length;
    announceChapterAhead(state);
    expect(state.log.length, "announceChapterAhead は文を足す").toBeGreaterThan(logged);
  });
});
