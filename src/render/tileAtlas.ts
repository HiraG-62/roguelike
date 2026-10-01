import { type Lut, SHEET_LUT, TILE_SPRITES } from "../data/tiles";
import { applyLut } from "./imageLut";
import type { Sprite, SpriteAtlas } from "./sprites";

/**
 * PNG から切り出したアトラスに、シートごとの再配色を足す。
 * 読み込み時に 1 回だけ呼ぶ（Renderer.setAtlas）。毎フレームの合成はしない（graphics-design.md 5.4）
 */
export function expandTileAtlas(raw: SpriteAtlas): SpriteAtlas {
  const out: SpriteAtlas = { ...raw };
  for (const def of TILE_SPRITES) {
    const lut = SHEET_LUT[def.sheet];
    const sprite = out[def.key];
    if (lut && sprite) out[def.key] = recolorSprite(sprite, lut);
  }
  return out;
}

/** 形は変えないので白抜き（被弾フラッシュ）は元のものを使い回す */
function recolorSprite(sprite: Sprite, lut: Lut): Sprite {
  const frames = sprite.frames.map((f) => applyLut(f, lut));
  return { ...sprite, frames };
}
