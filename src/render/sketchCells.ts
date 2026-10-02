import { TELEGRAPH } from "../data/tuning";
import { hash01 } from "./renderMath";

/** 線に沿った区間（根元からの距離 px） */
export interface Span {
  from: number;
  to: number;
}

/** 欠けを 0.05 刻みに丸める（キャッシュの鍵。見た目の差は出ない） */
const GAP_QUANT = 20;
const SPAN_CACHE_MAX = 512;
const spanCache = new Map<string, readonly Span[]>();

/**
 * 下絵の描く区間。長さを sketchCell 刻みのセルに割り、hash01(id, i) が欠けの割合を下回るセルを描かない。
 * 閾を上げると欠けるセルが増えるだけで減らない（削れが戻って見えない）。根元と先端のセルは必ず描く（向きと届きを見せる）。
 * 端数は最後のセルに足し、セルは sketchCell 未満にならない。返す配列は共有なので変更しない
 */
export function sketchSpans(id: number, length: number, gap: number): readonly Span[] {
  const q = Math.round(Math.max(0, Math.min(1, gap)) * GAP_QUANT);
  const key = `${id}:${Math.round(length)}:${q}`;
  const hit = spanCache.get(key);
  if (hit) return hit;
  const spans = buildSpans(id, length, q / GAP_QUANT);
  if (spanCache.size >= SPAN_CACHE_MAX) spanCache.clear();
  spanCache.set(key, spans);
  return spans;
}

/** セルの長さのばらつき（sketchCell の 1〜2 倍）。同じ長さの塊が並ぶと規則的な破線に見えるので、セルごとに変える */
const CELL_JITTER = 1;

function buildSpans(id: number, length: number, gap: number): Span[] {
  const cell = TELEGRAPH.sketchCell;
  if (!(length > 0)) return [];
  const bounds = cellBounds(id, length, cell);
  const spans: Span[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i] ?? 0;
    const to = bounds[i + 1] ?? length;
    const edge = i === 0 || i === bounds.length - 2;
    if (!edge && hash01(id * 131 + 7, i * 17 + 3) < gap) continue;
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.to - from) < 1e-6) last.to = to;
    else spans.push({ from, to });
  }
  return spans;
}

/** セルの境の距離の列（0 から length まで）。端数は最後のセルに足し、どのセルも cell 未満にならない */
function cellBounds(id: number, length: number, cell: number): number[] {
  const bounds = [0];
  let at = 0;
  for (let i = 0; ; i++) {
    const next = at + cell * (1 + CELL_JITTER * hash01(id * 977 + 13, i));
    // 残りがもう 1 セル取れなければ、残りを最後のセルにする
    if (length - next < cell) break;
    bounds.push(next);
    at = next;
  }
  bounds.push(length);
  return bounds;
}

