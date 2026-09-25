// 生成物: npm run fx:gen（scripts/fx/gen.mjs）。手で直さない。docs/ideas/fx-sprites.md
// アトラスごとの中身は src/data/fx/<key>.gen.json（寸法・シートの矩形・武器種のモーションの表）
import fx_sword from "./fx/sword.gen.json";

/** アトラス（public/ からの相対パスと寸法） */
export const FX_ATLASES = {
  sword: { url: "assets/fx/sword.png", width: fx_sword.width, height: fx_sword.height },
} as const;

export type FxAtlasKey = keyof typeof FX_ATLASES;

/**
 * シート 1 つ（モーション 1 つ）。rects は `(dir * frames + frame) * 6` から [x, y, w, h, ox, oy]。
 * (ox, oy) は矩形の左上から原点（振りの中心など）までのずれ（絵のドット）。空のフレームは w = h = 0
 */
export interface FxSheetDef {
  /** 載っているアトラス（FxAtlasKey。JSON 由来なので string で持ち、引くときに確かめる） */
  readonly atlas: string;
  readonly frames: number;
  /** 事前に描いた方向の数（1 は向きなし）。方向 i の角は i / dirs * 2π */
  readonly dirs: number;
  /** 振りの active に割り当てるフレーム数（残りは振り終わりの尾） */
  readonly active: number;
  readonly rects: readonly number[];
}

export const FX_SHEETS = {
  ...fx_sword.sheets,
} satisfies Record<string, FxSheetDef>;

export type FxSheetKey = keyof typeof FX_SHEETS;

/** アトラスごとの武器種のモーションの表（検査と型付けは render/fxMotions.ts） */
export const FX_MOVESET_RAW = [fx_sword.fx] as const;
