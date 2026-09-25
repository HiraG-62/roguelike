// 杖（moveset "wand"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（scratchpad の motions/wand.md・bullets/wand.md）× 2 が目安
//
// 杖は刃を使わない。振り（l:0〜l:3）は杖の先に開く「詠唱の紋」（撃つ向きに直交する円盤を横から見た楕円）で、
// 魔法そのものは弾の絵が出す。魔法は属性の色で塗られるので、形（シルエット・動き・崩れ方）で描き分ける:
//   炎 = 揺らめく舌と火の粉、氷 = 角ばった結晶の面と冷気の筋、雷 = ギザギザの折れ線と枝、
//   毒 = 丸い泡の塊、光 = 極細の針と十字の閃き、闇 = うねる指と千切れる煙
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾の方向の数（24 方向だと細い曳光の角が目立つ） */
const SHOT_DIRS = 32;

// -----------------------------------------------------------------------------
// 共通の部品（杖だけで使う）
// -----------------------------------------------------------------------------

/** 振りの進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 繰り返しの位相（0..2π）。飛んでいる弾の絵は period で 1 巡するので、動きは位相の sin / cos で書いて継ぎ目を消す */
function phase(f, N) {
  return (f / N) * TAU;
}

/** 位相で 1 周するノイズ（ノイズの空間を円く回って、最後のフレームが最初のフレームへつながる） */
function loopNoise(x, y, cell, seed, ph, orbit = 5) {
  return valueNoise(x + Math.cos(ph) * orbit, y + Math.sin(ph) * orbit, cell, seed);
}

/** 点列の外接矩形（paint の bounds） */
function boundsOf(pts, pad) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

/**
 * 折れ線を太さつきで塗る。width(t) と bright(t) は線の始点からの割合 t（0..1）で決める。
 * core を渡すと中心線の細い芯（刃の縁の代わり。雷・針の白い芯）を足す
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
      const q = best / w;
      if (core > 0 && best < core / 2) return clamp01(brightAt(bt) + 0.3);
      return clamp01(brightAt(bt) * (1 - 0.55 * q));
    },
    { bounds: boundsOf(pts, maxW + 2), samples: o.samples ?? 3, dither: o.dither ?? 0.04 },
  );
}

/** a → b のギザギザの稲妻の点列（端は固定。途中の点を法線方向へ amp だけ揺らす） */
function jag(ax, ay, bx, by, n, amp, seed, random = false) {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const pts = [{ x: ax, y: ay }];
  for (let i = 1; i < n; i++) {
    // random = 折れ目の間隔と振れを不揃いにする（長い稲妻がばねの形に見えないように）
    const t = random ? (i + (hash1(i, seed + 7) - 0.5) * 0.7) / n : i / n;
    // 交互に振って、折れ線がはっきり「く」の字に折れるようにする
    const side = random ? (hash1(i, seed + 9) > 0.35 ? -1 : 1) * (i % 2 === 0 ? 1 : -1) : i % 2 === 0 ? 1 : -1;
    const off = (0.35 + 0.65 * hash1(i, seed)) * amp * side;
    pts.push({ x: ax + (bx - ax) * t + nx * off, y: ay + (by - ay) * t + ny * off });
  }
  pts.push({ x: bx, y: by });
  return pts;
}

/** 丸い塊（火の玉・泡・煙の玉）。ノイズで縁を揺らし、erosion で虫食いに消える。hi は光る側の向き（ラジアン） */
function blob(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.7;
  const seed = o.seed ?? 1;
  const erosion = o.erosion ?? 0;
  const rough = o.rough ?? 0.25;
  const hollow = o.hollow ?? 0;
  const hi = o.hi;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const edge = r * (1 - rough + rough * 2 * valueNoise(px, py, Math.max(2, r * 0.45), seed));
      if (d > edge) return -1;
      const q = d / Math.max(0.5, edge);
      if (erosion > 0 && valueNoise(px, py, 3, seed + 3) * 0.75 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      let v = hollow > 0 ? (q < hollow ? 0.35 + 0.3 * q : 1 - (q - hollow) / (1 - hollow) * 0.5) : Math.pow(1 - q, 0.6);
      if (hi !== undefined) v *= 0.7 + 0.3 * ((dx * Math.cos(hi) + dy * Math.sin(hi)) / Math.max(1, d));
      return clamp01(v * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/**
 * 詠唱の紋: 撃つ向き（+x）に直交する円盤を横から見た楕円。輪・外へ出る刻み（ルーン）・内側の星形。
 * squash で x を潰す（1 = 正面から見た真円）。rot で紋が回り、erosion で欠ける
 */
function sigil(frame, o) {
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const { R } = o;
  const squash = o.squash ?? 0.4;
  const rot = o.rot ?? 0;
  const ticks = o.ticks ?? 0;
  const star = o.star ?? 0;
  const starStep = o.starStep ?? 2;
  const width = o.width ?? 2;
  const bright = o.bright ?? 0.8;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const inner = o.inner ?? 0;
  const tickLen = o.tickLen ?? 3.5;
  const fill = o.fill ?? 0;
  // 星形の辺（楕円の空間で結ぶ）
  const starPts = [];
  for (let i = 0; i < star; i++) {
    const a = rot + (i / star) * TAU - Math.PI / 2;
    starPts.push({ x: Math.cos(a) * R * 0.92, y: Math.sin(a) * R * 0.92 });
  }
  const pad = R + tickLen + width + 2;
  paint(
    frame,
    (px, py) => {
      const x = (px - ox) / squash;
      const y = py - oy;
      const r = Math.hypot(x, y);
      // 楕円の空間で潰した分、x の太さを戻す（輪が細切れに見えないように）
      const wscale = 1 / Math.max(squash, 0.25);
      let v = -1;
      const dRing = Math.abs(r - R);
      if (dRing < (width / 2) * (1 + (wscale - 1) * Math.abs(x / Math.max(1, r)) * 0.6)) v = Math.max(v, bright * (1 - 0.4 * (dRing / width)));
      if (inner > 0 && Math.abs(r - inner) < width * 0.4 + 0.5) v = Math.max(v, bright * 0.6);
      // 紋の面: 輪の内側にうっすら光る面（段 2〜3）。縁へ向けて少し明るく、紋が「板」として読める
      if (fill > 0 && r < R - width / 2 && r > R * 0.6) v = Math.max(v, fill * ((r / R - 0.6) / 0.4));
      if (ticks > 0 && r > R && r < R + tickLen) {
        const a = Math.atan2(y, x) - rot;
        const cell = TAU / ticks;
        const m = ((a % cell) + cell) % cell;
        // 刻みは輪から外へ出る短い棒。1 つおきに長さを変えて、文字のような不揃いを作る
        const tickW = (0.9 * width) / Math.max(4, R);
        const idx = Math.floor((((a % TAU) + TAU) % TAU) / cell);
        const long = hash1(idx, seed) > 0.4;
        if ((m < tickW || m > cell - tickW) && (long || r < R + tickLen * 0.55)) v = Math.max(v, bright * 0.85);
      }
      for (let i = 0; i < star; i++) {
        const a = starPts[i];
        const b = starPts[(i + starStep) % star];
        if (!a || !b) continue;
        const s = segment(x, y, a.x, a.y, b.x, b.y);
        if (s.d < width * 0.45 + 0.3) v = Math.max(v, bright * 0.62);
      }
      if (v < 0) return -1;
      if (erosion > 0 && valueNoise(px, py, 3.5, seed) * 0.8 + 0.25 - erosion * 1.1 < 0) return -1;
      if (v < 0.1) return -1;
      return clamp01(v * (1 - erosion * 0.35));
    },
    { bounds: { x0: ox - pad * squash - 2, y0: oy - pad, x1: ox + pad * squash + 2, y1: oy + pad }, samples: 3 },
  );
}

/** 位相で回る粒（飛んでいる弾の周りの火の粉・冷気の粒）。i 番目の粒は後ろへ流れて循環する */
function trailMotes(frame, o) {
  const { n, len, spread, ph, seed } = o;
  const x0 = o.x0 ?? 0;
  for (let i = 0; i < n; i++) {
    const u = (hash1(i, seed) + ph / TAU) % 1;
    const x = x0 - u * len;
    const y = (hash1(i, seed + 1) - 0.5) * 2 * spread * (0.4 + u) + Math.sin(ph * 2 + i) * (o.wave ?? 0);
    const level = Math.max(2, Math.round((o.hi ?? 6) - u * 4));
    dot(frame, x, y, level);
    if ((o.big ?? 0) > 0 && u < o.big) dot(frame, x + 1, y, Math.max(2, level - 1));
  }
}

/** 放射状に散る粒（着弾・炸裂の火の粉）。cone は +x を中心にした散る角の幅（TAU で全周） */
function burst(frame, age, o) {
  const { n, seed, speed } = o;
  const cone = o.cone ?? TAU;
  const center = o.center ?? 0;
  shards(frame, age, n, seed, (i, rnd) => {
    const a = center + (rnd(1) - 0.5) * cone;
    const sp = speed * (0.5 + rnd(2));
    return {
      x: (o.x ?? 0) + (rnd(6) - 0.5) * (o.jitter ?? 2),
      y: (o.y ?? 0) + (rnd(7) - 0.5) * (o.jitter ?? 2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + (o.fall ?? 0) * rnd(8),
      life: (o.life ?? 3) + Math.floor(rnd(3) * 3),
      size: rnd(4) > 0.5 ? 2 : 1,
      drag: o.drag ?? 0.8,
      bright: o.bright ?? 1,
    };
  });
}

// -----------------------------------------------------------------------------
// 近接: 詠唱の振り（l:0〜l:3）
// -----------------------------------------------------------------------------

/**
 * 杖の先の詠唱の紋（当たり判定 box reach 14 size 16 の中心 = 原点）。段ごとに紋の作りを変える:
 * l:0 = 刻みの輪、l:1 = 輪 + 三角、l:2 = 二重の輪 + 五芒星、l:3 = 大きな六芒の紋に魔力が集まって弾ける（大技の溜め）
 */
const CAST = {
  l0: { R: 14, frames: 7, active: 3, ticks: 6, star: 0, inner: 0, spin: 0.35, motes: 5, seed: 1101 },
  l1: { R: 17, frames: 7, active: 3, ticks: 8, star: 3, starStep: 1, inner: 0, spin: -0.4, motes: 6, seed: 1202 },
  l2: { R: 20, frames: 8, active: 3, ticks: 10, star: 5, starStep: 2, inner: 13, spin: 0.45, motes: 8, seed: 1303 },
  l3: { R: 27, frames: 10, active: 5, ticks: 12, star: 6, starStep: 2, inner: 18, spin: 0.3, motes: 14, seed: 1404, charge: true },
};

function castSigil(frame, f, spec) {
  const { R, frames: N, active: A, seed } = spec;
  const { p, k } = timing(f, A, N);
  const rot = f * spec.spin;
  // 紋は開いてから少し広がり、外周から欠けて消える
  const radius = R * (0.45 + 0.55 * p) * (1 + 0.22 * k);
  // 輪は段 6 まで（白は中心の閃きだけ）
  const bright = f < A ? 0.55 + 0.2 * p : 0.75 - 0.4 * k;
  if (k < 0.95) {
    sigil(frame, {
      R: radius,
      rot,
      squash: 0.48,
      ticks: spec.ticks,
      tickLen: 5,
      fill: f < A ? 0.3 : 0,
      star: spec.star,
      starStep: spec.starStep,
      inner: spec.inner ? spec.inner * (0.45 + 0.55 * p) * (1 + 0.2 * k) : 0,
      width: spec.charge ? 2.6 : 2,
      bright,
      erosion: k * 0.85,
      seed,
    });
  }
  // 大技の溜め: 周りの魔力の粒が渦を描いて紋へ吸い込まれる
  if (spec.charge && f < A) {
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU + hash1(i, seed + 5) * 0.5;
      const t = clamp01(p + hash1(i, seed + 6) * 0.2);
      const r = (R * 2.4) * (1 - t) + R * 0.4;
      const a = a0 + t * 1.6;
      const x = Math.cos(a) * r * 0.55;
      const y = Math.sin(a) * r;
      const x2 = Math.cos(a - 0.35) * (r + 7) * 0.55;
      const y2 = Math.sin(a - 0.35) * (r + 7);
      if (t < 0.97) streakLine(frame, { ax: x2, ay: y2, bx: x, by: y, width: 1.2, bright: 0.45 + 0.4 * t });
    }
  }
  // 撃った瞬間: 紋の中心の閃きと、前へ抜ける短い魔力の筋（弾は弾の絵が出すので、ここは放出の勢いだけ）
  if (f === A - 1 || f === A) {
    sparkle(frame, 0, 0, f === A - 1 ? (spec.charge ? 4 : 3) : 2);
    const n = spec.charge ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * (spec.charge ? 5 : 4);
      const x0 = 4 + Math.abs(y) * 0.6 + (f - A + 1) * 6;
      streakLine(frame, { ax: x0, ay: y, bx: x0 + 10 + (spec.charge ? 10 : 4) - Math.abs(y) * 0.4, by: y, width: 1.2, bright: 0.7 });
    }
  }
  if (spec.charge && f >= A - 1) {
    const age = f - (A - 1);
    // 溜めを放った衝撃: 紋と同じ向きに潰れた輪が前へ押し出される
    ring(frame, { ox: 4 + age * 4, radius: R * 0.8 + age * 5, width: 2.4, squash: 0.42, erosion: Math.min(0.9, age * 0.18), bright: 0.85 - age * 0.08, seed: seed + 7 });
  }
  if (f >= A - 1) {
    burst(frame, f - (A - 1), { n: spec.motes, seed: seed + 8, speed: spec.charge ? 4 : 2.8, cone: 2.2, jitter: R * 0.8, life: 3 });
  }
}

// -----------------------------------------------------------------------------
// 近接: ダッシュ（circle size 40）・渦巻き（circle size 96・2 回当たる）
// -----------------------------------------------------------------------------

/** ダッシュ: 自分を包む魔力の輪（刻み入り）。進む向き（+x）側が明るく、後ろへ粒と筋を置いていく */
function dashRing(frame, f) {
  const N = 8;
  const A = 4;
  const { p, k } = timing(f, A, N);
  const R = 30 + 10 * p + 4 * k;
  sigil(frame, { R, rot: f * 0.25, squash: 1, ticks: 16, width: 1.6, bright: 0.62 - 0.3 * k, erosion: k * 0.85, seed: 1501, tickLen: 4 });
  // 前側（+x）が厚い魔力の帯: 進む向きへ押し出す輪の前縁。白は前縁の 1 ドットだけ
  if (k < 0.8) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const front = Math.max(0, x / Math.max(1, r));
        const w = 1 + 6 * front * front * (1 - k);
        if (r > R + 1 || r < R + 1 - w || front <= 0.05) return -1;
        const q = (R + 1 - r) / w;
        if (k > 0 && valueNoise(x, y, 4, 1506) * 0.7 + 0.3 - k * 1.2 < 0) return -1;
        return clamp01((q < 0.2 && front > 0.8 ? 0.85 : 0.68 * (1 - q * 0.6)) * (0.6 + 0.4 * front) * (1 - k * 0.4));
      },
      { bounds: { x0: 0, y0: -R - 2, x1: R + 2, y1: R + 2 } },
    );
  }
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 11 + (hash1(i, 1502) - 0.5) * 4;
      const edge = -Math.sqrt(Math.max(0, R * R - y * y));
      const len = 14 + 16 * hash1(i, 1503);
      streakLine(frame, { ax: edge - len - k * 12, ay: y, bx: edge - 2 - k * 10, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= 1) {
    shards(frame, f - 1, 12, 1504, (i, rnd) => {
      const a = rnd(1) * TAU;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: -2.5 - rnd(2) * 2, vy: Math.sin(a) * 0.8, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/** 渦巻き: 3 本の腕の渦が時計回りに巻き込む。2 回の当たりで芯が明滅し、終わりは腕がほどけて粒が吸い込まれる */
function vortex(frame, f) {
  const N = 11;
  const A = 6;
  const { k } = timing(f, A, N);
  const R = 96;
  const rot = f * 0.55;
  const arms = 3;
  const twist = 2.6;
  const flash = f === 1 || f === 4 ? 1.12 : 1;
  const erosion = k * 0.9;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < 3) return -1;
      const u = r / R;
      const a = Math.atan2(y, x);
      // 腕の中心線の角: 外ほど遅れる（時計回りに巻き込む螺旋）
      const cell = TAU / arms;
      const rel = wrapAngle(a - rot + twist * (1 - u) * 1.3 - twist);
      const m = ((rel % cell) + cell) % cell;
      const d = Math.min(m, cell - m);
      const halfW = (0.42 - 0.25 * u) * (1 - k * 0.4);
      if (d > halfW) return -1;
      const q = d / halfW;
      if (erosion > 0 && valueNoise(x, y, 6, 1601) * 0.7 + (1 - u) * 0.3 + (1 - q) * 0.15 - erosion * 1.15 < 0) return -1;
      // 腕の前縁（回る向きの側）を明るく。内ほど明るく、外端は暗く千切れる
      const lead = m < cell / 2 ? 1 : 0.7;
      return clamp01((1 - q) ** 0.8 * (0.84 - 0.55 * u) * lead * flash * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, samples: 2 },
  );
  // 外周の速度線（当たり判定の縁）
  if (k < 0.6) {
    for (let i = 0; i < 4; i++) {
      const a = rot + i * (TAU / 4) + 0.3;
      arcLine(frame, { radius: R - 4 + (i % 2) * 3, from: a - 0.9, to: a, bright: 0.5 * (1 - k) });
    }
  }
  if (k < 0.7) blob(frame, 0, 0, 10 * (1 - k * 0.6), { bright: 0.75 * flash, seed: 1602, rough: 0.2 });
  if (f === 1 || f === 4) sparkle(frame, 0, 0, 4);
  // 巻き込まれる粒: 外から中心へ螺旋で吸い込まれる
  for (let i = 0; i < 16; i++) {
    const t = clamp01((f + hash1(i, 1603) * 4) / (N + 2));
    const r = R * (1 - t) * (0.7 + 0.3 * hash1(i, 1604));
    if (r < 6) continue;
    const a = hash1(i, 1605) * TAU + t * 3.4 + rot * 0.5;
    const level = Math.max(3, Math.round(3 + 4 * t));
    dot(frame, Math.cos(a) * r, Math.sin(a) * r, level);
    dot(frame, Math.cos(a - 0.05) * (r + 1.5), Math.sin(a - 0.05) * (r + 1.5), Math.max(2, level - 2));
  }
}

// -----------------------------------------------------------------------------
// 近接の命中（杖の先で殴ったとき。魔力が弾ける）
// -----------------------------------------------------------------------------

/** 命中: 魔力の四芒星（+x に長い）と小さな輪、魔力の粒。heavy は八芒で輪と刻みの紋が付く */
function staffHit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const rays = heavy ? 8 : 4;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TAU;
    const main = i % (rays / 2) === 0;
    const L = (main ? (heavy ? 30 : 20) : heavy ? 16 : 11) * grow * (1 - k * 0.5);
    const T = (main ? (heavy ? 7 : 5) : 3.5) * (1 - k * 0.6);
    if (L < 3) continue;
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => T * (1 - t), maxWidth: T, bright: (t) => (0.9 - 0.5 * t) * (1 - k * 0.5) });
  }
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 6 + age * (heavy ? 5 : 3.5), width: 2, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.08, seed: heavy ? 1701 : 1711 });
    if (heavy && age <= 3) sigil(frame, { R: 12 + age * 4, rot: age * 0.4, squash: 1, ticks: 8, width: 1.4, bright: 0.6 - age * 0.1, erosion: age * 0.22, seed: 1702, tickLen: 3 });
    burst(frame, age, { n: heavy ? 12 : 7, seed: heavy ? 1703 : 1713, speed: heavy ? 4.5 : 3.2, cone: TAU, life: 3 });
  }
}

// -----------------------------------------------------------------------------
// 弾: 炎（fireDart・fireDart2・fireDartTwin・blastOrb）
// -----------------------------------------------------------------------------

/**
 * 揺らめく炎の矢。原点 = 弾の中心、+x = 進む向き。頭は前へ尖り、胴の後ろで炎の舌が −x へ細く伸びて揺れる。
 * forks = 尾の舌の本数（1 = 1 本、2 = 二股に分かれて編むように揺れる）
 */
function flameDart(frame, f, o) {
  const N = o.frames;
  const ph = phase(f, N);
  const { head, R, tail, seed } = o;
  const forks = o.forks ?? 1;
  const wave = o.wave ?? 3.5;
  paint(
    frame,
    (x, y) => {
      if (x > head || x < -tail) return -1;
      let best = -1;
      for (let fk = 0; fk < forks; fk++) {
        const side = forks === 1 ? 0 : fk === 0 ? -1 : 1;
        // 尾の中心線: 後ろほど大きく揺れる。二股は逆位相で編む
        const u = x < 0 ? -x / tail : 0;
        // 二股は 2 本の舌が交差しながら編むように後ろへ流れる（位相で編み目が後ろへ進む）
        const sway =
          forks === 1
            ? Math.sin(ph + u * 5) * wave * u
            : side * (o.forkGap ?? 3) * Math.sin(u * 7 - ph) * Math.min(1, u * 4) + Math.sin(ph + u * 4) * wave * u * 0.5;
        let w;
        if (x >= 0) w = R * Math.pow(1 - x / head, o.tipPow ?? 0.55);
        else w = forks === 1 ? R * Math.pow(1 - u, 1.15) : R * (1 - Math.min(1, u * 4) * 0.45) * Math.pow(1 - u, 1.0);
        // 縁を揺らす: 位相で回るノイズで炎の舌が伸び縮みする
        const n = loopNoise(x * 1.2, y * 1.2, 3.2, seed + fk, ph, 4);
        // 頭はほぼ形を保ち、尾ほど大きく千切れる（炎の舌）
        w *= x >= 0 ? 0.9 + 0.2 * n : 0.55 + 0.9 * n * (0.6 + 0.4 * u) + 0.25 * (1 - u);
        const d = Math.abs(y - (x < 0 ? sway : 0));
        if (d > w || w < 0.5) continue;
        const q = d / w;
        // 頭の芯が最も明るく、尾へ暗くなる。尾の先は煤の段まで落とす
        const body = x >= 0 ? 0.86 - 0.12 * (x / head) : 0.86 - 0.7 * Math.pow(u, 0.7);
        // 縁は暗部（段 2〜3）で輪郭を締め、芯だけ明るい
        const v = Math.pow(1 - q, 1.25) * body + 0.08;
        if (v > best) best = v;
      }
      return best;
    },
    { bounds: { x0: -tail - 2, y0: -R - wave - 6, x1: head + 2, y1: R + wave + 6 } },
  );
  // 頭の先の光点（白は光点だけ）
  dot(frame, head - 3, 0, 7);
  trailMotes(frame, { n: o.motes ?? 5, len: tail * 1.2, spread: R * 0.9, ph, seed: seed + 9, x0: -tail * 0.2, hi: 6, wave: 1 });
}

/** 炎の矢（2 本同時の方）: 矢じり形の頭（後ろへ返しの出た V 字）と、太い一本の炎の尾 */
function flameArrow(frame, f) {
  const N = 6;
  const ph = phase(f, N);
  flameDart(frame, f, { frames: N, head: 11, R: 5.5, tail: 34, seed: 1811, wave: 2, motes: 7, tipPow: 0.8 });
  // 返し: 頭の後ろから斜め後ろへ出る 2 本の炎の棘（揺らめいて長さが変わる）
  for (const side of [-1, 1]) {
    const L = 7 + 1.5 * Math.sin(ph + (side > 0 ? 0 : Math.PI));
    stroke(frame, [{ x: 3, y: side * 3 }, { x: 3 - L * 0.8, y: side * (3 + L * 0.7) }], { width: (t) => 3.2 * (1 - t), maxWidth: 3.2, bright: (t) => 0.8 - 0.4 * t });
  }
}

/** 曲射の火球（dirs 1）: 回る炎の球。外周の炎の舌が時計回りに回り、周りに火の粉 */
function fireOrb(frame, f) {
  const N = 8;
  const ph = phase(f, N);
  const R = 8;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      // 4 本の炎の舌が回る（角の位相で外周が膨らむ）
      // 5 本の炎の舌が外へ行くほど遅れて巻く（渦を巻く火の球）。位相で 1/5 周ずつ回って継ぎ目なく繰り返す
      const tongues = Math.max(0, Math.sin(a * 5 - ph * 1 + r * 0.45)) ** 3;
      const edge = R * (0.82 + 0.3 * loopNoise(x, y, 2.6, 1821, ph, 3)) + tongues * 5;
      if (r > edge) return -1;
      const q = r / edge;
      return clamp01(Math.pow(1 - q, 0.9) * 0.88 + 0.06);
    },
    { bounds: { x0: -16, y0: -16, x1: 16, y1: 16 } },
  );
  sparkle(frame, -2, -2, 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + ph * 0.5;
    const r = 14 + 2 * Math.sin(ph * 2 + i);
    dot(frame, Math.cos(a) * r, Math.sin(a) * r, i % 2 === 0 ? 5 : 3);
  }
}

/** 火球の炸裂（blastBase 34 = 半径 68 ドット）: 中心から立つ火柱（画面の上へ）と、外へ広がる炎の輪。終わりは輪の内に残り火が燻って崩れる */
function fireBlast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const R = 68 * (0.3 + 0.7 * easeSwing(Math.min(1, (f + 1) / 4)));
  // 火の輪: 外縁は炎の舌の鋸歯（角のノイズで大きく揺らす）。帯の中ほどが明るく、外縁は暗部で締める
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const crest = R + 9 * valueNoise(Math.cos(a) * 26, Math.sin(a) * 26 - f * 3, 2.5, 1831) - 3;
      const w = 9 + 9 * (1 - k);
      if (r > crest || r < crest - w) return -1;
      const q = (crest - r) / w;
      if (valueNoise(x, y, 5, 1832) * 0.7 + (1 - Math.abs(q - 0.35)) * 0.3 - Math.max(0, k - 0.3) * 1.4 < 0) return -1;
      const band = q < 0.12 ? 0.3 : 1 - Math.abs(q - 0.3) * 1.2;
      return clamp01(band * (0.82 - 0.45 * k));
    },
    { bounds: { x0: -84, y0: -84, x1: 84, y1: 84 } },
  );
  // 火柱: 中心から画面の上へ立ち上がる太い炎。舌に割れながら先から痩せて消える
  if (f < 8) {
    const h = 64 * easeSwing(Math.min(1, (f + 1) / 3)) + f * 3;
    const base = 30 * (1 - f / 11);
    paint(
      frame,
      (x, y) => {
        if (y > 10 || y < -h) return -1;
        const u = clamp01((10 - y) / (h + 10));
        const sway = Math.sin(u * 5 + f * 0.8) * 3 * u;
        const w = base * Math.pow(1 - u, 0.8) * (0.72 + 0.56 * valueNoise(x * 1.3, y - f * 10, 5, 1833)) * (u < 0.12 ? Math.sqrt(u / 0.12) * 0.6 + 0.4 : 1);
        const d = Math.abs(x - sway);
        if (d > w) return -1;
        const q = d / w;
        if (f >= 4 && valueNoise(x, y + f * 6, 4, 1834) * 0.7 + (1 - u) * 0.25 - (f - 3) * 0.2 < 0) return -1;
        return clamp01(Math.pow(1 - q, 1.1) * (0.9 - 0.5 * u) * (1 - f * 0.05) + 0.08);
      },
      { bounds: { x0: -30, y0: -h - 4, x1: 30, y1: 12 } },
    );
  }
  if (f <= 1) blob(frame, 0, 0, 22 + f * 12, { bright: 0.85 - f * 0.1, seed: 1835, rough: 0.35 });
  if (f <= 2) sparkle(frame, 0, -6, f === 0 ? 4 : 3);
  // 残り火: 輪の内側に燻る小さな炎の塊（地形の火に引き継ぐ）
  if (f >= 3) {
    for (let i = 0; i < 9; i++) {
      const a = hash1(i, 1841) * TAU;
      const d = R * (0.25 + 0.6 * hash1(i, 1842));
      const r = (3 + 3 * hash1(i, 1843)) * (1 - Math.max(0, k - 0.5));
      blob(frame, Math.cos(a) * d, Math.sin(a) * d * 0.9, r, { bright: 0.6 - 0.3 * k, seed: 1844 + i, erosion: Math.max(0, k - 0.4) * 1.3, rough: 0.35 });
    }
  }
  burst(frame, f, { n: 24, seed: 1836, speed: 10, life: 4, drag: 0.8, jitter: 16 });
  // 立ち上る火の粉（画面の上へ）
  for (let i = 0; i < 12; i++) {
    const t = (f + 1) / N;
    const x = (hash1(i, 1837) - 0.5) * 70;
    const y = -8 - t * (46 + 30 * hash1(i, 1838)) - hash1(i, 1839) * 16;
    if (hash1(i, 1840) < k - 0.1) continue;
    dot(frame, x + Math.sin(f + i) * 2, y, Math.max(3, Math.round(7 - 4 * t)));
  }
}

// -----------------------------------------------------------------------------
// 弾: 氷（iceLance・iceLance2・iceLanceLong・blizzard）
// -----------------------------------------------------------------------------

/**
 * 結晶の刃（菱形）。tip の先端から back まで、mid で最も太い（半幅 h）。上の面が明るく下の面が暗い（面の切り替わり = 稜線）。
 * 上の縁だけ白い細い線（刃の縁）
 */
function crystal(frame, o) {
  const { tip, mid, back, h } = o;
  const oy = o.oy ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 3;
  const tilt = o.tilt ?? 0;
  paint(
    frame,
    (px, py) => {
      const x = px;
      const y = py - oy - tilt * (px - mid);
      if (x > tip || x < back) return -1;
      const half = x >= mid ? (h * (tip - x)) / (tip - mid) : (h * (x - back)) / (mid - back);
      if (Math.abs(y) > half || half < 0.4) return -1;
      if (erosion > 0 && valueNoise(px, py, 3, seed) * 0.8 + 0.2 - erosion * 1.1 < 0) return -1;
      const q = Math.abs(y) / half;
      // 上の面（y < 0）は明るく、下の面は暗い。縁の 1 ドットは上が白、下が暗部
      if (q > 1 - 1.1 / half) return y < 0 ? clamp01(0.85 * bright) : 0.2 * bright;
      const face = y < 0 ? 0.62 + 0.12 * (1 - q) : 0.36 + 0.08 * (1 - q);
      return clamp01(face * bright * (1 - erosion * 0.3));
    },
    { bounds: { x0: back - 2, y0: oy - h - Math.abs(tilt) * (tip - back) - 2, x1: tip + 2, y1: oy + h + Math.abs(tilt) * (tip - back) + 2 } },
  );
}

/** 冷気の筋: 弾の後ろへ流れる細い筋（途切れ途切れ）。位相で途切れの位置が後ろへ流れる */
function frostStreaks(frame, ph, o) {
  const { n, len, spread, seed } = o;
  for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * spread;
    const shift = ((hash1(i, seed) + ph / TAU) % 1) * 10;
    const start = (o.x0 ?? 0) - Math.abs(y) * 0.6;
    for (let s = 0; s < 3; s++) {
      const x1 = start - shift - s * 11;
      const x0 = x1 - 5 - 3 * hash1(i * 3 + s, seed + 1);
      if (x0 < -len) continue;
      streakLine(frame, { ax: x0, ay: y, bx: x1, by: y, bright: (o.bright ?? 0.55) * (1 - (-x1 / len) * 0.7) });
    }
  }
}

/** 氷の槍（iceLance）: 長い菱形の結晶の穂先と、後ろの細い柄、両脇に冷気の筋 */
function iceLance(frame, f, o) {
  const N = o.frames;
  const ph = phase(f, N);
  const s = o.scale ?? 1;
  // 柄: 穂先の後ろに細い氷の柱
  stroke(frame, [{ x: -8 * s, y: 0 }, { x: -o.tail, y: 0 }], { width: (t) => 3 * s * (1 - t * 0.8), maxWidth: 3 * s, bright: (t) => 0.55 - 0.35 * t });
  // 穂先は前へ長く尖る（前 18・後ろ 10）。槍らしく重心が前にある形
  crystal(frame, { tip: 18 * s, mid: 2 * s, back: -10 * s, h: 5 * s, seed: o.seed });
  if (o.barbs) {
    // 2 段目: 穂先の根元から後ろへ返しの結晶が 2 本（三叉の霜の棘）
    for (const side of [-1, 1]) crystal(frame, { tip: 1 * s, mid: -5 * s, back: -12 * s, h: 2.4 * s, oy: side * 4 * s, tilt: side * 0.3, seed: o.seed + 1, bright: 0.9 });
  }
  if (o.segments) {
    // 長槍: 柄に沿って小さな結晶が連なる（背骨の節）
    for (let i = 0; i < o.segments; i++) {
      const x = -18 * s - i * 11;
      const h = 4.4 * (1 - i / (o.segments + 2));
      crystal(frame, { tip: x + 6, mid: x, back: x - 4, h, seed: o.seed + 2 + i, bright: 0.85 - i * 0.1 });
    }
  }
  frostStreaks(frame, ph, { n: o.streaks ?? 2, len: o.tail + 6, spread: 9 * s, seed: o.seed + 3, x0: -6 * s });
  // 刃の縁を走る光（位相で先端へ流れる）
  const gx = 2 * s + ((f % N) / N) * 14 * s;
  dot(frame, gx, -((5 * s * (18 * s - gx)) / (16 * s)) + 1, 7);
  if (f % 3 === 0) sparkle(frame, 16 * s, 0, 2);
}

/** 氷の礫（blizzard）: 回る小さな六花の結晶と、短い霜の尾 */
function iceShard(frame, f) {
  const N = 6;
  const ph = phase(f, N);
  // 6 回対称なので 60° 回れば元に戻る
  const rot = (f / N) * (Math.PI / 3);
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    const L = i % 2 === 0 ? 6.5 : 5;
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => 2.4 * (1 - t * 0.6), maxWidth: 2.4, bright: (t) => 0.8 - 0.3 * t });
  }
  dot(frame, 0, 0, 7);
  // 霜の尾: 礫の後ろに短い冷気の筋（位相で少し上下に揺れる）
  streakLine(frame, { ax: -24, ay: Math.sin(ph) * 1.2, bx: -7, by: 0, bright: 0.45 });
  trailMotes(frame, { n: 6, len: 24, spread: 3.5, ph, seed: 1911, x0: -5, hi: 5 });
}

// -----------------------------------------------------------------------------
// 弾: 雷（lightningBolt・arcLightning）
// -----------------------------------------------------------------------------

/** 雷の槍: 一瞬で伸びる長いギザギザの稲妻。フレームごとに折れ方が変わってちらつく。先端は細い二股 */
function lightningBolt(frame, f) {
  const seed = 2011 + f * 17;
  const pts = jag(8, 0, -54, 0, 9, 5, seed, true);
  // 芯（白）は先の半分だけ。後ろは色の帯に溶かす
  stroke(frame, pts.slice(0, 6), { width: (t) => 3.8 - 1.2 * t, maxWidth: 3.8, bright: (t) => 0.72 - 0.15 * t, core: 1.1, samples: 2 });
  stroke(frame, pts.slice(5), { width: (t) => 2.6 - 1.6 * t, maxWidth: 2.6, bright: (t) => 0.6 - 0.35 * t, samples: 2 });
  // 枝: 途中の折れ目から後ろ斜めへ短い枝
  for (let i = 0; i < 2; i++) {
    const p = pts[2 + i * 2];
    if (!p) continue;
    const side = hash1(i, seed + 3) > 0.5 ? 1 : -1;
    const b = jag(p.x, p.y, p.x - 10 - 6 * hash1(i, seed + 4), p.y + side * (6 + 4 * hash1(i, seed + 5)), 3, 2, seed + 6 + i, true);
    stroke(frame, b, { width: (t) => 1.8 * (1 - t * 0.5), maxWidth: 1.8, bright: 0.55, samples: 2 });
  }
  sparkle(frame, 8, 0, f % 2 === 0 ? 3 : 2);
}

/** 跳ねる雷の球: 丸い放電の球と、球から出て戻る短い放電の枝（フレームごとに向きが変わる）。後ろに途切れた残光 */
function arcOrb(frame, f) {
  const N = 6;
  const ph = phase(f, N);
  blob(frame, 0, 0, 6.5, { bright: 0.8, seed: 2021 + f, rough: 0.28 });
  dot(frame, 0, 0, 7);
  for (let i = 0; i < 3; i++) {
    const a = hash1(i, 2022 + f * 5) * TAU;
    const L = 8 + 5 * hash1(i, 2023 + f * 5);
    const b = jag(Math.cos(a) * 5, Math.sin(a) * 5, Math.cos(a + 0.4) * (5 + L), Math.sin(a + 0.4) * (5 + L), 3, 2.2, 2024 + f * 7 + i);
    stroke(frame, b, { width: (t) => 2 * (1 - t * 0.6), maxWidth: 2, bright: (t) => 0.75 - 0.3 * t, samples: 2 });
  }
  // 残光: 通り道に残る放電の点
  for (let i = 0; i < 5; i++) {
    const u = (hash1(i, 2025) + ph / TAU) % 1;
    const x = -8 - u * 30;
    const y = (hash1(i, 2026 + (f % 3)) - 0.5) * 8;
    dot(frame, x, y, Math.max(2, Math.round(6 - u * 4)));
    dot(frame, x - 1.5, y + (i % 2 ? 1 : -1), Math.max(2, Math.round(5 - u * 4)));
  }
}

// -----------------------------------------------------------------------------
// 弾: 毒（venomMist）・光（flash）・闇（darkHand）
// -----------------------------------------------------------------------------

/** 毒の泡（設置弾・dirs 1）: 泡立つ球。表面に小さな泡が湧いて弾け、底から雫が垂れる */
function venomBubble(frame, f) {
  const N = 8;
  const ph = phase(f, N);
  const pulse = 1 + 0.06 * Math.sin(ph);
  blob(frame, 0, 0, 8.5 * pulse, { bright: 0.72, seed: 2111, rough: 0.1, hi: -2.3 });
  // 表面の泡: 小さな輪（中が暗く縁が明るい）が湧いて大きくなり、弾けて消える
  for (let i = 0; i < 4; i++) {
    const t = ((i / 4 + f / N) % 1);
    const a = hash1(i, 2112) * TAU;
    const r = 8 + t * 2;
    const br = 1.5 + t * 2.5;
    if (t > 0.85) continue;
    ring(frame, { ox: Math.cos(a) * r, oy: Math.sin(a) * r, radius: br, width: 1.3, bright: 0.8 - t * 0.3, seed: 2113 + i });
  }
  sparkle(frame, -3, -3, 1);
  // 雫: 底から垂れて落ちる
  const dy = 9 + ((f % N) / N) * 8;
  dot(frame, 1, dy, 5);
  dot(frame, 1, dy + 1, 4);
}

/** 毒の炸裂（blastBase 36 = 半径 72 ドット）: 泡の塊がふくらんで割れ、もこもこの霧が広がって薄れる */
function venomBlast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const spread = 72 * easeSwing(Math.min(1, (f + 1) / 6));
  // 霧の玉: 中心の周りに並ぶ丸い塊が外へ押し出される（煙の輪郭は丸の重なり）
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + hash1(i, 2121) * 0.5;
    const d = spread * (0.5 + 0.35 * hash1(i, 2122));
    const r = 12 + 10 * hash1(i, 2123) + 8 * (1 - k);
    blob(frame, Math.cos(a) * d, Math.sin(a) * d, r * (0.6 + 0.5 * Math.min(1, f / 3)), { bright: 0.55 - 0.25 * k, seed: 2124 + i, rough: 0.3, erosion: Math.max(0, k - 0.25) * 1.1, hi: -2.3 });
  }
  if (f < 5) blob(frame, 0, 0, 16 + f * 4, { bright: 0.75 - f * 0.08, seed: 2130, rough: 0.25, erosion: f * 0.12 });
  // 弾ける泡の輪
  for (let i = 0; i < 7; i++) {
    const t = clamp01((f - hash1(i, 2131) * 5) / 3);
    if (t <= 0 || t >= 1) continue;
    const a = hash1(i, 2132) * TAU;
    const d = spread * hash1(i, 2133) * 0.9;
    ring(frame, { ox: Math.cos(a) * d, oy: Math.sin(a) * d, radius: 2 + t * 5, width: 1.4, bright: 0.85 - t * 0.4, erosion: t * 0.5, seed: 2134 + i });
  }
  burst(frame, f, { n: 14, seed: 2136, speed: 6, life: 4, drag: 0.8, jitter: 8 });
}

/** 光の針: 極細の閃光。細い芯と、先端の十字の閃き、後ろへ伸びる糸のような光条 */
function lightNeedle(frame, f) {
  const len = 58 + (f % 2) * 4;
  // 白い芯は前の 4 割だけ。後ろは細く暗くなって糸のように消える
  stroke(frame, [{ x: 6, y: 0 }, { x: -len * 0.4, y: 0 }], { width: (t) => 3 - 0.8 * t, maxWidth: 3.5, bright: (t) => 0.72 - 0.12 * t, core: t0(f), samples: 3 });
  stroke(frame, [{ x: -len * 0.4 + 1, y: 0 }, { x: -len, y: 0 }], { width: (t) => 2.1 - 1.1 * t, maxWidth: 2.2, bright: (t) => 0.58 - 0.4 * t, samples: 3 });
  sparkle(frame, 6, 0, f === 1 ? 3 : 2);
  // 光条の脇を走る細い平行線（閃光の余韻）
  streakLine(frame, { ax: -len * 0.8, ay: -2.5, bx: -8, by: -2.5, bright: 0.35 });
  streakLine(frame, { ax: -len * 0.6, ay: 2.5, bx: -14, by: 2.5, bright: 0.3 });
}

/** 光の針の芯の太さ（ちらつき: 1 枚おきに芯が細くなる） */
function t0(f) {
  return f % 2 === 0 ? 1.1 : 0.8;
}

/**
 * 闇の手: 前へ伸びる 4 本の指（関節で曲がり、位相でうねる）と手のひらの影。手首から後ろへ千切れる煙の尾
 */
function darkHand(frame, f) {
  const N = 8;
  const ph = phase(f, N);
  blob(frame, 0, 0, 6.5, { bright: 0.55, seed: 2211, rough: 0.2 });
  for (let i = 0; i < 4; i++) {
    const spreadA = (i - 1.5) * 0.42;
    // 指は握る・開くを繰り返す（開いた指が先で内へ曲がる）
    const curl = 0.35 + 0.35 * Math.sin(ph + i * 0.7);
    const L1 = 6 + (i === 1 || i === 2 ? 2 : 0);
    const L2 = 5.5;
    const b0 = { x: Math.cos(spreadA) * 5, y: Math.sin(spreadA) * 5 };
    const b1 = { x: b0.x + Math.cos(spreadA) * L1, y: b0.y + Math.sin(spreadA) * L1 };
    const a2 = spreadA - Math.sign(spreadA || 0.1) * curl;
    const b2 = { x: b1.x + Math.cos(a2) * L2, y: b1.y + Math.sin(a2) * L2 };
    stroke(frame, [b0, b1, b2], { width: (t) => 3 - 1.8 * t, maxWidth: 3, bright: (t) => 0.62 + 0.2 * t });
    dot(frame, b2.x, b2.y, 7);
  }
  // 親指: 横から前へ
  const th = 0.9 + 0.2 * Math.sin(ph + 2);
  stroke(frame, [{ x: -1, y: 5 }, { x: 3, y: 5 + Math.sin(th) * 5 }, { x: 7, y: 5 + Math.sin(th) * 3 }], { width: (t) => 2.8 - 1.4 * t, maxWidth: 2.8, bright: 0.55 });
  // 手首から後ろへ、うねって千切れる煙の尾（3 本）
  for (let i = 0; i < 3; i++) {
    const y0 = (i - 1) * 3;
    const pts = [];
    for (let s = 0; s <= 6; s++) {
      const u = s / 6;
      pts.push({ x: -4 - u * 20, y: y0 * (1 + u) + Math.sin(ph + u * 5 + i * 2) * 2.5 * u });
    }
    stroke(frame, pts, { width: (t) => 3.2 * (1 - t), maxWidth: 3.2, bright: (t) => 0.42 - 0.25 * t });
  }
  trailMotes(frame, { n: 4, len: 26, spread: 5, ph, seed: 2212, x0: -6, hi: 4, wave: 1.5 });
}

// -----------------------------------------------------------------------------
// 撃った瞬間（muzzle）: 杖の先の詠唱の紋・魔力の放出。属性ごとに形を変える
// -----------------------------------------------------------------------------

/** 炎: 火の粉の花。前へ開く炎の花びら（先の尖った雫形）と中心の閃き。big は火球の詠唱（花びらが多く、火の輪が付く） */
function fireMuzzle(frame, f, big) {
  const N = 5;
  const k = f / (N - 1);
  const petals = big ? 7 : 5;
  const open = easeSwing(Math.min(1, (f + 1) / 2));
  const L = (big ? 22 : 16) * (0.5 + 0.5 * open) * (1 + k * 0.2);
  for (let i = 0; i < petals; i++) {
    const a = (i - (petals - 1) / 2) * (big ? 0.42 : 0.5) * (0.6 + 0.4 * open);
    const len = L * (1 - Math.abs(a) * 0.4);
    if (k > 0.7 && i % 2 === 1) continue;
    // 花びらは根元が細く、中ほどでふくらみ、先で尖る。先は外へ少し反る（炎が開く）
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const bend = 0.18 * Math.sign(a || 0);
    const pts = [0, 0.35, 0.7, 1].map((t) => {
      const aa = a + bend * t;
      return { x: Math.cos(aa) * len * t + c * 2, y: Math.sin(aa) * len * t + sn * 2 };
    });
    stroke(frame, pts, { width: (t) => (big ? 4.4 : 3.6) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)), 0.8) * (1 - k * 0.45), maxWidth: 4.4, bright: (t) => (0.8 - 0.35 * t) * (1 - k * 0.4) });
    // 花びらの先から火の粉が 1 粒ずつ飛ぶ
    if (f >= 1) dot(frame, Math.cos(a) * (len + 2 + f * 2.5), Math.sin(a) * (len + 2 + f * 2.5), Math.max(3, 7 - f));
  }
  if (f <= 1) sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  if (big && f >= 1) ring(frame, { ox: 2, radius: 7 + f * 4, width: 2, squash: 0.5, erosion: f * 0.18, bright: 0.72, seed: 2311 });
  burst(frame, f, { n: big ? 10 : 6, seed: big ? 2312 : 2313, speed: 3.2, cone: 2.2, life: 3 });
}

/** 氷: 結晶の紋。撃つ向きに直交する六花の紋（斜めから見て少し潰した形）と、前へ散る霜の粒。fan は吹雪（前へ開く冷気の筋が付く） */
function iceMuzzle(frame, f, fan) {
  const N = 5;
  const k = f / (N - 1);
  const R = 11 + f * 2;
  const sq = 0.6;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6 + f * 0.12;
    const L = R * (1 - k * 0.25);
    if (k > 0.75 && i % 2 === 0) continue;
    const tip = { x: Math.cos(a) * L * sq, y: Math.sin(a) * L };
    stroke(frame, [{ x: 0, y: 0 }, tip], { width: (t) => 2.4 * (1 - t * 0.5), maxWidth: 2.4, bright: (t) => (0.72 - 0.2 * t) * (1 - k * 0.4) });
    // 腕の小枝（先寄りに V 字）
    for (const s of [-1, 1]) {
      const m = { x: Math.cos(a) * L * 0.6 * sq, y: Math.sin(a) * L * 0.6 };
      const bA = a + s * 0.8;
      const e = { x: m.x + Math.cos(bA) * L * 0.3 * sq, y: m.y + Math.sin(bA) * L * 0.3 };
      stroke(frame, [m, e], { width: 1.4, maxWidth: 1.4, bright: 0.6 * (1 - k * 0.4) });
    }
  }
  if (f <= 1) sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  if (fan) {
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.22;
      const r0 = 8 + f * 5;
      const r1 = r0 + 12 - k * 4;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.62 * (1 - k * 0.5) });
    }
  }
  burst(frame, f, { n: fan ? 10 : 6, seed: fan ? 2321 : 2322, speed: 3, cone: fan ? 1.4 : 1.8, life: 3 });
}

/** 雷: 放電。杖の先から前・斜めへ短いギザギザが走り、中心が弾ける */
function sparkMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  const n = f < 3 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const a = (hash1(i, 2331 + f) - 0.5) * 2.2;
    const L = (10 + 8 * hash1(i, 2332 + f)) * (1 - k * 0.3);
    const pts = jag(0, 0, Math.cos(a) * L, Math.sin(a) * L, 4, 2.2, 2333 + f * 11 + i);
    stroke(frame, pts, { width: (t) => 2.2 * (1 - t * 0.6), maxWidth: 2.2, bright: (t) => (0.85 - 0.3 * t) * (1 - k * 0.4), samples: 2 });
  }
  if (f <= 2) sparkle(frame, 0, 0, f === 0 ? 4 : 3 - f);
  if (f >= 1) ring(frame, { radius: 4 + f * 3.5, width: 1.6, erosion: f * 0.2, bright: 0.7, seed: 2334 });
}

/** 毒: 泡を吹き出す。前へ小さな泡の輪が 3〜4 個押し出され、飛沫が散る */
function venomMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  // 泡は扇に並べて重ならないようにする（重なると塊の中に穴が空いて顔のように見える）
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.5 + (hash1(i, 2341) - 0.5) * 0.2;
    const d = 5 + i * 3 * (i % 2 ? 0.6 : 1) + f * (2.5 + 1.5 * hash1(i, 2342));
    const r = 1.6 + 1.4 * hash1(i, 2343) + f * 0.35;
    if (k > 0.7 && i % 2 === 0) continue;
    ring(frame, { ox: Math.cos(a) * d, oy: Math.sin(a) * d, radius: r, width: 1.2, bright: 0.8 - k * 0.3, seed: 2344 + i });
    if (k < 0.5) dot(frame, Math.cos(a) * d - r * 0.4, Math.sin(a) * d - r * 0.4, 7);
  }
  if (f === 0) blob(frame, 0, 0, 3.5, { bright: 0.8, seed: 2345, rough: 0.1 });
  burst(frame, f, { n: 6, seed: 2346, speed: 2.8, cone: 1.8, life: 3, fall: 1.5 });
}

/** 光: 十字の閃光。前へ長い光条と縦の短い光条、中心の大きな閃き */
function lightMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  const L = 22 * (1 - k * 0.5);
  stroke(frame, [{ x: -L * 0.4, y: 0 }, { x: 0, y: 0 }, { x: L, y: 0 }], { width: (t) => 3.2 * Math.sin(Math.PI * t) + 0.6, maxWidth: 3.8, bright: 0.8 * (1 - k * 0.5) });
  const V = 12 * (1 - k * 0.6);
  stroke(frame, [{ x: 0, y: -V }, { x: 0, y: V }], { width: (t) => 2.4 * Math.sin(Math.PI * t) + 0.5, maxWidth: 3, bright: 0.7 * (1 - k * 0.5) });
  if (f <= 2) sparkle(frame, 0, 0, 4 - f);
  if (f >= 1) ring(frame, { radius: 5 + f * 3, width: 1.4, bright: 0.55, erosion: f * 0.2, seed: 2351 });
}

/** 闇: 影の渦の紋。外から 4 本の影の筋が巻きながら杖の先へ吸い込まれ、最後に小さく弾ける */
function darkMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * TAU + f * 0.6;
    const pts = [];
    for (let s = 0; s <= 5; s++) {
      const u = s / 5;
      const r = (14 - f * 2.2) * (1 - u) + 2;
      const a = a0 + u * 1.6;
      pts.push({ x: Math.cos(a) * r * 0.6, y: Math.sin(a) * r });
    }
    if (k < 0.9) stroke(frame, pts, { width: (t) => 1 + 1.8 * t, maxWidth: 2.8, bright: (t) => 0.35 + 0.35 * t });
  }
  if (f >= 2) sigil(frame, { R: 5 + (f - 2) * 3, squash: 0.45, rot: f, ticks: 6, width: 1.6, bright: 0.7 - (f - 2) * 0.15, seed: 2361, tickLen: 2.5 });
  if (f === 2) sparkle(frame, 0, 0, 3);
  if (f >= 2) burst(frame, f - 2, { n: 6, seed: 2362, speed: 2.5, cone: 2.2, life: 2 });
}

// -----------------------------------------------------------------------------
// 着弾（impact）・尽きた（fizzle）
// -----------------------------------------------------------------------------

/** 炎の着弾: 弾けた炎の塊が前へ潰れて広がり、火の粉が跳ね返って煤になる */
function fireImpact(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  const r = 5 + f * 1.5;
  blob(frame, 2 + f, 0, r, { bright: 0.85 - 0.5 * k, seed: 2411, rough: 0.35, erosion: Math.max(0, k - 0.15) * 1.1 });
  if (f <= 1) sparkle(frame, 2, 0, f === 0 ? 3 : 2);
  // 炎の舌: 着弾点から後ろ斜め（跳ね返り）と横へ
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i - 2) * 0.6;
    const L = (12 + 8 * hash1(i, 2412)) * Math.min(1, (f + 1) / 2) * (1 - k * 0.3);
    if (k > 0.8) continue;
    // 舌は外へ反りながら伸びる（王冠形の跳ね返り）
    const b = a + (i - 2) * 0.15;
    const mid = { x: 2 + Math.cos(a) * L * 0.5, y: Math.sin(a) * L * 0.5 };
    stroke(frame, [{ x: 2, y: 0 }, mid, { x: mid.x + Math.cos(b) * L * 0.5, y: mid.y + Math.sin(b) * L * 0.5 }], { width: (t) => 4 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.85)), maxWidth: 4, bright: (t) => (0.8 - 0.35 * t) * (1 - k * 0.5) });
  }
  burst(frame, f, { n: 9, seed: 2413, speed: 3.5, cone: 3.6, center: Math.PI, life: 3, x: 2 });
}

/** 炎が尽きた: 小さくしぼんで火の粉と煙が上へ立つ */
function fireFizzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f < 3) blob(frame, 0, 0, 5 - f * 1.3, { bright: 0.7 - f * 0.12, seed: 2421 });
  for (let i = 0; i < 3; i++) {
    const y = -2 - f * 3 - i * 3;
    const x = Math.sin(f * 0.9 + i * 2) * 2 + (i - 1) * 3;
    if (k < 0.9) blob(frame, x, y, 2.2 + f * 0.3, { bright: 0.28, seed: 2422 + i, erosion: k * 0.7 });
  }
  burst(frame, f, { n: 5, seed: 2423, speed: 2, cone: TAU, life: 3, fall: -1.5 });
}

/** 氷の着弾: 砕けた結晶の破片（小さな菱形）が前と横へ飛び、中心に割れ目の星 */
function iceImpact(frame, f, big) {
  const N = big ? 7 : 6;
  const k = f / (N - 1);
  const s = big ? 1.4 : 1;
  // 割れ目の星: 中心から 5 方向へ細い亀裂
  if (f <= 3) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const L = (6 + 4 * hash1(i, 2431)) * s * Math.min(1, (f + 1) / 2);
      streakLine(frame, { ax: 0, ay: 0, bx: Math.cos(a) * L, by: Math.sin(a) * L, width: 1.3, bright: 0.85 - f * 0.12 });
    }
  }
  if (f <= 1) sparkle(frame, 0, 0, big ? 4 : 3);
  // 破片: 菱形の結晶が回りながら飛ぶ（刃片と違って大きく、角ばる）
  const n = big ? 11 : 8;
  for (let i = 0; i < n; i++) {
    // 破片は後ろ（跳ね返り）と横へ多く飛ぶ。前へ抜けるのは少し
    const a = Math.PI + (hash1(i, 2432) - 0.5) * 4.4;
    const sp = (3 + 3 * hash1(i, 2433)) * s;
    const t = (1 - Math.pow(0.78, f + 1)) / (1 - 0.78);
    const x = Math.cos(a) * sp * t;
    const y = Math.sin(a) * sp * t + f * f * 0.15;
    const h = (1.8 + 1.2 * hash1(i, 2434)) * (1 - k * 0.5);
    if (hash1(i, 2435) < k * 1.1 - 0.1) continue;
    crystalAt(frame, x, y, a + f * 0.6, h * 2.2, h, 0.85 - k * 0.3);
  }
}

/** 向きのある小さな菱形の結晶（破片）。paint を回した座標で塗る */
function crystalAt(frame, cx, cy, angle, len, h, bright) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  paint(
    frame,
    (px, py) => {
      const dx = px - cx;
      const dy = py - cy;
      const x = dx * c + dy * s;
      const y = -dx * s + dy * c;
      const half = h * (1 - Math.abs(x) / len);
      if (Math.abs(x) > len || Math.abs(y) > half || half < 0.3) return -1;
      return y < 0 ? bright : bright * 0.55;
    },
    { bounds: { x0: cx - len - 2, y0: cy - len - 2, x1: cx + len + 2, y1: cy + len + 2 }, samples: 2 },
  );
}

/** 氷の礫の着弾: 小さな霜の花が弾ける（6 本の短い棘が開いて、先が粒に砕ける） */
function frostImpact(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.26;
    const r0 = 1 + f * 2.5;
    const r1 = r0 + 6 * (1 - k * 0.6);
    if (f < 3) stroke(frame, [{ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 }], { width: (t) => 2 * (1 - t * 0.5), maxWidth: 2, bright: 0.75 - f * 0.1 });
    else dot(frame, Math.cos(a) * (r1 + 1), Math.sin(a) * (r1 + 1), Math.max(4, 8 - f));
  }
  if (f <= 1) sparkle(frame, 0, 0, 2);
}

/** 氷が尽きた: 結晶が溶けて小さな粒と靄になる */
function iceFizzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f < 3) crystalAt(frame, 0, f * 1.5, 0, 7 - f * 2, 2.5 - f * 0.6, 0.75 - f * 0.1);
  for (let i = 0; i < 6; i++) {
    const a = hash1(i, 2441) * TAU;
    const r = 2 + f * (1.5 + hash1(i, 2442));
    if (hash1(i, 2443) < k - 0.1) continue;
    dot(frame, Math.cos(a) * r, Math.sin(a) * r + f * 0.8, Math.max(3, 6 - f));
  }
  if (f >= 1 && f < 5) blob(frame, 0, 2, 3 + f, { bright: 0.22, seed: 2444, erosion: k * 0.8 });
}

/** 雷の着弾: 着弾点から全方位へギザギザの放電が走り、中心が弾ける。chain は跳ねる雷（輪の放電が付く） */
function sparkImpact(frame, f, chain) {
  const N = 6;
  const k = f / (N - 1);
  const n = f < 3 ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash1(f, 2451 + i) * 0.8;
    const L = (9 + 7 * hash1(i, 2452 + f)) * (1 - k * 0.4);
    if (k > 0.85) continue;
    const pts = jag(0, 0, Math.cos(a) * L, Math.sin(a) * L, 4, 2.4, 2453 + f * 13 + i);
    stroke(frame, pts, { width: (t) => 2.2 * (1 - t * 0.6), maxWidth: 2.2, bright: (t) => (0.85 - 0.35 * t) * (1 - k * 0.4), samples: 2 });
  }
  if (f <= 2) sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  if (chain && f >= 1) ring(frame, { radius: 7 + f * 4, width: 2, erosion: Math.min(0.9, f * 0.18), bright: 0.75, seed: 2454 });
  burst(frame, f, { n: 7, seed: 2455, speed: 4, life: 2 });
}

/** 雷が尽きた: 小さな放電が 2〜3 回ぱちぱちして消える */
function sparkFizzle(frame, f) {
  if (f % 2 === 1 || f >= 5) {
    burst(frame, f, { n: 4, seed: 2461, speed: 1.5, life: 3 });
    return;
  }
  for (let i = 0; i < 2; i++) {
    const a = hash1(i, 2462 + f) * TAU;
    const pts = jag(0, 0, Math.cos(a) * 7, Math.sin(a) * 7, 3, 1.8, 2463 + f * 5 + i);
    stroke(frame, pts, { width: 1.6, bright: 0.75 - f * 0.1, samples: 2 });
  }
  sparkle(frame, 0, 0, 2);
}

/** 毒の着弾（泡が敵・壁で割れた）: 飛沫が散り、小さな泡の輪がいくつか弾ける */
function venomImpact(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f < 2) blob(frame, 0, 0, 8 + f * 3, { bright: 0.7, seed: 2471, rough: 0.3, hollow: f === 1 ? 0.6 : 0 });
  for (let i = 0; i < 5; i++) {
    const a = hash1(i, 2472) * TAU;
    const d = 6 + f * 3 * (0.6 + hash1(i, 2473));
    const t = clamp01((f - hash1(i, 2474) * 2) / 3);
    if (t <= 0 || t >= 1) continue;
    ring(frame, { ox: Math.cos(a) * d, oy: Math.sin(a) * d, radius: 1.5 + t * 3, width: 1.3, bright: 0.8 - t * 0.3, seed: 2475 + i });
  }
  burst(frame, f, { n: 10, seed: 2476, speed: 3.5, life: 3, fall: 1 });
  if (f >= 2) blob(frame, 0, 2, 7 + f, { bright: 0.25, seed: 2477, rough: 0.4, erosion: k * 0.9 });
}

/** 光の着弾: 鋭い八方の光条（縦横が長い）と、閃きの十字 */
function lightImpact(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const main = i % 2 === 0;
    const L = (main ? 16 : 8) * Math.min(1, (f + 1) / 2) * (1 - k * 0.5);
    if (k > 0.7 && !main) continue;
    stroke(frame, [{ x: 0, y: 0 }, { x: Math.cos(a) * L, y: Math.sin(a) * L }], { width: (t) => (main ? 2.4 : 1.6) * (1 - t) + 0.4, maxWidth: 2.8, bright: (t) => (0.85 - 0.4 * t) * (1 - k * 0.5), samples: 2 });
  }
  if (f <= 2) sparkle(frame, 0, 0, 4 - f);
  if (f >= 1) ring(frame, { radius: 4 + f * 3, width: 1.3, erosion: f * 0.18, bright: 0.6, seed: 2481 });
}

/** 光が尽きた: 小さな閃きが瞬いて消える */
function lightFizzle(frame, f) {
  const size = [3, 2, 3, 2, 1, 1][f] ?? 1;
  sparkle(frame, 0, 0, size);
  if (f >= 1) ring(frame, { radius: 3 + f * 2, width: 1.2, erosion: f * 0.2, bright: 0.5, seed: 2482 });
}

/** 闇の着弾: 手が握り込む。指が内へ閉じて一点に集まり、影が煙のように弾ける */
function darkImpact(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f < 3) {
    const close = f / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const r0 = 16 * (1 - close * 0.7);
      const pts = [
        { x: Math.cos(a) * r0, y: Math.sin(a) * r0 },
        { x: Math.cos(a + 0.5) * r0 * 0.6, y: Math.sin(a + 0.5) * r0 * 0.6 },
        { x: Math.cos(a + 0.9) * 2, y: Math.sin(a + 0.9) * 2 },
      ];
      stroke(frame, pts, { width: (t) => 3 - 1.5 * t, maxWidth: 3, bright: (t) => 0.5 + 0.3 * t });
    }
  }
  if (f === 2) sparkle(frame, 0, 0, 3);
  if (f >= 2) {
    const age = f - 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.6;
      const d = 3 + age * 4;
      blob(frame, Math.cos(a) * d, Math.sin(a) * d, 4 + age * 1.2, { bright: 0.45 - age * 0.06, seed: 2491 + i, erosion: k * 0.9, rough: 0.35 });
    }
  }
}

/** 闇が尽きた: 手がほどけて煙になり、ゆっくり薄れる */
function darkFizzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + f * 0.3;
    const d = 2 + f * 2;
    blob(frame, Math.cos(a) * d, Math.sin(a) * d - f, 3.5 + f * 0.5, { bright: 0.4 - k * 0.15, seed: 2495 + i, erosion: k * 0.95, rough: 0.35 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 繰り返しの弾（fly）: 位相で 1 巡するので、period はフレーム数とゆらぎの速さで決める */
const FLY = (key, frames, size, draw, dirs = SHOT_DIRS) => ({ key, dirs, frames, active: 0, size, draw });
/** 一度流す絵（muzzle・impact・fizzle・blast） */
const ONCE = (key, frames, size, draw, dirs = DIRS) => ({ key, dirs, frames, active: 0, size, draw });

const FIRE = { muzzle: "wand.muzzleFire", impact: "wand.impactFire", fizzle: "wand.fizzleFire", ramp: "fire" };
const ICE = { muzzle: "wand.muzzleIce", impact: "wand.impactIce", fizzle: "wand.fizzleIce", ramp: "ice" };

/**
 * 武器種のモーション → シート・弾の key → 弾の絵。l:<段> の当たり判定（杖の先の box）の中心に詠唱の紋を置く
 */
const FX = {
  moveset: "wand",
  motions: {
    "l:0": { sheet: "wand.cast1", pivot: "anchor", base: 14, measure: "reach" },
    "l:1": { sheet: "wand.cast2", pivot: "anchor", base: 14, measure: "reach" },
    "l:2": { sheet: "wand.cast3", pivot: "anchor", base: 14, measure: "reach" },
    "l:3": { sheet: "wand.cast4", pivot: "anchor", base: 14, measure: "reach" },
    dash: { sheet: "wand.dash", pivot: "self", base: 40, measure: "size" },
    "branch:vortex": { sheet: "wand.vortex", pivot: "self", base: 96, measure: "size" },
  },
  hit: "wand.hit",
  hitHeavy: "wand.hitHeavy",
  bullets: {
    "cast.fireDart": { fly: "wand.fireDart", period: 0.24, base: 3, ...FIRE },
    "cast.fireDart2": { fly: "wand.fireDart2", period: 0.24, base: 3, ...FIRE },
    "cast.fireDartTwin": { fly: "wand.fireArrow", period: 0.24, base: 3, ...FIRE },
    "cast.blastOrb": { fly: "wand.fireOrb", period: 0.32, base: 4, ...FIRE, muzzle: "wand.muzzleFireBig", blast: "wand.blastFire", blastBase: 34 },
    "art.iceLance": { fly: "wand.iceLance", period: 0.3, base: 3, ...ICE },
    "art.iceLance2": { fly: "wand.iceLance2", period: 0.3, base: 3, ...ICE },
    "art.iceLanceLong": { fly: "wand.iceLanceLong", period: 0.3, base: 3, ...ICE, impact: "wand.impactIceBig" },
    "art.blizzard": { fly: "wand.iceShard", period: 0.18, base: 3, ...ICE, muzzle: "wand.muzzleBlizzard", impact: "wand.impactFrost" },
    "cast.lightningBolt": { fly: "wand.bolt", period: 0.1, base: 2, muzzle: "wand.muzzleSpark", impact: "wand.impactSpark", fizzle: "wand.fizzleSpark", ramp: "lightning" },
    "cast.arcLightning": { fly: "wand.arcOrb", period: 0.15, base: 3, muzzle: "wand.muzzleSpark", impact: "wand.impactArc", fizzle: "wand.fizzleSpark", ramp: "lightning" },
    "cast.venomMist": { fly: "wand.venomBubble", period: 0.5, base: 4, muzzle: "wand.muzzleVenom", impact: "wand.impactVenom", blast: "wand.blastVenom", blastBase: 36, ramp: "poison" },
    "cast.flash": { fly: "wand.needle", period: 0.08, base: 2, muzzle: "wand.muzzleLight", impact: "wand.impactLight", fizzle: "wand.fizzleLight", ramp: "light" },
    "cast.darkHand": { fly: "wand.darkHand", period: 0.4, base: 4, muzzle: "wand.muzzleDark", impact: "wand.impactDark", fizzle: "wand.fizzleDark", ramp: "dark" },
  },
};

export const ATLAS = {
  key: "wand",
  fx: FX,
  sheets: [
    // 近接（詠唱の振り・ダッシュ・渦巻き・命中）
    { key: "wand.cast1", dirs: DIRS, frames: CAST.l0.frames, active: CAST.l0.active, size: 64, draw: (fr, f) => castSigil(fr, f, CAST.l0) },
    { key: "wand.cast2", dirs: DIRS, frames: CAST.l1.frames, active: CAST.l1.active, size: 72, draw: (fr, f) => castSigil(fr, f, CAST.l1) },
    { key: "wand.cast3", dirs: DIRS, frames: CAST.l2.frames, active: CAST.l2.active, size: 80, draw: (fr, f) => castSigil(fr, f, CAST.l2) },
    { key: "wand.cast4", dirs: DIRS, frames: CAST.l3.frames, active: CAST.l3.active, size: 144, draw: (fr, f) => castSigil(fr, f, CAST.l3) },
    { key: "wand.dash", dirs: DIRS, frames: 8, active: 4, size: 136, draw: dashRing },
    { key: "wand.vortex", dirs: 1, frames: 11, active: 6, size: 208, draw: vortex },
    { key: "wand.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (fr, f) => staffHit(fr, f, false) },
    { key: "wand.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (fr, f) => staffHit(fr, f, true) },
    // 飛んでいる弾
    FLY("wand.fireDart", 6, 96, (fr, f) => flameDart(fr, f, { frames: 6, head: 10, R: 5.5, tail: 30, seed: 1801, motes: 7 })),
    FLY("wand.fireDart2", 6, 96, (fr, f) => flameDart(fr, f, { frames: 6, head: 9, R: 5, tail: 34, seed: 1802, forks: 2, forkGap: 3.5, wave: 1.5, motes: 6 })),
    FLY("wand.fireArrow", 6, 104, flameArrow),
    FLY("wand.fireOrb", 8, 40, fireOrb, 1),
    FLY("wand.iceLance", 6, 104, (fr, f) => iceLance(fr, f, { frames: 6, tail: 36, seed: 1901 })),
    FLY("wand.iceLance2", 6, 104, (fr, f) => iceLance(fr, f, { frames: 6, tail: 36, seed: 1902, barbs: true })),
    FLY("wand.iceLanceLong", 6, 144, (fr, f) => iceLance(fr, f, { frames: 6, tail: 56, seed: 1903, scale: 1.45, segments: 3, streaks: 3 })),
    FLY("wand.iceShard", 6, 64, iceShard),
    FLY("wand.bolt", 4, 136, lightningBolt),
    FLY("wand.arcOrb", 6, 96, arcOrb),
    FLY("wand.venomBubble", 8, 48, venomBubble, 1),
    FLY("wand.needle", 3, 144, lightNeedle),
    FLY("wand.darkHand", 8, 72, darkHand),
    // 撃った瞬間
    ONCE("wand.muzzleFire", 5, 48, (fr, f) => fireMuzzle(fr, f, false)),
    ONCE("wand.muzzleFireBig", 5, 64, (fr, f) => fireMuzzle(fr, f, true)),
    ONCE("wand.muzzleIce", 5, 48, (fr, f) => iceMuzzle(fr, f, false)),
    ONCE("wand.muzzleBlizzard", 5, 64, (fr, f) => iceMuzzle(fr, f, true)),
    ONCE("wand.muzzleSpark", 5, 56, sparkMuzzle),
    ONCE("wand.muzzleVenom", 5, 48, venomMuzzle),
    ONCE("wand.muzzleLight", 5, 64, lightMuzzle),
    ONCE("wand.muzzleDark", 5, 48, darkMuzzle),
    // 着弾・尽きた・炸裂
    ONCE("wand.impactFire", 6, 64, fireImpact),
    ONCE("wand.fizzleFire", 6, 48, fireFizzle, 1),
    ONCE("wand.impactIce", 6, 64, (fr, f) => iceImpact(fr, f, false)),
    ONCE("wand.impactIceBig", 7, 80, (fr, f) => iceImpact(fr, f, true)),
    ONCE("wand.impactFrost", 5, 40, frostImpact, 1),
    ONCE("wand.fizzleIce", 6, 40, iceFizzle, 1),
    ONCE("wand.impactSpark", 6, 64, (fr, f) => sparkImpact(fr, f, false)),
    ONCE("wand.impactArc", 6, 72, (fr, f) => sparkImpact(fr, f, true)),
    ONCE("wand.fizzleSpark", 6, 40, sparkFizzle, 1),
    ONCE("wand.impactVenom", 6, 64, venomImpact, 1),
    ONCE("wand.impactLight", 6, 56, lightImpact, 1),
    ONCE("wand.fizzleLight", 6, 32, lightFizzle, 1),
    ONCE("wand.impactDark", 7, 56, darkImpact, 1),
    ONCE("wand.fizzleDark", 6, 40, darkFizzle, 1),
    ONCE("wand.blastFire", 10, 176, fireBlast, 1),
    ONCE("wand.blastVenom", 10, 184, venomBlast, 1),
  ],
};
