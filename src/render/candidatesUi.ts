import { KEYWORD_DEFS, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { RELIC_GLYPHS } from "../data/sprites/attire";
import { MENU_BUDGET } from "../data/tuning";
import { describeTrait } from "../loot/describe";
import type { AffixRoll, Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { relicKeywords, skillKeywords } from "../system/keywords";
import { itemColor } from "../system/loot";
import {
  CANDIDATE_PAGE,
  CAND_CARD,
  MINI_PART,
  MINI_PARTS,
  SORT_CHIP,
  SORT_LABEL,
  SORT_ORDER,
  type CandidateEntry,
  candidateEntries,
  entryFocusId,
  focusedEntry,
  tryOnForEntry,
  visibleEntries,
} from "../ui/candidates";
import { stoneFaceColor } from "../ui/crestShape";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, ViewOf } from "../ui/menuState";
import { isUnseen } from "../ui/seen";
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
/** 石の候補で並べる腰の石 */
const MINI_GEM = { x: 14, step: 22, y: 136 } as const;

/** 札の絵・名前・丸印の位置 */
const CARD_ICON = { x: 4, y: 6 } as const;
const CARD_NAME = { x: 20, y: 7 } as const;
const CARD_NAME_W = 150;
const CARD_MARK_STEP = 14;
const CARD_MARK_D = 12;
const CARD_MARKS_MAX = 3;
const CARD_RIGHT = 6;

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

/** 差の置き場（区切り y 176・荷札 y 182・得る / 失う y 198 + i × 12） */
const DIFF = { ruleY: 176, titleY: 182, rowY: 198, rowStep: 12, labelW: 24, textX: 34, asideX: 340, asideW: 132, titleW: 330, fullW: 464 } as const;
const TEXT_X = 8;
const TEXT_RIGHT = 472;
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
  // 体の絵が読めるまでは今までのドット絵の人形で代わりに描く
  if (!drawAttireFigure(ctx, state, MINI_FEET, MINI_ZOOM, ui.time, true)) drawFigure(ctx, MINI_FIGURE.x, MINI_FIGURE.y, MINI_FIGURE.scale, true);
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
  const trial = entry?.kind === "subject" && entry.subject.kind === "stone" && tryNow ? entry.subject.stone : null;
  const cleared = entry?.kind === "clear" && tryNow;
  for (let i = 0; i < state.skills.slots.length; i++) {
    const here = i === view.target.index;
    const stone = here ? (cleared ? null : (trial ?? stoneInSlot(state.skills.profile, i))) : stoneInSlot(state.skills.profile, i);
    drawStoneGem(ctx, i, MINI_GEM.x + i * MINI_GEM.step, MINI_GEM.y, stone, here, false);
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

/** 札に並べる系統の丸印（その物の源・糧・強めの系統。多くて 3 つ） */
function cardKeywords(subject: Readonly<CandidateEntry & { kind: "subject" }>["subject"]): ReturnType<typeof profileKeywords> {
  const profile = subject.kind === "item" ? relicKeywords(subject.item) : skillKeywords(SKILL_DEFS[subject.stone.skillKey]);
  return profileKeywords(profile).slice(0, CARD_MARKS_MAX);
}

function drawStoneIcon(ctx: CanvasRenderingContext2D, stone: Readonly<SkillStone>, x: number, y: number): void {
  diamond(ctx, x, y, 11, MENU_INK.sub, MENU_INK.gem);
  px(ctx, x + 4, y + 4, 3, 3, stoneFaceColor(stone.skillKey));
}

/** 札 1 枚（絵・名前・系統の丸印。新着 = 左上の白い点 / 名のある遺物 = 左下の金 / 失う帯 = 左端の朱） */
function drawSubjectCard(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, entry: Readonly<CandidateEntry & { kind: "subject" }>, x: number, y: number, focused: boolean, lost: boolean): void {
  const s = entry.subject;
  const keywords = cardKeywords(s);
  if (s.kind === "item") {
    if (isLootSlot(s.item.slot)) drawRelicGlyph(ctx, s.item.slot, x + CARD_ICON.x, y + CARD_ICON.y, 1, itemColor(s.item));
    if (isUnseen(s.item, state.profile.meta)) px(ctx, x + 1, y + 1, 2, 2, MENU_INK.focus);
    if (s.item.namedKey !== undefined) px(ctx, x + 1, y + CAND_CARD.h - 3, 6, 1, MENU_INK.gold);
  } else {
    drawStoneIcon(ctx, s.stone, x + CARD_ICON.x + 1, y + CARD_ICON.y);
  }
  const name = s.kind === "item" ? s.item.name : SKILL_DEFS[s.stone.skillKey].name;
  menuText(ctx, name, x + CARD_NAME.x, y + CARD_NAME.y, { size: "SMALL", color: focused ? MENU_INK.focus : MENU_INK.text, role: "ornament", maxW: CARD_NAME_W - keywords.length * CARD_MARK_STEP });
  keywords.forEach((k, j) => {
    const cx = x + CAND_CARD.w - CARD_RIGHT - (keywords.length - j) * CARD_MARK_STEP + CARD_MARK_D / 2;
    drawGlyphDisc(ctx, k, cx, y + (CAND_CARD.h >> 1), CARD_MARK_D, KEYWORD_DEFS[k].color);
  });
  if (lost) px(ctx, x - 2, y + 9, 2, 5, MENU_INK.down);
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
    box(ctx, x, y, CAND_CARD.w, CAND_CARD.h, focused ? MENU_INK.focus : MENU_INK.rule);
    if (entry.kind === "bud") drawBudCard(ctx, entry.roll, x, y, focused);
    else if (entry.kind === "clear") drawClearCard(ctx, x, y, focused);
    else drawSubjectCard(ctx, state, entry, x, y, focused, cardLost(state, view, entry, base));
  });
  if (entries.length > view.offset + CANDIDATE_PAGE) {
    menuText(ctx, "▼", CAND_CARD.x + CAND_CARD.w / 2, SCROLL_MARK_Y, { size: "SMALL", color: MENU_INK.sub, role: "ornament", align: "center" });
  }
  if (view.offset > 0) {
    menuText(ctx, "▲", SORT_CHIP.x + 3 * SORT_CHIP.step, SORT_CHIP.y + 1, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  }
}

function drawEmpty(ctx: CanvasRenderingContext2D, view: Readonly<CandidatesView>): void {
  const text = view.target.kind === "slot" ? "倉庫にこの部位の遺物はありません" : view.target.kind === "stone" ? "倉庫にほかのスキル石はありません" : "この系統の候補は倉庫にありません";
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
}

interface DiffView {
  title: string;
  aside: string | null;
  lines: DiffLine[];
  more: number;
  /** 行が無いときの 1 行 */
  empty: string;
}

const NAME_JOINT = " と ";
const ARROW_UP = "▲";
const ARROW_DOWN = "▼";
const ASIDE_SEP = "  ";

function itemDiff(state: Readonly<GameState>, candidate: Readonly<Item>, current: Readonly<Item> | null): DiffView {
  const diff = swapDiff(candidate, current, Math.max(1, state.depth));
  const aside = diff.innate.map((d) => `${d.label} ${d.direction === "up" ? ARROW_UP : ARROW_DOWN}`).join(ASIDE_SEP);
  return {
    title: current === null ? candidate.name : `${candidate.name}${NAME_JOINT}${current.name}`,
    aside: aside === "" ? null : aside,
    lines: diff.rows.map((r) => ({ gain: r.kind === "gain", text: r.text })),
    more: diff.more,
    empty: diff.innate.length > 0 ? "性質は同じ。地金だけが替わる" : "性質も地金も同じ",
  };
}

function stoneDiff(candidate: Readonly<SkillStone>, current: Readonly<SkillStone> | null): DiffView {
  const next = SKILL_DEFS[candidate.skillKey];
  const now = current === null ? null : SKILL_DEFS[current.skillKey];
  const lines: DiffLine[] = [{ gain: true, text: next.verb }];
  if (now !== null && now.verb !== next.verb) lines.push({ gain: false, text: now.verb });
  return { title: now === null ? next.name : `${next.name}${NAME_JOINT}${now.name}`, aside: null, lines, more: 0, empty: "" };
}

function clearDiff(state: Readonly<GameState>, view: Readonly<CandidatesView>): DiffView | null {
  const t = view.target;
  if (t.kind === "slot") {
    const item = state.profile.equipment[t.slot] ?? null;
    if (item === null) return null;
    const rows = item.affixes.map((roll) => ({ gain: false, text: describeTrait(roll).text }));
    return { title: `${SLOT_LABEL[t.slot]}を空ける`, aside: null, lines: rows.slice(0, MENU_BUDGET.diffRows), more: Math.max(0, rows.length - MENU_BUDGET.diffRows), empty: "" };
  }
  if (t.kind !== "stone") return null;
  const stone = stoneInSlot(state.skills.profile, t.index);
  if (stone === null) return null;
  return { title: `スキル ${t.index + 1} を空ける`, aside: null, lines: [{ gain: false, text: SKILL_DEFS[stone.skillKey].verb }], more: 0, empty: "" };
}

function budDiff(state: Readonly<GameState>, view: Readonly<CandidatesView>, roll: Readonly<AffixRoll>): DiffView {
  const worn = view.target.kind === "slot" ? state.profile.equipment[view.target.slot] : null;
  return { title: `${worn?.name ?? ""} に芽吹く`, aside: null, lines: [{ gain: true, text: describeTrait(roll).text }], more: 0, empty: "" };
}

function diffOf(state: Readonly<GameState>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry>): DiffView | null {
  if (entry.kind === "bud") return budDiff(state, view, entry.roll);
  if (entry.kind === "clear") return clearDiff(state, view);
  const s = entry.subject;
  if (s.kind === "stone") return stoneDiff(s.stone, view.target.kind === "stone" ? stoneInSlot(state.skills.profile, view.target.index) : null);
  return itemDiff(state, s.item, state.profile.equipment[s.item.slot] ?? null);
}

function drawDiff(ctx: CanvasRenderingContext2D, diff: Readonly<DiffView>): void {
  px(ctx, TEXT_X, DIFF.ruleY, TEXT_RIGHT - TEXT_X, 1, MENU_INK.rule);
  const titleW = diff.aside === null ? DIFF.fullW : DIFF.titleW;
  menuText(ctx, `▶ ${diff.title}`, TEXT_X, DIFF.titleY, { size: "BODY", color: MENU_INK.focus, role: "sentence", maxW: titleW });
  if (diff.aside !== null) menuText(ctx, diff.aside, DIFF.asideX + DIFF.asideW, DIFF.titleY + 1, { size: "SMALL", color: MENU_INK.sub, role: "label", align: "right", maxW: DIFF.asideW });
  if (diff.lines.length === 0) {
    if (diff.empty !== "") menuText(ctx, diff.empty, TEXT_X, DIFF.rowY, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: DIFF.fullW });
    return;
  }
  diff.lines.forEach((line, i) => {
    const y = DIFF.rowY + i * DIFF.rowStep;
    menuText(ctx, line.gain ? "得る" : "失う", TEXT_X, y, { size: "SMALL", color: line.gain ? MENU_INK.up : MENU_INK.down, role: "ornament" });
    const more = i === diff.lines.length - 1 && diff.more > 0 ? `　ほか ${diff.more}` : "";
    menuText(ctx, `${line.text}${more}`, DIFF.textX, y, { size: "SMALL", color: MENU_INK.text, role: "sentence", maxW: TEXT_RIGHT - DIFF.textX });
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
