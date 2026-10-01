import { type GameState, pushSfx } from "../core/state";
import { ULTIMATES } from "../data/ultimates";
import { MOVESETS } from "../data/weapons";
import { ECHO_OPS, ECHO_OP_HINT, ECHO_OP_LABEL, type EchoOp } from "../loot/crafting";
import { ATTR_KEYS, ATTR_LABEL, LOOT_SLOTS, type AttrKey, type Item } from "../loot/types";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { BOONS, LINEAGE_LABEL } from "../system/boonDefs";
import {
  FORGE_STEP_PROMPT,
  executeForge,
  forgeCostText,
  forgeDonor,
  forgeItem,
  forgeOpBlock,
  forgePartners,
  forgePickLabel,
  forgePickOptions,
  forgeReceiver,
  forgeStep,
  isEquippedItem,
  newForgeSession,
} from "./forge";
import { SLOT_LABEL } from "./inventoryLayout";
import { popView, showNote } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type FocusId,
  type ForgePick,
  type ForgeSession,
  type GuideVerb,
  type InventoryUi,
  type MenuAct,
  type MenuHeader,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";
import {
  ULTIMATE_KIND_LABEL,
  bodyActions,
  canChooseUltimate,
  chooseUltimateAt,
  sheetMoveset,
  ultimateCostOf,
} from "./sheetBody";

/**
 * 書付（1 品・見開き・体・祝福・系譜・刻印符の全文と数字。情報の予算の外。docs/ideas/inventory-v2/E-impl.md 4-3 E6、E-merged.md 6 章 W8）。
 * 当たりがあるのは 1 品の下端の鍛冶の操作 5（forge.ts の手続き）と、体の頁の札・行動の行・内訳のステータスの行・奥義の札だけ。文の並びは render/sheetUi.ts。
 * 1 品の鍛冶は 操作 → 相手（注ぎ・移し。5 件ずつ）→ 選ぶ行（性質・銘・芽）→ 実行。砕くは長押しでだけ実行する。
 * view.offset は頁ごとに読み替える: 相手の並びの先頭 / 体の行動の行の送り（行単位）/ 奥義の武器種の送り（拠点だけ）。内訳の頁は使わない
 */

type SheetView = ViewOf<"sheet">;

// -----------------------------------------------------------------------------
// 配置（480x270 の論理座標。描画 render/sheetUi.ts と共有する）
// -----------------------------------------------------------------------------

/** 書付の紙（見出しの区切りの下〜荷札の上） */
export const SHEET_CARD: Rect = { x: 8, y: 20, w: 464, h: 196 };
/** 見開きの左右の頁 */
export const PAIR_PAGES: readonly [Rect, Rect] = [
  { x: 8, y: 20, w: 228, h: 196 },
  { x: 244, y: 20, w: 228, h: 196 },
];
/** 1 品: 名前・副題・区切りの y（上端） */
export const ITEM_NAME_Y = 23;
export const ITEM_SUB_Y = 36;
export const ITEM_RULE_Y = 47;
/** 1 品の本文（性質の全文〜来歴。選ぶ行・相手の並びもここに出す） */
export const ITEM_BODY: Rect = { x: 16, y: 51, w: 448, h: 127 };
/** 選ぶ行（性質・銘・芽）の 1 行 */
export const PICK_ROW_H = 12;
/** 相手の札（5 件ずつ） */
export const PARTNER_PAGE = 5;
const PARTNER_PITCH = 24;
const PARTNER_H = 21;
/** 操作の札 5（下端）と実行の札、費用と残響の量の行 */
const OP_X0 = 16;
const OP_PITCH = 56;
const OP_Y = 182;
const OP_W = 52;
const OP_H = 14;
export const FORGE_EXEC_RECT: Rect = { x: 304, y: OP_Y, w: 64, h: OP_H };
export const FORGE_COST_Y = 201;

export function forgeOpRect(i: number): Rect {
  return { x: OP_X0 + i * OP_PITCH, y: OP_Y, w: OP_W, h: OP_H };
}

export function pickRowRect(i: number): Rect {
  return { x: ITEM_BODY.x, y: ITEM_BODY.y + i * PICK_ROW_H, w: ITEM_BODY.w, h: PICK_ROW_H };
}

/** 本文に並べられる選ぶ行の数 */
export const PICK_ROWS_MAX = Math.floor(ITEM_BODY.h / PICK_ROW_H);

export function partnerRect(i: number): Rect {
  return { x: ITEM_BODY.x, y: ITEM_BODY.y + i * PARTNER_PITCH, w: ITEM_BODY.w, h: PARTNER_H };
}

/** 体の書付の頁の札 [体][内訳][奥義] */
export const BODY_PAGES = ["体", "内訳", "奥義"] as const;
export const BODY_PAGE_STATUS = 0;
export const BODY_PAGE_BREAKDOWN = 1;
export const BODY_PAGE_ULTIMATE = 2;
export function pageTabRect(n: number): Rect {
  return { x: 8 + n * 34, y: 20, w: 30, h: 12 };
}
/** 体の頁の紙（頁の札の下） */
export const BODY_CARD: Rect = { x: 8, y: 34, w: 464, h: 182 };
/** ステータスと出どころ（左）・体の性能（右）・到達（左の下） */
export const BODY_ATTR_RECT: Rect = { x: 16, y: 38, w: 220, h: 72 };
export const BODY_DERIVED_RECT: Rect = { x: 248, y: 38, w: 216, h: 100 };
export const BODY_REACH_Y = 114;
export const BODY_REACH_MAX = 3;
/** 行動の行（4 列 × 3 段が見え、多ければ段ごとに送る）と、焦点の行動の計算式 */
export const ACTION_COLS = 4;
export const ACTION_ROWS_VISIBLE = 3;
const ACTION_X0 = 16;
const ACTION_Y0 = 146;
const ACTION_W = 110;
const ACTION_H = 11;
const ACTION_PITCH_X = 112;
const ACTION_PITCH_Y = 12;
export const BODY_FORMULA_RECT: Rect = { x: 16, y: 184, w: 448, h: 30 };

export function actionRect(visibleIndex: number): Rect {
  const col = visibleIndex % ACTION_COLS;
  const row = Math.floor(visibleIndex / ACTION_COLS);
  return { x: ACTION_X0 + col * ACTION_PITCH_X, y: ACTION_Y0 + row * ACTION_PITCH_Y, w: ACTION_W, h: ACTION_H };
}

/**
 * 内訳の頁: 左にステータスの行（焦点で選ぶ）とその出どころ、右に焦点のステータスを参照する行動と、下に攻撃に掛かる増と倍。
 * 増と倍はステータスでなく攻撃の種類（近接・射撃）に掛かるので、焦点によらず出す
 */
const BREAKDOWN_ROW_H = 12;
export const BREAKDOWN_STAT_X = 16;
export const BREAKDOWN_STAT_W = 128;
export const BREAKDOWN_SOURCE_RECT: Rect = { x: 16, y: 114, w: 128, h: 96 };
export const BREAKDOWN_REF_RECT: Rect = { x: 152, y: 38, w: 312, h: 104 };
export const BREAKDOWN_RULE_Y = 144;
export const BREAKDOWN_MOD_HEAD_Y = 148;
export const BREAKDOWN_MOD_RECT: Rect = { x: 152, y: 158, w: 312, h: 54 };

export function breakdownStatRect(i: number): Rect {
  return { x: BREAKDOWN_STAT_X, y: 38 + i * BREAKDOWN_ROW_H, w: BREAKDOWN_STAT_W, h: BREAKDOWN_ROW_H };
}

/** 奥義の頁: 武器種の送り（拠点だけ）と奥義の札 3 */
export const MOVESET_ARROWS: Readonly<Record<-1 | 1, Rect>> = {
  [-1]: { x: 16, y: 38, w: 16, h: 12 },
  [1]: { x: 448, y: 38, w: 16, h: 12 },
};
export const ULT_HEAD_Y = 40;
export function ultCardRect(i: number): Rect {
  return { x: 16 + i * 152, y: 56, w: 144, h: 154 };
}

// -----------------------------------------------------------------------------
// 物の引き当て（描画も読む）
// -----------------------------------------------------------------------------

/** 倉庫か装備中の遺物（借り物も出す。書付は読むだけの頁なので） */
export function sheetItem(state: Readonly<GameState>, id: string): Item | null {
  const inStash = state.profile.stash.find((it) => it.id === id);
  if (inStash !== undefined) return inStash;
  for (const slot of LOOT_SLOTS) {
    const eq = state.profile.equipment[slot];
    if (eq?.id === id) return eq;
  }
  return null;
}

export function sheetStone(state: Readonly<GameState>, id: string): SkillStone | null {
  return state.skills.profile.stones.find((s) => s.id === id) ?? null;
}

/** 見開きの 2 頁（左 = 候補、右 = 今。今が空きなら null） */
export function pairItems(state: Readonly<GameState>, subject: Extract<SheetSubject, { kind: "pair" }>): { candidate: Item | null; current: Item | null } {
  return { candidate: sheetItem(state, subject.itemId), current: state.profile.equipment[subject.slot] ?? null };
}

export function pairStones(state: Readonly<GameState>, subject: Extract<SheetSubject, { kind: "stonePair" }>): { candidate: SkillStone | null; current: SkillStone | null } {
  return { candidate: sheetStone(state, subject.stoneId), current: stoneInSlot(state.skills.profile, subject.index) };
}

/** 1 品の書付の物（1 品でなければ null） */
export function sheetItemOf(state: Readonly<GameState>, view: Readonly<SheetView>): Item | null {
  return view.subject.kind === "item" ? sheetItem(state, view.subject.itemId) : null;
}

// -----------------------------------------------------------------------------
// 当たり
// -----------------------------------------------------------------------------

function hit(id: FocusId, rect: Rect, act: MenuAct | null, hold: MenuAct | null = null): MenuHit {
  return { id, rect, act, hold, nav: true };
}

function opHits(state: Readonly<GameState>, item: Readonly<Item>): MenuHit[] {
  if (forgeItem(state.profile, item.id) === null) return [];
  return ECHO_OPS.map((op, i) => hit(fid.op(op), forgeOpRect(i), { kind: "forgeOp", op }));
}

function partnerHits(state: Readonly<GameState>, view: Readonly<SheetView>, session: Readonly<ForgeSession>): MenuHit[] {
  return forgePartners(state.profile, session)
    .slice(view.offset, view.offset + PARTNER_PAGE)
    .map((it, i) => hit(fid.partner(it.id), partnerRect(i), { kind: "forgePartner", itemId: it.id }));
}

function pickHits(state: Readonly<GameState>, session: Readonly<ForgeSession>): MenuHit[] {
  return forgePickOptions(state.profile, session)
    .slice(0, PICK_ROWS_MAX)
    .map((pick, i) => hit(fid.trait(i), pickRowRect(i), { kind: "forgePick", pick }));
}

/** 実行の札。砕くは長押しでだけ実行する（誤って砕かない） */
function execHit(op: EchoOp): MenuHit {
  const run: MenuAct = { kind: "forgeExecute" };
  return op === "shatter" ? hit(fid.exec, FORGE_EXEC_RECT, null, run) : hit(fid.exec, FORGE_EXEC_RECT, run);
}

function forgeHits(state: Readonly<GameState>, view: Readonly<SheetView>, session: Readonly<ForgeSession>): MenuHit[] {
  const step = forgeStep(state.profile, session);
  const hits: MenuHit[] = [];
  if (step === "partner") hits.push(...partnerHits(state, view, session));
  if (step === "pick") hits.push(...pickHits(state, session));
  if (session.op !== null) hits.push(execHit(session.op));
  return hits;
}

function itemHits(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  const item = sheetItemOf(state, view);
  if (item === null) return [];
  const session = view.forge;
  const lists = session === null ? [] : forgeHits(state, view, session);
  // 選ぶ段の行を先に置く（積んだ直後の焦点がその段の先頭に乗る）
  return [...lists, ...opHits(state, item)];
}

function pageHits(): MenuHit[] {
  return BODY_PAGES.map((_, n) => hit(fid.page(n), pageTabRect(n), { kind: "sheetPage", page: n }));
}

/** 行動の行の段数 */
export function actionRowCount(state: Readonly<GameState>): number {
  return Math.ceil(bodyActions(state).length / ACTION_COLS);
}

/** 見えている行動の行の添字（view.offset 段から 3 段） */
export function visibleActionIndices(state: Readonly<GameState>, view: Readonly<SheetView>): number[] {
  const n = bodyActions(state).length;
  const start = view.offset * ACTION_COLS;
  const end = Math.min(n, start + ACTION_COLS * ACTION_ROWS_VISIBLE);
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

function statusPageHits(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  return visibleActionIndices(state, view).map((index, i) => hit(fid.row(index), actionRect(i), null));
}

function breakdownPageHits(): MenuHit[] {
  return ATTR_KEYS.map((_, i) => hit(fid.row(i), breakdownStatRect(i), null));
}

function ultimatePageHits(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  const moveset = sheetMoveset(state, view.offset);
  const hits = ULTIMATES[moveset].map((_, i) => hit(fid.ult(i), ultCardRect(i), { kind: "chooseUltimate", index: i }));
  if (!canChooseUltimate(state)) return hits;
  return [
    hit(fid.moveset(-1), MOVESET_ARROWS[-1], { kind: "stepMoveset", dir: -1 }),
    ...hits,
    hit(fid.moveset(1), MOVESET_ARROWS[1], { kind: "stepMoveset", dir: 1 }),
  ];
}

function bodyPageHits(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  if (view.page === BODY_PAGE_ULTIMATE) return ultimatePageHits(state, view);
  if (view.page === BODY_PAGE_BREAKDOWN) return breakdownPageHits();
  return statusPageHits(state, view);
}

function bodyHits(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  return [...pageHits(), ...bodyPageHits(state, view)];
}

function sheetLayout(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHit[] {
  switch (view.subject.kind) {
    case "item":
      return itemHits(state, view);
    case "body":
      return bodyHits(state, view);
    default:
      return [];
  }
}

// -----------------------------------------------------------------------------
// 焦点の読み取り（描画も読む）
// -----------------------------------------------------------------------------

/** 焦点の行動の添字（行動の行に焦点が無ければ、見えている先頭の行動） */
export function focusedActionIndex(state: Readonly<GameState>, view: Readonly<SheetView>): number | null {
  const arg = fidArgs(view.focus, "row")?.[0];
  const n = bodyActions(state).length;
  if (arg !== undefined) {
    const i = Number(arg);
    if (Number.isInteger(i) && i >= 0 && i < n) return i;
  }
  return visibleActionIndices(state, view)[0] ?? null;
}

/** 内訳の頁の焦点のステータス（ステータスの行に焦点が無ければ先頭。体の頁の行の番号が残っていても範囲外なら先頭） */
export function focusedAttr(view: Readonly<SheetView>): AttrKey {
  const arg = fidArgs(view.focus, "row")?.[0];
  const i = arg === undefined ? 0 : Number(arg);
  return (Number.isInteger(i) ? ATTR_KEYS[i] : undefined) ?? ATTR_KEYS[0];
}

function focusedOp(focus: FocusId | null): EchoOp | null {
  const op = fidArgs(focus, "op")?.[0];
  return ECHO_OPS.find((o) => o === op) ?? null;
}

function focusedNumber(focus: FocusId | null, prefix: string): number | null {
  const arg = fidArgs(focus, prefix)?.[0];
  if (arg === undefined) return null;
  const n = Number(arg);
  return Number.isInteger(n) ? n : null;
}

// -----------------------------------------------------------------------------
// 操作
// -----------------------------------------------------------------------------

function setFocus(ui: InventoryUi, view: SheetView, id: FocusId | null): void {
  if (id === null || view.focus === id) return;
  view.focus = id;
  ui.focusAt = ui.time;
}

/** 段が進んだら、その段の先頭へ焦点を移す（相手 → 選ぶ行 → 実行） */
function focusForgeStep(state: Readonly<GameState>, ui: InventoryUi, view: SheetView): void {
  const session = view.forge;
  if (session === null) return;
  const step = forgeStep(state.profile, session);
  if (step === "partner") {
    const first = forgePartners(state.profile, session)[view.offset];
    setFocus(ui, view, first === undefined ? null : fid.partner(first.id));
    return;
  }
  if (step === "pick") {
    setFocus(ui, view, forgePickOptions(state.profile, session).length > 0 ? fid.trait(0) : null);
    return;
  }
  if (step === "ready") setFocus(ui, view, fid.exec);
}

function chooseOp(state: GameState, ui: InventoryUi, view: SheetView, op: EchoOp): void {
  const item = sheetItemOf(state, view);
  if (item === null) return;
  const block = forgeOpBlock(state.profile, item.id, op);
  if (block !== null) {
    showNote(ui, block);
    return;
  }
  pushSfx(state, "uiClick");
  view.offset = 0;
  // 同じ操作をもう一度選んだら手続きをやめる
  if (view.forge?.op === op) {
    view.forge = null;
    return;
  }
  view.forge = newForgeSession(item.id, op);
  focusForgeStep(state, ui, view);
}

function choosePartner(state: GameState, ui: InventoryUi, view: SheetView, itemId: string): void {
  const session = view.forge;
  if (session === null) return;
  session.partnerId = itemId;
  session.pick = null;
  pushSfx(state, "uiClick");
  focusForgeStep(state, ui, view);
}

function choosePick(state: GameState, ui: InventoryUi, view: SheetView, pick: ForgePick): void {
  const session = view.forge;
  if (session === null) return;
  session.pick = pick;
  pushSfx(state, "uiClick");
  focusForgeStep(state, ui, view);
}

/** 実行。砕いて物が無くなれば書付を閉じる。捧げた側が消えたら書付は受け手を見る */
function runForge(state: GameState, ui: InventoryUi, view: SheetView): void {
  const session = view.forge;
  if (session === null) return;
  const result = executeForge(state, ui.craft, session);
  if (!result.ok) {
    showNote(ui, result.message);
    return;
  }
  if (view.subject.kind === "item" && view.subject.itemId !== session.subjectId) view.subject = { kind: "item", itemId: session.subjectId };
  if (sheetItemOf(state, view) === null) {
    popView(ui);
    showNote(ui, result.message);
    return;
  }
  if (session.op === null) view.forge = null;
  view.offset = 0;
  showNote(ui, result.message);
  focusForgeStep(state, ui, view);
}

function stepUltimateMoveset(state: GameState, view: SheetView, dir: number): void {
  if (!canChooseUltimate(state)) return;
  view.offset += dir;
  pushSfx(state, "uiClick");
}

function sheetAct(state: GameState, ui: InventoryUi, view: SheetView, act: MenuAct): void {
  switch (act.kind) {
    case "sheetPage":
      if (view.page === act.page) return;
      view.page = act.page;
      view.offset = 0;
      pushSfx(state, "uiClick");
      return;
    case "chooseUltimate": {
      const note = chooseUltimateAt(state, sheetMoveset(state, view.offset), act.index);
      if (note !== null) showNote(ui, note);
      return;
    }
    case "stepMoveset":
      stepUltimateMoveset(state, view, act.dir);
      return;
    case "forgeOp":
      chooseOp(state, ui, view, act.op);
      return;
    case "forgePartner":
      choosePartner(state, ui, view, act.itemId);
      return;
    case "forgePick":
      choosePick(state, ui, view, act.pick);
      return;
    case "forgeExecute":
      runForge(state, ui, view);
      return;
    default:
      return;
  }
}

/** 戻る: 鍛冶の手続きを 1 段ずつ戻す（選ぶ行 → 相手 → 操作）。手続きが無ければ頁を閉じる（false） */
function sheetBack(ui: InventoryUi, view: SheetView): boolean {
  const session = view.forge;
  if (session === null) return false;
  view.offset = 0;
  if (session.pick !== null) {
    session.pick = null;
    return true;
  }
  if (session.partnerId !== null) {
    session.partnerId = null;
    return true;
  }
  const op = session.op;
  view.forge = null;
  if (op !== null) setFocus(ui, view, fid.op(op));
  return true;
}

function partnerEdge(state: Readonly<GameState>, view: SheetView, dy: number): boolean {
  const session = view.forge;
  if (session === null || forgeStep(state.profile, session) !== "partner") return false;
  const count = forgePartners(state.profile, session).length;
  const next = view.offset + dy * PARTNER_PAGE;
  if (next < 0 || next >= count) return false;
  view.offset = next;
  return true;
}

function actionEdge(state: Readonly<GameState>, ui: InventoryUi, view: SheetView, dy: number): boolean {
  if (view.page !== BODY_PAGE_STATUS || dy === 0) return false;
  const max = Math.max(0, actionRowCount(state) - ACTION_ROWS_VISIBLE);
  const next = Math.max(0, Math.min(max, view.offset + Math.sign(dy)));
  if (next === view.offset) return false;
  view.offset = next;
  const row = focusedNumber(view.focus, "row");
  const n = bodyActions(state).length;
  if (row !== null) setFocus(ui, view, fid.row(Math.max(0, Math.min(n - 1, row + Math.sign(dy) * ACTION_COLS))));
  return true;
}

function sheetEdge(state: Readonly<GameState>, ui: InventoryUi, view: SheetView, dx: number, dy: number): boolean {
  if (view.subject.kind === "item") return partnerEdge(state, view, Math.sign(dy));
  if (view.subject.kind !== "body") return false;
  if (view.page === BODY_PAGE_ULTIMATE && dx !== 0 && canChooseUltimate(state)) {
    view.offset += Math.sign(dx);
    return true;
  }
  return actionEdge(state, ui, view, dy);
}

// -----------------------------------------------------------------------------
// 見出し・荷札・案内
// -----------------------------------------------------------------------------

const SHEET_HEAD = "書付";
const CRUMB_SEP = " › ";
const BODY_CRUMB = "体";
const PAIR_CRUMB = "見開き";
const PAIR_RIGHT = "候補 ｜ 今";
const MISSING_CRUMB = "見つからない";

function subjectName(state: Readonly<GameState>, subject: SheetSubject): string {
  switch (subject.kind) {
    case "item":
      return sheetItem(state, subject.itemId)?.name ?? MISSING_CRUMB;
    case "pair":
    case "stonePair":
      return PAIR_CRUMB;
    case "stone": {
      const stone = sheetStone(state, subject.stoneId);
      return stone === null ? MISSING_CRUMB : sheetStoneName(stone);
    }
    case "rune":
      return MODIFIERS[subject.key].name;
    case "body":
      return BODY_CRUMB;
    case "boon":
      return BOONS[subject.key].name;
    case "lineage":
      return LINEAGE_LABEL[subject.lineage];
  }
}

/** 石の名前（スキル名） */
export function sheetStoneName(stone: Readonly<SkillStone>): string {
  return SKILL_DEFS[stone.skillKey].name;
}

function sheetHeader(state: Readonly<GameState>, view: Readonly<SheetView>): MenuHeader {
  const pair = view.subject.kind === "pair" || view.subject.kind === "stonePair";
  return { crumbs: `${SHEET_HEAD}${CRUMB_SEP}${subjectName(state, view.subject)}`, right: pair ? PAIR_RIGHT : null };
}

const EQUIPPED_MARK = "（装備中）";
const PAGE_SUB: readonly string[] = ["ステータスと出どころ・体の性能・行動の計算式", "ステータスを参照する行動・攻撃に掛かる増と倍", "武器種ごとの奥義"];
const ULT_LOCKED_SUB = "ラン中は奥義を変えられない";
const ULT_COST_HEAD = "奥義ゲージ ";
const MOVESET_TAG_HEAD = "奥義の武器種 ";
const EXEC_HEAD = "実行  ";

function opTag(state: Readonly<GameState>, view: Readonly<SheetView>, op: EchoOp): MenuTag {
  const item = sheetItemOf(state, view);
  const block = item === null ? null : forgeOpBlock(state.profile, item.id, op);
  const cost = forgeCostText(op);
  return { title: ECHO_OP_LABEL[op], sub: block ?? ECHO_OP_HINT[op], aside: cost === "" ? null : cost };
}

function partnerTag(state: Readonly<GameState>, session: Readonly<ForgeSession>, id: string): MenuTag {
  const partner = forgePartners(state.profile, session).find((it) => it.id === id);
  if (partner === undefined) return { ...EMPTY_TAG };
  const mark = isEquippedItem(state.profile, partner.id) ? EQUIPPED_MARK : "";
  const preview = { ...session, partnerId: partner.id };
  const donor = forgeDonor(state.profile, preview);
  const receiver = forgeReceiver(state.profile, preview);
  const flow = donor === null || receiver === null ? "" : `${donor.name} → ${receiver.name}`;
  return { title: `${SLOT_LABEL[partner.slot]}  ${partner.name}${mark}`, sub: flow, aside: null };
}

function pickTag(state: Readonly<GameState>, session: Readonly<ForgeSession>, n: number): MenuTag {
  const pick = forgePickOptions(state.profile, session)[n];
  if (pick === undefined || session.op === null) return { ...EMPTY_TAG };
  return { title: forgePickLabel(state.profile, session, pick), sub: ECHO_OP_HINT[session.op], aside: null };
}

function execTag(state: Readonly<GameState>, session: Readonly<ForgeSession>): MenuTag {
  const op = session.op;
  if (op === null) return { ...EMPTY_TAG };
  const step = forgeStep(state.profile, session);
  const cost = forgeCostText(op);
  const sub = step === "ready" ? ECHO_OP_HINT[op] : FORGE_STEP_PROMPT[step];
  return { title: `${EXEC_HEAD}${ECHO_OP_LABEL[op]}`, sub, aside: cost === "" ? null : cost };
}

function itemTag(state: Readonly<GameState>, view: Readonly<SheetView>): MenuTag {
  const focus = view.focus;
  const op = focusedOp(focus);
  if (op !== null) return opTag(state, view, op);
  const session = view.forge;
  if (session === null) return { ...EMPTY_TAG };
  const partner = fidArgs(focus, "partner", 1)?.[0];
  if (partner !== undefined) return partnerTag(state, session, partner);
  const n = focusedNumber(focus, "trait");
  if (n !== null) return pickTag(state, session, n);
  return focus === fid.exec ? execTag(state, session) : { ...EMPTY_TAG };
}

function ultTag(state: Readonly<GameState>, view: Readonly<SheetView>, index: number): MenuTag {
  const def = ULTIMATES[sheetMoveset(state, view.offset)][index];
  if (def === undefined) return { ...EMPTY_TAG };
  const cost = ultimateCostOf(def);
  return { title: `${def.name}  ${ULTIMATE_KIND_LABEL[def.kind]}`, sub: def.desc, aside: cost === null ? null : `${ULT_COST_HEAD}${cost}` };
}

function bodyTag(state: Readonly<GameState>, view: Readonly<SheetView>): MenuTag {
  const focus = view.focus;
  const page = focusedNumber(focus, "page");
  if (page !== null) {
    const sub = page === BODY_PAGE_ULTIMATE && !canChooseUltimate(state) ? ULT_LOCKED_SUB : (PAGE_SUB[page] ?? "");
    return { title: BODY_PAGES[page] ?? "", sub, aside: null };
  }
  const ult = focusedNumber(focus, "ult");
  if (ult !== null) return ultTag(state, view, ult);
  if (fidArgs(focus, "moveset") !== null) {
    return { title: `${MOVESET_TAG_HEAD}${MOVESETS[sheetMoveset(state, view.offset)].name}`, sub: "", aside: null };
  }
  const row = focusedNumber(focus, "row");
  if (row !== null && view.page === BODY_PAGE_BREAKDOWN) return { title: ATTR_LABEL[focusedAttr(view)], sub: "", aside: null };
  const action = row === null ? undefined : bodyActions(state)[row];
  return action === undefined ? { ...EMPTY_TAG } : { title: action.name, sub: "", aside: null };
}

function sheetTag(state: Readonly<GameState>, view: Readonly<SheetView>): MenuTag {
  if (view.subject.kind === "item") return itemTag(state, view);
  if (view.subject.kind === "body") return bodyTag(state, view);
  return { ...EMPTY_TAG };
}

const READ_GUIDE: readonly GuideVerb[] = ["back"];
const PAGE_GUIDE: readonly GuideVerb[] = ["move", "decide", "back"];
const FORGE_GUIDE: readonly GuideVerb[] = ["move", "decide", "cancel"];
const SHATTER_GUIDE: readonly GuideVerb[] = ["move", "hold", "cancel"];

function sheetGuide(view: Readonly<SheetView>): readonly GuideVerb[] {
  if (view.subject.kind === "body") return PAGE_GUIDE;
  if (view.subject.kind !== "item") return READ_GUIDE;
  if (view.forge === null) return PAGE_GUIDE;
  return view.forge.op === "shatter" ? SHATTER_GUIDE : FORGE_GUIDE;
}

export const SHEET_VIEW: ViewModule<SheetView> = {
  layout: (state, _ui, view) => sheetLayout(state, view),
  act: sheetAct,
  header: (state, _ui, view) => sheetHeader(state, view),
  tag: (state, _ui, view) => sheetTag(state, view),
  guide: (_state, view) => sheetGuide(view),
  sheetFor: () => null,
  back: (_state, ui, view) => sheetBack(ui, view),
  edge: sheetEdge,
  leave: () => undefined,
};
