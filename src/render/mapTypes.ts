// マップの見た目の一新（docs/ideas/map-visual-impl.md 1-1 節）の定数と型。
// 描画の作りの定数であってバランス数値ではないので TS に置く。
import type { GameMap } from "../map/grid";
import { TILE_SIZE } from "../map/grid";

/** 地図の密度（1 ドット = 論理 0.5px = 画面 2px） */
export const MAP_DOTS = 2;
/** 1 マスのドット数 */
export const TILE_DOTS = TILE_SIZE * MAP_DOTS;
/** チャンクの一辺のマス数（論理 256px） */
export const CHUNK_TILES = 16;
/** チャンクの一辺のドット数 */
export const CHUNK_DOTS = CHUNK_TILES * TILE_DOTS;
/** 手前の縁が床へ張り出す量（論理 3px） */
export const LIP_DOTS = 6;
/** 縁の層に積む、南の壁の天面の帯（論理 7px） */
export const LIP_TOP_DOTS = 14;
/** 1 フレームに焼くドット行。時間ではなく行で区切る（実時間に依存しない） */
export const BAKE_ROWS_PER_FRAME = 32;
/** 階の切り替えの黒帯中・画面内の未焼きがあるときの倍率 */
export const BAKE_ROWS_BOOST = 8;
/** 持つチャンクの上限（LRU） */
export const CHUNK_CACHE_MAX = 20;

export type MapStyle = "moss" | "temple" | "castleFire" | "castleFrost" | "deep" | "final";
export type FloorPattern = "cobble" | "slab" | "ashlar" | "glyph" | "sand";
export type TopPattern = "rock" | "mason" | "ink";
export type SidePattern = "rockside" | "stonewall" | "ashlarside" | "cliff" | "inkside";
export type PitTheme = "water" | "oil" | "lava" | "ice" | "ink" | "abyss";

/** 置物（2-3 節）。当たりを持たず、焼き付けで画素列へ直接描く */
export type MapPropKind =
  | "mush" // 茸
  | "skull" // 頭骨
  | "pebbles" // 小石の山
  | "rootClump" // 根の塊
  | "lantern" // 石灯籠
  | "jizo" // 地蔵
  | "hokora" // 祠
  | "scroll" // 経巻
  | "urn" // 骨壺
  | "bonePile" // 骨の山
  | "brazier" // 篝火
  | "armor" // 鎧
  | "spear" // 折れた槍
  | "crystal" // 氷晶
  | "orb" // 燐光の珠
  | "torii" // 逆さの鳥居
  | "floatRock" // 浮かぶ岩片
  | "andon" // 行灯
  | "stone" // 墨の石
  | "pillar" // 朱の柱
  | "glowMoss" // 蛍苔（側面）
  | "shimenawa" // 注連縄と紙垂（側面）
  | "banner" // 焼けた旗（側面）
  | "icicle" // 氷柱（側面）
  | "scripture"; // 金の経文（側面）

/** 床に描く汚し（2-2・2-3 節） */
export type DecalKind =
  | "pebble"
  | "crack"
  | "moss"
  | "root"
  | "bones"
  | "scorch"
  | "ember"
  | "frost"
  | "glyph"
  | "mud"
  | "grass"
  | "rail";

/** 色はすべて ImageData 用に詰めた 32bit（ABGR、`mapNoise.ts` の pack と同じ） */
export interface MapPalette {
  fD: number;
  fB: number;
  fL: number;
  fH: number;
  fO: number;
  tB: number;
  tD: number;
  tL: number;
  sB: number;
  sL: number;
  sD: number;
  v1: number;
  v2: number;
  vD: number;
  light: number;
  lightDim: number;
  accent: number;
  accL: number;
  accD: number;
  moss1: number;
  moss2: number;
  wood: number;
  soot: number;
  snow: number;
  stoneL: number;
  stoneB: number;
  stoneD: number;
}

export interface MapThemeFlags {
  drips: boolean;
  soot: boolean;
  frost: boolean;
  sideMoss: boolean;
  shimenawa: boolean;
  redPillar: boolean;
  beams: boolean;
  banners: boolean;
  icicles: boolean;
  shafts: boolean;
}

export interface MapTheme {
  /** チャンクのキャッシュの鍵（style + floorKind + 変異） */
  key: string;
  style: MapStyle;
  floor: FloorPattern;
  top: TopPattern;
  side: SidePattern;
  corner: "round" | "chamfer";
  /** 角の半径（ドット）。round 16 / chamfer 12 */
  cornerR: number;
  /** 側面の高さ（ドット） */
  sideH: 16 | 24 | 32;
  /** 縁の揺らぎの振幅（ドット）。洞窟 3 / 人工物 0 */
  edgeNoise: number;
  /** 岩盤の奥を奈落に描く（章 4・深み） */
  voidBeyond: boolean;
  /** 章の暗さ（MAP_LIGHT から引く） */
  dark: number;
  palette: MapPalette;
  pit: PitTheme;
  props: readonly { kind: MapPropKind; weight: number }[];
  decals: readonly DecalKind[];
  flags: MapThemeFlags;
}

/** 光源。座標と半径は論理 px、color は CSS の色文字列 */
export interface MapLight {
  x: number;
  y: number;
  r: number;
  strength: number;
  color: string;
}

/** ground / lip は CHUNK_DOTS * CHUNK_DOTS の行優先。lip の 0 は透明 */
export interface BakeOutput {
  ground: Uint32Array;
  lip: Uint32Array;
  lights: MapLight[];
}

/** 行カーソルを持つ焼き付け。step の行数をどう刻んでも result は同じになる */
export interface ChunkBakeJob {
  readonly done: boolean;
  step(rows: number): void;
  result(): BakeOutput;
}

export interface ChunkBakeInput {
  map: GameMap;
  /** チャンク座標（マスの座標 / CHUNK_TILES） */
  cx: number;
  cy: number;
  theme: MapTheme;
  /** マスごとの「置物を置かない」印（地図と同じ並び）。段 2 の置物の配置が読む */
  exclude?: Uint8Array;
}
