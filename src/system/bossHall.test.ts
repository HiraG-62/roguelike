import { afterEach, describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import { guardStorageWrites } from "../core/replay";
import { type GameState, runOver } from "../core/state";
import { ARC } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { type Profile, createEmptyProfile } from "../loot/types";
import { TILE_SIZE, rectContainsPx } from "../map/grid";
import { MemoryStorage } from "../meta/testStorage";
import { setSaveStorage } from "../save/backend";
import { createDefaultSkillProfile } from "../skills/persistence";
import { bossEnemy } from "./boss";
import { type HallRun, createHallGame, createHallRun, hallBossKeys, hallDepthOf, hallOutcome, hallSeedText, stepHall } from "./bossHall";
import { slayFloorLord, withInput } from "./testHelpers";

/** 封鎖を待つ step の上限（入口に立てば 1〜2 step で封鎖される） */
const LOCK_STEPS = 10;
/** 力尽きるまで待つ step の上限（生命 1 で棒立ち） */
const DEATH_STEPS = 60 * 90;

const FIRST_BOSS = ARC.chapters[0]?.boss ?? "";

/** 借り物の短剣を右手に持つプロフィール（武器掛けの借り物も写しに入ることを見る） */
function loanedProfile(): Profile {
  const profile = createEmptyProfile();
  const dagger = generateItem(createRng(7), { baseKey: "dagger", plain: true, itemLevel: 1, foundDepth: 1, now: 0 });
  profile.equipment.mainHand = { ...dagger, loaned: true };
  return profile;
}

function hallGame(key: string, profile: Profile = loanedProfile()): GameState {
  const state = createHallGame(key, profile, createDefaultSkillProfile(), undefined, 1);
  if (!state) throw new Error(`ボスの間を作れない: ${key}`);
  return state;
}

function hallRun(key: string): HallRun {
  const run = createHallRun(key, loanedProfile(), createDefaultSkillProfile(), undefined, 1);
  if (!run) throw new Error(`ボスの間を作れない: ${key}`);
  return run;
}

function stepUntil(state: GameState, done: (s: GameState) => boolean, limit: number): void {
  for (let i = 0; i < limit && !done(state); i++) step(state, withInput({}), FIXED_DT);
}

function stepUntilLocked(state: GameState): void {
  stepUntil(state, (s) => s.boss?.lockedAt !== undefined, LOCK_STEPS);
}

function stepUntilDead(state: GameState): void {
  state.player.hp = 1;
  stepUntil(state, runOver, DEATH_STEPS);
}

/** 挑戦の形で done まで（または上限まで）回す */
function stepRunUntil(run: HallRun, done: (r: HallRun) => boolean, limit: number): void {
  for (let i = 0; i < limit && !done(run); i++) stepHall(run, withInput({}), FIXED_DT);
}

afterEach(() => {
  setSaveStorage(null);
});

describe("ボスの間の候補と深度", () => {
  it("ボスの間の候補は章ボス 4 と ARC.finalBoss", () => {
    expect(hallBossKeys(), "章の順 → 最深の主").toEqual([...ARC.chapters.map((c) => c.boss), ARC.finalBoss]);
  });

  it("hallDepthOf は章ボスの階と最深の間、他は null", () => {
    ARC.chapters.forEach((c, i) => expect(hallDepthOf(c.boss), c.boss).toBe((i + 1) * ARC.floorsPerChapter));
    expect(hallDepthOf(ARC.finalBoss), "最深の主").toBe(ARC.floorsPerChapter * ARC.maxChapter + 1);
    expect(hallDepthOf("slime"), "雑魚").toBeNull();
    expect(hallDepthOf("unknown"), "未知").toBeNull();
  });

  it("候補でない key では作らない", () => {
    expect(createHallGame("slime", createEmptyProfile(), createDefaultSkillProfile(), undefined, 1), "雑魚").toBeNull();
  });
});

describe("ボスの間の階", () => {
  it("createHallGame はその深度のボス階を作り、ボスは選んだ key", () => {
    for (const key of hallBossKeys()) {
      const state = hallGame(key);
      expect(state.depth, `${key} の深度`).toBe(hallDepthOf(key));
      expect(state.boss?.major, `${key} は階層ボス`).toBe(true);
      expect(bossEnemy(state)?.defKey, `${key} のボス`).toBe(key);
      expect(state.seedText, `${key} の seed`).toBe(hallSeedText(key));
    }
  });

  it("プレイヤーはボス部屋の中の扉寄りに立ち、数 step で封鎖され lockedAt が入る", () => {
    for (const key of hallBossKeys()) {
      const state = hallGame(key);
      const room = state.rooms[state.boss?.roomIndex ?? -1];
      const p = state.player.body.pos;
      expect(room && rectContainsPx(room.rect, p.x, p.y), `${key}: 部屋の中`).toBe(true);
      const boss = bossEnemy(state);
      const toBoss = boss ? Math.hypot(boss.body.pos.x - p.x, boss.body.pos.y - p.y) : 0;
      expect(toBoss, `${key}: ボスと重ならない`).toBeGreaterThan(TILE_SIZE);
      stepUntilLocked(state);
      expect(state.boss?.lockedAt, `${key}: 封鎖された`).toBeDefined();
      expect(room?.locked, `${key}: 部屋が閉じた`).toBe(true);
    }
  });

  it("同じ key なら同じ部屋・同じ立ち位置", () => {
    const a = hallGame(FIRST_BOSS);
    const b = hallGame(FIRST_BOSS);
    expect(b.boss?.roomIndex, "ボス部屋").toBe(a.boss?.roomIndex);
    expect(b.player.body.pos, "立ち位置").toEqual(a.player.body.pos);
    expect(bossEnemy(b)?.body.pos, "ボスの位置").toEqual(bossEnemy(a)?.body.pos);
  });

  it("装備は今の装備（借り物を含む）の写しで、元の profile と skillProfile を書き換えない", () => {
    const profile = loanedProfile();
    const skillProfile = createDefaultSkillProfile();
    const before = JSON.stringify([profile, skillProfile]);
    const state = createHallGame(FIRST_BOSS, profile, skillProfile, "swordsman", 1);
    expect(state, "作れる").not.toBeNull();
    if (!state) return;
    expect(state.profile, "一時プロフィール").not.toBe(profile);
    expect(state.profile.equipment.mainHand, "借り物の写し").toEqual(profile.equipment.mainHand);
    stepUntilDead(state);
    expect(JSON.stringify([profile, skillProfile]), "元は変わらない").toBe(before);
  });
});

describe("ボスの間の結果", () => {
  it("封鎖前は done でも locked でもない", () => {
    const outcome = hallOutcome(hallRun(FIRST_BOSS));
    expect(outcome.done, "done").toBe(false);
    expect(outcome.locked, "locked").toBe(false);
    expect(outcome.seconds, "秒").toBe(0);
  });

  it("撃破で done・won、被弾とダウンは bossLog の最後と一致し、秒は封鎖から数える", () => {
    const run = hallRun(FIRST_BOSS);
    stepRunUntil(run, (r) => r.lockedTime !== null, LOCK_STEPS);
    const lockedTime = run.lockedTime ?? 0;
    stepRunUntil(run, () => false, 60);
    slayFloorLord(run.state);
    const outcome = hallOutcome(run);
    const state = run.state;
    const record = state.bossLog[state.bossLog.length - 1];
    expect(outcome.done, "done").toBe(true);
    expect(outcome.won, "won").toBe(true);
    expect(record, "撃破の記録").toBeDefined();
    expect(outcome.seconds, "封鎖から数える").toBeCloseTo(state.time - lockedTime, 6);
    expect(outcome.seconds, "戦った分だけ進む").toBeGreaterThan(0.5);
    expect(outcome.hits, "被弾").toBe(record?.hits);
    expect(outcome.downs, "ダウン").toBe(record?.downs);
  });

  it("倒れると done で won でなく、秒は封鎖から数える", () => {
    const run = hallRun(FIRST_BOSS);
    run.state.player.hp = 1;
    stepRunUntil(run, (r) => runOver(r.state), DEATH_STEPS);
    expect(runOver(run.state), "力尽きた").toBe(true);
    const outcome = hallOutcome(run);
    expect(outcome.done, "done").toBe(true);
    expect(outcome.won, "won").toBe(false);
    expect(outcome.locked, "locked").toBe(true);
    expect(outcome.seconds, "秒").toBeGreaterThan(0);
    expect(outcome.hits, "被弾").toBeGreaterThan(0);
  });
});

describe("ボスの間の保存", () => {
  it("保存の抑止の中では、挑戦から力尽きるまで永続データを 1 つも書かない", () => {
    const storage = new MemoryStorage();
    setSaveStorage(storage);
    const release = guardStorageWrites();
    try {
      const state = hallGame(FIRST_BOSS);
      stepUntilLocked(state);
      stepUntilDead(state);
      expect(state.runRecorded, "ラン記録の保存を試みた（抑止で捨てられる）").toBe(true);
    } finally {
      release();
    }
    expect(storage.length, "何も書かれていない").toBe(0);
  });
});
