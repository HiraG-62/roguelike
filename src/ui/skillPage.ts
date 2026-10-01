import { pushSfx, type GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, modifierLinkCost, slotLinks } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierFamily, ModifierKey } from "../skills/types";
import { type RuneMoveBlock, moveRunModifier, removeRunModifier, runeMoveBlock } from "../system/skills";
import { showNote } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type GuideVerb,
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
 * 腰の石 4 を列に並べ、石ごとの符の穴（リンク 4 / 3 / 2 / 2）を符で埋める。符は決定で持ち上げ、置ける列を選んで置く。
 * 持ち上げ中も state は何も変わらない（view.lift に覚えるだけ。戻るでやめる）ので、置くまでは取り消せる。
 * 長押しで符を外す（外すと消える）。今の石に効かない符は下の列に並べる
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

/** 効かない符の列と、持ち上げ中の符の浮かせる位置 */
export const LOOSE_Y = 140;
export const LOOSE_LABEL_X = 14;
const LOOSE_X0 = 76;
const LOOSE_PITCH = 22;
const LOOSE_MAX = 16;
export const LIFT_POS = { x: 452, y: 140 } as const;

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

/** 今の石に効かない符（どの列に付いていても下の 1 列に並べる） */
export function looseRunes(state: Readonly<GameState>): RunePlacement[] {
  const out: RunePlacement[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    for (const entry of runeEntries(state, i)) {
      if (entry.active) continue;
      out.push({ slot: i, key: entry.key, run: entry.run, pos: 0, cost: 1, rect: { x: LOOSE_X0 + out.length * LOOSE_PITCH, y: LOOSE_Y, w: HOLE_W, h: HOLE_H } });
    }
  }
  return out.slice(0, LOOSE_MAX);
}

/** その列に付いている符（効く・効かないを問わない。無ければ null） */
function placementOf(state: Readonly<GameState>, slot: number, key: ModifierKey): RunePlacement | null {
  const found = [...columnRunes(state, slot), ...looseRunes(state)].find((p) => p.slot === slot && p.key === key);
  return found ?? null;
}

/** 符の焦点 id（効いていれば穴、効かなければ下の列） */
function runeFocusId(state: Readonly<GameState>, slot: number, key: ModifierKey): string {
  const active = columnRunes(state, slot).some((p) => p.key === key);
  return active ? fid.rune(slot, key) : fid.loose(slot, key);
}

function isModifierKey(v: string | undefined): v is ModifierKey {
  return v !== undefined && Object.prototype.hasOwnProperty.call(MODIFIERS, v);
}

/** 焦点の符（穴か効かない符。符でなければ null） */
export function focusedRune(focus: string | null): { slot: number; key: ModifierKey } | null {
  const args = fidArgs(focus, "rune", 2) ?? fidArgs(focus, "loose", 2);
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

/** 符の当たり。決定 = 持ち上げ、長押し = 外す（祝福の符は外せないので長押しにしない） */
function runeHit(id: string, p: Readonly<RunePlacement>): MenuHit {
  return {
    id,
    rect: expand(p.rect),
    act: { kind: "liftRune", slot: p.slot, key: p.key },
    hold: p.run ? { kind: "removeRune", slot: p.slot, key: p.key } : null,
    nav: true,
  };
}

function plainHits(state: Readonly<GameState>, ui: Readonly<InventoryUi>): MenuHit[] {
  const hits: MenuHit[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    const target = { kind: "stone" as const, index: i };
    hits.push({
      id: fid.stone(i),
      rect: stoneHitRect(i),
      act: { kind: "push", view: { kind: "candidates", focus: null, target, sort: ui.sortPref, offset: 0, order: null, pinnedId: null } },
      hold: null,
      nav: true,
    });
  }
  for (let i = 0; i < SKILL.slots; i++) {
    for (const p of columnRunes(state, i)) hits.push(runeHit(fid.rune(i, p.key), p));
  }
  for (const p of looseRunes(state)) hits.push(runeHit(fid.loose(p.slot, p.key), p));
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

/** 置けない理由（RuneMoveBlock）。表示は常体の短文 */
export const PLACE_BLOCK_TEXT: Readonly<Record<RuneMoveBlock, string>> = {
  noStone: "石の無い列には置けません",
  notFit: "この石には付けられません",
  duplicate: "同じ符が付いています",
  noLinks: "リンクの空きがありません",
  reshape: "型替えの符は 1 枚までです",
  clash: "同時に効かない符が付いています",
};

function touchFocus(ui: InventoryUi): void {
  ui.focusAt = ui.time;
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

function placeRune(state: GameState, ui: InventoryUi, view: SkillsView, to: number): void {
  const lift = view.lift;
  if (lift === null) return;
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
  if (!removeRunModifier(state.skills, slot, key)) {
    showNote(ui, RUNE_BLOCK_TEXT.missing);
    return;
  }
  view.focus = fid.stone(slot);
  touchFocus(ui);
  pushSfx(state, "dismantle");
  showNote(ui, `${MODIFIERS[key].name} を外した`);
}

/** 持ち上げをやめる（state は変えていないので、元の符の焦点へ戻すだけ） */
function cancelLift(ui: InventoryUi, state: Readonly<GameState>, view: SkillsView): void {
  const lift = view.lift;
  if (lift === null) return;
  view.lift = null;
  view.focus = placementOf(state, lift.slot, lift.key) === null ? fid.stone(lift.slot) : runeFocusId(state, lift.slot, lift.key);
  touchFocus(ui);
}

// -----------------------------------------------------------------------------
// 荷札・見出し・書付
// -----------------------------------------------------------------------------

const EMPTY_STONE = "空き";
const RUNE_FAMILY_LABEL: Readonly<Record<ModifierFamily, string>> = { shape: "変形", cycle: "循環" };
const RUNE_PLAIN_LABEL = "刻印符";
const LOOSE_LABEL = "効かない符";
const GRANTED_LABEL = "祝福の符";
const HOLD_HINT = "長押しで外す";
const LIFTED_LABEL = "持ち上げ中";
const PLACE_OK_TEXT = "金の破線の列に置ける";
const PLACE_BACK_TEXT = "ここに戻す（持ち上げをやめる）";

function stoneTag(state: Readonly<GameState>, i: number): MenuTag {
  const head = `スキル ${i + 1}`;
  const stone = stoneInSlot(state.skills.profile, i);
  if (stone === null) return { title: `${head}  ${EMPTY_STONE}`, sub: "", aside: null };
  const def = SKILL_DEFS[stone.skillKey];
  return { title: `${head}  ${def.name}`, sub: def.verb, aside: null };
}

function runeTag(state: Readonly<GameState>, rune: Readonly<{ slot: number; key: ModifierKey }>, loose: boolean): MenuTag {
  const def = MODIFIERS[rune.key];
  const entry = runeEntries(state, rune.slot).find((e) => e.key === rune.key);
  const family = def.family === undefined ? RUNE_PLAIN_LABEL : RUNE_FAMILY_LABEL[def.family];
  const title = `${def.name}  ${loose ? LOOSE_LABEL : family}`;
  const aside = entry?.run === true ? HOLD_HINT : GRANTED_LABEL;
  return { title, sub: def.verb, aside };
}

function liftTag(state: Readonly<GameState>, view: Readonly<SkillsView>, lift: Readonly<{ slot: number; key: ModifierKey }>): MenuTag {
  const title = `${MODIFIERS[lift.key].name}  ${LIFTED_LABEL}`;
  const col = focusedColumn(view.focus);
  if (col === null) return { title, sub: "", aside: null };
  if (col === lift.slot) return { title, sub: PLACE_BACK_TEXT, aside: null };
  const block = runeMoveBlock(state.skills, col, lift.key);
  return { title, sub: block === null ? PLACE_OK_TEXT : PLACE_BLOCK_TEXT[block], aside: null };
}

function pageTag(state: Readonly<GameState>, view: Readonly<SkillsView>): MenuTag {
  if (view.lift !== null) return liftTag(state, view, view.lift);
  const rune = focusedRune(view.focus);
  if (rune !== null) return runeTag(state, rune, fidArgs(view.focus, "loose") !== null);
  const stone = focusedColumn(view.focus);
  if (stone !== null) return stoneTag(state, stone);
  return { ...EMPTY_TAG };
}

const PLAIN_GUIDE: readonly GuideVerb[] = ["move", "open", "sheet", "face", "back"];
const LIFT_GUIDE: readonly GuideVerb[] = ["move", "place", "cancel"];

function pageSheetFor(state: Readonly<GameState>, view: Readonly<SkillsView>): SheetSubject | null {
  if (view.lift !== null) return null;
  const rune = focusedRune(view.focus);
  if (rune !== null) return { kind: "rune", key: rune.key };
  const i = focusedColumn(view.focus);
  if (i === null) return null;
  const stone = stoneInSlot(state.skills.profile, i);
  return stone === null ? null : { kind: "stone", stoneId: stone.id };
}

export const SKILLS_VIEW: ViewModule<SkillsView> = {
  layout: (state, ui, view) => (view.lift !== null ? liftHits() : plainHits(state, ui)),
  act: (state, ui, view, act) => {
    switch (act.kind) {
      case "liftRune":
        liftRune(state, ui, view, act.slot, act.key);
        return;
      case "placeRune":
        placeRune(state, ui, view, act.slot);
        return;
      case "removeRune":
        removeRune(state, ui, view, act.slot, act.key);
        return;
      default:
        return;
    }
  },
  header: () => ({ crumbs: "スキル", right: null }),
  tag: (state, _ui, view) => pageTag(state, view),
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
