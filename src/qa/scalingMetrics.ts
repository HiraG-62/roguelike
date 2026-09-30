import { type DamageBreakdown, dedupeMore, productMore } from "../core/damage";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { BOONS } from "../system/boonDefs";
import { DEPTH_BANDS, type DepthBand, depthBandOf, hurtTextDamage } from "./combatMetrics";

/**
 * 数式と文法の計測（docs/ideas/scaling-impl.md 4d・5 章）。state を読むだけで書き換えない。
 * フル QA（simulation.test.ts の runOnce）が 1 ランぶんを数え、report.md の節にする:
 * 深度帯ごとの撃破秒・被弾/60 秒・被弾で死ぬまでの回数、死亡時の与ダメの内訳（増の Σ・倍の Π・倍の出所数）、
 * 連鎖の深さの分布と捨てられたイベント、装備パターン別の到達深度と踏破率。
 */

/** 死亡時の内訳に使う直近の与ダメの数。1 戦闘ぶんの傾向が見える長さ */
export const DEATH_WINDOW_HITS = 30;

/** 踏破 = この深度に着いたこと（敵の曲線の深みの入り口。ENEMY_SCALE.deepDepth と同じ） */
export const CLEAR_DEPTH = 21;

/** 深度帯ごとの集計 */
export interface BandScaling {
  /** 観測した step 数 */
  steps: number;
  kills: number;
  /** 被弾（敵の攻撃を受けた回数。継続ダメージは含めない）の数と、そのダメージ合計 */
  hits: number;
  damage: number;
  /** 被弾のたびの最大 HP の合計（最大 HP の平均 = これ ÷ hits。最大 HP は階ごとに伸びるので被弾時点の値で数える） */
  maxHpAtHits: number;
}

/** 死亡時の与ダメの内訳（直近 DEATH_WINDOW_HITS 発の平均） */
export interface DeathDigest {
  depth: number;
  hits: number;
  /** Σ増の平均（0.5 = +50%） */
  increased: number;
  /** Π倍の平均 */
  more: number;
  /** 倍の出所数の平均 */
  sources: number;
  /** 死んだときに持っていた研鑽の札の枚数（深みまで来るビルドは研鑽を持っているか） */
  temperCards: number;
  /** 研鑽の数え（boonRun.tallies）の合計 */
  tallySum: number;
}

/** 研鑽の持ち物の要約（死亡時の内訳に足す） */
export interface TemperDigest {
  temperCards: number;
  tallySum: number;
}

/** 今の研鑽の札の枚数と数えの合計。state を読むだけ */
export function temperDigestOf(state: Readonly<GameState>): TemperDigest {
  const temperCards = state.boons.filter((k) => BOONS[k].card === "temper").length;
  const tallySum = Object.values(state.boonRun.tallies).reduce((s, n) => s + n, 0);
  return { temperCards, tallySum };
}

export interface ScalingTally {
  bands: Record<DepthBand, BandScaling>;
  /** 連鎖の深さのヒストグラム（添字 = Rule が成立したイベントの深さ。0 = 起点のイベントで成立） */
  chainDepths: number[];
  /** SYNERGY.maxEventsPerStep / maxPendingEvents で捨てられたイベントの数 */
  droppedEvents: number;
  /** 性能の歯止め（system/limits.ts）で消した弾・設置物の数（ruleRun.trimmed の増分。目標 0） */
  trimmed: number;
  death: DeathDigest | null;
}

function emptyBand(): BandScaling {
  return { steps: 0, kills: 0, hits: 0, damage: 0, maxHpAtHits: 0 };
}

export function emptyScalingTally(): ScalingTally {
  const bands = {} as Record<DepthBand, BandScaling>;
  for (const band of DEPTH_BANDS) bands[band] = emptyBand();
  return { bands, chainDepths: [], droppedEvents: 0, trimmed: 0, death: null };
}

export interface ScalingRecorder {
  readonly tally: ScalingTally;
  /** step の直前に呼ぶ */
  beforeStep(state: GameState): void;
  /** step の直後に呼ぶ */
  afterStep(state: GameState): void;
  /** プレイヤー由来の与ダメ 1 発の内訳（combat.rollOutgoing の結果） */
  noteOutgoing(breakdown: DamageBreakdown): void;
  /** Rule が成立して連鎖が記録された（meta/runRecord の noteChainRecord の深さ） */
  noteChain(depth: number): void;
  /** 死んだ瞬間に呼ぶ。直近の与ダメの内訳を平均して控える。temper は死亡時の研鑽の持ち物（省略は 0） */
  noteDeath(depth: number, temper?: TemperDigest): void;
}

/** 与ダメの内訳の平均（増の Σ・倍の Π・倍の出所数）。空なら null */
export function digestBreakdowns(depth: number, hits: readonly DamageBreakdown[], temper: TemperDigest = { temperCards: 0, tallySum: 0 }): DeathDigest | null {
  if (hits.length === 0) return null;
  let increased = 0;
  let more = 0;
  let sources = 0;
  for (const h of hits) {
    increased += h.increased;
    more += productMore(h.more);
    sources += dedupeMore(h.more).length;
  }
  const n = hits.length;
  return { depth, hits: n, increased: increased / n, more: more / n, sources: sources / n, ...temper };
}

export function createScalingRecorder(): ScalingRecorder {
  const tally = emptyScalingTally();
  const recent: DamageBreakdown[] = [];
  const seenTexts = new WeakSet<object>();
  let killsBefore = 0;
  let droppedBefore = 0;
  let trimmedBefore = 0;
  return {
    tally,
    beforeStep(state) {
      killsBefore = state.kills;
      droppedBefore = state.ruleRun.droppedEvents;
      trimmedBefore = state.ruleRun.trimmed;
    },
    afterStep(state) {
      const band = tally.bands[depthBandOf(state.depth)];
      band.steps++;
      band.kills += Math.max(0, state.kills - killsBefore);
      for (const t of state.texts) {
        if (seenTexts.has(t)) continue;
        seenTexts.add(t);
        const hurt = hurtTextDamage(t);
        if (hurt === null) continue;
        band.hits++;
        band.damage += hurt;
        band.maxHpAtHits += state.player.maxHp;
      }
      tally.droppedEvents += Math.max(0, state.ruleRun.droppedEvents - droppedBefore);
      tally.trimmed += Math.max(0, state.ruleRun.trimmed - trimmedBefore);
    },
    noteOutgoing(breakdown) {
      recent.push(breakdown);
      if (recent.length > DEATH_WINDOW_HITS) recent.shift();
    },
    noteChain(depth) {
      const d = Math.max(0, Math.floor(depth));
      while (tally.chainDepths.length <= d) tally.chainDepths.push(0);
      tally.chainDepths[d] = (tally.chainDepths[d] ?? 0) + 1;
    },
    noteDeath(depth, temper) {
      tally.death = digestBreakdowns(depth, recent, temper);
    },
  };
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

const SECONDS_PER_MINUTE = 60;

function percentOf(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-";
}

function fixedOrDash(n: number | null, digits: number): string {
  return n === null ? "-" : n.toFixed(digits);
}

function mergeBands(tallies: readonly ScalingTally[]): Record<DepthBand, BandScaling> {
  const out = emptyScalingTally().bands;
  for (const t of tallies) {
    for (const band of DEPTH_BANDS) {
      const from = t.bands[band];
      const to = out[band];
      to.steps += from.steps;
      to.kills += from.kills;
      to.hits += from.hits;
      to.damage += from.damage;
      to.maxHpAtHits += from.maxHpAtHits;
    }
  }
  return out;
}

/** 帯の指標。観測が無い値は null（表では「-」） */
export interface BandScalingMetrics {
  minutes: number;
  secondsPerKill: number | null;
  hitsPer60: number | null;
  damagePerHit: number | null;
  /** 最大 HP ÷ 平均被ダメ = 被弾で死ぬまでの回数 */
  hitsToDie: number | null;
}

export function bandScalingMetrics(b: BandScaling): BandScalingMetrics {
  const seconds = b.steps * FIXED_DT;
  return {
    minutes: seconds / SECONDS_PER_MINUTE,
    secondsPerKill: b.kills > 0 ? seconds / b.kills : null,
    hitsPer60: seconds > 0 ? (b.hits / seconds) * SECONDS_PER_MINUTE : null,
    damagePerHit: b.hits > 0 ? b.damage / b.hits : null,
    hitsToDie: b.damage > 0 ? b.maxHpAtHits / b.damage : null,
  };
}

/** 帯ごとの撃破秒・被弾/60 秒・被弾で死ぬまでの回数 */
function buildBandTable(tallies: readonly ScalingTally[]): string[] {
  const merged = mergeBands(tallies);
  const lines: string[] = [];
  lines.push("| 深度帯 | 観測時間(分) | 撃破 | 撃破秒 | 被弾/60秒 | 被ダメ/被弾 | 被弾で死ぬまで |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const band of DEPTH_BANDS) {
    const b = merged[band];
    const m = bandScalingMetrics(b);
    lines.push(
      `| ${band} | ${m.minutes.toFixed(1)} | ${b.kills} | ${fixedOrDash(m.secondsPerKill, 2)} | ${fixedOrDash(m.hitsPer60, 1)} | ` +
        `${fixedOrDash(m.damagePerHit, 1)} | ${fixedOrDash(m.hitsToDie, 1)} |`,
    );
  }
  return lines;
}

/** 死亡時の与ダメの内訳を、死んだ帯ごとに平均する */
function buildDeathDigestTable(tallies: readonly ScalingTally[]): string[] {
  const lines: string[] = [];
  lines.push("| 死んだ深度帯 | 死亡数 | Σ増 | Π倍 | 倍の出所数 | 研鑽の札 | 研鑽の数え |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const band of DEPTH_BANDS) {
    const digests = tallies.flatMap((t) => (t.death !== null && depthBandOf(t.death.depth) === band ? [t.death] : []));
    if (digests.length === 0) {
      lines.push(`| ${band} | 0 | - | - | - | - | - |`);
      continue;
    }
    const mean = (pick: (d: DeathDigest) => number): number => digests.reduce((s, d) => s + pick(d), 0) / digests.length;
    lines.push(
      `| ${band} | ${digests.length} | +${(mean((d) => d.increased) * 100).toFixed(0)}% | ×${mean((d) => d.more).toFixed(2)} | ${mean((d) => d.sources).toFixed(1)} | ` +
        `${mean((d) => d.temperCards).toFixed(1)} | ${mean((d) => d.tallySum).toFixed(0)} |`,
    );
  }
  return lines;
}

/** 連鎖の深さのヒストグラム表 */
function buildChainTable(tallies: readonly ScalingTally[]): string[] {
  const hist: number[] = [];
  for (const t of tallies) {
    t.chainDepths.forEach((n, depth) => {
      while (hist.length <= depth) hist.push(0);
      hist[depth] = (hist[depth] ?? 0) + n;
    });
  }
  const total = hist.reduce((s, n) => s + n, 0);
  const lines: string[] = [];
  if (total === 0) {
    lines.push("連鎖は記録されなかった。");
    return lines;
  }
  const meanDepth = hist.reduce((s, n, depth) => s + n * depth, 0) / total;
  lines.push(`連鎖の記録 ${total} 件、平均の深さ ${meanDepth.toFixed(2)}（0 = 起点のイベントで成立）`);
  lines.push("");
  lines.push("| 深さ | 件数 | 割合 |");
  lines.push("| --- | --- | --- |");
  hist.forEach((n, depth) => {
    lines.push(`| ${depth} | ${n} | ${percentOf(n, total)} |`);
  });
  return lines;
}

/**
 * report.md の節: 深度帯ごとの被弾と撃破、死亡時の与ダメの内訳、連鎖の深さの分布と捨てられたイベント。
 * title と note は呼び出し側（通常のラン / 深く始めるラン）で変える
 */
export function buildScalingSection(title: string, note: string, tallies: readonly ScalingTally[]): string[] {
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(note);
  lines.push("");
  lines.push(...buildBandTable(tallies));
  lines.push("");
  lines.push("### 死亡時の与ダメの内訳（死ぬ直前の与ダメ 30 発の平均。`OutgoingHit.breakdown`）");
  lines.push("");
  lines.push(...buildDeathDigestTable(tallies));
  lines.push("");
  lines.push("### 連鎖の深さ（Rule が成立したイベントの深さ。`SYNERGY.maxDepth` の手前で止まるか）");
  lines.push("");
  lines.push(...buildChainTable(tallies));
  lines.push("");
  const dropped = tallies.reduce((s, t) => s + t.droppedEvents, 0);
  const runsWithDrops = tallies.filter((t) => t.droppedEvents > 0).length;
  lines.push(`捨てられたイベント（\`ruleRun.droppedEvents\`）: ${dropped} 件（${runsWithDrops} / ${tallies.length} ラン。目標 0）`);
  const trimmed = tallies.reduce((s, t) => s + t.trimmed, 0);
  lines.push(`性能の歯止めで消した数（\`ruleRun.trimmed\`）: ${trimmed}（目標 0）`);
  lines.push("");
  return lines;
}

// ---------------------------------------------------------------------------
// 到達深度・踏破率
// ---------------------------------------------------------------------------

/** 1 ランの到達（グループ分けの label は装備パターンなど） */
export interface ReachRecord {
  label: string;
  maxDepth: number;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** 装備パターン別の到達深度の中央値と踏破率（深度 CLEAR_DEPTH に着いた割合） */
export function buildReachSection(title: string, labels: readonly string[], records: readonly ReachRecord[]): string[] {
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`踏破率 = 深度 ${CLEAR_DEPTH} に着いたランの割合。目標は標準ビルドで 5〜10%、到達深度の中央値 12〜15（bot は人より弱いので低めに出る）。`);
  lines.push("");
  lines.push("| 装備 | ラン数 | 到達深度 中央値 | 最大 | 踏破率 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const label of labels) {
    const depths = records.filter((r) => r.label === label).map((r) => r.maxDepth);
    if (depths.length === 0) continue;
    const cleared = depths.filter((d) => d >= CLEAR_DEPTH).length;
    lines.push(`| ${label} | ${depths.length} | ${fixedOrDash(median(depths), 1)} | ${Math.max(...depths)} | ${percentOf(cleared, depths.length)} |`);
  }
  lines.push("");
  return lines;
}
