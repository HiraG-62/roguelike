import type { Direction } from "../core/state";

export type Command =
  | { type: "move"; dir: Direction }
  | { type: "descend" }
  | { type: "newGameWithSeed" }
  | { type: "restart" };

/** 矢印 / hjkl / yubn（斜め）/ テンキー を Direction に変換する */
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  h: { dx: -1, dy: 0 },
  l: { dx: 1, dy: 0 },
  k: { dx: 0, dy: -1 },
  j: { dx: 0, dy: 1 },
  y: { dx: -1, dy: -1 },
  u: { dx: 1, dy: -1 },
  b: { dx: -1, dy: 1 },
  n: { dx: 1, dy: 1 },
  "4": { dx: -1, dy: 0 },
  "6": { dx: 1, dy: 0 },
  "8": { dx: 0, dy: -1 },
  "2": { dx: 0, dy: 1 },
  "7": { dx: -1, dy: -1 },
  "9": { dx: 1, dy: -1 },
  "1": { dx: -1, dy: 1 },
  "3": { dx: 1, dy: 1 },
};

const KEY_DESCEND = ">";
/** 大文字 = Shift 付き。小文字 n は斜め移動なので衝突しない */
const KEY_NEW_GAME_WITH_SEED = "N";
const KEY_RESTART = "R";

export function keyToCommand(key: string): Command | null {
  if (key === KEY_DESCEND) return { type: "descend" };
  if (key === KEY_NEW_GAME_WITH_SEED) return { type: "newGameWithSeed" };
  if (key === KEY_RESTART) return { type: "restart" };
  const dir = KEY_TO_DIRECTION[key];
  return dir ? { type: "move", dir } : null;
}

/** シード入力モードのキー処理。純関数で新しいバッファを返す */
export type SeedEntryResult =
  | { type: "typing"; buffer: string }
  | { type: "submit"; buffer: string }
  | { type: "cancel" };

const SEED_MAX_LENGTH = 32;

export function handleSeedEntryKey(buffer: string, key: string): SeedEntryResult {
  if (key === "Enter") return { type: "submit", buffer };
  if (key === "Escape") return { type: "cancel" };
  if (key === "Backspace") return { type: "typing", buffer: buffer.slice(0, -1) };
  if (key.length === 1 && buffer.length < SEED_MAX_LENGTH) {
    return { type: "typing", buffer: buffer + key };
  }
  return { type: "typing", buffer };
}
