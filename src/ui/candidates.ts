import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の候補の頁（部位・石・系統で絞った倉庫の物を 5 枚ずつ並べて比べる）（docs/ideas/inventory-v2/E-impl.md 4-3 E3）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const CANDIDATES_VIEW: ViewModule<ViewOf<"candidates">> = stubView();
