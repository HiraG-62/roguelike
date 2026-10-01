import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { FACE_CHIPS, HEADER_CRUMBS_X, holdRatio, menuHits, viewModule } from "../ui/inventory";
import { focusedHit } from "../ui/menuFocus";
import { menuGuideText } from "../ui/menuInput";
import { type GuideVerb, type InventoryUi, type MenuHit, type MenuView, rootFace, topView } from "../ui/menuState";
import { drawActPage } from "./actPageUi";
import { drawAttire } from "./attireUi";
import { drawCandidates } from "./candidatesUi";
import { MENU_INK, box, drawHoldRing, menuText, px } from "./crestDraw";
import { drawCrest } from "./crestUi";
import { drawFlow, drawFlowBoard } from "./flowUi";
import { tileHash } from "./renderMath";
import { drawSheet } from "./sheetUi";
import { drawSkillPage } from "./skillPageUi";

export { MENU_INK, captureMenuDraw, drawFocusBrackets, drawHoldRing, menuText, noteMarks } from "./crestDraw";

/**
 * 装備画面（装束と紋）の殻の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E2）。state と ui を読むだけ。
 * 墨染めの帳と漆の縁・見出し（面の札・頁の名・階）・荷札 2 行・操作案内・長押しの環を描き、頁の中身は頁ごとの描画に振り分ける。
 * 文字は焦点の 1 つにだけ付く荷札と見出し・案内だけ（情報の予算。数は書付に出す）。単一指標は出さない
 */

/** 見出し・区切り・荷札・操作案内の y（上端） */
const HEADER_Y = 4;
const HEADER_RULE_Y = 16;
const TAG_TITLE_Y = 224;
const TAG_SUB_Y = 238;
const GUIDE_Y = 256;
const TEXT_X = 8;
const TEXT_RIGHT = 472;
const TEXT_W = TEXT_RIGHT - TEXT_X;
/** 見出しの右（階・件数）の幅 */
const HEADER_RIGHT_W = 100;
/** 荷札の 1 行目の右寄せ（地金 ▲▼・費用）の幅 */
const TAG_ASIDE_W = 132;
const TAG_MARK = "▶ ";

// -----------------------------------------------------------------------------
// 帳と縁
// -----------------------------------------------------------------------------

/** 紙の繊維（座標のハッシュで決まる点。1 度だけ数えて使い回す） */
interface Fiber {
  x: number;
  y: number;
  w: number;
  color: string;
}

const FIBER_INSET = 4;
const FIBER_A_RATE = 0.012;
const FIBER_A_WIDE = 0.004;
const FIBER_B_RATE = 0.99;
const HASH_SCALE = 2 ** 32;
const FIBER_SEED_X = 911;
const FIBER_SEED_Y = 57;

let fibers: Fiber[] | null = null;

function paperFibers(): Fiber[] {
  if (fibers !== null) return fibers;
  const out: Fiber[] = [];
  for (let y = FIBER_INSET; y < VIEW_H - FIBER_INSET; y++) {
    for (let x = FIBER_INSET; x < VIEW_W - FIBER_INSET; x++) {
      const v = tileHash(x + FIBER_SEED_X, y + FIBER_SEED_Y) / HASH_SCALE;
      if (v < FIBER_A_RATE) out.push({ x, y, w: v < FIBER_A_WIDE ? 2 : 1, color: MENU_INK.fiberA });
      else if (v > FIBER_B_RATE) out.push({ x, y, w: 1, color: MENU_INK.fiberB });
    }
  }
  fibers = out;
  return out;
}

/** 墨染めの帳（見本 E.html の paper()） */
function drawPaper(ctx: CanvasRenderingContext2D): void {
  px(ctx, 0, 0, VIEW_W, VIEW_H, MENU_INK.paper);
  for (const f of paperFibers()) px(ctx, f.x, f.y, f.w, 1, f.color);
}

const CORNER = 8;

/** 四隅の金具 1 つ（fx / fy = 向き） */
function drawCorner(ctx: CanvasRenderingContext2D, cx: number, cy: number, fx: 1 | -1, fy: 1 | -1): void {
  const p = (i: number, j: number, w: number, h: number, c: string): void =>
    px(ctx, fx > 0 ? cx + i : cx + CORNER - i - w, fy > 0 ? cy + j : cy + CORNER - j - h, w, h, c);
  p(0, 0, 8, 2, MENU_INK.goldLo);
  p(0, 0, 2, 8, MENU_INK.goldLo);
  p(0, 0, 7, 1, MENU_INK.gold);
  p(0, 0, 1, 7, MENU_INK.gold);
  p(1, 1, 5, 1, MENU_INK.goldHi);
  p(1, 1, 1, 5, MENU_INK.goldHi);
  p(2, 2, 3, 3, MENU_INK.gold);
  p(3, 3, 1, 1, MENU_INK.shu);
}

/** 朱と金の漆の縁（見本 E.html の frame()） */
function drawFrame(ctx: CanvasRenderingContext2D): void {
  box(ctx, 0, 0, VIEW_W, VIEW_H, MENU_INK.frame1);
  box(ctx, 1, 1, VIEW_W - 2, VIEW_H - 2, MENU_INK.frame2);
  box(ctx, 2, 2, VIEW_W - 4, VIEW_H - 4, MENU_INK.frame3);
  drawCorner(ctx, 0, 0, 1, 1);
  drawCorner(ctx, VIEW_W - CORNER, 0, -1, 1);
  drawCorner(ctx, 0, VIEW_H - CORNER, 1, -1);
  drawCorner(ctx, VIEW_W - CORNER, VIEW_H - CORNER, -1, -1);
}

// -----------------------------------------------------------------------------
// 見出し・荷札・操作案内
// -----------------------------------------------------------------------------

function drawFaceChips(ctx: CanvasRenderingContext2D, ui: Readonly<InventoryUi>): void {
  const face = rootFace(ui);
  for (const chip of FACE_CHIPS) {
    const on = chip.face === face;
    const r = chip.rect;
    px(ctx, r.x, r.y, r.w, r.h, on ? MENU_INK.card2 : MENU_INK.paper);
    box(ctx, r.x, r.y, r.w, r.h, on ? MENU_INK.gold : MENU_INK.rule);
    if (on) px(ctx, r.x + 2, r.y + r.h - 1, r.w - 4, 1, MENU_INK.focus);
    menuText(ctx, chip.label, r.x + r.w / 2, HEADER_Y, { size: "SMALL", color: on ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "center" });
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<MenuView>): void {
  drawFaceChips(ctx, ui);
  const header = viewModule(view).header(state, ui, view);
  const right = header.right;
  const crumbsW = (right === null ? TEXT_RIGHT : TEXT_RIGHT - HEADER_RIGHT_W) - HEADER_CRUMBS_X;
  menuText(ctx, header.crumbs, HEADER_CRUMBS_X, HEADER_Y, { size: "SMALL", color: MENU_INK.text, role: "label", maxW: crumbsW });
  if (right !== null) menuText(ctx, right, TEXT_RIGHT, HEADER_Y, { size: "SMALL", color: MENU_INK.sub, role: "label", align: "right", maxW: HEADER_RIGHT_W });
  px(ctx, TEXT_X, HEADER_RULE_Y, TEXT_W, 1, MENU_INK.rule);
}

/** 荷札（焦点の 1 つにだけ付く 2 行）。一時の知らせは 2 行目に出す */
function drawTag(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<MenuView>, focus: MenuHit | null): void {
  const tag = viewModule(view).tag(state, ui, view, focus);
  const aside = tag.aside;
  if (tag.title !== "") {
    const w = aside === null ? TEXT_W : TEXT_W - TAG_ASIDE_W;
    menuText(ctx, `${TAG_MARK}${tag.title}`, TEXT_X, TAG_TITLE_Y, { size: "BODY", color: MENU_INK.focus, role: "sentence", maxW: w });
  }
  if (aside !== null) menuText(ctx, aside, TEXT_RIGHT, TAG_TITLE_Y + 1, { size: "SMALL", color: MENU_INK.sub, role: "label", align: "right", maxW: TAG_ASIDE_W });
  const note = ui.note;
  if (note !== null) {
    menuText(ctx, note.text, TEXT_X, TAG_SUB_Y, { size: "SMALL", color: MENU_INK.focus, role: "sentence", maxW: TEXT_W });
    return;
  }
  if (tag.sub !== "") menuText(ctx, tag.sub, TEXT_X, TAG_SUB_Y, { size: "SMALL", color: MENU_INK.text, role: "sentence", maxW: TEXT_W });
}

/** 操作案内。1 段目の「戻る」は「閉じる」 */
function guideVerbs(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<MenuView>): GuideVerb[] {
  const verbs = viewModule(view).guide(state, view);
  return verbs.map((v) => (v === "back" && ui.stack.length <= 1 ? "close" : v));
}

function drawGuide(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<MenuView>): void {
  const text = menuGuideText(guideVerbs(state, ui, view), rootFace(ui));
  menuText(ctx, text, TEXT_X, GUIDE_Y, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: TEXT_W });
}

// -----------------------------------------------------------------------------
// 頁の振り分け
// -----------------------------------------------------------------------------

function drawPage(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<MenuView>, hits: readonly MenuHit[]): void {
  switch (view.kind) {
    case "attire":
      drawAttire(ctx, state, ui, view, hits);
      return;
    case "crest":
      drawCrest(ctx, state, ui, view, hits);
      return;
    case "candidates":
      drawCandidates(ctx, state, ui, view, hits);
      return;
    case "flow":
      drawFlow(ctx, state, ui, view, hits);
      return;
    case "flowBoard":
      drawFlowBoard(ctx, state, ui, view, hits);
      return;
    case "skills":
      drawSkillPage(ctx, state, ui, view, hits);
      return;
    case "act":
      drawActPage(ctx, state, ui, view, hits);
      return;
    case "sheet":
      drawSheet(ctx, state, ui, view, hits);
      return;
  }
}

/** 装備画面。閉じていれば何もしない */
export function drawInventoryUi(ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi): void {
  if (!ui.open) return;
  const view = topView(ui);
  if (view === null) return;
  const hits = menuHits(state, ui);
  drawPaper(ctx);
  drawPage(ctx, state, ui, view, hits);
  drawHeader(ctx, state, ui, view);
  drawTag(ctx, state, ui, view, focusedHit(hits, view.focus));
  drawGuide(ctx, state, ui, view);
  const hold = ui.hold;
  const held = hold === null ? null : focusedHit(hits, hold.id);
  if (held !== null) drawHoldRing(ctx, held.rect, holdRatio(ui));
  drawFrame(ctx);
}
