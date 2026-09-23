import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { ENEMIES, enemyDef } from "../data/enemies";
import { BOSS, ELITE, ENEMY_TEMPO } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { depthWindupMul, followUpOf, scaledWindup, updateEnemies } from "./enemies";
import { isStaggered } from "./poise";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 浮動小数の比較の余裕 */
const EPS = 1e-9;
const MAX_STEPS = 600;

/** すぐ攻撃に入れる状態にする（追跡中・攻撃間隔 0） */
function ready(e: Enemy): Enemy {
  e.phase = "chase";
  e.attackCooldown = 0;
  return e;
}

/** 被弾で状態が変わらないよう、プレイヤーを無敵にした arena */
function tempoArena(depth: number, seed = 11): GameState {
  const state = arena(seed);
  state.depth = depth;
  state.player.invulnTimer = 999;
  return state;
}

/** recover に入るまでの phase の遷移列（同じ phase の連続は 1 つにまとめる） */
function phasesUntilRecover(state: GameState, e: Enemy): string[] {
  const seq: string[] = [e.phase];
  for (let i = 0; i < MAX_STEPS && e.phase !== "recover"; i++) {
    state.player.invulnTimer = 999;
    updateEnemies(state, FIXED_DT);
    if (seq[seq.length - 1] !== e.phase) seq.push(e.phase);
  }
  return seq;
}

describe("深度による予備動作の短縮", () => {
  it("1 階は等倍、深くなると縮み windupDepthMin で止まる", () => {
    expect(depthWindupMul(1)).toBe(1);
    expect(depthWindupMul(6)).toBeCloseTo(1 - ENEMY_TEMPO.windupDepthStep * 5);
    expect(depthWindupMul(99)).toBe(ENEMY_TEMPO.windupDepthMin);
  });

  it("全敵・全深度・迅速エリートやボスの段階を掛けても基準の 60% を下回らない", () => {
    const extras = [1, ELITE.windupMul, 1 / BOSS.kingSlime.phase2SpeedMul, ELITE.windupMul * ELITE.windupMul];
    for (const def of ENEMIES) {
      for (let depth = 1; depth <= 40; depth++) {
        for (const extra of extras) {
          const w = scaledWindup(def.windup, depth, extra);
          expect(w, `${def.key} 深度 ${depth} 倍率 ${extra}`).toBeGreaterThanOrEqual(def.windup * ENEMY_TEMPO.windupFloor - EPS);
          expect(w, `${def.key} は基準より長くならない`).toBeLessThanOrEqual(def.windup + EPS);
        }
      }
    }
  });

  it("深層の迅速エリートが実際に入る予備動作も 60% で止まる", () => {
    const state = tempoArena(30);
    const def = enemyDef("slime");
    const e = ready(placeEnemy(state, "slime", 20));
    e.elite = "hasted";
    updateEnemies(state, FIXED_DT);
    expect(e.phase, "予備動作に入る").toBe("windup");
    expect(e.phaseTimer, "下限でクランプ").toBeCloseTo(def.windup * ENEMY_TEMPO.windupFloor);
  });

  it("浅い階の通常の敵は基準どおり", () => {
    const state = tempoArena(1);
    const e = ready(placeEnemy(state, "slime", 20));
    updateEnemies(state, FIXED_DT);
    expect(e.phaseTimer).toBeCloseTo(enemyDef("slime").windup);
  });

  it("ボス（スライム王の第 2 段階）も深層で 60% を下回らない", () => {
    const state = tempoArena(30);
    const def = enemyDef("kingSlime");
    const boss = ready(placeEnemy(state, "kingSlime", 80));
    if (boss.ai) boss.ai.stage = 2;
    updateEnemies(state, FIXED_DT);
    expect(boss.phase).toBe("windup");
    expect(boss.phaseTimer).toBeGreaterThanOrEqual(def.windup * ENEMY_TEMPO.windupFloor - EPS);
  });
});

describe("連続攻撃", () => {
  it("盾騎士は 2 段斬り: 2 撃目の前にも予備動作が入り、その後に隙", () => {
    const state = tempoArena(3);
    const k = ready(placeEnemy(state, "knight", 30));
    expect(phasesUntilRecover(state, k)).toEqual(["chase", "windup", "strike", "windup", "strike", "recover"]);
  });

  it("2 撃目の予備動作は followUps の windup（深度で縮み、60% 下限）", () => {
    const state = tempoArena(3);
    const k = ready(placeEnemy(state, "knight", 30));
    const f = followUpOf("knight", 3);
    let windups = 0;
    let secondWindup = 0;
    for (let i = 0; i < MAX_STEPS && windups < 2; i++) {
      const before = k.phase;
      updateEnemies(state, FIXED_DT);
      if (before !== "windup" && k.phase === "windup") {
        windups += 1;
        secondWindup = k.phaseTimer;
      }
    }
    expect(windups).toBe(2);
    expect(f).toBeDefined();
    expect(secondWindup).toBeCloseTo(scaledWindup(f?.windup ?? 0, 3));
    expect(secondWindup).toBeGreaterThan(0);
  });

  it("スライムは深度 4 から 2 連跳び、深度 3 では 1 回", () => {
    const deep = tempoArena(4);
    const s4 = ready(placeEnemy(deep, "slime", 30));
    expect(phasesUntilRecover(deep, s4)).toEqual(["chase", "windup", "strike", "windup", "strike", "recover"]);

    const shallow = tempoArena(3);
    const s3 = ready(placeEnemy(shallow, "slime", 30));
    expect(phasesUntilRecover(shallow, s3)).toEqual(["chase", "windup", "strike", "recover"]);
  });

  it("ゴーレムは 2 重リング: 予備動作を挟んで衝撃波が 2 回出る", () => {
    const state = tempoArena(4);
    const g = ready(placeEnemy(state, "golem", 40));
    const seq = phasesUntilRecover(state, g);
    expect(seq).toEqual(["chase", "windup", "strike", "windup", "strike", "recover"]);
    const rings = state.hazards.filter((h) => h.kind === "shockwave").length;
    expect(rings, "衝撃波は 2 つ").toBe(2);
  });

  it("猪（深度 6+）は壁に激突すると反転の予備動作に入り、2 回目の激突で怯む", () => {
    const state = tempoArena(6);
    const room = state.rooms.find((r) => r.rect.x * TILE_SIZE < state.player.body.pos.x && state.player.body.pos.x < (r.rect.x + r.rect.w) * TILE_SIZE);
    expect(room).toBeDefined();
    const left = (room?.rect.x ?? 0) * TILE_SIZE;
    const boar = placeEnemy(state, "boar", 0, 0);
    boar.body.pos = { x: left + boar.body.radius + 4, y: state.player.body.pos.y };
    boar.phase = "strike";
    boar.phaseTimer = enemyDef("boar").strikeTime;
    boar.strikeDir = { x: -1, y: 0 };
    if (boar.ai) boar.ai.counter = followUpOf("boar", 6)?.count ?? 0;
    // プレイヤーを遠ざけて接触で止まらないようにする
    state.player.body.pos = { x: -9999, y: -9999 };
    updateEnemies(state, FIXED_DT);
    expect(boar.phase, "1 回目の激突は反転の予備動作").toBe("windup");
    expect(isStaggered(boar), "1 回目は怯まない").toBe(false);
    expect(boar.phaseTimer).toBeGreaterThan(0);

    // 2 撃目も壁へ向けて走らせる
    boar.phase = "strike";
    boar.phaseTimer = enemyDef("boar").strikeTime;
    boar.strikeDir = { x: -1, y: 0 };
    for (let i = 0; i < 10 && !isStaggered(boar); i++) updateEnemies(state, FIXED_DT);
    expect(isStaggered(boar), "連続攻撃を使い切ったら激突で怯む").toBe(true);
  });

  it("猪は深度 5 まで連続攻撃を持たない（壁に激突すると従来どおり怯む）", () => {
    expect(followUpOf("boar", 5)).toBeUndefined();
  });
});

describe("連携ずらし", () => {
  it("近くの 3 体は同じステップで予備動作に入らず、coordDelay 以上ずれる", () => {
    const state = tempoArena(1);
    const list = [ready(placeEnemy(state, "slime", 20, 0)), ready(placeEnemy(state, "slime", -20, 0)), ready(placeEnemy(state, "slime", 0, 20))];
    const started = new Map<number, number>();
    for (let i = 0; i < MAX_STEPS && started.size < list.length; i++) {
      state.player.invulnTimer = 999;
      updateEnemies(state, FIXED_DT);
      for (const e of list) if (e.phase === "windup" && !started.has(e.id)) started.set(e.id, i);
    }
    const steps = [...started.values()].sort((a, b) => a - b);
    expect(steps).toHaveLength(3);
    const minGap = Math.floor(ENEMY_TEMPO.coordDelay / FIXED_DT) - 1;
    for (let i = 1; i < steps.length; i++) {
      expect((steps[i] ?? 0) - (steps[i - 1] ?? 0), "同時の予備動作がない").toBeGreaterThanOrEqual(minGap);
    }
  });

  it("半径の外の敵はずらさない（同じステップで予備動作に入れる）", () => {
    const state = tempoArena(1);
    const a = ready(placeEnemy(state, "eye", 100, 0));
    const b = ready(placeEnemy(state, "eye", -100, 0));
    updateEnemies(state, FIXED_DT);
    expect(a.phase).toBe("windup");
    expect(b.phase).toBe("windup");
  });

  it("蝙蝠の群れは噛みを batCoordDelay ずつずらす", () => {
    const state = tempoArena(1);
    const bats = [ready(placeEnemy(state, "bat", 20, 0)), ready(placeEnemy(state, "bat", 20, 8))];
    updateEnemies(state, FIXED_DT);
    const waiting = bats.find((b) => b.phase === "chase");
    expect(bats.filter((b) => b.phase === "windup")).toHaveLength(1);
    // 後で処理される個体は同じステップで 1 ステップ分だけ減る
    const cd = waiting?.attackCooldown ?? 0;
    expect(cd, "蝙蝠どうしは短い間隔").toBeGreaterThanOrEqual(ENEMY_TEMPO.batCoordDelay - FIXED_DT - EPS);
    expect(cd, "通常の coordDelay より短い").toBeLessThan(ENEMY_TEMPO.coordDelay - FIXED_DT);
  });
});

describe("決定性", () => {
  function run(seed: number): string {
    const state = arena(seed);
    state.depth = 7;
    state.player.maxHp = 1_000_000;
    state.player.hp = 1_000_000;
    for (const [key, dx, dy] of [["slime", 30, 0], ["knight", -30, 10], ["golem", 0, 40], ["boar", 60, -20], ["bat", -20, -20]] as const) {
      placeEnemy(state, key, dx, dy);
    }
    for (let i = 0; i < 400; i++) step(state, withInput({ move: { x: i % 90 < 45 ? 1 : -1, y: 0 }, attackPressed: i % 20 === 0 }), FIXED_DT);
    return JSON.stringify(state.enemies.map((e) => [e.id, e.phase, e.hp, e.body.pos, e.ai?.counter]));
  }

  it("同じ seed と入力なら連続攻撃・連携ずらし込みで同じ結果", () => {
    expect(run(21)).toBe(run(21));
  });
});
