/**
 * 武器掛けの画面（DOM 非依存）。武器種をカードの格子で並べ、右の欄で試し打ち用の資源（生命・気力・奥義ゲージ）を調整する。
 * 3 段: 群（近接・銃・投擲物）→ 武器種 → 器（銃・投擲物の弾の性質。例: 銃 → 長銃 → 小銃）。
 * 器が 1 つしかない武器種は器の段を開かず、その器で試す（データから決まる）。
 * 状態と当たり判定と入力の解釈だけを持ち、試す・借りる・資源を書くのは main.ts が system/hub.ts を呼んで行う。
 * 描画は src/render/rackUi.ts（読むだけ）
 */
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { MOVESETS, MOVESET_KEYS, type MovesetKey, WEAPON_GROUPS, type WeaponGroup, isRangedWeapon, weaponGroup } from "../data/weapons";
import { baseHasBullet, bulletDef, rangedBasesOf } from "../loot/bullets";
import { baseDef } from "../loot/bases";
import { bulletFeatureTexts } from "../meta/weaponText";
// system/hub は型だけ読む（値を読むとテストで system の初期化順の輪に入る）
import type { HubResource } from "../system/hub";

/**
 * カードの種類。clear = 装備のまま（試用を外す）/ group = 群（決定で武器種の段を開く）/
 * moveset = 武器種（決定で試す。近接と、器が 1 つだけの銃・投擲物）/
 * family = 器が 2 つ以上ある銃・投擲物の武器種（決定で器の段を開く）/ base = その器（決定で試す）/ back = 1 段上へ戻る
 */
export type RackCardKind = "clear" | "group" | "moveset" | "family" | "base" | "back";

export interface RackCard {
  kind: RackCardKind;
  /** 絵と説明に使う武器種（clear・back は null。group は群の代表の武器種） */
  moveset: MovesetKey | null;
  /** 群のカードだけ。他は null */
  group: WeaponGroup | null;
  /** 器の key（base と、器が 1 つだけの moveset のカード。他は null） */
  base: string | null;
  name: string;
  /** 試用中（group は群のどれかの武器種を、family は家系のどれかの器を試している） */
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
  /** 開いている群（武器種の段か器の段を出している）。null = 群の段 */
  group: WeaponGroup | null;
  /** 開いている武器種（器の段を出している）。null = 群の段か武器種の段 */
  family: MovesetKey | null;
}

export function createRackUi(): RackUi {
  return { cursor: 0, scroll: 0, lastCard: 0, group: null, family: null };
}

/** 群の表示名（docs/GLOSSARY.md） */
export const RACK_GROUP_NAME: Readonly<Record<WeaponGroup, string>> = { melee: "近接", gun: "銃", throwing: "投擲物" };

/** 群のカードの絵に使う代表の武器種 */
const RACK_GROUP_ICON: Readonly<Record<WeaponGroup, MovesetKey>> = { melee: "sword", gun: "longarm", throwing: "thrown" };

/** 群の説明（何ができるか。数値・強さは出さない） */
const RACK_GROUP_DETAIL: Readonly<Record<WeaponGroup, string>> = {
  melee: "間合いに入って振るう武器。連撃と派生を持つ。",
  gun: "弾を撃つ武器。器ごとに弾の性質が違う。",
  throwing: "投げて当てる武器。器ごとに飛び方が違う。",
};

export const RACK_CLEAR_NAME = "装備のまま";
export const RACK_CLEAR_DETAIL = "装備中の右手の武器";
export const RACK_BACK_NAME = "戻る";
export const RACK_BACK_DETAIL = "一つ前の一覧へ戻る";
const RACK_TITLE = "武器掛け";

/** 画面の題（開いた段に応じて「武器掛け　銃　長銃」） */
export function rackTitle(ui: Readonly<Pick<RackUi, "group" | "family">>): string {
  const parts = [RACK_TITLE];
  if (ui.group !== null) parts.push(RACK_GROUP_NAME[ui.group]);
  if (ui.family !== null) parts.push(MOVESETS[ui.family].name);
  return parts.join("　");
}

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
    case "group":
      return card.group === null ? "" : RACK_GROUP_DETAIL[card.group];
    case "moveset":
    case "family":
      return card.moveset === null ? "" : rackMovesetDetail(card.moveset);
  }
}

/** 器の段を開く武器種か（器が 2 つ以上ある銃・投擲物。1 つだけならその器で試す） */
export function rackOpensBases(moveset: MovesetKey): boolean {
  return isRangedWeapon(MOVESETS[moveset]) && rangedBasesOf(moveset).length > 1;
}

/**
 * 今の段のカード。群の段は「装備のまま」+ 群 3 枚、武器種の段は「戻る」+ その群の武器種（MOVESET_KEYS の順）、
 * 器の段は「戻る」+ その武器種の器（一番早く出る順）
 */
export function rackCards(trial: Readonly<RackTrial>, group: WeaponGroup | null = null, family: MovesetKey | null = null): RackCard[] {
  if (family !== null) return baseCards(trial, family);
  return group === null ? groupCards(trial) : movesetCards(trial, group);
}

function backCard(): RackCard {
  return { kind: "back", moveset: null, group: null, base: null, name: RACK_BACK_NAME, marked: false };
}

function groupCards(trial: Readonly<RackTrial>): RackCard[] {
  const clear: RackCard = { kind: "clear", moveset: null, group: null, base: null, name: RACK_CLEAR_NAME, marked: trial.moveset === null };
  const trialGroup = trial.moveset === null ? null : weaponGroup(MOVESETS[trial.moveset]);
  const cards = WEAPON_GROUPS.map(
    (g): RackCard => ({ kind: "group", moveset: RACK_GROUP_ICON[g], group: g, base: null, name: RACK_GROUP_NAME[g], marked: trialGroup === g }),
  );
  return [clear, ...cards];
}

function movesetCards(trial: Readonly<RackTrial>, group: WeaponGroup): RackCard[] {
  const keys = MOVESET_KEYS.filter((k) => weaponGroup(MOVESETS[k]) === group);
  const cards = keys.map((k): RackCard => {
    const kind: RackCardKind = rackOpensBases(k) ? "family" : "moveset";
    // 器が 1 つだけの武器種は、その器を指定して試す（借りるときも同じ器）
    const base = kind === "moveset" && isRangedWeapon(MOVESETS[k]) ? (rangedBasesOf(k)[0]?.key ?? null) : null;
    return { kind, moveset: k, group: null, base, name: MOVESETS[k].name, marked: trial.moveset === k };
  });
  return [backCard(), ...cards];
}

function baseCards(trial: Readonly<RackTrial>, family: MovesetKey): RackCard[] {
  const bases = rangedBasesOf(family);
  // 器を指定せずに試しているときは、試しに使っている一番早く出る器に印を付ける
  const markedBase = trial.moveset === family ? (trial.base ?? bases[0]?.key ?? null) : null;
  const cards = bases.map((b): RackCard => ({ kind: "base", moveset: family, group: null, base: b.key, name: b.name, marked: b.key === markedBase }));
  return [backCard(), ...cards];
}

const NO_TRIAL: RackTrial = { moveset: null, base: null };

/** 段を開いた・閉じたあとのカーソル（`cursor` のカード）と表示の先頭を合わせる */
function placeCursor(ui: RackUi, cursor: number): void {
  ui.cursor = cursor;
  ui.lastCard = cursor;
  ui.scroll = 0;
  scrollToCursor(ui, rackCards(NO_TRIAL, ui.group, ui.family).length);
}

/** 群の段から武器種の段を開く（カーソルは最初の武器種） */
export function openRackGroup(ui: RackUi, group: WeaponGroup): void {
  ui.group = group;
  ui.family = null;
  placeCursor(ui, 1);
}

/** 武器種の段から器の段を開く（カーソルは最初の器）。群は武器種のものに合わせる */
export function openRackFamily(ui: RackUi, family: MovesetKey): void {
  ui.group = weaponGroup(MOVESETS[family]);
  ui.family = family;
  placeCursor(ui, 1);
}

/** 1 段上へ戻る（カーソルは開いた元のカード）。群の段なら何もしない */
export function closeRackLevel(ui: RackUi): void {
  if (ui.family !== null) {
    const family = ui.family;
    ui.family = null;
    placeCursor(ui, rackCards(NO_TRIAL, ui.group).findIndex((c) => c.moveset === family));
    return;
  }
  const group = ui.group;
  if (group === null) return;
  ui.group = null;
  placeCursor(ui, rackCards(NO_TRIAL).findIndex((c) => c.group === group));
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
  /** moveset が null = 装備のままに戻す。base は銃・投擲物の器 */
  | { kind: "try"; moveset: MovesetKey | null; base: string | null }
  /** 群の武器種の段を開く */
  | { kind: "openGroup"; group: WeaponGroup }
  /** 銃・投擲物の武器種の器の段を開く */
  | { kind: "open"; moveset: MovesetKey }
  /** 1 段上へ戻る */
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
    case "group":
      return card.group === null ? NONE : { kind: "openGroup", group: card.group };
    case "family":
      return card.moveset === null ? NONE : { kind: "open", moveset: card.moveset };
    case "moveset":
    case "base":
      return { kind: "try", moveset: card.moveset, base: card.base };
  }
}

/** 長押しで借りられるカードか（近接と器 1 つの武器種、器のカード。群と器が複数ある武器種のカードは借りない） */
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
