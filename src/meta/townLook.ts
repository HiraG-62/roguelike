/**
 * 門前町の景色の材料（docs/ideas/hub-town-impl.md 5 章）。既存の保存データ（図鑑・実績・プロファイル・寄進・ボスの間）から導く純関数。
 * 新しい保存キーは持たない。描画（render/townScene.ts・townArt.ts）はこれを読むだけ
 */
import type { FacilityKey, HubProgressSource } from "./hub";
import type { HubSave } from "./hubStore";

export interface TownLook {
  /** 見た目が変わる材料をつないだ鍵。同じなら同じ絵（描画側の canvas の作り直しの判断に使う） */
  key: string;
  /** 建っている設備（建物の絵・提灯・暖簾） */
  built: ReadonlySet<FacilityKey>;
  /** 参道に立つ灯籠の数（HubLayout.lanternSlots の前から） */
  lanterns: number;
  /** 井戸の段（0〜3。寄進の総額で育つ） */
  wellTier: number;
  /** 御堂の前の幟の章（倒したボス 1 体につき 1 本。値は章 1〜4 の色の番号） */
  trophies: readonly number[];
  /** 御堂の篝火（ボスの間で勝ったことがある） */
  hallLit: boolean;
  /** 記録の蔵の窓の灯の数（0〜5。書架の段） */
  archiveLights: number;
  /** 踏破の碑の位階（0 は碑が無い） */
  stele: number;
  /** 最深の章（1〜4。深み以降は 4）。石段の奥の灯の色 */
  deepestChapter: number;
  /** 賑わいの段（0〜4。ランの回数） */
  bustle: number;
  /** 高札に掲げる称号（名乗っていなければ null） */
  title: string | null;
}

/** 景色の材料の入力。bestDepth は profile.meta.bestDepth の写し（省略は 0） */
export interface TownSource extends HubProgressSource {
  bestDepth?: number;
}

/** 段 0 の仮置き: レーン B が中身を書く */
export function townLook(src: TownSource, save: HubSave): TownLook {
  void src;
  void save;
  return {
    key: "stub",
    built: new Set(),
    lanterns: 0,
    wellTier: 0,
    trophies: [],
    hallLit: false,
    archiveLights: 0,
    stele: 0,
    deepestChapter: 1,
    bustle: 0,
    title: null,
  };
}
