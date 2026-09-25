// 刀（moveset "katana"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/katana.json）× 2 が目安
//
// 刀らしさ = 居合の美学。剣と見分けるために次を守る:
// - 斬線は剣の半分以下の太さで、半径の大きい（ほぼ直線の）一閃。白い芯を長く通す
// - 振りは速く（active の枚数を少なく）、振り終わりに「遅れて残る細い切断線」が一瞬白く光ってから、点線にほどけて静かに消える
// - 粒は少なく小さく（上品に）。剣のような刃片の飛び散りはしない
import { arcBounds, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 共通の部品: 遅れて残る切断線
// -----------------------------------------------------------------------------

/**
 * 切断線（直線・わずかに反る）。a → b、太さ width（1.4〜2 で 1〜2 ドット）。
 * 両端ほど暗く尖り、erosion で端から点線にほどける（中央が最後まで残る）
 */
function cutLine(frame, o) {
  const { ax, ay, bx, by } = o;
  const width = o.width ?? 1.6;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const bend = o.bend ?? 0;
  const seed = o.seed ?? 9;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const nx = -ty;
  const ny = tx;
  const pad = width + Math.abs(bend) + 2;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const f = (px * tx + py * ty) / len;
      if (f < 0 || f > 1) return -1;
      const across = px * nx + py * ny - bend * 4 * f * (1 - f);
      const mid = Math.sin(Math.PI * f);
      // 端は細く尖らせる（1 ドットの線でも端が丸く止まらないように）
      if (Math.abs(across) > (width / 2) * (0.55 + 0.45 * Math.pow(mid, 0.4))) return -1;
      if (erosion > 0 && valueNoise(f * len, 0, 5, seed) * 0.75 + mid * 0.4 - erosion * 1.15 < 0) return -1;
      return clamp01(bright * (0.45 + 0.6 * Math.pow(mid, 0.5)));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0 },
  );
}

/** 切断線（弧）。中心 (ox, 0)、半径 radius、角 from → to。反りの大きい弧の斬撃の余韻に使う */
function cutArc(frame, o) {
  const { radius, from, to } = o;
  const ox = o.ox ?? 0;
  const width = o.width ?? 1.6;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const span = Math.max(1e-3, to - from);
  const arcLen = span * radius;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const r = Math.hypot(dx, y);
      const f = wrapAngle(Math.atan2(y, dx) - from) / span;
      if (f < 0 || f > 1) return -1;
      const mid = Math.sin(Math.PI * f);
      if (Math.abs(r - radius) > (width / 2) * (0.55 + 0.45 * Math.pow(mid, 0.4))) return -1;
      if (erosion > 0 && valueNoise(f * arcLen, 0, 5, seed) * 0.75 + mid * 0.4 - erosion * 1.15 < 0) return -1;
      return clamp01(bright * (0.45 + 0.6 * Math.pow(mid, 0.5)));
    },
    { bounds: arcBounds(ox, 0, radius - width - 1, radius + width + 1, from, to), dither: 0 },
  );
}

/**
 * 余韻の時間割。振り終わりの何枚目か（age = f - active。0 から）→ 切断線の明るさと崩れ。
 * 0: 線が淡く現れる（遅れ）/ 1: 一瞬白く光る / 2〜: 点線にほどけて消える
 */
function afterglow(age, rest) {
  if (age < 0) return null;
  if (age === 0) return { bright: 0.62, erosion: 0 };
  if (age === 1) return { bright: 1.1, erosion: 0 };
  const k = (age - 1) / Math.max(1, rest - 1);
  return { bright: 0.85 - 0.45 * k, erosion: 0.25 + 0.7 * k };
}

/** 余韻の粒: 切断線から、ごく少数の小さな光点が線に直交して漂う */
function lineMotes(frame, age, count, seed, at) {
  shards(frame, age, count, seed, (i, rnd) => {
    const p = at(0.15 + 0.7 * rnd(1));
    const side = rnd(2) > 0.5 ? 1 : -1;
    const sp = 0.8 + rnd(3) * 1.2;
    return { x: p.x, y: p.y, vx: p.nx * side * sp + p.tx * 0.6, vy: p.ny * side * sp + p.ty * 0.6, life: 3 + Math.floor(rnd(4) * 2), size: 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 弧の一閃（左 1〜3 段・逆風）
// -----------------------------------------------------------------------------

/**
 * 大きな半径の細い一閃。中心 ox（自分の後ろ）、外縁の半径 R、太さ T（剣の半分以下）。
 * active で先端が振り幅を一気に走り、振り終わりは三日月がすぐ痩せて消え、外縁に切断線だけが遅れて光る
 */
function bladeArc(frame, f, s) {
  const N = s.frames;
  const A = s.active;
  const half = (s.sweep * DEG) / 2;
  const from = -half + (s.tilt ?? 0) * DEG;
  const to = from + half * 2;
  const ox = s.ox ?? 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    const head = from + (to - from) * p;
    // 速い振りなので尾は長く、ほぼ振り幅全体に残る
    const tail = from + (to - from) * Math.max(0, p - 0.85);
    crescent(frame, { ox, R: s.R, T: s.T * (0.75 + 0.25 * p), head, tail, bright: 0.9 + 0.1 * p, seed: s.seed, streak: 0.2, peak: 0.1, edge: 1.4, edgeReach: 0.85 });
    // 速度線は刃の外側に 1 本だけ
    const len = (head - tail) * 0.55;
    if (len > 0.05) cutArc(frame, { ox, radius: s.R + 3, from: head - len - 0.04, to: head - 0.04, width: 1, bright: 0.5 });
    if (f === A - 1) sparkle(frame, ox + Math.cos(head) * (s.R - 1), Math.sin(head) * (s.R - 1), 2);
    return;
  }
  const age = f - A;
  // 三日月は 1 枚で痩せて消える（刀は残像を引きずらない）
  if (age === 0) crescent(frame, { ox, R: s.R, T: s.T * 0.5, head: to, tail: from + (to - from) * 0.35, erosion: 0.45, bright: 0.75, seed: s.seed, streak: 0.2, peak: 0.1, edge: 1.2, edgeReach: 0.6 });
  const g = afterglow(age, N - A - 1);
  if (!g) return;
  const ext = 4 * DEG * (100 / s.R);
  cutArc(frame, { ox, radius: s.R - 0.8, from: from - ext, to: to + ext, width: age === 1 ? 2 : 1.5, bright: g.bright, erosion: g.erosion, seed: s.seed + 5 });
  if (age === 1) {
    // 光る瞬間、線の中ほどに小さな閃き（居合の「キン」）
    const a = from + (to - from) * (s.glintAt ?? 0.62);
    sparkle(frame, ox + Math.cos(a) * s.R, Math.sin(a) * s.R, s.glint ?? 2);
  }
  lineMotes(frame, age - 1, s.motes ?? 3, s.seed + 7, (t) => {
    const a = from + (to - from) * t;
    return { x: ox + Math.cos(a) * s.R, y: Math.sin(a) * s.R, nx: Math.cos(a), ny: Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a) };
  });
}

/** 左 1 段（box reach 16 / size 24）: 後ろに中心を置いた半径の大きい弧 = ほぼ直線の縦の一閃 */
const L1 = { ox: -72, R: 106, T: 8, sweep: 40, tilt: 0, frames: 8, active: 3, seed: 1101, glintAt: 0.55 };
/** 左 2 段（box reach 17 / size 26）: 返しの一閃（描画側が上下反転）。少し斜めに傾け、長く */
const L2 = { ox: -64, R: 100, T: 8, sweep: 46, tilt: 10, frames: 8, active: 3, seed: 1202, glintAt: 0.7 };
/** 左 3 段（box reach 18 / size 28・踏み込み 10）: 一段反りの強い弧。少し太く、閃きを大きく */
const L3 = { ox: -34, R: 72, T: 10, sweep: 76, tilt: -4, frames: 8, active: 3, seed: 1303, glint: 3, motes: 4 };
/** 右: 逆風（arc 180° reach 24）。自分を中心に半周を払う細い弧 */
const SAKAKAZE = { ox: 0, R: 52, T: 9, sweep: 180, tilt: 0, frames: 9, active: 4, seed: 1404, glint: 3, glintAt: 0.5, motes: 4 };

function arcKatanaSheet(key, s) {
  return { key, dirs: DIRS, frames: s.frames, active: s.active, size: Math.ceil(s.R + Math.abs(s.ox) + 16) * 2, draw: (frame, f) => bladeArc(frame, f, s) };
}

// -----------------------------------------------------------------------------
// 突きの光条（左 4 段・ダッシュ・返し・抜き打ち・溜め）
// -----------------------------------------------------------------------------

/**
 * 極細の直線の光条。from → to（x 軸上）。active で穂先が走り、振り終わりは光条が痩せて消え、
 * 同じ位置に 1 ドットの切断線が遅れて光る。
 * s.retract: 返し（振り終わりに光条が根元へ引き戻る）/ s.draw: 抜き打ち（1 枚目に鯉口の閃き）/ s.speed: 後ろへ流れる速度線の本数
 */
function beam(frame, f, s) {
  const N = s.frames;
  const A = s.active;
  const delay = s.delay ?? 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    const head = s.from + (s.to - s.from) * p;
    const back = s.from + (head - s.from) * 0.05;
    lens(frame, { ax: back, ay: 0, bx: head, by: 0, T: s.T, bias: 0, seed: s.seed, bright: 1 });
    streakLine(frame, { ax: back + (head - back) * 0.15, ay: 0, bx: head - 1, by: 0, width: 1.1, bright: 1 });
    speedLines(frame, s, head, 0);
    if (s.draw && f === 0) sparkle(frame, s.from + 4, 0, 3);
    if (f === A - 1) sparkle(frame, s.to - 1, 0, 2);
    return;
  }
  const age = f - A;
  if (age === 0) {
    if (s.retract) {
      // 返し: 光条が根元へ引き戻る（穂先側から消える）
      lens(frame, { ax: s.from, ay: 0, bx: s.from + (s.to - s.from) * 0.55, by: 0, T: s.T * 0.6, bias: 0, erosion: 0.3, seed: s.seed, bright: 0.85 });
    } else {
      lens(frame, { ax: s.from + (s.to - s.from) * 0.3, ay: 0, bx: s.to, by: 0, T: s.T * 0.55, bias: 0, erosion: 0.4, seed: s.seed, bright: 0.8 });
    }
    speedLines(frame, s, s.to, 0.5);
  }
  const g = afterglow(age - delay, N - A - 1 - delay);
  if (!g) return;
  const ga = age - delay;
  cutLine(frame, { ax: s.from - 2, ay: 0, bx: s.to + (s.overrun ?? 6), by: 0, width: ga === 1 ? 2 : 1.5, bright: g.bright, erosion: g.erosion, seed: s.seed + 5 });
  if (ga === 1) {
    for (const t of s.glints ?? [0.9]) sparkle(frame, s.from + (s.to - s.from) * t, 0, s.glint ?? 2);
    // 重い突き: 穂先に直交する短い閃き（突き抜けた一点）
    if (s.cross) streakLine(frame, { ax: s.to - 2, ay: -s.cross, bx: s.to - 2, by: s.cross, width: 1, bright: 0.8 });
  }
  lineMotes(frame, ga - 1, s.motes ?? 3, s.seed + 7, (t) => ({ x: s.from + (s.to - s.from) * t, y: 0, nx: 0, ny: 1, tx: 1, ty: 0 }));
}

/** 突きの速度線: 光条の両脇に短く細い線（本数は少なく） */
function speedLines(frame, s, head, k) {
  const n = s.speed ?? 2;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (s.T / 2 + 2.5 + Math.floor(i / 2) * 3.5);
    const len = (s.speedLen ?? 22) * (0.7 + 0.5 * hash1(i, s.seed + 20)) * (1 - k * 0.5);
    const x1 = head - 10 - hash1(i, s.seed + 21) * 12 - k * 10;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k * 0.6) });
  }
}

/** 左 4 段（thrust reach 34・重い）: 細く長い突き。穂先に直交する閃きと大きめの光点 */
const L4 = { from: 6, to: 70, T: 5, frames: 8, active: 3, seed: 1505, glint: 3, glints: [1], cross: 7, speed: 2 };
/** ダッシュ攻撃（thrust reach 36）: 背後から前へ抜ける極細の光条。後ろへ流れる速度線を多めに */
const DASH = { from: -34, to: 74, T: 4.5, frames: 8, active: 3, seed: 1606, speed: 4, speedLen: 30, glints: [0.75] };
/** 右: 返し（thrust reach 30）: 短い突き。振り終わりに光条が根元へ引き戻る */
const KAESHI = { from: 4, to: 62, T: 4.5, frames: 7, active: 3, seed: 1707, retract: true, glints: [0.95], motes: 2, overrun: 3 };
/** 派生: 抜き打ち（thrust reach 28・踏み込み 20）: 1 枚目に鯉口の閃き、踏み込みの分だけ背後から長く */
const QUICK = { from: -40, to: 58, T: 4, frames: 8, active: 3, seed: 1808, draw: true, speed: 2, speedLen: 28, glints: [0.6] };
/** 溜め（居合。thrust reach 60・重い）: 画面を貫く長い一閃。光ってから一拍おいて切断線が光る */
const CHARGE = { from: -24, to: 124, T: 6, frames: 10, active: 4, seed: 1909, delay: 1, glint: 3, glints: [0.3, 0.65, 0.97], cross: 9, speed: 2, speedLen: 40, motes: 6, overrun: 10 };

function beamSheet(key, s) {
  const extent = Math.max(Math.abs(s.from), Math.abs(s.to) + (s.overrun ?? 6)) + 14;
  return { key, dirs: DIRS, frames: s.frames, active: s.active, size: Math.ceil(extent) * 2, draw: (frame, f) => beam(frame, f, s) };
}

// -----------------------------------------------------------------------------
// 当たりの中心に置く斬線（一文字・燕返し・霞・峰打ち）
// -----------------------------------------------------------------------------

/**
 * 1 本の斬線の一振り: grow の間はレンズ形の細い線が a → b へ伸び、その後は同じ位置に切断線が遅れて光る。
 * age は一振りの中の枚数（0 から）、A は伸びる枚数、rest は余韻の枚数
 */
function stroke(frame, age, o) {
  if (age < 0) return;
  const { ax, ay, bx, by, T, A, rest, seed } = o;
  const bend = o.bend ?? 0;
  const bright = o.bright ?? 1;
  if (age < A) {
    const p = easeSwing((age + 1) / A);
    lens(frame, { ax, ay, bx, by, T, bend, grow: p, bias: 0.3, seed, bright });
    if (age === A - 1) sparkle(frame, bx, by, o.tipGlint ?? 2);
    return;
  }
  const a2 = age - A;
  if (a2 === 0) lens(frame, { ax, ay, bx, by, T: T * 0.5, bend, bias: 0.3, erosion: 0.45, seed, bright: bright * 0.8 });
  const g = afterglow(a2, rest);
  if (!g) return;
  // 切断線は斬線より少し長く（両端へ抜ける）
  const len = Math.hypot(bx - ax, by - ay);
  const ex = ((bx - ax) / len) * (o.overrun ?? 5);
  const ey = ((by - ay) / len) * (o.overrun ?? 5);
  // lens の芯（bias で縁に寄る）に合わせて、切断線を法線方向へ少しずらす
  const shift = -T * 0.15;
  const nx = (-(by - ay) / len) * shift;
  const ny = ((bx - ax) / len) * shift;
  cutLine(frame, { ax: ax - ex + nx, ay: ay - ey + ny, bx: bx + ex + nx, by: by + ey + ny, bend, width: a2 === 1 ? 2 : 1.5, bright: g.bright * bright, erosion: g.erosion, seed: seed + 5 });
  if (a2 === 1 && o.glint) sparkle(frame, (ax + bx) / 2 + nx - bend, (ay + by) / 2 + ny, o.glint);
  lineMotes(frame, a2 - 1, o.motes ?? 2, seed + 7, (t) => {
    const tx = (bx - ax) / len;
    const ty = (by - ay) / len;
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx: -ty, ny: tx, tx, ty };
  });
}

/** 右: 一文字（box reach 20 / size 40・重い）。攻撃の向きに直交して横切る長い一線（当たりの幅より長く抜ける）。中央が前へわずかに反る */
function ichimonji(frame, f) {
  stroke(frame, f, { ax: 0, ay: -72, bx: 0, by: 72, T: 5.5, bend: -6, A: 3, rest: 5, seed: 2101, glint: 3, tipGlint: 2, motes: 4, overrun: 8 });
}

/** 派生: 燕返し（box reach 18 / size 30・2 段）。1 太刀目で斬り下ろし、先端で鋭く折り返す 2 太刀目。角度を 100° 変えた「く」の字 */
function tsubame(frame, f) {
  const apex = { x: 20, y: 2 };
  const s1 = { ax: -26, ay: -36, bx: apex.x, by: apex.y, T: 6, bend: -4, A: 2, rest: 5, seed: 2201, glint: 0, motes: 2 };
  const s2 = { ax: apex.x, ay: apex.y, bx: -24, by: 38, T: 6, bend: -4, A: 2, rest: 5, seed: 2202, glint: 0, motes: 2 };
  stroke(frame, f, s1);
  stroke(frame, f - 3, s2);
  // 折り返しの頂点: 1 太刀目の終わりと 2 太刀目の始まりで光る
  if (f === 2) sparkle(frame, apex.x, apex.y, 3);
  if (f === 6) sparkle(frame, apex.x, apex.y, 2);
}

/** 霞の靄: 斬線の周りに薄く広がる暗い段（1〜3）の帯。ノイズで千切れ、spread で広がる */
function haze(frame, o) {
  const { ax, ay, bx, by, spread, fade, seed } = o;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const pad = spread + 3;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const f = (px * tx + py * ty) / len;
      if (f < -0.05 || f > 1.05) return -1;
      const d = Math.abs(-px * ty + py * tx);
      const w = spread * (0.35 + 0.65 * Math.sin(Math.PI * clamp01(f)));
      if (d > w) return -1;
      // 靄は塊にせず、ノイズの濃い所だけを暗い段（1〜2）で薄く残す
      const n = valueNoise(x + o.drift, y, 2.2, seed) * 0.7 + valueNoise(x, y, 7, seed + 3) * 0.3;
      if (n < 0.58 + 0.25 * (d / w) + 0.2 * fade) return -1;
      return 0.16 + 0.1 * (1 - d / w) * (1 - fade);
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad } },
  );
}

/** 派生: 霞（box reach 18 / size 28・2 段）。淡い 2 本の斬線が角度を違えて走り、周りに靄が薄く広がって溶ける */
function kasumi(frame, f) {
  const N = 9;
  const a = { ax: -14, ay: -34, bx: 12, by: 32, T: 5, bend: -4, A: 2, rest: 4, seed: 2301, bright: 0.72, motes: 0, overrun: 3 };
  const b = { ax: 16, ay: -30, bx: -10, by: 34, T: 5, bend: -4, A: 2, rest: 4, seed: 2302, bright: 0.72, motes: 0, overrun: 3 };
  for (const [s, start] of [
    [a, 0],
    [b, 2],
  ]) {
    const age = f - start;
    if (age < 2) continue;
    const k = (age - 2) / (N - start - 2);
    haze(frame, { ...s, spread: 5 + age * 3, fade: Math.pow(k, 1.2), drift: age * 2, seed: s.seed + 30 });
  }
  stroke(frame, f, a);
  stroke(frame, f - 2, b);
}

/** 派生: 峰打ち（box reach 18 / size 28・重い）。刃でなく峰の打撃: 白い芯のない鈍く太い帯と、潰れた衝撃の輪・鈍い放射 */
function mineUchi(frame, f) {
  const N = 8;
  const A = 2;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    // 白（段 7）を出さない: 明るさを抑えた太い帯
    lens(frame, { ax: -6, ay: -30, bx: 4, by: 24, T: 14, bend: -4, grow: p, bias: 0, seed: 2401, bright: 0.62 });
    return;
  }
  const age = f - A;
  const k = age / (N - A - 1);
  if (age <= 1) lens(frame, { ax: -6, ay: -30, bx: 4, by: 24, T: 14 * (1 - age * 0.4), bend: -4, bias: 0, erosion: 0.35 + age * 0.3, seed: 2401, bright: 0.55 });
  // 打点: 前へ潰れた衝撃の輪（鈍い音の広がり）。刃の命中と違い、線ではなく面で押す
  const cx = 6;
  ring(frame, { ox: cx, radius: 6 + age * 5, width: 3.2 - age * 0.3, squash: 0.6, erosion: Math.min(0.9, k * 0.95), bright: 0.62 - k * 0.2, seed: 2402 });
  if (age === 0) {
    // 鈍い閃き: 白ではなく段 5 の太い十字
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      streakLine(frame, { ax: cx + dx * 9, ay: dy * 9, bx: cx + dx * 2, by: dy * 2, width: 2.6, bright: 0.62 });
    }
  }
  // 鈍い放射: 太く短い線が前方へ
  if (age <= 2) {
    for (let i = 0; i < 5; i++) {
      const ang = (i - 2) * 0.45 + (hash1(i, 2404) - 0.5) * 0.2;
      const r0 = 10 + age * 6;
      const r1 = r0 + 7 - age * 2;
      streakLine(frame, { ax: cx + Math.cos(ang) * r0, ay: Math.sin(ang) * r0, bx: cx + Math.cos(ang) * r1, by: Math.sin(ang) * r1, width: 2.2, bright: 0.5 * (1 - age * 0.25) });
    }
  }
  // 粉塵: 暗い粒が前へ（火花ではなく）
  shards(frame, age, 7, 2405, (i, rnd) => {
    const ang = (rnd(1) - 0.5) * 2.2;
    const sp = 2 + rnd(2) * 2;
    return { x: cx, y: (rnd(3) - 0.5) * 8, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1, bright: 0.2 };
  });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中: 刃の進む向き（+x）に極細で長い切断線が一瞬遅れて走る。
 * heavy は切断線が 2 段に光る（一度光って沈み、長く伸びて再び白く光る）
 */
function hit(frame, f, heavy) {
  const L = heavy ? 40 : 30;
  const seed = heavy ? 2601 : 2501;
  // 0 枚目: 刃が触れた点の小さな閃きだけ（線はまだ無い = 遅れ）
  if (f === 0) {
    sparkle(frame, 0, 0, heavy ? 3 : 2);
    return;
  }
  const flashes = heavy ? [1, 3] : [1];
  const N = heavy ? 8 : 6;
  const last = flashes[flashes.length - 1] ?? 1;
  let bright;
  let erosion = 0;
  let width = 1.5;
  let len = L;
  if (flashes.includes(f)) {
    bright = 1.1;
    width = 2;
    if (heavy && f === 3) len = L * 1.25;
  } else if (f < last) {
    bright = 0.6;
  } else {
    const k = (f - last) / (N - 1 - last);
    bright = 0.85 - 0.4 * k;
    erosion = 0.25 + 0.7 * k;
    if (heavy) len = L * 1.25;
  }
  // 走り出し（1 枚目）は後ろ寄りから前へ突き抜ける
  const back = f === 1 ? -L * 0.6 : -len;
  cutLine(frame, { ax: back, ay: 0, bx: len, by: 0, width, bright, erosion, seed });
  if (f === 1) {
    // 切断線を囲う細いレンズ（1 枚目だけ。刃が通った厚み）
    lens(frame, { ax: -L * 0.5, ay: 0, bx: L, by: 0, T: heavy ? 6 : 4.5, bias: 0, seed: seed + 1, bright: 0.9 });
  }
  if (flashes.includes(f)) sparkle(frame, heavy && f === 3 ? len * 0.35 : 0, 0, heavy ? 3 : 2);
  if (heavy && f === 3) streakLine(frame, { ax: len * 0.35, ay: -8, bx: len * 0.35, by: 8, width: 1, bright: 0.75 });
  lineMotes(frame, f - 1, heavy ? 4 : 2, seed + 7, (t) => ({ x: -len + 2 * len * t, y: 0, nx: 0, ny: 1, tx: 1, ty: 0 }));
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "katana",
  motions: {
    "l:0": { sheet: "katana.l1", pivot: "self", base: 16, measure: "reach" },
    "l:1": { sheet: "katana.l2", pivot: "self", base: 17, measure: "reach" },
    "l:2": { sheet: "katana.l3", pivot: "self", base: 18, measure: "reach" },
    "l:3": { sheet: "katana.l4", pivot: "self", base: 34, measure: "reach" },
    dash: { sheet: "katana.dash", pivot: "self", base: 36, measure: "reach" },
    "r:kaeshi": { sheet: "katana.kaeshi", pivot: "self", base: 30, measure: "reach" },
    "r:sakakaze": { sheet: "katana.sakakaze", pivot: "self", base: 24, measure: "reach" },
    "r:ichimonji": { sheet: "katana.ichimonji", pivot: "anchor", base: 20, measure: "reach" },
    "branch:tsubame": { sheet: "katana.tsubame", pivot: "anchor", base: 18, measure: "reach" },
    "branch:quickDraw": { sheet: "katana.quickDraw", pivot: "self", base: 28, measure: "reach" },
    "branch:kasumi": { sheet: "katana.kasumi", pivot: "anchor", base: 18, measure: "reach" },
    "branch:mineUchi": { sheet: "katana.mineUchi", pivot: "anchor", base: 18, measure: "reach" },
    charge: { sheet: "katana.charge", pivot: "self", base: 60, measure: "reach" },
  },
  hit: "katana.hit",
  hitHeavy: "katana.hitHeavy",
};

export const ATLAS = {
  key: "katana",
  fx: FX,
  sheets: [
    arcKatanaSheet("katana.l1", L1),
    arcKatanaSheet("katana.l2", L2),
    arcKatanaSheet("katana.l3", L3),
    arcKatanaSheet("katana.sakakaze", SAKAKAZE),
    beamSheet("katana.l4", L4),
    beamSheet("katana.dash", DASH),
    beamSheet("katana.kaeshi", KAESHI),
    beamSheet("katana.quickDraw", QUICK),
    beamSheet("katana.charge", CHARGE),
    { key: "katana.ichimonji", dirs: DIRS, frames: 9, active: 3, size: 160, draw: ichimonji },
    { key: "katana.tsubame", dirs: DIRS, frames: 10, active: 5, size: 112, draw: tsubame },
    { key: "katana.kasumi", dirs: DIRS, frames: 9, active: 4, size: 112, draw: kasumi },
    { key: "katana.mineUchi", dirs: DIRS, frames: 8, active: 2, size: 96, draw: mineUchi },
    { key: "katana.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "katana.hitHeavy", dirs: DIRS, frames: 8, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
