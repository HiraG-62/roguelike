import type { GameMap } from "../map/grid";

/**
 * 地形の層（docs/ideas/status-and-terrain.md 3 章）。床タイルに重ねる層で、プレイヤーと敵の両方に効く。
 * 型と一覧だけを置く。ロジックは src/system/terrain.ts、配置は src/map/generator.ts の planTerrain
 */

/**
 * 並びが Uint8Array に入れる番号になる。0 は地形なし。既存の番号を変えないよう新しい種類は末尾に足す。
 * smoke（煙）は床ではなく空気に漂う層なので kinds には入らず、TerrainLayer.smoke に別に持つ（下の床の地形を消さない）
 */
export const TERRAIN_KINDS = ["none", "water", "oil", "lava", "bog", "ice", "grass", "fire", "mud", "smoke"] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

export const TERRAIN_LABEL: Readonly<Record<TerrainKind, string>> = {
  none: "",
  water: "水たまり",
  oil: "油",
  lava: "溶岩",
  bog: "毒沼",
  ice: "氷床",
  grass: "草むら",
  fire: "炎",
  mud: "泥",
  smoke: "煙",
};

export function terrainCode(kind: TerrainKind): number {
  return TERRAIN_KINDS.indexOf(kind);
}

export function terrainKindOf(code: number): TerrainKind {
  return TERRAIN_KINDS[code] ?? "none";
}

export interface TerrainLayer {
  /** この層を作ったマップ。フロアが変わったら作り直す（system/terrain.ts の ensureTerrain） */
  map: GameMap | null;
  /** マップ生成時の配置（planTerrain）を済ませたか。スキルの地形が先に置かれても自然配置は 1 回だけ入れる */
  planned: boolean;
  /** タイル index → 地形番号（TERRAIN_KINDS の添字） */
  kinds: Uint8Array;
  /** タイル index → 残り秒。0 は消えない */
  time: Float64Array;
  /** タイル index → 炎が隣へ燃え移るまでの残り秒（炎のセルだけ使う） */
  spread: Float64Array;
  /** 時間で変化するセル（残り秒のあるセル・炎）。毎ステップ全セルを走査しないための索引 */
  active: Set<number>;
  /** 上に立つ者へ効果を入れる周期のタイマーと通し番号 */
  tickTimer: number;
  tickCount: number;
  /** 変化の通し番号（描画側のキャッシュ判定用） */
  version: number;
  /** タイル index → 煙の残り秒（0 は煙なし）。床の地形とは重ねて持つ（煙が晴れても下の油・水は残る） */
  smoke: Float64Array;
  /** 煙のあるセル。毎ステップ全セルを走査しないための索引 */
  smokeCells: Set<number>;
}

export function createTerrainLayer(): TerrainLayer {
  return {
    map: null,
    planned: false,
    kinds: new Uint8Array(0),
    time: new Float64Array(0),
    spread: new Float64Array(0),
    active: new Set(),
    tickTimer: 0,
    tickCount: 0,
    version: 0,
    smoke: new Float64Array(0),
    smokeCells: new Set(),
  };
}
