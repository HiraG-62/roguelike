import { ENEMIES } from "../data/enemies";
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

/**
 * 再配色: パレット文字を差し替えた新しいフレーム列を作る。
 * 描画時の合成ではなく文字の置き換えにしておくと、絵の読み分けを純関数のテストで確かめられる
 */
export function recolorFrames(frames: SpriteFrames, swap: Readonly<Record<string, string>>): SpriteFrames {
  return frames.map((frame) => frame.map((row) => [...row].map((ch) => swap[ch] ?? ch).join("")));
}

/** アトラスに載せる全フレーム: SPRITES に、敵定義の再配色種（EnemyDef.recolor）を足したもの */
export function spriteSources(): Record<string, SpriteFrames> {
  const out: Record<string, SpriteFrames> = { ...SPRITES };
  for (const def of ENEMIES) {
    const recolor = def.recolor;
    if (!recolor) continue;
    const base = SPRITES[recolor.base];
    if (!base) throw new Error(`unknown recolor base: ${recolor.base}`);
    out[def.sprite] = recolorFrames(base, recolor.swap);
  }
  return out;
}

/** 起動時に一度だけ全スプライトをオフスクリーンへ描いておく */
export function buildAtlas(): SpriteAtlas {
  const atlas: SpriteAtlas = {};
  for (const [key, frames] of Object.entries(spriteSources())) {
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

/** 元の色味を残したまま color を strength (0..1) の割合で乗せたフレームを作る */
function tintFrames(sprite: Sprite, color: string, strength: number): HTMLCanvasElement[] {
  return sprite.frames.map((src) => {
    const canvas = document.createElement("canvas");
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = strength;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, src.width, src.height);
    return canvas;
  });
}

/** 色付きフレームを遅延生成してキャッシュする（毎フレームの合成を避ける） */
export class TintCache {
  private readonly cache = new Map<string, HTMLCanvasElement[]>();

  get(sprite: Sprite, spriteKey: string, color: string, strength = 1): HTMLCanvasElement[] {
    const key = `${spriteKey}|${color}|${strength}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const frames = tintFrames(sprite, color, strength);
    this.cache.set(key, frames);
    return frames;
  }
}
