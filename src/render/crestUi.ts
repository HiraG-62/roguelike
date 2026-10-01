import type { GameState } from "../core/state";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";

/**
 * 紋の面の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E4）。段 2 では空実装（殻の見出し・荷札・操作案内だけが出る）
 */
export function drawCrest(
  _ctx: CanvasRenderingContext2D,
  _state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  _view: Readonly<ViewOf<"crest">>,
  _hits: readonly MenuHit[],
): void {
  // 段 4 で中身を入れる
}
