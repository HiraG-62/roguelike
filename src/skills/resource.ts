import type { AttrRatio } from "../loot/types";

/**
 * スキル定義の資源の共通項（docs/COMBAT_DESIGN.md B-4）。data.ts / defs*.ts が共有する。
 * 怯み値の係数（poiseRatio。A-10）は数値ブロックに置いたものをそのまま通す
 */

/** 気力型の共通項: 再使用時間 0・チャージ 1 */
export function manaSkill(block: { cost: number; minInterval: number; poise: number; poiseRatio?: AttrRatio }) {
  return {
    resource: "mana",
    cooldown: 0,
    charges: 1,
    manaCost: block.cost,
    minInterval: block.minInterval,
    poise: block.poise,
    poiseRatio: block.poiseRatio,
  } as const;
}

/** 再使用型の共通項: コスト 0、再使用時間とチャージ制。poise を省略すると数値ブロックの poise（無ければ 0） */
export function cooldownSkill(block: { cooldown: number; minInterval: number; poise?: number; poiseRatio?: AttrRatio }, poise?: number) {
  return {
    resource: "cooldown",
    cooldown: block.cooldown,
    charges: 1,
    manaCost: 0,
    minInterval: block.minInterval,
    poise: poise ?? block.poise ?? 0,
    poiseRatio: block.poiseRatio,
  } as const;
}
