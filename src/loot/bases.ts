import { BALANCE } from "../data/balance";
import { GUN_MOVESETS, type MovesetKey } from "../data/weapons";
import type { Slot } from "./types";

/** ベースごとの minLevel / marginBonus（数値のみ）。src/data/balance/loot/ の "bases" */
const B = BALANCE.loot.bases;

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
  /** 武器ベースの武器種（src/data/weapons.ts）。武器なしは剣。銃の家系のベースは自分の弾を持つ（src/loot/bullets.ts） */
  moveset?: MovesetKey;
}

export const BASES: readonly BaseItemDef[] = [
  // weapon: ダメージ / 速度 / リーチのトレードオフ
  { key: "dagger", name: "短剣", slot: "mainHand", minLevel: B.dagger.minLevel, implicitKey: "implicit.dagger", moveset: "sword" },
  { key: "shortsword", name: "小剣", slot: "mainHand", minLevel: B.shortsword.minLevel, implicitKey: "implicit.shortsword", moveset: "sword" },
  { key: "longsword", name: "長剣", slot: "mainHand", minLevel: B.longsword.minLevel, implicitKey: "implicit.longsword", moveset: "sword" },
  { key: "spear", name: "槍", slot: "mainHand", minLevel: B.spear.minLevel, implicitKey: "implicit.spear", moveset: "spear" },
  { key: "greatsword", name: "大剣", slot: "mainHand", minLevel: B.greatsword.minLevel, implicitKey: "implicit.greatsword", moveset: "greatsword" },
  { key: "twinblades", name: "双剣", slot: "mainHand", minLevel: B.twinblades.minLevel, implicitKey: "implicit.twinblades", moveset: "twinBlades" },
  { key: "warpick", name: "戦鎚", slot: "mainHand", minLevel: B.warpick.minLevel, implicitKey: "implicit.warpick", moveset: "hammer" },
  { key: "machete", name: "鉈", slot: "mainHand", minLevel: B.machete.minLevel, implicitKey: "implicit.machete", moveset: "cleaver" },
  { key: "rapier", name: "刺突剣", slot: "mainHand", minLevel: B.rapier.minLevel, implicitKey: "implicit.rapier", moveset: "spear" },
  { key: "staff", name: "棍", slot: "mainHand", minLevel: B.staff.minLevel, implicitKey: "implicit.staff", moveset: "staff" },
  { key: "scythe", name: "大鎌", slot: "mainHand", minLevel: B.scythe.minLevel, implicitKey: "implicit.scythe", moveset: "scythe" },
  // 武器種の器（implicit なし。型そのものが個性）
  { key: "gauntlets", name: "手甲", slot: "mainHand", minLevel: B.gauntlets.minLevel, moveset: "fists" },
  { key: "whip", name: "鞭", slot: "mainHand", minLevel: B.whip.minLevel, moveset: "whip" },
  { key: "wand", name: "杖", slot: "mainHand", minLevel: B.wand.minLevel, moveset: "wand" },
  // 2026-09 第 2 弾: 武器種ごとに器を選べるように（implicit で個性を付ける）
  { key: "katana", name: "打刀", slot: "mainHand", minLevel: B.katana.minLevel, implicitKey: "implicit.katana", moveset: "katana" },
  { key: "zanbato", name: "斬馬刀", slot: "mainHand", minLevel: B.zanbato.minLevel, implicitKey: "implicit.zanbato", moveset: "greatsword" },
  { key: "twinDaggers", name: "双短刀", slot: "mainHand", minLevel: B.twinDaggers.minLevel, implicitKey: "implicit.twinDaggers", moveset: "twinBlades" },
  { key: "halberd", name: "矛槍", slot: "mainHand", minLevel: B.halberd.minLevel, implicitKey: "implicit.halberd", moveset: "spear" },
  { key: "sickle", name: "小鎌", slot: "mainHand", minLevel: B.sickle.minLevel, implicitKey: "implicit.sickle", moveset: "scythe" },
  { key: "cestus", name: "鉄拳", slot: "mainHand", minLevel: B.cestus.minLevel, implicitKey: "implicit.cestus", moveset: "fists" },
  { key: "chainWhip", name: "鎖鞭", slot: "mainHand", minLevel: B.chainWhip.minLevel, implicitKey: "implicit.chainWhip", moveset: "whip" },
  { key: "shakujo", name: "錫杖", slot: "mainHand", minLevel: B.shakujo.minLevel, implicitKey: "implicit.shakujo", moveset: "staff" },
  { key: "crystalWand", name: "水晶杖", slot: "mainHand", minLevel: B.crystalWand.minLevel, implicitKey: "implicit.crystalWand", moveset: "wand" },
  // 2026-09-24 レーン B: 新しい武器種の器（序盤の器は implicit なし、後半の器は implicit で個性を付ける）
  { key: "wakizashi", name: "脇差", slot: "mainHand", minLevel: B.wakizashi.minLevel, moveset: "katana" },
  { key: "tachi", name: "太刀", slot: "mainHand", minLevel: B.tachi.minLevel, implicitKey: "implicit.tachi", moveset: "katana" },
  { key: "handAxe", name: "手斧", slot: "mainHand", minLevel: B.handAxe.minLevel, moveset: "axe" },
  { key: "battleAxe", name: "戦斧", slot: "mainHand", minLevel: B.battleAxe.minLevel, implicitKey: "implicit.battleAxe", moveset: "axe" },
  { key: "towerShield", name: "大盾", slot: "mainHand", minLevel: B.towerShield.minLevel, moveset: "shield" },
  { key: "kiteShield", name: "騎士盾", slot: "mainHand", minLevel: B.kiteShield.minLevel, implicitKey: "implicit.kiteShield", moveset: "shield" },
  { key: "kusarigama", name: "鎖鎌", slot: "mainHand", minLevel: B.kusarigama.minLevel, moveset: "chainSickle" },
  { key: "weightedChain", name: "分銅鎖", slot: "mainHand", minLevel: B.weightedChain.minLevel, implicitKey: "implicit.weightedChain", moveset: "chainSickle" },
  { key: "mallet", name: "木槌", slot: "mainHand", minLevel: B.mallet.minLevel, moveset: "hammer" },
  { key: "maul", name: "大槌", slot: "mainHand", minLevel: B.maul.minLevel, implicitKey: "implicit.maul", moveset: "hammer" },
  { key: "twinPistols", name: "二丁拳銃", slot: "mainHand", minLevel: B.twinPistols.minLevel, moveset: "gunner" },
  { key: "twinRevolvers", name: "双回転式", slot: "mainHand", minLevel: B.twinRevolvers.minLevel, implicitKey: "implicit.twinRevolvers", moveset: "gunner" },
  // 戦鎚（warpick）を戦鎚の型へ移したので、鉈の型の器を 1 つ補う
  { key: "broadCleaver", name: "大鉈", slot: "mainHand", minLevel: B.broadCleaver.minLevel, moveset: "cleaver" },
  // 武器 Wave 4（docs/ideas/weapons-wave4.md 2〜5 章）: 序盤の器は implicit なし、後半の器は implicit で個性を付ける
  { key: "hookClaws", name: "鉤爪", slot: "mainHand", minLevel: B.hookClaws.minLevel, moveset: "claws" },
  { key: "ironClaws", name: "鉄爪", slot: "mainHand", minLevel: B.ironClaws.minLevel, implicitKey: "implicit.ironClaws", moveset: "claws" },
  { key: "beastClaws", name: "獣爪", slot: "mainHand", minLevel: B.beastClaws.minLevel, implicitKey: "implicit.beastClaws", moveset: "claws" },
  { key: "flail", name: "鎖鉄球", slot: "mainHand", minLevel: B.flail.minLevel, moveset: "flail" },
  { key: "morningStar", name: "星球", slot: "mainHand", minLevel: B.morningStar.minLevel, implicitKey: "implicit.morningStar", moveset: "flail" },
  { key: "greatFlail", name: "大鎖球", slot: "mainHand", minLevel: B.greatFlail.minLevel, implicitKey: "implicit.greatFlail", moveset: "flail" },
  { key: "ringBlades", name: "輪刃", slot: "mainHand", minLevel: B.ringBlades.minLevel, moveset: "ringBlades" },
  { key: "fangRings", name: "牙輪", slot: "mainHand", minLevel: B.fangRings.minLevel, implicitKey: "implicit.fangRings", moveset: "ringBlades" },
  { key: "ironFan", name: "鉄扇", slot: "mainHand", minLevel: B.ironFan.minLevel, moveset: "fan" },
  { key: "danceFan", name: "舞扇", slot: "mainHand", minLevel: B.danceFan.minLevel, implicitKey: "implicit.danceFan", moveset: "fan" },
  { key: "warFan", name: "軍扇", slot: "mainHand", minLevel: B.warFan.minLevel, implicitKey: "implicit.warFan", moveset: "fan" },

  // gun: 連射 / 弾数 / 貫通
  { key: "pistol", name: "拳銃", slot: "mainHand", minLevel: B.pistol.minLevel, implicitKey: "implicit.pistol", moveset: "sidearm" },
  { key: "smg", name: "短機関銃", slot: "mainHand", minLevel: B.smg.minLevel, implicitKey: "implicit.smg", moveset: "sidearm" },
  { key: "rifle", name: "小銃", slot: "mainHand", minLevel: B.rifle.minLevel, implicitKey: "implicit.rifle", moveset: "longarm" },
  { key: "shotgun", name: "散弾銃", slot: "mainHand", minLevel: B.shotgun.minLevel, implicitKey: "implicit.shotgun", moveset: "cannon" },
  { key: "revolver", name: "回転式拳銃", slot: "mainHand", minLevel: B.revolver.minLevel, implicitKey: "implicit.revolver", moveset: "sidearm" },
  { key: "railgun", name: "電磁砲", slot: "mainHand", minLevel: B.railgun.minLevel, implicitKey: "implicit.railgun", moveset: "longarm" },
  { key: "throwingKnives", name: "投げ短剣", slot: "mainHand", minLevel: B.throwingKnives.minLevel, implicitKey: "implicit.throwingKnives", moveset: "thrown" },
  { key: "blowgun", name: "吹き矢", slot: "mainHand", minLevel: B.blowgun.minLevel, implicitKey: "implicit.blowgun", moveset: "thrown" },
  { key: "matchlock", name: "火縄銃", slot: "mainHand", minLevel: B.matchlock.minLevel, implicitKey: "implicit.matchlock", moveset: "longarm" },
  // 銃の器（implicit なし）
  { key: "ricochetGun", name: "跳ね銃", slot: "mainHand", minLevel: B.ricochetGun.minLevel, moveset: "thrown" },
  { key: "mineLauncher", name: "置き撃ち筒", slot: "mainHand", minLevel: B.mineLauncher.minLevel, moveset: "trapper" },
  // 2026-09 第 2 弾: 弾の挙動ごとに器を選べるように
  { key: "blunderbuss", name: "喇叭銃", slot: "mainHand", minLevel: B.blunderbuss.minLevel, implicitKey: "implicit.blunderbuss", moveset: "cannon" },
  { key: "crossbow", name: "弩", slot: "mainHand", minLevel: B.crossbow.minLevel, implicitKey: "implicit.crossbow", moveset: "longarm" },
  { key: "chakram", name: "円月輪", slot: "mainHand", minLevel: B.chakram.minLevel, implicitKey: "implicit.chakram", moveset: "warRing" },
  { key: "handCannon", name: "手砲", slot: "mainHand", minLevel: B.handCannon.minLevel, implicitKey: "implicit.handCannon", moveset: "longarm" },
  { key: "caltrops", name: "撒き菱筒", slot: "mainHand", minLevel: B.caltrops.minLevel, implicitKey: "implicit.caltrops", moveset: "trapper" },
  { key: "seekerOrb", name: "導きの珠", slot: "mainHand", minLevel: B.seekerOrb.minLevel, implicitKey: "implicit.seekerOrb", moveset: "thrown" },
  // 2026-09-24 レーン B: 新しい弾の挙動の器
  { key: "burstRifle", name: "三連銃", slot: "mainHand", minLevel: B.burstRifle.minLevel, moveset: "sidearm" },
  { key: "tripleCrossbow", name: "三連弩", slot: "mainHand", minLevel: B.tripleCrossbow.minLevel, moveset: "longarm" },
  { key: "returnChakram", name: "返し輪", slot: "mainHand", minLevel: B.returnChakram.minLevel, moveset: "warRing" },
  { key: "flyingBlade", name: "飛刃", slot: "mainHand", minLevel: B.flyingBlade.minLevel, moveset: "warRing" },
  { key: "mortar", name: "曲射筒", slot: "mainHand", minLevel: B.mortar.minLevel, moveset: "grenade" },
  { key: "grenadeLauncher", name: "擲弾筒", slot: "mainHand", minLevel: B.grenadeLauncher.minLevel, moveset: "grenade" },

  // armor: HP / armor
  { key: "cloth", name: "布の服", slot: "armor", minLevel: B.cloth.minLevel, implicitKey: "implicit.cloth" },
  { key: "leather", name: "革鎧", slot: "armor", minLevel: B.leather.minLevel, implicitKey: "implicit.leather" },
  { key: "chain", name: "鎖帷子", slot: "armor", minLevel: B.chain.minLevel, implicitKey: "implicit.chain" },
  { key: "plate", name: "板金鎧", slot: "armor", minLevel: B.plate.minLevel, implicitKey: "implicit.plate" },
  { key: "berserkerHide", name: "狂戦士の皮鎧", slot: "armor", minLevel: B.berserkerHide.minLevel, implicitKey: "implicit.berserkerHide" },
  // 襤褸: implicit を持たない代わりに余白が 1 多い（育てるための器）
  { key: "rags", name: "襤褸", slot: "armor", minLevel: B.rags.minLevel, marginBonus: B.rags.marginBonus! },
  { key: "robe", name: "法衣", slot: "armor", minLevel: B.robe.minLevel, implicitKey: "implicit.robe" },
  { key: "scale", name: "鱗鎧", slot: "armor", minLevel: B.scale.minLevel, implicitKey: "implicit.scale" },
  { key: "spiked", name: "棘甲", slot: "armor", minLevel: B.spiked.minLevel, implicitKey: "implicit.spiked" },
  { key: "mino", name: "蓑", slot: "armor", minLevel: B.mino.minLevel, implicitKey: "implicit.mino" },

  // head: 軽い個性（頭は体の性質を引く。affixes.ts の SLOT_ALIAS）
  { key: "hood", name: "頭巾", slot: "head", minLevel: B.hood.minLevel, implicitKey: "implicit.hood" },
  { key: "leatherCap", name: "革帽子", slot: "head", minLevel: B.leatherCap.minLevel, implicitKey: "implicit.leatherCap" },
  { key: "ironHelm", name: "鉄兜", slot: "head", minLevel: B.ironHelm.minLevel, implicitKey: "implicit.ironHelm" },
  { key: "circlet", name: "額冠", slot: "head", minLevel: B.circlet.minLevel, implicitKey: "implicit.circlet" },
  { key: "maskedVisor", name: "面頬", slot: "head", minLevel: B.maskedVisor.minLevel, implicitKey: "implicit.maskedVisor" },
  { key: "sandogasa", name: "三度笠", slot: "head", minLevel: B.sandogasa.minLevel, implicitKey: "implicit.sandogasa" },
  { key: "hachigane", name: "鉢金", slot: "head", minLevel: B.hachigane.minLevel, implicitKey: "implicit.hachigane" },
  { key: "hornedHelm", name: "角兜", slot: "head", minLevel: B.hornedHelm.minLevel, implicitKey: "implicit.hornedHelm" },

  // boots: 移動 / ダッシュ
  { key: "sandals", name: "草鞋", slot: "boots", minLevel: B.sandals.minLevel, implicitKey: "implicit.sandals" },
  { key: "boots", name: "長靴", slot: "boots", minLevel: B.boots.minLevel, implicitKey: "implicit.boots" },
  { key: "greaves", name: "脛当", slot: "boots", minLevel: B.greaves.minLevel, implicitKey: "implicit.greaves" },
  { key: "wingedBoots", name: "翼靴", slot: "boots", minLevel: B.wingedBoots.minLevel, implicitKey: "implicit.wingedBoots" },
  { key: "lungingBoots", name: "跳躍靴", slot: "boots", minLevel: B.lungingBoots.minLevel, implicitKey: "implicit.lungingBoots" },
  { key: "tabi", name: "忍び足袋", slot: "boots", minLevel: B.tabi.minLevel, implicitKey: "implicit.tabi" },
  { key: "ironGeta", name: "鉄下駄", slot: "boots", minLevel: B.ironGeta.minLevel, implicitKey: "implicit.ironGeta" },
  { key: "snowBoots", name: "雪沓", slot: "boots", minLevel: B.snowBoots.minLevel, implicitKey: "implicit.snowBoots" },

  // ring: 小さな汎用 implicit
  { key: "ironRing", name: "鉄の指輪", slot: "ring", minLevel: B.ironRing.minLevel, implicitKey: "implicit.ironRing" },
  { key: "rubyRing", name: "ルビーの指輪", slot: "ring", minLevel: B.rubyRing.minLevel, implicitKey: "implicit.rubyRing" },
  { key: "sapphireRing", name: "サファイアの指輪", slot: "ring", minLevel: B.sapphireRing.minLevel, implicitKey: "implicit.sapphireRing" },
  { key: "goldRing", name: "金の指輪", slot: "ring", minLevel: B.goldRing.minLevel, implicitKey: "implicit.goldRing" },
  { key: "bloodRing", name: "血の指輪", slot: "ring", minLevel: B.bloodRing.minLevel, implicitKey: "implicit.bloodRing" },
  { key: "voidBand", name: "虚無の指輪", slot: "ring", minLevel: B.voidBand.minLevel, implicitKey: "implicit.voidBand" },
  { key: "boneRing", name: "骨の指輪", slot: "ring", minLevel: B.boneRing.minLevel, implicitKey: "implicit.boneRing" },
  { key: "signet", name: "印章指輪", slot: "ring", minLevel: B.signet.minLevel, implicitKey: "implicit.signet" },
  { key: "twinRing", name: "双頭の指輪", slot: "ring", minLevel: B.twinRing.minLevel, implicitKey: "implicit.twinRing" },
  { key: "blackIronRing", name: "黒鉄の指輪", slot: "ring", minLevel: B.blackIronRing.minLevel, implicitKey: "implicit.blackIronRing" },

  // amulet: ユーティリティ寄り
  { key: "jadeAmulet", name: "翡翠の首飾り", slot: "amulet", minLevel: B.jadeAmulet.minLevel, implicitKey: "implicit.jadeAmulet" },
  { key: "amberAmulet", name: "琥珀の首飾り", slot: "amulet", minLevel: B.amberAmulet.minLevel, implicitKey: "implicit.amberAmulet" },
  { key: "onyxAmulet", name: "黒曜石の首飾り", slot: "amulet", minLevel: B.onyxAmulet.minLevel, implicitKey: "implicit.onyxAmulet" },
  { key: "lapisAmulet", name: "ラピスの首飾り", slot: "amulet", minLevel: B.lapisAmulet.minLevel, implicitKey: "implicit.lapisAmulet" },
  { key: "coralAmulet", name: "珊瑚の首飾り", slot: "amulet", minLevel: B.coralAmulet.minLevel, implicitKey: "implicit.coralAmulet" },
  { key: "duskAmulet", name: "黄昏の首飾り", slot: "amulet", minLevel: B.duskAmulet.minLevel, implicitKey: "implicit.duskAmulet" },
  { key: "rosary", name: "数珠", slot: "amulet", minLevel: B.rosary.minLevel, implicitKey: "implicit.rosary" },
  { key: "fangNecklace", name: "牙の首飾り", slot: "amulet", minLevel: B.fangNecklace.minLevel, implicitKey: "implicit.fangNecklace" },
  { key: "bell", name: "鈴", slot: "amulet", minLevel: B.bell.minLevel, implicitKey: "implicit.bell" },
];

const BASE_BY_KEY: ReadonlyMap<string, BaseItemDef> = new Map(BASES.map((b) => [b.key, b]));

export function baseDef(key: string): BaseItemDef | undefined {
  return BASE_BY_KEY.get(key);
}

/** slot のベースのうち itemLevel で解禁済みのもの */
export function basesForSlot(slot: Slot, itemLevel: number): BaseItemDef[] {
  return BASES.filter((b) => b.slot === slot && b.minLevel <= itemLevel);
}

/**
 * 右手ベースの家系（docs/ideas/weapon-redesign.md 4 章）。moveset が GUN_MOVESETS に入るかで判定する。
 * moveset を持たないベース（右手以外）は undefined
 */
export function baseFamily(base: BaseItemDef): "melee" | "gun" | undefined {
  if (base.moveset === undefined) return undefined;
  return (GUN_MOVESETS as readonly MovesetKey[]).includes(base.moveset) ? "gun" : "melee";
}
