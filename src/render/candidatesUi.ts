import type { GameState } from "../core/state";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";

/**
 * 候補の頁の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E3）。段 2 では空実装（殻の見出し・荷札・操作案内だけが出る）
 */
export function drawCandidates(
  _ctx: CanvasRenderingContext2D,
  _state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  _view: Readonly<ViewOf<"candidates">>,
  _hits: readonly MenuHit[],
): void {
  // 段 3 で中身を入れる
}
