import { PALETTE, SPRITES, type SpriteFrames } from "../data/sprites";

export interface Sprite {
  frames: HTMLCanvasElement[];
  /** 被弾フラッシュ用の白抜きシルエット */
  white: HTMLCanvasElement[];
  w: number;
  h: number;
}

const FLASH_COLOR = "#ffffff";

function renderFrame(rows: readonly string[], override?: string): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const color = override ?? PALETTE[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

function buildSprite(frames: SpriteFrames): Sprite {
  const rendered = frames.map((f) => renderFrame(f));
  const white = frames.map((f) => renderFrame(f, FLASH_COLOR));
  const first = rendered[0];
  return { frames: rendered, white, w: first?.width ?? 0, h: first?.height ?? 0 };
}

export type SpriteAtlas = Record<string, Sprite>;

/** 起動時に一度だけ全スプライトをオフスクリーンへ描いておく */
export function buildAtlas(): SpriteAtlas {
  const atlas: SpriteAtlas = {};
  for (const [key, frames] of Object.entries(SPRITES)) {
    atlas[key] = buildSprite(frames);
  }
  return atlas;
}

export function getSprite(atlas: SpriteAtlas, key: string): Sprite {
  const s = atlas[key];
  if (!s) throw new Error(`unknown sprite: ${key}`);
  return s;
}

/**
 * 経過時間からフレーム番号を求める（frames 数で循環）。
 * frameTime が 0 以下なら先頭フレームに固定する。
 */
export function spriteFrame(sprite: Pick<Sprite, "frames">, time: number, frameTime: number): number {
  const count = sprite.frames.length;
  if (count <= 1 || frameTime <= 0) return 0;
  const idx = Math.floor(time / frameTime) % count;
  return idx < 0 ? idx + count : idx;
}
