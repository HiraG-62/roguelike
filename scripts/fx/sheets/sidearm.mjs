// 片手銃（moveset "sidearm"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/sidearm.json・弾の表）× 2 が目安
//
// 銃の家系の見本。弾 4 種（拳銃・回転式・短機関銃・三連銃）は、同じ部品を数値（GUNS の表）で描き分けず、
// 銃口の閃光の「形」そのものを銃ごとに別の関数にする（菱形 / 横へ漏れる火花 / ちらつく星 / 前へ伸びる針）。
// 曳光・着弾・命中・尽きた煙は共通の部品を数値で変える（太さ・長さ・粒の数）。
//
// 部品:
//   曳光（tracer）: 弾頭の小さな尖りと、後ろ（−x）へ細る光の尾。芯の 1 ドットだけ白、尾は段 5 → 2 へ落ちる
//   閃光の針（spike）: 原点から外へ細る 1 本の三角。銃口の閃光・火花の放射を組む
//   薬莢（casing）: 2〜3 ドットの真鍮の棒が回りながら横（+y）へ飛ぶ
//   煙（smoke）: 画面に揃えて上へ昇る細い煙（dirs 1）。段 2〜3 の薄い筋で、白を使わない
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光は 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;

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
 * 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角。
 * 芯（中央線）が明るく、先ほど暗い。bright で全体の明るさ
 */
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

/** 円い閃光の芯（半径 r）。中心ほど明るい。回しても崩れない丸なので paint で塗る */
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
 * 前へ押し出す圧の弧（潰れた楕円の前側だけ）。銃口・打撃の衝撃の輪を全周で描くと、
 * 閃光の横に「輪っか」がぶら下がって見えるので、進む向き（+x）の ±spread だけ残す
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

/** 菱形の閃光: 前へ fwd、後ろへ back、上下へ half。中心ほど明るく、白は芯だけ */
function diamond(frame, o) {
  const { x = 0, fwd, back, half } = o;
  const bright = o.bright ?? 1;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      // 指数 < 1 で辺が内へ反る（尖った 4 本の角が立ち、丸い塊に見えない）
      const e = Math.sqrt(dx >= 0 ? dx / fwd : -dx / back) + Math.sqrt(Math.abs(py) / half);
      if (e > 1) return -1;
      return clamp01((1 - e) ** 0.7 * 1.15 * bright);
    },
    { bounds: { x0: x - back - 1, y0: -half - 1, x1: x + fwd + 1, y1: half + 1 } },
  );
}

/**
 * 薬莢: (x, y) の 2〜3 ドットの棒。spin（0..3）で向きが 45° ずつ回る（飛びながら回る真鍮の筒）。
 * 段 5 の口と段 4 の胴で、白を使わない（閃光より目立たせない）
 */
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
 * 横（+y、銃の排莢口の側）へ飛ぶ薬莢。age（フレーム）で放物線を描き、回りながら落ちる。
 * 正準座標は武器の向きで回るので「横」は常に銃の右。落下は +x（後ろへ流れない）ではなく −x へ少し戻す
 */
function ejectCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  const x = o.x - o.back * t;
  const y = o.y + o.side * t - 0.35 * t * t * o.fall;
  casing(frame, x, y, o.spin + t, t / (o.life + 1));
}

/**
 * 画面に揃えて昇る細い煙（dirs 1 のシート用）。(x0, y0) から上へ height、ゆらぎは sway。
 * age（0..1）で昇りながら薄く・切れ切れになる。段 2〜3 だけ
 */
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
    { bounds: { x0: x0 - (o.sway ?? 3) - width * 3 - 6, y0: y0 - rise - height - 1, x1: x0 + (o.sway ?? 3) + width * 3 + 6 + Math.abs(o.lean ?? 0), y1: y0 - rise + 1 }, samples: 2 },
  );
}

// -----------------------------------------------------------------------------
// 弾 4 種の数値（曳光・着弾・命中・尽きた煙）。1 論理 px = 2 ドット、半径 2 → 太さ 4 ドット
// -----------------------------------------------------------------------------

/**
 * tail = 尾の長さ（速さ × 0.04 秒が目安: 300px/秒 → 24 ドット）、half = 弾頭の半幅、tailHalf = 尾の根元の半幅、
 * head = 弾頭の尖りの長さ、flick = 尾の長さのちらつき（フレームごと）、spark / chip = 着弾・命中の粒の数と速さ
 */
const GUNS = {
  // 拳銃: 標準。中くらいの曳光
  pistol: { tail: 24, half: 2, tailHalf: 1.2, head: 4, flick: 0.12, frames: 4, period: 0.12, spark: 7, sparkSpeed: 3.2, chip: 6, ringR: 5, seed: 1100 },
  // 回転式: 一発が重い。曳光はやや太く、弾頭の芯が大きい
  revolver: { tail: 26, half: 2.6, tailHalf: 1.8, head: 5, flick: 0.1, frames: 4, period: 0.14, spark: 11, sparkSpeed: 4, chip: 9, ringR: 7, seed: 1200 },
  // 短機関銃: 細く短い曳光。連射の軽さ
  smg: { tail: 17, half: 1.5, tailHalf: 0.8, head: 3, flick: 0.2, frames: 4, period: 0.09, spark: 5, sparkSpeed: 2.6, chip: 4, ringR: 4, seed: 1300 },
  // 三連銃: 長く鋭い曳光。弾頭は針のように細長い
  burstRifle: { tail: 36, half: 1.7, tailHalf: 1, head: 7, flick: 0.06, frames: 4, period: 0.1, spark: 6, sparkSpeed: 3.6, chip: 5, ringR: 4.5, seed: 1400 },
};

/**
 * 曳光（飛んでいる弾）: 原点 = 弾の中心、+x = 進む向き。弾頭の尖りから後ろへ細る尾。
 * 白（段 7）は弾頭の芯の数ドットだけ。尾の長さをフレームごとに少しちらつかせ、尾の途中に火の粉を 1 つ落とす
 */
function tracer(frame, f, g) {
  const len = g.tail * (1 + (hash1(f, g.seed) - 0.5) * 2 * g.flick);
  const H = g.half;
  // 弾頭: 前後に長い楕円（前の半分は尖らせる）。中心が白い芯
  const cx = -H * 0.5;
  const rxBack = H * 1.6;
  const rxFront = g.head + H * 0.5;
  // 尾: 弾頭の後ろから −x へ細る。明るさの上限を 0.76（段 6）に抑え、白は弾頭だけにする
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
        const d = Math.abs(y);
        if (d <= hw) v = Math.max(v, clamp01((1 - d / hw) ** 0.6 * 0.76 * (1 - u) ** 1.1 + 0.08));
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -H - 2, x1: g.head + 3, y1: H + 2 }, dither: 0.03 },
  );
  // 尾から剥がれる火の粉（フレームごとに位置を変えて、尾が燃えている感じを出す）
  const ex = -len * (0.45 + 0.4 * hash1(f, g.seed + 1));
  const ey = (hash1(f, g.seed + 2) > 0.5 ? 1 : -1) * (g.tailHalf + 1.2);
  dot(frame, ex, ey, 4);
}

// -----------------------------------------------------------------------------
// 銃口の閃光（銃ごとに形を変える）。原点 = 弾が出た位置（銃口の少し先）、+x = 撃った向き
// -----------------------------------------------------------------------------

/** 拳銃: 短い菱形の閃光（前に長く横に短い菱形 + 前の細い針）と、前へ押し出す圧の弧、消えぎわの火の粉 */
function muzzlePistol(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 1 ? 1 : f === 0 ? 0.85 : 0.55;
    diamond(frame, { x: -2, fwd: 20 * s, back: 8 * s, half: 9 * s });
    spike(frame, { x: 4, a: 0, len: 10 * s, w: 1.6 * s, bright: 0.95 });
    if (f === 1) sparkle(frame, -2, 0, 2);
  } else {
    // 閃光が引いたあとの火の粉
    shards(frame, f - 2, 5, 1111, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.4;
      const sp = 2 + rnd(2) * 2.5;
      return { x: 6, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
  if (f >= 1) frontArc(frame, { ox: 8 + f * 3, radius: 4 + f * 2.5, width: 1.6, squash: 0.5, erosion: Math.min(0.9, k * 0.8), bright: 0.6 - k * 0.2, seed: 1112 });
}

/**
 * 回転式: 大きな閃光（前の太い針 + 斜めの 2 本）と、シリンダーの隙間（原点の少し後ろ）から
 * 真横へ漏れる火花の扇。一発の重さを最初のフレームの大きさで見せる
 */
function muzzleRevolver(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  const gapX = -8;
  if (f <= 2) {
    const s = f === 0 ? 1.05 : f === 1 ? 1 : 0.65;
    spike(frame, { x: -2, a: 0, len: 22 * s, w: 5 * s, bright: 1 });
    spike(frame, { x: -2, a: 28 * DEG, len: 11 * s, w: 2.6 * s, bright: 0.9 });
    spike(frame, { x: -2, a: -28 * DEG, len: 11 * s, w: 2.6 * s, bright: 0.9 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 7 * s, w: 2.4 * s, bright: 0.8 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 7 * s, w: 2.4 * s, bright: 0.8 });
    flashCore(frame, -2, 0, 4 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, f === 0 ? 3 : 4);
    // シリンダーの隙間の噴き出し: 真横へ扇に開く細い針（左右 3 本ずつ、少し後ろへ寝かせる）
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const a = side * (Math.PI / 2 + (j - 1) * 20 * DEG + 12 * DEG);
        spike(frame, { x: gapX, y: side * 2, a, len: (j === 1 ? 10 : 7) * s, w: 1.3, bright: j === 1 ? 0.9 : 0.75 });
      }
    }
  }
  // 隙間から横へ散る火花（上下に対称に近く。反転されないが、どちらの手でも自然に見える）
  shards(frame, f, 10, 1211, (i, rnd) => {
    const side = i % 2 === 0 ? 1 : -1;
    const a = side * (Math.PI / 2 + (rnd(1) - 0.3) * 0.7);
    const sp = 2.5 + rnd(2) * 3;
    return { x: gapX, y: side * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 14 + age * 4, radius: 6 + age * 3, width: 2.2, squash: 0.5, erosion: Math.min(0.9, k * 0.85), bright: 0.72 - k * 0.3, seed: 1212 });
  }
  if (f >= 3) {
    shards(frame, f - 3, 6, 1213, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.1;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 10, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
}

/**
 * 短機関銃: 小さくちらつく星。フレームごとに針の本数・角・長さが変わる（連射の瞬きが毎回違って見える）。
 * 排莢口（原点の後ろ）から薬莢が横へ飛ぶ
 */
function muzzleSmg(frame, f) {
  const N = 5;
  if (f <= 2) {
    const n = 3 + Math.floor(hash1(f, 1311) * 3);
    const s = f === 2 ? 0.6 : 1;
    const rot = (hash1(f, 1312) - 0.5) * 0.9;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU + (hash1(i + f * 7, 1313) - 0.5) * 0.6;
      // 前（+x）に向いた針ほど長い。後ろへは短い
      const fwd = 0.45 + 0.55 * Math.max(0, Math.cos(a));
      spike(frame, { x: -1, a, len: (5 + 7 * hash1(i + f * 5, 1314)) * fwd * s + 2, w: 1.7 * s, bright: 0.95 });
    }
    spike(frame, { x: -1, a: 0, len: 9 * s, w: 2 * s, bright: 1 });
    flashCore(frame, -1, 0, 2 * s, 1);
  }
  ejectCasing(frame, f, { x: -9, y: 4, side: 3.4, back: 1, fall: 0.5, spin: 1, life: N });
  if (f >= 2) {
    shards(frame, f - 2, 3, 1315, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.2;
      const sp = 2 + rnd(2) * 2;
      return { x: 3, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
}

/** 三連銃: 細長く前へ伸びる針と、斜め前へ開く細い 2 本の鉤。横へはほとんど広がらない */
function muzzleBurst(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  if (f <= 2) {
    const grow = f === 0 ? 0.75 : f === 1 ? 1 : 0.8;
    const thin = f === 2 ? 0.6 : 1;
    spike(frame, { x: -4, a: 0, len: 30 * grow, w: 2.6 * thin, bright: 1 });
    spike(frame, { x: -2, a: 16 * DEG, len: 13 * grow, w: 1.3 * thin, bright: 0.85 });
    spike(frame, { x: -2, a: -16 * DEG, len: 13 * grow, w: 1.3 * thin, bright: 0.85 });
    spike(frame, { x: -4, a: Math.PI, len: 4, w: 1.8 * thin, bright: 0.7 });
    flashCore(frame, -4, 0, 2.2 * thin, 1);
    if (f === 1) sparkle(frame, 20, 0, 2);
  }
  // 前へ抜ける細い衝撃の筋（平行の 2 本。上下に離して、閃光の線と重ねない）
  if (f >= 1 && f <= 3) {
    for (const side of [-1, 1]) {
      const x1 = 26 + f * 5;
      streakLine(frame, { ax: x1 - 12, ay: side * (4 + f), bx: x1, by: side * (4 + f), bright: 0.5 * (1 - k) });
    }
  }
  if (f >= 2) {
    shards(frame, f - 2, 4, 1411, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 0.5;
      const sp = 3 + rnd(2) * 3;
      return { x: 12 + rnd(3) * 10, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 着弾・命中・尽きた（4 種共通の形を GUNS の数値で変える）
// -----------------------------------------------------------------------------

/**
 * 着弾（壁・敵で消えた）: 原点 = 消えた位置、+x = 弾の進んでいた向き。
 * 当たった面（y に沿う短い閃き）と、後ろ（−x の半球）へ跳ね返る火花。火花は尾を引いて曲がりながら落ちる
 */
function impact(frame, f, g) {
  const N = 7;
  const s = g.ringR / 5;
  if (f <= 1) {
    // 当たった面の閃き（弾の進みに直交する平たい線）
    lens(frame, { ax: -1, ay: -9 * s, bx: -1, by: 9 * s, T: (f === 0 ? 4 : 2.6) * s, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 8 * s, w: 2.2 * s, bright: 1 });
    flashCore(frame, 0, 0, 2.6 * s, 1);
    sparkle(frame, 0, 0, f === 0 ? (s > 1.2 ? 3 : 2) : 2);
  }
  // 跳ね返る火花: 後ろの半球に広がり、長いものは 1 ドットの尾を引く
  shards(frame, f, g.spark, g.seed + 21, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.3;
    const sp = g.sparkSpeed * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  // 火花の軌跡（最初の 3 フレームだけ、跳ね返りの向きへ 1px の筋）
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
    // 当たった所に残る小さな焦げ（段 2〜3 の点）
    const age = f - 2;
    for (let i = 0; i < 3; i++) {
      if (hash1(i + age * 3, g.seed + 23) < age / (N - 2)) continue;
      dot(frame, -1 - hash1(i, g.seed + 24) * 2, (hash1(i, g.seed + 25) - 0.5) * 6 * s, 3);
    }
  }
}

/**
 * 命中（敵の体に食い込む）: 原点 = 敵、+x = 弾の進む向き。
 * 小さな衝撃の輪（進む向きに潰れる）と、前（貫いた側）へ飛ぶ角ばった破片。着弾より重く、跳ね返らない
 */
function bulletHit(frame, f, g) {
  const N = 6;
  const s = g.ringR / 5;
  const k = f / (N - 1);
  if (f <= 1) {
    spike(frame, { x: -2, a: 0, len: 10 * s, w: 2.6 * s, bright: 1 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 5 * s, w: 1.8 * s, bright: 0.8 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 5 * s, w: 1.8 * s, bright: 0.8 });
    flashCore(frame, -2, 0, 3 * s, 1);
    if (f === 0) sparkle(frame, -2, 0, s > 1.2 ? 3 : 2);
  }
  // 輪は小さく速く消す（大きく残すと弾より目立つ）。破片が主役
  if (f >= 1 && f <= 3) ring(frame, { radius: g.ringR * (0.6 + f * 0.45), width: 1.8, squash: 0.6, erosion: Math.min(0.9, (f - 1) * 0.35), bright: 0.7 - f * 0.1, seed: g.seed + 31 });
  // 破片: 前（貫いた側）の扇に多く、少しだけ手前へ跳ねる。角ばった 2 ドットの粒
  shards(frame, f, g.chip + 3, g.seed + 32, (i, rnd) => {
    const back = rnd(5) < 0.25;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.6 : (rnd(1) - 0.5) * 1.9;
    const sp = g.sparkSpeed * (back ? 0.6 : 1) * (0.8 + 0.8 * rnd(2));
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/**
 * 尽きた（射程の端）: dirs 1。弾が燃え尽きた所に弱い火の粉が 1 つ残り、細い煙が画面の上へ昇って切れる。
 * 煙は向きを持たない（どの向きに撃っても上へ昇る）ので回さない
 */
function fizzle(frame, f, g) {
  const N = 7;
  const age = f / (N - 1);
  const s = g.ringR / 5;
  // 燃え残りの火の粉: 最初は 2x2 の小さな点、すぐ 1 ドットになって煙に呑まれる
  if (f === 0) stampEmber(frame, 5);
  else if (f <= 3) dot(frame, 0, -f * 0.8, Math.max(3, 6 - f));
  smokeWisp(frame, { x0: 0, y0: -1, height: 8 + 5 * s + f * 2.5, width: 0.8 * Math.min(1.3, s) + age * 0.6, age, seed: g.seed % 97, sway: 3.2, lean: 2, rise: 7, bright: 0.33 });
}

/** 2x2 の火の粉（画面に揃える） */
function stampEmber(frame, level) {
  dot(frame, 0, 0, level + 1);
  dot(frame, 1, 0, level);
  dot(frame, 0, 1, level);
  dot(frame, 1, 1, level - 1);
}

// -----------------------------------------------------------------------------
// 近接の振り（銃把打ち・銃口払い・蹴り離し・ダッシュ攻撃）
// -----------------------------------------------------------------------------

/**
 * 塗りの衝撃の星: (x, y) を中心に n 本のトゲ（長さはハッシュでばらす）+ 芯。
 * 刃ではなく鈍器の打撃なので、白は芯の中心だけ
 */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.6) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  flashCore(frame, x, y, o.core ?? R * 0.28, bright);
}

/**
 * 銃把打ち（box reach 12 / size 20、原点 = 当たりの中心 = 自分から 24 ドット先）:
 * 銃の握りを短く振り下ろす鈍い弧（白い縁なし）が当たりの中心で止まり、角ばった衝撃の星と潰れた輪が弾ける
 */
function butt(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  // 振りの弧: 自分（x = −24）を中心に、上から当たりの中心へ短く振り下ろす
  const cx = -24;
  // 外縁が当たりの中心（x = 0）の少し先で止まる半径
  const R = 27;
  const from = -80 * DEG;
  const head = from + 80 * DEG * p;
  const T = 15 * (1 - k * 0.6);
  if (k < 0.8) {
    paint(
      frame,
      (x, y) => {
        const dx = x - cx;
        const r = Math.hypot(dx, y);
        const a = Math.atan2(y, dx);
        const s = head - a;
        const span = 62 * DEG * (0.55 + 0.45 * p);
        if (s < 0 || s > span) return -1;
        const u = s / span;
        const w = T * (1 - u) ** 0.7;
        const q = (R + 2 - r) / w;
        if (q < 0 || q > 1) return -1;
        if (!survives(x, y, k * 1.1, 1 - q, 1511)) return -1;
        // 鈍い振り: 縁は段 5 まで。白くしない
        return clamp01((1 - q) ** 0.8 * (0.74 - 0.35 * u) * (1 - k * 0.4));
      },
      { bounds: { x0: -26, y0: -32, x1: 6, y1: 4 } },
    );
  }
  if (f === A - 1) {
    bluntStar(frame, { R: 16, n: 7, seed: 1512, w: 3, core: 4.5 });
    sparkle(frame, 0, 0, 3);
  }
  if (f >= A) {
    const age = f - A + 1;
    // 星は大きくせず、トゲの先から速く欠ける（残ると羅針盤のような図形に見える）
    if (age <= 3) bluntStar(frame, { R: 17 + age * 1.5, n: 7, seed: 1512, w: 3 * (1 - k * 0.5), core: 4 * (1 - k), bright: 0.9 - k * 0.4, erosion: Math.min(0.95, k * 1.5) });
    // 打った向き（振り下ろした +y と前の +x の間）へ押し出す潰れた弧
    if (age <= 3) {
      const t = age / 3;
      paint(
        frame,
        (x, y) => {
          const a = Math.atan2(y, x) - 30 * DEG;
          if (Math.abs(a) > 75 * DEG) return -1;
          const rr = 9 + age * 5;
          const d = Math.abs(Math.hypot(x, y) - rr);
          if (d > 1.4) return -1;
          if (!survives(x, y, t * 0.8 + (Math.abs(a) / (75 * DEG)) * 0.3, 1 - d / 1.4, 1513)) return -1;
          return clamp01((0.78 - t * 0.3) * (1 - Math.abs(a) / (75 * DEG) * 0.5));
        },
        { bounds: { x0: -30, y0: -30, x1: 30, y1: 30 } },
      );
    }
  }
  if (f >= A - 1) {
    // 角ばった破片: 振り下ろした向き（+y と +x の間）へ多く飛ぶ
    shards(frame, f - (A - 1), 8, 1514, (i, rnd) => {
      const a = -0.2 + rnd(1) * 2.2;
      const sp = 3 + rnd(2) * 3;
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 2, drag: 0.8 };
    });
  }
}

/**
 * 銃口払い（circle size 36、原点 = 自分）: 銃口の軌跡が自分の周りを 1 周する細い光の帯。
 * 帯の先（銃口）は外縁だけ白く、進むにつれて銃口から小さな火花が接線へ弾き出される
 */
function muzzleSweep(frame, f) {
  const A = 4;
  const N = 8;
  const R = 36;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const start = -100 * DEG;
  const head = start + TAU * p + k * 40 * DEG;
  const tailSpan = (f < A ? 200 : 200 - 150 * k) * DEG;
  const T = 7 * (1 - k * 0.5);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 1 || r < R - T - 1) return -1;
      let s = (head - Math.atan2(y, x)) % TAU;
      if (s < 0) s += TAU;
      if (s > tailSpan) return -1;
      const u = s / tailSpan;
      const w = T * (1 - u) ** 0.5 + 0.6;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, k * 0.95 + u * 0.25, 1 - u, 1611)) return -1;
      if (R - r < 1.3 && u < 0.3 && k < 0.5) return 1;
      return clamp01((1 - q) ** 0.9 * (0.85 - 0.6 * u) * (1 - k * 0.35));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  // 銃口の火花: 通り道の 3 か所で、その時の銃口から接線（時計回りの進む向き）と外へ弾き出す
  for (let j = 0; j < 3; j++) {
    const born = j + 1;
    if (f < born) continue;
    const a0 = start + TAU * easeSwing((born + 0.5) / A);
    shards(frame, f - born, 4, 1612 + j, (i, rnd) => {
      const out = 0.3 + 0.5 * rnd(1);
      const sp = 2.5 + rnd(2) * 2.5;
      const vx = (-Math.sin(a0) * (1 - out) + Math.cos(a0) * out) * sp;
      const vy = (Math.cos(a0) * (1 - out) + Math.sin(a0) * out) * sp;
      return { x: Math.cos(a0) * (R - 2), y: Math.sin(a0) * (R - 2), vx, vy, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
  if (f < A && k === 0) {
    const tipR = R - 2;
    sparkle(frame, Math.cos(head) * tipR, Math.sin(head) * tipR, f === A - 1 ? 3 : 2);
  }
}

/**
 * 蹴り離し（box reach 12 / size 20、原点 = 当たりの中心）: 前へ突き出す厚い空気の塊（縁を白くしない）と、
 * 足裏の当たる面で潰れて広がる輪、後ろへ流れる風の筋。刃ではなく押し出す力
 */
function kickAway(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const tip = -16 + 30 * p + k * 6;
  const back = -26 + k * 30;
  // 蹴りの塊: 後ろは細く、前ほど太い楔（足裏で押す面が前にある）。縁を白くしない
  if (k < 0.9) {
    const H = 11 * (1 - k * 0.35);
    paint(
      frame,
      (x, y) => {
        const d = Math.abs(y);
        // 前縁は前へふくらむ弧（足裏が押し出す面）
        const front = tip - (d / H) ** 2 * 5;
        if (x < back || x > front) return -1;
        const u = (x - back) / Math.max(1, tip - back);
        const hw = 1.5 + (H - 1.5) * u ** 0.6;
        if (d > hw) return -1;
        const q = d / hw;
        if (!survives(x, y, k * 0.95 + (1 - u) * 0.25, u * (1 - q), 1711)) return -1;
        // 前縁（足裏の面）だけ段 6、本体は後ろほど薄い空気。横の筋目で塊のべた塗りを崩す
        if (front - x < 2.2 && k < 0.5) return 0.8 - q * 0.25;
        const grain = 0.78 + 0.35 * hash1(Math.floor((y + 40) / 1.7), 1718);
        return clamp01(u ** 1.3 * 0.72 * grain * (1 - q * 0.35) * (1 - k * 0.3));
      },
      { bounds: { x0: back - 1, y0: -H - 1, x1: tip + 1, y1: H + 1 } },
    );
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    frontArc(frame, { ox: tip - 2 + age * 2, radius: 6 + age * 4, width: 2.4 - age * 0.25, squash: 0.5, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.75 - age * 0.08, seed: 1713 });
    shards(frame, age, 7, 1714, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.5;
      const sp = 3 + rnd(2) * 3;
      return { x: tip, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  // 風の筋: 塊の上下の外側を後ろへ（内側に重ねない）
  for (let i = 0; i < 4; i++) {
    if (k > 0.8) break;
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (12 + Math.floor(i / 2) * 4 + k * 3);
    const x1 = tip - 8 - hash1(i, 1715) * 8 - k * 12;
    streakLine(frame, { ax: x1 - 14 - hash1(i, 1716) * 10, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
  }
}

/**
 * ダッシュ攻撃（circle size 36、原点 = 自分）: 走り抜けた勢いで広がる衝撃の輪。前（+x）側だけ明るく厚く、
 * 後ろへ流れる速度線の束と、足元から散る砂粒。銃口払い（細い光の帯が 1 周）とは形で見分ける
 */
function dash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const R = 14 + 22 * p + k * 6;
  const W = 7 * (1 - k * 0.6);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const front = (Math.cos(Math.atan2(y, x)) + 1) / 2;
      const w = W * (0.45 + 0.55 * front);
      const d = r - (R - w);
      if (d < 0 || d > w) return -1;
      const q = d / w;
      if (!survives(x, y, k * 0.95 + (1 - front) * 0.15, q, 1811)) return -1;
      // 外縁（進む側）ほど明るい。前の外縁だけ段 6
      return clamp01(q ** 0.9 * (0.4 + 0.45 * front) * (1 - k * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  if (k < 0.9) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 9 + (hash1(i, 1812) - 0.5) * 4;
      const x1 = -Math.sqrt(Math.max(0, R * R - y * y)) - 3 - k * 10;
      const len = 14 + 16 * hash1(i, 1813);
      streakLine(frame, { ax: x1 - len * (1 - k * 0.5), ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, R - 3, 0, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 1814, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 2.5;
      return { x: Math.cos(a) * R * 0.9, y: Math.sin(a) * R * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.6 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// その場で撃つ派生（三連射・至近撃ち・二度撃ち）。circle size 20、原点 = 自分。
// 弾は弾の絵が出るので、ここは銃を構えた先の小さな閃き・薬莢・反動の風だけ
// -----------------------------------------------------------------------------

/** 手元の閃き 1 つ（小さな 4 本の針。前が長い） */
function handFlash(frame, x, y, a, s) {
  spike(frame, { x, y, a, len: 9 * s, w: 2.2 * s, bright: 1 });
  spike(frame, { x, y, a: a + Math.PI / 2, len: 4 * s, w: 1.6 * s, bright: 0.8 });
  spike(frame, { x, y, a: a - Math.PI / 2, len: 4 * s, w: 1.6 * s, bright: 0.8 });
  flashCore(frame, x, y, 2 * s, 1);
}

/** 銃を構えた先（自分の中心から前へ）。キャラ 48 ドットの縁の少し外 */
const HAND = 20;

/**
 * 三連射: 扇に少しずつ振りながら 3 回撃つ。閃きは −14° → 0° → +14° と 1 フレームずつ移り、
 * 撃つたびに薬莢が横へ飛ぶ。反動の小さな弧（自分の前の半円の細い線）が揺れる
 */
function tripleShot(frame, f) {
  const N = 8;
  for (let j = 0; j < 3; j++) {
    const a = (j - 1) * 14 * DEG;
    const age = f - j;
    if (age === 0) handFlash(frame, Math.cos(a) * HAND, Math.sin(a) * HAND, a, 1.2);
    if (age === 1) sparkle(frame, Math.cos(a) * (HAND + 6), Math.sin(a) * (HAND + 6), 1);
    ejectCasing(frame, age, { x: 2, y: 8, side: 2.2, back: 1, fall: 0.3, spin: j, life: 4 });
  }
  // 撃つたびに銃口の前へ押し出す短い圧の弧（撃った向きごと。閃きの 1 フレーム後）
  for (let j = 0; j < 3; j++) {
    const age = f - j - 1;
    if (age < 0 || age > 2) continue;
    const a = (j - 1) * 14 * DEG;
    const r = HAND + 9 + age * 4;
    paint(
      frame,
      (x, y) => {
        const d = Math.abs(Math.hypot(x, y) - r);
        const da = Math.abs(Math.atan2(y, x) - a);
        if (d > 0.8 || da > 9 * DEG) return -1;
        return (0.62 - age * 0.15) * (1 - (da / (9 * DEG)) * 0.5);
      },
      { bounds: { x0: HAND, y0: -24, x1: HAND + 22, y1: 24 }, dither: 0, samples: 2 },
    );
  }
  if (f >= N - 3) {
    // 最後は煙の粒（段 2〜3）が銃口の前に漂う
    for (let i = 0; i < 3; i++) dot(frame, HAND + 4 + hash1(i, 1911) * 6, (hash1(i, 1912) - 0.5) * 10 - (f - N + 3), 3);
  }
}

/**
 * 至近撃ち: 相手に銃口を押し付けて撃つ 1 発。前の短い距離で閃光が大きく弾け（6 本の針）、
 * 押し出す潰れた輪と、前へ開く衝撃の V 字の筋。自分の周り（size 20）に収まる大きさ
 */
function pointShot(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  const X = HAND + 2;
  if (f <= 1) {
    bluntStar(frame, { x: X, R: f === 0 ? 12 : 15, n: 6, seed: 2011, w: 2.4, core: 3.5, rot: 0.2 });
    spike(frame, { x: X, a: 0, len: 18, w: 3, bright: 1 });
    sparkle(frame, X, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: X + age * 3, radius: 5 + age * 3.5, width: 2.2, squash: 0.5, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.1, seed: 2012 });
  }
  if (f >= 1 && f <= 3) {
    for (const side of [-1, 1]) {
      const r0 = 6 + f * 4;
      const a = side * 30 * DEG;
      streakLine(frame, { ax: X + Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: X + Math.cos(a) * (r0 + 8), by: Math.sin(a) * (r0 + 8), bright: 0.7 * (1 - k) });
    }
  }
  ejectCasing(frame, f - 1, { x: 4, y: 8, side: 2.4, back: 1.2, fall: 0.3, spin: 2, life: 5 });
  if (f >= 2) {
    shards(frame, f - 2, 7, 2013, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.8;
      const sp = 2.5 + rnd(2) * 3;
      return { x: X + 4, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 二度撃ち: 同じ所へ間を置かず 2 発。閃きは同じ位置で 2 回（2 回目がひとまわり大きい）、
 * 間に反動で銃口が跳ね上がる小さな弧（+y 側を避けて −y 側へ）。薬莢は 2 つ
 */
function doubleTap(frame, f) {
  const N = 8;
  if (f === 0) handFlash(frame, HAND, 0, 0, 1.1);
  if (f === 1) sparkle(frame, HAND + 5, 0, 2);
  if (f === 2) {
    handFlash(frame, HAND, 0, 0, 1.5);
    sparkle(frame, HAND + 2, 0, 3);
  }
  if (f === 3) sparkle(frame, HAND + 6, 0, 2);
  // 銃口の跳ね上がり: 前から −y 側へ小さく反る 1px の弧（2 発の間とあと）
  if (f >= 1 && f <= 4) {
    const k = (f - 1) / 4;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (Math.abs(r - HAND) > 0.8) return -1;
        const a = Math.atan2(y, x);
        if (a > 0 || a < -34 * DEG) return -1;
        return (0.6 - (-a / (34 * DEG)) * 0.35) * (1 - k * 0.6);
      },
      { bounds: { x0: 0, y0: -HAND - 2, x1: HAND + 2, y1: 2 }, dither: 0, samples: 2 },
    );
  }
  ejectCasing(frame, f, { x: 2, y: 8, side: 2.2, back: 1, fall: 0.3, spin: 0, life: 4 });
  ejectCasing(frame, f - 2, { x: 2, y: 8, side: 2.6, back: 0.6, fall: 0.3, spin: 3, life: 4 });
  if (f >= 3) {
    // 2 発の火の粉が前へ細く流れる
    shards(frame, f - 3, 5, 2111, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 0.8;
      const sp = 2.5 + rnd(2) * 2;
      return { x: HAND + 4, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
  if (f >= N - 3) {
    for (let i = 0; i < 2; i++) dot(frame, HAND + 3 + hash1(i, 2112) * 5, (hash1(i, 2113) - 0.5) * 8 - (f - N + 3), 3);
  }
}

// -----------------------------------------------------------------------------
// 近接の命中（銃把・蹴り・銃口払いが当たったとき）
// -----------------------------------------------------------------------------

/**
 * 命中: 鈍器の打撃。当たった所の角ばった衝撃の星（白は芯だけ）と潰れた輪、進む向きへ飛ぶ破片。
 * heavy は星が大きく、輪が 2 重に時間差で広がる
 */
function meleeHit(frame, f, heavy) {
  const R = heavy ? 22 : 14;
  if (f <= 1) {
    bluntStar(frame, { R: R * (f === 0 ? 0.8 : 1), n: heavy ? 8 : 6, seed: heavy ? 2211 : 2221, w: heavy ? 3.2 : 2.4, core: heavy ? 5 : 3.5 });
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : heavy ? 3 : 2);
  } else if (f === 2) {
    // 星は 3 フレーム目で芯を失ってトゲの根元から欠け、以降は輪と破片だけ（星と輪が重なり続けると羅針盤に見える）
    bluntStar(frame, { R, n: heavy ? 8 : 6, seed: heavy ? 2211 : 2221, w: (heavy ? 3.2 : 2.4) * 0.7, core: 0.1, bright: 0.75, erosion: 0.6 });
  }
  if (f >= 1) {
    const age = f - 1;
    // 輪は 1 本だけ（2 本を同心で重ねると的に見える）。重い命中は太く大きく
    ring(frame, { radius: (heavy ? 9 : 6) + age * (heavy ? 6 : 4.5), width: heavy ? 3.2 : 2, squash: 0.7, erosion: Math.min(0.92, age * 0.24), bright: 0.8 - age * 0.1, seed: heavy ? 2212 : 2222 });
  }
  shards(frame, f - 1, heavy ? 16 : 9, heavy ? 2214 : 2224, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.4 : 3.6);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 4 : 2.5);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 銃口の閃光の関数（銃ごとに形が違う） */
const MUZZLES = { pistol: muzzlePistol, revolver: muzzleRevolver, smg: muzzleSmg, burstRifle: muzzleBurst };
/** 銃口の閃光のフレーム数（0.12 秒で流す） */
const MUZZLE_FRAMES = { pistol: 5, revolver: 6, smg: 5, burstRifle: 5 };

/** 弾 1 種のシート（曳光・銃口・着弾・命中・尽きた）。作業面は形の大きさ + 余白 */
function gunSheets(name) {
  const g = GUNS[name];
  const s = g.ringR / 5;
  return [
    { key: `sidearm.${name}Fly`, dirs: SHOT_DIRS, frames: g.frames, active: 0, size: Math.ceil(g.tail * 1.25 + 8) * 2, draw: (frame, f) => tracer(frame, f, g) },
    { key: `sidearm.${name}Muzzle`, dirs: DIRS, frames: MUZZLE_FRAMES[name], active: 0, size: name === "burstRifle" || name === "revolver" ? 96 : 72, draw: MUZZLES[name] },
    { key: `sidearm.${name}Impact`, dirs: DIRS, frames: 7, active: 0, size: Math.ceil(40 * s) + 16, draw: (frame, f) => impact(frame, f, g) },
    { key: `sidearm.${name}Hit`, dirs: DIRS, frames: 6, active: 0, size: Math.ceil(44 * s) + 16, draw: (frame, f) => bulletHit(frame, f, g) },
    { key: `sidearm.${name}Fizzle`, dirs: 1, frames: 7, active: 0, size: 64, draw: (frame, f) => fizzle(frame, f, g) },
  ];
}

/** 弾の表の 1 行（物理の弾なので配色は真鍮の曳光） */
function bulletRow(name) {
  const g = GUNS[name];
  return {
    fly: `sidearm.${name}Fly`,
    period: g.period,
    base: 2,
    muzzle: `sidearm.${name}Muzzle`,
    impact: `sidearm.${name}Impact`,
    hit: `sidearm.${name}Hit`,
    fizzle: `sidearm.${name}Fizzle`,
    ramp: "brass",
  };
}

const GUN_KEYS = ["pistol", "smg", "revolver", "burstRifle"];

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "sidearm",
  motions: {
    dash: { sheet: "sidearm.dash", pivot: "self", base: 36, measure: "size" },
    "r:sidearmButt": { sheet: "sidearm.butt", pivot: "anchor", base: 12, measure: "reach" },
    "r:muzzleSweep": { sheet: "sidearm.sweep", pivot: "self", base: 36, measure: "size" },
    "branch:tripleShot": { sheet: "sidearm.triple", pivot: "self", base: 20, measure: "size" },
    "branch:pointShot": { sheet: "sidearm.point", pivot: "self", base: 20, measure: "size" },
    "branch:kickAway": { sheet: "sidearm.kick", pivot: "anchor", base: 12, measure: "reach" },
    "branch:doubleTap": { sheet: "sidearm.double", pivot: "self", base: 20, measure: "size" },
  },
  hit: "sidearm.hit",
  hitHeavy: "sidearm.hitHeavy",
  bullets: Object.fromEntries(GUN_KEYS.map((name) => [name, bulletRow(name)])),
};

export const ATLAS = {
  key: "sidearm",
  fx: FX,
  sheets: [
    { key: "sidearm.dash", dirs: WIDE_DIRS, frames: 8, active: 3, size: 112, draw: dash },
    { key: "sidearm.butt", dirs: DIRS, frames: 8, active: 3, size: 96, draw: butt },
    { key: "sidearm.sweep", dirs: WIDE_DIRS, frames: 8, active: 4, size: 104, draw: muzzleSweep },
    { key: "sidearm.triple", dirs: DIRS, frames: 8, active: 3, size: 80, draw: tripleShot },
    { key: "sidearm.point", dirs: DIRS, frames: 7, active: 3, size: 88, draw: pointShot },
    { key: "sidearm.kick", dirs: DIRS, frames: 8, active: 3, size: 96, draw: kickAway },
    { key: "sidearm.double", dirs: DIRS, frames: 8, active: 3, size: 80, draw: doubleTap },
    { key: "sidearm.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => meleeHit(frame, f, false) },
    { key: "sidearm.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (frame, f) => meleeHit(frame, f, true) },
    ...GUN_KEYS.flatMap(gunSheets),
  ],
};
