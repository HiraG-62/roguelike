// 書（moveset "book"）のエフェクト。docs/ideas/fx-sprites.md 5・6 章。手本は sword.mjs / wand.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（weapons/WEAPON/movesets/book.json）× 2 が目安
//
// 書の絵の言葉は 3 つ:
//   頁   = 反った紙。回りながら飛び、ひらりと幅が縮む（めくれ）。縁は白く、面に文字の行が入る
//   紙片 = 崩れた頁の切れ端。振り終わりに散る
//   墨   = 弧に沿って並ぶ小さな字と、飛び散る墨の粒
// 刃を使わない。斬撃の三日月ではなく「頁が走った跡」と「字の弧」で振りを見せ、無詠唱（freeCast）と封印の一撃は目立たせる
import { arcLine, crescent, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

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
// 左の段（box reach 12〜14）: 頁が走る
// -----------------------------------------------------------------------------

/** 頁の振り（左 1・2 段）。頁が弧を走り、残像の頁と字の弧が跡を引く。振り終わりは崩れて紙片になる */
const SWING1 = { R: 34, sweep: 120, tilt: 0, frames: 7, active: 3, hw: 9, hh: 6.5, glyphs: 6, seed: 1101 };
const SWING2 = { R: 36, sweep: 132, tilt: 8, frames: 7, active: 3, hw: 10, hh: 7, glyphs: 7, seed: 1201 };

function pageSwing(frame, f, spec) {
  const { R, frames: N, active: A, seed } = spec;
  const half = (spec.sweep * Math.PI) / 360;
  const from = -half + (spec.tilt * Math.PI) / 180;
  const sweep = half * 2;
  const { p, k } = timing(f, A, N);
  const head = from + sweep * (f < A ? p : 1 + 0.05 * k);
  const tail = from + sweep * (f < A ? Math.max(0, p - 0.85) * 0.5 : Math.min(0.95, 0.4 + 0.6 * k));
  // 面を打つ弧: 薄い紙の切れ目のような細い三日月（頁の通り道）
  crescent(frame, { R, T: 6 * (1 - k * 0.4), head, tail, erosion: k * 0.9, bright: 0.7 - k * 0.2, seed, streak: 0.5, edge: 1.2 });
  // 字の弧: 先端の後ろに墨の字が並ぶ
  if (k < 0.75) glyphArc(frame, { radius: R - 8, from: tail + (head - tail) * 0.05, to: head - 0.06, n: spec.glyphs, size: 2.3, bright: 0.72 * (1 - k * 0.8), seed: seed + 5 });
  // 先頭の頁と残像の頁
  const ghosts = f < A ? [0, 1, 2] : [0];
  for (const g of ghosts) {
    const a = head - g * sweep * 0.13;
    if (a < from - 0.02) continue;
    const r = R - 9 - g * 1.5;
    page(frame, {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      rot: a + Math.PI / 2 + (f + g) * 0.35 * (f < A ? 1 : 1 + k * 2),
      hw: spec.hw * (1 - g * 0.12),
      hh: spec.hh * (1 - g * 0.1),
      turn: 0.45 + 0.55 * Math.abs(Math.cos((f + g) * 1.15)),
      curl: 1.6,
      bright: (1 - g * 0.2) * (1 - k * 0.4),
      erosion: g * 0.28 + k * 0.7,
      seed: seed + g,
    });
  }
  if (f >= A - 1) scrapBurst(frame, f - (A - 1), { n: 9, seed: seed + 30, speed: 3.6, x: Math.cos(head) * (R - 9), y: Math.sin(head) * (R - 9), r0: 4, center: head + 0.5, cone: 2.4, life: 4, size: 2.8 });
  if (f === A - 1) sparkle(frame, Math.cos(head) * (R - 4), Math.sin(head) * (R - 4), 3);
  arcLine(frame, { radius: R + 2, from: head - (head - tail) * 0.6, to: head - 0.05, bright: 0.5 * (1 - k) });
}

/** 左 3 段（終撃）: 書を閉じる。2 枚の頁が前で V 字に閉じ、閉じきった所で音の輪と紙片が弾ける（box reach 14 / size 14） */
function bookClap(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const hinge = 10;
  const L = 15;
  const open = (1 - p) * 1.25 + 0.1;
  if (f < A + 2) {
    for (const side of [-1, 1]) {
      const a = side * open;
      page(frame, { x: hinge + Math.cos(a) * L, y: Math.sin(a) * L, rot: a, hw: L, hh: 9, turn: 1, curl: -1.6 * side, bright: 0.95 - k * 0.3, erosion: k * 0.5, seed: 1301 + side });
    }
  } else {
    // 閉じた後: 重なった頁がめくれてほどける
    for (const side of [-1, 1]) {
      const a = side * (0.1 + k * 0.5);
      page(frame, { x: hinge + Math.cos(a) * L, y: Math.sin(a) * L, rot: a, hw: L, hh: 9 * (1 - k * 0.3), curl: -1.6 * side, bright: 0.85 - k * 0.4, erosion: 0.2 + k * 0.75, seed: 1301 + side });
    }
  }
  // 閉じる勢いの空気の筋
  if (f < A) {
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 8;
      streakLine(frame, { ax: hinge + 6, ay: y, bx: hinge + 6 + 22 * p, by: y * (1 - p * 0.6), width: 1, bright: 0.5 * (0.5 + p) });
    }
  }
  const tipX = hinge + L * 1.85;
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { ox: tipX - 4, radius: 5 + age * 5, width: 2.6 - age * 0.3, squash: 0.5, erosion: Math.min(0.9, age * 0.2), bright: 0.9 - age * 0.1, seed: 1310 });
    if (age >= 1) ring(frame, { ox: tipX - 10, radius: 3 + age * 4.2, width: 1.6, squash: 0.5, erosion: Math.min(0.9, age * 0.22), bright: 0.65 - age * 0.06, seed: 1311 });
    scrapBurst(frame, age, { n: 12, seed: 1312, speed: 4.2, x: tipX - 6, r0: 3, center: 0, cone: 3.4, life: 4, size: 3 });
    inkDrops(frame, age, { n: 9, seed: 1313, speed: 3.6, x: tipX - 6, center: 0, cone: 3.2 });
  }
  if (f === A - 1) sparkle(frame, tipX - 3, 0, 4);
  if (f === A) sparkle(frame, tipX - 3, 0, 3);
}

// -----------------------------------------------------------------------------
// ダッシュ攻撃（circle 36）: 頁の渦をまとって駆け抜ける
// -----------------------------------------------------------------------------

/** 頁が体の周りを 1 周半回りながら広がり、後ろへ空気の筋と紙片を置いていく */
function pageWhirl(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const turn = p * TAU * 1.1 + k * 1.1;
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * TAU;
    const r = (14 + 14 * p + (i % 2) * 5) * (1 + k * 0.25);
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a + Math.PI / 2 + f * 0.5, hw: 8.5, hh: 6, turn: 0.4 + 0.6 * Math.abs(Math.cos(f * 0.9 + i * 1.7)), curl: 1.4, bright: 1 - k * 0.5, erosion: k * 0.8 + (i % 3) * 0.06, seed: 1401 + i });
  }
  glyphArc(frame, { radius: 33, from: turn - 2.6, to: turn - 0.1, n: 8, size: 2.3, bright: 0.7 * (1 - k * 0.8), seed: 1420 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 6 + (hash1(i, 1421) - 0.5) * 3;
      const x1 = -18 - Math.abs(y) * 0.6 - k * 14 - hash1(i, 1422) * 8;
      streakLine(frame, { ax: x1 - 20 - hash1(i, 1423) * 16, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  scraps(frame, f, 7, 1424, (i, rnd) => ({ x: -10 - rnd(1) * 10, y: (rnd(2) - 0.5) * 30, vx: -2.5 - rnd(3) * 3, vy: (rnd(4) - 0.5) * 2, life: 5, size: 2.6, rot: rnd(5) * TAU, spin: 0.4 }));
  if (f === A - 1) sparkle(frame, 28, 0, 3);
}

// -----------------------------------------------------------------------------
// 右の段
// -----------------------------------------------------------------------------

/** 右: 無詠唱（circle 32）。目立つ絵: 字の輪が開き、四方へ頁が走り、中心で閃く */
function freeCast(frame, f) {
  const N = 9;
  const A = 4;
  const { k } = timing(f, A, N);
  const grow = Math.min(1, (f + 1) / 3);
  const R = 30 * (0.35 + 0.65 * grow);
  const turn = f * 0.16;
  const dim = 1 - k * 0.55;
  ring(frame, { radius: R, width: 2.2, erosion: k * 0.85, bright: 0.85 * dim, seed: 1501 });
  ring(frame, { radius: R * 0.74, width: 1.4, erosion: Math.min(0.9, k * 0.9 + 0.05), bright: 0.6 * dim, seed: 1502 });
  // 字の輪（2 つの輪の間）
  if (grow > 0.5 && k < 0.8) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * TAU;
      const r = R * 0.87;
      glyph(frame, Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, 2.6, { set: Math.floor(hash1(i, 1503) * GLYPHS.length), bright: 0.8 * dim });
    }
  }
  // 四方へ走る頁
  if (f >= 1 && k < 0.9) {
    const reach = Math.min(1, f / 3);
    for (let i = 0; i < 4; i++) {
      const a = turn * 0.5 + (i / 4) * TAU + Math.PI / 4;
      const r = 8 + 20 * reach + k * 10;
      page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, hw: 7, hh: 4.6, turn: 0.5 + 0.5 * Math.abs(Math.cos(f + i)), curl: 1, bright: 1 - k * 0.6, erosion: k * 0.8, seed: 1504 + i });
    }
  }
  // 中心の閃き
  if (f >= A - 2 && f <= A) {
    sparkle(frame, 0, 0, f === A - 1 ? 4 : 3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      sparkle(frame, Math.cos(a) * (R + 2), Math.sin(a) * (R + 2), 2);
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { radius: R + 4 + age * 6, width: 2.4 - age * 0.25, erosion: Math.min(0.92, 0.15 + age * 0.16), bright: 0.8 - age * 0.07, seed: 1505 });
    scrapBurst(frame, age, { n: 14, seed: 1506, speed: 4.6, r0: R * 0.5, life: 5, size: 3 });
    inkDrops(frame, age, { n: 10, seed: 1507, speed: 4, r0: R * 0.5 });
  }
}

/** 右: 頁払い（arc 140° reach 16）。頁が扇に開き、外縁に字の弧が走る */
function pageFan(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const half = (140 * Math.PI) / 360;
  const n = 6;
  const head = -half + half * 2 * (f < A ? p : 1);
  for (let i = 0; i < n; i++) {
    const a = -half + (i / (n - 1)) * half * 2;
    const born = a <= head + 0.02;
    if (!born) continue;
    const open = Math.min(1, (head - a) / 0.5 + 0.35);
    const fall = clamp01(k * 1.3 - i * 0.05);
    const r = 20 + fall * 5;
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, hw: 12, hh: 5.2, turn: open * (0.55 + 0.45 * Math.abs(Math.cos(f * 0.8 + i))), curl: 1.4 * (i % 2 ? 1 : -1), bright: 1 - fall * 0.6, erosion: fall * 0.85, seed: 1601 + i });
  }
  glyphArc(frame, { radius: 36, from: -half, to: head - 0.02, n: 8, size: 2.4, bright: 0.72 * (1 - k * 0.9), seed: 1610 });
  arcLine(frame, { radius: 39, from: -half + 0.2, to: head, bright: 0.5 * (1 - k) });
  if (f >= A - 1) scrapBurst(frame, f - (A - 1), { n: 9, seed: 1620, speed: 3.4, x: Math.cos(half) * 30, y: Math.sin(half) * 30, r0: 3, center: half + 0.6, cone: 2, life: 4, size: 2.8 });
  if (f === A - 1) sparkle(frame, Math.cos(head) * 34, Math.sin(head) * 34, 3);
}

/** 右: 書叩き（box reach 14 / size 14）。開いた書を叩きつける。着地で音の輪・紙片・墨が弾ける */
function bookSlam(frame, f) {
  const N = 9;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const cx = 30;
  if (f < A) {
    // 振り上げた書が奥から迫る（大きく、明るくなる）
    openBook(frame, { x: cx - (1 - p) * 4, y: 0, rot: 0, scale: 0.7 + 0.6 * p, bright: 0.6 + 0.4 * p });
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 9;
      streakLine(frame, { ax: cx - 22, ay: y, bx: cx - 10 + p * 4, by: y, bright: 0.4 + 0.3 * p });
    }
  } else {
    openBook(frame, { x: cx, y: 0, rot: 0, scale: 1 - k * 0.05, bright: 1 - k * 0.55, erosion: k * 0.85 });
    const age = f - A;
    ring(frame, { ox: cx, radius: 10 + age * 6, width: 3 - age * 0.35, squash: 0.55, erosion: Math.min(0.9, age * 0.17), bright: 0.9 - age * 0.08, seed: 1701 });
    if (age >= 1) ring(frame, { ox: cx, radius: 6 + age * 4.4, width: 1.8, squash: 0.55, erosion: Math.min(0.92, age * 0.2), bright: 0.65 - age * 0.06, seed: 1702 });
    splat(frame, cx, 0, 10 - age * 1.2, { bright: 0.45 - age * 0.05, erosion: k * 0.8, seed: 1703 });
  }
  if (f >= A) {
    const age = f - A;
    scrapBurst(frame, age, { n: 16, seed: 1710, speed: 5, x: cx, r0: 6, life: 5, size: 3.2 });
    inkDrops(frame, age, { n: 12, seed: 1711, speed: 4.4, x: cx, r0: 5 });
  }
  if (f === A) {
    sparkle(frame, cx, 0, 4);
    for (let i = 0; i < 4; i++) sparkle(frame, cx + Math.cos((i / 4) * TAU + 0.4) * 14, Math.sin((i / 4) * TAU + 0.4) * 14, 2);
  }
}

// -----------------------------------------------------------------------------
// 派生
// -----------------------------------------------------------------------------

/** 派生: 頁の嵐（circle 48・3 回当たる）。頁の竜巻が周りを回り、3 回の当たりで輪が弾ける */
function pageStorm(frame, f) {
  const N = 12;
  const A = 8;
  const { k } = timing(f, A, N);
  const pulse = f === 1 || f === 4 || f === 6;
  const turn = f * 0.62;
  const count = 15;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const a = turn * (1 + (i % 3) * 0.12) + t * TAU * 2.2;
    const r = (12 + 32 * t) * (1 + k * 0.28);
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.92, rot: a + Math.PI / 2 + f * 0.6, hw: 6 + 3.5 * t, hh: 4.2 + 2.2 * t, turn: 0.4 + 0.6 * Math.abs(Math.cos(f * 0.85 + i * 1.3)), curl: 1.2, bright: (pulse ? 1.1 : 0.95) * (1 - k * 0.55), erosion: k * 0.85, seed: 1801 + i });
  }
  glyphArc(frame, { radius: 47, from: turn - 3.6, to: turn - 0.1, n: 12, size: 2.4, bright: 0.72 * (1 - k * 0.8), seed: 1820 });
  glyphArc(frame, { radius: 47, from: turn - 3.6 + Math.PI, to: turn - 0.1 + Math.PI, n: 12, size: 2.4, bright: 0.72 * (1 - k * 0.8), seed: 1821 });
  if (pulse) {
    const age = f === 1 ? 0 : f === 4 ? 0 : 0;
    ring(frame, { radius: 22 + age, width: 2.2, bright: 0.85, seed: 1830 + f });
    sparkle(frame, 0, 0, 3);
  }
  ring(frame, { radius: 28 + f * 2.2, width: 1.4, erosion: Math.min(0.9, 0.3 + k), bright: 0.45 * (1 - k * 0.6), seed: 1831 });
  if (f >= A - 1) scrapBurst(frame, f - (A - 1), { n: 18, seed: 1840, speed: 5, r0: 36, life: 5, size: 3 });
}

/** 派生: 封印の一撃（box reach 14 / size 14・沈黙）。判が押され、輪と四角の封の紋が焼きつく */
function sealStrike(frame, f) {
  const N = 9;
  const A = 4;
  const { k } = timing(f, A, N);
  const cx = 30;
  const press = f < 3 ? 1.7 - 0.7 * ((f + 1) / 3) : 1;
  const R = 13 * press;
  const glow = f < A ? 0.7 + 0.3 * (f / (A - 1)) : 1 - k * 0.55;
  const erosion = f < A ? 0 : k * 0.85;
  // 押される前に飛んでくる頁と筋
  if (f < 3) {
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * 10;
      page(frame, { x: cx - 26 + f * 8 + i * 3, y: y * (1 - f * 0.25), rot: 0.2 * (i - 1), hw: 8, hh: 5, turn: 0.6, curl: 1, bright: 0.8, seed: 1901 + i });
    }
  }
  ring(frame, { ox: cx, radius: R, width: 2.6, erosion, bright: 0.95 * glow, seed: 1910 });
  ring(frame, { ox: cx, radius: R * 0.72, width: 1.4, erosion, bright: 0.65 * glow, seed: 1911 });
  // 四角（45° 回した正方形）と中心の字
  const sq = R * 0.72;
  for (let i = 0; i < 4; i++) {
    const a0 = Math.PI / 4 + (i / 4) * TAU;
    const a1 = a0 + Math.PI / 2;
    if (erosion > 0.55 && i % 2) continue;
    streakLine(frame, { ax: cx + Math.cos(a0) * sq, ay: Math.sin(a0) * sq, bx: cx + Math.cos(a1) * sq, by: Math.sin(a1) * sq, width: 1.4, bright: 0.7 * glow * (1 - erosion * 0.4) });
  }
  if (erosion < 0.7) glyph(frame, cx, 0, -Math.PI / 2, R * 0.42, { set: 0, bright: 0.95 * glow, width: 1.8 });
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { ox: cx, radius: R + 4 + age * 5, width: 2 - age * 0.2, erosion: Math.min(0.92, 0.2 + age * 0.17), bright: 0.7 - age * 0.06, seed: 1912 });
    inkDrops(frame, age, { n: 14, seed: 1913, speed: 4.4, x: cx, r0: R * 0.6 });
    scrapBurst(frame, age, { n: 7, seed: 1914, speed: 3.6, x: cx, r0: R * 0.6, life: 4, size: 2.6 });
  }
  if (f === A - 1) sparkle(frame, cx, 0, 4);
  if (f === A) {
    for (let i = 0; i < 4; i++) sparkle(frame, cx + Math.cos((i / 4) * TAU) * R, Math.sin((i / 4) * TAU) * R, 2);
  }
}

/** 派生: 頁返し（circle 32・前へ踏み込む）。大きな頁が前でめくれ、後ろへ残像の頁と筋が流れる */
function pageTurnFx(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const prog = f < A ? p : 1;
  const flip = Math.cos(prog * Math.PI);
  const cx = 6 + 14 * prog;
  // 残像の頁（踏み込みの軌跡）
  for (const g of [3, 2, 1]) {
    if (f < g - 1 || k > 0.7) continue;
    const gp = Math.max(0, prog - g * 0.2);
    page(frame, { x: 6 + 14 * gp - g * 5, y: 0, rot: 0, hw: 13, hh: 14, turn: Math.max(0.12, Math.abs(Math.cos(gp * Math.PI))), curl: 2 * Math.sign(Math.cos(gp * Math.PI) || 1), bright: 0.5 - g * 0.08, erosion: 0.25 + g * 0.2 + k * 0.4, seed: 2001 + g, text: false });
  }
  page(frame, { x: cx, y: 0, rot: 0, hw: 14, hh: 15, turn: Math.max(0.1, Math.abs(flip)), curl: 2.2 * Math.sign(flip || 1), bright: (flip < 0 ? 0.8 : 1) * (1 - k * 0.5), erosion: k * 0.8, seed: 2001 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 6 + (hash1(i, 2010) - 0.5) * 3;
      const x1 = cx - 16 - Math.abs(y) * 0.4 - k * 16 - hash1(i, 2011) * 6;
      streakLine(frame, { ax: x1 - 18 - hash1(i, 2012) * 14, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { ox: cx + 8, radius: 8 + age * 6, width: 2.2, squash: 0.5, erosion: Math.min(0.9, age * 0.2), bright: 0.75 - age * 0.07, seed: 2013 });
    scrapBurst(frame, age, { n: 10, seed: 2014, speed: 4, x: cx + 6, r0: 8, center: 0, cone: 3, life: 4, size: 2.8 });
  }
  if (f === A - 1) sparkle(frame, cx + 10, 0, 3);
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 頁の切れ味。進む向きへ紙片が飛び、墨がはねて、字が一瞬浮かぶ。heavy は輪と字が増える */
function pageHit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const s = heavy ? 1.35 : 1;
  if (f <= 2) splat(frame, 0, 0, (heavy ? 8 : 5.5) * (f === 0 ? 0.6 : 1), { bright: 0.5, seed: 2101, erosion: f * 0.25 });
  if (f >= 1 && f <= 3) glyph(frame, 0, 0, -Math.PI / 2 + 0.3, (heavy ? 7 : 5) * (f === 1 ? 1 : 0.85), { set: heavy ? 3 : 0, bright: 0.9 - (f - 1) * 0.2, width: heavy ? 2 : 1.6 });
  if (f <= 1) streakLine(frame, { ax: -10 * s, ay: 0, bx: 12 * s, by: 0, width: 1.2, bright: 0.8 });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 7 + age * 5, width: 2.4 - age * 0.2, erosion: Math.min(0.9, age * 0.16), bright: 0.8 - age * 0.07, seed: 2102 });
  }
  if (f >= 1) {
    scrapBurst(frame, f - 1, { n: heavy ? 10 : 6, seed: 2103, speed: (heavy ? 5 : 3.8), center: 0, cone: 2.6, life: 4, size: heavy ? 3.4 : 2.8 });
    inkDrops(frame, f - 1, { n: heavy ? 10 : 6, seed: 2104, speed: 3.6, center: 0, cone: 4 });
  }
  void k;
}

// -----------------------------------------------------------------------------
// 弾: 飛び頁（cast.flyingPage）
// -----------------------------------------------------------------------------

/** 飛んでいる頁: めくれながら進み、墨の粒と切れ端を後ろへ引く（period で 1 巡） */
function flyPage(frame, f) {
  const N = 6;
  const ph = (f / N) * TAU;
  const turn = 0.4 + 0.6 * Math.abs(Math.cos(ph));
  page(frame, { x: 0, y: 0, rot: Math.sin(ph) * 0.35, hw: 6.5, hh: 4.6, turn, curl: 1.1 * Math.sin(ph + 1), bright: 1, seed: 2201 });
  for (let i = 0; i < 6; i++) {
    const x = -9 - i * 3.6;
    const wob = Math.sin(ph + i * 0.9) * 1.6;
    dot(frame, x, wob, Math.max(2, 5 - Math.floor(i / 1.6)));
  }
  streakLine(frame, { ax: -30, ay: 0, bx: -8, by: 0, width: 1, bright: 0.4 });
  const cut = (f % 3) * 4;
  page(frame, { x: -16 - cut, y: Math.sin(ph * 2) * 3, rot: ph, hw: 2.2, hh: 1.5, turn: 0.7, bright: 0.6, text: false, seed: 2202 });
}

/** 撃った瞬間: 手元で頁が扇に開き、前へ弾かれる */
function pageMuzzle(frame, f) {
  const k = f / 4;
  for (const [i, a] of [-0.5, 0, 0.5].entries()) {
    const r = 6 + f * 4;
    page(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, rot: a, hw: 6 - k * 1.5, hh: 4, turn: 0.6 + 0.4 * Math.abs(Math.cos(f + i)), curl: 1, bright: 0.95 - k * 0.5, erosion: k * 0.8, seed: 2210 + i });
  }
  if (f <= 1) sparkle(frame, 4, 0, 2);
  inkDrops(frame, f, { n: 5, seed: 2214, speed: 3.4, center: 0, cone: 1.6 });
}

/** 当たった: 頁が裂けて紙片と墨が散る */
function pageImpact(frame, f) {
  splat(frame, 0, 0, f < 2 ? 4 : 2.5, { bright: 0.45, seed: 2221, erosion: f * 0.25 });
  if (f <= 1) sparkle(frame, 0, 0, 3 - f);
  scrapBurst(frame, f, { n: 8, seed: 2222, speed: 3.6, r0: 2, life: 4, size: 2.6 });
  inkDrops(frame, f, { n: 6, seed: 2223, speed: 3, r0: 2 });
}

/** 尽きた: 頁がひらりと落ちて薄れる */
function pageFizzle(frame, f) {
  const k = f / 5;
  page(frame, { x: 0, y: f * 1.2, rot: 0.3 + f * 0.5, hw: 6 * (1 - k * 0.3), hh: 4.4, turn: 0.4 + 0.6 * Math.abs(Math.cos(f * 1.2)), curl: 1, bright: 0.85 - k * 0.5, erosion: k * 0.95, seed: 2231 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 左の段・右の段・派生の当たり判定（box は reach、circle は size で測る）に絵の外縁を合わせる
 */
const FX = {
  moveset: "book",
  motions: {
    "l:0": { sheet: "book.l1", pivot: "self", base: 12, measure: "reach" },
    "l:1": { sheet: "book.l2", pivot: "self", base: 12, measure: "reach" },
    "l:2": { sheet: "book.l3", pivot: "self", base: 14, measure: "reach" },
    dash: { sheet: "book.dash", pivot: "self", base: 36, measure: "size" },
    "r:freeCast": { sheet: "book.freeCast", pivot: "self", base: 32, measure: "size" },
    "r:pageSweep": { sheet: "book.pageSweep", pivot: "self", base: 16, measure: "reach" },
    "r:bookSlam": { sheet: "book.bookSlam", pivot: "self", base: 14, measure: "reach" },
    "branch:pageStorm": { sheet: "book.pageStorm", pivot: "self", base: 48, measure: "size" },
    "branch:sealStrike": { sheet: "book.sealStrike", pivot: "self", base: 14, measure: "reach" },
    "branch:pageTurn": { sheet: "book.pageTurn", pivot: "self", base: 32, measure: "size" },
  },
  hit: "book.hit",
  hitHeavy: "book.hitHeavy",
  bullets: {
    "cast.flyingPage": { fly: "book.flyPage", period: 0.18, base: 3, muzzle: "book.pageMuzzle", impact: "book.pageImpact", fizzle: "book.pageFizzle", ramp: "brass" },
  },
};

export const ATLAS = {
  key: "book",
  fx: FX,
  sheets: [
    { key: "book.l1", dirs: DIRS, frames: SWING1.frames, active: SWING1.active, size: 100, draw: (fr, f) => pageSwing(fr, f, SWING1) },
    { key: "book.l2", dirs: DIRS, frames: SWING2.frames, active: SWING2.active, size: 104, draw: (fr, f) => pageSwing(fr, f, SWING2) },
    { key: "book.l3", dirs: DIRS, frames: 8, active: 4, size: 112, draw: bookClap },
    { key: "book.dash", dirs: DIRS, frames: 8, active: 4, size: 136, draw: pageWhirl },
    { key: "book.freeCast", dirs: 1, frames: 9, active: 4, size: 128, draw: freeCast },
    { key: "book.pageSweep", dirs: DIRS, frames: 8, active: 4, size: 112, draw: pageFan },
    { key: "book.bookSlam", dirs: DIRS, frames: 9, active: 4, size: 132, draw: bookSlam },
    { key: "book.pageStorm", dirs: 1, frames: 12, active: 8, size: 172, draw: pageStorm },
    { key: "book.sealStrike", dirs: DIRS, frames: 9, active: 4, size: 112, draw: sealStrike },
    { key: "book.pageTurn", dirs: DIRS, frames: 8, active: 4, size: 112, draw: pageTurnFx },
    { key: "book.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (fr, f) => pageHit(fr, f, false) },
    { key: "book.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (fr, f) => pageHit(fr, f, true) },
    { key: "book.flyPage", dirs: DIRS, frames: 6, active: 0, size: 64, draw: flyPage },
    { key: "book.pageMuzzle", dirs: DIRS, frames: 5, active: 0, size: 48, draw: pageMuzzle },
    { key: "book.pageImpact", dirs: 1, frames: 6, active: 0, size: 48, draw: pageImpact },
    { key: "book.pageFizzle", dirs: 1, frames: 6, active: 0, size: 32, draw: pageFizzle },
  ],
};
