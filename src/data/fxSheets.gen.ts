// 生成物: npm run fx:gen（scripts/fx/gen.mjs）。手で直さない。docs/ideas/fx-sprites.md
// アトラスごとの中身は src/data/fx/<key>.gen.json（寸法・シートの矩形・武器種のモーションの表）
import fx_axe from "./fx/axe.gen.json";
import fx_chainSickle from "./fx/chainSickle.gen.json";
import fx_claws from "./fx/claws.gen.json";
import fx_cleaver from "./fx/cleaver.gen.json";
import fx_fan from "./fx/fan.gen.json";
import fx_fists from "./fx/fists.gen.json";
import fx_flail from "./fx/flail.gen.json";
import fx_greatsword from "./fx/greatsword.gen.json";
import fx_hammer from "./fx/hammer.gen.json";
import fx_katana from "./fx/katana.gen.json";
import fx_ringBlades from "./fx/ringBlades.gen.json";
import fx_scythe from "./fx/scythe.gen.json";
import fx_shield from "./fx/shield.gen.json";
import fx_sidearm from "./fx/sidearm.gen.json";
import fx_spear from "./fx/spear.gen.json";
import fx_staff from "./fx/staff.gen.json";
import fx_sword from "./fx/sword.gen.json";
import fx_swordUlt from "./fx/swordUlt.gen.json";
import fx_twinBlades from "./fx/twinBlades.gen.json";
import fx_wand from "./fx/wand.gen.json";
import fx_whip from "./fx/whip.gen.json";

/** アトラス（public/ からの相対パスと寸法） */
export const FX_ATLASES = {
  axe: { url: "assets/fx/axe.png", width: fx_axe.width, height: fx_axe.height },
  chainSickle: { url: "assets/fx/chainSickle.png", width: fx_chainSickle.width, height: fx_chainSickle.height },
  claws: { url: "assets/fx/claws.png", width: fx_claws.width, height: fx_claws.height },
  cleaver: { url: "assets/fx/cleaver.png", width: fx_cleaver.width, height: fx_cleaver.height },
  fan: { url: "assets/fx/fan.png", width: fx_fan.width, height: fx_fan.height },
  fists: { url: "assets/fx/fists.png", width: fx_fists.width, height: fx_fists.height },
  flail: { url: "assets/fx/flail.png", width: fx_flail.width, height: fx_flail.height },
  greatsword: { url: "assets/fx/greatsword.png", width: fx_greatsword.width, height: fx_greatsword.height },
  hammer: { url: "assets/fx/hammer.png", width: fx_hammer.width, height: fx_hammer.height },
  katana: { url: "assets/fx/katana.png", width: fx_katana.width, height: fx_katana.height },
  ringBlades: { url: "assets/fx/ringBlades.png", width: fx_ringBlades.width, height: fx_ringBlades.height },
  scythe: { url: "assets/fx/scythe.png", width: fx_scythe.width, height: fx_scythe.height },
  shield: { url: "assets/fx/shield.png", width: fx_shield.width, height: fx_shield.height },
  sidearm: { url: "assets/fx/sidearm.png", width: fx_sidearm.width, height: fx_sidearm.height },
  spear: { url: "assets/fx/spear.png", width: fx_spear.width, height: fx_spear.height },
  staff: { url: "assets/fx/staff.png", width: fx_staff.width, height: fx_staff.height },
  sword: { url: "assets/fx/sword.png", width: fx_sword.width, height: fx_sword.height },
  swordUlt: { url: "assets/fx/swordUlt.png", width: fx_swordUlt.width, height: fx_swordUlt.height },
  twinBlades: { url: "assets/fx/twinBlades.png", width: fx_twinBlades.width, height: fx_twinBlades.height },
  wand: { url: "assets/fx/wand.png", width: fx_wand.width, height: fx_wand.height },
  whip: { url: "assets/fx/whip.png", width: fx_whip.width, height: fx_whip.height },
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
  ...fx_axe.sheets,
  ...fx_chainSickle.sheets,
  ...fx_claws.sheets,
  ...fx_cleaver.sheets,
  ...fx_fan.sheets,
  ...fx_fists.sheets,
  ...fx_flail.sheets,
  ...fx_greatsword.sheets,
  ...fx_hammer.sheets,
  ...fx_katana.sheets,
  ...fx_ringBlades.sheets,
  ...fx_scythe.sheets,
  ...fx_shield.sheets,
  ...fx_sidearm.sheets,
  ...fx_spear.sheets,
  ...fx_staff.sheets,
  ...fx_sword.sheets,
  ...fx_swordUlt.sheets,
  ...fx_twinBlades.sheets,
  ...fx_wand.sheets,
  ...fx_whip.sheets,
} satisfies Record<string, FxSheetDef>;

export type FxSheetKey = keyof typeof FX_SHEETS;

/** アトラスごとの武器種のモーションの表（検査と型付けは render/fxMotions.ts） */
export const FX_MOVESET_RAW = [fx_axe.fx, fx_chainSickle.fx, fx_claws.fx, fx_cleaver.fx, fx_fan.fx, fx_fists.fx, fx_flail.fx, fx_greatsword.fx, fx_hammer.fx, fx_katana.fx, fx_ringBlades.fx, fx_scythe.fx, fx_shield.fx, fx_sidearm.fx, fx_spear.fx, fx_staff.fx, fx_sword.fx, fx_swordUlt.fx, fx_twinBlades.fx, fx_wand.fx, fx_whip.fx] as const;
