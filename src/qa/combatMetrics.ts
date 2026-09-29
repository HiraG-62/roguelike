import type { EnemyPhase, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { FIXED_DT } from "../core/loop";
import { isBossDriven } from "../system/boss";

/**
 * 戦闘の核を変える前の基準を測る純粋な計測部品（docs/ideas/core-synthesis.md 9 章）。
 * state を読むだけで書き換えない。フル QA（simulation.test.ts の runOnce）と
 * 1 対 1 / 集団の計測（combatProbe.ts）が同じ数え方を共有する。
 */

/** 深度帯。深度 6 以降は観測が少ないので、帯を分けて数の薄さが見えるようにする */
export const DEPTH_BANDS = ["1-2", "3-5", "6+"] as const;
export type DepthBand = (typeof DEPTH_BANDS)[number];

const BAND_MID_MIN_DEPTH = 3;
const BAND_DEEP_MIN_DEPTH = 6;

export function depthBandOf(depth: number): DepthBand {
  if (depth >= BAND_DEEP_MIN_DEPTH) return "6+";
  if (depth >= BAND_MID_MIN_DEPTH) return "3-5";
  return "1-2";
}

/** bot.ts の NON_ENGAGEABLE_PHASES と同じ意図（idle / spawning は交戦相手に数えない） */
const NON_ENGAGEABLE: ReadonlySet<EnemyPhase> = new Set(["idle", "spawning"]);

/** 交戦中（idle / spawning ではない）の生きた敵の数 */
export function countEngagedEnemies(state: GameState): number {
  let n = 0;
  for (const e of state.enemies) if (e.hp > 0 && !NON_ENGAGEABLE.has(e.phase)) n++;
  return n;
}

/** 同時攻撃の上限を見るときに遡る秒。上限は周りの敵の数で動くので、倒して上限が下がった直後の超過は違反にしない */
const STRIKER_CAP_WINDOW_SECONDS = 1;

export interface StrikerCapWatcher {
  /** 1 step ごとに、その時点の上限と攻撃中の非ボス数を渡す。直近の上限の最大を超えた数（0 以上）を返す */
  observe(cap: number, strikers: number): number;
}

/**
 * 同時攻撃の上限（system/enemies.ts の strikerCap）を守れているかの見張り。
 * 上限は攻撃の開始の瞬間に判定されるが、その後に周りの敵が倒れて上限が下がることがある。
 * 直近 STRIKER_CAP_WINDOW_SECONDS の上限の最大と比べれば、開始時の判定を取りこぼさずに済む
 */
export function createStrikerCapWatcher(dt: number): StrikerCapWatcher {
  const windowSteps = Math.max(1, Math.round(STRIKER_CAP_WINDOW_SECONDS / dt));
  const recent: number[] = [];
  return {
    observe(cap, strikers) {
      recent.push(cap);
      if (recent.length > windowSteps) recent.shift();
      return Math.max(0, strikers - Math.max(...recent));
    },
  };
}

/** 深度帯ごとの集計 */
export interface CombatBandTally {
  /** 観測した step 数（ヒットストップで止まった step も含む） */
  steps: number;
  /** その step の直前に state.hitstop > 0 だった数（その step の世界は止まっている） */
  hitstopSteps: number;
  /** 非ボスの敵が予備動作に入った回数 */
  windups: number;
  /** 予備動作が最後まで進んで攻撃（strike か、strike を経ず隙へ直接進むもの）に至った回数 */
  strikes: number;
  /** 交戦中の敵が 1 体以上いた step 数 */
  engagedSteps: number;
  /** 交戦の長さ（秒）。交戦中の敵が 1 体以上の連続区間を 1 回とする */
  engagementSeconds: number[];
}

export type CombatTally = Record<DepthBand, CombatBandTally>;

function emptyBandTally(): CombatBandTally {
  return { steps: 0, hitstopSteps: 0, windups: 0, strikes: 0, engagedSteps: 0, engagementSeconds: [] };
}

export function emptyCombatTally(): CombatTally {
  return { "1-2": emptyBandTally(), "3-5": emptyBandTally(), "6+": emptyBandTally() };
}

/** 全帯を足した 1 つの集計。engagementSeconds は連結する */
export function mergeCombatTallies(tallies: readonly CombatTally[]): CombatTally {
  const out = emptyCombatTally();
  for (const t of tallies) {
    for (const band of DEPTH_BANDS) {
      const from = t[band];
      const to = out[band];
      to.steps += from.steps;
      to.hitstopSteps += from.hitstopSteps;
      to.windups += from.windups;
      to.strikes += from.strikes;
      to.engagedSteps += from.engagedSteps;
      for (const s of from.engagementSeconds) to.engagementSeconds.push(s);
    }
  }
  return out;
}

export function sumBands(tally: CombatTally): CombatBandTally {
  const out = emptyBandTally();
  for (const band of DEPTH_BANDS) {
    const b = tally[band];
    out.steps += b.steps;
    out.hitstopSteps += b.hitstopSteps;
    out.windups += b.windups;
    out.strikes += b.strikes;
    out.engagedSteps += b.engagedSteps;
    for (const s of b.engagementSeconds) out.engagementSeconds.push(s);
  }
  return out;
}

export interface CombatRecorder {
  readonly tally: CombatTally;
  /** step の直前に呼ぶ。この step がヒットストップで止まるかを控える */
  beforeStep(state: GameState): void;
  /** step の直後に呼ぶ。位相の遷移と交戦の区間を数える */
  afterStep(state: GameState, dt: number): void;
  /** 交戦中のまま終わった区間を閉じる（ラン終了時） */
  finish(): void;
}

/**
 * 位相の遷移で予備動作 → 攻撃の完遂を数える。ボス（isBossDriven）は固有の動きなので除く。
 * 予備動作が状態異常（怯み・恐怖・沈黙）で取り消されると追跡（chase）へ戻るので、完遂に数えない。
 * 1 step の中で strike を経て隙まで進む敵（弾を撃つ・爆弾を投げるなど）もいるため、
 * windup から strike / recover のどちらへ進んでも完遂とする
 */
export function createCombatRecorder(): CombatRecorder {
  const tally = emptyCombatTally();
  let prevPhase = new Map<number, EnemyPhase>();
  let frozen = false;
  let lastDt = 0;
  let engagementSteps = 0;
  let engagementBand: DepthBand | null = null;

  function closeEngagement(dt: number): void {
    if (engagementBand === null) return;
    tally[engagementBand].engagementSeconds.push(engagementSteps * dt);
    engagementBand = null;
    engagementSteps = 0;
  }

  function observePhases(state: GameState, band: CombatBandTally): void {
    const next = new Map<number, EnemyPhase>();
    for (const e of state.enemies) {
      if (e.hp <= 0 || isBossDriven(enemyDef(e.defKey))) continue;
      const before = prevPhase.get(e.id);
      if (e.phase === "windup" && before !== "windup") band.windups++;
      else if (before === "windup" && (e.phase === "strike" || e.phase === "recover")) band.strikes++;
      next.set(e.id, e.phase);
    }
    prevPhase = next;
  }

  function observeEngagement(state: GameState, depthBand: DepthBand, dt: number): void {
    const engaged = countEngagedEnemies(state) >= 1;
    if (!engaged) {
      closeEngagement(dt);
      return;
    }
    // 階をまたいだら別の交戦として数える（帯が変わるときに長さを正しい帯へ入れるため）
    if (engagementBand !== null && engagementBand !== depthBand) closeEngagement(dt);
    engagementBand = depthBand;
    engagementSteps++;
    tally[depthBand].engagedSteps++;
  }

  return {
    tally,
    beforeStep(state) {
      frozen = state.hitstop > 0;
    },
    afterStep(state, dt) {
      lastDt = dt;
      const depthBand = depthBandOf(state.depth);
      const band = tally[depthBand];
      band.steps++;
      if (frozen) band.hitstopSteps++;
      observePhases(state, band);
      observeEngagement(state, depthBand, dt);
    },
    finish() {
      closeEngagement(lastDt);
    },
  };
}

/** 交戦の長さの要約（秒） */
export interface EngagementSummary {
  count: number;
  mean: number;
  median: number;
  max: number;
}

export function summarizeEngagements(seconds: readonly number[]): EngagementSummary {
  if (seconds.length === 0) return { count: 0, mean: 0, median: 0, max: 0 };
  const sorted = [...seconds].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { count: sorted.length, mean: sum / sorted.length, median, max: sorted[sorted.length - 1] ?? 0 };
}

// ---------------------------------------------------------------------------
// フル QA（simulation.test.ts）の表
// ---------------------------------------------------------------------------

function percentOf(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-";
}

function seconds1(n: number): string {
  return n.toFixed(1);
}

/**
 * 戦闘の基準の表（深度帯別 + 全体）。予備動作の完遂率・ヒットストップで止まった割合・
 * 交戦の回数と長さ・交戦中 / 非交戦の時間配分。深度 6 以降は観測が少ないので、観測時間を列に出して薄さが見えるようにする
 */
export function buildCombatSection(tallies: readonly CombatTally[]): string[] {
  const merged = mergeCombatTallies(tallies);
  const lines: string[] = [];
  lines.push("## 戦闘の基準（予備動作の完遂・ヒットストップ・交戦の長さ・時間配分。深度帯別）");
  lines.push("");
  lines.push(
    "- 完遂率 = 非ボスの敵の予備動作のうち、最後まで進んで攻撃（strike か、strike を経ず隙へ進むもの）に至った割合。怯み・恐怖・沈黙で取り消されたもの・倒されたものは入らない",
  );
  lines.push("- ヒットストップ = その step の直前に `state.hitstop > 0` で世界が止まっていた step の割合");
  lines.push(
    "- 交戦 = `countEngagedEnemies`（idle / spawning を除く生きた敵）が 1 体以上の連続区間。遠くから追ってくる間も含む。交戦中 / 非交戦は観測時間に対する割合",
  );
  lines.push("");
  lines.push("| 深度帯 | 観測時間(分) | 予備動作 | 攻撃への完遂 | 完遂率 | ヒットストップ | 交戦回数 | 交戦 平均秒 | 交戦 中央値秒 | 交戦 最大秒 | 交戦中 | 非交戦（移動・探索） |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const rows: [string, CombatBandTally][] = DEPTH_BANDS.map((band) => [band, merged[band]]);
  rows.push(["全体", sumBands(merged)]);
  for (const [label, b] of rows) {
    const eng = summarizeEngagements(b.engagementSeconds);
    lines.push(
      `| ${label} | ${(b.steps * FIXED_DT / 60).toFixed(1)} | ${b.windups} | ${b.strikes} | ${percentOf(b.strikes, b.windups)} | ` +
        `${percentOf(b.hitstopSteps, b.steps)} | ${eng.count} | ${seconds1(eng.mean)} | ${seconds1(eng.median)} | ${seconds1(eng.max)} | ` +
        `${percentOf(b.engagedSteps, b.steps)} | ${percentOf(b.steps - b.engagedSteps, b.steps)} |`,
    );
  }
  lines.push("");
  return lines;
}

/** 死亡 1 件（死んだ深度と推測した死因） */
export interface DeathRecord {
  depth: number;
  cause: string;
}

/** 深度帯別の死因の表。帯ごとに死因を件数の多い順に並べる */
export function buildDeathCauseByBandSection(deaths: readonly DeathRecord[]): string[] {
  const lines: string[] = [];
  lines.push("## 死因（深度帯別）");
  lines.push("");
  if (deaths.length === 0) {
    lines.push("死亡した run が無かった。");
    lines.push("");
    return lines;
  }
  lines.push("| 深度帯 | 死亡数 | 死因（件数） |");
  lines.push("| --- | --- | --- |");
  for (const band of DEPTH_BANDS) {
    const inBand = deaths.filter((d) => depthBandOf(d.depth) === band);
    const counts = new Map<string, number>();
    for (const d of inBand) counts.set(d.cause, (counts.get(d.cause) ?? 0) + 1);
    const causes = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    lines.push(`| ${band} | ${inBand.length} | ${causes.map(([cause, n]) => `${cause}×${n}`).join(", ") || "-"} |`);
  }
  lines.push("");
  return lines;
}
