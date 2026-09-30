/**
 * スキルの数値のうち union 文字列（HitShape の kind など）を含む表。TS に残す
 * （docs/ideas/data-externalization.md 2 章の境界規則: union 文字列を 1 つでも含む構造は丸ごと TS）。
 * 数値だけの残りは data/balance/skills/ から読む（data.ts が SKILL に合流させる）。
 */
import type { MeleeStepDef } from "../data/weapons";

/**
 * 狼化の噛みつき（MeleeStepDef。基礎値で 4 + 0.8*5 + 0.8*5 = 12）。数値は skills/tuning3.ts に居た WAVE3_SKILL_TUNING.wolfForm.bite と同じ。
 * `satisfies` で構造だけ検査し、lunge などの省略可能フィールドをリテラル型のまま（undefined を含まない）保つ
 */
export const WOLF_BITE_STEP = {
  windup: 0.06,
  active: 0.1,
  recover: 0.16,
  scaling: { base: 4, str: 0.8, dex: 0.8 },
  poise: 15,
  reach: 24,
  size: 14,
  knockback: 80,
  heavy: false,
  mana: 3,
  shape: { kind: "thrust" },
  hitstop: 3,
  shake: 1,
  lunge: 30,
  trail: "#d0b090",
} as const satisfies MeleeStepDef;

/**
 * 鉄塊化の重い振り（MeleeStepDef。基礎値で 10 + 1.4*5 + 0.3*5 + 0.5*5 = 21）。base と Σ係数（2.2）は
 * WAVE3_SKILL_TUNING.ironForm.swing のまま、体力の一部（0.8 → 0.3 + 防御 0.5）を防御へ付け替えた
 */
export const IRON_SWING_STEP = {
  windup: 0.28,
  active: 0.14,
  recover: 0.42,
  scaling: { base: 10, str: 1.4, vit: 0.3, def: 0.5 },
  poise: 40,
  reach: 32,
  size: 32,
  knockback: 300,
  heavy: true,
  mana: 5,
  shape: { kind: "arc", deg: 180 },
  hitstop: 7,
  shake: 4,
  lunge: 6,
  trail: "#a0a8b8",
} as const satisfies MeleeStepDef;
