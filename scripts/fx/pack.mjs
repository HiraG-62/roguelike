// 切り詰めたフレームを棚詰めで 1 枚に並べる（決定的。同じ入力なら同じ配置）

/** 棚の幅の上限（ブラウザの画像の上限より十分小さく、縦に伸びすぎない幅） */
const MAX_WIDTH = 2048;
/** フレームの間の余白（最近傍の拡大で隣のドットがにじまないように 1px 空ける） */
const GAP = 1;

/**
 * cells: {w, h}[] → { width, height, places: {x, y}[] }（cells と同じ順）。
 * 高い順に並べて棚に詰め、同じ高さは元の順を保つ
 */
export function shelfPack(cells) {
  const order = cells.map((c, i) => ({ ...c, i })).filter((c) => c.w > 0 && c.h > 0);
  order.sort((a, b) => b.h - a.h || a.i - b.i);
  const places = cells.map(() => ({ x: 0, y: 0 }));
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const c of order) {
    if (x > 0 && x + c.w > MAX_WIDTH) {
      y += shelf + GAP;
      x = 0;
      shelf = 0;
    }
    places[c.i] = { x, y };
    x += c.w + GAP;
    shelf = Math.max(shelf, c.h);
    width = Math.max(width, x - GAP);
  }
  return { width: Math.max(1, width), height: Math.max(1, y + shelf), places };
}
