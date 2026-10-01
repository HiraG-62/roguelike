import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の系統の頁（1 系統の源 / 糧 / 強めの札）と、系統を選ぶ盤（docs/ideas/inventory-v2/E-impl.md 4-3 E4）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const FLOW_VIEW: ViewModule<ViewOf<"flow">> = stubView();
export const FLOW_BOARD_VIEW: ViewModule<ViewOf<"flowBoard">> = stubView();
