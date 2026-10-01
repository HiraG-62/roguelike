// 地図のチャンクのキャッシュ（docs/ideas/map-visual-impl.md 1-3 節）。
// 16x16 マスのチャンクを mapBake の焼き付けで画素列にし、canvas にして毎フレーム blit する。
// 描画側だけで完結する（state には印を足さない）。時間ではなく「行の予算」で区切るので実時間に依存しない。
// 乱数は使わない（焼き付けは地図とテーマだけで決まる）。
import { type GameMap, TILE_SIZE, Tile } from "../map/grid";
import { buildVertexDepth, type VertexDepth } from "./dualGrid";
import { createChunkBake } from "./mapBake";
import { buildDecorExclude } from "./mapDecor";
import {
  BAKE_ROWS_BOOST,
  BAKE_ROWS_PER_FRAME,
  CHUNK_CACHE_MAX,
  CHUNK_DOTS,
  CHUNK_TILES,
  type BakeOutput,
  type ChunkBakeJob,
  type MapLight,
  type MapPalette,
  type MapTheme,
} from "./mapTypes";

/** チャンクの一辺（論理 px） */
export const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
/** 画面の外へ先読みする幅（論理 px）。歩きの速さで 1 秒ぶん */
export const CHUNK_PREFETCH_PX = 128;
/** 作り直しの判定に使う、チャンクの周りのマス数（岩盤の闇の閾値 2 マス・側面の高さに合わせる） */
export const CHECKSUM_MARGIN = 2;

/** 論理座標の画面。x / y は左上のワールド座標 */
export interface MapView {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChunkPlanEntry {
  key: number;
  cx: number;
  cy: number;
  /** 先読みを除いた画面に掛かるか */
  inView: boolean;
  /** 画面の中心からチャンクの中心までの距離の 2 乗 */
  dist2: number;
}

/** チャンク座標を 1 つの数にする（地図の幅は 1024 マス未満） */
export function chunkKey(cx: number, cy: number): number {
  return cy * 1024 + cx;
}

/** 壁 0 / 穴 1 / 通れる 2。階段・泉は「通れる」のままなので作り直さない */
export function tileClass(tile: number): 0 | 1 | 2 {
  if (tile === Tile.Wall) return 0;
  if (tile === Tile.Pit) return 1;
  return 2;
}

/** チャンク + 周り margin マスの分類の簡易ハッシュ（FNV-1a）。地図の外は壁 */
export function chunkChecksum(map: GameMap, cx: number, cy: number, margin: number = CHECKSUM_MARGIN): number {
  const x0 = cx * CHUNK_TILES - margin;
  const y0 = cy * CHUNK_TILES - margin;
  const x1 = (cx + 1) * CHUNK_TILES + margin;
  const y1 = (cy + 1) * CHUNK_TILES + margin;
  let h = 2166136261;
  for (let y = y0; y < y1; y++) {
    const inRow = y >= 0 && y < map.height;
    for (let x = x0; x < x1; x++) {
      const tile = inRow && x >= 0 && x < map.width ? (map.tiles[y * map.width + x] ?? Tile.Wall) : Tile.Wall;
      h = Math.imul(h ^ tileClass(tile), 16777619);
    }
  }
  return h >>> 0;
}

/** 欲しいチャンク（画面 + 周り margin px）。画面内を先に、画面の中心に近い順 */
export function chunkPlan(view: MapView, mapW: number, mapH: number, margin: number = CHUNK_PREFETCH_PX): ChunkPlanEntry[] {
  const maxCx = Math.ceil(mapW / CHUNK_TILES) - 1;
  const maxCy = Math.ceil(mapH / CHUNK_TILES) - 1;
  const cx0 = Math.max(0, Math.floor((view.x - margin) / CHUNK_PX));
  const cy0 = Math.max(0, Math.floor((view.y - margin) / CHUNK_PX));
  const cx1 = Math.min(maxCx, Math.ceil((view.x + view.w + margin) / CHUNK_PX) - 1);
  const cy1 = Math.min(maxCy, Math.ceil((view.y + view.h + margin) / CHUNK_PX) - 1);
  const mx = view.x + view.w / 2;
  const my = view.y + view.h / 2;
  const out: ChunkPlanEntry[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const left = cx * CHUNK_PX;
      const top = cy * CHUNK_PX;
      const inView = left < view.x + view.w && left + CHUNK_PX > view.x && top < view.y + view.h && top + CHUNK_PX > view.y;
      const dx = left + CHUNK_PX / 2 - mx;
      const dy = top + CHUNK_PX / 2 - my;
      out.push({ key: chunkKey(cx, cy), cx, cy, inView, dist2: dx * dx + dy * dy });
    }
  }
  out.sort((a, b) => Number(b.inView) - Number(a.inView) || a.dist2 - b.dist2 || a.key - b.key);
  return out;
}

/** チャンクのうち画面に掛かるマスの範囲（平塗りの対象。最大 16x16 = 256 マス）。掛からなければ null */
export function flatTileRange(
  cx: number,
  cy: number,
  view: MapView,
  mapW: number,
  mapH: number,
): { tx0: number; ty0: number; tx1: number; ty1: number } | null {
  const tx0 = Math.max(cx * CHUNK_TILES, Math.floor(view.x / TILE_SIZE), 0);
  const ty0 = Math.max(cy * CHUNK_TILES, Math.floor(view.y / TILE_SIZE), 0);
  const tx1 = Math.min((cx + 1) * CHUNK_TILES - 1, Math.ceil((view.x + view.w) / TILE_SIZE) - 1, mapW - 1);
  const ty1 = Math.min((cy + 1) * CHUNK_TILES - 1, Math.ceil((view.y + view.h) / TILE_SIZE) - 1, mapH - 1);
  if (tx1 < tx0 || ty1 < ty0) return null;
  return { tx0, ty0, tx1, ty1 };
}

/** 上限を超えたぶんを、最後に使った順に古いほうから捨てる対象にする。今のフレームで使ったものは捨てない */
export function lruVictims(entries: readonly { key: number; lastUsed: number }[], max: number, currentFrame: number): number[] {
  const over = entries.length - max;
  if (over <= 0) return [];
  return entries
    .filter((e) => e.lastUsed < currentFrame)
    .sort((a, b) => a.lastUsed - b.lastUsed || a.key - b.key)
    .slice(0, over)
    .map((e) => e.key);
}

/** 1 フレームの焼きの予算（ドット行）。黒帯中で画面内に未焼きがあるときだけ BOOST 倍 */
export function bakeBudget(wipe: boolean, inViewUnbaked: boolean): number {
  return BAKE_ROWS_PER_FRAME * (wipe && inViewUnbaked ? BAKE_ROWS_BOOST : 1);
}

/** 画素列から canvas を作る（既定）。テストでは差し替える */
export type ChunkImageFactory = (pixels: Uint32Array) => HTMLCanvasElement;

function canvasFromPixels(pixels: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CHUNK_DOTS;
  canvas.height = CHUNK_DOTS;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D context unavailable");
  // ABGR の 32bit をそのまま ImageData の RGBA バイト列として写す（リトルエンディアン）
  const image = new ImageData(CHUNK_DOTS, CHUNK_DOTS);
  new Uint32Array(image.data.buffer).set(pixels);
  g.putImageData(image, 0, 0);
  return canvas;
}

interface Chunk {
  key: number;
  cx: number;
  cy: number;
  /** 焼き始めた時点の分類のハッシュ */
  sum: number;
  job: ChunkBakeJob | null;
  rowsDone: number;
  ground: HTMLCanvasElement | null;
  lip: HTMLCanvasElement | null;
  lights: readonly MapLight[];
  lastUsed: number;
}

interface FlatColors {
  floor: string;
  wall: string;
  pit: string;
}

function css(c: number): string {
  return `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;
}

function flatColorsOf(palette: MapPalette): FlatColors {
  return { floor: css(palette.fB), wall: css(palette.tB), pit: css(palette.vD) };
}

function hasPixels(pixels: Uint32Array): boolean {
  for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) return true;
  return false;
}

export class MapChunkCache {
  private readonly chunks = new Map<number, Chunk>();
  private map: GameMap | null = null;
  private themeKey = "";
  /** 頂点の距離（地図ごとに 1 回作って全チャンクで共有する。分類が変わったら作り直す） */
  private depth: VertexDepth | null = null;
  /** 置物を置かないマスの印（地図ごとに 1 回。焼きへ渡す） */
  private exclude: Uint8Array | null = null;
  private flat: FlatColors | null = null;
  private frame = 0;
  private rowsThisFrame = 0;
  private plan: ChunkPlanEntry[] = [];
  private readonly lightBuf: MapLight[] = [];

  constructor(private readonly makeImage: ChunkImageFactory = canvasFromPixels) {}

  /** 持っているチャンクの数（焼き中を含む） */
  get size(): number {
    return this.chunks.size;
  }

  /** 焼き上がっているチャンクの数 */
  get bakedCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.ground) n++;
    return n;
  }

  /** 直近の update / settle で焼いたドット行（開発用の計測に使う） */
  get lastBakedRows(): number {
    return this.rowsThisFrame;
  }

  /** 画面内で焼き上がっていないチャンクがあるか */
  hasUnbakedInView(): boolean {
    return this.plan.some((e) => e.inView && !this.chunks.get(e.key)?.ground);
  }

  /** 全部捨てる（地図かテーマが変わったとき） */
  clear(): void {
    this.chunks.clear();
    this.plan = [];
    this.lightBuf.length = 0;
  }

  /**
   * 毎フレーム 1 回、描く前に呼ぶ。地図の差し替えを検出し、分類が変わったチャンクを直し、
   * 予算の行数だけ未焼きを焼く。wipe = 階の切り替えの黒帯中
   */
  update(map: GameMap, theme: MapTheme, view: MapView, wipe: boolean): void {
    this.bind(map, theme);
    this.frame++;
    this.rowsThisFrame = 0;
    this.plan = chunkPlan(view, map.width, map.height);
    for (const entry of this.plan) this.refresh(map, theme, entry);
    this.bakeWithin(map, theme, bakeBudget(wipe, this.hasUnbakedInView()));
    this.evict();
  }

  /** 欲しいチャンクを全部、予算なしで焼き上げる（撮影・ベンチの前。ゲーム中は使わない） */
  settle(map: GameMap, theme: MapTheme, view: MapView): void {
    this.bind(map, theme);
    this.frame++;
    this.rowsThisFrame = 0;
    this.plan = chunkPlan(view, map.width, map.height);
    for (const entry of this.plan) this.refresh(map, theme, entry);
    this.bakeWithin(map, theme, Number.POSITIVE_INFINITY);
    this.evict();
  }

  /** 焼いた床・壁・穴を描く。未焼きの範囲はマスごとの平塗り。ctx はワールド座標（カメラの平行移動済み） */
  drawGround(ctx: CanvasRenderingContext2D, view: MapView): void {
    const { map, flat } = this;
    if (!map || !flat) return;
    for (const entry of chunkPlan(view, map.width, map.height, 0)) {
      const chunk = this.chunks.get(entry.key);
      if (chunk?.ground) {
        ctx.drawImage(chunk.ground, entry.cx * CHUNK_PX, entry.cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
        continue;
      }
      this.fillFlat(ctx, map, flat, entry, view);
    }
  }

  /** 手前の縁の層（南の壁の手前）。体の後に描く（段 3 で結線） */
  drawLip(ctx: CanvasRenderingContext2D, view: MapView): void {
    const { map } = this;
    if (!map) return;
    for (const entry of chunkPlan(view, map.width, map.height, 0)) {
      const lip = this.chunks.get(entry.key)?.lip;
      if (lip) ctx.drawImage(lip, entry.cx * CHUNK_PX, entry.cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
    }
  }

  /** 画面に掛かる光源（焼いたチャンクが返した置物など）。返す配列は次の呼び出しまで有効 */
  lightsIn(view: MapView): readonly MapLight[] {
    const out = this.lightBuf;
    out.length = 0;
    for (const chunk of this.chunks.values()) {
      for (const l of chunk.lights) {
        if (l.x + l.r < view.x || l.x - l.r > view.x + view.w || l.y + l.r < view.y || l.y - l.r > view.y + view.h) continue;
        out.push(l);
      }
    }
    return out;
  }

  private bind(map: GameMap, theme: MapTheme): void {
    if (this.map === map && this.themeKey === theme.key) return;
    this.clear();
    this.map = map;
    this.themeKey = theme.key;
    this.depth = buildVertexDepth(map);
    this.exclude = buildDecorExclude(map);
    this.flat = flatColorsOf(theme.palette);
  }

  /** 焼いた時と分類が違うチャンクを直す。画面内は同期で焼き直し、画面外は捨てて予算で焼き直す */
  private refresh(map: GameMap, theme: MapTheme, entry: ChunkPlanEntry): void {
    const chunk = this.chunks.get(entry.key);
    if (!chunk) return;
    chunk.lastUsed = this.frame;
    if (chunk.sum === chunkChecksum(map, entry.cx, entry.cy)) return;
    this.chunks.delete(entry.key);
    // 隠し部屋が開くなど分類が変わったら、頂点の距離と置物の除外の印も作り直す（まれな出来事）
    this.depth = buildVertexDepth(map);
    this.exclude = buildDecorExclude(map);
    if (!entry.inView) return;
    const fresh = this.begin(map, theme, entry);
    this.advance(fresh, Number.POSITIVE_INFINITY);
  }

  private begin(map: GameMap, theme: MapTheme, entry: ChunkPlanEntry): Chunk {
    const chunk: Chunk = {
      key: entry.key,
      cx: entry.cx,
      cy: entry.cy,
      sum: chunkChecksum(map, entry.cx, entry.cy),
      job: createChunkBake({
        map,
        cx: entry.cx,
        cy: entry.cy,
        theme,
        ...(this.depth ? { depth: this.depth } : {}),
        ...(this.exclude ? { exclude: this.exclude } : {}),
      }),
      rowsDone: 0,
      ground: null,
      lip: null,
      lights: [],
      lastUsed: this.frame,
    };
    this.chunks.set(entry.key, chunk);
    return chunk;
  }

  /** 予算（ドット行）を使い切るまで、計画の順に未焼きを焼く */
  private bakeWithin(map: GameMap, theme: MapTheme, budget: number): void {
    let rows = budget;
    for (const entry of this.plan) {
      if (rows <= 0) return;
      const existing = this.chunks.get(entry.key);
      if (existing?.ground) continue;
      const chunk = existing ?? this.begin(map, theme, entry);
      rows -= this.advance(chunk, rows);
    }
  }

  /** 最大 rows 行だけ焼いて、使った行数を返す。焼き上がったら canvas にして画素列を手放す */
  private advance(chunk: Chunk, rows: number): number {
    const job = chunk.job;
    if (!job) return 0;
    // 焼きの 1 単位（塗り 1 行・準備 8 行）はチャンクの行数と一致しないので、予算が尽きるか焼き上がるまで進める
    let used = 0;
    while (!job.done && used < rows) {
      const n = Math.min(rows - used, CHUNK_DOTS);
      job.step(n);
      used += n;
    }
    chunk.rowsDone += used;
    this.rowsThisFrame += used;
    if (!job.done) return used;
    this.finish(chunk, job.result());
    return used;
  }

  private finish(chunk: Chunk, out: BakeOutput): void {
    chunk.ground = this.makeImage(out.ground);
    chunk.lip = hasPixels(out.lip) ? this.makeImage(out.lip) : null;
    chunk.lights = out.lights;
    chunk.job = null;
  }

  private evict(): void {
    if (this.chunks.size <= CHUNK_CACHE_MAX) return;
    for (const key of lruVictims([...this.chunks.values()], CHUNK_CACHE_MAX, this.frame)) this.chunks.delete(key);
  }

  /** 未焼きの範囲をマスごとの平塗りで埋める（黒い穴を出さない） */
  private fillFlat(ctx: CanvasRenderingContext2D, map: GameMap, flat: FlatColors, entry: ChunkPlanEntry, view: MapView): void {
    const range = flatTileRange(entry.cx, entry.cy, view, map.width, map.height);
    if (!range) return;
    let current = "";
    for (let ty = range.ty0; ty <= range.ty1; ty++) {
      for (let tx = range.tx0; tx <= range.tx1; tx++) {
        const cls = tileClass(map.tiles[ty * map.width + tx] ?? Tile.Wall);
        const color = cls === 0 ? flat.wall : cls === 1 ? flat.pit : flat.floor;
        if (color !== current) {
          ctx.fillStyle = color;
          current = color;
        }
        ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
