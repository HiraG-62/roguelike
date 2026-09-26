// 二丁拳銃（moveset "gunner"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、銃の見本は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。数値は scratchpad/ults/gunner.md（奥義の弾は半径 3 = 太さ 6 ドット）
//
// 通常の絵（gunner.mjs）の形の言葉をそろえて大きく豪華にする:
// - 閃光は細く鋭い針（spike）の組み合わせ。二丁であることは「左右 2 か所」「2 本の軌跡」で見せる
// - 薬莢（真鍮の 3 ドットの棒）が回りながら飛ぶ。煙は段 2〜4 で白を使わない
// 奥義ごとの違い:
//   死の輪舞   全周 16 方向の銃口の星・時計回りに一周する 1 本の舞いの軌跡・渦に飛ぶ薬莢・足元の舞台の輪
//   神速撃ち   照準の先へ伸びる極細の 6 本の針と、弾の先を追う衝撃の弧（音の壁）・前へ閉じる照準の括弧
//   弾幕       回転式の弾倉の紋（6 つの薬室）が足元で回り、体の周りを薬莢の帯が巡り、両手から熱の揺らぎが立つ
// 決まり: 白（段 7）は針の芯・光点だけ。1 回の振り（舞いの軌跡）は 1 本。振り終わりは崩れて粒になる
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光は 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;
/** 銃を構えた先（自分の中心から前へ）。gunner.mjs と同じ */
const HAND = 20;
/** 左右の銃口の横のずれ（左 = −y、右 = +y）。gunner.mjs と同じ */
const GUN_Y = 7;
/** 奥義の弾の半径（論理 px。ults/gunner.md の radius） */
const ULT_BULLET_R = 3;

// -----------------------------------------------------------------------------
// 共通の部品（gunner.mjs から写したもの。編集禁止のファイルは import しない約束なので写す）
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え） */
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

/** 前へ押し出す圧の弧（潰れた楕円の前側だけ） */
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

/** 薬莢: (x, y) の 2〜3 ドットの棒。spin で 45° ずつ回る。段 5 まで（閃光より目立たせない） */
function casing(frame, x, y, spin, fade = 0) {
  const k = ((Math.round(spin) % 4) + 4) % 4;
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

/** 横へ飛ぶ薬莢（side の符号で左右）。age で放物線を描き、回りながら外へ流れて落ちる */
function ejectCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  const x = o.x - o.back * t;
  const y = o.y + o.side * t - Math.sign(o.side || 1) * 0.35 * t * t * o.fall;
  casing(frame, x, y, o.spin + t, t / (o.life + 1));
}

/** 硝煙の塊（段 2〜4、白を使わない）。age（0..1）で膨らみながら欠ける */
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

/** 手元の鋭い閃き（gunner.mjs の snapFlash）: 前の細い針と後ろへ反った返し。矢じり形 */
function snapFlash(frame, x, y, a, s) {
  spike(frame, { x, y, a, len: 11 * s, w: 1.6 * s, bright: 1 });
  spike(frame, { x, y, a: a + 130 * DEG, len: 4.5 * s, w: 1.2 * s, bright: 0.8 });
  spike(frame, { x, y, a: a - 130 * DEG, len: 4.5 * s, w: 1.2 * s, bright: 0.8 });
  spike(frame, { x, y, a: a + 55 * DEG, len: 3.5 * s, w: 1 * s, bright: 0.7 });
  spike(frame, { x, y, a: a - 55 * DEG, len: 3.5 * s, w: 1 * s, bright: 0.7 });
  flashCore(frame, x, y, 1.6 * s, 1);
}

/**
 * 一周できる細い帯の軌跡（舞いの軌跡・二丁を振り回す手の弧）。中心 (0,0)、半径 R、太さ T。
 * head = 先端の角、len = 尾までの角の長さ。先端ほど太く明るく、外縁の先端寄りだけ白い
 */
function orbitTrail(frame, o) {
  const { R, T, head, len } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const span = Math.max(1e-3, len);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 0.5 || r < R - T - 1) return -1;
      let s = (head - Math.atan2(y, x)) % TAU;
      if (s < 0) s += TAU;
      if (s > span) return -1;
      const u = s / span;
      const w = T * (1 - u) ** 0.6 + 0.6;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion + u * 0.2, 1 - u, seed)) return -1;
      if (R - r < 1.3 && u < 0.3 && erosion < 0.4) return clamp01(bright * 1.05);
      return clamp01((1 - q) ** 0.9 * (0.85 - 0.55 * u) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

// -----------------------------------------------------------------------------
// 奥義の弾（通常の曳光より豪華: 弾頭の周りに光の暈・弾頭の芯が瞬く・尾から火の粉）
// -----------------------------------------------------------------------------

/**
 * tail = 尾の長さ（速さ × 0.04 秒: 300px/秒 → 24 ドット、450px/秒 → 36 ドット）、half = 弾頭の半幅、
 * head = 弾頭の尖り、halo = 弾頭の暈の半径、curl = 尾の巻き（輪舞は回りながら撒くので +y へ巻く）、
 * mach = 弾頭から後ろへ開く衝撃の 2 本の線の長さ（神速撃ちだけ。音速を超えた弾）
 */
const ULT_SHOTS = {
  rondo: { tail: 24, half: 2.6, tailHalf: 1.5, head: 4.5, halo: 5.5, curl: 3, mach: 0, frames: 4, period: 0.12, tailBright: 0.85, seed: 5100 },
  godspeed: { tail: 36, half: 2.8, tailHalf: 1.4, head: 8, halo: 5, curl: 0, mach: 22, frames: 4, period: 0.08, tailBright: 0.9, seed: 5200 },
};

/**
 * 奥義の曳光: 原点 = 弾の中心、+x = 進む向き。弾頭の尖り・後ろへ細る尾・弾頭の周りの暗い暈（段 2〜3）。
 * 暈は 1 巡で脈打ち、偶数フレームに弾頭の芯が十字に瞬く（小さくても輝いて見える）
 */
function ultTracer(frame, f, g) {
  const len = g.tail * (1 + (hash1(f, g.seed) - 0.5) * 0.16);
  const H = g.half;
  const cx = -H * 0.5;
  const rxBack = H * 1.6;
  const rxFront = g.head + H * 0.5;
  const tailFrom = cx - rxBack * 0.4;
  const halo = g.halo * (1 + 0.12 * Math.cos((f / g.frames) * TAU));
  paint(
    frame,
    (x, y) => {
      if (x > g.head + halo || x < -len - 1) return -1;
      let v = -1;
      const dx = x - cx;
      const rx = dx >= 0 ? rxFront : rxBack;
      const e = Math.hypot(dx / rx, y / H);
      if (e <= 1) {
        const pointed = dx >= 0 ? Math.abs(y) / H + dx / rx : 0;
        if (pointed <= 1.05) v = clamp01((1 - e) ** 0.5 * 1.2);
      }
      if (x < tailFrom) {
        const u = (tailFrom - x) / (len + tailFrom);
        const hw = g.tailHalf * (1 - u) ** 0.6 + 0.3;
        const d = Math.abs(y - g.curl * u * u);
        if (d <= hw) v = Math.max(v, clamp01((1 - d / hw) ** 0.6 * g.tailBright * (1 - u) ** 1.1 + 0.08));
      }
      // 暈: 弾頭の中心から halo まで、段 2〜3 の薄い光（芯と尾の外側だけ）
      const dh = Math.hypot(x - cx * 0.5, y * 1.15);
      if (v < 0 && dh <= halo) v = 0.13 + 0.14 * (1 - dh / halo);
      return v;
    },
    { bounds: { x0: -len - 2, y0: -halo - 2, x1: g.head + halo + 2, y1: halo + g.curl + 2 }, dither: 0.03 },
  );
  // 衝撃の 2 本: 弾頭の肩から後ろへ開く V（音の壁を破った跡）。尾と重ならないよう外へ離す
  if (g.mach > 0) {
    const spread = 5 + (f % 2) * 0.8;
    for (const side of [-1, 1]) streakLine(frame, { ax: -g.mach, ay: side * (H + spread), bx: g.head - 3, by: side * (H + 0.8), bright: 0.5 });
  }
  if (f % 2 === 0) sparkle(frame, 0.5, 0, 2);
  // 尾から剥がれる火の粉
  const ex = -len * (0.35 + 0.45 * hash1(f, g.seed + 1));
  const u = -ex / len;
  const ey = (hash1(f, g.seed + 2) > 0.5 ? 1 : -1) * (g.tailHalf + 1.4) + g.curl * u * u;
  dot(frame, ex, ey, 5);
}

/** 輪舞の銃口: 16 発が全周に出るので 1 発ずつの閃光は小さな 4 本の星（前が長い）。細い圧の弧が 1 枚 */
function rondoMuzzle(frame, f) {
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.7;
    spike(frame, { x: -2, a: 0, len: 13 * s, w: 1.9 * s, bright: 1 });
    spike(frame, { x: -2, a: 90 * DEG, len: 5 * s, w: 1.3 * s, bright: 0.85 });
    spike(frame, { x: -2, a: -90 * DEG, len: 5 * s, w: 1.3 * s, bright: 0.85 });
    spike(frame, { x: -2, a: Math.PI, len: 4 * s, w: 1.2 * s, bright: 0.75 });
    flashCore(frame, -2, 0, 2.2 * s, 1);
    if (f === 0) sparkle(frame, -2, 0, 3);
  }
  if (f >= 1 && f <= 3) frontArc(frame, { ox: 4 + f * 2, radius: 4 + f * 3, width: 1.4, squash: 0.5, spread: 60 * DEG, erosion: Math.min(0.9, (f - 1) * 0.35), bright: 0.65 - f * 0.1, seed: 5111 });
  if (f >= 1) {
    shards(frame, f - 1, 4, 5112, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.4;
      const sp = 2.5 + rnd(2) * 2;
      return { x: 7, y: (rnd(3) - 0.5) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
}

/**
 * 神速撃ちの銃口: 極細で長い針（20 ドット）と、根元の短い十字、前へ 2 枚重なって出る圧の弧（弾が速すぎて閃光が前へ引き伸ばされる）。
 * 6 発は同じ tick で近いので 1 つの閃光にまとまる
 */
function godspeedMuzzle(frame, f) {
  if (f === 2) spike(frame, { x: 4, a: 0, len: 24, w: 1.4, bright: 0.75, erosion: 0.35, seed: 5214 });
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.8;
    spike(frame, { x: -2, a: 0, len: 30 * s, w: 2 * s, bright: 1 });
    spike(frame, { x: -2, a: 3 * DEG, len: 20 * s, w: 1.2 * s, bright: 0.85 });
    spike(frame, { x: -2, a: -3 * DEG, len: 20 * s, w: 1.2 * s, bright: 0.85 });
    spike(frame, { x: -2, a: 90 * DEG, len: 6 * s, w: 1.3 * s, bright: 0.8 });
    spike(frame, { x: -2, a: -90 * DEG, len: 6 * s, w: 1.3 * s, bright: 0.8 });
    spike(frame, { x: -2, a: 150 * DEG, len: 4 * s, w: 1.2 * s, bright: 0.7 });
    spike(frame, { x: -2, a: -150 * DEG, len: 4 * s, w: 1.2 * s, bright: 0.7 });
    flashCore(frame, -2, 0, 3 * s, 1);
    sparkle(frame, -2, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    frontArc(frame, { ox: 8 + age * 7, radius: 8 + age * 3, width: 2.2, squash: 0.45, spread: 75 * DEG, erosion: Math.min(0.9, age * 0.26), bright: 0.8 - age * 0.12, seed: 5211 });
    if (age >= 1) frontArc(frame, { ox: 20 + age * 8, radius: 6 + age * 2.5, width: 1.6, squash: 0.4, spread: 70 * DEG, erosion: Math.min(0.9, age * 0.3), bright: 0.7 - age * 0.12, seed: 5212 });
  }
  if (f >= 2) {
    shards(frame, f - 2, 5, 5213, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 0.5;
      const sp = 4 + rnd(2) * 3;
      return { x: 10, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
}

/**
 * 奥義の弾の着弾: 当たった面の平たい閃きと、後ろの半球へ跳ねる火花・光点。s で大きさ、heavy で後ろへ吹く針が 3 本
 */
function ultImpact(frame, f, o) {
  const { s, seed, heavy } = o;
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -9 * s, bx: -1, by: 9 * s, T: (f === 0 ? 4 : 2.4) * s, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 10 * s, w: 2.2 * s, bright: 1 });
    const diag = heavy ? 30 : 42;
    spike(frame, { x: 0, a: Math.PI - diag * DEG, len: 6 * s, w: 1.5 * s, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI + diag * DEG, len: 6 * s, w: 1.5 * s, bright: 0.85 });
    flashCore(frame, 0, 0, 2.8 * s, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    ring(frame, { ox: -2 - age, radius: (4 + age * 3.5) * s, width: 1.6, squash: 0.55, erosion: Math.min(0.9, age * 0.28), bright: 0.7 - age * 0.1, seed: seed + 1 });
  }
  shards(frame, f, heavy ? 12 : 8, seed + 2, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 3 * s * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  // 跳ねた光点が 1 つ遅れて瞬く（奥義の弾の印）
  if (f === 2) sparkle(frame, -6 * s, (hash1(0, seed) - 0.5) * 8 * s, 2);
}

/** 奥義の弾の命中: 体を貫く前の針（輪舞は貫通するので長い）と潰れた輪、前へ飛ぶ角ばった破片 */
function ultHit(frame, f, o) {
  const { s, seed, through } = o;
  if (f <= 1) {
    spike(frame, { x: -3, a: 0, len: (through ? 16 : 11) * s, w: 2.6 * s, bright: 1 });
    spike(frame, { x: -3, a: 55 * DEG, len: 6 * s, w: 1.6 * s, bright: 0.8 });
    spike(frame, { x: -3, a: -55 * DEG, len: 6 * s, w: 1.6 * s, bright: 0.8 });
    spike(frame, { x: -3, a: Math.PI, len: 5 * s, w: 1.4 * s, bright: 0.7 });
    flashCore(frame, -3, 0, 3.2 * s, 1);
    if (f === 0) sparkle(frame, -3, 0, 3);
  }
  if (f >= 1 && f <= 4) ring(frame, { radius: 5 * s + f * 3.5, width: 1.8, squash: 0.6, erosion: Math.min(0.9, (f - 1) * 0.3), bright: 0.75 - f * 0.1, seed: seed + 1 });
  if (through && f >= 1 && f <= 3) spike(frame, { x: 6 + f * 4, a: 0, len: 10, w: 1.4, bright: 0.8 - f * 0.12, erosion: (f - 1) * 0.3, seed: seed + 3 });
  shards(frame, f, 12, seed + 2, (i, rnd) => {
    const back = rnd(5) < 0.2;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.6 : (rnd(1) - 0.5) * 1.7;
    const sp = 3.5 * s * (back ? 0.6 : 1) * (0.8 + 0.8 * rnd(2));
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/** 輪舞の弾が尽きた: dirs 1。小さく弾けて光点が瞬き、6 つの火の粉が輪に散る（16 発が同時に尽きるので煙は出さない） */
function rondoFizzle(frame, f) {
  if (f === 0) {
    flashCore(frame, 0, 0, 2.6, 1);
    sparkle(frame, 0, 0, 3);
  } else if (f === 1) {
    flashCore(frame, 0, 0, 1.6, 0.75);
    sparkle(frame, 0, 0, 2);
  }
  shards(frame, f, 6, 5131, (i, rnd) => {
    const a = (i / 6) * TAU + rnd(1) * 0.5;
    const sp = 1.8 + rnd(2) * 1.2;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.2, life: 3 + Math.floor(rnd(3) * 2), size: 1, drag: 0.8 };
  });
}

/** 神速撃ちの弾が尽きた: dirs 1。熱い弾頭の火の粉が 1 つ残り、細い煙が 2 筋昇って切れる */
function godspeedFizzle(frame, f) {
  const N = 7;
  const age = f / (N - 1);
  if (f === 0) {
    flashCore(frame, 0, 0, 2.2, 1);
    sparkle(frame, 0, 0, 2);
  } else if (f <= 3) dot(frame, 0, -f, Math.max(3, 6 - f));
  for (const side of [-1, 1]) {
    const h = 6 + f * 3;
    paint(
      frame,
      (x, y) => {
        const up = -y - 1 - f * 1.5;
        if (up < 0 || up > h) return -1;
        const u = up / h;
        const cx = side * (1 + u * 3) + Math.sin(u * 5 + side + f) * 1.4;
        if (Math.abs(x - cx) > 0.8 + u * 0.6) return -1;
        if (valueNoise(x, y + f * 2, 2.2, 5241 + side) - age * 0.8 - u * 0.3 < 0.05) return -1;
        return clamp01(0.36 * (1 - u * 0.5));
      },
      { bounds: { x0: -8, y0: -h - f * 1.5 - 2, x1: 8, y1: 0 }, samples: 2 },
    );
  }
}

// -----------------------------------------------------------------------------
// 死の輪舞（volley 全周 16 発・貫通 1）: 二丁を振り回して一回転し、全周 16 方向へ同時に撃つ
// -----------------------------------------------------------------------------

/** 輪舞のフレーム数と、撃つまでの枚数 */
const RONDO_N = 10;
const RONDO_A = 3;
/** 銃口の星を置く半径（体 48 ドットの縁の少し外） */
const RONDO_GUN = 26;
/** 全周の弾の数（ults/gunner.md の count） */
const RONDO_COUNT = 16;
/** 舞いの軌跡の半径 */
const RONDO_TRAIL_R = 40;
/** 舞いが始まる角（真上から時計回り） */
const RONDO_FROM = -Math.PI / 2;

/**
 * 輪舞の発動（dirs 1）: 左右の銃（反対側の 2 点）が短い弧を引きながら自分の周りを半周し、
 * 締まった所で 2 つの銃口が光る。2 本の弧は二丁の手（向かい合わせで重ならない）
 */
function rondoCast(frame, f) {
  const N = 7;
  const turn = 4;
  if (f < turn) {
    const p = easeSwing((f + 1) / turn);
    const R = 30 - 8 * p;
    for (let j = 0; j < 2; j++) {
      const head = RONDO_FROM + j * Math.PI + Math.PI * p;
      orbitTrail(frame, { R, T: 3.2, head, len: (50 + 70 * p) * DEG, bright: 0.85 + 0.15 * p, seed: 5301 + j });
      if (f >= 1) dot(frame, Math.cos(head) * (R - 1), Math.sin(head) * (R - 1), 7);
    }
    if (f === turn - 1) {
      for (let j = 0; j < 2; j++) {
        const a = RONDO_FROM + j * Math.PI + Math.PI;
        sparkle(frame, Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), 3);
      }
    }
    return;
  }
  const k = (f - turn + 1) / (N - turn);
  ring(frame, { radius: 20 + k * 14, width: 2.4 - k, erosion: Math.min(0.9, k * 0.85), bright: 0.8 - k * 0.3, seed: 5302 });
  shards(frame, f - turn, 10, 5303, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 2.5;
    // 接線（時計回り）へ振り飛ばされる粒
    const t = a + 60 * DEG;
    return { x: Math.cos(a) * 20, y: Math.sin(a) * 20, vx: Math.cos(t) * sp, vy: Math.sin(t) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

/**
 * 輪舞の一斉射（dirs 1、原点 = 自分）:
 * 1) 舞いの軌跡 1 本が真上から時計回りに一周し（撃つ瞬間に閉じきらず 330° で止まる）、崩れて消える
 * 2) 撃った瞬間、全周 16 方向の銃口に星形の閃光（前の針・左右の小さな針）。4 方向ごとに光点
 * 3) 閃光の外で広がる衝撃の輪 1 枚と、時計回りの渦に振り飛ばされる 16 個の薬莢
 */
function rondoBurst(frame, f) {
  const A = RONDO_A;
  const k = f < A ? 0 : (f - A + 1) / (RONDO_N - A + 1);
  // 1) 舞いの軌跡
  if (k < 0.5) {
    const p = f < A ? easeSwing((f + 1) / A) : 1;
    // 撃った後は閃光の輪の邪魔をしないよう、2 枚で痩せて崩れきる
    const kk = Math.min(1, k * 2);
    const head = RONDO_FROM + TAU * 0.92 * p + kk * 30 * DEG;
    const len = TAU * (0.2 + 0.72 * p) * (1 - kk * 0.6);
    orbitTrail(frame, { R: RONDO_TRAIL_R + kk * 6, T: 7 * (1 - kk * 0.6), head, len, erosion: kk * 1.1, bright: 1 - kk * 0.3, seed: 5401 });
    // 速度線: 軌跡の外側にだけ沿わせる
    if (f < A) {
      for (let i = 0; i < 2; i++) {
        const end = head - 0.15 - 0.2 * hash1(i, 5402);
        arcLine(frame, { radius: RONDO_TRAIL_R + 3 + i * 3.2, from: end - len * 0.45, to: end, bright: 0.55 - i * 0.12 });
      }
    }
  }
  // 撃つ前の枚: 二丁の銃口（向かい合う 2 点）が軌跡の先で光る
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    for (let j = 0; j < 2; j++) {
      const a = RONDO_FROM + TAU * 0.92 * p + j * Math.PI;
      snapFlash(frame, Math.cos(a) * RONDO_GUN, Math.sin(a) * RONDO_GUN, a, 0.9);
    }
  }
  // 2) 全周の銃口の星（撃つ瞬間 = f A-1 と A）
  const shotAge = f - (A - 1);
  if (shotAge >= 0 && shotAge <= 2) {
    const s = shotAge === 0 ? 1 : shotAge === 1 ? 1.15 : 0.75;
    for (let i = 0; i < RONDO_COUNT; i++) {
      const a = RONDO_FROM + (i / RONDO_COUNT) * TAU;
      const x = Math.cos(a) * RONDO_GUN;
      const y = Math.sin(a) * RONDO_GUN;
      const long = i % 2 === 0 ? 1 : 0.75;
      const erosion = shotAge === 2 ? 0.45 : 0;
      spike(frame, { x, y, a, len: 20 * s * long, w: 2.3 * s, bright: 1, erosion, seed: 5410 + i });
      if (shotAge < 2) {
        spike(frame, { x, y, a: a + 100 * DEG, len: 4.5 * s, w: 1.3 * s, bright: 0.8 });
        spike(frame, { x, y, a: a - 100 * DEG, len: 4.5 * s, w: 1.3 * s, bright: 0.8 });
        flashCore(frame, x, y, 2.2 * s, 1);
      }
    }
    if (shotAge <= 1) {
      for (let i = 0; i < 4; i++) {
        const a = RONDO_FROM + (i / 4) * TAU + (shotAge === 1 ? TAU / 8 : 0);
        sparkle(frame, Math.cos(a) * (RONDO_GUN + 12), Math.sin(a) * (RONDO_GUN + 12), shotAge === 0 ? 4 : 3);
      }
    }
  }
  // 3) 衝撃の輪と、渦に飛ぶ薬莢・火花
  if (shotAge >= 1) {
    const age = shotAge - 1;
    ring(frame, { radius: RONDO_GUN + 14 + age * 9, width: 3 - age * 0.3, erosion: Math.min(0.95, age * 0.17), bright: 0.8 - age * 0.07, seed: 5420 });
  }
  if (shotAge >= 0) {
    for (let i = 0; i < RONDO_COUNT; i++) {
      const t = shotAge;
      const life = 5 + Math.floor(hash1(i, 5421) * 3);
      if (t > life) continue;
      // 銃口の後ろ（内側寄り）から、時計回りに巻きながら外へ流れる
      const a0 = RONDO_FROM + ((i + 0.5) / RONDO_COUNT) * TAU;
      const a = a0 + t * (0.13 + 0.05 * hash1(i, 5422));
      const r = RONDO_GUN - 8 + t * (3 + 1.5 * hash1(i, 5423));
      casing(frame, Math.cos(a) * r, Math.sin(a) * r, i + t, t / (life + 1));
    }
    shards(frame, shotAge, 28, 5424, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 3.5 + rnd(2) * 4;
      const r = RONDO_GUN + 10;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a + 0.25) * sp, vy: Math.sin(a + 0.25) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.45 ? 2 : 1 };
    });
  }
  // 撃ち終わりの硝煙: 16 の銃口のうち半分から、薄い塊が残って消える
  if (shotAge >= 2) {
    const age = Math.min(0.95, (shotAge - 2) / (RONDO_N - A - 1));
    for (let i = 1; i < RONDO_COUNT; i += 3) {
      const a = RONDO_FROM + ((i + hash1(i, 5431)) / RONDO_COUNT) * TAU + age * 0.3;
      const r = RONDO_GUN + 8 + age * 8 + hash1(i, 5432) * 6;
      puff(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, r: 3.6, age, seed: 5430 + i, bright: 0.32 });
    }
  }
}

/**
 * 輪舞の地面の紋（舞台の輪）: 外の輪と 16 の刻み（弾の向き）。撃った瞬間に強く光り、ゆっくり回って薄れる
 */
function rondoGround(frame, f) {
  const R = 50;
  const grow = Math.min(1, (f + 1) / RONDO_A);
  const k = f < RONDO_A ? 0 : (f - RONDO_A + 1) / (RONDO_N - RONDO_A + 1);
  const dim = (f === RONDO_A - 1 || f === RONDO_A ? 0.5 : 0.4) * (1 - k * 0.4);
  const erosion = k * 0.9;
  ring(frame, { radius: R * (0.75 + 0.25 * grow), width: 1.8, erosion, bright: dim, seed: 5440 });
  if (grow < 1 || k >= 0.85) return;
  const turn = k * 12 * DEG;
  for (let i = 0; i < RONDO_COUNT; i++) {
    const a = RONDO_FROM + (i / RONDO_COUNT) * TAU + turn;
    const long = i % 4 === 0;
    const r0 = R - (long ? 9 : 5);
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (R - 2), by: Math.sin(a) * (R - 2), width: long ? 1.6 : 1.1, bright: dim * (long ? 1.1 : 0.8) * (1 - k) });
  }
}

// -----------------------------------------------------------------------------
// 神速撃ち（volley 6 発・拡散 4°・速さ 1.5 倍）: 照準の一点へ 6 発を一度に撃ち込む
// -----------------------------------------------------------------------------

const GOD_N = 9;
const GOD_A = 2;
/** 針の届く長さ（弾が先に飛ぶので閃光もその先を指す） */
const GOD_LEN = 120;

/**
 * 神速撃ちの発動（DIRS）: 左右の腰から銃が抜かれて前へ揃う 2 本の短い弧（二丁）と、
 * 照準の先で 4 つの括弧が内へ閉じて一点を捉える
 */
function godspeedCast(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  // 抜き撃ちの弧: 左の銃は −y の後ろから、右の銃は +y の後ろから前へ（左右対称。反りは前へ）
  if (f <= 2) {
    const g = (f + 1) / 3;
    for (const side of [-1, 1]) {
      lens(frame, { ax: -6, ay: side * 18, bx: HAND, by: side * GUN_Y, T: 5, bend: -side * 5, grow: Math.max(0.35, g), bias: 0, bright: 0.85, erosion: f === 2 ? 0.3 : 0, seed: 5501 + side });
    }
    if (f === 2) for (const side of [-1, 1]) sparkle(frame, HAND, side * GUN_Y, 2);
  }
  // 照準の括弧: 中心 (AIM, 0)。4 隅の L 字が外から寄ってくる
  const AIM = 44;
  const gap = 18 - 12 * easeSwing(Math.min(1, (f + 1) / 4));
  if (k < 0.95) {
    const bright = f <= 3 ? 0.75 : 0.75 * (1 - (f - 3) / 3);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = AIM + sx * gap;
        const cy = sy * gap;
        streakLine(frame, { ax: cx - sx * 5, ay: cy, bx: cx, by: cy, width: 1.2, bright });
        streakLine(frame, { ax: cx, ay: cy - sy * 5, bx: cx, by: cy, width: 1.2, bright });
      }
    }
  }
  if (f === 3) sparkle(frame, AIM, 0, 3);
  if (f === 4) sparkle(frame, AIM, 0, 2);
}

/**
 * 神速撃ちの一斉射（DIRS、原点 = 自分、+x = 照準）:
 * 1) 左右の銃口から照準の軸へ寄っていく極細の 6 本の針（±2°）が一気に先へ伸び、その根元に大きな芯
 * 2) 針の上を先へ走る衝撃の弧（音の壁）3 枚。遅れて出るほど遠く、潰れて細る
 * 3) 両手から 3 つずつ薬莢が外へ、後ろへ吹く短い筋（反動の風）
 */
function godspeedBurst(frame, f) {
  const A = GOD_A;
  const k = f < A ? 0 : (f - A + 1) / (GOD_N - A + 1);
  // 1) 左右の銃口から照準の軸の 1 点（CONV）へ寄る短い針 2 本と、そこから先へ伸びる 1 本の太い閃光の針。
  //    6 発が同じ所へ撃ち込まれるので、並んだ平行線（二重線）にせず 1 本に束ねる。脇の細い 2 本は ±3° の拡散
  const CONV = HAND + 22;
  if (f <= 3) {
    const grow = f === 0 ? 0.55 : 1;
    const fade = f <= 1 ? 1 : f === 2 ? 0.85 : 0.6;
    const erosion = f >= 2 ? 0.2 + (f - 2) * 0.3 : 0;
    if (f <= 1) {
      for (const side of [-1, 1]) {
        const a = Math.atan2(-side * GUN_Y, CONV - HAND);
        spike(frame, { x: HAND, y: side * GUN_Y, a, len: CONV - HAND + 4, w: 2.2, bright: 0.95, seed: 5600 + side });
      }
    }
    // 振り終わりは根元から先へ閃光が抜けていく（弾を追って消える）
    const drain = Math.max(0, f - 1) * 26;
    spike(frame, { x: CONV - 4 + drain, y: 0, a: 0, len: GOD_LEN * grow - drain * 0.6, w: f >= 2 ? 2.4 : 4, bright: fade, erosion, seed: 5601 });
    if (f <= 2) for (const side of [-1, 1]) spike(frame, { x: CONV, y: 0, a: side * 3 * DEG, len: GOD_LEN * 0.62 * grow, w: 1.5, bright: fade * 0.85, erosion: erosion + 0.1, seed: 5602 + side });
    if (f <= 1) {
      for (const side of [-1, 1]) {
        spike(frame, { x: HAND, y: side * GUN_Y, a: side * 80 * DEG, len: 8, w: 1.6, bright: 0.85 });
        spike(frame, { x: HAND, y: side * GUN_Y, a: side * 140 * DEG, len: 6, w: 1.4, bright: 0.75 });
        flashCore(frame, HAND, side * GUN_Y, f === 0 ? 3.6 : 3, 1);
        spike(frame, { x: CONV, y: 0, a: side * 90 * DEG, len: 12, w: 2, bright: 0.9 });
      }
      flashCore(frame, CONV, 0, f === 0 ? 5 : 4, 1);
      sparkle(frame, CONV, 0, 4);
    }
  }
  // 針の先の光点（弾の先頭）
  if (f === 1) sparkle(frame, GOD_LEN - 4, 0, 4);
  if (f === 2) sparkle(frame, GOD_LEN + 8, 0, 3);
  // 2) 音の壁: 3 枚が 1 枚ずつ遅れて先へ
  for (let j = 0; j < 3; j++) {
    const age = f - 1 - j;
    if (age < 0 || age > 4) continue;
    const x = 40 + j * 28 + age * 16;
    frontArc(frame, { ox: x, radius: 16 + age * 4 - j * 2, width: 2.8 - age * 0.35, squash: 0.42, spread: 80 * DEG, erosion: Math.min(0.92, age * 0.24), bright: 0.8 - age * 0.12 - j * 0.05, seed: 5610 + j });
  }
  // 針が消えた後の通り道: 軸の上に残る 1 本の細い筋が前へ流れて切れる（6 発が 1 点へ撃ち込まれた弾道）
  if (f >= 4 && k < 0.95) {
    const age = f - 4;
    const x0 = HAND + 60 + age * 18;
    streakLine(frame, { ax: x0, ay: 0, bx: Math.min(GOD_LEN + 30, x0 + 50 - age * 8), by: 0, width: 1, bright: 0.5 * (1 - k) });
  }
  // 3) 薬莢（左右 3 つずつ）と反動の風
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    ejectCasing(frame, f - Math.floor(i / 2) * 0.5, { x: HAND - 10, y: side * (GUN_Y + 2), side: side * (2 + hash1(i, 5620) * 1.2), back: 0.8 + hash1(i, 5621) * 0.8, fall: 0.3, spin: i, life: 5 });
  }
  if (f >= 1 && f <= 4) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (GUN_Y + 4 + Math.floor(i / 2) * 5);
      const x0 = HAND - 14 - (f - 1) * 5;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 12, by: y + side * 2, bright: 0.45 * (1 - (f - 1) / 4) });
    }
  }
  if (f >= A) {
    shards(frame, f - A, 14, 5630, (i, rnd) => {
      const t = 0.3 + rnd(1) * 0.7;
      const side = rnd(2) > 0.5 ? 1 : -1;
      const sp = 2 + rnd(3) * 3;
      return { x: HAND + GOD_LEN * t, y: side * 2, vx: sp * 0.8, vy: side * sp * 0.5, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 弾幕（持続: 連射 1.5 倍・弾 +1・反動なし）: 回転式の弾倉の紋が足元で回り、薬莢の帯が体を巡る
// dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/** 足元の輪の中心の高さ（キャラの足元） */
const FEET_Y = 18;
/** 地面の輪の上下の潰れ（横長の楕円 = 地面に置いた輪） */
const GROUND_SQUASH = 2.2;
/** 弾倉の薬室の数（6 回対称なので 1 巡で 60° 回せば継ぎ目が出ない） */
const CHAMBERS = 6;
const BAR_N = 12;

/** 地面に置いた小さな輪（薬室）: 中心 (x, y)、横長に潰す */
function groundCircle(frame, x, y, r, width, bright, seed) {
  ring(frame, { ox: x, oy: y, radius: r, width, squash: GROUND_SQUASH * 0.9, bright, seed });
}

/** 弾倉の紋: 外の輪と、回る 6 つの薬室。turn は回った角 */
function cylinder(frame, o) {
  const { R, turn, bright } = o;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  ring(frame, { oy: FEET_Y, radius: R, width: 1.8, squash: GROUND_SQUASH, erosion, bright, seed });
  for (let i = 0; i < CHAMBERS; i++) {
    const a = turn + (i / CHAMBERS) * TAU;
    const cx = Math.cos(a) * R * 0.55 * GROUND_SQUASH;
    const cy = FEET_Y + Math.sin(a) * R * 0.55;
    if (erosion > 0 && hash1(i, seed) < erosion) continue;
    groundCircle(frame, cx, cy, R * 0.2, 1.4, bright * 0.95, seed + 1 + i);
  }
}

/**
 * 弾幕の発動（dirs 1）: 両手の銃を上へ向けて 1 発ずつ撃ち（空へ伸びる 2 本の針）、薬莢が噴水のように上へ散り、
 * 足元の弾倉の紋が勢いよく回って定まる
 */
function barrageCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 空撃ち: 左右の手から上へ（少し外へ開く）
  for (const side of [-1, 1]) {
    const gx = side * 14;
    const gy = -10;
    const a = -Math.PI / 2 + side * 12 * DEG;
    const age = f - (side < 0 ? 0 : 1);
    if (age === 0 || age === 1) {
      const s = age === 0 ? 1 : 0.8;
      spike(frame, { x: gx, y: gy, a, len: 34 * s, w: 2.4 * s, bright: 1 });
      spike(frame, { x: gx, y: gy, a: a + 90 * DEG, len: 5 * s, w: 1.3, bright: 0.8 });
      spike(frame, { x: gx, y: gy, a: a - 90 * DEG, len: 5 * s, w: 1.3, bright: 0.8 });
      flashCore(frame, gx, gy, 3 * s, 1);
      if (age === 0) sparkle(frame, gx + Math.cos(a) * 30, gy + Math.sin(a) * 30, 3);
    }
    if (age >= 1 && age <= 4) ring(frame, { ox: gx + Math.cos(a) * (22 + age * 8), oy: gy + Math.sin(a) * (22 + age * 8), radius: 3 + age * 2, width: 1.6, erosion: Math.min(0.9, age * 0.25), bright: 0.65 - age * 0.1, seed: 5701 + side });
  }
  // 薬莢の噴水: 両手から上へ放物線で散って落ちる（画面の上 = −y）
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = f - 1 - Math.floor(i / 4);
    if (t < 0 || t > 7) continue;
    const vx = side * (1 + hash1(i, 5710) * 2.5);
    const vy = -(5 + hash1(i, 5711) * 3);
    const x = side * 12 + vx * t;
    const y = -8 + vy * t + 0.9 * t * t;
    casing(frame, x, y, i + t, t / 8);
  }
  // 弾倉の紋: 速く回ってから減速して定まる（60° の倍数で止まる）
  const spin = (1 - Math.pow(1 - Math.min(1, (f + 1) / 7), 2.5)) * 2 * TAU / CHAMBERS * 3;
  cylinder(frame, { R: 14 + 6 * Math.min(1, (f + 1) / 4), turn: -Math.PI / 2 + spin, bright: 0.6 - Math.max(0, k - 0.6) * 0.8, erosion: Math.max(0, (k - 0.7) * 2.5), seed: 5720 });
  if (f === 6) sparkle(frame, 0, FEET_Y - 20, 2);
}

/**
 * 弾幕の纏い（持続中ずっと。dirs 1）: 体の周りを時計回りに巡る 6 つの薬莢の帯（上側は明るく、下側は暗い = 奥行き）、
 * 両手の銃口の先から立ちのぼる熱の揺らぎ、ときどき銃口の光点。
 * 帯は 6 つが等間隔なので 1 巡で 1/6 周すれば継ぎ目が出ない
 */
function barrageSustain(frame, f) {
  const cycle = f / BAR_N;
  // 弾の帯（横長の楕円軌道）: 6 発の弾丸が時計回りに巡り、それぞれ後ろへ短い軌跡を引く
  const RX = 34;
  const RY = 12;
  const OY = 2;
  for (let i = 0; i < CHAMBERS; i++) {
    const a = (i / CHAMBERS + cycle / CHAMBERS) * TAU;
    // 手前（+y 側、下半分）は体の前を通るので暗く、奥（上半分）は明るい。体の正面を横切る区間は描かない（顔と胴を隠さない）
    const front = Math.sin(a) > 0;
    if (front && Math.abs(Math.cos(a) * RX) < 16) continue;
    const dim = front ? 0.6 : 1;
    orbitBullet(frame, { a, RX, RY, OY, bright: dim });
  }
  // 熱の揺らぎ: 両手の銃口（左右 x ±16、y −2）から上へ、揺れる細い線が 2 本ずつ立ちのぼる
  for (const side of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      const phase = (cycle + j * 0.5 + (side > 0 ? 0.25 : 0)) % 1;
      const baseX = side * (17 + j * 3);
      const h = 18;
      const rise = phase * 16;
      paint(
        frame,
        (x, y) => {
          const up = -4 - rise - y;
          if (up < 0 || up > h) return -1;
          const u = up / h;
          const cx = baseX + Math.sin(u * 6 + phase * TAU + j) * 1.6;
          if (Math.abs(x - cx) > 0.7) return -1;
          return clamp01(0.4 * Math.sin(Math.PI * u) * Math.sin(Math.PI * phase) + 0.05);
        },
        { bounds: { x0: baseX - 4, y0: -4 - rise - h - 1, x1: baseX + 4, y1: -3 - rise }, dither: 0, samples: 2 },
      );
    }
  }
  // 銃口の光点（1 巡に左右 2 回ずつ。連射の手応え）
  if (f === 1 || f === 7) sparkle(frame, -16, -2, 2);
  if (f === 4 || f === 10) sparkle(frame, 16, -2, 2);
  if (f === 1 || f === 7) dot(frame, -21, -3, 5);
  if (f === 4 || f === 10) dot(frame, 21, -3, 5);
}

/**
 * 楕円の軌道を巡る弾丸 1 発: 角 a の位置に、接線の向きの小さな弾（段 5 の弾頭・段 4 の胴）と、
 * 後ろ 50° の軌跡（尾ほど暗い 1 ドットの線）
 */
function orbitBullet(frame, o) {
  const { a, RX, RY, OY, bright } = o;
  const at = (t) => ({ x: Math.cos(t) * RX, y: OY + Math.sin(t) * RY });
  const p = at(a);
  const q = at(a + 0.05);
  const tl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const tx = (q.x - p.x) / tl;
  const ty = (q.y - p.y) / tl;
  // 弾丸（長さ 5・半幅 1.4 のカプセル）
  paint(
    frame,
    (x, y) => {
      const dx = x - p.x;
      const dy = y - p.y;
      const along = dx * tx + dy * ty;
      const across = Math.abs(-dx * ty + dy * tx);
      if (along < -2.5 || along > 2.5) return -1;
      const half = along > 1 ? 1.4 * (1 - (along - 1) / 1.8) : 1.4;
      if (across > half) return -1;
      return clamp01((along > 0.5 ? 0.72 : 0.5) * bright);
    },
    { bounds: { x0: p.x - 4, y0: p.y - 4, x1: p.x + 4, y1: p.y + 4 } },
  );
  // 軌跡: 後ろへ 12 点
  for (let j = 1; j <= 12; j++) {
    const t = a - j * 0.045;
    const r = at(t);
    const level = Math.round((4.5 - j * 0.25) * bright);
    if (level >= 2) dot(frame, r.x, r.y, level);
  }
}

/** 弾幕の足元（地面）: 弾倉の紋がゆっくり回り、脈打つ（6 回対称で 1 巡 60°） */
function barrageSustainGround(frame, f) {
  const cycle = f / BAR_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  cylinder(frame, { R: 19 + pulse * 0.8, turn: -Math.PI / 2 + cycle * (TAU / CHAMBERS), bright: 0.34 + 0.12 * pulse, seed: 5801 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 奥義の弾の表の 1 行（物理の弾なので真鍮の曳光。神速撃ちは閃光の白） */
function shotRow(name, ramp) {
  const g = ULT_SHOTS[name];
  return {
    fly: `gunnerUlt.${name}Fly`,
    period: g.period,
    base: ULT_BULLET_R,
    muzzle: `gunnerUlt.${name}Muzzle`,
    impact: `gunnerUlt.${name}Impact`,
    hit: `gunnerUlt.${name}Hit`,
    fizzle: `gunnerUlt.${name}Fizzle`,
    ramp,
  };
}

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 2 本の一撃は volley（自分の位置・照準の向き）なので放ちの絵は拡縮しない（0）。弾は shots[0] の絵が出す
 */
const FX = {
  moveset: "gunner",
  ultimates: {
    "gunner.deathRondo": {
      ramp: "brass",
      cast: { sheet: "gunnerUlt.deathRondoCast", life: 0.3 },
      acts: [{ sheet: "gunnerUlt.deathRondo", life: 0.55, base: 0, pivot: "pos", ground: "gunnerUlt.deathRondoGround" }],
      shots: { 0: shotRow("rondo", "brass") },
    },
    "gunner.godspeed": {
      ramp: "light",
      cast: { sheet: "gunnerUlt.godspeedCast", life: 0.28 },
      acts: [{ sheet: "gunnerUlt.godspeed", life: 0.45, base: 0, pivot: "pos" }],
      shots: { 0: shotRow("godspeed", "light") },
    },
    "gunner.barrage": {
      ramp: "brass",
      cast: { sheet: "gunnerUlt.barrageCast", life: 0.55 },
      sustain: { sheet: "gunnerUlt.barrage", period: 0.6, ground: "gunnerUlt.barrageGround" },
    },
  },
};

/** 奥義の弾 1 種のシート（曳光・銃口・着弾・命中・尽きた） */
function shotSheets(name, o) {
  const g = ULT_SHOTS[name];
  return [
    { key: `gunnerUlt.${name}Fly`, dirs: SHOT_DIRS, frames: g.frames, active: 0, size: Math.ceil(g.tail + g.head + g.halo + 12 + g.curl) * 2, draw: (frame, f) => ultTracer(frame, f, g) },
    { key: `gunnerUlt.${name}Muzzle`, dirs: DIRS, frames: o.muzzleFrames, active: 0, size: o.muzzleSize, draw: o.muzzle },
    { key: `gunnerUlt.${name}Impact`, dirs: DIRS, frames: 7, active: 0, size: 72, draw: (frame, f) => ultImpact(frame, f, o.impact) },
    { key: `gunnerUlt.${name}Hit`, dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => ultHit(frame, f, o.hit) },
    { key: `gunnerUlt.${name}Fizzle`, dirs: 1, frames: o.fizzleFrames, active: 0, size: 64, draw: o.fizzle },
  ];
}

export const ATLAS = {
  key: "gunnerUlt",
  fx: FX,
  sheets: [
    { key: "gunnerUlt.deathRondoCast", dirs: 1, frames: 7, active: 0, size: 96, draw: rondoCast },
    { key: "gunnerUlt.deathRondo", dirs: 1, frames: RONDO_N, active: RONDO_A, size: 2 * (RONDO_GUN + 60), draw: rondoBurst },
    { key: "gunnerUlt.deathRondoGround", dirs: 1, frames: RONDO_N, active: RONDO_A, size: 2 * 56, draw: rondoGround },
    ...shotSheets("rondo", {
      muzzle: rondoMuzzle,
      muzzleFrames: 5,
      muzzleSize: 56,
      impact: { s: 1.1, seed: 5140, heavy: false },
      hit: { s: 1.1, seed: 5150, through: true },
      fizzle: rondoFizzle,
      fizzleFrames: 5,
    }),
    { key: "gunnerUlt.godspeedCast", dirs: DIRS, frames: 6, active: 0, size: 136, draw: godspeedCast },
    { key: "gunnerUlt.godspeed", dirs: DIRS, frames: GOD_N, active: GOD_A, size: 2 * (HAND + GOD_LEN + 36), draw: godspeedBurst },
    ...shotSheets("godspeed", {
      muzzle: godspeedMuzzle,
      muzzleFrames: 6,
      muzzleSize: 120,
      impact: { s: 1.35, seed: 5240, heavy: true },
      hit: { s: 1.3, seed: 5250, through: false },
      fizzle: godspeedFizzle,
      fizzleFrames: 7,
    }),
    { key: "gunnerUlt.barrageCast", dirs: 1, frames: 10, active: 0, size: 160, draw: barrageCast },
    { key: "gunnerUlt.barrage", dirs: 1, frames: BAR_N, active: 0, size: 112, draw: barrageSustain },
    { key: "gunnerUlt.barrageGround", dirs: 1, frames: BAR_N, active: 0, size: 112, draw: barrageSustainGround },
  ],
};
