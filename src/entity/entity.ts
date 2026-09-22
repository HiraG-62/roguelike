import type { Point } from "../map/grid";

export interface Stats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
}

export type EntityKind = "player" | "monster";
export type AiKind = "chase";

/**
 * プレイヤーもモンスターも同じ Entity。
 * プレイヤーは「入力で行動を決める Entity」でしかない。
 */
export interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  glyph: string;
  color: string;
  pos: Point;
  stats: Stats;
  /** エネルギー方式ターン制。speed ぶん毎ティック貯まり、ACTION_COST で 1 行動 */
  speed: number;
  energy: number;
  /** 倒したときに得られる経験値 */
  xpValue: number;
  /** モンスターの行動方針。プレイヤーは undefined */
  ai?: AiKind;
}

export const NORMAL_SPEED = 100;

const PLAYER_BASE_STATS: Stats = { hp: 20, maxHp: 20, attack: 4, defense: 1 };

export function createPlayer(id: number, pos: Point): Entity {
  return {
    id,
    kind: "player",
    name: "you",
    glyph: "@",
    color: "#ffffff",
    pos,
    stats: { ...PLAYER_BASE_STATS },
    speed: NORMAL_SPEED,
    energy: 0,
    xpValue: 0,
  };
}

export function isAlive(e: Entity): boolean {
  return e.stats.hp > 0;
}
