import {
  type CodexSave,
  createCodexSave,
  isBoonKeyString,
  isChainKey,
  isEnemyKey,
  isFloorKindString,
  isReactionKeyString,
  isRelicKey,
  isRoomKindString,
} from "./codex";
import { isRecord, readJson, sanitizeCountMap, sanitizeKeyList, writeJson } from "./storage";

/** 図鑑の永続化。壊れたデータ・未知の version は黙って空の図鑑へ落とす */
export const CODEX_KEY = "roguelike.codex.v1";
const CURRENT_VERSION = 1;

export function parseCodexSave(parsed: unknown): CodexSave | null {
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return null;
  return {
    version: CURRENT_VERSION,
    enemiesSeen: sanitizeKeyList(parsed.enemiesSeen, isEnemyKey),
    enemyKills: sanitizeCountMap(parsed.enemyKills, isEnemyKey),
    relics: sanitizeKeyList(parsed.relics, isRelicKey),
    boons: sanitizeKeyList(parsed.boons, isBoonKeyString),
    reactions: sanitizeCountMap(parsed.reactions, isReactionKeyString),
    chains: sanitizeCountMap(parsed.chains, isChainKey),
    floorKinds: sanitizeKeyList(parsed.floorKinds, isFloorKindString),
    roomKinds: sanitizeKeyList(parsed.roomKinds, isRoomKindString),
  };
}

export function loadCodex(storage?: Storage): CodexSave {
  return parseCodexSave(readJson(CODEX_KEY, storage)) ?? createCodexSave();
}

export function saveCodex(save: CodexSave, storage?: Storage): void {
  writeJson(CODEX_KEY, save, storage);
}
