// チャクラム（moveset "ringBlades"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/ringBlades.json）× 2 が目安
//
// 剣と見分けるための決まり: 斬線は「細い帯 + 外周の刃の刻み（のこぎりの歯）」で描き、三日月の面にしない。
// 帯の先頭には回転する小さな輪（歯の付いた円）を置き、円と回転を常に見せる
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 形の部品（チャクラム専用）
// -----------------------------------------------------------------------------

/** 角 a を基準 base から時計回りに測った [0, 2π) の距離（全周の帯でも巻き戻らない） */
function cwFrom(base, a) {
  const d = (base - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 崩れの判定（ノイズ + 芯からの近さ）。shapes.mjs の survives と同じ考え方 */
function keep(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4.5, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.25;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/**
 * のこぎりの歯の高さ。弧の長さの座標 L で間隔 pitch。1 周期の前 7 割が歯（尾の側がなだらかに上がり、先頭側で切り立つ＝進む向きに切る歯）、残りは隙間
 */
function toothHeight(L, pitch, tooth) {
  const t = (((L / pitch) % 1) + 1) % 1;
  if (t > 0.7) return 0;
  return tooth * Math.min(1, t / 0.45 + 0.3);
}

/** 歯の切り立った面の側か（明るく塗る） */
function toothFront(L, pitch) {
  const t = (((L / pitch) % 1) + 1) % 1;
  return t > 0.45;
}

/** 弧・円の外接矩形（全周なら円の箱） */
function circleBounds(ox, oy, r) {
  return { x0: ox - r - 2, y0: oy - r - 2, x1: ox + r + 2, y1: oy + r + 2 };
}

/**
 * 刻みの付いた弧の帯（輪が転がって通った軌跡）。中心 (ox, oy)、帯の外縁の半径 R、太さ T。
 * head = 先頭の角、span = 尾までの長さ（ラジアン。2π まで）。外縁の外にのこぎりの歯（高さ tooth、間隔 pitch ドット）。
 * 歯は世界に固定（phase 0）なので、フレームをまたいで刻みが動かず「切り跡」に見える。
 * 外縁の先頭寄りが白い刃の縁、内側と尾ほど暗い
 */
function toothedArc(frame, o) {
  const { R, T, head, span } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const tooth = o.tooth ?? 3;
  const pitch = o.pitch ?? 8;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const full = span >= TAU - 1e-3;
  const edgeReach = o.edgeReach ?? 0.55;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + tooth + 0.5 || r < R - T - 0.5) return -1;
      const a = Math.atan2(dy, dx);
      const s = cwFrom(head, a);
      if (s > span) return -1;
      const u = full ? 0.25 : s / span;
      // 先頭は短く尖り、尾へ細る
      const taper = full ? 1 : Math.min(1, u / 0.05) * Math.pow(1 - u, 0.55);
      const w = T * taper;
      // 歯: 弧の長さの座標で等間隔。進む向き（先頭側）へ切り立つのこぎり形
      const L = a * R;
      const th = toothHeight(L, pitch, tooth) * (full ? 1 : 1 - 0.6 * u) * Math.min(1, taper * 2);
      if (r > R) {
        if (r - R > th || th < 0.8) return -1;
        if (!keep(x, y, erosion, 0.2, seed + 3)) return -1;
        // 歯の切り立った面（先頭側）だけ明るく、背は暗い。刻みが 1 枚ずつ読める
        const front = toothFront(L, pitch) ? 0.22 : 0;
        return clamp01((0.62 + front) * (1 - 0.5 * u) * bright * (1 - erosion * 0.4));
      }
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.4 && u < edgeReach && erosion < 0.45) return clamp01(bright * (1.05 - 0.35 * u));
      return clamp01(Math.pow(1 - q, 1.1) * (0.9 - 0.5 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: circleBounds(ox, oy, R + tooth + 1) },
  );
}

/**
 * 回転する輪（チャクラム本体の光）。中心 (cx, cy)、外径 r、輪の太さ rw、歯 n 枚、回転 rot。
 * 輪の内側は抜く（円の穴で「輪」と分かる）。明るい側が回転とともに回り、回っていると読める
 */
function wheel(frame, cx, cy, o) {
  const { r, rot } = o;
  const rw = o.rw ?? Math.max(2, r * 0.4);
  const n = o.teeth ?? 6;
  const th = o.tooth ?? Math.max(1.5, r * 0.35);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r + th + 0.5 || d < r - rw) return -1;
      const a = Math.atan2(dy, dx) - rot;
      const t = ((((a / TAU) * n) % 1) + 1) % 1;
      if (d > r && d - r > th * t) return -1;
      if (!keep(x, y, erosion, 0.3, seed)) return -1;
      const lit = 0.5 + 0.5 * Math.cos(a + 0.8);
      if (d <= r && d > r - 1.2 && lit > 0.6) return clamp01(bright);
      const base = d > r ? 0.62 : 0.5 + 0.2 * ((r - d) / rw < 0.5 ? 1 : 0);
      return clamp01((base + 0.3 * lit) * bright * (1 - erosion * 0.4));
    },
    { bounds: circleBounds(cx, cy, r + th + 1), samples: 4 },
  );
}

/** 円周に沿う 1px の速度線（中心 ox, oy、半径 radius、先頭の角 head から尾へ len ラジアン） */
function orbitLine(frame, o) {
  const { radius, head, len } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const hi = o.bright ?? 0.5;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      if (Math.abs(Math.hypot(dx, dy) - radius) > 0.5) return -1;
      const s = cwFrom(head, Math.atan2(dy, dx));
      if (s > len) return -1;
      return hi * (1 - 0.7 * (s / len));
    },
    { bounds: circleBounds(ox, oy, radius + 1), dither: 0, samples: 2 },
  );
}

/** 回転の火花: 円周上の点から接線（時計回りの進む向き）へ飛ぶ */
function tangentSparks(frame, age, count, seed, o) {
  const { ox = 0, oy = 0, radius, from, to, speed = 4 } = o;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = from + (to - from) * rnd(1);
    const r = radius * (0.92 + 0.12 * rnd(2));
    const sp = speed * (0.6 + 0.8 * rnd(3));
    const out = 0.15 + 0.3 * rnd(4);
    return {
      x: ox + Math.cos(a) * r,
      y: oy + Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      size: rnd(6) > 0.5 ? 2 : 1,
    };
  });
}

// -----------------------------------------------------------------------------
// 弧の斬撃（左 1・2・4 段）: 輪が弧を転がって通った刻みの帯 + 先頭の回転する輪
// -----------------------------------------------------------------------------

/** 左 1 段（arc 160° reach 22）: 細い帯と細かい歯 */
const L0 = { R: 50, T: 7, tooth: 3, pitch: 7, sweep: 160, tilt: 0, frames: 8, active: 4, tailLen: 0.85, wheelR: 8, teeth: 6, sparks: 7, seed: 1101 };
/** 左 2 段（返し。描画側が上下反転）: 少し外を低く通し、歯を粗く、輪を大きく */
const L1 = { R: 54, T: 7, tooth: 4, pitch: 10, sweep: 160, tilt: 10, frames: 8, active: 4, tailLen: 0.95, wheelR: 8, teeth: 5, sparks: 8, seed: 1202 };
/** 左 4 段（arc 220° reach 26・重い）: 太い帯・大きな歯と輪・火花を多く */
const L3 = { R: 60, T: 10, tooth: 5, pitch: 11, sweep: 220, tilt: 0, frames: 9, active: 4, tailLen: 0.9, wheelR: 10, teeth: 7, sparks: 14, seed: 1303, heavy: true };

function arcRoll(frame, f, spec) {
  const sweep = spec.sweep * DEG;
  const from = -sweep / 2 + spec.tilt * DEG;
  const A = spec.active;
  let head;
  let span;
  let erosion = 0;
  let bright = 1;
  let k = 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    span = Math.min(sweep * p, sweep * spec.tailLen);
    bright = 0.85 + 0.15 * p;
  } else {
    k = (f - A + 1) / (spec.frames - A + 1);
    head = from + sweep * (1 + 0.04 * k);
    span = sweep * spec.tailLen * (1 - 0.6 * k);
    erosion = 0.05 + 0.8 * Math.pow(k, 1.2);
    bright = 1 - 0.3 * k;
  }
  const T = spec.T * (f < A ? 0.75 + 0.25 * ((f + 1) / A) : 1 - 0.45 * k);
  toothedArc(frame, { R: spec.R, T, head, span, tooth: spec.tooth, pitch: spec.pitch, erosion, bright, seed: spec.seed });
  // 速度線は引かない（細い帯の外にもう 1 本の弧があると二重線に見える。歯が速度の代わり）
  // 先頭の輪: 帯の中を転がる（回転角 = 進んだ弧の長さ / 輪の半径）
  const wr = spec.wheelR * (f < A ? 1 : 1 - 0.35 * k);
  const wc = spec.R - spec.T * 0.5;
  if (f <= A) {
    const rot = (head * wc) / spec.wheelR;
    wheel(frame, Math.cos(head) * wc, Math.sin(head) * wc, { r: wr, rot, teeth: spec.teeth, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.3 : 0, seed: spec.seed + 5 });
  }
  if (f === A - 1) sparkle(frame, Math.cos(head) * (spec.R + 1), Math.sin(head) * (spec.R + 1), spec.heavy ? 4 : 3);
  if (f >= A - 1) {
    tangentSparks(frame, f - (A - 1), spec.sparks, spec.seed + 60, { radius: spec.R, from: head - 0.5, to: head, speed: spec.heavy ? 5.5 : 4.5 });
  }
}

function arcRollSheet(key, spec) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size: (spec.R + spec.tooth + 30) * 2, draw: (frame, f) => arcRoll(frame, f, spec) };
}

// -----------------------------------------------------------------------------
// 回転（自分の周り）: 円周の帯と輪
// -----------------------------------------------------------------------------

/**
 * 輪が自分の周りを回る（circle）。wheels 枚の輪が等間隔で周回し、それぞれ刻みの帯を引く。
 * flashes のフレームで輪が光る（多段の当たりに合わせる）
 */
function orbit(frame, f, spec) {
  const A = spec.active;
  const k = f < A ? 0 : (f - A + 1) / (spec.frames - A + 1);
  const start = spec.start * DEG;
  const lap = spec.laps * TAU;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = start + lap * p + (f < A ? 0 : 0.35 * Math.sin(k * Math.PI * 0.5));
  const spanMax = spec.trail * DEG;
  const span = f < A ? Math.min(spanMax, lap * p + 0.2) : spanMax * (1 - 0.55 * k);
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  const flash = spec.flashes.includes(f);
  for (let i = 0; i < spec.wheels; i++) {
    const h = head + (i * TAU) / spec.wheels;
    toothedArc(frame, { R: spec.R, T: spec.T * (1 - 0.4 * k), head: h, span, tooth: spec.tooth, pitch: spec.pitch, erosion, bright: (flash ? 1.1 : 0.95) * (1 - 0.3 * k), seed: spec.seed + i * 11 });
    const wc = spec.R - spec.T * 0.5;
    if (f <= A) {
      wheel(frame, Math.cos(h) * wc, Math.sin(h) * wc, { r: spec.wheelR * (f === A ? 0.8 : 1), rot: (h * wc) / spec.wheelR, teeth: spec.teeth, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.3 : 0, seed: spec.seed + 5 + i });
    }
    if (flash) sparkle(frame, Math.cos(h) * (spec.R + 2), Math.sin(h) * (spec.R + 2), 3);
    if (f >= A - 1) tangentSparks(frame, f - (A - 1), spec.sparks, spec.seed + 60 + i, { radius: spec.R, from: h - 1.2, to: h, speed: 4.5 });
  }
}

/** 左 3 段（circle size 46・2 段）: 1 枚の輪が自分の周りを 1 周強。2 回の当たりに合わせて光る（2 周にすると 1 枚ごとに輪が飛んで見える） */
const SPIN = { R: 44, T: 6, tooth: 3, pitch: 8, start: -150, laps: 1.25, trail: 220, wheels: 1, wheelR: 8, teeth: 6, frames: 9, active: 5, flashes: [1, 3], sparks: 10, seed: 1404 };
/** 右: 二輪断ち（circle size 50・2 段）: 向かい合う 2 枚の輪が 1 周。2 枚それぞれの当たりで光る */
const TWIN = { R: 48, T: 7, tooth: 4, pitch: 9, start: -90, laps: 1, trail: 140, wheels: 2, wheelR: 8, teeth: 5, frames: 9, active: 5, flashes: [1, 3], sparks: 7, seed: 1505 };

/**
 * ダッシュ攻撃（circle size 48）: 輪が 1 周して閉じた「のこぎりの円」になり、歯が回りながら広がって崩れる。
 * 周回の帯（左 3 段）と違い、最後は途切れのない全周の輪になる
 */
function dashSaw(frame, f) {
  const A = 4;
  const N = 8;
  const R = 46;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = -Math.PI / 2 + TAU * p;
  const span = f < A ? TAU * p : TAU;
  const Rk = R + k * 5;
  // 閉じた後は歯を回して見せる（帯ごと回すと刻みが進む）
  toothedArc(frame, { R: Rk, T: 6 * (1 - 0.45 * k), head: head + k * 0.6, span, tooth: 4, pitch: 9 + k * 2, erosion: f < A ? 0 : 0.1 + 0.75 * Math.pow(k, 1.1), bright: 1 - 0.3 * k, seed: 1606, edgeReach: 0.4 });
  if (f < A) {
    const wc = R - 3;
    wheel(frame, Math.cos(head) * wc, Math.sin(head) * wc, { r: 9, rot: (head * wc) / 9, teeth: 7, seed: 1607 });
    sparkle(frame, Math.cos(head) * (R + 2), Math.sin(head) * (R + 2), f === A - 1 ? 3 : 2);
  }
  if (f >= A - 1) tangentSparks(frame, f - (A - 1), 16, 1609, { radius: R, from: 0, to: TAU, speed: 4.5 });
}

// -----------------------------------------------------------------------------
// 月輪斬り（arc 360°・2 段）: 満月のような完全な円の斬線が 2 回光る
// -----------------------------------------------------------------------------

function moonCut(frame, f) {
  const A = 6;
  const N = 10;
  const R = 62;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 0〜2: 輪が 1 周して円が閉じる（1 回目の光）。3 で落ち着き、4 で円全体がもう一度光る（2 回目）
  const p = f < 3 ? easeSwing((f + 1) / 3) : 1;
  const head = -Math.PI / 2 + TAU * p;
  const span = f < 3 ? TAU * p : TAU;
  const flash = f === 2 || f === 4;
  const dim = f === 3 ? 0.72 : f === 5 ? 0.85 : 1;
  // のこぎりの円（ダッシュ）と見分けるため、歯は小さく疎らにして、滑らかな満月の輪郭を主にする
  const T = f === 4 ? 11 : 8 * (1 - 0.4 * k);
  toothedArc(frame, { R, T, head, span, tooth: 2, pitch: 16, erosion: f < A ? 0 : 0.08 + 0.8 * Math.pow(k, 1.2), bright: (flash ? 1.1 : 0.95) * dim * (1 - 0.3 * k), seed: 1707, edgeReach: flash ? 1 : 0.45 });
  if (f < 3) {
    const wc = R - 3.5;
    wheel(frame, Math.cos(head) * wc, Math.sin(head) * wc, { r: 10, rot: (head * wc) / 10, teeth: 7, seed: 1708 });
  }
  if (flash) {
    // 満月の光: 円周の 4 点に閃き
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + (f === 4 ? Math.PI / 4 : 0);
      sparkle(frame, Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), f === 4 ? 4 : 3);
    }
  }
  if (f >= 4) tangentSparks(frame, f - 4, 20, 1710, { radius: R, from: 0, to: TAU, speed: 5 });
}

// -----------------------------------------------------------------------------
// 前方の短い円弧（box・当たりの中心に置く）: 輪が当たる点が光る
// -----------------------------------------------------------------------------

/**
 * 短い円弧の斬撃。中心 (cx, cy) の円の一部を先頭 head0 → head1 へ走らせ、当たる点 (hx, hy) を光らせる。
 * 先頭に輪、振り切りで当たる点から接線方向の火花
 */
function shortArc(frame, f, s) {
  const { cx, cy, R, T, a0, a1, A, N, seed } = s;
  const local = f - (s.delay ?? 0);
  if (local < 0) return;
  const k = local < A ? 0 : (local - A + 1) / (N - A + 1);
  if (k >= 1) return;
  const p = local < A ? easeSwing((local + 1) / A) : 1;
  const head = a0 + (a1 - a0) * p;
  const span = (a1 - a0) * (local < A ? p : 1 - 0.5 * k);
  toothedArc(frame, { ox: cx, oy: cy, R, T: T * (1 - 0.4 * k), head: head + k * 0.08, span, tooth: s.tooth ?? 3, pitch: s.pitch ?? 8, erosion: local < A ? 0 : 0.08 + 0.8 * Math.pow(k, 1.2), bright: 1 - 0.3 * k, seed });
  const wc = R - T * 0.5;
  if (local <= A) {
    const wr = s.wheelR ?? 8;
    wheel(frame, cx + Math.cos(head) * wc, cy + Math.sin(head) * wc, { r: wr * (local === A ? 0.8 : 1), rot: (head * wc) / wr, teeth: s.teeth ?? 6, bright: local === A ? 0.8 : 1, erosion: local === A ? 0.3 : 0, seed: seed + 5 });
  }
  // 当たる点: 振りの中ほどで光り、小さな輪が広がる
  const hitF = s.hitF ?? A - 2;
  if (local === hitF) sparkle(frame, s.hx, s.hy, s.heavy ? 4 : 3);
  if (local === hitF + 1) sparkle(frame, s.hx, s.hy, 2);
  if (local > hitF && local <= hitF + 3) {
    const age = local - hitF;
    ring(frame, { ox: s.hx, oy: s.hy, radius: 3 + age * (s.heavy ? 4 : 3), width: 1.6, bright: 0.75 - age * 0.12, erosion: age * 0.18, seed: seed + 7 });
  }
  if (local >= hitF) {
    const ah = Math.atan2(s.hy - cy, s.hx - cx);
    tangentSparks(frame, local - hitF, s.heavy ? 12 : 8, seed + 60, { ox: cx, oy: cy, radius: Math.hypot(s.hx - cx, s.hy - cy), from: ah - 0.15, to: ah + 0.15, speed: s.heavy ? 5 : 4 });
  }
}

/** 右: 輪断ち（box reach 18 / size 26）: 後ろに中心を置いた円弧が、前方の当たりの中心を上から下へ払う */
function ringCut(frame, f) {
  shortArc(frame, f, { cx: -30, cy: 0, R: 40, T: 7, a0: -58 * DEG, a1: 58 * DEG, A: 4, N: 8, hx: 10, hy: 0, seed: 1801 });
}

/**
 * 派生: 重ね輪（box reach 18 / size 26）: 両手の 2 枚の輪が上と下から同時に弧を描き、当たりの中心で重なる（挟み込み）。
 * 1 回の当たりなので時間差は付けず、2 枚が 1 点で合わさる瞬間を光らせる。輪断ち（上から下への 1 本）と形で見分ける
 */
function stackedRings(frame, f) {
  const s = { cx: -30, cy: 0, R: 40, T: 6, a0: -75 * DEG, a1: 0, A: 4, N: 8, hx: 10, hy: 0, seed: 1901, wheelR: 7, teeth: 5, hitF: 3 };
  shortArc(frame, f, s);
  shortArcMirrored(frame, f, { ...s, seed: 1911 });
}

/**
 * 派生: 双断ち（box reach 20 / size 28・重い・2 段）: 上から下への円弧のあと、逆の側から 2 枚目が下から上へ。
 * 当たりが 2 回なので時間と弧の中心をはっきり分ける
 */
function doubleSever(frame, f) {
  shortArc(frame, f, { cx: -30, cy: -8, R: 44, T: 8, a0: -50 * DEG, a1: 62 * DEG, A: 3, N: 7, hx: 12, hy: 6, seed: 2001, tooth: 4, pitch: 9, heavy: true, hitF: 1 });
  // 2 枚目は上下反転した軌道（下 → 上）。shortArc は時計回りなので、y を反転した中心と角で描く
  shortArcMirrored(frame, f, { cx: -30, cy: 8, R: 44, T: 8, a0: -50 * DEG, a1: 62 * DEG, A: 3, N: 7, hx: 12, hy: -6, seed: 2011, tooth: 4, pitch: 9, heavy: true, hitF: 1, delay: 2 });
}

/** shortArc を y 反転して描く（反時計回りの 2 枚目）。frame の写像を差し替えるだけ */
function shortArcMirrored(frame, f, s) {
  const mirror = Object.create(frame);
  mirror.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: -c.y };
  };
  mirror.toGrid = (x, y) => frame.toGrid(x, -y);
  shortArc(mirror, f, { ...s, cy: -s.cy, hy: -s.hy });
}

// -----------------------------------------------------------------------------
// 輪駆け（thrust reach 30・2 段・踏み込み 30）: 輪を前へ転がす一直線の軌跡
// -----------------------------------------------------------------------------

/** 直線の刻みの帯: x0 → x1（x1 が先頭）、太さ T、片側（-y）にのこぎりの歯 */
function toothedStraight(frame, o) {
  const { x0, x1, T, tooth, pitch, erosion = 0, bright = 1, seed } = o;
  const len = Math.max(1, x1 - x0);
  paint(
    frame,
    (x, y) => {
      if (x < x0 || x > x1) return -1;
      const u = (x1 - x) / len;
      const taper = Math.min(1, u / 0.06) * Math.pow(1 - u, 0.5);
      const w = (T / 2) * taper;
      const ay = Math.abs(y);
      if (ay > w) {
        // 歯は両縁に（上下から見た輪の両端が切る）。先頭へ切り立つのこぎり形
        const t = (((x / pitch) % 1) + 1) % 1;
        const th = tooth * t * (1 - 0.7 * u);
        if (ay - w > th || th < 0.8) return -1;
        if (!keep(x, y, erosion, 0.2, seed + 3)) return -1;
        return clamp01(0.72 * (1 - 0.5 * u) * bright * (1 - erosion * 0.4));
      }
      if (w < 0.6) return -1;
      const q = ay / w;
      if (!keep(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (q < 0.25 && u < 0.6 && erosion < 0.45) return clamp01(bright * (1.02 - 0.3 * u));
      return clamp01(Math.pow(1 - q, 1.1) * (0.9 - 0.5 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: x0 - 1, y0: -T - tooth - 2, x1: x1 + 1, y1: T + tooth + 2 } },
  );
}

function ringDash(frame, f) {
  const A = 4;
  const N = 8;
  const from = -36;
  const to = 64;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const tip = from + (to - from) * p;
  const back = f < A ? from : from + (to - from) * 0.7 * k;
  toothedStraight(frame, { x0: back, x1: tip, T: 9 * (1 - 0.4 * k), tooth: 3, pitch: 7, erosion: f < A ? 0 : 0.08 + 0.8 * Math.pow(k, 1.2), bright: 1 - 0.3 * k, seed: 2101 });
  // 平行の速度線（帯の外側だけ）
  if (k < 0.8) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (10 + Math.floor(i / 2) * 4);
      const x1 = tip - 14 - hash1(i, 2102) * 12 - k * 16;
      streakLine(frame, { ax: x1 - 22 - hash1(i, 2103) * 18, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
    }
  }
  // 先頭の輪: 転がる（回転角 = 進んだ距離 / 半径）
  if (f <= A) {
    const wr = 9;
    wheel(frame, tip, 0, { r: f === A ? 7 : wr, rot: tip / wr, teeth: 7, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.3 : 0, seed: 2104 });
  }
  // 2 段の当たり: 途中と先端で光る
  if (f === 1) sparkle(frame, tip + 10, 0, 3);
  if (f === A - 1) sparkle(frame, tip + 10, 0, 4);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 2105, (i, rnd) => {
      const a = (rnd(1) > 0.5 ? 1 : -1) * (0.6 + rnd(2) * 0.9);
      const sp = 3 + rnd(3) * 3;
      return { x: to, y: (rnd(4) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中: 円い切り口（小さな弧の裂け目）+ 接線方向に飛ぶ回転の火花。重いものは円い衝撃
// -----------------------------------------------------------------------------

function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const R = heavy ? 20 : 16;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  // 切り口: 原点の下に中心を置いた円の一部（原点が弧の頂点）。時計回りに進むと頂点で +x（刃の進む向き）へ走る
  const cx = 0;
  const cy = R;
  const sweep = (heavy ? 110 : 105) * DEG;
  const mid = -Math.PI / 2;
  const grow = f === 0 ? 0.55 : 1;
  toothedArc(frame, {
    ox: cx,
    oy: cy,
    R,
    T: (heavy ? 7 : 6) * (f === 0 ? 0.7 : 1 - 0.5 * k),
    head: mid - sweep / 2 + sweep * grow,
    span: sweep * grow,
    tooth: heavy ? 3 : 2,
    pitch: heavy ? 6 : 5,
    erosion: k * 0.9,
    bright: 1 - 0.2 * k,
    seed: heavy ? 2201 : 2211,
  });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (heavy && f >= 1) {
    // 円い衝撃: 刃の歯を思わせる細い輪が広がる
    const age = f - 1;
    toothedArc(frame, { R: 8 + age * 5.5, T: 2.4, head: age * 0.5, span: TAU, tooth: 2, pitch: 6, erosion: Math.min(0.9, age * 0.17), bright: 0.8 - age * 0.07, seed: 2202, edgeReach: 0 });
  }
  if (f >= 1) {
    // 回転の火花: 原点のまわりの小さな円から接線方向へ（渦を巻いて散る）
    tangentSparks(frame, f - 1, heavy ? 14 : 8, heavy ? 2203 : 2213, { radius: heavy ? 5 : 3, from: 0, to: TAU, speed: heavy ? 5.5 : 4 });
  }
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "ringBlades",
  motions: {
    "l:0": { sheet: "ringBlades.l1", pivot: "self", base: 22, measure: "reach" },
    "l:1": { sheet: "ringBlades.l2", pivot: "self", base: 22, measure: "reach" },
    "l:2": { sheet: "ringBlades.spin", pivot: "self", base: 46, measure: "size" },
    "l:3": { sheet: "ringBlades.l4", pivot: "self", base: 26, measure: "reach" },
    dash: { sheet: "ringBlades.dash", pivot: "self", base: 48, measure: "size" },
    "r:ringCut": { sheet: "ringBlades.ringCut", pivot: "anchor", base: 18, measure: "reach" },
    "r:twinRingCut": { sheet: "ringBlades.twin", pivot: "self", base: 50, measure: "size" },
    "branch:moonCut": { sheet: "ringBlades.moon", pivot: "self", base: 30, measure: "reach" },
    "branch:stackedRings": { sheet: "ringBlades.stacked", pivot: "anchor", base: 18, measure: "reach" },
    "branch:ringDash": { sheet: "ringBlades.ringDash", pivot: "self", base: 30, measure: "reach" },
    "branch:doubleSever": { sheet: "ringBlades.sever", pivot: "anchor", base: 20, measure: "reach" },
  },
  hit: "ringBlades.hit",
  hitHeavy: "ringBlades.hitHeavy",
};

export const ATLAS = {
  key: "ringBlades",
  fx: FX,
  sheets: [
    arcRollSheet("ringBlades.l1", L0),
    arcRollSheet("ringBlades.l2", L1),
    arcRollSheet("ringBlades.l4", L3),
    { key: "ringBlades.spin", dirs: WIDE_DIRS, frames: SPIN.frames, active: SPIN.active, size: 136, draw: (frame, f) => orbit(frame, f, SPIN) },
    { key: "ringBlades.twin", dirs: WIDE_DIRS, frames: TWIN.frames, active: TWIN.active, size: 144, draw: (frame, f) => orbit(frame, f, TWIN) },
    { key: "ringBlades.dash", dirs: WIDE_DIRS, frames: 8, active: 4, size: 140, draw: dashSaw },
    { key: "ringBlades.moon", dirs: WIDE_DIRS, frames: 10, active: 6, size: 176, draw: moonCut },
    { key: "ringBlades.ringCut", dirs: DIRS, frames: 8, active: 4, size: 128, draw: ringCut },
    { key: "ringBlades.stacked", dirs: DIRS, frames: 8, active: 4, size: 128, draw: stackedRings },
    { key: "ringBlades.sever", dirs: DIRS, frames: 9, active: 5, size: 136, draw: doubleSever },
    { key: "ringBlades.ringDash", dirs: DIRS, frames: 8, active: 4, size: 176, draw: ringDash },
    { key: "ringBlades.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => hit(frame, f, false) },
    { key: "ringBlades.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => hit(frame, f, true) },
  ],
};
