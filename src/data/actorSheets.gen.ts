// 生成物: npm run actor:gen（scripts/actor/gen.mjs）。手で直さない。docs/ideas/player-sprites.md
// アトラスごとの中身は src/data/actor/<key>.gen.json（寸法・シートの矩形・位置の印・アトラスの付帯情報）
import actor_bodyAlchemist from "./actor/bodyAlchemist.gen.json";
import actor_bodyBrawler from "./actor/bodyBrawler.gen.json";
import actor_bodyHexer from "./actor/bodyHexer.gen.json";
import actor_bodyHunter from "./actor/bodyHunter.gen.json";
import actor_bodyInvoker from "./actor/bodyInvoker.gen.json";
import actor_bodyLancer from "./actor/bodyLancer.gen.json";
import actor_bodyMiko from "./actor/bodyMiko.gen.json";
import actor_bodyNone from "./actor/bodyNone.gen.json";
import actor_bodyOnmyoji from "./actor/bodyOnmyoji.gen.json";
import actor_bodyShadow from "./actor/bodyShadow.gen.json";
import actor_bodyShieldBearer from "./actor/bodyShieldBearer.gen.json";
import actor_bodySwordsman from "./actor/bodySwordsman.gen.json";
import actor_wpnAxe from "./actor/wpnAxe.gen.json";
import actor_wpnBook from "./actor/wpnBook.gen.json";
import actor_wpnCannon from "./actor/wpnCannon.gen.json";
import actor_wpnChainSickle from "./actor/wpnChainSickle.gen.json";
import actor_wpnClaws from "./actor/wpnClaws.gen.json";
import actor_wpnCleaver from "./actor/wpnCleaver.gen.json";
import actor_wpnFan from "./actor/wpnFan.gen.json";
import actor_wpnFists from "./actor/wpnFists.gen.json";
import actor_wpnFlail from "./actor/wpnFlail.gen.json";
import actor_wpnGreatsword from "./actor/wpnGreatsword.gen.json";
import actor_wpnGrenade from "./actor/wpnGrenade.gen.json";
import actor_wpnGunner from "./actor/wpnGunner.gen.json";
import actor_wpnHammer from "./actor/wpnHammer.gen.json";
import actor_wpnHandbell from "./actor/wpnHandbell.gen.json";
import actor_wpnKatana from "./actor/wpnKatana.gen.json";
import actor_wpnKunai from "./actor/wpnKunai.gen.json";
import actor_wpnLongarm from "./actor/wpnLongarm.gen.json";
import actor_wpnRingBlades from "./actor/wpnRingBlades.gen.json";
import actor_wpnScythe from "./actor/wpnScythe.gen.json";
import actor_wpnShield from "./actor/wpnShield.gen.json";
import actor_wpnShuriken from "./actor/wpnShuriken.gen.json";
import actor_wpnSidearm from "./actor/wpnSidearm.gen.json";
import actor_wpnSpear from "./actor/wpnSpear.gen.json";
import actor_wpnStaff from "./actor/wpnStaff.gen.json";
import actor_wpnSword from "./actor/wpnSword.gen.json";
import actor_wpnTrapper from "./actor/wpnTrapper.gen.json";
import actor_wpnTwinBlades from "./actor/wpnTwinBlades.gen.json";
import actor_wpnWand from "./actor/wpnWand.gen.json";
import actor_wpnWhip from "./actor/wpnWhip.gen.json";

/** アトラス（public/ からの相対パスと寸法、付帯情報） */
export const ACTOR_ATLASES = {
  bodyAlchemist: { url: "assets/actor/bodyAlchemist.png", width: actor_bodyAlchemist.width, height: actor_bodyAlchemist.height, meta: actor_bodyAlchemist.meta },
  bodyBrawler: { url: "assets/actor/bodyBrawler.png", width: actor_bodyBrawler.width, height: actor_bodyBrawler.height, meta: actor_bodyBrawler.meta },
  bodyHexer: { url: "assets/actor/bodyHexer.png", width: actor_bodyHexer.width, height: actor_bodyHexer.height, meta: actor_bodyHexer.meta },
  bodyHunter: { url: "assets/actor/bodyHunter.png", width: actor_bodyHunter.width, height: actor_bodyHunter.height, meta: actor_bodyHunter.meta },
  bodyInvoker: { url: "assets/actor/bodyInvoker.png", width: actor_bodyInvoker.width, height: actor_bodyInvoker.height, meta: actor_bodyInvoker.meta },
  bodyLancer: { url: "assets/actor/bodyLancer.png", width: actor_bodyLancer.width, height: actor_bodyLancer.height, meta: actor_bodyLancer.meta },
  bodyMiko: { url: "assets/actor/bodyMiko.png", width: actor_bodyMiko.width, height: actor_bodyMiko.height, meta: actor_bodyMiko.meta },
  bodyNone: { url: "assets/actor/bodyNone.png", width: actor_bodyNone.width, height: actor_bodyNone.height, meta: actor_bodyNone.meta },
  bodyOnmyoji: { url: "assets/actor/bodyOnmyoji.png", width: actor_bodyOnmyoji.width, height: actor_bodyOnmyoji.height, meta: actor_bodyOnmyoji.meta },
  bodyShadow: { url: "assets/actor/bodyShadow.png", width: actor_bodyShadow.width, height: actor_bodyShadow.height, meta: actor_bodyShadow.meta },
  bodyShieldBearer: { url: "assets/actor/bodyShieldBearer.png", width: actor_bodyShieldBearer.width, height: actor_bodyShieldBearer.height, meta: actor_bodyShieldBearer.meta },
  bodySwordsman: { url: "assets/actor/bodySwordsman.png", width: actor_bodySwordsman.width, height: actor_bodySwordsman.height, meta: actor_bodySwordsman.meta },
  wpnAxe: { url: "assets/actor/wpnAxe.png", width: actor_wpnAxe.width, height: actor_wpnAxe.height, meta: actor_wpnAxe.meta },
  wpnBook: { url: "assets/actor/wpnBook.png", width: actor_wpnBook.width, height: actor_wpnBook.height, meta: actor_wpnBook.meta },
  wpnCannon: { url: "assets/actor/wpnCannon.png", width: actor_wpnCannon.width, height: actor_wpnCannon.height, meta: actor_wpnCannon.meta },
  wpnChainSickle: { url: "assets/actor/wpnChainSickle.png", width: actor_wpnChainSickle.width, height: actor_wpnChainSickle.height, meta: actor_wpnChainSickle.meta },
  wpnClaws: { url: "assets/actor/wpnClaws.png", width: actor_wpnClaws.width, height: actor_wpnClaws.height, meta: actor_wpnClaws.meta },
  wpnCleaver: { url: "assets/actor/wpnCleaver.png", width: actor_wpnCleaver.width, height: actor_wpnCleaver.height, meta: actor_wpnCleaver.meta },
  wpnFan: { url: "assets/actor/wpnFan.png", width: actor_wpnFan.width, height: actor_wpnFan.height, meta: actor_wpnFan.meta },
  wpnFists: { url: "assets/actor/wpnFists.png", width: actor_wpnFists.width, height: actor_wpnFists.height, meta: actor_wpnFists.meta },
  wpnFlail: { url: "assets/actor/wpnFlail.png", width: actor_wpnFlail.width, height: actor_wpnFlail.height, meta: actor_wpnFlail.meta },
  wpnGreatsword: { url: "assets/actor/wpnGreatsword.png", width: actor_wpnGreatsword.width, height: actor_wpnGreatsword.height, meta: actor_wpnGreatsword.meta },
  wpnGrenade: { url: "assets/actor/wpnGrenade.png", width: actor_wpnGrenade.width, height: actor_wpnGrenade.height, meta: actor_wpnGrenade.meta },
  wpnGunner: { url: "assets/actor/wpnGunner.png", width: actor_wpnGunner.width, height: actor_wpnGunner.height, meta: actor_wpnGunner.meta },
  wpnHammer: { url: "assets/actor/wpnHammer.png", width: actor_wpnHammer.width, height: actor_wpnHammer.height, meta: actor_wpnHammer.meta },
  wpnHandbell: { url: "assets/actor/wpnHandbell.png", width: actor_wpnHandbell.width, height: actor_wpnHandbell.height, meta: actor_wpnHandbell.meta },
  wpnKatana: { url: "assets/actor/wpnKatana.png", width: actor_wpnKatana.width, height: actor_wpnKatana.height, meta: actor_wpnKatana.meta },
  wpnKunai: { url: "assets/actor/wpnKunai.png", width: actor_wpnKunai.width, height: actor_wpnKunai.height, meta: actor_wpnKunai.meta },
  wpnLongarm: { url: "assets/actor/wpnLongarm.png", width: actor_wpnLongarm.width, height: actor_wpnLongarm.height, meta: actor_wpnLongarm.meta },
  wpnRingBlades: { url: "assets/actor/wpnRingBlades.png", width: actor_wpnRingBlades.width, height: actor_wpnRingBlades.height, meta: actor_wpnRingBlades.meta },
  wpnScythe: { url: "assets/actor/wpnScythe.png", width: actor_wpnScythe.width, height: actor_wpnScythe.height, meta: actor_wpnScythe.meta },
  wpnShield: { url: "assets/actor/wpnShield.png", width: actor_wpnShield.width, height: actor_wpnShield.height, meta: actor_wpnShield.meta },
  wpnShuriken: { url: "assets/actor/wpnShuriken.png", width: actor_wpnShuriken.width, height: actor_wpnShuriken.height, meta: actor_wpnShuriken.meta },
  wpnSidearm: { url: "assets/actor/wpnSidearm.png", width: actor_wpnSidearm.width, height: actor_wpnSidearm.height, meta: actor_wpnSidearm.meta },
  wpnSpear: { url: "assets/actor/wpnSpear.png", width: actor_wpnSpear.width, height: actor_wpnSpear.height, meta: actor_wpnSpear.meta },
  wpnStaff: { url: "assets/actor/wpnStaff.png", width: actor_wpnStaff.width, height: actor_wpnStaff.height, meta: actor_wpnStaff.meta },
  wpnSword: { url: "assets/actor/wpnSword.png", width: actor_wpnSword.width, height: actor_wpnSword.height, meta: actor_wpnSword.meta },
  wpnTrapper: { url: "assets/actor/wpnTrapper.png", width: actor_wpnTrapper.width, height: actor_wpnTrapper.height, meta: actor_wpnTrapper.meta },
  wpnTwinBlades: { url: "assets/actor/wpnTwinBlades.png", width: actor_wpnTwinBlades.width, height: actor_wpnTwinBlades.height, meta: actor_wpnTwinBlades.meta },
  wpnWand: { url: "assets/actor/wpnWand.png", width: actor_wpnWand.width, height: actor_wpnWand.height, meta: actor_wpnWand.meta },
  wpnWhip: { url: "assets/actor/wpnWhip.png", width: actor_wpnWhip.width, height: actor_wpnWhip.height, meta: actor_wpnWhip.meta },
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
  ...actor_bodyAlchemist.sheets,
  ...actor_bodyBrawler.sheets,
  ...actor_bodyHexer.sheets,
  ...actor_bodyHunter.sheets,
  ...actor_bodyInvoker.sheets,
  ...actor_bodyLancer.sheets,
  ...actor_bodyMiko.sheets,
  ...actor_bodyNone.sheets,
  ...actor_bodyOnmyoji.sheets,
  ...actor_bodyShadow.sheets,
  ...actor_bodyShieldBearer.sheets,
  ...actor_bodySwordsman.sheets,
  ...actor_wpnAxe.sheets,
  ...actor_wpnBook.sheets,
  ...actor_wpnCannon.sheets,
  ...actor_wpnChainSickle.sheets,
  ...actor_wpnClaws.sheets,
  ...actor_wpnCleaver.sheets,
  ...actor_wpnFan.sheets,
  ...actor_wpnFists.sheets,
  ...actor_wpnFlail.sheets,
  ...actor_wpnGreatsword.sheets,
  ...actor_wpnGrenade.sheets,
  ...actor_wpnGunner.sheets,
  ...actor_wpnHammer.sheets,
  ...actor_wpnHandbell.sheets,
  ...actor_wpnKatana.sheets,
  ...actor_wpnKunai.sheets,
  ...actor_wpnLongarm.sheets,
  ...actor_wpnRingBlades.sheets,
  ...actor_wpnScythe.sheets,
  ...actor_wpnShield.sheets,
  ...actor_wpnShuriken.sheets,
  ...actor_wpnSidearm.sheets,
  ...actor_wpnSpear.sheets,
  ...actor_wpnStaff.sheets,
  ...actor_wpnSword.sheets,
  ...actor_wpnTrapper.sheets,
  ...actor_wpnTwinBlades.sheets,
  ...actor_wpnWand.sheets,
  ...actor_wpnWhip.sheets,
};
