import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の加護の頁（行動の加護・乗る遺物・注ぐ系統）（docs/ideas/inventory-v2/E-impl.md 4-3 E5）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const ACT_VIEW: ViewModule<ViewOf<"act">> = stubView();
