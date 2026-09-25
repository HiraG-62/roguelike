/**
 * エフェクトのスプライト（docs/ideas/fx-sprites.md）。生成器（scripts/fx/）が焼いた PNG と一覧（data/fxSheets.gen.ts）を読み、
 * 段の番号を配色（data/fxRamps.json）で色へ写して描く。
 *
 * - 絵の 1 ドット = 論理 0.5px（FX_ART_SCALE）。canvas の実ピクセルは論理の pixelRatio 倍なので、ウィンドウが 960x540 以上なら崩れずに出る
 * - 方向は事前に描いてある（回さない）。反時計回りの振りは −θ の絵を上下反転して引く
 * - 配色はフレーム 1 枚ずつ、初めて描くときに作ってキャッシュする（アトラス全体を配色ごとに複製しない）
 * - 読み込み前・失敗時は ready が false のまま。呼び出し側は今までの手続きの描画にフォールバックする
 */
import { FX_ATLASES, FX_SHEETS, type FxAtlasKey, type FxSheetDef, type FxSheetKey } from "../data/fxSheets.gen";
import RAMPS from "../data/fxRamps.json";

/** 絵のドット / 論理 px */
export const FX_ART_SCALE = 2;
/** PNG に書いた段の灰色（段 × LEVEL_GRAY。scripts/fx/gen.mjs と同じ値） */
const LEVEL_GRAY = 32;
const LEVELS = 7;
const RECT_STRIDE = 6;

export type FxRampKey = Exclude<keyof typeof RAMPS, "_note">;

export const FX_RAMP_KEYS: readonly FxRampKey[] = ["steel", "fire", "ice", "lightning", "poison", "dark", "light"];

/** 配色の 7 段（暗 → 明） */
export function rampColors(key: FxRampKey): readonly string[] {
  return RAMPS[key];
}

/** 1 フレームの矩形（絵のドット）。(ox, oy) は矩形の左上から原点までのずれ */
export interface FxCell {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export function sheetDef(key: FxSheetKey): FxSheetDef {
  return FX_SHEETS[key];
}

/** 方向 × フレームの矩形。範囲外・空のフレームは undefined */
export function cellOf(sheet: FxSheetDef, dir: number, frame: number): FxCell | undefined {
  if (dir < 0 || dir >= sheet.dirs || frame < 0 || frame >= sheet.frames) return undefined;
  const i = (dir * sheet.frames + frame) * RECT_STRIDE;
  const [x, y, w, h, ox, oy] = sheet.rects.slice(i, i + RECT_STRIDE);
  if (x === undefined || y === undefined || w === undefined || h === undefined || ox === undefined || oy === undefined) return undefined;
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h, ox, oy };
}

/** 引く方向と上下反転。ccw（反時計回りの振り）は −θ の絵を上下反転する（docs/ideas/fx-sprites.md 3.2） */
export interface FxPick {
  dir: number;
  flip: boolean;
}

export function pickDir(angle: number, dirs: number, ccw: boolean): FxPick {
  if (dirs <= 1) return { dir: 0, flip: ccw };
  const a = ccw ? -angle : angle;
  const step = (Math.PI * 2) / dirs;
  const dir = ((Math.round(a / step) % dirs) + dirs) % dirs;
  return { dir, flip: ccw };
}

/**
 * 振りのフレーム。active は進み（0..1）で前半の active 枚、recover は経過秒を fade 秒で後半に割り当てる。
 * 流し切ったら null（描かない）
 */
export function swingFrame(sheet: Pick<FxSheetDef, "frames" | "active">, phase: "active" | "recover", progress: number, recoverElapsed: number, fade: number): number | null {
  if (phase === "active") {
    const p = Math.min(1, Math.max(0, progress));
    return Math.min(sheet.active - 1, Math.floor(p * sheet.active));
  }
  const rest = sheet.frames - sheet.active;
  if (rest <= 0 || fade <= 0) return null;
  const k = recoverElapsed / fade;
  if (k < 0 || k >= 1) return null;
  return sheet.active + Math.min(rest - 1, Math.floor(k * rest));
}

/** 寿命で流すフレーム（命中・受け流し）。流し切ったら null */
export function lifeFrame(frames: number, age: number, life: number): number | null {
  if (life <= 0 || age < 0 || age >= life) return null;
  return Math.min(frames - 1, Math.floor((age / life) * frames));
}

/** 絵の基準の大きさと今の当たり判定の大きさの比。差が tolerance 以内なら 1（ドットを崩さない） */
export function fitScale(actual: number, base: number, tolerance: number): number {
  if (base <= 0 || actual <= 0) return 1;
  const r = actual / base;
  return Math.abs(r - 1) <= tolerance ? 1 : r;
}

/** 論理座標を絵のドットの格子（0.5px）に揃える */
export function snapArt(v: number): number {
  return Math.round(v * FX_ART_SCALE) / FX_ART_SCALE;
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface FxDrawOpts {
  ramp: FxRampKey;
  ccw?: boolean;
  /** 論理の拡縮（fitScale）。1 で絵のまま */
  scale?: number;
  alpha?: number;
}

/** アトラスの読み込みと、配色したフレームのキャッシュ */
export class FxSpriteBank {
  private readonly images = new Map<FxAtlasKey, HTMLImageElement>();
  private readonly cells = new Map<string, HTMLCanvasElement | null>();
  private readonly ramps = new Map<FxRampKey, [number, number, number][]>();

  /** すべてのアトラスを読む。失敗したアトラスのシートは描かない（has が false） */
  async load(baseUrl: string): Promise<void> {
    const keys = Object.keys(FX_ATLASES) as FxAtlasKey[];
    await Promise.all(
      keys.map(async (key) => {
        try {
          const img = new Image();
          img.src = `${baseUrl}${FX_ATLASES[key].url}`;
          await img.decode();
          this.images.set(key, img);
        } catch {
          // 読めなければ手続きの描画のまま
        }
      }),
    );
  }

  has(key: FxSheetKey): boolean {
    return this.images.has(FX_SHEETS[key].atlas);
  }

  /**
   * シートの 1 フレームを原点 (x, y)（論理座標）に置く。angle は攻撃の向き（向きのないシートは無視）。
   * 描けたら true
   */
  draw(ctx: CanvasRenderingContext2D, key: FxSheetKey, frame: number, x: number, y: number, angle: number, opts: FxDrawOpts): boolean {
    const sheet = FX_SHEETS[key];
    const pick = pickDir(angle, sheet.dirs, opts.ccw ?? false);
    const cell = cellOf(sheet, pick.dir, frame);
    if (!cell) return false;
    const img = this.cellCanvas(key, sheet, pick.dir, frame, cell, opts.ramp);
    if (!img) return false;
    const s = (opts.scale ?? 1) / FX_ART_SCALE;
    ctx.save();
    ctx.translate(snapArt(x), snapArt(y));
    if (pick.flip) ctx.scale(1, -1);
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.drawImage(img, -cell.ox * s, -cell.oy * s, cell.w * s, cell.h * s);
    ctx.restore();
    return true;
  }

  private cellCanvas(key: FxSheetKey, sheet: FxSheetDef, dir: number, frame: number, cell: FxCell, ramp: FxRampKey): HTMLCanvasElement | null {
    const id = `${key}|${dir}|${frame}|${ramp}`;
    const hit = this.cells.get(id);
    if (hit !== undefined) return hit;
    const img = this.images.get(sheet.atlas);
    const made = img ? recolorCell(img, cell, this.rampRgb(ramp)) : null;
    this.cells.set(id, made);
    return made;
  }

  private rampRgb(key: FxRampKey): [number, number, number][] {
    const hit = this.ramps.get(key);
    if (hit) return hit;
    const made = rampColors(key).map(hexRgb);
    this.ramps.set(key, made);
    return made;
  }
}

/** アトラスから 1 フレームを切り出し、段の灰色を配色の色へ写す */
function recolorCell(img: HTMLImageElement, cell: FxCell, ramp: readonly [number, number, number][]): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = cell.w;
  canvas.height = cell.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
  const image = ctx.getImageData(0, 0, cell.w, cell.h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const level = Math.min(LEVELS, Math.max(1, Math.round((data[i] ?? 0) / LEVEL_GRAY)));
    const rgb = ramp[level - 1];
    if (!rgb) continue;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
