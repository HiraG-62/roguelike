import type { FrameInput } from "../core/input";
import { isKeystoneKey } from "../loot/affixes";
import { itemColorBar } from "../loot/describe";
import { dominantColor } from "../loot/names";
import {
  RARITIES,
  RARITY_LABEL,
  SLOTS,
  TRAIT_COLORS,
  TRAIT_COLOR_LABEL,
  type Item,
  type Rarity,
  type Slot,
  type TraitColor,
} from "../loot/types";
import { type Point, type Rect, SLOT_LABEL, pointInRect } from "./inventoryLayout";

/**
 * 倉庫一覧の部位分け・並べ替え・絞り込み。装備タブと残響タブの倉庫で共有する。
 * DOM 非依存の純関数と小さな状態だけを持ち、描画は render/stashToolbarUi.ts が行う。
 * 並べ替えの軸は「何を持っているか」で選ぶためのもので、強さの単一指標は作らない（docs/DESIGN_PRINCIPLES.md）
 */

/** 部位タブ。all は全部位を部位ごとにまとめて並べる */
export type SlotFilter = Slot | "all";
export const SLOT_FILTERS: readonly SlotFilter[] = ["all", ...SLOTS];

/** 並べ替えの軸 */
export const SORT_KEYS = ["found", "depth", "flux", "color", "name", "margin", "traits"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** 印（持っている来歴・性質の種類）での絞り込み */
export const MARK_FILTERS = ["bud", "named", "keystone", "inscription", "margin"] as const;
export type MarkFilter = (typeof MARK_FILTERS)[number];

export interface StashView {
  slot: SlotFilter;
  sort: SortKey;
  /** 並びの向きを既定から反転する */
  reverse: boolean;
  /** 指定した色の性質を 1 つ以上持つものだけ（null = すべて） */
  color: TraitColor | null;
  rarity: Rarity | null;
  mark: MarkFilter | null;
  /** マウスが乗っている操作（描画の強調用） */
  hover: StashControl | null;
}

export type StashControl =
  | { kind: "slot"; slot: SlotFilter }
  | { kind: "sort" }
  | { kind: "color" }
  | { kind: "rarity" }
  | { kind: "mark" };

export interface StashControlLayout {
  control: StashControl;
  rect: Rect;
}

export function createStashView(): StashView {
  return { slot: "all", sort: "found", reverse: false, color: null, rarity: null, mark: null, hover: null };
}

// ---------------------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------------------

export const SLOT_FILTER_LABEL: Readonly<Record<SlotFilter, string>> = { all: "全部位", ...SLOT_LABEL };

export const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  found: "拾った順",
  depth: "深度",
  flux: "揺らぎ",
  color: "色",
  name: "名前",
  margin: "余白",
  traits: "性質の数",
};

export const MARK_LABEL: Readonly<Record<MarkFilter, string>> = {
  bud: "芽あり",
  named: "名のある",
  keystone: "誓約",
  inscription: "銘",
  margin: "余白あり",
};

const ALL_LABEL = "すべて";
/** 既定の向き（反転なし）で大きい / 新しいものが上に来る軸。それ以外は小さい順（あいうえお順・色の並び順） */
const DESCENDING_BY_DEFAULT: ReadonlySet<SortKey> = new Set<SortKey>(["found", "depth", "flux", "margin", "traits"]);
const ARROW_DOWN = "↓";
const ARROW_UP = "↑";

/** 並びの矢印。上から下へ値が小さくなるなら ↓ */
export function sortArrow(view: Pick<StashView, "sort" | "reverse">): string {
  return DESCENDING_BY_DEFAULT.has(view.sort) !== view.reverse ? ARROW_DOWN : ARROW_UP;
}

/** ボタンの文字。部位タブは件数を添える */
export function stashControlLabel(view: StashView, control: StashControl, counts?: Readonly<Record<SlotFilter, number>>): string {
  switch (control.kind) {
    case "slot": {
      const count = counts?.[control.slot];
      return count === undefined ? SLOT_FILTER_LABEL[control.slot] : `${SLOT_FILTER_LABEL[control.slot]} ${count}`;
    }
    case "sort":
      return `並び:${SORT_LABEL[view.sort]}${sortArrow(view)}`;
    case "color":
      return `色:${view.color === null ? ALL_LABEL : TRAIT_COLOR_LABEL[view.color]}`;
    case "rarity":
      return `揺らぎ:${view.rarity === null ? ALL_LABEL : RARITY_LABEL[view.rarity]}`;
    case "mark":
      return `印:${view.mark === null ? ALL_LABEL : MARK_LABEL[view.mark]}`;
  }
}

/** 部位以外の絞り込みが掛かっているか（描画で「絞り込み中」を示す） */
export function isFiltering(view: StashView): boolean {
  return view.color !== null || view.rarity !== null || view.mark !== null;
}

// ---------------------------------------------------------------------------
// 絞り込み・並べ替え
// ---------------------------------------------------------------------------

export function hasMark(item: Item, mark: MarkFilter): boolean {
  switch (mark) {
    case "bud":
      return item.budOffer !== undefined && item.budOffer !== null;
    case "named":
      return item.namedKey !== undefined;
    case "keystone":
      return item.affixes.some((r) => isKeystoneKey(r.key));
    case "inscription":
      return item.inscription !== undefined && item.inscription.length > 0;
    case "margin":
      return (item.margin ?? 0) > 0;
  }
}

export function hasTraitColor(item: Item, color: TraitColor): boolean {
  return itemColorBar(item.affixes).some((seg) => seg.color === color);
}

/** 部位以外の条件（色・揺らぎ・印）に合うか */
function matchesTraits(item: Item, view: StashView): boolean {
  if (view.color !== null && !hasTraitColor(item, view.color)) return false;
  if (view.rarity !== null && item.rarity !== view.rarity) return false;
  if (view.mark !== null && !hasMark(item, view.mark)) return false;
  return true;
}

export function matchesView(item: Item, view: StashView): boolean {
  if (view.slot !== "all" && item.slot !== view.slot) return false;
  return matchesTraits(item, view);
}

/** 部位タブに添える件数（色・揺らぎ・印の絞り込み後） */
export function slotCounts(stash: readonly Item[], view: StashView): Record<SlotFilter, number> {
  const counts = Object.fromEntries(SLOT_FILTERS.map((s) => [s, 0])) as Record<SlotFilter, number>;
  for (const item of stash) {
    if (!matchesTraits(item, view)) continue;
    counts.all += 1;
    counts[item.slot] += 1;
  }
  return counts;
}

/** 色で並べるときの位置。性質が無い（無色）ものは最後 */
function colorRank(item: Item): number {
  const hue = dominantColor(item.affixes);
  return hue === undefined ? TRAIT_COLORS.length : TRAIT_COLORS.indexOf(hue);
}

/** 軸ごとの比較（小さい順）。同値は 0 */
function compareBy(key: SortKey, a: Item, b: Item): number {
  switch (key) {
    case "found":
      return a.foundAt - b.foundAt;
    case "depth":
      return a.itemLevel - b.itemLevel;
    case "flux":
      return RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity);
    case "color":
      return colorRank(a) - colorRank(b);
    case "name":
      return a.name.localeCompare(b.name, "ja");
    case "margin":
      return (a.margin ?? 0) - (b.margin ?? 0);
    case "traits":
      return a.affixes.length - b.affixes.length;
  }
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
  const descending = DESCENDING_BY_DEFAULT.has(view.sort) !== view.reverse;
  const primary = compareBy(view.sort, a, b);
  if (primary !== 0) return descending ? -primary : primary;
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
// ボタン列のレイアウトと入力
// ---------------------------------------------------------------------------

/** 1 段の高さ。1 段目 = 部位タブ、2 段目 = 並び・色・揺らぎ・印 */
export const STASH_TOOLBAR_ROW_H = 11;
export const STASH_TOOLBAR_ROWS = 2;
export const STASH_TOOLBAR_H = STASH_TOOLBAR_ROW_H * STASH_TOOLBAR_ROWS;
const CONTROL_GAP = 2;
/** 2 段目のボタン幅の比。文字の長さ（「揺らぎ:反転あり」など）に合わせる */
const SECOND_ROW: readonly { kind: "sort" | "color" | "rarity" | "mark"; weight: number }[] = [
  { kind: "sort", weight: 5 },
  { kind: "color", weight: 3 },
  { kind: "rarity", weight: 4 },
  { kind: "mark", weight: 4 },
];
/** ボタンの上下の余白（段と段の間を空ける） */
const CONTROL_INSET_Y = 1;

/** rect を横に weights の比で分ける。端数は最後に寄せて右端を揃える */
function splitRow(rect: Rect, weights: readonly number[]): Rect[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const usable = rect.w - CONTROL_GAP * (weights.length - 1);
  const rects: Rect[] = [];
  let x = rect.x;
  weights.forEach((weight, i) => {
    const last = i === weights.length - 1;
    const w = last ? rect.x + rect.w - x : Math.floor((usable * weight) / total);
    rects.push({ x, y: rect.y + CONTROL_INSET_Y, w, h: rect.h - CONTROL_INSET_Y * 2 });
    x += w + CONTROL_GAP;
  });
  return rects;
}

/** area の上端から STASH_TOOLBAR_H の帯にボタンを並べる */
export function layoutStashToolbar(area: Rect): StashControlLayout[] {
  const first: Rect = { x: area.x, y: area.y, w: area.w, h: STASH_TOOLBAR_ROW_H };
  const second: Rect = { x: area.x, y: area.y + STASH_TOOLBAR_ROW_H, w: area.w, h: STASH_TOOLBAR_ROW_H };
  const slotRects = splitRow(first, SLOT_FILTERS.map(() => 1));
  const slots = SLOT_FILTERS.map((slot, i): StashControlLayout | null => {
    const rect = slotRects[i];
    return rect ? { control: { kind: "slot", slot }, rect } : null;
  });
  const secondRects = splitRow(second, SECOND_ROW.map((c) => c.weight));
  const rest = SECOND_ROW.map((c, i): StashControlLayout | null => {
    const rect = secondRects[i];
    return rect ? { control: { kind: c.kind }, rect } : null;
  });
  return [...slots, ...rest].filter((c): c is StashControlLayout => c !== null);
}

export function sameControl(a: StashControl | null, b: StashControl): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind !== "slot" || (b.kind === "slot" && a.slot === b.slot);
}

/** options に null（すべて）を先頭に足した輪で step 進める */
function cycleNullable<T>(options: readonly T[], current: T | null, step: number): T | null {
  const ring: (T | null)[] = [null, ...options];
  const i = ring.indexOf(current);
  const next = (Math.max(0, i) + step + ring.length) % ring.length;
  return ring[next] ?? null;
}

function cycleSort(current: SortKey, step: number): SortKey {
  const i = SORT_KEYS.indexOf(current);
  return SORT_KEYS[(i + step + SORT_KEYS.length) % SORT_KEYS.length] ?? current;
}

/**
 * 操作を 1 つ実行する。部位タブは選択、並びはクリックで次の軸・Shift+クリックで向きを反転、
 * 色・揺らぎ・印はクリックで次・Shift+クリックで前（先頭が「すべて」）
 */
export function applyStashControl(view: StashView, control: StashControl, shift: boolean): void {
  const step = shift ? -1 : 1;
  switch (control.kind) {
    case "slot":
      view.slot = control.slot;
      return;
    case "sort":
      if (shift) view.reverse = !view.reverse;
      else view.sort = cycleSort(view.sort, 1);
      return;
    case "color":
      view.color = cycleNullable(TRAIT_COLORS, view.color, step);
      return;
    case "rarity":
      view.rarity = cycleNullable(RARITIES, view.rarity, step);
      return;
    case "mark":
      view.mark = cycleNullable(MARK_FILTERS, view.mark, step);
      return;
  }
}

export function findStashControl(layout: readonly StashControlLayout[], p: Point | null): StashControlLayout | null {
  if (p === null) return null;
  return layout.find((c) => pointInRect(p, c.rect)) ?? null;
}

/**
 * ボタン列の 1 フレーム分の入力。hover を更新し、クリックで操作したら true（呼び出し側はスクロールを先頭へ戻す）
 */
export function updateStashToolbar(view: StashView, layout: readonly StashControlLayout[], input: FrameInput): boolean {
  const hit = findStashControl(layout, input.aimScreen);
  view.hover = hit ? hit.control : null;
  if (!input.clickPressed || hit === null) return false;
  applyStashControl(view, hit.control, input.shiftHeld);
  return true;
}
