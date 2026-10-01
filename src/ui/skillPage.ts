import { type ViewModule, type ViewOf, stubView } from "./menuState";

/**
 * 装備画面のスキルの頁（石 4 列と符の穴。符を持ち上げて置く）（docs/ideas/inventory-v2/E-impl.md 4-3 E5）。
 * 段 2 では空実装（当たり無し・荷札と見出しは空・操作は何もしない）。積まれても戻るで外れる
 */
export const SKILLS_VIEW: ViewModule<ViewOf<"skills">> = stubView();
