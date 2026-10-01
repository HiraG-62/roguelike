import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の紋の面（帯 = 系統、珠 = 出どころ、下の台）（docs/ideas/inventory-v2/E-impl.md 4-3 E4）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const CREST_VIEW: ViewModule<ViewOf<"crest">> = stubView();
