import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Rng } from "../core/rng";
import type { Enemy, GameState } from "../core/state";
import { ROAM } from "../data/tuning";
import { farFromPlayer, isAsleep, updateEnemies } from "./enemies";
import { ROAMING_ROOM, updateRoamers } from "./spawner";
import { arena, placeEnemy } from "./testHelpers";

/**
 * 眠り（system/enemies.ts の isAsleep）と遠い徘徊の間引き（system/spawner.ts の updateRoamers）、
 * 升目で近い組だけを調べる押し合い（separate）の検証
 */

/** 眠りの距離より少し外 */
const FAR = ROAM.sleepDist + 40;
/** 気付く距離（enemies.ts の NOTICE_RANGE）の内側 */
const NEAR = 30;
const SAMPLE_STEPS = 30;

/** 乱数を引いた回数を数える rng に差し替える */
function countRng(state: GameState): { calls: number } {
  const counter = { calls: 0 };
  const inner = state.rng;
  const counted: Rng = {
    next: () => {
      counter.calls += 1;
      return inner.next();
    },
    int: (min, max) => {
      counter.calls += 1;
      return inner.int(min, max);
    },
    chance: (p) => {
      counter.calls += 1;
      return inner.chance(p);
    },
    pick: (arr) => {
      counter.calls += 1;
      return inner.pick(arr);
    },
  };
  state.rng = counted;
  return counter;
}

/** 敵をその場に残してプレイヤーだけ横へ dx ずらす（updateEnemies だけを回すので壁は関係しない） */
function movePlayer(state: GameState, e: Enemy, dx: number): void {
  state.player.body.pos = { x: e.body.pos.x + dx, y: e.body.pos.y };
}

describe("眠り（遠い idle の敵）", () => {
  it("眠りの距離より遠い idle の敵は AI が止まり、位置・攻撃間隔・アニメの時計が進まず、乱数を引かない", () => {
    const state = arena();
    const e = placeEnemy(state, "eye", 0);
    movePlayer(state, e, FAR);
    const pos = { ...e.body.pos };
    const cooldown = e.attackCooldown;
    const anim = e.animTime;
    const rng = countRng(state);
    for (let i = 0; i < SAMPLE_STEPS; i++) updateEnemies(state, FIXED_DT);
    expect(isAsleep(state, e), "眠っている").toBe(true);
    expect(e.body.pos, "動かない").toEqual(pos);
    expect(e.attackCooldown, "攻撃間隔が止まる").toBe(cooldown);
    expect(e.animTime, "アニメの時計が止まる").toBe(anim);
    expect(rng.calls, "乱数を引かない").toBe(0);
  });

  it("眠りの距離より近い idle の敵は起きていて時計が進む", () => {
    const state = arena();
    const e = placeEnemy(state, "eye", 0);
    movePlayer(state, e, ROAM.sleepDist - 40);
    const anim = e.animTime;
    updateEnemies(state, FIXED_DT);
    expect(isAsleep(state, e)).toBe(false);
    expect(e.animTime).toBeGreaterThan(anim);
  });

  it("プレイヤーが近づくと起きて、気付く距離で追い始める", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 0);
    movePlayer(state, e, FAR);
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "遠い間は idle のまま").toBe("idle");
    movePlayer(state, e, NEAR);
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "近づけば気付く").toBe("chase");
  });

  it("気付いた敵・吹き飛び中・封鎖中の部屋の敵・ボスは遠くても眠らない", () => {
    const state = arena();
    const chasing = placeEnemy(state, "slime", 0);
    movePlayer(state, chasing, FAR);
    chasing.phase = "chase";
    expect(isAsleep(state, chasing), "気付いた敵").toBe(false);

    const knocked = placeEnemy(state, "slime", 0);
    knocked.knock = { x: 50, y: 0 };
    expect(isAsleep(state, knocked), "吹き飛び中").toBe(false);

    const locked = placeEnemy(state, "slime", 0);
    const room = state.rooms[locked.roomIndex];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    expect(isAsleep(state, locked), "封鎖中の部屋").toBe(false);
    room.locked = false;

    const boss = placeEnemy(state, "kingSlime", 0);
    expect(isAsleep(state, boss), "ボス").toBe(false);
  });
});

describe("遠い徘徊の間引き", () => {
  const TARGET_OFFSET = 48;
  function farRoamer(): { state: GameState; e: Enemy } {
    const state = arena();
    const e = placeEnemy(state, "slime", 0);
    e.roomIndex = ROAMING_ROOM;
    if (!e.ai) throw new Error("AI が無い");
    // 目的地は開始部屋の中心あたり（敵はそこから少し離れた位置に置いた）
    e.ai.roam = { x: e.body.pos.x - TARGET_OFFSET, y: e.body.pos.y };
    e.ai.roamStuck = 0;
    movePlayer(state, e, FAR);
    return { state, e };
  }

  it("眠りの距離より遠い徘徊は sleepRoamEvery ステップに 1 回だけ歩き、その分まとめて進む", () => {
    const { state, e } = farRoamer();
    expect(farFromPlayer(state, e)).toBe(true);
    const every = Math.max(1, ROAM.sleepRoamEvery);
    let moves = 0;
    const start = { ...e.body.pos };
    for (let i = 0; i < every; i++) {
      state.tick += 1;
      const before = { ...e.body.pos };
      updateRoamers(state, FIXED_DT);
      if (e.body.pos.x !== before.x || e.body.pos.y !== before.y) moves += 1;
    }
    expect(moves, `${every} ステップで 1 回だけ動く`).toBe(1);
    expect(Math.hypot(e.body.pos.x - start.x, e.body.pos.y - start.y), "止まらず進む").toBeGreaterThan(0);
  });

  it("近い徘徊は毎ステップ歩く", () => {
    const { state, e } = farRoamer();
    movePlayer(state, e, ROAM.sleepDist - 40);
    let moves = 0;
    for (let i = 0; i < SAMPLE_STEPS; i++) {
      state.tick += 1;
      const before = { ...e.body.pos };
      updateRoamers(state, FIXED_DT);
      if (e.body.pos.x !== before.x || e.body.pos.y !== before.y) moves += 1;
    }
    expect(moves).toBe(SAMPLE_STEPS);
  });
});

describe("押し合い（升目）", () => {
  it("重なった敵は升の境をまたいでいても離れ、離れた所の重なりも同じステップで解ける", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 0);
    const b = placeEnemy(state, "slime", 3);
    const c = placeEnemy(state, "slime", 0, 40);
    const d = placeEnemy(state, "slime", 0, 43);
    // 眠らせず、動かさないために気付いた後の待機（recover の長い隙）にする
    for (const e of [a, b, c, d]) {
      e.phase = "recover";
      e.phaseTimer = 99;
    }
    const gap = (p: Enemy, q: Enemy): number => Math.hypot(p.body.pos.x - q.body.pos.x, p.body.pos.y - q.body.pos.y);
    const ab = gap(a, b);
    const cd = gap(c, d);
    updateEnemies(state, FIXED_DT);
    expect(gap(a, b), "1 組目").toBeGreaterThan(ab);
    expect(gap(c, d), "2 組目").toBeGreaterThan(cd);
  });
});
