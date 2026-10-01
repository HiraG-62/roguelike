/**
 * 門前町の建物と小物の絵（docs/ideas/hub-town-impl.md 4 章）。屋根・壁・柱・暖簾・看板の部品キットを手続きで組み、
 * 設備の印と小物は data/sprites/townProps.ts の手描き（密度 2 の役の文字）を重ねる。純関数で、同じ入力なら同じ画素。
 * 色は宵の町の配色で固定（迷宮のテーマに依らない）。画素は ABGR の 32bit（mapNoise.ts の pack と同じ並び）
 */
import type { HubLotKey } from "../map/hubMap";

/** 描く物の種類 */
export type TownObjectKind =
  /** 敷地の建物（built = false は縄張り・材木・足場の空き地）。well は使わず well の種類で描く。yard は稽古場の柵・砂の円・的 */
  | { type: "lot"; lot: HubLotKey; built: boolean }
  /** 井戸（段 0〜3） */
  | { type: "well"; tier: number }
  /** 鳥居と石段（HubLayout.gate の矩形に掛ける） */
  | { type: "torii" }
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

/** 段 0 の仮置き: レーン C2 が中身を書く（今は 1 ドットの透明） */
export function townObjectPixels(kind: TownObjectKind): TownPixels {
  void kind;
  return { w: 1, h: 1, anchor: { x: 0, y: 0 }, pixels: new Uint32Array(1) };
}
