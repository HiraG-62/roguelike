import { actorArtLoading } from "./actorSprites";
import { KEYWORD_DEFS, type Keyword, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { RELIC_GLYPHS } from "../data/sprites/attire";
import { MENU_BUDGET } from "../data/tuning";
import { describeTrait } from "../loot/describe";
import type { AffixRoll, Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { STONE_TUNING } from "../skills/tuning2";
import { relicKeywords, skillKeywords } from "../system/keywords";
import { itemColor } from "../system/loot";
import {
  CANDIDATE_PAGE,
  CAND_CARD,
  FILTER_AXES,
  FILTER_CHIPS,
  MINI_GEM,
  MINI_PART,
  MINI_PARTS,
  RESOURCE_LABEL,
  SORT_CHIP,
  SORT_LABEL,
  SORT_ORDER,
  type CandidateEntry,
  type CandidateSubject,
  candidateEntries,
  entryFocusId,
  filterAvailable,
  focusedEntry,
  groupHead,
  isStoneWorn,
  tryOnForEntry,
  visibleEntries,
} from "../ui/candidates";
import { stoneFaceColor } from "../ui/crestShape";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, ViewOf } from "../ui/menuState";
import { isUnseen } from "../ui/seen";
import { type StatChanges, statChangesOf } from "../ui/statDiff";
import { type StoneCardChip, type StoneDiffView, groupCardChips, groupSwapDiff, stoneCardChips, stoneSwapDiff } from "../ui/stoneDiff";
import { swapDiff } from "../ui/swapDiff";
import { type BandDelta, type TryOnResult, tryOnBase } from "../ui/tryOn";
import { drawFigure, drawRelicGlyph, drawStoneGem, glyphSize } from "./attireUi";
import { MINI_ZOOM, drawAttireFigure, drawPedestal } from "./attireFigure";
import {
  MENU_INK,
  blinkOn,
  box,
  dashBox,
  diamond,
  drawBand,
  drawBandMorph,
  drawFocusBrackets,
  drawGlyphDisc,
  drawStepDots,
  menuText,
  mixHex,
  px,
} from "./crestDraw";
import { TEXT, textWidth } from "./pixelText";

/**
 * 候補の頁の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E3、見本 E.html の ② 候補と比べる）。state と ui を読むだけ。
 * 左 = 小さな体（替わる部位を今の物と候補で 0.5 秒ごとに入れ替える）、中 = 並びの札 3 + 候補 5、
 * 右 = 動く紋（段 1 の試着を drawBandMorph で）、下 = 差（荷札 1 行 + 地金 ▲▼ + 得る / 失う 3 行）。
 * 札の名前は ornament、差の文は sentence として数える（情報の予算）
 */

type CandidatesView = ViewOf<"candidates">;

/** 小さな体（人影を 3 倍・部位 18px の枠）の置き場 */
const MINI_FIGURE = { x: 40, y: 52, scale: 3 } as const;
/** 小さな体の足元（枠 30 × 42 の下の中央）。高精細の体を ×2 で描く */
const MINI_FEET = { x: MINI_FIGURE.x + 15, y: MINI_FIGURE.y + 41 } as const;
/** あてがいの入れ替えの周期（秒） */
const TRY_PERIOD = 0.5;

/** 札の絵・名前・丸印の位置 */
const CARD_ICON = { x: 4, y: 6 } as const;
const CARD_NAME = { x: 20, y: 7 } as const;
/** 2 段の札（スキル石: 上 = 名前・下 = 宿り符と変異）の 2 行の y と、丸印を上の段に寄せた中心 */
const CARD_TWO_LINE = { nameY: 3, chipY: 13, markY: 8 } as const;
/** 2 段目の区切りの間（論理 px） */
const CHIP_GAP = 5;
const CARD_NAME_W = 150;
const CARD_MARK_STEP = 14;
const CARD_MARK_D = 12;
const CARD_MARKS_MAX = 3;
const CARD_RIGHT = 6;
/** 付けている物の印（名前の右・系統の丸印の左）と、丸印との間 */
const WORN_BADGE = "装備中";
const BADGE_GAP = 4;

/** 動く紋の置き場（x 312〜470・y 30 + i × 22） */
const MORPH = { rule: 306, ruleY: 20, ruleH: 150, discX: 320, bandX0: 330, bandX1: 380, dotsX: 384, arrowX: 402, toX: 412, markX: 458, y0: 30, step: 22, disc: 12 } as const;
const MORPH_DIM = 0.6;
const MORPH_MARKS: Readonly<Record<BandDelta["change"], { text: string; color: string } | null>> = {
  up: { text: "▲", color: MENU_INK.up },
  new: { text: "新", color: MENU_INK.up },
  crack: { text: "▼", color: MENU_INK.down },
  gone: { text: "消", color: MENU_INK.down },
  same: null,
};
const BLACK = "#000000";

/** 差の置き場（区切り y 176・荷札 y 182・得る / 失う y 198 + i × 12。右の列 x 340〜 に変わるステータスを同じ行高で積む） */
const DIFF = { ruleY: 176, titleY: 182, rowY: 198, rowStep: 12, labelW: 24, textX: 34, statX: 340, statW: 132, fullW: 464 } as const;
/** 変わるステータスが多いとき、最後の行を「ほか n」にまとめる */
const STAT_MORE_LABEL = "ほか";
const TEXT_X = 8;
const TEXT_RIGHT = 472;
/** 右のステータスの列と得る・失うの文の間の余白 */
const STAT_GAP = 6;
/** 見出しの印（体の描画にフォントに無い ▶ を使わない。docs/GLOSSARY.md の字の注意） */
const TAG_MARK = "◆ ";
const SCROLL_MARK_Y = 166;
/** 系統から来たときの丸印（並びの札の右） */
const FLOW_DISC = { x: 290, y: 26 } as const;

function isLootSlot(slot: string): slot is LootSlot {
  return slot in MINI_PARTS;
}

// -----------------------------------------------------------------------------
// 左: 小さな体
// -----------------------------------------------------------------------------

/** あてがい中に体へ着せて見せる遺物（替わる部位は今の物と候補を交互に） */
function wornForMini(state: Readonly<GameState>, slot: LootSlot, trying: Readonly<CandidateEntry> | null, tryNow: boolean): Item | null {
  const current = state.profile.equipment[slot] ?? null;
  if (trying === null) return current;
  if (trying.kind === "clear") return tryNow ? null : current;
  if (trying.kind === "subject" && trying.subject.kind === "item") return tryNow ? trying.subject.item : current;
  return current;
}

function drawMiniParts(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry> | null): void {
  drawPedestal(ctx, MINI_FEET, MINI_ZOOM);
  // 体の絵が無い・読めなかったときは今までのドット絵の人形。読み込み中は出さない（main.ts が読み終えるまで画面を止める）
  if (!drawAttireFigure(ctx, state, MINI_FEET, MINI_ZOOM, ui.time, true) && !actorArtLoading()) drawFigure(ctx, MINI_FIGURE.x, MINI_FIGURE.y, MINI_FIGURE.scale, true);
  const tryNow = blinkOn(ui.time, TRY_PERIOD);
  const changing = changingSlot(view, entry);
  for (const slot of Object.keys(MINI_PARTS) as LootSlot[]) {
    const at = MINI_PARTS[slot];
    const on = changing === slot;
    px(ctx, at.x, at.y, MINI_PART, MINI_PART, on ? MENU_INK.card2 : MENU_INK.card);
    box(ctx, at.x, at.y, MINI_PART, MINI_PART, on ? MENU_INK.focus : MENU_INK.rule);
    const item = wornForMini(state, slot, on ? entry : null, tryNow);
    if (item !== null) {
      const size = glyphSize(RELIC_GLYPHS[slot], 1);
      drawRelicGlyph(ctx, slot, at.x + ((MINI_PART - size.w) >> 1), at.y + ((MINI_PART - size.h) >> 1), 1, itemColor(item));
    }
    if (on) px(ctx, at.x + 1, at.y + MINI_PART - 2, tryNow ? MINI_PART - 2 : 0, 1, MENU_INK.focus);
  }
}

/** 替わる部位（部位の候補はその部位、系統の候補は焦点の遺物の部位。石の候補は無い） */
function changingSlot(view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry> | null): LootSlot | null {
  if (view.target.kind === "slot") return isLootSlot(view.target.slot) ? view.target.slot : null;
  if (entry?.kind !== "subject" || entry.subject.kind !== "item") return null;
  return isLootSlot(entry.subject.item.slot) ? entry.subject.item.slot : null;
}

function drawMiniGems(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry> | null): void {
  if (view.target.kind !== "stone") return;
  const tryNow = blinkOn(ui.time, TRY_PERIOD);
  const focusStone = entry?.kind === "subject" && entry.subject.kind === "stone" ? entry.subject.stone : entry?.kind === "group" ? groupHead(entry) : null;
  const trial = tryNow ? focusStone : null;
  const cleared = entry?.kind === "clear" && tryNow;
  for (let i = 0; i < state.skills.slots.length; i++) {
    const here = i === view.target.index;
    const stone = here ? (cleared ? null : (trial ?? stoneInSlot(state.skills.profile, i))) : stoneInSlot(state.skills.profile, i);
    drawStoneGem(ctx, i, MINI_GEM.x + i * MINI_GEM.step, MINI_GEM.y, stone, here || view.focus === fid.gem(i), false);
  }
}

// -----------------------------------------------------------------------------
// 中: 並びの札と候補
// -----------------------------------------------------------------------------

function drawSortChips(ctx: CanvasRenderingContext2D, view: Readonly<CandidatesView>): void {
  SORT_ORDER.forEach((sort, i) => {
    const x = SORT_CHIP.x + i * SORT_CHIP.step;
    const on = view.sort === sort;
    const focused = view.focus === fid.sort(sort);
    px(ctx, x, SORT_CHIP.y, SORT_CHIP.w, SORT_CHIP.h, on ? MENU_INK.card2 : MENU_INK.paper);
    box(ctx, x, SORT_CHIP.y, SORT_CHIP.w, SORT_CHIP.h, focused ? MENU_INK.focus : on ? MENU_INK.gold : MENU_INK.rule);
    menuText(ctx, SORT_LABEL[sort].chip, x + SORT_CHIP.w / 2, SORT_CHIP.y + 1, { size: "SMALL", color: on ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "center" });
  });
}

/** 絞り込みの札の丸印の大きさ */
const FILTER_DISC = 10;
const FILTER_LABEL_Y = 1;
const FILTER_OFF_KEYWORD = "系統";
const FILTER_OFF_RESOURCE = "型";

/** 絞り込みの札。絞っているときは金の枠（系統は丸印、型は名前）、絞っていなければ「系統」「型」 */
function drawFilterChips(ctx: CanvasRenderingContext2D, view: Readonly<CandidatesView>): void {
  const filter = view.filter;
  for (const axis of FILTER_AXES) {
    if (!filterAvailable(view.target, axis)) continue;
    const r = FILTER_CHIPS[axis];
    const keyword = axis === "keyword" ? (filter?.keyword ?? null) : null;
    const resource = axis === "resource" ? (filter?.resource ?? null) : null;
    const on = keyword !== null || resource !== null;
    const focused = view.focus === fid.filter(axis);
    px(ctx, r.x, r.y, r.w, r.h, on ? MENU_INK.card2 : MENU_INK.paper);
    box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : on ? MENU_INK.gold : MENU_INK.rule);
    if (keyword !== null) {
      drawGlyphDisc(ctx, keyword, r.x + r.w / 2, r.y + r.h / 2, FILTER_DISC, KEYWORD_DEFS[keyword].color);
      continue;
    }
    const text = axis === "keyword" ? FILTER_OFF_KEYWORD : resource === null ? FILTER_OFF_RESOURCE : RESOURCE_LABEL[resource];
    menuText(ctx, text, r.x + r.w / 2, r.y + FILTER_LABEL_Y, { size: "SMALL", color: on ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "center" });
  }
}

/** 札に並べる系統の丸印（その物の源・糧・強めの系統。多くて 3 つ） */
function cardKeywords(subject: Readonly<CandidateSubject>): ReturnType<typeof profileKeywords> {
  const profile = subject.kind === "item" ? relicKeywords(subject.item) : skillKeywords(SKILL_DEFS[subject.stone.skillKey]);
  return profileKeywords(profile).slice(0, CARD_MARKS_MAX);
}

function drawStoneIcon(ctx: CanvasRenderingContext2D, stone: Readonly<SkillStone>, x: number, y: number): void {
  diamond(ctx, x, y, 11, MENU_INK.sub, MENU_INK.gem);
  px(ctx, x + 4, y + 4, 3, 3, stoneFaceColor(stone.skillKey));
}

/** 札 1 枚（絵・名前・系統の丸印。新着 = 左上の白い点 / 名のある遺物 = 左下の金 / 失う帯 = 左端の朱 / 付けている物 = 名前の右に「装備中」） */
function drawSubjectCard(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, s: Readonly<CandidateSubject>, x: number, y: number, focused: boolean, lost: boolean, worn: boolean): void {
  const keywords = cardKeywords(s);
  if (s.kind === "item") {
    if (isLootSlot(s.item.slot)) drawRelicGlyph(ctx, s.item.slot, x + CARD_ICON.x, y + CARD_ICON.y, 1, itemColor(s.item));
    if (isUnseen(s.item, state.profile.meta)) px(ctx, x + 1, y + 1, 2, 2, MENU_INK.focus);
    if (s.item.namedKey !== undefined) px(ctx, x + 1, y + CAND_CARD.h - 3, 6, 1, MENU_INK.gold);
  } else {
    drawStoneIcon(ctx, s.stone, x + CARD_ICON.x + 1, y + CARD_ICON.y);
  }
  const name = s.kind === "item" ? s.item.name : SKILL_DEFS[s.stone.skillKey].name;
  const chips = s.kind === "stone" ? stoneCardChips(s.stone) : [];
  drawCardText(ctx, name, chips, keywords, x, y, focused, worn ? WORN_BADGE : null);
  if (lost) px(ctx, x - 2, y + 9, 2, 5, MENU_INK.down);
}

const CHIP_COLOR: Readonly<Record<StoneCardChip["tone"], string>> = {
  dwell: STONE_TUNING.dwellColor,
  good: MENU_INK.up,
  bad: MENU_INK.down,
};

/**
 * 札の名前と系統の丸印。chips（宿り符）があれば 2 段にし、下の段に金で出す。変異の値は札に出さず差の欄に出す
 * （docs/ideas/skill-stone-hunt.md）
 */
function drawCardText(ctx: CanvasRenderingContext2D, name: string, chips: readonly StoneCardChip[], keywords: readonly Keyword[], x: number, y: number, focused: boolean, badge: string | null = null): void {
  const twoLine = chips.length > 0;
  const nameY = twoLine ? CARD_TWO_LINE.nameY : CARD_NAME.y;
  const marksW = keywords.length * CARD_MARK_STEP;
  // 「装備中」は系統の丸印の左に置き、その分だけ名前を短く切る
  const badgeW = badge === null ? 0 : textWidth(badge, TEXT.SMALL) + BADGE_GAP;
  menuText(ctx, name, x + CARD_NAME.x, y + nameY, { size: "SMALL", color: focused ? MENU_INK.focus : MENU_INK.text, role: "ornament", maxW: CARD_NAME_W - marksW - badgeW });
  if (badge !== null) {
    const right = x + CAND_CARD.w - CARD_RIGHT - marksW - BADGE_GAP;
    menuText(ctx, badge, right, y + nameY, { size: "SMALL", color: MENU_INK.gold, role: "ornament", align: "right" });
  }
  const markY = twoLine ? CARD_TWO_LINE.markY : CAND_CARD.h >> 1;
  keywords.forEach((k, j) => {
    const cx = x + CAND_CARD.w - CARD_RIGHT - (keywords.length - j) * CARD_MARK_STEP + CARD_MARK_D / 2;
    drawGlyphDisc(ctx, k, cx, y + markY, CARD_MARK_D, KEYWORD_DEFS[k].color);
  });
  drawChips(ctx, chips, x + CARD_NAME.x, y + CARD_TWO_LINE.chipY, x + CAND_CARD.w - CARD_RIGHT, "ornament");
}

/** 色分けの区切りを左から並べる（right を越える区切りは描かない）。role は情報の予算での数え方（差の欄の行は文、札は飾り） */
function drawChips(ctx: CanvasRenderingContext2D, chips: readonly StoneCardChip[], x: number, y: number, right: number, role: "sentence" | "ornament"): void {
  let cx = x;
  for (const chip of chips) {
    const w = textWidth(chip.text, TEXT.SMALL);
    if (cx + w > right) break;
    menuText(ctx, chip.text, cx, y, { size: "SMALL", color: CHIP_COLOR[chip.tone], role });
    cx += w + CHIP_GAP;
  }
}

/** 同じスキルの石の束の札（名前 ×個数。束に宿り符があれば下の段に名前） */
function drawGroupCard(ctx: CanvasRenderingContext2D, entry: Readonly<CandidateEntry & { kind: "group" }>, x: number, y: number, focused: boolean): void {
  const head = groupHead(entry);
  if (head === null) return;
  drawStoneIcon(ctx, head, x + CARD_ICON.x + 1, y + CARD_ICON.y);
  // 束の印: 石の絵の右下に重なった 2 枚目の角
  px(ctx, x + CARD_ICON.x + 10, y + CARD_ICON.y + 9, 3, 1, MENU_INK.sub);
  px(ctx, x + CARD_ICON.x + 12, y + CARD_ICON.y + 7, 1, 3, MENU_INK.sub);
  const keywords = profileKeywords(skillKeywords(SKILL_DEFS[head.skillKey])).slice(0, CARD_MARKS_MAX);
  drawCardText(ctx, `${SKILL_DEFS[head.skillKey].name} ×${entry.stones.length}`, groupCardChips(entry.stones), keywords, x, y, focused);
}

function drawBudCard(ctx: CanvasRenderingContext2D, roll: Readonly<AffixRoll>, x: number, y: number, focused: boolean): void {
  px(ctx, x + CARD_ICON.x + 2, y + CARD_ICON.y, 3, 3, MENU_INK.bud);
  px(ctx, x + CARD_ICON.x + 3, y + CARD_ICON.y + 3, 1, 4, MENU_INK.budStem);
  menuText(ctx, describeTrait(roll).text, x + CARD_NAME.x, y + CARD_NAME.y, { size: "SMALL", color: focused ? MENU_INK.focus : MENU_INK.text, role: "ornament", maxW: CAND_CARD.w - CARD_NAME.x - CARD_RIGHT });
}

function drawClearCard(ctx: CanvasRenderingContext2D, x: number, y: number, focused: boolean): void {
  dashBox(ctx, x + CARD_ICON.x, y + CARD_ICON.y, 11, 11, MENU_INK.dim);
  menuText(ctx, "空ける", x + CARD_NAME.x, y + CARD_NAME.y, { size: "SMALL", color: focused ? MENU_INK.focus : MENU_INK.sub, role: "ornament" });
}

/** 倉庫の札のうち、別のスキル枠に付けている石（遺物の候補は倉庫の物だけなので付けている物は無い） */
function isWornSubject(state: Readonly<GameState>, s: Readonly<CandidateSubject>): boolean {
  return s.kind === "stone" && isStoneWorn(state, s.stone.id);
}

function cardLost(state: Readonly<GameState>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry>, base: ReturnType<typeof tryOnBase>): boolean {
  if (entry.kind !== "subject") return false;
  const result = tryOnForEntry(state, view, entry, base);
  return result !== null && result.summary.lost > 0;
}

function drawCards(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<CandidatesView>, entries: readonly CandidateEntry[]): void {
  const base = tryOnBase(state);
  visibleEntries(entries, view.offset).forEach((entry, i) => {
    const x = CAND_CARD.x;
    const y = CAND_CARD.y + i * CAND_CARD.step;
    const focused = view.focus === entryFocusId(entry);
    px(ctx, x, y, CAND_CARD.w, CAND_CARD.h, focused ? MENU_INK.card2 : MENU_INK.card);
    box(ctx, x, y, CAND_CARD.w, CAND_CARD.h, focused ? MENU_INK.focus : entry.kind === "worn" ? MENU_INK.gold : MENU_INK.rule);
    if (entry.kind === "bud") drawBudCard(ctx, entry.roll, x, y, focused);
    else if (entry.kind === "clear") drawClearCard(ctx, x, y, focused);
    else if (entry.kind === "group") drawGroupCard(ctx, entry, x, y, focused);
    else if (entry.kind === "worn") drawSubjectCard(ctx, state, entry.subject, x, y, focused, false, true);
    else drawSubjectCard(ctx, state, entry.subject, x, y, focused, cardLost(state, view, entry, base), isWornSubject(state, entry.subject));
  });
  if (entries.length > view.offset + CANDIDATE_PAGE) {
    menuText(ctx, "▼", CAND_CARD.x + CAND_CARD.w / 2, SCROLL_MARK_Y, { size: "SMALL", color: MENU_INK.sub, role: "ornament", align: "center" });
  }
  if (view.offset > 0) {
    menuText(ctx, "▲", SORT_CHIP.x + 3 * SORT_CHIP.step, SORT_CHIP.y + 1, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  }
}

function drawEmpty(ctx: CanvasRenderingContext2D, view: Readonly<CandidatesView>): void {
  const filtered = view.filter !== undefined && (view.filter.keyword !== null || view.filter.resource !== null);
  const text = filtered ? "この絞り込みの候補は倉庫にありません" : view.target.kind === "slot" ? "倉庫にこの部位の遺物はありません" : view.target.kind === "stone" ? "倉庫にほかのスキル石はありません" : "この系統の候補は倉庫にありません";
  menuText(ctx, text, CAND_CARD.x + 4, CAND_CARD.y + 24, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: CAND_CARD.w - 8 });
}

// -----------------------------------------------------------------------------
// 右: 動く紋
// -----------------------------------------------------------------------------

function drawMorph(ctx: CanvasRenderingContext2D, ui: Readonly<InventoryUi>, result: Readonly<TryOnResult>): void {
  px(ctx, MORPH.rule, MORPH.ruleY, 1, MORPH.ruleH, MENU_INK.rule);
  result.deltas.forEach((d, i) => {
    const y = MORPH.y0 + i * MORPH.step;
    const color = KEYWORD_DEFS[d.keyword].color;
    const moving = d.change !== "same";
    const shown = moving ? color : mixHex(color, BLACK, MORPH_DIM);
    drawGlyphDisc(ctx, d.keyword, MORPH.discX, y, MORPH.disc, shown, { under: d.from === 0 && d.to === 0 });
    if (moving) drawBandMorph(ctx, MORPH.bandX0, MORPH.bandX1, y, d, color, ui.time, ui.focusAt);
    else drawBand(ctx, MORPH.bandX0, MORPH.bandX1, y, d.to, shown, ui.time);
    drawStepDots(ctx, MORPH.dotsX, y - 1, d.from, shown, 3, 2);
    menuText(ctx, "→", MORPH.arrowX, y - 3, { size: "SMALL", color: moving ? MENU_INK.text : MENU_INK.dim, role: "ornament" });
    drawStepDots(ctx, MORPH.toX, y - 1, d.to, shown, 3, 2);
    const mark = MORPH_MARKS[d.change];
    if (mark !== null) menuText(ctx, mark.text, MORPH.markX, y - 4, { size: "SMALL", color: mark.color, role: "ornament" });
  });
}

// -----------------------------------------------------------------------------
// 下: 差
// -----------------------------------------------------------------------------

interface DiffLine {
  gain: boolean;
  text: string;
  /** 得る・失うのどちらでもない行の頭（「変異」「束」）。あれば得る・失うの代わりに薄い色で出す */
  label?: string;
  /** 色分けして並べる区切り（変異の行）。あれば text の代わりに描く */
  chips?: readonly StoneCardChip[];
}

interface DiffView {
  title: string;
  /** 付けたときに変わるステータス（「防御力 12 → 15」。遺物の候補だけ） */
  stats: StatChanges;
  lines: DiffLine[];
  more: number;
  /** 行が無いときの 1 行 */
  empty: string;
}

const NAME_JOINT = " と ";
/** 装備中の札の欄の行の頭（得る・失うの代わり） */
const WORN_TRAIT_LABEL = "性質";
const WORN_SKILL_LABEL = "効果";
const NO_STATS: StatChanges = { changes: [], more: 0 };

function itemDiff(state: Readonly<GameState>, candidate: Readonly<Item>, current: Readonly<Item> | null): DiffView {
  const diff = swapDiff(candidate, current, Math.max(1, state.depth));
  const stats = statChangesOf(state, candidate, current);
  return {
    title: current === null ? candidate.name : `${candidate.name}${NAME_JOINT}${current.name}`,
    stats,
    lines: diff.rows.map((r) => ({ gain: r.kind === "gain", text: r.text })),
    more: diff.more,
    empty: diff.innate.length > 0 ? "性質は同じ。地金だけが替わる" : "性質も地金も同じ",
  };
}

/** 石の比べ（ui/stoneDiff.ts の行を差の欄の形へ） */
function stoneDiffView(v: Readonly<StoneDiffView>): DiffView {
  const lines = v.rows.map((r): DiffLine => ({ gain: r.tone !== "loss", text: r.text, ...(r.tone === "info" ? { label: r.label ?? "" } : {}), ...(r.chips === undefined ? {} : { chips: r.chips }) }));
  return { title: v.title, stats: NO_STATS, lines, more: v.more, empty: "" };
}

function clearDiff(state: Readonly<GameState>, view: Readonly<CandidatesView>): DiffView | null {
  const t = view.target;
  if (t.kind === "slot") {
    const item = state.profile.equipment[t.slot] ?? null;
    if (item === null) return null;
    const rows = item.affixes.map((roll) => ({ gain: false, text: describeTrait(roll).text }));
    return { title: `${SLOT_LABEL[t.slot]}を空ける`, stats: NO_STATS, lines: rows.slice(0, MENU_BUDGET.diffRows), more: Math.max(0, rows.length - MENU_BUDGET.diffRows), empty: "" };
  }
  if (t.kind !== "stone") return null;
  const stone = stoneInSlot(state.skills.profile, t.index);
  if (stone === null) return null;
  return { title: `スキル ${t.index + 1} を空ける`, stats: NO_STATS, lines: [{ gain: false, text: SKILL_DEFS[stone.skillKey].verb }], more: 0, empty: "" };
}

function budDiff(state: Readonly<GameState>, view: Readonly<CandidatesView>, roll: Readonly<AffixRoll>): DiffView {
  const worn = view.target.kind === "slot" ? state.profile.equipment[view.target.slot] : null;
  return { title: `${worn?.name ?? ""} に芽吹く`, stats: NO_STATS, lines: [{ gain: true, text: describeTrait(roll).text }], more: 0, empty: "" };
}

/** 付けている物の欄: 性質（遺物）か、何をするスキルか（石）。比べる相手が無いので得る・失うにしない */
function wornDiff(s: Readonly<CandidateSubject>): DiffView {
  if (s.kind === "item") {
    const rows = s.item.affixes.map((roll): DiffLine => ({ gain: true, label: WORN_TRAIT_LABEL, text: describeTrait(roll).text }));
    return { title: `${WORN_BADGE}  ${s.item.name}`, stats: NO_STATS, lines: rows.slice(0, MENU_BUDGET.diffRows), more: Math.max(0, rows.length - MENU_BUDGET.diffRows), empty: "" };
  }
  const def = SKILL_DEFS[s.stone.skillKey];
  return { title: `${WORN_BADGE}  ${def.name}`, stats: NO_STATS, lines: [{ gain: true, label: WORN_SKILL_LABEL, text: def.verb }], more: 0, empty: "" };
}

function diffOf(state: Readonly<GameState>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry>): DiffView | null {
  if (entry.kind === "bud") return budDiff(state, view, entry.roll);
  if (entry.kind === "worn") return wornDiff(entry.subject);
  if (entry.kind === "clear") return clearDiff(state, view);
  const worn = view.target.kind === "stone" ? stoneInSlot(state.skills.profile, view.target.index) : null;
  if (entry.kind === "group") {
    const g = groupSwapDiff(entry.stones, worn);
    return g === null ? null : stoneDiffView(g);
  }
  const s = entry.subject;
  if (s.kind === "stone") return stoneDiffView(stoneSwapDiff(s.stone, worn));
  return itemDiff(state, s.item, state.profile.equipment[s.item.slot] ?? null);
}

/** 変わるステータスの行（多いときは最後の行を「ほか n」に）。色は上がる = 上 / 下がる = 下 */
function statRows(stats: Readonly<StatChanges>): { text: string; color: string }[] {
  const shown = stats.changes.map((c) => ({ text: `${c.label} ${c.before} → ${c.after}`, color: c.rises ? MENU_INK.up : MENU_INK.down }));
  if (stats.more <= 0) return shown;
  const kept = shown.slice(0, Math.max(0, MENU_BUDGET.innateDiffs - 1));
  return [...kept, { text: `${STAT_MORE_LABEL} ${stats.more + shown.length - kept.length}`, color: MENU_INK.sub }];
}

function drawDiff(ctx: CanvasRenderingContext2D, diff: Readonly<DiffView>): void {
  px(ctx, TEXT_X, DIFF.ruleY, TEXT_RIGHT - TEXT_X, 1, MENU_INK.rule);
  menuText(ctx, `${TAG_MARK}${diff.title}`, TEXT_X, DIFF.titleY, { size: "BODY", color: MENU_INK.focus, role: "sentence", maxW: DIFF.fullW });
  const stats = statRows(diff.stats);
  if (diff.lines.length === 0 && stats.length === 0) {
    if (diff.empty !== "") menuText(ctx, diff.empty, TEXT_X, DIFF.rowY, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: DIFF.fullW });
    return;
  }
  // 右の列があるときは、得る・失うの文をその手前で切る（重ねない）
  const textW = (stats.length === 0 ? TEXT_RIGHT : DIFF.statX - STAT_GAP) - DIFF.textX;
  diff.lines.forEach((line, i) => {
    const y = DIFF.rowY + i * DIFF.rowStep;
    const head = line.label ?? (line.gain ? "得る" : "失う");
    const headColor = line.label !== undefined ? MENU_INK.sub : line.gain ? MENU_INK.up : MENU_INK.down;
    menuText(ctx, head, TEXT_X, y, { size: "SMALL", color: headColor, role: "ornament" });
    const more = i === diff.lines.length - 1 && diff.more > 0 ? `　ほか ${diff.more}` : "";
    if (line.chips !== undefined && more === "") {
      drawChips(ctx, line.chips, DIFF.textX, y, DIFF.textX + textW, "sentence");
      return;
    }
    menuText(ctx, `${line.text}${more}`, DIFF.textX, y, { size: "SMALL", color: MENU_INK.text, role: "sentence", maxW: textW });
  });
  stats.forEach((row, i) => {
    menuText(ctx, row.text, DIFF.statX, DIFF.rowY + i * DIFF.rowStep, { size: "SMALL", color: row.color, role: "label", maxW: DIFF.statW });
  });
}

// -----------------------------------------------------------------------------
// 頁
// -----------------------------------------------------------------------------

export function drawCandidates(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  ui: Readonly<InventoryUi>,
  view: Readonly<ViewOf<"candidates">>,
  hits: readonly MenuHit[],
): void {
  const entries = candidateEntries(state, view);
  const entry = focusedEntry(state, view);
  drawMiniParts(ctx, state, ui, view, entry);
  drawMiniGems(ctx, state, ui, view, entry);
  drawSortChips(ctx, view);
  drawFilterChips(ctx, view);
  if (view.target.kind === "flow") drawGlyphDisc(ctx, view.target.keyword, FLOW_DISC.x, FLOW_DISC.y, CARD_MARK_D, KEYWORD_DEFS[view.target.keyword].color);
  if (entries.length === 0) drawEmpty(ctx, view);
  drawCards(ctx, state, view, entries);
  if (entry !== null) {
    const result = tryOnForEntry(state, view, entry);
    if (result !== null) drawMorph(ctx, ui, result);
    const diff = diffOf(state, view, entry);
    if (diff !== null) drawDiff(ctx, diff);
  }
  const hit = hits.find((h) => h.id === view.focus);
  if (hit !== undefined) drawFocusBrackets(ctx, hit.rect);
}
