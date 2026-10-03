/**
 * 魔法の武器（杖・書・手鈴）の受け流しで体の前に張る結界（docs/ideas/parry-motion.md）。武器で受ける代わりに、
 * 向いている側へ弧の帯を張り、決まった瞬間は白く光って前へ膨らみ、外すと点が抜けて崩れる。
 * 点はプレイヤーの絵と同じ密度（論理 0.5px）で打つ。ばらつきは点の番号のハッシュ（state.rng を使わない）。数値は PARRY_POSE.barrier
 */
import { PARRY_POSE } from "../data/tuning";
import { ACTOR_ART_SCALE } from "./actorSprites";
import { clamp01, hash01 } from "./renderMath";

const DEG = Math.PI / 180;
const DOT = 1 / ACTOR_ART_SCALE;
/** 縁を走る光の帯の幅（弧の長さに対する割合） */
const SHIMMER_BAND = 0.18;
/** 受け止めた強さ（0..1）がこれを越えた間は縁を白く光らせる */
const FLASH_MIN = 0.4;
const WHITE = "#ffffff";
/** 帯の層ごとの点の抜けのハッシュの種 */
const DROP_SEED = 29;

export interface BarrierLook {
  /** 結界の中心（肩の間、論理座標） */
  readonly x: number;
  readonly y: number;
  readonly facingRight: boolean;
  /** 張った割合（0..1。受けの構えへ寄せた割合） */
  readonly blend: number;
  /** 受け止めた強さ（0..1。押し返しの残り） */
  readonly jar: number;
  /** 崩れの割合（0..1。外した硬直） */
  readonly crumble: number;
  readonly color: string;
  /** 縁の光を走らせる時刻（秒） */
  readonly time: number;
}

export interface BarrierDot {
  /** 中心から（論理 px） */
  readonly x: number;
  readonly y: number;
  /** 縁（true）か帯の内側か */
  readonly edge: boolean;
  /** 縁を走る光の中 */
  readonly lit: boolean;
}

/** 結界の今の半径（受け止めた瞬間に前へ膨らむ） */
export function barrierRadius(jar: number): number {
  return PARRY_POSE.barrier.radius + PARRY_POSE.barrier.popPx * clamp01(jar);
}

/** 結界の前の真ん中（中心から、論理 px）。受け止めた火花をここから散らす */
export function barrierFront(facingRight: boolean, jar: number): { x: number; y: number } {
  return { x: barrierRadius(jar) * (facingRight ? 1 : -1), y: 0 };
}

/**
 * 結界の点（純関数。テストする）。弧を縁から内側へ depthPx の帯で打ち、崩れの割合だけ点を抜く。
 * 縁の光は time で弧の端から端へ走る
 */
export function barrierDots(facingRight: boolean, jar: number, crumble: number, time: number): BarrierDot[] {
  const b = PARRY_POSE.barrier;
  const r = barrierRadius(jar);
  const half = b.halfDeg * DEG;
  const dir = facingRight ? 0 : Math.PI;
  const steps = Math.max(1, Math.ceil((r * half * 2) / DOT));
  const layers = Math.max(1, Math.round(b.depthPx / DOT));
  const shimmer = (((time / b.shimmerSec) % 1) + 1) % 1;
  const out: BarrierDot[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = dir - half + half * 2 * u;
    const lit = Math.abs(u - shimmer) < SHIMMER_BAND / 2;
    for (let k = 0; k < layers; k++) {
      if (crumble > 0 && hash01(i + k * DROP_SEED, k) < crumble) continue;
      const rr = r - k * DOT;
      out.push({ x: Math.round((Math.cos(a) * rr) / DOT) * DOT, y: Math.round((Math.sin(a) * rr) / DOT) * DOT, edge: k === 0, lit });
    }
  }
  return out;
}

/** 結界を描く。縁は濃く、内側の帯は薄く。受け止めた瞬間は縁を白く光らせる */
export function drawParryBarrier(ctx: CanvasRenderingContext2D, look: BarrierLook): void {
  if (look.blend <= 0) return;
  const b = PARRY_POSE.barrier;
  const flash = look.jar >= FLASH_MIN;
  const alpha = clamp01(look.blend) * (1 - clamp01(look.crumble) * 0.5);
  for (const d of barrierDots(look.facingRight, look.jar, look.crumble, look.time)) {
    ctx.globalAlpha = alpha * (d.edge ? b.edgeAlpha : b.fillAlpha);
    ctx.fillStyle = d.edge && (flash || d.lit) ? WHITE : look.color;
    ctx.fillRect(look.x + d.x, look.y + d.y, DOT, DOT);
  }
  ctx.globalAlpha = 1;
}
