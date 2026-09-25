// エフェクトの形の部品（正準座標。raster.mjs の paint / stamp で塗る）。docs/ideas/fx-sprites.md 3 章
// 武器・スキルのシートはこれを組み合わせ、数値（半径・太さ・振り幅・時間の割り付け）を 1 つずつ詰める
import { clamp01, dot, glint, hash1, paint, segment, smoothstep, valueNoise, wrapAngle } from "./raster.mjs";

/** 弧（中心 ox, oy・半径 r0..r1・角 a0..a1）の外接矩形。paint の bounds に渡して調べる範囲を絞る */
export function arcBounds(ox, oy, r0, r1, a0, a1) {
  const angles = [a0, a1];
  for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) angles.push(k * (Math.PI / 2));
  const xs = [];
  const ys = [];
  for (const a of angles) {
    for (const r of [r0, r1]) {
      xs.push(ox + Math.cos(a) * r);
      ys.push(oy + Math.sin(a) * r);
    }
  }
  return { x0: Math.min(...xs) - 2, y0: Math.min(...ys) - 2, x1: Math.max(...xs) + 2, y1: Math.max(...ys) + 2 };
}

/**
 * 三日月の太さの輪郭。u = 0 が先端（尖る）、peak で最も太く、1 で尾（細く消える）
 */
export function crescentWidth(u, peak = 0.18, power = 0.75) {
  if (u < 0 || u > 1) return 0;
  const k = u < peak ? (0.5 * u) / peak : 0.5 + (0.5 * (u - peak)) / (1 - peak);
  return Math.pow(Math.sin(Math.PI * k), power);
}

/** 崩れ（0..1）の判定。ノイズと「芯からの近さ」で、尾と内側の縁から先に欠ける */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 弧の三日月（振りの軌跡）。中心 (ox, oy)、外縁の半径 R、最大の太さ T。
 * head = 先端の角、tail = 尾の端の角（時計回りに振るので head > tail）。
 * 外縁の先端寄りが白い芯になり、内側の縁と尾ほど暗い。streak で円周方向の筋、erosion で崩れる
 */
export function crescent(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const streak = o.streak ?? 0.35;
  const peak = o.peak ?? 0.18;
  const edge = o.edge ?? 1.6;
  const edgeReach = o.edgeReach ?? 0.6;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R) return -1;
      const s = wrapAngle(head - Math.atan2(dy, dx));
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      const w = T * crescentWidth(u, peak);
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      // 外縁の 1.5 ドットは刃の縁（白い芯）。先端側 6 割だけ光らせ、尾は色の帯に溶かす
      if (R - r < edge && u < edgeReach && erosion < 0.5) return clamp01(bright * (1.05 - 0.3 * u));
      const band = Math.floor((R - r) / 1.6);
      const grain = q > 0.22 ? 1 - streak / 2 + streak * hash1(band, seed) : 1;
      return clamp01(Math.pow(1 - q, 0.95) * (0.92 - 0.5 * u) * grain * bright * (1 - erosion * 0.45));
    },
    { bounds: arcBounds(ox, oy, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/**
 * 弧に沿う 1px の速度線。radius の円周上、角 from → to（to が先端側）。先端側ほど明るい
 */
export function arcLine(frame, o) {
  const { radius, from, to } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = Math.max(1e-3, to - from);
  const width = o.width ?? 1;
  const hi = o.bright ?? 0.55;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (Math.abs(r - radius) > width / 2) return -1;
      const f = wrapAngle(Math.atan2(dy, dx) - from) / span;
      if (f < 0 || f > 1) return -1;
      return hi * (0.35 + 0.65 * f);
    },
    { bounds: arcBounds(ox, oy, radius - width, radius + width, from, to), dither: 0, samples: 2 },
  );
}

/**
 * レンズ形の斬線（両端が尖り中央が太い一本の線）。(ax, ay) → (bx, by)、最大の太さ T、bend で弓なりに反る。
 * grow（0..1）で a から b へ伸び、erosion で崩れる。芯は中央線の片側（bias の側）に寄る
 */
export function lens(frame, o) {
  const { ax, ay, bx, by, T } = o;
  const grow = o.grow ?? 1;
  const bend = o.bend ?? 0;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 3;
  const bright = o.bright ?? 1;
  const bias = o.bias ?? 0.25;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const nx = -ty;
  const ny = tx;
  const pad = T + Math.abs(bend) + 2;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const along = px * tx + py * ty;
      const f = along / len;
      if (f < 0 || f > grow) return -1;
      const center = bend * 4 * f * (1 - f);
      const across = px * nx + py * ny - center;
      // 伸びている途中は、今の先端が尖るように輪郭を grow で詰める
      const g = grow < 1 ? f / grow : f;
      const w = T * Math.pow(Math.sin(Math.PI * g), 0.7) * 0.5;
      if (w < 0.5) return -1;
      const q = (across + bias * w) / w;
      const aq = Math.abs(q);
      if (Math.abs(across) > w) return -1;
      if (!survives(x, y, erosion, 1 - Math.min(1, aq), seed)) return -1;
      return clamp01((1 - Math.min(1, aq)) ** 1.1 * (0.55 + 0.45 * Math.sin(Math.PI * g)) * bright * (1 - erosion * 0.5));
    },
    {
      bounds: {
        x0: Math.min(ax, bx) - pad,
        y0: Math.min(ay, by) - pad,
        x1: Math.max(ax, bx) + pad,
        y1: Math.max(ay, by) + pad,
      },
    },
  );
}

/** 直線の速度線（1px）。a → b、b 側が明るい */
export function streakLine(frame, o) {
  const { ax, ay, bx, by } = o;
  const width = o.width ?? 1;
  const hi = o.bright ?? 0.5;
  const pad = width + 2;
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, ax, ay, bx, by);
      if (s.d > width / 2) return -1;
      return hi * (0.3 + 0.7 * s.t);
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0 },
  );
}

/** 輪（衝撃波）。半径 radius、太さ width、erosion で欠ける。squash で進行方向に潰した楕円 */
export function ring(frame, o) {
  const { radius, width } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.6;
  const seed = o.seed ?? 5;
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = (x - ox) / squash;
      const dy = y - oy;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: ox - pad * squash, y0: oy - pad, x1: ox + pad * squash, y1: oy + pad } },
  );
}

/**
 * 飛び散る刃片・火花。count 個を seed で決め、age（フレーム）に応じて動かす。
 * spawn(i) → {x, y, vx, vy, life, size}（正準座標・1 フレームあたりの移動）を返す関数で散り方を決める
 */
export function shards(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 13 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const t = age;
    const drag = s.drag ?? 0.86;
    // 等比で減速する移動の累積（1 + d + d^2 + … + d^(t-1)）
    const travel = drag === 1 ? t : (1 - Math.pow(drag, t)) / (1 - drag);
    const x = s.x + s.vx * travel;
    const y = s.y + s.vy * travel;
    const fade = 1 - age / (s.life + 1);
    const level = Math.max(2, Math.round(3 + 4 * fade * (s.bright ?? 1)));
    if ((s.size ?? 1) >= 2 && fade > 0.45) {
      // 尾を 1 ドット引いた刃片
      dot(frame, x, y, level);
      dot(frame, x - s.vx * 0.5, y - s.vy * 0.5, Math.max(1, level - 2));
      dot(frame, x + 0.8, y, Math.max(1, level - 1));
    } else {
      dot(frame, x, y, level);
    }
  }
}

/** 光点（画面に揃った十字）。size 1〜4 */
export function sparkle(frame, x, y, size) {
  glint(frame, x, y, size);
}

/** 振りの進み（0..1）を「振り始めは速く、終わりで粘る」に */
export function easeSwing(p) {
  return 1 - Math.pow(1 - clamp01(p), 2.2);
}

export { smoothstep };
