import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOON } from "../data/tuning";
import { BOON_CARD, type BoonDef, type BoonTag, boonCardRect, boonDef, equipmentTags } from "../system/boons";
import { TEXT, drawText, textLineHeight, textWidth, wrapText } from "./pixelText";

/**
 * 祝福の描画。選択オーバーレイ（3 枚のカード）と、右下の取得済みアイコン列（ホバーで名前）。
 * 当たり判定は boons.ts の boonCardRect と共有する。
 */

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

/** 表示専用。system/boons.ts の BoonRarity は英語のキーのまま（ロジック側は別エージェントが管轄） */
const BOON_RARITY_LABEL: Readonly<Record<BoonDef["rarity"], string>> = {
  common: "通常",
  rare: "希少",
  epic: "極稀",
};

export function drawBoonChoice(ctx: CanvasRenderingContext2D, state: GameState): void {
  const c = state.boonChoice;
  if (!c) return;
  ctx.fillStyle = COLOR_DIM_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, `地下 ${state.depth} 階 - 祝福を選べ`, VIEW_W / 2, TITLE_Y, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, "このランのみ有効", VIEW_W / 2, HINT_Y, TEXT.SMALL, COLOR_SUB, "center");

  const tags = equipmentTags(state.stats);
  c.options.forEach((key, i) => {
    drawCard(ctx, boonDef(key), i, c.options.length, i === c.hover, tags);
  });
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

  drawText(ctx, def.icon, cx, y + ICON_Y, TEXT.BIG, color, "center");
  drawText(ctx, def.name, cx, y + NAME_Y, TEXT.SMALL, color, "center");
  const rarityLabel = BOON_RARITY_LABEL[def.rarity];
  drawText(ctx, def.cursed ? `${rarityLabel} ・ 呪い付き` : rarityLabel, cx, y + RARITY_Y, TEXT.SMALL, color, "center");

  const maxWidth = r.w - CARD_PAD * 2;
  const lineH = Math.max(LINE_H, textLineHeight(TEXT.SMALL));
  wrapText(def.desc, maxWidth, TEXT.SMALL).forEach((line, i) =>
    drawText(ctx, line, cx, y + DESC_Y + i * lineH, TEXT.SMALL, COLOR_TEXT, "center"),
  );

  // 装備タグと一致するタグは強調（なぜ出やすいかが分かる）
  const tagText = def.tags.map((t) => (tags.has(t) ? `[${t}]` : t)).join(" ");
  const tagColor = def.tags.some((t) => tags.has(t)) ? COLOR_TAG_MATCH : COLOR_SUB;
  drawText(ctx, tagText, cx, y + r.h - KEY_Y_FROM_BOTTOM - TAGS_BOTTOM, TEXT.SMALL, tagColor, "center");
  drawText(ctx, KEY_HINTS[index] ?? "", cx, y + r.h - TAGS_BOTTOM, TEXT.SMALL, COLOR_SUB, "center");
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
  state.boons.forEach((key, i) => {
    const def = boonDef(key);
    const pos = hudIconPos(i);
    const used = key === "secondWind" && state.boonRun.reviveUsed;
    const color = used ? COLOR_USED : boonColor(def);
    ctx.fillStyle = COLOR_ICON_BG;
    ctx.fillRect(pos.x, pos.y, HUD_ICON, HUD_ICON);
    ctx.strokeStyle = color;
    ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, HUD_ICON - 1, HUD_ICON - 1);
    drawText(ctx, def.icon, pos.x + HUD_ICON / 2, pos.y + HUD_ICON_BASELINE, TEXT.SMALL, color, "center");
    if (!aimScreen) return;
    const inside =
      aimScreen.x >= pos.x && aimScreen.x < pos.x + HUD_ICON && aimScreen.y >= pos.y && aimScreen.y < pos.y + HUD_ICON;
    if (inside) hovered = def;
  });
  if (hovered) drawTooltip(ctx, hovered);
}

function drawTooltip(ctx: CanvasRenderingContext2D, def: BoonDef): void {
  const m = TEXT.SMALL;
  const nameW = textWidth(def.name, m);
  const descW = textWidth(def.desc, m);
  const width = Math.min(VIEW_W, Math.ceil(Math.max(nameW, descW)) + TIP_PAD * 2);
  const lineH = Math.max(LINE_H, textLineHeight(m));
  // 2 行ぶん + 下余白。行高がフォント倍率で伸びたら枠も伸ばす
  const tipH = Math.max(TIP_H, Math.ceil(lineH * 2 + TIP_PAD + 1));
  const x = Math.max(0, VIEW_W - HUD_RIGHT - width);
  const y = VIEW_H - HUD_BOTTOM - HUD_ICON - TIP_GAP - tipH;
  ctx.fillStyle = COLOR_ICON_BG;
  ctx.fillRect(x, y, width, tipH);
  ctx.strokeStyle = boonColor(def);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, tipH - 1);
  drawText(ctx, def.name, x + TIP_PAD, y + lineH, m, boonColor(def));
  drawText(ctx, def.desc, x + TIP_PAD, y + lineH * 2, m, COLOR_TEXT);
}
