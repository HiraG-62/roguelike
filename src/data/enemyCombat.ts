import type { StatusApply, StatusKind } from "../core/status";

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
}

const BOSS_IMMUNE: readonly StatusKind[] = ["freeze", "fear"];
/** 敵の出血: 10px ごとに 0.2 × スタック（歩き続けると 1 スタックで毎秒約 2.4。避けて走るほど削れる） */
const BLEED_POTENCY = 0.2;

export const ENEMY_COMBAT: Readonly<Record<string, EnemyCombatDef>> = {
  slime: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 0.5,
    inflicts: [{ on: "contact", minDepth: 4, kind: "poison", stacks: 1, duration: 5, potency: 0 }],
  },
  eye: {
    poise: 20,
    staggerTime: 0.6,
    superArmorMul: 1,
    inflicts: [{ on: "bullet", minDepth: 5, kind: "silence", stacks: 1, duration: 1.2, potency: 0 }],
  },
  boar: {
    poise: 60,
    staggerTime: 0.6,
    superArmorMul: 0.25,
    inflicts: [
      { on: "contact", kind: "bleed", stacks: 2, duration: 4, potency: BLEED_POTENCY },
      { on: "contact", kind: "stagger", stacks: 1, duration: 0.35, potency: 0 },
    ],
  },
  knight: {
    poise: 50,
    staggerTime: 0.6,
    superArmorMul: 0.5,
    inflicts: [{ on: "contact", kind: "stagger", stacks: 1, duration: 0.3, potency: 0 }],
  },
  bomber: {
    poise: 25,
    staggerTime: 0.5,
    superArmorMul: 1,
    inflicts: [{ on: "bomb", kind: "vulnerable", stacks: 1, duration: 3, potency: 0 }],
  },
  laserEye: {
    poise: 35,
    staggerTime: 0.7,
    superArmorMul: 0.5,
    inflicts: [{ on: "laser", kind: "burn", stacks: 1, duration: 2, potency: 4 }],
  },
  golem: {
    poise: 120,
    staggerTime: 0.8,
    superArmorMul: 0.25,
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
  },
  bat: {
    poise: 8,
    staggerTime: 0.3,
    superArmorMul: 1,
    inflicts: [{ on: "contact", kind: "bleed", stacks: 1, duration: 4, potency: BLEED_POTENCY }],
  },
  wisp: {
    staggerTime: 0,
    superArmorMul: 1,
    inflicts: [{ on: "contact", kind: "burn", stacks: 1, duration: 2, potency: 3 }],
    immune: ["stagger"],
  },
  kingSlime: {
    poise: 300,
    staggerTime: 2,
    superArmorMul: 0.5,
    strikeSuperArmorMul: 0,
    inflicts: [{ on: "shockwave", kind: "stagger", stacks: 1, duration: 0.4, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
  boneLord: {
    poise: 250,
    staggerTime: 2,
    superArmorMul: 0.5,
    inflicts: [{ on: "bullet", kind: "weaken", stacks: 1, duration: 3, potency: 0 }],
    immune: BOSS_IMMUNE,
  },
};

/** 表に無い敵は怯まず、何も付与しない（新しい敵を足したときに落ちないように） */
const FALLBACK: EnemyCombatDef = { staggerTime: 0, superArmorMul: 1, inflicts: [] };

export function enemyCombat(key: string): EnemyCombatDef {
  return ENEMY_COMBAT[key] ?? FALLBACK;
}
