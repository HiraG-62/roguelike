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
  firesByHand,
  laneLength,
  meleeChargeOf,
  movesetLabel,
  shootsPrimary,
} from "../data/weapons";
import { FEEL, WEAPON } from "../data/tuning";
import { currentForm, moraleGauge } from "../system/morale";
import { currentShot, isAttacking, nextLaneIndex, plannedInputs, playerMoveset } from "../system/player";
import { HAND_ACTION_NAME, type HandAction, type HandsView, handsView, nextHandAction } from "../system/dualPistols";
import { actionCooldownLeft } from "../system/weaponArts";
import { shapeMoveset } from "../skills/forms";
import { hudLayoutFor } from "./layers";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";
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

/** 押し続ける段（居合・盾の構え）は「長押し」と添える */
function artPress(art: ActionStepDef): string {
  const long = art.kind === "charge" || (art.kind === "hold" && art.hold.guard);
  return long ? `${BUTTON_LABEL.secondary} 長押し` : BUTTON_LABEL.secondary;
}

/** 左の案内（溜めの武器種・溜め撃ちの弾は「長押し」、左で撃つ武器種は射撃、近接は段の番号） */
function primaryHint(moveset: MovesetDef, shot: BulletDef, index: number): string {
  if (moveset.primary === "charge") return `${BUTTON_LABEL.primary} 長押し: 溜め`;
  if (shootsPrimary(moveset)) return shot.charge ? `${BUTTON_LABEL.primary} 長押し: 溜め撃ち` : `${BUTTON_LABEL.primary}: 射撃`;
  const step = Math.min(index, laneLength(moveset, "primary") - 1);
  // 弾を撃つ段（杖の詠唱）は段の番号ではなく魔法の名前を出す
  const cast = moveset.steps[step]?.cast;
  return cast ? `${BUTTON_LABEL.primary}: ${cast.name}` : `${BUTTON_LABEL.primary}: ${step + 1} 段目`;
}

/**
 * 左右の次の段の案内（「左: 2 段目 / 右: 返し斬り」「左 長押し: 溜め / 右: 薙ぎ払い」「左: 射撃 / 右 長押し: 狙い撃ち」）。
 * index は左右共有の段カウンタが次に指す段（右レーンを超えたら 1 段目）。右の段の再使用中は残り秒を添える
 */
export function controlHint(moveset: MovesetDef, shot: BulletDef, index = 0, cooldownLeft = 0, releaseKeys: readonly string[] = []): string {
  const rightIndex = index < moveset.steps2.length ? index : 0;
  const right = moveset.steps2[rightIndex] ?? moveset.steps2[0];
  const wait = cooldownLeft > 0 ? `（あと ${cooldownLeft.toFixed(COOLDOWN_DIGITS)} 秒）` : "";
  const release = right.key !== undefined && releaseKeys.includes(right.key) ? RELEASE_MARK : "";
  return `${primaryHint(moveset, shot, index)} / ${artPress(right)}: ${actionStepName(right, rightIndex)}${release}${wait}`;
}

/** 右の次の段が戦意の放出の段のときの印（用語は GLOSSARY の「放出」） */
const RELEASE_MARK = "（放出）";

/** 放出の段になる右レーンの key。放出が右の段（laneStep）の型で、戦意が溜まる型だけ（骨の型は放出が起きないので印を出さない） */
export function releaseStepKeys(state: GameState): readonly string[] {
  if (!moraleGauge(state).active) return [];
  const release = currentForm(state).morale.release;
  return release.kind === "laneStep" || release.kind === "nextShot" ? release.keys : [];
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

  if (firesByHand(moveset)) {
    drawHandsHud(ctx, state, moveset, cx, bottom, maxW);
    return;
  }
  // 素手の名前は装備の型のときだけ（変身中は変身の名前。変身の型の key は装備の武器種のままなので key では区別できない）
  const unarmed = state.stats.unarmed && shapeMoveset(state) === null;
  drawText(ctx, truncateText(movesetLabel(moveset, unarmed), maxW, TEXT.SMALL), cx, bottom - line * 2, TEXT.SMALL, COLOR_NAME, "center");
  const gauge = activeChargeGauge(state, moveset);
  if (gauge) drawGauge(ctx, cx, bottom - line, gauge);
  else drawPips(ctx, cx, bottom - line, comboPips(pipCount(moveset), p.attack.step, isAttacking(p) || p.attack.step > 0));
  const index = nextLaneIndex(state, moveset) ?? 0;
  const next = moveset.steps2[index];
  const wait = next ? actionCooldownLeft(state, next) : 0;
  const hint = hudHintText(moveset, plannedInputs(state), currentShot(state.stats), index, wait, releaseStepKeys(state));
  drawText(ctx, truncateText(hint, maxW, TEXT.SMALL), cx, bottom, TEXT.SMALL, COLOR_HINT, "center");
}

// ---------------------------------------------------------------------------
// 二丁拳銃の手（system/dualPistols.ts）
// ---------------------------------------------------------------------------

/** 同じ手の連続の数（1 = 射撃、2・3 = 技）。ピップの数 */
const HAND_CHAIN_PIPS = 3;
/** 手の札とピップの間（px） */
const HAND_LABEL_GAP = 3;

const HAND_BUTTON: readonly ButtonKey[] = ["primary", "secondary"];

/** 手の連続の札（「左」/「右」。連続が切れていれば空） */
export function handChainLabel(view: Readonly<HandsView>): string {
  if (view.lastHand === undefined || view.count <= 0) return "";
  return BUTTON_LABEL[HAND_BUTTON[view.lastHand] ?? "primary"];
}

/** 二丁拳銃の案内の 1 行（「左: 蹴り / 右: 射撃 / 拍 3」）。左右それぞれ今押すと出るものと、今の拍 */
export function handsHintText(left: HandAction, right: HandAction, beatLabel: string, beat: number): string {
  return `${BUTTON_LABEL.primary}: ${HAND_ACTION_NAME[left]} / ${BUTTON_LABEL.secondary}: ${HAND_ACTION_NAME[right]} / ${beatLabel} ${Math.floor(beat)}`;
}

/** 二丁拳銃: 武器名 / 続けている手と連続の数のピップ / 左右の次と拍 */
function drawHandsHud(ctx: CanvasRenderingContext2D, state: GameState, moveset: MovesetDef, cx: number, bottom: number, maxW: number): void {
  const line = textLineHeight(TEXT.SMALL);
  drawText(ctx, truncateText(movesetLabel(moveset, false), maxW, TEXT.SMALL), cx, bottom - line * 2, TEXT.SMALL, COLOR_NAME, "center");
  const view = handsView(state);
  const pips = comboPips(HAND_CHAIN_PIPS, view.count - 1, view.count > 0);
  const label = handChainLabel(view);
  if (label === "") drawPips(ctx, cx, bottom - line, pips);
  else drawLabeledPips(ctx, cx, bottom - line, label, pips);
  const gauge = moraleGauge(state);
  const hint = handsHintText(nextHandAction(state, 0), nextHandAction(state, 1), gauge.label, gauge.value);
  drawText(ctx, truncateText(hint, maxW, TEXT.SMALL), cx, bottom, TEXT.SMALL, COLOR_HINT, "center");
}

/** 札（「左」）の後ろにピップを並べ、全体を cx の中央に置く */
function drawLabeledPips(ctx: CanvasRenderingContext2D, cx: number, y: number, label: string, pips: readonly ComboPip[]): void {
  const labelW = textWidth(label, TEXT.SMALL);
  const pipsW = pips.reduce((sum, pip) => sum + (pip.final ? PIP_FINAL_SIZE : PIP_SIZE), 0) + PIP_GAP * (pips.length - 1);
  const left = Math.round(cx - (labelW + HAND_LABEL_GAP + pipsW) / 2);
  drawText(ctx, label, left, y, TEXT.SMALL, COLOR_NAME);
  drawPips(ctx, left + labelW + HAND_LABEL_GAP + pipsW / 2, y, pips);
}

/** 段のピップの数（左右の長い方。銃の家系は左に段が無いので右レーンの段数） */
function pipCount(moveset: MovesetDef): number {
  return Math.max(laneLength(moveset, "primary"), laneLength(moveset, "secondary"));
}

/** 案内の 1 行。いまの入力列から成立しそうな派生（「左左」の後の「右: 十字断ち」など）があればそれを、無ければ左右の次の段を出す */
export function hudHintText(
  moveset: MovesetDef,
  inputs: readonly ButtonKey[],
  shot: BulletDef,
  index: number,
  cooldownLeft: number,
  releaseKeys: readonly string[] = [],
): string {
  const hints = branchHints(moveset, inputs);
  if (hints.length > 0) return formatBranchHints(hints);
  return controlHint(moveset, shot, index, cooldownLeft, releaseKeys);
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
