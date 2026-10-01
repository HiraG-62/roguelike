import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState, RoomState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ARC } from "../data/tuning";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import { createEmptyProfile } from "../loot/types";
import { TILE_SIZE, Tile, rectCenter, rectCenterPx, toIndex } from "../map/grid";
import { createDefaultSkillProfile } from "../skills/persistence";
import { bossEnemy, bossKeyForDepth, isBossDepth } from "./boss";
import { createHallGame, hallBossKeys } from "./bossHall";
import { isChapterBossDepth } from "./chapters";
import { damageEnemy } from "./combat";
import { buildFloor, updateRooms } from "./floor";
import { merchantKindFor } from "./merchants";
import type { RoomProp } from "./specialRooms";
import { slayFloorLord, withInput } from "./testHelpers";

/**
 * ボス階を専用の部屋（階の型 "lordHall"）で作る結線（docs/ideas/lordhall-design.md 6 章の L8b）。
 * 部屋の形そのものは map/layout/lordHall.test.ts が見る。ここは buildFloor と主の間の契約を見る
 */

const SEED = 21;
const BOSS_DEPTHS = [5, 10, 15, 20, 21, 25, 30] as const;
const FINAL_DEPTH = ARC.floorsPerChapter * ARC.maxChapter + 1;
const ENTRY_ROOM = 0;
const ANTE_ROOM = 1;
const HALL_ROOM = 2;
/** 封鎖前の狙撃で主の様子を見る step 数（3 秒） */
const SNIPE_STEPS = 180;
/** 封鎖前の狙撃のダメージ（主が倒れない程度） */
const SNIPE_DAMAGE = 1;
/** 入ったとみなされる深さ（扉から東へのタイル数。部屋の判定は体の縁で見る） */
const ENTER_DEPTH = 3;
/** 主の座が移る回数の上限（双子の騎士で 2） */
const MAX_LORDS = 4;

function bossFloor(depth: number, seed = SEED, prepare?: (state: GameState) => void): GameState {
  const state = createGame(seed);
  state.depth = depth;
  prepare?.(state);
  buildFloor(state);
  return state;
}

function hallOf(state: GameState): RoomState {
  const room = state.rooms[HALL_ROOM];
  if (!room?.tiles) throw new Error("主の間が無い");
  return room;
}

function tileOfPx(state: GameState, x: number, y: number): number {
  return toIndex(state.map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}

function inRoomTiles(state: GameState, room: RoomState, x: number, y: number): boolean {
  return room.tiles?.has(tileOfPx(state, x, y)) === true;
}

function isContainer(defKey: string): boolean {
  return enemyDef(defKey).container !== undefined;
}

/** どの部屋にも属さない床（参道・門の通路・桟道） */
function ownedByAnyRoom(state: GameState, tile: number): boolean {
  return state.rooms.some((r) => r.tiles?.has(tile) === true);
}

/** 門の通路のタイルか: 部屋に属さない床で、前室の右端より右・主の間の床より左 */
function isGateTile(state: GameState, tile: number): boolean {
  const ante = state.rooms[ANTE_ROOM];
  if (!ante || ownedByAnyRoom(state, tile) || state.map.tiles[tile] !== Tile.Floor) return false;
  const x = tile % state.map.width;
  return x >= ante.rect.x + ante.rect.w && x < hallOf(state).rect.x;
}

/** 主の間の口の内側（扉から ENTER_DEPTH マス入った所）。扉のタイルの小さい順で最初に見つかったもの */
function insideGatePx(state: GameState): { x: number; y: number } {
  const hall = hallOf(state);
  for (const door of [...hall.doorTiles].sort((a, b) => a - b)) {
    const x = (door % state.map.width) + ENTER_DEPTH;
    const y = Math.floor(door / state.map.width);
    if (hall.tiles?.has(toIndex(state.map, x, y))) return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
  }
  throw new Error("主の間の口が無い");
}

/** 主を倒しきる（双子の騎士は片方が倒れると相方へ主の座が移るので、倒れきるまで繰り返す） */
function defeatBoss(state: GameState): void {
  for (let i = 0; i < MAX_LORDS && state.boss?.defeated !== true; i++) slayFloorLord(state);
  updateRooms(state, FIXED_DT);
}

function surfaceProp(state: GameState): RoomProp | undefined {
  for (const room of state.rooms) {
    const prop = room.special?.props.find((p) => p.kind === "surface");
    if (prop) return prop;
  }
  return undefined;
}

describe.each(BOSS_DEPTHS)("ボス階（深度 %i）を専用の部屋で作る", (depth) => {
  it("ボス階で、階の型は lordHall・部屋は入口 → 前室 → 主の間の 3 つ", () => {
    expect(isBossDepth(depth)).toBe(true);
    const state = bossFloor(depth);
    expect(state.map.layout).toBe("lordHall");
    expect(state.floorLayout).toBe("lordHall");
    expect(state.rooms).toHaveLength(3);
    expect(state.boss?.roomIndex, "主の間は最後の部屋").toBe(HALL_ROOM);
    const entry = state.rooms[ENTRY_ROOM];
    const p = state.player.body.pos;
    expect(entry && inRoomTiles(state, entry, p.x, p.y), "降りてきた所は入口の間").toBe(true);
  });

  it("主は主の間の中央に立ち、key は深度のボス", () => {
    const state = bossFloor(depth);
    const boss = bossEnemy(state);
    expect(boss?.defKey).toBe(bossKeyForDepth(depth));
    expect(boss?.body.pos).toEqual(rectCenterPx(hallOf(state).rect));
  });

  it("陣を置かず、主の間の外には商人と壺・木箱のほかに敵がいない", () => {
    const state = bossFloor(depth);
    expect(state.jins, "陣・長蛇・物見なし").toEqual([]);
    const hall = hallOf(state);
    const merchantIds = new Set(state.economy.merchants.map((m) => m.enemyId));
    const outside = state.enemies.filter(
      (e) => !inRoomTiles(state, hall, e.body.pos.x, e.body.pos.y) && !merchantIds.has(e.id) && !isContainer(e.defKey),
    );
    expect(outside.map((e) => e.defKey)).toEqual([]);
  });

  it("主の間に壺・木箱を置かない", () => {
    const state = bossFloor(depth);
    const hall = hallOf(state);
    const inHall = state.enemies.filter((e) => isContainer(e.defKey) && inRoomTiles(state, hall, e.body.pos.x, e.body.pos.y));
    expect(inHall).toHaveLength(0);
  });

  it("前室に市の商人が立つ（章ボス階は章の市）", () => {
    const state = bossFloor(depth);
    const ante = state.rooms[ANTE_ROOM];
    if (!ante) throw new Error("前室が無い");
    const markets = state.economy.merchants.filter((m) => m.kind === "market" || m.kind === "chapterMarket");
    expect(markets).toHaveLength(1);
    const merchant = markets[0];
    expect(merchant?.kind).toBe(merchantKindFor(depth));
    if (isChapterBossDepth(depth)) expect(merchant?.kind).toBe("chapterMarket");
    expect(merchant && inRoomTiles(state, ante, merchant.pos.x, merchant.pos.y), "商人は前室").toBe(true);
    for (const ware of merchant?.wares ?? []) {
      expect(inRoomTiles(state, ante, ware.pos.x, ware.pos.y), "台座も前室").toBe(true);
    }
    expect(ante.cleared, "敵のいない前室は制圧済み").toBe(true);
  });

  it("主の間に入ると封鎖し、塞ぐのは門の通路のタイルだけ", () => {
    const state = bossFloor(depth);
    state.player.body.pos = insideGatePx(state);
    updateRooms(state, FIXED_DT);
    expect(hallOf(state).locked, "封鎖").toBe(true);
    expect(state.lockedTiles.size).toBeGreaterThan(0);
    for (const t of state.lockedTiles) expect(isGateTile(state, t), `塞いだタイル ${t} は門の通路`).toBe(true);
  });

  it("撃破すると中央に階段、分岐の階段も主の間の床に乗る", () => {
    const state = bossFloor(depth);
    const hall = hallOf(state);
    state.player.body.pos = insideGatePx(state);
    updateRooms(state, FIXED_DT);
    defeatBoss(state);
    const c = rectCenter(hall.rect);
    const center = toIndex(state.map, c.x, c.y);
    expect(state.boss?.defeated, "倒しきった").toBe(true);
    expect(state.map.tiles[center], "中央に階段").toBe(Tile.StairsDown);
    expect(state.stairs.length).toBeGreaterThanOrEqual(1);
    for (const s of state.stairs) {
      expect(s.tile, "行き先の階段は置かれている").toBeGreaterThanOrEqual(0);
      expect(state.map.tiles[s.tile]).toBe(Tile.StairsDown);
      expect(hall.tiles?.has(s.tile), `階段 ${s.tile} は主の間の床`).toBe(true);
    }
  });

  it("同じ seed なら同じ階（地図・敵・商人・乱数の続き）", () => {
    const a = bossFloor(depth);
    const b = bossFloor(depth);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(a.enemies.map((e) => [e.defKey, e.body.pos.x, e.body.pos.y])).toEqual(b.enemies.map((e) => [e.defKey, e.body.pos.x, e.body.pos.y]));
    expect(a.economy.merchants.map((m) => m.wares.map((w) => [w.kind, w.price]))).toEqual(
      b.economy.merchants.map((m) => m.wares.map((w) => [w.kind, w.price])),
    );
    expect(a.rng.next()).toBe(b.rng.next());
  });
});

describe("最深の間（深度 21）の専用の部屋", () => {
  it("最深の主を倒すと、地上への道が主の間の床に乗る", () => {
    const state = bossFloor(FINAL_DEPTH);
    state.player.body.pos = insideGatePx(state);
    updateRooms(state, FIXED_DT);
    defeatBoss(state);
    const prop = surfaceProp(state);
    expect(prop, "地上への道").toBeDefined();
    if (!prop) return;
    const tile = tileOfPx(state, prop.pos.x, prop.pos.y);
    expect(state.map.tiles[tile]).toBe(Tile.Floor);
    expect(hallOf(state).tiles?.has(tile), "主の間の床").toBe(true);
  });
});

describe("前室の台座の置き場", () => {
  it("位階の見返り「市」で品が増えても、章の市は前室に台座を並べられる", () => {
    for (const chapter of ARC.chapters.keys()) {
      const depth = (chapter + 1) * ARC.floorsPerChapter;
      const state = bossFloor(depth, SEED, (s) => {
        s.runMeta.perks = [...s.runMeta.perks, "market"];
      });
      const ante = state.rooms[ANTE_ROOM];
      const merchant = state.economy.merchants.find((m) => m.kind === "chapterMarket");
      if (!ante || !merchant) throw new Error(`深度 ${depth} に章の市が立たない`);
      expect(merchant.kind).toBe("chapterMarket");
      for (const ware of merchant.wares) expect(inRoomTiles(state, ante, ware.pos.x, ware.pos.y), `深度 ${depth} の台座は前室`).toBe(true);
    }
  });
});

describe("封鎖前の狙撃（門の通路から寝ている主を撃つ）", () => {
  // 設計 9 章の確かめ: 封鎖は主の間に入ったときだけ。外から撃っても封鎖されず、主も寄ってこない（記録は報告へ）
  it("門の通路から主を撃っても、主の間に入るまでは封鎖しない", () => {
    const state = bossFloor(BOSS_DEPTHS[0]);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("主がいない");
    const hall = hallOf(state);
    const gate = [...hall.doorTiles].sort((a, b) => a - b)[0] ?? -1;
    const gx = (gate % state.map.width) - 1;
    const gy = Math.floor(gate / state.map.width);
    const spot = { x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
    expect(isGateTile(state, toIndex(state.map, gx, gy)), "プレイヤーは門の通路").toBe(true);
    damageEnemy(state, boss, SNIPE_DAMAGE, { x: 1, y: 0 }, 0);
    for (let i = 0; i < SNIPE_STEPS; i++) {
      state.player.invulnTimer = SNIPE_STEPS;
      state.player.body.pos = { ...spot };
      step(state, withInput({}), FIXED_DT);
    }
    expect(hall.locked, "主の間の外にいるあいだは封鎖しない").toBe(false);
    expect(state.boss?.lockedAt, "封鎖の時刻も付かない").toBeUndefined();
  });
});

describe("拠点のボスの間も同じ部屋で作る", () => {
  it.each(hallBossKeys())("%s のボスの間は lordHall で、入口（主の間の内側）に立てる", (key) => {
    const profile = createEmptyProfile();
    profile.equipment.mainHand = generateItem(createRng(7), { baseKey: "dagger", plain: true, itemLevel: 1, foundDepth: 1, now: 0 });
    const state = createHallGame(key, profile, createDefaultSkillProfile(), undefined, 1);
    if (!state) throw new Error(`ボスの間を作れない: ${key}`);
    expect(state.floorLayout).toBe("lordHall");
    const hall = hallOf(state);
    const p = state.player.body.pos;
    expect(inRoomTiles(state, hall, p.x, p.y), "主の間の床に立つ").toBe(true);
    expect(state.map.tiles[tileOfPx(state, p.x, p.y)]).toBe(Tile.Floor);
  });
});
