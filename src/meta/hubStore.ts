/**
 * 拠点の永続化。持つのは「建った」演出を 1 回だけ見せるための既読リストだけ（設備そのものは既存の保存データから導く）。
 * 壊れたデータ・未知の version は黙って既定値へ落とす
 */
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
  return save;
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
