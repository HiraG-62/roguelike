// マップのテーマ（docs/ideas/map-visual-impl.md 2-1・2-2 節）。深度とバイオームから配色・様式を決める純関数。
// 表そのものは data/mapThemes.ts。ここは派生色の計算・バイオームの寄せ・深みの変異。
import type { FloorKind } from "../core/state";
import {
  BIOME_DEFS,
  BLOOD_COLORS,
  FOG_TINT,
  GLOW_PROPS,
  PIT_COLORS,
  PIT_OF_KIND,
  STORM_HUE_STEP_DEG,
  STYLE_DEFS,
  type BiomeDef,
  type BiomeVariant,
  type PropWeight,
  type StyleColors,
  type StyleDef,
} from "../data/mapThemes";
import { DEEP } from "../data/tuning";
import { chapterOf, deepFloorOf, isDeepDepth, isFinalDepth } from "../system/chapters";
import { mapDarkFor } from "./mapLight";
import { pack } from "./mapNoise";
import type { DecalKind, MapPalette, MapPropKind, MapStyle, MapTheme, MapThemeFlags, PitTheme } from "./mapTypes";

// ---------------------------------------------------------------------------
// 色の計算（ABGR の 32bit。mapNoise.pack と同じ並び）
// ---------------------------------------------------------------------------

const BYTE_MAX = 255;
const HALF_BYTE = 0.5;

export function colorR(c: number): number {
  return c & BYTE_MAX;
}
export function colorG(c: number): number {
  return (c >>> 8) & BYTE_MAX;
}
export function colorB(c: number): number {
  return (c >>> 16) & BYTE_MAX;
}

/** "#rrggbb" を詰める */
export function hexColor(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return pack((n >> 16) & BYTE_MAX, (n >> 8) & BYTE_MAX, n & BYTE_MAX);
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > BYTE_MAX ? BYTE_MAX : v | 0);

/** a から b へ t（0..1）だけ寄せる。焼き付けの内側ループでも呼ぶので割り当てを起こさない */
export function mixColor(a: number, b: number, t: number): number {
  const ar = a & BYTE_MAX;
  const ag = (a >>> 8) & BYTE_MAX;
  const ab = (a >>> 16) & BYTE_MAX;
  return pack(
    (ar + (((b & BYTE_MAX) - ar) * t + HALF_BYTE)) | 0,
    (ag + ((((b >>> 8) & BYTE_MAX) - ag) * t + HALF_BYTE)) | 0,
    (ab + ((((b >>> 16) & BYTE_MAX) - ab) * t + HALF_BYTE)) | 0,
  );
}

const WHITE = pack(BYTE_MAX, BYTE_MAX, BYTE_MAX);
const BLACK = pack(0, 0, 0);
/** 見本の fO の寄せ先（床の暗がり） */
const FLOOR_OUTLINE_BASE = hexColor("#0c0b10");
const SOOT_COLOR = hexColor("#150d0a");
const SNOW_COLOR = hexColor("#d4e2f0");

export function lighten(c: number, t: number): number {
  return mixColor(c, WHITE, t);
}
export function darken(c: number, t: number): number {
  return mixColor(c, BLACK, t);
}

/** 派生色の入力（詰めた色）。StyleColors と同じキー */
export type PackedColors = { readonly [K in keyof StyleColors]: number };

export function packColors(c: StyleColors): PackedColors {
  return {
    fD: hexColor(c.fD),
    fB: hexColor(c.fB),
    fL: hexColor(c.fL),
    top: hexColor(c.top),
    side: hexColor(c.side),
    light: hexColor(c.light),
    accent: hexColor(c.accent),
    moss1: hexColor(c.moss1),
    moss2: hexColor(c.moss2),
    wood: hexColor(c.wood),
  };
}

/** 見本の derivePalette をそのまま移したもの（fO・fH・tD・tL・sL・sD・v1・v2・vD・accL・accD・stoneL/B/D ほか） */
export function derivePalette(c: PackedColors): MapPalette {
  const vD = darken(c.side, 0.62);
  return {
    fD: c.fD,
    fB: c.fB,
    fL: c.fL,
    fH: lighten(c.fL, 0.07),
    fO: mixColor(c.fD, FLOOR_OUTLINE_BASE, 0.55),
    tB: c.top,
    tD: mixColor(c.top, c.side, 0.5),
    tL: lighten(c.top, 0.13),
    sB: c.side,
    sL: mixColor(c.side, c.top, 0.42),
    sD: darken(c.side, 0.35),
    v1: mixColor(c.top, vD, 0.42),
    v2: mixColor(c.top, vD, 0.74),
    vD,
    light: c.light,
    lightDim: mixColor(c.light, vD, 0.5),
    accent: c.accent,
    accL: lighten(c.accent, 0.25),
    accD: darken(c.accent, 0.35),
    moss1: c.moss1,
    moss2: c.moss2,
    wood: c.wood,
    soot: SOOT_COLOR,
    snow: SNOW_COLOR,
    stoneL: mixColor(c.top, c.fL, 0.3),
    stoneB: mixColor(c.top, c.side, 0.25),
    stoneD: mixColor(c.top, c.side, 0.65),
  };
}

// ---------------------------------------------------------------------------
// 色の寄せ（バイオーム・変異）
// ---------------------------------------------------------------------------

const COLOR_KEYS: readonly (keyof StyleColors)[] = ["fD", "fB", "fL", "top", "side", "light", "accent", "moss1", "moss2", "wood"];
/** バイオームの色を寄せる先（床と天面だけ。側面は様式の暗さを保つ） */
const TINT_KEYS: readonly (keyof StyleColors)[] = ["fD", "fB", "fL", "top"];
/** 暗いバイオームで明度を掛ける色 */
const BRIGHTNESS_KEYS: readonly (keyof StyleColors)[] = ["fD", "fB", "fL", "top", "side"];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function mapColors(c: PackedColors, keys: readonly (keyof StyleColors)[], f: (v: number) => number): PackedColors {
  const out: Mutable<PackedColors> = { ...c };
  for (const key of keys) out[key] = f(c[key]);
  return out;
}

function tintColors(c: PackedColors, keys: readonly (keyof StyleColors)[], color: number, amount: number): PackedColors {
  return mapColors(c, keys, (v) => mixColor(v, color, amount));
}

function scaleBrightness(c: PackedColors, mul: number): PackedColors {
  if (mul === 1) return c;
  return mapColors(c, BRIGHTNESS_KEYS, (v) => pack(clampByte(colorR(v) * mul), clampByte(colorG(v) * mul), clampByte(colorB(v) * mul)));
}

const HUE_FULL = 360;
const HUE_SECTOR = 60;

/** 色相を deg 度回す（RGB → HSL → RGB。明度・彩度はそのまま） */
export function rotateHue(c: number, deg: number): number {
  const r = colorR(c) / BYTE_MAX;
  const g = colorG(c) / BYTE_MAX;
  const b = colorB(c) / BYTE_MAX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return c;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const hue = (((h * HUE_SECTOR + deg) % HUE_FULL) + HUE_FULL) % HUE_FULL;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / HUE_SECTOR) % 2) - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(hue / HUE_SECTOR);
  const [pr, pg, pb] =
    sector === 0 ? [chroma, x, 0] : sector === 1 ? [x, chroma, 0] : sector === 2 ? [0, chroma, x] : sector === 3 ? [0, x, chroma] : sector === 4 ? [x, 0, chroma] : [chroma, 0, x];
  return pack(clampByte((pr + m) * BYTE_MAX + HALF_BYTE), clampByte((pg + m) * BYTE_MAX + HALF_BYTE), clampByte((pb + m) * BYTE_MAX + HALF_BYTE));
}

// ---------------------------------------------------------------------------
// 様式の決定
// ---------------------------------------------------------------------------

/** 深度と、廃城でのバイオームの炎 / 霜から様式を決める */
export function styleFor(depth: number, floorKind: FloorKind): MapStyle {
  if (isFinalDepth(depth)) return "final";
  if (isDeepDepth(depth)) return "deep";
  const chapter = chapterOf(depth);
  if (chapter <= 1) return "moss";
  if (chapter === 2) return "temple";
  if (chapter === 3) return BIOME_DEFS[floorKind].castle === "frost" ? "castleFrost" : "castleFire";
  return "deep";
}

function mergeVariant(biome: BiomeDef, style: MapStyle): BiomeVariant {
  const extra = biome.byStyle?.[style];
  if (!extra) return biome.variant;
  return {
    ...biome.variant,
    ...extra,
    propWeight: { ...biome.variant.propWeight, ...extra.propWeight },
    flags: { ...biome.variant.flags, ...extra.flags },
    decalExtra: [...biome.variant.decalExtra, ...(extra.decalExtra ?? [])],
  };
}

function mergeFlags(base: MapThemeFlags, patch: Partial<MapThemeFlags>): MapThemeFlags {
  const out: MapThemeFlags = { ...base };
  for (const key of Object.keys(patch) as (keyof MapThemeFlags)[]) {
    if (patch[key] === true) out[key] = true;
  }
  return out;
}

function mergeProps(base: readonly PropWeight[], variant: BiomeVariant): PropWeight[] {
  const out: PropWeight[] = base.map((p) => ({ kind: p.kind, weight: GLOW_PROPS.has(p.kind) ? p.weight * variant.glowMul : p.weight }));
  for (const [kind, weight] of Object.entries(variant.propWeight) as [MapPropKind, number][]) {
    const found = out.find((p) => p.kind === kind);
    if (found) found.weight = weight;
    else out.push({ kind, weight });
  }
  return out;
}

function mergeDecals(base: readonly DecalKind[], variant: BiomeVariant): DecalKind[] {
  // 汚しの無い様式（最深の間）は足さない。墨と砂の 3 色の画を守る
  return base.length === 0 ? [] : [...base, ...variant.decalExtra];
}

function pitFor(style: MapStyle, floorKind: FloorKind): PitTheme {
  return style === "deep" ? "abyss" : PIT_OF_KIND[floorKind];
}

/** 深みの変異のうち色に出るもの（積む順）。system/runEvents の MUTATION_KEYS と同じ並び */
const MUTATION_ORDER = ["bloodMoon", "fog", "elementStorm"] as const;
type ColorMutation = (typeof MUTATION_ORDER)[number];

/**
 * この深度で効く変異（runEvents.mutationsFor と同じ規則）。runEvents を import すると
 * system の循環参照の読み込み順に巻き込まれ、単独で読む描画のテストが落ちるので、規則だけここに持つ。
 * 食い違いは mapTheme.test.ts が mutationsFor との一致で検査する
 */
export function colorMutationsFor(depth: number): ColorMutation[] {
  if (!isDeepDepth(depth)) return [];
  const count = 1 + Math.floor((deepFloorOf(depth) - 1) / DEEP.mutationEvery);
  return MUTATION_ORDER.slice(0, Math.min(count, MUTATION_ORDER.length));
}

/** 変異（深み）を掛けた配色と、暗さの加算を返す */
function applyMutations(colors: PackedColors, depth: number): { colors: PackedColors; darkAdd: number; tags: string[] } {
  let out = colors;
  let darkAdd = 0;
  const tags: string[] = [];
  for (const key of colorMutationsFor(depth)) {
    if (key === "bloodMoon") {
      out = packColors(BLOOD_COLORS);
      tags.push("blood");
    } else if (key === "fog") {
      out = tintColors(out, COLOR_KEYS, hexColor(FOG_TINT.color), FOG_TINT.amount);
      darkAdd += FOG_TINT.darkAdd;
      tags.push("fog");
    } else if (key === "elementStorm") {
      const deg = (deepFloorOf(depth) * STORM_HUE_STEP_DEG) % HUE_FULL;
      out = mapColors(out, COLOR_KEYS, (v) => rotateHue(v, deg));
      tags.push(`storm${deg}`);
    }
  }
  return { colors: out, darkAdd, tags };
}

const THEME_CACHE = new Map<string, MapTheme>();

/** 深度とバイオームからテーマを決める。同じ引数なら同じ（参照も同じ）テーマを返す */
export function mapThemeFor(depth: number, floorKind: FloorKind): MapTheme {
  const style = styleFor(depth, floorKind);
  const mutated = applyMutations(packColors(STYLE_DEFS[style].colors), depth);
  const key = [style, floorKind, ...mutated.tags].join(":");
  const cached = THEME_CACHE.get(key);
  if (cached) return cached;
  // 様式 deep は章 4 と深みで暗さが違うが、深みは変異が必ず 1 つ付くので key が分かれる（mapLight.test.ts が検査）
  const theme = buildTheme(key, style, floorKind, mutated.colors, mapDarkFor(style, depth) + mutated.darkAdd);
  THEME_CACHE.set(key, theme);
  return theme;
}

function buildTheme(key: string, style: MapStyle, floorKind: FloorKind, mutatedColors: PackedColors, dark: number): MapTheme {
  const def: StyleDef = STYLE_DEFS[style];
  const variant = mergeVariant(BIOME_DEFS[floorKind], style);
  let colors = mutatedColors;
  if (variant.tint) colors = tintColors(colors, TINT_KEYS, hexColor(variant.tint.color), variant.tint.amount);
  colors = scaleBrightness(colors, variant.brightness);
  const zone = variant.stoneZone !== undefined || variant.mossZone !== undefined ? { stone: variant.stoneZone ?? DEFAULT_STONE_ZONE, moss: variant.mossZone ?? DEFAULT_MOSS_ZONE } : undefined;
  return {
    key,
    style,
    floor: def.floor,
    top: def.top,
    side: def.side,
    corner: def.corner,
    cornerR: def.corner === "chamfer" ? CHAMFER_R : ROUND_R,
    sideH: def.sideH,
    edgeNoise: def.edgeNoise,
    voidBeyond: def.voidBeyond,
    dark,
    palette: derivePalette(colors),
    pit: pitFor(style, floorKind),
    props: mergeProps(def.props, variant),
    decals: mergeDecals(def.decals, variant),
    flags: mergeFlags(def.flags, variant.flags),
    ...(zone ? { floorZone: zone } : {}),
  };
}

/** 角の半径（ドット）。round 16 / chamfer 12（1-1 節） */
const ROUND_R = 16;
const CHAMFER_R = 12;
/** 苔の石畳の地帯と苔の斑の既定の閾値（見本の floorCobble） */
export const DEFAULT_STONE_ZONE = 0.42;
export const DEFAULT_MOSS_ZONE = 0.64;

/** 穴の色を詰めた形（焼き付けが使う）。奈落は null */
export interface PackedPitColors {
  a: number;
  deep: number;
  foam: number;
  rip: number;
  bank: number;
  mid: number;
  sheen: readonly number[];
  liquid: boolean;
}

export function packedPitColors(pit: PitTheme): PackedPitColors | null {
  if (pit === "abyss") return null;
  const c = PIT_COLORS[pit];
  const sheen = (c.sheen ?? [c.a]).map(hexColor);
  return {
    a: hexColor(c.a),
    deep: hexColor(c.deep),
    foam: hexColor(c.foam),
    rip: hexColor(c.rip),
    bank: hexColor(c.bank),
    mid: hexColor(c.mid ?? c.a),
    sheen,
    liquid: c.liquid,
  };
}
