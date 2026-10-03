// 戦輪（moveset "ringBlades"。チャクラムを統合）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/ringBlades.json × 2 が目安
//
// 輪の舞の形の言葉は通常の振り（ringBlades.mjs）とそろえる: 斬線は「細い帯 + 外周ののこぎりの歯」、輪そのものは「穴の開いた歯車の輪」。
// 断頭輪・輪舞は滑らかな細い帯・後ろへ反った鉤刃の輪で描く。
// 投げた輪の本体は描画側（render/thrownLook.ts の ULTIMATE_LOOK）が戦輪の武器の絵を回して描くので、shots の fly は
// その下に重なる尾・残像・風の光だけにする（本体を描くと二重になる）
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い尾を持つ弾は 24 方向だと角が目立つ（fx-brief2 の弾の表） */
const BULLET_DIRS = 32;

// -----------------------------------------------------------------------------
// 形の部品（ringBlades.mjs から写して、歯の位相・巻きの向きを足したもの）
// -----------------------------------------------------------------------------

/** 角 a を基準 base から時計回りに測った [0, 2π) の距離 */
function cwFrom(base, a) {
  const d = (base - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 崩れの判定（ノイズ + 芯からの近さ）。縁から先に欠ける */
function keep(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4.5, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.25;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/** のこぎりの歯の高さ（1 周期の前 7 割が歯。先頭側で切り立つ） */
function toothHeight(L, pitch, tooth) {
  const t = (((L / pitch) % 1) + 1) % 1;
  if (t > 0.7) return 0;
  return tooth * Math.min(1, t / 0.45 + 0.3);
}

function toothFront(L, pitch) {
  const t = (((L / pitch) % 1) + 1) % 1;
  return t > 0.45;
}

function circleBounds(ox, oy, r) {
  return { x0: ox - r - 2, y0: oy - r - 2, x1: ox + r + 2, y1: oy + r + 2 };
}

/**
 * 刻みの付いた弧の帯（輪が通った軌跡）。ringBlades.mjs の toothedArc に phase（歯の送り。継ぎ目の無い回転のループ用）を足したもの。
 * head = 先頭の角、span = 尾までの長さ。外縁の外にのこぎりの歯、外縁の先頭寄りが白い刃の縁
 */
function toothedArc(frame, o) {
  const { R, T, head, span } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const tooth = o.tooth ?? 3;
  const pitch = o.pitch ?? 8;
  const phase = o.phase ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const full = span >= TAU - 1e-3;
  const edgeReach = o.edgeReach ?? 0.55;
  const cap = o.cap ?? 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + tooth + 0.5 || r < R - T - 0.5) return -1;
      const a = Math.atan2(dy, dx);
      const s = cwFrom(head, a);
      if (s > span) return -1;
      const u = full ? 0.25 : s / span;
      const taper = full ? 1 : Math.min(1, u / 0.05) * Math.pow(1 - u, 0.55);
      const w = T * taper;
      const L = a * R + phase;
      const th = toothHeight(L, pitch, tooth) * (full ? 1 : 1 - 0.6 * u) * Math.min(1, taper * 2);
      if (r > R) {
        if (r - R > th || th < 0.8) return -1;
        if (!keep(x, y, erosion, 0.2, seed + 3)) return -1;
        const front = toothFront(L, pitch) ? 0.22 : 0;
        return Math.min(cap, clamp01((0.62 + front) * (1 - 0.5 * u) * bright * (1 - erosion * 0.4)));
      }
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.4 && u < edgeReach && erosion < 0.45) return Math.min(cap, clamp01(bright * (1.05 - 0.35 * u)));
      return Math.min(cap, clamp01(Math.pow(1 - q, 1.1) * (0.9 - 0.5 * u) * bright * (1 - erosion * 0.45)));
    },
    { bounds: circleBounds(ox, oy, R + tooth + 1) },
  );
}

/**
 * 回転する輪（戦輪の本体の光）。穴を抜いた歯車の輪。明るい側が回転とともに回る。
 * hub を渡すと穴の中に細い十字の骨（大きな輪の奥義らしい作り込み）
 */
function wheel(frame, cx, cy, o) {
  const { r, rot } = o;
  const rw = o.rw ?? Math.max(2, r * 0.4);
  const n = o.teeth ?? 6;
  const th = o.tooth ?? Math.max(1.5, r * 0.35);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const hub = o.hub ?? false;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r + th + 0.5) return -1;
      const a = Math.atan2(dy, dx) - rot;
      if (d < r - rw) {
        // 穴の中の骨: 回転に合わせた 3 本の細い輻（中心の小さな円は抜く）
        if (!hub || d < 1.5) return -1;
        const spoke = Math.abs(Math.sin((a * 3) / 2));
        if (spoke * d > 0.7) return -1;
        return clamp01(0.45 * bright);
      }
      const t = ((((a / TAU) * n) % 1) + 1) % 1;
      if (d > r && d - r > th * t) return -1;
      if (!keep(x, y, erosion, 0.3, seed)) return -1;
      const lit = 0.5 + 0.5 * Math.cos(a + 0.8);
      if (d <= r && d > r - 1.2 && lit > 0.6) return clamp01(bright);
      // 本体は段 5 までに抑える（白は縁の細い線だけ。輪が白い塊に見えないように）
      const base = d > r ? 0.55 : 0.42 + 0.16 * ((r - d) / rw < 0.5 ? 1 : 0);
      return Math.min(0.74, clamp01((base + 0.25 * lit) * bright * (1 - erosion * 0.4)));
    },
    { bounds: circleBounds(cx, cy, r + th + 1), samples: 4 },
  );
}

/** 回転の火花: 円周上の点から接線（時計回り）へ飛ぶ */
function tangentSparks(frame, age, count, seed, o) {
  const { ox = 0, oy = 0, radius, from, to, speed = 4, out: outBase = 0.15 } = o;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = from + (to - from) * rnd(1);
    const r = radius * (0.92 + 0.12 * rnd(2));
    const sp = speed * (0.6 + 0.8 * rnd(3));
    const out = outBase + 0.3 * rnd(4);
    return {
      x: ox + Math.cos(a) * r,
      y: oy + Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      size: rnd(6) > 0.5 ? 2 : 1,
    };
  });
}

/** y を反転した写像の作業面（反時計回りの輪を、時計回りの部品でそのまま描く） */
function mirrored(frame) {
  const m = Object.create(frame);
  m.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: -c.y };
  };
  m.toGrid = (x, y) => frame.toGrid(x, -y);
  return m;
}

/**
 * 上下に潰した写像の作業面（地面に置いた輪・腰の高さを回る輪）。
 * この面の円（中心 0,0）は、正準座標で中心 (0, oy)・縦を 1/squash に潰した楕円になる
 */
function flattened(frame, oy, squash) {
  const m = Object.create(frame);
  m.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: (c.y - oy) * squash };
  };
  m.toGrid = (x, y) => frame.toGrid(x, y / squash + oy);
  return m;
}

// -----------------------------------------------------------------------------
// 共通の部品（奥義向けに引数を足したもの。断頭輪・輪舞が使う）
// -----------------------------------------------------------------------------

/** 崩れの判定: ノイズと芯からの近さで、縁から先に欠ける */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.5, seed + 7) * 0.22;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 戦輪の本体: 細い輪から後ろへ反った鉤刃が出る形。発動の紋・命中の閃きに使う（飛んでいる弾の本体には使わない）
 */
function bladeRing(frame, cx, cy, o) {
  const { r, rot } = o;
  const rw = o.rw ?? 2;
  const n = o.blades ?? 3;
  const L = o.bladeLen ?? 3;
  const bw = o.bladeW ?? 2;
  const curve = o.curve ?? 0.7;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 31;
  const outer = r + L + 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > outer || d < r - rw - 0.3) return -1;
      const a = Math.atan2(dy, dx);
      const lit = 0.5 + 0.5 * Math.cos(a + 0.9);
      if (d <= r) {
        if (rw <= 0) return -1;
        const q = (r - d) / rw;
        if (!survives(x, y, erosion, 1 - q, seed)) return -1;
        if (r - d < 1.1 && lit > 0.55 && erosion < 0.5) return clamp01(bright);
        return clamp01((0.5 + 0.28 * lit) * (1 - 0.35 * q) * bright * (1 - erosion * 0.4));
      }
      const t = (d - r) / L;
      if (t > 1) return -1;
      for (let k = 0; k < n; k++) {
        const phi = rot + (k * TAU) / n - curve * Math.pow(t, 1.4);
        const along = wrapAngle(a - phi) * d;
        const half = bw * Math.pow(1 - t, 0.9) + 0.35;
        if (Math.abs(along) > half) continue;
        if (!survives(x, y, erosion, 1 - t, seed + k)) return -1;
        if (along > half - 1.1 && t < 0.8 && erosion < 0.5) return clamp01(0.95 * bright);
        return clamp01((0.5 + 0.22 * (along / half) + 0.15 * lit) * (1 - 0.3 * t) * bright * (1 - erosion * 0.4));
      }
      return -1;
    },
    { bounds: { x0: cx - outer - 1, y0: cy - outer - 1, x1: cx + outer + 1, y1: cy + outer + 1 }, samples: 4 },
  );
}

/**
 * 滑らかな弧の帯（輪を持った手の通り道・切り口）。中心 (ox, oy)、外縁の半径 R、太さ T、先頭 head から時計回りに span。
 * 先頭寄りが最も太く尾へ細る。外縁の先頭寄りが白い刃の縁
 */
function smoothBand(frame, o) {
  const { R, T, head, span } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const edgeReach = o.edgeReach ?? 0.55;
  const peak = o.peak ?? 0.12;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + 0.5 || r < R - T - 0.5) return -1;
      const s = cwFrom(head, Math.atan2(dy, dx));
      if (s > span) return -1;
      const u = s / span;
      const taper = u < peak ? Math.pow(u / peak, 0.6) : Math.pow((1 - u) / (1 - peak), 0.6);
      const w = T * taper;
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.4 && u < edgeReach && erosion < 0.45) return clamp01(bright * (1.05 - 0.35 * u));
      return clamp01(Math.pow(1 - q, 1.05) * (0.9 - 0.5 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: ox - R - 2, y0: oy - R - 2, x1: ox + R + 2, y1: oy + R + 2 } },
  );
}

/** 回転の火花: 円周上の点から接線（時計回りの進む向き）へ飛ぶ */
function hookSparks(frame, age, count, seed, o) {
  const { ox = 0, oy = 0, radius, from, to, speed = 4 } = o;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = from + (to - from) * rnd(1);
    const r = radius * (0.92 + 0.12 * rnd(2));
    const sp = speed * (0.6 + 0.8 * rnd(3));
    const out = 0.2 + 0.35 * rnd(4);
    return {
      x: ox + Math.cos(a) * r,
      y: oy + Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      size: rnd(6) > 0.5 ? 2 : 1,
    };
  });
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ex = x + c * len;
  const ey = y + s * len;
  const pad = w + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s;
      if (along < -w * 0.5 || along > len) return -1;
      const u = Math.max(0, along) / len;
      const half = w * (1 - u) ** 0.9 + 0.35;
      const across = Math.abs(-dx * s + dy * c);
      if (across > half) return -1;
      return clamp01((1 - across / half) ** 0.6 * (1 - 0.55 * u) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 前へ押し出す風の弧（潰れた楕円の前側だけ） */
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

/**
 * 手首の返しの風切りの弧: P を通る円弧が、向き a へ弾くように回る（時計回り）。
 * age 0 で半ば、1 で振り切り、以降は細って崩れる
 */
function wristFlick(frame, P, a, age, o) {
  const life = o.life ?? 4;
  if (age < 0 || age > life) return;
  const R = o.R ?? 9;
  const cx = P.x - Math.sin(a) * R;
  const cy = P.y + Math.cos(a) * R;
  const top = a - Math.PI / 2;
  const sweep = (o.sweep ?? 150) * DEG;
  const p = age === 0 ? 0.6 : 1;
  const k = age <= 1 ? 0 : (age - 1) / (life - 1);
  const head = top + sweep * 0.5 * p + k * 0.2;
  smoothBand(frame, { ox: cx, oy: cy, R, T: (o.T ?? 3.5) * (1 - 0.4 * k), head, span: sweep * p * (1 - 0.5 * k), erosion: k * 0.85, bright: 1 - 0.3 * k, seed: o.seed ?? 5001, edgeReach: 0.5 });
}

/**
 * 回転の風の光: 半径 R の円周を回る n 本の短い弧（等間隔）。先頭ほど明るい 1px の線。
 * rot で回す。本体（武器の絵）は描画側が重ねるので、ここはその外に漏れる風だけ
 */
function spinArcs(frame, R, rot, o = {}) {
  const n = o.n ?? 3;
  const len = (o.len ?? 60) * DEG;
  const bright = o.bright ?? 0.6;
  const width = o.width ?? 1.2;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(Math.hypot(x, y) - R) > width / 2) return -1;
      const a = Math.atan2(y, x);
      for (let k = 0; k < n; k++) {
        const s0 = cwFrom(rot + (k * TAU) / n, a);
        if (s0 <= len) return bright * (1 - 0.7 * (s0 / len));
      }
      return -1;
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0, samples: 2 },
  );
}

/** 手の位置（自分の中心から。キャラ 48 ドットの縁の少し内） */
const HAND = 16;

// -----------------------------------------------------------------------------
// 輪舞（volley 4 本・全周）: 手が時計回りに一周しながら 4 方へ順に放つ
// -----------------------------------------------------------------------------

/** 4 本を放つ向き（照準からの角。spreadOffsets(4, 90°) と同じ ±45°・±135°）を時計回りの順に */
const DANCE_ANGLES = [-45, 45, 135, -135].map((d) => d * DEG);
const DANCE_N = 10;
const DANCE_A = 4;

/**
 * 輪舞の放ち: 手の通り道は外へ開く 1 本の渦（1 周。同じ所を二重に通らない）。
 * 渦が各方位を通る瞬間にそこで手首の返しの弧が弾け、外へ風の筋が抜ける
 */
function ringDance(frame, f) {
  const head = DANCE_ANGLES[0] - 30 * DEG;
  // 渦: 半径が回るほど開く（14 → 34）。先頭は時計回りに 1 周
  const turn = f < DANCE_A ? easeSwing((f + 1) / DANCE_A) : 1;
  const k = f < DANCE_A ? 0 : (f - DANCE_A + 1) / (DANCE_N - DANCE_A + 1);
  if (k < 0.95) {
    const at = (u) => head + TAU * u;
    const rad = (u) => 20 + 26 * u;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (r < 17 || r > 48) return -1;
        // 今の角から、この点が渦の何周目の u に当たるか（開く渦は角ごとに 1 点だけ）
        const a = Math.atan2(y, x);
        const u = ((((a - head) % TAU) + TAU) % TAU) / TAU;
        if (u > turn) return -1;
        const w = 1.4 + 4.6 * Math.pow(u / Math.max(0.01, turn), 1.5);
        const d = rad(u) - r;
        if (d < -0.6 || d > w) return -1;
        const tail = u / Math.max(0.01, turn);
        const q = d / w;
        if (!survives(x, y, k * 0.95 + (1 - tail) * 0.25, (1 - q) * tail, 5101)) return -1;
        if (d < 1.2 && tail > 0.55 && k < 0.4) return clamp01(1.02 - 0.2 * (1 - tail));
        return clamp01((1 - q) ** 1.05 * (0.4 + 0.5 * tail) * (1 - k * 0.45));
      },
      { bounds: { x0: -50, y0: -50, x1: 50, y1: 50 } },
    );
    if (f < DANCE_A) {
      const a = at(turn);
      sparkle(frame, Math.cos(a) * (rad(turn) - 1), Math.sin(a) * (rad(turn) - 1), 3);
    }
  }
  // 各方位で放つ: 渦が通った順（1 フレームずつ遅れる）
  DANCE_ANGLES.forEach((a, j) => {
    const age = f - j;
    if (age < 0) return;
    const r = 24 + 6.5 * j;
    const P = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    wristFlick(frame, P, a, age, { R: 13, T: 5, sweep: 135, seed: 5110 + j, life: 4 });
    // 放った瞬間の閃光の針（外へ）。輪が抜けた向きを 1 本で示す
    if (age >= 1 && age <= 3) {
      const r0 = r + 6 + age * 6;
      spike(frame, { x: Math.cos(a) * r0, y: Math.sin(a) * r0, a, len: 22 - age * 5, w: 2.2 - age * 0.4, bright: 0.95 - age * 0.15 });
    }
    if (age === 1) sparkle(frame, Math.cos(a) * (r + 12), Math.sin(a) * (r + 12), 3);
    if (age >= 1) hookSparks(frame, age - 1, 5, 5120 + j, { ox: P.x, oy: P.y, radius: 4, from: a - 1.2, to: a + 1.2, speed: 4 });
  });
}

/** 輪舞の発動: 4 方に鉤刃の閃きが灯り、内へ巻く細い弧 4 本（風車）が締まって中心で弾ける */
function ringDanceCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = (f + 1) / gather;
    const R = 40 - 22 * p;
    for (let j = 0; j < 4; j++) {
      const a = DANCE_ANGLES[j] + f * 0.35;
      // 各方位の小さな鉤刃（回りながら中心へ寄る）
      bladeRing(frame, Math.cos(a) * R, Math.sin(a) * R, { r: 2, rw: 1.2, rot: a + f, blades: 2, bladeLen: 4, bladeW: 1.6, curve: 1, bright: 0.55 + 0.4 * p, seed: 5130 + j });
      // その後ろへ細い弧（内へ巻き込む風車の羽）
      smoothBand(frame, { R: R + 2, T: 2.2, head: a - 0.25, span: 0.9, bright: 0.45 + 0.35 * p, seed: 5135 + j, peak: 0.2 });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  ring(frame, { radius: 10 + k * 26, width: 2.6 - k, erosion: Math.min(0.9, k * 0.8), bright: 0.85 - k * 0.3, seed: 5140 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  hookSparks(frame, f - gather, 14, 5141, { radius: 10, from: 0, to: TAU, speed: 4.5 });
}

// 輪舞の弾（近投げの輪・半径 4 → 武器の絵は等倍、半径の目安 8 ドット）

const DANCE_LOOK_R = 8;
const DANCE_TAIL = 32;
const DANCE_FLY_N = 8;

/**
 * 輪舞の弾の尾: 横（+y）へ曲がって戻る航跡（通常の返し輪より長い。細く尖らせて角の形に見せない）。
 * 航跡の外側を光の粒が後ろへ流れ、外周には 3 本の風の弧が回る
 */
function ringDanceFly(frame, f) {
  const L = DANCE_TAIL;
  const bend = (u) => 10 * u * u;
  paint(
    frame,
    (x, y) => {
      if (x > -DANCE_LOOK_R + 1 || x < -L - 4) return -1;
      const u = (-DANCE_LOOK_R + 1 - x) / (L + 5 - DANCE_LOOK_R);
      const yc = bend(u);
      const hw = 2.6 * (1 - u) ** 0.9 + 0.3;
      const d = Math.abs(y - yc);
      if (d > hw) return -1;
      const grain = 0.85 + 0.25 * hash1(Math.floor((x + 80) / 3) + f * 2, 5201);
      return clamp01((1 - d / hw) ** 0.8 * 0.64 * (1 - u) ** 1.3 * grain);
    },
    { bounds: { x0: -L - 6, y0: -5, x1: 2, y1: 16 } },
  );
  // 流れる光の粒
  for (let i = 0; i < 3; i++) {
    const t = ((f / DANCE_FLY_N + i / 3) % 1);
    const x = -DANCE_LOOK_R - 2 - t * (L - DANCE_LOOK_R);
    const u = (-DANCE_LOOK_R + 1 - x) / (L + 5 - DANCE_LOOK_R);
    dot(frame, x, bend(u) + (i % 2 === 0 ? -4 : 4) * (1 + t), Math.max(2, Math.round(6 - 4 * t)));
  }
  spinArcs(frame, DANCE_LOOK_R + 4, (f / DANCE_FLY_N) * (TAU / 3) + 0.4, { n: 3, len: 55, bright: 0.62 });
  // 刃先の光点: 1 巡に 1 回、外周の前寄りで
  if (f === 2) sparkle(frame, 4, -DANCE_LOOK_R - 3, 2);
}

/** 輪舞の弾の放ち: 大きめの横手の弧が内へ巻き込み（戻りの回転）、前へ風の弧と接線の火花 */
function ringDanceMuzzle(frame, f) {
  wristFlick(frame, { x: 2, y: 0 }, -12 * DEG, f, { R: 14, T: 4.5, sweep: 175, seed: 5210, life: 5 });
  if (f >= 1 && f <= 4) frontArc(frame, { ox: 6 + f * 3, radius: 5 + f * 3.5, width: 1.8, squash: 0.5, erosion: Math.min(0.9, f * 0.2), bright: 0.7 - f * 0.1, seed: 5211 });
  if (f === 1) sparkle(frame, 9, -3, 3);
  if (f >= 1) hookSparks(frame, f - 1, 7, 5212, { ox: 0, oy: 12, radius: 14, from: -1.9, to: -1.1, speed: 3.5 });
}

/** 輪舞の弾の着弾（壁で弾かれた）: 鉤の数より多い針が後ろの扇に弾け、潰れた風の弧と接線の火花 */
function ringDanceImpact(frame, f) {
  const n = 6;
  if (f <= 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1) - 0.5) * 2.6;
      spike(frame, { a, len: (8 + 5 * hash1(i, 5221)) * (f === 0 ? 0.8 : 1), w: 1.8, bright: 0.95 });
    }
    spike(frame, { a: 0, len: 6, w: 1.4, bright: 0.8 });
    sparkle(frame, 0, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1 && f <= 4) frontArc(frame, { ox: -1, radius: 5 + f * 4, width: 1.8, squash: 0.5, spread: 65 * DEG, erosion: (f - 1) * 0.25, bright: 0.7 - f * 0.1, seed: 5222 });
  hookSparks(frame, f, 12, 5223, { radius: 4, from: Math.PI / 2, to: (3 * Math.PI) / 2, speed: 4.5 });
}

/** 輪舞の弾の命中: 回る刃が裂いた弧の切り口 1 本と、鉤 2 枚の閃き、前と横へ抜ける火花 */
function ringDanceHit(frame, f) {
  const N = 7;
  const R = 16;
  const k = f < 1 ? 0 : (f - 1) / (N - 1);
  const sweep = 115 * DEG;
  const grow = f === 0 ? 0.6 : 1;
  smoothBand(frame, { ox: 0, oy: R, R, T: 5.5 * (f === 0 ? 0.75 : 1 - 0.5 * k), head: -Math.PI / 2 + sweep * (grow - 0.5), span: sweep * grow, erosion: k * 0.9, bright: 1 - 0.2 * k, seed: 5231, peak: 0.3 });
  if (f <= 2) bladeRing(frame, 0, 0, { r: 1.5, rw: 0, rot: f * 1.1, blades: 2, bladeLen: 8 * (1 - f * 0.2), bladeW: 1.8, curve: 1.1, bright: f === 2 ? 0.75 : 1, seed: 5232 });
  if (f <= 1) sparkle(frame, 0, 0, 3);
  if (f === 2) sparkle(frame, 6, -3, 2);
  shards(frame, f, 12, 5233, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2;
    const sp = 3 + rnd(2) * 3.5;
    return { x: 1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 断頭輪（volley 1 本・半径 10・遅い）: 巨大な輪を重く振りかぶって放る
// -----------------------------------------------------------------------------

/** 放りの弧の半径と太さ（腕を大きく回す上手投げ。当たりは弾なので絵の大きさは見栄え） */
const HEAD_R = 44;
const HEAD_T = 14;
const HEAD_N = 10;
const HEAD_A = 4;

/**
 * 断頭輪の放ち: 自分の後ろ上から前へ、1 本の重く太い弧（腕の通り道）が振り下ろされる。
 * 振り切った所で前へ押し出す風の弧が 2 枚遅れて広がり、足元から後ろへ砂の筋
 */
function headsman(frame, f) {
  const { p, k } = f < HEAD_A ? { p: easeSwing((f + 1) / HEAD_A), k: 0 } : { p: 1, k: (f - HEAD_A + 1) / (HEAD_N - HEAD_A + 1) };
  // 弧の中心を後ろに置き、外縁が前（原点の少し先）を通る
  const ox = -HEAD_R + 22;
  const from = -150 * DEG;
  const sweep = 200 * DEG;
  const head = from + sweep * p;
  smoothBand(frame, {
    ox,
    R: HEAD_R,
    T: HEAD_T * (f < HEAD_A ? 0.7 + 0.3 * p : 1 - 0.55 * k),
    head: head + k * 0.15,
    span: sweep * p * (0.85 - 0.4 * k),
    erosion: f < HEAD_A ? 0 : 0.05 + 0.85 * k,
    bright: f === HEAD_A - 1 ? 1.08 : 1 - 0.3 * k,
    seed: 5301,
    peak: 0.1,
    edgeReach: 0.6,
  });
  // 速度線: 弧の外側に沿う 2 本（刃の外だけ）
  if (f < HEAD_A && f >= 1) {
    for (let i = 0; i < 2; i++) {
      const R = HEAD_R + 3 + i * 3.2;
      const end = head - 0.08 - 0.12 * i;
      smoothBand(frame, { ox, R, T: 1, head: end, span: 0.9 + 0.3 * hash1(i, 5302), bright: 0.55 - i * 0.12, seed: 5303 + i, peak: 0.05, edgeReach: 0 });
    }
  }
  if (f === HEAD_A - 1) sparkle(frame, ox + Math.cos(head) * (HEAD_R - 3), Math.sin(head) * (HEAD_R - 3), 4);
  // 押し出す風の弧（前へ）: 振り切りから 1 枚（2 枚重ねると二重線に見える）
  if (f >= HEAD_A - 1) {
    const age = f - (HEAD_A - 1);
    frontArc(frame, { ox: 18 + age * 6, radius: 14 + age * 8, width: 2.6 - age * 0.2, squash: 0.55, spread: 65 * DEG, erosion: Math.min(0.92, age * 0.14), bright: 0.8 - age * 0.08, seed: 5304 });
  }
  // 踏み込みの砂: 足元から後ろへ
  if (f >= 1 && k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (6 + Math.floor(i / 2) * 5 + hash1(i, 5306) * 2);
      const x0 = -12 - f * 4 - hash1(i, 5307) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 16 - hash1(i, 5308) * 12, by: y + side * 2, bright: 0.45 * (1 - k) });
    }
  }
  // 腕の弧から剥がれる刃片: 弧に沿って接線と外へ
  if (f >= HEAD_A - 1) hookSparks(frame, f - (HEAD_A - 1), 22, 5309, { ox, radius: HEAD_R - HEAD_T * 0.4, from: -60 * DEG, to: 50 * DEG, speed: 5 });
}

/**
 * 断頭輪の発動: 後ろ上に巨大な輪の影がゆっくり回りながら浮かび、周りから重い風の筋が集まる。
 * 最後に影が手元へ引き寄せられて閃く（振りかぶり）
 */
function headsmanCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const pull = f < 5 ? 0 : (f - 4) / 3;
  const cx = -22 + pull * 10;
  const cy = -16 + pull * 8;
  const bright = f < 5 ? 0.45 + 0.1 * f : 0.95 - pull * 0.5;
  bladeRing(frame, cx, cy, { r: 16, rw: 3, rot: f * 0.18, blades: 3, bladeLen: 9, bladeW: 3, curve: 0.9, bright, erosion: pull * 0.75, seed: 5320 });
  if (f < 5) {
    // 集まる筋: 輪の外側だけ、内へ
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const r0 = 30 + (4 - f) * 3;
      const r1 = r0 + 14 * (1 - f / 6);
      streakLine(frame, { ax: cx + Math.cos(a) * r1, ay: cy + Math.sin(a) * r1, bx: cx + Math.cos(a) * r0, by: cy + Math.sin(a) * r0, width: i % 2 === 0 ? 1.5 : 1, bright: 0.35 + 0.1 * f });
    }
  }
  if (f === 4) sparkle(frame, cx + 14, cy - 18, 4);
  if (f >= 5) ring(frame, { ox: cx, oy: cy, radius: 22 + pull * 10, width: 2.4 - pull, erosion: Math.min(0.9, pull * 0.8), bright: 0.8 - pull * 0.3, seed: 5321 });
  if (f >= 4) hookSparks(frame, f - 4, 10, 5322, { ox: cx, oy: cy, radius: 24, from: -Math.PI, to: 0, speed: 3.5 });
  if (k > 0.99) sparkle(frame, 4, 0, 2);
}

// 断頭輪の弾（近投げの輪・半径 10 → 武器の絵は 2.5 倍、半径の目安 20 ドット・速さ 0.5 倍）

const HEAD_LOOK_R = 20;
const HEAD_TAIL = 52;
const HEAD_FLY_N = 10;

/**
 * 断頭輪の弾の尾: 輪の上下の縁が後ろへ流れる太い中空の帯（縁ほど明るい）、外周を回る重い風の弧 3 本、
 * 帯の外へ剥がれる風の筋。遅い弾なので尾は長さより幅で見せる
 */
function headsmanFly(frame, f) {
  const cyc = f / HEAD_FLY_N;
  paint(
    frame,
    (x, y) => {
      if (x > 0 || x < -HEAD_TAIL - HEAD_LOOK_R) return -1;
      const u = -x / (HEAD_TAIL + HEAD_LOOK_R);
      // 帯の縁は輪の外周（半径 LOOK_R）から始まり、後ろへ寄って細る。前端は輪の後ろ半分に沿わせる（縦の切り口を作らない）
      const hw = (HEAD_LOOK_R - 3) * (1 - u) ** 0.8;
      if (x > -HEAD_LOOK_R - 4) return -1;
      const d = hw - Math.abs(y);
      const thick = 2.6 * (1 - u) + 0.8;
      // 縁の細い 2 本だけ（中は抜く。べた塗りの面にしない）
      if (d < -0.5 || d > thick) return -1;
      const grain = 0.8 + 0.3 * hash1(Math.floor((x + 120) / 4) + f * 3, 5401);
      if (!survives(x, y, u * 0.7, 1 - u, 5402)) return -1;
      return clamp01((1 - d / thick) ** 0.7 * 0.72 * (1 - u) ** 1.05 * grain);
    },
    { bounds: { x0: -HEAD_TAIL - HEAD_LOOK_R - 2, y0: -HEAD_LOOK_R - 3, x1: 0, y1: HEAD_LOOK_R + 3 } },
  );
  // 外周を回る重い風: 3 本の弧（1 巡で 1/3 周。3 回対称なので継ぎ目なし）
  spinArcs(frame, HEAD_LOOK_R + 5, cyc * (TAU / 3), { n: 3, len: 70, bright: 0.66, width: 1.6 });
  // 帯から剥がれて後ろへ流れる風の筋（上下）
  for (let i = 0; i < 4; i++) {
    const t = (cyc + i / 4) % 1;
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (HEAD_LOOK_R + 4 + 3 * hash1(i, 5403));
    const x1 = -HEAD_LOOK_R * 0.6 - t * HEAD_TAIL;
    streakLine(frame, { ax: x1 - 12, ay: y, bx: x1, by: y, bright: 0.55 * (1 - t) });
  }
  // 刃先の光点: 外周の上で 1 巡に 1 回
  if (f === 3) sparkle(frame, 6, -HEAD_LOOK_R - 5, 3);
}

/** 断頭輪の弾の放ち: 大きく重い弧（1 本）と、前へ押し出す風の弧、接線の火花 */
function headsmanMuzzle(frame, f) {
  wristFlick(frame, { x: 2, y: 0 }, 0, f, { R: 22, T: 7, sweep: 165, seed: 5410, life: 5 });
  if (f >= 1 && f <= 5) {
    frontArc(frame, { ox: 10 + f * 5, radius: 10 + f * 6, width: 2.4, squash: 0.5, erosion: Math.min(0.9, f * 0.18), bright: 0.75 - f * 0.1, seed: 5411 });
  }
  if (f === 1) sparkle(frame, 12, -4, 4);
  if (f >= 1) hookSparks(frame, f - 1, 10, 5413, { ox: 2, oy: 22, radius: 22, from: -1.9, to: -1.1, speed: 4.5 });
}

/** 断頭輪の弾の着弾（壁に噛んで弾かれた）: 長い針の扇、潰れた風の弧、壁に沿って上下へ走る亀裂の筋 */
function headsmanImpact(frame, f) {
  const n = 8;
  if (f <= 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1) - 0.5) * 2.7;
      spike(frame, { a, len: (16 + 10 * hash1(i, 5421)) * (f === 0 ? 0.75 : 1 - (f - 1) * 0.3), w: 2.8, bright: f === 2 ? 0.7 : 0.95 });
    }
    sparkle(frame, 0, 0, f === 1 ? 4 : 3);
  }
  // 壁の亀裂: 当たった面（x = 0 付近）に沿って上下へ折れながら走る 1px の線
  if (f >= 1 && f <= 5) {
    for (const s of [-1, 1]) {
      let px = 1;
      let py = 0;
      const segs = Math.min(4, f + 1);
      for (let j = 0; j < segs; j++) {
        const nx = 1 + (hash1(j, 5422 + s) - 0.5) * 5;
        const ny = py + s * (6 + 3 * hash1(j, 5424 + s));
        streakLine(frame, { ax: px, ay: py, bx: nx, by: ny, bright: 0.7 * (1 - f / 7) * (1 - j * 0.15) });
        px = nx;
        py = ny;
      }
    }
  }
  if (f >= 1 && f <= 5) {
    frontArc(frame, { ox: -2, radius: 8 + f * 6, width: 2.4, squash: 0.5, spread: 70 * DEG, erosion: (f - 1) * 0.2, bright: 0.75 - f * 0.1, seed: 5426 });
  }
  hookSparks(frame, f, 20, 5428, { radius: 8, from: Math.PI / 2, to: (3 * Math.PI) / 2, speed: 6 });
}

/**
 * 断頭輪の弾の命中（すべて貫く）: 巨大な刃が通り抜けた切り口 1 本（大きな弧）と、3 枚鉤の閃き、
 * 前へ抜ける火花の吹き（衝撃の輪は切り口と重なって的に見えるので描かない）
 */
function headsmanHit(frame, f) {
  const N = 8;
  const R = 32;
  const k = f < 1 ? 0 : (f - 1) / (N - 1);
  const sweep = 120 * DEG;
  const grow = f === 0 ? 0.55 : 1;
  smoothBand(frame, { ox: 0, oy: R, R, T: 10 * (f === 0 ? 0.75 : 1 - 0.5 * k), head: -Math.PI / 2 + sweep * (grow - 0.5), span: sweep * grow, erosion: k * 0.9, bright: 1 - 0.2 * k, seed: 5431, peak: 0.28 });
  if (f <= 2) bladeRing(frame, 0, 0, { r: 2, rw: 0, rot: f * 0.8, blades: 3, bladeLen: 14 * (1 - f * 0.18), bladeW: 2.4, curve: 1, bright: f === 2 ? 0.75 : 1, seed: 5432 });
  if (f <= 1) sparkle(frame, 0, 0, 4);
  if (f === 2) sparkle(frame, 14, -6, 2);
  shards(frame, f, 26, 5434, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 4 + rnd(2) * 5;
    return { x: 2, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 4), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.84 };
  });
}

// -----------------------------------------------------------------------------
// 輪の舞（持続）: 3 枚の輪が腰の高さの楕円を三拍子で巡る（1 拍ごとに前を通る輪が光る）
// dirs 1（画面に揃える）: 楕円は奥行きの見立てなので向きによらない
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 纏いの楕円: 腰の高さ・横の半径・潰し */
const WALTZ_Y = 6;
const WALTZ_RX = 36;
const WALTZ_SQUASH = 2.6;
const WALTZ_N = 12;

/**
 * 三拍子の角の進み（1 巡 = 1 小節 = 1 周）。拍の頭で速く、拍の終わりで粘る（ワルツの揺れ）。t ∈ [0,1) → [0,1)
 */
function waltzTurn(t) {
  return t - Math.sin(t * TAU * 3) / (TAU * 3) * 0.7;
}

/** 楕円の上の位置（奥 = 上側 = 暗く） */
function waltzAt(a) {
  return { x: Math.cos(a) * WALTZ_RX, y: WALTZ_Y + (Math.sin(a) * WALTZ_RX) / WALTZ_SQUASH, front: Math.sin(a) };
}

function ringWaltzSustain(frame, f) {
  const flat = flattened(frame, WALTZ_Y, WALTZ_SQUASH);
  const t = f / WALTZ_N;
  const base = waltzTurn(t) * TAU;
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * TAU + Math.PI / 2;
    const pos = waltzAt(a);
    // 奥を通る輪は暗く小さく（キャラの後ろを回る見立て）
    const depth = 0.5 + 0.5 * pos.front;
    toothedArc(flat, { R: WALTZ_RX + 2, T: 4, head: a, span: 1.3, tooth: 3, pitch: 8, bright: 0.45 + 0.4 * depth, cap: 0.8, edgeReach: 0.35, seed: 3701 + i });
    wheel(frame, pos.x, pos.y, { r: 4.5 + 1.5 * depth, rw: 2.4, rot: a * 4, teeth: 6, tooth: 2.2, bright: 0.6 + 0.4 * depth, seed: 3705 + i });
  }
  // 拍の頭（1 巡に 3 回）: 前を通る輪の位置が光る
  if (f % 4 === 0) {
    const pos = waltzAt(Math.PI / 2);
    sparkle(frame, pos.x, pos.y, f === 0 ? 3 : 2);
  }
  // 刻みの粉: 楕円の縁から外へ落ちる細かな粒（位相で流れ、1 巡で戻る）
  for (let i = 0; i < 8; i++) {
    const u = (t + hash1(i, 3710)) % 1;
    const a = hash1(i, 3711) * TAU;
    const p = waltzAt(a);
    const x = p.x * (1 + 0.25 * u);
    const y = p.y + u * 12;
    dot(frame, x, y, Math.max(2, Math.round(5 - 3 * u)));
  }
}

/**
 * 輪の舞の足元（地面）: 潰した歯の輪がゆっくり回り（歯の送りで 1 巡がつながる）、三拍子の 3 つの座が拍ごとに灯る
 */
function ringWaltzGround(frame, f) {
  const flat = flattened(frame, FEET_Y, WALTZ_SQUASH);
  const t = f / WALTZ_N;
  const R = 30;
  const pitch = 9;
  toothedArc(flat, { R, T: 2.2, head: 0, span: TAU, tooth: 2.5, pitch, phase: -t * pitch, bright: 0.42, cap: 0.5, edgeReach: 0, seed: 3801 });
  const beat = Math.floor(t * 3);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i / 3) * TAU;
    const x = Math.cos(a) * (R - 6);
    const y = FEET_Y + (Math.sin(a) * (R - 6)) / WALTZ_SQUASH;
    ring(frame, { ox: x, oy: y, radius: 2.6, width: 1.4, squash: 1.6, bright: i === beat ? 0.62 : 0.3, seed: 3802 + i });
  }
}

/**
 * 輪の舞の発動: 足元の歯の輪が一周して閉じ、そこから 3 枚の輪が渦を巻いて腰の高さへ舞い上がり、光って纏いに移る
 */
function ringWaltzCast(frame, f) {
  const N = 10;
  const ground = flattened(frame, FEET_Y, WALTZ_SQUASH);
  // 足元の輪: 0〜3 で一周して閉じ、そのあと広がって崩れる
  const close = Math.min(1, easeSwing((f + 1) / 4));
  const kg = f < 4 ? 0 : (f - 3) / (N - 4);
  toothedArc(ground, {
    R: 30 + kg * 16,
    T: 4 * (1 - 0.4 * kg),
    head: Math.PI / 2 + TAU * close,
    span: Math.max(0.1, TAU * close),
    tooth: 3,
    pitch: 9,
    erosion: f < 4 ? 0 : 0.1 + 0.8 * kg,
    bright: 0.9 - 0.3 * kg,
    cap: 0.9,
    edgeReach: 0.4,
    seed: 3901,
  });
  // 舞い上がる 3 枚: 足元の輪の上から、半径を保って時計回りに回りながら腰へ
  if (f >= 2) {
    const age = f - 2;
    const p = Math.min(1, easeSwing((age + 1) / 4));
    const kk = age < 4 ? 0 : (age - 3) / 4;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i / 3) * TAU + p * TAU * 0.9;
      const oy = FEET_Y + (WALTZ_Y - FEET_Y) * p;
      const lift = flattened(frame, oy, WALTZ_SQUASH);
      toothedArc(lift, { R: WALTZ_RX + 2, T: 4.5 * (1 - 0.5 * kk), head: a, span: 0.4 + 1.4 * p, tooth: 3, pitch: 8, erosion: kk * 0.9, bright: 0.95 - 0.3 * kk, cap: 0.9, seed: 3905 + i });
      if (kk < 0.5) {
        const x = Math.cos(a) * WALTZ_RX;
        const y = oy + (Math.sin(a) * WALTZ_RX) / WALTZ_SQUASH;
        wheel(frame, x, y, { r: 6, rw: 2.6, rot: a * 4, teeth: 6, tooth: 2.5, erosion: kk * 0.6, seed: 3910 + i });
        if (age === 3) sparkle(frame, x, y - 1, 3);
      }
    }
  }
  // 立ちのぼる刻みの粉
  shards(frame, f, 14, 3920, (i, rnd) => {
    const a = rnd(1) * TAU;
    return { x: Math.cos(a) * 30, y: FEET_Y + (Math.sin(a) * 30) / WALTZ_SQUASH, vx: Math.cos(a) * 1.2, vy: -(2.5 + rnd(2) * 3), life: 4 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.9 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 弾の base は数値表の radius（断頭輪 10・輪舞 4）。放ちの acts は周囲攻撃でも振りでもないので base 0（拡縮しない）
 */
const FX = {
  moveset: "ringBlades",
  ultimates: {
    "ringBlades.headsman": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.headsmanCast", life: 0.4 },
      acts: [{ sheet: "ringBladesUlt.headsman", life: 0.55, base: 0, pivot: "pos" }],
      shots: {
        0: {
          fly: "ringBladesUlt.headsmanFly",
          period: 0.34,
          base: 10,
          muzzle: "ringBladesUlt.headsmanMuzzle",
          impact: "ringBladesUlt.headsmanImpact",
          hit: "ringBladesUlt.headsmanHit",
          ramp: "light",
        },
      },
    },
    "ringBlades.ringDance": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.ringDanceCast", life: 0.35 },
      acts: [{ sheet: "ringBladesUlt.ringDance", life: 0.5, base: 0, pivot: "pos" }],
      shots: {
        0: {
          fly: "ringBladesUlt.ringDanceFly",
          period: 0.16,
          base: 4,
          muzzle: "ringBladesUlt.ringDanceMuzzle",
          impact: "ringBladesUlt.ringDanceImpact",
          hit: "ringBladesUlt.ringDanceHit",
          ramp: "light",
        },
      },
    },
    "ringBlades.ringWaltz": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.ringWaltzCast", life: 0.6 },
      sustain: { sheet: "ringBladesUlt.ringWaltz", period: 0.9, ground: "ringBladesUlt.ringWaltzGround" },
    },
  },
};

export const ATLAS = {
  key: "ringBladesUlt",
  fx: FX,
  sheets: [
    { key: "ringBladesUlt.headsmanCast", dirs: DIRS, frames: 8, active: 0, size: 150, draw: headsmanCast },
    { key: "ringBladesUlt.headsman", dirs: DIRS, frames: HEAD_N, active: HEAD_A, size: 200, draw: headsman },
    { key: "ringBladesUlt.headsmanFly", dirs: DIRS, frames: HEAD_FLY_N, active: 0, size: 2 * (HEAD_TAIL + HEAD_LOOK_R + 8), draw: headsmanFly },
    { key: "ringBladesUlt.headsmanMuzzle", dirs: DIRS, frames: 6, active: 0, size: 140, draw: headsmanMuzzle },
    { key: "ringBladesUlt.headsmanImpact", dirs: DIRS, frames: 7, active: 0, size: 120, draw: headsmanImpact },
    { key: "ringBladesUlt.headsmanHit", dirs: DIRS, frames: 8, active: 0, size: 150, draw: headsmanHit },
    { key: "ringBladesUlt.ringDanceCast", dirs: 1, frames: 8, active: 0, size: 104, draw: ringDanceCast },
    { key: "ringBladesUlt.ringDance", dirs: DIRS, frames: DANCE_N, active: DANCE_A, size: 190, draw: ringDance },
    { key: "ringBladesUlt.ringDanceFly", dirs: DIRS, frames: DANCE_FLY_N, active: 0, size: 2 * (DANCE_TAIL + 16), draw: ringDanceFly },
    { key: "ringBladesUlt.ringDanceMuzzle", dirs: DIRS, frames: 6, active: 0, size: 84, draw: ringDanceMuzzle },
    { key: "ringBladesUlt.ringDanceImpact", dirs: DIRS, frames: 6, active: 0, size: 80, draw: ringDanceImpact },
    { key: "ringBladesUlt.ringDanceHit", dirs: DIRS, frames: 7, active: 0, size: 84, draw: ringDanceHit },
    { key: "ringBladesUlt.ringWaltzCast", dirs: 1, frames: 10, active: 0, size: 160, draw: ringWaltzCast },
    { key: "ringBladesUlt.ringWaltz", dirs: 1, frames: WALTZ_N, active: 0, size: 128, draw: ringWaltzSustain },
    { key: "ringBladesUlt.ringWaltzGround", dirs: 1, frames: WALTZ_N, active: 0, size: 96, draw: ringWaltzGround },
  ],
};
