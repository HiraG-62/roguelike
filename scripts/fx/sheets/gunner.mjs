// 二丁拳銃（moveset "gunner"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、銃の見本は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/gunner.json・弾の表）× 2 が目安
//
// 性格: 両手の拳銃を交互に撃ちまくる派手なガンアクション。片手銃（sidearm）より軽快で、閃光は小さく鋭い。
// 二丁であることを絵で見せるため、近接の派生は「左の銃口（−y）」と「右の銃口（+y）」の 2 か所から交互に閃き、
// 薬莢もそれぞれの外側（左は −y、右は +y）へ飛ぶ。
//
// 弾 4 種は銃口の閃光の「形」を別の関数にする:
//   twinPistols   細い針 1 本 + 後ろへ反った小さな返し（矢じり形）。一番小さく鋭い
//   twinRevolvers 前の太い針と斜めの 2 本 + 前へ吹く硝煙の塊（ぼふっと一発ずつ重い）
//   art.barrage   扇に開く多数の針（8 発がまとめて 1 つの閃光になる）と両側へ飛ぶ 2 つの薬莢
//   art.spinShot  接線へ寝た針の風車と、時計回りに巻く細い弧（回りながら撃つ）
// 曳光は共通の部品（tracer）を数値で変える。乱れ撃ち・回転撃ちの弾は短命なので短く明るく、回転撃ちは尾が少し巻く。
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光は 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;
/** 銃を構えた先（自分の中心から前へ）。キャラ 48 ドットの縁の少し外 */
const HAND = 20;
/** 左右の銃口の横のずれ（左 = −y、右 = +y）。二丁の間隔 */
const GUN_Y = 7;

// -----------------------------------------------------------------------------
// 共通の部品（sidearm.mjs から写して二丁拳銃向けに変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角。芯が明るく先ほど暗い */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
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
      const q = across / half;
      if (!survives(px, py, erosion, 1 - q, seed)) return -1;
      return clamp01((1 - q) ** 0.8 * (1.05 - 0.6 * u) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 円い閃光の芯（半径 r）。中心ほど明るい */
function flashCore(frame, x, y, r, bright = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > r) return -1;
      return clamp01((1 - d / r) ** 0.6 * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 前へ押し出す圧の弧（潰れた楕円の前側だけ）。全周の輪にすると閃光の横に輪っかがぶら下がって見える */
function frontArc(frame, o) {
  const { ox = 0, oy = 0, radius, width } = o;
  const squash = o.squash ?? 0.5;
  const spread = o.spread ?? 70 * DEG;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.6;
  const seed = o.seed ?? 21;
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = (x - ox) / squash;
      const dy = y - oy;
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > spread) return -1;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      const edge = Math.abs(a) / spread;
      if (!survives(x, y, erosion + edge * 0.3, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - 0.45 * edge));
    },
    { bounds: { x0: ox - 2, y0: oy - pad, x1: ox + pad * squash + 2, y1: oy + pad } },
  );
}

/** 薬莢: (x, y) の 2〜3 ドットの棒。spin（0..3）で 45° ずつ回る。段 5 まで（閃光より目立たせない） */
function casing(frame, x, y, spin, fade = 0) {
  const k = ((spin % 4) + 4) % 4;
  const dirs = [
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
  ];
  const [cx, cy] = dirs[k] ?? [1, 0];
  const hi = Math.max(2, 5 - Math.round(fade * 2));
  dot(frame, x + cx, y + cy, hi);
  dot(frame, x, y, hi - 1);
  dot(frame, x - cx, y - cy, Math.max(2, hi - 2));
}

/**
 * 横へ飛ぶ薬莢。side の符号で左右（左の銃は −y、右の銃は +y へ排莢する）。
 * age（フレーム）で放物線を描き、回りながら外へ流れて落ちる
 */
function ejectCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  const x = o.x - o.back * t;
  const y = o.y + o.side * t - Math.sign(o.side || 1) * 0.35 * t * t * o.fall;
  casing(frame, x, y, o.spin + t, t / (o.life + 1));
}

/** 画面に揃えて昇る細い煙（dirs 1 のシート用）。段 2〜3 だけ */
function smokeWisp(frame, o) {
  const { x0, y0, height, width, age, seed } = o;
  const sway = o.sway ?? 3;
  const bright = o.bright ?? 0.36;
  const rise = age * (o.rise ?? 8);
  paint(
    frame,
    (x, y) => {
      const h = y0 - rise - y;
      if (h < 0 || h > height) return -1;
      const u = h / height;
      const cx = x0 + Math.sin(u * 5.2 + seed + age * 3) * sway * u + (o.lean ?? 0) * u;
      const w = width * (0.6 + 0.8 * u) * (1 + age * 0.5);
      const d = Math.abs(x - cx);
      if (d > w) return -1;
      if (valueNoise(x, y + rise, 2.6, seed) * 0.8 + (1 - u) * 0.3 - age * 0.75 - u * 0.25 < 0) return -1;
      return clamp01(bright * (1 - d / w) ** 0.5 * (1 - u * 0.4) * (1 - age * 0.5));
    },
    { bounds: { x0: x0 - sway - width * 3 - 6, y0: y0 - rise - height - 1, x1: x0 + sway + width * 3 + 6 + Math.abs(o.lean ?? 0), y1: y0 - rise + 1 }, samples: 2 },
  );
}

/**
 * 砂煙・硝煙の塊: (x, y) の半径 r のもこもこした丸（段 2〜4）。age（0..1）で膨らみながら欠ける。
 * 白を使わない（閃光と見分ける）
 */
function puff(frame, o) {
  const { x, y, r, age, seed } = o;
  const bright = o.bright ?? 0.45;
  const R = r * (1 + age * 0.6);
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / R;
      const n = valueNoise(px, py, 2.4, seed);
      if (d > 0.75 + 0.35 * n) return -1;
      if (n * 0.9 + (1 - d) * 0.5 - age * 0.95 < 0.05) return -1;
      return clamp01(bright * (0.55 + 0.45 * (1 - d)) * (1 - age * 0.4));
    },
    { bounds: { x0: x - R * 1.2 - 1, y0: y - R * 1.2 - 1, x1: x + R * 1.2 + 1, y1: y + R * 1.2 + 1 }, samples: 2 },
  );
}

/**
 * 弧に沿う砂煙の帯: 中心 = 原点、半径 R、角 from → head（時計回り）。head の側ほど濃く太く、尾ほど薄く切れ切れ。
 * 縁をノイズで崩して「玉の数珠」にならない、つながった地面の擦れにする。段 2〜4（白を使わない）
 */
function dustBand(frame, o) {
  const { R, from, head, width, age, seed } = o;
  const bright = o.bright ?? 0.5;
  const span = Math.max(1e-3, head - from);
  const pad = R + width + 4;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      let s = (head - Math.atan2(y, x)) % TAU;
      if (s < 0) s += TAU;
      if (s > span) return -1;
      const u = s / span;
      const n = valueNoise(x, y, 2.6, seed);
      // 両端を丸く細らせる（角で切れた四角い端にしない）
      const taper = Math.sqrt(Math.min(1, u / 0.12, (1 - u) / 0.2));
      const w = width * (0.45 + 0.55 * (1 - u)) * (0.7 + 0.6 * n) * (1 + age * 0.5) * taper;
      const d = Math.abs(r - R - age * 3);
      if (d > w) return -1;
      if (n * 0.9 + (1 - d / w) * 0.4 - age * 1.0 - u * 0.6 < 0.05) return -1;
      return clamp01(bright * (0.5 + 0.5 * (1 - d / w)) * (1 - 0.45 * u) * (1 - age * 0.4));
    },
    { bounds: { x0: -pad, y0: -pad, x1: pad, y1: pad }, samples: 2 },
  );
}

/** 2x2 の火の粉（画面に揃える） */
function stampEmber(frame, level) {
  dot(frame, 0, 0, level + 1);
  dot(frame, 1, 0, level);
  dot(frame, 0, 1, level);
  dot(frame, 1, 1, level - 1);
}

/**
 * 手元の小さく鋭い閃き（二丁拳銃の 1 発）: 前の細い針と、後ろへ反った小さな返し 2 本。
 * 片手銃の閃き（十字）より細く、矢じりの形で「軽く鋭い」
 */
function snapFlash(frame, x, y, a, s) {
  spike(frame, { x, y, a, len: 11 * s, w: 1.6 * s, bright: 1 });
  spike(frame, { x, y, a: a + 130 * DEG, len: 4.5 * s, w: 1.2 * s, bright: 0.8 });
  spike(frame, { x, y, a: a - 130 * DEG, len: 4.5 * s, w: 1.2 * s, bright: 0.8 });
  spike(frame, { x, y, a: a + 55 * DEG, len: 3.5 * s, w: 1 * s, bright: 0.7 });
  spike(frame, { x, y, a: a - 55 * DEG, len: 3.5 * s, w: 1 * s, bright: 0.7 });
  flashCore(frame, x, y, 1.6 * s, 1);
}

// -----------------------------------------------------------------------------
// 弾 4 種の数値。1 論理 px = 2 ドット、半径 2 → 太さ 4 ドット
// -----------------------------------------------------------------------------

/**
 * tail = 尾の長さ（速さ × 0.04 秒: 300px/秒 → 24 ドット、270px/秒 → 22 ドット）、half = 弾頭の半幅、
 * tailHalf = 尾の根元の半幅、head = 弾頭の尖りの長さ、flick = 尾のちらつき、tailBright = 尾の明るさ、
 * curl = 尾の巻き（+y へ反る。回転撃ちだけ）、spark / chip = 着弾・命中の粒
 */
const GUNS = {
  // 二丁拳銃: 細く速い曳光。弾頭は針のように細く、尾は長め
  twinPistols: { tail: 26, half: 1.6, tailHalf: 0.95, head: 5, flick: 0.1, tailBright: 0.72, curl: 0, frames: 4, period: 0.1, spark: 6, sparkSpeed: 3, chip: 5, ringR: 4.2, seed: 3100 },
  // 双回転式: 一発ずつ重い。弾頭が太く、尾もやや太い
  twinRevolvers: { tail: 24, half: 2.5, tailHalf: 1.6, head: 4.5, flick: 0.08, tailBright: 0.76, curl: 0, frames: 4, period: 0.14, spark: 10, sparkSpeed: 4, chip: 9, ringR: 6.5, seed: 3200 },
  // 乱れ撃ち: 短命の弾。尾は短く、根元まで明るい（一瞬で消えるので目に残る明るさを優先）
  barrage: { tail: 14, half: 2, tailHalf: 1.3, head: 3.5, flick: 0.25, tailBright: 0.9, curl: 0, frames: 4, period: 0.08, spark: 5, sparkSpeed: 2.8, chip: 5, ringR: 4.5, seed: 3300 },
  // 回転撃ち: 短命で、尾が回転の向き（+y）へ少し巻く
  spinShot: { tail: 15, half: 1.9, tailHalf: 1.2, head: 3.5, flick: 0.2, tailBright: 0.88, curl: 4, frames: 4, period: 0.08, spark: 5, sparkSpeed: 2.8, chip: 5, ringR: 4.5, seed: 3400 },
};

/**
 * 曳光（飛んでいる弾）: 原点 = 弾の中心、+x = 進む向き。弾頭の尖りから後ろへ細る尾。
 * 白は弾頭の芯だけ。curl があると尾は後ろほど +y へ曲がる（回りながら撃ち出された弾）
 */
function tracer(frame, f, g) {
  const len = g.tail * (1 + (hash1(f, g.seed) - 0.5) * 2 * g.flick);
  const H = g.half;
  const cx = -H * 0.5;
  const rxBack = H * 1.6;
  const rxFront = g.head + H * 0.5;
  const tailFrom = cx - rxBack * 0.4;
  paint(
    frame,
    (x, y) => {
      if (x > g.head + 1 || x < -len) return -1;
      let v = -1;
      const dx = x - cx;
      const rx = dx >= 0 ? rxFront : rxBack;
      const e = Math.hypot(dx / rx, y / H);
      if (e <= 1) {
        const pointed = dx >= 0 ? Math.abs(y) / H + dx / rx : 0;
        if (pointed <= 1.05) v = clamp01((1 - e) ** 0.5 * 1.15);
      }
      if (x < tailFrom) {
        const u = (tailFrom - x) / (len + tailFrom);
        const hw = g.tailHalf * (1 - u) ** 0.6 + 0.3;
        const d = Math.abs(y - g.curl * u * u);
        if (d <= hw) v = Math.max(v, clamp01((1 - d / hw) ** 0.6 * g.tailBright * (1 - u) ** 1.1 + 0.08));
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -H - 2, x1: g.head + 3, y1: H + g.curl + 2 }, dither: 0.03 },
  );
  // 尾から剥がれる火の粉（短命の弾は尾の根元寄り）
  const ex = -len * (0.4 + 0.4 * hash1(f, g.seed + 1));
  const u = (-ex) / len;
  const ey = (hash1(f, g.seed + 2) > 0.5 ? 1 : -1) * (g.tailHalf + 1.2) + g.curl * u * u;
  dot(frame, ex, ey, 4);
}

// -----------------------------------------------------------------------------
// 銃口の閃光（弾ごとに形を変える）。原点 = 弾が出た位置、+x = 撃った向き
// -----------------------------------------------------------------------------

/** 二丁拳銃: 小さく鋭い矢じり形の閃き。2 フレームで引き、排莢と火の粉だけ残る */
function muzzleTwinPistol(frame, f) {
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.7;
    snapFlash(frame, -2, 0, 0, s * 1.15);
    if (f === 0) sparkle(frame, -2, 0, 2);
  }
  if (f === 1) frontArc(frame, { ox: 7, radius: 4, width: 1.2, squash: 0.45, spread: 55 * DEG, bright: 0.55, seed: 3111 });
  if (f >= 1) {
    shards(frame, f - 1, 3, 3112, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.2;
      const sp = 2.5 + rnd(2) * 2;
      return { x: 6, y: (rnd(3) - 0.5) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
  ejectCasing(frame, f, { x: -8, y: 3, side: 2.6, back: 0.8, fall: 0.4, spin: 0, life: 4 });
}

/**
 * 双回転式: 前の太い針と斜め前の 2 本、丸い芯。2 フレーム目から前へ吹き出す硝煙の塊が膨らんで残る。
 * 片手の回転式（横へ漏れる火花）と違い、重さは「前へ吐き出す煙」で見せる
 */
function muzzleTwinRevolver(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 1 : f === 1 ? 1.1 : 0.6;
    spike(frame, { x: -2, a: 0, len: 20 * s, w: 4.4 * s, bright: 1 });
    spike(frame, { x: -2, a: 24 * DEG, len: 11 * s, w: 2.4 * s, bright: 0.9 });
    spike(frame, { x: -2, a: -24 * DEG, len: 11 * s, w: 2.4 * s, bright: 0.9 });
    spike(frame, { x: -2, a: 150 * DEG, len: 5 * s, w: 1.8 * s, bright: 0.75 });
    spike(frame, { x: -2, a: -150 * DEG, len: 5 * s, w: 1.8 * s, bright: 0.75 });
    flashCore(frame, -2, 0, 4 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, f === 0 ? 3 : 4);
  }
  // 硝煙: 前へ 3 つの塊が並んで膨らむ（段 2〜4）
  if (f >= 1) {
    const age = (f - 1) / (N - 1);
    for (let j = 0; j < 3; j++) {
      const r = 4.5 - j * 0.8;
      puff(frame, { x: 10 + j * 7 + age * 6, y: (hash1(j, 3211) - 0.5) * 5, r, age: Math.min(0.95, age + j * 0.12), seed: 3212 + j, bright: 0.5 - j * 0.05 });
    }
  }
  if (f >= 1 && f <= 2) frontArc(frame, { ox: 14 + f * 4, radius: 6 + f * 3, width: 2, squash: 0.5, erosion: Math.min(0.9, k * 0.8), bright: 0.7 - k * 0.3, seed: 3213 });
  if (f >= 2) {
    shards(frame, f - 2, 6, 3214, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.3;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 8, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 乱れ撃ち: 扇（±26°）に開く 9 本の針と大きな芯。8 発が同じ tick でまとめて 1 つの閃光になるので、
 * 扇の広がりで「一度に撒いた」ことを見せる。両手の排莢が左右へ 1 つずつ飛ぶ
 */
function muzzleBarrage(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.9 : f === 1 ? 1.1 : 0.7;
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 52 * DEG + (hash1(i + f * 11, 3311) - 0.5) * 5 * DEG;
      const len = (i % 2 === 0 ? 22 : 14) * (0.85 + 0.3 * hash1(i, 3312)) * s;
      spike(frame, { x: -2, a, len, w: (i % 2 === 0 ? 2.2 : 1.5) * s, bright: i % 2 === 0 ? 1 : 0.85, erosion: f === 2 ? 0.35 : 0, seed: 3313 + i });
    }
    spike(frame, { x: -2, a: Math.PI / 2 + 20 * DEG, len: 6 * s, w: 1.6 * s, bright: 0.75 });
    spike(frame, { x: -2, a: -Math.PI / 2 - 20 * DEG, len: 6 * s, w: 1.6 * s, bright: 0.75 });
    flashCore(frame, -2, 0, 4.5 * s, 1);
    if (f <= 1) sparkle(frame, -2, 0, f === 0 ? 3 : 4);
  }
  // 扇の先で外へ押す圧の弧（扇と同じ広がり）
  if (f >= 1 && f <= 4) frontArc(frame, { ox: 4, radius: 16 + f * 5, width: 1.8, squash: 1, spread: 30 * DEG, erosion: Math.min(0.9, k * 0.9), bright: 0.65 - k * 0.3, seed: 3314 });
  // 扇に散る火の粉
  if (f >= 1) {
    shards(frame, f - 1, 10, 3315, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 60 * DEG;
      const sp = 3 + rnd(2) * 3.5;
      return { x: 8 + rnd(3) * 6, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  ejectCasing(frame, f, { x: -8, y: -4, side: -2.8, back: 1, fall: 0.4, spin: 0, life: N - 1 });
  ejectCasing(frame, f, { x: -8, y: 4, side: 2.8, back: 1, fall: 0.4, spin: 2, life: N - 1 });
}

/**
 * 回転撃ち: 接線（時計回り）へ寝た 6 本の針の風車と、原点の周りを時計回りに巻く細い弧。
 * 全周へ撒く 12 発のうち、この向きへ出た分の閃光（どの向きでも回っていると分かる形）
 */
function muzzleSpin(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  const rot = f * 22 * DEG;
  if (f <= 2) {
    const s = f === 0 ? 0.9 : f === 1 ? 1.05 : 0.65;
    for (let i = 0; i < 6; i++) {
      const b = rot + (i / 6) * TAU;
      const x0 = Math.cos(b) * 2.5 - 1;
      const y0 = Math.sin(b) * 2.5;
      // 接線へ 50° 寝かせる（時計回り = 角が増える向き）。前（+x）を向く針ほど長い
      const a = b + 50 * DEG;
      const fwd = 0.55 + 0.45 * Math.max(0, Math.cos(b));
      spike(frame, { x: x0, y: y0, a, len: 13 * fwd * s, w: 1.8 * s, bright: 0.95, seed: 3411 + i });
    }
    spike(frame, { x: -1, a: 0, len: 16 * s, w: 2.2 * s, bright: 1 });
    flashCore(frame, -1, 0, 3 * s, 1);
    if (f === 1) sparkle(frame, -1, 0, 3);
  }
  // 巻く弧: 半径が広がりながら時計回りに進む 1 本（尾ほど暗く、崩れて消える）
  if (f >= 1) {
    const R = 8 + f * 3.5;
    const head = rot + 120 * DEG + f * 40 * DEG;
    const span = 150 * DEG;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x + 1, y);
        if (Math.abs(r - R) > 1.1) return -1;
        let s = (head - Math.atan2(y, x + 1)) % TAU;
        if (s < 0) s += TAU;
        if (s > span) return -1;
        const u = s / span;
        if (!survives(x, y, k * 0.9 + u * 0.3, 1 - u, 3412)) return -1;
        return clamp01((0.8 - 0.5 * u) * (1 - k * 0.4));
      },
      { bounds: { x0: -R - 3, y0: -R - 2, x1: R + 1, y1: R + 2 }, samples: 2 },
    );
  }
  // 接線へ飛ぶ火の粉と薬莢（回転に振り飛ばされる）
  if (f >= 1) {
    shards(frame, f - 1, 8, 3413, (i, rnd) => {
      const b = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 2.5;
      const a = b + 70 * DEG;
      return { x: Math.cos(b) * 5 - 1, y: Math.sin(b) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
  ejectCasing(frame, f, { x: -6, y: 5, side: 2.4, back: 2, fall: 0.2, spin: 1, life: N - 1 });
}

// -----------------------------------------------------------------------------
// 着弾・命中・尽きた（GUNS の数値で変える）
// -----------------------------------------------------------------------------

/** 着弾（壁・敵で消えた）: 当たった面の平たい閃きと、後ろの半球へ跳ね返る火花 */
function impact(frame, f, g) {
  const N = 7;
  const s = g.ringR / 5;
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -8 * s, bx: -1, by: 8 * s, T: (f === 0 ? 3.6 : 2.2) * s, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 8 * s, w: 2 * s, bright: 1 });
    spike(frame, { x: 0, a: Math.PI - 35 * DEG, len: 5 * s, w: 1.4 * s, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI + 35 * DEG, len: 5 * s, w: 1.4 * s, bright: 0.85 });
    flashCore(frame, 0, 0, 2.4 * s, 1);
    sparkle(frame, 0, 0, f === 0 && s > 1.2 ? 3 : 2);
  }
  shards(frame, f, g.spark, g.seed + 21, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.3;
    const sp = g.sparkSpeed * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 1 && f <= 3) {
    const n = Math.max(2, Math.round(g.spark / 3));
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (hash1(i, g.seed + 22) - 0.5) * 1.8;
      const r0 = 3 + f * 3 * s;
      const r1 = r0 + 5 * s;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.75 * (1 - f / N) });
    }
  }
  if (f >= 2) {
    const age = f - 2;
    for (let i = 0; i < 3; i++) {
      if (hash1(i + age * 3, g.seed + 23) < age / (N - 2)) continue;
      dot(frame, -1 - hash1(i, g.seed + 24) * 2, (hash1(i, g.seed + 25) - 0.5) * 6 * s, 3);
    }
  }
}

/** 命中（敵の体に食い込む）: 前の針と潰れた小さな輪、前（貫いた側）へ飛ぶ角ばった破片 */
function bulletHit(frame, f, g) {
  const s = g.ringR / 5;
  if (f <= 1) {
    spike(frame, { x: -2, a: 0, len: 10 * s, w: 2.4 * s, bright: 1 });
    spike(frame, { x: -2, a: 60 * DEG, len: 5 * s, w: 1.6 * s, bright: 0.8 });
    spike(frame, { x: -2, a: -60 * DEG, len: 5 * s, w: 1.6 * s, bright: 0.8 });
    flashCore(frame, -2, 0, 2.8 * s, 1);
    if (f === 0) sparkle(frame, -2, 0, s > 1.2 ? 3 : 2);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: g.ringR * (0.6 + f * 0.45), width: 1.6, squash: 0.6, erosion: Math.min(0.9, (f - 1) * 0.35), bright: 0.7 - f * 0.1, seed: g.seed + 31 });
  shards(frame, f, g.chip + 3, g.seed + 32, (i, rnd) => {
    const back = rnd(5) < 0.25;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.6 : (rnd(1) - 0.5) * 1.9;
    const sp = g.sparkSpeed * (back ? 0.6 : 1) * (0.8 + 0.8 * rnd(2));
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/** 尽きた（射程の端・二丁の弾）: dirs 1。燃え残りの火の粉と、上へ昇って切れる細い煙 */
function fizzleSmoke(frame, f, g) {
  const N = 7;
  const age = f / (N - 1);
  const s = g.ringR / 5;
  if (f === 0) stampEmber(frame, 5);
  else if (f <= 3) dot(frame, 0, -f * 0.8, Math.max(3, 6 - f));
  smokeWisp(frame, { x0: 0, y0: -1, height: 7 + 5 * s + f * 2.5, width: 0.7 * Math.min(1.3, s) + age * 0.6, age, seed: g.seed % 97, sway: 3, lean: -2, rise: 7, bright: 0.33 });
}

/**
 * 尽きた（乱れ撃ち・回転撃ちの短命の弾）: dirs 1。煙を残さず、小さく弾けて 4 つの火の粉が散り、すぐ消える。
 * 何十発も同時に尽きるので、煙の筋が並ぶと画面が濁る
 */
function fizzlePop(frame, f, g) {
  if (f === 0) {
    flashCore(frame, 0, 0, 2.2, 1);
    sparkle(frame, 0, 0, 2);
  } else if (f === 1) {
    flashCore(frame, 0, 0, 1.4, 0.7);
  }
  shards(frame, f, 5, g.seed + 41, (i, rnd) => {
    const a = (i / 5) * TAU + rnd(1) * 0.8;
    const sp = 1.6 + rnd(2) * 1.4;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, life: 3 + Math.floor(rnd(3) * 2), size: 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 近接の振り（ダッシュの反転撃ち・銃把打ち・蹴り撃ち・側転撃ち）と、その場で撃つ派生（二連・早抜き撃ち）
// -----------------------------------------------------------------------------

/** 塗りの衝撃の星（鈍器の打撃）。白は芯の中心だけ */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.4) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  flashCore(frame, x, y, o.core ?? R * 0.28, bright);
}

/**
 * ダッシュ攻撃（circle size 36、原点 = 自分）: ダッシュの終わりに踏ん張って反転撃ち。
 * 後ろ（−x）に滑った足の砂煙が弧に広がり、振り向く体の軌跡が 1 本の細い弧（時計回りに半周）を描く。
 * 弧の先（+x）で左右の銃口が 1 フレームずらして閃く
 */
function dash(frame, f) {
  const A = 3;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  // 振り向きの弧: 後ろ（−180°）から時計回りに前（0°）へ。先端は外縁だけ白い細い帯
  const R = 34;
  const start = -180 * DEG;
  const head = start + 180 * DEG * p + k * 25 * DEG;
  const span = (150 - 110 * k) * DEG * (0.5 + 0.5 * p);
  const T = 5 * (1 - k * 0.5);
  if (k < 0.9) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (r > R + 1 || r < R - T - 1) return -1;
        let s = (head - Math.atan2(y, x)) % TAU;
        if (s < 0) s += TAU;
        if (s > span) return -1;
        const u = s / span;
        const w = T * (1 - u) ** 0.5 + 0.6;
        const q = (R - r) / w;
        if (q < 0 || q > 1) return -1;
        if (!survives(x, y, k * 1.0 + u * 0.25, 1 - u, 4111)) return -1;
        if (R - r < 1.2 && u < 0.25 && k < 0.4) return 1;
        return clamp01((1 - q) ** 0.9 * (0.8 - 0.55 * u) * (1 - k * 0.35));
      },
      { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
    );
  }
  // 滑った足の砂煙: 後ろの下（+y 側、踏ん張った側）の地面を擦った帯。前半で伸び、以降は広がって欠ける
  {
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    dustBand(frame, { R: 22, from: 180 * DEG - 90 * DEG * grow, head: 180 * DEG, width: 6, age: Math.min(0.95, k * 1.05), seed: 4112, bright: 0.5 });
  }
  // 左右の銃口の閃き（反転し終えた瞬間に左、次に右）
  if (f === A - 1) snapFlash(frame, HAND + 6, -GUN_Y, -3 * DEG, 1.2);
  if (f === A) snapFlash(frame, HAND + 6, GUN_Y, 3 * DEG, 1.2);
  if (f === A) sparkle(frame, HAND + 8, -GUN_Y, 2);
  ejectCasing(frame, f - (A - 1), { x: HAND - 8, y: -GUN_Y - 2, side: -2.4, back: 1.2, fall: 0.3, spin: 0, life: 4 });
  ejectCasing(frame, f - A, { x: HAND - 8, y: GUN_Y + 2, side: 2.4, back: 1.2, fall: 0.3, spin: 2, life: 4 });
  if (f >= A) {
    shards(frame, f - A, 8, 4113, (i, rnd) => {
      const a = 180 * DEG - rnd(1) * 90 * DEG;
      const sp = 2 + rnd(2) * 2.5;
      return { x: Math.cos(a) * 22, y: Math.sin(a) * 22, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: 1, bright: 0.3 };
    });
  }
}

/**
 * 銃把打ち（box reach 12 / size 20、原点 = 当たりの中心 = 自分から 24 ドット先）:
 * 握った銃を裏拳で横に払う。斜め後ろ（左上）から当たりの中心へ短い 1 本の斬線（前へ反る）が走り、
 * 当たった所で角ばった星と「カチッ」とした十字の光点、衝撃で薬莢が 1 つ跳ねる
 */
function butt(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  if (k < 0.85) {
    // 払いの線: −y 側（反時計回りの側）から +y 側へ横切る。grow で伸び、振り終わりで崩れる
    lens(frame, { ax: -12, ay: -20, bx: 5, by: 8, T: 7 * (1 - k * 0.4), bend: 5, grow: Math.max(0.3, p), bias: 0.35, erosion: Math.min(0.95, k * 1.1), bright: 0.8 * (1 - k * 0.3), seed: 4211 });
  }
  if (f === A - 1) {
    bluntStar(frame, { x: 1, y: 2, R: 13, n: 6, seed: 4212, w: 2.6, core: 3.8, rot: 0.3 });
    sparkle(frame, 1, 2, 3);
  }
  if (f >= A) {
    const age = f - A + 1;
    if (age <= 2) bluntStar(frame, { x: 1, y: 2, R: 14 + age * 1.5, n: 6, seed: 4212, w: 2.6 * (1 - k * 0.5), core: 3 * (1 - k), bright: 0.85 - k * 0.4, erosion: Math.min(0.95, k * 1.6), rot: 0.3 });
    // 払った向き（+y と +x の間）へ押す潰れた弧
    if (age <= 3) frontArc(frame, { ox: 2 + age * 2, oy: 3 + age * 2, radius: 5 + age * 3.5, width: 1.8, squash: 0.6, spread: 65 * DEG, erosion: Math.min(0.9, age * 0.25), bright: 0.72 - age * 0.1, seed: 4213 });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 7, 4214, (i, rnd) => {
      const a = 0.1 + rnd(1) * 1.5;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 1, y: 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 2, drag: 0.8 };
    });
    // 衝撃で跳ねる薬莢（上 = −y へ）
    ejectCasing(frame, f - (A - 1), { x: -4, y: -4, side: -2.6, back: 1.4, fall: -0.3, spin: 1, life: 5 });
  }
}

/**
 * 二連（circle size 20、原点 = 自分）: 左の銃、次のフレームで右の銃が 1 発ずつ（±3°）。
 * 薬莢はそれぞれの外側へ飛び、最後に 2 つの銃口から煙の粒が漂う
 */
function twinShot(frame, f) {
  const N = 8;
  for (let j = 0; j < 2; j++) {
    const side = j === 0 ? -1 : 1;
    const a = side * 3 * DEG;
    const gx = HAND;
    const gy = side * GUN_Y;
    const age = f - j;
    if (age === 0) {
      snapFlash(frame, gx, gy, a, 1.6);
      sparkle(frame, gx, gy, 2);
    }
    if (age === 1) {
      sparkle(frame, gx + 8, gy, 2);
      frontArc(frame, { ox: gx + 8, oy: gy, radius: 3.5, width: 1.2, squash: 0.5, spread: 60 * DEG, bright: 0.6, seed: 4311 + j });
    }
    if (age === 2) frontArc(frame, { ox: gx + 10, oy: gy, radius: 6, width: 1.1, squash: 0.5, spread: 60 * DEG, erosion: 0.4, bright: 0.45, seed: 4311 + j });
    ejectCasing(frame, age, { x: gx - 10, y: gy + side * 2, side: side * 2.2, back: 1, fall: 0.3, spin: j * 2, life: 4 });
  }
  if (f >= N - 3) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      dot(frame, HAND + 4 + hash1(i, 4312) * 5, side * GUN_Y + (hash1(i, 4313) - 0.5) * 3 - (f - N + 3) * 1.2, 3);
    }
  }
}

/**
 * 早抜き撃ち（circle size 20、原点 = 自分）: 左右交互に 6 発を 4 フレームで撃ち切る。
 * 閃きは小さく（連射の軽さ）、同じフレームに 2 つ出るときは左右で大きさを変える。薬莢の列が左右へ流れ、
 * 撃ち終わりに 2 つの銃口の前へ細い硝煙がたなびく
 */
function quickFire(frame, f) {
  const N = 9;
  /** 6 発それぞれの撃つフレーム（前半ほど詰まる） */
  const SHOT_F = [0, 0, 1, 2, 2, 3];
  for (let j = 0; j < 6; j++) {
    const side = j % 2 === 0 ? -1 : 1;
    const a = side * (1 + hash1(j, 4411) * 3) * DEG;
    const gx = HAND + (hash1(j, 4412) - 0.5) * 3;
    const gy = side * GUN_Y + (hash1(j, 4413) - 0.5) * 2;
    const age = f - (SHOT_F[j] ?? 0);
    if (age === 0) snapFlash(frame, gx, gy, a, j % 4 === 0 ? 1.05 : 0.85);
    if (age === 1) dot(frame, gx + 9, gy, 6);
    ejectCasing(frame, age, { x: gx - 10, y: gy + side * 2, side: side * (1.8 + hash1(j, 4414)), back: 0.8 + hash1(j, 4415) * 0.6, fall: 0.3, spin: j, life: 4 });
  }
  // 連射の熱: 左右の銃口の前の細い 1px の揺らぎ（撃っている間）。弾には見えないよう暗く短く
  if (f >= 1 && f <= 4) {
    for (const side of [-1, 1]) {
      const y = side * GUN_Y + Math.sin(f * 1.7 + side) * 1.2;
      streakLine(frame, { ax: HAND + 6, ay: y, bx: HAND + 13, by: y + side * 1, bright: 0.38 });
    }
  }
  // 撃ち終わりの硝煙: 左右の銃口から後ろ上へたなびく粒
  if (f >= 4) {
    const age = f - 4;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      if (hash1(i + age * 5, 4416) < age / (N - 4) - 0.1) continue;
      dot(frame, HAND + 2 + hash1(i, 4417) * 7 - age * 1.2, side * GUN_Y + (hash1(i, 4418) - 0.5) * 3 + side * age * 0.8, 3);
    }
  }
}

/**
 * 蹴り撃ち（box reach 12 / size 20、原点 = 当たりの中心）: 前蹴りの足の軌跡（下から前へ反り上がる 1 本の線）が
 * 当たりの中心で止まり、足裏の面で前へ弾ける圧の弧と砂粒。蹴りと同時に上の銃（−y）が 1 発撃つ
 */
function kickShot(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  if (k < 0.85) {
    // 足の軌跡: +y 側（下）から前（当たりの中心）へ。反りは前へふくらむ
    lens(frame, { ax: -22, ay: 12, bx: 2, by: 0, T: 8 * (1 - k * 0.4), bend: -4, grow: Math.max(0.3, p), bias: -0.3, erosion: Math.min(0.95, k * 1.1), bright: 0.72 * (1 - k * 0.3), seed: 4511 });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 足裏の面: 前へ弾ける太めの圧の弧 1 本
    if (age <= 4) frontArc(frame, { ox: 1 + age * 2.5, radius: 6 + age * 4, width: 2.6 - age * 0.3, squash: 0.5, spread: 75 * DEG, erosion: Math.min(0.9, age * 0.22), bright: 0.8 - age * 0.1, seed: 4512 });
    // 足裏が当たった瞬間の鈍い星（刃ではないので白は芯だけ）
    if (age === 0) {
      bluntStar(frame, { x: 2, R: 12, n: 6, seed: 4514, w: 2.4, core: 3.4, rot: 0.25 });
      sparkle(frame, 2, 0, 3);
    } else if (age === 1) {
      bluntStar(frame, { x: 2, R: 13, n: 6, seed: 4514, w: 1.8, core: 1.5, bright: 0.75, erosion: 0.55, rot: 0.25 });
    }
    shards(frame, age, 8, 4513, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.6;
      const sp = 3 + rnd(2) * 3;
      return { x: 3, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  // 上の銃の 1 発（自分 = x −24 の手元から。蹴りの当たりと同じフレーム）
  const gx = -24 + HAND;
  const gy = -GUN_Y - 6;
  if (f === A - 1) snapFlash(frame, gx, gy, -2 * DEG, 1.2);
  if (f === A) sparkle(frame, gx + 9, gy, 2);
  ejectCasing(frame, f - (A - 1), { x: gx - 10, y: gy - 2, side: -2.2, back: 1, fall: 0.3, spin: 3, life: 4 });
}

/**
 * 側転撃ち（circle size 36・lunge 20、原点 = 自分）: 横へ転がりながら 2 発。
 * 転がる体の軌跡が自分の周りを時計回りに巻く砂煙の輪（塊の連なり）になり、後ろ（−x）に跳ねた砂が残る。
 * 起き上がった瞬間（active の終わり）に左右の銃口が ±10° で同時に閃く
 */
function rollShot(frame, f) {
  const A = 4;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  // 転がりの砂煙: 後ろ（−x）から時計回り（角が増える向き。−y 側を通る）に前へ、塊を順に置いていく
  const from = -180 * DEG;
  const sweep = 190 * DEG;
  dustBand(frame, { R: 24, from, head: from + sweep * Math.max(0.15, p), width: 4.5, age: Math.min(0.95, k * 1.05), seed: 4611, bright: 0.4 });
  // 転がりの弧（1 本）: 砂煙の輪の外縁に沿う細い速度線。回っている向きを見せる
  if (f >= 1 && k < 0.6) {
    const head = from + p * sweep;
    arcLine(frame, { radius: 34, from: head - (80 - 50 * k) * DEG, to: head, width: 1.2, bright: 0.7 * (1 - k) });
  }
  // 起き上がりの 2 発
  const shotF = A - 1;
  for (const side of [-1, 1]) {
    const a = side * 10 * DEG;
    const gx = Math.cos(a) * (HAND + 4);
    const gy = Math.sin(a) * (HAND + 4) + side * 3;
    if (f === shotF) snapFlash(frame, gx, gy, a, 1.3);
    if (f === shotF + 1) {
      sparkle(frame, gx + Math.cos(a) * 9, gy + Math.sin(a) * 9, 2);
      frontArc(frame, { ox: gx + 7, oy: gy, radius: 4, width: 1.2, squash: 0.5, spread: 60 * DEG, bright: 0.55, seed: 4612 });
    }
    ejectCasing(frame, f - shotF, { x: gx - 10, y: gy + side * 2, side: side * 2.4, back: 1, fall: 0.3, spin: side > 0 ? 2 : 0, life: 4 });
  }
  // 後ろに跳ねた砂粒
  if (f >= 1) {
    shards(frame, f - 1, 9, 4613, (i, rnd) => {
      const a = 180 * DEG + (rnd(1) - 0.3) * 1.4;
      const sp = 1.8 + rnd(2) * 2;
      return { x: -18 + rnd(3) * 8, y: -8 - rnd(4) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: 1, drag: 0.78, bright: 0.35 };
    });
  }
}

// -----------------------------------------------------------------------------
// 近接の命中
// -----------------------------------------------------------------------------

/**
 * 命中（銃把・蹴り・ダッシュが当たったとき）: 二丁の印として、前の 2 本の平行な針（上下にずらす）と
 * 斜めの短い針で角ばった閃きを作り、潰れた輪と前へ飛ぶ破片。
 * heavy は斜めの針が長く伸びて X 字に交差し、輪が太く、破片が多い
 */
function meleeHit(frame, f, heavy) {
  const s = heavy ? 1.45 : 1;
  const seed = heavy ? 4711 : 4721;
  if (f <= 1) {
    const g = f === 0 ? 0.85 : 1;
    // 平行の 2 本（二丁の銃口の間隔）
    for (const side of [-1, 1]) spike(frame, { x: 1, y: side * 2.4 * s, a: side * 4 * DEG, len: 14 * s * g, w: 1.7 * s, bright: 1 });
    // 斜めの針: 軽いものは短く、重いものは長く X 字に
    // 前寄りの斜め（±40°）を長く、後ろ（±140°）を短く。四隅が同じ長さだと「H」の字の塊に見える
    const diag = heavy ? 14 : 7;
    for (const [a, l] of [[40, 1], [-40, 1], [140, 0.55], [-140, 0.55]]) spike(frame, { x: 0, a: a * DEG, len: diag * l * g, w: heavy ? 2 : 1.5, bright: 0.85 });
    flashCore(frame, 0, 0, (heavy ? 4.5 : 3) * g, 1);
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : 2);
  } else if (f === 2) {
    for (const side of [-1, 1]) spike(frame, { x: 3, y: side * 2.4 * s, a: side * 4 * DEG, len: 14 * s, w: 1.3 * s, bright: 0.7, erosion: 0.6, seed: seed + 5 });
  }
  // 輪は閃きが引いてから（閃きの芯に小さな輪が重なると丸い的に見える）
  if (f >= 2) {
    const age = f - 1;
    ring(frame, { radius: (heavy ? 9 : 6) + age * (heavy ? 6 : 4.5), width: heavy ? 3 : 1.8, squash: 0.65, erosion: Math.min(0.95, age * 0.3), bright: 0.8 - age * 0.12, seed: seed + 1 });
  }
  shards(frame, f - 1, heavy ? 15 : 9, seed + 2, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.3 : 3.4);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 4 : 2.5);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  // 重い命中は薬莢のような金属片が 2 つ上下へ跳ねる（銃の打撃の印）
  if (heavy) {
    ejectCasing(frame, f - 1, { x: 2, y: -3, side: -3, back: -0.8, fall: 0.3, spin: 0, life: 5 });
    ejectCasing(frame, f - 1, { x: 2, y: 3, side: 3, back: -0.8, fall: 0.3, spin: 2, life: 5 });
  }
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 弾の key → 絵の名前（シートの key の接尾辞）と銃口の閃光 */
const BULLET_ART = {
  twinPistols: { name: "twinPistols", muzzle: muzzleTwinPistol, muzzleFrames: 4, muzzleSize: 64, fizzle: fizzleSmoke },
  twinRevolvers: { name: "twinRevolvers", muzzle: muzzleTwinRevolver, muzzleFrames: 6, muzzleSize: 96, fizzle: fizzleSmoke },
  "art.barrage": { name: "barrage", muzzle: muzzleBarrage, muzzleFrames: 6, muzzleSize: 88, fizzle: fizzlePop },
  "art.spinShot": { name: "spinShot", muzzle: muzzleSpin, muzzleFrames: 6, muzzleSize: 72, fizzle: fizzlePop },
};

/** 弾 1 種のシート（曳光・銃口・着弾・命中・尽きた） */
function gunSheets(bulletKey) {
  const art = BULLET_ART[bulletKey];
  const g = GUNS[art.name];
  const s = g.ringR / 5;
  return [
    { key: `gunner.${art.name}Fly`, dirs: SHOT_DIRS, frames: g.frames, active: 0, size: Math.ceil(g.tail * 1.25 + 8 + g.curl) * 2, draw: (frame, f) => tracer(frame, f, g) },
    { key: `gunner.${art.name}Muzzle`, dirs: DIRS, frames: art.muzzleFrames, active: 0, size: art.muzzleSize, draw: art.muzzle },
    { key: `gunner.${art.name}Impact`, dirs: DIRS, frames: 7, active: 0, size: Math.ceil(40 * s) + 16, draw: (frame, f) => impact(frame, f, g) },
    { key: `gunner.${art.name}Hit`, dirs: DIRS, frames: 6, active: 0, size: Math.ceil(44 * s) + 16, draw: (frame, f) => bulletHit(frame, f, g) },
    { key: `gunner.${art.name}Fizzle`, dirs: 1, frames: art.fizzle === fizzlePop ? 5 : 7, active: 0, size: 64, draw: (frame, f) => art.fizzle(frame, f, g) },
  ];
}

/** 弾の表の 1 行（物理の弾なので配色は真鍮の曳光） */
function bulletRow(bulletKey) {
  const art = BULLET_ART[bulletKey];
  const g = GUNS[art.name];
  return {
    fly: `gunner.${art.name}Fly`,
    period: g.period,
    base: 2,
    muzzle: `gunner.${art.name}Muzzle`,
    impact: `gunner.${art.name}Impact`,
    hit: `gunner.${art.name}Hit`,
    fizzle: `gunner.${art.name}Fizzle`,
    ramp: "brass",
  };
}

const BULLET_KEYS = Object.keys(BULLET_ART);

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "gunner",
  motions: {
    dash: { sheet: "gunner.dash", pivot: "self", base: 36, measure: "size" },
    "r:gunnerButt": { sheet: "gunner.butt", pivot: "anchor", base: 12, measure: "reach" },
    "branch:twinShot": { sheet: "gunner.twin", pivot: "self", base: 20, measure: "size" },
    "branch:quickFire": { sheet: "gunner.quick", pivot: "self", base: 20, measure: "size" },
    "branch:kickShot": { sheet: "gunner.kick", pivot: "anchor", base: 12, measure: "reach" },
    "branch:rollShot": { sheet: "gunner.roll", pivot: "self", base: 36, measure: "size" },
  },
  hit: "gunner.hit",
  hitHeavy: "gunner.hitHeavy",
  bullets: Object.fromEntries(BULLET_KEYS.map((key) => [key, bulletRow(key)])),
};

export const ATLAS = {
  key: "gunner",
  fx: FX,
  sheets: [
    { key: "gunner.dash", dirs: WIDE_DIRS, frames: 9, active: 3, size: 104, draw: dash },
    { key: "gunner.butt", dirs: DIRS, frames: 8, active: 3, size: 88, draw: butt },
    { key: "gunner.twin", dirs: DIRS, frames: 8, active: 3, size: 80, draw: twinShot },
    { key: "gunner.quick", dirs: DIRS, frames: 9, active: 4, size: 80, draw: quickFire },
    { key: "gunner.kick", dirs: DIRS, frames: 8, active: 3, size: 96, draw: kickShot },
    { key: "gunner.roll", dirs: WIDE_DIRS, frames: 9, active: 4, size: 96, draw: rollShot },
    { key: "gunner.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => meleeHit(frame, f, false) },
    { key: "gunner.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (frame, f) => meleeHit(frame, f, true) },
    ...BULLET_KEYS.flatMap(gunSheets),
  ],
};
