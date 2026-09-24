import {
  type CodexSave,
  FIRST_SEEN_SEED_MAX,
  type LinkFirstSeen,
  createCodexSave,
  isBoonKeyString,
  isChainKey,
  isComboKeyString,
  isEnemyKey,
  isFloorKindString,
  isReactionKeyString,
  isRelicKey,
  isRoomKindString,
} from "./codex";
import { isLinkId } from "./links";
import { isRecord, readJson, sanitizeCount, sanitizeCountMap, sanitizeKeyList, writeJson } from "./storage";

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
    combos: sanitizeCountMap(parsed.combos, isComboKeyString),
    firstSeen: sanitizeFirstSeen(parsed.firstSeen),
    floorKinds: sanitizeKeyList(parsed.floorKinds, isFloorKindString),
    roomKinds: sanitizeKeyList(parsed.roomKinds, isRoomKindString),
  };
}

/** 連携の初発見（id → 階とシード）。旧データ（欄が無い）・壊れた項目は黙って落とす */
function sanitizeFirstSeen(v: unknown): Record<string, LinkFirstSeen> {
  const out: Record<string, LinkFirstSeen> = {};
  if (!isRecord(v)) return out;
  for (const [id, entry] of Object.entries(v)) {
    if (!isLinkId(id) || !isRecord(entry)) continue;
    const depth = sanitizeCount(entry.depth);
    if (depth <= 0) continue;
    const seed = typeof entry.seed === "string" ? entry.seed.slice(0, FIRST_SEEN_SEED_MAX) : "";
    out[id] = { depth, seed };
  }
  return out;
}

export function loadCodex(storage?: Storage): CodexSave {
  return parseCodexSave(readJson(CODEX_KEY, storage)) ?? createCodexSave();
}

export function saveCodex(save: CodexSave, storage?: Storage): void {
  writeJson(CODEX_KEY, save, storage);
}
