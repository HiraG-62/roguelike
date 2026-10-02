import type { Slot } from "../loot/types";

/**
 * 装備画面の各頁（ui / render）と、床のツールチップ・図鑑が共有する小道具。
 * ui と render の循環 import を避けるためにここへ置く
 */

/** 部位の表示名。loot/types.ts の Slot は英語のキーのまま */
export const SLOT_LABEL: Readonly<Record<Slot, string>> = {
  mainHand: "右手",
  offHand: "左手",
  head: "頭",
  armor: "体",
  boots: "足",
  ring: "指輪",
  amulet: "首飾り",
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}
