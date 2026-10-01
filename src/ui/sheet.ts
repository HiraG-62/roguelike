import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の書付（1 品・見開き・体・祝福・系譜・刻印符の全文と数字。予算の外）（docs/ideas/inventory-v2/E-impl.md 4-3 E6）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const SHEET_VIEW: ViewModule<ViewOf<"sheet">> = stubView();
