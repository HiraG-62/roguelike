import type { FrameInput } from "../core/input";
import { LOOT_SLOTS, SLOTS, type Item, type Slot } from "../loot/types";
import { type Point, type Rect, SLOT_LABEL, pointInRect } from "./inventoryLayout";
import { FILTERS, FILTER_KEYS, SORTS, SORT_KEYS, type FilterKey, type SortKey } from "./stashFacets";

export { FILTERS, FILTER_KEYS, SORTS, SORT_KEYS, weaponKindOf, type FilterKey, type SortKey } from "./stashFacets";

/**
 * 倉庫一覧の部位分け・並べ替え・絞り込みの仕組み。装備タブと残響タブの倉庫で共有する。
 * 軸の中身（何で並べ・何で絞るか）は ui/stashFacets.ts の表にあり、ここは表から状態・ボタン・順序を作るだけ。
 * 部位タブは LOOT_SLOTS と倉庫に実際にある部位から作るので、部位が増えても手を入れなくてよい。
 * ボタンは幅に収まらなければ折り返し、帯の高さ（StashToolbarLayout.h）を呼び出し側が一覧の開始位置に使う。
 * DOM 非依存。描画は render/stashToolbarUi.ts
 */

/** 部位タブ。all は全部位を部位ごとにまとめて並べる */
export type SlotFilter = Slot | "all";

export interface StashView {
  slot: SlotFilter;
  sort: SortKey;
  /** 並びの向きを既定から反転する */
  reverse: boolean;
  /** 軸ごとの絞り込みの値（無い軸は「すべて」） */
  filters: Partial<Record<FilterKey, string>>;
  /** マウスが乗っている操作（描画の強調用） */
  hover: StashControl | null;
}

export type StashControl = { kind: "slot"; slot: SlotFilter } | { kind: "sort" } | { kind: "filter"; filter: FilterKey };

export interface StashControlLayout {
  control: StashControl;
  rect: Rect;
}

export interface StashToolbarLayout {
  controls: StashControlLayout[];
  /** ボタンの帯の高さ（折り返した段数 × 段の高さ） */
  h: number;
}

export type SlotCounts = Partial<Record<SlotFilter, number>>;

export function createStashView(): StashView {
  return { slot: "all", sort: "found", reverse: false, filters: {}, hover: null };
}

// ---------------------------------------------------------------------------
// 部位タブ
// ---------------------------------------------------------------------------

export const SLOT_FILTER_LABEL: Readonly<Record<SlotFilter, string>> = { all: "全部位", ...SLOT_LABEL };

/** 部位タブの並び。ドロップのある部位は常に、それ以外の部位（今は左手）は倉庫にあるときだけ出す。順は SLOTS */
export function slotFilters(stash: readonly Item[]): SlotFilter[] {
  const present = new Set(stash.map((it) => it.slot));
  return ["all", ...SLOTS.filter((s) => LOOT_SLOTS.includes(s) || present.has(s))];
}

// ---------------------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------------------

const ALL_LABEL = "すべて";
const ARROW_DOWN = "↓";
const ARROW_UP = "↑";

function isDescending(view: Pick<StashView, "sort" | "reverse">): boolean {
  return SORTS[view.sort].descending !== view.reverse;
}

/** 並びの矢印。上から下へ値が小さくなるなら ↓ */
export function sortArrow(view: Pick<StashView, "sort" | "reverse">): string {
  return isDescending(view) ? ARROW_DOWN : ARROW_UP;
}

/** ボタンの文字。部位タブは件数を添える */
export function stashControlLabel(view: StashView, control: StashControl, counts?: Readonly<SlotCounts>): string {
  switch (control.kind) {
    case "slot": {
      const count = counts?.[control.slot];
      return count === undefined ? SLOT_FILTER_LABEL[control.slot] : `${SLOT_FILTER_LABEL[control.slot]} ${count}`;
    }
    case "sort":
      return `並び:${SORTS[view.sort].label}${sortArrow(view)}`;
    case "filter": {
      const def = FILTERS[control.filter];
      const value = view.filters[control.filter];
      return `${def.label}:${value === undefined ? ALL_LABEL : def.optionLabel(value)}`;
    }
  }
}

/** 部位以外の絞り込みが掛かっているか */
export function isFiltering(view: StashView): boolean {
  return FILTER_KEYS.some((k) => view.filters[k] !== undefined);
}

/** 操作が既定から変わっているか（描画で強調する） */
export function isControlActive(view: StashView, control: StashControl): boolean {
  switch (control.kind) {
    case "slot":
      return view.slot === control.slot;
    case "sort":
      return view.sort !== SORT_KEYS[0] || view.reverse;
    case "filter":
      return view.filters[control.filter] !== undefined;
  }
}

/** 絞り込み中の値に固有の色があればその色（色・揺らぎなど）。無ければ undefined */
export function controlValueColor(view: StashView, control: StashControl): string | undefined {
  if (control.kind !== "filter") return undefined;
  const value = view.filters[control.filter];
  return value === undefined ? undefined : FILTERS[control.filter].valueColor?.(value);
}

// ---------------------------------------------------------------------------
// 絞り込み・並べ替え
// ---------------------------------------------------------------------------

/** 部位以外の条件（表の絞り込みすべて）に合うか */
function matchesFilters(item: Item, view: StashView): boolean {
  return FILTER_KEYS.every((k) => {
    const value = view.filters[k];
    return value === undefined || FILTERS[k].matches(item, value);
  });
}

export function matchesView(item: Item, view: StashView): boolean {
  if (view.slot !== "all" && item.slot !== view.slot) return false;
  return matchesFilters(item, view);
}

/** 部位タブに添える件数（部位以外の絞り込み後）。無い部位は undefined ではなく 0 として読む */
export function slotCounts(stash: readonly Item[], view: StashView): SlotCounts {
  const counts: SlotCounts = { all: 0 };
  for (const s of SLOTS) counts[s] = 0;
  for (const item of stash) {
    if (!matchesFilters(item, view)) continue;
    counts.all = (counts.all ?? 0) + 1;
    counts[item.slot] = (counts[item.slot] ?? 0) + 1;
  }
  return counts;
}

/**
 * 表示順。all のときは部位ごとにまとめ（SLOTS 順）、その中を選んだ軸で並べる。
 * 同値は新しい順 → id で決め、フレームごとに順が揺れないようにする
 */
export function compareItems(view: Pick<StashView, "slot" | "sort" | "reverse">, a: Item, b: Item): number {
  if (view.slot === "all") {
    const bySlot = SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
    if (bySlot !== 0) return bySlot;
  }
  const primary = SORTS[view.sort].compare(a, b);
  if (primary !== 0) return isDescending(view) ? -primary : primary;
  const newer = b.foundAt - a.foundAt;
  if (newer !== 0) return newer;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 倉庫を絞り込んで並べる */
export function applyStashView(stash: readonly Item[], view: StashView): Item[] {
  return stash.filter((item) => matchesView(item, view)).sort((a, b) => compareItems(view, a, b));
}

/** 一覧上で直前の行と部位が変わる位置か（all のときの区切り線） */
export function startsSlotGroup(order: readonly Item[], index: number): boolean {
  if (index <= 0) return false;
  const prev = order[index - 1];
  const cur = order[index];
  return prev !== undefined && cur !== undefined && prev.slot !== cur.slot;
}

// ---------------------------------------------------------------------------
// ボタンの配置（折り返し）
// ---------------------------------------------------------------------------

export const STASH_TOOLBAR_ROW_H = 11;
const CONTROL_GAP = 2;
/** ボタンの上下の余白（段と段の間を空ける） */
const CONTROL_INSET_Y = 1;
/** 部位タブの最小幅（「首飾り 99」が入る） */
const SLOT_TAB_MIN_W = 44;
/** 並びボタンの最小幅（「並び:性質の数↓」が入る） */
const SORT_MIN_W = 100;

interface FlowItem {
  control: StashControl;
  minWidth: number;
}

/** items を幅 w の段へ詰める（1 つも入らない幅でも 1 段に 1 つは置く） */
function packRows(items: readonly FlowItem[], w: number): FlowItem[][] {
  const rows: FlowItem[][] = [];
  let row: FlowItem[] = [];
  let used = 0;
  for (const item of items) {
    const need = row.length === 0 ? item.minWidth : CONTROL_GAP + item.minWidth;
    if (row.length > 0 && used + need > w) {
      rows.push(row);
      row = [];
      used = item.minWidth;
    } else {
      used += need;
    }
    row.push(item);
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** 1 段を最小幅の比で広げて横幅いっぱいに置く。端数は最後に寄せて右端を揃える */
function placeRow(row: readonly FlowItem[], x: number, y: number, w: number): StashControlLayout[] {
  const total = row.reduce((sum, it) => sum + it.minWidth, 0);
  const usable = w - CONTROL_GAP * (row.length - 1);
  let cx = x;
  return row.map((it, i) => {
    const last = i === row.length - 1;
    const cw = last ? x + w - cx : Math.floor((usable * it.minWidth) / total);
    const rect = { x: cx, y: y + CONTROL_INSET_Y, w: cw, h: STASH_TOOLBAR_ROW_H - CONTROL_INSET_Y * 2 };
    cx += cw + CONTROL_GAP;
    return { control: it.control, rect };
  });
}

/**
 * area の上端からボタンを並べる。1 群目 = 部位タブ、2 群目 = 並びと絞り込み（表の順）。
 * 群ごとに段を改め、幅に収まらなければ折り返す
 */
export function layoutStashToolbar(area: Pick<Rect, "x" | "y" | "w">, stash: readonly Item[]): StashToolbarLayout {
  const slotGroup = slotFilters(stash).map((slot): FlowItem => ({ control: { kind: "slot", slot }, minWidth: SLOT_TAB_MIN_W }));
  const optionGroup: FlowItem[] = [
    { control: { kind: "sort" }, minWidth: SORT_MIN_W },
    ...FILTER_KEYS.map((filter): FlowItem => ({ control: { kind: "filter", filter }, minWidth: FILTERS[filter].minWidth })),
  ];
  const rows = [...packRows(slotGroup, area.w), ...packRows(optionGroup, area.w)];
  const controls = rows.flatMap((row, r) => placeRow(row, area.x, area.y + r * STASH_TOOLBAR_ROW_H, area.w));
  return { controls, h: rows.length * STASH_TOOLBAR_ROW_H };
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

export function sameControl(a: StashControl | null, b: StashControl): boolean {
  if (a === null) return false;
  if (a.kind === "slot") return b.kind === "slot" && a.slot === b.slot;
  if (a.kind === "filter") return b.kind === "filter" && a.filter === b.filter;
  return b.kind === a.kind;
}

/** 「すべて」(undefined) を先頭に足した輪で step 進める。今の値が候補に無ければ先頭から数える */
function cycleOption(options: readonly string[], current: string | undefined, step: number): string | undefined {
  const ring: (string | undefined)[] = [undefined, ...options];
  const i = Math.max(0, ring.indexOf(current));
  return ring[(i + step + ring.length) % ring.length];
}

function cycleSort(current: SortKey): SortKey {
  const i = SORT_KEYS.indexOf(current);
  return SORT_KEYS[(i + 1) % SORT_KEYS.length] ?? current;
}

/**
 * 操作を 1 つ実行する。部位タブは選択、並びはクリックで次の軸・Shift+クリックで向きを反転、
 * 絞り込みはクリックで次・Shift+クリックで前（先頭が「すべて」）。候補は表の options（stash を見る軸もある）
 */
export function applyStashControl(view: StashView, control: StashControl, shift: boolean, stash: readonly Item[]): void {
  switch (control.kind) {
    case "slot":
      view.slot = control.slot;
      return;
    case "sort":
      if (shift) view.reverse = !view.reverse;
      else view.sort = cycleSort(view.sort);
      return;
    case "filter": {
      const next = cycleOption(FILTERS[control.filter].options(stash), view.filters[control.filter], shift ? -1 : 1);
      if (next === undefined) delete view.filters[control.filter];
      else view.filters[control.filter] = next;
      return;
    }
  }
}

export function findStashControl(controls: readonly StashControlLayout[], p: Point | null): StashControlLayout | null {
  if (p === null) return null;
  return controls.find((c) => pointInRect(p, c.rect)) ?? null;
}

/** ボタンの帯の 1 フレーム分の入力。hover を更新し、クリックで操作したら true（呼び出し側はスクロールを先頭へ戻す） */
export function updateStashToolbar(
  view: StashView,
  controls: readonly StashControlLayout[],
  input: FrameInput,
  stash: readonly Item[],
): boolean {
  const hit = findStashControl(controls, input.aimScreen);
  view.hover = hit ? hit.control : null;
  if (!input.clickPressed || hit === null) return false;
  applyStashControl(view, hit.control, input.shiftHeld, stash);
  return true;
}
