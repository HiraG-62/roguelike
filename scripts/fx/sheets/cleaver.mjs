// moveset "cleaver"（鉈・大包丁）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/cleaver.json）× 2 が目安
//
// 鉈らしさ: 剣の滑らかな三日月ではなく、外縁が折れ線（面）で角の立った楔形の分厚い斬撃。
// 刃の頭は鈍く四角く、尾は直線的に細る。崩れも四角いブロック状に欠け、破片は四角い肉片。
// 振り下ろし系は当たりの中心に「割れ目（切り口）」を落とし、地面にひびと四角い破片を飛ばす
import { easeSwing, lens, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 共通の部品（鉈だけの形）
// -----------------------------------------------------------------------------

/** 崩れの判定。座標を blk ドットの格子に丸めてからノイズを引くので、四角いブロックで欠ける（剣の丸い崩れと見分ける） */
function survivesBlock(x, y, erosion, near, seed, blk = 3) {
  if (erosion <= 0) return true;
  const bx = Math.floor(x / blk) * blk;
  const by = Math.floor(y / blk) * blk;
  const n = valueNoise(bx, by, 6, seed) * 0.55 + hash1(Math.floor(bx * 7.3 + by * 131), seed + 3) * 0.25;
  return n + near * 0.45 - erosion * 1.15 > 0;
}

/**
 * 面取りした弧（鉈の振りの軌跡）。外縁は facet 度ごとの折れ線で、面ごとに明るさが少しずつ違う（叩いた面が並ぶ）。
 * head 側は鈍い四角の頭（bevel の間だけ面取り）、尾側 taper の割合で直線的に細る楔形
 */
function facetArc(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const span = Math.max(1e-3, head - tail);
  const step = o.facet * DEG;
  const base = o.facetFrom ?? 0;
  const bevel = o.bevel ?? 0.08;
  const taper = o.taper ?? 0.6;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const r = Math.hypot(dx, y);
      if (r > R + 1) return -1;
      const a = Math.atan2(y, dx);
      const s = wrapAngle(head - a);
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      // 外縁は内接多角形の辺（折れ線）。面の番号 i は振りの間で固定なので、面がちらつかない
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
      if (!survivesBlock(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      // 刃の縁: 外縁の 2 ドットを白く（頭側 7 割）。頭の平らな面も明るく、四角い頭を立たせる
      if (d < 2.4 && u < 0.85 && erosion < 0.5) return clamp01(bright * (1.08 - 0.25 * u));
      if (s * r < 2.2 && erosion < 0.4) return clamp01(0.78 * bright);
      // 内縁の 1.5 ドットは暗い縁取り（分厚い刃の影）
      if (w - d < 1.6) return 0.16;
      const facetTone = 0.86 + 0.24 * hash1(i, seed + 11);
      return clamp01(Math.pow(1 - q, 0.7) * (0.95 - 0.45 * u) * facetTone * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: ox - R - 2, y0: -R - 2, x1: ox + R + 2, y1: R + 2 } },
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
  const core = o.core ?? true;
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
      // 台形の輪郭（直線の面取り）: 後ろは長い楔、前は短い面取りで角が立つ
      const w = (T / 2) * Math.min(1, g / back, (1 - g) / front + 0.35);
      if (w < 0.6) return -1;
      const q = Math.abs(across) / w;
      if (q > 1) return -1;
      if (!survivesBlock(x, y, erosion, 1 - q, seed)) return -1;
      if (core && Math.abs(across) < 0.8 && g > 0.15 && erosion < 0.45) return bright;
      if (q > 0.82) return 0.17;
      const side = across < 0 ? 1 : 0.8;
      return clamp01((0.35 + 0.55 * (1 - q)) * side * (0.75 + 0.25 * g) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad } },
  );
}

/** 線分を太さ width で塗る（ひびの 1 本分）。brightness は a → b で v0 → v1 */
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
      // 節で細い枝ひびを 1 本
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
 * 四角い破片（肉片・石片）。shards と同じ等比減速で飛び、回りながら小さくなる。
 * spawn(i, rnd) → { x, y, vx, vy, life, size, rot?, spin?, drag? }
 */
function chunks(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const c = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!c || age < 0 || age > c.life) continue;
    const drag = c.drag ?? 0.8;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const x = c.x + c.vx * travel;
    const y = c.y + c.vy * travel;
    const fade = 1 - age / (c.life + 1);
    const size = c.size * (1 - 0.35 * (age / (c.life + 1)));
    const v = 0.3 + 0.62 * fade;
    if (size < 2.2) {
      dot(frame, x, y, Math.max(2, Math.round(2 + 4 * fade)));
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
        // 片側の面を明るく、反対の縁を暗く（厚みのある塊に見せる）
        if (lx + ly > h * 0.9) return v * 0.45;
        return v * (lx + ly < -h * 0.6 ? 1.05 : 0.82);
      },
      { bounds: { x0: x - h * 1.5 - 1, y0: y - h * 1.5 - 1, x1: x + h * 1.5 + 1, y1: y + h * 1.5 + 1 }, samples: 2, dither: 0 },
    );
  }
}

/**
 * 角の立った四角い衝撃の枠（丸い輪の代わり）。半径 hx × hy の矩形の縁、太さ width。
 * 円い輪＋放射のひびは照準の印に見えるので、鉈は四角い枠でドカッと広がる衝撃を出す
 */
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
      // 角を面取りした八角形の縁（角が立ちつつ、真四角すぎない）
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

/** 振りの進み: active の間は p、以降は崩れの k（0..1） */
function phase(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

// -----------------------------------------------------------------------------
// 面取りの弧の振り（左の段・横薙ぎ・ダッシュ）
// -----------------------------------------------------------------------------

/**
 * 重い振り 1 フレーム。先端が振り幅を走り、尾は短い（分厚い塊が落ちる）。振り終わりは四角く欠けて崩れる。
 * 外縁の速度線は折れ線に沿う直線（弧の線にしない）
 */
function heavySwing(frame, f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  const N = spec.frames;
  const ox = spec.ox ?? 0;
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  const { p, k } = phase(f, A, N);
  if (f < A) {
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - spec.tailLen) * 0.6;
    bright = 0.85 + 0.15 * p;
  } else {
    head = from + sweep * (1 + 0.03 * k);
    tail = from + sweep * Math.min(0.95, 1 - spec.tailLen + (spec.tailLen - 0.08) * Math.pow(k, 0.8));
    erosion = 0.05 + 0.85 * Math.pow(k, 1.2);
    bright = 1 - 0.3 * k;
  }
  const T = spec.T * (f < A ? 0.75 + 0.25 * ((f + 1) / A) : 1 - 0.35 * k);
  facetArc(frame, { ox, R: spec.R, T, head, tail, facet: spec.facet, facetFrom: from + (spec.facetShift ?? 0) * DEG, taper: spec.taper, erosion, bright, seed: spec.seed });
  // 速度線: 外縁のすぐ外、頭の後ろに 1〜2 本の直線（弦）
  if (k < 0.7) {
    for (let i = 0; i < spec.lines; i++) {
      const rr = spec.R + 3 + i * 3 + k * 5;
      const a1 = head - (0.08 + 0.05 * i) * sweep;
      const a0 = a1 - (0.3 + 0.15 * hash1(i, spec.seed + 40)) * (head - tail) * (1 - k);
      if (a1 - a0 < 0.05) continue;
      streakLine(frame, { ax: ox + Math.cos(a0) * rr, ay: Math.sin(a0) * rr, bx: ox + Math.cos(a1) * rr, by: Math.sin(a1) * rr, width: 1.2, bright: (0.6 - i * 0.1) * (1 - k) });
    }
  }
  if (f === A - 1) {
    const tipR = spec.R - T * 0.3;
    sparkle(frame, ox + Math.cos(head) * tipR, Math.sin(head) * tipR, spec.glint);
  }
  // 振り切りで頭の付近から四角い破片が、刃の進む向き（接線）と外へ飛ぶ
  if (f >= A - 1) {
    const age = f - (A - 1);
    chunks(frame, age, spec.chunks, spec.seed + 60, (i, rnd) => {
      const a = from + sweep * (0.7 + 0.3 * rnd(1));
      const r = spec.R + 1 - spec.T * 0.25 * rnd(2);
      const sp = spec.chunkSpeed * (0.6 + 0.8 * rnd(3));
      const out = 0.3 + 0.5 * rnd(4);
      return {
        x: ox + Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
        vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
        life: 3 + Math.floor(rnd(5) * 3),
        size: 2 + rnd(6) * spec.chunkSize,
        rot: rnd(7) * 3,
        spin: (rnd(8) - 0.5) * 1.2,
      };
    });
  }
  // 最後の段は振り切った頭の先で地面が割れる（壁や床に叩きつける重さ）
  if (spec.crack && f >= A - 1) {
    const age = f - (A - 1);
    const hr = spec.R - spec.T * 0.4;
    const cx = ox + Math.cos(from + sweep) * hr;
    const cy = Math.sin(from + sweep) * hr;
    const endA = from + sweep;
    // ひびは刃の進んだ先（接線）と外へ扇に開く。全周に出すと照準の印に見える
    cracks(frame, { cx, cy, branches: 3, length: spec.crack, width: 3.6, segs: 3, jag: 0.6, p: Math.min(1, (age + 1) / 2), erosion: Math.max(0, k - 0.35) * 1.3, seed: spec.seed + 80, angle: (j, rnd) => endA + Math.PI / 2 - 0.9 + j * 0.55 + (rnd(1) - 0.5) * 0.3 });
  }
}

function swingSheet(key, spec) {
  const size = Math.ceil(spec.R + Math.abs(spec.ox ?? 0) + 30) * 2;
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size, draw: (frame, f) => heavySwing(frame, f, spec) };
}

/** 左 1 段（box reach 18 / size 28）: 分厚い楔の弧。面は 24° ごと */
const L1 = { R: 56, T: 24, sweep: 120, tilt: 0, facet: 24, taper: 0.6, frames: 8, active: 4, tailLen: 0.55, lines: 1, chunks: 5, chunkSpeed: 4, chunkSize: 1.5, glint: 3, seed: 1101 };
/** 左 2 段（同じ当たり・逆回り）: わずかに下げた軌道。面の区切りをずらして別の刃筋に見せる */
const L2 = { R: 58, T: 25, sweep: 125, tilt: 8, facet: 22, facetShift: 11, taper: 0.55, frames: 8, active: 4, tailLen: 0.6, lines: 1, chunks: 6, chunkSpeed: 4.2, chunkSize: 1.8, glint: 3, seed: 1202 };
/** 左 3 段（box reach 20 / size 30）: 一回り太く、面が大きい */
const L3 = { R: 64, T: 32, sweep: 135, tilt: -4, facet: 27, taper: 0.5, frames: 9, active: 4, tailLen: 0.55, lines: 2, chunks: 8, chunkSpeed: 5, chunkSize: 2.2, glint: 3, seed: 1303 };
/** 左 4 段（終撃・box reach 22 / size 34）: 最も分厚い楔 + 頭の先で床が割れる */
const L4 = { R: 74, T: 42, sweep: 145, tilt: 0, facet: 29, taper: 0.45, frames: 10, active: 5, tailLen: 0.5, lines: 2, chunks: 12, chunkSpeed: 5.5, chunkSize: 2.8, glint: 4, seed: 1404, crack: 24 };
/** 右: 横薙ぎ（arc 160° reach 28）。太く短い弧。尾がごく短く、塊が横へ吹き抜ける */
const SWEEP = { R: 60, T: 36, sweep: 160, tilt: 0, facet: 32, taper: 0.4, frames: 9, active: 4, tailLen: 0.38, lines: 2, chunks: 10, chunkSpeed: 5.5, chunkSize: 2.5, glint: 3, seed: 1505 };
/** ダッシュ攻撃（box reach 24 / size 30）: 後ろに中心を置いた大きな弧 = ほぼ直線の分厚い横一文字 */
const DASH = { ox: -46, R: 112, T: 28, sweep: 64, tilt: 0, facet: 16, taper: 0.45, frames: 8, active: 4, tailLen: 0.7, lines: 2, chunks: 8, chunkSpeed: 5, chunkSize: 2.2, glint: 3, seed: 1606 };

/** ダッシュ攻撃: 分厚い横一文字 + 後ろへ流れる太い速度線の束 */
function dashChop(frame, f) {
  heavySwing(frame, f, DASH);
  const { k } = phase(f, DASH.active, DASH.frames);
  if (k >= 0.85) return;
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 11 + (hash1(i, 1651) - 0.5) * 5;
    const len = 30 + 30 * hash1(i, 1652);
    const x1 = 46 - Math.abs(y) * 0.4 - k * 30 - hash1(i, 1653) * 8;
    streakLine(frame, { ax: x1 - len * (1 - k * 0.5), ay: y, bx: x1, by: y, width: i % 2 ? 1.2 : 2, bright: 0.55 * (1 - k) });
  }
}

// -----------------------------------------------------------------------------
// 振り下ろし（当たりの中心に置く）: 縦割り・大鉈落とし・骨断ち
// -----------------------------------------------------------------------------

/**
 * 縦に落ちる切り口。刃が上から落ちてくる細い帯（f0）→ 当たりで分厚い割れ目が床に刻まれ、
 * 割れ目の両脇へひびが走り、四角い破片が横へ飛ぶ。L = 割れ目の半分の長さ、T = 太さ
 */
function dropCleave(frame, f, spec) {
  const { A, N, L, T, seed } = spec;
  const { p, k } = phase(f, A, N);
  const ang = (spec.angle ?? 0) * DEG;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const ax = -L * cs;
  const ay = -L * sn;
  const bx = L * cs;
  const by = L * sn;
  const impact = A - 1;
  if (f < impact) {
    // 落ちてくる刃: 細く明るい帯が、後ろから前へ伸びながら太る
    cleaveBar(frame, { ax, ay, bx, by, T: T * (0.35 + 0.35 * p), grow: 0.4 + 0.6 * p, back: 0.5, front: 0.08, bright: 0.95, seed });
    // 落下の速度線: 帯の両脇に短い平行線（刃の幅）
    for (const side of [-1, 1]) {
      const o = side * (T * 0.5 + 3);
      streakLine(frame, { ax: ax * 0.6 - sn * o, ay: ay * 0.6 + cs * o, bx: bx * 0.9 * p - sn * o, by: by * 0.9 * p + cs * o, bright: 0.45 });
    }
  } else {
    const age = f - impact;
    // 当たりの瞬間に一度だけ太らせ（押し込み）、あとは細りながら四角く欠ける
    const punch = age === 0 ? 1.18 : 1 - 0.35 * k;
    cleaveBar(frame, { ax, ay, bx, by, T: T * punch, back: 0.35, front: 0.1, erosion: k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0, bright: 1 - 0.3 * k, seed });
    if (age === 0) sparkle(frame, bx * 0.45, by * 0.45, spec.glint);
    // ひび: 割れ目の両脇から、法線寄りに伸びる
    const nA = ang + Math.PI / 2;
    cracks(frame, {
      cx: 0,
      cy: 0,
      branches: spec.cracks,
      length: spec.crackLen,
      p: Math.min(1, (age + 1) / 2.5),
      width: spec.crackW ?? 2.4,
      erosion: Math.max(0, k - 0.3) * 1.3,
      seed: seed + 20,
      angle: (j, rnd) => {
        const side = j % 2 === 0 ? 0 : Math.PI;
        return nA + side + (rnd(1) - 0.5) * 1.1;
      },
    });
    // ひびの起点を割れ目の上に散らすため、割れ目の端からも 2 本
    cracks(frame, { cx: bx * 0.85, cy: by * 0.85, branches: 2, length: spec.crackLen * 0.6, p: Math.min(1, age / 2), width: 1.8, erosion: Math.max(0, k - 0.3) * 1.3, seed: seed + 30, angle: (j, rnd) => ang + (j ? 0.7 : -0.7) + (rnd(1) - 0.5) * 0.5 });
    // 衝撃: 割れ目の向きに長い潰れた輪
    // 衝撃: 割れ目に沿って横長の四角い枠が広がる
    if (age <= 3) {
      const g = spec.ringR + age * spec.ringGrow;
      boxRing(frame, { hx: L * 0.7 + g * 0.6, hy: g * 0.7, width: 3.4 - age * 0.5, erosion: Math.min(0.9, 0.1 + age * 0.24), bright: 0.8 - age * 0.12, seed: seed + 40 });
    }
    chunks(frame, age, spec.chunks, seed + 50, (i, rnd) => {
      const t = (rnd(1) - 0.5) * 1.6;
      const side = rnd(2) > 0.5 ? 1 : -1;
      const a = nA + (side > 0 ? 0 : Math.PI) + (rnd(3) - 0.5) * 1.2;
      const sp = spec.chunkSpeed * (0.5 + 0.9 * rnd(4));
      return { x: bx * t * 0.8, y: by * t * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), size: 2 + rnd(6) * spec.chunkSize, rot: rnd(7) * 3, spin: (rnd(8) - 0.5) * 1.4 };
    });
  }
}

/** 右: 縦割り（box reach 20 / size 22）。当たりの中心へ一直線の割れ目 */
const SPLIT = { A: 3, N: 8, L: 26, T: 14, cracks: 4, crackLen: 22, ringR: 8, ringGrow: 6, chunks: 8, chunkSpeed: 4, chunkSize: 1.8, glint: 3, seed: 2101 };
/** 右: 大鉈落とし（box reach 22 / size 34）。最大の割れ目・長いひび・大きな破片 */
const DROP = { A: 4, N: 10, L: 38, T: 24, cracks: 6, crackLen: 34, crackW: 3.2, ringR: 12, ringGrow: 9, chunks: 14, chunkSpeed: 5.5, chunkSize: 3.2, glint: 4, seed: 2202 };

/**
 * 派生: 骨断ち（box reach 20 / size 30）。斜めに落ちる分厚い切り口が、当たりで中央から「く」の字に折れ、
 * 折れ目にぎざぎざの断裂線が横切る（骨が砕ける）
 */
function boneBreak(frame, f) {
  const A = 3;
  const N = 9;
  const seed = 2303;
  const { p, k } = phase(f, A, N);
  const L = 30;
  const ang = 35 * DEG;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  if (f < A - 1) {
    cleaveBar(frame, { ax: -L * cs, ay: -L * sn, bx: L * cs, by: L * sn, T: 12 + 6 * p, grow: 0.45 + 0.55 * p, back: 0.45, front: 0.1, bright: 0.95, seed });
    return;
  }
  const age = f - (A - 1);
  // 折れ: 2 つの半分が中央で離れ、少し角度を変える
  const gap = age === 0 ? 0 : 2 + age * 1.6;
  const bend = age === 0 ? 0 : Math.min(0.22, 0.08 * age);
  const T = (age === 0 ? 22 : 20) * (1 - 0.35 * k);
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  for (const side of [-1, 1]) {
    const a2 = ang + side * bend;
    const sx = Math.cos(ang) * gap * side;
    const sy = Math.sin(ang) * gap * side;
    const ex = sx + Math.cos(a2) * L * side;
    const ey = sy + Math.sin(a2) * L * side;
    // 各半分は外側の端（楔）から中央の折れ目（鈍い四角）へ向かう
    cleaveBar(frame, { ax: ex, ay: ey, bx: sx, by: sy, T, back: 0.5, front: 0.08, erosion, bright: 1 - 0.3 * k, seed: seed + (side > 0 ? 1 : 2) });
  }
  // ぎざぎざの断裂線: 切り口に直交するジグザグ
  if (k < 0.8) {
    const nx = -sn;
    const ny = cs;
    const pts = [];
    const H = 22 * Math.min(1, (age + 1) / 2);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6 - 0.5;
      const z = (i % 2 === 0 ? 1 : -1) * (2.5 + 2 * hash1(i, seed + 5));
      pts.push({ x: nx * t * 2 * H + cs * z, y: ny * t * 2 * H + sn * z });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) continue;
      thickSeg(frame, a.x, a.y, b.x, b.y, age === 0 ? 2.4 : 2, 0.72 * (1 - k * 0.4), 0.72 * (1 - k * 0.4), Math.max(0, k - 0.2), seed + 6);
    }
  }
  if (age === 0) sparkle(frame, 0, 0, 4);
  if (age <= 2) ring(frame, { radius: 7 + age * 8, width: 3 - age * 0.6, erosion: Math.min(0.9, age * 0.25), bright: 0.8 - age * 0.12, seed: seed + 7 });
  // 砕けた骨片: 折れ目から大きめの四角が四方へ（刃の進む向き寄り）
  chunks(frame, age, 14, seed + 8, (i, rnd) => {
    const a = (rnd(1) - 0.5) * Math.PI * 1.6 + (rnd(2) > 0.7 ? Math.PI : 0);
    const sp = 3.5 + rnd(3) * 4.5;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 4), size: 2 + rnd(5) * 3.2, rot: rnd(6) * 3, spin: (rnd(7) - 0.5) * 1.6 };
  });
}

/**
 * 派生: 叩き落とし（circle size 40）。上から叩きつけた短く分厚い割れ目 + 全周へ放射するひび + 大きな衝撃の輪。
 * 向きの無い円だが、割れ目の向き（攻撃の向き）を残すため方向ごとに描く
 */
function slamDown(frame, f) {
  const A = 3;
  const N = 10;
  const seed = 2404;
  const { p, k } = phase(f, A, N);
  if (f < A - 1) {
    // 落ちてくる刃の影: 中心に集まる太い帯
    cleaveBar(frame, { ax: -18, ay: 0, bx: 18, by: 0, T: 10 + 8 * p, grow: 0.5 + 0.5 * p, back: 0.4, front: 0.12, bright: 0.9, seed });
    return;
  }
  const age = f - (A - 1);
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  cleaveBar(frame, { ax: -22, ay: 0, bx: 22, by: 0, T: (age === 0 ? 26 : 22) * (1 - 0.3 * k), back: 0.35, front: 0.12, erosion, bright: 1 - 0.3 * k, seed });
  if (age === 0) sparkle(frame, 0, 0, 4);
  cracks(frame, { cx: 0, cy: 0, branches: 7, length: 38, segs: 4, width: 3.4, jag: 0.7, p: Math.min(1, (age + 1) / 3), erosion: Math.max(0, k - 0.3) * 1.3, seed: seed + 2, angle: (j, rnd) => (j / 7) * Math.PI * 2 + (rnd(1) - 0.5) * 0.6 });
  // 衝撃: 当たり判定の円（半径 40）まで広がる八角形の太い枠。円い輪＋放射のひびは照準に見えるので角を立てる
  if (age <= 4) {
    const g = 12 + age * 8;
    boxRing(frame, { hx: g, hy: g, cut: 0.6, width: 4 - age * 0.6, erosion: Math.min(0.9, 0.1 + age * 0.2), bright: 0.85 - age * 0.12, seed: seed + 3 });
  }
  chunks(frame, age, 18, seed + 4, (i, rnd) => {
    const a = rnd(1) * Math.PI * 2;
    const r0 = 6 + rnd(2) * 14;
    const sp = 3 + rnd(3) * 4;
    return { x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 4), size: 2 + rnd(5) * 3, rot: rnd(6) * 3, spin: (rnd(7) - 0.5) * 1.4 };
  });
}

// -----------------------------------------------------------------------------
// 肩当て・押し斬り・血飛沫
// -----------------------------------------------------------------------------

/**
 * 右: 肩当て（box reach 12 / size 24・踏み込み 22）。自分の前に鈍い「〉」形の衝撃の板が張り、
 * 当たりで前へ潰れた輪と太い放射の筋が弾ける。後ろには突進の速度線
 */
function shoulderCharge(frame, f) {
  const A = 3;
  const N = 8;
  const seed = 3101;
  const { p, k } = phase(f, A, N);
  const X0 = 26 + 10 * p + 6 * k;
  const H = 26 * (0.75 + 0.25 * p) * (1 + 0.15 * k);
  const depth = 12 * (1 - 0.4 * k);
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  paint(
    frame,
    (x, y) => {
      const ay = Math.abs(y);
      if (ay > H) return -1;
      // 前の縁は鈍い「〉」、両端は面取り
      const front = X0 - ay * 0.45;
      const thick = depth * Math.min(1, (H - ay) / 7 + 0.25);
      const d = front - x;
      if (d < 0 || d > thick) return -1;
      if (!survivesBlock(x, y, erosion, 1 - d / thick, seed)) return -1;
      if (d < 1.8 && erosion < 0.5) return (1 - 0.25 * k) * (ay < H * 0.7 ? 1.02 : 0.8);
      if (thick - d < 1.5) return 0.16;
      return clamp01((0.85 - 0.5 * (d / thick)) * (1 - 0.3 * (ay / H)) * (1 - 0.3 * k));
    },
    { bounds: { x0: X0 - depth - 20, y0: -H - 2, x1: X0 + 2, y1: H + 2 } },
  );
  if (k < 0.8) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 9 + (hash1(i, seed + 1) - 0.5) * 4;
      const x1 = X0 - Math.abs(y) * 0.45 - depth - 3 - hash1(i, seed + 2) * 6;
      const len = 18 + 22 * hash1(i, seed + 3);
      streakLine(frame, { ax: x1 - len * (1 - k * 0.6), ay: y, bx: x1, by: y, width: i % 2 ? 1.2 : 2, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 3) ring(frame, { ox: X0 + 2 + age * 2, radius: 8 + age * 7, width: 3.4 - age * 0.6, squash: 0.45, erosion: Math.min(0.9, age * 0.22), bright: 0.85 - age * 0.12, seed: seed + 4 });
    if (age <= 1) {
      // 衝撃の放射: 前へ開く短く太い楔が 3 本（多いと花に見える）
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.6;
        const r0 = 8 + age * 7;
        const r1 = 20 + age * 6 + (i === 1 ? 6 : 0);
        thickSeg(frame, X0 + Math.cos(a) * r0, Math.sin(a) * r0 * 1.2, X0 + Math.cos(a) * r1, Math.sin(a) * r1 * 1.2, 3 - age, 0.9, 0.5, 0, seed + 5 + i);
      }
      if (age === 0) sparkle(frame, X0 + 2, 0, 3);
    }
    chunks(frame, age, 8, seed + 6, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.2;
      const sp = 3.5 + rnd(2) * 3.5;
      return { x: X0, y: (rnd(3) - 0.5) * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2 + rnd(5) * 1.8, rot: rnd(6) * 3 };
    });
  }
}

/**
 * 派生: 押し斬り（box reach 20 / size 30・踏み込み 20）。刃を寝かせた分厚い平行四辺形の帯が前へ押し出され、
 * 後ろに地面を削る平行の擦り線、前の縁から削り屑が押し出される
 */
function pressCut(frame, f) {
  const A = 4;
  const N = 9;
  const seed = 3202;
  const { p, k } = phase(f, A, N);
  const X = 20 + 28 * p + 4 * k;
  const H = 30;
  const depth = 13 * (1 - 0.35 * k);
  const shear = 0.28;
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  paint(
    frame,
    (x, y) => {
      const ay = Math.abs(y);
      if (ay > H) return -1;
      // 前の縁は斜めの直線（刃を寝かせて押す）、両端は直角に近い面取り
      const front = X + y * shear;
      const d = front - x;
      const thick = depth * Math.min(1, (H - ay) / 5 + 0.3);
      if (d < 0 || d > thick) return -1;
      if (!survivesBlock(x, y, erosion, 1 - d / thick, seed)) return -1;
      if (d < 1.8 && erosion < 0.5) return 1 - 0.25 * k;
      if (thick - d < 1.5) return 0.16;
      const band = Math.floor((y + H) / 6);
      return clamp01((0.82 - 0.45 * (d / thick)) * (0.88 + 0.2 * hash1(band, seed + 1)) * (1 - 0.3 * k));
    },
    { bounds: { x0: X - H * shear - depth - 2, y0: -H - 2, x1: X + H * shear + 2, y1: H + 2 } },
  );
  // 擦り線: 帯の後ろから始点（踏み込み前）まで伸びる平行線。等間隔で太さを変え、削った溝に見せる
  if (k < 0.85) {
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 15 + (hash1(i, seed + 3) - 0.5) * 4;
      const x1 = X + y * shear - depth - 2;
      const x0 = Math.max(4, x1 - (10 + 16 * hash1(i, seed + 4)) - 26 * p) + k * 20;
      if (x1 - x0 < 3) continue;
      streakLine(frame, { ax: x0, ay: y, bx: x1, by: y, width: i % 2 ? 1.2 : 2.2, bright: (i % 2 ? 0.4 : 0.55) * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, X + 2, -H * 0.3, 3);
  if (f >= 1) {
    chunks(frame, f - 1, 10, seed + 2, (i, rnd) => {
      const y0 = (rnd(1) - 0.5) * H * 1.6;
      const a = (rnd(2) - 0.5) * 1.2;
      const sp = 3 + rnd(3) * 3.5;
      return { x: 50 + y0 * shear, y: y0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), size: 2 + rnd(6) * 1.8, rot: rnd(7) * 3 };
    });
  }
}

/**
 * 派生: 血飛沫（box reach 20 / size 30）。斜めの短く分厚い切り口から、粒が扇状に前へ噴き出す。
 * 粒は丸く（四角い破片と見分ける）、大きい粒ほど遅く、細い筋を引く
 */
function bloodSpray(frame, f) {
  const A = 3;
  const N = 9;
  const seed = 3303;
  const { p, k } = phase(f, A, N);
  const ang = -60 * DEG;
  const L = 22;
  const ax = -Math.cos(ang) * L - 6;
  const ay = -Math.sin(ang) * L;
  const bx = Math.cos(ang) * L - 6;
  const by = Math.sin(ang) * L;
  const erosion = k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0;
  lens(frame, { ax, ay, bx, by, T: 16 * (f < A ? 0.75 + 0.25 * p : 1 - 0.4 * k), grow: p, bias: 0.3, erosion, seed, bright: 1 - 0.25 * k });
  if (f === A - 1) sparkle(frame, -6, 0, 3);
  if (f < 1) return;
  const age = f - 1;
  // 粒: 切り口の上から前方 ±55° の扇へ
  for (let i = 0; i < 26; i++) {
    const r = (m) => hash1(i * 11 + m, seed + 1);
    const t = (r(1) - 0.5) * 0.8;
    const sx = -6 + Math.cos(ang) * L * t;
    const sy = Math.sin(ang) * L * t;
    const a = (r(2) - 0.5) * 1.9;
    const big = r(3);
    const sp = (9 - big * 4.5) * (0.7 + 0.5 * r(4));
    const life = 4 + Math.floor(r(5) * 3);
    const delay = Math.floor(r(6) * 2);
    const age2 = age - delay;
    if (age2 < 0 || age2 > life) continue;
    const drag = 0.78;
    const travel = (1 - Math.pow(drag, age2 + 1)) / (1 - drag);
    const x = sx + Math.cos(a) * sp * travel;
    const y = sy + Math.sin(a) * sp * travel;
    const fade = 1 - age2 / (life + 1);
    const rad = (0.9 + big * 2.3) * (1 - 0.3 * (age2 / (life + 1)));
    const v = 0.35 + 0.6 * fade;
    // 尾: 飛ぶ向きの逆に短い筋（速いうちだけ）
    const vNow = sp * Math.pow(drag, age2);
    if (vNow > 2) streakLine(frame, { ax: x - Math.cos(a) * vNow * 1.4, ay: y - Math.sin(a) * vNow * 1.4, bx: x, by: y, bright: v * 0.7 });
    if (rad < 1.2) {
      dot(frame, x, y, Math.max(2, Math.round(2 + 4 * fade)));
      continue;
    }
    paint(
      frame,
      (px, py) => {
        const d = Math.hypot(px - x, py - y);
        if (d > rad) return -1;
        // 上側に照り、下側を暗く（丸い粒）
        return clamp01(v * (1 - 0.4 * (d / rad)) * (py - y < -rad * 0.3 ? 1.12 : 0.9));
      },
      { bounds: { x0: x - rad - 1, y0: y - rad - 1, x1: x + rad + 1, y1: y + rad + 1 }, dither: 0 },
    );
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 刃の進む向き（+x）の短く分厚い切り口 + 四角い肉片。heavy は太く、衝撃の輪と短いひびが付く */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const L = heavy ? 24 : 16;
  const T0 = heavy ? 20 : 14;
  const seed = heavy ? 4101 : 4201;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const T = T0 * (f === 0 ? 0.75 : f === 1 ? 1.1 : 1 - k * 0.5);
  cleaveBar(frame, { ax: -L, ay: 0, bx: -L + 2 * L * grow, by: 0, T, back: 0.4, front: 0.25, erosion: k > 0 ? 0.05 + 0.85 * k : 0, bright: 1 - 0.25 * k, seed });
  if (f <= 1) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (heavy && f >= 1) {
    const age = f - 1;
    boxRing(frame, { hx: 14 + age * 5, hy: 8 + age * 4, cut: 0.5, width: 3.4 - age * 0.35, erosion: Math.min(0.9, 0.1 + age * 0.17), bright: 0.8 - age * 0.08, seed: seed + 1 });
    cracks(frame, { cx: 0, cy: 0, branches: 4, length: 20, segs: 4, width: 2, p: Math.min(1, (age + 1) / 2), erosion: Math.max(0, k - 0.3) * 1.3, seed: seed + 2, angle: (j, rnd) => Math.PI / 2 + (j % 2 ? Math.PI : 0) + (j < 2 ? -0.5 : 0.5) + (rnd(1) - 0.5) * 0.4 });
  }
  if (f >= 1) {
    chunks(frame, f - 1, heavy ? 12 : 7, seed + 3, (i, rnd) => {
      // 刃の進む向きに多く、残りは切り口に直交して左右へ
      const forward = rnd(1) > 0.4;
      const a = forward ? (rnd(2) - 0.5) * 1.0 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 0.8);
      const sp = (heavy ? 4 : 3) + rnd(4) * (heavy ? 4 : 2.5);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: 2 + rnd(6) * (heavy ? 3 : 2), rot: rnd(7) * 3, spin: (rnd(8) - 0.5) * 1.4 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 振り下ろし系（縦割り・大鉈落とし・叩き落とし・骨断ち・血飛沫）は当たりの中心に割れ目・切り口を落とすので anchor
 */
const FX = {
  moveset: "cleaver",
  motions: {
    "l:0": { sheet: "cleaver.l1", pivot: "self", base: 18, measure: "reach" },
    "l:1": { sheet: "cleaver.l2", pivot: "self", base: 18, measure: "reach" },
    "l:2": { sheet: "cleaver.l3", pivot: "self", base: 20, measure: "reach" },
    "l:3": { sheet: "cleaver.l4", pivot: "self", base: 22, measure: "reach" },
    dash: { sheet: "cleaver.dash", pivot: "self", base: 24, measure: "reach" },
    "r:shoulderCharge": { sheet: "cleaver.shoulder", pivot: "self", base: 12, measure: "reach" },
    "r:verticalSplit": { sheet: "cleaver.split", pivot: "anchor", base: 20, measure: "reach" },
    "r:cleaverSweep": { sheet: "cleaver.sweep", pivot: "self", base: 28, measure: "reach" },
    "r:greatDrop": { sheet: "cleaver.drop", pivot: "anchor", base: 22, measure: "reach" },
    "branch:slamDown": { sheet: "cleaver.slam", pivot: "anchor", base: 40, measure: "size" },
    "branch:bloodSpray": { sheet: "cleaver.blood", pivot: "anchor", base: 20, measure: "reach" },
    "branch:pressCut": { sheet: "cleaver.press", pivot: "self", base: 20, measure: "reach" },
    "branch:boneBreak": { sheet: "cleaver.bone", pivot: "anchor", base: 20, measure: "reach" },
  },
  hit: "cleaver.hit",
  hitHeavy: "cleaver.hitHeavy",
};

export const ATLAS = {
  key: "cleaver",
  fx: FX,
  sheets: [
    swingSheet("cleaver.l1", L1),
    swingSheet("cleaver.l2", L2),
    swingSheet("cleaver.l3", L3),
    swingSheet("cleaver.l4", L4),
    swingSheet("cleaver.sweep", SWEEP),
    { key: "cleaver.dash", dirs: DIRS, frames: DASH.frames, active: DASH.active, size: 176, draw: dashChop },
    { key: "cleaver.shoulder", dirs: DIRS, frames: 8, active: 3, size: 144, draw: shoulderCharge },
    { key: "cleaver.split", dirs: DIRS, frames: SPLIT.N, active: SPLIT.A, size: 128, draw: (frame, f) => dropCleave(frame, f, SPLIT) },
    { key: "cleaver.drop", dirs: DIRS, frames: DROP.N, active: DROP.A, size: 160, draw: (frame, f) => dropCleave(frame, f, DROP) },
    { key: "cleaver.bone", dirs: DIRS, frames: 9, active: 3, size: 136, draw: boneBreak },
    { key: "cleaver.slam", dirs: DIRS, frames: 10, active: 3, size: 160, draw: slamDown },
    { key: "cleaver.press", dirs: DIRS, frames: 9, active: 4, size: 176, draw: pressCut },
    { key: "cleaver.blood", dirs: DIRS, frames: 9, active: 3, size: 144, draw: bloodSpray },
    { key: "cleaver.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "cleaver.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
