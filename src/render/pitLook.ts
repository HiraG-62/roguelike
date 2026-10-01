import type { FloorKind } from "../core/state";
import { PIT_COLORS, PIT_OF_KIND } from "../data/mapThemes";
import { colorB, colorG, colorR, hexColor, mapThemeFor } from "./mapTheme";
import type { PitTheme } from "./mapTypes";

/**
 * 穴（Tile.Pit）の色。穴の種類は `MapTheme.pit`（章 4・深みは奈落、それ以外はバイオームの対応）を正にし、
 * 色の表は `data/mapThemes.ts` の `PIT_COLORS` の deep 色から引く（ここに二重に持たない）。
 * 地図の焼き付けは `packedPitColors` を直接使う。ここはミニマップ・地形の層・拠点の仮描きのための本体色・縁の色・ミニマップの色
 */

type Rgb = readonly [number, number, number];

export type { PitTheme };

export interface PitLook {
  theme: PitTheme;
  /** 穴の中の色（CSS） */
  body: string;
  /** 縁の 1px の帯の色（CSS） */
  edge: string;
  /** ミニマップの色 */
  mini: Rgb;
}

const BLACK: Rgb = [11, 10, 15];
/** 奈落は本体がほぼ黒なので、縁は黒より少し明るい暗色にして穴の輪郭を残す */
const ABYSS_EDGE: Rgb = [30, 28, 40];
/** 本体を黒へ寄せる量（地形の深さの表現） */
const BODY_DARKEN = 0.18;
/** 縁は本体より一段暗くして段差に見せる */
const EDGE_DARKEN = 0.45;
/** ミニマップでは床や壁と区別できるよう背景へ強く寄せる（preview の pitC） */
const MINI_DARKEN = 0.45;

/** 穴の地形の深い側の色（PIT_COLORS.deep。溶岩は穴でも光って見えるよう、深い側の明るい橙になる） */
function deepColor(theme: Exclude<PitTheme, "abyss">): Rgb {
  const c = hexColor(PIT_COLORS[theme].deep);
  return [colorR(c), colorG(c), colorB(c)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

function css(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function buildLook(theme: PitTheme): PitLook {
  if (theme === "abyss") return { theme, body: css(BLACK), edge: css(ABYSS_EDGE), mini: ABYSS_EDGE };
  const base = deepColor(theme);
  return { theme, body: css(mix(base, BLACK, BODY_DARKEN)), edge: css(mix(base, BLACK, EDGE_DARKEN)), mini: mix(base, BLACK, MINI_DARKEN) };
}

const LOOKS: Readonly<Record<PitTheme, PitLook>> = {
  abyss: buildLook("abyss"),
  water: buildLook("water"),
  oil: buildLook("oil"),
  lava: buildLook("lava"),
  ice: buildLook("ice"),
  ink: buildLook("ink"),
};

/** 穴の種類の見た目（毎フレーム呼んでよいよう事前に作ったものを返す） */
export function pitLookOf(theme: PitTheme): PitLook {
  return LOOKS[theme];
}

/** この階の穴の種類。地図のテーマ（`mapThemeFor`）と必ず一致する */
export function pitThemeAt(depth: number, floorKind: FloorKind): PitTheme {
  return mapThemeFor(depth, floorKind).pit;
}

/** この階の穴の見た目 */
export function pitLookAt(depth: number, floorKind: FloorKind): PitLook {
  return LOOKS[pitThemeAt(depth, floorKind)];
}

/**
 * 深さを持たない旧い呼び方（拠点の仮描き `Renderer.drawPit` 用。段 3 でそちらを捨てるときに一緒に消す）。
 * 章 4 の奈落は表せないので、迷宮の描画は `pitLookAt` / `pitThemeAt` を使う
 */
export function pitTheme(floorKind: FloorKind, deep: boolean): PitTheme {
  return deep ? "abyss" : PIT_OF_KIND[floorKind];
}

export function pitLook(floorKind: FloorKind, deep: boolean): PitLook {
  return LOOKS[pitTheme(floorKind, deep)];
}
