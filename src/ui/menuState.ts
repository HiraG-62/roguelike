import type { BoonAction } from "../core/build";
import type { Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import type { EchoOp } from "../loot/crafting";
import type { CraftSave } from "../loot/craftingStore";
import type { Slot } from "../loot/types";
import type { ModifierKey, SkillKey, SkillResource } from "../skills/types";
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
/** 候補の絞り込み（系統 = 物が関わる語 / 型 = スキル石の資源の型。null は絞らない） */
export interface CandidateFilter {
  keyword: Keyword | null;
  resource: SkillResource | null;
}
export type CandidateFilterAxis = keyof CandidateFilter;
/** 手持ちの符の並び（新 = 拾った順の新しい物から / 名 = 名前順 / 種 = 種類 → 名前の順） */
export type HandSort = "new" | "name" | "kind";
/** 手持ちの符の種類（変形 = shape / 循環 = cycle / 型替え = reshape）。null は絞らない */
export type RuneKind = "shape" | "cycle" | "reshape";
/** 手持ちの絞り込みと並び（符の頁の view が持つ。開き直しても保つ値は ui.handPref） */
export interface HandOptions {
  sort: HandSort;
  kind: RuneKind | null;
  keyword: Keyword | null;
  /** true なら今のスキルのどれかに付けられる符だけ */
  fitOnly: boolean;
}
export type HandOptionAxis = "sort" | "kind" | "keyword" | "fit";
export type CandidateTarget =
  | { kind: "slot"; slot: Slot }
  /** group = 同じスキルの石の束を開いた頁（docs/ideas/skill-stone-hunt.md。省略は束ねた一覧） */
  | { kind: "stone"; index: number; group?: SkillKey }
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
      /** 絞り込み（省略は絞らない） */
      filter?: CandidateFilter;
    }
  | { kind: "flow"; focus: FocusId | null; keyword: Keyword }
  | { kind: "flowBoard"; focus: FocusId | null }
  | {
      kind: "skills";
      focus: FocusId | null;
      /** 持ち上げ中の符。slot = HAND_SLOT（-1）なら手持ちから、0 以上ならそのスキルから */
      lift: { slot: number; key: ModifierKey } | null;
      /** 手持ちの絞り込みと並び（省略は既定） */
      hand?: HandOptions;
    }
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
  /** 候補の頁の左の部位のマスから、別の部位の候補の頁へ替える（装束の頁の焦点も合わせる） */
  | { kind: "switchPart"; slot: Slot }
  // 頁ごと（その頁の ViewModule.act が処理する）
  | { kind: "setSort"; sort: CandidateSort }
  | { kind: "cycleFilter"; axis: CandidateFilterAxis }
  /** 候補の頁の左下の腰の石から、別のスキル枠の候補の頁へ替える */
  | { kind: "switchStone"; index: number }
  | { kind: "cycleHand"; axis: HandOptionAxis }
  | { kind: "liftHand"; key: ModifierKey }
  | { kind: "equip"; itemId: string }
  | { kind: "equipStone"; stoneId: string; index: number }
  | { kind: "clearSlot" }
  | { kind: "salvageStone"; stoneId: string }
  /** 束の長押し: 宿り符の無い石をまとめて装着中の同じスキルの石へ注ぐ */
  | { kind: "pourGroup"; skillKey: SkillKey }
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
  | { kind: "forgeExecute" }
  // 拠点の装束の部位の長押し: 持ち込みの印の付け外し（loot/runGear.ts）
  | { kind: "toggleCarry"; slot: Slot };

/**
 * act = 決定で起きること / hold = 長押し 0.6 秒で起きること / nav = 方向の移動で止まるか（面の札は false）/
 * hover = マウスが通るだけで焦点を移すか（省略は true。false は「押したときだけ」で、通過で差を消したくない当たり）
 */
export interface MenuHit {
  id: FocusId;
  rect: Rect;
  act: MenuAct | null;
  hold: MenuAct | null;
  nav: boolean;
  hover?: boolean;
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
export type GuideVerb = "move" | "open" | "jump" | "equip" | "place" | "decide" | "hold" | "dispose" | "carry" | "sheet" | "sort" | "face" | "back" | "close" | "cancel";
/** main.ts が FrameInput の外から渡す（記録しない入力） */
export interface MenuSignals {
  back: boolean;
  confirmHeld: boolean;
}

export const NO_SIGNALS: Readonly<MenuSignals> = { back: false, confirmHeld: false };

/** 持ち上げ中の符の出どころが手持ちのときの slot の値 */
export const HAND_SLOT = -1;

/** 絞り込みなし */
export const NO_FILTER: Readonly<CandidateFilter> = { keyword: null, resource: null };

/** 手持ちの既定（新着順・絞らない） */
export function defaultHandOptions(): HandOptions {
  return { sort: "new", kind: null, keyword: null, fitOnly: false };
}

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
  /** 開き直しても保つ手持ちの絞り込みと並び */
  handPref: HandOptions;
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

/** 荷札の空の値（焦点が無いとき） */
export const EMPTY_TAG: Readonly<MenuTag> = { title: "", sub: "", aside: null };

/** 今いちばん上の頁（閉じていれば null） */
export function topView(ui: Readonly<InventoryUi>): MenuView | null {
  return ui.stack[ui.stack.length - 1] ?? null;
}

/** 1 段目の面（閉じていれば装束とみなす） */
export function rootFace(ui: Readonly<InventoryUi>): MenuFace {
  return ui.stack[0]?.kind === "crest" ? "crest" : "attire";
}
