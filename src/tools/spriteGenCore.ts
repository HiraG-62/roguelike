// ドット絵の作業台（tools/sprite-gen.html）の純粋な部分: Spriteloom とやり取りする JSON の形、画素 ↔ ピクセルマップの変換。
// DOM と WebSocket は spriteGen.ts / spriteloomClient.ts が持つ。変換の決まりは scripts/sprite/raster.mjs と揃える
import { assemblePrompt } from "../../scripts/sprite/prompt.mjs";

export const TRANSPARENT = ".";
const CHANNELS = 4;
/** 透明とみなす α の境（raster.mjs の ALPHA_OPAQUE_MIN と同じ） */
const ALPHA_OPAQUE_MIN = 128;
const OPAQUE = 255;

export type Rgb = readonly [number, number, number];
export type Palette = Readonly<Record<string, string>>;

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type Background = "auto" | "remove" | "keep";
export const BACKGROUNDS: readonly Background[] = ["auto", "remove", "keep"];

/** Spriteloom への依頼（Aseprite 拡張と同じ JSON） */
export interface SpriteloomRequest {
  id: string;
  mode: "generate" | "edit";
  prompt: string;
  target_size: [number, number];
  variants: number;
  background: Background;
  seed?: number;
  palette?: Rgb[];
  frames?: { image: string }[];
}

export type ServerMessage =
  | { type: "pong"; model: string; progress: number; stage: string }
  | { type: "progress"; value: number; stage: string }
  | { type: "result"; images: RgbaImage[]; seeds: number[] }
  | { type: "error"; message: string };

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function paletteRgb(palette: Palette): Rgb[] {
  return Object.values(palette).map(hexToRgb);
}

function nearestChar(entries: readonly (readonly [string, Rgb])[], r: number, g: number, b: number): string {
  let best = TRANSPARENT;
  let bestD = Number.POSITIVE_INFINITY;
  for (const [ch, [pr, pg, pb]] of entries) {
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = ch;
    }
  }
  return best;
}

/**
 * RGBA を PALETTE の文字の行にする。PALETTE に無い色は最も近い色に丸め、その画素数を offPalette で返す
 * （Spriteloom はパレット固定で返すので通常 0。--free-palette 相当で生成したときに増える）
 */
export function quantizeToRows(img: RgbaImage, palette: Palette): { rows: string[]; offPalette: number } {
  const entries = Object.entries(palette).map(([ch, hex]) => [ch, hexToRgb(hex)] as const);
  const exact = new Map<number, string>();
  for (const [ch, [r, g, b]] of entries) {
    const packed = (r << 16) | (g << 8) | b;
    if (!exact.has(packed)) exact.set(packed, ch);
  }
  const rows: string[] = [];
  let offPalette = 0;
  for (let y = 0; y < img.height; y++) {
    let row = "";
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * CHANNELS;
      if ((img.rgba[o + 3] ?? 0) < ALPHA_OPAQUE_MIN) {
        row += TRANSPARENT;
        continue;
      }
      const r = img.rgba[o] ?? 0;
      const g = img.rgba[o + 1] ?? 0;
      const b = img.rgba[o + 2] ?? 0;
      const ch = exact.get((r << 16) | (g << 8) | b);
      if (ch !== undefined) {
        row += ch;
        continue;
      }
      offPalette++;
      row += nearestChar(entries, r, g, b);
    }
    rows.push(row);
  }
  return { rows, offPalette };
}

/** ピクセルマップの行を RGBA にする。PALETTE に無い文字は透明 */
export function rowsToRgba(rows: readonly string[], palette: Palette): RgbaImage {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const rgba = new Uint8Array(width * height * CHANNELS);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const hex = palette[row[x] ?? TRANSPARENT];
      if (!hex) continue;
      const [r, g, b] = hexToRgb(hex);
      const o = (y * width + x) * CHANNELS;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = OPAQUE;
    }
  });
  return { width, height, rgba };
}

/** `npm run sprite -- import` と同じ形の TS リテラル */
export function frameLiteral(name: string, rows: readonly string[]): string {
  return `const ${name}: Frame = [\n${rows.map((r) => `  "${r}",`).join("\n")}\n];`;
}

/** 定数名に使える形（英数字と _ の大文字）へ寄せる。空なら FRAME */
export function constName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  if (!cleaned) return "FRAME";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export interface GenerateOptions {
  subject: string;
  view: string;
  extra: string;
  width: number;
  height: number;
  variants: number;
  background: Background;
  seed?: number;
  palette?: Rgb[];
}

export function generateRequest(id: string, o: GenerateOptions): SpriteloomRequest {
  return {
    id,
    mode: "generate",
    prompt: assemblePrompt(o.view, o.subject, o.extra),
    target_size: [o.width, o.height],
    variants: o.variants,
    background: o.background,
    ...(o.seed === undefined ? {} : { seed: o.seed }),
    ...(o.palette ? { palette: o.palette } : {}),
  };
}

export interface EditOptions {
  instruction: string;
  width: number;
  height: number;
  /** 元のフレームの PNG（base64、data: の前置きなし） */
  imagePngB64: string;
  variants: number;
  background: Background;
  seed?: number;
  palette?: Rgb[];
}

export function editRequest(id: string, o: EditOptions): SpriteloomRequest {
  return {
    id,
    mode: "edit",
    prompt: o.instruction,
    target_size: [o.width, o.height],
    variants: o.variants,
    background: o.background,
    frames: [{ image: o.imagePngB64 }],
    ...(o.seed === undefined ? {} : { seed: o.seed }),
    ...(o.palette ? { palette: o.palette } : {}),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseImage(v: unknown): RgbaImage | null {
  if (!isRecord(v) || typeof v.px !== "string") return null;
  const width = num(v.w, 0);
  const height = num(v.h, 0);
  const rgba = decodeBase64(v.px);
  if (width <= 0 || height <= 0 || rgba.length !== width * height * CHANNELS) return null;
  return { width, height, rgba };
}

/** サーバーの 1 通を読む。知らない形・壊れた JSON は null（黙って捨てる） */
export function parseServerMessage(text: string): ServerMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (data.type) {
    case "pong":
      return { type: "pong", model: str(data.model), progress: num(data.progress, 0), stage: str(data.stage) };
    case "progress":
      return { type: "progress", value: num(data.value, 0), stage: str(data.stage) };
    case "error":
      return { type: "error", message: str(data.message) };
    case "result": {
      const raw = Array.isArray(data.images) ? data.images : [];
      const images = raw.map(parseImage).filter((im): im is RgbaImage => im !== null);
      const seeds = Array.isArray(data.seeds) ? data.seeds.map((s) => num(s, 0)) : [];
      return { type: "result", images, seeds };
    }
    default:
      return null;
  }
}
