import { KEYWORDS, KEYWORD_DEFS, type Keyword, profileKeywords } from "../core/keywords";
import { type GameState, pushSfx } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { describeTrait } from "../loot/describe";
import { equipItem, saveProfile, unequipItem } from "../loot/profile";
import type { AffixRoll, Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { disposeStone, equipStone, findStone, saveSkillProfile, stoneInSlot, unequipSlot } from "../skills/persistence";
import { ECHO_LABEL } from "../loot/crafting";
import { saveCraft } from "../loot/craftingStore";
import type { SkillKey, SkillResource, SkillStone } from "../skills/types";
import { relicKeywords, skillKeywords } from "../system/keywords";
import { chooseBud } from "../system/loot";
import { returnInactiveRunes } from "../system/skills";
import { SLOT_LABEL } from "./inventoryLayout";
import { applyEquipmentChange, showNote } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  NO_FILTER,
  type CandidateFilter,
  type CandidateFilterAxis,
  type CandidateSort,
  type CandidateTarget,
  type GuideVerb,
  type InventoryUi,
  type LootSlot,
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
/** 絞り込みの札 2 つ（並びの札の右。系統 = 丸印を 1 つ選ぶ / 型 = 気力型か再使用型）。クリックか決定で値を順に送る */
export const FILTER_CHIPS: Readonly<Record<CandidateFilterAxis, { x: number; y: number; w: number; h: number }>> = {
  keyword: { x: 196, y: 20, w: 36, h: 12 },
  resource: { x: 236, y: 20, w: 42, h: 12 },
};
/** 絞り込みの軸の順（札を並べる順） */
export const FILTER_AXES: readonly CandidateFilterAxis[] = ["keyword", "resource"];
/** スキル石の資源の型の表示名と送る順（GLOSSARY: 気力型 / 再使用型） */
export const RESOURCE_ORDER: readonly SkillResource[] = ["mana", "cooldown"];
export const RESOURCE_LABEL: Readonly<Record<SkillResource, string>> = { mana: "気力型", cooldown: "再使用型" };
/** 左下の腰の石の当たり（描画は render/candidatesUi.ts の MINI_GEM と同じ座標。石の候補の頁だけ） */
export const MINI_GEM = { x: 14, step: 22, y: 136 } as const;
const MINI_GEM_HIT = { dx: -3, dy: -2, w: 22, h: 30 } as const;

/** 左の小さな体の部位のマス（18px。描画は render/candidatesUi.ts、当たりは layout。座標の本体はここ） */
export const MINI_PART = 18;
export const MINI_PARTS: Readonly<Record<LootSlot, { x: number; y: number }>> = {
  head: { x: 46, y: 24 },
  amulet: { x: 84, y: 40 },
  mainHand: { x: 10, y: 66 },
  ring: { x: 84, y: 78 },
  armor: { x: 10, y: 100 },
  boots: { x: 46, y: 106 },
};
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

/**
 * 頁の 1 枚。芽吹きの札・空ける・装備中の札は倉庫の物ではないが 1 枚に数える。
 * group = 同じスキルの石が 2 個以上あるときの束（決定でその束の頁へ。docs/ideas/skill-stone-hunt.md）。
 * worn = 今その部位・枠に付けている物（先頭に「装備中」として並べ、比べる元にする。決定では何も起きない）
 */
export type CandidateEntry =
  | { kind: "worn"; subject: CandidateSubject }
  | { kind: "bud"; n: 0 | 1; roll: AffixRoll }
  | { kind: "subject"; subject: CandidateSubject }
  | { kind: "group"; skillKey: SkillKey; stones: SkillStone[] }
  | { kind: "clear" };

export function subjectId(s: Readonly<CandidateSubject>): string {
  return s.kind === "item" ? s.item.id : s.stone.id;
}

/** その物が関わる語（札の丸印と同じ元。絞り込みの系統の判定と選択肢に使う） */
export function subjectKeywords(s: Readonly<CandidateSubject>): Keyword[] {
  return profileKeywords(s.kind === "item" ? relicKeywords(s.item) : skillKeywords(SKILL_DEFS[s.stone.skillKey]));
}

function passesFilter(s: Readonly<CandidateSubject>, filter: Readonly<CandidateFilter>): boolean {
  if (filter.keyword !== null && !subjectKeywords(s).includes(filter.keyword)) return false;
  if (filter.resource !== null && (s.kind !== "stone" || SKILL_DEFS[s.stone.skillKey].resource !== filter.resource)) return false;
  return true;
}

/** 並ぶ物（絞り込みの前）。スキル石の枠は、その枠の石以外の石。系統からは全部位の倉庫の遺物だけ */
export function candidateBase(state: Readonly<GameState>, target: Readonly<CandidateTarget>): CandidateSubject[] {
  switch (target.kind) {
    case "slot":
      return state.profile.stash.filter((it) => it.slot === target.slot).map((item) => ({ kind: "item", item }));
    case "stone": {
      const worn = stoneInSlot(state.skills.profile, target.index);
      const group = target.group;
      return state.skills.profile.stones
        .filter((s) => s.id !== worn?.id && (group === undefined || s.skillKey === group))
        .map((stone) => ({ kind: "stone", stone }));
    }
    case "flow":
      return state.profile.stash
        .filter((it) => relicKeywords(it)[target.verb].includes(target.keyword))
        .map((item) => ({ kind: "item", item }));
  }
}

/** 並ぶ物（絞り込みのあと） */
export function candidatePool(state: Readonly<GameState>, target: Readonly<CandidateTarget>, filter: Readonly<CandidateFilter> = NO_FILTER): CandidateSubject[] {
  const base = candidateBase(state, target);
  return filter.keyword === null && filter.resource === null ? base : base.filter((s) => passesFilter(s, filter));
}

/** 絞り込みの札が使えるか（系統の候補は系統で絞り済み、型は石の候補だけ） */
export function filterAvailable(target: Readonly<CandidateTarget>, axis: CandidateFilterAxis): boolean {
  if (target.kind === "flow") return false;
  return axis === "keyword" || target.kind === "stone";
}

/** 絞り込みの札が送る値の順（null = 絞らない を先頭に。系統は今の候補に出てくる語だけを KEYWORDS の順で） */
export function filterChoices(state: Readonly<GameState>, target: Readonly<CandidateTarget>, axis: CandidateFilterAxis): (Keyword | SkillResource | null)[] {
  if (axis === "resource") return [null, ...RESOURCE_ORDER];
  const present = new Set<Keyword>();
  for (const s of candidateBase(state, target)) for (const k of subjectKeywords(s)) present.add(k);
  return [null, ...KEYWORDS.filter((k) => present.has(k))];
}

/** 次の値（今の値が選択肢に無ければ先頭の「絞らない」の次） */
export function nextFilter(state: Readonly<GameState>, target: Readonly<CandidateTarget>, filter: Readonly<CandidateFilter>, axis: CandidateFilterAxis): CandidateFilter {
  const choices = filterChoices(state, target, axis);
  const at = choices.indexOf(filter[axis]);
  const next = choices[(at + 1) % choices.length] ?? null;
  return axis === "keyword" ? { ...filter, keyword: next as Keyword | null } : { ...filter, resource: next as SkillResource | null };
}

/** その物に替えたときの試着の替え先（石の候補なら枠、遺物なら自分の部位） */
export function tryOnTargetOf(target: Readonly<CandidateTarget>, subject: Readonly<CandidateSubject>): TryOnTarget | null {
  if (subject.kind === "item") return { kind: "relic", slot: subject.item.slot, item: subject.item };
  if (target.kind !== "stone") return null;
  return { kind: "stone", index: target.index, skillKey: subject.stone.skillKey, ...(subject.stone.dwell === undefined ? {} : { dwell: subject.stone.dwell }) };
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
export function sortedIds(state: Readonly<GameState>, target: Readonly<CandidateTarget>, sort: CandidateSort, filter: Readonly<CandidateFilter> = NO_FILTER): string[] {
  const pool = candidatePool(state, target, filter);
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
  if (memo.order === null) memo.order = sortedIds(state, view.target, view.sort, view.filter ?? NO_FILTER);
  return memo.order;
}

/**
 * 部位の候補で芽のある部位は、先頭に芽吹きの札 2 枚。
 * 開いた部位の遺物の提示（item.budOffer）から作る（state.pendingBud は先頭の 1 つだけなので使わない）
 */
function budEntries(state: Readonly<GameState>, target: Readonly<CandidateTarget>): CandidateEntry[] {
  if (target.kind !== "slot") return [];
  const offer = state.profile.equipment[target.slot]?.budOffer;
  if (offer === null || offer === undefined) return [];
  return [
    { kind: "bud", n: 0, roll: offer.options[0] },
    { kind: "bud", n: 1, roll: offer.options[1] },
  ];
}

/** 末尾の「空ける」は部位か石の枠が埋まっているときだけ */
function isFilled(state: Readonly<GameState>, target: Readonly<CandidateTarget>): boolean {
  if (target.kind === "slot") return (state.profile.equipment[target.slot] ?? null) !== null;
  if (target.kind === "stone") return stoneInSlot(state.skills.profile, target.index) !== null;
  return false;
}

/**
 * 今その部位・枠に付けている物（装備中の札）。石の束の頁は、付けている石がその束のスキルのときだけ。系統の候補には出さない
 */
function wornEntries(state: Readonly<GameState>, target: Readonly<CandidateTarget>): CandidateEntry[] {
  if (target.kind === "slot") {
    const item = state.profile.equipment[target.slot] ?? null;
    return item === null ? [] : [{ kind: "worn", subject: { kind: "item", item } }];
  }
  if (target.kind !== "stone") return [];
  const stone = stoneInSlot(state.skills.profile, target.index);
  if (stone === null || (target.group !== undefined && target.group !== stone.skillKey)) return [];
  return [{ kind: "worn", subject: { kind: "stone", stone } }];
}

/** その石がどれかのスキル枠に付いているか（候補の札の「装備中」） */
export function isStoneWorn(state: Readonly<GameState>, stoneId: string): boolean {
  return state.skills.profile.loadout.includes(stoneId);
}

/** 頁に並ぶ札の全部（装備中 → 芽吹き → 外した物 → 並びの順 → 空ける） */
export function candidateEntries(state: Readonly<GameState>, view: Readonly<CandidatesView>): CandidateEntry[] {
  const pool = candidatePool(state, view.target, view.filter ?? NO_FILTER);
  const byId = new Map(pool.map((s) => [subjectId(s), s] as const));
  const ids = ensureOrder(state, view).filter((id) => byId.has(id));
  // 並びを作った後に倉庫へ入った物は末尾に置く
  const known = new Set(ids);
  for (const s of pool) if (!known.has(subjectId(s))) ids.push(subjectId(s));
  const pinned = view.pinnedId;
  const ordered = pinned !== null && byId.has(pinned) ? [pinned, ...ids.filter((id) => id !== pinned)] : ids;
  const entries: CandidateEntry[] = [...wornEntries(state, view.target), ...budEntries(state, view.target)];
  const subjects = ordered.map((id) => byId.get(id)).filter((x): x is CandidateSubject => x !== undefined);
  entries.push(...(groupsStones(view.target) ? groupStones(subjects) : subjects.map((subject): CandidateEntry => ({ kind: "subject", subject }))));
  if (isFilled(state, view.target)) entries.push({ kind: "clear" });
  return entries;
}

/** 石の候補の一覧（束を開いていない頁）だけ、同じスキルの石を束ねる */
function groupsStones(target: Readonly<CandidateTarget>): boolean {
  return target.kind === "stone" && target.group === undefined;
}

/**
 * 同じスキルの石が 2 個以上なら 1 枚の束にする（束は最初に出てきた位置、中の石は並びの順）。1 個だけのスキルは石の札のまま
 */
export function groupStones(subjects: readonly CandidateSubject[]): CandidateEntry[] {
  const byKey = new Map<SkillKey, SkillStone[]>();
  for (const s of subjects) {
    if (s.kind !== "stone") continue;
    const list = byKey.get(s.stone.skillKey);
    if (list === undefined) byKey.set(s.stone.skillKey, [s.stone]);
    else list.push(s.stone);
  }
  const out: CandidateEntry[] = [];
  const placed = new Set<SkillKey>();
  for (const s of subjects) {
    if (s.kind !== "stone") {
      out.push({ kind: "subject", subject: s });
      continue;
    }
    const key = s.stone.skillKey;
    if (placed.has(key)) continue;
    placed.add(key);
    const stones = byKey.get(key) ?? [s.stone];
    out.push(stones.length > 1 ? { kind: "group", skillKey: key, stones } : { kind: "subject", subject: s });
  }
  return out;
}

/** 束の代表の石（試着・書付に使う。束の石はどれも同じスキル） */
export function groupHead(entry: Readonly<CandidateEntry & { kind: "group" }>): SkillStone | null {
  return entry.stones[0] ?? null;
}

/** その石を指す札の焦点（束に入っていれば束の焦点） */
function stoneFocusId(state: Readonly<GameState>, view: Readonly<CandidatesView>, stoneId: string): string | null {
  for (const e of candidateEntries(state, view)) {
    if (e.kind === "subject" && subjectId(e.subject) === stoneId) return entryFocusId(e);
    if (e.kind === "group" && e.stones.some((st) => st.id === stoneId)) return entryFocusId(e);
  }
  return null;
}

export function entryFocusId(entry: Readonly<CandidateEntry>): string {
  if (entry.kind === "bud") return fid.bud(entry.n);
  if (entry.kind === "clear") return fid.clear;
  if (entry.kind === "worn") return fid.worn;
  if (entry.kind === "group") return fid.group(entry.skillKey);
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

function entryHit(state: Readonly<GameState>, entry: Readonly<CandidateEntry>, rect: MenuHit["rect"], view: Readonly<CandidatesView>): MenuHit {
  const target = view.target;
  const id = entryFocusId(entry);
  if (entry.kind === "bud") return { id, rect, act: { kind: "chooseBud", option: entry.n }, hold: null, nav: true };
  if (entry.kind === "clear") return { id, rect, act: { kind: "clearSlot" }, hold: null, nav: true };
  if (entry.kind === "worn") return { id, rect, act: null, hold: null, nav: true };
  if (entry.kind === "group") {
    const index = target.kind === "stone" ? target.index : 0;
    const pour = wornSkillKey(state, target) === entry.skillKey;
    return {
      id,
      rect,
      act: { kind: "push", view: { ...view, focus: null, target: { kind: "stone", index, group: entry.skillKey }, offset: 0, order: null, pinnedId: null } },
      hold: pour ? { kind: "pourGroup", skillKey: entry.skillKey } : null,
      nav: true,
    };
  }
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

/** 絞り込みの札（並びの札と同じく頁の先頭でだけ方向で止まる。使えない軸は出さない） */
function filterChipHits(target: Readonly<CandidateTarget>, reachable: boolean): MenuHit[] {
  return FILTER_AXES.filter((axis) => filterAvailable(target, axis)).map((axis) => ({
    id: fid.filter(axis),
    rect: FILTER_CHIPS[axis],
    act: { kind: "cycleFilter", axis },
    hold: null,
    nav: reachable,
  }));
}

/**
 * 左下の腰の石（石の候補だけ）。決定・クリックでその枠の候補の頁へ替える。部位のマスと同じく、通るだけでは焦点を奪わない。
 * マウスで掴んで別の石へ落とすと入れ替える。今の枠の石は掴むだけの当たり（決定も方向の移動も無い）
 */
function gemHits(state: Readonly<GameState>, target: Readonly<CandidateTarget>): MenuHit[] {
  if (target.kind !== "stone") return [];
  const hits: MenuHit[] = [];
  for (let i = 0; i < state.skills.slots.length; i++) {
    const here = i === target.index;
    hits.push({
      id: fid.gem(i),
      rect: { x: MINI_GEM.x + i * MINI_GEM.step + MINI_GEM_HIT.dx, y: MINI_GEM.y + MINI_GEM_HIT.dy, w: MINI_GEM_HIT.w, h: MINI_GEM_HIT.h },
      act: here ? null : { kind: "switchStone", index: i },
      hold: null,
      nav: !here,
      hover: false,
      drag: { kind: "stone", index: i },
    });
  }
  return hits;
}

/**
 * 左の部位のマス（部位の候補だけ。今の部位は除く）。決定・クリックでその部位の候補の頁へ替える。
 * hover: false = マウスが通るだけでは焦点を奪わない（札の差と動く紋が通過で消えないように）。
 * ← で札から移れるよう nav は true。札と並びの札より後ろに置く（ensureFocus が最初の nav を焦点にするため）
 */
function partHits(target: Readonly<CandidateTarget>): MenuHit[] {
  if (target.kind !== "slot") return [];
  return (Object.keys(MINI_PARTS) as LootSlot[])
    .filter((slot) => slot !== target.slot)
    .map((slot): MenuHit => {
      const at = MINI_PARTS[slot];
      return {
        id: fid.part(slot),
        rect: { x: at.x - 1, y: at.y - 1, w: MINI_PART + 2, h: MINI_PART + 2 },
        act: { kind: "switchPart", slot },
        hold: null,
        nav: true,
        hover: false,
      };
    });
}

function layout(state: Readonly<GameState>, _ui: Readonly<InventoryUi>, view: Readonly<CandidatesView>): MenuHit[] {
  const entries = candidateEntries(state, view);
  syncPage(view as CandidatesView, entries);
  const cards = visibleEntries(entries, view.offset).map((entry, i) =>
    entryHit(state, entry, { x: CAND_CARD.x, y: CAND_CARD.y + i * CAND_CARD.step, w: CAND_CARD.w, h: CAND_CARD.h }, view),
  );
  // 装備中の札は当たりの列の後ろへ（開いたときの最初の焦点を、比べる相手の札にする。ensureFocus は最初の nav を選ぶ）
  const worn = cards.filter((h) => h.id === fid.worn);
  return [...cards.filter((h) => h.id !== fid.worn), ...worn, ...sortChipHits(view.offset === 0), ...filterChipHits(view.target, view.offset === 0), ...partHits(view.target), ...gemHits(state, view.target)];
}

// -----------------------------------------------------------------------------
// 決定
// -----------------------------------------------------------------------------

/** 石を替えて付かなくなった符が手持ちへ戻ったときの知らせの続き */
const STONE_RUNES_BACK = "　付かない符は手持ちへ";

/** 並びを作り直させ、頁の先頭へ（付け替えの後・並びを変えた後） */
function resetOrder(view: CandidatesView): void {
  view.order = null;
  view.offset = 0;
}

function refocus(ui: InventoryUi, view: CandidatesView, id: string | null): void {
  view.focus = id;
  ui.focusAt = ui.time;
}

/** 絞り込みの札を 1 つ送る（並びを作り直して頁の先頭へ。焦点は札に残す） */
function cycleFilter(state: GameState, ui: InventoryUi, view: CandidatesView, axis: CandidateFilterAxis): void {
  if (!filterAvailable(view.target, axis)) return;
  view.filter = nextFilter(state, view.target, view.filter ?? NO_FILTER, axis);
  view.pinnedId = null;
  resetOrder(view);
  refocus(ui, view, fid.filter(axis));
  pushSfx(state, "uiClick");
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
  const back = returnInactiveRunes(state);
  showNote(ui, `付けた: ${SKILL_DEFS[stone.skillKey].name}${back > 0 ? STONE_RUNES_BACK : ""}`);
  view.pinnedId = previous?.id ?? null;
  resetOrder(view);
  refocus(ui, view, previous === null ? null : stoneFocusId(state, view, previous.id));
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
    const back = returnInactiveRunes(state);
    showNote(ui, `外した: ${SKILL_DEFS[stone.skillKey].name}${back > 0 ? STONE_RUNES_BACK : ""}`);
    view.pinnedId = stone.id;
    refocus(ui, view, fid.cand(stone.id));
  } else {
    return;
  }
  pushSfx(state, "equipOff");
  resetOrder(view);
}

function budChoose(state: GameState, ui: InventoryUi, view: CandidatesView, option: number): void {
  if (view.target.kind !== "slot") return;
  const chosen = chooseBud(state, view.target.slot, option);
  if (chosen === null) return;
  pushSfx(state, "boonSelect");
  showNote(ui, `芽吹き: ${describeTrait(chosen).text}`);
  resetOrder(view);
  refocus(ui, view, null);
}

/** 今の枠に付けている石のスキル（石の候補でなければ null） */
function wornSkillKey(state: Readonly<GameState>, target: Readonly<CandidateTarget>): SkillKey | null {
  if (target.kind !== "stone") return null;
  return stoneInSlot(state.skills.profile, target.index)?.skillKey ?? null;
}

/** 処分の知らせ「処分した　冥響 +1」「注いだ 発動 +120　冥響 +1」 */
function disposalNote(casts: number, poured: boolean, umbra: number): string {
  const head = poured && casts > 0 ? `注いだ 発動 +${casts}` : "処分した";
  return `${head}　${ECHO_LABEL.umbra} +${umbra}`;
}

/** 冥響を財布へ入れて保存する */
function gainUmbra(ui: InventoryUi, umbra: number): void {
  if (umbra <= 0) return;
  ui.craft.echoes.umbra += umbra;
  saveCraft(ui.craft);
}

/**
 * 石の処分（長押し）。冥響を得て、今の枠に同じスキルの石を付けていれば使い込みの一部を注ぐ（遺物の「注ぎ」と同じ形）
 */
function salvage(state: GameState, ui: InventoryUi, view: CandidatesView, stoneId: string): void {
  const before = candidateEntries(state, view);
  const at = before.findIndex((e) => e.kind === "subject" && subjectId(e.subject) === stoneId);
  const worn = view.target.kind === "stone" ? stoneInSlot(state.skills.profile, view.target.index) : null;
  const result = disposeStone(state.skills.profile, stoneId, worn?.id ?? null);
  if (result === null) return;
  saveSkillProfile(state.skills.profile);
  gainUmbra(ui, result.umbra);
  pushSfx(state, "dismantle");
  showNote(ui, disposalNote(result.casts, result.poured !== null, result.umbra));
  resetOrder(view);
  // 分解した札の位置に残った札へ焦点を置く（頁が先頭に戻っても読んでいた場所を失わない）
  const after = candidateEntries(state, view);
  const next = after[Math.min(Math.max(0, at), after.length - 1)];
  refocus(ui, view, next === undefined ? null : entryFocusId(next));
}

/**
 * 束の長押し: 宿り符の無い石を、今の枠に付けている同じスキルの石へまとめて注ぐ。
 * 宿り符のある石と、ほかの枠に付けている石は残す
 */
function pourGroup(state: GameState, ui: InventoryUi, view: CandidatesView, skillKey: SkillKey): void {
  const profile = state.skills.profile;
  const worn = view.target.kind === "stone" ? stoneInSlot(profile, view.target.index) : null;
  if (worn === null || worn.skillKey !== skillKey) return;
  const victims = profile.stones.filter((st) => st.skillKey === skillKey && st.id !== worn.id && st.dwell === undefined && !profile.loadout.includes(st.id));
  if (victims.length === 0) {
    showNote(ui, "注げる石なし（宿り符の石は残す）");
    return;
  }
  let umbra = 0;
  let casts = 0;
  for (const st of victims) {
    const r = disposeStone(profile, st.id, worn.id);
    if (r === null) continue;
    umbra += r.umbra;
    casts += r.casts;
  }
  saveSkillProfile(profile);
  gainUmbra(ui, umbra);
  pushSfx(state, "dismantle");
  showNote(ui, `${victims.length} 個を注いだ 発動 +${casts}　${ECHO_LABEL.umbra} +${umbra}`);
  resetOrder(view);
  refocus(ui, view, null);
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
    case "cycleFilter":
      cycleFilter(state, ui, view, a.axis);
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
    case "pourGroup":
      pourGroup(state, ui, view, a.skillKey);
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
      return target.group === undefined ? `スキル ${target.index + 1}` : `スキル ${target.index + 1} › ${SKILL_DEFS[target.group].name}`;
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
/** 石の候補は長押しで処分できる（冥響、同じスキルを付けていれば注ぐ） */
const STONE_GUIDE: readonly GuideVerb[] = ["move", "equip", "dispose", "sort", "sheet", "back"];

function sheetFor(state: Readonly<GameState>, view: Readonly<CandidatesView>): SheetSubject | null {
  const entry = focusedEntry(state, view);
  if (entry === null || entry.kind === "clear") return null;
  if (entry.kind === "worn") return entry.subject.kind === "item" ? { kind: "item", itemId: entry.subject.item.id } : { kind: "stone", stoneId: entry.subject.stone.id };
  if (entry.kind === "group") {
    const head = groupHead(entry);
    return head === null ? null : { kind: "stonePair", stoneId: head.id, index: view.target.kind === "stone" ? view.target.index : 0 };
  }
  if (entry.kind === "bud") {
    const worn = view.target.kind === "slot" ? state.profile.equipment[view.target.slot] : null;
    return worn === null || worn === undefined ? null : { kind: "item", itemId: worn.id };
  }
  const s = entry.subject;
  if (s.kind === "item") return { kind: "pair", itemId: s.item.id, slot: s.item.slot };
  return { kind: "stonePair", stoneId: s.stone.id, index: view.target.kind === "stone" ? view.target.index : 0 };
}

/** 札の上にいるときだけ頁を送る（並びの札の上では送らない） */
function onCard(view: Readonly<CandidatesView>): boolean {
  const f = view.focus;
  return fidArgs(f, "c") !== null || fidArgs(f, "cg") !== null || fidArgs(f, "bud") !== null || f === fid.clear || f === fid.worn;
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

const FILTER_TAG_TITLE: Readonly<Record<CandidateFilterAxis, string>> = { keyword: "系統で絞る", resource: "型で絞る" };
const FILTER_ALL = "絞らない";
const SORT_TAG_TITLE = "並び";
const CHIP_HINT = "決定で次へ";

/** 絞り込み・並びの札の荷札（札が何をするかを言う。候補の札の上では出さない） */
function chipTag(view: Readonly<CandidatesView>, focus: Readonly<MenuHit> | null): MenuTag {
  if (focus === null) return { ...EMPTY_TAG };
  const filter = view.filter ?? NO_FILTER;
  const axis = FILTER_AXES.find((a) => focus.id === fid.filter(a));
  if (axis !== undefined) {
    const value = axis === "keyword" ? (filter.keyword === null ? FILTER_ALL : `${KEYWORD_DEFS[filter.keyword].label}系`) : filter.resource === null ? FILTER_ALL : RESOURCE_LABEL[filter.resource];
    return { title: `${FILTER_TAG_TITLE[axis]}  ${value}`, sub: CHIP_HINT, aside: null };
  }
  const sort = SORT_ORDER.find((s) => focus.id === fid.sort(s));
  if (sort !== undefined) return { title: `${SORT_TAG_TITLE}  ${SORT_LABEL[sort].long}`, sub: "決定でこの並びにする", aside: null };
  return { ...EMPTY_TAG };
}

export const CANDIDATES_VIEW: ViewModule<CandidatesView> = {
  layout,
  act,
  header,
  tag: (_state, _ui, view, focus): MenuTag => chipTag(view, focus),
  guide: (_state, view) => (view.target.kind === "stone" ? STONE_GUIDE : GUIDE),
  sheetFor,
  back: () => false,
  edge,
  leave,
};

/** 焦点の札を替えたときの試着（動く紋用。遺物と石の候補だけ。部位を空ける札は外したときの結果） */
export function tryOnForEntry(state: Readonly<GameState>, view: Readonly<CandidatesView>, entry: Readonly<CandidateEntry>, base: Readonly<TryOnBase> = tryOnBase(state)): TryOnResult | null {
  if (entry.kind === "bud" || entry.kind === "worn") return null;
  if (entry.kind === "group") {
    const head = groupHead(entry);
    if (head === null) return null;
    const to = tryOnTargetOf(view.target, { kind: "stone", stone: head });
    return to === null ? null : tryOn(base, to);
  }
  if (entry.kind === "clear") {
    const t = view.target;
    if (t.kind === "slot") return tryOn(base, { kind: "relic", slot: t.slot, item: null });
    if (t.kind === "stone") return tryOn(base, { kind: "stone", index: t.index, skillKey: null });
    return null;
  }
  const to = tryOnTargetOf(view.target, entry.subject);
  return to === null ? null : tryOn(base, to);
}
