import { actionKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { type DamageModDiff, computeStats, damageModDiffs, statsSummary } from "../loot/stats";
import { DEFAULT_STATS, type Item, type PlayerStats } from "../loot/types";
import { MODIFIERS, SKILL, SKILL_DEFS, formatVariant, modifierVerb, stoneLabel, transformLabel } from "../skills/data";
import { STONE_TUNING } from "../skills/tuning2";
import { currentForm } from "../system/morale";
import type { FormKey } from "../data/weaponForms";
import type { ModifierKey, SkillDef, SkillStone } from "../skills/types";
import { weaponArtLabel } from "../skills/arts";
import { type InteractFocus, type PedestalVerb, focusedInteract, pedestalVerb } from "../system/interact";
import { type FocusedDrop, aimWorldOf } from "../system/loot";
import { type Rect, SLOT_LABEL } from "../ui/inventoryLayout";
import { itemTipLines } from "./itemTips";
import {
  COLOR_BORDER,
  COLOR_DIM,
  COLOR_PANEL_BG,
  COLOR_TEXT,
  COLOR_WARN,
  TEXT_PAD_X,
  type TipLine,
  bodyLineH,
  drawTipLine,
  fillRectPx,
  strokeRectPx,
  wrapTipLines,
} from "./lootUiParts";
import { TEXT, drawTextShadow } from "./pixelText";

/**
 * 床の遺物・スキル石・台座（商人の品・契約者・部屋の台座）にカーソルを合わせたときの注目表示（環とキー案内）と、
 * 遺物・スキル石の性能のポップアップ。台座は世界側に品札（merchantUi.ts / runUi.ts / 部屋の台座の名札）があるのでポップアップを出さない。
 * 注目は system/interact.ts の focusedInteract（拾得・使用の判定と同じ純関数）で毎フレーム求め、state には書かない
 */

/** ポップアップの幅（論理 px）。装備画面のツールチップと同じくらいの読み幅 */
export const DROP_TIP_W = 170;
/** カーソルからポップアップまでの距離 */
const TIP_OFFSET = 10;
/** 画面端に残す余白 */
const SCREEN_MARGIN = 2;
const TIP_PAD_Y = 3;
/** 装備中との差の行の上限。溢れたら「ほか N 件」にまとめる */
export const DIFF_LINES_MAX = 6;
const FOCUS_RING_RADIUS = 8;
const FOCUS_RING_COLOR = "#ffffff";
const FOCUS_RING_ALPHA = 0.85;
/** キー案内を環の下に置く距離 */
const HINT_OFFSET_Y = FOCUS_RING_RADIUS + 3;
const COLOR_HINT_SHADOW = "#000000";
/** キー案内の動詞（拾う / 台座の種類ごと）。GLOSSARY「拾う」「台座の操作」 */
const PICK_UP_VERB = "拾う";
const PEDESTAL_VERB_LABEL: Readonly<Record<PedestalVerb, string>> = {
  buy: "買う",
  choose: "選ぶ",
  use: "使う",
  open: "開ける",
};
const COLOR_BETTER = "#7fe07f";
const COLOR_WORSE = COLOR_WARN;
const COLOR_STONE = "#b080ff";
const COLOR_RUNE = SKILL.drop.runeColor;
/** 武器技の「〇〇専用」 */
const COLOR_WEAPON_ART = "#ffd080";
export const MARK_UP = "▲";
export const MARK_DOWN = "▼";
const EPSILON = 1e-6;

/** 値が小さいほど良いステータス（上がる / 下がる の色を逆にする） */
const LOWER_IS_BETTER: ReadonlySet<NumericStatKey> = new Set<NumericStatKey>([
  "damageTakenMul",
  "dashCooldownMul",
  "manaCostMul",
  "statusTakenMul",
]);

type NumericStatKey = { [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never }[keyof PlayerStats];

const NUMERIC_STAT_KEYS: readonly NumericStatKey[] = (Object.keys(DEFAULT_STATS) as (keyof PlayerStats)[]).filter(
  (key): key is NumericStatKey => typeof DEFAULT_STATS[key] === "number",
);

// ---------------------------------------------------------------------------
// 行の組み立て（純関数。テスト対象）
// ---------------------------------------------------------------------------

/** 1 項目だけを既定から変えた stats の表示文字列（statsSummary の書式を借りる。表示対象外なら undefined） */
function statText(key: NumericStatKey, value: number): string | undefined {
  const stats: PlayerStats = { ...DEFAULT_STATS, [key]: value };
  return statsSummary(stats)[0];
}

function diffLine(key: NumericStatKey, before: number, after: number): TipLine | null {
  const shown = statText(key, after);
  const text = shown ?? (statText(key, before) === undefined ? undefined : `${statText(key, before)} → なし`);
  if (text === undefined) return null;
  const rises = after > before;
  const better = LOWER_IS_BETTER.has(key) ? !rises : rises;
  return { text, color: better ? COLOR_BETTER : COLOR_WORSE, mark: rises ? MARK_UP : MARK_DOWN, markColor: better ? COLOR_BETTER : COLOR_WORSE };
}

/** 与ダメの増・倍の差の行（上がるほど良い） */
function modDiffLine(d: DamageModDiff): TipLine {
  const color = d.rises ? COLOR_BETTER : COLOR_WORSE;
  return { text: d.text, color, mark: d.rises ? MARK_UP : MARK_DOWN, markColor: color };
}

/**
 * 装備中の同部位と入れ替えたときに変わる能力値（共鳴の変化も computeStats に含まれる）。
 * 単一のスコアにはまとめず、項目ごとに ▲▼ と良し悪しの色で並べる
 */
export function compareLines(state: GameState, item: Item): TipLine[] {
  const equipment = state.profile.equipment;
  const worn = equipment[item.slot];
  const head: TipLine = worn
    ? { text: `装備中の「${worn.name}」との比較`, color: COLOR_DIM }
    : { text: `${SLOT_LABEL[item.slot]}: 空き（装備した場合）`, color: COLOR_DIM };
  const before = computeStats(equipment, state.depth);
  const after = computeStats({ ...equipment, [item.slot]: item }, state.depth);
  const diffs = NUMERIC_STAT_KEYS.filter((key) => Math.abs(after[key] - before[key]) > EPSILON)
    .map((key) => diffLine(key, before[key], after[key]))
    .filter((line): line is TipLine => line !== null);
  diffs.push(...damageModDiffs(before, after).map(modDiffLine));
  if (diffs.length === 0) return [head, { text: "能力値の変化なし", color: COLOR_DIM }];
  const shown = diffs.slice(0, DIFF_LINES_MAX);
  const rest = diffs.length - shown.length;
  if (rest > 0) shown.push({ text: `ほか ${rest} 件`, color: COLOR_DIM });
  return [head, ...shown];
}

/** 宿り符の 1 行「宿り符 連鎖: 〜」（リンクを使わずに効く。docs/ideas/skill-stone-hunt.md） */
export function dwellLine(key: ModifierKey, def: Readonly<SkillDef>): string {
  return `宿り符 ${MODIFIERS[key].name}: ${modifierVerb(key, def)}`;
}

/** スキル石: 名前・今の型での形の変わり方・動詞・タグ・変異軸・宿り符（装備画面のツールチップの要約）。form は今の武器の型 */
export function stoneLines(stone: SkillStone, form?: FormKey): TipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const transform = form === undefined ? null : transformLabel(form, stone.skillKey);
  const lines: TipLine[] = [
    { text: stoneLabel(stone), color: COLOR_STONE },
    ...(def.moveset === undefined ? [] : [{ text: weaponArtLabel(def.moveset), color: COLOR_WEAPON_ART }]),
    ...(transform === null ? [] : [{ text: transform, color: COLOR_WEAPON_ART }]),
    { text: def.verb, color: COLOR_TEXT },
    { text: def.tags.join(" / "), color: COLOR_DIM },
  ];
  if (stone.variants.length === 0) lines.push({ text: "変異なし", color: COLOR_DIM });
  for (const v of stone.variants) lines.push({ text: formatVariant(v, def), color: COLOR_TEXT });
  if (stone.dwell !== undefined) lines.push({ text: dwellLine(stone.dwell, def), color: STONE_TUNING.dwellColor });
  return lines;
}

/** 本文（削ってよい側）と、必ず残す末尾（装備中との差） */
export interface DropTipContent {
  body: TipLine[];
  tail: TipLine[];
}

/** 刻印符: 名前・何をするか（付けるスキルが決まっていないので気力型の読み替えはしない） */
export function runeLines(key: ModifierKey): TipLine[] {
  const def = MODIFIERS[key];
  return [
    { text: `刻印符: ${def.name}`, color: COLOR_RUNE },
    { text: def.verb, color: COLOR_TEXT },
  ];
}

export function dropTipContent(state: GameState, drop: FocusedDrop): DropTipContent {
  if (drop.kind === "stone") return { body: stoneLines(drop.stone, currentForm(state).key), tail: [] };
  if (drop.kind === "rune") return { body: runeLines(drop.modifier), tail: [] };
  return { body: itemTipLines(state, drop.item), tail: compareLines(state, drop.item) };
}

/** 画面に入る行数に合わせ、本文の後ろを削って末尾を必ず残す。削ったら本文の最後を「…」にする */
export function fitTipLines(body: readonly TipLine[], tail: readonly TipLine[], maxLines: number): TipLine[] {
  if (body.length + tail.length <= maxLines) return [...body, ...tail];
  const keepTail = tail.slice(0, Math.max(0, maxLines - 1));
  const room = Math.max(0, maxLines - keepTail.length - 1);
  return [...body.slice(0, room), { text: "…", color: COLOR_DIM }, ...keepTail].slice(0, maxLines);
}

/**
 * ポップアップの位置。カーソルの右下に置き、画面の右端 / 下端を越えるなら左 / 上へ反転する。
 * 反転しても入らないときは画面内に押し込む
 */
export function placeTooltip(anchor: Vec, w: number, h: number): Rect {
  const rightX = anchor.x + TIP_OFFSET;
  const x = rightX + w <= VIEW_W - SCREEN_MARGIN ? rightX : anchor.x - TIP_OFFSET - w;
  const belowY = anchor.y + TIP_OFFSET;
  const y = belowY + h <= VIEW_H - SCREEN_MARGIN ? belowY : anchor.y - TIP_OFFSET - h;
  return {
    x: clamp(x, SCREEN_MARGIN, VIEW_W - SCREEN_MARGIN - w),
    y: clamp(y, SCREEN_MARGIN, VIEW_H - SCREEN_MARGIN - h),
    w,
    h,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 画面の高さに入る行数 */
export function maxTipLines(lineH: number): number {
  return Math.max(1, Math.floor((VIEW_H - SCREEN_MARGIN * 2 - TIP_PAD_Y * 2) / lineH));
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

/** キー案内の動詞（注目中の物の種類から） */
export function focusVerb(focus: Readonly<InteractFocus>): string {
  return focus.kind === "pedestal" ? PEDESTAL_VERB_LABEL[pedestalVerb(focus.target)] : PICK_UP_VERB;
}

/** キー案内「G: 買う」。手が届かなければ「近づいて買う」 */
export function focusHint(focus: Readonly<InteractFocus>): string {
  const verb = focusVerb(focus);
  return focus.inReach ? `${actionKeyLabel("interact")}: ${verb}` : `近づいて${verb}`;
}

/**
 * 注目中の物に環とキー案内を描き、遺物・スキル石ならカーソル横に性能を出す。
 * ox / oy は renderer のワールド → 画面の平行移動（ここは translate の外で呼ぶ）。
 * showTooltip: false（設定 dropTooltip オフ）のときは性能ポップアップだけ省く。環とキー案内は残す
 */
export function drawDropFocus(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  aimScreen: Vec | null,
  ox: number,
  oy: number,
  showTooltip = true,
): void {
  if (state.status !== "playing" || state.boonChoice) return;
  const focus = focusedInteract(state, aimWorldOf(state, aimScreen));
  if (focus === null) return;
  const screen = { x: Math.round(focus.pos.x + ox), y: Math.round(focus.pos.y + oy) };
  drawFocusRing(ctx, screen, focus.inReach, focusHint(focus));
  if (showTooltip && focus.kind !== "pedestal") drawTooltip(ctx, dropTipContent(state, focus), aimScreen ?? screen);
}

function drawFocusRing(ctx: CanvasRenderingContext2D, at: Vec, inReach: boolean, hint: string): void {
  ctx.globalAlpha = FOCUS_RING_ALPHA;
  ctx.strokeStyle = inReach ? FOCUS_RING_COLOR : COLOR_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(at.x + 0.5, at.y + 0.5, FOCUS_RING_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawTextShadow(ctx, hint, at.x, at.y + HINT_OFFSET_Y, TEXT.SMALL, inReach ? COLOR_TEXT : COLOR_DIM, COLOR_HINT_SHADOW, "center");
}

function drawTooltip(ctx: CanvasRenderingContext2D, content: DropTipContent, anchor: Vec): void {
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const maxWidth = DROP_TIP_W - TEXT_PAD_X * 2;
  const body = wrapTipLines(content.body, maxWidth, m);
  const tail = wrapTipLines(content.tail, maxWidth, m);
  const lines = fitTipLines(body, tail, maxTipLines(lineH));
  const rect = placeTooltip(anchor, DROP_TIP_W, lines.length * lineH + TIP_PAD_Y * 2);
  fillRectPx(ctx, rect, COLOR_PANEL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  let y = rect.y + TIP_PAD_Y + lineH;
  for (const line of lines) {
    drawTipLine(ctx, line, rect.x + TEXT_PAD_X, y, maxWidth, m);
    y += lineH;
  }
}
