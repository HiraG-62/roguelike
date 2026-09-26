// 長銃（moveset "longarm"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs・sidearm.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/longarm.json × 2 が目安
//
// 奥義は見せ場なので、長銃の通常の弾（longarm.mjs の小銃・電磁砲…）より一段豪華にする:
// - 徹甲弾: 1 発の重さ。尖頭の大きな弾頭・弾頭の前の衝撃波（V 字の弓なりの波）・旋条の縞が流れる太い尾・後ろへ残る音速の輪
// - 掃射: 8 発の扇。弾は火の舌のようにちらつく太い曳光、銃口は扇に開く炎の舌、行為の絵は扇を走る 8 本の光と薬莢の雨
// - 狙撃手の息（持続）: 照準器の目盛り。発動で輪が締まって十字が通り、持続中は 4 つの括弧が体の周りをゆっくり回る
// 決まり（剣と同じ）: 白（段 7）は弾頭の芯・閃光の芯・光点だけ。尾・煙・纏いは段 6 以下。終わりは崩れて粒で消える
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光は 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;

// -----------------------------------------------------------------------------
// 共通の部品（sidearm.mjs の部品を写して、奥義の大きさに合わせたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定: ノイズと芯からの近さで、縁から先に欠ける */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角 */
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

/**
 * 前へ押し出す圧の弧（潰れた楕円の前側だけ）。全周の輪は閃光の横にぶら下がって見えるので、
 * 進む向き（+x）の ±spread だけ残す
 */
function frontArc(frame, o) {
  const { ox = 0, radius, width } = o;
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
      const a = Math.atan2(y, dx);
      if (Math.abs(a) > spread) return -1;
      const d = Math.abs(Math.hypot(dx, y) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      const edge = Math.abs(a) / spread;
      if (!survives(x, y, erosion + edge * 0.3, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - 0.45 * edge));
    },
    { bounds: { x0: ox - 2, y0: -pad, x1: ox + pad * squash + 2, y1: pad } },
  );
}

/** 円の帯の一部（中心 (ox, oy)、半径 R、角 from → to）。明るさは一様で、両端だけ細る。括弧・扇の波に使う */
function band(frame, o) {
  const { R, width, from, to } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 31;
  const mid = (from + to) / 2;
  const halfSpan = (to - from) / 2;
  const pad = R + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      let a = Math.atan2(dy, dx) - mid;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      const e = Math.abs(a) / halfSpan;
      if (e > 1) return -1;
      // 両端 15% で太さを絞る（角ばった切り口にしない）
      const w = (width / 2) * Math.min(1, (1 - e) / 0.15 + 0.3);
      const d = Math.abs(Math.hypot(dx, dy) - R);
      if (d > w) return -1;
      const q = d / Math.max(0.5, w);
      if (!survives(x, y, erosion + e * 0.2, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.45 * q));
    },
    { bounds: { x0: ox - pad, y0: oy - pad, x1: ox + pad, y1: oy + pad } },
  );
}

/** 薬莢: 2〜3 ドットの真鍮の棒。spin で 45° ずつ回る。白を使わない（閃光より目立たせない） */
function casing(frame, x, y, spin, fade = 0, big = false) {
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
  // 徹甲弾の薬莢は長い（小銃弾より一回り大きい筒）
  if (big) dot(frame, x - cx * 2, y - cy * 2, Math.max(2, hi - 2));
}

/** 横（+y、排莢口の側）へ飛ぶ薬莢。age（フレーム）で放物線を描き、回りながら落ちる */
function ejectCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  const x = o.x - o.back * t;
  const y = o.y + o.side * t - 0.35 * t * t * o.fall;
  casing(frame, x, y, o.spin + t, t / (o.life + 1), o.big);
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

/** 極細の閃光（直線）。x0 → x1、全長で均一（streakLine は片側が暗くなる）。両端だけ尖らせる */
function hairline(frame, x0, x1, y, width, bright) {
  if (x1 - x0 < 2) return;
  paint(
    frame,
    (x, py) => {
      if (x < x0 || x > x1) return -1;
      if (Math.abs(py - y) > width / 2) return -1;
      const edge = Math.min(x - x0, x1 - x) / 10;
      return clamp01(bright * (0.5 + 0.5 * Math.min(1, edge)));
    },
    { bounds: { x0, y0: y - width - 1, x1, y1: y + width + 1 }, dither: 0 },
  );
}

// =============================================================================
// 徹甲弾（volley: pistol・1 発・半径 4・速さ ×2・貫通 99）
// =============================================================================

/** 弾の半径（論理 px。数値表の radius） */
const AP_RADIUS = 4;
/** 弾頭の半幅・尖頭の長さ・後ろの長さ（半径 4 論理 px = 8 ドットより少し細い胴で、尖りを長く） */
const AP_H = 6;
const AP_NOSE = 15;
const AP_BACK = 10;
/** 尾の長さ（速さ 約 600 px/秒 × 0.04 秒 = 48 ドットの倍近く。見せ場の長い尾） */
const AP_TAIL = 88;
const AP_N = 6;
/** 弾頭の前の衝撃波（V 字）の広がり */
const AP_SHOCK_Y = 20;
const AP_SHOCK_K = 0.085;

/**
 * 徹甲弾の弾（fly）: 尖頭の大きな弾頭（白い芯は前の中央線だけ・胴の帯は暗く）、弾頭の前の弓なりの衝撃波、
 * 旋条の斜めの縞が後ろへ流れる太い尾、尾に沿って後ろへ流れる音速の輪 2 枚、尾から剥がれる火の粉
 */
function apFly(frame, f) {
  const ph = f / AP_N;
  // 1) 尾: 弾頭の後ろから −x へ細る。斜めの縞が位相で流れ（弾が回っている）、後ろ半分は切れ切れになる
  const tailFrom = -AP_BACK * 0.6;
  paint(
    frame,
    (x, y) => {
      if (x > tailFrom || x < -AP_TAIL) return -1;
      const u = (tailFrom - x) / (AP_TAIL + tailFrom);
      const hw = AP_H * 0.8 * (1 - u) ** 0.75 + 0.4;
      const d = Math.abs(y);
      if (d > hw) return -1;
      if (u > 0.5 && valueNoise((x + ph * 30) * 0.4, y * 2, 3, 7301) < (u - 0.5) * 1.3) return -1;
      const stripe = 0.76 + 0.24 * Math.sin((x + ph * 26) * 0.5 + y * 1.1);
      return Math.min(0.74, clamp01((1 - d / hw) ** 0.6 * 0.82 * (1 - u) ** 0.85 * stripe + 0.06));
    },
    { bounds: { x0: -AP_TAIL - 2, y0: -AP_H - 2, x1: tailFrom + 1, y1: AP_H + 2 }, dither: 0.03 },
  );
  // 2) 弾頭: 胴（x < 0）は平らで、前は長い尖頭。芯の中央線だけ白、胴の帯（x ≈ −4）は段を落とす
  paint(
    frame,
    (x, y) => {
      if (x < -AP_BACK || x > AP_NOSE) return -1;
      const u = x > 0 ? x / AP_NOSE : 0;
      const back = x < -AP_BACK + 2 ? 0.8 : 1;
      const half = AP_H * (1 - u ** 1.7) ** 0.62 * back;
      const d = Math.abs(y);
      if (d > half + 0.2) return -1;
      if (d < 1.1 && x > -4 && x < AP_NOSE - 2) return 1;
      const q = d / (half + 0.2);
      const bandDark = Math.abs(x + 4) < 1.2 ? 0.55 : 1;
      return clamp01(((1 - q) ** 0.45 * 0.82 + 0.1 * u) * bandDark + 0.08);
    },
    { bounds: { x0: -AP_BACK - 1, y0: -AP_H - 1, x1: AP_NOSE + 1, y1: AP_H + 1 } },
  );
  // 3) 衝撃波: 尖頭の先から後ろへ開く弓なりの波（x = 頂点 − k y²）。胴の外側だけに引く
  const vx = AP_NOSE + 3;
  paint(
    frame,
    (x, y) => {
      const ay = Math.abs(y);
      if (ay < AP_H + 1 || ay > AP_SHOCK_Y) return -1;
      const px = vx - AP_SHOCK_K * y * y;
      if (Math.abs(x - px) > 0.9) return -1;
      const u = (ay - AP_H) / (AP_SHOCK_Y - AP_H);
      // 位相で波の外側がちらつく（空気を裂き続けている）
      if (u > 0.6 && hash1(Math.round(ay) + f * 5, 7302) < (u - 0.6) * 1.5) return -1;
      return clamp01(0.62 * (1 - u) + 0.14);
    },
    { bounds: { x0: vx - AP_SHOCK_K * AP_SHOCK_Y * AP_SHOCK_Y - 2, y0: -AP_SHOCK_Y - 1, x1: vx + 2, y1: AP_SHOCK_Y + 1 }, dither: 0 },
  );
  // 4) 音速の輪: 尾に沿って後ろへ流れる縦長の輪 2 枚（位相で 1 巡して戻る）
  for (let j = 0; j < 2; j++) {
    const t = (ph + j / 2) % 1;
    ring(frame, { ox: -14 - t * 56, radius: 8 + t * 6, width: 1.4, squash: 0.3, erosion: Math.min(0.9, 0.1 + t * 0.7), bright: 0.58 * (1 - t) + 0.08, seed: 7303 + j });
  }
  // 5) 尾から剥がれる火の粉
  for (let i = 0; i < 3; i++) {
    const ex = -18 - hash1(i + f * 3, 7304) * 56;
    const side = hash1(i + f * 7, 7305) > 0.5 ? 1 : -1;
    const u = (-ex - 6) / AP_TAIL;
    dot(frame, ex, side * (AP_H * 0.8 * (1 - u) + 2 + hash1(i, 7306) * 2), i === 0 ? 4 : 3);
  }
}

/**
 * 徹甲弾の銃口: 通常の小銃より一回り大きい閃光。前へ長く太い針・斜め前の 2 本・制退器の真横の太い噴き、
 * 銃口を抜けた所の縦長の衝撃の円盤、前へ押し出す二重の圧の弧（時間差）、長い薬莢と横に昇る煙
 */
function apMuzzle(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.9 : f === 1 ? 1 : 0.55;
    spike(frame, { x: -2, a: 0, len: 66 * s, w: 7 * s, bright: 1 });
    spike(frame, { x: -2, a: 17 * DEG, len: 26 * s, w: 3 * s, bright: 0.9 });
    spike(frame, { x: -2, a: -17 * DEG, len: 26 * s, w: 3 * s, bright: 0.9 });
    for (const side of [-1, 1]) {
      spike(frame, { x: -7, y: side * 3, a: side * 94 * DEG, len: 24 * s, w: 5 * s, bright: 0.92 });
      spike(frame, { x: -7, y: side * 3, a: side * 118 * DEG, len: 13 * s, w: 2.4 * s, bright: 0.72 });
      spike(frame, { x: -12, y: side * 3, a: side * 100 * DEG, len: 10 * s, w: 2 * s, bright: 0.65 });
    }
    flashCore(frame, -2, 0, 7 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, 4);
    if (f === 1) sparkle(frame, 52, 0, 2);
  }
  // 銃口を抜けた所の衝撃の円盤（撃った向きに潰れた縦長の輪）
  if (f <= 4) ring(frame, { ox: 6 + f * 3, radius: 9 + f * 6, width: 2.4 - f * 0.3, squash: 0.28, erosion: Math.min(0.9, f * 0.2), bright: 0.8 - f * 0.12, seed: 7311 });
  // 二重の圧の弧（2 枚目は 1 枚遅れ、小さく）
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 24 + age * 9, radius: 11 + age * 5, width: 3, squash: 0.42, erosion: Math.min(0.92, k * 0.9), bright: 0.78 - k * 0.3, seed: 7312 });
  }
  if (f >= 2) {
    const age = f - 2;
    frontArc(frame, { ox: 14 + age * 7, radius: 7 + age * 4, width: 2, squash: 0.42, erosion: Math.min(0.95, k * 1.05), bright: 0.6 - k * 0.25, seed: 7313 });
  }
  // 前へ抜ける火の粉
  if (f >= 2) {
    shards(frame, f - 2, 10, 7314, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 0.7;
      const sp = 4 + rnd(2) * 4;
      return { x: 20 + rnd(3) * 20, y: (rnd(4) - 0.5) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(5) * 3), size: 1 };
    });
  }
  // 長い薬莢
  ejectCasing(frame, f - 1, { x: -14, y: 5, side: 3.6, back: 1.2, fall: 0.4, spin: 0, life: N - 2, big: true });
  // 制退器の横から立つ煙の粒（向きに付いて外へ広がる）
  if (f >= 2) {
    for (let i = 0; i < 6; i++) {
      if (hash1(i + f * 3, 7315) < (f - 2) / 7) continue;
      const side = i % 2 === 0 ? 1 : -1;
      dot(frame, -8 + hash1(i, 7316) * 6 - (f - 2), side * (10 + (f - 2) * 3.5 + hash1(i, 7317) * 4), f > 5 ? 2 : 3);
    }
  }
}

/**
 * 徹甲弾の命中（貫く）: 弾が敵の体を抜ける。入った所と抜けた所の縦長の円盤、体を貫く太い光条、
 * 前（抜けた側）へ開く破片の円錐。通常の小銃の命中より大きく長い
 */
function apHit(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 2) {
    const w = f === 0 ? 3.4 : f === 1 ? 2.2 : 1.2;
    streakLine(frame, { ax: -30, ay: 0, bx: 44 + f * 10, by: 0, width: w, bright: 0.95 - f * 0.12 });
  }
  if (f <= 1) {
    spike(frame, { x: 2, a: 0, len: 40, w: 3.4, bright: 1 });
    spike(frame, { x: 2, a: 14 * DEG, len: 20, w: 2, bright: 0.85 });
    spike(frame, { x: 2, a: -14 * DEG, len: 20, w: 2, bright: 0.85 });
    flashCore(frame, 0, 0, 5, 1);
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  }
  if (f <= 4) ring(frame, { radius: 9 + f * 4, width: 2.2, squash: 0.3, erosion: Math.min(0.9, f * 0.2), bright: 0.8 - f * 0.12, seed: 7321 });
  if (f >= 1 && f <= 5) {
    const a = f - 1;
    ring(frame, { ox: 16 + a * 4, radius: 6 + a * 5, width: 1.8, squash: 0.38, erosion: Math.min(0.92, a * 0.2), bright: 0.7 - a * 0.1, seed: 7322 });
  }
  shards(frame, f, 18, 7323, (i, rnd) => {
    const back = rnd(5) < 0.2;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.2 : (rnd(1) - 0.5) * 1.0;
    const sp = (back ? 2.5 : 4) + rnd(2) * 4;
    return { x: back ? -2 : 8, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.84 };
  });
  if (k > 0.5) {
    for (let i = 0; i < 4; i++) {
      if (hash1(i + f * 3, 7324) < k * 0.7) continue;
      dot(frame, 20 + hash1(i, 7325) * 30 + f * 2, (hash1(i, 7326) - 0.5) * 16, 3);
    }
  }
}

/**
 * 徹甲弾の着弾（壁に刺さって止まる）: 当たった面の大きな平たい閃き、面に沿って潰れた輪、
 * 後ろの半球へ跳ね返る多くの火花とその軌跡、面に残る焦げの点
 */
function apImpact(frame, f) {
  const N = 8;
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -17, bx: -1, by: 17, T: f === 0 ? 6 : 3.6, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 18, w: 3.4, bright: 1 });
    spike(frame, { x: 0, a: Math.PI - 30 * DEG, len: 11, w: 2, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI + 30 * DEG, len: 11, w: 2, bright: 0.85 });
    flashCore(frame, 0, 0, 5, 1);
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  }
  if (f >= 1 && f <= 5) ring(frame, { radius: 6 + f * 4, width: 2, squash: 0.3, erosion: Math.min(0.92, f * 0.17), bright: 0.75 - f * 0.1, seed: 7331 });
  shards(frame, f, 18, 7332, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.5;
    const sp = 4.2 * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 4), size: rnd(5) > 0.3 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 1 && f <= 3) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (hash1(i, 7333) - 0.5) * 2;
      const r0 = 4 + f * 4;
      const r1 = r0 + 8;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.8 * (1 - f / N) });
    }
  }
  if (f >= 2) {
    for (let i = 0; i < 5; i++) {
      if (hash1(i + f * 3, 7334) < (f - 2) / (N - 2)) continue;
      dot(frame, -1 - hash1(i, 7335) * 2, (hash1(i, 7336) - 0.5) * 14, 3);
    }
  }
}

/** 徹甲弾が尽きた: dirs 1。弾頭の赤熱が小さな輪を残して冷め、太めの煙が画面の上へ昇って切れる */
function apFizzle(frame, f) {
  const N = 8;
  const age = f / (N - 1);
  if (f <= 1) flashCore(frame, 0, 0, 4 - f, 0.95);
  else if (f <= 4) {
    dot(frame, 0, -f * 0.8, Math.max(3, 6 - f));
    dot(frame, 1, -f * 0.8, Math.max(2, 5 - f));
  }
  if (f >= 1 && f <= 4) ring(frame, { radius: 4 + f * 3, width: 1.4, erosion: Math.min(0.9, f * 0.22), bright: 0.55 - f * 0.08, seed: 7341 });
  smokeWisp(frame, { x0: 0, y0: -1, height: 18 + f * 3, width: 1.6 + age * 0.8, age, seed: 43, sway: 3.6, lean: 3, rise: 8, bright: 0.36 });
}

/** 徹甲弾の弾の通り道の長さ（行為の絵。一直線の照準の糸が伸びる） */
const AP_LINE = 190;
const AP_FIRE_N = 8;

/**
 * 徹甲弾の行為（自分の位置・照準の向き）: 撃った瞬間に照準の糸（極細の閃光）が通り道を一直線に貫き、
 * 糸の上に音速の輪が時間差で立つ（弾が通った跡）。後ろには反動で足元の砂が吹く
 */
function apFire(frame, f) {
  const k = f / (AP_FIRE_N - 1);
  // 1) 照準の糸: 最初の 2 枚で端まで、以降は始点側から消えて細る
  if (f <= 4) {
    const x0 = f <= 1 ? 16 : 16 + (f - 1) * 44;
    const x1 = f === 0 ? AP_LINE * 0.7 : AP_LINE;
    hairline(frame, x0, x1, 0, f <= 1 ? 1.6 : 1, f <= 1 ? 1 : 0.75 - f * 0.08);
    if (f <= 1) sparkle(frame, x1 - 2, 0, f === 1 ? 3 : 2);
  }
  // 2) 音速の輪: 糸の上に 3 つ、順に立って広がり崩れる
  for (let j = 0; j < 3; j++) {
    const age = f - j;
    if (age < 0 || age > 4) continue;
    ring(frame, { ox: 56 + j * 50, radius: 7 + age * 3.5, width: 2 - age * 0.25, squash: 0.32, erosion: Math.min(0.92, age * 0.22), bright: 0.72 - age * 0.12, seed: 7351 + j });
  }
  // 3) 反動: 足元から後ろへ吹く砂の筋と、後ろへ潰れた輪
  if (k < 0.85) {
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (4 + Math.floor(i / 2) * 5 + hash1(i, 7352) * 2);
      const x0 = -10 - f * 5 - hash1(i, 7353) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 14 - hash1(i, 7354) * 14, by: y + side * 3, bright: 0.5 * (1 - k) });
    }
  }
  if (f <= 5) ring(frame, { ox: -8 - f * 2, radius: 8 + f * 4.5, width: 2.2 - f * 0.25, squash: 0.5, erosion: Math.min(0.92, f * 0.18), bright: 0.65 - f * 0.08, seed: 7355 });
  shards(frame, f, 10, 7356, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.5;
    const sp = 2.5 + rnd(2) * 3;
    return { x: -8, y: (rnd(3) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 1 };
  });
}

/**
 * 徹甲弾の発動: 照準が絞られる。前方の標的の位置へ 4 つの鉤（括弧）が外から締まり、
 * 自分から標的へ細い照準の線が伸び、締まりきった瞬間に標的の中心が光る。銃身の後ろで遊底を引く閃き
 */
function apCast(frame, f) {
  const N = 8;
  const TX = 76;
  const settle = 4;
  const p = Math.min(1, (f + 1) / settle);
  const fade = f < settle ? 0 : (f - settle + 1) / (N - settle);
  const R = 26 - 14 * easeSwing(p);
  const b = (0.5 + 0.35 * p) * (1 - fade * 0.8);
  // 4 つの鉤（斜め 45° の位置に 50° の短い弧）。締まりきると明るく、以降は崩れる
  for (let i = 0; i < 4; i++) {
    const c = (i / 4) * TAU + Math.PI / 4;
    band(frame, { ox: TX, R, width: 2, from: c - 25 * DEG, to: c + 25 * DEG, bright: b, erosion: fade * 0.9, seed: 7361 + i });
  }
  // 照準の線（自分 → 標的の手前）
  if (fade < 0.8) streakLine(frame, { ax: 12, ay: 0, bx: 12 + (TX - R - 16) * p, by: 0, bright: 0.55 * (1 - fade) });
  // 十字の短い刻み（標的の輪の内側へ）
  if (f >= 2 && fade < 0.9) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      streakLine(frame, { ax: TX + Math.cos(a) * (R + 6), ay: Math.sin(a) * (R + 6), bx: TX + Math.cos(a) * (R - 3), by: Math.sin(a) * (R - 3), bright: 0.6 * (1 - fade) });
    }
  }
  if (f === settle - 1) sparkle(frame, TX, 0, 4);
  if (f === settle) sparkle(frame, TX, 0, 2);
  // 遊底を引く閃き（銃身の後ろ、横へ短く）
  if (f <= 2) {
    spike(frame, { x: -6, y: 4, a: 150 * DEG, len: 9 - f * 2, w: 1.6, bright: 0.8 });
    spike(frame, { x: -6, y: 4, a: 100 * DEG, len: 6 - f, w: 1.4, bright: 0.7 });
  }
}

// =============================================================================
// 掃射（volley: pistol・8 発・1 発ごとに 8.5°（扇は約 60°）・半径 3・速さ ×1.3）
// =============================================================================

const SF_RADIUS = 3;
/** 1 発ごとの角と発数（行為の絵の 8 本の光を弾の向きに揃える） */
const SF_STEP = 8.5 * DEG;
const SF_COUNT = 8;
/** 弾頭の半幅と尾の長さ（速さ 約 390 px/秒 × 0.04 秒 = 31 ドットより長め） */
const SF_H = 3.4;
const SF_TAIL = 42;
const SF_N = 4;

/**
 * 掃射の弾（fly）: 太く短い曳光。尾は火の舌のように縁がちらつき（フレームごとに形が変わる）、
 * 弾頭は丸い。徹甲弾（尖頭・縞・衝撃波）と形で見分ける
 */
function sfFly(frame, f) {
  const len = SF_TAIL * (1 + (hash1(f, 7401) - 0.5) * 0.16);
  paint(
    frame,
    (x, y) => {
      if (x > SF_H + 2 || x < -len) return -1;
      let v = -1;
      // 弾頭: 前が丸い楕円。中心の数ドットだけ白
      const e = Math.hypot(x / (SF_H * 1.3), y / SF_H);
      if (e <= 1) v = e < 0.35 ? 1 : clamp01((1 - e) ** 0.5 * 0.95 + 0.05);
      if (x < -SF_H * 0.4) {
        const u = -x / len;
        const n = valueNoise(x + f * 9.7, y * 1.5 + f * 3.3, 4, 7402);
        const hw = (SF_H * 0.95 * (1 - u) ** 0.7 + 0.3) * (0.7 + 0.6 * n * (0.4 + u));
        const d = Math.abs(y);
        if (d <= hw) v = Math.max(v, Math.min(0.74, clamp01((1 - d / hw) ** 0.55 * 0.82 * (1 - u) ** 1.05 + 0.06)));
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -SF_H * 2.2, x1: SF_H + 3, y1: SF_H * 2.2 }, dither: 0.03 },
  );
  // 尾の外へ剥がれる火の粉 2 つ（フレームごとに位置が変わる）
  for (let i = 0; i < 2; i++) {
    const ex = -len * (0.35 + 0.5 * hash1(i + f * 3, 7403));
    const side = hash1(i + f * 5, 7404) > 0.5 ? 1 : -1;
    dot(frame, ex, side * (SF_H + 1.5 + hash1(i, 7405) * 2), i === 0 ? 4 : 3);
  }
}

/**
 * 掃射の銃口（同じ tick の 8 発で 1 つにまとまって出る）: 扇に開く 5 枚の炎の舌（中央が長い）、
 * 扇の幅いっぱいの圧の弧、排莢口から続けて飛ぶ薬莢 3 つ
 */
function sfMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.85 : f === 1 ? 1 : 0.55;
    const tongues = [
      { a: -30, len: 22 },
      { a: -15, len: 30 },
      { a: 0, len: 38 },
      { a: 15, len: 30 },
      { a: 30, len: 22 },
    ];
    tongues.forEach((t, i) => {
      // 炎の舌はフレームごとに少し揺れる（針の星と見分ける）
      const jitter = (hash1(i + f * 5, 7411) - 0.5) * 6 * DEG;
      spike(frame, { x: -2, a: t.a * DEG + jitter, len: t.len * s * (0.9 + 0.2 * hash1(i + f, 7412)), w: (i === 2 ? 4.4 : 3.2) * s, bright: i === 2 ? 1 : 0.88 });
    });
    flashCore(frame, -2, 0, 5.5 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 10 + age * 6, radius: 16 + age * 6, width: 2.4, squash: 0.62, spread: 42 * DEG, erosion: Math.min(0.92, k * 0.9), bright: 0.72 - k * 0.3, seed: 7413 });
  }
  for (let j = 0; j < 3; j++) ejectCasing(frame, f - j, { x: -10, y: 4, side: 3 + j * 0.4, back: 0.8 + j * 0.3, fall: 0.5, spin: j, life: N - 1 - j });
  if (f >= 2) {
    shards(frame, f - 2, 8, 7414, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.1;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 10 + rnd(3) * 12, y: (rnd(4) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(5) * 2), size: 1 };
    });
  }
}

/** 掃射の着弾: 当たった面の閃き、後ろへ跳ね返る火花の束、面から舐めるように返る短い炎の舌 3 枚 */
function sfImpact(frame, f) {
  const N = 7;
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -11, bx: -1, by: 11, T: f === 0 ? 4.4 : 2.8, bias: 0, bright: 0.95 });
    flashCore(frame, 0, 0, 3.6, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f <= 3) {
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 38 * DEG + (hash1(i + f, 7421) - 0.5) * 0.2;
      spike(frame, { x: -1, a, len: (12 - Math.abs(i - 1) * 3) * (1 - f * 0.18), w: 2.6, bright: 0.85 - f * 0.12, erosion: f * 0.25, seed: 7422 + i });
    }
  }
  shards(frame, f, 13, 7423, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 3.6 * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 3) {
    for (let i = 0; i < 3; i++) {
      if (hash1(i + f * 3, 7424) < (f - 3) / (N - 3)) continue;
      dot(frame, -1 - hash1(i, 7425) * 3, (hash1(i, 7426) - 0.5) * 8, 3);
    }
  }
}

/** 掃射の命中: 体に食い込む短い閃光と潰れた輪、前へ飛ぶ角ばった破片（徹甲弾のように抜けない） */
function sfHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -3, a: 0, len: 16, w: 3, bright: 1 });
    spike(frame, { x: -3, a: Math.PI / 2, len: 7, w: 2, bright: 0.8 });
    spike(frame, { x: -3, a: -Math.PI / 2, len: 7, w: 2, bright: 0.8 });
    flashCore(frame, -2, 0, 4, 1);
    if (f === 0) sparkle(frame, -2, 0, 3);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: 6 + f * 3.5, width: 2, squash: 0.6, erosion: Math.min(0.9, (f - 1) * 0.3), bright: 0.72 - f * 0.1, seed: 7431 });
  shards(frame, f, 14, 7432, (i, rnd) => {
    const back = rnd(5) < 0.25;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.6 : (rnd(1) - 0.5) * 1.8;
    const sp = (back ? 2.2 : 3.6) * (0.8 + 0.8 * rnd(2));
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/** 掃射の弾が尽きた: dirs 1。火の粉が 2 つ残り、細い煙が昇る */
function sfFizzle(frame, f) {
  const N = 7;
  const age = f / (N - 1);
  if (f === 0) {
    dot(frame, 0, 0, 6);
    dot(frame, 1, 0, 5);
    dot(frame, 0, 1, 5);
  } else if (f <= 3) {
    dot(frame, 0, -f * 0.8, Math.max(3, 6 - f));
    dot(frame, 3, -f * 1.4 + 1, Math.max(2, 5 - f));
  }
  smokeWisp(frame, { x0: 0, y0: -1, height: 12 + f * 2.5, width: 1.1 + age * 0.6, age, seed: 47, sway: 3, lean: -2, rise: 7, bright: 0.33 });
}

/** 掃射の行為の絵の半径（扇を走る光の届き） */
const SW_R = 92;
const SW_N = 9;

/** 発数 i（0..7）の角。fanDirections と同じ並び（中央から ±） */
function sweepAngle(i) {
  return (i - (SF_COUNT - 1) / 2) * SF_STEP;
}

/**
 * 掃射の行為（自分の位置・照準の向き）: 扇の 8 本の射線が時計回りに 3 枚で順に走り（掃射の手応え）、
 * 扇の幅いっぱいの圧の波が外へ押し出して崩れ、排莢口から薬莢が雨のように横へ散る
 */
function sfSweep(frame, f) {
  const k = f / (SW_N - 1);
  // 1) 射線: 弾の向きに 1 本ずつ。先頭の 3 本、中の 3 本、終わりの 2 本の順に立ち、前へ抜けて細る
  for (let i = 0; i < SF_COUNT; i++) {
    const start = Math.floor(i / 3);
    const age = f - start;
    if (age < 0 || age > 3) continue;
    const a = sweepAngle(i);
    const r0 = 14 + age * 16;
    const r1 = Math.min(SW_R, r0 + 34 - age * 4);
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: age === 0 ? 2.2 : 1.3, bright: 0.95 - age * 0.18 });
    if (age === 0) sparkle(frame, Math.cos(a) * 12, Math.sin(a) * 12, 2);
  }
  // 2) 扇の圧の波（1 本）: 扇の幅で外へ広がり、端から崩れる
  if (f >= 1) {
    const age = f - 1;
    const R = 24 + age * 9;
    const spread = ((SF_COUNT - 1) / 2) * SF_STEP + 6 * DEG;
    band(frame, { R, width: Math.max(1.4, 3.4 - age * 0.3), from: -spread, to: spread, bright: 0.78 - age * 0.07, erosion: Math.min(0.92, 0.05 + age * 0.13), seed: 7441 });
  }
  // 3) 薬莢の雨: 1 発に 1 つ、射線が立つ時刻に排莢口（原点の後ろの右）から横へ
  for (let i = 0; i < SF_COUNT; i++) {
    const t0 = Math.floor(i / 3);
    ejectCasing(frame, f - t0, { x: -8 - hash1(i, 7442) * 3, y: 5, side: 2.6 + hash1(i, 7443) * 1.8, back: 0.6 + hash1(i, 7444) * 0.9, fall: 0.35, spin: i, life: 5 });
  }
  // 4) 扇の前に残る煙の粒（終わりに向けてまばらに）
  if (f >= 3) {
    for (let i = 0; i < 10; i++) {
      if (hash1(i + f * 3, 7445) < (f - 3) / (SW_N - 2)) continue;
      const a = sweepAngle(i % SF_COUNT) + (hash1(i, 7446) - 0.5) * 0.1;
      const r = 20 + hash1(i, 7447) * 30 + f * 2;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, k > 0.7 ? 2 : 3);
    }
  }
}

/**
 * 掃射の発動: 扇の弧が時計回りに引かれ（撃ち広げる範囲の予告）、弧に 8 つの刻みが順に灯る。
 * 手元では遊底を引く閃きと、一気に装填する弾帯の火花
 */
function sfCast(frame, f) {
  const N = 7;
  const R = 44;
  const spread = ((SF_COUNT - 1) / 2) * SF_STEP;
  const draw = Math.min(1, (f + 1) / 4);
  const fade = f < 4 ? 0 : (f - 3) / (N - 3);
  if (fade < 1) {
    arcLine(frame, { radius: R, from: -spread, to: -spread + 2 * spread * draw, width: 1.4, bright: 0.6 * (1 - fade) + 0.1 });
    for (let i = 0; i < SF_COUNT; i++) {
      if (i / (SF_COUNT - 1) > draw + 0.01) continue;
      if (fade > 0 && hash1(i + f * 3, 7451) < fade) continue;
      const a = sweepAngle(i);
      streakLine(frame, { ax: Math.cos(a) * (R - 5), ay: Math.sin(a) * (R - 5), bx: Math.cos(a) * (R + 4), by: Math.sin(a) * (R + 4), width: 1.6, bright: 0.72 * (1 - fade) });
    }
  }
  if (f === 3) sparkle(frame, Math.cos(spread) * R, Math.sin(spread) * R, 3);
  if (f <= 2) {
    spike(frame, { x: -6, y: 4, a: 160 * DEG, len: 10 - f * 2, w: 1.8, bright: 0.85 });
    spike(frame, { x: -6, y: 4, a: 110 * DEG, len: 7 - f, w: 1.4, bright: 0.7 });
    if (f === 1) sparkle(frame, -4, 3, 2);
  }
  shards(frame, f, 6, 7452, (i, rnd) => {
    const a = Math.PI / 2 + (rnd(1) - 0.5) * 1.2;
    const sp = 2 + rnd(2) * 2;
    return { x: -6, y: 4, vx: Math.cos(a) * sp - 0.8, vy: Math.sin(a) * sp, life: 3, size: 1 };
  });
}

// =============================================================================
// 狙撃手の息（持続）: 照準器の目盛りが体の周りに灯る。dirs 1（向きによらない）
// =============================================================================

/** 足元（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 纏いの括弧の半径（キャラの体の外） */
const SB_R = 38;
const SB_N = 12;

/**
 * 狙撃手の息の発動: 大きな照準の輪が息を吐くように締まり、四方の十字の線が通り、
 * 締まりきった所で四方が光って輪は外へほどける。外から内へ集まる粒（集中）
 */
function sbCast(frame, f) {
  const N = 10;
  const settle = 5;
  const p = Math.min(1, (f + 1) / settle);
  const R = 82 - (82 - SB_R) * easeSwing(p);
  if (f < settle) {
    ring(frame, { radius: R, width: 2, bright: 0.4 + 0.35 * p, seed: 7501 });
    // 十字の線: 輪の外から内へ（体の中は空ける）
    if (f >= 1) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const r0 = R + 14;
        const r1 = Math.max(SB_R - 12, R - 12);
        streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: 1.4, bright: 0.45 + 0.3 * p });
      }
    }
    // 外から集まる粒
    for (let i = 0; i < 12; i++) {
      const a = hash1(i, 7502) * TAU;
      const r = (96 - hash1(i, 7503) * 16) * (1 - 0.55 * p);
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, 3 + Math.round(p * 2));
    }
    if (f === settle - 1) for (let i = 0; i < 4; i++) sparkle(frame, Math.cos((i / 4) * TAU) * SB_R, Math.sin((i / 4) * TAU) * SB_R, 3);
    return;
  }
  // ほどけ: 輪が外へ押し広がって崩れ、括弧 4 つが残って落ち着く（纏いへつなぐ）
  const k = (f - settle + 1) / (N - settle);
  ring(frame, { radius: SB_R + 10 + k * 30, width: 2.2 - k, erosion: Math.min(0.92, 0.1 + k * 0.85), bright: 0.8 - k * 0.3, seed: 7504 });
  for (let i = 0; i < 4; i++) {
    const c = (i / 4) * TAU + Math.PI / 4;
    band(frame, { R: SB_R, width: 2, from: c - 20 * DEG, to: c + 20 * DEG, bright: 0.7 - k * 0.2, seed: 7505 + i });
  }
  if (f === settle) sparkle(frame, 0, -SB_R - 6, 2);
  shards(frame, f - settle, 12, 7509, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: Math.cos(a) * SB_R, y: Math.sin(a) * SB_R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 1 };
  });
}

/**
 * 狙撃手の息の纏い（持続中ずっと）: 体の周りの 4 つの括弧（照準器の目盛り）がゆっくり回り、息のように脈打つ。
 * 括弧の中央から内へ短い刻み、外から内へ寄る粒（集中）。4 回対称なので 1 巡で 90° 回せば継ぎ目が出ない
 */
function sbSustain(frame, f) {
  const cycle = f / SB_N;
  const breath = 0.5 - 0.5 * Math.cos(cycle * TAU);
  const R = SB_R + 1.5 * breath;
  const turn = (cycle * TAU) / 4;
  for (let i = 0; i < 4; i++) {
    const c = (i / 4) * TAU + Math.PI / 4 + turn;
    band(frame, { R, width: 1.8, from: c - 19 * DEG, to: c + 19 * DEG, bright: 0.48 + 0.14 * breath, seed: 7511 + i });
    streakLine(frame, { ax: Math.cos(c) * (R + 1), ay: Math.sin(c) * (R + 1), bx: Math.cos(c) * (R - 6), by: Math.sin(c) * (R - 6), width: 1.2, bright: 0.52 + 0.12 * breath });
  }
  // 寄る粒: 外から括弧の輪へ近づいて消える。位相で 1 巡して戻る
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 7515)) % 1;
    const a = hash1(i, 7516) * TAU + turn;
    const r = R + 22 - t * 18;
    const level = Math.max(2, Math.round(2 + 2.5 * Math.sin(Math.PI * t)));
    dot(frame, Math.cos(a) * r, Math.sin(a) * r, level);
  }
  // 息を吸いきった所で、上の括弧が一瞬光る（1 巡に 1 回）
  if (f === SB_N / 2) sparkle(frame, Math.cos(-Math.PI / 4 + turn) * R, Math.sin(-Math.PI / 4 + turn) * R, 2);
}

/** 纏いの足元（地面）: 潰れた輪と、前後左右の 4 つの刻み（地面に置いた照準の十字）。息に合わせて脈打つ */
function sbGround(frame, f) {
  const cycle = f / SB_N;
  const breath = 0.5 - 0.5 * Math.cos(cycle * TAU);
  const RX = 20;
  ring(frame, { oy: FEET_Y, radius: 10 + breath, width: 1.6, squash: 2.2, bright: 0.3 + 0.12 * breath, seed: 7521 });
  for (const s of [-1, 1]) {
    streakLine(frame, { ax: s * (RX * 1.2 + 4), ay: FEET_Y, bx: s * (RX * 1.2 + 11), by: FEET_Y, width: 1.4, bright: 0.28 + 0.12 * breath });
    streakLine(frame, { ax: 0, ay: FEET_Y + s * 12, bx: 0, by: FEET_Y + s * 16, width: 1.4, bright: 0.28 + 0.12 * breath });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 徹甲弾・掃射の acts[0] は volley（自分の位置・照準の向き）で、弾は shots[0] の絵が出す
 */
const FX = {
  moveset: "longarm",
  ultimates: {
    "longarm.armorPiercer": {
      ramp: "brass",
      cast: { sheet: "longarmUlt.armorPiercerCast", life: 0.4 },
      acts: [{ sheet: "longarmUlt.armorPiercer", life: 0.5, pivot: "pos" }],
      shots: {
        0: {
          fly: "longarmUlt.apFly",
          period: 0.18,
          base: AP_RADIUS,
          muzzle: "longarmUlt.apMuzzle",
          impact: "longarmUlt.apImpact",
          hit: "longarmUlt.apHit",
          fizzle: "longarmUlt.apFizzle",
          ramp: "brass",
        },
      },
    },
    "longarm.sweepFire": {
      ramp: "brass",
      cast: { sheet: "longarmUlt.sweepFireCast", life: 0.35 },
      acts: [{ sheet: "longarmUlt.sweepFire", life: 0.5, pivot: "pos" }],
      shots: {
        0: {
          fly: "longarmUlt.sfFly",
          period: 0.12,
          base: SF_RADIUS,
          muzzle: "longarmUlt.sfMuzzle",
          impact: "longarmUlt.sfImpact",
          hit: "longarmUlt.sfHit",
          fizzle: "longarmUlt.sfFizzle",
          ramp: "brass",
        },
      },
    },
    "longarm.sniperBreath": {
      ramp: "light",
      cast: { sheet: "longarmUlt.sniperBreathCast", life: 0.6 },
      sustain: { sheet: "longarmUlt.sniperBreath", period: 1.2, ground: "longarmUlt.sniperBreathGround" },
    },
  },
};

export const ATLAS = {
  key: "longarmUlt",
  fx: FX,
  sheets: [
    // 徹甲弾
    { key: "longarmUlt.armorPiercerCast", dirs: DIRS, frames: 8, active: 0, size: 216, draw: apCast },
    { key: "longarmUlt.armorPiercer", dirs: DIRS, frames: AP_FIRE_N, active: 0, size: 2 * (AP_LINE + 12), draw: apFire },
    { key: "longarmUlt.apFly", dirs: SHOT_DIRS, frames: AP_N, active: 0, size: 2 * (AP_TAIL + 12), draw: apFly },
    { key: "longarmUlt.apMuzzle", dirs: DIRS, frames: 8, active: 0, size: 160, draw: apMuzzle },
    { key: "longarmUlt.apHit", dirs: DIRS, frames: 7, active: 0, size: 144, draw: apHit },
    { key: "longarmUlt.apImpact", dirs: DIRS, frames: 8, active: 0, size: 96, draw: apImpact },
    { key: "longarmUlt.apFizzle", dirs: 1, frames: 8, active: 0, size: 72, draw: apFizzle },
    // 掃射
    { key: "longarmUlt.sweepFireCast", dirs: DIRS, frames: 7, active: 0, size: 112, draw: sfCast },
    { key: "longarmUlt.sweepFire", dirs: DIRS, frames: SW_N, active: 0, size: 2 * (SW_R + 8), draw: sfSweep },
    { key: "longarmUlt.sfFly", dirs: SHOT_DIRS, frames: SF_N, active: 0, size: 2 * (SF_TAIL + 10), draw: sfFly },
    { key: "longarmUlt.sfMuzzle", dirs: DIRS, frames: 6, active: 0, size: 104, draw: sfMuzzle },
    { key: "longarmUlt.sfHit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: sfHit },
    { key: "longarmUlt.sfImpact", dirs: DIRS, frames: 7, active: 0, size: 72, draw: sfImpact },
    { key: "longarmUlt.sfFizzle", dirs: 1, frames: 7, active: 0, size: 56, draw: sfFizzle },
    // 狙撃手の息
    { key: "longarmUlt.sniperBreathCast", dirs: 1, frames: 10, active: 0, size: 208, draw: sbCast },
    { key: "longarmUlt.sniperBreath", dirs: 1, frames: SB_N, active: 0, size: 2 * (SB_R + 30), draw: sbSustain },
    { key: "longarmUlt.sniperBreathGround", dirs: 1, frames: SB_N, active: 0, size: 96, draw: sbGround },
  ],
};
