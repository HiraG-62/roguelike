import type { FloorKind } from "../core/state";

/**
 * 穴（Tile.Pit）の仮の見た目。章（floorKind）の深い地形の色で塗り、深み（`isDeepDepth`）は奈落にする。
 * 形の良い絵は別の段（dual-grid）で作るので、ここは本体色・縁の色・ミニマップの色だけ返す純関数
 */

type Rgb = readonly [number, number, number];

export type PitTheme = "abyss" | "water" | "oil" | "lava" | "ice" | "ink";

export interface PitLook {
  theme: PitTheme;
  /** 穴の中の色（CSS） */
  body: string;
  /** 縁の 1px の帯の色（CSS） */
  edge: string;
  /** ミニマップの色 */
  mini: Rgb;
}

/** 深い地形の色（docs/ideas/previews/map-preview.html の TER.deep に倣う） */
const BLACK: Rgb = [11, 10, 15];
const THEME_COLOR: Readonly<Record<PitTheme, Rgb>> = {
  abyss: BLACK,
  water: [46, 90, 120],
  oil: [28, 24, 22],
  // 溶岩は穴でも光って見えるよう、深い側の明るい橙を使う
  lava: [255, 122, 42],
  ice: [106, 152, 188],
  ink: [20, 18, 22],
};
/** 奈落は本体がほぼ黒なので、縁は黒より少し明るい暗色にして穴の輪郭を残す */
const ABYSS_EDGE: Rgb = [30, 28, 40];
/** 本体を黒へ寄せる量（地形の深さの表現） */
const BODY_DARKEN = 0.18;
/** 縁は本体より一段暗くして段差に見せる */
const EDGE_DARKEN = 0.45;
/** ミニマップでは床や壁と区別できるよう背景へ強く寄せる（preview の pitC） */
const MINI_DARKEN = 0.45;

/** 章 → 穴の地形。苔・回廊・洞窟・沼・草原は水、寺院（墓所）・坑道は油、熔鉱炉は溶岩、氷窟は氷、暗闇は墨 */
const THEME_OF_KIND: Readonly<Record<FloorKind, PitTheme>> = {
  rooms: "water",
  cave: "water",
  dark: "ink",
  forge: "lava",
  ossuary: "oil",
  swamp: "water",
  glacier: "ice",
  mine: "oil",
  meadow: "water",
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

function css(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function pitTheme(floorKind: FloorKind, deep: boolean): PitTheme {
  return deep ? "abyss" : THEME_OF_KIND[floorKind];
}

function buildLook(theme: PitTheme): PitLook {
  const base = THEME_COLOR[theme];
  if (theme === "abyss") return { theme, body: css(BLACK), edge: css(ABYSS_EDGE), mini: ABYSS_EDGE };
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

/** 章と深みかどうかから穴の色を返す（毎フレーム呼んでよいよう事前に作ったものを返す） */
export function pitLook(floorKind: FloorKind, deep: boolean): PitLook {
  return LOOKS[pitTheme(floorKind, deep)];
}
