import { DERIVED_SPRITES, SHEET_LUT, TILE_SPRITES, type Lut, type Tint } from "../data/tiles";
import { applyLut } from "./imageLut";
import type { Sprite, SpriteAtlas } from "./sprites";

/**
 * PNG から切り出したアトラスに、シートごとの再配色と派生スプライト（バイオーム版の床・壁、地形の色違い）を足す。
 * 読み込み時に 1 回だけ呼ぶ（Renderer.setAtlas）。毎フレームの合成はしない（graphics-design.md 5.4）
 */
export function expandTileAtlas(raw: SpriteAtlas): SpriteAtlas {
  const out: SpriteAtlas = { ...raw };
  for (const def of TILE_SPRITES) {
    const lut = SHEET_LUT[def.sheet];
    const sprite = out[def.key];
    if (lut && sprite) out[def.key] = recolorSprite(sprite, lut);
  }
  for (const d of DERIVED_SPRITES) {
    const from = out[d.from];
    // 元が読めなかった（シートの読み込み失敗）なら作らない = 既存ピクセルマップへフォールバック
    if (from) out[d.key] = recolorSprite(from, d.lut, d.tint);
  }
  return out;
}

/** 形は変えないので白抜き（被弾フラッシュ）は元のものを使い回す */
function recolorSprite(sprite: Sprite, lut?: Lut, tint?: Tint): Sprite {
  const frames = sprite.frames.map((f) => tintCanvas(lut ? applyLut(f, lut) : copyCanvas(f), tint));
  return { ...sprite, frames };
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext("2d")?.drawImage(src, 0, 0);
  return canvas;
}

/** source-atop で不透明な画素にだけ色を重ねる（無彩色の石を染めるため） */
function tintCanvas(canvas: HTMLCanvasElement, tint?: Tint): HTMLCanvasElement {
  if (!tint) return canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = tint.alpha;
  ctx.fillStyle = tint.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  return canvas;
}
