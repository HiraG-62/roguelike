import type { GameState } from "../core/state";
import { type MagazineHandView, type MagazineView, magazineView } from "../system/magazine";
import { TEXT, drawText } from "./pixelText";
import type { HudRect } from "./renderMath";

/**
 * 銃の弾倉の HUD（docs/ideas/gun-bases-review.md 0-3）。自分の足元に、手ごとに残りの弾の丸を 1 列（容量が多い器は 1 本のバーと残りの数）、
 * 込めの最中はその下に込めのバー（短銃は早込めの窓の印）、砲は詰めの段の枡を右に並べる。二丁拳銃は手ごとに 2 列。
 * 銃でない武器種は描かない。state を読むだけで、乱数は使わない
 */

const COLOR_ROUND = "#f0e0b0";
const COLOR_ROUND_EMPTY = "#403828";
const COLOR_RELOAD = "#a0c8f0";
const COLOR_RELOAD_BG = "#202830";
const COLOR_QUICK_WINDOW = "#ffd060";
const COLOR_PACK = "#ff9040";
const COLOR_PACK_EMPTY = "#3a2818";
const COLOR_COUNT = "#d8c8a0";

/** 丸 1 つの大きさと間（論理 px） */
export const ROUND_SIZE = 2;
export const ROUND_GAP = 1;
/** これより容量が多い器は丸を並べず、バーと残りの数にする（短機関銃の 20 発が長くなり過ぎないように） */
export const ROUND_PIPS_MAX = 10;
/** 丸を並べないときのバーの幅 */
export const ROUND_BAR_W = 20;
/** 込めのバーの高さと、丸の列との間 */
const RELOAD_BAR_H = 1;
const ROW_GAP = 1;
/** 手と手の列の間 */
const HAND_GAP = 2;
/** 自分の体の下端からの間（足元の影に掛からない） */
const BELOW_BODY = 5;
/** 詰めの枡の大きさと、弾の列との間 */
const PACK_SIZE = 2;
const PACK_GAP = 1;
const PACK_LEFT_GAP = 3;

/** 1 列の幅（丸を並べるか、バーか） */
export function roundsRowWidth(capacity: number): number {
  if (capacity <= 0) return 0;
  if (capacity > ROUND_PIPS_MAX) return ROUND_BAR_W;
  return capacity * ROUND_SIZE + (capacity - 1) * ROUND_GAP;
}

/** 丸 i（0 始まり）の左端（列の左端から） */
export function roundOffset(i: number): number {
  return i * (ROUND_SIZE + ROUND_GAP);
}

/** 手 1 本ぶんの高さ（丸の列 + 込めのバー） */
function handRowHeight(): number {
  return ROUND_SIZE + ROW_GAP + RELOAD_BAR_H;
}

export interface MagazineHandLayout {
  /** 丸の列（またはバー）の矩形 */
  readonly rounds: HudRect;
  /** 込めのバーの矩形 */
  readonly reload: HudRect;
}

export interface MagazineHudLayout {
  readonly hands: readonly MagazineHandLayout[];
  /** 詰めの枡（左から 1 段目）。詰めない武器種は空 */
  readonly pack: readonly HudRect[];
}

/** 配置。cx は体の中心の画面 x、top は列の上端。手ごとに下へ積む（丸の列の幅は容量で決まり、中央揃え） */
export function magazineHudLayout(view: Readonly<MagazineView>, cx: number, top: number): MagazineHudLayout {
  const hands = view.hands.map((hand, i) => {
    const w = roundsRowWidth(hand.capacity);
    const x = Math.round(cx - w / 2);
    const y = top + i * (handRowHeight() + HAND_GAP);
    return { rounds: { x, y, w, h: ROUND_SIZE }, reload: { x, y: y + ROUND_SIZE + ROW_GAP, w, h: RELOAD_BAR_H } };
  });
  const first = hands[0];
  const pack: HudRect[] = [];
  if (first) {
    const px = first.rounds.x + first.rounds.w + PACK_LEFT_GAP;
    for (let i = 0; i < view.pack.max; i++) pack.push({ x: px + i * (PACK_SIZE + PACK_GAP), y: first.rounds.y, w: PACK_SIZE, h: PACK_SIZE });
  }
  return { hands, pack };
}

/** 込めのバーの埋まる幅（進み 0..1） */
export function reloadFillWidth(w: number, progress: number): number {
  return Math.round(w * Math.min(1, Math.max(0, progress)));
}

/** 早込めの窓の印の左端と幅（バーの中の割合 from..to）。窓が無ければ null */
export function quickWindowSpan(w: number, window: MagazineView["quickWindow"]): { x: number; w: number } | null {
  if (!window) return null;
  const x = Math.round(w * window.from);
  return { x, w: Math.max(1, Math.round(w * window.to) - x) };
}

function drawRounds(ctx: CanvasRenderingContext2D, hand: MagazineHandView, rect: HudRect): void {
  if (hand.capacity > ROUND_PIPS_MAX) {
    ctx.fillStyle = COLOR_ROUND_EMPTY;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = COLOR_ROUND;
    ctx.fillRect(rect.x, rect.y, Math.round((rect.w * hand.rounds) / hand.capacity), rect.h);
    drawText(ctx, `${hand.rounds}`, rect.x + rect.w + PACK_LEFT_GAP, rect.y + Math.round(rect.h / 2), TEXT.SMALL, COLOR_COUNT, "left", "middle");
    return;
  }
  for (let i = 0; i < hand.capacity; i++) {
    ctx.fillStyle = i < hand.rounds ? COLOR_ROUND : COLOR_ROUND_EMPTY;
    ctx.fillRect(rect.x + roundOffset(i), rect.y, ROUND_SIZE, ROUND_SIZE);
  }
}

function drawReloadBar(ctx: CanvasRenderingContext2D, hand: MagazineHandView, rect: HudRect, window: MagazineView["quickWindow"]): void {
  if (!hand.busy) return;
  ctx.fillStyle = COLOR_RELOAD_BG;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const span = quickWindowSpan(rect.w, window);
  if (span) {
    ctx.fillStyle = COLOR_QUICK_WINDOW;
    ctx.fillRect(rect.x + span.x, rect.y, span.w, rect.h);
  }
  ctx.fillStyle = COLOR_RELOAD;
  ctx.fillRect(rect.x, rect.y, reloadFillWidth(rect.w, hand.progress), rect.h);
}

/** 足元の弾倉を描く。ox / oy はワールド → 画面のずらし（renderer.ts の render と同じ値） */
export function drawMagazineHud(ctx: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
  if (state.status !== "playing") return;
  const view = magazineView(state);
  if (!view.active) return;
  const body = state.player.body;
  const layout = magazineHudLayout(view, Math.round(body.pos.x + ox), Math.round(body.pos.y + oy + body.radius + BELOW_BODY));
  view.hands.forEach((hand, i) => {
    const rect = layout.hands[i];
    if (!rect) return;
    drawRounds(ctx, hand, rect.rounds);
    // 早込めの窓は手 0 の込めだけ（短銃）
    drawReloadBar(ctx, hand, rect.reload, i === 0 ? view.quickWindow : null);
  });
  layout.pack.forEach((r, i) => {
    ctx.fillStyle = i < view.pack.level ? COLOR_PACK : COLOR_PACK_EMPTY;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  });
}
