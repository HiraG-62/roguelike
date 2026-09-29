import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type GameState, ROAMING_ROOM } from "../core/state";
import { dist } from "../core/vec";
import { depthHpScale, enemyDef } from "../data/enemies";
import { ROLE_ELITE_EXCLUDE, roleOf } from "../data/enemyRoles";
import type { FormationSlot } from "../data/formations";
import { ELITE, JIN } from "../data/tuning";
import { TILE_SIZE, rectCenterPx, toIndex } from "../map/grid";
import { createEnemy } from "./enemies";
import { buildFloor, updateRooms, withBaseAreaMul } from "./floor";
import { gradeAtDepth, jinBudget, makeStrong, slotCount, updateJinPhases } from "./jinSpawn";
import { roomLocks } from "./roomTypes";

/** 陣の配り（system/jinSpawn.ts。docs/ideas/jin-impl.md 2-2・2-5・2-9） */

const SEEDS = 8;
const START_ROOM = 0;

function floorAt(depth: number, seed: number): GameState {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  return state;
}

function membersOf(state: GameState, jinId: number): GameState["enemies"] {
  return state.enemies.filter((e) => e.jinId === jinId);
}

/** 部屋に乗った陣（長蛇を除く） */
function roomJins(state: GameState): GameState["jins"] {
  return state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM);
}

describe("スロットの人数と格", () => {
  it("人数は 予算 × share / 格の重さ を四捨五入して min〜max に収める", () => {
    const slot: FormationSlot = { role: "vanguard", grade: "strong", share: 0.5, min: 1, max: 3 };
    expect(slotCount(slot, 8), "8 × 0.5 / 2 = 2").toBe(Math.round((8 * 0.5) / JIN.gradeWeight.strong));
    expect(slotCount(slot, 1), "min まで上げる").toBe(1);
    expect(slotCount(slot, 100), "max で止める").toBe(3);
    expect(slotCount({ ...slot, grade: "normal", max: undefined }, 100), "max 省略は上限なし").toBe(Math.round((100 * 0.5) / JIN.gradeWeight.normal));
  });

  it("深度が解禁に足りない格は並に落とす", () => {
    expect(gradeAtDepth("strong", JIN.strongMinDepth - 1)).toBe("normal");
    expect(gradeAtDepth("strong", JIN.strongMinDepth)).toBe("strong");
    expect(gradeAtDepth("elite", ELITE.minDepth - 1)).toBe("normal");
    expect(gradeAtDepth("elite", ELITE.minDepth)).toBe("elite");
    expect(gradeAtDepth("normal", 99)).toBe("normal");
  });

  it("猛（強）は生命と怯み耐性が上がり、格が付く", () => {
    const state = withBaseAreaMul(() => createGame(1));
    const def = enemyDef("slime");
    const e = createEnemy(state, def, { x: 0, y: 0 }, 0, false);
    const poise = e.poise.max;
    makeStrong(e);
    expect(e.grade).toBe("strong");
    expect(e.maxHp).toBe(Math.round(Math.round(def.hp * depthHpScale(state.depth)) * JIN.strong.hpMul));
    expect(e.hp, "生成直後は満タン").toBe(e.maxHp);
    expect(e.poise.max).toBeCloseTo(poise * JIN.strong.poiseMul, 5);
  });

  it("予算は平均 × (1 ± budgetSpread) × 塊の並びの密度 に収まる", () => {
    const state = withBaseAreaMul(() => createGame(3));
    const mean = JIN.budgetBase + state.depth * JIN.budgetPerDepth;
    const lo = Math.floor(mean * (1 - JIN.budgetSpread) * Math.min(JIN.densityNearStart, JIN.densityNearEnd));
    const hi = Math.ceil(mean * (1 + JIN.budgetSpread) * Math.max(JIN.densityNearStart, JIN.densityNearEnd));
    for (let i = 0; i < 50; i++) {
      const b = jinBudget(state, i % state.rooms.length);
      expect(b).toBeGreaterThanOrEqual(Math.max(1, lo));
      expect(b).toBeLessThanOrEqual(hi);
    }
  });
});

describe("陣の配り（planJins）", () => {
  it("陣は開始・ボス以外の封鎖しない通常の塊に 1 つまで乗り、メンバーはその塊の上に立つ", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      const bossRoom = state.boss?.roomIndex;
      const used = new Set<number>();
      for (const jin of roomJins(state)) {
        const room = state.rooms[jin.roomIndex];
        expect(room?.kind, `seed=${seed} 通常の塊`).toBe("normal");
        expect(roomLocks(state, jin.roomIndex), `seed=${seed} 封鎖しない`).toBe(false);
        expect(jin.roomIndex, "開始の塊ではない").not.toBe(START_ROOM);
        expect(jin.roomIndex, "ボスの塊ではない").not.toBe(bossRoom);
        expect(used.has(jin.roomIndex), `seed=${seed} 1 塊 1 陣`).toBe(false);
        used.add(jin.roomIndex);
        const members = membersOf(state, jin.id);
        expect(members.length, "空の陣は作らない").toBeGreaterThan(0);
        for (const e of members) {
          expect(e.roomIndex, "メンバーの roomIndex は陣の塊").toBe(jin.roomIndex);
          const tile = toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE));
          if (room?.tiles) expect(room.tiles.has(tile), `seed=${seed} 塊の上に立つ`).toBe(true);
        }
      }
    }
  });

  it("陣の中心どうし（と開始の塊）は minSpacing 以上離れる", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      const centers = [rectCenterPx(state.rooms[START_ROOM]!.rect), ...roomJins(state).map((j) => j.center)];
      for (let a = 0; a < centers.length; a++) {
        for (let b = a + 1; b < centers.length; b++) {
          expect(dist(centers[a]!, centers[b]!), `seed=${seed}`).toBeGreaterThanOrEqual(JIN.minSpacing);
        }
      }
      expect(roomJins(state).length, `seed=${seed} 上限`).toBeLessThanOrEqual(JIN.maxJins);
    }
  });

  it("通常の塊の敵はすべて陣に属する（ボスの塊を除く）", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      for (const e of state.enemies) {
        const room = state.rooms[e.roomIndex];
        if (!room || room.kind !== "normal" || e.roomIndex === state.boss?.roomIndex) continue;
        expect(e.jinId, `seed=${seed} ${e.defKey}`).toBeDefined();
      }
    }
  });

  it("1 つの陣の中では、同じ役割は同じ種類で揃う", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(4, seed);
      for (const jin of state.jins) {
        const byRole = new Map<string, Set<string>>();
        for (const e of membersOf(state, jin.id)) {
          const role = roleOf(enemyDef(e.defKey));
          const set = byRole.get(role) ?? new Set<string>();
          set.add(e.defKey);
          byRole.set(role, set);
        }
        for (const [role, keys] of byRole) expect(keys.size, `seed=${seed} ${jin.formation} ${role}`).toBe(1);
      }
    }
  });

  it("深度 1 の陣には猛・精鋭がいない。深い階には猛と精鋭が出て、精鋭は役割に合わない修飾子を持たない", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = createGame(seed);
      const graded = state.enemies.filter((e) => e.jinId !== undefined && (e.grade === "strong" || e.elite !== undefined));
      expect(graded, `seed=${seed} 深度 1`).toHaveLength(0);
    }
    let strong = 0;
    let elite = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = floorAt(6, seed);
      for (const e of state.enemies) {
        if (e.jinId === undefined) continue;
        if (e.grade === "strong") strong++;
        if (!e.elite) continue;
        elite++;
        const role = roleOf(enemyDef(e.defKey));
        expect(ROLE_ELITE_EXCLUDE[role], `${e.defKey} の ${e.elite}`).not.toContain(e.elite);
      }
    }
    expect(strong, "猛が出る").toBeGreaterThan(0);
    expect(elite, "精鋭が出る").toBeGreaterThan(0);
  });

  it("同じ seed なら同じ陣（塊・陣形・メンバーの種類と位置）", () => {
    const snap = (state: GameState): unknown =>
      state.jins.map((j) => ({
        room: j.roomIndex,
        formation: j.formation,
        members: membersOf(state, j.id).map((e) => [e.defKey, e.body.pos.x, e.body.pos.y, e.grade ?? "", e.elite ?? ""]),
      }));
    expect(snap(createGame(12))).toEqual(snap(createGame(12)));
  });
});

describe("陣の起床と決着（3a）", () => {
  it("陣の塊に入ると陣が交戦になり、メンバーが全員起きる", () => {
    const state = createGame(4);
    const jin = roomJins(state)[0];
    if (!jin) throw new Error("陣が無い");
    const room = state.rooms[jin.roomIndex]!;
    state.player.body.pos = rectCenterPx(room.rect);
    state.player.invulnTimer = 999;
    updateRooms(state, FIXED_DT);
    expect(jin.phase).toBe("engaged");
    expect(membersOf(state, jin.id).filter((e) => e.phase === "idle"), "全員起きる").toHaveLength(0);
  });

  it("長蛇の 1 人が気付くと列ごと起き、全員倒すと全滅で決着する", () => {
    const state = createGame(2);
    const column = state.jins.find((j) => j.formation === "column");
    if (!column) throw new Error("長蛇が無い");
    const members = membersOf(state, column.id);
    members[0]!.phase = "chase";
    updateJinPhases(state);
    expect(column.phase).toBe("engaged");
    expect(members.filter((e) => e.phase === "idle"), "列ごと起きる").toHaveLength(0);
    for (const e of members) e.hp = 0;
    updateJinPhases(state);
    expect(column.phase).toBe("settled");
    expect(column.settledBy).toBe("wipe");
  });
});
