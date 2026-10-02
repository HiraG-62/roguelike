/**
 * 門前町の建物と小物の絵（docs/ideas/hub-town-impl.md 4 章）。屋根・壁・柱・暖簾・看板の部品キットを手続きで組み、
 * 設備の印と小物は data/sprites/townProps.ts の手描き（密度 2 の役の文字）を重ねる。純関数で、同じ入力なら同じ画素。
 * 色は宵の町の配色で固定（迷宮のテーマに依らない）。画素は ABGR の 32bit（mapNoise.ts の pack と同じ並び）。
 *
 * 寸法と anchor の決め:
 * - 絵の 1 ドット = 論理 0.5px（密度 2）。1 マス = 32 ドット
 * - anchor は **足元の中央**。敷地の絵なら「敷地の下端の辺の中央」で、x = w / 2、y = h（最下段のすぐ下）。
 *   置くときは left = (敷地の中央 x の論理 px) - anchor.x / 2、top = (敷地の下端の論理 px) - anchor.y / 2
 * - 敷地の絵の幅 = 敷地の幅（マス × 32。井戸だけ石畳の円のため敷地より 16 ドット広い）、
 *   高さ = (敷地の奥行き + 屋根の立ち上がり 2 マス) × 32。庭・稽古場は地面に伏せる物なので立ち上がり 1 マス
 * - built true / false は同じ寸法・同じ anchor（建つ前と後で置き場所が動かない）
 * - 小物（灯籠・幟・碑・賑わい）も anchor は足元の中央（地面に接する点）
 *
 * 灯の位置（提灯・窓・炉の火・石段の奥）は townObjectGlows が同じ座標系で返す。発光は描画レーンが重ねる
 */
import type { HubLotKey } from "../map/hubMap";
import { TILE_SIZE } from "../map/grid";
import { TOWN_PROPS, TOWN_PROP_CLEAR, TOWN_PROP_ROLES, type TownPropKey, type TownRoleChar } from "../data/sprites/townProps";
import { h32, hashString, pack } from "./mapNoise";
import { MAP_DOTS } from "./mapTypes";

/** 描く物の種類 */
export type TownObjectKind =
  /** 敷地の建物（built = false は縄張り・材木・足場の空き地）。well は使わず well の種類で描く。yard は稽古場の柵・砂の円・的 */
  | { type: "lot"; lot: HubLotKey; built: boolean }
  /** 井戸（段 0〜3） */
  | { type: "well"; tier: number }
  /** 鳥居の柱と笠木（HubLayout.gate の矩形に掛ける。足元の y でプレイヤーと前後する） */
  | { type: "torii" }
  /** 鳥居の下の石段・袖の石垣・奥の灯（地面の物。プレイヤーが上を歩くので常に体より奥に描く） */
  | { type: "toriiSteps" }
  /** 参道の石灯籠 */
  | { type: "lantern" }
  /** 御堂の前の幟（章 1〜4 の色） */
  | { type: "trophy"; chapter: number }
  /** 踏破の碑（位階 1 以上） */
  | { type: "stele"; tier: number }
  /** 賑わいの小物（index は clutterSlots の何番目か。0 樽 / 1 荷車 / 2 洗濯物 / 3 猫 … を描く側が決める） */
  | { type: "clutter"; index: number };

/** 描いた絵。w / h はドット（絵の 1 ドット = 論理 0.5px）。anchor は足元の点（ドット）で、置き場所の基準 */
export interface TownPixels {
  w: number;
  h: number;
  anchor: { x: number; y: number };
  /** ABGR。長さ w * h。透明は 0 */
  pixels: Uint32Array;
}

/** 灯の種類: 提灯 / 窓（記録の蔵は前から archiveLights 個だけ灯す）/ 炉や篝火の火 / 石段の奥の灯（章の色） */
export type TownGlowKind = "lantern" | "window" | "fire" | "gate";

/** 灯の位置（絵の左上からのドット。anchor と同じ座標系） */
export interface TownGlow {
  x: number;
  y: number;
  kind: TownGlowKind;
}

/**
 * 描いた物の控え。絵と灯の点は同じ描画から出るので、灯の点を引くために絵をもう一度描かない（拠点を開いた瞬間の手間を半分に）。
 * 種類は有限（敷地 10 × 建つ前後・井戸 4 段・幟 4 色・碑の位階・小物 6 など）。返す画素は呼び出し側が書き換えない前提で共有する
 */
const drawnCache = new Map<string, Drawn>();

function drawnOf(kind: TownObjectKind): Drawn {
  const id = JSON.stringify(kind);
  const hit = drawnCache.get(id);
  if (hit) return hit;
  const made = drawObject(kind);
  drawnCache.set(id, made);
  return made;
}

/** 物の絵を描く。同じ kind なら同じ画素（控えを共有するので書き換えない） */
export function townObjectPixels(kind: TownObjectKind): TownPixels {
  return drawnOf(kind).pixels;
}

/** 物の灯の位置。描画レーンが発光（提灯の揺らぎ・窓の灯・石段の奥の章の色）を重ねる */
export function townObjectGlows(kind: TownObjectKind): readonly TownGlow[] {
  return drawnOf(kind).glows;
}

/** 敷地の大きさ（マス。docs/ideas/hub-town-impl.md 3 章の配置図）。絵の幅はこれに合わせる */
export const TOWN_LOT_TILES: Readonly<Record<HubLotKey, { w: number; h: number }>> = {
  shrine: { w: 5, h: 3 },
  hall: { w: 5, h: 3 },
  forge: { w: 5, h: 3 },
  library: { w: 5, h: 3 },
  well: { w: 2, h: 2 },
  board: { w: 2, h: 1 },
  archive: { w: 9, h: 3 },
  garden: { w: 6, h: 3 },
  rackShed: { w: 3, h: 2 },
  yard: { w: 11, h: 11 },
};

// ---------------------------------------------------------------------------
// 寸法の定数

/** 1 マスのドット数（論理 16px × 密度 2） */
const TILE_DOTS = TILE_SIZE * MAP_DOTS;
/** 屋根の立ち上がり（敷地の上へはみ出すマス数） */
const ROOF_RISE_TILES = 2;
/** 地面に伏せる物（庭・稽古場）の立ち上がり */
const LOW_RISE_TILES = 1;
/** 井戸の絵は石畳の円のぶん敷地より広い */
const WELL_EXTRA_W = 16;
/** 賑わいの小物の種類の数（index はこれで割った余りで選ぶ） */
const CLUTTER_KINDS = 6;
/** 幟の章の色の範囲 */
const TROPHY_CHAPTER_MAX = 4;
/** 踏破の碑が育つ位階の境（meta/tierRewards.ts の CLEAR_TITLE_TIERS と同じ並び: 1 / 5 / 10 / 15 / 20） */
const STELE_STAGE_TIERS = [1, 5, 10, 15, 20] as const;

// ---------------------------------------------------------------------------
// 色

function col(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return pack((v >> 16) & 255, (v >> 8) & 255, v & 255);
}

function alphaCol(hex: string, a: number): number {
  const v = parseInt(hex.slice(1), 16);
  return (((a & 255) << 24) | ((v & 255) << 16) | (((v >> 8) & 255) << 8) | ((v >> 16) & 255)) >>> 0;
}

const ROLE_COLOR: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(TOWN_PROP_ROLES).map(([k, v]) => [k, col(v)]));

function role(ch: TownRoleChar): number {
  return ROLE_COLOR[ch] ?? 0;
}

const CLEAR = 0;
const OUTLINE = role("k");
const INTERIOR = role("Z");
const PAPER_WHITE = role("1");
/** 足元の影（半透明。輪郭は付けない） */
const SHADOW = alphaCol("#06050c", 120);
/** 空き地の掘り返した土（半透明。町の地面の上に薄く重ねる） */
const DUG_SOIL = alphaCol("#3a2a1c", 90);
const DUG_SOIL_DARK = alphaCol("#24180e", 120);
const OPAQUE_ALPHA = 255;

/** 5 段の配色（ハイライト → 明 → 基本 → 暗 → 最暗） */
type Ramp = readonly number[];

function ramp(...chars: readonly (TownRoleChar | `#${string}`)[]): Ramp {
  return chars.map((c) => (c.startsWith("#") ? col(c) : role(c as TownRoleChar)));
}

const STONE = ramp("H", "S", "B", "D", "E");
const KAWARA = ramp("a", "b", "c", "d", "e");
const PLASTER = ramp("F", "f", "g", "h", "#4c4c5e");
const WOOD = ramp("#a8845e", "T", "W", "V", "#2a1d14");
const THATCH = ramp("#c4ac84", "t", "u", "v", "#3a2e20");
const COPPER = ramp("C", "x", "X", "#2a4a40", "#1c3029");
const EARTH = ramp("#c49c6c", "s", "Q", "U", "#3e2e20");
const SHU = ramp("#f07a5a", "A", "R", "r", "#5a1410");
const GOLD = ramp("#fff0b0", "J", "K", "j", "#4a3618");
const INDIGO = ramp("#6a8ac8", "N", "n", "q", "#141e36");
const PURPLE = ramp("#9a7ad0", "#7656a8", "#573c86", "#3c2860", "#26183e");
const FRESH = ramp("#ecd0a0", "8", "9", "#7a5e38", "#4e3c24");
const BAMBOO = ramp("#9ac070", "m", "M", "#2a4224", "#1a2c18");
const ROPE = ramp("#e0cc9c", "6", "7", "#5e4e34", "#3e3424");
const SAND = ramp("#a8a498", "#8e8a80", "#78746c", "#5e5b55", "#46443f");
const SOIL = ramp("#7a6048", "#5e4834", "#4a3828", "#36281c", "#241a12");
const IRON = ramp("G", "G", "I", "i", "#16141a");
const LACQUER = ramp("#5a5868", "I", "i", "#1a181e", "#100e14");
const STELE_STONE = ramp("#767a92", "#585c74", "#40445a", "#2e3042", "#1e1f2c");
const SMOKE = ramp("#6a6876", "#565462", "#46444f", "#363440", "#2a2832");
const FIRE = ramp("Y", "Y", "L", "l", "R");
const SLATE = ramp("#5a5c6e", "#4a4c5c", "#3c3e4c", "#2e3040", "#222432");
/** 幟の章の色（章 1 苔・2 橙・3 朱・4 紫。タイトルの CHAPTER_TINTS に寄せた布の色） */
const CHAPTER_CLOTH: readonly Ramp[] = [
  ramp("#b8e088", "#86b858", "#62903e", "#44682a", "#2c441c"),
  ramp("#ffcc90", "#f09a48", "#c8702a", "#8a4a1a", "#5a2e10"),
  SHU,
  PURPLE,
];

function rc(r: Ramp, i: number): number {
  const k = Math.max(0, Math.min(r.length - 1, Math.round(i)));
  return r[k] ?? OUTLINE;
}

// ---------------------------------------------------------------------------
// 画素の板

type PixelFn = (x: number, y: number) => number;

class Raster {
  readonly px: Uint32Array;
  readonly glows: TownGlow[] = [];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint32Array(w * h);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return CLEAR;
    return this.px[y * this.w + x] ?? CLEAR;
  }

  set(x: number, y: number, c: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (c === CLEAR || ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.px[iy * this.w + ix] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c);
  }

  /** 矩形の中を画素ごとの色で塗る（0 を返した画素は塗らない） */
  paint(x: number, y: number, w: number, h: number, fn: PixelFn): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, fn(xx, yy));
  }

  /** 楕円の中を塗る。中心は実数で、ドットの中心で内外を決める */
  ellipse(cx: number, cy: number, rx: number, ry: number, fn: PixelFn | number): void {
    const x0 = Math.floor(cx - rx);
    const y0 = Math.floor(cy - ry);
    for (let y = y0; y <= Math.ceil(cy + ry); y++) {
      for (let x = x0; x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        this.set(x, y, typeof fn === "number" ? fn : fn(x, y));
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, thick = 1): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      this.rect(x, y, thick, thick, c);
    }
  }

  /** 手描きの絵を anchor が (ax, ay) に来るように置く。灯る絵なら灯の位置を記録する */
  stamp(key: TownPropKey, ax: number, ay: number, glow?: TownGlowKind): void {
    const sp = TOWN_PROPS[key];
    const left = Math.round(ax) - sp.anchor[0];
    const top = Math.round(ay) - sp.anchor[1];
    sp.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x] ?? TOWN_PROP_CLEAR;
        if (ch === TOWN_PROP_CLEAR) continue;
        this.set(left + x, top + y, ROLE_COLOR[ch] ?? OUTLINE);
      }
    });
    if (glow && sp.light) this.glow(left + sp.light[0], top + sp.light[1], glow);
  }

  glow(x: number, y: number, kind: TownGlowKind): void {
    this.glows.push({ x: Math.round(x), y: Math.round(y), kind });
  }

  /** 透明で、上下左右に塗りがある画素を輪郭にする（外周の輪郭が必ず閉じる） */
  outline(): void {
    const add: number[] = [];
    const solid = (x: number, y: number): boolean => {
      const v = this.get(x, y);
      return v !== CLEAR && v !== OUTLINE && v >>> 24 === OPAQUE_ALPHA;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.get(x, y);
        if (v !== CLEAR && v >>> 24 === OPAQUE_ALPHA) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.px[i] = OUTLINE;
  }

  /** 透明な所にだけ足元の影を落とす（輪郭の後に呼ぶ） */
  shadow(cx: number, cy: number, rx: number, ry: number): void {
    this.ellipse(cx, cy, rx, ry, (x, y) => (this.get(x, y) === CLEAR ? SHADOW : CLEAR));
  }
}

interface Drawn {
  pixels: TownPixels;
  glows: readonly TownGlow[];
}

/** 塗り終えた板に輪郭を付けて足元の中央を anchor にする */
function finish(r: Raster, after?: (r: Raster) => void, anchorX = r.w / 2): Drawn {
  r.outline();
  after?.(r);
  return { pixels: { w: r.w, h: r.h, anchor: { x: Math.round(anchorX), y: r.h }, pixels: r.px }, glows: r.glows };
}

// ---------------------------------------------------------------------------
// 部品: 基壇・壁・柱・梁・戸口・暖簾・提灯・看板

/** 家の寸法（行・列はドット。すべて含む） */
interface HouseGeom {
  W: number;
  H: number;
  wx0: number;
  wx1: number;
  wallTop: number;
  wallBottom: number;
  /** 軒の下端 */
  eave: number;
  /** 棟の下端 */
  ridge: number;
  rx0: number;
  rx1: number;
  /** 棟の高さでの屋根の左右の寄り（寄棟・入母屋は大きく、切妻は小さく） */
  inset: number;
  plinthTop: number;
}

const PLINTH_ROWS = 10;
const PLINTH_TOP_ROWS = 3;
const ROOF_OVERHANG = 2;

function houseGeom(W: number, H: number, wallH: number, roofH: number, margin: number, inset: number): HouseGeom {
  const plinthTop = H - 1 - PLINTH_ROWS;
  const wallBottom = plinthTop - 1;
  const wallTop = wallBottom - wallH + 1;
  const eave = wallTop + 3;
  return { W, H, wx0: margin, wx1: W - 1 - margin, wallTop, wallBottom, eave, ridge: eave - roofH, rx0: ROOF_OVERHANG, rx1: W - 1 - ROOF_OVERHANG, inset, plinthTop };
}

/** 石の基壇（天面 3 行 + 前面。目地は段ごとにずらす） */
function drawPlinth(r: Raster, x0: number, x1: number, top: number, bottom: number, seed: number): void {
  for (let y = top; y <= bottom; y++) {
    for (let x = x0; x <= x1; x++) {
      const row = y - top;
      let i: number;
      if (row < PLINTH_TOP_ROWS) i = row === 0 ? 0 : 1;
      else {
        const course = Math.floor((row - PLINTH_TOP_ROWS) / 4);
        const joint = (x - x0 + course * 9) % 18 === 0 || (row - PLINTH_TOP_ROWS) % 4 === 3;
        i = joint ? 3 : 2;
        if (y === bottom) i = 4;
        else if (!joint && h32(x, y, seed) % 13 === 0) i = 1;
      }
      if (x === x1 && row >= PLINTH_TOP_ROWS) i = Math.max(i, 3);
      r.set(x, y, rc(STONE, i));
    }
  }
}

type WallKind = "plaster" | "board" | "earth";

/** 壁。軒の下の数行は影で暗くする */
function wallColor(kind: WallKind, x: number, y: number, g: HouseGeom, seed: number): number {
  const fromTop = y - g.wallTop;
  const shade = fromTop < 3 ? 2 : fromTop < 7 ? 1 : 0;
  const n = h32(x, y, seed);
  if (kind === "plaster") {
    let i = 1;
    if (n % 61 === 0) i = 2;
    if (x - g.wx0 < 2) i = 0;
    return rc(PLASTER, i + shade);
  }
  if (kind === "board") {
    const c = (x - g.wx0) % 6;
    let i = c === 0 ? 3 : c === 1 ? 1 : 2;
    if (c > 1 && h32(x, y >> 2, seed) % 9 === 0) i = 3;
    return rc(WOOD, i + shade);
  }
  let i = 2;
  if (n % 11 === 0) i = 1;
  else if (n % 13 === 0) i = 3;
  return rc(EARTH, i + shade);
}

function drawWall(r: Raster, g: HouseGeom, kind: WallKind, seed: number): void {
  r.paint(g.wx0, g.wallTop, g.wx1 - g.wx0 + 1, g.wallBottom - g.wallTop + 1, (x, y) => wallColor(kind, x, y, g, seed));
}

/** 柱（左が明るい）。下に礎石 */
function drawPillar(r: Raster, x: number, y0: number, y1: number, pal: Ramp, w = 5): void {
  const cols = w === 4 ? [1, 2, 2, 3] : [1, 1, 2, 3, 3];
  for (let y = y0; y <= y1; y++) cols.forEach((i, dx) => r.set(x + dx, y, rc(pal, i + (y - y0 < 3 ? 1 : 0))));
}

/** 横の梁（上が明るい） */
function drawBeam(r: Raster, x0: number, x1: number, y: number, pal: Ramp, rows = 4): void {
  const shades = rows <= 3 ? [1, 2, 3] : [1, 2, 2, 3];
  for (let i = 0; i < rows; i++) for (let x = x0; x <= x1; x++) r.set(x, y + i, rc(pal, (shades[i] ?? 3) + (x === x1 ? 1 : 0)));
}

/** 戸口の奥の闇（下ほどわずかに床の色） */
function drawOpening(r: Raster, x0: number, y0: number, x1: number, y1: number): void {
  r.paint(x0, y0, x1 - x0 + 1, y1 - y0 + 1, (_x, y) => (y >= y1 - 1 ? rc(WOOD, 4) : INTERIOR));
}

/** 暖簾（3 枚。真ん中に白抜きの丸紋） */
function drawNoren(r: Raster, x0: number, x1: number, y0: number, len: number, pal: Ramp): void {
  const total = x1 - x0 + 1;
  const pw = Math.floor((total - 2) / 3);
  drawBeam(r, x0 - 2, x1 + 2, y0 - 2, WOOD, 2);
  for (let p = 0; p < 3; p++) {
    const px0 = x0 + p * (pw + 1);
    const px1 = p === 2 ? x1 : px0 + pw - 1;
    for (let y = y0; y < y0 + len; y++) {
      for (let x = px0; x <= px1; x++) {
        let i = 2;
        if (x === px0) i = 1;
        if (x === px1 || y === y0 + len - 1) i = 3;
        if (y === y0) i = 1;
        r.set(x, y, rc(pal, i));
      }
    }
  }
  const mx = (x0 + x1) / 2 + 0.5;
  const my = y0 + Math.floor(len * 0.42);
  r.ellipse(mx, my, 4, 4, PAPER_WHITE);
  r.ellipse(mx, my, 2, 2, rc(pal, 2));
}

/** 軒先の提灯を吊るす（吊り元が (x, y)） */
function hangLantern(r: Raster, x: number, y: number): void {
  r.stamp("chochin", x, y, "lantern");
}

type SignPicto = "signHammer" | "signScroll" | "signSword";

/** 置き看板（小さな瓦の笠・黒い板・金の縁と絵）。足元の中央が (cx, footY) */
function drawStandSign(r: Raster, cx: number, footY: number, picto: SignPicto): void {
  const bw = 18;
  const bh = 22;
  const x0 = Math.round(cx - bw / 2);
  const top = footY - 34;
  // 脚
  drawPillar(r, x0 + 2, top + bh, footY - 1, WOOD, 4);
  drawPillar(r, x0 + bw - 6, top + bh, footY - 1, WOOD, 4);
  // 板
  r.paint(x0, top, bw, bh, (x, y) => {
    const edge = x === x0 || y === top || x === x0 + bw - 1 || y === top + bh - 1;
    if (edge) return rc(WOOD, x === x0 || y === top ? 1 : 3);
    const inner = x === x0 + 1 || y === top + 1 || x === x0 + bw - 2 || y === top + bh - 2;
    return inner ? rc(GOLD, 3) : rc(LACQUER, 2);
  });
  // 笠
  for (let i = 0; i < 4; i++) for (let x = x0 - 3 + i; x <= x0 + bw + 2 - i; x++) r.set(x, top - 1 - i, rc(KAWARA, i === 3 ? 0 : i + 1));
  r.stamp(picto, cx, top + 3);
}

/** 格子窓（縦の桟の間に奥の闇か灯） */
function drawLatticeWindow(r: Raster, x0: number, y0: number, w: number, h: number, lit: boolean): void {
  r.paint(x0, y0, w, h, (x, y) => {
    const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    if (edge) return rc(WOOD, x === x0 || y === y0 ? 2 : 3);
    if ((x - x0) % 3 === 0) return rc(WOOD, 2);
    if (!lit) return INTERIOR;
    return y - y0 < h / 2 ? role("Y") : role("L");
  });
  if (lit) r.glow(x0 + w / 2, y0 + h / 2, "window");
}

// ---------------------------------------------------------------------------
// 部品: 屋根

type RoofKind = "kawara" | "thatch" | "copper" | "plank";

/** 軒の反り（端ほど下端が上がる） */
const SORI_LEN = 18;
const SORI_H: Readonly<Record<RoofKind, number>> = { kawara: 4, thatch: 7, copper: 6, plank: 0 };
/** 軒先の帯の行数 */
const EAVE_BAND: Readonly<Record<RoofKind, number>> = { kawara: 5, thatch: 9, copper: 3, plank: 3 };

function soriLift(kind: RoofKind, g: HouseGeom, x: number): number {
  const d = Math.min(x - g.rx0, g.rx1 - x);
  if (d >= SORI_LEN) return 0;
  const t = 1 - d / SORI_LEN;
  return Math.round(SORI_H[kind] * t * t);
}

/** 棟の高さでの寄り（t = 0 が棟、1 が軒）。茅は丸く、他はまっすぐ */
function insetAt(kind: RoofKind, g: HouseGeom, t: number): number {
  return kind === "thatch" ? Math.round(g.inset * (1 - t) * (1 - t)) : Math.round(g.inset * (1 - t));
}

function roofColor(kind: RoofKind, x: number, y: number, t: number, u: number, fromBottom: number, seed: number): number {
  const band = fromBottom < EAVE_BAND[kind];
  const light = t * 1.6 + (u < 0.06 ? -0.6 : u > 0.72 ? 0.6 : 0);
  if (kind === "kawara") {
    if (band) {
      // 軒瓦の列: 丸瓦の巴の小口が並ぶ
      const c = x % 6;
      if (fromBottom === 0) return rc(KAWARA, 4);
      if ((c === 1 || c === 2) && fromBottom >= 1 && fromBottom <= 3) return rc(KAWARA, fromBottom === 3 ? 0 : 1);
      return rc(KAWARA, 3);
    }
    const c = x % 6;
    let i = 1 + light;
    if (c === 0) i += 1.2;
    else if (c === 1) i -= 0.8;
    if ((y + (Math.floor(x / 6) % 2) * 3) % 7 === 6) i += 0.8;
    return rc(KAWARA, i);
  }
  if (kind === "thatch") {
    if (band) {
      // 刈り込んだ茅の小口: 細かい縦の刻みと下の影
      if (fromBottom <= 1) return rc(THATCH, 3 + (fromBottom === 0 ? 1 : 0));
      const n = h32(x, 0, seed) % 3;
      return rc(THATCH, fromBottom > EAVE_BAND.thatch - 3 ? 0 : 1 + (x % 2) * 0.6 + n * 0.3);
    }
    const strand = h32(x, Math.floor((y + (h32(x, 1, seed) % 5)) / 5), seed) % 7;
    let i = 1 + light;
    if (strand === 0) i -= 1;
    else if (strand < 3) i += 0.7;
    return rc(THATCH, i);
  }
  if (kind === "copper") {
    if (band) return rc(COPPER, fromBottom === 0 ? 3 : 0);
    const c = x % 8;
    let i = 1 + light * 0.9;
    if (c === 0) i -= 1;
    else if (c === 1) i += 1;
    if (y % 12 === 0) i += 0.6;
    if (h32(x, y, seed) % 23 === 0) i -= 1;
    return rc(COPPER, i);
  }
  // 板葺き: 横の板と継ぎ目
  if (band) return rc(WOOD, fromBottom === 0 ? 4 : 2);
  const row = Math.floor(y / 5);
  if (y % 5 === 4) return rc(WOOD, 3 + t * 0.6);
  if ((x + (h32(row, 3, seed) % 23)) % 23 === 0) return rc(WOOD, 3);
  return rc(WOOD, 1 + light * 0.8 + (h32(x >> 2, row, seed) % 4 === 0 ? 0.6 : 0));
}

function drawRoof(r: Raster, g: HouseGeom, kind: RoofKind, seed: number): void {
  for (let y = g.ridge; y <= g.eave; y++) {
    const t = (y - g.ridge) / Math.max(1, g.eave - g.ridge);
    const ins = insetAt(kind, g, t);
    const x0 = g.rx0 + ins;
    const x1 = g.rx1 - ins;
    for (let x = x0; x <= x1; x++) {
      const bottom = g.eave - soriLift(kind, g, x);
      if (y > bottom) continue;
      const u = (x - x0) / Math.max(1, x1 - x0);
      r.set(x, y, roofColor(kind, x, y, t, u, bottom - y, seed));
    }
  }
  // 軒の下の影（壁の上端へ落ちる）
  for (let x = g.wx0; x <= g.wx1; x++) r.set(x, g.eave + 1, rc(KAWARA, 4));
}

/** 棟の左右の端（ドット） */
function ridgeSpan(g: HouseGeom, kind: RoofKind): [number, number] {
  const ins = insetAt(kind, g, 0);
  return [g.rx0 + ins - 2, g.rx1 - ins + 2];
}

/** 瓦の棟と鬼瓦 */
function drawKawaraRidge(r: Raster, g: HouseGeom): void {
  const [x0, x1] = ridgeSpan(g, "kawara");
  const rows = [0, 1, 2, 2, 3, 4];
  rows.forEach((i, k) => {
    for (let x = x0; x <= x1; x++) r.set(x, g.ridge - rows.length + k, rc(KAWARA, i));
  });
  const oni = (ox: number, flip: boolean): void => {
    for (let y = g.ridge - 13; y <= g.ridge + 1; y++) {
      const flare = y < g.ridge - 10 ? 1 : 0;
      for (let dx = -flare; dx < 8 + flare; dx++) {
        const lx = flip ? 7 - dx : dx;
        r.set(ox + dx, y, rc(KAWARA, lx < 2 ? 0 : lx < 5 ? 2 : 3));
      }
    }
  };
  oni(x0 - 3, false);
  oni(x1 - 4, true);
}

/** 茅の棟（木の押さえと烏おどしの交差） */
function drawThatchRidge(r: Raster, g: HouseGeom): void {
  const [x0, x1] = ridgeSpan(g, "thatch");
  const rows = [1, 2, 2, 3, 3, 4];
  rows.forEach((i, k) => {
    for (let x = x0 + 4; x <= x1 - 4; x++) r.set(x, g.ridge - rows.length + k, rc(WOOD, i));
  });
  for (let x = x0 + 12; x <= x1 - 12; x += 18) {
    r.line(x - 4, g.ridge - 11, x + 4, g.ridge - 1, rc(WOOD, 2), 2);
    r.line(x + 4, g.ridge - 11, x - 4, g.ridge - 1, rc(WOOD, 1), 2);
  }
}

/** 銅板の棟・鰹木・千木（社） */
function drawShrineRidge(r: Raster, g: HouseGeom): void {
  const [x0, x1] = ridgeSpan(g, "copper");
  const rows = [0, 1, 2, 3];
  rows.forEach((i, k) => {
    for (let x = x0; x <= x1; x++) r.set(x, g.ridge - rows.length + k, rc(COPPER, i));
  });
  // 鰹木（棟に直交する丸太の小口。金の飾り）
  for (let x = x0 + 22; x <= x1 - 22; x += 16) {
    r.ellipse(x, g.ridge - 7, 4, 4, (px, py) => rc(WOOD, px < x && py < g.ridge - 7 ? 1 : 2));
    r.ellipse(x, g.ridge - 7, 2, 2, rc(GOLD, 1));
  }
  // 千木（棟の両端で交差して空へ伸びる板）
  const chigi = (cx: number): void => {
    r.line(cx - 9, g.ridge + 1, cx + 7, g.ridge - 19, rc(WOOD, 1), 3);
    r.line(cx + 9, g.ridge + 1, cx - 7, g.ridge - 19, rc(WOOD, 2), 3);
    r.rect(cx + 6, g.ridge - 21, 3, 3, rc(GOLD, 1));
    r.rect(cx - 8, g.ridge - 21, 3, 3, rc(GOLD, 1));
  };
  chigi(x0 + 6);
  chigi(x1 - 6);
}

/** 千鳥破風（屋根の中ほどの三角の妻。白い破風板と金の懸魚） */
function drawGable(r: Raster, cx: number, apexY: number, baseY: number, halfW: number): void {
  const board = 4;
  for (let y = apexY; y <= baseY; y++) {
    const hw = Math.round((halfW * (y - apexY)) / (baseY - apexY));
    for (let x = cx - hw; x <= cx + hw; x++) {
      const fromEdge = hw - Math.abs(x - cx);
      if (fromEdge < board) r.set(x, y, rc(PLASTER, fromEdge === 0 ? 3 : x < cx ? 0 : 1));
      else r.set(x, y, (x - cx) % 3 === 0 ? rc(WOOD, 2) : rc(WOOD, 3));
    }
  }
  for (let x = cx - halfW; x <= cx + halfW; x++) r.set(x, baseY + 1, rc(WOOD, 4));
  r.ellipse(cx + 0.5, apexY + 9, 4, 5, (x, y) => rc(GOLD, x <= cx && y < apexY + 9 ? 0 : 2));
  r.ellipse(cx + 0.5, apexY + 9, 1.5, 1.5, rc(GOLD, 3));
}

// ---------------------------------------------------------------------------
// 建物

const W5 = 5 * TILE_DOTS;
const H5 = (3 + ROOF_RISE_TILES) * TILE_DOTS;

function lotSize(lot: HubLotKey): { W: number; H: number } {
  const t = TOWN_LOT_TILES[lot];
  const rise = lot === "garden" || lot === "yard" ? LOW_RISE_TILES : ROOF_RISE_TILES;
  const W = t.w * TILE_DOTS + (lot === "well" ? WELL_EXTRA_W : 0);
  return { W, H: (t.h + rise) * TILE_DOTS };
}

/** 鍛冶屋: 板壁・瓦・石の煙突。開けた土間に火床、表に金床と槌の看板 */
function drawForge(seed: number): Drawn {
  const r = new Raster(W5, H5);
  const g = houseGeom(W5, H5, 44, 70, 14, 8);
  // 煙突（棟の奥）と煙
  const chX = 108;
  r.paint(chX, 14, 14, g.ridge - 8, (x, y) => rc(STONE, x - chX < 3 ? 1 : x - chX > 10 ? 3 : 2) + (y % 6 === 5 ? 0 : 0));
  for (let y = 14; y < g.ridge; y += 6) for (let x = chX; x < chX + 14; x++) r.set(x, y, rc(STONE, 3));
  r.rect(chX - 1, 11, 16, 3, rc(STONE, 0));
  r.rect(chX + 2, 12, 10, 2, INTERIOR);
  r.ellipse(chX + 8, 7, 6, 4, (x, y) => rc(SMOKE, x < chX + 7 && y < 7 ? 0 : 1));
  r.ellipse(chX + 17, 4, 6, 3.5, (x, y) => rc(SMOKE, x < chX + 16 && y < 4 ? 1 : 2));
  r.ellipse(chX + 27, 3, 5, 2.5, (x, y) => rc(SMOKE, x < chX + 26 && y < 3 ? 2 : 3));
  drawRoof(r, g, "kawara", seed);
  drawKawaraRidge(r, g);
  drawWall(r, g, "board", seed);
  // 土間の口と火床
  const ox0 = 44;
  const ox1 = 115;
  const oy0 = g.wallBottom - 36;
  drawOpening(r, ox0, oy0, ox1, g.wallBottom);
  const hx = 70;
  const hy = g.wallBottom - 14;
  // 火に照らされた奥の壁
  r.ellipse(hx, hy - 4, 26, 18, (x, y) => {
    if (r.get(x, y) !== INTERIOR) return CLEAR;
    const d = Math.hypot((x - hx) / 26, (y - hy + 4) / 18);
    return d < 0.45 ? col("#6a2a18") : d < 0.75 ? col("#44201a") : col("#2a1618");
  });
  // 火床（石の炉）と炭の火
  r.paint(hx - 16, hy, 32, 14, (x, y) => {
    if (y < hy + 3) return y === hy ? rc(FIRE, 1 + (h32(x, y, seed) % 3)) : rc(FIRE, 2 + (h32(x, y, seed) % 3) * 0.7);
    return rc(STONE, (x - hx + 16) % 8 === 0 || (y - hy) % 5 === 4 ? 3 : x < hx - 10 ? 1 : 2);
  });
  // 炎の舌（下が太く上が細い。外は橙、芯は白っぽい黄）
  for (let i = 0; i < 4; i++) {
    const fx = hx - 9 + i * 6;
    const fh = 6 + (h32(i, 7, seed) % 5);
    for (let k = 0; k < fh; k++) {
      const half = Math.max(0, Math.round(2.4 * (1 - k / fh)));
      const lean = k > fh / 2 ? 1 : 0;
      for (let dx = -half; dx <= half; dx++) {
        const core = Math.abs(dx) < half && k < fh - 2;
        r.set(fx + dx + lean, hy - 1 - k, rc(FIRE, core ? 0 : k < 2 ? 3 : 2));
      }
    }
  }
  r.glow(hx, hy - 2, "fire");
  // 鞴（ふいご）と壁の火箸・槌
  r.paint(ox0 + 3, hy - 2, 7, 16, (x, y) => rc(WOOD, x === ox0 + 3 || y === hy - 2 ? 1 : 2));
  r.line(ox1 - 12, oy0 + 6, ox1 - 12, oy0 + 20, rc(IRON, 1));
  r.line(ox1 - 9, oy0 + 6, ox1 - 7, oy0 + 20, rc(IRON, 1));
  r.rect(ox1 - 5, oy0 + 6, 3, 14, rc(WOOD, 1));
  r.rect(ox1 - 7, oy0 + 6, 7, 4, rc(IRON, 0));
  // 柱と梁
  drawBeam(r, g.wx0, g.wx1, oy0 - 4, WOOD);
  for (const px of [g.wx0, ox0 - 5, ox1 + 1, g.wx1 - 4]) drawPillar(r, px, g.wallTop + 2, g.wallBottom, WOOD);
  drawLatticeWindow(r, 125, g.wallTop + 10, 16, 14, true);
  drawPlinth(r, 8, W5 - 9, g.plinthTop, H5 - 2, seed);
  r.stamp("anvil", 100, g.plinthTop + 2);
  drawStandSign(r, 27, H5 - 2, "signHammer");
  hangLantern(r, ox0 - 3, g.eave + 1);
  hangLantern(r, ox1 + 3, g.eave + 1);
  return finish(r, (rr) => {
    // 煙突の上の火の粉（輪郭を付けない 1 ドット）
    for (let i = 0; i < 7; i++) rr.set(chX + 3 + (h32(i, 1, seed) % 12), 1 + (h32(i, 2, seed) % 9), rc(FIRE, i % 3 === 0 ? 0 : 2));
  });
}

/** 書庫: 茅葺き・土壁。丸窓に灯、右の棚に巻物の小口、藍の暖簾と巻物の看板 */
function drawLibrary(seed: number): Drawn {
  const r = new Raster(W5, H5);
  const g = houseGeom(W5, H5, 44, 72, 14, 30);
  drawRoof(r, g, "thatch", seed);
  drawThatchRidge(r, g);
  drawWall(r, g, "earth", seed);
  drawBeam(r, g.wx0, g.wx1, g.wallTop + 4, WOOD);
  // 戸口と藍の暖簾
  const dx0 = 62;
  const dx1 = 97;
  const dy0 = g.wallBottom - 36;
  drawOpening(r, dx0, dy0, dx1, g.wallBottom);
  drawNoren(r, dx0 + 1, dx1 - 1, dy0 + 2, 18, INDIGO);
  // 丸窓（灯っている）
  const wx = 37;
  const wy = g.wallTop + 21;
  r.ellipse(wx, wy, 12, 12, rc(WOOD, 3));
  r.ellipse(wx, wy, 10, 10, (x, y) => ((x - wx + 20) % 4 === 0 || (y - wy + 20) % 5 === 0 ? rc(WOOD, 2) : y < wy ? role("Y") : role("L")));
  r.glow(wx, wy, "window");
  // 巻物の棚（右の間は格子を外して棚を見せる）
  const sx0 = 106;
  const sx1 = 140;
  const sy0 = g.wallTop + 9;
  const sy1 = g.wallBottom - 4;
  r.paint(sx0, sy0, sx1 - sx0 + 1, sy1 - sy0 + 1, (x, y) => {
    const cx = (x - sx0) % 9;
    const cy = (y - sy0) % 9;
    if (x === sx0 || y === sy0 || cx === 0 || cy === 0) return rc(WOOD, x === sx0 || y === sy0 ? 1 : 2);
    if (x === sx1 || y === sy1) return rc(WOOD, 3);
    return INTERIOR;
  });
  const ties = [role("R"), role("K"), role("N"), role("m")];
  let k = 0;
  for (let y = sy0 + 5; y < sy1 - 2; y += 9) {
    for (let x = sx0 + 5; x < sx1 - 2; x += 9) {
      const n = h32(x, y, seed);
      // 巻物の小口を 1〜2 本（紙の白と軸の色）
      r.ellipse(x - 1, y + 1, 2.6, 2.6, (px, py) => (px < x - 1 && py < y + 1 ? role("P") : role("p")));
      r.set(x - 1, y + 1, ties[k % ties.length] ?? OUTLINE);
      if (n % 2 === 0) {
        r.ellipse(x + 2, y + 2, 2, 2, (px, py) => (px < x + 2 && py < y + 2 ? role("P") : role("p")));
        r.set(x + 2, y + 2, ties[(k + 1) % ties.length] ?? OUTLINE);
      }
      k++;
    }
  }
  for (const px of [g.wx0, dx0 - 5, dx1 + 1, g.wx1 - 4]) drawPillar(r, px, g.wallTop + 4, g.wallBottom, WOOD);
  drawPlinth(r, 8, W5 - 9, g.plinthTop, H5 - 2, seed);
  drawStandSign(r, 13, H5 - 2, "signScroll");
  hangLantern(r, dx0 - 3, g.eave + 2);
  hangLantern(r, dx1 + 3, g.eave + 2);
  return finish(r);
}

/** 社（祭壇）: 銅板の切妻に千木と鰹木。白壁に朱の柱、注連縄と紙垂、鈴と賽銭箱 */
function drawShrine(seed: number): Drawn {
  const r = new Raster(W5, H5);
  const g = houseGeom(W5, H5, 44, 66, 16, 6);
  drawRoof(r, g, "copper", seed);
  drawShrineRidge(r, g);
  drawWall(r, g, "plaster", seed);
  // 腰板
  const waist = g.wallBottom - 14;
  r.paint(g.wx0, waist, g.wx1 - g.wx0 + 1, g.wallBottom - waist + 1, (x, y) => wallColor("board", x, y, g, seed));
  drawBeam(r, g.wx0, g.wx1, waist - 3, SHU, 3);
  drawBeam(r, g.wx0, g.wx1, g.wallTop + 3, SHU);
  // 格子戸
  const dx0 = 58;
  const dx1 = 101;
  const dy0 = g.wallTop + 12;
  r.paint(dx0, dy0, dx1 - dx0 + 1, g.wallBottom - dy0 + 1, (x, y) => {
    if ((x - dx0) % 4 === 0 || (y - dy0) % 10 === 0) return rc(WOOD, (x - dx0) % 4 === 0 ? 1 : 2);
    return INTERIOR;
  });
  for (const [x, y] of [[dx0 + 1, dy0 + 1], [dx1 - 2, dy0 + 1], [dx0 + 1, g.wallBottom - 2], [dx1 - 2, g.wallBottom - 2]] as const) r.rect(x, y, 2, 2, rc(GOLD, 1));
  for (const px of [g.wx0, dx0 - 5, dx1 + 1, g.wx1 - 4]) drawPillar(r, px, g.wallTop + 3, g.wallBottom, SHU);
  // 注連縄（たるみのある太い撚り縄）と紙垂
  const sx0 = 34;
  const sx1 = 125;
  const sy = g.wallTop + 8;
  for (let x = sx0; x <= sx1; x++) {
    const t = (x - sx0) / (sx1 - sx0);
    const sag = Math.round(Math.sin(Math.PI * t) * 4);
    const thick = 5 - Math.round(Math.abs(t - 0.5) * 4);
    for (let k = 0; k < thick; k++) r.set(x, sy + sag + k, rc(ROPE, (x + k) % 4 < 2 ? 1 : 2));
  }
  for (const px of [50, 80, 109]) {
    const t = (px - sx0) / (sx1 - sx0);
    const top = sy + Math.round(Math.sin(Math.PI * t) * 4) + 4;
    for (let k = 0; k < 10; k++) r.rect(px + (Math.floor(k / 2) % 2 === 0 ? 0 : 2), top + k, 2, 1, PAPER_WHITE);
  }
  drawPlinth(r, 10, W5 - 11, g.plinthTop, H5 - 2, seed);
  // 鈴と賽銭箱
  r.stamp("bell", 80, g.wallTop + 6);
  r.stamp("saisen", 80, g.plinthTop + 6);
  hangLantern(r, 36, g.eave + 1);
  hangLantern(r, 124, g.eave + 1);
  return finish(r);
}

/** 御堂（ボスの間）: 瓦の大屋根に千鳥破風。朱の柱・紫の幕・金の扁額・金鋲の大扉 */
function drawHall(seed: number): Drawn {
  const r = new Raster(W5, H5);
  const g = houseGeom(W5, H5, 46, 76, 12, 24);
  drawRoof(r, g, "kawara", seed);
  drawKawaraRidge(r, g);
  drawGable(r, 80, g.ridge + 6, g.eave - 22, 32);
  drawWall(r, g, "board", seed);
  // 大扉（金の鋲）
  const dx0 = 56;
  const dx1 = 103;
  const dy0 = g.wallBottom - 36;
  r.paint(dx0, dy0, dx1 - dx0 + 1, g.wallBottom - dy0 + 1, (x, y) => {
    const mid = Math.round((dx0 + dx1) / 2);
    if (x === mid || x === mid + 1) return rc(WOOD, 4);
    if ((y - dy0) % 8 === 4 && (x - dx0) % 6 === 3) return rc(GOLD, 1);
    if ((y - dy0) % 8 === 5 && (x - dx0) % 6 === 3) return rc(GOLD, 3);
    const c = (x - dx0) % 8;
    return rc(WOOD, c === 0 ? 3 : c === 1 ? 1 : 2);
  });
  r.ellipse(76, dy0 + 20, 2.5, 2.5, rc(GOLD, 1));
  r.ellipse(84, dy0 + 20, 2.5, 2.5, rc(GOLD, 1));
  // 両脇の連子窓
  drawLatticeWindow(r, 22, g.wallTop + 16, 24, 14, false);
  drawLatticeWindow(r, 114, g.wallTop + 16, 24, 14, false);
  for (const px of [g.wx0, dx0 - 6, dx1 + 2, g.wx1 - 4]) drawPillar(r, px, g.wallTop + 2, g.wallBottom, SHU);
  // 紫の幕（白抜きの丸紋）
  const my0 = g.wallTop + 2;
  r.paint(g.wx0, my0, g.wx1 - g.wx0 + 1, 9, (x, y) => {
    const fold = (x - g.wx0) % 12;
    const wave = y - my0 > 6 + (fold < 6 ? 0 : 1);
    if (wave) return CLEAR;
    return rc(PURPLE, fold === 0 ? 3 : fold < 3 ? 1 : 2);
  });
  for (let x = g.wx0 + 14; x < g.wx1 - 6; x += 26) {
    if (Math.abs(x - 80) < 18) continue;
    r.ellipse(x, my0 + 4, 3, 3, PAPER_WHITE);
    r.ellipse(x, my0 + 4, 1.4, 1.4, rc(PURPLE, 2));
  }
  // 扁額（黒漆に金の縁と金の字）
  const px0 = 66;
  const py0 = g.wallTop - 6;
  r.paint(px0, py0, 28, 16, (x, y) => {
    const edge = x - px0 < 2 || y - py0 < 2 || px0 + 27 - x < 2 || py0 + 15 - y < 2;
    if (edge) return rc(GOLD, x - px0 < 2 || y - py0 < 2 ? 1 : 3);
    return rc(LACQUER, 2);
  });
  for (const cx of [px0 + 8, px0 + 18]) {
    r.rect(cx, py0 + 4, 3, 1, rc(GOLD, 1));
    r.rect(cx + 1, py0 + 4, 1, 8, rc(GOLD, 1));
    r.rect(cx - 1, py0 + 7, 5, 1, rc(GOLD, 1));
    r.rect(cx - 1, py0 + 11, 2, 1, rc(GOLD, 2));
    r.rect(cx + 2, py0 + 10, 2, 2, rc(GOLD, 2));
  }
  drawPlinth(r, 6, W5 - 7, g.plinthTop, H5 - 2, seed);
  // 正面の木の階
  r.paint(dx0 + 4, g.plinthTop, dx1 - dx0 - 7, H5 - 1 - g.plinthTop, (_x, y) => {
    const s = (y - g.plinthTop) % 4;
    return rc(WOOD, s === 0 ? 1 : s === 3 ? 3 : 2);
  });
  hangLantern(r, dx0 - 12, g.eave + 1);
  hangLantern(r, dx1 + 12, g.eave + 1);
  return finish(r);
}

const W9 = 9 * TILE_DOTS;
/** 記録の蔵の扉の中心（敷地の左から 1・4・7 マス目の中央。台 h / c / r の真上） */
const ARCHIVE_DOOR_X = [1.5, 4.5, 7.5].map((t) => Math.round(t * TILE_DOTS));

/** 記録の蔵: 瓦・白壁に鉢巻、下はなまこ壁。塗り込めの扉 3 つ、窓 5 つ（灯は描画レーンが archiveLights 個だけ重ねる） */
function drawArchive(seed: number): Drawn {
  const r = new Raster(W9, H5);
  const g = houseGeom(W9, H5, 60, 52, 12, 4);
  drawRoof(r, g, "kawara", seed);
  drawKawaraRidge(r, g);
  drawWall(r, g, "plaster", seed);
  // 鉢巻（軒下の厚い漆喰の帯）
  for (let y = g.wallTop; y < g.wallTop + 8; y++) {
    for (let x = g.wx0 - 2; x <= g.wx1 + 2; x++) {
      const k = y - g.wallTop;
      r.set(x, y, rc(PLASTER, k < 2 ? 2 : k < 6 ? (x < g.wx0 + 4 ? 0 : 1) : k === 6 ? 2 : 3));
    }
  }
  // なまこ壁（斜めの白い目地）
  const ny0 = g.wallBottom - 20;
  r.paint(g.wx0, ny0, g.wx1 - g.wx0 + 1, g.wallBottom - ny0 + 1, (x, y) => {
    const v = y - ny0;
    if (v < 2) return rc(PLASTER, v === 0 ? 0 : 2);
    const a = (x + v) % 10;
    const b = (x - v + 1000) % 10;
    if (a === 0 || b === 0) return rc(PLASTER, 1);
    if (a === 1 || b === 9) return rc(PLASTER, 2);
    return rc(SLATE, (Math.floor((x + v) / 10) + Math.floor((x - v + 1000) / 10)) % 2 === 0 ? 1 : 2);
  });
  // 扉（段のある厚い枠）と上の小窓
  const doorTop = g.wallBottom - 38;
  for (const cx of ARCHIVE_DOOR_X) {
    for (let step = 0; step < 3; step++) {
      const x0 = cx - 17 + step * 2;
      const x1 = cx + 16 - step * 2;
      const y0 = doorTop + step * 2;
      r.paint(x0, y0, x1 - x0 + 1, g.wallBottom - y0 + 1, (x) => rc(PLASTER, x < x0 + 2 ? step : step + 1));
    }
    drawOpening(r, cx - 11, doorTop + 6, cx + 10, g.wallBottom);
    // 奥の棚の影
    for (let y = doorTop + 12; y < g.wallBottom - 2; y += 7) for (let x = cx - 10; x <= cx + 9; x++) r.set(x, y, rc(WOOD, 4));
    hangLantern(r, cx - 22, g.eave + 2);
  }
  const win = (cx: number, cy: number, w: number, h: number): void => {
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(cy - h / 2);
    r.paint(x0 - 2, y0 - 2, w + 4, h + 4, (x, y) => rc(PLASTER, x < x0 || y < y0 ? 1 : 3));
    r.paint(x0, y0, w, h, (x) => ((x - x0) % 3 === 1 ? rc(IRON, 2) : INTERIOR));
    r.glow(cx, cy, "window");
  };
  const winY = g.wallTop + 18;
  win(96, winY + 2, 14, 12);
  win(ARCHIVE_DOOR_X[0] ?? 48, winY - 3, 10, 6);
  win(ARCHIVE_DOOR_X[1] ?? 144, winY - 3, 10, 6);
  win(ARCHIVE_DOOR_X[2] ?? 240, winY - 3, 10, 6);
  win(192, winY + 2, 14, 12);
  drawPlinth(r, 6, W9 - 7, g.plinthTop, H5 - 2, seed);
  return finish(r);
}

const W3 = 3 * TILE_DOTS;
const H3 = (2 + ROOF_RISE_TILES) * TILE_DOTS;

/** 武器小屋: 板葺きの片流れ。開けた正面に刀掛け、交差した刀の看板 */
function drawRackShed(seed: number): Drawn {
  const r = new Raster(W3, H3);
  const g = houseGeom(W3, H3, 34, 38, 6, 0);
  drawRoof(r, g, "plank", seed);
  // 屋根の押さえ石
  for (let i = 0; i < 4; i++) {
    const sx = 14 + i * 22 + (h32(i, 5, seed) % 6);
    const sy = g.ridge + 8 + (h32(i, 6, seed) % 14);
    r.ellipse(sx, sy, 4, 3, (x, y) => rc(STONE, x < sx && y < sy ? 0 : 2));
  }
  drawWall(r, g, "board", seed);
  const ox0 = 14;
  const ox1 = 81;
  const oy0 = g.wallTop + 6;
  // 奥の板壁（提灯の灯がうっすら届く。黒い鞘が闇に沈まないように）
  r.paint(ox0, oy0, ox1 - ox0 + 1, g.wallBottom - oy0 + 1, (x, y) => {
    if (y >= g.wallBottom - 1) return rc(WOOD, 4);
    const c = (x - ox0) % 7;
    return c === 0 ? rc(WOOD, 4) : rc(WOOD, y - oy0 < 4 ? 4 : 3);
  });
  r.stamp("swordRack", 48, g.wallBottom - 1);
  for (const px of [g.wx0, g.wx1 - 4]) drawPillar(r, px, g.wallTop + 2, g.wallBottom, WOOD);
  drawBeam(r, g.wx0, g.wx1, oy0 - 4, WOOD);
  drawPlinth(r, 4, W3 - 5, g.plinthTop, H3 - 2, seed);
  // 屋根看板（軒の上に掲げた交差した刀）
  const sbx = 38;
  const sby = g.eave - 17;
  r.paint(sbx, sby, 20, 15, (x, y) => (x === sbx || y === sby ? rc(WOOD, 1) : x === sbx + 19 || y === sby + 14 ? rc(WOOD, 3) : rc(LACQUER, 2)));
  r.stamp("signSword", sbx + 10, sby + 2);
  hangLantern(r, 10, g.eave + 1);
  return finish(r);
}

const W2 = 2 * TILE_DOTS;
const HB = (1 + ROOF_RISE_TILES) * TILE_DOTS;

/** 高札（掲示の辻）: 笠のある高い札場。白い札に墨の縦書き、足元に竹矢来 */
function drawBoard(seed: number): Drawn {
  const r = new Raster(W2, HB);
  const foot = HB - 2;
  // 足元の竹矢来
  r.paint(3, foot - 14, W2 - 6, 14, (x, y) => {
    const a = (x + y) % 7;
    const b = (x - y + 700) % 7;
    if (a === 0 || b === 0) return rc(BAMBOO, a === 0 ? 1 : 2);
    if (y === foot - 14 || y === foot - 1) return rc(BAMBOO, 2);
    return CLEAR;
  });
  drawPillar(r, 7, 20, foot, WOOD);
  drawPillar(r, W2 - 12, 20, foot, WOOD);
  // 札の板
  const bx0 = 5;
  const bx1 = W2 - 6;
  const by0 = 26;
  const by1 = 60;
  r.paint(bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1, (x, y) => {
    if (x === bx0 || y === by0) return rc(WOOD, 1);
    if (x === bx1 || y === by1) return rc(WOOD, 3);
    return rc(WOOD, 2);
  });
  const sheets: readonly [number, number, number][] = [
    [bx0 + 3, by0 + 3, 16],
    [bx0 + 21, by0 + 4, 14],
    [bx0 + 37, by0 + 3, 13],
  ];
  sheets.forEach(([sx, sy, sw], i) => {
    const sh = by1 - by0 - 7 - (i % 2);
    r.paint(sx, sy, sw, sh, (x, y) => (x === sx + sw - 1 || y === sy + sh - 1 ? role("p") : role("P")));
    for (let cx = sx + sw - 4; cx > sx + 1; cx -= 4) {
      for (let y = sy + 3; y < sy + sh - 3; y++) {
        if (h32(cx, y, seed + i) % 5 !== 0) r.set(cx, y, rc(LACQUER, 2));
      }
    }
  });
  r.rect(bx0 + 23, by0 + 6, 3, 3, role("R"));
  // 笠（板屋根）
  for (let i = 0; i < 8; i++) {
    for (let x = 1 + Math.max(0, 7 - i * 2); x <= W2 - 2 - Math.max(0, 7 - i * 2); x++) r.set(x, 13 + i, rc(WOOD, i === 7 ? 4 : i < 2 ? 1 : 2));
  }
  r.rect(W2 / 2 - 2, 10, 4, 4, rc(WOOD, 2));
  hangLantern(r, W2 - 6, 22);
  return finish(r);
}

const WG = 6 * TILE_DOTS;
const HG = (3 + LOW_RISE_TILES) * TILE_DOTS;

/** 庭: 竹垣の区画に畝が 3 筋（菜・芽・花）。東の口に置き提灯 */
function drawGarden(seed: number): Drawn {
  const r = new Raster(WG, HG);
  const top = TILE_DOTS;
  const foot = HG - 2;
  // 畝
  const rows = [top + 22, top + 44, top + 66];
  for (const [i, ry] of rows.entries()) {
    r.paint(14, ry - 6, WG - 40, 14, (x, y) => {
      const v = y - (ry - 6);
      if (v < 3) return rc(SOIL, 0 + (h32(x, y, seed) % 4 === 0 ? 1 : 0));
      if (v > 10) return rc(SOIL, 3);
      return rc(SOIL, 1 + (h32(x, y, seed) % 5 === 0 ? 1 : 0));
    });
    for (let x = 22; x < WG - 30; x += 14) {
      const jitter = h32(x, i, seed) % 3;
      if (i === 0) r.stamp("cabbage", x + jitter, ry + 3);
      else if (i === 1) r.stamp("sprout", x + jitter, ry + 1);
      else r.stamp("flower", x + jitter, ry + 2);
    }
  }
  // 竹垣（奥と両脇。東の脇は中ほどを口に空ける）
  const fence = (x0: number, x1: number, y0: number, h: number): void => {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y < y0 + h; y++) {
        const c = (x - x0) % 4;
        let col = rc(BAMBOO, c === 0 ? 3 : c === 1 ? 1 : 2);
        if ((y - y0 + (Math.floor((x - x0) / 4) % 2) * 3) % 9 === 0) col = rc(BAMBOO, 0);
        r.set(x, y, col);
      }
    }
    for (const ty of [y0 + 3, y0 + h - 5]) for (let x = x0 - 1; x <= x1 + 1; x++) r.set(x, ty, rc(ROPE, 2));
  };
  fence(3, WG - 4, top - 18, 20);
  for (let y = top + 2; y < foot - 2; y += 1) {
    for (const x0 of [3, WG - 7]) {
      const gate = x0 > 10 && y > top + 30 && y < top + 62;
      if (gate) continue;
      r.rect(x0, y, 4, 1, rc(BAMBOO, (y - top) % 9 === 0 ? 0 : 2));
    }
  }
  // 前の縁石
  for (let x = 6; x < WG - 8; x += 8) r.ellipse(x + 4, foot - 1, 4, 2, (px, py) => rc(STONE, px < x + 4 && py < foot - 1 ? 1 : 2));
  // 東の口の置き提灯（竿に吊る）
  r.rect(WG - 16, top + 14, 3, foot - top - 16, rc(WOOD, 2));
  r.rect(WG - 22, top + 13, 10, 2, rc(WOOD, 1));
  hangLantern(r, WG - 21, top + 15);
  return finish(r);
}

const WY = 11 * TILE_DOTS;
const HY = (11 + LOW_RISE_TILES) * TILE_DOTS;

/** 幟（竿・乳・布・白抜きの丸紋）。足元の竿の位置が (x, footY) */
function drawBanner(r: Raster, x: number, footY: number, cloth: Ramp, height = 84): void {
  const top = footY - height;
  drawPillar(r, x - 1, top + 2, footY - 1, WOOD, 4);
  r.rect(x - 1, top, 4, 3, rc(GOLD, 1));
  r.rect(x + 2, top + 5, 14, 2, rc(WOOD, 2));
  const cx0 = x + 4;
  const cx1 = x + 15;
  const cy0 = top + 7;
  const cy1 = top + Math.round(height * 0.72);
  r.paint(cx0, cy0, cx1 - cx0 + 1, cy1 - cy0 + 1, (px, py) => {
    if (px === cx0) return rc(cloth, 1);
    if (px === cx1 || py === cy1) return rc(cloth, 3);
    if ((py - cy0) % 10 === 0 && px < cx0 + 2) return PAPER_WHITE;
    return rc(cloth, py > cy1 - 10 ? 3 : 2);
  });
  const my = cy0 + 10;
  r.ellipse(cx0 + 6, my, 4, 4, PAPER_WHITE);
  r.ellipse(cx0 + 6, my, 2, 2, rc(cloth, 2));
  for (let y = my + 9; y < cy1 - 12; y += 3) r.rect(cx0 + 5, y, 3, 1, PAPER_WHITE);
}

/** 的（霞的。白と黒の輪）を台に立てる */
function drawTarget(r: Raster, cx: number, footY: number): void {
  const cy = footY - 16;
  r.line(cx - 7, footY - 1, cx - 2, cy, rc(WOOD, 2), 2);
  r.line(cx + 7, footY - 1, cx + 2, cy, rc(WOOD, 3), 2);
  r.ellipse(cx + 0.5, cy + 0.5, 10, 10, (x, y) => {
    const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy - 0.5);
    const ring = Math.floor(d / 2.5);
    return ring % 2 === 0 ? (x < cx && y < cy ? role("O") : role("w")) : rc(LACQUER, 2);
  });
}

/** 稽古場: 柵で囲んだ広場に俵の円（白砂に箒目）、奥に的と幟、脇に木刀掛け。地面に伏せる絵 */
function drawYard(seed: number): Drawn {
  const r = new Raster(WY, HY);
  const top = TILE_DOTS;
  const foot = HY - 2;
  // 俵の円と白砂
  const cx = WY / 2;
  const cy = top + (HY - top) / 2 + 8;
  const rad = 104;
  r.ellipse(cx, cy, rad, rad, (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > rad - 7) {
      const a = Math.atan2(y - cy, x - cx);
      const seg = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 48);
      const edge = rad - d;
      if (edge < 1.2 || edge > 5.8) return rc(THATCH, 3);
      return rc(THATCH, (seg % 2 === 0 ? 1 : 2) + (y > cy ? 0.6 : 0));
    }
    // 箒目: 6 ドットおきの細い筋。左上ほど明るい
    const rake = Math.floor(d) % 6 === 0;
    const lit = x < cx - 30 && y < cy - 20 ? 0.6 : 1.2;
    return rc(SAND, (rake ? 2.4 : lit) + (h32(x, y, seed) % 19 === 0 ? 0.8 : 0));
  });
  // 柵（低い杭と 2 本の横木）。西の脇の中ほどは口
  const post = (x: number, y: number): void => {
    drawPillar(r, x, y - 14, y, WOOD, 4);
    r.rect(x, y - 15, 4, 1, rc(WOOD, 0));
  };
  const rail = (x0: number, x1: number, y: number): void => {
    for (let x = x0; x <= x1; x++) {
      r.set(x, y, rc(WOOD, 1));
      r.set(x, y + 1, rc(WOOD, 3));
    }
  };
  for (const fy of [top + 14, foot]) {
    rail(3, WY - 4, fy - 11);
    rail(3, WY - 4, fy - 5);
    for (let x = 3; x < WY - 4; x += 32) post(x, fy);
    post(WY - 7, fy);
  }
  for (let y = top + 14; y <= foot; y += 32) {
    const gate = y > top + 100 && y < top + 200;
    if (!gate) post(3, y);
    post(WY - 7, y);
  }
  for (let y = top + 4; y < foot - 14; y++) {
    const gate = y > top + 90 && y < top + 196;
    if (!gate) r.rect(4, y, 2, 1, rc(WOOD, 2));
    r.rect(WY - 6, y, 2, 1, rc(WOOD, 2));
  }
  // 奥の的: 茅の小屋根を載せた安土（土の壁）の前に 2 つ
  const ax0 = WY - 150;
  const ax1 = WY - 40;
  const ay0 = top + 6;
  for (let i = 0; i < 6; i++) for (let x = ax0 - 4 + i; x <= ax1 + 4 - i; x++) r.set(x, ay0 - 6 + i, rc(THATCH, i === 5 ? 4 : i < 2 ? 0 : 1 + (x % 2) * 0.6));
  r.paint(ax0, ay0, ax1 - ax0 + 1, 22, (x, y) => {
    if (y - ay0 < 3) return rc(EARTH, 4);
    return rc(EARTH, (x < ax0 + 6 ? 1 : 2) + (h32(x, y, seed) % 9 === 0 ? 1 : 0) + (y - ay0 > 18 ? 1 : 0));
  });
  drawTarget(r, WY - 118, top + 34);
  drawTarget(r, WY - 72, top + 34);
  // 幟（藍）を奥の両隅に
  drawBanner(r, 20, top + 40, INDIGO, 80);
  drawBanner(r, WY - 30, top + 40, INDIGO, 80);
  // 木刀掛け（東の柵の内側）
  const kx = WY - 40;
  const ky = foot - 70;
  drawPillar(r, kx, ky - 24, ky, WOOD, 4);
  drawPillar(r, kx + 22, ky - 24, ky, WOOD, 4);
  for (let i = 0; i < 3; i++) {
    const y = ky - 20 + i * 6;
    for (let x = kx - 3; x <= kx + 28; x++) {
      r.set(x, y, rc(FRESH, 1));
      r.set(x, y + 1, rc(FRESH, 3));
    }
  }
  return finish(r);
}

// ---------------------------------------------------------------------------
// 建つ前の空き地: 地鎮の青竹と注連縄、縄張りの杭と縄、礎石、積んだ材木、足場

interface EmptyLotOpts {
  /** 敷地の奥行き（マス） */
  rows: number;
  /** 足場を組むか（大きな建物の空き地だけ） */
  scaffold: boolean;
  /** 草が伸びた空き地（庭・稽古場） */
  overgrown: boolean;
}

/** 縄（2 色の撚り）を (x0, y0) から (x1, y1) へ。sag は中ほどのたるみ */
function drawRope(r: Raster, x0: number, y0: number, x1: number, y1: number, sag: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag);
    r.set(x, y, rc(ROPE, i % 3 === 0 ? 2 : 1));
  }
}

/** 紙垂（白い稲妻形の紙）を (x, y) から下へ */
function drawShide(r: Raster, x: number, y: number): void {
  for (let k = 0; k < 8; k++) r.rect(x + (Math.floor(k / 2) % 2 === 0 ? 0 : 1), y + k, 2, 1, PAPER_WHITE);
}

/** 青竹（地鎮の四隅）。足元が (x, footY) */
function drawBamboo(r: Raster, x: number, footY: number, h: number): void {
  for (let y = footY - h; y < footY; y++) {
    r.set(x, y, rc(BAMBOO, 1));
    r.set(x + 1, y, rc(BAMBOO, (footY - y) % 9 === 0 ? 0 : 2));
  }
  const ty = footY - h;
  r.ellipse(x + 1, ty, 5, 3, (px, py) => rc(BAMBOO, px < x + 1 && py < ty ? 1 : 2));
  r.ellipse(x - 2, ty + 3, 3, 2, rc(BAMBOO, 2));
  r.ellipse(x + 4, ty + 2, 3, 2, rc(BAMBOO, 3));
}

/** 積んだ材木（小口を手前に向けた丸太の山） */
function drawLumber(r: Raster, x0: number, footY: number, seed: number): void {
  const R = 4;
  const layers = [4, 3, 2];
  const logs: [number, number][] = [];
  layers.forEach((count, li) => {
    for (let i = 0; i < count; i++) logs.push([x0 + R + li * R + i * (R * 2) + 0.5, footY - R - li * (R * 2 - 1) + 0.5]);
  });
  // 先に胴（奥へ伸びる）をすべて、後で小口を下の段から重ねる
  for (const [cx, cy] of logs) r.paint(Math.round(cx - R), Math.round(cy - R - 6), R * 2, 6, (x) => rc(FRESH, x < cx - 1 ? 2 : 3));
  for (const [cx, cy] of logs) {
    r.ellipse(cx, cy, R, R, (x, y) => {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > R - 1) return rc(FRESH, 3);
      if (Math.floor(d) === 1 && h32(x, y, seed) % 2 === 0) return rc(FRESH, 2);
      return rc(FRESH, x < cx && y < cy ? 0 : 1);
    });
  }
}

/** 足場（丸太の柱・横木・筋交い・板） */
function drawScaffold(r: Raster, x0: number, x1: number, footY: number, topY: number): void {
  const poles = [x0, Math.round((x0 + x1) / 2), x1];
  for (let y = topY + 8; y < footY - 4; y += 14) r.line(x0, y, x1 + 1, y, rc(FRESH, 2), 2);
  r.line(x0 + 1, footY - 6, x1, topY + 10, rc(FRESH, 3), 2);
  for (const px of poles) {
    for (let y = topY; y < footY; y++) {
      r.set(px, y, rc(FRESH, 1));
      r.set(px + 1, y, rc(FRESH, 3));
    }
  }
  // 板（中段に 1 枚）
  const py = topY + 22;
  r.paint(x0 - 2, py, x1 - x0 + 6, 3, (_x, y) => rc(FRESH, y === py ? 0 : 2));
}

/** 草むら（伸びた空き地） */
function drawWeeds(r: Raster, x0: number, y0: number, x1: number, y1: number, seed: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = x0 + (h32(i, 11, seed) % Math.max(1, x1 - x0));
    const y = y0 + (h32(i, 12, seed) % Math.max(1, y1 - y0));
    const h = 3 + (h32(i, 13, seed) % 4);
    for (let k = 0; k < h; k++) {
      r.set(x - Math.floor(k / 2), y - k, rc(BAMBOO, k > h - 2 ? 1 : 2));
      r.set(x + 2 + Math.floor(k / 3), y - k, rc(BAMBOO, k > h - 2 ? 1 : 3));
    }
  }
}

function drawEmptyLot(W: number, H: number, opts: EmptyLotOpts, seed: number): Drawn {
  const r = new Raster(W, H);
  const gy0 = H - opts.rows * TILE_DOTS + 8;
  const gy1 = H - 3;
  const gx0 = 6;
  const gx1 = W - 8;
  const ropeH = 7;
  if (!opts.overgrown) r.paint(gx0 + 2, gy0 - 2, gx1 - gx0 - 2, gy1 - gy0, (x, y) => (h32(x >> 1, y >> 1, seed) % 7 === 0 ? DUG_SOIL_DARK : DUG_SOIL));
  if (opts.overgrown) drawWeeds(r, gx0 + 4, gy0 + 6, gx1 - 4, gy1 - 2, seed, Math.round((W * (gy1 - gy0)) / 260));
  // 礎石（柱が立つ位置の目印）
  if (!opts.overgrown) {
    const cols = Math.max(2, Math.round((gx1 - gx0) / 34));
    const lines = Math.max(1, opts.rows);
    for (let j = 0; j <= lines; j++) {
      for (let i = 0; i <= cols; i++) {
        const sx = gx0 + 8 + ((gx1 - gx0 - 16) * i) / cols;
        const sy = gy0 + 6 + ((gy1 - gy0 - 12) * j) / lines;
        if (h32(i, j, seed) % 5 === 0) continue;
        r.ellipse(sx, sy, 4, 2.5, (x, y) => rc(STONE, x < sx && y < sy ? 0 : 2));
      }
    }
  }
  // 足場（奥の片側）と材木（手前の反対側）
  const side = (seed >>> 5) % 2 === 0;
  if (opts.scaffold) {
    const sx0 = side ? Math.round(W * 0.56) : Math.round(W * 0.12);
    drawScaffold(r, sx0, sx0 + Math.round(W * 0.3), gy0 + 18, Math.max(4, gy0 - 34));
  }
  const lx = side ? gx0 + 10 : gx1 - 40;
  drawLumber(r, lx, gy1 - 4, seed);
  if (!opts.overgrown && W >= 3 * TILE_DOTS) {
    // 土の山
    const mx = side ? gx1 - 30 : gx0 + 34;
    r.ellipse(mx, gy1 - 8, 12, 6, (x, y) => rc(SOIL, x < mx && y < gy1 - 10 ? 0 : 1 + (h32(x, y, seed) % 4 === 0 ? 1 : 0)));
  }
  // 縄張り: 杭と縄（奥 → 脇 → 手前の順で重ねる）
  const span = Math.max(1, Math.round((gx1 - gx0) / 40));
  const xs = Array.from({ length: span + 1 }, (_, i) => Math.round(gx0 + ((gx1 - gx0) * i) / span));
  for (let i = 0; i < span; i++) drawRope(r, (xs[i] ?? gx0) + 1, gy0 - ropeH, (xs[i + 1] ?? gx1) + 1, gy0 - ropeH, 2);
  drawRope(r, gx0 + 1, gy0 - ropeH, gx0 + 1, gy1 - ropeH, 0);
  drawRope(r, gx1 + 1, gy0 - ropeH, gx1 + 1, gy1 - ropeH, 0);
  for (const x of xs) r.stamp("stake", x, gy0);
  // 地鎮の青竹（四隅）と注連縄（手前）
  const bh = 26;
  drawBamboo(r, gx0 - 3, gy0 - 1, bh);
  drawBamboo(r, gx1 + 3, gy0 - 1, bh);
  for (let i = 0; i < span; i++) drawRope(r, (xs[i] ?? gx0) + 1, gy1 - ropeH, (xs[i + 1] ?? gx1) + 1, gy1 - ropeH, 2);
  for (const x of xs) r.stamp("stake", x, gy1);
  drawBamboo(r, gx0 - 3, gy1, bh);
  drawBamboo(r, gx1 + 3, gy1, bh);
  drawRope(r, gx0 - 1, gy1 - bh + 6, gx1 + 4, gy1 - bh + 6, 5);
  const shideN = Math.max(2, Math.round((gx1 - gx0) / 36));
  for (let i = 1; i <= shideN; i++) {
    const t = i / (shideN + 1);
    const x = Math.round(gx0 - 1 + (gx1 - gx0 + 5) * t);
    drawShide(r, x, gy1 - bh + 7 + Math.round(Math.sin(Math.PI * t) * 5));
  }
  return finish(r);
}

// ---------------------------------------------------------------------------
// 井戸（段 0〜3）

const WELL_TIER_MAX = 3;

/** 跳ね釣瓶（支柱・天秤の竿・縄・桶） */
function drawSweep(r: Raster, wellX: number, rimY: number): void {
  const px = 12;
  drawPillar(r, px, 40, rimY + 12, WOOD, 4);
  r.rect(px - 1, 38, 6, 3, rc(WOOD, 1));
  // 竿: 左下の重石から右上へ
  r.line(2, 58, 70, 22, rc(WOOD, 1), 2);
  r.ellipse(5, 59, 4, 3, (x, y) => rc(STONE, x < 5 && y < 59 ? 0 : 2));
  // 縄と桶
  r.line(wellX + 22, 24, wellX + 22, rimY - 14, rc(ROPE, 2));
  r.stamp("bucket", wellX + 22, rimY - 4);
}

function drawWellTier(tierIn: number): Drawn {
  const tier = Math.max(0, Math.min(WELL_TIER_MAX, Math.round(tierIn)));
  const W = 2 * TILE_DOTS + WELL_EXTRA_W;
  const H = (2 + ROOF_RISE_TILES) * TILE_DOTS;
  const r = new Raster(W, H);
  const cx = W / 2;
  const cy = H - TILE_DOTS;
  // 石畳の円と花（段 3）
  if (tier >= 3) {
    r.ellipse(cx, cy + 4, 38, 22, (x, y) => {
      const a = Math.atan2(y - cy - 4, (x - cx) * 0.6);
      const d = Math.hypot((x - cx) / 38, (y - cy - 4) / 22);
      const seam = Math.floor(d * 4) !== Math.floor((d + 0.06) * 4) || Math.floor((a / Math.PI) * 8 + d * 3) !== Math.floor((a / Math.PI) * 8 + d * 3 + 0.12);
      return rc(STONE, seam ? 3 : x < cx && y < cy ? 1 : 2);
    });
  }
  // 井筒
  const rimY = cy - 2;
  if (tier === 0) {
    // 井桁（丸太を井の字に組む）: 上から見た枠と、手前の丸太の積み
    const x0 = Math.round(cx - 18);
    const x1 = Math.round(cx + 17);
    r.paint(x0, rimY + 2, x1 - x0 + 1, 12, (x, y) => {
      const ly = y - rimY - 2;
      if (ly % 4 === 3) return rc(WOOD, 3);
      return rc(WOOD, x < x0 + 3 ? 1 : ly % 4 === 0 ? 1 : 2);
    });
    for (let ly = 0; ly < 3; ly++) {
      r.ellipse(x0 - 1, rimY + 4 + ly * 4, 2, 2, (x, y) => rc(FRESH, x < x0 - 1 && y < rimY + 4 + ly * 4 ? 1 : 2));
      r.ellipse(x1 + 2, rimY + 4 + ly * 4, 2, 2, rc(FRESH, 2));
    }
    r.paint(x0 - 3, rimY - 8, x1 - x0 + 7, 10, (x, y) => {
      const lx = x - x0;
      const ly = y - rimY + 8;
      const hole = lx >= 4 && lx <= x1 - x0 - 4 && ly >= 3 && ly <= 7;
      if (hole) return ly < 5 ? INTERIOR : rc(INDIGO, lx < 12 ? 2 : 3);
      const logRow = ly < 3 || ly > 7;
      const logCol = (lx >= 0 && lx < 4) || (lx > x1 - x0 - 4 && lx <= x1 - x0);
      if (!logRow && !logCol) return CLEAR;
      if (logRow) return rc(WOOD, ly === 0 || ly === 8 ? 0 : ly === 2 || ly === 9 ? 3 : 1);
      return rc(WOOD, lx === 0 || lx === x1 - x0 - 3 ? 0 : 2);
    });
  } else {
    // 石の縁（上の輪と側面の石積み）
    r.paint(cx - 18, rimY, 36, 14, (x, y) => {
      const ly = y - rimY;
      const joint = (x - cx + 18 + Math.floor(ly / 5) * 6) % 12 === 0 || ly % 5 === 4;
      return rc(STONE, joint ? 3 : x < cx - 12 ? 1 : 2);
    });
    r.ellipse(cx, rimY, 18, 7, (x, y) => rc(STONE, x < cx && y < rimY ? 0 : 1));
    r.ellipse(cx, rimY, 13, 4.5, (x, y) => (y < rimY - 1 ? INTERIOR : rc(INDIGO, x < cx ? 2 : 3)));
    r.rect(cx - 4, rimY + 1, 3, 1, role("l"));
  }
  if (tier <= 1) drawSweep(r, cx, rimY);
  if (tier === 1) r.stamp("bucket", cx + 26, rimY + 14);
  if (tier >= 2) {
    // 屋形（2 本の柱・小さな瓦の切妻・滑車）
    const p0 = Math.round(cx - 21);
    const p1 = Math.round(cx + 17);
    drawPillar(r, p0, 42, rimY + 10, WOOD, 4);
    drawPillar(r, p1, 42, rimY + 10, WOOD, 4);
    drawBeam(r, p0, p1 + 3, 44, WOOD, 3);
    for (let i = 0; i < 12; i++) {
      const ins = Math.max(0, 11 - i) * 1.4;
      for (let x = Math.round(4 + ins); x <= Math.round(W - 5 - ins); x++) r.set(x, 28 + i, rc(KAWARA, i === 11 ? 4 : i < 2 ? 0 : x % 5 === 0 ? 3 : 2));
    }
    r.rect(Math.round(cx) - 18, 24, 36, 4, rc(KAWARA, 1));
    r.ellipse(cx, 50, 3, 3, (x, y) => rc(IRON, x < cx && y < 50 ? 0 : 2));
    r.line(Math.round(cx) - 1, 53, Math.round(cx) - 1, rimY - 14, rc(ROPE, 2));
    r.line(Math.round(cx) + 1, 53, Math.round(cx) + 1, rimY - 2, rc(ROPE, 1));
    r.stamp("bucket", cx - 1, rimY - 4);
  }
  if (tier >= 3) {
    for (const [fx, fy] of [[8, cy + 14], [W - 10, cy + 16], [12, cy - 6], [W - 12, cy - 4]] as const) r.stamp("flower", fx, fy);
  }
  return finish(r, (rr) => rr.shadow(cx + 2, rimY + 14, 24, 3));
}

// ---------------------------------------------------------------------------
// 鳥居と石段

const TORII_W = 6 * TILE_DOTS;
const TORII_H = 4 * TILE_DOTS;
/** 石段の段数と 1 段の高さ（ドット） */
const STAIR_STEPS = 8;
const STAIR_STEP_DOTS = 8;

/**
 * 石段・袖の石垣・奥の灯（鳥居と同じ大きさの画布。足元の点も同じ）。
 * 石段はプレイヤーが上を歩く地面なので、鳥居の柱と別の絵にして常に体より奥に描く（一枚の絵だと石段の上で体が隠れた）
 */
function drawToriiSteps(): Drawn {
  const r = new Raster(TORII_W, TORII_H);
  const seed = hashString("torii");
  // 石段（手前ほど明るく、奥は宵の闇へ沈む）
  const sx0 = TILE_DOTS;
  const sx1 = 5 * TILE_DOTS - 1;
  const stairBottom = 3 * TILE_DOTS - 1;
  for (let s = 0; s < STAIR_STEPS; s++) {
    const y1 = stairBottom - s * STAIR_STEP_DOTS;
    // 奥ほど宵の闇へ沈む（最奥の 2 段はほぼ影）
    const dark = s < 2 ? 0 : (s - 1) * 0.42;
    for (let k = 0; k < STAIR_STEP_DOTS; k++) {
      const y = y1 - k;
      const riser = k < 3;
      for (let x = sx0; x <= sx1; x++) {
        let i: number;
        if (riser) i = k === 0 ? 4 : 3;
        else i = k === STAIR_STEP_DOTS - 1 ? 0 : x < sx0 + 6 ? 0.6 : 1.4;
        if (!riser && h32(x, y, seed) % 17 === 0) i += 0.8;
        if (riser && (x - sx0 + s * 13) % 26 === 0) i = 4;
        r.set(x, y, rc(STONE, i + dark));
      }
    }
  }
  const topY = stairBottom - STAIR_STEPS * STAIR_STEP_DOTS;
  r.glow((sx0 + sx1) / 2, topY + 2, "gate");
  // 袖の石垣
  for (const cx of [sx0 - 6, sx1 + 1]) {
    r.paint(cx, topY + 1, 6, stairBottom - topY, (x, y) => rc(STONE, (y + (x > cx + 2 ? 4 : 0)) % 9 === 0 ? 3 : (x === cx ? 1 : 2) + (y < topY + 24 ? 1 : 0)));
  }
  return finish(r);
}

/** 鳥居の柱・貫・額・島木・笠木（石段は drawToriiSteps） */
function drawTorii(): Drawn {
  const r = new Raster(TORII_W, TORII_H);
  // 柱（根巻は黒）
  const pw = 10;
  const p0 = 11;
  const p1 = TORII_W - 21;
  const shades = [0, 1, 1, 2, 2, 2, 2, 3, 3, 4];
  for (const px of [p0, p1]) {
    for (let y = 24; y < TORII_H - 1; y++) {
      for (let dx = 0; dx < pw; dx++) {
        const base = y > TORII_H - 14 ? rc(LACQUER, (shades[dx] ?? 2) * 0.7 + 0.5) : rc(SHU, shades[dx] ?? 2);
        r.set(px + dx, y, base);
      }
    }
    r.rect(px - 1, TORII_H - 14, pw + 2, 1, rc(GOLD, 2));
  }
  // 貫
  for (let k = 0; k < 7; k++) for (let x = 4; x < TORII_W - 4; x++) r.set(x, 50 + k, rc(SHU, [1, 1, 2, 2, 2, 3, 4][k] ?? 2));
  // 額束と額
  const mid = TORII_W / 2;
  r.paint(mid - 5, 30, 10, 20, (x) => rc(SHU, x < mid - 2 ? 1 : 2));
  r.paint(mid - 10, 31, 20, 17, (x, y) => {
    const edge = x - (mid - 10) < 2 || y - 31 < 2 || mid + 9 - x < 2 || 47 - y < 2;
    if (edge) return rc(GOLD, x - (mid - 10) < 2 || y - 31 < 2 ? 1 : 3);
    return rc(LACQUER, 2);
  });
  for (const gy of [35, 41]) {
    r.rect(mid - 3, gy, 6, 1, rc(GOLD, 1));
    r.rect(mid - 1, gy - 1, 2, 4, rc(GOLD, 1));
  }
  // 島木（朱）と笠木（黒。両端が反り上がる）
  for (let k = 0; k < 6; k++) for (let x = 3; x < TORII_W - 3; x++) r.set(x, 23 + k, rc(SHU, [1, 2, 2, 2, 3, 4][k] ?? 2));
  for (let x = 1; x < TORII_W - 1; x++) {
    const d = Math.min(x - 1, TORII_W - 2 - x);
    const lift = d < 26 ? Math.round(7 * (1 - d / 26) ** 2) : 0;
    for (let k = 0; k < 10; k++) r.set(x, 12 - lift + k, rc(LACQUER, k === 0 ? 0 : k < 3 ? 1 : k < 8 ? 2 : 3));
  }
  return finish(r);
}

// ---------------------------------------------------------------------------
// 石灯籠・幟・碑

function drawStoneLantern(): Drawn {
  const sp = TOWN_PROPS.stoneLantern;
  const W = sp.w + 6;
  const H = sp.h + 2;
  const r = new Raster(W, H);
  r.stamp("stoneLantern", W / 2, H - 2, "lantern");
  return finish(r, (rr) => rr.shadow(W / 2 + 1, H - 3, 12, 2.5));
}

function drawTrophy(chapterIn: number): Drawn {
  const chapter = Math.max(1, Math.min(TROPHY_CHAPTER_MAX, Math.round(chapterIn)));
  const W = 24;
  const H = 96;
  const r = new Raster(W, H);
  drawBanner(r, 5, H - 2, CHAPTER_CLOTH[chapter - 1] ?? SHU, 88);
  r.ellipse(6, H - 3, 5, 2.5, (x, y) => rc(STONE, x < 6 && y < H - 3 ? 0 : 2));
  return finish(r, undefined, 6);
}

function steleStage(tier: number): number {
  let stage = -1;
  STELE_STAGE_TIERS.forEach((t, i) => {
    if (tier >= t) stage = i;
  });
  return stage;
}

/** 踏破の碑。段 0 = 位階 1（碑と台座 1 段）、1 = 台座 2 段、2 = 金の縁と金の字、3 = 台座 3 段、4 = 注連縄と金の笠 */
function drawStele(tierIn: number): Drawn {
  const stage = steleStage(Math.round(tierIn));
  const W = 2 * TILE_DOTS;
  const H = 3 * TILE_DOTS;
  const r = new Raster(W, H);
  const cx = W / 2;
  const steps = stage < 0 ? 1 : stage >= 3 ? 3 : stage >= 1 ? 2 : 1;
  let y = H - 2;
  for (let s = 0; s < steps; s++) {
    const hw = 26 - s * 5;
    const sy = y - 7;
    r.paint(Math.round(cx - hw), sy, hw * 2, 8, (x, yy) => rc(STONE, yy - sy < 2 ? (x < cx - hw + 3 ? 0 : 1) : yy === sy + 7 ? 4 : 2));
    y = sy - 1;
  }
  if (stage >= 0) {
    const sw = 22;
    const sh = 44;
    const x0 = Math.round(cx - sw / 2);
    const y0 = y - sh + 1;
    const gold = stage >= 2;
    r.paint(x0, y0, sw, sh, (x, yy) => {
      const lx = x - x0;
      const ly = yy - y0;
      // 角を丸めた頭
      if (ly < 3 && (lx < 3 - ly || lx > sw - 4 + ly)) return CLEAR;
      if (gold && (lx === 1 || ly === 1 || lx === sw - 2)) return rc(GOLD, lx === 1 || ly === 1 ? 1 : 2);
      if (lx < 4) return rc(STELE_STONE, 1);
      if (lx > sw - 5) return rc(STELE_STONE, 3);
      return rc(STELE_STONE, 2);
    });
    // 刻んだ字（縦一列）
    for (let k = 0; k < 6; k++) {
      const gy = y0 + 7 + k * 5;
      const ink = gold ? rc(GOLD, 1) : rc(STELE_STONE, 0);
      r.rect(cx - 2 + (k % 2), gy, 4, 1, ink);
      r.rect(cx - 1, gy + 1, 1, 2, ink);
      if (k % 3 !== 1) r.rect(cx + 1, gy + 2, 2, 1, ink);
    }
    if (stage >= 4) {
      r.rect(x0 - 2, y0 - 3, sw + 4, 4, rc(GOLD, 1));
      r.rect(x0, y0 - 6, sw, 3, rc(GOLD, 2));
      drawRope(r, x0 - 2, y0 + 16, x0 + sw + 1, y0 + 16, 2);
      drawRope(r, x0 - 2, y0 + 17, x0 + sw + 1, y0 + 17, 2);
      drawShide(r, x0 + 5, y0 + 19);
      drawShide(r, x0 + sw - 7, y0 + 19);
    }
  }
  return finish(r, (rr) => rr.shadow(cx + 2, H - 3, 28, 3));
}

// ---------------------------------------------------------------------------
// 賑わいの小物

/** 俵（横に寝かせた藁の束と縄の帯）。左上が (x, y) */
function drawBale(r: Raster, x: number, y: number, w: number, h: number): void {
  r.paint(x, y, w, h, (px, py) => {
    const lx = px - x;
    const ly = py - y;
    const round = (lx < 2 || lx > w - 3) && (ly === 0 || ly === h - 1);
    if (round) return CLEAR;
    if (lx === Math.floor(w * 0.25) || lx === Math.floor(w * 0.75)) return rc(ROPE, 3);
    if (lx < 3) return rc(THATCH, 0);
    return rc(THATCH, ly < h / 2 ? 1 : 2);
  });
}

function drawClutter(indexIn: number): Drawn {
  const kind = ((Math.round(indexIn) % CLUTTER_KINDS) + CLUTTER_KINDS) % CLUTTER_KINDS;
  if (kind === 0) {
    // 樽 2 つと桶
    const r = new Raster(48, 32);
    r.stamp("barrel", 12, 30);
    r.stamp("barrel", 28, 30);
    r.stamp("bucket", 41, 30);
    return finish(r, (rr) => rr.shadow(26, 29, 22, 3));
  }
  if (kind === 1) {
    // 荷車（大八車）に俵
    const r = new Raster(68, 40);
    drawBale(r, 6, 6, 22, 10);
    drawBale(r, 26, 5, 22, 11);
    r.paint(2, 16, 50, 5, (x, y) => rc(WOOD, y === 16 ? 1 : x % 10 === 0 ? 3 : 2));
    r.line(50, 18, 65, 30, rc(WOOD, 2), 2);
    r.line(50, 20, 65, 34, rc(WOOD, 3), 1);
    const wx = 24;
    const wy = 26;
    r.ellipse(wx + 0.5, wy + 0.5, 12, 12, (x, y) => {
      const d = Math.hypot(x - wx, y - wy);
      if (d > 9.5) return rc(WOOD, x < wx && y < wy ? 1 : 3);
      if (d < 2.5) return rc(IRON, 1);
      const a = Math.atan2(y - wy, x - wx);
      const spoke = Math.abs(Math.sin(a * 4)) < 0.28;
      return spoke ? rc(WOOD, 2) : CLEAR;
    });
    return finish(r, (rr) => rr.shadow(32, 38, 28, 2));
  }
  if (kind === 2) {
    // 洗濯物（物干し竿に藍の浴衣・手拭い・朱の布）
    const r = new Raster(64, 56);
    for (const px of [4, 58]) for (let y = 6; y < 54; y++) r.rect(px, y, 2, 1, rc(BAMBOO, (y - 6) % 10 === 0 ? 0 : px === 4 ? 1 : 2));
    for (let x = 2; x < 62; x++) {
      r.set(x, 8, rc(BAMBOO, 1));
      r.set(x, 9, rc(BAMBOO, 3));
    }
    r.paint(9, 10, 26, 10, (x, y) => rc(INDIGO, (x + y) % 6 === 0 ? 0 : x < 12 ? 1 : 2));
    r.paint(15, 20, 14, 26, (x, y) => ((x * 3 + y * 5) % 11 === 0 ? PAPER_WHITE : rc(INDIGO, x < 17 ? 1 : x > 26 ? 3 : 2)));
    r.paint(38, 10, 8, 20, (x, y) => (y % 9 === 4 ? rc(INDIGO, 1) : x === 45 ? role("w") : role("O")));
    r.paint(49, 10, 7, 15, (x, y) => rc(SHU, x === 49 ? 1 : y === 24 ? 3 : 2));
    r.stamp("bucket", 40, 54);
    return finish(r, (rr) => rr.shadow(32, 53, 26, 2));
  }
  if (kind === 3) {
    // 木箱に座る猫
    const r = new Raster(32, 36);
    r.paint(4, 20, 24, 14, (x, y) => {
      if (y === 20) return rc(WOOD, 0);
      if (y < 23) return rc(WOOD, 1);
      if (x === 4 || x === 27 || (y - 23) % 5 === 4) return rc(WOOD, 3);
      return rc(WOOD, 2);
    });
    r.stamp("cat", 15, 21);
    return finish(r, (rr) => rr.shadow(16, 34, 14, 2));
  }
  if (kind === 4) {
    // 俵の山と木箱
    const r = new Raster(52, 36);
    drawBale(r, 2, 22, 22, 11);
    drawBale(r, 22, 22, 22, 11);
    drawBale(r, 12, 12, 22, 11);
    r.paint(38, 14, 12, 19, (x, y) => (x === 38 || y === 14 ? rc(WOOD, 1) : (y - 14) % 6 === 5 ? rc(WOOD, 3) : rc(WOOD, 2)));
    return finish(r, (rr) => rr.shadow(26, 34, 24, 2));
  }
  // 鉢植え（花と菜）
  const r = new Raster(44, 26);
  const pots: readonly [number, TownPropKey][] = [
    [8, "flower"],
    [22, "cabbage"],
    [36, "flower"],
  ];
  for (const [px, plant] of pots) {
    r.paint(px - 5, 15, 11, 9, (x, y) => (y === 15 ? rc(EARTH, 0) : rc(EARTH, x < px - 2 ? 1 : x > px + 3 ? 3 : 2)));
    r.paint(px - 4, 14, 9, 2, (_x, y) => rc(SOIL, y === 14 ? 1 : 2));
    r.stamp(plant, px, 15);
  }
  return finish(r, (rr) => rr.shadow(22, 24, 20, 2));
}

// ---------------------------------------------------------------------------
// 振り分け

function drawLot(lot: HubLotKey, built: boolean): Drawn {
  const seed = hashString(lot);
  if (lot === "well") return built ? drawWellTier(0) : drawEmptyLot(lotSize("well").W, lotSize("well").H, { rows: 2, scaffold: false, overgrown: false }, seed);
  if (!built) {
    const { W, H } = lotSize(lot);
    const t = TOWN_LOT_TILES[lot];
    const overgrown = lot === "garden" || lot === "yard";
    return drawEmptyLot(W, H, { rows: t.h, scaffold: !overgrown && t.w >= 5, overgrown }, seed);
  }
  switch (lot) {
    case "forge":
      return drawForge(seed);
    case "library":
      return drawLibrary(seed);
    case "shrine":
      return drawShrine(seed);
    case "hall":
      return drawHall(seed);
    case "archive":
      return drawArchive(seed);
    case "rackShed":
      return drawRackShed(seed);
    case "board":
      return drawBoard(seed);
    case "garden":
      return drawGarden(seed);
    case "yard":
      return drawYard(seed);
  }
}

function drawObject(kind: TownObjectKind): Drawn {
  switch (kind.type) {
    case "lot":
      return drawLot(kind.lot, kind.built);
    case "well":
      return drawWellTier(kind.tier);
    case "torii":
      return drawTorii();
    case "toriiSteps":
      return drawToriiSteps();
    case "lantern":
      return drawStoneLantern();
    case "trophy":
      return drawTrophy(kind.chapter);
    case "stele":
      return drawStele(kind.tier);
    case "clutter":
      return drawClutter(kind.index);
  }
}
