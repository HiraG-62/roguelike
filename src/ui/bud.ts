import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import type { AffixRoll } from "../loot/types";
import { chooseBud } from "../system/loot";
import { CONTENT_Y, RIGHT_W, RIGHT_X, STASH_HEADER_H, type Rect, pointInRect } from "./inventoryLayout";

/**
 * 芽（2 択の成長）の画面ロジック。docs/LOOT_DESIGN.md「来歴と芽」。
 * 戦闘中は知らせるだけ（render/budUi.ts）。選択は装備画面を開いたときだけ:
 * 倉庫の見出し行が「芽が出ています」バナーになり、クリックで 2 択のモーダルを開く。誤操作で選ばないため
 */

export const BUD_MODAL_W = 300;
export const BUD_MODAL_H = 132;
export const BUD_CARD_W = 136;
export const BUD_CARD_H = 76;
export const BUD_CARD_GAP = 8;
/** モーダル上端からカード上端まで（見出し 2 行ぶん） */
export const BUD_CARD_TOP = 30;
export const BUD_OPTION_COUNT = 2;

export interface BudUi {
  /** 2 択のモーダルを開いている */
  open: boolean;
  hover: number | null;
}

export function createBudUi(): BudUi {
  return { open: false, hover: null };
}

export interface BudModalLayout {
  frame: Rect;
  cards: Rect[];
}

/** 装備タブの倉庫の見出し行。芽があるときはバナーになる */
export function budBannerRect(): Rect {
  return { x: RIGHT_X, y: CONTENT_Y, w: RIGHT_W, h: STASH_HEADER_H };
}

export function layoutBudModal(): BudModalLayout {
  const frame = {
    x: Math.round((VIEW_W - BUD_MODAL_W) / 2),
    y: Math.round((VIEW_H - BUD_MODAL_H) / 2),
    w: BUD_MODAL_W,
    h: BUD_MODAL_H,
  };
  const totalW = BUD_OPTION_COUNT * BUD_CARD_W + (BUD_OPTION_COUNT - 1) * BUD_CARD_GAP;
  const left = frame.x + Math.round((frame.w - totalW) / 2);
  const cards = Array.from({ length: BUD_OPTION_COUNT }, (_, i) => ({
    x: left + i * (BUD_CARD_W + BUD_CARD_GAP),
    y: frame.y + BUD_CARD_TOP,
    w: BUD_CARD_W,
    h: BUD_CARD_H,
  }));
  return { frame, cards };
}

export function closeBudModal(bud: BudUi): void {
  bud.open = false;
  bud.hover = null;
}

/** バナーのクリックでモーダルを開く。芽が無ければ何もしない。開いたら true */
export function tryOpenBudModal(state: GameState, bud: BudUi, input: FrameInput): boolean {
  if (state.pendingBud === null || !input.clickPressed || input.aimScreen === null) return false;
  if (!pointInRect(input.aimScreen, budBannerRect())) return false;
  bud.open = true;
  bud.hover = null;
  pushSfx(state, "uiOpen");
  return true;
}

function pressedIndex(input: FrameInput, cardIndex: number): number | null {
  if (input.skill1Pressed) return 0;
  if (input.skill2Pressed) return 1;
  return input.clickPressed && cardIndex >= 0 ? cardIndex : null;
}

/**
 * モーダルの 1 フレーム分。カードのクリック（または 1 / 2 キー）で chooseBud、枠の外のクリックで閉じる。
 * 選べたら選んだ性質、それ以外は null
 */
export function updateBudModal(state: GameState, bud: BudUi, input: FrameInput): AffixRoll | null {
  if (state.pendingBud === null) {
    closeBudModal(bud);
    return null;
  }
  const layout = layoutBudModal();
  const aim = input.aimScreen;
  const cardIndex = aim === null ? -1 : layout.cards.findIndex((r) => pointInRect(aim, r));
  bud.hover = cardIndex >= 0 ? cardIndex : null;
  const index = pressedIndex(input, cardIndex);
  if (index !== null) {
    const chosen = chooseBud(state, index);
    if (chosen === null) return null;
    closeBudModal(bud);
    pushSfx(state, "boonSelect");
    return chosen;
  }
  if (input.clickPressed && aim !== null && !pointInRect(aim, layout.frame)) closeBudModal(bud);
  return null;
}
