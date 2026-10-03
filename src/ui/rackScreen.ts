/**
 * 武器掛けの画面（DOM 非依存）。武器種をカードの格子で並べ、右の欄で試し打ち用の資源（生命・気力・奥義ゲージ）を調整する。
 * 銃・投擲物は器ごとに弾の性質が違うので 2 段にする（武器種のカード → その武器種の器のカード。例: 長銃 → 小銃）。
 * 状態と当たり判定と入力の解釈だけを持ち、試す・借りる・資源を書くのは main.ts が system/hub.ts を呼んで行う。
 * 描画は src/render/rackUi.ts（読むだけ）
 */
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, isRangedWeapon } from "../data/weapons";
import { baseHasBullet, bulletDef, rangedBasesOf } from "../loot/bullets";
import { baseDef } from "../loot/bases";
import { bulletFeatureTexts } from "../meta/weaponText";
// system/hub は型だけ読む（値を読むとテストで system の初期化順の輪に入る）
import type { HubResource } from "../system/hub";

/**
 * カードの種類。clear = 装備のまま（試用を外す）/ moveset = 近接の武器種（決定で試す）/
 * family = 銃・投擲物の武器種（決定で器の段を開く）/ base = その器（決定で試す）/ back = 器の段から武器種の段へ戻る
 */
export type RackCardKind = "clear" | "moveset" | "family" | "base" | "back";

export interface RackCard {
  kind: RackCardKind;
  /** 絵と説明に使う武器種（clear・back は null） */
  moveset: MovesetKey | null;
  /** 器の key（base のカードだけ。他は null） */
  base: string | null;
  name: string;
  /** 試用中（family は家系のどれかの器を試している） */
  marked: boolean;
}

/** 今試しているもの（moveset が null = 装備のまま。base は銃の家系の器。null は家系の一番早く出る器） */
export interface RackTrial {
  moveset: MovesetKey | null;
  base: string | null;
}

/** 調整欄の行（資源 3 行 + 全快） */
export type RackAdjustRow = HubResource | "fill";

export const RACK_ADJUST_ROWS: readonly RackAdjustRow[] = ["hp", "mana", "energy", "fill"];

/**
 * cursor: 0..カード数-1 はカード、カード数以降は調整欄の行（カード数 + RACK_ADJUST_ROWS の添字）。
 * scroll: 格子の表示の先頭の段。lastCard: 調整欄から ↑ で戻るカード
 */
export interface RackUi {
  cursor: number;
  scroll: number;
  lastCard: number;
  /** 開いている銃の家系（器の段を出している）。null = 武器種の段 */
  family: MovesetKey | null;
}

export function createRackUi(): RackUi {
  return { cursor: 0, scroll: 0, lastCard: 0, family: null };
}

export const RACK_CLEAR_NAME = "装備のまま";
export const RACK_CLEAR_DETAIL = "装備中の右手の武器";
export const RACK_BACK_NAME = "戻る";
export const RACK_BACK_DETAIL = "武器種の一覧へ戻る";

/** 武器種の説明（派生の名前を添える。試す・借りるの仕組みは Tips ノート） */
export function rackMovesetDetail(key: MovesetKey): string {
  const def = MOVESETS[key];
  const branches = def.branches.map((b) => b.name);
  const branchText = branches.length > 0 ? ` 派生: ${branches.join("・")}。` : "";
  return `${def.desc}。${branchText}`.trim();
}

/** 器の説明（その器の弾の性質。数値は出さない）。弾を持たない器（今は戦輪）は武器種の説明 */
export function rackBaseDetail(baseKey: string): string {
  const base = baseDef(baseKey);
  if (base?.moveset !== undefined && !baseHasBullet(base)) return rackMovesetDetail(base.moveset);
  const name = base?.name ?? baseKey;
  return `${name}の弾: ${bulletFeatureTexts(bulletDef(baseKey)).join("・")}。`;
}

export function rackCardDetail(card: RackCard): string {
  switch (card.kind) {
    case "clear":
      return RACK_CLEAR_DETAIL;
    case "back":
      return RACK_BACK_DETAIL;
    case "base":
      return card.base === null ? "" : rackBaseDetail(card.base);
    case "moveset":
    case "family":
      return card.moveset === null ? "" : rackMovesetDetail(card.moveset);
  }
}

/**
 * 今の段のカード。武器種の段は「装備のまま」+ 全武器種（銃の家系を含む。MOVESET_KEYS の順で自動で並ぶ）、
 * 器の段は「戻る」+ その家系の器（一番早く出る順）
 */
export function rackCards(trial: Readonly<RackTrial>, family: MovesetKey | null = null): RackCard[] {
  return family === null ? movesetCards(trial) : familyCards(trial, family);
}

function movesetCards(trial: Readonly<RackTrial>): RackCard[] {
  const clear: RackCard = { kind: "clear", moveset: null, base: null, name: RACK_CLEAR_NAME, marked: trial.moveset === null };
  const cards = MOVESET_KEYS.map(
    (k): RackCard => ({ kind: isRangedWeapon(MOVESETS[k]) ? "family" : "moveset", moveset: k, base: null, name: MOVESETS[k].name, marked: trial.moveset === k }),
  );
  return [clear, ...cards];
}

function familyCards(trial: Readonly<RackTrial>, family: MovesetKey): RackCard[] {
  const bases = rangedBasesOf(family);
  // 器を指定せずに試しているときは、試しに使っている一番早く出る器に印を付ける
  const markedBase = trial.moveset === family ? (trial.base ?? bases[0]?.key ?? null) : null;
  const back: RackCard = { kind: "back", moveset: null, base: null, name: RACK_BACK_NAME, marked: false };
  const cards = bases.map((b): RackCard => ({ kind: "base", moveset: family, base: b.key, name: b.name, marked: b.key === markedBase }));
  return [back, ...cards];
}

/** 武器種の段のカードの並びでの、その武器種のカードの添字（先頭は「装備のまま」） */
function movesetCardIndex(moveset: MovesetKey): number {
  return MOVESET_KEYS.indexOf(moveset) + 1;
}

/** 銃の家系の器の段を開く（カーソルは最初の器） */
export function openRackFamily(ui: RackUi, family: MovesetKey): void {
  ui.family = family;
  ui.cursor = 1;
  ui.lastCard = 1;
  ui.scroll = 0;
}

/** 器の段を閉じて武器種の段へ戻る（カーソルは開いた家系のカード） */
export function closeRackFamily(ui: RackUi): void {
  const family = ui.family;
  if (family === null) return;
  ui.family = null;
  ui.cursor = movesetCardIndex(family);
  ui.lastCard = ui.cursor;
  ui.scroll = 0;
  scrollToCursor(ui, MOVESET_KEYS.length + 1);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID_X = 8;
const GRID_TOP = 26;
const COLS = 6;
const CARD_W = 48;
const CARD_H = 42;
const CARD_GAP = 4;
const PANEL_GAP = 8;
const BOTTOM_MARGIN = 22;
const ADJUST_ROW_H = 14;
const ADJUST_BUTTON_W = 12;
const ADJUST_BUTTON_H = 11;
const ADJUST_LABEL_W = 44;

const GRID_W = COLS * CARD_W + (COLS - 1) * CARD_GAP;
const GRID_BOTTOM = VIEW_H - BOTTOM_MARGIN;
const PANEL_X = GRID_X + GRID_W + PANEL_GAP;

/** 480x270 の論理座標での配置（6 列 × 見える段。右に説明と調整欄） */
export const RACK_LAYOUT = {
  titleY: 12,
  hintY: VIEW_H - 8,
  cols: COLS,
  gridX: GRID_X,
  gridTop: GRID_TOP,
  gridBottom: GRID_BOTTOM,
  cardW: CARD_W,
  cardH: CARD_H,
  cardGap: CARD_GAP,
  panelX: PANEL_X,
  panelW: VIEW_W - GRID_X - PANEL_X,
  panelTop: GRID_TOP,
  adjustRowH: ADJUST_ROW_H,
  /** 調整欄の先頭の行の上端（欄は格子の下端に揃える） */
  adjustTop: GRID_BOTTOM - RACK_ADJUST_ROWS.length * ADJUST_ROW_H,
  adjustLabelW: ADJUST_LABEL_W,
  buttonW: ADJUST_BUTTON_W,
  buttonH: ADJUST_BUTTON_H,
} as const;

/** 1 画面に見える段の数 */
export function rackVisibleRows(): number {
  return Math.max(1, Math.floor((GRID_BOTTOM - GRID_TOP + CARD_GAP) / (CARD_H + CARD_GAP)));
}

function rowCount(cardCount: number): number {
  return Math.ceil(cardCount / COLS);
}

function maxScroll(cardCount: number): number {
  return Math.max(0, rowCount(cardCount) - rackVisibleRows());
}

/** カードの矩形。表示範囲の外（スクロールで隠れている）なら null */
export function rackCardRect(index: number, scroll: number): Rect | null {
  const row = Math.floor(index / COLS) - scroll;
  if (row < 0 || row >= rackVisibleRows()) return null;
  const col = index % COLS;
  return { x: GRID_X + col * (CARD_W + CARD_GAP), y: GRID_TOP + row * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H };
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** (x, y) にあるカードの添字。無ければ null */
export function rackCardAt(x: number, y: number, cardCount: number, scroll: number): number | null {
  if (x < GRID_X || y < GRID_TOP) return null;
  const col = Math.floor((x - GRID_X) / (CARD_W + CARD_GAP));
  const row = Math.floor((y - GRID_TOP) / (CARD_H + CARD_GAP));
  if (col >= COLS || row >= rackVisibleRows()) return null;
  const index = (row + scroll) * COLS + col;
  if (index >= cardCount) return null;
  const r = rackCardRect(index, scroll);
  return r !== null && inside(r, x, y) ? index : null;
}

/** 調整欄の行の矩形（row は RACK_ADJUST_ROWS の添字） */
export function rackAdjustRowRect(row: number): Rect {
  return { x: PANEL_X, y: RACK_LAYOUT.adjustTop + row * ADJUST_ROW_H, w: RACK_LAYOUT.panelW, h: ADJUST_ROW_H };
}

/** 資源の行の −（左）/ ＋（右）のボタン */
export function rackAdjustButtonRect(row: number, side: -1 | 1): Rect {
  const r = rackAdjustRowRect(row);
  const y = r.y + Math.floor((ADJUST_ROW_H - ADJUST_BUTTON_H) / 2);
  const x = side < 0 ? r.x + ADJUST_LABEL_W : r.x + r.w - ADJUST_BUTTON_W;
  return { x, y, w: ADJUST_BUTTON_W, h: ADJUST_BUTTON_H };
}

/** 資源の行のゲージ（− と ＋ の間） */
export function rackAdjustGaugeRect(row: number): Rect {
  const minus = rackAdjustButtonRect(row, -1);
  const plus = rackAdjustButtonRect(row, 1);
  const x = minus.x + minus.w + 2;
  return { x, y: minus.y + 1, w: plus.x - 2 - x, h: minus.h - 2 };
}

export type RackAdjustHit = { row: number; side: -1 | 0 | 1 };

/** (x, y) にある調整欄の行と、押したボタン（−: -1 / ＋: 1 / 行のほか: 0） */
export function rackAdjustAt(x: number, y: number): RackAdjustHit | null {
  for (let row = 0; row < RACK_ADJUST_ROWS.length; row++) {
    if (!inside(rackAdjustRowRect(row), x, y)) continue;
    if (RACK_ADJUST_ROWS[row] === "fill") return { row, side: 0 };
    if (inside(rackAdjustButtonRect(row, -1), x, y)) return { row, side: -1 };
    if (inside(rackAdjustButtonRect(row, 1), x, y)) return { row, side: 1 };
    return { row, side: 0 };
  }
  return null;
}

/** 1 回の −/＋ で動かす割合（上限の 10%） */
export const RACK_RESOURCE_STEP = 0.1;

export interface RackInput {
  /** ←→。-1 / 0 / 1 */
  navX: number;
  /** ↑↓。-1 / 0 / 1 */
  navY: number;
  /** ホイールの符号（表示を送る） */
  wheel: number;
  aim: Vec | null;
  /** マウスが動いた（動いたときだけホバーでカーソルを奪う） */
  aimMoved: boolean;
  click: boolean;
  confirm: boolean;
}

export type RackAction =
  | { kind: "none" }
  | { kind: "moved" }
  /** moveset が null = 装備のままに戻す。base は銃の家系の器 */
  | { kind: "try"; moveset: MovesetKey | null; base: string | null }
  /** 銃の家系の器の段を開く */
  | { kind: "open"; moveset: MovesetKey }
  /** 器の段から武器種の段へ戻る */
  | { kind: "back" }
  | { kind: "adjust"; resource: HubResource; delta: number }
  | { kind: "fill" };

const NONE: RackAction = { kind: "none" };
const MOVED: RackAction = { kind: "moved" };

/** カードを決定・クリックしたときの動き */
export function rackCardAction(card: Readonly<RackCard>): RackAction {
  switch (card.kind) {
    case "clear":
      return { kind: "try", moveset: null, base: null };
    case "back":
      return { kind: "back" };
    case "family":
      return card.moveset === null ? NONE : { kind: "open", moveset: card.moveset };
    case "moveset":
    case "base":
      return { kind: "try", moveset: card.moveset, base: card.base };
  }
}

/** 長押しで借りられるカードか（近接の武器種と銃の器。家系のカードは器を選んでから借りる） */
export function rackCardBorrowable(card: Readonly<RackCard> | null): boolean {
  return card !== null && card.moveset !== null && (card.kind === "moveset" || card.kind === "base");
}

/** カーソルが指すカード（調整欄にいれば null） */
export function rackCursorCard(ui: Readonly<RackUi>, cards: readonly RackCard[]): RackCard | null {
  return cards[ui.cursor] ?? null;
}

/** カーソルが指す調整欄の行（カードにいれば null） */
export function rackCursorAdjust(ui: Readonly<RackUi>, cardCount: number): RackAdjustRow | null {
  if (ui.cursor < cardCount) return null;
  return RACK_ADJUST_ROWS[ui.cursor - cardCount] ?? null;
}

/** キー操作で動かしたカードが見えるよう表示を送る */
function scrollToCursor(ui: RackUi, cardCount: number): void {
  if (ui.cursor >= cardCount) return;
  const row = Math.floor(ui.cursor / COLS);
  const visible = rackVisibleRows();
  if (row < ui.scroll) ui.scroll = row;
  else if (row >= ui.scroll + visible) ui.scroll = row - visible + 1;
  ui.scroll = Math.min(maxScroll(cardCount), Math.max(0, ui.scroll));
}

function setCursor(ui: RackUi, next: number, cardCount: number): boolean {
  if (next === ui.cursor) return false;
  ui.cursor = next;
  if (next < cardCount) ui.lastCard = next;
  return true;
}

/** 格子の中の ←→（右端で → は次の段の左端へ）と ↑↓（最後の段から ↓ で調整欄へ） */
function navCards(ui: RackUi, navX: number, navY: number, cardCount: number): boolean {
  const last = cardCount - 1;
  if (navX !== 0) return setCursor(ui, Math.min(last, Math.max(0, ui.cursor + navX)), cardCount);
  if (navY < 0) return ui.cursor - COLS >= 0 && setCursor(ui, ui.cursor - COLS, cardCount);
  if (navY === 0) return false;
  const below = ui.cursor + COLS;
  if (below <= last) return setCursor(ui, below, cardCount);
  // 下の段が短くて真下が空なら最後のカードへ。最後の段からは調整欄へ下りる
  const lastRow = Math.floor(last / COLS);
  if (Math.floor(ui.cursor / COLS) < lastRow) return setCursor(ui, last, cardCount);
  return setCursor(ui, cardCount, cardCount);
}

/** 調整欄の ↑↓（先頭から ↑ でカードへ戻る） */
function navAdjust(ui: RackUi, navY: number, cardCount: number): boolean {
  const row = ui.cursor - cardCount;
  if (navY < 0 && row === 0) return setCursor(ui, Math.min(cardCount - 1, ui.lastCard), cardCount);
  const next = Math.min(RACK_ADJUST_ROWS.length - 1, Math.max(0, row + navY));
  return setCursor(ui, cardCount + next, cardCount);
}

/** 調整欄の行を決定・←→・ボタンで押したときの動き（side: -1 / 1 は増減、0 は決定） */
function adjustAction(row: RackAdjustRow, side: number): RackAction {
  if (row === "fill") return side === 0 ? { kind: "fill" } : NONE;
  // 資源の行の決定はその資源を満たす（割合は呼び出し側で 0..1 に丸める）
  const delta = side === 0 ? 1 : side * RACK_RESOURCE_STEP;
  return { kind: "adjust", resource: row, delta };
}

function stepWheel(ui: RackUi, wheel: number, cardCount: number): void {
  if (wheel === 0) return;
  ui.scroll = Math.min(maxScroll(cardCount), Math.max(0, ui.scroll + Math.sign(wheel)));
}

function stepHover(ui: RackUi, input: RackInput, cardCount: number): boolean {
  if (!input.aimMoved || input.aim === null) return false;
  const card = rackCardAt(input.aim.x, input.aim.y, cardCount, ui.scroll);
  if (card !== null) return setCursor(ui, card, cardCount);
  const adjust = rackAdjustAt(input.aim.x, input.aim.y);
  return adjust !== null && setCursor(ui, cardCount + adjust.row, cardCount);
}

function stepClick(ui: RackUi, aim: Vec, cards: readonly RackCard[]): RackAction | null {
  const card = rackCardAt(aim.x, aim.y, cards.length, ui.scroll);
  if (card !== null) {
    setCursor(ui, card, cards.length);
    const picked = cards[card];
    return picked === undefined ? NONE : rackCardAction(picked);
  }
  const adjust = rackAdjustAt(aim.x, aim.y);
  const row = adjust === null ? undefined : RACK_ADJUST_ROWS[adjust.row];
  if (adjust === null || row === undefined) return null;
  setCursor(ui, cards.length + adjust.row, cards.length);
  // 資源の行はボタンだけが増減する（行の名前やゲージのクリックは選ぶだけ）
  return row !== "fill" && adjust.side === 0 ? MOVED : adjustAction(row, adjust.side);
}

function stepConfirm(ui: RackUi, cards: readonly RackCard[]): RackAction {
  const card = rackCursorCard(ui, cards);
  if (card !== null) return rackCardAction(card);
  const row = rackCursorAdjust(ui, cards.length);
  return row === null ? NONE : adjustAction(row, 0);
}

/**
 * 1 フレームの入力を解釈する。ホイールは表示を 1 段送るだけでカーソルは動かさない。
 * ホバーはマウスが動いたときだけカーソルを奪う（キー操作を上書きしないため）
 */
export function stepRack(ui: RackUi, cards: readonly RackCard[], input: RackInput): RackAction {
  const count = cards.length;
  if (count === 0) return NONE;
  stepWheel(ui, input.wheel, count);
  let moved = stepHover(ui, input, count);
  const inAdjust = ui.cursor >= count;
  if (inAdjust && input.navX !== 0) {
    const row = rackCursorAdjust(ui, count);
    if (row !== null) return adjustAction(row, Math.sign(input.navX));
  }
  const navMoved = inAdjust ? navAdjust(ui, input.navY, count) : navCards(ui, input.navX, input.navY, count);
  if (navMoved) scrollToCursor(ui, count);
  moved = moved || navMoved;
  if (input.click && input.aim !== null) {
    const clicked = stepClick(ui, input.aim, cards);
    if (clicked !== null) return clicked;
  }
  if (input.confirm) return stepConfirm(ui, cards);
  return moved ? MOVED : NONE;
}
