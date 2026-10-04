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

function isAtlasKey(key: string): key is FxAtlasKey {
  return Object.hasOwn(FX_ATLASES, key);
}
import RAMPS from "../data/fxRamps.json";

/** 絵のドット / 論理 px */
export const FX_ART_SCALE = 2;
/** PNG に書いた段の灰色（段 × LEVEL_GRAY。scripts/fx/gen.mjs と同じ値） */
const LEVEL_GRAY = 32;
const LEVELS = 7;
const RECT_STRIDE = 6;
/** 滲みの届く距離の余り（斜めの隣 √2 を幅 1 に含める） */
const HALO_REACH_SLACK = 0.5;
/** 滲みが外端で 0 になりきらないよう、薄れる幅に足す余り */
const HALO_FADE_SLACK = 0.5;

export type FxRampKey = Exclude<keyof typeof RAMPS, "_note" | "_halo">;

export const FX_RAMP_KEYS: readonly FxRampKey[] = ["steel", "brass", "fire", "ice", "lightning", "poison", "dark", "light"];

/** 配色の 7 段（暗 → 明） */
export function rampColors(key: FxRampKey): readonly string[] {
  return RAMPS[key];
}

/** 線の周りの滲み（墨の主題。docs/ideas/fx-sprites.md 3.6）。r は絵のドット */
export interface FxHalo {
  readonly color: string;
  readonly alpha: number;
  readonly r: number;
}

export function rampHalo(key: FxRampKey): FxHalo {
  return RAMPS._halo[key];
}

/** 配色の光の色（弾・振りの先端の灯り）。墨の配色は明部が暗いので、滲みの色で灯す */
export function rampGlow(key: FxRampKey): string {
  return rampHalo(key).color;
}

/**
 * 滲みの不透明度。線（不透明なドット）からの距離 d（絵のドット、隣 = 1）で薄くなり、r を超えると 0。
 * 線そのもの（d = 0）は 0（線の色で塗る）
 */
export function haloAlpha(halo: FxHalo, d: number): number {
  if (d <= 0 || d > halo.r + HALO_REACH_SLACK) return 0;
  return Math.max(0, halo.alpha * (1 - (d - 1) / (halo.r + HALO_FADE_SLACK)));
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

/** 繰り返すフレーム（押している間の回し）。period 秒で frames 枚を 1 巡する */
export function loopFrame(frames: number, time: number, period: number): number {
  if (frames <= 0 || period <= 0) return 0;
  const cycle = (((time / period) % 1) + 1) % 1;
  return Math.min(frames - 1, Math.floor(cycle * frames));
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

/** 作られたすべての bank（本編・武器掛けの弾の札がそれぞれ持つ） */
const fxBanks = new Set<FxSpriteBank>();

/** どこかの bank が読み込み中か（main.ts はこの間ゲームを止める） */
export function fxArtLoading(): boolean {
  for (const bank of fxBanks) if (bank.isLoading()) return true;
  return false;
}

/** アトラスの読み込みと、配色したフレームのキャッシュ */
export class FxSpriteBank {
  private readonly images = new Map<string, HTMLImageElement>();
  /** 読み込み中・読み込み済み・失敗したアトラス（同じアトラスを二度読まない） */
  private readonly requested = new Set<string>();
  /** 読み込み中のアトラス（読めたか失敗したら外す） */
  private readonly loading = new Set<string>();
  private readonly cells = new Map<string, HTMLCanvasElement | null>();
  private readonly ramps = new Map<FxRampKey, [number, number, number][]>();
  /** 今の武器種・奥義のアトラス（focus の並びを連結した key。同じなら何もしない） */
  private current = "";
  private focused = new Set<string>();

  /** baseUrl は public/ の置き場所（ページからの相対。main.ts の他の PNG と同じ流儀で空文字） */
  constructor(private readonly baseUrl = "") {
    fxBanks.add(this);
  }

  /**
   * 今の武器種（と奥義）のアトラスを読み始め、それ以外のアトラスと配色のキャッシュを捨てる。
   * 1 アトラスは展開すると数十 MB あるので、装備中の武器種の分だけを持つ（docs/ideas/fx-sprites.md 7 章）
   */
  focus(atlases: readonly (string | undefined)[]): void {
    const keep = atlases.filter((a): a is string => a !== undefined);
    const id = keep.join("|");
    if (id === this.current) return;
    this.current = id;
    this.focused = new Set(keep);
    for (const key of [...this.images.keys()]) if (!this.focused.has(key)) this.images.delete(key);
    for (const key of [...this.requested]) if (!this.focused.has(key)) this.requested.delete(key);
    for (const key of [...this.loading]) if (!this.focused.has(key)) this.loading.delete(key);
    this.cells.clear();
    for (const atlas of keep) this.request(atlas);
  }

  /** アトラスが読み込み済みか（読み始めはしない） */
  ready(atlas: string): boolean {
    return this.images.has(atlas);
  }

  /** focus したアトラスに読み込み中のものがあるか（main.ts はこの間ゲームを止め、手続きの描画を見せない） */
  isLoading(): boolean {
    return this.loading.size > 0;
  }

  /**
   * 読み込み済みか。まだなら読み始めて false（読めなかったアトラスと読み込み前の実演は手続きの描画）。
   * 今の武器種のものでないアトラス（持ち替える前に撃った弾など）は読まない（読んでは捨てるのを繰り返さない）
   */
  has(key: FxSheetKey): boolean {
    const atlas = FX_SHEETS[key].atlas;
    if (this.images.has(atlas)) return true;
    if (this.focused.has(atlas)) this.request(atlas);
    return false;
  }

  private request(atlas: string): void {
    if (this.requested.has(atlas) || !isAtlasKey(atlas)) return;
    this.requested.add(atlas);
    this.loading.add(atlas);
    const img = new Image();
    img.src = `${this.baseUrl}${FX_ATLASES[atlas].url}`;
    img
      .decode()
      .then(() => {
        // 読み込み中に武器を持ち替えていたら捨てる
        if (!this.requested.has(atlas)) return;
        primeReadback(img);
        this.images.set(atlas, img);
      })
      .catch(() => {
        // 読めなければ手続きの描画のまま（requested に残して読み直さない）
      })
      .finally(() => this.loading.delete(atlas));
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
    // 滲みの分だけ四方に広げて焼いてある（recolorCell）
    const pad = (img.width - cell.w) / 2;
    ctx.save();
    ctx.translate(snapArt(x), snapArt(y));
    if (pick.flip) ctx.scale(1, -1);
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.drawImage(img, -(cell.ox + pad) * s, -(cell.oy + pad) * s, img.width * s, img.height * s);
    ctx.restore();
    return true;
  }

  /**
   * 長さ方向に一様な帯（ビーム・斬線の 1 区間の絵。向き 0 だけを描いたシート）を、始点 (x, y) から angle の向きへ
   * length px まで step px ごとに並べる。区間を 15° 刻みの向きに丸めると斜めで階段状に折れるので、帯は実際の角度に回して描く
   * （帯は一様なので回したドットの崩れが目立たない）。終点を越えた分は切る
   */
  drawStrip(ctx: CanvasRenderingContext2D, key: FxSheetKey, frame: number, x: number, y: number, angle: number, length: number, step: number, opts: FxDrawOpts): boolean {
    const sheet = FX_SHEETS[key];
    const cell = cellOf(sheet, 0, frame);
    if (!cell || length <= 0 || step <= 0) return false;
    const img = this.cellCanvas(key, sheet, 0, frame, cell, opts.ramp);
    if (!img) return false;
    const s = (opts.scale ?? 1) / FX_ART_SCALE;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.beginPath();
    ctx.rect(0, -cell.h * s, length, cell.h * s * 2);
    ctx.clip();
    for (let d = step / 2; d < length + step; d += step) ctx.drawImage(img, d - cell.ox * s, -cell.oy * s, cell.w * s, cell.h * s);
    ctx.restore();
    return true;
  }

  private cellCanvas(key: FxSheetKey, sheet: FxSheetDef, dir: number, frame: number, cell: FxCell, ramp: FxRampKey): HTMLCanvasElement | null {
    const id = `${key}|${dir}|${frame}|${ramp}`;
    const hit = this.cells.get(id);
    if (hit !== undefined) return hit;
    const img = this.images.get(sheet.atlas);
    const made = img ? recolorCell(img, cell, this.rampRgb(ramp), rampHalo(ramp)) : null;
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

/**
 * 読み込んだ直後に 1 画素だけ CPU 側の canvas へ写して読み、アトラスを CPU 側へ展開させておく。
 * しないと最初の再配色（攻撃が初めて出たフレーム）でアトラス全体の展開を待って 15〜25ms 止まる
 */
function primeReadback(img: HTMLImageElement): void {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
  ctx.getImageData(0, 0, 1, 1);
}

/**
 * アトラスから 1 フレームを切り出し、段の灰色を配色の色へ写す。
 * 墨の滲み（halo）の幅だけ四方に広げた canvas に描き、線の周りの透明なドットに滲みの色を薄く置く（左右上下対称なので上下反転してもずれない）
 */
function recolorCell(img: HTMLImageElement, cell: FxCell, ramp: readonly [number, number, number][], halo: FxHalo): HTMLCanvasElement | null {
  const pad = Math.max(0, Math.ceil(halo.r));
  const w = cell.w + pad * 2;
  const h = cell.h + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, pad, pad, cell.w, cell.h);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (!data[o + 3]) continue;
    opaque[i] = 1;
    const level = Math.min(LEVELS, Math.max(1, Math.round((data[o] ?? 0) / LEVEL_GRAY)));
    const rgb = ramp[level - 1];
    if (!rgb) continue;
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  }
  if (pad > 0 && halo.alpha > 0) paintHalo(data, opaque, w, h, pad, halo);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** 透明なドットのうち、線から pad 以内のものに滲みの色を置く（近いほど濃い） */
function paintHalo(data: Uint8ClampedArray, opaque: Uint8Array, w: number, h: number, pad: number, halo: FxHalo): void {
  const rgb = hexRgb(halo.color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque[y * w + x]) continue;
      let best = Infinity;
      for (let dy = -pad; dy <= pad; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -pad; dx <= pad; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || !opaque[yy * w + xx]) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
      const a = haloAlpha(halo, Math.sqrt(best));
      if (a <= 0) continue;
      const o = (y * w + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = Math.round(a * 255);
    }
  }
}
