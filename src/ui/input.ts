import type { Direction } from "../core/state";

export type Command = { type: "move"; dir: Direction } | { type: "descend" };

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

export function keyToCommand(key: string): Command | null {
  if (key === KEY_DESCEND) return { type: "descend" };
  const dir = KEY_TO_DIRECTION[key];
  return dir ? { type: "move", dir } : null;
}
