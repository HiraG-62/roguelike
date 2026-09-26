// 戦鎚（moveset "hammer"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。見本は swordUlt.mjs、地面の描き方は hammer.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/hammer.json × 2 が目安
//
// 戦鎚の通常の振りと同じく、主役は「地面」: 潰れた楕円の衝撃の輪・光る地割れ・四角い石の破片・低い砂煙。
// 奥義はそれを一段大きく・長く・段を多くする。地面の物はキャラより下の層（ground のシート）に分けて描く。
// - 天墜: 天から落ちた跡の縦の筋（発動）→ 周囲を割る大きな叩きつけ（くぼみ・長い地割れ 14 本・同心の割れ・輪 2 枚・押し出しの風）
// - 砕地: 振り下ろし（発動）→ 前の地面を叩き割り 3 本の地割れを前へ放つ。弾は地を走る土の盛り上がりが割れ目を引く
// - 鉄槌の律: 足元に菱形の「律の紋」を刻む。持続中は鉄塊が周りを巡り、当てた所で菱形の割れと衝撃の輪が起きる
// 地面の物は画面の座標で描く（回すと楕円が傾いて地面に見えない）。hammer.mjs の部品を写し、原点をずらせるようにした
import { arcLine, easeSwing, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, levelOf, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 地面の楕円の潰れ（縦 / 横）。hammer.mjs と同じ比にして通常の振りと地面の見え方をそろえる */
const SQ = 0.58;
/** 4x4 の順序ディザ（raster.mjs と同じ並び） */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 足元の高さ（キャラは絵で 48 ドット。原点はキャラの中心） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 画面の座標で塗る道具（hammer.mjs から写した）
// -----------------------------------------------------------------------------

/** 画面に揃った座標（原点からの画面のずれ。回さない）で形を塗る。fn の約束は raster.paint と同じ */
function paintScreen(frame, fn, b, opts = {}) {
  const samples = opts.samples ?? 3;
  const dither = opts.dither ?? 0.04;
  const x0 = Math.max(0, Math.floor(frame.cx + b.x0) - 1);
  const y0 = Math.max(0, Math.floor(frame.cy + b.y0) - 1);
  const x1 = Math.min(frame.w - 1, Math.ceil(frame.cx + b.x1) + 1);
  const y1 = Math.min(frame.h - 1, Math.ceil(frame.cy + b.y1) + 1);
  const inv = 1 / samples;
  const need = (samples * samples) / 2;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      let inside = 0;
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const v = fn(ix + (sx + 0.5) * inv - frame.cx, iy + (sy + 0.5) * inv - frame.cy);
          if (v < 0) continue;
          inside++;
          sum += v;
        }
      }
      if (inside < need) continue;
      const bay = (BAYER4[(iy & 3) * 4 + (ix & 3)] ?? 0) / 16 - 0.5;
      frame.raise(ix, iy, levelOf(clamp01(sum / inside + bay * dither * 2)));
    }
  }
}

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

function easeOut(t) {
  return 1 - Math.pow(1 - clamp01(t), 2.4);
}

/** 画面の線分（細い速度線・放射の風）。b 側が明るい */
function screenLine(frame, ax, ay, bx, by, width, bright) {
  paintScreen(
    frame,
    (sx, sy) => {
      const s = segment(sx, sy, ax, ay, bx, by);
      if (s.d > width / 2) return -1;
      return bright * (0.3 + 0.7 * s.t);
    },
    { x0: Math.min(ax, bx) - width - 1, y0: Math.min(ay, by) - width - 1, x1: Math.max(ax, bx) + width + 1, y1: Math.max(ay, by) + width + 1 },
    { dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 地面の衝撃の部品（hammer.mjs の部品に中心のずれ cx / cy を足したもの）
// -----------------------------------------------------------------------------

/** 地面の衝撃波の輪（横長に潰れた楕円）。手前の縁を太く明るく、内側へ暗い尾を引く */
function groundRing(frame, o) {
  const { r, width } = o;
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.8;
  const seed = o.seed ?? 11;
  paintScreen(
    frame,
    (sx, sy) => {
      const dx = sx - cx;
      const dy = (sy - cy) / SQ;
      const d = Math.hypot(dx, dy);
      const near = d > 0 ? dy / d : 0;
      const w = width * 1.25 * (0.62 + 0.38 * near);
      const off = d - r;
      const trail = Math.min(w * 1.6, r * 0.3 + w * 0.5);
      if (off > w * 0.4 || off < -trail) return -1;
      const q = off > 0 ? off / (w * 0.4) : -off / trail;
      if (!survives(sx, sy, erosion, 1 - q, seed)) return -1;
      const lead = off > -w * 0.45 ? 1 : 0.55 * (1 - q);
      return clamp01(bright * lead * (off > 0 ? 1 - 0.4 * q : 1) * (0.76 + 0.24 * near) * (1 - erosion * 0.35));
    },
    { x0: cx - r - width - 2, y0: cy - (r + width) * SQ - 2, x1: cx + r + width + 2, y1: cy + (r + width) * SQ + 2 },
  );
}

/** 輪の時間割（hammer.mjs の slam の輪と同じ: 速く広がって減速し、縁から欠けて消える） */
function ringAt(frame, f, R, o) {
  const age = f - (o.delay ?? 0);
  if (age < 0) return;
  const span = o.span;
  const t = clamp01(age / span);
  if (t >= 1) return;
  const start = o.start ?? 0.25;
  groundRing(frame, {
    cx: o.cx,
    cy: o.cy,
    r: R * start + R * (1 - start) * easeOut(age / (span * 0.6)),
    width: o.width * (1 - 0.45 * t),
    erosion: t > 0.3 ? (t - 0.3) * 1.25 : 0,
    bright: (o.bright ?? 0.9) * (1 - 0.35 * t),
    seed: o.seed,
  });
}

/**
 * 放射状の地割れ（折れ線）の形を作る。向き aim を中心に spread の範囲へ count 本。
 * sq は縦の潰れ（既定は地面の SQ。弾の道筋に沿わせる割れは 1 にして実際の向きへ走らせる）、ox / oy は根元のずれ
 */
function makeCracks(aim, o) {
  const lines = [];
  const { count, len, spread, seed } = o;
  const r0 = o.r0 ?? 5;
  const segs = o.segs ?? 4;
  const sq = o.sq ?? SQ;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const full = spread >= TAU - 0.01;
  for (let i = 0; i < count; i++) {
    const even = count > 1 ? i / (count - 1) - 0.5 : 0;
    const a = full ? aim + (i / count) * TAU + (hash1(i, seed) - 0.5) * 0.4 : aim + spread * even + (hash1(i, seed) - 0.5) * (spread / Math.max(2, count)) * (o.jitter ?? 0.8);
    const facing = 0.5 + 0.5 * Math.cos(wrapAngle(a - aim));
    const L = len * (0.55 + 0.25 * hash1(i, seed + 1) + 0.2 * facing * (o.forward ?? 1));
    const pts = [];
    const J = (1 + L * 0.035) * (o.zig ?? 1);
    const start = r0 + hash1(i, seed + 8) * 4;
    const sign0 = hash1(i, seed + 9) > 0.5 ? 1 : -1;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const r = start + (L - start) * (t + (k > 0 && k < segs ? (hash1(i * 17 + k, seed + 10) - 0.5) * (0.5 / segs) : 0));
      const side = k === 0 ? 0 : (k % 2 === 0 ? 1 : -1) * sign0 * J * (0.5 + hash1(i * 17 + k, seed + 2));
      pts.push({ x: ox + ca * r - sa * side, y: oy + (sa * r + ca * side) * sq, t });
    }
    lines.push({ pts, width: (o.width ?? 2.4) * (o.widths?.[i] ?? 1), from: 0 });
    if ((o.branch ?? 0) > hash1(i, seed + 3)) {
      const k = 1 + Math.floor(hash1(i, seed + 4) * (segs - 2));
      const p = pts[k];
      if (p) {
        const side = hash1(i, seed + 5) > 0.5 ? 1 : -1;
        const ba = a + side * (0.5 + 0.3 * hash1(i, seed + 6));
        const bl = L * (0.3 + 0.15 * hash1(i, seed + 7));
        const q = { x: p.x + Math.cos(ba) * bl * 0.55, y: p.y + Math.sin(ba) * bl * 0.55 * sq };
        const e = { x: p.x + Math.cos(ba + side * 0.25) * bl, y: p.y + Math.sin(ba + side * 0.25) * bl * sq };
        lines.push({ pts: [{ ...p, t: 0 }, { ...q, t: 0.5 }, { ...e, t: 1 }], width: (o.width ?? 2.4) * 0.7, from: p.t });
      }
    }
  }
  return lines;
}

/** 多角形の割れ（同心の割れ・律の菱形）。corners の頂点を結んで閉じる。t は一周の進み */
function polyCrack(corners, width) {
  const pts = [];
  const n = corners.length;
  for (let i = 0; i <= n; i++) {
    const c = corners[i % n];
    if (c) pts.push({ x: c.x, y: c.y, t: i / n });
  }
  return { pts, width, from: 0 };
}

/** 地割れを描く。grow で根元から先へ伸び、芯は光り（glow）、縁は暗い溝。erosion で欠けて消える */
function drawCracks(frame, lines, o) {
  const { grow, glow, erosion, seed } = o;
  for (const line of lines) {
    const g = line.from > 0 ? clamp01((grow - line.from) / (1 - line.from)) : grow;
    if (g <= 0) continue;
    const n = line.pts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = line.pts[k];
      const b = line.pts[k + 1];
      if (!a || !b || a.t >= g) continue;
      const cut = b.t > g ? (g - a.t) / (b.t - a.t) : 1;
      const bx = a.x + (b.x - a.x) * cut;
      const by = a.y + (b.y - a.y) * cut;
      const taper = o.taper ?? 0.55;
      const w0 = line.width * (1 - a.t * taper);
      const w1 = line.width * (1 - Math.min(b.t, g) * taper);
      const pad = w0 + 2;
      paintScreen(
        frame,
        (sx, sy) => {
          const s = segment(sx, sy, a.x, a.y, bx, by);
          const w = (w0 + (w1 - w0) * s.t) / 2 + 0.5;
          if (s.d > w) return -1;
          const q = s.d / w;
          if (!survives(sx, sy, erosion, 1 - q, seed + k)) return -1;
          const tipFade = 1 - 0.35 * taper * (a.t + (b.t - a.t) * s.t) / 0.55;
          if (q < 0.5) return clamp01((0.26 + glow * 0.5) * tipFade);
          return 0.16;
        },
        { x0: Math.min(a.x, bx) - pad, y0: Math.min(a.y, by) - pad, x1: Math.max(a.x, bx) + pad, y1: Math.max(a.y, by) + pad },
        { dither: 0 },
      );
    }
  }
}

/** 四角い石の破片（画面に揃う）。地面に沿って外へ飛び減速し、跳ねた感じは大きさの膨らみで出す */
function rocks(frame, age, o) {
  if (age < 0) return;
  const { count, seed, aim, spread, speed } = o;
  const r0 = o.r0 ?? 6;
  const big = o.size ?? 3;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const sq = o.sq ?? SQ;
  for (let i = 0; i < count; i++) {
    const rnd = (k) => hash1(i * 13 + k, seed);
    const life = 3 + Math.floor(rnd(1) * 3) + (o.life ?? 0);
    if (age > life) continue;
    const a = spread >= TAU - 0.01 ? aim + rnd(2) * TAU : aim + (rnd(2) - 0.5) * spread;
    const sp = speed * (0.55 + 0.7 * rnd(3));
    const drag = 0.78;
    const travel = ((1 - Math.pow(drag, age + 1)) / (1 - drag)) * 2;
    const r = r0 + rnd(4) * 4 + sp * travel;
    const sx = ox + Math.cos(a) * r;
    const sy = oy + Math.sin(a) * r * sq;
    const t = age / life;
    const base = 2 + Math.floor(rnd(5) * big);
    const s = Math.max(1, Math.round(base * (0.8 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.3)))) - (t > 0.8 ? 1 : 0));
    block(frame, frame.cx + sx, frame.cy + sy, s, Math.max(4, Math.round(6.4 - 2.6 * t)), s >= 3 && t < 0.7);
  }
}

/** 石 1 個（格子座標 gx, gy が中心、一辺 s、明るさ L）。暗い縁取りで、亀裂や輪の上でも塊に見せる */
function block(frame, gx, gy, s, L, shadow) {
  const x0 = Math.floor(gx - s / 2);
  const y0 = Math.floor(gy - s / 2);
  for (let yy = -1; yy <= s; yy++) for (let xx = -1; xx <= s; xx++) frame.raise(x0 + xx, y0 + yy, 1);
  for (let yy = 0; yy < s; yy++) {
    for (let xx = 0; xx < s; xx++) {
      let lv = L - 1;
      if (yy === 0 || xx === 0) lv = L;
      if (s > 1 && (yy === s - 1 || xx === s - 1)) lv = Math.max(2, L - 2);
      frame.set(x0 + xx, y0 + yy, lv);
    }
  }
  if (shadow) for (let xx = 0; xx < s; xx++) frame.raise(x0 + xx, y0 + s + 1, 1);
}

/** 低い砂煙（暗い段だけ）。輪の縁に沿った塊が外へ広がって薄れる */
function dust(frame, age, o) {
  if (age < 0) return;
  const { count, r0, r1, seed, span } = o;
  const aim = o.aim ?? 0;
  const spread = o.spread ?? TAU;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const t = clamp01(age / span);
  for (let i = 0; i < count; i++) {
    const a = spread >= TAU - 0.01 ? aim + (i / count) * TAU + (hash1(i, seed) - 0.5) * 0.5 : aim + (hash1(i, seed) - 0.5) * spread;
    const r = r0 + (r1 - r0) * easeOut(t) * (0.8 + 0.3 * hash1(i, seed + 1));
    const cx = ox + Math.cos(a) * r;
    const cy = oy + Math.sin(a) * r * SQ;
    const size = (o.size ?? 5) * (0.7 + 0.5 * hash1(i, seed + 2)) * (0.8 + 0.7 * t);
    const thin = 0.3 + t * 0.75;
    paintScreen(
      frame,
      (sx, sy) => {
        const dx = (sx - cx) / size;
        const dy = (sy - cy) / (size * 0.62);
        const d = Math.hypot(dx, dy);
        if (d > 1) return -1;
        if (valueNoise(sx + i * 31, sy, 3.2, seed + 3) + (1 - d) * 0.45 < thin + 0.35) return -1;
        return clamp01((0.42 - 0.22 * t) * (0.6 + 0.6 * (1 - d)));
      },
      { x0: cx - size - 1, y0: cy - size - 1, x1: cx + size + 1, y1: cy + size + 1 },
      { dither: 0.02 },
    );
  }
}

/** 打撃の星（画面に揃った 4 本の太い光芒 + 短い斜め）。中心だけ白い */
function impactStar(frame, sx0, sy0, R, bright = 1) {
  paintScreen(
    frame,
    (sx, sy) => {
      const dx = sx - sx0;
      const dy = (sy - sy0) / 0.8;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const main = R * (0.34 + 0.66 * Math.pow(Math.abs(Math.cos(2 * th)), 5));
      const diag = R * 0.62 * (0.4 + 0.6 * Math.pow(Math.abs(Math.sin(2 * th)), 6));
      const lim = Math.max(main, diag);
      if (r > lim) return -1;
      return clamp01(Math.pow(1 - r / lim, 0.8) * 1.15 * bright);
    },
    { x0: sx0 - R - 1, y0: sy0 - R - 1, x1: sx0 + R + 1, y1: sy0 + R + 1 },
    { dither: 0 },
  );
}

/** 叩いた跡のくぼみ（潰れた楕円の暗い底 + 盛り上がった縁） */
function crater(frame, r, o) {
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 21;
  const cx = o.cx ?? 0;
  const cy = o.cy ?? 0;
  paintScreen(
    frame,
    (sx, sy) => {
      const d = Math.hypot(sx - cx, (sy - cy) / SQ) / r;
      if (d > 1) return -1;
      if (!survives(sx, sy, erosion, 1 - d, seed)) return -1;
      if (d > 0.72) return 0.42 * (o.bright ?? 1);
      return 0.13;
    },
    { x0: cx - r - 1, y0: cy - r * SQ - 1, x1: cx + r + 1, y1: cy + r * SQ + 1 },
    { dither: 0 },
  );
}

/** 画面の上へ立ちのぼる鉄の火花（1〜2 ドット）。age はフレーム、spawn は hash で決める */
function risingSparks(frame, age, count, seed, o) {
  if (age < 0) return;
  for (let i = 0; i < count; i++) {
    const rnd = (k) => hash1(i * 11 + k, seed);
    const life = 3 + Math.floor(rnd(1) * 3);
    if (age > life) continue;
    const a = rnd(2) * TAU;
    const r = o.r0 + rnd(3) * (o.r1 - o.r0);
    const x = (o.ox ?? 0) + Math.cos(a) * r + (rnd(4) - 0.5) * age * 1.5;
    const y = (o.oy ?? 0) + Math.sin(a) * r * SQ - age * (2.5 + rnd(5) * 3);
    const lv = Math.max(2, Math.round(6 - (age / life) * 3.5));
    frame.raise(Math.floor(frame.cx + x), Math.floor(frame.cy + y), lv);
    if (rnd(6) > 0.5 && age < life - 1) frame.raise(Math.floor(frame.cx + x), Math.floor(frame.cy + y + 1), Math.max(1, lv - 2));
  }
}

// -----------------------------------------------------------------------------
// 天墜（nova 半径 60・重）: 天から落ちて周囲を割る。通常の溜め叩き（半径 50）より一回り大きく、段を多くする
// dirs 1（全周に均等。地面の物は画面に揃う）
// -----------------------------------------------------------------------------

/** 当たりの半径（60 論理 px × 2） */
const SKY_R = 120;
const SKY_N = 12;
const SKY_A = 4;
/** 地割れ 14 本の形（全フレームで同じ形。伸びて・冷えて・欠ける） */
const SKY_CRACKS = makeCracks(-Math.PI / 2, { count: 14, len: 116, spread: TAU, seed: 7110, branch: 0.85, width: 4.4, segs: 6, forward: 0, r0: 18 });
/** 同心の割れ（半径 50 前後の 13 角形。叩いた衝撃で石板が丸く割れた縁） */
const SKY_RING_CRACK = polyCrack(
  Array.from({ length: 13 }, (_, i) => {
    const a = (i / 13) * TAU;
    const r = 52 * (0.86 + 0.28 * hash1(i, 7120));
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * SQ };
  }),
  3,
);

function skyK(f) {
  return f < SKY_A ? 0 : (f - SKY_A + 1) / (SKY_N - SKY_A + 1);
}

/** 天墜の空中の層: 大きな打撃の星・全周の石・輪の前縁の外を走る押し出しの風（壁へ叩きつける勢い） */
function skyfallAir(frame, f) {
  const k = skyK(f);
  if (f === 0) impactStar(frame, 0, 0, 36, 1.1);
  if (f === 1) impactStar(frame, 0, 0, 50, 1.05);
  if (f === 2) impactStar(frame, 0, 0, 30, 0.75);
  if (f === 0) sparkle(frame, 0, -2, 4);
  rocks(frame, f - 1, { count: 30, aim: 0, spread: TAU, speed: 10.5, size: 5, life: 2, r0: 20, seed: 7101 });
  // 押し出しの風: 外輪の前縁のすぐ外に外向きの短い筋（内側に離して引かない）。3 枚ずつ時間差で間引く
  const span = SKY_N - 1;
  if (f >= 1 && k < 0.75) {
    const R = SKY_R * 0.2 + SKY_R * 0.8 * easeOut((f - 0) / (span * 0.6));
    for (let i = 0; i < 18; i++) {
      if ((i + f) % 3 === 0) continue;
      const a = (i / 18) * TAU + hash1(i, 7102) * 0.25;
      const r0 = R + 4 + hash1(i, 7103) * 4;
      const r1 = r0 + 10 + 10 * hash1(i, 7104) * (1 - k);
      screenLine(frame, Math.cos(a) * r0, Math.sin(a) * r0 * SQ, Math.cos(a) * r1, Math.sin(a) * r1 * SQ, 1.2, 0.62 * (1 - k));
    }
  }
  // 外輪が広がりきった瞬間、四方の縁に光点（叩いた力が外周まで届いた合図）
  if (f === SKY_A - 1 || f === SKY_A) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * TAU;
      const R = SKY_R * 0.2 + SKY_R * 0.8 * easeOut(f / (span * 0.6));
      sparkle(frame, Math.cos(a) * R, Math.sin(a) * R * SQ, f === SKY_A - 1 ? 3 : 2);
    }
  }
}

/** 天墜の地面の層: 深いくぼみ・長い地割れ 14 本と枝・同心の割れ・大きな輪 2 枚・広い砂煙 */
function skyfallGround(frame, f) {
  const k = skyK(f);
  const erosion = k > 0.3 ? (k - 0.3) * 1.3 : 0;
  const glow = f < SKY_A ? 1 - f * 0.1 : Math.max(0, 0.6 - k * 0.8);
  drawCracks(frame, SKY_CRACKS, { grow: clamp01((f + 1) / SKY_A), glow, erosion, seed: 7111 });
  drawCracks(frame, [SKY_RING_CRACK], { grow: clamp01((f - 0.5) / 2.5), glow: glow * 0.9, erosion, seed: 7121, taper: 0 });
  if (k < 0.95) crater(frame, 28, { erosion: k * 0.9, seed: 7131, bright: f < SKY_A ? 1 : 0.7 });
  dust(frame, f - 1, { count: 26, r0: 72, r1: 134, size: 9, seed: 7141, span: SKY_N - 1 });
  ringAt(frame, f, SKY_R, { delay: 0, width: 8, start: 0.2, span: SKY_N - 1, seed: 7151 });
  ringAt(frame, f, SKY_R * 0.78, { delay: 2, width: 5, bright: 0.7, span: SKY_N - 3, seed: 7152 });
}

/**
 * 天墜の発動: 天から落ちてきた跡。頭上から足元へ太い縦の筋が刺さり、上（尾）から縮んで消える。
 * 叩きつけ（行為 0）と同じ瞬間に出るので、「落ちてきた」は筋の縮みで見せる
 */
function skyfallCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  const LINES = [
    { x: 0, w: 9, top: -170 },
    { x: -12, w: 5, top: -140 },
    { x: 12, w: 5, top: -148 },
    { x: -22, w: 2.6, top: -110 },
    { x: 22, w: 2.6, top: -116 },
  ];
  LINES.forEach((l, i) => {
    const bottom = FEET_Y - 2 - Math.abs(l.x) * 0.3;
    const top = l.top + (bottom - l.top) * Math.pow(k, 0.8) * (1 + i * 0.08);
    if (top >= bottom - 4) return;
    const x = l.x * (1 + k * 0.4);
    paintScreen(
      frame,
      (sx, sy) => {
        if (sy < top || sy > bottom) return -1;
        const t = (sy - top) / (bottom - top);
        const half = (l.w / 2) * (0.35 + 0.65 * t);
        const q = Math.abs(sx - x) / Math.max(0.5, half);
        if (q > 1) return -1;
        // 白は中央の 1 本の芯だけ（f 0〜1）
        const core = i === 0 && q < 0.3 && f <= 1 ? 1 : 0.78;
        return clamp01(core * (0.35 + 0.65 * t) * (1 - k * 0.5));
      },
      { x0: x - l.w, y0: top, x1: x + l.w, y1: bottom },
      { dither: 0 },
    );
  });
  // 着いた足元で左右へ吹く風（地面すれすれの短い横の筋）
  if (f >= 1 && k < 0.9) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = FEET_Y - 6 + Math.floor(i / 2) * 5;
      const x0 = side * (14 + f * 7);
      screenLine(frame, x0, y, x0 + side * (14 + hash1(i, 7161) * 10), y + 1, 1.2, 0.55 * (1 - k));
    }
  }
  if (f === 1) sparkle(frame, 0, FEET_Y - 4, 3);
}

// -----------------------------------------------------------------------------
// 砕地（volley 3 本・12° ずつ・半径 8・貫通）: 前の地面を叩き割り、地を走る 3 本の衝撃波を放つ
// -----------------------------------------------------------------------------

/** 鎚頭が地面を打つ位置（自分の前 13 論理 px） */
const SMASH_AT = 26;
const SMASH_N = 9;
const SMASH_A = 3;

/** 砕地の叩いた点（画面の座標）。行為の絵は照準の向き（frame.angle）へ回す */
function smashPoint(frame) {
  return { x: Math.cos(frame.angle) * SMASH_AT, y: Math.sin(frame.angle) * SMASH_AT };
}

/** 砕地の空中の層: 叩いた点の星と、前の扇へ跳ねる石 */
function groundSmashAir(frame, f) {
  const p = smashPoint(frame);
  if (f === 0) impactStar(frame, p.x, p.y, 20, 1.1);
  if (f === 1) impactStar(frame, p.x, p.y, 26, 1);
  if (f === 2) impactStar(frame, p.x, p.y, 15, 0.7);
  rocks(frame, f - 1, { count: 18, aim: frame.angle, spread: 90 * DEG, speed: 6, size: 4, life: 1, ox: p.x, oy: p.y, r0: 4, seed: 7201 });
  rocks(frame, f - 1, { count: 6, aim: frame.angle + Math.PI, spread: 120 * DEG, speed: 3, size: 2, ox: p.x, oy: p.y, r0: 4, seed: 7202 });
}

/** 砕地の地面の層: くぼみ・前へ走る 3 本の太い地割れ（弾の道筋と同じ ±12°）・くぼみの周りの短い割れ・輪 */
function groundSmashGround(frame, f) {
  const A = SMASH_A;
  const k = f < A ? 0 : (f - A + 1) / (SMASH_N - A + 1);
  const p = smashPoint(frame);
  const erosion = k > 0.3 ? (k - 0.3) * 1.3 : 0;
  const glow = f < A ? 1 : Math.max(0, 0.7 - k * 0.8);
  // 3 本の地割れは実際の弾の向きへ走らせる（縦を潰さない）。弾の道筋を先に割って見せる
  const main = makeCracks(frame.angle, { count: 3, len: 180, spread: 24 * DEG, jitter: 0.1, zig: 0.45, seed: 7210, branch: 0.7, width: 4.6, segs: 8, forward: 0, sq: 1, ox: p.x, oy: p.y, r0: 6 });
  drawCracks(frame, main, { grow: clamp01((f + 1) / (A + 1)), glow, erosion, seed: 7211 });
  const side = makeCracks(frame.angle + Math.PI, { count: 6, len: 24, spread: 220 * DEG, seed: 7220, width: 2.2, forward: 0, ox: p.x, oy: p.y, r0: 8 });
  drawCracks(frame, side, { grow: clamp01((f + 1) / 2), glow: glow * 0.8, erosion, seed: 7221 });
  if (k < 0.95) crater(frame, 14, { cx: p.x, cy: p.y, erosion: k * 0.9, seed: 7231, bright: f < A ? 1 : 0.7 });
  ringAt(frame, f, 44, { cx: p.x, cy: p.y, delay: 0, width: 5.5, start: 0.3, span: SMASH_N - 2, seed: 7241 });
  dust(frame, f - 1, { count: 10, r0: 18, r1: 50, size: 7, aim: frame.angle, spread: 150 * DEG, ox: p.x, oy: p.y, seed: 7251, span: SMASH_N - 1 });
}

/**
 * 重い振りの風圧の帯（hammer.mjs の airBand を写した）。帯の外縁も内縁もぼけ、鎚頭の先端だけ明るい
 */
function airBand(frame, o) {
  const { R, T, head, tail } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 31;
  const span = Math.max(1e-3, head - tail);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const s = wrapAngle(head - Math.atan2(y, x));
      const u = s / span;
      if (u < -0.02 || u > 1) return -1;
      const w = T * (u < 0.08 ? Math.sqrt(Math.max(0, (u + 0.02) / 0.1)) : Math.pow(1 - (u - 0.08) / 0.92, 0.6));
      const mid = R - T * 0.45;
      const q = Math.abs(r - mid) / (w / 2);
      if (q > 1 || w < 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      const band = Math.floor((r - mid) / 2.2);
      const flow = valueNoise(s * R * 0.35, band * 7, 6, seed + band) * 0.35;
      const cross = Math.pow(1 - q, 0.7);
      return clamp01((cross * (0.62 - 0.4 * u) + flow * (1 - u) * cross) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 4, y0: -R - 4, x1: R + 4, y1: R + 4 } },
  );
}

/** 鎚頭の塊（進む向きに少し長い楕円）。白は芯の数ドットだけ */
function hammerHead(frame, a, rad, size, bright) {
  const hx = Math.cos(a) * rad;
  const hy = Math.sin(a) * rad;
  const tx = -Math.sin(a);
  const ty = Math.cos(a);
  paint(
    frame,
    (x, y) => {
      const dx = x - hx;
      const dy = y - hy;
      const d = Math.hypot((dx * tx + dy * ty) / (size * 1.25), (dx * Math.cos(a) + dy * Math.sin(a)) / size);
      if (d > 1) return -1;
      return clamp01((0.5 + 0.42 * Math.pow(1 - d, 1.6)) * bright);
    },
    { bounds: { x0: hx - size * 1.4 - 2, y0: hy - size * 1.4 - 2, x1: hx + size * 1.4 + 2, y1: hy + size * 1.4 + 2 } },
  );
}

/**
 * 砕地の発動: 後ろから頭上を越えて前の地面へ振り下ろす 1 本の風圧の帯（通常の振りより厚い）。
 * 振り下ろしの先（前）で鎚頭が光り、そこから行為 0 の叩きつけにつながる
 */
function groundSmashCast(frame, f) {
  const N = 7;
  const A = 3;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const from = -150 * DEG;
  const to = 0;
  const p = f < A ? (1 - Math.cos(Math.PI * ((f + 1) / A))) / 2 : 1;
  const head = from + (to - from) * p;
  const tail = f < A ? from + (to - from) * Math.max(0, p - 0.7) : to - (to - from) * 0.7 * (1 - Math.pow(k, 0.7));
  const R = 40;
  const T = 22 * (f < A ? 0.75 + 0.25 * p : 1 - 0.35 * k);
  airBand(frame, { R: R + k * 4, T, head, tail, erosion: k > 0 ? 0.1 + 0.8 * Math.pow(k, 1.2) : 0, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k, seed: 7261 });
  if (k < 0.34) hammerHead(frame, head, R - T * 0.45, 11 * (1 - k), f < A ? 1 : 0.8);
  // 速度線は帯の外側だけ
  if (k < 0.8 && head - tail > 0.2) {
    for (let i = 0; i < 2; i++) {
      const len = (head - tail) * (0.45 + 0.2 * hash1(i, 7262)) * (1 - k);
      const end = head - (head - tail) * 0.12;
      arcLine(frame, { radius: R + 4 + i * 5 + k * 4, from: end - len, to: end, width: 1.2, bright: (0.55 - i * 0.14) * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, Math.cos(head) * (R - T * 0.45), Math.sin(head) * (R - T * 0.45), 3);
}

// --- 砕地の弾（shots[0]）: 地を走る衝撃波 --------------------------------------

/** 弾の半径（8 論理 px）の絵の半幅 */
const WAVE_HALF = 16;
/** 割れ目の尾の長さ（速さ 210px/秒 × 0.1 秒ぶん。地面に残る割れなので曳光より長く引く） */
const WAVE_TAIL = 46;
const WAVE_N = 8;
/** 尾の割れ目の 1 節の長さ（1 フレームで弾が進むドットに近づけ、節が地面に留まって見えるようにする） */
const WAVE_SEG = 12;

/**
 * 前縁: 前へふくらむ土の盛り上がり（1 本）。前縁に岩の歯が並び、歯の高さはフレームで入れ替わる（土を押し割り続ける）。
 * 前縁の細い線が明部、白は中央の数ドットだけ。後ろへ暗くなる
 */
function waveFront(frame, o) {
  const { f, half, depth } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 7301;
  const bulge = o.bulge ?? 8;
  paint(
    frame,
    (x, y) => {
      const v = y / half;
      if (Math.abs(v) > 1) return -1;
      // 岩の歯: 4 ドットごとの帯で前縁が段になる
      const band = Math.floor((y + half) / 4);
      const tooth = 2.5 * hash1(band * 7 + f, seed);
      const front = bulge * (1 - v * v) + tooth - 2;
      const d = front - x;
      const dep = depth * (1 - 0.55 * v * v);
      if (d < 0 || d > dep) return -1;
      const q = d / dep;
      if (!survives(x, y, erosion, 1 - q, seed + 3)) return -1;
      if (d < 1.4) return clamp01((Math.abs(v) < 0.3 ? 1 : 0.8) * bright * (1 - erosion * 0.5));
      const grain = valueNoise(x, y + f * 3, 2.5, seed + 5) * 0.2;
      return clamp01((0.62 * Math.pow(1 - q, 1.2) + grain) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -depth - 4, y0: -half - 2, x1: bulge + 4, y1: half + 2 } },
  );
}

/**
 * 尾の割れ目（正準座標の折れ線）。折れ点は左右交互で、1 巡に 2 節ぶん後ろへ流す
 * （弾は前へ進むので地面の割れは後ろへ流れて見える。2 節ずらすと左右の並びが元に戻り、継ぎ目が出ない）
 */
function waveTrail(frame, f, o) {
  const glow = o.glow ?? 1;
  const erosion = o.erosion ?? 0;
  const len = o.len ?? WAVE_TAIL;
  const shift = (2 * (f % WAVE_N)) / WAVE_N;
  const nodeY = (n) => (n % 2 === 0 ? -1 : 1) * (2.2 + 1.6 * hash1(n % 2, 7311));
  const pts = [{ x: -2, y: 0 }];
  for (let n = 0; n < 12; n++) {
    const x = -2 - (n - 2 + shift) * WAVE_SEG;
    if (x >= -6) continue;
    const prev = pts[pts.length - 1];
    if (x <= -len) {
      // 尾の端: 直前の折れ点との間を切って止める
      if (prev) {
        const t = (prev.x + len) / (prev.x - x);
        pts.push({ x: -len, y: prev.y + (nodeY(n) - prev.y) * t });
      }
      break;
    }
    pts.push({ x, y: nodeY(n) });
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const t0 = -a.x / len;
    const t1 = -b.x / len;
    paint(
      frame,
      (x, y) => {
        const s = segment(x, y, a.x, a.y, b.x, b.y);
        const t = t0 + (t1 - t0) * s.t;
        const w = 2.6 * (1 - 0.6 * t) + 0.5;
        if (s.d > w) return -1;
        const q = s.d / w;
        if (!survives(x, y, erosion + t * 0.35, 1 - q, 7312 + i)) return -1;
        if (q < 0.5) return clamp01((0.28 + 0.5 * glow) * (1 - 0.6 * t));
        return 0.16;
      },
      { bounds: { x0: Math.min(a.x, b.x) - 4, y0: Math.min(a.y, b.y) - 4, x1: Math.max(a.x, b.x) + 4, y1: Math.max(a.y, b.y) + 4 }, dither: 0 },
    );
  }
}

/** 正準座標の石 1 個（弾の絵は回るので、位置だけ回して石は画面に揃える） */
function canonRock(frame, x, y, s, L) {
  const g = frame.toGrid(x, y);
  block(frame, g.x, g.y, s, L, false);
}

/** 砕地の弾が飛ぶ間: 前へふくらむ土の盛り上がり + 後ろに光る割れ目 + 両脇で跳ねる石 */
function smashFly(frame, f) {
  const cycle = f / WAVE_N;
  waveFront(frame, { f, half: WAVE_HALF, depth: 11, bright: 1 });
  waveTrail(frame, f, { glow: 1 });
  // 両脇の石: 前縁の脇で跳ね上がり、後ろへ流れて落ちる（位相が 1 周で戻るので継ぎ目なし）
  for (let i = 0; i < 6; i++) {
    const t = (cycle + i / 6 + hash1(i, 7321) * 0.1) % 1;
    const side = i % 2 === 0 ? -1 : 1;
    const x = 2 - t * 40;
    const y = side * (WAVE_HALF * (0.7 + 0.35 * hash1(i, 7322)) + t * 4);
    const s = Math.max(1, Math.round(1 + 2.5 * Math.sin(Math.PI * t)));
    if (t > 0.9) continue;
    canonRock(frame, x, y, s, Math.max(4, Math.round(6.5 - 2.5 * t)));
  }
  // 脇の砂煙（暗い段）: 前縁の角から後ろへ
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const t = (cycle + i * 0.5) % 1;
    const cx = -4 - t * 22;
    const cy = side * (WAVE_HALF - 2 + t * 5);
    const size = 4 + t * 3;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / size;
        if (d > 1) return -1;
        if (valueNoise(x + i * 13, y, 3, 7323) + (1 - d) * 0.5 < 0.55 + t * 0.4) return -1;
        return clamp01((0.36 - 0.16 * t) * (0.6 + 0.6 * (1 - d)));
      },
      { bounds: { x0: cx - size - 1, y0: cy - size - 1, x1: cx + size + 1, y1: cy + size + 1 } },
    );
  }
}

/** 砕地の弾の出どころ: 地面が前へめくれ上がる（小さな前縁の盛り上がりが立ち上がる）と、前の扇へ跳ねる石 */
function smashMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  if (f <= 2) waveFront(frame, { f, half: WAVE_HALF * (0.6 + 0.25 * f), depth: 8 + f * 3, bulge: 5 + f * 3, bright: 1 - f * 0.1, seed: 7331 });
  else waveFront(frame, { f, half: WAVE_HALF * 1.1, depth: 12, bulge: 11, bright: 0.8, erosion: 0.3 + k * 0.6, seed: 7331 });
  if (f === 0) sparkle(frame, 4, 0, 3);
  for (let i = 0; i < 8; i++) {
    const rnd = (j) => hash1(i * 7 + j, 7332);
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 4 + rnd(2) * 4;
    const travel = (1 - Math.pow(0.75, f + 1)) / 0.25;
    if (f > 2 + Math.floor(rnd(3) * 2)) continue;
    const s = Math.max(1, 2 + Math.floor(rnd(4) * 2) - (f > 2 ? 1 : 0));
    canonRock(frame, 4 + Math.cos(a) * sp * travel, Math.sin(a) * sp * travel, s, 6 - f);
  }
}

/** 砕地の弾が壁で止まる: 前縁が壁に砕け、石が後ろと両脇へ跳ね返り、壁ぎわに砂煙が立つ */
function smashImpact(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f === 0) impactStar(frame, frame.cos * 4, frame.sin * 4, 14, 1);
  if (f === 1) impactStar(frame, frame.cos * 4, frame.sin * 4, 10, 0.75);
  // 壁ぎわの横一列の砂煙（進む向きに直交）
  paint(
    frame,
    (x, y) => {
      if (Math.abs(y) > WAVE_HALF + 6 + f * 3) return -1;
      const d = Math.abs(x - 2 + f) / (4 + f * 1.5);
      if (d > 1) return -1;
      if (valueNoise(x, y, 3, 7341) + (1 - d) * 0.4 < 0.45 + k * 0.5) return -1;
      return clamp01((0.45 - 0.25 * k) * (0.6 + 0.6 * (1 - d)));
    },
    { bounds: { x0: -12, y0: -WAVE_HALF - 28, x1: 14, y1: WAVE_HALF + 28 } },
  );
  for (let i = 0; i < 12; i++) {
    const rnd = (j) => hash1(i * 7 + j, 7342);
    const life = 3 + Math.floor(rnd(1) * 3);
    if (f > life) continue;
    // 跳ね返り: 後ろ半分の扇（壁から戻る）
    const a = Math.PI + (rnd(2) - 0.5) * 2.6;
    const sp = 3 + rnd(3) * 4;
    const travel = (1 - Math.pow(0.78, f + 1)) / 0.22;
    const s = Math.max(1, 2 + Math.floor(rnd(4) * 3) - (f > 3 ? 1 : 0));
    canonRock(frame, Math.cos(a) * sp * travel, (rnd(5) - 0.5) * 10 + Math.sin(a) * sp * travel, s, Math.max(4, 6 - Math.floor(f / 2)));
  }
}

/** 砕地の弾が敵に当たる（貫いて進むので毎回）: 打ち抜く向きへ長い星と、敵の足元から突き上がる石 */
function smashHit(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.75 : f === 1 ? 1 : 0.6;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const th = Math.atan2(y, x);
        const len = 20 * s * (x > 0 ? 1.3 : 0.75);
        const main = len * (0.36 + 0.64 * Math.pow(Math.abs(Math.cos(2 * th)), 4));
        const diag = len * 0.6 * (0.4 + 0.6 * Math.pow(Math.abs(Math.sin(2 * th)), 5));
        const lim = Math.max(main, diag);
        if (r > lim) return -1;
        return clamp01((0.35 + 0.6 * Math.pow(1 - r / lim, 1.2)) * (f === 2 ? 0.85 : 1.1));
      },
      { bounds: { x0: -20, y0: -22, x1: 30, y1: 22 } },
    );
  }
  // 足元から突き上がる岩の牙: 敵の周りに 5 本の尖った岩（下が太く上へ尖る）。画面の上へ立つ
  for (let i = 0; i < 5; i++) {
    const rise = f < 2 ? (f + 1) / 2 : Math.max(0, 1 - (f - 2) / (N - 3));
    if (rise <= 0) continue;
    const a = frame.angle + (i - 2) * 0.7 + (hash1(i, 7351) - 0.5) * 0.3;
    const bx = Math.cos(a) * (10 + hash1(i, 7352) * 6);
    const by = Math.sin(a) * (10 + hash1(i, 7352) * 6) * SQ + 6;
    const h = (9 + hash1(i, 7353) * 7) * rise;
    const w = 3 + hash1(i, 7354) * 2;
    paintScreen(
      frame,
      (sx, sy) => {
        const t = (by - sy) / h;
        if (t < 0 || t > 1) return -1;
        const half = w * (1 - t);
        const d = sx - bx;
        if (Math.abs(d) > half) return -1;
        // 左の面が明るい（光が左上から）
        return clamp01((d < 0 ? 0.72 : 0.45) * (1 - k * 0.3));
      },
      { x0: bx - w - 1, y0: by - h - 1, x1: bx + w + 1, y1: by + 1 },
      { dither: 0 },
    );
  }
  rocks(frame, f - 1, { count: 8, aim: frame.angle, spread: 200 * DEG, speed: 3.6, size: 2, r0: 4, seed: 7355 });
}

/** 砕地の弾が射程で尽きる: 盛り上がりが沈んで崩れ、冷えた割れ目と砂煙が残る */
function smashFizzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  waveFront(frame, { f, half: WAVE_HALF * (1 - 0.3 * k), depth: 11 * (1 - 0.4 * k), bulge: 8 - k * 5, bright: 0.8 - 0.3 * k, erosion: 0.15 + 0.85 * k, seed: 7361 });
  waveTrail(frame, 0, { glow: Math.max(0, 0.5 - k), erosion: k * 0.9, len: WAVE_TAIL * (1 - 0.5 * k) });
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot((x - 2) / (8 + f * 2), y / (WAVE_HALF + f * 2));
      if (d > 1) return -1;
      if (valueNoise(x, y, 3, 7362) + (1 - d) * 0.45 < 0.5 + k * 0.45) return -1;
      return clamp01(0.36 * (1 - 0.5 * k) * (0.6 + 0.6 * (1 - d)));
    },
    { bounds: { x0: -12, y0: -WAVE_HALF - 14, x1: 16, y1: WAVE_HALF + 14 } },
  );
}

// -----------------------------------------------------------------------------
// 鉄槌の律（持続。当てた所で半径 44 の衝撃波）: 菱形の「律の紋」が共通の印
// -----------------------------------------------------------------------------

/** 菱形の頂点（画面の座標。地面に寝かせるので縦は SQ） */
function diamond(cx, cy, R) {
  return [
    { x: cx, y: cy - R * SQ },
    { x: cx + R, y: cy },
    { x: cx, y: cy + R * SQ },
    { x: cx - R, y: cy },
  ];
}

/** 鉄の律の杭: 菱形の頂点に立つ短い縦の光（地面から画面の上へ）。白は使わず明部まで */
function stake(frame, x, y, h, w, bright) {
  if (h < 2 || bright <= 0) return;
  paintScreen(
    frame,
    (sx, sy) => {
      const t = (y - sy) / h;
      if (t < 0 || t > 1) return -1;
      const half = (w / 2) * (1 - 0.6 * t);
      const q = Math.abs(sx - x) / half;
      if (q > 1) return -1;
      return clamp01((0.8 - 0.45 * t) * (1 - 0.35 * q) * bright);
    },
    { x0: x - w, y0: y - h - 1, x1: x + w, y1: y + 1 },
    { dither: 0.02 },
  );
}

const LAW_R = 44;

/** 鉄槌の律の発動（空中）: 足元の星・菱形の頂点に立ちのぼる 4 本の杭・立ちのぼる鉄の火花・跳ねる石 */
function ironLawCastAir(frame, f) {
  if (f === 0) impactStar(frame, 0, FEET_Y, 16, 1);
  if (f === 1) impactStar(frame, 0, FEET_Y, 22, 0.95);
  if (f === 2) impactStar(frame, 0, FEET_Y, 12, 0.7);
  // 杭: 菱形の割れが頂点に届いた順（右 → 下 → 左 → 上）に立つ
  diamond(0, FEET_Y, LAW_R).forEach((c, i) => {
    const age = f - 1 - i * 0.5;
    if (age < 0) return;
    const rise = Math.min(1, (age + 1) / 2);
    const fade = Math.max(0, (age - 2) / 4);
    if (fade >= 1) return;
    stake(frame, c.x, c.y, 46 * rise * (1 + fade * 0.2), 9, 1 - fade);
    if (Math.floor(age) === 1) sparkle(frame, c.x, c.y - 46, 2);
  });
  risingSparks(frame, f - 1, 22, 7401, { r0: 10, r1: LAW_R, oy: FEET_Y });
  rocks(frame, f - 1, { count: 10, aim: 0, spread: TAU, speed: 4, size: 3, oy: FEET_Y, r0: 8, seed: 7402 });
}

/** 鉄槌の律の発動（地面）: くぼみ・一周して閉じる菱形の割れ・頂点から外への割れ・輪 */
function ironLawCastGround(frame, f) {
  const N = 10;
  const k = f < 4 ? 0 : (f - 3) / (N - 3);
  const erosion = k > 0.4 ? (k - 0.4) * 1.4 : 0;
  const glow = f < 4 ? 1 : Math.max(0, 0.75 - k * 0.7);
  const corners = diamond(0, FEET_Y, LAW_R);
  drawCracks(frame, [polyCrack(corners, 3.4)], { grow: clamp01((f + 0.5) / 3), glow, erosion, seed: 7411, taper: 0 });
  const outer = corners.flatMap((c, i) => {
    const a = Math.atan2((c.y - FEET_Y) / SQ, c.x);
    return makeCracks(a, { count: 1, len: 30, spread: 0, seed: 7412 + i, width: 2.6, segs: 3, forward: 0, ox: c.x, oy: c.y, r0: 2 });
  });
  drawCracks(frame, outer, { grow: clamp01((f - 1.5) / 2), glow, erosion, seed: 7420 });
  if (k < 0.95) crater(frame, 10, { cy: FEET_Y, erosion: k * 0.9, seed: 7421 });
  ringAt(frame, f, 64, { cy: FEET_Y, delay: 0, width: 5, start: 0.25, span: N - 1, seed: 7422 });
}

/** 纏いの 1 巡のフレーム数 */
const LAW_N = 12;
/** 巡る鉄塊の数（1 巡で 1 個ぶん進めて継ぎ目を消す） */
const LAW_CHUNKS = 4;

/**
 * 鉄槌の律の纏い（空中）: 腰の高さを 4 つの鉄塊がゆっくり巡る（重さで引き寄せられた塊）。
 * 奥（画面の上側）を通る塊は小さく暗く、手前は大きく明るい。ときどき塊に光点
 */
function ironLawSustain(frame, f) {
  const cycle = f / LAW_N;
  for (let i = 0; i < LAW_CHUNKS; i++) {
    const a = ((i + cycle) / LAW_CHUNKS) * TAU + Math.PI / 4;
    const near = Math.sin(a);
    const x = Math.cos(a) * 34;
    const bob = Math.sin((cycle + i / LAW_CHUNKS) * TAU * 2) * 1.5;
    const y = 6 + near * 34 * SQ + bob;
    // 軌跡: 塊の後ろ（反時計回りの側）へ楕円に沿って細る短い弧（1 本。塊ごとに 1 本だけ）
    const TRAIL = 0.9;
    paintScreen(
      frame,
      (sx, sy) => {
        const dy = (sy - 6 - bob) / SQ;
        const r = Math.hypot(sx, dy);
        const u = wrapAngle(a - Math.atan2(dy, sx)) / TRAIL;
        if (u < 0.05 || u > 1) return -1;
        const half = 2.2 * (1 - u) + 0.3;
        if (Math.abs(r - 34) > half) return -1;
        return clamp01((0.55 - 0.35 * u) * (0.7 + 0.3 * (0.5 + 0.5 * near)));
      },
      { x0: -40, y0: 6 + bob - 40 * SQ, x1: 40, y1: 6 + bob + 40 * SQ },
      { dither: 0.03 },
    );
    const s = Math.round(6 + near * 1.5);
    const L = Math.round(5.6 + near * 0.9);
    block(frame, frame.cx + x, frame.cy + y, s, L, near > 0);
  }
  if (f === 3) sparkle(frame, -20, -6, 2);
  if (f === 9) sparkle(frame, 22, 10, 2);
}

/** 鉄槌の律の纏い（地面）: 足元の菱形の紋（脈打つ）・頂点の点・1 巡に 1 回外へ出る小さな輪 */
function ironLawSustainGround(frame, f) {
  const cycle = f / LAW_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  const corners = diamond(0, FEET_Y, 30);
  drawCracks(frame, [polyCrack(corners, 2)], { grow: 1, glow: 0.15 + 0.35 * pulse, erosion: 0, seed: 7431, taper: 0 });
  for (const c of corners) {
    const g = { x: frame.cx + c.x, y: frame.cy + c.y };
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) frame.raise(Math.floor(g.x) + xx, Math.floor(g.y) + yy, Math.abs(xx) + Math.abs(yy) === 2 ? 2 : Math.round(4 + 1.5 * pulse));
  }
  const t = cycle;
  groundRing(frame, { cy: FEET_Y, r: 16 + 28 * easeOut(t), width: 2.6 * (1 - 0.5 * t), erosion: t > 0.4 ? (t - 0.4) * 1.5 : 0, bright: 0.55 * (1 - 0.5 * t), seed: 7432 });
}

/** 衝撃波の半径（44 論理 px × 2） */
const QUAKE_R = 88;
const QUAKE_N = 9;
const QUAKE_A = 3;

function quakeK(f) {
  return f < QUAKE_A ? 0 : (f - QUAKE_A + 1) / (QUAKE_N - QUAKE_A + 1);
}

/** 当てた所の衝撃波（空中）: 打撃の星・頂点に立つ短い杭（律の印）・全周の石 */
function ironLawQuakeAir(frame, f) {
  if (f === 0) impactStar(frame, 0, 0, 16, 1.05);
  if (f === 1) impactStar(frame, 0, 0, 20, 0.95);
  if (f === 2) impactStar(frame, 0, 0, 11, 0.7);
  diamond(0, 0, 32).forEach((c, i) => {
    const age = f - 1;
    if (age < 0 || age > 4) return;
    const rise = Math.min(1, (age + 1) / 2);
    stake(frame, c.x, c.y, 20 * rise, 4.4, 1 - age / 5);
    if (age === 1 && i % 2 === 0) sparkle(frame, c.x, c.y - 20, 2);
  });
  rocks(frame, f - 1, { count: 14, aim: frame.angle, spread: TAU, speed: 5, size: 3, r0: 8, seed: 7501 });
}

/** 当てた所の衝撃波（地面）: 菱形の割れ・頂点と辺から外への割れ・当たりの輪・砂煙 */
function ironLawQuakeGround(frame, f) {
  const k = quakeK(f);
  const erosion = k > 0.3 ? (k - 0.3) * 1.3 : 0;
  const glow = f < QUAKE_A ? 1 : Math.max(0, 0.65 - k * 0.8);
  drawCracks(frame, [polyCrack(diamond(0, 0, 32), 3)], { grow: clamp01((f + 1) / 2), glow, erosion, seed: 7511, taper: 0 });
  const out = makeCracks(0, { count: 8, len: 76, spread: TAU, seed: 7512, branch: 0.4, width: 3, segs: 4, forward: 0, r0: 30 });
  drawCracks(frame, out, { grow: clamp01((f + 0.5) / QUAKE_A), glow, erosion, seed: 7513 });
  ringAt(frame, f, QUAKE_R, { delay: 0, width: 6, start: 0.3, span: QUAKE_N - 1, seed: 7514 });
  dust(frame, f - 1, { count: 14, r0: 50, r1: 96, size: 7, seed: 7515, span: QUAKE_N - 1 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 天墜の base は周囲攻撃の半径。砕地の叩きつけは拡縮しない（0）で、弾は半径 8 で描く。衝撃波の base は hitQuake の半径
 */
const FX = {
  moveset: "hammer",
  ultimates: {
    "hammer.skyfall": {
      ramp: "light",
      cast: { sheet: "hammerUlt.skyfallCast", life: 0.3 },
      acts: [{ sheet: "hammerUlt.skyfall", life: 0.72, base: SKY_R / 2, pivot: "pos", ground: "hammerUlt.skyfallGround" }],
    },
    "hammer.groundSmash": {
      ramp: "brass",
      cast: { sheet: "hammerUlt.groundSmashCast", life: 0.28 },
      acts: [{ sheet: "hammerUlt.groundSmash", life: 0.5, base: 0, pivot: "pos", ground: "hammerUlt.groundSmashGround" }],
      shots: {
        0: {
          fly: "hammerUlt.groundSmashFly",
          period: 0.3,
          base: WAVE_HALF / 2,
          muzzle: "hammerUlt.groundSmashMuzzle",
          impact: "hammerUlt.groundSmashImpact",
          hit: "hammerUlt.groundSmashHit",
          fizzle: "hammerUlt.groundSmashFizzle",
          ramp: "brass",
        },
      },
    },
    "hammer.ironLaw": {
      ramp: "steel",
      cast: { sheet: "hammerUlt.ironLawCast", life: 0.55, ground: "hammerUlt.ironLawCastGround" },
      quake: { sheet: "hammerUlt.ironLawQuake", life: 0.45, base: QUAKE_R / 2, ground: "hammerUlt.ironLawQuakeGround" },
      sustain: { sheet: "hammerUlt.ironLaw", period: 1.2, ground: "hammerUlt.ironLawGround" },
    },
  },
};

export const ATLAS = {
  key: "hammerUlt",
  fx: FX,
  sheets: [
    { key: "hammerUlt.skyfall", dirs: 1, frames: SKY_N, active: SKY_A, size: 2 * (SKY_R + 36), draw: skyfallAir },
    { key: "hammerUlt.skyfallGround", dirs: 1, frames: SKY_N, active: SKY_A, size: 2 * (SKY_R + 22), draw: skyfallGround },
    { key: "hammerUlt.skyfallCast", dirs: 1, frames: 7, active: 0, size: 2 * 180, draw: skyfallCast },
    { key: "hammerUlt.groundSmash", dirs: DIRS, frames: SMASH_N, active: SMASH_A, size: 176, draw: groundSmashAir },
    { key: "hammerUlt.groundSmashGround", dirs: DIRS, frames: SMASH_N, active: SMASH_A, size: 2 * (SMASH_AT + 184), draw: groundSmashGround },
    { key: "hammerUlt.groundSmashCast", dirs: DIRS, frames: 7, active: 0, size: 128, draw: groundSmashCast },
    { key: "hammerUlt.groundSmashFly", dirs: 32, frames: WAVE_N, active: 0, size: 2 * (WAVE_TAIL + 12), draw: smashFly },
    { key: "hammerUlt.groundSmashMuzzle", dirs: DIRS, frames: 5, active: 0, size: 80, draw: smashMuzzle },
    { key: "hammerUlt.groundSmashImpact", dirs: DIRS, frames: 6, active: 0, size: 96, draw: smashImpact },
    { key: "hammerUlt.groundSmashHit", dirs: DIRS, frames: 7, active: 0, size: 96, draw: smashHit },
    { key: "hammerUlt.groundSmashFizzle", dirs: DIRS, frames: 6, active: 0, size: 2 * (WAVE_TAIL + 12), draw: smashFizzle },
    { key: "hammerUlt.ironLawCast", dirs: 1, frames: 10, active: 0, size: 176, draw: ironLawCastAir },
    { key: "hammerUlt.ironLawCastGround", dirs: 1, frames: 10, active: 0, size: 2 * (64 + 24), draw: ironLawCastGround },
    { key: "hammerUlt.ironLaw", dirs: 1, frames: LAW_N, active: 0, size: 112, draw: ironLawSustain },
    { key: "hammerUlt.ironLawGround", dirs: 1, frames: LAW_N, active: 0, size: 128, draw: ironLawSustainGround },
    { key: "hammerUlt.ironLawQuake", dirs: 1, frames: QUAKE_N, active: QUAKE_A, size: 2 * (QUAKE_R - 20), draw: ironLawQuakeAir },
    { key: "hammerUlt.ironLawQuakeGround", dirs: 1, frames: QUAKE_N, active: QUAKE_A, size: 2 * (QUAKE_R + 20), draw: ironLawQuakeGround },
  ],
};
