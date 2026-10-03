import type { DamageTapEntry } from "../core/state";
import { DOJO } from "../data/tuning";
import type { DojoDamageKind, DojoMeterView } from "./dojoConfig";

/**
 * 稽古の間の計測（docs/ideas/dojo.md）。damageEnemy が積んだ傷の記録（GameState.damageTap）を汲み出して集計する。
 * 時間は state.time（時の流れを掛けた後のゲーム時間）で数える。乱数・実時間を使わない
 */

/** 直近の命中（直近の毎秒の傷の窓に入れる分だけ持つ） */
interface RecentHit {
  time: number;
  amount: number;
}

export interface DojoMeter {
  /** 今の区切りの最初の命中の時刻。null = 区切りの外（時計が止まっている） */
  segmentStart: number | null;
  /** 今の区切りの最後の命中の時刻 */
  lastHitAt: number;
  /** 閉じた区切りの秒の合計 */
  banked: number;
  total: number;
  hits: number;
  crits: number;
  maxHit: number;
  byKind: Record<DojoDamageKind, number>;
  taken: number;
  takenHits: number;
  kills: number;
  recent: RecentHit[];
}

function emptyByKind(): Record<DojoDamageKind, number> {
  return { melee: 0, ranged: 0, skill: 0, dot: 0, other: 0 };
}

export function createDojoMeter(): DojoMeter {
  return {
    segmentStart: null,
    lastHitAt: 0,
    banked: 0,
    total: 0,
    hits: 0,
    crits: 0,
    maxHit: 0,
    byKind: emptyByKind(),
    taken: 0,
    takenHits: 0,
    kills: 0,
    recent: [],
  };
}

/**
 * 最後の命中から DOJO.meterIdleSec 傷が無ければ区切りを閉じる（時計は最後の命中で止める。
 * 待っていた秒を経過に入れると、殴り始めの前後の空白で毎秒の傷が薄まるため）
 */
function closeIdleSegment(meter: DojoMeter, now: number): void {
  if (meter.segmentStart === null) return;
  if (now - meter.lastHitAt < DOJO.meterIdleSec) return;
  meter.banked += meter.lastHitAt - meter.segmentStart;
  meter.segmentStart = null;
}

/** 窓（DOJO.meterWindowSec）より古い命中を捨てる */
function pruneRecent(meter: DojoMeter, now: number): void {
  const from = now - DOJO.meterWindowSec;
  if (meter.recent.length === 0 || (meter.recent[0]?.time ?? now) > from) return;
  meter.recent = meter.recent.filter((h) => h.time > from);
}

/** 与えた傷をまとめて記録する（stepDojo が毎ステップ damageTap を汲み出して渡す） */
export function recordDojoDamage(meter: DojoMeter, entries: readonly DamageTapEntry[], now: number): void {
  closeIdleSegment(meter, now);
  for (const hit of entries) {
    if (hit.amount <= 0) continue;
    if (meter.segmentStart === null) meter.segmentStart = now;
    meter.lastHitAt = now;
    meter.total += hit.amount;
    meter.hits += 1;
    if (hit.crit) meter.crits += 1;
    meter.maxHit = Math.max(meter.maxHit, hit.amount);
    meter.byKind[hit.kind] += hit.amount;
    meter.recent.push({ time: now, amount: hit.amount });
  }
  pruneRecent(meter, now);
}

/** 受けた傷（無傷のときも数える）。hits は回数 */
export function recordDojoTaken(meter: DojoMeter, amount: number, hits: number): void {
  meter.taken += Math.max(0, amount);
  meter.takenHits += Math.max(0, hits);
}

export function recordDojoKills(meter: DojoMeter, n: number): void {
  meter.kills += Math.max(0, n);
}

/** 計測の経過秒（区切りの外では最後の命中で止まっている） */
export function dojoMeterElapsed(meter: DojoMeter, now: number): number {
  if (meter.segmentStart === null) return meter.banked;
  const end = now - meter.lastHitAt < DOJO.meterIdleSec ? now : meter.lastHitAt;
  return meter.banked + Math.max(0, end - meter.segmentStart);
}

export function dojoMeterSnapshot(meter: DojoMeter, now: number): DojoMeterView {
  const elapsed = dojoMeterElapsed(meter, now);
  const from = now - DOJO.meterWindowSec;
  const recentSum = meter.recent.reduce((sum, h) => (h.time > from ? sum + h.amount : sum), 0);
  return {
    elapsed,
    total: meter.total,
    dps: elapsed > 0 ? meter.total / elapsed : 0,
    recentDps: recentSum / DOJO.meterWindowSec,
    hits: meter.hits,
    crits: meter.crits,
    maxHit: meter.maxHit,
    byKind: { ...meter.byKind },
    taken: meter.taken,
    takenHits: meter.takenHits,
    kills: meter.kills,
  };
}
