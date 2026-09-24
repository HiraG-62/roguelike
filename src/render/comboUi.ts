import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { type BranchHint, type ButtonKey, branchHints } from "../data/weapons";
import { FEEL } from "../data/tuning";
import { isAttacking, playerMoveset } from "../system/player";
import { TEXT, drawText, textLineHeight } from "./pixelText";

/**
 * コンボの可視化 HUD（画面下中央、スキル HUD の上）。武器名 / 段のピップ / 次に押すと出る派生を出す
 * （docs/ideas/combat-feel-design.md D-1）。state を読むだけで、ロジックには触れない
 */

/** スキル HUD の枠（skillHud.ts の HUD_BOTTOM 26 + HUD_SIZE 16）の上に積む隙間 */
const SKILL_HUD_TOP = 42;
const BOTTOM_GAP = 4;
const COLOR_NAME = "#d0d0d0";
const COLOR_HINT = "#a0c8e0";
const PIP_SIZE = 3;
const PIP_FINAL_SIZE = 4;
const PIP_GAP = 2;
const COLOR_PIP_EMPTY = "#505050";
const COLOR_PIP_FILLED = "#e0e0e0";
const COLOR_PIP_FINAL = "#ffd75f";

export interface ComboPip {
  readonly filled: boolean;
  readonly final: boolean;
}

/** 段のピップの状態。攻撃していなければ全て空、攻撃中は今の段までを塗る（最終段は final） */
export function comboPips(stepsCount: number, step: number, attacking: boolean): ComboPip[] {
  return Array.from({ length: stepsCount }, (_, i) => ({ filled: attacking && i <= step, final: i === stepsCount - 1 }));
}

const BUTTON_LABEL: Readonly<Record<ButtonKey, string>> = { primary: "左", secondary: "右" };

/** 「右: 十字断ち」のように、次に押すと出る派生を 1 行にまとめる */
export function formatBranchHints(hints: readonly BranchHint[]): string {
  return hints.map((h) => `${BUTTON_LABEL[h.button]}: ${h.name}`).join(" / ");
}

export function drawComboHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.status !== "playing") return;
  const p = state.player;
  const moveset = playerMoveset(state);
  const cx = VIEW_W / 2;
  const line = textLineHeight(TEXT.SMALL);
  const bottom = VIEW_H - SKILL_HUD_TOP - BOTTOM_GAP;

  // 派生を振っている間は、段のピップの代わりに派生名を出す
  const branchName = p.attack.branch >= 0 ? moveset.branches[p.attack.branch]?.name : undefined;
  if (branchName) {
    drawText(ctx, branchName, cx, bottom - line, TEXT.SMALL, FEEL.branchTextColor, "center");
    return;
  }

  drawText(ctx, moveset.name, cx, bottom - line * 2, TEXT.SMALL, COLOR_NAME, "center");
  drawPips(ctx, cx, bottom - line, comboPips(moveset.steps.length, p.attack.step, isAttacking(p)));
  const hints = branchHints(moveset, p.attack.inputs);
  if (hints.length > 0) drawText(ctx, formatBranchHints(hints), cx, bottom, TEXT.SMALL, COLOR_HINT, "center");
}

function drawPips(ctx: CanvasRenderingContext2D, cx: number, y: number, pips: readonly ComboPip[]): void {
  if (pips.length === 0) return;
  const widths = pips.map((pip) => (pip.final ? PIP_FINAL_SIZE : PIP_SIZE));
  const totalW = widths.reduce((sum, w) => sum + w, 0) + PIP_GAP * (pips.length - 1);
  let x = Math.round(cx - totalW / 2);
  pips.forEach((pip, i) => {
    const size = widths[i] ?? PIP_SIZE;
    ctx.fillStyle = pip.filled ? (pip.final ? COLOR_PIP_FINAL : COLOR_PIP_FILLED) : COLOR_PIP_EMPTY;
    ctx.fillRect(x, Math.round(y - size), size, size);
    x += size + PIP_GAP;
  });
}
