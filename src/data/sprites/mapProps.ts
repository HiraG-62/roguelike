/**
 * マップの置物の絵（docs/ideas/map-visual-impl.md 2-3 節・4 章 L5）。密度 2（論理 1px = 2 ドット）。
 * 当たりを持たず、チャンクの焼き付け（mapDecor.ts）が画素列へ直接描く。
 *
 * 色は PALETTE ではなく「役の文字」（MAP_PROP_ROLES）で書き、焼き付けがテーマの MapPalette から色を当てる。
 * 同じ石灯籠が章 2 では灰褐色と橙の灯、章 4 では紫の石と燐光になる。SPRITES には合流しない（PALETTE の文字ではないため）。
 *
 * 座標はすべて絵の左上からのドット。地面の点 (x, y)（ドット）に置くときは left = x - anchor[0]、top = y - anchor[1]。
 * 光の半径・色・強さは mapDecor.ts（L4）が持ち、ここは光の中心の位置だけを持つ。
 * 光源は左上（様式書 2 章）。左右反転して置くと陰影が逆になるので、反転しない前提で描いている。
 *
 * キー: mush / skull / pebbles / rootClump / bonePile（章 1・行き止まり）、lantern / jizo / hokora / scroll / urn（章 2）、
 * brazier / armor / crystal（章 3）、orb / torii（章 4）、andon（最深の間）。
 * 朱の柱・墨の石・折れた槍・浮かぶ岩片と側面の飾りは手続きで描く（mapDecor.ts）
 */
import type { MapPalette, MapPropKind } from "../../render/mapTypes";

/** 透明の文字 */
export const MAP_PROP_CLEAR = ".";

/** 役の色の出どころ: MapPalette のキーか、テーマに依らない固定色 */
export type MapPropRoleSource = keyof MapPalette | `#${string}`;

export interface MapPropRole {
  readonly from: MapPropRoleSource;
  /** 正なら白へ、負なら黒へ寄せる割合（-1..1）。0 はそのまま */
  readonly shade: number;
}

/**
 * 役の文字 → 色の出どころ。段は左の列ほど明るい（例: 石は H → S → B → D → E）。
 * 骨・鉄・紙は章で色が変わると読めなくなるので固定色にする
 */
export const MAP_PROP_ROLES = {
  k: { from: "#1a1a24", shade: 0 }, // 輪郭（MapPropSprite.outline で差し替えられる）
  H: { from: "stoneL", shade: 0.22 }, // 石のハイライト
  S: { from: "stoneL", shade: 0 }, // 石の明
  B: { from: "stoneB", shade: 0 }, // 石の基本
  D: { from: "stoneD", shade: 0 }, // 石の暗
  E: { from: "stoneD", shade: -0.4 }, // 石の最暗（軒下・奥まった所）
  Y: { from: "light", shade: 0.6 }, // 光の芯
  L: { from: "light", shade: 0 }, // 光
  l: { from: "lightDim", shade: 0 }, // 光の縁
  A: { from: "accL", shade: 0 }, // 差し色の明
  R: { from: "accent", shade: 0 }, // 差し色
  r: { from: "accD", shade: 0 }, // 差し色の暗
  T: { from: "wood", shade: 0.25 }, // 木の明
  W: { from: "wood", shade: 0 }, // 木
  V: { from: "wood", shade: -0.4 }, // 木の暗
  O: { from: "#e8e2d0", shade: 0 }, // 骨の明
  w: { from: "#c8c0a8", shade: 0 }, // 骨
  o: { from: "#8a8070", shade: 0 }, // 骨の暗
  G: { from: "#7a7680", shade: 0 }, // 鉄の明
  I: { from: "#4a464c", shade: 0 }, // 鉄
  i: { from: "#2a272c", shade: 0 }, // 鉄の暗（祠の奥・面頬・鳥居の笠木）
  P: { from: "#ece4cc", shade: 0 }, // 紙
  p: { from: "#b0a488", shade: 0 }, // 紙の暗
  m: { from: "moss2", shade: 0 }, // 苔の明（章 1 の根の塊だけ。moss2 が明るいのは章 1 の配色）
  M: { from: "moss1", shade: 0 }, // 苔
} as const satisfies Readonly<Record<string, MapPropRole>>;

export type MapPropRoleChar = keyof typeof MAP_PROP_ROLES;

/** 絵で描く置物（MapPropKind のうち手続きで描かないもの） */
export type MapPropSpriteKind = Extract<
  MapPropKind,
  | "mush"
  | "skull"
  | "pebbles"
  | "rootClump"
  | "bonePile"
  | "lantern"
  | "jizo"
  | "hokora"
  | "scroll"
  | "urn"
  | "brazier"
  | "armor"
  | "crystal"
  | "orb"
  | "torii"
  | "andon"
>;

export interface MapPropSprite {
  /** 行の文字列（全行同じ幅）。'.' は透明、それ以外は MAP_PROP_ROLES の文字 */
  readonly rows: readonly string[];
  /** 足元の点。y は絵の高さ（最下段のすぐ下）。浮く物（orb）は絵より下の地面を指す */
  readonly anchor: readonly [number, number];
  /** 光の中心（光る物だけ） */
  readonly light?: readonly [number, number];
  /** 足元の影の横半径（ドット）。0 は影を落とさない（奈落の鳥居） */
  readonly shadow: number;
  /** 輪郭 k の代わりに当てる色（奈落に浮かぶ物は奈落の色で縁取って沈める） */
  readonly outline?: keyof MapPalette;
}

export const MAP_PROP_SPRITES: Readonly<Record<MapPropSpriteKind, MapPropSprite>> = {
  mush: {
    rows: [
      "....................",
      ".....kkkkk..........",
      "...kkYYYYYkk........",
      "..kYYYYYYYYLk.......",
      ".kYYYYYYYYYLLk......",
      ".kYYYYYYYYLLLk......",
      ".kYYLYYYYLLLlk......",
      ".kYYYYYLLLLllkkkkk..",
      "..klllllllllklYYYkk.",
      "...kklllllkkYYYYYLkk",
      ".....kkkkkkYYYYLLLlk",
      ".kkkkkOwok.kllllllk.",
      ".kYYYkOwok..kkkkkk..",
      ".kYYLkOwok...kOwk...",
      ".kkkkkOwok...kOwk...",
      "..kwkkOwok...kOwk...",
      "...k..kkk.....kk....",
    ],
    anchor: [8, 17], light: [7, 6], shadow: 7,
  },
  skull: {
    rows: [
      "..................",
      "....kkkkkk........",
      "...kOOOOOOk.......",
      "..kOOOOOOOwk......",
      ".kOOOOOOOOwwk.....",
      ".kOOOOOOOwwwk.....",
      ".kOkkOOOkkwok.....",
      ".kOkkOwwkkook..kk.",
      "..kwwwkwwook..kOOk",
      "...kwwwoook..kkOOk",
      "...kowooook.kwwkk.",
      "....kkkkkk.kwwk...",
      "...........kwk....",
      "............k.....",
    ],
    anchor: [7, 14], shadow: 7,
  },
  pebbles: {
    rows: [
      "......................",
      "......................",
      "........kkkkk.........",
      ".......kHHHHSk........",
      "...kkkkHHHHHSBk.......",
      ".kkHHHkHHHHSBDkkkkk...",
      ".kHHHHkSSSSBDDkHHSBk..",
      "kSHHHSSkBBBDEkHHSSkkk.",
      ".kSSSBBDkkkkkSSSBkHHSk",
      ".kkBBDDEkHHBkBBBDkSBDk",
      "...kkkkkkBBEkkkkkkkkk.",
      ".........kkk..........",
    ],
    anchor: [11, 12], shadow: 9,
  },
  rootClump: {
    rows: [
      "............k...............",
      "......k....kTk..............",
      ".....kTk..kTWTk......kk.....",
      "....kTWTk.kTWVk....kkTTk....",
      ".....kTWmk.kTWTk..kTTWWTk...",
      "......kmmMkkTWVk.kTWWVWWTk..",
      ".......kMWTkTWVkkTWWVkTVk...",
      ".......kTWWTWWVkTWWVk.kk....",
      "........kTWWWWVkTWVk........",
      ".........kmmmmmTWVk.........",
      "........kmmmmmmmWVkk........",
      "......kkTTmmmmMWWWTTkk......",
      "...kkkTTWWWWWWWWWWWWTTkkk...",
      "..kTTTWWWWWWWWWWWWWWWWTTTk..",
      ".kTWWWWVVVVVVVVVVVVVVVWWWTk.",
      "..kTVVVkkkkkkkkkkkkkkkTVVk..",
      "...kkkk...............kkk...",
    ],
    anchor: [14, 17], shadow: 10,
  },
  bonePile: {
    rows: [
      "..........................",
      "..........................",
      "...............kk.........",
      ".............kkOOkk.......",
      "............kOOOOOwk......",
      ".........kkkOOOOOOwwk.....",
      "........kOwkOOkOOkwok.....",
      "....kkkkOOwkOOkOwkwokkkk..",
      "...kOwwwkwwwkwwwoookwwwOk.",
      "..kOOwwwwkkkkkkookkwwwOOwk",
      "...kwkkkk.....kkkkkkkkkwk.",
      "..kkkkkkkkkkkkkkkkkkkkkk..",
      ".kOwwwwwwwkOwwwwwwwwwwwOk.",
      "kOOwwwwwwkOOwwwwwwwwwwOOwk",
      ".kwkkkkkkkkwkkkkkkkkkkkwk.",
      "..k........k...........k..",
    ],
    anchor: [13, 16], shadow: 10,
  },
  lantern: {
    rows: [
      "....................",
      "........kkkk........",
      "........kHHk........",
      ".......kHHSBk.......",
      ".......kSSBDk.......",
      ".......kkBDkk.......",
      ".....kkHHHSBDkk.....",
      ".k.kkHHHHSSBBDDkk.k.",
      "kSkHHHSSSBBBDDDEEkDk",
      "kHHHHSSSSBBBDDDDEEEk",
      "kHHHHSSSSBBBDDDDEEEk",
      ".kkEEEEEEEEEEEEEEkk.",
      "...kHHHHHSSSBBDDk...",
      "...kHHHLLLLLlDEEk...",
      "...kHHHLLYYLlDEEk...",
      "...kHHHLLYYLlDEEk...",
      "...kHHHLLYYLlDEEk...",
      "...kHHHLLYYLlDEEk...",
      "...kHHHllllllDEEk...",
      "..kkHHHSSBBBDDEEkk..",
      ".kHHHHHHHSSSBBBDDDk.",
      ".kHHHHSSSBBBDDDEEEk.",
      ".kHEEEEEEEEEEEEEEEk.",
      "..kkkkkHHSBDEkkkkk..",
      "......kHHSBDEk......",
      "......kHHSBDEk......",
      "......kHHSBDEk......",
      "......kEEEEEEk......",
      "......kHHSBDEk......",
      "......kHHSBDEk......",
      "......kHHSBDEk......",
      "....kkkHHSBDEkkk....",
      "...kHHHHHSSSBBDDk...",
      "..kkHHHSSBBBDDEEkk..",
      ".kHHHHHHHSSSBBBDDDk.",
      ".kHHHHSSSBBBDDDEEEk.",
      ".kHHHHSSSBBBDDDEEEk.",
      "..kkkkkkkkkkkkkkkk..",
    ],
    anchor: [10, 38], light: [10, 16], shadow: 9,
  },
  jizo: {
    rows: [
      "................",
      "................",
      "......kkkk......",
      ".....kHHHHk.....",
      "....kHHHHHSk....",
      "....kHHHHSSk....",
      "...kHHDHHDBDk...",
      "...kSHHSSBBEk...",
      "....kSSDBBDk....",
      "....kkBBBDkk....",
      "...kkkkkkkkkk...",
      "..kAAAARRRrrrk..",
      "..kAAAARRRrrrk..",
      "...kAAARRRrrk...",
      "...kHAARRrrBk...",
      "..kHHHHHHSSBDk..",
      "..kHHHHHSSBBDk..",
      "..kHHHHHSSBBDk..",
      "..kSHHDSBDBDDk..",
      "..kSSSSSBBBDEk..",
      "...kSSSBBBDDk...",
      "...kBBBBBDDEk...",
      "....kBBDDDEk....",
      ".kkkkkkkkkkkkkk.",
      "kHHHSSSBBBDDDEEk",
      "kHHHSSSBBBDDDEEk",
      ".kkkkkkkkkkkkkk.",
    ],
    anchor: [8, 27], shadow: 7,
  },
  hokora: {
    rows: [
      ".........k..........k.........",
      "........kWk........kVk........",
      ".........kWk......kVVk........",
      "..........kWkkkkkkVVk.........",
      ".........kTTTTTTTTTTk.........",
      "........kTWWWWWWWWWWWkk.......",
      "......kkTTTTTTTTTTWWWWWk......",
      ".....kTVVVVVVVVVVVVVVVVVkk....",
      "...kkTTTTTTTWWWWWWWVVVVVVVk...",
      "..kTVVVVVVVVVVVVVVVVVVVVVVVkk.",
      ".kTTTTTTTTTWWWWWWWWWVVVVVVVVVk",
      ".kVVVVVVVVVVVVVVVVVVVVVVVVVVk.",
      "..kkkVVVVVVVVVVVVVVVVVVVVkkk..",
      "....kTTTTTTTTTTTTTTTTTTTVk....",
      "....kTTTTVPVWiiiiTVPVWVVVk....",
      "....kTTTTVpVWiYiiTVpVWVVVk....",
      "....kTTTTVWVWiLLiTVWVWVVVk....",
      "....kTTTTVWVWiYLiTVWVWVVVk....",
      "....kTTTTVVVWiLLiTVVVWVVVk....",
      "....kTTTTVWVWiPpiTVWVWVVVk....",
      "....kTTTTVWVWiPpiTVWVWVVVk....",
      "....kTTTTVVVWiiiiTVVVWVVVk....",
      "....kTTTTVWVWiiiiTVWVWVVVk....",
      "...kkTTTTWWWWiiiiTWWWWVVVkk...",
      "..kHHHHHHHHHHSSSSSBBBBBDDDDk..",
      "..kSSSSSSSSSSSSSSSSSSSSSSSSk..",
      "...kkkkkkkkkkkkkkkkkkkkkkkk...",
      "..kHHHHHSSSSSBBBBBDDDDDEEEEk..",
      "..kHHHHHSSSSSBBBBBDDDDDEEEEk..",
      "...kkkkkkkkkkkkkkkkkkkkkkkk...",
    ],
    anchor: [15, 30], light: [14, 17], shadow: 12,
  },
  scroll: {
    rows: [
      "....................",
      "....................",
      ".kkkkkkkkkkkkkkkk...",
      "kTWPPPPPARPPPPPVVk..",
      "kWWPPPPPRRPppppVVk..",
      "kWWPPPPPRRPppppVVk..",
      "kWWpppppRrpppppVVPk.",
      ".kkkkPPikkRPPippppk.",
      "....kPPPiPriPPipppk.",
      "....kPPPPPPPPPppppk.",
      ".....kkkkkkkkkkkkk..",
    ],
    anchor: [10, 11], shadow: 8,
  },
  urn: {
    rows: [
      "................",
      "......kkkk......",
      "......kOOk......",
      "....kkkkkkkk....",
      "...kOOOOOOOwk...",
      "...kOOOOwwwok...",
      "...kkkkkkkkkk...",
      "..kAAAARRRrrrk..",
      "..kAAAARRRrrrk..",
      "..kOOOOOOOORwk..",
      "..kOOOOOOOrwrk..",
      "..kOOOOOOOwwwk..",
      ".kOOOOOOOOwwwok.",
      "..kOOOOOOwwwok..",
      "..kOOOOwwwwwok..",
      "..kwwwwwwwoook..",
      "...kwwwwwoook...",
      "....kooooook....",
      ".....kkkkkk.....",
    ],
    anchor: [8, 19], shadow: 6,
  },
  brazier: {
    rows: [
      "..........kk..........",
      ".........kllkkk.......",
      ".........kllkllk......",
      ".......kkkllkllk......",
      "......klllLLlLlk......",
      "......klLLLLLLlk......",
      "......klLLYYLLlk......",
      "......klLLYYLLlk......",
      "......klLLYYLLlk......",
      "......klLLYYYLLlk.....",
      ".....klLLYYYYYLLlk....",
      ".....klLLYYYYYLLlk....",
      "....kklLLLLLLLLLlk....",
      "...kGGGGGIIIIIiiiik...",
      "....kGlGlIlIlililk....",
      "....kGLGLILILiLiLk....",
      "...kGGGGGIIIIIiiiik...",
      "....kGLGLILILiLiLk....",
      "....kGlGlIlIlililk....",
      "....kGGGGIIIIiiiik....",
      ".....kkIkkkGkkIkk.....",
      "......kIIkkGkIIk......",
      ".......kIIkGkIk.......",
      "........kIkGIk........",
      ".........kIGk.........",
      ".........kIGk.........",
      ".........kIGIk........",
      "........kIkGIk........",
      ".......kIkkGkIk.......",
      "......kIIkkGkIIk......",
      "......kIk.kGkkIIk.....",
      ".....kIk..kGk.kIk.....",
      "....kIk...kGk..kIk....",
      ".....k.....k....k.....",
    ],
    anchor: [11, 34], light: [11, 9], shadow: 8,
  },
  armor: {
    rows: [
      ".......k..........k.......",
      "......kAk........kRk......",
      "......kAAk......kRRk......",
      ".......kAAkkkkkkRRk.......",
      "........kAGGGGGGRk........",
      ".......kGIAIGIGRGIk.......",
      "......kGGIGAAARIGIIk......",
      "......kGGIGIGIGIIIIk......",
      "....kkkGGIGIGIGIIIikkk....",
      "...kARrGGIGIGIIIIiiRrrk...",
      "...kARrkIIIIIIIIiikRrrk...",
      "...kARrkkiiiiiiiikkRrrk...",
      "....kGGGGikkiikkiIIIIk....",
      "....kRRRRiiiiiiiiRRRRk....",
      "..kkkGGGGGGIIIIIiiiiikkk..",
      ".kGGGGIkkkGGRGGGkkkGGIIik.",
      ".kGGIIikkiiiriiiikkIIiiik.",
      ".kRRRRRkkGGGRGGGIkkrrrrrk.",
      ".kGGIIikiiiiriiiiikIIiiik.",
      ".kGGIIikGGGGRGGIIIkIIiiik.",
      ".kRRRRRkiiiiriiiiikrrrrrk.",
      ".kGGIIikGGGGRIIIIikIIiiik.",
      ".kGGIIikiiiiriiiiikIIiiik.",
      ".kRRRRRkkIIIRIIiikkrrrrrk.",
      "..kkkkk.kiiiriiiik.kkkkk..",
      ".....kkk.kIIRiiikkkk......",
      "....kGGIkGkkkkkkkiiik.....",
      "....kGGIkGIikIiikiiik.....",
      "....kGGIkGIikIiikiiik.....",
      "....kGGIkGIikIiikiiik.....",
      "....kGGIkGIikIiikiiik.....",
      "....kGGIkGIiTIiikiiik.....",
      ".....kkk.kkkTWkk.kkk......",
      "...........kTWk...........",
      "...........kTWk...........",
      "....kkkkkkkkTWkkkkkkkk....",
      "...kTTTTTTTTTTTTWWWWWWk...",
      "...kTTTTTTWWWWWWVVVVVVk...",
      "....kkkkkkkkkkkkkkkkkk....",
    ],
    anchor: [13, 39], shadow: 10,
  },
  crystal: {
    rows: [
      "....................",
      "..........k.........",
      "........kkkk........",
      ".......kYkLkk.......",
      "........kYLlk.......",
      ".......kYYLllk......",
      ".......kYYLllk......",
      ".......kYYLllk......",
      ".......kYYLllk......",
      ".......kYYLllk..k...",
      ".......kYYLllk.kkk..",
      ".......kYYLllk.klk..",
      "...kk..kYYLllkkklkk.",
      "..kYkk.kYYLllkkLllk.",
      "..kkYLkkYYLllkYLllk.",
      ".kYkYLlkYYLllkYLllk.",
      "..kYYLlkYYLllkYLllk.",
      "..kYYLlkYYLllkYLlkk.",
      "..kYYLlkYYLllkYLlk..",
      "..kkYLlkYYLllkYLlk..",
      "...kYLlkYYLllkYLlk..",
      "...kYLlkYYLllkYLlk..",
      "...kYLlkYYLllkYLlk..",
      "...kYLlkYYLllkYLlk..",
      "...kYLlkYYLllkYLlk..",
      "...kkLlkYYLllkYLk...",
      "....kklkYYLllkYLk...",
      "..kkkHkkkYLlkkkkkkk.",
      "..kHHHSSkkLkHHHHSSDk",
      "..kSSSBDk.kkSSSSBDEk",
      "..kkkEkkk...kkDEEkk.",
      ".....k........kkk...",
    ],
    anchor: [10, 32], light: [10, 14], shadow: 8,
  },
  orb: {
    rows: [
      "................",
      "......kkkk......",
      "....kkYYLLkk....",
      "...kYYYYLLLLk...",
      "..kYYYYYLLLLLk..",
      "..kYYYYLLLLLLk..",
      ".kYYYYLLLLLLLlk.",
      ".kLLLLLLLLLLLlk.",
      ".kLLLLLLLLLLllk.",
      ".kLLLLLLLLLlllk.",
      "..kLLLLLLLlllk..",
      "..kLLLLLLllllk..",
      "...kLLLlllllk...",
      "....kkllllkk....",
      "......kkkk......",
    ],
    anchor: [8, 24], light: [8, 8], shadow: 4, outline: "sB",
  },
  torii: {
    rows: [
      "..............................................",
      ".........kkkk....................kkkk.........",
      "........kiiiik..................kiiiik........",
      "........kiiiik..................kiiiik........",
      "........kiiiik..................kiiiik........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "........kAARrk..................kAARrk........",
      "....kkkkkAARrkkkkkkkkkkkkkkkkkkkkAARrkkkkk....",
      "...kAAAAAAARrAAAARRRRRRRRRRRRRrrrAARrrrrrrk...",
      "...kAAAAAAARrAAAAAAAAAAAAAAAAARRRAARrRRRRRk...",
      "....kkkkkAARrkkkkkkkkAARrkkkkkkkkAARrkkkkk....",
      "........kAARrk....kiiiiiiiik....kAARrk........",
      "........kAARrk....kiiiAAiiik....kAARrk........",
      "........kAARrk....kiiiAAiiik....kAARrk........",
      "...kkkkkkAARrkkkkkkiiiiiiiikkkkkkAARrkkkkkk...",
      "..kAAAAAAAAAAAAAARRRRRRRRRRRRRrrrrrrrrrrrrrk..",
      ".kkAAAAAAAAAAAAAAAAAAAAAAAAAAARRRRRRRRRRRRRkk.",
      "kiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiik",
      "kiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiik",
      "kiiikkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkiiik",
      ".kkk......................................kkk.",
    ],
    anchor: [23, 32], shadow: 0, outline: "vD",
  },
  andon: {
    rows: [
      ".....kkkkkk.....",
      "....kWWWWWWk....",
      "....kWkkkkVk....",
      ".kkkkWkkkkVkkkk.",
      "kTWTTTTTTTTWWVWk",
      "kTWTTTWWWWWVVVVk",
      ".kWllllllllllVk.",
      ".kWlLLLlLLLLlVk.",
      ".kWlLLLlLLLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWWWWWlWWWWWVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLYlYYLLlVk.",
      ".kWlLLLlLLLLlVk.",
      ".kWlLLLlLLLLlVk.",
      ".kWllllllllllVk.",
      ".kWTTTTTTTWWWVk.",
      ".kWTTTWWWWVVVVk.",
      ".kWkkkkkkkkkkVk.",
      ".kWk........kVk.",
      ".kWk........kVk.",
      ".kWk........kVk.",
      "..k..........k..",
    ],
    anchor: [8, 28], light: [8, 13], shadow: 6,
  },
};

const SPRITE_KINDS: ReadonlySet<string> = new Set(Object.keys(MAP_PROP_SPRITES));

/** 絵で描く置物か（false なら mapDecor.ts の手続きで描く） */
export function isMapPropSpriteKind(kind: MapPropKind): kind is MapPropSpriteKind {
  return SPRITE_KINDS.has(kind);
}
