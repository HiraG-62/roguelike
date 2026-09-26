// 杖（moveset "wand"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は wand.mjs
// 単位は絵のドット（論理 0.5px）。数値は奥義の定義（魔導砲の弾の半径 8・魔法陣の周囲攻撃の半径 64）× 2 が目安
//
// 杖の絵の言葉は「詠唱の紋」（輪・外へ出る刻み・内側の星形）と、光の「極細の針・十字の閃き」。奥義はそれを大きく重ねる:
//   魔導砲 = 照準の先に 3 枚の紋が砲身のように並び、そこから巨大な光弾が抜ける
//   魔法陣 = 足元に当たりの円いっぱいの陣（二重の輪・ルーンの帯・六芒星）が開き、光の波が外へ押し出す
//   詠唱   = 頭上の光輪と、体の周りを巡る 3 つの小さな紋（魔法が 1 本増えることの見た目）
// 白（段 7）は紋の縁ではなく、閃きの光点と光弾の前縁の細い線だけに使う（紋の線は段 6 まで）
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾の方向の数（尾の長い光弾は 24 方向だと角が目立つ） */
const SHOT_DIRS = 32;
/** 紋の線の明るさの上限（段 6 まで。白は光点だけ） */
const GLYPH_CAP = 0.76;
/** 足元の高さ（キャラは絵で 48 ドット。原点はキャラの中心） */
const FEET_Y = 18;
/** 頭上（光輪の高さ） */
const HEAD_Y = -34;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 振りの進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 崩れの判定（ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.2;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/**
 * 折れ線を太さつきで塗る（wand.mjs の stroke と同じ考え）。width(t)・bright(t) は始点からの割合 t で決める。
 * core を渡すと中心線の細い芯（光の針の白い芯）を足す
 */
function stroke(frame, pts, o) {
  if (pts.length < 2) return;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push((lens[i - 1] ?? 0) + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  const widthAt = typeof o.width === "function" ? o.width : () => o.width;
  const brightAt = typeof o.bright === "function" ? o.bright : () => o.bright ?? 0.7;
  const maxW = o.maxWidth ?? (typeof o.width === "number" ? o.width : 6);
  const core = o.core ?? 0;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  paint(
    frame,
    (x, y) => {
      let best = Infinity;
      let bt = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const s = segment(x, y, a.x, a.y, b.x, b.y);
        if (s.d < best) {
          best = s.d;
          bt = ((lens[i - 1] ?? 0) + s.t * ((lens[i] ?? 0) - (lens[i - 1] ?? 0))) / total;
        }
      }
      const w = widthAt(bt) / 2;
      if (w < 0.35 || best > w) return -1;
      if (core > 0 && best < core / 2) return clamp01(brightAt(bt) + 0.3);
      return clamp01(brightAt(bt) * (1 - 0.55 * (best / w)));
    },
    { bounds: { x0: Math.min(...xs) - maxW - 2, y0: Math.min(...ys) - maxW - 2, x1: Math.max(...xs) + maxW + 2, y1: Math.max(...ys) + maxW + 2 }, samples: o.samples ?? 3, dither: 0.04 },
  );
}

/** 放射状に散る粒。cone は center を中心にした散る角の幅（TAU で全周） */
function burst(frame, age, o) {
  const cone = o.cone ?? TAU;
  const center = o.center ?? 0;
  shards(frame, age, o.n, o.seed, (i, rnd) => {
    const a = center + (rnd(1) - 0.5) * cone;
    const sp = o.speed * (0.5 + rnd(2));
    const r0 = (o.r0 ?? 0) * (0.6 + 0.4 * rnd(6));
    return {
      x: (o.x ?? 0) + Math.cos(a) * r0,
      y: (o.y ?? 0) + Math.sin(a) * r0,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + (o.rise ?? 0) * rnd(8),
      life: (o.life ?? 3) + Math.floor(rnd(3) * 3),
      size: rnd(4) > 0.5 ? 2 : 1,
      drag: o.drag ?? 0.82,
      bright: o.bright ?? 1,
    };
  });
}

/**
 * 詠唱の紋の一般形。円の空間で (x/sx, y/sy) に潰す（sx < 1 = 撃つ向きに直交する円盤を横から、sy < 1 = 地面に置いた輪）。
 * 輪（R）と内輪（inner）は円の空間で、星形・刻み・ルーンは画面の空間の線分で塗る（潰しても線が痩せないように）。
 * reveal（0..1）は中心から外へ描き上がる割合、erosion で欠ける
 */
function glyph(frame, o) {
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const { R } = o;
  const sx = o.sx ?? 1;
  const sy = o.sy ?? 1;
  const rot = o.rot ?? 0;
  const width = o.width ?? 2;
  const bright = Math.min(GLYPH_CAP, o.bright ?? 0.7);
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const reveal = o.reveal ?? 1;
  const inner = o.inner ?? 0;
  const segs = [];
  const toScreen = (a, r) => ({ x: ox + Math.cos(a) * r * sx, y: oy + Math.sin(a) * r * sy });
  const addSeg = (a0, r0, a1, r1, w, b) => {
    const p = toScreen(a0, r0);
    const q = toScreen(a1, r1);
    segs.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y, w, b, rmax: Math.max(r0, r1) });
  };
  // 星形（starStep 飛ばしで結ぶ。6 と 2 で六芒星、5 と 2 で五芒星、3 と 1 で三角）
  const star = o.star ?? 0;
  const starR = o.starR ?? R * 0.94;
  for (let i = 0; i < star; i++) {
    const a0 = rot * (o.starSpin ?? 1) + (i / star) * TAU - Math.PI / 2;
    const a1 = a0 + ((o.starStep ?? 2) / star) * TAU;
    addSeg(a0, starR, a1, starR, width * 0.8, 0.8);
  }
  // 外へ出る刻み（1 つおきに長さを変えて文字のような不揃いに）
  const ticks = o.ticks ?? 0;
  const tickLen = o.tickLen ?? 4;
  for (let i = 0; i < ticks; i++) {
    const a = rot + (i / ticks) * TAU;
    const long = hash1(i, seed) > 0.4;
    addSeg(a, R + width * 0.5, a, R + tickLen * (long ? 1 : 0.55), width * 0.75, 0.9);
  }
  // ルーンの帯（R と runeIn の間）: 区画ごとに縦棒・横棒と点・「く」の字のどれか
  const runes = o.runes ?? 0;
  const runeIn = o.runeIn ?? R * 0.82;
  const rw = width * 0.7;
  for (let i = 0; i < runes; i++) {
    const a = -rot * (o.runeSpin ?? 1) + (i / runes) * TAU;
    const cell = TAU / runes;
    const r0 = runeIn + (R - runeIn) * 0.22;
    const r1 = runeIn + (R - runeIn) * 0.78;
    const rm = (r0 + r1) / 2;
    const kind = Math.floor(hash1(i, seed + 3) * 3);
    if (kind === 0) {
      addSeg(a, r0, a, r1, rw, 0.85);
      addSeg(a + cell * 0.22, rm, a + cell * 0.22, r1, rw, 0.7);
    } else if (kind === 1) {
      addSeg(a - cell * 0.22, r1, a + cell * 0.22, r1, rw, 0.8);
      addSeg(a, r0, a, rm, rw, 0.8);
    } else {
      addSeg(a - cell * 0.2, r0, a, r1, rw, 0.85);
      addSeg(a, r1, a + cell * 0.2, r0, rw, 0.85);
    }
  }
  // 頂点の小さな輪（六芒星の角に置く副紋）
  const nodes = o.nodes ?? 0;
  const nodeR = o.nodeR ?? 4;
  const nodePts = [];
  for (let i = 0; i < nodes; i++) nodePts.push(toScreen(rot * (o.starSpin ?? 1) + (i / nodes) * TAU - Math.PI / 2, starR));
  const reach = R + tickLen + width + 2;
  paint(
    frame,
    (px, py) => {
      const cx = (px - ox) / sx;
      const cy = (py - oy) / sy;
      const r = Math.hypot(cx, cy);
      if (r > R * reveal + tickLen + 1) return -1;
      // 輪の法線方向の拡大率で太さを戻す
      const nx = r > 0 ? cx / r : 1;
      const ny = r > 0 ? cy / r : 0;
      const scale = Math.hypot(nx * sx, ny * sy) || 1;
      let v = -1;
      const dRing = Math.abs(r - R) * scale;
      if (dRing < width / 2) v = Math.max(v, bright * (1 - 0.35 * (dRing / (width / 2))));
      if (inner > 0 && Math.abs(r - inner) * scale < width * 0.4 + 0.3) v = Math.max(v, bright * 0.75);
      if (o.core && Math.abs(r - o.core) * scale < width * 0.35 + 0.3) v = Math.max(v, bright * 0.7);
      for (const s of segs) {
        if (s.rmax > R * reveal + 1) continue;
        const d = segment(px, py, s.ax, s.ay, s.bx, s.by).d;
        if (d < s.w / 2 + 0.25) v = Math.max(v, bright * s.b);
      }
      for (const n of nodePts) {
        const d = Math.abs(Math.hypot(px - n.x, py - n.y) - nodeR);
        if (d < width * 0.4 + 0.25 && r < R * reveal) v = Math.max(v, bright * 0.8);
      }
      if (o.fill && r < R && r > R * 0.55) v = Math.max(v, o.fill * ((r / R - 0.55) / 0.45));
      if (v < 0.1) return -1;
      if (reveal < 1 && r > R * reveal) return -1;
      if (!survives(px, py, erosion, 0.2, seed)) return -1;
      return clamp01(v * (1 - erosion * 0.35));
    },
    { bounds: { x0: ox - reach * sx - 2, y0: oy - reach * sy - 2, x1: ox + reach * sx + 2, y1: oy + reach * sy + 2 }, samples: o.samples ?? 3, dither: 0.03 },
  );
}

// -----------------------------------------------------------------------------
// 魔導砲（volley 1 発・半径 8・貫通）: 照準の先に 3 枚の紋の砲身、巨大な光弾が抜ける
// -----------------------------------------------------------------------------

/** 砲身の 3 枚の紋（x = 自分からの距離、R = 紋の半径）。先へ行くほど大きく、撃つ向きに直交した円盤を横から見る */
const BARREL = [
  { x: 18, R: 12, ticks: 6, star: 3, starStep: 1, spin: 0.5, seed: 3101 },
  { x: 32, R: 17, ticks: 8, star: 5, starStep: 2, spin: -0.4, seed: 3102 },
  { x: 50, R: 24, ticks: 12, star: 6, starStep: 2, spin: 0.3, seed: 3103 },
];
/** 砲身の紋の潰れ（x の縮み） */
const BARREL_SQUASH = 0.42;
const CANNON_CAST_N = 10;

/** 魔導砲の発動: 3 枚の紋が手前から順に開いて砲身になり、魔力の筋が渦を巻いて砲口へ集まる。弾が抜けたあと外周から欠ける */
function cannonCast(frame, f) {
  const N = CANNON_CAST_N;
  const hold = 5;
  const k = f < hold ? 0 : (f - hold + 1) / (N - hold + 1);
  BARREL.forEach((b, i) => {
    const age = f - i * 0.8;
    if (age < 0) return;
    const p = easeSwing(Math.min(1, (age + 1) / 2.5));
    glyph(frame, {
      ox: b.x + k * 6 * (i + 1),
      R: b.R * (0.4 + 0.6 * p) * (1 + 0.15 * k),
      sx: BARREL_SQUASH,
      rot: f * b.spin,
      ticks: b.ticks,
      tickLen: 5,
      star: b.star,
      starStep: b.starStep,
      inner: i === 2 ? b.R * 0.62 * p : 0,
      width: i === 2 ? 2.6 : 2.2,
      bright: 0.6 + 0.15 * p - 0.3 * k,
      fill: f < hold ? 0.25 : 0,
      erosion: k * 0.9,
      seed: b.seed,
    });
  });
  // 集まる魔力: 砲身の周りから渦を巻いて最後の紋の中心へ（撃つ前だけ）
  if (f < hold) {
    const p = (f + 1) / hold;
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * TAU + hash1(i, 3110) * 0.5;
      const t = clamp01(p + hash1(i, 3111) * 0.25);
      const r = 70 * (1 - t) + 10;
      const a = a0 + t * 1.8;
      const cx = 36;
      const x = cx + Math.cos(a) * r * 0.7;
      const y = Math.sin(a) * r;
      const x2 = cx + Math.cos(a - 0.3) * (r + 8) * 0.7;
      const y2 = Math.sin(a - 0.3) * (r + 8);
      if (t < 0.96) streakLine(frame, { ax: x2, ay: y2, bx: x, by: y, width: 1.2, bright: 0.4 + 0.35 * t });
    }
  }
  // 杖の先（最初の紋の手前）の閃き
  if (f === 1 || f === 3) sparkle(frame, 10, 0, f === 3 ? 3 : 2);
  if (k > 0) burst(frame, f - hold, { n: 16, seed: 3112, speed: 2.4, cone: TAU, x: 36, r0: 20, life: 3 });
}

/** 砲撃の閃光の長さ（杖の先から前へ） */
const CANNON_BEAM = 150;
const CANNON_N = 9;

/** 魔導砲の砲撃: 砲口から前へ抜ける極細の光条の束、砲身の紋に沿って押し出される 3 枚の輪、足元の反動の輪 */
function cannonFire(frame, f) {
  const N = CANNON_N;
  const k = f / (N - 1);
  // 砲撃の光条: 砲口から前へ抜ける太い 1 本（白い芯）。1 枚目で伸び切り、後ろから痩せて前へ抜ける
  if (f <= 4) {
    const tail = 44 + f * 22;
    const head = f === 0 ? CANNON_BEAM * 0.75 : CANNON_BEAM;
    const T = 12 * (1 - f * 0.18);
    stroke(frame, [{ x: tail, y: 0 }, { x: head, y: 0 }], { width: (t) => T * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.6) + 0.6, maxWidth: T + 1, bright: (t) => (0.55 + 0.2 * t) * (1 - f * 0.1), core: f <= 2 ? 1.2 : 0 });
    // 脇の針の光条（左右 2 本ずつ。長さと位置をずらして梯子に見せない）
    [-14, 10, -22, 19].forEach((y, i) => {
      const x0 = tail + 12 + hash1(i, 3201) * 30 + f * 6;
      const x1 = Math.min(head + 6, x0 + 30 + hash1(i, 3202) * 50);
      if (x1 - x0 < 6) return;
      streakLine(frame, { ax: x0, ay: y * (1 + f * 0.1), bx: x1, by: y * (1 + f * 0.1), width: 1, bright: 0.6 * (1 - f * 0.18) });
    });
  }
  // 砲身の紋が撃ち出されて前へ押し出される輪（3 枚。時間差で広がって欠ける）
  BARREL.forEach((b, i) => {
    const age = f - i * 0.6;
    if (age < 0) return;
    const e = Math.min(0.95, age * 0.14);
    ring(frame, { ox: b.x + 6 + age * (5 + i * 2), radius: b.R + age * (3 + i), width: 2.6 - i * 0.3, squash: BARREL_SQUASH, erosion: e, bright: 0.8 - age * 0.07, seed: 3210 + i });
  });
  // 反動: 足元（自分）の後ろへ潰れた輪と、後ろへ吹く短い筋
  ring(frame, { ox: -4 - f * 2, radius: 8 + f * 5, width: 2.2, squash: 0.5, erosion: Math.min(0.9, k), bright: 0.65 - k * 0.3, seed: 3220 });
  if (f === 0) sparkle(frame, BARREL[2].x, 0, 4);
  if (f === 1) sparkle(frame, BARREL[2].x + 4, 0, 3);
  burst(frame, f, { n: 22, seed: 3230, speed: 5, cone: 1.4, x: 52, r0: 6, life: 4, drag: 0.85 });
}

// --- 光弾（shots[0]） --------------------------------------------------------

/** 光弾の半径（弾の半径 8 論理 px × 2）と尾の長さ（速さ 約 420 × 0.04 秒の倍を少し超える、見せ場の長い尾） */
const ORB_R = 16;
const ORB_TAIL = 84;
const ORB_N = 6;

/** 巨大な光弾: 光る球（前縁に白い細い縁）、中で回る四芒の閃き、前へふくらむ衝撃の弧、後ろへ細る彗星の尾と針の光条 */
function cannonOrb(frame, f) {
  const ph = (f / ORB_N) * TAU;
  // 尾: 球の直径から先細りに消える 1 本。位相で縞が後ろへ流れる
  paint(
    frame,
    (x, y) => {
      if (x > 0 || x < -ORB_TAIL) return -1;
      const t = -x / ORB_TAIL;
      const half = ORB_R * 0.95 * Math.pow(1 - t, 1.35);
      if (Math.abs(y) > half || half < 0.6) return -1;
      const q = Math.abs(y) / half;
      const band = 0.85 + 0.15 * Math.sin(x * 0.35 + ph);
      // 尾の後ろ半分は縞で途切れる（位相で後ろへ流れる。穴ではなく尾の向きの切れ目）
      if (t > 0.45 && valueNoise((x - (ph / TAU) * 24) * 0.35, y * 2, 3, 3301) < (t - 0.45) * 1.2) return -1;
      return clamp01((1 - q) ** 0.8 * (0.62 - 0.45 * t) * band);
    },
    { bounds: { x0: -ORB_TAIL - 2, y0: -ORB_R - 2, x1: 2, y1: ORB_R + 2 } },
  );
  // 球: 縁が明るい光の玉。前縁（+x 側）の外周 1.5 ドットだけ白い
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const R = ORB_R + 0.6 * Math.sin(ph * 2 + Math.atan2(y, x) * 3);
      if (r > R) return -1;
      const q = r / R;
      if (R - r < 1.5 && x > R * 0.35) return 1;
      // 縁の帯（段 6）と、中は段 3〜4 の薄い光（白い塊にしない）
      if (R - r < 3.2) return 0.7;
      return clamp01(0.3 + 0.22 * q * q + 0.05 * (x / R));
    },
    { bounds: { x0: -ORB_R - 3, y0: -ORB_R - 3, x1: ORB_R + 3, y1: ORB_R + 3 } },
  );
  // 中の四芒の閃き（位相で 1/4 回転 = 継ぎ目なし）
  const rot = (f / ORB_N) * (Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    const L = i % 2 === 0 ? 11 : 8;
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => 2.6 * (1 - t) + 0.4, maxWidth: 3, bright: (t) => 0.78 - 0.3 * t, samples: 2 });
  }
  sparkle(frame, 0, 0, f % 2 === 0 ? 3 : 2);
  // 前へふくらむ衝撃の弧（球の前、細い 1 本）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x + 4, y);
      const a = Math.atan2(y, x + 4);
      if (Math.abs(a) > 1.0 || Math.abs(r - (ORB_R + 7 + (f % 2))) > 0.8) return -1;
      return 0.6 * (1 - Math.abs(a));
    },
    { bounds: { x0: 0, y0: -ORB_R - 10, x1: ORB_R + 10, y1: ORB_R + 10 }, dither: 0 },
  );
  // 針の光条: 尾の脇を後ろへ流れる極細の線（4 本。位相で長さが循環）
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (ORB_R * 0.55 + (i >> 1) * 5);
    const u = (hash1(i, 3310) + f / ORB_N) % 1;
    const x1 = -ORB_R * 0.6 - u * 30;
    streakLine(frame, { ax: x1 - 20 - hash1(i, 3311) * 20, ay: y, bx: x1, by: y, width: 1, bright: 0.55 * (1 - u * 0.6) });
  }
  // 尾に残る光の粒
  for (let i = 0; i < 8; i++) {
    const u = (hash1(i, 3320) + f / ORB_N) % 1;
    const x = -ORB_R * 0.5 - u * ORB_TAIL * 0.9;
    const y = (hash1(i, 3321) - 0.5) * ORB_R * 1.6 * (1 - u * 0.5);
    dot(frame, x, y, Math.max(2, Math.round(6 - u * 4)));
  }
}

/** 光弾の撃ち出し: 大きな十字の閃光（前へ長い）と二重の輪、前へ散る粒 */
function cannonMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  const L = 40 * (1 - k * 0.5);
  stroke(frame, [{ x: -L * 0.35, y: 0 }, { x: L, y: 0 }], { width: (t) => 5 * Math.sin(Math.PI * t) + 0.6, maxWidth: 6, bright: 0.78 * (1 - k * 0.5) });
  const V = 22 * (1 - k * 0.6);
  stroke(frame, [{ x: 0, y: -V }, { x: 0, y: V }], { width: (t) => 3.4 * Math.sin(Math.PI * t) + 0.5, maxWidth: 4, bright: 0.7 * (1 - k * 0.5) });
  if (f <= 2) sparkle(frame, 0, 0, 4 - f);
  if (f >= 1) {
    ring(frame, { radius: 8 + f * 5, width: 2, squash: 0.6, bright: 0.6, erosion: f * 0.17, seed: 3401 });
    ring(frame, { ox: 6 + f * 2, radius: 5 + f * 4, width: 1.4, squash: 0.45, bright: 0.5, erosion: f * 0.2, seed: 3402 });
  }
  burst(frame, f, { n: 10, seed: 3403, speed: 4, cone: 1.3, life: 3 });
}

/** 光弾が抜けた敵（貫通するので毎回）: 前へ抜ける鋭い光条と十字、小さな輪 */
function cannonHit(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.28;
    const L = (i === 2 || i === 3 ? 30 : 18) * Math.min(1, (f + 1) / 2) * (1 - k * 0.4);
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => 2.4 * (1 - t) + 0.4, maxWidth: 3, bright: (t) => (0.8 - 0.4 * t) * (1 - k * 0.5), samples: 2 });
  }
  const V = 14 * (1 - k * 0.5);
  stroke(frame, [{ x: 0, y: -V }, { x: 0, y: V }], { width: (t) => 2.4 * Math.sin(Math.PI * t) + 0.4, maxWidth: 3, bright: 0.65 * (1 - k * 0.6) });
  if (f <= 2) sparkle(frame, 0, 0, 4 - f);
  if (f >= 1) ring(frame, { radius: 6 + f * 4, width: 1.6, erosion: f * 0.18, bright: 0.6, seed: 3501 });
  burst(frame, f, { n: 12, seed: 3502, speed: 4, cone: 1.6, life: 3 });
}

/** 光弾が壁で砕けた: 八方の長い光条（縦横が長い）と、二重の輪、周りへ散る光の粒。球の大きさぶん大きく */
function cannonImpact(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const main = i % 2 === 0;
    if (k > 0.6 && !main) continue;
    const L = (main ? 30 : 16) * Math.min(1, (f + 1) / 2) * (1 - k * 0.7);
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => (main ? 3.4 : 2.2) * (1 - t) + 0.4, maxWidth: 4, bright: (t) => (0.8 - 0.4 * t) * (1 - k * 0.5), samples: 2 });
  }
  if (f <= 3) sparkle(frame, 0, 0, Math.max(2, 4 - f));
  // 輪は光条の外を広がる（光条と交わると照準の十字に見える）
  if (f >= 1) ring(frame, { radius: 26 + f * 5, width: 2.4, erosion: Math.min(0.92, f * 0.13), bright: 0.7 - k * 0.2, seed: 3601 });
  if (f >= 3) ring(frame, { radius: 22 + (f - 3) * 7, width: 1.4, erosion: Math.min(0.92, (f - 2) * 0.16), bright: 0.5, seed: 3602 });
  burst(frame, f, { n: 26, seed: 3603, speed: 5, life: 4, drag: 0.82, r0: 8 });
}

/** 光弾が射程で尽きた: 球がほどけて縮み、縁が光の粒の輪になって外へ漂って消える */
function cannonFizzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  const R = ORB_R * (1 - k * 0.8);
  if (k < 0.8) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (r > R) return -1;
        if (!survives(x, y, k * 0.9, 1 - r / R, 3701)) return -1;
        return clamp01((0.42 + 0.3 * (r / R)) * (1 - k * 0.4));
      },
      { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
    );
  }
  if (f <= 1) sparkle(frame, 0, 0, 3 - f);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hash1(i, 3702) * 0.3;
    const r = ORB_R + f * (2 + hash1(i, 3703) * 2.5);
    if (hash1(i, 3704) < k * 0.7) continue;
    dot(frame, Math.cos(a) * r, Math.sin(a) * r - f * 0.8, Math.max(2, Math.round(6 - f * 0.7)));
  }
  ring(frame, { radius: ORB_R + f * 3, width: 1.4, erosion: Math.min(0.95, 0.3 + k * 0.7), bright: 0.5, seed: 3705 });
}

// -----------------------------------------------------------------------------
// 魔法陣（nova 半径 64・敵弾を消す + 気力を満たす）
// -----------------------------------------------------------------------------

/** 陣の外縁の半径（半径 64 論理 px × 2） */
const CIRCLE_R = 128;
const CIRCLE_N = 12;
const CIRCLE_A = 3;

/** 陣（地面）: 中心から外へ描き上がる二重の輪・ルーンの帯・六芒星と頂点の副紋。ゆっくり回り、外周から欠けて消える */
function magicCircleGround(frame, f) {
  const N = CIRCLE_N;
  const reveal = Math.min(1, easeSwing((f + 1) / CIRCLE_A));
  const k = f < 6 ? 0 : (f - 5) / (N - 6);
  const rot = f * 0.035;
  glyph(frame, {
    R: CIRCLE_R - 4,
    rot,
    width: 2.4,
    ticks: 24,
    tickLen: 4,
    runes: 18,
    runeIn: CIRCLE_R - 24,
    inner: CIRCLE_R - 24,
    star: 6,
    starStep: 2,
    starR: CIRCLE_R - 28,
    starSpin: -1,
    nodes: 6,
    nodeR: 7,
    core: 30,
    reveal,
    bright: 0.62 * (1 - k * 0.35),
    erosion: k * 0.95,
    seed: 4101,
    samples: 2,
  });
  // 中心の小さな紋（三角 2 枚 = 六芒の縮図）は逆向きに速く回る
  glyph(frame, { R: 16, rot: -f * 0.12, width: 1.8, star: 3, starStep: 1, ticks: 6, tickLen: 3, reveal: Math.min(1, (f + 1) / 2), bright: 0.66 * (1 - k * 0.3), erosion: k * 0.9, seed: 4102 });
}

/** 陣の光の波（空中）: 中心から外縁まで一気に押し出す輪 1 本（敵弾を払う）、頂点から立ちのぼる光の柱と粒 */
function magicCircleWave(frame, f) {
  const N = CIRCLE_N;
  const A = CIRCLE_A;
  const { p, k } = timing(f, A, N);
  // 波の輪: 走っている間は太く、外縁に着いた瞬間だけ外側の細い縁が白い。そのあと外へ少し滲んで欠ける
  const R = f < A ? 24 + (CIRCLE_R - 24) * p : CIRCLE_R + k * 10;
  const T = f < A ? 8 * (0.6 + 0.4 * p) : 6 * (1 - 0.6 * k);
  const erosion = f < A ? 0 : 0.05 + 0.85 * Math.pow(k, 1.1);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < R - T) return -1;
      const q = (R - r) / T;
      if (!survives(x, y, erosion, 1 - q, 4201)) return -1;
      if (R - r < 1.4 && f === A - 1) return 0.95;
      return clamp01((1 - q) ** 1.1 * (0.78 - 0.25 * k) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, samples: 2 },
  );
  // 波の後ろに残る細い輪（走っている間だけ。波と離れた位置に 1 本だけ）
  if (f >= 1 && f < A + 2) ring(frame, { radius: R * 0.62, width: 1.4, erosion: Math.min(0.9, 0.2 + f * 0.12), bright: 0.45, seed: 4202 });
  // 頂点の光の柱: 画面の上へ立つ細い光（六芒星の角 6 つ）。波が通ったあとに立ち、上へ抜けて消える
  if (f >= A - 1 && k < 0.95) {
    const age = f - (A - 1);
    for (let i = 0; i < 6; i++) {
      const a = f * 0.035 * -1 + (i / 6) * TAU - Math.PI / 2;
      const bx = Math.cos(a) * (CIRCLE_R - 28);
      const by = Math.sin(a) * (CIRCLE_R - 28);
      // 光の柱は根元が明るく、上へ細って消える（下へふくらむと雫に見えるので、太さは根元から上へ一様に細らせる）
      if (age > 5) continue;
      const h = Math.min(1, (age + 1) / 2) * 38;
      const lift = Math.max(0, age - 2) * 6;
      const y0 = by - lift;
      stroke(frame, [{ x: bx, y: y0 }, { x: bx, y: y0 - h }], { width: (t) => 2.6 * (1 - t * 0.7) + 0.4, maxWidth: 3.2, bright: (t) => (0.7 - 0.5 * t) * (1 - age * 0.12), samples: 2 });
      if (age === 0) sparkle(frame, bx, by, 3);
    }
  }
  if (f === A - 1) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      sparkle(frame, Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), 2);
    }
  }
  // 立ちのぼる光の粒（陣の中から上へ）
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 30, 4210, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = CIRCLE_R * Math.sqrt(rnd(2)) * 0.95;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (rnd(3) - 0.5) * 0.8, vy: -(2.5 + rnd(4) * 3), life: 4 + Math.floor(rnd(5) * 4), size: rnd(6) > 0.5 ? 2 : 1, drag: 0.92 };
    });
  }
}

/** 魔法陣の発動: 杖を突いた足元に小さな紋が弾けて開き、その輪から外へ細い刻みの筋が走る（陣が広がる前触れ） */
function magicCircleCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const p = easeSwing(Math.min(1, (f + 1) / 3));
  glyph(frame, { oy: FEET_Y, R: 10 + 16 * p + k * 6, sy: 0.45, rot: f * 0.3, width: 1.7, ticks: 8, tickLen: 5, star: 6, starStep: 2, bright: 0.72 - k * 0.3, erosion: Math.max(0, k - 0.3) * 1.3, seed: 4301 });
  if (f <= 2) {
    stroke(frame, [{ x: 0, y: FEET_Y }, { x: 0, y: FEET_Y - 30 - f * 10 }], { width: (t) => 3 * (1 - t) + 0.5, maxWidth: 3.5, bright: (t) => 0.75 - 0.4 * t });
    sparkle(frame, 0, FEET_Y, 4 - f);
  }
  burst(frame, f, { n: 14, seed: 4302, speed: 3.2, y: FEET_Y, life: 3, rise: -1.5 });
}

/** 気力を満たす（buff mana）: 周りから光の粒が渦を巻いて体へ吸い込まれ、足元から頭上へ輪が 2 枚のぼって満ちた閃きで締まる */
function manaSurge(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 吸い込まれる光の筋（外から内へ、時計回りに巻く）
  if (f < 6) {
    const p = (f + 1) / 6;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU + hash1(i, 4401) * 0.4;
      const t = clamp01(p + hash1(i, 4402) * 0.2);
      if (t > 0.95) continue;
      const r = 64 * (1 - t) + 8;
      const a = a0 + t * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.7;
      const x2 = Math.cos(a - 0.35) * (r + 10);
      const y2 = Math.sin(a - 0.35) * (r + 10) * 0.7;
      streakLine(frame, { ax: x2, ay: y2, bx: x, by: y, width: 1.3, bright: 0.4 + 0.4 * t });
    }
  }
  // のぼる輪（地面に置いた楕円が足元から頭上へ。のぼるほど小さく）
  // 輪は 1 枚（2 枚を近くに重ねると 8 の字に見える）。足元の輪は広がって薄れ、のぼる輪が頭上で締まる
  if (f <= 4) ring(frame, { oy: FEET_Y, radius: 10 + f * 3, width: 1.6, squash: 2.4, erosion: f * 0.2, bright: 0.6 - f * 0.08, seed: 4411 });
  if (f >= 1) {
    const age = f - 1;
    const t = Math.min(1, age / 5);
    const oy = FEET_Y + (HEAD_Y - FEET_Y) * easeSwing(t);
    ring(frame, { oy, radius: 10 - t * 4, width: 1.8, squash: 2.4, erosion: Math.max(0, age - 5) * 0.3, bright: 0.72 - t * 0.15, seed: 4410 });
  }
  if (f === 6) sparkle(frame, 0, HEAD_Y - 2, 4);
  if (f === 7) sparkle(frame, 0, HEAD_Y - 4, 2);
  if (f >= 6) burst(frame, f - 6, { n: 10, seed: 4420, speed: 2.6, y: HEAD_Y, life: 3, rise: -1 });
  if (k > 0 && f < 3) sparkle(frame, 0, 0, 2);
}

// -----------------------------------------------------------------------------
// 詠唱（持続）: 頭上の光輪と、体の周りを巡る 3 つの小さな紋（魔法が 1 本増える）
// dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/** 巡る紋の軌道（横長の楕円 = 体の周りを水平に回る輪を斜めから見た形） */
const ORBIT_RX = 34;
const ORBIT_RY = 12;
const ORBIT_Y = 2;
const INCANT_N = 12;

/** 小さな紋（巡る紋・発動の紋）: 輪と回る三角と刻み。横から見るので x を潰す */
function miniGlyph(frame, x, y, R, rot, bright, erosion, seed) {
  glyph(frame, { ox: x, oy: y, R, sx: 0.8, rot, width: 1.7, ticks: 4, tickLen: 3, star: 3, starStep: 1, bright, erosion, seed, samples: 2 });
}

/** 頭上の光輪（ルーンの刻みが回る潰れた輪）。rot は刻みの回り */
function halo(frame, R, rot, bright, erosion, seed) {
  glyph(frame, { oy: HEAD_Y, R, sy: 0.34, rot, width: 1.8, ticks: 10, tickLen: 4, inner: R * 0.72, bright, erosion, seed });
}

/** 詠唱の発動: 足元の輪が弾け、3 つの紋が体から渦を巻いて軌道へ出て、頭上に光輪が開く */
function incantationCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  ring(frame, { oy: FEET_Y, radius: 8 + f * 3, width: 2.4 - k, squash: 2.4, erosion: Math.min(0.92, k * 0.95), bright: 0.8 - k * 0.3, seed: 5101 });
  // 紋は時計回りに渦を巻いて外へ（半径が 0 → 軌道）
  for (let i = 0; i < 3; i++) {
    const t = Math.min(1, (f + 1) / 5);
    const a = (i / 3) * TAU + t * 2.4 - Math.PI / 2;
    const r = easeSwing(t);
    const x = Math.cos(a) * ORBIT_RX * r;
    const y = ORBIT_Y + Math.sin(a) * ORBIT_RY * r;
    const fade = Math.max(0, (f - 6) / 4);
    miniGlyph(frame, x, y, 3 + 3 * r, f * 0.5, 0.74 - fade * 0.3, fade * 0.9, 5110 + i);
    // 紋の通った跡（外側へ沿う短い弧の筋）
    if (f >= 1 && f < 6) {
      const a2 = a - 0.6;
      const r2 = easeSwing(Math.max(0, t - 0.15));
      const a3 = a - 0.28;
      streakLine(frame, { ax: Math.cos(a2) * ORBIT_RX * r2, ay: ORBIT_Y + Math.sin(a2) * ORBIT_RY * r2, bx: Math.cos(a3) * ORBIT_RX * r, by: ORBIT_Y + Math.sin(a3) * ORBIT_RY * r, width: 1.2, bright: 0.5 });
    }
  }
  // 光輪: 3 枚目から開き、はっきり広がってから持続の光輪の大きさへ戻る
  if (f >= 2) {
    const t = Math.min(1, (f - 1) / 3);
    const R = 14 + 6 * easeSwing(t) + (f >= 5 ? -2 * Math.min(1, (f - 4) / 3) : 0);
    halo(frame, R, f * 0.15, 0.74 - Math.max(0, f - 6) * 0.08, Math.max(0, (f - 7) * 0.3), 5120);
  }
  if (f === 3) sparkle(frame, 0, HEAD_Y, 4);
  if (f === 4) sparkle(frame, 0, HEAD_Y, 2);
  burst(frame, f, { n: 16, seed: 5130, speed: 3, life: 4, rise: -1.2, r0: 10 });
}

/** 詠唱の纏い: 3 つの紋が体の周りを巡り（後ろ側は暗く）、頭上の光輪の刻みが回り、光の粒が立ちのぼる。1 巡で継ぎ目なし */
function incantationSustain(frame, f) {
  const cycle = f / INCANT_N;
  // 光輪の刻みは 10 回対称なので、1 巡で 1 区画ぶん回せば継ぎ目が出ない
  halo(frame, 14, (cycle * TAU) / 10, 0.66, 0, 5201);
  for (let i = 0; i < 3; i++) {
    // 3 つが 1/3 ずつずれて巡るので、1 巡で 1/3 周すれば継ぎ目が出ない
    const a = (i / 3 + cycle / 3) * TAU - Math.PI / 2;
    const x = Math.cos(a) * ORBIT_RX;
    const y = ORBIT_Y + Math.sin(a) * ORBIT_RY;
    const front = Math.sin(a) > 0;
    // 三角は 3 回対称なので、1 巡で 1/3 回れば継ぎ目が出ない
    miniGlyph(frame, x, y, front ? 6 : 5, (cycle * TAU) / 3, front ? 0.72 : 0.42, 0, 5210 + i);
    // 紋の後ろへ沿う短い軌跡（軌道の外側に 1 本）
    const pts = [];
    for (let s = 0; s <= 4; s++) {
      const b = a - 0.3 - s * 0.08;
      pts.push({ x: Math.cos(b) * (ORBIT_RX + 1), y: ORBIT_Y + Math.sin(b) * (ORBIT_RY + 1) });
    }
    stroke(frame, pts.reverse(), { width: 1.1, bright: (t) => (front ? 0.5 : 0.28) * (0.3 + 0.7 * t), samples: 2 });
  }
  // 立ちのぼる粒
  for (let i = 0; i < 10; i++) {
    const t = (cycle + hash1(i, 5220)) % 1;
    const x = (hash1(i, 5221) - 0.5) * 64 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y - t * 56;
    if (Math.abs(x) < 9 && y > -22) continue;
    dot(frame, x, y, Math.min(5, Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)))));
  }
  if (f === 3) sparkle(frame, -ORBIT_RX + 4, ORBIT_Y - 14, 2);
  if (f === 9) sparkle(frame, ORBIT_RX - 4, ORBIT_Y - 16, 2);
}

/** 詠唱の足元の紋（地面）: 潰した輪に刻みと五芒星。5 回対称なので 1 巡で 1/5 回して継ぎ目なし */
function incantationGround(frame, f) {
  const cycle = f / INCANT_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  glyph(frame, { oy: FEET_Y, R: 22, sy: 0.42, rot: (cycle * TAU) / 5, width: 1.8, ticks: 10, tickLen: 4, star: 5, starStep: 2, bright: 0.38 + 0.12 * pulse, seed: 5301 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 魔導砲の acts[0] は volley（自分の位置・照準の向き）で、弾は shots[0] の絵が出す。魔法陣の acts[0] は周囲攻撃の半径、acts[1] は気力の buff
 */
const LIGHT_SHOT = { muzzle: "wandUlt.cannonMuzzle", impact: "wandUlt.cannonImpact", hit: "wandUlt.cannonHit", fizzle: "wandUlt.cannonFizzle", ramp: "light" };

const FX = {
  moveset: "wand",
  ultimates: {
    "wand.arcaneCannon": {
      ramp: "light",
      cast: { sheet: "wandUlt.arcaneCannonCast", life: 0.5 },
      acts: [{ sheet: "wandUlt.arcaneCannon", life: 0.45, pivot: "pos" }],
      shots: { 0: { fly: "wandUlt.cannonOrb", period: 0.2, base: ORB_R / 2, ...LIGHT_SHOT } },
    },
    "wand.magicCircle": {
      ramp: "light",
      cast: { sheet: "wandUlt.magicCircleCast", life: 0.35 },
      acts: [
        { sheet: "wandUlt.magicCircle", life: 0.7, base: CIRCLE_R / 2, pivot: "pos", ground: "wandUlt.magicCircleGround" },
        { sheet: "wandUlt.manaSurge", life: 0.6, pivot: "pos" },
      ],
    },
    "wand.incantation": {
      ramp: "light",
      cast: { sheet: "wandUlt.incantationCast", life: 0.6 },
      sustain: { sheet: "wandUlt.incantation", period: 1.0, ground: "wandUlt.incantationGround" },
    },
  },
};

export const ATLAS = {
  key: "wandUlt",
  fx: FX,
  sheets: [
    // 魔導砲
    { key: "wandUlt.arcaneCannonCast", dirs: DIRS, frames: CANNON_CAST_N, active: 0, size: 176, draw: cannonCast },
    { key: "wandUlt.arcaneCannon", dirs: DIRS, frames: CANNON_N, active: 0, size: 2 * (CANNON_BEAM + 12), draw: cannonFire },
    { key: "wandUlt.cannonOrb", dirs: SHOT_DIRS, frames: ORB_N, active: 0, size: 2 * (ORB_TAIL + 6), draw: cannonOrb },
    { key: "wandUlt.cannonMuzzle", dirs: DIRS, frames: 6, active: 0, size: 96, draw: cannonMuzzle },
    { key: "wandUlt.cannonHit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: cannonHit },
    { key: "wandUlt.cannonImpact", dirs: 1, frames: 8, active: 0, size: 160, draw: cannonImpact },
    { key: "wandUlt.cannonFizzle", dirs: 1, frames: 7, active: 0, size: 72, draw: cannonFizzle },
    // 魔法陣
    { key: "wandUlt.magicCircleCast", dirs: 1, frames: 8, active: 0, size: 112, draw: magicCircleCast },
    { key: "wandUlt.magicCircle", dirs: 1, frames: CIRCLE_N, active: CIRCLE_A, size: 2 * (CIRCLE_R + 40), draw: magicCircleWave },
    { key: "wandUlt.magicCircleGround", dirs: 1, frames: CIRCLE_N, active: CIRCLE_A, size: 2 * (CIRCLE_R + 6), draw: magicCircleGround },
    { key: "wandUlt.manaSurge", dirs: 1, frames: 10, active: 0, size: 160, draw: manaSurge },
    // 詠唱
    { key: "wandUlt.incantationCast", dirs: 1, frames: 10, active: 0, size: 176, draw: incantationCast },
    { key: "wandUlt.incantation", dirs: 1, frames: INCANT_N, active: 0, size: 128, draw: incantationSustain },
    { key: "wandUlt.incantationGround", dirs: 1, frames: INCANT_N, active: 0, size: 72, draw: incantationGround },
  ],
};
