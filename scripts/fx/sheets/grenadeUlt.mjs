// 擲弾筒（moveset "grenade"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs、形の言葉は grenade.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/grenade.json × 2 が目安
//
// 擲弾筒の通常の絵（筒口の「ぽん」・白煙の塊・火球 → 黒煙の輪 → 破片）の言葉をそのまま使い、奥義は大きく段を多くする:
//   - 鉄の雨: 5 発の斉射。発射は後ろへ吹く大きな後方噴射と、横へ飛ぶ 5 つの薬莢。炸裂は子弾が周りで連鎖する大きな爆発
//   - 焼夷弾: 火薬の爆発ではなく「燃える液が飛び散る」。低く広い炎の飛沫と、立ちのぼる炎の舌、地面の焦げた水たまり
//   - 榴弾の宴: 6 発の砲弾が腰の周りを回り続け、足元を導火線の火が走る（持続）
// 白（段 7）は閃光の芯と光点だけ。煙・炎の面は段 6 までに抑える
import { easeSwing, lens, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（grenade.mjs の形をこのファイルに写したもの。見本・他の武器種のファイルは編集しない）
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
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
      if (along < -w * 0.6 || along > len) return -1;
      const u = Math.max(0, along) / len;
      const hw = w * (1 - u) + 0.35;
      const d = Math.abs(-dx * s + dy * c);
      if (d > hw) return -1;
      const q = d / hw;
      if (!survives(px, py, erosion, 1 - q, seed)) return -1;
      return clamp01((1 - q * 0.6) * (1 - u * 0.55) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 円い閃光の芯（半径 r）。中心ほど明るい */
function flashCore(frame, x, y, r, bright = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > r) return -1;
      return clamp01((1 - d / r) ** 0.6 * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 前へ押し出す圧の弧（潰れた楕円の前側だけ） */
function frontArc(frame, o) {
  const { ox = 0, oy = 0, radius, width } = o;
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
      const dy = y - oy;
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > spread) return -1;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      const edge = Math.abs(a) / spread;
      if (!survives(x, y, erosion + edge * 0.3, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - 0.45 * edge));
    },
    { bounds: { x0: ox - 2, y0: oy - pad, x1: ox + pad * squash + 2, y1: oy + pad } },
  );
}

/** 煙の塊 1 つ（縁がノイズで波打つ丸）。lit は画面の上側を明るく（dirs 1 の絵だけで使う） */
function puff(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.5;
  const seed = o.seed ?? 1;
  const erosion = o.erosion ?? 0;
  const rough = o.rough ?? 0.3;
  const lit = o.lit ?? 0;
  if (r < 0.8) return;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const edge = r * (1 - rough + rough * 2 * valueNoise(px, py, Math.max(3, r * 0.9), seed));
      if (d > edge) return -1;
      const q = d / Math.max(0.5, edge);
      if (erosion > 0 && valueNoise(px, py, Math.max(3, r * 0.5), seed + 3) * 0.75 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      const rim = q > 0.82 ? 0.55 : 1;
      const light = lit ? 1 + lit * (-dy / Math.max(1, edge)) : 1;
      return clamp01((0.55 + 0.45 * (1 - q) ** 0.7) * rim * light * bright * (1 - erosion * 0.35));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/** 火球: 縁が瘤状に揺れる炎の塊。heat が下がるほど芯が消えて赤黒く崩れる */
function fireball(frame, o) {
  const { x = 0, y = 0, R, seed } = o;
  const heat = o.heat ?? 1;
  const erosion = o.erosion ?? 0;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const lobe = valueNoise(Math.cos(a) * 9, Math.sin(a) * 9, 2.2, seed) * 0.45 + Math.max(0, -dy / Math.max(1, d)) * 0.12;
      const edge = R * (0.72 + lobe);
      if (d > edge) return -1;
      const q = d / edge;
      if (erosion > 0 && valueNoise(px, py, 7, seed + 5) * 0.75 + (1 - q) * 0.35 - erosion * 1.15 < 0) return -1;
      const swirl = 0.82 + 0.3 * valueNoise(px + 40, py, 3.2, seed + 9);
      const core = (1 - q) ** 0.9;
      return clamp01((0.28 + core * (0.55 + 0.35 * heat)) * swirl * (0.55 + 0.45 * heat));
    },
    { bounds: { x0: x - R * 1.35 - 2, y0: y - R * 1.35 - 2, x1: x + R * 1.35 + 2, y1: y + R * 1.35 + 2 } },
  );
}

/** 重い破片（2x2 の角ばった塊。上が明るい） */
function chunk(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(2, level - 1));
  dot(frame, x, y + 1, Math.max(2, level - 1));
  dot(frame, x + 1, y + 1, Math.max(2, level - 2));
}

/** 地面に広がる楕円の輪（見下ろした地面の衝撃波。上下対称） */
function groundRing(frame, o) {
  const { r, width } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.7;
  const seed = o.seed ?? 1;
  const sq = o.squash ?? 0.72;
  paint(
    frame,
    (x, y) => {
      const d = Math.abs(Math.hypot(x - ox, (y - oy) / sq) - r);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: ox - r - width - 2, y0: oy - r * sq - width - 2, x1: ox + r + width + 2, y1: oy + r * sq + width + 2 } },
  );
}

/** 放物線で飛ぶ重い塊（dirs 1。y は画面の下、g は重力） */
function debris(frame, f, o) {
  const { n, seed, speed, g, life } = o;
  const age = f - (o.from ?? 0);
  if (age < 0 || age > life) return;
  for (let i = 0; i < n; i++) {
    const a = hash1(i, seed) * TAU;
    const sp = speed * (0.55 + 0.6 * hash1(i, seed + 1));
    const up = (o.lift ?? 3) * (0.5 + hash1(i, seed + 2));
    const x = Math.cos(a) * sp * age;
    const y = Math.sin(a) * sp * age * 0.75 - up * age + 0.5 * g * age * age;
    const level = Math.max(3, Math.round(6 - (age / (life + 1)) * 3));
    if ((o.size ?? 2) >= 2 && hash1(i, seed + 3) > 0.35) chunk(frame, x, y, level);
    else dot(frame, x, y, level);
  }
}

/** 筒口の「ぽん」: 丸くずんぐりした閃光と前の短い太い針 3 本（grenade.mjs の pomp）。s で大きさ */
function pomp(frame, x, y, a, s) {
  flashCore(frame, x, y, 5.5 * s, 1);
  spike(frame, { x, y, a, len: 12 * s, w: 4.2 * s, bright: 1 });
  spike(frame, { x, y, a: a - 38 * DEG, len: 7 * s, w: 2.6 * s, bright: 0.85 });
  spike(frame, { x, y, a: a + 38 * DEG, len: 7 * s, w: 2.6 * s, bright: 0.85 });
}

/**
 * 砲弾の体（卵形・中央の弾帯・頭の信管）。rot で軸が回る。光は画面の左上から固定（dirs 1 の絵）。
 * hot（0..1）で弾帯が赤熱して明るく光る（奥義の弾の印。通常の擲弾は弾帯が暗い溝）
 */
function shellBody(frame, x0, y0, rot, g) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const L = g.len;
  const H = g.half;
  const hot = g.hot ?? 0;
  const dim = g.dim ?? 1;
  paint(
    frame,
    (x, y) => {
      const px = x - x0;
      const py = y - y0;
      const u = px * c + py * s;
      const v = -px * s + py * c;
      let inside = Math.hypot(u / (L * 0.5), v / H) <= 1;
      let shade = 0;
      if (inside && Math.abs(u + L * 0.08) < 0.9) shade = hot > 0 ? 0.3 * hot : -0.25;
      if (!inside && u > 0 && u < L * 0.5 + 2 && Math.abs(v) < 1.3) {
        inside = true;
        shade = -0.1;
      }
      if (!inside) return -1;
      const nx = px / (L * 0.5);
      const ny = py / (L * 0.5);
      const light = clamp01(0.5 - 0.45 * (nx * 0.55 + ny * 0.85));
      return clamp01((0.3 + 0.45 * light + shade) * dim);
    },
    { bounds: { x0: x0 - L - 2, y0: y0 - L - 2, x1: x0 + L + 2, y1: y0 + L + 2 } },
  );
  if (dim > 0.8) dot(frame, x0 - L * 0.18, y0 - H * 0.55, 7);
}

/** 薬莢: 小さな筒（長さ 5・太さ 2.4）が角 rot を向いて回る */
function casing(frame, x0, y0, rot, bright) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  paint(
    frame,
    (x, y) => {
      const u = (x - x0) * c + (y - y0) * s;
      const v = -(x - x0) * s + (y - y0) * c;
      if (Math.abs(u) > 2.6 || Math.abs(v) > 1.3) return -1;
      // 口（+u の端）は明るい縁、胴は上の面が光る
      return clamp01((u > 1.6 ? 0.8 : 0.55 - 0.15 * v) * bright);
    },
    { bounds: { x0: x0 - 4, y0: y0 - 4, x1: x0 + 4, y1: y0 + 4 } },
  );
}

/**
 * 炎の舌 1 本（dirs 1 の絵。下から上へ細る）。(x, y) が根元、h が高さ、w が根元の太さ。
 * 両側の縁がノイズで波打ち、先は千切れる。白は使わない（段 6 まで）
 */
function flame(frame, o) {
  const { x: bx, y: by, h, w } = o;
  const phase = o.phase ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  if (h < 2 || w < 1 || bright <= 0) return;
  paint(
    frame,
    (x, y) => {
      const t = (by - y) / h;
      if (t < 0 || t > 1) return -1;
      const cx = bx + Math.sin(t * 3.2 + phase) * w * 0.35 * t;
      const prof = Math.sqrt(Math.min(1, (t + 0.05) / 0.25)) * Math.pow(1 - t, 0.85);
      const half = (w / 2) * prof * (0.75 + 0.5 * valueNoise(x, y * 0.6 + phase * 4, 3, seed));
      const d = Math.abs(x - cx);
      if (half < 0.5 || d > half) return -1;
      const q = d / half;
      if (!survives(x, y, erosion + t * 0.25, 1 - q, seed)) return -1;
      return Math.min(0.78, clamp01(((1 - q) ** 0.8 * (0.5 + 0.5 * (1 - t)) + 0.06) * bright));
    },
    { bounds: { x0: bx - w - 2, y0: by - h - 2, x1: bx + w + 2, y1: by + 2 } },
  );
}

// -----------------------------------------------------------------------------
// 鉄の雨（volley 曲射 5 発・広がり 10°・炸裂半径 28）
// -----------------------------------------------------------------------------

/** 筒を構えた先（自分の中心から前へ） */
const HAND = 22;
/** 5 発の撃ち出す角（広がり 10° を 5 本に割る） */
const RAIN_ANGLES = [-10, -5, 0, 5, 10].map((d) => d * DEG);
/** 鉄の雨の炸裂の半径（blastRadius 28 × 2） */
const RAIN_BLAST_R = 56;

/**
 * 鉄の雨の発動（原点 = 自分、+x = 照準）: 足元を踏ん張る潰れた輪と、照準の先へ伸びる 5 本の点線（弾道の見当）。
 * 点線は前へ流れて消え、筒口に装填の火が灯る
 */
function ironRainCast(frame, f) {
  const N = 8;
  // 踏ん張りの土煙の輪（後ろ寄り。前は照準線があるので空ける）
  if (f >= 1) {
    const age = f - 1;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + ((i - 3) / 3) * 100 * DEG;
      const d = 14 + age * 2.4;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, 5.6 * (0.8 + age * 0.12), { bright: 0.36 - age * 0.03, seed: 5001 + i, rough: 0.4, erosion: Math.max(0, age / 6 - 0.3) * 1.5 });
    }
  }
  // 照準の点線: 5 本、4 ドット描いて 4 空ける。前へ流れ、後半は欠けて消える
  const fade = Math.max(0, (f - 4) / 3);
  if (fade < 1) {
    const reach = 34 + Math.min(1, (f + 1) / 4) * 70;
    RAIN_ANGLES.forEach((a, j) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let d = HAND + 6 + ((f * 3) % 8); d < reach; d += 8) {
        if (fade > 0 && hash1(j * 31 + d, 5010 + f) < fade) continue;
        const b = (0.35 + 0.35 * (d / reach)) * (1 - fade * 0.5);
        streakLine(frame, { ax: c * d, ay: s * d, bx: c * (d + 4), by: s * (d + 4), bright: b });
      }
    });
  }
  // 装填の火: 筒口に小さく灯って膨らみ、最後の一瞬に弾ける
  if (f >= 2) {
    const s = Math.min(1, (f - 1) / 3);
    flashCore(frame, HAND, 0, 3 + s * 3, 0.8 + 0.2 * s);
    if (f === 4) sparkle(frame, HAND, 0, 4);
    else if (f === 3 || f === 5) sparkle(frame, HAND, 0, 2);
  }
  shards(frame, f - 4, 8, 5020, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.2;
    const sp = 2 + rnd(2) * 2.5;
    return { x: HAND, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: 1 };
  });
}

/**
 * 鉄の雨の斉射（acts[0]、原点 = 自分）: 筒口の閃光は弾の muzzle が出すので、ここは斉射の反動 —
 * 後ろへ吹く大きな後方噴射（針と白煙の円錐）、前へ押す圧の弧、横へ弾き出される 5 つの薬莢、足元の土煙
 */
function ironRainSalvo(frame, f) {
  const N = 10;
  // 後方噴射の閃光（2 枚）
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.6;
    flashCore(frame, -12, 0, 8 * s, 1);
    spike(frame, { x: -12, a: Math.PI, len: 36 * s, w: 8 * s, bright: 1 });
    spike(frame, { x: -12, a: Math.PI - 24 * DEG, len: 20 * s, w: 4.5 * s, bright: 0.9 });
    spike(frame, { x: -12, a: Math.PI + 24 * DEG, len: 20 * s, w: 4.5 * s, bright: 0.9 });
    if (f === 0) sparkle(frame, -12, 0, 4);
  }
  // 後方噴射の白煙: 後ろへ押し出される円錐（中央ほど遠く大きい）
  if (f >= 1) {
    const age = f - 1;
    const t = age / (N - 2);
    for (let i = 0; i < 9; i++) {
      const lane = (i % 3) - 1;
      const row = Math.floor(i / 3);
      const a = Math.PI + lane * (16 + row * 5) * DEG;
      const d = 18 + row * 10 + age * (3.4 - row * 0.5) * (lane === 0 ? 1.2 : 1);
      const r = (9.5 + row * 2.4 - Math.abs(lane) * 1.5) * (0.8 + t * 0.55);
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, r, { bright: 0.62 - t * 0.26 - row * 0.05, seed: 5101 + i, rough: 0.35, erosion: Math.max(0, t - 0.35 - row * 0.05) * 1.6 });
    }
  }
  // 前へ押す圧の弧（斉射の押し）
  if (f <= 4) {
    frontArc(frame, { ox: HAND + 4 + f * 4, radius: 10 + f * 5, width: 3.2 - f * 0.4, squash: 0.5, spread: 75 * DEG, erosion: Math.min(0.9, f * 0.2), bright: 0.8 - f * 0.1, seed: 5111 });
  }
  // 5 つの薬莢: 右側（+y）へ弾き出されて回りながら減速して落ちる
  for (let i = 0; i < 5; i++) {
    const age = f - 1 - i * 0.5;
    if (age < 0 || age > 7) continue;
    const a = 70 * DEG + (hash1(i, 5120) - 0.5) * 50 * DEG;
    const sp = 4.5 + hash1(i, 5121) * 2;
    const travel = (1 - Math.pow(0.8, age)) / 0.2;
    const x = -2 + Math.cos(a) * sp * travel;
    const y = 8 + Math.sin(a) * sp * travel;
    casing(frame, x, y, age * 1.1 + i, 1 - Math.max(0, age - 4) * 0.18);
  }
  // 足元の土煙（左右へ低く）
  if (f >= 1) {
    const age = f - 1;
    const t = age / (N - 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        puff(frame, -6 - i * 8 - age * 1.2, side * (16 + i * 3 + age * 2.2), (4 + i) * (0.8 + t * 0.6), { bright: 0.38 - t * 0.12, seed: 5130 + i + (side > 0 ? 3 : 0), rough: 0.4, erosion: Math.max(0, t - 0.3) * 1.5 });
      }
    }
  }
  shards(frame, f, 14, 5140, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.4;
    const sp = 3.5 + rnd(2) * 4;
    return { x: -14, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
  });
}

/** 鉄の雨の弾の数値（通常の擲弾 len 13・half 5.4 より一回り大きい） */
const RAIN_SHELL = { len: 15, half: 6, hot: 1, frames: 8, period: 0.3 };

/**
 * 鉄の雨の飛ぶ砲弾（dirs 1）: 通常の擲弾より大きく、弾帯が赤熱して光る。頭の信管から火花が螺旋を描いてこぼれる
 */
function ironRainFly(frame, f) {
  const g = RAIN_SHELL;
  const rot = (f / g.frames) * TAU;
  shellBody(frame, 0, 0, rot, g);
  const tip = g.len * 0.5 + 2.5;
  sparkle(frame, Math.cos(rot) * tip, Math.sin(rot) * tip, f % 2 === 0 ? 3 : 2);
  // 信管からこぼれた火花: 回転に遅れて螺旋に並ぶ（古いほど外で暗い）
  for (let i = 1; i <= 4; i++) {
    const a = rot - i * 0.4;
    const d = tip + i * 1.5;
    dot(frame, Math.cos(a) * d, Math.sin(a) * d, Math.max(3, 7 - i));
  }
}

/**
 * 鉄の雨の筒口（muzzle、原点 = 筒口の先）: 5 発の閃光が 1 つにまとまって出る。太く丸い閃光に、5 本の短い炎の歯（扇）、
 * 前へ抜ける大きな煙の渦輪と、筒口の脇へ噴く白煙
 */
function ironRainMuzzle(frame, f) {
  const N = 7;
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.62;
    flashCore(frame, 0, 0, 9 * s, 1);
    spike(frame, { a: 0, len: 30 * s, w: 6.5 * s, bright: 1 });
    // 5 発ぶんの歯: 広がりを誇張して扇にする（10° のままだと 1 本に潰れる）
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 16 * DEG;
      if (i === 2) continue;
      spike(frame, { a, len: (i % 4 === 0 ? 18 : 24) * s, w: 3 * s, bright: 0.9 });
    }
    spike(frame, { a: -70 * DEG, len: 8 * s, w: 2.6 * s, bright: 0.75 });
    spike(frame, { a: 70 * DEG, len: 8 * s, w: 2.6 * s, bright: 0.75 });
    if (f === 0) sparkle(frame, 2, 0, 4);
  }
  const t = f / (N - 1);
  if (f >= 1) {
    // 渦輪: 上下 2 つの大きな塊と、つなぐ前面の弧
    const x = 8 + f * 5.5;
    const ry = 9 + f * 1.8;
    for (const side of [-1, 1]) {
      puff(frame, x, side * ry, 6.2 * (0.8 + t * 0.45), { bright: 0.66 - t * 0.24, seed: 5210 + (side > 0 ? 1 : 0), rough: 0.25, erosion: Math.max(0, t - 0.45) * 1.8 });
      puff(frame, x - 7, side * (ry + 4), 4.2 * (0.8 + t * 0.4), { bright: 0.52 - t * 0.2, seed: 5212 + (side > 0 ? 1 : 0), rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.8 });
    }
    if (f <= 5) frontArc(frame, { ox: x - 1, radius: ry, width: 3, squash: 0.35, spread: 88 * DEG, erosion: Math.min(0.9, t * 0.6), bright: 0.58 - t * 0.12, seed: 5214 });
    puff(frame, 2, 0, 3.6 * (0.8 + t), { bright: 0.44 - t * 0.14, seed: 5215, erosion: Math.max(0, t - 0.3) * 1.6 });
  }
  shards(frame, f, 12, 5220, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.5;
    const sp = 3.5 + rnd(2) * 4;
    return { x: 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.6 ? 2 : 1 };
  });
}

/**
 * 鉄の雨の着弾（落ちる前に壁・敵にぶつかった。原点 = 消えた位置、+x = 進んでいた向き）: 平たい閃きと十字の光、
 * 跳ね返る破片、土埃。炸裂は blast が出すので小さな衝突だけ（通常より一回り大きく火花が多い）
 */
function ironRainImpact(frame, f) {
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -12, bx: -1, by: 12, T: f === 0 ? 5.5 : 3.4, bias: 0, bright: 0.95 });
    flashCore(frame, 0, 0, 4.5, 1);
    if (f === 0) sparkle(frame, 0, 0, 4);
  }
  shards(frame, f, 14, 5301, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3.8 * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  if (f >= 1) {
    const t = (f - 1) / 5;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 55 * DEG;
      const d = 5 + f * 2.4;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (4.4 + (i % 2) * 1.4) * (0.8 + t * 0.6), { bright: 0.4 - t * 0.1, seed: 5310 + i, erosion: Math.max(0, t - 0.45) * 1.4 });
    }
  }
}

/** 子弾の小さな炸裂（鉄の雨の炸裂の周りで連鎖する）。age 0 で閃光、1〜2 で小さな火球 */
function subBlast(frame, x, y, age, seed) {
  if (age < 0 || age > 3) return;
  if (age === 0) {
    flashCore(frame, x, y, 7, 1);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + hash1(i, seed) * 0.5;
      spike(frame, { x, y, a, len: 11 + 5 * hash1(i, seed + 1), w: 2.2, bright: 0.95 });
    }
    sparkle(frame, x, y, 3);
    return;
  }
  const t = (age - 1) / 2;
  fireball(frame, { x, y: y - age, R: 11 + 4 * t, seed, heat: 1 - t * 0.8, erosion: Math.max(0, t - 0.3) * 1.3 });
}

/**
 * 鉄の雨の炸裂（blast、dirs 1、blastBase 28、原点 = 炸裂の中心）: 通常の擲弾の炸裂を大きく段を多くしたもの。
 * 0: 16 本の針の星形の閃光 → 1〜4: 大きな火球と地面の衝撃の輪、放射状の鋭い破片 → 2〜5: 周りで子弾が 3 つ連鎖して弾ける
 * → 黒煙の輪と中心から昇る煙の柱、跳ねる土塊、火の粉
 */
function ironRainBlast(frame, f) {
  const N = 12;
  const R = RAIN_BLAST_R;
  if (f === 0) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + (hash1(i, 5401) - 0.5) * 0.2;
      const long = i % 2 === 0 ? 1 : 0.58;
      spike(frame, { a, len: (40 + 14 * hash1(i, 5402)) * long, w: 3.4, bright: 1 });
    }
    flashCore(frame, 0, 0, 17, 1);
    sparkle(frame, 0, 0, 4);
  }
  // 火球: 1〜5 で膨らんで昇り、熱が引いて崩れる
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    fireball(frame, { x: 0, y: -2 - f * 1.5, R: 34 + 12 * easeSwing(Math.min(1, t * 1.6)), seed: 5403, heat: 1 - t * 0.85, erosion: Math.max(0, t - 0.5) * 1.3 });
  }
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    groundRing(frame, { r: 24 + (R + 4 - 24) * easeSwing(t), width: 4.5 - t * 2, erosion: t * 0.75, bright: 0.82 - t * 0.25, seed: 5404 });
  }
  // 子弾の連鎖: 炸裂の縁の 3 か所で時間差に弾ける（「雨」の粒）
  for (let j = 0; j < 3; j++) {
    const a = -90 * DEG + (j / 3) * TAU + (hash1(j, 5405) - 0.5) * 0.6;
    const d = 30 + hash1(j, 5406) * 10;
    subBlast(frame, Math.cos(a) * d, Math.sin(a) * d * 0.72, f - 2 - j, 5407 + j * 3);
  }
  // 鋭い破片: 放射状に筋を引いて飛ぶ
  if (f >= 1 && f <= 7) {
    const age = f - 1;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + (hash1(i, 5420) - 0.5) * 0.3;
      const sp = 12 + 6 * hash1(i, 5421);
      const r1 = 14 + sp * age * (1 - age * 0.06);
      if (r1 > R + 24) continue;
      const len = Math.max(5, 20 - age * 3);
      const r0 = r1 - len;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0 * 0.85, bx: Math.cos(a) * r1, by: Math.sin(a) * r1 * 0.85, width: age <= 1 ? 1.7 : 1.1, bright: 0.95 * (1 - (age / 7) * 0.5) });
      dot(frame, Math.cos(a) * r1, Math.sin(a) * r1 * 0.85, age <= 1 ? 7 : 6 - Math.min(2, age - 1));
    }
  }
  // 黒煙の輪（重ねて切れ目のない輪に）と中心の柱
  if (f >= 3) {
    const t = (f - 3) / (N - 3);
    const rr = 26 + 30 * easeSwing(Math.min(1, t * 1.4));
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * TAU + hash1(i, 5430) * 0.25;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, (11 + hash1(i, 5431) * 4) * (0.8 + t * 0.35), { bright: 0.25 - t * 0.04, seed: 5432 + i, rough: 0.35, erosion: Math.max(0, t - 0.3) * 1.3, lit: 0.35 });
    }
  }
  if (f >= 4) {
    const t = (f - 4) / (N - 4);
    for (let i = 0; i < 3; i++) {
      puff(frame, (i - 1) * 3, -10 - i * 12 - t * 28, (13 - i * 2) * (0.8 + t * 0.5), { bright: 0.3 - t * 0.04, seed: 5450 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.4 + i * 0.05, lit: 0.4 });
    }
  }
  debris(frame, f, { n: 16, seed: 5460, speed: 7, g: 1.4, lift: 4.5, life: 7, from: 1 });
  // 火の粉: 火球の周りから昇って消える
  if (f >= 2 && f <= 9) {
    for (let i = 0; i < 14; i++) {
      if (hash1(i, 5470) < (f - 2) / 8) continue;
      const a = hash1(i, 5471) * TAU;
      const d = 26 + f * 4 + hash1(i, 5472) * 12;
      dot(frame, Math.cos(a) * d, Math.sin(a) * d * 0.8 - f * 2.5, Math.max(4, 7 - Math.floor(f / 2)));
    }
  }
}

// -----------------------------------------------------------------------------
// 焼夷弾（nova 半径 30・中心は照準の 90 先に 3 か所・炎の床を残す。属性 fire）
// -----------------------------------------------------------------------------

/** 焼夷弾の炎の飛沫の半径（半径 30 × 2） */
const INC_R = 60;
/** 焼夷弾の炸裂のフレーム数 */
const INC_N = 12;
/** 3 発を撃つ角（広がり 20° を 3 本） */
const INC_ANGLES = [-20, 0, 20].map((d) => d * DEG);

/**
 * 燃える液の飛沫 1 本（涙の形）: 中心から角 a へ、長さ L、頭の半径 W。頭は丸く明るく、根元は細い
 */
function splashLobe(frame, o) {
  const { a, L, W } = o;
  const x0 = o.x ?? 0;
  const y0 = o.y ?? 0;
  const sq = o.squash ?? 0.72;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const body = Math.max(1, L - W);
  const R = L + W + 2;
  paint(
    frame,
    (x, y) => {
      // 地面に潰して見る（上下を戻してから測る）
      const px = x - x0;
      const py = (y - y0) / sq;
      const along = px * c + py * s;
      const across = Math.abs(-px * s + py * c);
      let q;
      let u;
      const dh = Math.hypot(along - body, across);
      if (dh <= W) {
        q = dh / W;
        u = 1;
      } else if (along >= 0 && along <= body) {
        u = along / body;
        const hw = W * Math.pow(u, 0.9) * 0.85;
        if (across > hw || hw < 0.5) return -1;
        q = across / hw;
      } else return -1;
      if (!survives(x, y, erosion, (1 - q) * u, seed)) return -1;
      return clamp01(((1 - q) ** 0.8 * (0.45 + 0.4 * u) + 0.08) * bright);
    },
    { bounds: { x0: x0 - R, y0: y0 - R * sq, x1: x0 + R, y1: y0 + R * sq } },
  );
}

/**
 * 焼夷弾の発動（原点 = 自分、+x = 照準）: 3 発を扇に撃つ。1 発ごとに筒口の「ぽん」の後ろから炎の舌が長く伸び、
 * 撃つたびに筒口から黒い煤煙が漏れる（火薬の白煙ではなく焼夷剤の黒い煙）
 */
function incendiaryCast(frame, f) {
  const N = 9;
  INC_ANGLES.forEach((a, j) => {
    const age = f - j;
    if (age < 0) return;
    const x = Math.cos(a) * HAND;
    const y = Math.sin(a) * HAND;
    if (age === 0) {
      pomp(frame, x, y, a, 1.15);
      // 炎の舌: ぽんの前へ長く波打つ（針 2 本をずらして重ね、舌のゆらぎにする）
      spike(frame, { x, y, a: a + 4 * DEG, len: 24, w: 3.4, bright: 0.85, erosion: 0.15, seed: 5501 + j });
      sparkle(frame, x, y, 3);
    } else if (age === 1) {
      pomp(frame, x, y, a, 0.6);
      spike(frame, { x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, a: a - 5 * DEG, len: 18, w: 2.6, bright: 0.7, erosion: 0.35, seed: 5504 + j });
    }
    if (age >= 1) {
      const t = age / (N - j);
      for (let i = 0; i < 2; i++) {
        const d = 4 + i * 5 + age * (1.8 + i * 0.7);
        puff(frame, x + Math.cos(a) * d, y + Math.sin(a) * d - age * 0.6, (3.8 + i) * (0.8 + t * 0.7), { bright: 0.3 - t * 0.08, seed: 5510 + j * 3 + i, rough: 0.4, erosion: Math.max(0, t - 0.35) * 1.6 });
      }
    }
  });
  // 焼夷剤のしずく: 筒口から前と下へこぼれる明るい粒
  shards(frame, f - 1, 12, 5520, (i, rnd) => {
    const a = INC_ANGLES[i % 3] ?? 0;
    const sp = 2 + rnd(1) * 2.5;
    const b = a + (rnd(2) - 0.5) * 0.9;
    return { x: Math.cos(a) * HAND, y: Math.sin(a) * HAND, vx: Math.cos(b) * sp, vy: Math.sin(b) * sp, life: 2 + Math.floor(rnd(3) * 3), size: 1, delay: 0 };
  });
}

/** 炎の舌の並び（原点からの位置は地面に潰した円盤の中。0..1 の座標で、時間差 born で燃え上がる） */
const INC_FLAMES = Array.from({ length: 13 }, (_, i) => {
  const a = hash1(i, 5601) * TAU;
  const r = Math.sqrt(0.08 + 0.92 * hash1(i, 5602)) * 0.82;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.72, born: 1 + hash1(i, 5603) * 2.5, h: 22 + hash1(i, 5604) * 16, w: 9 + hash1(i, 5605) * 5, phase: hash1(i, 5606) * TAU };
});

/**
 * 焼夷弾の炸裂（acts[0]、dirs 1、原点 = 爆心、base 30）: 火薬の丸い爆発ではなく、燃える液が四方へ飛び散る低く広い炸裂。
 * 0: 殻が割れる閃光（短い針）→ 1〜3: 涙の形の炎の飛沫が地面を這って半径まで広がる → 2〜: 飛沫の跡から炎の舌が
 * 時間差で立ちのぼり、揺れて千切れる → 黒い煤煙が昇る。火の粉は上へ舞う
 */
function incendiaryBurst(frame, f) {
  const N = INC_N;
  const R = INC_R;
  if (f === 0) {
    flashCore(frame, 0, 0, 12, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + (hash1(i, 5610) - 0.5) * 0.4;
      spike(frame, { a, len: (18 + 10 * hash1(i, 5611)) * (i % 2 === 0 ? 1 : 0.6), w: 2.8, bright: 1 });
    }
    sparkle(frame, 0, 0, 4);
  }
  // 飛沫: 11 本の涙形が外へ伸び、頭が縁に着くと崩れて地面の炎になる
  if (f >= 1 && f <= 5) {
    const grow = easeSwing(Math.min(1, f / 3));
    const k = Math.max(0, (f - 3) / 3);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + (hash1(i, 5620) - 0.5) * 0.45;
      const L = R * (0.62 + 0.3 * hash1(i, 5621)) * grow;
      splashLobe(frame, { a, L, W: 5.5 + 2.5 * hash1(i, 5622), bright: 1 - k * 0.3, erosion: k * 0.9, seed: 5623 + i });
    }
    // 中心の火溜まり
    fireball(frame, { x: 0, y: -1, R: 16 - f * 1.5, seed: 5640, heat: 1 - f * 0.18, erosion: Math.max(0, (f - 2) / 3) });
  }
  // 飛沫の先から跳ねるしずく（弧を描いて落ちる）
  debris(frame, f, { n: 14, seed: 5650, speed: 8.5, g: 1.2, lift: 2.5, life: 5, from: 1, size: 1 });
  // 炎の舌: 燃え上がり（born から 2 枚で伸びる）→ 揺れる → 千切れて消える
  INC_FLAMES.forEach((fl, i) => {
    const age = f - fl.born;
    if (age < 0) return;
    const rise = Math.min(1, (age + 1) / 2.5);
    const die = Math.max(0, (age - 4) / (N - 1 - fl.born - 4));
    if (die >= 1) return;
    flame(frame, {
      x: fl.x * R,
      y: fl.y * R + 4,
      h: fl.h * rise * (1 - die * 0.3) * (0.9 + 0.2 * Math.sin(age * 1.7 + fl.phase)),
      w: fl.w * (1 - die * 0.35),
      phase: fl.phase + age * 0.9,
      bright: 1 - die * 0.35,
      erosion: die * 0.85,
      seed: 5660 + i,
    });
  });
  // 煤煙: 炎の上から黒い塊が昇る
  if (f >= 4) {
    const t = (f - 4) / (N - 4);
    for (let i = 0; i < 5; i++) {
      const fl = INC_FLAMES[i * 2] ?? INC_FLAMES[0];
      if (!fl) continue;
      puff(frame, fl.x * R + Math.sin(t * 3 + i) * 3, fl.y * R - fl.h * 0.8 - t * 26, (6 + i % 3) * (0.8 + t * 0.6), { bright: 0.22, seed: 5680 + i, rough: 0.4, erosion: Math.max(0, t - 0.3) * 1.4, lit: 0.3 });
    }
  }
  // 火の粉: 上へ舞う（左右に揺れる）
  if (f >= 2) {
    for (let i = 0; i < 18; i++) {
      const born = 2 + hash1(i, 5690) * 6;
      const age = f - born;
      if (age < 0 || age > 4) continue;
      const x = (hash1(i, 5691) - 0.5) * R * 1.5 + Math.sin(age + i) * 2;
      const y = (hash1(i, 5692) - 0.5) * R * 0.9 - 10 - age * 7;
      dot(frame, x, y, Math.max(4, 7 - Math.floor(age)));
    }
  }
}

/**
 * 焼夷弾の地面（ground）: 焦げた水たまり。縁が波打つ低い明るさの円盤と、明るい縁、外に飛んだ焼夷剤のしみ。
 * 炎の床は別に描かれるので、最後は薄れて消える
 */
function incendiaryGround(frame, f) {
  const N = INC_N;
  const R = INC_R;
  const grow = easeSwing(Math.min(1, (f + 1) / 3));
  const k = Math.max(0, (f - 6) / (N - 6));
  const rr = R * 0.86 * grow;
  const sq = 0.72;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y / sq);
      const a = Math.atan2(y / sq, x);
      const edge = rr * (0.82 + 0.28 * valueNoise(Math.cos(a) * 12, Math.sin(a) * 12, 3, 5701));
      if (d > edge) return -1;
      const q = d / edge;
      if (!survives(x, y, k * 0.95, 1 - q, 5702)) return -1;
      // 縁（燃え際）は明るく、内側は焦げて暗い
      if (q > 0.86) return clamp01((0.5 - k * 0.2) * (1 - (q - 0.86) * 2));
      return clamp01((0.06 + 0.1 * valueNoise(x, y, 5, 5703)) * (1 - k * 0.3));
    },
    { bounds: { x0: -R - 4, y0: -R * sq - 4, x1: R + 4, y1: R * sq + 4 } },
  );
  // 外に飛んだしみ
  if (f >= 2) {
    for (let i = 0; i < 9; i++) {
      const a = hash1(i, 5710) * TAU;
      const d = R * (0.95 + 0.2 * hash1(i, 5711));
      puff(frame, Math.cos(a) * d, Math.sin(a) * d * sq, 2.4 + hash1(i, 5712) * 1.8, { bright: 0.3 - k * 0.1, seed: 5713 + i, rough: 0.4, erosion: k * 1.1 });
    }
  }
}

// -----------------------------------------------------------------------------
// 榴弾の宴（持続: 曲射が 1 発増え、威力が上がる）
// -----------------------------------------------------------------------------

/** キャラの足元（絵で 48 ドットのキャラ） */
const FEET_Y = 18;
/** 腰の周りを回る砲弾の軌道（見下ろした楕円） */
const ORBIT = { cy: 6, rx: 34, ry: 12 };
/** 回る砲弾の数（6 回対称: 1 巡で 1/3 周回って継ぎ目が出ない） */
const FEAST_SHELLS = 6;
const FEAST_N = 12;
/** 回る砲弾の形（通常の擲弾より小さい: 纏いなのでキャラを隠さない） */
const ORBIT_SHELL = { len: 10, half: 4.2, hot: 1 };

/** 軌道上の砲弾 1 つ。奥（楕円の上半分）ほど暗く、手前だけ信管が光る */
function orbitShell(frame, a, o = {}) {
  const x = Math.cos(a) * (o.rx ?? ORBIT.rx);
  const y = ORBIT.cy + Math.sin(a) * (o.ry ?? ORBIT.ry);
  const front = Math.sin(a);
  const dim = 0.65 + 0.35 * (0.5 + 0.5 * front);
  // 進む向き（接線、時計回り）へ頭を向ける
  const rot = Math.atan2(Math.cos(a) * ORBIT.ry, -Math.sin(a) * ORBIT.rx);
  shellBody(frame, x, y, rot, { ...ORBIT_SHELL, dim: dim * (o.bright ?? 1) });
  return { x, y, rot, front };
}

/**
 * 榴弾の宴の発動（dirs 1）: 足元で白煙の輪がどっと弾け、6 発の砲弾が渦を巻いて外へ飛び出し軌道に収まる。
 * 中心の閃光と、立ちのぼる火の粉
 */
function feastCast(frame, f) {
  const N = 10;
  if (f <= 1) {
    flashCore(frame, 0, ORBIT.cy, f === 0 ? 12 : 7, 1);
    if (f === 0) sparkle(frame, 0, ORBIT.cy, 4);
  }
  // 足元の白煙の輪（重ねて帯にする）
  if (f >= 1) {
    const t = (f - 1) / (N - 2);
    const rr = 16 + 34 * easeSwing(Math.min(1, t * 1.5));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + hash1(i, 5801) * 0.3;
      puff(frame, Math.cos(a) * rr, FEET_Y + Math.sin(a) * rr * 0.4, (6 + hash1(i, 5802) * 2.5) * (0.8 + t * 0.4), { bright: 0.5 - t * 0.2, seed: 5803 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.5, lit: 0.35 });
    }
  }
  // 渦を巻いて外へ出る 6 発: 半径が伸びながら回り、最後に軌道に収まる
  const p = easeSwing(Math.min(1, (f + 1) / 6));
  for (let i = 0; i < FEAST_SHELLS; i++) {
    const a = (i / FEAST_SHELLS) * TAU + p * TAU * 0.9;
    const s = orbitShell(frame, a, { rx: ORBIT.rx * (0.25 + 0.75 * p), ry: ORBIT.ry * (0.25 + 0.75 * p) });
    // 渦の筋: 砲弾の後ろ（反時計回りの側）へ短い弧の尾
    if (f < 6) {
      for (let j = 1; j <= 3; j++) {
        const b = a - j * 0.22;
        const rf = 0.25 + 0.75 * easeSwing(Math.min(1, (f + 1 - j * 0.3) / 6));
        dot(frame, Math.cos(b) * ORBIT.rx * rf, ORBIT.cy + Math.sin(b) * ORBIT.ry * rf, Math.max(3, 6 - j));
      }
    }
    if (f === 5 && s.front > 0) sparkle(frame, s.x + Math.cos(s.rot) * 7, s.y + Math.sin(s.rot) * 7, 2);
  }
  shards(frame, f, 16, 5820, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 70;
    return { x, y: FEET_Y, vx: x * 0.03, vy: -(3.5 + rnd(2) * 4.5), life: 4 + Math.floor(rnd(3) * 4), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.9 };
  });
}

/**
 * 榴弾の宴の纏い（sustain、dirs 1、持続中ずっと）: 6 発の砲弾が腰の周りを回り続ける（1 巡で 1/3 周）。
 * 手前の砲弾は信管が明滅し、後ろに煙の粒を引く。上へ昇る火の粉
 */
function feastSustain(frame, f) {
  const cycle = f / FEAST_N;
  for (let i = 0; i < FEAST_SHELLS; i++) {
    const a = (i / FEAST_SHELLS + cycle / 3) * TAU;
    const s = orbitShell(frame, a);
    // 煙の尾: 軌道の後ろへ 3 粒（古いほど暗い）
    for (let j = 1; j <= 3; j++) {
      const b = a - j * 0.16;
      dot(frame, Math.cos(b) * ORBIT.rx, ORBIT.cy + Math.sin(b) * ORBIT.ry, Math.max(2, (s.front > 0 ? 5 : 4) - j));
    }
    // 信管の火: 手前の砲弾だけ、砲弾ごとに位相をずらして明滅
    if (s.front > -0.2) {
      const tip = ORBIT_SHELL.len * 0.5 + 2;
      const lit = (f + i * 2) % 4;
      const fx = s.x + Math.cos(s.rot) * tip;
      const fy = s.y + Math.sin(s.rot) * tip;
      if (lit === 0) sparkle(frame, fx, fy, 2);
      else dot(frame, fx, fy, lit === 2 ? 6 : 5);
    }
  }
  // 火の粉: 位相で上へ流れ、1 巡で元へ戻る。顔の前は避ける
  for (let i = 0; i < 10; i++) {
    const t = (cycle + hash1(i, 5901)) % 1;
    const x = (hash1(i, 5902) - 0.5) * 76 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y - t * 60;
    if (Math.abs(x) < 12 && y > -26) continue;
    dot(frame, x, y, Math.min(6, Math.max(3, Math.round(2 + 4 * Math.sin(Math.PI * t)))));
  }
}

/**
 * 榴弾の宴の足元（ground）: 導火線の輪。点線の楕円を火が 1 巡で 1 周走り、通った後ろは焦げて暗く、
 * 前はまだ明るい縄。火の位置に光点と小さな火の粉
 */
function feastGround(frame, f) {
  const cycle = f / FEAST_N;
  const head = cycle * TAU - Math.PI / 2;
  const rx = 38;
  const ry = 15;
  const dashes = 20;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * TAU;
    const a1 = a0 + (TAU / dashes) * 0.6;
    // 火が通ってからの角（0 = 今、大きいほど前に燃えた）
    const since = (((head - a0) % TAU) + TAU) % TAU;
    const burnt = since / TAU;
    const b = burnt < 0.08 ? 0.62 : 0.26 + 0.18 * burnt;
    streakLine(frame, { ax: Math.cos(a0) * rx, ay: FEET_Y + Math.sin(a0) * ry, bx: Math.cos(a1) * rx, by: FEET_Y + Math.sin(a1) * ry, width: 1.6, bright: b });
  }
  const hx = Math.cos(head) * rx;
  const hy = FEET_Y + Math.sin(head) * ry;
  sparkle(frame, hx, hy, f % 2 === 0 ? 3 : 2);
  for (let j = 1; j <= 3; j++) {
    const s = hash1(j + f * 3, 5950);
    dot(frame, hx + (s - 0.5) * 6, hy - 2 - j * 2.2, Math.max(3, 7 - j));
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 鉄の雨の acts[0] は volley（自分の位置・照準の向き）で、弾は shots[0] の絵が出す（曲射なので blast も）。
 * 焼夷弾の acts[0] は周囲攻撃の着弾（照準の 90 先の 3 か所。原点 = 爆心、base = 半径 30）。
 * 火薬の奥義なので属性の無い 2 本も fire の配色にする
 */
const FX = {
  moveset: "grenade",
  ultimates: {
    "grenade.ironRain": {
      ramp: "fire",
      cast: { sheet: "grenadeUlt.ironRainCast", life: 0.35 },
      acts: [{ sheet: "grenadeUlt.ironRain", life: 0.5, pivot: "pos" }],
      shots: {
        0: {
          fly: "grenadeUlt.ironRainFly",
          period: RAIN_SHELL.period,
          base: 3,
          muzzle: "grenadeUlt.ironRainMuzzle",
          impact: "grenadeUlt.ironRainImpact",
          blast: "grenadeUlt.ironRainBlast",
          blastBase: RAIN_BLAST_R / 2,
          ramp: "fire",
        },
      },
    },
    "grenade.incendiary": {
      ramp: "fire",
      cast: { sheet: "grenadeUlt.incendiaryCast", life: 0.4 },
      acts: [{ sheet: "grenadeUlt.incendiary", life: 0.8, base: INC_R / 2, pivot: "pos", ground: "grenadeUlt.incendiaryGround" }],
    },
    "grenade.shellFeast": {
      ramp: "fire",
      cast: { sheet: "grenadeUlt.shellFeastCast", life: 0.6 },
      sustain: { sheet: "grenadeUlt.shellFeast", period: 0.9, ground: "grenadeUlt.shellFeastGround" },
    },
  },
};

export const ATLAS = {
  key: "grenadeUlt",
  fx: FX,
  sheets: [
    { key: "grenadeUlt.ironRainCast", dirs: DIRS, frames: 8, active: 0, size: 232, draw: ironRainCast },
    { key: "grenadeUlt.ironRain", dirs: DIRS, frames: 10, active: 0, size: 160, draw: ironRainSalvo },
    { key: "grenadeUlt.ironRainFly", dirs: 1, frames: RAIN_SHELL.frames, active: 0, size: 48, draw: ironRainFly },
    { key: "grenadeUlt.ironRainMuzzle", dirs: DIRS, frames: 7, active: 0, size: 112, draw: ironRainMuzzle },
    { key: "grenadeUlt.ironRainImpact", dirs: DIRS, frames: 7, active: 0, size: 72, draw: ironRainImpact },
    { key: "grenadeUlt.ironRainBlast", dirs: 1, frames: 12, active: 0, size: 2 * (RAIN_BLAST_R + 44), draw: ironRainBlast },
    { key: "grenadeUlt.incendiaryCast", dirs: DIRS, frames: 9, active: 0, size: 128, draw: incendiaryCast },
    { key: "grenadeUlt.incendiary", dirs: 1, frames: INC_N, active: 0, size: 2 * (INC_R + 40), draw: incendiaryBurst },
    { key: "grenadeUlt.incendiaryGround", dirs: 1, frames: INC_N, active: 0, size: 2 * (INC_R + 12), draw: incendiaryGround },
    { key: "grenadeUlt.shellFeastCast", dirs: 1, frames: 10, active: 0, size: 160, draw: feastCast },
    { key: "grenadeUlt.shellFeast", dirs: 1, frames: FEAST_N, active: 0, size: 144, draw: feastSustain },
    { key: "grenadeUlt.shellFeastGround", dirs: 1, frames: FEAST_N, active: 0, size: 104, draw: feastGround },
  ],
};
