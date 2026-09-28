import type { Camera } from "./state";
import type { Vec } from "./vec";

/** 内部解像度。ドット絵をそのまま整数倍で拡大する */
export const VIEW_W = 480;
export const VIEW_H = 270;

/**
 * 論理 1px = 画面 4px。描画のバックバッファ（canvas の実ピクセル）は常に
 * VIEW_W * RENDER_SCALE x VIEW_H * RENDER_SCALE（= 1920x1080）に固定する。
 * 窓の大きさは CSS の表示サイズだけを変え、canvas 自体の解像度は変えない
 */
export const RENDER_SCALE = 4;

/** 画面内部座標 → ワールド座標。描画側の translate と対になる */
export function screenToWorld(cam: Camera, screen: Vec): Vec {
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: screen.x - ox, y: screen.y - oy };
}
