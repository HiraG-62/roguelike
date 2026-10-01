import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { depthHpScale, enemyDef } from "../data/enemies";
import { BOSS, FLOOR_LORD, HEAL } from "../data/tuning";
import { Tile, getTile, rectCenter } from "../map/grid";
import { isBossDepth } from "./boss";
import { isChapterRest } from "./chapters";
import { createEnemy } from "./enemies";
import { ascend, buildFloor, descend, updateRooms } from "./floor";
import { bossRoomLocked, isCaptain, pickFloorLordDef, setupFloorLordRoom } from "./floorLord";
import { updateReaper } from "./reaper";
import { stairsTilesValid } from "./specialRooms";
import { arena, slayFloorLord } from "./testHelpers";

/** depth に主（ボスか階の主）が出た状態のフロアを作る */
function floorAt(depth: number, seed = 11): ReturnType<typeof createGame> {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state, "rooms");
  return state;
}

describe("階の主（毎階）", () => {
  it("自爆で消える敵・地雷・卵は主に選ばれない（主が自滅して階段が出るのを防ぐ）", () => {
    const LAST_DEPTH = 12;
    for (let depth = 1; depth <= LAST_DEPTH; depth++) {
      const state = createGame(depth);
      state.depth = depth;
      for (let i = 0; i < 50; i++) {
        const { def } = pickFloorLordDef(state);
        expect(def.explode, `${def.key} は自爆する`).toBeUndefined();
        expect(["mine", "egg"]).not.toContain(def.behavior);
      }
    }
  });

  it("毎階の最後の部屋に主が出て、5 の倍数（BOSS.interval）だけ major。章の 1 階目（休符）は主が出ない", () => {
    for (let depth = 1; depth <= BOSS.interval * 3; depth++) {
      const state = floorAt(depth);
      const last = state.rooms.length - 1;
      if (last <= 0) continue; // 部屋が 1 つしか無い階はスキップ
      if (isChapterRest(depth)) {
        expect(state.boss, `depth=${depth} 休符に主はいない`).toBeNull();
        continue;
      }
      expect(state.boss, `depth=${depth} 主がいる`).not.toBeNull();
      expect(state.boss?.roomIndex, `depth=${depth} 最後の部屋`).toBe(last);
      expect(state.boss?.major, `depth=${depth} major`).toBe(isBossDepth(depth));
      expect(state.boss?.defeated, `depth=${depth} まだ倒していない`).toBe(false);
    }
  });

  it("章の 1 階目（6 / 11 / 16）は階の主も階層ボスもおらず、最後の部屋に階段が残る", () => {
    for (const depth of [6, 11, 16]) {
      const state = floorAt(depth);
      const last = state.rooms[state.rooms.length - 1];
      if (!last) throw new Error("no last room");
      const c = rectCenter(last.rect);
      expect(state.boss, `depth=${depth}`).toBeNull();
      expect(getTile(state.map, c.x, c.y), `depth=${depth} 階段がある`).toBe(Tile.StairsDown);
    }
  });

  it("階の主（major でない）を倒すと階段と分岐の階段が出る", () => {
    const depth = BOSS.interval - 1;
    const state = floorAt(depth);
    expect(state.boss?.major, "major でない階").toBe(false);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!room) throw new Error("no room");
    const c = rectCenter(room.rect);
    expect(getTile(state.map, c.x, c.y), "撃破前は階段が無い").toBe(Tile.Floor);
    slayFloorLord(state);
    expect(state.boss?.defeated, "撃破した").toBe(true);
    expect(getTile(state.map, c.x, c.y), "撃破後は階段が出る").toBe(Tile.StairsDown);
    expect(stairsTilesValid(state), "分岐の階段も置かれている").toBe(true);
    expect(state.stairs.every((s) => s.tile >= 0), "tile: -1 が残っていない").toBe(true);
  });

  it("精鋭修飾子が必ず付き、生命・怯み耐性が底上げされる", () => {
    const state = arena(3);
    const roomIndex = state.rooms.length - 1;
    setupFloorLordRoom(state, roomIndex);
    const e = state.enemies[0];
    if (!e) throw new Error("no floor lord enemy");
    expect(e.elite, "精鋭修飾子が必ず付く").toBeDefined();
    const def = enemyDef(e.defKey);
    const baseHp = Math.round(def.hp * depthHpScale(state.depth));
    // hpMulLair(1.6) と hpMulChampion(3.0) のうち小さい方を下限にする（どちらの分岐でも成り立つ）
    expect(e.maxHp, "生命が底上げされている").toBeGreaterThan(baseHp * FLOOR_LORD.hpMulLair * 0.95);
    const basePoise = createEnemy(state, def, e.body.pos, roomIndex, false).poise.max;
    expect(e.poise.max, "怯み耐性が底上げされている").toBeGreaterThan(basePoise * FLOOR_LORD.poiseMul * 0.95);
  });

  it("浅い階（captainMaxDepth 以下）で通常敵を格上げした主は隊長: 号令のを添えた精鋭 2 つ・captainHpMul。深い階は「〜の長」", () => {
    let captains = 0;
    let chiefs = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const depth of [FLOOR_LORD.captainMaxDepth, FLOOR_LORD.captainMaxDepth + 1]) {
        const state = arena(seed);
        state.depth = depth;
        const roomIndex = state.rooms.length - 1;
        setupFloorLordRoom(state, roomIndex);
        const e = state.enemies[0];
        const name = state.boss?.name ?? "";
        if (!e) throw new Error("no floor lord enemy");
        const def = enemyDef(e.defKey);
        if (name === def.name) continue; // 部屋主（lair）は名前も修飾子も従来どおり
        if (isCaptain(depth, false)) {
          captains++;
          expect(name, "隊長の名").toBe(`${def.name}の隊長`);
          expect(e.eliteExtra, "号令のを添える").toBe("commanding");
          expect(e.elite, "主の修飾子は号令の以外").not.toBe("commanding");
          continue;
        }
        chiefs++;
        expect(name, "深い階は〜の長").toBe(`${def.name}の長`);
        expect(e.eliteExtra, "添えは無い").toBeUndefined();
      }
    }
    expect(captains, "隊長が出る").toBeGreaterThan(0);
    expect(chiefs, "〜の長が出る").toBeGreaterThan(0);
  });

  it("階の主の部屋を封鎖すると取り巻きが増える（major は単騎のまま）", () => {
    const depth = BOSS.interval - 1;
    const state = floorAt(depth);
    const roomIndex = state.boss?.roomIndex ?? -1;
    const room = state.rooms[roomIndex];
    if (!room) throw new Error("no room");
    const before = state.enemies.filter((e) => e.roomIndex === roomIndex).length;
    const c = rectCenter(room.rect);
    state.player.body.pos = { x: c.x * 16, y: c.y * 16 };
    updateRooms(state, FIXED_DT);
    expect(room.locked, "封鎖される").toBe(true);
    const after = state.enemies.filter((e) => e.roomIndex === roomIndex).length;
    expect(after, "取り巻きが増える").toBeGreaterThan(before);
  });

  it("主の部屋を封鎖している間は死神が止まる", () => {
    const depth = BOSS.interval - 1;
    const state = floorAt(depth);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!room) throw new Error("no room");
    room.locked = true;
    expect(bossRoomLocked(state)).toBe(true);
    const before = state.floorTime;
    updateReaper(state, FIXED_DT);
    expect(state.floorTime, "封鎖中は進まない").toBe(before);
    room.locked = false;
    updateReaper(state, FIXED_DT);
    expect(state.floorTime, "解除後は進む").toBeGreaterThan(before);
  });

  it("上り階段で戻っても主は残る（thinRevisitedFloor は def.boss と今の主を除く）", () => {
    const state = createGame(6);
    state.depth = BOSS.interval;
    state.runEvents.strata.deepest = state.depth;
    buildFloor(state, "rooms");
    ascend(state);
    const boss = state.boss;
    expect(boss, "戻った階にも主がいる").not.toBeNull();
    expect(
      state.enemies.some((e) => e.id === boss?.enemyId && e.hp > 0),
      "主は間引かれずに残る",
    ).toBe(true);
  });

  it("同じ seed なら同じ主が出る（決定的）", () => {
    const a = floorAt(4, 17);
    const b = floorAt(4, 17);
    expect(a.boss?.name).toBe(b.boss?.name);
    expect(a.boss?.major).toBe(b.boss?.major);
    const pickA = pickFloorLordDef(arena(17));
    const pickB = pickFloorLordDef(arena(17));
    expect(pickA.def.key).toBe(pickB.def.key);
    expect(pickA.lair).toBe(pickB.lair);
  });

  it("初めて着いた階だけ、失った生命の HEAL.descendHealRatio を回復する", () => {
    const state = createGame(3);
    // 生命 0 のまま生きている状態は、降階の stats の決め直し（生存中は最低 1）で丸められるので半分だけ減らす
    const missing = state.player.maxHp / 2;
    state.player.hp = state.player.maxHp - missing;
    const before = state.player.hp;
    descend(state);
    expect(state.player.hp, "初めての階は回復する").toBeCloseTo(before + missing * HEAL.descendHealRatio, 5);
  });

  it("降り直した階（上り階段で戻った後）では回復しない", () => {
    const state = createGame(3);
    const missing = 100;
    descend(state);
    ascend(state);
    state.player.hp = state.player.maxHp - missing;
    const before = state.player.hp;
    descend(state);
    // ステータスの再計算による ±1 程度の丸めは許容し、降階の回復（missing × descendHealRatio）が乗っていないことだけ見る
    expect(state.player.hp - before, "降り直しでは大きく回復しない").toBeLessThan(missing * HEAL.descendHealRatio * 0.5);
  });
});
