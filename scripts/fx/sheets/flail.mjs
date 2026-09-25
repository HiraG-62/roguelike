// moveset "flail"（チェーンアレイ）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/flail.json）× 2 が目安
//
// 剣の「刃の三日月」と見分けるため、斬線は描かない。描くのは鉄球の通り道:
//   - 先頭の鉄球（トゲ付きの球。陰影と光点で重さを出す）
//   - 通り道に間隔をあけて並ぶ鉄球の残像（新しいほど明るく大きい）
//   - 手元から鉄球までの鎖（輪の点列の直線）
//   - 外周の風圧の速度線、叩きつけは地面の衝撃の輪・ひび・破片
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS, WIDE_SWEEP } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 部品: 鉄球・残像・鎖・ひび
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズで欠ける）。keep が大きいほど残りやすい */
function eroded(x, y, erosion, keep, seed) {
  if (erosion <= 0) return false;
  return valueNoise(x, y, 3.2, seed) * 0.75 + keep * 0.35 - erosion * 1.1 < 0;
}

/**
 * トゲ付きの鉄球。中心 (cx, cy)、半径 r、トゲ spikes 本（長さ spikeLen）、rot はトゲの角。
 * (lx, ly) は光の来る向き（単位ベクトル。進む向きの外側を明るくして、遠心力で振られている球に見せる）
 */
function spikedBall(frame, cx, cy, o) {
  const r = o.r;
  const n = o.spikes ?? 6;
  const spikeLen = o.spikeLen ?? r * 0.6;
  const rot = o.rot ?? 0;
  const lx = o.lx ?? -0.6;
  const ly = o.ly ?? -0.6;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  const base = Math.max(1.6, r * 0.32);
  const pad = r + spikeLen + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= r) {
        const q = d / r;
        if (eroded(x, y, erosion, 1 - q, seed)) return -1;
        // 縁の 1 ドットは暗い輪郭（床の上で球の丸さを締める）
        if (r - d < 1.1) return 0.24 * bright;
        const nx = dx / r;
        const ny = dy / r;
        const nz = Math.sqrt(Math.max(0, 1 - q * q));
        const lit = Math.max(0, nx * lx + ny * ly + nz * 0.55);
        // 光点: 光の側の小さな白（金属の照り）
        const hx = cx + lx * r * 0.42;
        const hy = cy + ly * r * 0.42;
        if (Math.hypot(x - hx, y - hy) < Math.max(1, r * 0.16) && erosion < 0.4) return 1;
        return clamp01((0.3 + 0.48 * lit) * bright * (1 - erosion * 0.3));
      }
      if (d > r + spikeLen) return -1;
      // トゲ: 球の縁から外へ尖る三角
      const a = Math.atan2(dy, dx);
      const t = (d - r) / spikeLen;
      for (let i = 0; i < n; i++) {
        const ai = rot + (i / n) * TAU;
        const across = Math.abs(Math.sin(wrapAngle(a - ai))) * d;
        if (Math.cos(wrapAngle(a - ai)) <= 0) continue;
        if (across > base * (1 - t)) continue;
        if (eroded(x, y, erosion, 0.3, seed + 3)) return -1;
        const face = Math.cos(ai) * lx + Math.sin(ai) * ly;
        return clamp01((0.42 + 0.22 * face + 0.18 * (1 - across / Math.max(0.3, base * (1 - t)))) * bright);
      }
      return -1;
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad } },
  );
}

/** 鉄球の残像: トゲの無い丸い塊。中が少し明るく縁が暗い（通り道に置いていく重さの跡） */
function ghostBall(frame, cx, cy, r, bright, erosion, seed) {
  if (r < 1.2 || bright <= 0.05) return;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) return -1;
      const q = d / r;
      if (eroded(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01((0.35 + 0.45 * (1 - q * q)) * bright);
    },
    { bounds: { x0: cx - r - 1, y0: cy - r - 1, x1: cx + r + 1, y1: cy + r + 1 } },
  );
}

/** 鎖の輪 1 つ（楕円の輪。odd は横から見た輪で細い棒） */
function chainLink(frame, cx, cy, tx, ty, odd, bright) {
  const along = 2.4;
  const across = odd ? 0.75 : 1.7;
  const pad = 4;
  paint(
    frame,
    (x, y) => {
      const px = x - cx;
      const py = y - cy;
      const u = (px * tx + py * ty) / along;
      const v = (-px * ty + py * tx) / across;
      const e = Math.hypot(u, v);
      if (e > 1) return -1;
      // 正面の輪は中を抜く（点列が「鎖」に見える）
      if (!odd && e < 0.45) return -1;
      return clamp01(bright * (0.75 + 0.25 * (1 - e)));
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0 },
  );
}

/**
 * 鎖: (ax, ay) → (bx, by) に輪を並べる。sag で中ほどが横へたわむ（緩んだ鎖）。
 * cut（0..1）で手元の側から輪が消える（振り終わりに鎖がほどけて消える）
 */
function chain(frame, ax, ay, bx, by, o = {}) {
  const bright = o.bright ?? 0.72;
  const sag = o.sag ?? 0;
  const cut = o.cut ?? 0;
  const step = o.step ?? 4.6;
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
    // たわみの接線
    const db = sag * 4 * (1 - 2 * t) / len;
    const qx = tx - ty * db;
    const qy = ty + tx * db;
    const ql = Math.hypot(qx, qy);
    chainLink(frame, x, y, qx / ql, qy / ql, i % 2 === 1, bright * (0.7 + 0.3 * t));
  }
}

/** 地面のひび: 中心から外へ、折れ曲がりながら伸びる線。grow（0..1）で伸び、fade で薄れる */
function cracks(frame, count, length, grow, fade, seed) {
  if (grow <= 0 || fade <= 0.05) return;
  for (let i = 0; i < count; i++) {
    let a = (i / count) * TAU + (hash1(i, seed) - 0.5) * 0.8;
    const L = length * (0.6 + 0.5 * hash1(i, seed + 1)) * grow;
    let x = Math.cos(a) * 5;
    let y = Math.sin(a) * 5;
    const segs = 4;
    for (let s = 0; s < segs; s++) {
      a += (hash1(i * 7 + s, seed + 2) - 0.5) * 0.9;
      const nx = x + Math.cos(a) * (L / segs);
      const ny = y + Math.sin(a) * (L / segs);
      streakLine(frame, { ax: nx, ay: ny, bx: x, by: y, width: s === 0 ? 1.6 : 1.1, bright: 0.42 * fade });
      x = nx;
      y = ny;
    }
  }
}

/** 破片: 地面から外へ跳ねる石くれ（叩きつけ） */
function debris(frame, age, count, speed, seed, ox = 0, oy = 0) {
  shards(frame, age, count, seed, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = speed * (0.55 + 0.8 * rnd(2));
    return { x: ox + Math.cos(a) * 4, y: oy + Math.sin(a) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.35 ? 2 : 1, drag: 0.78 };
  });
}

/** トゲの打撃の星: 中心から n 本の尖った光条（鉄球のトゲが当たった形） */
function spikeStar(frame, n, inner, outer, rot, T, bright, erosion, seed) {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const L = outer * (i % 2 === 0 ? 1 : 0.68);
    lens(frame, { ax: Math.cos(a) * inner, ay: Math.sin(a) * inner, bx: Math.cos(a) * L, by: Math.sin(a) * L, T: T * (i % 2 === 0 ? 1 : 0.75), bias: 0, erosion, bright, seed: seed + i });
  }
}

// -----------------------------------------------------------------------------
// 振り（arc）: 大きな円弧を走る鉄球と残像と鎖
// -----------------------------------------------------------------------------

/** 左 1 段（arc 200° reach 36）: 大きな半円を払う */
const L0 = { R: 74, ball: 10, spikes: 6, sweep: 200, tilt: 0, frames: 8, active: 4, ghosts: 5, ghostStep: 24, overshoot: 0.1, lines: 2, shards: 6, seed: 1101 };
/** 左 2 段（arc 220° reach 36）: 返し。わずかに振り幅が広く、残像が多い */
const L1 = { R: 76, ball: 10, spikes: 6, sweep: 220, tilt: 8, frames: 8, active: 4, ghosts: 6, ghostStep: 22, overshoot: 0.12, lines: 3, shards: 7, seed: 1202 };
/** 右: 振り回し（arc 270° reach 38）: 4 分の 3 周。風圧の線が太い */
const CHAIN_SWING = { R: 78, ball: 10, spikes: 6, sweep: 270, tilt: 0, frames: 9, active: 5, ghosts: 7, ghostStep: 23, overshoot: 0.1, lines: 4, shards: 8, seed: 1303 };
/** 派生: 鎖払い（arc 300° reach 40）: 地面すれすれを低く払う。残像が詰まって並び、外周に長い風圧 */
const CHAIN_SWEEP = { R: 82, ball: 10, spikes: 6, sweep: 300, tilt: 0, frames: 9, active: 5, ghosts: 9, ghostStep: 19, overshoot: 0.08, lines: 3, shards: 10, seed: 1404, dust: true };
/** 溜め（arc 360° reach 42 heavy）: 1 周の大振り。最も大きな球と、終わりに風圧の輪 */
const CHARGE = { R: 86, ball: 12, spikes: 8, sweep: 360, tilt: 0, frames: 9, active: 5, ghosts: 10, ghostStep: 22, overshoot: 0.06, lines: 5, shards: 12, seed: 1505, burst: true };

/** 振りの進み（active で 0 → 1、残りで overshoot 分だけ惰性で流れる）と崩れ k */
function swingPhase(f, A, N, overshoot) {
  if (f < A) return { p: easeSwing((f + 1) / A), k: 0 };
  const k = (f - A + 1) / (N - A + 1);
  return { p: 1 + overshoot * Math.sin((k * Math.PI) / 2), k };
}

/** 振りの 1 フレーム */
function swingArc(frame, f, s) {
  const half = (s.sweep * DEG) / 2;
  const from = -half + s.tilt * DEG;
  const sweep = half * 2;
  const A = s.active;
  const { p, k } = swingPhase(f, A, s.frames, s.overshoot);
  const head = from + sweep * p;
  const Rc = s.R - s.ball - 3;
  const step = s.ghostStep * DEG;
  // 残像: 通り道に一定の角度おきに置く。崩れの間は古い（遠い）ものから消える
  const alive = Math.ceil(s.ghosts * (1 - k * 1.1));
  for (let i = s.ghosts; i >= 1; i--) {
    const a = head - i * step;
    if (a < from - 0.02 || i > alive) continue;
    const age = i / (s.ghosts + 1);
    ghostBall(frame, Math.cos(a) * Rc, Math.sin(a) * Rc, s.ball * (0.95 - 0.5 * age), (0.78 - 0.55 * age) * (1 - k * 0.5), k * 0.7 + age * 0.15, s.seed + i);
  }
  // 外周の風圧: 球の外側に沿う線（刃の外側の速度線と同じく、内側には引かない）
  const trail = Math.min(head - from, sweep * 0.55);
  for (let i = 0; i < s.lines; i++) {
    if (k >= 0.9) break;
    const radius = s.R + 3 + i * 2.5 + k * 6;
    const len = trail * (0.45 + 0.4 * hash1(i, s.seed + 5)) * (1 - k * 0.7);
    const end = head - 0.1 - 0.15 * hash1(i, s.seed + 6) + k * 0.3;
    arcLine(frame, { radius, from: end - len, to: end, bright: (0.6 - i * 0.05) * (1 - k * 0.6) });
  }
  // 鎖払い: 低く払う軌道の土煙（円周の内側に沿う薄い帯。弧の刃に見えないよう崩して点に）
  if (s.dust && f >= 1) {
    const dk = Math.min(1, k + 0.35);
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const behind = wrapAngle(head - a);
        if (behind < 0.2 || behind > Math.min(head - from, 3.6)) return -1;
        const w = 5 * (1 - behind / 3.6);
        if (Math.abs(r - (s.R + 2)) > w) return -1;
        if (valueNoise(x, y, 3, s.seed + 9) - dk * 0.7 < 0.15) return -1;
        return 0.18;
      },
      { bounds: { x0: -s.R - 10, y0: -s.R - 10, x1: s.R + 10, y1: s.R + 10 } },
    );
  }
  // 鉄球が溶けて消えるまでの間だけ、鎖と鉄球を描く
  const bx = Math.cos(head) * Rc;
  const by = Math.sin(head) * Rc;
  if (k < 0.8) {
    chain(frame, Math.cos(head) * 10, Math.sin(head) * 10, Math.cos(head) * (Rc - s.ball - 2), Math.sin(head) * (Rc - s.ball - 2), { bright: 0.62 * (1 - k * 0.6), cut: k * 1.1, sag: k * 6 });
    // 光は球の外側（遠心力の向き）と進む向きの間から
    const lx = Math.cos(head + 0.6);
    const ly = Math.sin(head + 0.6);
    spikedBall(frame, bx, by, { r: s.ball * (1 - k * 0.2), spikes: s.spikes, rot: head * 2.2, lx, ly, erosion: Math.max(0, k - 0.3) * 1.6, bright: 1 - k * 0.25, seed: s.seed + 20 });
  }
  if (f === A - 1) sparkle(frame, Math.cos(head + 0.18) * (Rc + s.ball), Math.sin(head + 0.18) * (Rc + s.ball), 3);
  if (s.burst && f >= A) {
    const age = f - A + 1;
    ring(frame, { radius: s.R - 8 + age * 5, width: 3 - age * 0.3, erosion: Math.min(0.9, age * 0.17), bright: 0.7 - age * 0.07, seed: s.seed + 30 });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), s.shards, s.seed + 40, (i, rnd) => {
      const a = head - rnd(1) * 0.9;
      const sp = 3 + rnd(2) * 3.5;
      const out = 0.3 + 0.5 * rnd(3);
      return { x: Math.cos(a) * (Rc + s.ball * 0.8), y: Math.sin(a) * (Rc + s.ball * 0.8), vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp, vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1 };
    });
  }
}

function swingSheet(key, s) {
  return { key, dirs: s.sweep >= WIDE_SWEEP ? WIDE_DIRS : DIRS, frames: s.frames, active: s.active, size: Math.ceil(s.R + 22) * 2, draw: (frame, f) => swingArc(frame, f, s) };
}

// -----------------------------------------------------------------------------
// 回転（circle）: 大きな円周を回る鉄球と外周の風圧
// -----------------------------------------------------------------------------

/** 左 3 段（circle size 76）: 自分の周りを 1 周 */
const SPIN = { Ro: 64, ball: 10, spikes: 6, turns: 1, frames: 9, active: 5, ghosts: 9, ghostStep: 26, winds: 4, seed: 2101 };
/** ダッシュ（circle size 64）: 素早い 1 周。残像は間遠く、風圧の輪が速く散る */
const DASH_SPIN = { Ro: 52, ball: 9, spikes: 6, turns: 1, frames: 8, active: 4, ghosts: 6, ghostStep: 34, winds: 3, seed: 2202 };
/** 派生: 星砕き（circle size 80・2 段ヒット・最大の衝撃）: 2 周して 2 回光り、最後に星形の衝撃が弾ける */
const STAR = { Ro: 66, ball: 12, spikes: 8, turns: 2, frames: 10, active: 6, ghosts: 10, ghostStep: 24, winds: 5, seed: 2303, flashes: [2, 5], star: true };

function spinOrbit(frame, f, s) {
  const A = s.active;
  const N = s.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1 + 0.08 * Math.sin((k * Math.PI) / 2);
  const head = -Math.PI / 2 + s.turns * TAU * p;
  const travelled = s.turns * TAU * p;
  const step = s.ghostStep * DEG;
  const flash = s.flashes?.includes(f) ? 1.12 : 1;
  const alive = Math.ceil(s.ghosts * (1 - k * 1.1));
  for (let i = s.ghosts; i >= 1; i--) {
    if (i * step > travelled || i > alive) continue;
    const a = head - i * step;
    const age = i / (s.ghosts + 1);
    ghostBall(frame, Math.cos(a) * s.Ro, Math.sin(a) * s.Ro, s.ball * (0.95 - 0.5 * age), (0.78 - 0.55 * age) * (1 - k * 0.5) * flash, k * 0.7 + age * 0.15, s.seed + i);
  }
  // 外周の風圧: 当たり判定の縁のすぐ外を回る短い弧の線（球より少し遅れて回る）
  if (k < 0.85) {
    for (let i = 0; i < s.winds; i++) {
      const a = head - 0.3 - i * (TAU / s.winds) * 0.9;
      const radius = s.Ro + s.ball + 6 + (i % 2) * 3 + k * 8;
      arcLine(frame, { radius, from: a - 1.1 * (1 - k * 0.5), to: a, width: i % 2 ? 1 : 1.4, bright: 0.55 * (1 - k * 0.7) * flash });
    }
  }
  const bx = Math.cos(head) * s.Ro;
  const by = Math.sin(head) * s.Ro;
  if (k < 0.75) {
    chain(frame, Math.cos(head) * 9, Math.sin(head) * 9, Math.cos(head) * (s.Ro - s.ball - 2), Math.sin(head) * (s.Ro - s.ball - 2), { bright: 0.62 * (1 - k * 0.6), cut: k * 1.2, sag: k * 5 });
    spikedBall(frame, bx, by, { r: s.ball, spikes: s.spikes, rot: head * 2.5, lx: Math.cos(head + 0.7), ly: Math.sin(head + 0.7), erosion: Math.max(0, k - 0.25) * 1.6, bright: (1 - k * 0.25) * flash, seed: s.seed + 20 });
  }
  if (s.flashes?.includes(f)) sparkle(frame, bx, by, 4);
  if (s.star && f >= A - 1) {
    // 星砕き: 回し切った瞬間に周り全体へ星形の衝撃（最大の打撃）
    const age = f - (A - 1);
    const g = Math.min(1, 0.55 + age * 0.3);
    const e = Math.max(0, (age - 1) * 0.22);
    spikeStar(frame, 10, 16 + age * 6, (s.Ro + 18) * g, head * 0.3 + 0.2, 16 * (1 - e * 0.5), 1 - e * 0.4, e, s.seed + 50);
    ring(frame, { radius: 20 + age * 14, width: 4 - age * 0.4, erosion: Math.min(0.9, age * 0.16), bright: 0.85 - age * 0.08, seed: s.seed + 60 });
    if (age >= 1) ring(frame, { radius: 10 + age * 9, width: 2.4, erosion: Math.min(0.9, age * 0.2), bright: 0.6 - age * 0.06, seed: s.seed + 61 });
    if (age <= 1) sparkle(frame, 0, 0, 4);
    debris(frame, age, 18, 6, s.seed + 70);
  } else if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { radius: s.Ro + s.ball + age * 5, width: 2.2 - age * 0.2, erosion: Math.min(0.9, 0.2 + age * 0.2), bright: 0.5 - age * 0.06, seed: s.seed + 60 });
    shards(frame, age, 10, s.seed + 40, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * s.Ro, y: Math.sin(a) * s.Ro, vx: (-Math.sin(a) * 0.7 + Math.cos(a) * 0.5) * sp, vy: (Math.cos(a) * 0.7 + Math.sin(a) * 0.5) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

function spinSheet(key, s, extra = 0) {
  return { key, dirs: 1, frames: s.frames, active: s.active, size: Math.ceil(s.Ro + s.ball + 24 + extra) * 2, draw: (frame, f) => spinOrbit(frame, f, s) };
}

// -----------------------------------------------------------------------------
// 叩きつけ（box。当たりの中心が原点、自分は (-reach×2, 0)）
// -----------------------------------------------------------------------------

/** 着地の衝撃: 地面の輪（2 重）・ひび・破片・土煙。age は着地からのフレーム */
function groundImpact(frame, age, o) {
  const { radius, seed } = o;
  const N = o.span;
  const k = age / N;
  if (age === 0) {
    sparkle(frame, 0, 0, 4);
    ring(frame, { radius: radius * 0.35, width: 4, bright: 0.95, seed });
  } else {
    ring(frame, { radius: radius * (0.35 + 0.65 * Math.min(1, age / (N * 0.6))), width: 3.2 - k * 1.4, erosion: Math.min(0.9, k * 0.9), bright: 0.85 - k * 0.35, seed });
    if (age >= 2) ring(frame, { radius: radius * 0.3 + age * 4, width: 2, erosion: Math.min(0.9, 0.2 + k * 0.8), bright: 0.5 - k * 0.2, seed: seed + 1 });
  }
  cracks(frame, o.cracks, radius * 0.9, Math.min(1, (age + 1) / 2), 1 - k * 0.8, seed + 2);
  // 鉄球落とし: 真上から落ちた重さで地面が窪む（暗いくぼみが最後まで残る）
  if (o.crater && age >= 1) {
    const cr = radius * 0.55;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y);
        if (d > cr) return -1;
        if (valueNoise(x, y, 3, seed + 5) - k * 0.8 < 0.1) return -1;
        return d > cr - 2 ? 0.3 * (1 - k * 0.5) : 0.13;
      },
      { bounds: { x0: -cr - 2, y0: -cr - 2, x1: cr + 2, y1: cr + 2 } },
    );
  }
  // 振り落とし: 横から叩いた勢いで、前（+x）へ押し出される土煙の波
  if (o.wave && age >= 1 && k < 0.95) {
    const wr = radius * 0.5 + age * 9;
    for (let i = 0; i < 3; i++) {
      arcLine(frame, { ox: -wr * 0.4, radius: wr + i * 3, from: -0.9 + i * 0.1, to: 0.9 - i * 0.1, width: 2 - i * 0.4, bright: (0.6 - i * 0.12) * (1 - k * 0.7) });
    }
  }
  debris(frame, age, o.debris, o.speed, seed + 3);
}

/**
 * 叩きつけの共通の時間割。path(t) → {x, y, lift}（t = 0..1 の空中の位置と高さ）で落ち方を変える。
 * lift は見かけの高さ（球が大きく見え、地面に影が落ちる）
 */
function slam(frame, f, s) {
  const A = s.active;
  const N = s.frames;
  const hand = { x: -s.reach * 2 + 6, y: 0 };
  if (f < A) {
    const t = easeSwing((f + 1) / A);
    // 残像: 少し前の位置の球
    for (let i = s.ghosts; i >= 1; i--) {
      const tg = t - i * s.ghostDt;
      if (tg < 0) continue;
      const g = s.path(tg);
      const age = i / (s.ghosts + 1);
      ghostBall(frame, g.x, g.y, s.ball * (1 + g.lift * 0.5) * (0.9 - 0.45 * age), 0.7 - 0.5 * age, age * 0.2, s.seed + i);
    }
    const b = s.path(t);
    const scale = 1 + b.lift * 0.5;
    // 影: 落ちる先の地面に暗い円（高いほど小さく薄い）
    paint(
      frame,
      (x, y) => (Math.hypot((x - b.gx) / 1.2, y - b.gy) < s.ball * (0.6 + 0.4 * (1 - b.lift)) ? 0.12 : -1),
      { bounds: { x0: b.gx - s.ball * 2, y0: b.gy - s.ball * 2, x1: b.gx + s.ball * 2, y1: b.gy + s.ball * 2 } },
    );
    const len = Math.hypot(b.x - hand.x, b.y - hand.y);
    const r = s.ball * scale;
    chain(frame, hand.x, hand.y, b.x - ((b.x - hand.x) / len) * (r + 1), b.y - ((b.y - hand.y) / len) * (r + 1), { sag: s.sag ?? 0 });
    spikedBall(frame, b.x, b.y, { r, spikes: s.spikes, rot: t * 3, lx: -0.5, ly: -0.75, seed: s.seed + 20 });
    if (s.fall && f < A - 1) {
      // 落下の筋: 球の周りから中心へ集まる短い線（真上から落ちてくる速さ）
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        const r0 = r + 4 + hash1(i, s.seed + 8) * 6;
        streakLine(frame, { ax: b.x + Math.cos(a) * (r0 + 10), ay: b.y + Math.sin(a) * (r0 + 10), bx: b.x + Math.cos(a) * r0, by: b.y + Math.sin(a) * r0, bright: 0.5 });
      }
    }
    if (s.arcTrail) s.arcTrail(frame, t);
    if (f === A - 1) groundImpact(frame, 0, s.impact);
    return;
  }
  const age = f - A + 1;
  const k = age / (N - A + 1);
  groundImpact(frame, age, s.impact);
  // 地面にめり込んだ球が崩れて消える。鎖は緩んで手元から消える
  if (k < 0.7) {
    chain(frame, hand.x, hand.y, -s.ball - 1, 0, { bright: 0.55 * (1 - k), cut: k * 1.3, sag: 6 + k * 8 });
    spikedBall(frame, 0, 0, { r: s.ball * (1 - k * 0.15), spikes: s.spikes, rot: 3, lx: -0.5, ly: -0.75, erosion: k * 1.3, bright: 1 - k * 0.3, seed: s.seed + 20 });
  }
}

/** 左 4 段（box reach 30 / size 32 heavy）: 頭上を越えて前へ叩きつける。球は途中で高く（大きく）なる */
const L3 = {
  reach: 30,
  ball: 11,
  spikes: 6,
  frames: 9,
  active: 4,
  ghosts: 2,
  ghostDt: 0.3,
  seed: 3101,
  path: (t) => {
    const x = -52 + 52 * t;
    const lift = Math.sin(Math.PI * Math.min(1, t)) * 0.9;
    return { x, y: -lift * 10, lift, gx: x, gy: 0 };
  },
  impact: { radius: 34, span: 5, cracks: 6, debris: 12, speed: 5, seed: 3111 },
};
/** 右: 鉄球落とし（box reach 34 / size 28 heavy）: 真上から落ちる。影が育ち、球が縮みながら落ちて、鎖は緩む */
const BALL_DROP = {
  reach: 34,
  ball: 11,
  spikes: 8,
  frames: 9,
  active: 4,
  ghosts: 0,
  ghostDt: 0,
  seed: 3202,
  sag: 14,
  fall: true,
  path: (t) => {
    const lift = 1.3 * (1 - t);
    return { x: 0, y: -lift * 8, lift, gx: 0, gy: 0 };
  },
  impact: { radius: 30, span: 5, cracks: 9, debris: 16, speed: 5.5, seed: 3212, crater: true },
};
/** 派生: 振り落とし（box reach 32 / size 34 heavy）: 横から大きく回して落とす。弧の残像と、前へ押し出す土煙 */
const SWING_DOWN = {
  reach: 32,
  ball: 12,
  spikes: 6,
  frames: 9,
  active: 4,
  ghosts: 4,
  ghostDt: 0.16,
  seed: 3303,
  path: (t) => {
    // 自分を中心に半径 64 の弧を、横（+y の側の後ろ）から前へ
    const a = (-120 + 120 * t) * DEG;
    const x = -64 + Math.cos(a) * 64;
    const y = -Math.sin(a) * 64;
    const lift = Math.sin(Math.PI * t) * 0.5;
    return { x, y, lift, gx: x, gy: y };
  },
  impact: { radius: 36, span: 5, cracks: 5, debris: 14, speed: 6, seed: 3313, wave: true },
};

function slamSheet(key, s, size) {
  return { key, dirs: DIRS, frames: s.frames, active: s.active, size, draw: (frame, f) => slam(frame, f, s) };
}

// -----------------------------------------------------------------------------
// 鎖を伸ばす（thrust reach 56）: 鎖が前へ伸び、鉄球が先端で弾ける
// -----------------------------------------------------------------------------

const THRUST_REACH = 112;

/** 右: 鎖巻き: 鎖がうねりながら伸び、先端で鉄球が弾けて鎖が渦を巻く */
function chainWrap(frame, f) {
  const A = 3;
  const N = 8;
  const seed = 4101;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const tip = 12 + (THRUST_REACH - 12) * p;
  const ball = 9;
  // 伸びる鎖: 先端ほど波打つ（投げた鎖が空中でうねる）
  if (k < 0.8) {
    const count = Math.floor((tip - ball - 12) / 4.6);
    for (let i = 0; i <= count; i++) {
      const t = i / Math.max(1, count);
      if (t < k * 1.2) continue;
      const x = 10 + (tip - ball - 12) * t;
      const y = Math.sin(t * 9 - f * 1.3) * (2 + 3 * t) * (1 - p * 0.6 + k * 1.5);
      chainLink(frame, x, y, 1, 0, i % 2 === 1, 0.62 * (0.7 + 0.3 * t) * (1 - k * 0.5));
    }
  }
  // 平行の速度線
  if (k < 0.7) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (ball + 3 + Math.floor(i / 2) * 4);
      const x1 = tip - 10 - hash1(i, seed + 1) * 12 - k * 20;
      streakLine(frame, { ax: x1 - 22 - hash1(i, seed + 2) * 16, ay: y, bx: x1, by: y, bright: 0.48 * (1 - k) });
    }
  }
  if (f < A) {
    spikedBall(frame, tip, 0, { r: ball, spikes: 6, rot: f * 0.7, lx: 0.8, ly: -0.5, seed: seed + 3 });
    if (f === A - 1) sparkle(frame, tip + ball + 2, 0, 3);
    return;
  }
  // 弾け: 先端の球がトゲの星になって砕け、鎖の輪が先端を巻く渦になる
  const age = f - A + 1;
  const e = Math.max(0, (age - 1) * 0.2);
  if (age <= 3) starAt(frame, tip, 0, 6, 3 + age * 3, 20 + age * 5, 9 * (1 - e), 1 - e * 0.4, e, seed + 10);
  if (age <= 1) spikedBall(frame, tip, 0, { r: ball, spikes: 6, rot: 2.1, lx: 0.8, ly: -0.5, erosion: 0.35, seed: seed + 3 });
  ring(frame, { ox: tip, radius: 8 + age * 6, width: 2.6 - age * 0.25, erosion: Math.min(0.9, age * 0.18), bright: 0.8 - age * 0.08, seed: seed + 4 });
  // 巻き付く鎖: 先端を中心に輪が螺旋に並ぶ
  const turns = 1.2;
  const links = 14;
  for (let i = 0; i < links; i++) {
    const t = i / links;
    if (t > 1 - k * 0.9) continue;
    const a = t * turns * TAU + age * 0.9;
    const r = 18 - t * 8 + age * 1.5;
    chainLink(frame, tip + Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a), Math.cos(a), i % 2 === 1, 0.6 * (1 - k * 0.5));
  }
  debris(frame, age - 1, 10, 4.5, seed + 6, tip, 0);
}

/** 派生: 引き砕き: 鎖が伸びて先端で打ち付け、そのまま手元へ引きずり戻す。戻る道に残像と擦り跡 */
function dragCrush(frame, f) {
  const A = 3;
  const N = 8;
  const seed = 4202;
  const ball = 10;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const out = f < A ? easeSwing((f + 1) / A) : 1;
  const back = f < A ? 0 : easeSwing(k * 1.05);
  const tip = 12 + (THRUST_REACH - 12) * out;
  const bx = tip - (tip - 34) * back;
  // 引きずりの擦り跡: 先端から今の球の位置まで、地面の平行な筋
  if (f >= A) {
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * 6;
      streakLine(frame, { ax: tip - 4, ay: y, bx: bx + ball, by: y, width: i === 1 ? 1.6 : 1, bright: 0.4 * (1 - k * 0.6) });
    }
    // 引き戻しの残像: 先端側に古い球
    for (let i = 3; i >= 1; i--) {
      const x = bx + i * 16;
      if (x > tip) continue;
      ghostBall(frame, x, 0, ball * (0.9 - i * 0.15), 0.65 - i * 0.15, k * 0.5, seed + i);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (ball + 3 + Math.floor(i / 2) * 4);
      const x1 = tip - 10 - hash1(i, seed + 1) * 12;
      streakLine(frame, { ax: x1 - 24 - hash1(i, seed + 2) * 14, ay: y, bx: x1, by: y, bright: 0.5 });
    }
  }
  // 先端の打ち付け: 輪とトゲの星（原点を先端へ動かして描く）
  if (f >= A - 1) {
    const age = f - (A - 1);
    ring(frame, { ox: tip, radius: 7 + age * 5, width: 2.8 - age * 0.25, erosion: Math.min(0.9, age * 0.17), bright: 0.8 - age * 0.08, seed: seed + 4 });
    if (age <= 2) starAt(frame, tip, 0, 6, 3 + age * 2, 18 + age * 4, 8, 1 - age * 0.2, age * 0.2, seed + 10);
    debris(frame, age, 9, 4, seed + 6, tip, 0);
  }
  if (k < 0.85) {
    chain(frame, 10, 0, bx - ball - 2, 0, { bright: 0.62 * (1 - k * 0.4), sag: f >= A ? 3 : 0 });
    spikedBall(frame, bx, 0, { r: ball, spikes: 6, rot: bx * 0.08, lx: 0.8, ly: -0.5, erosion: Math.max(0, k - 0.45) * 1.8, seed: seed + 3 });
  }
  if (f === A - 1) sparkle(frame, tip + ball + 2, 0, 3);
}

/** トゲの星を (cx, cy) に描く（spikeStar は原点中心なので、光条を平行に動かして描く版） */
function starAt(frame, cx, cy, n, inner, outer, T, bright, erosion, seed) {
  for (let i = 0; i < n; i++) {
    const a = 0.3 + (i / n) * TAU;
    const L = outer * (i % 2 === 0 ? 1 : 0.68);
    lens(frame, { ax: cx + Math.cos(a) * inner, ay: cy + Math.sin(a) * inner, bx: cx + Math.cos(a) * L, by: cy + Math.sin(a) * L, T: T * (i % 2 === 0 ? 1 : 0.75), bias: 0, erosion, bright, seed: seed + i });
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: トゲの打撃の星 + 破片。heavy は大きな衝撃の輪が 2 重に広がり、星も大きい */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const seed = heavy ? 5101 : 5201;
  const k = f / (N - 1);
  const n = heavy ? 8 : 6;
  const outer = (heavy ? 30 : 20) * (f === 0 ? 0.65 : 1 + k * 0.15);
  const e = f < 2 ? 0 : (f - 1) * (heavy ? 0.17 : 0.2);
  // 星は +x（球の進む向き）に長い光条が来るように回す
  if (f <= (heavy ? 4 : 3)) spikeStar(frame, n, 3 + f * 2, outer, 0, (heavy ? 11 : 8) * (1 - k * 0.4), 1 - k * 0.3, e, seed);
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? 4 : 3);
  if (f >= 1) ring(frame, { radius: 6 + f * (heavy ? 4 : 3), width: 2.4 - f * 0.2, erosion: Math.min(0.9, k * 0.9), bright: 0.75 - k * 0.3, seed: seed + 1 });
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 14 + age * 8, width: 3.4 - age * 0.35, erosion: Math.min(0.9, age * 0.17), bright: 0.85 - age * 0.08, seed: seed + 2 });
  }
  if (f >= 1) {
    shards(frame, f - 1, heavy ? 14 : 8, seed + 3, (i, rnd) => {
      // 球の進む向きへ多く、残りは全周へ（重い塊が押し出す）
      const forward = rnd(1) > 0.45;
      const a = forward ? (rnd(2) - 0.5) * 1.3 : rnd(2) * TAU;
      const sp = (heavy ? 4.5 : 3.2) + rnd(4) * (heavy ? 4 : 2.5);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.35 ? 2 : 1, drag: 0.8 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

const FX = {
  moveset: "flail",
  motions: {
    "l:0": { sheet: "flail.l0", pivot: "self", base: 36, measure: "reach" },
    "l:1": { sheet: "flail.l1", pivot: "self", base: 36, measure: "reach" },
    "l:2": { sheet: "flail.spin", pivot: "self", base: 76, measure: "size" },
    "l:3": { sheet: "flail.l3", pivot: "anchor", base: 30, measure: "reach" },
    dash: { sheet: "flail.dash", pivot: "self", base: 64, measure: "size" },
    "r:chainSwing": { sheet: "flail.chainSwing", pivot: "self", base: 38, measure: "reach" },
    "r:ballDrop": { sheet: "flail.ballDrop", pivot: "anchor", base: 34, measure: "reach" },
    "r:chainWrap": { sheet: "flail.chainWrap", pivot: "self", base: 56, measure: "reach" },
    "branch:starCrush": { sheet: "flail.starCrush", pivot: "self", base: 80, measure: "size" },
    "branch:swingDown": { sheet: "flail.swingDown", pivot: "anchor", base: 32, measure: "reach" },
    "branch:chainSweep": { sheet: "flail.chainSweep", pivot: "self", base: 40, measure: "reach" },
    "branch:dragCrush": { sheet: "flail.dragCrush", pivot: "self", base: 56, measure: "reach" },
    charge: { sheet: "flail.charge", pivot: "self", base: 42, measure: "reach" },
  },
  hit: "flail.hit",
  hitHeavy: "flail.hitHeavy",
};

export const ATLAS = {
  key: "flail",
  fx: FX,
  sheets: [
    swingSheet("flail.l0", L0),
    swingSheet("flail.l1", L1),
    spinSheet("flail.spin", SPIN),
    slamSheet("flail.l3", L3, 176),
    spinSheet("flail.dash", DASH_SPIN),
    swingSheet("flail.chainSwing", CHAIN_SWING),
    slamSheet("flail.ballDrop", BALL_DROP, 176),
    { key: "flail.chainWrap", dirs: DIRS, frames: 8, active: 3, size: 304, draw: chainWrap },
    spinSheet("flail.starCrush", STAR, 20),
    slamSheet("flail.swingDown", SWING_DOWN, 272),
    swingSheet("flail.chainSweep", CHAIN_SWEEP),
    { key: "flail.dragCrush", dirs: DIRS, frames: 8, active: 3, size: 304, draw: dragCrush },
    swingSheet("flail.charge", CHARGE),
    { key: "flail.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "flail.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
