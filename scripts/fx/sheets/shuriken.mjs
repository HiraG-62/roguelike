// 手裏剣（moveset "shuriken"）のエフェクト。docs/ideas/fx-sprites.md 9 章・docs/ideas/gun-bases-review.md 2-9
// 単位は絵のドット（論理 0.5px）。弾の数値（weapons/WEAPON/movesets/shuriken.json の cast）× 2 が目安
//
// 左右とも投げ（size 0 の cast の段）。左の 3 段は投げの所作だけを肩から出す（弾そのものは弾の絵）: 1 段目は 3 本・2 段目は 4 本の
// 平行の投げ筋と手首の弧、3 段目は大手裏剣を放る大きな風車の弧。右の扇投げは cast の段なので振りの絵は持たない（swingMotionKeys）。
// ダッシュは抜け斬り: 敵をすり抜けながら走る細く長い一閃に、斬った所の短い斜めの刻みが遅れて灯る。
//
// 弾: 本体は描画側（render/thrownLook.ts）が回る手裏剣の絵（thrownWeapon.shuriken / bigShuriken）を重ねるので、fly は本体を描かず、
// 尖りの先が描く回転の風（外周の短い弧）と後ろへ抜ける細い風の筋だけを描く。着弾・尽きたは本体が消えた後なので星形を描く
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 四方の星（手裏剣の形）: 中心 (x, y)、尖りの先まで r、回転 rot。尖りの間は内へ反ってくびれ、真ん中に穴が抜ける。
 * 尖りの片側の面（進む回転の前の側）が明るい
 */
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
      // 尖りの先（u = 1）で r、尖りの間（u = 0）で inner。反りは 2 乗で内へくびれる
      const edge = inner + (r - inner) * u ** 2.2;
      if (d > edge) return -1;
      if (!survives(px, py, erosion, 1 - d / r, seed)) return -1;
      const face = off > 0 ? 0.95 : 0.7;
      return clamp01(face * (1 - 0.25 * (d / r)) * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 先へ細る 1 本の針: (x, y) から角 a へ長さ len、根元の半幅 w */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pad = w + 2;
  const ex = x + c * len;
  const ey = y + s * len;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s;
      if (along < -w * 0.6 || along > len) return -1;
      const u = Math.max(0, along) / len;
      const half = w * (1 - u) ** 0.9 + 0.35;
      const across = Math.abs(-dx * s + dy * c);
      if (across > half) return -1;
      return clamp01((1 - across / half) ** 0.8 * (1.05 - 0.6 * u) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 細い 1 本の弧線（中心 (cx, cy)、半径 r、角 a0 → a1）。a1 側が明るい */
function thinArc(frame, o) {
  const { cx = 0, cy = 0, r, a0, a1 } = o;
  const width = o.width ?? 1.1;
  const hi = o.bright ?? 0.6;
  const lo = Math.min(a0, a1);
  const span = Math.abs(a1 - a0);
  const pad = r + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(Math.hypot(dx, dy) - r) > width / 2) return -1;
      let s = (Math.atan2(dy, dx) - lo) % TAU;
      if (s < 0) s += TAU;
      if (s > span) return -1;
      const t = a1 >= a0 ? s / span : 1 - s / span;
      return hi * (0.25 + 0.75 * t);
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0, samples: 3 },
  );
}

/**
 * 回転の風: 外周（半径 R）を回る n 本の短い弧（尖りの先の軌跡）。rot で回し、先頭ほど明るい 1px の線。
 * 時計回りに回す（描画側の回る向きは進む左右で変わるが、細い弧なので向きは読み取れない）
 */
function spinWind(frame, o) {
  const { R, rot, n } = o;
  const len = o.len ?? 55 * DEG;
  const bright = o.bright ?? 0.6;
  const width = o.width ?? 1.1;
  for (let i = 0; i < n; i++) {
    const head = rot + (i * TAU) / n;
    arcLine(frame, { radius: R, from: head - len, to: head, width, bright });
  }
}

// -----------------------------------------------------------------------------
// 命中: 小さな星の刺し傷。heavy（大手裏剣の削り・崩し）は刺し傷が 4 方へ割れ、輪と多めの刃片
// -----------------------------------------------------------------------------

function hit(frame, f, heavy) {
  const s = heavy ? 1.6 : 1;
  if (f <= 1) {
    const g = f === 0 ? 0.8 : 1;
    // 4 方の短い針（45° 傾けた十字 = 手裏剣の尖りの刺さり）と、進む向きへ長い 1 本
    for (let i = 0; i < 4; i++) spike(frame, { x: 0, a: (45 + i * 90) * DEG, len: 8 * s * g, w: 1.6 * s, bright: 0.85 });
    spike(frame, { x: -4, a: 0, len: 16 * s * g, w: 2 * s, bright: 1 });
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : 2);
  }
  if (f >= 1 && f <= 3) {
    star(frame, { r: (heavy ? 10 : 7) + f, rot: f * 25 * DEG, hole: 0.3, bright: 0.85 - f * 0.1, erosion: (f - 1) * 0.22, seed: heavy ? 5101 : 5111 });
  }
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 8 + age * 5, width: 2.4, erosion: Math.min(0.92, 0.15 + age * 0.2), bright: 0.75 - age * 0.1, seed: 5102 });
  }
  shards(frame, f - 1, heavy ? 12 : 7, heavy ? 5103 : 5113, (i, rnd) => {
    const a = rnd(2) > 0.4 ? (rnd(1) - 0.5) * 1.3 : rnd(1) * TAU;
    const sp = (heavy ? 3.5 : 2.6) + rnd(3) * (heavy ? 3.5 : 2.5);
    return { x: 1, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.4 ? 2 : 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 左の段: 投げの所作（肩から。size 0 なので拡縮しない）
// -----------------------------------------------------------------------------

/** 投げの段の数値: lanes = 投げ筋の y（lineGap 5 論理 px × 2）、flick = 手首の弧の向き（1 = 上から下、-1 = 下から上） */
const TOSS = {
  toss1: { lanes: [-10, 0, 10], flick: 1, seed: 5201 },
  toss2: { lanes: [-15, -5, 5, 15], flick: -1, seed: 5301 },
};

/**
 * 1・2 段目の投げ: 手首を返す細い弧が閉じ、本数ぶんの平行の投げ筋（縦に並ぶ）が前へ伸びて細って消える。
 * 筋の先に小さな星の残像が 1 枚ずつ灯る（放った瞬間）
 */
function toss(frame, f, spec) {
  const N = 6;
  const A = 2;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  if (f <= 2) {
    const a0 = spec.flick * -95 * DEG;
    const a1 = spec.flick * 15 * DEG;
    thinArc(frame, { cx: -4, r: 13, a0, a1, width: 1.5, bright: 0.9 - f * 0.25 });
  }
  spec.lanes.forEach((y, i) => {
    const delay = Math.abs(i - (spec.lanes.length - 1) / 2) * 0.12;
    const g = clamp01(p - delay);
    const x1 = 12 + 30 * g + k * 8;
    const x0 = 6 + k * 30;
    if (g > 0 && x1 - x0 > 3) lens(frame, { ax: x0, ay: y * (0.5 + 0.5 * g), bx: x1, by: y, T: 3.2 * (1 - k * 0.5), bias: 0, erosion: k * 0.8, seed: spec.seed + i, bright: 0.95 - k * 0.2 });
    if (f === A - 1) star(frame, { x: x1, y, r: 3.5, rot: i * 0.4, hole: 0.3, bright: 0.9, seed: spec.seed + 10 + i });
  });
  if (f === 0) sparkle(frame, 6, 0, 2);
}

/**
 * 3 段目: 大手裏剣を放る。肩の上から大きく回す風車の弧（270°）が閉じ、前へ太い投げ筋 1 本と、
 * 放った所に潰れた輪。重い段なので弧の外に速度線を 2 本添える
 */
function bigToss(frame, f) {
  const N = 8;
  const A = 3;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const R = 18;
  const from = -200 * DEG;
  const head = from + 270 * DEG * p + k * 20 * DEG;
  const tail = from + 270 * DEG * Math.min(0.95, Math.max(0, p - 0.6) + k * 0.9);
  // 風車の弧: 太さ一定の帯（先頭が明るい）。崩れで細る
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x + 2, y);
      const T = 5 * (1 - k * 0.6);
      if (Math.abs(d - R) > T / 2) return -1;
      let a = Math.atan2(y, x + 2) - tail;
      a = ((a % TAU) + TAU) % TAU;
      const span = head - tail;
      if (a > span) return -1;
      const u = a / span;
      if (!survives(x, y, k * 0.9, u, 5401)) return -1;
      return clamp01((0.45 + 0.55 * u) * (1 - Math.abs(d - R) / T));
    },
    { bounds: { x0: -R - 6, y0: -R - 4, x1: R + 4, y1: R + 4 } },
  );
  if (k < 0.7) {
    for (let i = 0; i < 2; i++) arcLine(frame, { ox: -2, radius: R + 4 + i * 2, from: head - (0.9 - i * 0.3), to: head - 0.1, bright: 0.55 * (1 - k) });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    lens(frame, { ax: 8 + age * 6, ay: 0, bx: 34 + age * 6, by: 0, T: 8 * (1 - k * 0.5), bias: 0, erosion: Math.min(0.92, age * 0.18), seed: 5402, bright: 0.95 - age * 0.08 });
    ring(frame, { ox: 14 + age * 3, radius: 5 + age * 3, width: 2, squash: 0.45, erosion: Math.min(0.92, age * 0.2), bright: 0.7 - age * 0.08, seed: 5403 });
    if (age === 0) {
      star(frame, { x: 18, r: 7, rot: 0.3, hole: 0.25, bright: 1, seed: 5404 });
      sparkle(frame, 18, 0, 3);
    }
  }
}

// -----------------------------------------------------------------------------
// ダッシュ攻撃: 抜け斬り（thrust reach 20・踏み込み 48・すり抜け）
// -----------------------------------------------------------------------------

/** 抜け斬りの刻み（斬った所）: 一閃の上の位置と傾き。走り抜けた順に後ろから灯る */
const PASS_CUTS = [
  { x: -30, deg: 58, at: 2 },
  { x: -10, deg: -52, at: 3 },
  { x: 12, deg: 64, at: 4 },
];

/**
 * 抜け斬り: 背後から前へ一気に走る細く長い一閃（体の通り道）。走り抜けた後、一閃の上に短い斜めの刻みが
 * 順に灯り（すり抜けざまに斬った所）、一閃は上下に細い 2 本へほどけて消える。後ろへ流れる速度線を脇に添える
 */
function passCut(frame, f) {
  const A = 3;
  const N = 9;
  const from = -44;
  const to = 40;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const head = from + (to - from) * p;
  if (k === 0) {
    lens(frame, { ax: from, ay: 0, bx: head, by: 0, T: 5, bias: 0, seed: 5501 });
    streakLine(frame, { ax: from + 16, ay: 0, bx: head - 2, by: 0, width: 1.2, bright: 1 });
  } else {
    const gap = 1 + k * 4;
    for (const side of [-1, 1]) lens(frame, { ax: from + k * 36, ay: side * gap, bx: to, by: side * gap, T: 3.4 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 5502 + side, bright: 0.85 - k * 0.3 });
  }
  PASS_CUTS.forEach((c, i) => {
    const age = f - c.at;
    if (age < 0 || age > 4) return;
    const a = c.deg * DEG;
    const L = 9 * (age === 0 ? 0.7 : 1);
    lens(frame, { ax: c.x - Math.cos(a) * L, ay: -Math.sin(a) * L, bx: c.x + Math.cos(a) * L, by: Math.sin(a) * L, T: 4 * (1 - age * 0.15), bias: 0, erosion: Math.max(0, age - 1) * 0.3, seed: 5510 + i, bright: 0.95 - age * 0.1 });
    if (age === 0) sparkle(frame, c.x, 0, 2);
    shards(frame, age, 4, 5520 + i, (j, rnd) => {
      const s = rnd(1) > 0.5 ? 1 : -1;
      const sp = 2 + rnd(2) * 2;
      return { x: c.x, y: 0, vx: Math.cos(a + (s * Math.PI) / 2) * sp, vy: Math.sin(a + (s * Math.PI) / 2) * sp, life: 3, size: 1 };
    });
  });
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (6 + Math.floor(i / 2) * 5);
    const len = (18 + 16 * hash1(i, 5530)) * (1 - k * 1.2);
    const x1 = head - 20 - hash1(i, 5531) * 12;
    if (len > 2) streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
  }
}

// -----------------------------------------------------------------------------
// 弾: 手裏剣（radius 2・速い）と大手裏剣（radius 5・遅い・削る）
// -----------------------------------------------------------------------------

const FLY_FRAMES = 6;

/**
 * 弾の数値。R = 回転の風の半径（投げた絵の尖りの先のすぐ外）、wind = 弧の本数、tail = 尾の長さ、
 * star = 着弾・尽きたで描く星の大きさ、base = 弾の半径（論理 px）
 */
const SHOTS = {
  star: { R: 10, wind: 2, tail: 16, star: 7, period: 0.1, base: 2, seed: 5601 },
  bigStar: { R: 21, wind: 4, tail: 22, star: 15, period: 0.12, base: 5, seed: 5701 },
};

/**
 * 飛ぶ手裏剣: 原点 = 弾の中心、+x = 進む向き。本体（回る絵）は描画側。外周の回転の風と、
 * 上下の尖りの先から後ろへ抜ける 2 本の細い風の筋（フレームで長さが揺らぐ）、芯の後ろの淡い 1 本
 */
function starFly(frame, f, g) {
  const t = (f / FLY_FRAMES) * TAU;
  spinWind(frame, { R: g.R, rot: (f / FLY_FRAMES) * (TAU / g.wind), n: g.wind, len: (g.wind > 2 ? 50 : 70) * DEG, bright: 0.6 });
  for (const side of [-1, 1]) {
    const len = g.tail + 4 * Math.sin(t + (side > 0 ? 0 : Math.PI));
    const y = side * g.R * 0.6;
    streakLine(frame, { ax: -g.R * 0.4 - len, ay: y * 1.15, bx: -g.R * 0.4, by: y, bright: 0.42 });
  }
  streakLine(frame, { ax: -g.R - g.tail * 0.8, ay: 0, bx: -g.R + 1, by: 0, width: 1, bright: 0.35 });
  if (g.wind > 2 && f % 2 === 0) {
    // 大手裏剣は削る刃なので、外周から細かな火花が後ろへこぼれる
    const a = (f / FLY_FRAMES) * TAU + hash1(f, g.seed) * 2;
    dot(frame, Math.cos(a) * g.R - 3, Math.sin(a) * g.R, 5);
    dot(frame, Math.cos(a) * g.R - 6, Math.sin(a) * g.R * 1.1, 3);
  }
}

/** 投げの手元: 手首の細い弧と、前へ抜ける短い風切り。大手裏剣は弧が大きい */
function starMuzzle(frame, f, g) {
  const s = g.R / 10;
  if (f <= 1) thinArc(frame, { cx: -6 * s, r: 8 * s, a0: -80 * DEG, a1: 20 * DEG, width: 1.3, bright: 0.8 - f * 0.25 });
  if (f <= 2) {
    const x0 = 1 + f * 4;
    lens(frame, { ax: x0, ay: 0, bx: x0 + 12 * s - f * 2, by: 0, T: 3 * s, bias: 0, erosion: f * 0.3, seed: g.seed + 11, bright: 0.85 - f * 0.15 });
  }
  if (f === 0) sparkle(frame, 2, 0, 2);
  shards(frame, f - 1, 3, g.seed + 12, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.2;
    const sp = 1.8 + rnd(2) * 1.8;
    return { x: 6 * s, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
  });
}

/**
 * 着弾（壁）: 原点 = 止まった位置、+x = 進んでいた向き。尖り 1 本で壁に突き立った星が、回り残りで少しずつ角を変えて止まり、
 * 崩れて消える。最初に硬い閃きと、後ろの扇へ跳ねる火花
 */
function starImpact(frame, f, g) {
  const N = 6;
  const fade = f / (N - 1);
  const rot = (45 + [30, 14, 6, 2, 0, 0][f]) * DEG;
  star(frame, { x: -g.star * 0.55, r: g.star, rot, hole: 0.22, bright: 1 - fade * 0.5, erosion: Math.max(0, fade - 0.45) * 1.8, seed: g.seed + 21 });
  if (f <= 1) {
    lens(frame, { ax: 1, ay: -g.star, bx: 1, by: g.star, T: f === 0 ? 3 : 2, bias: 0, bright: 0.9 });
    sparkle(frame, 1, 0, f === 0 ? 3 : 2);
  }
  shards(frame, f, g.wind > 2 ? 9 : 6, g.seed + 22, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 2.2 + rnd(2) * 2.4;
    return { x: 0, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** 尽きた（dirs 1）: 回転の落ちた星がゆっくり回りながら落ち、地で小さく跳ねて崩れる */
function starFizzle(frame, f, g) {
  const N = 7;
  const k = f / (N - 1);
  const drop = Math.min(1, f / 4);
  const y = drop * drop * (6 + g.star * 0.4);
  if (f < N - 1) star(frame, { x: f * 0.6, y, r: g.star * (1 - 0.15 * k), rot: f * (40 - f * 5) * DEG, hole: 0.22, bright: 1 - 0.35 * k, erosion: Math.max(0, k - 0.4) * 1.6, seed: g.seed + 31 });
  if (f === 4) sparkle(frame, 2, y + g.star * 0.6, 2);
  if (f >= 4) {
    for (let i = 0; i < 3; i++) dot(frame, -3 + i * 3 + (f - 4), y + g.star * 0.6 - (i === 1 ? 1 : 0), 4 - (f - 4) - (i === 1 ? 0 : 1));
  }
}

function shotSheets(name) {
  const g = SHOTS[name];
  return [
    { key: `shuriken.${name}Fly`, dirs: DIRS, frames: FLY_FRAMES, active: 0, size: Math.ceil(g.R * 2 + g.tail + 10) * 2, draw: (frame, f) => starFly(frame, f, g) },
    { key: `shuriken.${name}Muzzle`, dirs: DIRS, frames: 5, active: 0, size: Math.ceil(g.R * 2 + 16) * 2, draw: (frame, f) => starMuzzle(frame, f, g) },
    { key: `shuriken.${name}Impact`, dirs: DIRS, frames: 6, active: 0, size: Math.ceil(g.star * 2 + 14) * 2, draw: (frame, f) => starImpact(frame, f, g) },
    { key: `shuriken.${name}Fizzle`, dirs: 1, frames: 7, active: 0, size: Math.ceil(g.star * 2 + 16) * 2, draw: (frame, f) => starFizzle(frame, f, g) },
  ];
}

/** 弾の表の 1 行（鋼の刃なので配色は steel。大手裏剣の命中は削りの重い刺し傷） */
function bulletRow(name, heavyHit) {
  const g = SHOTS[name];
  return {
    fly: `shuriken.${name}Fly`,
    period: g.period,
    base: g.base,
    muzzle: `shuriken.${name}Muzzle`,
    impact: `shuriken.${name}Impact`,
    hit: heavyHit ? "shuriken.hitHeavy" : "shuriken.hit",
    fizzle: `shuriken.${name}Fizzle`,
    ramp: "steel",
  };
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。左の段は reach / size 0 なので拡縮しない（fit.mjs も素通り）。
 * 手裏剣の弾（左の starToss / starToss2、右の starFan / starFan2）は同じ絵を使い、3 段目の大手裏剣（bigStar）だけ別の絵
 */
const FX = {
  moveset: "shuriken",
  motions: {
    "l:0": { sheet: "shuriken.toss1", pivot: "self", base: 0, measure: "reach" },
    "l:1": { sheet: "shuriken.toss2", pivot: "self", base: 0, measure: "reach" },
    "l:2": { sheet: "shuriken.toss3", pivot: "self", base: 0, measure: "reach" },
    dash: { sheet: "shuriken.dash", pivot: "self", base: 20, measure: "reach" },
  },
  hit: "shuriken.hit",
  hitHeavy: "shuriken.hitHeavy",
  bullets: {
    "cast.starToss": bulletRow("star", false),
    "cast.starToss2": bulletRow("star", false),
    "cast.starFan": bulletRow("star", false),
    "cast.starFan2": bulletRow("star", false),
    "cast.bigStar": bulletRow("bigStar", true),
  },
};

export const ATLAS = {
  key: "shuriken",
  fx: FX,
  sheets: [
    { key: "shuriken.toss1", dirs: DIRS, frames: 6, active: 2, size: 112, draw: (frame, f) => toss(frame, f, TOSS.toss1) },
    { key: "shuriken.toss2", dirs: DIRS, frames: 6, active: 2, size: 112, draw: (frame, f) => toss(frame, f, TOSS.toss2) },
    { key: "shuriken.toss3", dirs: DIRS, frames: 8, active: 3, size: 112, draw: bigToss },
    { key: "shuriken.dash", dirs: DIRS, frames: 9, active: 3, size: 120, draw: passCut },
    { key: "shuriken.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => hit(frame, f, false) },
    { key: "shuriken.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (frame, f) => hit(frame, f, true) },
    ...shotSheets("star"),
    ...shotSheets("bigStar"),
  ],
};
