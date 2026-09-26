// 戦輪（moveset "warRing"）のエフェクト。docs/ideas/fx-sprites.md 6・9 章。手本は sword.mjs / sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/warRing.json・弾の表）× 2 が目安
//
// 戦輪は「外へ反った鉤刃の付いた細い輪」を投げる・振る武器。チャクラム（ringBlades: のこぎり歯の帯）と見分けるため:
//   - 斬線は歯の無い滑らかな細い帯。刻みは描かない
//   - 輪の本体（bladeRing）は、細い輪から後ろへ反った鉤刃が 2〜4 枚出る形（風魔手裏剣に近い）
//   - 回転は「刃先の掻き傷」（hookMarks。転がる輪の刃先が外を向いた瞬間だけ残る短い鉤形の線）で見せる。
//     刃先の軌跡を全部引くと帯の外にもう 1 本の弧が見えて二重線になるので、外向きの一瞬だけを刻む
// 弾の本体（輪）は描画側（render/thrownLook.ts）が戦輪の武器の絵を回して描く。fly は下に重なる尾（輪の残像 / 曲がる航跡 /
// 回転のぶれ / 中空の帯 / 火の粉）と回転の風の光だけ。尽きた・投げた瞬間・着弾・命中は輪の形も含めて描く
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.5, seed + 7) * 0.22;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 角 a を基準 base から時計回りに測った [0, 2π) の距離（220° を超える帯でも巻き戻らない） */
function cwFrom(base, a) {
  const d = (base - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 振りの時間割: active の間は進み p（0..1）、振り終わりは崩れ k（0..1） */
function phase(f, A, N) {
  if (f < A) return { p: easeSwing((f + 1) / A), k: 0 };
  return { p: 1, k: (f - A + 1) / (N - A + 1) };
}

/**
 * 戦輪の本体: 中心 (cx, cy)、輪の外径 r・太さ rw、鉤刃 blades 枚（長さ bladeLen・根元の半幅 bladeW）、回転 rot。
 * 鉤刃は根元から先へ細り、先ほど後ろ（回転の逆 = 角の減る側）へ curve ラジアン反る。刃の進む側の縁だけ白。
 * 輪の内側は抜く（穴で「輪」と分かる）。squash で縦に潰す（尽きたときに倒れて転がる）
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
  const squash = o.squash ?? 1;
  const outer = r + L + 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = (y - cy) / squash;
      const d = Math.hypot(dx, dy);
      if (d > outer || d < r - rw - 0.3) return -1;
      const a = Math.atan2(dy, dx);
      // 光は上前から（回転しても刃の明暗の側が変わらず、形がちらつかない）
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
        // 進む側（角の増える側）の縁が刃。先 8 割まで白く、背は暗い
        if (along > half - 1.1 && t < 0.8 && erosion < 0.5) return clamp01(0.95 * bright);
        return clamp01((0.5 + 0.22 * (along / half) + 0.15 * lit) * (1 - 0.3 * t) * bright * (1 - erosion * 0.4));
      }
      return -1;
    },
    { bounds: { x0: cx - outer - 1, y0: cy - outer * squash - 1, x1: cx + outer + 1, y1: cy + outer * squash + 1 }, samples: 4 },
  );
}

/**
 * 滑らかな弧の帯（輪を持った手の通り道）。中心 (ox, oy)、外縁の半径 R、太さ T。
 * head = 先頭の角、span = 尾までの長さ（時計回りに測る。2π まで）。先頭の近くが最も太く、尾へ細る。外縁の先頭寄りが白い刃の縁
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

/**
 * 鉤刃の先の軌跡（1px の点列）。pos(s)（s: 0 = 尾 → 1 = 先頭）→ {x, y} を細かく標本して打つ。
 * keepFn(x, y) が偽の所（帯の内側）は打たない。先頭ほど明るい（hi → 段 2 付近へ落ちる）
 */
function tipTrace(frame, pos, o) {
  const steps = o.steps ?? 400;
  const hi = o.hi ?? 5;
  let px = null;
  let py = null;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const p = pos(s);
    if (!o.keep || o.keep(p.x, p.y)) {
      // 同じドットへ重ねて打たない（明るさの段を保つ）
      const gx = Math.round(p.x * 2) / 2;
      const gy = Math.round(p.y * 2) / 2;
      if (gx !== px || gy !== py) dot(frame, p.x, p.y, Math.max(2, Math.round(2 + (hi - 2) * Math.pow(s, 0.8))));
      px = gx;
      py = gy;
    }
  }
}

/**
 * 刃先の掻き傷: 転がる輪の刃先の軌跡のうち、刃先が外（out(th) の向き）を向いた短い区間だけを 1px で打つ。
 * center(th) = 輪の中心、spin(th) = 輪の回転角、th は back ぶん尾から先頭 head へ。先頭ほど明るい
 */
function hookMarks(frame, o) {
  const { head, back, center, spin, out, tipR, blades } = o;
  const steps = o.steps ?? 600;
  const hi = o.hi ?? 5;
  const cone = o.cone ?? 0.95;
  for (let k = 0; k < blades; k++) {
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const th = head - back * (1 - u);
      const psi = spin(th) + (k * TAU) / blades;
      if (Math.cos(psi - out(th, psi)) < cone) continue;
      const c = center(th);
      const x = c.x + Math.cos(psi) * tipR;
      const y = c.y + Math.sin(psi) * tipR;
      if (o.keep && !o.keep(x, y)) continue;
      dot(frame, x, y, Math.max(2, Math.round(2 + (hi - 2) * Math.pow(u, 0.8))));
    }
  }
}

/** 回転の火花: 円周上の点から接線（時計回りの進む向き）へ飛ぶ */
function tangentSparks(frame, age, count, seed, o) {
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

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角 */
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

/** 前へ押し出す風の弧（潰れた楕円の前側だけ）。全周の輪にすると閃光の横に輪っかがぶら下がって見える */
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

/** 上下を反転した写像の作業面（2 枚目の輪を逆の側から描く）。frame の格子はそのまま共有する */
function mirrored(frame) {
  const m = Object.create(frame);
  m.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: -c.y };
  };
  m.toGrid = (x, y) => frame.toGrid(x, -y);
  return m;
}

// -----------------------------------------------------------------------------
// 輪払い・輪斬り（arc 220°）: 手に持った輪が大きく薙ぐ。滑らかな帯 + 先頭の回る輪 + 帯の外の刃先のループ
// -----------------------------------------------------------------------------

/** 右: 輪払い（arc 220° reach 26）: 細い帯、3 枚刃の輪、刃先のループ */
const SWEEP = { R: 54, T: 10, sweep: 220, frames: 9, active: 4, tailLen: 0.8, ringR: 8, blades: 3, bladeLen: 5.5, sparks: 9, seed: 3101 };
/** 派生: 輪斬り（arc 220°・重い）: 太い帯、4 枚刃の大きな輪。振り切りで輪が噛みつき、衝撃の輪と刃片が弾ける */
const SLASH = { R: 58, T: 15, sweep: 220, frames: 10, active: 5, tailLen: 0.9, ringR: 10, blades: 4, bladeLen: 6.5, sparks: 16, seed: 3201, heavy: true };

function ringSwing(frame, f, s) {
  const sweep = s.sweep * DEG;
  const from = -sweep / 2;
  const A = s.active;
  const { p, k } = phase(f, A, s.frames);
  const head = from + sweep * (f < A ? p : 1 + 0.05 * k);
  const span = f < A ? Math.min(sweep * p, sweep * s.tailLen) + 0.05 : sweep * s.tailLen * (1 - 0.65 * k);
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  const bright = f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k;
  const T = s.T * (f < A ? 0.75 + 0.25 * ((f + 1) / A) : 1 - 0.45 * k);
  smoothBand(frame, { R: s.R, T, head, span, erosion, bright, seed: s.seed });
  // 輪の中心は帯の中を通る。転がる回転角 = 進んだ弧の長さ / 輪の半径
  const wc = s.R - s.T * 0.45;
  const rr = s.ringR;
  const tipR = rr + s.bladeLen * 0.85;
  // 刃先のループ: 最近の 100° ぶんだけ、帯の外側（外縁の 1 ドット外）に引く。内側へ重ねると二重線に見える
  if (k < 0.6) {
    const back = Math.min(100 * DEG, span) * (1 - k);
    hookMarks(frame, {
      head,
      back,
      center: (th) => ({ x: Math.cos(th) * wc, y: Math.sin(th) * wc }),
      spin: (th) => (th * wc) / rr,
      out: (th) => th,
      tipR,
      blades: s.blades,
      keep: (x, y) => Math.hypot(x, y) > s.R + 1.5,
      hi: f < A ? 5 : 4,
    });
  }
  if (f <= A) {
    const rot = (head * wc) / rr;
    bladeRing(frame, Math.cos(head) * wc, Math.sin(head) * wc, { r: rr, rw: s.heavy ? 3 : 2.4, rot, blades: s.blades, bladeLen: s.bladeLen, bladeW: s.heavy ? 2.6 : 2.2, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.35 : 0, seed: s.seed + 5 });
  }
  if (f === A - 1) sparkle(frame, Math.cos(head) * (s.R + 2), Math.sin(head) * (s.R + 2), s.heavy ? 4 : 3);
  if (f >= A - 1) tangentSparks(frame, f - (A - 1), s.sparks, s.seed + 60, { radius: s.R, from: head - 0.6, to: head, speed: s.heavy ? 5.5 : 4.5 });
  if (s.heavy && f >= A - 1) {
    // 振り切りで輪が噛みつく: 先頭の位置から衝撃の輪が 1 本広がる
    const age = f - (A - 1);
    const endA = from + sweep;
    const hx = Math.cos(endA) * wc;
    const hy = Math.sin(endA) * wc;
    if (age <= 4) ring(frame, { ox: hx, oy: hy, radius: 5 + age * 5, width: 2.2, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.1, seed: s.seed + 7 });
    shards(frame, age, 8, s.seed + 70, (i, rnd) => {
      const a = endA + Math.PI / 2 + (rnd(1) - 0.5) * 2.2;
      const sp = 3.5 + rnd(2) * 3;
      return { x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: 2, drag: 0.82 };
    });
  }
}

// -----------------------------------------------------------------------------
// 輪回し（circle size 52・3 段）: 輪が自分の周りを 1 周半。3 回の当たりで光る
// -----------------------------------------------------------------------------

const SPIN = { R: 50, T: 6, start: -90, laps: 1.4, trail: 250, frames: 10, active: 5, flashes: [1, 2, 3], ringR: 8, blades: 3, bladeLen: 4, sparks: 14, seed: 3301 };

function ringSpin(frame, f) {
  const s = SPIN;
  const A = s.active;
  const { p, k } = phase(f, A, s.frames);
  const start = s.start * DEG;
  const lap = s.laps * TAU;
  const head = start + lap * p + k * 0.4;
  const spanMax = s.trail * DEG;
  const span = f < A ? Math.min(spanMax, lap * p + 0.1) : spanMax * (1 - 0.6 * k);
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  const flash = s.flashes.includes(f);
  smoothBand(frame, { R: s.R, T: s.T * (1 - 0.4 * k), head, span, erosion, bright: (flash ? 1.08 : 0.95) * (1 - 0.3 * k), seed: s.seed, edgeReach: 0.4 });
  const wc = s.R - s.T * 0.5;
  const rr = s.ringR;
  const tipR = rr + s.bladeLen * 0.85;
  if (k < 0.6) {
    const back = Math.min(120 * DEG, span) * (1 - k);
    hookMarks(frame, {
      head,
      back,
      center: (th) => ({ x: Math.cos(th) * wc, y: Math.sin(th) * wc }),
      spin: (th) => (th * wc) / rr,
      out: (th) => th,
      tipR,
      blades: s.blades,
      keep: (x, y) => Math.hypot(x, y) > s.R + 1.5,
      steps: 800,
    });
  }
  if (f <= A) bladeRing(frame, Math.cos(head) * wc, Math.sin(head) * wc, { r: rr, rw: 2.4, rot: (head * wc) / rr, blades: s.blades, bladeLen: s.bladeLen, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.35 : 0, seed: s.seed + 5 });
  // 3 回の当たり: 光るたびに輪の外で閃く
  if (flash) sparkle(frame, Math.cos(head) * (s.R + 4), Math.sin(head) * (s.R + 4), 3);
  if (f >= A - 1) tangentSparks(frame, f - (A - 1), s.sparks, s.seed + 60, { radius: s.R, from: head - 1.4, to: head, speed: 4.5 });
}

// -----------------------------------------------------------------------------
// ダッシュ攻撃（thrust reach 40・踏み込み 16）: 輪を前へ突き出して転がす一直線
// -----------------------------------------------------------------------------

function dashThrust(frame, f) {
  const A = 4;
  const N = 8;
  const from = -10;
  const to = 82;
  const { p, k } = phase(f, A, N);
  const tip = from + (to - from) * p + k * 4;
  const back = f < A ? from : from + (to - from) * 0.75 * k;
  const T = 10 * (1 - 0.4 * k);
  const erosion = f < A ? 0 : 0.08 + 0.8 * Math.pow(k, 1.2);
  // 帯: 後ろほど細い直線の帯。上の縁（刃の縁）の先寄りだけ白
  paint(
    frame,
    (x, y) => {
      if (x < back || x > tip) return -1;
      const u = (tip - x) / Math.max(1, tip - back);
      const w = (T / 2) * Math.min(1, u / 0.06) * Math.pow(1 - u, 0.55);
      if (w < 0.5) return -1;
      const q = Math.abs(y) / w;
      if (q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), 3401)) return -1;
      if (q < 0.25 && u < 0.5 && erosion < 0.45) return clamp01(1.02 - 0.3 * u);
      return clamp01(Math.pow(1 - q, 1.1) * (0.88 - 0.5 * u) * (1 - k * 0.3));
    },
    { bounds: { x0: back - 1, y0: -T, x1: tip + 1, y1: T } },
  );
  const rr = 10;
  // 平行の速度線（帯の外側だけ）。刃先の掻き傷は直線だと速度線と並んで縞に見えるので引かない
  if (k < 0.8) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (12 + Math.floor(i / 2) * 5);
      const x1 = tip - 16 - hash1(i, 3402) * 12 - k * 16;
      streakLine(frame, { ax: x1 - 20 - hash1(i, 3403) * 16, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
    }
  }
  if (f <= A) bladeRing(frame, tip, 0, { r: rr, rw: 2.6, rot: tip / rr, blades: 3, bladeLen: 5.5, bladeW: 2.4, bright: f === A ? 0.8 : 1, erosion: f === A ? 0.35 : 0, seed: 3404 });
  if (f === A - 1) sparkle(frame, tip + 12, 0, 4);
  if (f >= A - 1) tangentSparks(frame, f - (A - 1), 10, 3405, { ox: to, radius: 9, from: -2.2, to: 2.2, speed: 4.5 });
}

// -----------------------------------------------------------------------------
// その場で投げる派生（三輪・戻り輪）。circle size 20、原点 = 自分。弾は弾の絵が出るので、手元の風と受けの閃きだけ
// -----------------------------------------------------------------------------

/** 手の位置（自分の中心から前へ。キャラ 48 ドットの縁の少し内） */
const HAND = 16;

/**
 * 手首の返しの風切りの弧: P を通る小さな円弧が、向き a へ弾くように回る（時計回り）。
 * age 0 で半ば、1 で振り切り、以降は細って崩れる
 */
function wristFlick(frame, P, a, age, o) {
  const life = o.life ?? 4;
  if (age < 0 || age > life) return;
  const R = o.R ?? 9;
  // 円の中心は P の +y 側（時計回りの弧の頂点が P を前へ通る）
  const cx = P.x - Math.sin(a) * R;
  const cy = P.y + Math.cos(a) * R;
  const top = a - Math.PI / 2;
  const sweep = (o.sweep ?? 150) * DEG;
  const p = age === 0 ? 0.6 : 1;
  const k = age <= 1 ? 0 : (age - 1) / (life - 1);
  const head = top + sweep * 0.5 * p + k * 0.2;
  smoothBand(frame, { ox: cx, oy: cy, R, T: (o.T ?? 3.5) * (1 - 0.4 * k), head, span: sweep * p * (1 - 0.5 * k), erosion: k * 0.85, bright: 1 - 0.3 * k, seed: o.seed ?? 3501, edgeReach: 0.5 });
}

/** 三輪: 3 枚を扇に投げる（−12° → 0° → +12°、1 フレームずつ）。投げるたびに手首の風と、前へ抜ける空気の筋 */
function tripleRing(frame, f) {
  for (let j = 0; j < 3; j++) {
    // 扇は弾の広がり（12°）より大きく開く。近い角で重ねると 3 本の弧が重なった縞に見える
    const a = (j - 1) * 28 * DEG;
    const age = f - j;
    const P = { x: Math.cos(a) * HAND, y: Math.sin(a) * HAND };
    wristFlick(frame, P, a, age, { R: 10, T: 3.6, sweep: 140, seed: 3501 + j, life: 2 });
    if (age === 1) sparkle(frame, Math.cos(a) * (HAND + 10), Math.sin(a) * (HAND + 10), 2);
    if (age >= 1 && age <= 3) {
      const r0 = HAND + 8 + age * 5;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + 8), by: Math.sin(a) * (r0 + 8), bright: 0.6 - age * 0.12 });
    }
  }
}

/**
 * 戻り輪: 前から弧を描いて戻ってくる輪（回りながら）を手で受ける。受けた瞬間に手元で閃き、
 * 受けの衝撃の輪と、輪の勢いで接線へ散る火花。戻る道筋は 1px の細い航跡
 */
function returnRing(frame, f) {
  const A = 4;
  const P0 = { x: 50, y: -22 };
  const C = { x: 50, y: 20 };
  const P1 = { x: HAND, y: 2 };
  const at = (t) => ({
    x: (1 - t) ** 2 * P0.x + 2 * (1 - t) * t * C.x + t * t * P1.x,
    y: (1 - t) ** 2 * P0.y + 2 * (1 - t) * t * C.y + t * t * P1.y,
  });
  // 最初のフレームから遠くに輪が見えるよう、進みは 0 から始める
  const t = f < A ? easeSwing(f / (A - 1)) : 1;
  const k = f < A ? 0 : (f - A + 1) / 4;
  // 航跡: 最近の 6 割だけ、輪の後ろに
  if (k < 0.8) {
    const t0 = Math.max(0, t - 0.6) * (f < A ? 1 : 1);
    if (t > 0.05)
    tipTrace(frame, (u) => at(t0 + (t - t0) * u * (1 - k * 0.6)), { hi: 4, steps: 160 });
  }
  if (f < A) {
    const c = at(t);
    bladeRing(frame, c.x, c.y, { r: 6, rw: 2, rot: f * 1.3, blades: 3, bladeLen: 4.5, bladeW: 2.2, seed: 3601 });
  }
  if (f === A - 1) sparkle(frame, P1.x, P1.y, 4);
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 3) ring(frame, { ox: P1.x, oy: P1.y, radius: 4 + age * 3.5, width: 1.6, erosion: Math.min(0.9, age * 0.25), bright: 0.75 - age * 0.1, seed: 3602 });
    tangentSparks(frame, age, 8, 3603, { ox: P1.x, oy: P1.y, radius: 5, from: 0, to: TAU, speed: 3.5 });
  }
}

// -----------------------------------------------------------------------------
// 近接の命中: 輪の縁で裂いた弧の切り口 + 回る鉤刃の閃き（風車形）+ 接線の火花。重いものは衝撃の輪
// -----------------------------------------------------------------------------

function meleeHit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const R = heavy ? 20 : 15;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const sweep = (heavy ? 115 : 100) * DEG;
  const grow = f === 0 ? 0.55 : 1;
  // 切り口: 原点の下に中心を置いた円の一部。頂点（原点）で +x（刃の進む向き）へ走る
  smoothBand(frame, { ox: 0, oy: R, R, T: (heavy ? 7 : 5) * (f === 0 ? 0.7 : 1 - 0.5 * k), head: -Math.PI / 2 + sweep * (grow - 0.5), span: sweep * grow, erosion: k * 0.9, bright: 1 - 0.2 * k, seed: heavy ? 3701 : 3711, peak: 0.3 });
  // 回る鉤刃の閃き（輪を抜いた風車）: 当たった瞬間だけ、回しながら小さくなる
  if (f <= 2) bladeRing(frame, 0, 0, { r: 1.5, rw: 0, rot: f * 0.9, blades: heavy ? 4 : 3, bladeLen: (heavy ? 9 : 7) * (1 - f * 0.2), bladeW: 1.6, curve: 1, bright: f === 2 ? 0.75 : 1, seed: 3702 });
  if (f <= 1) sparkle(frame, 0, 0, heavy ? 4 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    if (age <= 4) ring(frame, { radius: 8 + age * 5, width: 2, squash: 0.8, erosion: Math.min(0.92, 0.1 + age * 0.22), bright: 0.72 - age * 0.1, seed: 3703 });
  }
  if (f >= 1) tangentSparks(frame, f - 1, heavy ? 14 : 8, heavy ? 3704 : 3714, { radius: heavy ? 5 : 3, from: 0, to: TAU, speed: heavy ? 5.5 : 4 });
}

// -----------------------------------------------------------------------------
// 弾（5 種）: 本体の形・尾（残像）・手元の風切り・着弾を弾ごとに描き分ける
// -----------------------------------------------------------------------------

/**
 * 弾の数値。body = 輪の形（bladeRing の数値）、tail = 尾の長さ（速さ × 0.04 秒: 300px/秒 → 24 ドット）、
 * period = 1 巡の秒（刃が 1 枚ぶん回る）、size = 本体の外径（着弾・命中の大きさの目安）
 */
const SHOTS = {
  // 円月輪: 細い刃の輪（小さな歯 6 枚）。尾は輪の後ろ半分の残像が 3 つ。跳ね返る
  chakram: { base: 2, tail: 24, period: 0.1, body: { r: 5, rw: 1.5, blades: 6, bladeLen: 1.8, bladeW: 1, curve: 0.4 }, seed: 4100 },
  // 返し輪: 2 枚の大きな鉤（ブーメラン形）。尾は横へ曲がる航跡
  returnChakram: { base: 3, tail: 22, period: 0.14, body: { r: 5, rw: 1.8, blades: 2, bladeLen: 6, bladeW: 2.6, curve: 1.1 }, seed: 4200 },
  // 飛刃: 4 枚の鎌形の刃が大きく回る（輪は小さな軸）。尾は回転のぶれの弧
  flyingBlade: { base: 3, tail: 22, period: 0.12, body: { r: 3.5, rw: 2, blades: 4, bladeLen: 8, bladeW: 2.6, curve: 1 }, seed: 4300 },
  // 輪投げ（右の段）: 太い輪と 3 枚の鉤。尾は縁の明るい中空の帯（輪の通った跡）
  ringThrow: { base: 3, tail: 26, period: 0.14, body: { r: 7, rw: 2.4, blades: 3, bladeLen: 4, bladeW: 2.2, curve: 0.8 }, seed: 4400 },
  // 双輪（右の段・2 発）: 軽い 2 枚刃の輪。尾は中心の細い筋と残像 1 つ
  twinRings: { base: 3, tail: 18, period: 0.12, body: { r: 5.5, rw: 1.8, blades: 2, bladeLen: 3.5, bladeW: 2, curve: 0.8 }, seed: 4500 },
};

const FLY_FRAMES = 6;

/** 本体の外径 */
function bodySize(g) {
  return g.body.r + g.body.bladeLen;
}

/** 輪の後ろ半分の残像（縁だけの細い弧）。x = 中心、bright = 明るさ */
function ghostArc(frame, x, r, bright, width = 1.2) {
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      if (dx > 0.5) return -1;
      const d = Math.abs(Math.hypot(dx, py) - r);
      if (d > width / 2) return -1;
      // 真後ろほど明るい（後ろへ流れる向きを見せる）
      const back = -dx / r;
      return bright * (0.55 + 0.45 * back);
    },
    { bounds: { x0: x - r - 2, y0: -r - 2, x1: x + 1, y1: r + 2 }, dither: 0, samples: 3 },
  );
}

/** 尾: 弾ごとに形を変える */
function shotTail(frame, f, name, g) {
  const b = g.body;
  if (name === "chakram") {
    for (let i = 1; i <= 3; i++) ghostArc(frame, -i * 7 - (f % 2) * 0.5, LOOK_R, 0.56 - i * 0.12, 1);
    return;
  }
  if (name === "returnChakram") {
    // 横（+y）へ曲がる航跡: 戻るために弧を描いている向き
    paint(
      frame,
      (x, y) => {
        if (x > -LOOK_R || x < -g.tail - 4) return -1;
        const u = (-LOOK_R - x) / (g.tail + 4 - LOOK_R);
        const yc = 8 * u * u;
        const hw = 2.2 * (1 - u) ** 0.7 + 0.3;
        const d = Math.abs(y - yc);
        if (d > hw) return -1;
        return clamp01((1 - d / hw) ** 0.6 * 0.7 * (1 - u) ** 1.1 + 0.06);
      },
      { bounds: { x0: -g.tail - 6, y0: -4, x1: 2, y1: 12 } },
    );
    return;
  }
  if (name === "flyingBlade") {
    // 大きな回転刃: 外周の風の光を大きく回し、中心から後ろへ筋を 1 本
    const R = bodySize(g) + 1;
    spinBlur(frame, f, R, g.seed + 3, 0.6);
    streakLine(frame, { ax: -g.tail - 6, ay: 0, bx: -R - 1, by: 0, bright: 0.55 });
    return;
  }
  if (name === "ringThrow") {
    // 中空の帯: 輪の上下の縁が後ろへ流れ、縁ほど明るい
    paint(
      frame,
      (x, y) => {
        if (x > -2 || x < -g.tail) return -1;
        const u = (-2 - x) / (g.tail - 2);
        const hw = b.r * (1 - u) ** 0.7 + 0.5;
        const q = Math.abs(y) / hw;
        if (q > 1) return -1;
        const edge = q > 0.72 ? 1 : 0.35 * q;
        const grain = 0.8 + 0.3 * hash1(Math.floor((x + 60) / 3) + f, g.seed);
        return clamp01(edge * 0.66 * (1 - u) ** 1.1 * grain);
      },
      { bounds: { x0: -g.tail - 1, y0: -b.r - 2, x1: 0, y1: b.r + 2 } },
    );
    return;
  }
  // twinRings: 中心の細い筋と、筋から剥がれて上下へ流れる火の粉（残像の輪を筋に重ねると矢羽根に見えるので描かない）
  streakLine(frame, { ax: -g.tail - 4, ay: 0, bx: -LOOK_R - 1, by: 0, bright: 0.6 });
  for (let i = 0; i < 2; i++) {
    const x = -LOOK_R - 3 - ((f * 3 + i * 8) % (g.tail - LOOK_R));
    dot(frame, x, (i === 0 ? -1 : 1) * (1.5 + ((f + i) % 3) * 0.7), 4);
  }
}

/**
 * 回転の風の光: 本体の外周（半径 R）を回る 2 本の短い弧（向かい合わせ）。先頭ほど明るい 1px の線。
 * 本体（武器の絵）は描画側が回して重ねるので、ここはその外に漏れる風だけ
 */
function spinBlur(frame, f, R, seed, bright = 0.55) {
  const rot = (f / FLY_FRAMES) * Math.PI + hash1(0, seed) * TAU;
  const len = 70 * DEG;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(Math.hypot(x, y) - R) > 0.6) return -1;
      const a = Math.atan2(y, x);
      for (let k = 0; k < 2; k++) {
        const s0 = cwFrom(rot + k * Math.PI, a);
        if (s0 <= len) return bright * (1 - 0.65 * (s0 / len));
      }
      return -1;
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0, samples: 2 },
  );
}

/** 描画側（render/thrownLook.ts）が重ねる戦輪の武器の絵の半径の目安（ドット。論理 4px） */
const LOOK_R = 8;

/**
 * 飛んでいる弾: 原点 = 弾の中心、+x = 進む向き。本体（刃・輪）は描画側が武器の絵を回して描くので描かない。
 * ここは下に重なる尾（残像・航跡）と、本体の外周に漏れる回転の風の光だけ
 */
function shotFly(frame, f, name, g) {
  shotTail(frame, f, name, g);
  if (name !== "flyingBlade" && name !== "chakram") spinBlur(frame, f, Math.max(LOOK_R + 2, g.body.r + g.body.bladeLen * 0.6), g.seed + 2);
}

/**
 * 手から放つ風切りの弧: 原点 = 弾が出た位置、+x = 投げた向き。原点を前へ通る円弧が手首の返しで走る。
 * 弾ごとに弧の大きさ・振り幅と、足す形（筋・風の弧・風車の閃き・2 本目の弧）を変える
 */
function shotMuzzle(frame, f, name) {
  const P = { x: 2, y: 0 };
  if (name === "chakram") {
    wristFlick(frame, P, 0, f, { R: 8, T: 3, sweep: 110, seed: 4101 });
    if (f >= 1 && f <= 3) streakLine(frame, { ax: 6 + f * 3, ay: -3, bx: 14 + f * 3, by: -3, bright: 0.6 - f * 0.1 });
    if (f === 1) sparkle(frame, 5, -1, 2);
    return;
  }
  if (name === "returnChakram") {
    // 横手投げ: 大きめの弧が前で内へ巻き込む（戻りの回転をかける）
    wristFlick(frame, P, -10 * DEG, f, { R: 12, T: 4, sweep: 170, seed: 4201 });
    if (f === 1) sparkle(frame, 8, -3, 2);
    if (f >= 2) tangentSparks(frame, f - 2, 4, 4202, { ox: 0, oy: 10, radius: 12, from: -1.9, to: -1.2, speed: 3 });
    return;
  }
  if (name === "flyingBlade") {
    // 大きな回転刃: 広く重い弧と、手元の風車の閃き
    wristFlick(frame, P, 0, f, { R: 16, T: 5, sweep: 160, seed: 4301 });
    if (f <= 1) bladeRing(frame, 2, 0, { r: 1.5, rw: 0, rot: f * 0.8, blades: 4, bladeLen: 7, bladeW: 1.6, curve: 1, seed: 4302 });
    if (f === 0) sparkle(frame, 2, 0, 3);
    return;
  }
  if (name === "ringThrow") {
    // 力を込めた 1 投: 弧と、前へ押し出す風の弧が 1 本
    wristFlick(frame, P, 0, f, { R: 11, T: 4.5, sweep: 150, seed: 4401 });
    if (f >= 1) frontArc(frame, { ox: 6 + f * 3, radius: 5 + f * 3, width: 1.8, squash: 0.5, erosion: Math.min(0.9, f * 0.2), bright: 0.7 - f * 0.1, seed: 4402 });
    if (f === 1) sparkle(frame, 4, 0, 3);
    return;
  }
  // twinRings: 2 発を ±10° に同時に投げる（閃光は 1 つにまとまる）。上下から 2 本の小さな弧
  // 2 本の弧の頂点を上下に離す（同じ点を通すと交点が白い塊になる）
  const Q = { x: P.x, y: -4 };
  wristFlick(frame, Q, -10 * DEG, f, { R: 8, T: 3, sweep: 120, seed: 4501 });
  wristFlick(mirrored(frame), Q, -10 * DEG, f, { R: 8, T: 3, sweep: 120, seed: 4502 });
  if (f === 1) sparkle(frame, 6, 0, 2);
}

/**
 * 跳弾（円月輪の着弾）: 壁で跳ね返る細い輪。当たった面の閃きと、横・後ろへ長く尾を引いて散る火花の筋。
 * 輪の縁が擦れた短い弧が面に沿って残る
 */
function ricochet(frame, f, g) {
  const N = 6;
  if (f <= 1) {
    lens(frame, { ax: 0, ay: -8, bx: 0, by: 8, T: f === 0 ? 3.4 : 2.2, bias: 0, bright: 0.95 });
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  // 火花の筋: 後ろの扇（跳ね返る向き）へ長く伸びながら先へ移る
  if (f >= 1 && f <= 4) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (hash1(i, g.seed + 21) - 0.5) * 2.4;
      const r0 = 2 + f * 3.5;
      const r1 = r0 + 6 + hash1(i, g.seed + 22) * 4;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.85 * (1 - f / N) });
    }
  }
  shards(frame, f, 9, g.seed + 23, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 3;
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
  });
  // 擦れた縁: 面に沿う短い弧（1 本）
  if (f >= 1 && f <= 3) smoothBand(frame, { ox: -g.body.r, oy: 0, R: g.body.r, T: 1.6, head: 70 * DEG, span: 140 * DEG, erosion: (f - 1) * 0.35, bright: 0.7, seed: g.seed + 24, peak: 0.5 });
}

/**
 * 着弾（戻る輪が壁で弾かれた）: 金属が噛み合う音の形。刃の数だけの短い針が弾け、後ろへ火花。
 * 大きな弾ほど針が長い
 */
function clang(frame, f, g) {
  const s = bodySize(g) / 9;
  const n = g.body.blades + 2;
  if (f <= 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1) - 0.5) * 2.4;
      spike(frame, { x: 0, y: 0, a, len: (6 + 4 * hash1(i, g.seed + 31)) * s * (f === 0 ? 0.8 : 1), w: 1.6 * s, bright: 0.95 });
    }
    spike(frame, { a: 0, len: 5 * s, w: 1.4, bright: 0.8 });
    sparkle(frame, 0, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1 && f <= 3) frontArc(frame, { ox: -1, radius: 4 + f * 3 * s, width: 1.6, squash: 0.5, spread: 60 * DEG, erosion: (f - 1) * 0.3, bright: 0.65 - f * 0.1, seed: g.seed + 32 });
  tangentSparks(frame, f, 8, g.seed + 33, { radius: 3 * s, from: Math.PI / 2, to: (3 * Math.PI) / 2, speed: 3.5 * s + 1 });
}

/**
 * 命中（敵を裂いた）: 原点 = 敵、+x = 進む向き。回る刃が裂いた弧の切り口 1 本と、前へ抜ける火花。
 * 刃の枚数で切り口の数は増やさない（1 回の当たり = 1 本）
 */
function shotHit(frame, f, g) {
  const N = 6;
  const s = bodySize(g) / 9;
  const R = 10 * s + 4;
  const k = f < 1 ? 0 : (f - 1) / (N - 1);
  const sweep = 110 * DEG;
  const grow = f === 0 ? 0.6 : 1;
  smoothBand(frame, { ox: 0, oy: R, R, T: 4.5 * s * (f === 0 ? 0.75 : 1 - 0.5 * k), head: -Math.PI / 2 + sweep * (grow - 0.5), span: sweep * grow, erosion: k * 0.9, bright: 1 - 0.2 * k, seed: g.seed + 41, peak: 0.3 });
  if (f === 0) sparkle(frame, 0, 0, 3);
  // 輪の衝撃は描かない（切り口の弧と重なって楕円の的に見える）。当たった点の閃きを 1 つ遅らせて足す
  if (f === 1) sparkle(frame, 3 * s, -2, 2);
  shards(frame, f, 6 + g.body.blades, g.seed + 43, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 3 + rnd(2) * 3;
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.82 };
  });
}

/**
 * 尽きた（射程の端）: dirs 1。回転が落ちた輪が倒れ（縦に潰れ）、少し落ちながら欠けて消える。最後は粒だけ
 */
function shotFizzle(frame, f, g) {
  const N = 7;
  const k = f / (N - 1);
  const rot = 0.3 + (1 - Math.pow(1 - k, 2)) * 1.2;
  if (f < N - 1) bladeRing(frame, 0, f * 0.8, { ...g.body, rot, squash: 1 - 0.65 * k, erosion: Math.min(0.92, k * 1.05), bright: 1 - 0.35 * k, seed: g.seed + 51 });
  if (f === 0) sparkle(frame, bodySize(g) * 0.6, -bodySize(g) * 0.4, 2);
  if (f >= 3) {
    for (let i = 0; i < 4; i++) {
      if (hash1(i + f * 5, g.seed + 52) < (f - 3) / (N - 2)) continue;
      dot(frame, (hash1(i, g.seed + 53) - 0.5) * bodySize(g) * 2, f * 0.8 + 2 + hash1(i, g.seed + 54) * 2, 3);
    }
  }
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

const SHOT_KEYS = ["chakram", "returnChakram", "flyingBlade", "ringThrow", "twinRings"];
/** 弾の key → シートの名前（art.ringThrow の「.」はシートの key に使わない） */
const BULLET_KEY = { chakram: "chakram", returnChakram: "returnChakram", flyingBlade: "flyingBlade", ringThrow: "art.ringThrow", twinRings: "art.twinRings" };

function shotSheets(name) {
  const g = SHOTS[name];
  const S = bodySize(g);
  return [
    { key: `warRing.${name}Fly`, dirs: DIRS, frames: FLY_FRAMES, active: 0, size: Math.ceil(g.tail + S + 8) * 2, draw: (frame, f) => shotFly(frame, f, name, g) },
    { key: `warRing.${name}Muzzle`, dirs: DIRS, frames: 5, active: 0, size: 72, draw: (frame, f) => shotMuzzle(frame, f, name) },
    {
      key: `warRing.${name}Impact`,
      dirs: DIRS,
      frames: 6,
      active: 0,
      size: 64,
      draw: name === "chakram" ? (frame, f) => ricochet(frame, f, g) : (frame, f) => clang(frame, f, g),
    },
    { key: `warRing.${name}Hit`, dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => shotHit(frame, f, g) },
    { key: `warRing.${name}Fizzle`, dirs: 1, frames: 7, active: 0, size: Math.ceil(S + 8) * 2, draw: (frame, f) => shotFizzle(frame, f, g) },
  ];
}

/** 弾の表の 1 行（鋼の刃なので配色は steel） */
function bulletRow(name) {
  const g = SHOTS[name];
  return {
    fly: `warRing.${name}Fly`,
    period: g.period,
    base: g.base,
    muzzle: `warRing.${name}Muzzle`,
    impact: `warRing.${name}Impact`,
    hit: `warRing.${name}Hit`,
    fizzle: `warRing.${name}Fizzle`,
    ramp: "steel",
  };
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "warRing",
  motions: {
    dash: { sheet: "warRing.dash", pivot: "self", base: 40, measure: "reach" },
    "r:ringSweep": { sheet: "warRing.sweep", pivot: "self", base: 26, measure: "reach" },
    "branch:tripleRing": { sheet: "warRing.triple", pivot: "self", base: 20, measure: "size" },
    "branch:ringSpin": { sheet: "warRing.spin", pivot: "self", base: 52, measure: "size" },
    "branch:ringSlash": { sheet: "warRing.slash", pivot: "self", base: 26, measure: "reach" },
    "branch:returnRing": { sheet: "warRing.return", pivot: "self", base: 20, measure: "size" },
  },
  hit: "warRing.hit",
  hitHeavy: "warRing.hitHeavy",
  bullets: Object.fromEntries(SHOT_KEYS.map((name) => [BULLET_KEY[name], bulletRow(name)])),
};

export const ATLAS = {
  key: "warRing",
  fx: FX,
  sheets: [
    { key: "warRing.sweep", dirs: WIDE_DIRS, frames: SWEEP.frames, active: SWEEP.active, size: 168, draw: (frame, f) => ringSwing(frame, f, SWEEP) },
    { key: "warRing.slash", dirs: WIDE_DIRS, frames: SLASH.frames, active: SLASH.active, size: 176, draw: (frame, f) => ringSwing(frame, f, SLASH) },
    { key: "warRing.spin", dirs: WIDE_DIRS, frames: SPIN.frames, active: SPIN.active, size: 160, draw: ringSpin },
    { key: "warRing.dash", dirs: DIRS, frames: 8, active: 4, size: 216, draw: dashThrust },
    { key: "warRing.triple", dirs: DIRS, frames: 8, active: 3, size: 96, draw: tripleRing },
    { key: "warRing.return", dirs: DIRS, frames: 8, active: 4, size: 112, draw: returnRing },
    { key: "warRing.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => meleeHit(frame, f, false) },
    { key: "warRing.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => meleeHit(frame, f, true) },
    ...SHOT_KEYS.flatMap(shotSheets),
  ],
};
