// 鉈（moveset "cleaver"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は cleaver.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/cleaver.json × 2 が目安
//
// 鉈の形の言葉（cleaver.mjs と同じ）: 外縁が折れ線（面）の分厚い楔、鈍い四角の頭、四角いブロックの崩れ、四角い肉片、地面のひび。
// 奥義はそれを一段大きく・長く・崩れの段を多くする。剣で固まった決まり（1 振り 1 本・白は縁と光点だけ・反りは前へ）は守る。
// 3 本の描き分け:
// - 血肉断ち（前方 160° の一振り）: 最大の面取りの楔が振り抜け、通った跡から血の粒が接線へ噴き、頭の先で床が割れる
// - 首落とし（周囲 44）: 12 の面を持つ多角形の刃が一周して閉じ、角張った輪が押し広がって四角く砕ける。地面に多角形の枠とひび
// - 修羅（持続）: 鋸歯の縁を持つ角張った闘気が立ちのぼり、頭の後ろに角のような 2 本の炎。終わりは炎がしおれて灰が落ちる
import { easeSwing, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

/** 角を [0, 2π) に（一周する刃は wrapAngle の (-π, π] では足りない） */
function wrapTau(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

// -----------------------------------------------------------------------------
// 共通の部品（cleaver.mjs の鉈の形を写し、奥義の大きさに合わせて作り変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定。座標を blk ドットの格子に丸めてからノイズを引くので、四角いブロックで欠ける（鉈の崩れ） */
function survivesBlock(x, y, erosion, near, seed, blk = 3) {
  if (erosion <= 0) return true;
  const bx = Math.floor(x / blk) * blk;
  const by = Math.floor(y / blk) * blk;
  const n = valueNoise(bx, by, 6, seed) * 0.55 + hash1(Math.floor(bx * 7.3 + by * 131), seed + 3) * 0.25;
  return n + near * 0.45 - erosion * 1.15 > 0;
}

/** 振りの進み: active の間は p、以降は崩れの k（0..1） */
function phase(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/**
 * 面取りした弧（鉈の振りの軌跡）。外縁は facet 度ごとの折れ線、面ごとに明るさが違う（叩いた面が並ぶ）。
 * head 側は鈍い四角の頭、尾側 taper の割合で直線的に細る楔形。振り幅は 180° 未満（wrapAngle で測る）
 */
function facetArc(frame, o) {
  const { R, T, head, tail } = o;
  const span = Math.max(1e-3, head - tail);
  const step = o.facet * DEG;
  const base = o.facetFrom ?? 0;
  const bevel = o.bevel ?? 0.08;
  const taper = o.taper ?? 0.6;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const body = o.body ?? 1;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 1) return -1;
      const a = Math.atan2(y, x);
      const s = wrapAngle(head - a);
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      const i = Math.floor((a - base) / step);
      const mid = base + (i + 0.5) * step;
      const rOut = (R * Math.cos(step / 2)) / Math.cos(a - mid);
      const wHead = u < bevel ? 0.62 + 0.38 * (u / bevel) : 1;
      const wTail = u > 1 - taper ? (1 - u) / taper : 1;
      const w = T * Math.min(wHead, wTail);
      if (w < 1) return -1;
      const d = rOut - r;
      const q = d / w;
      if (q < 0 || q > 1) return -1;
      if (!survivesBlock(x, y, erosion, (1 - q) * (1 - u), seed, 4)) return -1;
      // 刃の縁: 外縁の 2.5 ドットを白く（頭側 8 割）。頭の平らな面も明るく、四角い頭を立たせる
      if (d < 2.6 && u < 0.8 && erosion < 0.5) return clamp01(bright * (1.08 - 0.25 * u));
      if (s * r < 2.6 && erosion < 0.4) return clamp01(0.8 * bright);
      // 内縁は暗い縁取り（分厚い刃の影）
      if (w - d < 1.8) return 0.16;
      const facetTone = 0.84 + 0.26 * hash1(i, seed + 11);
      // 面の中に 1 本、峰に沿う暗い溝（鉈の刃の厚み。奥義の刃は「重ねた鋼」に見せる）
      const groove = Math.abs(q - 0.55) < 0.05 ? 0.72 : 1;
      return clamp01(Math.pow(1 - q, 0.85) * (0.95 - 0.45 * u) * facetTone * groove * body * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

/**
 * 一周できる面取りの刃（首落とし）。head = 先端の角、len = 先端から尾までの長さ（2π まで）。
 * 外縁は facet 度ごとの多角形。closed（0..1）で太さを一様に寄せ、先端と尾がつながった 1 本の多角形の輪にする
 */
function facetRing(frame, o) {
  const { R, T, head, len } = o;
  const closed = o.closed ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const step = o.facet * DEG;
  const base = o.facetFrom ?? 0;
  const span = Math.max(1e-3, len);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 1) return -1;
      const a = Math.atan2(y, x);
      const s = wrapTau(head - a);
      const u = s / span;
      if (u > 1) return -1;
      const i = Math.floor(wrapTau(a - base) / step);
      const mid = base + (i + 0.5) * step;
      const rOut = (R * Math.cos(step / 2)) / Math.cos(wrapAngle(a - mid));
      const wHead = u < 0.05 ? 0.6 + 0.4 * (u / 0.05) : 1;
      const wTail = u > 0.5 ? (1 - u) / 0.5 : 1;
      const w = T * Math.max(Math.min(wHead, wTail) * (1 - closed), closed * 0.6);
      if (w < 1) return -1;
      const d = rOut - r;
      const q = d / w;
      if (q < 0 || q > 1) return -1;
      if (!survivesBlock(x, y, erosion, (1 - q) * (1 - u * (1 - closed)), seed, 4)) return -1;
      const edgeU = closed > 0.5 ? 1 : 0.7;
      if (d < 2.4 && u <= edgeU && erosion < 0.5) return clamp01(bright * (1.06 - 0.25 * u * (1 - closed)));
      if (closed < 0.5 && s * r < 2.6 && erosion < 0.4) return clamp01(0.8 * bright);
      if (w - d < 1.7) return 0.16;
      const facetTone = 0.82 + 0.3 * hash1(i, seed + 11);
      const fall = 0.95 - 0.5 * u * (1 - closed);
      return clamp01(Math.pow(1 - q, 0.75) * fall * facetTone * bright * (1 - erosion * 0.42));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

/**
 * 直線の切り口（割れ目）。a → b の線に沿う、後ろ（a）が楔に細り前（b）が鈍く四角い分厚い帯。
 * 芯（段 7）は中央線の 1 ドットだけ、周りは暗い縁で締める
 */
function cleaveBar(frame, o) {
  const { ax, ay, bx, by, T } = o;
  const grow = o.grow ?? 1;
  const back = o.back ?? 0.45;
  const front = o.front ?? 0.1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 7;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const pad = T + 3;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const t = (px * tx + py * ty) / len;
      if (t < 0 || t > grow) return -1;
      const g = t / grow;
      const across = -px * ty + py * tx;
      const w = (T / 2) * Math.min(1, g / back, (1 - g) / front + 0.35);
      if (w < 0.6) return -1;
      const q = Math.abs(across) / w;
      if (q > 1) return -1;
      if (!survivesBlock(x, y, erosion, 1 - q, seed)) return -1;
      if (Math.abs(across) < 0.8 && g > 0.15 && erosion < 0.45) return bright;
      if (q > 0.82) return 0.17;
      const side = across < 0 ? 1 : 0.8;
      return clamp01((0.35 + 0.55 * (1 - q)) * side * (0.75 + 0.25 * g) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad } },
  );
}

/** 線分を太さ width で塗る（ひびの 1 本分）。明るさは a → b で v0 → v1 */
function thickSeg(frame, ax, ay, bx, by, width, v0, v1, erosion, seed) {
  const pad = width + 2;
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, ax, ay, bx, by);
      if (s.d > width / 2) return -1;
      if (!survivesBlock(x, y, erosion, 0.3, seed, 2)) return -1;
      return v0 + (v1 - v0) * s.t;
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0, samples: 2 },
  );
}

/**
 * 地面のひび。原点 (cx, cy) から branches 本が折れ線で伸びる（角 = angle(j) 基準、節ごとにがたつく）。
 * p（0..1）で伸び、erosion で欠ける。根元ほど太く明るい
 */
function cracks(frame, o) {
  const { cx, cy, branches, length, p, seed } = o;
  const erosion = o.erosion ?? 0;
  const segs = o.segs ?? 5;
  const jag = o.jag ?? 0.9;
  const w0 = o.width ?? 2.6;
  const bright = o.bright ?? 1;
  for (let j = 0; j < branches; j++) {
    let a = o.angle(j, (k) => hash1(j * 7 + k, seed));
    const total = length * (0.6 + 0.4 * hash1(j, seed + 1));
    const segLen = total / segs;
    let x = cx;
    let y = cy;
    const reach = total * p;
    for (let s = 0; s < segs; s++) {
      if (s * segLen >= reach) break;
      a += (hash1(j * 31 + s, seed + 2) - 0.5) * jag;
      const l = Math.min(segLen, reach - s * segLen) * (0.8 + 0.4 * hash1(j * 17 + s, seed + 3));
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      const f0 = s / segs;
      const f1 = (s + 1) / segs;
      const w = Math.max(1, w0 * (1 - f0 * 0.7));
      thickSeg(frame, x, y, nx, ny, w, (0.62 - 0.3 * f0) * bright, (0.62 - 0.3 * f1) * bright, erosion, seed + j);
      if (s === 2 && hash1(j, seed + 4) > 0.45) {
        const ba = a + (hash1(j, seed + 5) > 0.5 ? 1 : -1) * (0.7 + 0.4 * hash1(j, seed + 6));
        thickSeg(frame, nx, ny, nx + Math.cos(ba) * segLen * 0.9, ny + Math.sin(ba) * segLen * 0.9, 1, 0.34 * bright, 0.24 * bright, erosion, seed + j + 50);
      }
      x = nx;
      y = ny;
    }
  }
}

/**
 * 四角い破片（肉片・石片）。等比減速で飛び、回りながら小さくなる。
 * spawn(i, rnd) → { x, y, vx, vy, life, size, rot?, spin?, drag?, gy?, dim? }（gy は 1 フレームごとに足す落下）
 */
function chunks(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const c = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!c || age < 0 || age > c.life) continue;
    const drag = c.drag ?? 0.8;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const x = c.x + c.vx * travel;
    const y = c.y + c.vy * travel + (c.gy ?? 0) * age * age * 0.5;
    const fade = 1 - age / (c.life + 1);
    const size = c.size * (1 - 0.35 * (age / (c.life + 1)));
    const v = (0.3 + 0.62 * fade) * (c.dim ?? 1);
    if (size < 2.2) {
      dot(frame, x, y, Math.max(2, Math.round((2 + 4 * fade) * (c.dim ?? 1))));
      continue;
    }
    const rot = (c.rot ?? 0) + (c.spin ?? 0.5) * age;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const h = size / 2;
    paint(
      frame,
      (px, py) => {
        const lx = (px - x) * cs + (py - y) * sn;
        const ly = -(px - x) * sn + (py - y) * cs;
        if (Math.abs(lx) > h || Math.abs(ly) > h) return -1;
        if (lx + ly > h * 0.9) return v * 0.45;
        return v * (lx + ly < -h * 0.6 ? 1.05 : 0.82);
      },
      { bounds: { x0: x - h * 1.5 - 1, y0: y - h * 1.5 - 1, x1: x + h * 1.5 + 1, y1: y + h * 1.5 + 1 }, samples: 2, dither: 0 },
    );
  }
}

/** 角の立った八角形の衝撃の枠（丸い輪の代わり）。半径 hx × hy、太さ width、cut で角の面取り */
function boxRing(frame, o) {
  const { hx, hy, width } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.7;
  const seed = o.seed ?? 9;
  const cut = o.cut ?? 0.3;
  paint(
    frame,
    (x, y) => {
      const dx = Math.abs(x - ox);
      const dy = Math.abs(y - oy);
      const cx = cut * Math.min(hx, hy);
      const d = Math.max(dx - hx, dy - hy, (dx + dy - (hx + hy - cx)) * Math.SQRT1_2);
      if (Math.abs(d) > width / 2) return -1;
      const q = Math.abs(d) / (width / 2);
      if (!survivesBlock(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.45 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: ox - hx - width - 2, y0: oy - hy - width - 2, x1: ox + hx + width + 2, y1: oy + hy + width + 2 } },
  );
}

/** 正多角形の枠（n 角形、外接半径 R、太さ width）。squash で縦に潰す（地面に置いた枠）。rot で回す */
function polyRing(frame, o) {
  const { n, R, width } = o;
  const oy = o.oy ?? 0;
  const rot = o.rot ?? 0;
  const squash = o.squash ?? 1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.5;
  const seed = o.seed ?? 11;
  const step = TAU / n;
  paint(
    frame,
    (x, y0) => {
      const y = (y0 - oy) * squash;
      const a = Math.atan2(y, x);
      const i = Math.floor(wrapTau(a - rot) / step);
      const mid = rot + (i + 0.5) * step;
      const rEdge = (R * Math.cos(step / 2)) / Math.cos(wrapAngle(a - mid));
      const d = Math.abs(Math.hypot(x, y) - rEdge);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      if (!survivesBlock(x, y0, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.4 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - width - 2, y0: oy - (R + width) / squash - 2, x1: R + width + 2, y1: oy + (R + width) / squash + 2 } },
  );
}

/** 丸い血の粒（上側に照り）。四角い肉片と見分けるため丸く、速いうちは飛ぶ向きの逆に短い筋を引く */
function drop(frame, x, y, rad, v, vx, vy) {
  const sp = Math.hypot(vx, vy);
  if (sp > 2) streakLine(frame, { ax: x - vx * 1.4, ay: y - vy * 1.4, bx: x, by: y, bright: v * 0.7 });
  if (rad < 1.2) {
    dot(frame, x, y, Math.max(2, Math.round(2 + 5 * v)));
    return;
  }
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > rad) return -1;
      return clamp01(v * (1 - 0.4 * (d / rad)) * (py - y < -rad * 0.3 ? 1.12 : 0.9));
    },
    { bounds: { x0: x - rad - 1, y0: y - rad - 1, x1: x + rad + 1, y1: y + rad + 1 }, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 血肉断ち（swing arc 160° reach 46）: 最大の面取りの楔。通った跡から血の粒が噴き、頭の先で床が割れる
// -----------------------------------------------------------------------------

/** 外縁の半径（reach 46 論理 px × 2） */
const REND_R = 92;
/** 刃の最も太い所（通常の最終段 42 より一段分厚い） */
const REND_T = 46;
const REND_SWEEP = 160;
const REND_N = 12;
const REND_A = 5;
const REND_SEED = 5101;

function fleshRendSlash(frame, f) {
  const half = (REND_SWEEP * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const A = REND_A;
  const N = REND_N;
  const { p, k } = phase(f, A, N);
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  if (f < A) {
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - 0.8) * 0.5;
    bright = 0.86 + 0.14 * p;
  } else {
    head = from + sweep * (1 + 0.03 * k);
    tail = from + sweep * Math.min(0.95, 0.1 + 0.85 * Math.pow(k, 0.8));
    erosion = 0.05 + 0.85 * Math.pow(k, 1.15);
    bright = 1 - 0.3 * k;
  }
  // 振り切りの瞬間（f = A）にもう一度だけ太らせる（押し込み）。以降は内側から痩せる
  const T = REND_T * (f < A ? 0.72 + 0.28 * ((f + 1) / A) : f === A ? 1.06 : 1 - 0.4 * k);
  facetArc(frame, { R: REND_R, T, head, tail, facet: 20, facetFrom: from, taper: 0.55, erosion, bright, body: 0.82, seed: REND_SEED });
  // 速度線: 外縁のすぐ外、頭の後ろに 3 本の直線（弦）。折れ線の刃なので弧ではなく直線
  if (k < 0.7) {
    for (let i = 0; i < 3; i++) {
      const rr = REND_R + 3 + i * 3.5 + k * 6;
      const a1 = head - (0.06 + 0.05 * i) * sweep;
      const a0 = a1 - (0.3 + 0.15 * hash1(i, REND_SEED + 40)) * (head - tail) * (1 - k);
      if (a1 - a0 < 0.05) continue;
      streakLine(frame, { ax: Math.cos(a0) * rr, ay: Math.sin(a0) * rr, bx: Math.cos(a1) * rr, by: Math.sin(a1) * rr, width: i === 0 ? 2 : 1.2, bright: (0.62 - i * 0.1) * (1 - k) });
    }
  }
  if (f === A - 1 || f === A) {
    const tipR = REND_R - T * 0.3;
    sparkle(frame, Math.cos(head) * tipR, Math.sin(head) * tipR, f === A - 1 ? 4 : 3);
  }
  rendBlood(frame, f, from, sweep);
  // 振り切りで頭の先から大きな肉片が、刃の進む向き（接線）と外へ
  if (f >= A - 1) {
    const age = f - (A - 1);
    chunks(frame, age, 16, REND_SEED + 60, (i, rnd) => {
      const a = from + sweep * (0.72 + 0.28 * rnd(1));
      const r = REND_R + 1 - REND_T * 0.3 * rnd(2);
      const sp = 5.5 * (0.6 + 0.8 * rnd(3));
      const out = 0.3 + 0.5 * rnd(4);
      return {
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
        vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
        life: 4 + Math.floor(rnd(5) * 4),
        size: 2 + rnd(6) * 3.4,
        rot: rnd(7) * 3,
        spin: (rnd(8) - 0.5) * 1.2,
      };
    });
    // 振り抜いた頭の先で床が割れる: 刃の進んだ先（接線）と外へ扇に開くひび
    const endA = from + sweep * 0.9;
    const hr = REND_R + 2;
    cracks(frame, {
      cx: Math.cos(endA) * hr,
      cy: Math.sin(endA) * hr,
      branches: 3,
      length: 44,
      width: 3.4,
      segs: 4,
      jag: 0.6,
      p: Math.min(1, (age + 1) / 2.5),
      erosion: Math.max(0, k - 0.35) * 1.3,
      seed: REND_SEED + 80,
      angle: (j, rnd) => endA - 0.3 + (j - 1) * 0.75 + (rnd(1) - 0.5) * 0.3,
    });
  }
}

/**
 * 血の粒: 刃の頭がその角を通り過ぎた瞬間に、切り口（刃の中ほど）から接線（刃の進む向き）と外へ噴く。
 * 頭の通過に合わせて角ごとに遅れて出るので、刃の後ろに血の帯が引かれる（深い出血）
 */
function rendBlood(frame, f, from, sweep) {
  const A = REND_A;
  for (let i = 0; i < 44; i++) {
    const r = (m) => hash1(i * 11 + m, REND_SEED + 20);
    const at = 0.1 + 0.9 * r(1);
    // 頭がこの角を通るフレーム（easeSwing の逆を近似: 枚数に均して割り当てる）
    const born = Math.min(A, Math.floor(Math.pow(at, 1.6) * A) + (r(7) > 0.6 ? 1 : 0));
    const age = f - born;
    const life = 4 + Math.floor(r(5) * 4);
    if (age < 0 || age > life) continue;
    const a = from + sweep * at;
    const r0 = REND_R + 2 - REND_T * 0.25 * r(2);
    const out = 0.5 + 0.45 * r(3);
    const big = r(4);
    const sp = (12 - big * 6) * (0.7 + 0.5 * r(6));
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const vx0 = (tx * (1 - out) + Math.cos(a) * out) * sp;
    const vy0 = (ty * (1 - out) + Math.sin(a) * out) * sp;
    const drag = 0.76;
    const travel = (1 - Math.pow(drag, age + 1)) / (1 - drag);
    const x = Math.cos(a) * r0 + vx0 * travel;
    const y = Math.sin(a) * r0 + vy0 * travel;
    const fade = 1 - age / (life + 1);
    const rad = (0.9 + big * 2.6) * (1 - 0.3 * (age / (life + 1)));
    const vNow = Math.pow(drag, age);
    drop(frame, x, y, rad, 0.35 + 0.55 * fade, vx0 * vNow, vy0 * vNow);
  }
}

/**
 * 血肉断ちの発動: 刃を後ろ上へ振りかぶる。後ろに分厚い刃の影が起き上がって縁が光り、
 * 前から気が折れ線で刃へ吸い込まれ、振り下ろしの直前に足元で四角い衝撃が弾ける
 */
function fleshRendCast(frame, f) {
  const N = 8;
  const seed = 5201;
  // 振りかぶった刃: 自分の後ろ（−x）から斜め上（−y）へ伸びる分厚い楔。起き上がりながら太る
  if (f <= 4) {
    const g = Math.min(1, (f + 1) / 3);
    const erosion = f === 4 ? 0.5 : 0;
    const ang = Math.PI + 0.9 - 0.35 * g;
    cleaveBar(frame, { ax: -4, ay: 0, bx: -4 + Math.cos(ang) * 44, by: Math.sin(ang) * 44, T: 10 + 8 * g, grow: 0.5 + 0.5 * g, back: 0.3, front: 0.12, erosion, bright: 0.85 + 0.15 * g, seed });
    if (f === 2) sparkle(frame, -4 + Math.cos(ang) * 40, Math.sin(ang) * 40, 3);
  }
  // 吸い込まれる気: 前方の扇から刃の根元へ、折れ線（2 節）で集まる
  if (f <= 3) {
    const p = (f + 1) / 4;
    for (let i = 0; i < 6; i++) {
      const a = (i - 2.5) * 0.38 + (hash1(i, seed + 1) - 0.5) * 0.2;
      const r1 = 60 - 34 * p;
      const r0 = r1 - 14;
      const kink = (hash1(i, seed + 2) - 0.5) * 6;
      const mx = Math.cos(a) * (r0 + r1) * 0.5 + kink;
      const my = Math.sin(a) * (r0 + r1) * 0.5 - kink;
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: mx, by: my, width: i % 2 ? 1.2 : 1.8, bright: 0.35 + 0.35 * p });
      streakLine(frame, { ax: mx, ay: my, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: i % 2 ? 1.2 : 1.8, bright: 0.45 + 0.4 * p });
    }
  }
  // 踏み込み: 足元の四角い衝撃と肉片
  if (f >= 3) {
    const age = f - 3;
    const k = age / (N - 3);
    boxRing(frame, { hx: 12 + age * 8, hy: 12 + age * 8, cut: 0.5, width: 3.4 - age * 0.5, erosion: Math.min(0.92, 0.1 + k * 0.9), bright: 0.8 - k * 0.35, seed: seed + 3 });
    chunks(frame, age, 8, seed + 4, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 2 + rnd(4) * 1.8, rot: rnd(5) * 3 };
    });
  }
}

// -----------------------------------------------------------------------------
// 首落とし（nova 半径 44・処刑）: 12 面の多角形の刃が一周して閉じ、角張った輪が押し広がって四角く砕ける
// 向き（照準）から刃を走らせるので WIDE_DIRS（一周する大きな形なので 12 方向で足りる）
// -----------------------------------------------------------------------------

/** 輪の外縁の半径（44 論理 px × 2） */
const HEAD_R = 88;
const HEAD_T = 30;
/** 面の数（30° ごと。剣の円月の丸い輪と見分ける角張り） */
const HEAD_FACET = 30;
const HEAD_N = 12;
const HEAD_A = 5;
/** 斬り始めの角（照準の左。時計回りに前 → 右 → 後ろ → 左と一周する） */
const HEAD_FROM = -Math.PI / 2;
const HEAD_SEED = 6101;

function beheadingSlash(frame, f) {
  const A = HEAD_A;
  const k = f <= A ? 0 : (f - A) / (HEAD_N - 1 - A);
  let head;
  let len;
  let closed = 0;
  let T = HEAD_T;
  let R = HEAD_R;
  let bright = 1;
  let erosion = 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = HEAD_FROM + TAU * p;
    len = TAU * Math.min(0.92, 0.1 + p * 0.82);
    T = HEAD_T * (0.65 + 0.35 * p);
    bright = 0.86 + 0.14 * p;
  } else {
    // 閉じた瞬間（f = A）に多角形の輪が満ち、そのあと外へ押し広がりながら四角く砕ける
    head = HEAD_FROM + TAU;
    len = TAU;
    closed = 1;
    R = HEAD_R + Math.round(k * 16);
    T = HEAD_T * (f === A ? 0.85 : 0.72 * (1 - 0.5 * k));
    bright = f === A ? 1.1 : 1 - 0.3 * k;
    erosion = f === A ? 0 : 0.06 + 0.82 * Math.pow(k, 1.15);
  }
  facetRing(frame, { R, T, head, len, closed, erosion, bright, facet: HEAD_FACET, facetFrom: HEAD_FROM, seed: HEAD_SEED });
  // 速度線: 刃の外側、先端の後ろに直線の弦（折れ線の刃なので弧にしない）
  if (f < A) {
    for (let i = 0; i < 3; i++) {
      const rr = R + 3 + i * 3.4;
      const a1 = head - 0.12 - 0.12 * i;
      const a0 = a1 - Math.min(len * 0.45, 0.5 + 0.5 * hash1(i, HEAD_SEED + 1));
      streakLine(frame, { ax: Math.cos(a0) * rr, ay: Math.sin(a0) * rr, bx: Math.cos(a1) * rr, by: Math.sin(a1) * rr, width: i === 0 ? 1.8 : 1.1, bright: 0.6 - i * 0.12 });
    }
    if (f >= 1) {
      const tip = R - T * 0.3;
      sparkle(frame, Math.cos(head) * tip, Math.sin(head) * tip, f === A - 1 ? 4 : 3);
    }
  }
  // 閉じた瞬間: 多角形の角のうち 4 つが光る（処刑の刃が落ちる合図）
  if (f === A || f === A + 1) {
    for (let i = 0; i < 4; i++) {
      const a = HEAD_FROM + i * 3 * HEAD_FACET * DEG;
      sparkle(frame, Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), f === A ? 4 : 2);
    }
  }
  // 砕けた輪: 面ごとに大きな四角い破片が、接線（時計回り）と外へ
  if (f >= A) {
    chunks(frame, f - A, 36, HEAD_SEED + 2, (i, rnd) => {
      const a = HEAD_FROM + ((i % 12) + 0.5 + (rnd(1) - 0.5) * 0.8) * HEAD_FACET * DEG;
      const r = HEAD_R - HEAD_T * 0.4 * rnd(2);
      const sp = 5 + rnd(3) * 6;
      const out = 0.45 + 0.45 * rnd(4);
      const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp;
      const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 4), size: 3 + rnd(6) * 4, rot: rnd(7) * 3, spin: (rnd(8) - 0.5) * 1.4 };
    });
  }
}

/** 首落としの地面: 当たりの縁の多角形の枠と、閉じた瞬間に角から外へ走る短いひび（輪の外だけ。照準の印に見せない） */
function beheadingGround(frame, f) {
  const A = HEAD_A;
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < A ? 0 : (f - A + 1) / (HEAD_N - A);
  const dim = 0.44 * (1 - 0.4 * k);
  polyRing(frame, { n: 12, R: (HEAD_R - 2) * (0.72 + 0.28 * grow), width: 2.4, rot: HEAD_FROM, erosion: k * 0.9, bright: dim, seed: HEAD_SEED + 10 });
  polyRing(frame, { n: 12, R: HEAD_R * 0.55 * grow, width: 1.4, rot: HEAD_FROM + (HEAD_FACET * DEG) / 2, erosion: Math.min(0.95, k * 0.9 + 0.1), bright: dim * 0.8, seed: HEAD_SEED + 11 });
  if (f < A) return;
  const age = f - A;
  // ひび: 12 の角から外へ（輪が閉じた衝撃で床が割れる）
  for (let i = 0; i < 12; i++) {
    if (hash1(i, HEAD_SEED + 12) < 0.35) continue;
    const a = HEAD_FROM + i * HEAD_FACET * DEG;
    const r0 = HEAD_R - 4;
    cracks(frame, {
      cx: Math.cos(a) * r0,
      cy: Math.sin(a) * r0,
      branches: 1,
      length: 26,
      segs: 3,
      width: 2.8,
      jag: 0.7,
      p: Math.min(1, (age + 1) / 2),
      erosion: Math.max(0, k - 0.35) * 1.3,
      bright: 0.85,
      seed: HEAD_SEED + 20 + i,
      angle: (j, rnd) => a + (rnd(1) - 0.5) * 0.5,
    });
  }
}

/**
 * 処刑の刃（画面に揃えた横長の鉈の刃）。中心 (cx, cy)、幅 W、高さ H。上の峰は水平、下の刃は右下がりに斜め（ギロチンの刃）。
 * 下の縁 2 ドットが白い刃の縁、峰の側は暗い縁取り、面は縦の帯で叩いた鋼の面に見せる。erosion で四角く欠ける
 */
function execBlade(frame, o) {
  const { cx, cy, W, H } = o;
  const slope = o.slope ?? 0.28;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const top = cy - H / 2;
  paint(
    frame,
    (x, y) => {
      const lx = x - cx;
      if (Math.abs(lx) > W / 2) return -1;
      const bottom = cy + H / 2 + slope * lx;
      if (y < top || y > bottom) return -1;
      const d = bottom - y;
      const q = (y - top) / (bottom - top);
      if (!survivesBlock(x, y, erosion, q, seed)) return -1;
      if (d < 2.2 && erosion < 0.5) return clamp01(1.05 * bright);
      if (y - top < 1.6 || W / 2 - Math.abs(lx) < 1.6) return 0.17;
      const band = Math.floor((lx + W / 2) / 6);
      return clamp01((0.35 + 0.45 * q) * (0.85 + 0.25 * hash1(band, seed)) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: cx - W / 2 - 1, y0: top - 1, x1: cx + W / 2 + 1, y1: cy + H / 2 + slope * W / 2 + 2 } },
  );
}

/**
 * 首落としの発動: 頭上に横長の処刑の刃が掲げられて刃の縁が光り、足元へ落ちて平たい四角い衝撃が弾ける。
 * dirs 1（画面に揃える）: 刃は向きによらず画面の上から落ちる
 */
function beheadingCast(frame, f) {
  const seed = 6201;
  const FEET = 18;
  const W = 44;
  const H = 18;
  // 掲げた刃: 0〜3 枚で頭上へ上がりきって縁が光る
  if (f <= 3) {
    const lift = Math.min(1, (f + 1) / 3);
    const cy = -34 - 30 * lift;
    execBlade(frame, { cx: 0, cy, W: W * (0.7 + 0.3 * lift), H, bright: 0.8 + 0.2 * lift, seed });
    // 刃へ集まる気: 両脇の足元から刃の端へ
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (16 + Math.floor(i / 2) * 9);
      const y0 = FEET - f * 8;
      streakLine(frame, { ax: x, ay: y0, bx: x * 0.85, by: y0 - 26, width: 1.2, bright: 0.35 + 0.1 * f });
    }
    if (f === 3) sparkle(frame, W / 2 - 4, cy + H / 2 + 0.28 * (W / 2 - 4), 4);
    return;
  }
  const age = f - 4;
  const k = age / 5;
  if (age === 0) {
    // 落ちる刃: 足元の少し上まで落ち、上に落下の筋を残す
    execBlade(frame, { cx: 0, cy: FEET - 14, W, H, bright: 1, seed });
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 10;
      streakLine(frame, { ax: x, ay: -70 + hash1(i, seed + 5) * 10, bx: x, by: FEET - 26, width: i % 2 ? 1.2 : 2, bright: 0.55 });
    }
  } else if (age <= 3) {
    // 床に食い込んだ刃が四角く欠けて消える
    execBlade(frame, { cx: 0, cy: FEET - 8 + age, W, H: H - age * 2, erosion: 0.1 + 0.3 * age, bright: 0.95 - 0.15 * age, seed: seed + 2 });
  }
  if (age === 1) sparkle(frame, 0, FEET, 4);
  // 地面の平たい衝撃（横に長い八角形 = 床に置いた枠）
  boxRing(frame, { oy: FEET, hx: 26 + age * 11, hy: 7 + age * 4.5, cut: 0.45, width: 3.6 - age * 0.5, erosion: Math.min(0.92, 0.08 + k * 0.9), bright: 0.85 - k * 0.35, seed: seed + 3 });
  chunks(frame, age, 14, seed + 4, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const a = (side > 0 ? 0 : Math.PI) + (rnd(2) - 0.5) * 0.9 - side * 0.35;
    const sp = 3.5 + rnd(3) * 3.5;
    return { x: side * (8 + rnd(7) * 14), y: FEET, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, gy: 0.5, life: 3 + Math.floor(rnd(4) * 3), size: 2 + rnd(5) * 2.6, rot: rnd(6) * 3 };
  });
}

// -----------------------------------------------------------------------------
// 修羅（持続）: 鋸歯の縁の角張った闘気が立ちのぼり、頭の後ろに角のような 2 本の炎。dirs 1（立ちのぼる向きは画面の上）
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラの足元。キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 闘気の明るさの上限（白は光点だけに使う） */
const ASURA_CAP = 0.8;

/**
 * 角張った炎の 1 本（鋸歯の縁）。(x, y) が根元、h が高さ、w が根元の太さ。teeth で縁の歯の数、phase で歯が上へ流れる。
 * 剣気の滑らかな揺らめきと違い、輪郭は折れ線で先は楔に尖り、崩れは四角く欠ける
 */
function jagFlame(frame, o) {
  const { x: bx, y: by, h, w } = o;
  const lean = o.lean ?? 0;
  const teeth = o.teeth ?? 3;
  const ph = o.phase ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const cap = o.cap ?? ASURA_CAP;
  if (h < 3 || w < 1.5 || bright <= 0) return;
  paint(
    frame,
    (x, y) => {
      const t = (by - y) / h;
      if (t < 0 || t > 1) return -1;
      // 中心線は折れ線（2 節）で傾く: 根元は真っすぐ、上半分で lean へ折れる
      const cx = bx + lean * Math.max(0, t - 0.4) / 0.6;
      const body = Math.min(1, (t + 0.05) / 0.15) * Math.pow(1 - t, 0.75);
      // 鋸歯: 三角波で縁に歯を刻む（歯は上へ流れる）
      const saw = Math.abs(((((t * teeth - ph) % 1) + 1) % 1) - 0.5) * 2;
      const half = (w / 2) * body * (0.66 + 0.34 * saw);
      const d = x - cx;
      if (half < 0.6 || Math.abs(d) > half) return -1;
      const q = Math.abs(d) / half;
      if (!survivesBlock(x, y, erosion + t * 0.2, 1 - q, seed, 2)) return -1;
      if (q > 0.84) return 0.18;
      const edge = d < 0 ? 0.08 : -0.05;
      return Math.min(cap, clamp01((Math.pow(1 - q, 0.8) * (0.5 + 0.5 * (1 - t)) + edge) * bright));
    },
    { bounds: { x0: bx - w - Math.abs(lean) - 2, y0: by - h - 2, x1: bx + w + Math.abs(lean) + 2, y1: by + 2 } },
  );
}

/** 小さな四角い火の粉（2x2 ドット。剣気の丸い粒と見分ける） */
function ember(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(1, level - 1));
  dot(frame, x, y + 1, Math.max(1, level - 1));
  dot(frame, x + 1, y + 1, Math.max(1, level - 2));
}

/** 修羅の発動: 足元の八角形が弾け、鋸歯の闘気が一斉に噴き上がり、角の 2 本が最後に高く立って千切れる */
function asuraCast(frame, f) {
  const N = 11;
  const k = f / (N - 1);
  const seed = 7101;
  boxRing(frame, { oy: FEET_Y, hx: 10 + f * 7, hy: 4 + f * 3, cut: 0.45, width: 3 - k * 1.4, erosion: Math.min(0.92, k * 0.95), bright: 0.85 - k * 0.3, seed });
  if (f <= 2) boxRing(frame, { oy: FEET_Y, hx: 6 + f * 4, hy: 3 + f * 2, cut: 0.45, width: 2, bright: 0.7, seed: seed + 1 });
  // 噴き上がる闘気: 8 本。外寄りほど低く外へ折れ、時間差で伸びて四角く千切れる
  for (let i = 0; i < 8; i++) {
    const s = i - 3.5;
    const delay = Math.abs(s) * 0.4;
    const age = f - delay;
    if (age < 0) continue;
    const rise = Math.min(1, (age + 1) / 3);
    const fade = Math.max(0, (age - 3) / 5);
    if (fade >= 1) continue;
    jagFlame(frame, {
      x: s * 9 * (1 + fade * 0.4),
      y: FEET_Y + 4 - fade * 26,
      h: (100 - Math.abs(s) * 14) * rise * (1 + fade * 0.3),
      w: 26 - Math.abs(s) * 2.6,
      lean: s * 7,
      teeth: 3 + (i % 2),
      phase: f * 0.3 + i * 0.37,
      bright: 1.05 - fade * 0.4,
      erosion: fade * 0.9,
      seed: seed + 10 + i,
    });
  }
  // 角: 頭の後ろから左右へ反る 2 本（遅れて立ち、いちばん高い所で光る）
  if (f >= 2) {
    const age = f - 2;
    const rise = Math.min(1, (age + 1) / 3);
    const fade = Math.max(0, (age - 3) / 5);
    for (const side of [-1, 1]) {
      jagFlame(frame, { x: side * 12, y: -16 - fade * 20, h: 50 * rise, w: 14, lean: side * 20, teeth: 2, phase: age * 0.25, bright: 1.05 - fade * 0.4, erosion: fade * 0.9, seed: seed + 30 + side });
    }
    if (age === 2) {
      sparkle(frame, -28, -66, 3);
      sparkle(frame, 28, -66, 3);
    }
  }
  // 足元から外へ飛ぶ四角い石片と、上へ昇る四角い火の粉
  chunks(frame, f, 12, seed + 40, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const a = (side > 0 ? 0 : Math.PI) + (rnd(2) - 0.5) * 0.8 - side * 0.5;
    const sp = 3 + rnd(3) * 4;
    return { x: side * 6, y: FEET_Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gy: 0.45, life: 4 + Math.floor(rnd(4) * 3), size: 2 + rnd(5) * 2.2, rot: rnd(6) * 3 };
  });
  for (let i = 0; i < 16; i++) {
    const age = f - Math.floor(hash1(i, seed + 50) * 3);
    if (age < 0 || age > 7) continue;
    const x = (hash1(i, seed + 51) - 0.5) * 70;
    const y = FEET_Y - age * (5 + 4 * hash1(i, seed + 52));
    ember(frame, x + x * 0.03 * age, y, Math.max(2, 6 - Math.floor(age * 0.6)));
  }
}

/** 纏いの 1 巡のフレーム数 */
const ASURA_N = 12;
/**
 * 纏いの闘気の根元と位相。キャラの顔を覆わないよう左右に寄せる。
 * 頭の後ろの 2 本（horn）は外へ折れる角の形で、修羅の輪郭を作る
 */
const ASURA_FLAMES = [
  { x: -30, y: FEET_Y, h: 44, w: 10, lean: -8, phase: 0.0 },
  { x: -20, y: FEET_Y + 4, h: 60, w: 12, lean: -6, phase: 0.5 },
  { x: -12, y: FEET_Y + 6, h: 30, w: 9, lean: -3, phase: 0.25 },
  { x: 12, y: FEET_Y + 6, h: 32, w: 9, lean: 3, phase: 0.75 },
  { x: 20, y: FEET_Y + 4, h: 58, w: 12, lean: 6, phase: 0.15 },
  { x: 30, y: FEET_Y, h: 46, w: 10, lean: 8, phase: 0.6 },
  { x: -9, y: -20, h: 34, w: 8, lean: -14, phase: 0.4, horn: true },
  { x: 9, y: -20, h: 34, w: 8, lean: 14, phase: 0.9, horn: true },
];

/** 修羅の纏い（持続中ずっと。period 秒で 1 巡し、位相が一周するので継ぎ目が出ない） */
function asuraSustain(frame, f) {
  const cycle = f / ASURA_N;
  const seed = 7201;
  ASURA_FLAMES.forEach((fl, i) => {
    const t = (cycle + fl.phase) % 1;
    if (fl.horn) {
      // 角は根元に留まり、脈打って伸び縮みするだけ（輪郭を保つ）
      const pulse = 0.5 + 0.5 * Math.cos(t * TAU);
      jagFlame(frame, { x: fl.x, y: fl.y, h: fl.h * (0.8 + 0.2 * pulse), w: fl.w, lean: fl.lean, teeth: 2, phase: cycle * 2, bright: 0.8 + 0.15 * pulse, seed: seed + i });
      return;
    }
    // 伸びて（前半）、根元から離れて上へ千切れる（後半）
    const grow = Math.min(1, t / 0.45);
    const lift = Math.max(0, (t - 0.45) / 0.55);
    jagFlame(frame, {
      x: fl.x,
      y: fl.y - lift * 22,
      h: fl.h * (0.45 + 0.55 * grow) * (1 - lift * 0.35),
      w: fl.w * 1.3 - lift * 3,
      lean: fl.lean,
      teeth: 3,
      phase: cycle * 3 + fl.phase,
      bright: 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)),
      erosion: lift * 0.8,
      seed: seed + i,
    });
  });
  // 立ちのぼる四角い火の粉: 位相で上へ流れ、1 巡で元へ戻る
  for (let i = 0; i < 10; i++) {
    const t = (cycle + hash1(i, seed + 10)) % 1;
    const x = (hash1(i, seed + 11) - 0.5) * 72;
    const y = FEET_Y + 2 - t * 66;
    if (Math.abs(x) < 10 && y > -24) continue;
    const level = Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)));
    ember(frame, x, y, Math.min(5, level));
  }
  if (f === 3) sparkle(frame, -27, -48, 2);
  if (f === 9) sparkle(frame, 27, -48, 2);
}

/** 纏いの足元（地面）: 脈打つ八角形の枠と、角に置いた 4 つの楔の刻み（4 回対称の位置で点滅するので 1 巡で継ぎ目が出ない） */
function asuraSustainGround(frame, f) {
  const cycle = f / ASURA_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  boxRing(frame, { oy: FEET_Y, hx: 30 + pulse * 2, hy: 13 + pulse, cut: 0.45, width: 2, bright: 0.36 + 0.14 * pulse, seed: 7301 });
  for (let i = 0; i < 4; i++) {
    const on = 0.5 + 0.5 * Math.cos((cycle - i / 4) * TAU);
    const sx = i % 2 === 0 ? 1 : -1;
    const sy = i < 2 ? 1 : -1;
    const cx = sx * 30;
    const cy = FEET_Y + sy * 11;
    streakLine(frame, { ax: cx, ay: cy, bx: cx + sx * 9, by: cy + sy * 4, width: 2, bright: 0.25 + 0.3 * on });
  }
}

/**
 * 修羅の終わり（弱る 2 秒の始まり）: 闘気がしおれて内へ折れ、根元へ沈みながら四角く欠け、
 * 灰の破片が下へ落ちる。全体を暗く抑え、白い光点を出さない（力が抜ける）
 */
function asuraEnd(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const seed = 7401;
  for (let i = 0; i < 5; i++) {
    const s = i - 2;
    // 外の炎から先に沈む（中央が最後まで残り、力が抜けていく順が見える）
    const sink = Math.min(1, k * 1.3 + Math.abs(s) * 0.12);
    const x = s * 14 + (hash1(i, seed + 40) - 0.5) * 6;
    jagFlame(frame, {
      x,
      y: FEET_Y + 2,
      h: (50 - Math.abs(s) * 8 + hash1(i, seed + 41) * 10) * (1 - sink * 0.9),
      w: 18 - sink * 6,
      // しおれて先が外へ垂れる
      lean: Math.sign(s || 1) * 10 * sink,
      teeth: 3,
      phase: -f * 0.2,
      bright: 0.62 - k * 0.3,
      cap: 0.6,
      erosion: 0.1 + k * 0.85,
      seed: seed + i,
    });
  }
  // 足元の枠が細って四角く欠ける
  boxRing(frame, { oy: FEET_Y, hx: 30 - k * 8, hy: 13 - k * 3, cut: 0.45, width: 2.2 - k, erosion: Math.min(0.95, 0.2 + k * 0.8), bright: 0.45 - k * 0.2, seed: seed + 10 });
  // 灰: 胸の高さから下へ落ちる暗い四角
  chunks(frame, f, 14, seed + 20, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 60;
    return { x, y: -24 + rnd(2) * 20, vx: (rnd(3) - 0.5) * 1.2, vy: 0.5 + rnd(4) * 1.2, gy: 0.35, drag: 0.9, life: 5 + Math.floor(rnd(5) * 4), size: 2 + rnd(6) * 1.6, rot: rnd(7) * 3, dim: 0.5 };
  });
  // 立ち消える煙の筋（下向きに短く）
  if (k < 0.7) {
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 16 + (hash1(i, seed + 30) - 0.5) * 6;
      const y0 = -30 + k * 30;
      streakLine(frame, { ax: x, ay: y0, bx: x + (hash1(i, seed + 31) - 0.5) * 4, by: y0 + 12, width: 1.2, bright: 0.35 * (1 - k) });
    }
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 血肉断ちの base は振りの reach、首落としの base は周囲攻撃の半径。
 * 配色（属性の無い奥義）: 血肉断ち = 血の赤（fire の段）、首落とし = 冷たい処刑の鋼（steel）、修羅 = 魔の闘気（dark）
 */
const FX = {
  moveset: "cleaver",
  ultimates: {
    "cleaver.fleshRend": {
      ramp: "fire",
      cast: { sheet: "cleaverUlt.fleshRendCast", life: 0.32 },
      acts: [{ sheet: "cleaverUlt.fleshRend", life: 0.62, base: REND_R / 2, pivot: "pos" }],
    },
    "cleaver.beheading": {
      ramp: "steel",
      cast: { sheet: "cleaverUlt.beheadingCast", life: 0.45 },
      acts: [{ sheet: "cleaverUlt.beheading", life: 0.6, base: HEAD_R / 2, pivot: "pos", ground: "cleaverUlt.beheadingGround" }],
    },
    "cleaver.asura": {
      ramp: "dark",
      cast: { sheet: "cleaverUlt.asuraCast", life: 0.6 },
      ends: [{ sheet: "cleaverUlt.asuraEnd", life: 0.7, pivot: "pos" }],
      sustain: { sheet: "cleaverUlt.asura", period: 0.9, ground: "cleaverUlt.asuraGround" },
    },
  },
};

export const ATLAS = {
  key: "cleaverUlt",
  fx: FX,
  sheets: [
    { key: "cleaverUlt.fleshRend", dirs: DIRS, frames: REND_N, active: REND_A, size: 2 * (REND_R + 44), draw: fleshRendSlash },
    { key: "cleaverUlt.fleshRendCast", dirs: DIRS, frames: 8, active: 0, size: 144, draw: fleshRendCast },
    { key: "cleaverUlt.beheading", dirs: WIDE_DIRS, frames: HEAD_N, active: HEAD_A, size: 2 * (HEAD_R + 40), draw: beheadingSlash },
    { key: "cleaverUlt.beheadingGround", dirs: WIDE_DIRS, frames: HEAD_N, active: HEAD_A, size: 2 * (HEAD_R + 34), draw: beheadingGround },
    { key: "cleaverUlt.beheadingCast", dirs: 1, frames: 10, active: 0, size: 208, draw: beheadingCast },
    { key: "cleaverUlt.asuraCast", dirs: 1, frames: 11, active: 0, size: 256, draw: asuraCast },
    { key: "cleaverUlt.asura", dirs: 1, frames: ASURA_N, active: 0, size: 160, draw: asuraSustain },
    { key: "cleaverUlt.asuraGround", dirs: 1, frames: ASURA_N, active: 0, size: 112, draw: asuraSustainGround },
    { key: "cleaverUlt.asuraEnd", dirs: 1, frames: 10, active: 0, size: 160, draw: asuraEnd },
  ],
};
