import type { FloatTextKind, Hazard } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOSS, ELITE, ENEMY_AI, FX_WAVE3, PLAYER } from "../data/tuning";
import { type KeystoneGroup, keystoneDef } from "../loot/affixes";
import { type Rarity, type Resonance, TRAIT_COLOR_HEX } from "../loot/types";
import type { MovesetKey } from "../data/weapons";
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

/** ダメージ文字の種類ごとの縁取り（7-19）。会心・通常は従来どおり（会心は朱、重い一撃は茶） */
const KIND_OUTLINE: Readonly<Partial<Record<FloatTextKind, string>>> = {
  weak: "#704800",
  resist: "#283040",
  reaction: "#5a4010",
  dot: "#101010",
};

/**
 * ダメージ数字の見た目。kind（combat.ts が渡す種類）があればそれで、無ければ従来どおり
 * PLAYER.critColor の色で会心を判定する（種類を持たない古い浮き文字の互換）
 */
export function damageTextStyle(text: string, color: string, scale: number, kind?: FloatTextKind): DamageTextStyle {
  const numeric = NUMERIC_TEXT.test(text);
  const crit = numeric && (kind === undefined ? color === PLAYER.critColor : kind === "crit");
  if (crit) return { numeric, crit, outline: OUTLINE_CRIT };
  const byKind = kind === undefined ? undefined : KIND_OUTLINE[kind];
  if (numeric && byKind !== undefined) return { numeric, crit, outline: byKind };
  if (numeric && scale >= HEAVY_TEXT_SCALE) return { numeric, crit, outline: OUTLINE_HEAVY };
  return { numeric, crit, outline: OUTLINE_NORMAL };
}

// -----------------------------------------------------------------------------
// 演出の第 3 弾（docs/ideas/meta-and-weapons.md 7-10 / 7-14 / 7-20）
// -----------------------------------------------------------------------------

/** カウンターの白黒の濃さ（7-10）。left は残り秒、time は全体の秒。残りに比例して薄れる */
export function counterMonoAlpha(left: number, time: number, strength: number): number {
  if (left <= 0 || time <= 0) return 0;
  return strength * clamp01(left / time);
}

/**
 * 共鳴のまといの色（7-14）。単色・二色・三和音は配合の色、陰画は支配色に冥を重ね、
 * 星座があれば星の色を足す。散り（scatter）・無しで星座も無ければ空（描かない）
 */
export function resonanceMantleColors(res: Readonly<Resonance>): string[] {
  const shown = res.kind === "dominant" || res.kind === "dual" || res.kind === "triad" ? res.colors : [];
  const out = shown.map((c) => TRAIT_COLOR_HEX[c]);
  if (res.form === "negative" && out.length > 0) out.push(TRAIT_COLOR_HEX.umbra);
  if (res.constellation !== undefined) out.push(FX_WAVE3.mantle.constellationColor);
  return out;
}

/** 誓約の系統ごとのオーラの色（7-20）。系統は src/loot/affixes.ts の KeystoneGroup（排他の単位） */
export const KEYSTONE_GROUP_COLOR: Readonly<Record<KeystoneGroup, string>> = {
  body: "#ff6a5a",
  tempo: "#ffb040",
  style: "#e8e8ff",
  mana: "#60a0ff",
  status: "#90e050",
  poise: "#c8a078",
  room: "#ffe080",
  hue: "#ff80e0",
  chronicle: "#b0a0ff",
  element: "#80f0f0",
  weapon: "#c8c8c8",
  terrain: "#b08850",
};

/** 持っている誓約の系統の色（重複を除いて持っている順）。誓約が無ければ空 */
export function keystoneAuraColors(keys: readonly string[]): string[] {
  const groups: KeystoneGroup[] = [];
  for (const key of keys) {
    const group = keystoneDef(key)?.exclusiveGroup;
    if (group !== undefined && !groups.includes(group)) groups.push(group);
  }
  return groups.map((g) => KEYSTONE_GROUP_COLOR[g]);
}

export interface AuraArc {
  start: number;
  end: number;
}

/** 輪を count 本の弧に等分し、弧の間に gap（ラジアン）の隙間を空けて time * spin だけ回す */
export function auraArcs(count: number, time: number, spin: number, gap: number): AuraArc[] {
  if (count <= 0) return [];
  const span = (Math.PI * 2) / count;
  const half = Math.min(gap, span * 0.5) / 2;
  const offset = time * spin;
  const out: AuraArc[] = [];
  for (let i = 0; i < count; i++) {
    const start = offset + i * span + half;
    out.push({ start, end: start + span - half * 2 });
  }
  return out;
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

// -----------------------------------------------------------------------------
// 演出の位置計算（src/render/effectsUi.ts・statusUi.ts が使う。描画と切り離してテストする）
// -----------------------------------------------------------------------------

/** 座標ハッシュを 0..1 にしたもの（演出のばらつき用） */
export function hash01(a: number, b: number): number {
  return tileHash(Math.floor(a), Math.floor(b)) / 4294967296;
}

/**
 * 制圧の波: 波の前線（speed × age）からの距離で床の明るさ 0..1 を返す。
 * 前線の手前 band px だけ光り、全体は寿命の終わりに消える
 */
export function clearWaveAlpha(dist: number, age: number, life: number, speed: number, band: number): number {
  if (life <= 0 || band <= 0) return 0;
  const front = speed * age;
  const behind = front - dist;
  if (behind < 0 || behind > band) return 0;
  const edge = 1 - behind / band;
  return clamp01(edge * (1 - age / life));
}

/** 両断: 経過率 t で 2 つの半身が離れる距離（最初は速く、後は止まる） */
export function severGap(t: number, gap: number): number {
  return gap * easeOutCubic(clamp01(t));
}

/** 灰になって崩れる: 残っている上端の割合（0 = 全部残る、1 = 全部崩れた）。前半は溜めて後半で崩す */
const ASH_HOLD = 0.25;
export function ashCrumble(t: number): number {
  const u = clamp01(t);
  if (u < ASH_HOLD) return 0;
  return (u - ASH_HOLD) / (1 - ASH_HOLD);
}

/** 溶ける: 縦横の伸縮（縦は潰れ、横は広がる） */
export function meltScale(t: number): { sx: number; sy: number } {
  const u = clamp01(t);
  return { sx: 1 + u * 0.7, sy: Math.max(0.05, 1 - u) };
}

/** 砕ける: 破片 i（0..count-1）の飛ぶ向きと距離 */
export function shardOffset(i: number, count: number, t: number, speed: number): { x: number; y: number } {
  const a = ((i + 0.5) / Math.max(1, count)) * Math.PI * 2;
  const d = speed * easeOutCubic(clamp01(t));
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

/** 階層到達の名札の不透明度（elapsed は到達からの秒）。遅れて現れ、保って消える */
export function floorCardAlpha(elapsed: number, c: { delay: number; fadeIn: number; hold: number; fadeOut: number }): number {
  const u = elapsed - c.delay;
  if (u <= 0) return 0;
  if (u < c.fadeIn) return u / c.fadeIn;
  if (u < c.fadeIn + c.hold) return 1;
  const out = u - c.fadeIn - c.hold;
  return clamp01(1 - out / c.fadeOut);
}

/**
 * 状態異常の疑似粒（敵に乗る 1〜2 個の点）。seed は敵 id と状態の番号、i は粒の番号。
 * 時間で周期的に動くだけなので state を持たない。rise = 昇る、fall = 垂れる、orbit = 周回、spark = 瞬く
 */
export type StatusMotion = "rise" | "fall" | "orbit" | "spark" | "bubble" | "stars";
const STATUS_PARTICLE_PERIOD = 0.8;

export function statusParticle(
  motion: StatusMotion,
  seed: number,
  i: number,
  time: number,
  halfW: number,
  height: number,
): { x: number; y: number; alpha: number } {
  const jitter = hash01(seed, i);
  const phase = (time / STATUS_PARTICLE_PERIOD + jitter) % 1;
  const x0 = (hash01(seed + 7, i + 3) * 2 - 1) * halfW;
  switch (motion) {
    case "rise":
      return { x: x0, y: -phase * height, alpha: 1 - phase };
    case "fall":
      return { x: x0, y: -height * 0.5 + phase * height * 0.5, alpha: 1 - phase };
    case "bubble":
      return { x: x0 * 0.8, y: -height * 0.3 - phase * height * 0.5, alpha: phase < 0.85 ? 1 : 0 };
    case "orbit":
    case "stars": {
      const a = (time * 3 + (i / 2) * Math.PI * 2 + jitter) % (Math.PI * 2);
      const r = motion === "stars" ? halfW * 0.8 : halfW;
      return { x: Math.cos(a) * r, y: -height - 2 + Math.sin(a) * r * 0.35, alpha: 1 };
    }
    case "spark":
      return { x: x0, y: -hash01(seed + 13, i + Math.floor(time * 12)) * height, alpha: phase < 0.3 ? 1 : 0 };
  }
}

/** 光条の角度（count 本を等間隔に、時間でゆっくり回す） */
export function rayAngles(count: number, time: number, speed: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => (i / Math.max(1, count)) * Math.PI * 2 + time * speed);
}

/** 武器種ごとの振りの軌跡の太さ（論理 px）。重い武器ほど太い */
export const WEAPON_TRAIL_WIDTH: Readonly<Record<MovesetKey, number>> = {
  sword: 2,
  greatsword: 4,
  twinBlades: 1,
  spear: 1,
  scythe: 3,
  fists: 2,
  whip: 1,
  cleaver: 3,
  staff: 2,
  wand: 1,
};
