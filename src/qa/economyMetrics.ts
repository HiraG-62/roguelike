import type { GameState } from "../core/state";
import { DEPTH_BANDS, type DepthBand, depthBandOf } from "./combatMetrics";

/**
 * 経済（銭・鍵・瓶）の計測（docs/ideas/economy-impl.md 5 章）。state を読むだけで書き換えない。
 * フル QA（simulation.test.ts の runOnce）が step のたびに afterStep を呼び、report.md の 1 節にする。
 *
 * `state.economy` はレーン A が作る欄なので、ここでは unknown として読み、無い欄・数値でない欄は
 * 「無い」ものとして扱う。6b 以降の欄（keys・merchants・player.flasks など）は state に現れたときだけ列を出す
 */

/** 銭の源の表示順と名前。ここに無い key は key のまま末尾に出す（CoinSource が増えても計測は止まらない） */
const SOURCE_LABEL: Readonly<Record<string, string>> = {
  kill: "撃破",
  jin: "陣",
  floor: "階",
  container: "容れ物",
  bet: "賭け",
  sell: "売却",
  rule: "Rule",
};

/** 稼ぎの表に必ず出す源（0 でも出す）。それ以外は 1 度でも稼いだ源だけ出す */
const BASE_SOURCES: readonly string[] = ["kill", "jin", "floor"];

/** 使い道の表示順と名前。ここに無い key は key のまま末尾に出す */
const SPEND_LABEL: Readonly<Record<string, string>> = {
  flask: "瓶",
  item: "遺物",
  rune: "刻印符",
  key: "鍵",
  reroll: "引き直し",
  contract: "契約",
  bet: "賭け",
  donation: "寄進",
  toll: "通行料",
};

/** 消えた銭の判定: 最後に見た残り秒がこの step 数以内なら寿命切れ（拾われたのではなく消えた）とみなす */
const EXPIRE_STEPS = 1.5;

export interface EconomyBandTally {
  /** 観測した階の数（初めて着いた深度 1 つにつき 1。途中で死んだ階も数える） */
  floors: number;
  /** 源別の稼ぎ / 用途別の支出（拾い直しは稼ぎに入らない） */
  earned: Record<string, number>;
  spent: Record<string, number>;
  /** 床に落ちた銭の額（こぼれた銭は除く）と、拾われず寿命切れ・置き去りで消えた額 */
  dropped: number;
  vanished: number;
  /** 被弾でこぼれた額・回数と、拾い直した額 */
  spilled: number;
  spillEvents: number;
  recovered: number;
  keysGained: number;
  keysUsed: number;
  /** 階に立っていた商人の数（economy.merchants の長さ。階に着いた時点） */
  merchants: number;
}

export interface EconomyTally {
  bands: Record<DepthBand, EconomyBandTally>;
  /** state に現れた欄。無ければ対応する列・行を出さない */
  seen: { economy: boolean; keys: boolean; merchants: boolean; flasks: boolean; outlaw: boolean; bet: boolean };
  /** 瓶（player.flasks）の増え（買い・泉・拾い）と、飲んで減った本数 */
  flasksGained: number;
  flasksDrunk: number;
  /** 商人を襲って無法者になった回数（1 ランに高々 1） */
  outlawEvents: number;
  /** 床に同時にあった銭の実体の最大 */
  maxCoinPickups: number;
  /** ランの終わり */
  finished: boolean;
  died: boolean;
  maxDepth: number;
  finalCoins: number;
  finalKeys: number;
  finalFlasks: number;
  outlaw: boolean;
}

function emptyBand(): EconomyBandTally {
  return {
    floors: 0,
    earned: {},
    spent: {},
    dropped: 0,
    vanished: 0,
    spilled: 0,
    spillEvents: 0,
    recovered: 0,
    keysGained: 0,
    keysUsed: 0,
    merchants: 0,
  };
}

export function emptyEconomyTally(): EconomyTally {
  const bands = {} as Record<DepthBand, EconomyBandTally>;
  for (const band of DEPTH_BANDS) bands[band] = emptyBand();
  return {
    bands,
    seen: { economy: false, keys: false, merchants: false, flasks: false, outlaw: false, bet: false },
    flasksGained: 0,
    flasksDrunk: 0,
    outlawEvents: 0,
    maxCoinPickups: 0,
    finished: false,
    died: false,
    maxDepth: 0,
    finalCoins: 0,
    finalKeys: 0,
    finalFlasks: 0,
    outlaw: false,
  };
}

// -----------------------------------------------------------------------------
// state の読み取り（型に無い欄も安全に読む）
// -----------------------------------------------------------------------------

function field(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 数値の欄だけを拾った写し（Record<string, number> でない欄・数値でない値は無視） */
function numberRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

interface EconomySnapshot {
  coins: number;
  keys: number | null;
  earned: Record<string, number>;
  spent: Record<string, number>;
  spilled: number;
  recovered: number;
  /** 撃破で落ちた銭の総額 / 拾われず消えた総額（economy が数えていればそれを正とする。無ければ床の実体から推す） */
  dropped: number | null;
  expired: number | null;
  outlaw: boolean | null;
  merchants: number | null;
  hasBet: boolean;
  flasks: number | null;
}

function snapshotOf(state: GameState): EconomySnapshot | null {
  const eco = field(state, "economy");
  if (typeof eco !== "object" || eco === null) return null;
  const keys = field(eco, "keys");
  const outlaw = field(eco, "outlaw");
  const merchants = field(eco, "merchants");
  const flasks = field(state.player, "flasks");
  return {
    coins: numberOr(field(eco, "coins"), 0),
    keys: typeof keys === "number" ? keys : null,
    earned: numberRecord(field(eco, "earned")),
    spent: numberRecord(field(eco, "spent")),
    spilled: numberOr(field(eco, "spilled"), 0),
    recovered: numberOr(field(eco, "recovered"), 0),
    dropped: typeof field(eco, "dropped") === "number" ? numberOr(field(eco, "dropped"), 0) : null,
    expired: typeof field(eco, "expired") === "number" ? numberOr(field(eco, "expired"), 0) : null,
    outlaw: typeof outlaw === "boolean" ? outlaw : null,
    merchants: Array.isArray(merchants) ? merchants.length : null,
    hasBet: "bet" in eco,
    flasks: typeof flasks === "number" ? flasks : null,
  };
}

/** economy が落ちた額・消えた額を自分で数えているか */
function hasExactCounters(snap: EconomySnapshot): snap is EconomySnapshot & { dropped: number; expired: number } {
  return snap.dropped !== null && snap.expired !== null;
}

interface CoinPickupView {
  id: number;
  value: number;
  life: number;
  spilled: boolean;
}

/** 床の銭の実体（Pickup の kind: "coin"）。value が無ければ 1、life が無ければ消えない */
function coinPickups(state: GameState): CoinPickupView[] {
  const out: CoinPickupView[] = [];
  for (const p of state.pickups as readonly unknown[]) {
    if (field(p, "kind") !== "coin") continue;
    const id = field(p, "id");
    if (typeof id !== "number") continue;
    out.push({
      id,
      value: numberOr(field(p, "value"), 1),
      life: numberOr(field(p, "life"), Number.POSITIVE_INFINITY),
      spilled: field(p, "spilled") === true,
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// 記録
// -----------------------------------------------------------------------------

export interface EconomyRecorder {
  tally: EconomyTally;
  /** step() の直後に毎回呼ぶ。前回との差分をその時点の深度帯へ入れる */
  afterStep(state: GameState, dt: number): void;
  /** ランの終わりに 1 回呼ぶ（死亡時の持ち金などを控える） */
  finish(state: GameState): void;
}

function addTo(target: Record<string, number>, key: string, amount: number): void {
  if (amount === 0) return;
  target[key] = (target[key] ?? 0) + amount;
}

function addDiff(target: Record<string, number>, prev: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) addTo(target, key, value - (prev[key] ?? 0));
}

/**
 * initial を渡すと、その時点の値を「前回」にする（開始時の鍵・瓶・初期の階を数え漏らさないため）。
 * 渡さなければ最初の afterStep の値が基準になる
 */
export function createEconomyRecorder(initial?: GameState): EconomyRecorder {
  const tally = emptyEconomyTally();
  const visitedDepths = new Set<number>();
  const tracked = new Map<number, CoinPickupView>();
  let prev: EconomySnapshot | null = null;
  let prevDepth: number | null = null;

  function observeFloor(state: GameState, snap: EconomySnapshot, band: EconomyBandTally): void {
    if (visitedDepths.has(state.depth)) return;
    visitedDepths.add(state.depth);
    band.floors++;
    if (snap.merchants === null) return;
    tally.seen.merchants = true;
    band.merchants += snap.merchants;
  }

  function observePickups(state: GameState, band: EconomyBandTally, dt: number, depthChanged: boolean, exact: boolean): void {
    const now = coinPickups(state);
    const alive = new Set<number>();
    for (const c of now) {
      alive.add(c.id);
      const before = tracked.get(c.id);
      // 最大数を超えたときに最新の銭へ額が足される仕様（maxCoins）も、増えた分は「落ちた」に数える
      if (!exact && !c.spilled) band.dropped += before ? Math.max(0, c.value - before.value) : c.value;
      tracked.set(c.id, c);
    }
    tally.maxCoinPickups = Math.max(tally.maxCoinPickups, now.length);
    for (const [id, last] of [...tracked]) {
      if (alive.has(id)) continue;
      tracked.delete(id);
      if (exact || last.spilled) continue;
      // 階を離れて置き去り、または寿命切れ。それ以外（拾われた）は数えない
      if (depthChanged || last.life <= dt * EXPIRE_STEPS) band.vanished += last.value;
    }
  }

  function observeDiff(snap: EconomySnapshot, before: EconomySnapshot, band: EconomyBandTally): void {
    addDiff(band.earned, before.earned, snap.earned);
    addDiff(band.spent, before.spent, snap.spent);
    band.spilled += Math.max(0, snap.spilled - before.spilled);
    if (snap.spilled > before.spilled) band.spillEvents++;
    band.recovered += Math.max(0, snap.recovered - before.recovered);
    if (hasExactCounters(snap) && hasExactCounters(before)) {
      band.dropped += Math.max(0, snap.dropped - before.dropped);
      band.vanished += Math.max(0, snap.expired - before.expired);
    }
    if (snap.keys !== null && before.keys !== null) {
      if (snap.keys > before.keys) band.keysGained += snap.keys - before.keys;
      if (snap.keys < before.keys) band.keysUsed += before.keys - snap.keys;
    }
    if (snap.flasks !== null && before.flasks !== null) {
      if (snap.flasks > before.flasks) tally.flasksGained += snap.flasks - before.flasks;
      if (snap.flasks < before.flasks) tally.flasksDrunk += before.flasks - snap.flasks;
    }
    if (snap.outlaw === true && before.outlaw === false) tally.outlawEvents++;
  }

  function markSeen(snap: EconomySnapshot): void {
    tally.seen.economy = true;
    if (snap.keys !== null) tally.seen.keys = true;
    if (snap.flasks !== null) tally.seen.flasks = true;
    if (snap.outlaw !== null) tally.seen.outlaw = true;
    if (snap.hasBet) tally.seen.bet = true;
  }

  function afterStep(state: GameState, dt: number): void {
    const snap = snapshotOf(state);
    const band = tally.bands[depthBandOf(state.depth)];
    const depthChanged = prevDepth !== null && prevDepth !== state.depth;
    prevDepth = state.depth;
    tally.maxDepth = Math.max(tally.maxDepth, state.depth);
    if (!snap) return;
    markSeen(snap);
    observeFloor(state, snap, band);
    if (prev) observeDiff(snap, prev, band);
    observePickups(state, band, dt, depthChanged, hasExactCounters(snap) && prev !== null && hasExactCounters(prev));
    prev = snap;
  }

  function finish(state: GameState): void {
    const snap = snapshotOf(state);
    tally.finished = true;
    tally.died = state.status === "dead";
    tally.maxDepth = Math.max(tally.maxDepth, state.depth);
    if (!snap) return;
    tally.finalCoins = snap.coins;
    tally.finalKeys = snap.keys ?? 0;
    tally.finalFlasks = snap.flasks ?? 0;
    tally.outlaw = snap.outlaw === true;
  }

  if (initial) {
    prev = snapshotOf(initial);
    prevDepth = initial.depth;
    if (prev) {
      markSeen(prev);
      observeFloor(initial, prev, tally.bands[depthBandOf(initial.depth)]);
    }
  }
  return { tally, afterStep, finish };
}

// -----------------------------------------------------------------------------
// 集計と表
// -----------------------------------------------------------------------------

function sum(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

function mergeRecord(target: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) addTo(target, key, value);
}

function mergeBand(into: EconomyBandTally, from: EconomyBandTally): void {
  into.floors += from.floors;
  mergeRecord(into.earned, from.earned);
  mergeRecord(into.spent, from.spent);
  into.dropped += from.dropped;
  into.vanished += from.vanished;
  into.spilled += from.spilled;
  into.spillEvents += from.spillEvents;
  into.recovered += from.recovered;
  into.keysGained += from.keysGained;
  into.keysUsed += from.keysUsed;
  into.merchants += from.merchants;
}

function mergeTallies(list: readonly EconomyTally[]): EconomyTally {
  const out = emptyEconomyTally();
  for (const t of list) {
    for (const band of DEPTH_BANDS) mergeBand(out.bands[band], t.bands[band]);
    for (const key of Object.keys(out.seen) as (keyof EconomyTally["seen"])[]) out.seen[key] = out.seen[key] || t.seen[key];
    out.flasksGained += t.flasksGained;
    out.flasksDrunk += t.flasksDrunk;
    out.outlawEvents += t.outlawEvents;
    out.maxCoinPickups = Math.max(out.maxCoinPickups, t.maxCoinPickups);
  }
  return out;
}

function pct(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(0)}%` : "-";
}

function perFloor(value: number, floors: number): string {
  return floors > 0 ? (value / floors).toFixed(1) : "-";
}

function mean(values: readonly number[]): string {
  return values.length > 0 ? (sum(values) / values.length).toFixed(1) : "-";
}

function median(values: readonly number[]): string {
  if (values.length === 0) return "-";
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return value.toFixed(1);
}

/** 深度帯の行。21+ は観測があるときだけ足す（深く始めるランのため） */
function rowBands(t: EconomyTally): DepthBand[] {
  return DEPTH_BANDS.filter((band) => band !== "21+" || t.bands[band].floors > 0);
}

/** 表に出す key の並び: 既知の順 → 未知の key（名前順）。alwaysShow は 0 でも出す */
function orderedKeys(labels: Readonly<Record<string, string>>, totals: Record<string, number>, alwaysShow: readonly string[]): string[] {
  const known = Object.keys(labels).filter((k) => alwaysShow.includes(k) || (totals[k] ?? 0) !== 0);
  const unknown = Object.keys(totals)
    .filter((k) => !(k in labels) && (totals[k] ?? 0) !== 0)
    .sort();
  return [...known, ...unknown];
}

function totalsOf(t: EconomyTally, pick: (b: EconomyBandTally) => Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const band of DEPTH_BANDS) mergeRecord(out, pick(t.bands[band]));
  return out;
}

function earnedSection(t: EconomyTally): string[] {
  const keys = orderedKeys(SOURCE_LABEL, totalsOf(t, (b) => b.earned), BASE_SOURCES);
  const lines: string[] = [];
  lines.push("### 1 階の稼ぎ（源別。拾い直した銭は入らない。目標: 全部倒す bot で章 1 が 90〜120）");
  lines.push("");
  lines.push(`| 深度帯 | 観測した階 | ${keys.map((k) => SOURCE_LABEL[k] ?? k).join(" | ")} | 合計 |`);
  lines.push(`| --- | --- | ${keys.map(() => "---").join(" | ")} | --- |`);
  for (const band of rowBands(t)) {
    const b = t.bands[band];
    const cells = keys.map((k) => perFloor(b.earned[k] ?? 0, b.floors));
    lines.push(`| ${band} | ${b.floors} | ${cells.join(" | ")} | ${perFloor(sum(Object.values(b.earned)), b.floors)} |`);
  }
  lines.push("");
  return lines;
}

function droppedSection(t: EconomyTally): string[] {
  const lines: string[] = [];
  lines.push("### 落ちた銭と消えた銭（床に落ちて拾われず寿命切れ・置き去りになった割合。目標: 20〜35%）");
  lines.push("");
  lines.push("| 深度帯 | 落ちた（1 階あたり） | 消えた（1 階あたり） | 消えた割合 |");
  lines.push("| --- | --- | --- | --- |");
  for (const band of rowBands(t)) {
    const b = t.bands[band];
    lines.push(`| ${band} | ${perFloor(b.dropped, b.floors)} | ${perFloor(b.vanished, b.floors)} | ${pct(b.vanished, b.dropped)} |`);
  }
  lines.push("");
  lines.push(`床に同時にあった銭の実体の最大: ${t.maxCoinPickups}`);
  lines.push("");
  return lines;
}

function spillSection(t: EconomyTally): string[] {
  const lines: string[] = [];
  lines.push("### こぼれた銭と拾い直し（被弾でこぼれる。目標: 拾い直し 50〜70%）");
  lines.push("");
  lines.push("| 深度帯 | こぼれた回数 | こぼれた額 | 拾い直した額 | 拾い直し | 1 回あたりの損 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const band of rowBands(t)) {
    const b = t.bands[band];
    lines.push(
      `| ${band} | ${b.spillEvents} | ${b.spilled} | ${b.recovered} | ${pct(b.recovered, b.spilled)} | ` +
        `${perFloor(b.spilled - b.recovered, b.spillEvents)} |`,
    );
  }
  lines.push("");
  return lines;
}

function spentSection(t: EconomyTally): string[] {
  const keys = orderedKeys(SPEND_LABEL, totalsOf(t, (b) => b.spent), []);
  const lines: string[] = [];
  lines.push("### 使い道の内訳（1 階あたりの支出）");
  lines.push("");
  if (keys.length === 0) {
    lines.push("使い道はまだ観測されなかった。");
    lines.push("");
    return lines;
  }
  lines.push(`| 深度帯 | ${keys.map((k) => SPEND_LABEL[k] ?? k).join(" | ")} | 合計 |`);
  lines.push(`| --- | ${keys.map(() => "---").join(" | ")} | --- |`);
  for (const band of rowBands(t)) {
    const b = t.bands[band];
    const cells = keys.map((k) => perFloor(b.spent[k] ?? 0, b.floors));
    lines.push(`| ${band} | ${cells.join(" | ")} | ${perFloor(sum(Object.values(b.spent)), b.floors)} |`);
  }
  lines.push("");
  return lines;
}

function deathSection(list: readonly EconomyTally[], merged: EconomyTally): string[] {
  const deaths = list.filter((t) => t.finished && t.died);
  const coins = deaths.map((t) => t.finalCoins);
  const firstBand = merged.bands["1-5"];
  const floorIncome = firstBand.floors > 0 ? sum(Object.values(firstBand.earned)) / firstBand.floors : 0;
  const lines: string[] = [];
  lines.push("### 死亡時の持ち金（目標: 1 階の稼ぎ（深度 1〜5）の 1〜2 倍を超えるなら銭の出口が足りない）");
  lines.push("");
  const ratio = floorIncome > 0 && coins.length > 0 ? `（1 階の稼ぎの ×${(sum(coins) / coins.length / floorIncome).toFixed(2)}）` : "";
  lines.push(`死亡 ${deaths.length} / ${list.length} run: 持ち金 平均 ${mean(coins)}${ratio}、中央値 ${median(coins)}、最大 ${coins.length > 0 ? Math.max(...coins) : "-"}`);
  lines.push("");
  return lines;
}

/** 6b 以降の欄（鍵・瓶・商人・賭け）。state に欄が現れたものだけ出す */
function optionalSections(list: readonly EconomyTally[], t: EconomyTally): string[] {
  const lines: string[] = [];
  const finished = list.filter((x) => x.finished);
  const deaths = finished.filter((x) => x.died);
  if (t.seen.keys) {
    const gained = sum(DEPTH_BANDS.map((b) => t.bands[b].keysGained));
    const used = sum(DEPTH_BANDS.map((b) => t.bands[b].keysUsed));
    lines.push(`- 鍵（目標: 1 章に 3〜5 本）: 得た ${gained} / 使った ${used} / 死亡時の残り 平均 ${mean(deaths.map((x) => x.finalKeys))}（run あたり得た ${finished.length > 0 ? (gained / finished.length).toFixed(1) : "-"}）`);
  }
  if (t.seen.flasks) {
    lines.push(
      `- 瓶（目標: 死亡時の残り 0〜1）: 増えた ${t.flasksGained}（買い・泉・拾い）/ 飲んだ ${t.flasksDrunk} / 死亡時の残り 平均 ${mean(deaths.map((x) => x.finalFlasks))}`,
    );
  }
  if (t.seen.merchants) {
    const stood = sum(DEPTH_BANDS.map((b) => t.bands[b].merchants));
    lines.push(`- 商人: 立った ${stood}、襲われた ${t.outlawEvents}`);
  }
  if (t.seen.outlaw) {
    const outlaws = finished.filter((x) => x.outlaw);
    const others = finished.filter((x) => !x.outlaw);
    lines.push(
      `- 無法者になったラン: ${outlaws.length} / ${finished.length}（到達深度 平均 ${mean(outlaws.map((x) => x.maxDepth))}、ならなかったラン ${mean(others.map((x) => x.maxDepth))}）`,
    );
  }
  if (t.seen.bet) {
    const won = totalsOf(t, (b) => b.earned)["bet"] ?? 0;
    const staked = totalsOf(t, (b) => b.spent)["bet"] ?? 0;
    lines.push(`- 賭け: 払った ${staked} / 得た ${won} / 純益 ${won - staked}（型ごとの勝率は 6c で足す）`);
  }
  if (lines.length > 0) lines.push("");
  return lines;
}

/** report.md の節 */
export function buildEconomySection(list: readonly EconomyTally[]): string[] {
  const lines: string[] = [];
  lines.push("## 経済（銭。docs/ideas/economy-impl.md 5 章。つまみ: ECONOMY.income.kill.normal → income.jin / floor → spill.ratio → coin.life / magnetRadius）");
  lines.push("");
  const merged = mergeTallies(list);
  if (!merged.seen.economy) {
    lines.push("state.economy が無いため計測なし。");
    lines.push("");
    return lines;
  }
  lines.push("階あたりの値は「観測した階」（初めて着いた深度。途中で死んだ階も 1 階に数える）で割った平均。深度帯の行は、その step の深度で分ける。");
  lines.push("");
  lines.push(...earnedSection(merged));
  lines.push(...droppedSection(merged));
  lines.push(...spillSection(merged));
  lines.push(...spentSection(merged));
  lines.push(...deathSection(list, merged));
  lines.push(...optionalSections(list, merged));
  return lines;
}
