/**
 * 武器指南書の画面（DOM 非依存）。左に武器種の一覧、中央に頁（特色・型と戦意・技の一覧）、右に実演の窓と技の詳しい欄。
 * 状態・配置・当たり判定・入力の解釈と、選んだ技の実演（system/manualDemo.ts）の持ち主。描画は render/weaponManualUi.ts（読むだけ）。
 * 頁の折り返しは描画の文字の幅に依るので、呼び出し側（main.ts）が wrap と行の高さを渡す
 */
import type { Vec } from "../core/vec";
import { VIEW_W } from "../core/view";
import { MANUAL } from "../data/tuning";
import type { MovesetKey } from "../data/weapons";
import { type DemoArena, buildDemoArena } from "../map/demoArena";
import { MANUAL_GROUP_LABEL, MANUAL_KEYS, type ManualMove, type ManualPage, weaponManualPage } from "../meta/weaponManual";
import { type DemoSession, calibrateFoeDistance, createManualDemo, restartManualDemo } from "../system/manualDemo";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN_X = 8;
const TOP = 24;
const BOTTOM = 250;
const COLUMN_GAP = 6;
const LIST_W = 78;
const DOC_W = 200;
const PREVIEW_H = 112;
const DETAIL_GAP = 4;

/** 画面の配置（論理座標 480x270） */
export const MANUAL_LAYOUT = {
  titleY: 12,
  hintY: 264,
  list: { x: MARGIN_X, y: TOP, w: LIST_W, h: BOTTOM - TOP },
  doc: { x: MARGIN_X + LIST_W + COLUMN_GAP, y: TOP, w: DOC_W, h: BOTTOM - TOP },
  preview: { x: MARGIN_X + LIST_W + COLUMN_GAP + DOC_W + COLUMN_GAP, y: TOP, w: VIEW_W - MARGIN_X * 2 - LIST_W - DOC_W - COLUMN_GAP * 2, h: PREVIEW_H },
  detail: {
    x: MARGIN_X + LIST_W + COLUMN_GAP + DOC_W + COLUMN_GAP,
    y: TOP + PREVIEW_H + DETAIL_GAP,
    w: VIEW_W - MARGIN_X * 2 - LIST_W - DOC_W - COLUMN_GAP * 2,
    h: BOTTOM - TOP - PREVIEW_H - DETAIL_GAP,
  },
  minRowGap: 12,
} as const;

/** 頁の 1 行。move は技の行（選べる）、group は技の一覧の見出し */
export type DocRow =
  | { readonly kind: "name"; readonly y: number; readonly h: number; readonly text: string }
  | { readonly kind: "summary"; readonly y: number; readonly h: number; readonly text: string }
  | { readonly kind: "heading"; readonly y: number; readonly h: number; readonly text: string }
  | { readonly kind: "text"; readonly y: number; readonly h: number; readonly text: string }
  | { readonly kind: "group"; readonly y: number; readonly h: number; readonly text: string }
  | { readonly kind: "move"; readonly y: number; readonly h: number; readonly index: number };

/** 頁の行（折り返し済み）。key = 武器種と行の高さ（文字の大きさが変われば組み直す） */
interface DocCache {
  key: string;
  rows: DocRow[];
  height: number;
}

export interface ManualUi {
  /** MANUAL_KEYS の添字 */
  weapon: number;
  /** 頁の技の添字 */
  move: number;
  /** 武器種の一覧の表示の先頭の行 */
  listScroll: number;
  /** 頁の表示の先頭（px） */
  docScroll: number;
  page: ManualPage;
  /** 実演中の箱庭（選んだ技が変わると作り直す） */
  demo: DemoSession | null;
  /** 実演中の技の key（`<武器種>/<技の key>`） */
  demoKey: string;
  /** 木人の距離の合わせ込みの結果（技ごとに 1 回だけ回す） */
  readonly foeDistances: Map<string, number | undefined>;
  readonly arena: DemoArena;
  doc: DocCache | null;
  /** マウスが乗っている行（強調だけ。選ぶのはクリック） */
  hoverWeapon: number | null;
  hoverMove: number | null;
}

export function createManualUi(start?: MovesetKey): ManualUi {
  const weapon = start === undefined ? 0 : Math.max(0, MANUAL_KEYS.indexOf(start));
  const key = MANUAL_KEYS[weapon] ?? "sword";
  return {
    weapon,
    move: 0,
    listScroll: 0,
    docScroll: 0,
    page: weaponManualPage(key),
    demo: null,
    demoKey: "",
    foeDistances: new Map(),
    arena: buildDemoArena(),
    doc: null,
    hoverWeapon: null,
    hoverMove: null,
  };
}

export function selectedMove(ui: Readonly<ManualUi>): ManualMove | undefined {
  return ui.page.moves[ui.move];
}

function rowGap(lineH: number): number {
  return Math.max(MANUAL_LAYOUT.minRowGap, lineH);
}

// ---------------------------------------------------------------------------
// 頁の行
// ---------------------------------------------------------------------------

/** 折り返しの関数（描画の文字の幅で折る。main.ts が render/pixelText の wrapText を渡す） */
export type WrapFn = (text: string, width: number) => string[];

/** 頁の本文の左右の余白 */
const DOC_PAD = 4;
/** 節と節の間の空き */
const SECTION_GAP = 4;

function buildDocRows(page: ManualPage, wrap: WrapFn, lineH: number): DocCache {
  const gap = rowGap(lineH);
  const width = MANUAL_LAYOUT.doc.w - DOC_PAD * 2;
  const rows: DocRow[] = [];
  let y = 0;
  const push = (row: DocRow): void => {
    rows.push(row);
    y += row.h;
  };
  push({ kind: "name", y, h: gap + 2, text: page.name });
  for (const line of wrap(page.summary, width)) push({ kind: "summary", y, h: lineH, text: line });
  for (const s of page.sections) {
    y += SECTION_GAP;
    push({ kind: "heading", y, h: gap, text: s.heading });
    for (const line of wrap(s.body, width)) push({ kind: "text", y, h: lineH, text: line });
  }
  let group = "";
  page.moves.forEach((m, index) => {
    if (m.group !== group) {
      group = m.group;
      y += SECTION_GAP;
      push({ kind: "group", y, h: gap, text: MANUAL_GROUP_LABEL[m.group] });
    }
    push({ kind: "move", y, h: gap, index });
  });
  return { key: "", rows, height: y };
}

/** 頁の行（折り返し済み。武器種か行の高さが変わったときだけ組み直す） */
export function manualDocRows(ui: ManualUi, wrap: WrapFn, lineH: number): DocCache {
  const key = `${ui.page.key}|${lineH}`;
  if (ui.doc?.key === key) return ui.doc;
  ui.doc = { ...buildDocRows(ui.page, wrap, lineH), key };
  return ui.doc;
}

function maxDocScroll(doc: DocCache): number {
  return Math.max(0, doc.height - MANUAL_LAYOUT.doc.h);
}

function moveRow(doc: DocCache, index: number): DocRow | undefined {
  return doc.rows.find((r) => r.kind === "move" && r.index === index);
}

/** 選んだ技の行が頁の窓に入るよう送る（上に見出しが 1 行見える余裕を残す） */
function revealMove(ui: ManualUi, doc: DocCache): void {
  const row = moveRow(doc, ui.move);
  if (row === undefined) return;
  const top = row.y - row.h;
  const bottom = row.y + row.h * 2;
  if (top < ui.docScroll) ui.docScroll = Math.max(0, top);
  else if (bottom > ui.docScroll + MANUAL_LAYOUT.doc.h) ui.docScroll = Math.min(maxDocScroll(doc), bottom - MANUAL_LAYOUT.doc.h);
}

// ---------------------------------------------------------------------------
// 武器種の一覧
// ---------------------------------------------------------------------------

export function listVisibleRows(lineH: number): number {
  return Math.max(1, Math.floor(MANUAL_LAYOUT.list.h / rowGap(lineH)));
}

/** 一覧の i 番目の表示行の矩形 */
export function listRowRect(i: number, lineH: number): Rect {
  const gap = rowGap(lineH);
  const l = MANUAL_LAYOUT.list;
  return { x: l.x, y: l.y + i * gap, w: l.w, h: gap };
}

function revealWeapon(ui: ManualUi, lineH: number): void {
  const visible = listVisibleRows(lineH);
  if (ui.weapon < ui.listScroll) ui.listScroll = ui.weapon;
  else if (ui.weapon >= ui.listScroll + visible) ui.listScroll = ui.weapon - visible + 1;
}

function clampListScroll(ui: ManualUi, lineH: number): void {
  ui.listScroll = Math.max(0, Math.min(MANUAL_KEYS.length - listVisibleRows(lineH), ui.listScroll));
}

// ---------------------------------------------------------------------------
// 選択
// ---------------------------------------------------------------------------

function selectWeapon(ui: ManualUi, index: number): void {
  const n = MANUAL_KEYS.length;
  ui.weapon = ((index % n) + n) % n;
  ui.page = weaponManualPage(MANUAL_KEYS[ui.weapon] ?? "sword");
  ui.move = 0;
  ui.docScroll = 0;
  ui.doc = null;
}

/** 技の行の当たり判定（頁の座標 → 技の添字） */
function moveAt(doc: DocCache, ui: Readonly<ManualUi>, p: Vec): number | null {
  const d = MANUAL_LAYOUT.doc;
  if (!inRect(p, d)) return null;
  const y = p.y - d.y + ui.docScroll;
  const row = doc.rows.find((r) => r.kind === "move" && y >= r.y && y < r.y + r.h);
  return row?.kind === "move" ? row.index : null;
}

function weaponAt(ui: Readonly<ManualUi>, p: Vec, lineH: number): number | null {
  if (!inRect(p, MANUAL_LAYOUT.list)) return null;
  const i = Math.floor((p.y - MANUAL_LAYOUT.list.y) / rowGap(lineH)) + ui.listScroll;
  return i >= 0 && i < MANUAL_KEYS.length ? i : null;
}

function inRect(p: Vec, r: Readonly<Rect>): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export interface ManualInput {
  /** ←→（武器種を替える） */
  navX: number;
  /** ↑↓（技を選ぶ） */
  navY: number;
  wheel: number;
  aim: Vec | null;
  click: boolean;
  /** 決定（実演を最初から） */
  confirm: boolean;
}

export type ManualAction = "none" | "weapon" | "move" | "restart";

/** ホイール 1 刻みで送る行数 */
const WHEEL_ROWS = 3;

/** 入力を 1 フレーム分読む。選ぶ技が変わったら実演は syncManualDemo が作り直す */
export function stepManualUi(ui: ManualUi, input: ManualInput, wrap: WrapFn, lineH: number): ManualAction {
  const doc = manualDocRows(ui, wrap, lineH);
  ui.hoverWeapon = input.aim ? weaponAt(ui, input.aim, lineH) : null;
  ui.hoverMove = input.aim ? moveAt(doc, ui, input.aim) : null;
  if (input.navX !== 0) {
    selectWeapon(ui, ui.weapon + input.navX);
    revealWeapon(ui, lineH);
    return "weapon";
  }
  if (input.navY !== 0) {
    const n = ui.page.moves.length;
    ui.move = Math.max(0, Math.min(n - 1, ui.move + input.navY));
    revealMove(ui, doc);
    return "move";
  }
  if (input.wheel !== 0) scrollByWheel(ui, doc, input, lineH);
  if (input.click && ui.hoverWeapon !== null && ui.hoverWeapon !== ui.weapon) {
    selectWeapon(ui, ui.hoverWeapon);
    return "weapon";
  }
  if (input.click && ui.hoverMove !== null && ui.hoverMove !== ui.move) {
    ui.move = ui.hoverMove;
    return "move";
  }
  if (input.confirm || (input.click && input.aim !== null && inRect(input.aim, MANUAL_LAYOUT.preview))) return "restart";
  return "none";
}

function scrollByWheel(ui: ManualUi, doc: DocCache, input: ManualInput, lineH: number): void {
  const dir = Math.sign(input.wheel);
  if (input.aim !== null && inRect(input.aim, MANUAL_LAYOUT.list)) {
    ui.listScroll += dir * WHEEL_ROWS;
    clampListScroll(ui, lineH);
    return;
  }
  ui.docScroll = Math.max(0, Math.min(maxDocScroll(doc), ui.docScroll + dir * WHEEL_ROWS * rowGap(lineH)));
}

// ---------------------------------------------------------------------------
// 実演
// ---------------------------------------------------------------------------

/**
 * 選んでいる技の実演を用意する（技が変わったときだけ作り直す）。木人の距離は技ごとに 1 回だけ合わせ込む
 * （届き・反動・弾の寿命は武器ごとに違うので、実際に回して当たる距離を選ぶ）
 */
export function syncManualDemo(ui: ManualUi, hitstopScale: number): DemoSession | null {
  const move = selectedMove(ui);
  if (move === undefined) return null;
  const key = `${ui.page.key}/${move.key}`;
  if (ui.demo !== null && ui.demoKey === key) return ui.demo;
  if (!ui.foeDistances.has(key)) ui.foeDistances.set(key, calibrateFoeDistance(ui.page.key, move.script, move.expect, ui.arena));
  const foeDistance = ui.foeDistances.get(key) ?? move.script.setup.foeDistance ?? MANUAL.foeDistance;
  ui.demo = createManualDemo(ui.page.key, { ...move.script, setup: { ...move.script.setup, foeDistance } }, hitstopScale, ui.arena);
  ui.demoKey = key;
  return ui.demo;
}

/** 実演を最初から */
export function restartManualUiDemo(ui: ManualUi): void {
  if (ui.demo !== null) restartManualDemo(ui.demo);
}

/** 実演の窓の中心（稽古場の中心。窓は稽古場を切り出す） */
export function manualPreviewCenter(ui: Readonly<ManualUi>): Vec {
  return ui.arena.center;
}
