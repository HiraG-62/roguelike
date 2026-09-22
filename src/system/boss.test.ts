import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import { BOSS, REAPER } from "../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import { Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, isBossDepth } from "./boss";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { buildFloor, updateRooms } from "./floor";
import { reaperAppearAfter, updateReaper } from "./reaper";
import type { GameState } from "../core/state";

function bossFloor(depth: number, seed = 21): GameState {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  return state;
}

function stairsTile(state: GameState): number {
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!room) throw new Error("no boss room");
  const c = rectCenter(room.rect);
  return getTile(state.map, c.x, c.y);
}

describe("ボス階", () => {
  it("depth 3, 6, 9 がボス階で、King Slime → Bone Lord の順", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(isBossDepth)).toEqual([false, false, true, false, false, true, true]);
    expect(bossKeyForDepth(3)).toBe("kingSlime");
    expect(bossKeyForDepth(6)).toBe("boneLord");
    expect(bossKeyForDepth(9)).toBe("kingSlime");
  });

  it("generator の lastRoomMin で最後の部屋が大きくなる", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateRoomsAndCorridors(createRng(seed), {
        ...DEFAULT_GENERATOR_OPTIONS,
        lastRoomMin: { w: BOSS.roomMinW, h: BOSS.roomMinH },
      });
      const last = map.rooms[map.rooms.length - 1];
      expect(last?.w).toBeGreaterThanOrEqual(BOSS.roomMinW);
      expect(last?.h).toBeGreaterThanOrEqual(BOSS.roomMinH);
      expect(map.rooms.length).toBeGreaterThan(1);
    }
  });

  it("ボス部屋には階段がなく、ボスを倒すと階段とレアドロップ 2 個が出る", () => {
    const state = bossFloor(3);
    expect(state.boss).not.toBeNull();
    expect(stairsTile(state)).toBe(Tile.Floor);
    const boss = bossEnemy(state);
    expect(boss?.defKey).toBe("kingSlime");
    if (!boss) return;
    const items = state.floorItems.length;
    damageEnemy(state, boss, boss.hp, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(stairsTile(state)).toBe(Tile.StairsDown);
    expect(state.boss?.defeated).toBe(true);
    const drops = state.floorItems.slice(items);
    expect(drops.filter((fi) => fi.item.rarity === "rare" || fi.item.rarity === "unique").length).toBeGreaterThanOrEqual(
      BOSS.rareDrops,
    );
    expect(state.slowmo).toBeGreaterThan(0);
  });

  it("ボス部屋に入るとロックされ BOSS 表示が出て、増援は湧かない", () => {
    const state = bossFloor(3);
    const b = state.boss;
    const room = state.rooms[b?.roomIndex ?? -1];
    if (!b || !room) throw new Error("no boss");
    const count = state.enemies.length;
    const c = rectCenter(room.rect);
    state.player.body.pos = { x: (c.x - 3) * 16, y: c.y * 16 };
    updateRooms(state, FIXED_DT);
    expect(room.locked).toBe(true);
    expect(b.introTimer).toBeGreaterThan(0);
    expect(state.enemies.length).toBe(count);
  });

  it("King Slime は HP 50% 以下で小スライム 4 体に分裂し高速化する", () => {
    const state = bossFloor(3);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("no boss");
    boss.phase = "chase";
    const slimes = state.enemies.filter((e) => e.defKey === "slime" && e.roomIndex === boss.roomIndex).length;
    boss.hp = Math.floor(boss.maxHp * BOSS.kingSlime.phase2Ratio);
    updateEnemies(state, FIXED_DT);
    const after = state.enemies.filter((e) => e.defKey === "slime" && e.roomIndex === boss.roomIndex).length;
    expect(after - slimes).toBe(BOSS.kingSlime.splitCount);
    expect(boss.ai?.stage).toBe(2);
  });

  it("Bone Lord は HP 30% 以下でテレポートを繰り返す", () => {
    const state = bossFloor(6);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("no boss");
    expect(boss.defKey).toBe("boneLord");
    boss.phase = "chase";
    boss.attackCooldown = 999;
    boss.hp = Math.floor(boss.maxHp * BOSS.boneLord.teleportRatio);
    const start = { ...boss.body.pos };
    const steps = Math.ceil((BOSS.boneLord.teleportInterval * 1.5) / FIXED_DT);
    for (let i = 0; i < steps; i++) updateEnemies(state, FIXED_DT);
    expect(boss.ai?.stage).toBe(2);
    const moved = Math.hypot(boss.body.pos.x - start.x, boss.body.pos.y - start.y);
    expect(moved).toBeGreaterThan(20);
  });
});

describe("Reaper", () => {
  it("猶予秒数（部屋数ボーナス込み）で出現し、フロアを移ると消える", () => {
    const state = createGame(4);
    state.floorTime = reaperAppearAfter(state) - 0.1;
    updateReaper(state, FIXED_DT);
    expect(state.reaper).toBeNull();
    for (let i = 0; i < 10; i++) updateReaper(state, FIXED_DT);
    expect(state.reaper).not.toBeNull();
    buildFloor(state);
    expect(state.reaper).toBeNull();
    expect(state.floorTime).toBe(0);
  });

  it("触れると大ダメージ", () => {
    const state = createGame(4);
    state.floorTime = reaperAppearAfter(state);
    updateReaper(state, FIXED_DT);
    const r = state.reaper;
    if (!r) throw new Error("no reaper");
    r.pos = { ...state.player.body.pos };
    const hp = state.player.hp;
    updateReaper(state, FIXED_DT);
    expect(hp - state.player.hp).toBeGreaterThanOrEqual(REAPER.damage * 0.5);
  });
});
