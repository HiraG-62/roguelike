import type { BoonAction } from "../core/build";
import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { SLOT_LABEL } from "./inventoryLayout";
import { isGun } from "../data/weapons";
import type { Item } from "../loot/types";
import { BOON_ACTIONS, BOON_ACTION_LABEL, BOONS, type BoonKey, LINEAGE_LABEL } from "../system/boonDefs";
import { gracesOf, graceSlotsOf } from "../system/boons";
import { relicKeywords } from "../system/keywords";
import { playerMoveset } from "../system/player";
import { ATTIRE_SLOTS } from "./attire";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type GuideVerb,
  type LootSlot,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";

/**
 * 装備画面の加護の頁（docs/ideas/inventory-v2/E-merged.md 6 章 W6、E-impl.md 4-3 E5）。
 * 行動の札 [左][右][駆][技][奥] で行動を替え、左にその行動の加護（枠 2、真髄で 3）、右に乗る遺物、下に注ぐ系統を並べる。
 * 加護 → 書付「祝福」、乗る遺物 → 装束のその部位へ跳ぶ
 */

type ActView = ViewOf<"act">;

// -----------------------------------------------------------------------------
// 行動の系統と乗る遺物
// -----------------------------------------------------------------------------

/** 行動の系統（その系統を源か糧に持つ装備中の遺物が「乗る」）。左・右は銃の家系だけ射撃系（actionKeyword） */
export const ACTION_KEYWORD: Readonly<Record<BoonAction, Keyword>> = {
  primary: "melee",
  secondary: "melee",
  dash: "dash",
  skill: "mana",
  ultimate: "energy",
};

/** 銃の家系の左・右の系統 */
const GUN_KEYWORD: Keyword = "ranged";

/** 今の武器種を踏まえた、行動の系統 */
export function actionKeyword(state: Readonly<GameState>, action: BoonAction): Keyword {
  if ((action === "primary" || action === "secondary") && isGun(playerMoveset(state))) return GUN_KEYWORD;
  return ACTION_KEYWORD[action];
}

/** 乗る遺物の最大数（右の列に収まる数） */
export const RELICS_MAX = 4;

/** 行動の系統を源か糧に持つ装備中の遺物（部位の並び順。RELICS_MAX まで） */
export function relicsOnAction(state: Readonly<GameState>, action: BoonAction): { slot: LootSlot; item: Item }[] {
  const keyword = actionKeyword(state, action);
  const out: { slot: LootSlot; item: Item }[] = [];
  for (const slot of ATTIRE_SLOTS) {
    const item = state.profile.equipment[slot];
    if (!item) continue;
    const p = relicKeywords(item);
    if (p.produces.includes(keyword) || p.consumes.includes(keyword)) out.push({ slot, item });
  }
  return out.slice(0, RELICS_MAX);
}

/** その行動の加護が起こす系統（加護の produces の和。重複は 1 つ） */
export const FEEDS_MAX = 5;
export function feedsOfAction(state: Readonly<GameState>, action: BoonAction): Keyword[] {
  const out: Keyword[] = [];
  for (const key of gracesOf(state, action)) {
    for (const k of BOONS[key].keywords.produces) if (!out.includes(k)) out.push(k);
  }
  return out.slice(0, FEEDS_MAX);
}

// -----------------------------------------------------------------------------
// 座標（見本 E.html の drawAct）
// -----------------------------------------------------------------------------

export const ACTION_CHIP_W = 16;
export const ACTION_CHIP_H = 14;
const CHIP_X0 = 8;
const CHIP_PITCH = 22;
export const CHIP_Y = 20;

export function actionChipRect(index: number): Rect {
  return { x: CHIP_X0 + index * CHIP_PITCH, y: CHIP_Y, w: ACTION_CHIP_W, h: ACTION_CHIP_H };
}

/** 札（加護・乗る遺物）の寸法 */
export const CARD_W = 144;
export const CARD_H = 22;
const GRACE_X = 8;
const GRACE_Y0 = 52;
const GRACE_PITCH = 28;
const RELIC_X = 328;
const RELIC_Y0 = 52;
const RELIC_PITCH = 26;

export function graceRect(i: number): Rect {
  return { x: GRACE_X, y: GRACE_Y0 + i * GRACE_PITCH, w: CARD_W, h: CARD_H };
}

export function relicRect(i: number): Rect {
  return { x: RELIC_X, y: RELIC_Y0 + i * RELIC_PITCH, w: CARD_W, h: CARD_H };
}

/** 中央の行動の角枠（40px）の中心 */
export const EMBLEM = { cx: 240, cy: 92, size: 40 } as const;

/** 加護の枠の最大（BOON.graceSlotsMax。縦に収まる数） */
const GRACE_ROWS_MAX = 3;

/** 空き枠の焦点 id（加護が無い枠。書付は無い） */
export function emptyGraceId(i: number): string {
  return `empty:${i}`;
}

/** 行動の札に書く 1 字 */
export const ACTION_GLYPH: Readonly<Record<BoonAction, string>> = {
  primary: "左",
  secondary: "右",
  dash: "駆",
  skill: "技",
  ultimate: "奥",
};

// -----------------------------------------------------------------------------
// 当たり
// -----------------------------------------------------------------------------

/** 加護の枠の数（枠が加護より少ないことはないが、縦の収まりで止める） */
export function graceRows(state: Readonly<GameState>, action: BoonAction): number {
  return Math.min(GRACE_ROWS_MAX, Math.max(graceSlotsOf(state, action), gracesOf(state, action).length));
}

function expand(r: Readonly<Rect>, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function layoutOf(state: Readonly<GameState>, view: Readonly<ActView>): MenuHit[] {
  const hits: MenuHit[] = [];
  const graces = gracesOf(state, view.action);
  for (let i = 0; i < graceRows(state, view.action); i++) {
    const key = graces[i];
    const rect = graceRect(i);
    if (key === undefined) {
      hits.push({ id: emptyGraceId(i), rect, act: null, hold: null, nav: true });
      continue;
    }
    hits.push({ id: fid.grace(key), rect, act: { kind: "push", view: { kind: "sheet", focus: null, subject: { kind: "boon", key }, page: 0, offset: 0, forge: null } }, hold: null, nav: true });
  }
  relicsOnAction(state, view.action).forEach(({ slot }, i) => {
    hits.push({ id: fid.relic(slot), rect: relicRect(i), act: { kind: "focusPart", slot }, hold: null, nav: true });
  });
  BOON_ACTIONS.forEach((action, i) => {
    hits.push({ id: fid.action(action), rect: expand(actionChipRect(i), 1), act: { kind: "setAction", action }, hold: null, nav: true });
  });
  return hits;
}

// -----------------------------------------------------------------------------
// 荷札・見出し・書付
// -----------------------------------------------------------------------------

function isBoonKey(v: string | undefined): v is BoonKey {
  return v !== undefined && Object.prototype.hasOwnProperty.call(BOONS, v);
}

/** 焦点の加護 */
export function focusedGrace(focus: string | null): BoonKey | null {
  const key = fidArgs(focus, "grace")?.[0];
  return isBoonKey(key) ? key : null;
}

/** 焦点の乗る遺物の部位 */
export function focusedRelic(focus: string | null): LootSlot | null {
  const slot = fidArgs(focus, "relic")?.[0];
  return ATTIRE_SLOTS.find((s) => s === slot) ?? null;
}

/** 焦点の行動の札 */
export function focusedAction(focus: string | null): BoonAction | null {
  const a = fidArgs(focus, "action")?.[0];
  return BOON_ACTIONS.find((x) => x === a) ?? null;
}

function graceTag(key: BoonKey): MenuTag {
  const def = BOONS[key];
  const lineage = def.lineage === undefined ? "" : LINEAGE_LABEL[def.lineage];
  return { title: `${def.name}  ${lineage}の加護`, sub: def.desc, aside: null };
}

function relicTag(state: Readonly<GameState>, view: Readonly<ActView>, slot: LootSlot): MenuTag {
  const item = state.profile.equipment[slot];
  if (!item) return { ...EMPTY_TAG };
  const keyword = actionKeyword(state, view.action);
  const p = relicKeywords(item);
  const roles = [p.produces.includes(keyword) ? "源" : null, p.consumes.includes(keyword) ? "糧" : null].filter((r) => r !== null);
  return { title: `${item.name}  ${SLOT_LABEL[slot]}`, sub: `${KEYWORD_DEFS[keyword].label}系の${roles.join("・")}`, aside: null };
}

function pageTag(state: Readonly<GameState>, view: Readonly<ActView>): MenuTag {
  const label = BOON_ACTION_LABEL[view.action];
  const grace = focusedGrace(view.focus);
  if (grace !== null) return graceTag(grace);
  const relic = focusedRelic(view.focus);
  if (relic !== null) return relicTag(state, view, relic);
  if (fidArgs(view.focus, "empty") !== null) return { title: `${label}の加護の空き`, sub: "この行動に乗る祝福を取ると埋まる", aside: null };
  const action = focusedAction(view.focus);
  if (action !== null) return { title: `${BOON_ACTION_LABEL[action]}の加護`, sub: "この行動に乗る加護と遺物を見る", aside: null };
  return { ...EMPTY_TAG };
}

const GUIDE: readonly GuideVerb[] = ["move", "open", "back"];

function pageSheetFor(state: Readonly<GameState>, view: Readonly<ActView>): SheetSubject | null {
  const grace = focusedGrace(view.focus);
  if (grace !== null) return { kind: "boon", key: grace };
  const relic = focusedRelic(view.focus);
  const item = relic === null ? undefined : state.profile.equipment[relic];
  return item ? { kind: "item", itemId: item.id } : null;
}

export const ACT_VIEW: ViewModule<ActView> = {
  layout: (state, _ui, view) => layoutOf(state, view),
  act: (_state, ui, view, act) => {
    if (act.kind !== "setAction") return;
    view.action = act.action;
    view.focus = fid.action(act.action);
    ui.focusAt = ui.time;
  },
  header: (_state, _ui, view) => ({ crumbs: `加護　${BOON_ACTION_LABEL[view.action]}`, right: null }),
  tag: (state, _ui, view) => pageTag(state, view),
  guide: () => GUIDE,
  sheetFor: (state, view) => pageSheetFor(state, view),
  back: () => false,
  edge: () => false,
  leave: () => undefined,
};
