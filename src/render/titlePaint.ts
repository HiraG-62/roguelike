/**
 * タイトル画面の絵を描く小さな道具（render/titleScene.ts と render/titleLogo.ts が使う）。
 * ばらつきは座標ハッシュだけ（state.rng・Math.random は使わない）。論理座標（ctx は RENDER_SCALE 倍の transform 済み）で描く。
 */

const HASH_MUL_A = 0x27d4eb2d;
const HASH_MUL_B = 0x165667b1;
const HASH_MUL_C = 0x85ebca6b;
const HASH_MUL_D = 0xc2b2ae35;
const HASH_SALT_OFFSET = 7;
const HASH_DENOM = 4294967296;

/** 座標と種から決まる 0..1 の値 */
export function hh(x: number, y: number, seed: number): number {
  let h = Math.imul((x | 0) ^ Math.imul(y | 0, HASH_MUL_A) ^ Math.imul((seed | 0) + HASH_SALT_OFFSET, HASH_MUL_B), HASH_MUL_C);
  h ^= h >>> 13;
  h = Math.imul(h, HASH_MUL_D);
  h ^= h >>> 16;
  return (h >>> 0) / HASH_DENOM;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function rgbOf(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

const MIX_CACHE_LIMIT = 5000;
const mixCache = new Map<string, string>();

/** 2 色の混ぜ（t = 0 で a、1 で b）。色は "#rrggbb" */
export function mix(a: string, b: string, t: number): string {
  const key = `${a}${b}${t.toFixed(3)}`;
  const hit = mixCache.get(key);
  if (hit) return hit;
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  const out = `#${ca.map((x, i) => Math.round(x + ((cb[i] ?? 0) - x) * t).toString(16).padStart(2, "0")).join("")}`;
  if (mixCache.size > MIX_CACHE_LIMIT) mixCache.clear();
  mixCache.set(key, out);
  return out;
}

/** 段のある光の輪の相対半径と濃さ（ディザを使わず 4 段の輪を重ねる） */
const GLOW_BANDS = [1, 0.72, 0.5, 0.3] as const;
const GLOW_BASE_ALPHA = 0.09;
const GLOW_STEP_ALPHA = 0.06;
const DISC_EDGE_SOFTEN = 0.6;

/** 論理 1px 単位の矩形・円・光を塗るペン。座標は丸めて置き、ドットの縁をにじませない */
export class Pen {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  alpha(a: number): void {
    this.ctx.globalAlpha = a;
  }

  /** 座標と大きさを整数に丸めて塗る */
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** 丸めずに塗る（拡大するドットなど、寸法が整数でない絵用） */
  rectRaw(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  disc(cx: number, cy: number, r: number, color: string): void {
    if (r <= 0) return;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy + r * DISC_EDGE_SOFTEN));
      this.rect(cx - w, cy + dy, w * 2 + 1, 1, color);
    }
  }

  glow(cx: number, cy: number, r: number, color: string, a: number): void {
    GLOW_BANDS.forEach((f, i) => {
      this.alpha(a * (GLOW_BASE_ALPHA + i * GLOW_STEP_ALPHA));
      this.disc(cx, cy, Math.round(r * f), color);
    });
    this.alpha(1);
  }

  /** 文字 → 色の表で当てるピクセルマップ。sc は 1 ドットの論理寸法 */
  sprite(rows: readonly string[], palette: Readonly<Record<string, string>>, x: number, y: number, sc: number, flip = false): void {
    const w = rows[0]?.length ?? 0;
    rows.forEach((row, j) => {
      for (let i = 0; i < w; i++) {
        const color = palette[row[i] ?? ""];
        if (!color) continue;
        const ii = flip ? w - 1 - i : i;
        this.rectRaw(x + ii * sc, y + j * sc, sc, sc, color);
      }
    });
  }
}
