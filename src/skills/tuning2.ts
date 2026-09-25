/**
 * スキル第 2 弾（地形・新しい状態異常・属性・武器種・ジョブ・変身・空間）の数値。
 * 数値本体は data/balance/skills/（WAVE2_SKILL_TUNING / WAVE2_MODIFIER_TUNING / WAVE2_COMBO_TUNING / WEAR_TUNING / FORM_TUNING）に移した。
 * WEAPON_ART / WEAPON_ART_BLEED は union 文字列（HitShape の kind）を含むため TS のまま skills/reshapes.ts に居る。
 * このファイルは既存の import 元を変えずに済むよう再 export するだけの薄い層として残す（docs/ideas/data-externalization.md 8 章）
 */
import { BALANCE } from "../data/balance";

export const WAVE2_SKILL_TUNING = BALANCE.skills.WAVE2_SKILL_TUNING;
export const WAVE2_MODIFIER_TUNING = BALANCE.skills.WAVE2_MODIFIER_TUNING;
export const WAVE2_COMBO_TUNING = BALANCE.skills.WAVE2_COMBO_TUNING;
export const WEAR_TUNING = BALANCE.skills.WEAR_TUNING;
export const FORM_TUNING = BALANCE.skills.FORM_TUNING;
export { WEAPON_ART, WEAPON_ART_BLEED } from "./reshapes";
