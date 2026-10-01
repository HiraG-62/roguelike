/**
 * 門前町の設備の印と小物の絵（docs/ideas/hub-town-impl.md 4 章）。密度 2（論理 1px = 2 ドット）。
 * 建物の本体（屋根・壁・柱・暖簾）は render/townArt.ts が手続きで描き、ここは「何の店か」を語る要所だけを手で描く。
 *
 * 色は mapProps.ts と同じ「役の文字」で書く。迷宮の置物はテーマで色を当てるが、町は宵の配色に固定する（TOWN_PROP_ROLES）。
 * MAP_PROP_ROLES の文字はすべて同じ意味で引き継ぎ（石 H〜E・灯 Y L l・朱 A R r・木 T W V・白 O w o・鉄 G I i・紙 P p・葉 m M）、
 * 瓦・白壁・暖簾・金・茅・銅板・土壁などの役を足す。SPRITES には合流しない（PALETTE の文字ではないため）。
 *
 * 行は輪郭を付ける前の「塗り」で書き、読み込み時に outlined() が外周へ k を 1 ドット足す（輪郭が必ず閉じる）。
 * 内側の線や細い吊り紐に k を置いてもよい（k は外周の判定に数えない）。座標は輪郭を足した後の絵の左上からのドット。
 * 光源は左上（様式書 2 章）。左右反転して置かない前提で描いている
 */
import type { MapPropRoleChar } from "./mapProps";

/** 透明の文字 */
export const TOWN_PROP_CLEAR = ".";
/** 輪郭の文字 */
export const TOWN_PROP_OUTLINE = "k";

/** 迷宮の置物の役（MAP_PROP_ROLES）を宵の町の固定色で引き継いだもの */
const INHERITED_ROLES: Readonly<Record<MapPropRoleChar, string>> = {
  k: "#1a1a24", // 輪郭
  H: "#8e8c9a", // 石のハイライト（宵の空を映して少し青い）
  S: "#72707e", // 石の明
  B: "#5a5866", // 石の基本
  D: "#42404e", // 石の暗
  E: "#2c2a36", // 石の最暗
  Y: "#fff4c0", // 灯の芯（灯った紙の明るい所）
  L: "#ffcf8a", // 灯（タイトルの灯 TITLE_DEFAULT_TINT）
  l: "#e8964a", // 灯の縁
  A: "#e0583e", // 朱の明（タイトルの SHU_HI）
  R: "#c83a2a", // 朱（タイトルの SHU）
  r: "#8a2018", // 朱の暗（タイトルの SHU_LO）
  T: "#8a6a4a", // 木の明
  W: "#64492f", // 木
  V: "#3e2c1e", // 木の暗
  O: "#e8e2d0", // 白の明（骨の役を白布・白毛に使う）
  w: "#c8c0a8", // 白
  o: "#8a8070", // 白の暗
  G: "#8a8692", // 鉄の明
  I: "#4a464c", // 鉄
  i: "#2a272c", // 鉄の暗・漆の黒
  P: "#ece4cc", // 紙
  p: "#b0a488", // 紙の暗
  m: "#6a8a4a", // 葉・青竹の明
  M: "#3e5e34", // 葉・青竹
};

/** 町で足した役 */
const TOWN_ONLY_ROLES = {
  a: "#7a80a0", // 瓦のハイライト（宵の空を映す）
  b: "#555b78", // 瓦の明
  c: "#3c4058", // 瓦
  d: "#2a2c40", // 瓦の暗
  e: "#1e1e2c", // 瓦の最暗（軒の下）
  F: "#e8e4da", // 白壁の明
  f: "#c8c4c0", // 白壁
  g: "#9c9aa8", // 白壁の暗
  h: "#6e6e80", // 白壁の最暗（軒の影）
  N: "#4a6aa8", // 藍の明
  n: "#2e4a7a", // 藍
  q: "#1e3052", // 藍の暗・水
  J: "#f0d080", // 金の明
  K: "#c8a050", // 金（タイトルの GOLD）
  j: "#7a5a28", // 金の暗（タイトルの GOLD_LO）
  t: "#a89270", // 茅の明
  u: "#806c4c", // 茅
  v: "#584832", // 茅の暗
  C: "#8cbca4", // 銅板の明（緑青）
  x: "#5e9480", // 銅板
  X: "#3e6a5a", // 銅板の暗
  s: "#a8845a", // 土壁の明
  Q: "#80603e", // 土壁
  U: "#5a442e", // 土壁の暗
  "1": "#f6f2e4", // 白（紙垂・眼の光）
  "2": "#e88aa8", // 花の桃
  "3": "#f0d870", // 花の黄
  "4": "#d8884a", // 猫の茶
  "5": "#a0582c", // 猫の茶の暗
  "6": "#c8b080", // 縄の明
  "7": "#8a7450", // 縄
  "8": "#d4b080", // 新しい材木の明
  "9": "#a8844e", // 新しい材木
  Z: "#120f16", // 戸口の奥の闇
} as const;

export type TownRoleChar = MapPropRoleChar | keyof typeof TOWN_ONLY_ROLES;

/** 役の文字 → 色（#rrggbb）。宵の町の配色で固定 */
export const TOWN_PROP_ROLES: Readonly<Record<TownRoleChar, string>> = { ...INHERITED_ROLES, ...TOWN_ONLY_ROLES };

export interface TownPropSprite {
  /** 行の文字列（全行同じ幅・輪郭つき）。'.' は透明 */
  readonly rows: readonly string[];
  readonly w: number;
  readonly h: number;
  /** 置く基準の点（足元。吊るす物は吊り元） */
  readonly anchor: readonly [number, number];
  /** 灯の中心（灯る物だけ）。描画レーンが発光を重ねる位置 */
  readonly light?: readonly [number, number];
}

type Point = readonly [number, number];

function isFill(ch: string): boolean {
  return ch !== TOWN_PROP_CLEAR && ch !== TOWN_PROP_OUTLINE;
}

/** 塗りの行の外周へ輪郭 k を 1 ドット足す（行の長さが揃っていなくてもよい。右を透明で埋める） */
function outlined(raw: readonly string[], anchor: Point, light?: Point): TownPropSprite {
  const w0 = Math.max(...raw.map((r) => r.length));
  const at = (x: number, y: number): string => raw[y]?.[x] ?? TOWN_PROP_CLEAR;
  const rows: string[] = [];
  for (let y = -1; y <= raw.length; y++) {
    let row = "";
    for (let x = -1; x <= w0; x++) {
      const ch = at(x, y);
      if (ch !== TOWN_PROP_CLEAR) {
        row += ch;
        continue;
      }
      const touches = isFill(at(x - 1, y)) || isFill(at(x + 1, y)) || isFill(at(x, y - 1)) || isFill(at(x, y + 1));
      row += touches ? TOWN_PROP_OUTLINE : TOWN_PROP_CLEAR;
    }
    rows.push(row);
  }
  const shift = (p: Point): Point => [p[0] + 1, p[1] + 1];
  const base = { rows, w: w0 + 2, h: raw.length + 2, anchor: shift(anchor) };
  return light ? { ...base, light: shift(light) } : base;
}

/** 同じ行を n 回 */
function rep(n: number, row: string): string[] {
  return Array.from({ length: n }, () => row);
}

/** 設備の印と小物の名前 */
export type TownPropKey =
  | "chochin"
  | "anvil"
  | "bell"
  | "swordRack"
  | "saisen"
  | "signHammer"
  | "signScroll"
  | "signSword"
  | "stoneLantern"
  | "barrel"
  | "bucket"
  | "cat"
  | "sprout"
  | "cabbage"
  | "flower"
  | "stake";

export const TOWN_PROPS: Readonly<Record<TownPropKey, TownPropSprite>> = {
  // 軒先の提灯（灯っている）。吊り元が anchor。朱の帯は灯に透けた明るい朱
  chochin: outlined(
    [
      "....k....",
      "....k....",
      "..iiiii..",
      ".iiGiiii.",
      "YYYYYLLLl",
      "YYYYYYLLl",
      "LLLLLLLll",
      "YYAAAAALl",
      "YAAARAAAl",
      "YYAAAAALl",
      "LLLLLLLll",
      "YYYYYLLLl",
      ".YYYLLLl.",
      ".iiGiiii.",
      "..iiiii..",
    ],
    [4, 0],
    [4, 8],
  ),
  // 鍛冶屋の金床（切り株の台に載る）。角は右
  anvil: outlined(
    [
      "OGGGGGGGGGGGGGGGG....",
      "GGGGGGGGGGGGGGGGGGGGG",
      ".IIIIIIIIIIIIIIIIIi..",
      "..IIIIIIIIIIIIIIii...",
      "....IIIIIIIIIIii.....",
      ".....GIIIIIIIi.......",
      "....GIIIIIIIIii......",
      "..TTTTTTTTTWWWWWV....",
      "..TWWVWWWWWWVWWWV....",
      "..TWWWWWWVWWWWWVV....",
      "..VVVVVVVVVVVVVVV....",
    ],
    [9, 11],
  ),
  // 社の鈴（本坪鈴）と鈴緒（紅白のより縄）。吊り元が anchor
  bell: outlined(
    [
      "...kk...",
      "..JJJK..",
      ".JJJKKK.",
      "JJJKKKKj",
      "JJKKKKKj",
      "JKKKKKjj",
      ".jjiijj.",
      "..jjjj..",
      ...rep(6, "...ROO..").flatMap((row) => [row, "...OOR.."]),
      "..RROOR.",
      "..RO.RO.",
      "..R...O.",
    ],
    [4, 0],
  ),
  // 武器小屋の刀掛け（黒鞘・朱鞘・黒鞘。柄は菱の柄巻、鍔は金）
  swordRack: outlined(
    [
      "...TW............................TW...",
      "...TW............................TW...",
      "IPIPIPIPKKiiiiiiiiiiiiiiiiiiiiiiiiiiGG",
      "iIiIiIiIKKiiiiiiiiiiiiiiiiiiiiiiiiiiii",
      "...TW............................TW...",
      "...TW............................TW...",
      "...TW............................TW...",
      "IPIPIPIPKKRRRRRRRRRRRRRRRRRRRRRRRRRRAA",
      "iIiIiIiIKKrrrrrrrrrrrrrrrrrrrrrrrrrrrr",
      "...TW............................TW...",
      "...TW............................TW...",
      "...TW............................TW...",
      "IPIPIPIPKKiiiiiiiiiiiiiiiiiiiiiiiiiiGG",
      "iIiIiIiIKKiiiiiiiiiiiiiiiiiiiiiiiiiiii",
      "...TW............................TW...",
      "...TW............................TW...",
      "...TW............................TW...",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTWWWWWW",
      "TWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWVV",
      "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",
    ],
    [19, 20],
  ),
  // 社の賽銭箱（格子の天板と金の帯）
  saisen: outlined(
    [
      "TTTTTTTTTTTTTTTTTTTT",
      "TVTVTVTVTVTVTVTVTVTW",
      "TTTTTTTTTTTTTTTTTTWW",
      "WWWWWWWWWWWWWWWWWWVV",
      "JKKKKKKKKKKKKKKKKKjj",
      "WWWWWWWWWWWWWWWWWWVV",
      "WWWWWWWWWWWWWWWWWWVV",
      "VVVVVVVVVVVVVVVVVVVV",
    ],
    [10, 8],
  ),
  // 看板の絵: 槌（鍛冶屋）。金の線だけで描き、板は townArt.ts が描く
  signHammer: outlined(
    [
      "JJJJJJJJ",
      "JKKKKKKj",
      "JKKKKKKj",
      "...Jj...",
      "...Jj...",
      "...Jj...",
      "...Jj...",
      "...jj...",
    ],
    [4, 0],
  ),
  // 看板の絵: 巻物（書庫）
  signScroll: outlined(
    [
      "JJ......JJ",
      "JKJJJJJJKj",
      "JKPPPPPPKj",
      "JKPiPiPPKj",
      "JKPiPiPPKj",
      "JKPiPPPPKj",
      "JKPPPPPPKj",
      "JKJJJJJJKj",
      "jj......jj",
    ],
    [5, 0],
  ),
  // 看板の絵: 交差した刀（武器小屋）
  signSword: outlined(
    [
      "J........J",
      "JJ......JJ",
      ".JJ....JJ.",
      "..JJ..JJ..",
      "...JKKJ...",
      "...KjjK...",
      "..RR..RR..",
      ".RR....RR.",
      "RR......RR",
    ],
    [5, 0],
  ),
  // 参道の石灯籠（宝珠・笠・灯った火袋・中台・竿・基壇）。灯は火袋の窓
  stoneLantern: outlined(
    [
      "...........HS...........",
      "..........HHSB..........",
      "...........SB...........",
      ".........HHSSBD.........",
      "......HHHHSSSBBBDD......",
      "...HHHHHHSSSSBBBBDDDE...",
      "HHHHHHHHSSSSSBBBBBDDDDEE",
      ".EEEEEEEEEEEEEEEEEEEEEE.",
      ".....HSSSSSBBBBBBDE.....",
      ".....HSYYYYLLLLllDE.....",
      ".....HSYYYYLLLLllDE.....",
      ".....HSYYYYLLLLllDE.....",
      ".....HSLLLLLLLLllDE.....",
      ".....HSYYYLLLLlllDE.....",
      ".....HSYYYLLLLlllDE.....",
      ".....HSSSSSBBBBBBDE.....",
      "...HHHSSSSSSBBBBBDDDE...",
      "....EEEEEEEEEEEEEEEE....",
      ...rep(8, "........HHSSBBDE........"),
      "........EEEEEEEE........",
      ...rep(8, "........HHSSBBDE........"),
      ".....HHHSSSSBBBBDDE.....",
      "...HHHHSSSSSSBBBBBDDE...",
      "..HHHHSSSSSSSBBBBBBDDE..",
      "..EEEEEEEEEEEEEEEEEEEE..",
    ],
    [12, 39],
    [12, 11],
  ),
  // 樽（菰の札に朱の印）
  barrel: outlined(
    [
      "..TTTTTTTTTT..",
      ".TWWWWWWWWWWV.",
      "..VVVVVVVVVV..",
      ".iiiiiiiiiiii.",
      "TTWWTWWWTWWVVV",
      "TTWWTWWWTWWVVV",
      "TTWWTWWWTWWVVV",
      "iiiiiiiiiiiiii",
      "TTWWPPPPpWWVVV",
      "TTWWPPRPpWWVVV",
      "TTWWPRRPpWWVVV",
      "TTWWPPPPpWWVVV",
      "iiiiiiiiiiiiii",
      "TTWWTWWWTWWVVV",
      ".TWWTWWWTWWVV.",
      "..VVVVVVVVVV..",
    ],
    [7, 16],
  ),
  // 桶（水が張ってある）
  bucket: outlined(
    [
      ".TTTTTTTTTT.",
      "TNnnnnnnnnqV",
      ".TqqqqqqqqV.",
      "TTWWWWWWWVVV",
      "iiiiiiiiiiii",
      "TTWWWWWWWVVV",
      "TTWWWWWWWVVV",
      "iiiiiiiiiiii",
      ".TWWWWWWWVV.",
    ],
    [6, 9],
  ),
  // 茶の猫（座って尾を巻く。眼が宵の灯を映す）
  cat: outlined(
    [
      ".4.....4....",
      ".44...44....",
      ".4444444....",
      ".4Y444Y4....",
      ".44O4O44....",
      "..44OO4.....",
      "..O4444O....",
      ".O44444O4...",
      ".O444445445.",
      ".O444445..45",
      ".OO44445..45",
      ".OO44455.445",
      "..OO5555445.",
    ],
    [6, 13],
  ),
  // 庭の芽
  sprout: outlined(["m...m", "mm.mM", ".mmM.", "..M.."], [2, 4]),
  // 庭の菜（丸い葉の株）
  cabbage: outlined(["...mmmm...", ".mmmmmMm..", "mmmMmmmMMm", "mmmmMmMMMM", ".MmMMMMMM.", "..MMMMMM.."], [5, 6]),
  // 花の株（桃と黄）
  flower: outlined([".2...3.", "222.333", ".2m.3M.", "..mmM..", ".mmMMM."], [3, 5]),
  // 縄張りの杭（新しい材木）
  stake: outlined(["889", "899", ...rep(8, "89V"), "99V"], [1, 11]),
};
