import { FIXED_DT } from "../core/loop";
import { step } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { depthDamageMul, depthHpScale } from "../data/enemies";
import { affixDef } from "../loot/affixes";
import { fittedEquipment, measureGearPower } from "./gearPower";
import { BASES } from "../loot/bases";
import { bulletOfBase } from "../loot/bullets";
import { innateMeanBudget } from "../loot/innate";
import { rollTableTrait } from "../loot/generator";
import { REACH_DEFS, hasReach, reachMeasures } from "../loot/reach";
import { computeStats } from "../loot/stats";
import { REACH_KEYS, type PlayerStats, type ReachKey, createEmptyEquipment } from "../loot/types";
import type { MovesetKey } from "../data/weapons";
import { BOON_KEYS, BOONS, LINEAGE_KEYS, type BoonKey, type LineageKey } from "../system/boonDefs";
import { GRADE_TOP } from "../system/boonGrade";
import { addTally, grantBoon } from "../system/boons";
import { deepFloorOf } from "../system/chapters";
import { applyStats } from "../system/player";
import { placedPools } from "../system/rules";
import { botInput, makeArena, placeEnemy, probeMetrics, runGroup, type ProbeCounts } from "./combatProbe";

/**
 * 深みの QA（docs/ideas/deep-impl.md 4 章の D・5 章）。`npm run qa:probe -- --deep` が probe.md の「## 深み」の節を作る。
 * 3 つの表: (1) 深度ごとの地力 ÷ 敵の生命と「追い付くのに要る倍」、(2) 到達の届き方、(3) 壊れたビルドの 1 step の重さ。
 * ゲームのロジックは変えず、生成と集計の純関数と実際の step() を呼んで数えるだけ。
 */

/** 深みの曲線の表で測る深度（21 = 最深の間が基準、22 = 深み 1 層目） */
export const DEEP_PROBE_DEPTHS: readonly number[] = [21, 22, 25, 30, 35, 40];
/** 要る倍の基準にする深度 */
const BASE_DEPTH = 21;
/** 到達の届き方を測る深度 */
export const REACH_PROBE_DEPTHS: readonly number[] = [21, 25, 30, 35, 40];
/** 壊れたビルドを測る深度 */
export const BROKEN_PROBE_DEPTHS: readonly number[] = [22, 30, 40];

/** 被弾で死ぬまでを測る集団（前衛・槍・並の組）。深みの守りの薄さを見る */
const HIT_GROUP: readonly string[] = ["knight", "spearman", "slime", "slime"];
const HIT_SECONDS = 20;

/** 地力の比を出す装備の seed 数（gearPower の probe と同じ） */
export const DEEP_POWER_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** 被弾の計測の seed */
export const DEEP_HIT_SEEDS: readonly number[] = [1, 2];

// ---------------------------------------------------------------------------
// (1) 深みの曲線
// ---------------------------------------------------------------------------

export interface DeepCurveRow {
  depth: number;
  /** 深みの何層目か（深みでなければ 0） */
  deepFloor: number;
  enemyHp: number;
  enemyDamage: number;
  innateBudget: number;
  /** 地力の伸び（深度 1 比。近接 1 撃） */
  power: number;
  /** 地力 ÷ 敵の生命 */
  ratio: number;
  /** 深度 21 から追い付くのに要る相乗・研鑽の倍 = (enemyHp(d) / enemyHp(21)) ÷ (power(d) / power(21)) */
  needMul: number;
  maxHp: number;
  /** 被弾で死ぬまでの回数（深度相応の装備・集団。被弾が 0 なら null） */
  hitsToDie: number | null;
}

function sumCounts(rows: readonly ProbeCounts[]): ProbeCounts {
  const total = rows[0];
  if (total === undefined) throw new Error("計測の行が無い");
  const out: ProbeCounts = { ...total, band: { ...total.band } };
  for (const c of rows.slice(1)) {
    out.runs += c.runs;
    out.maxHpSum += c.maxHpSum;
    out.hitsTaken += c.hitsTaken;
    out.damageTaken += c.damageTaken;
    out.seconds += c.seconds;
  }
  return out;
}

function hitsToDieAt(depth: number, seeds: readonly number[], seconds: number): number | null {
  const counts = sumCounts(seeds.map((seed) => runGroup(depth, HIT_GROUP, "mashDodge", seconds, seed, "fitted")));
  return probeMetrics(counts).hitsToDie;
}

export function measureDeepCurve(
  depths: readonly number[],
  seeds: readonly number[],
  hitSeeds: readonly number[] = [],
  hitSeconds = HIT_SECONDS,
): DeepCurveRow[] {
  const all = [...new Set([BASE_DEPTH, ...depths])];
  const power = new Map(measureGearPower(all, seeds).map((r) => [r.depth, r]));
  const base = power.get(BASE_DEPTH);
  const basePower = base?.powerRatio ?? 0;
  const baseHp = depthHpScale(BASE_DEPTH);
  return depths.map((depth) => {
    const row = power.get(depth);
    const p = row?.powerRatio ?? 0;
    const hp = depthHpScale(depth);
    const catchUp = basePower > 0 && p > 0 ? hp / baseHp / (p / basePower) : 0;
    return {
      depth,
      deepFloor: deepFloorOf(depth),
      enemyHp: hp,
      enemyDamage: depthDamageMul(depth),
      innateBudget: innateMeanBudget(depth),
      power: p,
      ratio: row?.ratio ?? 0,
      needMul: catchUp,
      maxHp: row?.maxHp ?? 0,
      hitsToDie: hitSeeds.length === 0 ? null : hitsToDieAt(depth, hitSeeds, hitSeconds),
    };
  });
}

// ---------------------------------------------------------------------------
// (2) 到達の届き方
// ---------------------------------------------------------------------------

export interface ReachOddsRow {
  key: ReachKey;
  depth: number;
  /** 主な性質を持つ遺物 2 つの合計が閾値に届いた割合（0..1） */
  odds: number;
}

/** 遺物 2 つの合計を数える（到達の主な性質を持つ遺物が 2 つ揃う、という見積もり。部位の制約は数えない） */
const RELICS_PER_ROLL = 2;
/** 抽選の rng の混ぜ値（state.rng を使わない専用の rng） */
const ODDS_SEED_MIX = 0x85ebca6b;

/**
 * 到達の主な性質（REACH_DEFS[k].affixes[0]）を持つ遺物 2 つを rollTableTrait（depth = foundDepth = d、反転なし）で引き、
 * 装備の無い stats に affixDef(k).apply で足して hasReach を数える。seed が同じなら同じ割合
 */
export function measureReachOdds(depths: readonly number[], samples: number, seed: number): ReachOddsRow[] {
  const rows: ReachOddsRow[] = [];
  for (const key of REACH_KEYS) {
    const affixKey = REACH_DEFS[key].affixes[0];
    const def = affixKey === undefined ? undefined : affixDef(affixKey);
    for (const depth of depths) {
      rows.push({ key, depth, odds: def === undefined ? 0 : reachOdds(key, def, depth, samples, seed) });
    }
  }
  return rows;
}

function reachOdds(key: ReachKey, def: NonNullable<ReturnType<typeof affixDef>>, depth: number, samples: number, seed: number): number {
  if (samples <= 0) return 0;
  const rng = createRng(((seed ^ ODDS_SEED_MIX) + depth * 7919) >>> 0);
  const empty = computeStats(createEmptyEquipment());
  let reached = 0;
  for (let i = 0; i < samples; i++) {
    const stats: PlayerStats = { ...empty };
    for (let n = 0; n < RELICS_PER_ROLL; n++) {
      const roll = rollTableTrait(rng, def, { depth, foundDepth: depth, allowInversion: false });
      def.apply(stats, roll.value, roll.value2 ?? 0);
    }
    stats.reach = reachMeasures(stats);
    if (hasReach(stats, key)) reached++;
  }
  return reached / samples;
}

// ---------------------------------------------------------------------------
// (3) 壊れたビルドの重さ
// ---------------------------------------------------------------------------

/** 壊れたビルドの武器: 近接（剣）か、弾を撃つ銃（長銃。自分の弾の数を見る） */
export type BrokenWeapon = "melee" | "gun";
export const BROKEN_WEAPONS: readonly BrokenWeapon[] = ["melee", "gun"];
const BROKEN_GUN_MOVESET: MovesetKey = "longarm";

export interface BrokenRow {
  weapon: BrokenWeapon;
  depth: number;
  seconds: number;
  meanStepMs: number;
  /** 1 step の 99 パーセンタイル（最大は GC や他のプロセスの負荷で跳ねるので、傾向はこちらで見る） */
  p99StepMs: number;
  maxStepMs: number;
  maxPlayerProjectiles: number;
  maxShots: number;
  maxEnemies: number;
  /** 設置物の置き場 1 つの同時数の最大（LIMITS.placedPerPool の余裕を見る） */
  maxPlacedPerPool: number;
  trimmed: number;
  droppedEvents: number;
  /** 計測中に state の主な数値（hp・位置・敵数・弾数）がずっと有限だったか */
  finite: boolean;
}

/** 壊れたビルドの周りに置く敵の数と、敵の補充の間隔（step） */
const BROKEN_ENEMIES = 30;
const BROKEN_REFILL_STEPS = 60;
/** 周りに置く敵（陣の役割を混ぜる: 前衛・槍・射手・素早い・並）。2 重の輪に置く */
const BROKEN_ENEMY_KEYS: readonly string[] = ["knight", "spearman", "eye", "wolf", "skeleton", "slime"];
const BROKEN_RING_INNER = 50;
const BROKEN_RING_OUTER = 90;
const BROKEN_COOLDOWN_BASE = 0.3;
const BROKEN_COOLDOWN_STAGGER = 0.07;
/** 全ての研鑽の数えに入れる値 */
const BROKEN_TALLY = 2000;
/** 壊れたビルドに全札を持たせる系譜（雷鳴・灰燼・眷属） */
const BROKEN_LINEAGES: readonly LineageKey[] = LINEAGE_KEYS.filter((l) => l === "thunder" || l === "ash" || l === "horde");

/** 研鑽の数えの key 全部（研鑽の段・「〜につき」の数え・tally 効果の key）。全札を持たせたあとに数えを満たすために集める */
export function tallyKeysOf(keys: readonly BoonKey[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    const def = BOONS[k];
    if (def.temperStat !== undefined) out.add(def.temperStat.tally);
    for (const m of def.modifiers ?? []) {
      if (m.per?.count.kind === "tally") out.add(m.per.count.key);
    }
    for (const r of def.rules ?? []) {
      if (r.then.kind === "tally" && r.then.key !== undefined) out.add(r.then.key);
    }
  }
  return [...out];
}

const P99 = 0.99;

/** 昇順に並べた values の p 分位（0..1）。空は 0 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** 壊れたビルドの土台: 深度相応の装備、3 つの到達（stats.reach を閾値に）、系譜の全札（格 5）、全ての数え 2000 */
function makeBrokenArena(seed: number, depth: number, weapon: BrokenWeapon): GameState {
  const state = makeArena(seed, depth, "fitted");
  const gear = computeStats(fittedEquipment(seed, depth), depth);
  const gunBase = BASES.find((b) => b.moveset === BROKEN_GUN_MOVESET);
  const arms = weapon === "gun" ? { moveset: BROKEN_GUN_MOVESET, bullet: bulletOfBase(gunBase?.key) } : {};
  const reach = Object.fromEntries(REACH_KEYS.map((k) => [k, REACH_DEFS[k].threshold])) as Record<ReachKey, number>;
  applyStats(state, { ...gear, ...arms, critChance: 0, reach });
  const boons = BOON_KEYS.filter((k) => {
    const lineage = BOONS[k].lineage;
    return lineage !== undefined && BROKEN_LINEAGES.includes(lineage) && BOONS[k].cursed !== true;
  });
  for (const k of boons) grantBoon(state, k, GRADE_TOP);
  for (const key of tallyKeysOf(boons)) addTally(state, key, BROKEN_TALLY, "max");
  state.player.hp = state.player.maxHp;
  return state;
}

function refillEnemies(state: GameState): void {
  const missing = BROKEN_ENEMIES - state.enemies.filter((e) => e.hp > 0).length;
  for (let i = 0; i < missing; i++) {
    const key = BROKEN_ENEMY_KEYS[i % BROKEN_ENEMY_KEYS.length] ?? "slime";
    const angle = (i / BROKEN_ENEMIES) * Math.PI * 2;
    const radius = i % 2 === 0 ? BROKEN_RING_INNER : BROKEN_RING_OUTER;
    const e = placeEnemy(state, key, Math.cos(angle) * radius, Math.sin(angle) * radius);
    e.attackCooldown = BROKEN_COOLDOWN_BASE + (i % BROKEN_ENEMIES) * BROKEN_COOLDOWN_STAGGER;
  }
}

function stateIsFinite(state: GameState): boolean {
  const p = state.player;
  return [p.hp, p.maxHp, p.body.pos.x, p.body.pos.y, state.enemies.length, state.projectiles.length].every((n) => Number.isFinite(n));
}

/**
 * 壊れたビルドの重さ: makeArena(seed, depth, "fitted") に 3 つの到達・雷鳴と灰燼と眷属の全札（格 5）・全ての研鑽の数え 2000 を入れ、
 * 敵 30 体を周りに置き、bot で seconds 秒殴る。1 step の実時間（performance.now）を測る。プレイヤーは死なせない
 */
export function measureBrokenBuild(depth: number, seconds: number, seed: number, weapon: BrokenWeapon = "melee"): BrokenRow {
  const state = makeBrokenArena(seed, depth, weapon);
  const steps = Math.round(seconds / FIXED_DT);
  let total = 0;
  let max = 0;
  const times: number[] = [];
  let maxProjectiles = 0;
  let maxShots = 0;
  let maxEnemies = 0;
  let maxPlaced = 0;
  let finite = true;
  const trimmedBefore = state.ruleRun.trimmed;
  const droppedBefore = state.ruleRun.droppedEvents;
  for (let i = 0; i < steps; i++) {
    if (i % BROKEN_REFILL_STEPS === 0) refillEnemies(state);
    state.player.hp = state.player.maxHp;
    // 壊れたビルドは技を惜しまない: マナを満たし、4 つのスキルを毎 step 押す（弾・設置物の数を最大にする）
    state.player.mana = state.stats.maxMana;
    const input = { ...botInput(state, "mashDodge"), skill1Pressed: true, skill2Pressed: true, skill3Pressed: true, skill4Pressed: true };
    const t0 = performance.now();
    step(state, input, FIXED_DT);
    const ms = performance.now() - t0;
    total += ms;
    times.push(ms);
    max = Math.max(max, ms);
    maxProjectiles = Math.max(maxProjectiles, state.projectiles.filter((p) => p.owner === "player").length);
    maxShots = Math.max(maxShots, state.skills.shots.length);
    maxEnemies = Math.max(maxEnemies, state.enemies.length);
    for (const pool of placedPools(state)) maxPlaced = Math.max(maxPlaced, pool.length);
    finite = finite && stateIsFinite(state);
  }
  return {
    weapon,
    depth,
    seconds,
    meanStepMs: steps > 0 ? total / steps : 0,
    p99StepMs: percentile(times, P99),
    maxStepMs: max,
    maxPlayerProjectiles: maxProjectiles,
    maxShots,
    maxEnemies,
    maxPlacedPerPool: maxPlaced,
    trimmed: state.ruleRun.trimmed - trimmedBefore,
    droppedEvents: state.ruleRun.droppedEvents - droppedBefore,
    finite: finite && Number.isFinite(total),
  };
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

function fixed(n: number | null, digits: number): string {
  return n === null || !Number.isFinite(n) ? "-" : n.toFixed(digits);
}

function buildCurveTable(curve: readonly DeepCurveRow[]): string[] {
  const lines: string[] = [];
  lines.push("| 深度 | 深み | 敵の生命 | 敵の攻撃 | 地金の予算 | 地力の伸び | 地力 ÷ 敵の生命 | 要る倍 | 最大生命 | 被弾で死ぬまで |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of curve) {
    const deep = r.deepFloor > 0 ? `${r.deepFloor} 層` : "-";
    lines.push(
      `| ${r.depth} | ${deep} | ×${fixed(r.enemyHp, 2)} | ×${fixed(r.enemyDamage, 2)} | ${fixed(r.innateBudget, 1)} | ×${fixed(r.power, 2)} | ` +
        `${fixed(r.ratio, 2)} | ×${fixed(r.needMul, 2)} | ${fixed(r.maxHp, 0)} | ${fixed(r.hitsToDie, 1)} |`,
    );
  }
  return lines;
}

function buildOddsTable(odds: readonly ReachOddsRow[]): string[] {
  const depths = [...new Set(odds.map((r) => r.depth))];
  const lines: string[] = [];
  lines.push(`| 到達 | 主な性質 | 閾値 | ${depths.map((d) => `深度 ${d}`).join(" | ")} |`);
  lines.push(`| --- | --- | --- | ${depths.map(() => "---").join(" | ")} |`);
  for (const key of REACH_KEYS) {
    const def = REACH_DEFS[key];
    const cells = depths.map((d) => {
      const row = odds.find((r) => r.key === key && r.depth === d);
      return row === undefined ? "-" : `${(row.odds * 100).toFixed(1)}%`;
    });
    lines.push(`| ${def.name}（${key}） | ${def.affixes[0] ?? "-"} | ${def.format(def.threshold)} | ${cells.join(" | ")} |`);
  }
  return lines;
}

function buildBrokenTable(broken: readonly BrokenRow[]): string[] {
  const lines: string[] = [];
  lines.push("| 武器 | 深度 | 秒 | 1 step 平均 (ms) | 1 step p99 (ms) | 1 step 最大 (ms) | 自分の弾の最大 | スキルの弾の最大 | 設置物の置き場の最大 | 敵の最大 | 歯止めで切った数 | 捨てたイベント | 有限 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of broken) {
    lines.push(
      `| ${r.weapon === "gun" ? "銃" : "近接"} | ${r.depth} | ${r.seconds} | ${fixed(r.meanStepMs, 3)} | ${fixed(r.p99StepMs, 2)} | ${fixed(r.maxStepMs, 2)} | ${r.maxPlayerProjectiles} | ${r.maxShots} | ` +
        `${r.maxPlacedPerPool} | ${r.maxEnemies} | ${r.trimmed} | ${r.droppedEvents} | ${r.finite ? "○" : "×"} |`,
    );
  }
  return lines;
}

/** probe.md の節「## 深み」。3 つの表と目標 */
export function buildDeepSection(curve: readonly DeepCurveRow[], odds: readonly ReachOddsRow[], broken: readonly BrokenRow[]): string[] {
  const lines: string[] = [];
  lines.push("## 深み（深度 22 から。`npm run qa:probe -- --deep`）");
  lines.push("");
  lines.push("### 曲線: 地力 ÷ 敵の生命と、追い付くのに要る倍");
  lines.push("");
  lines.push(
    "深度相応の並の遺物 6 部位の近接 1 撃（会心なし）の伸びを敵の生命の伸び（`depthHpScale`）で割る。「要る倍」は深度 21 から追い付くのに相乗・研鑽で足さねばならない倍 = " +
      "(敵の生命の伸び ÷ 深度 21 の値) ÷ (地力の伸び ÷ 深度 21 の値)。「被弾で死ぬまで」は深度相応の装備（連打+ダッシュ）で前衛・槍・並 2 体に囲まれたときの最大生命 ÷ 1 被弾の平均ダメージ。" +
      "目標: 要る倍は深み 9 層（深度 30）で ×1.5〜2.5、19 層（深度 40）で ×3〜6。つまみは `ENEMY_SCALE.deepHpGrowth / deepDamageGrowth`。",
  );
  lines.push("");
  lines.push(...buildCurveTable(curve));
  lines.push("");
  lines.push("### 到達の届き方（主な性質を持つ遺物 2 つ。上振れの合計が閾値に届く割合）");
  lines.push("");
  lines.push(
    "`rollTableTrait`（反転なし）で深度 d の主な性質を 2 つ引いて足す。部位の制約・3 つ目の出所（転じ・名のある遺物・誓約）は数えない。目標: 深度 21 で 5% 未満、30 で 10〜40%、40 で 50% 以上。つまみは `REACH.chain / burn / morale`。",
  );
  lines.push("");
  lines.push(...buildOddsTable(odds));
  lines.push("");
  lines.push("### 壊れたビルドの重さ（3 つの到達 + 雷鳴・灰燼・眷属の全札 格 5 + 全ての研鑽の数え 2000、敵 30 体）");
  lines.push("");
  lines.push(
    "目標: 1 step 平均 1 ms 以下・最大 8 ms 以下、有限が全部 ○。「歯止めで切った数」が 0 でないなら `LIMITS.*` の値か原因の効果を見直す（`LIMITS` は強さの天井ではなく、通常のプレイでは届かない数）。",
  );
  lines.push("");
  lines.push(...buildBrokenTable(broken));
  lines.push("");
  return lines;
}

/** 表の目標から外れた行を文にする（報告の材料） */
export function deepOutliers(curve: readonly DeepCurveRow[], odds: readonly ReachOddsRow[], broken: readonly BrokenRow[]): string[] {
  const out: string[] = [];
  const at = (d: number): DeepCurveRow | undefined => curve.find((r) => r.depth === d);
  const c30 = at(30);
  if (c30 !== undefined && (c30.needMul < 1.5 || c30.needMul > 2.5)) out.push(`深度 30 の要る倍 ×${c30.needMul.toFixed(2)}（目標 1.5〜2.5）`);
  const c40 = at(40);
  if (c40 !== undefined && (c40.needMul < 3 || c40.needMul > 6)) out.push(`深度 40 の要る倍 ×${c40.needMul.toFixed(2)}（目標 3〜6）`);
  for (const r of odds) {
    const pct = r.odds * 100;
    if (r.depth === 21 && pct >= 5) out.push(`${r.key} 深度 21 の届き方 ${pct.toFixed(1)}%（目標 5% 未満）`);
    if (r.depth === 30 && (pct < 10 || pct > 40)) out.push(`${r.key} 深度 30 の届き方 ${pct.toFixed(1)}%（目標 10〜40%）`);
    if (r.depth === 40 && pct < 50) out.push(`${r.key} 深度 40 の届き方 ${pct.toFixed(1)}%（目標 50% 以上）`);
  }
  for (const b of broken) {
    if (b.meanStepMs > 1) out.push(`${b.weapon === "gun" ? "銃" : "近接"} 深度 ${b.depth} の壊れ 1 step 平均 ${b.meanStepMs.toFixed(2)} ms（目標 1 ms 以下）`);
    if (b.maxStepMs > 8) out.push(`${b.weapon === "gun" ? "銃" : "近接"} 深度 ${b.depth} の壊れ 1 step 最大 ${b.maxStepMs.toFixed(1)} ms（目標 8 ms 以下）`);
    if (b.droppedEvents > 0) out.push(`${b.weapon === "gun" ? "銃" : "近接"} 深度 ${b.depth} の壊れでイベントを ${b.droppedEvents} 件捨てた（連鎖の上限。壊れでは想定内か要確認）`);
    if (b.trimmed > 0) out.push(`${b.weapon === "gun" ? "銃" : "近接"} 深度 ${b.depth} の壊れで歯止めが ${b.trimmed} 件当たった`);
    if (!b.finite) out.push(`${b.weapon === "gun" ? "銃" : "近接"} 深度 ${b.depth} の壊れで数値が有限でなくなった`);
  }
  return out;
}
