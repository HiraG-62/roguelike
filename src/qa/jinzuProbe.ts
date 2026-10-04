import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Jin, JinzuState } from "../core/state";
import { type Vec, dist, normalize, sub } from "../core/vec";
import { HONJIN, JINZU, PLAYER } from "../data/tuning";
import { createEmptyProfile } from "../loot/types";
import { rectContainsPx, TILE_SIZE, toIndex } from "../map/grid";
import { findSafeSpot } from "../map/jinzuShape";
import { lineOfSight, walkLine } from "../map/pathing";
import { attackCommitted } from "../system/poise";
import { defaultRunSetup } from "../system/runSetup";
import { botInput, createBotState } from "./bot";
import { fittedEquipment } from "./gearPower";

/**
 * 試し陣の計測（docs/ideas/jinzu-impl.md・D03 5-2。`ppnpm run qa:probe --jinzu` が probe.md の「## 本陣と陣図」の節を作る）。
 * `HONJIN.trial` と同じ盤（深度 4・鶴翼の本陣）を createGame で作り、深度相応の装備のプレイヤーを本陣の部屋の中へ置いて、
 * bot の方針を 3 つ回す。ゲームのロジックは変えず、実際の step() を回して陣図の段の遷移と被弾を数えるだけ。同じ seed なら同じ結果。
 * - 無視: 今の qa/bot.ts のまま（陣図を読まない。予備動作の windup / strike だけを見て避ける）
 * - 詰め: 筆の間（掲げ・筆）は大将へ直進して殴り続ける。墨が入ってからは無視と同じ
 * - 避け: 掲げたら、画の帯に入らない安全地帯へ歩いて立つ。総掛かりが終わるまで動かない
 * bot は陣図を「読む」わけではないので、方針の数字は「その動きをしたら起きる率」として読む
 */

export const JINZU_POLICIES = ["ignore", "rush", "evade"] as const;
export type JinzuPolicy = (typeof JINZU_POLICIES)[number];

export const JINZU_POLICY_LABEL: Readonly<Record<JinzuPolicy, string>> = {
  ignore: "無視",
  rush: "詰め",
  evade: "避け",
};

/** 試し陣の深度（本陣が出る章 1 の階） */
export const JINZU_PROBE_DEPTH = 4;
/** 1 回の計測の制限時間（秒。部屋に置いてから）。2 回の総掛かり + 立て直しが入る長さ */
export const JINZU_PROBE_SECONDS = 45;
/** プレイヤーを置く大将からの距離（px）の候補（掲げの範囲 triggerRange の内） */
const START_DISTANCES: readonly number[] = [200, 180, 160, 140, 120];
/** 置く方角の刻み数 */
const START_ANGLES = 24;
/** bot の乱数の seed の混ぜ値（simulation.test.ts の runOnce と同じ式の定数） */
const BOT_SEED_MUL = 2654435761;
const BOT_SEED_ADD = 12345;
/** 大将を殴りに行く間合い（px。近接の届く目安） */
const RUSH_REACH = 22;
/** 安全地帯に着いたとみなす距離（px） */
const SAFE_ARRIVE = 4;
/** 総掛かりの被弾を数える窓: 構えの始まりから、立て直しに入ってからこの秒まで（遅れて当たる弾を拾う） */
const HIT_WINDOW_AFTER = 0.5;
/** 陣図の被弾と数える近さ（px）: 走る兵の体との間 / 射線の弾との間。1 ステップで進む距離 + 体の大きさの目安 */
const RUNNER_HIT_NEAR = 40;
const BULLET_HIT_NEAR = 30;

/** 総掛かり（掲げから立て直しまで）1 回ぶんの記録 */
export interface SurgeRecord {
  /** 掲げた時刻（置いてからの秒） */
  raisedAt: number;
  /** 計画された画の数 */
  strokes: number;
  /** 筆が折れた（筆の間に大将を怯ませた・恐怖させた）か、折れた画の番号（1 始まり。折れていなければ null） */
  brokeAt: number | null;
  /** 掲げから筆折れまでの秒 */
  brokeSec: number | null;
  /** 総掛かり（走り）まで進んだ */
  charged: boolean;
  /** 構え〜総掛かりの被弾のうち、陣図によるもの（走る兵・射線の弾）の回数とダメージ */
  hits: number;
  damage: number;
  /** 同じ窓の、陣図によらない被弾の回数（周りの敵・毒など） */
  otherHits: number;
  /** 走って当たった隊の数と、空を切った隊の数 */
  strokesHit: number;
  strokesMissed: number;
  /** 総掛かりの最中の、同時に赤い予備動作の数（総掛かり全体を 1 と数える）の最大 */
  maxRed: number;
  /** 総掛かりの最中に同時に strike の敵の数の最大 */
  maxStrikers: number;
}

export interface JinzuRunResult {
  policy: JinzuPolicy;
  seed: number;
  /** 本陣が立てられなかった・置く場所が無かった */
  skipped: boolean;
  surges: SurgeRecord[];
  /** 本陣の決着の種類（大将撃破で敗走 / 敗走 / 全滅 / 決着せず） */
  ending: "leaderDown" | "rout" | "wipe" | "open";
  died: boolean;
  seconds: number;
}

// -----------------------------------------------------------------------------
// 盤を作る
// -----------------------------------------------------------------------------

/** 試し陣を有効にして createGame を呼ぶ（終わったら元に戻す） */
function withTrial<T>(depth: number, fn: () => T): T {
  const trial = HONJIN.trial as { depth: number };
  const backup = trial.depth;
  trial.depth = depth;
  try {
    return fn();
  } finally {
    trial.depth = backup;
  }
}

function roomHas(state: GameState, jin: Jin, p: Vec): boolean {
  const room = state.rooms[jin.roomIndex];
  if (!room) return false;
  if (room.tiles) return room.tiles.has(toIndex(state.map, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)));
  return rectContainsPx(room.rect, p.x, p.y);
}

/** 大将から見て、陣の部屋の中・歩いて届く・視線が通る点（部屋の中心の向きから回して探す） */
function startSpot(state: GameState, jin: Jin, leader: Enemy): Vec | null {
  const room = state.rooms[jin.roomIndex];
  if (!room) return null;
  const toCenter = normalize(sub(jin.center, leader.body.pos), { x: 1, y: 0 });
  const base = Math.atan2(toCenter.y, toCenter.x);
  for (const d of START_DISTANCES) {
    for (let k = 0; k < START_ANGLES; k++) {
      // 中心の向きを先に、左右へ交互に開く
      const turn = Math.ceil(k / 2) * ((k % 2 === 0 ? 1 : -1) * (Math.PI * 2)) / START_ANGLES;
      const a = base + turn;
      const p = { x: leader.body.pos.x + Math.cos(a) * d, y: leader.body.pos.y + Math.sin(a) * d };
      if (roomHas(state, jin, p) && walkLine(state.map, leader.body.pos, p) && lineOfSight(state.map, leader.body.pos, p)) return p;
    }
  }
  return null;
}

export interface TrialBoard {
  state: GameState;
  jin: Jin;
  leader: Enemy;
}

export function buildTrialBoard(seed: number): TrialBoard | null {
  const profile = createEmptyProfile();
  profile.equipment = fittedEquipment(seed, JINZU_PROBE_DEPTH);
  const setup = { ...defaultRunSetup(), startDepth: JINZU_PROBE_DEPTH };
  const state = withTrial(JINZU_PROBE_DEPTH, () => createGame(seed, String(seed), profile, undefined, setup));
  const jin = state.jins.find((j) => j.honjin === true);
  const leader = jin ? state.enemies.find((e) => e.id === jin.leaderId) : undefined;
  if (!jin || !leader) return null;
  const spot = startSpot(state, jin, leader);
  if (!spot) return null;
  state.player.body.pos = { ...spot };
  return { state, jin, leader };
}

// -----------------------------------------------------------------------------
// 方針
// -----------------------------------------------------------------------------

function jinzuOf(jin: Jin): JinzuState | undefined {
  return jin.jinzu;
}

function moveInput(move: Vec, attack: boolean): FrameInput {
  return { ...EMPTY_INPUT, move: { ...move }, aimScreen: null, attackPressed: attack };
}

/** 詰め: 筆の間は大将へ直進し、届いたら殴り続ける */
function rushInput(state: GameState, leader: Enemy): FrameInput {
  const p = state.player;
  const toward = normalize(sub(leader.body.pos, p.body.pos));
  p.facing = toward;
  const d = dist(leader.body.pos, p.body.pos) - leader.body.radius - p.body.radius;
  return moveInput(d > RUSH_REACH ? toward : { x: 0, y: 0 }, d <= RUSH_REACH + 6);
}

/** 避け: 画の帯に入らない安全地帯（歩いて届く点）へ歩き、着いたらそこで立つ */
function evadeInput(state: GameState, jz: JinzuState): FrameInput {
  const p = state.player.body.pos;
  const strokes = jz.strokes.filter((s) => s.state !== "erased" && s.state !== "done").map((s) => s.points);
  const reach = PLAYER.speed * (JINZU.holdSec + jz.strokeSec) * 1.5;
  const spot = findSafeSpot(strokes, p, reach, JINZU.bandHalf, (q) => walkLine(state.map, p, q));
  if (!spot || dist(spot, p) <= SAFE_ARRIVE) return moveInput({ x: 0, y: 0 }, false);
  return moveInput(normalize(sub(spot, p)), false);
}

function policyInput(state: GameState, policy: JinzuPolicy, jin: Jin, leader: Enemy | undefined, bot: ReturnType<typeof createBotState>): FrameInput {
  const jz = jinzuOf(jin);
  const writing = jz !== undefined && (jz.phase === "raise" || jz.phase === "brush");
  const surging = writing || jz?.phase === "hold" || jz?.phase === "charge";
  if (policy === "rush" && writing && leader) return rushInput(state, leader);
  if (policy === "evade" && surging && jz) return evadeInput(state, jz);
  return botInput(state, bot, FIXED_DT);
}

// -----------------------------------------------------------------------------
// 実行
// -----------------------------------------------------------------------------

function blankSurge(raisedAt: number, strokes: number): SurgeRecord {
  return { raisedAt, strokes, brokeAt: null, brokeSec: null, charged: false, hits: 0, damage: 0, otherHits: 0, strokesHit: 0, strokesMissed: 0, maxRed: 0, maxStrikers: 0 };
}

/**
 * この step の直前に、陣図の攻撃（走る兵・射線の弾）がプレイヤーのすぐそばにあったか。被弾が陣図によるものかの目安。
 * 返す集合は、そばにいた攻撃元の敵の key（被弾の出どころ state.hurt.last.key と突き合わせる）。無ければ空
 */
function jinzuNearKeys(state: GameState, jz: JinzuState): ReadonlySet<string> {
  const p = state.player.body.pos;
  const keys = new Set<string>();
  for (const e of state.enemies) {
    if (e.hp > 0 && e.jinzuRun?.mode === "run" && dist(e.body.pos, p) <= RUNNER_HIT_NEAR) keys.add(e.defKey);
  }
  const shooters = new Map<number, string>();
  for (const stroke of jz.strokes) {
    if (stroke.kind !== "volley") continue;
    for (const id of stroke.squad) {
      const e = state.enemies.find((o) => o.id === id);
      if (e) shooters.set(id, e.defKey);
    }
  }
  for (const b of state.projectiles) {
    if (b.owner !== "enemy" || b.sourceId === undefined || dist(b.pos, p) > BULLET_HIT_NEAR) continue;
    const key = shooters.get(b.sourceId);
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

/** 総掛かりの最中の帯域の観測: 同時に赤い予備動作の数（総掛かりは全部で 1 つの絵として 1 と数える）、strike の敵の数（走る兵を 1 人ずつ数えた生の数） */
function observeBand(state: GameState, rec: SurgeRecord): void {
  let committed = 1;
  let strikers = 0;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (e.phase === "windup" && attackCommitted(e)) committed++;
    if (e.phase === "strike") strikers++;
  }
  rec.maxRed = Math.max(rec.maxRed, committed);
  rec.maxStrikers = Math.max(rec.maxStrikers, strikers);
}

/** 終わった総掛かりの数え: 当たった隊・空を切った隊 */
function tallyStrokes(jz: JinzuState, rec: SurgeRecord): void {
  for (const s of jz.strokes) {
    if (s.kind === "volley" || s.state !== "done") continue;
    if (s.hit) rec.strokesHit++;
    else if (!s.jammed && s.finished.length > 0) rec.strokesMissed++;
  }
}

function endingOf(jin: Jin, leaderAlive: boolean): JinzuRunResult["ending"] {
  if (jin.phase !== "settled") return "open";
  if (jin.leaderFell === true || !leaderAlive) return "leaderDown";
  return jin.settledBy === "wipe" ? "wipe" : "rout";
}

/** 1 回の計測。seed の盤を作り、方針の bot を JINZU_PROBE_SECONDS だけ（本陣が決着するまで）回す */
export function runJinzuProbe(policy: JinzuPolicy, seed: number, seconds = JINZU_PROBE_SECONDS): JinzuRunResult {
  const result: JinzuRunResult = { policy, seed, skipped: false, surges: [], ending: "open", died: false, seconds: 0 };
  const board = buildTrialBoard(seed);
  if (!board) return { ...result, skipped: true };
  const { state, jin } = board;
  const bot = createBotState(Math.imul(seed + BOT_SEED_ADD, BOT_SEED_MUL) >>> 0);
  let current: SurgeRecord | null = null;
  let windowEnd = Number.NEGATIVE_INFINITY;
  let lastPhase = "";
  let hpPrev = state.player.hp;
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps && state.status === "playing"; i++) {
    const leader = state.enemies.find((e) => e.id === jin.leaderId && e.hp > 0);
    const jzBefore = jinzuOf(jin);
    const nearKeys = jzBefore ? jinzuNearKeys(state, jzBefore) : new Set<string>();
    step(state, policyInput(state, policy, jin, leader, bot), FIXED_DT);
    result.seconds += FIXED_DT;
    const jz = jinzuOf(jin);
    if (!jz) break;
    const hp = state.player.hp;
    const lost = Math.max(0, hpPrev - hp);
    hpPrev = hp;
    if (jz.phase === "raise" && lastPhase !== "raise") current = blankSurge(result.seconds, jz.strokes.length);
    if (current) {
      const brokeIndex = jz.strokes.findIndex((s) => s.state === "erased");
      if (current.brokeAt === null && brokeIndex >= 0 && jz.strokes.some((s) => s.state === "erased" && s.endedAt !== undefined)) {
        current.brokeAt = brokeIndex + 1;
        current.brokeSec = result.seconds - current.raisedAt;
      }
      if (jz.phase === "charge") current.charged = true;
      const inWindow = jz.phase === "hold" || jz.phase === "charge" || state.time <= windowEnd;
      const hurt = state.hurt.last;
      if (inWindow && lost > 0 && hurt && hurt.kind !== "status") {
        if (nearKeys.has(hurt.key)) {
          current.hits++;
          current.damage += lost;
        } else {
          current.otherHits++;
        }
      }
      if (jz.phase === "charge") observeBand(state, current);
      const finished = jz.phase === "regroup" || jz.phase === "spent" || jz.phase === "ready";
      if (finished && lastPhase !== jz.phase && (lastPhase === "charge" || lastPhase === "brush" || lastPhase === "raise" || lastPhase === "hold")) {
        tallyStrokes(jz, current);
        windowEnd = state.time + HIT_WINDOW_AFTER;
      }
      if (finished && state.time > windowEnd) {
        result.surges.push(current);
        current = null;
      }
    }
    lastPhase = jz.phase;
    if (jin.phase === "settled" && current === null) break;
  }
  if (current) {
    const jz = jinzuOf(jin);
    if (jz) tallyStrokes(jz, current);
    result.surges.push(current);
  }
  const leaderAlive = state.enemies.some((e) => e.id === jin.leaderId && e.hp > 0);
  result.ending = endingOf(jin, leaderAlive);
  result.died = state.status === "dead";
  return result;
}

// -----------------------------------------------------------------------------
// 集計と節の組み立て
// -----------------------------------------------------------------------------

export interface PolicySummary {
  policy: JinzuPolicy;
  /** 測れた盤の数 */
  runs: number;
  /** 掲げた総掛かりの数 */
  surges: number;
  /** 交戦した盤のうち、1 回以上総掛かり（走り）まで進んだ割合 */
  chargedRate: number;
  /** 掲げのうち筆が折れた割合 */
  brokeRate: number;
  /** 折れたうち 1 画目で折れた（0 画で止まった）割合 */
  zeroStrokeRate: number;
  /** 折れた画の番号の中央値（折れた掲げが無ければ null） */
  brokeAtMedian: number | null;
  /** 掲げから筆折れまでの秒の中央値 */
  brokeSecMedian: number | null;
  /** 総掛かり（走りまで進んだもの）1 回あたりの被弾の回数とダメージ */
  hitsPerCharge: number;
  damagePerCharge: number;
  /** 同じ窓の、陣図によらない被弾（周りの敵・毒など。毒・状態異常の持続は除く）の総掛かり 1 回あたり */
  otherHitsPerCharge: number;
  /** 総掛かりの最中の同時に赤い数の最大と strike の最大 */
  maxRed: number;
  maxStrikers: number;
  /** 死んだ盤の割合 */
  deathRate: number;
  /** 決着の内訳 */
  endings: Readonly<Record<JinzuRunResult["ending"], number>>;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const a = sorted[mid] ?? 0;
  const b = sorted[mid - 1] ?? a;
  return sorted.length % 2 === 1 ? a : (a + b) / 2;
}

export function summarizeJinzu(policy: JinzuPolicy, results: readonly JinzuRunResult[]): PolicySummary {
  const runs = results.filter((r) => !r.skipped);
  const surges = runs.flatMap((r) => r.surges);
  const charged = surges.filter((s) => s.charged);
  const broke = surges.filter((s) => s.brokeAt !== null);
  const endings: Record<JinzuRunResult["ending"], number> = { leaderDown: 0, rout: 0, wipe: 0, open: 0 };
  for (const r of runs) endings[r.ending]++;
  const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);
  return {
    policy,
    runs: runs.length,
    surges: surges.length,
    chargedRate: ratio(runs.filter((r) => r.surges.some((s) => s.charged)).length, runs.length),
    brokeRate: ratio(broke.length, surges.length),
    zeroStrokeRate: ratio(broke.filter((s) => s.brokeAt === 1).length, broke.length),
    brokeAtMedian: median(broke.map((s) => s.brokeAt ?? 0)),
    brokeSecMedian: median(broke.map((s) => s.brokeSec ?? 0)),
    hitsPerCharge: ratio(charged.reduce((n, s) => n + s.hits, 0), charged.length),
    damagePerCharge: ratio(charged.reduce((n, s) => n + s.damage, 0), charged.length),
    otherHitsPerCharge: ratio(charged.reduce((n, s) => n + s.otherHits, 0), charged.length),
    maxRed: surges.reduce((m, s) => Math.max(m, s.maxRed), 0),
    maxStrikers: surges.reduce((m, s) => Math.max(m, s.maxStrikers), 0),
    deathRate: ratio(runs.filter((r) => r.died).length, runs.length),
    endings,
  };
}

/** 3 方針を seeds で回して要約する（seed ごとの結果も返す） */
export function measureJinzu(seeds: readonly number[], seconds = JINZU_PROBE_SECONDS): { summaries: PolicySummary[]; results: JinzuRunResult[] } {
  const results: JinzuRunResult[] = [];
  const summaries: PolicySummary[] = [];
  for (const policy of JINZU_POLICIES) {
    const own = seeds.map((seed) => runJinzuProbe(policy, seed, seconds));
    results.push(...own);
    summaries.push(summarizeJinzu(policy, own));
  }
  return { summaries, results };
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const fixed = (v: number, n = 2): string => v.toFixed(n);
const orDash = (v: number | null, n = 1): string => (v === null ? "—" : v.toFixed(n));

/** probe.md の「## 本陣と陣図」の節（Markdown。見出し込み） */
export function buildJinzuSection(summaries: readonly PolicySummary[], seeds: readonly number[]): string {
  const lines: string[] = [];
  lines.push("## 本陣と陣図");
  lines.push("");
  lines.push(
    `試し陣（深度 ${JINZU_PROBE_DEPTH}・鶴翼の本陣。HONJIN.trial と同じ盤）に、深度相応の装備のプレイヤーを本陣の部屋の中へ置き、方針の bot を最大 ${JINZU_PROBE_SECONDS} 秒回した（seed ${seeds.join(" / ")}）。bot は陣図を読まない。数字は「その動きをしたら起きる率」。`,
  );
  lines.push("");
  lines.push("| 方針 | 盤 | 掲げ | 走りまで進んだ盤 | 筆が折れた掲げ | 1 画目で折れた | 折れた画の中央値 | 折れるまでの秒 | 陣図の被弾/総掛かり | ダメージ/総掛かり | 他の被弾/総掛かり | 赤の最大 | strike の最大 | 死亡 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const s of summaries) {
    lines.push(
      `| ${JINZU_POLICY_LABEL[s.policy]} | ${s.runs} | ${s.surges} | ${pct(s.chargedRate)} | ${pct(s.brokeRate)} | ${pct(s.zeroStrokeRate)} | ${orDash(s.brokeAtMedian)} | ${orDash(s.brokeSecMedian)} | ${fixed(s.hitsPerCharge)} | ${fixed(s.damagePerCharge, 1)} | ${fixed(s.otherHitsPerCharge)} | ${s.maxRed} | ${s.maxStrikers} | ${pct(s.deathRate)} |`,
    );
  }
  lines.push("");
  lines.push("| 方針 | 大将撃破 | 敗走 | 全滅 | 決着せず |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const s of summaries) {
    lines.push(`| ${JINZU_POLICY_LABEL[s.policy]} | ${s.endings.leaderDown} | ${s.endings.rout} | ${s.endings.wipe} | ${s.endings.open} |`);
  }
  lines.push("");
  lines.push("目安（D03 1 章の門）: 詰めの折れ率 50〜80%・0 画で折れるのは 15% 未満・折れた画の中央値 2〜4。無視の被弾 1.0〜2.0 / 避け 0.5 以下（2 倍以上の差）。赤の最大 3 以下。");
  lines.push("");
  return lines.join("\n");
}
