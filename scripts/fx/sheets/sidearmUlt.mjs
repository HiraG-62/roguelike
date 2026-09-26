// 片手銃（moveset "sidearm"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs・sidearm.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/sidearm.json × 2 が目安
//
// 奥義は見せ場なので、片手銃の通常の弾・閃光より一段豪華にする（弾頭が太く尾が長い・閃光の針が多い・崩れの段が多い）。
// 形の言葉は sidearm.mjs にそろえる: 曳光（弾頭の尖り + 後ろへ細る尾）・閃光の針（spike）・菱形の閃光・前へ押し出す圧の弧・
// 横へ飛ぶ薬莢・上へ昇る細い煙。決まりは近接と同じ（白は弾頭の芯・針の芯・光点だけ、崩れて消える）
//
// 3 本の描き分け:
//   六連射: 回転式の弾倉（6 つの薬室）が点って回り、一点へ 6 本の曳光がほぼ平行に抜ける。薬莢が 6 つ続けて飛ぶ
//   零距離乱射: 銃口の一点から 8 方向の星（全周へ散る弾）と、全周へ広がる輪。後ろへ跳ぶ足元の蹴りと速度線
//   集中: 照準の枠（四隅の括弧）が自分へ締まってロックし、持続中は枠が体の周りでゆっくり回る
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光は 24 方向だと角のずれが目立つので 32 方向で描く（sidearm.mjs と同じ） */
const SHOT_DIRS = 32;
/** 銃口の位置（自分の中心から前へ。muzzleAt = 体の半径 + 2 論理 px ≒ 14 → 28 ドット） */
const MUZZLE_X = 28;
/** 足元の輪の中心の高さ（キャラの足元。キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 共通の部品（sidearm.mjs の部品を写し、奥義向けに太さ・段を足したもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角。芯が明るく先ほど暗い */
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

/** 前へ押し出す圧の弧（潰れた楕円の前側だけ）。全周の輪にすると閃光の横に輪がぶら下がって見える */
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

/** 菱形の閃光: 前へ fwd、後ろへ back、上下へ half。辺が内へ反って 4 本の角が立つ */
function diamond(frame, o) {
  const { x = 0, fwd, back, half } = o;
  const bright = o.bright ?? 1;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const e = Math.sqrt(dx >= 0 ? dx / fwd : -dx / back) + Math.sqrt(Math.abs(py) / half);
      if (e > 1) return -1;
      return clamp01((1 - e) ** 0.7 * 1.15 * bright);
    },
    { bounds: { x0: x - back - 1, y0: -half - 1, x1: x + fwd + 1, y1: half + 1 } },
  );
}

/** 薬莢: 2〜3 ドットの棒。spin で 45° ずつ回る。段 5 の口と段 4 の胴（白を使わない） */
function casing(frame, x, y, spin, fade = 0) {
  const k = ((Math.round(spin) % 4) + 4) % 4;
  const dirs = [
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
  ];
  const [cx, cy] = dirs[k] ?? [1, 0];
  const hi = Math.max(2, 5 - Math.round(fade * 2));
  dot(frame, x + cx, y + cy, hi);
  dot(frame, x, y, hi - 1);
  dot(frame, x - cx, y - cy, Math.max(2, hi - 2));
}

/** (x, y) から (vx, vy) へ飛び、回りながら減速して落ちる薬莢。age < 0 か life 超えは描かない */
function flyingCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const travel = (1 - Math.pow(0.8, age)) / 0.2;
  casing(frame, o.x + o.vx * travel, o.y + o.vy * travel + 0.25 * age * age * (o.fall ?? 0), o.spin + age, age / (o.life + 1));
}

/** 画面に揃えて昇る細い煙（dirs 1 のシート用）。段 2〜3 だけ */
function smokeWisp(frame, o) {
  const { x0, y0, height, width, age, seed } = o;
  const sway = o.sway ?? 3;
  const bright = o.bright ?? 0.36;
  const rise = age * (o.rise ?? 8);
  paint(
    frame,
    (x, y) => {
      const h = y0 - rise - y;
      if (h < 0 || h > height) return -1;
      const u = h / height;
      const cx = x0 + Math.sin(u * 5.2 + seed + age * 3) * sway * u + (o.lean ?? 0) * u;
      const w = width * (0.6 + 0.8 * u) * (1 + age * 0.5);
      const d = Math.abs(x - cx);
      if (d > w) return -1;
      if (valueNoise(x, y + rise, 2.6, seed) * 0.8 + (1 - u) * 0.3 - age * 0.75 - u * 0.25 < 0) return -1;
      return clamp01(bright * (1 - d / w) ** 0.5 * (1 - u * 0.4) * (1 - age * 0.5));
    },
    { bounds: { x0: x0 - sway - width * 3 - 6, y0: y0 - rise - height - 1, x1: x0 + sway + width * 3 + 6 + Math.abs(o.lean ?? 0), y1: y0 - rise + 1 }, samples: 2 },
  );
}

/**
 * 奥義の曳光: sidearm.mjs の tracer を太く長くし、弾頭の前に尖った圧の縁（弾が空気を割く舳先）と、
 * 尾の両脇に細い航跡の線を足す。g = { tail, half, tailHalf, head, flick, seed, bow, wake, embers }
 */
function ultTracer(frame, f, g) {
  const len = g.tail * (1 + (hash1(f, g.seed) - 0.5) * 2 * g.flick);
  const H = g.half;
  const cx = -H * 0.5;
  const rxBack = H * 1.6;
  const rxFront = g.head + H * 0.5;
  const tailFrom = cx - rxBack * 0.4;
  paint(
    frame,
    (x, y) => {
      if (x > g.head + 1 || x < -len) return -1;
      let v = -1;
      const dx = x - cx;
      const rx = dx >= 0 ? rxFront : rxBack;
      const e = Math.hypot(dx / rx, y / H);
      if (e <= 1) {
        const pointed = dx >= 0 ? Math.abs(y) / H + dx / rx : 0;
        if (pointed <= 1.05) v = clamp01((1 - e) ** 0.5 * 1.15);
      }
      if (x < tailFrom) {
        const u = (tailFrom - x) / (len + tailFrom);
        const hw = g.tailHalf * (1 - u) ** 0.6 + 0.3;
        const d = Math.abs(y);
        // 尾は段 6 まで（白は弾頭だけ）。等間隔の脈（ちらつく熱）を少し入れる
        const pulse = 0.9 + 0.1 * Math.cos((x + f * 5) * 0.7);
        if (d <= hw) v = Math.max(v, clamp01((1 - d / hw) ** 0.6 * 0.76 * (1 - u) ** 1.1 * pulse + 0.08));
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -H - 2, x1: g.head + 3, y1: H + 2 }, dither: 0.03 },
  );
  // 舳先: 弾頭の少し後ろから前へ開く V 字の圧の縁（弾頭より暗い段 4〜5。尾と重ねない）
  if (g.bow > 0) {
    for (const side of [-1, 1]) {
      streakLine(frame, { ax: -g.bow, ay: side * (H + 3.5), bx: g.head - 1, by: side * (H * 0.55), width: 1, bright: 0.62 });
    }
  }
  // 航跡: 尾の両脇、弾頭から離れた所に短い細線（後ろほど暗い）。尾の中へは入れない
  if (g.wake > 0) {
    for (const side of [-1, 1]) {
      const off = hash1(f + (side > 0 ? 7 : 0), g.seed + 3) * 4;
      const x1 = -g.bow - 4 - off;
      streakLine(frame, { ax: x1 - g.wake, ay: side * (H + 3.2), bx: x1, by: side * (H + 2.6), width: 1, bright: 0.44 });
    }
  }
  // 尾から剥がれる火の粉（フレームごとに位置を変える）
  for (let i = 0; i < g.embers; i++) {
    const ex = -len * (0.35 + 0.5 * hash1(f * 3 + i, g.seed + 1));
    const ey = (hash1(f * 3 + i, g.seed + 2) > 0.5 ? 1 : -1) * (g.tailHalf + 1.4 + i);
    dot(frame, ex, ey, 4 - (i % 2));
  }
}

// -----------------------------------------------------------------------------
// 六連射（volley pistol ×6・spread 3°・radius 3・速さ ×1.3・貫通 1）
// 回転式の弾倉が点って回り（cast）、一点から 6 本の曳光がほぼ平行に抜ける（acts[0]）
// -----------------------------------------------------------------------------

/** 弾倉の薬室の数と、薬室の輪の半径・薬室 1 つの半径 */
const CHAMBERS = 6;
const CYL_R = 22;
const CHAMBER_R = 6;

/** 薬室 1 つ: 細い輪。lit（0..1）で内側が点る（芯は段 6 まで。白は装填の瞬間の光点だけ） */
function chamber(frame, x, y, lit, seed) {
  ring(frame, { ox: x, oy: y, radius: CHAMBER_R, width: 1.6, bright: 0.45 + 0.25 * lit, seed });
  if (lit > 0) flashCore(frame, x, y, CHAMBER_R - 2.2, 0.72 * lit);
}

/**
 * 六連射の発動（dirs 1。自分の中心）: 自分の周りに弾倉の 6 つの薬室が現れ、1 フレームに 1 つずつ時計回りに点る。
 * 6 つ揃うと弾倉が 1/6 回転して噛み合い、外縁の輪が弾けて薬室が崩れる
 */
function sixShooterCast(frame, f) {
  const N = 10;
  const LOAD = 6;
  // 装填が終わったら 1/6 回転（噛み合う音の手応え）
  const turn = f < LOAD ? 0 : Math.min(1, (f - LOAD + 1) / 2) * (TAU / CHAMBERS);
  const k = f < LOAD + 1 ? 0 : (f - LOAD) / (N - LOAD);
  const grow = Math.min(1, (f + 2) / 3);
  // 外縁の輪（弾倉の胴）
  if (k < 0.9) ring(frame, { radius: (CYL_R + CHAMBER_R + 4) * (0.8 + 0.2 * grow), width: 2, erosion: Math.min(0.9, k * 1.1), bright: 0.5 + (f === LOAD ? 0.3 : 0), seed: 2001 });
  if (k < 0.75) {
    for (let i = 0; i < CHAMBERS; i++) {
      const a = -Math.PI / 2 + (i / CHAMBERS) * TAU + turn;
      const lit = f >= i ? Math.min(1, 0.6 + 0.2 * (f - i)) * (1 - k) : 0;
      const x = Math.cos(a) * CYL_R * grow;
      const y = Math.sin(a) * CYL_R * grow;
      chamber(frame, x, y, lit, 2002 + i);
      if (f === i) sparkle(frame, x, y, 2);
    }
  }
  // 噛み合った瞬間: 外へ弾ける輪と光点
  if (f >= LOAD) {
    const age = f - LOAD;
    ring(frame, { radius: CYL_R + CHAMBER_R + 6 + age * 7, width: 2.4 - age * 0.3, erosion: Math.min(0.92, age * 0.22), bright: 0.8 - age * 0.1, seed: 2010 });
    if (age === 0) sparkle(frame, 0, -(CYL_R + CHAMBER_R + 4), 3);
    shards(frame, age, 12, 2011, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 3;
      return { x: Math.cos(a) * (CYL_R + 4), y: Math.sin(a) * (CYL_R + 4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
    });
  }
}

/** 六連射の弾道の長さ（撃った瞬間の閃きとして 6 本の曳光の筋を前へ引く。弾そのものは弾の絵が飛ぶ） */
const SIX_LANE = 150;

/**
 * 六連射の撃つ瞬間（DIRS。原点 = 自分、+x = 照準）: 銃口の大きな菱形と長い針、6 本の弾道の筋（3° ずつ開く。
 * 実際に 6 発が並んで飛ぶので 6 本でよい）、前へ 2 段に押し出す圧の弧、横へ続けて飛ぶ 6 つの薬莢、昇る煙の粒
 */
function sixShooterBlast(frame, f) {
  const N = 11;
  const k = f / (N - 1);
  const X = MUZZLE_X;
  // 閃光: 1 枚目で最大、3 枚目までに引く
  if (f <= 2) {
    const s = f === 0 ? 1 : f === 1 ? 0.9 : 0.55;
    diamond(frame, { x: X - 2, fwd: 42 * s, back: 14 * s, half: 19 * s });
    spike(frame, { x: X, a: 0, len: 60 * s, w: 4 * s, bright: 1 });
    spike(frame, { x: X, a: 32 * DEG, len: 18 * s, w: 2.6 * s, bright: 0.9 });
    spike(frame, { x: X, a: -32 * DEG, len: 18 * s, w: 2.6 * s, bright: 0.9 });
    spike(frame, { x: X - 4, a: Math.PI / 2, len: 12 * s, w: 2.4 * s, bright: 0.8 });
    spike(frame, { x: X - 4, a: -Math.PI / 2, len: 12 * s, w: 2.4 * s, bright: 0.8 });
    flashCore(frame, X - 2, 0, 5 * s, 1);
    if (f <= 1) sparkle(frame, X - 1, 0, f === 0 ? 4 : 3);
  }
  // 6 本の弾道: 3° ずつ開く細い線。前へ流れながら根元から痩せる（1 本ずつ明るさを変えて束の塊に見せない）
  if (f <= 6) {
    const reach = SIX_LANE * Math.min(1, easeSwing((f + 1) / 3));
    const from = X + 6 + (f <= 2 ? 0 : (f - 2) * 22);
    for (let i = 0; i < CHAMBERS; i++) {
      const a = (i - 2.5) * 3 * DEG;
      const r0 = Math.min(reach, from);
      // 先端は 1 本ずつずらす（6 発がわずかな間で抜けた手応え。そろえると箒の形に見える）
      const r1 = (reach + (f > 2 ? (f - 2) * 6 : 0)) * (0.78 + 0.22 * hash1(i, 2105));
      if (r1 - r0 < 4) continue;
      streakLine(frame, {
        ax: X + Math.cos(a) * (r0 - X),
        ay: Math.sin(a) * (r0 - X),
        bx: X + Math.cos(a) * (r1 - X),
        by: Math.sin(a) * (r1 - X),
        width: i === 2 || i === 3 ? 1.4 : 1,
        bright: (0.72 - 0.08 * Math.abs(i - 2.5)) * (1 - f / 8),
      });
    }
    if (f === 1) sparkle(frame, X + SIX_LANE * 0.9, 0, 2);
  }
  // 前へ押し出す圧の弧: 2 段（1 枚ずれて）
  for (let j = 0; j < 2; j++) {
    const age = f - 1 - j;
    if (age < 0 || age > 5) continue;
    frontArc(frame, { ox: X + 10 + age * 7 + j * 6, radius: 9 + age * 5 - j * 2, width: 2.6 - j * 0.6, squash: 0.5, erosion: Math.min(0.92, age * 0.17), bright: 0.78 - age * 0.09 - j * 0.1, seed: 2101 + j });
  }
  // 6 つの薬莢が 1 枚ずつ横（+y）へ（弾倉を空けるファニング）
  for (let i = 0; i < CHAMBERS; i++) {
    flyingCasing(frame, f - Math.floor(i * 0.8), { x: 4, y: 8, vx: -1.2 - hash1(i, 2110) * 1.5, vy: 3 + hash1(i, 2111) * 2.2, spin: i, fall: 0.25, life: 5 });
  }
  // 閃光が引いたあとの火の粉（前の扇）
  if (f >= 2) {
    shards(frame, f - 2, 12, 2120, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.2;
      const sp = 3 + rnd(2) * 4;
      return { x: X + 10, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  // 最後は銃口に煙の粒（段 2〜3）
  if (f >= N - 4) {
    for (let i = 0; i < 5; i++) dot(frame, X + 2 + hash1(i, 2130) * 10, (hash1(i, 2131) - 0.5) * 12 - (f - N + 4) * 1.5, 3 - (i % 2) * (k > 0.9 ? 1 : 0));
  }
}

/** 六連射の弾（radius 3 論理 px → 半幅 3 ドット。速さ ×1.3 ≒ 390px/秒 → 尾の目安 31 ドット。奥義なので長めに 42） */
const SIX_SHOT = { tail: 42, half: 3, tailHalf: 1.9, head: 6, flick: 0.08, seed: 2200, bow: 5, wake: 12, embers: 2 };

function sixShooterFly(frame, f) {
  ultTracer(frame, f, SIX_SHOT);
}

/**
 * 六連射の銃口（DIRS。6 発が同じ tick なので 1 つにまとまって出る）: 回転式の閃光を太くし、
 * 前の針の周りに 6 本の短い針の冠（弾倉の 6 発の名残）。シリンダーの隙間から横へ漏れる火花
 */
function sixShooterMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 1.05 : f === 1 ? 1 : 0.6;
    spike(frame, { x: -2, a: 0, len: 30 * s, w: 5.5 * s, bright: 1 });
    for (let i = 0; i < CHAMBERS; i++) {
      const a = (i - 2.5) * 22 * DEG;
      spike(frame, { x: -2, a, len: (i === 2 || i === 3 ? 20 : 13) * s, w: 2.2 * s, bright: 0.88 });
    }
    flashCore(frame, -2, 0, 5 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, f === 0 ? 3 : 4);
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const a = side * (Math.PI / 2 + (j - 1) * 18 * DEG + 14 * DEG);
        spike(frame, { x: -10, y: side * 2, a, len: (j === 1 ? 12 : 8) * s, w: 1.4, bright: j === 1 ? 0.9 : 0.72 });
      }
    }
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 18 + age * 5, radius: 8 + age * 4, width: 2.6, squash: 0.5, erosion: Math.min(0.9, k * 0.85), bright: 0.76 - k * 0.3, seed: 2211 });
  }
  shards(frame, f, 12, 2212, (i, rnd) => {
    const side = i % 2 === 0 ? 1 : -1;
    const a = side * (Math.PI / 2 + (rnd(1) - 0.3) * 0.7);
    const sp = 2.5 + rnd(2) * 3;
    return { x: -10, y: side * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/**
 * 六連射の着弾（壁・貫通しきった）: 当たった面の太い閃き、後ろの半球へ跳ね返る火花（通常の倍）、
 * 面に沿って左右へ走る短い亀裂の線
 */
function sixShooterImpact(frame, f) {
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -14, bx: -1, by: 14, T: f === 0 ? 6 : 3.6, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 13, w: 3, bright: 1 });
    flashCore(frame, 0, 0, 3.6, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    for (const side of [-1, 1]) {
      streakLine(frame, { ax: -2, ay: side * (8 + t * 6), bx: -2 - t * 3, by: side * (16 + t * 8), width: 1.2, bright: 0.66 * (1 - t) });
    }
  }
  shards(frame, f, 14, 2231, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 3.4 + rnd(2) * 4;
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 3) {
    for (let i = 0; i < 4; i++) {
      if (hash1(i + f * 3, 2232) < (f - 3) / 5) continue;
      dot(frame, -1 - hash1(i, 2233) * 3, (hash1(i, 2234) - 0.5) * 10, 3);
    }
  }
}

/**
 * 六連射の命中（貫く弾なので毎回出る）: 体を貫いて前へ抜ける長い針と、抜けた側に開く破片の扇。
 * 入った側（後ろ）は小さな輪だけ。貫通の手応えを「前へ抜ける」形で見せる
 */
function sixShooterHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -6, a: 0, len: f === 0 ? 26 : 32, w: 3.2, bright: 1 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 7, w: 2, bright: 0.8 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 7, w: 2, bright: 0.8 });
    flashCore(frame, -2, 0, 3.6, 1);
    if (f === 0) sparkle(frame, -2, 0, 3);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    ring(frame, { ox: -4, radius: 4 + age * 3, width: 1.8, squash: 0.55, erosion: Math.min(0.9, age * 0.3), bright: 0.66 - age * 0.1, seed: 2241 });
    frontArc(frame, { ox: 10 + age * 5, radius: 6 + age * 3, width: 2.2, squash: 0.55, spread: 55 * DEG, erosion: Math.min(0.9, age * 0.24), bright: 0.74 - age * 0.12, seed: 2242 });
  }
  shards(frame, f, 14, 2243, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.3;
    const sp = 4 + rnd(2) * 4;
    return { x: 6, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/** 六連射の尽きた（dirs 1）: 燃え残りの 2x2 の火の粉と、2 筋の細い煙 */
function sixShooterFizzle(frame, f) {
  const N = 7;
  const age = f / (N - 1);
  if (f === 0) {
    dot(frame, 0, 0, 6);
    dot(frame, 1, 0, 5);
    dot(frame, 0, 1, 5);
    dot(frame, 1, 1, 4);
  } else if (f <= 3) dot(frame, 0, -f, Math.max(3, 6 - f));
  smokeWisp(frame, { x0: -1, y0: -1, height: 14 + f * 3, width: 1.1 + age * 0.6, age, seed: 23, sway: 3.4, lean: 2, rise: 7, bright: 0.34 });
  smokeWisp(frame, { x0: 3, y0: 0, height: 9 + f * 2, width: 0.9 + age * 0.5, age, seed: 41, sway: 2.6, lean: -1, rise: 6, bright: 0.28 });
}

// -----------------------------------------------------------------------------
// 零距離乱射（volley pistol ×8・spread 45° = 全周・速さ ×1.1・射程 ×0.6 / buff selfKnock 400）
// 8 発は同じ銃口（自分の前）から 45° おきに出る: 角は照準 ±22.5°・±67.5°・±112.5°・±157.5°
// -----------------------------------------------------------------------------

/** 8 方向の弾の角（照準からのずれ）。(i + 0.5) × 45° */
function pointBlankAngle(i) {
  return (i + 0.5 - 4) * 45 * DEG;
}

/**
 * 零距離乱射の発動（dirs 1。自分の中心）: 8 本の照準の刻みが外から自分へ締まり、身を屈める潰れた輪が縮む。
 * 締まりきった瞬間に光点が弾ける（撃つ前のため）
 */
function pointBlankCast(frame, f) {
  const N = 7;
  const GATHER = 4;
  if (f < GATHER) {
    const p = easeSwing((f + 1) / GATHER);
    const r0 = 54 - 30 * p;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      const len = 16 - 5 * p;
      streakLine(frame, { ax: Math.cos(a) * (r0 + len), ay: Math.sin(a) * (r0 + len), bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: i % 2 === 0 ? 2 : 1.4, bright: 0.5 + 0.4 * p });
    }
    ring(frame, { oy: FEET_Y, radius: 16 - 6 * p, width: 1.6, squash: 2, bright: 0.32 + 0.2 * p, seed: 2301 });
    if (f === GATHER - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - GATHER + 1) / (N - GATHER);
  ring(frame, { radius: 10 + k * 22, width: 2.6 - k, erosion: Math.min(0.9, k * 0.85), bright: 0.85 - k * 0.3, seed: 2302 });
  if (f === GATHER) sparkle(frame, 0, 0, 4);
  shards(frame, f - GATHER, 8, 2303, (i, rnd) => {
    const a = (i / 8) * TAU + TAU / 16;
    const sp = 3 + rnd(2) * 2;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: 1 };
  });
}

/**
 * 零距離乱射の撃つ瞬間（DIRS。原点 = 自分、+x = 照準）: 銃口の一点から 8 方向へ開く長い閃光の星、
 * 全周へ広がる輪（押し出す衝撃）が 2 枚、銃口の周りに撒かれる 8 つの薬莢、煙の粒
 */
function pointBlankBlast(frame, f) {
  const N = 10;
  const X = MUZZLE_X;
  if (f <= 2) {
    const s = f === 0 ? 1 : f === 1 ? 0.95 : 0.55;
    for (let i = 0; i < 8; i++) {
      const a = pointBlankAngle(i);
      spike(frame, { x: X, a, len: (i === 3 || i === 4 ? 54 : 44) * s, w: 4 * s, bright: 1 });
    }
    // 星の谷（弾の間）に短い針を足し、全周の爆ぜに見せる
    for (let i = 0; i < 8; i++) {
      spike(frame, { x: X, a: (i - 4) * 45 * DEG, len: 16 * s, w: 2.4 * s, bright: 0.78 });
    }
    flashCore(frame, X, 0, 8 * s, 1);
    if (f <= 1) sparkle(frame, X, 0, f === 0 ? 4 : 3);
  }
  // 全周の輪（1 本だけ。同心に 2 本重ねると的に見える）。星が引く 2 枚目から太く速く広がり、外縁から欠ける
  if (f >= 2) {
    const age = f - 2;
    ring(frame, { ox: X, radius: 22 + age * 11, width: 4.2 - age * 0.4, erosion: Math.min(0.94, age * 0.14), bright: 0.82 - age * 0.07, seed: 2311 });
  }
  // 弾の向きへ飛ぶ細い筋（8 本。閃光のあとに外へ流れる）
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    for (let i = 0; i < 8; i++) {
      const a = pointBlankAngle(i);
      const r0 = 36 + t * 40;
      streakLine(frame, { ax: X + Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: X + Math.cos(a) * (r0 + 16), by: Math.sin(a) * (r0 + 16), width: 1.2, bright: 0.7 * (1 - t) });
    }
  }
  // 8 つの薬莢: 自分の手元から全周へ（連射で撒き散らす）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + hash1(i, 2320) * 0.5;
    flyingCasing(frame, f - Math.floor(i / 3), { x: X * 0.5, y: 0, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, spin: i, fall: 0.15, life: 5 });
  }
  if (f >= 2) {
    shards(frame, f - 2, 16, 2330, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 3.5;
      return { x: X + Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
  if (f >= N - 4) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      dot(frame, X + Math.cos(a) * (6 + hash1(i, 2340) * 8), Math.sin(a) * (6 + hash1(i, 2341) * 8) - (f - N + 4), 3);
    }
  }
}

/** 後ろへ跳ぶ距離の目安（selfKnock 400 の減衰で数十 px。絵は −x へ 90 ドットまで） */
const LEAP_BACK = 90;

/**
 * 零距離乱射の後ろ跳び（acts[1] buff。DIRS。原点 = 跳ぶ前の自分、+x = 照準）:
 * 撃った反動で足元が前へ蹴られる潰れた弧（地面の砂）、跳ぶ向き（−x）へ伸びる速度線の束、足元から後ろへ流れる砂粒
 */
function pointBlankLeap(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  // 蹴った足元: 前（+x）へ開く潰れた弧（押し出した側に砂が跳ねる）
  if (f <= 4) frontArc(frame, { ox: -4 + f * 2, radius: 8 + f * 5, width: 2.6 - f * 0.3, squash: 0.55, spread: 75 * DEG, erosion: Math.min(0.9, f * 0.2), bright: 0.72 - f * 0.1, seed: 2401 });
  // 速度線: 跳んだ道筋（0 → −x）に沿って、体の幅の外寄りに 5 本。長さ・始点・高さをばらし、束の縞に見せない
  if (k < 0.9) {
    const travel = LEAP_BACK * easeSwing((f + 1) / 4);
    const LANES = [-17, -9, 3, 12, 20];
    LANES.forEach((y0, i) => {
      const y = y0 + (hash1(i, 2402) - 0.5) * 3;
      const x1 = -4 - hash1(i, 2403) * 22 - f * 4;
      const len = Math.max(0, travel * (0.35 + 0.65 * hash1(i, 2404)) - f * 5);
      if (len < 8) return;
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, width: Math.abs(y0) < 10 ? 1.5 : 1, bright: (Math.abs(y0) < 10 ? 0.66 : 0.5) * (1 - k) });
    });
  }
  // 蹴った所の衝撃: 跳んだ向きに潰れた輪が前寄りに広がる（向きで回るシートなので地面の楕円にはしない）
  if (f <= 5) ring(frame, { ox: 4 + f * 2, radius: 6 + f * 4, width: 2.2 - f * 0.25, squash: 0.6, erosion: Math.min(0.92, f * 0.17), bright: 0.6 - f * 0.07, seed: 2406 });
  if (f === 0) sparkle(frame, 6, 0, 2);
  // 砂粒: 足元から前後へ
  shards(frame, f, 12, 2405, (i, rnd) => {
    const back = rnd(1) < 0.55;
    const a = back ? Math.PI + (rnd(2) - 0.5) * 0.8 : (rnd(2) - 0.5) * 1.6;
    const sp = 2 + rnd(3) * 3;
    return { x: 0, y: (rnd(4) - 0.5) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), size: 1 };
  });
}

/**
 * 零距離乱射の弾（radius 3。速さ ×1.1 ≒ 330px/秒 → 尾 26 ドット。射程が短いので尾は短く太い、熱い散弾のような弾頭）。
 * 六連射（細長い貫通弾・舳先と航跡）とは、太く短い尾と多い火の粉で見分ける
 */
const BLANK_SHOT = { tail: 28, half: 3.4, tailHalf: 2.6, head: 4, flick: 0.18, seed: 2500, bow: 0, wake: 0, embers: 3 };

function pointBlankFly(frame, f) {
  ultTracer(frame, f, BLANK_SHOT);
}

/**
 * 零距離乱射の銃口（DIRS。8 発が同じ銃口から出るので 1 つにまとまり、角は最初の弾の向き）:
 * 45° おきの 8 本の針の星（どの弾の向きで回っても弾の向きにそろう）と円い芯、小さな全周の輪
 */
function pointBlankMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.9 : f === 1 ? 1 : 0.5;
    for (let i = 0; i < 8; i++) spike(frame, { x: 0, a: i * 45 * DEG, len: 18 * s, w: 2.6 * s, bright: 0.95 });
    flashCore(frame, 0, 0, 5 * s, 1);
    if (f === 1) sparkle(frame, 0, 0, 3);
  }
  // 輪は星が引いてから（星と重ねると舵輪に見える）
  if (f >= 2) ring(frame, { radius: 14 + (f - 2) * 6, width: 2, erosion: Math.min(0.9, k * 0.8), bright: 0.66 - k * 0.25, seed: 2511 });
  if (f >= 2) {
    shards(frame, f - 2, 8, 2512, (i, rnd) => {
      const a = (i / 8) * TAU + rnd(1) * 0.4;
      const sp = 2 + rnd(2) * 2;
      return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
    });
  }
}

/** 零距離乱射の着弾: 近い距離で弾ける重い弾。当たった面で潰れた星と、後ろへ跳ねる太い火花 */
function pointBlankImpact(frame, f) {
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.75;
    spike(frame, { x: 0, a: Math.PI, len: 12 * s, w: 3.4 * s, bright: 1 });
    spike(frame, { x: 0, a: Math.PI * 0.72, len: 9 * s, w: 2.4 * s, bright: 0.85 });
    spike(frame, { x: 0, a: -Math.PI * 0.72, len: 9 * s, w: 2.4 * s, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI / 2, len: 10 * s, w: 2.2 * s, bright: 0.85 });
    spike(frame, { x: 0, a: -Math.PI / 2, len: 10 * s, w: 2.2 * s, bright: 0.85 });
    flashCore(frame, 0, 0, 4 * s, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    ring(frame, { radius: 6 + age * 4, width: 2, squash: 0.6, erosion: Math.min(0.9, age * 0.28), bright: 0.7 - age * 0.12, seed: 2521 });
  }
  shards(frame, f, 12, 2522, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 3;
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.78 };
  });
}

/** 零距離乱射の命中: 至近で撃ち込まれた重さ。潰れた衝撃の星（6 本）と前の扇の破片、輪 1 本 */
function pointBlankHit(frame, f) {
  if (f <= 1) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const long = Math.abs(Math.cos(a)) > 0.7 ? 1 : 0.6;
      spike(frame, { x: -1, a, len: 14 * long * (f === 0 ? 0.85 : 1), w: 2.8, bright: 0.95 });
    }
    flashCore(frame, -1, 0, 4.2, 1);
    if (f === 0) sparkle(frame, -1, 0, 3);
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 7 + age * 5, width: 2.4, squash: 0.65, erosion: Math.min(0.92, age * 0.24), bright: 0.8 - age * 0.12, seed: 2531 });
  }
  shards(frame, f, 13, 2532, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.6 : 3.6);
    const sp = 3.5 + rnd(3) * 3.5;
    return { x: 1, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: 2, drag: 0.8 };
  });
}

/** 零距離乱射の尽きた（dirs 1。射程が短いので近くで燃え尽きる）: 小さく弾ける火の粉 4 つと短い煙 */
function pointBlankFizzle(frame, f) {
  const N = 7;
  const age = f / (N - 1);
  if (f <= 2) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.6;
      const r = 1 + f * 2.2;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r - f * 0.5, Math.max(3, 6 - f));
    }
    if (f === 0) dot(frame, 0, 0, 6);
  }
  smokeWisp(frame, { x0: 0, y0: -1, height: 10 + f * 2.5, width: 1.3 + age * 0.8, age, seed: 57, sway: 2.4, lean: 1, rise: 6, bright: 0.33 });
}

// -----------------------------------------------------------------------------
// 集中（sustain: 貫通 +1・会心・足が速い）: 照準の枠が自分に締まってロックし、持続中は体の周りを回る
// dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/**
 * 照準の枠の四隅の括弧（L 字）。R = 中心から角までの距離、arm = 腕の長さ、rot = 回転。
 * 括弧 4 つを 90° おきに置く（4 回対称なので 1/4 回転で継ぎ目なくつながる）
 */
function brackets(frame, o) {
  const { R, arm, rot = 0, width = 1.6, bright = 0.7, erosion = 0, seed = 2600 } = o;
  for (let i = 0; i < 4; i++) {
    const a = rot + TAU / 8 + (i / 4) * TAU;
    // 角の位置と、角から伸びる 2 本の腕の向き（枠の辺に沿う）
    const cx = Math.cos(a) * R;
    const cy = Math.sin(a) * R;
    const e1 = a + (3 * Math.PI) / 4;
    const e2 = a - (3 * Math.PI) / 4;
    for (const e of [e1, e2]) {
      const bx = cx + Math.cos(e) * arm;
      const by = cy + Math.sin(e) * arm;
      paint(
        frame,
        (x, y) => {
          const dx = bx - cx;
          const dy = by - cy;
          const L2 = dx * dx + dy * dy;
          const t = clamp01(((x - cx) * dx + (y - cy) * dy) / L2);
          const d = Math.hypot(x - (cx + dx * t), y - (cy + dy * t));
          if (d > width / 2) return -1;
          if (!survives(x, y, erosion + t * 0.2, 1 - t, seed + i)) return -1;
          // 角ほど明るく、腕の先へ暗くなる（段 6 まで。白は角の光点で足す）
          return clamp01(bright * (1 - 0.4 * t));
        },
        { bounds: { x0: Math.min(cx, bx) - width - 1, y0: Math.min(cy, by) - width - 1, x1: Math.max(cx, bx) + width + 1, y1: Math.max(cy, by) + width + 1 }, dither: 0 },
      );
    }
  }
}

/** 照準の十字の刻み: 輪の外側から内へ 4 本（上下左右）。rot で回る */
function crossTicks(frame, o) {
  const { r0, r1, rot = 0, bright = 0.6, width = 1.2 } = o;
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width, bright });
  }
}

/**
 * 集中の発動（dirs 1。自分の中心）: 大きな照準の輪と四隅の括弧が外から自分へ締まり（回りながら）、
 * 十字の刻みが内へ伸びる。締まりきった瞬間に中心と四隅に光点（ロック）、そのあと輪だけが外へ一度脈打って消える
 */
function focusCast(frame, f) {
  const N = 11;
  const LOCK = 5;
  if (f < LOCK) {
    const p = easeSwing((f + 1) / LOCK);
    const R = 76 - 44 * p;
    const rot = (1 - p) * 40 * DEG;
    ring(frame, { radius: R, width: 1.6, bright: 0.4 + 0.3 * p, seed: 2701 });
    brackets(frame, { R: R * 1.12, arm: 12 - 3 * p, rot, width: 2, bright: 0.55 + 0.25 * p, seed: 2702 });
    // 十字の刻みは輪の外から内へ長く（歯車に見えないよう本数は 4 本だけ）
    crossTicks(frame, { r0: R - 8 - 8 * p, r1: R + 16 - 6 * p, rot, bright: 0.5 + 0.35 * p, width: 1.6 });
    return;
  }
  const age = f - LOCK;
  const k = age / (N - 1 - LOCK);
  const R = 32;
  // ロックした枠: 数枚残ってから崩れる
  if (k < 0.8) {
    brackets(frame, { R: R * 1.12, arm: 9, width: 2, bright: (age === 0 ? 0.85 : 0.72) * (1 - k * 0.4), erosion: Math.max(0, k * 1.1 - 0.1), seed: 2702 });
    crossTicks(frame, { r0: R - 14, r1: R + 6, bright: 0.72 * (1 - k), width: 1.4 });
  }
  if (age === 0) {
    sparkle(frame, 0, 0, 4);
    for (let i = 0; i < 4; i++) {
      const a = TAU / 8 + (i / 4) * TAU;
      sparkle(frame, Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, 2);
    }
  }
  // ロックの脈: 輪が 1 本だけ外へ
  ring(frame, { radius: R + age * 8, width: 2.2 - k, erosion: Math.min(0.92, k * 0.9), bright: 0.8 - k * 0.3, seed: 2703 });
  shards(frame, age, 10, 2704, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

/** 纏いの 1 巡のフレーム数 */
const FOCUS_N = 12;
/** 纏いの枠の大きさ（キャラ 48 ドットを囲む） */
const FOCUS_R = 34;

/**
 * 集中の纏い（持続中ずっと。dirs 1）: 四隅の括弧が体の周りをゆっくり回り（1 巡で 1/4 回転 = 継ぎ目なし）、
 * 輪の上を 2 つの光の粒が回る（1 巡で半周、2 つが入れ替わるので継ぎ目なし）。
 * 括弧は脈打って締まる。足の速さは足元の地面の紋と、後ろへ流れる短い線が見せる
 */
function focusSustain(frame, f) {
  const cycle = f / FOCUS_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU * 2);
  const rot = (cycle * TAU) / 4;
  brackets(frame, { R: FOCUS_R + 2 * pulse, arm: 8, rot, width: 1.8, bright: 0.52 + 0.14 * pulse, seed: 2801 });
  // 細い点線の輪（照準の輪。括弧の内側。4 回対称の点線で回っても継ぎ目なし）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (Math.abs(r - (FOCUS_R - 6)) > 0.7) return -1;
      const a = Math.atan2(y, x) - rot;
      const seg = ((a / TAU) * 24 + 24) % 1;
      if (seg > 0.55) return -1;
      return 0.36;
    },
    { bounds: { x0: -FOCUS_R, y0: -FOCUS_R, x1: FOCUS_R, y1: FOCUS_R }, dither: 0, samples: 2 },
  );
  // 輪を回る 2 つの光の粒（尾を 2 ドット引く）
  for (let j = 0; j < 2; j++) {
    const a = -Math.PI / 2 + cycle * Math.PI + j * Math.PI;
    const r = FOCUS_R - 6;
    dot(frame, Math.cos(a) * r, Math.sin(a) * r, 6);
    for (let t = 1; t <= 3; t++) {
      const b = a - t * 0.09;
      dot(frame, Math.cos(b) * r, Math.sin(b) * r, 5 - t);
    }
  }
  // 1 巡に 2 回、括弧の角に光点（交互）
  if (f === 1 || f === 7) {
    const i = f === 1 ? 0 : 2;
    const a = rot + TAU / 8 + (i / 4) * TAU;
    sparkle(frame, Math.cos(a) * (FOCUS_R + 2 * pulse), Math.sin(a) * (FOCUS_R + 2 * pulse), 2);
  }
}

/** 集中の足元（地面）: 潰した輪と、ゆっくり回る 8 つの刻み（8 回対称なので 1 巡で 1/8 回って継ぎ目なし） */
function focusSustainGround(frame, f) {
  const cycle = f / FOCUS_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 16 + pulse, width: 1.6, squash: 2.2, bright: 0.32 + 0.12 * pulse, seed: 2811 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8 + cycle / 8) * TAU;
    const long = i % 2 === 0;
    const rx = 16 * 2.2;
    // 刻みは輪の外側だけ（輪に重ねると線に埋もれる）
    const r0 = 1.14;
    const r1 = long ? 1.42 : 1.28;
    streakLine(frame, { ax: Math.cos(a) * rx * r0, ay: FEET_Y + Math.sin(a) * 16 * r0, bx: Math.cos(a) * rx * r1, by: FEET_Y + Math.sin(a) * 16 * r1, width: 1.4, bright: 0.34 + 0.12 * pulse });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 弾の絵の行（shots[行為の番号]）。物理の弾なので配色は真鍮 */
function shotRow(name, period) {
  return {
    fly: `sidearmUlt.${name}Fly`,
    period,
    base: 3,
    muzzle: `sidearmUlt.${name}Muzzle`,
    impact: `sidearmUlt.${name}Impact`,
    hit: `sidearmUlt.${name}Hit`,
    fizzle: `sidearmUlt.${name}Fizzle`,
    ramp: "brass",
  };
}

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒。
 * 六連射・零距離乱射の acts[0] は volley（自分の位置・照準の向き）で、弾は shots[0] の絵が出す。零距離乱射の acts[1] は後ろ跳びの buff。
 * 銃撃の 2 本は真鍮（曳光の色）、集中は照準の光として light
 */
const FX = {
  moveset: "sidearm",
  ultimates: {
    "sidearm.sixShooter": {
      ramp: "brass",
      cast: { sheet: "sidearmUlt.sixShooterCast", life: 0.4 },
      acts: [{ sheet: "sidearmUlt.sixShooter", life: 0.5, pivot: "pos" }],
      shots: { 0: shotRow("sixShooter", 0.12) },
    },
    "sidearm.pointBlank": {
      ramp: "brass",
      cast: { sheet: "sidearmUlt.pointBlankCast", life: 0.3 },
      acts: [
        { sheet: "sidearmUlt.pointBlank", life: 0.45, pivot: "pos" },
        { sheet: "sidearmUlt.pointBlankLeap", life: 0.35, pivot: "pos" },
      ],
      shots: { 0: shotRow("pointBlank", 0.1) },
    },
    "sidearm.focus": {
      ramp: "light",
      cast: { sheet: "sidearmUlt.focusCast", life: 0.5 },
      sustain: { sheet: "sidearmUlt.focus", period: 1.0, ground: "sidearmUlt.focusGround" },
    },
  },
};

export const ATLAS = {
  key: "sidearmUlt",
  fx: FX,
  sheets: [
    { key: "sidearmUlt.sixShooterCast", dirs: 1, frames: 10, active: 0, size: 112, draw: sixShooterCast },
    { key: "sidearmUlt.sixShooter", dirs: DIRS, frames: 11, active: 0, size: 2 * (MUZZLE_X + SIX_LANE + 40), draw: sixShooterBlast },
    { key: "sidearmUlt.sixShooterFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 2 * (SIX_SHOT.tail + 16), draw: sixShooterFly },
    { key: "sidearmUlt.sixShooterMuzzle", dirs: DIRS, frames: 6, active: 0, size: 104, draw: sixShooterMuzzle },
    { key: "sidearmUlt.sixShooterImpact", dirs: DIRS, frames: 7, active: 0, size: 80, draw: sixShooterImpact },
    { key: "sidearmUlt.sixShooterHit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: sixShooterHit },
    { key: "sidearmUlt.sixShooterFizzle", dirs: 1, frames: 7, active: 0, size: 72, draw: sixShooterFizzle },
    { key: "sidearmUlt.pointBlankCast", dirs: 1, frames: 7, active: 0, size: 144, draw: pointBlankCast },
    { key: "sidearmUlt.pointBlank", dirs: DIRS, frames: 10, active: 0, size: 2 * (MUZZLE_X + 100), draw: pointBlankBlast },
    { key: "sidearmUlt.pointBlankLeap", dirs: DIRS, frames: 8, active: 0, size: 2 * (LEAP_BACK + 50), draw: pointBlankLeap },
    { key: "sidearmUlt.pointBlankFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 2 * (BLANK_SHOT.tail + 14), draw: pointBlankFly },
    { key: "sidearmUlt.pointBlankMuzzle", dirs: DIRS, frames: 5, active: 0, size: 72, draw: pointBlankMuzzle },
    { key: "sidearmUlt.pointBlankImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: pointBlankImpact },
    { key: "sidearmUlt.pointBlankHit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: pointBlankHit },
    { key: "sidearmUlt.pointBlankFizzle", dirs: 1, frames: 7, active: 0, size: 56, draw: pointBlankFizzle },
    { key: "sidearmUlt.focusCast", dirs: 1, frames: 11, active: 0, size: 208, draw: focusCast },
    { key: "sidearmUlt.focus", dirs: 1, frames: FOCUS_N, active: 0, size: 96, draw: focusSustain },
    { key: "sidearmUlt.focusGround", dirs: 1, frames: FOCUS_N, active: 0, size: 112, draw: focusSustainGround },
  ],
};
