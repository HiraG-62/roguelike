import { type KeywordProfile, kw } from "../core/keywords";
import type { EnemyRule } from "../core/rules";
import type { StatusApply, StatusKind } from "../core/status";
import { BALANCE } from "./balance";
import { type EnemyDefenseDef, enemyDefense } from "./enemyDefense";
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
  /**
   * 防御・魔防・属性耐性と攻撃の素性（docs/COMBAT_DESIGN.md A-8）。省略時は data/enemyDefense.ts の表から
   * ENEMY_COMBAT の組み立てで埋める（個別に上書きしたい敵だけここに書く）
   */
  guard?: EnemyDefenseDef;
}

const BOSS_IMMUNE: readonly StatusKind[] = ["freeze", "fear"];
/** 敵の出血: 10px ごとに 0.2 × スタック（歩き続けると 1 スタックで毎秒約 2.4。避けて走るほど削れる） */
const BLEED_POTENCY = 0.2;

/** 行動停止を受け付けない設置物（鐘・氷柱）。怯み・凍結・麻痺・恐怖で止める意味がない */
const FIXTURE_IMMUNE: readonly StatusKind[] = ["stagger", "freeze", "paralyze", "fear"];

/**
 * 怯み耐性・怯みの秒・強靭の倍率（poise/staggerTime/superArmorMul/strikeSuperArmorMul）。
 * src/data/balance/enemies.json の "combat"。inflicts / keywords / immune など状態異常や語彙は
 * union 文字列を含むため TS 側に残す（変更したい場合は数値だけ JSON を編集する）
 */
const C = BALANCE.enemies.combat;

/**
 * 量産した敵（docs/ideas/enemies.md）。怯みの目安は 低 〜15 / 中 25〜50 / 高 60〜120、強靭は予備動作・攻撃中の倍率。
 * 付与は既存の 13 種だけを使い、プレイヤーを止めやすいものは minDepth で段階的に解禁する
 */
const WAVE2_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  // ---- 再配色種 ----
  poisonSlime: { ...C.poisonSlime, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "poison", stacks: 2, duration: 5, potency: 0 }] },
  iceSlime: { ...C.iceSlime, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }] },
  fireSlime: { ...C.fireSlime, keywords: kw(["explode"], ["chill"]), inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  goldSlime: { ...C.goldSlime, inflicts: [], keywords: kw([], ["ranged", "dash"]) },
  boneBoar: { ...C.boneBoar, keywords: kw(["hurt", "wall"], ["counter"]), inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 }] },
  // 二度突きの猪: 猪と同じく出血 2 と接触の怯み。壁に激突すれば自傷の怯み（system/enemies.ts の猪の仕組み）
  boarDouble: {
    ...C.boarDouble,
    keywords: kw(["hurt", "wall"], ["counter", "wall"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 },
    ],
  },
  curseEye: { ...C.curseEye, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 3, potency: 0 }] },
  frostEye: { ...C.frostEye, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "bullet", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }] },
  blackKnight: { ...C.blackKnight, keywords: kw(["hurt"], ["counter"]), inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  lavaGolem: { ...C.lavaGolem, keywords: kw(["area", "wall"], ["chill"]), inflicts: [{ on: "shockwave", kind: "burn", stacks: 1, duration: 3, potency: 4 }] },
  frostGolem: { ...C.frostGolem, keywords: kw(["area", "wall"], ["burn"]), inflicts: [{ on: "shockwave", kind: "chill", stacks: 2, duration: 3, potency: 0 }] },
  crystalGolem: { ...C.crystalGolem, keywords: kw(["area", "wall"], ["stagger"]), inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  frostWisp: {
    ...C.frostWisp,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "chill", stacks: 1, duration: 2.5, potency: 0 }],
    immune: ["stagger"],
  },
  purpleLaser: { ...C.purpleLaser, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "laser", kind: "silence", stacks: 1, duration: 1.5, potency: 0 }] },
  flyingBook: { ...C.flyingBook, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  ashBat: { ...C.ashBat, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  // ---- 既存 behavior の流用 ----
  sproutSlime: { ...C.sproutSlime, inflicts: [], keywords: kw(["hurt"], ["area"]) },
  spikeRat: { ...C.spikeRat, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  twinEye: { ...C.twinEye, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "bullet", minDepth: 5, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }] },
  triLaser: { ...C.triLaser, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "laser", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  shadowBat: { ...C.shadowBat, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  wolf: { ...C.wolf, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  multiBomber: { ...C.multiBomber, keywords: kw(["explode"], ["counter"]), inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }] },
  spearman: { ...C.spearman, keywords: kw(["hurt"], ["counter"]), inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  hornBeetle: { ...C.hornBeetle, keywords: kw(["hurt"], ["wall"]), inflicts: [{ on: "bomb", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  netter: { ...C.netter, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "bullet", kind: "chill", stacks: 2, duration: 2, potency: 0 }] },
  carrionFly: { ...C.carrionFly, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "poison", stacks: 1, duration: 4, potency: 0 }] },
  thunderWisp: {
    ...C.thunderWisp,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "shock", stacks: 1, duration: 2, potency: 4 }],
    immune: ["stagger"],
  },
  skeleton: { ...C.skeleton, keywords: kw(["hurt"], ["stagger"]), inflicts: [{ on: "contact", minDepth: 6, kind: "weaken", stacks: 1, duration: 2, potency: 0 }] },
  // ---- 新しい behavior ----
  fuseRat: { ...C.fuseRat, keywords: kw(["explode"], ["ranged"]), inflicts: [{ on: "bomb", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  crystalMite: { ...C.crystalMite, inflicts: [], keywords: kw(["explode"], ["ranged"]) },
  echoStriker: { ...C.echoStriker, keywords: kw(["explode"], ["just"]), inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 2.5, potency: 0 }] },
  packLeader: { ...C.packLeader, keywords: kw(["hurt"], ["stagger"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  manaLeech: { ...C.manaLeech, inflicts: [], keywords: kw(["hurt"], ["mana"]) },
  scavenger: { ...C.scavenger, inflicts: [], keywords: kw(["hurt"], ["kill"]) },
  graveBell: { ...C.graveBell, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw(["area"], ["ranged"]) },
  silencer: { ...C.silencer, inflicts: [], keywords: kw(["silence"], ["counter"]) },
  frostCrusher: { ...C.frostCrusher, keywords: kw(["area", "wall"], ["burn"]), inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.5, potency: 0 }] },
  twinShade: { ...C.twinShade, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "weaken", stacks: 1, duration: 3, potency: 0 }] },
  // ---- 部屋主 ----
  mimic: {
    ...C.mimic,
    keywords: kw(["elite", "hurt"], ["stagger"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: ["fear"],
  },
  hollowArmor: {
    ...C.hollowArmor,
    keywords: kw(["elite", "area"], ["stagger"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: ["fear"],
  },
  hollowWraith: {
    ...C.hollowWraith,
    keywords: kw(["elite", "hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "fear", stacks: 1, duration: 1, potency: 0 }],
    immune: ["fear"],
  },
  boneConductor: {
    ...C.boneConductor,
    keywords: kw(["elite", "bullet"], ["silence"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 2, potency: 0 }],
    immune: ["fear"],
  },
  // ---- ボス ----
  twinBrother: {
    ...C.twinBrother,
    keywords: kw(["elite", "hurt"], ["counter"]),
    inflicts: [{ on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY }],
    immune: BOSS_IMMUNE,
  },
  /** 妹は弓を引く溜め（予備動作）が窓。強靭 1.5 = 溜め中は怯み値が多く入る */
  twinSister: {
    ...C.twinSister,
    keywords: kw(["elite", "bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "vulnerable", stacks: 1, duration: 2, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  frostGiant: {
    ...C.frostGiant,
    keywords: kw(["elite", "area"], ["burn"]),
    inflicts: [
      { on: "shockwave", kind: "chill", stacks: 2, duration: 3, potency: 0 },
      { on: "bomb", kind: "chill", stacks: 1, duration: 3, potency: 0 },
    ],
    immune: BOSS_IMMUNE,
  },
  icePillar: { ...C.icePillar, inflicts: [], immune: FIXTURE_IMMUNE, keywords: kw([], ["area"]) },
  // 試し場の木人（src/system/specialRooms.ts）。怯みや状態異常の入り方を試せるよう、免疫は持たない
  trainingDummy: { ...C.trainingDummy, inflicts: [], keywords: kw([], ["melee", "ranged"]) },
  // 鏡の部屋の写し（src/system/specialRooms.ts）。ジャスト回避・カウンターで返す相手
  mirrorSelf: { ...C.mirrorSelf, inflicts: [], keywords: kw(["elite", "dash"], ["just", "counter"]) },
};

const RAW_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  slime: { ...C.slime, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", minDepth: 4, kind: "poison", stacks: 1, duration: 5, potency: 0 }] },
  eye: { ...C.eye, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "bullet", minDepth: 5, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }] },
  boar: {
    ...C.boar,
    keywords: kw(["hurt", "wall"], ["counter", "wall"]),
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 },
    ],
  },
  knight: { ...C.knight, keywords: kw(["hurt"], ["counter"]), inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }] },
  bomber: { ...C.bomber, keywords: kw(["explode"], ["counter"]), inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 3, potency: 0 }] },
  laserEye: { ...C.laserEye, keywords: kw(["bullet"], ["counter"]), inflicts: [{ on: "laser", kind: "burn", stacks: 1, duration: 2, potency: 4 }] },
  golem: { ...C.golem, keywords: kw(["wall", "area"], ["stagger"]), inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }] },
  bat: { ...C.bat, keywords: kw(["hurt"], ["area"]), inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }] },
  wisp: {
    ...C.wisp,
    keywords: kw(["explode"], ["ranged"]),
    inflicts: [{ on: "contact", kind: "burn", stacks: 1, duration: 2, potency: 3 }],
    immune: ["stagger"],
  },
  kingSlime: {
    ...C.kingSlime,
    keywords: kw(["elite", "area"], ["stagger"]),
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  boneLord: {
    ...C.boneLord,
    keywords: kw(["elite", "bullet"], ["counter"]),
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 3, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  ...WAVE2_COMBAT,
  ...WAVE3_COMBAT,
};

/** 防御・耐性（enemyDefense.ts）を畳み込んだ戦闘パラメータ。キーの順は RAW_COMBAT のまま（反復の決定性） */
export const ENEMY_COMBAT: Readonly<Record<string, EnemyCombatDef>> = Object.fromEntries(
  Object.entries(RAW_COMBAT).map(([key, def]) => [key, { ...def, guard: def.guard ?? enemyDefense(key) }]),
);

/** 表に無い敵は怯まず、何も付与しない（新しい敵を足したときに落ちないように） */
const FALLBACK: EnemyCombatDef = { staggerTime: 0, superArmorMul: 1, inflicts: [], keywords: kw(["hurt"]) };

export function enemyCombat(key: string): EnemyCombatDef {
  return ENEMY_COMBAT[key] ?? FALLBACK;
}

/** 敵の防御・耐性・攻撃の素性。戦闘表に無い敵も enemyDefense の既定に落とす */
export function enemyGuard(key: string): EnemyDefenseDef {
  return enemyCombat(key).guard ?? enemyDefense(key);
}
