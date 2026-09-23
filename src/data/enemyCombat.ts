import { type KeywordProfile, kw } from "../core/keywords";
import type { EnemyRule } from "../core/rules";
import type { StatusApply, StatusKind } from "../core/status";
import { WAVE3_COMBAT } from "./enemyCombatWave3";

/**
 * 敵ごとの戦闘パラメータ（docs/COMBAT_DESIGN.md D-3 / E-4）。
 * EnemyDef（src/data/enemies.ts）とは別表にして、並列作業で enemies.ts を取り合わないようにする
 */

/** 敵の攻撃の種類。付与をどの攻撃に乗せるかを決める */
export type EnemyAttackKind = "contact" | "bullet" | "bomb" | "laser" | "shockwave";

/** 敵 → プレイヤーの状態異常。minDepth 未満の深度では付かない */
export interface EnemyInflict extends StatusApply {
  on: EnemyAttackKind;
  minDepth?: number;
}

export interface EnemyCombatDef {
  /** 怯み耐性。未指定 = 怯まない */
  poise?: number;
  /** 怯みの秒（ボスはダウンの秒） */
  staggerTime: number;
  /** 予備動作・攻撃中に受ける怯み値の倍率（強靭） */
  superArmorMul: number;
  /** 攻撃中（strike）だけ強靭を上書きする。スライム王の空中は 0（怯み値が溜まらない） */
  strikeSuperArmorMul?: number;
  inflicts: readonly EnemyInflict[];
  /** 怯み・恐怖などの個別免疫 */
  immune?: readonly StatusKind[];
  /** 統一ルール。この敵が対象のイベントで照合する。効果は予告付きハザードに限る（テレグラフ原則） */
  rules?: readonly EnemyRule[];
  /** 共通語彙。出す = 使ってくる攻撃・場の変化、食う = 弱点（付与する状態異常は system/keywords.ts が足す） */
  keywords: KeywordProfile;
}

const BOSS_IMMUNE: readonly StatusKind[] = ["freeze", "fear"];
/** 敵の出血: 10px ごとに 0.2 × スタック（歩き続けると 1 スタックで毎秒約 2.4。避けて走るほど削れる） */
const BLEED_POTENCY = 0.2;

/** 行動停止を受け付けない設置物（鐘・氷柱）。怯み・凍結・麻痺・恐怖で止める意味がない */
const FIXTURE_IMMUNE: readonly StatusKind[] = ["stagger", "freeze", "paralyze", "fear"];

/**
 * 量産した敵（docs/ideas/enemies.md）。怯みの目安は 低 〜15 / 中 25〜50 / 高 60〜120、強靭は予備動作・攻撃中の倍率。
 * 付与は既存の 13 種だけを使い、プレイヤーを止めやすいものは minDepth で段階的に解禁する
 */
const WAVE2_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  // ---- 再配色種 ----
  poisonSlime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "poison", stacks: 2, duration: 5, potency: 0 }],
  },
  iceSlime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }],
  },
  fireSlime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["explode"], ["chill"]),
    inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  goldSlime: { poise: 15, staggerTime: 0.6, superArmorMul: 1, inflicts: [], keywords: kw([], ["ranged", "dash"]) },
  boneBoar: {
    poise: 70,
    staggerTime: 0.6,
    superArmorMul: 0.25,
    keywords: kw(["hurt", "wall"], ["counter"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 }],
  },
  curseEye: {
    poise: 20,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 3, potency: 0 }],
  },
  frostEye: {
    poise: 20,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }],
  },
  blackKnight: {
    poise: 60,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  lavaGolem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "wall"], ["chill"]),
    inflicts: [{ on: "shockwave", kind: "burn", stacks: 1, duration: 3, potency: 4 }],
  },
  frostGolem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "wall"], ["burn"]),
    inflicts: [{ on: "shockwave", kind: "chill", stacks: 2, duration: 3, potency: 0 }],
  },
  crystalGolem: {
    poise: 100,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "wall"], ["stagger"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  frostWisp: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }],
    immune: ["stagger"],
  },
  purpleLaser: {
    poise: 35,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "laser", kind: "silence", stacks: 1, duration: 1.5, potency: 0 }],
  },
  flyingBook: { poise: 8, staggerTime: 0.3, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  ashBat: { poise: 5, staggerTime: 0.3, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  // ---- 既存 behavior の流用 ----
  sproutSlime: { poise: 10, staggerTime: 0.4, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  spikeRat: {
    poise: 10,
    staggerTime: 0.3,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  twinEye: {
    poise: 15,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "bullet", minDepth: 5, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }],
  },
  triLaser: {
    poise: 40,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "laser", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  shadowBat: {
    poise: 8,
    staggerTime: 0.3,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  wolf: {
    poise: 12,
    staggerTime: 0.4,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  multiBomber: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["explode"], ["counter"]),
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }],
  },
  spearman: {
    poise: 40,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  hornBeetle: {
    poise: 65,
    staggerTime: 0.6,
    superArmorMul: 0.25,
    keywords: kw(["hurt"], ["wall"]),
    inflicts: [{ on: "bomb", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  netter: {
    poise: 30,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "chill", stacks: 2, duration: 2, potency: 0 }],
  },
  carrionFly: {
    poise: 5,
    staggerTime: 0.3,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "poison", stacks: 1, duration: 4, potency: 0 }],
  },
  thunderWisp: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "shock", stacks: 1, duration: 2, potency: 4 }],
    immune: ["stagger"],
  },
  skeleton: {
    poise: 20,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["stagger"]),
    inflicts: [{ on: "contact", minDepth: 6, kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
  },
  // ---- 新しい behavior ----
  fuseRat: {
    poise: 8,
    staggerTime: 0.4,
    superArmorMul: 1,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  crystalMite: { poise: 8, staggerTime: 0.4, superArmorMul: 1, inflicts: [], keywords: kw(["explode"], ["ranged"]) },
  echoStriker: {
    poise: 30,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["explode"], ["just"]),
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2.5, potency: 0 }],
  },
  packLeader: {
    poise: 40,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["stagger"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  manaLeech: { poise: 12, staggerTime: 0.5, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"], ["mana"]) },
  scavenger: { poise: 30, staggerTime: 0.5, superArmorMul: 0.5, inflicts: [], keywords: kw(["hurt"], ["kill"]) },
  graveBell: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["area"], ["ranged"]) },
  silencer: { poise: 30, staggerTime: 0.7, superArmorMul: 1, inflicts: [], keywords: kw(["silence"], ["counter"]) },
  frostCrusher: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["area", "wall"], ["burn"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.5, potency: 0 }],
  },
  twinShade: {
    poise: 12,
    staggerTime: 0.4,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "weaken", stacks: 1, duration: 3, potency: 0 }],
  },
  // ---- 部屋主 ----
  mimic: {
    poise: 90,
    staggerTime: 1.2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "hurt"], ["stagger"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  hollowArmor: {
    poise: 110,
    staggerTime: 1,
    superArmorMul: 0.25,
    keywords: kw(["elite", "area"], ["stagger"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: ["fear"],
  },
  hollowWraith: {
    poise: 40,
    staggerTime: 0.8,
    superArmorMul: 0.5,
    keywords: kw(["elite", "hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "fear", stacks: 1, duration: 1, potency: 0 }],
    immune: ["fear"],
  },
  boneConductor: {
    poise: 60,
    staggerTime: 1,
    superArmorMul: 1.5,
    keywords: kw(["elite", "bullet"], ["silence"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
    immune: ["fear"],
  },
  // ---- ボス ----
  twinBrother: {
    poise: 220,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: BOSS_IMMUNE,
  },
  /** 妹は弓を引く溜め（予備動作）が窓。強靭 1.5 = 溜め中は怯み値が多く入る */
  twinSister: {
    poise: 140,
    staggerTime: 1.6,
    superArmorMul: 1.5,
    keywords: kw(["elite", "bullet"], ["counter"]),
    strikeSuperArmorMul: 1,
    inflicts: [{ on: "bullet", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  frostGiant: {
    poise: 320,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "area"], ["burn"]),
    inflicts: [
      { on: "shockwave", kind: "chill", stacks: 2, duration: 3, potency: 0 },
      { on: "bomb", kind: "chill", stacks: 1, duration: 3, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  icePillar: { staggerTime: 0, superArmorMul: 1, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw([], ["area"]) },
  // 鏡の部屋の写し（src/system/specialRooms.ts）。ジャスト回避・カウンターで返す相手
  mirrorSelf: { poise: 70, staggerTime: 0.8, superArmorMul: 0.5, inflicts: [], keywords: kw(["elite", "dash"], ["just", "counter"]) },
};

export const ENEMY_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  slime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", minDepth: 4, kind: "poison", stacks: 1, duration: 5, potency: 0 }],
  },
  eye: {
    poise: 20,
    staggerTime: 0.6,
    superArmorMul: 1,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "bullet", minDepth: 5, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }],
  },
  boar: {
    poise: 60,
    staggerTime: 0.6,
    superArmorMul: 0.25,
    keywords: kw(["hurt", "wall"], ["counter", "wall"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 },
    ],
  },
  knight: {
    poise: 50,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    keywords: kw(["hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  bomber: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 1,
    keywords: kw(["explode"], ["counter"]),
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 3, potency: 0 }],
  },
  laserEye: {
    poise: 35,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    keywords: kw(["bullet"], ["counter"]),
    inflicts: [{ on: "laser", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  golem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    keywords: kw(["wall", "area"], ["stagger"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
  },
  bat: {
    poise: 8,
    staggerTime: 0.3,
    superArmorMul: 1,
    keywords: kw(["hurt"], ["area"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  wisp: {
    staggerTime: 0,
    superArmorMul: 1,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "burn", stacks: 1, duration: 2, potency: 3 }],
    immune: ["stagger"],
  },
  kingSlime: {
    poise: 300,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "area"], ["stagger"]),
    strikeSuperArmorMul: 0,
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  boneLord: {
    poise: 250,
    staggerTime: 2,
    superArmorMul: 0.5,
    keywords: kw(["elite", "bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 3, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  ...WAVE2_COMBAT,
  ...WAVE3_COMBAT,
};

/** 表に無い敵は怯まず、何も付与しない（新しい敵を足したときに落ちないように） */
const FALLBACK: EnemyCombatDef = { staggerTime: 0, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"]) };

export function enemyCombat(key: string): EnemyCombatDef {
  return ENEMY_COMBAT[key] ?? FALLBACK;
}
