import { type GameMap, Tile, getTile } from "../map/grid";

/** 座標ハッシュ（描画のばらつき用。ゲーム rng は消費しない） */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export function floorVariant(x: number, y: number, count: number): number {
  if (count <= 1) return 0;
  return tileHash(x, y) % count;
}

export type WallStyle = "face" | "top" | "none";

/** 下が床なら手前面、周囲に床があれば天面、完全に埋まっていれば描かない */
export function wallStyle(map: GameMap, x: number, y: number): WallStyle {
  if (getTile(map, x, y + 1) !== Tile.Wall) return "face";
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (getTile(map, x + dx, y + dy) !== Tile.Wall) return "top";
    }
  }
  return "none";
}

/** sin で min..max を往復する */
export function pulse(time: number, speed: number, min: number, max: number): number {
  return min + (max - min) * (0.5 + 0.5 * Math.sin(time * speed));
}

export interface TooltipFit {
  lineH: number;
  small: boolean;
  /** 実際に描く行数 */
  shown: number;
  height: number;
}

/**
 * ツールチップを行数に合わせて伸ばす。maxLines を超えるか高さが足りなければ小さい行高に切り替える。
 */
export function fitTooltip(
  lineCount: number,
  lineH: number,
  smallLineH: number,
  maxLines: number,
  maxHeight: number,
  pad: number,
): TooltipFit {
  const normalFits = lineCount <= maxLines && lineCount * lineH + pad <= maxHeight;
  if (normalFits) return { lineH, small: false, shown: lineCount, height: lineCount * lineH + pad };
  const capacity = Math.max(1, Math.floor((maxHeight - pad) / smallLineH));
  const shown = Math.min(lineCount, capacity);
  return { lineH: smallLineH, small: true, shown, height: shown * smallLineH + pad };
}
