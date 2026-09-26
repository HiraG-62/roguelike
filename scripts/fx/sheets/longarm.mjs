// 長銃（moveset "longarm"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、銃の見本は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/longarm.json・弾の表）× 2 が目安
//
// 長銃らしさ = 両手で構える長さと重さ。近接は「銃身の線 + 片刃の銃剣」の突き、四角い銃床の鈍い打撃、銃剣の細い薙ぎで組む。
// 槍の突き（細る柄 + 菱形の穂先）と見分けるため、銃身は太さの変わらない暗い棒で、先の銃剣は背がまっすぐな片刃にする。
//
// 弾 6 種は形そのものを変える（数値で描き分けない）:
//   小銃 = 長く鋭い曳光 / 電磁砲 = 一直線の光条と放電の枝 / 弩 = 矢羽根のあるボルト /
//   火縄銃 = 揺れる火の玉と火の粉 / 手砲 = 太い火の玉と煙の尾 / 三連弩 = 小さなボルト
import { crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い曳光・ボルトは 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;
/** 銃身の光が始まる位置（キャラの胴の縁。キャラは絵のドットで 48） */
const BARREL_BACK = 12;

// -----------------------------------------------------------------------------
// 共通の部品（sidearm.mjs・spear.mjs から写して長銃向けに変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 正準座標を回して・ずらして描く作業面の写し（spear.mjs と同じ）。連突きの「角度をずらした 2 本目」を
 * 同じ描き方のまま角度だけ変えて描くために使う
 */
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

/** 前へ押し出す圧の弧（潰れた楕円の前側だけ。全周の輪は閃光の横にぶら下がって見えるので使わない） */
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

/** 薬莢（長い小銃弾の真鍮の筒）: spin（0..3）で 45° ずつ回る 3 ドットの棒。白を使わない */
function casing(frame, x, y, spin, fade = 0) {
  const k = ((Math.floor(spin) % 4) + 4) % 4;
  const dirs = [
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
  ];
  const [cx, cy] = dirs[k] ?? [1, 0];
  const hi = Math.max(2, 5 - Math.round(fade * 2));
  dot(frame, x + cx * 1.5, y + cy * 1.5, hi);
  dot(frame, x + cx * 0.5, y + cy * 0.5, hi - 1);
  dot(frame, x - cx * 0.5, y - cy * 0.5, Math.max(2, hi - 1));
  dot(frame, x - cx * 1.5, y - cy * 1.5, Math.max(2, hi - 2));
}

/** 横（+y、排莢口の側）へ飛ぶ薬莢。age（フレーム）で放物線を描き回りながら落ちる */
function ejectCasing(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  casing(frame, o.x - o.back * t, o.y + o.side * t - 0.35 * t * t * o.fall, o.spin + t, t / (o.life + 1));
}

/**
 * 画面に揃えて昇る細い煙（dirs 1 のシート用）。(x0, y0) から上へ height。age（0..1）で昇りながら切れる。段 2〜3 だけ
 */
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
 * 黒煙の塊（火縄銃・手砲）: 中心 (x, y)・半径 r のもこもこした雲。段 1〜3 だけで白を使わない。
 * 縁はノイズで食い、age（0..1）で内側から薄れて穴が開く
 */
function smokePuff(frame, o) {
  const { x, y, r, age, seed } = o;
  const bright = o.bright ?? 0.3;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy) / r;
      const edge = 0.75 + 0.35 * valueNoise(px, py, 3, seed);
      if (d > edge) return -1;
      if (valueNoise(px, py, 2.2, seed + 3) * 0.9 + (1 - d) * 0.35 - age * 0.95 < 0.05) return -1;
      // 上半分をわずかに明るく（光を受けた煙の頭）。それでも段 3 まで
      const top = dy < 0 ? 0.06 : 0;
      // もこもこの陰影: 大きめのノイズで段 2〜3 を混ぜる（一色のべた塗りにしない）
      const shade = 0.6 + 0.6 * valueNoise(px, py, 4, seed + 9);
      return clamp01((bright + top) * shade * (1 - d * 0.45) * (1 - age * 0.4));
    },
    { bounds: { x0: x - r * 1.2 - 1, y0: y - r * 1.2 - 1, x1: x + r * 1.2 + 1, y1: y + r * 1.2 + 1 }, samples: 2 },
  );
}

/**
 * 放電の枝（電磁砲）: (x, y) から角 a へ長さ len のぎざぎざの線。segs 本の折れ線で、
 * 折れ目の横ずれは seed で決める（フレームごとに seed を変えると枝が瞬く）。先ほど暗い
 */
function zigzag(frame, o) {
  const { x, y, a, len, segs, seed } = o;
  const bright = o.bright ?? 0.9;
  const jag = o.jag ?? 2.4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let px = x;
  let py = y;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const off = i === segs ? (hash1(i, seed) - 0.5) * jag : (hash1(i, seed) - 0.5) * 2 * jag;
    const nx = x + c * len * t - s * off;
    const ny = y + s * len * t + c * off;
    streakLine(frame, { ax: px, ay: py, bx: nx, by: ny, width: o.width ?? 1, bright: bright * (1 - 0.45 * t) });
    px = nx;
    py = ny;
  }
  return { x: px, y: py };
}

/** 塗りの衝撃の星: n 本のトゲ + 芯。鈍器の打撃なので白は芯の中心だけ */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.6) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  flashCore(frame, x, y, o.core ?? R * 0.28, bright);
}

// -----------------------------------------------------------------------------
// 銃剣の突き（銃身の線 + 片刃の銃剣）
// -----------------------------------------------------------------------------

/**
 * 銃身: back → front の太さの変わらない棒。上の縁に 1 ドットの明るい線（銃身の照り）、本体は段 3〜4。
 * 槍の柄（先へ太り白く光る）と違い、光らない鉄の棒に見せる。erosion で根元から崩れる
 */
function barrel(frame, o) {
  const { back, front, T } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 31;
  if (front - back < 2) return;
  const half = T / 2;
  paint(
    frame,
    (x, y) => {
      const u = (x - back) / (front - back);
      if (u < 0 || u > 1) return -1;
      if (Math.abs(y) > half) return -1;
      if (!survives(x, y, erosion, u * 0.8, seed)) return -1;
      // 上の縁（−y）の照り。下の縁は暗く
      const shine = y < -half + 1.1 ? 0.62 : y > half - 1 ? 0.3 : 0.44;
      return clamp01((shine + 0.12 * u) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: back - 1, y0: -half - 1, x1: front + 1, y1: half + 1 }, dither: 0.02 },
  );
}

/**
 * 片刃の銃剣: 根元 base → 先端 tip。背（−y）はまっすぐで先で少し落ち、刃（+y）は根元が太く先へ弧を描いて細る。
 * 刃の縁だけが白く光る（背は光らない）。根元に銃口の環（着剣の金具）の四角
 */
function bayonetBlade(frame, o) {
  const { tip, L, W } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 41;
  const base = tip - L;
  paint(
    frame,
    (x, y) => {
      const u = (x - base) / L;
      if (u < 0 || u > 1) return -1;
      // 背: 根元から 7 割まではまっすぐ、先で刃の側へ落ちて尖る
      const spine = -W * 0.45 + (u > 0.7 ? ((u - 0.7) / 0.3) ** 1.4 * W * 0.45 : 0);
      // 刃: 根元の太さから先へ弧を描いて 0 へ
      const edge = W * (1 - u ** 1.7);
      if (y < spine || y > edge) return -1;
      const span = Math.max(0.6, edge - spine);
      const q = (y - spine) / span;
      if (!survives(x, y, erosion, (1 - u) * 0.3 + 0.5, seed)) return -1;
      if (edge - y < 1.1 && erosion < 0.4) return clamp01(1.05 * bright);
      // 刃の側ほど明るい（研いだ面）。背は暗い
      return clamp01((0.38 + 0.4 * q) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: base - 1, y0: -W - 2, x1: tip + 2, y1: W + 2 } },
  );
  // 着剣の環（根元の四角。段 5）
  if (erosion < 0.6) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 2; dy++) dot(frame, base + dx - 1, dy, Math.abs(dy) === 2 ? 3 : 5);
  }
}

/** 突きの先の山形の衝撃線（apex = 頂点、len = 後ろへ開く長さ、spread = 開きの半幅） */
function bowWave(frame, o) {
  const { apex, len, spread } = o;
  for (const side of [-1, 1]) {
    streakLine(frame, { ax: apex - len, ay: side * spread, bx: apex, by: side, width: o.width ?? 1.2, bright: o.bright ?? 0.8 });
  }
}

/** 突進の尾: 背後から銃身の根元へ流れる細い速度線の束（lunge の踏み込みを見せる） */
function lungeTrail(frame, f, spec, back, k) {
  if (k > 0.85 || !spec.trail) return;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * 5 + (hash1(i, spec.seed + 60) - 0.5) * 2;
    const x1 = back + 4 - Math.abs(y) * 1.2 - hash1(i, spec.seed + 61) * 8 - k * 18;
    const len = spec.trail * (0.5 + 0.5 * hash1(i, spec.seed + 62)) * (1 - k * 0.5) * Math.min(1, (f + 1) / 2);
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
  }
}

/**
 * 銃剣の突き 1 本。spec: reach（銃剣の先の到達）, T（銃身の太さ）, L / W（銃剣の長さ・半幅）, A, N,
 * wave（山形の衝撃の大きさ）, burst（先で弾ける強さ）, trail（踏み込みの尾）, shards, seed。
 * 銃身と銃剣は一気に突き出て、崩れは銃身の根元から先へ（銃剣が最後まで残る）
 */
function bayonetThrust(frame, f, spec) {
  const { A, N, reach, seed } = spec;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const tip = BARREL_BACK + 8 + (reach - BARREL_BACK - 8) * (0.4 + 0.6 * p) + k * 3;
  const L = spec.L * (f < A ? 0.85 + 0.15 * p : 1 - k * 0.2);
  const back = BARREL_BACK + (f < A ? 0 : (tip - L - BARREL_BACK) * Math.pow(k, 0.7));
  const erosion = f < A ? 0 : 0.05 + 0.85 * Math.pow(k, 1.2);
  const bright = f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k;

  lungeTrail(frame, f, spec, back, k);
  barrel(frame, { back, front: tip - L - 2, T: spec.T * (1 - k * 0.3), erosion, bright, seed: seed + 1 });
  bayonetBlade(frame, { tip, L, W: spec.W * (1 - k * 0.3), erosion: erosion * 0.8, bright, seed: seed + 2 });

  // 平行の速度線: 銃身のすぐ外（上下 1 本ずつ）。二重線に見えないよう銃身から離し、長さを変える
  if (k < 0.8) {
    for (const side of [-1, 1]) {
      const y = side * (spec.W + 3 + k * 2);
      const x1 = tip - L - 4 - hash1(side + 2, seed + 3) * 6 - k * 14;
      const len = reach * (0.28 + 0.15 * hash1(side + 2, seed + 4)) * (1 - k * 0.6);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  const waveAge = f - (A - 1);
  if (spec.wave && waveAge >= 0 && waveAge <= 2) {
    const s = spec.wave;
    bowWave(frame, { apex: tip + 5 + waveAge * 4, len: (9 + waveAge * 4) * s, spread: (4 + waveAge * 3) * s, bright: 0.85 - waveAge * 0.22, width: s > 1.1 ? 1.6 : 1.2 });
  }
  // 重い突き: 先で前の半分へ短い棘が弾ける
  if (spec.burst && waveAge >= 0 && waveAge <= 2) {
    for (let i = 0; i < 5; i++) {
      const a = ((i / 4) * 2 - 1) * 58 * DEG + (hash1(i, seed + 20) - 0.5) * 0.12;
      const long = i % 2 === 0 ? 1 : 0.6;
      const r1 = (10 + waveAge * 7) * spec.burst * long + 4;
      const r0 = waveAge === 0 ? 3 : r1 - 8;
      streakLine(frame, { ax: tip + Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: tip + Math.cos(a) * r1, by: Math.sin(a) * r1, width: long > 0.9 ? 1.5 : 1.1, bright: 0.95 - waveAge * 0.22 });
    }
  }
  if (f === A - 1) sparkle(frame, tip - 1, 1, spec.burst ? 4 : 3);
  if (f === A) sparkle(frame, tip + 2, 0, 2);
  if (f >= A - 1 && spec.shards) {
    shards(frame, f - (A - 1), spec.shards, seed + 30, (i, rnd) => {
      const a = (rnd(1) - 0.5) * (spec.burst ? 1.4 : 0.9);
      const sp = 3 + rnd(2) * (spec.burst ? 4.5 : 3);
      return { x: tip - 2, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  return { tip, k };
}

/** 銃剣突き（thrust reach 34・重い・踏み込み 20）: 太い銃身、先で弾ける衝撃 */
const BAYONET = { reach: 68, T: 4, L: 20, W: 4.4, A: 3, N: 8, wave: 1.2, burst: 0.9, trail: 34, shards: 8, seed: 3100 };
/** 連突きの 1 本（hits 2）: 細く速い。衝撃は小さく */
const FLURRY = { reach: 68, T: 3, L: 18, W: 3.6, A: 2, N: 6, wave: 0.8, burst: 0, trail: 0, shards: 4, seed: 3200 };
/** 突き撃ち（thrust reach 34）: 突いた先で撃つ。突きは軽く、主役は先の閃光 */
const THRUST_SHOT = { reach: 68, T: 3.6, L: 18, W: 3.8, A: 3, N: 9, wave: 0, burst: 0, trail: 26, shards: 0, seed: 3300 };

/**
 * 銃剣連突き（hits 2）: 2 本の突きを時間とわずかな角度（−5° → +5°）で分ける。1 本目が引く間に 2 本目が伸びる。
 * 2 本目は少し長く伸ばし、先に山形を出す（2 発目が当たったことを見せる）
 */
function flurry(frame, f) {
  const stabs = [
    { angle: -8 * DEG, start: 0, reach: 64 },
    { angle: 8 * DEG, start: 2, reach: 70 },
  ];
  const N = 9;
  for (let i = 0; i < stabs.length; i++) {
    const s = stabs[i];
    if (!s) continue;
    const local = f - s.start;
    if (local < 0) continue;
    const last = i === stabs.length - 1;
    // 1 本目は早く崩す（2 本目と重なって見える時間を短く）
    const n = last ? N - s.start : 3;
    if (local >= n) continue;
    bayonetThrust(turned(frame, s.angle), local, { ...FLURRY, N: n, reach: s.reach, seed: FLURRY.seed + i * 50, shards: last ? 6 : 2, trail: last ? 22 : 0 });
  }
}

/**
 * 突き撃ち: 銃剣で突いた瞬間（active の終わり）に、銃剣の上から銃口が火を噴く。
 * 突き（銃身 + 銃剣）+ 銃剣の先に並ぶ前へ長い閃光 + 押し出す圧の弧 + 横へ飛ぶ薬莢
 */
function thrustShot(frame, f) {
  const spec = THRUST_SHOT;
  const { tip } = bayonetThrust(frame, f, spec);
  const age = f - (spec.A - 1);
  if (age >= 0 && age <= 2) {
    const s = age === 0 ? 1 : age === 1 ? 0.85 : 0.5;
    // 銃口は銃剣の根元の少し上（銃剣は銃口の下に付く）。閃光は銃剣の先を越えて前へ伸びる
    const mx = tip - spec.L - 1;
    spike(frame, { x: mx, y: -3, a: 0, len: 48 * s, w: 5 * s, bright: 1 });
    spike(frame, { x: mx, y: -3, a: -30 * DEG, len: 18 * s, w: 2.8 * s, bright: 0.9 });
    spike(frame, { x: mx, y: -3, a: 30 * DEG, len: 14 * s, w: 2.4 * s, bright: 0.85 });
    spike(frame, { x: mx, y: -3, a: -90 * DEG, len: 9 * s, w: 2.4 * s, bright: 0.8 });
    flashCore(frame, mx, -3, 5.5 * s, 1);
    if (age === 0) sparkle(frame, mx, -3, 3);
  }
  if (age >= 1 && age <= 4) {
    const a2 = age - 1;
    frontArc(frame, { ox: tip + 6 + a2 * 5, radius: 6 + a2 * 3.5, width: 2, squash: 0.45, spread: 70 * DEG, erosion: Math.min(0.9, a2 * 0.25), bright: 0.75 - a2 * 0.12, seed: 3311 });
  }
  ejectCasing(frame, age, { x: tip - spec.L - 22, y: 5, side: 3, back: 1.5, fall: 0.4, spin: 1, life: 5 });
  if (age >= 2) {
    // 銃口に残る煙の粒（段 2〜3）
    for (let i = 0; i < 4; i++) {
      if (hash1(i + age * 5, 3312) < (age - 2) / 6) continue;
      dot(frame, tip - 8 + hash1(i, 3313) * 16 + age * 2, -4 - hash1(i, 3314) * 5 - age, 3);
    }
  }
}

// -----------------------------------------------------------------------------
// 銃床の打撃（鈍い。白い縁を持たない）
// -----------------------------------------------------------------------------

/**
 * 銃床打ち（arc 160° reach 24・重い、原点 = 自分）: 銃を回して銃床を横薙ぎに叩きつける。
 * 厚く鈍い帯（白い縁なし・木目の筋）が −80° → +80° へ振られ、帯の先は四角く切れる（銃床の底）。
 * 振り切った所で角ばった衝撃の星と破片
 */
function stockStrike(frame, f) {
  const A = 3;
  const N = 8;
  const R = 50;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const from = -80 * DEG;
  const head = from + 160 * DEG * p + k * 8 * DEG;
  const span = (f < A ? 70 + 50 * p : 120 - 60 * k) * DEG;
  const T = 17 * (1 - k * 0.5);
  if (k < 0.9) {
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (r > R || r < R - T - 1) return -1;
        let s = head - Math.atan2(y, x);
        if (s < -0.02) s += TAU;
        if (s < 0 || s > span) return -1;
        const u = s / span;
        // 帯の先は四角く（先端で細らない）、尾へ向けて細る
        const w = T * (u < 0.12 ? 1 : (1 - (u - 0.12) / 0.88) ** 0.8);
        const q = (R - r) / Math.max(0.6, w);
        if (q > 1) return -1;
        if (!survives(x, y, k * 1.05 + u * 0.2, (1 - q) * (1 - u), 3411)) return -1;
        // 先端の面（銃床の底）だけ段 6、外縁は段 5 まで。木目の筋で塊のべた塗りを崩す
        if (s < 3.5 / R && k < 0.4) return 0.8;
        const grain = 0.8 + 0.3 * hash1(Math.floor((R - r) / 2.2), 3412);
        return clamp01((1 - q * 0.6) * (0.7 - 0.4 * u) * grain * (1 - k * 0.35));
      },
      { bounds: { x0: -R - 1, y0: -R - 1, x1: R + 1, y1: R + 1 } },
    );
  }
  // 振り切った所（+60° 前後）で叩きつけた衝撃
  const hitA = from + 160 * DEG * 0.85;
  const hx = Math.cos(hitA) * (R - 8);
  const hy = Math.sin(hitA) * (R - 8);
  if (f === A - 1) {
    bluntStar(frame, { x: hx, y: hy, R: 15, n: 7, seed: 3413, w: 3, core: 4.5 });
    sparkle(frame, hx, hy, 3);
  } else if (f >= A && f <= A + 1) {
    bluntStar(frame, { x: hx, y: hy, R: 17, n: 7, seed: 3413, w: 2.6, core: 3 * (1 - k), bright: 0.85 - k * 0.3, erosion: Math.min(0.9, k * 1.6) });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 9, 3414, (i, rnd) => {
      const a = hitA + Math.PI / 2 + (rnd(1) - 0.6) * 1.8;
      const sp = 3 + rnd(2) * 3;
      return { x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 2, drag: 0.8 };
    });
  }
}

/**
 * 銃床殴打（box reach 14 size 24・重い、原点 = 当たりの中心 = 自分から 28 ドット先）:
 * 銃を縦に構え、銃床の底（平たい四角い板）を前へまっすぐ打ち込む。板の前の面が段 6、
 * 当たると面に沿う平たい閃き（縦のレンズ）と、前へ押し出す潰れた弧、前へ飛ぶ破片
 */
function stockBash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const face = -18 + 20 * p + k * 3;
  const depth = 12;
  const H = 12 * (1 - k * 0.3);
  if (k < 0.85) {
    paint(
      frame,
      (x, y) => {
        // 板: 前の面から後ろへ depth。後ろへ向けて上下が少し狭まる（銃床の底から首へ）
        const b = face - x;
        if (b < 0 || b > depth) return -1;
        const hw = H * (1 - (b / depth) * 0.35);
        if (Math.abs(y) > hw) return -1;
        if (!survives(x, y, k * 1.1, (1 - b / depth) * 0.8, 3511)) return -1;
        if (b < 1.6 && k < 0.5) return 0.82 - (Math.abs(y) / hw) * 0.12;
        const grain = 0.8 + 0.3 * hash1(Math.floor((y + 40) / 2), 3512);
        return clamp01((0.62 - (b / depth) * 0.3) * grain * (1 - k * 0.3));
      },
      { bounds: { x0: face - depth - 1, y0: -H - 1, x1: face + 1, y1: H + 1 } },
    );
    // 首（銃床から後ろへ伸びる銃の本体）: 細い暗い棒
    if (k < 0.5) streakLine(frame, { ax: face - depth - 18, ay: 0, bx: face - depth, by: 0, width: 3, bright: 0.38 * (1 - k) });
  }
  // 打ち込みの速度線（板の上下の外を後ろへ）
  if (k < 0.7) {
    for (const side of [-1, 1]) {
      const y = side * (H + 3 + k * 3);
      const x1 = face - 4 - k * 12;
      streakLine(frame, { ax: x1 - 18 * (1 - k * 0.5), ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 1) {
      // 面の閃き: 板の前の面に沿う縦の平たいレンズ（平たい物が当たった形）
      lens(frame, { ax: face + 1, ay: -H - 6, bx: face + 1, by: H + 6, T: age === 0 ? 4 : 2.6, bias: 0, bright: 0.95 });
      if (age === 0) sparkle(frame, face + 1, 0, 3);
    }
    frontArc(frame, { ox: face + 2 + age * 3, radius: 8 + age * 5, width: 2.6 - age * 0.25, squash: 0.45, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.1, seed: 3513 });
    shards(frame, age, 10, 3514, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.6;
      const sp = 3 + rnd(2) * 3.5;
      return { x: face + 1, y: (rnd(3) - 0.5) * H * 1.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
    });
  }
}

// -----------------------------------------------------------------------------
// 銃剣の薙ぎ・ダッシュ
// -----------------------------------------------------------------------------

/**
 * 銃剣払い（arc 200° reach 28、原点 = 自分）: 長い銃の先の銃剣が大きく弧を描く。刃は銃剣 1 本なので、
 * 斬線は細く長い 1 本の三日月（外縁が白い刃）。先端に銃剣の光点、外側に沿う速度線。
 * 剣より細く、振り幅が広い（銃の長さで先だけが速く走る）
 */
function bayonetSweep(frame, f) {
  const A = 4;
  const N = 9;
  const R = 58;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const from = -100 * DEG;
  const head = from + 200 * DEG * p + k * 12 * DEG;
  const tail = f < A ? from + (head - from) * 0.05 : head - (200 - 150 * k) * DEG * (1 - k * 0.3);
  crescent(frame, { R, T: 8 * (1 - k * 0.4), head, tail: Math.min(tail, head - 0.2), peak: 0.1, erosion: k * 1.05, streak: 0.3, seed: 3611, edge: 1.4, edgeReach: 0.5 });
  // 外側に沿う速度線（刃の 3 ドット外。先端寄りの 1/3 だけ）
  if (k < 0.5) {
    const r = R + 3;
    const len = 26 * DEG * (1 - k);
    paint(
      frame,
      (x, y) => {
        if (Math.abs(Math.hypot(x, y) - r) > 0.6) return -1;
        let s = head - 0.1 - Math.atan2(y, x);
        if (s < 0) s += TAU;
        if (s > len) return -1;
        return 0.42 * (1 - s / len);
      },
      { bounds: { x0: -r - 2, y0: -r - 2, x1: r + 2, y1: r + 2 }, dither: 0, samples: 2 },
    );
  }
  if (f < A) sparkle(frame, Math.cos(head) * (R - 2), Math.sin(head) * (R - 2), f === A - 1 ? 3 : 2);
  if (f >= A - 1) {
    // 刃の通り道から外へ弾かれる刃片
    shards(frame, f - (A - 1), 8, 3612, (i, rnd) => {
      const a = from + 200 * DEG * (0.3 + 0.7 * rnd(1));
      const sp = 2 + rnd(2) * 2.5;
      return { x: Math.cos(a) * (R - 3), y: Math.sin(a) * (R - 3), vx: (Math.cos(a) - Math.sin(a) * 0.6) * sp, vy: (Math.sin(a) + Math.cos(a) * 0.6) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * ダッシュ攻撃（arc 160° reach 24、原点 = 自分）: 銃を横に構えて体ごとぶつかる。
 * 前（+x）に銃身の横棒（前へ少し反る厚い帯。白い縁なし）が押し出され、前の面の外に押し出す圧の弧、
 * 後ろへ流れる速度線の束。刃の弧ではなく「横に構えた長い棒」で見分ける
 */
function dashBash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const X = 22 + 16 * p + k * 6;
  const H = 34 * (0.75 + 0.25 * p) * (1 - k * 0.2);
  const T = 7 * (1 - k * 0.5);
  if (k < 0.9) {
    paint(
      frame,
      (x, y) => {
        const v = y / H;
        if (Math.abs(v) > 1) return -1;
        // 前へ反る（中央が前、両端が後ろ）
        const cx = X - (v * v) * 8;
        const d = cx - x;
        const w = T * (1 - Math.abs(v) ** 3 * 0.6);
        if (d < 0 || d > w) return -1;
        const q = d / w;
        if (!survives(x, y, k * 1.05 + Math.abs(v) * 0.25, (1 - q) * (1 - Math.abs(v)), 3711)) return -1;
        if (q < 0.25 && k < 0.5) return 0.8 - Math.abs(v) * 0.2;
        return clamp01((0.62 - q * 0.3) * (1 - Math.abs(v) * 0.35) * (1 - k * 0.35));
      },
      { bounds: { x0: X - 18, y0: -H - 1, x1: X + 1, y1: H + 1 } },
    );
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    frontArc(frame, { ox: X + 2 + age * 3, radius: 14 + age * 5, width: 2.4 - age * 0.3, squash: 0.4, spread: 75 * DEG, erosion: Math.min(0.9, age * 0.22), bright: 0.75 - age * 0.1, seed: 3712 });
    if (age === 0) sparkle(frame, X + 1, 0, 3);
    shards(frame, age, 9, 3713, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.8;
      const sp = 3 + rnd(2) * 3;
      return { x: X, y: (rnd(3) - 0.5) * H * 1.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  // 速度線: 帯の後ろから −x へ（帯の厚みの外）
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 11 + (hash1(i, 3714) - 0.5) * 4;
      const v = y / H;
      const x1 = X - (v * v) * 8 - T - 4 - k * 12;
      const len = (18 + 16 * hash1(i, 3715)) * (1 - k * 0.5);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.48 * (1 - k) });
    }
  }
}

// -----------------------------------------------------------------------------
// 貫き撃ち（その場で撃つ派生。circle size 20、原点 = 自分）
// -----------------------------------------------------------------------------

/** 長い銃の銃口（自分の中心から前へ。キャラ 48 ドットの縁のかなり外） */
const LONG_MUZZLE = 30;

/**
 * 貫き撃ち: 腰を落として 1 発。銃口から前へ細く長い針の閃光が突き抜け（貫く弾の予告）、
 * 反動で後ろ（−x）へ短い衝撃の筋が押し戻される。横へ長い薬莢、銃口に煙の粒
 */
function pierceShot(frame, f) {
  const N = 8;
  const X = LONG_MUZZLE;
  if (f <= 2) {
    const s = f === 0 ? 0.8 : f === 1 ? 1 : 0.6;
    spike(frame, { x: X - 2, a: 0, len: 48 * s, w: 2.8 * s, bright: 1 });
    spike(frame, { x: X - 2, a: 90 * DEG, len: 6 * s, w: 1.8 * s, bright: 0.8 });
    spike(frame, { x: X - 2, a: -90 * DEG, len: 6 * s, w: 1.8 * s, bright: 0.8 });
    flashCore(frame, X - 2, 0, 3.5 * s, 1);
    if (f === 1) sparkle(frame, X + 30, 0, 2);
  }
  // 前へ抜ける細い筋（針の先をさらに越える 1 本。貫く）
  if (f >= 1 && f <= 4) {
    const a = f - 1;
    streakLine(frame, { ax: X + 24 + a * 8, ay: 0, bx: X + 42 + a * 8, by: 0, bright: 0.8 - a * 0.18 });
  }
  // 反動: 自分の後ろへ押し戻される短い山形（銃床が肩を押す）
  if (f >= 1 && f <= 3) {
    const a = f - 1;
    for (const side of [-1, 1]) {
      streakLine(frame, { ax: -14 - a * 3, ay: side * (6 + a * 2), bx: -22 - a * 4, by: side * (12 + a * 3), bright: 0.6 - a * 0.15 });
    }
  }
  ejectCasing(frame, f - 1, { x: 6, y: 8, side: 2.6, back: 1.2, fall: 0.3, spin: 2, life: 5 });
  if (f >= 3) {
    for (let i = 0; i < 4; i++) {
      if (hash1(i + f * 3, 3811) < (f - 3) / (N - 2)) continue;
      dot(frame, X + hash1(i, 3812) * 8, (hash1(i, 3813) - 0.5) * 8 - (f - 3), 3);
    }
  }
}

// -----------------------------------------------------------------------------
// 近接の命中
// -----------------------------------------------------------------------------

/**
 * 命中（軽い）: 銃剣が刺さった形。+x に沿う細い裂け目（レンズ）と、前の細い円錐へ抜ける火花、小さな縦長の輪
 */
function meleeHit(frame, f) {
  if (f <= 1) {
    lens(frame, { ax: -12, ay: 0, bx: 16, by: 0, T: f === 0 ? 4.4 : 3, bias: 0.2, bright: 1 });
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1 && f <= 3) ring(frame, { ox: 2, radius: 5 + (f - 1) * 3.5, width: 1.6, squash: 0.4, erosion: Math.min(0.9, (f - 1) * 0.3), bright: 0.75 - f * 0.1, seed: 3911 });
  shards(frame, f, 8, 3912, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.1;
    const sp = 3 + rnd(2) * 3;
    return { x: 4, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
  });
}

/**
 * 命中（重い）: 銃床の重い打撃。角ばった衝撃の星（白は芯だけ）が 2 フレームで欠け、潰れた輪 1 本と、
 * 前へ多く飛ぶ角ばった破片
 */
function meleeHitHeavy(frame, f) {
  const R = 22;
  if (f <= 1) {
    bluntStar(frame, { R: R * (f === 0 ? 0.8 : 1), n: 8, seed: 3921, w: 3.4, core: 5.5 });
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  } else if (f === 2) {
    bluntStar(frame, { R, n: 8, seed: 3921, w: 2.4, core: 0.1, bright: 0.75, erosion: 0.6 });
  }
  if (f >= 2) {
    const age = f - 1;
    ring(frame, { radius: 10 + age * 6, width: 3.2, squash: 0.65, erosion: Math.min(0.92, age * 0.24), bright: 0.8 - age * 0.1, seed: 3922 });
  }
  shards(frame, f - 1, 16, 3923, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.4 : 3.6);
    const sp = 4 + rnd(3) * 4;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
}

// =============================================================================
// 弾
// =============================================================================

// -----------------------------------------------------------------------------
// 小銃（rifle）: 長く鋭い曳光・大きな閃光と銃口の制退器の横噴き
// -----------------------------------------------------------------------------

/** 小銃の曳光: 針のように細長い弾頭と、長く細い尾（450px/秒 → 36 ドットより少し長く）。尾の途中に火の粉 1 つ */
function rifleFly(frame, f) {
  const len = 44 * (1 + (hash1(f, 4101) - 0.5) * 0.1);
  const H = 1.7;
  const head = 8;
  paint(
    frame,
    (x, y) => {
      if (x > head + 1 || x < -len) return -1;
      let v = -1;
      if (x >= -3) {
        // 弾頭: 前へ鋭く尖る細長い形
        const u = x < 0 ? 0 : x / head;
        const hw = x < 0 ? H : H * (1 - u ** 1.3);
        if (Math.abs(y) <= hw + 0.2) v = clamp01((1 - Math.abs(y) / (hw + 0.2)) ** 0.5 * (1.1 - 0.35 * u));
      }
      if (x < 0) {
        const u = -x / len;
        const hw = 1.1 * (1 - u) ** 0.5 + 0.3;
        if (Math.abs(y) <= hw) v = Math.max(v, clamp01((1 - Math.abs(y) / hw) ** 0.6 * 0.76 * (1 - u) ** 1.2 + 0.08));
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -H - 2, x1: head + 2, y1: H + 2 }, dither: 0.03 },
  );
  const ex = -len * (0.4 + 0.45 * hash1(f, 4102));
  dot(frame, ex, (hash1(f, 4103) > 0.5 ? 1 : -1) * 2.2, 4);
}

/**
 * 小銃の銃口: 大きな閃光。前へ長く太い針 + 斜め前の 2 本、銃口の制退器（原点の少し後ろ）から
 * 真横へ噴く平たい炎の 2 本。前へ押し出す大きな圧の弧、消えぎわの火の粉と煙の粒
 */
function rifleMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 0.9 : f === 1 ? 1 : 0.6;
    spike(frame, { x: -2, a: 0, len: 40 * s, w: 5 * s, bright: 1 });
    spike(frame, { x: -2, a: 22 * DEG, len: 16 * s, w: 2.4 * s, bright: 0.9 });
    spike(frame, { x: -2, a: -22 * DEG, len: 16 * s, w: 2.4 * s, bright: 0.9 });
    // 制退器の横噴き: 真横からわずかに後ろへ寝かせた平たい炎
    for (const side of [-1, 1]) {
      spike(frame, { x: -5, y: side * 2, a: side * 96 * DEG, len: 14 * s, w: 3.2 * s, bright: 0.9 });
      spike(frame, { x: -5, y: side * 2, a: side * 112 * DEG, len: 8 * s, w: 1.6 * s, bright: 0.7 });
    }
    flashCore(frame, -2, 0, 5 * s, 1);
    if (f <= 1) sparkle(frame, -1, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 18 + age * 6, radius: 8 + age * 4, width: 2.4, squash: 0.45, erosion: Math.min(0.9, k * 0.85), bright: 0.75 - k * 0.3, seed: 4111 });
  }
  if (f >= 2) {
    shards(frame, f - 2, 7, 4112, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 0.9;
      const sp = 3 + rnd(2) * 3.5;
      return { x: 14 + rnd(3) * 10, y: (rnd(4) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(5) * 2), size: 1 };
    });
    // 制退器の横から昇る煙の粒
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      dot(frame, -5 + hash1(i, 4113) * 4, side * (8 + (f - 2) * 3 + hash1(i, 4114) * 3), 3 - (f > 4 ? 1 : 0));
    }
  }
}

/**
 * 金属の弾の着弾（小銃）: 当たった面の平たい閃きと、後ろの半球へ跳ね返る火花。s で大きさ
 */
function metalImpact(frame, f, s, seed) {
  const N = 7;
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -10 * s, bx: -1, by: 10 * s, T: (f === 0 ? 4.2 : 2.6) * s, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 10 * s, w: 2.4 * s, bright: 1 });
    flashCore(frame, 0, 0, 3 * s, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  shards(frame, f, 10, seed, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 3.6 * s * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.35 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 1 && f <= 3) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI + (hash1(i, seed + 1) - 0.5) * 1.8;
      const r0 = 3 + f * 3 * s;
      const r1 = r0 + 6 * s;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.75 * (1 - f / N) });
    }
  }
  if (f >= 2) {
    for (let i = 0; i < 3; i++) {
      if (hash1(i + f * 3, seed + 2) < (f - 2) / (N - 2)) continue;
      dot(frame, -1 - hash1(i, seed + 3) * 2, (hash1(i, seed + 4) - 0.5) * 6 * s, 3);
    }
  }
}

/**
 * 小銃の命中（貫く）: 敵の体を抜ける。当たった所の縦長の輪と、前（抜けた側）へ伸びる細い光と破片の円錐
 */
function rifleHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -4, a: 0, len: 22, w: 2.6, bright: 1 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 6, w: 1.8, bright: 0.8 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 6, w: 1.8, bright: 0.8 });
    flashCore(frame, -2, 0, 3, 1);
    if (f === 0) sparkle(frame, -2, 0, 3);
  }
  if (f >= 1 && f <= 4) {
    const a = f - 1;
    streakLine(frame, { ax: 10 + a * 6, ay: 0, bx: 24 + a * 8, by: 0, bright: 0.85 - a * 0.2 });
  }
  if (f <= 3) ring(frame, { ox: 0, radius: 5 + f * 3, width: 1.8, squash: 0.35, erosion: Math.min(0.9, f * 0.25), bright: 0.8 - f * 0.12, seed: 4121 });
  shards(frame, f, 10, 4122, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.1;
    const sp = 3.5 + rnd(2) * 3.5;
    return { x: 3, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
}

/** 尽きた（射程の端）: dirs 1。燃え残りの火の粉と、画面の上へ昇って切れる細い煙 */
function gunFizzle(frame, f, o) {
  const N = 7;
  const age = f / (N - 1);
  if (f === 0) {
    dot(frame, 0, 0, 6);
    dot(frame, 1, 0, 5);
    dot(frame, 0, 1, 5);
    dot(frame, 1, 1, 4);
  } else if (f <= 3) dot(frame, 0, -f * 0.8, Math.max(3, 6 - f));
  smokeWisp(frame, { x0: 0, y0: -1, height: o.height + f * 2.5, width: o.width + age * 0.6, age, seed: o.seed, sway: 3.2, lean: 2, rise: 7, bright: o.bright ?? 0.33 });
}

// -----------------------------------------------------------------------------
// 電磁砲（railgun）: 一直線の光条・放電の枝
// -----------------------------------------------------------------------------

/**
 * 電磁砲の弾: 太さの変わらない一直線の光条（尾は細らずに途中で切れる）と、先の小さな光の粒。
 * 光条の横から放電の短い枝がフレームごとに違う所で走る。曳光の「細る尾」と形で見分ける
 */
function railFly(frame, f) {
  const len = 50;
  paint(
    frame,
    (x, y) => {
      if (x > 4 || x < -len) return -1;
      const ay = Math.abs(y);
      // 先の粒（半径 2.4）
      const d = Math.hypot(x - 1, y);
      if (d <= 2.6) return clamp01(1.1 - d * 0.18);
      // 光条: 芯 1 ドット（段 6）+ 外の光（段 3）。尾の端 1/4 だけ薄れる
      const u = -x / len;
      const fade = u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1;
      if (ay <= 0.7) return clamp01(0.78 * fade + 0.05);
      if (ay <= 2) return clamp01(0.36 * fade);
      return -1;
    },
    { bounds: { x0: -len - 1, y0: -4, x1: 5, y1: 4 }, dither: 0 },
  );
  // 放電の枝: 2 本。フレームごとに位置・向き・長さが変わる（瞬き）
  for (let i = 0; i < 2; i++) {
    const x = -8 - hash1(i + f * 3, 4201) * 34;
    const side = hash1(i + f * 5, 4202) > 0.5 ? 1 : -1;
    const a = side * (70 + 50 * hash1(i + f * 7, 4203)) * DEG;
    zigzag(frame, { x, y: side * 1.5, a, len: 5 + 4 * hash1(i + f, 4204), segs: 3, seed: 4205 + i + f * 11, bright: 0.72, jag: 1.6 });
  }
}

/**
 * 電磁砲の銃口: 上下 2 本のレール（平行の明るい線）の間で光が走り、前へ細い光条が突き抜ける。
 * レールの先から外へ放電の枝が弾け、原点に縦長の閃き。火の閃光（針の星）を使わない
 */
function railMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  const RAIL = 6;
  if (f <= 3) {
    const b = 1 - k * 0.8;
    for (const side of [-1, 1]) streakLine(frame, { ax: -14, ay: side * RAIL, bx: 4, by: side * RAIL, width: 1.6, bright: 0.85 * b });
  }
  if (f <= 1) {
    // レールの間を走る光（原点の手前で縦に潰れたレンズ）
    lens(frame, { ax: -14, ay: 0, bx: 6, by: 0, T: RAIL * 1.6, bias: 0, bright: f === 0 ? 0.9 : 0.75 });
    lens(frame, { ax: 0, ay: -RAIL - 3, bx: 0, by: RAIL + 3, T: 3, bias: 0, bright: 0.95 });
    sparkle(frame, 2, 0, f === 0 ? 3 : 4);
  }
  // 前へ突き抜ける光条（1 本の細い線。フレームごとに前へ伸びて細る）
  if (f <= 3) {
    const x1 = 30 + f * 14;
    streakLine(frame, { ax: 4 + f * 6, ay: 0, bx: x1, by: 0, width: f <= 1 ? 2 : 1, bright: 0.95 - f * 0.18 });
  }
  // レールの先から外へ弾ける放電の枝（フレームごとに違う形）
  if (f <= 4) {
    for (const side of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const a = side * (35 + 40 * j + 15 * hash1(j + f * 3 + side, 4211)) * DEG;
        zigzag(frame, { x: 4, y: side * RAIL, a, len: (9 + 6 * hash1(j + f, 4212)) * (1 - k * 0.4), segs: 3, seed: 4213 + j * 7 + f * 13 + (side > 0 ? 1 : 0), bright: 0.85 - k * 0.4, jag: 2 });
      }
    }
  }
  if (f >= 3) {
    for (let i = 0; i < 5; i++) {
      if (hash1(i + f * 3, 4214) < (f - 3) / 3) continue;
      dot(frame, -10 + hash1(i, 4215) * 30, (hash1(i, 4216) - 0.5) * 18, 4);
    }
  }
}

/** 電磁砲の着弾: 当たった所から全方向へ放電の枝が走り（後ろの半球に多く）、枝の先で子の枝が分かれる */
function railImpact(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 1) {
    flashCore(frame, 0, 0, f === 0 ? 5 : 3.5, 1);
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
    lens(frame, { ax: -1, ay: -9, bx: -1, by: 9, T: 3, bias: 0, bright: 0.9 });
  }
  if (f <= 4) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + ((i / (n - 1)) * 2 - 1) * 105 * DEG + (hash1(i + f * 3, 4221) - 0.5) * 0.4;
      const len = (10 + 8 * hash1(i, 4222)) * (0.7 + 0.3 * Math.min(1, f)) * (1 - k * 0.3);
      const end = zigzag(frame, { x: Math.cos(a) * 2, y: Math.sin(a) * 2, a, len, segs: 4, seed: 4223 + i * 5 + f * 17, bright: 0.95 - k * 0.5, jag: 2.2 });
      if (i % 2 === 0 && f >= 1) zigzag(frame, { x: end.x, y: end.y, a: a + (hash1(i, 4224) > 0.5 ? 0.7 : -0.7), len: 6, segs: 2, seed: 4225 + i + f * 7, bright: 0.7 - k * 0.4, jag: 1.6 });
    }
  }
  if (f >= 3) {
    for (let i = 0; i < 6; i++) {
      if (hash1(i + f * 3, 4226) < (f - 3) / 4) continue;
      const a = hash1(i, 4227) * TAU;
      const r = 8 + hash1(i, 4228) * 14 + f * 2;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, 4);
    }
  }
}

/** 電磁砲の命中（貫く）: 敵の体を光条がまっすぐ抜け、抜けた所の縦長の輪と、光条の横へ走る短い放電 */
function railHit(frame, f) {
  const k = f / 5;
  if (f <= 2) {
    streakLine(frame, { ax: -18, ay: 0, bx: 30 + f * 8, by: 0, width: f === 0 ? 2.4 : 1.4, bright: 0.95 - f * 0.15 });
    if (f === 0) {
      flashCore(frame, 0, 0, 4, 1);
      sparkle(frame, 0, 0, 3);
    }
  }
  if (f <= 3) ring(frame, { radius: 5 + f * 3.5, width: 1.8, squash: 0.35, erosion: Math.min(0.9, f * 0.25), bright: 0.8 - f * 0.12, seed: 4231 });
  if (f <= 4) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = -10 + i * 8 + (hash1(i + f, 4232) - 0.5) * 4;
      zigzag(frame, { x, y: 0, a: side * (60 + 40 * hash1(i + f * 3, 4233)) * DEG, len: 7 + 4 * hash1(i, 4234), segs: 3, seed: 4235 + i + f * 9, bright: 0.85 - k * 0.5, jag: 1.8 });
    }
  }
}

/** 電磁砲の尽きた: 光の粒がほどけて、短い放電のかけらが外へ散って消える */
function railFizzle(frame, f) {
  const k = f / 6;
  if (f <= 1) flashCore(frame, 0, 0, 2.6 - f, 1);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + hash1(i, 4241);
    const r = 2 + f * 2.5;
    if (hash1(i + f * 5, 4242) < k * 0.8) continue;
    zigzag(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, a, len: 4 + 2 * (1 - k), segs: 2, seed: 4243 + i + f * 7, bright: 0.8 - k * 0.5, jag: 1.4 });
  }
}

// -----------------------------------------------------------------------------
// 弩・三連弩: 矢羽根のあるボルト
// -----------------------------------------------------------------------------

/** 弩のボルトの数値: shaft = 矢柄の長さ、head / headW = 鏃、fletch = 矢羽根の長さ・幅、trail = 後ろの細い風の筋 */
const BOLTS = {
  crossbow: { shaft: 26, head: 8, headW: 2.8, fletch: 7, fletchW: 3.2, trail: 16, seed: 4300 },
  tripleCrossbow: { shaft: 15, head: 5, headW: 2, fletch: 4, fletchW: 2.2, trail: 8, seed: 4400 },
};

/**
 * ボルト（飛んでいる矢）: 原点 = 鏃の根元の少し後ろ、+x = 進む向き。三角の鏃（前の 2 辺が明るく、先の 1 ドットだけ白）、
 * 細い矢柄（段 4）、後ろ（−x）の矢羽根（後ろへ開く 2 枚の小さな三角。フレームごとに小さく震える）、羽根の後ろの細い風の筋
 */
function boltFly(frame, f, b, erosion = 0, bright = 1) {
  const tipX = b.head;
  const tail = -b.shaft;
  const quiver = (f % 2 === 0 ? 0 : 0.5) * (erosion > 0 ? 0 : 1);
  paint(
    frame,
    (x, y) => {
      const ay = Math.abs(y);
      // 鏃
      if (x >= 0 && x <= tipX) {
        const hw = b.headW * (1 - x / tipX);
        if (ay <= hw + 0.3) {
          if (!survives(x, y, erosion, 0.8, b.seed + 1)) return -1;
          const edge = hw + 0.3 - ay < 1 ? 0.2 : 0;
          return clamp01((0.62 + 0.35 * (x / tipX) + edge) * bright);
        }
      }
      // 矢柄
      if (x < 0.5 && x >= tail && ay <= 0.65) {
        if (!survives(x, y, erosion, 0.3, b.seed + 2)) return -1;
        return clamp01(0.5 * bright);
      }
      // 矢羽根: 後ろへ開く細い羽 2 枚（塗りの塊にせず、斜めの 1 ドット半の帯）
      const u = (x - tail) / b.fletch;
      if (u >= -0.15 && u <= 1) {
        const line = 0.7 + (b.fletchW + quiver) * (1 - u);
        if (Math.abs(ay - line) <= 0.75) {
          if (!survives(x, y, erosion, 0.1, b.seed + 3)) return -1;
          return clamp01((0.42 + 0.14 * (1 - u)) * bright);
        }
      }
      return -1;
    },
    { bounds: { x0: tail - 1, y0: -b.fletchW - 3, x1: tipX + 1, y1: b.fletchW + 3 }, dither: 0 },
  );
  if (erosion <= 0) {
    dot(frame, tipX - 0.5, 0, 7);
    // 羽根の後ろの風の筋（上下 1 本ずつ。長さをフレームで少し変える）
    for (const side of [-1, 1]) {
      const len = b.trail * (0.7 + 0.3 * hash1(f + side, b.seed + 4));
      streakLine(frame, { ax: tail - 2 - len, ay: side * 1.6, bx: tail - 2, by: side * 1.6, bright: 0.3 });
    }
  }
}

/**
 * 弦の音（弩の発射）: 原点の後ろにある弦が、前へ引かれた V 字からまっすぐに戻って震える。火も閃光も出ない。
 * 前へ小さな空気の圧の弧と、弦の端から散る小さな粒。size = 弦の半長
 */
function stringSnap(frame, f, o) {
  const { half, back, seed } = o;
  const k = f / 4;
  // 弦の曲がり: 0 = 前へ引かれた V（弦が矢を押し出す瞬間）→ 1 = まっすぐ → 2〜3 = 後ろへ跳ね返って震える
  const bends = [6, 0, -3, 1.5, 0];
  const bend = (bends[f] ?? 0) * (half / 16);
  if (f <= 3) {
    const bright = 0.9 - k * 0.5;
    streakLine(frame, { ax: -back, ay: -half, bx: -back + bend, by: 0, width: 1.2, bright });
    streakLine(frame, { ax: -back, ay: half, bx: -back + bend, by: 0, width: 1.2, bright });
    // 弦の両端（弓の先）の小さな点
    dot(frame, -back - 1, -half - 1, 4);
    dot(frame, -back - 1, half + 1, 4);
  }
  if (f === 0) sparkle(frame, -back + bend, 0, 2);
  if (f >= 1 && f <= 3) {
    const age = f - 1;
    frontArc(frame, { ox: 2 + age * 4, radius: half * 0.35 + age * 3, width: 1.6, squash: 0.45, spread: 60 * DEG, erosion: Math.min(0.9, age * 0.3), bright: 0.6 - age * 0.12, seed });
  }
  shards(frame, f - 1, 4, seed + 1, (i, rnd) => {
    const side = i % 2 === 0 ? 1 : -1;
    const a = side * (70 + rnd(1) * 50) * DEG;
    const sp = 1.5 + rnd(2) * 1.5;
    return { x: -back, y: side * half, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
  });
}

/**
 * ボルトの着弾（壁に刺さる・弾かれる）: 鈍い平たい衝撃（小さな縦のレンズ）と、後ろへ跳ねる木の破片（2 ドットの棒）、
 * 少し遅れて舞う埃の粒。火花を使わない
 */
function boltImpact(frame, f, s, seed) {
  if (f <= 1) {
    lens(frame, { ax: 0, ay: -7 * s, bx: 0, by: 7 * s, T: (f === 0 ? 3 : 2) * s, bias: 0, bright: 0.85 });
    if (f === 0) sparkle(frame, 0, 0, 2);
  }
  // 木の破片: 後ろの扇へ、長めの棒が回りながら飛ぶ
  shards(frame, f, Math.round(7 * s), seed, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.2;
    const sp = (2.2 + rnd(2) * 2.5) * s;
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.78, bright: 0.7 };
  });
  // 刺さった所に残る矢柄の短い影（段 3。すぐ崩れる）
  if (f <= 3) streakLine(frame, { ax: -10 * s + f * 1.5, ay: 0, bx: -1, by: 0, width: 1, bright: 0.42 - f * 0.08 });
  if (f >= 2) {
    for (let i = 0; i < 5; i++) {
      if (hash1(i + f * 3, seed + 1) < (f - 2) / 5) continue;
      dot(frame, -3 - hash1(i, seed + 2) * 8, (hash1(i, seed + 3) - 0.5) * 12 * s - (f - 2), 2);
    }
  }
}

/** ボルトの命中: 深く刺さる短い裂け目（前へ尖るレンズ）と、前の細い円錐へ抜ける小さな粒、小さな縦長の輪 */
function boltHit(frame, f, s, seed) {
  if (f <= 1) {
    lens(frame, { ax: -8 * s, ay: 0, bx: 12 * s, by: 0, T: (f === 0 ? 3.4 : 2.4) * s, bias: 0.3, bright: 1 });
    if (f === 0) sparkle(frame, 0, 0, 2);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: (4 + (f - 1) * 3) * s, width: 1.5, squash: 0.4, erosion: Math.min(0.9, (f - 1) * 0.3), bright: 0.7 - f * 0.1, seed: seed + 1 });
  shards(frame, f, Math.round(7 * s), seed + 2, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 0.9;
    const sp = (2.5 + rnd(2) * 2.5) * s;
    return { x: 4, y: (rnd(3) - 0.5) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** ボルトの尽きた: 勢いを失ったボルトが少し前へ滑りながら崩れ、足元に埃が立つ */
function boltFizzle(frame, f, b) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 4) {
    const slide = 6 * (1 - (1 - k) ** 2);
    boltFly(turned(frame, 0, slide, 0), 0, b, 0.15 + k * 0.9, 0.85 - k * 0.3);
  }
  shards(frame, f - 1, 5, b.seed + 9, (i, rnd) => {
    const a = (rnd(1) - 0.5) * TAU;
    const sp = 1 + rnd(2) * 1.4;
    return { x: 2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: 1, bright: 0.5 };
  });
}

// -----------------------------------------------------------------------------
// 火縄銃・手砲: 火の弾と黒煙
// -----------------------------------------------------------------------------

/**
 * 火の弾: 丸い芯（白は中心の数ドット）と、後ろ（−x）へ揺れて細る炎の尾。尾は valueNoise を f でずらして
 * 毎フレームゆらぐ。o.smoke があれば尾の外側に太い煙の尾（段 1〜2）を足す（手砲）
 */
function fireBall(frame, f, o) {
  const { r, tail, seed } = o;
  const tw = o.tailW ?? r;
  const phase = f * 5.3;
  // 煙の尾（手砲だけ）: 炎の尾より太く長い、段 1〜2 のもや
  if (o.smoke) {
    const sl = o.smoke;
    paint(
      frame,
      (x, y) => {
        if (x > 0 || x < -sl) return -1;
        const u = -x / sl;
        const hw = (tw + 1) * (0.7 + u * 0.9);
        const ay = Math.abs(y + Math.sin(u * 6 + phase) * u * 2);
        if (ay > hw) return -1;
        // 大きな格子のノイズで縁だけを食う（細かい穴だらけにしない）
        if (valueNoise(x + f * 6, y, 6, seed + 5) * 0.8 + (1 - ay / hw) * 0.5 - u * 0.45 < 0.2) return -1;
        return clamp01(0.23 * (1 - u * 0.6) * (1 - (ay / hw) * 0.3));
      },
      { bounds: { x0: -sl - 1, y0: -tw * 3 - 4, x1: 1, y1: tw * 3 + 4 }, samples: 2 },
    );
  }
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      let v = -1;
      if (d <= r) v = clamp01((1 - d / r) ** 0.55 * 1.12);
      if (x < r * 0.5 && x > -tail) {
        const u = Math.max(0, -x) / tail;
        // 炎の舌: 横に揺れ、ノイズで縁が食われて先が千切れる
        const wob = Math.sin(u * 7 + phase) * u * tw * 0.6;
        const hw = tw * (1 - u) ** 0.8 * (0.85 + 0.3 * valueNoise(x - f * 4, y, 2.5, seed));
        const dy = Math.abs(y - wob);
        if (dy <= hw && valueNoise(x - f * 5, y, 2, seed + 1) + (1 - u) * 0.5 > 0.45) {
          v = Math.max(v, clamp01((1 - dy / hw) ** 0.6 * (0.8 - 0.55 * u)));
        }
      }
      return v;
    },
    { bounds: { x0: -tail - 1, y0: -tw * 2 - 2, x1: r + 1, y1: tw * 2 + 2 } },
  );
  // 尾から剥がれる火の粉（フレームごとに位置を変える）
  for (let i = 0; i < (o.sparks ?? 2); i++) {
    const ex = -tail * (0.3 + 0.6 * hash1(i + f * 3, seed + 2));
    const ey = (hash1(i + f * 5, seed + 3) - 0.5) * tw * 3.4;
    dot(frame, ex, ey, 4);
  }
}

/**
 * 火縄銃の銃口: 大きな火の噴き出し（ノイズで縁が揺れる前向きの炎の円錐）と、それを包んで前へ転がり広がる黒煙の塊、
 * 火皿（原点の後ろ上）の小さな口火の煙。発射の瞬間が最も大きく、煙は最後まで残る
 */
function matchlockMuzzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  // 火皿の口火: 銃口から 26 ドット後ろ・上（−y）で小さく噴いて上へ昇る
  if (f <= 1) spike(frame, { x: -26, y: -3, a: -90 * DEG, len: 7, w: 2.4, bright: 0.85 });
  if (f >= 1) smokePuff(frame, { x: -26, y: -8 - f * 2, r: 4 + f * 0.8, age: k, seed: 4511, bright: 0.26 });
  if (f <= 2) {
    const s = f === 0 ? 1 : f === 1 ? 0.9 : 0.55;
    const L = 30 * s;
    paint(
      frame,
      (x, y) => {
        if (x < -3 || x > L) return -1;
        const u = Math.max(0, x) / L;
        const hw = (3 + 11 * Math.sin(Math.PI * Math.min(1, u * 1.3)) ** 0.8) * (0.8 + 0.4 * valueNoise(x, y, 3, 4512 + f));
        const ay = Math.abs(y);
        if (ay > hw) return -1;
        if (valueNoise(x, y, 2.4, 4513 + f) + (1 - u) * 0.6 < 0.5) return -1;
        return clamp01((1 - ay / hw) ** 0.6 * (1.05 - 0.6 * u) * s);
      },
      { bounds: { x0: -4, y0: -16, x1: L + 1, y1: 16 } },
    );
    flashCore(frame, 0, 0, 5 * s, 1);
    if (f <= 1) sparkle(frame, 1, 0, 3);
  }
  // 黒煙: 閃光の外側で前へ転がって広がる塊 3 つ（上下と前）
  if (f >= 1) {
    const age = f - 1;
    const puffs = [
      { x: 22, y: 0, r: 9 },
      { x: 12, y: -9, r: 7 },
      { x: 12, y: 9, r: 7 },
    ];
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      if (!p) continue;
      smokePuff(frame, { x: p.x + age * 3.5, y: p.y * (1 + age * 0.15) - age * 0.8, r: p.r + age * 2.4, age: Math.max(0, (age - 1) / 5), seed: 4514 + i, bright: 0.3 });
    }
  }
  if (f >= 1) {
    shards(frame, f - 1, 8, 4515, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.3;
      const sp = 3 + rnd(2) * 3;
      return { x: 10, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
}

/**
 * 手砲の銃口: 火縄銃よりひと回り大きく丸い爆ぜ。太い芯と前へ広い炎の塊、横にも噴く炎、
 * 前へ押し出す太い圧の弧、閃光を覆い尽くす大きな煙の輪（前と上下に 5 つの塊）
 */
function cannonMuzzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 2) {
    const s = f === 0 ? 1 : f === 1 ? 0.95 : 0.55;
    const L = 26 * s;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x / (x > 0 ? L : 10 * s), y / (18 * s));
        const edge = 0.8 + 0.3 * valueNoise(x, y, 3.2, 4611 + f);
        if (d > edge) return -1;
        if (valueNoise(x, y, 2.2, 4612 + f) + (1 - d) * 0.8 < 0.45) return -1;
        return clamp01((1 - d / edge) ** 0.5 * 1.1 * s);
      },
      { bounds: { x0: -12, y0: -22, x1: L + 2, y1: 22 } },
    );
    for (const side of [-1, 1]) spike(frame, { x: -2, y: side * 3, a: side * 100 * DEG, len: 14 * s, w: 4 * s, bright: 0.85 });
    flashCore(frame, 2, 0, 7 * s, 1);
    if (f <= 1) sparkle(frame, 3, 0, 4);
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 22 + age * 6, radius: 12 + age * 5, width: 3, squash: 0.45, spread: 75 * DEG, erosion: Math.min(0.9, k * 0.9), bright: 0.8 - k * 0.3, seed: 4613 });
    const puffs = [
      { x: 26, y: 0, r: 11 },
      { x: 16, y: -13, r: 9 },
      { x: 16, y: 13, r: 9 },
      { x: 2, y: -18, r: 7 },
      { x: 2, y: 18, r: 7 },
    ];
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      if (!p) continue;
      smokePuff(frame, { x: p.x + age * 3, y: p.y * (1 + age * 0.18) - age, r: p.r + age * 2.6, age: Math.max(0, (age - 1) / 5), seed: 4614 + i, bright: 0.32 });
    }
  }
  if (f >= 1) {
    shards(frame, f - 1, 12, 4619, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2;
      const sp = 3 + rnd(2) * 4;
      return { x: 10, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.6 ? 2 : 1 };
    });
  }
}

/**
 * 火の着弾: 当たった所で火が弾ける。後ろの半球へ伸びる炎の舌（ノイズで揺れる針）と芯、火の粉、
 * 最後に黒い煤の粒。s で大きさ（手砲は大きく、前にも舌を出す）
 */
function fireImpact(frame, f, s, seed, all = false) {
  const N = 7;
  const k = f / (N - 1);
  // 輪を持つ炸裂（手砲）は、舌が消えかけてから輪を出す（星と輪が重なると羅針盤に見える）
  if (f <= (all ? 2 : 3)) {
    const n = all ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const a = all ? (i / n) * TAU + hash1(i, seed) * 0.5 : Math.PI + ((i / (n - 1)) * 2 - 1) * 100 * DEG + (hash1(i, seed) - 0.5) * 0.3;
      const len = (8 + 8 * hash1(i, seed + 1)) * s * (0.7 + 0.3 * Math.min(1, f)) * (1 - k * 0.3);
      spike(frame, { x: 0, y: 0, a, len, w: (2.4 + hash1(i, seed + 2)) * s, bright: 0.95 - k * 0.5, erosion: Math.min(0.9, k * (all ? 2.4 : 1.3)), seed: seed + 10 + i });
    }
  }
  if (f <= 1) {
    flashCore(frame, 0, 0, (f === 0 ? 5 : 4) * s, 1);
    sparkle(frame, 0, 0, s > 1.2 ? 4 : 3);
  }
  if (all && f >= 2 && f <= 5) ring(frame, { radius: (10 + (f - 2) * 6) * s, width: 2.6, squash: 0.85, erosion: Math.min(0.9, (f - 1) * 0.25), bright: 0.75 - f * 0.1, seed: seed + 3 });
  shards(frame, f, Math.round(9 * s), seed + 4, (i, rnd) => {
    const a = all ? rnd(1) * TAU : Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = (2.5 + rnd(2) * 3) * s;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.82 };
  });
  if (f >= 3) {
    smokePuff(frame, { x: -2, y: -4 - (f - 3) * 2, r: (5 + (f - 3) * 1.5) * s, age: (f - 3) / 4, seed: seed + 5, bright: 0.24 });
  }
}

/** 火の命中: 敵の体で火が前へ飛び散る（前の扇の炎の舌 + 芯）と、体にまとわりつく小さな火の粉 */
function fireHit(frame, f, s, seed) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    for (let i = 0; i < 5; i++) {
      const a = ((i / 4) * 2 - 1) * 60 * DEG + (hash1(i, seed) - 0.5) * 0.3;
      spike(frame, { x: -2, a, len: (10 + 8 * hash1(i, seed + 1)) * s * (i % 2 === 0 ? 1 : 0.65), w: 2.8 * s, bright: 0.95 - k * 0.4, erosion: Math.min(0.9, k * 1.2), seed: seed + 10 + i });
    }
    flashCore(frame, -2, 0, (f === 0 ? 5 : 3.5) * s, 1);
    if (f === 0) sparkle(frame, -2, 0, s > 1.2 ? 4 : 3);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: (6 + (f - 1) * 4) * s, width: 2, squash: 0.6, erosion: Math.min(0.9, (f - 1) * 0.3), bright: 0.7 - f * 0.1, seed: seed + 2 });
  shards(frame, f, Math.round(10 * s), seed + 3, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.2;
    const sp = (2.5 + rnd(2) * 3) * s;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, life: 3 + Math.floor(rnd(3) * 2), size: 2, drag: 0.82 };
  });
}

/** 火の尽きた（dirs 1）: 燃え残りの火の玉が縮み、黒煙の塊がもくもくと昇って切れる */
function fireFizzle(frame, f, s, seed) {
  const N = 7;
  const age = f / (N - 1);
  if (f <= 2) flashCore(frame, 0, 0, (3.2 - f) * s, 1);
  else if (f <= 4) dot(frame, 0, -1, 4);
  smokePuff(frame, { x: 1, y: -4 - f * 2.4, r: (4 + f * 1.3) * s, age, seed, bright: 0.28 });
  if (s > 1.2) smokePuff(frame, { x: -5, y: -1 - f * 1.6, r: (3 + f) * s, age, seed: seed + 1, bright: 0.24 });
  shards(frame, f, 4, seed + 2, (i, rnd) => {
    const a = -Math.PI / 2 + (rnd(1) - 0.5) * 1.6;
    const sp = 1.2 + rnd(2) * 1.5;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 1, drag: 0.85 };
  });
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 弾の配色（属性の無い射撃のとき）。火の弾は炎、電磁砲は雷、ボルトは鋼、小銃は真鍮の曳光 */
const BULLET_ROWS = {
  rifle: { period: 0.1, ramp: "brass" },
  railgun: { period: 0.08, ramp: "lightning" },
  crossbow: { period: 0.12, ramp: "steel" },
  matchlock: { period: 0.12, ramp: "fire" },
  handCannon: { period: 0.14, ramp: "fire" },
  tripleCrossbow: { period: 0.1, ramp: "steel" },
};

/** 弾の表の 1 行（どの弾も 5 枚の絵を持つ） */
function bulletRow(name) {
  const r = BULLET_ROWS[name];
  return {
    fly: `longarm.${name}Fly`,
    period: r.period,
    base: 2,
    muzzle: `longarm.${name}Muzzle`,
    impact: `longarm.${name}Impact`,
    hit: `longarm.${name}Hit`,
    fizzle: `longarm.${name}Fizzle`,
    ramp: r.ramp,
  };
}

const CROSSBOW = BOLTS.crossbow;
const TRIPLE = BOLTS.tripleCrossbow;

/** 弾 6 種のシート（fly・muzzle・impact・hit・fizzle） */
const BULLET_SHEETS = [
  // 小銃
  { key: "longarm.rifleFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 112, draw: rifleFly },
  { key: "longarm.rifleMuzzle", dirs: DIRS, frames: 6, active: 0, size: 112, draw: rifleMuzzle },
  { key: "longarm.rifleImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: (frame, f) => metalImpact(frame, f, 1.2, 4131) },
  { key: "longarm.rifleHit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: rifleHit },
  { key: "longarm.rifleFizzle", dirs: 1, frames: 7, active: 0, size: 64, draw: (frame, f) => gunFizzle(frame, f, { height: 14, width: 1, seed: 41 }) },
  // 電磁砲
  { key: "longarm.railgunFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 120, draw: railFly },
  { key: "longarm.railgunMuzzle", dirs: DIRS, frames: 6, active: 0, size: 136, draw: railMuzzle },
  { key: "longarm.railgunImpact", dirs: DIRS, frames: 7, active: 0, size: 80, draw: railImpact },
  { key: "longarm.railgunHit", dirs: DIRS, frames: 6, active: 0, size: 112, draw: railHit },
  { key: "longarm.railgunFizzle", dirs: DIRS, frames: 6, active: 0, size: 48, draw: railFizzle },
  // 弩
  { key: "longarm.crossbowFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 112, draw: (frame, f) => boltFly(frame, f, CROSSBOW) },
  { key: "longarm.crossbowMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: (frame, f) => stringSnap(frame, f, { half: 16, back: 10, seed: 4311 }) },
  { key: "longarm.crossbowImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: (frame, f) => boltImpact(frame, f, 1.2, 4321) },
  { key: "longarm.crossbowHit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => boltHit(frame, f, 1.2, 4331) },
  { key: "longarm.crossbowFizzle", dirs: DIRS, frames: 7, active: 0, size: 80, draw: (frame, f) => boltFizzle(frame, f, CROSSBOW) },
  // 火縄銃
  { key: "longarm.matchlockFly", dirs: SHOT_DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => fireBall(frame, f, { r: 3.4, tail: 28, tailW: 3, seed: 4501, sparks: 2 }) },
  { key: "longarm.matchlockMuzzle", dirs: DIRS, frames: 7, active: 0, size: 128, draw: matchlockMuzzle },
  { key: "longarm.matchlockImpact", dirs: DIRS, frames: 7, active: 0, size: 72, draw: (frame, f) => fireImpact(frame, f, 1, 4521) },
  { key: "longarm.matchlockHit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => fireHit(frame, f, 1, 4531) },
  { key: "longarm.matchlockFizzle", dirs: 1, frames: 7, active: 0, size: 56, draw: (frame, f) => fireFizzle(frame, f, 1, 4541) },
  // 手砲
  { key: "longarm.handCannonFly", dirs: SHOT_DIRS, frames: 6, active: 0, size: 112, draw: (frame, f) => fireBall(frame, f, { r: 5, tail: 26, tailW: 4.4, seed: 4601, sparks: 3, smoke: 46 }) },
  { key: "longarm.handCannonMuzzle", dirs: DIRS, frames: 7, active: 0, size: 144, draw: cannonMuzzle },
  { key: "longarm.handCannonImpact", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (frame, f) => fireImpact(frame, f, 1.5, 4621, true) },
  { key: "longarm.handCannonHit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: (frame, f) => fireHit(frame, f, 1.4, 4631) },
  { key: "longarm.handCannonFizzle", dirs: 1, frames: 7, active: 0, size: 72, draw: (frame, f) => fireFizzle(frame, f, 1.5, 4641) },
  // 三連弩
  { key: "longarm.tripleCrossbowFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 64, draw: (frame, f) => boltFly(frame, f, TRIPLE) },
  { key: "longarm.tripleCrossbowMuzzle", dirs: DIRS, frames: 5, active: 0, size: 48, draw: (frame, f) => stringSnap(frame, f, { half: 10, back: 6, seed: 4411 }) },
  { key: "longarm.tripleCrossbowImpact", dirs: DIRS, frames: 7, active: 0, size: 48, draw: (frame, f) => boltImpact(frame, f, 0.8, 4421) },
  { key: "longarm.tripleCrossbowHit", dirs: DIRS, frames: 6, active: 0, size: 48, draw: (frame, f) => boltHit(frame, f, 0.8, 4431) },
  { key: "longarm.tripleCrossbowFizzle", dirs: DIRS, frames: 7, active: 0, size: 56, draw: (frame, f) => boltFizzle(frame, f, TRIPLE) },
];

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "longarm",
  motions: {
    dash: { sheet: "longarm.dash", pivot: "self", base: 24, measure: "reach" },
    "r:bayonet": { sheet: "longarm.bayonet", pivot: "self", base: 34, measure: "reach" },
    "r:stockStrike": { sheet: "longarm.stockStrike", pivot: "self", base: 24, measure: "reach" },
    "r:bayonetSweep": { sheet: "longarm.sweep", pivot: "self", base: 28, measure: "reach" },
    "branch:bayonetFlurry": { sheet: "longarm.flurry", pivot: "self", base: 34, measure: "reach" },
    "branch:stockBash": { sheet: "longarm.stockBash", pivot: "anchor", base: 14, measure: "reach" },
    "branch:pierceShot": { sheet: "longarm.pierceShot", pivot: "self", base: 20, measure: "size" },
    "branch:thrustShot": { sheet: "longarm.thrustShot", pivot: "self", base: 34, measure: "reach" },
  },
  hit: "longarm.hit",
  hitHeavy: "longarm.hitHeavy",
  bullets: Object.fromEntries(Object.keys(BULLET_ROWS).map((name) => [name, bulletRow(name)])),
};

export const ATLAS = {
  key: "longarm",
  fx: FX,
  sheets: [
    { key: "longarm.dash", dirs: DIRS, frames: 8, active: 3, size: 112, draw: dashBash },
    { key: "longarm.bayonet", dirs: DIRS, frames: BAYONET.N, active: BAYONET.A, size: 184, draw: (frame, f) => bayonetThrust(frame, f, BAYONET) },
    { key: "longarm.stockStrike", dirs: DIRS, frames: 8, active: 3, size: 120, draw: stockStrike },
    { key: "longarm.sweep", dirs: WIDE_DIRS, frames: 9, active: 4, size: 128, draw: bayonetSweep },
    { key: "longarm.flurry", dirs: DIRS, frames: 9, active: 4, size: 176, draw: flurry },
    { key: "longarm.stockBash", dirs: DIRS, frames: 8, active: 3, size: 96, draw: stockBash },
    { key: "longarm.pierceShot", dirs: DIRS, frames: 8, active: 3, size: 208, draw: pierceShot },
    { key: "longarm.thrustShot", dirs: DIRS, frames: THRUST_SHOT.N, active: THRUST_SHOT.A, size: 200, draw: thrustShot },
    { key: "longarm.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: meleeHit },
    { key: "longarm.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: meleeHitHeavy },
    ...BULLET_SHEETS,
  ],
};
