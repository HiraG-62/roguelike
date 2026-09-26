// チェーンアレイ（moveset "flail"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。見本は swordUlt.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/flail.json × 2 が目安
//
// 形の言葉は flail.mjs とそろえる（斬線は描かない。トゲ付きの鉄球・通り道の鉄球の残像・鎖の点列・外周の風圧・地面の衝撃）。
// 奥義はそれを大きく・長く・段の多い崩れにする:
//   - 流星錘: 巨大な鉄球が真上から落ちて地面を割る（1 撃の重さ。落下の筋 → 星形の衝撃 → 半径 60 の衝撃波 → 窪みとひび）
//   - 鉄球嵐: 鎖を伸ばした鉄球が周りを 2 周半し、5 回の打撃の星を置いていく（多段なので打撃の星はタイミングで分ける）
//   - 遠心の律: 腰の高さを楕円に回り続ける鉄球（奥の半周は地面のシートでキャラの後ろへ回す）
// 決まり: 1 振りの軌道は 1 本（残像は同じ通り道の上に並べるだけ）、白（段 7）は光点と球の照りだけ
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 部品: 鉄球・残像・鎖・ひび・破片（flail.mjs の部品を奥義の大きさ向けに写して作り変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズで欠ける）。keep が大きいほど残りやすい */
function eroded(x, y, erosion, keep, seed) {
  if (erosion <= 0) return false;
  return valueNoise(x, y, 3.6, seed) * 0.75 + keep * 0.35 - erosion * 1.1 < 0;
}

/**
 * トゲ付きの鉄球。奥義の球は大きいので、トゲの根元に暗い溝（段 2）を入れて金属の塊の重さを出す。
 * (lx, ly) は光の来る向き、squashY で上下に潰す（叩きつけた瞬間）
 */
function spikedBall(frame, cx, cy, o) {
  const r = o.r;
  const n = o.spikes ?? 8;
  const spikeLen = o.spikeLen ?? r * 0.55;
  const rot = o.rot ?? 0;
  const lx = o.lx ?? -0.6;
  const ly = o.ly ?? -0.7;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  const squashY = o.squashY ?? 1;
  const base = Math.max(1.8, r * 0.3);
  const pad = r + spikeLen + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = (y - cy) / squashY;
      const d = Math.hypot(dx, dy);
      if (d <= r) {
        const q = d / r;
        if (eroded(x, y, erosion, 1 - q, seed)) return -1;
        if (r - d < 1.2) return 0.24 * bright;
        const nx = dx / r;
        const ny = dy / r;
        const nz = Math.sqrt(Math.max(0, 1 - q * q));
        const lit = Math.max(0, nx * lx + ny * ly + nz * 0.55);
        const hx = lx * r * 0.42;
        const hy = ly * r * 0.42;
        if (Math.hypot(dx - hx, dy - hy) < Math.max(1, r * 0.13) && erosion < 0.4) return 1;
        // 照りの周りの明部（段 6）を細い弧で: 金属の球面の反射
        const rim = Math.hypot(dx - hx, dy - hy);
        if (rim < r * 0.3 && erosion < 0.4) return clamp01(0.82 * bright);
        return clamp01((0.28 + 0.5 * lit) * bright * (1 - erosion * 0.3));
      }
      if (d > r + spikeLen) return -1;
      const a = Math.atan2(dy, dx);
      const t = (d - r) / spikeLen;
      for (let i = 0; i < n; i++) {
        const ai = rot + (i / n) * TAU;
        const c = Math.cos(wrapAngle(a - ai));
        if (c <= 0) continue;
        const across = Math.abs(Math.sin(wrapAngle(a - ai))) * d;
        const w = base * (1 - t);
        if (across > w) continue;
        if (eroded(x, y, erosion, 0.3, seed + 3)) return -1;
        // 根元の溝（暗い）→ 刃の面（光の側が明るい）
        if (t < 0.12) return 0.2 * bright;
        const face = Math.cos(ai) * lx + Math.sin(ai) * ly;
        return clamp01((0.42 + 0.24 * face + 0.18 * (1 - across / Math.max(0.3, w))) * bright);
      }
      return -1;
    },
    { bounds: { x0: cx - pad, y0: cy - pad * squashY, x1: cx + pad, y1: cy + pad * squashY } },
  );
}

/** 鉄球の残像: トゲの無い丸い塊（通り道に置いていく重さの跡） */
function ghostBall(frame, cx, cy, r, bright, erosion, seed, sy = 1) {
  if (r < 1.2 || bright <= 0.05) return;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, (y - cy) / sy);
      if (d > r) return -1;
      const q = d / r;
      if (eroded(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01((0.32 + 0.45 * (1 - q * q)) * bright);
    },
    { bounds: { x0: cx - r - 1, y0: cy - r * sy - 1, x1: cx + r + 1, y1: cy + r * sy + 1 } },
  );
}

/** 鎖の輪 1 つ（奥義の鎖は太い。odd は横から見た輪で細い棒） */
function chainLink(frame, cx, cy, tx, ty, odd, bright, scale = 1) {
  const along = 3 * scale;
  const across = (odd ? 0.9 : 2.1) * scale;
  const pad = 5 * scale;
  paint(
    frame,
    (x, y) => {
      const px = x - cx;
      const py = y - cy;
      const u = (px * tx + py * ty) / along;
      const v = (-px * ty + py * tx) / across;
      const e = Math.hypot(u, v);
      if (e > 1) return -1;
      if (!odd && e < 0.45) return -1;
      return clamp01(bright * (0.75 + 0.25 * (1 - e)));
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0 },
  );
}

/** 鎖: a → b に輪を並べる。sag でたわみ、cut で手元の側から消える */
function chain(frame, ax, ay, bx, by, o = {}) {
  const bright = o.bright ?? 0.72;
  const sag = o.sag ?? 0;
  const cut = o.cut ?? 0;
  const scale = o.scale ?? 1;
  const step = 5.6 * scale;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 3 || bright <= 0.05) return;
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const count = Math.floor(len / step);
  for (let i = 0; i <= count; i++) {
    const t = i / Math.max(1, count);
    if (t < cut) continue;
    const bend = sag * 4 * t * (1 - t);
    const x = ax + (bx - ax) * t - ty * bend;
    const y = ay + (by - ay) * t + tx * bend;
    const db = (sag * 4 * (1 - 2 * t)) / len;
    const qx = tx - ty * db;
    const qy = ty + tx * db;
    const ql = Math.hypot(qx, qy);
    chainLink(frame, x, y, qx / ql, qy / ql, i % 2 === 1, bright * (0.7 + 0.3 * t), scale);
  }
}

/** 地面のひび: 中心から外へ折れ曲がって伸び、途中で枝分かれする線 */
function cracks(frame, o) {
  const { count, length, grow, fade, seed } = o;
  const r0 = o.r0 ?? 6;
  const sy = o.sy ?? 1;
  if (grow <= 0 || fade <= 0.05) return;
  for (let i = 0; i < count; i++) {
    let a = (i / count) * TAU + (hash1(i, seed) - 0.5) * 0.5;
    const L = length * (0.55 + 0.45 * hash1(i, seed + 1)) * grow;
    let x = Math.cos(a) * r0;
    let y = Math.sin(a) * r0 * sy;
    const segs = 5;
    for (let s = 0; s < segs; s++) {
      a += (hash1(i * 7 + s, seed + 2) - 0.5) * 0.45;
      const nx = x + Math.cos(a) * (L / segs);
      const ny = y + Math.sin(a) * (L / segs) * sy;
      const w = s === 0 ? 2.2 : s < 3 ? 1.6 : 1.1;
      streakLine(frame, { ax: nx, ay: ny, bx: x, by: y, width: w, bright: 0.46 * fade * (1 - s * 0.08) });
      // 枝: 2 節目と 3 節目から短く分かれる
      if ((s === 1 || s === 2) && hash1(i * 5 + s, seed + 3) > 0.45) {
        const ba = a + (hash1(i * 5 + s, seed + 4) > 0.5 ? 0.7 : -0.7);
        const bl = (L / segs) * 0.7;
        streakLine(frame, { ax: x + Math.cos(ba) * bl, ay: y + Math.sin(ba) * bl * sy, bx: x, by: y, width: 1, bright: 0.34 * fade });
      }
      x = nx;
      y = ny;
    }
  }
}

/** 破片: 中心から外へ跳ねる石くれ */
function debris(frame, age, count, speed, seed, o = {}) {
  const r0 = o.r0 ?? 6;
  const up = o.up ?? 0;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = speed * (0.5 + 0.8 * rnd(2));
    return { x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - up * rnd(5), life: 3 + Math.floor(rnd(3) * 4), size: rnd(4) > 0.3 ? 2 : 1, drag: 0.8 };
  });
}

/** トゲの打撃の星（中心から n 本の尖った光条）。長短を交互にして鉄球のトゲが当たった形に */
function spikeStar(frame, cx, cy, n, inner, outer, rot, T, bright, erosion, seed) {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const L = outer * (i % 2 === 0 ? 1 : 0.62);
    lens(frame, { ax: cx + Math.cos(a) * inner, ay: cy + Math.sin(a) * inner, bx: cx + Math.cos(a) * L, by: cy + Math.sin(a) * L, T: T * (i % 2 === 0 ? 1 : 0.7), bias: 0, erosion, bright, seed: seed + i });
  }
}

/**
 * 衝撃波の帯: 前縁（radius）に細い明るい縁、内側へ thick だけ薄れていく帯（煤の段 1〜3）。
 * 前縁から離れるほどノイズで欠けて、押し出した土煙の壁に見せる
 */
function shockBand(frame, o) {
  const { radius, thick, bright, erosion, seed } = o;
  const inner = Math.max(0, radius - thick);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > radius + 1 || r < inner) return -1;
      const q = (radius - r) / thick;
      if (q < 0.1) {
        if (!survivesBand(x, y, erosion, 1, seed)) return -1;
        return clamp01(bright * (1 - erosion * 0.35));
      }
      if (!survivesBand(x, y, erosion + q * 0.55, 1 - q, seed + 1)) return -1;
      return clamp01(bright * 0.62 * Math.pow(1 - q, 1.4) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -radius - 2, y0: -radius - 2, x1: radius + 2, y1: radius + 2 } },
  );
}

function survivesBand(x, y, erosion, keep, seed) {
  if (erosion <= 0) return true;
  return valueNoise(x, y, 4.2, seed) * 0.8 + keep * 0.3 - erosion * 1.05 > 0;
}

/** 石くれ: 3〜4 ドットの角ばった塊が外へ飛び、落ちる（破片の粒より重い手応え） */
function rocks(frame, age, count, speed, seed, r0) {
  for (let i = 0; i < count; i++) {
    const rnd = (k) => hash1(i * 13 + k, seed);
    const life = 4 + Math.floor(rnd(3) * 4);
    if (age < 0 || age > life) continue;
    const a = rnd(1) * TAU;
    const sp = speed * (0.6 + 0.7 * rnd(2));
    const drag = 0.8;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const cx = Math.cos(a) * (r0 + travel * sp);
    // 放物線: 上へ跳ねて落ちる（画面の上 = -y）
    const cy = Math.sin(a) * (r0 + travel * sp) - (age * 3.2 - age * age * 0.45) * (0.5 + rnd(4));
    const s = 1.6 + rnd(5) * 1.6;
    const spin = rnd(6) * TAU + age * 0.8;
    const fade = 1 - age / (life + 1);
    paint(
      frame,
      (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        // 角ばった形: 回した正方形（L∞）
        const u = dx * Math.cos(spin) + dy * Math.sin(spin);
        const v = -dx * Math.sin(spin) + dy * Math.cos(spin);
        const m = Math.max(Math.abs(u), Math.abs(v) * 1.3);
        if (m > s) return -1;
        return clamp01((v < 0 ? 0.62 : 0.4) * (0.5 + 0.5 * fade));
      },
      { bounds: { x0: cx - s - 2, y0: cy - s - 2, x1: cx + s + 2, y1: cy + s + 2 } },
    );
  }
}

/** 楕円の弧の線（腰の高さを回る軌道。arcLine は真円なので自前で）。from → to で明るくなる */
function ellipseArc(frame, o) {
  const { cx, cy, rx, ry, from, to } = o;
  const width = o.width ?? 1.2;
  const bright = o.bright ?? 0.5;
  const span = Math.max(1e-3, to - from);
  paint(
    frame,
    (x, y) => {
      const u = (x - cx) / rx;
      const v = (y - cy) / ry;
      const F = u * u + v * v;
      const g = 2 * Math.hypot(u / rx, v / ry);
      if (g < 1e-6) return -1;
      if (Math.abs((F - 1) / g) > width / 2) return -1;
      const a = Math.atan2(v, u);
      const t = ((((a - from) % TAU) + TAU) % TAU) / span;
      if (t > 1) return -1;
      return bright * (0.35 + 0.65 * t);
    },
    { bounds: { x0: cx - rx - width - 1, y0: cy - ry - width - 1, x1: cx + rx + width + 1, y1: cy + ry + width + 1 }, dither: 0, samples: 2 },
  );
}

// -----------------------------------------------------------------------------
// 流星錘（nova 半径 60・heavy・崩し）: 巨大な鉄球が真上から落ち、地面を割って周りを吹き飛ばす
// dirs 1（画面に揃える）: 落ちてくる向きは向きによらず画面の上から
// -----------------------------------------------------------------------------

/** 衝撃波の届く半径（60 論理 px × 2） */
const METEOR_R = 120;
/** 落ちてくる鉄球の半径（通常の叩きつけ 10〜12 の倍） */
const METEOR_BALL = 22;
const METEOR_N = 12;
/** 落下に 2 枚、3 枚目で着地 */
const METEOR_A = 3;
/** 着地したフレーム */
const METEOR_LAND = 2;

function meteorSlam(frame, f) {
  // 1) 落下: 真上から、落下の筋を引いて落ちてくる（筋は球の上だけ。軌道は 1 本）
  if (f < METEOR_LAND) {
    const by = f === 0 ? -96 : -42;
    const r = METEOR_BALL * (f === 0 ? 0.82 : 0.95);
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * (r * 0.3) + (hash1(i, 3101) - 0.5) * 3;
      const len = (f === 0 ? 40 : 70) * (0.6 + 0.4 * hash1(i, 3102)) * (1 - Math.abs(i - 3) * 0.12);
      const top = by - r * Math.cos(Math.asin(Math.min(0.95, Math.abs(x) / r))) * 0.9;
      streakLine(frame, { ax: x, ay: top - len, bx: x, by: top, width: i === 3 ? 2.2 : 1.3, bright: 0.72 - Math.abs(i - 3) * 0.07 });
    }
    // 空気を裂く楔: 球の下に尖る光（向かう先）
    lens(frame, { ax: 0, ay: by + r * 0.6, bx: 0, by: by + r + 12, T: r * 0.9, bias: 0, bright: 0.55, seed: 3103 });
    spikedBall(frame, 0, by, { r, spikes: 8, rot: -Math.PI / 2 + f * 0.3, lx: -0.5, ly: -0.8, seed: 3104 });
    if (f === 1) sparkle(frame, -r * 0.4, by - r * 0.5, 3);
    return;
  }
  const age = f - METEOR_LAND;
  const span = METEOR_N - METEOR_LAND;
  const k = age / (span - 1);
  // 2) 着地の閃光: トゲの形の星（8 本。長短交互）が一瞬で最大、2 枚で崩れる
  if (age <= 3) {
    const e = age === 0 ? 0 : 0.2 + age * 0.25;
    spikeStar(frame, 0, 0, 8, METEOR_BALL * 0.9, 58 + age * 8, -Math.PI / 2 + 0.2, 16 * (1 - age * 0.18), 1 - age * 0.12, e, 3110);
  }
  if (age === 0) sparkle(frame, 0, 0, 4);
  // 3) 衝撃波: 前縁が明るく内へ薄れる厚い帯が、当たりの縁（120）まで押し広がる（輪の線 1 本ではなく「押す壁」）
  const grow = Math.min(1, easeSwing((age + 1) / 4));
  const front = 30 + (METEOR_R - 30) * grow + Math.max(0, age - 3) * 3;
  shockBand(frame, { radius: front, thick: Math.min(front * 0.32, 26 * (1 - k * 0.6) + 4), bright: 0.95 - k * 0.45, erosion: age < 2 ? 0 : Math.min(0.95, 0.05 + k * 0.95), seed: 3111 });
  // 衝撃波の外側の風圧: 輪の外に沿う短い弧（8 方向）
  if (age >= 1 && k < 0.75) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + hash1(i, 3113) * 0.5;
      const rr = front + 6 + (i % 2) * 3;
      arcLine(frame, { radius: rr, from: a, to: a + 0.35 + 0.25 * hash1(i, 3114), width: 1.2, bright: 0.5 * (1 - k) });
    }
  }
  // 4) めり込んだ鉄球: 潰れて地面に埋まり、光を失って崩れる
  if (k < 0.8) {
    spikedBall(frame, 0, 2, {
      r: METEOR_BALL * (age === 0 ? 1.05 : 1),
      spikes: 8,
      rot: -Math.PI / 2 + 0.6,
      lx: -0.5,
      ly: -0.8,
      squashY: age === 0 ? 0.78 : 0.88 + Math.min(0.12, age * 0.04),
      bright: 1 - k * 0.45,
      erosion: Math.max(0, k - 0.3) * 1.8,
      seed: 3115,
    });
  }
  // 5) 破片と土くれ: 外へ、少し上へ跳ねる（2 波）
  rocks(frame, age, 14, 10, 3116, METEOR_BALL);
  debris(frame, age, 30, 9, 3117, { r0: METEOR_BALL, up: 3 });
  debris(frame, age - 2, 16, 5, 3118, { r0: METEOR_BALL + 10, up: 2 });
}

/** 流星錘の地面: 落下の影 → 窪み（暗い円と縁）・枝分かれするひび（当たりの縁まで）。最後まで残って薄れる */
function meteorGround(frame, f) {
  if (f < METEOR_LAND) {
    // 落ちてくる影: 近づくほど濃く大きい
    const s = f === 0 ? 0.55 : 0.85;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x / (METEOR_BALL * 1.2 * s), (y - 4) / (METEOR_BALL * 0.5 * s));
        return d > 1 ? -1 : 0.2 + 0.1 * s;
      },
      { bounds: { x0: -40, y0: -20, x1: 40, y1: 30 } },
    );
    return;
  }
  const age = f - METEOR_LAND;
  const k = age / (METEOR_N - METEOR_LAND - 1);
  const fade = 1 - Math.max(0, k - 0.35) * 1.4;
  if (fade <= 0.05) return;
  // 窪み: 中が暗く（段 1〜2）、縁が一段明るい
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y / 0.8) / (METEOR_BALL + 12);
      if (d > 1) return -1;
      if (eroded(x, y, Math.max(0, k - 0.4) * 1.6, 1 - d, 3120)) return -1;
      return (d > 0.82 ? 0.4 : 0.16 + 0.08 * d) * fade;
    },
    { bounds: { x0: -40, y0: -32, x1: 40, y1: 32 } },
  );
  cracks(frame, { count: 11, length: METEOR_R * 0.92, grow: Math.min(1, (age + 1) / 3), fade, seed: 3121, r0: METEOR_BALL + 8 });
  // 土煙: 窪みの縁に沿ってまばらに湧く（点状。塊にしない）
  if (age >= 1 && k < 0.85) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const rr = METEOR_BALL + 16 + age * 5;
        if (Math.abs(r - rr) > 7) return -1;
        if (valueNoise(x, y, 3, 3122 + age) < 0.55 + k * 0.3) return -1;
        return 0.26 * (1 - k);
      },
      { bounds: { x0: -90, y0: -90, x1: 90, y1: 90 } },
    );
  }
}

/** 流星錘の発動: 鎖ごと鉄球を真上へ振り上げる（下から上への筋・頭上で光る球・足元の潰れた輪） */
function meteorCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const p = easeSwing(Math.min(1, (f + 1) / 4));
  const by = 4 - 60 * p;
  // 足元の踏みしめ（地面に置いた潰れた輪）
  ring(frame, { oy: 18, radius: 10 + f * 4, width: 2.4 - k, squash: 2.2, erosion: Math.min(0.9, k * 0.9), bright: 0.7 - k * 0.3, seed: 3131 });
  if (k < 0.85) {
    // 振り上げの軌跡: 球の下を上へ流れる筋（球の後ろにだけ）
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 5 + (hash1(i, 3132) - 0.5) * 2;
      const len = 26 * (1 - Math.abs(i - 2) * 0.2) * (1 - k * 0.6);
      streakLine(frame, { ax: x, ay: by + 14 + len, bx: x, by: by + 12, width: i === 2 ? 1.6 : 1, bright: 0.6 * (1 - k * 0.6) });
    }
    chain(frame, 0, 0, 0, by + 12, { bright: 0.6 * (1 - k * 0.5), sag: f >= 4 ? 3 : 0, cut: Math.max(0, k - 0.5) * 2 });
    spikedBall(frame, 0, by, { r: 11, spikes: 8, rot: f * 0.5, erosion: Math.max(0, k - 0.6) * 2, bright: 1 - k * 0.2, seed: 3133 });
  }
  if (f === 3) sparkle(frame, 0, by - 16, 4);
  if (f === 4) sparkle(frame, 0, by - 16, 2);
}

// -----------------------------------------------------------------------------
// 鉄球嵐（nova 半径 54・5 回）: 鎖を伸ばした鉄球が周りを 2 周半し、通りすがりに 5 回の打撃の星を置く
// -----------------------------------------------------------------------------

/** 当たりの半径（54 論理 px × 2） */
const STORM_R = 108;
/** 鉄球の中心が回る半径（トゲの先が当たりの縁に届く） */
const STORM_RO = 92;
const STORM_BALL = 13;
const STORM_N = 14;
const STORM_A = 9;
/** 回る周数 */
const STORM_TURNS = 2.5;
/** 打撃の星を置くフレーム（5 回。回りの中で間をあけて） */
const STORM_HITS = [1, 3, 5, 7, 8];

function stormHead(f) {
  if (f < STORM_A) return -Math.PI / 2 + STORM_TURNS * TAU * ((f + 1) / STORM_A);
  // 振り終わり: 惰性で 1/4 周流れる
  const k = (f - STORM_A + 1) / (STORM_N - STORM_A + 1);
  return -Math.PI / 2 + STORM_TURNS * TAU + 0.9 * Math.sin((k * Math.PI) / 2);
}

function ironStorm(frame, f) {
  const A = STORM_A;
  const k = f < A ? 0 : (f - A + 1) / (STORM_N - A + 1);
  const head = stormHead(f);
  const travelled = head + Math.PI / 2;
  // 残像: 通り道に 13° おき（1 フレームで進む角をすき間なく埋め、彗星の尾に）。古いほど小さく暗い
  const ghosts = 9;
  const step = (13 * Math.PI) / 180;
  const alive = Math.ceil(ghosts * (1 - k * 1.1));
  for (let i = ghosts; i >= 1; i--) {
    if (i * step > travelled || i > alive) continue;
    const a = head - i * step;
    const age = i / (ghosts + 1);
    ghostBall(frame, Math.cos(a) * STORM_RO, Math.sin(a) * STORM_RO, STORM_BALL * (0.95 - 0.55 * age), (0.8 - 0.6 * age) * (1 - k * 0.5), k * 0.7 + age * 0.15, 3200 + i);
  }
  // 外周の風圧: 3 本の弧が球を追う（当たりの縁の外）
  if (k < 0.85) {
    for (let i = 0; i < 3; i++) {
      const a = head - 0.25 - i * (TAU / 3);
      const radius = STORM_R + 4 + (i % 2) * 3.5 + k * 10;
      arcLine(frame, { radius, from: a - 0.9 * (1 - k * 0.5), to: a, width: i % 2 ? 1 : 1.6, bright: 0.58 * (1 - k * 0.7) });
    }
    // 内側の渦の筋: 中心へ巻き込む短い弧（手元の回転の速さ）
    for (let i = 0; i < 3; i++) {
      const a = head * 1.3 + (i / 3) * TAU;
      arcLine(frame, { radius: 26 + i * 6, from: a - 0.9, to: a, width: 1, bright: 0.38 * (1 - k) });
    }
  }
  // 打撃の星: 置いたときの球の位置に、トゲの星が弾けて 3 枚で崩れる（多段なので 1 つずつ時間をずらす）
  STORM_HITS.forEach((hf, n) => {
    const age = f - hf;
    if (age < 0 || age > 3) return;
    const a = stormHead(hf) + 0.12;
    const cx = Math.cos(a) * (STORM_RO + 4);
    const cy = Math.sin(a) * (STORM_RO + 4);
    const e = age === 0 ? 0 : 0.25 + age * 0.22;
    spikeStar(frame, cx, cy, 6, 5 + age * 3, 26 + age * 5, a + n, 9 * (1 - age * 0.2), 1 - age * 0.15, e, 3230 + n * 10);
    if (age === 0) sparkle(frame, cx, cy, n === STORM_HITS.length - 1 ? 4 : 3);
    shards(frame, age, 6, 3240 + n, (i, rnd) => {
      const b = a + (rnd(1) - 0.3) * 1.6;
      const sp = 3 + rnd(2) * 3;
      return { x: cx, y: cy, vx: Math.cos(b) * sp, vy: Math.sin(b) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
    });
  });
  // 鎖と鉄球: 回っている間は張り、惰性の間はたわみながら手元から消える
  const bx = Math.cos(head) * STORM_RO;
  const by = Math.sin(head) * STORM_RO;
  if (k < 0.8) {
    const tip = STORM_RO - STORM_BALL - 3;
    chain(frame, Math.cos(head) * 12, Math.sin(head) * 12, Math.cos(head) * tip, Math.sin(head) * tip, { bright: 0.78 * (1 - k * 0.6), cut: k * 1.1, sag: k * 10, scale: 1.3 });
    spikedBall(frame, bx, by, { r: STORM_BALL * (1 - k * 0.2), spikes: 8, rot: head * 2.2, lx: Math.cos(head + 0.6), ly: Math.sin(head + 0.6), erosion: Math.max(0, k - 0.3) * 1.6, bright: 1 - k * 0.25, seed: 3250 });
  }
  // 振り終わり: 回し切った風が周り全体へ輪になって散り、刃片が接線へ飛ぶ
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { radius: STORM_R + age * 5, width: 3.6 - age * 0.4, erosion: Math.min(0.92, 0.3 + age * 0.15), bright: 0.72 - age * 0.07, seed: 3260 });
    shards(frame, age, 26, 3261, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = STORM_RO + (rnd(2) - 0.5) * 16;
      const sp = 4 + rnd(3) * 4;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (-Math.sin(a) * 0.75 + Math.cos(a) * 0.45) * sp, vy: (Math.cos(a) * 0.75 + Math.sin(a) * 0.45) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1 };
    });
  }
}

/** 鉄球嵐の地面: 鉄球の通り道に擦れた轍（点の帯）。回るほど濃くなり、終わりで薄れる */
function ironStormGround(frame, f) {
  const k = f < STORM_A ? 0 : (f - STORM_A + 1) / (STORM_N - STORM_A + 1);
  const grow = Math.min(1, (f + 1) / STORM_A);
  const dim = (0.2 + 0.12 * grow) * (1 - k);
  if (dim <= 0.05) return;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (Math.abs(r - STORM_RO) > 9) return -1;
      if (valueNoise(x, y, 2.6, 3270) < 0.62 - grow * 0.12 + k * 0.3) return -1;
      return dim * (1 - Math.abs(r - STORM_RO) / 12);
    },
    { bounds: { x0: -STORM_RO - 12, y0: -STORM_RO - 12, x1: STORM_RO + 12, y1: STORM_RO + 12 } },
  );
  ring(frame, { radius: STORM_R - 2, width: 1.4, erosion: Math.min(0.95, 0.25 + k * 0.8), bright: 0.3 * grow * (1 - k), seed: 3271 });
}

/** 鉄球嵐の発動: 手元で小さく回し始めた鉄球が、渦を描いて外へ振り出される（螺旋 1 周半） */
function ironStormCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const turns = 1.5;
  const at = (t) => {
    const a = -Math.PI / 2 + turns * TAU * t;
    const r = 14 + 36 * t;
    return { a, r, x: Math.cos(a) * r, y: Math.sin(a) * r };
  };
  const p = Math.min(1, (f + 1) / 6);
  // 螺旋の残像（通り道の上だけ）
  for (let i = 1; i <= 8; i++) {
    const t = p - i * 0.035;
    if (t < 0) break;
    const g = at(t);
    ghostBall(frame, g.x, g.y, 6.5 * (1 - i * 0.08), (0.72 - i * 0.075) * (1 - k * 0.6), i * 0.05 + k * 0.5, 3280 + i);
  }
  const h = at(p);
  if (k < 0.9) {
    chain(frame, Math.cos(h.a) * 6, Math.sin(h.a) * 6, Math.cos(h.a) * (h.r - 9), Math.sin(h.a) * (h.r - 9), { bright: 0.6 * (1 - k * 0.5) });
    spikedBall(frame, h.x, h.y, { r: 7, spikes: 6, rot: h.a * 2, lx: Math.cos(h.a + 0.6), ly: Math.sin(h.a + 0.6), erosion: Math.max(0, k - 0.7) * 2.5, seed: 3290 });
    arcLine(frame, { radius: h.r + 11, from: h.a - 1, to: h.a - 0.1, width: 1.3, bright: 0.55 * (1 - k * 0.5) });
  }
  if (f === 5) sparkle(frame, h.x, h.y, 3);
  if (f >= 5) ring(frame, { radius: 56 + (f - 5) * 7, width: 2.2, erosion: Math.min(0.9, 0.2 + (f - 5) * 0.3), bright: 0.6 - (f - 5) * 0.12, seed: 3291 });
}

// -----------------------------------------------------------------------------
// 遠心の律（持続）: 腰の高さの楕円を鉄球が回り続ける。手前の半周は本体、奥の半周は地面のシート（キャラの後ろ）
// dirs 1。1 巡 = 1 周なので、フレームが一巡しても継ぎ目が出ない
// -----------------------------------------------------------------------------

const CF_N = 12;
/** 軌道の楕円（腰の高さ。キャラは絵で 48 ドット、原点は体の中心） */
const CF_CX = 0;
const CF_CY = -2;
const CF_RX = 44;
const CF_RY = 14;
const CF_BALL = 7;
/** 足元の輪の中心 */
const FEET_Y = 18;

function orbitAt(a) {
  return { x: CF_CX + Math.cos(a) * CF_RX, y: CF_CY + Math.sin(a) * CF_RY };
}

/**
 * 纏いの 1 フレーム。front = true で手前の半周（sin > 0）、false で奥の半周だけを描く。
 * 奥は少し暗く小さく（遠い）、鎖は体の中心から球へ
 */
function centrifugeOrbit(frame, f, front) {
  const head = (f / CF_N) * TAU - Math.PI / 2;
  const isFront = (a) => Math.sin(a) >= 0;
  // 軌道の風圧: 球の後ろを追う楕円の弧を 2 本（楕円の外側に沿わせるだけ）
  for (let i = 0; i < 2; i++) {
    const to = head - 0.2 - i * Math.PI;
    const from = to - 1.5;
    // 手前 / 奥の判定は弧の中ほどで（弧の半分ずつに切ると継ぎ目が出るので、分けて描く）
    const pieces = 6;
    for (let s = 0; s < pieces; s++) {
      const a0 = from + ((to - from) * s) / pieces;
      const a1 = from + ((to - from) * (s + 1)) / pieces;
      if (isFront((a0 + a1) / 2) !== front) continue;
      const t = (s + 1) / pieces;
      ellipseArc(frame, { cx: CF_CX, cy: CF_CY, rx: CF_RX + 8 + i * 3, ry: CF_RY + 5 + i * 2, from: a0, to: a1, width: i === 0 ? 1.5 : 1.1, bright: (front ? 0.58 : 0.4) * (0.35 + 0.65 * t) });
    }
  }
  // 残像: 通り道に 5 つ
  for (let i = 5; i >= 1; i--) {
    const a = head - i * 0.36;
    if (isFront(a) !== front) continue;
    const p = orbitAt(a);
    const depth = front ? 1 : 0.8;
    ghostBall(frame, p.x, p.y, CF_BALL * (0.95 - 0.1 * i) * depth, (0.7 - 0.11 * i) * depth, i * 0.08, 3300 + i, 0.8);
  }
  if (isFront(head) !== front) return;
  const p = orbitAt(head);
  const depth = front ? 1 : 0.82;
  // 鎖: 体の中心から球へ。奥のときは体に隠れる手元を省く
  const len = Math.hypot(p.x, p.y);
  const tx = p.x / len;
  const ty = p.y / len;
  const start = front ? 6 : 14;
  chain(frame, tx * start, ty * start, p.x - tx * (CF_BALL + 2), p.y - ty * (CF_BALL + 2), { bright: 0.6 * depth, scale: 0.8 });
  spikedBall(frame, p.x, p.y, { r: CF_BALL * depth, spikes: 6, rot: head * 2.5, lx: Math.cos(head + 0.7), ly: Math.sin(head + 0.7) - 0.4, bright: depth, seed: 3310 });
}

function centrifugeSustain(frame, f) {
  centrifugeOrbit(frame, f, true);
  // 律の光点: 軌道の左右の端を球が通る瞬間に小さく光る（1 巡に 2 回）
  if (f === 0) sparkle(frame, CF_CX + CF_RX + 10, CF_CY - 2, 2);
  if (f === CF_N / 2) sparkle(frame, CF_CX - CF_RX - 10, CF_CY - 2, 2);
}

/** 纏いの地面: 奥の半周と、足元の輪・6 つの刻み（1 巡で 1/6 回る = 継ぎ目が出ない） */
function centrifugeGround(frame, f) {
  const cycle = f / CF_N;
  ring(frame, { oy: FEET_Y, radius: 13, width: 1.5, squash: 2.3, bright: 0.28, seed: 3320 });
  for (let i = 0; i < 6; i++) {
    const a = ((i + cycle) / 6) * TAU;
    const cx = Math.cos(a) * 40;
    const cy = FEET_Y + Math.sin(a) * 17;
    const nx = Math.cos(a);
    const ny = Math.sin(a) * 0.42;
    streakLine(frame, { ax: cx - nx * 4, ay: cy - ny * 4, bx: cx + nx * 4, by: cy + ny * 4, width: 1.4, bright: 0.3 });
  }
  centrifugeOrbit(frame, f, false);
}

/** 遠心の律の発動: 鉄球が楕円の螺旋で外へ振り出され、軌道に乗った瞬間に輪が弾ける */
function centrifugeCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const p = Math.min(1, (f + 1) / 6);
  const at = (t) => {
    const a = -Math.PI / 2 + 2 * TAU * t;
    const s = 0.3 + 0.7 * t;
    return { a, x: CF_CX + Math.cos(a) * CF_RX * s, y: CF_CY + Math.sin(a) * CF_RY * s };
  };
  if (f < 7) {
    for (let i = 1; i <= 6; i++) {
      const t = p - i * 0.05;
      if (t < 0) break;
      const g = at(t);
      ghostBall(frame, g.x, g.y, CF_BALL * (0.9 - i * 0.08), 0.7 - i * 0.09, i * 0.08, 3330 + i, 0.8);
    }
    const h = at(p);
    spikedBall(frame, h.x, h.y, { r: CF_BALL, spikes: 6, rot: h.a * 2, lx: Math.cos(h.a + 0.7), ly: Math.sin(h.a + 0.7) - 0.4, seed: 3340 });
  }
  if (f >= 5) {
    const age = f - 5;
    const s = 1 + age * 0.14;
    ellipseArc(frame, { cx: CF_CX, cy: CF_CY, rx: (CF_RX + 8) * s, ry: (CF_RY + 5) * s, from: 0, to: TAU - 0.01, width: 2.4 - age * 0.3, bright: 0.8 - age * 0.14 });
    if (age === 0) sparkle(frame, CF_CX + CF_RX + 8, CF_CY, 4);
    shards(frame, age, 14, 3341, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * (CF_RX + 6), y: CF_CY + Math.sin(a) * (CF_RY + 4), vx: -Math.sin(a) * sp * 0.8 + Math.cos(a) * sp * 0.5, vy: (Math.cos(a) * 0.8 + Math.sin(a) * 0.5) * sp * 0.45, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
    });
  }
  // 足元の踏みしめ
  ring(frame, { oy: FEET_Y, radius: 8 + f * 4, width: 2.2 - k, squash: 2.3, erosion: Math.min(0.9, k), bright: 0.6 - k * 0.3, seed: 3342 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は周囲攻撃の半径（論理 px）。
 * 配色: 流星錘は光（流星の輝き）、鉄球嵐は鋼（鉄の嵐）、遠心の律は光（持続の軌跡の色 #ffd75f に合わせる）
 */
const FX = {
  moveset: "flail",
  ultimates: {
    "flail.meteorBall": {
      ramp: "light",
      cast: { sheet: "flailUlt.meteorBallCast", life: 0.35 },
      acts: [{ sheet: "flailUlt.meteorBall", life: 0.75, base: METEOR_R / 2, pivot: "pos", ground: "flailUlt.meteorBallGround" }],
    },
    "flail.ironStorm": {
      ramp: "steel",
      cast: { sheet: "flailUlt.ironStormCast", life: 0.3 },
      acts: [{ sheet: "flailUlt.ironStorm", life: 0.8, base: STORM_R / 2, pivot: "pos", ground: "flailUlt.ironStormGround" }],
    },
    "flail.centrifuge": {
      ramp: "light",
      cast: { sheet: "flailUlt.centrifugeCast", life: 0.5 },
      sustain: { sheet: "flailUlt.centrifuge", period: 0.6, ground: "flailUlt.centrifugeGround" },
    },
  },
};

export const ATLAS = {
  key: "flailUlt",
  fx: FX,
  sheets: [
    { key: "flailUlt.meteorBall", dirs: 1, frames: METEOR_N, active: METEOR_A, size: 2 * (METEOR_R + 30), draw: meteorSlam },
    { key: "flailUlt.meteorBallGround", dirs: 1, frames: METEOR_N, active: METEOR_A, size: 2 * (METEOR_R + 8), draw: meteorGround },
    { key: "flailUlt.meteorBallCast", dirs: 1, frames: 8, active: 0, size: 180, draw: meteorCast },
    { key: "flailUlt.ironStorm", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 34), draw: ironStorm },
    { key: "flailUlt.ironStormGround", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 8), draw: ironStormGround },
    { key: "flailUlt.ironStormCast", dirs: 1, frames: 8, active: 0, size: 150, draw: ironStormCast },
    { key: "flailUlt.centrifugeCast", dirs: 1, frames: 10, active: 0, size: 190, draw: centrifugeCast },
    { key: "flailUlt.centrifuge", dirs: 1, frames: CF_N, active: 0, size: 140, draw: centrifugeSustain },
    { key: "flailUlt.centrifugeGround", dirs: 1, frames: CF_N, active: 0, size: 140, draw: centrifugeGround },
  ],
};
