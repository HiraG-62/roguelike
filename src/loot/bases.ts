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
  { key: "dagger", name: "短剣", slot: "weapon", minLevel: 1, implicitKey: "implicit.dagger" },
  { key: "shortsword", name: "小剣", slot: "weapon", minLevel: 1, implicitKey: "implicit.shortsword" },
  { key: "longsword", name: "長剣", slot: "weapon", minLevel: 5, implicitKey: "implicit.longsword" },
  { key: "spear", name: "槍", slot: "weapon", minLevel: 7, implicitKey: "implicit.spear" },
  { key: "greatsword", name: "大剣", slot: "weapon", minLevel: 10, implicitKey: "implicit.greatsword" },
  { key: "twinblades", name: "双剣", slot: "weapon", minLevel: 6, implicitKey: "implicit.twinblades" },
  { key: "warpick", name: "戦鎚", slot: "weapon", minLevel: 13, implicitKey: "implicit.warpick" },

  // gun: 連射 / 弾数 / 貫通
  { key: "pistol", name: "拳銃", slot: "gun", minLevel: 1, implicitKey: "implicit.pistol" },
  { key: "smg", name: "短機関銃", slot: "gun", minLevel: 4, implicitKey: "implicit.smg" },
  { key: "rifle", name: "小銃", slot: "gun", minLevel: 8, implicitKey: "implicit.rifle" },
  { key: "shotgun", name: "散弾銃", slot: "gun", minLevel: 12, implicitKey: "implicit.shotgun" },
  { key: "revolver", name: "回転式拳銃", slot: "gun", minLevel: 7, implicitKey: "implicit.revolver" },
  { key: "railgun", name: "電磁砲", slot: "gun", minLevel: 16, implicitKey: "implicit.railgun" },

  // armor: HP / armor
  { key: "cloth", name: "布の服", slot: "armor", minLevel: 1, implicitKey: "implicit.cloth" },
  { key: "leather", name: "革鎧", slot: "armor", minLevel: 3, implicitKey: "implicit.leather" },
  { key: "chain", name: "鎖帷子", slot: "armor", minLevel: 8, implicitKey: "implicit.chain" },
  { key: "plate", name: "板金鎧", slot: "armor", minLevel: 14, implicitKey: "implicit.plate" },
  { key: "berserkerHide", name: "狂戦士の皮鎧", slot: "armor", minLevel: 6, implicitKey: "implicit.berserkerHide" },

  // boots: 移動 / ダッシュ
  { key: "sandals", name: "草鞋", slot: "boots", minLevel: 1, implicitKey: "implicit.sandals" },
  { key: "boots", name: "長靴", slot: "boots", minLevel: 4, implicitKey: "implicit.boots" },
  { key: "greaves", name: "脛当", slot: "boots", minLevel: 10, implicitKey: "implicit.greaves" },
  { key: "wingedBoots", name: "翼靴", slot: "boots", minLevel: 16, implicitKey: "implicit.wingedBoots" },
  { key: "lungingBoots", name: "跳躍靴", slot: "boots", minLevel: 7, implicitKey: "implicit.lungingBoots" },

  // ring: 小さな汎用 implicit
  { key: "ironRing", name: "鉄の指輪", slot: "ring", minLevel: 1, implicitKey: "implicit.ironRing" },
  { key: "rubyRing", name: "ルビーの指輪", slot: "ring", minLevel: 3, implicitKey: "implicit.rubyRing" },
  { key: "sapphireRing", name: "サファイアの指輪", slot: "ring", minLevel: 3, implicitKey: "implicit.sapphireRing" },
  { key: "goldRing", name: "金の指輪", slot: "ring", minLevel: 6, implicitKey: "implicit.goldRing" },
  { key: "bloodRing", name: "血の指輪", slot: "ring", minLevel: 10, implicitKey: "implicit.bloodRing" },
  { key: "voidBand", name: "虚無の指輪", slot: "ring", minLevel: 13, implicitKey: "implicit.voidBand" },

  // amulet: ユーティリティ寄り
  { key: "jadeAmulet", name: "翡翠の首飾り", slot: "amulet", minLevel: 1, implicitKey: "implicit.jadeAmulet" },
  { key: "amberAmulet", name: "琥珀の首飾り", slot: "amulet", minLevel: 1, implicitKey: "implicit.amberAmulet" },
  { key: "onyxAmulet", name: "黒曜石の首飾り", slot: "amulet", minLevel: 5, implicitKey: "implicit.onyxAmulet" },
  { key: "lapisAmulet", name: "ラピスの首飾り", slot: "amulet", minLevel: 8, implicitKey: "implicit.lapisAmulet" },
  { key: "coralAmulet", name: "珊瑚の首飾り", slot: "amulet", minLevel: 12, implicitKey: "implicit.coralAmulet" },
  { key: "duskAmulet", name: "黄昏の首飾り", slot: "amulet", minLevel: 9, implicitKey: "implicit.duskAmulet" },
];

const BASE_BY_KEY: ReadonlyMap<string, BaseItemDef> = new Map(BASES.map((b) => [b.key, b]));

export function baseDef(key: string): BaseItemDef | undefined {
  return BASE_BY_KEY.get(key);
}

/** slot のベースのうち itemLevel で解禁済みのもの */
export function basesForSlot(slot: Slot, itemLevel: number): BaseItemDef[] {
  return BASES.filter((b) => b.slot === slot && b.minLevel <= itemLevel);
}
