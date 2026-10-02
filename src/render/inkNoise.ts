import { dotHash } from "./inkSurface";

/**
 * 墨の予告の雑音（面のむら・掠れの筋のうねり）。ワールドのドットで引く周期つきの値ノイズを、1 度だけ表に焼いて使い回す
 * （1 ドットごとに 4 回のハッシュと補間を毎フレーム回すと、大きな輪の塗りで重い）。周期は大きな輪より広く取り、繰り返しが目に付かない
 */

/** 表の一辺（ドット。論理 256px）。2 の冪で、格子の大きさで割り切れること */
export const NOISE_PERIOD = 512;
const NOISE_MASK = NOISE_PERIOD - 1;
const BYTE = 255;

const tiles = new Map<string, Uint8Array>();

function smooth(f: number): number {
  return f * f * (3 - 2 * f);
}

/**
 * 格子 cell（ドット）・種 seed の値ノイズの表（0..255。ワールドのドット x, y は x & 511 / y & 511 で引く）。
 * 格子の値を先に作って補間するだけなので、焼くのは数 ms
 */
export function noiseTile(cell: number, seed: number): Uint8Array {
  const key = `${cell}|${seed}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const n = NOISE_PERIOD / cell;
  const lattice = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) lattice[j * n + i] = dotHash(i, j, seed);
  const weight = new Float32Array(cell);
  for (let f = 0; f < cell; f++) weight[f] = smooth(f / cell);
  const out = new Uint8Array(NOISE_PERIOD * NOISE_PERIOD);
  for (let y = 0; y < NOISE_PERIOD; y++) {
    const j0 = Math.floor(y / cell);
    const j1 = (j0 + 1) % n;
    const sy = weight[y % cell] ?? 0;
    for (let x = 0; x < NOISE_PERIOD; x++) {
      const i0 = Math.floor(x / cell);
      const i1 = (i0 + 1) % n;
      const sx = weight[x % cell] ?? 0;
      const a = lattice[j0 * n + i0] ?? 0;
      const b = lattice[j0 * n + i1] ?? 0;
      const c = lattice[j1 * n + i0] ?? 0;
      const d = lattice[j1 * n + i1] ?? 0;
      const top = a + (b - a) * sx;
      const bottom = c + (d - c) * sx;
      out[y * NOISE_PERIOD + x] = Math.round((top + (bottom - top) * sy) * BYTE);
    }
  }
  tiles.set(key, out);
  return out;
}

/** 表を引く（0..1）。ワールドのドット座標 */
export function noiseAt(tile: Uint8Array, wx: number, wy: number): number {
  return (tile[(wy & NOISE_MASK) * NOISE_PERIOD + (wx & NOISE_MASK)] ?? 0) / BYTE;
}

/** 表の添字（ホットな所で noiseAt の割り算を避ける） */
export function noiseIndex(wx: number, wy: number): number {
  return (wy & NOISE_MASK) * NOISE_PERIOD + (wx & NOISE_MASK);
}
