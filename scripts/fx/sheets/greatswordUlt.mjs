// 大剣（moveset "greatsword"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs、形の言葉は greatsword.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/greatsword.json × 2 が目安
//
// 大剣の絵の芯（greatsword.mjs と同じ言葉を、奥義では大きく・長く・崩れの段を多くする）:
// - 弧は先の丸く鈍い「分厚い帯」。いちばん太いのは刃の腹。内縁に段 2 の縁取り、白は外縁の細い線だけ
// - 剣の光る刃片ではなく、床の砂煙（画面に水平な低い塊）・角ばった石礫・地面の輪・亀裂で重さを見せる
// - 1 回の振りは 1 本の帯（断罪の衝撃の弧は帯の外へ離れて走る余波で、帯に重ねない）
// 3 本の描き分け: 断罪 = 金の光（light）の超大弧と天からの光柱の発動 / 巨人の膂力 = 鋼（steel）の踏み鳴らしと浮かぶ岩 /
// 地割り = 真鍮（brass）の土色で、床を割って這い進む 3 本の岩の波
import { arcBounds, arcLine, easeSwing, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, stamp, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾（地を這う波）の方向数。24 方向だと斜めの帯の角が目立つ */
const FLY_DIRS = 32;
/** キャラの足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 共通の部品（greatsword.mjs の形を写し、奥義の大きさで使えるようにしたもの）
// -----------------------------------------------------------------------------

/** 角の差を [0, 2π) に */
function ahead(head, a) {
  const d = (head - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 正準座標 → 画面に揃った座標。床のもの（砂煙・地面の輪）は向きで回らない */
function toScreen(frame, x, y) {
  return { x: x * frame.cos - y * frame.sin, y: x * frame.sin + y * frame.cos };
}

/** 画面座標 → 正準座標 */
function toCanon(frame, sx, sy) {
  return { x: sx * frame.cos + sy * frame.sin, y: -sx * frame.sin + sy * frame.cos };
}

/** 崩れの判定。大きなセルのノイズで、塊ごとにごろっと欠ける（大剣の崩れ） */
function survivesChunky(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 7, seed) * 0.45 + valueNoise(x + y * 0.5, y - x * 0.5, 4.5, seed + 7) * 0.37;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/** 分厚い帯の太さの輪郭。u = 0 が先端（丸く鈍い）、peak（刃の腹）で最も太い */
function heavyWidth(u, peak, cap) {
  if (u < 0 || u > 1) return 0;
  if (u < cap) {
    const t = 1 - u / cap;
    return 0.72 * (0.55 + 0.45 * Math.sqrt(1 - t * t));
  }
  if (u < peak) return 0.72 + 0.28 * Math.sin(((u - cap) / (peak - cap)) * (Math.PI / 2));
  return Math.pow(1 - (u - peak) / (1 - peak), 0.75);
}

/** 大剣の分厚い弧の帯（1 回の振りに 1 本）。外縁は白い細い刃の縁、内縁は段 2 の縁取り、半径方向の粗い筋 */
function heavyBand(frame, o) {
  const { R, T, head, tail } = o;
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
      const r = Math.hypot(x, y);
      if (r > R) return -1;
      const u = ahead(head, Math.atan2(y, x)) / span;
      if (u > 1) return -1;
      const w = T * heavyWidth(u, peak, cap);
      if (w < 0.8) return -1;
      const d = R - r;
      const q = d / w;
      if (q > 1) return -1;
      if (!survivesChunky(x, y, erosion, (1 - q) * (1 - u * 0.7), seed)) return -1;
      if (d < rim && u < 0.7 && erosion < 0.45) return clamp01(bright * (1.06 - 0.3 * u));
      if (w - d < 2.4) return clamp01(0.15 * bright + 0.04);
      const band = Math.floor(d / 3.6);
      const grain = 0.86 + 0.2 * hash1(band, seed);
      return clamp01(Math.pow(1 - q, 0.55) * (0.9 - 0.42 * u) * grain * bright * (1 - erosion * 0.4));
    },
    { bounds: arcBounds(0, 0, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/** 砂煙の塊（画面に水平な低い楕円の粒）。puffs は画面座標 {x, y, rx, ry, v}。段 1〜3 だけ */
function dustCloud(frame, puffs, erosion, seed) {
  if (puffs.length === 0) return;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of puffs) {
    const c = toCanon(frame, p.x, p.y);
    const m = Math.max(p.rx, p.ry) + 3;
    x0 = Math.min(x0, c.x - m);
    y0 = Math.min(y0, c.y - m);
    x1 = Math.max(x1, c.x + m);
    y1 = Math.max(y1, c.y + m);
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
        const d0 = dx * dx + dy * dy;
        if (d0 > 1.45) continue;
        if (Number.isNaN(wobble)) wobble = (valueNoise(s.x, s.y, 4, seed) - 0.5) * 0.4;
        const d = Math.sqrt(d0) + wobble;
        if (d > 1) continue;
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

/** 1 か所から左右へ広がる砂煙。center は正準座標、age は発生からのフレーム */
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
    puffs.push({ x: c.x + dir * dist, y: c.y + (hash1(i, seed + 3) - 0.35) * size * 0.5 - age * 0.6, rx, ry: rx * 0.6, v: (o.v ?? 0.4) * (1 - k * 0.6) });
  }
  dustCloud(frame, puffs, Math.max(0, k - 0.25) * 1.1, seed);
}

/** 石礫の形（画面に揃った角ばった塊）。hi は上面の段 */
function pebbleAt(frame, x, y, hi, big) {
  const lo = Math.max(1, hi - 2);
  const pattern = big ? [`.${hi}${hi - 1}`, `${hi}${hi - 1}${lo}`, `.${lo}${lo}`] : [`${hi}${hi - 1}`, `${hi - 1}${lo}`];
  stamp(frame, x, y, pattern);
}

/** 石礫（減速して飛ぶ）。spawn(i, rnd) → {x, y, vx, vy, life, big, drag?, fall?}（正準座標）。fall は画面の下への重さ */
function pebbles(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const p = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!p || age < 0 || age > p.life) continue;
    const drag = p.drag ?? 0.8;
    const travel = drag === 1 ? age : (1 - Math.pow(drag, age)) / (1 - drag);
    let x = p.x + p.vx * travel;
    let y = p.y + p.vy * travel;
    if (p.fall) {
      // 画面の下へ落ちる重さ（打ち上げた岩が弧を描いて戻る）
      const g = toCanon(frame, 0, p.fall * age * age);
      x += g.x;
      y += g.y;
    }
    const fade = 1 - age / (p.life + 1);
    pebbleAt(frame, x, y, fade > 0.55 ? 5 : 4, p.big && fade > 0.3);
  }
}

/** 地面の楕円の輪（画面に揃う）。中心は正準座標 */
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
      const wv = (width / 2) * (0.55 + 0.45 * Math.abs(dx) / Math.max(1, Math.hypot(dx, dy)));
      if (dd > wv / squash ** 0.35) return -1;
      const q = dd / wv;
      if (erosion > 0 && valueNoise(s.x, s.y, 5, seed) * 0.8 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      return clamp01(bright * (1 - 0.45 * q) * (dy > 0 ? 1 : 0.78) * (1 - erosion * 0.4));
    },
    { bounds: { x0: center.x - m, y0: center.y - m, x1: center.x + m, y1: center.y + m }, samples: 2 },
  );
}

/** 亀裂の折れ線（正準座標）。原点 (cx, cy)・角 a・長さ len。jag で横の揺れ、flat で縦を潰す（画面に置いた床の亀裂） */
function crackPath(cx, cy, a, len, seed, o = {}) {
  const n = o.n ?? 5;
  const jag = o.jag ?? 7;
  const flat = o.flat ?? 1;
  const pts = [{ x: cx, y: cy }];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const j = (hash1(i, seed) - 0.5) * jag * (i < n ? 1 : 0.4);
    const aa = a + (hash1(i, seed + 1) - 0.5) * 0.25;
    const px = Math.cos(aa) * len * t - Math.sin(aa) * j;
    const py = Math.sin(aa) * len * t + Math.cos(aa) * j;
    pts.push({ x: cx + px, y: cy + py * flat });
  }
  return pts;
}

/** 亀裂: 細い割れ目（根元は段 3、先は段 2）。grow で伸び、erosion で薄れる。width で太さ */
function cracks(frame, paths, grow, erosion, seed, o = {}) {
  const width = o.width ?? 1.5;
  const hi = o.hi ?? 0.36;
  const lo = o.lo ?? 0.24;
  for (let ci = 0; ci < paths.length; ci++) {
    const pts = paths[ci];
    const segs = pts.length - 1;
    const upto = segs * clamp01(grow);
    if (upto <= 0) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x - width - 3);
      y0 = Math.min(y0, p.y - width - 3);
      x1 = Math.max(x1, p.x + width + 3);
      y1 = Math.max(y1, p.y + width + 3);
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
        const w = width * (1 - along * 0.5);
        if (best > w) return -1;
        if (erosion > 0 && valueNoise(x, y, 4, seed + ci) + (1 - along) * 0.3 - erosion * 1.1 < 0) return -1;
        return along < 0.2 ? hi : lo;
      },
      { bounds: { x0, y0, x1, y1 }, dither: 0, samples: 2 },
    );
  }
}

/**
 * 岩の棘（床から突き出た三角の岩）。根元 (x, y) から角 a へ len、根元の半幅 w。
 * 左の面（-y の側）が明るく右の面が暗い: 上から見た尖った岩の稜線。先端の 2 ドットだけ段 6
 */
function rockSpike(frame, o) {
  const { x: bx, y: by, a, len, w } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  if (len < 2 || w < 1) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pad = Math.max(len, w) + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - bx;
      const dy = y - by;
      const along = dx * c + dy * s;
      const side = -dx * s + dy * c;
      if (along < 0 || along > len) return -1;
      const t = along / len;
      const half = w * (1 - t);
      if (Math.abs(side) > half) return -1;
      const q = Math.abs(side) / Math.max(0.5, half);
      if (!survivesChunky(x, y, erosion, 1 - t * 0.6, seed)) return -1;
      if (t > 0.82 && erosion < 0.3) return clamp01(0.86 * bright);
      // 稜線（中央）を境に、左面は明るく右面は暗い
      const face = side < 0 ? 0.68 - 0.18 * q : 0.44 - 0.14 * q;
      if (half - Math.abs(side) < 1.2) return clamp01(0.18 * bright + 0.03);
      return clamp01((face + 0.12 * t) * bright * (1 - erosion * 0.35));
    },
    { bounds: { x0: bx - pad, y0: by - pad, x1: bx + pad, y1: by + pad } },
  );
}

// -----------------------------------------------------------------------------
// 断罪（swing arc 240° reach 60・heavy）: 溜め切った超大の分厚い帯が前方を薙ぎ、床に弧の溝を刻む
// -----------------------------------------------------------------------------

/** 断罪の帯の外縁の半径（reach 60 × 2）と太さ。通常の溜め斬り（R 84 / T 62）より一回り大きい */
const JUDG = { R: 120, T: 80, sweep: 240, frames: 12, active: 5, tailLen: 0.95, overshoot: 0.04, peak: 0.46, seed: 5101 };

/** 振りの時間割（greatsword.mjs の swingPose と同じ考え） */
function judgmentPose(f) {
  const s = JUDG;
  const half = (s.sweep * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const A = s.active;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    return { from, sweep, head: from + sweep * p, tail: from + sweep * Math.max(0, p - s.tailLen) * 0.5, erosion: 0, bright: 0.88 + 0.2 * p, k: 0, T: s.T * (0.72 + 0.28 * ((f + 1) / A)) };
  }
  const k = (f - A + 1) / (s.frames - A);
  return {
    from,
    sweep,
    head: from + sweep * (1 + s.overshoot * k),
    tail: from + sweep * Math.min(0.97, 1 - s.tailLen + (s.tailLen - 0.05) * Math.pow(k, 0.8)),
    erosion: 0.04 + 0.86 * Math.pow(k, 1.8),
    bright: 1.08 - 0.32 * k,
    k,
    T: s.T * (1 - 0.4 * k),
  };
}

function judgmentSlash(frame, f) {
  const A = JUDG.active;
  const s = judgmentPose(f);
  heavyBand(frame, { R: JUDG.R, T: s.T, head: s.head, tail: s.tail, erosion: s.erosion, bright: s.bright, seed: JUDG.seed, peak: JUDG.peak, rim: 2.4 });
  // 速度線: 外縁のすぐ外だけ（内側に引くと 2 本目の弧に見える）。奥義なので 4 本、太めに
  const span = s.head - s.tail;
  for (let i = 0; i < 4; i++) {
    const radius = JUDG.R + 3 + i * 2.6 + s.k * 9;
    const len = span * (0.3 + 0.4 * hash1(i, 5141)) * (1 - s.k * 0.85);
    const end = s.head - span * (0.06 + 0.12 * hash1(i, 5142)) + s.k * span * 0.2;
    if (len <= 0.03 || s.k >= 0.9) continue;
    arcLine(frame, { radius, from: end - len, to: end, width: i === 0 ? 1.8 : 1.1, bright: (0.66 - i * 0.07) * (1 - s.k * 0.6) });
  }
  // 先端の光点（走っている間）と、振り切りの大きな光点
  if (f >= 1 && f < A - 1) sparkle(frame, Math.cos(s.head) * (JUDG.R - 4), Math.sin(s.head) * (JUDG.R - 4), 3);
  if (f === A - 1 || f === A) sparkle(frame, Math.cos(s.head) * (JUDG.R - 4), Math.sin(s.head) * (JUDG.R - 4), f === A - 1 ? 4 : 3);
  // 振り切りの余波: 帯から離れて前方へ走る衝撃の弧（1 本。前へふくらむ）
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 4) {
      const half = (JUDG.sweep * DEG) / 2;
      arcLine(frame, { radius: JUDG.R + 14 + age * 9, from: -half * 0.5, to: half * 0.8, width: 3 - age * 0.45, bright: 0.8 - age * 0.12 });
    }
  }
  // 床を擦る砂煙: 弧の後半に 3 か所、先端が通った順に立つ
  const dustR = JUDG.R - 8;
  const dustAt = [0.4, 0.7, 1];
  for (let j = 0; j < dustAt.length; j++) {
    const a = s.from + s.sweep * (dustAt[j] ?? 1);
    const born = Math.round((A - 1) * (dustAt[j] ?? 1));
    dustBurst(frame, { x: Math.cos(a) * dustR, y: Math.sin(a) * dustR }, f - born, { n: 7, spread: 34, size: 16, life: JUDG.frames - born, seed: 5170 + j * 5, v: 0.42 });
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  // 石礫: 振りの後半から、接線と外向きへ重く大量に
  pebbles(frame, age, 24, 5160, (i, rnd) => {
    const a = s.from + s.sweep * (0.35 + 0.65 * rnd(1));
    const r = JUDG.R - JUDG.T * (0.3 + 0.4 * rnd(2));
    const sp = 5 + rnd(3) * 6;
    const out = 0.35 + 0.5 * rnd(4);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp, vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp, life: 3 + Math.floor(rnd(5) * 4), big: rnd(6) > 0.45 };
  });
}

/** 断罪の地面: 刃の腹が床を削った弧の溝（先端を追って伸びる）と、溝の外縁から外へ走る亀裂。帯が消えた後も少し残る */
/**
 * 地面の溝のフレーム数。床の傷はゆっくり変わるので斬撃より少ない枚数で同じ life を流す（アトラスの高さを抑える）。
 * 実行時は地面の絵も自分のフレーム数で life を割るので、斬撃とずれずに進む
 */
const JUDG_GROUND_N = 8;

function judgmentGround(frame, f) {
  const A = JUDG.active;
  const s = judgmentPose(f);
  const half = (JUDG.sweep * DEG) / 2;
  const R0 = JUDG.R - 26;
  const reachHead = Math.min(half, s.head);
  const k = f < A + 2 ? 0 : (f - A - 1) / (JUDG.frames - A - 1);
  const erosion = k * 0.95;
  const span = reachHead + half;
  if (span > 0.05) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        if (a < -half || a > reachHead) return -1;
        const u = (a + half) / span;
        // 溝の幅は振り始めで細く、刃の腹が通った中ほどで太い
        const w = 2 + 4 * Math.sin(Math.PI * Math.min(1, u * 1.1));
        const d = Math.abs(r - R0);
        if (d > w) return -1;
        // 常に少し欠けさせ、刃の縁のような滑らかな弧（2 本目の斬線）に見せない
        if (valueNoise(x, y, 5, 5181) * 0.8 + (1 - d / w) * 0.3 - (0.12 + erosion) * 1.1 < 0) return -1;
        // 外縁（遠い側）は削れた縁がやや明るく、内側は影（床の傷なので段 3 まで）
        return r > R0 + w * 0.4 ? 0.3 : 0.18;
      },
      { bounds: arcBounds(0, 0, R0 - 8, R0 + 8, -half - 0.05, reachHead + 0.05), samples: 2, dither: 0 },
    );
  }
  // 溝から外へ走る亀裂（7 本）。先端が通り過ぎた所から順に伸びる
  const paths = [];
  const grows = [];
  for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7;
    const a = -half + 2 * half * u + (hash1(i, 5182) - 0.5) * 0.12;
    if (a > reachHead) continue;
    const r = R0 + 4;
    paths.push(crackPath(Math.cos(a) * r, Math.sin(a) * r, a + (hash1(i, 5183) - 0.5) * 0.4, 20 + hash1(i, 5184) * 18, 5185 + i * 7));
    grows.push(Math.min(1, (reachHead - a) / 0.5 + (f >= A ? 1 : 0)));
  }
  paths.forEach((p, i) => cracks(frame, [p], grows[i] ?? 1, erosion, 5190 + i));
}

/**
 * 断罪の発動: 溜めた力が足元へ引き寄せられ（縮む地面の輪と寄ってくる石礫）、満ちた瞬間に天から光の柱が落ちて
 * 足元の輪が弾ける（「裁き」の一撃の合図）
 */
function judgmentCast(frame, f) {
  const N = 9;
  const gather = 3;
  const feet = { x: 0, y: FEET_Y };
  if (f < gather) {
    const p = (f + 1) / gather;
    groundRing(frame, feet, { radius: 64 - 44 * p, width: 3.2, squash: 0.45, bright: 0.45 + 0.35 * p, seed: 5201 });
    // 寄ってくる石礫: 周りの床から足元へ
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(i, 5202) * 0.4;
      const r = (54 + hash1(i, 5203) * 14) * (1 - p * 0.7);
      pebbleAt(frame, Math.cos(a) * r, FEET_Y + Math.sin(a) * r * 0.45 - p * 6, p > 0.6 ? 5 : 4, i % 3 === 0);
    }
    if (f === gather - 1) sparkle(frame, 0, FEET_Y, 3);
    return;
  }
  const age = f - gather;
  const k = age / (N - gather - 1);
  // 光の柱: 上から足元へ細く落ち、太って、上から崩れて消える（白は芯の縦線だけ）
  if (k < 0.9) {
    const top = -96 + age * 6;
    const halfW = age === 0 ? 3 : 7 * (1 - k * 0.7);
    paint(
      frame,
      (x, y) => {
        if (y < top || y > FEET_Y) return -1;
        const t = (FEET_Y - y) / (FEET_Y - top);
        const w = halfW * (0.55 + 0.45 * (1 - t));
        const ax = Math.abs(x);
        if (ax > w) return -1;
        if (!survivesChunky(x, y, k * 0.95 + t * 0.2, 1 - ax / w, 5204)) return -1;
        if (ax < 0.7 && k < 0.4) return 1;
        if (w - ax < 1.3) return 0.22;
        return clamp01((1 - ax / w) ** 0.6 * 0.72 * (1 - k * 0.4));
      },
      { bounds: { x0: -12, y0: top - 2, x1: 12, y1: FEET_Y + 2 } },
    );
  }
  if (age === 0) sparkle(frame, 0, FEET_Y - 2, 4);
  if (age === 1) sparkle(frame, 0, -60, 2);
  // 足元の輪が 2 枚遅れて弾ける
  groundRing(frame, feet, { radius: 14 + age * 11, width: 4.2 - age * 0.5, squash: 0.45, erosion: Math.min(0.92, k * 0.9), bright: 0.8 - k * 0.3, seed: 5205 });
  if (age >= 1) groundRing(frame, feet, { radius: 8 + (age - 1) * 7, width: 2.4, squash: 0.45, erosion: Math.min(0.92, k * 1.1), bright: 0.55 - k * 0.2, seed: 5206 });
  dustBurst(frame, feet, age, { n: 6, spread: 34, size: 11, life: N - gather, seed: 5207 });
}

// -----------------------------------------------------------------------------
// 巨人の膂力（持続）: 足を踏み鳴らして床を割り、岩を打ち上げる。持続中は足元の割れた床から岩が浮かび続ける
// dirs 1（画面に揃える）: 浮かぶ向き・床は向きによらない
// -----------------------------------------------------------------------------

/** 足元の床の亀裂（持続の地面と発動で共用する形。床に置いたので縦を潰す） */
function feetCrackPaths(count, len, seed, r0 = 18) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + (hash1(i, seed) - 0.5) * 0.5;
    // 足元の輪の外から始める（輪の内側に線を引くと、輪と合わせて顔や車輪に見える）
    paths.push(crackPath(Math.cos(a) * r0, FEET_Y + Math.sin(a) * r0 * 0.45, a, len * (0.7 + 0.5 * hash1(i, seed + 1)), seed + 10 + i * 7, { flat: 0.5, jag: 6 }));
  }
  return paths;
}

/** 巨人の膂力の発動: 踏み鳴らしの地面の輪 3 枚、放射の亀裂、左右の砂煙、打ち上がって落ちる岩、横へ走る風圧 */
function titanCast(frame, f) {
  const N = 11;
  const feet = { x: 0, y: FEET_Y };
  const k = f / (N - 1);
  if (f === 0) sparkle(frame, 0, FEET_Y, 4);
  if (f === 1) sparkle(frame, 0, FEET_Y, 2);
  // 地面の輪: 3 枚が時間差で広がる（一歩の重さが床を伝わる）
  for (let j = 0; j < 3; j++) {
    const age = f - j * 2;
    if (age < 0) continue;
    const kk = age / (N - 1 - j * 2);
    groundRing(frame, feet, { radius: 16 + age * (12 - j * 2), width: 5 - j - age * 0.3, squash: 0.42, erosion: Math.min(0.92, kk * 0.95), bright: (0.85 - j * 0.12) * (1 - kk * 0.4), seed: 5301 + j });
  }
  // 放射の亀裂: 素早く伸び、最後まで薄く残る
  cracks(frame, feetCrackPaths(9, 50, 5310, 16), Math.min(1, (f + 1) / 3), Math.max(0, (f - 5) / 5), 5320, { width: 1.8 });
  // 左右の砂煙（大きく低い）
  dustBurst(frame, feet, f - 1, { n: 10, spread: 70, size: 16, life: N - 1, seed: 5330, v: 0.42 });
  // 横へ走る風圧: 足元の高さの左右に短い横線が外へ流れる
  if (k < 0.6) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const y = FEET_Y - 4 - Math.floor(i / 2) * 7 - hash1(i, 5340) * 3;
      const x0 = side * (26 + f * 9 + hash1(i, 5341) * 6);
      streakLine(frame, { ax: x0, ay: y, bx: x0 + side * (16 + hash1(i, 5342) * 10), by: y, width: i < 2 ? 1.5 : 1, bright: 0.55 * (1 - k) });
    }
  }
  // 打ち上がる岩: 足元の周りから上へ弾け、弧を描いて落ちる
  pebbles(frame, f, 18, 5350, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = 10 + rnd(2) * 18;
    return { x: Math.cos(a) * r, y: FEET_Y + Math.sin(a) * r * 0.45, vx: Math.cos(a) * (1.5 + rnd(3) * 2.5), vy: -(6 + rnd(4) * 6), life: 5 + Math.floor(rnd(5) * 5), big: rnd(6) > 0.4, drag: 0.82, fall: 0.55 };
  });
}

/** 纏いの 1 巡のフレーム数 */
const TITAN_N = 12;
/** 浮かぶ岩の根元（キャラの左右と背後。顔の前は避ける）と位相・大きさ */
const TITAN_ROCKS = [
  { x: -34, phase: 0.0, big: true },
  { x: -24, phase: 0.36, big: false },
  { x: -15, phase: 0.7, big: true },
  { x: -40, phase: 0.58, big: false },
  { x: 15, phase: 0.18, big: false },
  { x: 24, phase: 0.55, big: true },
  { x: 34, phase: 0.86, big: false },
  { x: 40, phase: 0.28, big: true },
  { x: -4, phase: 0.45, big: false, back: true },
  { x: 6, phase: 0.95, big: true, back: true },
];

/** 浮かぶ岩 1 つ（大は 4x4、小は 3x3 の角ばった塊）。上面が明るく下面が暗い */
function floatRock(frame, x, y, big, level) {
  const hi = Math.max(3, Math.min(6, level));
  const m = hi - 1;
  const lo = Math.max(1, hi - 2);
  const pattern = big
    ? [`.${hi}${hi}${hi}.`, `${hi}${hi}${m}${m}${lo}`, `${hi}${m}${m}${lo}${lo}`, `${m}${m}${lo}${lo}1`, `.${lo}${lo}1.`]
    : [`.${hi}${hi}.`, `${hi}${m}${m}${lo}`, `${m}${m}${lo}${lo}`, `.${lo}1.`];
  stamp(frame, x, y, pattern);
}

/** 巨人の膂力の纏い（持続中ずっと）: 岩が床から離れてゆっくり浮かび、上で砕けて消える。力の圧で縦の陽炎が揺れる */
function titanSustain(frame, f) {
  const cycle = f / TITAN_N;
  TITAN_ROCKS.forEach((rk, i) => {
    const t = (cycle + rk.phase) % 1;
    const baseY = rk.back ? -20 : FEET_Y + 2;
    const y = baseY - t * (rk.back ? 26 : 46) + Math.sin((t + i) * TAU) * 1;
    const x = rk.x + Math.sin(t * TAU + i) * 1.5;
    // 浮き上がり（明るく）→ 上で砕ける（2 片に割れて暗く消える）
    if (t < 0.78) {
      const level = t < 0.12 ? 4 : 6;
      floatRock(frame, x, y, rk.big, level);
    } else {
      const s = (t - 0.78) / 0.22;
      const lv = s < 0.5 ? 4 : 3;
      dot(frame, x - 2 - s * 4, y - s * 3, lv);
      dot(frame, x + 2 + s * 4, y - s * 2, lv);
      if (rk.big) dot(frame, x, y - 2 - s * 5, lv - 1);
    }
  });
  // 力の圧: 左右に短い縦の陽炎（段 2〜3）が立ちのぼる
  for (let i = 0; i < 6; i++) {
    const t = (cycle + hash1(i, 5410)) % 1;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (16 + hash1(i, 5411) * 20);
    const y0 = FEET_Y - t * 40;
    const len = 8 + 6 * Math.sin(Math.PI * t);
    streakLine(frame, { ax: x, ay: y0, bx: x + side * 1, by: y0 - len, width: 1, bright: 0.38 * Math.sin(Math.PI * t) });
  }
  // 立ちのぼる砂の粒
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 5420)) % 1;
    const x = (hash1(i, 5421) - 0.5) * 76;
    const y = FEET_Y + 2 - t * 56;
    if (Math.abs(x) < 10 && y > -24) continue;
    dot(frame, x, y, Math.max(2, Math.round(2 + 2 * Math.sin(Math.PI * t))));
  }
  if (f === 3) sparkle(frame, -30, FEET_Y - 20, 2);
  if (f === 9) sparkle(frame, 21, FEET_Y - 22, 2);
}

/** 纏いの地面: 割れた床（放射の亀裂・動かない）、脈打つ楕円、1 巡に 1 度外へ広がって消える踏み鳴らしの輪 */
function titanSustainGround(frame, f) {
  const cycle = f / TITAN_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  const feet = { x: 0, y: FEET_Y };
  cracks(frame, feetCrackPaths(9, 22, 5430, 23), 1, 0, 5440, { width: 1.4, hi: 0.3, lo: 0.2 });
  groundRing(frame, feet, { radius: 20 + pulse * 1.5, width: 3, squash: 0.45, bright: 0.36 + 0.14 * pulse, seed: 5450 });
  // 広がる輪は 1 巡の終わりに見えなくなるので、巡の継ぎ目で跳ばない
  groundRing(frame, feet, { radius: 22 + cycle * 30, width: 2.2, squash: 0.45, erosion: cycle * 0.7, bright: 0.42 * (1 - cycle), seed: 5451 });
}

// -----------------------------------------------------------------------------
// 地割り（volley: 3 本の地を這う衝撃波・半径 9・遅い・すべて貫く）
// 行為 0 の絵 = 大剣を床に叩きつけて前へ 3 本の亀裂を開く。弾の絵 = 床を割って這い進む岩の波
// -----------------------------------------------------------------------------

/** 3 本の衝撃波の広がり（spreadDeg 18） */
const SPLIT_SPREAD = 18 * DEG;
/** 叩きつけた位置（自分の前） */
const SPLIT_AT = 30;

/** 叩きつけの刃（上から落ちる鉄の板。後ろは細く前ほど太く、前端は丸い） */
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
      const cx = x1 - W;
      if (x > cx && Math.hypot((x - cx) / W, y / W) > 1) return -1;
      const ay = Math.abs(y);
      if (ay > w) return -1;
      const q = ay / w;
      if (!survivesChunky(x, y, erosion, 1 - q, o.seed ?? 1)) return -1;
      if (w - ay < 1.8) return 0.17 * bright + 0.03;
      if (ay < 0.8 && t > 0.2 && erosion < 0.3) return bright;
      const band = Math.floor(ay / 3);
      return clamp01((1 - q) ** 0.5 * (0.55 + 0.45 * t) * (0.9 + 0.12 * hash1(band, o.seed ?? 1)) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x0 - 2, y0: -W - 2, x1: x1 + 2, y1: W + 2 } },
  );
}

/** 地割りの行為 0: 刃が床を叩き、潰れた輪が弾け、3 本の亀裂が扇に前へ走り、石礫と砂煙が前へ吹く */
function earthSplitSlam(frame, f) {
  const A = 3;
  const N = 11;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const back = -30;
  const front = SPLIT_AT + 16;
  if (k < 0.75) {
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    slab(frame, { x0: back, x1: back + (front - back) * grow, W: (f < A ? 18 + f * 5 : 28) * (1 - k * 0.4), erosion: k * 1.1, seed: 5501, bright: 1 - k * 0.2 });
  }
  if (f < A - 1) return;
  const age = f - (A - 1);
  const at = { x: SPLIT_AT, y: 0 };
  if (age === 0) sparkle(frame, SPLIT_AT, 0, 4);
  // 叩いた所の輪（前へ潰れた楕円を 2 枚）
  ring(frame, { ox: SPLIT_AT + age * 2, radius: 12 + age * 8, width: 4.4 - age * 0.35, squash: 0.6, erosion: Math.min(0.92, age * 0.12), bright: 0.8 - age * 0.06, seed: 5502 });
  if (age >= 2) ring(frame, { ox: SPLIT_AT + age * 3, radius: 6 + (age - 2) * 6, width: 2.4, squash: 0.6, erosion: Math.min(0.92, (age - 2) * 0.16), bright: 0.55 - age * 0.04, seed: 5503 });
  // 3 本の亀裂: 衝撃波の出る向き（0・±18°）へ太く長く。遅れて後ろへ短い割れ目
  const paths = [-1, 0, 1].map((s, i) => crackPath(SPLIT_AT - 6, s * 3, s * SPLIT_SPREAD, 76, 5510 + i * 11, { n: 7, jag: 8 }));
  cracks(frame, paths, Math.min(1, (age + 1) / 4), Math.max(0, (age - 4) / 5), 5540, { width: 2.4, hi: 0.42, lo: 0.3 });
  cracks(frame, [crackPath(SPLIT_AT - 10, 0, Math.PI - 0.5, 18, 5545), crackPath(SPLIT_AT - 10, 0, Math.PI + 0.5, 16, 5546)], Math.min(1, age / 2), Math.max(0, (age - 3) / 4), 5547);
  dustBurst(frame, at, age, { n: 8, spread: 36, size: 14, life: N - A + 1, seed: 5550, v: 0.42 });
  // 石礫: 前の扇（3 本の波の向き）へ多く、残りは左右へ
  pebbles(frame, age, 18, 5560, (i, rnd) => {
    const fwd = rnd(1) > 0.3;
    const a = fwd ? (rnd(2) - 0.5) * 0.9 : (rnd(2) > 0.5 ? 1 : -1) * (1.3 + rnd(3) * 0.8);
    const sp = 4 + rnd(4) * 5;
    return { x: SPLIT_AT, y: (rnd(5) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(6) * 4), big: rnd(7) > 0.45 };
  });
}

/** 岩の波の数値（弾の半径 9 論理 px → 半幅 18 ドット。遅い弾なので尾は短く、床の亀裂で道筋を見せる） */
const WAVE = { half: 22, depth: 9, bulge: 7, tail: 40, frames: 6, period: 0.24, seed: 5600 };

/**
 * 岩の波の前線: 前へふくらむ弓なりの帯（1 本）の前縁から、岩の棘が前へ突き出す。
 * 棘の高さはフレームごとにずれて、床を割りながら進む揺れに見せる
 */
function waveFront(frame, f, o = {}) {
  const scale = o.scale ?? 1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const ox = o.ox ?? 0;
  const H = WAVE.half * scale;
  const D = WAVE.depth * scale;
  const B = WAVE.bulge * scale;
  // 弓なりの帯の本体（前縁の位置 = ox + B·(1 − (y/H)²)）
  paint(
    frame,
    (x, y) => {
      const v = y / H;
      if (Math.abs(v) > 1) return -1;
      const front = ox + B * (1 - v * v);
      const d = front - x;
      const depth = D * (1 - 0.55 * v * v);
      if (d < 0 || d > depth) return -1;
      const q = d / depth;
      if (!survivesChunky(x, y, erosion + Math.abs(v) * 0.15, 1 - q, WAVE.seed + 1)) return -1;
      if (d < 1.4 && Math.abs(v) < 0.75 && erosion < 0.4) return clamp01(0.92 * bright);
      if (depth - d < 1.8) return 0.18;
      return clamp01((0.7 - 0.35 * q) * (0.85 + 0.15 * (1 - Math.abs(v))) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: ox - D - 2, y0: -H - 2, x1: ox + B + 2, y1: H + 2 } },
  );
  // 前縁の棘: 7 本。中央ほど長い
  const count = 7;
  for (let i = 0; i < count; i++) {
    const v = (i / (count - 1)) * 2 - 1;
    const y = v * H * 0.88;
    const x = ox + B * (1 - v * v) - 1;
    const flick = 0.65 + 0.35 * hash1(i * 7 + f, WAVE.seed + 2);
    const len = (8 + 7 * (1 - Math.abs(v))) * scale * flick;
    rockSpike(frame, { x, y, a: v * 0.5, len, w: 3.4 * scale, erosion, bright: bright * (0.9 + 0.1 * flick), seed: WAVE.seed + 3 + i });
  }
}

/** 地割りの弾（飛んでいる間）: 岩の波の前線 + 後ろへ伸びる床の亀裂 + 後ろへ置いていかれる石礫と低い砂煙 */
function earthSplitFly(frame, f) {
  const cycle = f / WAVE.frames;
  // 床の亀裂（道筋）: 中央の太い 1 本と、前線の端から後ろへ細い 2 本
  const main = crackPath(-WAVE.depth, 0, Math.PI, WAVE.tail, WAVE.seed + 10 + (f % 2), { n: 5, jag: 5 });
  cracks(frame, [main], 1, 0, WAVE.seed + 11, { width: 2, hi: 0.4, lo: 0.24 });
  cracks(frame, [crackPath(-WAVE.depth + 2, -WAVE.half * 0.6, Math.PI + 0.25, WAVE.tail * 0.45, WAVE.seed + 12), crackPath(-WAVE.depth + 2, WAVE.half * 0.6, Math.PI - 0.25, WAVE.tail * 0.45, WAVE.seed + 13)], 1, 0, WAVE.seed + 14, { width: 1.3, hi: 0.28, lo: 0.2 });
  // 砂煙: 前線の両端の後ろに低い塊（位相で後ろへ流れる）
  const puffs = [];
  for (let i = 0; i < 4; i++) {
    const t = (cycle + i / 4) % 1;
    const side = i % 2 === 0 ? 1 : -1;
    const c = toScreen(frame, -6 - t * 30, side * (WAVE.half - 2 + t * 6));
    const rx = 5 + t * 5;
    puffs.push({ x: c.x, y: c.y, rx, ry: rx * 0.6, v: 0.38 * (1 - t * 0.7) });
  }
  dustCloud(frame, puffs, 0, WAVE.seed + 15);
  waveFront(frame, f);
  // 石礫: 前線で跳ね上がり、後ろへ置いていかれる（位相で 1 巡）
  for (let i = 0; i < 7; i++) {
    const t = (cycle + hash1(i, WAVE.seed + 20)) % 1;
    const y = (hash1(i, WAVE.seed + 21) - 0.5) * WAVE.half * 1.7;
    const x = WAVE.bulge * 0.5 - t * 34;
    pebbleAt(frame, x, y + Math.sin(Math.PI * t) * -3, t < 0.5 ? 5 : 4, i % 3 === 0 && t < 0.6);
  }
}

/** 地割りの弾の出だし: 床が割れ開き、波の前線が小さく立ち上がる（行為 0 の叩きつけの上に 3 つ重なるので控えめ） */
function earthSplitMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  const grow = Math.min(1, (f + 1) / 2);
  waveFront(frame, f, { scale: 0.5 + 0.4 * grow, ox: 6 + f * 3, erosion: Math.max(0, k - 0.4) * 1.4, bright: 1 - k * 0.3 });
  pebbles(frame, f, 6, 5620, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 3 + rnd(2) * 3;
    return { x: 8, y: (rnd(3) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, big: rnd(4) > 0.6 };
  });
}

/** 地割りの着弾（壁・敵に当たった）: 岩の棘が扇に突き上がって砕け、石礫が前と左右へ、足元に砂煙 */
function earthSplitImpact(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const grow = Math.min(1, (f + 1) / 2);
  if (k < 0.85) {
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.42 + (hash1(i, 5640) - 0.5) * 0.2;
      const len = (16 + 12 * (1 - Math.abs(i - 2) / 2) + hash1(i, 5641) * 4) * grow;
      rockSpike(frame, { x: -4, y: (i - 2) * 3, a, len, w: 5.5 - Math.abs(i - 2) * 0.6, erosion: Math.max(0, k - 0.25) * 1.3, bright: 1 - k * 0.3, seed: 5642 + i });
    }
  }
  if (f === 1) sparkle(frame, 8, 0, 3);
  groundRing(frame, { x: 0, y: 0 }, { radius: 8 + f * 5, width: 3.2 - f * 0.25, squash: 0.5, erosion: Math.min(0.92, k * 0.9), bright: 0.66 - k * 0.2, seed: 5650 });
  dustBurst(frame, { x: -2, y: 0 }, f - 1, { n: 6, spread: 24, size: 10, life: N - 1, seed: 5651 });
  pebbles(frame, f, 12, 5660, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 4;
    return { x: 4, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), big: rnd(5) > 0.5 };
  });
}

/** 地割りの尽き（射程の果て）: 波の前線が床へ沈んで崩れ、砂煙と石礫だけが残る */
function earthSplitFizzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (k < 0.7) waveFront(frame, f, { scale: 1 - k * 0.5, erosion: 0.15 + k * 1.1, bright: 0.9 - k * 0.3 });
  dustBurst(frame, { x: -4, y: 0 }, f, { n: 6, spread: 22, size: 10, life: N - 1, seed: 5670 });
  pebbles(frame, f, 8, 5680, (i, rnd) => {
    const y = (rnd(1) - 0.5) * WAVE.half * 1.6;
    return { x: 2, y, vx: -1 - rnd(2) * 1.5, vy: Math.sign(y) * rnd(3) * 1.5, life: 4 + Math.floor(rnd(4) * 2), big: rnd(5) > 0.6 };
  });
}

/** 地割りの発動: 大剣を振りかぶる溜め（背後で縮む輪と、足元の砂が後ろへ吸われる筋）。叩きつけ本体は行為 0 */
function earthSplitCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  // 振りかぶった刃の重さ: 背中側（-x）の上に小さな光点と、後ろへ引く潰れた輪
  ring(frame, { ox: -10 - f * 2, radius: 18 - f * 1.5, width: 3 - k, squash: 0.55, erosion: Math.min(0.9, k * 0.9), bright: 0.75 - k * 0.3, seed: 5701 });
  if (f === 1) sparkle(frame, -18, 0, 3);
  // 足元の砂が前から後ろへ吸われる筋
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (6 + Math.floor(i / 2) * 6 + hash1(i, 5702) * 2);
      const x0 = 28 - f * 7 - hash1(i, 5703) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 14 - hash1(i, 5704) * 10, by: y * 0.85, bright: 0.5 * (1 - k) });
    }
  }
  dustBurst(frame, { x: -6, y: 0 }, f - 1, { n: 4, spread: 18, size: 8, life: N - 1, seed: 5705 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 断罪の base は振りの届き（reach 60）。地割りの弾の base は弾の半径（9）
 */
const FX = {
  moveset: "greatsword",
  ultimates: {
    "greatsword.judgment": {
      ramp: "light",
      cast: { sheet: "greatswordUlt.judgmentCast", life: 0.45 },
      acts: [{ sheet: "greatswordUlt.judgment", life: 0.6, base: JUDG.R / 2, pivot: "pos", ground: "greatswordUlt.judgmentGround" }],
    },
    "greatsword.titanMight": {
      ramp: "steel",
      cast: { sheet: "greatswordUlt.titanMightCast", life: 0.6 },
      sustain: { sheet: "greatswordUlt.titanMight", period: 1.0, ground: "greatswordUlt.titanMightGround" },
    },
    "greatsword.earthSplit": {
      ramp: "brass",
      cast: { sheet: "greatswordUlt.earthSplitCast", life: 0.3 },
      acts: [{ sheet: "greatswordUlt.earthSplit", life: 0.55, pivot: "pos" }],
      shots: {
        0: {
          fly: "greatswordUlt.earthSplitFly",
          period: WAVE.period,
          base: 9,
          muzzle: "greatswordUlt.earthSplitMuzzle",
          impact: "greatswordUlt.earthSplitImpact",
          fizzle: "greatswordUlt.earthSplitFizzle",
          ramp: "brass",
        },
      },
    },
  },
};

export const ATLAS = {
  key: "greatswordUlt",
  fx: FX,
  sheets: [
    { key: "greatswordUlt.judgment", dirs: WIDE_DIRS, frames: JUDG.frames, active: JUDG.active, size: 2 * (JUDG.R + 46), draw: judgmentSlash },
    { key: "greatswordUlt.judgmentGround", dirs: WIDE_DIRS, frames: JUDG_GROUND_N, active: 0, size: 2 * (JUDG.R + 20), draw: (frame, f) => judgmentGround(frame, Math.round((f * (JUDG.frames - 1)) / (JUDG_GROUND_N - 1))) },
    { key: "greatswordUlt.judgmentCast", dirs: 1, frames: 9, active: 0, size: 240, draw: judgmentCast },
    { key: "greatswordUlt.titanMightCast", dirs: 1, frames: 11, active: 0, size: 280, draw: titanCast },
    { key: "greatswordUlt.titanMight", dirs: 1, frames: TITAN_N, active: 0, size: 136, draw: titanSustain },
    { key: "greatswordUlt.titanMightGround", dirs: 1, frames: TITAN_N, active: 0, size: 136, draw: titanSustainGround },
    { key: "greatswordUlt.earthSplitCast", dirs: DIRS, frames: 7, active: 0, size: 112, draw: earthSplitCast },
    { key: "greatswordUlt.earthSplit", dirs: DIRS, frames: 11, active: 3, size: 2 * (SPLIT_AT + 100), draw: earthSplitSlam },
    { key: "greatswordUlt.earthSplitFly", dirs: FLY_DIRS, frames: WAVE.frames, active: 0, size: 2 * (WAVE.tail + WAVE.depth + 16), draw: earthSplitFly },
    { key: "greatswordUlt.earthSplitMuzzle", dirs: DIRS, frames: 5, active: 0, size: 96, draw: earthSplitMuzzle },
    { key: "greatswordUlt.earthSplitImpact", dirs: DIRS, frames: 8, active: 0, size: 112, draw: earthSplitImpact },
    { key: "greatswordUlt.earthSplitFizzle", dirs: 1, frames: 7, active: 0, size: 96, draw: earthSplitFizzle },
  ],
};
