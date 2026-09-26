import type { Element } from "../core/element";
import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import { formatMeters } from "../core/units";
import { ULTIMATES, type UltimateDef, type UltimateKind } from "../data/ultimates";
import { PLAYER } from "../data/tuning";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { chooseUltimate, saveProfile, ultimateChoice } from "../loot/profile";
import type { AttrKey, PlayerStats } from "../loot/types";
import { dashCooldownTime } from "../system/player";
import { formatCooldown } from "../system/skills";
import { ALLOC_BUTTON, ALLOC_ORDER, updateAllocButtons } from "./attributeAlloc";
import { type EffectRow, runEffectRows } from "./effectsList";
import { COLUMN_GAP, CONTENT_BOTTOM, CONTENT_RIGHT, CONTENT_Y, LIST_X, type Point, type Rect, clamp, pointInRect } from "./inventoryLayout";

/**
 * 装備画面のステータスタブ（レイアウト・当たり判定・入力。DOM 非依存）。
 * 左: ジョブ・ステータス（ラン中は振り分けの「+」）・体の性能の派生値。右: 奥義の 3 枚のカード。
 * 奥義は拠点（state.sandbox）でだけ選べる。リプレイは開始時の奥義の写しを取るので、ラン中に変えると再生とずれる
 * 単一の強さの指標（DPS・スコア）は出さない（docs/DESIGN_PRINCIPLES.md）
 */

// ---------------------------------------------------------------------------
// レイアウト
// ---------------------------------------------------------------------------

const LEFT_W = 196;
const HEAD_H = 12;
const SECTION_GAP = 4;
const SECTION_HEAD_H = 11;
/** 派生値の 1 行の高さ */
export const DERIVED_ROW_H = 10;
const ULT_HEAD_H = 13;
const ARROW_W = 16;
const CARD_GAP = 3;

export interface StatusCardLayout {
  def: UltimateDef;
  index: number;
  rect: Rect;
}

export interface StatusTabLayout {
  left: Rect;
  right: Rect;
  /** ジョブ名と未振り点の行 */
  head: Rect;
  /** ステータス 5 行（「+」の当たり判定は attributeAlloc.allocButtonRect がこの枠から出す） */
  attrPanel: Rect;
  derivedHead: Rect;
  derivedRows: Rect[];
  /** 奥義の見出し（武器種名） */
  ultHead: Rect;
  /** 武器種を送るボタン。拠点でだけ出す（ラン中は null） */
  prev: Rect | null;
  next: Rect | null;
  moveset: MovesetKey;
  cards: StatusCardLayout[];
}

/** ステータス一覧の枠（左の列、見出しの下） */
export function statusAttrPanelRect(): Rect {
  return { x: LIST_X, y: CONTENT_Y + HEAD_H + 2, w: LEFT_W, h: ALLOC_ORDER.length * ALLOC_BUTTON.rowH };
}

// ---------------------------------------------------------------------------
// 効果の頁（状態異常・祝福・芯・一時強化。拾うキーでステータスの頁と切り替える）
// ---------------------------------------------------------------------------

/** 効果の頁の一覧の枠（見出しの下、左右いっぱい） */
export function effectsPanelRect(): Rect {
  const y = CONTENT_Y + HEAD_H + 2;
  return { x: LIST_X, y, w: CONTENT_RIGHT - LIST_X, h: CONTENT_BOTTOM - y };
}

/** 1 件の高さ（名前+情報の行 + 説明 1 行ぶん） */
export const EFFECTS_ROW_H = 22;

export function effectsVisibleRows(rect: Rect): number {
  return Math.max(1, Math.floor(rect.h / EFFECTS_ROW_H));
}

export function effectsMaxScroll(count: number, rect: Rect): number {
  return Math.max(0, count - effectsVisibleRows(rect));
}

export function effectsRowRect(rect: Rect, index: number): Rect {
  return { x: rect.x, y: rect.y + index * EFFECTS_ROW_H, w: rect.w, h: EFFECTS_ROW_H };
}

/** 奥義を選べるのは拠点だけ */
export function canChooseUltimate(state: Readonly<GameState>): boolean {
  return state.sandbox === true;
}

/** 奥義の欄に出す武器種。拠点では ←→ で送った武器種、ラン中は今の右手の武器種 */
export function statusMoveset(state: Readonly<GameState>, ui: Readonly<StatusTabUi>): MovesetKey {
  if (canChooseUltimate(state) && ui.moveset !== null) return ui.moveset;
  return state.stats.moveset;
}

export function layoutStatusTab(state: Readonly<GameState>, ui: Readonly<StatusTabUi>): StatusTabLayout {
  const left: Rect = { x: LIST_X, y: CONTENT_Y, w: LEFT_W, h: CONTENT_BOTTOM - CONTENT_Y };
  const rightX = LIST_X + LEFT_W + COLUMN_GAP;
  const right: Rect = { x: rightX, y: CONTENT_Y, w: CONTENT_RIGHT - rightX, h: left.h };
  const head: Rect = { x: left.x, y: left.y, w: left.w, h: HEAD_H };
  const attrPanel = statusAttrPanelRect();
  const derivedHead: Rect = { x: left.x, y: attrPanel.y + attrPanel.h + SECTION_GAP, w: left.w, h: SECTION_HEAD_H };
  const rowsTop = derivedHead.y + derivedHead.h;
  const rowCount = Math.min(derivedStatRows(state.stats).length, Math.floor((CONTENT_BOTTOM - rowsTop) / DERIVED_ROW_H));
  const derivedRows = Array.from({ length: rowCount }, (_, i): Rect => ({ x: left.x, y: rowsTop + i * DERIVED_ROW_H, w: left.w, h: DERIVED_ROW_H }));

  const ultHead: Rect = { x: right.x, y: right.y, w: right.w, h: ULT_HEAD_H };
  const choosable = canChooseUltimate(state);
  const moveset = statusMoveset(state, ui);
  const set = ULTIMATES[moveset];
  const cardsTop = ultHead.y + ultHead.h + CARD_GAP;
  const cardH = Math.floor((CONTENT_BOTTOM - cardsTop - CARD_GAP * (set.length - 1)) / set.length);
  const cards = set.map((def, index): StatusCardLayout => ({
    def,
    index,
    rect: { x: right.x, y: cardsTop + index * (cardH + CARD_GAP), w: right.w, h: cardH },
  }));
  return {
    left,
    right,
    head,
    attrPanel,
    derivedHead,
    derivedRows,
    ultHead,
    prev: choosable ? { x: ultHead.x, y: ultHead.y, w: ARROW_W, h: ultHead.h } : null,
    next: choosable ? { x: ultHead.x + ultHead.w - ARROW_W, y: ultHead.y, w: ARROW_W, h: ultHead.h } : null,
    moveset,
    cards,
  };
}

/** 描画に使う矩形の一覧（すべてパネル内に収まることをテストで確かめる） */
export function statusTabRects(layout: Readonly<StatusTabLayout>): Rect[] {
  const rects: Rect[] = [layout.left, layout.right, layout.head, layout.attrPanel, layout.derivedHead, ...layout.derivedRows, layout.ultHead];
  if (layout.prev) rects.push(layout.prev);
  if (layout.next) rects.push(layout.next);
  for (const card of layout.cards) rects.push(card.rect);
  return rects;
}

// ---------------------------------------------------------------------------
// 派生値（体の性能。ステータスから伸びるもの）
// ---------------------------------------------------------------------------

export interface DerivedStatRow {
  label: string;
  value: string;
  /** 伸ばすステータス（色分け用。ステータスに依らなければ null） */
  attr: AttrKey | null;
}

const PERCENT = 100;
const PER_SECOND = "/秒";
const REGEN_DIGITS = 1;

function percent(mul: number): string {
  return `${Math.round(mul * PERCENT)}%`;
}

/** 左の列の派生値。値は今の stats（装備・共鳴・祝福・振り分けを畳み込んだ後）から読む */
export function derivedStatRows(stats: Readonly<PlayerStats>): DerivedStatRow[] {
  return [
    { label: "最大生命", value: `${Math.round(stats.maxHp)}`, attr: "vit" },
    { label: "被る状態異常の持続", value: percent(stats.statusTakenMul), attr: "vit" },
    { label: "最大気力", value: `${Math.round(stats.maxMana)}`, attr: "mnd" },
    { label: "気力の自然回復", value: `${Number(stats.manaRegen.toFixed(REGEN_DIGITS))}${PER_SECOND}`, attr: "mnd" },
    { label: "移動速度", value: `${formatMeters(PLAYER.speed * stats.moveSpeedMul)}${PER_SECOND}`, attr: "dex" },
    { label: "ダッシュ再使用", value: formatCooldown(dashCooldownTime(stats)), attr: "dex" },
    { label: "防御力", value: `${Math.round(stats.armor)}`, attr: null },
    { label: "魔防", value: `${Math.round(stats.warding)}`, attr: null },
    { label: "耐性 炎/氷/雷", value: resistTriple(stats, "fire", "ice", "lightning"), attr: null },
    { label: "耐性 毒/闇/光", value: resistTriple(stats, "poison", "dark", "light"), attr: null },
  ];
}

/** 「12/-5/0%」。3 属性の耐性 %（PlayerStats.resist）をまとめて 1 行に出す */
function resistTriple(stats: Readonly<PlayerStats>, a: Element, b: Element, c: Element): string {
  return `${Math.round(stats.resist[a])}/${Math.round(stats.resist[b])}/${Math.round(stats.resist[c])}%`;
}

/** 奥義の種類の表示名（docs/GLOSSARY.md「一撃 / 持続」） */
export const ULTIMATE_KIND_LABEL: Readonly<Record<UltimateKind, string>> = { instant: "一撃", sustain: "持続" };

/** 奥義の必要ゲージ。定義に cost が無い版（別レーンの導入前）でも読めるよう、有るときだけ返す */
export function ultimateCostOf(def: UltimateDef): number | null {
  if (!("cost" in def)) return null;
  const cost: unknown = def.cost;
  return typeof cost === "number" ? cost : null;
}

// ---------------------------------------------------------------------------
// 状態と入力
// ---------------------------------------------------------------------------

export interface StatusTabUi {
  /** 奥義の欄で見ている武器種（null = 今の右手の武器種）。拠点でだけ ←→ で送る */
  moveset: MovesetKey | null;
  /** キー・パッドで選んでいるカード */
  cursor: number;
  hoverCard: number;
  /** 武器種の送り（-1 = 前 / 1 = 次 / 0 = なし） */
  hoverArrow: number;
  /** マウスが乗っている「+」の行（-1 = なし） */
  hoverAlloc: number;
  /** 移動入力のエッジ検出用（前フレームの向き） */
  navX: number;
  navY: number;
  /** 効果の頁（状態異常・祝福・芯・一時強化）を見せているか。拾うキーでステータスの頁と切り替える */
  effectsPage: boolean;
  effectsScroll: number;
}

export function createStatusTabUi(): StatusTabUi {
  return { moveset: null, cursor: 0, hoverCard: -1, hoverArrow: 0, hoverAlloc: -1, navX: 0, navY: 0, effectsPage: false, effectsScroll: 0 };
}

export function clearStatusHover(ui: StatusTabUi): void {
  ui.hoverCard = -1;
  ui.hoverArrow = 0;
  ui.hoverAlloc = -1;
}

const EFFECTS_PAGE_TEXT = "効果: 状態異常・祝福・芯・一時強化（ラン中のみ）";
const STATUS_PAGE_TEXT = "ステータス";

/** 効果の頁とステータスの頁を切り替える。見出しに出すメッセージを返す */
function toggleEffectsPage(ui: StatusTabUi): string {
  ui.effectsPage = !ui.effectsPage;
  ui.effectsScroll = 0;
  return ui.effectsPage ? EFFECTS_PAGE_TEXT : STATUS_PAGE_TEXT;
}

/** 効果の頁の一覧（今の state から毎回組み立てる。読むだけ） */
export function statusTabEffectRows(state: GameState): EffectRow[] {
  return runEffectRows(state);
}

/** 効果の頁の入力: ホイール・↑↓ でスクロールするだけ（読むだけの一覧なのでカーソルは持たない） */
function updateEffectsPage(state: GameState, ui: StatusTabUi, input: FrameInput): void {
  const rect = effectsPanelRect();
  const rows = statusTabEffectRows(state);
  const maxScroll = effectsMaxScroll(rows.length, rect);
  const nav = readStatusNav(ui, input);
  ui.effectsScroll = clamp(ui.effectsScroll + input.wheel + nav.dy, 0, maxScroll);
}

const NAV_THRESHOLD = 0.5;

function axisDir(v: number): number {
  if (v > NAV_THRESHOLD) return 1;
  if (v < -NAV_THRESHOLD) return -1;
  return 0;
}

/** 移動入力を 1 マスずつの操作に変える（押した瞬間だけ -1 / 1） */
function readStatusNav(ui: StatusTabUi, input: FrameInput): { dx: number; dy: number } {
  const x = axisDir(input.move.x);
  const y = axisDir(input.move.y);
  const dx = x !== 0 && ui.navX === 0 ? x : 0;
  const dy = y !== 0 && ui.navY === 0 ? y : 0;
  ui.navX = x;
  ui.navY = y;
  return { dx, dy };
}

/** 武器種を dir だけ送る（端は反対側へ回る）。カーソルはその武器種で選んでいる奥義へ合わせる */
export function stepStatusMoveset(state: GameState, ui: StatusTabUi, dir: number): void {
  const current = statusMoveset(state, ui);
  const n = MOVESET_KEYS.length;
  const index = (MOVESET_KEYS.indexOf(current) + dir + n) % n;
  const next = MOVESET_KEYS[index] ?? current;
  ui.moveset = next;
  ui.cursor = Math.max(0, ULTIMATES[next].findIndex((d) => d.key === ultimateChoice(state.profile, next).key));
}

const RUN_LOCKED_TEXT = "ラン中は奥義を変えられない";

/** カードの奥義を選んで保存する。表示するメッセージを返す（選べなければ理由） */
export function chooseStatusCard(state: GameState, ui: StatusTabUi, index: number): string | null {
  const moveset = statusMoveset(state, ui);
  const def = ULTIMATES[moveset][index];
  if (!def) return null;
  if (!canChooseUltimate(state)) return RUN_LOCKED_TEXT;
  ui.cursor = index;
  if (ultimateChoice(state.profile, moveset).key === def.key) return null;
  if (!chooseUltimate(state.profile, moveset, def.key)) return null;
  // 拠点の state.profile は main.ts の profile と同じ物（createHub に渡している）なので、装備の付け替えと同じくここで保存する
  saveProfile(state.profile);
  pushSfx(state, "equipOn");
  return `${MOVESETS[moveset].name}の奥義: ${def.name}`;
}

function cardAt(layout: StatusTabLayout, p: Point | null): number {
  if (p === null) return -1;
  return layout.cards.find((c) => pointInRect(p, c.rect))?.index ?? -1;
}

function arrowAt(layout: StatusTabLayout, p: Point | null): number {
  if (p === null) return 0;
  if (layout.prev && pointInRect(p, layout.prev)) return -1;
  if (layout.next && pointInRect(p, layout.next)) return 1;
  return 0;
}

/**
 * ステータスタブの入力。拾うキーで効果の頁と切り替え、効果の頁ではスクロールだけを受け付ける。
 * ステータスの頁は 振り分け（「+」・スキル 1〜4 / 攻撃キー）→ 武器種の送り（拠点のみ）→ 奥義のカード。
 * 戻り値は見出しに出すメッセージ（無ければ null）
 */
export function updateStatusTab(state: GameState, ui: StatusTabUi, input: FrameInput, aimMoved: boolean): string | null {
  if (input.interactPressed) return toggleEffectsPage(ui);
  if (ui.effectsPage) {
    updateEffectsPage(state, ui, input);
    return null;
  }
  const layout = layoutStatusTab(state, ui);
  const alloc = updateAllocButtons(state, input, layout.attrPanel);
  ui.hoverAlloc = alloc.hover;
  if (alloc.used) return null;

  const aim = input.aimScreen;
  const nav = readStatusNav(ui, input);
  ui.hoverArrow = arrowAt(layout, aim);
  ui.hoverCard = cardAt(layout, aim);
  if (aimMoved && ui.hoverCard >= 0) ui.cursor = ui.hoverCard;
  ui.cursor = clamp(ui.cursor + nav.dy, 0, Math.max(0, layout.cards.length - 1));
  if (nav.dx !== 0 && canChooseUltimate(state)) {
    stepStatusMoveset(state, ui, nav.dx);
    pushSfx(state, "uiClick");
    return null;
  }
  if (input.clickPressed && ui.hoverArrow !== 0) {
    stepStatusMoveset(state, ui, ui.hoverArrow);
    pushSfx(state, "uiClick");
    return null;
  }
  if (input.clickPressed && ui.hoverCard >= 0) return chooseStatusCard(state, ui, ui.hoverCard);
  if (input.confirmPressed && !input.clickPressed) return chooseStatusCard(state, ui, ui.cursor);
  return null;
}
