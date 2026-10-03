/**
 * 受け流しが決まった瞬間、武器が攻撃を受け止めた所（playerRig.ts の guardContact）に散る火花（docs/ideas/parry-motion.md）。
 * 白い十字の閃きと、外へ扇に飛ぶ火の粉。ばらつきは印の位置のハッシュ（state.rng を使わない）。数値は PARRY_POSE.spark
 */
import { PARRY_POSE } from "../data/tuning";
import { ACTOR_ART_SCALE } from "./actorSprites";
import { clamp01, easeOutCubic, hash01 } from "./renderMath";

const DEG = Math.PI / 180;
/** ハッシュの種をずらす量（火の粉ごとの角・距離を別の値にする） */
const SEED_ANGLE = 17;
const SEED_LEN = 53;
/** 閃きの十字の斜めの腕の長さ（縦横の腕に対する割合） */
const FLASH_DIAG = 0.5;
/** 火花のドットの大きさ（論理 px）。プレイヤーの絵と同じ密度（1 ドット = 論理 0.5px） */
const SPRITE_DOT = 1 / ACTOR_ART_SCALE;

export interface SparkStreak {
  /** 尾と頭（論理 px、火花の中心から） */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly color: string;
}

/**
 * 火の粉の線（純関数。テストする）。dir = 散る向きの中心（rad）、age = 決まってからの秒、seed = ばらつきの種。
 * 頭は速く伸びて減速し、尾は後から追いかけて縮む。色は colors を若い → 古いの順に移る（既定は白 → 橙）
 */
export function sparkStreaks(dir: number, age: number, seed: number, colors: readonly string[] = PARRY_POSE.spark.colors): SparkStreak[] {
  const s = PARRY_POSE.spark;
  const u = age / s.life;
  if (!(u >= 0) || u >= 1) return [];
  const color = colors[Math.min(colors.length - 1, Math.floor(u * colors.length))] ?? "#fff";
  const head = easeOutCubic(u);
  const tail = Math.max(0, head - s.tail * (1 - u));
  const out: SparkStreak[] = [];
  for (let n = 0; n < s.count; n++) {
    const a = dir + (hash01(seed + n * SEED_ANGLE, n) - 0.5) * s.spreadDeg * DEG;
    const len = s.lenMin + (s.lenMax - s.lenMin) * hash01(seed + n * SEED_LEN, n + 1);
    const cx = Math.cos(a) * len;
    const cy = Math.sin(a) * len;
    out.push({ x0: cx * tail, y0: cy * tail, x1: cx * head, y1: cy * head, color });
  }
  return out;
}

/** 閃きの十字の腕の長さ（論理 px）。flashSec で縮み切る。過ぎたら 0 */
export function sparkFlash(age: number): number {
  const s = PARRY_POSE.spark;
  if (!(age >= 0) || age >= s.flashSec) return 0;
  return s.flashPx * (1 - clamp01(age / s.flashSec));
}

/** 線をドットで打つ（ぼかさない） */
function dotLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SPRITE_DOT));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round((x0 + (x1 - x0) * t) / SPRITE_DOT) * SPRITE_DOT;
    const y = Math.round((y0 + (y1 - y0) * t) / SPRITE_DOT) * SPRITE_DOT;
    ctx.fillRect(x, y, SPRITE_DOT, SPRITE_DOT);
  }
}

/** 受け止めた所 (x, y) に、dir の向きへ散る火花を描く */
export function drawParrySpark(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, age: number, seed: number, colors?: readonly string[]): void {
  const streaks = sparkStreaks(dir, age, seed, colors);
  for (const st of streaks) {
    ctx.fillStyle = st.color;
    dotLine(ctx, x + st.x0, y + st.y0, x + st.x1, y + st.y1);
  }
  const flash = sparkFlash(age);
  if (flash <= 0) return;
  ctx.fillStyle = (colors ?? PARRY_POSE.spark.colors)[0] ?? "#fff";
  dotLine(ctx, x - flash, y, x + flash, y);
  dotLine(ctx, x, y - flash, x, y + flash);
  const d = flash * FLASH_DIAG;
  dotLine(ctx, x - d, y - d, x + d, y + d);
  dotLine(ctx, x - d, y + d, x + d, y - d);
}
