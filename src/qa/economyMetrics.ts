import type { GameState } from "../core/state";
import { TILE_SIZE, Tile, getTile, inBounds } from "../map/grid";
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
  room: "部屋",
  floor: "階",
  event: "出来事",
  contract: "契約",
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

/** 賭けの型の表示順と名前（system/bets.ts の BET_LABEL と同じ。ここに無い key は key のまま末尾に出す） */
const BET_LABEL: Readonly<Record<string, string>> = {
  chohan: "丁半",
  longshot: "大穴",
  allIn: "一か八か",
  doubleUp: "倍々勝負",
  unscathed: "無傷",
  swift: "速攻",
  parries: "凌ぎ",
};

/** 腕の賭けの難しさの表示順と名前 */
const BET_TIER_LABEL: Readonly<Record<string, string>> = { easy: "易", hard: "難", extreme: "至難" };

/** 泉の近さ（タイル）。瓶が増えた step でこの範囲に泉のタイルがあれば「泉で満たした」、無ければ床の瓶を拾ったとみなす */
const FOUNTAIN_NEAR_TILES = 2;

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
  /** そのうち、階を離れる（ランが終わる）までに 1 つも買われなかった商人の数 */
  merchantsUnshopped: number;
  /** 品ごとに買った回数（economy.bought の増分） */
  bought: Record<string, number>;
  /** 瓶（player.flasks）の増減の内訳: 市で買った / 泉で満たした / 床から拾った / 飲んだ本数 */
  flasksBought: number;
  flasksFountain: number;
  flasksPicked: number;
  flasksDrunk: number;
}

/** 賭けの型ごとの集計（economy.betStats をランの終わりに写す） */
export interface BetTallyRow {
  placed: number;
  won: number;
  staked: number;
  paid: number;
  /** 腕の型の難しさごとの決着の数と勝ち */
  tiers: Record<string, { settled: number; won: number }>;
}

export interface EconomyTally {
  bands: Record<DepthBand, EconomyBandTally>;
  /** 賭けの型ごと（ランの終わりの economy.betStats） */
  bets: Record<string, BetTallyRow>;
  /** state に現れた欄。無ければ対応する列・行を出さない */
  seen: { economy: boolean; keys: boolean; merchants: boolean; flasks: boolean; outlaw: boolean; bet: boolean };
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
    merchantsUnshopped: 0,
    bought: {},
    flasksBought: 0,
    flasksFountain: 0,
    flasksPicked: 0,
    flasksDrunk: 0,
  };
}

export function emptyEconomyTally(): EconomyTally {
  const bands = {} as Record<DepthBand, EconomyBandTally>;
  for (const band of DEPTH_BANDS) bands[band] = emptyBand();
  return {
    bands,
    bets: {},
    seen: { economy: false, keys: false, merchants: false, flasks: false, outlaw: false, bet: false },
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
  /** 階に立っている商人の実体（買われたか = wares の used を後で読む） */
  merchantList: readonly unknown[];
  /** economy.bought（品ごとの買った回数）。欄が無ければ null */
  bought: Record<string, number> | null;
  hasBet: boolean;
  /** economy.betStats（無ければ空） */
  betStats: Record<string, BetTallyRow>;
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
    merchantList: Array.isArray(merchants) ? merchants : [],
    bought: typeof field(eco, "bought") === "object" && field(eco, "bought") !== null ? numberRecord(field(eco, "bought")) : null,
    hasBet: "bet" in eco,
    betStats: betStatsOf(field(eco, "betStats")),
    flasks: typeof flasks === "number" ? flasks : null,
  };
}

function betRowOf(value: unknown): BetTallyRow {
  const tiers: Record<string, { settled: number; won: number }> = {};
  const rawTiers = field(value, "tiers");
  if (typeof rawTiers === "object" && rawTiers !== null) {
    for (const [tier, t] of Object.entries(rawTiers)) tiers[tier] = { settled: numberOr(field(t, "settled"), 0), won: numberOr(field(t, "won"), 0) };
  }
  return {
    placed: numberOr(field(value, "placed"), 0),
    won: numberOr(field(value, "won"), 0),
    staked: numberOr(field(value, "staked"), 0),
    paid: numberOr(field(value, "paid"), 0),
    tiers,
  };
}

/** economy.betStats の写し（形が違う欄は 0 として読む） */
function betStatsOf(value: unknown): Record<string, BetTallyRow> {
  const out: Record<string, BetTallyRow> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [kind, row] of Object.entries(value)) out[kind] = betRowOf(row);
  return out;
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

/** 商人が 1 つでも品を売ったか（台座の used）。欄が無い・形が違う商人は「売れていない」 */
function hasSold(merchant: unknown): boolean {
  const wares = field(merchant, "wares");
  if (!Array.isArray(wares)) return false;
  return wares.some((w) => field(w, "used") === true);
}

/** 位置 pos の近く（FOUNTAIN_NEAR_TILES タイル以内）に泉のタイルがあるか。瓶の増えが泉か拾いかを分けるだけの読み取り */
function nearFountain(state: GameState): boolean {
  const pos = state.player.body.pos;
  const cx = Math.floor(pos.x / TILE_SIZE);
  const cy = Math.floor(pos.y / TILE_SIZE);
  for (let dy = -FOUNTAIN_NEAR_TILES; dy <= FOUNTAIN_NEAR_TILES; dy++) {
    for (let dx = -FOUNTAIN_NEAR_TILES; dx <= FOUNTAIN_NEAR_TILES; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (inBounds(state.map, x, y) && getTile(state.map, x, y) === Tile.Fountain) return true;
    }
  }
  return false;
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
  /** 初めて着いた階の商人（階を離れるときに買い物 0 かを数える）。再訪の階は持たない */
  let heldMerchants: { band: EconomyBandTally; list: readonly unknown[]; boughtAtArrival: number } | null = null;

  function boughtTotal(snap: EconomySnapshot): number {
    return snap.bought === null ? 0 : sum(Object.values(snap.bought));
  }

  /** 階を離れる（ランが終わる）とき、その階の商人のうち何も売れなかった数を数える */
  function settleMerchants(snap: EconomySnapshot | null): void {
    const held = heldMerchants;
    heldMerchants = null;
    if (!held) return;
    // 品の台座が used にならない買い物（引き直しなど）も、商人が 1 人だけの階なら買い物ありとみなす
    const purchased = snap !== null && boughtTotal(snap) > held.boughtAtArrival;
    const soleShopped = held.list.length === 1 && purchased;
    for (const m of held.list) {
      if (!hasSold(m) && !soleShopped) held.band.merchantsUnshopped++;
    }
  }

  function observeFloor(state: GameState, snap: EconomySnapshot, band: EconomyBandTally): void {
    if (visitedDepths.has(state.depth)) return;
    visitedDepths.add(state.depth);
    band.floors++;
    if (snap.merchants === null) return;
    tally.seen.merchants = true;
    band.merchants += snap.merchants;
    heldMerchants = { band, list: [...snap.merchantList], boughtAtArrival: boughtTotal(snap) };
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

  /**
   * 瓶の増減の内訳。net = 買った − 飲んだ + (泉・拾い)。買った数は economy.bought の増分を正とし、
   * 残りの増えは泉のタイルの近くなら泉、そうでなければ床の瓶の拾い
   */
  function observeFlasks(state: GameState, snap: EconomySnapshot, before: EconomySnapshot, band: EconomyBandTally): void {
    const net = (snap.flasks ?? 0) - (before.flasks ?? 0);
    const bought = Math.max(0, (snap.bought?.["flask"] ?? 0) - (before.bought?.["flask"] ?? 0));
    band.flasksBought += bought;
    if (net < bought) {
      band.flasksDrunk += bought - net;
      return;
    }
    if (net === bought) return;
    if (nearFountain(state)) band.flasksFountain += net - bought;
    else band.flasksPicked += net - bought;
  }

  function observeDiff(state: GameState, snap: EconomySnapshot, before: EconomySnapshot, band: EconomyBandTally): void {
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
    if (snap.bought !== null) {
      for (const [kind, count] of Object.entries(snap.bought)) addTo(band.bought, kind, count - (before.bought?.[kind] ?? 0));
    }
    if (snap.flasks !== null && before.flasks !== null) observeFlasks(state, snap, before, band);
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
    if (depthChanged) settleMerchants(prev);
    observeFloor(state, snap, band);
    if (prev) observeDiff(state, snap, prev, band);
    observePickups(state, band, dt, depthChanged, hasExactCounters(snap) && prev !== null && hasExactCounters(prev));
    prev = snap;
  }

  function finish(state: GameState): void {
    const snap = snapshotOf(state);
    tally.finished = true;
    tally.died = state.status === "dead";
    tally.maxDepth = Math.max(tally.maxDepth, state.depth);
    if (!snap) return;
    settleMerchants(snap);
    tally.finalCoins = snap.coins;
    tally.finalKeys = snap.keys ?? 0;
    tally.finalFlasks = snap.flasks ?? 0;
    tally.outlaw = snap.outlaw === true;
    tally.bets = snap.betStats;
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
  into.merchantsUnshopped += from.merchantsUnshopped;
  mergeRecord(into.bought, from.bought);
  into.flasksBought += from.flasksBought;
  into.flasksFountain += from.flasksFountain;
  into.flasksPicked += from.flasksPicked;
  into.flasksDrunk += from.flasksDrunk;
}

function mergeBets(into: Record<string, BetTallyRow>, from: Record<string, BetTallyRow>): void {
  for (const [kind, row] of Object.entries(from)) {
    const acc = into[kind] ?? { placed: 0, won: 0, staked: 0, paid: 0, tiers: {} };
    acc.placed += row.placed;
    acc.won += row.won;
    acc.staked += row.staked;
    acc.paid += row.paid;
    for (const [tier, t] of Object.entries(row.tiers)) {
      const a = acc.tiers[tier] ?? { settled: 0, won: 0 };
      a.settled += t.settled;
      a.won += t.won;
      acc.tiers[tier] = a;
    }
    into[kind] = acc;
  }
}

function mergeTallies(list: readonly EconomyTally[]): EconomyTally {
  const out = emptyEconomyTally();
  for (const t of list) {
    mergeBets(out.bets, t.bets);
    for (const band of DEPTH_BANDS) mergeBand(out.bands[band], t.bands[band]);
    for (const key of Object.keys(out.seen) as (keyof EconomyTally["seen"])[]) out.seen[key] = out.seen[key] || t.seen[key];
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

/** 章（深度帯）別の瓶と買い物の表。瓶・商人の欄が state に現れたときだけ出す */
function shopSection(t: EconomyTally): string[] {
  if (!t.seen.flasks && !t.seen.merchants) return [];
  const kinds = [...new Set(DEPTH_BANDS.flatMap((band) => Object.keys(t.bands[band].bought)))].sort();
  const lines: string[] = [];
  lines.push("### 章別の瓶と買い物（章 = 深度帯。買い物 0 = 階を離れるまで何も売れなかった商人の割合。目標: 市を素通りする割合が高いなら値段か置き場所を見直す）");
  lines.push("");
  lines.push(`| 深度帯 | 観測した階 | 商人 | 買い物 0 | 買った瓶 | 泉で満たした瓶 | 拾った瓶 | 飲んだ瓶 | 買った品 |`);
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const band of rowBands(t)) {
    const b = t.bands[band];
    const bought = kinds.filter((k) => (b.bought[k] ?? 0) > 0).map((k) => `${k} ${b.bought[k]}`);
    lines.push(
      `| ${band} | ${b.floors} | ${b.merchants} | ${pct(b.merchantsUnshopped, b.merchants)} | ${b.flasksBought} | ${b.flasksFountain} | ` +
        `${b.flasksPicked} | ${b.flasksDrunk} | ${bought.length > 0 ? bought.join(" / ") : "-"} |`,
    );
  }
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
    const of = (pick: (b: EconomyBandTally) => number): number => sum(DEPTH_BANDS.map((b) => pick(t.bands[b])));
    lines.push(
      `- 瓶（目標: 死亡時の残り 0〜1）: 買った ${of((b) => b.flasksBought)} / 泉で満たした ${of((b) => b.flasksFountain)} / 拾った ${of((b) => b.flasksPicked)}` +
        ` / 飲んだ ${of((b) => b.flasksDrunk)} / 死亡時の残り 平均 ${mean(deaths.map((x) => x.finalFlasks))}`,
    );
  }
  if (t.seen.merchants) {
    const stood = sum(DEPTH_BANDS.map((b) => t.bands[b].merchants));
    const unshopped = sum(DEPTH_BANDS.map((b) => t.bands[b].merchantsUnshopped));
    lines.push(`- 商人: 立った ${stood}、買い物 0 の商人 ${pct(unshopped, stood)}、襲われた ${t.outlawEvents}`);
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
    lines.push(`- 賭け（賭博の部屋を含む）: 払った ${staked} / 得た ${won} / 純益 ${won - staked}`);
    lines.push(...betKindLines(t.bets));
  }
  if (lines.length > 0) lines.push("");
  return lines;
}

/** 賭けの型ごとの回数・勝率・純益と、腕の型の難しさごとの成功率（目標: 運の勝率が期待どおり、腕の易が 60〜80%） */
function betKindLines(bets: Record<string, BetTallyRow>): string[] {
  const known = Object.keys(BET_LABEL).filter((k) => (bets[k]?.placed ?? 0) > 0);
  const unknown = Object.keys(bets)
    .filter((k) => !(k in BET_LABEL) && (bets[k]?.placed ?? 0) > 0)
    .sort();
  const lines: string[] = [];
  for (const kind of [...known, ...unknown]) {
    const row = bets[kind];
    if (!row) continue;
    const tiers = Object.keys(BET_TIER_LABEL)
      .filter((tier) => (row.tiers[tier]?.settled ?? 0) > 0)
      .map((tier) => `${BET_TIER_LABEL[tier]} ${pct(row.tiers[tier]?.won ?? 0, row.tiers[tier]?.settled ?? 0)}`);
    const tierText = tiers.length > 0 ? `（${tiers.join(" / ")}）` : "";
    lines.push(`  - ${BET_LABEL[kind] ?? kind}: ${row.placed} 回、勝率 ${pct(row.won, row.placed)}${tierText}、純益 ${row.paid - row.staked}`);
  }
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
  lines.push(...shopSection(merged));
  lines.push(...optionalSections(list, merged));
  return lines;
}
