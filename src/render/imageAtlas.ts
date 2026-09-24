import type { SheetKey, TileSpriteDef } from "../data/tiles";
import type { Sprite, SpriteAtlas } from "./sprites";

export interface ImageSheet {
  key: SheetKey;
  url: string;
}

const FLASH_COLOR = "#ffffff";

/** 失敗したら null（呼び出し側はそのシートに属する定義をすべて読み飛ばす = フォールバック） */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function sliceFrame(src: HTMLImageElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return canvas;
}

/** 被弾フラッシュ用の白抜きシルエット（sprites.ts の buildSprite と同じ意味） */
function whiteSilhouette(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = FLASH_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * すべての sheet を Image で読み、defs の矩形で切り出して SpriteAtlas を作る。
 * 読み込みに失敗した sheet はそのまま飛ばし、切り出せた分だけ返す（未ロード・失敗時は呼び出し側の
 * mergeAtlas が既存ピクセルマップへフォールバックする）
 */
export async function loadImageAtlas(defs: readonly TileSpriteDef[], sheets: readonly ImageSheet[]): Promise<SpriteAtlas> {
  const images = new Map<SheetKey, HTMLImageElement>();
  await Promise.all(
    sheets.map(async (sheet) => {
      const img = await loadImage(sheet.url);
      if (img) images.set(sheet.key, img);
    }),
  );
  const atlas: SpriteAtlas = {};
  for (const def of defs) {
    const img = images.get(def.sheet);
    if (!img) continue;
    const frameCount = Math.max(1, def.frames ?? 1);
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < frameCount; i++) frames.push(sliceFrame(img, def.x + i * def.w, def.y, def.w, def.h));
    const sprite: Sprite = { frames, white: frames.map(whiteSilhouette), w: def.w, h: def.h };
    atlas[def.key] = sprite;
  }
  return atlas;
}
