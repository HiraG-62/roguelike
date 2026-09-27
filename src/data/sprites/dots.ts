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
export const SPRITE_DOTS: Readonly<Record<string, SpriteDots>> = {};

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
