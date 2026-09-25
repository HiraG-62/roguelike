// 斧（moveset "axe"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/axe.json）× 2 が目安
//
// 斧らしさの軸: 重さが先端（斧頭の通り道）に集中する。剣の三日月は中ほどが太く両端が細いが、
// 斧の弧は「先端がどっしり太く丸く、手元側へ急に細る」楔形にする。振り切りで木片（2〜3 ドットの棒）が弾け、
// 叩き割る技と命中には地面・的の割れ目（ジグザグの亀裂・V 字の切り込み）を残す
import { arcBounds, arcLine, easeSwing, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 斧専用の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズ + 芯の近さ）。芯に近いほど最後まで残る */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 楔形の太さの輪郭。u = 0 が先端（斧頭）、1 が手元側の尾。
 * 先端は丸く切り詰めた太い頭（cap の幅で立ち上がる）、そこから急に細る（power が大きいほど急）
 */
function wedgeWidth(u, cap, power, plateau = 0) {
  if (u < 0 || u > 1) return 0;
  if (u < cap) return Math.sqrt(Math.max(0, 1 - ((cap - u) / cap) ** 2));
  // 斧頭の厚み: cap から plateau まではほぼ太いまま（わずかに痩せる）、その先で急に細る
  const hold = cap + plateau;
  if (u < hold) return 1 - 0.12 * ((u - cap) / Math.max(1e-3, plateau));
  return 0.88 * Math.pow(1 - (u - hold) / (1 - hold), power);
}

/**
 * 楔形の弧（斧頭の通り道）。中心 (ox, 0)、外縁の半径 R、先端の太さ T。head > tail（時計回り）。
 * span は 2π 未満まで（回転技で 1 周近くを引くため wrapAngle を使わず自前で角を測る）。
 * 外縁の先端寄りだけが白い刃の縁、斧頭の塊が一番明るく、尾は暗い帯に溶ける
 */
function wedgeArc(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const cap = o.cap ?? 0.07;
  const power = o.power ?? 2.2;
  const edgeReach = o.edgeReach ?? 0.3;
  const plateau = o.plateau ?? 0.12;
  const bounds = span > Math.PI * 0.9 ? { x0: ox - R - 2, y0: -R - 2, x1: ox + R + 2, y1: R + 2 } : arcBounds(ox, 0, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05);
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const r = Math.hypot(dx, y);
      if (r > R) return -1;
      let s = (head - Math.atan2(y, dx)) % TAU;
      if (s < 0) s += TAU;
      const u = s / span;
      if (u > 1) return -1;
      const w = T * wedgeWidth(u, cap, power, plateau);
      if (w < 0.7) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      // 刃の縁: 外縁 1.6 ドット、斧頭の側だけ白く
      if (R - r < 1.6 && u < edgeReach && erosion < 0.5) return clamp01(bright * (1.06 - 0.5 * u));
      // 斧頭の塊は内側まで明るく（重さ）、尾ほど急に暗い。内縁は 2 段（暗部の縁）
      const heavy = Math.pow(1 - u, 1.6);
      const inner = q > 0.85 ? 0.55 : 1;
      const grain = 0.9 + 0.2 * hash1(Math.floor((R - r) / 2), seed);
      return clamp01((0.28 + 0.66 * heavy) * (1 - q * 0.45) * inner * grain * bright * (1 - erosion * 0.4));
    },
    { bounds },
  );
}

/**
 * 直線の楔（縦の叩き割り）。a（手元・細い）→ b（斧頭・太い）。grow（0..1）で a から b へ伸び、今の先端が常に太い頭
 */
function wedgeLine(frame, o) {
  const { ax, ay, bx, by, T } = o;
  const grow = o.grow ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 3;
  const bright = o.bright ?? 1;
  const cap = o.cap ?? 0.12;
  const power = o.power ?? 1.8;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const pad = T + 2;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const f = (px * tx + py * ty) / len;
      if (f < 0 || f > grow) return -1;
      const u = 1 - f / grow;
      const w = T * 0.5 * wedgeWidth(u, cap, power);
      if (w < 0.5) return -1;
      const across = Math.abs(px * -ty + py * tx);
      if (across > w) return -1;
      const q = across / w;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      // 芯の白は斧頭の側だけ
      if (q < 0.18 && u < 0.35 && erosion < 0.5) return clamp01(bright * 1.02);
      const heavy = Math.pow(1 - u, 1.3);
      return clamp01((0.25 + 0.65 * heavy) * (1 - q * 0.5) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad } },
  );
}

/**
 * 木片: 2〜3 ドットの細長い棒が回りながら飛ぶ。spawn(i, rnd) → {x, y, vx, vy, life, len, spin}
 * 剣の刃片（点 + 尾）と見分けるため、進む向きとは別の向きに寝た棒にする
 */
function chips(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const drag = s.drag ?? 0.82;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const x = s.x + s.vx * travel;
    const y = s.y + s.vy * travel;
    const fade = 1 - age / (s.life + 1);
    const top = Math.max(2, Math.round(3 + 3.6 * fade));
    const a = (s.angle ?? 0) + (s.spin ?? 0.9) * age;
    const len = age >= s.life - 1 ? Math.max(1, (s.len ?? 3) - 1) : (s.len ?? 3);
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    for (let j = 0; j < len; j++) {
      const t = j - (len - 1) / 2;
      dot(frame, x + cx * t, y + cy * t, Math.max(2, top - (j === 0 ? 0 : 1)));
    }
  }
}

/**
 * 地面の割れ目: (x, y) から角 angle へ伸びるジグザグの亀裂。根元が太く先へ細る。
 * grow（0..1）で伸び、erosion で崩れる。明るさは本体の段（3〜5）で、根元だけ芯を明るく
 */
function crack(frame, o) {
  const { x, y, angle, len } = o;
  const w0 = o.width ?? 3;
  const grow = o.grow ?? 1;
  const seed = o.seed ?? 9;
  const bright = o.bright ?? 0.7;
  const erosion = o.erosion ?? 0;
  const n = o.segments ?? 5;
  const jag = o.jag ?? 0.35;
  const pts = [{ x, y }];
  let a = angle;
  for (let i = 1; i <= n; i++) {
    a = angle + (hash1(i, seed) - 0.5) * 2 * jag * (i % 2 === 0 ? -1 : 1) + (hash1(i, seed + 1) - 0.5) * jag;
    const step = (len / n) * (0.8 + 0.4 * hash1(i, seed + 2));
    const p = pts[i - 1];
    pts.push({ x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step });
  }
  const total = n * grow;
  const minX = Math.min(...pts.map((p) => p.x)) - w0 - 2;
  const maxX = Math.max(...pts.map((p) => p.x)) + w0 + 2;
  const minY = Math.min(...pts.map((p) => p.y)) - w0 - 2;
  const maxY = Math.max(...pts.map((p) => p.y)) + w0 + 2;
  paint(
    frame,
    (px, py) => {
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (i >= total) break;
        const p = pts[i];
        const q = pts[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const l2 = dx * dx + dy * dy;
        let t = ((px - p.x) * dx + (py - p.y) * dy) / l2;
        t = Math.max(0, Math.min(Math.min(1, total - i), t));
        const gt = (i + t) / n;
        const w = (w0 * Math.pow(1 - gt, 0.8) + 0.6) / 2;
        const d = Math.hypot(p.x + dx * t - px, p.y + dy * t - py);
        if (d > w) continue;
        if (!survives(px, py, erosion, 1 - gt, seed + 3)) continue;
        const v = bright * (1 - 0.45 * gt) * (d < w * 0.4 && gt < 0.3 ? 1.25 : 1 - 0.3 * (d / w));
        if (v > best) best = v;
      }
      return best < 0 ? -1 : clamp01(best * (1 - erosion * 0.35));
    },
    { bounds: { x0: minX, y0: minY, x1: maxX, y1: maxY }, samples: 2, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 扇の振り（左 1〜4 段・ダッシュ・首斬り・二丁投げ）の時間割
// -----------------------------------------------------------------------------

/**
 * 斧の振り 1 フレーム。active で斧頭が振り幅を走り（振り始めから頭は太い）、振り切りで木片が弾け、
 * 残りのフレームで尾が斧頭へ追いつきながら崩れる。弧は短め（剣より振り幅を狭く、尾の割合を短く）
 */
function axeSwing(frame, f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  const N = spec.frames;
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  let k = 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - spec.tailLen);
    bright = 0.85 + 0.15 * p;
  } else {
    k = (f - A + 1) / (N - A + 1);
    head = from + sweep * (1 + spec.overshoot * k);
    tail = from + sweep * Math.min(0.96, 1 - spec.tailLen + (spec.tailLen - 0.04) * Math.pow(k, 0.75));
    erosion = 0.05 + 0.85 * Math.pow(k, 1.2);
    bright = 1 - 0.3 * k;
  }
  // 振り始めから斧頭は太い（剣のように細く立ち上がらない）。崩れで痩せる
  const T = spec.T * (f < A ? 0.82 + 0.18 * ((f + 1) / A) : 1 - 0.45 * k);
  wedgeArc(frame, { R: spec.R, T, head, tail, erosion, bright, seed: spec.seed, cap: spec.cap, power: spec.power, plateau: spec.plateau });
  // 速度線: 刃の外側に沿わせるだけ（内側には引かない）
  if (k < 0.8) {
    const span = head - tail;
    for (let i = 0; i < spec.lines; i++) {
      const len = span * (0.3 + 0.35 * hash1(i, spec.seed + 41)) * (1 - k);
      const end = head - span * (0.05 + 0.1 * hash1(i, spec.seed + 40)) + k * span * 0.2;
      arcLine(frame, { radius: spec.R + 2 + i * 1.6 + k * 5, from: end - len, to: end, bright: (0.6 - i * 0.06) * (1 - k * 0.6) });
    }
  }
  const tipR = spec.R - spec.T * 0.4;
  if (f === A - 1) sparkle(frame, Math.cos(head) * (spec.R - 1), Math.sin(head) * (spec.R - 1), spec.glint);
  // 振り切りの衝撃（重い段だけ）: 斧頭が止まった所から外へ短い亀裂が走る（叩きつけた重さ）
  if (spec.impact && f >= A - 1) {
    const age = f - (A - 1);
    const end = from + sweep;
    const grow = Math.min(1, (age + 1) / 2);
    const er = age <= 1 ? 0 : Math.min(0.95, (age - 1) * 0.25);
    for (let i = 0; i < 3; i++) {
      const a = end + (i - 1) * 0.6 + 0.35;
      crack(frame, { x: Math.cos(end) * (spec.R - 3), y: Math.sin(end) * (spec.R - 3), angle: a, len: 14 + 6 * hash1(i, spec.seed + 72), width: 2.8 - (i === 1 ? 0 : 0.6), grow, erosion: er, bright: 0.72, seed: spec.seed + 73 + i, segments: 3, jag: 0.45 });
    }
  }
  if (f >= A - 1) {
    const end = from + sweep;
    chips(frame, f - (A - 1), spec.chips, spec.seed + 60, (i, rnd) => {
      const a = end - sweep * 0.3 * rnd(1);
      const r = spec.R - spec.T * (0.15 + 0.6 * rnd(2));
      const sp = spec.chipSpeed * (0.6 + 0.8 * rnd(3));
      // 接線（進む向き）に強く、外へ少し。木片は重いので刃片より遅く、早く止まる
      const out = 0.2 + 0.55 * rnd(4);
      const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp;
      const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 3), len: rnd(6) > 0.45 ? 3 : 2, angle: rnd(7) * Math.PI, spin: (rnd(8) - 0.5) * 1.6 };
    });
  }
}

/** 作業面の大きさ */
function swingSize(spec) {
  return Math.ceil(spec.R + 22) * 2;
}

function swingSheet(key, spec, extra) {
  return {
    key,
    dirs: DIRS,
    frames: spec.frames,
    active: spec.active,
    size: swingSize(spec),
    draw: (frame, f) => {
      axeSwing(frame, f, spec);
      extra?.(frame, f);
    },
  };
}

/** 左 1 段（arc 120° reach 24）: 短い楔の弧。斧頭がどっしり、尾は短い */
const L1 = { R: 50, T: 26, sweep: 105, tilt: 0, frames: 8, active: 4, tailLen: 0.8, overshoot: 0.05, lines: 1, chips: 5, chipSpeed: 3.2, glint: 3, seed: 1101, cap: 0.12, plateau: 0.1, power: 1.8 };
/** 左 2 段: 返しの振り（逆回り）。わずかに持ち上がった軌道 */
const L2 = { R: 51, T: 27, sweep: 110, tilt: -8, frames: 8, active: 4, tailLen: 0.82, overshoot: 0.06, lines: 1, chips: 6, chipSpeed: 3.4, glint: 3, seed: 1202, cap: 0.12, plateau: 0.1, power: 1.9 };
/** 左 3 段（reach 26）: 踏み込んで一段太い頭 */
const L3 = { R: 54, T: 32, sweep: 112, tilt: 4, frames: 8, active: 4, tailLen: 0.8, overshoot: 0.06, lines: 2, chips: 8, chipSpeed: 3.8, glint: 3, seed: 1303, cap: 0.12, plateau: 0.12, power: 2 };
/** 左 4 段（終撃・arc 140° reach 28・出血）: 最も重い頭 + 振り切りの衝撃の輪 + 多めの木片 */
const L4 = { R: 58, T: 42, sweep: 128, tilt: 0, frames: 9, active: 4, tailLen: 0.8, overshoot: 0.05, lines: 2, chips: 14, chipSpeed: 4.6, glint: 4, seed: 1404, cap: 0.12, plateau: 0.14, power: 2.2, impact: true };
/** ダッシュ攻撃（arc 160° reach 26）: 突進の勢いで広く払う。頭は中くらい、尾が長め */
const DASH = { R: 54, T: 28, sweep: 150, tilt: 6, frames: 8, active: 4, tailLen: 0.85, overshoot: 0.08, lines: 2, chips: 8, chipSpeed: 4.2, glint: 3, seed: 1505, cap: 0.1, plateau: 0.08, power: 2.4 };
/** 派生: 首斬り（arc 120° reach 26・重い・出血）: 狭く速い振りに鋭い白い刃の縁。頭は細めで長い縁 */
const NECK = { R: 56, T: 26, sweep: 95, tilt: -6, frames: 8, active: 3, tailLen: 0.7, overshoot: 0.1, lines: 1, chips: 9, chipSpeed: 4.4, glint: 4, seed: 1606, cap: 0.08, plateau: 0.16, power: 1.5, impact: true };
/** 派生: 二丁投げ（arc 120° reach 26）: 投げの弧。頭は小ぶりで尾が長く、回る斧頭の光が弧の外を走る */
const TWIN = { R: 54, T: 20, sweep: 120, tilt: 0, frames: 8, active: 4, tailLen: 0.85, overshoot: 0.1, lines: 2, chips: 4, chipSpeed: 3, glint: 3, seed: 1707, cap: 0.1, plateau: 0.06, power: 2.2 };

/** ダッシュ攻撃: 後ろへ流れる速度線の束（突進の速さ）。弧の後ろ側だけ */
function dashLines(frame, f) {
  const k = f < DASH.active ? 0 : (f - DASH.active + 1) / (DASH.frames - DASH.active + 1);
  if (k >= 0.8) return;
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 11 + (hash1(i, 1551) - 0.5) * 5;
    const len = (18 + 20 * hash1(i, 1552)) * (1 - k * 0.5);
    // 毎フレーム後ろへ流す（止まっていると格子模様に見える）
    const x1 = 18 - f * 7 - hash1(i, 1553) * 10;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
  }
}

/** 首斬り: 振り切りで刃の縁の先に横一文字の閃き（首を落とす一点）。弧とは別に、先端の外側に短く */
function neckFlash(frame, f) {
  const A = NECK.active;
  if (f < A - 1 || f > A + 1) return;
  const end = (NECK.sweep / 2 + NECK.tilt) * DEG;
  const r = NECK.R - 4;
  const cx = Math.cos(end) * r;
  const cy = Math.sin(end) * r;
  const tx = -Math.sin(end);
  const ty = Math.cos(end);
  const age = f - (A - 1);
  const L = 14 + age * 8;
  streakLine(frame, { ax: cx - tx * 6, ay: cy - ty * 6, bx: cx + tx * L, by: cy + ty * L, width: age === 0 ? 2 : 1.4, bright: 1 - age * 0.2 });
  if (age === 0) sparkle(frame, cx + tx * 3, cy + ty * 3, 3);
}

/** 二丁投げ: 弧の外を回る 2 つの斧頭（小さな楔）。投げた 2 丁を角で分けて見せる */
function twinHeads(frame, f) {
  const A = TWIN.active;
  if (f >= A + 2) return;
  const half = (TWIN.sweep * DEG) / 2;
  const p = f < A ? easeSwing((f + 1) / A) : 1 + (f - A + 1) * 0.08;
  for (let j = 0; j < 2; j++) {
    const a = -half + TWIN.sweep * DEG * p - j * 0.55;
    const r = TWIN.R + 9 + j * 4;
    const hx = Math.cos(a) * r;
    const hy = Math.sin(a) * r;
    // 斧頭の向きはフレームごとに回る（投げた斧の回転）
    const spin = f * 1.3 + j * 1.9;
    const bright = (j === 0 ? 0.95 : 0.75) * (f < A ? 1 : 0.7);
    wedgeLine(frame, { ax: hx - Math.cos(spin) * 8, ay: hy - Math.sin(spin) * 8, bx: hx + Math.cos(spin) * 6, by: hy + Math.sin(spin) * 6, T: 13, bright, seed: 1771 + j, cap: 0.4, power: 1.2 });
  }
}

// -----------------------------------------------------------------------------
// 縦の叩き割り（打ち割り・大割り・断ち割り）。原点 = 当たり判定の中心（box の中心）
// -----------------------------------------------------------------------------

/**
 * 叩き割りの共通: 手元（−x、自分の側）から当たりの中心へ振り下ろす短く太い楔 → 着地点から亀裂と木片。
 * 上から見た振り下ろしなので、軌跡は攻撃の向きに沿った短い直線になる
 */
function chopBase(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const hitX = spec.hitX;
  const from = spec.from;
  // 振りの楔: 斧頭が落ちる地点まで伸び、着地後は手元側から痩せて消える
  if (k < 0.75) {
    const tailX = f < A ? from : from + (hitX - from) * Math.min(0.9, k * 1.4);
    wedgeLine(frame, { ax: tailX, ay: 0, bx: from + (hitX - from) * p, by: 0, T: spec.T * (1 - k * 0.5), grow: 1, erosion: k * 0.9, bright: 1 - k * 0.3, seed: spec.seed, cap: 0.16, power: 1.6 });
  }
  if (f === A - 1) sparkle(frame, hitX, 0, spec.glint);
  return { p, k, age: f - (A - 1), hitX };
}

/** 着地点から前と左右へ広がる亀裂の束 */
function impactCracks(frame, age, spec, hitX) {
  if (age < 0) return;
  const grow = Math.min(1, (age + 1) / 2);
  const er = age <= 1 ? 0 : Math.min(0.95, (age - 1) * spec.crackFade);
  for (let i = 0; i < spec.cracks.length; i++) {
    const c = spec.cracks[i];
    crack(frame, { x: hitX + (c.dx ?? 0), y: c.dy ?? 0, angle: c.a * DEG, len: c.len, width: c.w, grow, erosion: er, bright: c.bright ?? 0.72, seed: spec.seed + 10 + i, segments: c.n ?? 5, jag: c.jag ?? 0.35 });
  }
}

/** 着地の木片: 着地点から上下（左右）と前へ弾ける棒 */
function impactChips(frame, age, spec, hitX) {
  if (age < 0) return;
  chips(frame, age, spec.chips, spec.seed + 60, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const a = side * (0.35 + rnd(2) * 1.3) + (rnd(3) > 0.8 ? Math.PI : 0) * 0;
    const sp = spec.chipSpeed * (0.55 + 0.8 * rnd(4));
    return { x: hitX + (rnd(5) - 0.5) * 6, y: (rnd(6) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(7) * 3), len: rnd(8) > 0.4 ? 3 : 2, angle: rnd(9) * Math.PI, spin: (rnd(10) - 0.5) * 1.8 };
  });
}

/** 右: 打ち割り（box reach 20 / size 26・重い）: 短い振り下ろし + 前へ 3 本の亀裂 + 木片 */
const CHOP = {
  frames: 8,
  active: 3,
  from: -34,
  hitX: 6,
  T: 22,
  glint: 3,
  seed: 2101,
  chips: 9,
  chipSpeed: 3.6,
  crackFade: 0.24,
  cracks: [
    { a: 0, len: 24, w: 3.6, jag: 0.5 },
    { a: -38, len: 15, w: 2.6, jag: 0.5, dx: 2 },
    { a: 42, len: 14, w: 2.6, jag: 0.5, dx: 2 },
  ],
};
function axeChop(frame, f) {
  const { age, hitX } = chopBase(frame, f, CHOP);
  impactCracks(frame, age, CHOP, hitX);
  impactChips(frame, age, CHOP, hitX);
}

/** 右: 大割り（box reach 22 / size 30・重い・出血）: 大きな振り下ろし + 放射状に 5 本の深い亀裂 + 衝撃の輪 2 枚 */
const SPLIT = {
  frames: 9,
  active: 4,
  from: -40,
  hitX: 6,
  T: 30,
  glint: 4,
  seed: 2202,
  chips: 14,
  chipSpeed: 4.4,
  crackFade: 0.17,
  cracks: [
    { a: 0, len: 30, w: 4.6, n: 6 },
    { a: -40, len: 22, w: 3.4 },
    { a: 42, len: 22, w: 3.4 },
    { a: -95, len: 16, w: 2.6, dx: -3 },
    { a: 100, len: 15, w: 2.6, dx: -3 },
  ],
};
function greatSplit(frame, f) {
  const { age, hitX } = chopBase(frame, f, SPLIT);
  impactCracks(frame, age, SPLIT, hitX);
  if (age >= 0 && age <= 4) {
    // 地面を叩いた衝撃の輪（攻撃の向きに潰す = 上から見た地面の波）。1 枚だけ、早めに崩す
    ring(frame, { ox: hitX, radius: 8 + age * 7, width: 2.6 - age * 0.3, squash: 0.6, erosion: Math.min(0.92, 0.15 + age * 0.22), bright: 0.75 - age * 0.1, seed: 2211 });
  }
  if (age === 0 || age === 1) sparkle(frame, hitX, 0, age === 0 ? 4 : 3);
  impactChips(frame, age, SPLIT, hitX);
}

/**
 * 派生: 断ち割り（box reach 20 / size 30・重い・大きく踏み込む）: 振り下ろしの後、地面が前へ一直線に裂け、
 * 裂け目が左右に開く（V 字に広がる 2 本の縁）。木片は左右へ真横に弾ける
 */
const CLEAVE = { frames: 9, active: 4, from: -44, hitX: -6, T: 28, glint: 4, seed: 2303, chips: 14, chipSpeed: 4.8, crackFade: 0.2, cracks: [] };
function cleave(frame, f) {
  const { age, hitX } = chopBase(frame, f, CLEAVE);
  if (age < 0) return;
  const grow = Math.min(1, (age + 1) / 2.5);
  const er = age <= 2 ? 0 : Math.min(0.95, (age - 2) * 0.22);
  const L = 44;
  const fork = L * 0.45;
  // 1 本の太い裂け目が前へ走り、途中で 2 股に割れて開く（地面が断ち割られる）
  crack(frame, { x: hitX, y: 0, angle: 0, len: fork * Math.min(1, grow * 2), width: 5, erosion: er, bright: 0.8, seed: 2310, segments: 4, jag: 0.25 });
  if (grow > 0.5) {
    const g2 = (grow - 0.5) * 2;
    const open = Math.min(1, age / 3);
    for (const side of [-1, 1]) {
      crack(frame, { x: hitX + fork, y: 0, angle: side * (12 + 12 * open) * DEG, len: (L - fork) * g2, width: 3.4, erosion: er, bright: 0.72, seed: 2312 + side, segments: 4, jag: 0.35 });
    }
  }
  if (age <= 1) sparkle(frame, hitX + fork * Math.min(1, grow * 2), 0, age === 0 ? 4 : 3);
  chips(frame, age, CLEAVE.chips, 2361, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const along = rnd(2);
    const a = side * (Math.PI / 2 - 0.25 + rnd(3) * 0.5) + (along - 0.5) * 0.3;
    const sp = CLEAVE.chipSpeed * (0.5 + 0.8 * rnd(4));
    return { x: hitX + 4 + along * L * 0.8, y: side * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), len: rnd(6) > 0.4 ? 3 : 2, angle: rnd(7) * Math.PI, spin: (rnd(8) - 0.5) * 1.8 };
  });
}

// -----------------------------------------------------------------------------
// 回転（回し斬り・回転斬り）。原点 = 自分（circle reach 0 は自分の中心）。向き無し
// -----------------------------------------------------------------------------

/** 回し斬り（circle size 52）: 重い斧頭が 1 周する太い楔の円弧。斧頭の位置が一番明るい */
function axeWhirl(frame, f) {
  const A = 5;
  const N = 9;
  const R = 54;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const start = -Math.PI / 2;
  const head = f < A ? start + easeSwing((f + 1) / A) * TAU : start + TAU + Math.sin(k * Math.PI * 0.5) * 0.9;
  const trail = f < A ? Math.min(TAU * 0.75, head - start) : TAU * 0.75 * (1 - k * 0.8);
  const T = 26 * (f < A ? 1 : 1 - k * 0.45);
  wedgeArc(frame, { R, T, head, tail: head - trail, erosion: k === 0 ? 0 : 0.05 + 0.85 * Math.pow(k, 1.2), bright: 1 - k * 0.3, seed: 3101, cap: 0.06, power: 3.2, edgeReach: 0.22 });
  if (k < 0.7) arcLine(frame, { radius: R + 2 + k * 5, from: head - trail * 0.35, to: head - 0.1, bright: 0.6 * (1 - k) });
  const hx = Math.cos(head) * (R - 2);
  const hy = Math.sin(head) * (R - 2);
  if (f === A - 1) sparkle(frame, hx, hy, 4);
  else if (f === 2) sparkle(frame, hx, hy, 2);
  if (f >= A - 1) {
    chips(frame, f - (A - 1), 12, 3161, (i, rnd) => {
      const a = start + rnd(1) * TAU;
      const sp = 3 + rnd(2) * 3;
      // 円の接線（時計回り）へ投げ出され、少し外へ
      return { x: Math.cos(a) * (R - 8), y: Math.sin(a) * (R - 8), vx: (-Math.sin(a) * 0.75 + Math.cos(a) * 0.45) * sp, vy: (Math.cos(a) * 0.75 + Math.sin(a) * 0.45) * sp, life: 3 + Math.floor(rnd(3) * 2), len: rnd(4) > 0.4 ? 3 : 2, angle: rnd(5) * Math.PI, spin: 0.8 };
    });
  }
}

/**
 * 派生: 回転斬り（circle size 50・2 段ヒット・active 0.2）: 2 周する。1 周ごとに斧頭が閃き、
 * 軌跡は回し斬りより細く短い（速い回転）。2 周目の終わりで木片が外へ散る
 */
function axeSpin(frame, f) {
  const A = 6;
  const N = 10;
  const R = 52;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const start = -Math.PI / 2;
  const turns = 2;
  const rawHead = f < A ? start + ((f + 1) / A) * TAU * turns : start + TAU * turns + Math.sin(k * Math.PI * 0.5) * 1.1;
  const trail = f < A ? TAU * 0.55 : TAU * 0.55 * (1 - k * 0.8);
  const flash = f === 2 || f === 5 ? 1.1 : 0.92;
  wedgeArc(frame, { R, T: 20 * (1 - k * 0.45), head: rawHead, tail: rawHead - trail, erosion: k === 0 ? 0 : 0.05 + 0.85 * Math.pow(k, 1.2), bright: flash * (1 - k * 0.3), seed: 3202, cap: 0.07, power: 2.6, edgeReach: 0.25 });
  // 外周の速度線は斧頭の後ろに 1 本だけ（反対側にも引くと 2 本目の弧に見える）
  if (k < 0.7) {
    arcLine(frame, { radius: R + 2, from: rawHead - trail * 0.45, to: rawHead - 0.12, bright: 0.55 * (1 - k) });
  }
  if (f === 2 || f === 5) sparkle(frame, Math.cos(rawHead) * (R - 2), Math.sin(rawHead) * (R - 2), 4);
  if (f >= A - 1) {
    chips(frame, f - (A - 1), 12, 3261, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 3.2 + rnd(2) * 3;
      return { x: Math.cos(a) * (R - 6), y: Math.sin(a) * (R - 6), vx: (-Math.sin(a) * 0.6 + Math.cos(a) * 0.6) * sp, vy: (Math.cos(a) * 0.6 + Math.sin(a) * 0.6) * sp, life: 3 + Math.floor(rnd(3) * 2), len: rnd(4) > 0.4 ? 3 : 2, angle: rnd(5) * Math.PI, spin: 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中: 深い V 字の切り込み + 木片。+x = 刃の進む向き
// -----------------------------------------------------------------------------

/**
 * V 字の切り込み: 頂点が刃の進む向き（+x）、口が後ろ（−x）に開く。縁は明るく、底は暗い（深さ）。
 * open（0..1）で口が開き、erosion で崩れる
 */
function vNotch(frame, o) {
  const { L, H } = o;
  const apex = o.apex ?? 0;
  const open = o.open ?? 1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 11;
  const back = apex - L;
  paint(
    frame,
    (x, y) => {
      if (x > apex || x < back) return -1;
      const t = (apex - x) / L;
      const half = H * open * Math.pow(t, 0.85);
      const ay = Math.abs(y);
      // 縁の太さ: 頂点寄りで太く、口へ向かって細って消える（口を直線で切らない）
      const rim = 2.6 * (1 - t) + 0.6;
      if (ay > half + rim * 0.5) return -1;
      const d = half - ay;
      if (!survives(x, y, erosion, 1 - t * 0.6, seed)) return -1;
      if (d < rim * 0.5) {
        if (t > 0.92) return -1;
        return clamp01(bright * (0.55 + 0.5 * (1 - t)) * (1 - erosion * 0.3));
      }
      // 底（切り込みの深さ）: 頂点の近くだけ暗く塗り、口へ向かって抜く
      if (t > 0.55) return -1;
      return clamp01(bright * 0.14 * (1 - erosion * 0.5));
    },
    { bounds: { x0: back - 2, y0: -H - 3, x1: apex + 2, y1: H + 3 } },
  );
}

function axeHit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const L = heavy ? 30 : 20;
  const H = heavy ? 13 : 8;
  const apex = heavy ? 12 : 8;
  vNotch(frame, { L, H, apex, open: f === 0 ? 0.45 : 1 - k * 0.25, erosion: k * 0.9, bright: 1 - k * 0.2, seed: heavy ? 4101 : 4201 });
  // 頂点から先へ走る亀裂（切り込みがさらに割れる）
  if (f >= 1) {
    const grow = Math.min(1, f / 2);
    crack(frame, { x: apex, y: 0, angle: 0, len: heavy ? 16 : 9, width: heavy ? 2.6 : 1.8, grow, erosion: k * 0.9, bright: 0.7, seed: heavy ? 4110 : 4210, segments: 3 });
    if (heavy) {
      crack(frame, { x: apex - 4, y: -3, angle: -60 * DEG, len: 11, width: 2, grow, erosion: k * 0.9, bright: 0.62, seed: 4111, segments: 3 });
      crack(frame, { x: apex - 4, y: 3, angle: 62 * DEG, len: 11, width: 2, grow, erosion: k * 0.9, bright: 0.62, seed: 4112, segments: 3 });
    }
  }
  if (f <= 1) sparkle(frame, apex, 0, heavy ? (f === 0 ? 3 : 4) : f === 0 ? 2 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { ox: apex - 4, radius: 7 + age * 5, width: 2.4 - age * 0.25, squash: 0.75, erosion: Math.min(0.92, 0.2 + age * 0.2), bright: 0.75 - age * 0.1, seed: 4120 });
  }
  if (f >= 1) {
    chips(frame, f - 1, heavy ? 12 : 7, heavy ? 4130 : 4230, (i, rnd) => {
      // 木片は刃の進む向きの左右へ（切り込みの縁から弾ける）
      const side = rnd(1) > 0.5 ? 1 : -1;
      const a = side * (0.5 + rnd(2) * 1.1);
      const sp = (heavy ? 3.8 : 3) + rnd(3) * (heavy ? 3.2 : 2);
      return { x: apex - 4 - rnd(4) * 8, y: side * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), len: rnd(6) > 0.4 ? 3 : 2, angle: rnd(7) * Math.PI, spin: (rnd(8) - 0.5) * 1.8 };
    });
  }
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（論理 px）
 */
const FX = {
  moveset: "axe",
  motions: {
    "l:0": { sheet: "axe.l1", pivot: "self", base: 24, measure: "reach" },
    "l:1": { sheet: "axe.l2", pivot: "self", base: 24, measure: "reach" },
    "l:2": { sheet: "axe.l3", pivot: "self", base: 26, measure: "reach" },
    "l:3": { sheet: "axe.l4", pivot: "self", base: 28, measure: "reach" },
    dash: { sheet: "axe.dash", pivot: "self", base: 26, measure: "reach" },
    "r:axeChop": { sheet: "axe.chop", pivot: "anchor", base: 20, measure: "reach" },
    "r:axeWhirl": { sheet: "axe.whirl", pivot: "self", base: 52, measure: "size" },
    "r:greatSplit": { sheet: "axe.split", pivot: "anchor", base: 22, measure: "reach" },
    "branch:cleave": { sheet: "axe.cleave", pivot: "anchor", base: 20, measure: "reach" },
    "branch:axeSpin": { sheet: "axe.spin", pivot: "self", base: 50, measure: "size" },
    "branch:neckChop": { sheet: "axe.neck", pivot: "self", base: 26, measure: "reach" },
    "branch:twinThrow": { sheet: "axe.twin", pivot: "self", base: 26, measure: "reach" },
  },
  hit: "axe.hit",
  hitHeavy: "axe.hitHeavy",
};

export const ATLAS = {
  key: "axe",
  fx: FX,
  sheets: [
    swingSheet("axe.l1", L1),
    swingSheet("axe.l2", L2),
    swingSheet("axe.l3", L3),
    swingSheet("axe.l4", L4),
    swingSheet("axe.dash", DASH, dashLines),
    swingSheet("axe.neck", NECK, neckFlash),
    swingSheet("axe.twin", TWIN, twinHeads),
    { key: "axe.chop", dirs: DIRS, frames: CHOP.frames, active: CHOP.active, size: 120, draw: axeChop },
    { key: "axe.split", dirs: DIRS, frames: SPLIT.frames, active: SPLIT.active, size: 140, draw: greatSplit },
    { key: "axe.cleave", dirs: DIRS, frames: CLEAVE.frames, active: CLEAVE.active, size: 140, draw: cleave },
    { key: "axe.whirl", dirs: 1, frames: 9, active: 5, size: 150, draw: axeWhirl },
    { key: "axe.spin", dirs: 1, frames: 10, active: 6, size: 148, draw: axeSpin },
    { key: "axe.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => axeHit(frame, f, false) },
    { key: "axe.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 100, draw: (frame, f) => axeHit(frame, f, true) },
  ],
};
