import type { GameState } from "../core/state";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";

/**
 * 系統の頁と系統を選ぶ盤の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E4）。段 2 では空実装（殻の見出し・荷札・操作案内だけが出る）
 */
export function drawFlow(
  _ctx: CanvasRenderingContext2D,
  _state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  _view: Readonly<ViewOf<"flow">>,
  _hits: readonly MenuHit[],
): void {
  // 段 4 で中身を入れる
}

export function drawFlowBoard(
  _ctx: CanvasRenderingContext2D,
  _state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  _view: Readonly<ViewOf<"flowBoard">>,
  _hits: readonly MenuHit[],
): void {
  // 段 4 で中身を入れる
}
