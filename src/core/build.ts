/**
 * ビルドの共通語（データのみ）。祝福・名のある遺物など層をまたぐ定義が同じ言葉で「何が変わるか」「どの行動に宿るか」を語るための型。
 * loot は system を import しないので、system/boonDefs.ts から core へ移した（boonDefs は re-export する）
 */

/** 柱 7 の審査: その札・遺物で何が変わるか（押すもの / 押す時 / 立つ場所 / 狙う相手 / 見るもの） */
export type BuildChange = "press" | "timing" | "position" | "target" | "watch";

/** 加護が宿る行動（左 / 右 / ダッシュ / スキル / 奥義） */
export type BoonAction = "primary" | "secondary" | "dash" | "skill" | "ultimate";
