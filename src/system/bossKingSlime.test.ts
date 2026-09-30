import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EnemyPhase, GameState } from "../core/state";
import { dist } from "../core/vec";
import { BOSS, PLAYER } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { bossEnemy } from "./boss";
import { KS_INFLATE, KS_JUMP, KS_SWALLOW, inflateRadius, kingSlimeAirTime, splitsOf } from "./bossKingSlime";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { updateHazards } from "./hazards";
import { applyStagger, windupCommitted } from "./poise";
import { updateStatusEffects } from "./statusEffects";
import { terrainAt } from "./terrain";

const HUGE_HP = 1_000_000;
const MAX_STEPS = 1200;
const KS = BOSS.kingSlime;

/** スライム王の階を作り、部屋を封鎖してプレイヤーを王の横（dx）に置く */
function kingFloor(dx = -70, seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = BOSS.interval;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== "kingSlime") throw new Error("no king slime");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss };
}

function tick(state: GameState, n = 1, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    each?.(i);
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

function tickUntil(state: GameState, done: () => boolean, each?: (i: number) => void): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) tick(state, 1, each);
}

/** プレイヤーを左右に小刻みに動かす（静止とみなされない） */
function jiggle(state: GameState): (i: number) => void {
  return (i) => {
    const dx = i % 2 === 0 ? 2 : -2;
    state.player.body.pos = { x: state.player.body.pos.x + dx, y: state.player.body.pos.y };
  };
}

/** 分裂させ、分裂体をその場に留める（出現の魔法陣のまま） */
function split(state: GameState, boss: Enemy): Enemy[] {
  boss.phase = "chase";
  boss.attackCooldown = 999;
  boss.hp = Math.floor(boss.maxHp * KS.phase2Ratio);
  tick(state);
  const splits = splitsOf(state, boss);
  for (const s of splits) s.phaseTimer = 999;
  return splits;
}

/** 第 2 段階で呑みの予備動作から着地まで進める */
function swallowOnce(state: GameState, boss: Enemy): void {
  const ai = boss.ai;
  if (!ai) throw new Error("no ai");
  boss.phase = "recover";
  boss.phaseTimer = FIXED_DT / 2;
  ai.timer = KS.swallowEvery;
  tick(state);
  expect(ai.move, "間隔が来たら呑む").toBe(KS_SWALLOW);
  boss.attackCooldown = 0;
  tickUntil(state, () => (ai.digest ?? 0) > 0);
}

describe("スライム王: 第 1 段階（跳躍）", () => {
  it("跳躍の影の間は無害で、着地で衝撃波", () => {
    const { state, boss } = kingFloor();
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(state.hazards.some((h) => h.kind === "landing"), "着地点の影").toBe(true);
    expect(kingSlimeAirTime(boss), "空中の総秒（描画の跳ね）").toBe(KS.jumpTime);
    const hp = state.player.hp;
    let hurtInAir = false;
    tickUntil(
      state,
      () => phaseOf(boss) !== "strike",
      () => {
        if (state.player.hp < hp) hurtInAir = true;
      },
    );
    expect(hurtInAir, "空中の間は無害").toBe(false);
    expect(state.hazards.some((h) => h.kind === "shockwave" && h.sourceId === boss.id), "着地の衝撃波").toBe(true);
    expect(state.player.hp, "真下で潰される").toBeLessThan(hp);
  });

  it("静止していると着地の直後にもう 1 度跳ぶ（2 回目の予備動作はコミット済み）", () => {
    const { state, boss } = kingFloor();
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, "硬直を挟まない").toBe("windup");
    expect(boss.ai?.move).toBe(KS_JUMP);
    expect(boss.ai?.chain).toBe(1);
    expect(windupCommitted(boss), "最初からコミット").toBe(true);
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, `stillJumpChain（${KS.stillJumpChain}）回で打ち止め`).toBe("recover");
  });

  it("動いている相手には続けて跳ばない", () => {
    const { state, boss } = kingFloor();
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    expect(boss.phase).toBe("recover");
  });
});

describe("スライム王: 第 2 段階（分裂）", () => {
  it("HP が phase2Ratio を切ると splitCount 体に分裂し、第 2 段階の着地は毒沼を残す", () => {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    expect(splits.length).toBe(KS.splitCount);
    expect(boss.ai?.stage).toBe(2);
    const ai = boss.ai;
    if (!ai) return;
    ai.move = KS_JUMP;
    ai.timer = 0;
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    tick(state, 2);
    expect(terrainAt(state, boss.body.pos.x, boss.body.pos.y), "着地点の毒沼").toBe("bog");
  });

  it("swallowEvery 秒ごとに分裂体を呑み（撃破に数えない）、消化の digestTime 秒は動かず、終われば回復する", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    const kills = state.kills;
    swallowOnce(state, boss);
    expect(splitsOf(state, boss).length, "1 体呑んだ").toBe(KS.splitCount - 1);
    expect(boss.phase).toBe("recover");
    expect(boss.phaseTimer).toBeCloseTo(KS.digestTime, 1);
    tick(state);
    expect(state.kills, "撃破に数えない").toBe(kills);
    boss.hp = Math.floor(boss.maxHp * 0.4);
    const hp = boss.hp;
    const pos = { ...boss.body.pos };
    tick(state, Math.floor(KS.digestTime / FIXED_DT) - 3);
    expect(boss.body.pos, "消化中は動かない").toEqual(pos);
    tickUntil(state, () => phaseOf(boss) !== "recover");
    expect(boss.hp, "消化し終えると回復").toBe(hp + Math.round(KS.swallowHealRatio * boss.maxHp));
  });

  it("消化中に怯ませると回復しない", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    swallowOnce(state, boss);
    boss.hp = Math.floor(boss.maxHp * 0.4);
    const hp = boss.hp;
    applyStagger(state, boss, 0.5);
    tick(state, Math.ceil((0.5 + KS.digestTime) / FIXED_DT) + 5);
    expect(boss.ai?.digest ?? 0, "吐き出した").toBe(0);
    expect(boss.hp, "回復しない").toBe(hp);
  });

  it("分裂体が 0 体になると HP に関わらず第 3 段階", () => {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    for (const s of splits) s.hp = 0;
    tick(state);
    expect(boss.hp, "HP は保険の閾値より上").toBeGreaterThan(boss.maxHp * KS.phase3Ratio);
    expect(boss.ai?.stage).toBe(3);
  });
});

describe("スライム王: 第 3 段階（膨張）", () => {
  function inflateFloor(): { state: GameState; boss: Enemy; corner: { x: number; y: number } } {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    for (const s of splits) s.hp = 0;
    tick(state);
    const room = state.rooms[boss.roomIndex];
    if (!room || !boss.ai) throw new Error("no room");
    boss.body.pos = rectCenterPx(room.rect);
    const corner = { x: (room.rect.x + 0.5) * TILE_SIZE, y: (room.rect.y + 0.5) * TILE_SIZE };
    state.player.body.pos = findFreeSpot(state, corner, state.player.body.radius, TILE_SIZE) ?? corner;
    boss.ai.move = KS_INFLATE;
    boss.phase = "chase";
    boss.attackCooldown = 0;
    return { state, boss, corner };
  }

  it("膨張の衝撃波は waveCount 重で、半径は部屋の四隅に届かない", () => {
    const { state, boss } = inflateFloor();
    const room = state.rooms[boss.roomIndex];
    if (!room) throw new Error("no room");
    const radius = inflateRadius(state, boss);
    const r = room.rect;
    for (const x of [r.x, r.x + r.w]) {
      for (const y of [r.y, r.y + r.h]) {
        expect(radius, "角まで届かない").toBeLessThan(dist(boss.body.pos, { x: x * TILE_SIZE, y: y * TILE_SIZE }));
      }
    }
    const hp = state.player.hp;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(kingSlimeAirTime(boss), "膨張は跳ねない").toBeNull();
    const waves = new Set<number>();
    tickUntil(
      state,
      () => phaseOf(boss) === "recover",
      () => {
        for (const h of state.hazards) if (h.kind === "shockwave" && h.sourceId === boss.id) waves.add(h.id);
      },
    );
    tick(state, 1);
    for (const h of state.hazards) if (h.kind === "shockwave" && h.sourceId === boss.id) waves.add(h.id);
    expect(waves.size).toBe(KS.waveCount);
    tick(state, Math.ceil(1 / FIXED_DT));
    expect(state.player.hp, "四隅は安全").toBe(hp);
  });

  it("膨張の後は exhaustTime 秒動かない", () => {
    const { state, boss } = inflateFloor();
    tickUntil(state, () => phaseOf(boss) === "recover");
    expect(boss.phaseTimer).toBeCloseTo(KS.exhaustTime, 1);
    const pos = { ...boss.body.pos };
    tick(state, Math.floor(KS.exhaustTime / FIXED_DT) - 2);
    expect(boss.body.pos).toEqual(pos);
    expect(boss.phase).toBe("recover");
  });
});

describe("スライム王: 決定性", () => {
  it("同じ seed と入力なら同じ技の順", () => {
    const run = (): number[] => {
      const { state, boss } = kingFloor(-90, 33);
      boss.phase = "chase";
      boss.hp = Math.floor(boss.maxHp * KS.phase2Ratio);
      const moves: number[] = [];
      let last: EnemyPhase = phaseOf(boss);
      for (let i = 0; i < 2400; i++) {
        // 円を描いて歩く（決まった入力）
        const a = (i / 120) * Math.PI * 2;
        const step = PLAYER.speed * FIXED_DT * 0.5;
        const p = state.player.body.pos;
        const next = { x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step };
        if (!findFreeSpot(state, next, state.player.body.radius, 0)) continue;
        state.player.body.pos = next;
        tick(state);
        const now = phaseOf(boss);
        if (now === "windup" && last !== "windup") moves.push(boss.ai?.move ?? -1);
        last = now;
        if (boss.hp <= 0) break;
      }
      return moves;
    };
    const a = run();
    expect(a.length, "技を出している").toBeGreaterThan(3);
    expect(a, "呑みまで進む").toContain(KS_SWALLOW);
    expect(a, "膨張まで進む").toContain(KS_INFLATE);
    expect(run()).toEqual(a);
  });
});
