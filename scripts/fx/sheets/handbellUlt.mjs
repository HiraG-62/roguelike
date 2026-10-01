// 手鈴（moveset "handbell"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は handbell.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/handbell.json × 2 が目安
//
// 手鈴の絵の言葉は音の輪・房・光の粒。奥義はそれを大きく重ねる:
//   鳴神 = 鈴の音の輪が広がる中へ、7 本の雷が上から落ちる（地面に焦げた輪）。属性は雷なので実行時は雷の配色
//   招魂 = 音の輪が内へ縮み、魂の炎（尾を引く炎）が渦を巻いて集まる。集められた敵ごとに引き寄せの綱、最後に魂が弾ける
//   鎮魂 = 頭上に鈴が浮かんで揺れ、房が垂れる。持続中は静かな輪が脈打ち、敵を打つたびに音の輪が広がる（纏い）
// 白（段 7）は雷の芯・閃き・鈴の縁だけに使う
import { arcBounds, arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 足元の高さ（キャラは絵で 48 ドット。原点はキャラの中心） */
const FEET_Y = 18;
/** 頭上（浮かぶ鈴の高さ） */
const HEAD_Y = -36;

// -----------------------------------------------------------------------------
// 共通の部品（手鈴だけで使う）
// -----------------------------------------------------------------------------

/** 振りの進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 折れ線を太さつきで塗る（wand.mjs の stroke と同じ考え）。width / bright は始点からの割合 t（0..1）の関数でも数でもよい */
function stroke(frame, pts, o) {
  if (pts.length < 2) return;
  const lens2 = [0];
  for (let i = 1; i < pts.length; i++) lens2.push((lens2[i - 1] ?? 0) + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens2[lens2.length - 1] || 1;
  const widthAt = typeof o.width === "function" ? o.width : () => o.width;
  const brightAt = typeof o.bright === "function" ? o.bright : () => o.bright ?? 0.7;
  const maxW = o.maxWidth ?? (typeof o.width === "number" ? o.width : 6);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  paint(
    frame,
    (x, y) => {
      let best = Infinity;
      let bt = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const s = segment(x, y, a.x, a.y, b.x, b.y);
        if (s.d < best) {
          best = s.d;
          bt = ((lens2[i - 1] ?? 0) + s.t * ((lens2[i] ?? 0) - (lens2[i - 1] ?? 0))) / total;
        }
      }
      const w = widthAt(bt) / 2;
      if (w < 0.35 || best > w) return -1;
      return clamp01(brightAt(bt) * (1 - 0.5 * (best / w)));
    },
    { bounds: { x0: Math.min(...xs) - maxW - 2, y0: Math.min(...ys) - maxW - 2, x1: Math.max(...xs) + maxW + 2, y1: Math.max(...ys) + maxW + 2 }, samples: 3, dither: 0.04 },
  );
}

/**
 * 音の括弧 1 本: (ox, oy) を中心に、向き dir へ開く弧（「)」の形）。両端が細くなる。
 * 鈴の口から前へ出る音の波
 */
function soundArc(frame, o) {
  const { radius, dir } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = o.span ?? 0.7;
  const width = o.width ?? 1.8;
  const bright = o.bright ?? 0.7;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const da = Math.abs(wrapAngle(Math.atan2(dy, dx) - dir));
      if (da > span) return -1;
      const taper = Math.pow(Math.cos((da / span) * (Math.PI / 2)), 0.6);
      if (taper * width < d * 2) return -1;
      return clamp01(bright * (0.5 + 0.5 * taper));
    },
    { bounds: arcBounds(ox, oy, Math.max(0, radius - width), radius + width, dir - span, dir + span), dither: 0.02 },
  );
}

/** 点線の輪（音の輪）: 弧の切れ目で音の粒感を出す。phase で回る */
function dashRing(frame, o) {
  const { radius, dashes } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const fill = o.fill ?? 0.6;
  const step = TAU / dashes;
  for (let i = 0; i < dashes; i++) {
    const a = (o.phase ?? 0) + i * step;
    arcLine(frame, { ox, oy, radius, from: a, to: a + step * fill, width: o.width ?? 1.6, bright: o.bright ?? 0.6 });
  }
}

/** 房: 始点 (x, y) から向き ang へしなって伸びる紐と、先の房飾り。phase でしなりの位相 */
function tassel(frame, o) {
  const { x, y, ang, len } = o;
  const sway = o.sway ?? 4;
  const phase = o.phase ?? 0;
  const bright = o.bright ?? 0.75;
  const pts = [];
  for (let j = 0; j <= 8; j++) {
    const t = j / 8;
    const side = Math.sin(t * 3.2 + phase) * sway * t;
    pts.push({ x: x + Math.cos(ang) * len * t - Math.sin(ang) * side, y: y + Math.sin(ang) * len * t + Math.cos(ang) * side });
  }
  stroke(frame, pts, { width: (t) => 1.7 - 0.4 * t, maxWidth: 2, bright: (t) => bright * (0.55 + 0.45 * (1 - t)) });
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!end || !prev) return;
  const base = Math.atan2(end.y - prev.y, end.x - prev.x);
  // 房飾り: 先で 5 本に開く
  for (let s = -2; s <= 2; s++) {
    const a = base + s * 0.32 + Math.sin(phase * 1.3 + s) * 0.15;
    const l = 5.5 - Math.abs(s) * 0.7;
    streakLine(frame, { ax: end.x, ay: end.y, bx: end.x + Math.cos(a) * l, by: end.y + Math.sin(a) * l, width: 1.2, bright: bright * 0.85 });
  }
  dot(frame, x, y, 5);
  dot(frame, x + 1, y, 4);
}

/** 鈴の口を上から見た形（同心の輪と舌）。r は外縁の半径 */
function bellMouth(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.85;
  const erosion = o.erosion ?? 0;
  ring(frame, { ox: x, oy: y, radius: r, width: 2.4, erosion, bright, seed: o.seed ?? 11 });
  ring(frame, { ox: x, oy: y, radius: r * 0.62, width: 1.4, erosion, bright: bright * 0.7, seed: (o.seed ?? 11) + 1 });
  if (erosion < 0.5) {
    dot(frame, x, y, 6);
    dot(frame, x + 1, y, 5);
    dot(frame, x, y + 1, 5);
  }
}

/** 全周へ散る光の粒 */
function motes(frame, age, o) {
  shards(frame, age, o.n, o.seed, (i, rnd) => {
    const a = (o.center ?? 0) + (rnd(1) - 0.5) * (o.cone ?? TAU);
    const sp = o.speed * (0.5 + rnd(2));
    const r0 = (o.r0 ?? 0) * (0.5 + 0.5 * rnd(6));
    return { x: (o.x ?? 0) + Math.cos(a) * r0, y: (o.y ?? 0) + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life ?? 3) + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: o.drag ?? 0.82 };
  });
}

/** 花弁（菱形の細い葉）1 枚: 中心から向き a へ r0 → r1 */
function petal(frame, a, r0, r1, w, o = {}) {
  lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, T: w, bias: 0, bright: o.bright ?? 0.85, erosion: o.erosion ?? 0, seed: o.seed ?? 5 });
}


// -----------------------------------------------------------------------------
// 追加の部品（奥義だけで使う）
// -----------------------------------------------------------------------------

/** 横から見た鈴（頭上に浮かぶ鈴）。(x, y) は吊り手の位置、s は鈴の高さ、tilt は吊り手を軸にした揺れ */
function bellSide(frame, x, y, s, tilt = 0, o = {}) {
  const bright = o.bright ?? 0.9;
  const cs = Math.cos(tilt);
  const sn = Math.sin(tilt);
  const half = (t) => s * 0.22 + s * 0.4 * Math.pow(t, 1.6);
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      // 吊り手からの下向きを +t に
      const u = dx * cs + dy * sn;
      const t = (-dx * sn + dy * cs) / s;
      const v = u;
      if (t < 0.05 || t > 1) return -1;
      const w = half(t);
      if (Math.abs(v) > w) return -1;
      const q = Math.abs(v) / w;
      // 縁（口の白い帯）と、左が明るい面
      if (t > 0.9) return clamp01(bright);
      return clamp01(bright * (0.5 + 0.3 * (1 - q) - 0.12 * (v / w)));
    },
    { bounds: { x0: x - s, y0: y - 2, x1: x + s, y1: y + s * 1.4 }, dither: 0.03 },
  );
  // 舌と吊り手
  const bx = x - sn * s * 1.08;
  const by = y + cs * s * 1.08;
  dot(frame, bx, by, 6);
  dot(frame, bx + 1, by, 5);
  dot(frame, x, y, 6);
}

/** 雷: 上から落ちる折れ線。芯は白、周りは段 5〜6。forks で枝を出す */
function bolt(frame, x0, y0, x1, y1, o) {
  const seed = o.seed ?? 1;
  const n = 6;
  const amp = o.amp ?? 7;
  const pts = [];
  for (let j = 0; j <= n; j++) {
    const t = j / n;
    const off = j === 0 || j === n ? 0 : (hash1(j, seed) - 0.5) * 2 * amp;
    pts.push({ x: x0 + (x1 - x0) * t + off, y: y0 + (y1 - y0) * t });
  }
  const bright = o.bright ?? 1;
  stroke(frame, pts, { width: (t) => (o.width ?? 3.4) * (1 - 0.3 * t), maxWidth: o.width ?? 4, bright: 0.7 * bright });
  stroke(frame, pts, { width: Math.max(1.4, (o.width ?? 3.4) * 0.35), bright, samples: 2 });
  for (let i = 0; i < (o.forks ?? 0); i++) {
    const j = 2 + i * 2;
    const p = pts[j];
    if (!p) continue;
    const side = i % 2 ? 1 : -1;
    stroke(frame, [p, { x: p.x + side * 9, y: p.y + 8 }, { x: p.x + side * 14, y: p.y + 18 }], { width: 1.5, bright: 0.65 * bright, samples: 2 });
  }
}

/** 魂の炎: (x, y) の頭から向き ang の反対へ尾を引く。sway で尾が揺れ、w が頭の半径 */
function wisp(frame, o) {
  const { x, y, ang, len, w } = o;
  const bright = o.bright ?? 0.8;
  const sway = o.sway ?? 2;
  const phase = o.phase ?? 0;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      // u = 尾の向き（進行の後ろ）
      const u = -(dx * cs + dy * sn);
      const v = -dx * sn + dy * cs;
      if (u < -w) return -1;
      if (u < 0) {
        const d = Math.hypot(u, v);
        if (d > w) return -1;
        return clamp01(bright * (1 - 0.4 * (d / w)));
      }
      if (u > len) return -1;
      const t = u / len;
      const half = w * Math.pow(1 - t, 1.15);
      const c = Math.sin(t * 5 + phase) * sway * t;
      if (half < 0.5 || Math.abs(v - c) > half) return -1;
      return clamp01(bright * (1 - 0.6 * t) * (1 - 0.3 * (Math.abs(v - c) / half)));
    },
    { bounds: { x0: x - len - w - sway - 2, y0: y - len - w - sway - 2, x1: x + len + w + sway + 2, y1: y + len + w + sway + 2 } },
  );
}

// -----------------------------------------------------------------------------
// 鳴神（nova 半径 72・雷）
// -----------------------------------------------------------------------------

/** 雷の落ちる範囲の半径（半径 72 論理 px × 2） */
const THUNDER_R = 144;
const THUNDER_N = 12;
const THUNDER_A = 5;
/** 雷の落ちる高さ（絵のドット） */
const BOLT_H = 100;
/** 7 本の落雷の位置（角・半径の割合）と落ちるフレーム */
const STRIKES = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * TAU + hash1(i, 4001) * 0.5, r: i === 0 ? 0.08 : 0.42 + 0.5 * hash1(i, 4002), at: 1 + ((i * 2) % 5) }));

/** 鳴神の発動: 鈴が大きく鳴り、音の輪が広がる。体の周りに小さな稲光が走る */
function thunderCast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  bellSide(frame, 0, HEAD_Y + 6, 22, Math.sin(f * 1.5) * 0.35 * (1 - k), { bright: 0.95 - k * 0.4 });
  for (let i = 0; i < 3; i++) {
    const age = f - i * 1.3;
    if (age < 0) continue;
    ring(frame, { oy: 0, radius: 10 + age * 9, width: 2.6 - i * 0.4, erosion: Math.min(0.92, age * 0.1), bright: 0.9 - i * 0.15 - k * 0.3, seed: 4010 + i });
  }
  if (f >= 2 && f <= 6) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + f * 0.7;
      const p = { x: Math.cos(a) * 16, y: Math.sin(a) * 16 };
      const q = { x: Math.cos(a + 0.3) * 30, y: Math.sin(a + 0.3) * 30 };
      const m = { x: (p.x + q.x) / 2 + (hash1(i + f, 4013) - 0.5) * 8, y: (p.y + q.y) / 2 + (hash1(i + f, 4014) - 0.5) * 8 };
      stroke(frame, [p, m, q], { width: 1.5, bright: 0.85, samples: 2 });
    }
  }
  if (f === 1) sparkle(frame, 0, HEAD_Y + 26, 3);
  if (f >= 2) shards(frame, f - 2, 12, 4015, (i, rnd) => ({ x: (rnd(1) - 0.5) * 20, y: (rnd(2) - 0.5) * 20, vx: (rnd(3) - 0.5) * 8, vy: (rnd(4) - 0.5) * 8, life: 3, size: 1 }));
}

/** 鳴神の落雷（行為）: 音の輪が範囲いっぱいへ広がる間に、7 本の雷が時間差で落ちる */
function thunderStrike(frame, f) {
  const A = THUNDER_A;
  const { k } = timing(f, A, THUNDER_N);
  // 範囲の輪: 3 重
  for (let i = 0; i < 3; i++) {
    const age = f - i * 1.2;
    if (age < 0) continue;
    const rad = 14 + age * 20;
    if (rad > THUNDER_R + 6) continue;
    ring(frame, { radius: rad, width: 3 - i * 0.5, erosion: Math.min(0.92, age * 0.06 + k * 0.5), bright: (0.95 - i * 0.15) * (1 - k * 0.5), seed: 4020 + i });
  }
  for (const [i, s] of STRIKES.entries()) {
    const age = f - s.at;
    const px = Math.cos(s.a) * THUNDER_R * s.r;
    const py = Math.sin(s.a) * THUNDER_R * s.r;
    if (age >= 0 && age <= 2) {
      // 落雷: 1 枚目は太く白い、2 枚目は枝分かれして細くなる
      bolt(frame, px + (hash1(i, 4030) - 0.5) * 24, py - BOLT_H, px, py, { seed: 4031 + i * 5 + age, width: [9, 6, 4][age] ?? 4, bright: [1, 0.85, 0.6][age] ?? 0.6, forks: age === 0 ? 2 : 1, amp: 9 });
      if (age === 0) sparkle(frame, px, py, 4);
    }
    if (age >= 0 && age <= 5) {
      // 着弾の輪と火花
      ring(frame, { ox: px, oy: py, radius: 5 + age * 6, width: 2.2 - age * 0.25, squash: 1.5, erosion: Math.min(0.92, age * 0.17), bright: 0.9 - age * 0.12, seed: 4040 + i });
      shards(frame, age, 8, 4050 + i, (j, rnd) => {
        const a = rnd(1) * TAU;
        return { x: px, y: py, vx: Math.cos(a) * (2 + rnd(2) * 3), vy: Math.sin(a) * (1.4 + rnd(2) * 2) - 1, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
      });
    }
  }
}

/** 鳴神の地面: 範囲の縁の輪と、落雷点の焦げ跡（落ちたあとに残り、薄れる） */
function thunderGround(frame, f) {
  const A = THUNDER_A;
  const k = f < A ? 0 : (f - A + 1) / (THUNDER_N - A + 1);
  const grow = Math.min(1, (f + 1) / 4);
  ring(frame, { radius: (THUNDER_R - 3) * (0.5 + 0.5 * grow), width: 2, erosion: k * 0.9, bright: 0.4 * (1 - k * 0.4), seed: 4061 });
  for (const [i, s] of STRIKES.entries()) {
    if (f < s.at) continue;
    const px = Math.cos(s.a) * THUNDER_R * s.r;
    const py = Math.sin(s.a) * THUNDER_R * s.r;
    ring(frame, { ox: px, oy: py, radius: 9, width: 2.6, squash: 1.5, erosion: Math.min(0.95, k), bright: 0.32 * (1 - k * 0.5), seed: 4062 + i });
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * TAU + i;
      streakLine(frame, { ax: px + Math.cos(a) * 4, ay: py + Math.sin(a) * 3, bx: px + Math.cos(a) * (12 + hash1(j + i, 4063) * 8), by: py + Math.sin(a) * (9 + hash1(j, 4064) * 5), width: 1.2, bright: 0.4 * (1 - k) });
    }
  }
}

// -----------------------------------------------------------------------------
// 招魂（pull 半径 90・nova 半径 38）
// -----------------------------------------------------------------------------

/** 引き寄せの半径（半径 90 論理 px × 2）と、集まる先の半径 */
const CALL_R = 180;
const CALL_N = 10;
const CALL_A = 6;
const BURST_R = 76;

/** 招魂の発動: 鈴が鳴り、音の輪が内へ縮んで魂の炎を呼ぶ */
function spiritCast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  bellSide(frame, 0, HEAD_Y + 6, 22, Math.sin(f * 1.6) * 0.4 * (1 - k), { bright: 0.95 - k * 0.4 });
  for (let i = 0; i < 3; i++) {
    const age = f - i * 1.5;
    if (age < 0) continue;
    const rad = 56 - age * 6.5;
    if (rad < 6) continue;
    ring(frame, { radius: rad, width: 2.4 - i * 0.4, erosion: Math.min(0.9, age * 0.08), bright: 0.5 + 0.35 * (age / 6) - i * 0.1, seed: 4110 + i });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + f * 0.5 + 0.4;
    const r = 52 - f * 4.5;
    if (r > 8) wisp(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, ang: a + Math.PI + 0.8, len: 14, w: 3, sway: 2, phase: f + i, bright: 0.85 });
  }
  if (f === 6) sparkle(frame, 0, 0, 3);
}

/** 招魂の引き寄せ（行為 0）: 音の輪が範囲から内へ縮み、魂の炎が渦を巻いて自分へ集まる */
function spiritPull(frame, f) {
  const A = CALL_A;
  const { p, k } = timing(f, A, CALL_N);
  for (let i = 0; i < 3; i++) {
    const age = f - i * 1.4;
    if (age < 0) continue;
    const rad = CALL_R - age * 24;
    if (rad < 16) continue;
    ring(frame, { radius: rad, width: 3 - i * 0.5, erosion: Math.min(0.9, age * 0.05 + k * 0.5), bright: (0.5 + 0.4 * (age / 6)) * (1 - k * 0.6), seed: 4120 + i });
  }
  // 魂の炎: 対数螺旋で内へ。頭は内向きに進み、尾は外側に残る
  for (let i = 0; i < 12; i++) {
    const t0 = hash1(i, 4130);
    const prog = clamp01(p * (0.75 + 0.35 * hash1(i, 4131)) + (f >= A ? 0.05 * (f - A) : 0));
    const r = (CALL_R - 24) * (1 - prog) * (0.6 + 0.4 * t0) + 10;
    const a = (i / 12) * TAU + prog * 2.4 + t0;
    const dir = a + Math.PI / 2 * 0.55 + Math.PI;
    if (k > 0.85) continue;
    wisp(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, ang: dir, len: 22 * (1 - k * 0.5), w: 3.6, sway: 3, phase: f * 0.8 + i, bright: 0.85 * (1 - k * 0.6) });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { radius: 12 + age * 6, width: 2.4, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.1, seed: 4140 });
    shards(frame, age, 18, 4141, (i, rnd) => {
      const a = rnd(1) * TAU;
      return { x: Math.cos(a) * 30, y: Math.sin(a) * 30, vx: -Math.cos(a) * (1.5 + rnd(2) * 2), vy: -Math.sin(a) * (1.5 + rnd(2) * 2), life: 4, size: rnd(3) > 0.5 ? 2 : 1 };
    });
  }
}

/** 招魂の綱（掴んだ敵ごと。敵の位置に置き、向きは自分から敵への向き）: 敵に輪が締まり、自分へ引く筋と魂が走る */
function spiritTarget(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  ring(frame, { radius: 20 - f * 1.8, width: 2.4 - k, erosion: Math.min(0.9, k * 0.9), bright: 0.9 - k * 0.4, seed: 4150 });
  // 自分へ引く綱（-x の向きへ伸びる 3 本の波打つ筋）
  if (k < 0.9) {
    for (let i = 0; i < 3; i++) {
      const y0 = (i - 1) * 5;
      const pts = [];
      for (let j = 0; j <= 6; j++) pts.push({ x: -8 - j * 7 - f * 4, y: y0 + Math.sin(j * 1.1 + f * 1.3 + i) * 3 * (j / 6) });
      stroke(frame, pts, { width: 1.4, bright: (0.75 - i * 0.1) * (1 - k * 0.7), samples: 2 });
    }
  }
  wisp(frame, { x: -4 - f * 3, y: 0, ang: Math.PI, len: 16, w: 3.6, sway: 2, phase: f, bright: 0.9 * (1 - k * 0.5) });
  if (f <= 1) sparkle(frame, 0, 0, 3);
}

/** 招魂の弾け（行為 1・nova 半径 38）: 集まった魂が一斉に外へ炎を引いて飛び、輪が広がる */
function spiritBurst(frame, f) {
  const N = 10;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const R = BURST_R;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.3;
    const r = 8 + (R - 14) * (f < A ? p : 1) + k * 8;
    wisp(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, ang: a, len: 26 * (1 - k * 0.5), w: 4.4 * (1 - k * 0.4), sway: 3, phase: f * 0.9 + i, bright: 0.9 * (1 - k * 0.7) });
  }
  ring(frame, { radius: 12 + (R - 8) * (f < A ? p : 1), width: 3.2 - k * 1.4, erosion: Math.min(0.92, k * 0.95), bright: 0.9 - k * 0.4, seed: 4160 });
  if (f === 1) sparkle(frame, 0, 0, 4);
  if (f === 2) for (let i = 0; i < 4; i++) sparkle(frame, Math.cos((i / 4) * TAU + 0.3) * 30, Math.sin((i / 4) * TAU + 0.3) * 30, 2);
  if (f >= 1) motes(frame, f - 1, { n: 22, seed: 4161, speed: 5, r0: 10, life: 5 });
}

// -----------------------------------------------------------------------------
// 鎮魂（持続・aura 半径 44）
// -----------------------------------------------------------------------------

/** 鎮魂の発動: 鈴が頭上へ現れて 1 度鳴り、静かな輪が足元から広がる。房が垂れる */
function requiemCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const rise = Math.min(1, (f + 1) / 3);
  bellSide(frame, 0, HEAD_Y + (1 - rise) * 16, 24 * (0.5 + 0.5 * rise), Math.sin(f * 1.4) * 0.3 * (1 - k * 0.6), { bright: 0.5 + 0.45 * rise });
  tassel(frame, { x: 0, y: HEAD_Y + 24 * rise + 2, ang: Math.PI / 2, len: 10 * rise, sway: 3, phase: f * 1.2, bright: 0.75 * rise });
  for (let i = 0; i < 3; i++) {
    const age = f - 2 - i * 1.6;
    if (age < 0) continue;
    ring(frame, { oy: FEET_Y, radius: 8 + age * 8, width: 2.4 - i * 0.4, squash: 2.2, erosion: Math.min(0.92, age * 0.1), bright: 0.85 - i * 0.12 - k * 0.2, seed: 4210 + i });
  }
  if (f === 3) sparkle(frame, 0, HEAD_Y + 20, 3);
  if (f >= 3) shards(frame, f - 3, 14, 4215, (i, rnd) => ({ x: (rnd(1) - 0.5) * 60, y: FEET_Y, vx: 0, vy: -(2 + rnd(2) * 3), life: 5, size: 1, drag: 0.92 }));
}

/** 鎮魂の纏いの脈（aura。半径 44 の輪が敵を打つたびに 1 回）: 音の輪が広がり、点線の輪が回る */
function requiemAura(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  const R = 88;
  ring(frame, { radius: 24 + (R - 24) * Math.min(1, (f + 1) / 4), width: 3 - k * 1.4, erosion: Math.min(0.92, k * 0.95), bright: 0.9 - k * 0.4, seed: 4220 });
  if (f >= 1) dashRing(frame, { radius: (R - 6) * Math.min(1, (f + 1) / 4), dashes: 16, fill: 0.5, phase: f * 0.3, width: 1.8, bright: 0.65 * (1 - k * 0.8) });
  if (f <= 1) sparkle(frame, 0, 0, 3);
  shards(frame, f, 16, 4221, (i, rnd) => {
    const a = rnd(1) * TAU;
    return { x: Math.cos(a) * 30, y: Math.sin(a) * 30, vx: Math.cos(a) * (2 + rnd(2) * 3), vy: Math.sin(a) * (2 + rnd(2) * 3), life: 4, size: 1 };
  });
}

/** 鎮魂の纏いの 1 巡のフレーム数 */
const REQ_N = 12;

/** 鎮魂の纏い（持続中ずっと。位相で 1 巡）: 頭上の鈴が揺れ、房が垂れ、澄んだ光の粒が立ちのぼる */
function requiemSustain(frame, f) {
  const cycle = f / REQ_N;
  const ph = cycle * TAU;
  const tilt = Math.sin(ph) * 0.28;
  bellSide(frame, 0, HEAD_Y, 22, tilt, { bright: 0.9 });
  // 房（鈴の舌の下）: 鈴の揺れに遅れてしなる
  tassel(frame, { x: -Math.sin(tilt) * 24, y: HEAD_Y + Math.cos(tilt) * 24 + 2, ang: Math.PI / 2 - tilt * 0.6, len: 12, sway: 3.5, phase: ph - 0.9, bright: 0.8 });
  // 鳴るたびに小さな輪が鈴の口から（前半と後半で 1 回ずつ）
  for (const off of [0, 0.5]) {
    const t = (cycle + off) % 1;
    if (t > 0.5) continue;
    ring(frame, { ox: -Math.sin(tilt) * 22, oy: HEAD_Y + 22, radius: 4 + t * 26, width: 1.6, squash: 1.6, erosion: t * 1.6, bright: 0.65 * (1 - t * 1.8), seed: 4230 });
  }
  // 立ちのぼる粒
  for (let i = 0; i < 9; i++) {
    const t = (cycle + hash1(i, 4231)) % 1;
    const x = (hash1(i, 4232) - 0.5) * 66 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y - t * 64;
    if (Math.abs(x) < 9 && y > HEAD_Y - 6 && y < FEET_Y - 4) continue;
    dot(frame, x, y, Math.min(5, Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)))));
  }
  if (f === 2) sparkle(frame, 12, HEAD_Y - 6, 2);
  if (f === 8) sparkle(frame, -12, HEAD_Y - 4, 2);
}

/** 鎮魂の足元（地面。楕円）: 脈打つ 2 重の輪と、ゆっくり回る 8 つの刻み */
function requiemGround(frame, f) {
  const cycle = f / REQ_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 15 + pulse, width: 1.8, squash: 2.2, bright: 0.38 + 0.15 * pulse, seed: 4241 });
  ring(frame, { oy: FEET_Y, radius: 9, width: 1.2, squash: 2.2, bright: 0.3 + 0.1 * pulse, seed: 4242 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8 + cycle / 8) * TAU;
    const cx = Math.cos(a) * 33 * 1.12;
    const cy = FEET_Y + Math.sin(a) * 15;
    streakLine(frame, { ax: cx * 0.9, ay: FEET_Y + (cy - FEET_Y) * 0.9, bx: cx * 1.08, by: FEET_Y + (cy - FEET_Y) * 1.08, width: 1.4, bright: 0.3 + 0.12 * pulse });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 鳴神の acts[0] は周囲攻撃（半径 72）、招魂の acts[0] は引き寄せの範囲（半径 90）・acts[1] は周囲攻撃（半径 38）、
 * 鎮魂の aura は周りの打ちの半径 44
 */
const FX = {
  moveset: "handbell",
  ultimates: {
    "handbell.thunderToll": {
      ramp: "lightning",
      cast: { sheet: "handbellUlt.thunderCast", life: 0.5 },
      acts: [{ sheet: "handbellUlt.thunderStrike", life: 0.75, base: THUNDER_R / 2, pivot: "pos", ground: "handbellUlt.thunderGround" }],
    },
    "handbell.spiritCall": {
      ramp: "light",
      cast: { sheet: "handbellUlt.spiritCast", life: 0.45 },
      acts: [
        { sheet: "handbellUlt.spiritPull", life: 0.6, base: CALL_R / 2, pivot: "pos" },
        { sheet: "handbellUlt.spiritBurst", life: 0.55, base: BURST_R / 2, pivot: "pos" },
      ],
      target: { sheet: "handbellUlt.spiritTarget", life: 0.4, pivot: "to" },
    },
    "handbell.requiem": {
      ramp: "light",
      cast: { sheet: "handbellUlt.requiemCast", life: 0.6 },
      aura: { sheet: "handbellUlt.requiemAura", life: 0.4, base: 44 },
      sustain: { sheet: "handbellUlt.requiem", period: 1.2, ground: "handbellUlt.requiemGround" },
    },
  },
};

export const ATLAS = {
  key: "handbellUlt",
  fx: FX,
  sheets: [
    { key: "handbellUlt.thunderCast", dirs: 1, frames: 9, active: 0, size: 200, draw: thunderCast },
    { key: "handbellUlt.thunderStrike", dirs: 1, frames: THUNDER_N, active: THUNDER_A, size: 2 * (THUNDER_R + BOLT_H + 40), draw: thunderStrike },
    { key: "handbellUlt.thunderGround", dirs: 1, frames: THUNDER_N, active: THUNDER_A, size: 2 * (THUNDER_R + 30), draw: thunderGround },
    { key: "handbellUlt.spiritCast", dirs: 1, frames: 9, active: 0, size: 200, draw: spiritCast },
    { key: "handbellUlt.spiritPull", dirs: 1, frames: CALL_N, active: CALL_A, size: 2 * (CALL_R + 30), draw: spiritPull },
    { key: "handbellUlt.spiritTarget", dirs: DIRS, frames: 8, active: 0, size: 136, draw: spiritTarget },
    { key: "handbellUlt.spiritBurst", dirs: 1, frames: 10, active: 4, size: 2 * (BURST_R + 44), draw: spiritBurst },
    { key: "handbellUlt.requiemCast", dirs: 1, frames: 10, active: 0, size: 200, draw: requiemCast },
    { key: "handbellUlt.requiemAura", dirs: 1, frames: 7, active: 0, size: 2 * (88 + 16), draw: requiemAura },
    { key: "handbellUlt.requiem", dirs: 1, frames: REQ_N, active: 0, size: 144, draw: requiemSustain },
    { key: "handbellUlt.requiemGround", dirs: 1, frames: REQ_N, active: 0, size: 112, draw: requiemGround },
  ],
};
