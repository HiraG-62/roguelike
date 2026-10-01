import type { HurtKind } from "../core/hurt";
import type { BossRecord, GameState } from "../core/state";
import { BOSS } from "../data/tuning";
import { BOSS_THREATS, type DistBand, type ThreatBand, distBand } from "../system/bossKit";

/**
 * ボスの戦いの計測（docs/ideas/boss-impl.md 5 章）。純粋な集計と表づくりだけで、ゲームを動かさない。
 * ボス 1 戦の生の数は qa/bossProbe.ts（1 体ずつ測る）と、フル QA の `state.bossLog`（ラン終わりに集める）が作り、
 * ここで中央値・割合・相関にして Markdown の表にする
 */

/** 段階の数（章ボス 4 と最深の主は 3 段階） */
export const BOSS_STAGE_COUNT = 3;

/** 計測の目標（5 章の表。撃破の秒の幅 / 被弾の幅 / ダウンの下限 / 行為で進む段階の割合の幅） */
export interface BossTarget {
  readonly seconds: readonly [number, number];
}

export const BOSS_TARGETS: Readonly<Record<string, BossTarget>> = {
  kingSlime: { seconds: [40, 90] },
  thiefKing: { seconds: [60, 120] },
  oilKing: { seconds: [60, 120] },
  mirrorKnight: { seconds: [80, 150] },
  deepLord: { seconds: [120, 200] },
};
export const HITS_TARGET: readonly [number, number] = [3, 8];
export const DOWNS_TARGET_MIN = 2;
export const ACT_SHARE_TARGET: readonly [number, number] = [0.3, 0.6];
/** 段階の長さの狙い（最深の主: 四門 3 : 陥没 4 : 第三の顔 3） */
export const DEEP_LORD_STAGE_RATIO: readonly number[] = [0.3, 0.4, 0.3];
/** 段階の長さの比の許容（狙いの割合との差）。四門で詰まらないかを見る目安 */
export const STAGE_RATIO_TOLERANCE = 0.12;
/** 踏破率の目標（標準の bot でラン全体に対する最深の主の撃破割合） */
export const CLEAR_RATE_TARGET: readonly [number, number] = [0.05, 0.15];
/** 間合いの目標: 危ない間合いに合う被弾がこの割合以上（moving は地形・影・柵の被弾がこの割合以上） */
export const THREAT_SHARE_MIN: Readonly<Record<ThreatBand, number>> = { near: 0.5, far: 0.5, still: 0.5, moving: 0.4 };
/** 被弾の数がこれ未満の段階は割合が揺れるので、目標に合わなくても印を付けない */
export const MIN_HITS_FOR_SHARE = 5;
/** ボス戦の死は全死亡の何割か（章ボスが関門になり、壁にならない） */
export const BOSS_DEATH_SHARE_TARGET: readonly [number, number] = [0.2, 0.3];

/** 間接の被弾（地形・影・柵・余波・状態異常）。敵の身体や弾が直接当たる strike / shot と、死神の被弾は含めない */
const INDIRECT_HURT_KINDS: ReadonlySet<HurtKind> = new Set<HurtKind>(["hazard", "terrain", "blast", "fall", "status", "linger", "deferred"]);

export function isIndirectHurt(kind: HurtKind | undefined): boolean {
  return kind !== undefined && INDIRECT_HURT_KINDS.has(kind);
}

/** 1 段階の被弾を間合い・静止・出どころで数えた生の数 */
export interface StageHitTally {
  hits: number;
  near: number;
  mid: number;
  far: number;
  /** ボスが「止まっている相手」と読んでいる間（stillSec 以上）の被弾 */
  still: number;
  /** 地形・影・柵などからの被弾 */
  indirect: number;
}

export function emptyStageHits(): StageHitTally {
  return { hits: 0, near: 0, mid: 0, far: 0, still: 0, indirect: 0 };
}

/** 被弾 1 回を数える。distance はプレイヤーとボスの距離（px）、playerStillSec はボスが読んだ静止の秒 */
export function noteStageHit(t: StageHitTally, distance: number, playerStillSec: number, indirect: boolean): void {
  t.hits++;
  const band: DistBand = distBand(distance);
  t[band]++;
  if (playerStillSec >= BOSS.rules.stillSec) t.still++;
  if (indirect) t.indirect++;
}

/** 段階が 1 つ進んだ記録（from = 進む前の段階）。byAct = 生命の閾値より上で進んだ（= 行為で進んだ） */
export interface StageTransition {
  from: number;
  byAct: boolean;
}

/** 行為で進むとき「生命がこれより上」で進んだとみなす閾値（-1 = 生命に関係なく行為だけで進む） */
const ALWAYS_ACT = -1;

/**
 * 段階 s → s+1 が生命の閾値（この割合以下）で進むときの閾値。生命がそれより上で進んでいたら行為で進んだと読む
 * （分裂体が消える・追い詰め・引火・壁激突・門柱。ボスのファイルの phaseNRatio と同じ値）
 */
const STAGE_HP_THRESHOLDS: Readonly<Record<string, readonly [number, number]>> = {
  kingSlime: [BOSS.kingSlime.phase2Ratio, BOSS.kingSlime.phase3Ratio],
  thiefKing: [BOSS.thiefKing.phase2Ratio, BOSS.thiefKing.phase3Ratio],
  oilKing: [BOSS.oilKing.phase2Ratio, BOSS.oilKing.phase3Ratio],
  mirrorKnight: [BOSS.mirrorKnight.phase2Ratio, BOSS.mirrorKnight.phase3Ratio],
  deepLord: [ALWAYS_ACT, BOSS.deepLord.phase3Ratio],
};

/** 段階が進んだ瞬間の生命の割合（進んだ step の後）から、行為で進んだかを決める。閾値の無いボスは null */
export function stageAdvancedByAct(key: string, from: number, hpRatio: number): boolean | null {
  const thresholds = STAGE_HP_THRESHOLDS[key];
  const threshold = thresholds?.[from - 1];
  if (threshold === undefined) return null;
  return hpRatio > threshold;
}

export type BossOutcome = "defeated" | "died" | "timeout" | "unlocked";

/** ボス 1 戦の生の数（qa/bossProbe.ts の 1 本 = 1 seed） */
export interface BossFight {
  key: string;
  depth: number;
  seed: number;
  outcome: BossOutcome;
  /** 封鎖から決着（撃破・死亡・打ち切り）までの秒 */
  seconds: number;
  hits: number;
  downs: number;
  /** 段階ごとの秒（index 0 = 第 1 段階） */
  stageSeconds: number[];
  stageHits: StageHitTally[];
  transitions: StageTransition[];
  /** 戦いの間に倒した取り巻きの数（ボス本人を除く） */
  minionKills: number;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? hi) + hi) / 2;
}

/** ピアソンの相関係数。3 組未満・どちらかが一定なら null */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = ys.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// -----------------------------------------------------------------------------
// 表の部品
// -----------------------------------------------------------------------------

function fmt(n: number | null, digits = 1): string {
  return n === null || !Number.isFinite(n) ? "-" : n.toFixed(digits);
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "-" : `${((part / whole) * 100).toFixed(0)}%`;
}

function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** 目標の幅に入っていなければ * を付ける（値が無いときは付けない） */
function flag(value: number | null, [lo, hi]: readonly [number, number]): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const text = fmt(value);
  return value < lo || value > hi ? `${text}*` : text;
}

function rangeText([lo, hi]: readonly [number, number]): string {
  return `${lo}〜${hi}`;
}

const THREAT_LABEL: Readonly<Record<ThreatBand, string>> = { near: "近い", far: "遠い", moving: "動く", still: "静止" };

/** 表に出すボスの並び（章 1 → 4 → 最深）。bossLog に他のボスがいれば後ろに足す */
const BOSS_ORDER: readonly string[] = ["kingSlime", "thiefKing", "oilKing", "mirrorKnight", "deepLord"];

function orderedKeys(keys: Iterable<string>): string[] {
  const seen = new Set(keys);
  const head = BOSS_ORDER.filter((k) => seen.has(k));
  const rest = [...seen].filter((k) => !BOSS_ORDER.includes(k)).sort();
  return [...head, ...rest];
}

// -----------------------------------------------------------------------------
// フル QA: ラン終わりの bossLog
// -----------------------------------------------------------------------------

/** ラン 1 本ぶんのボスの記録（撃破は bossLog、ボス戦で倒れた 1 件は diedIn） */
export interface BossRunTally {
  records: BossRecord[];
  diedIn: { key: string; depth: number; seconds: number; hits: number }[];
}

export function emptyBossRun(): BossRunTally {
  return { records: [], diedIn: [] };
}

/** ラン終わりに 1 回呼ぶ: bossLog を写し、ボスの封鎖中に力尽きていればその戦いを 1 件積む */
export function recordBossRun(t: BossRunTally, state: GameState): void {
  for (const r of state.bossLog) t.records.push({ ...r });
  const b = state.boss;
  if (state.status !== "dead" || !b || !b.major || b.defeated || b.lockedAt === undefined) return;
  const e = state.enemies.find((o) => o.id === b.enemyId);
  t.diedIn.push({ key: e?.defKey ?? "unknown", depth: state.depth, seconds: Math.max(0, state.time - b.lockedAt), hits: b.hits ?? 0 });
}

export interface BossLogSummary {
  key: string;
  fights: number;
  defeats: number;
  deaths: number;
  secondsMedian: number | null;
  hitsMedian: number | null;
  downsMedian: number | null;
}

export function summarizeBossLog(tallies: readonly BossRunTally[]): BossLogSummary[] {
  const records = tallies.flatMap((t) => t.records);
  const deaths = tallies.flatMap((t) => t.diedIn);
  return orderedKeys([...records.map((r) => r.key), ...deaths.map((d) => d.key)]).map((key) => {
    const won = records.filter((r) => r.key === key);
    return {
      key,
      fights: won.length + deaths.filter((d) => d.key === key).length,
      defeats: won.length,
      deaths: deaths.filter((d) => d.key === key).length,
      secondsMedian: median(won.map((r) => r.seconds)),
      hitsMedian: median(won.map((r) => r.hits)),
      downsMedian: median(won.map((r) => r.downs)),
    };
  });
}

/**
 * フル QA の report.md の「## ボス」節。runs = ラン本数、runDeaths = 力尽きたラン数。
 * 撃破の秒・被弾・ダウンは撃破できた戦いの中央値（ダウンだけ目標の下限未満に * を付ける。秒・被弾の目標は probe.md の「## ボス」と比べる）
 */
export function buildBossLogSection(tallies: readonly BossRunTally[], runs: number, runDeaths: number): string[] {
  const lines = ["## ボス（bossLog。撃破 = 封鎖から撃破までの秒・封鎖中の被弾・ダウン。docs/ideas/boss-impl.md 5 章）", ""];
  const summary = summarizeBossLog(tallies);
  if (summary.length === 0) {
    lines.push("ボス戦は 1 度も起きなかった。", "");
    return lines;
  }
  lines.push("| ボス | 戦闘 | 撃破 | 死亡 | 撃破の秒（中央値） | 被弾（中央値） | ダウン（中央値） |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of summary) {
    const downs = s.downsMedian !== null && s.downsMedian < DOWNS_TARGET_MIN ? `${fmt(s.downsMedian)}*` : fmt(s.downsMedian);
    lines.push(`| ${s.key} | ${s.fights} | ${s.defeats} | ${s.deaths} | ${fmt(s.secondsMedian)} | ${fmt(s.hitsMedian)} | ${downs} |`);
  }
  lines.push("");
  const bossDeaths = tallies.reduce((n, t) => n + t.diedIn.length, 0);
  const deepDefeats = tallies.reduce((n, t) => n + t.records.filter((r) => r.key === "deepLord").length, 0);
  lines.push(`- ボス戦で死んだラン（参考）: ${bossDeaths} / 死亡したラン ${runDeaths}（${pct(bossDeaths, runDeaths)}）`);
  lines.push(`- 踏破率（最深の主を倒したラン）: ${deepDefeats} / ${runs}（${pct(deepDefeats, runs)}。標準の bot の目標 ${rangeText([5, 15])}%）`);
  lines.push(
    "- フル QA の装備は itemLevel 20 固定（simulation.test.ts の buildProfile）で、章ボスの階では深度相応の 3〜4 倍の火力。撃破の秒・被弾を目標と比べるのは probe.md「## ボス」",
    "- `*` はダウンが目標の下限未満。ダウンは怯み + 自傷のダウンの回数",
    "",
  );
  return lines;
}

// -----------------------------------------------------------------------------
// probe: 1 体ずつ測った BossFight
// -----------------------------------------------------------------------------

export interface BossFightSummary {
  key: string;
  fights: number;
  defeats: number;
  deaths: number;
  timeouts: number;
  secondsMedian: number | null;
  hitsMedian: number | null;
  downsMedian: number | null;
  /** 段階が進んだ回数と、そのうち行為で進んだ回数 */
  transitions: number;
  actTransitions: number;
  /** 取り巻きを倒した数と撃破の秒の相関（撃破できた戦いだけ。3 戦未満・一定なら null） */
  minionCorrelation: number | null;
  /** 段階ごとの秒の合計・被弾の合計 */
  stageSeconds: number[];
  stageHits: StageHitTally[];
}

export function summarizeFights(fights: readonly BossFight[]): BossFightSummary[] {
  const valid = fights.filter((f) => f.outcome !== "unlocked");
  return orderedKeys(valid.map((f) => f.key)).map((key) => {
    const own = valid.filter((f) => f.key === key);
    const won = own.filter((f) => f.outcome === "defeated");
    const stageSeconds = Array<number>(BOSS_STAGE_COUNT).fill(0);
    const stageHits = Array.from({ length: BOSS_STAGE_COUNT }, emptyStageHits);
    for (const f of own) {
      for (let i = 0; i < BOSS_STAGE_COUNT; i++) {
        stageSeconds[i] = (stageSeconds[i] ?? 0) + (f.stageSeconds[i] ?? 0);
        const from = f.stageHits[i];
        const into = stageHits[i];
        if (!from || !into) continue;
        into.hits += from.hits;
        into.near += from.near;
        into.mid += from.mid;
        into.far += from.far;
        into.still += from.still;
        into.indirect += from.indirect;
      }
    }
    const transitions = own.flatMap((f) => f.transitions);
    return {
      key,
      fights: own.length,
      defeats: won.length,
      deaths: own.filter((f) => f.outcome === "died").length,
      timeouts: own.filter((f) => f.outcome === "timeout").length,
      secondsMedian: median(won.map((f) => f.seconds)),
      hitsMedian: median(own.map((f) => f.hits)),
      downsMedian: median(own.map((f) => f.downs)),
      transitions: transitions.length,
      actTransitions: transitions.filter((t) => t.byAct).length,
      minionCorrelation: pearson(
        won.map((f) => f.minionKills),
        won.map((f) => f.seconds),
      ),
      stageSeconds,
      stageHits,
    };
  });
}

/** 段階の危ない間合いに合う被弾の割合（near は近い / far は遠い / still は静止中 / moving は地形・影・柵） */
export function threatShare(t: StageHitTally, band: ThreatBand): number | null {
  switch (band) {
    case "near":
      return share(t.near, t.hits);
    case "far":
      return share(t.far, t.hits);
    case "still":
      return share(t.still, t.hits);
    case "moving":
      return share(t.indirect, t.hits);
  }
}

/** 段階の被弾が目標の割合を下回るか（被弾が少ない段階は判定しない） */
export function missesThreat(t: StageHitTally, band: ThreatBand): boolean {
  if (t.hits < MIN_HITS_FOR_SHARE) return false;
  const s = threatShare(t, band);
  return s !== null && s < THREAT_SHARE_MIN[band];
}

function shareText(part: number, whole: number): string {
  return whole === 0 ? "-" : pct(part, whole);
}

/** 行為で進んだ段階の割合（段階が進んだ回数が 0 なら -）。目標の幅の外は * */
function actShareText(s: BossFightSummary): string {
  if (s.transitions === 0) return "-";
  const ratio = s.actTransitions / s.transitions;
  const text = `${(ratio * 100).toFixed(0)}%`;
  return ratio < ACT_SHARE_TARGET[0] || ratio > ACT_SHARE_TARGET[1] ? `${text}*` : text;
}

function buildOverallTable(summary: readonly BossFightSummary[]): string[] {
  const lines = [
    "| ボス | 戦 | 撃破 | 死亡 | 打切 | 撃破の秒（中央値） | 目標の秒 | 被弾（中央値） | ダウン（中央値） | 行為で進んだ段階 | 取り巻き数と撃破秒の相関 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const s of summary) {
    const target = BOSS_TARGETS[s.key];
    const acts = actShareText(s);
    const downs = s.downsMedian !== null && s.downsMedian < DOWNS_TARGET_MIN ? `${fmt(s.downsMedian)}*` : fmt(s.downsMedian);
    lines.push(
      `| ${s.key} | ${s.fights} | ${s.defeats} | ${s.deaths} | ${s.timeouts} | ${target ? flag(s.secondsMedian, target.seconds) : fmt(s.secondsMedian)} | ${target ? rangeText(target.seconds) : "-"} | ${flag(s.hitsMedian, HITS_TARGET)} | ${downs} | ${acts} | ${fmt(s.minionCorrelation, 2)} |`,
    );
  }
  return lines;
}

function buildStageTable(summary: readonly BossFightSummary[]): string[] {
  const lines = [
    "| ボス | 段階 | 危ない間合い | 秒の割合 | 被弾 | 近い | 中 | 遠い | 静止中 | 地形・影・柵 | 危ない間合いに合う被弾 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const s of summary) {
    const threats = BOSS_THREATS[s.key];
    const total = s.stageSeconds.reduce((a, b) => a + b, 0);
    for (let i = 0; i < BOSS_STAGE_COUNT; i++) {
      const t = s.stageHits[i];
      if (!t) continue;
      const band = threats?.[i];
      const matched = band ? threatShare(t, band) : null;
      const mark = band && missesThreat(t, band) ? "*" : "";
      lines.push(
        `| ${s.key} | ${i + 1} | ${band ? THREAT_LABEL[band] : "-"} | ${shareText(s.stageSeconds[i] ?? 0, total)} | ${t.hits} | ${shareText(t.near, t.hits)} | ${shareText(t.mid, t.hits)} | ${shareText(t.far, t.hits)} | ${shareText(t.still, t.hits)} | ${shareText(t.indirect, t.hits)} | ${matched === null ? "-" : `${(matched * 100).toFixed(0)}%${mark}`} |`,
      );
    }
  }
  return lines;
}

/** 最深の主の段階の長さが 3:4:3 から大きく外れているか（総秒が 0 なら false） */
export function deepLordStageOff(s: BossFightSummary): boolean {
  const total = s.stageSeconds.reduce((a, b) => a + b, 0);
  if (total <= 0) return false;
  return DEEP_LORD_STAGE_RATIO.some((r, i) => Math.abs((s.stageSeconds[i] ?? 0) / total - r) > STAGE_RATIO_TOLERANCE);
}

/** probe.md の「## ボス」節の全文（末尾は改行）。fights は runBossProbe の結果 */
export function buildBossProbeLines(fights: readonly BossFight[], caption: string): string[] {
  const summary = summarizeFights(fights);
  const lines = ["## ボス（章ボス 4 と最深の主。深度相応の装備の bot で 1 体ずつ）", "", caption, ""];
  if (summary.length === 0) {
    lines.push("測れた戦いが無かった。", "");
    return lines;
  }
  lines.push(...buildOverallTable(summary), "");
  lines.push(...buildStageTable(summary), "");
  const deep = summary.find((s) => s.key === "deepLord");
  if (deep && deepLordStageOff(deep)) {
    lines.push(`- 最深の主の段階の長さが 3:4:3 から外れている（四門で詰まる・陥没が長いなど。${deep.stageSeconds.map((v) => v.toFixed(0)).join(" : ")} 秒の合計）`);
  }
  lines.push(
    "- `*` は目標の外。撃破の秒は撃破できた戦いの中央値、被弾とダウンは全戦の中央値。打切 = 制限時間までに決着しなかった戦い",
    "- 行為で進んだ段階 = 段階が進んだ瞬間の生命が閾値より上（分裂体・追い詰め・引火・壁激突・門柱で進んだ）。目標 3〜6 割",
    "- 危ない間合い: 近い = 近い被弾が 5 割以上 / 遠い = 遠い被弾が 5 割以上 / 静止 = 静止中の被弾が 5 割以上 / 動く = 地形・影・柵の被弾が 4 割以上（被弾 5 回未満の段階は印なし）",
    "- 相関は撃破できた戦いの「倒した取り巻きの数」と「撃破の秒」。負なら倒した方が短い（3 戦未満・一定なら -）",
    "",
  );
  return lines;
}
