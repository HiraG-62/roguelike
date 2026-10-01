import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { TILE_SIZE, toIndex } from "../map/grid";
import { updateRooms } from "./floor";
import { columnCount } from "./jinSpawn";
import { ROAMING_ROOM, corridorTileList, updateRoamers } from "./spawner";

/**
 * 長蛇（通路を歩く陣。system/jinSpawn.ts が置き、spawner.ts が歩かせる）:
 * 本数・通路の上に立つ・部屋の制圧との独立・列で同じ目的地へ歩く・決定性（docs/ideas/jin-impl.md 2-5 の 6）
 */

function tileOf(state: GameState, e: Enemy): number {
  return toIndex(state.map, Math.floor(e.body.pos.x / TILE_SIZE), Math.floor(e.body.pos.y / TILE_SIZE));
}

/** 長蛇の陣とそのメンバー */
function columns(state: GameState): { id: number; members: Enemy[] }[] {
  return state.jins
    .filter((j) => j.formation === "column")
    .map((j) => ({ id: j.id, members: state.enemies.filter((e) => e.jinId === j.id) }));
}

describe("長蛇（通路を歩く陣）", () => {
  it("本数は columnCount 以下で、メンバーは通路（どの部屋の内側でもない床）に立ち、どの部屋にも属さない", () => {
    let sawColumn = false;
    for (let seed = 0; seed < 10; seed++) {
      const state = createGame(seed);
      const corridor = new Set(corridorTileList(state));
      const cols = columns(state);
      expect(cols.length, `seed=${seed} 本数`).toBeLessThanOrEqual(columnCount(state.depth));
      for (const col of cols) {
        expect(col.members.length, `seed=${seed} 空の長蛇は作らない`).toBeGreaterThan(0);
        for (const e of col.members) {
          expect(corridor.has(tileOf(state, e)), `seed=${seed} 通路の上`).toBe(true);
          expect(e.roomIndex, "どの部屋にも属さない").toBe(ROAMING_ROOM);
        }
      }
      if (cols.length > 0) sawColumn = true;
    }
    expect(sawColumn, "いずれかの seed で長蛇が立つ").toBe(true);
  });

  it("1 本の長蛇は同じ種類で揃い、全員が同じ目的地を持つ", () => {
    const state = createGame(2);
    const cols = columns(state);
    expect(cols.length, "長蛇がある").toBeGreaterThan(0);
    for (const col of cols) {
      const keys = new Set(col.members.map((e) => e.defKey));
      expect(keys.size, "同じ種類").toBe(1);
      const goals = new Set(col.members.map((e) => JSON.stringify(e.ai?.roam)));
      expect(goals.size, "同じ目的地").toBe(1);
    }
  });

  it("後ろのメンバーが目的地に着くと、先頭の目的地を写す（乱数を引かない）", () => {
    const state = createGame(2);
    const col = columns(state).find((c) => c.members.length >= 2);
    if (!col) throw new Error("2 人以上の長蛇が無い");
    const [head, tail] = [...col.members].sort((a, b) => a.id - b.id);
    if (!head?.ai || !tail?.ai) throw new Error("メンバーが無い");
    const headGoal = { x: head.ai.roam!.x + 1, y: head.ai.roam!.y };
    head.ai.roam = headGoal;
    // 後ろの目的地を今いる位置にして「着いた」状態にする
    tail.ai.roam = { ...tail.body.pos };
    state.player.body.pos = { ...tail.body.pos, x: tail.body.pos.x + 1 };
    updateRoamers(state, FIXED_DT);
    expect(tail.ai.roam, "先頭の目的地を写す").toEqual(headGoal);
  });

  it("長蛇はどの部屋にも属さないので、生きていても部屋の制圧を妨げない", () => {
    const state = createGame(2);
    const roamers = state.enemies.filter((e) => e.roomIndex === ROAMING_ROOM);
    expect(roamers.length, "長蛇がいる").toBeGreaterThan(0);
    const index = state.rooms.findIndex((r, i) => i > 0 && r.kind === "normal" && state.enemies.some((e) => e.roomIndex === i));
    const room = state.rooms[index];
    if (!room) throw new Error("敵のいる通常の部屋が無い");
    room.engaged = true;
    for (const e of state.enemies) if (e.roomIndex === index) e.hp = 0;
    updateRooms(state, FIXED_DT);
    expect(roamers.some((e) => e.hp > 0), "長蛇は生きたまま").toBe(true);
    expect(room.cleared, "部屋は制圧扱いになる").toBe(true);
  });

  it("同じ seed なら長蛇の数・位置・種類が同じ（決定的）", () => {
    const snap = (state: GameState): unknown =>
      columns(state).map((c) => c.members.map((e) => ({ defKey: e.defKey, x: e.body.pos.x, y: e.body.pos.y })));
    expect(snap(createGame(6))).toEqual(snap(createGame(6)));
  });
});

describe("長蛇の本数（columnCount）", () => {
  it("深度で増え、上限で止まる", () => {
    expect(columnCount(1)).toBeLessThanOrEqual(columnCount(6));
    expect(columnCount(99)).toBe(columnCount(200));
  });
});
