import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { isKeystoneKey } from "../loot/affixes";
import { baseDef } from "../loot/bases";
import { itemColorBar } from "../loot/describe";
import { dominantColor } from "../loot/names";
import { RARITIES, RARITY_COLOR, RARITY_LABEL, TRAIT_COLORS, TRAIT_COLOR_HEX, TRAIT_COLOR_LABEL, type Item } from "../loot/types";

/**
 * 倉庫一覧の「並びの軸」と「絞り込みの軸」の定義表。
 * 軸を増やすときはこのファイルの SORTS / FILTERS に 1 件足すだけでよい（ボタンの配置・入力・描画は ui/stashFilter.ts と
 * render/stashToolbarUi.ts が表から作る）。
 * 候補は元のデータ（MOVESET_KEYS / TRAIT_COLORS / RARITIES …）から引くので、武器種や色が増えても自動で追従する。
 * 並びは「何を持っているか」で探すためのもので、強さの単一指標は作らない（docs/DESIGN_PRINCIPLES.md）
 */

// ---------------------------------------------------------------------------
// 共通の読み取り
// ---------------------------------------------------------------------------

/** 遺物の武器種（ベースの近接・銃の弾）。武器でなければ undefined */
export function weaponKindOf(item: Item): MovesetKey | undefined {
  return baseDef(item.baseKey)?.moveset;
}

/** list の中の位置。見つからなければ最後（list.length） */
function rankIn<T>(list: readonly T[], value: T | undefined): number {
  const i = value === undefined ? -1 : list.indexOf(value);
  return i < 0 ? list.length : i;
}

// ---------------------------------------------------------------------------
// 並び
// ---------------------------------------------------------------------------

export interface SortDef {
  label: string;
  /** 反転なしのとき大きい（新しい）ものを上にする */
  descending: boolean;
  /** 小さい順の比較。同値は 0（同値の順は呼び出し側が新しい順 → id で決める） */
  compare: (a: Item, b: Item) => number;
}

export const SORT_KEYS = ["found", "kind", "depth", "flux", "color", "name", "margin", "traits"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** 並びの軸。ボタンはクリックで SORT_KEYS の順に回る */
export const SORTS: Readonly<Record<SortKey, SortDef>> = {
  found: { label: "拾った順", descending: true, compare: (a, b) => a.foundAt - b.foundAt },
  kind: { label: "武器種", descending: false, compare: (a, b) => rankIn(MOVESET_KEYS, weaponKindOf(a)) - rankIn(MOVESET_KEYS, weaponKindOf(b)) },
  depth: { label: "深度", descending: true, compare: (a, b) => a.itemLevel - b.itemLevel },
  flux: { label: "揺らぎ", descending: true, compare: (a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) },
  color: {
    label: "色",
    descending: false,
    compare: (a, b) => rankIn(TRAIT_COLORS, dominantColor(a.affixes)) - rankIn(TRAIT_COLORS, dominantColor(b.affixes)),
  },
  name: { label: "名前", descending: false, compare: (a, b) => a.name.localeCompare(b.name, "ja") },
  margin: { label: "余白", descending: true, compare: (a, b) => (a.margin ?? 0) - (b.margin ?? 0) },
  traits: { label: "性質の数", descending: true, compare: (a, b) => a.affixes.length - b.affixes.length },
};

// ---------------------------------------------------------------------------
// 絞り込み
// ---------------------------------------------------------------------------

export interface FilterDef {
  /** ボタンの見出し（「色:紅」の「色」） */
  label: string;
  /** 回す候補。stash を受け取るものは倉庫にある値だけを回す（候補が多い軸で空振りを減らす） */
  options: (stash: readonly Item[]) => readonly string[];
  optionLabel: (value: string) => string;
  matches: (item: Item, value: string) => boolean;
  /** 選んだ値に固有の色があれば（ボタンの文字をその色で塗る） */
  valueColor?: (value: string) => string | undefined;
  /** ボタンの最小幅（論理 px）。長い候補名が入る軸は広くする */
  minWidth: number;
}

export const FILTER_KEYS = ["color", "rarity", "mark", "kind"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** 印（持っている来歴・性質の種類） */
const MARKS: Readonly<Record<string, { label: string; has: (item: Item) => boolean }>> = {
  bud: { label: "芽あり", has: (item) => item.budOffer !== undefined && item.budOffer !== null },
  named: { label: "名のある遺物", has: (item) => item.namedKey !== undefined },
  keystone: { label: "誓約", has: (item) => item.affixes.some((r) => isKeystoneKey(r.key)) },
  inscription: { label: "銘", has: (item) => item.inscription !== undefined && item.inscription.length > 0 },
  margin: { label: "余白あり", has: (item) => (item.margin ?? 0) > 0 },
};
const MARK_KEYS = Object.keys(MARKS);

/** key の型を問わず Record を引く（絞り込みの値は文字列で持つため） */
function lookup(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return table[key];
}

function isMovesetKey(value: string): value is MovesetKey {
  return (MOVESET_KEYS as readonly string[]).includes(value);
}

/** ボタンの最小幅。絞っていないときは軸の名前だけなので、選んだ値（「揺らぎ:反転あり」など）が入る幅を目安にする */
const FILTER_MIN_W = { color: 40, rarity: 56, mark: 52, kind: 54 } as const;

/** 絞り込みの軸。ボタンは FILTER_KEYS の順に並ぶ */
export const FILTERS: Readonly<Record<FilterKey, FilterDef>> = {
  color: {
    label: "色",
    options: () => TRAIT_COLORS,
    optionLabel: (v) => lookup(TRAIT_COLOR_LABEL, v) ?? v,
    valueColor: (v) => lookup(TRAIT_COLOR_HEX, v),
    matches: (item, v) => itemColorBar(item.affixes).some((seg) => seg.color === v),
    minWidth: FILTER_MIN_W.color,
  },
  rarity: {
    label: "揺らぎ",
    options: () => RARITIES,
    optionLabel: (v) => lookup(RARITY_LABEL, v) ?? v,
    valueColor: (v) => lookup(RARITY_COLOR, v),
    matches: (item, v) => item.rarity === v,
    minWidth: FILTER_MIN_W.rarity,
  },
  mark: {
    label: "印",
    options: () => MARK_KEYS,
    optionLabel: (v) => MARKS[v]?.label ?? v,
    matches: (item, v) => MARKS[v]?.has(item) ?? false,
    minWidth: FILTER_MIN_W.mark,
  },
  kind: {
    label: "武器種",
    // 武器種は数が多いので倉庫にあるものだけ（MOVESET_KEYS の順）
    options: (stash) => {
      const present = new Set(stash.map(weaponKindOf));
      return MOVESET_KEYS.filter((k) => present.has(k));
    },
    optionLabel: (v) => (isMovesetKey(v) ? MOVESETS[v].name : v),
    matches: (item, v) => weaponKindOf(item) === v,
    minWidth: FILTER_MIN_W.kind,
  },
};
