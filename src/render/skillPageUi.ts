import { KEYWORD_DEFS, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, dwellLabel, slotLinks } from "../skills/data";
import { STONE_TUNING } from "../skills/tuning2";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey } from "../skills/types";
import { skillKeywords } from "../system/keywords";
import { runeMoveBlock } from "../system/skills";
import { stoneFaceColor } from "../ui/crestShape";
import { fid, focusedHit } from "../ui/menuFocus";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";
import { HAND_SORT_LABEL, RUNE_KIND_LABEL } from "../ui/handRunes";
import { HAND_SLOT } from "../ui/menuState";
import {
  COL_H,
  COL_W,
  COL_Y,
  HAND_AXES,
  HAND_CHIPS,
  HAND_LABEL,
  HAND_LABEL_TEXT,
  HOLE_H,
  HOLE_W,
  HOLE_Y,
  LIFTED_LABEL,
  LIFT_POS,
  STONE_DIAMOND,
  colX,
  columnRunes,
  handEntries,
  handOptionsOf,
  handRect,
  holeX,
  stoneDiamondPos,
} from "../ui/skillPage";
import { MENU_INK, blinkOn, box, dashBox, diamond, drawFocusBrackets, drawGlyphDisc, menuText, noteMarks, px } from "./crestDraw";

/**
 * スキルの頁の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W5、E-impl.md 4-3 E5）。state と ui を読むだけ。
 * 石 4 を列に並べ、顔の色 = 石の最初の系統・名前・丸印 3 つ・符の穴（リンクの本数）を描く。
 * 持ち上げ中の符は列の穴から消し、手持ちの欄の右に浮かせる（焦点の上に重ねると穴の字が読めなくなるため）。付けられる列は金の破線、
 * 付けられない列は全体を沈める。下の「手持ち」は札（並び・種類・系統・付けられる物だけ）と、同じ符を束ねた符の格子（右上に ×枚数）
 */

type SkillsView = ViewOf<"skills">;

const GEM_HIGHLIGHT = 2;
const NAME_Y = 56;
const KEYWORD_DISC = 12;
const KEYWORD_PITCH = 16;
const KEYWORD_Y = 76;
const KEYWORDS_MAX = 3;
/** 宿り符の印「宿 連鎖」の y（穴の下端 120 と列の下端 134 の間） */
const DWELL_Y = 123;
const EMPTY_NAME = "空き";
const LIFT_LABEL_RIGHT = 470;
const LIFT_LABEL_Y = 139;
/** 付けられない列を沈める濃さ（紙の色を重ねる） */
const SINK_ALPHA = 0.6;
const HAND_LABEL_DY = 2;
const HAND_EMPTY = "手持ちの符はありません";
const HAND_NO_MATCH = "この絞り込みの符はありません";
const CHIP_LABEL_DY = 1;
const CHIP_DISC = 10;
const KIND_OFF = "種類";
const KEYWORD_OFF = "系統";
const FIT_OFF = "全部";
const FIT_ON = "付けられる";
/** 枚数の札（右上）。×と 1 桁なら 13、2 桁なら 17 */
const COUNT_W = 13;
const COUNT_W_WIDE = 17;
const COUNT_H = 9;
const COUNT_OVERHANG = 2;
/** 手持ちの符の矩形の右端（x からの距離）と、「ありません」の行の位置 */
const HAND_RIGHT_EDGE = 18;
const HAND_EMPTY_DY = 20;
const LIFT_BOB_PERIOD = 0.3;
const RUNE_BAR_INSET = 2;
const RUNE_BAR_H = 3;
const RUNE_NAME_DY = 9;

/** 符 1 枚（穴の矩形に合わせる）。名前の頭 1 字と、種類の色の帯 */
function drawRune(ctx: CanvasRenderingContext2D, key: ModifierKey, x: number, y: number, w: number, ring: string, text: string): void {
  const def = MODIFIERS[key];
  px(ctx, x, y, w, HOLE_H, MENU_INK.card2);
  box(ctx, x, y, w, HOLE_H, ring);
  px(ctx, x + RUNE_BAR_INSET, y + RUNE_BAR_INSET, w - RUNE_BAR_INSET * 2, RUNE_BAR_H, def.color);
  menuText(ctx, def.name.slice(0, 1), x + w / 2, y + RUNE_NAME_DY, { size: "SMALL", color: text, role: "ornament", align: "center" });
  noteMarks();
}

function drawStone(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, i: number, focused: boolean): void {
  const x = colX(i);
  const stone = stoneInSlot(state.skills.profile, i);
  const d = stoneDiamondPos(i);
  diamond(ctx, d.x, d.y, STONE_DIAMOND, focused ? MENU_INK.focus : MENU_INK.sub, stone ? MENU_INK.gem : MENU_INK.paper);
  if (stone) {
    px(ctx, d.x + 8, d.y + 8, 8, 8, stoneFaceColor(stone.skillKey));
    px(ctx, d.x + 10, d.y + 10, GEM_HIGHLIGHT, GEM_HIGHLIGHT, MENU_INK.focus);
  }
  noteMarks();
  const def = stone ? SKILL_DEFS[stone.skillKey] : null;
  menuText(ctx, def ? def.name : EMPTY_NAME, x + COL_W / 2, NAME_Y, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.text,
    role: "ornament",
    align: "center",
    maxW: COL_W - 4,
  });
  if (!def || !stone) return;
  // 宿り符は穴を使わないので、穴の下に石の物として出す
  const dwell = dwellLabel(stone);
  if (dwell !== null) menuText(ctx, dwell, x + COL_W / 2, DWELL_Y, { size: "SMALL", color: STONE_TUNING.dwellColor, role: "ornament", align: "center", maxW: COL_W - 4 });
  const keywords = profileKeywords(skillKeywords(def)).slice(0, KEYWORDS_MAX);
  const x0 = x + COL_W / 2 - ((keywords.length - 1) * KEYWORD_PITCH) / 2;
  keywords.forEach((k, j) => drawGlyphDisc(ctx, k, x0 + j * KEYWORD_PITCH, KEYWORD_Y, KEYWORD_DISC, KEYWORD_DEFS[k].color));
}

/** 列の枠。持ち上げ中は置ける列を金の破線に、置けない列は沈める */
function drawColumnFrame(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SkillsView>, i: number): void {
  const r = { x: colX(i), y: COL_Y, w: COL_W, h: COL_H };
  px(ctx, r.x, r.y, r.w, r.h, MENU_INK.card);
  const lift = view.lift;
  if (lift === null) {
    box(ctx, r.x, r.y, r.w, r.h, MENU_INK.rule);
    return;
  }
  const placeable = i !== lift.slot && runeMoveBlock(state.skills, i, lift.key) === null;
  if (placeable) dashBox(ctx, r.x, r.y, r.w, r.h, MENU_INK.gold);
  else box(ctx, r.x, r.y, r.w, r.h, i === lift.slot ? MENU_INK.sub : MENU_INK.dim);
}

/** 持ち上げ中、付けられない列を紙の色で沈める（元の列は沈めない。置き直しをやめる先だから） */
function sinkColumn(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SkillsView>, i: number): void {
  const lift = view.lift;
  if (lift === null || i === lift.slot) return;
  if (runeMoveBlock(state.skills, i, lift.key) === null) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = SINK_ALPHA;
  px(ctx, colX(i), COL_Y, COL_W, COL_H, MENU_INK.paper);
  ctx.globalAlpha = prev;
}

/** 穴（空きは破線）と効いている符 */
function drawHoles(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SkillsView>, i: number): void {
  const placed = columnRunes(state, i);
  const holeCount = slotLinks(i);
  const used = new Set<number>();
  for (const p of placed) {
    const lifted = view.lift !== null && view.lift.slot === p.slot && view.lift.key === p.key;
    for (let k = 0; k < p.cost; k++) used.add(p.pos + k);
    if (lifted) {
      dashBox(ctx, p.rect.x, p.rect.y, p.rect.w, p.rect.h, MENU_INK.sub);
      continue;
    }
    const focused = view.focus === fid.rune(i, p.key);
    drawRune(ctx, p.key, p.rect.x, p.rect.y, p.rect.w, focused ? MENU_INK.focus : MODIFIERS[p.key].color, p.run ? MENU_INK.text : MENU_INK.sub);
  }
  for (let j = 0; j < holeCount; j++) {
    if (used.has(j)) continue;
    dashBox(ctx, holeX(i, j), HOLE_Y, HOLE_W, HOLE_H, MENU_INK.dim);
  }
}

/** 手持ちの札 1 つ（絞っているときは金の枠。系統は丸印、ほかは今の値の名前） */
function drawHandChip(ctx: CanvasRenderingContext2D, ui: Readonly<InventoryUi>, view: Readonly<SkillsView>, axis: (typeof HAND_AXES)[number]): void {
  const options = handOptionsOf(ui, view);
  const r = HAND_CHIPS[axis];
  const on = axis === "kind" ? options.kind !== null : axis === "keyword" ? options.keyword !== null : axis === "fit" ? options.fitOnly : false;
  const focused = view.focus === fid.handOpt(axis);
  px(ctx, r.x, r.y, r.w, r.h, on ? MENU_INK.card2 : MENU_INK.paper);
  box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : on ? MENU_INK.gold : MENU_INK.rule);
  if (axis === "keyword" && options.keyword !== null) {
    drawGlyphDisc(ctx, options.keyword, r.x + r.w / 2, r.y + r.h / 2, CHIP_DISC, KEYWORD_DEFS[options.keyword].color);
    return;
  }
  const text =
    axis === "sort" ? HAND_SORT_LABEL[options.sort] : axis === "kind" ? (options.kind === null ? KIND_OFF : RUNE_KIND_LABEL[options.kind]) : axis === "keyword" ? KEYWORD_OFF : options.fitOnly ? FIT_ON : FIT_OFF;
  menuText(ctx, text, r.x + r.w / 2, r.y + CHIP_LABEL_DY, { size: "SMALL", color: on || focused ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "center" });
}

/** 符の右上の枚数（2 枚以上のときだけ）。符の上に重ねて読めるよう地の色を敷く */
function drawCount(ctx: CanvasRenderingContext2D, count: number, x: number, y: number): void {
  if (count < 2) return;
  const text = `×${count}`;
  const w = text.length <= 2 ? COUNT_W : COUNT_W_WIDE;
  const right = x + HAND_RIGHT_EDGE + COUNT_OVERHANG;
  px(ctx, right - w, y - COUNT_OVERHANG, w, COUNT_H, MENU_INK.paper);
  menuText(ctx, text, right, y - COUNT_OVERHANG, { size: "SMALL", color: MENU_INK.gold, role: "ornament", align: "right" });
}

function drawHand(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SkillsView>): void {
  menuText(ctx, HAND_LABEL_TEXT, HAND_LABEL.x, HAND_LABEL.y + HAND_LABEL_DY, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  for (const axis of HAND_AXES) drawHandChip(ctx, ui, view, axis);
  const entries = handEntries(state, ui, view);
  if (entries.length === 0) {
    const text = state.skills.hand.length === 0 ? HAND_EMPTY : HAND_NO_MATCH;
    menuText(ctx, text, HAND_LABEL.x, HAND_LABEL.y + HAND_EMPTY_DY, { size: "SMALL", color: MENU_INK.dim, role: "ornament" });
    return;
  }
  entries.forEach((g, i) => {
    const r = handRect(i);
    const lifted = view.lift !== null && view.lift.slot === HAND_SLOT && view.lift.key === g.key;
    const left = lifted ? g.count - 1 : g.count;
    if (left <= 0) {
      dashBox(ctx, r.x, r.y, r.w, r.h, MENU_INK.sub);
      return;
    }
    const focused = view.focus === fid.hand(g.key);
    drawRune(ctx, g.key, r.x, r.y, r.w, focused ? MENU_INK.focus : MODIFIERS[g.key].color, MENU_INK.text);
    drawCount(ctx, left, r.x, r.y);
  });
}

/** 持ち上げ中の符を右下に浮かせる（ui.time で 2 コマ上下する。state.rng は使わない） */
function drawLifted(ctx: CanvasRenderingContext2D, ui: Readonly<InventoryUi>, key: ModifierKey): void {
  const y = LIFT_POS.y - (blinkOn(ui.time, LIFT_BOB_PERIOD) ? 0 : 1);
  menuText(ctx, LIFTED_LABEL, LIFT_LABEL_RIGHT, LIFT_LABEL_Y, { size: "SMALL", color: MENU_INK.gold, role: "ornament", align: "right" });
  drawRune(ctx, key, LIFT_POS.x, y, HOLE_W, MENU_INK.focus, MENU_INK.focus);
}

export function drawSkillPage(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  ui: Readonly<InventoryUi>,
  view: Readonly<SkillsView>,
  hits: readonly MenuHit[],
): void {
  for (let i = 0; i < SKILL.slots; i++) {
    drawColumnFrame(ctx, state, view, i);
    drawStone(ctx, state, i, view.focus === fid.stone(i));
    drawHoles(ctx, state, view, i);
    sinkColumn(ctx, state, view, i);
  }
  drawHand(ctx, state, ui, view);
  if (view.lift !== null) drawLifted(ctx, ui, view.lift.key);
  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
