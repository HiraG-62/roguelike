// 盾（moveset "shield"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/shield.json）× 2 が目安
//
// 盾は刃ではなく「面」で押し殴る。剣の三日月（先端が尖って尾が流れる）とは逆に、
// 端まで厚みの揃った平たい弓なりの板が前へ押し出され、前縁だけが白く光る。当たりは横へ広がる衝撃の波と金属の火花。
// 本体は段を 3 枚の平たい帯に量子化して、グラデーションではなく「硬い板」に見せる
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 形の部品（盾専用）
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え方。板は角から欠けるよう nearCore を渡す） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 盾の面（弓なりの平たい板）。前縁の頂点 (cx, cy)、向き dir（ラジアン、前縁が向く側）。
 * H = 半分の幅（横）、T = 厚み、bulge = 弓なりの深さ（端ほど後ろへ下がる＝前へふくらむ）。
 * 端まで厚みを保ち角だけ丸める（三日月のように尖らせない）。前縁 edge ドットが白い縁、背は暗い縁
 */
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
      // 前縁の白い縁（両端は色の帯に溶かす）
      if (depth < edge && as < edgeReach && erosion < 0.55) return clamp01(0.84 + 0.2 * bright);
      // 平たい帯: 明部 → 本体 → 暗い背の縁。端へ向かって一段落とす
      let v0 = q < 0.3 ? 0.7 : q < 0.68 ? 0.52 : q < 0.86 ? 0.37 : 0.2;
      if (as > 0.8) v0 -= 0.12;
      return clamp01(v0 * body * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0 },
  );
}

/**
 * 厚い衝撃の輪（外縁が白く、内側へ向かって薄れる）。円の攻撃（盾叩き・城壁・盾落とし）の本体
 */
function thickRing(frame, o) {
  const { R, W } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 21;
  paint(
    frame,
    (x, y) => {
      const d = R - Math.hypot(x - ox, y - oy);
      if (d < 0 || d > W) return -1;
      const q = d / W;
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      if (d < 1.5 && erosion < 0.5) return clamp01(bright * 1.02);
      const v0 = q < 0.25 ? 0.66 : q < 0.55 ? 0.48 : q < 0.8 ? 0.34 : 0.2;
      return clamp01(v0 * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: ox - R - 2, y0: oy - R - 2, x1: ox + R + 2, y1: oy + R + 2 }, dither: 0 },
  );
}

/** 地面の埃（段 1〜3 の柔らかい塊）。r が広がり、age で薄れて欠ける */
function dust(frame, x, y, r, fade, seed) {
  if (fade >= 1 || r < 1) return;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      const n = valueNoise(px, py, 3, seed);
      if (n - d * 0.6 - fade * 0.7 < -0.05) return -1;
      return clamp01((0.3 - d * 0.12) * (1 - fade * 0.5));
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 }, samples: 2 },
  );
}

/**
 * 横へ広がる衝撃の波: 板の両端 (tx, ±ty) を中心に、外（±y）へ向かって開く短い弧。
 * 板の前に回り込ませない（前に弧を引くと、2 本目の板の輪郭に見えて二重線になる）
 */
function sideWaves(frame, tx, ty, radius, width, fade, seed, span = 0.75) {
  for (const side of [-1, 1]) {
    const cy = side * ty;
    const mid = side * (Math.PI / 2 + 0.15);
    paint(
      frame,
      (x, y) => {
        const dx = x - tx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        const d = Math.abs(r - radius);
        if (d > width / 2) return -1;
        let a = Math.atan2(dy, dx) - mid;
        if (a > Math.PI) a -= Math.PI * 2;
        if (a < -Math.PI) a += Math.PI * 2;
        const t = Math.abs(a) / span;
        if (t > 1) return -1;
        if (!survives(x, y, fade * 0.9, 1 - t, seed + side)) return -1;
        return clamp01((0.85 - 0.45 * t) * (1 - fade * 0.55) * (1 - (d / width) * 0.6));
      },
      { bounds: { x0: tx - radius - width, y0: cy - radius - width, x1: tx + radius + width, y1: cy + radius + width }, dither: 0 },
    );
  }
}

/** 金属の打撃の火花: 放射状の短い線（止まった瞬間の閃き）。a0..a1 の範囲に n 本 */
function burstLines(frame, x, y, n, r0, r1, a0, a1, bright, seed) {
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5 + (hash1(i, seed) - 0.5) * 0.6)) / n;
    const len = r1 * (0.55 + 0.45 * hash1(i, seed + 1));
    const w = i % 2 === 0 ? 1.4 : 1;
    streakLine(frame, { ax: x + Math.cos(a) * r0, ay: y + Math.sin(a) * r0, bx: x + Math.cos(a) * (r0 + len), by: y + Math.sin(a) * (r0 + len), width: w, bright });
  }
}

/** 火花の粒（金属片）: 原点 (x, y) から a0..a1 の向きへ */
function sparkSpray(frame, age, n, x, y, a0, a1, speed, seed, spreadY = 0) {
  shards(frame, age, n, seed, (i, rnd) => {
    const a = a0 + (a1 - a0) * rnd(1);
    const sp = speed * (0.55 + 0.9 * rnd(2));
    return { x, y: y + (rnd(3) - 0.5) * spreadY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.45 ? 2 : 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 押し出す面（左の段・ダッシュ・盾殴り・突進盾・盾押し・盾突き）の共通の時間割
// -----------------------------------------------------------------------------

/**
 * 盾の面が x0 → x1 へ押し出され、止まった瞬間に前縁が光り、両端から横へ衝撃が広がる。
 * 振り終わりは板が痩せて角から欠け、火花の粒が残る
 */
function push(frame, f, sp) {
  const { A, N } = sp;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const x = sp.x0 + (sp.x1 - sp.x0) * p + k * (sp.drift ?? 3);
  const T = sp.T * (f < A ? 0.75 + 0.25 * p : 1 - 0.5 * k);
  const H = sp.H * (f < A ? 0.82 + 0.18 * p : 1 + 0.06 * k);
  const erosion = k > 0 ? 0.04 + 0.85 * Math.pow(k, 1.2) : 0;
  const tilt = sp.tilt ?? 0;
  // 速度線: 板の背から後ろへ（押し出す速さ）。板の外へはみ出さない高さに並べる
  if (k < 0.7) {
    for (let i = 0; i < sp.lines; i++) {
      const y = (i / Math.max(1, sp.lines - 1) - 0.5) * 2 * H * 0.75 + (hash1(i, sp.seed + 3) - 0.5) * 4;
      const back = x - sp.bulge * (y / H) ** 2 - T - 2 - hash1(i, sp.seed + 4) * 9 - k * 10;
      const len = (sp.lineLen ?? 18) * (0.6 + 0.6 * hash1(i, sp.seed + 5)) * (1 - k);
      streakLine(frame, { ax: back - len, ay: y + Math.sin(tilt) * 0, bx: back, by: y, bright: 0.5 * (1 - k) });
    }
  }
  plate(frame, { cx: x, cy: 0, dir: tilt, H, T, bulge: sp.bulge, edge: sp.edge ?? 1.6, erosion, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.25 * k, seed: sp.seed, body: sp.body ?? 1 });
  if (f === A - 1) sparkle(frame, x + 1, 0, sp.glint ?? 3);
  if (f === A) sparkle(frame, x + 1 + (sp.drift ?? 3) * 0.3, 0, (sp.glint ?? 3) - 1);
  if (f >= A - 1) {
    const age = f - (A - 1);
    const ageK = age / (N - A + 1);
    if (sp.waves && ageK < 1) sideWaves(frame, x - sp.bulge - T * 0.3, H * 0.92, 4 + age * sp.waves, sp.waveW ?? 2.4, ageK, sp.seed + 20);
    sparkSpray(frame, age, sp.sparks, x + 1, 0, -1.3, 1.3, sp.sparkSpeed ?? 4, sp.seed + 30, H * 1.4);
    if (sp.dust) {
      for (const side of [-1, 1]) dust(frame, x - sp.bulge - T - 4 - age * 2, side * (H * 0.8 + age * 2), 5 + age * 2.2 * sp.dust, Math.max(0, ageK * 1.1 - 0.1), sp.seed + 40 + side);
    }
  }
  if (sp.extra) sp.extra(frame, f, { x, H, T, k, p });
}

/** 左 1 段: box reach 14 / size 26。素直に真正面へ押す板 */
const L1 = { A: 3, N: 7, x0: 6, x1: 30, H: 26, T: 11, bulge: 7, lines: 4, sparks: 6, waves: 4, seed: 1101 };
/** 左 2 段: 返しの押し。板を傾けて斜めに押し込む（奇数段は描画側で上下反転） */
const L2 = { A: 3, N: 7, x0: 4, x1: 30, H: 27, T: 11, bulge: 8, tilt: 0.24, lines: 4, sparks: 7, waves: 4, seed: 1202 };
/** 左 3 段: size 28。厚く深く反った板を振り抜き、両端から埃 */
const L3 = { A: 3, N: 8, x0: 4, x1: 31, H: 29, T: 13, bulge: 10, tilt: -0.14, lines: 5, sparks: 8, waves: 4.5, dust: 0.6, seed: 1303 };
/** 左 4 段（重い終撃）: box reach 16 / size 30。最大の板・横の衝撃が大きく、埃が舞い、地面を打つ放射の線 */
const L4 = {
  A: 4,
  N: 9,
  x0: 2,
  x1: 36,
  H: 36,
  T: 16,
  bulge: 12,
  edge: 2.4,
  lines: 6,
  lineLen: 24,
  sparks: 14,
  sparkSpeed: 5,
  waves: 6,
  waveW: 3.2,
  dust: 1,
  glint: 4,
  seed: 1404,
  extra: (frame, f, s) => {
    if (f === 3 || f === 4) burstLines(frame, s.x + 2, 0, 7, 6, f === 3 ? 20 : 14, -1.1, 1.1, 0.9 - (f - 3) * 0.25, 1410);
  },
};

/** ダッシュ攻撃: box size 28。駆け込みながら構えた板で撥ねる。板の上下を後ろへ流れる長い速度線 */
const DASH = {
  A: 3,
  N: 8,
  x0: 12,
  x1: 30,
  H: 28,
  T: 10,
  bulge: 9,
  lines: 3,
  lineLen: 12,
  sparks: 8,
  waves: 4,
  dust: 0.7,
  seed: 1505,
  extra: (frame, f, s) => {
    if (s.k >= 0.8) return;
    // 板の外（上下）を後ろへ流れる速度線の束
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (s.H + 3 + Math.floor(i / 2) * 4 + hash1(i, 1506) * 2);
      const x1 = s.x - 12 - hash1(i, 1507) * 8 - s.k * 24;
      const len = 30 + 26 * hash1(i, 1508);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.55 * (1 - s.k) });
    }
  },
};

/** 派生: 盾殴り（box size 28・重い）。小さく厚い板を短く鋭く打ち込み、前縁から火花が放射に弾ける */
const PUNCH = {
  A: 2,
  N: 7,
  x0: 12,
  x1: 30,
  H: 20,
  T: 15,
  bulge: 5,
  lines: 3,
  lineLen: 14,
  sparks: 12,
  sparkSpeed: 5,
  waves: 3,
  waveW: 2,
  drift: 1,
  glint: 4,
  seed: 1606,
  extra: (frame, f, s) => {
    if (f >= 1 && f <= 3) burstLines(frame, s.x + 3, 0, 9, 5 + (f - 1) * 5, 22 - (f - 1) * 5, -1.25, 1.25, 1 - (f - 1) * 0.25, 1610);
  },
};

/** 派生: 突進盾（box size 28・踏み込み 30）。構えた板が長い距離を走ってくる（移動は本体が運ぶ）。板の背から非常に長い速度線の束 */
const RUSH = {
  A: 3,
  N: 8,
  x0: 16,
  x1: 30,
  H: 28,
  T: 12,
  bulge: 9,
  lines: 9,
  lineLen: 70,
  sparks: 10,
  sparkSpeed: 4.5,
  waves: 5,
  dust: 0.8,
  drift: 5,
  seed: 1707,
};

/**
 * 盾押し（構えを解いての反撃）: box size 28・踏み込み 26。
 * 最初の 2 枚は構えた板の縁だけが白く燃える（溜めた受け）→ 一気に前へ弾ける。弾ける瞬間に前縁から放射の閃き
 */
const RELEASE_A = 5;
const RELEASE_N = 10;
function release(frame, f) {
  if (f < 2) {
    // 縁だけが光る構えの板（本体は暗く、縁の白が広がる）
    plate(frame, { cx: 12, cy: 0, H: 26, T: 12, bulge: 9, edge: 1.6 + f * 1.4, edgeReach: 0.55 + f * 0.4, body: 0.5, seed: 1801 });
    sparkle(frame, 13, 0, 2 + f);
    // 縁を走る光: 2 枚目で板の両端にも閃き（縁全体が張り詰めた合図）
    if (f === 1) for (const side of [-1, 1]) sparkle(frame, 12 - 9 * 0.75, side * 26 * 0.85, 2);
    return;
  }
  push(frame, f - 2, {
    A: RELEASE_A - 2,
    N: RELEASE_N - 2,
    x0: 14,
    x1: 36,
    H: 30,
    T: 12,
    bulge: 11,
    lines: 5,
    lineLen: 26,
    sparks: 14,
    sparkSpeed: 5,
    waves: 6,
    waveW: 3,
    dust: 0.8,
    glint: 4,
    seed: 1808,
    extra: (fr, g, s) => {
      if (g === 1 || g === 2) burstLines(fr, s.x + 2, 0, 8, 4 + (g - 1) * 6, 24 - (g - 1) * 8, -1.2, 1.2, 1 - (g - 1) * 0.3, 1810);
    },
  });
}

/** 右: 盾突き（thrust reach 26 / size 14）。細身の板を長く突き出す。板の両脇に細い速度線、前に潰れた空気の輪 */
const THRUST = {
  A: 3,
  N: 7,
  x0: 10,
  x1: 54,
  H: 15,
  T: 9,
  bulge: 5,
  lines: 3,
  lineLen: 24,
  sparks: 6,
  waves: 3,
  waveW: 2,
  seed: 1909,
  extra: (frame, f, s) => {
    if (s.k < 0.85) {
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const y = side * (s.H + 3 + Math.floor(i / 2) * 3);
        const x1 = s.x - 6 - hash1(i, 1910) * 8 - s.k * 18;
        const len = 26 + 20 * hash1(i, 1911);
        streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - s.k) });
      }
    }
  },
};

// -----------------------------------------------------------------------------
// 全周の衝撃（盾叩き・城壁・盾落とし）と上からの押し潰し
// -----------------------------------------------------------------------------

/** 丸盾の面（上から見た円い盾）。縁が白く、中央に鋲。盾落とし・盾叩きの中心に置く */
function roundShield(frame, r, bright, seed) {
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
  if (seed) sparkle(frame, -r * 0.35, -r * 0.35, 2);
}

/**
 * 全周の衝撃の時間割。中心の盾の閃き → 厚い輪が R まで広がり → 外縁の埃と、外向きの放射の火花 → 輪が痩せて欠ける
 */
function shockwave(frame, f, sp) {
  const { A, N, R } = sp;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const radius = sp.r0 + (R - sp.r0) * p + k * 3;
  const W = sp.W * (f < A ? 0.7 + 0.3 * p : 1 - 0.6 * k);
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  thickRing(frame, { R: radius, W, erosion, bright: 1 - 0.25 * k, seed: sp.seed });
  if (sp.center && f <= 1) roundShield(frame, sp.center * (1 - f * 0.15), 1 - f * 0.2, f === 0 ? 1 : 0);
  if (f === 0) sparkle(frame, 0, 0, 4);
  // 外縁に並ぶ埃: 輪に押されて外へ
  if (f >= A - 1 && sp.dust) {
    const age = f - (A - 1);
    const n = sp.dust;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash1(i, sp.seed + 1) * 0.5;
      const rr = radius + 2 + age * 1.5;
      dust(frame, Math.cos(a) * rr, Math.sin(a) * rr, 4 + age * 1.8 + hash1(i, sp.seed + 2) * 2, Math.max(0, age / (N - A + 1) - 0.05), sp.seed + 10 + i);
    }
  }
  if (f === A - 1 || f === A) burstLines(frame, 0, 0, sp.bursts ?? 12, radius + 2, f === A - 1 ? 12 : 8, 0, Math.PI * 2, f === A - 1 ? 0.95 : 0.6, sp.seed + 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), sp.sparks ?? 14, sp.seed + 4, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const s = 3 + rnd(2) * 3.5;
      return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
  if (sp.extra) sp.extra(frame, f, { radius, k, p });
}

/** 右: 盾叩き（circle size 44 = 半径 44 ドット）。盾で地面を叩き、厚い輪が全周へ */
const BASH = { A: 3, N: 8, R: 44, r0: 12, W: 13, center: 11, dust: 10, bursts: 12, sparks: 14, seed: 2101 };

/** 地面のひび: 中心から放射に伸びる暗い折れ線（段 2〜3）。盾落とし・押し潰しで「重さ」を残す */
function cracks(frame, n, len, grow, fade, seed, cx = 0, cy = 0) {
  if (fade >= 1) return;
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + hash1(i, seed) * 0.6;
    let x = cx + Math.cos(a) * 5;
    let y = cy + Math.sin(a) * 5;
    const segs = 3;
    const total = len * (0.6 + 0.4 * hash1(i, seed + 1)) * grow;
    for (let j = 0; j < segs; j++) {
      a += (hash1(i * 7 + j, seed + 2) - 0.5) * 0.7;
      const nx = x + (Math.cos(a) * total) / segs;
      const ny = y + (Math.sin(a) * total) / segs;
      if (hash1(i * 7 + j, seed + 3) > 1 - fade) break;
      streakLine(frame, { ax: nx, ay: ny, bx: x, by: y, width: j === 0 ? 1.6 : 1.1, bright: 0.34 });
      x = nx;
      y = ny;
    }
  }
}

/** 派生: 盾落とし（circle reach 10 / size 48・当たりの中心）。上から盾が落ちて地面が割れ、厚い輪と濃い埃 */
function drop(frame, f) {
  const N = 9;
  if (f === 0) {
    // 落ちてくる盾: 大きく暗い（まだ宙にある）
    roundShield(frame, 20, 0.7, 0);
    return;
  }
  const g = f - 1;
  shockwave(frame, g, {
    A: 3,
    N: N - 1,
    R: 48,
    r0: 14,
    W: 16,
    center: 13,
    dust: 12,
    bursts: 14,
    sparks: 16,
    seed: 2202,
    extra: (fr, h, s) => cracks(fr, 7, 34, Math.min(1, (h + 1) / 2), Math.max(0, s.k * 1.2 - 0.2), 2210),
  });
}

/**
 * 派生: 城壁（circle size 52）。8 枚の盾の面が外向きに並んで全周へ押し出される（壁が立つ）。
 * 板どうしの継ぎ目が見えるように少し隙間を空ける
 */
function rampart(frame, f) {
  const A = 4;
  const N = 9;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const R = 18 + (50 - 18) * p + k * 3;
  const n = 8;
  const H = R * Math.sin(Math.PI / n) * 0.86;
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  const T = 11 * (f < A ? 0.75 + 0.25 * p : 1 - 0.5 * k);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    plate(frame, { cx: Math.cos(a) * R, cy: Math.sin(a) * R, dir: a, H, T: T * 1.25, bulge: H * 0.22, erosion, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.25 * k, seed: 2301 + i });
  }
  if (f === 0) {
    roundShield(frame, 11, 1, 1);
    sparkle(frame, 0, 0, 4);
  }
  if (f === A - 1 || f === A) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      sparkle(frame, Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), f === A - 1 ? 3 : 2);
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 継ぎ目（板の間）から噴く埃と、外へ飛ぶ火花
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = R - 4 + age * 1.5;
      dust(frame, Math.cos(a) * rr, Math.sin(a) * rr, 4 + age * 1.8, Math.max(0, age / (N - A + 1) - 0.05), 2320 + i);
    }
    shards(frame, age, 16, 2330, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const s = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
}

/** 押し潰しの面（上から見た角の丸い四角い盾の面）。前後 D・左右 L の半分。縁が白く、中央に十字の補強 */
function slab(frame, o) {
  const { D, L } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const rim = o.rim ?? 1.8;
  const seed = o.seed ?? 31;
  const rc = Math.min(D, L) * 0.35;
  paint(
    frame,
    (x, y) => {
      // 角の丸い四角の内側までの距離（負 = 内側）
      const qx = Math.abs(x) - (D - rc);
      const qy = Math.abs(y) - (L - rc);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
      if (out > 0) return -1;
      const d = -out;
      // 崩れは内側から（縁の枠が最後まで残り、割れた盾の枠に見える）
      if (!survives(x, y, erosion, 1 - Math.min(1, d / 6), seed)) return -1;
      if (d < rim && erosion < 0.55) return clamp01(bright * 1.02);
      if (d < rim + 2.5) return clamp01(0.62 * bright * (1 - erosion * 0.4));
      // 十字の補強（鉄の帯）
      if (Math.abs(x) < 2.5 || Math.abs(y) < 2.5) return clamp01(0.5 * bright * (1 - erosion * 0.4));
      return clamp01((d < rim + 5 ? 0.22 : 0.34) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -D - 1, y0: -L - 1, x1: D + 1, y1: L + 1 }, dither: 0 },
  );
}

/** 押し潰しの衝撃: 面と同じ角の丸い四角の輪が四辺から外へ（丸い輪にすると面を回る 2 本目の線に見える） */
function slabWave(frame, D, L, width, erosion, bright, seed) {
  const rc = Math.min(D, L) * 0.45;
  paint(
    frame,
    (x, y) => {
      const qx = Math.abs(x) - (D - rc);
      const qy = Math.abs(y) - (L - rc);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
      if (Math.abs(out) > width / 2) return -1;
      const q = Math.abs(out) / (width / 2);
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -D - width - 1, y0: -L - width - 1, x1: D + width + 1, y1: L + width + 1 }, dither: 0 },
  );
}

/**
 * 右: 押し潰し（box reach 16 / size 30・当たりの中心）。
 * 大きく暗い面が上から落ちてきて（縮みながら明るく）、着地で縁が光り、四辺から衝撃が広がる。地面にひびと埃
 */
function crush(frame, f) {
  const A = 4;
  const N = 10;
  const D = 22;
  const L = 28;
  if (f < 2) {
    // 落下中: 大きく（近く）暗い → 着地寸前
    const s = f === 0 ? 1.35 : 1.12;
    slab(frame, { D: D * s, L: L * s, bright: f === 0 ? 0.6 : 0.8, rim: 1.4, seed: 2401 });
    return;
  }
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const erosion = k > 0 ? 0.15 + 0.85 * Math.pow(k, 0.9) : 0;
  slab(frame, { D, L, erosion, bright: 1 - 0.3 * k, seed: 2402 });
  if (f === 2) sparkle(frame, 0, 0, 4);
  const age = f - 2;
  // 四辺から外へ押し出される衝撃（角の丸い四角の輪）
  if (age <= 5) slabWave(frame, D + 3 + age * 5, L + 3 + age * 5, 3.2 - age * 0.3, Math.min(0.92, age * 0.16), 0.9 - age * 0.08, 2403);
  cracks(frame, 8, 26, 1, Math.max(0, k * 1.2 - 0.15), 2410);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const rx = Math.cos(a) * (D + 4 + age * 2.2);
    const ry = Math.sin(a) * (L + 4 + age * 2.2);
    dust(frame, rx, ry, 4 + age * 1.8, Math.max(0, age / (N - 2) - 0.05), 2420 + i);
  }
  if (f === 2 || f === 3) burstLines(frame, 0, 0, 12, L + 3, f === 2 ? 14 : 9, 0, Math.PI * 2, f === 2 ? 0.9 : 0.6, 2430);
  shards(frame, age, 14, 2440, (i, rnd) => {
    const a = rnd(1) * Math.PI * 2;
    const s = 3 + rnd(2) * 3.5;
    return { x: Math.cos(a) * D, y: Math.sin(a) * L, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 命中（金属の打撃）
// -----------------------------------------------------------------------------

/**
 * 命中: 当たった面（+x に直交する平たい短い板の光）から、放射状の短い線と火花の粒が前と横へ。
 * heavy は大きな衝撃の輪と、倍の線
 */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f / (N - 1);
  const Hc = heavy ? 16 : 11;
  // 接触した面の閃き: +x に直交する短い平たい板（盾の面が当たった跡）
  if (f <= 2) plate(frame, { cx: 2, cy: 0, H: Hc * (f === 0 ? 0.8 : 1), T: heavy ? 5 : 4, bulge: 2, bright: 1 - f * 0.15, erosion: f === 2 ? 0.3 : 0, seed: heavy ? 2501 : 2511 });
  if (f <= 2) {
    const n = heavy ? 12 : 8;
    const r1 = (heavy ? 22 : 15) * (f === 0 ? 0.7 : 1 - (f - 1) * 0.3);
    burstLines(frame, 3, 0, n, 3 + f * 3, r1, -1.4, 1.4, 1 - f * 0.25, heavy ? 2502 : 2512);
  }
  if (f <= 1) sparkle(frame, 3, 0, heavy ? 4 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 8 + age * 6, width: 3.4 - age * 0.35, erosion: Math.min(0.9, age * 0.17), bright: 0.85 - age * 0.08, seed: 2503 });
  }
  if (!heavy && f >= 1 && f <= 4) sideWaves(frame, 0, Hc * 0.9, 2 + f * 2.5, 2, k, 2513, 0.6);
  sparkSpray(frame, f, heavy ? 16 : 9, 3, 0, -1.5, 1.5, heavy ? 5 : 4, heavy ? 2504 : 2514, 4);
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 押し出す面は自分を原点（x0..x1 が box の奥行き 0..reach に対応）、全周・押し潰しは当たりの中心
 */
const FX = {
  moveset: "shield",
  motions: {
    "l:0": { sheet: "shield.l1", pivot: "self", base: 14, measure: "reach" },
    "l:1": { sheet: "shield.l2", pivot: "self", base: 14, measure: "reach" },
    "l:2": { sheet: "shield.l3", pivot: "self", base: 14, measure: "reach" },
    "l:3": { sheet: "shield.l4", pivot: "self", base: 16, measure: "reach" },
    dash: { sheet: "shield.dash", pivot: "self", base: 14, measure: "reach" },
    "r:shieldThrust": { sheet: "shield.thrust", pivot: "self", base: 26, measure: "reach" },
    "r:shieldBash": { sheet: "shield.bash", pivot: "anchor", base: 44, measure: "size" },
    "r:crush": { sheet: "shield.crush", pivot: "anchor", base: 30, measure: "size" },
    "branch:shieldDrop": { sheet: "shield.drop", pivot: "anchor", base: 48, measure: "size" },
    "branch:rampart": { sheet: "shield.rampart", pivot: "anchor", base: 52, measure: "size" },
    "branch:shieldPunch": { sheet: "shield.punch", pivot: "self", base: 14, measure: "reach" },
    "branch:shieldRush": { sheet: "shield.rush", pivot: "self", base: 14, measure: "reach" },
    "branch:guard.release": { sheet: "shield.release", pivot: "self", base: 14, measure: "reach" },
  },
  hit: "shield.hit",
  hitHeavy: "shield.hitHeavy",
};

function pushSheet(key, spec, size) {
  return { key, dirs: DIRS, frames: spec.N, active: spec.A, size, draw: (frame, f) => push(frame, f, spec) };
}

export const ATLAS = {
  key: "shield",
  fx: FX,
  sheets: [
    pushSheet("shield.l1", L1, 112),
    pushSheet("shield.l2", L2, 112),
    pushSheet("shield.l3", L3, 120),
    pushSheet("shield.l4", L4, 128),
    pushSheet("shield.dash", DASH, 160),
    pushSheet("shield.punch", PUNCH, 112),
    pushSheet("shield.rush", RUSH, 224),
    pushSheet("shield.thrust", THRUST, 160),
    { key: "shield.release", dirs: DIRS, frames: RELEASE_N, active: RELEASE_A, size: 128, draw: release },
    { key: "shield.bash", dirs: 1, frames: BASH.N, active: BASH.A, size: 128, draw: (frame, f) => shockwave(frame, f, BASH) },
    { key: "shield.drop", dirs: 1, frames: 9, active: 4, size: 136, draw: drop },
    { key: "shield.rampart", dirs: 1, frames: 9, active: 4, size: 144, draw: rampart },
    { key: "shield.crush", dirs: DIRS, frames: 10, active: 4, size: 112, draw: crush },
    { key: "shield.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "shield.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
