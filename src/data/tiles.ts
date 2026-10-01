import type { SpriteDots } from "./sprites/dots";

/**
 * 外部素材（PNG）の取り込み表（docs/ideas/graphics-design.md レーン B / C）。
 * 座標は public/assets/ の実物を目視して決めた（10 章「取得結果」）。
 * ここは DOM に触らない純データ。切り出しは render/imageAtlas.ts、再配色の展開は render/tileAtlas.ts
 */

export const SHEET_KEYS = ["dungeon0x72", "puny", "kenneyTiny"] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export interface TileSpriteDef {
  /** SpriteAtlas のキー。コード内ピクセルマップと同名なら上書きする */
  key: string;
  sheet: SheetKey;
  /** シート上の矩形（px）。frames が 2 以上なら x 方向に w ずつ並ぶアニメとして切り出す */
  x: number;
  y: number;
  w: number;
  h: number;
  frames?: number;
  /** 密度（省略時 1）。段 2 で敵・プレイヤー・ボスの高解像度版を差し込むときに使う */
  dots?: SpriteDots;
}

/** シートの実寸（px）。テストで矩形がはみ出していないかを見る */
export const SHEET_SIZE: Readonly<Record<SheetKey, { w: number; h: number }>> = {
  dungeon0x72: { w: 0, h: 0 },
  puny: { w: 416, h: 320 },
  kenneyTiny: { w: 192, h: 176 },
};

/**
 * 読み込む PNG シート。URL は先頭の "/" を付けない（Electron の file:// でも index.html からの相対で引けるように）。
 * 0x72 DungeonTileset II は未取得（itch.io が手動ダウンロードのみ）なので載せない。取得したら
 * ここに 1 行足し、SHEET_SIZE と TILE_SPRITES に矩形を足し、TILE_SOURCES に組を足して BIOME_TILESET の source を向け替える
 */
export const SHEETS: readonly { key: SheetKey; url: string }[] = [
  { key: "puny", url: "assets/puny-dungeon/punyworld-dungeon-tileset.png" },
  { key: "kenneyTiny", url: "assets/kenney-tiny-dungeon/tilemap_packed.png" },
];

export interface Lut {
  /** 色相の加算シフト（度） */
  hue: number;
  /** 彩度の倍率 */
  sat: number;
  /** 明度の倍率 */
  val: number;
}

/** 無彩色の素材（Puny の壁は純粋な灰色）は色相を回しても色が乗らないので、上から色を薄く重ねて染める */
export interface Tint {
  color: string;
  /** 0..1。不透明な画素にだけ重ねる（透明部分は染めない） */
  alpha: number;
}

const TILE = 16;

/** 1 マス（または縦横 n マス）の矩形。列・行はシート上のタイル番号 */
function cell(key: string, sheet: SheetKey, col: number, row: number, frames?: number, tall = 1): TileSpriteDef {
  const def: TileSpriteDef = { key, sheet, x: col * TILE, y: row * TILE, w: TILE, h: TILE * tall };
  return frames === undefined ? def : { ...def, frames };
}

// -----------------------------------------------------------------------------
// 床・壁（素材の組 = source。拠点はこれを染めて作る）
// -----------------------------------------------------------------------------

/** 素材の組。拠点は BIOME_TILESET でどれかを指す */
export const TILE_SOURCES = ["puny"] as const;
export type TileSource = (typeof TILE_SOURCES)[number];

/** 壁の自動接続の数（render/renderMath.ts の wallMask: N=1 / E=2 / S=4 / W=8 の「隣が床」） */
export const WALL_MASK_COUNT = 16;
const FLOOR_N = 1;
const FLOOR_E = 2;
const FLOOR_S = 4;
const FLOOR_W = 8;

/**
 * Puny の壁（左上 4x4）: 列は左右の壁のつながり（孤立 / 東だけ / 両側 / 西だけ）、
 * 行は上下のつながり（南だけ / 両側 / 北だけ / 孤立）。南が床の段に手前面が描かれている
 */
export function punyWallCell(mask: number): { col: number; row: number } {
  const wallN = (mask & FLOOR_N) === 0;
  const wallE = (mask & FLOOR_E) === 0;
  const wallS = (mask & FLOOR_S) === 0;
  const wallW = (mask & FLOOR_W) === 0;
  const col = wallE ? (wallW ? 2 : 1) : wallW ? 3 : 0;
  const row = wallS ? (wallN ? 1 : 0) : wallN ? 2 : 3;
  return { col, row };
}

/** 床の 4 変種（Puny の 4x4 の継ぎ目なし床の 1 段目。tileHash で選ぶ） */
const PUNY_FLOOR = { col: 4, row: 0, frames: 4 };

function punyTiles(): TileSpriteDef[] {
  const out: TileSpriteDef[] = [cell("tile.puny.floor", "puny", PUNY_FLOOR.col, PUNY_FLOOR.row, PUNY_FLOOR.frames)];
  for (let mask = 0; mask < WALL_MASK_COUNT; mask++) {
    const { col, row } = punyWallCell(mask);
    out.push(cell(`tile.puny.wall.${mask}`, "puny", col, row));
  }
  return out;
}

/** 拠点が持つ床・壁のキーの末尾（tile.hub.<suffix>） */
export function biomeTileSuffixes(): string[] {
  const out = ["floor"];
  for (let mask = 0; mask < WALL_MASK_COUNT; mask++) out.push(`wall.${mask}`);
  return out;
}

// -----------------------------------------------------------------------------
// 切り出し表
// -----------------------------------------------------------------------------

/**
 * 切り出し表。キーの種類:
 * - tile.<source>.floor / tile.<source>.wall.<mask>: 素材の組（再配色前）。拠点版は DERIVED で作る
 * - stairs: コード内ピクセルマップの同名キーを上書き（封鎖の扉は renderer.ts が描く。地形の層は render/terrainTex.ts）
 * - prop.<PropKind>: 部屋の台座・仕掛け
 * - hub.<HubSpotKey>: 拠点の設備（render/hubUi.ts が読む）
 */
export const TILE_SPRITES: readonly TileSpriteDef[] = [
  ...punyTiles(),
  // 下り階段 = 床に開いた穴（落とし戸のアニメの最後のコマ）
  cell("stairs", "puny", 19, 16),
  // 台座・仕掛け
  cell("prop.chest", "puny", 21, 18),
  cell("prop.lever", "puny", 21, 17, 3),
  cell("prop.seal", "puny", 24, 17),
  cell("prop.keystone", "puny", 23, 18),
  cell("prop.vein", "puny", 16, 13),
  cell("prop.ascend", "puny", 20, 19),
  cell("prop.inverter", "puny", 25, 17),
  cell("prop.anvil", "kenneyTiny", 2, 6),
  cell("prop.rune", "kenneyTiny", 3, 5),
  cell("prop.exchange", "kenneyTiny", 0, 6),
  cell("prop.curse", "kenneyTiny", 5, 5),
  cell("prop.element", "kenneyTiny", 4, 5),
  // 拠点の設備
  cell("hub.well", "kenneyTiny", 8, 4),
  cell("hub.board", "kenneyTiny", 6, 5),
  cell("hub.forge", "kenneyTiny", 7, 4),
  cell("hub.library", "kenneyTiny", 3, 5, undefined, 2),
  cell("hub.altar", "puny", 23, 18),
  cell("hub.garden", "puny", 23, 19),
  cell("hub.history", "kenneyTiny", 0, 6),
  cell("hub.codex", "kenneyTiny", 5, 5),
  cell("hub.achievements", "kenneyTiny", 6, 4),
  cell("hub.rack", "kenneyTiny", 10, 8),
  cell("hub.hall", "puny", 24, 17),
];

/**
 * シートごとの再配色。Kenney は明るく彩度が高いので、世界に置く分は暗く寄せて Puny の石と馴染ませる
 * （graphics-design.md 4 章「明度 -20%・彩度 -30%」）
 */
export const SHEET_LUT: Readonly<Partial<Record<SheetKey, Lut>>> = {
  kenneyTiny: { hue: 0, sat: 0.7, val: 0.8 },
};

// -----------------------------------------------------------------------------
// バイオーム
// -----------------------------------------------------------------------------

export interface BiomeTileset {
  /** 床・壁の素材の組 */
  source: TileSource;
  lut?: Lut;
  tint?: Tint;
}

/**
 * 拠点の床・壁（tile.hub.*）。迷宮の床・壁は render/mapBake.ts の焼き付け（章の様式 × バイオーム）が描くので、
 * 9 バイオームの派生は持たない
 */
export const BIOME_TILESET: Readonly<{ hub: BiomeTileset }> = {
  hub: { source: "puny", tint: { color: "#c08040", alpha: 0.18 } },
};

// -----------------------------------------------------------------------------
// 派生スプライト（読み込み時に 1 回だけ再配色して作る。毎フレームの合成はしない）
// -----------------------------------------------------------------------------

export interface DerivedSprite {
  key: string;
  /** TILE_SPRITES のキー */
  from: string;
  lut?: Lut;
  tint?: Tint;
}

function biomeDerived(): DerivedSprite[] {
  const out: DerivedSprite[] = [];
  for (const [biome, set] of Object.entries(BIOME_TILESET) as [string, BiomeTileset][]) {
    for (const suffix of biomeTileSuffixes()) {
      const d: DerivedSprite = { key: `tile.${biome}.${suffix}`, from: `tile.${set.source}.${suffix}` };
      out.push({ ...d, ...(set.lut ? { lut: set.lut } : {}), ...(set.tint ? { tint: set.tint } : {}) });
    }
  }
  return out;
}

export const DERIVED_SPRITES: readonly DerivedSprite[] = biomeDerived();
