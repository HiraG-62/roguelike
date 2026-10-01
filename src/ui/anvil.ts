import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面の金床の構え（拠点の鍛冶場で開く装束。部位 → 装備中の物とその部位の倉庫 → 操作）。装束の頁（ATTIRE_VIEW）が anvil を持つ間ここへ任せる（docs/ideas/inventory-v2/E-impl.md 4-3 E7）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const ANVIL_VIEW: ViewModule<ViewOf<"attire">> = stubView();
