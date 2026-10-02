// 置物と飾りの配置（docs/ideas/map-visual-impl.md 2-3 節・4 章 L4）。
// 当たりを持たず、チャンクの焼き付け（mapBake.ts）が終わった後に画素列へ直接描き込む。毎フレームの描画は増えない。
// 置き場所は「地図とテーマだけ」で決める（state.rng・Math.random・state.seed は使わない）。ばらつきは座標ハッシュ。
//
// チャンクの割り方で絵が変わらないようにするため、1 マスごとの置く / 置かないは「そのマスの周りだけ」で決まる規則にしてある:
//   候補 = マスの種類と座標ハッシュだけで決まる
//   間引き = 周りの候補のうちハッシュが最大のものだけ残す（置物どうしの間隔。貪欲に順に置くとチャンクの順に依存するので使わない）
// 描き込みはチャンクの外に根元があるものも、チャンクにはみ出す分を描く（根元のマスを周り 1 マスまで数える）。
import type { GameMap } from "../map/grid";
import { TILE_SIZE, Tile } from "../map/grid";
import type { FloorLayout } from "../map/layout/types";
import { MAP_PROP_ROLES, MAP_PROP_SPRITES, isMapPropSpriteKind, type MapPropRole, type MapPropSprite } from "../data/sprites/mapProps";
import { h32, hashString, hf } from "./mapNoise";
import { darken, hexColor, lighten, mixColor } from "./mapTheme";
import type { TexStone } from "./mapTextures";
import { TILE_DOTS, type DecalKind, type MapLight, type MapPalette, type MapPropKind, type MapTheme } from "./mapTypes";

// ---------------------------------------------------------------------------
// 定数（描画の作りの定数。バランス数値ではない）
// ---------------------------------------------------------------------------

/** 焼き付けの作業用の配列から読む「ドットの種類」。mapBake の KIND_* と同じ値 */
export const DOT_FLOOR = 0;
export const DOT_WALL = 1;
export const DOT_PIT = 2;

/** 壁際（北が壁の床）で根元をマスの上から何ドットに置くか（論理 8px） */
const WALL_FOOT_Y = 16;
/** 置物の間隔（マス）。小物 / 背の高いもの / 奈落の鳥居 / 浮かぶ岩片 */
const SPACING_SMALL = 4;
const SPACING_TALL = 6;
const SPACING_TORII = 10;
const SPACING_ROCK = 5;
/** 間引きで周りを見る範囲（マス）。最大の間隔に合わせる */
const NMS_REACH = SPACING_TORII;
/** 描き込みのはみ出しを数える、チャンクの周りのマス数（置物の高さ 39 ドット・横 23 ドット・汚しの半径 13 ドットが 1 マス以内） */
const DRAW_MARGIN_TILES = 1;
/** 墨の石の砂紋の同心円がマスをまたぐ範囲（半径 = rx * RING_MUL ドット。最大 61 ドット = 2 マス） */
const STONE_RING_MUL = 3.2;
const STONE_RING_MARGIN_TILES = 3;

/** 候補になる率（間引きの前）。壁際・隅は仕様の 7.5% より少し高く、間引きで落ちた後に 7.5% 前後になる */
const WALL_FOOT_RATE = 0.1;
const CORNER_RATE = 0.1;
const DEAD_END_RATE = 0.55;
const PREFAB_DEAD_END_RATE = 0.9;
const OPEN_STONE_RATE = 0.03;
const TORII_RATE = 0.02;
const FLOAT_ROCK_RATE = 0.035;
const ISLE_ORB_RATE = 0.3;
const RIVER_MUSH_RATE = 0.3;
/** 石灯籠の列の間隔（マス）。court の参道 / river の岸 */
const COURT_LANTERN_STEP = 4;
const RIVER_LANTERN_STEP = 5;
/** 床の汚しの率: 壁・穴のそば / 広い所 */
const DECAL_NEAR_RATE = 0.55;
const DECAL_FAR_RATE = 0.1;
/** 汚しの置き場所（マスの内側の余白と幅） */
const DECAL_PAD = 4;
const DECAL_SPAN = 24;
/** 線路を敷く、まっすぐな通路の最小の長さ（マス）と、数える範囲 */
const RAIL_MIN_RUN = 4;
const RAIL_SCAN = 6;
/** 主の間の側面の飾りの間隔（マス） */
const HALL_PILLAR_STEP = 2;
const HALL_BANNER_STEP = 3;
/** 坑木の梁の間隔（マス） */
const BEAM_STEP = 3;
/** 側面の飾りの割り当て（32 分率）。1 つのマスに 1 つだけ */
const SIDE_SLOTS = 32;
const SIDE_RATE_SHIMENAWA = 4;
const SIDE_RATE_PILLAR = 2;
const SIDE_RATE_BANNER = 2;
const SIDE_RATE_ICICLE = 24;
const SIDE_RATE_MOSS = 8;
const SIDE_RATE_SCRIPTURE = 4;
/** 朱の柱の幅（ドット）と高さの上限（根元から。側面に収める） */
const PILLAR_W = 10;
const PILLAR_H_MAX = 40;
/** 側面の上端から飾りまで空ける余白（ドット） */
const SIDE_TOP_GAP = 2;

const OUTLINE = hexColor("#1a1a24");
const STEEL = hexColor("#a8a8b0");
const FROST_STEEL = hexColor("#e8f4ff");
const RAIL_TOP = hexColor("#7a7680");
const RAIL_BODY = hexColor("#4a464c");
const MUD = hexColor("#2a2218");
const EMBER_A = hexColor("#ff7a2a");
const EMBER_B = hexColor("#ffd05a");
const ROPE_LIGHT = hexColor("#e0c890");
const ROPE_MID_A = hexColor("#c8a868");
const ROPE_MID_B = hexColor("#a0844c");
const ROPE_DARK = hexColor("#6a5430");
const SHIDE = hexColor("#f4f0e4");
const SHIDE_TIP = hexColor("#b8b4a8");
const ICE_LIGHT = hexColor("#e8f4ff");
const ICE_MID = hexColor("#b8e4ff");
const ICE_DARK = hexColor("#8ab8d8");
const MOSS_CORE = hexColor("#f0ffb8");
const BANNER_BASE = hexColor("#6a2a22");
const BANNER_TOP = hexColor("#3a3434");
const HOKORA_LIGHT = "#ffd890";

// ---------------------------------------------------------------------------
// 置物の分類
// ---------------------------------------------------------------------------

/** 置き場所の種類（2-3 節の表） */
export type PlaceClass = "wallFoot" | "corner" | "deadEnd" | "sideFace" | "void" | "open" | "none";

/** 背の高い置物。壁際（北が壁）にだけ置く: 体は常に手前に来るので、焼き付けても前後がおかしくならない */
export const TALL_PROPS: ReadonlySet<MapPropKind> = new Set<MapPropKind>(["lantern", "jizo", "brazier", "crystal", "andon", "pillar", "armor", "orb"]);
/** 行き止まりにだけ置く */
const DEAD_END_ONLY: ReadonlySet<MapPropKind> = new Set<MapPropKind>(["hokora", "bonePile"]);
/** 奈落の物と側面の物は乱数の置物の候補にしない */
const NOT_RANDOM: ReadonlySet<MapPropKind> = new Set<MapPropKind>(["torii", "floatRock", "glowMoss", "shimenawa", "banner", "icicle", "scripture"]);
/** 和の置物（章 1 に出さない）。検査で使う */
export const WA_PROPS: ReadonlySet<MapPropKind> = new Set<MapPropKind>(["lantern", "jizo", "hokora", "scroll", "urn", "torii", "andon", "pillar", "stone"]);

/** 行き止まりの置物（様式ごと。章 2 は祠・地蔵、それ以外は頭骨と骨の山） */
const DEAD_END_PROPS: Readonly<Record<MapTheme["style"], readonly { kind: MapPropKind; weight: number }[]>> = {
  moss: [
    { kind: "skull", weight: 2 },
    { kind: "bonePile", weight: 1 },
  ],
  temple: [
    { kind: "hokora", weight: 3 },
    { kind: "jizo", weight: 2 },
    { kind: "bonePile", weight: 1 },
  ],
  castleFire: [
    { kind: "skull", weight: 2 },
    { kind: "bonePile", weight: 2 },
  ],
  castleFrost: [
    { kind: "skull", weight: 2 },
    { kind: "bonePile", weight: 2 },
  ],
  deep: [
    { kind: "skull", weight: 2 },
    { kind: "bonePile", weight: 1 },
  ],
  final: [],
  town: [],
};

/** 光る置物の光（半径は論理 px = 見本 PROP_LIGHT の半分、強さは見本の s）。color 無しはテーマの light 色 */
interface PropLight {
  r: number;
  strength: number;
  color?: string;
}
const PROP_LIGHTS: Readonly<Partial<Record<MapPropKind, PropLight>>> = {
  lantern: { r: 46, strength: 1 },
  brazier: { r: 52, strength: 1 },
  andon: { r: 43, strength: 0.95 },
  orb: { r: 35, strength: 0.9 },
  crystal: { r: 29, strength: 0.75 },
  mush: { r: 19, strength: 0.8 },
  hokora: { r: 20, strength: 0.6, color: HOKORA_LIGHT },
};
/** 側面の蛍苔の光（論理 px） */
const MOSS_LIGHT: PropLight = { r: 20, strength: 0.6 };

// ---------------------------------------------------------------------------
// 地図の読み出し
// ---------------------------------------------------------------------------

function isWall(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  return map.tiles[ty * map.width + tx] === Tile.Wall;
}

function isPit(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.tiles[ty * map.width + tx] === Tile.Pit;
}

function isFloor(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.tiles[ty * map.width + tx] === Tile.Floor;
}

function isShallow(map: GameMap, tx: number, ty: number): boolean {
  if (!map.shallow || tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return (map.shallow[ty * map.width + tx] ?? 0) > 0;
}

/** 周り radius マスがすべて壁か */
function allWallAround(map: GameMap, tx: number, ty: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (!isWall(map, tx + dx, ty + dy)) return false;
  }
  return true;
}

/** 周り radius マスがすべて床（壁も穴も階段も無い）か */
function allFloorAround(map: GameMap, tx: number, ty: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (!isFloor(map, tx + dx, ty + dy)) return false;
  }
  return true;
}

/** 床の 8 近傍に壁か穴があるか（汚しの「壁のそば」） */
function nearSolid(map: GameMap, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && (isWall(map, tx + dx, ty + dy) || isPit(map, tx + dx, ty + dy))) return true;
  }
  return false;
}

/**
 * マスの置き場所の種類（地図だけで決まる。2-3 節の表）。
 * 床: 3 方が壁 = 行き止まり / 北と東か西が壁 = 隅 / 北が壁 = 壁際 / 周り 2 マスが床 = 広い床。
 * 壁: 南が床 = 側面 / 周り 2 マスが壁 = 奈落（岩盤の奥）
 */
export function classifyPlace(map: GameMap, tx: number, ty: number): PlaceClass {
  if (isWall(map, tx, ty)) {
    if (!isWall(map, tx, ty + 1)) return "sideFace";
    return allWallAround(map, tx, ty, 2) ? "void" : "none";
  }
  if (!isFloor(map, tx, ty)) return "none";
  const n = isWall(map, tx, ty - 1);
  const s = isWall(map, tx, ty + 1);
  const e = isWall(map, tx + 1, ty);
  const w = isWall(map, tx - 1, ty);
  const walls = Number(n) + Number(s) + Number(e) + Number(w);
  if (walls >= 3) return "deadEnd";
  if (n && (e || w)) return "corner";
  if (n && !s) return "wallFoot";
  if (walls === 0 && allFloorAround(map, tx, ty, 2)) return "open";
  return "none";
}

// ---------------------------------------------------------------------------
// 部屋の情報と除外のマス
// ---------------------------------------------------------------------------

const NO_ROOM = -1;

interface MapInfo {
  /** マス → 部屋の番号（-1 = どの部屋にも属さない通路）。部屋の所属タイル / 矩形から作る */
  roomOf: Int16Array;
  /** 主の間（最後の部屋）の番号。部屋が 2 つ未満なら -1 */
  lord: number;
  layout: FloorLayout | undefined;
}

const INFO_CACHE = new WeakMap<GameMap, MapInfo>();

function mapInfoOf(map: GameMap): MapInfo {
  const cached = INFO_CACHE.get(map);
  if (cached) return cached;
  const roomOf = new Int16Array(map.tiles.length).fill(NO_ROOM);
  map.rooms.forEach((rect, i) => {
    const tiles = map.roomTiles?.[i];
    if (tiles) {
      for (const t of tiles) roomOf[t] = i;
      return;
    }
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) if (x >= 0 && y >= 0 && x < map.width && y < map.height) roomOf[y * map.width + x] = i;
    }
  });
  const info: MapInfo = { roomOf, lord: map.rooms.length >= 2 ? map.rooms.length - 1 : NO_ROOM, layout: map.layout };
  INFO_CACHE.set(map, info);
  return info;
}

function markAround(map: GameMap, mask: Uint8Array, tx: number, ty: number, radius: number, diagonal: boolean): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!diagonal && dx !== 0 && dy !== 0) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) mask[y * map.width + x] = 1;
    }
  }
}

/** 部屋に 8 近傍で接する、部屋の外の通れる床 = 扉（system/floor.ts の塊の扉の候補と同じ。render から system を読まないので写した） */
function isDoorTile(map: GameMap, info: MapInfo, tx: number, ty: number): boolean {
  const i = ty * map.width + tx;
  const tile = map.tiles[i];
  if (tile === Tile.Wall || tile === Tile.Pit || info.roomOf[i] !== NO_ROOM) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if ((info.roomOf[y * map.width + x] ?? NO_ROOM) !== NO_ROOM) return true;
    }
  }
  return false;
}

/**
 * 置物を置かないマスの印（1 = 置かない。地図と同じ並び）。
 * 部屋の中心とその周り 1 マス（台座・泉・商人・契約者・ボス後の階段）/ 扉とその 4 近傍 / 階段と泉とその 8 近傍。
 * 地図ごとに 1 回作って焼きへ渡す（階段は焼いた時点のもの。後から現れる階段は上描きなので置物と重ならないよう中心の除外が受け持つ）
 */
export function buildDecorExclude(map: GameMap): Uint8Array {
  const mask = new Uint8Array(map.tiles.length);
  const info = mapInfoOf(map);
  for (const rect of map.rooms) {
    const cx = Math.floor(rect.x + rect.w / 2);
    const cy = Math.floor(rect.y + rect.h / 2);
    markAround(map, mask, cx, cy, 1, true);
  }
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const tile = map.tiles[ty * map.width + tx];
      if (tile === Tile.StairsDown || tile === Tile.Fountain) markAround(map, mask, tx, ty, 1, true);
      else if (isDoorTile(map, info, tx, ty)) markAround(map, mask, tx, ty, 1, false);
    }
  }
  return mask;
}

const EXCLUDE_CACHE = new WeakMap<GameMap, Uint8Array>();

function excludeOf(map: GameMap, given: Uint8Array | undefined): Uint8Array {
  if (given && given.length === map.tiles.length) return given;
  let mask = EXCLUDE_CACHE.get(map);
  if (!mask) {
    mask = buildDecorExclude(map);
    EXCLUDE_CACHE.set(map, mask);
  }
  return mask;
}

// ---------------------------------------------------------------------------
// 置物の候補と間引き
// ---------------------------------------------------------------------------

/** 置く物（ドットの座標は根元 = 足元の点） */
export interface DecorPlacement {
  kind: MapPropKind;
  tx: number;
  ty: number;
  x: number;
  y: number;
  /** 置き場所の種類（検査・描き順で使う） */
  place: PlaceClass | "bank";
}

interface Candidate extends DecorPlacement {
  score: number;
  spacing: number;
  /** 間引きの組（同じ組どうしだけ間隔を取る） */
  group: 0 | 1 | 2;
}

const GROUP_FLOOR = 0;
const GROUP_TORII = 1;
const GROUP_ROCK = 2;
const FORCED_SCORE = 0xffffffff;
/** 重みで選ぶときの乱数の幅（ハッシュの下位 10 ビット） */
const PICK_MASK = 1023;

interface PropPools {
  /** 壁際: 背の高いものも小物も */
  wall: readonly { kind: MapPropKind; weight: number }[];
  /** 隅・岸: 小物だけ */
  small: readonly { kind: MapPropKind; weight: number }[];
}

const POOL_CACHE = new WeakMap<MapTheme, PropPools>();

function poolsOf(theme: MapTheme): PropPools {
  const cached = POOL_CACHE.get(theme);
  if (cached) return cached;
  const base = theme.props.filter((p) => p.weight > 0 && !NOT_RANDOM.has(p.kind) && !DEAD_END_ONLY.has(p.kind));
  const pools: PropPools = { wall: base, small: base.filter((p) => !TALL_PROPS.has(p.kind)) };
  POOL_CACHE.set(theme, pools);
  return pools;
}

function pick(list: readonly { kind: MapPropKind; weight: number }[], bits: number): MapPropKind | null {
  let total = 0;
  for (const p of list) total += p.weight;
  if (total <= 0) return null;
  let r = ((bits & PICK_MASK) / (PICK_MASK + 1)) * total;
  for (const p of list) {
    if (r < p.weight) return p.kind;
    r -= p.weight;
  }
  return list[list.length - 1]?.kind ?? null;
}

function spacingOf(kind: MapPropKind): number {
  if (kind === "torii") return SPACING_TORII;
  if (kind === "floatRock") return SPACING_ROCK;
  return TALL_PROPS.has(kind) ? SPACING_TALL : SPACING_SMALL;
}

function groupOf(kind: MapPropKind): 0 | 1 | 2 {
  if (kind === "torii") return GROUP_TORII;
  return kind === "floatRock" ? GROUP_ROCK : GROUP_FLOOR;
}

interface DecorContext {
  map: GameMap;
  theme: MapTheme;
  exclude: Uint8Array;
  info: MapInfo;
  seed: number;
  pools: PropPools;
}

/** 地図とテーマから決まる種（チャンク・state に依らない）。地図の大きさを混ぜて、階ごとに散り方を変える */
function decorSeed(map: GameMap, theme: MapTheme): number {
  return (hashString(theme.key) + Math.imul(map.width * 7919 + map.height, 2654435761)) | 0;
}

function makeContext(map: GameMap, theme: MapTheme, exclude: Uint8Array | undefined): DecorContext {
  return { map, theme, exclude: excludeOf(map, exclude), info: mapInfoOf(map), seed: decorSeed(map, theme), pools: poolsOf(theme) };
}

function candidate(kind: MapPropKind, tx: number, ty: number, x: number, y: number, place: Candidate["place"], score: number, spacing: number = spacingOf(kind)): Candidate {
  return { kind, tx, ty, x, y, place, score, spacing, group: groupOf(kind) };
}

function isTempleOrDeep(theme: MapTheme): boolean {
  return theme.style === "temple" || theme.style === "deep";
}

/** 周り 2 マスがすべて壁か穴か（穴の奥 = 奈落の中央） */
function allWallOrPitAround(map: GameMap, tx: number, ty: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (!isWall(map, tx + dx, ty + dy) && !isPit(map, tx + dx, ty + dy)) return false;
  }
  return true;
}

/** 奈落の中か: 岩盤の奥（壁）か、奈落の穴の中央（章 4・深みの島の外） */
function isVoidTile(map: GameMap, tx: number, ty: number): boolean {
  return isWall(map, tx, ty) ? classifyPlace(map, tx, ty) === "void" : allWallOrPitAround(map, tx, ty, 2);
}

/** 奈落（岩盤の奥・奈落の穴）の候補: 逆さの鳥居と浮かぶ岩片（voidBeyond のテーマだけ） */
function voidCandidate(ctx: DecorContext, tx: number, ty: number, h: number): Candidate | null {
  if (!ctx.theme.voidBeyond || !isVoidTile(ctx.map, tx, ty)) return null;
  const roll = (h & 1023) / 1024;
  const score = h32(tx, ty, ctx.seed + 7);
  if (roll < TORII_RATE) return candidate("torii", tx, ty, tx * TILE_DOTS + TILE_DOTS / 2, ty * TILE_DOTS + 24, "void", score);
  if (roll < TORII_RATE + FLOAT_ROCK_RATE) {
    return candidate("floatRock", tx, ty, tx * TILE_DOTS + 8 + ((h >>> 20) % 16), ty * TILE_DOTS + 16 + ((h >>> 24) % 8), "void", score);
  }
  return null;
}

/** 北が壁（river・isle は北が穴でも。穴の向こうには立てないので、体が置物の後ろに回らない）= 壁際の扱いにできるか */
function northBlocked(ctx: DecorContext, tx: number, ty: number): boolean {
  if (isWall(ctx.map, tx, ty - 1)) return true;
  const layout = ctx.info.layout;
  return (layout === "river" || layout === "isle") && isPit(ctx.map, tx, ty - 1);
}

function touchesPit(map: GameMap, tx: number, ty: number): boolean {
  return isPit(map, tx + 1, ty) || isPit(map, tx - 1, ty) || isPit(map, tx, ty + 1) || isPit(map, tx, ty - 1);
}

/** 階の型ごとの寄せで強制的に置くもの（2-3 節の「階の型ごとの寄せ」）。無ければ null */
function layoutCandidate(ctx: DecorContext, tx: number, ty: number, cls: PlaceClass, h: number): Candidate | null {
  const { info, theme, map } = ctx;
  const roll = (h & 1023) / 1024;
  const wallY = ty * TILE_DOTS + WALL_FOOT_Y;
  const centerX = tx * TILE_DOTS + TILE_DOTS / 2;
  const roomOfTile = info.roomOf[ty * map.width + tx] ?? NO_ROOM;
  if (info.layout === "court" && isTempleOrDeep(theme) && roomOfTile === NO_ROOM && cls === "wallFoot" && tx % COURT_LANTERN_STEP === 0) {
    // 列の間隔 = 石灯籠どうしは間引かない（ほかの置物は列に勝てない）
    return candidate("lantern", tx, ty, centerX, wallY, "wallFoot", FORCED_SCORE, COURT_LANTERN_STEP);
  }
  if (info.layout === "river" && touchesPit(map, tx, ty)) {
    if (theme.style === "moss" && roll < RIVER_MUSH_RATE) {
      return candidate("mush", tx, ty, tx * TILE_DOTS + 8 + ((h >>> 20) % 16), ty * TILE_DOTS + 12 + ((h >>> 24) % 12), "bank", h32(tx, ty, ctx.seed + 7));
    }
    if (theme.style === "temple" && tx % RIVER_LANTERN_STEP === 0 && northBlocked(ctx, tx, ty)) {
      return candidate("lantern", tx, ty, centerX, wallY, "wallFoot", FORCED_SCORE, RIVER_LANTERN_STEP);
    }
  }
  if (info.layout === "isle" && theme.style === "deep" && cls === "wallFoot" && roll < ISLE_ORB_RATE) {
    return candidate("orb", tx, ty, centerX, wallY, "wallFoot", h32(tx, ty, ctx.seed + 7));
  }
  return null;
}

function floorCandidate(ctx: DecorContext, tx: number, ty: number, h: number): Candidate | null {
  const { map, theme, info } = ctx;
  if (isShallow(map, tx, ty) || ctx.exclude[ty * map.width + tx] === 1) return null;
  let cls = classifyPlace(map, tx, ty);
  if (cls === "none" && northBlocked(ctx, tx, ty) && !isWall(map, tx, ty - 1) && !isWall(map, tx, ty + 1)) cls = "wallFoot";
  const forced = layoutCandidate(ctx, tx, ty, cls, h);
  if (forced) return forced;
  // ボス階は壁際だけ（広間を読みやすく）
  if (info.layout === "lordHall" && cls !== "wallFoot") return null;
  const roll = (h & 1023) / 1024;
  const bits = h >>> 10;
  const score = h32(tx, ty, ctx.seed + 7);
  const jitter = (h >>> 20) % 9;
  if (cls === "wallFoot") {
    if (roll >= WALL_FOOT_RATE) return null;
    const kind = pick(ctx.pools.wall, bits);
    return kind ? candidate(kind, tx, ty, tx * TILE_DOTS + TILE_DOTS / 2 + jitter - 4, ty * TILE_DOTS + WALL_FOOT_Y, "wallFoot", score) : null;
  }
  if (cls === "corner") {
    if (roll >= CORNER_RATE) return null;
    const kind = pick(ctx.pools.small, bits);
    if (!kind) return null;
    const x = tx * TILE_DOTS + (isWall(map, tx + 1, ty) ? 20 : isWall(map, tx - 1, ty) ? 12 : 16) + ((h >>> 20) % 4);
    return candidate(kind, tx, ty, x, ty * TILE_DOTS + 14 + ((h >>> 24) % 8), "corner", score);
  }
  if (cls === "deadEnd") {
    if (roll >= (info.layout === "prefab" ? PREFAB_DEAD_END_RATE : DEAD_END_RATE)) return null;
    const kind = pick(DEAD_END_PROPS[theme.style], bits);
    return kind ? candidate(kind, tx, ty, tx * TILE_DOTS + TILE_DOTS / 2, ty * TILE_DOTS + 22, "deadEnd", score) : null;
  }
  if (cls === "open" && theme.style === "final" && roll < OPEN_STONE_RATE && theme.props.some((p) => p.kind === "stone")) {
    return candidate("stone", tx, ty, tx * TILE_DOTS + 8 + ((h >>> 20) % 16), ty * TILE_DOTS + WALL_FOOT_Y, "open", score);
  }
  return null;
}

function candidateAt(ctx: DecorContext, tx: number, ty: number): Candidate | null {
  const { map } = ctx;
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
  const h = h32(tx, ty, ctx.seed);
  if (isWall(map, tx, ty) || isPit(map, tx, ty)) return voidCandidate(ctx, tx, ty, h);
  return floorCandidate(ctx, tx, ty, h);
}

/** a が b に勝つか（強制 > ハッシュの大きい方 > 座標の若い方）。同じ地図なら誰がどこから数えても同じ */
function beats(a: Candidate, b: Candidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  return a.ty < b.ty || (a.ty === b.ty && a.tx < b.tx);
}

function suppressed(c: Candidate, all: readonly Candidate[]): boolean {
  for (const o of all) {
    if (o === c || o.group !== c.group || !beats(o, c)) continue;
    const reach = Math.max(o.spacing, c.spacing);
    if (Math.hypot(o.tx - c.tx, o.ty - c.ty) < reach) return true;
  }
  return false;
}

/**
 * タイル範囲 [tx0, tx1] x [ty0, ty1]（含む）の根元を持つ置物。範囲の外の候補は間引きのためにだけ数える。
 * 同じ地図・テーマなら、どの範囲で呼んでも範囲内の結果は同じ
 */
export function placementsIn(map: GameMap, theme: MapTheme, exclude: Uint8Array | undefined, tx0: number, ty0: number, tx1: number, ty1: number): DecorPlacement[] {
  // 置物の表が空のテーマは置物を置かない（行き止まり・奈落・階の型の寄せも含めて）
  if (theme.props.length === 0) return [];
  const ctx = makeContext(map, theme, exclude);
  const all: Candidate[] = [];
  for (let ty = ty0 - NMS_REACH; ty <= ty1 + NMS_REACH; ty++) {
    for (let tx = tx0 - NMS_REACH; tx <= tx1 + NMS_REACH; tx++) {
      const c = candidateAt(ctx, tx, ty);
      if (c) all.push(c);
    }
  }
  const out: DecorPlacement[] = [];
  for (const c of all) {
    if (c.tx < tx0 || c.tx > tx1 || c.ty < ty0 || c.ty > ty1) continue;
    if (!suppressed(c, all)) out.push({ kind: c.kind, tx: c.tx, ty: c.ty, x: c.x, y: c.y, place: c.place });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 描き込みの下ごしらえ
// ---------------------------------------------------------------------------

/** 焼きの作業用の配列から読む口（mapBake が渡す）。座標はワールドのドット */
export interface DecorSurface {
  /** DOT_FLOOR / DOT_WALL / DOT_PIT。読める範囲の外は壁 */
  kindAt(wx: number, wy: number): number;
  /** 壁のドットから下の床までの壁のドット数（側面の判定。壁でなければ意味を持たない） */
  wallRun(wx: number, wy: number): number;
}

export interface DecorInput {
  map: GameMap;
  theme: MapTheme;
  exclude?: Uint8Array;
  /** 範囲の左上（ワールドのドット）と大きさ。ground は w * h の行優先 */
  x: number;
  y: number;
  w: number;
  h: number;
  ground: Uint32Array;
  /**
   * 手前の縁の画素列（ground と同じ並び、0 は透明）。渡すと、描き込みの後に縁のある画素を ground の色へ揃える。
   * 縁は体と重なる矩形だけ描き直す（render/frontLip.ts）ので、ground と違う画素が残ると矩形の端で汚しが切れて見える
   */
  lip?: Uint32Array;
  surface: DecorSurface;
}

interface Paint {
  ground: Uint32Array;
  x0: number;
  y0: number;
  w: number;
  h: number;
  surface: DecorSurface;
  theme: MapTheme;
  P: MapPalette;
  seed: number;
  lights: MapLight[];
}

function getPx(p: Paint, wx: number, wy: number): number {
  const i = wx - p.x0;
  const j = wy - p.y0;
  if (i < 0 || j < 0 || i >= p.w || j >= p.h) return 0;
  return p.ground[j * p.w + i] ?? 0;
}

function setPx(p: Paint, wx: number, wy: number, c: number): void {
  const i = wx - p.x0;
  const j = wy - p.y0;
  if (i < 0 || j < 0 || i >= p.w || j >= p.h) return;
  p.ground[j * p.w + i] = c;
}

/** 床のドットだけに描く（汚し・影） */
function setFloorPx(p: Paint, wx: number, wy: number, c: number): void {
  const i = wx - p.x0;
  const j = wy - p.y0;
  if (i < 0 || j < 0 || i >= p.w || j >= p.h) return;
  if (p.surface.kindAt(wx, wy) !== DOT_FLOOR) return;
  p.ground[j * p.w + i] = c;
}

/** 壁の側面のドットだけに描く（飾りが側面の高さに収まる） */
function setSidePx(p: Paint, wx: number, wy: number, c: number): boolean {
  const i = wx - p.x0;
  const j = wy - p.y0;
  if (i < 0 || j < 0 || i >= p.w || j >= p.h) return false;
  if (p.surface.kindAt(wx, wy) !== DOT_WALL || p.surface.wallRun(wx, wy) > p.theme.sideH) return false;
  p.ground[j * p.w + i] = c;
  return true;
}

const COLOR_TABLE_SIZE = 128;
const COLOR_CACHE = new WeakMap<MapPalette, Map<string, Uint32Array>>();

/** 役 1 つの色（テーマの配色か固定色を、役の寄せで明暗させる）。階段の絵（stairsArt.ts）も同じ当て方 */
export function roleColor(P: MapPalette, role: MapPropRole): number {
  const raw = role.from.startsWith("#") ? hexColor(role.from) : P[role.from as keyof MapPalette];
  return role.shade > 0 ? lighten(raw, role.shade) : role.shade < 0 ? darken(raw, -role.shade) : raw;
}

/** 役の文字 → 色（文字コードで引く。0 は透明）。テーマの配色ごと・輪郭の差し替えごとに 1 回だけ作る */
function roleColors(P: MapPalette, outline: keyof MapPalette | undefined): Uint32Array {
  let byOutline = COLOR_CACHE.get(P);
  if (!byOutline) {
    byOutline = new Map();
    COLOR_CACHE.set(P, byOutline);
  }
  const key = outline ?? "";
  const cached = byOutline.get(key);
  if (cached) return cached;
  const table = new Uint32Array(COLOR_TABLE_SIZE);
  for (const [ch, role] of Object.entries(MAP_PROP_ROLES)) {
    table[ch.charCodeAt(0)] = ch === "k" && outline ? P[outline] : roleColor(P, role);
  }
  byOutline.set(key, table);
  return table;
}

function blitSprite(p: Paint, sprite: MapPropSprite, ax: number, ay: number, floorOnly: boolean): void {
  const colors = roleColors(p.P, sprite.outline);
  const left = ax - sprite.anchor[0];
  const top = ay - sprite.anchor[1];
  for (let y = 0; y < sprite.rows.length; y++) {
    const row = sprite.rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const c = colors[row.charCodeAt(x)] ?? 0;
      if (c === 0) continue;
      if (floorOnly) setFloorPx(p, left + x, top + y, c);
      else setPx(p, left + x, top + y, c);
    }
  }
}

/** 足元の影（床のドットだけ fO へ寄せる） */
function castShadow(p: Paint, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= 0) return;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
      const c = getPx(p, cx + x, cy + y);
      if (c !== 0) setFloorPx(p, cx + x, cy + y, mixColor(c, p.P.fO, 0.5));
    }
  }
}

// ---------------------------------------------------------------------------
// 手続きの置物（朱の柱・墨の石・折れた槍・浮かぶ岩片）
// ---------------------------------------------------------------------------

function drawPillar(p: Paint, ax: number, ay: number): void {
  const P = p.P;
  // 根元からの高さ。側面（根元はマスの上 WALL_FOOT_Y）に収める
  const height = Math.min(PILLAR_H_MAX, WALL_FOOT_Y + p.theme.sideH - SIDE_TOP_GAP);
  const left = ax - PILLAR_W / 2;
  const top = ay - height;
  castShadow(p, ax, ay - 1, 7, 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < PILLAR_W; x++) {
      let c: number;
      if (y < 2 || y === height - 1 || x === 0 || x === PILLAR_W - 1) c = OUTLINE;
      else if (y < 5) c = P.tD;
      else if (y >= height - 5) c = y === height - 5 ? OUTLINE : P.stoneL;
      else c = x === 1 ? P.accL : x >= PILLAR_W - 3 ? P.accD : P.accent;
      setPx(p, left + x, top + y, c);
    }
  }
}

/** 墨の石の大きさ（根元の座標ハッシュで決まる。砂紋の同心円もこの半径に合わせる） */
export function stoneSize(tx: number, ty: number, seed: number): { rx: number; ry: number } {
  const h = h32(tx, ty, seed + 91);
  return { rx: 12 + ((h >>> 20) & 7), ry: 7 + ((h >>> 23) & 3) };
}

function drawStone(p: Paint, pl: DecorPlacement): void {
  const P = p.P;
  const { rx, ry } = stoneSize(pl.tx, pl.ty, p.seed);
  castShadow(p, pl.x + 2, pl.y + 2, rx + 2, ry - 1);
  for (let y = -ry * 2; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const nx = x / rx;
      const ny = y < 0 ? y / (ry * 1.6) : y / ry;
      const d = nx * nx + ny * ny + (hf(x, y, pl.x) - 0.5) * 0.08;
      if (d > 1) continue;
      let c = d > 0.8 ? OUTLINE : P.tB;
      if (d <= 0.8 && nx < -0.1 && ny < -0.25) c = mixColor(P.tB, P.light, 0.35);
      if (d <= 0.8 && nx < -0.25 && ny < -0.5) c = mixColor(P.tB, P.light, 0.6);
      if (d <= 0.8 && ny > 0.45) c = P.sB;
      setPx(p, pl.x + x, pl.y + y, c);
    }
  }
}

/** 折れた槍: 斜めに突き刺さった柄と穂先 */
function drawSpear(p: Paint, pl: DecorPlacement): void {
  const LENGTH = 22;
  const TIP = 5;
  const dir = (h32(pl.tx, pl.ty, p.seed + 91) >>> 28) & 1 ? 1 : -1;
  const tipColor = p.theme.flags.frost ? FROST_STEEL : STEEL;
  for (let q = 0; q < LENGTH; q++) {
    const x = pl.x + Math.round(q * 0.8) * dir;
    const y = pl.y - q;
    setPx(p, x, y, OUTLINE);
    setPx(p, x + 1, y, q > LENGTH - TIP ? tipColor : p.P.wood);
  }
  castShadow(p, pl.x, pl.y + 1, 4, 1);
}

/** 浮かぶ岩片: 平らな上面と、下へ細る裏側。奈落の色で縁取って沈める */
function drawFloatRock(p: Paint, pl: DecorPlacement): void {
  const P = p.P;
  const h = h32(pl.tx, pl.ty, p.seed + 91);
  const rx = 9 + (h & 7);
  const topH = 4;
  const bodyH = 10 + ((h >>> 3) & 3);
  for (let y = -topH; y <= bodyH; y++) {
    const half = y <= 0 ? rx * Math.sqrt(Math.max(0, 1 - (y / topH) ** 2)) : rx * (1 - y / (bodyH + 1)) ** 0.9;
    for (let x = -Math.floor(half); x <= Math.floor(half); x++) {
      const edge = Math.abs(x) >= Math.floor(half) - 0 || y === bodyH || y === -topH;
      let c: number;
      if (edge) c = P.v2;
      else if (y <= 0) c = x < 0 ? P.tL : P.tB;
      else c = y > bodyH / 2 ? P.sD : P.tD;
      setPx(p, pl.x + x, pl.y + y, c);
    }
  }
}

function drawPlacement(p: Paint, pl: DecorPlacement): void {
  if (pl.kind === "pillar") return drawPillar(p, pl.x, pl.y);
  if (pl.kind === "stone") return drawStone(p, pl);
  if (pl.kind === "spear") return drawSpear(p, pl);
  if (pl.kind === "floatRock") return drawFloatRock(p, pl);
  if (!isMapPropSpriteKind(pl.kind)) return;
  const sprite = MAP_PROP_SPRITES[pl.kind];
  castShadow(p, pl.x, pl.y - 1, sprite.shadow, 2);
  blitSprite(p, sprite, pl.x, pl.y, false);
}

// ---------------------------------------------------------------------------
// 光
// ---------------------------------------------------------------------------

function cssOf(c: number): string {
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${hex(c & 255)}${hex((c >>> 8) & 255)}${hex((c >>> 16) & 255)}`;
}

function pushLight(p: Paint, dotX: number, dotY: number, spec: PropLight): void {
  p.lights.push({
    x: dotX / (TILE_DOTS / TILE_SIZE),
    y: dotY / (TILE_DOTS / TILE_SIZE),
    r: spec.r,
    strength: spec.strength,
    color: spec.color ?? cssOf(p.P.light),
  });
}

/** 光る置物の光。光の中心は絵の `light`（無ければ足元の少し上） */
function lightOf(p: Paint, pl: DecorPlacement): void {
  const spec = PROP_LIGHTS[pl.kind];
  if (!spec) return;
  if (isMapPropSpriteKind(pl.kind)) {
    const sprite = MAP_PROP_SPRITES[pl.kind];
    const lx = sprite.light?.[0] ?? sprite.anchor[0];
    const ly = sprite.light?.[1] ?? sprite.anchor[1] / 2;
    pushLight(p, pl.x - sprite.anchor[0] + lx, pl.y - sprite.anchor[1] + ly, spec);
    return;
  }
  pushLight(p, pl.x, pl.y - 12, spec);
}

// ---------------------------------------------------------------------------
// 床の汚し
// ---------------------------------------------------------------------------

function drawDecal(p: Paint, kind: DecalKind, x: number, y: number, h: number): void {
  const P = p.P;
  const put = (dx: number, dy: number, c: number): void => setFloorPx(p, x + dx, y + dy, c);
  const cur = (dx: number, dy: number): number => getPx(p, x + dx, y + dy);
  switch (kind) {
    case "pebble": {
      const n = 2 + ((h >>> 24) % 3);
      for (let q = 0; q < n; q++) {
        const px = ((h >>> (q * 3)) % 9) - 4;
        const py = ((h >>> (q * 3 + 9)) % 7) - 3;
        put(px, py, P.fH);
        put(px + 1, py, P.fL);
        put(px, py + 1, P.fL);
        put(px + 1, py + 1, P.fD);
        put(px + 1, py + 2, P.fO);
      }
      return;
    }
    case "crack": {
      let cx = 0;
      let cy = 0;
      const n = 7 + ((h >>> 26) % 8);
      for (let q = 0; q < n; q++) {
        put(cx, cy, P.fO);
        const r = (h >>> (q % 28)) & 3;
        if (r === 0) cx++;
        else if (r === 1) {
          cx++;
          cy++;
        } else if (r === 2) cy++;
        else {
          cx--;
          cy++;
        }
      }
      return;
    }
    case "moss": {
      const r = 3 + ((h >>> 25) % 3);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r - 2; dx <= r + 2; dx++) {
          const d = (dx * dx) / ((r + 2) * (r + 2)) + (dy * dy) / (r * r);
          if (d > 1 + (hf(dx, dy, h) - 0.5) * 0.5) continue;
          put(dx, dy, dx + dy < -1 ? P.moss2 : P.moss1);
        }
      }
      return;
    }
    case "root": {
      let cx = 0;
      let cy = 0;
      for (let q = 0; q < 14; q++) {
        put(cx, cy, P.wood);
        put(cx, cy + 1, P.fO);
        cx += 1;
        if (((h >>> q) & 3) === 0) cy += 1;
        if (((h >>> q) & 7) === 5) cy -= 1;
      }
      return;
    }
    case "bones": {
      blitSprite(p, BONES_DECAL, x, y, true);
      return;
    }
    case "scorch": {
      const r = 6 + ((h >>> 25) % 5);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r - 3; dx <= r + 3; dx++) {
          const d = (dx * dx) / ((r + 3) * (r + 3)) + (dy * dy) / (r * r);
          if (d > 1) continue;
          const c = cur(dx, dy);
          if (c !== 0) put(dx, dy, mixColor(c, P.soot, d < 0.45 ? 0.6 : 0.35));
        }
      }
      return;
    }
    case "ember": {
      put(0, 0, EMBER_A);
      put(1, 0, EMBER_B);
      put(4, 2, EMBER_A);
      return;
    }
    case "frost": {
      const c = P.snow;
      put(0, 0, c);
      put(-1, 0, c);
      put(1, 0, c);
      put(0, -1, c);
      put(0, 1, c);
      put(5, 3, mixColor(c, P.fB, 0.4));
      put(-4, 4, mixColor(c, P.fB, 0.4));
      return;
    }
    case "glyph": {
      const g = mixColor(P.accent, P.fB, 0.35);
      for (let q = 0; q < 25; q++) {
        if (((h >>> q) & 1) === 0) continue;
        const gx = q % 5;
        const gy = (q / 5) | 0;
        put(gx * 2 - 5, gy * 2 - 5, g);
        put(4 - gx * 2 + 1, gy * 2 - 5, g);
      }
      return;
    }
    case "mud": {
      const r = 3 + ((h >>> 25) % 3);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r * 2; dx <= r * 2; dx++) {
          const d = (dx * dx) / (r * 2 * (r * 2)) + (dy * dy) / (r * r);
          if (d > 1 + (hf(dx, dy, h) - 0.5) * 0.4) continue;
          const c = cur(dx, dy);
          if (c !== 0) put(dx, dy, mixColor(c, MUD, d < 0.5 ? 0.6 : 0.35));
        }
      }
      return;
    }
    case "grass": {
      const blades = 3 + ((h >>> 24) % 3);
      for (let q = 0; q < blades; q++) {
        const bx = q * 2 - blades;
        const len = 3 + ((h >>> (q * 4)) % 4);
        for (let k = 0; k < len; k++) put(bx + (k > len - 2 ? ((q & 1) * 2 - 1) : 0), -k, k > len / 2 ? P.moss2 : P.moss1);
      }
      return;
    }
    case "rail":
      return;
  }
}

/** 床に転がる頭骨（汚しの bones）。足元の点を絵の中ほどに取り、床のドットだけに描く */
const BONES_DECAL: MapPropSprite = { ...MAP_PROP_SPRITES.skull, anchor: [5, 3] };

/** 線路を敷く通路か: 壁に挟まれたまっすぐな 1 マス幅の通路が RAIL_MIN_RUN 以上続く */
function railAxis(map: GameMap, tx: number, ty: number): "h" | "v" | null {
  if (!isFloor(map, tx, ty)) return null;
  const horizontal = (x: number): boolean => isFloor(map, x, ty) && isWall(map, x, ty - 1) && isWall(map, x, ty + 1);
  const vertical = (y: number): boolean => isFloor(map, tx, y) && isWall(map, tx - 1, y) && isWall(map, tx + 1, y);
  if (horizontal(tx)) {
    let run = 1;
    for (let d = 1; d <= RAIL_SCAN && horizontal(tx - d); d++) run++;
    for (let d = 1; d <= RAIL_SCAN && horizontal(tx + d); d++) run++;
    if (run >= RAIL_MIN_RUN) return "h";
  }
  if (vertical(ty)) {
    let run = 1;
    for (let d = 1; d <= RAIL_SCAN && vertical(ty - d); d++) run++;
    for (let d = 1; d <= RAIL_SCAN && vertical(ty + d); d++) run++;
    if (run >= RAIL_MIN_RUN) return "v";
  }
  return null;
}

/** 線路 1 マス分（枕木と 2 本のレール）。マスをまたいで連続する */
function drawRail(p: Paint, tx: number, ty: number, axis: "h" | "v"): void {
  const base = axis === "h" ? ty * TILE_DOTS : tx * TILE_DOTS;
  const start = axis === "h" ? tx * TILE_DOTS : ty * TILE_DOTS;
  const at = (along: number, across: number, c: number): void => {
    if (axis === "h") setFloorPx(p, start + along, base + across, c);
    else setFloorPx(p, base + across, start + along, c);
  };
  for (let along = 0; along < TILE_DOTS; along++) {
    const tie = (along & 7) < 2;
    for (let across = 10; across <= 22; across++) if (tie) at(along, across, p.P.wood);
    at(along, 13, RAIL_TOP);
    at(along, 14, RAIL_BODY);
    at(along, 19, RAIL_TOP);
    at(along, 20, RAIL_BODY);
  }
}

// ---------------------------------------------------------------------------
// 側面の飾り（注連縄・朱の柱・坑木・旗・氷柱・蛍苔・金の経文）
// ---------------------------------------------------------------------------

type SideKind = "shimenawa" | "pillar" | "banner" | "icicle" | "glowMoss" | "scripture" | "beam";

/** 主の間（本堂）の北の側面の飾り。court は章 2・4、ボス階は章 2〜4 */
function hallSideKind(theme: MapTheme, layout: FloorLayout | undefined, tx: number): SideKind | null {
  if (layout !== "court" && layout !== "lordHall") return null;
  if (theme.style === "temple") return tx % HALL_PILLAR_STEP === 0 ? "pillar" : null;
  if (theme.style === "deep") return tx % HALL_PILLAR_STEP === 0 ? "scripture" : null;
  if ((theme.style === "castleFire" || theme.style === "castleFrost") && layout === "lordHall") return tx % HALL_BANNER_STEP === 0 ? "banner" : null;
  return null;
}

/** 側面のマスの飾りを 1 つ選ぶ（フラグごとに 32 分率の枠を割り当て、1 マスに 1 つ） */
function sideKindOf(theme: MapTheme, hall: boolean, layout: FloorLayout | undefined, tx: number, seed: number, h: number): SideKind | null {
  if (hall) return hallSideKind(theme, layout, tx);
  const flags = theme.flags;
  if (flags.beams && (tx + ((seed >>> 8) & 3)) % BEAM_STEP === 0) return "beam";
  const r = (h >>> 4) % SIDE_SLOTS;
  let from = 0;
  const slot = (rate: number): boolean => {
    const hit = r >= from && r < from + rate;
    from += rate;
    return hit;
  };
  // 広く出るもの（氷柱）は他と枠を取り合わず、先に判定する
  if (flags.icicles && r < SIDE_RATE_ICICLE) return "icicle";
  if (flags.shimenawa && slot(SIDE_RATE_SHIMENAWA)) return "shimenawa";
  if (flags.redPillar && slot(SIDE_RATE_PILLAR)) return "pillar";
  if (flags.banners && slot(SIDE_RATE_BANNER)) return "banner";
  if (flags.sideMoss && slot(SIDE_RATE_MOSS)) return "glowMoss";
  if (theme.style === "deep" && slot(SIDE_RATE_SCRIPTURE)) return "scripture";
  return null;
}

function drawSideShimenawa(p: Paint, tx: number, yTop: number): void {
  for (let x = 0; x < TILE_DOTS; x++) {
    const wx = tx * TILE_DOTS + x;
    const sag = Math.round(Math.sin((x / (TILE_DOTS - 1)) * Math.PI) * 4);
    for (let q = 0; q < 3; q++) {
      const c = q === 0 ? ROPE_LIGHT : q === 1 ? ((x + q) % 4 < 2 ? ROPE_MID_A : ROPE_MID_B) : ROPE_DARK;
      setSidePx(p, wx, yTop + 3 + sag + q, c);
    }
  }
  for (const sx of [7, 16, 25]) {
    const sag = Math.round(Math.sin((sx / (TILE_DOTS - 1)) * Math.PI) * 4);
    for (let q = 0; q < 8; q++) setSidePx(p, tx * TILE_DOTS + sx + (((q >> 1) & 1) !== 0 ? 1 : 0), yTop + 6 + sag + q, q === 7 ? SHIDE_TIP : SHIDE);
  }
}

function drawSidePillar(p: Paint, tx: number, yTop: number): void {
  const P = p.P;
  const left = tx * TILE_DOTS + (TILE_DOTS - PILLAR_W) / 2;
  const height = p.theme.sideH;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < PILLAR_W; x++) {
      let c: number;
      if (x === 0 || x === PILLAR_W - 1) c = OUTLINE;
      else if (y < 3) c = P.tD;
      else if (y >= height - 3) c = P.stoneL;
      else c = x === 1 ? P.accL : x >= PILLAR_W - 3 ? P.accD : P.accent;
      setSidePx(p, left + x, yTop + y, c);
    }
  }
}

function drawSideBeam(p: Paint, tx: number, yTop: number): void {
  const P = p.P;
  const left = tx * TILE_DOTS + 3;
  for (let y = 0; y < p.theme.sideH; y++) {
    for (let x = 0; x < 6; x++) setSidePx(p, left + x, yTop + y, x === 0 ? OUTLINE : x < 3 ? lighten(P.wood, 0.25) : x < 5 ? P.wood : darken(P.wood, 0.4));
  }
  for (let y = 0; y < 4; y++) {
    for (let x = -4; x < 10; x++) setSidePx(p, left + x, yTop + y, y === 3 ? OUTLINE : y === 0 ? lighten(P.wood, 0.25) : P.wood);
  }
}

function drawSideBanner(p: Paint, tx: number, yTop: number): void {
  const left = tx * TILE_DOTS + 10;
  const height = p.theme.sideH - 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 10; x++) {
      if (y > height - 8 && (x * 7 + y * 3) % 5 < 2) continue;
      const c = x === 0 || x === 9 ? OUTLINE : y < 2 ? BANNER_TOP : (x + y) % 9 === 0 ? p.P.soot : BANNER_BASE;
      setSidePx(p, left + x, yTop + SIDE_TOP_GAP + y, c);
    }
  }
}

function drawSideIcicles(p: Paint, tx: number, yTop: number, h: number): void {
  for (let x = 1; x < TILE_DOTS - 1; x += 3 + ((h >>> x) & 3)) {
    const len = 4 + ((h >>> (x + 3)) & 7);
    for (let q = 0; q < len; q++) {
      const wx = tx * TILE_DOTS + x;
      setSidePx(p, wx, yTop + q, q < len - 3 ? ICE_LIGHT : ICE_MID);
      if (q < len / 2) setSidePx(p, wx + 1, yTop + q, ICE_DARK);
    }
  }
}

/** 光る苔。描けた所があれば光源にも出す（呼び出し側が自分のチャンクの物だけ出すかを決める） */
function drawSideMoss(p: Paint, tx: number, yTop: number, h: number): { x: number; y: number } | null {
  const cx = tx * TILE_DOTS + 6 + ((h >>> 5) % 20);
  const cy = yTop + 5 + ((h >>> 9) % Math.max(1, p.theme.sideH - 8));
  let any = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      if (setSidePx(p, cx + dx, cy + dy, Math.abs(dx) + Math.abs(dy) <= 1 ? MOSS_CORE : p.P.light)) any = true;
    }
  }
  return any ? { x: cx, y: cy + 10 } : null;
}

function drawSideScripture(p: Paint, tx: number, yTop: number): void {
  const gold = mixColor(p.P.accent, p.P.sB, 0.2);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < Math.floor((p.theme.sideH - 4) / 5); row++) {
      const bits = h32(tx * 3 + col, row, p.seed + 53);
      const x = tx * TILE_DOTS + 6 + col * 9;
      const y = yTop + 3 + row * 5;
      for (let q = 0; q < 6; q++) if ((bits >>> q) & 1) setSidePx(p, x + (q % 2), y + ((q / 2) | 0), gold);
    }
  }
}

function drawSideDecor(p: Paint, kind: SideKind, tx: number, ty: number, h: number, own: boolean): void {
  const yTop = (ty + 1) * TILE_DOTS - p.theme.sideH;
  if (kind === "shimenawa") drawSideShimenawa(p, tx, yTop);
  else if (kind === "pillar") drawSidePillar(p, tx, yTop);
  else if (kind === "beam") drawSideBeam(p, tx, yTop);
  else if (kind === "banner") drawSideBanner(p, tx, yTop);
  else if (kind === "icicle") drawSideIcicles(p, tx, yTop, h);
  else if (kind === "scripture") drawSideScripture(p, tx, yTop);
  else {
    const at = drawSideMoss(p, tx, yTop, h);
    if (at && own) pushLight(p, at.x, at.y, MOSS_LIGHT);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** 範囲（ワールドのドット）を覆うタイル範囲 */
function tileRange(x: number, y: number, w: number, h: number): { tx0: number; ty0: number; tx1: number; ty1: number } {
  return {
    tx0: floorDiv(x, TILE_DOTS),
    ty0: floorDiv(y, TILE_DOTS),
    tx1: floorDiv(x + w - 1, TILE_DOTS),
    ty1: floorDiv(y + h - 1, TILE_DOTS),
  };
}

function floorDecalAt(map: GameMap, theme: MapTheme, seed: number, tx: number, ty: number): { kind: DecalKind; x: number; y: number; h: number } | null {
  if (!isFloor(map, tx, ty) || isShallow(map, tx, ty)) return null;
  const kinds = theme.decals.filter((k) => k !== "rail");
  if (kinds.length === 0) return null;
  const h = h32(tx, ty, seed + 5);
  const near = nearSolid(map, tx, ty);
  if ((h & 255) / 256 >= (near ? DECAL_NEAR_RATE : DECAL_FAR_RATE)) return null;
  const kind = kinds[(h >>> 8) % kinds.length];
  if (!kind) return null;
  // 頭骨は平らでない（立体の絵）ので、広い床には転がさず、壁のそばでも間引く（広間を読みやすく）
  if (kind === "bones" && (!near || ((h >>> 27) & 3) !== 0)) return null;
  // 異界の床は敷石に金の文字が入っているので、足す文字は控えめに
  if (kind === "glyph" && (h >>> 27) % 3 !== 0) return null;
  return { kind, x: tx * TILE_DOTS + DECAL_PAD + ((h >>> 12) % DECAL_SPAN), y: ty * TILE_DOTS + DECAL_PAD + ((h >>> 17) % DECAL_SPAN), h };
}

function paintFloorDecals(p: Paint, map: GameMap, tx0: number, ty0: number, tx1: number, ty1: number): void {
  const rail = p.theme.decals.includes("rail");
  const seed = p.seed;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (rail) {
        const axis = railAxis(map, tx, ty);
        if (axis) drawRail(p, tx, ty, axis);
      }
      const d = floorDecalAt(map, p.theme, seed, tx, ty);
      if (d) drawDecal(p, d.kind, d.x, d.y, d.h);
    }
  }
}

function paintSideDecor(p: Paint, ctx: DecorContext, own: { tx0: number; ty0: number; tx1: number; ty1: number }, tx0: number, ty0: number, tx1: number, ty1: number): void {
  const { map, theme, info } = ctx;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      if (!isWall(map, tx, ty) || isWall(map, tx, ty + 1)) continue;
      const south = ty + 1 < map.height ? (info.roomOf[(ty + 1) * map.width + tx] ?? NO_ROOM) : NO_ROOM;
      const hall = (info.layout === "court" || info.layout === "lordHall") && info.lord !== NO_ROOM && south === info.lord;
      const h = h32(tx, ty, ctx.seed + 3);
      const kind = sideKindOf(theme, hall, info.layout, tx, ctx.seed, h);
      if (!kind) continue;
      drawSideDecor(p, kind, tx, ty, h, tx >= own.tx0 && tx <= own.tx1 && ty >= own.ty0 && ty <= own.ty1);
    }
  }
}

/** 置物を描く順: 奈落の物（背景）→ 根元の y の小さい順 → x の小さい順（チャンクを替えても同じ重なり） */
function sortForDraw(list: DecorPlacement[]): DecorPlacement[] {
  const rank = (pl: DecorPlacement): number => (pl.place === "void" ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x || a.tx - b.tx || (a.kind < b.kind ? -1 : 1));
}

/**
 * 焼いた ground に、汚し・側面の飾り・置物を描き込み、光源を返す。
 * 根元がチャンクの外にある置物も、はみ出す分は描く。光源は根元がこの範囲にあるものだけ返す（隣のチャンクと二重にしない）
 */
export function decorateChunk(input: DecorInput): MapLight[] {
  const { map, theme } = input;
  const ctx = makeContext(map, theme, input.exclude);
  const paint: Paint = {
    ground: input.ground,
    x0: input.x,
    y0: input.y,
    w: input.w,
    h: input.h,
    surface: input.surface,
    theme,
    P: theme.palette,
    seed: ctx.seed,
    lights: [],
  };
  const own = tileRange(input.x, input.y, input.w, input.h);
  const m = DRAW_MARGIN_TILES;
  paintFloorDecals(paint, map, own.tx0 - m, own.ty0 - m, own.tx1 + m, own.ty1 + m);
  paintSideDecor(paint, ctx, own, own.tx0 - m, own.ty0 - m, own.tx1 + m, own.ty1 + m);
  const placed = sortForDraw(placementsIn(map, theme, input.exclude, own.tx0 - m, own.ty0 - m, own.tx1 + m, own.ty1 + m));
  for (const pl of placed) {
    drawPlacement(paint, pl);
    if (pl.tx >= own.tx0 && pl.tx <= own.tx1 && pl.ty >= own.ty0 && pl.ty <= own.ty1) lightOf(paint, pl);
  }
  if (input.lip) syncLip(input.lip, input.ground);
  return paint.lights;
}

/**
 * 縁のある画素を、描き込み後の ground の色へ揃える。縁は南の壁の手前（床の 3px と壁の天面の帯）にしか無く、
 * そこに描き込まれた汚し・飾り・置物は体より手前にあるので、縁と一緒に体の上へ描き直してよい
 */
function syncLip(lip: Uint32Array, ground: Uint32Array): void {
  const n = Math.min(lip.length, ground.length);
  for (let i = 0; i < n; i++) {
    if (lip[i] !== 0) lip[i] = ground[i] ?? 0;
  }
}

/** 砂紋の同心円は横に 1.15 倍の楕円（mapTextures の floorSand）。絵が届く範囲の見積もりに使う */
const RING_X_STRETCH = 1.15;
/** 焼き付けが床の模様を引く範囲の、焼く長方形からの余白（mapBake の MARGIN_*。上 32・左右 8・下は側面の高さ + 8 以内） */
const TEX_REACH_X = 8;
const TEX_REACH_TOP = 32;
const TEX_REACH_BOTTOM = 40;

/**
 * 枯山水の砂紋が避ける石（最深の間の墨の石）。床の模様は置物より先に焼くので、焼く前に呼んで文脈へ渡す。
 * 砂紋は石ごとに全ドットで距離を測るので、この長方形に同心円が届く石だけを返す。砂紋でない様式は空
 */
export function texStonesFor(map: GameMap, theme: MapTheme, exclude: Uint8Array | undefined, x: number, y: number, w: number, h: number): TexStone[] {
  if (theme.floor !== "sand") return [];
  const m = STONE_RING_MARGIN_TILES;
  const r = tileRange(x, y, w, h);
  const seed = decorSeed(map, theme);
  const left = x - TEX_REACH_X;
  const right = x + w + TEX_REACH_X;
  const top = y - TEX_REACH_TOP;
  const bottom = y + h + TEX_REACH_BOTTOM;
  return placementsIn(map, theme, exclude, r.tx0 - m, r.ty0 - m, r.tx1 + m, r.ty1 + m)
    .filter((pl) => pl.kind === "stone")
    .map((pl) => ({ x: pl.x, y: pl.y, ring: stoneSize(pl.tx, pl.ty, seed).rx * STONE_RING_MUL }))
    .filter((s) => s.x + s.ring * RING_X_STRETCH >= left && s.x - s.ring * RING_X_STRETCH <= right && s.y + s.ring >= top && s.y - s.ring <= bottom);
}
