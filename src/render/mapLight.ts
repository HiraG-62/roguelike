// 地図の光と暗がり（docs/ideas/map-visual-impl.md 1-8 節）。
// 地図（床・壁・穴・地形）だけを章ごとの暗さで覆い、光源の周りを段つきの円で抜く。
// drawTerrainLayer の直後に描くので、その後に描く予告・弾・敵・自分・拾い物は暗くならない（描き順で守る）。
// 暗闇の階の DarknessLayer（darkness.ts）はこれとは別に従来どおり上から掛ける。
// state は読むだけ。state.rng は使わない（光のゆらぎは state.time の sin）。
import type { GameState } from "../core/state";
import { terrainCode } from "../core/terrain";
import { VIEW_H, VIEW_W } from "../core/view";
import { MAP_LIGHT } from "../data/tuning";
import { TILE_SIZE, Tile, toIndex } from "../map/grid";
import { isDeepDepth } from "../system/chapters";
import { MAP_DOTS, type MapLight, type MapStyle, type MapTheme } from "./mapTypes";

// ---------------------------------------------------------------------------
// 章の暗さ
// ---------------------------------------------------------------------------

/** 章 1〜4 を chapterDark の添字にしたもの（章 3 の炎 / 霜は同じ暗さ） */
const CHAPTER_DARK_INDEX: Readonly<Record<Exclude<MapStyle, "final" | "deep">, number>> = {
  moss: 0,
  temple: 1,
  castleFire: 2,
  castleFrost: 2,
};
const LAST_CHAPTER_DARK_INDEX = 3;

/**
 * 様式と深度から地図の暗さ（黒の不透明度）を決める。
 * 様式 deep は章 4（16〜20 階）と深み（22 階〜）の両方なので、深度で chapterDark の末尾か deepDark かを分ける
 */
export function mapDarkFor(style: MapStyle, depth: number): number {
  if (style === "final") return MAP_LIGHT.finalDark;
  if (style === "deep") return isDeepDepth(depth) ? MAP_LIGHT.deepDark : (MAP_LIGHT.chapterDark[LAST_CHAPTER_DARK_INDEX] ?? MAP_LIGHT.deepDark);
  return MAP_LIGHT.chapterDark[CHAPTER_DARK_INDEX[style]] ?? 0;
}

// ---------------------------------------------------------------------------
// 光の段（見本 applyLight と同じ 4 段: 0.12 / 0.38 / 0.7 の閾値 → 抜く量 1/3・2/3・1）
// ---------------------------------------------------------------------------

export const LIGHT_STEPS = [
  { threshold: 0.12, level: 1 / 3 },
  { threshold: 0.38, level: 2 / 3 },
  { threshold: 0.7, level: 1 },
] as const;
/** 縦に 1.15 倍の距離として数える（見本の dy * 1.15。楕円は縦が 1/1.15 に潰れる） */
export const LIGHT_Y_STRETCH = 1.15;
/** 強さを作り置きの鍵にまとめる刻み（ゆらぎで作り置きが増え続けない） */
const STRENGTH_STEP = 0.05;
/** 作り置きの上限。超えたら全部捨てて作り直す（半径と強さの組は実際には数十） */
const STAMP_CACHE_MAX = 192;
const BYTE_MAX = 255;
/** プレイヤーの光の色（暖色の中立。章の光の色にするとプレイヤーの周りだけ色が付く） */
const PLAYER_LIGHT_COLOR = "#ffe8c0";
const LAVA_LIGHT_COLOR = "#ff6a20";
const FIRE_LIGHT_COLOR = "#ff9a40";
const STAIRS_LIGHT_COLOR = "#a8d8ff";
const SPRING_LIGHT_COLOR = "#60c0ff";
/** 炎のゆらぎ（強さに足す振れ幅・速さ・マスごとの位相のずらし） */
const FIRE_FLICKER_AMOUNT = 0.08;
const FIRE_FLICKER_SPEED = 12;
const FIRE_PHASE_X = 7;
const FIRE_PHASE_Y = 13;
/** 溶岩・穴の光を置く間隔（市松。x + y が偶数のマスだけ） */
const LAVA_STRIDE = 2;
const TILE_HALF = TILE_SIZE / 2;

/** 光の 1 段の大きさ（半径に対する比）。強さが閾値以下の段は 0（抜けない） */
export function stepRadiusRatios(strength: number): number[] {
  return LIGHT_STEPS.map((s) => (strength > s.threshold ? Math.sqrt(1 - s.threshold / strength) : 0));
}

export interface StampPixels {
  width: number;
  height: number;
  /** RGBA。色は一定で、段ごとの量は alpha に持つ */
  data: Uint8ClampedArray;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const RGB_CACHE = new Map<string, Rgb>();

/** "#rrggbb" を分ける。読めなければ黒。毎フレーム光源ごとに呼ぶので結果を覚える */
export function parseHexColor(color: string): Rgb {
  const cached = RGB_CACHE.get(color);
  if (cached) return cached;
  const n = /^#[0-9a-fA-F]{6}$/.test(color) ? parseInt(color.slice(1), 16) : 0;
  const rgb: Rgb = { r: (n >> 16) & BYTE_MAX, g: (n >> 8) & BYTE_MAX, b: n & BYTE_MAX };
  RGB_CACHE.set(color, rgb);
  return rgb;
}

/**
 * 段つきの円の画素。半径 radiusDots（ドット）・強さ strength。
 * 見本と同じ式（強さ × (1 - 距離² / 半径²)）を段に丸め、ディザは使わない。alpha = 段の量 × alphaScale
 */
export function buildStampPixels(radiusDots: number, strength: number, color: Rgb, alphaScale: number): StampPixels {
  const cx = Math.ceil(radiusDots);
  const cy = Math.ceil(radiusDots / LIGHT_Y_STRETCH);
  const width = cx * 2 + 1;
  const height = cy * 2 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  const r2 = radiusDots * radiusDots;
  for (let y = 0; y < height; y++) {
    const dy = (y - cy) * LIGHT_Y_STRETCH;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const v = (1 - d2 / r2) * strength;
      let level = 0;
      for (const step of LIGHT_STEPS) if (v >= step.threshold) level = step.level;
      if (level === 0) continue;
      const o = (y * width + x) * 4;
      data[o] = color.r;
      data[o + 1] = color.g;
      data[o + 2] = color.b;
      data[o + 3] = Math.round(level * alphaScale * BYTE_MAX);
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// 光源
// ---------------------------------------------------------------------------

/** 画面の矩形（ワールド座標の左上と大きさ。論理 px） */
export interface LightView {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LAVA = terrainCode("lava");
const FIRE = terrainCode("fire");

/** 光の円が画面に掛かるか */
function touchesView(l: MapLight, view: LightView): boolean {
  return l.x + l.r >= view.x && l.x - l.r <= view.x + view.w && l.y + l.r >= view.y && l.y - l.r <= view.y + view.h;
}

function tileLight(x: number, y: number, r: number, strength: number, color: string): MapLight {
  return { x: x * TILE_SIZE + TILE_HALF, y: y * TILE_SIZE + TILE_HALF, r, strength, color };
}

/** マスを走る範囲（最大の光の半径だけ画面の外まで見る）。地図の外へは出ない */
function scanBounds(state: GameState, view: LightView): { x0: number; y0: number; x1: number; y1: number } {
  const reach = Math.max(MAP_LIGHT.lavaLightRadius, MAP_LIGHT.fireLightRadius, MAP_LIGHT.stairsLightRadius, MAP_LIGHT.springLightRadius);
  const { map } = state;
  return {
    x0: Math.max(0, Math.floor((view.x - reach) / TILE_SIZE)),
    y0: Math.max(0, Math.floor((view.y - reach) / TILE_SIZE)),
    x1: Math.min(map.width - 1, Math.ceil((view.x + view.w + reach) / TILE_SIZE)),
    y1: Math.min(map.height - 1, Math.ceil((view.y + view.h + reach) / TILE_SIZE)),
  };
}

/** 地図のマスから出る光（溶岩の地形と穴・炎・階段・泉）を out へ足す */
function pushTileLights(out: MapLight[], state: GameState, view: LightView, theme: MapTheme): void {
  const { map } = state;
  const layer = state.terrain.map === map ? state.terrain : null;
  const lavaPit = theme.pit === "lava";
  const { x0, y0, x1, y1 } = scanBounds(state, view);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = toIndex(map, x, y);
      const tile = map.tiles[i];
      const code = layer ? (layer.kinds[i] ?? 0) : 0;
      const lava = code === LAVA || (lavaPit && tile === Tile.Pit);
      if (lava && (x + y) % LAVA_STRIDE === 0) {
        out.push(tileLight(x, y, MAP_LIGHT.lavaLightRadius, MAP_LIGHT.lavaLightStrength, LAVA_LIGHT_COLOR));
      } else if (code === FIRE) {
        const flicker = Math.sin(state.time * FIRE_FLICKER_SPEED + x * FIRE_PHASE_X + y * FIRE_PHASE_Y) * FIRE_FLICKER_AMOUNT;
        out.push(tileLight(x, y, MAP_LIGHT.fireLightRadius, MAP_LIGHT.fireLightStrength + flicker, FIRE_LIGHT_COLOR));
      } else if (tile === Tile.StairsDown) {
        out.push(tileLight(x, y, MAP_LIGHT.stairsLightRadius, MAP_LIGHT.stairsLightStrength, STAIRS_LIGHT_COLOR));
      } else if (tile === Tile.Fountain) {
        out.push(tileLight(x, y, MAP_LIGHT.springLightRadius, MAP_LIGHT.springLightStrength, SPRING_LIGHT_COLOR));
      }
    }
  }
}

/**
 * この画面で抜く光源。プレイヤー・焼いたチャンクの光・溶岩の地形と穴（2 マスおき）・炎・階段・泉のうち、
 * 画面に掛かるものを、プレイヤーに近い順に maxLights まで（先頭はいつもプレイヤー）。純関数
 */
export function mapLights(state: GameState, view: LightView, theme: MapTheme, chunkLights: readonly MapLight[]): MapLight[] {
  const p = state.player.body.pos;
  const player: MapLight = { x: p.x, y: p.y, r: MAP_LIGHT.playerLightRadius, strength: MAP_LIGHT.playerLightStrength, color: PLAYER_LIGHT_COLOR };
  const others: MapLight[] = [];
  for (const l of chunkLights) if (touchesView(l, view)) others.push(l);
  const tiles: MapLight[] = [];
  pushTileLights(tiles, state, view, theme);
  for (const l of tiles) if (touchesView(l, view)) others.push(l);
  const dist2 = (l: MapLight): number => (l.x - p.x) ** 2 + (l.y - p.y) ** 2;
  if (others.length > MAP_LIGHT.maxLights - 1) {
    others.sort((a, b) => dist2(a) - dist2(b));
    others.length = Math.max(0, MAP_LIGHT.maxLights - 1);
  }
  return [player, ...others];
}

// ---------------------------------------------------------------------------
// 光の層
// ---------------------------------------------------------------------------

/** drawLitRects の作業用 canvas（ドット）と、1 枚の断片の最大（作業用 canvas に必ず 1 枚は入る） */
const LIT_W = 512;
const LIT_H = 256;
const LIT_PIECE_W = 256;
const LIT_PIECE_H = 128;

/** 作業用 canvas に詰めた断片: 画面のドット位置（sx, sy）・大きさ・作業用 canvas の置き場所（wx, wy） */
interface PlacedDots {
  sx: number;
  sy: number;
  w: number;
  h: number;
  wx: number;
  wy: number;
}

/** ドット座標を 0..max に収める */
function clampDot(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

export type LightCanvasFactory = (width: number, height: number) => HTMLCanvasElement;

function domCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return ctx;
}

/**
 * 色の円を重ねる合成。見本は掛け算なので、見え方が合わなければ "overlay" などへ替えて比べる
 * （soft-light は GPU の無い描画では画面全体に掛けると重いので、光源の円の範囲だけに掛ける）
 */
const TINT_BLEND: GlobalCompositeOperation = "soft-light";
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * 地図を暗くする層（960x540 = 密度 2）。毎フレーム `rgba(0,0,0,dark)` を塗り、光源ごとの段つきの円を
 * destination-out で抜いて world へ 1 回で描く。光の色は同じ形の色つきの円（alpha = lightTint × 段）を
 * world へ soft-light で重ねる。円は半径と強さで作り置きする（毎フレームの画素計算はしない）
 */
export class MapLightLayer {
  private readonly dark: HTMLCanvasElement;
  private readonly darkCtx: CanvasRenderingContext2D;
  /** drawLitRects の作業用 canvas（初めて使うときに作る。拠点は使わない） */
  private lit: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  private readonly stamps = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly makeCanvas: LightCanvasFactory = domCanvas,
    width: number = VIEW_W * MAP_DOTS,
    height: number = VIEW_H * MAP_DOTS,
  ) {
    this.dark = makeCanvas(width, height);
    this.darkCtx = context2d(this.dark);
  }

  /** 作り置きの数（テスト用） */
  stampCount(): number {
    return this.stamps.size;
  }

  /** ctx はワールド座標（カメラの平行移動済み）。view はワールド座標の画面 */
  draw(ctx: CanvasRenderingContext2D, view: LightView, lights: readonly MapLight[], dark: number): void {
    this.paintDark(view, lights, dark);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.dark, view.x, view.y, view.w, view.h);
    ctx.globalCompositeOperation = TINT_BLEND;
    for (const l of lights) this.drawTint(ctx, view, l);
    ctx.restore();
  }

  /**
   * paint が描いたもの（手前の縁など）を、直前の draw と同じ暗さで world へ描く。rects（ワールド座標）の中だけ。
   * 小さな作業用 canvas（LIT_W x LIT_H ドット。画面全体ではない）へ矩形を詰めて paint を密度 2 で描き、
   * 光の層の暗がりを source-atop で重ね、その範囲だけ world へ描く。draw と同じフレームの同じ view で呼ぶこと
   * （暗がりは draw が作ったものをそのまま使う）。paint の ctx はワールド座標で、第 2 引数はドットの格子に切り揃えた
   * 描く範囲（paint はこの範囲の外を描かなくてよい）。rects は互いに重ならないこと（重なると暗がりが 2 回掛かる。
   * frontLip.ts の lipRects が束ねる）。canvas を元にした描画は元が変わるたびに画素の複写が走るので、
   * 「全部描く → 全部暗がり → 全部 world へ」の 3 段にして複写を抑え、作業用 canvas も小さくして複写を軽くする
   */
  drawLitRects(ctx: CanvasRenderingContext2D, view: LightView, rects: readonly LightView[], paint: (g: CanvasRenderingContext2D, area: LightView) => void): void {
    if (rects.length === 0) return;
    const lit = this.litLayer();
    const placed: PlacedDots[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let shelfH = 0;
    const flush = (): void => {
      if (placed.length === 0) return;
      this.compositeLit(ctx, view, lit, placed, paint);
      placed.length = 0;
      cursorX = 0;
      cursorY = 0;
      shelfH = 0;
    };
    for (const r of rects) {
      const x0 = clampDot(Math.floor((r.x - view.x) * MAP_DOTS), this.dark.width);
      const y0 = clampDot(Math.floor((r.y - view.y) * MAP_DOTS), this.dark.height);
      const x1 = clampDot(Math.ceil((r.x + r.w - view.x) * MAP_DOTS), this.dark.width);
      const y1 = clampDot(Math.ceil((r.y + r.h - view.y) * MAP_DOTS), this.dark.height);
      // 作業用 canvas に収まらない大きな矩形は、LIT_PIECE_W x LIT_PIECE_H の断片に割る（断片は互いに重ならない）
      for (let sy = y0; sy < y1; sy += LIT_PIECE_H) {
        for (let sx = x0; sx < x1; sx += LIT_PIECE_W) {
          const w = Math.min(LIT_PIECE_W, x1 - sx);
          const h = Math.min(LIT_PIECE_H, y1 - sy);
          if (cursorX + w > LIT_W) {
            cursorX = 0;
            cursorY += shelfH;
            shelfH = 0;
          }
          if (cursorY + h > LIT_H) {
            flush();
          }
          placed.push({ sx, sy, w, h, wx: cursorX, wy: cursorY });
          cursorX += w;
          shelfH = Math.max(shelfH, h);
        }
      }
    }
    flush();
  }

  private compositeLit(
    ctx: CanvasRenderingContext2D,
    view: LightView,
    lit: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
    placed: readonly PlacedDots[],
    paint: (g: CanvasRenderingContext2D, area: LightView) => void,
  ): void {
    const { ctx: g, canvas } = lit;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    for (const d of placed) g.clearRect(d.wx, d.wy, d.w, d.h);
    g.imageSmoothingEnabled = false;
    for (const d of placed) {
      // ワールド → 作業用 canvas のドット: (world - view) * 密度 + (作業用の置き場所 - 画面のドット位置)
      g.setTransform(MAP_DOTS, 0, 0, MAP_DOTS, -view.x * MAP_DOTS + d.wx - d.sx, -view.y * MAP_DOTS + d.wy - d.sy);
      paint(g, { x: view.x + d.sx / MAP_DOTS, y: view.y + d.sy / MAP_DOTS, w: d.w / MAP_DOTS, h: d.h / MAP_DOTS });
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    for (const d of placed) g.drawImage(this.dark, d.sx, d.sy, d.w, d.h, d.wx, d.wy, d.w, d.h);
    g.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const d of placed) ctx.drawImage(canvas, d.wx, d.wy, d.w, d.h, view.x + d.sx / MAP_DOTS, view.y + d.sy / MAP_DOTS, d.w / MAP_DOTS, d.h / MAP_DOTS);
    ctx.restore();
  }

  private litLayer(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (this.lit) return this.lit;
    const canvas = this.makeCanvas(LIT_W, LIT_H);
    this.lit = { canvas, ctx: context2d(canvas) };
    return this.lit;
  }

  private paintDark(view: LightView, lights: readonly MapLight[], dark: number): void {
    const { darkCtx: g, dark: canvas } = this;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = `rgba(0,0,0,${dark})`;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = "destination-out";
    for (const l of lights) {
      const spot = this.spotOf(view, l, BLACK, 1);
      if (spot) g.drawImage(spot.stamp, spot.dotX, spot.dotY);
    }
    g.globalCompositeOperation = "source-over";
  }

  /** 光の色の円を world の座標（論理 px）で重ねる。密度 2 の円なので幅と高さは半分で描く */
  private drawTint(ctx: CanvasRenderingContext2D, view: LightView, l: MapLight): void {
    const spot = this.spotOf(view, l, parseHexColor(l.color), MAP_LIGHT.lightTint);
    if (!spot) return;
    ctx.drawImage(spot.stamp, view.x + spot.dotX / MAP_DOTS, view.y + spot.dotY / MAP_DOTS, spot.stamp.width / MAP_DOTS, spot.stamp.height / MAP_DOTS);
  }

  /** 光の円の作り置きと、画面の左上を原点にした密度 2 の左上座標。抜ける段が無い光は null */
  private spotOf(view: LightView, l: MapLight, color: Rgb, alphaScale: number): { stamp: HTMLCanvasElement; dotX: number; dotY: number } | null {
    const radius = Math.round(l.r * MAP_DOTS);
    const strength = Math.round(l.strength / STRENGTH_STEP) * STRENGTH_STEP;
    if (radius <= 0 || strength <= LIGHT_STEPS[0].threshold) return null;
    const stamp = this.stampFor(radius, strength, color, alphaScale);
    const cx = Math.ceil(radius);
    const cy = Math.ceil(radius / LIGHT_Y_STRETCH);
    return { stamp, dotX: Math.round((l.x - view.x) * MAP_DOTS) - cx, dotY: Math.round((l.y - view.y) * MAP_DOTS) - cy };
  }

  private stampFor(radius: number, strength: number, color: Rgb, alphaScale: number): HTMLCanvasElement {
    const key = `${radius}|${strength.toFixed(2)}|${color.r},${color.g},${color.b}|${alphaScale}`;
    const cached = this.stamps.get(key);
    if (cached) return cached;
    if (this.stamps.size >= STAMP_CACHE_MAX) this.stamps.clear();
    const pixels = buildStampPixels(radius, strength, color, alphaScale);
    const canvas = this.makeCanvas(pixels.width, pixels.height);
    const g = context2d(canvas);
    const image = g.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    g.putImageData(image, 0, 0);
    this.stamps.set(key, canvas);
    return canvas;
  }
}
