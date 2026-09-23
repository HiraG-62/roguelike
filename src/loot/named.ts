import { baseDef } from "./bases";
import type { Slot } from "./types";

/**
 * 名のある遺物（旧 unique）。性質は固定（値は小さく揺らぐ）、誓約も固定。
 * docs/LOOT_DESIGN.md「名のある遺物」
 */

export interface UniqueAffixSpec {
  key: string;
}

export interface UniqueDef {
  key: string;
  name: string;
  baseKey: string;
  minLevel: number;
  affixes: readonly UniqueAffixSpec[];
  /** 固定の誓約（KEYSTONES の key） */
  keystone?: string;
  /** フレーバー 1 行 */
  flavor?: string;
}

export const UNIQUES: readonly UniqueDef[] = [
  {
    key: "widowmaker",
    name: "喪服の剣",
    baseKey: "greatsword",
    minLevel: 14,
    keystone: "ks_berserker",
    flavor: "HPが減るほど、その一振りは大きくなる。",
    affixes: [
      { key: "meleeDamagePct" },
      { key: "critMultiplier" },
      { key: "lifeOnKill" },
      { key: "knockback" },
    ],
  },
  {
    key: "hailstormEngine",
    name: "雹嵐機関",
    baseKey: "smg",
    minLevel: 10,
    keystone: "ks_overclock",
    flavor: "引き金を引くたび、己の一部が飛び散る。",
    affixes: [
      { key: "projectiles" },
      { key: "fireRate" },
      { key: "chill" },
      { key: "pierce" },
      { key: "cv_splitToPierce" },
    ],
  },
  {
    key: "heartOfTheMountain",
    name: "山の心臓",
    baseKey: "plate",
    minLevel: 18,
    keystone: "ks_juggernaut",
    flavor: "これほど鈍重なものが、これほど重い一撃を放つはずがない。",
    affixes: [
      { key: "maxLife" },
      { key: "maxLifePct" },
      { key: "thorns" },
      { key: "damageTaken" },
      { key: "cv_lifeToArmor" },
    ],
  },
  {
    key: "stormstriders",
    name: "嵐脚",
    baseKey: "greaves",
    minLevel: 14,
    keystone: "ks_blink",
    flavor: "雷鳴より先に、お前はそこに立っている。",
    affixes: [
      { key: "moveSpeed" },
      { key: "dashCharge" },
      { key: "shock" },
      { key: "dashCooldown" },
    ],
  },
  {
    key: "eyeOfTheTempest",
    name: "颶風の瞳",
    baseKey: "lapisAmulet",
    minLevel: 12,
    keystone: "ks_gambler",
    flavor: "全ての必殺は賭け。部屋はその賭けに耐えられない。",
    affixes: [
      { key: "burstDamage" },
      { key: "burstRadius" },
      { key: "energyGain" },
      { key: "comboWindow" },
      { key: "explodeOnKill" },
    ],
  },

  // ---- 追加 10 種: 各スロット 2 つ以上、出始め ilvl は 4〜20 でばらす ----
  {
    key: "cinderfang",
    name: "燠牙",
    baseKey: "dagger",
    minLevel: 4,
    keystone: "ks_glassCannon",
    flavor: "二閃、そして炎が仕事を終わらせる。",
    affixes: [
      { key: "attackSpeed" },
      { key: "burn" },
      { key: "cv_meleeToBurn" },
    ],
  },
  {
    key: "bloodletterKiss",
    name: "瀉血の口づけ",
    baseKey: "shortsword",
    minLevel: 8,
    keystone: "ks_vampire",
    flavor: "お前を独りで失血死させはしない。",
    affixes: [
      { key: "lifeOnHit" },
      { key: "attackSpeed" },
      { key: "critMultiplier" },
    ],
  },
  {
    key: "whisperOfTheVoid",
    name: "虚無の囁き",
    baseKey: "rifle",
    minLevel: 9,
    keystone: "ks_pacifist",
    flavor: "それは一度だけ、遥か遠くから語る。",
    affixes: [
      { key: "rangedDamagePct" },
      { key: "pierce" },
      { key: "critChance" },
    ],
  },
  {
    key: "lastRites",
    name: "終油の秘跡",
    baseKey: "shotgun",
    minLevel: 15,
    keystone: "ks_overclock",
    flavor: "弾は一発ごとに、至近距離で施される。",
    affixes: [
      { key: "projectiles" },
      { key: "explodeOnKill" },
      { key: "fireRate" },
    ],
  },
  {
    key: "aegisOfTheUnbroken",
    name: "不屈のイージス",
    baseKey: "plate",
    minLevel: 20,
    keystone: "ks_juggernaut",
    flavor: "一度たりとも退くことを考えたことがない。",
    affixes: [
      { key: "armorFlat" },
      { key: "maxLifePct" },
      { key: "damageTaken" },
    ],
  },
  {
    key: "wardensSilence",
    name: "看守の沈黙",
    baseKey: "chain",
    minLevel: 11,
    keystone: "ks_bladeOath",
    flavor: "どんな問いにも、刃の腹で答える。",
    affixes: [
      { key: "maxLife" },
      { key: "meleeDamageFlat" },
      { key: "thorns" },
    ],
  },
  {
    key: "tempestLoader",
    name: "疾風の装填",
    baseKey: "greaves",
    minLevel: 13,
    keystone: "ks_windWalker",
    flavor: "地面が追いつく前に、全てのチャージを使い切れ。",
    affixes: [
      { key: "dashDistance" },
      { key: "moveSpeed" },
      { key: "cv_speedToAttack" },
    ],
  },
  {
    key: "berserkersSignet",
    name: "狂戦士の印章",
    baseKey: "bloodRing",
    minLevel: 10,
    keystone: "ks_berserker",
    flavor: "お前の代わりに、傷の数を数えてくれる。",
    affixes: [
      { key: "lifeOnKill" },
      { key: "critMultiplier" },
      { key: "maxLife" },
    ],
  },
  {
    key: "fortunesGambit",
    name: "運命の賭け",
    baseKey: "goldRing",
    minLevel: 7,
    keystone: "ks_gambler",
    flavor: "胴元は、いつか必ず負ける。",
    affixes: [
      { key: "critChance" },
      { key: "burstDamage" },
      { key: "energyGain" },
    ],
  },
  {
    key: "phaseAnchor",
    name: "位相の錨",
    baseKey: "onyxAmulet",
    minLevel: 14,
    keystone: "ks_blink",
    flavor: "お前がいるはずだった場所を、それは覚えている。",
    affixes: [
      { key: "burstRadius" },
      { key: "dashCooldown" },
      { key: "moveSpeed" },
    ],
  },
  {
    // 器は小さいが、倒すたびに汲み上げる。マナ経済（docs/COMBAT_DESIGN.md B 節）の尖った解
    key: "driedWell",
    name: "涸れ井戸の指輪",
    baseKey: "sapphireRing",
    minLevel: 10,
    flavor: "底は乾いている。満たすのは、いつも他人の最期だ。",
    affixes: [
      { key: "manaDrought" },
      { key: "manaCostPct" },
    ],
  },
];

/** slot に対応し depth で解禁済みの名のある遺物 */
export function uniquesFor(slot: Slot, depth: number): UniqueDef[] {
  return UNIQUES.filter((u) => u.minLevel <= depth && baseDef(u.baseKey)?.slot === slot);
}

export function uniqueDef(key: string): UniqueDef | undefined {
  return UNIQUES.find((u) => u.key === key);
}
