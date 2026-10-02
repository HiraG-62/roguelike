import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { resonanceBySource } from "../system/resonance";
import { findOriginItem, originBead, originCard } from "../ui/crest";
import { crestShape, sourceKey } from "../ui/crestShape";
import { BOARD_KEYWORDS, BOARD_LAYOUT, FLOW_LAYOUT, type FlowCard, boardCenter, flowCards, foldRect } from "../ui/flow";
import { focusedSource } from "../ui/menuActions";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";
import { MENU_INK, box, dashBox, drawBand, drawBead, drawGlyphDisc, drawPlusBead, drawStepDots, line, menuText, px } from "./crestDraw";

/**
 * 系統の頁と系統を選ぶ盤の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W4、見本 E.html の ④ 系統を開く）。state と ui を読むだけ。
 * 文字は札の名前と「源」「糧」「＋」の字だけ（情報の予算の外の飾り）。荷札・見出し・操作案内は殻が描く
 */

const FOLD_DISC = 12;
const FOLD_DOTS_DX = 17;
const FOLD_DOTS_Y = 23;
const FOLD_UNDERLINE_Y = 34;
const FOLD_UNDERLINE_W = 14;
const FOLD_LINE_Y = 24;
const FOLD_LINE_W = 11;
const CAPTION_RIGHT = 472;
const CAPTION_LEFT = 8;
/** 札の左端から珠・名前までのずれ */
const CARD_BEAD_DX = 5;
const CARD_NAME_DX = 22;
const CARD_NAME_PAD = 26;
const CARD_PLUS_INSET = 5;
const BEAD_SIZE = 12;
/** 札から中央の丸印へ引く線の、札の縁の x（源は右の縁・糧は左の縁）と丸印の手前 */
const LINK_SOURCE_X = 152;
const LINK_SINK_X = 328;
const LINK_DISC_GAP = 22;
const CENTER_DOTS_DX = 8;
const CENTER_DOTS_DY = 26;
const RULE_X = 8;
const RULE_W = 464;
const VERB_ADD = { produces: "源を足す", consumes: "糧を足す", amplifies: "強めを足す" } as const;

interface FlowPaint {
  ctx: CanvasRenderingContext2D;
  state: Readonly<GameState>;
  view: Readonly<ViewOf<"flow">>;
  /** 焦点の札の出どころの珠の key（同じ物の珠を光らせる） */
  litKey: string | null;
}

function cardId(keyword: Keyword, c: Readonly<FlowCard>): string {
  return c.origin === null ? fid.plus(keyword, c.verb) : fid.src(sourceKey(c.origin), c.verb);
}

function drawPlusCard(p: Readonly<FlowPaint>, c: Readonly<FlowCard>, focused: boolean): void {
  const r = c.rect;
  px(p.ctx, r.x, r.y, r.w, r.h, MENU_INK.paper);
  dashBox(p.ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : MENU_INK.dim);
  drawPlusBead(p.ctx, r.x + CARD_PLUS_INSET, r.y + CARD_PLUS_INSET, MENU_INK.dim, focused);
  menuText(p.ctx, VERB_ADD[c.verb], r.x + CARD_NAME_DX, r.y + r.h / 2, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.sub,
    role: "ornament",
    maxW: r.w - CARD_NAME_PAD,
    baseline: "middle",
  });
}

function drawSourceCard(p: Readonly<FlowPaint>, c: Readonly<FlowCard>, focused: boolean): void {
  const origin = c.origin;
  if (origin === null) return;
  const r = c.rect;
  const beadY = r.y + ((r.h - BEAD_SIZE) >> 1);
  px(p.ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.card2 : MENU_INK.card);
  box(p.ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : MENU_INK.rule);
  const bead = originBead(p.state, origin);
  drawBead(p.ctx, bead, r.x + CARD_BEAD_DX, beadY, 12, focused || p.litKey === bead.key ? "lit" : "n");
  if (findOriginItem(p.state, origin)?.namedKey !== undefined) px(p.ctx, r.x + CARD_BEAD_DX + 1, beadY + 1, 2, 1, MENU_INK.gold);
  menuText(p.ctx, originCard(p.state, origin).name, r.x + CARD_NAME_DX, r.y + r.h / 2, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.text,
    role: "ornament",
    maxW: r.w - CARD_NAME_PAD,
    baseline: "middle",
  });
}

/** 札の縁から中央の丸印へ引く線（段の立った系統は色、立っていなければ点線） */
function drawLink(p: Readonly<FlowPaint>, c: Readonly<FlowCard>, step: number, color: string): void {
  if (c.verb === "amplifies") return;
  const L = FLOW_LAYOUT;
  const y = c.rect.y + c.rect.h / 2;
  const fromX = c.verb === "produces" ? LINK_SOURCE_X : LINK_SINK_X;
  const toX = c.verb === "produces" ? L.centerX - LINK_DISC_GAP : L.centerX + LINK_DISC_GAP;
  const plain = c.origin === null || step === 0;
  line(p.ctx, fromX, y, toX, L.centerY, plain ? MENU_INK.dim : color, plain);
}

function drawFolds(p: Readonly<FlowPaint>): void {
  crestShape(p.state).rows.forEach((row, i) => {
    const x = foldRect(i).x;
    const color = KEYWORD_DEFS[row.keyword].color;
    const focused = p.view.focus === fid.fold(row.keyword);
    drawGlyphDisc(p.ctx, row.keyword, x + FOLD_DISC / 2 + 1, FLOW_LAYOUT.foldDiscY, FOLD_DISC, color, { under: row.undercurrent, focus: focused });
    if (row.undercurrent) line(p.ctx, x + FOLD_DOTS_DX, FOLD_LINE_Y, x + FOLD_DOTS_DX + FOLD_LINE_W, FOLD_LINE_Y, MENU_INK.dim, true);
    else drawStepDots(p.ctx, x + FOLD_DOTS_DX, FOLD_DOTS_Y, row.step, color, 2, 2);
    if (row.keyword === p.view.keyword) px(p.ctx, x, FOLD_UNDERLINE_Y, FOLD_UNDERLINE_W, 1, MENU_INK.focus);
  });
}

/** 系統の頁 */
export function drawFlow(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  ui: Readonly<InventoryUi>,
  view: Readonly<ViewOf<"flow">>,
  _hits: readonly MenuHit[],
): void {
  const L = FLOW_LAYOUT;
  const source = focusedSource(state, ui);
  const p: FlowPaint = { ctx, state, view, litKey: source === null ? null : sourceKey(source) };
  const keyword = view.keyword;
  const step = resonanceBySource(state)[keyword].step;
  const color = KEYWORD_DEFS[keyword].color;
  drawFolds(p);
  menuText(ctx, "源", CAPTION_LEFT, L.captionY, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  menuText(ctx, "糧", CAPTION_RIGHT, L.captionY, { size: "SMALL", color: MENU_INK.sub, role: "ornament", align: "right" });
  const cards = flowCards(state, keyword);
  for (const c of cards) drawLink(p, c, step, color);
  drawBand(ctx, L.centerX - L.bandHalf, L.centerX + L.bandHalf, L.centerY, step, color, ui.time);
  drawGlyphDisc(ctx, keyword, L.centerX, L.centerY, L.centerDisc, color, { under: step === 0 });
  drawStepDots(ctx, L.centerX - CENTER_DOTS_DX, L.centerY + CENTER_DOTS_DY, step, color, 4, 2);
  for (const c of cards) {
    const focused = view.focus === cardId(keyword, c);
    if (c.origin === null) drawPlusCard(p, c, focused);
    else drawSourceCard(p, c, focused);
  }
  px(ctx, RULE_X, L.ruleY, RULE_W, 1, MENU_INK.rule);
}

const BOARD_DOTS_DX = 6;
const BOARD_DOTS_DY = 16;
const BOARD_DOT = 3;
const BOARD_DOT_GAP = 2;

/** 系統を選ぶ盤（丸印だけの 8 × 5。段の立った系統は色、他は墨） */
export function drawFlowBoard(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  view: Readonly<ViewOf<"flowBoard">>,
  _hits: readonly MenuHit[],
): void {
  const by = resonanceBySource(state);
  BOARD_KEYWORDS.forEach((keyword, i) => {
    const c = boardCenter(i);
    const step = by[keyword].step;
    const color = KEYWORD_DEFS[keyword].color;
    drawGlyphDisc(ctx, keyword, c.x, c.y, BOARD_LAYOUT.disc, color, { under: step === 0, focus: view.focus === fid.kw(keyword) });
    if (step > 0) drawStepDots(ctx, c.x - BOARD_DOTS_DX, c.y + BOARD_DOTS_DY, step, color, BOARD_DOT, BOARD_DOT_GAP);
  });
}
