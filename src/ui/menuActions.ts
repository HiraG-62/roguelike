import { type GameState, pushSfx } from "../core/state";
import { saveProfile } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { LOOT_SLOTS, type Slot } from "../loot/types";
import { saveSkillProfile, stoneInSlot } from "../skills/persistence";
import { BOONS } from "../system/boonDefs";
import { refreshPendingBud } from "../system/loot";
import { applyStats } from "../system/player";
import type { ResonanceOrigin } from "../system/resonance";
import { swapSkillSlots } from "../system/skills";
import { beadFocusFor, crestShape, originOfKey, sourceKey } from "./crestShape";
import { fid, fidArgs } from "./menuFocus";
import {
  type AnvilState,
  type FocusId,
  type InventoryUi,
  type LootSlot,
  type MenuEntry,
  type MenuFace,
  type MenuView,
  type ViewOf,
  rootFace,
} from "./menuState";

/**
 * 装備画面の共通の操作（docs/ideas/inventory-v2/E-impl.md 1-2〜1-4）: 開閉・頁の積み下ろし・面替え・紋から跳ぶ。
 * 頁から外れる物の leave は inventory.ts が積み重ねの差で呼ぶ（ここは頁の部品を知らない。循環 import を作らない）
 */

/** 荷札 2 行目の一時の知らせが残る秒数 */
export const NOTE_SECONDS = 1.5;

export function showNote(ui: InventoryUi, text: string): void {
  ui.note = { text, t: NOTE_SECONDS };
}

/** 焦点が動いたことにする（動く紋の 4 コマを最初から） */
function touchFocus(ui: InventoryUi): void {
  ui.focusAt = ui.time;
}

function freshAnvil(): AnvilState {
  return { slot: null, forge: null, offset: 0 };
}

/** 装束の 1 段目。鍛冶場から開いた間は金床の構え（紋へ替えて戻っても構えのまま） */
function attireRoot(ui: Readonly<InventoryUi>, focus: FocusId | null): ViewOf<"attire"> {
  return { kind: "attire", focus, anvil: ui.anvilSession ? freshAnvil() : null };
}

function crestRoot(focus: FocusId | null): ViewOf<"crest"> {
  return { kind: "crest", focus };
}

function setStack(ui: InventoryUi, stack: MenuView[]): void {
  ui.stack = stack;
  ui.note = null;
  ui.hold = null;
  ui.drag = null;
  touchFocus(ui);
}

const DEFAULT_PART: LootSlot = "mainHand";

/** 入口ごとの最初の積み重ね */
function entryStack(state: Readonly<GameState>, ui: Readonly<InventoryUi>, entry: MenuEntry): MenuView[] {
  switch (entry) {
    case "attire":
    case "anvil":
      return [attireRoot(ui, fid.part(DEFAULT_PART))];
    case "skills":
      return [attireRoot(ui, fid.stone(0)), { kind: "skills", focus: fid.stone(0), lift: null }];
    case "bud": {
      const pending = state.pendingBud;
      if (pending === null) return [attireRoot(ui, fid.part(DEFAULT_PART))];
      return [attireRoot(ui, fid.part(pending.slot)), candidatesFor(ui, pending.slot)];
    }
  }
}

/** 部位の候補の頁（並びは開き直しても保つ ui.sortPref） */
export function candidatesFor(ui: Readonly<InventoryUi>, slot: Slot): ViewOf<"candidates"> {
  return { kind: "candidates", focus: null, target: { kind: "slot", slot }, sort: ui.sortPref, offset: 0, order: null, pinnedId: null };
}

/** 開く。ゲームを止める（ラン中も拠点も）。開いている間に state.time は進まないので動きは ui.time で作る */
export function openMenu(state: GameState, ui: InventoryUi, entry: MenuEntry): void {
  ui.open = true;
  ui.anvilSession = entry === "anvil";
  ui.time = 0;
  setStack(ui, entryStack(state, ui, entry));
  state.paused = true;
}

/** 閉じる。止まりを解く */
export function closeMenu(state: GameState, ui: InventoryUi): void {
  ui.open = false;
  ui.anvilSession = false;
  setStack(ui, []);
  state.paused = false;
}

/** 紋の面の頁（装束から積むときは面を紋に替えてから積む。紋の写しの帯 → 紋の面のその系統） */
function isCrestPage(view: Readonly<MenuView>): boolean {
  return view.kind === "flow" || view.kind === "flowBoard" || view.kind === "act";
}

export function pushView(ui: InventoryUi, view: MenuView): void {
  if (isCrestPage(view) && rootFace(ui) === "attire") {
    const focus = view.kind === "flow" ? fid.band(view.keyword) : null;
    setStack(ui, [crestRoot(focus), view]);
    return;
  }
  ui.stack.push(view);
  ui.note = null;
  ui.hold = null;
  ui.drag = null;
  touchFocus(ui);
}

/** 1 段戻る。1 段目は外さない（閉じるのは closeMenu）。外した頁を返す */
export function popView(ui: InventoryUi): MenuView | null {
  if (ui.stack.length <= 1) return null;
  const popped = ui.stack.pop() ?? null;
  ui.note = null;
  ui.hold = null;
  ui.drag = null;
  touchFocus(ui);
  return popped;
}

export function replaceTop(ui: InventoryUi, view: MenuView): void {
  if (ui.stack.length === 0) {
    setStack(ui, [view]);
    return;
  }
  ui.stack[ui.stack.length - 1] = view;
  ui.note = null;
  touchFocus(ui);
}

function equippedRelicOrigin(state: Readonly<GameState>, slot: Slot): ResonanceOrigin | null {
  const item = state.profile.equipment[slot];
  return item ? { kind: "relic", id: item.id, slot } : null;
}

function stoneOrigin(state: Readonly<GameState>, index: number): ResonanceOrigin | null {
  const stone = stoneInSlot(state.skills.profile, index);
  return stone ? { kind: "stone", id: stone.skillKey, index } : null;
}

function isSlot(v: string | undefined): v is LootSlot {
  return v !== undefined && (LOOT_SLOTS as readonly string[]).includes(v);
}

/** 装束の焦点が指す出どころ（undefined = 出どころを指していない） */
function attireSource(state: Readonly<GameState>, focus: FocusId | null): ResonanceOrigin | null {
  const part = fidArgs(focus, "part")?.[0];
  if (isSlot(part)) return equippedRelicOrigin(state, part);
  const stone = fidArgs(focus, "stone")?.[0];
  if (stone !== undefined) return stoneOrigin(state, Number(stone));
  return null;
}

/** 紋・系統・加護・スキルの頁の焦点が指す出どころ（無ければ null） */
function pageSource(state: Readonly<GameState>, view: Readonly<MenuView>): ResonanceOrigin | null {
  const f = view.focus;
  const bead = fidArgs(f, "bead", 3)?.[2];
  if (bead !== undefined) return originOfKey(bead);
  const src = fidArgs(f, "src")?.slice(0, -1).join(":");
  if (src !== undefined && src !== "") return originOfKey(src);
  const daiPart = fidArgs(f, "dai")?.[0] === "part" ? fidArgs(f, "dai")?.[1] : undefined;
  if (isSlot(daiPart)) return equippedRelicOrigin(state, daiPart);
  const relic = fidArgs(f, "relic")?.[0];
  if (isSlot(relic)) return equippedRelicOrigin(state, relic);
  const grace = fidArgs(f, "grace")?.[0];
  if (grace !== undefined) return { kind: "boon", id: grace };
  const stone = view.kind === "skills" ? fidArgs(f, "stone")?.[0] : undefined;
  if (stone !== undefined) return stoneOrigin(state, Number(stone));
  return null;
}

/** 積み重ねを上から読み、最初に見つかった焦点の出どころ（装束の頁はそこで読み止める。見本 E.html と同じ） */
export function focusedSource(state: Readonly<GameState>, ui: Readonly<InventoryUi>): ResonanceOrigin | null {
  for (let i = ui.stack.length - 1; i >= 0; i--) {
    const view = ui.stack[i];
    if (view === undefined) continue;
    if (view.kind === "attire") return attireSource(state, view.focus);
    const found = pageSource(state, view);
    if (found !== null) return found;
  }
  return null;
}

function oppositeFace(face: MenuFace): MenuFace {
  return face === "attire" ? "crest" : "attire";
}

/** 紋の面での出どころの焦点（珠が見えていなければ遺物は台の身） */
function crestFocusFor(state: Readonly<GameState>, source: ResonanceOrigin | null): FocusId | null {
  if (source === null) return null;
  const bead = beadFocusFor(crestShape(state), sourceKey(source));
  if (bead !== null) return bead;
  return source.kind === "relic" && source.slot !== undefined ? fid.daiPart(source.slot) : null;
}

/** 装束の面での出どころの焦点（遺物 → 部位 / 石 → 腰の石 / それ以外 → 右手） */
function attireFocusFor(source: ResonanceOrigin | null): FocusId {
  if (source?.kind === "relic" && source.slot !== undefined) return fid.part(source.slot);
  if (source?.kind === "stone" && source.index !== undefined) return fid.stone(source.index);
  return fid.part(DEFAULT_PART);
}

/** 面を替える（深い頁は閉じ、焦点の出どころを持ち越す）。face 省略で反対の面 */
export function switchFace(state: Readonly<GameState>, ui: InventoryUi, face?: MenuFace): void {
  const target = face ?? oppositeFace(rootFace(ui));
  const source = focusedSource(state, ui);
  const root = target === "crest" ? crestRoot(crestFocusFor(state, source)) : attireRoot(ui, attireFocusFor(source));
  setStack(ui, [root]);
}

/** 装束のその部位へ（紋の台の身・加護の頁の乗る遺物） */
export function focusPart(ui: InventoryUi, slot: Slot): void {
  setStack(ui, [attireRoot(ui, fid.part(slot))]);
}

/** 候補の頁の左の部位のマスから、その部位の候補の頁へ（装束の頁の焦点も新しい部位へ。focusPart や芽の入口と同じ形） */
export function switchCandidatePart(ui: InventoryUi, slot: Slot): void {
  setStack(ui, [attireRoot(ui, fid.part(slot)), candidatesFor(ui, slot)]);
}

/**
 * 候補の頁の左下の腰の石から、そのスキル枠の候補の頁へ（スキルの頁・装束の頁の焦点もその石へ。部位の switchCandidatePart と同じ形）。
 * 絞り込みは引き継ぐ（同じ条件で別の枠を見比べられる）。スキルの頁が積まれていればその手持ちの設定も残す
 */
export function switchCandidateStone(ui: InventoryUi, index: number): void {
  const prevSkills = ui.stack.find((v): v is ViewOf<"skills"> => v.kind === "skills");
  const prevCands = ui.stack[ui.stack.length - 1];
  const filter = prevCands?.kind === "candidates" ? prevCands.filter : undefined;
  const skills: ViewOf<"skills"> = { kind: "skills", focus: fid.stone(index), lift: null, ...(prevSkills?.hand === undefined ? {} : { hand: prevSkills.hand }) };
  const cands: ViewOf<"candidates"> = {
    kind: "candidates",
    focus: null,
    target: { kind: "stone", index },
    sort: ui.sortPref,
    offset: 0,
    order: null,
    pinnedId: null,
    ...(filter === undefined ? {} : { filter }),
  };
  setStack(ui, [attireRoot(ui, fid.stone(index)), skills, cands]);
}

/** 紋の珠・系統の札から、その出どころの置き場へ跳ぶ（E-impl 1-3 の jump の表） */
export function jumpToSource(state: Readonly<GameState>, ui: InventoryUi, source: Readonly<ResonanceOrigin>): void {
  setStack(ui, jumpStack(state, ui, source));
}

/** 遺物: 装備中ならその部位、倉庫の物（試着の珠）ならその部位の候補でその物に焦点 */
function relicJumpStack(state: Readonly<GameState>, ui: Readonly<InventoryUi>, source: Readonly<ResonanceOrigin>): MenuView[] {
  const slot = source.slot ?? DEFAULT_PART;
  const root = attireRoot(ui, fid.part(slot));
  if (state.profile.equipment[slot]?.id === source.id) return [root];
  if (!state.profile.stash.some((it) => it.id === source.id)) return [root];
  return [root, { ...candidatesFor(ui, slot), focus: fid.cand(source.id) }];
}

function jumpStack(state: Readonly<GameState>, ui: Readonly<InventoryUi>, source: Readonly<ResonanceOrigin>): MenuView[] {
  switch (source.kind) {
    case "relic":
      return relicJumpStack(state, ui, source);
    case "stone": {
      const i = source.index ?? 0;
      return [attireRoot(ui, fid.stone(i)), { kind: "skills", focus: fid.stone(i), lift: null }];
    }
    case "boon":
      return boonJumpStack(source.id);
    default:
      return [attireRoot(ui, fid.body), sheetView({ kind: "body" })];
  }
}

function sheetView(subject: ViewOf<"sheet">["subject"]): ViewOf<"sheet"> {
  return { kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null };
}

function isBoonKey(v: string): v is keyof typeof BOONS {
  return Object.prototype.hasOwnProperty.call(BOONS, v);
}

/** 祝福: 加護 → 加護の頁 / 芯 → 書付「祝福」/ 系譜の札 → 書付「系譜」（系譜の無い呪い付きは書付「祝福」） */
function boonJumpStack(key: string): MenuView[] {
  if (!isBoonKey(key)) return [crestRoot(null)];
  const def = BOONS[key];
  if (def.action !== undefined) {
    return [crestRoot(fid.daiAct(def.action)), { kind: "act", focus: fid.grace(def.key), action: def.action }];
  }
  if (def.core === true) return [crestRoot(fid.daiCore), sheetView({ kind: "boon", key: def.key })];
  const lineage = def.lineage ?? def.fusion?.[0];
  if (lineage === undefined) return [crestRoot(null), sheetView({ kind: "boon", key: def.key })];
  return [crestRoot(fid.daiLineage(lineage)), sheetView({ kind: "lineage", lineage })];
}

/** 装備を変えた後: 能力を畳み直し（生命の割合は保つ）・芽の提示を付け直し・保存（付け替えは loadoutDirty で記録に乗る） */
export function applyEquipmentChange(state: GameState): void {
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  refreshPendingBud(state);
  saveProfile(state.profile);
}

/** 頁を積んだ・替えたときの音（面替え・跳ぶ・積む） */
export function menuClick(state: GameState): void {
  pushSfx(state, "uiClick");
}

/** 入れ替えで付かなくなった符が手持ちへ戻ったときの知らせの続き */
const SWAP_RUNES_BACK = "　付かない符は手持ちへ";

/**
 * 2 つのスキル枠の石を入れ替える（腰の石のドラッグ）。拾って付けた符も石と一緒に移る。
 * 候補の頁が積まれていれば並びを作り直させる（その枠の石が替わり、並ぶ石も替わる）
 */
export function swapStones(state: GameState, ui: InventoryUi, a: number, b: number): void {
  const profile = state.skills.profile;
  const stoneA = stoneInSlot(profile, a);
  const stoneB = stoneInSlot(profile, b);
  if (stoneA === null && stoneB === null) return;
  const back = swapSkillSlots(state, a, b);
  if (back === null) return;
  saveSkillProfile(profile);
  for (const view of ui.stack) {
    if (view.kind !== "candidates") continue;
    view.order = null;
    view.offset = 0;
    view.pinnedId = null;
  }
  pushSfx(state, "equipOn");
  showNote(ui, `スキル ${a + 1} と スキル ${b + 1} を入れ替えた${back > 0 ? SWAP_RUNES_BACK : ""}`);
  touchFocus(ui);
}
