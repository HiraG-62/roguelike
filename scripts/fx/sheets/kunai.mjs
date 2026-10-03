// クナイ（moveset "kunai"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、弾の作法は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/kunai.json・bullets.json）× 2 が目安
//
// 振り（段 7-B）: 右の逆手斬り・返し斬りは体に近い小さく鋭い三日月（逆手の短い刃）、叩き込みは短く太い楔と切っ先の衝撃
// （刺さったクナイを打ち込む）、ダッシュは低く踏み込む細い突き。派生は弾を出すので縮めない: 影留めは足元へ投げて地に縫い止める輪、
// 離れ投げは後ろへ跳びながら前へ開く 2 本の投げ筋。
//
// 弾: 単発で重い黒鉄のクナイ。本体は描画側（render/thrownLook.ts）が投げた絵（thrownWeapon.kunai）を進む向きへ向けて
// 重ねるが、武器掛けの器の札には fly だけが出るので、fly にも木の葉の刃と輪の柄頭の本体を描く。
// 銃の火薬の閃光は出さず、手首の返しの細い弧と前へ抜ける空気の裂け目を撃つ瞬間の絵にする。着弾は壁に突き立って震える
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, arcSlash } from "../motifs.mjs";

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
// 振り（右の連撃・ダッシュ・派生）
// -----------------------------------------------------------------------------

/** 振りの進み（active の間 0..1）と、残りの崩れ（recover の間 0..1） */
function phase(f, A, N) {
  return { p: f < A ? easeSwing((f + 1) / A) : 1, k: f < A ? 0 : (f - A + 1) / (N - A + 1) };
}

/** 右 1 段: 逆手斬り（arc 120° reach 15）。逆手に握った短い刃の、体に近い小さく鋭い三日月 */
const CUT = { R: 32, T: 11, sweep: 120, tilt: -8, frames: 7, active: 3, tailLen: 0.7, overshoot: 0.05, erodeFrom: 0.05, lines: 2, shards: 5, shardSpeed: 3.5, glint: 3, seed: 4501, streak: 0.3 };
/** 右 2 段: 返し斬り（arc 140° reach 15）。逆手斬りより少し広く、振り切りで刃先が小さく返る */
const RETURN = { R: 33, T: 12, sweep: 140, tilt: 6, frames: 8, active: 3, tailLen: 0.8, overshoot: 0.06, erodeFrom: 0.05, lines: 3, shards: 6, shardSpeed: 4, glint: 3, seed: 4601, streak: 0.3 };

/** 三日月の先端の角（arcSlash の時間割と同じ） */
function headAngle(spec, f) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  if (f < spec.active) return from + half * 2 * easeSwing((f + 1) / spec.active);
  return from + half * 2 * (1 + spec.overshoot * ((f - spec.active + 1) / (spec.frames - spec.active)));
}

/**
 * 逆手の弧: 三日月の先端に、刃の進む向き（接線）へ尖る短い切っ先を添える（逆手の刃は手首の外へ短く出る）。
 * hook のときは振り切りで切っ先が内へ小さく返る（返し斬り）
 */
function reverseGrip(frame, f, spec, hook) {
  arcSlash(frame, f, spec);
  const head = headAngle(spec, f);
  const r = spec.R - spec.T * 0.3;
  const x = Math.cos(head) * r;
  const y = Math.sin(head) * r;
  if (f < spec.active) {
    spike(frame, { x, y, a: head + Math.PI / 2, len: 9, w: 1.8, bright: 0.95 });
    return;
  }
  if (!hook || f > spec.active + 1) return;
  // 返し: 切っ先が内側へ折れる短い弧（手首の返し）
  const age = f - spec.active;
  thinArc(frame, { cx: x - Math.cos(head) * 6, cy: y - Math.sin(head) * 6, r: 6, a0: head - 10 * DEG, a1: head + 150 * DEG, width: 1.4, bright: 0.85 - age * 0.25 });
  if (age === 0) sparkle(frame, x, y, 2);
}

/**
 * 右 3 段: 叩き込み（thrust reach 18・重い）。短く太い楔が前へ押し出し、切っ先で刺さったクナイを打ち込む:
 * 縦の閃線・前へ扇に開く 3 本の針・潰れた輪が 2 重に広がる
 */
function drive(frame, f) {
  const A = 3;
  const N = 8;
  const reach = 34;
  const { p, k } = phase(f, A, N);
  const tip = 8 + (reach - 8) * p + k * 2;
  lens(frame, { ax: 2 + k * 12, ay: 0, bx: tip, by: 0, T: 14 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 4701, bright: 1 - k * 0.2 });
  if (k < 0.6) spike(frame, { x: tip - 8, a: 0, len: 15, w: 2.8, bright: 1 });
  if (f >= A - 1 && f <= A) {
    const g = f === A - 1 ? 1 : 0.7;
    streakLine(frame, { ax: tip, ay: -14 * g, bx: tip, by: 14 * g, width: 1.8, bright: 0.95 });
    for (const d of [-28, 0, 28]) spike(frame, { x: tip - 1, a: d * DEG, len: (d === 0 ? 15 : 10) * g, w: 1.7, bright: 0.9 });
    sparkle(frame, tip, 0, f === A - 1 ? 4 : 3);
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    for (let i = 0; i < 2; i++) {
      const a2 = age - i * 2;
      if (a2 < 0) continue;
      ring(frame, { ox: tip - 2, radius: 4 + a2 * 4, width: 2.4 - i * 0.6, squash: 0.45, erosion: Math.min(0.92, a2 * 0.2), bright: 0.8 - a2 * 0.08 - i * 0.1, seed: 4702 + i });
    }
    shards(frame, age, 10, 4704, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.5;
      const sp = 3.5 + rnd(2) * 3.5;
      return { x: tip, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.8 };
    });
  }
}

/**
 * ダッシュ攻撃: 踏み込みの突き（thrust reach 22・踏み込み 18）。低く長い細い突きの光条と木の葉の切っ先、
 * 体の脇を後ろへ流れる速度線（踏み込みの速さ）、切っ先の前で潰れる小さな輪
 */
function dashThrust(frame, f) {
  const A = 3;
  const N = 7;
  const reach = 44;
  const { p, k } = phase(f, A, N);
  const tip = 12 + (reach - 12) * p + k * 3;
  const back = -6 + k * (tip - 4) * 0.8;
  lens(frame, { ax: back, ay: 0, bx: tip, by: 0, T: 8 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 4801, bright: 1 - k * 0.2 });
  if (k < 0.7) {
    streakLine(frame, { ax: back + (tip - back) * 0.3, ay: 0, bx: tip - 2, by: 0, width: 1.2, bright: 1 });
    spike(frame, { x: tip - 8, a: 0, len: 10, w: 2.2, bright: 1 });
  }
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (6 + Math.floor(i / 2) * 4 + hash1(i, 4802) * 2);
    // 踏み込み切ったら速度線は縮んで消える（残すと体の後ろに線だけ浮く）
    const len = (14 + 14 * hash1(i, 4803)) * (1 - k * 1.3);
    const x1 = 4 - hash1(i, 4804) * 10 - k * 10;
    if (len > 2) streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y * 0.85, bright: 0.5 * (1 - k) });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { ox: tip - 4 - age, radius: 3 + age * 2.6, width: 1.6, squash: 0.4, erosion: Math.min(0.9, age * 0.2), bright: 0.7 - age * 0.07, seed: 4805 });
  }
  if (f === A - 1) sparkle(frame, tip, 0, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 5, 4806, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.2;
      const sp = 3 + rnd(2) * 2.5;
      return { x: tip - 2, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
}

/** 影留めの刺さる所（足元の少し前。弾は lifeMul 0.1 ですぐ止まる） */
const PIN_X = 24;

/**
 * 派生: 影留め（足元へ投げる。刺さった敵を止める）。手首を返す細い弧から短い投げ筋が足元の前へ落ち、
 * 刺さったクナイの周りに影の輪が締まって、輪を 4 方の縫い目が留める（縫い止めた形）
 */
function shadowPin(frame, f) {
  const A = 2;
  const N = 9;
  if (f <= 1) thinArc(frame, { cx: -6, r: 9, a0: -70 * DEG, a1: 10 * DEG, width: 1.4, bright: 0.85 - f * 0.25 });
  if (f < A + 1) {
    const g = Math.min(1, (f + 1) / A);
    lens(frame, { ax: 4, ay: -3, bx: 4 + (PIN_X - 4) * g, by: 0, T: 4, bias: 0, erosion: f === A ? 0.5 : 0, seed: 4901, bright: 0.9 });
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  const k = age / (N - A);
  // 刺さったクナイ: 切っ先から地へ斜めに突き立つ（短く見える）
  kunaiBody(frame, { x: PIN_X - 4, y: -1, a: 15 * DEG, len: 13, bright: 1 - k * 0.4, erosion: Math.max(0, k - 0.55) * 1.8, seed: 4902 });
  if (age === 0) sparkle(frame, PIN_X, 0, 3);
  // 影の輪: 大きく出て刺さった所へ締まる
  const r = 18 - 10 * Math.min(1, age / 3);
  ring(frame, { ox: PIN_X, radius: r, width: 2.2, squash: 0.75, erosion: Math.min(0.92, Math.max(0, k - 0.3) * 1.4), bright: 0.72 - k * 0.25, seed: 4903 });
  // 縫い目: 輪を横切る短い刻み（4 方）
  if (age >= 1 && k < 0.85) {
    for (let i = 0; i < 4; i++) {
      const a = (45 + i * 90) * DEG;
      const cx = PIN_X + Math.cos(a) * r * 0.75;
      const cy = Math.sin(a) * r;
      const ta = a + Math.PI / 2;
      streakLine(frame, { ax: cx - Math.cos(ta) * 3, ay: cy - Math.sin(ta) * 3, bx: cx + Math.cos(ta) * 3, by: cy + Math.sin(ta) * 3, width: 1.3, bright: 0.75 * (1 - k) });
    }
  }
}

/**
 * 派生: 離れ投げ（後ろへ跳びながら 2 本投げる）。前へ ±5° に開く 2 本の投げ筋が伸びて離れ、
 * 体の後ろへ跳ぶ速度線と、蹴った足元の潰れた輪が後ろへずれる
 */
function farThrow(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = phase(f, A, N);
  if (f <= 1) thinArc(frame, { cx: -8, r: 11, a0: -85 * DEG, a1: 5 * DEG, width: 1.4, bright: 0.85 - f * 0.25 });
  for (const s of [-1, 1]) {
    const a = s * 6 * DEG;
    const r0 = 6 + k * 26;
    const r1 = 18 + 40 * p + k * 6;
    lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0 + s * 2, bx: Math.cos(a) * r1, by: Math.sin(a) * r1 + s * 2, T: 4 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 5001 + s, bright: 0.95 - k * 0.2 });
    if (f === A - 1) sparkle(frame, Math.cos(a) * r1, Math.sin(a) * r1 + s * 2, 2);
  }
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 6 + (hash1(i, 5003) - 0.5) * 3;
    const len = (12 + 12 * hash1(i, 5004)) * (1 - k * 1.3);
    const x0 = -8 - hash1(i, 5005) * 6 - k * 10;
    if (len > 2) streakLine(frame, { ax: x0, ay: y, bx: x0 - len, by: y * 1.1, bright: 0.5 * (1 - k) });
  }
  ring(frame, { ox: -6 - f * 2.5, radius: 4 + f * 2.4, width: 1.6, squash: 0.45, erosion: Math.min(0.92, f * 0.14), bright: 0.6 - f * 0.05, seed: 5006 });
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心（振る腕の肩）。
 * 派生は弾を出すので絵は縮めない（fit.mjs の firesShots）。弾は黒鉄の刃なので配色は steel（芯が濃墨）
 */
const FX = {
  moveset: "kunai",
  motions: {
    dash: { sheet: "kunai.dash", pivot: "self", base: 22, measure: "reach" },
    "r:kunaiCut": { sheet: "kunai.cut", pivot: "self", base: 15, measure: "reach" },
    "r:kunaiReturn": { sheet: "kunai.return", pivot: "self", base: 15, measure: "reach" },
    "r:kunaiDrive": { sheet: "kunai.drive", pivot: "self", base: 18, measure: "reach" },
    "branch:shadowPin": { sheet: "kunai.shadowPin", pivot: "self", base: 20, measure: "size" },
    "branch:farThrow": { sheet: "kunai.farThrow", pivot: "self", base: 20, measure: "size" },
  },
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
    { key: "kunai.cut", dirs: DIRS, frames: CUT.frames, active: CUT.active, size: 96, draw: (frame, f) => reverseGrip(frame, f, CUT, false) },
    { key: "kunai.return", dirs: DIRS, frames: RETURN.frames, active: RETURN.active, size: 96, draw: (frame, f) => reverseGrip(frame, f, RETURN, true) },
    { key: "kunai.drive", dirs: DIRS, frames: 8, active: 3, size: 112, draw: drive },
    { key: "kunai.dash", dirs: DIRS, frames: 7, active: 3, size: 128, draw: dashThrust },
    { key: "kunai.shadowPin", dirs: DIRS, frames: 9, active: 2, size: 96, draw: shadowPin },
    { key: "kunai.farThrow", dirs: DIRS, frames: 8, active: 3, size: 144, draw: farThrow },
    { key: "kunai.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => pierceHit(frame, f, false) },
    { key: "kunai.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => pierceHit(frame, f, true) },
    { key: "kunai.kunaiFly", dirs: SHOT_DIRS, frames: FLY_FRAMES, active: 0, size: 72, draw: kunaiFly },
    { key: "kunai.kunaiMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: kunaiMuzzle },
    { key: "kunai.kunaiImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: kunaiImpact },
    { key: "kunai.kunaiFizzle", dirs: 1, frames: 7, active: 0, size: 56, draw: kunaiFizzle },
  ],
};
