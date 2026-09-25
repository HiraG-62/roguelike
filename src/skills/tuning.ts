/**
 * 大拡張（docs/ideas/skills-expansion.md）のスキル・刻印符・連携の数値。
 * 数値本体は data/balance/skills/（EXTRA_SKILL_TUNING / EXTRA_MODIFIER_TUNING / COMBO_TUNING）に移した。
 * このファイルは既存の import 元（skills/data.ts 以外の十数ファイル）を変えずに済むよう BALANCE を再 export するだけの薄い層として残す
 * （docs/ideas/data-externalization.md 8 章レーンDの方針。178 ファイルの import 先を変えないのと同じ考え方）。
 */
import { BALANCE } from "../data/balance";

export const EXTRA_SKILL_TUNING = BALANCE.skills.EXTRA_SKILL_TUNING;
export const EXTRA_MODIFIER_TUNING = BALANCE.skills.EXTRA_MODIFIER_TUNING;
export const COMBO_TUNING = BALANCE.skills.COMBO_TUNING;
