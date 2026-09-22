export interface Vec {
  x: number;
  y: number;
}

export const ZERO: Readonly<Vec> = { x: 0, y: 0 };

export function vec(x: number, y: number): Vec {
  return { x, y };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, s: number): Vec {
  return { x: a.x * s, y: a.y * s };
}

export function length(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** ゼロベクトルは fallback を返す */
export function normalize(a: Vec, fallback: Vec = { x: 1, y: 0 }): Vec {
  const len = length(a);
  if (len === 0) return { ...fallback };
  return { x: a.x / len, y: a.y / len };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isZero(a: Vec): boolean {
  return a.x === 0 && a.y === 0;
}

export function fromAngle(rad: number): Vec {
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

export function angle(a: Vec): number {
  return Math.atan2(a.y, a.x);
}
