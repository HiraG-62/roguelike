import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { dist } from "../core/vec";
import { ENEMIES, enemyDef } from "../data/enemies";
import { REACTION } from "../data/tuning";
import { updateEnemies } from "./enemies";
import { type DepthStage, depthStagesOf, followUpOf, latestStageValue, learnedRetreatMul, learnedWindupMoveMul, stagedEnemyKeys } from "./enemyStages";
import { arena, placeEnemy } from "./testHelpers";

const HUGE_HP = 1_000_000;
const STEPS = 10;

function stageArena(depth: number): GameState {
  const state = arena(11);
  state.depth = depth;
  state.player.invulnTimer = 999;
  return state;
}

/** phase の段にいる、倒れない敵を置く */
function inPhase(state: GameState, key: string, dx: number, phase: Enemy["phase"], timer: number): Enemy {
  const e = placeEnemy(state, key, dx);
  e.hp = HUGE_HP;
  e.maxHp = HUGE_HP;
  e.phase = phase;
  e.phaseTimer = timer;
  e.windupTotal = timer;
  e.attackCooldown = 99;
  return e;
}

/** STEPS ステップ進めて、プレイヤーからの距離の増え方を返す */
function driftAway(state: GameState, e: Enemy): number {
  const before = dist(e.body.pos, state.player.body.pos);
  for (let i = 0; i < STEPS; i++) updateEnemies(state, FIXED_DT);
  return dist(e.body.pos, state.player.body.pos) - before;
}

describe("章で覚える段（ENEMY_TEMPO.depthStages）の形", () => {
  it("段を持つ敵はすべて定義があり、段は minDepth の昇順", () => {
    const keys = new Set(ENEMIES.map((d) => d.key));
    for (const key of stagedEnemyKeys()) {
      expect(keys.has(key), `${key} は敵の定義にある`).toBe(true);
      const depths = depthStagesOf(key).map((s) => s.minDepth);
      expect(depths, `${key} の段は昇順`).toEqual([...depths].sort((a, b) => a - b));
    }
  });

  it("深度が足りない段は効かず、足りた段は後の段が前の段を上書きする", () => {
    const stages: DepthStage[] = [
      { minDepth: 2, retreatMul: 1 },
      { minDepth: 4, windupMoveMul: -0.5 },
      { minDepth: 6, retreatMul: 2 },
    ];
    const retreat = (d: number): number | undefined => latestStageValue(stages, d, (s) => s.retreatMul);
    expect(retreat(1), "深度 1 は何も覚えていない").toBeUndefined();
    expect(retreat(3)).toBe(1);
    expect(retreat(5), "別の技の段は上書きしない").toBe(1);
    expect(retreat(6), "深い段が上書きする").toBe(2);
    expect(latestStageValue(stages, 5, (s) => s.windupMoveMul)).toBe(-0.5);
  });

  it("連撃の定義は同じ段なら同じもの（毎ステップ作り直さない）", () => {
    expect(followUpOf("knight", 3)).toBe(followUpOf("knight", 9));
    expect(followUpOf("knight", 3)?.minDepth).toBe(1);
  });
});

describe("章で覚える技の例", () => {
  it("骸骨兵は深度 5 から連撃を覚える", () => {
    expect(followUpOf("skeleton", 4)).toBeUndefined();
    expect(followUpOf("skeleton", 5)?.count).toBe(1);
  });

  it("槍兵は深度 6 から突いた後に飛び下がる（離脱）", () => {
    expect(learnedRetreatMul("spearman", 5)).toBeUndefined();
    expect(learnedRetreatMul("spearman", 6) ?? 0).toBeGreaterThan(0);

    const shallow = stageArena(5);
    const s5 = inPhase(shallow, "spearman", 30, "recover", 1);
    expect(driftAway(shallow, s5), "深度 5 は隙の間その場").toBeCloseTo(0, 6);

    const deep = stageArena(6);
    const s6 = inPhase(deep, "spearman", 30, "recover", 1);
    const expected = enemyDef("spearman").speed * (learnedRetreatMul("spearman", 6) ?? 0) * FIXED_DT * STEPS;
    expect(driftAway(deep, s6), "深度 6 は隙の間に離れる").toBeCloseTo(expected, 3);
  });

  it("爆弾ゴブリンは深度 6 から構えながら下がる（後退射撃）", () => {
    expect(learnedWindupMoveMul("bomber", 5)).toBeUndefined();
    expect(learnedWindupMoveMul("bomber", 6) ?? 0).toBeLessThan(0);

    const shallow = stageArena(5);
    const b5 = inPhase(shallow, "bomber", 60, "windup", 1);
    expect(driftAway(shallow, b5), "深度 5 は構える間その場").toBeCloseTo(0, 6);

    const deep = stageArena(6);
    const b6 = inPhase(deep, "bomber", 60, "windup", 1);
    const expected = enemyDef("bomber").speed * -(learnedWindupMoveMul("bomber", 6) ?? 0) * FIXED_DT * STEPS;
    expect(driftAway(deep, b6), "深度 6 は構える間に離れる").toBeCloseTo(expected, 3);
  });

  it("段で覚えた離脱は REACTION.retreatAfterStrike より優先する（段が無い敵は従来どおり）", () => {
    const retreatAfter: Readonly<Record<string, number | undefined>> = REACTION.retreatAfterStrike;
    for (const key of Object.keys(retreatAfter)) {
      expect(learnedRetreatMul(key, 99), `${key} は段を持たず REACTION の値のまま`).toBeUndefined();
    }
  });
});
