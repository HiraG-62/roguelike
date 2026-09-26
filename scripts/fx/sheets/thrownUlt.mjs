// 投擲（moveset "thrown"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は thrown.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/thrown.json × 2 が目安
//
// 投擲の通常の絵は「手首の返しの細い弧」「前へ抜ける空気の裂け目（細いレンズ）」「刃の縁だけ白い短剣」「前へ押す圧の弧」でできている。
// 奥義はその言葉のまま、数と大きさと崩れの段を増やす:
//   千手（12 本を 30° 刻み = ほぼ全周へ放つ）: 自分の周りに 12 の手首の返しが輪になって閃き（cast）、12 の裂け目が放射に抜けて圧の輪が広がる（acts[0]）
//   一点集中（追う刃 8 本・15° 刻み）: 照準の先に照星が締まり（cast）、扇に開いた 8 本の軌跡が照準の一点へ曲がって集まる（acts[0]）
//   早業（持続）: 3 本の短剣が腰の周りを回り続ける纏い（sustain）。持続中は射撃が速い・増える・貫くので、手の周りが常に忙しい絵にする
// 千手と一点集中の弾は、描画側（src/render/thrownLook.ts）がナイフの本体を描く。fly は本体の下に重なる風切りの軌跡・残像・光だけ（本体を描くと二重になる）
// 決まり: 1 本の投げの軌跡は 1 本（二重線にしない）/ 白（段 7）は刃の縁・光点だけ / 振り終わりは崩れて消える
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾の尾は 24 方向だと角のずれが目立つので 32 方向（fx-brief2） */
const SHOT_DIRS = 32;
/** 投げる手の位置（自分の中心から前へ）。thrown.mjs と同じ */
const HAND = 20;
/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 共通の部品（thrown.mjs から写して奥義向けに作り変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 先へ細る 1 本の針: (x, y) から角 a へ長さ len、根元の半幅 w */
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

/** 前へ押し出す圧の弧（潰れた楕円の前側 ±spread だけ）。中心 (ox, oy)、+x へ開く */
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

/**
 * 投げ短剣の刃 1 本（thrown.mjs の knife と同じ形）: 中心 (x, y)、角 a、全長 len、刃の半幅 w。
 * 前 6 割が刃、後ろ 4 割が柄と柄頭。白は刃の片側の縁の細い線だけ
 */
function knife(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 41;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const blade = len * 0.6;
  const grip = len * 0.4;
  const pad = len / 2 + w + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s + (grip - blade) / 2;
      const across = -dx * s + dy * c;
      if (along >= 0) {
        if (along > blade) return -1;
        const u = along / blade;
        const half = w * (1 - u) ** 0.85 + 0.3;
        if (Math.abs(across) > half) return -1;
        const q = Math.abs(across) / half;
        if (!survives(px, py, erosion, 1 - q, seed)) return -1;
        if (across > half - 1.1 && u < 0.85 && erosion < 0.35) return clamp01(0.95 * bright);
        return clamp01((0.72 - 0.25 * q - 0.15 * u) * bright);
      }
      const back = -along;
      if (back > grip) return -1;
      if (Math.hypot(back - grip + 1, across) < 1.6) return clamp01(0.5 * bright);
      if (Math.abs(across) > w * 0.45 + 0.2) return -1;
      if (!survives(px, py, erosion, 0.5, seed)) return -1;
      return clamp01((back < 1.2 ? 0.6 : 0.38) * bright);
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad } },
  );
}

/** 細い 1 本の弧線（中心 (cx, cy)、半径 r、角 a0 → a1）。a1 側が明るい。手首の返し・回転の残像 */
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

/** 振りの進み p（active 中）と崩れ k（振り終わり 0..1） */
function phase(f, A, N) {
  return { p: f < A ? easeSwing((f + 1) / A) : 1, k: f < A ? 0 : (f - A + 1) / (N - A + 1) };
}

/** 極座標の点 */
function polar(a, r) {
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// -----------------------------------------------------------------------------
// 千手（volley: pistol × 12、30° 刻み = −165°〜+165° のほぼ全周、貫通 1）
// 千の手が同時に投げる: 自分の周りの 12 の向きで手首が返り、12 の裂け目が放射に抜ける。真後ろ（180°）だけ空く
// -----------------------------------------------------------------------------

const TH_COUNT = 12;
const TH_STEP = 30 * DEG;
/** i 本目の投げる向き（ultimates の spreadOffsets と同じ: (i − 5.5) × 30°） */
function thAngle(i) {
  return (i - (TH_COUNT - 1) / 2) * TH_STEP;
}
/** 裂け目の出る半径（手の輪） */
const TH_HAND_R = 24;
const TH_N = 9;
const TH_A = 3;

/**
 * 千手の放つ絵（acts[0]、原点 = 自分、+x = 照準）: 12 本の裂け目が手の輪から放射に抜けて伸び、
 * 後ろに圧の輪（真後ろの空いた欠けた輪）が広がる。前の 4 本ほど長く明るい（照準の側が主役）
 */
function thousandHandsRelease(frame, f) {
  const { k } = phase(f, TH_A, TH_N);
  // 1) 圧の輪: 手の輪から外へ。真後ろ ±15° は放っていないので欠かす
  const ringR = TH_HAND_R + 4 + f * 9;
  if (k < 0.95) {
    paint(
      frame,
      (x, y) => {
        const a = Math.atan2(y, x);
        if (Math.abs(a) > Math.PI - 16 * DEG) return -1;
        const d = Math.abs(Math.hypot(x, y) - ringR);
        const w = 2.6 - f * 0.2;
        if (d > w / 2) return -1;
        const q = d / (w / 2);
        const back = Math.abs(a) / Math.PI;
        if (!survives(x, y, 0.1 + k * 0.95 + back * 0.25, 1 - q, 6011)) return -1;
        return clamp01((0.78 - 0.3 * back) * (1 - 0.5 * q) * (1 - k * 0.5));
      },
      { bounds: { x0: -ringR - 3, y0: -ringR - 3, x1: ringR + 3, y1: ringR + 3 } },
    );
  }
  // 2) 12 の裂け目（1 本の投げに 1 本）。放った瞬間は手の輪に根元があり、外へ流れながら痩せて崩れる
  for (let i = 0; i < TH_COUNT; i++) {
    const a = thAngle(i);
    const front = 1 - Math.abs(a) / Math.PI;
    const grow = f < TH_A ? easeSwing((f + 1) / TH_A) : 1;
    const r0 = TH_HAND_R + (f < TH_A ? 0 : (f - TH_A + 1) * 10);
    const len = (26 + 20 * front) * grow * (1 - k * 0.55);
    if (len < 4) continue;
    const p0 = polar(a, r0);
    const p1 = polar(a, r0 + len);
    lens(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, T: (4.2 + 1.6 * front) * (1 - k * 0.5), bias: 0, erosion: k * 0.95, seed: 6020 + i, bright: (0.72 + 0.3 * front) * (1 - k * 0.3) });
    if (f === 0) sparkle(frame, polar(a, TH_HAND_R + 1).x, polar(a, TH_HAND_R + 1).y, front > 0.8 ? 2 : 1);
    if (f === TH_A - 1 && front > 0.8) sparkle(frame, p1.x, p1.y, 3);
  }
  // 3) 手の輪の閃き（最初の 2 枚）: 12 の手が一斉に返った一瞬
  if (f <= 1) ring(frame, { radius: TH_HAND_R - 2, width: f === 0 ? 2.4 : 1.6, erosion: f * 0.35, bright: 0.85 - f * 0.25, seed: 6012 });
  // 4) 刃片: 12 の向きに沿って外へ（放った刃の鋼の削れ）
  if (f >= 1) {
    shards(frame, f - 1, 36, 6013, (i, rnd) => {
      const a = thAngle(i % TH_COUNT) + (rnd(1) - 0.5) * 0.35;
      const sp = 4 + rnd(2) * 5;
      const r = TH_HAND_R + 6 + rnd(3) * 10;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.84 };
    });
  }
}

/**
 * 千手の発動（cast、原点 = 自分）: 自分の周りに 12 の手首の返しの弧が輪になって閃く（千の手の光背）。
 * 前から後ろへ順に灯り、光背の細い輪を残して外へほどける
 */
function thousandHandsCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  // 光背の細い輪
  ring(frame, { radius: 28 + f * 1.5, width: 1.2, erosion: 0.25 + Math.max(0, k - 0.3) * 1.2, bright: 0.32 - k * 0.12, seed: 6101 });
  for (let i = 0; i < TH_COUNT; i++) {
    const a = thAngle(i);
    // 前（照準の側）から順に灯る
    const born = Math.floor(Math.abs(i - (TH_COUNT - 1) / 2) / 2);
    const age = f - born;
    if (age < 0 || age > 4) continue;
    const c = polar(a, 40 + age * 3);
    // 手首の返し: その向きの手元で、外へ向かって時計回りに閉じる弧（通常の返しより大きく太い）
    thinArc(frame, { cx: c.x - Math.cos(a) * 13, cy: c.y - Math.sin(a) * 13, r: 13, a0: a - 95 * DEG, a1: a + 6 * DEG, width: age === 0 ? 2.2 : 1.6, bright: 0.95 - age * 0.2 });
    if (age === 0) dot(frame, c.x, c.y, 6);
    if (age === 1 && Math.abs(a) < 20 * DEG) sparkle(frame, c.x, c.y, 2);
  }
  if (f === 0) {
    flashCore(frame, 0, 0, 7, 0.9);
    sparkle(frame, 0, 0, 3);
  }
}

/**
 * 千手の弾の軌跡（fly、原点 = 弾の中心、+x = 進む向き）: ナイフ本体は描画側が描くので、ここは下に敷く風切りだけ。
 * 速さ 330px/秒 → 尾 ≈ 26 ドット。本体の下の細い光の芯（段 6）から、後ろへ長く細る空気の裂け目と、
 * 裂け目の外側に沿う 2 本の短い風の筋（上下で長さと位相をずらし、二重線に見せない）。フレームで筋が後ろへ流れる
 */
function thousandHandsFly(frame, f) {
  const T0 = f / 4;
  // 空気の裂け目: −34 から +4、中央ではなく前寄りが太い
  paint(
    frame,
    (x, y) => {
      if (x > 4 || x < -34) return -1;
      const u = (4 - x) / 38;
      const half = 2.6 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95)), 0.8) * (1 - u) ** 0.4 + 0.3;
      if (Math.abs(y) > half) return -1;
      const q = Math.abs(y) / half;
      // 後ろ 4 割はちぎれる（フレームで流れる）
      if (u > 0.55 && valueNoise(x + f * 5, y, 2.2, 6201) < (u - 0.55) * 1.6) return -1;
      return clamp01((1 - q) ** 0.9 * (0.78 - 0.5 * u));
    },
    { bounds: { x0: -35, y0: -4, x1: 5, y1: 4 }, dither: 0.02 },
  );
  // 外側の風の筋（上下に 1 本ずつ。後ろへ流れて巡る）
  for (let side = -1; side <= 1; side += 2) {
    const t = (T0 + (side > 0 ? 0.5 : 0)) % 1;
    const x1 = -6 - t * 14;
    const len = 10 + 6 * (1 - t);
    streakLine(frame, { ax: x1 - len, ay: side * 5, bx: x1, by: side * 4, bright: 0.55 * (1 - t * 0.6) });
  }
  // 本体の下の光の芯（刃の照り返し）と、フレームで瞬く光点
  paint(
    frame,
    (x, y) => {
      if (x < -8 || x > 8 || Math.abs(y) > 1) return -1;
      return 0.8 - Math.abs(x) / 16;
    },
    { bounds: { x0: -9, y0: -2, x1: 9, y1: 2 }, dither: 0 },
  );
  if (f % 2 === 0) sparkle(frame, 6, 0, 1);
  dot(frame, -18 - hash1(f, 6202) * 12, (hash1(f, 6203) - 0.5) * 6, 4);
}

/**
 * 千手の手元（muzzle、原点 = 弾が出た位置）: 近い弾は 1 つにまとまるので、1 つで「何本も投げた」手元に見せる。
 * 手首の返しの弧（通常より太い）と、前へ抜ける裂け目、その左右に開く 2 本の小さな裂け目（扇の隣の刃）
 */
function thousandHandsMuzzle(frame, f) {
  if (f <= 1) thinArc(frame, { cx: -10, r: 12, a0: -85 * DEG, a1: 10 * DEG, width: 1.8, bright: 0.9 - f * 0.25 });
  if (f <= 3) {
    const x0 = -2 + f * 6;
    lens(frame, { ax: x0, ay: 0, bx: x0 + 24 - f * 4, by: 0, T: 5 - f, bias: 0, erosion: f * 0.25, seed: 6301, bright: 0.95 - f * 0.15 });
    for (const side of [-1, 1]) {
      const a = side * 28 * DEG;
      const r0 = 2 + f * 5;
      lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + 14 - f * 3), by: Math.sin(a) * (r0 + 14 - f * 3), T: 3 - f * 0.6, bias: 0, erosion: f * 0.3, seed: 6302 + side, bright: 0.7 - f * 0.12 });
    }
  }
  if (f === 0) sparkle(frame, 3, 0, 3);
  if (f >= 1) frontArc(frame, { ox: 10 + f * 4, radius: 4 + f * 3, width: 1.8, squash: 0.45, spread: 80 * DEG, erosion: Math.min(0.9, f * 0.2), bright: 0.65 - f * 0.1, seed: 6303 });
  shards(frame, f - 1, 7, 6304, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.3;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: 10, y: (rnd(3) - 0.5) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

/**
 * 千手の着弾（impact、壁か敵で止まった）: 刃が切っ先から突き立って震え、当たった面に縦の閃きと、
 * 後ろの半球へ跳ねる鋼の火花。通常の短剣より刃が大きく、震えの線と火花が多い
 */
function thousandHandsImpact(frame, f) {
  const N = 8;
  const quiver = [11, -9, 7, -5, 3, -2, 1, 0][f] ?? 0;
  const fade = f / (N - 1);
  knife(frame, { x: -7, a: quiver * DEG, len: 18, w: 3, bright: 1 - fade * 0.55, erosion: Math.max(0, fade - 0.45) * 1.6, seed: 6401 });
  if (f <= 1) {
    lens(frame, { ax: 2, ay: -10, bx: 2, by: 10, T: f === 0 ? 3.6 : 2.4, bias: 0, bright: 0.95 });
    flashCore(frame, 2, 0, 3.5, 1);
    sparkle(frame, 2, 0, f === 0 ? 4 : 2);
  }
  if (f >= 1 && f <= 5) {
    const side = f % 2 === 0 ? 1 : -1;
    thinArc(frame, { cx: 2, r: 17, a0: Math.PI - side * 4 * DEG, a1: Math.PI + side * 24 * DEG, bright: 0.55 - f * 0.06 });
  }
  if (f >= 1 && f <= 4) ring(frame, { ox: 2, radius: 4 + f * 3, width: 1.6, squash: 0.45, erosion: Math.min(0.9, f * 0.2), bright: 0.65 - f * 0.08, seed: 6402 });
  shards(frame, f, 12, 6403, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 2.8 + rnd(2) * 3;
    return { x: 1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.45 ? 2 : 1, drag: 0.8 };
  });
}

/**
 * 千手の命中（hit、敵の体に食い込む。貫通 1 なので 1 体目では抜ける）: 刺し貫いて前へ抜ける長い針と、
 * 斜め前へ開く 2 本の閃き、進む向きに潰れた輪、前へ飛ぶ細かな破片
 */
function thousandHandsHit(frame, f) {
  if (f <= 1) {
    const g = f === 0 ? 0.85 : 1;
    spike(frame, { x: -8, a: 0, len: 30 * g, w: 2.8, bright: 1 });
    spike(frame, { x: -8, a: Math.PI, len: 8 * g, w: 2.2, bright: 0.8 });
    spike(frame, { x: 0, a: 32 * DEG, len: 13 * g, w: 1.6, bright: 0.85 });
    spike(frame, { x: 0, a: -32 * DEG, len: 13 * g, w: 1.6, bright: 0.85 });
    flashCore(frame, -2, 0, 4, 1);
    sparkle(frame, -2, 0, f === 0 ? 3 : 2);
  } else if (f === 2) {
    spike(frame, { x: 4, a: 0, len: 26, w: 1.8, bright: 0.7, erosion: 0.5, seed: 6501 });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 7 + age * 4.5, width: 2.2, squash: 0.5, erosion: Math.min(0.95, 0.15 + age * 0.25), bright: 0.75 - age * 0.1, seed: 6502 });
  }
  shards(frame, f - 1, 12, 6503, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.25 ? 1.1 : 3.2);
    const sp = 3.5 + rnd(3) * 3.5;
    return { x: 3, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.3 ? 2 : 1, drag: 0.82 };
  });
}

/** 千手の弾が尽きた（dirs 1）: 勢いの尽きた刃が回りながら落ち、落ちた所で光の粒に砕けて散る */
function thousandHandsFizzle(frame, f) {
  const drop = Math.min(1, f / 4);
  const y = drop * drop * 12;
  if (f <= 3) knife(frame, { x: f, y, a: -30 * DEG + f * 60 * DEG, len: 15, w: 2.4, bright: 1 - f * 0.12, erosion: f * 0.12, seed: 6601 });
  if (f === 4) sparkle(frame, 4, y, 2);
  shards(frame, f - 4, 8, 6602, (i, rnd) => {
    const a = -Math.PI / 2 + (rnd(1) - 0.5) * 2.4;
    const sp = 1.4 + rnd(2) * 1.6;
    return { x: 4, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 一点集中（volley: seekerOrb × 8、15° 刻み = ±52.5° の扇、敵を追う）
// 照準の一点へ集まる: 扇に開いて放った 8 本が、曲がりながら前の一点へ寄っていく
// -----------------------------------------------------------------------------

const PP_COUNT = 8;
const PP_STEP = 15 * DEG;
function ppAngle(i) {
  return (i - (PP_COUNT - 1) / 2) * PP_STEP;
}
/** 集まる一点（照準の先。弾の追尾の届き 120px の手前の見せ場の距離） */
const PP_FOCUS = 104;
const PP_N = 10;
const PP_A = 4;

/**
 * 手から扇の向きへ出て、一点 (PP_FOCUS, 0) へ曲がって寄る 2 次曲線（手 → 扇の向きへ張り出す制御点 → 一点）
 */
function ppCurve(i, t) {
  const a = ppAngle(i);
  const h = polar(a, HAND);
  const c = polar(a, HAND + 58);
  const u = 1 - t;
  return { x: u * u * h.x + 2 * u * t * c.x + t * t * PP_FOCUS, y: u * u * h.y + 2 * u * t * c.y };
}

/**
 * 曲線に沿う細い軌跡（t0 → t1）。先頭（t1）が太く明るく、後ろへ細る。1 本の刃に 1 本の軌跡
 */
function ppTrail(frame, i, t0, t1, o) {
  const width = o.width ?? 2.4;
  const bright = o.bright ?? 0.85;
  const erosion = o.erosion ?? 0;
  const steps = 14;
  // 区間ごとに小さな外接矩形で塗る（曲線全体の矩形で全区間の距離を測ると生成が重い）。塗りは raise なので継ぎ目は重なって消える
  for (let s = 0; s < steps; s++) {
    const a = ppCurve(i, t0 + ((t1 - t0) * s) / steps);
    const b = ppCurve(i, t0 + ((t1 - t0) * (s + 1)) / steps);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const pad = width + 2;
    paint(
      frame,
      (x, y) => {
        const tt = clamp01(((x - a.x) * dx + (y - a.y) * dy) / l2);
        const d = Math.hypot(x - a.x - dx * tt, y - a.y - dy * tt);
        const bt = (s + tt) / steps;
        const half = (width / 2) * (0.25 + 0.75 * bt ** 0.7) + 0.2;
        if (d > half) return -1;
        const q = d / half;
        if (!survives(x, y, erosion + (1 - bt) * 0.2, 1 - q, 7001 + i)) return -1;
        return clamp01((1 - q) ** 0.8 * bright * (0.35 + 0.65 * bt));
      },
      { bounds: { x0: Math.min(a.x, b.x) - pad, y0: Math.min(a.y, b.y) - pad, x1: Math.max(a.x, b.x) + pad, y1: Math.max(a.y, b.y) + pad }, dither: 0.02 },
    );
  }
}

/**
 * 一点集中の放つ絵（acts[0]、原点 = 自分、+x = 照準）: 8 本の軌跡が手から扇に開き、曲がって前の一点へ寄る。
 * 先頭が一点に届いた枚で、そこに締まる光の輪と光点。振り終わりは軌跡が尾から消え、一点の輪がほどける
 */
function pinpointRelease(frame, f) {
  const { p, k } = phase(f, PP_A, PP_N);
  const head = f < PP_A ? 0.15 + 0.85 * p : 1;
  const tail = f < PP_A ? Math.max(0, head - 0.55) : 0.45 + 0.55 * k;
  // 手から放った扇の閃き（最初の 2 枚）
  if (f <= 1) {
    frontArc(frame, { ox: HAND - 10, radius: 14 + f * 4, width: 2.4 - f * 0.6, squash: 0.7, spread: 62 * DEG, erosion: f * 0.3, bright: 0.85 - f * 0.2, seed: 7010 });
    if (f === 0) sparkle(frame, HAND, 0, 3);
  }
  if (tail < 0.97) {
    for (let i = 0; i < PP_COUNT; i++) {
      // 外側の刃ほど遠回りなので、少しだけ遅れて見せる（8 本が一斉に同じ位置に並ばない）
      const lag = Math.abs(i - (PP_COUNT - 1) / 2) * 0.02;
      const h = Math.max(0, head - lag);
      const t = Math.max(0, tail - lag);
      if (h - t < 0.03) continue;
      ppTrail(frame, i, t, h, { width: 2.8 * (1 - k * 0.5), bright: 0.9 - k * 0.3, erosion: k * 0.9 });
      if (f < PP_A) {
        const q = ppCurve(i, h);
        dot(frame, q.x, q.y, 6);
      }
    }
  }
  // 一点: 届いた枚に締まる輪、四方の短い照準の刻み、光点
  if (f >= PP_A - 1) {
    const age = f - (PP_A - 1);
    const r = Math.max(4, 16 - age * 3);
    ring(frame, { ox: PP_FOCUS, radius: r, width: 1.8, erosion: Math.min(0.9, age * 0.15), bright: 0.85 - age * 0.08, seed: 7011 });
    if (age <= 3) {
      for (let j = 0; j < 4; j++) {
        const a = j * (Math.PI / 2) + Math.PI / 4;
        const r0 = r + 3;
        streakLine(frame, { ax: PP_FOCUS + Math.cos(a) * (r0 + 7), ay: Math.sin(a) * (r0 + 7), bx: PP_FOCUS + Math.cos(a) * r0, by: Math.sin(a) * r0, width: 1.2, bright: 0.75 - age * 0.12 });
      }
    }
    if (age === 0) sparkle(frame, PP_FOCUS, 0, 4);
    else if (age === 1) sparkle(frame, PP_FOCUS, 0, 2);
    shards(frame, age, 14, 7012, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 3;
      return { x: PP_FOCUS, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
}

/**
 * 一点集中の発動（cast、原点 = 自分、+x = 照準）: 指の間に扇に開いた 8 本の刃（手元で開いて閃く）と、
 * 照準の先で四隅の鉤が内へ締まる照星。締まりきった枚に照星の芯が光る
 */
function pinpointCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  // 手元の扇: 8 本の刃が 0 → 1 枚で開き、閃いて、薄れる
  const open = Math.min(1, (f + 1) / 2);
  if (f <= 5) {
    for (let i = 0; i < PP_COUNT; i++) {
      // 握り（手元）から扇に開く。指の間に挟んだ刃の見下ろし
      const a = ppAngle(i) * open;
      const c = polar(a, 14);
      knife(frame, { x: HAND - 14 + c.x, y: c.y, a, len: 18, w: 2.6, bright: (f === 2 ? 1 : 0.8) * (1 - Math.max(0, f - 3) * 0.25), erosion: Math.max(0, f - 3) * 0.3, seed: 7101 + i });
    }
    if (f === 2) sparkle(frame, HAND + 4, 0, 3);
  }
  // 照星: 四隅の鉤が内へ締まる
  const R = 32 - 22 * easeSwing(Math.min(1, (f + 1) / 4));
  const cx = PP_FOCUS;
  const bright = f < 4 ? 0.6 + f * 0.1 : 0.9 - (f - 4) * 0.28;
  if (bright > 0.1) {
    for (let j = 0; j < 4; j++) {
      const a = j * (Math.PI / 2) + Math.PI / 4;
      thinArc(frame, { cx, r: R, a0: a - 22 * DEG, a1: a + 22 * DEG, width: 1.6, bright });
      streakLine(frame, { ax: cx + Math.cos(a) * (R + 8), ay: Math.sin(a) * (R + 8), bx: cx + Math.cos(a) * (R + 1), by: Math.sin(a) * (R + 1), width: 1.2, bright: bright * 0.8 });
    }
  }
  if (f === 3) {
    flashCore(frame, cx, 0, 3, 1);
    sparkle(frame, cx, 0, 3);
  }
  // 手元から照星への照準の点線（締まる間だけ）
  if (f <= 4) {
    for (let x = HAND + 10; x < cx - R - 4; x += 6) dot(frame, x, 0, Math.max(2, Math.round(4 - k * 3)));
  }
}

/**
 * 一点集中の弾の軌跡（fly、原点 = 弾の中心）: ナイフ本体は描画側が描く。ここは追う刃の「導き」の光だけ。
 * 後ろへ揺らめく 1 本の光の帯（波が後ろへ流れる。追尾で曲がっても途切れない太さ）と、
 * 本体の周りを回る 2 つの導きの光点（半周ずらし）、帯から剥がれる粒
 */
function pinpointFly(frame, f) {
  const N = 6;
  const wave = (f / N) * TAU;
  paint(
    frame,
    (x, y) => {
      if (x > 2 || x < -32) return -1;
      const u = (2 - x) / 34;
      const cy = Math.sin(u * 6 - wave) * 3.2 * u ** 0.9;
      const w = 2.6 * (1 - u) ** 0.7 + 0.4;
      const d = Math.abs(y - cy);
      if (d > w) return -1;
      if (u > 0.5 && valueNoise(x + f * 4, y, 2.2, 7201) < (u - 0.5) * 1.5) return -1;
      return clamp01((1 - d / w) ** 0.7 * (0.75 - 0.5 * u));
    },
    { bounds: { x0: -33, y0: -8, x1: 3, y1: 8 }, dither: 0.02 },
  );
  // 導きの光点: 本体の周り（楕円）を回る
  for (let j = 0; j < 2; j++) {
    const a = wave + j * Math.PI;
    const x = Math.cos(a) * 9 - 2;
    const y = Math.sin(a) * 5;
    const lv = Math.sin(a) > 0 ? 6 : 4;
    dot(frame, x, y, lv);
    dot(frame, x + 1, y, lv - 1);
    dot(frame, x, y + 1, lv - 1);
    // 光点の後ろに 1 ドットの残り火（回る向きの反対）
    dot(frame, x + Math.sin(a) * 2, y - Math.cos(a) * 1.2, 3);
  }
  if (f % 3 === 0) sparkle(frame, 5, 0, 1);
  dot(frame, -16 - hash1(f, 7202) * 12, (hash1(f, 7203) - 0.5) * 8, 4);
}

/** 一点集中の手元（muzzle）: 刃を放つ手首の返しと、前に小さな照準の菱形が閃いて前へ流れる */
function pinpointMuzzle(frame, f) {
  if (f <= 1) thinArc(frame, { cx: -8, r: 10, a0: -80 * DEG, a1: 8 * DEG, width: 1.5, bright: 0.85 - f * 0.25 });
  if (f <= 2) {
    const x0 = -1 + f * 5;
    lens(frame, { ax: x0, ay: 0, bx: x0 + 18 - f * 3, by: 0, T: 3.6 - f * 0.8, bias: 0, erosion: f * 0.25, seed: 7301, bright: 0.9 - f * 0.15 });
  }
  // 菱形の照準（4 本の短い針が中心へ向く）
  const cx = 12 + f * 3;
  const r = 6 - f;
  if (f <= 3) {
    for (let j = 0; j < 4; j++) {
      const a = j * (Math.PI / 2);
      spike(frame, { x: cx + Math.cos(a) * (r + 4), y: Math.sin(a) * (r + 4), a: a + Math.PI, len: 4, w: 1.2, bright: 0.8 - f * 0.15 });
    }
  }
  if (f === 0) sparkle(frame, 2, 0, 2);
  if (f === 1) sparkle(frame, cx, 0, 2);
}

/**
 * 一点集中の着弾（impact）: 刃が止まった一点へ、四方から細い光が締まる（照準が閉じる）。
 * 芯の閃きと、閉じた輪が外へほどけて散る導きの粒
 */
function pinpointImpact(frame, f) {
  if (f <= 2) {
    const r = 14 - f * 5;
    for (let j = 0; j < 4; j++) {
      const a = j * (Math.PI / 2) + Math.PI / 4;
      spike(frame, { x: Math.cos(a) * (r + 7), y: Math.sin(a) * (r + 7), a: a + Math.PI, len: 7, w: 1.4, bright: 0.85 });
    }
  }
  if (f >= 2 && f <= 3) {
    flashCore(frame, 0, 0, f === 2 ? 5 : 3.5, 1);
    sparkle(frame, 0, 0, f === 2 ? 3 : 2);
  }
  if (f >= 3) {
    const age = f - 3;
    ring(frame, { radius: 5 + age * 3.5, width: 1.8, erosion: Math.min(0.92, 0.1 + age * 0.22), bright: 0.75 - age * 0.1, seed: 7401 });
  }
  shards(frame, f - 2, 10, 7402, (i, rnd) => {
    const a = (i / 10) * TAU + rnd(1) * 0.5;
    const sp = 2 + rnd(2) * 2.2;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.78 };
  });
}

/**
 * 一点集中の命中（hit）: 刃が刺さった所に照準の印が刻まれる。刺し傷の針と、印の輪＋四方の刻み（狙った獲物の印）
 */
function pinpointHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -8, a: 0, len: 22 - f * 2, w: 2.4, bright: 1 });
    spike(frame, { x: -8, a: Math.PI, len: 6, w: 1.8, bright: 0.75 });
    flashCore(frame, -1, 0, 3.5, 1);
    sparkle(frame, -1, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1) {
    const age = f - 1;
    const r = 9 + age * 1.5;
    ring(frame, { radius: r, width: 1.6, erosion: Math.min(0.95, age * 0.2), bright: 0.8 - age * 0.1, seed: 7501 });
    if (age <= 3) {
      for (let j = 0; j < 4; j++) {
        const a = j * (Math.PI / 2);
        streakLine(frame, { ax: Math.cos(a) * (r + 7 + age), ay: Math.sin(a) * (r + 7 + age), bx: Math.cos(a) * (r + 2), by: Math.sin(a) * (r + 2), width: 1.2, bright: 0.7 - age * 0.12 });
      }
    }
  }
  shards(frame, f, 8, 7502, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: 2, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
}

/** 一点集中の弾が尽きた（dirs 1）: 導きの光がほどけ、光点が小さな渦を描いて昇って消える */
function pinpointFizzle(frame, f) {
  if (f <= 1) flashCore(frame, 0, 0, 3 - f, 0.8);
  for (let j = 0; j < 3; j++) {
    const age = f - j;
    if (age < 0 || age > 4) continue;
    const a = j * (TAU / 3) + age * 0.9;
    const r = 3 + age * 2;
    dot(frame, Math.cos(a) * r, Math.sin(a) * r * 0.6 - age * 2.5, Math.max(2, 6 - age));
  }
  if (f === 2) sparkle(frame, 0, -4, 1);
}

// -----------------------------------------------------------------------------
// 早業（持続: 射撃が 1.4 倍速く、1 本増え、1 体多く貫き、1.3 倍速く飛ぶ）
// 3 本の短剣が腰の周りを回り続ける纏い。短剣は回る向きへ切っ先を向けて飛ぶ（回っている間も投げ物の形）
// -----------------------------------------------------------------------------

/** 纏いの 1 巡のフレーム数 */
const SWIFT_N = 12;
/** 回る短剣の数（3 回対称: 1 巡で 1/3 周回れば継ぎ目が出ない） */
const SWIFT_K = 3;
/** 回る楕円（見下ろしの腰の輪）。中心は体の中ほど */
const SWIFT_RX = 34;
const SWIFT_RY = 13;
const SWIFT_CY = 6;

/** 楕円上の角 t の位置と、その接線の角（時計回りに回る） */
function orbitAt(t) {
  const x = Math.cos(t) * SWIFT_RX;
  const y = SWIFT_CY + Math.sin(t) * SWIFT_RY;
  const tan = Math.atan2(Math.cos(t) * SWIFT_RY, -Math.sin(t) * SWIFT_RX);
  return { x, y, tan };
}

/** 楕円の弧の残像（t0 → t1、t1 側が明るい）。回る短剣の通った跡 1 本 */
function orbitTrail(frame, t0, t1, bright, width = 1.4) {
  paint(
    frame,
    (x, y) => {
      const ex = x / SWIFT_RX;
      const ey = (y - SWIFT_CY) / SWIFT_RY;
      const r = Math.hypot(ex, ey);
      // 楕円の法線方向の近さ（ドットの太さに直す）
      const d = Math.abs(r - 1) * Math.min(SWIFT_RX, SWIFT_RY) * (1 + Math.abs(ex) * 0.8);
      if (d > width / 2) return -1;
      let s = (Math.atan2(ey, ex) - t0) % TAU;
      if (s < 0) s += TAU;
      const span = t1 - t0;
      if (s > span) return -1;
      return bright * (0.2 + 0.8 * (s / span));
    },
    { bounds: { x0: -SWIFT_RX - 3, y0: SWIFT_CY - SWIFT_RY - 3, x1: SWIFT_RX + 3, y1: SWIFT_CY + SWIFT_RY + 3 }, dither: 0, samples: 3 },
  );
}

/**
 * 早業の纏い（sustain、dirs 1、原点 = 自分の中心）: 3 本の短剣が腰の楕円を時計回りに回り、それぞれ後ろに短い残像を引く。
 * 奥（楕円の上半分 = キャラの背後）を通る間は暗く、手前は明るい。左右の端で短い風の筋が外へ弾ける
 */
function swiftSustain(frame, f) {
  const cycle = f / SWIFT_N;
  for (let j = 0; j < SWIFT_K; j++) {
    const t = (j / SWIFT_K + cycle / SWIFT_K) * TAU;
    const o = orbitAt(t);
    // 手前（sin > 0）ほど明るい
    const near = 0.5 + 0.5 * Math.sin(t);
    const b = 0.55 + 0.45 * near;
    orbitTrail(frame, t - 0.75, t - 0.2, 0.5 * b);
    knife(frame, { x: o.x, y: o.y, a: o.tan, len: 16, w: 2.8, bright: b, seed: 7601 + j });
    // 左右の端（楕円の折り返し）で外へ弾ける風の筋
    const c = Math.cos(t);
    if (Math.abs(c) > 0.93) {
      const side = Math.sign(c);
      streakLine(frame, { ax: side * (SWIFT_RX + 3), ay: o.y, bx: side * (SWIFT_RX + 12), by: o.y - 2, bright: 0.45 });
    }
  }
  // 手前を通る 1 本の縁の光点（1 巡に 3 回。どれが光っても形は同じ）
  if (f % 4 === 1) {
    const o = orbitAt(Math.PI / 2 + TAU / SWIFT_K / 4);
    sparkle(frame, o.x, o.y, 1);
  }
  // 両手の周りの小さな風の粒: 前へ流れて 1 巡で戻る
  for (let i = 0; i < 6; i++) {
    const t = (cycle + hash1(i, 7610)) % 1;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (14 + t * 26);
    const y = -6 + (hash1(i, 7611) - 0.5) * 16 - t * 6;
    dot(frame, x, y, Math.max(2, Math.round(2 + 3 * Math.sin(Math.PI * t))));
  }
}

/** 早業の足元（ground）: 回る道筋の薄い楕円と、6 つの短い刻みがゆっくり回る（6 回対称で 1 巡の継ぎ目が出ない） */
function swiftSustainGround(frame, f) {
  const cycle = f / SWIFT_N;
  ring(frame, { oy: FEET_Y, radius: 14, width: 1.4, squash: 2.4, bright: 0.3, seed: 7620 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6 + cycle / 6) * TAU;
    const x0 = Math.cos(a) * 30;
    const y0 = FEET_Y + Math.sin(a) * 12;
    const a2 = a + 0.25;
    streakLine(frame, { ax: x0, ay: y0, bx: Math.cos(a2) * 30, by: FEET_Y + Math.sin(a2) * 12, width: 1.2, bright: 0.34 });
  }
}

/**
 * 早業の発動（cast、dirs 1）: 足元で輪が弾け、3 本の短剣が体から外へ渦を巻いて飛び出して腰の輪に収まる。
 * 周りに渦の風の弧（1 本ずつ 120° ずらし）が外へほどける
 */
function swiftCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  ring(frame, { oy: FEET_Y, radius: 8 + f * 4, width: 1.8 - k * 0.8, squash: 2.4, erosion: Math.min(0.92, 0.1 + k * 0.95), bright: 0.6 - k * 0.25, seed: 7701 });
  // 渦を巻いて広がる短剣（半径が 0 → 楕円の大きさへ、角は 1 周半）
  const grow = 0.35 + 0.65 * easeSwing(Math.min(1, (f + 1) / 6));
  for (let j = 0; j < SWIFT_K; j++) {
    const t = (j / SWIFT_K) * TAU + grow * TAU * 1.5;
    const x = Math.cos(t) * SWIFT_RX * grow;
    const y = SWIFT_CY + Math.sin(t) * SWIFT_RY * grow;
    const tan = Math.atan2(Math.cos(t) * SWIFT_RY, -Math.sin(t) * SWIFT_RX);
    if (f <= 7) knife(frame, { x, y, a: tan, len: 17, w: 2.8, bright: f === 5 ? 1 : 0.85, erosion: Math.max(0, f - 5) * 0.3, seed: 7702 + j });
    if (f === 5) sparkle(frame, x, y, 2);
  }
  // 渦の風の弧（外へ広がりながらほどける）
  if (k < 0.9) {
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU + f * 0.5;
      thinArc(frame, { r: 24 + f * 5, a0: a, a1: a + 1.1 - k * 0.6, width: 1.6 - k * 0.6, bright: 0.7 * (1 - k) });
    }
  }
  if (f === 0) {
    flashCore(frame, 0, 0, 6, 0.9);
    sparkle(frame, 0, 0, 3);
  }
  shards(frame, f, 14, 7710, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 3;
    // 渦の向き（時計回りの接線）を混ぜて外へ
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: (Math.cos(a) - Math.sin(a) * 0.8) * sp, vy: (Math.sin(a) + Math.cos(a) * 0.8) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 奥義の弾の表の 1 行 */
function shotRow(name, o) {
  return {
    fly: `thrownUlt.${name}Fly`,
    period: o.period,
    base: o.base,
    muzzle: `thrownUlt.${name}Muzzle`,
    impact: `thrownUlt.${name}Impact`,
    hit: `thrownUlt.${name}Hit`,
    fizzle: `thrownUlt.${name}Fizzle`,
    ramp: o.ramp,
  };
}

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 千手・一点集中の放つ絵は拡縮しない（0）。弾は奥義の volley の半径 3 で描く。
 * 配色: 千手は鋼の刃の群れなので steel、一点集中と早業は導き・技の冴えなので light
 */
const FX = {
  moveset: "thrown",
  ultimates: {
    "thrown.thousandHands": {
      ramp: "steel",
      cast: { sheet: "thrownUlt.thousandHandsCast", life: 0.35 },
      acts: [{ sheet: "thrownUlt.thousandHands", life: 0.45, base: 0, pivot: "pos" }],
      shots: { 0: shotRow("thousandHands", { period: 0.16, base: 3, ramp: "steel" }) },
    },
    "thrown.pinpoint": {
      ramp: "light",
      cast: { sheet: "thrownUlt.pinpointCast", life: 0.35 },
      acts: [{ sheet: "thrownUlt.pinpoint", life: 0.5, base: 0, pivot: "pos" }],
      shots: { 0: shotRow("pinpoint", { period: 0.3, base: 3, ramp: "light" }) },
    },
    "thrown.swiftToss": {
      ramp: "light",
      cast: { sheet: "thrownUlt.swiftTossCast", life: 0.5 },
      sustain: { sheet: "thrownUlt.swiftToss", period: 0.6, ground: "thrownUlt.swiftTossGround" },
    },
  },
};

export const ATLAS = {
  key: "thrownUlt",
  fx: FX,
  sheets: [
    { key: "thrownUlt.thousandHandsCast", dirs: DIRS, frames: 8, active: 0, size: 128, draw: thousandHandsCast },
    { key: "thrownUlt.thousandHands", dirs: DIRS, frames: TH_N, active: TH_A, size: 256, draw: thousandHandsRelease },
    { key: "thrownUlt.thousandHandsFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 80, draw: thousandHandsFly },
    { key: "thrownUlt.thousandHandsMuzzle", dirs: DIRS, frames: 5, active: 0, size: 72, draw: thousandHandsMuzzle },
    { key: "thrownUlt.thousandHandsImpact", dirs: DIRS, frames: 8, active: 0, size: 72, draw: thousandHandsImpact },
    { key: "thrownUlt.thousandHandsHit", dirs: DIRS, frames: 6, active: 0, size: 88, draw: thousandHandsHit },
    { key: "thrownUlt.thousandHandsFizzle", dirs: 1, frames: 7, active: 0, size: 48, draw: thousandHandsFizzle },
    { key: "thrownUlt.pinpointCast", dirs: DIRS, frames: 8, active: 0, size: 2 * (PP_FOCUS + 44), draw: pinpointCast },
    { key: "thrownUlt.pinpoint", dirs: DIRS, frames: PP_N, active: PP_A, size: 2 * (PP_FOCUS + 30), draw: pinpointRelease },
    { key: "thrownUlt.pinpointFly", dirs: SHOT_DIRS, frames: 6, active: 0, size: 80, draw: pinpointFly },
    { key: "thrownUlt.pinpointMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: pinpointMuzzle },
    { key: "thrownUlt.pinpointImpact", dirs: DIRS, frames: 8, active: 0, size: 64, draw: pinpointImpact },
    { key: "thrownUlt.pinpointHit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: pinpointHit },
    { key: "thrownUlt.pinpointFizzle", dirs: 1, frames: 7, active: 0, size: 40, draw: pinpointFizzle },
    { key: "thrownUlt.swiftTossCast", dirs: 1, frames: 10, active: 0, size: 176, draw: swiftCast },
    { key: "thrownUlt.swiftToss", dirs: 1, frames: SWIFT_N, active: 0, size: 112, draw: swiftSustain },
    { key: "thrownUlt.swiftTossGround", dirs: 1, frames: SWIFT_N, active: 0, size: 96, draw: swiftSustainGround },
  ],
};
