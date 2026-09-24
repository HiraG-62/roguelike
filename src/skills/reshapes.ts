/**
 * スキルの数値のうち union 文字列（HitShape の kind など）を含む表。TS に残す
 * （docs/ideas/data-externalization.md 2 章の境界規則: union 文字列を 1 つでも含む構造は丸ごと TS）。
 * 数値だけの残りは data/balance/skills.json から読む（data.ts が SKILL に合流させる）。
 */
import { STATUS } from "../data/tuning";
import type { MeleeStepDef } from "../data/weapons";

/** 極意の形（武器種ごと）。cone = 扇 / circle = 自分の周り / thrust = 突き / tip = 先端だけ強い突き / shots = 魔弾 */
export const WEAPON_ART = {
  sword: { kind: "cone", name: "十文字", radius: 36, halfAngle: 0.9, hits: 2, mul: 0.6 },
  greatsword: { kind: "circle", name: "大車輪", radius: 44, hits: 1, mul: 1.4 },
  twinBlades: { kind: "thrust", name: "乱れ突き", length: 40, halfWidth: 7, hits: 5, mul: 0.3 },
  spear: { kind: "thrust", name: "槍衾", length: 72, halfWidth: 6, hits: 1, mul: 1.2 },
  scythe: { kind: "cone", name: "大刈り", radius: 48, halfAngle: 1.2, hits: 1, mul: 0.9, pull: true },
  fists: { kind: "thrust", name: "猛打", length: 26, halfWidth: 9, hits: 4, mul: 0.35 },
  whip: { kind: "tip", name: "先端打ち", length: 80, halfWidth: 5, tipFrom: 0.75, tipMul: 1.6, mul: 0.5 },
  cleaver: { kind: "cone", name: "唐竹割り", radius: 34, halfAngle: 0.5, hits: 1, mul: 1.3, bleed: 2 },
  staff: { kind: "circle", name: "大回し", radius: 40, hits: 1, mul: 1, knockbackMul: 1.8 },
  wand: { kind: "shots", name: "魔弾", count: 3, spreadRad: 0.2, speed: 220, life: 0.6, radius: 3, mul: 0.5 },
  // 2026-09-24 レーン B の武器種（docs/ideas/combat-feel-design.md 5 章）
  katana: { kind: "thrust", name: "一閃", length: 60, halfWidth: 5, hits: 1, mul: 1.3 },
  axe: { kind: "cone", name: "大斧振り", radius: 40, halfAngle: 1, hits: 1, mul: 1.1, bleed: 2 },
  shield: { kind: "circle", name: "盾撃", radius: 36, hits: 1, mul: 0.9, knockbackMul: 2 },
  chainSickle: { kind: "tip", name: "鎖返し", length: 76, halfWidth: 5, tipFrom: 0.7, tipMul: 1.5, mul: 0.5 },
  hammer: { kind: "circle", name: "大地割り", radius: 50, hits: 1, mul: 1.5 },
  gunner: { kind: "shots", name: "乱れ撃ち", count: 5, spreadRad: 0.25, speed: 240, life: 0.6, radius: 2, mul: 0.35 },
  // 2026-09-24 銃の家系（docs/ideas/weapon-redesign.md 4 章）
  sidearm: { kind: "shots", name: "早撃ち", count: 3, spreadRad: 0.12, speed: 280, life: 0.6, radius: 2, mul: 0.45 },
  longarm: { kind: "thrust", name: "銃剣突撃", length: 56, halfWidth: 6, hits: 1, mul: 1.1 },
  cannon: { kind: "circle", name: "至近砲撃", radius: 46, hits: 1, mul: 1.3, knockbackMul: 1.8 },
  thrown: { kind: "shots", name: "投げ散らし", count: 5, spreadRad: 0.3, speed: 220, life: 0.6, radius: 3, mul: 0.35 },
  grenade: { kind: "circle", name: "砲弾の雨", radius: 52, hits: 1, mul: 1.3, knockbackMul: 1.5 },
  trapper: { kind: "circle", name: "一斉起爆", radius: 50, hits: 1, mul: 1.2 },
  warRing: { kind: "shots", name: "乱れ輪", count: 5, spreadRad: 0.3, speed: 240, life: 0.6, radius: 3, mul: 0.35 },
} as const;

/** 極意の出血（鉈）の持続と 10px あたりダメージ */
export const WEAPON_ART_BLEED = { duration: STATUS.bleed.duration, potency: 1 } as const;

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

/** 鉄塊化の重い振り（MeleeStepDef。基礎値で 10 + 1.4*5 + 0.8*5 = 21）。数値は WAVE3_SKILL_TUNING.ironForm.swing と同じ */
export const IRON_SWING_STEP = {
  windup: 0.28,
  active: 0.14,
  recover: 0.42,
  scaling: { base: 10, str: 1.4, vit: 0.8 },
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
