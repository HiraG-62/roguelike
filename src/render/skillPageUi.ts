import { KEYWORD_DEFS, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, slotLinks } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey } from "../skills/types";
import { skillKeywords } from "../system/keywords";
import { runeMoveBlock } from "../system/skills";
import { stoneFaceColor } from "../ui/crestShape";
import { fid, focusedHit } from "../ui/menuFocus";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";
import {
  COL_H,
  COL_W,
  COL_Y,
  HOLE_H,
  HOLE_W,
  HOLE_Y,
  LIFT_POS,
  LOOSE_LABEL_X,
  LOOSE_Y,
  STONE_DIAMOND,
  colX,
  columnRunes,
  holeX,
  looseRunes,
  stoneDiamondPos,
} from "../ui/skillPage";
import { MENU_INK, blinkOn, box, dashBox, diamond, drawFocusBrackets, drawGlyphDisc, menuText, noteMarks, px } from "./crestDraw";

/**
 * スキルの頁の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W5、E-impl.md 4-3 E5）。state と ui を読むだけ。
 * 石 4 を列に並べ、顔の色 = 石の最初の系統・名前・丸印 3 つ・符の穴（リンクの本数）を描く。
 * 持ち上げ中の符は列の穴から消し、右下に浮かせる（焦点の上に重ねると穴の字が読めなくなるため）。置ける列は金の破線
 */

type SkillsView = ViewOf<"skills">;

const GEM_HIGHLIGHT = 2;
const NAME_Y = 56;
const KEYWORD_DISC = 12;
const KEYWORD_PITCH = 16;
const KEYWORD_Y = 76;
const KEYWORDS_MAX = 3;
const EMPTY_NAME = "空き";
const LOOSE_LABEL = "効かない符";
const LIFTED_LABEL = "持ち上げ中";
const LIFT_LABEL_RIGHT = 446;
const LIFT_LABEL_Y = 149;
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
  if (!def) return;
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

function drawLoose(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SkillsView>): void {
  const loose = looseRunes(state);
  menuText(ctx, LOOSE_LABEL, LOOSE_LABEL_X, LOOSE_Y + 6, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  for (const p of loose) {
    if (view.lift !== null && view.lift.slot === p.slot && view.lift.key === p.key) {
      dashBox(ctx, p.rect.x, p.rect.y, p.rect.w, p.rect.h, MENU_INK.sub);
      continue;
    }
    const focused = view.focus === fid.loose(p.slot, p.key);
    drawRune(ctx, p.key, p.rect.x, p.rect.y, p.rect.w, focused ? MENU_INK.focus : MODIFIERS[p.key].color, MENU_INK.sub);
  }
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
  }
  drawLoose(ctx, state, view);
  if (view.lift !== null) drawLifted(ctx, ui, view.lift.key);
  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
