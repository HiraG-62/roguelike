/**
 * 攻撃エフェクト（src/render/fxAttack.ts）の形を決める純関数。
 * ばらつきは renderMath.ts の座標ハッシュ（hash01）で作り、state.rng も Math.random も使わない
 */
import { clamp01, easeOutCubic, hash01 } from "./renderMath";

export interface Point {
  x: number;
  y: number;
}

// -----------------------------------------------------------------------------
// 斬撃の軌跡（三日月）
// -----------------------------------------------------------------------------

/** 軌跡の 1 区切り。f は尾 0 → 先端 1、angle は区切りの角度、thick はその位置の厚み（px） */
export interface TrailSample {
  f: number;
  angle: number;
  thick: number;
}

/**
 * 弧の軌跡の標本。振り始め from から sweep（符号付き rad）のうち progress まで振った時点で、
 * 先端から tailRatio × |sweep| だけ後ろまでを尾として残す。厚みは先端の少し手前で最大、尾と先端で細る
 */
export function arcTrailSamples(from: number, sweep: number, progress: number, tailRatio: number, maxThick: number, count: number): TrailSample[] {
  const n = Math.max(2, Math.floor(count));
  const head = from + sweep * clamp01(progress);
  const tailSpan = Math.min(Math.abs(sweep) * clamp01(progress), Math.abs(sweep) * Math.max(0, tailRatio));
  const dir = sweep >= 0 ? 1 : -1;
  const out: TrailSample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push({ f, angle: head - dir * tailSpan * (1 - f), thick: maxThick * crescentProfile(f) });
  }
  return out;
}

/** 三日月の厚みの形 0..1（尾は 0、先端の手前 0.8 で最大、先端は少し残す） */
export function crescentProfile(f: number): number {
  const x = clamp01(f);
  const PEAK = 0.8;
  const TIP = 0.35;
  if (x <= PEAK) return Math.sin((x / PEAK) * (Math.PI / 2));
  return 1 - (1 - TIP) * ((x - PEAK) / (1 - PEAK));
}

/** 振り終わってからの尾の残り 0..1（fadeTime 秒で消える） */
export function trailFade(elapsed: number, fadeTime: number): number {
  if (fadeTime <= 0) return 0;
  return 1 - clamp01(elapsed / fadeTime);
}

// -----------------------------------------------------------------------------
// 稲妻
// -----------------------------------------------------------------------------

/**
 * 2 点を結ぶ折れ線。両端は固定し、途中の点を線に直交する向きへ seed のハッシュでずらす（中央ほど大きく）
 */
export function boltPoints(from: Point, to: Point, segments: number, jitter: number, seed: number): Point[] {
  const n = Math.max(1, Math.floor(segments));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;
  const out: Point[] = [{ x: from.x, y: from.y }];
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const off = (hash01(seed + i * 7, seed * 3 + i) * 2 - 1) * jitter * Math.sin(f * Math.PI);
    out.push({ x: from.x + dx * f + nx * off, y: from.y + dy * f + ny * off });
  }
  out.push({ x: to.x, y: to.y });
  return out;
}

/** 枝の付け根（折れ線の途中の点）と伸びる向き。本線から ±0.5〜1.1 rad に開く */
export function boltBranch(points: readonly Point[], index: number, seed: number, length: number): [Point, Point] | undefined {
  const base = points[index];
  const next = points[index + 1];
  if (!base || !next) return undefined;
  const main = Math.atan2(next.y - base.y, next.x - base.x);
  const side = hash01(seed + index, seed - index) < 0.5 ? -1 : 1;
  const open = 0.5 + hash01(seed * 5 + index, index) * 0.6;
  const a = main + side * open;
  return [base, { x: base.x + Math.cos(a) * length, y: base.y + Math.sin(a) * length }];
}

// -----------------------------------------------------------------------------
// 爆発の段階
// -----------------------------------------------------------------------------

/** 爆発の各段の強さ。u は経過 0..1。flash / fireball は 0..1 の濃さ、*R は半径に掛ける倍率 */
export interface BlastStage {
  flash: number;
  flashR: number;
  fireball: number;
  fireballR: number;
  smoke: number;
  smokeR: number;
  debris: number;
  shockR: number;
}

/** 中心の閃光 → 広がる火球 → 煙の輪 → 破片、の順に強さが移る */
export function blastStage(u: number, flashEnd: number, fireEnd: number): BlastStage {
  const x = clamp01(u);
  const fe = Math.max(0.01, flashEnd);
  const fb = Math.max(fe, fireEnd);
  const flash = x < fe ? 1 - x / fe : 0;
  const fireball = x < fb ? 1 - x / fb : 0;
  return {
    flash,
    flashR: 0.3 + 0.4 * clamp01(x / fe),
    fireball,
    fireballR: 0.35 + 0.55 * easeOutCubic(x / fb),
    smoke: x < fe ? 0 : Math.sin(((x - fe) / (1 - fe)) * Math.PI) * (1 - x * 0.3),
    smokeR: 0.7 + 0.5 * easeOutCubic(x),
    debris: 1 - x,
    shockR: easeOutCubic(Math.min(1, x * 2.5)),
  };
}

/** 放射状の i 本目の向き（等間隔にハッシュで ±半区切りまで揺らす） */
export function radialAngle(i: number, count: number, seed: number): number {
  const n = Math.max(1, count);
  return ((i + (hash01(seed + i * 13, seed ^ (i * 31)) - 0.5)) / n) * Math.PI * 2;
}

/** 減速しながら飛ぶ粒の距離（初速 speed、寿命 life、経過 age）。寿命の終わりで止まる */
export function coastDistance(speed: number, age: number, life: number): number {
  if (life <= 0) return 0;
  const x = clamp01(age / life);
  return speed * life * 0.5 * (1 - (1 - x) * (1 - x));
}

// -----------------------------------------------------------------------------
// 色
// -----------------------------------------------------------------------------

const HEX_SHORT = 4;
const HEX_LONG = 7;
const colorCache = new Map<string, string>();

/** #rgb / #rrggbb を 0..255 の 3 値に。読めなければ白 */
export function parseHex(color: string): [number, number, number] {
  if (color.length === HEX_SHORT && color.startsWith("#")) {
    const r = parseInt(color[1] ?? "f", 16);
    const g = parseInt(color[2] ?? "f", 16);
    const b = parseInt(color[3] ?? "f", 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return [255, 255, 255];
    return [r * 17, g * 17, b * 17];
  }
  if (color.length !== HEX_LONG || !color.startsWith("#")) return [255, 255, 255];
  const n = parseInt(color.slice(1), 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(v: number): string {
  return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
}

/** a と b を t（0..1）で混ぜた #rrggbb。描画で毎フレーム呼ぶので結果をキャッシュする */
export function mixColor(a: string, b: string, t: number): string {
  const q = Math.round(clamp01(t) * 8) / 8;
  const key = `${a}|${b}|${q}`;
  const hit = colorCache.get(key);
  if (hit) return hit;
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const made = `#${toHex(ar + (br - ar) * q)}${toHex(ag + (bg - ag) * q)}${toHex(ab + (bb - ab) * q)}`;
  colorCache.set(key, made);
  return made;
}
