import { type Keybinds, keyLabel } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";
import { MANUAL } from "../data/tuning";
import { MOVESETS } from "../data/weapons";
import { MANUAL_GROUP_LABEL, MANUAL_KEYS, type ManualMove, type ManualToken, cueToken } from "../meta/weaponManual";
import { demoCueIndex, demoHoldRatio } from "../system/manualDemo";
import { type DocRow, MANUAL_LAYOUT, type ManualUi, type Rect, listRowRect, listVisibleRows, manualDocRows, selectedMove } from "../ui/weaponManual";
import { drawMoraleHud } from "./moraleHud";
import { TEXT, drawText, textLineHeight, textWidth, truncateText, wrapText } from "./pixelText";
import type { Renderer } from "./renderer";

/**
 * 武器指南書の描画。状態と配置は src/ui/weaponManual.ts、実演の箱庭は system/manualDemo.ts（state を読むだけ）。
 * 実演の窓は renderer.renderDemo が本編と同じ絵で描く
 */

const COLOR_BG = "#08080c";
const COLOR_PANEL = "#101018";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_INFO = "#a0a0b0";
const COLOR_DIM = "#707080";
const COLOR_HEADING = "#c8b47a";
const COLOR_CURSOR_BG = "rgba(106,140,255,0.22)";
const COLOR_HOVER_BG = "rgba(255,255,255,0.06)";
const COLOR_FRAME = "#3a3a52";
const COLOR_CAP_BG = "#1c1c2a";
const COLOR_CAP_EDGE = "#6a6a88";
const COLOR_CAP_DONE_BG = "#3a3424";
const COLOR_CAP_DONE_EDGE = "#a08850";
const COLOR_CAP_NOW_BG = "#ffd75f";
const COLOR_CAP_NOW_TEXT = "#1a1408";
const COLOR_CAP_HOLD = "#80c0ff";
const COLOR_CHIP_BG = "#1a1a28";
const COLOR_RULE = "#24243a";

const PAD = 4;
const CAP_PAD_X = 3;
const CAP_GAP = 3;
const CAP_H = 11;
/** 長押しの札の下に引く押している割合の帯の高さ */
const HOLD_BAR_H = 2;
const CHIP_PAD_X = 2;
const CHIP_GAP = 2;
const SCROLL_MARK_INSET = 3;
/** 長押しの札に添える語 */
const LONG_SUFFIX = " 長押し";
const SEP = "›";
const OVERFLOW_MARK = "…";
/** 頁の行の札（技の行の右の入力の札）の最大幅（名前を潰さない） */
const ROW_CAPS_MAX_RATIO = 0.55;

export interface ManualView {
  ui: ManualUi;
  hint: string;
  binds?: Keybinds;
}

export function drawWeaponManual(ctx: CanvasRenderingContext2D, renderer: Renderer, view: ManualView): void {
  const { ui } = view;
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, "武器指南書", VIEW_W / 2, MANUAL_LAYOUT.titleY, TEXT.TITLE, COLOR_TITLE, "center", "middle");
  drawWeaponList(ctx, ui);
  drawDoc(ctx, ui);
  drawPreview(ctx, renderer, ui);
  drawDetail(ctx, ui, view.binds);
  drawText(ctx, truncateText(view.hint, VIEW_W - PAD * 4, TEXT.SMALL), VIEW_W / 2, MANUAL_LAYOUT.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

// ---------------------------------------------------------------------------
// 武器種の一覧
// ---------------------------------------------------------------------------

function drawWeaponList(ctx: CanvasRenderingContext2D, ui: ManualUi): void {
  const m = TEXT.SMALL;
  const lineH = textLineHeight(m);
  const l = MANUAL_LAYOUT.list;
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(l.x, l.y, l.w, l.h);
  const visible = listVisibleRows(lineH);
  for (let i = 0; i < visible; i++) {
    const index = ui.listScroll + i;
    const key = MANUAL_KEYS[index];
    if (key === undefined) break;
    const r = listRowRect(i, lineH);
    const selected = index === ui.weapon;
    if (selected) fillRect(ctx, r, COLOR_CURSOR_BG);
    else if (index === ui.hoverWeapon) fillRect(ctx, r, COLOR_HOVER_BG);
    drawText(ctx, truncateText(MOVESETS[key].name, r.w - PAD * 2, m), r.x + PAD, r.y + r.h / 2, m, selected ? COLOR_TITLE : COLOR_TEXT, "left", "middle");
  }
  if (ui.listScroll > 0) drawText(ctx, "↑", l.x + l.w - SCROLL_MARK_INSET, l.y, m, COLOR_DIM, "right", "top");
  if (ui.listScroll + visible < MANUAL_KEYS.length) drawText(ctx, "↓", l.x + l.w - SCROLL_MARK_INSET, l.y + l.h, m, COLOR_DIM, "right", "bottom");
}

// ---------------------------------------------------------------------------
// 頁（特色・型と戦意・技の一覧）
// ---------------------------------------------------------------------------

function drawDoc(ctx: CanvasRenderingContext2D, ui: ManualUi): void {
  const m = TEXT.SMALL;
  const lineH = textLineHeight(m);
  const d = MANUAL_LAYOUT.doc;
  const doc = manualDocRows(ui, (t, w) => wrapText(t, w, m), lineH);
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  for (const row of doc.rows) {
    const y = d.y + row.y - ui.docScroll;
    if (y + row.h < d.y || y > d.y + d.h) continue;
    drawDocRow(ctx, ui, row, y);
  }
  ctx.restore();
  if (ui.docScroll > 0) drawText(ctx, "↑", d.x + d.w - SCROLL_MARK_INSET, d.y, m, COLOR_DIM, "right", "top");
  if (ui.docScroll < doc.height - d.h) drawText(ctx, "↓", d.x + d.w - SCROLL_MARK_INSET, d.y + d.h, m, COLOR_DIM, "right", "bottom");
}

function drawDocRow(ctx: CanvasRenderingContext2D, ui: ManualUi, row: DocRow, y: number): void {
  const m = TEXT.SMALL;
  const d = MANUAL_LAYOUT.doc;
  const x = d.x + PAD;
  const mid = y + row.h / 2;
  switch (row.kind) {
    case "name":
      drawText(ctx, row.text, x, mid, TEXT.BODY, COLOR_TITLE, "left", "middle");
      return;
    case "summary":
      drawText(ctx, row.text, x, mid, m, COLOR_INFO, "left", "middle");
      return;
    case "heading":
    case "group":
      ctx.fillStyle = COLOR_RULE;
      ctx.fillRect(x, y + row.h - 1, d.w - PAD * 2, 1);
      drawText(ctx, `■ ${row.text}`, x, mid, m, COLOR_HEADING, "left", "middle");
      return;
    case "text":
      drawText(ctx, row.text, x, mid, m, COLOR_TEXT, "left", "middle");
      return;
    case "move":
      drawMoveRow(ctx, ui, row.index, { x: d.x, y, w: d.w, h: row.h });
  }
}

function drawMoveRow(ctx: CanvasRenderingContext2D, ui: ManualUi, index: number, r: Rect): void {
  const move = ui.page.moves[index];
  if (move === undefined) return;
  const selected = index === ui.move;
  if (selected) fillRect(ctx, r, COLOR_CURSOR_BG);
  else if (index === ui.hoverMove) fillRect(ctx, r, COLOR_HOVER_BG);
  const m = TEXT.SMALL;
  const runs = capRuns(moveTokens(move));
  const capsW = Math.min(capsWidth(runs, m), Math.floor(r.w * ROW_CAPS_MAX_RATIO));
  const right = r.x + r.w - PAD;
  drawCaps(ctx, runs, right - capsW, r.y + (r.h - CAP_H) / 2, m, capsW, IDLE_CAPS);
  const nameW = r.w - PAD * 3 - capsW;
  drawText(ctx, truncateText(move.name, nameW, m), r.x + PAD + 2, r.y + r.h / 2, m, selected ? COLOR_TITLE : COLOR_TEXT, "left", "middle");
}

// ---------------------------------------------------------------------------
// 入力の札
// ---------------------------------------------------------------------------

function moveTokens(move: ManualMove): ManualToken[] {
  return move.script.cues.map(cueToken).filter((t): t is ManualToken => t !== null);
}

/** 続けて同じ札（左 × 8 など）を 1 枚にまとめた札。start = まとめた最初の札の添字 */
interface CapRun {
  token: ManualToken;
  count: number;
  start: number;
}

/** 同じ札が CAP_RUN_MIN 枚以上続くと 1 枚にまとめる（双剣・爪の連撃が欄に収まるように。3 段の連撃は並べた方が読める） */
const CAP_RUN_MIN = 4;

export function capRuns(tokens: readonly ManualToken[]): CapRun[] {
  const runs: CapRun[] = [];
  tokens.forEach((t, i) => {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.token.label === t.label && last.token.long === t.long) last.count += 1;
    else runs.push({ token: t, count: 1, start: i });
  });
  // 短い繰り返し（左 › 左 › 左）はまとめずに並べる
  return runs.flatMap((r) => (r.count >= CAP_RUN_MIN ? [r] : Array.from({ length: r.count }, (_, k) => ({ token: r.token, count: 1, start: r.start + k }))));
}

/** 札の字。まとめた札は「左 ×8」、その札の途中なら「左 3/8」 */
function capLabel(r: CapRun, st: CapState): string {
  const base = r.token.long ? `${r.token.label}${LONG_SUFFIX}` : r.token.label;
  if (r.count === 1) return base;
  const inRun = st.now >= r.start && st.now < r.start + r.count;
  return inRun ? `${base} ${st.now - r.start + 1}/${r.count}` : `${base} ×${r.count}`;
}

/** 札の幅（まとめた札は途中の表記の分も取っておき、実演の間に幅が揺れないようにする） */
function capWidth(r: CapRun, m: number): number {
  const base = r.token.long ? `${r.token.label}${LONG_SUFFIX}` : r.token.label;
  const widest = r.count === 1 ? base : `${base} ${r.count}/${r.count}`;
  return Math.ceil(textWidth(widest, m)) + CAP_PAD_X * 2;
}

function sepWidth(m: number): number {
  return Math.ceil(textWidth(SEP, m)) + CAP_GAP * 2;
}

function capsWidth(runs: readonly CapRun[], m: number): number {
  if (runs.length === 0) return 0;
  return runs.reduce((w, r) => w + capWidth(r, m), 0) + sepWidth(m) * (runs.length - 1);
}

/** 札の光り方。now = 今の手の札の添字、done = 終えた札の数、hold = 今の手を押している割合 */
interface CapState {
  now: number;
  done: number;
  hold: number | null;
}

const IDLE_CAPS: CapState = { now: -1, done: 0, hold: null };

/** 入力の札を左から並べる（maxW を超える分は描かない） */
function drawCaps(ctx: CanvasRenderingContext2D, runs: readonly CapRun[], x0: number, y: number, m: number, maxW: number, st: CapState): void {
  let x = x0;
  let cut = false;
  runs.forEach((r, i) => {
    const w = capWidth(r, m);
    if (cut) return;
    if (x + w > x0 + maxW + 0.5) {
      // 収まらない札は描かず、続きがあることだけ示す
      cut = true;
      drawText(ctx, OVERFLOW_MARK, x - sepWidth(m) / 2, y + CAP_H / 2, m, COLOR_DIM, "center", "middle");
      return;
    }
    if (i > 0) drawText(ctx, SEP, x - sepWidth(m) / 2, y + CAP_H / 2, m, COLOR_DIM, "center", "middle");
    const now = st.now >= r.start && st.now < r.start + r.count;
    const done = r.start + r.count <= st.done;
    ctx.fillStyle = now ? COLOR_CAP_NOW_BG : done ? COLOR_CAP_DONE_BG : COLOR_CAP_BG;
    ctx.fillRect(x, y, w, CAP_H);
    ctx.strokeStyle = now ? COLOR_CAP_NOW_BG : done ? COLOR_CAP_DONE_EDGE : COLOR_CAP_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, CAP_H - 1);
    drawText(ctx, capLabel(r, st), x + w / 2, y + CAP_H / 2, m, now ? COLOR_CAP_NOW_TEXT : COLOR_TEXT, "center", "middle");
    if (now && st.hold !== null) {
      ctx.fillStyle = COLOR_CAP_HOLD;
      ctx.fillRect(x, y + CAP_H, Math.round(w * st.hold), HOLD_BAR_H);
    }
    x += w + sepWidth(m);
  });
}

/** 実演の今の手を札の添字にする（待ちの手は札を持たないので数えない） */
function capState(ui: ManualUi, move: ManualMove): CapState {
  const demo = ui.demo;
  if (demo === null) return IDLE_CAPS;
  const cueIndex = demoCueIndex(demo);
  const cues = move.script.cues;
  if (cueIndex < 0) return IDLE_CAPS;
  const done = cues.slice(0, cueIndex).filter((c) => cueToken(c) !== null).length;
  const cur = cues[cueIndex];
  const now = cur !== undefined && cueToken(cur) !== null ? done : -1;
  return { now, done, hold: demoHoldRatio(demo) };
}

// ---------------------------------------------------------------------------
// 実演の窓と技の詳しい欄
// ---------------------------------------------------------------------------

/** 下ごしらえ（戦意を溜める連撃など）の間に窓へ出す語 */
const PRELUDE_LABEL = "下ごしらえ";

function drawPreview(ctx: CanvasRenderingContext2D, renderer: Renderer, ui: ManualUi): void {
  const p = MANUAL_LAYOUT.preview;
  const demo = ui.demo;
  if (demo !== null) {
    renderer.renderDemo(demo.state, p, ui.arena.center, MANUAL.previewZoom);
    // 戦意のゲージ（本編の HUD と同じ絵）を窓の左下に
    drawMoraleHud(ctx, demo.state, p.x + PAD, p.y + p.h - textLineHeight(TEXT.SMALL) - PAD);
    if (demoCueIndex(demo) < 0) drawText(ctx, PRELUDE_LABEL, p.x + p.w - PAD, p.y + PAD, TEXT.SMALL, COLOR_INFO, "right", "top");
  }
  ctx.strokeStyle = COLOR_FRAME;
  ctx.lineWidth = 1;
  ctx.strokeRect(p.x - 0.5, p.y - 0.5, p.w + 1, p.h + 1);
}

function drawDetail(ctx: CanvasRenderingContext2D, ui: ManualUi, binds: Keybinds | undefined): void {
  const d = MANUAL_LAYOUT.detail;
  const move = selectedMove(ui);
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  if (move === undefined) return;
  const m = TEXT.SMALL;
  const lineH = textLineHeight(m);
  const x = d.x + PAD;
  const w = d.w - PAD * 2;
  let y = d.y + PAD;
  drawText(ctx, truncateText(MANUAL_GROUP_LABEL[move.group], w, m), d.x + d.w - PAD, y, m, COLOR_DIM, "right", "top");
  drawText(ctx, truncateText(move.name, w - textWidth(MANUAL_GROUP_LABEL[move.group], m) - PAD, TEXT.BODY), x, y, TEXT.BODY, COLOR_TITLE, "left", "top");
  y += Math.max(MANUAL_LAYOUT.minRowGap, textLineHeight(TEXT.BODY)) + 2;
  drawCaps(ctx, capRuns(moveTokens(move)), x, y, m, w, capState(ui, move));
  y += CAP_H + HOLD_BAR_H + PAD;
  y = drawChips(ctx, move.traits, x, y, w, m);
  const legendLines = legendText(binds).map((t) => truncateText(t, w, m));
  const bottom = d.y + d.h - PAD - legendLines.length * lineH;
  for (const line of wrapText(move.desc, w, m)) {
    if (y + lineH > bottom) break;
    drawText(ctx, line, x, y, m, COLOR_TEXT, "left", "top");
    y += lineH;
  }
  legendLines.forEach((line, i) => drawText(ctx, line, x, bottom + i * lineH, m, COLOR_DIM, "left", "top"));
}

/** 性質の札を折り返して並べる。描き終えた下端の y を返す */
function drawChips(ctx: CanvasRenderingContext2D, traits: readonly string[], x0: number, y0: number, w: number, m: number): number {
  const lineH = textLineHeight(m);
  const chipH = lineH + 1;
  let x = x0;
  let y = y0;
  for (const t of traits) {
    const cw = Math.ceil(textWidth(t, m)) + CHIP_PAD_X * 2;
    if (x > x0 && x + cw > x0 + w) {
      x = x0;
      y += chipH + CHIP_GAP;
    }
    ctx.fillStyle = COLOR_CHIP_BG;
    ctx.fillRect(x, y, Math.min(cw, w), chipH);
    drawText(ctx, truncateText(t, w - CHIP_PAD_X * 2, m), x + CHIP_PAD_X, y + chipH / 2, m, COLOR_INFO, "left", "middle");
    x += cw + CHIP_GAP;
  }
  return traits.length > 0 ? y + chipH + PAD : y;
}

/** 札とキーの対応（キー設定どおり）。左右の行と、ダッシュ・奥義の行（ダッシュは主のキーだけ） */
function legendText(binds: Keybinds | undefined): string[] {
  const k = (a: Parameters<typeof keyLabel>[0], first = false): string => keyLabel(a, { binds, first });
  return [`左 ${k("attack")}　右 ${k("shoot")}`, `ダッシュ ${k("dash", true)}　奥義 ${k("special")}`];
}

function fillRect(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}
