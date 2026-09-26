// 生成物: npm run actor:gen（scripts/actor/gen.mjs）。手で直さない。docs/ideas/player-sprites.md
// アトラスごとの中身は src/data/actor/<key>.gen.json（寸法・シートの矩形・位置の印・アトラスの付帯情報）
import actor_bodyNone from "./actor/bodyNone.gen.json";
import actor_wpnSidearm from "./actor/wpnSidearm.gen.json";
import actor_wpnSpear from "./actor/wpnSpear.gen.json";
import actor_wpnSword from "./actor/wpnSword.gen.json";
import actor_wpnTwinBlades from "./actor/wpnTwinBlades.gen.json";

/** アトラス（public/ からの相対パスと寸法、付帯情報） */
export const ACTOR_ATLASES = {
  bodyNone: { url: "assets/actor/bodyNone.png", width: actor_bodyNone.width, height: actor_bodyNone.height, meta: actor_bodyNone.meta },
  wpnSidearm: { url: "assets/actor/wpnSidearm.png", width: actor_wpnSidearm.width, height: actor_wpnSidearm.height, meta: actor_wpnSidearm.meta },
  wpnSpear: { url: "assets/actor/wpnSpear.png", width: actor_wpnSpear.width, height: actor_wpnSpear.height, meta: actor_wpnSpear.meta },
  wpnSword: { url: "assets/actor/wpnSword.png", width: actor_wpnSword.width, height: actor_wpnSword.height, meta: actor_wpnSword.meta },
  wpnTwinBlades: { url: "assets/actor/wpnTwinBlades.png", width: actor_wpnTwinBlades.width, height: actor_wpnTwinBlades.height, meta: actor_wpnTwinBlades.meta },
} as const;

export type ActorAtlasKey = keyof typeof ACTOR_ATLASES;

/**
 * シート 1 つ。rects は `(dir * frames + frame) * 6` から [x, y, w, h, ox, oy]（(ox, oy) は矩形の左上から原点までのずれ、絵のドット）。
 * anchors は同じ順で、原点からの位置の印（肩・頭・銃口など）
 */
export interface ActorSheetDef {
  readonly atlas: string;
  readonly frames: number;
  readonly dirs: number;
  readonly rects: readonly number[];
  readonly anchors?: readonly Readonly<Record<string, readonly number[]>>[];
}

export const ACTOR_SHEETS: Record<string, ActorSheetDef> = {
  ...actor_bodyNone.sheets,
  ...actor_wpnSidearm.sheets,
  ...actor_wpnSpear.sheets,
  ...actor_wpnSword.sheets,
  ...actor_wpnTwinBlades.sheets,
};
