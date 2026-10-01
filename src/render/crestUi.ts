import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { BOON } from "../data/tuning";
import { BOONS, BOON_ACTIONS, LINEAGE_LABEL, type BoonAction, type BoonKey, type LineageKey } from "../system/boonDefs";
import { gracesOf, graceSlotsOf } from "../system/boons";
import { ATTIRE_SLOTS } from "../ui/attire";
import {
  type BeadSlot,
  type CrestRowRect,
  CREST_LAYOUT,
  DAI,
  crestRowRects,
  daiActRect,
  daiPartRect,
  findOriginItem,
  lineageCellX,
  ownedCoreKey,
  ownedLineages,
  removalDeltas,
  rowSlots,
} from "../ui/crest";
import { type CrestShape, crestShape, sourceKey } from "../ui/crestShape";
import { focusedSource } from "../ui/menuActions";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, ViewOf } from "../ui/menuState";
import type { BandDelta } from "../ui/tryOn";
import {
  type BeadTone,
  MENU_INK,
  blinkOn,
  box,
  dashBox,
  drawBand,
  drawBead,
  drawFocusBrackets,
  drawGlyphDisc,
  drawOverflowBead,
  drawPlusBead,
  drawStepDots,
  menuText,
  mixHex,
  px,
} from "./crestDraw";

/**
 * 紋の面の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W3、見本 E.html の ③ 紋）。state と ui を読むだけ。
 * 帯 = 系統、左に源・右に糧の珠。珠に焦点があるとその物の珠を白く光らせ、外すと細る帯を ▼ / 消 で点滅させる。
 * 文字は丸印・身・行動の 1 字だけ（情報の予算の外の飾り）。荷札・見出し・操作案内は殻（render/inventoryUi.ts）が描く
 */

/** 系譜の札の色（系譜ごとの色は祝福カードに無いので、ここで決める。見た目だけ） */
export const LINEAGE_INK: Readonly<Record<LineageKey, string>> = {
  ash: "#e0784a",
  frost: "#7cc8e8",
  thunder: "#e8d44a",
  moon: "#a884e0",
  earth: "#b8905a",
  blade: "#d8dae0",
  cycle: "#6cd0a4",
  horde: "#d88ab8",
  wealth: "#e8c050",
};

/** 融合の札（2 系譜）の色 */
const FUSION_INK = "#e0b060";

/** 部位の 1 字（珠の角・台の身） */
export const PART_GLYPH: Readonly<Record<LootSlot, string>> = {
  mainHand: "刀",
  head: "頭",
  armor: "体",
  boots: "足",
  ring: "指",
  amulet: "首",
};

const ACTION_GLYPH: Readonly<Record<BoonAction, string>> = {
  primary: "左",
  secondary: "右",
  dash: "駆",
  skill: "技",
  ultimate: "奥",
};

/** 描画の間だけ引き回す物（引数が長くなりすぎないように） */
interface CrestPaint {
  ctx: CanvasRenderingContext2D;
  state: Readonly<GameState>;
  ui: Readonly<InventoryUi>;
  view: Readonly<ViewOf<"crest">>;
  /** 焦点の物の珠の key（null なら全部ふつう） */
  litKey: string | null;
  /** 焦点の物を外すと細る帯 */
  thinning: readonly BandDelta[];
  /** 点滅の表側 */
  on: boolean;
}

function toneOf(p: Readonly<CrestPaint>, key: string): BeadTone {
  if (p.litKey === null) return "n";
  return key === p.litKey ? "lit" : "ink";
}

function slotId(keyword: Keyword, s: Readonly<BeadSlot>): string {
  if (s.kind === "bead" && s.bead !== null) return fid.bead(keyword, s.verb, s.bead.key);
  if (s.kind === "plus") return fid.plus(keyword, s.verb);
  return fid.more(keyword, s.verb);
}

function drawNamedMark(p: Readonly<CrestPaint>, s: Readonly<BeadSlot>): void {
  if (s.bead === null || s.bead.shape !== "relic") return;
  const item = findOriginItem(p.state, s.bead.source);
  if (item?.namedKey !== undefined) px(p.ctx, s.x + 1, s.y + 1, 2, 1, MENU_INK.gold);
}

function drawSlot(p: Readonly<CrestPaint>, row: CrestRowRect, s: Readonly<BeadSlot>): void {
  const size = CREST_LAYOUT.beadSize;
  const focused = p.view.focus === slotId(row.row.keyword, s);
  if (s.kind === "bead" && s.bead !== null) {
    const slot = s.bead.source.slot;
    const glyph = slot === undefined || slot === "offHand" ? undefined : PART_GLYPH[slot];
    drawBead(p.ctx, s.bead, s.x, s.y, 12, focused ? "lit" : toneOf(p, s.bead.key), glyph);
    drawNamedMark(p, s);
  } else if (s.kind === "more") {
    drawOverflowBead(p.ctx, s.x, s.y, s.folded, p.litKey === null ? "n" : "ink");
  } else {
    drawPlusBead(p.ctx, s.x, s.y, MENU_INK.dim, focused);
  }
  if (focused) drawFocusBrackets(p.ctx, { x: s.x, y: s.y, w: size, h: size });
}

/** 珠の列から帯へ引く細い線（珠の列の端から帯の端まで） */
function drawSideRule(p: Readonly<CrestPaint>, row: CrestRowRect, slots: readonly BeadSlot[]): void {
  const L = CREST_LAYOUT;
  const produces = slots.filter((s) => s.verb === "produces");
  const consumes = slots.filter((s) => s.verb === "consumes");
  const farSource = produces[produces.length - 1];
  const farSink = consumes[consumes.length - 1];
  const half = L.beadSize / 2;
  if (farSource !== undefined) px(p.ctx, farSource.x + half, row.cy, L.bandX0 - farSource.x - half, 1, MENU_INK.rule);
  if (farSink !== undefined) px(p.ctx, L.bandX1, row.cy, farSink.x + half - L.bandX1, 1, MENU_INK.rule);
}

function rowTouches(row: CrestRowRect, key: string): boolean {
  return [...row.row.produces, ...row.row.consumes, ...row.row.amplifies].some((b) => b.key === key);
}

/** 外すと細る帯の印（消 / ▼） */
function drawThinMark(p: Readonly<CrestPaint>, row: CrestRowRect, change: Readonly<BandDelta>): void {
  menuText(p.ctx, change.change === "gone" ? "消" : "▼", CREST_LAYOUT.markX, row.cy, { size: "SMALL", color: MENU_INK.down, role: "ornament", baseline: "middle" });
}

function drawRow(p: Readonly<CrestPaint>, row: CrestRowRect): void {
  const L = CREST_LAYOUT;
  const { keyword, step, undercurrent } = row.row;
  const color = KEYWORD_DEFS[keyword].color;
  const change = p.thinning.find((d) => d.keyword === keyword);
  const stepNow = change !== undefined && !p.on ? change.to : step;
  const focused = p.view.focus === fid.band(keyword);
  const dimmed = p.litKey !== null && change === undefined && !rowTouches(row, p.litKey);
  const slots = rowSlots(row);
  drawSideRule(p, row, slots);
  if (undercurrent) {
    drawBand(p.ctx, L.bandX0, L.bandX1, row.cy, 0, color, p.ui.time);
    drawGlyphDisc(p.ctx, keyword, L.discX, row.cy, L.underDisc, color, { under: true, focus: focused });
  } else {
    drawBand(p.ctx, L.bandX0, L.bandX1, row.cy, stepNow, dimmed ? mixHex(color, "#000000", 0.55) : color, p.ui.time);
    drawGlyphDisc(p.ctx, keyword, L.discX, row.cy, L.steppedDisc, dimmed ? mixHex(color, "#000000", 0.4) : color, { focus: focused });
    drawStepDots(p.ctx, L.dotsX, row.y + L.dotsDy, stepNow, dimmed ? MENU_INK.dim : color);
  }
  for (const s of slots) drawSlot(p, row, s);
  if (change !== undefined) drawThinMark(p, row, change);
}

// -----------------------------------------------------------------------------
// 下の台（身 6・加護の帯 5・系譜・芯・系統を選ぶ）
// -----------------------------------------------------------------------------

function drawPartTile(p: Readonly<CrestPaint>, shape: Readonly<CrestShape>, slot: LootSlot, i: number): void {
  const r = daiPartRect(i);
  const item = p.state.profile.equipment[slot] ?? null;
  const focused = p.view.focus === fid.daiPart(slot);
  const used = item !== null && shape.rows.some((row) => [...row.produces, ...row.consumes, ...row.amplifies].some((b) => b.source.id === item.id));
  const lit = focused || (item !== null && p.litKey === sourceKey({ kind: "relic", id: item.id, slot }));
  px(p.ctx, r.x, r.y, r.w, r.h, MENU_INK.card);
  box(p.ctx, r.x, r.y, r.w, r.h, lit ? MENU_INK.focus : used ? MENU_INK.sub : MENU_INK.dim);
  menuText(p.ctx, PART_GLYPH[slot], r.x + r.w / 2, r.y + r.h / 2, {
    size: "SMALL",
    color: lit ? MENU_INK.focus : used ? MENU_INK.text : MENU_INK.dim,
    role: "ornament",
    align: "center",
    baseline: "middle",
  });
  if (item?.budOffer) px(p.ctx, r.x + 11, r.y + 1, 2, 2, MENU_INK.bud);
  if (focused) drawFocusBrackets(p.ctx, r);
}

function pipColor(key: BoonKey): string {
  const def = BOONS[key];
  if (def.fusion !== undefined) return FUSION_INK;
  return def.lineage === undefined ? MENU_INK.text : LINEAGE_INK[def.lineage];
}

function drawActTile(p: Readonly<CrestPaint>, action: BoonAction, i: number): void {
  const r = daiActRect(i);
  const focused = p.view.focus === fid.daiAct(action);
  px(p.ctx, r.x, r.y, r.w, r.h, MENU_INK.card2);
  box(p.ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : MENU_INK.sub);
  px(p.ctx, r.x, r.y, 2, 2, MENU_INK.paper);
  px(p.ctx, r.x + r.w - 2, r.y + r.h - 2, 2, 2, MENU_INK.paper);
  menuText(p.ctx, ACTION_GLYPH[action], r.x + r.w / 2, r.y + r.h / 2, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.text,
    role: "ornament",
    align: "center",
    baseline: "middle",
  });
  const graces = gracesOf(p.state, action);
  const slots = graceSlotsOf(p.state, action);
  for (let j = 0; j < slots; j++) {
    const x = r.x + DAI.pipDx + j * DAI.pipPitch;
    const y = r.y + DAI.pipDy;
    const key = graces[j];
    if (key === undefined) box(p.ctx, x, y, DAI.pipSize, DAI.pipSize, MENU_INK.dim);
    else px(p.ctx, x, y, DAI.pipSize, DAI.pipSize, p.litKey === sourceKey({ kind: "boon", id: key }) ? MENU_INK.focus : pipColor(key));
  }
  if (focused) drawFocusBrackets(p.ctx, { x: r.x, y: r.y, w: DAI.pipDx + (slots - 1) * DAI.pipPitch + DAI.pipSize, h: r.h });
}

function drawLineageCell(p: Readonly<CrestPaint>, lineage: LineageKey, count: number, i: number): void {
  const x = lineageCellX(i);
  const color = LINEAGE_INK[lineage];
  const focused = p.view.focus === fid.daiLineage(lineage);
  const disc = DAI.lineageDisc;
  px(p.ctx, x + 3, DAI.y, disc, disc, MENU_INK.card);
  box(p.ctx, x + 3, DAI.y, disc, disc, focused ? MENU_INK.focus : color);
  menuText(p.ctx, LINEAGE_LABEL[lineage].slice(0, 1), x + 3 + disc / 2, DAI.y + disc / 2, { size: "SMALL", color, role: "ornament", align: "center", baseline: "middle" });
  for (let j = 0; j < BOON.apexMinCards; j++) {
    const bx = x + 2 + j * 4;
    px(p.ctx, bx, DAI.y + DAI.lineageBarsDy, 3, 2, j < count ? color : MENU_INK.dim);
  }
  if (focused) drawFocusBrackets(p.ctx, { x: x + 3, y: DAI.y, w: disc, h: disc });
}

const CORE_FILL = "#3a3428";
const CORE_FLAME = "#f0c050";

function drawCore(p: Readonly<CrestPaint>): void {
  const c = DAI.core;
  const focused = p.view.focus === fid.daiCore;
  px(p.ctx, c.x, c.y, c.w, c.h, CORE_FILL);
  box(p.ctx, c.x, c.y, c.w, c.h, focused ? MENU_INK.focus : MENU_INK.gold);
  px(p.ctx, c.x + 3, c.y + 3, 2, 4, CORE_FLAME);
  if (focused) drawFocusBrackets(p.ctx, c);
}

const BOARD_DOT = 2;
const BOARD_DOT_PITCH = 4;
const BOARD_DOT_INSET = 2;
const BOARD_DOTS = 3;

function drawBoardButton(p: Readonly<CrestPaint>): void {
  const b = DAI.board;
  const focused = p.view.focus === fid.board;
  const color = focused ? MENU_INK.focus : MENU_INK.sub;
  dashBox(p.ctx, b.x, b.y, b.w, b.h, color);
  for (let j = 0; j < BOARD_DOTS; j++) {
    for (let i = 0; i < BOARD_DOTS; i++) {
      px(p.ctx, b.x + BOARD_DOT_INSET + i * BOARD_DOT_PITCH, b.y + BOARD_DOT_INSET + j * BOARD_DOT_PITCH, BOARD_DOT, BOARD_DOT, color);
    }
  }
  if (focused) drawFocusBrackets(p.ctx, b);
}

const DIVIDER_Y = 188;
const DIVIDER_H = 30;
const RULE_X = 8;
const RULE_W = 464;

function drawDai(p: Readonly<CrestPaint>, shape: Readonly<CrestShape>): void {
  px(p.ctx, RULE_X, DAI.ruleY, RULE_W, 1, MENU_INK.rule);
  ATTIRE_SLOTS.forEach((slot, i) => drawPartTile(p, shape, slot, i));
  px(p.ctx, DAI.partDividerX, DIVIDER_Y, 1, DIVIDER_H, MENU_INK.rule);
  BOON_ACTIONS.forEach((action, i) => drawActTile(p, action, i));
  const lineages = ownedLineages(p.state);
  const core = ownedCoreKey(p.state);
  if (lineages.length > 0 || core !== null) px(p.ctx, DAI.actDividerX, DIVIDER_Y, 1, DIVIDER_H, MENU_INK.rule);
  lineages.forEach((l, i) => drawLineageCell(p, l.lineage, l.count, i));
  if (core !== null) drawCore(p);
  if (shape.hidden.length > 0) drawBoardButton(p);
}

/** 紋の面 */
export function drawCrest(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  ui: Readonly<InventoryUi>,
  view: Readonly<ViewOf<"crest">>,
  _hits: readonly MenuHit[],
): void {
  const shape = crestShape(state);
  const source = focusedSource(state, ui);
  const p: CrestPaint = {
    ctx,
    state,
    ui,
    view,
    litKey: source === null ? null : sourceKey(source),
    thinning: source === null ? [] : removalDeltas(state, source),
    on: blinkOn(ui.time),
  };
  for (const row of crestRowRects(shape)) drawRow(p, row);
  drawDai(p, shape);
}
