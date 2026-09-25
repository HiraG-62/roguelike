// 大剣（moveset "greatsword"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/greatsword.json）× 2 が目安
//
// 剣と見分けるための決まり（この武器種の絵の芯）:
// - 弧は剣の「先の尖った細い三日月」ではなく、先端が丸く鈍い「分厚い帯」。いちばん太いのは先ではなく刃の腹（中ほど）
// - 帯の内縁に暗い段 2 の縁取りを付け、重さ（鉄の塊）を出す。白は外縁の細い線だけ
// - 振り切りで床の砂煙（画面に水平な低い粒の塊）と石礫が舞う。剣の光る刃片は使わない
// - 叩きつけは地面の楕円の輪と亀裂で「床に当たった」ことを見せる
import { arcBounds, arcLine, easeSwing, lens, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, segment, stamp, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS, WIDE_SWEEP } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（大剣だけの形）
// -----------------------------------------------------------------------------

/** 角の差を [0, 2π) に（1 周近い帯を扱うので wrapAngle の (-π, π] では足りない） */
function ahead(head, a) {
  const d = (head - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 正準座標 → 画面に揃った座標（原点からのずれ）。砂煙・地面の輪は画面の水平に揃える（床は向きで回らない） */
function toScreen(frame, x, y) {
  return { x: x * frame.cos - y * frame.sin, y: x * frame.sin + y * frame.cos };
}

/** 崩れの判定。大剣は大きなセルのノイズで、塊ごとにごろっと欠ける（剣の細かい崩れと見分ける） */
function survivesChunky(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 7, seed) * 0.45 + valueNoise(x + y * 0.5, y - x * 0.5, 4.5, seed + 7) * 0.37;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/** 分厚い帯の太さの輪郭。u = 0 が先端（丸く鈍い）、cap まで丸く立ち上がり、peak（刃の腹）まで太り、尾へ細る */
function heavyWidth(u, peak, cap) {
  if (u < 0 || u > 1) return 0;
  if (u < cap) {
    const t = 1 - u / cap;
    return 0.72 * (0.55 + 0.45 * Math.sqrt(1 - t * t));
  }
  if (u < peak) return 0.72 + 0.28 * Math.sin(((u - cap) / (peak - cap)) * (Math.PI / 2));
  return Math.pow(1 - (u - peak) / (1 - peak), 0.75);
}

/**
 * 大剣の弧の帯（1 回の振りに 1 本）。中心 (ox, oy)、外縁の半径 R、最大の太さ T、head = 先端の角、tail = 尾の端の角。
 * 外縁は細い白い刃の縁、本体は明るく厚く、内縁は段 2 の縁取り。band は半径方向の粗い筋（鉄の重い質感）
 */
function heavyBand(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const peak = o.peak ?? 0.42;
  const cap = Math.min(o.cap ?? 0.12, peak * 0.6);
  const rim = o.rim ?? 1.6;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R) return -1;
      const u = ahead(head, Math.atan2(dy, dx)) / span;
      if (u > 1) return -1;
      const w = T * heavyWidth(u, peak, cap);
      if (w < 0.8) return -1;
      const d = R - r;
      const q = d / w;
      if (q > 1) return -1;
      if (!survivesChunky(x, y, erosion, (1 - q) * (1 - u * 0.7), seed)) return -1;
      // 外縁の細い線だけが白い刃の縁（尾の 3 割は色の帯に溶かす）
      if (d < rim && u < 0.7 && erosion < 0.45) return clamp01(bright * (1.06 - 0.3 * u));
      // 内縁の 2 ドットは暗い縁取り（厚みの影）。崩れの間も残して塊に見せる
      if (w - d < 2.1) return clamp01(0.15 * bright + 0.04);
      const band = Math.floor(d / 3.2);
      const grain = 0.86 + 0.2 * hash1(band, seed);
      return clamp01(Math.pow(1 - q, 0.55) * (0.9 - 0.42 * u) * grain * bright * (1 - erosion * 0.4));
    },
    { bounds: arcBounds(ox, oy, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/**
 * 砂煙の塊（画面に水平な低い楕円の粒）。puffs は画面座標 {x, y, rx, ry, v}（x, y は原点からのずれ）。
 * 段 1〜3 だけ。ノイズも画面座標で取るので、方向が変わっても煙の質感は揃う
 */
function dustCloud(frame, puffs, erosion, seed) {
  if (puffs.length === 0) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of puffs) {
    // 画面の点を正準座標へ戻し、回しても入る正方形で囲む
    const cx = p.x * frame.cos + p.y * frame.sin;
    const cy = -p.x * frame.sin + p.y * frame.cos;
    const m = Math.max(p.rx, p.ry) + 3;
    x0 = Math.min(x0, cx - m);
    y0 = Math.min(y0, cy - m);
    x1 = Math.max(x1, cx + m);
    y1 = Math.max(y1, cy + m);
  }
  paint(
    frame,
    (x, y) => {
      const s = toScreen(frame, x, y);
      let best = -1;
      let wobble = NaN;
      for (const p of puffs) {
        const dx = (s.x - p.x) / p.rx;
        const dy = (s.y - p.y) / p.ry;
        // 外周のゆらぎは ±0.2 なので、それより外は計算しない（生成時間の節約）
        const d0 = dx * dx + dy * dy;
        if (d0 > 1.45) continue;
        if (Number.isNaN(wobble)) wobble = (valueNoise(s.x, s.y, 4, seed) - 0.5) * 0.4;
        const d = Math.sqrt(d0) + wobble;
        if (d > 1) continue;
        // 上側（画面の上）ほど明るい: 煙の塊の丸み
        const v = p.v * (0.55 + 0.45 * (1 - d)) * (1 - dy * 0.28);
        if (v > best) best = v;
      }
      if (best < 0) return -1;
      if (erosion > 0 && valueNoise(s.x, s.y, 5, seed + 3) - erosion * 0.95 < 0) return -1;
      return clamp01(Math.min(0.42, best));
    },
    { bounds: { x0, y0, x1, y1 }, samples: 2, dither: 0.02 },
  );
}

/**
 * 1 か所から左右へ広がる砂煙の塊。center は正準座標、age は発生からのフレーム。
 * 横へ流れて少し浮き、薄れる（床に沿った低い塊）
 */
function dustBurst(frame, center, age, o) {
  const { n, spread, size, life, seed } = o;
  if (age < 0 || age > life) return;
  const c = toScreen(frame, center.x, center.y);
  const k = age / (life + 1);
  const puffs = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const dir = side * (0.25 + 0.75 * hash1(i, seed));
    const dist = spread * (0.25 + 0.75 * hash1(i, seed + 1)) * (1 - Math.pow(0.62, age + 1));
    const rx = size * (0.55 + 0.45 * hash1(i, seed + 2)) * (0.7 + age * 0.16);
    puffs.push({
      x: c.x + dir * dist,
      y: c.y + (hash1(i, seed + 3) - 0.35) * size * 0.5 - age * 0.6,
      rx,
      ry: rx * 0.6,
      v: (o.v ?? 0.4) * (1 - k * 0.6),
    });
  }
  dustCloud(frame, puffs, Math.max(0, k - 0.25) * 1.1, seed);
}

/** 石礫（画面に揃った 2x2 / 3x3 の角ばった塊）。list(i, rnd) → {x, y, vx, vy, life, big}（正準座標） */
function pebbles(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const p = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!p || age < 0 || age > p.life) continue;
    const drag = p.drag ?? 0.8;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const x = p.x + p.vx * travel;
    const y = p.y + p.vy * travel;
    const fade = 1 - age / (p.life + 1);
    const hi = fade > 0.55 ? 5 : 4;
    const lo = hi - 2;
    const pattern = p.big && fade > 0.3 ? [`.${hi}${hi - 1}`, `${hi}${hi - 1}${lo}`, `.${lo}${lo}`] : [`${hi}${hi - 1}`, `${hi - 1}${lo}`];
    stamp(frame, x, y, pattern);
  }
}

/** 地面の楕円の輪（画面に揃う。床は向きで回らない）。中心は正準座標 */
function groundRing(frame, center, o) {
  const { radius, width } = o;
  const squash = o.squash ?? 0.5;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.6;
  const seed = o.seed ?? 5;
  const c = toScreen(frame, center.x, center.y);
  const m = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const s = toScreen(frame, x, y);
      const dx = s.x - c.x;
      const dy = (s.y - c.y) / squash;
      const dd = Math.abs(Math.hypot(dx, dy) - radius);
      // 潰れた楕円の上下は細く見えるので、太さを縦の潰れに合わせて詰める
      const wv = (width / 2) * (0.55 + 0.45 * Math.abs(dx) / Math.max(1, Math.hypot(dx, dy)));
      if (dd > wv / squash ** 0.35) return -1;
      const q = dd / wv;
      if (erosion > 0 && valueNoise(s.x, s.y, 5, seed) * 0.8 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      // 手前（画面の下）側を明るく: 地面を叩いた縁の立ち上がり
      return clamp01(bright * (1 - 0.45 * q) * (dy > 0 ? 1 : 0.78) * (1 - erosion * 0.4));
    },
    { bounds: { x0: center.x - m, y0: center.y - m, x1: center.x + m, y1: center.y + m }, samples: 2 },
  );
}

/** 亀裂の折れ線（正準座標）。原点 (cx, cy)・角 a・長さ len。seed で折れ方が決まる */
function crackPath(cx, cy, a, len, seed) {
  const pts = [{ x: cx, y: cy }];
  const n = 5;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const j = (hash1(i, seed) - 0.5) * 7 * (i < n ? 1 : 0.4);
    const aa = a + (hash1(i, seed + 1) - 0.5) * 0.25;
    pts.push({ x: cx + Math.cos(aa) * len * t - Math.sin(aa) * j, y: cy + Math.sin(aa) * len * t + Math.cos(aa) * j });
  }
  return pts;
}

/** 亀裂: 細い段 3 の割れ目（根元だけ段 4）。grow で伸び、erosion で薄れる */
function cracks(frame, paths, grow, erosion, seed) {
  for (let ci = 0; ci < paths.length; ci++) {
    const pts = paths[ci];
    const segs = pts.length - 1;
    const upto = segs * clamp01(grow);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x - 4);
      y0 = Math.min(y0, p.y - 4);
      x1 = Math.max(x1, p.x + 4);
      y1 = Math.max(y1, p.y + 4);
    }
    paint(
      frame,
      (x, y) => {
        let best = Infinity;
        let along = 0;
        for (let i = 0; i < segs && i < upto; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          if (!a || !b) continue;
          const lim = Math.min(1, upto - i);
          const s = segment(x, y, a.x, a.y, a.x + (b.x - a.x) * lim, a.y + (b.y - a.y) * lim);
          if (s.d < best) {
            best = s.d;
            along = (i + s.t * lim) / segs;
          }
        }
        const w = 1.5 * (1 - along * 0.5);
        if (best > w) return -1;
        if (erosion > 0 && valueNoise(x, y, 4, seed + ci) + (1 - along) * 0.3 - erosion * 1.1 < 0) return -1;
        return along < 0.2 ? 0.36 : 0.24;
      },
      { bounds: { x0, y0, x1, y1 }, dither: 0, samples: 2 },
    );
  }
}

/** 外周の風圧の線（円周に沿う 1px の弧）。旋風の外側だけに引く */
function windLines(frame, head, o) {
  const { R, count, seed, k } = o;
  for (let i = 0; i < count; i++) {
    const h = hash1(i, seed);
    const radius = R + 4 + i * 3 + k * 10;
    const len = (0.7 + 0.9 * hash1(i, seed + 1)) * (1 - k * 0.7);
    const end = head - 0.1 - h * 0.6 + i * 2.1 + k * 0.4;
    if (len < 0.1 || k > 0.92) continue;
    arcLine(frame, { radius, from: end - len, to: end, width: i === 0 ? 1.4 : 1, bright: (0.6 - i * 0.05) * (1 - k * 0.6) });
  }
}

// -----------------------------------------------------------------------------
// 弧の振り（左 1〜3 段・薙ぎ払い・振り上げ・横一文字・溜め斬り）
// -----------------------------------------------------------------------------

/** 振りの時間割: active で先端が振り幅を走り、残りで尾が追いつきながら塊ごとに崩れる */
function swingPose(f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    return { from, sweep, head: from + sweep * p, tail: from + sweep * Math.max(0, p - spec.tailLen) * 0.5, erosion: 0, bright: 0.85 + 0.15 * p, k: 0, T: spec.T * (0.75 + 0.25 * ((f + 1) / A)) };
  }
  const k = (f - A + 1) / (spec.frames - A);
  const erodePow = spec.erodePow ?? 1.3;
  return {
    from,
    sweep,
    head: from + sweep * (1 + spec.overshoot * k),
    tail: from + sweep * Math.min(0.97, 1 - spec.tailLen + (spec.tailLen - 0.05) * Math.pow(k, 0.8)),
    erosion: 0.04 + 0.84 * Math.pow(k, erodePow),
    bright: 1 - 0.3 * k,
    k,
    T: spec.T * (1 - 0.4 * k),
  };
}

/** 大剣の弧の 1 フレーム。1 本の分厚い帯 + 外縁の速度線 + 振り切りの砂煙と石礫 */
function heavySwing(frame, f, spec) {
  const A = spec.active;
  const s = swingPose(f, spec);
  heavyBand(frame, { R: spec.R, T: s.T, head: s.head, tail: s.tail, erosion: s.erosion, bright: s.bright * (spec.bright ?? 1), seed: spec.seed, peak: spec.peak, rim: spec.rim });
  // 速度線: 外縁のすぐ外だけ（内側に引くと 2 本目の弧に見える）。大剣は少なく太め
  const span = s.head - s.tail;
  for (let i = 0; i < spec.lines; i++) {
    const radius = spec.R + 2.5 + i * 2 + s.k * 7;
    const len = span * (0.3 + 0.4 * hash1(i, spec.seed + 41)) * (1 - s.k * 0.85);
    const end = s.head - span * (0.08 + 0.12 * hash1(i, spec.seed + 42)) + s.k * span * 0.2;
    if (len <= 0.03 || s.k >= 0.9) continue;
    arcLine(frame, { radius, from: end - len, to: end, width: i === 0 ? 1.4 : 1, bright: (0.6 - i * 0.06) * (1 - s.k * 0.6) });
  }
  const tipR = spec.R - spec.T * 0.4;
  if (f === A - 1 || f === A) {
    sparkle(frame, Math.cos(s.head) * (spec.R - 3), Math.sin(s.head) * (spec.R - 3), f === A - 1 ? spec.glint : spec.glint - 1);
  }
  // 振り切りの位置（刃が床をかすめた所）から砂煙。振り上げは振り始め（dustFrom = 0）の床から立つ
  const dustFrom = spec.dustFrom ?? A - 1;
  const dustR = spec.R - 4;
  const dustAt = spec.dustAt ?? [1];
  for (let j = 0; j < dustAt.length; j++) {
    const a = s.from + s.sweep * (dustAt[j] ?? 1);
    dustBurst(frame, { x: Math.cos(a) * dustR, y: Math.sin(a) * dustR }, f - dustFrom - j, { n: spec.dust + 2, spread: spec.dustSpread ?? 26, size: spec.dustSize ?? 15, life: spec.frames - dustFrom, seed: spec.seed + 70 + j * 5, v: spec.dustV });
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  // 石礫: 振りの後半から、刃の進む向き（接線）と外向きへ重く飛ぶ
  pebbles(frame, age, spec.pebbles, spec.seed + 60, (i, rnd) => {
    const a = s.from + s.sweep * (0.5 + 0.5 * rnd(1));
    const r = tipR - spec.T * 0.3 * rnd(2);
    const sp = spec.pebbleSpeed * (0.5 + 0.8 * rnd(3));
    const out = 0.4 + 0.45 * rnd(4);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp, vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp, life: 3 + Math.floor(rnd(5) * 3), big: rnd(6) > 0.55 };
  });
}

/** 左 1 段（arc 150° reach 30）: 刃の腹が重い分厚い帯 */
const L1 = { R: 70, T: 44, sweep: 150, tilt: 0, frames: 8, active: 4, tailLen: 0.85, overshoot: 0.05, lines: 2, glint: 3, pebbles: 5, pebbleSpeed: 4, dust: 4, seed: 1101 };
/** 左 2 段（同じ当たり）: 返しの振り（描画側が上下反転）。低く構えて、刃の腹をさらに後ろへ寄せる */
const L2 = { R: 72, T: 48, sweep: 158, tilt: 8, peak: 0.5, frames: 8, active: 4, tailLen: 0.9, overshoot: 0.06, lines: 2, glint: 3, pebbles: 6, pebbleSpeed: 4.5, dust: 5, seed: 1202 };
/** 左 3 段（arc 200° reach 32）: 大きく回り込む最も厚い帯。振り始めと振り切りの 2 か所で床を擦る */
const L3 = { R: 80, T: 54, sweep: 200, tilt: 0, peak: 0.45, frames: 9, active: 4, tailLen: 0.9, overshoot: 0.05, lines: 3, glint: 4, pebbles: 9, pebbleSpeed: 5, dust: 6, dustSize: 13, dustSpread: 28, seed: 1303 };
/** 右: 薙ぎ払い（arc 240° reach 36）。低く長い横薙ぎ。帯は少し薄く、床を擦る砂煙が弧の後半に並ぶ */
const SWEEP = { R: 78, T: 42, sweep: 240, tilt: 0, peak: 0.55, frames: 8, active: 4, tailLen: 0.95, overshoot: 0.04, lines: 3, glint: 3, pebbles: 8, pebbleSpeed: 4.5, dust: 4, dustAt: [0.55, 0.8, 1], dustSize: 10, seed: 1404 };
/** 右: 振り上げ（arc 180° reach 32）。床から跳ね上げる: 振り始めの位置に砂煙、石礫が高く飛ぶ */
const UPSWING = { R: 72, T: 48, sweep: 180, tilt: -14, peak: 0.34, frames: 9, active: 4, tailLen: 0.8, overshoot: 0.1, lines: 2, glint: 3, pebbles: 10, pebbleSpeed: 6, dust: 5, dustAt: [0.02], dustFrom: 0, dustSize: 13, dustSpread: 18, seed: 1505 };
/** 派生: 横一文字（arc 270° reach 34）。超広角の一文字: 細めで長い帯と長い風の線 */
const HORIZON = { R: 78, T: 28, sweep: 270, tilt: 0, peak: 0.7, frames: 7, active: 3, tailLen: 1, overshoot: 0.03, lines: 3, glint: 4, pebbles: 7, pebbleSpeed: 4.5, dust: 3, dustAt: [0.4, 0.75, 1], dustSize: 11, seed: 1606, rim: 1.4 };
/** 溜め斬り（arc 180° reach 34）: 最大の一撃。いちばん大きく明るい帯、長く残る崩れ、大量の砂煙 */
const CHARGE = { R: 84, T: 62, sweep: 196, tilt: 0, peak: 0.46, frames: 10, active: 4, tailLen: 0.92, overshoot: 0.04, erodePow: 1.9, lines: 4, glint: 4, pebbles: 14, pebbleSpeed: 6, dust: 7, dustAt: [0.45, 1], dustSize: 15, dustSpread: 32, dustV: 0.42, bright: 1.12, rim: 2.2, seed: 1707 };

/** 横一文字: 帯に加えて、振り切った後に 270° の全長へ細く明るい刃の軌跡（一文字）が一瞬残り、外へほどける */
function horizonSlash(frame, f) {
  heavySwing(frame, f, HORIZON);
  const A = HORIZON.active;
  if (f < A - 1) return;
  const age = f - (A - 1);
  if (age > 3) return;
  const half = (HORIZON.sweep * DEG) / 2;
  arcLine(frame, { radius: HORIZON.R + 3 + age * 3, from: -half + age * 0.25, to: half + 0.05, width: 2 - age * 0.3, bright: 0.85 - age * 0.15 });
}

/** 溜め斬り: 帯に加えて、振り切りの前方へ広がる衝撃の弧（重さの余波） */
function chargeSlash(frame, f) {
  heavySwing(frame, f, CHARGE);
  const A = CHARGE.active;
  if (f < A - 1) return;
  const age = f - (A - 1);
  if (age > 3) return;
  const half = (CHARGE.sweep * DEG) / 2;
  arcLine(frame, { radius: CHARGE.R + 8 + age * 6, from: -half * 0.55, to: half * 0.85, width: 2.2 - age * 0.25, bright: 0.72 - age * 0.1 });
}

// -----------------------------------------------------------------------------
// 旋風（左 4 段・ダッシュ・回り斬り・車輪斬り）
// -----------------------------------------------------------------------------

/**
 * 旋風の 1 フレーム。1 本の分厚い帯が turns 周まわり、外周に風圧の線、振り切りで周りの床から砂煙。
 * 向きの無い円なので dirs 1（画面の右から回り始める）
 */
function whirl(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const start = -Math.PI / 2;
  const total = spec.turns * TAU;
  let head;
  let trail;
  let erosion = 0;
  let bright = 1;
  let k = 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = start + total * p;
    trail = Math.min(spec.trail, total * p);
    bright = 0.88 + 0.12 * p;
  } else {
    k = (f - A + 1) / (N - A + 1);
    head = start + total + 0.9 * Math.sin(k * Math.PI * 0.5);
    trail = spec.trail * (1 - 0.65 * k);
    erosion = 0.05 + 0.82 * Math.pow(k, 1.2);
    bright = 1 - 0.3 * k;
  }
  // 多段の当たり（車輪斬り）: 周回の区切りで帯が一瞬明るくなる
  const flash = (spec.flashes ?? []).includes(f) ? 1.12 : 1;
  heavyBand(frame, { R: spec.R, T: spec.T * (1 - 0.35 * k), head, tail: head - trail, erosion, bright: bright * flash, seed: spec.seed, peak: 0.3, cap: 0.06 });
  windLines(frame, head, { R: spec.R, count: spec.wind, seed: spec.seed + 20, k });
  if ((spec.flashes ?? []).includes(f) || f === A - 1) sparkle(frame, Math.cos(head) * (spec.R - 3), Math.sin(head) * (spec.R - 3), f === A - 1 ? 4 : 3);
  if (f < A - 1) return;
  const age = f - (A - 1);
  // 周りの床から砂煙: 輪の外周に沿って、外へ押し出される
  const life = N - A + 1;
  if (age <= life) {
    const puffs = [];
    for (let i = 0; i < spec.dust; i++) {
      const a = (i / spec.dust) * TAU + hash1(i, spec.seed + 30) * 0.5;
      const r = spec.R * 0.82 + age * 3.5 * (0.6 + 0.6 * hash1(i, spec.seed + 31));
      const rx = spec.dustSize * (0.6 + 0.4 * hash1(i, spec.seed + 32)) * (0.8 + age * 0.14);
      puffs.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62 + spec.R * 0.12 - age * 0.6, rx, ry: rx * 0.5, v: 0.4 * (1 - (age / (life + 1)) * 0.6) });
    }
    dustCloud(frame, puffs, Math.max(0, age / (life + 1) - 0.2) * 1.1, spec.seed + 33);
  }
  pebbles(frame, age, spec.pebbles, spec.seed + 40, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = spec.R - spec.T * 0.5;
    const sp = 3.5 + rnd(2) * 3;
    // 回転の接線（時計回り）と外向きを混ぜる
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (-Math.sin(a) * 0.6 + Math.cos(a) * 0.6) * sp, vy: (Math.cos(a) * 0.6 + Math.sin(a) * 0.6) * sp, life: 3 + Math.floor(rnd(3) * 2), big: rnd(4) > 0.5 };
  });
}

/** 左 4 段（circle size 60・heavy）: 1 周の大旋風。帯が厚く、周りの砂煙が多い */
const L4 = { R: 60, T: 34, turns: 1, trail: 4.2, frames: 10, active: 5, wind: 4, dust: 9, dustSize: 11, pebbles: 10, seed: 2101 };
/** ダッシュ攻撃（circle size 44）: 駆け抜けながらの小さめの 1 周。帯は細め、風の線が主役 */
const DASH = { R: 44, T: 22, turns: 1, trail: 3.6, frames: 8, active: 4, wind: 3, dust: 6, dustSize: 8, pebbles: 5, seed: 2202 };
/** 回り斬り（circle size 64）: いちばん大きな旋風。長い尾と多い風圧の線 */
const WHIRL = { R: 64, T: 30, turns: 1.25, trail: 5, frames: 10, active: 5, wind: 5, dust: 10, dustSize: 11, pebbles: 10, seed: 2303 };
/** 車輪斬り（circle size 60・2 段ヒット）: 2 周。周回ごとに明滅し、帯は短く速い */
const WHEEL = { R: 60, T: 28, turns: 2, trail: 3.2, frames: 10, active: 6, wind: 4, dust: 8, dustSize: 10, pebbles: 8, flashes: [2, 5], seed: 2404 };

// -----------------------------------------------------------------------------
// 叩きつけ（叩き伏せ・兜割り）と突き崩し
// -----------------------------------------------------------------------------

/**
 * 真上から落ちる刃の帯（上から見た叩きつけ）。後ろ（x0）は細く、前（x1）ほど太く、前端は丸く鈍い。
 * 剣のレンズ形（両端が尖る）と違い、重さが前に乗った「鉄の板」に見せる
 */
function slab(frame, o) {
  const { x0, x1, W } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const len = Math.max(1, x1 - x0);
  paint(
    frame,
    (x, y) => {
      if (x < x0) return -1;
      const t = Math.min(1, (x - x0) / len);
      const w = W * (0.25 + 0.75 * Math.pow(t, 0.55));
      // 前端の丸み: 前端から w の範囲は円で削る
      const cx = x1 - W;
      const ay = Math.abs(y);
      if (x > cx && Math.hypot((x - cx) / W, y / W) > 1) return -1;
      if (ay > w) return -1;
      const q = ay / w;
      if (!survivesChunky(x, y, erosion, 1 - q, o.seed ?? 1)) return -1;
      if (w - ay < 1.8) return 0.17 * bright + 0.03;
      const band = Math.floor(ay / 3);
      return clamp01((1 - q) ** 0.5 * (0.55 + 0.45 * t) * (0.9 + 0.12 * hash1(band, o.seed ?? 1)) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x0 - 2, y0: -W - 2, x1: x1 + 2, y1: W + 2 } },
  );
}

/** 縦の叩きつけの帯を、中心線で割る（叩き割った裂け目） */
function splitLine(frame, x0, x1, width) {
  paint(
    frame,
    (x, y) => (x >= x0 && x <= x1 && Math.abs(y) <= width / 2 ? 0 : -1),
    { bounds: { x0, y0: -width, x1, y1: width }, mode: "erase", samples: 2 },
  );
}

/**
 * 派生: 叩き伏せ（box reach 26 / size 36・当たりの中心に置く）。真上から落ちる幅広の帯が床を叩き、
 * 帯が割れ、楕円の衝撃の輪・放射の亀裂・左右の砂煙・石礫
 */
function slam(frame, f) {
  const A = 3;
  const N = 10;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const back = -44;
  const front = 32;
  if (k < 0.8) {
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    const W = (f < A ? 17 + f * 4 : 25) * (1 - k * 0.4);
    slab(frame, { x0: back, x1: back + (front - back) * grow, W, erosion: k * 0.95, seed: 3101, bright: 1 - k * 0.2 });
    if (f === A - 1) streakLine(frame, { ax: back + 20, ay: 0, bx: front - 6, by: 0, width: 1.4, bright: 1 });
    if (f >= A) splitLine(frame, back, front, 2 + k * 5);
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  if (age === 0) sparkle(frame, 4, 0, 4);
  // 地面の楕円の輪 2 枚（内側は遅れて）
  groundRing(frame, { x: 4, y: 0 }, { radius: 16 + age * 8, width: 4.4 - age * 0.3, erosion: Math.min(0.9, age * 0.13), bright: 0.78 - age * 0.06, seed: 3102 });
  if (age >= 2) groundRing(frame, { x: 4, y: 0 }, { radius: 8 + (age - 2) * 5, width: 2.6, erosion: Math.min(0.9, (age - 2) * 0.18), bright: 0.55 - age * 0.04, seed: 3103 });
  // 放射の亀裂（床に残る。最後まで薄く残して崩す）
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + (hash1(i, 3104) - 0.5) * 0.6;
    paths.push(crackPath(4, 0, a, 18 + hash1(i, 3105) * 16, 3106 + i * 7));
  }
  cracks(frame, paths, Math.min(1, (age + 1) / 2), Math.max(0, (age - 3) / 5), 3107);
  dustBurst(frame, { x: 4, y: 0 }, age, { n: 8, spread: 32, size: 13, life: N - A + 1, seed: 3108, v: 0.42 });
  pebbles(frame, age, 12, 3109, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3.5 + rnd(2) * 4;
    return { x: 4 + Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), big: rnd(4) > 0.45 };
  });
}

/**
 * 派生: 兜割り（box reach 24 / size 30・当たりの中心）。細く長い縦の一撃が、当たった瞬間に左右へ大きく割れ開く。
 * 前へ走る 1 本の深い亀裂と小さな輪（叩き伏せの「面」に対して「線」で割る）
 */
function helmSplitter(frame, f) {
  const A = 3;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const back = -42;
  const front = 36;
  if (f < A) {
    const grow = easeSwing((f + 1) / A);
    slab(frame, { x0: back, x1: back + (front - back) * grow, W: 9 + f * 2, seed: 3201 });
    streakLine(frame, { ax: back + 16, ay: 0, bx: back + (front - back) * grow - 6, by: 0, width: 1.3, bright: 1 });
  } else if (k < 0.85) {
    // 細い帯が中心で割れ、裂け目が大きく開いて崩れる（叩き伏せより深く割る）
    slab(frame, { x0: back + k * 16, x1: front, W: 13 * (1 - k * 0.2), erosion: k * 0.9, seed: 3202, bright: 0.98 - k * 0.25 });
    splitLine(frame, back, front, 3 + k * 11);
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  if (age <= 1) sparkle(frame, 0, 0, age === 0 ? 4 : 3);
  groundRing(frame, { x: 0, y: 0 }, { radius: 8 + age * 5, width: 3, erosion: Math.min(0.9, age * 0.16), bright: 0.7 - age * 0.06, seed: 3203 });
  const paths = [crackPath(front - 4, 0, 0, 34, 3204), crackPath(back + 4, 0, Math.PI, 16, 3205), crackPath(front + 10, 0, 0.9, 12, 3206), crackPath(front + 18, 0, -0.8, 11, 3207)];
  cracks(frame, paths, Math.min(1, (age + 1) / 2.5), Math.max(0, (age - 3) / 4), 3208);
  dustBurst(frame, { x: 0, y: 0 }, age, { n: 6, spread: 28, size: 10, life: N - A + 1, seed: 3209 });
  pebbles(frame, age, 9, 3210, (i, rnd) => {
    // 割れ目の両脇から、横（割れ開く向き）へ
    const side = rnd(1) > 0.5 ? 1 : -1;
    const sp = 3 + rnd(2) * 3.5;
    return { x: -10 + rnd(3) * 40, y: side * 4, vx: (rnd(4) - 0.3) * 2, vy: side * sp, life: 3 + Math.floor(rnd(5) * 2), big: rnd(6) > 0.5 };
  });
}

/**
 * 派生: 突き崩し（thrust reach 42・自分の中心）。太い楔が前へ押し出され、先端の前に重い衝撃（潰れた輪 2 枚と前への石礫）、
 * 踏み込んだ足元に砂煙
 */
function breakThrust(frame, f) {
  const A = 3;
  const N = 8;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const tip = 20 + 64 * p + k * 4;
  const base = 8 + k * 30;
  const W = 17 * (1 - k * 0.35);
  if (k < 0.9) {
    paint(
      frame,
      (x, y) => {
        if (x < base || x > tip) return -1;
        const t = (x - base) / Math.max(1, tip - base);
        // 楔: 根元が太く、先へ直線的に細る（先端は鈍く 2 ドット残す）
        const w = W * Math.pow(1 - t, 0.8) + 1.2;
        const ay = Math.abs(y);
        if (ay > w) return -1;
        if (!survivesChunky(x, y, k * 0.95, 1 - ay / w, 3301)) return -1;
        if (ay < 0.8 && t > 0.15 && k < 0.5) return 1;
        if (w - ay < 1.8) return 0.17;
        return clamp01((1 - ay / w) ** 0.6 * (0.55 + 0.4 * t) * (1 - k * 0.4));
      },
      { bounds: { x0: base - 2, y0: -W - 3, x1: tip + 2, y1: W + 3 } },
    );
  }
  // 両脇の速度線（楔の外だけ）
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (W + 4 + Math.floor(i / 2) * 4);
    const x1 = tip - 22 - hash1(i, 3302) * 12 - k * 18;
    if (k < 0.8) streakLine(frame, { ax: x1 - 22 - hash1(i, 3303) * 16, ay: y, bx: x1, by: y, width: 1.3, bright: 0.55 * (1 - k) });
  }
  if (f === A - 1) sparkle(frame, tip - 2, 0, 4);
  if (f < A - 1) return;
  const age = f - (A - 1);
  ring(frame, { ox: tip + 4 + age * 3, radius: 10 + age * 5, width: 4.4 - age * 0.35, squash: 0.5, erosion: Math.min(0.9, age * 0.16), bright: 0.8 - age * 0.07, seed: 3304 });
  if (age >= 1) ring(frame, { ox: tip + 20 + age * 4, radius: 6 + age * 3, width: 2, squash: 0.45, erosion: Math.min(0.9, age * 0.2), bright: 0.6 - age * 0.06, seed: 3305 });
  dustBurst(frame, { x: 6, y: 0 }, age, { n: 5, spread: 20, size: 9, life: N - A + 1, seed: 3306 });
  pebbles(frame, age, 10, 3307, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.3;
    const sp = 4 + rnd(2) * 4;
    return { x: tip, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), big: rnd(5) > 0.5 };
  });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中: 刃の進む向き（+x）の太い裂け目が中央で断ち割れ、角ばった破片が飛ぶ（剣の光る刃片と見分ける）。
 * heavy は大きく、衝撃の輪 2 枚と砂煙が付く
 */
function hit(frame, f, heavy) {
  const N = heavy ? 8 : 6;
  const L = heavy ? 40 : 28;
  const T0 = heavy ? 28 : 20;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const T = T0 * (f === 0 ? 0.75 : 1 - k * 0.5);
  if (k < 0.9) {
    lens(frame, { ax: -L * grow, ay: 0, bx: L * grow, by: 0, T, bias: 0, erosion: k * 0.95, seed: heavy ? 4101 : 4201 });
    // 断ち割り: 中央の線を抜いて、上下 2 片に割れる
    if (f >= 1) splitLine(frame, -L, L, 2 + k * (heavy ? 9 : 6));
  }
  if (f <= 1) sparkle(frame, 0, 0, heavy ? 4 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 14 + age * 7, width: 3.6 - age * 0.3, erosion: Math.min(0.9, age * 0.15), bright: 0.66 - age * 0.07, seed: 4102 });
    if (age >= 1) ring(frame, { radius: 6 + age * 4, width: 2, erosion: Math.min(0.9, age * 0.2), bright: 0.55 - age * 0.05, seed: 4103 });
    dustBurst(frame, { x: 0, y: 0 }, age - 1, { n: 5, spread: 26, size: 10, life: N - 2, seed: 4104 });
  }
  if (f >= 1) {
    pebbles(frame, f - 1, heavy ? 12 : 7, heavy ? 4105 : 4205, (i, rnd) => {
      // 刃の進む向きに多く、残りは割れ開く上下へ
      const forward = rnd(1) > 0.4;
      const a = forward ? (rnd(2) - 0.5) * 1.0 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 0.7);
      const sp = (heavy ? 4.5 : 3.5) + rnd(4) * (heavy ? 4 : 2.5);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), big: heavy ? rnd(6) > 0.35 : rnd(6) > 0.5 };
    });
  }
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "greatsword",
  motions: {
    "l:0": { sheet: "greatsword.l1", pivot: "self", base: 30, measure: "reach" },
    "l:1": { sheet: "greatsword.l2", pivot: "self", base: 30, measure: "reach" },
    "l:2": { sheet: "greatsword.l3", pivot: "self", base: 32, measure: "reach" },
    "l:3": { sheet: "greatsword.l4", pivot: "self", base: 60, measure: "size" },
    dash: { sheet: "greatsword.dash", pivot: "self", base: 44, measure: "size" },
    "r:sweep": { sheet: "greatsword.sweep", pivot: "self", base: 36, measure: "reach" },
    "r:gsUpswing": { sheet: "greatsword.upswing", pivot: "self", base: 32, measure: "reach" },
    "r:gsWhirl": { sheet: "greatsword.whirl", pivot: "self", base: 64, measure: "size" },
    "r:gsSlam": { sheet: "greatsword.slam", pivot: "anchor", base: 26, measure: "reach" },
    "branch:helmSplitter": { sheet: "greatsword.helm", pivot: "anchor", base: 24, measure: "reach" },
    "branch:gsHorizon": { sheet: "greatsword.horizon", pivot: "self", base: 34, measure: "reach" },
    "branch:gsWheel": { sheet: "greatsword.wheel", pivot: "self", base: 60, measure: "size" },
    "branch:gsBreak": { sheet: "greatsword.break", pivot: "self", base: 42, measure: "reach" },
    charge: { sheet: "greatsword.charge", pivot: "self", base: 34, measure: "reach" },
  },
  hit: "greatsword.hit",
  hitHeavy: "greatsword.hitHeavy",
};

/** 弧のシートの作業面（砂煙が外へ広がる分の余白を足す） */
function swingSheet(key, spec, draw) {
  const size = Math.ceil(spec.R + 30) * 2;
  return { key, dirs: spec.sweep >= WIDE_SWEEP ? WIDE_DIRS : DIRS, frames: spec.frames, active: spec.active, size, draw: draw ?? ((frame, f) => heavySwing(frame, f, spec)) };
}

function whirlSheet(key, spec) {
  return { key, dirs: 1, frames: spec.frames, active: spec.active, size: Math.ceil(spec.R + 40) * 2, draw: (frame, f) => whirl(frame, f, spec) };
}

export const ATLAS = {
  key: "greatsword",
  fx: FX,
  sheets: [
    swingSheet("greatsword.l1", L1),
    swingSheet("greatsword.l2", L2),
    swingSheet("greatsword.l3", L3),
    swingSheet("greatsword.sweep", SWEEP),
    swingSheet("greatsword.upswing", UPSWING),
    swingSheet("greatsword.horizon", HORIZON, horizonSlash),
    swingSheet("greatsword.charge", CHARGE, chargeSlash),
    whirlSheet("greatsword.l4", L4),
    whirlSheet("greatsword.dash", DASH),
    whirlSheet("greatsword.whirl", WHIRL),
    whirlSheet("greatsword.wheel", WHEEL),
    { key: "greatsword.slam", dirs: DIRS, frames: 10, active: 3, size: 160, draw: slam },
    { key: "greatsword.helm", dirs: DIRS, frames: 9, active: 3, size: 150, draw: helmSplitter },
    { key: "greatsword.break", dirs: DIRS, frames: 8, active: 3, size: 264, draw: breakThrust },
    { key: "greatsword.hit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: (frame, f) => hit(frame, f, false) },
    { key: "greatsword.hitHeavy", dirs: DIRS, frames: 8, active: 0, size: 128, draw: (frame, f) => hit(frame, f, true) },
  ],
};
