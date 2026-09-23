import type { Hazard } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOSS, ELITE, ENEMY_AI, PLAYER } from "../data/tuning";
import type { Rarity } from "../loot/types";
import { type GameMap, Tile, getTile } from "../map/grid";

/** 座標ハッシュ（描画のばらつき用。ゲーム rng は消費しない） */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export function floorVariant(x: number, y: number, count: number): number {
  if (count <= 1) return 0;
  return tileHash(x, y) % count;
}

export type WallStyle = "face" | "top" | "none";

/** 下が床なら手前面、周囲に床があれば天面、完全に埋まっていれば描かない */
export function wallStyle(map: GameMap, x: number, y: number): WallStyle {
  if (getTile(map, x, y + 1) !== Tile.Wall) return "face";
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (getTile(map, x + dx, y + dy) !== Tile.Wall) return "top";
    }
  }
  return "none";
}

/** sin で min..max を往復する */
export function pulse(time: number, speed: number, min: number, max: number): number {
  return min + (max - min) * (0.5 + 0.5 * Math.sin(time * speed));
}

export interface TooltipFit {
  lineH: number;
  small: boolean;
  /** 実際に描く行数 */
  shown: number;
  height: number;
}

/**
 * ツールチップを行数に合わせて伸ばす。maxLines を超えるか高さが足りなければ小さい行高に切り替える。
 */
export function fitTooltip(
  lineCount: number,
  lineH: number,
  smallLineH: number,
  maxLines: number,
  maxHeight: number,
  pad: number,
): TooltipFit {
  const normalFits = lineCount <= maxLines && lineCount * lineH + pad <= maxHeight;
  if (normalFits) return { lineH, small: false, shown: lineCount, height: lineCount * lineH + pad };
  const capacity = Math.max(1, Math.floor((maxHeight - pad) / smallLineH));
  const shown = Math.min(lineCount, capacity);
  return { lineH: smallLineH, small: true, shown, height: shown * smallLineH + pad };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 爆弾ハザードの出どころ。hazard に種別が無いので半径と導火線の長さで見分ける */
export type BombStyle = "bomber" | "wispDeath" | "eliteDeath";

export function bombStyle(h: Pick<Hazard, "radius" | "maxTime">): BombStyle {
  const w = ENEMY_AI.wisp;
  if (h.radius === w.deathExplodeRadius && h.maxTime === w.deathExplodeFuse) return "wispDeath";
  if (h.radius === ELITE.explodeRadius && h.maxTime === ELITE.explodeFuse) return "eliteDeath";
  return "bomber";
}

/** 導火線の残り割合 (1→0) に応じて点滅間隔を slow→fast へ連続的に縮める */
export function bombBlinkFrameTime(leftRatio: number, slow: number, fast: number): number {
  const t = 1 - clamp01(leftRatio);
  return lerp(slow, fast, t * t);
}

/** 階層移動ワイプ: 閉じ始めの被覆率・閉じきる時点・開き始める時点（1 - flash に対する割合） */
const WIPE_START_COVER = 0.55;
const WIPE_CLOSED_AT = 0.2;
const WIPE_OPEN_AT = 0.4;

/**
 * 上下の黒帯の被覆率 (0 = 全開, 1 = 画面を覆う)。flash は 1 から 0 へ減衰する。
 * 前半で閉じきり、少し保ってから開く
 */
export function floorWipeCover(flash: number): number {
  const u = 1 - clamp01(flash);
  if (u < WIPE_CLOSED_AT) return lerp(WIPE_START_COVER, 1, easeOutCubic(u / WIPE_CLOSED_AT));
  if (u < WIPE_OPEN_AT) return 1;
  return 1 - easeOutCubic((u - WIPE_OPEN_AT) / (1 - WIPE_OPEN_AT));
}

/** ボス登場演出の時間配分（introTime に対する割合） */
const INTRO_BAR_IN = 0.12;
const INTRO_SLIDE_START = 0.08;
const INTRO_SLIDE_END = 0.3;
const INTRO_FADE_START = 0.8;

export interface BossIntroPhase {
  /** 黒帯の出具合 0..1 */
  bars: number;
  /** 名前のスライドイン 0..1（1 で中央） */
  slide: number;
  /** 全体の不透明度 */
  alpha: number;
}

/** remaining = introTimer（total → 0 へ減る） */
export function bossIntroPhase(remaining: number, total: number): BossIntroPhase {
  if (total <= 0 || remaining <= 0) return { bars: 0, slide: 1, alpha: 0 };
  const t = clamp01(1 - remaining / total);
  const bars = easeOutCubic(t / INTRO_BAR_IN);
  const slide = easeOutCubic((t - INTRO_SLIDE_START) / (INTRO_SLIDE_END - INTRO_SLIDE_START));
  const alpha = t < INTRO_FADE_START ? 1 : 1 - (t - INTRO_FADE_START) / (1 - INTRO_FADE_START);
  return { bars, slide, alpha: clamp01(alpha) };
}

/** 床アイテムの光柱の高さ。レアほど高い */
export const LOOT_PILLAR_HEIGHTS: Readonly<Record<Rarity, number>> = {
  normal: 14,
  magic: 22,
  rare: 32,
  unique: 44,
};

export interface DamageTextStyle {
  /** 数字ダメージか（縁取り・揺れの対象） */
  numeric: boolean;
  crit: boolean;
  /** 縁取りの色 */
  outline: string;
}

const OUTLINE_NORMAL = "#000000";
const OUTLINE_HEAVY = "#5a2a00";
const OUTLINE_CRIT = "#b03000";
/** この拡大率以上の数字は重い一撃として縁取りを変える */
const HEAVY_TEXT_SCALE = 1.3;
const NUMERIC_TEXT = /^-?\d+$/;

/** ダメージ数字の見た目。crit は combat.ts が PLAYER.critColor で出すのでそれで判定する */
export function damageTextStyle(text: string, color: string, scale: number): DamageTextStyle {
  const numeric = NUMERIC_TEXT.test(text);
  const crit = numeric && color === PLAYER.critColor;
  if (crit) return { numeric, crit, outline: OUTLINE_CRIT };
  if (numeric && scale >= HEAVY_TEXT_SCALE) return { numeric, crit, outline: OUTLINE_HEAVY };
  return { numeric, crit, outline: OUTLINE_NORMAL };
}

/** ボス HP バーのフェーズ境界（HP 割合）。無ければ null */
export function bossPhaseThreshold(behavior: string): number | null {
  if (behavior === "kingSlime") return BOSS.kingSlime.phase2Ratio;
  if (behavior === "boneLord") return BOSS.boneLord.teleportRatio;
  return null;
}

export interface ViewScale {
  /** CSS 上の整数拡大率（ドット絵を崩さない） */
  cssScale: number;
  /** 論理 1px あたりの実ピクセル数（cssScale * devicePixelRatio）。ctx.setTransform に使う */
  pixelRatio: number;
  /** canvas の実ピクセルサイズ */
  canvasW: number;
  canvasH: number;
}

/**
 * ウィンドウに収まる最大の整数倍率と、文字を高精細に描くための実ピクセルサイズ。
 * 論理座標は viewW x viewH のまま、canvas だけデバイス解像度で持つ
 */
export function computeViewScale(
  innerW: number,
  innerH: number,
  dpr: number,
  viewW: number = VIEW_W,
  viewH: number = VIEW_H,
): ViewScale {
  const cssScale = Math.max(1, Math.floor(Math.min(innerW / viewW, innerH / viewH)));
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const pixelRatio = cssScale * safeDpr;
  return {
    cssScale,
    pixelRatio,
    canvasW: Math.round(viewW * pixelRatio),
    canvasH: Math.round(viewH * pixelRatio),
  };
}
