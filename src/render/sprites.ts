import { ENEMIES } from "../data/enemies";
import { PALETTE, SPRITES, type SpriteFrames } from "../data/sprites";
import { POSE_SUFFIXES, type PoseSuffix, poseKey } from "../data/sprites/frameKit";
import type { EnemyPhase } from "../core/state";

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
    // 予備動作・攻撃の原画も同じ差し替えで作る（元に無いポーズは歩きのまま描かれる）
    for (const pose of POSE_SUFFIXES) {
      const posed = SPRITES[poseKey(recolor.base, pose)];
      if (posed) out[poseKey(def.sprite, pose)] = recolorFrames(posed, recolor.swap);
    }
  }
  return out;
}

/** 原画を持つ敵の phase（予備動作・攻撃）。他の phase は歩きの巡回で描く */
const PHASE_POSE: Partial<Record<EnemyPhase, PoseSuffix>> = { windup: "windup", strike: "strike" };

/**
 * 敵を描くキー: 予備動作・攻撃の原画（`<key>.windup` / `<key>.strike`）があればそれを、無ければ歩きのキー。
 * 形でテレグラフを読ませるため（docs/ideas/graphics-style.md 4 章）
 */
export function enemySpriteKey(base: string, phase: EnemyPhase, has: (key: string) => boolean): string {
  const pose = PHASE_POSE[phase];
  if (!pose) return base;
  const key = poseKey(base, pose);
  return has(key) ? key : base;
}

/** 起動時に一度だけ全スプライトをオフスクリーンへ描いておく */
export function buildAtlas(): SpriteAtlas {
  const atlas: SpriteAtlas = {};
  for (const [key, frames] of Object.entries(spriteSources())) {
    atlas[key] = buildSprite(frames);
  }
  return atlas;
}

/**
 * PNG から作ったアトラスをピクセルマップのアトラスへ合流させる。
 * 同名キーは PNG 側で上書きし、無いキーは元のまま（= 未ロード・読み込み失敗時のフォールバック）
 */
export function mergeAtlas(base: SpriteAtlas, over: SpriteAtlas): SpriteAtlas {
  return { ...base, ...over };
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

  /** アトラス差し替え後に呼ぶ。古い canvas を掴んだ色付きフレームを持ち越さない */
  clear(): void {
    this.cache.clear();
  }
}
