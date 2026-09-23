/**
 * ドット風テキスト描画。DotGothic16 を設計サイズ 16px（1 ドット = 1px）でグリフごとにラスタライズしてキャッシュし、
 * デバイスピクセルで整数 m 倍になるよう imageSmoothing なしで blit する。
 * fillText を transform 越しに直接使うと拡大時にアンチエイリアスで滑らかになり、ドット絵と馴染まないため。
 */
import { PIXEL_FONT_FAMILY, uiFont, wrapByWidth } from "./font";

/** DotGothic16 の設計サイズ。この px で描くと 1 ドット = 1px になる */
export const PIXEL_FONT_DESIGN_PX = 16;
/** 設計サイズでのベースライン位置（sTypoAscender 880/1000 × 16 = 14.08 → ドットグリッド上は 14） */
const GLYPH_BASELINE_PX = 14;
/** 未ロード時の推定 advance（半角 / 全角） */
const HALF_ADVANCE = 8;
const FULL_ADVANCE = 16;
/** 二値化の閾値。フォントのヒンティング由来の半透明ピクセルを落としてドットをくっきりさせる */
const ALPHA_THRESHOLD = 128;
/** 色付きグリフの総キャッシュ数の上限。超えたら色キャッシュ全体を捨てる（色を毎フレーム変える呼び出しへの保険） */
const MAX_TINTED_GLYPHS = 4096;
const FONT_SPEC = `${PIXEL_FONT_DESIGN_PX}px "${PIXEL_FONT_FAMILY}"`;
const GLYPH_COLOR = "#fff";

export type PixelTextAlign = "left" | "center" | "right";
export type PixelTextBaseline = "top" | "middle" | "bottom";

export interface PixelTextDrawOptions {
  /** ドットの倍率（デバイスピクセル単位の整数）。1 ドットが m×m デバイスピクセルになる */
  m: number;
  color: string;
  align?: PixelTextAlign;
  /** y が行ボックス（高さ 16 ドット）のどこを指すか。既定 top */
  baseline?: PixelTextBaseline;
  alpha?: number;
}

interface Glyph {
  canvas: HTMLCanvasElement;
  /** 設計サイズでの advance（px = ドット数） */
  advance: number;
}

/** テスト用に差し替え可能な環境依存部分 */
export interface PixelTextEnv {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  /** フォントが使える状態か */
  isFontReady(): boolean;
  /** フォントのロードを要求し、完了で resolve する。font-display: block でも誰かが使うまでロードされないため明示的に要求する */
  loadFont(): Promise<unknown>;
}

function browserEnv(): PixelTextEnv {
  return {
    createCanvas(width, height) {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      return c;
    },
    isFontReady: () => document.fonts.check(FONT_SPEC),
    loadFont: () => document.fonts.load(FONT_SPEC),
  };
}

/** 全角扱いの文字か（未ロード時の advance 推定用）。半角カナ U+FF61-FF9F は半角 */
export function isFullWidthChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x1100) return false;
  if (code >= 0xff61 && code <= 0xff9f) return false;
  return true;
}

/** ctx の現在の transform から「論理 px → デバイス px」の倍率を得る（回転なし・等方スケール前提） */
export function scaleOf(ctx: CanvasRenderingContext2D): number {
  const s = ctx.getTransform().a;
  return s > 0 ? s : 1;
}

export class PixelText {
  private readonly glyphs = new Map<string, Glyph>();
  private readonly tinted = new Map<string, Map<string, HTMLCanvasElement>>();
  private tintedCount = 0;
  private ready: boolean;
  private measureCtx: CanvasRenderingContext2D | null = null;
  /** width / wrap / sizeFor で scale 省略時に使う倍率。draw() のたびに ctx から更新される */
  private scale = 1;

  constructor(private readonly env: PixelTextEnv) {
    this.ready = env.isFontReady();
    if (this.ready) return;
    env
      .loadFont()
      .then(() => this.onFontLoaded())
      .catch(() => {
        /* ロード失敗時は uiFont フォールバックのまま */
      });
  }

  isReady(): boolean {
    return this.ready;
  }

  /** 論理 px → デバイス px の倍率を明示設定する（リサイズ時に k*dpr を渡す） */
  setScale(scale: number): void {
    if (scale > 0) this.scale = scale;
  }

  /** 論理 px で logicalPx 以上の高さになる最小のドット倍率 m（>= 1） */
  sizeFor(logicalPx: number, scale = this.scale): number {
    const exact = (logicalPx * scale) / PIXEL_FONT_DESIGN_PX;
    const EPS = 1e-6;
    return Math.max(1, Math.ceil(exact - EPS));
  }

  /** 倍率 m での行の高さ（論理 px） */
  lineHeight(m: number, scale = this.scale): number {
    return (PIXEL_FONT_DESIGN_PX * m) / scale;
  }

  /** 設計サイズでの advance 合計（ドット数） */
  dotWidth(text: string): number {
    let sum = 0;
    for (const ch of text) sum += this.advanceOf(ch);
    return sum;
  }

  /** 倍率 m での論理幅 */
  width(text: string, m: number, scale = this.scale): number {
    return (this.dotWidth(text) * m) / scale;
  }

  /** 論理幅 maxWidth で折り返す。改行文字は強制改行。日本語は 1 文字単位、英語は単語単位、行頭禁則は最小限 */
  wrap(text: string, maxWidth: number, m: number, scale = this.scale): string[] {
    const measure = (s: string): number => this.width(s, m, scale);
    return text.split("\n").flatMap((para) => (para === "" ? [""] : wrapByWidth(para, maxWidth, measure)));
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: PixelTextDrawOptions): void {
    if (!text) return;
    const t = ctx.getTransform();
    const scale = t.a > 0 ? t.a : 1;
    this.scale = scale;
    const m = Math.max(1, Math.round(opts.m));
    if (!this.ready) {
      this.drawFallback(ctx, text, x, y, opts, m, scale);
      return;
    }

    const lineH = (PIXEL_FONT_DESIGN_PX * m) / scale;
    const totalW = this.width(text, m, scale);
    let left = x;
    if (opts.align === "center") left -= totalW / 2;
    else if (opts.align === "right") left -= totalW;
    let top = y;
    if (opts.baseline === "middle") top -= lineH / 2;
    else if (opts.baseline === "bottom") top -= lineH;

    // デバイスピクセルの整数位置へスナップ（translate 成分 e/f も含めて丸める）
    const snapX = (Math.round(left * scale + t.e) - t.e) / scale;
    const snapY = (Math.round(top * scale + t.f) - t.f) / scale;

    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevAlpha = ctx.globalAlpha;
    ctx.imageSmoothingEnabled = false;
    if (opts.alpha !== undefined) ctx.globalAlpha = prevAlpha * opts.alpha;
    let penDots = 0;
    for (const ch of text) {
      const glyph = this.glyph(ch);
      if (glyph.advance > 0 && ch !== " " && ch !== "　") {
        const img = this.tintedGlyph(ch, glyph, opts.color);
        ctx.drawImage(
          img,
          snapX + (penDots * m) / scale,
          snapY,
          (glyph.advance * m) / scale,
          lineH,
        );
      }
      penDots += glyph.advance;
    }
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.globalAlpha = prevAlpha;
  }

  /** キャッシュを全破棄する（フォントロード完了時など） */
  clearCache(): void {
    this.glyphs.clear();
    this.tinted.clear();
    this.tintedCount = 0;
  }

  /** テスト・デバッグ用: 色付きグリフのキャッシュ数 */
  tintedCacheSize(): number {
    return this.tintedCount;
  }

  private onFontLoaded(): void {
    this.clearCache();
    this.measureCtx = null;
    this.ready = true;
  }

  private advanceOf(ch: string): number {
    if (!this.ready) return isFullWidthChar(ch) ? FULL_ADVANCE : HALF_ADVANCE;
    return this.glyph(ch).advance;
  }

  private measure(ch: string): number {
    if (!this.measureCtx) {
      this.measureCtx = this.env.createCanvas(1, 1).getContext("2d");
      if (this.measureCtx) this.measureCtx.font = FONT_SPEC;
    }
    if (!this.measureCtx) return isFullWidthChar(ch) ? FULL_ADVANCE : HALF_ADVANCE;
    return Math.round(this.measureCtx.measureText(ch).width);
  }

  private glyph(ch: string): Glyph {
    const hit = this.glyphs.get(ch);
    if (hit) return hit;
    const advance = this.measure(ch);
    const canvas = this.env.createCanvas(Math.max(1, advance), PIXEL_FONT_DESIGN_PX);
    const g = canvas.getContext("2d");
    if (g) {
      g.font = FONT_SPEC;
      g.fillStyle = GLYPH_COLOR;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.fillText(ch, 0, GLYPH_BASELINE_PX);
      binarizeAlpha(g, canvas.width, canvas.height);
    }
    const made: Glyph = { canvas, advance };
    this.glyphs.set(ch, made);
    return made;
  }

  private tintedGlyph(ch: string, glyph: Glyph, color: string): HTMLCanvasElement {
    let byChar = this.tinted.get(color);
    const hit = byChar?.get(ch);
    if (hit) return hit;
    if (this.tintedCount >= MAX_TINTED_GLYPHS) {
      this.tinted.clear();
      this.tintedCount = 0;
      byChar = undefined;
    }
    if (!byChar) {
      byChar = new Map();
      this.tinted.set(color, byChar);
    }
    const canvas = this.env.createCanvas(glyph.canvas.width, glyph.canvas.height);
    const g = canvas.getContext("2d");
    if (g) {
      g.drawImage(glyph.canvas, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    byChar.set(ch, canvas);
    this.tintedCount++;
    return canvas;
  }

  /** フォント未ロード時: 同じ行ボックスに収まるよう uiFont で描く */
  private drawFallback(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    opts: PixelTextDrawOptions,
    m: number,
    scale: number,
  ): void {
    const lineH = (PIXEL_FONT_DESIGN_PX * m) / scale;
    const prevAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.font = uiFont(lineH * (GLYPH_BASELINE_PX / PIXEL_FONT_DESIGN_PX), "normal");
    ctx.fillStyle = opts.color;
    ctx.textAlign = opts.align ?? "left";
    ctx.textBaseline = opts.baseline ?? "top";
    if (opts.alpha !== undefined) ctx.globalAlpha = prevAlpha * opts.alpha;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

function binarizeAlpha(g: CanvasRenderingContext2D, w: number, h: number): void {
  if (typeof g.getImageData !== "function") return;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    const on = (d[i] ?? 0) >= ALPHA_THRESHOLD;
    d[i - 3] = 255;
    d[i - 2] = 255;
    d[i - 1] = 255;
    d[i] = on ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
}

let shared: PixelText | null = null;

/** ブラウザ環境の共有インスタンス */
export function pixelText(): PixelText {
  if (!shared) shared = new PixelText(browserEnv());
  return shared;
}
