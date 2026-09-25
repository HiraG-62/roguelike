// 複数の武器で使う時間割の部品（docs/ideas/fx-sprites.md）。形そのものは shapes.mjs、塗りの道具は raster.mjs
// 武器ごとのファイルは、これを土台にしつつ、その武器だけの形（刃片・衝撃・筋・粒）を必ず足して個性を出す
import { arcLine, crescent, easeSwing, shards, sparkle } from "./shapes.mjs";
import { hash1 } from "./raster.mjs";

export const DEG = Math.PI / 180;
/** 方向の数（15° 刻み）。反時計回りは −θ の絵の上下反転で引くので、0 を含む偶数にする */
export const DIRS = 24;

// -----------------------------------------------------------------------------
// 弧の斬撃（左 1〜3 段・斬り上げ）の共通の時間割
// -----------------------------------------------------------------------------

/**
 * 弧の斬撃 1 フレーム。spec の数値でモーションごとの形を決める。
 * active のフレームで先端が振り幅を走り、残りで尾が先端へ追いつきながら崩れる
 */
export function arcSlash(frame, f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  const fade = f - (A - 1);
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - spec.tailLen) * 0.5;
    bright = 0.82 + 0.18 * p;
  } else {
    const k = fade / (spec.frames - A);
    head = from + sweep * (1 + spec.overshoot * k);
    tail = from + sweep * Math.min(0.97, 1 - spec.tailLen + (spec.tailLen - 0.05) * Math.pow(k, 0.8));
    erosion = spec.erodeFrom + (0.85 - spec.erodeFrom) * Math.pow(k, 1.3);
    bright = 1 - 0.3 * k;
  }
  // 振り終わりは内側から痩せて、外縁（刃の通り道）だけが細く残る
  const T = spec.T * (f < A ? 0.7 + 0.3 * ((f + 1) / A) : 1 - 0.5 * (fade / (spec.frames - A)));
  const ox = spec.ox ?? 0;
  crescent(frame, { ox, R: spec.R, T, head, tail, erosion, bright, seed: spec.seed, streak: spec.streak ?? 0.35 });
  drawArcLines(frame, f, spec, head, tail);
  if (f >= A - 1) drawArcShards(frame, f - (A - 1), spec, from, sweep);
  if (f === A - 1 || f === A) {
    const tipR = spec.R - T * 0.35;
    sparkle(frame, ox + Math.cos(head) * tipR, Math.sin(head) * tipR, f === A - 1 ? spec.glint : spec.glint - 1);
  }
}

/** 速度線: 外縁のすぐ外に、先端の後ろへ伸びる 1px の弧。崩れの間は外へずれて短くなる */
export function drawArcLines(frame, f, spec, head, tail) {
  const A = spec.active;
  const k = f < A ? 0 : (f - A + 1) / (spec.frames - A + 1);
  const span = head - tail;
  for (let i = 0; i < spec.lines; i++) {
    const r0 = hash1(i, spec.seed + 40);
    // 速度線は刃の外側にだけ沿わせる（内側に離して引くと、弧がもう 1 本あるように見える）
    const radius = spec.R + 2 + i * 1.5 + k * 6;
    const len = span * (0.35 + 0.45 * hash1(i, spec.seed + 41)) * (1 - k * 0.8);
    const end = head - span * (0.06 + 0.12 * r0) + k * span * 0.25;
    if (len <= 0.02 || k >= 0.95) continue;
    arcLine(frame, { ox: spec.ox ?? 0, radius, from: end - len, to: end, bright: (0.62 - i * 0.04) * (1 - k * 0.6) });
  }
}

/** 刃片: 振り切りの瞬間に先端付近から、刃の進む向き（接線）へ飛ぶ */
export function drawArcShards(frame, age, spec, from, sweep) {
  shards(frame, age, spec.shards, spec.seed + 60, (i, rnd) => {
    const a = from + sweep * (0.55 + 0.45 * rnd(1));
    const r = spec.R - spec.T * (0.2 + 0.6 * rnd(2));
    const speed = spec.shardSpeed * (0.6 + 0.8 * rnd(3));
    // 接線（時計回りの進む向き）と外向きを混ぜる
    const out = 0.35 + 0.5 * rnd(4);
    const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * speed;
    const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * speed;
    return { x: (spec.ox ?? 0) + Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
  });
}

/** 作業面の大きさ（原点が中心。切り詰めるので余白は気にしない） */
export function workSize(spec) {
  return Math.ceil(spec.R + Math.abs(spec.ox ?? 0) + 14) * 2;
}

export function arcSheet(key, spec) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size: workSize(spec), draw: (frame, f) => arcSlash(frame, f, spec) };
}

