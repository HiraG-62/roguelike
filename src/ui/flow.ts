import { KEYWORDS, type Keyword, type KeywordProfile, type KeywordVerb } from "../core/keywords";
import type { GameState } from "../core/state";
import { JOBS } from "../data/jobs";
import { REFORGES } from "../data/reforges";
import { FORMS } from "../data/weaponForms";
import { keystoneDef } from "../loot/affixes";
import { describeTrait } from "../loot/describe";
import { uniqueDef } from "../loot/named";
import type { Item } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { BOONS } from "../system/boonDefs";
import { relicKeywords } from "../system/keywords";
import { RESONANCE_EXCLUDED, type ResonanceOrigin, resonanceBySource } from "../system/resonance";
import { isBoonKey, isKeyword, isVerb, keywordName, keywordTag, findOriginItem, originCard, sheetOfOrigin } from "./crest";
import { BEAD_MAX, crestShape, sourceKey } from "./crestShape";
import { fid, fidArgs } from "./menuFocus";
import {
  EMPTY_TAG,
  type FocusId,
  type GuideVerb,
  type InventoryUi,
  type MenuHit,
  type MenuTag,
  type Rect,
  type SheetSubject,
  type ViewModule,
  type ViewOf,
} from "./menuState";

/**
 * 装備画面の系統の頁（1 系統の源・糧・強めの札。見本 E.html の ④ 系統を開く）と、系統を選ぶ盤（丸印だけの 8 × 5）。
 * 札で決定するとその物の置き場へ跳ぶ。足りない側の「＋」はその系統で絞った候補を開く（docs/ideas/inventory-v2/E-impl.md 4-3 E4）。
 * 座標は 480x270 の論理座標で、描画（render/flowUi.ts）と共有する
 */

type FlowView = ViewOf<"flow">;
type BoardView = ViewOf<"flowBoard">;

// -----------------------------------------------------------------------------
// 寸法
// -----------------------------------------------------------------------------

export const FLOW_LAYOUT = {
  /** 上の畳んだ帯（ほかの系統へ）。1 本の幅・丸印の中心 y・当たりの上端と高さ */
  foldX: 8,
  foldPitch: 44,
  foldDiscY: 25,
  foldHitY: 17,
  foldHitW: 34,
  foldHitH: 16,
  /** 「源」「糧」の見出しの y */
  captionY: 38,
  /** 源・糧の札（144 × 22、段の間隔 26）。糧は x 328 */
  cardW: 144,
  cardH: 22,
  cardY: 50,
  cardPitch: 26,
  sourceX: 8,
  sinkX: 328,
  /** 強めの札（128 × 20、間隔 24） */
  ampX: 176,
  ampY: 132,
  ampW: 128,
  ampH: 20,
  ampPitch: 24,
  /** 中央の丸印 */
  centerX: 240,
  centerY: 92,
  centerDisc: 40,
  bandHalf: 70,
  ruleY: 184,
} as const;

/** 系統を選ぶ盤の寸法（8 列。丸印の中心 = 格子の中心） */
export const BOARD_LAYOUT = {
  cols: 8,
  x: 8,
  y: 26,
  cellW: 58,
  cellH: 36,
  disc: 24,
  hitW: 50,
  hitH: 34,
} as const;

/** 札 1 枚。origin が null なら「＋」（足りない側を足す） */
export interface FlowCard {
  verb: KeywordVerb;
  rect: Rect;
  origin: ResonanceOrigin | null;
}

function cardRect(verb: KeywordVerb, i: number): Rect {
  const L = FLOW_LAYOUT;
  if (verb === "amplifies") return { x: L.ampX, y: L.ampY + i * L.ampPitch, w: L.ampW, h: L.ampH };
  return { x: verb === "produces" ? L.sourceX : L.sinkX, y: L.cardY + i * L.cardPitch, w: L.cardW, h: L.cardH };
}

/** その系統の札（源・糧は 4 枚まで、足りなければ最後に「＋」。強めは 2 枚まで） */
export function flowCards(state: Readonly<GameState>, keyword: Keyword): FlowCard[] {
  const r = resonanceBySource(state)[keyword];
  const out: FlowCard[] = [];
  for (const verb of ["produces", "consumes"] as const) {
    const shown = r[verb].slice(0, BEAD_MAX[verb]);
    shown.forEach((origin, i) => out.push({ verb, rect: cardRect(verb, i), origin }));
    if (shown.length < BEAD_MAX[verb]) out.push({ verb, rect: cardRect(verb, shown.length), origin: null });
  }
  r.amplifies.slice(0, BEAD_MAX.amplifies).forEach((origin, i) => out.push({ verb: "amplifies", rect: cardRect("amplifies", i), origin }));
  return out;
}

export function foldRect(i: number): Rect {
  const L = FLOW_LAYOUT;
  return { x: L.foldX + i * L.foldPitch, y: L.foldHitY, w: L.foldHitW, h: L.foldHitH };
}

/** 盤に並べる系統（数えない語を除いた 40） */
export const BOARD_KEYWORDS: readonly Keyword[] = KEYWORDS.filter((k) => !RESONANCE_EXCLUDED.includes(k));

/** 盤の格子 i の中心 */
export function boardCenter(i: number): { x: number; y: number } {
  const B = BOARD_LAYOUT;
  return { x: B.x + (i % B.cols) * B.cellW + B.cellW / 2, y: B.y + Math.floor(i / B.cols) * B.cellH + B.cellH / 2 };
}

// -----------------------------------------------------------------------------
// 札の中身（その系統に触れる行）
// -----------------------------------------------------------------------------

function touches(p: Readonly<KeywordProfile>, keyword: Keyword): boolean {
  return p.produces.includes(keyword) || p.consumes.includes(keyword) || p.amplifies.includes(keyword);
}

/** 遺物の性質のうち、その系統に触れる行（反転した性質は数えないので出さない）。名のある遺物の固有が触れるときはフレーバー */
function relicLines(item: Readonly<Item>, keyword: Keyword): string[] {
  const lines: string[] = [];
  for (const roll of item.affixes) {
    // 1 つの性質だけの遺物に見立てて、その性質の語を引く（名のある遺物の語は別に見る）
    if (touches(relicKeywords({ ...item, affixes: [roll], namedKey: undefined }), keyword)) lines.push(describeTrait(roll).text);
  }
  const named = item.namedKey === undefined ? undefined : uniqueDef(item.namedKey);
  if (named?.keywords !== undefined && touches(named.keywords, keyword) && named.flavor !== undefined) lines.push(named.flavor);
  return lines;
}

interface DescribedTable {
  readonly [key: string]: { readonly desc?: string; readonly description?: string; readonly verb?: string } | undefined;
}

function plainText(origin: Readonly<ResonanceOrigin>): string {
  switch (origin.kind) {
    case "stone":
      return (SKILL_DEFS as DescribedTable)[origin.id]?.verb ?? "";
    case "boon":
      return isBoonKey(origin.id) ? BOONS[origin.id].desc : "";
    case "job":
      return (JOBS as DescribedTable)[origin.id]?.desc ?? "";
    case "form":
      return (FORMS as DescribedTable)[origin.id]?.desc ?? "";
    case "reforge":
      return (REFORGES as DescribedTable)[origin.id]?.desc ?? "";
    case "keystone":
      return keystoneDef(origin.id)?.description ?? "";
    case "relic":
      return "";
  }
}

const LINE_JOIN = "　";

/** 荷札の 2 行目: 遺物ならその系統に触れる性質の行だけ、それ以外はその物の説明 */
export function originLines(state: Readonly<GameState>, origin: Readonly<ResonanceOrigin>, keyword: Keyword): string {
  if (origin.kind === "relic") {
    const item = findOriginItem(state, origin);
    return item === null ? "" : relicLines(item, keyword).join(LINE_JOIN);
  }
  return plainText(origin);
}

// -----------------------------------------------------------------------------
// 系統の頁
// -----------------------------------------------------------------------------

function candidatesOf(ui: Readonly<InventoryUi>, keyword: Keyword, verb: "produces" | "consumes"): ViewOf<"candidates"> {
  return { kind: "candidates", focus: null, target: { kind: "flow", keyword, verb }, sort: ui.sortPref, offset: 0, order: null, pinnedId: null };
}

function cardHit(ui: Readonly<InventoryUi>, keyword: Keyword, c: Readonly<FlowCard>): MenuHit {
  if (c.origin !== null) {
    return { id: fid.src(sourceKey(c.origin), c.verb), rect: c.rect, act: { kind: "jump", source: c.origin }, hold: null, nav: true };
  }
  const verb = c.verb === "consumes" ? "consumes" : "produces";
  return { id: fid.plus(keyword, c.verb), rect: c.rect, act: { kind: "push", view: candidatesOf(ui, keyword, verb) }, hold: null, nav: true };
}

function flowLayout(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<FlowView>): MenuHit[] {
  const hits = flowCards(state, view.keyword).map((c) => cardHit(ui, view.keyword, c));
  crestShape(state).rows.forEach((row, i) => {
    const next: FlowView = { kind: "flow", focus: null, keyword: row.keyword };
    hits.push({ id: fid.fold(row.keyword), rect: foldRect(i), act: { kind: "replace", view: next }, hold: null, nav: true });
  });
  return hits;
}

/** 焦点の札の出どころ（札の id → 出どころ。「＋」・畳んだ帯は null） */
function focusedCardOrigin(state: Readonly<GameState>, view: Readonly<FlowView>): ResonanceOrigin | null {
  const parts = fidArgs(view.focus, "src");
  if (parts === null || parts.length < 2) return null;
  const key = parts.slice(0, -1).join(":");
  const found = flowCards(state, view.keyword).find((c) => c.origin !== null && sourceKey(c.origin) === key);
  return found?.origin ?? null;
}

const VERB_NAME: Readonly<Record<KeywordVerb, string>> = { produces: "源", consumes: "糧", amplifies: "強め" };

function flowTag(state: Readonly<GameState>, view: Readonly<FlowView>): MenuTag {
  const origin = focusedCardOrigin(state, view);
  if (origin !== null) {
    const card = originCard(state, origin);
    return { title: `${card.name}  ${card.sub}`, sub: originLines(state, origin, view.keyword), aside: null };
  }
  const plus = fidArgs(view.focus, "plus");
  if (plus !== null && isKeyword(plus[0]) && isVerb(plus[1])) {
    return { title: `${keywordName(plus[0])} に${VERB_NAME[plus[1]]}を足す`, sub: "倉庫からこの系統の候補を引く", aside: null };
  }
  const fold = fidArgs(view.focus, "fold")?.[0];
  if (isKeyword(fold)) return { title: `${keywordName(fold)} を開く`, sub: "", aside: null };
  return { ...EMPTY_TAG };
}

const FLOW_GUIDE_SHEET: readonly GuideVerb[] = ["move", "jump", "sheet", "back"];
const FLOW_GUIDE_PLAIN: readonly GuideVerb[] = ["move", "open", "back"];

export const FLOW_VIEW: ViewModule<FlowView> = {
  layout: flowLayout,
  act: () => undefined,
  header: (_state, _ui, view) => ({ crumbs: keywordName(view.keyword), right: null }),
  tag: (state, _ui, view) => flowTag(state, view),
  guide: (state, view) => (sheetOfFocused(state, view) === null ? FLOW_GUIDE_PLAIN : FLOW_GUIDE_SHEET),
  sheetFor: (state, view) => sheetOfFocused(state, view),
  back: () => false,
  edge: () => false,
  leave: () => undefined,
};

function sheetOfFocused(state: Readonly<GameState>, view: Readonly<FlowView>): SheetSubject | null {
  const origin = focusedCardOrigin(state, view);
  return origin === null ? null : sheetOfOrigin(state, origin);
}

// -----------------------------------------------------------------------------
// 系統を選ぶ盤
// -----------------------------------------------------------------------------

function boardLayout(): MenuHit[] {
  const B = BOARD_LAYOUT;
  return BOARD_KEYWORDS.map((keyword, i) => {
    const c = boardCenter(i);
    const next: FlowView = { kind: "flow", focus: null, keyword };
    return {
      id: fid.kw(keyword),
      rect: { x: c.x - B.hitW / 2, y: c.y - B.hitH / 2, w: B.hitW, h: B.hitH },
      act: { kind: "replace", view: next },
      hold: null,
      nav: true,
    } satisfies MenuHit;
  });
}

function boardTag(state: Readonly<GameState>, focus: FocusId | null): MenuTag {
  const kw = fidArgs(focus, "kw")?.[0];
  return isKeyword(kw) ? keywordTag(state, kw) : { ...EMPTY_TAG };
}

const BOARD_CRUMBS = "系統を選ぶ";
const BOARD_GUIDE: readonly GuideVerb[] = ["move", "open", "back"];

export const FLOW_BOARD_VIEW: ViewModule<BoardView> = {
  layout: boardLayout,
  act: () => undefined,
  header: () => ({ crumbs: BOARD_CRUMBS, right: null }),
  tag: (state, _ui, view) => boardTag(state, view.focus),
  guide: () => BOARD_GUIDE,
  sheetFor: () => null,
  back: () => false,
  edge: () => false,
  leave: () => undefined,
};
