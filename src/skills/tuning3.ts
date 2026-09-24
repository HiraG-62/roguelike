/**
 * スキル第 3 弾（変身 5 種: 狼化・霊体化・砲身化・鉄塊化・業火の化身）の数値。
 * 数値本体は data/balance/skills.json（WAVE3_SKILL_TUNING / SHAPE_TUNING）に移した。
 * 狼化の噛みつき（bite）・鉄塊化の重い振り（swing）は union 文字列（HitShape の kind）を含むため
 * TS のまま skills/reshapes.ts に居り、skills/data.ts の SKILL がそちらと合流させる（この WAVE3_SKILL_TUNING には含まれない）。
 * このファイルは既存の import 元（system/combat.ts / skills/defs3.ts / forms.ts）を変えずに済むよう再 export するだけの薄い層として残す
 * （docs/ideas/data-externalization.md 8 章）
 */
import { BALANCE } from "../data/balance";

export const WAVE3_SKILL_TUNING = BALANCE.skills.WAVE3_SKILL_TUNING;
export const SHAPE_TUNING = BALANCE.skills.SHAPE_TUNING;
