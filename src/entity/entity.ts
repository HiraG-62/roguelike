import type { Point } from "../map/grid";

/**
 * プレイヤーもモンスターも同じ Entity。
 * プレイヤーは「入力で行動を決める Entity」でしかない。
 */
export interface Entity {
  id: number;
  name: string;
  glyph: string;
  color: string;
  pos: Point;
  isPlayer: boolean;
}

export function createPlayer(id: number, pos: Point): Entity {
  return { id, name: "you", glyph: "@", color: "#ffffff", pos, isPlayer: true };
}
