import { KEYWORD_DEFS, type Keyword, type KeywordProfile } from "../core/keywords";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOON } from "../data/tuning";
import {
  BOON_CARD,
  type BoonDef,
  type BoonTag,
  LINEAGE_LABEL,
  boonCardRect,
  boonCurseRect,
  boonDef,
  buildTags,
  canTakeCurse,
} from "../system/boons";
import { linkHintText } from "../meta/linkHint";
import { type KeywordAffinity, affinity, buildProfile } from "../system/keywords";
import { TEXT, drawText, textLineHeight, textWidth, truncateText, wrapText } from "./pixelText";

/**
 * 祝福の描画。選択オーバーレイ（3 枚 / 呪いを受けた後は 4 枚のカードと呪いの札）と、右下の取得済みアイコン列（ホバーで名前）。
 * 当たり判定は boons.ts の boonCardRect / boonCurseRect と共有する。
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
const COLOR_CURSE_BG = "rgba(48,12,16,0.95)";
const COLOR_CURSE_BG_HOVER = "rgba(80,20,24,0.98)";
/** 系譜・結びの注記の色 */
const COLOR_LINEAGE = "#ffb060";
const COLOR_DUO = "#80e0c0";

const TITLE_Y = 44;
const HINT_Y = 52;
const CARD_PAD = 6;
const ICON_Y = 26;
const NAME_Y = 42;
const RARITY_Y = 52;
const DESC_Y = 64;
const LINE_H = 9;
const TAGS_BOTTOM = 8;
const KEY_HINTS = ["1 / C", "2 / V", "E", "4 / Z"] as const;
const KEY_Y_FROM_BOTTOM = 18;
const CURSE_KEY = "3 / X";
/** 呪いの札の文字のベースライン（札の上端から） */
const CURSE_TEXT_Y = 10;
/** 語の行（カード下部、タグ行の上）。噛み合わない語は暗くする */
const WORD_ROW_GAP = 2;
const COLOR_WORD_IDLE = "#5a5a66";
const WORD_HEAD_PRODUCES = "出";
const WORD_HEAD_CONSUMES = "食";
const WORD_GROUP_GAP = 5;
const WORD_HEAD_GAP = 2;
/** 祝福カードの印（docs/ideas/synergy-web.md 4-c）。優劣ではなく「今のビルドとどう噛むか」の種類 */
export const BOON_MARKS = ["fill", "feed", "fresh"] as const;
export type BoonMark = (typeof BOON_MARKS)[number];
export const BOON_MARK_LABEL: Readonly<Record<BoonMark, string>> = {
  fill: "穴を埋める",
  feed: "流れを太くする",
  fresh: "新しい流れ",
};
const BOON_MARK_COLOR: Readonly<Record<BoonMark, string>> = {
  fill: "#80e0ff",
  feed: "#ffb060",
  fresh: "#a0a0a0",
};
/** 手がかり枠（5-d）の行。呪いの札の下 */
const HINT_GAP_BELOW_CURSE = 12;
const COLOR_HINT = "#a0c0e0";
/** 系譜の段数をたどる上限（定義の循環で止まらないように） */
const LINEAGE_MAX_DEPTH = 8;

const HUD_ICON = 10;
const HUD_GAP = 2;
const HUD_RIGHT = 4;
const HUD_BOTTOM = 4;
const HUD_ICON_BASELINE = 8;
const TIP_PAD = 3;
const TIP_H = 22;
const TIP_GAP = 3;
/** アイコン列の 1 段の数（祝福が増えても画面の左端まで伸ばさない） */
const HUD_PER_ROW = 16;
/** ツールチップの説明の折り返し幅 */
const TIP_MAX_W = 220;

function boonColor(def: BoonDef): string {
  return def.cursed ? BOON.cursedColor : BOON.rarityColor[def.rarity];
}

/** 表示専用。system/boons.ts の BoonRarity は英語のキーのまま（ロジック側は別エージェントが管轄） */
const BOON_RARITY_LABEL: Readonly<Record<BoonDef["rarity"], string>> = {
  common: "通常",
  rare: "希少",
  epic: "極稀",
};

/** 系譜の何段目か（1 始まり） */
function lineageStage(def: BoonDef): number {
  let stage = 1;
  let prev = def.after;
  while (prev && stage < LINEAGE_MAX_DEPTH) {
    stage += 1;
    prev = boonDef(prev).after;
  }
  return stage;
}

/**
 * カードの印。飢え（食うのに誰も出さない語）を出すなら「穴を埋める」、余り（出すのに誰も食わない語）を食うなら
 * 「流れを太くする」、どちらでもなければ「新しい流れ」。両方なら穴を先に見せる（ビルドの穴の方が次の目的になるので）
 */
export function boonMark(aff: Readonly<KeywordAffinity>): BoonMark {
  if (aff.fills.length > 0) return "fill";
  if (aff.feeds.length > 0) return "feed";
  return "fresh";
}

/** カードの 3 行目（希少度・呪い・系譜・結び） */
function cardSubtitle(def: BoonDef): { text: string; color: string | null } {
  const rarity = BOON_RARITY_LABEL[def.rarity];
  if (def.cursed) return { text: `${rarity} ・ 呪い付き`, color: null };
  if (def.lineage) return { text: `${rarity} ・ ${LINEAGE_LABEL[def.lineage]} ${lineageStage(def)}段`, color: COLOR_LINEAGE };
  if (def.duo) return { text: `${rarity} ・ 結び`, color: COLOR_DUO };
  return { text: rarity, color: null };
}

export function drawBoonChoice(ctx: CanvasRenderingContext2D, state: GameState): void {
  const c = state.boonChoice;
  if (!c) return;
  ctx.fillStyle = COLOR_DIM_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, `地下 ${state.depth} 階 - 祝福を選べ`, VIEW_W / 2, TITLE_Y, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, "この探索のみ有効", VIEW_W / 2, HINT_Y, TEXT.SMALL, COLOR_SUB, "center");

  // 装備・スキル石のタグと、取得済み祝福が出すタグのどちらかに一致すれば強調（なぜ出やすいかが分かる）
  const t = buildTags(state);
  const tags = new Set<BoonTag>([...t.owned, ...t.gives]);
  // 今のビルドの飢えを埋める / 余りを食う語を明るくする（並びは抽選順のまま。優劣は付けない）
  const build = buildProfile(state);
  c.options.forEach((key, i) => {
    const def = boonDef(key);
    drawCard(ctx, def, i, c.options.length, i === c.hover, tags, affinity(def.keywords, build));
  });
  drawCurseOffer(ctx, state);
  drawLinkHint(ctx, state);
}

/** 手がかり枠: 今のビルドで成立し得る未発見の連携を 1 件（祝福を選ぶ手がかりになるよう、選択画面では常に出す） */
function drawLinkHint(ctx: CanvasRenderingContext2D, state: GameState): void {
  const hint = state.codexRun.links.hint;
  if (hint === null) return;
  const text = linkHintText(hint);
  if (text === "") return;
  const r = boonCurseRect();
  const line = truncateText(`手がかり: ${text}`, VIEW_W - CARD_PAD * 2, TEXT.SMALL);
  drawText(ctx, line, VIEW_W / 2, r.y + r.h + HINT_GAP_BELOW_CURSE, TEXT.SMALL, COLOR_HINT, "center");
}

/** 「呪いを受けて 4 択」の札。受けた後は受けた呪いの名前を出す */
function drawCurseOffer(ctx: CanvasRenderingContext2D, state: GameState): void {
  const c = state.boonChoice;
  if (!c) return;
  const r = boonCurseRect();
  const cx = r.x + r.w / 2;
  if (c.curse) {
    const def = boonDef(c.curse);
    drawText(ctx, `呪いを受けた: ${def.name}`, cx, r.y + CURSE_TEXT_Y, TEXT.SMALL, BOON.cursedColor, "center");
    return;
  }
  if (!canTakeCurse(state)) return;
  ctx.fillStyle = c.curseHover ? COLOR_CURSE_BG_HOVER : COLOR_CURSE_BG;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = BOON.cursedColor;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const label = truncateText(`${CURSE_KEY}  呪いを1つ受けて4択にする`, r.w - CARD_PAD * 2, TEXT.SMALL);
  drawText(ctx, label, cx, r.y + CURSE_TEXT_Y, TEXT.SMALL, BOON.cursedColor, "center");
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  def: BoonDef,
  index: number,
  count: number,
  hover: boolean,
  tags: ReadonlySet<BoonTag>,
  aff: KeywordAffinity,
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

  const maxWidth = r.w - CARD_PAD * 2;
  drawText(ctx, def.icon, cx, y + ICON_Y, TEXT.BIG, color, "center");
  drawText(ctx, truncateText(def.name, maxWidth, TEXT.SMALL), cx, y + NAME_Y, TEXT.SMALL, color, "center");
  const sub = cardSubtitle(def);
  drawText(ctx, truncateText(sub.text, maxWidth, TEXT.SMALL), cx, y + RARITY_Y, TEXT.SMALL, sub.color ?? color, "center");

  const lineH = Math.max(LINE_H, textLineHeight(TEXT.SMALL));
  const tagY = y + r.h - KEY_Y_FROM_BOTTOM - TAGS_BOTTOM;
  const wordY = tagY - lineH - WORD_ROW_GAP;
  const descLines = wrapText(def.desc, maxWidth, TEXT.SMALL);
  descLines.forEach((line, i) => drawText(ctx, line, cx, y + DESC_Y + i * lineH, TEXT.SMALL, COLOR_TEXT, "center"));
  // 説明を優先する。説明の最終行が語の行に重なるなら語の行は出さない
  const descEnd = y + DESC_Y + (descLines.length - 1) * lineH;
  const hasWords = def.keywords.produces.length + def.keywords.consumes.length > 0;
  if (hasWords && descEnd + lineH <= wordY) drawWordRow(ctx, def.keywords, aff, cx, wordY, maxWidth);

  // 一致するタグは強調（なぜ出やすいかが分かる）
  const tagText = def.tags.map((t) => (tags.has(t) ? `[${t}]` : t)).join(" ");
  const tagColor = def.tags.some((t) => tags.has(t)) ? COLOR_TAG_MATCH : COLOR_SUB;
  drawText(ctx, truncateText(tagText, maxWidth, TEXT.SMALL), cx, tagY, TEXT.SMALL, tagColor, "center");
  // 最下段: 左にキー、右に印（並びは抽選順のまま。印は優劣ではなく噛み方の種類）
  const keyHint = KEY_HINTS[index] ?? "";
  const bottom = y + r.h - TAGS_BOTTOM;
  drawText(ctx, keyHint, r.x + CARD_PAD, bottom, TEXT.SMALL, COLOR_SUB);
  const mark = boonMark(aff);
  const markW = maxWidth - textWidth(keyHint, TEXT.SMALL) - WORD_GROUP_GAP;
  drawText(ctx, truncateText(BOON_MARK_LABEL[mark], markW, TEXT.SMALL), r.x + r.w - CARD_PAD, bottom, TEXT.SMALL, BOON_MARK_COLOR[mark], "right");
}

interface WordGroup {
  head: string;
  words: readonly Keyword[];
  lit: ReadonlySet<Keyword>;
}

/** 「出 炎雷  食 撃」を中央揃えで 1 行に。噛み合う語だけ語の色、他は暗い灰色 */
function drawWordRow(ctx: CanvasRenderingContext2D, kws: KeywordProfile, aff: KeywordAffinity, cx: number, y: number, maxWidth: number): void {
  const m = TEXT.SMALL;
  const groups: WordGroup[] = [
    { head: WORD_HEAD_PRODUCES, words: kws.produces, lit: new Set(aff.fills) },
    { head: WORD_HEAD_CONSUMES, words: kws.consumes, lit: new Set(aff.feeds) },
  ].filter((g) => g.words.length > 0);
  const groupWidth = (g: WordGroup): number =>
    textWidth(g.head, m) + WORD_HEAD_GAP + g.words.reduce((sum, k) => sum + textWidth(KEYWORD_DEFS[k].glyph, m), 0);
  const total = groups.reduce((sum, g) => sum + groupWidth(g), 0) + WORD_GROUP_GAP * (groups.length - 1);
  const right = cx + maxWidth / 2;
  let x = Math.round(cx - Math.min(total, maxWidth) / 2);
  for (const g of groups) {
    drawText(ctx, g.head, x, y, m, COLOR_SUB);
    x += textWidth(g.head, m) + WORD_HEAD_GAP;
    for (const k of g.words) {
      const glyph = KEYWORD_DEFS[k].glyph;
      const w = textWidth(glyph, m);
      // 幅を超える分は描かない（語が多い祝福でもカードからはみ出さない）
      if (x + w > right) return;
      drawText(ctx, glyph, x, y, m, g.lit.has(k) ? KEYWORD_DEFS[k].color : COLOR_WORD_IDLE);
      x += w;
    }
    x += WORD_GROUP_GAP;
  }
}

/** 右下のアイコン列の index 番目（右から並べ、HUD_PER_ROW 個で上の段へ折り返す） */
function hudIconPos(index: number): Vec {
  const col = index % HUD_PER_ROW;
  const row = Math.floor(index / HUD_PER_ROW);
  return {
    x: VIEW_W - HUD_RIGHT - HUD_ICON - col * (HUD_ICON + HUD_GAP),
    y: VIEW_H - HUD_BOTTOM - HUD_ICON - row * (HUD_ICON + HUD_GAP),
  };
}

/** アイコン列の最上段の上端（祝福が無ければ HUD の下端）。連鎖の表示をこの上に積む */
export function boonHudTop(count: number): number {
  if (count <= 0) return VIEW_H - HUD_BOTTOM;
  const rows = Math.ceil(count / HUD_PER_ROW);
  return VIEW_H - HUD_BOTTOM - HUD_ICON - (rows - 1) * (HUD_ICON + HUD_GAP);
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
  const rows = Math.ceil(state.boons.length / HUD_PER_ROW);
  if (hovered) drawTooltip(ctx, hovered, rows);
}

/** 名前 + 説明（TIP_MAX_W で折り返す）。アイコン列の上に出す */
function drawTooltip(ctx: CanvasRenderingContext2D, def: BoonDef, rows: number): void {
  const m = TEXT.SMALL;
  const lines = wrapText(def.desc, TIP_MAX_W, m);
  const widest = Math.max(textWidth(def.name, m), ...lines.map((l) => textWidth(l, m)));
  const width = Math.min(VIEW_W, Math.ceil(widest) + TIP_PAD * 2);
  const lineH = Math.max(LINE_H, textLineHeight(m));
  // 名前 1 行 + 説明の行数 + 下余白。行高がフォント倍率で伸びたら枠も伸ばす
  const tipH = Math.max(TIP_H, Math.ceil(lineH * (1 + lines.length) + TIP_PAD + 1));
  const x = Math.max(0, VIEW_W - HUD_RIGHT - width);
  const y = Math.max(0, VIEW_H - HUD_BOTTOM - rows * (HUD_ICON + HUD_GAP) - TIP_GAP - tipH);
  ctx.fillStyle = COLOR_ICON_BG;
  ctx.fillRect(x, y, width, tipH);
  ctx.strokeStyle = boonColor(def);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, tipH - 1);
  drawText(ctx, def.name, x + TIP_PAD, y + lineH, m, boonColor(def));
  lines.forEach((line, i) => drawText(ctx, line, x + TIP_PAD, y + lineH * (2 + i), m, COLOR_TEXT));
}
