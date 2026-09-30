// 手鈴（moveset "handbell"）のエフェクト。docs/ideas/fx-sprites.md 5・6 章。手本は sword.mjs / wand.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（weapons/WEAPON/movesets/handbell.json）× 2 が目安
//
// 手鈴の絵の言葉は 3 つ:
//   音の輪 = 鈴の口から広がる同心の輪と、振りの先へ向かう「)))」の括弧の弧。鳴らした数だけ輪が増える
//   房     = 鈴の柄の房。しなる細い紐と、先の房飾り。振りの後ろに揺れて残る
//   光の粒 = 澄んだ音が散る小さな十字の閃き
// 刃を使わない。振りは「鈴が走った跡の三日月（細い）」+ 「音の括弧」+ 「房」で見せ、打ち鳴らし（toll・鎮め）は輪だけで目立たせる
import { arcBounds, arcLine, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（手鈴だけで使う）
// -----------------------------------------------------------------------------

/** 振りの進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 折れ線を太さつきで塗る（wand.mjs の stroke と同じ考え）。width / bright は始点からの割合 t（0..1）の関数でも数でもよい */
function stroke(frame, pts, o) {
  if (pts.length < 2) return;
  const lens2 = [0];
  for (let i = 1; i < pts.length; i++) lens2.push((lens2[i - 1] ?? 0) + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens2[lens2.length - 1] || 1;
  const widthAt = typeof o.width === "function" ? o.width : () => o.width;
  const brightAt = typeof o.bright === "function" ? o.bright : () => o.bright ?? 0.7;
  const maxW = o.maxWidth ?? (typeof o.width === "number" ? o.width : 6);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  paint(
    frame,
    (x, y) => {
      let best = Infinity;
      let bt = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const s = segment(x, y, a.x, a.y, b.x, b.y);
        if (s.d < best) {
          best = s.d;
          bt = ((lens2[i - 1] ?? 0) + s.t * ((lens2[i] ?? 0) - (lens2[i - 1] ?? 0))) / total;
        }
      }
      const w = widthAt(bt) / 2;
      if (w < 0.35 || best > w) return -1;
      return clamp01(brightAt(bt) * (1 - 0.5 * (best / w)));
    },
    { bounds: { x0: Math.min(...xs) - maxW - 2, y0: Math.min(...ys) - maxW - 2, x1: Math.max(...xs) + maxW + 2, y1: Math.max(...ys) + maxW + 2 }, samples: 3, dither: 0.04 },
  );
}

/**
 * 音の括弧 1 本: (ox, oy) を中心に、向き dir へ開く弧（「)」の形）。両端が細くなる。
 * 鈴の口から前へ出る音の波
 */
function soundArc(frame, o) {
  const { radius, dir } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = o.span ?? 0.7;
  const width = o.width ?? 1.8;
  const bright = o.bright ?? 0.7;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const da = Math.abs(wrapAngle(Math.atan2(dy, dx) - dir));
      if (da > span) return -1;
      const taper = Math.pow(Math.cos((da / span) * (Math.PI / 2)), 0.6);
      if (taper * width < d * 2) return -1;
      return clamp01(bright * (0.5 + 0.5 * taper));
    },
    { bounds: arcBounds(ox, oy, Math.max(0, radius - width), radius + width, dir - span, dir + span), dither: 0.02 },
  );
}

/** 点線の輪（音の輪）: 弧の切れ目で音の粒感を出す。phase で回る */
function dashRing(frame, o) {
  const { radius, dashes } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const fill = o.fill ?? 0.6;
  const step = TAU / dashes;
  for (let i = 0; i < dashes; i++) {
    const a = (o.phase ?? 0) + i * step;
    arcLine(frame, { ox, oy, radius, from: a, to: a + step * fill, width: o.width ?? 1.6, bright: o.bright ?? 0.6 });
  }
}

/** 房: 始点 (x, y) から向き ang へしなって伸びる紐と、先の房飾り。phase でしなりの位相 */
function tassel(frame, o) {
  const { x, y, ang, len } = o;
  const sway = o.sway ?? 4;
  const phase = o.phase ?? 0;
  const bright = o.bright ?? 0.75;
  const pts = [];
  for (let j = 0; j <= 8; j++) {
    const t = j / 8;
    const side = Math.sin(t * 3.2 + phase) * sway * t;
    pts.push({ x: x + Math.cos(ang) * len * t - Math.sin(ang) * side, y: y + Math.sin(ang) * len * t + Math.cos(ang) * side });
  }
  stroke(frame, pts, { width: (t) => 1.7 - 0.4 * t, maxWidth: 2, bright: (t) => bright * (0.55 + 0.45 * (1 - t)) });
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!end || !prev) return;
  const base = Math.atan2(end.y - prev.y, end.x - prev.x);
  // 房飾り: 先で 5 本に開く
  for (let s = -2; s <= 2; s++) {
    const a = base + s * 0.32 + Math.sin(phase * 1.3 + s) * 0.15;
    const l = 5.5 - Math.abs(s) * 0.7;
    streakLine(frame, { ax: end.x, ay: end.y, bx: end.x + Math.cos(a) * l, by: end.y + Math.sin(a) * l, width: 1.2, bright: bright * 0.85 });
  }
  dot(frame, x, y, 5);
  dot(frame, x + 1, y, 4);
}

/** 鈴の口を上から見た形（同心の輪と舌）。r は外縁の半径 */
function bellMouth(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.85;
  const erosion = o.erosion ?? 0;
  ring(frame, { ox: x, oy: y, radius: r, width: 2.4, erosion, bright, seed: o.seed ?? 11 });
  ring(frame, { ox: x, oy: y, radius: r * 0.62, width: 1.4, erosion, bright: bright * 0.7, seed: (o.seed ?? 11) + 1 });
  if (erosion < 0.5) {
    dot(frame, x, y, 6);
    dot(frame, x + 1, y, 5);
    dot(frame, x, y + 1, 5);
  }
}

/** 全周へ散る光の粒 */
function motes(frame, age, o) {
  shards(frame, age, o.n, o.seed, (i, rnd) => {
    const a = (o.center ?? 0) + (rnd(1) - 0.5) * (o.cone ?? TAU);
    const sp = o.speed * (0.5 + rnd(2));
    const r0 = (o.r0 ?? 0) * (0.5 + 0.5 * rnd(6));
    return { x: (o.x ?? 0) + Math.cos(a) * r0, y: (o.y ?? 0) + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life ?? 3) + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: o.drag ?? 0.82 };
  });
}

/** 花弁（菱形の細い葉）1 枚: 中心から向き a へ r0 → r1 */
function petal(frame, a, r0, r1, w, o = {}) {
  lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, T: w, bias: 0, bright: o.bright ?? 0.85, erosion: o.erosion ?? 0, seed: o.seed ?? 5 });
}

// -----------------------------------------------------------------------------
// 左の段（arc 120〜160°・reach 20〜22）: 鈴が走り、音が前へ出る
// -----------------------------------------------------------------------------

const SWING1 = { R: 40, sweep: 110, tilt: 0, frames: 7, active: 3, seed: 1101, wave: 3, tass: 15 };
const SWING2 = { R: 40, sweep: 120, tilt: 6, frames: 7, active: 3, seed: 1201, wave: 3, tass: 17 };
const SWING3 = { R: 44, sweep: 160, tilt: 0, frames: 9, active: 4, seed: 1301, wave: 4, tass: 20, ding: true };

/** 鈴の振り: 細い金の三日月の先で音の括弧が前へ広がり、後ろに房が揺れる。終撃は振り切りで大きな音の輪 */
function bellSwing(frame, f, spec) {
  const { R, frames: N, active: A, seed } = spec;
  const half = (spec.sweep * Math.PI) / 360;
  const from = -half + (spec.tilt * Math.PI) / 180;
  const sweep = half * 2;
  const { p, k } = timing(f, A, N);
  const head = from + sweep * (f < A ? p : 1 + 0.04 * k);
  const tail = from + sweep * (f < A ? Math.max(0, p - 0.8) * 0.5 : Math.min(0.95, 0.35 + 0.6 * k));
  crescent(frame, { R, T: spec.ding ? 9 : 7, head, tail, erosion: k * 0.9, bright: 0.75 - k * 0.2, seed, streak: 0.4, edge: 1.3 });
  const hx = Math.cos(head) * (R - 4);
  const hy = Math.sin(head) * (R - 4);
  // 房: 鈴の後ろ（反時計の接線の向き）へしなる
  if (k < 0.8) tassel(frame, { x: hx * 0.9, y: hy * 0.9, ang: head - Math.PI / 2 - 0.15, len: spec.tass * (1 - k * 0.3), sway: 4.5, phase: f * 1.3, bright: 0.8 * (1 - k * 0.7) });
  // 音の括弧: 先端から外へ、間を空けて広がる
  const age = f < A ? Math.max(0, f - 1) : f - 1;
  for (let i = 0; i < spec.wave; i++) {
    const rad = 4 + i * 4.6 + age * 2.6;
    const b = (0.85 - i * 0.16) * (1 - k * 0.85);
    if (b < 0.2 || f < 1) continue;
    soundArc(frame, { ox: hx, oy: hy, radius: rad, dir: head + 0.1, span: 0.75 - i * 0.05, bright: b });
  }
  if (f === A - 1) sparkle(frame, hx, hy, 3);
  if (spec.ding && f >= A - 1) {
    const g = f - (A - 1);
    ring(frame, { ox: hx, oy: hy, radius: 8 + g * 6, width: 2.6 - g * 0.3, erosion: Math.min(0.9, g * 0.17), bright: 0.9 - g * 0.09, seed: seed + 5 });
    if (g >= 1) ring(frame, { ox: hx, oy: hy, radius: 4 + g * 4.2, width: 1.6, erosion: Math.min(0.9, g * 0.2), bright: 0.65 - g * 0.06, seed: seed + 6 });
    motes(frame, g, { n: 12, seed: seed + 8, speed: 3.6, x: hx, y: hy, r0: 3, life: 4 });
  }
}

// -----------------------------------------------------------------------------
// ダッシュ攻撃（circle 44）: 音が前へ走る
// -----------------------------------------------------------------------------

/** 前へ並ぶ音の括弧が駆け抜け、後ろに房と空気の筋が流れる */
function bellDash(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  for (let i = 0; i < 4; i++) {
    const rad = 10 + i * 9 + p * 12 + k * 6;
    const b = (0.9 - i * 0.14) * (1 - k * 0.8);
    if (b > 0.2) soundArc(frame, { radius: rad, dir: 0, span: 1.05 - i * 0.1, bright: b, width: 2 - i * 0.15 });
  }
  if (k < 0.85) {
    for (const side of [-1, 1]) tassel(frame, { x: -6, y: side * 7, ang: Math.PI + side * 0.35, len: 18, sway: 5, phase: f * 1.4 + side, bright: 0.8 * (1 - k * 0.7) });
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 6 + (hash1(i, 1401) - 0.5) * 3;
      const x1 = -16 - Math.abs(y) * 0.5 - k * 14 - hash1(i, 1402) * 8;
      streakLine(frame, { ax: x1 - 18 - hash1(i, 1403) * 14, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= A - 1) motes(frame, f - (A - 1), { n: 10, seed: 1404, speed: 3.6, x: 24, r0: 8, center: 0, cone: 3, life: 4 });
  if (f === A - 1) sparkle(frame, 34, 0, 3);
}

// -----------------------------------------------------------------------------
// 右の段
// -----------------------------------------------------------------------------

/** 右: 打ち鳴らし（circle 40）。鈴の口が閃き、音の輪が 4 重に広がる。輪だけで見せる */
function toll(frame, f) {
  const N = 10;
  const A = 5;
  const { k } = timing(f, A, N);
  if (f <= 2) bellMouth(frame, 0, 0, 7 + f * 1.5, { bright: 0.95, seed: 1501 });
  for (let i = 0; i < 4; i++) {
    const age = f - i * 1.1;
    if (age < 0) continue;
    const rad = 6 + age * 7.5;
    if (rad > 46) continue;
    ring(frame, { radius: rad, width: 2.6 - i * 0.35, erosion: Math.min(0.92, age * 0.09 + k * 0.4), bright: (0.95 - i * 0.14) * (1 - k * 0.5), seed: 1510 + i });
  }
  // 輪の外側の点線（音の粒）
  if (f >= 2 && k < 0.8) dashRing(frame, { radius: 10 + f * 3.6, dashes: 12, fill: 0.5, phase: f * 0.25, bright: 0.55 * (1 - k) });
  if (f === 1) sparkle(frame, 0, 0, 4);
  if (f === 2) for (let i = 0; i < 4; i++) sparkle(frame, Math.cos((i / 4) * TAU + 0.4) * 20, Math.sin((i / 4) * TAU + 0.4) * 20, 2);
  if (f >= 2) motes(frame, f - 2, { n: 14, seed: 1520, speed: 3.6, r0: 12, life: 5 });
}

/** 右: 鈴払い（arc 150° reach 22）。3 重の音の帯が外へ順に走り、房が長く流れる */
function bellSweepFx(frame, f) {
  const N = 8;
  const A = 4;
  const R = 44;
  const half = (150 * Math.PI) / 360;
  const { p, k } = timing(f, A, N);
  const head = -half + half * 2 * (f < A ? p : 1);
  const tail = -half + (f < A ? 0 : half * 2 * Math.min(0.9, k));
  crescent(frame, { R, T: 8, head, tail, erosion: k * 0.9, bright: 0.75 - k * 0.2, seed: 1601, streak: 0.4, edge: 1.3 });
  // 帯: 外縁より内側の 2 本の点線の弧が先端を追う
  for (let i = 1; i <= 2; i++) {
    const rad = R - 6 - i * 6;
    arcLine(frame, { radius: rad, from: Math.max(-half, head - 1.6 + i * 0.2), to: head - 0.05, width: 1.7, bright: (0.7 - i * 0.15) * (1 - k * 0.9) });
  }
  const hx = Math.cos(head) * (R - 4);
  const hy = Math.sin(head) * (R - 4);
  if (k < 0.85) tassel(frame, { x: hx * 0.92, y: hy * 0.92, ang: head - Math.PI / 2 - 0.2, len: 24 * (1 - k * 0.3), sway: 6, phase: f * 1.2, bright: 0.85 * (1 - k * 0.7) });
  const age = Math.max(0, f - 1);
  for (let i = 0; i < 3; i++) {
    const b = (0.9 - i * 0.18) * (1 - k * 0.85);
    if (f >= 1 && b > 0.2) soundArc(frame, { ox: hx, oy: hy, radius: 5 + i * 5 + age * 2.6, dir: head + 0.1, span: 0.8, bright: b });
  }
  if (f === A - 1) sparkle(frame, hx, hy, 3);
  if (f >= A - 1) motes(frame, f - (A - 1), { n: 10, seed: 1602, speed: 3.6, x: hx, y: hy, r0: 3, center: head + 0.4, cone: 2.4, life: 4 });
}

/** 右: 鈴落とし（box reach 14 / size 16・強い）。鈴の口が上から落ち、着地で輪と放射の亀裂・光の柱が弾ける */
function bellDrop(frame, f) {
  const N = 9;
  const A = 4;
  const { k } = timing(f, A, N);
  const cx = 30;
  if (f < A) {
    const p = (f + 1) / A;
    bellMouth(frame, cx, 0, 20 - 8 * p, { bright: 0.55 + 0.4 * p, seed: 1701 });
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 9;
      streakLine(frame, { ax: cx - 24, ay: y, bx: cx - 10 + p * 4, by: y, bright: 0.4 + 0.3 * p });
    }
  } else {
    bellMouth(frame, cx, 0, 12 - k * 2, { bright: 0.95 - k * 0.4, erosion: k * 0.8, seed: 1701 });
    const age = f - A;
    ring(frame, { ox: cx, radius: 12 + age * 6.5, width: 3.2 - age * 0.4, squash: 0.6, erosion: Math.min(0.9, age * 0.17), bright: 0.95 - age * 0.09, seed: 1702 });
    if (age >= 1) ring(frame, { ox: cx, radius: 7 + age * 4.6, width: 2, squash: 0.6, erosion: Math.min(0.92, age * 0.2), bright: 0.7 - age * 0.07, seed: 1703 });
    // 放射の亀裂（8 本）
    if (k < 0.75) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const r0 = 8 + age * 2;
        const r1 = 16 + age * 6 + hash1(i, 1704) * 8;
        streakLine(frame, { ax: cx + Math.cos(a) * r0, ay: Math.sin(a) * r0 * 0.7, bx: cx + Math.cos(a) * r1, by: Math.sin(a) * r1 * 0.7, width: i % 2 ? 1.2 : 1.8, bright: 0.75 * (1 - k) });
      }
    }
    motes(frame, age, { n: 16, seed: 1705, speed: 4.6, x: cx, r0: 6, life: 5 });
  }
  if (f === A) {
    sparkle(frame, cx, 0, 4);
    for (let i = 0; i < 4; i++) sparkle(frame, cx + Math.cos((i / 4) * TAU + 0.4) * 16, Math.sin((i / 4) * TAU + 0.4) * 16, 2);
  }
}

// -----------------------------------------------------------------------------
// 派生
// -----------------------------------------------------------------------------

/** 派生: 鈴の嵐（circle 48・3 回当たる）。4 本の房が周りを回り、3 回の当たり（f = 1・4・6）で輪が弾ける */
function bellStorm(frame, f) {
  const N = 12;
  const A = 8;
  const { k } = timing(f, A, N);
  const turn = f * 0.7;
  for (let i = 0; i < 4; i++) {
    const a = turn + (i / 4) * TAU;
    const r = 18 * (1 + k * 0.3);
    tassel(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, ang: a + Math.PI / 2 + 0.3, len: 22 * (1 - k * 0.3), sway: 5, phase: f * 1.1 + i, bright: 0.85 * (1 - k * 0.7) });
  }
  for (const [n, hit] of [1, 4, 6].entries()) {
    const age = f - hit;
    if (age < 0 || age > 4) continue;
    ring(frame, { radius: 12 + age * 8, width: 2.8 - age * 0.35, erosion: Math.min(0.9, age * 0.18), bright: 0.95 - age * 0.14, seed: 1801 + n });
    if (age === 0) sparkle(frame, 0, 0, 3);
  }
  dashRing(frame, { radius: 44, dashes: 14, fill: 0.55, phase: turn, bright: 0.6 * (1 - k * 0.8) });
  if (f >= A - 1) motes(frame, f - (A - 1), { n: 18, seed: 1810, speed: 5, r0: 34, life: 5 });
}

/** 派生: 結界（circle 48・敵弾を消す・強い押し出し）。二重の輪が一気に広がり、六角の紋が回る */
function warding(frame, f) {
  const N = 10;
  const A = 5;
  const { k } = timing(f, A, N);
  const grow = Math.min(1, (f + 1) / 3);
  const R = 46 * (0.25 + 0.75 * grow);
  const dim = 1 - k * 0.6;
  ring(frame, { radius: R, width: 3, erosion: k * 0.85, bright: 0.95 * dim, seed: 1901 });
  ring(frame, { radius: R * 0.8, width: 1.6, erosion: Math.min(0.9, k * 0.9 + 0.05), bright: 0.65 * dim, seed: 1902 });
  // 六角の紋（内側の輪の内接）
  const rot = f * 0.12;
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const a0 = rot + (i / 6) * TAU;
      const a1 = a0 + TAU / 6;
      const rr = R * 0.78;
      streakLine(frame, { ax: Math.cos(a0) * rr, ay: Math.sin(a0) * rr, bx: Math.cos(a1) * rr, by: Math.sin(a1) * rr, width: 1.5, bright: 0.7 * dim });
      const tr = R * 0.8;
      streakLine(frame, { ax: Math.cos(a0) * tr, ay: Math.sin(a0) * tr, bx: Math.cos(a0) * (R + 4), by: Math.sin(a0) * (R + 4), width: 1.6, bright: 0.75 * dim });
    }
  }
  // 押し出す風（外へ向かう短い筋）
  if (f >= 1 && k < 0.7) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.2;
      const r0 = R + 2 + hash1(i, 1903) * 4;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + 10 + 8 * hash1(i, 1904)), by: Math.sin(a) * (r0 + 10 + 8 * hash1(i, 1904)), width: 1.2, bright: 0.55 * (1 - k) });
    }
  }
  if (f === 1) sparkle(frame, 0, 0, 4);
  if (f >= A - 1) motes(frame, f - (A - 1), { n: 14, seed: 1905, speed: 4.6, r0: R, life: 5 });
}

/** 派生: 鈴の連打（circle 40・4 回当たる）。中心の鈴が揺れ、4 つの点線の輪が続けて広がる */
function ringOut(frame, f) {
  const N = 12;
  const A = 8;
  const { k } = timing(f, A, N);
  for (const [n, hit] of [1, 3, 5, 7].entries()) {
    const age = f - hit;
    if (age < 0 || age > 5) continue;
    const rad = 8 + age * 7;
    dashRing(frame, { radius: rad, dashes: 10 + n * 2, fill: 0.65, phase: n * 0.7 + age * 0.15, width: 2.2 - age * 0.25, bright: 0.95 - age * 0.15 });
    if (age === 0) sparkle(frame, 0, 0, 3);
  }
  // 鈴と房の揺れ（打つたびに房が振れる）
  if (k < 0.8) {
    const sw = Math.sin(f * 2.4) * 0.8;
    bellMouth(frame, 0, 0, 7, { bright: 0.9 * (1 - k * 0.5), seed: 2001 });
    tassel(frame, { x: 0, y: 6, ang: Math.PI / 2 + sw, len: 14, sway: 3.5, phase: f * 1.6, bright: 0.8 * (1 - k * 0.6) });
  }
  if (f >= 2) motes(frame, f - 2, { n: 14, seed: 2010, speed: 3.4, r0: 14, life: 5 });
}

/** 派生: 浄めの一打（box reach 14 / size 16・強い）。花弁が開いて放射の光条が走る */
function purifyStrike(frame, f) {
  const N = 9;
  const A = 4;
  const { k } = timing(f, A, N);
  const cx = 30;
  const open = Math.min(1, (f + 1) / 3);
  const dim = 1 - k * 0.6;
  // 花弁 8 枚（外へ開く）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const r1 = 6 + 18 * open;
    const p = { x: cx, y: 0 };
    lens(frame, { ax: p.x + Math.cos(a) * 3, ay: Math.sin(a) * 3, bx: p.x + Math.cos(a) * r1, by: Math.sin(a) * r1, T: 7 * open, bias: 0, bright: 0.9 * dim, erosion: k * 0.85, seed: 2101 + i });
  }
  // 放射の光条（花弁の間へ細く長く）
  if (f >= 1 && k < 0.8) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const long = i % 2 === 0;
      const r1 = (long ? 34 : 22) * Math.min(1, f / 2) + k * 8;
      streakLine(frame, { ax: cx + Math.cos(a) * 6, ay: Math.sin(a) * 6, bx: cx + Math.cos(a) * r1, by: Math.sin(a) * r1, width: long ? 1.8 : 1.2, bright: 0.85 * (1 - k) });
    }
  }
  ring(frame, { ox: cx, radius: 10 + f * 3.2, width: 2.4, erosion: Math.min(0.9, k * 0.9), bright: 0.8 * dim, seed: 2110 });
  if (f <= 3) sparkle(frame, cx, 0, f === 1 ? 4 : 3);
  if (f >= A - 1) motes(frame, f - (A - 1), { n: 14, seed: 2111, speed: 4.2, x: cx, r0: 6, life: 5 });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 澄んだ音。二重の輪と十字の閃き、光の粒。heavy は輪が増え、放射の光条が付く */
function bellHit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f / (N - 1);
  const s = heavy ? 1.4 : 1;
  ring(frame, { radius: (4 + f * 3.4) * s, width: 2.4 - k, squash: 0.85, erosion: Math.min(0.9, k * 0.9), bright: 0.9 - k * 0.4, seed: 2201 });
  if (f >= 1) ring(frame, { radius: (2.5 + f * 2.2) * s, width: 1.4, squash: 0.85, erosion: Math.min(0.9, k * 1.1), bright: 0.65 - k * 0.3, seed: 2202 });
  if (heavy && f >= 1 && f <= 4) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const r1 = 10 + f * 5;
      streakLine(frame, { ax: Math.cos(a) * 4, ay: Math.sin(a) * 4, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: i % 2 ? 1.1 : 1.6, bright: 0.75 * (1 - k) });
    }
  }
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (f >= 1) motes(frame, f - 1, { n: heavy ? 12 : 7, seed: 2203, speed: heavy ? 4.4 : 3.2, life: 4 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * arc・box は reach、circle は size で外縁を合わせる
 */
const FX = {
  moveset: "handbell",
  motions: {
    "l:0": { sheet: "handbell.l1", pivot: "self", base: 20, measure: "reach" },
    "l:1": { sheet: "handbell.l2", pivot: "self", base: 20, measure: "reach" },
    "l:2": { sheet: "handbell.l3", pivot: "self", base: 22, measure: "reach" },
    dash: { sheet: "handbell.dash", pivot: "self", base: 44, measure: "size" },
    "r:toll": { sheet: "handbell.toll", pivot: "self", base: 40, measure: "size" },
    "r:bellSweep": { sheet: "handbell.bellSweep", pivot: "self", base: 22, measure: "reach" },
    "r:bellDrop": { sheet: "handbell.bellDrop", pivot: "self", base: 14, measure: "reach" },
    "branch:bellStorm": { sheet: "handbell.bellStorm", pivot: "self", base: 48, measure: "size" },
    "branch:warding": { sheet: "handbell.warding", pivot: "self", base: 48, measure: "size" },
    "branch:ringOut": { sheet: "handbell.ringOut", pivot: "self", base: 40, measure: "size" },
    "branch:purifyStrike": { sheet: "handbell.purify", pivot: "self", base: 14, measure: "reach" },
  },
  hit: "handbell.hit",
  hitHeavy: "handbell.hitHeavy",
};

export const ATLAS = {
  key: "handbell",
  fx: FX,
  sheets: [
    { key: "handbell.l1", dirs: DIRS, frames: SWING1.frames, active: SWING1.active, size: 120, draw: (fr, f) => bellSwing(fr, f, SWING1) },
    { key: "handbell.l2", dirs: DIRS, frames: SWING2.frames, active: SWING2.active, size: 120, draw: (fr, f) => bellSwing(fr, f, SWING2) },
    { key: "handbell.l3", dirs: DIRS, frames: SWING3.frames, active: SWING3.active, size: 136, draw: (fr, f) => bellSwing(fr, f, SWING3) },
    { key: "handbell.dash", dirs: DIRS, frames: 8, active: 4, size: 136, draw: bellDash },
    { key: "handbell.toll", dirs: 1, frames: 10, active: 5, size: 128, draw: toll },
    { key: "handbell.bellSweep", dirs: DIRS, frames: 8, active: 4, size: 136, draw: bellSweepFx },
    { key: "handbell.bellDrop", dirs: DIRS, frames: 9, active: 4, size: 144, draw: bellDrop },
    { key: "handbell.bellStorm", dirs: 1, frames: 12, active: 8, size: 168, draw: bellStorm },
    { key: "handbell.warding", dirs: 1, frames: 10, active: 5, size: 168, draw: warding },
    { key: "handbell.ringOut", dirs: 1, frames: 12, active: 8, size: 128, draw: ringOut },
    { key: "handbell.purify", dirs: DIRS, frames: 9, active: 4, size: 128, draw: purifyStrike },
    { key: "handbell.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (fr, f) => bellHit(fr, f, false) },
    { key: "handbell.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (fr, f) => bellHit(fr, f, true) },
  ],
};
