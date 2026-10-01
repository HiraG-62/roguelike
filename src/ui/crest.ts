import { KEYWORD_DEFS, type Keyword, type KeywordVerb, kw } from "../core/keywords";
import type { GameState } from "../core/state";
import { RESONANCE, BOON } from "../data/tuning";
import { JOBS } from "../data/jobs";
import { REFORGES } from "../data/reforges";
import { FORMS } from "../data/weaponForms";
import { keystoneDef } from "../loot/affixes";
import type { Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import {
  BOONS,
  BOON_ACTIONS,
  BOON_ACTION_LABEL,
  BOON_CARD_LABEL,
  LINEAGE_KEYS,
  LINEAGE_LABEL,
  type BoonAction,
  type BoonKey,
  type LineageKey,
} from "../system/boonDefs";
import { gracesOf, lineageCardsOwned, ownedCoreDef } from "../system/boons";
import { type ResonanceOrigin, resonanceBySource, resonanceBySourceOf } from "../system/resonance";
import { ATTIRE_SLOTS, bodyTitle, floorLabel } from "./attire";
import { type CrestBead, type CrestRow, type CrestShape, crestShape, sourceKey } from "./crestShape";
import { SLOT_LABEL } from "./inventoryLayout";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type FocusId,
  type GuideVerb,
  type InventoryUi,
  type LootSlot,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";
import { type BandDelta, compareBands, sameOrigin, thinnedKeywords, tryOn, tryOnBase } from "./tryOn";

/**
 * 装備画面の紋の面（docs/ideas/inventory-v2/E-impl.md 4-3 E4、見本 E.html の ③ 紋）。
 * 帯 = 系統（段の立った系統 4 + 伏流 2）、左に源・右に糧の珠、右上に強めの珠。下の台に 身 6・加護の帯 5・系譜・芯・系統を選ぶ。
 * 珠で決定するとその物の置き場（装束・スキル・加護・書付）へ跳ぶ。座標は 480x270 の論理座標で、描画（render/crestUi.ts）と共有する
 */

type CrestView = ViewOf<"crest">;

// -----------------------------------------------------------------------------
// 寸法（描画と当たりで共有する）
// -----------------------------------------------------------------------------

export const CREST_LAYOUT = {
  /** 帯の並びの上端と、段の立った帯 / 伏流の行の高さ・帯の中心のずれ */
  rowsY: 20,
  steppedH: 32,
  underH: 16,
  steppedCy: 13,
  underCy: 8,
  /** 帯の左右の端・丸印の中心 x・丸印の直径 */
  bandX0: 160,
  bandX1: 320,
  discX: 240,
  steppedDisc: 24,
  underDisc: 14,
  /** 段の点の左上（行の上端からの下がり） */
  dotsX: 232,
  dotsDy: 28,
  /** 珠（12px）の置き場: 源は左へ・糧は右へ・強めは丸印の右上。ずれの 6 は珠の高さの半分 */
  beadSize: 12,
  beadPitch: 16,
  sourceX: 140,
  sinkX: 328,
  amplifierX: 262,
  beadDy: 6,
  /** 段が下がる帯の印（▼ / 消）の左端 */
  markX: 404,
} as const;

/** 台（下の帯）の寸法 */
export const DAI = {
  ruleY: 184,
  y: 190,
  /** 身 6（3 × 2） */
  partX: 8,
  partPitch: 16,
  partSize: 14,
  partDividerX: 64,
  /** 加護の帯 5 */
  actX: 72,
  actY: 195,
  actPitch: 56,
  actSize: 14,
  pipDx: 19,
  pipPitch: 9,
  pipDy: 4,
  pipSize: 6,
  actDividerX: 358,
  /** 系譜（持っている札の多い順に 4 つまで）。仕切り（18px 刻み）と札の本数の ▬ */
  lineageX: 364,
  lineagePitch: 19,
  lineageMax: 4,
  lineageDisc: 12,
  lineageBarsDy: 16,
  /** 芯の灯 */
  core: { x: 446, y: 192, w: 8, h: 10 } as Rect,
  /** 系統を選ぶ */
  board: { x: 458, y: 190, w: 14, h: 14 } as Rect,
} as const;

export interface CrestRowRect {
  row: CrestRow;
  y: number;
  h: number;
  /** 帯の中心の y */
  cy: number;
}

/** 帯の行を上から積む（段の立った行 32px・伏流 16px） */
export function crestRowRects(shape: Readonly<CrestShape>): CrestRowRect[] {
  let y = CREST_LAYOUT.rowsY;
  return shape.rows.map((row) => {
    const h = row.undercurrent ? CREST_LAYOUT.underH : CREST_LAYOUT.steppedH;
    const rect: CrestRowRect = { row, y, h, cy: y + (row.undercurrent ? CREST_LAYOUT.underCy : CREST_LAYOUT.steppedCy) };
    y += h;
    return rect;
  });
}

/** 帯の脇に並ぶ物 1 つ。bead = 珠 / more = 畳んだ珠 / plus = 伏流の「＋」 */
export interface BeadSlot {
  kind: "bead" | "more" | "plus";
  verb: KeywordVerb;
  /** 珠の左上 */
  x: number;
  y: number;
  bead: CrestBead | null;
  /** more のときの畳んだ数 */
  folded: number;
}

function slotX(verb: KeywordVerb, i: number): number {
  const L = CREST_LAYOUT;
  if (verb === "produces") return L.sourceX - i * L.beadPitch;
  if (verb === "consumes") return L.sinkX + i * L.beadPitch;
  return L.amplifierX + i * L.beadPitch;
}

function sideSlots(r: Readonly<CrestRowRect>, verb: KeywordVerb): BeadSlot[] {
  const y = r.cy - CREST_LAYOUT.beadDy;
  const list = r.row[verb];
  const out: BeadSlot[] = list.map((bead, i) => ({ kind: "bead", verb, x: slotX(verb, i), y, bead, folded: 0 }));
  const folded = r.row.overflow[verb];
  if (folded > 0) out.push({ kind: "more", verb, x: slotX(verb, out.length), y, bead: null, folded });
  if (r.row.plus === verb) out.push({ kind: "plus", verb, x: slotX(verb, out.length), y, bead: null, folded: 0 });
  return out;
}

/** 帯 1 本の脇の物（源・糧、段の立った帯なら強めも） */
export function rowSlots(r: Readonly<CrestRowRect>): BeadSlot[] {
  const sides = [...sideSlots(r, "produces"), ...sideSlots(r, "consumes")];
  return r.row.undercurrent ? sides : [...sides, ...sideSlots(r, "amplifies")];
}

/** 珠の当たり（枠より 1px 広く取る） */
export function slotRect(s: Readonly<BeadSlot>): Rect {
  const size = CREST_LAYOUT.beadSize;
  return { x: s.x - 1, y: s.y - 1, w: size + 2, h: size + 2 };
}

/** 帯の当たり（丸印のまわり。珠と重ならない幅） */
export function bandRect(r: Readonly<CrestRowRect>): Rect {
  return { x: 164, y: r.y, w: 92, h: r.h };
}

export function daiPartRect(i: number): Rect {
  return { x: DAI.partX + (i % 3) * DAI.partPitch, y: DAI.y + Math.floor(i / 3) * DAI.partPitch, w: DAI.partSize, h: DAI.partSize };
}

export function daiActRect(i: number): Rect {
  return { x: DAI.actX + i * DAI.actPitch, y: DAI.actY, w: DAI.actSize, h: DAI.actSize };
}

/** 加護の帯の当たり（行動の札 + 加護の枠 3 つ分） */
const ACT_HIT_W = 46;

export function lineageCellX(i: number): number {
  return DAI.lineageX + i * DAI.lineagePitch;
}

export interface OwnedLineage {
  lineage: LineageKey;
  /** 持っている札の枚数（融合は両方の系譜に数える） */
  count: number;
}

/** 持っている系譜（札の多い順、同じなら系譜の並び順）。DAI.lineageMax まで */
export function ownedLineages(state: Readonly<GameState>): OwnedLineage[] {
  return LINEAGE_KEYS.map((lineage) => ({ lineage, count: lineageCardsOwned(state, lineage) }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, DAI.lineageMax);
}

/** 持っている芯（無ければ null）の祝福 key */
export function ownedCoreKey(state: Readonly<GameState>): BoonKey | null {
  return ownedCoreDef(state.boons)?.key ?? null;
}

// -----------------------------------------------------------------------------
// 出どころの名前・書付・外すと細る帯
// -----------------------------------------------------------------------------

export function isKeyword(v: string | undefined): v is Keyword {
  return v !== undefined && Object.prototype.hasOwnProperty.call(KEYWORD_DEFS, v);
}

export function isVerb(v: string | undefined): v is KeywordVerb {
  return v === "produces" || v === "consumes" || v === "amplifies";
}

function isLootSlot(v: string | undefined): v is LootSlot {
  return v !== undefined && (ATTIRE_SLOTS as readonly string[]).includes(v);
}

function isAction(v: string | undefined): v is BoonAction {
  return v !== undefined && (BOON_ACTIONS as readonly string[]).includes(v);
}

function isLineage(v: string | undefined): v is LineageKey {
  return v !== undefined && (LINEAGE_KEYS as readonly string[]).includes(v);
}

export function isBoonKey(v: string): v is BoonKey {
  return Object.prototype.hasOwnProperty.call(BOONS, v);
}

/** 系統の表示名「燃焼系」 */
export function keywordName(k: Keyword): string {
  return `${KEYWORD_DEFS[k].label}系`;
}

/** 装備中か倉庫の遺物 */
export function findOriginItem(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>): Item | null {
  if (origin.kind !== "relic") return null;
  const worn = origin.slot === undefined ? undefined : state.profile.equipment[origin.slot];
  if (worn?.id === origin.id) return worn;
  return state.profile.stash.find((it) => it.id === origin.id) ?? null;
}

interface NamedTable {
  readonly [key: string]: { readonly name: string } | undefined;
}

const NAME_UNKNOWN = "不明";

function boonSub(key: BoonKey): string {
  const def = BOONS[key];
  if (def.fusion !== undefined) return `融合 ${def.fusion.map((l) => LINEAGE_LABEL[l]).join("・")}`;
  if (def.core === true) return "芯";
  if (def.lineage !== undefined && def.card !== undefined) return `${LINEAGE_LABEL[def.lineage]}の${BOON_CARD_LABEL[def.card]}`;
  return "祝福";
}

/** 出どころの名前と種類（荷札の 1 行目「打刀「王殺しの不屈」  右手」） */
export function originCard(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>): { name: string; sub: string } {
  switch (origin.kind) {
    case "relic":
      return { name: findOriginItem(state, origin)?.name ?? NAME_UNKNOWN, sub: origin.slot === undefined ? "遺物" : SLOT_LABEL[origin.slot] };
    case "stone": {
      const def = (SKILL_DEFS as NamedTable)[origin.id];
      return { name: def?.name ?? NAME_UNKNOWN, sub: "スキル石" };
    }
    case "boon":
      return { name: isBoonKey(origin.id) ? BOONS[origin.id].name : NAME_UNKNOWN, sub: isBoonKey(origin.id) ? boonSub(origin.id) : "祝福" };
    case "job":
      return { name: (JOBS as NamedTable)[origin.id]?.name ?? NAME_UNKNOWN, sub: "流儀" };
    case "form":
      return { name: `${(FORMS as NamedTable)[origin.id]?.name ?? NAME_UNKNOWN}の型`, sub: "型" };
    case "reforge":
      return { name: (REFORGES as NamedTable)[origin.id]?.name ?? NAME_UNKNOWN, sub: "改鋳" };
    case "keystone":
      return { name: keystoneDef(origin.id)?.name ?? NAME_UNKNOWN, sub: "誓約" };
  }
}

/** 出どころの書付（遺物 = 1 品 / 石 / 祝福 / それ以外 = 体）。装備中でない遺物・空の石は null */
export function sheetOfOrigin(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>): SheetSubject | null {
  switch (origin.kind) {
    case "relic": {
      const item = findOriginItem(state, origin);
      return item === null ? null : { kind: "item", itemId: item.id };
    }
    case "stone": {
      const stone = origin.index === undefined ? null : stoneInSlot(state.skills.profile, origin.index);
      return stone === null ? null : { kind: "stone", stoneId: stone.id };
    }
    case "boon":
      return isBoonKey(origin.id) ? { kind: "boon", key: origin.id } : null;
    default:
      return { kind: "body" };
  }
}

/** 出どころ 1 つの珠（形・色・key は紋の珠と同じ）。紋に描けない系統の札でも珠を描くため、その出どころだけの数えから crestShape に作らせる */
export function originBead(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>): CrestBead {
  const alone = resonanceBySourceOf([{ origin, profile: kw(["melee"]) }]);
  const made = crestShape(state, alone).rows[0]?.produces[0];
  return made ?? { source: { ...origin }, key: sourceKey(origin), shape: "origin", color: UNKNOWN_BEAD_COLOR };
}

const UNKNOWN_BEAD_COLOR = "#9a948a";

/** その出どころが無かったら段が下がる（ひび・消える）系統。遺物・石は試着の外す、それ以外は出どころ列から除いて数え直す */
export function removalDeltas(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>): BandDelta[] {
  const base = tryOnBase(state);
  if (origin.kind === "relic" && origin.slot !== undefined) return thinnedKeywords(tryOn(base, { kind: "relic", slot: origin.slot, item: null }));
  if (origin.kind === "stone" && origin.index !== undefined) return thinnedKeywords(tryOn(base, { kind: "stone", index: origin.index, skillKey: null }));
  const rest = base.sources.filter((e) => !sameOrigin(e.origin, origin));
  return thinnedKeywords(compareBands(resonanceBySourceOf(base.sources, base.ease), resonanceBySourceOf(rest, base.ease)));
}

const KEYWORD_JOIN = "・";
const NO_THINNING = "細る系統はない";

/** 荷札の 2 行目「外すと 燃焼系 が細る」 */
export function removalLine(origin: Readonly<ResonanceOrigin>, deltas: readonly BandDelta[]): string {
  if (deltas.length === 0) return NO_THINNING;
  const head = origin.kind === "relic" || origin.kind === "stone" ? "外すと" : "無ければ";
  return `${head} ${deltas.map((d) => keywordName(d.keyword)).join(KEYWORD_JOIN)} が細る`;
}

const PIP_ON = "●";
const PIP_OFF = "○";
const PIP_MAX = 8;

/** 点の並び（持っている数は ●、段が立つまでに足りない数は ○）。数字を出さずに数を見せる */
export function pips(have: number, need: number): string {
  return `${PIP_ON.repeat(Math.min(have, PIP_MAX))}${PIP_OFF.repeat(Math.max(0, Math.min(need - have, PIP_MAX)))}`;
}

/** 系統 1 つの荷札（「燃焼系  2 段」/ 源・糧・強めの点）。紋の帯と系統を選ぶ盤が使う */
export function keywordTag(state: Readonly<GameState>, k: Keyword): MenuTag {
  const r = resonanceBySource(state)[k];
  const level = r.step > 0 ? `${r.step} 段` : r.produces.length + r.consumes.length > 0 ? "伏流" : "";
  const amp = r.amplifies.length > 0 ? `　強め ${pips(r.amplifies.length, 0)}` : "";
  return {
    title: `${keywordName(k)}${level === "" ? "" : `  ${level}`}`,
    sub: `源 ${pips(r.produces.length, RESONANCE.minSources)}　糧 ${pips(r.consumes.length, RESONANCE.minSinks)}${amp}`,
    aside: null,
  };
}

// -----------------------------------------------------------------------------
// 当たり
// -----------------------------------------------------------------------------

function candidatesOfFlow(ui: Readonly<InventoryUi>, keyword: Keyword, verb: "produces" | "consumes"): ViewOf<"candidates"> {
  return { kind: "candidates", focus: null, target: { kind: "flow", keyword, verb }, sort: ui.sortPref, offset: 0, order: null, pinnedId: null };
}

function flowOf(keyword: Keyword): ViewOf<"flow"> {
  return { kind: "flow", focus: null, keyword };
}

function slotHit(ui: Readonly<InventoryUi>, keyword: Keyword, s: Readonly<BeadSlot>): MenuHit {
  const rect = slotRect(s);
  if (s.kind === "bead" && s.bead !== null) {
    return { id: fid.bead(keyword, s.verb, s.bead.key), rect, act: { kind: "jump", source: s.bead.source }, hold: null, nav: true };
  }
  if (s.kind === "plus" && s.verb !== "amplifies") {
    return { id: fid.plus(keyword, s.verb), rect, act: { kind: "push", view: candidatesOfFlow(ui, keyword, s.verb) }, hold: null, nav: true };
  }
  return { id: fid.more(keyword, s.verb), rect, act: { kind: "push", view: flowOf(keyword) }, hold: null, nav: true };
}

function rowHits(ui: Readonly<InventoryUi>, shape: Readonly<CrestShape>): MenuHit[] {
  const hits: MenuHit[] = [];
  for (const r of crestRowRects(shape)) {
    const keyword = r.row.keyword;
    hits.push({ id: fid.band(keyword), rect: bandRect(r), act: { kind: "push", view: flowOf(keyword) }, hold: null, nav: true });
    for (const s of rowSlots(r)) hits.push(slotHit(ui, keyword, s));
  }
  return hits;
}

function actView(action: BoonAction): ViewOf<"act"> {
  return { kind: "act", focus: null, action };
}

function daiHits(state: Readonly<GameState>, shape: Readonly<CrestShape>): MenuHit[] {
  const hits: MenuHit[] = [];
  ATTIRE_SLOTS.forEach((slot, i) => {
    const r = daiPartRect(i);
    hits.push({ id: fid.daiPart(slot), rect: { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, act: { kind: "focusPart", slot }, hold: null, nav: true });
  });
  BOON_ACTIONS.forEach((action, i) => {
    const r = daiActRect(i);
    hits.push({ id: fid.daiAct(action), rect: { x: r.x - 1, y: r.y - 1, w: ACT_HIT_W, h: r.h + 2 }, act: { kind: "push", view: actView(action) }, hold: null, nav: true });
  });
  ownedLineages(state).forEach((l, i) => {
    const x = lineageCellX(i);
    const sheet: ViewOf<"sheet"> = { kind: "sheet", focus: null, subject: { kind: "lineage", lineage: l.lineage }, page: 0, offset: 0, forge: null };
    hits.push({ id: fid.daiLineage(l.lineage), rect: { x: x + 1, y: DAI.y - 1, w: DAI.lineagePitch - 2, h: 22 }, act: { kind: "push", view: sheet }, hold: null, nav: true });
  });
  const core = ownedCoreKey(state);
  if (core !== null) {
    const c = DAI.core;
    const sheet: ViewOf<"sheet"> = { kind: "sheet", focus: null, subject: { kind: "boon", key: core }, page: 0, offset: 0, forge: null };
    hits.push({ id: fid.daiCore, rect: { x: c.x - 2, y: c.y - 2, w: c.w + 4, h: c.h + 4 }, act: { kind: "push", view: sheet }, hold: null, nav: true });
  }
  if (shape.hidden.length > 0) {
    const b = DAI.board;
    const board: ViewOf<"flowBoard"> = { kind: "flowBoard", focus: fid.kw(shape.hidden[0] ?? "melee") };
    hits.push({ id: fid.board, rect: { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, act: { kind: "push", view: board }, hold: null, nav: true });
  }
  return hits;
}

// -----------------------------------------------------------------------------
// 荷札・書付
// -----------------------------------------------------------------------------

/** 焦点が指す珠の出どころ（身・珠。それ以外は null） */
function focusOrigin(state: Readonly<GameState>, focus: FocusId | null): ResonanceOrigin | null {
  const slotArg = fidArgs(focus, "dai")?.[0] === "part" ? fidArgs(focus, "dai")?.[1] : undefined;
  if (isLootSlot(slotArg)) {
    const item = state.profile.equipment[slotArg];
    return item ? { kind: "relic", id: item.id, slot: slotArg } : null;
  }
  const bead = fidArgs(focus, "bead", 3)?.[2];
  if (bead === undefined) return null;
  return beadOrigin(state, bead);
}

function beadOrigin(state: Readonly<GameState>, key: string): ResonanceOrigin | null {
  for (const row of crestShape(state).rows) {
    for (const verb of ["produces", "consumes", "amplifies"] as const) {
      const found = row[verb].find((b) => b.key === key);
      if (found !== undefined) return found.source;
    }
  }
  return null;
}

function partTag(state: Readonly<GameState>, slot: LootSlot): MenuTag {
  const item = state.profile.equipment[slot];
  if (!item) return { title: `${SLOT_LABEL[slot]}  空き`, sub: "", aside: null };
  const origin: ResonanceOrigin = { kind: "relic", id: item.id, slot };
  return { title: `${SLOT_LABEL[slot]}  ${item.name}`, sub: removalLine(origin, removalDeltas(state, origin)), aside: null };
}

function actTag(state: Readonly<GameState>, action: BoonAction): MenuTag {
  const names = gracesOf(state, action).map((k) => BOONS[k].name);
  return { title: `${BOON_ACTION_LABEL[action]}  加護 ${names.length > 0 ? names.join(KEYWORD_JOIN) : "空き"}`, sub: "", aside: null };
}

function lineageTag(state: Readonly<GameState>, lineage: LineageKey): MenuTag {
  const owned = state.boons.filter((k) => BOONS[k].lineage === lineage || (BOONS[k].fusion?.includes(lineage) ?? false));
  return {
    title: `${LINEAGE_LABEL[lineage]}  ${pips(owned.length, BOON.apexMinCards)}  真髄まで`,
    sub: owned.map((k) => BOONS[k].name).join(KEYWORD_JOIN),
    aside: null,
  };
}

function daiTag(state: Readonly<GameState>, focus: FocusId | null): MenuTag | null {
  const dai = fidArgs(focus, "dai");
  if (dai === null) return null;
  const [kind, arg] = dai;
  if (kind === "part" && isLootSlot(arg)) return partTag(state, arg);
  if (kind === "act" && isAction(arg)) return actTag(state, arg);
  if (kind === "lineage" && isLineage(arg)) return lineageTag(state, arg);
  const core = kind === "core" ? ownedCoreKey(state) : null;
  if (core !== null) return { title: `${BOONS[core].name}  芯`, sub: BOONS[core].desc, aside: null };
  return null;
}

const VERB_NAME: Readonly<Record<KeywordVerb, string>> = { produces: "源", consumes: "糧", amplifies: "強め" };

function slotTag(state: Readonly<GameState>, focus: FocusId | null): MenuTag | null {
  const bead = fidArgs(focus, "bead", 3);
  if (bead !== null) {
    const origin = beadOrigin(state, bead[2] ?? "");
    if (origin === null) return null;
    const card = originCard(state, origin);
    return { title: `${card.name}  ${card.sub}`, sub: removalLine(origin, removalDeltas(state, origin)), aside: null };
  }
  const more = fidArgs(focus, "more");
  if (more !== null && isKeyword(more[0]) && isVerb(more[1])) {
    return { title: `${keywordName(more[0])}  ${VERB_NAME[more[1]]}の出どころ  ほか`, sub: "系統の頁で全部を見る", aside: null };
  }
  const plus = fidArgs(focus, "plus");
  if (plus !== null && isKeyword(plus[0]) && isVerb(plus[1])) {
    return { title: `${keywordName(plus[0])} に${VERB_NAME[plus[1]]}を足す`, sub: "倉庫から候補を引く", aside: null };
  }
  return null;
}

function crestTag(state: Readonly<GameState>, view: Readonly<CrestView>): MenuTag {
  const focus = view.focus;
  const band = fidArgs(focus, "band")?.[0];
  if (isKeyword(band)) return keywordTag(state, band);
  if (focus === fid.board) return { title: "系統を選ぶ", sub: "紋に描けない系統を開く", aside: null };
  return slotTag(state, focus) ?? daiTag(state, focus) ?? { ...EMPTY_TAG };
}

function crestSheetFor(state: Readonly<GameState>, view: Readonly<CrestView>): SheetSubject | null {
  const dai = fidArgs(view.focus, "dai");
  if (dai?.[0] === "lineage" && isLineage(dai[1])) return { kind: "lineage", lineage: dai[1] };
  if (dai?.[0] === "core") {
    const core = ownedCoreKey(state);
    return core === null ? null : { kind: "boon", key: core };
  }
  const origin = focusOrigin(state, view.focus);
  return origin === null ? null : sheetOfOrigin(state, origin);
}

/** 操作案内: 珠・身は「跳ぶ」、書付のある物は書付も案内する */
function crestGuide(state: Readonly<GameState>, view: Readonly<CrestView>): readonly GuideVerb[] {
  const focus = view.focus;
  const jumps = fidArgs(focus, "bead", 3) !== null || fidArgs(focus, "dai")?.[0] === "part";
  const sheet = crestSheetFor(state, view) !== null;
  return sheet ? ["move", jumps ? "jump" : "open", "sheet", "face", "back"] : ["move", jumps ? "jump" : "open", "face", "back"];
}

export const CREST_VIEW: ViewModule<CrestView> = {
  layout: (state, ui) => {
    const shape = crestShape(state);
    return [...rowHits(ui, shape), ...daiHits(state, shape)];
  },
  act: () => undefined,
  header: (state) => ({ crumbs: bodyTitle(state), right: floorLabel(state) }),
  tag: (state, _ui, view) => crestTag(state, view),
  guide: crestGuide,
  sheetFor: crestSheetFor,
  back: () => false,
  edge: () => false,
  leave: () => undefined,
};
