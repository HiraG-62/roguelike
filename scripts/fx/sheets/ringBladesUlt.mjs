// チャクラム（moveset "ringBlades"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/ringBlades.json × 2 が目安
//
// 形の言葉は通常の振り（ringBlades.mjs）とそろえる: 斬線は「細い帯 + 外周ののこぎりの歯」、輪そのものは「穴の開いた歯車の輪」。
// 奥義はそれを大きく・枚数を多く・崩れの段を長くする。決まり（1 枚の輪の通り道は 1 本・白は縁と光点だけ・崩れて消える）は守る
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い尾を持つ弾は 24 方向だと角が目立つ（fx-brief2 の弾の表） */
const BULLET_DIRS = 32;

// -----------------------------------------------------------------------------
// 形の部品（ringBlades.mjs から写して、歯の位相・巻きの向きを足したもの）
// -----------------------------------------------------------------------------

/** 角 a を基準 base から時計回りに測った [0, 2π) の距離 */
function cwFrom(base, a) {
  const d = (base - a) % TAU;
  return d < 0 ? d + TAU : d;
}

/** 崩れの判定（ノイズ + 芯からの近さ）。縁から先に欠ける */
function keep(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4.5, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.25;
  return n + nearCore * 0.4 - erosion * 1.15 > 0;
}

/** のこぎりの歯の高さ（1 周期の前 7 割が歯。先頭側で切り立つ） */
function toothHeight(L, pitch, tooth) {
  const t = (((L / pitch) % 1) + 1) % 1;
  if (t > 0.7) return 0;
  return tooth * Math.min(1, t / 0.45 + 0.3);
}

function toothFront(L, pitch) {
  const t = (((L / pitch) % 1) + 1) % 1;
  return t > 0.45;
}

function circleBounds(ox, oy, r) {
  return { x0: ox - r - 2, y0: oy - r - 2, x1: ox + r + 2, y1: oy + r + 2 };
}

/**
 * 刻みの付いた弧の帯（輪が通った軌跡）。ringBlades.mjs の toothedArc に phase（歯の送り。継ぎ目の無い回転のループ用）を足したもの。
 * head = 先頭の角、span = 尾までの長さ。外縁の外にのこぎりの歯、外縁の先頭寄りが白い刃の縁
 */
function toothedArc(frame, o) {
  const { R, T, head, span } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const tooth = o.tooth ?? 3;
  const pitch = o.pitch ?? 8;
  const phase = o.phase ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const full = span >= TAU - 1e-3;
  const edgeReach = o.edgeReach ?? 0.55;
  const cap = o.cap ?? 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + tooth + 0.5 || r < R - T - 0.5) return -1;
      const a = Math.atan2(dy, dx);
      const s = cwFrom(head, a);
      if (s > span) return -1;
      const u = full ? 0.25 : s / span;
      const taper = full ? 1 : Math.min(1, u / 0.05) * Math.pow(1 - u, 0.55);
      const w = T * taper;
      const L = a * R + phase;
      const th = toothHeight(L, pitch, tooth) * (full ? 1 : 1 - 0.6 * u) * Math.min(1, taper * 2);
      if (r > R) {
        if (r - R > th || th < 0.8) return -1;
        if (!keep(x, y, erosion, 0.2, seed + 3)) return -1;
        const front = toothFront(L, pitch) ? 0.22 : 0;
        return Math.min(cap, clamp01((0.62 + front) * (1 - 0.5 * u) * bright * (1 - erosion * 0.4)));
      }
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.4 && u < edgeReach && erosion < 0.45) return Math.min(cap, clamp01(bright * (1.05 - 0.35 * u)));
      return Math.min(cap, clamp01(Math.pow(1 - q, 1.1) * (0.9 - 0.5 * u) * bright * (1 - erosion * 0.45)));
    },
    { bounds: circleBounds(ox, oy, R + tooth + 1) },
  );
}

/**
 * 回転する輪（チャクラム本体の光）。穴を抜いた歯車の輪。明るい側が回転とともに回る。
 * hub を渡すと穴の中に細い十字の骨（大きな輪の奥義らしい作り込み）
 */
function wheel(frame, cx, cy, o) {
  const { r, rot } = o;
  const rw = o.rw ?? Math.max(2, r * 0.4);
  const n = o.teeth ?? 6;
  const th = o.tooth ?? Math.max(1.5, r * 0.35);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const hub = o.hub ?? false;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r + th + 0.5) return -1;
      const a = Math.atan2(dy, dx) - rot;
      if (d < r - rw) {
        // 穴の中の骨: 回転に合わせた 3 本の細い輻（中心の小さな円は抜く）
        if (!hub || d < 1.5) return -1;
        const spoke = Math.abs(Math.sin((a * 3) / 2));
        if (spoke * d > 0.7) return -1;
        return clamp01(0.45 * bright);
      }
      const t = ((((a / TAU) * n) % 1) + 1) % 1;
      if (d > r && d - r > th * t) return -1;
      if (!keep(x, y, erosion, 0.3, seed)) return -1;
      const lit = 0.5 + 0.5 * Math.cos(a + 0.8);
      if (d <= r && d > r - 1.2 && lit > 0.6) return clamp01(bright);
      // 本体は段 5 までに抑える（白は縁の細い線だけ。輪が白い塊に見えないように）
      const base = d > r ? 0.55 : 0.42 + 0.16 * ((r - d) / rw < 0.5 ? 1 : 0);
      return Math.min(0.74, clamp01((base + 0.25 * lit) * bright * (1 - erosion * 0.4)));
    },
    { bounds: circleBounds(cx, cy, r + th + 1), samples: 4 },
  );
}

/** 回転の火花: 円周上の点から接線（時計回り）へ飛ぶ */
function tangentSparks(frame, age, count, seed, o) {
  const { ox = 0, oy = 0, radius, from, to, speed = 4, out: outBase = 0.15 } = o;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = from + (to - from) * rnd(1);
    const r = radius * (0.92 + 0.12 * rnd(2));
    const sp = speed * (0.6 + 0.8 * rnd(3));
    const out = outBase + 0.3 * rnd(4);
    return {
      x: ox + Math.cos(a) * r,
      y: oy + Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      size: rnd(6) > 0.5 ? 2 : 1,
    };
  });
}

/** y を反転した写像の作業面（反時計回りの輪を、時計回りの部品でそのまま描く） */
function mirrored(frame) {
  const m = Object.create(frame);
  m.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: -c.y };
  };
  m.toGrid = (x, y) => frame.toGrid(x, -y);
  return m;
}

/**
 * 上下に潰した写像の作業面（地面に置いた輪・腰の高さを回る輪）。
 * この面の円（中心 0,0）は、正準座標で中心 (0, oy)・縦を 1/squash に潰した楕円になる
 */
function flattened(frame, oy, squash) {
  const m = Object.create(frame);
  m.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: (c.y - oy) * squash };
  };
  m.toGrid = (x, y) => frame.toGrid(x, y / squash + oy);
  return m;
}

// -----------------------------------------------------------------------------
// 環の陣（volley: 刃の輪 4 枚が半径 40 を周回する）
// -----------------------------------------------------------------------------

/** 周回の半径（40 論理 px × 2） */
const ORBIT_R = 80;
/** 周回の弾の半径（数値表の bulletRadius） */
const RING_BULLET_R = 3;

/**
 * 環の陣の発動: 4 枚の輪が外から自分へ渦を巻いて寄り（時計回り）、手元で重なった瞬間に光る。
 * 寄せる輪が「これから 4 枚を放つ」予告になる
 */
function formationCast(frame, f) {
  const N = 8;
  const gather = 5;
  if (f < gather) {
    const p = easeSwing((f + 1) / gather);
    const r = 56 - 44 * p;
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * TAU + p * 1.6;
      // 寄る輪の通り道（刻みの短い帯。輪ごとに 1 本）
      toothedArc(frame, { R: r + 3, T: 4, head: a, span: 0.9 - 0.3 * p, tooth: 3, pitch: 7, bright: 0.7 + 0.25 * p, seed: 3101 + i });
      wheel(frame, Math.cos(a) * r, Math.sin(a) * r, { r: 5 + p, rot: a * 3, teeth: 6, bright: 0.85 + 0.15 * p, seed: 3105 + i });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 4);
    return;
  }
  // 重なった輪が 1 つの歯車の輪になって弾ける
  const k = (f - gather + 1) / (N - gather);
  toothedArc(frame, { R: 14 + k * 22, T: 3.5 - k * 1.5, head: k * 0.8, span: TAU, tooth: 3, pitch: 7, erosion: Math.min(0.9, 0.1 + k * 0.75), bright: 0.95 - k * 0.3, seed: 3110, edgeReach: 0 });
  if (f === gather) sparkle(frame, 0, 0, 3);
  tangentSparks(frame, f - gather, 12, 3111, { radius: 12, from: 0, to: TAU, speed: 4.5, out: 0.35 });
}

/** 環の陣の放ち（行為 0）のフレーム数と、陣の輪が閉じるまでの枚数 */
const FORM_N = 11;
const FORM_A = 4;

/**
 * 環の陣の放ち: 4 つの先頭が周回の半径を同時に走り、それぞれ 1/4 周ずつ刻んで 1 本の歯の輪（陣）に閉じる。
 * 閉じた陣は光ってから崩れる。輪そのもの（弾）は弾の絵が描くので、ここには輪を描かず軌跡の陣だけ
 */
function formationRelease(frame, f) {
  const A = FORM_A;
  const k = f < A ? 0 : (f - A + 1) / (FORM_N - A + 1);
  const start = -Math.PI / 2;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    for (let i = 0; i < 4; i++) {
      const head = start + (i / 4) * TAU + (TAU / 4) * p;
      // 4 本の帯は同じ円の上で時間をそろえて走る（4 枚の輪それぞれの軌跡。重ならない）
      toothedArc(frame, { R: ORBIT_R + 3, T: 7 * (0.7 + 0.3 * p), head, span: Math.max(0.05, (TAU / 4) * p * 0.97), tooth: 4, pitch: 10, bright: 0.85 + 0.15 * p, seed: 3201 + i });
      if (f >= 1) sparkle(frame, Math.cos(head) * (ORBIT_R + 4), Math.sin(head) * (ORBIT_R + 4), f === A - 1 ? 3 : 2);
    }
    return;
  }
  // 閉じた陣: 閉じた瞬間に全周の縁が光り、そのあと外へ少し押し広がって崩れる
  toothedArc(frame, {
    R: ORBIT_R + 3 + k * 6,
    T: f === A ? 7 : 6 * (1 - 0.5 * k),
    head: start + k * 0.5,
    span: TAU,
    tooth: 4,
    pitch: 10,
    erosion: f === A ? 0 : 0.08 + 0.82 * Math.pow(k, 1.15),
    bright: f === A ? 1.08 : 1 - 0.3 * k,
    seed: 3210,
    edgeReach: f === A ? 1 : 0,
  });
  if (f === A || f === A + 1) {
    for (let i = 0; i < 4; i++) {
      const a = start + (i / 4) * TAU + Math.PI / 4;
      sparkle(frame, Math.cos(a) * (ORBIT_R + 3), Math.sin(a) * (ORBIT_R + 3), f === A ? 4 : 2);
    }
  }
  tangentSparks(frame, f - A, 36, 3211, { radius: ORBIT_R + 3, from: 0, to: TAU, speed: 5 });
}

/** 環の陣の地面の紋: 周回の輪の内側に細い輪と 4 つの座（輪の付く位置）。陣が閉じる間ゆっくり回り、薄れて消える */
function formationGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 5 ? 0 : (f - 4) / (FORM_N - 5);
  const erosion = k * 0.9;
  const dim = 0.4 * (1 - 0.4 * k);
  ring(frame, { radius: (ORBIT_R - 14) * (0.75 + 0.25 * grow), width: 1.6, erosion, bright: dim, seed: 3221 });
  ring(frame, { radius: ORBIT_R * 0.42 * grow, width: 1.2, erosion: Math.min(0.95, erosion + 0.1), bright: dim * 0.8, seed: 3222 });
  if (grow < 1 || k >= 0.5) return;
  const turn = f * 0.04;
  for (let i = 0; i < 4; i++) {
    // 座: 小さな菱形の枠（4 枚の輪の居場所）と、内側の輪へ伸びる細い線
    const a = -Math.PI / 2 + (i / 4) * TAU + turn;
    const cx = Math.cos(a) * (ORBIT_R - 14);
    const cy = Math.sin(a) * (ORBIT_R - 14);
    ring(frame, { ox: cx, oy: cy, radius: 5, width: 1.4, erosion, bright: dim * 1.3, seed: 3223 + i });
    const r0 = ORBIT_R * 0.42 + 2;
    const r1 = ORBIT_R - 14 - 6;
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: 1.1, bright: dim * (1 - k) });
  }
}

/** 周回の弾の飛ぶ絵のフレーム数（6 枚の歯を 1 巡で 2 枚ぶん回すので継ぎ目が出ない） */
const FLY_N = 6;
/** 周回の尾の長さ（300px/秒 × 0.04 秒 = 12 論理 px → 24 ドット。奥義なので少し長く） */
const FLY_TAIL = 30;

/**
 * 周回の輪（弾）: 穴の開いた大きな歯車の輪が回り、後ろに周回の曲率で曲がった刻みの尾を引く。
 * 周回は時計回り（中心は進む向きの右 = +y）なので、尾は +y 側へ反る
 */
function formationFly(frame, f) {
  const rot = (f / FLY_N) * (TAU / 6) * 2;
  // 尾: 周回の円（中心 0, ORBIT_R）の上。弾の位置は中心から見て真上（-π/2）
  toothedArc(frame, { oy: ORBIT_R, R: ORBIT_R + 3, T: 5, head: -Math.PI / 2 - 0.06, span: FLY_TAIL / ORBIT_R, tooth: 3, pitch: 7, phase: -f * (14 / FLY_N), bright: 0.9, seed: 3301, edgeReach: 0.5 });
  wheel(frame, 0, 0, { r: 8, rw: 3.4, rot, teeth: 6, tooth: 3, hub: true, seed: 3302 });
  // 外周の歯の先の光点（回る刃の光。1 巡に 2 回、回転と同じ向きへ移る）
  if (f % 3 === 1) {
    const a = rot + 0.8 - Math.PI;
    dot(frame, Math.cos(a) * 11, Math.sin(a) * 11, 7);
  }
}

/** 周回の輪の現れ（muzzle）: 手元で小さな歯の輪が弾け、進む向きへ短い火花 */
function formationMuzzle(frame, f) {
  const k = f / 4;
  toothedArc(frame, { R: 6 + f * 4, T: 2.6 - k, head: f * 0.6, span: TAU, tooth: 2, pitch: 6, erosion: Math.min(0.9, k * 0.85), bright: 0.9 - k * 0.3, seed: 3311, edgeReach: 0 });
  if (f <= 1) sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  shards(frame, f, 7, 3312, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.4;
    const sp = 3 + rnd(2) * 3;
    return { x: 2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

/** 周回の輪が敵を刻む（hit）: 刃の進む向きへ走る短い歯の切り口と、接線に散る火花 */
function formationHit(frame, f) {
  const N = 7;
  const R = 18;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const sweep = 115 * (Math.PI / 180);
  const mid = -Math.PI / 2;
  const grow = f === 0 ? 0.55 : 1;
  toothedArc(frame, { oy: R, R, T: 6 * (f === 0 ? 0.7 : 1 - 0.5 * k), head: mid - sweep / 2 + sweep * grow, span: sweep * grow, tooth: 3, pitch: 6, erosion: k * 0.9, bright: 1 - 0.2 * k, seed: 3321 });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? 4 : 2);
  if (f >= 1) tangentSparks(frame, f - 1, 12, 3322, { radius: 4, from: 0, to: TAU, speed: 5 });
}

/** 周回の輪が消える（fizzle / impact）: 輪が回りながら歯の欠片にほどけ、小さな輪が残って消える */
function formationFizzle(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 3) wheel(frame, 0, 0, { r: 8 - f, rw: 3, rot: f * 0.7, teeth: 6, tooth: 3, bright: 0.95 - k * 0.3, erosion: 0.15 + f * 0.22, seed: 3331 });
  ring(frame, { radius: 6 + f * 3, width: 1.6, erosion: Math.min(0.92, k * 0.9), bright: 0.6 - k * 0.2, seed: 3332 });
  tangentSparks(frame, f, 10, 3333, { radius: 8, from: 0, to: TAU, speed: 3.5, out: 0.3 });
}

// -----------------------------------------------------------------------------
// 乱輪（nova 半径 44・6 段）: 輪が四方へ、右巻き・左巻きの弧を描いて乱れ飛び、縁で刻んで跳ねる
// -----------------------------------------------------------------------------

/** 乱輪の半径（44 論理 px × 2） */
const WILD_R = 88;
const WILD_N = 13;
const WILD_A = 7;

/**
 * 乱れ飛ぶ輪 7 枚の軌道。end = 縁に届く向き（度。7 方向へ不揃いに散らす）、rho = 軌道の曲率半径、ccw = 左巻き、
 * delay = 出るフレーム、reach = 縁に届くまでの枚数（速さのばらつき）。巻きを混ぜて通り道を交差させ「乱れ」を出す
 */
const WILD_RINGS = [
  { end: -95, rho: 56, ccw: false, delay: 0, reach: 3.0 },
  { end: -35, rho: 48, ccw: true, delay: 0.5, reach: 2.6 },
  { end: 15, rho: 64, ccw: false, delay: 1.0, reach: 3.2 },
  { end: 75, rho: 50, ccw: true, delay: 0.3, reach: 2.8 },
  { end: 125, rho: 60, ccw: false, delay: 1.3, reach: 3.0 },
  { end: 175, rho: 70, ccw: true, delay: 1.8, reach: 2.6 },
  { end: -145, rho: 54, ccw: false, delay: 2.2, reach: 2.8 },
];

/**
 * 1 枚の輪の軌道（時計回り）の位置と、軌道の円での角。launch は手元での向き（ラジアン）、phi は軌道の円を回った角
 */
function wildPath(launch, rho, phi) {
  const cx = Math.cos(launch + Math.PI / 2) * rho;
  const cy = Math.sin(launch + Math.PI / 2) * rho;
  const a = launch - Math.PI / 2 + phi;
  return { cx, cy, a, x: cx + Math.cos(a) * rho, y: cy + Math.sin(a) * rho };
}

/** 縁（半径 WILD_R）に届く軌道の角: 弦の長さ 2ρ sin(φ/2) = R */
function wildPhiMax(rho) {
  return 2 * Math.asin(Math.min(1, (WILD_R - 4) / (2 * rho)));
}

/**
 * 1 枚の輪: 軌道の刻みの帯（輪 1 枚に 1 本）と先頭の輪。縁に届いた所で光り、接線の火花を散らす。
 * 左巻きは上下を反転した面で同じ時計回りの部品を使う
 */
function wildRing(frame, f, spec, i) {
  const target = spec.ccw ? mirrored(frame) : frame;
  const phiMax = wildPhiMax(spec.rho);
  // 弦は発射の向きから φ/2 だけ巻きの側へ回る。左巻きは反転した面で描くので、終点の角も反転して逆算する
  const end = ((spec.ccw ? -spec.end : spec.end) * Math.PI) / 180;
  const launch = end - phiMax / 2;
  const age = f - spec.delay;
  if (age < 0) return;
  const p = Math.min(1, easeSwing((age + 1) / spec.reach));
  const phi = phiMax * p;
  const done = age + 1 >= spec.reach;
  const k = done ? Math.min(1, (age + 1 - spec.reach) / (WILD_N - spec.reach - spec.delay)) : 0;
  const pos = wildPath(launch, spec.rho, phi);
  const span = Math.max(0.05, Math.min(phi, 1.3) * (1 - 0.5 * k));
  const seed = 3401 + i * 17;
  toothedArc(target, {
    ox: pos.cx,
    oy: pos.cy,
    R: spec.rho + 3,
    T: 6 * (1 - 0.45 * k),
    head: pos.a + k * 0.1,
    span,
    tooth: 4,
    pitch: 9,
    erosion: done ? 0.08 + 0.85 * Math.pow(k, 1.1) : 0,
    bright: 1 - 0.3 * k,
    seed,
  });
  if (!done || k < 0.15) {
    wheel(target, pos.x, pos.y, { r: done ? 7 : 8.5, rw: 3.4, rot: phi * (spec.rho / 8), teeth: 7, tooth: 3, hub: true, bright: done ? 0.85 : 1, erosion: done ? 0.3 : 0, seed: seed + 5 });
  }
  // 縁で刻む（多段の当たり）: 届いた瞬間の光点と、縁に沿って跳ねる火花
  const hitAge = age + 1 - spec.reach;
  if (hitAge >= 0 && hitAge < 1) sparkle(target, pos.x, pos.y, i % 2 === 0 ? 4 : 3);
  if (hitAge >= 0) {
    const ah = Math.atan2(pos.y, pos.x);
    tangentSparks(target, Math.floor(hitAge), 7, seed + 60, { radius: Math.hypot(pos.x, pos.y), from: ah - 0.12, to: ah + 0.12, speed: 4.5, out: 0.25 });
  }
}

function wildRingsBurst(frame, f) {
  WILD_RINGS.forEach((spec, i) => wildRing(frame, f, spec, i));
  if (f === 0) sparkle(frame, 0, 0, 3);
}

/**
 * 乱輪の地面の紋: 当たりの円の縁に、歯の付いた細い輪（のこぎりの円）が現れ、輪が縁で刻むたびに少しずつ回って崩れる
 */
function wildRingsGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 7 ? 0 : (f - 6) / (WILD_N - 7);
  toothedArc(frame, {
    R: (WILD_R - 2) * (0.8 + 0.2 * grow),
    T: 2.4,
    head: f * 0.06,
    span: TAU,
    tooth: 3,
    pitch: 12,
    erosion: Math.min(0.95, k * 0.9),
    bright: 0.45 * (1 - 0.4 * k),
    cap: 0.5,
    seed: 3501,
    edgeReach: 0,
  });
  ring(frame, { radius: WILD_R * 0.3 * grow, width: 1.2, erosion: Math.min(0.95, 0.1 + k * 0.9), bright: 0.34, seed: 3502 });
}

/**
 * 乱輪の発動: 手元で大きな輪が唸りを上げて回る（歯の速い送り）。回るほど縁が明るくなり、最後に四方へ火花を散らしてほどける
 */
function wildRingsCast(frame, f) {
  const N = 8;
  const spin = 5;
  if (f < spin) {
    const p = (f + 1) / spin;
    wheel(frame, 0, 0, { r: 9 + 7 * p, rw: 4 + 1.5 * p, rot: f * 1.1, teeth: 8, tooth: 3 + p * 2, hub: true, bright: 0.8 + 0.2 * p, seed: 3601 });
    // 回る輪の外に、回転の向きへ流れる刻みの帯（輪の唸り。回転に合わせて 1 本が回る）
    toothedArc(frame, { R: 26 + 4 * p, T: 3, head: f * 1.3, span: 1.4 + 1.6 * p, tooth: 3, pitch: 7, bright: 0.55 + 0.35 * p, seed: 3602 });
    if (f === spin - 1) sparkle(frame, 0, 0, 4);
    return;
  }
  const k = (f - spin + 1) / (N - spin);
  wheel(frame, 0, 0, { r: 16 - 4 * k, rw: 5, rot: f * 1.1, teeth: 8, tooth: 4, hub: true, bright: 0.9 - 0.3 * k, erosion: 0.2 + 0.7 * k, seed: 3603 });
  tangentSparks(frame, f - spin, 18, 3604, { radius: 18, from: 0, to: TAU, speed: 5.5, out: 0.4 });
}

// -----------------------------------------------------------------------------
// 輪の舞（持続）: 3 枚の輪が腰の高さの楕円を三拍子で巡る（1 拍ごとに前を通る輪が光る）
// dirs 1（画面に揃える）: 楕円は奥行きの見立てなので向きによらない
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 纏いの楕円: 腰の高さ・横の半径・潰し */
const WALTZ_Y = 6;
const WALTZ_RX = 36;
const WALTZ_SQUASH = 2.6;
const WALTZ_N = 12;

/**
 * 三拍子の角の進み（1 巡 = 1 小節 = 1 周）。拍の頭で速く、拍の終わりで粘る（ワルツの揺れ）。t ∈ [0,1) → [0,1)
 */
function waltzTurn(t) {
  return t - Math.sin(t * TAU * 3) / (TAU * 3) * 0.7;
}

/** 楕円の上の位置（奥 = 上側 = 暗く） */
function waltzAt(a) {
  return { x: Math.cos(a) * WALTZ_RX, y: WALTZ_Y + (Math.sin(a) * WALTZ_RX) / WALTZ_SQUASH, front: Math.sin(a) };
}

function ringWaltzSustain(frame, f) {
  const flat = flattened(frame, WALTZ_Y, WALTZ_SQUASH);
  const t = f / WALTZ_N;
  const base = waltzTurn(t) * TAU;
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * TAU + Math.PI / 2;
    const pos = waltzAt(a);
    // 奥を通る輪は暗く小さく（キャラの後ろを回る見立て）
    const depth = 0.5 + 0.5 * pos.front;
    toothedArc(flat, { R: WALTZ_RX + 2, T: 4, head: a, span: 1.3, tooth: 3, pitch: 8, bright: 0.45 + 0.4 * depth, cap: 0.8, edgeReach: 0.35, seed: 3701 + i });
    wheel(frame, pos.x, pos.y, { r: 4.5 + 1.5 * depth, rw: 2.4, rot: a * 4, teeth: 6, tooth: 2.2, bright: 0.6 + 0.4 * depth, seed: 3705 + i });
  }
  // 拍の頭（1 巡に 3 回）: 前を通る輪の位置が光る
  if (f % 4 === 0) {
    const pos = waltzAt(Math.PI / 2);
    sparkle(frame, pos.x, pos.y, f === 0 ? 3 : 2);
  }
  // 刻みの粉: 楕円の縁から外へ落ちる細かな粒（位相で流れ、1 巡で戻る）
  for (let i = 0; i < 8; i++) {
    const u = (t + hash1(i, 3710)) % 1;
    const a = hash1(i, 3711) * TAU;
    const p = waltzAt(a);
    const x = p.x * (1 + 0.25 * u);
    const y = p.y + u * 12;
    dot(frame, x, y, Math.max(2, Math.round(5 - 3 * u)));
  }
}

/**
 * 輪の舞の足元（地面）: 潰した歯の輪がゆっくり回り（歯の送りで 1 巡がつながる）、三拍子の 3 つの座が拍ごとに灯る
 */
function ringWaltzGround(frame, f) {
  const flat = flattened(frame, FEET_Y, WALTZ_SQUASH);
  const t = f / WALTZ_N;
  const R = 30;
  const pitch = 9;
  toothedArc(flat, { R, T: 2.2, head: 0, span: TAU, tooth: 2.5, pitch, phase: -t * pitch, bright: 0.42, cap: 0.5, edgeReach: 0, seed: 3801 });
  const beat = Math.floor(t * 3);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i / 3) * TAU;
    const x = Math.cos(a) * (R - 6);
    const y = FEET_Y + (Math.sin(a) * (R - 6)) / WALTZ_SQUASH;
    ring(frame, { ox: x, oy: y, radius: 2.6, width: 1.4, squash: 1.6, bright: i === beat ? 0.62 : 0.3, seed: 3802 + i });
  }
}

/**
 * 輪の舞の発動: 足元の歯の輪が一周して閉じ、そこから 3 枚の輪が渦を巻いて腰の高さへ舞い上がり、光って纏いに移る
 */
function ringWaltzCast(frame, f) {
  const N = 10;
  const ground = flattened(frame, FEET_Y, WALTZ_SQUASH);
  // 足元の輪: 0〜3 で一周して閉じ、そのあと広がって崩れる
  const close = Math.min(1, easeSwing((f + 1) / 4));
  const kg = f < 4 ? 0 : (f - 3) / (N - 4);
  toothedArc(ground, {
    R: 30 + kg * 16,
    T: 4 * (1 - 0.4 * kg),
    head: Math.PI / 2 + TAU * close,
    span: Math.max(0.1, TAU * close),
    tooth: 3,
    pitch: 9,
    erosion: f < 4 ? 0 : 0.1 + 0.8 * kg,
    bright: 0.9 - 0.3 * kg,
    cap: 0.9,
    edgeReach: 0.4,
    seed: 3901,
  });
  // 舞い上がる 3 枚: 足元の輪の上から、半径を保って時計回りに回りながら腰へ
  if (f >= 2) {
    const age = f - 2;
    const p = Math.min(1, easeSwing((age + 1) / 4));
    const kk = age < 4 ? 0 : (age - 3) / 4;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i / 3) * TAU + p * TAU * 0.9;
      const oy = FEET_Y + (WALTZ_Y - FEET_Y) * p;
      const lift = flattened(frame, oy, WALTZ_SQUASH);
      toothedArc(lift, { R: WALTZ_RX + 2, T: 4.5 * (1 - 0.5 * kk), head: a, span: 0.4 + 1.4 * p, tooth: 3, pitch: 8, erosion: kk * 0.9, bright: 0.95 - 0.3 * kk, cap: 0.9, seed: 3905 + i });
      if (kk < 0.5) {
        const x = Math.cos(a) * WALTZ_RX;
        const y = oy + (Math.sin(a) * WALTZ_RX) / WALTZ_SQUASH;
        wheel(frame, x, y, { r: 6, rw: 2.6, rot: a * 4, teeth: 6, tooth: 2.5, erosion: kk * 0.6, seed: 3910 + i });
        if (age === 3) sparkle(frame, x, y - 1, 3);
      }
    }
  }
  // 立ちのぼる刻みの粉
  shards(frame, f, 14, 3920, (i, rnd) => {
    const a = rnd(1) * TAU;
    return { x: Math.cos(a) * 30, y: FEET_Y + (Math.sin(a) * 30) / WALTZ_SQUASH, vx: Math.cos(a) * 1.2, vy: -(2.5 + rnd(2) * 3), life: 4 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.9 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 環の陣の行為 0 は周回の弾なので、弾の絵（shots[0]）が本体。放ちの絵は陣の軌跡、base は周回の半径
 */
const FX = {
  moveset: "ringBlades",
  ultimates: {
    "ringBlades.ringFormation": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.ringFormationCast", life: 0.35 },
      acts: [{ sheet: "ringBladesUlt.ringFormation", life: 0.6, base: ORBIT_R / 2, pivot: "pos", ground: "ringBladesUlt.ringFormationGround" }],
      shots: {
        0: {
          fly: "ringBladesUlt.ringFormationFly",
          period: 0.2,
          base: RING_BULLET_R,
          muzzle: "ringBladesUlt.ringFormationMuzzle",
          impact: "ringBladesUlt.ringFormationFizzle",
          hit: "ringBladesUlt.ringFormationHit",
          fizzle: "ringBladesUlt.ringFormationFizzle",
          ramp: "light",
        },
      },
    },
    "ringBlades.wildRings": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.wildRingsCast", life: 0.35 },
      acts: [{ sheet: "ringBladesUlt.wildRings", life: 0.65, base: WILD_R / 2, pivot: "pos", ground: "ringBladesUlt.wildRingsGround" }],
    },
    "ringBlades.ringWaltz": {
      ramp: "light",
      cast: { sheet: "ringBladesUlt.ringWaltzCast", life: 0.6 },
      sustain: { sheet: "ringBladesUlt.ringWaltz", period: 0.9, ground: "ringBladesUlt.ringWaltzGround" },
    },
  },
};

export const ATLAS = {
  key: "ringBladesUlt",
  fx: FX,
  sheets: [
    { key: "ringBladesUlt.ringFormationCast", dirs: 1, frames: 8, active: 0, size: 136, draw: formationCast },
    { key: "ringBladesUlt.ringFormation", dirs: 1, frames: FORM_N, active: FORM_A, size: 2 * (ORBIT_R + 40), draw: formationRelease },
    { key: "ringBladesUlt.ringFormationGround", dirs: 1, frames: FORM_N, active: FORM_A, size: 2 * (ORBIT_R + 8), draw: formationGround },
    { key: "ringBladesUlt.ringFormationFly", dirs: BULLET_DIRS, frames: FLY_N, active: 0, size: 2 * (FLY_TAIL + 16), draw: formationFly },
    { key: "ringBladesUlt.ringFormationMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: formationMuzzle },
    { key: "ringBladesUlt.ringFormationHit", dirs: DIRS, frames: 7, active: 0, size: 80, draw: formationHit },
    { key: "ringBladesUlt.ringFormationFizzle", dirs: 1, frames: 7, active: 0, size: 72, draw: formationFizzle },
    { key: "ringBladesUlt.wildRingsCast", dirs: 1, frames: 8, active: 0, size: 128, draw: wildRingsCast },
    { key: "ringBladesUlt.wildRings", dirs: 1, frames: WILD_N, active: WILD_A, size: 2 * (WILD_R + 36), draw: wildRingsBurst },
    { key: "ringBladesUlt.wildRingsGround", dirs: 1, frames: WILD_N, active: WILD_A, size: 2 * (WILD_R + 10), draw: wildRingsGround },
    { key: "ringBladesUlt.ringWaltzCast", dirs: 1, frames: 10, active: 0, size: 160, draw: ringWaltzCast },
    { key: "ringBladesUlt.ringWaltz", dirs: 1, frames: WALTZ_N, active: 0, size: 128, draw: ringWaltzSustain },
    { key: "ringBladesUlt.ringWaltzGround", dirs: 1, frames: WALTZ_N, active: 0, size: 96, draw: ringWaltzGround },
  ],
};
