import { type ActionName, keyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { REFORGES, type ReforgeDef } from "../data/reforges";
import { REFORGE } from "../data/tuning";
import { FORMS, type FormKey, formOfKey } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { BOON_CARD, boonCardRect } from "../system/boons";
import { TEXT, drawText, textLineHeight, truncateText, wrapText } from "./pixelText";

/**
 * 改鋳の 3 択（system/reforge.ts の reforgeChoice）。札の並び・大きさ・当たり判定は祝福の 3 択（render/boonUi.ts）と同じ
 * boonCardRect を使い、札の頭に型の名を見出しとして大きく出す（どの型の動きが変わるかを先に読ませる）。
 * state を読むだけ
 */

const COLOR_DIM_BG = "rgba(0,0,0,0.7)";
const COLOR_CARD = "rgba(16,16,28,0.95)";
const COLOR_CARD_HOVER = "rgba(32,32,52,0.98)";
const COLOR_TEXT = "#e0e0e0";
const COLOR_SUB = "#a0a0a0";
/** 装備中の型に合わない札（持ち替えるまで効かない）の枠と見出しの色 */
const COLOR_OTHER_FORM = "#8a8070";

const TITLE = "改鋳を選べ";
const HINT = "この探索のみ有効";
const OWN_FORM_NOTE = "装備中の型";
const OTHER_FORM_NOTE = "持ち替えると効く";

const TITLE_Y = 44;
const HINT_Y = 52;
const CARD_PAD = 6;
const HEADING_Y = 26;
const NAME_Y = 42;
const NOTE_Y = 52;
const DESC_Y = 64;
const LINE_H = 9;
const KEY_Y_FROM_BOTTOM = 8;
/** 札ごとの選ぶキー（system/reforge.ts の selectedIndex と同じ並び: スキル 1・スキル 2・攻撃） */
const CARD_KEY_ACTIONS: readonly ActionName[] = ["skill1", "skill2", "attack"];

function equippedForm(state: GameState): FormKey {
  return formOfKey((MOVESETS[state.stats.moveset] ?? MOVESETS.sword).key).key;
}

export function drawReforgeChoice(ctx: CanvasRenderingContext2D, state: GameState): void {
  const c = state.reforgeChoice;
  if (!c) return;
  ctx.fillStyle = COLOR_DIM_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, `地下 ${state.depth} 階 - ${TITLE}`, VIEW_W / 2, TITLE_Y, TEXT.TITLE, REFORGE.textColor, "center");
  drawText(ctx, HINT, VIEW_W / 2, HINT_Y, TEXT.SMALL, COLOR_SUB, "center");
  const form = equippedForm(state);
  c.options.forEach((key, i) => {
    const def = REFORGES[key];
    drawCard(ctx, def, i, c.options.length, i === c.hover, def.form === form);
  });
}

function drawCard(ctx: CanvasRenderingContext2D, def: ReforgeDef, index: number, count: number, hover: boolean, own: boolean): void {
  const r = boonCardRect(index, count);
  const y = hover ? r.y - BOON_CARD.hoverLift : r.y;
  const color = own ? REFORGE.textColor : COLOR_OTHER_FORM;
  const cx = r.x + r.w / 2;
  const maxWidth = r.w - CARD_PAD * 2;

  ctx.fillStyle = hover ? COLOR_CARD_HOVER : COLOR_CARD;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = hover ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, y + 0.5, r.w - 1, r.h - 1);
  ctx.lineWidth = 1;

  // 見出し: 変わる型の名
  drawText(ctx, FORMS[def.form].name, cx, y + HEADING_Y, TEXT.BIG, color, "center");
  drawText(ctx, truncateText(def.name, maxWidth, TEXT.SMALL), cx, y + NAME_Y, TEXT.SMALL, color, "center");
  drawText(ctx, own ? OWN_FORM_NOTE : OTHER_FORM_NOTE, cx, y + NOTE_Y, TEXT.SMALL, COLOR_SUB, "center");

  const lineH = Math.max(LINE_H, textLineHeight(TEXT.SMALL));
  const bottom = y + r.h - KEY_Y_FROM_BOTTOM;
  const lines = wrapText(def.desc, maxWidth, TEXT.SMALL);
  lines.forEach((line, i) => {
    const ly = y + DESC_Y + i * lineH;
    // 説明がキーの行に重なるなら打ち切る（札からはみ出さない）
    if (ly + lineH > bottom) return;
    drawText(ctx, line, cx, ly, TEXT.SMALL, COLOR_TEXT, "center");
  });

  const action = CARD_KEY_ACTIONS[index];
  if (action !== undefined) drawText(ctx, keyLabel(action, { keyboardOnly: true }), r.x + CARD_PAD, bottom, TEXT.SMALL, COLOR_SUB);
}
