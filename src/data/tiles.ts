import type { SpriteDots } from "./sprites/dots";

/**
 * 外部素材（PNG）の取り込み表（docs/ideas/graphics-design.md レーン B / C）。
 * 座標は public/assets/ の実物を目視して決めた（10 章「取得結果」）。
 * ここは DOM に触らない純データ。切り出しは render/imageAtlas.ts、再配色の展開は render/tileAtlas.ts。
 * 床・壁は迷宮が render/mapBake.ts の焼き付け、拠点（門前町）が render/townScene.ts の手続きで描くので、PNG の床・壁は持たない
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
 * ここに 1 行足し、SHEET_SIZE と TILE_SPRITES に矩形を足す
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

const TILE = 16;

/** 1 マス（または縦横 n マス）の矩形。列・行はシート上のタイル番号 */
function cell(key: string, sheet: SheetKey, col: number, row: number, frames?: number, tall = 1): TileSpriteDef {
  const def: TileSpriteDef = { key, sheet, x: col * TILE, y: row * TILE, w: TILE, h: TILE * tall };
  return frames === undefined ? def : { ...def, frames };
}

// -----------------------------------------------------------------------------
// 切り出し表
// -----------------------------------------------------------------------------

/**
 * 切り出し表。キーの種類:
 * - stairs: コード内ピクセルマップの同名キーを上書き（封鎖の扉は renderer.ts が描く。地形の層は render/terrainTex.ts）
 * - prop.<PropKind>: 部屋の台座・仕掛け
 */
export const TILE_SPRITES: readonly TileSpriteDef[] = [
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
];

/**
 * シートごとの再配色。Kenney は明るく彩度が高いので、世界に置く分は暗く寄せて Puny の石と馴染ませる
 * （graphics-design.md 4 章「明度 -20%・彩度 -30%」）
 */
export const SHEET_LUT: Readonly<Partial<Record<SheetKey, Lut>>> = {
  kenneyTiny: { hue: 0, sat: 0.7, val: 0.8 },
};
