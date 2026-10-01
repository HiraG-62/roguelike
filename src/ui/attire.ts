import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { JOBS } from "../data/jobs";
import { ATTR, RESONANCE } from "../data/tuning";
import { ATTR_LABEL, COMBAT_ATTR_KEYS, type Item } from "../loot/types";
import { SKILL, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { currentForm } from "../system/morale";
import { relicKeywords } from "../system/keywords";
import { ANVIL_VIEW } from "./anvil";
import { type CrestRow, crestShape, miniCrestRows } from "./crestShape";
import { slotHasUnseen } from "./seen";
import { SLOT_LABEL } from "./inventoryLayout";
import { candidatesFor } from "./menuActions";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type GuideVerb,
  type InventoryUi,
  type LootSlot,
  type MenuHeader,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";

/**
 * 装束（装備画面の体の面。docs/ideas/inventory-v2/E-merged.md 6 章 W1、E-impl.md 4-3 E2）。
 * 人影の周りの 6 部位・腰のスキル石 4・右の紋の写しから選ぶ。座標は見本 E.html と同じ 480x270 の論理座標。
 * 金床の構え（鍛冶場から開いた間）は ANVIL_VIEW に任せる
 */

type AttireView = ViewOf<"attire">;

/** 部位の枠の寸法 */
export const PART_TILE = 26;

/** 部位 6 の枠（W1 の座標）。並びは方向の移動の先頭（右手から） */
export const ATTIRE_PART_RECTS: Readonly<Record<LootSlot, Rect>> = {
  mainHand: { x: 40, y: 62, w: PART_TILE, h: PART_TILE },
  head: { x: 117, y: 18, w: PART_TILE, h: PART_TILE },
  armor: { x: 40, y: 112, w: PART_TILE, h: PART_TILE },
  boots: { x: 117, y: 136, w: PART_TILE, h: PART_TILE },
  ring: { x: 194, y: 88, w: PART_TILE, h: PART_TILE },
  amulet: { x: 194, y: 40, w: PART_TILE, h: PART_TILE },
};

export const ATTIRE_SLOTS = Object.keys(ATTIRE_PART_RECTS) as LootSlot[];

/** 人影（10 × 14 の絵を 5 倍）の置き場と、その当たり */
export const FIGURE_POS = { x: 105, y: 50, scale: 5 } as const;
export const FIGURE_RECT: Rect = { x: 103, y: 50, w: 54, h: 72 };

/** 腰のスキル石（菱形 16px）の左上 */
export const STONE_GEM_Y = 180;
const STONE_X0 = 56;
const STONE_GAP = 40;
export function stoneGemX(i: number): number {
  return STONE_X0 + i * STONE_GAP;
}

/** 腰の石 i の当たり（菱形と下の符の鉤を含む） */
export function stoneRect(i: number): Rect {
  return { x: stoneGemX(i) - 4, y: STONE_GEM_Y - 3, w: 24, h: 32 };
}

/** 右の紋の写し（帯 104px・珠 8px。名前は出さない） */
export const MINI_CREST_RECT: Rect = { x: 262, y: 22, w: 208, h: 164 };

/** 当たりは枠より 1px 広く取る（枠の線の上でも拾う） */
function partHitRect(slot: LootSlot): Rect {
  const r = ATTIRE_PART_RECTS[slot];
  return { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
}

function plainHits(state: Readonly<GameState>, ui: Readonly<InventoryUi>): MenuHit[] {
  const hits: MenuHit[] = ATTIRE_SLOTS.map((slot) => ({
    id: fid.part(slot),
    rect: partHitRect(slot),
    act: { kind: "push", view: candidatesFor(ui, slot) },
    hold: null,
    nav: true,
  }));
  hits.push({ id: fid.body, rect: FIGURE_RECT, act: { kind: "push", view: sheetOf({ kind: "body" }) }, hold: null, nav: true });
  for (let i = 0; i < SKILL.slots; i++) {
    hits.push({ id: fid.stone(i), rect: stoneRect(i), act: { kind: "push", view: { kind: "skills", focus: fid.stone(i), lift: null } }, hold: null, nav: true });
  }
  for (const mini of miniCrestRows(crestShape(state), MINI_CREST_RECT)) {
    const keyword = mini.row.keyword;
    hits.push({ id: fid.mini(keyword), rect: mini.rect, act: { kind: "push", view: { kind: "flow", focus: null, keyword } }, hold: null, nav: true });
  }
  return hits;
}

function sheetOf(subject: SheetSubject): ViewOf<"sheet"> {
  return { kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null };
}

function isLootSlot(v: string | undefined): v is LootSlot {
  return v !== undefined && (ATTIRE_SLOTS as readonly string[]).includes(v);
}

/** 焦点の部位（部位でなければ null） */
export function focusedPart(focus: string | null): LootSlot | null {
  const slot = fidArgs(focus, "part")?.[0];
  return isLootSlot(slot) ? slot : null;
}

/** 焦点の腰の石の枠（石でなければ null） */
export function focusedStone(focus: string | null): number | null {
  const i = fidArgs(focus, "stone")?.[0];
  if (i === undefined) return null;
  const n = Number(i);
  return Number.isInteger(n) && n >= 0 && n < SKILL.slots ? n : null;
}

/** 部位の角の印: 金 = 名のある遺物 / 緑 = 芽 / 白い点 = 倉庫に新着 */
export interface PartMarks {
  named: boolean;
  bud: boolean;
  unseen: boolean;
}

export function partMarks(state: Readonly<GameState>, slot: LootSlot): PartMarks {
  const item = state.profile.equipment[slot] ?? null;
  return {
    named: item?.namedKey !== undefined,
    bud: (item?.budOffer ?? null) !== null,
    unseen: slotHasUnseen(state.profile, slot),
  };
}

const KEYWORD_SEP = "・";

function keywordNames(list: readonly Keyword[]): string {
  return list.map((k) => `${KEYWORD_DEFS[k].label}系`).join(KEYWORD_SEP);
}

/** 部位の荷札の 2 行目「源 燃焼系　糧 瀕死系　強め 燃焼系」（無い側は書かない） */
function relicFlowLine(item: Readonly<Item>): string {
  const p = relicKeywords(item);
  const parts: string[] = [];
  if (p.produces.length > 0) parts.push(`源 ${keywordNames(p.produces)}`);
  if (p.consumes.length > 0) parts.push(`糧 ${keywordNames(p.consumes)}`);
  if (p.amplifies.length > 0) parts.push(`強め ${keywordNames(p.amplifies)}`);
  return parts.join("　");
}

/** 芽を持つ遺物の荷札の印 */
const BUD_TAG = "  芽";
const EMPTY_PART = "空き";

function partTag(state: Readonly<GameState>, slot: LootSlot): MenuTag {
  const item = state.profile.equipment[slot];
  if (!item) return { title: `${SLOT_LABEL[slot]}  ${EMPTY_PART}`, sub: "", aside: null };
  const bud = item.budOffer ? BUD_TAG : "";
  return { title: `${SLOT_LABEL[slot]}  ${item.name}${bud}`, sub: relicFlowLine(item), aside: null };
}

function stoneTag(state: Readonly<GameState>, i: number): MenuTag {
  const stone = stoneInSlot(state.skills.profile, i);
  const head = `スキル ${i + 1}`;
  if (!stone) return { title: `${head}  ${EMPTY_PART}`, sub: "", aside: null };
  const def = SKILL_DEFS[stone.skillKey];
  return { title: `${head}  ${def.name}`, sub: def.verb, aside: null };
}

/** 人影の荷札のステータスの目盛りの数（数字は出さず、書付だけに出す） */
const ATTR_TICKS = 3;
const TICK_ON = "■";
const TICK_OFF = "□";

/** 目盛り: 逓減の始まり（ATTR.knee1）で満ちる */
export function attributeTicks(value: number): number {
  return Math.max(0, Math.min(ATTR_TICKS, Math.round((value / ATTR.knee1) * ATTR_TICKS)));
}

/** 「剣士・連刃の型」 */
export function bodyTitle(state: Readonly<GameState>): string {
  return `${JOBS[state.job].name}・${currentForm(state).name}の型`;
}

function bodyTag(state: Readonly<GameState>): MenuTag {
  const ticks = COMBAT_ATTR_KEYS.map((k) => {
    const n = attributeTicks(state.stats.attributes[k]);
    return `${ATTR_LABEL[k].slice(0, 1)} ${TICK_ON.repeat(n)}${TICK_OFF.repeat(ATTR_TICKS - n)}`;
  });
  return { title: bodyTitle(state), sub: ticks.join("　"), aside: null };
}

const STEP_ON = "●";
const STEP_OFF = "○";
const UNDERCURRENT_LABEL = "伏流";

function miniTag(row: Readonly<CrestRow>): MenuTag {
  const level = row.undercurrent ? UNDERCURRENT_LABEL : `${STEP_ON.repeat(row.step)}${STEP_OFF.repeat(Math.max(0, RESONANCE.maxSteps - row.step))}`;
  return { title: `${KEYWORD_DEFS[row.keyword].label}系  ${level}`, sub: "", aside: null };
}

function plainTag(state: Readonly<GameState>, view: Readonly<AttireView>): MenuTag {
  const part = focusedPart(view.focus);
  if (part !== null) return partTag(state, part);
  const stone = focusedStone(view.focus);
  if (stone !== null) return stoneTag(state, stone);
  if (view.focus === fid.body) return bodyTag(state);
  const mini = fidArgs(view.focus, "mini")?.[0];
  const row = mini === undefined ? undefined : crestShape(state).rows.find((r) => r.keyword === mini);
  if (row !== undefined) return miniTag(row);
  return { ...EMPTY_TAG };
}

const HUB_LABEL = "拠点";

/** 見出しの右: ラン中は階、拠点は「拠点」 */
export function floorLabel(state: Readonly<GameState>): string {
  return state.sandbox === true ? HUB_LABEL : `地下 ${state.depth} 階`;
}

function plainHeader(state: Readonly<GameState>): MenuHeader {
  return { crumbs: bodyTitle(state), right: floorLabel(state) };
}

const PLAIN_GUIDE: readonly GuideVerb[] = ["move", "open", "sheet", "face", "back"];

function plainSheetFor(state: Readonly<GameState>, view: Readonly<AttireView>): SheetSubject | null {
  const part = focusedPart(view.focus);
  if (part !== null) {
    const item = state.profile.equipment[part];
    return item ? { kind: "item", itemId: item.id } : null;
  }
  const i = focusedStone(view.focus);
  if (i !== null) {
    const stone = stoneInSlot(state.skills.profile, i);
    return stone ? { kind: "stone", stoneId: stone.id } : null;
  }
  return view.focus === fid.body ? { kind: "body" } : null;
}

export const ATTIRE_VIEW: ViewModule<AttireView> = {
  layout: (state, ui, view) => (view.anvil !== null ? ANVIL_VIEW.layout(state, ui, view) : plainHits(state, ui)),
  act: (state, ui, view, act) => {
    if (view.anvil !== null) ANVIL_VIEW.act(state, ui, view, act);
  },
  header: (state, ui, view) => (view.anvil !== null ? ANVIL_VIEW.header(state, ui, view) : plainHeader(state)),
  tag: (state, ui, view, focus) => (view.anvil !== null ? ANVIL_VIEW.tag(state, ui, view, focus) : plainTag(state, view)),
  guide: (state, view) => (view.anvil !== null ? ANVIL_VIEW.guide(state, view) : PLAIN_GUIDE),
  sheetFor: (state, view) => (view.anvil !== null ? ANVIL_VIEW.sheetFor(state, view) : plainSheetFor(state, view)),
  back: (state, ui, view) => (view.anvil !== null ? ANVIL_VIEW.back(state, ui, view) : false),
  edge: (state, ui, view, dx, dy) => (view.anvil !== null ? ANVIL_VIEW.edge(state, ui, view, dx, dy) : false),
  leave: (state, ui, view) => {
    if (view.anvil !== null) ANVIL_VIEW.leave(state, ui, view);
  },
};
