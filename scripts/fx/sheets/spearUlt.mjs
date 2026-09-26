// 槍（moveset "spear"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は spear.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/spear.json × 2 が目安
//
// 槍らしさ = リーチと鋭さ（細い柄の光 + 菱形の穂先 + 穂先の前の V 字・円錐の衝撃）。奥義はそれを大きく豪華にする:
// - 龍穿: 1 本の長い突き。柄に龍の胴のような螺旋が巻きついて伸び、穂先で円錐の衝撃が重なり、貫いた先へ光が抜ける
// - 流星突き: 突進の帯を流星の尾で描き、通り道の 3 か所で時間差の突きの閃き（3 度突く）
// - 陣の構え: 足元の陣から穂先が立ち並ぶ（持続中は穂先の柵がゆっくり巡る）
// 決まり: 1 回の突きは 1 本（螺旋は柄に巻く飾りで、並走する 2 本目の突きにしない）/ 白は縁と光点だけ / 崩れて消える
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, smoothstep, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** 柄の光が始まる位置（キャラの胴の縁） */
const SHAFT_BACK = 14;
/** キャラの足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 小道具（spear.mjs の部品を写して奥義向けに太さ・段を足したもの）
// -----------------------------------------------------------------------------

/** 崩れの判定。nearCore が大きい所（芯・穂先）ほど最後まで残る */
function keep(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.25;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 正準座標を回して・ずらした作業面の写し（立てた穂先・直交する閃きを同じ部品で描くため） */
function turned(frame, angle, ox = 0, oy = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    w: frame.w,
    h: frame.h,
    toGrid: (x, y) => frame.toGrid(ox + x * c - y * s, oy + x * s + y * c),
    toCanon: (gx, gy) => {
      const p = frame.toCanon(gx, gy);
      const dx = p.x - ox;
      const dy = p.y - oy;
      return { x: dx * c + dy * s, y: -dx * s + dy * c };
    },
    get: (ix, iy) => frame.get(ix, iy),
    set: (ix, iy, v) => frame.set(ix, iy, v),
    raise: (ix, iy, v) => frame.raise(ix, iy, v),
  };
}

/** 柄の光: back → neck。根元は細く暗く、穂先側ほど太く明るい。erosion で根元から崩れる */
function shaft(frame, o) {
  const { back, neck, T } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  if (neck - back < 2) return;
  paint(
    frame,
    (x, y) => {
      const u = (x - back) / (neck - back);
      if (u < 0 || u > 1) return -1;
      const w = 0.6 + (T / 2 - 0.6) * Math.pow(u, 0.7);
      const ay = Math.abs(y);
      if (ay > w) return -1;
      const q = ay / w;
      if (!keep(x, y, erosion, u * (1 - q), seed)) return -1;
      return clamp01((0.35 + 0.6 * u) * (1 - q * 0.55) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: back - 2, y0: -T - 2, x1: neck + 2, y1: T + 2 }, dither: 0.03 },
  );
  if (erosion < 0.5 && o.core !== false) streakLine(frame, { ax: back + (neck - back) * 0.45, ay: 0, bx: neck, by: 0, width: 1, bright: 0.95 * bright });
}

/** 菱形の穂先: 先端 tip、長さ L、半幅 W。前の 2 辺の縁が刃（白）、後ろ半分は暗い */
function spearhead(frame, o) {
  const { tip, L, W } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 13;
  const edgeWhite = o.edgeWhite ?? true;
  const hx = tip - L / 2;
  const hl = L / 2;
  const edgeScale = (hl * W) / Math.hypot(hl, W);
  paint(
    frame,
    (x, y) => {
      const dx = x - hx;
      const d = Math.abs(dx) / hl + Math.abs(y) / W;
      if (d > 1) return -1;
      const front = dx > 0;
      if (!keep(x, y, erosion, (1 - d) * 0.8 + (front ? 0.3 : 0), seed)) return -1;
      const edgeDist = (1 - d) * edgeScale;
      if (edgeWhite && front && edgeDist < 1.1 && erosion < 0.4) return clamp01(1.05 * bright);
      const ridge = Math.abs(y) < 0.8 ? 0.2 : 0;
      const side = front ? 0.72 : 0.5;
      return clamp01((side * (1 - d * 0.5) + ridge) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: hx - hl - 2, y0: -W - 2, x1: tip + 2, y1: W + 2 } },
  );
}

/** 穂先の前の V 字の衝撃線（弓波） */
function bowWave(frame, apex, len, spread, bright, width = 1.4) {
  for (const side of [-1, 1]) streakLine(frame, { ax: apex - len, ay: side * spread, bx: apex, by: side, width, bright });
}

/** 穂先の前へ押し出される潰れた輪の列（前へ開く円錐） */
function coneRings(frame, tip, age, count, seed, strength) {
  for (let i = 0; i < count; i++) {
    const a = age - i;
    if (a < 0 || a > 5) continue;
    ring(frame, {
      ox: tip + 4 + a * 5 * strength,
      radius: (4 + a * 3.2) * strength,
      width: 1.6 + strength * 0.4,
      squash: 0.32,
      erosion: Math.min(0.9, a * 0.19),
      bright: 0.9 - a * 0.12,
      seed: seed + i,
    });
  }
}

/** 先端で前半分へ放射する棘 */
function tipSpikes(frame, tip, age, strength, seed, count = 7) {
  if (age < 0 || age > 3) return;
  for (let i = 0; i < count; i++) {
    const a = ((i / (count - 1)) * 2 - 1) * 70 * DEG + (hash1(i, seed) - 0.5) * 0.12;
    const long = i % 2 === 0 ? 1 : 0.6;
    const r1 = (14 + age * 9) * strength * long + 4;
    const r0 = age === 0 ? 3 : r1 - (8 + 6 * strength);
    if (r0 >= r1) continue;
    streakLine(frame, { ax: tip + Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: tip + Math.cos(a) * r1, by: Math.sin(a) * r1, width: long > 0.9 ? 1.6 : 1.1, bright: 0.95 - age * 0.18 });
  }
}

// -----------------------------------------------------------------------------
// 龍穿（swing thrust reach 90・幅 18・重い）: 長大な突き 1 本に、龍の胴のような螺旋が巻きついて穂先へ昇る
// -----------------------------------------------------------------------------

/** 穂先の到達（reach 90 × 2） */
const DRAGON_R = 180;
const DRAGON_N = 11;
const DRAGON_A = 4;
/** 螺旋の波長（柄の上で 1 巻きの長さ）と最大の振れ幅（当たりの幅 18 × 2 の内側） */
const COIL_WAVE = 34;
const COIL_AMP = 13;

/**
 * 柄に巻く螺旋（龍の胴）: y = amp(x)·sin(φ)。手前（cos φ > 0）の半巻きは明るく太く、奥の半巻きは暗く細い。
 * 振れ幅は根元で 0 から膨らみ、穂先の手前で柄へ絞られる（龍が穂先へ昇って呑まれる）
 */
function dragonCoil(frame, o) {
  const { x0, x1, amp, phase } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 51;
  const spread = o.spread ?? 1;
  if (x1 - x0 < 4) return;
  const k = TAU / COIL_WAVE;
  paint(
    frame,
    (x, y) => {
      const u = (x - x0) / (x1 - x0);
      if (u < 0 || u > 1) return -1;
      const env = Math.sin(Math.PI * Math.min(1, u / 0.2) * 0.5) * Math.pow(1 - u, 0.55);
      const A = amp * env * spread;
      const ph = x * k + phase;
      const c = A * Math.sin(ph);
      const slope = A * k * Math.cos(ph);
      const near = Math.cos(ph) > 0;
      const w = (near ? 1.3 : 0.7) * (0.6 + 0.8 * env);
      const d = Math.abs(y - c) / Math.sqrt(1 + slope * slope);
      if (d > w) return -1;
      if (!keep(x, y, erosion, (1 - d / w) * (1 - u) * 0.6 + u * 0.3, seed)) return -1;
      const lv = near ? 0.55 + 0.35 * Math.cos(ph) : 0.3;
      return clamp01(lv * (1 - (d / w) * 0.4) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x0 - 2, y0: -amp * spread - 3, x1: x1 + 2, y1: amp * spread + 3 } },
  );
}

function dragonPierce(frame, f) {
  const A = DRAGON_A;
  const N = DRAGON_N;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 一気に伸びる: 1 枚目ですでに 4 割
  const tip = SHAFT_BACK + 8 + (DRAGON_R - SHAFT_BACK - 8) * (0.3 + 0.7 * p) + k * 6;
  const back = SHAFT_BACK + (f < A ? 0 : (tip - SHAFT_BACK) * Math.pow(k, 0.8) * 0.9);
  const L = 44 * (f < A ? 0.75 + 0.25 * p : 1 - k * 0.3);
  const W = 11 * (f < A ? 0.8 + 0.2 * p : 1 - k * 0.35);
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  const bright = f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k;

  // 螺旋: 伸びる間は穂先を追って巻き、振り終わりはほどけて外へ膨らみながら崩れる
  if (k < 0.95) {
    dragonCoil(frame, {
      x0: back + 4,
      x1: tip - L * 0.6,
      amp: COIL_AMP,
      phase: -f * 1.3,
      spread: 1 + k * 0.7,
      erosion: f < A ? 0 : Math.min(0.95, 0.1 + 0.9 * k),
      bright,
      seed: 3101,
    });
  }
  shaft(frame, { back, neck: tip - L * 0.55, T: 7 * (1 - k * 0.4), erosion, bright, seed: 3102 });
  spearhead(frame, { tip, L, W, erosion: k < 0.5 ? erosion * 0.8 : erosion * 1.1, bright, seed: 3103 });

  // 平行の速度線: 当たりの幅の外縁（±20 前後）に沿う長い筋。螺旋より外なので重ならない
  if (k < 0.55) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (COIL_AMP + 5 + Math.floor(i / 2) * 5 + k * 3);
      const x1 = tip - L * (0.4 + 0.5 * hash1(i, 3104)) - Math.floor(i / 2) * 18 - k * 30;
      const len = (26 + hash1(i, 3105) * 34) * (1 - k);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, width: 1, bright: (i < 2 ? 0.5 : 0.38) * (1 - k) });
    }
  }
  // 伸び切る直前の V 字（大小 2 層の山形。同じ向きの入れ子で間を空ける）
  const waveAge = f - (A - 2);
  if (waveAge >= 0 && waveAge <= 2) {
    bowWave(frame, tip + 6 + waveAge * 4, (16 + waveAge * 6) * 1.6, (8 + waveAge * 4) * 1.6, 0.9 - waveAge * 0.2, 1.6);
    bowWave(frame, tip - 8 + waveAge * 3, (10 + waveAge * 4) * 1.4, (6 + waveAge * 3) * 1.4, 0.7 - waveAge * 0.18, 1.2);
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    coneRings(frame, tip, age, 3, 3110, 1.6);
    tipSpikes(frame, tip, age, 1.5, 3120);
    // 貫いた先へ抜ける光と、抜けた先を飛ぶ小さな穂先の写し（並んだ敵をまとめて貫く）
    const len = 70 * Math.min(1, (age + 1) / 2);
    if (age <= 3) streakLine(frame, { ax: tip + 2 + age * 14, ay: 0, bx: tip + 2 + len, by: 0, width: age <= 1 ? 2 : 1.2, bright: 0.95 - age * 0.2 });
    if (age >= 1 && age <= 4) spearhead(frame, { tip: tip + len + 6, L: 16 * (1 - k * 0.4), W: 3.4, erosion: k * 0.7, bright: 0.9, seed: 3130 });
  }
  if (f === A - 1) sparkle(frame, tip - 1, 0, 4);
  if (f === A) sparkle(frame, tip + 3, 0, 3);
  // 螺旋がほどけて散る鱗（柄に沿った位置から外へ）と、穂先の前へ抜ける破片
  if (f >= A) {
    shards(frame, f - A, 26, 3140, (i, rnd) => {
      const x = back + 10 + (tip - back - 20) * rnd(1);
      const side = rnd(2) > 0.5 ? 1 : -1;
      const sp = 2 + rnd(3) * 3;
      return { x, y: side * COIL_AMP * 0.6 * rnd(4), vx: sp * 0.6, vy: side * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 16, 3150, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.5;
      const sp = 4 + rnd(2) * 6;
      return { x: tip - 2, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/** 龍穿の発動: 自分の前で螺旋が渦を巻いて一点へ締まり、穂先の閃きが走る（溜めて放つ） */
function dragonPierceCast(frame, f) {
  const N = 8;
  const gather = 4;
  const cx = 18;
  if (f < gather) {
    const p = (f + 1) / gather;
    // 渦: 半径が縮みながら回る 1 本の螺旋の弧（外から内へ巻き込む）
    const R0 = 44 - 30 * p;
    paint(
      frame,
      (x, y) => {
        const dx = x - cx;
        const r = Math.hypot(dx, y);
        if (r > R0 + 3 || r < 3) return -1;
        const a = Math.atan2(y, dx);
        // r = R0 · (1 - t)、t は角で進む（1.5 巻き）
        let best = 99;
        for (let turn = 0; turn < 2; turn++) {
          const th = ((a - f * 0.9) % TAU + TAU) % TAU + turn * TAU;
          const t = th / (TAU * 1.5);
          if (t > 1) continue;
          const rr = R0 * (1 - t * 0.8);
          best = Math.min(best, Math.abs(r - rr));
        }
        const w = 1.2 + 0.6 * (r / R0);
        if (best > w) return -1;
        return clamp01((0.4 + 0.45 * p) * (0.6 + 0.4 * (r / R0)) * (1 - best / w * 0.4));
      },
      { bounds: { x0: cx - R0 - 4, y0: -R0 - 4, x1: cx + R0 + 4, y1: R0 + 4 } },
    );
    if (f === gather - 1) sparkle(frame, cx, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  // 放つ: 前へ短い柄の光と穂先、根元の潰れた輪
  const g = Math.min(1, (f - gather + 1) / 2);
  if (k < 0.8) {
    shaft(frame, { back: 4, neck: 4 + 40 * g, T: 3, erosion: Math.max(0, k - 0.3), bright: 1 - k * 0.3, seed: 3160, core: k < 0.4 });
    spearhead(frame, { tip: 14 + 44 * g, L: 16, W: 4.4, erosion: Math.max(0, k - 0.3), bright: 1 - k * 0.3, seed: 3161 });
  }
  ring(frame, { ox: cx, radius: 8 + k * 18, width: 2.4 - k, squash: 0.45, erosion: Math.min(0.9, k * 0.85), bright: 0.85 - k * 0.3, seed: 3162 });
  if (f === gather) sparkle(frame, 14 + 44 * g, 0, 4);
  shards(frame, f - gather, 10, 3163, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.4;
    const sp = 3 + rnd(2) * 3;
    return { x: cx, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 流星突き（lunge 120・幅 22・3 度突く）: 流星の尾を引いて突進し、通り道の 3 か所で時間差の突きが閃く
// -----------------------------------------------------------------------------

/** 突進の長さ（120 × 2） */
const METEOR_L = 240;
/** 当たりの幅の半分（幅 22 論理 px） */
const METEOR_HALF = 22;
const METEOR_N = 12;
const METEOR_A = 6;
/** 3 度の突きが閃く位置（通り道を 3 等分した先。最後は終点） */
const METEOR_STABS = [0.36, 0.68, 0.97];
/** 流星の尾の長さ（短めにして、通り過ぎた後ろの突きの閃きを尾で覆わない） */
const METEOR_TAIL = 96;

/**
 * 流星の尾: tail → head の帯。頭の手前で最も太く、尾へ細る。芯（中央の細い線）が明るく、縁は暗い。
 * erosion で尾の側から崩れる
 */
function cometTail(frame, o) {
  const { tail, head, T } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 61;
  const span = head - tail;
  if (span < 4) return;
  paint(
    frame,
    (x, y) => {
      const u = (x - tail) / span;
      if (u < 0 || u > 1) return -1;
      // 尾は細く、頭の手前 1 割で最大、頭は丸く閉じる
      const w = (T / 2) * (u < 0.9 ? Math.pow(u / 0.9, 0.8) : Math.sqrt(Math.max(0, 1 - ((u - 0.9) / 0.1) ** 2)));
      const ay = Math.abs(y);
      if (w < 0.5 || ay > w) return -1;
      const q = ay / w;
      // 尾の縁は流れる筋でちぎれる（流星の揺らぎ）
      const streak = valueNoise(x * 0.25, y * 2.2, 3, seed) ;
      if (q > 0.55 && streak < 0.35 + 0.4 * (1 - u)) return -1;
      if (!keep(x, y, erosion, (1 - q) * u, seed + 3)) return -1;
      return clamp01((1 - q) ** 1.2 * (0.35 + 0.6 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: tail - 2, y0: -T / 2 - 2, x1: head + 2, y1: T / 2 + 2 } },
  );
}

/** 1 度の突きの閃き（突進の途中の位置 x）: 前へ短く伸びる穂先・直交の潰れた輪・放射の棘。age はその突きの枚数 */
function meteorStab(frame, x, age, seed, last) {
  if (age < 0) return;
  const s = last ? 1.3 : 1;
  if (age <= 2) {
    const g = Math.min(1, (age + 1) / 2);
    const tip = x + 10 + 16 * g * s;
    shaft(frame, { back: tip - 34 * s, neck: tip - 10 * s, T: 3.2 * s, erosion: age === 2 ? 0.45 : 0, bright: 1 - age * 0.12, seed, core: age < 2 });
    spearhead(frame, { tip, L: 18 * s, W: 5 * s, erosion: age === 2 ? 0.4 : 0, bright: 1 - age * 0.1, seed: seed + 1 });
    bowWave(frame, tip + 4 + age * 3, (10 + age * 4) * s, (5 + age * 3) * s, 0.85 - age * 0.2, 1.3);
  }
  // 当てた所の縦長の輪（突きの向きに潰れる）
  if (age >= 1 && age <= 5) {
    const a = age - 1;
    ring(frame, { ox: x + 22 * s, radius: (6 + a * 5) * s, width: 2 - a * 0.2, squash: 0.35, erosion: Math.min(0.9, a * 0.2), bright: 0.85 - a * 0.12, seed: seed + 2 });
  }
  if (age >= 1) tipSpikes(frame, x + 24 * s, age - 1, last ? 1.3 : 0.9, seed + 3, last ? 7 : 5);
  if (age === 1) sparkle(frame, x + 24 * s, 0, last ? 4 : 3);
  shards(frame, age - 1, last ? 12 : 7, seed + 4, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2;
    const sp = 3 + rnd(2) * 4;
    return { x: x + 22 * s, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
  });
}

function meteorThrust(frame, f) {
  const A = METEOR_A;
  const N = METEOR_N;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 流星の頭（自分の穂先）は通り道を走り、終点で止まる
  const head = (METEOR_L - 14) * p + 14;
  const tail = f < A ? Math.max(-10, head - METEOR_TAIL) : head - METEOR_TAIL + (METEOR_TAIL - 10) * Math.pow(k, 0.8);
  const erosion = f < A ? 0 : 0.05 + 0.85 * Math.pow(k, 1.2);
  const bright = f < A ? 0.9 + 0.1 * p : 1 - 0.3 * k;
  cometTail(frame, { tail, head: head - 8, T: 17 * (1 - k * 0.4), erosion: Math.min(1, erosion * 1.15), bright: bright * 0.85, seed: 3201 });
  // 頭の穂先（流星の核）: 走る間だけ
  if (k < 0.5) {
    shaft(frame, { back: head - 44, neck: head - 14, T: 4.4, erosion: erosion * 0.8, bright, seed: 3202, core: k < 0.3 });
    spearhead(frame, { tip: head + 4, L: 26, W: 7, erosion: erosion * 0.8, bright, seed: 3203 });
  }
  // 尾の外に沿う流れの筋（当たりの幅の縁）。帯の外なので二重線に見えない
  if (k < 0.45) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (METEOR_HALF - 6 + Math.floor(i / 2) * 3 + hash1(i, 3204) * 2);
      const x1 = head - 20 - hash1(i, 3205) * 30 - k * 20;
      const len = (30 + hash1(i, 3206) * 40) * (1 - k);
      streakLine(frame, { ax: Math.max(-12, x1 - len), ay: y, bx: x1, by: y, width: 1, bright: 0.5 * (1 - k) });
    }
  }
  // 3 度の突き: 頭が通り過ぎた枚から閃く（位置と時間の両方で離す）
  METEOR_STABS.forEach((t, i) => {
    const x = METEOR_L * t - 24;
    const passAt = METEOR_STABS.length - 1 === i ? A - 1 : Math.max(0, Math.ceil(A * t * 0.8) - 1);
    meteorStab(frame, x, f - passAt, 3210 + i * 10, i === METEOR_STABS.length - 1);
  });
  // 尾から散る残り火（流星のかけら）: 通り道に沿って後ろへ漂う
  if (f >= 1) {
    shards(frame, f - 1, 30, 3250, (i, rnd) => {
      const x = 20 + (METEOR_L - 40) * rnd(1);
      const side = rnd(2) > 0.5 ? 1 : -1;
      return { x, y: side * rnd(3) * 10, vx: -(1 + rnd(4) * 2), vy: side * (0.5 + rnd(5) * 1.5), life: 4 + Math.floor(rnd(6) * 4), size: rnd(7) > 0.6 ? 2 : 1, drag: 0.9 };
    });
  }
}

/** 流星突きの発動: 踏み切りの潰れた輪と後ろへ吹く砂、前に星の閃き（4 方向の長い光条）が瞬く */
function meteorThrustCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  ring(frame, { ox: -8 - f * 2, radius: 7 + f * 5, width: 2.6 - k, squash: 0.5, erosion: Math.min(0.9, k * 0.9), bright: 0.8 - k * 0.3, seed: 3301 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (4 + Math.floor(i / 2) * 5 + hash1(i, 3302) * 2);
      const x0 = -12 - f * 5 - hash1(i, 3303) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 16 - hash1(i, 3304) * 14, by: y + side * 4, bright: 0.5 * (1 - k) });
    }
  }
  // 星の閃き: 前方の一点に 4 本の光条（前後が長い）。流星が「今ここから」走る合図
  if (f <= 4) {
    const sx = 30;
    const g = f <= 1 ? (f + 1) / 2 : 1 - (f - 1) / 4;
    const arms = [
      [1, 0, 26],
      [-1, 0, 18],
      [0, 1, 10],
      [0, -1, 10],
    ];
    for (const [ax, ay, len] of arms) {
      streakLine(frame, { ax: sx + ax * len * g, ay: ay * len * g, bx: sx + ax * 2, by: ay * 2, width: ax !== 0 ? 1.6 : 1.1, bright: 0.95 * Math.max(0.3, g) });
    }
    if (f === 1) sparkle(frame, sx, 0, 4);
  }
  shards(frame, f, 10, 3305, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.6;
    const sp = 3 + rnd(2) * 3;
    return { x: -8, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

// -----------------------------------------------------------------------------
// 陣の構え（持続）: 足元の陣から穂先が立ち並ぶ。dirs 1（立つ向きは画面の上）
// -----------------------------------------------------------------------------

/** 陣の楕円（地面に置いた輪。横の半径と縦の半径） */
const RING_RX = 40;
const RING_RY = 17;
/** 立ち並ぶ穂先の数（6 回対称。1 巡で 1/6 周回るので継ぎ目が出ない） */
const PIKES = 6;
const FORM_N = 12;

/** 立てた槍 1 本（地面の (x, y) から上へ）。h は穂先の先端までの高さ */
function uprightPike(frame, x, y, h, o) {
  const t = turned(frame, -Math.PI / 2, x, y);
  const L = o.L ?? 12;
  if (h - L * 0.55 > 2) shaft(t, { back: 0, neck: h - L * 0.55, T: o.T ?? 2.4, erosion: o.erosion ?? 0, bright: (o.bright ?? 1) * 0.85, seed: o.seed ?? 71, core: false });
  spearhead(t, { tip: h, L, W: o.W ?? 3.4, erosion: o.erosion ?? 0, bright: o.bright ?? 1, seed: (o.seed ?? 71) + 1, edgeWhite: o.edgeWhite ?? true });
}

/** 陣の上の i 番目の位置（楕円の角 a）と、キャラの正面を覆わないための見え方（0..1） */
function ringSpot(a) {
  const x = Math.cos(a) * RING_RX;
  const y = FEET_Y + Math.sin(a) * RING_RY;
  // 手前の中央（キャラの体の前）は薄く、奥の中央（頭の後ろ）も少し薄く
  const front = Math.sin(a) > 0 ? 1 - 0.85 * (1 - smoothstep(10, 26, Math.abs(x))) : 1 - 0.4 * (1 - smoothstep(8, 22, Math.abs(x)));
  return { x, y, vis: front, depth: 0.75 + 0.25 * Math.sin(a) };
}

/** 陣の構えの発動: 足元の陣が広がって描かれ、6 本の穂先が地面から一斉に突き上がって光る */
function formationCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const grow = Math.min(1, (f + 1) / 3);
  // 陣の輪（楕円）が広がり、外に弾ける輪が 1 枚
  ring(frame, { oy: FEET_Y, radius: RING_RY * grow, width: 1.8, squash: RING_RX / RING_RY, erosion: Math.max(0, k - 0.5) * 1.6, bright: 0.6 - k * 0.2, seed: 3401 });
  if (f >= 2) {
    const a = f - 2;
    ring(frame, { oy: FEET_Y, radius: RING_RY + 3 + a * 3, width: 2.2 - a * 0.15, squash: RING_RX / RING_RY, erosion: Math.min(0.92, a * 0.14), bright: 0.8 - a * 0.08, seed: 3402 });
  }
  // 突き上がる穂先: 1 枚ずつずれて、伸び切った所で光り、上へ抜けるように崩れる
  for (let i = 0; i < PIKES; i++) {
    const a = -Math.PI / 2 + (i / PIKES) * TAU + Math.PI / PIKES;
    const s = ringSpot(a);
    const age = f - 1 - (i % 3) * 0.5;
    if (age < 0) continue;
    const rise = Math.min(1, easeSwing((age + 1) / 3));
    const fade = Math.max(0, (age - 3) / 4);
    if (fade >= 1) continue;
    const h = (40 + 6 * s.depth) * rise + fade * 8;
    uprightPike(frame, s.x, s.y - fade * 10, h, { L: 16, W: 4.2, T: 2.8, erosion: fade * 0.9, bright: (1.05 - fade * 0.4) * Math.max(0.35, s.vis), seed: 3410 + i * 3, edgeWhite: s.vis > 0.6 });
    if (Math.floor(age) === 2 && s.vis > 0.6) sparkle(frame, s.x, s.y - fade * 10 - h + 1, 3);
  }
  // 地面から弾ける土の粒（陣の縁から外と上へ）
  shards(frame, f - 1, 18, 3430, (i, rnd) => {
    const a = rnd(1) * TAU;
    const x = Math.cos(a) * RING_RX;
    const y = FEET_Y + Math.sin(a) * RING_RY;
    return { x, y, vx: Math.cos(a) * (1 + rnd(2) * 2), vy: -(2.5 + rnd(3) * 3), life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.85 };
  });
}

/** 陣の構えの纏い（持続中ずっと）: 陣の上を 6 本の穂先がゆっくり巡り、ときどき穂先が光る */
function formationSustain(frame, f) {
  const cycle = f / FORM_N;
  // 奥から描く（段は raise なので順は結果に効かないが、読みやすさのため）
  for (let i = 0; i < PIKES; i++) {
    const a = -Math.PI / 2 + ((i + cycle) / PIKES) * TAU;
    const s = ringSpot(a);
    if (s.vis < 0.2) continue;
    // 呼吸: 穂先が少し沈んで伸びる（位相は 1 巡で一周）
    const bob = Math.sin((cycle + i / PIKES) * TAU) * 1.5;
    uprightPike(frame, s.x, s.y, 30 + bob, { L: 12, W: 3.2, T: 2, bright: 0.72 * s.vis * s.depth, seed: 3501 + i, edgeWhite: false });
  }
  // 1 巡に 2 回、左右の穂先の先が光る（槍衾の刃の照り返し）
  if (f === 1) sparkle(frame, -RING_RX + 2, FEET_Y - 32, 2);
  if (f === 7) sparkle(frame, RING_RX - 2, FEET_Y - 32, 2);
  // 陣から立ちのぼる細い粒
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 3510)) % 1;
    const a = hash1(i, 3511) * TAU;
    const x = Math.cos(a) * RING_RX * 0.9;
    const y = FEET_Y + Math.sin(a) * RING_RY * 0.9 - t * 36;
    if (Math.abs(x) < 14 && y > -24) continue;
    dot(frame, x, y, Math.max(2, Math.min(5, Math.round(2 + 3 * Math.sin(Math.PI * t)))));
  }
}

/** 陣の地面: 二重の楕円と、6 本の穂先の足元を結ぶ六芒の線（巡る穂先と同じ速さで回る） */
function formationGround(frame, f) {
  const cycle = f / FORM_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  const sq = RING_RX / RING_RY;
  ring(frame, { oy: FEET_Y, radius: RING_RY + 2, width: 1.6, squash: sq, bright: 0.34 + 0.12 * pulse, seed: 3601 });
  ring(frame, { oy: FEET_Y, radius: RING_RY - 5, width: 1.1, squash: sq, bright: 0.26 + 0.08 * pulse, seed: 3602 });
  // 六芒: 1 つ飛ばしの 2 つの三角（陣の紋）
  const pts = [];
  for (let i = 0; i < PIKES; i++) {
    const a = -Math.PI / 2 + ((i + cycle) / PIKES) * TAU;
    pts.push({ x: Math.cos(a) * (RING_RX - 1), y: FEET_Y + Math.sin(a) * (RING_RY - 1) });
  }
  for (let i = 0; i < PIKES; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 2) % PIKES];
    streakLine(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, width: 1, bright: 0.22 + 0.08 * pulse });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 奥義 → 絵。龍穿の base は振りの届き（reach）、流星突きの base は突進で進んだ距離 */
const FX = {
  moveset: "spear",
  ultimates: {
    "spear.dragonPierce": {
      ramp: "light",
      cast: { sheet: "spearUlt.dragonPierceCast", life: 0.3 },
      acts: [{ sheet: "spearUlt.dragonPierce", life: 0.55, base: DRAGON_R / 2, pivot: "pos" }],
    },
    "spear.meteorThrust": {
      ramp: "light",
      cast: { sheet: "spearUlt.meteorThrustCast", life: 0.3 },
      acts: [{ sheet: "spearUlt.meteorThrust", life: 0.6, base: METEOR_L / 2, pivot: "pos" }],
    },
    "spear.formation": {
      ramp: "light",
      cast: { sheet: "spearUlt.formationCast", life: 0.6 },
      sustain: { sheet: "spearUlt.formation", period: 1.2, ground: "spearUlt.formationGround" },
    },
  },
};

export const ATLAS = {
  key: "spearUlt",
  fx: FX,
  sheets: [
    { key: "spearUlt.dragonPierce", dirs: DIRS, frames: DRAGON_N, active: DRAGON_A, size: 2 * (DRAGON_R + 100), draw: dragonPierce },
    { key: "spearUlt.dragonPierceCast", dirs: DIRS, frames: 8, active: 0, size: 140, draw: dragonPierceCast },
    { key: "spearUlt.meteorThrust", dirs: DIRS, frames: METEOR_N, active: METEOR_A, size: 2 * (METEOR_L + 40), draw: meteorThrust },
    { key: "spearUlt.meteorThrustCast", dirs: DIRS, frames: 7, active: 0, size: 128, draw: meteorThrustCast },
    { key: "spearUlt.formationCast", dirs: 1, frames: 10, active: 0, size: 160, draw: formationCast },
    { key: "spearUlt.formation", dirs: 1, frames: FORM_N, active: 0, size: 128, draw: formationSustain },
    { key: "spearUlt.formationGround", dirs: 1, frames: FORM_N, active: 0, size: 112, draw: formationGround },
  ],
};
