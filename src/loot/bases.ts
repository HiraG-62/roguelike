import type { Slot } from "./types";

/**
 * ベースアイテム定義。implicit の中身（ロール幅と効果）は affixes.ts の IMPLICITS にあり、
 * ここでは key で参照する（affix と同じ経路で適用・表示するため）。
 */
export interface BaseItemDef {
  key: string;
  name: string;
  slot: Slot;
  /** このベースがドロップし始める itemLevel */
  minLevel: number;
  /** affixes.ts の IMPLICITS の key */
  implicitKey?: string;
}

export const BASES: readonly BaseItemDef[] = [
  // weapon: ダメージ / 速度 / リーチのトレードオフ
  { key: "dagger", name: "Dagger", slot: "weapon", minLevel: 1, implicitKey: "implicit.dagger" },
  { key: "shortsword", name: "Shortsword", slot: "weapon", minLevel: 1, implicitKey: "implicit.shortsword" },
  { key: "longsword", name: "Longsword", slot: "weapon", minLevel: 5, implicitKey: "implicit.longsword" },
  { key: "spear", name: "Spear", slot: "weapon", minLevel: 7, implicitKey: "implicit.spear" },
  { key: "greatsword", name: "Greatsword", slot: "weapon", minLevel: 10, implicitKey: "implicit.greatsword" },

  // gun: 連射 / 弾数 / 貫通
  { key: "pistol", name: "Pistol", slot: "gun", minLevel: 1, implicitKey: "implicit.pistol" },
  { key: "smg", name: "SMG", slot: "gun", minLevel: 4, implicitKey: "implicit.smg" },
  { key: "rifle", name: "Rifle", slot: "gun", minLevel: 8, implicitKey: "implicit.rifle" },
  { key: "shotgun", name: "Shotgun", slot: "gun", minLevel: 12, implicitKey: "implicit.shotgun" },

  // armor: HP / armor
  { key: "cloth", name: "Cloth Robe", slot: "armor", minLevel: 1, implicitKey: "implicit.cloth" },
  { key: "leather", name: "Leather Vest", slot: "armor", minLevel: 3, implicitKey: "implicit.leather" },
  { key: "chain", name: "Chainmail", slot: "armor", minLevel: 8, implicitKey: "implicit.chain" },
  { key: "plate", name: "Plate Armor", slot: "armor", minLevel: 14, implicitKey: "implicit.plate" },

  // boots: 移動 / ダッシュ
  { key: "sandals", name: "Sandals", slot: "boots", minLevel: 1, implicitKey: "implicit.sandals" },
  { key: "boots", name: "Leather Boots", slot: "boots", minLevel: 4, implicitKey: "implicit.boots" },
  { key: "greaves", name: "Greaves", slot: "boots", minLevel: 10, implicitKey: "implicit.greaves" },
  { key: "wingedBoots", name: "Winged Boots", slot: "boots", minLevel: 16, implicitKey: "implicit.wingedBoots" },

  // ring: 小さな汎用 implicit
  { key: "ironRing", name: "Iron Ring", slot: "ring", minLevel: 1, implicitKey: "implicit.ironRing" },
  { key: "rubyRing", name: "Ruby Ring", slot: "ring", minLevel: 3, implicitKey: "implicit.rubyRing" },
  { key: "sapphireRing", name: "Sapphire Ring", slot: "ring", minLevel: 3, implicitKey: "implicit.sapphireRing" },
  { key: "goldRing", name: "Gold Ring", slot: "ring", minLevel: 6, implicitKey: "implicit.goldRing" },
  { key: "bloodRing", name: "Blood Ring", slot: "ring", minLevel: 10, implicitKey: "implicit.bloodRing" },

  // amulet: ユーティリティ寄り
  { key: "jadeAmulet", name: "Jade Amulet", slot: "amulet", minLevel: 1, implicitKey: "implicit.jadeAmulet" },
  { key: "amberAmulet", name: "Amber Amulet", slot: "amulet", minLevel: 1, implicitKey: "implicit.amberAmulet" },
  { key: "onyxAmulet", name: "Onyx Amulet", slot: "amulet", minLevel: 5, implicitKey: "implicit.onyxAmulet" },
  { key: "lapisAmulet", name: "Lapis Amulet", slot: "amulet", minLevel: 8, implicitKey: "implicit.lapisAmulet" },
  { key: "coralAmulet", name: "Coral Amulet", slot: "amulet", minLevel: 12, implicitKey: "implicit.coralAmulet" },
];

const BASE_BY_KEY: ReadonlyMap<string, BaseItemDef> = new Map(BASES.map((b) => [b.key, b]));

export function baseDef(key: string): BaseItemDef | undefined {
  return BASE_BY_KEY.get(key);
}

/** slot のベースのうち itemLevel で解禁済みのもの */
export function basesForSlot(slot: Slot, itemLevel: number): BaseItemDef[] {
  return BASES.filter((b) => b.slot === slot && b.minLevel <= itemLevel);
}
