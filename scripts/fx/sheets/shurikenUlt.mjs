// 手裏剣の奥義（アトラス shurikenUlt）。docs/ideas/fx-sprites.md 9.2・docs/ideas/gun-bases-review.md 2-9
// 単位は絵のドット（論理 0.5px）。原点 = 自分の中心、足元は FEET_Y
//
// 八方手裏剣（一撃・全周へ 16 本）: 発動は 16 本の刻みが体へ締まり、行為で全周へ 16 本の投げ筋が一斉に開く。
//   飛ぶ手裏剣は手裏剣の弾の絵（shuriken.mjs の cast.starToss。BULLET_FX から引く）
// 大車輪（一撃・巨大な手裏剣が周りを 2 周）: 発動は頭上に大きな星が回り出し、行為で回る道（半径 36 の輪）に風が走る。
//   飛ぶ大手裏剣は専用の弾の絵（shots 0。半径 10 で描くので拡縮しない）
// 龍刃（持続・刀を抜いて左右とも斬り）: 振りの絵は刀（katana.mjs）を借りる（ultimateMoveset が武器種の key を katana に替えるので、
//   装備のアトラスも刀に替わる）。ここでは発動（抜刀の一閃と昇る龍の筆）と纏い（体を巡る龍の帯）だけを描く
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const FEET_Y = 18;
const GROUND_SQUASH = 2.2;

/** 崩れの判定（shapes.mjs の survives と同じ考え） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 四方の星（shuriken.mjs の star と同じ形。アトラスは 1 ファイルで完結させるので写して持つ） */
function star(frame, o) {
  const { x = 0, y = 0, r, rot = 0 } = o;
  const points = o.points ?? 4;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 61;
  const hole = o.hole ?? 0.2;
  const sector = TAU / points;
  const inner = r * 0.3;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      if (d > r || d < r * hole) return -1;
      let a = (Math.atan2(dy, dx) - rot) % sector;
      if (a < 0) a += sector;
      const off = a - sector / 2;
      const u = Math.abs(off) / (sector / 2);
      const edge = inner + (r - inner) * u ** 2.2;
      if (d > edge) return -1;
      if (!survives(px, py, erosion, 1 - d / r, seed)) return -1;
      const face = off > 0 ? 0.95 : 0.7;
      return clamp01(face * (1 - 0.25 * (d / r)) * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 外周（半径 R・中心 (ox, oy)）を回る n 本の短い弧。rot で回し、先頭ほど明るい */
function spinWind(frame, o) {
  const { R, rot, n } = o;
  const len = o.len ?? 55 * DEG;
  for (let i = 0; i < n; i++) {
    const head = rot + (i * TAU) / n;
    arcLine(frame, { ox: o.ox ?? 0, oy: o.oy ?? 0, radius: R, from: head - len, to: head, width: o.width ?? 1.1, bright: o.bright ?? 0.6 });
  }
}

/**
 * 太さの変わる帯（筆の一筆）: 点列 pts（{x, y, w, v}）を結ぶ。w = 半幅、v = 明るさ。
 * 点と点の間は線形に補い、縁ほど暗い
 */
function ribbon(frame, pts, o = {}) {
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 71;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x - p.w);
    y0 = Math.min(y0, p.y - p.w);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.w);
  }
  paint(
    frame,
    (px, py) => {
      let best = -1;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? clamp01(((px - a.x) * dx + (py - a.y) * dy) / len2) : 0;
        const d = Math.hypot(a.x + dx * t - px, a.y + dy * t - py);
        const w = a.w + (b.w - a.w) * t;
        if (d > w || w < 0.5) continue;
        const q = d / w;
        if (!survives(px, py, erosion, 1 - q, seed)) continue;
        const v = (a.v + (b.v - a.v) * t) * (1 - 0.45 * q);
        if (v > best) best = v;
      }
      return best < 0 ? -1 : clamp01(best);
    },
    { bounds: { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 } },
  );
}

// -----------------------------------------------------------------------------
// 八方手裏剣
// -----------------------------------------------------------------------------

const EIGHT_COUNT = 16;

/** 八方手裏剣の発動: 全周の 16 本の短い刻みが体へ締まり、胸元で小さな星が光る */
function eightCast(frame, f) {
  const N = 9;
  const gather = 5;
  if (f < gather) {
    const p = easeSwing((f + 1) / gather);
    const r1 = 48 - 30 * p;
    for (let i = 0; i < EIGHT_COUNT; i++) {
      const a = (i / EIGHT_COUNT) * TAU;
      streakLine(frame, { ax: Math.cos(a) * (r1 + 7), ay: Math.sin(a) * (r1 + 7), bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: 1.2, bright: 0.5 + 0.4 * p });
    }
    return;
  }
  const age = f - gather;
  const k = age / (N - gather - 1);
  star(frame, { r: 9 - age, rot: age * 20 * DEG, hole: 0.25, bright: 1 - k * 0.4, erosion: Math.max(0, k - 0.5) * 2, seed: 7101 });
  if (age === 0) sparkle(frame, 0, 0, 4);
  ring(frame, { radius: 10 + age * 6, width: 1.6, erosion: Math.min(0.92, k * 0.9), bright: 0.7 - k * 0.3, seed: 7102 });
}

/** 八方手裏剣の投げ筋の届き */
const EIGHT_R = 96;

/** 八方手裏剣: 全周へ 16 本の細い投げ筋が一斉に開き、先頭に小さな星が灯る。中心から輪が 1 枚広がる */
function eight(frame, f) {
  const N = 9;
  const A = 3;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  for (let i = 0; i < EIGHT_COUNT; i++) {
    const a = (i / EIGHT_COUNT) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const head = 16 + (EIGHT_R - 16) * p + k * 10;
    const tail = 8 + k * (head - 14);
    lens(frame, { ax: c * tail, ay: s * tail, bx: c * head, by: s * head, T: 3.4 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 7201 + i, bright: 0.95 - k * 0.2 });
    if (f === A - 1) star(frame, { x: c * head, y: s * head, r: 4, rot: a, hole: 0.3, seed: 7230 + i });
  }
  if (f <= 1) sparkle(frame, 0, 0, 4 - f);
  ring(frame, { radius: 10 + f * 7, width: 2 - k, erosion: Math.min(0.92, f * 0.12), bright: 0.75 - f * 0.07, seed: 7250 });
}

// -----------------------------------------------------------------------------
// 大車輪
// -----------------------------------------------------------------------------

/** 回る道の半径（orbit.radius 36 論理 px × 2） */
const WHEEL_ORBIT = 72;

/** 大車輪の発動: 頭上に大きな星が回り出し（外周に風の弧）、回りながら膨らんで光る */
function wheelCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const g = easeSwing(Math.min(1, (f + 1) / 5));
  const rot = f * 32 * DEG;
  const r = 8 + 14 * g;
  star(frame, { y: -34, r, rot, hole: 0.18, bright: 1 - Math.max(0, k - 0.7) * 1.5, erosion: Math.max(0, k - 0.75) * 3, seed: 7301 });
  spinWind(frame, { oy: -34, R: r + 4, rot, n: 4, len: 60 * DEG, bright: 0.65 });
  if (f === 5) sparkle(frame, 0, -34, 4);
  ring(frame, { oy: FEET_Y, radius: 10 + f * 2, width: 1.6, squash: GROUND_SQUASH, erosion: Math.max(0, k - 0.5) * 1.8, bright: 0.5, seed: 7302 });
}

/**
 * 大車輪: 回る道（半径 36）に沿って 4 本の太い風の弧が回りながら広がって走り、道の縁が細い輪で灯る。
 * 大手裏剣そのものは弾の絵
 */
function wheel(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const rot = f * 36 * DEG;
  const R = WHEEL_ORBIT * (0.55 + 0.45 * easeSwing(Math.min(1, (f + 1) / 4)));
  for (let i = 0; i < 4; i++) {
    const head = rot + (i * TAU) / 4;
    const span = 50 * DEG;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y);
        const T = 6 * (1 - k * 0.6);
        if (Math.abs(d - R) > T / 2) return -1;
        let a = head - Math.atan2(y, x);
        a = ((a % TAU) + TAU) % TAU;
        if (a > span) return -1;
        const u = a / span;
        if (!survives(x, y, k * 0.9, 1 - u, 7401 + i)) return -1;
        return clamp01((1 - u) * (1 - Math.abs(d - R) / T) * 1.1);
      },
      { bounds: { x0: -R - 6, y0: -R - 6, x1: R + 6, y1: R + 6 } },
    );
  }
  ring(frame, { radius: R + 5, width: 1.2, erosion: Math.min(0.92, 0.2 + k * 0.8), bright: 0.5 - k * 0.2, seed: 7410 });
  if (f === 2) sparkle(frame, 0, 0, 3);
}

/** 飛ぶ大手裏剣（大車輪の弾。radius 10 → 投げた絵は 2.5 倍で半径 ≈ 19 論理 px）: 外周の風を 4 本、削りの火花、尾 */
const WHEEL_SHOT = { R: 42, tail: 28, star: 30, base: 10 };
const WHEEL_FLY_FRAMES = 6;

function wheelFly(frame, f) {
  const g = WHEEL_SHOT;
  const rot = (f / WHEEL_FLY_FRAMES) * (TAU / 4);
  spinWind(frame, { R: g.R, rot, n: 4, len: 50 * DEG, width: 1.6, bright: 0.7 });
  spinWind(frame, { R: g.R + 3, rot: rot + 20 * DEG, n: 4, len: 25 * DEG, width: 1, bright: 0.45 });
  for (const side of [-1, 1]) {
    const len = g.tail + 6 * Math.sin((f / WHEEL_FLY_FRAMES) * TAU + (side > 0 ? 0 : Math.PI));
    streakLine(frame, { ax: -g.R * 0.4 - len, ay: side * g.R * 0.75, bx: -g.R * 0.4, by: side * g.R * 0.6, bright: 0.45 });
  }
  for (let i = 0; i < 3; i++) {
    const a = rot + (i * TAU) / 3 + hash1(f * 3 + i, 7501) * 0.6;
    dot(frame, Math.cos(a) * g.R, Math.sin(a) * g.R, 6);
    dot(frame, Math.cos(a) * g.R - 3, Math.sin(a) * g.R, 4);
  }
}

/** 大車輪の命中（削り）: 当たった所に火花が接線へ散り、短い削り傷が 2 本交わる */
function wheelHit(frame, f) {
  if (f <= 1) {
    lens(frame, { ax: -14, ay: -8, bx: 14, by: 8, T: 5 - f, bias: 0, seed: 7601 });
    lens(frame, { ax: -12, ay: 9, bx: 12, by: -9, T: 4 - f, bias: 0, seed: 7602 });
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  }
  ring(frame, { radius: 6 + f * 4, width: 2, erosion: Math.min(0.92, f * 0.2), bright: 0.7 - f * 0.1, seed: 7603 });
  shards(frame, f, 12, 7604, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.4 + Math.PI / 2 * (rnd(2) > 0.5 ? 1 : -1);
    const sp = 3 + rnd(3) * 4;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
  });
}

/** 大車輪の着弾（壁）: 大きな星が壁に食い込み、回り残りで止まって崩れる */
function wheelImpact(frame, f) {
  const N = 7;
  const fade = f / (N - 1);
  const rot = (45 + [40, 20, 8, 3, 0, 0, 0][f]) * DEG;
  star(frame, { x: -WHEEL_SHOT.star * 0.5, r: WHEEL_SHOT.star, rot, hole: 0.18, bright: 1 - fade * 0.5, erosion: Math.max(0, fade - 0.45) * 1.8, seed: 7701 });
  if (f <= 1) {
    lens(frame, { ax: 1, ay: -24, bx: 1, by: 24, T: f === 0 ? 4 : 3, bias: 0, bright: 0.9 });
    sparkle(frame, 1, 0, 4 - f);
  }
  shards(frame, f, 12, 7702, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 3;
    return { x: 0, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** 大車輪の尽き（dirs 1）: 回り終えた大きな星がふっと縮みながら崩れ、粒が残って消える */
function wheelFizzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f < N - 1) star(frame, { r: WHEEL_SHOT.star * (1 - 0.35 * k), rot: f * 22 * DEG, hole: 0.18, bright: 1 - 0.4 * k, erosion: Math.max(0, k - 0.25) * 1.5, seed: 7801 });
  if (f >= 2) {
    for (let i = 0; i < 6; i++) {
      if (hash1(i + f * 7, 7802) < (f - 2) / (N - 1)) continue;
      const a = (i / 6) * TAU + f * 0.3;
      dot(frame, Math.cos(a) * (14 + f * 3), Math.sin(a) * (14 + f * 3), 4);
    }
  }
}

// -----------------------------------------------------------------------------
// 龍刃
// -----------------------------------------------------------------------------

/** 螺旋の上の点（s = 0 足元 → 1 頭上）。半径は昇るほど締まり、3 回り半で巻き上がる */
function coilPoint(s, rot = 0) {
  const a = rot + s * 3.5 * Math.PI;
  const r = 26 - 10 * s;
  return { x: Math.cos(a) * r, y: FEET_Y - s * 66 + Math.sin(a) * r * 0.35, back: Math.sin(a) < 0 };
}

/**
 * 龍刃の発動: 腰の高さで横一文字の抜刀の閃きが走り、足元から頭上へ龍の筆（太い帯）が巻き上がって、
 * 頭上で龍の頭（太い筆の止め）が光って崩れる
 */
function dragonCast(frame, f) {
  const N = 12;
  if (f <= 2) {
    const g = easeSwing((f + 1) / 3);
    lens(frame, { ax: -24, ay: 2, bx: -24 + 60 * g, by: 2, T: 4, bias: 0, erosion: f === 2 ? 0.4 : 0, seed: 7901 });
    if (f === 1) sparkle(frame, 30, 2, 3);
  }
  const grow = clamp01((f - 1) / 6);
  const k = f < 8 ? 0 : (f - 7) / (N - 7);
  if (grow <= 0) return;
  const pts = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * grow;
    const p = coilPoint(s);
    const toHead = s / Math.max(0.05, grow);
    pts.push({ x: p.x, y: p.y, w: 0.6 + 3.2 * toHead ** 1.4, v: (p.back ? 0.5 : 0.85) * (0.6 + 0.4 * toHead) });
  }
  ribbon(frame, pts, { erosion: k * 0.9, seed: 7902 });
  const head = coilPoint(grow);
  if (f === 7) sparkle(frame, head.x, head.y, 4);
  if (k < 0.6) {
    // 龍の髭: 頭から前へ細い 2 本
    streakLine(frame, { ax: head.x, ay: head.y - 1, bx: head.x + 10, by: head.y - 6, bright: 0.6 * (1 - k) });
    streakLine(frame, { ax: head.x, ay: head.y + 1, bx: head.x + 11, by: head.y + 3, bright: 0.6 * (1 - k) });
  }
}

const DRAGON_N = 16;
/** 纏いの龍の周回の楕円（体の周りを横に巡る） */
const DRAGON_RX = 28;
const DRAGON_RY = 11;
const DRAGON_Y = -2;

/**
 * 龍刃の纏い: 体の周りを龍の帯が巡り続ける（頭が先で太く、尾へ細る。体の後ろを通る所は淡い）。
 * 頭の先から細い髭、帯の背に鱗の刻み。1 巡で 1 周するので継ぎ目が出ない
 */
function dragonSustain(frame, f) {
  const head = (f / DRAGON_N) * TAU;
  const span = 230 * DEG;
  const steps = 32;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = head - span * u;
    const bob = Math.sin(u * 3 * Math.PI + head) * 2.5;
    const back = Math.sin(a) < 0;
    pts.push({ x: Math.cos(a) * DRAGON_RX, y: DRAGON_Y + Math.sin(a) * DRAGON_RY + bob, w: 0.5 + 3 * (1 - u) ** 1.2, v: (back ? 0.42 : 0.8) * (1 - 0.4 * u) });
  }
  ribbon(frame, pts, { seed: 8001 });
  // 鱗: 帯の上の短い刻み（頭寄りだけ）
  for (let i = 2; i < 12; i += 3) {
    const p = pts[i];
    if (p) dot(frame, p.x, p.y - p.w * 0.4, 6);
  }
  const h = pts[0];
  if (!h) return;
  const ta = head + Math.PI / 2;
  const tx = Math.cos(ta);
  const ty = Math.sin(ta) * (DRAGON_RY / DRAGON_RX);
  const tl = Math.hypot(tx, ty);
  streakLine(frame, { ax: h.x, ay: h.y - 1, bx: h.x + (tx / tl) * 9, by: h.y - 1 + (ty / tl) * 9 - 3, bright: 0.6 });
  streakLine(frame, { ax: h.x, ay: h.y + 1, bx: h.x + (tx / tl) * 9, by: h.y + 1 + (ty / tl) * 9 + 2, bright: 0.6 });
  if (f % 4 === 0) sparkle(frame, h.x, h.y, 2);
}

/** 龍刃の足元: 風の輪が 1 つ、龍の巡りと同じ向きに刻みを回す */
function dragonGround(frame, f) {
  ring(frame, { oy: FEET_Y, radius: 14, width: 1.3, squash: GROUND_SQUASH, bright: 0.28, seed: 8101 });
  const rot = (f / DRAGON_N) * TAU;
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * TAU;
    arcLine(frame, { ox: 0, oy: FEET_Y, radius: 14, from: a - 0.5, to: a, bright: 0.5 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts が読む）。どれも大きさを持たない（base 0）。
 * 八方手裏剣の弾は shuriken.mjs の手裏剣の弾の絵（BULLET_FX）、大車輪の弾は shots 0 の専用の絵
 */
const FX = {
  moveset: "shuriken",
  ultimates: {
    "shuriken.eightfold": {
      ramp: "steel",
      cast: { sheet: "shurikenUlt.eightCast", life: 0.4 },
      acts: [{ sheet: "shurikenUlt.eight", life: 0.5, base: 0, pivot: "pos" }],
    },
    "shuriken.greatWheel": {
      ramp: "steel",
      cast: { sheet: "shurikenUlt.wheelCast", life: 0.45 },
      acts: [{ sheet: "shurikenUlt.wheel", life: 0.55, base: 0, pivot: "pos" }],
      shots: {
        0: { fly: "shurikenUlt.wheelFly", period: 0.12, base: WHEEL_SHOT.base, impact: "shurikenUlt.wheelImpact", hit: "shurikenUlt.wheelHit", fizzle: "shurikenUlt.wheelFizzle", ramp: "steel" },
      },
    },
    "shuriken.dragonBlade": {
      ramp: "steel",
      cast: { sheet: "shurikenUlt.dragonCast", life: 0.6 },
      sustain: { sheet: "shurikenUlt.dragon", period: 1.1, ground: "shurikenUlt.dragonGround" },
    },
  },
};

export const ATLAS = {
  key: "shurikenUlt",
  fx: FX,
  sheets: [
    { key: "shurikenUlt.eightCast", dirs: 1, frames: 9, active: 0, size: 120, draw: eightCast },
    { key: "shurikenUlt.eight", dirs: 1, frames: 9, active: 3, size: 2 * (EIGHT_R + 20), draw: eight },
    { key: "shurikenUlt.wheelCast", dirs: 1, frames: 10, active: 0, size: 128, draw: wheelCast },
    { key: "shurikenUlt.wheel", dirs: 1, frames: 10, active: 0, size: 2 * (WHEEL_ORBIT + 12), draw: wheel },
    { key: "shurikenUlt.wheelFly", dirs: DIRS, frames: WHEEL_FLY_FRAMES, active: 0, size: 2 * (WHEEL_SHOT.R + WHEEL_SHOT.tail + 16), draw: wheelFly },
    { key: "shurikenUlt.wheelHit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: wheelHit },
    { key: "shurikenUlt.wheelImpact", dirs: DIRS, frames: 7, active: 0, size: 2 * (WHEEL_SHOT.star + 24), draw: wheelImpact },
    { key: "shurikenUlt.wheelFizzle", dirs: 1, frames: 7, active: 0, size: 2 * (WHEEL_SHOT.star + 24), draw: wheelFizzle },
    { key: "shurikenUlt.dragonCast", dirs: 1, frames: 12, active: 0, size: 160, draw: dragonCast },
    { key: "shurikenUlt.dragon", dirs: 1, frames: DRAGON_N, active: 0, size: 112, draw: dragonSustain },
    { key: "shurikenUlt.dragonGround", dirs: 1, frames: DRAGON_N, active: 0, size: Math.ceil(2 * (14 * GROUND_SQUASH + 6)), draw: dragonGround },
  ],
};
