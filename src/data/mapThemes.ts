// マップの見た目のテーマの表（docs/ideas/map-visual-impl.md 2-1・2-2 節）。
// 色・様式・バイオームの寄せ・穴の色。派生色の計算や深みの変異は render/mapTheme.ts。
// 章の暗さ（dark）は MAP_LIGHT.json（feel/）の値を render/mapLight.ts の mapDarkFor が引く
import type { FloorKind } from "../core/state";
import type {
  DecalKind,
  FloorPattern,
  MapPropKind,
  MapStyle,
  MapThemeFlags,
  PitTheme,
  SidePattern,
  TopPattern,
} from "../render/mapTypes";

/** 配色の入力（16 進）。fD / fB / fL = 床の暗・基本・明、top = 天面、side = 側面 */
export interface StyleColors {
  fD: string;
  fB: string;
  fL: string;
  top: string;
  side: string;
  light: string;
  accent: string;
  moss1: string;
  moss2: string;
  wood: string;
}

export interface PropWeight {
  kind: MapPropKind;
  weight: number;
}

export interface StyleDef {
  floor: FloorPattern;
  top: TopPattern;
  side: SidePattern;
  corner: "round" | "chamfer";
  sideH: 16 | 24 | 32;
  edgeNoise: number;
  voidBeyond: boolean;
  colors: StyleColors;
  props: readonly PropWeight[];
  decals: readonly DecalKind[];
  flags: MapThemeFlags;
}

const NO_FLAGS: MapThemeFlags = {
  drips: false,
  soot: false,
  frost: false,
  sideMoss: false,
  shimenawa: false,
  redPillar: false,
  beams: false,
  banners: false,
  icicles: false,
  shafts: false,
};

/** 章の様式（2-1 節の表。配色は見本の THEMES の c と同じ） */
export const STYLE_DEFS: Readonly<Record<MapStyle, StyleDef>> = {
  moss: {
    floor: "cobble",
    top: "rock",
    side: "rockside",
    corner: "round",
    sideH: 16,
    edgeNoise: 3,
    voidBeyond: false,
    colors: { fD: "#2f3530", fB: "#3d4540", fL: "#4d5a4c", top: "#56604a", side: "#262b25", light: "#c8e878", accent: "#4a8cb0", moss1: "#4a6238", moss2: "#65823f", wood: "#5a4632" },
    props: [
      { kind: "mush", weight: 5 },
      { kind: "skull", weight: 2 },
      { kind: "pebbles", weight: 2 },
      { kind: "rootClump", weight: 1 },
    ],
    decals: ["pebble", "moss", "crack", "root", "pebble"],
    flags: { ...NO_FLAGS, drips: true, sideMoss: true },
  },
  temple: {
    floor: "slab",
    top: "mason",
    side: "stonewall",
    corner: "chamfer",
    sideH: 32,
    edgeNoise: 0,
    voidBeyond: false,
    colors: { fD: "#3a3230", fB: "#4a403c", fL: "#5c5048", top: "#6e6258", side: "#2c2420", light: "#ffb45a", accent: "#b0342c", moss1: "#4e4a3a", moss2: "#5e5842", wood: "#6a4a30" },
    props: [
      { kind: "lantern", weight: 4 },
      { kind: "jizo", weight: 3 },
      { kind: "hokora", weight: 1 },
      { kind: "scroll", weight: 2 },
      { kind: "urn", weight: 1 },
    ],
    decals: ["crack", "pebble", "bones", "crack"],
    flags: { ...NO_FLAGS, shimenawa: true, redPillar: true },
  },
  castleFire: {
    floor: "ashlar",
    top: "mason",
    side: "ashlarside",
    corner: "chamfer",
    sideH: 32,
    edgeNoise: 0,
    voidBeyond: false,
    colors: { fD: "#33241f", fB: "#45302a", fL: "#5a3c30", top: "#5e4a40", side: "#221612", light: "#ff7a2a", accent: "#ffd05a", moss1: "#2a1a14", moss2: "#1a110d", wood: "#4a3020" },
    props: [
      { kind: "brazier", weight: 4 },
      { kind: "spear", weight: 3 },
      { kind: "armor", weight: 2 },
      { kind: "skull", weight: 2 },
    ],
    decals: ["scorch", "crack", "ember", "crack"],
    flags: { ...NO_FLAGS, soot: true, banners: true },
  },
  castleFrost: {
    floor: "ashlar",
    top: "mason",
    side: "ashlarside",
    corner: "chamfer",
    sideH: 32,
    edgeNoise: 0,
    voidBeyond: false,
    colors: { fD: "#2c3444", fB: "#3a4458", fL: "#4c5a70", top: "#6a7c96", side: "#1e2432", light: "#b8e4ff", accent: "#e8f4ff", moss1: "#8aa4c0", moss2: "#c8d8e8", wood: "#4a4a58" },
    props: [
      { kind: "crystal", weight: 4 },
      { kind: "spear", weight: 2 },
      { kind: "skull", weight: 1 },
    ],
    decals: ["frost", "crack", "frost"],
    flags: { ...NO_FLAGS, frost: true, icicles: true },
  },
  deep: {
    floor: "glyph",
    top: "rock",
    side: "cliff",
    corner: "round",
    sideH: 24,
    edgeNoise: 3,
    voidBeyond: true,
    colors: { fD: "#241f30", fB: "#302a40", fL: "#3e3654", top: "#4c4266", side: "#17131f", light: "#b27cff", accent: "#d8b04a", moss1: "#5a3a8a", moss2: "#3a2658", wood: "#3a3048" },
    props: [
      { kind: "orb", weight: 3 },
      { kind: "lantern", weight: 2 },
      { kind: "skull", weight: 1 },
    ],
    decals: ["glyph", "crack", "crack"],
    flags: NO_FLAGS,
  },
  final: {
    floor: "sand",
    top: "ink",
    side: "inkside",
    corner: "round",
    sideH: 24,
    edgeNoise: 1,
    voidBeyond: false,
    colors: { fD: "#5a564e", fB: "#6a665c", fL: "#7a7466", top: "#2a282c", side: "#141216", light: "#f0ece0", accent: "#c83a2a", moss1: "#4a4640", moss2: "#8a8474", wood: "#2a282c" },
    props: [
      { kind: "stone", weight: 4 },
      { kind: "andon", weight: 2 },
      { kind: "pillar", weight: 2 },
    ],
    decals: [],
    flags: NO_FLAGS,
  },
  // 拠点（門前町）。宵の土・塀と崖。置物は置かず、汚しは小石とひびだけ。灯の色は提灯の暖色、差し色は鳥居の朱
  town: {
    floor: "cobble",
    top: "rock",
    side: "rockside",
    corner: "round",
    sideH: 16,
    edgeNoise: 2,
    voidBeyond: false,
    colors: { fD: "#2a2226", fB: "#3a3036", fL: "#4a3f43", top: "#4c4553", side: "#1f1a24", light: "#ffcf8a", accent: "#c0382e", moss1: "#3a4634", moss2: "#4c5c40", wood: "#5a4030" },
    props: [],
    decals: ["pebble", "crack", "pebble"],
    flags: NO_FLAGS,
  },
};

/** 拠点の参道・辻の石畳の配色（石は土より明るく青みがかる。宵の灯が当たる想定）。床の模様は切石（ashlar） */
export const TOWN_ROAD_COLORS: StyleColors = {
  fD: "#2c2a36",
  fB: "#4c4a5c",
  fL: "#625f74",
  top: "#4c4553",
  side: "#1f1a24",
  light: "#ffcf8a",
  accent: "#c0382e",
  moss1: "#3a4634",
  moss2: "#4c5c40",
  wood: "#5a4030",
};

/** 深みの変異「血の月」の配色（見本の THEMES の blood）。様式の配色をまるごと置き換える */
export const BLOOD_COLORS: StyleColors = {
  fD: "#2e1c22",
  fB: "#3c262c",
  fL: "#50323a",
  top: "#603844",
  side: "#1c1014",
  light: "#e8927a",
  accent: "#d8b04a",
  moss1: "#7a2a36",
  moss2: "#4a121c",
  wood: "#3a2228",
};

/** 変異「霧」: 全色を寄せる色・量と、暗さの加算 */
export const FOG_TINT = { color: "#c8c8d0", amount: 0.18, darkAdd: 0.05 } as const;

/** 変異「属性の嵐」: 深みの 1 層ごとに色相を回す角度（度。深度で決まるので決定的） */
export const STORM_HUE_STEP_DEG = 40;

export interface BiomeVariant {
  /** 床・天面の色へ寄せる色と量（なし = null） */
  tint: { color: string; amount: number } | null;
  /** 床・天面・側面の明度の倍率 */
  brightness: number;
  /** 光る置物（灯籠・篝火・氷晶・燐光の珠・行灯・祠・茸）の重みの倍率 */
  glowMul: number;
  /** 汚しの候補に足すもの（同じ種類を重ねると出やすくなる） */
  decalExtra: readonly DecalKind[];
  /** 置物の重みの上書き（様式に無い置物は足す） */
  propWeight: Partial<Record<MapPropKind, number>>;
  /** 立てる印（true だけを重ねる） */
  flags: Partial<MapThemeFlags>;
  /** 苔の石畳の「土の地帯」の閾値（小さいほど石畳が広い）。既定は見本の 0.42 */
  stoneZone?: number;
  /** 苔の斑の閾値（小さいほど苔が広い）。既定は見本の 0.64 */
  mossZone?: number;
}

const BASE_VARIANT: BiomeVariant = { tint: null, brightness: 1, glowMul: 1, decalExtra: [], propWeight: {}, flags: {} };

/** 光る置物（暗いバイオームで半分に減らす） */
export const GLOW_PROPS: ReadonlySet<MapPropKind> = new Set<MapPropKind>(["mush", "lantern", "hokora", "brazier", "crystal", "orb", "andon"]);

export interface BiomeDef {
  /** 章 3（廃城）の炎 / 霜（2-2 節の表） */
  castle: "fire" | "frost";
  variant: BiomeVariant;
  /** 様式ごとの追加の寄せ（章 1 の石畳の地帯・章 2 の朱の柱など） */
  byStyle?: Partial<Record<MapStyle, Partial<BiomeVariant>>>;
}

/** 石畳の地帯を広げる土の地帯の閾値（見本の 0.42 より小さく）。仕様の「0.42 → 0.6」は石畳側の値で、本実装は土の閾値で持つ */
const WIDE_STONE_ZONE = 0.25;
/** 苔の斑を広げる閾値（見本の 0.64 より小さく） */
const WIDE_MOSS_ZONE = 0.5;

export const BIOME_DEFS: Readonly<Record<FloorKind, BiomeDef>> = {
  cave: { castle: "frost", variant: BASE_VARIANT },
  rooms: {
    castle: "fire",
    variant: BASE_VARIANT,
    byStyle: { moss: { stoneZone: WIDE_STONE_ZONE }, temple: { propWeight: { pillar: 2 } } },
  },
  dark: { castle: "fire", variant: { ...BASE_VARIANT, brightness: 0.8, glowMul: 0.5 } },
  forge: {
    castle: "fire",
    variant: { ...BASE_VARIANT, tint: { color: "#b0401c", amount: 0.12 }, decalExtra: ["ember", "scorch"], flags: { soot: true } },
  },
  ossuary: {
    castle: "fire",
    variant: { ...BASE_VARIANT, tint: { color: "#e0d8c0", amount: 0.1 }, decalExtra: ["bones", "bones"] },
    byStyle: { temple: { propWeight: { urn: 3 } } },
  },
  swamp: {
    castle: "frost",
    variant: { ...BASE_VARIANT, tint: { color: "#3c7040", amount: 0.12 }, decalExtra: ["mud", "moss"], mossZone: WIDE_MOSS_ZONE },
  },
  glacier: {
    castle: "frost",
    variant: { ...BASE_VARIANT, tint: { color: "#80b8e0", amount: 0.15 }, decalExtra: ["frost"], flags: { frost: true } },
  },
  mine: {
    castle: "fire",
    variant: { ...BASE_VARIANT, tint: { color: "#5a4028", amount: 0.12 }, decalExtra: ["rail"], flags: { beams: true } },
  },
  meadow: {
    castle: "frost",
    variant: { ...BASE_VARIANT, tint: { color: "#60a048", amount: 0.12 }, decalExtra: ["grass", "grass"] },
    byStyle: { moss: { flags: { shafts: true } } },
  },
};

/** 穴の色（見本の TER）。奈落は様式の配色（palette）から塗るので持たない */
export interface PitColors {
  a: string;
  deep: string;
  foam: string;
  rip: string;
  bank: string;
  /** 溶岩の中間色 */
  mid?: string;
  /** 油の虹の膜 */
  sheen?: readonly string[];
  /** 液体か（北の縁を bank 色の帯にする） */
  liquid: boolean;
}

export const PIT_COLORS: Readonly<Record<Exclude<PitTheme, "abyss">, PitColors>> = {
  water: { a: "#4a8cb0", deep: "#2e5a78", foam: "#9ccbe0", rip: "#72b0d0", bank: "#1e2a2c", liquid: true },
  oil: { a: "#2a2420", deep: "#1c1816", foam: "#6a5a9a", rip: "#3a8a7a", bank: "#16110f", sheen: ["#7a62a8", "#3a8a7a", "#a89a48"], liquid: true },
  // 見本の #e0561e は予告の赤（#ff4040）との RGB 距離が 51 しかなく、広い面を占めるので少し沈める
  lava: { a: "#c8461a", deep: "#ff7a2a", foam: "#1a0e0a", rip: "#ffd05a", bank: "#140a08", mid: "#a8341a", liquid: true },
  ice: { a: "#8ab8d8", deep: "#6a98bc", foam: "#e8f4ff", rip: "#b8e4ff", bank: "#2a3448", liquid: false },
  ink: { a: "#1e1c20", deep: "#141216", foam: "#3a3834", rip: "#f0ece0", bank: "#4a463e", liquid: true },
};

/** バイオーム → 穴の地形（章 4・深みは奈落になるので mapTheme 側で上書き）。render/pitLook.ts の今の対応と同じ */
export const PIT_OF_KIND: Readonly<Record<FloorKind, Exclude<PitTheme, "abyss">>> = {
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
