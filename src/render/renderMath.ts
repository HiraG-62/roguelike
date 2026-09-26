import type { FloatTextKind, Hazard } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { BOSS, ELITE, ENEMY_AI, FX_WAVE3, PLAYER } from "../data/tuning";
import { type KeystoneGroup, keystoneDef } from "../loot/affixes";
import { type Rarity, type Resonance, TRAIT_COLOR_HEX } from "../loot/types";
import type { ActionStepDef, HitShape, MovesetKey } from "../data/weapons";
import {
  SLASH_SPRITE,
  SLASH_VARIANT,
  type SlashWeight,
  WEAPON_CANVAS,
  WEAPON_FRAME,
  WEAPON_GRIPS,
  type WeaponEdge,
  type WeaponFrame,
  slashFrame,
} from "../data/sprites/weapons";
import { type GameMap, TILE_SIZE, Tile, getTile } from "../map/grid";

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

export interface CrackPoint {
  x: number;
  y: number;
}

/** ひび割れの折れ線の点数（4〜6）とジグザグの幅・縦の刻み（タイル内ローカル px） */
const CRACK_MIN_POINTS = 4;
const CRACK_POINT_SPAN = 3;
const CRACK_JITTER = 7;
const CRACK_STEP_MIN = 2;
const CRACK_STEP_SPAN = 3;
const CRACK_EDGE = 1;

/**
 * 隠し部屋の扉タイル（壁）に描くひびの折れ線。タイル座標のハッシュだけで決まる純関数（state.rng を消費しない）。
 * 戻り値はタイル左上からのローカル px（0..TILE_SIZE-1）
 */
export function crackPixels(x: number, y: number): CrackPoint[] {
  const h = tileHash(x, y);
  const count = CRACK_MIN_POINTS + (h % CRACK_POINT_SPAN);
  const points: CrackPoint[] = [];
  let px = CRACK_EDGE + (h % (TILE_SIZE - CRACK_EDGE * 2));
  let py = CRACK_EDGE;
  points.push({ x: px, y: py });
  for (let i = 1; i < count; i++) {
    const hh = tileHash(x * 131 + i, y * 197 + i);
    px = Math.max(CRACK_EDGE, Math.min(TILE_SIZE - 1 - CRACK_EDGE, px + ((hh % (CRACK_JITTER * 2 + 1)) - CRACK_JITTER)));
    py = Math.min(TILE_SIZE - 1 - CRACK_EDGE, py + CRACK_STEP_MIN + (hh % CRACK_STEP_SPAN));
    points.push({ x: px, y: py });
  }
  return points;
}

/** 壁の自動接続の 4 方向ビット（N=1 / E=2 / S=4 / W=8）。「隣が床」を立てる */
export function wallMask(map: GameMap, x: number, y: number): number {
  let mask = 0;
  if (getTile(map, x, y - 1) !== Tile.Wall) mask |= 1;
  if (getTile(map, x + 1, y) !== Tile.Wall) mask |= 2;
  if (getTile(map, x, y + 1) !== Tile.Wall) mask |= 4;
  if (getTile(map, x - 1, y) !== Tile.Wall) mask |= 8;
  return mask;
}

/** 足元の描画位置を当たり半径から決める。キャンバス高が変わっても当たり判定と足元がずれない */
const FEET_PAD = 2;
export function spriteFeetY(centerY: number, bodyRadius: number): number {
  return centerY + bodyRadius + FEET_PAD;
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
  katana: 1,
  axe: 3,
  shield: 3,
  chainSickle: 1,
  hammer: 4,
  gunner: 1,
  sidearm: 1,
  longarm: 2,
  cannon: 3,
  thrown: 1,
  grenade: 3,
  trapper: 2,
  warRing: 2,
  claws: 1,
  flail: 3,
  ringBlades: 2,
  fan: 2,
};

// ---------------------------------------------------------------------------
// 手に持つ武器の姿勢と斬撃の絵（docs/ideas/combat-feel-design.md C-2 / C-3）
// ---------------------------------------------------------------------------

/** 攻撃の段階（core/state.ts の AttackPhase と同じ値） */
export type SwingPhase = "none" | "windup" | "active" | "recover";

export interface WeaponPoseInput {
  readonly phase: SwingPhase;
  /** phase の進み（0 → 1） */
  readonly t: number;
  readonly shape: HitShape["kind"];
  /** 扇の開き角（度）。扇以外は使わない */
  readonly deg: number;
  /** 攻撃方向（攻撃中）または向き（それ以外）の角度。画面座標なので右 0・下 +π/2 */
  readonly aim: number;
  /** 武器種の段。扇・箱は段ごとに振る向きを入れ替える（drawSwingTrail と同じ規則） */
  readonly step: number;
  readonly facingRight: boolean;
  /** 構えずに照準へ向けて持つ（銃の家系。primary が shot の武器種） */
  readonly aimHeld: boolean;
  /** 片刃・片頭の武器の刃の側（sprites/weapons.ts の WEAPON_EDGE）。無ければ刃の向きを選ばない */
  readonly edge?: WeaponEdge;
  /** 右レーンの構え・狙いの段を押している最中の構え（phase が none のときだけ効く） */
  readonly hold?: HoldPose;
}

/** 右レーンの構え: 受け流し（刃を立てて前に出す）/ 盾の構え（盾を前へ突き出す）/ 狙い撃ち（腕を伸ばして照準へ） */
export type HoldPose = "parry" | "guard" | "aim";

/** 右レーンの段と押している最中かから、構えの姿勢を選ぶ（構えの無い段・段が無い・押していないなら undefined） */
export function laneHoldPose(step: ActionStepDef | undefined, holding: boolean): HoldPose | undefined {
  if (!holding || step === undefined) return undefined;
  if (step.kind === "hold") return step.hold.parry ? "parry" : "guard";
  if (step.kind === "aim") return "aim";
  return undefined;
}

export interface WeaponView {
  readonly frame: WeaponFrame;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

export interface WeaponPose extends WeaponView {
  /** 武器の向き（rad） */
  readonly angle: number;
  /** 拳の位置（体の中心から、論理 px） */
  readonly dx: number;
  readonly dy: number;
  /** 上を向いている間は体の後ろに描く（肩越しに担いで見える） */
  readonly behind: boolean;
}

/** 腕の付け根（体の中心から上へ）。拳はここを中心に HAND_RADIUS の円を回る */
const WEAPON_PIVOT_Y = -4;
const HAND_RADIUS = 6;
/** 待機中の拳（右向き。左向きは x を反転）と、担いだ武器の向き（右上） */
const REST_HAND = { dx: 5, dy: -2 } as const;
const REST_ANGLE = -Math.PI / 4;
/** 予備動作でさらに引く角度（rad）。扇は背中側まで引いて頭の後ろから刃が覗くようにする */
const ARC_WINDUP_PULL = 1.2;
const BOX_WINDUP_PULL = 0.25;
/** 箱（振り下ろし）: 振りかぶる角度と振り抜いた先の角度（攻撃方向から、rad） */
const BOX_RAISE = 1.9;
const BOX_FOLLOW = 0.6;
/** 扇の半角の上限（背中側まで回すと体に隠れて読めない） */
const ARC_HALF_MAX = (150 * Math.PI) / 180;
/** 突き: 予備動作で引く距離と、突き出す距離（px） */
const THRUST_PULL = 4;
const THRUST_REACH = 4;
/** 円: 予備動作で逆へ溜める角度 */
const CIRCLE_PULL = 0.5;
/** これより上を向いたら体の後ろ（sin の値。22 度ほど） */
const BEHIND_SIN = -0.38;
const OCTANT = Math.PI / 4;
const FULL_TURN = Math.PI * 2;

/** 8 方向 → 絵（横・斜め・縦）と反転。0 = 右、時計回り（画面座標） */
const VIEW_RIGHT: WeaponView = { frame: WEAPON_FRAME.side, flipX: false, flipY: false };
const OCTANT_VIEW: readonly WeaponView[] = [
  VIEW_RIGHT,
  { frame: WEAPON_FRAME.diagonal, flipX: false, flipY: true },
  { frame: WEAPON_FRAME.up, flipX: false, flipY: true },
  { frame: WEAPON_FRAME.diagonal, flipX: true, flipY: true },
  { frame: WEAPON_FRAME.side, flipX: true, flipY: false },
  { frame: WEAPON_FRAME.diagonal, flipX: true, flipY: false },
  { frame: WEAPON_FRAME.up, flipX: false, flipY: false },
  { frame: WEAPON_FRAME.diagonal, flipX: false, flipY: false },
];

/** 角度に一番近い 8 方向の絵。武器は回転で描かず、3 枚の絵と反転で向きを作る */
export function weaponView(angle: number): WeaponView {
  const octant = ((Math.round(angle / OCTANT) % 8) + 8) % 8;
  return OCTANT_VIEW[octant] ?? VIEW_RIGHT;
}

/** 段ごとの振る向き（偶数段 +1 / 奇数段 -1） */
export function swingSign(step: number): number {
  return step % 2 === 0 ? 1 : -1;
}

/** 攻撃中の武器の向き（rad）と、拳を腕の付け根から離す距離 */
function swingAngle(input: WeaponPoseInput): { angle: number; reach: number } {
  const { phase, shape, aim } = input;
  const t = clamp01(input.t);
  const sign = swingSign(input.step);
  const ease = easeOutCubic(t);
  switch (shape) {
    case "arc": {
      const half = Math.min(ARC_HALF_MAX, (input.deg * Math.PI) / 360);
      if (phase === "windup") return { angle: aim - sign * (half + ARC_WINDUP_PULL * t), reach: HAND_RADIUS };
      if (phase === "active") return { angle: aim - sign * half + sign * 2 * half * ease, reach: HAND_RADIUS };
      return { angle: aim + sign * half, reach: HAND_RADIUS };
    }
    case "box": {
      const from = aim - sign * BOX_RAISE;
      const to = aim + sign * BOX_FOLLOW;
      if (phase === "windup") return { angle: from - sign * BOX_WINDUP_PULL * t, reach: HAND_RADIUS };
      if (phase === "active") return { angle: lerp(from, to, ease), reach: HAND_RADIUS };
      return { angle: to, reach: HAND_RADIUS };
    }
    case "thrust": {
      if (phase === "windup") return { angle: aim, reach: HAND_RADIUS - THRUST_PULL * t };
      if (phase === "active") return { angle: aim, reach: lerp(HAND_RADIUS - THRUST_PULL, HAND_RADIUS + THRUST_REACH, ease) };
      return { angle: aim, reach: lerp(HAND_RADIUS + THRUST_REACH, HAND_RADIUS, t) };
    }
    case "circle": {
      if (phase === "windup") return { angle: aim - sign * CIRCLE_PULL * t, reach: HAND_RADIUS };
      if (phase === "active") return { angle: aim + sign * FULL_TURN * ease, reach: HAND_RADIUS };
      return { angle: aim, reach: HAND_RADIUS };
    }
  }
}

/**
 * 手に持つ武器の向き・拳の位置・使う絵。待機は右上へ担ぎ（左向きは左上）、撃つ武器は照準へ向ける。
 * 予備動作は攻撃方向の逆へ引き、振りは形ごとに動かす（扇: 端から端へ / 箱: 振りかぶって振り下ろす /
 * 突き: 引いて前へ伸ばす / 円: 一周）。戻しは振り抜いた先で止める
 */
export function weaponPose(input: WeaponPoseInput): WeaponPose {
  const pose = basePose(input);
  if (!input.edge) return pose;
  return { ...pose, ...edgeView(pose, input.edge, edgeWant(input, pose)) };
}

function basePose(input: WeaponPoseInput): WeaponPose {
  if (input.phase === "none") {
    if (input.hold) return holdPose(input);
    if (input.aimHeld) return poseAt(input.aim, HAND_RADIUS);
    const side = input.facingRight ? 1 : -1;
    const angle = input.facingRight ? REST_ANGLE : Math.PI - REST_ANGLE;
    return { ...weaponView(angle), angle, dx: REST_HAND.dx * side, dy: REST_HAND.dy, behind: Math.sin(angle) < BEHIND_SIN };
  }
  const { angle, reach } = swingAngle(input);
  return poseAt(angle, reach);
}

/** 構えで拳を前へ出す距離（px）。盾と狙い撃ちは腕を伸ばして見せる */
const GUARD_PUSH = 2;
const AIM_PUSH = 2;
const QUARTER_TURN = Math.PI / 2;

/**
 * 右レーンの構え。受け流しは照準の先に拳を出して刃を上へ立て（剣を横に寝かせた受けの形）、
 * 盾は照準へ突き出し、狙い撃ちは照準へ腕を伸ばす
 */
function holdPose(input: WeaponPoseInput): WeaponPose {
  const { aim } = input;
  switch (input.hold) {
    case "parry": {
      // 照準に直交する 2 向きのうち上を向く方（真上・真下を狙うときは向いている側）
      const a = aim - QUARTER_TURN;
      const b = aim + QUARTER_TURN;
      const tie = Math.abs(Math.sin(a) - Math.sin(b)) < 1e-6;
      const up = tie ? ((Math.cos(a) >= 0) === input.facingRight ? a : b) : Math.sin(a) < Math.sin(b) ? a : b;
      return { ...poseAt(aim, HAND_RADIUS), ...weaponView(up), angle: up };
    }
    case "guard":
      return poseAt(aim, HAND_RADIUS + GUARD_PUSH);
    default:
      return poseAt(aim, HAND_RADIUS + AIM_PUSH);
  }
}

/** 拳から見た頭の位置（体の中心から、論理 px）。構えの刃はこの反対側へ向ける */
const HEAD_Y = -9;

/**
 * 刃が向いてほしい向き（docs/ideas/weapon-redesign.md 7 章）。
 * 扇・箱・円の振り（予備動作と戻しも含む）は振り抜く向き（角速度の向き）、それ以外（構え・突き）は頭と反対側
 */
function edgeWant(input: WeaponPoseInput, pose: WeaponPose): { x: number; y: number } {
  const swinging = input.phase !== "none" && input.shape !== "thrust";
  if (swinging) {
    const sign = swingSign(input.step);
    return { x: -Math.sin(pose.angle) * sign, y: Math.cos(pose.angle) * sign };
  }
  return { x: pose.dx, y: pose.dy - HEAD_Y };
}

/** 絵のままの刃の法線（横の絵で刃が up のとき）。横 = 上、縦 = 左、斜め = 左上、斜め（刃が右下）= 右下 */
const EDGE_NORMAL: Readonly<Record<WeaponFrame, { readonly x: number; readonly y: number }>> = {
  [WEAPON_FRAME.side]: { x: 0, y: -1 },
  [WEAPON_FRAME.diagonal]: { x: -1, y: -1 },
  [WEAPON_FRAME.up]: { x: -1, y: 0 },
  [WEAPON_FRAME.diagonalOut]: { x: 1, y: 1 },
};

/** 今の絵と反転での刃の法線 */
export function edgeNormal(view: WeaponView, edge: WeaponEdge): { x: number; y: number } {
  const n = EDGE_NORMAL[view.frame];
  const s = edge === "down" ? -1 : 1;
  return { x: n.x * (view.flipX ? -1 : 1) * s, y: n.y * (view.flipY ? -1 : 1) * s };
}

/**
 * 刃が want と反対を向いていれば、柄の向きを保ったまま刃の側だけ入れ替えた絵にする。
 * 横は上下反転、縦は左右反転、斜めは柄の線で写した絵（diagonalOut）と差し替える
 */
export function edgeView(view: WeaponView, edge: WeaponEdge, want: { x: number; y: number }): WeaponView {
  const n = edgeNormal(view, edge);
  if (n.x * want.x + n.y * want.y >= 0) return view;
  switch (view.frame) {
    case WEAPON_FRAME.side:
      return { ...view, flipY: !view.flipY };
    case WEAPON_FRAME.up:
      return { ...view, flipX: !view.flipX };
    case WEAPON_FRAME.diagonal:
      return { ...view, frame: WEAPON_FRAME.diagonalOut };
    case WEAPON_FRAME.diagonalOut:
      return { ...view, frame: WEAPON_FRAME.diagonal };
  }
}

/** 拳が腕の付け根から離れている距離を、待機の距離（HAND_RADIUS）との比で（突きの引き・伸びで 1 から動く） */
export function poseReachRatio(pose: Pick<WeaponPose, "dx" | "dy">): number {
  return Math.hypot(pose.dx, pose.dy - WEAPON_PIVOT_Y) / HAND_RADIUS;
}

function poseAt(angle: number, reach: number): WeaponPose {
  return {
    ...weaponView(angle),
    angle,
    dx: Math.cos(angle) * reach,
    dy: WEAPON_PIVOT_Y + Math.sin(angle) * reach,
    behind: Math.sin(angle) < BEHIND_SIN,
  };
}

/** 反転を考えた拳の中心（絵の左上からの px）。描画側は手の位置からこれを引いた所に絵を置く */
export function weaponGrip(view: WeaponView): { x: number; y: number } {
  const grip = WEAPON_GRIPS[view.frame];
  return {
    x: view.flipX ? WEAPON_CANVAS - grip.x : grip.x,
    y: view.flipY ? WEAPON_CANVAS - grip.y : grip.y,
  };
}

/** 二丁拳銃のもう 1 挺: 照準に直交する向きへ spread px ずらす（side = 1 / -1） */
export function offhandOffset(angle: number, spread: number, side: number): { x: number; y: number } {
  return { x: -Math.sin(angle) * spread * side, y: Math.cos(angle) * spread * side };
}

/** 斬撃の太さの段（0 細 / 1 中 / 2 太）。振りの軌跡の太さ（WEAPON_TRAIL_WIDTH）から決める */
export function slashWeight(trailWidth: number): SlashWeight {
  if (trailWidth <= 1) return 0;
  if (trailWidth === 2) return 1;
  return 2;
}

/** 扇の開き角がこれを超えたら広い弧の絵 */
const WIDE_ARC_DEG = 170;

export interface SlashVisual {
  readonly key: string;
  readonly frame: number;
  /** 奇数段は上下を反転（振る向きの入れ替えと揃える） */
  readonly flipY: boolean;
}

/**
 * 斬撃の絵: 形でキー（箱・扇・広い扇・突き・円）、太さの段と絵の種類でフレームを選ぶ。
 * 最終段（または重い振り）は専用の絵、それ以外は 2 段ごとに A / B を替え、段の偶奇で上下を返す。
 * 5 段の武器でも A+ / A- / B+ / B- / 最終 と段ごとに絵が変わる
 */
export function slashVisual(shape: HitShape["kind"], deg: number, step: number, finisher: boolean, weight: SlashWeight): SlashVisual {
  const key =
    shape === "arc" ? (deg > WIDE_ARC_DEG ? SLASH_SPRITE.arcWide : SLASH_SPRITE.arc) : shape === "circle" ? SLASH_SPRITE.ring : SLASH_SPRITE[shape];
  const variant = finisher ? SLASH_VARIANT.finisher : Math.floor(step / 2) % 2 === 0 ? SLASH_VARIANT.a : SLASH_VARIANT.b;
  return { key, frame: slashFrame(weight, variant), flipY: step % 2 === 1 };
}

/** 段階の進み（0 → 1）。timer は段階の残り秒（system/player.ts が段の長さから数え下げる） */
export function phaseProgress(phase: SwingPhase, timer: number, step: { readonly windup: number; readonly active: number; readonly recover: number }): number {
  const total = phase === "windup" ? step.windup : phase === "active" ? step.active : phase === "recover" ? step.recover : 0;
  if (total <= 0) return 1;
  return clamp01(1 - timer / total);
}

/** 体の絵の選び方: 予備動作と溜めは構え、振りと戻しの前半は振り抜き、それ以外は歩き（C-4） */
export type PlayerBodyPose = "walk" | "windup" | "strike";
/** 戻しのこの割合までは振り抜いた姿勢のまま（振りの余韻を残す） */
const STRIKE_HOLD = 0.5;

export function playerBodyPose(phase: SwingPhase, t: number, charging: boolean): PlayerBodyPose {
  if (charging || phase === "windup") return "windup";
  if (phase === "active") return "strike";
  if (phase === "recover" && t < STRIKE_HOLD) return "strike";
  return "walk";
}

// ---------------------------------------------------------------------------
// 画面下の HUD の配置（右下の列: 祝福の列 → 芽の知らせ → スキル枠 → 変身の行 → 連鎖。下中央: コンボ）
// ---------------------------------------------------------------------------

/** 画面上の矩形（論理 px） */
export interface HudRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** スキル枠の寸法（skillHud.ts が描き、配置の計算もこれで行う） */
export const SKILL_SLOT = {
  size: 16,
  gap: 4,
  /** 枠の右に出す刻印符のドット（隙間 1 + ドット 2） */
  sideDots: 3,
  /** 枠の上の溜めバー（高さ 2 + 隙間 1） */
  gaugeH: 3,
  /** 枠の下のキー番号の行の最小の高さ */
  keyLabelMinH: 9,
  /** キー番号の基準線から行の下端まで（文字の下がり） */
  keyDescent: 2,
} as const;

/** 右下の列の右端の余白（祝福の列・芽の知らせと揃える） */
const HUD_EDGE_RIGHT = 4;
/** 右下の列の段と段の隙間 */
const HUD_STACK_GAP = 3;
/** 芽の知らせのアイコン（budUi.ts）の高さ。出ていないときも場所を空けて、スキル枠が上下に動かないようにする */
const BUD_ICON_H = 11;
/** 変身の行の基準線とスキル枠（溜めバー込み）の隙間 */
const FORM_BASELINE_GAP = 2;
/** 文字の行が基準線より下に出る分 */
const TEXT_DESCENT = 2;
/** コンボ HUD の最下行（案内）の基準線の、画面下端からの距離。その下は画面下中央のラン情報（runUi.ts）が使う */
const COMBO_BOTTOM_FROM_EDGE = 46;
/** コンボ HUD は 3 行（武器名・段・案内） */
const COMBO_LINES = 3;
/** 行の最小の高さ（倍率が小さくても詰まり過ぎない） */
const HUD_LINE_MIN = 10;

export interface HudLayout {
  /** スキル枠の列全体（溜めバー・刻印符のドット・キー番号を含む） */
  readonly skills: HudRect;
  /** 1 つ目の枠の左上 */
  readonly slotLeft: number;
  readonly slotTop: number;
  /** キー番号の基準線 */
  readonly keyBaseline: number;
  /** 芽の知らせのアイコンに空けておく段（描くのは budUi.ts） */
  readonly bud: HudRect;
  /** 変身の行（右寄せ。幅はスキル枠の列と同じに切り詰める） */
  readonly form: HudRect;
  readonly formBaseline: number;
  /** 連鎖の表示の最下行の基準線（ここから上へ積む） */
  readonly chainBottom: number;
  /** コンボ HUD（下中央、3 行）。幅はスキル枠の列に掛からない範囲 */
  readonly combo: HudRect;
  readonly comboBottom: number;
}

/**
 * 画面下の HUD の配置。boonTop は祝福アイコン列の上端（boonUi.ts の boonHudTop）、lineH は小さい文字の行高。
 * 右下の列は下から 祝福 → 芽 → スキル枠 → 変身の行 → 連鎖 の順に積み、コンボは下中央でスキル枠の左に収める
 */
export function hudLayout(boonTop: number, lineH: number, slotCount: number): HudLayout {
  const line = Math.max(HUD_LINE_MIN, lineH);
  const slotsW = slotCount * SKILL_SLOT.size + Math.max(0, slotCount - 1) * SKILL_SLOT.gap + SKILL_SLOT.sideDots;
  const bud: HudRect = { x: VIEW_W - HUD_EDGE_RIGHT - slotsW, y: boonTop - HUD_STACK_GAP - BUD_ICON_H, w: slotsW, h: BUD_ICON_H };
  const labelH = Math.max(SKILL_SLOT.keyLabelMinH, line);
  const skillsBottom = bud.y - HUD_STACK_GAP;
  const slotTop = skillsBottom - labelH - SKILL_SLOT.size;
  const skillsTop = slotTop - SKILL_SLOT.gaugeH;
  const skills: HudRect = { x: VIEW_W - HUD_EDGE_RIGHT - slotsW, y: skillsTop, w: slotsW, h: skillsBottom - skillsTop };
  const formBaseline = skillsTop - FORM_BASELINE_GAP;
  const form: HudRect = { x: skills.x, y: formBaseline + TEXT_DESCENT - line, w: skills.w, h: line };
  const comboBottom = VIEW_H - COMBO_BOTTOM_FROM_EDGE;
  const comboTop = comboBottom + TEXT_DESCENT - line * COMBO_LINES;
  const comboHalf = skills.x - HUD_STACK_GAP - VIEW_W / 2;
  const combo: HudRect = { x: VIEW_W / 2 - comboHalf, y: comboTop, w: comboHalf * 2, h: comboBottom + TEXT_DESCENT - comboTop };
  const chainBottom = Math.min(form.y, combo.y) - HUD_STACK_GAP - TEXT_DESCENT;
  return {
    skills,
    slotLeft: skills.x,
    slotTop,
    keyBaseline: skillsBottom - SKILL_SLOT.keyDescent,
    bud,
    form,
    formBaseline,
    chainBottom,
    combo,
    comboBottom,
  };
}

/** 2 つの矩形が重なるか（辺が接するだけなら重ならない） */
export function rectsOverlap(a: HudRect, b: HudRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
