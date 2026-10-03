/**
 * スプライトの密度: 論理 1px あたりのドット数。
 * 描画は論理 480x270 を RENDER_SCALE（4）倍のバックバッファに描くので、
 * 1 = 1 ドット 4 画面px（従来の絵）、2 = 1 ドット 2 画面px（これから描く絵の基準）、4 = 1 ドット 1 画面px。
 * 論理 24px の敵を密度 2 で描くなら 48x48 のフレームになる
 */
import { POSE_SUFFIXES } from "./frameKit";

export type SpriteDots = 1 | 2 | 4;

/** 既定の密度（従来の絵） */
export const DEFAULT_SPRITE_DOTS: SpriteDots = 1;

/**
 * 密度 1 以外のキーだけ載せる。ポーズ（`<key>.windup` / `<key>.strike`）は元のキーの値を継ぐので載せなくてよい。
 * 再配色種は描画側で元のキーの値を継ぐ
 */
export const SPRITE_DOTS: Readonly<Record<string, SpriteDots>> = {
  // 経済の絵（sprites/economy.ts）
  "pickup.coin.small": 2,
  "pickup.coin.mid": 2,
  "pickup.coin.big": 2,
  "pickup.key": 2,
  "pickup.flask": 2,
  "pickup.flaskEmpty": 2,
  "hud.flask": 2,
  "prop.lockedChest": 2,
  "prop.donation": 2,
  pot: 2,
  crate: 2,
  merchant: 2,
  merchantChapter: 2,
  merchantPeddler: 2,
  merchantBlack: 2,
  // 最深の間（sprites/bosses.ts・sprites/still.ts）
  deepLord: 2,
  gatePillar: 2,
  mirrorPane: 2,
  // 武器掛けの器のカードの和紙の札（sprites/bulletIcons.ts。上に弾の飛ぶ絵を重ねる）
  "rack.paper": 2,
  // 銃の器の弾のアイコン（sprites/bulletIcons.ts。48x28 = 論理 24x14。武器掛けの器のカード）
  "bulletIcon.matchlock": 2,
  "bulletIcon.crossbow": 2,
  "bulletIcon.rifle": 2,
  "bulletIcon.tripleCrossbow": 2,
  "bulletIcon.handCannon": 2,
  "bulletIcon.railgun": 2,
  "bulletIcon.pistol": 2,
  "bulletIcon.revolver": 2,
  "bulletIcon.burstRifle": 2,
  "bulletIcon.smg": 2,
  "bulletIcon.twinPistols": 2,
  "bulletIcon.twinRevolvers": 2,
  "bulletIcon.blunderbuss": 2,
  "bulletIcon.shotgun": 2,
  "bulletIcon.throwingKnives": 2,
  "bulletIcon.blowgun": 2,
  "bulletIcon.ricochetGun": 2,
  "bulletIcon.seekerOrb": 2,
  "bulletIcon.mortar": 2,
  "bulletIcon.grenadeLauncher": 2,
  "bulletIcon.caltrops": 2,
  "bulletIcon.mineLauncher": 2,
  "bulletIcon.returnChakram": 2,
  "bulletIcon.chakram": 2,
  "bulletIcon.flyingBlade": 2,
};

/** ポーズの接尾辞を外した元のキー */
export function baseOfPose(key: string): string {
  for (const pose of POSE_SUFFIXES) {
    const suffix = `.${pose}`;
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

/** キーの密度。ポーズは元のキーに従い、表に無ければ既定 */
export function spriteDots(key: string): SpriteDots {
  return SPRITE_DOTS[key] ?? SPRITE_DOTS[baseOfPose(key)] ?? DEFAULT_SPRITE_DOTS;
}
