/**
 * セーブファイルの封筒（ファイル本文の形式）。main プロセスからも使うので node / electron を import しない純関数だけを置く。
 * 封筒の format はファイル形式の版。中身の版はこれまで通りキー末尾の .v1 とストアの version フィールドが担う
 */

export const SAVE_FILE_FORMAT = 1;

/** localStorage キー → save/ 配下のファイル名。ここに無いキーは main が拒否する */
export const SAVE_FILES: Readonly<Record<string, string>> = {
  "roguelike.profile.v1": "profile.json",
  "roguelike.skills.v1": "skills.json",
  "roguelike.craft.v1": "craft.json",
  "roguelike.settings.v1": "settings.json",
  "roguelike.keybinds.v1": "keybinds.json",
  "roguelike.padbinds.v1": "padbinds.json",
  "roguelike.replays.v1": "replays.json",
  "roguelike.codex.v1": "codex.json",
  "roguelike.quests.v1": "quests.json",
  "roguelike.achievements.v1": "achievements.json",
  "roguelike.hub.v1": "hub.json",
};

export interface SaveEnvelope {
  format: typeof SAVE_FILE_FORMAT;
  key: string;
  savedAt: number;
  app: string;
  data: unknown;
}

/** 人が読めて diff できるように整形する */
const ENVELOPE_INDENT = 2;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** ストアの JSON 文字列を封筒に包んだファイル本文。json が壊れていれば例外（ストアは常に JSON.stringify の結果を渡す） */
export function encodeEnvelope(key: string, json: string, savedAt: number, app: string): string {
  const envelope: SaveEnvelope = { format: SAVE_FILE_FORMAT, key, savedAt, app, data: JSON.parse(json) as unknown };
  return JSON.stringify(envelope, null, ENVELOPE_INDENT);
}

/** ファイル本文 → ストアに渡す JSON 文字列。壊れている・key 不一致・未知 format なら null */
export function decodeEnvelope(text: string, key: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.format !== SAVE_FILE_FORMAT || parsed.key !== key) return null;
  if (!("data" in parsed)) return null;
  return JSON.stringify(parsed.data);
}

export function fileForKey(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(SAVE_FILES, key) ? (SAVE_FILES[key] ?? null) : null;
}
