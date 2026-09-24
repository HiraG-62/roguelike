/**
 * 拠点の永続化。持つのは「建った」演出を 1 回だけ見せるための既読リストだけ（設備そのものは既存の保存データから導く）。
 * 壊れたデータ・未知の version は黙って既定値へ落とす
 */
import { FACILITY_KEYS, type FacilityKey } from "./hub";
import { isRecord, readJson, sanitizeKeyList, writeJson } from "./storage";

export const HUB_KEY = "roguelike.hub.v1";
const CURRENT_VERSION = 1;

export interface HubSave {
  version: 1;
  seenFacilities: FacilityKey[];
}

const FACILITY_SET: ReadonlySet<string> = new Set(FACILITY_KEYS);
const isFacilityKey = (k: string): k is FacilityKey => FACILITY_SET.has(k);

export function createHubSave(): HubSave {
  return { version: CURRENT_VERSION, seenFacilities: [] };
}

export function parseHubSave(v: unknown): HubSave | null {
  if (!isRecord(v) || v.version !== CURRENT_VERSION) return null;
  return { version: CURRENT_VERSION, seenFacilities: sanitizeKeyList(v.seenFacilities, isFacilityKey).filter(isFacilityKey) };
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
  return { version: CURRENT_VERSION, seenFacilities: FACILITY_KEYS.filter((k) => seen.has(k)) };
}
