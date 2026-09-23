import type { MovesetKey, ShotKey } from "../data/weapons";
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
  /** 余白の上乗せ（襤褸）。器の容量（generator.ts の VESSEL_CAPACITY）は超えない */
  marginBonus?: number;
  /** 武器ベースの武器種（src/data/weapons.ts）。武器なしは剣 */
  moveset?: MovesetKey;
  /** 銃ベースの射撃の型。銃なしは単発 */
  shot?: ShotKey;
}

export const BASES: readonly BaseItemDef[] = [
  // weapon: ダメージ / 速度 / リーチのトレードオフ
  { key: "dagger", name: "短剣", slot: "weapon", minLevel: 1, implicitKey: "implicit.dagger", moveset: "sword" },
  { key: "shortsword", name: "小剣", slot: "weapon", minLevel: 1, implicitKey: "implicit.shortsword", moveset: "sword" },
  { key: "longsword", name: "長剣", slot: "weapon", minLevel: 5, implicitKey: "implicit.longsword", moveset: "sword" },
  { key: "spear", name: "槍", slot: "weapon", minLevel: 7, implicitKey: "implicit.spear", moveset: "spear" },
  { key: "greatsword", name: "大剣", slot: "weapon", minLevel: 10, implicitKey: "implicit.greatsword", moveset: "greatsword" },
  { key: "twinblades", name: "双剣", slot: "weapon", minLevel: 6, implicitKey: "implicit.twinblades", moveset: "twinBlades" },
  { key: "warpick", name: "戦鎚", slot: "weapon", minLevel: 13, implicitKey: "implicit.warpick", moveset: "cleaver" },
  { key: "machete", name: "鉈", slot: "weapon", minLevel: 3, implicitKey: "implicit.machete", moveset: "cleaver" },
  { key: "rapier", name: "刺突剣", slot: "weapon", minLevel: 5, implicitKey: "implicit.rapier", moveset: "spear" },
  { key: "staff", name: "棍", slot: "weapon", minLevel: 4, implicitKey: "implicit.staff", moveset: "staff" },
  { key: "scythe", name: "大鎌", slot: "weapon", minLevel: 11, implicitKey: "implicit.scythe", moveset: "scythe" },
  // 武器種の器（implicit なし。型そのものが個性）
  { key: "gauntlets", name: "手甲", slot: "weapon", minLevel: 3, moveset: "fists" },
  { key: "whip", name: "鞭", slot: "weapon", minLevel: 6, moveset: "whip" },
  { key: "wand", name: "杖", slot: "weapon", minLevel: 5, moveset: "wand" },

  // gun: 連射 / 弾数 / 貫通
  { key: "pistol", name: "拳銃", slot: "gun", minLevel: 1, implicitKey: "implicit.pistol", shot: "single" },
  { key: "smg", name: "短機関銃", slot: "gun", minLevel: 4, implicitKey: "implicit.smg", shot: "rapid" },
  { key: "rifle", name: "小銃", slot: "gun", minLevel: 8, implicitKey: "implicit.rifle", shot: "pierce" },
  { key: "shotgun", name: "散弾銃", slot: "gun", minLevel: 12, implicitKey: "implicit.shotgun", shot: "spread" },
  { key: "revolver", name: "回転式拳銃", slot: "gun", minLevel: 7, implicitKey: "implicit.revolver", shot: "single" },
  { key: "railgun", name: "電磁砲", slot: "gun", minLevel: 16, implicitKey: "implicit.railgun", shot: "pierce" },
  { key: "throwingKnives", name: "投げ短剣", slot: "gun", minLevel: 2, implicitKey: "implicit.throwingKnives", shot: "rapid" },
  { key: "blowgun", name: "吹き矢", slot: "gun", minLevel: 6, implicitKey: "implicit.blowgun", shot: "homing" },
  { key: "matchlock", name: "火縄銃", slot: "gun", minLevel: 9, implicitKey: "implicit.matchlock", shot: "charge" },
  // 射撃の型の器（implicit なし）
  { key: "ricochetGun", name: "跳ね銃", slot: "gun", minLevel: 5, shot: "ricochet" },
  { key: "mineLauncher", name: "置き撃ち筒", slot: "gun", minLevel: 10, shot: "mine" },

  // armor: HP / armor
  { key: "cloth", name: "布の服", slot: "armor", minLevel: 1, implicitKey: "implicit.cloth" },
  { key: "leather", name: "革鎧", slot: "armor", minLevel: 3, implicitKey: "implicit.leather" },
  { key: "chain", name: "鎖帷子", slot: "armor", minLevel: 8, implicitKey: "implicit.chain" },
  { key: "plate", name: "板金鎧", slot: "armor", minLevel: 14, implicitKey: "implicit.plate" },
  { key: "berserkerHide", name: "狂戦士の皮鎧", slot: "armor", minLevel: 6, implicitKey: "implicit.berserkerHide" },
  // 襤褸: implicit を持たない代わりに余白が 1 多い（育てるための器）
  { key: "rags", name: "襤褸", slot: "armor", minLevel: 1, marginBonus: 1 },
  { key: "robe", name: "法衣", slot: "armor", minLevel: 5, implicitKey: "implicit.robe" },
  { key: "scale", name: "鱗鎧", slot: "armor", minLevel: 9, implicitKey: "implicit.scale" },
  { key: "spiked", name: "棘甲", slot: "armor", minLevel: 11, implicitKey: "implicit.spiked" },

  // boots: 移動 / ダッシュ
  { key: "sandals", name: "草鞋", slot: "boots", minLevel: 1, implicitKey: "implicit.sandals" },
  { key: "boots", name: "長靴", slot: "boots", minLevel: 4, implicitKey: "implicit.boots" },
  { key: "greaves", name: "脛当", slot: "boots", minLevel: 10, implicitKey: "implicit.greaves" },
  { key: "wingedBoots", name: "翼靴", slot: "boots", minLevel: 16, implicitKey: "implicit.wingedBoots" },
  { key: "lungingBoots", name: "跳躍靴", slot: "boots", minLevel: 7, implicitKey: "implicit.lungingBoots" },
  { key: "tabi", name: "忍び足袋", slot: "boots", minLevel: 5, implicitKey: "implicit.tabi" },
  { key: "ironGeta", name: "鉄下駄", slot: "boots", minLevel: 6, implicitKey: "implicit.ironGeta" },
  { key: "snowBoots", name: "雪沓", slot: "boots", minLevel: 8, implicitKey: "implicit.snowBoots" },

  // ring: 小さな汎用 implicit
  { key: "ironRing", name: "鉄の指輪", slot: "ring", minLevel: 1, implicitKey: "implicit.ironRing" },
  { key: "rubyRing", name: "ルビーの指輪", slot: "ring", minLevel: 3, implicitKey: "implicit.rubyRing" },
  { key: "sapphireRing", name: "サファイアの指輪", slot: "ring", minLevel: 3, implicitKey: "implicit.sapphireRing" },
  { key: "goldRing", name: "金の指輪", slot: "ring", minLevel: 6, implicitKey: "implicit.goldRing" },
  { key: "bloodRing", name: "血の指輪", slot: "ring", minLevel: 10, implicitKey: "implicit.bloodRing" },
  { key: "voidBand", name: "虚無の指輪", slot: "ring", minLevel: 13, implicitKey: "implicit.voidBand" },
  { key: "boneRing", name: "骨の指輪", slot: "ring", minLevel: 4, implicitKey: "implicit.boneRing" },
  { key: "signet", name: "印章指輪", slot: "ring", minLevel: 5, implicitKey: "implicit.signet" },
  { key: "twinRing", name: "双頭の指輪", slot: "ring", minLevel: 8, implicitKey: "implicit.twinRing" },
  { key: "blackIronRing", name: "黒鉄の指輪", slot: "ring", minLevel: 13, implicitKey: "implicit.blackIronRing" },

  // amulet: ユーティリティ寄り
  { key: "jadeAmulet", name: "翡翠の首飾り", slot: "amulet", minLevel: 1, implicitKey: "implicit.jadeAmulet" },
  { key: "amberAmulet", name: "琥珀の首飾り", slot: "amulet", minLevel: 1, implicitKey: "implicit.amberAmulet" },
  { key: "onyxAmulet", name: "黒曜石の首飾り", slot: "amulet", minLevel: 5, implicitKey: "implicit.onyxAmulet" },
  { key: "lapisAmulet", name: "ラピスの首飾り", slot: "amulet", minLevel: 8, implicitKey: "implicit.lapisAmulet" },
  { key: "coralAmulet", name: "珊瑚の首飾り", slot: "amulet", minLevel: 12, implicitKey: "implicit.coralAmulet" },
  { key: "duskAmulet", name: "黄昏の首飾り", slot: "amulet", minLevel: 9, implicitKey: "implicit.duskAmulet" },
  { key: "rosary", name: "数珠", slot: "amulet", minLevel: 3, implicitKey: "implicit.rosary" },
  { key: "fangNecklace", name: "牙の首飾り", slot: "amulet", minLevel: 6, implicitKey: "implicit.fangNecklace" },
  { key: "bell", name: "鈴", slot: "amulet", minLevel: 7, implicitKey: "implicit.bell" },
];

const BASE_BY_KEY: ReadonlyMap<string, BaseItemDef> = new Map(BASES.map((b) => [b.key, b]));

export function baseDef(key: string): BaseItemDef | undefined {
  return BASE_BY_KEY.get(key);
}

/** slot のベースのうち itemLevel で解禁済みのもの */
export function basesForSlot(slot: Slot, itemLevel: number): BaseItemDef[] {
  return BASES.filter((b) => b.slot === slot && b.minLevel <= itemLevel);
}
