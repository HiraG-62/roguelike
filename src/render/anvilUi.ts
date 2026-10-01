import type { GameState } from "../core/state";
import type { InventoryUi, MenuHit, ViewOf } from "../ui/menuState";

/**
 * 金床の構え（装束の頁が anvil を持つ間）の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E7）。段 2 では空実装（殻の見出し・荷札・操作案内だけが出る）
 */
export function drawAnvil(
  _ctx: CanvasRenderingContext2D,
  _state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  _view: Readonly<ViewOf<"attire">>,
  _hits: readonly MenuHit[],
): void {
  // 段 7 で中身を入れる
}
