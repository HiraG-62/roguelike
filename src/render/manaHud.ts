import type { GameState } from "../core/state";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";

/**
 * HUD のマナバー（docs/COMBAT_DESIGN.md B-8）。HP バーの直下に青で出す。
 * 装着中のマナ型スキルの最小コストの位置に細い区切り線を引き、「あと何で撃てるか」を読ませる
 */

export const COLOR_MANA = "#4aa0ff";
const COLOR_MANA_BG = "#102040";
const COLOR_MANA_MARK = "#e0f0ff";
const MARK_W = 1;

/** 装着中のマナ型スキルの最小コスト（基礎値）。マナ型が無ければ null */
export function minEquippedManaCost(state: GameState): number | null {
  const profile = state.skills.profile;
  let min: number | null = null;
  for (let i = 0; i < profile.loadout.length; i++) {
    const stone = stoneInSlot(profile, i);
    if (!stone) continue;
    const def = SKILL_DEFS[stone.skillKey];
    if (def.resource !== "mana" || def.manaCost <= 0) continue;
    min = min === null ? def.manaCost : Math.min(min, def.manaCost);
  }
  return min;
}

/** 0..1 に収める。上限 0 のときは空として扱う */
export function manaRatio(mana: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, mana / max));
}

export function drawManaBar(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, w: number, h: number): void {
  const max = state.stats.maxMana;
  ctx.fillStyle = COLOR_MANA_BG;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COLOR_MANA;
  ctx.fillRect(x, y, Math.round(w * manaRatio(state.player.mana, max)), h);
  const cost = minEquippedManaCost(state);
  if (cost === null || max <= 0 || cost >= max) return;
  ctx.fillStyle = COLOR_MANA_MARK;
  ctx.fillRect(x + Math.round(w * manaRatio(cost, max)), y, MARK_W, h);
}
