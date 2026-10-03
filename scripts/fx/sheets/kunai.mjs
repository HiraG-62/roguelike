// クナイ（moveset "kunai"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、弾の作法は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/kunai.json・bullets.json）× 2 が目安
//
// 段 7-A では命中と、左で投げるクナイの弾の絵だけを持つ。右の逆手斬り・返し斬り・叩き込み・派生・ダッシュの振りの絵は
// 技の配線が固まってから段 7-B で足す（それまでは手続きの描画に落ちる。render/fxSprites.test.ts の UNDRAWN_MOTIONS）。
//
// 弾: 単発で重い黒鉄のクナイ。本体は描画側（render/thrownLook.ts）が投げた絵（thrownWeapon.kunai）を進む向きへ向けて
// 重ねるが、武器掛けの器の札には fly だけが出るので、fly にも木の葉の刃と輪の柄頭の本体を描く。
// 銃の火薬の閃光は出さず、手首の返しの細い弧と前へ抜ける空気の裂け目を撃つ瞬間の絵にする。着弾は壁に突き立って震える
import { lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾は 24 方向だと角のずれが目立つので 32 方向で描く */
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

/** 先へ細る 1 本の針: (x, y) から角 a へ長さ len、根元の半幅 w。芯が明るく先ほど暗い */
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

/** 円い芯（半径 r）。中心ほど明るい */
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

/** 前へ押し出す圧の弧（潰れた楕円の前側 ±spread だけ） */
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

/** 細い 1 本の弧線（中心 (cx, cy)、半径 r、角 a0 → a1）。a1 側が明るい。手首の返し・震え */
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
 * クナイの本体 1 本: 中心 (x, y)、角 a、全長 len。前 55% が木の葉の形の両刃（真ん中が膨らみ切っ先へ鋭く細る）、
 * その後ろが細い柄、尻に輪の柄頭（穴が抜ける）。白は刃の稜線の前寄りだけ。黒鉄なので刃の面は段 4〜5 の濃い墨
 */
function kunaiBody(frame, o) {
  const { x = 0, y = 0, a, len } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 41;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const blade = len * 0.55;
  const grip = len * 0.3;
  const ringR = len * 0.09 + 0.8;
  const wide = len * 0.13 + 0.6;
  const pad = len / 2 + ringR + 3;
  // 刃の根元を原点に取る: 刃は +along、柄と輪は −along
  const root = (len / 2) - blade;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s - root;
      const across = -dx * s + dy * c;
      if (along >= 0) {
        if (along > blade) return -1;
        const u = along / blade;
        // 木の葉: 根元の 3 割で広がり、そこから切っ先へ細る
        const half = (u < 0.3 ? 0.45 + (u / 0.3) * 0.55 : ((1 - u) / 0.7) ** 0.8) * wide + 0.3;
        if (Math.abs(across) > half) return -1;
        const q = Math.abs(across) / half;
        if (!survives(px, py, erosion, 1 - q, seed)) return -1;
        // 稜線（芯の 1 列）の前寄りだけ白い。面は濃い墨（黒鉄）
        if (Math.abs(across) < 0.6 && u > 0.2 && u < 0.85 && erosion < 0.35) return clamp01(0.95 * bright);
        return clamp01((0.78 - 0.18 * q) * bright);
      }
      const back = -along;
      // 輪の柄頭（中空）
      const rd = Math.hypot(back - grip - ringR, across);
      if (rd <= ringR) return rd > ringR - 1.3 ? clamp01(0.7 * bright) : -1;
      if (back > grip) return -1;
      if (Math.abs(across) > 1.2) return -1;
      if (!survives(px, py, erosion, 0.5, seed)) return -1;
      return clamp01(0.5 * bright);
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad } },
  );
}

// -----------------------------------------------------------------------------
// 命中（近接・投げたクナイ）: 刺し傷。heavy（叩き込み）は刺さったクナイを押し込む重い衝撃
// -----------------------------------------------------------------------------

/**
 * 命中: 原点 = 敵、+x = 刃の進む向き。細い刃が刺さった刺し傷（前へ長く後ろへ短い針 1 本と横の短い針）、
 * 進む向きに潰れた小さな輪、前へ飛ぶ細かな破片。heavy は針が長く、斜め前へ 2 本の閃きが開き、輪が大きい
 */
function pierceHit(frame, f, heavy) {
  const s = heavy ? 1.5 : 1;
  if (f <= 1) {
    const g = f === 0 ? 0.85 : 1;
    spike(frame, { x: -6 * s, a: 0, len: 22 * s * g, w: 2.4 * s, bright: 1 });
    spike(frame, { x: -6 * s, a: Math.PI, len: 6 * s * g, w: 2 * s, bright: 0.8 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 6 * s * g, w: 1.6 * s, bright: 0.75 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 6 * s * g, w: 1.6 * s, bright: 0.75 });
    if (heavy) {
      spike(frame, { x: 0, a: 35 * DEG, len: 14 * g, w: 1.8, bright: 0.9 });
      spike(frame, { x: 0, a: -35 * DEG, len: 14 * g, w: 1.8, bright: 0.9 });
    }
    flashCore(frame, -2, 0, 3 * s, 1);
    sparkle(frame, -2, 0, f === 0 ? (heavy ? 4 : 3) : 2);
  } else if (f === 2) {
    spike(frame, { x: 2, a: 0, len: 20 * s, w: 1.6 * s, bright: 0.7, erosion: 0.5, seed: 3711 });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: (heavy ? 8 : 5) + age * (heavy ? 5 : 3.5), width: heavy ? 2.6 : 1.8, squash: 0.55, erosion: Math.min(0.95, 0.2 + age * 0.3), bright: 0.72 - age * 0.12, seed: heavy ? 3712 : 3722 });
  }
  shards(frame, f - 1, heavy ? 14 : 8, heavy ? 3713 : 3723, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.25 ? 1.2 : 3.4);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 3.5 : 2.5);
    return { x: 2, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.3 ? 2 : 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 弾: クナイ（kunai）。radius 2、速さ ≈ 0.65 倍（重く遅い）→ 尾 ≈ 14 ドット
// -----------------------------------------------------------------------------

const FLY_FRAMES = 6;
/** 本体の全長（ドット。投げた絵 thrownWeapon.kunai の長さに合わせる） */
const BODY_LEN = 20;

/**
 * 飛ぶクナイ: 原点 = 弾の中心、+x = 進む向き。本体と、輪の柄頭の後ろへ抜ける芯の筋（切っ先の残像）、
 * 両脇を後ろへ流れる細い風の筋（フレームで長さが揺らぐ）、切っ先の前の小さな光（2 フレームおき）
 */
function kunaiFly(frame, f) {
  const t = (f / FLY_FRAMES) * TAU;
  const tail = -BODY_LEN / 2 - 2;
  streakLine(frame, { ax: tail - 14, ay: 0, bx: tail, by: 0, width: 1.2, bright: 0.6 });
  for (const side of [-1, 1]) {
    const len = 8 + 3 * Math.sin(t + (side > 0 ? 0 : Math.PI));
    const y = side * 4;
    streakLine(frame, { ax: tail - 2 - len, ay: y, bx: tail + 5, by: y * 0.75, bright: 0.38 });
  }
  kunaiBody(frame, { a: 0, len: BODY_LEN });
  if (f % 2 === 0) sparkle(frame, BODY_LEN / 2 + 1, 0, 1);
  if (f % 3 === 0) dot(frame, tail - 8 - hash1(f, 4012) * 6, (hash1(f, 4013) - 0.5) * 6, 3);
}

/** 投げの手元: 手首を返す細い弧が閉じ、前へ空気の裂け目が抜ける。火薬の閃光は無い */
function kunaiMuzzle(frame, f) {
  if (f <= 1) thinArc(frame, { cx: -9, r: 10, a0: -80 * DEG, a1: 8 * DEG, width: 1.4, bright: 0.8 - f * 0.25 });
  if (f <= 2) {
    const x0 = -2 + f * 6;
    lens(frame, { ax: x0, ay: 0, bx: x0 + 20 - f * 3, by: 0, T: 4.5 - f, bias: 0, erosion: f * 0.25, seed: 4111, bright: 0.85 - f * 0.12 });
  }
  if (f === 0) sparkle(frame, 2, 0, 2);
  if (f >= 1) frontArc(frame, { ox: 10 + f * 3, radius: 3 + f * 2, width: 1.4, squash: 0.45, erosion: Math.min(0.9, f * 0.2), bright: 0.55 - f * 0.08, seed: 4112 });
  shards(frame, f - 1, 4, 4113, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1;
    const sp = 2 + rnd(2) * 2;
    return { x: 8, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

/**
 * 着弾（壁で止まった）: 原点 = 止まった位置、+x = 進んでいた向き。切っ先から壁に突き立ち、
 * 輪の柄頭が左右へ細かく震える（フレームごとに ±角）。最初に硬い当たりの閃きと、後ろへ跳ねる鋼の火花
 */
function kunaiImpact(frame, f) {
  const N = 7;
  const quiver = [9, -7, 5, -3, 2, -1, 0][f] ?? 0;
  const fade = f / (N - 1);
  kunaiBody(frame, { x: -7, a: quiver * DEG, len: 18, bright: 1 - fade * 0.55, erosion: Math.max(0, fade - 0.5) * 1.6, seed: 4211 });
  if (f <= 1) {
    lens(frame, { ax: 2, ay: -7, bx: 2, by: 7, T: f === 0 ? 3 : 2, bias: 0, bright: 0.9 });
    sparkle(frame, 2, 0, f === 0 ? 3 : 2);
  }
  shards(frame, f, 7, 4212, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 2.4 + rnd(2) * 2.4;
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 1 && f <= 4) {
    const side = f % 2 === 0 ? 1 : -1;
    thinArc(frame, { cx: 2, r: 17, a0: Math.PI - side * 4 * DEG, a1: Math.PI + side * 20 * DEG, bright: 0.45 - f * 0.05 });
  }
}

/** 尽きた（dirs 1）: 勢いを失ったクナイが回りながら画面の下へ落ち、落ちた所で小さく光って消える */
function kunaiFizzle(frame, f) {
  const drop = Math.min(1, f / 4);
  const y = drop * drop * 12;
  if (f <= 4) kunaiBody(frame, { x: f * 0.8, y, a: -30 * DEG + f * 55 * DEG, len: 16, bright: 1 - f * 0.1, seed: 4411 });
  if (f === 4) sparkle(frame, 3, y + 1, 2);
  if (f >= 5) {
    const age = f - 5;
    for (let i = 0; i < 3; i++) dot(frame, 1 + i * 2 + age, y + 1 - (i === 1 ? 1 : 0), 4 - age - (i === 1 ? 0 : 1));
  }
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。振りの絵は段 7-B で足す（今は空）。
 * 弾は黒鉄の刃なので配色は steel（芯が濃墨）
 */
const FX = {
  moveset: "kunai",
  motions: {},
  hit: "kunai.hit",
  hitHeavy: "kunai.hitHeavy",
  bullets: {
    kunai: { fly: "kunai.kunaiFly", period: 0.18, base: 2, muzzle: "kunai.kunaiMuzzle", impact: "kunai.kunaiImpact", hit: "kunai.hit", fizzle: "kunai.kunaiFizzle", ramp: "steel" },
  },
};

export const ATLAS = {
  key: "kunai",
  fx: FX,
  sheets: [
    { key: "kunai.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => pierceHit(frame, f, false) },
    { key: "kunai.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => pierceHit(frame, f, true) },
    { key: "kunai.kunaiFly", dirs: SHOT_DIRS, frames: FLY_FRAMES, active: 0, size: 72, draw: kunaiFly },
    { key: "kunai.kunaiMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: kunaiMuzzle },
    { key: "kunai.kunaiImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: kunaiImpact },
    { key: "kunai.kunaiFizzle", dirs: 1, frames: 7, active: 0, size: 56, draw: kunaiFizzle },
  ],
};
