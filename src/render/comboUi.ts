import type { GameState } from "../core/state";
import {
  type BranchHint,
  type ButtonKey,
  type MovesetDef,
  type BulletDef,
  type ActionStepDef,
  actionStepName,
  branchHints,
  chargeLevelAt,
  isGun,
  laneLength,
  meleeChargeOf,
} from "../data/weapons";
import { FEEL, WEAPON } from "../data/tuning";
import { currentShot, isAttacking, nextLaneIndex, playerMoveset } from "../system/player";
import { actionCooldownLeft } from "../system/weaponArts";
import { hudLayoutFor } from "./layers";
import { TEXT, drawText, textLineHeight, truncateText } from "./pixelText";
import type { HudLayout } from "./renderMath";

/**
 * コンボの可視化 HUD（画面下中央。位置と幅は renderMath.ts の hudLayout で、右下のスキル枠に掛からない）。武器名 / 段のピップ（左右共有の段カウンタ）/
 * 次に押すと出る派生、または左右の次の段を出す
 * （docs/ideas/combat-feel-design.md D-1）。state を読むだけで、ロジックには触れない
 */

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

/** 再使用の残りを出す桁（0.1 秒刻み） */
const COOLDOWN_DIGITS = 1;

/** 押し続ける段（居合・狙い撃ち・盾の構え）は「長押し」と添える */
function artPress(art: ActionStepDef): string {
  const long = art.kind === "charge" || art.kind === "aim" || (art.kind === "hold" && art.hold.guard);
  return long ? `${BUTTON_LABEL.secondary} 長押し` : BUTTON_LABEL.secondary;
}

/** 左の案内（溜めの武器種・溜め撃ちの弾は「長押し」、銃の家系は射撃、近接は段の番号） */
function primaryHint(moveset: MovesetDef, shot: BulletDef, index: number): string {
  if (moveset.primary === "charge") return `${BUTTON_LABEL.primary} 長押し: 溜め`;
  if (isGun(moveset)) return shot.charge ? `${BUTTON_LABEL.primary} 長押し: 溜め撃ち` : `${BUTTON_LABEL.primary}: 射撃`;
  const step = Math.min(index, laneLength(moveset, "primary") - 1);
  return `${BUTTON_LABEL.primary}: ${step + 1} 段目`;
}

/**
 * 左右の次の段の案内（「左: 2 段目 / 右: 返し斬り」「左 長押し: 溜め / 右: 薙ぎ払い」「左: 射撃 / 右 長押し: 狙い撃ち」）。
 * index は左右共有の段カウンタが次に指す段（右レーンを超えたら 1 段目）。右の段の再使用中は残り秒を添える
 */
export function controlHint(moveset: MovesetDef, shot: BulletDef, index = 0, cooldownLeft = 0): string {
  const rightIndex = index < moveset.steps2.length ? index : 0;
  const right = moveset.steps2[rightIndex] ?? moveset.steps2[0];
  const wait = cooldownLeft > 0 ? `（あと ${cooldownLeft.toFixed(COOLDOWN_DIGITS)} 秒）` : "";
  return `${primaryHint(moveset, shot, index)} / ${artPress(right)}: ${actionStepName(right, rightIndex)}${wait}`;
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
  if (p.attack.charging) return chargeGauge(p.attack.chargeTime, meleeChargeOf(moveset)?.levels ?? []);
  if (p.shotCharging) return chargeGauge(p.shotChargeTime, currentShot(state.stats).charge?.levels ?? []);
  const held = moveset.steps2[p.attack.step];
  if (p.art.holding && held?.kind === "aim") return chargeGauge(p.art.holdTime, [{ time: held.aim.time }]);
  return undefined;
}

/** 「右: 十字断ち」のように、次に押すと出る派生を 1 行にまとめる */
export function formatBranchHints(hints: readonly BranchHint[]): string {
  return hints.map((h) => `${BUTTON_LABEL[h.button]}: ${h.name}`).join(" / ");
}

export function drawComboHud(ctx: CanvasRenderingContext2D, state: GameState, layout: HudLayout = hudLayoutFor(state)): void {
  if (state.status !== "playing") return;
  const p = state.player;
  const moveset = playerMoveset(state);
  const cx = layout.combo.x + layout.combo.w / 2;
  const maxW = layout.combo.w;
  const line = textLineHeight(TEXT.SMALL);
  const bottom = layout.comboBottom;

  // 派生を振っている間は、段のピップの代わりに派生名を出す
  const branchName = p.attack.branch >= 0 ? moveset.branches[p.attack.branch]?.name : undefined;
  if (branchName) {
    drawText(ctx, truncateText(branchName, maxW, TEXT.SMALL), cx, bottom - line, TEXT.SMALL, FEEL.branchTextColor, "center");
    return;
  }

  drawText(ctx, truncateText(moveset.name, maxW, TEXT.SMALL), cx, bottom - line * 2, TEXT.SMALL, COLOR_NAME, "center");
  const gauge = activeChargeGauge(state, moveset);
  if (gauge) drawGauge(ctx, cx, bottom - line, gauge);
  else drawPips(ctx, cx, bottom - line, comboPips(pipCount(moveset), p.attack.step, isAttacking(p) || p.attack.step > 0));
  const index = nextLaneIndex(state, moveset) ?? 0;
  const next = moveset.steps2[index];
  const wait = next ? actionCooldownLeft(state, next) : 0;
  const hint = hudHintText(moveset, p.attack.inputs, currentShot(state.stats), index, wait);
  drawText(ctx, truncateText(hint, maxW, TEXT.SMALL), cx, bottom, TEXT.SMALL, COLOR_HINT, "center");
}

/** 段のピップの数（左右の長い方。銃の家系は左に段が無いので右レーンの段数） */
function pipCount(moveset: MovesetDef): number {
  return Math.max(laneLength(moveset, "primary"), laneLength(moveset, "secondary"));
}

/** 案内の 1 行。いまの入力列から成立しそうな派生（「左左」の後の「右: 十字断ち」など）があればそれを、無ければ左右の次の段を出す */
export function hudHintText(moveset: MovesetDef, inputs: readonly ButtonKey[], shot: BulletDef, index: number, cooldownLeft: number): string {
  const hints = branchHints(moveset, inputs);
  if (hints.length > 0) return formatBranchHints(hints);
  return controlHint(moveset, shot, index, cooldownLeft);
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
