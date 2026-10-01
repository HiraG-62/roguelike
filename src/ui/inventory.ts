import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { loadCraft, type CraftSave } from "../loot/craftingStore";
import { ACT_VIEW } from "./actPage";
import { ATTIRE_VIEW } from "./attire";
import { CANDIDATES_VIEW } from "./candidates";
import { CREST_VIEW } from "./crest";
import { FLOW_BOARD_VIEW, FLOW_VIEW } from "./flow";
import { pointInRect } from "./inventoryLayout";
import { closeMenu, focusPart, jumpToSource, menuClick, openMenu, popView, pushView, replaceTop, switchFace } from "./menuActions";
import { fid, focusedHit, hitAt, nearestInDirection } from "./menuFocus";
import { MENU_HOLD_SECONDS, primeMenuNav, readMenuNav, stepHold } from "./menuInput";
import {
  type CandidateSort,
  type FocusId,
  type InventoryUi,
  type MenuAct,
  type MenuFace,
  type MenuHit,
  type MenuSignals,
  type MenuView,
  type Rect,
  type SheetSubject,
  type ViewModule,
  NO_SIGNALS,
  rootFace,
  topView,
} from "./menuState";
import { SHEET_VIEW } from "./sheet";
import { SKILLS_VIEW } from "./skillPage";

/**
 * 装備画面の入口（docs/ideas/inventory-v2/E-impl.md 1-2）: 開閉・頁の積み重ね・入力・共通の操作の振り分け。
 * 頁の中身は各頁の ViewModule（ui/attire.ts ほか）が持ち、ここは「どの頁の部品に渡すか」だけを決める。
 * メニューは step の外で動き、state.rng を使わない（付け替えは main.ts の loadoutDirty → captureLoadout に乗る）
 */

export type { InventoryUi } from "./menuState";
export { SLOT_LABEL, type Rect } from "./inventoryLayout";

export function createInventoryUi(craft: CraftSave = loadCraft()): InventoryUi {
  return {
    open: false,
    stack: [],
    anvilSession: false,
    craft,
    sortPref: "fit",
    nav: { x: 0, y: 0, held: 0 },
    aimPrev: null,
    clickHeldPrev: false,
    hold: null,
    time: 0,
    focusAt: 0,
    note: null,
  };
}

/** 頁の部品（毎回引く。頁のファイルを読み込む順に依らないよう、表を作らず switch で引く） */
export function viewModule(view: Readonly<MenuView>): ViewModule<MenuView> {
  return moduleOf(view) as ViewModule<MenuView>;
}

function moduleOf(view: Readonly<MenuView>): unknown {
  switch (view.kind) {
    case "attire":
      return ATTIRE_VIEW;
    case "crest":
      return CREST_VIEW;
    case "candidates":
      return CANDIDATES_VIEW;
    case "flow":
      return FLOW_VIEW;
    case "flowBoard":
      return FLOW_BOARD_VIEW;
    case "skills":
      return SKILLS_VIEW;
    case "act":
      return ACT_VIEW;
    case "sheet":
      return SHEET_VIEW;
  }
}

// -----------------------------------------------------------------------------
// 殻の当たり（見出しの面の札・荷札）
// -----------------------------------------------------------------------------

/** 見出しの面の札（マウス専用。方向の移動では止まらない）。字は固定なので幅も固定 */
export const FACE_CHIPS: readonly { face: MenuFace; label: string; rect: Rect }[] = [
  { face: "attire", label: "装束", rect: { x: 8, y: 3, w: 24, h: 11 } },
  { face: "crest", label: "紋", rect: { x: 35, y: 3, w: 16, h: 11 } },
];

/** 見出しの文字の左端（面の札の右） */
export const HEADER_CRUMBS_X = 59;

/** 荷札（下の 2 行）。クリックで書付 */
export const TAG_RECT: Rect = { x: 8, y: 220, w: 464, h: 30 };

function chipHits(): MenuHit[] {
  return FACE_CHIPS.map((c) => ({ id: fid.face(c.face), rect: c.rect, act: { kind: "switchFace", face: c.face }, hold: null, nav: false }));
}

/** 今の頁の当たり（頁の部品の当たり + 面の札） */
export function menuHits(state: Readonly<GameState>, ui: Readonly<InventoryUi>): MenuHit[] {
  const top = topView(ui);
  if (top === null) return [];
  return [...viewModule(top).layout(state, ui, top), ...chipHits()];
}

// -----------------------------------------------------------------------------
// 振り分け
// -----------------------------------------------------------------------------

/** 積み重ねから外れた頁の leave を呼ぶ（操作の前後の積み重ねを参照で比べる） */
function leaveDropped(state: GameState, ui: InventoryUi, before: readonly MenuView[]): void {
  for (const view of before) {
    if (!ui.stack.includes(view)) viewModule(view).leave(state, ui, view);
  }
}

/** 頁の積み重ねを変える操作を、外れた頁の leave つきで行う */
function withLeaves(state: GameState, ui: InventoryUi, change: () => void): void {
  const before = [...ui.stack];
  change();
  leaveDropped(state, ui, before);
}

/** 決定・長押しの振り分け: 共通の操作は menuActions、それ以外は今の頁の部品 */
export function dispatchMenuAct(state: GameState, ui: InventoryUi, act: MenuAct): void {
  withLeaves(state, ui, () => applyAct(state, ui, act));
}

function applyAct(state: GameState, ui: InventoryUi, act: MenuAct): void {
  switch (act.kind) {
    case "switchFace":
      switchFace(state, ui, act.face);
      menuClick(state);
      return;
    case "push":
      pushView(ui, act.view);
      menuClick(state);
      return;
    case "replace":
      replaceTop(ui, act.view);
      menuClick(state);
      return;
    case "jump":
      jumpToSource(state, ui, act.source);
      menuClick(state);
      return;
    case "focusPart":
      focusPart(ui, act.slot);
      menuClick(state);
      return;
    default: {
      const top = topView(ui);
      if (top !== null) viewModule(top).act(state, ui, top, act);
    }
  }
}

/** 戻る: 頁の中の戻り → 1 段戻る → 1 段目なら閉じる */
function goBack(state: GameState, ui: InventoryUi): void {
  const top = topView(ui);
  if (top === null) return;
  if (viewModule(top).back(state, ui, top)) return;
  withLeaves(state, ui, () => {
    if (ui.stack.length > 1) popView(ui);
    else closeMenu(state, ui);
  });
}

function setFocus(ui: InventoryUi, view: MenuView, id: FocusId): void {
  if (view.focus === id) return;
  view.focus = id;
  ui.focusAt = ui.time;
}

// -----------------------------------------------------------------------------
// 入力
// -----------------------------------------------------------------------------

function tickNote(ui: InventoryUi, dt: number): void {
  if (ui.note === null) return;
  ui.note.t -= dt;
  if (ui.note.t <= 0) ui.note = null;
}

function sameAim(a: Vec | null, b: Vec | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

/** マウスが実際に動いたときだけ、その下の当たりへ焦点を移す（ホイールやキーの焦点を奪わない） */
function followMouse(ui: InventoryUi, view: MenuView, hits: readonly MenuHit[], aim: Vec | null): void {
  const moved = !sameAim(aim, ui.aimPrev);
  ui.aimPrev = aim === null ? null : { x: aim.x, y: aim.y };
  if (!moved) return;
  const hit = hitAt(hits, aim);
  if (hit !== null && hit.nav) setFocus(ui, view, hit.id);
}

/** 焦点が当たりに無い（積んだばかりの頁・消えた当たり）なら先頭の当たりへ。荷札が空のままにならないように */
function ensureFocus(ui: InventoryUi, view: MenuView, hits: readonly MenuHit[]): void {
  if (hits.some((h) => h.nav && h.id === view.focus)) return;
  const first = hits.find((h) => h.nav);
  if (first !== undefined) setFocus(ui, view, first.id);
}

/** 方向の移動。その向きに当たりが無ければ頁の送り（edge） */
function moveFocus(state: GameState, ui: InventoryUi, view: MenuView, hits: readonly MenuHit[], dx: number, dy: number): void {
  const next = nearestInDirection(hits, view.focus, dx, dy);
  if (next !== null) {
    setFocus(ui, view, next);
    return;
  }
  viewModule(view).edge(state, ui, view, dx, dy);
}

/** 数字キー（スキル 1〜4）で腰の石・スキルの列へ焦点（その頁に当たりがあれば） */
function skillKeyFocus(ui: InventoryUi, view: MenuView, hits: readonly MenuHit[], input: Readonly<FrameInput>): void {
  const keys = [input.skill1Pressed, input.skill2Pressed, input.skill3Pressed, input.skill4Pressed];
  const i = keys.findIndex((on) => on);
  if (i < 0) return;
  const id = fid.stone(i);
  if (hits.some((h) => h.id === id)) setFocus(ui, view, id);
}

/** 長押しを続ける。0.6 秒で hold、先に離せば act。終わったら true */
function updateHold(state: GameState, ui: InventoryUi, hits: readonly MenuHit[], input: Readonly<FrameInput>, signals: Readonly<MenuSignals>, dt: number): boolean {
  const hold = ui.hold;
  if (hold === null) return false;
  const hit = focusedHit(hits, hold.id);
  if (hit === null) {
    ui.hold = null;
    return true;
  }
  const held = hold.by === "key" ? signals.confirmHeld : input.clickHeld;
  const result = stepHold(hold, held, dt);
  if (result === "wait") return true;
  ui.hold = null;
  const act = result === "fire" ? hit.hold : hit.act;
  if (act !== null) dispatchMenuAct(state, ui, act);
  return true;
}

/** 決定（キー・パッド）か当たりの上のクリック。長押しの当たりは長押しを始める */
function press(state: GameState, ui: InventoryUi, view: MenuView, hit: MenuHit, by: "key" | "mouse"): void {
  if (hit.nav) setFocus(ui, view, hit.id);
  if (hit.hold !== null) {
    ui.hold = { id: hit.id, t: 0, by };
    return;
  }
  if (hit.act !== null) dispatchMenuAct(state, ui, hit.act);
}

/** 書付を積む（焦点の物の全文と数字の頁） */
function openSheet(state: GameState, ui: InventoryUi, subject: SheetSubject): void {
  dispatchMenuAct(state, ui, { kind: "push", view: { kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null } });
}

const SORT_CYCLE: readonly CandidateSort[] = ["fit", "new", "name"];

function nextSort(sort: CandidateSort): CandidateSort {
  return SORT_CYCLE[(SORT_CYCLE.indexOf(sort) + 1) % SORT_CYCLE.length] ?? "fit";
}

/** 開いている間の 1 フレーム。何かを処理したら残りの入力は読まない（同じフレームに 2 つの操作をしない） */
function updateOpen(state: GameState, ui: InventoryUi, input: Readonly<FrameInput>, dt: number, signals: Readonly<MenuSignals>): void {
  const view = topView(ui);
  if (view === null) return;
  const hits = menuHits(state, ui);
  if (updateHold(state, ui, hits, input, signals, dt)) return;
  followMouse(ui, view, hits, input.aimScreen);
  ensureFocus(ui, view, hits);

  const nav = readMenuNav(ui.nav, input, dt);
  if (nav.dx !== 0 || nav.dy !== 0) {
    moveFocus(state, ui, view, hits, nav.dx, nav.dy);
    return;
  }
  if (input.wheel !== 0) {
    viewModule(view).edge(state, ui, view, 0, Math.sign(input.wheel));
    return;
  }
  skillKeyFocus(ui, view, hits, input);

  const module = viewModule(view);
  const subject = module.sheetFor(state, view);
  const aim = input.aimScreen;
  if (input.clickPressed && aim !== null) {
    const hit = hitAt(hits, aim);
    if (hit !== null) {
      press(state, ui, view, hit, "mouse");
      return;
    }
    if (subject !== null && pointInRect(aim, TAG_RECT)) {
      openSheet(state, ui, subject);
      return;
    }
  }
  if (input.confirmPressed) {
    const hit = focusedHit(hits, view.focus);
    if (hit !== null) press(state, ui, view, hit, "key");
    return;
  }
  if ((input.interactPressed || input.specialPressed) && subject !== null) {
    openSheet(state, ui, subject);
    return;
  }
  if (input.parryPressed && view.kind === "candidates") {
    const sort = nextSort(view.sort);
    ui.sortPref = sort;
    dispatchMenuAct(state, ui, { kind: "setSort", sort });
  }
}

/**
 * 装備画面の 1 フレーム（main.ts が step より前に呼ぶ）。signals は FrameInput の外の入力
 * （戻る = Esc / 右クリック / パッド B・Start、決定の押し続け）。閉じていれば持ち物キーで開くだけ
 */
export function updateInventoryUi(state: GameState, ui: InventoryUi, input: FrameInput, dt: number, signals: Readonly<MenuSignals> = NO_SIGNALS): void {
  ui.clickHeldPrev = input.clickHeld;
  if (!ui.open) {
    if (!input.inventoryPressed) return;
    openMenu(state, ui, "attire");
    primeMenuNav(ui.nav, input);
    ui.aimPrev = input.aimScreen === null ? null : { ...input.aimScreen };
    pushSfx(state, "uiOpen");
    return;
  }
  ui.time += dt;
  tickNote(ui, dt);
  if (input.inventoryPressed) {
    dispatchMenuAct(state, ui, { kind: "switchFace", face: rootFace(ui) === "crest" ? "attire" : "crest" });
    return;
  }
  if (signals.back) {
    ui.hold = null;
    goBack(state, ui);
    return;
  }
  updateOpen(state, ui, input, dt, signals);
}

/** 長押しの進み（0..1。描画の環） */
export function holdRatio(ui: Readonly<InventoryUi>): number {
  return ui.hold === null ? 0 : Math.min(1, ui.hold.t / MENU_HOLD_SECONDS);
}
