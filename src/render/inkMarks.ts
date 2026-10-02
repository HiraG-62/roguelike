import { TELEGRAPH } from "../data/tuning";
import { INK_DOTS, INK_LAYER, type InkSurface, rgbOf } from "./inkSurface";

/**
 * 墨の予告の小さな印（朱の点・頭上の ○ / ●・折れ線の曲がり角）を、作業面のドットで硬い縁に置く（docs/ideas/ink-telegraph-impl.md 5 章）。
 * 形は 1 度だけ作った型紙（ドットのずれと色の並び）を写すだけ。印の層は線より上で、同じ層は後から置いた物が勝つ
 */

/** 型紙の 1 ドット: ずれ x, y と色・不透明度 */
interface Stencil {
  dx: Int16Array;
  dy: Int16Array;
  rgb: Uint32Array;
  alpha: Float32Array;
}

/** 印の層の中の段（全部同じ。後から置いた物が上） */
const MARK_LEVEL = 4;
/** 朱の点の円の判定の足し（ドット²。小さな円の輪郭を丸く見せる。scripts の shuDot と同じ） */
const DISC_PAD = 0.5;
/** 照りの 1 ドットの位置（半径に対する左上への割合） */
const SHINE_OFFSET = 0.4;
/** ○ の外の暗い縁の不透明度（明るい床で薄墨の輪が沈まないように） */
const READY_EDGE_ALPHA = 0.55;
/** ● の胡粉の縁の太さ（ドット）と朱の芯の半径（外径の半分に対する割合） */
const COMMIT_RIM = 1.5;
const COMMIT_SHU = 0.34;
/** 折れ線の曲がり角の点の一辺（論理 px） */
const CORNER_PX = 2;

const SHU = rgbOf(TELEGRAPH.shuColor);
const SHU_LIGHT = rgbOf(TELEGRAPH.shuLightColor);
const SUMI = rgbOf(TELEGRAPH.sumiColor);
const GOFUN = rgbOf(TELEGRAPH.gofunColor);
const USUZUMI_LIGHT = rgbOf(TELEGRAPH.usuzumiLightColor);

function stencilOf(cells: { dx: number; dy: number; rgb: number; alpha: number }[]): Stencil {
  return {
    dx: Int16Array.from(cells.map((c) => c.dx)),
    dy: Int16Array.from(cells.map((c) => c.dy)),
    rgb: Uint32Array.from(cells.map((c) => c.rgb)),
    alpha: Float32Array.from(cells.map((c) => c.alpha)),
  };
}

/** 朱の点の型紙（中心のドットから。半径 r ドット）: 朱の円 + 左上に照りの 1 ドット */
function shuStencil(r: number): Stencil {
  const cells: { dx: number; dy: number; rgb: number; alpha: number }[] = [];
  const reach = Math.ceil(r);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > r * r + DISC_PAD) continue;
      cells.push({ dx, dy, rgb: SHU, alpha: 1 });
    }
  }
  cells.push({ dx: -Math.round(r * SHINE_OFFSET), dy: -Math.round(r * SHINE_OFFSET), rgb: SHU_LIGHT, alpha: 1 });
  return stencilOf(cells);
}

/** 頭上の印の型紙（外径 headMarkSize。中心はドットの角）。ink = ●（胡粉の縁・濃墨の玉・朱の芯と照り）、sketch = ○（薄墨の輪 + 外の暗い縁） */
function headStencil(kind: "ink" | "sketch"): Stencil {
  const r = (TELEGRAPH.headMarkSize * INK_DOTS) / 2;
  const reach = Math.ceil(r) + 1;
  const cells: { dx: number; dy: number; rgb: number; alpha: number }[] = [];
  for (let dy = -reach; dy < reach; dy++) {
    for (let dx = -reach; dx < reach; dx++) {
      const d = Math.hypot(dx + 0.5, dy + 0.5);
      if (kind === "ink") {
        if (d > r) continue;
        const rgb = d <= r * COMMIT_SHU ? SHU : d <= r - COMMIT_RIM ? SUMI : GOFUN;
        cells.push({ dx, dy, rgb, alpha: 1 });
        continue;
      }
      if (d > r + 1 || d <= r - 1) continue;
      cells.push(d > r ? { dx, dy, rgb: SUMI, alpha: READY_EDGE_ALPHA } : { dx, dy, rgb: USUZUMI_LIGHT, alpha: 1 });
    }
  }
  if (kind === "ink") cells.push({ dx: -1, dy: -1, rgb: SHU_LIGHT, alpha: 1 });
  return stencilOf(cells);
}

const stencils = new Map<string, Stencil>();

function cached(key: string, make: () => Stencil): Stencil {
  const hit = stencils.get(key);
  if (hit) return hit;
  const s = make();
  stencils.set(key, s);
  return s;
}

/** 型紙を作業面のドット (x, y) に写す。alpha は不透明度の倍率（薄れていく線と同じ） */
function stamp(surf: InkSurface, st: Stencil, x: number, y: number, alpha: number): void {
  const n = st.dx.length;
  for (let i = 0; i < n; i++) {
    surf.put(x + (st.dx[i] ?? 0), y + (st.dy[i] ?? 0), INK_LAYER.mark, MARK_LEVEL, st.rgb[i] ?? 0, (st.alpha[i] ?? 1) * alpha);
  }
}

/** 朱の点（作業面のドット座標。半径 r ドット）。入りの墨溜まり・線の先端 */
export function shuDot(surf: InkSurface, x: number, y: number, r: number, alpha = 1): void {
  const st = cached(`shu|${r.toFixed(2)}`, () => shuStencil(r));
  stamp(surf, st, Math.round(x), Math.round(y), alpha);
}

/** 頭上の印（ワールド座標の中心）: 下絵 = 薄墨の ○、墨入れ = 濃墨の玉に朱の芯の ● */
export function headMark(surf: InkSurface, wx: number, wy: number, stage: "sketch" | "ink"): void {
  const st = cached(`head|${stage}`, () => headStencil(stage));
  stamp(surf, st, Math.round(surf.dotX(wx)), Math.round(surf.dotY(wy)), 1);
}

/** 折れ線の曲がり角の点（ワールド座標の中心）: 墨入れ = 朱、下絵 = 薄墨の明るい色の四角 */
export function cornerMark(surf: InkSurface, wx: number, wy: number, stage: "sketch" | "ink"): void {
  const size = CORNER_PX * INK_DOTS;
  const x0 = Math.round(surf.dotX(wx) - size / 2);
  const y0 = Math.round(surf.dotY(wy) - size / 2);
  const rgb = stage === "ink" ? SHU : USUZUMI_LIGHT;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) surf.put(x0 + x, y0 + y, INK_LAYER.mark, MARK_LEVEL, rgb, 1);
}
