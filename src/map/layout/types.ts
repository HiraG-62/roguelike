/**
 * 階の型（8 種）の共通の型。生成器・後処理・選択・floor との結線はすべてこの形に従う。
 * 設計は docs/ideas/map-gen-impl.md（3 章の「型のシグネチャ」）
 */
import type { Rng } from "../../core/rng";

export const LAYOUT_KINDS = ["cavern", "river", "ring", "court", "drunk", "isle", "terrace", "prefab"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];
/** 階の型。"legacy" = 旧生成器（生成に失敗したときの代わり・テストの固定）。"lordHall" = ボス階の専用の部屋 */
export type FloorLayout = LayoutKind | "legacy" | "lordHall";

/** 下書きのセル。GameMap の Tile とは別の小さな語彙（finalize が Tile に写す） */
export const Cell = { Floor: 0, Wall: 1, Pit: 2 } as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

/** 生成器に渡す枠。長さは unit 倍、個数は countMul 倍、道幅は据え置き（map-gen-impl.md 2-4） */
export interface LayoutFrame {
  width: number;
  height: number;
  unit: number;
  countMul: number;
  /** 座標ハッシュの雑音の種（生成器の最初に rng から 1 回だけ引く） */
  noiseSeed: number;
  /** 主の間の半径（タイル） */
  lordRadius: number;
}

export type NodeRole = "start" | "lord" | "room";

/** 部屋の芯。tiles を持てばそれを所属タイルの種に、持たなければ (x, y) から半径 grow まで育てる */
export interface LayoutNode {
  x: number;
  y: number;
  role: NodeRole;
  grow: number;
  tiles?: number[];
}

/** 型の下書き。cells / shallow は width * height の 1 次元配列 */
export interface LayoutDraft {
  cells: Uint8Array;
  /** 浅い地形の地形番号（0 = なし） */
  shallow: Uint8Array;
  nodes: LayoutNode[];
}

/** 型の生成器。作れなかったら null（呼び出し側が同じ rng を進めて作り直す） */
export type LayoutGenerator = (rng: Rng, frame: LayoutFrame) => LayoutDraft | null;

/** 型を選ぶときの文脈 */
export interface LayoutContext {
  depth: number;
  /** 章（1〜4）。深みでは最後の章 */
  chapter: number;
  isDeep: boolean;
  isBossFloor: boolean;
  floorKind: string;
  /** 前の階の型（同じ型を続けないため） */
  previous?: FloorLayout;
}
