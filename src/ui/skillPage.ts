import { pushSfx, type GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, modifierLinkCost, slotLinks } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey } from "../skills/types";
import { type RuneMoveBlock, attachFromHand, detachToHand, moveRunModifier, runeMoveBlock } from "../system/skills";
import { type HandGroup, HAND_SORT_LABEL, RUNE_KIND_LABEL, handGroups, nextHandOptions, runeKindLabel } from "./handRunes";
import { showNote } from "./menuActions";
import { KEYWORD_DEFS } from "../core/keywords";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  HAND_SLOT,
  type GuideVerb,
  type HandOptionAxis,
  type HandOptions,
  type InventoryUi,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";
import { RUNE_BLOCK_TEXT, moveTarget, runeEntries } from "./skillRunes";

/**
 * 装備画面のスキルの頁（docs/ideas/inventory-v2/E-merged.md 6 章 W5、E-impl.md 4-3 E5）。
 * 腰の石 4 を列に並べ、石ごとの符の穴（リンク 4 / 3 / 2 / 2）を符で埋める。下の「手持ち」は拾った符（まだどのスキルにも付いていない）。
 * 符（手持ちでも付いている符でも）は決定で持ち上げ、付けられる列（金の破線）を選んで置く。付けられない列は沈めて見せる。
 * 持ち上げ中も state は何も変わらない（view.lift に覚えるだけ。戻るでやめる）ので、置くまでは取り消せる。
 * 長押しで付いている符を外す（手持ちへ戻る）。手持ちは絞り込み（種類・系統・付けられる物だけ）と並びを札で送る
 */

type SkillsView = ViewOf<"skills">;

// -----------------------------------------------------------------------------
// 座標（480x270 の論理座標。見本 E.html の COL_X / holeXY）
// -----------------------------------------------------------------------------

export const COL_Y = 22;
export const COL_W = 104;
export const COL_H = 112;
const COL_X0 = 14;
const COL_PITCH = 116;

export function colX(i: number): number {
  return COL_X0 + i * COL_PITCH;
}

/** 列の矩形（持ち上げ中の置き先の当たり） */
export function colRect(i: number): Rect {
  return { x: colX(i), y: COL_Y, w: COL_W, h: COL_H };
}

/** 石の菱形（24px）の左上と当たり */
export const STONE_DIAMOND = 24;
export function stoneDiamondPos(i: number): { x: number; y: number } {
  return { x: colX(i) + 40, y: COL_Y + 6 };
}
function stoneHitRect(i: number): Rect {
  return { x: colX(i) + 36, y: 26, w: 32, h: 40 };
}

/** 符の穴（16 × 28、ピッチ 20）の寸法と y。列の中央に寄せる */
export const HOLE_W = 16;
export const HOLE_H = 28;
const HOLE_PITCH = 20;
export const HOLE_Y = 92;
const COL_CENTER = 52;

/** 穴 pos（0 始まり）の x。リンクの本数ぶんの幅を列の中央に置く */
export function holeX(i: number, pos: number): number {
  const width = slotLinks(i) * HOLE_PITCH - (HOLE_PITCH - HOLE_W);
  return colX(i) + COL_CENTER - (width >> 1) + pos * HOLE_PITCH;
}

/** 手持ちの欄: 見出し（札の行）と符の格子。符は 18 × 28、横 18 枚 × 2 段（符の種類は 36 より少ない） */
export const HAND_LABEL = { x: 14, y: 138 } as const;
export const HAND_CHIPS: Readonly<Record<HandOptionAxis, Rect>> = {
  sort: { x: 60, y: 136, w: 44, h: 12 },
  kind: { x: 108, y: 136, w: 44, h: 12 },
  keyword: { x: 156, y: 136, w: 36, h: 12 },
  fit: { x: 196, y: 136, w: 56, h: 12 },
};
/** 札の並び順（方向キーで移る順・描く順） */
export const HAND_AXES: readonly HandOptionAxis[] = ["sort", "kind", "keyword", "fit"];
export const HAND_GRID = { x: 14, y: 154, pitchX: 24, pitchY: 34, cols: 18, rows: 2, w: 18, h: 28 } as const;
/** 持ち上げ中の符の浮かせる位置（手持ちの格子の右。見出しの行の右端に名札） */
export const LIFT_POS = { x: 452, y: 150 } as const;

/** 手持ちの i 番目（左上から右へ、段が替わる）の符の矩形 */
export function handRect(i: number): Rect {
  const col = i % HAND_GRID.cols;
  const row = Math.floor(i / HAND_GRID.cols);
  return { x: HAND_GRID.x + col * HAND_GRID.pitchX, y: HAND_GRID.y + row * HAND_GRID.pitchY, w: HAND_GRID.w, h: HAND_GRID.h };
}

/** 手持ちの欄に並ぶ符の数の上限（格子に収まる枚数。符の種類はこれより少ない） */
export const HAND_CAPACITY = HAND_GRID.cols * HAND_GRID.rows;

/** 今の手持ちの設定（頁が持っていなければ、開き直しても保つ設定） */
export function handOptionsOf(ui: Readonly<InventoryUi>, view: Readonly<ViewOf<"skills">>): HandOptions {
  return view.hand ?? ui.handPref;
}

/** 手持ちの欄に並ぶ符（束ねた 1 枚ずつ。絞り込みと並びを掛けた後） */
export function handEntries(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<ViewOf<"skills">>): HandGroup[] {
  return handGroups(state, handOptionsOf(ui, view)).slice(0, HAND_CAPACITY);
}

// -----------------------------------------------------------------------------
// 符の置き場（描画も当たりも同じ並びを使う）
// -----------------------------------------------------------------------------

export interface RunePlacement {
  slot: number;
  key: ModifierKey;
  /** 拾って付けた符（動かせる）。false = 祝福が足した符 */
  run: boolean;
  /** 占める穴の先頭（0 始まり）と本数（リンクの費用）。効かない符は 0 と 1 */
  pos: number;
  cost: number;
  rect: Rect;
}

/** 列に付いて効いている符。リンクの費用ぶん穴を占める（型替え符は 2） */
export function columnRunes(state: Readonly<GameState>, i: number): RunePlacement[] {
  const out: RunePlacement[] = [];
  let pos = 0;
  for (const entry of runeEntries(state, i)) {
    if (!entry.active) continue;
    const cost = modifierLinkCost(entry.key);
    out.push({ slot: i, key: entry.key, run: entry.run, pos, cost, rect: { x: holeX(i, pos), y: HOLE_Y, w: cost * HOLE_PITCH - (HOLE_PITCH - HOLE_W), h: HOLE_H } });
    pos += cost;
  }
  return out;
}

/** 符の焦点 id（穴に付いていれば穴。無ければ石） */
function runeFocusId(state: Readonly<GameState>, slot: number, key: ModifierKey): string {
  return columnRunes(state, slot).some((p) => p.key === key) ? fid.rune(slot, key) : fid.stone(slot);
}

function isModifierKey(v: string | undefined): v is ModifierKey {
  return v !== undefined && Object.prototype.hasOwnProperty.call(MODIFIERS, v);
}

/** 焦点の手持ちの符（無ければ null） */
export function focusedHand(focus: string | null): ModifierKey | null {
  const key = fidArgs(focus, "hand")?.[0];
  return isModifierKey(key) ? key : null;
}

/** 焦点の手持ちの設定の札（無ければ null） */
export function focusedHandOption(focus: string | null): HandOptionAxis | null {
  const axis = fidArgs(focus, "handopt")?.[0];
  return HAND_AXES.find((a) => a === axis) ?? null;
}

/** 焦点の符（穴に付いている符。符でなければ null） */
export function focusedRune(focus: string | null): { slot: number; key: ModifierKey } | null {
  const args = fidArgs(focus, "rune", 2);
  if (args === null) return null;
  const slot = Number(args[0]);
  const key = args[1];
  if (!Number.isInteger(slot) || slot < 0 || slot >= SKILL.slots || !isModifierKey(key)) return null;
  return { slot, key };
}

/** 焦点の石の列（石・列でなければ null） */
export function focusedColumn(focus: string | null): number | null {
  const raw = fidArgs(focus, "stone")?.[0] ?? fidArgs(focus, "col")?.[0];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < SKILL.slots ? n : null;
}


// -----------------------------------------------------------------------------
// 当たり
// -----------------------------------------------------------------------------

function expand(r: Readonly<Rect>): Rect {
  return { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
}

/** 符の当たり。決定 = 持ち上げ、長押し = 外して手持ちへ戻す（祝福の符は外せないので長押しにしない） */
function runeHit(id: string, p: Readonly<RunePlacement>): MenuHit {
  return {
    id,
    rect: expand(p.rect),
    act: { kind: "liftRune", slot: p.slot, key: p.key },
    hold: p.run ? { kind: "removeRune", slot: p.slot, key: p.key } : null,
    nav: true,
  };
}

/** 手持ちの設定の札（決定で次の値へ送る） */
function handOptionHits(): MenuHit[] {
  return HAND_AXES.map((axis) => ({ id: fid.handOpt(axis), rect: HAND_CHIPS[axis], act: { kind: "cycleHand", axis }, hold: null, nav: true }));
}

/** 手持ちの符の当たり（決定で持ち上げ。付ける先は持ち上げてから選ぶ） */
function handHits(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SkillsView>): MenuHit[] {
  return handEntries(state, ui, view).map((g, i) => ({
    id: fid.hand(g.key),
    rect: expand(handRect(i)),
    act: { kind: "liftHand", key: g.key },
    hold: null,
    nav: true,
  }));
}

function plainHits(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SkillsView>): MenuHit[] {
  const hits: MenuHit[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    const target = { kind: "stone" as const, index: i };
    hits.push({
      id: fid.stone(i),
      rect: stoneHitRect(i),
      act: { kind: "push", view: { kind: "candidates", focus: null, target, sort: ui.sortPref, offset: 0, order: null, pinnedId: null } },
      hold: null,
      nav: true,
      // 掴んで別の列へ落とすと石を入れ替える（落とし先は列全体）
      drag: { kind: "stone", index: i, zone: colRect(i) },
    });
  }
  for (let i = 0; i < SKILL.slots; i++) {
    for (const p of columnRunes(state, i)) hits.push(runeHit(fid.rune(i, p.key), p));
  }
  hits.push(...handOptionHits(), ...handHits(state, ui, view));
  return hits;
}

/** 持ち上げ中は置き先の列だけが当たり（焦点が列を渡る） */
function liftHits(): MenuHit[] {
  const hits: MenuHit[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    hits.push({ id: fid.col(i), rect: colRect(i), act: { kind: "placeRune", slot: i }, hold: null, nav: true });
  }
  return hits;
}

// -----------------------------------------------------------------------------
// 操作
// -----------------------------------------------------------------------------

/** 付けられない理由（RuneMoveBlock）。表示は常体の短文 */
export const PLACE_BLOCK_TEXT: Readonly<Record<RuneMoveBlock, string>> = {
  noStone: "石の無い列には付けられません",
  notFit: "この石には付けられません",
  duplicate: "同じ符が付いています",
  noLinks: "リンクの空きがありません",
  reshape: "型替えの符は 1 枚までです",
  clash: "同時に効かない符が付いています",
};

function touchFocus(ui: InventoryUi): void {
  ui.focusAt = ui.time;
}

/** 手持ちの符を持ち上げたときの最初の焦点の列（付けられる最初の列。無ければ先頭の列で、沈んだ列が並ぶ） */
export function firstPlaceableColumn(state: Readonly<GameState>, key: ModifierKey): number {
  for (let i = 0; i < SKILL.slots; i++) if (runeMoveBlock(state.skills, i, key) === null) return i;
  return 0;
}

function liftHand(state: GameState, ui: InventoryUi, view: SkillsView, key: ModifierKey): void {
  if (!state.skills.hand.includes(key)) return;
  view.lift = { slot: HAND_SLOT, key };
  view.focus = fid.col(firstPlaceableColumn(state, key));
  ui.hold = null;
  touchFocus(ui);
  pushSfx(state, "uiClick");
}

function liftRune(state: GameState, ui: InventoryUi, view: SkillsView, slot: number, key: ModifierKey): void {
  const entry = runeEntries(state, slot).find((e) => e.key === key);
  if (entry === undefined) return;
  if (!entry.run) {
    showNote(ui, RUNE_BLOCK_TEXT.granted);
    return;
  }
  view.lift = { slot, key };
  view.focus = fid.col(moveTarget(state, slot, key) ?? slot);
  ui.hold = null;
  touchFocus(ui);
  pushSfx(state, "uiClick");
}

/** 手持ちから付ける。付けられなければ理由を知らせて持ち上げたまま */
function attachHeld(state: GameState, ui: InventoryUi, view: SkillsView, key: ModifierKey, to: number): void {
  const result = attachFromHand(state, to, key);
  if (result !== "ok") {
    showNote(ui, result === "missing" ? RUNE_BLOCK_TEXT.missing : PLACE_BLOCK_TEXT[result]);
    return;
  }
  view.lift = null;
  view.focus = runeFocusId(state, to, key);
  touchFocus(ui);
  pushSfx(state, "runeAttach");
  showNote(ui, `${MODIFIERS[key].name} を スキル ${to + 1} へ付けた`);
}

function placeRune(state: GameState, ui: InventoryUi, view: SkillsView, to: number): void {
  const lift = view.lift;
  if (lift === null) return;
  if (lift.slot === HAND_SLOT) {
    attachHeld(state, ui, view, lift.key, to);
    return;
  }
  if (to === lift.slot) {
    cancelLift(ui, state, view);
    return;
  }
  const result = moveRunModifier(state.skills, lift.slot, to, lift.key);
  if (result !== "ok") {
    showNote(ui, result === "missing" ? RUNE_BLOCK_TEXT.missing : PLACE_BLOCK_TEXT[result]);
    return;
  }
  view.lift = null;
  view.focus = runeFocusId(state, to, lift.key);
  touchFocus(ui);
  pushSfx(state, "runeAttach");
  showNote(ui, `${MODIFIERS[lift.key].name} を スキル ${to + 1} へ移した`);
}

function removeRune(state: GameState, ui: InventoryUi, view: SkillsView, slot: number, key: ModifierKey): void {
  const entry = runeEntries(state, slot).find((e) => e.key === key);
  if (entry === undefined) return;
  if (!entry.run) {
    showNote(ui, RUNE_BLOCK_TEXT.granted);
    return;
  }
  if (!detachToHand(state, slot, key)) {
    showNote(ui, RUNE_BLOCK_TEXT.missing);
    return;
  }
  view.focus = fid.stone(slot);
  touchFocus(ui);
  pushSfx(state, "dismantle");
  showNote(ui, `${MODIFIERS[key].name} を手持ちへ戻した`);
}

/** 持ち上げをやめる（state は変えていないので、元の符の焦点へ戻すだけ） */
function cancelLift(ui: InventoryUi, state: Readonly<GameState>, view: SkillsView): void {
  const lift = view.lift;
  if (lift === null) return;
  view.lift = null;
  if (lift.slot === HAND_SLOT) {
    view.focus = state.skills.hand.includes(lift.key) ? fid.hand(lift.key) : fid.stone(0);
  } else {
    view.focus = columnRunes(state, lift.slot).some((p) => p.key === lift.key) ? fid.rune(lift.slot, lift.key) : fid.stone(lift.slot);
  }
  touchFocus(ui);
}

/** 手持ちの札を 1 つ送る（絞り込み・並びを替える。開き直しても保つ） */
function cycleHand(state: GameState, ui: InventoryUi, view: SkillsView, axis: HandOptionAxis): void {
  const next = nextHandOptions(state, handOptionsOf(ui, view), axis);
  view.hand = next;
  ui.handPref = next;
  view.focus = fid.handOpt(axis);
  touchFocus(ui);
  pushSfx(state, "uiClick");
}

// -----------------------------------------------------------------------------
// 荷札・見出し・書付
// -----------------------------------------------------------------------------

const EMPTY_STONE = "空き";
const GRANTED_LABEL = "祝福の符";
const HOLD_HINT = "長押しで外す";
const PLACE_OK_TEXT = "金の破線の列に付けられる";
const PLACE_BACK_TEXT = "ここに戻す（持ち上げをやめる）";
const HAND_HINT = "決定で持ち上げて付ける";
const HAND_ALL = "全て";
/** 見出しと名札（描画も使う） */
export const HAND_LABEL_TEXT = "手持ち";
export const LIFTED_LABEL = "持ち上げ中";

function stoneTag(state: Readonly<GameState>, i: number): MenuTag {
  const head = `スキル ${i + 1}`;
  const stone = stoneInSlot(state.skills.profile, i);
  if (stone === null) return { title: `${head}  ${EMPTY_STONE}`, sub: "", aside: null };
  const def = SKILL_DEFS[stone.skillKey];
  return { title: `${head}  ${def.name}`, sub: def.verb, aside: null };
}

function runeTag(state: Readonly<GameState>, rune: Readonly<{ slot: number; key: ModifierKey }>): MenuTag {
  const def = MODIFIERS[rune.key];
  const entry = runeEntries(state, rune.slot).find((e) => e.key === rune.key);
  const aside = entry?.run === true ? HOLD_HINT : GRANTED_LABEL;
  return { title: `${def.name}  ${runeKindLabel(rune.key)}`, sub: def.verb, aside };
}

function handTag(state: Readonly<GameState>, key: ModifierKey): MenuTag {
  const def = MODIFIERS[key];
  const count = state.skills.hand.filter((k) => k === key).length;
  return { title: `${def.name}  ${runeKindLabel(key)}  ${HAND_LABEL_TEXT} ×${count}`, sub: def.verb, aside: HAND_HINT };
}

function handOptionTag(options: Readonly<HandOptions>, axis: HandOptionAxis): MenuTag {
  const keyword = options.keyword === null ? HAND_ALL : `${KEYWORD_DEFS[options.keyword].label}系`;
  switch (axis) {
    case "sort":
      return { title: `並び  ${HAND_SORT_LABEL[options.sort]}`, sub: "決定で次の並びへ", aside: null };
    case "kind":
      return { title: `種類で絞る  ${options.kind === null ? HAND_ALL : RUNE_KIND_LABEL[options.kind]}`, sub: "決定で次の種類へ", aside: null };
    case "keyword":
      return { title: `系統で絞る  ${keyword}`, sub: "決定で次の系統へ", aside: null };
    case "fit":
      return { title: `付けられる物だけ  ${options.fitOnly ? "入" : "切"}`, sub: "決定で入れ替える", aside: null };
  }
}

function liftTag(state: Readonly<GameState>, view: Readonly<SkillsView>, lift: Readonly<{ slot: number; key: ModifierKey }>): MenuTag {
  const title = `${MODIFIERS[lift.key].name}  ${LIFTED_LABEL}`;
  const col = focusedColumn(view.focus);
  if (col === null) return { title, sub: "", aside: null };
  if (col === lift.slot) return { title, sub: PLACE_BACK_TEXT, aside: null };
  const block = runeMoveBlock(state.skills, col, lift.key);
  return { title, sub: block === null ? PLACE_OK_TEXT : PLACE_BLOCK_TEXT[block], aside: null };
}

function pageTag(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SkillsView>): MenuTag {
  if (view.lift !== null) return liftTag(state, view, view.lift);
  const rune = focusedRune(view.focus);
  if (rune !== null) return runeTag(state, rune);
  const held = focusedHand(view.focus);
  if (held !== null) return handTag(state, held);
  const option = focusedHandOption(view.focus);
  if (option !== null) return handOptionTag(handOptionsOf(ui, view), option);
  const stone = focusedColumn(view.focus);
  if (stone !== null) return stoneTag(state, stone);
  return { ...EMPTY_TAG };
}

const PLAIN_GUIDE: readonly GuideVerb[] = ["move", "open", "sort", "sheet", "face", "back"];
const LIFT_GUIDE: readonly GuideVerb[] = ["move", "place", "cancel"];

function pageSheetFor(state: Readonly<GameState>, view: Readonly<SkillsView>): SheetSubject | null {
  if (view.lift !== null) return null;
  const rune = focusedRune(view.focus);
  if (rune !== null) return { kind: "rune", key: rune.key };
  const held = focusedHand(view.focus);
  if (held !== null) return { kind: "rune", key: held };
  const i = focusedColumn(view.focus);
  if (i === null) return null;
  const stone = stoneInSlot(state.skills.profile, i);
  return stone === null ? null : { kind: "stone", stoneId: stone.id };
}

export const SKILLS_VIEW: ViewModule<SkillsView> = {
  layout: (state, ui, view) => (view.lift !== null ? liftHits() : plainHits(state, ui, view)),
  act: (state, ui, view, act) => {
    switch (act.kind) {
      case "liftRune":
        liftRune(state, ui, view, act.slot, act.key);
        return;
      case "liftHand":
        liftHand(state, ui, view, act.key);
        return;
      case "placeRune":
        placeRune(state, ui, view, act.slot);
        return;
      case "removeRune":
        removeRune(state, ui, view, act.slot, act.key);
        return;
      case "cycleHand":
        cycleHand(state, ui, view, act.axis);
        return;
      default:
        return;
    }
  },
  header: () => ({ crumbs: "スキル", right: null }),
  tag: (state, ui, view) => pageTag(state, ui, view),
  guide: (_state, view) => (view.lift !== null ? LIFT_GUIDE : PLAIN_GUIDE),
  sheetFor: (state, view) => pageSheetFor(state, view),
  back: (state, ui, view) => {
    if (view.lift === null) return false;
    cancelLift(ui, state, view);
    return true;
  },
  edge: () => false,
  leave: () => undefined,
};
