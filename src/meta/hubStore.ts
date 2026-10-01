/**
 * 拠点の永続化。持つのは「建った」演出を 1 回だけ見せるための既読リストだけ（設備そのものは既存の保存データから導く）。
 * 壊れたデータ・未知の version は黙って既定値へ落とす
 */
import { ENEMIES } from "../data/enemies";
import type { HallOutcome } from "../system/bossHall";
import { FACILITY_KEYS, type FacilityKey } from "./hub";
import { isRecord, readJson, sanitizeCount, sanitizeKeyList, writeJson } from "./storage";

export const HUB_KEY = "roguelike.hub.v1";
const CURRENT_VERSION = 1;

export interface HubSave {
  version: 1;
  seenFacilities: FacilityKey[];
  /**
   * これまでに寄進した銭の総額（章の境の祠。system/donation.ts）。任意項目で、無い・数値以外・0 は同じ 0 として扱う
   * （version は上げない。古い保存データにも無いだけ）。ゲーム進行には効かない
   */
  donated?: number;
  /**
   * ボスの間の記録（ボスの key → 記録。system/bossHall.ts）。任意項目で、無い = 1 度も挑んでいない（version は上げない）。
   * ゲーム進行には効かない
   */
  hall?: Record<string, HallRecord>;
}

/** ボスの間の 1 体ぶんの記録。best / fewest は撃破した挑戦だけから取る */
export interface HallRecord {
  /** 部屋が封鎖された挑戦の数 */
  tries: number;
  wins: number;
  /** 撃破までの最短の秒（封鎖から） */
  bestSeconds?: number;
  /** 撃破した挑戦の最少の被弾 */
  fewestHits?: number;
}

const FACILITY_SET: ReadonlySet<string> = new Set(FACILITY_KEYS);
const isFacilityKey = (k: string): k is FacilityKey => FACILITY_SET.has(k);

export function createHubSave(): HubSave {
  return { version: CURRENT_VERSION, seenFacilities: [] };
}

export function parseHubSave(v: unknown): HubSave | null {
  if (!isRecord(v) || v.version !== CURRENT_VERSION) return null;
  const save: HubSave = { version: CURRENT_VERSION, seenFacilities: sanitizeKeyList(v.seenFacilities, isFacilityKey).filter(isFacilityKey) };
  const donated = sanitizeCount(v.donated);
  if (donated > 0) save.donated = donated;
  const hall = sanitizeHall(v.hall);
  if (Object.keys(hall).length > 0) save.hall = hall;
  return save;
}

/** ボスの間に出てくる key（ボス本体）。消えたボスの記録は読み捨てる */
const HALL_KEYS: ReadonlySet<string> = new Set(ENEMIES.filter((d) => d.boss === true).map((d) => d.key));

/** 0 以上の有限の秒。壊れた値は undefined（欄を書かない） */
function sanitizeSeconds(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function sanitizeHallRecord(v: unknown): HallRecord | null {
  if (!isRecord(v)) return null;
  const tries = sanitizeCount(v.tries);
  if (tries <= 0) return null;
  const record: HallRecord = { tries, wins: Math.min(tries, sanitizeCount(v.wins)) };
  const best = sanitizeSeconds(v.bestSeconds);
  if (record.wins > 0 && best !== undefined) record.bestSeconds = best;
  if (record.wins > 0 && typeof v.fewestHits === "number" && Number.isFinite(v.fewestHits)) record.fewestHits = sanitizeCount(v.fewestHits);
  return record;
}

function sanitizeHall(v: unknown): Record<string, HallRecord> {
  const out: Record<string, HallRecord> = {};
  if (!isRecord(v)) return out;
  for (const [key, raw] of Object.entries(v)) {
    if (!HALL_KEYS.has(key)) continue;
    const record = sanitizeHallRecord(raw);
    if (record) out[key] = record;
  }
  return out;
}

/** そのボスのボスの間の記録（1 度も封鎖まで挑んでいなければ undefined） */
export function hallRecordOf(save: HubSave, key: string): HallRecord | undefined {
  return save.hall?.[key];
}

function minDefined(a: number | undefined, b: number): number {
  return a === undefined ? b : Math.min(a, b);
}

/**
 * 挑戦 1 回ぶんを足した新しい保存データを返す（元は変えない）。封鎖前にやめた挑戦（locked でない）は数えず同じ内容。
 * 撃破なら撃破の回数と最速・最少の被弾を更新する
 */
export function addHallResult(save: HubSave, key: string, outcome: HallOutcome): HubSave {
  if (!outcome.locked) return { ...save };
  const before = hallRecordOf(save, key);
  const next: HallRecord = { ...before, tries: (before?.tries ?? 0) + 1, wins: before?.wins ?? 0 };
  if (outcome.won) {
    next.wins += 1;
    next.bestSeconds = minDefined(before?.bestSeconds, outcome.seconds);
    next.fewestHits = minDefined(before?.fewestHits, outcome.hits);
  }
  return { ...save, hall: { ...save.hall, [key]: next } };
}

/** 寄進の総額（無ければ 0） */
export function donatedOf(save: HubSave): number {
  return sanitizeCount(save.donated);
}

/** ラン 1 回ぶんの寄進を足した新しい保存データを返す（元は変えない）。足す額が 0 以下なら同じ内容 */
export function addDonation(save: HubSave, amount: number): HubSave {
  const total = donatedOf(save) + sanitizeCount(amount);
  return total > 0 ? { ...save, donated: total } : { ...save };
}

export function loadHub(storage?: Storage): HubSave {
  return parseHubSave(readJson(HUB_KEY, storage)) ?? createHubSave();
}

export function saveHub(save: HubSave, storage?: Storage): void {
  writeJson(HUB_KEY, save, storage);
}

/** 設備を既読にした新しい保存データを返す（元は変えない） */
export function markFacilitiesSeen(save: HubSave, keys: readonly FacilityKey[]): HubSave {
  const seen = new Set<FacilityKey>([...save.seenFacilities, ...keys]);
  return { ...save, version: CURRENT_VERSION, seenFacilities: FACILITY_KEYS.filter((k) => seen.has(k)) };
}
