import { type GameState, pushSfx } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { ECHO_LABEL, ECHO_OPS, ECHO_OP_HINT, ECHO_OP_LABEL, type EchoOp } from "../loot/crafting";
import { describeTrait } from "../loot/describe";
import { TRAIT_COLORS, type Item, type Profile, type TraitColor } from "../loot/types";
import { ATTIRE_PART_RECTS, ATTIRE_SLOTS, focusedPart } from "./attire";
import {
  FORGE_STEP_PROMPT,
  type ForgeStep,
  echoWalletText,
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
import { showNote } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type AnvilState,
  type FocusId,
  type ForgePick,
  type ForgeSession,
  type GuideVerb,
  type InventoryUi,
  type LootSlot,
  type MenuAct,
  type MenuHeader,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";

/**
 * 装備画面の金床の構え（拠点の鍛冶屋で開く装束。docs/ideas/inventory-v2/E-impl.md 4-3 E7、E-merged.md 6 章 W7）。
 * 装束の頁（ATTIRE_VIEW）が anvil を持つ間ここへ任せる。部位の位置は装束と同じ（ATTIRE_PART_RECTS）で、人影の代わりに金床、腰の石の代わりに残響の壺 5。
 * 段は 部位（slot = null）→ 札（その部位の装備中の物 + 倉庫。forge = null）→ 操作（forge.subjectId を鍛える。手続きは forge.ts）。
 * 戻るは 選ぶ行 → 相手 → 操作 → 札 → 部位 の順に 1 段ずつ。結果は荷札の 2 行目に 1 行（「前 → 後」。crafting が組む文）。
 * 一覧は 5 枚ずつ（view.anvil.offset）。頁送りの札（▲ ▼）の当たりは MenuAct の anvilPage（dir ±1）
 */

type AttireView = ViewOf<"attire">;

// -----------------------------------------------------------------------------
// 配置（480x270 の論理座標。描画 render/anvilUi.ts と共有する）
// -----------------------------------------------------------------------------

/** 残響の壺の上限（これ以上は水位が満杯で止まる）。UI の見た目だけの定数でバランスには効かない */
export const ANVIL_POT_FULL = 30;
/** 一覧の 1 頁の枚数（候補と同じ） */
export const ANVIL_ROW_PAGE = MENU_BUDGET.candidates;

const ROW_X = 266;
const ROW_Y0 = 36;
const ROW_PITCH = 24;
const ROW_W = 200;
const ROW_H = 21;
const OP_X0 = 266;
const OP_PITCH = 41;
const OP_Y = 162;
const OP_W = 38;
const OP_H = 16;
const POT_X0 = 48;
const POT_PITCH = 32;
/** 壺の口の y（本体は +2 から 22 の高さ） */
export const ANVIL_POT_Y = 180;
const POT_HIT_W = 20;
const POT_HIT_H = 26;

/** 右の一覧の見出しの位置 */
export const ANVIL_HEAD_POS = { x: 266, y: 22 } as const;
/** 一覧の札 i（x 266・y 36 + i × 24・200 × 21） */
export function anvilRowRect(i: number): Rect {
  return { x: ROW_X, y: ROW_Y0 + i * ROW_PITCH, w: ROW_W, h: ROW_H };
}
/** 操作の札 i（x 266 + i × 41・y 162・38 × 16） */
export function anvilOpRect(i: number): Rect {
  return { x: OP_X0 + i * OP_PITCH, y: OP_Y, w: OP_W, h: OP_H };
}
/** 実行の札（操作の札の下） */
export const ANVIL_EXEC_RECT: Rect = { x: 266, y: 182, w: 76, h: 16 };
/** 頁送りの札（一覧の上下の細い帯。5 枚を超えるときだけ出る） */
export const ANVIL_PREV_RECT: Rect = { x: 266, y: 27, w: 200, h: 8 };
export const ANVIL_NEXT_RECT: Rect = { x: 266, y: 154, w: 200, h: 7 };
/** 壺 i の口の左端 x */
export function anvilPotX(i: number): number {
  return POT_X0 + i * POT_PITCH;
}
export function anvilPotRect(i: number): Rect {
  return { x: anvilPotX(i) - 1, y: ANVIL_POT_Y - 1, w: POT_HIT_W, h: POT_HIT_H };
}

/** 壺の水位（0..1）。残響の量に比例し、ANVIL_POT_FULL で止まる */
export function potLevel(amount: number): number {
  return Math.max(0, Math.min(1, amount / ANVIL_POT_FULL));
}

/** 金床の構えだけの焦点（共通の fid に無いもの。形式は fid と同じ「:」区切り） */
export const ANVIL_FOCUS = {
  pot: (color: TraitColor): FocusId => `pot:${color}`,
  prev: "anvil:prev" as FocusId,
  next: "anvil:next" as FocusId,
} as const;

/** 焦点の壺の色（壺でなければ null） */
export function focusedPot(focus: FocusId | null): TraitColor | null {
  const color = fidArgs(focus, "pot")?.[0];
  return TRAIT_COLORS.find((c) => c === color) ?? null;
}

// -----------------------------------------------------------------------------
// 一覧の中身（段で変わる）
// -----------------------------------------------------------------------------

/** 一覧の 1 枚。subject = 鍛える物を選ぶ / partner = 注ぎ・移しの相手 / pick = 煽り・呼び戻し・移しの行 */
export type AnvilRow =
  | { kind: "subject"; item: Item }
  | { kind: "partner"; item: Item }
  | { kind: "pick"; index: number; pick: ForgePick };

/** 部位の遺物（装備中の物を先頭に、倉庫の物）。借り物の倉庫の物は鍛えられないので除く */
export function anvilSubjects(profile: Readonly<Profile>, slot: LootSlot): Item[] {
  const worn = profile.equipment[slot];
  const stash = profile.stash.filter((it) => it.slot === slot && it.loaned !== true);
  return worn ? [worn, ...stash] : stash;
}

/** 選んだ部位（部位の段なら null） */
export function anvilChosenSlot(anvil: Readonly<AnvilState>): LootSlot | null {
  const slot = anvil.slot;
  return slot !== null && isLootSlot(slot) ? slot : null;
}

/** 今の段の一覧の全件（頁で切る前）。部位を選ぶ前は空 */
export function anvilRows(profile: Readonly<Profile>, anvil: Readonly<AnvilState>): AnvilRow[] {
  const slot = anvilChosenSlot(anvil);
  if (slot === null) return [];
  const session = anvil.forge;
  const step = session === null ? null : forgeStep(profile, session);
  if (session !== null && step === "partner") return forgePartners(profile, session).map((item): AnvilRow => ({ kind: "partner", item }));
  if (session !== null && step === "pick") return forgePickOptions(profile, session).map((pick, index): AnvilRow => ({ kind: "pick", index, pick }));
  return anvilSubjects(profile, slot).map((item): AnvilRow => ({ kind: "subject", item }));
}

function isLootSlot(v: string): v is LootSlot {
  return (ATTIRE_SLOTS as readonly string[]).includes(v);
}

/** 一覧の先頭の添字（件数に収める。範囲を外れたら最後の頁の頭） */
export function anvilPageStart(count: number, offset: number): number {
  if (offset >= 0 && offset < count) return offset;
  return Math.max(0, Math.floor((count - 1) / ANVIL_ROW_PAGE) * ANVIL_ROW_PAGE);
}

/** 見えている頁の札 */
export function anvilVisibleRows(profile: Readonly<Profile>, anvil: Readonly<AnvilState>): AnvilRow[] {
  const rows = anvilRows(profile, anvil);
  const start = anvilPageStart(rows.length, anvil.offset);
  return rows.slice(start, start + ANVIL_ROW_PAGE);
}

export function anvilRowFocus(row: Readonly<AnvilRow>): FocusId {
  switch (row.kind) {
    case "subject":
      return fid.tg(row.item.id);
    case "partner":
      return fid.partner(row.item.id);
    case "pick":
      return fid.trait(row.index);
  }
}

function anvilRowAct(row: Readonly<AnvilRow>): MenuAct {
  switch (row.kind) {
    case "subject":
      return { kind: "forgeSubject", itemId: row.item.id };
    case "partner":
      return { kind: "forgePartner", itemId: row.item.id };
    case "pick":
      return { kind: "forgePick", pick: row.pick };
  }
}

/** 今の鍛冶の段（手続きが無ければ null） */
export function anvilForgeStep(state: Readonly<GameState>, anvil: Readonly<AnvilState>): ForgeStep | null {
  return anvil.forge === null ? null : forgeStep(state.profile, anvil.forge);
}

// -----------------------------------------------------------------------------
// 当たり
// -----------------------------------------------------------------------------

function hit(id: FocusId, rect: Rect, act: MenuAct | null, hold: MenuAct | null = null): MenuHit {
  return { id, rect, act, hold, nav: true };
}

function partHits(): MenuHit[] {
  return ATTIRE_SLOTS.map((slot) => {
    const r = ATTIRE_PART_RECTS[slot];
    return hit(fid.part(slot), { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, { kind: "anvilPart", slot });
  });
}

function rowHits(state: Readonly<GameState>, anvil: Readonly<AnvilState>): MenuHit[] {
  const rows = anvilRows(state.profile, anvil);
  const start = anvilPageStart(rows.length, anvil.offset);
  const hits = rows.slice(start, start + ANVIL_ROW_PAGE).map((row, i) => hit(anvilRowFocus(row), anvilRowRect(i), anvilRowAct(row)));
  if (rows.length <= ANVIL_ROW_PAGE) return hits;
  const prev = start > 0 ? [hit(ANVIL_FOCUS.prev, ANVIL_PREV_RECT, { kind: "anvilPage", dir: -1 })] : [];
  const next = start + ANVIL_ROW_PAGE < rows.length ? [hit(ANVIL_FOCUS.next, ANVIL_NEXT_RECT, { kind: "anvilPage", dir: 1 })] : [];
  return [...prev, ...hits, ...next];
}

function opHits(): MenuHit[] {
  return ECHO_OPS.map((op, i) => hit(fid.op(op), anvilOpRect(i), { kind: "forgeOp", op }));
}

/** 実行の札。砕くは長押しでだけ実行する（誤って砕かない） */
function execHit(op: EchoOp): MenuHit {
  const run: MenuAct = { kind: "forgeExecute" };
  return op === "shatter" ? hit(fid.exec, ANVIL_EXEC_RECT, null, run) : hit(fid.exec, ANVIL_EXEC_RECT, run);
}

function potHits(): MenuHit[] {
  return TRAIT_COLORS.map((color, i) => hit(ANVIL_FOCUS.pot(color), anvilPotRect(i), null));
}

function anvilLayout(state: Readonly<GameState>, _ui: Readonly<InventoryUi>, view: Readonly<AttireView>): MenuHit[] {
  const anvil = view.anvil;
  if (anvil === null) return [];
  const forge = anvil.forge;
  const forgeHits = forge === null ? [] : [...opHits(), ...(forge.op === null ? [] : [execHit(forge.op)])];
  return [...partHits(), ...rowHits(state, anvil), ...forgeHits, ...potHits()];
}

// -----------------------------------------------------------------------------
// 操作
// -----------------------------------------------------------------------------

function setFocus(ui: InventoryUi, view: AttireView, id: FocusId | null): void {
  if (id === null || view.focus === id) return;
  view.focus = id;
  ui.focusAt = ui.time;
}

/** 選べる最初の操作（無ければ砕く） */
function firstOp(profile: Readonly<Profile>, subjectId: string): EchoOp {
  return ECHO_OPS.find((op) => forgeOpBlock(profile, subjectId, op) === null) ?? "shatter";
}

/** 段が変わったら、その段の先頭へ焦点を移す（部位 → 札 → 操作 → 相手 / 行 → 実行） */
function focusStage(state: Readonly<GameState>, ui: InventoryUi, view: AttireView, anvil: Readonly<AnvilState>): void {
  const slot = anvil.slot;
  if (slot === null) return;
  const session = anvil.forge;
  const first = anvilVisibleRows(state.profile, anvil)[0];
  if (session === null) {
    setFocus(ui, view, first === undefined ? fid.part(slot) : anvilRowFocus(first));
    return;
  }
  const step = forgeStep(state.profile, session);
  if (step === "ready") {
    setFocus(ui, view, fid.exec);
    return;
  }
  if (step === "op") {
    setFocus(ui, view, fid.op(session.op ?? firstOp(state.profile, session.subjectId)));
    return;
  }
  const fallback = session.op === null ? null : fid.op(session.op);
  setFocus(ui, view, first === undefined ? fallback : anvilRowFocus(first));
}

function chooseSlot(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState, slot: string): void {
  if (!isLootSlot(slot)) return;
  anvil.slot = slot;
  anvil.forge = null;
  anvil.offset = 0;
  pushSfx(state, "uiClick");
  ui.note = null;
  focusStage(state, ui, view, anvil);
}

function chooseSubject(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState, itemId: string): void {
  anvil.forge = newForgeSession(itemId);
  anvil.offset = 0;
  pushSfx(state, "uiClick");
  ui.note = null;
  focusStage(state, ui, view, anvil);
}

function chooseOp(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState, op: EchoOp): void {
  const session = anvil.forge;
  if (session === null) return;
  const block = forgeOpBlock(state.profile, session.subjectId, op);
  if (block !== null) {
    showNote(ui, block);
    return;
  }
  pushSfx(state, "uiClick");
  anvil.offset = 0;
  // 同じ操作をもう一度選んだら選び直し（焦点は操作の札に残す）
  if (session.op === op) {
    anvil.forge = newForgeSession(session.subjectId);
    return;
  }
  anvil.forge = newForgeSession(session.subjectId, op);
  focusStage(state, ui, view, anvil);
}

function choosePartner(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState, itemId: string): void {
  const session = anvil.forge;
  if (session === null) return;
  session.partnerId = itemId;
  session.pick = null;
  anvil.offset = 0;
  pushSfx(state, "uiClick");
  focusStage(state, ui, view, anvil);
}

function choosePick(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState, pick: ForgePick): void {
  const session = anvil.forge;
  if (session === null) return;
  session.pick = pick;
  anvil.offset = 0;
  pushSfx(state, "uiClick");
  focusStage(state, ui, view, anvil);
}

/** 実行。鍛えた物が無くなれば（砕いた・捧げた）札の段へ戻る */
function runForge(state: GameState, ui: InventoryUi, view: AttireView, anvil: AnvilState): void {
  const session = anvil.forge;
  if (session === null) return;
  const result = executeForge(state, ui.craft, session);
  if (!result.ok) {
    showNote(ui, result.message);
    return;
  }
  anvil.offset = 0;
  if (forgeItem(state.profile, session.subjectId) === null) anvil.forge = null;
  showNote(ui, result.message);
  focusStage(state, ui, view, anvil);
}

/** 頁送り（dir ±1 で 5 枚ずつ）。送れたら true */
function stepPage(state: Readonly<GameState>, ui: InventoryUi, view: AttireView, anvil: AnvilState, dir: number): boolean {
  const count = anvilRows(state.profile, anvil).length;
  const next = anvilPageStart(count, anvil.offset) + Math.sign(dir) * ANVIL_ROW_PAGE;
  if (next < 0 || next >= count) return false;
  anvil.offset = next;
  const first = anvilVisibleRows(state.profile, anvil)[0];
  if (first !== undefined) setFocus(ui, view, anvilRowFocus(first));
  return true;
}

function anvilAct(state: GameState, ui: InventoryUi, view: AttireView, act: MenuAct): void {
  const anvil = view.anvil;
  if (anvil === null) return;
  switch (act.kind) {
    case "anvilPart":
      chooseSlot(state, ui, view, anvil, act.slot);
      return;
    case "forgeSubject":
      chooseSubject(state, ui, view, anvil, act.itemId);
      return;
    case "forgeOp":
      chooseOp(state, ui, view, anvil, act.op);
      return;
    case "forgePartner":
      choosePartner(state, ui, view, anvil, act.itemId);
      return;
    case "forgePick":
      choosePick(state, ui, view, anvil, act.pick);
      return;
    case "forgeExecute":
      runForge(state, ui, view, anvil);
      return;
    case "anvilPage":
      stepPage(state, ui, view, anvil, act.dir);
      return;
    default:
      return;
  }
}

/** 札の段へ戻すとき、その物が見える頁を開く */
function pageOfSubject(profile: Readonly<Profile>, anvil: Readonly<AnvilState>, itemId: string): number {
  const index = anvilSubjects(profile, anvilChosenSlot(anvil) ?? "mainHand").findIndex((it) => it.id === itemId);
  return index < 0 ? 0 : Math.floor(index / ANVIL_ROW_PAGE) * ANVIL_ROW_PAGE;
}

/** 戻る: 選ぶ行 → 相手 → 操作 → 札 → 部位 の順に 1 段ずつ。部位の段なら false（装備画面が閉じる） */
function anvilBack(state: GameState, ui: InventoryUi, view: AttireView): boolean {
  const anvil = view.anvil;
  if (anvil === null) return false;
  const session = anvil.forge;
  if (session !== null) {
    anvil.offset = 0;
    if (session.pick !== null) {
      session.pick = null;
      focusStage(state, ui, view, anvil);
      return true;
    }
    if (session.partnerId !== null) {
      session.partnerId = null;
      focusStage(state, ui, view, anvil);
      return true;
    }
    const subjectId = session.subjectId;
    if (session.op !== null) {
      const op = session.op;
      anvil.forge = newForgeSession(subjectId);
      setFocus(ui, view, fid.op(op));
      return true;
    }
    anvil.forge = null;
    anvil.offset = pageOfSubject(state.profile, anvil, subjectId);
    setFocus(ui, view, fid.tg(subjectId));
    return true;
  }
  const slot = anvil.slot;
  if (slot === null) return false;
  anvil.slot = null;
  anvil.offset = 0;
  setFocus(ui, view, fid.part(slot));
  return true;
}

function anvilEdge(state: Readonly<GameState>, ui: InventoryUi, view: AttireView, _dx: number, dy: number): boolean {
  const anvil = view.anvil;
  if (anvil === null || dy === 0) return false;
  return stepPage(state, ui, view, anvil, dy);
}

// -----------------------------------------------------------------------------
// 見出し・荷札・案内
// -----------------------------------------------------------------------------

const ANVIL_HEAD = "鍛冶屋";
const HUB_LABEL = "拠点";
const CRUMB_SEP = " › ";
const EMPTY_PART = "空き";
const EQUIPPED_TEXT = "装備中";
const EXEC_HEAD = "実行  ";
const PART_SUB = "遺物を選んで鍛える　砕けるのは倉庫の遺物だけ";
const POT_SUB_HEAD = "残響  ";

function anvilHeader(_state: Readonly<GameState>, _ui: Readonly<InventoryUi>, view: Readonly<AttireView>): MenuHeader {
  const slot = view.anvil?.slot ?? null;
  return { crumbs: slot === null ? ANVIL_HEAD : `${ANVIL_HEAD}${CRUMB_SEP}${SLOT_LABEL[slot]}`, right: HUB_LABEL };
}

function partTag(state: Readonly<GameState>, slot: LootSlot): MenuTag {
  const worn = state.profile.equipment[slot];
  return { title: `${SLOT_LABEL[slot]}  ${worn?.name ?? EMPTY_PART}`, sub: PART_SUB, aside: null };
}

function firstTraitText(item: Readonly<Item>): string {
  const roll = item.affixes[0];
  return roll === undefined ? "" : describeTrait(roll).text;
}

function subjectTag(state: Readonly<GameState>, item: Readonly<Item>): MenuTag {
  const mark = isEquippedItem(state.profile, item.id) ? `  ${EQUIPPED_TEXT}` : "";
  return { title: `${item.name}  ${SLOT_LABEL[item.slot]}${mark}`, sub: firstTraitText(item), aside: null };
}

function opTag(state: Readonly<GameState>, anvil: Readonly<AnvilState>, op: EchoOp): MenuTag {
  const block = anvil.forge === null ? null : forgeOpBlock(state.profile, anvil.forge.subjectId, op);
  const cost = forgeCostText(op);
  return { title: ECHO_OP_LABEL[op], sub: block ?? ECHO_OP_HINT[op], aside: cost === "" ? null : cost };
}

function partnerTag(state: Readonly<GameState>, session: Readonly<ForgeSession>, item: Readonly<Item>): MenuTag {
  const mark = isEquippedItem(state.profile, item.id) ? `  ${EQUIPPED_TEXT}` : "";
  const preview = { ...session, partnerId: item.id };
  const donor = forgeDonor(state.profile, preview);
  const receiver = forgeReceiver(state.profile, preview);
  const flow = donor === null || receiver === null ? "" : `${donor.name} → ${receiver.name}`;
  return { title: `${SLOT_LABEL[item.slot]}  ${item.name}${mark}`, sub: flow, aside: null };
}

function rowTag(state: Readonly<GameState>, anvil: Readonly<AnvilState>, row: Readonly<AnvilRow>): MenuTag {
  const session = anvil.forge;
  switch (row.kind) {
    case "subject":
      return subjectTag(state, row.item);
    case "partner":
      return session === null ? { ...EMPTY_TAG } : partnerTag(state, session, row.item);
    case "pick":
      if (session === null || session.op === null) return { ...EMPTY_TAG };
      return { title: forgePickLabel(state.profile, session, row.pick), sub: ECHO_OP_HINT[session.op], aside: null };
  }
}

function execTag(state: Readonly<GameState>, session: Readonly<ForgeSession>): MenuTag {
  const op = session.op;
  if (op === null) return { ...EMPTY_TAG };
  const step = forgeStep(state.profile, session);
  const cost = forgeCostText(op);
  const sub = step === "ready" ? ECHO_OP_HINT[op] : FORGE_STEP_PROMPT[step];
  return { title: `${EXEC_HEAD}${ECHO_OP_LABEL[op]}`, sub, aside: cost === "" ? null : cost };
}

function potTag(ui: Readonly<InventoryUi>, color: TraitColor): MenuTag {
  return { title: `${ECHO_LABEL[color]}の壺  ${ui.craft.echoes[color]}`, sub: `${POT_SUB_HEAD}${echoWalletText(ui.craft)}`, aside: null };
}

function anvilTag(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<AttireView>): MenuTag {
  const anvil = view.anvil;
  if (anvil === null) return { ...EMPTY_TAG };
  const focus = view.focus;
  const pot = focusedPot(focus);
  if (pot !== null) return potTag(ui, pot);
  const op = ECHO_OPS.find((o) => fid.op(o) === focus);
  if (op !== undefined) return opTag(state, anvil, op);
  if (focus === fid.exec) return anvil.forge === null ? { ...EMPTY_TAG } : execTag(state, anvil.forge);
  const row = anvilRows(state.profile, anvil).find((r) => anvilRowFocus(r) === focus);
  if (row !== undefined) return rowTag(state, anvil, row);
  const part = focusedPart(focus);
  return part === null ? { ...EMPTY_TAG } : partTag(state, part);
}

const PART_GUIDE: readonly GuideVerb[] = ["move", "open", "back"];
const FORGE_GUIDE: readonly GuideVerb[] = ["move", "decide", "sheet", "cancel"];
const SHATTER_GUIDE: readonly GuideVerb[] = ["move", "hold", "sheet", "cancel"];

function anvilGuide(_state: Readonly<GameState>, view: Readonly<AttireView>): readonly GuideVerb[] {
  const anvil = view.anvil;
  if (anvil === null || (anvil.slot === null && anvil.forge === null)) return PART_GUIDE;
  return anvil.forge?.op === "shatter" ? SHATTER_GUIDE : FORGE_GUIDE;
}

/** 書付に開く物（札・相手の遺物、部位なら装備中の物） */
function anvilSheetFor(state: Readonly<GameState>, view: Readonly<AttireView>): SheetSubject | null {
  const anvil = view.anvil;
  if (anvil === null) return null;
  const focus = view.focus;
  const row = anvilRows(state.profile, anvil).find((r) => anvilRowFocus(r) === focus);
  if (row !== undefined) return row.kind === "pick" ? null : { kind: "item", itemId: row.item.id };
  const part = focusedPart(focus);
  const worn = part === null ? undefined : state.profile.equipment[part];
  return worn ? { kind: "item", itemId: worn.id } : null;
}

export const ANVIL_VIEW: ViewModule<AttireView> = {
  layout: anvilLayout,
  act: anvilAct,
  header: anvilHeader,
  tag: anvilTag,
  guide: anvilGuide,
  sheetFor: anvilSheetFor,
  back: anvilBack,
  edge: anvilEdge,
  leave: () => undefined,
};
