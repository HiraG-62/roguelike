import type { AiKind, Stats } from "../entity/entity";

export interface MonsterDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  stats: Stats;
  speed: number;
  xpValue: number;
  ai: AiKind;
  /** 出現する深さの範囲（両端含む） */
  minDepth: number;
  maxDepth: number;
}

function def(
  key: string,
  name: string,
  glyph: string,
  color: string,
  hp: number,
  attack: number,
  defense: number,
  speed: number,
  xpValue: number,
  minDepth: number,
  maxDepth: number,
): MonsterDef {
  return {
    key,
    name,
    glyph,
    color,
    stats: { hp, maxHp: hp, attack, defense },
    speed,
    xpValue,
    ai: "chase",
    minDepth,
    maxDepth,
  };
}

export const MONSTERS: readonly MonsterDef[] = [
  def("rat", "rat", "r", "#b08060", 3, 2, 0, 120, 2, 1, 3),
  def("jackal", "jackal", "j", "#c0a040", 4, 3, 0, 130, 3, 1, 4),
  def("goblin", "goblin", "g", "#60c060", 6, 3, 1, 100, 5, 1, 6),
  def("kobold", "kobold", "k", "#d06060", 8, 4, 1, 100, 7, 2, 8),
  def("orc", "orc", "o", "#40a040", 12, 5, 2, 100, 12, 3, 12),
  def("ogre", "ogre", "O", "#a08040", 20, 8, 2, 80, 25, 5, 99),
  def("troll", "troll", "T", "#308030", 26, 9, 3, 90, 40, 7, 99),
];

export function monstersForDepth(depth: number): MonsterDef[] {
  return MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth);
}
