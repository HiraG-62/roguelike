/**
 * スキル第 2 弾（地形・新しい状態異常・属性・ジョブ・空間）の数値と、変身の共通（FORM_TUNING）・使い込み（WEAR_TUNING）。
 * 数値本体は data/balance/skills/（WAVE2_SKILL_TUNING / WAVE2_MODIFIER_TUNING / WAVE2_COMBO_TUNING / WEAR_TUNING / FORM_TUNING）に移した。
 * このファイルは既存の import 元を変えずに済むよう再 export するだけの薄い層として残す（docs/ideas/data-externalization.md 8 章）
 */
import { BALANCE } from "../data/balance";

export const WAVE2_SKILL_TUNING = BALANCE.skills.WAVE2_SKILL_TUNING;
export const WAVE2_MODIFIER_TUNING = BALANCE.skills.WAVE2_MODIFIER_TUNING;
export const WAVE2_COMBO_TUNING = BALANCE.skills.WAVE2_COMBO_TUNING;
export const WEAR_TUNING = BALANCE.skills.WEAR_TUNING;
export const FORM_TUNING = BALANCE.skills.FORM_TUNING;
