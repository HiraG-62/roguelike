import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import {
  type BranchHint,
  type ButtonKey,
  type MovesetDef,
  type ShotDef,
  branchHints,
  chargeButton,
  chargeLevelAt,
  shotButtons,
} from "../data/weapons";
import { FEEL, WEAPON } from "../data/tuning";
import { currentShot, isAttacking, playerMoveset } from "../system/player";
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
/** 溜めの目盛り（段のピップの行に、溜めている間だけ出す） */
const GAUGE_W = 40;
const GAUGE_H = 3;
const COLOR_GAUGE_MARK = "#202020";

export interface ComboPip {
  readonly filled: boolean;
  readonly final: boolean;
}

/** 段のピップの状態。攻撃していなければ全て空、攻撃中は今の段までを塗る（最終段は final） */
export function comboPips(stepsCount: number, step: number, attacking: boolean): ComboPip[] {
  return Array.from({ length: stepsCount }, (_, i) => ({ filled: attacking && i <= step, final: i === stepsCount - 1 }));
}

const BUTTON_LABEL: Readonly<Record<ButtonKey, string>> = { primary: "左", secondary: "右" };

/**
 * 溜めの役割と両手で撃つ武器の案内（「右 長押し: 溜め」「左 / 右: 撃つ」）。
 * 刀・大剣・戦鎚の溜め、二丁拳銃の左右、溜めて撃つ射撃の型を 1 行にまとめる。案内が無ければ undefined
 */
export function chargeHint(moveset: MovesetDef, shot: ShotDef): string | undefined {
  const parts: string[] = [];
  const charge = chargeButton(moveset);
  if (charge) parts.push(`${BUTTON_LABEL[charge]} 長押し: 溜め`);
  const shots = shotButtons(moveset).map((b) => BUTTON_LABEL[b]).join(" / ");
  if (shots && shot.charge) parts.push(`${shots} 長押し: 溜め撃ち`);
  else if (shotButtons(moveset).length > 1) parts.push(`${shots}: 撃つ`);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

export interface ChargeGauge {
  /** 最後の段までの進み（0..1） */
  readonly ratio: number;
  /** 届いた段（0 = まだ） */
  readonly level: number;
  /** 各段の位置（0..1） */
  readonly marks: readonly number[];
}

/** 溜めの目盛り。押している秒と段の定義から、進み・届いた段・段の位置を出す */
export function chargeGauge(held: number, levels: readonly { readonly time: number }[]): ChargeGauge | undefined {
  const last = levels[levels.length - 1]?.time ?? 0;
  if (last <= 0) return undefined;
  return {
    ratio: Math.min(1, Math.max(0, held / last)),
    level: chargeLevelAt(levels, held),
    marks: levels.map((l) => l.time / last),
  };
}

/** 今溜めている近接または射撃の目盛り。溜めていなければ undefined */
function activeChargeGauge(state: GameState, moveset: MovesetDef): ChargeGauge | undefined {
  const p = state.player;
  if (p.attack.charging) return chargeGauge(p.attack.chargeTime, moveset.charge?.levels ?? []);
  if (p.shotCharging) return chargeGauge(p.shotChargeTime, currentShot(state.stats).charge?.levels ?? []);
  return undefined;
}

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
  const gauge = activeChargeGauge(state, moveset);
  if (gauge) drawGauge(ctx, cx, bottom - line, gauge);
  else drawPips(ctx, cx, bottom - line, comboPips(moveset.steps.length, p.attack.step, isAttacking(p)));
  // 派生の案内が無いときは溜め・両手撃ちの案内を出す（刀の右長押しなど、押し方が見えない役割のため）
  const hints = branchHints(moveset, p.attack.inputs);
  const hintText = hints.length > 0 ? formatBranchHints(hints) : chargeHint(moveset, currentShot(state.stats));
  if (hintText) drawText(ctx, hintText, cx, bottom, TEXT.SMALL, COLOR_HINT, "center");
}

function drawGauge(ctx: CanvasRenderingContext2D, cx: number, y: number, gauge: ChargeGauge): void {
  const left = Math.round(cx - GAUGE_W / 2);
  const top = Math.round(y - GAUGE_H);
  ctx.fillStyle = COLOR_PIP_EMPTY;
  ctx.fillRect(left, top, GAUGE_W, GAUGE_H);
  ctx.fillStyle = WEAPON.chargeRingColors[gauge.level] ?? COLOR_PIP_FILLED;
  ctx.fillRect(left, top, Math.round(GAUGE_W * gauge.ratio), GAUGE_H);
  ctx.fillStyle = COLOR_GAUGE_MARK;
  for (const m of gauge.marks) ctx.fillRect(left + Math.round(GAUGE_W * m) - 1, top, 1, GAUGE_H);
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
