import { describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EnemyPhase, GameState } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { BOSS } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { bossEnemy } from "./boss";
import { OIL_CHARGE, OIL_FIREBOMB, OIL_JAR, OIL_SLAM } from "./bossOilKing";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { updateHazards } from "./hazards";
import { isStaggered, windupCommitted } from "./poise";
import { updateStatusEffects } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";

const HUGE_HP = 1_000_000;
const MAX_STEPS = 1200;
const OIL_KING_DEPTH = BOSS.interval * 3;
const OK = BOSS.oilKing;
const STAGE_ONE = 1;
const STAGE_FIRE = 2;
const STAGE_DRENCHED = 3;
/** 遠い間合いにいるプレイヤーの距離（farDist を十分に超える） */
const FAR_DIST = BOSS.rules.farDist + 40;
/** 近い・中間の間合いに置くときの距離 */
const NEAR_DIST = BOSS.rules.nearDist - 20;
const MID_DIST = BOSS.rules.nearDist + 30;

/** 油壺の王の階を作り、部屋を封鎖してプレイヤーを王の横に置く */
function oilFloor(seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = OIL_KING_DEPTH;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== "oilKing") throw new Error("no oil king");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  putPlayer(state, boss, 70);
  return { state, boss };
}

/** プレイヤーを王から left だけ左に置く */
function putPlayer(state: GameState, boss: Enemy, left: number): void {
  const want = { x: boss.body.pos.x - left, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
}

function tick(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

/** 代入で型が絞られた後も読み直せるよう関数にする */
function phaseOf(e: Enemy): EnemyPhase {
  return e.phase;
}

function tickUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) tick(state);
}

function stageOf(e: Enemy): number {
  return e.ai?.stage ?? 0;
}

function countTerrain(state: GameState, roomIndex: number, kind: string): number {
  const room = state.rooms[roomIndex];
  if (!room) throw new Error("no room");
  let n = 0;
  for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
    for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
      if (terrainAt(state, (x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE) === kind) n += 1;
    }
  }
  return n;
}

/** 指定の段階で、硬直の終わりに技を選ばせて選ばれた技を返す */
function pickedMove(state: GameState, boss: Enemy, stage: number): number {
  const ai = boss.ai;
  if (!ai) throw new Error("no ai");
  ai.stage = stage;
  boss.phase = "recover";
  boss.phaseTimer = FIXED_DT / 2;
  tick(state);
  return ai.move;
}

/** プレイヤーの足元に油を置く */
function oilUnderPlayer(state: GameState): void {
  const p = state.player.body.pos;
  placeTerrain(state, p.x, p.y, "oil", 8);
}

/** 王が燃える床に立って引火する */
function igniteKing(state: GameState, boss: Enemy): void {
  // 前の引火の怯みが解けてから（怯み中は王の処理が止まる）
  tickUntil(state, () => !isStaggered(boss));
  boss.phase = "chase";
  boss.attackCooldown = 999;
  if (boss.ai) boss.ai.timer = 0;
  placeTerrain(state, boss.body.pos.x, boss.body.pos.y, "fire", 8);
  tick(state);
}

describe("油壺の王: 部屋と引火", () => {
  it("ボス部屋には最初から油溜まりがある", () => {
    const { state } = oilFloor();
    tick(state);
    expect(countTerrain(state, state.boss?.roomIndex ?? -1, "oil"), "油の床").toBeGreaterThan(0);
  });

  it("燃える床に立つと引火して怯む（間隔の内は繰り返さない）", () => {
    const { state, boss } = oilFloor();
    igniteKing(state, boss);
    expect(isStaggered(boss), "怯む").toBe(true);
    expect(boss.ai?.timer).toBeCloseTo(OK.igniteCooldown, 1);
    expect(boss.ai?.progress, "引火を 1 回数える").toBe(1);
    expect(state.boss?.selfDowns, "見えるダウンとして記録に数える").toBe(1);
  });
});

describe("油壺の王: 第 2 段階（着火）", () => {
  it("HP が phase2Ratio を切ると、最初の油溜まりに火が点く", () => {
    const { state, boss } = oilFloor();
    const roomIndex = state.boss?.roomIndex ?? -1;
    boss.phase = "chase";
    boss.attackCooldown = 999;
    tick(state);
    expect(countTerrain(state, roomIndex, "fire"), "点火前は燃えていない").toBe(0);
    boss.hp = Math.floor(boss.maxHp * OK.phase2Ratio);
    tick(state);
    expect(stageOf(boss), "第 2 段階").toBe(STAGE_FIRE);
    expect(countTerrain(state, roomIndex, "fire"), "油溜まりが燃える").toBeGreaterThan(0);
  });

  it("足元が油のプレイヤーには火炎瓶、立ち止まっていても火炎瓶", () => {
    const oil = oilFloor();
    oilUnderPlayer(oil.state);
    expect(pickedMove(oil.state, oil.boss, STAGE_FIRE), "足元が油").toBe(OIL_FIREBOMB);

    const still = oilFloor();
    for (let i = 0; i < Math.ceil((BOSS.rules.stillSec + 0.1) / FIXED_DT); i++) tick(still.state);
    expect(pickedMove(still.state, still.boss, STAGE_FIRE), "静止").toBe(OIL_FIREBOMB);
  });

  it("動いている相手は、遠ければ油壺・近ければ突進", () => {
    const far = oilFloor();
    putPlayer(far.state, far.boss, FAR_DIST);
    expect(dist(far.state.player.body.pos, far.boss.body.pos), "遠い間合いに置けた").toBeGreaterThan(BOSS.rules.farDist);
    expect(pickedMove(far.state, far.boss, STAGE_FIRE), "遠い").toBe(OIL_JAR);

    const near = oilFloor();
    expect(pickedMove(near.state, near.boss, STAGE_FIRE), "近い").toBe(OIL_CHARGE);
  });

  it("引火が ignitesToDrench 回で、HP に関わらず第 3 段階（油まみれ）", () => {
    const { state, boss } = oilFloor();
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    ai.stage = STAGE_FIRE;
    ai.progress = 0;
    for (let i = 0; i < OK.ignitesToDrench; i++) {
      expect(stageOf(boss), `引火 ${i} 回では進まない`).toBe(STAGE_FIRE);
      igniteKing(state, boss);
    }
    expect(boss.hp, "HP は減っていない").toBeGreaterThan(boss.maxHp * OK.phase2Ratio);
    tick(state);
    expect(stageOf(boss), "油まみれ").toBe(STAGE_DRENCHED);
  });

  it("第 1 段階の引火は数えに残らない（着火に入るとき 0 に戻る）", () => {
    const { state, boss } = oilFloor();
    igniteKing(state, boss);
    expect(boss.ai?.progress, "第 1 段階で 1").toBe(1);
    tickUntil(state, () => !isStaggered(boss));
    boss.hp = Math.floor(boss.maxHp * OK.phase2Ratio);
    tick(state);
    expect(stageOf(boss), "第 2 段階").toBe(STAGE_FIRE);
    expect(boss.ai?.progress, "数えが戻る").toBe(0);
  });
});

describe("油壺の王: 第 1・3 段階の技", () => {
  it("第 1 段階: 遠いと油壺、近いと突進", () => {
    const far = oilFloor();
    putPlayer(far.state, far.boss, FAR_DIST);
    expect(pickedMove(far.state, far.boss, STAGE_ONE), "遠い").toBe(OIL_JAR);
    const near = oilFloor();
    expect(pickedMove(near.state, near.boss, STAGE_ONE), "近い").toBe(OIL_CHARGE);
  });

  it("第 3 段階: 近いと叩きつけ、足元が油なら火炎瓶、それ以外は突進", () => {
    const near = oilFloor();
    putPlayer(near.state, near.boss, NEAR_DIST);
    expect(pickedMove(near.state, near.boss, STAGE_DRENCHED), "近い").toBe(OIL_SLAM);

    const oil = oilFloor();
    putPlayer(oil.state, oil.boss, MID_DIST);
    oilUnderPlayer(oil.state);
    expect(pickedMove(oil.state, oil.boss, STAGE_DRENCHED), "足元が油").toBe(OIL_FIREBOMB);

    const mid = oilFloor();
    putPlayer(mid.state, mid.boss, MID_DIST);
    expect(pickedMove(mid.state, mid.boss, STAGE_DRENCHED), "中間").toBe(OIL_CHARGE);
  });

  it("技の選びは乱数を引かない", () => {
    const { state, boss } = oilFloor();
    const spy = vi.spyOn(state.rng, "next");
    for (const stage of [STAGE_ONE, STAGE_FIRE, STAGE_DRENCHED]) pickedMove(state, boss, stage);
    expect(spy).not.toHaveBeenCalled();
  });

  it("油まみれの突進は、壁に当たらなければ続けてもう 1 度（2 回目はコミット済み）", () => {
    const { state, boss } = oilFloor();
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    ai.stage = STAGE_DRENCHED;
    ai.move = OIL_CHARGE;
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, "硬直を挟まない").toBe("windup");
    expect(ai.move, "続きも突進").toBe(OIL_CHARGE);
    expect(ai.chain, "連撃の 2 段目").toBe(1);
    expect(windupCommitted(boss), "最初からコミット").toBe(true);
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, `chargeChain（${OK.chargeChain}）回で打ち止め`).toBe("recover");
  });

  it("壁に激突すると怯んで、続けて突進しない", () => {
    const { state, boss } = oilFloor();
    const ai = boss.ai;
    const room = state.rooms[boss.roomIndex];
    if (!ai || !room) throw new Error("no ai");
    ai.stage = STAGE_DRENCHED;
    ai.move = OIL_CHARGE;
    // 部屋の右端の壁際から、壁の向こうのプレイヤーへ突っ込ませる
    const wallX = (room.rect.x + room.rect.w) * TILE_SIZE;
    const at: Vec = { x: wallX - boss.body.radius - 2, y: boss.body.pos.y };
    boss.body.pos = findFreeSpot(state, at, boss.body.radius, 30) ?? at;
    state.player.body.pos = { x: wallX + 60, y: boss.body.pos.y };
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(isStaggered(boss), "壁激突で怯む").toBe(true);
    expect(state.boss?.selfDowns, "見えるダウンとして記録に数える").toBe(1);
    expect(ai.chain, "連撃に入らない").toBe(0);
  });

  it("同じ seed と入力なら同じ技の順", () => {
    const run = (): number[] => {
      const { state, boss } = oilFloor(7);
      boss.phase = "chase";
      boss.attackCooldown = 0;
      const moves: number[] = [];
      let last = -1;
      for (let i = 0; i < 1500; i++) {
        tick(state);
        if (phaseOf(boss) === "windup" && boss.ai && boss.ai.move !== last) {
          last = boss.ai.move;
          moves.push(last);
        }
      }
      return moves;
    };
    const a = run();
    expect(a.length, "技を出している").toBeGreaterThan(1);
    expect(run(), "同じ順").toEqual(a);
  });
});
