// 書（moveset "book"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は book.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/book.json × 2 が目安
//
// 書の絵の言葉は頁（反った紙）・紙片・墨の字。奥義は見せ場なので、それを大きく重ねる:
//   万巻 = 頁の大渦が自分の周りに広がり、3 回の当たりごとに字の輪が脈打つ。足元に字の陣。気力の回復は頁が舞い上がる
//   封呪 = 前に呪符が扇に開き、5 枚の呪符が敵を貫いて飛ぶ（呪符は長い頁に大きな字と、はためく帯）
//   朗誦 = 頭上に開いた書が浮かび、字が体の周りを巡る（持続中ずっと。足元にも字の輪）
// 白（段 7）は頁の縁・閃きだけに使う（字の線は段 6 まで）
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 足元の高さ（キャラは絵で 48 ドット。原点はキャラの中心） */
const FEET_Y = 18;
/** 頭上（浮かぶ書の高さ） */
const HEAD_Y = -38;

// -----------------------------------------------------------------------------
// 共通の部品（書だけで使う）
// -----------------------------------------------------------------------------

/** 振りの進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.2;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/**
 * 頁 1 枚。(x, y) が中心、rot が長辺の向き、hw / hh が長辺・短辺の半分。
 * turn（0..1）で短辺を縮めて「めくれ」を、curl で長辺の中央を反らせる。text で面に文字の行を入れる
 */
function page(frame, o) {
  const { x, y } = o;
  const rot = o.rot ?? 0;
  const hw = o.hw ?? 10;
  const hh = o.hh ?? 7;
  const turn = o.turn ?? 1;
  const curl = o.curl ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const text = o.text ?? true;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const ah = Math.max(0.9, hh * turn);
  const reach = Math.hypot(hw, hh) + Math.abs(curl) + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = dx * cs + dy * sn;
      const v = -dx * sn + dy * cs - curl * (u / hw) * (u / hw);
      const cu = Math.abs(u) / hw;
      const cv = Math.abs(v) / ah;
      if (cu > 1 || cv > 1 || cu + cv > 1.85) return -1;
      if (!survives(px, py, erosion, 1 - Math.max(cu, cv), seed)) return -1;
      // 縁（白）: 短辺の片側と長辺の端
      if (ah - Math.abs(v) < 1.05 && v < 0) return clamp01(bright);
      if (hw - Math.abs(u) < 1 && ah > 2) return clamp01(bright * 0.92);
      let val = 0.6 + 0.2 * (v / ah);
      if (text && ah > 3.6 && Math.abs(u) < hw - 2 && Math.abs(v) < ah - 1.6) {
        const row = Math.floor((v + ah) / 2.6);
        const inRow = (v + ah) - row * 2.6 < 1.15;
        const len = hw * (0.55 + 0.45 * hash1(row, seed));
        if (inRow && u + hw - 2 < len * 2) val *= 0.5;
      }
      return clamp01(val * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach } },
  );
}

/** 字の画（1 = 字の半径。[ax, ay, bx, by]）。読めない「それらしい字」を作る */
const GLYPHS = [
  [[-1, -0.55, 1, -0.55], [0, -1, 0, 1]],
  [[-1, 0, 1, 0], [-0.7, 0.9, 0.7, 0.9], [0, -1, 0, 0]],
  [[-1, -0.8, 1, -0.8], [-1, 0.1, 1, 0.1], [-0.25, -0.8, -0.25, 1]],
  [[-0.8, -1, 0.8, 1], [0.8, -1, -0.8, 1]],
  [[0, -1, 0, 1], [-1, -0.2, 1, -0.2], [-0.8, 1, 0.8, 0.6]],
  [[-1, -1, 1, -1], [-1, -1, -1, 1], [1, -1, 1, 1]],
  [[-0.9, 0.9, 0, -1], [0, -1, 0.9, 0.9], [-0.5, 0.2, 0.5, 0.2]],
];

/** 墨の字 1 つ。rot は字の上の向き、s は半径 */
function glyph(frame, x, y, rot, s, o = {}) {
  const set = GLYPHS[(o.set ?? 0) % GLYPHS.length] ?? GLYPHS[0];
  const width = o.width ?? 1.5;
  const bright = o.bright ?? 0.75;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pad = s * 1.5 + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = (dx * cs + dy * sn) / s;
      const v = (-dx * sn + dy * cs) / s;
      let best = Infinity;
      for (const [ax, ay, bx, by] of set) best = Math.min(best, segment(u, v, ax, ay, bx, by).d);
      if (best * s > width / 2) return -1;
      return clamp01(bright * (1 - 0.3 * ((best * s) / (width / 2))));
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad }, dither: 0 },
  );
}

/** 弧に沿って並ぶ墨の字。from → to の先（to 側）ほど濃い。字の上は外向き */
function glyphArc(frame, o) {
  const { radius, from, to, n } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const bright = o.bright ?? 0.75;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    const a = from + (to - from) * t;
    const b = bright * (o.taper === false ? 1 : 0.35 + 0.65 * t);
    if (b < 0.18) continue;
    const r = radius + (hash1(i, o.seed ?? 3) - 0.5) * (o.jitter ?? 2);
    glyph(frame, ox + Math.cos(a) * r, oy + Math.sin(a) * r, a + Math.PI / 2, o.size ?? 2.4, { set: Math.floor(hash1(i + 9, o.seed ?? 3) * GLYPHS.length), bright: b, width: o.width ?? 1.5 });
  }
}

/** 紙片: shards と同じ散り方で、小さな頁を回しながら飛ばす。spawn(i, rnd) → {x, y, vx, vy, life, size, rot, spin, drag} */
function scraps(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 13 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const drag = s.drag ?? 0.86;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const fade = 1 - age / (s.life + 1);
    const size = (s.size ?? 2.6) * (0.55 + 0.45 * fade);
    page(frame, {
      x: s.x + s.vx * travel,
      y: s.y + s.vy * travel,
      rot: (s.rot ?? 0) + (s.spin ?? 0.5) * age,
      hw: size,
      hh: size * 0.7,
      turn: 0.45 + 0.55 * Math.abs(Math.cos(age * 0.9 + i)),
      bright: 0.55 + 0.45 * fade,
      text: false,
      seed: seed + i,
    });
  }
}

/** 全周へ飛ぶ紙片（中心 x, y から） */
function scrapBurst(frame, age, o) {
  scraps(frame, age, o.n, o.seed, (i, rnd) => {
    const a = (o.center ?? 0) + (rnd(1) - 0.5) * (o.cone ?? TAU);
    const sp = o.speed * (0.5 + rnd(2));
    const r0 = (o.r0 ?? 0) * (0.5 + 0.5 * rnd(6));
    return { x: (o.x ?? 0) + Math.cos(a) * r0, y: (o.y ?? 0) + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life ?? 4) + Math.floor(rnd(3) * 2), size: (o.size ?? 2.6) * (0.8 + 0.5 * rnd(4)), rot: rnd(5) * TAU, spin: (rnd(7) - 0.5) * 1.6, drag: o.drag ?? 0.84 };
  });
}

/** 墨の粒（shards の薄い色版）。放射状 */
function inkDrops(frame, age, o) {
  shards(frame, age, o.n, o.seed, (i, rnd) => {
    const a = (o.center ?? 0) + (rnd(1) - 0.5) * (o.cone ?? TAU);
    const sp = o.speed * (0.4 + rnd(2) * 0.9);
    const r0 = (o.r0 ?? 0) * (0.5 + 0.5 * rnd(6));
    return { x: (o.x ?? 0) + Math.cos(a) * r0, y: (o.y ?? 0) + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life ?? 3) + Math.floor(rnd(3) * 2), size: rnd(4) > 0.55 ? 2 : 1, drag: o.drag ?? 0.8, bright: 0.85 };
  });
}

/** 墨のにじみ（不定形の塊）。r は半径 */
function splat(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.55;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 5;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const rr = r * (0.75 + 0.5 * valueNoise(px, py, 3.2, seed));
      if (d > rr) return -1;
      const q = d / rr;
      if (!survives(px, py, erosion, 1 - q, seed + 3)) return -1;
      return clamp01(bright * (1 - 0.5 * q));
    },
    { bounds: { x0: x - r * 1.4, y0: y - r * 1.4, x1: x + r * 1.4, y1: y + r * 1.4 } },
  );
}

/** 開いた書（上から見る）。(x, y) が背表紙の中心、rot は背表紙に直交する向き。2 枚の頁が背表紙の両側に広がる */
function openBook(frame, o) {
  const { x, y } = o;
  const rot = o.rot ?? 0;
  const s = o.scale ?? 1;
  const hw = 11 * s;
  const hh = 13 * s;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  // 表紙（頁の裏に一回り大きな暗い板）
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = (dx * cs + dy * sn) / (hw * 2 + 3 * s);
      const v = (-dx * sn + dy * cs) / (hh + 2 * s);
      if (Math.abs(u) > 1 || Math.abs(v) > 1) return -1;
      if (!survives(px, py, erosion, 1 - Math.max(Math.abs(u), Math.abs(v)), 61)) return -1;
      return clamp01(0.3 * bright);
    },
    { bounds: { x0: x - hw * 2 - hh - 6, y0: y - hw * 2 - hh - 6, x1: x + hw * 2 + hh + 6, y1: y + hw * 2 + hh + 6 } },
  );
  for (const side of [-1, 1]) {
    page(frame, { x: x + cs * hw * side, y: y + sn * hw * side, rot: rot + Math.PI / 2, hw: hh, hh: hw - 0.5, curl: 1.4 * s * side, bright, erosion, seed: 62 + side });
  }
  // 背表紙の線
  streakLine(frame, { ax: x - sn * hh, ay: y + cs * hh, bx: x + sn * hh, by: y - cs * hh, width: 1.2, bright: 0.5 * bright });
}


// -----------------------------------------------------------------------------
// 万巻（nova 半径 64・3 回当たる・気力を取り戻す）: 頁の大渦
// -----------------------------------------------------------------------------

/** 渦の半径（半径 64 論理 px × 2） */
const LIB_R = 128;
const LIB_N = 13;
const LIB_A = 6;

/** 万巻の発動: 頁が四方から自分へ渦を巻いて集まり、満ちた瞬間に輪が弾ける */
function libraryCast(frame, f) {
  const N = 9;
  const gather = 6;
  if (f < gather) {
    const p = (f + 1) / gather;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + p * 1.6;
      const r = 84 * (1 - p * 0.82) * (0.8 + 0.2 * hash1(i, 3101));
      page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a + Math.PI / 2 + f * 0.6, hw: 8, hh: 5.5, turn: 0.4 + 0.6 * Math.abs(Math.cos(f + i)), curl: 1.2, bright: 0.6 + 0.4 * p, seed: 3110 + i });
    }
    ring(frame, { radius: 60 - 40 * p, width: 2, bright: 0.4 + 0.4 * p, seed: 3102 });
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  ring(frame, { radius: 14 + k * 36, width: 3 - k, erosion: Math.min(0.9, k * 0.8), bright: 0.9 - k * 0.3, seed: 3103 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  scrapBurst(frame, f - gather, { n: 12, seed: 3104, speed: 4, r0: 10, life: 3, size: 3 });
}

/** 万巻の渦: 3 本の腕の頁が渦を巻いて外へ広がり、当たり（f = 1・3・5）ごとに字の輪が脈打つ */
function librarySwirl(frame, f) {
  const A = LIB_A;
  const N = LIB_N;
  const { p, k } = timing(f, A, N);
  const spread = f < A ? p : 1;
  const turn = f * 0.5;
  const pulse = f === 1 || f === 3 || f === 5;
  const count = 36;
  for (let i = 0; i < count; i++) {
    const t = (i % 12) / 12;
    const arm = Math.floor(i / 12);
    const a = turn + t * TAU * 0.9 + (arm / 3) * TAU;
    const r = (14 + (LIB_R - 26) * t) * (0.25 + 0.75 * spread) * (1 + k * 0.18);
    const big = 0.8 + 0.5 * t;
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a + Math.PI / 2 + f * 0.55 + i, hw: 8 * big, hh: 5.6 * big, turn: 0.4 + 0.6 * Math.abs(Math.cos(f * 0.8 + i * 1.7)), curl: 1.3, bright: (pulse ? 1.1 : 0.95) * (1 - k * 0.55), erosion: k * 0.9 + (1 - t) * 0.05, seed: 3201 + i });
  }
  // 外周の字の輪（2 本の弧が逆向きに回る）
  const rr = (LIB_R - 6) * (0.4 + 0.6 * spread);
  glyphArc(frame, { radius: rr, from: turn - 3, to: turn - 0.1, n: 14, size: 3, bright: 0.75 * (1 - k * 0.85), seed: 3220 });
  glyphArc(frame, { radius: rr, from: -turn + Math.PI - 3, to: -turn + Math.PI - 0.1, n: 14, size: 3, bright: 0.75 * (1 - k * 0.85), seed: 3221 });
  if (pulse) {
    ring(frame, { radius: 30 + f * 12, width: 2.6, erosion: 0.1, bright: 0.85, seed: 3230 + f });
    sparkle(frame, 0, 0, 3);
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { radius: LIB_R - 10 + age * 4, width: 2.4 - age * 0.2, erosion: Math.min(0.92, 0.1 + age * 0.13), bright: 0.75 - age * 0.06, seed: 3240 });
    scrapBurst(frame, age, { n: 40, seed: 3241, speed: 6.5, r0: LIB_R * 0.6, life: 5, size: 3.4 });
    inkDrops(frame, age, { n: 26, seed: 3242, speed: 5, r0: LIB_R * 0.6 });
  }
}

/** 万巻の足元の字の陣: 当たりの円の縁・内輪・字の帯。渦と同じフレームで広がり、薄れる */
function libraryGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 7 ? 0 : (f - 6) / (LIB_N - 7);
  const erosion = k * 0.9;
  const dim = 0.42 * (1 - k * 0.4);
  ring(frame, { radius: (LIB_R - 3) * (0.7 + 0.3 * grow), width: 2, erosion, bright: dim, seed: 3251 });
  ring(frame, { radius: LIB_R * 0.6 * grow, width: 1.4, erosion: Math.min(0.95, erosion + 0.1), bright: dim * 0.85, seed: 3252 });
  if (grow < 1 || k >= 0.85) return;
  const r = LIB_R * 0.8;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + f * 0.03;
    glyph(frame, Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, 3.2, { set: Math.floor(hash1(i, 3253) * GLYPHS.length), bright: dim * 1.5 * (1 - k) });
  }
}

/** 気力の回復: 頁と光の粒が足元から舞い上がる（buff） */
function libraryMana(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  ring(frame, { oy: FEET_Y, radius: 10 + f * 3, width: 2.2 - k, squash: 2.2, erosion: Math.min(0.9, k), bright: 0.8 - k * 0.3, seed: 3261 });
  for (let i = 0; i < 9; i++) {
    const d = hash1(i, 3262) * 0.3;
    const t = clamp01((f - d * N) / (N * 0.75));
    if (t <= 0 || t >= 1) continue;
    const x = (hash1(i, 3263) - 0.5) * 60 + Math.sin(t * 5 + i) * 3;
    const y = FEET_Y - t * 76;
    page(frame, { x, y, rot: t * 4 + i, hw: 4, hh: 2.8, turn: 0.4 + 0.6 * Math.abs(Math.cos(t * 7 + i)), bright: 0.9 * Math.sin(Math.PI * t), text: false, seed: 3264 + i });
  }
  if (f === 2) sparkle(frame, 0, FEET_Y - 40, 3);
  if (f === 4) sparkle(frame, -14, FEET_Y - 52, 2);
  shards(frame, f, 14, 3270, (i, rnd) => ({ x: (rnd(1) - 0.5) * 50, y: FEET_Y, vx: 0, vy: -(3 + rnd(2) * 4), life: 4 + Math.floor(rnd(3) * 3), size: 1, drag: 0.92 }));
}

// -----------------------------------------------------------------------------
// 封呪（volley 5 発・扇 12°・貫通）: 呪符の一斉射
// -----------------------------------------------------------------------------

/** 呪符の扇の開き（呪符の間隔の角） */
const SEAL_GAP = 0.3;

/** 封呪の発動: 前で呪符が扇に開き、字の輪が締まる（向きは照準） */
function sealCast(frame, f) {
  const N = 8;
  const open = Math.min(1, (f + 1) / 4);
  const k = f < 4 ? 0 : (f - 3) / (N - 3);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * SEAL_GAP * open;
    const r = 24 + 6 * open;
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, hw: 11, hh: 5.6, turn: 0.5 + 0.5 * open, curl: 0.8 * (i - 2) * 0.4, bright: 0.7 - k * 0.3, erosion: k * 0.85, seed: 3301 + i });
    if (k < 0.6) glyph(frame, Math.cos(a) * r, Math.sin(a) * r, a - Math.PI / 2, 3.2, { set: 3, bright: 1 - k * 0.5, width: 1.7 });
  }
  ring(frame, { ox: 14, radius: 20 - f * 1.5, width: 1.8, squash: 0.5, erosion: k * 0.9, bright: 0.7 * (1 - k * 0.4), seed: 3310 });
  if (f === 3) sparkle(frame, 30, 0, 4);
}

/** 封呪の一斉射（行為）: 5 枚の呪符が扇に走り出す。筋と紙片が後ろへ流れる */
function sealBurst(frame, f) {
  const N = 7;
  const { p, k } = timing(f, 3, N);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * SEAL_GAP * 0.55;
    const r = 26 + 56 * p * (0.85 + 0.15 * hash1(i, 3320));
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, hw: 10, hh: 5, turn: 0.6, curl: 0.6, bright: 1 - k * 0.7, erosion: k * 0.9, seed: 3321 + i });
    if (k < 0.7) {
      streakLine(frame, { ax: Math.cos(a) * (r - 34), ay: Math.sin(a) * (r - 34), bx: Math.cos(a) * (r - 10), by: Math.sin(a) * (r - 10), width: 1, bright: 0.55 * (1 - k) });
    }
  }
  glyphArc(frame, { radius: 30 + 30 * p, from: -0.6, to: 0.6, n: 5, size: 2.6, bright: 0.7 * (1 - k * 0.8), seed: 3330, jitter: 3 });
  if (f === 1) sparkle(frame, 24, 0, 3);
  scrapBurst(frame, f, { n: 10, seed: 3331, speed: 4, x: 14, r0: 4, center: 0, cone: 1.6, life: 4, size: 2.8 });
}

/** 呪符（弾。半径 4 論理 px）: 長い頁に大きな字。後ろに帯がはためく（period で 1 巡） */
function ofudaFly(frame, f) {
  const N = 6;
  const ph = (f / N) * TAU;
  page(frame, { x: 0, y: 0, rot: Math.sin(ph) * 0.12, hw: 10, hh: 5.6, turn: 0.78 + 0.22 * Math.abs(Math.cos(ph)), curl: 0.9 * Math.sin(ph + 1), bright: 0.68, text: false, seed: 3401 });
  glyph(frame, 0, 0, -Math.PI / 2, 3.6, { set: 0, bright: 1, width: 1.7 });
  // 後ろの帯（2 本。波打つ）
  for (const side of [-1, 1]) {
    let px = -11;
    let py = side * 2;
    for (let i = 0; i < 6; i++) {
      const nx = px - 4;
      const ny = side * (2 + i * 0.5) + Math.sin(ph + i * 0.9 + side) * (1.2 + i * 0.35);
      streakLine(frame, { ax: nx, ay: ny, bx: px, by: py, width: 1.2, bright: 0.65 - i * 0.08 });
      px = nx;
      py = ny;
    }
  }
  for (let i = 0; i < 4; i++) dot(frame, -14 - i * 5 - (f % 2) * 2, Math.sin(ph + i) * 1.6, Math.max(2, 5 - i));
}

/** 当たった（貫通しても出る）: 封の輪が一瞬押される。字が浮かび、紙片が散る */
function ofudaHit(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  ring(frame, { radius: 4 + f * 3.4, width: 2.2 - k, squash: 0.6, erosion: Math.min(0.9, k * 0.95), bright: 0.9 - k * 0.4, seed: 3411 });
  if (f <= 3) glyph(frame, 0, 0, -Math.PI / 2, 5.5 - f, { set: 0, bright: 0.9 - f * 0.2, width: 1.7 });
  if (f <= 1) sparkle(frame, 0, 0, 3 - f);
  scrapBurst(frame, f, { n: 6, seed: 3412, speed: 3.4, r0: 2, life: 4, size: 2.6 });
}

/** 消えた（壁）: 呪符が字ごと裂けて散る */
function ofudaImpact(frame, f) {
  ofudaHit(frame, f);
  inkDrops(frame, f, { n: 8, seed: 3421, speed: 3.6, r0: 2 });
}

/** 尽きた: 呪符が折れて薄れる */
function ofudaFizzle(frame, f) {
  const k = f / 5;
  page(frame, { x: 0, y: f * 1.2, rot: 0.4 + f * 0.6, hw: 8 * (1 - k * 0.4), hh: 5, turn: 0.4 + 0.6 * Math.abs(Math.cos(f * 1.2)), bright: 0.9 - k * 0.5, erosion: k * 0.95, text: false, seed: 3431 });
  if (f <= 2) glyph(frame, 0, f * 1.2, -Math.PI / 2, 3, { set: 0, bright: 0.8 - f * 0.25 });
}

// -----------------------------------------------------------------------------
// 朗誦（持続）: 頭上に開いた書が浮かび、字が体の周りを巡る
// -----------------------------------------------------------------------------

/** 朗誦の発動: 書が頭上へ開き、字が螺旋に昇って体の周りの輪になる */
function recitationCast(frame, f) {
  const N = 10;
  const rise = Math.min(1, (f + 1) / 4);
  const k = f < 5 ? 0 : (f - 4) / (N - 4);
  ring(frame, { oy: FEET_Y, radius: 8 + f * 5, width: 2.6 - k * 1.2, squash: 2.2, erosion: Math.min(0.92, k * 0.95), bright: 0.85 - k * 0.3, seed: 3501 });
  openBook(frame, { x: 0, y: HEAD_Y + (1 - rise) * 24, rot: 0, scale: 0.35 + 0.65 * rise, bright: 0.5 + 0.5 * rise });
  // 書から降りて体を巡る字（螺旋）
  for (let i = 0; i < 14; i++) {
    const t = (i / 14 + f * 0.05) % 1;
    const a = t * TAU * 1.5 + i;
    const r = 10 + 30 * t * rise;
    const y = HEAD_Y + 4 + t * 60;
    glyph(frame, Math.cos(a) * r, y + Math.sin(a) * r * 0.32, -Math.PI / 2, 2.6, { set: Math.floor(hash1(i, 3502) * GLYPHS.length), bright: 0.8 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.05)) * (1 - k * 0.5) });
  }
  if (f === 3) sparkle(frame, 0, HEAD_Y, 4);
  scrapBurst(frame, Math.max(0, f - 3), { n: f >= 3 ? 10 : 0, seed: 3503, speed: 3, x: 0, y: HEAD_Y, r0: 8, life: 4, size: 2.8 });
}

/** 朗誦の纏い（持続中ずっと。位相で 1 巡するので継ぎ目が出ない）: 浮かぶ書・巡る字・立ちのぼる墨 */
const REC_N = 12;
function recitationSustain(frame, f) {
  const cycle = f / REC_N;
  const ph = cycle * TAU;
  // 書は上下にゆっくり揺れ、頁が 1 枚めくれる
  const bob = Math.sin(ph) * 1.6;
  openBook(frame, { x: 0, y: HEAD_Y + bob, rot: 0, scale: 0.72 });
  const flip = Math.cos(ph);
  page(frame, { x: 0, y: HEAD_Y + bob - 2, rot: Math.PI / 2, hw: 8, hh: 7, turn: Math.max(0.1, Math.abs(flip)), curl: 1.6 * Math.sign(flip || 1), bright: 0.95, text: false, seed: 3511 });
  // 巡る字（楕円。前後で大きさと明るさが変わる）
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = ph + (i / n) * TAU;
    const depth = Math.sin(a);
    const x = Math.cos(a) * 34;
    const y = 4 + depth * 12;
    glyph(frame, x, y, -Math.PI / 2, 2.6 + depth * 0.5, { set: i, bright: 0.65 + 0.2 * depth, width: 1.6 });
  }
  // 立ちのぼる墨の粒
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 3512)) % 1;
    const x = (hash1(i, 3513) - 0.5) * 60 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y - t * 60;
    if (Math.abs(x) < 9 && y > HEAD_Y - 10 && y < FEET_Y - 4) continue;
    dot(frame, x, y, Math.min(5, Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)))));
  }
  if (f === 3) sparkle(frame, 5, HEAD_Y - 10, 2);
  if (f === 9) sparkle(frame, -6, HEAD_Y - 8, 2);
}

/** 朗誦の足元の字の輪（地面。楕円）。1 巡で 1 周する */
function recitationGround(frame, f) {
  const cycle = f / REC_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 16 + pulse, width: 1.8, squash: 2.2, bright: 0.35 + 0.15 * pulse, seed: 3521 });
  for (let i = 0; i < 8; i++) {
    const a = cycle * TAU + (i / 8) * TAU;
    glyph(frame, Math.cos(a) * 36, FEET_Y + Math.sin(a) * 16, -Math.PI / 2, 2.6, { set: Math.floor(hash1(i, 3522) * GLYPHS.length), bright: 0.4 + 0.12 * pulse, width: 1.5 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 万巻の acts[0] は周囲攻撃（半径 64）、acts[1] は気力の buff。封呪の acts[0] は volley（自分の位置・照準の向き）で、弾は shots[0] の絵が出す
 */
const FX = {
  moveset: "book",
  ultimates: {
    "book.grandLibrary": {
      ramp: "light",
      cast: { sheet: "bookUlt.libraryCast", life: 0.4 },
      acts: [
        { sheet: "bookUlt.library", life: 0.75, base: LIB_R / 2, pivot: "pos", ground: "bookUlt.libraryGround" },
        { sheet: "bookUlt.libraryMana", life: 0.5, base: 0, pivot: "pos" },
      ],
    },
    "book.sealingScript": {
      ramp: "light",
      cast: { sheet: "bookUlt.sealCast", life: 0.35 },
      acts: [{ sheet: "bookUlt.sealBurst", life: 0.4, base: 0, pivot: "pos" }],
      shots: {
        0: { fly: "bookUlt.ofuda", period: 0.18, base: 4, impact: "bookUlt.ofudaImpact", hit: "bookUlt.ofudaHit", fizzle: "bookUlt.ofudaFizzle", ramp: "light" },
      },
    },
    "book.recitation": {
      ramp: "light",
      cast: { sheet: "bookUlt.recitationCast", life: 0.6 },
      sustain: { sheet: "bookUlt.recitation", period: 1.2, ground: "bookUlt.recitationGround" },
    },
  },
};

export const ATLAS = {
  key: "bookUlt",
  fx: FX,
  sheets: [
    { key: "bookUlt.libraryCast", dirs: 1, frames: 9, active: 0, size: 200, draw: libraryCast },
    { key: "bookUlt.library", dirs: 1, frames: LIB_N, active: LIB_A, size: 2 * (LIB_R + 44), draw: librarySwirl },
    { key: "bookUlt.libraryGround", dirs: 1, frames: LIB_N, active: LIB_A, size: 2 * (LIB_R + 10), draw: libraryGround },
    { key: "bookUlt.libraryMana", dirs: 1, frames: 8, active: 0, size: 144, draw: libraryMana },
    { key: "bookUlt.sealCast", dirs: DIRS, frames: 8, active: 0, size: 112, draw: sealCast },
    { key: "bookUlt.sealBurst", dirs: DIRS, frames: 7, active: 3, size: 184, draw: sealBurst },
    { key: "bookUlt.ofuda", dirs: DIRS, frames: 6, active: 0, size: 96, draw: ofudaFly },
    { key: "bookUlt.ofudaHit", dirs: 1, frames: 6, active: 0, size: 48, draw: ofudaHit },
    { key: "bookUlt.ofudaImpact", dirs: 1, frames: 6, active: 0, size: 48, draw: ofudaImpact },
    { key: "bookUlt.ofudaFizzle", dirs: 1, frames: 6, active: 0, size: 40, draw: ofudaFizzle },
    { key: "bookUlt.recitationCast", dirs: 1, frames: 10, active: 0, size: 180, draw: recitationCast },
    { key: "bookUlt.recitation", dirs: 1, frames: REC_N, active: 0, size: 144, draw: recitationSustain },
    { key: "bookUlt.recitationGround", dirs: 1, frames: REC_N, active: 0, size: 112, draw: recitationGround },
  ],
};
