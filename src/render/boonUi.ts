import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOON } from "../data/tuning";
import { BOON_CARD, type BoonDef, type BoonTag, boonCardRect, boonDef, equipmentTags } from "../system/boons";
import { uiFont, wrapByWidth } from "./font";

/**
 * 祝福の描画。選択オーバーレイ（3 枚のカード）と、右下の取得済みアイコン列（ホバーで名前）。
 * 当たり判定は boons.ts の boonCardRect と共有する。
 */

const FONT_TITLE = uiFont(12);
const FONT_NAME = uiFont(8);
const FONT_BODY = uiFont(8, "normal");
const FONT_ICON_BIG = uiFont(20);
const FONT_ICON = uiFont(8);

const COLOR_DIM_BG = "rgba(0,0,0,0.7)";
const COLOR_CARD = "rgba(16,16,28,0.95)";
const COLOR_CARD_HOVER = "rgba(32,32,52,0.98)";
const COLOR_TEXT = "#e0e0e0";
const COLOR_SUB = "#a0a0a0";
const COLOR_TAG_MATCH = "#ffd75f";
const COLOR_TITLE = "#ffd75f";
const COLOR_ICON_BG = "rgba(12,12,18,0.85)";
const COLOR_USED = "#505050";

const TITLE_Y = 44;
const HINT_Y = 52;
const CARD_PAD = 6;
const ICON_Y = 26;
const NAME_Y = 42;
const RARITY_Y = 52;
const DESC_Y = 64;
const LINE_H = 9;
const TAGS_BOTTOM = 8;
const KEY_HINTS = ["1 / C", "2 / V", "E"] as const;
const KEY_Y_FROM_BOTTOM = 18;

const HUD_ICON = 10;
const HUD_GAP = 2;
const HUD_RIGHT = 4;
const HUD_BOTTOM = 4;
const HUD_ICON_BASELINE = 8;
const TIP_PAD = 3;
const TIP_H = 22;
const TIP_GAP = 3;

function boonColor(def: BoonDef): string {
  return def.cursed ? BOON.cursedColor : BOON.rarityColor[def.rarity];
}

export function drawBoonChoice(ctx: CanvasRenderingContext2D, state: GameState): void {
  const c = state.boonChoice;
  if (!c) return;
  ctx.fillStyle = COLOR_DIM_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = "center";
  ctx.font = FONT_TITLE;
  ctx.fillStyle = COLOR_TITLE;
  ctx.fillText(`DEPTH ${state.depth} - CHOOSE A BOON`, VIEW_W / 2, TITLE_Y);
  ctx.font = FONT_BODY;
  ctx.fillStyle = COLOR_SUB;
  ctx.fillText("this run only", VIEW_W / 2, HINT_Y);

  const tags = equipmentTags(state.stats);
  c.options.forEach((key, i) => {
    drawCard(ctx, boonDef(key), i, c.options.length, i === c.hover, tags);
  });
  ctx.textAlign = "left";
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  def: BoonDef,
  index: number,
  count: number,
  hover: boolean,
  tags: ReadonlySet<BoonTag>,
): void {
  const r = boonCardRect(index, count);
  const y = hover ? r.y - BOON_CARD.hoverLift : r.y;
  const color = boonColor(def);
  const cx = r.x + r.w / 2;

  ctx.fillStyle = hover ? COLOR_CARD_HOVER : COLOR_CARD;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = hover ? 2 : 1;
  ctx.strokeRect(r.x + 0.5, y + 0.5, r.w - 1, r.h - 1);
  ctx.lineWidth = 1;

  ctx.textAlign = "center";
  ctx.font = FONT_ICON_BIG;
  ctx.fillStyle = color;
  ctx.fillText(def.icon, cx, y + ICON_Y);
  ctx.font = FONT_NAME;
  ctx.fillText(def.name, cx, y + NAME_Y);
  ctx.font = FONT_BODY;
  ctx.fillText(def.cursed ? `${def.rarity} / CURSED` : def.rarity, cx, y + RARITY_Y);

  ctx.fillStyle = COLOR_TEXT;
  const maxWidth = r.w - CARD_PAD * 2;
  wrapByWidth(def.desc, maxWidth, (t) => ctx.measureText(t).width).forEach((line, i) => ctx.fillText(line, cx, y + DESC_Y + i * LINE_H));

  // 装備タグと一致するタグは強調（なぜ出やすいかが分かる）
  const tagText = def.tags.map((t) => (tags.has(t) ? `[${t}]` : t)).join(" ");
  ctx.fillStyle = def.tags.some((t) => tags.has(t)) ? COLOR_TAG_MATCH : COLOR_SUB;
  ctx.fillText(tagText, cx, y + r.h - KEY_Y_FROM_BOTTOM - TAGS_BOTTOM);
  ctx.fillStyle = COLOR_SUB;
  ctx.fillText(KEY_HINTS[index] ?? "", cx, y + r.h - TAGS_BOTTOM);
}

/** 右下のアイコン列の index 番目（右から並べる） */
function hudIconPos(index: number): Vec {
  return {
    x: VIEW_W - HUD_RIGHT - HUD_ICON - index * (HUD_ICON + HUD_GAP),
    y: VIEW_H - HUD_BOTTOM - HUD_ICON,
  };
}

/** 取得済み祝福のアイコン列。aimScreen がアイコン上なら名前と説明を出す */
export function drawBoonHud(ctx: CanvasRenderingContext2D, state: GameState, aimScreen: Vec | null): void {
  if (state.boons.length === 0) return;
  let hovered: BoonDef | null = null;
  ctx.textAlign = "center";
  ctx.font = FONT_ICON;
  state.boons.forEach((key, i) => {
    const def = boonDef(key);
    const pos = hudIconPos(i);
    const used = key === "secondWind" && state.boonRun.reviveUsed;
    const color = used ? COLOR_USED : boonColor(def);
    ctx.fillStyle = COLOR_ICON_BG;
    ctx.fillRect(pos.x, pos.y, HUD_ICON, HUD_ICON);
    ctx.strokeStyle = color;
    ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, HUD_ICON - 1, HUD_ICON - 1);
    ctx.fillStyle = color;
    ctx.fillText(def.icon, pos.x + HUD_ICON / 2, pos.y + HUD_ICON_BASELINE);
    if (!aimScreen) return;
    const inside =
      aimScreen.x >= pos.x && aimScreen.x < pos.x + HUD_ICON && aimScreen.y >= pos.y && aimScreen.y < pos.y + HUD_ICON;
    if (inside) hovered = def;
  });
  if (hovered) drawTooltip(ctx, hovered);
  ctx.textAlign = "left";
}

function drawTooltip(ctx: CanvasRenderingContext2D, def: BoonDef): void {
  ctx.font = FONT_NAME;
  const nameW = ctx.measureText(def.name).width;
  ctx.font = FONT_BODY;
  const descW = ctx.measureText(def.desc).width;
  const width = Math.ceil(Math.max(nameW, descW)) + TIP_PAD * 2;
  const x = Math.max(0, VIEW_W - HUD_RIGHT - width);
  const y = VIEW_H - HUD_BOTTOM - HUD_ICON - TIP_GAP - TIP_H;
  ctx.fillStyle = COLOR_ICON_BG;
  ctx.fillRect(x, y, width, TIP_H);
  ctx.strokeStyle = boonColor(def);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, TIP_H - 1);
  ctx.textAlign = "left";
  ctx.font = FONT_NAME;
  ctx.fillStyle = boonColor(def);
  ctx.fillText(def.name, x + TIP_PAD, y + LINE_H);
  ctx.font = FONT_BODY;
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText(def.desc, x + TIP_PAD, y + LINE_H * 2);
}
