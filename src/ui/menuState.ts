import type { BoonAction } from "../core/build";
import type { Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import type { EchoOp } from "../loot/crafting";
import type { CraftSave } from "../loot/craftingStore";
import type { Slot } from "../loot/types";
import type { ModifierKey } from "../skills/types";
import type { BoonKey, LineageKey } from "../system/boonDefs";
import type { ResonanceOrigin } from "../system/resonance";
import type { Rect } from "./inventoryLayout";

/**
 * 装備画面（持ち物メニュー E「装束と紋」）の状態の型（docs/ideas/inventory-v2/E-impl.md 1-1）。
 * 画面は「頁の積み重ね（MenuView[]）+ 当たりの列（MenuHit[]）+ 頁ごとの部品（ViewModule）」で作る。
 * 後の段（候補・紋・スキル・書付・金床）は MenuAct を足さずにこの中で済ませる（共有ファイルの衝突を無くすため）
 */

export type { Rect };

/** 装備できる部位（左手は席取りで何も付けられないので除く。loot/types.ts の LOOT_SLOTS と同じ集合） */
export type LootSlot = Exclude<Slot, "offHand">;

export type MenuFace = "attire" | "crest";
/** 開く入口。Tab = attire / 鍛冶場 = anvil / 書庫 = skills / 庭 = bud */
export type MenuEntry = "attire" | "anvil" | "skills" | "bud";
/** 焦点の識別子。形式は menuFocus.ts の fid.* */
export type FocusId = string;
export type CandidateSort = "fit" | "new" | "name";
export type CandidateTarget =
  | { kind: "slot"; slot: Slot }
  | { kind: "stone"; index: number }
  | { kind: "flow"; keyword: Keyword; verb: "produces" | "consumes" };
export type ForgePick = { kind: "trait"; index: number } | { kind: "inscription" } | { kind: "bud"; index: number };
/** 鍛冶の手続き。subject = 選んだ物、partner = 捧げる側か受け手（E-impl 2-4 の役割表） */
export interface ForgeSession {
  subjectId: string;
  op: EchoOp | null;
  partnerId: string | null;
  pick: ForgePick | null;
}
export interface AnvilState {
  slot: Slot | null;
  forge: ForgeSession | null;
  offset: number;
}
export type SheetSubject =
  | { kind: "item"; itemId: string }
  | { kind: "pair"; itemId: string; slot: Slot }
  | { kind: "stone"; stoneId: string }
  | { kind: "stonePair"; stoneId: string; index: number }
  | { kind: "rune"; key: ModifierKey }
  | { kind: "body" }
  | { kind: "boon"; key: BoonKey }
  | { kind: "lineage"; lineage: LineageKey };
export type MenuView =
  | { kind: "attire"; focus: FocusId | null; anvil: AnvilState | null }
  | { kind: "crest"; focus: FocusId | null }
  | {
      kind: "candidates";
      focus: FocusId | null;
      target: CandidateTarget;
      sort: CandidateSort;
      offset: number;
      order: string[] | null;
      pinnedId: string | null;
    }
  | { kind: "flow"; focus: FocusId | null; keyword: Keyword }
  | { kind: "flowBoard"; focus: FocusId | null }
  | { kind: "skills"; focus: FocusId | null; lift: { slot: number; key: ModifierKey } | null }
  | { kind: "act"; focus: FocusId | null; action: BoonAction }
  | { kind: "sheet"; focus: FocusId | null; subject: SheetSubject; page: number; offset: number; forge: ForgeSession | null };
export type MenuViewKind = MenuView["kind"];
export type ViewOf<K extends MenuViewKind> = Extract<MenuView, { kind: K }>;

export type MenuAct =
  // 共通（inventory.ts / menuActions.ts が処理する）
  | { kind: "switchFace"; face: MenuFace }
  | { kind: "push"; view: MenuView }
  | { kind: "replace"; view: MenuView }
  | { kind: "jump"; source: ResonanceOrigin }
  | { kind: "focusPart"; slot: Slot }
  // 頁ごと（その頁の ViewModule.act が処理する）
  | { kind: "setSort"; sort: CandidateSort }
  | { kind: "equip"; itemId: string }
  | { kind: "equipStone"; stoneId: string; index: number }
  | { kind: "clearSlot" }
  | { kind: "salvageStone"; stoneId: string }
  | { kind: "chooseBud"; option: number }
  | { kind: "liftRune"; slot: number; key: ModifierKey }
  | { kind: "placeRune"; slot: number }
  | { kind: "removeRune"; slot: number; key: ModifierKey }
  | { kind: "setAction"; action: BoonAction }
  | { kind: "sheetPage"; page: number }
  | { kind: "chooseUltimate"; index: number }
  | { kind: "stepMoveset"; dir: -1 | 1 }
  | { kind: "anvilPage"; dir: -1 | 1 }
  | { kind: "anvilPart"; slot: Slot }
  | { kind: "forgeSubject"; itemId: string }
  | { kind: "forgeOp"; op: EchoOp }
  | { kind: "forgePartner"; itemId: string }
  | { kind: "forgePick"; pick: ForgePick }
  | { kind: "forgeExecute" };

/** act = 決定で起きること / hold = 長押し 0.6 秒で起きること / nav = 方向の移動で止まるか（面の札は false） */
export interface MenuHit {
  id: FocusId;
  rect: Rect;
  act: MenuAct | null;
  hold: MenuAct | null;
  nav: boolean;
}
/** 荷札 2 行。aside は 1 行目の右寄せ（地金 ▲▼・費用） */
export interface MenuTag {
  title: string;
  sub: string;
  aside: string | null;
}
export interface MenuHeader {
  crumbs: string;
  right: string | null;
}
export type GuideVerb = "move" | "open" | "jump" | "equip" | "place" | "decide" | "hold" | "sheet" | "sort" | "face" | "back" | "close" | "cancel";
/** main.ts が FrameInput の外から渡す（記録しない入力） */
export interface MenuSignals {
  back: boolean;
  confirmHeld: boolean;
}

export const NO_SIGNALS: Readonly<MenuSignals> = { back: false, confirmHeld: false };

export interface InventoryUi {
  open: boolean;
  /** [0] は装束か紋。閉じている間は空 */
  stack: MenuView[];
  /** 鍛冶場から開いた間は装束を金床の構えで作る */
  anvilSession: boolean;
  /** 旧 ui.echo.save（roguelike.craft.v1） */
  craft: CraftSave;
  /** 開き直しても保つ並び */
  sortPref: CandidateSort;
  nav: { x: number; y: number; held: number };
  aimPrev: Vec | null;
  clickHeldPrev: boolean;
  hold: { id: FocusId; t: number; by: "key" | "mouse" } | null;
  /** 開いている間の経過秒（state.time は止まっている） */
  time: number;
  /** 焦点が動いた ui.time（動く紋の 4 コマ） */
  focusAt: number;
  /** 荷札 2 行目の一時の知らせ */
  note: { text: string; t: number } | null;
}

export interface ViewModule<V extends MenuView> {
  layout(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>): MenuHit[];
  act(state: GameState, ui: InventoryUi, view: V, act: MenuAct): void;
  header(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>): MenuHeader;
  tag(state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<V>, focus: MenuHit | null): MenuTag;
  guide(state: Readonly<GameState>, view: Readonly<V>): readonly GuideVerb[];
  sheetFor(state: Readonly<GameState>, view: Readonly<V>): SheetSubject | null;
  /** 戻るを頁の中で使ったら true（持ち上げの取り消し・鍛冶の段戻し） */
  back(state: GameState, ui: InventoryUi, view: V): boolean;
  /** その向きに当たりが無いときの送り（候補・金床・書付の 5 枚送り）。使ったら true */
  edge(state: Readonly<GameState>, ui: InventoryUi, view: V, dx: number, dy: number): boolean;
  /** 積み重ねから外れるとき（候補の seenAt を進める） */
  leave(state: GameState, ui: InventoryUi, view: V): void;
}

/** 荷札・見出しの空の値（空実装の頁と、焦点が無いとき） */
export const EMPTY_TAG: Readonly<MenuTag> = { title: "", sub: "", aside: null };
export const EMPTY_HEADER: Readonly<MenuHeader> = { crumbs: "", right: null };

/** 空実装の頁の部品（後の段が中身を入れるまで、積まれても何もしない。戻るで外れる） */
export function stubView<V extends MenuView>(): ViewModule<V> {
  return {
    layout: () => [],
    act: () => undefined,
    header: () => ({ ...EMPTY_HEADER }),
    tag: () => ({ ...EMPTY_TAG }),
    guide: () => ["back"],
    sheetFor: () => null,
    back: () => false,
    edge: () => false,
    leave: () => undefined,
  };
}

/** 今いちばん上の頁（閉じていれば null） */
export function topView(ui: Readonly<InventoryUi>): MenuView | null {
  return ui.stack[ui.stack.length - 1] ?? null;
}

/** 1 段目の面（閉じていれば装束とみなす） */
export function rootFace(ui: Readonly<InventoryUi>): MenuFace {
  return ui.stack[0]?.kind === "crest" ? "crest" : "attire";
}
