// 大筒（moveset "cannon"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、銃の作法は cannon.mjs / sidearm.mjs
// 単位は絵のドット（論理 0.5px）。数値は奥義の定義（周囲攻撃の半径・弾の半径・炸裂の半径）× 2 が目安
//
// 大筒の通常の絵は「太い扇の閃光・大きな煙の塊・刃の無い重い打撃」。奥義はそれより一段豪華にする:
//   - 大砲撃: 撃つ瞬間の特大の扇と前へ走る砲弾の筋 → 照準の先で茸雲の上がる大爆発と、焦げた地面の割れ目
//   - 全弾発射: 点火の導火線が輪を回る → 起爆の号令（地を這う導火の火花と脈の輪）→ 5 門の曲射が順に火を噴く
//     → 焼夷の砲弾（炎の尾を引く）が落ちて火の舌の残る炸裂
//   - 火薬庫: 足元で火薬が弾け、持続中は腰の周りを火縄の火花が回り、肩から硝煙が昇る。地面に至近の間合いの輪
// 決まり: 刃ではないので白（段 7）は閃光の芯と光点だけ。煙は段 2〜3、火球は段 6 までに抑える。振り終わりは崩れて消える
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 構えた筒口の位置（自分の中心から前へ。cannon.mjs の HAND と同じ） */
const HAND = 22;
/** 弾の絵の方向の数（尾のある細長い砲弾は 24 方向だと角のずれが見える） */
const SHOT_DIRS = 32;
/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 共通の部品（cannon.mjs / grenade.mjs の部品を写して、奥義の大きさに合わせて作り変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.5, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角 */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pad = w + 2;
  const ex = x + c * len;
  const ey = y + s * len;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s;
      if (along < -w * 0.6 || along > len) return -1;
      const u = Math.max(0, along) / len;
      const half = w * (1 - u) ** 0.9 + 0.35;
      const across = Math.abs(-dx * s + dy * c);
      if (across > half) return -1;
      const q = across / half;
      if (!survives(px, py, erosion, 1 - q, seed)) return -1;
      return clamp01((1 - q) ** 0.8 * (1.05 - 0.6 * u) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 円い閃光の芯（半径 r）。中心ほど明るい。cap で上限を抑えられる（大きな芯を白い面にしない） */
function flashCore(frame, x, y, r, bright = 1, cap = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > r) return -1;
      return Math.min(cap, clamp01((1 - d / r) ** 0.6 * bright));
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 前へ押し出す圧の弧（潰れた楕円の前側 ±spread だけ） */
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

/**
 * 扇の閃光: (x, y) から前（角 a）へ ±spread に開く n 本の太い針と、根元の扇形の塊（明部まで。白は芯だけ）
 */
function fanFlash(frame, o) {
  const { x = 0, y = 0, a = 0, spread, len, n, w, seed } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const ang = a + t * spread + (hash1(i, seed) - 0.5) * 0.12;
    const l = len * (1 - 0.42 * Math.abs(t) ** 1.4) * (0.82 + 0.3 * hash1(i, seed + 1));
    spike(frame, { x, y, a: ang, len: l, w: w * (1 - 0.3 * Math.abs(t)), bright: bright * (0.95 - 0.2 * Math.abs(t)), erosion, seed: seed + i });
  }
  const R = len * 0.42;
  const sp = spread + 8 * DEG;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const r = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - a;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      const t = Math.abs(da) / sp;
      if (t > 1) return -1;
      const rr = R * (1 - 0.45 * t * t);
      if (r > rr) return -1;
      if (!survives(px, py, erosion, 1 - r / rr, seed + 50)) return -1;
      return clamp01((1 - r / rr) ** 0.7 * 0.78 * bright * (1 - 0.3 * t));
    },
    { bounds: { x0: x - R - 2, y0: y - R - 2, x1: x + R + 2, y1: y + R + 2 } },
  );
}

/**
 * 煙・土煙の塊: (x, y) 中心、半径 r。縁はノイズで波打ち、erosion で中から抜ける。lit で上の面を少し明るく
 */
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
      // 縁の 1 ドットは暗部（煙の輪郭をくっきりさせる）
      const rim = q > 0.82 ? 0.55 : 1;
      const light = lit ? 1 + lit * (-dy / Math.max(1, edge)) : 1;
      return clamp01((0.55 + 0.45 * (1 - q) ** 0.7) * rim * light * bright * (1 - erosion * 0.35));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/**
 * 火球: 縁が瘤状に揺れる炎の塊。heat が下がるほど芯が消えて赤黒くなる。
 * cap（既定 0.84 = 段 6 まで）で芯を白い面にしない（白は別に置く光点だけ）
 */
function fireball(frame, o) {
  const { x = 0, y = 0, R, seed } = o;
  const heat = o.heat ?? 1;
  const erosion = o.erosion ?? 0;
  const cap = o.cap ?? 0.84;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const lobe = valueNoise(Math.cos(a) * 11, Math.sin(a) * 11, 2.2, seed) * 0.45 + Math.max(0, -dy / Math.max(1, d)) * 0.12;
      const edge = R * (0.72 + lobe);
      if (d > edge) return -1;
      const q = d / edge;
      if (erosion > 0 && valueNoise(px, py, 8, seed + 5) * 0.75 + (1 - q) * 0.35 - erosion * 1.15 < 0) return -1;
      // 中の渦（ノイズの筋）で平らな円に見せない。縁の 1 段を暗くして輪郭を締める
      const swirl = 0.78 + 0.34 * valueNoise(px + 40, py, 4.5, seed + 9);
      const core = (1 - q) ** 0.9;
      const rim = q > 0.9 ? 0.7 : 1;
      return Math.min(cap, clamp01((0.28 + core * (0.55 + 0.35 * heat)) * swirl * rim * (0.55 + 0.45 * heat)));
    },
    { bounds: { x0: x - R * 1.35 - 2, y0: y - R * 1.35 - 2, x1: x + R * 1.35 + 2, y1: y + R * 1.35 + 2 } },
  );
}

/** 重い破片: 2x2 の角ばった塊（上が明るく下が暗い） */
function chunk(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(2, level - 1));
  dot(frame, x, y + 1, Math.max(2, level - 1));
  dot(frame, x + 1, y + 1, Math.max(2, level - 2));
}

/** 衝撃の星: n 本のトゲ + 芯。白は芯の中心だけ */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.6) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  if ((o.core ?? 1) > 0.3) flashCore(frame, x, y, o.core ?? R * 0.28, bright, o.coreCap ?? 1);
}

/** 地面の楕円の輪（上下に潰した円 = 見下ろした地面の衝撃波） */
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
  for (let i = 0; i < n; i++) {
    const age = f - (o.from ?? 0);
    if (age < 0 || age > life) continue;
    const a = hash1(i, seed) * TAU;
    const sp = speed * (0.55 + 0.6 * hash1(i, seed + 1));
    const up = (o.lift ?? 3) * (0.5 + hash1(i, seed + 2));
    const x = Math.cos(a) * sp * age;
    const y = Math.sin(a) * sp * age * 0.75 - up * age + 0.5 * g * age * age;
    const fade = age / (life + 1);
    const level = Math.max(3, Math.round(6 - fade * 3));
    if (hash1(i, seed + 3) > 0.35) chunk(frame, x, y, level);
    else dot(frame, x, y, level);
  }
}

/**
 * 散弾の殻より大きな砲弾の薬莢: (x, y) に 6 ドットの筒。spin で 45° ずつ回る。口金の端が段 5
 */
function bigShell(frame, x, y, spin, fade = 0) {
  const k = ((spin % 4) + 4) % 4;
  const dirs = [
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
  ];
  const [cx, cy] = dirs[k] ?? [1, 0];
  const hi = Math.max(3, 5 - Math.round(fade * 2));
  const nx = -cy;
  const ny = cx;
  for (let j = -2; j <= 3; j++) {
    const lv = j === 3 ? hi : Math.max(2, hi - 1 - (j < 0 ? 1 : 0));
    for (let s = -1; s <= 1; s++) dot(frame, x + cx * j + nx * s * 0.9, y + cy * j + ny * s * 0.9, s === 0 ? lv : Math.max(2, lv - 1));
  }
}

/**
 * 火の舌: 根元 (x, y) から画面の上（−y）へ揺れながら細る炎 1 本（dirs 1 の絵用）。
 * 炎は段 5 まで、根元ほど明るい（白を使わない）
 */
function flameTongue(frame, o) {
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
      const cx = bx + Math.sin(t * 5 + phase) * 1.6 * t;
      const half = (w / 2) * Math.pow(1 - t, 1.1) * Math.min(1, (t + 0.15) / 0.3);
      const d = Math.abs(x - cx);
      if (half < 0.5 || d > half) return -1;
      const q = d / half;
      if (!survives(x, y, erosion + t * 0.3, 1 - q, seed)) return -1;
      return Math.min(0.72, clamp01(((1 - q) ** 0.8 * (0.5 + 0.5 * (1 - t))) * bright));
    },
    { bounds: { x0: bx - w - 3, y0: by - h - 1, x1: bx + w + 3, y1: by + 1 } },
  );
}

/** 画面に揃えて昇る細い煙（dirs 1 のシート用）。段 2〜3 だけ */
function smokeWisp(frame, o) {
  const { x0, y0, height, width, age, seed } = o;
  const sway = o.sway ?? 3;
  const bright = o.bright ?? 0.34;
  const rise = age * (o.rise ?? 8);
  paint(
    frame,
    (x, y) => {
      const h = y0 - rise - y;
      if (h < 0 || h > height) return -1;
      const u = h / height;
      const cx = x0 + Math.sin(u * 5.2 + seed + age * 3) * sway * u + (o.lean ?? 0) * u;
      const w = width * (0.6 + 0.8 * u);
      const d = Math.abs(x - cx);
      if (d > w) return -1;
      if (valueNoise(x, y + rise, 2.6, seed) * 0.8 + (1 - u) * 0.3 - (o.thin ?? 0) - u * 0.25 < 0) return -1;
      return clamp01(bright * (1 - d / w) ** 0.5 * (1 - u * 0.4));
    },
    { bounds: { x0: x0 - sway - width * 3 - 6, y0: y0 - rise - height - 1, x1: x0 + sway + width * 3 + 6 + Math.abs(o.lean ?? 0), y1: y0 - rise + 1 }, samples: 2 },
  );
}

/**
 * ぎざぎざの割れ目・導火の筋: 中心から角 a へ r0..r1 の折れ線（節ごとにハッシュで横へ振る）。
 * grow（0..1）で先へ伸びる。明るさは head（先端）が明るく根元へ暗くなる
 */
function jagLine(frame, o) {
  const { a, r0, r1, seed } = o;
  const grow = o.grow ?? 1;
  const segs = o.segs ?? 6;
  const jitter = o.jitter ?? 5;
  const width = o.width ?? 1.4;
  const hi = o.bright ?? 0.6;
  const lo = o.dim ?? hi * 0.5;
  const squash = o.squash ?? 1;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const end = r0 + (r1 - r0) * grow;
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const r = r0 + ((r1 - r0) * i) / segs;
    if (r > end + 1e-6 && prev) {
      // 最後の節は先端まで途中で切る
      const t = (end - prev.r) / Math.max(1e-3, r - prev.r);
      const off = i === 0 ? 0 : (hash1(i, seed) - 0.5) * 2 * jitter;
      const px = prev.x + ((c * r - s * off) - prev.x) * t;
      const py = prev.y + ((s * r + c * off) * squash - prev.y) * t;
      streakLine(frame, { ax: prev.x, ay: prev.y, bx: px, by: py, width, bright: hi });
      break;
    }
    const off = i === 0 ? 0 : (hash1(i, seed) - 0.5) * 2 * jitter;
    const x = c * r - s * off;
    const y = (s * r + c * off) * squash;
    if (prev) streakLine(frame, { ax: prev.x, ay: prev.y, bx: x, by: y, width, bright: lo + (hi - lo) * (i / segs) });
    prev = { x, y, r };
  }
}

// -----------------------------------------------------------------------------
// 大砲撃（nova 半径 60・照準の先 110）: 特大の一発と、照準の先の茸雲の大爆発
// -----------------------------------------------------------------------------

/** 発動の絵が前へ届く限り（作業面 240 の半分より内側。砲弾の筋はここで絵の外へ抜けた扱い） */
const CAST_REACH = 112;
/** 大爆発の半径（60 論理 px × 2） */
const SHELL_R = 120;
const SHELL_N = 14;

/**
 * 大砲撃の発動（自分の位置、+x = 照準）: 通常の至近撃ちより長い特大の扇の閃光と、前へ走る砲弾の筋、
 * 押し出す圧の弧 2 枚、後ろへ抜ける反動の煙、大きな薬莢
 */
function grandShellCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = [1, 0.8, 0.45][f] ?? 0.4;
    fanFlash(frame, { x: HAND, spread: 38 * DEG, len: 96 * s, n: 11, w: 8 * s, seed: 5101, bright: 1 });
    flashCore(frame, HAND, 0, 13 * s, 1, f === 0 ? 1 : 0.84);
    if (f === 0) sparkle(frame, HAND + 4, 0, 4);
  }
  // 砲弾の筋: 1 本の太い曳光が前へ走り抜け、尾から痩せて消える（二重にしない）
  if (f <= 3) {
    const head = Math.min(CAST_REACH, HAND + 50 + f * 24);
    const tail = Math.max(HAND + 6, head - 64 + f * 12);
    lens(frame, { ax: tail, ay: 0, bx: head, by: 0, T: 7 - f * 0.9, bias: 0, erosion: f < 2 ? 0 : 0.15 * (f - 1), seed: 5102, bright: 1 - f * 0.1 });
    if (f <= 2) sparkle(frame, head - 2, 0, f === 0 ? 3 : 2);
  }
  // 押し出す圧の弧（時間差ではっきり分けた 2 枚）
  if (f >= 1 && f <= 6) {
    const age = f - 1;
    frontArc(frame, { ox: HAND + 4, radius: 24 + age * 12, width: 3.4 - age * 0.35, squash: 0.55, spread: 55 * DEG, erosion: Math.min(0.9, age * 0.15), bright: 0.72 - age * 0.07, seed: 5103 });
  }
  if (f >= 3 && f <= 8) {
    const age = f - 3;
    frontArc(frame, { ox: HAND + 2, radius: 16 + age * 10, width: 2.4, squash: 0.55, spread: 50 * DEG, erosion: Math.min(0.92, age * 0.18), bright: 0.55 - age * 0.06, seed: 5104 });
  }
  // 硝煙: 筒口の前に大きく膨らむ雲と、反動で後ろへ抜ける雲
  if (f >= 1) {
    const t = (f - 1) / (N - 2);
    // 前の雲は距離をばらして重ね、平たい板ではなく丸く盛り上がる塊にする
    for (let i = 0; i < 9; i++) {
      const a = (hash1(i, 5108) - 0.5) * 90 * DEG;
      const d = 10 + 34 * hash1(i, 5105) + t * 24;
      puff(frame, HAND + Math.cos(a) * d, Math.sin(a) * d, (7 + 6 * hash1(i, 5106)) * (0.7 + t * 0.6), { bright: 0.36 - t * 0.1, seed: 5107 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.5, lit: 0.3 });
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 45 * DEG;
      const d = 12 + t * 14;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (8 + (i % 2) * 2) * (0.7 + t * 0.6), { bright: 0.32 - t * 0.08, seed: 5115 + i, rough: 0.3, erosion: Math.max(0, t - 0.3) * 1.6 });
    }
  }
  // 大きな薬莢が横へ跳んで回る
  if (f >= 1 && f <= 8) {
    const t = f - 1;
    bigShell(frame, 4 - t * 2.5, 8 + t * 4.5 - 0.25 * t * t, t, t / 9);
  }
  shards(frame, f, 18, 5120, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.2;
    const sp = 4 + rnd(2) * 5;
    return { x: HAND + 6, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
  });
  void k;
}

/**
 * 大砲撃の爆発（dirs 1、原点 = 爆発の中心、base 60）:
 * 0: 大きな閃光の星 → 1〜6: 瘤の膨らむ火球が昇り、地面の衝撃の輪が半径まで走る →
 * 4〜: 黒煙の輪が外へ這い、中心から茸雲の柱と笠が昇る → 土塊が放物線で飛び、火の粉が舞う
 */
function grandShellBlast(frame, f) {
  const N = SHELL_N;
  const k = f / (N - 1);
  if (f === 0) {
    bluntStar(frame, { R: SHELL_R * 0.95, n: 12, seed: 5201, w: 8, core: 44, coreCap: 0.84 });
    flashCore(frame, 0, 0, 14, 1);
    sparkle(frame, 0, 0, 4);
  }
  if (f === 1) {
    bluntStar(frame, { R: SHELL_R * 0.7, n: 10, seed: 5202, w: 6, core: 0, bright: 0.8, erosion: 0.3 });
  }
  // 火球: 1〜7 で膨らみながら少し昇り、熱が引いて赤黒く崩れる
  if (f >= 1 && f <= 8) {
    const t = (f - 1) / 7;
    fireball(frame, { x: 0, y: -4 - f * 3, cap: 0.74, R: 60 + 26 * easeSwing(Math.min(1, t * 1.5)), seed: 5203, heat: 1 - t * 0.9, erosion: Math.max(0, t - 0.45) * 1.4 });
    if (f <= 2) sparkle(frame, -10, -18 - f * 3, 2);
  }
  // 地面の衝撃の輪: 速く外へ、爆発の半径で消える（1 本）
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    groundRing(frame, { r: 44 + (SHELL_R + 2 - 44) * easeSwing(t), width: 6 - t * 3, erosion: t * 0.7, bright: 0.85 - t * 0.25, seed: 5204 });
  }
  // 黒煙の輪: 18 個の塊が外へ這う
  if (f >= 4) {
    const t = (f - 4) / (N - 4);
    const rr = 56 + 56 * easeSwing(Math.min(1, t * 1.3));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + hash1(i, 5205) * 0.2;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, (18 + hash1(i, 5206) * 7) * (0.8 + t * 0.3), { bright: 0.26 - t * 0.05, seed: 5207 + i, rough: 0.35, erosion: Math.max(0, t - 0.3) * 1.3, lit: 0.35 });
    }
  }
  // 茸雲: 柱が昇り、上に笠が広がる
  if (f >= 5) {
    const t = (f - 5) / (N - 5);
    const lift = t * 40;
    for (let i = 0; i < 4; i++) {
      const y = -24 - i * 18 - lift;
      puff(frame, (i % 2 === 0 ? -2 : 3), y, (18 - i * 2) * (0.8 + t * 0.4), { bright: 0.3 - t * 0.06, seed: 5230 + i, rough: 0.35, erosion: Math.max(0, t - 0.4) * 1.4 + i * 0.04, lit: 0.45 });
    }
    const capY = -96 - lift;
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 16 * (1 + t * 0.4);
      puff(frame, x, capY + Math.abs(i - 2) * 5, (21 - Math.abs(i - 2) * 2) * (0.8 + t * 0.4), { bright: 0.34 - t * 0.08, seed: 5240 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.4, lit: 0.55 });
    }
  }
  // 土煙が低く横へ這う
  if (f >= 2) {
    const t = (f - 2) / (N - 2);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (60 + Math.floor(i / 2) * 18 + t * 26);
      const y = 30 + Math.floor(i / 2) * 5 - t * 6;
      puff(frame, x, y, (10 + Math.floor(i / 2) * 2) * (0.7 + t * 0.6), { bright: 0.4 - t * 0.14, seed: 5250 + i, rough: 0.4, erosion: Math.max(0, t - 0.4) * 1.5, lit: 0.3 });
    }
  }
  debris(frame, f, { n: 26, seed: 5260, speed: 11, g: 2, lift: 7, life: 9, from: 1 });
  // 火の粉: 火球の周りから舞い上がる
  if (f >= 2 && f <= 11) {
    for (let i = 0; i < 18; i++) {
      if (hash1(i, 5270) < k * 0.9) continue;
      const a = hash1(i, 5271) * TAU;
      const d = 50 + f * 6 + hash1(i, 5272) * 20;
      dot(frame, Math.cos(a) * d, Math.sin(a) * d * 0.75 - f * 4, Math.max(3, 7 - Math.floor(f / 2)));
    }
  }
}

/**
 * 大爆発の地面（キャラの下）: 焦げた穴（段 1〜2 のむら）と、中心から走る赤熱の割れ目。熱が引いて暗くなり薄れる
 */
function grandShellGround(frame, f) {
  const N = SHELL_N;
  const grow = Math.min(1, (f + 1) / 3);
  const t = f < 5 ? 0 : (f - 4) / (N - 5);
  // 焦げ跡: 楕円のむら
  const R = 70 * grow;
  if (R > 2) {
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y / 0.72) / R;
        const n = valueNoise(x, y, 7, 5301);
        if (d > 0.75 + n * 0.4) return -1;
        if (valueNoise(x, y, 5, 5302) * 0.8 + (1 - d) * 0.4 - t * 1.1 < 0) return -1;
        // 焦げは段 1〜2 だけ（赤い面に見せない）。細かいむらで穴を空ける
        const m = valueNoise(x, y, 2.5, 5303);
        if (m < 0.3) return -1;
        return 0.06 + 0.12 * m;
      },
      { bounds: { x0: -R * 1.2, y0: -R, x1: R * 1.2, y1: R }, samples: 2 },
    );
  }
  // 割れ目: 10 本。先端が赤熱し、時間とともに暗くなる
  const heat = 1 - t;
  if (heat <= 0.05) return;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + (hash1(i, 5310) - 0.5) * 0.4;
    const len = (60 + 50 * hash1(i, 5311)) * easeSwing(Math.min(1, (f + 1) / 4));
    jagLine(frame, { a, r0: 10, r1: 10 + len, grow: 1, segs: 6, jitter: 6, width: i % 3 === 0 ? 2 : 1.4, squash: 0.72, bright: 0.66 * heat, dim: 0.36 * heat, seed: 5320 + i * 7 });
  }
}

// -----------------------------------------------------------------------------
// 全弾発射（起爆 + 曲射 5 発）
// -----------------------------------------------------------------------------

/** 点火の輪の半径 */
const FUSE_R = 28;

/**
 * 全弾発射の発動（dirs 1、自分の位置）: 火縄の火が足元の輪を一周し（燃えた跡は暗い粒）、輪が閉じると弾けて
 * 火の粉が四方へ散る。大砲撃の扇の閃光と見分ける「点火」の絵
 */
function fullSalvoCast(frame, f) {
  const RUN = 5;
  if (f < RUN) {
    const p = easeSwing((f + 1) / RUN);
    const head = -Math.PI / 2 + TAU * p;
    // 燃えた跡: 輪に沿った粒。孤立した暗い粒は掃除で消えるので、2 ドットの組で置き段 3 以上にする
    const steps = Math.floor(p * 36);
    for (let i = 0; i < steps; i++) {
      const a = -Math.PI / 2 + (i / 36) * TAU;
      const recent = (steps - i) / 36;
      const lvl = recent < 0.08 ? 6 : recent < 0.22 ? 5 : 3;
      const x = Math.cos(a) * FUSE_R;
      const y = FEET_Y + Math.sin(a) * FUSE_R * 0.55;
      dot(frame, x, y, lvl);
      dot(frame, x + 1, y, Math.max(3, lvl - 1));
    }
    // 火の頭と、そこから跳ねる火花
    const hx = Math.cos(head) * FUSE_R;
    const hy = FEET_Y + Math.sin(head) * FUSE_R * 0.55;
    sparkle(frame, hx, hy, f === RUN - 1 ? 3 : 2);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (hash1(i + f * 5, 5401) - 0.5) * 2.2;
      const d = 3 + hash1(i + f * 5, 5402) * 6;
      dot(frame, hx + Math.cos(a) * d, hy + Math.sin(a) * d, 5 - (i % 2));
    }
    return;
  }
  const k = (f - RUN) / 3;
  groundRing(frame, { oy: FEET_Y, r: FUSE_R + k * 26, width: 4 - k * 2, squash: 0.55, erosion: Math.min(0.9, k * 0.8), bright: 0.85 - k * 0.3, seed: 5404 });
  if (f === RUN) {
    bluntStar(frame, { y: FEET_Y, R: 22, n: 8, seed: 5406, w: 2.4, core: 4 });
    sparkle(frame, 0, FEET_Y, 4);
  }
  shards(frame, f - RUN, 20, 5405, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 4 + rnd(2) * 4;
    return { x: Math.cos(a) * FUSE_R, y: FEET_Y + Math.sin(a) * FUSE_R * 0.55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 2.5, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

/** 起爆の号令の広がる半径（床の設置弾へ届く見当。論理 60px） */
const SIGNAL_R = 120;
const SIGNAL_N = 11;

/**
 * 全弾発射の起爆（dirs 1、自分の位置）: 足元から 8 本の導火の火花が地を這って外へ走り（ぎざぎざの燃えた跡を残す）、
 * それを追う脈の輪が 2 度、時間を分けて広がる（床の設置弾へ起爆が届く合図）
 */
function fullSalvoDetonate(frame, f) {
  const N = SIGNAL_N;
  // 導火の筋: 先端の火花が外へ走り、跡は根元から冷めて消える
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8 + (hash1(i, 5501) - 0.5) * 0.3;
    const grow = Math.min(1, (f + 1) / 6);
    const cool = Math.max(0, (f - 5) / (N - 6));
    if (cool >= 1) continue;
    const len = SIGNAL_R * (0.8 + 0.2 * hash1(i, 5502));
    const r0 = 12 + len * cool * 0.8;
    const r1 = 12 + len * grow;
    if (r1 - r0 < 4) continue;
    jagLine(frame, { a, r0, r1, grow: 1, segs: 7, jitter: 5, width: 1.4, squash: 0.72, bright: 0.72 * (1 - cool * 0.6), dim: 0.3, seed: 5510 + i * 9 });
    if (grow < 1 || f === 6) {
      const hx = Math.cos(a) * r1;
      const hy = Math.sin(a) * r1 * 0.72;
      sparkle(frame, hx, hy, i % 2 === 0 ? 2 : 1);
      dot(frame, hx - Math.cos(a) * 3, hy - 2, 5);
    }
  }
  // 脈の輪: はっきり時間を分けた 2 度（1 本目が崩れはじめてから 2 本目）
  const pulse = (start, seed) => {
    const age = f - start;
    if (age < 0 || age > 6) return;
    const t = age / 6;
    groundRing(frame, { r: 16 + (SIGNAL_R - 16) * easeSwing(t), width: 3.2 - t * 1.6, erosion: t * 0.85, bright: 0.72 - t * 0.3, seed });
  };
  pulse(0, 5520);
  pulse(4, 5521);
  // 中心: 号令の一瞬の閃き
  if (f <= 1) {
    bluntStar(frame, { R: 22 - f * 6, n: 8, seed: 5530, w: 2.6, core: 5, bright: 1 - f * 0.2 });
    if (f === 0) sparkle(frame, 0, 0, 3);
  }
  shards(frame, f, 14, 5540, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.72 - 1, life: 4, size: 1 };
  });
}

/** 曲射 5 門の筒口の角（照準からの開き。扇の見た目を少し広げて 5 本を見分ける） */
const SALVO_ANGLES = [-26, -13, 0, 13, 26].map((d) => d * DEG);
/** 5 門が火を噴く順（中央から外へ）と、1 門ごとの遅れ（フレーム） */
const SALVO_ORDER = [2, 1, 3, 0, 4];
const SALVO_STEP = 0.8;

/**
 * 全弾発射の一斉射（DIRS、自分の位置、+x = 照準）: 5 門が中央から外へ順に火を噴く（短い太い閃光と、
 * 空へ昇る打ち上げの煙の筋）。足元に踏ん張った土煙
 */
function fullSalvoVolley(frame, f) {
  const N = 11;
  SALVO_ORDER.forEach((slot, order) => {
    const a = SALVO_ANGLES[slot] ?? 0;
    const age = f - order * SALVO_STEP;
    if (age < 0) return;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const mx = HAND * c;
    const my = HAND * s;
    // 閃光: 短く太い 1 本の火柱 + 左右の小さな針（曲射の「どん」）
    if (age < 1.6) {
      const k = age < 0.8 ? 1 : 0.6;
      spike(frame, { x: mx, y: my, a, len: 36 * k, w: 7 * k, bright: 1, seed: 5601 + slot });
      spike(frame, { x: mx, y: my, a: a - 55 * DEG, len: 10 * k, w: 3 * k, bright: 0.8, seed: 5602 + slot });
      spike(frame, { x: mx, y: my, a: a + 55 * DEG, len: 10 * k, w: 3 * k, bright: 0.8, seed: 5603 + slot });
      flashCore(frame, mx, my, 7 * k, 1, age < 0.8 ? 1 : 0.84);
    }
    // 打ち上げの煙: 筒口から前へ、弾の昇る筋に沿って伸びる塊の列（遠いほど小さく薄い）
    const t = Math.min(1, age / 7);
    const reach = Math.min(1, (age + 1) / 3);
    for (let j = 0; j < 4; j++) {
      const u = (j + 1) / 4;
      if (u > reach) continue;
      const d = HAND + 8 + u * 58;
      const r = (7 - j * 1.2) * (0.7 + t * 0.6);
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, r, { bright: 0.36 - j * 0.03 - t * 0.1, seed: 5610 + slot * 7 + j, rough: 0.3, erosion: Math.max(0, t - 0.3) * 1.5 + j * 0.05, lit: 0.3 });
    }
  });
  // 足元の踏ん張りの土煙（左右）
  if (f >= 1) {
    const t = (f - 1) / (N - 2);
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      puff(frame, -10 - Math.floor(i / 2) * 8 - t * 10, side * (16 + t * 8), (6 + Math.floor(i / 2)) * (0.7 + t * 0.5), { bright: 0.3 - t * 0.08, seed: 5630 + i, erosion: Math.max(0, t - 0.4) * 1.5 });
    }
  }
  // 火の粉: 各筒口から前へ
  shards(frame, f, 22, 5640, (i, rnd) => {
    const slot = i % 5;
    const a = (SALVO_ANGLES[slot] ?? 0) + (rnd(1) - 0.5) * 0.7;
    const sp = 3.5 + rnd(2) * 4;
    return { x: HAND * Math.cos(a) + 3, y: HAND * Math.sin(a), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

// --- 全弾発射の焼夷砲弾（曲射。radius 4、blastRadius 28） ---

/** 焼夷砲弾の数値。len = 全長、half = 胴の半幅（半径 4 = 8 ドット前後に合わせる）、tail = 炎の尾の長さ */
const SALVO_SHELL = { len: 20, half: 6.4, tail: 26, frames: 8, period: 0.32 };
/** 炸裂の半径（blastRadius 28 = 56 ドット） */
const SALVO_BLAST_R = 56;

/**
 * 焼夷砲弾の飛行（32 方向、原点 = 弾の中心、+x = 進む向き）: 尖った頭・太い胴・尾翼の砲弾。
 * 胴の帯と頭が赤熱し、後ろへ揺れる炎の尾と火の粉・煙の粒を引く（通常の曲射弾より大きく、燃えている）
 */
function salvoShellFly(frame, f) {
  const g = SALVO_SHELL;
  const L = g.len;
  const H = g.half;
  const flick = f / g.frames;
  // 炎の尾（胴より後ろ）: 3 本の舌が位相をずらして伸び縮みする
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * H * 0.5;
    const ph = (flick + i / 3) % 1;
    const len = g.tail * (0.65 + 0.35 * Math.sin(ph * TAU) ** 2) * (i === 1 ? 1 : 0.7);
    const x0 = -L * 0.45;
    paint(
      frame,
      (x, y) => {
        const u = (x0 - x) / len;
        if (u < 0 || u > 1) return -1;
        const cy = off * (1 - u * 0.4) + Math.sin(u * 7 + ph * TAU + i) * 1.4 * u;
        const half = H * (i === 1 ? 0.62 : 0.4) * (1 - u) ** 0.8;
        const d = Math.abs(y - cy);
        if (half < 0.45 || d > half) return -1;
        return Math.min(0.8, clamp01((1 - d / half) ** 0.7 * (0.95 - 0.7 * u)));
      },
      { bounds: { x0: x0 - len - 2, y0: -H - 4, x1: x0 + 2, y1: H + 4 } },
    );
  }
  // 砲弾の体: 丸い頭 → 太い胴 → 細る尾 → 尾翼。上（−y）の面が光る
  paint(
    frame,
    (x, y) => {
      let inside = false;
      let shade = 0;
      if (x >= 0) inside = Math.hypot(x / (L * 0.5), y / H) <= 1;
      else if (x >= -L * 0.55) inside = Math.abs(y) <= H * (1 - ((-x) / (L * 0.55)) ** 1.6 * 0.5);
      if (x < -L * 0.4 && x > -L * 0.62 && Math.abs(y) <= H * 1.15) {
        inside = true;
        shade = -0.16;
      }
      if (!inside) return -1;
      // 赤熱の帯（信管の継ぎ目）と頭
      if (Math.abs(x - L * 0.1) < 1.1) shade = 0.18;
      const light = clamp01(0.5 - 0.5 * (y / H));
      const tipHeat = x > L * 0.32 ? 0.12 : 0;
      return clamp01(0.3 + 0.38 * light + shade + tipHeat);
    },
    { bounds: { x0: -L * 0.7, y0: -H * 1.3, x1: L * 0.55 + 1, y1: H * 1.3 } },
  );
  dot(frame, L * 0.18, -H * 0.55, 7);
  // 火の粉と煙の粒: 尾の先からこぼれて後ろへ流れる（フレームで位置が送られる）
  for (let i = 0; i < 5; i++) {
    const ph = (flick + hash1(i, 5701)) % 1;
    const x = -L * 0.5 - g.tail * (0.4 + 0.9 * ph);
    const y = (hash1(i, 5702) - 0.5) * H * 1.6 + Math.sin(ph * TAU + i) * 1.2;
    dot(frame, x, y, ph < 0.4 ? 6 : ph < 0.7 ? 4 : 2);
  }
}

/**
 * 焼夷砲弾の発射（DIRS、原点 = 筒口の先）: 丸い太い閃光と前の短い火柱、筒口の周りに燃える火の輪（焼夷の印）、
 * どっと吹く白煙。一斉射でも 1 つにまとめて出るので、大きめに描く
 */
function salvoShellMuzzle(frame, f) {
  const N = 7;
  const t = f / (N - 1);
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.65;
    flashCore(frame, 0, 0, 11 * s, 1, f === 0 ? 1 : 0.84);
    spike(frame, { x: 0, a: 0, len: 26 * s, w: 8 * s, bright: 1 });
    spike(frame, { x: 0, a: -45 * DEG, len: 12 * s, w: 4 * s, bright: 0.85 });
    spike(frame, { x: 0, a: 45 * DEG, len: 12 * s, w: 4 * s, bright: 0.85 });
    if (f === 0) sparkle(frame, 2, 0, 4);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    ring(frame, { ox: 2 + age * 2, radius: 8 + age * 5, width: 2.6, squash: 0.5, erosion: Math.min(0.9, age * 0.2), bright: 0.75 - age * 0.1, seed: 5710 });
  }
  const blobs = [
    { a: 0, d: 12, r: 11 },
    { a: -35 * DEG, d: 9, r: 8 },
    { a: 35 * DEG, d: 9, r: 8 },
    { a: -80 * DEG, d: 6, r: 6 },
    { a: 80 * DEG, d: 6, r: 6 },
  ];
  blobs.forEach((b, i) => {
    if (f === 0 && i > 2) return;
    const d = b.d + f * (i === 0 ? 5 : 3);
    puff(frame, Math.cos(b.a) * d, Math.sin(b.a) * d, b.r * (0.6 + t * 0.7), { bright: 0.62 - t * 0.24, seed: 5720 + i, rough: 0.35, erosion: Math.max(0, t - 0.45) * 1.6, lit: 0.3 });
  });
  shards(frame, f, 12, 5730, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.4;
    const sp = 3 + rnd(2) * 4;
    return { x: 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.6 ? 2 : 1 };
  });
}

/**
 * 焼夷砲弾の着弾（DIRS、原点 = 消えた位置）: 落ちる前に当たった衝突。平たい閃き・後ろへ跳ねる破片と火の粉・小さな煙
 */
function salvoShellImpact(frame, f) {
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -12, bx: -1, by: 12, T: f === 0 ? 6 : 3.6, bias: 0, bright: 0.95 });
    flashCore(frame, 0, 0, 5, 1, f === 0 ? 1 : 0.84);
    if (f === 0) sparkle(frame, 0, 0, 3);
  }
  shards(frame, f, 14, 5740, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3.5 * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.8 };
  });
  if (f >= 1) {
    const t = (f - 1) / 5;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 55 * DEG;
      const d = 5 + f * 2.4;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (4.4 + (i % 2) * 1.4) * (0.8 + t * 0.6), { bright: 0.4 - t * 0.1, seed: 5745 + i, erosion: Math.max(0, t - 0.45) * 1.4 });
    }
  }
}

/**
 * 焼夷砲弾の炸裂（dirs 1、原点 = 炸裂の中心、blastBase 28）: 通常の曲射より一段大きい。
 * 0: 星形の閃光 → 1〜4: 火球 → 2〜: 地面の輪 → 3〜: 炸裂の円の中に火の舌が次々に立って燃え残り、
 * 煙の輪がゆっくり広がる。焼夷なので土塊より火の粉が多い
 */
function salvoShellBlast(frame, f) {
  const N = 12;
  const R = SALVO_BLAST_R;
  if (f === 0) {
    bluntStar(frame, { R: R * 1.05, n: 10, seed: 5801, w: 5.5, core: 22, coreCap: 0.84 });
    flashCore(frame, 0, 0, 7, 1);
    sparkle(frame, 0, 0, 4);
  }
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    fireball(frame, { x: 0, y: -2 - f * 2, R: 34 + 14 * easeSwing(Math.min(1, t * 1.6)), seed: 5802, heat: 1 - t * 0.85, erosion: Math.max(0, t - 0.5) * 1.4 });
  }
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    groundRing(frame, { r: 22 + (R + 2 - 22) * easeSwing(t), width: 4.5 - t * 2, erosion: t * 0.75, bright: 0.8 - t * 0.25, seed: 5803 });
  }
  // 燃え残る火の舌: 炸裂の円の中に 9 本。遅れて立ち、揺れて痩せて消える
  if (f >= 3) {
    for (let i = 0; i < 9; i++) {
      const a = hash1(i, 5810) * TAU;
      const d = R * (0.2 + 0.7 * hash1(i, 5811));
      const born = 3 + Math.floor(hash1(i, 5812) * 3);
      const age = f - born;
      if (age < 0) continue;
      const life = 6;
      if (age > life) continue;
      const u = age / life;
      const h = (24 + 12 * hash1(i, 5813)) * Math.sin(Math.PI * Math.min(1, (age + 1) / (life + 1)));
      flameTongue(frame, { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 + 6, h, w: 9 + 3 * hash1(i, 5814), phase: age * 1.3 + i, bright: 1 - u * 0.4, erosion: u * 0.6, seed: 5820 + i });
    }
  }
  // 煙の輪
  if (f >= 4) {
    const t = (f - 4) / (N - 4);
    const rr = 32 + 26 * easeSwing(Math.min(1, t * 1.3));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash1(i, 5830) * 0.3;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, (11 + hash1(i, 5831) * 4) * (0.8 + t * 0.3), { bright: 0.24 - t * 0.04, seed: 5832 + i, rough: 0.35, erosion: Math.max(0, t - 0.25) * 1.3, lit: 0.35 });
    }
  }
  // 火の粉: 上へ舞い上がる
  for (let i = 0; i < 16; i++) {
    const age = f - 1;
    if (age < 0) continue;
    const a = hash1(i, 5840) * TAU;
    const sp = 4 + 4 * hash1(i, 5841);
    const life = 5 + Math.floor(hash1(i, 5842) * 5);
    if (age > life) continue;
    const x = Math.cos(a) * sp * age * 0.9;
    const y = Math.sin(a) * sp * age * 0.6 - 2.5 * age + 0.25 * age * age;
    dot(frame, x, y, Math.max(3, 7 - Math.floor((age / life) * 4)));
  }
  debris(frame, f, { n: 8, seed: 5850, speed: 6, g: 1.6, lift: 4, life: 6, from: 1 });
}

// -----------------------------------------------------------------------------
// 火薬庫（持続。散弾 +1・速射・至近の傷）
// -----------------------------------------------------------------------------

/** 至近の間合い（pointBlank.range 60 論理 px × 2）。地面の輪で「ここまで近いと強い」を見せる */
const POINT_R = 120;
const KEG_N = 12;

/**
 * 火薬庫の発動（dirs 1、自分の位置）: 足元で火薬が弾ける。閃光 → 低く広がる硝煙の輪と地面の輪 →
 * 火の粉が上へ噴き、肩の高さに火縄の火花が 2 つ灯る（持続の纏いへつなぐ）
 */
function powderKegCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  if (f <= 1) {
    bluntStar(frame, { y: FEET_Y - 4, R: 40 - f * 12, n: 10, seed: 5901, w: 4, core: 8, bright: 1 - f * 0.2, rot: 0.2 });
    if (f === 0) sparkle(frame, 0, FEET_Y - 4, 4);
  }
  // 地面の輪: 至近の間合いまで広がる
  if (f >= 1 && f <= 7) {
    const t = (f - 1) / 6;
    groundRing(frame, { oy: FEET_Y, r: 20 + (POINT_R - 20) * easeSwing(t), width: 4 - t * 2.2, squash: 0.5, erosion: t * 0.8, bright: 0.78 - t * 0.28, seed: 5902 });
  }
  // 低く広がる硝煙の輪
  if (f >= 1) {
    const t = (f - 1) / (N - 2);
    const rr = 16 + 40 * easeSwing(Math.min(1, t * 1.3));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash1(i, 5903) * 0.3;
      puff(frame, Math.cos(a) * rr, FEET_Y + Math.sin(a) * rr * 0.45, (9 + hash1(i, 5904) * 4) * (0.8 + t * 0.4), { bright: 0.3 - t * 0.06, seed: 5905 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.4, lit: 0.3 });
    }
  }
  // 噴き上がる火の粉: 足元から上へ、しだいに減速して落ちる
  for (let i = 0; i < 26; i++) {
    const age = f - Math.floor(hash1(i, 5920) * 2);
    const life = 5 + Math.floor(hash1(i, 5921) * 4);
    if (age < 0 || age > life) continue;
    const vx = (hash1(i, 5922) - 0.5) * 7;
    const vy = -(6 + 5 * hash1(i, 5923));
    const x = vx * age;
    const y = FEET_Y - 4 + vy * age + 0.7 * age * age;
    dot(frame, x, y, Math.max(3, 7 - Math.floor((age / life) * 4)));
    if (age < life * 0.5) dot(frame, x - vx * 0.3, y - vy * 0.3, 4);
  }
  // 火縄の火が灯る（纏いの火花の位置）
  if (f >= 5) {
    const s = f === 5 ? 3 : 2;
    sparkle(frame, -KEG_RX, KEG_Y, s);
    sparkle(frame, KEG_RX, KEG_Y, s);
  }
  void k;
}

/** 纏いの火縄の火花が回る楕円（腰の高さ。キャラの輪郭の外側） */
const KEG_RX = 28;
const KEG_RY = 11;
const KEG_Y = 6;

/**
 * 火薬庫の纏い（dirs 1、持続中ずっと）: 腰の周りの楕円を 2 つの火縄の火花が向かい合って回り、短い燃え跡を引く
 * （前を通るときは明るく、後ろでは暗い = 奥行き）。両肩から硝煙が細く昇り、ときどき火の粉が弾ける。
 * 1 巡で位相が一周するので継ぎ目が出ない
 */
function powderKegSustain(frame, f) {
  const cycle = f / KEG_N;
  for (let s = 0; s < 2; s++) {
    const head = cycle * TAU + s * Math.PI;
    // 燃え跡: 頭の後ろ 0.9 rad ぶん、粒を間隔を空けて置く
    // 燃え跡: 頭の後ろ 1.6 rad ぶん、途切れない細い弧（先ほど明るい。後ろ側を通るときは 1 段暗い）
    for (let j = 0; j < 22; j++) {
      const a = head - j * 0.075;
      const x = Math.cos(a) * KEG_RX;
      const y = KEG_Y + Math.sin(a) * KEG_RY;
      const back = Math.sin(a) < 0 ? 1 : 0;
      const lvl = Math.max(3, 6 - Math.floor(j / 5) - back);
      dot(frame, x, y, lvl);
      if (j < 6) dot(frame, x, y - 1, Math.max(3, lvl - 1));
    }
    const hx = Math.cos(head) * KEG_RX;
    const hy = KEG_Y + Math.sin(head) * KEG_RY;
    const front = Math.sin(head) > -0.2;
    sparkle(frame, hx, hy, front ? 2 : 1);
    // 頭から跳ねる小さな火花（上へ）
    for (let i = 0; i < 2; i++) {
      const d = 2 + hash1(i + f * 3 + s * 17, 6001) * 4;
      const a = -Math.PI / 2 + (hash1(i + f * 3 + s * 17, 6002) - 0.5) * 1.6;
      dot(frame, hx + Math.cos(a) * d, hy + Math.sin(a) * d, 5);
    }
  }
  // 両肩から昇る硝煙: 位相で上へ流れる
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const t = (cycle + i * 0.5) % 1;
    smokeWisp(frame, { x0: side * 17, y0: -8, height: 16 + t * 8, width: 1.3, age: t, rise: 10, sway: 2, lean: side * 3, seed: 6010 + i, bright: 0.34 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)), thin: t * 0.35 });
  }
  // 弾ける火の粉: 1 巡に 3 回、別の場所で
  for (let i = 0; i < 3; i++) {
    const at = i * 4;
    const age = (f - at + KEG_N) % KEG_N;
    if (age > 2) continue;
    const bx = (hash1(i, 6020) - 0.5) * 50;
    const by = -6 + hash1(i, 6021) * 16;
    if (Math.abs(bx) < 12 && by < 10) continue;
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * TAU + i;
      const d = 1 + age * 2.5;
      dot(frame, bx + Math.cos(a) * d, by + Math.sin(a) * d - age, Math.max(3, 6 - age));
    }
  }
}

/**
 * 火薬庫の地面（キャラの下、持続中ずっと）: 至近の間合い（半径 60 論理 px）に撒いた火薬の粒の破線の輪が
 * ゆっくり回り、足元の小さな輪が射撃の速さに合わせて脈打つ。暗い段だけで、戦闘の邪魔をしない
 */
function powderKegGround(frame, f) {
  const cycle = f / KEG_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU * 2);
  // 破線の輪: 24 の区間の半分に粒を置く（24 回対称なので 1 巡で 1 区間ぶん回れば継ぎ目が出ない）
  const segs = 24;
  const turn = (cycle / segs) * TAU;
  const sq = 0.72;
  paint(
    frame,
    (x, y) => {
      const dy = (y - FEET_Y) / sq;
      const d = Math.abs(Math.hypot(x, dy) - POINT_R);
      if (d > 1.1) return -1;
      // 破線: 区間の前半だけ塗る。区間の中ほどを 1 段明るく（撒いた粒の盛り）
      const u = ((((Math.atan2(dy, x) - turn) / TAU) * segs) % 1 + 1) % 1;
      if (u > 0.5) return -1;
      return u > 0.15 && u < 0.35 ? 0.4 : 0.3;
    },
    { bounds: { x0: -POINT_R - 3, y0: FEET_Y - POINT_R * sq - 3, x1: POINT_R + 3, y1: FEET_Y + POINT_R * sq + 3 }, samples: 2, dither: 0 },
  );
  groundRing(frame, { oy: FEET_Y, r: 18 + pulse * 2, width: 1.8, squash: 0.5, bright: 0.32 + 0.14 * pulse, seed: 6030 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 大砲撃の base は爆発の半径。全弾発射は行為 0 = 起爆、行為 1 = 曲射 5 発（shots の 1 に弾の絵）
 */
const FX = {
  moveset: "cannon",
  ultimates: {
    "cannon.grandShell": {
      ramp: "fire",
      cast: { sheet: "cannonUlt.grandShellCast", life: 0.4 },
      acts: [{ sheet: "cannonUlt.grandShell", life: 1.0, base: SHELL_R / 2, pivot: "pos", ground: "cannonUlt.grandShellGround" }],
    },
    "cannon.fullSalvo": {
      ramp: "fire",
      cast: { sheet: "cannonUlt.fullSalvoCast", life: 0.4 },
      acts: [
        { sheet: "cannonUlt.fullSalvoDetonate", life: 0.55, pivot: "pos" },
        { sheet: "cannonUlt.fullSalvoVolley", life: 0.6, pivot: "pos" },
      ],
      shots: {
        1: {
          fly: "cannonUlt.salvoShellFly",
          period: SALVO_SHELL.period,
          base: 4,
          muzzle: "cannonUlt.salvoShellMuzzle",
          impact: "cannonUlt.salvoShellImpact",
          blast: "cannonUlt.salvoShellBlast",
          blastBase: SALVO_BLAST_R / 2,
          ramp: "fire",
        },
      },
    },
    "cannon.powderKeg": {
      ramp: "brass",
      cast: { sheet: "cannonUlt.powderKegCast", life: 0.5 },
      sustain: { sheet: "cannonUlt.powderKeg", period: 0.9, ground: "cannonUlt.powderKegGround" },
    },
  },
};

export const ATLAS = {
  key: "cannonUlt",
  fx: FX,
  sheets: [
    { key: "cannonUlt.grandShellCast", dirs: DIRS, frames: 10, active: 0, size: 240, draw: grandShellCast },
    { key: "cannonUlt.grandShell", dirs: 1, frames: SHELL_N, active: 3, size: 2 * (SHELL_R + 36), draw: grandShellBlast },
    { key: "cannonUlt.grandShellGround", dirs: 1, frames: SHELL_N, active: 3, size: 2 * (SHELL_R + 16), draw: grandShellGround },
    { key: "cannonUlt.fullSalvoCast", dirs: 1, frames: 8, active: 0, size: 120, draw: fullSalvoCast },
    { key: "cannonUlt.fullSalvoDetonate", dirs: 1, frames: SIGNAL_N, active: 0, size: 2 * (SIGNAL_R + 12), draw: fullSalvoDetonate },
    { key: "cannonUlt.fullSalvoVolley", dirs: DIRS, frames: 11, active: 0, size: 176, draw: fullSalvoVolley },
    { key: "cannonUlt.salvoShellFly", dirs: SHOT_DIRS, frames: SALVO_SHELL.frames, active: 0, size: 2 * (SALVO_SHELL.tail + SALVO_SHELL.len + 16), draw: salvoShellFly },
    { key: "cannonUlt.salvoShellMuzzle", dirs: DIRS, frames: 7, active: 0, size: 112, draw: salvoShellMuzzle },
    { key: "cannonUlt.salvoShellImpact", dirs: DIRS, frames: 7, active: 0, size: 72, draw: salvoShellImpact },
    { key: "cannonUlt.salvoShellBlast", dirs: 1, frames: 12, active: 0, size: 2 * (SALVO_BLAST_R + 40), draw: salvoShellBlast },
    { key: "cannonUlt.powderKegCast", dirs: 1, frames: 10, active: 0, size: 2 * (POINT_R + 10), draw: powderKegCast },
    { key: "cannonUlt.powderKeg", dirs: 1, frames: KEG_N, active: 0, size: 136, draw: powderKegSustain },
    { key: "cannonUlt.powderKegGround", dirs: 1, frames: KEG_N, active: 0, size: 2 * (POINT_R + 8), draw: powderKegGround },
  ],
};
