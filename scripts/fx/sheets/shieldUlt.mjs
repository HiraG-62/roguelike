// 大盾（moveset "shield"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。見本は swordUlt.mjs、形の言葉は shield.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/shield.json × 2 が目安
//
// 盾は刃ではなく「面」で押し殴る。通常の振りの言葉（端まで厚みの揃った平たい板・前縁だけ白い・段を平たい帯に量子化・
// 横へ広がる衝撃・金属の火花・地面の埃とひび）をそのまま大きくし、奥義ごとに違う面を出す:
// - 城門崩し: 城門ほどの巨大な弓なりの板（縦の継ぎ目と鉄の帯）が 120° の扇いっぱいに押し出され、前へ瓦礫を吹き飛ばす
// - 反撃の狼煙: 丸盾を地に突き立て、厚い衝撃の輪が全周へ。中心から狼煙の光の柱が立ち、守りの六角の障壁が包んで砕ける
// - 鉄壁: 6 枚の小盾が周りへ飛んできて並び、持続中は自分の周りをゆっくり巡る（向きの無い纏いなので全周に置く）
// 決まり: 1 回の押し出しは 1 枚の面（二重の輪郭を作らない）。白（段 7）は前縁・閃きの細い線・光点だけ。反りは前へ。
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（shield.mjs から写して奥義向けに広げたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 板の本体の段: 明部 → 本体 → 暗い背の縁の平たい帯（グラデーションにせず硬い板に見せる） */
function plateBand(q) {
  return q < 0.3 ? 0.7 : q < 0.68 ? 0.52 : q < 0.86 ? 0.37 : 0.2;
}

/** 盾の面（弓なりの平たい板）。shield.mjs の plate と同じ形。前縁の頂点 (cx, cy)、向き dir */
function plate(frame, o) {
  const { H, T } = o;
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  const dir = o.dir ?? 0;
  const bulge = o.bulge ?? 8;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 11;
  const edge = o.edge ?? 1.6;
  const edgeReach = o.edgeReach ?? 0.85;
  const body = o.body ?? 1;
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  const pad = H + T + bulge + 3;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      const sv = v / H;
      const as = Math.abs(sv);
      if (as > 1) return -1;
      const front = -bulge * sv * sv;
      const thk = T * Math.pow(1 - Math.pow(as, 10), 0.35);
      if (thk < 0.6) return -1;
      const depth = front - u;
      if (depth < 0 || depth > thk) return -1;
      const q = depth / thk;
      if (!survives(x, y, erosion, (1 - q) * (1 - as * 0.8), seed)) return -1;
      if (depth < edge && as < edgeReach && erosion < 0.55) return clamp01(0.84 + 0.2 * bright);
      let v0 = plateBand(q);
      if (as > 0.8) v0 -= 0.12;
      return clamp01(v0 * body * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0 },
  );
}

/** 厚い衝撃の輪（外縁が白く、内側へ平たい帯で薄れる） */
function thickRing(frame, o) {
  const { R, W } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 21;
  paint(
    frame,
    (x, y) => {
      const d = R - Math.hypot(x, y);
      if (d < 0 || d > W) return -1;
      const q = d / W;
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      if (d < 1.8 && erosion < 0.5) return clamp01(bright * 1.02);
      const v0 = q < 0.22 ? 0.66 : q < 0.5 ? 0.48 : q < 0.78 ? 0.34 : 0.2;
      return clamp01(v0 * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
}

/** 地面の埃（段 1〜3 の柔らかい塊） */
function dust(frame, x, y, r, fade, seed, level = 0.3) {
  if (fade >= 1 || r < 1) return;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      const n = valueNoise(px, py, 3, seed);
      if (n - d * 0.6 - fade * 0.7 < -0.05) return -1;
      return clamp01((level - d * 0.12) * (1 - fade * 0.5));
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 }, samples: 2 },
  );
}

/** 金属の打撃の閃き: (x, y) から a0..a1 の範囲へ放射の短い線 n 本 */
function burstLines(frame, x, y, n, r0, r1, a0, a1, bright, seed) {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5 + (hash1(i, seed) - 0.5) * 0.6)) / n;
    const len = r1 * (0.55 + 0.45 * hash1(i, seed + 1));
    const w = i % 2 === 0 ? 1.4 : 1;
    streakLine(frame, { ax: x + Math.cos(a) * r0, ay: y + Math.sin(a) * r0, bx: x + Math.cos(a) * (r0 + len), by: y + Math.sin(a) * (r0 + len), width: w, bright });
  }
}

/** 丸盾の面（上から見た円い盾）。縁が白く、中央に鋲 */
function roundShield(frame, r, bright, glint) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d > r) return -1;
      const q = d / r;
      if (q > 0.86) return clamp01(bright * (q > 0.93 ? 0.72 : 1.02));
      if (q < 0.22) return clamp01(bright * 0.75);
      return clamp01(bright * (q < 0.45 ? 0.3 : 0.44));
    },
    { bounds: { x0: -r - 1, y0: -r - 1, x1: r + 1, y1: r + 1 }, dither: 0 },
  );
  if (glint) sparkle(frame, -r * 0.35, -r * 0.35, 2);
}

/** 地面のひび: (cx, cy) から a0..a1 の向きへ伸びる暗い折れ線（段 2〜3）。重さを地面に残す */
function cracks(frame, o) {
  const { n, len, grow, fade, seed } = o;
  const a0 = o.a0 ?? 0;
  const a1 = o.a1 ?? TAU;
  const r0 = o.r0 ?? 5;
  if (fade >= 1) return;
  for (let i = 0; i < n; i++) {
    let a = a0 + ((a1 - a0) * (i + 0.2 + 0.6 * hash1(i, seed))) / n;
    let x = Math.cos(a) * r0;
    let y = Math.sin(a) * r0;
    const segs = 4;
    const total = len * (0.6 + 0.4 * hash1(i, seed + 1)) * grow;
    for (let j = 0; j < segs; j++) {
      a += (hash1(i * 7 + j, seed + 2) - 0.5) * 0.7;
      const nx = x + (Math.cos(a) * total) / segs;
      const ny = y + (Math.sin(a) * total) / segs;
      if (hash1(i * 7 + j, seed + 3) > 1 - fade) break;
      streakLine(frame, { ax: nx, ay: ny, bx: x, by: y, width: j === 0 ? 1.8 : 1.2, bright: 0.34 });
      x = nx;
      y = ny;
    }
  }
}

// -----------------------------------------------------------------------------
// 城門崩し（swing arc 120° / reach 40）: 城門ほどの弓なりの面が扇いっぱいに押し出される
// -----------------------------------------------------------------------------

/** 前縁の半径（reach 40 論理 px × 2） */
const GATE_R = 80;
/** 扇の半分の角（120° の半分） */
const GATE_HALF = Math.PI / 3;
/** 面の厚み（振りの盾の 1.5 倍。城門の分厚い板） */
const GATE_T = 24;
const GATE_N = 11;
const GATE_A = 4;
/** 縦の継ぎ目（城門の板の合わせ目）の数 */
const GATE_PLANKS = 5;

/**
 * 城門の面: 自分を中心にした扇の帯（外縁 R・厚み T・半角 half）。扇なので自然に前へふくらむ。
 * 両端の角は厚みを落として丸める。縦の継ぎ目と、厚みの中ほどを横切る鉄の帯で「門」に見せる
 */
function gatePlate(frame, o) {
  const { R, T, half } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 3101;
  const edge = o.edge ?? 2.2;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < R - T - 1) return -1;
      const as = Math.abs(Math.atan2(y, x)) / half;
      if (as > 1) return -1;
      const thk = T * Math.pow(1 - Math.pow(as, 12), 0.35);
      const depth = R - r;
      if (thk < 0.6 || depth > thk) return -1;
      const q = depth / thk;
      if (!survives(x, y, erosion, (1 - q) * (1 - as * 0.7), seed)) return -1;
      if (depth < edge && as < 0.9 && erosion < 0.55) return clamp01(0.86 + 0.2 * bright);
      let v0 = plateBand(q);
      // 縦の継ぎ目: 板の合わせ目を一段暗く（前縁の白は切らない）
      const plank = ((Math.atan2(y, x) / half + 1) / 2) * GATE_PLANKS;
      const seam = Math.abs(plank - Math.round(plank));
      if (seam * (R - T / 2) * ((2 * half) / GATE_PLANKS) < 1.1 && q > 0.14) v0 = 0.22;
      // 鉄の帯: 厚みの 45〜58% を横切る明るい帯（鋲の打たれた補強）
      if (q > 0.45 && q < 0.58) v0 = 0.6;
      if (as > 0.85) v0 -= 0.12;
      return clamp01(v0 * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
}

function siegeBreaker(frame, f) {
  const A = GATE_A;
  const N = GATE_N;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const R = 26 + (GATE_R - 26) * p + k * 8;
  const T = GATE_T * (f < A ? 0.6 + 0.4 * p : 1 - 0.5 * k);
  const half = GATE_HALF * (f < A ? 0.72 + 0.28 * p : 1 + 0.05 * k);
  const erosion = k > 0 ? 0.04 + 0.86 * Math.pow(k, 1.15) : 0;
  // 速度線: 面の背から自分の側へ（押し出す勢い）。放射の向きに、面の後ろだけ
  if (k < 0.7) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2 * half * 0.82 + (hash1(i, 3102) - 0.5) * 0.08;
      const back = R - T - 3 - hash1(i, 3103) * 6;
      const len = (22 + 18 * hash1(i, 3104)) * (1 - k) * (f === 0 ? 0.5 : 1);
      const r0 = Math.max(6, back - len);
      if (back <= r0) continue;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * back, by: Math.sin(a) * back, width: i % 2 === 0 ? 1.5 : 1, bright: 0.5 * (1 - k) });
    }
  }
  gatePlate(frame, { R, T, half, erosion, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.25 * k, edge: f === A - 1 ? 2.8 : 2.2 });
  // 鉄の帯の鋲（面が崩れ始めるまで）
  if (k < 0.3) {
    const rr = R - T * 0.515;
    for (let i = 0; i < GATE_PLANKS; i++) {
      const a = ((i + 0.5) / GATE_PLANKS - 0.5) * 2 * half;
      dot(frame, Math.cos(a) * rr, Math.sin(a) * rr, 6);
    }
  }
  // 止まった瞬間: 前縁の中央と両肩の閃き、前へ放射の閃き
  if (f === A - 1 || f === A) {
    const big = f === A - 1;
    sparkle(frame, R + 1, 0, big ? 4 : 3);
    for (const side of [-1, 1]) {
      const a = side * half * 0.62;
      sparkle(frame, Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), big ? 3 : 2);
    }
    burstLines(frame, R + 2, 0, 9, 3 + (big ? 0 : 5), big ? 30 : 20, -0.9, 0.9, big ? 0.95 : 0.6, 3105);
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    const ageK = age / (N - A + 1);
    // 両端の衝撃: 扇の端から外（接線の外向き）へ開く短い弧
    if (ageK < 1) endWaves(frame, R - T * 0.35, half, 6 + age * 7, 3.4 - age * 0.3, ageK, 3106);
    // 吹き飛ぶ瓦礫と火花: 前縁の全幅から前（放射の外向き）へ速く
    shards(frame, age, 36, 3107, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2 * half * 0.95;
      const sp = 6 + rnd(2) * 8;
      const spread = (rnd(3) - 0.5) * 0.4;
      return { x: Math.cos(a) * (R + 1), y: Math.sin(a) * (R + 1), vx: Math.cos(a + spread) * sp, vy: Math.sin(a + spread) * sp, life: 3 + Math.floor(rnd(4) * 4), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
    });
    // 前縁の外に巻き上がる埃（押し飛ばした手応え）
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2 * half * 0.85;
      const rr = R + 6 + age * 3.5;
      dust(frame, Math.cos(a) * rr, Math.sin(a) * rr, 5 + age * 2.4 + hash1(i, 3108) * 2, Math.max(0, ageK * 1.1 - 0.05), 3110 + i, 0.34);
    }
  }
}

/** 扇の両端から外へ開く衝撃の弧（面の前に回り込ませない: 前へ引くと 2 枚目の面の輪郭に見える） */
function endWaves(frame, rEnd, half, radius, width, fade, seed) {
  for (const side of [-1, 1]) {
    const ex = Math.cos(side * half) * rEnd;
    const ey = Math.sin(side * half) * rEnd;
    const mid = side * (half + Math.PI / 2);
    const span = 0.8;
    paint(
      frame,
      (x, y) => {
        const dx = x - ex;
        const dy = y - ey;
        const d = Math.abs(Math.hypot(dx, dy) - radius);
        if (d > width / 2) return -1;
        let a = Math.atan2(dy, dx) - mid;
        if (a > Math.PI) a -= TAU;
        if (a < -Math.PI) a += TAU;
        const t = Math.abs(a) / span;
        if (t > 1) return -1;
        if (!survives(x, y, fade * 0.9, 1 - t, seed + side)) return -1;
        return clamp01((0.85 - 0.45 * t) * (1 - fade * 0.55) * (1 - (d / width) * 0.6));
      },
      { bounds: { x0: ex - radius - width, y0: ey - radius - width, x1: ex + radius + width, y1: ey + radius + width }, dither: 0 },
    );
  }
}

/** 城門崩しの地面: 扇の中に前へ走るひびと、面が押し通った跡の弧の擦り傷。薄れて消える */
function siegeBreakerGround(frame, f) {
  const A = GATE_A;
  const grow = Math.min(1, (f + 1) / A);
  const k = f < A + 1 ? 0 : (f - A) / (GATE_N - A);
  cracks(frame, { n: 9, len: 66, grow, fade: Math.max(0, k * 1.15 - 0.1), seed: 3120, a0: -GATE_HALF * 0.9, a1: GATE_HALF * 0.9, r0: 14 });
  // 擦り傷: 押し出された面の通り道の縁（扇の両辺）に沿った短い暗い線
  if (k < 0.8) {
    for (const side of [-1, 1]) {
      const a = side * GATE_HALF * 0.97;
      const r1 = 24 + (GATE_R - 24) * grow;
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * 20, by: Math.sin(a) * 20, width: 1.6, bright: 0.3 * (1 - k) });
    }
  }
}

/**
 * 城門崩しの発動: 盾を前に据えて踏みしめる。据えた板の前縁が端から白く燃え広がり、
 * 足元の潰れた輪と後ろへ吹く砂の筋。最後に前縁の中央が閃く
 */
function siegeBreakerCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const charge = Math.min(1, (f + 1) / 4);
  plate(frame, { cx: 20, H: 30, T: 14, bulge: 9, edge: 1.4 + charge * 1.2, edgeReach: 0.3 + 0.6 * charge, body: 0.55 + 0.3 * charge, erosion: f >= 5 ? (f - 4) * 0.28 : 0, bright: 1 - Math.max(0, f - 4) * 0.15, seed: 3131 });
  if (f === 3) sparkle(frame, 21, 0, 4);
  if (f === 4) sparkle(frame, 21, 0, 2);
  // 踏みしめ: 足元（後ろ）の潰れた輪と砂の筋
  ring(frame, { ox: -16, radius: 6 + f * 3.5, width: 2.4 - k * 1.1, squash: 0.5, erosion: Math.min(0.9, k * 0.9), bright: 0.75 - k * 0.3, seed: 3132 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (6 + Math.floor(i / 2) * 6 + hash1(i, 3133) * 2);
      const x0 = -12 - f * 5 - hash1(i, 3134) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 14 - hash1(i, 3135) * 12, by: y + side * 2, bright: 0.45 * (1 - k) });
    }
  }
  for (const side of [-1, 1]) dust(frame, -10 - f * 2, side * (10 + f * 2), 4 + f * 1.4, Math.max(0, k * 1.1 - 0.1), 3136 + side);
}

// -----------------------------------------------------------------------------
// 反撃の狼煙（nova 半径 50 + 無敵と回復）: 丸盾を突き立て、厚い輪が全周へ。中心から狼煙の柱が立つ
// -----------------------------------------------------------------------------

/** 衝撃の輪の外縁（半径 50 論理 px × 2） */
const BEACON_R = 100;
const BEACON_N = 11;
const BEACON_A = 4;
/** 狼煙の柱の高さ（画面の上へ） */
const PILLAR_H = 110;

/** 狼煙の光の柱: 中心から画面の上へ細る柱。芯の細い線だけ白く、外は段 3〜5。erosion で下から千切れる */
function pillar(frame, h, w, erosion, bright, seed) {
  if (h < 2 || bright <= 0) return;
  paint(
    frame,
    (x, y) => {
      const t = -y / h;
      if (t < 0 || t > 1) return -1;
      const half = (w / 2) * (1 - t * 0.55);
      const q = Math.abs(x) / half;
      if (q > 1) return -1;
      if (!survives(x, y, erosion + t * 0.3, 1 - q, seed)) return -1;
      if (q < 0.18 && t < 0.8 && erosion < 0.3) return clamp01(bright * 1.02);
      return clamp01((q < 0.5 ? 0.6 : 0.4) * (1 - t * 0.35) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -w - 1, y0: -h - 2, x1: w + 1, y1: 2 }, dither: 0 },
  );
}

function beaconNova(frame, f) {
  const A = BEACON_A;
  const N = BEACON_N;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const R = 18 + (BEACON_R - 18) * p + k * 6;
  const W = 22 * (f < A ? 0.65 + 0.35 * p : 1 - 0.6 * k);
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  thickRing(frame, { R, W, erosion, bright: 1 - 0.25 * k, seed: 3201 });
  // 突き立てた丸盾: 最初の 2 枚だけ中心に（輪に押し出されて見えなくなる）
  if (f <= 1) roundShield(frame, 16 * (1 - f * 0.12), 1 - f * 0.2, f === 0);
  if (f === 0) sparkle(frame, 0, 0, 4);
  // 狼煙: 1 枚目から伸び、突き抜けて上へ千切れる
  if (f >= 1) {
    const rise = Math.min(1, f / 3);
    const fade = Math.max(0, (f - 4) / (N - 4));
    pillar(frame, PILLAR_H * rise * (1 + fade * 0.2), 18 - fade * 7, fade * 0.95, 0.95 - fade * 0.35, 3202);
    if (f === 3) sparkle(frame, 0, -PILLAR_H + 4, 4);
    // 狼煙の煙: 柱の周りを上へ流れる塊
    for (let i = 0; i < 6; i++) {
      const age = f - 1 - i * 0.6;
      if (age < 0) continue;
      const side = i % 2 === 0 ? -1 : 1;
      const y = -8 - age * 11 - i * 6;
      const x = side * (8 + age * 1.6 + hash1(i, 3203) * 4);
      dust(frame, x, y, 6 + age * 1.6, Math.max(0, age / 9), 3204 + i, 0.5);
    }
  }
  // 外縁の埃と放射の閃き（押し返す全周の圧）
  if (f >= A - 1) {
    const age = f - (A - 1);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + hash1(i, 3210) * 0.3;
      const rr = R + 3 + age * 2;
      dust(frame, Math.cos(a) * rr, Math.sin(a) * rr, 5 + age * 2 + hash1(i, 3211) * 2, Math.max(0, age / (N - A + 1) - 0.05), 3212 + i);
    }
    shards(frame, age, 28, 3230, (i, rnd) => {
      const a = rnd(1) * TAU;
      const s = 4 + rnd(2) * 4;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
  if (f === A - 1 || f === A) burstLines(frame, 0, 0, 18, R + 3, f === A - 1 ? 16 : 10, 0, TAU, f === A - 1 ? 0.95 : 0.6, 3240);
}

/** 狼煙の地面: 盾を突き立てた所から全周へ走るひびと、衝撃の輪の跡の薄い輪 */
function beaconGround(frame, f) {
  const grow = Math.min(1, (f + 1) / BEACON_A);
  const k = f < 6 ? 0 : (f - 5) / (BEACON_N - 6);
  cracks(frame, { n: 12, len: 60, grow, fade: Math.max(0, k * 1.1 - 0.05), seed: 3250, r0: 10 });
  ring(frame, { radius: (BEACON_R - 4) * (0.5 + 0.5 * grow), width: 2, erosion: k * 0.9, bright: 0.38 * (1 - k * 0.4), seed: 3251 });
  // 突き立てた跡の潰れた穴（地面の窪み）
  ring(frame, { radius: 12, width: 2.4, erosion: k * 0.9, bright: 0.34, seed: 3252 });
}

/**
 * 反撃の狼煙の発動: 丸盾を高く掲げる。盾の縁が燃え広がり、上へ細い光が一筋立って合図になる。
 * 周りから火の粉が盾へ吸い込まれる
 */
function beaconCast(frame, f) {
  const lift = Math.min(1, (f + 1) / 3);
  const r = 13 + lift * 3;
  if (f < 6) roundShield(frame, r, 0.6 + 0.4 * lift - Math.max(0, f - 3) * 0.2, f === 2);
  if (f < 6) ring(frame, { radius: r + 2 + f * 0.5, width: 1.6, bright: 0.85 - f * 0.08, erosion: f >= 4 ? (f - 3) * 0.25 : 0, seed: 3301 });
  // 合図の一筋: 盾の上から画面の上へ（細く短い。本番の柱は一撃の絵）
  if (f >= 1 && f <= 5) {
    const h = 40 * Math.min(1, f / 2);
    streakLine(frame, { ax: 0, ay: -r - 2 - h, bx: 0, by: -r - 2, width: f <= 2 ? 1.8 : 1.3, bright: 0.95 - Math.max(0, f - 2) * 0.18 });
    if (f === 2) sparkle(frame, 0, -r - 2 - h, 3);
  }
  // 吸い込まれる火の粉（外から盾へ）
  shards(frame, f, 12, 3302, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r0 = 44 + rnd(2) * 12;
    const sp = 6 + rnd(3) * 2;
    return { x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, life: 5, size: 1, drag: 0.92 };
  });
}

/** 守りの障壁の半径（キャラ 48 ドットを包む） */
const WARD_R = 34;
const WARD_N = 12;

/**
 * 守りの障壁（buff: 無敵と回復）: 自分を六角の障壁が包む。面は段 2 の薄い膜、辺は段 4〜5、頂点に光点。
 * 張る → 脈打つ → 六つの面に割れて外へ砕ける。生命が戻る粒が足元から立ちのぼる
 */
function hexWard(frame, R, o) {
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const split = o.split ?? 0;
  const seed = o.seed ?? 3401;
  const apothem = R * Math.cos(Math.PI / 6);
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y, x);
      // 六つの面のどれか（頂点が上下に来る向き）
      const sector = Math.floor(((a + Math.PI / 2) / TAU) * 6 + 6) % 6;
      const mid = -Math.PI / 2 + ((sector + 0.5) / 6) * TAU;
      // 割れた面は中心から外へずらす
      const sx = x - Math.cos(mid) * split;
      const sy = y - Math.sin(mid) * split;
      const along = sx * Math.cos(mid) + sy * Math.sin(mid);
      if (along > apothem || along < 0) return -1;
      const across = -sx * Math.sin(mid) + sy * Math.cos(mid);
      if (Math.abs(across) > along * Math.tan(Math.PI / 6)) return -1;
      const d = apothem - along;
      const q = Math.min(1, d / 5);
      if (!survives(x, y, erosion, 1 - q, seed + sector)) return -1;
      // 辺（外縁）は明るく、膜は薄い。割れたあとの面の継ぎ目（放射の辺）も縁取る
      const seamD = along * Math.tan(Math.PI / 6) - Math.abs(across);
      if (d < 1.6) return clamp01(0.7 * bright);
      if (split > 0 && seamD < 1.2) return clamp01(0.5 * bright);
      if (d < 3.4) return clamp01(0.4 * bright);
      // 膜は塗らない（面を塗ると塊に見える）。頂点から中心へ向かう細く暗い稜線だけで六角の面を感じさせる
      if (seamD < 0.9 && along > apothem * 0.45) return clamp01(0.26 * bright * (1 - erosion * 0.4));
      return -1;
    },
    { bounds: { x0: -R - split - 2, y0: -R - split - 2, x1: R + split + 2, y1: R + split + 2 }, dither: 0 },
  );
}

function beaconWard(frame, f) {
  const N = WARD_N;
  const form = Math.min(1, (f + 1) / 3);
  const breakAt = 8;
  if (f < breakAt) {
    const pulse = f >= 3 ? 0.5 + 0.5 * Math.cos(((f - 3) / 4) * TAU) : 1;
    hexWard(frame, WARD_R * (0.7 + 0.3 * form) + pulse * 1.5, { bright: 0.75 + 0.25 * form * pulse, seed: 3401 });
    // 頂点の光点: 張った瞬間は全頂点、脈のあいだは 2 つずつ巡る
    for (let i = 0; i < 6; i++) {
      if (f >= 3 && (i + f) % 3 !== 0) continue;
      const a = -Math.PI / 2 + (i / 6) * TAU;
      const rr = WARD_R * (0.7 + 0.3 * form);
      sparkle(frame, Math.cos(a) * rr, Math.sin(a) * rr, f === 2 ? 3 : 2);
    }
  } else {
    const k = (f - breakAt + 1) / (N - breakAt);
    hexWard(frame, WARD_R, { split: 3 + k * 10, erosion: 0.2 + 0.75 * k, bright: 0.9 - 0.3 * k, seed: 3402 });
    shards(frame, f - breakAt, 18, 3403, (i, rnd) => {
      const a = rnd(1) * TAU;
      const s = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * WARD_R * 0.85, y: Math.sin(a) * WARD_R * 0.85, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3, size: rnd(3) > 0.5 ? 2 : 1, drag: 0.85 };
    });
  }
  // 生命が戻る粒: 足元から上へ（障壁の内と外）
  for (let i = 0; i < 12; i++) {
    const t0 = hash1(i, 3410) * 5;
    const age = f - t0;
    if (age < 0 || age > 6) continue;
    const x = (hash1(i, 3411) - 0.5) * 56;
    const y = 18 - age * 7;
    dot(frame, x, y, Math.max(2, Math.round(5 - age * 0.5)));
    if (age < 3) dot(frame, x, y + 1.2, 3);
  }
}

// -----------------------------------------------------------------------------
// 鉄壁（持続）: 6 枚の小盾が周りへ飛んできて並び、持続中は自分の周りをゆっくり巡る
// dirs 1（纏いは向きなしで描かれる）: 正面の守りだが絵は全周に置く
// -----------------------------------------------------------------------------

/** 巡る小盾の数と、巡る円の半径（横 / 縦。上から見た少し潰れた輪） */
const WALL_COUNT = 6;
const WALL_RX = 40;
const WALL_RY = 34;
/** 小盾の大きさ（半分の幅・厚み・反り） */
const WALL_H = 13;
const WALL_T = 10;
const WALL_BULGE = 4.5;
/** 足元の輪の中心の高さ */
const FEET_Y = 16;
const WALL_LOOP_N = 12;

/** 小盾を 1 枚、周回の角 a に外向きに置く */
function wallPlate(frame, a, scale, o) {
  const cx = Math.cos(a) * WALL_RX * scale;
  const cy = Math.sin(a) * WALL_RY * scale;
  const dir = Math.atan2(cy / WALL_RY, cx / WALL_RX);
  plate(frame, { cx, cy, dir, H: WALL_H, T: WALL_T, bulge: WALL_BULGE, edge: 1.3, edgeReach: 0.7, ...o });
  // 中央の鋲（盾の芯）: 細い弧ではなく 1 枚の盾に見せる
  if ((o.erosion ?? 0) < 0.4) {
    const bx = cx - Math.cos(dir) * WALL_T * 0.55;
    const by = cy - Math.sin(dir) * WALL_T * 0.55;
    dot(frame, bx, by, 6);
    dot(frame, bx + 1, by, 5);
    dot(frame, bx, by + 1, 5);
  }
}

/** 鉄壁の発動: 外から 6 枚の小盾が飛んできて輪に並び、噛み合った瞬間に全部の縁が閃いて足元が揺れる */
function ironWallCast(frame, f) {
  const N = 10;
  const arrive = 3;
  const turn0 = -Math.PI / 2;
  for (let i = 0; i < WALL_COUNT; i++) {
    const a = turn0 + (i / WALL_COUNT) * TAU;
    if (f < arrive) {
      // 飛んでくる板: 外から内へ、後ろに短い速度線
      const p = easeSwing((f + 1) / arrive);
      const scale = 2.1 - 1.1 * p;
      wallPlate(frame, a, scale, { bright: 0.7 + 0.3 * p, body: 0.8, seed: 3501 + i });
      const cx = Math.cos(a) * WALL_RX * scale;
      const cy = Math.sin(a) * WALL_RY * scale;
      const ux = Math.cos(a);
      const uy = Math.sin(a) * (WALL_RY / WALL_RX);
      const tail = 12 * (1 - p * 0.5);
      streakLine(frame, { ax: cx + ux * (4 + tail), ay: cy + uy * (4 + tail), bx: cx + ux * 3, by: cy + uy * 3, width: 1.3, bright: 0.5 });
      continue;
    }
    const k = (f - arrive) / (N - arrive);
    wallPlate(frame, a, 1, { bright: f === arrive ? 1.05 : 1 - 0.35 * k, edge: f === arrive ? 2 : 1.3, erosion: f >= 7 ? (f - 6) * 0.22 : 0, seed: 3511 + i });
    if (f === arrive || f === arrive + 1) sparkle(frame, Math.cos(a) * (WALL_RX + 1), Math.sin(a) * (WALL_RY + 1), f === arrive ? 3 : 2);
  }
  if (f >= arrive) {
    const age = f - arrive;
    // 噛み合った衝撃: 足元の潰れた輪が外へ
    ring(frame, { oy: FEET_Y, radius: 16 + age * 7, width: 2.8 - age * 0.3, squash: 2, erosion: Math.min(0.92, age * 0.15), bright: 0.8 - age * 0.08, seed: 3520 });
    shards(frame, age, 16, 3521, (i, rnd) => {
      const a = rnd(1) * TAU;
      const s = 2.5 + rnd(2) * 3;
      return { x: Math.cos(a) * WALL_RX, y: Math.sin(a) * WALL_RY, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
}

/**
 * 鉄壁の纏い（持続中ずっと）: 6 枚の小盾が 1 巡で 1/6 周だけ回る（6 回対称なので継ぎ目が出ない）。
 * 板は暗めに抑えてキャラを隠さず、縁の光が 1 枚ずつ順に走る。板の間を細い鎖の弧がつなぐ
 */
function ironWallSustain(frame, f) {
  const cycle = f / WALL_LOOP_N;
  const turn = -Math.PI / 2 + (cycle / WALL_COUNT) * TAU;
  const lit = Math.floor(cycle * WALL_COUNT);
  for (let i = 0; i < WALL_COUNT; i++) {
    const a = turn + (i / WALL_COUNT) * TAU;
    // 奥（画面の上）の板は一段暗く（キャラの後ろにある感じ）
    const back = Math.sin(a) < -0.3 ? 0.78 : 1;
    const glow = (i + WALL_COUNT - lit) % WALL_COUNT === 0;
    wallPlate(frame, a, 1, { bright: back * (glow ? 0.95 : 0.72), body: 0.75, edge: glow ? 1.6 : 1, edgeReach: glow ? 0.8 : 0.45, seed: 3601 + i });
  }
  // 縁の光点: 光る板の前縁の中央（1 巡に 1 周ぶん順に走る）
  if (f % 2 === 0) {
    const a = turn + (lit / WALL_COUNT) * TAU;
    sparkle(frame, Math.cos(a) * (WALL_RX + 1), Math.sin(a) * (WALL_RY + 1), 2);
  }
  // 板の間の鎖（細く暗い短い弧の点線）
  for (let i = 0; i < WALL_COUNT; i++) {
    const a = turn + ((i + 0.5) / WALL_COUNT) * TAU;
    for (let j = -1; j <= 1; j++) {
      const b = a + j * 0.07;
      dot(frame, Math.cos(b) * (WALL_RX - 4), Math.sin(b) * (WALL_RY - 4), 3);
    }
  }
}

/** 鉄壁の足元: 潰れた輪と、小盾と一緒に巡る 6 つの鋲。脈打たず重く据わる */
function ironWallGround(frame, f) {
  const cycle = f / WALL_LOOP_N;
  const turn = -Math.PI / 2 + (cycle / WALL_COUNT) * TAU;
  ring(frame, { oy: FEET_Y, radius: 16, width: 2.4, squash: 2.2, bright: 0.42, seed: 3620 });
  ring(frame, { oy: FEET_Y, radius: 11, width: 1.2, squash: 2.2, bright: 0.3, seed: 3621 });
  for (let i = 0; i < WALL_COUNT; i++) {
    const a = turn + (i / WALL_COUNT) * TAU;
    const x = Math.cos(a) * 21 * 2.2;
    const y = FEET_Y + Math.sin(a) * 21;
    dot(frame, x, y, 4);
    dot(frame, x + 1, y, 3);
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 城門崩しの base は振りの reach、狼煙の base は周囲攻撃の半径。狼煙の行為 1（buff）は自分の位置に障壁を出す（拡縮しない）
 */
const FX = {
  moveset: "shield",
  ultimates: {
    "shield.siegeBreaker": {
      ramp: "light",
      cast: { sheet: "shieldUlt.siegeBreakerCast", life: 0.32 },
      acts: [{ sheet: "shieldUlt.siegeBreaker", life: 0.55, base: GATE_R / 2, pivot: "pos", ground: "shieldUlt.siegeBreakerGround" }],
    },
    "shield.beacon": {
      ramp: "light",
      cast: { sheet: "shieldUlt.beaconCast", life: 0.32 },
      acts: [
        { sheet: "shieldUlt.beacon", life: 0.6, base: BEACON_R / 2, pivot: "pos", ground: "shieldUlt.beaconGround" },
        { sheet: "shieldUlt.beaconWard", life: 1, base: 0, pivot: "pos" },
      ],
    },
    "shield.ironWall": {
      ramp: "light",
      cast: { sheet: "shieldUlt.ironWallCast", life: 0.45 },
      sustain: { sheet: "shieldUlt.ironWall", period: 1.2, ground: "shieldUlt.ironWallGround" },
    },
  },
};

export const ATLAS = {
  key: "shieldUlt",
  fx: FX,
  sheets: [
    { key: "shieldUlt.siegeBreaker", dirs: DIRS, frames: GATE_N, active: GATE_A, size: 2 * (GATE_R + 44), draw: siegeBreaker },
    { key: "shieldUlt.siegeBreakerGround", dirs: DIRS, frames: GATE_N, active: GATE_A, size: 2 * (GATE_R + 16), draw: siegeBreakerGround },
    { key: "shieldUlt.siegeBreakerCast", dirs: DIRS, frames: 8, active: 0, size: 128, draw: siegeBreakerCast },
    { key: "shieldUlt.beacon", dirs: 1, frames: BEACON_N, active: BEACON_A, size: 2 * (BEACON_R + 36), draw: beaconNova },
    { key: "shieldUlt.beaconGround", dirs: 1, frames: BEACON_N, active: BEACON_A, size: 2 * (BEACON_R + 10), draw: beaconGround },
    { key: "shieldUlt.beaconCast", dirs: 1, frames: 6, active: 0, size: 136, draw: beaconCast },
    { key: "shieldUlt.beaconWard", dirs: 1, frames: WARD_N, active: 0, size: 2 * (WARD_R + 22), draw: beaconWard },
    { key: "shieldUlt.ironWallCast", dirs: 1, frames: 10, active: 0, size: 2 * (WALL_RX * 2.1 + 34), draw: ironWallCast },
    { key: "shieldUlt.ironWall", dirs: 1, frames: WALL_LOOP_N, active: 0, size: 2 * (WALL_RX + 12), draw: ironWallSustain },
    { key: "shieldUlt.ironWallGround", dirs: 1, frames: WALL_LOOP_N, active: 0, size: 108, draw: ironWallGround },
  ],
};
