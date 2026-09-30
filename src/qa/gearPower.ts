import { MIN_INCREASED_MUL, productMore } from "../core/damage";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { depthHpScale } from "../data/enemies";
import { generateItem } from "../loot/generator";
import { UNIQUES } from "../loot/named";
import { computeStats } from "../loot/stats";
import { type Equipment, type Item, LOOT_SLOTS, type PlayerStats, createEmptyEquipment } from "../loot/types";
import { rollOutgoing } from "../system/combat";
import { withBaseAreaMul } from "../system/floor";
import { applyStats, meleeStep } from "../system/player";

/**
 * 「深度に見合う装備」と「地力 ÷ 敵の生命」の計測（docs/ideas/scaling-impl.md 4d・5 章）。
 * 連打の計測（combatProbe.ts）とフル QA（simulation.test.ts の深く始める型）が同じ装備の作り方を共有する。
 * ゲームのロジックは変えず、生成と集計の純関数を呼ぶだけ。
 */

/** 装備の生成に使う固定の時刻（Item.id / foundAt の材料。決定性のため実時間を使わない） */
const FITTED_NOW = 1_700_000_000_000;
/** 装備の抽選 rng の混ぜ値（state.rng を消費しない専用の rng を作る） */
const FITTED_SEED_MIX = 0x9e3779b9;
/** 右手の固定の器。連打 bot が近接で殴るので、武器種を剣に揃えて装備の差だけを見る */
const FITTED_WEAPON_BASE = "shortsword";
/** 剣の 1 段目の威力が取れないとき（武器種の定義が無い）の代わりの基礎威力。通常は起きない */
const POWER_FALLBACK_BASE = 10;

/** 名のある遺物を抽選に出さない（「並の遺物」の平均を名前つきが歪めないため） */
const EXCLUDED_NAMED: readonly string[] = UNIQUES.map((u) => u.key);

/**
 * 深度 depth に見合う並の遺物 6 部位。itemLevel = foundDepth = depth、揺らぎの増幅なし、名のある遺物なし。
 * 右手だけは剣（shortsword）に固定する。seed と depth が同じなら同じ装備（rng は専用）
 */
export function fittedEquipment(seed: number, depth: number): Equipment {
  const rng = createRng(((seed ^ FITTED_SEED_MIX) + depth * 7919) >>> 0);
  const equipment = createEmptyEquipment();
  for (const slot of LOOT_SLOTS) {
    equipment[slot] = generateItem(rng, {
      itemLevel: depth,
      slot,
      foundDepth: depth,
      now: FITTED_NOW,
      excludeNamed: EXCLUDED_NAMED,
      ...(slot === "mainHand" ? { baseKey: FITTED_WEAPON_BASE } : {}),
    });
  }
  return equipment;
}

/** 地金だけを外した写し（地金の寄与を分けて見るため。元の装備は変えない） */
export function withoutInnate(equipment: Equipment): Equipment {
  const out = createEmptyEquipment();
  for (const slot of LOOT_SLOTS) {
    const item = equipment[slot];
    out[slot] = item === null ? null : ({ ...item, innate: [] } satisfies Item);
  }
  return out;
}

/** 装備の stats を畳んだ敵のいない開始部屋（applyStats を通すので属性の派生も入る）。会心は切って数値のぶれを消す */
function armedArena(seed: number, depth: number, stats: PlayerStats): GameState {
  const state = withBaseAreaMul(() => createGame(seed));
  state.enemies = [];
  state.depth = depth;
  applyStats(state, { ...stats, critChance: 0 });
  return state;
}

/**
 * 近接 1 撃の威力（丸める前）。剣の 1 段目の威力（ステータスの係数を評価した値。筋などの地金はここに効く）に、
 * 実際の rollOutgoing の内訳から固定値・増・倍を掛け合わせる
 */
function meleeHitPower(state: GameState): number {
  const base = meleeStep(state.stats, 0)?.damage ?? POWER_FALLBACK_BASE;
  const { breakdown } = rollOutgoing(state, null, base, "melee");
  return breakdown.base * Math.max(MIN_INCREASED_MUL, 1 + breakdown.increased) * productMore(breakdown.more);
}

/** 1 つの装備の地力の材料 */
export interface GearSample {
  /** Σ増（近接。性質・地金・共鳴・偏りの数値の合計） */
  increasedMelee: number;
  /** 近接 1 撃の威力（地金込み / 地金を外したもの） */
  hit: number;
  hitWithoutInnate: number;
  /** 手数の倍率 = 攻撃速度 × 会心の期待値（1 + 会心率 × (会心倍率 − 1)）。1 撃に掛けると 1 秒あたりの威力の目安になる */
  tempo: number;
  maxHp: number;
}

export function sampleGear(seed: number, depth: number): GearSample {
  const equipment = fittedEquipment(seed, depth);
  const stats = computeStats(equipment, depth);
  const state = armedArena(seed, depth, stats);
  const bare = armedArena(seed, depth, computeStats(withoutInnate(equipment), depth));
  return {
    increasedMelee: state.stats.increased.melee,
    hit: meleeHitPower(state),
    hitWithoutInnate: meleeHitPower(bare),
    tempo: state.stats.attackSpeedMul * (1 + stats.critChance * (stats.critMul - 1)),
    maxHp: state.stats.maxHp,
  };
}

/** 深度ごとの地力の行（seed の平均） */
export interface GearPowerRow {
  depth: number;
  increasedMelee: number;
  hit: number;
  hitWithoutInnate: number;
  tempo: number;
  maxHp: number;
  /** 深度 1 の装備の 1 撃に対する比 = 地力の伸び */
  powerRatio: number;
  /** 敵の生命の伸び（depthHpScale） */
  enemyHpScale: number;
  /** 地力の伸び ÷ 敵の生命の伸び（目標 0.85〜0.9。scaling-impl.md 5 章） */
  ratio: number;
  /** 手数（攻撃速度・会心）まで含めた同じ比（深度 1 比の 1 秒あたり威力 ÷ 敵の生命の伸び） */
  ratioWithTempo: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

export function measureGearPower(depths: readonly number[], seeds: readonly number[]): GearPowerRow[] {
  const base = seeds.map((seed) => sampleGear(seed, 1));
  const baseline = mean(base.map((s) => s.hit));
  const baselineTempo = mean(base.map((s) => s.hit * s.tempo));
  return depths.map((depth) => {
    const samples = seeds.map((seed) => sampleGear(seed, depth));
    const hit = mean(samples.map((s) => s.hit));
    const powerRatio = baseline > 0 ? hit / baseline : 0;
    const tempoRatio = baselineTempo > 0 ? mean(samples.map((s) => s.hit * s.tempo)) / baselineTempo : 0;
    const enemyHpScale = depthHpScale(depth);
    return {
      depth,
      increasedMelee: mean(samples.map((s) => s.increasedMelee)),
      hit,
      hitWithoutInnate: mean(samples.map((s) => s.hitWithoutInnate)),
      tempo: mean(samples.map((s) => s.tempo)),
      maxHp: mean(samples.map((s) => s.maxHp)),
      powerRatio,
      enemyHpScale,
      ratio: enemyHpScale > 0 ? powerRatio / enemyHpScale : 0,
      ratioWithTempo: enemyHpScale > 0 ? tempoRatio / enemyHpScale : 0,
    };
  });
}

/** probe.md の節「地力 ÷ 敵の生命」 */
export function buildGearPowerSection(rows: readonly GearPowerRow[], seedCount: number): string[] {
  const lines: string[] = [];
  lines.push("## 地力 ÷ 敵の生命（深度に見合う並の遺物 6 部位）");
  lines.push("");
  lines.push(
    `深度 d の並の遺物 6 部位（itemLevel = d、右手は剣。seed ${seedCount} 本の平均）の近接 1 撃（剣の 1 段目。ステータス係数・固定値・増・倍込み。会心なし）を、` +
      "深度 1 の同じ装備に対する比にしたものが「地力の伸び」。これを敵の生命の伸び `depthHpScale(d)` で割る。" +
      "1.0 なら装備が敵の伸びと釣り合う。「手数込み」は 1 撃に攻撃速度と会心の期待値を掛けた 1 秒あたりの威力で同じ比を取ったもの。ほかの性質（スキル・状態異常・生命・防御）は数えないので、実際の地力はこれより厚い。目標は 0.85〜0.9（scaling-impl.md 5 章）。つまみは `INNATE.budget.perDepth` / `FLUX.globalScale` / `ENEMY_SCALE.hpPerDepth`。",
  );
  lines.push("");
  lines.push("| 深度 | Σ増（近接） | 1 撃 | 地金を外した 1 撃 | 地金の寄与 | 手数倍率 | 最大生命 | 地力の伸び | 敵の生命の伸び | 地力 ÷ 敵の生命 | 手数込み |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const innateShare = r.hit > 0 ? 1 - r.hitWithoutInnate / r.hit : 0;
    lines.push(
      `| ${r.depth} | +${(r.increasedMelee * 100).toFixed(0)}% | ${r.hit.toFixed(1)} | ${r.hitWithoutInnate.toFixed(1)} | ${(innateShare * 100).toFixed(0)}% | ` +
        `×${r.tempo.toFixed(2)} | ${r.maxHp.toFixed(0)} | ×${r.powerRatio.toFixed(2)} | ×${r.enemyHpScale.toFixed(2)} | ${r.ratio.toFixed(2)} | ${r.ratioWithTempo.toFixed(2)} |`,
    );
  }
  lines.push("");
  return lines;
}
