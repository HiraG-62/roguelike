import { KEYWORD_DEFS } from "../core/keywords";
import { type GameState, pushSfx } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { describeTrait } from "../loot/describe";
import { equipItem, saveProfile, unequipItem } from "../loot/profile";
import type { AffixRoll, Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { equipStone, findStone, salvageStone, saveSkillProfile, stoneInSlot, unequipSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { relicKeywords } from "../system/keywords";
import { chooseBud } from "../system/loot";
import { SLOT_LABEL } from "./inventoryLayout";
import { applyEquipmentChange, showNote } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type CandidateSort,
  type CandidateTarget,
  type GuideVerb,
  type InventoryUi,
  type MenuAct,
  type MenuHeader,
  type MenuHit,
  type MenuTag,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
  rootFace,
} from "./menuState";
import { isUnseen, markSlotSeen } from "./seen";
import { type TryOnBase, type TryOnResult, type TryOnTarget, compareFit, tryOn, tryOnBase } from "./tryOn";

/**
 * 装備画面の候補の頁（部位・石・系統で絞った倉庫の物を 5 枚ずつ並べて比べる）（docs/ideas/inventory-v2/E-impl.md 4-3 E3）。
 * 並びは頁を開いたときと並びを変えたときだけ数え、view.order に入れる（毎フレーム試着を数えない）。
 * 並びの同順は foundAt → id で決める（state.rng を使わない）
 */

type CandidatesView = ViewOf<"candidates">;

/** 1 頁の枚数（芽吹きの札・空けるも 1 枚に数える） */
export const CANDIDATE_PAGE = MENU_BUDGET.candidates;

/** 札 5 枚の矩形（見本 E.html の ② と同じ。x 120・y 36 + i × 26・180 × 23） */
export const CAND_CARD = { x: 120, y: 36, w: 180, h: 23, step: 26 } as const;
/** 並びの札 3 つ（x 120 + i × 22・y 20・18 × 12） */
export const SORT_CHIP = { x: 120, y: 20, w: 18, h: 12, step: 22 } as const;
/** 並びの順（受け流しキーで送る順と同じ） */
export const SORT_ORDER: readonly CandidateSort[] = ["fit", "new", "name"];
/** 並びの札の 1 字と、荷札で言う名前 */
export const SORT_LABEL: Readonly<Record<CandidateSort, { chip: string; long: string }>> = {
  fit: { chip: "合", long: "噛み合う順" },
  new: { chip: "新", long: "新着順" },
  name: { chip: "名", long: "名・銘・芽" },
};

// -----------------------------------------------------------------------------
// 候補の集め方と並び
// -----------------------------------------------------------------------------

/** 倉庫の物 1 つ（遺物かスキル石） */
export type CandidateSubject = { kind: "item"; item: Item } | { kind: "stone"; stone: SkillStone };

/** 頁の 1 枚。芽吹きの札と空けるは倉庫の物ではないが 1 枚に数える */
export type CandidateEntry =
  | { kind: "bud"; n: 0 | 1; roll: AffixRoll }
  | { kind: "subject"; subject: CandidateSubject }
  | { kind: "clear" };

export function subjectId(s: Readonly<CandidateSubject>): string {
  return s.kind === "item" ? s.item.id : s.stone.id;
}

/** 並ぶ物（スキル石の枠は、その枠の石以外の石。系統からは全部位の倉庫の遺物だけ） */
export function candidatePool(state: Readonly<GameState>, target: Readonly<CandidateTarget>): CandidateSubject[] {
  switch (target.kind) {
    case "slot":
      return state.profile.stash.filter((it) => it.slot === target.slot).map((item) => ({ kind: "item", item }));
    case "stone": {
      const worn = stoneInSlot(state.skills.profile, target.index);
      return state.skills.profile.stones.filter((s) => s.id !== worn?.id).map((stone) => ({ kind: "stone", stone }));
    }
    case "flow":
      return state.profile.stash
        .filter((it) => relicKeywords(it)[target.verb].includes(target.keyword))
        .map((item) => ({ kind: "item", item }));
  }
}

/** その物に替えたときの試着の替え先（石の候補なら枠、遺物なら自分の部位） */
export function tryOnTargetOf(target: Readonly<CandidateTarget>, subject: Readonly<CandidateSubject>): TryOnTarget | null {
  if (subject.kind === "item") return { kind: "relic", slot: subject.item.slot, item: subject.item };
  if (target.kind !== "stone") return null;
  return { kind: "stone", index: target.index, skillKey: subject.stone.skillKey };
}

function foundAtOf(s: Readonly<CandidateSubject>): number {
  return s.kind === "item" ? s.item.foundAt : s.stone.foundAt;
}

/** 同順は新しい物を先に、最後は id（並びが毎回同じになるように） */
function tieBreak(a: Readonly<CandidateSubject>, b: Readonly<CandidateSubject>): number {
  const byTime = foundAtOf(b) - foundAtOf(a);
  if (byTime !== 0) return byTime;
  return subjectId(a) < subjectId(b) ? -1 : subjectId(a) > subjectId(b) ? 1 : 0;
}

function isNamed(s: Readonly<CandidateSubject>): boolean {
  if (s.kind !== "item") return false;
  const it = s.item;
  return it.namedKey !== undefined || it.inscription !== undefined || (it.budOffer ?? null) !== null;
}

function isNew(state: Readonly<GameState>, s: Readonly<CandidateSubject>): boolean {
  return s.kind === "item" && isUnseen(s.item, state.profile.meta);
}

function depthOf(s: Readonly<CandidateSubject>): number {
  return s.kind === "item" ? s.item.foundDepth : s.stone.foundDepth;
}

function boolRank(on: boolean): number {
  return on ? 0 : 1;
}

/** 合: 失う系統が少ない順 → 太る・新しく立つ系統が多い順（段 1 の compareFit）→ 新しい順 */
function fitOrder(state: Readonly<GameState>, target: Readonly<CandidateTarget>, pool: readonly CandidateSubject[]): CandidateSubject[] {
  const base: TryOnBase = tryOnBase(state);
  const scored = pool.map((subject) => {
    const to = tryOnTargetOf(target, subject);
    return { subject, summary: to === null ? { lost: 0, cracked: 0, gained: 0 } : tryOn(base, to).summary };
  });
  return scored.sort((a, b) => compareFit(a.summary, b.summary) || tieBreak(a.subject, b.subject)).map((s) => s.subject);
}

/** 並んだ id の列（芽吹きの札・空けるを含まない） */
export function sortedIds(state: Readonly<GameState>, target: Readonly<CandidateTarget>, sort: CandidateSort): string[] {
  const pool = candidatePool(state, target);
  if (sort === "fit") return fitOrder(state, target, pool).map(subjectId);
  const sorted = [...pool];
  if (sort === "new") {
    sorted.sort((a, b) => boolRank(isNew(state, a)) - boolRank(isNew(state, b)) || depthOf(b) - depthOf(a) || tieBreak(a, b));
  } else {
    sorted.sort((a, b) => boolRank(isNamed(a)) - boolRank(isNamed(b)) || tieBreak(a, b));
  }
  return sorted.map(subjectId);
}

/** 並びを作る（無ければ数えて view.order に入れる。頁を開いた後の 1 回と、並び・中身を変えた後の 1 回だけ） */
function ensureOrder(state: Readonly<GameState>, view: Readonly<CandidatesView>): string[] {
  const memo = view as CandidatesView;
  if (memo.order === null) memo.order = sortedIds(state, view.target, view.sort);
  return memo.order;
}

/** 部位の候補で芽のある部位は、先頭に芽吹きの札 2 枚 */
function budEntries(state: Readonly<GameState>, target: Readonly<CandidateTarget>): CandidateEntry[] {
  const pending = state.pendingBud;
  if (target.kind !== "slot" || pending === null || pending.slot !== target.slot) return [];
  return [
    { kind: "bud", n: 0, roll: pending.options[0] },
    { kind: "bud", n: 1, roll: pending.options[1] },
  ];
}

/** 末尾の「空ける」は部位か石の枠が埋まっているときだけ */
function isFilled(state: Readonly<GameState>, target: Readonly<CandidateTarget>): boolean {
  if (target.kind === "slot") return (state.profile.equipment[target.slot] ?? null) !== null;
  if (target.kind === "stone") return stoneInSlot(state.skills.profile, target.index) !== null;
  return false;
}

/** 頁に並ぶ札の全部（芽吹き → 外した物 → 並びの順 → 空ける） */
export function candidateEntries(state: Readonly<GameState>, view: Readonly<CandidatesView>): CandidateEntry[] {
  const pool = candidatePool(state, view.target);
  const byId = new Map(pool.map((s) => [subjectId(s), s] as const));
  const ids = ensureOrder(state, view).filter((id) => byId.has(id));
  // 並びを作った後に倉庫へ入った物は末尾に置く
  const known = new Set(ids);
  for (const s of pool) if (!known.has(subjectId(s))) ids.push(subjectId(s));
  const pinned = view.pinnedId;
  const ordered = pinned !== null && byId.has(pinned) ? [pinned, ...ids.filter((id) => id !== pinned)] : ids;
  const entries: CandidateEntry[] = budEntries(state, view.target);
  for (const id of ordered) {
    const subject = byId.get(id);
    if (subject !== undefined) entries.push({ kind: "subject", subject });
  }
  if (isFilled(state, view.target)) entries.push({ kind: "clear" });
  return entries;
}

export function entryFocusId(entry: Readonly<CandidateEntry>): string {
  if (entry.kind === "bud") return fid.bud(entry.n);
  if (entry.kind === "clear") return fid.clear;
  return fid.cand(subjectId(entry.subject));
}

/** 焦点の札（無ければ null） */
export function focusedEntry(state: Readonly<GameState>, view: Readonly<CandidatesView>): CandidateEntry | null {
  if (view.focus === null) return null;
  return candidateEntries(state, view).find((e) => entryFocusId(e) === view.focus) ?? null;
}

// -----------------------------------------------------------------------------
// 頁の送りと当たり
// -----------------------------------------------------------------------------

/** 頁の何枚目か・頁の数（見出しの「n/m」） */
export function pageOf(offset: number, total: number): { page: number; pages: number } {
  return { page: Math.floor(offset / CANDIDATE_PAGE) + 1, pages: Math.max(1, Math.ceil(total / CANDIDATE_PAGE)) };
}

/** 焦点の札が見える頁へ寄せる（ジャンプで焦点が先に決まっていても頁が追いつく。消えて短くなった頁も詰める） */
function syncPage(view: CandidatesView, entries: readonly CandidateEntry[]): void {
  const lastPage = Math.max(0, Math.ceil(entries.length / CANDIDATE_PAGE) - 1);
  view.offset = Math.max(0, Math.min(Math.floor(view.offset / CANDIDATE_PAGE), lastPage)) * CANDIDATE_PAGE;
  const idx = entries.findIndex((e) => entryFocusId(e) === view.focus);
  if (idx < 0) return;
  view.offset = Math.floor(idx / CANDIDATE_PAGE) * CANDIDATE_PAGE;
}

/** 今の頁に見える札 */
export function visibleEntries(entries: readonly CandidateEntry[], offset: number): CandidateEntry[] {
  return entries.slice(offset, offset + CANDIDATE_PAGE);
}

function entryHit(entry: Readonly<CandidateEntry>, rect: MenuHit["rect"], target: Readonly<CandidateTarget>): MenuHit {
  const id = entryFocusId(entry);
  if (entry.kind === "bud") return { id, rect, act: { kind: "chooseBud", option: entry.n }, hold: null, nav: true };
  if (entry.kind === "clear") return { id, rect, act: { kind: "clearSlot" }, hold: null, nav: true };
  const s = entry.subject;
  if (s.kind === "item") return { id, rect, act: { kind: "equip", itemId: s.item.id }, hold: null, nav: true };
  const index = target.kind === "stone" ? target.index : 0;
  return {
    id,
    rect,
    act: { kind: "equipStone", stoneId: s.stone.id, index },
    hold: { kind: "salvageStone", stoneId: s.stone.id },
    nav: true,
  };
}

/** 並びの札は頁の先頭でだけ方向で止まる（2 頁目以降は上へ押して前の頁へ戻れるように。クリックと受け流しキーでは変えられる） */
function sortChipHits(reachable: boolean): MenuHit[] {
  return SORT_ORDER.map((sort, i) => ({
    id: fid.sort(sort),
    rect: { x: SORT_CHIP.x + i * SORT_CHIP.step, y: SORT_CHIP.y, w: SORT_CHIP.w, h: SORT_CHIP.h },
    act: { kind: "setSort", sort },
    hold: null,
    nav: reachable,
  }));
}

function layout(state: Readonly<GameState>, _ui: Readonly<InventoryUi>, view: Readonly<CandidatesView>): MenuHit[] {
  const entries = candidateEntries(state, view);
  syncPage(view as CandidatesView, entries);
  const cards = visibleEntries(entries, view.offset).map((entry, i) =>
    entryHit(entry, { x: CAND_CARD.x, y: CAND_CARD.y + i * CAND_CARD.step, w: CAND_CARD.w, h: CAND_CARD.h }, view.target),
  );
  return [...cards, ...sortChipHits(view.offset === 0)];
}

// -----------------------------------------------------------------------------
// 決定
// -----------------------------------------------------------------------------

/** 並びを作り直させ、頁の先頭へ（付け替えの後・並びを変えた後） */
function resetOrder(view: CandidatesView): void {
  view.order = null;
  view.offset = 0;
}

function refocus(ui: InventoryUi, view: CandidatesView, id: string | null): void {
  view.focus = id;
  ui.focusAt = ui.time;
}

function equipRelic(state: GameState, ui: InventoryUi, view: CandidatesView, itemId: string): void {
  const item = state.profile.stash.find((it) => it.id === itemId);
  if (item === undefined) return;
  const previous = equipItem(state.profile, itemId);
  applyEquipmentChange(state);
  pushSfx(state, "equipOn");
  showNote(ui, previous === null ? `付けた: ${item.name}` : `付けた: ${item.name}　外した: ${previous.name}`);
  view.pinnedId = previous?.id ?? null;
  resetOrder(view);
  refocus(ui, view, previous === null ? null : fid.cand(previous.id));
}

function equipSkillStone(state: GameState, ui: InventoryUi, view: CandidatesView, stoneId: string, index: number): void {
  const profile = state.skills.profile;
  const stone = findStone(profile, stoneId);
  if (stone === null) return;
  const previous = stoneInSlot(profile, index);
  if (!equipStone(profile, stoneId, index)) return;
  saveSkillProfile(profile);
  pushSfx(state, "equipOn");
  showNote(ui, `付けた: ${SKILL_DEFS[stone.skillKey].name}`);
  view.pinnedId = previous?.id ?? null;
  resetOrder(view);
  refocus(ui, view, previous === null ? null : fid.cand(previous.id));
}

function clearTarget(state: GameState, ui: InventoryUi, view: CandidatesView): void {
  const target = view.target;
  if (target.kind === "slot") {
    const item = state.profile.equipment[target.slot];
    if (item === null || item === undefined) return;
    unequipItem(state.profile, target.slot);
    applyEquipmentChange(state);
    showNote(ui, `外した: ${item.name}`);
    view.pinnedId = item.id;
    refocus(ui, view, fid.cand(item.id));
  } else if (target.kind === "stone") {
    const stone = stoneInSlot(state.skills.profile, target.index);
    if (stone === null) return;
    unequipSlot(state.skills.profile, target.index);
    saveSkillProfile(state.skills.profile);
    showNote(ui, `外した: ${SKILL_DEFS[stone.skillKey].name}`);
    view.pinnedId = stone.id;
    refocus(ui, view, fid.cand(stone.id));
  } else {
    return;
  }
  pushSfx(state, "equipOff");
  resetOrder(view);
}

function budChoose(state: GameState, ui: InventoryUi, view: CandidatesView, option: number): void {
  const chosen = chooseBud(state, option);
  if (chosen === null) return;
  pushSfx(state, "boonSelect");
  showNote(ui, `芽吹き: ${describeTrait(chosen).text}`);
  resetOrder(view);
  refocus(ui, view, null);
}

function salvage(state: GameState, ui: InventoryUi, view: CandidatesView, stoneId: string): void {
  const before = candidateEntries(state, view);
  const at = before.findIndex((e) => e.kind === "subject" && subjectId(e.subject) === stoneId);
  if (!salvageStone(state.skills.profile, stoneId)) return;
  saveSkillProfile(state.skills.profile);
  pushSfx(state, "dismantle");
  showNote(ui, "分解した");
  resetOrder(view);
  // 分解した札の位置に残った札へ焦点を置く（頁が先頭に戻っても読んでいた場所を失わない）
  const after = candidateEntries(state, view);
  const next = after[Math.min(Math.max(0, at), after.length - 1)];
  refocus(ui, view, next === undefined ? null : entryFocusId(next));
}

function act(state: GameState, ui: InventoryUi, view: CandidatesView, a: MenuAct): void {
  switch (a.kind) {
    case "setSort":
      view.sort = a.sort;
      ui.sortPref = a.sort;
      view.pinnedId = null;
      resetOrder(view);
      refocus(ui, view, null);
      pushSfx(state, "uiClick");
      return;
    case "equip":
      equipRelic(state, ui, view, a.itemId);
      return;
    case "equipStone":
      equipSkillStone(state, ui, view, a.stoneId, a.index);
      return;
    case "clearSlot":
      clearTarget(state, ui, view);
      return;
    case "chooseBud":
      budChoose(state, ui, view, a.option);
      return;
    case "salvageStone":
      salvage(state, ui, view, a.stoneId);
      return;
    default:
      return;
  }
}

// -----------------------------------------------------------------------------
// 見出し・案内・書付・送り・離れる
// -----------------------------------------------------------------------------

const FACE_LABEL = { attire: "装束", crest: "紋" } as const;
const VERB_LABEL: Readonly<Record<"produces" | "consumes", string>> = { produces: "源を足す", consumes: "糧を足す" };

/** 見出しの行き先「右手」「スキル 2」「燃焼系 › 源を足す」 */
export function targetLabel(target: Readonly<CandidateTarget>): string {
  switch (target.kind) {
    case "slot":
      return SLOT_LABEL[target.slot];
    case "stone":
      return `スキル ${target.index + 1}`;
    case "flow":
      return `${KEYWORD_DEFS[target.keyword].label}系 › ${VERB_LABEL[target.verb]}`;
  }
}

function header(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<CandidatesView>): MenuHeader {
  const entries = candidateEntries(state, view);
  const { page, pages } = pageOf(view.offset, entries.length);
  return { crumbs: `${FACE_LABEL[rootFace(ui)]} › ${targetLabel(view.target)}`, right: entries.length === 0 ? null : `${page}/${pages}` };
}

const GUIDE: readonly GuideVerb[] = ["move", "equip", "sort", "sheet", "back"];

function sheetFor(state: Readonly<GameState>, view: Readonly<CandidatesView>): SheetSubject | null {
  const entry = focusedEntry(state, view);
  if (entry === null || entry.kind === "clear") return null;
  if (entry.kind === "bud") return state.pendingBud === null ? null : { kind: "item", itemId: state.pendingBud.itemId };
  const s = entry.subject;
  if (s.kind === "item") return { kind: "pair", itemId: s.item.id, slot: s.item.slot };
  return { kind: "stonePair", stoneId: s.stone.id, index: view.target.kind === "stone" ? view.target.index : 0 };
}

/** 札の上にいるときだけ頁を送る（並びの札の上では送らない） */
function onCard(view: Readonly<CandidatesView>): boolean {
  const f = view.focus;
  return fidArgs(f, "c") !== null || fidArgs(f, "bud") !== null || f === fid.clear;
}

function edge(state: Readonly<GameState>, ui: InventoryUi, view: CandidatesView, dx: number, dy: number): boolean {
  if (dx !== 0 || dy === 0 || !onCard(view)) return false;
  const entries = candidateEntries(state, view);
  const next = view.offset + (dy > 0 ? CANDIDATE_PAGE : -CANDIDATE_PAGE);
  if (next < 0 || next >= entries.length) return false;
  view.offset = next;
  // 下へ送れば新しい頁の先頭、上へ送れば末尾の札へ（続けて押せる）
  const shown = visibleEntries(entries, next);
  const landing = dy > 0 ? shown[0] : shown[shown.length - 1];
  if (landing !== undefined) refocus(ui, view, entryFocusId(landing));
  return true;
}

/** その部位の候補を離れたら新着を見たことにする */
function leave(state: GameState, _ui: InventoryUi, view: CandidatesView): void {
  if (view.target.kind !== "slot") return;
  if (markSlotSeen(state.profile, view.target.slot)) saveProfile(state.profile);
}

export const CANDIDATES_VIEW: ViewModule<CandidatesView> = {
  layout,
  act,
  header,
  tag: (): MenuTag => ({ ...EMPTY_TAG }),
  guide: () => GUIDE,
  sheetFor,
  back: () => false,
  edge,
  leave,
};

/** 焦点の札を替えたときの試着（動く紋用。遺物と石の候補だけ。部位を空ける札は外したときの結果） */
export function tryOnForEntry(state: Readonly<GameState>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry>, base: Readonly<TryOnBase> = tryOnBase(state)): TryOnResult | null {
  if (entry.kind === "bud") return null;
  if (entry.kind === "clear") {
    const t = view.target;
    if (t.kind === "slot") return tryOn(base, { kind: "relic", slot: t.slot, item: null });
    if (t.kind === "stone") return tryOn(base, { kind: "stone", index: t.index, skillKey: null });
    return null;
  }
  const to = tryOnTargetOf(view.target, entry.subject);
  return to === null ? null : tryOn(base, to);
}
