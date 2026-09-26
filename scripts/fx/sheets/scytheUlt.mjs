// 大鎌（moveset "scythe"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/scythe.json × 2 が目安
//
// 大鎌の近接（scythe.mjs）の形の言葉をそのまま大きくする: 刃は細長く先端が内へ鉤状に巻き込み、尾は煙のように千切れる。
// 振り終わりは煙（smoke）と魂の粒（souls）が漂う。奥義は 3 本とも闇の属性なので、実行時は闇の配色で出る。
// - 魂刈り: 鉤の輪が敵を引き寄せ（掴んだ敵には魂の鎖）、巨大な鎌が 1 周。倒した魂は自分へ吸い込まれる（生命を取り戻す）
// - 冥府の渦: 1 本の刃が渦を巻いて 3 周しながら内へ締まる（3 度の当たり）。足元に回る渦の腕
// - 死神の間合い: 頭上に幻の大鎌が浮かび、魂が腰の周りを回り続ける（持続）
// 決まり: 1 回の薙ぎは刃 1 本（渦も 1 本の刃が周回する）・白は刃の縁と光点だけ・振り終わりは崩れて消える
import { arcLine, easeSwing, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 鉤の曲がりの冪（scythe.mjs と同じ。刃先の近くで急に折れる「J」の返し） */
const HOOK_POW = 2.6;
/** 本体の明るさの上限（白 = 段 7 は刃の縁と光点に取っておく） */
const BODY_CAP = 0.78;

function mod(a, m) {
  return ((a % m) + m) % m;
}

/** 崩れの判定（shapes.mjs の survives と同じ考え方。export されていないので写す） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

// -----------------------------------------------------------------------------
// 形の部品（scythe.mjs の大鎌の部品を写し、奥義の大きさで使えるようにしたもの）
// -----------------------------------------------------------------------------

/**
 * 鎌の刃の軌跡。中心 (ox, oy)、tail の角での外縁の半径 R、最大の太さ T。tail → head へ時計回り（差は 2π 未満）。
 * head の先に hookSpan だけ刃先が続き、外縁が hookDepth 内側へ巻き込んで尖る（鎌の鉤）。
 * spiral（ドット / ラジアン）で tail から進むほど半径が縮む（渦）。尾（wisp の割合）は煙のように千切れる
 */
function blade(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const span = Math.max(1e-3, head - tail);
  const hookSpan = o.hookSpan ?? 0;
  const hookDepth = o.hookDepth ?? 0;
  const total = span + hookSpan;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const wisp = o.wisp ?? 0.35;
  const spiral = o.spiral ?? 0;
  const edge = o.edge ?? 1.6;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + 1) return -1;
      const t = mod(Math.atan2(dy, dx) - tail, TAU);
      if (t > total) return -1;
      const Rb = R - spiral * t;
      let v = 1;
      let h = 0;
      let w;
      let Ro = Rb;
      if (t <= span) {
        v = t / span;
        w = T * Math.pow(Math.sin((Math.PI / 2) * Math.min(1, v / 0.88)), 0.75);
      } else {
        h = (t - span) / Math.max(1e-3, hookSpan);
        Ro = Rb - hookDepth * Math.pow(h, HOOK_POW);
        // 鉤は急に内へ曲がるので、半径方向の幅を傾きの分だけ広げて見た目の太さを保つ
        const slope = (hookDepth * HOOK_POW * Math.pow(h, HOOK_POW - 1)) / Math.max(1e-3, hookSpan) / Math.max(4, r);
        w = T * Math.pow(1 - h, 1.5) * Math.sqrt(1 + slope * slope);
      }
      if (w < 0.6) return -1;
      const q = (Ro - r) / w;
      if (q < 0 || q > 1) return -1;
      if (v < wisp && valueNoise(x, y, 3.5, seed + 3) < (1 - v / wisp) * 0.9) return -1;
      if (!survives(x, y, erosion, (1 - q) * v, seed)) return -1;
      if (Ro - r < edge && v > 0.5 && erosion < 0.5) return clamp01(bright * (1.05 - 0.15 * h));
      const band = Math.floor((Ro - r) / 1.6);
      const grain = q > 0.25 ? 0.8 + 0.2 * hash1(band, seed) : 1;
      return Math.min(BODY_CAP, clamp01(Math.pow(1 - q, 1.05) * (0.28 + 0.66 * v) * grain * bright * (1 - erosion * 0.45)));
    },
    { bounds: { x0: ox - R - 3, y0: oy - R - 3, x1: ox + R + 3, y1: oy + R + 3 } },
  );
}

/**
 * 小さな鎌の鉤。中心 (ox, oy) の半径 R の円周上を、角 from（根元・太い）から to（先端・尖る）へ。
 * to < from なら反時計回りに巻く。外縁が白い縁
 */
function sickle(frame, o) {
  const { ox, oy, R, T, from, to } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const d = to - from;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) - from;
      const rel = d > 0 ? mod(a, TAU) : -mod(-a, TAU);
      const u = rel / d;
      if (u < 0 || u > 1) return -1;
      const w = T * Math.pow(1 - u, 0.85);
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      if (R - r < 1.4 && erosion < 0.5) return clamp01(bright);
      return Math.min(BODY_CAP, clamp01(Math.pow(1 - q, 0.9) * (0.9 - 0.3 * u) * bright * (1 - erosion * 0.4)));
    },
    { bounds: { x0: ox - R - 2, y0: oy - R - 2, x1: ox + R + 2, y1: oy + R + 2 } },
  );
}

/**
 * 刃が通った跡の細い輪（死の輪）。半径 R の円周のうち、角 from から時計回りに upTo ラジアン分だけ。
 * 1 周を一気に描くと UI の円に見えるので、刃の通った所だけに残す
 */
function trailRing(frame, R, width, from, upTo, o = {}) {
  const bright = o.bright ?? 0.3;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 13;
  if (upTo <= 0) return;
  paint(
    frame,
    (x, y) => {
      const d = Math.abs(Math.hypot(x, y) - R);
      if (d > width / 2) return -1;
      const t = mod(Math.atan2(y, x) - from, TAU);
      if (t > upTo) return -1;
      if (!survives(x, y, erosion, 1 - d / width, seed)) return -1;
      return clamp01(bright * (0.6 + 0.4 * (t / Math.max(upTo, 1e-3))) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - width - 1, y0: -R - width - 1, x1: R + width + 1, y1: R + width + 1 }, dither: 0 },
  );
}

/** 薄い煙のひと塊（段 1〜3）。縁はノイズで揺らぎ、erosion で薄れて欠ける */
function smoke(frame, x0, y0, rad, o = {}) {
  const bright = o.bright ?? 0.28;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  if (rad < 1 || erosion >= 1) return;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - x0, y - y0) / rad;
      const n = valueNoise(x, y, 3, seed);
      if (d > 1 - 0.45 * n) return -1;
      if (erosion > 0 && valueNoise(x, y, 2.2, seed + 5) < erosion * 0.9) return -1;
      return clamp01(bright * (0.45 + 0.55 * (1 - d)) * (1 - erosion * 0.4));
    },
    { bounds: { x0: x0 - rad - 1, y0: y0 - rad - 1, x1: x0 + rad + 1, y1: y0 + rad + 1 }, dither: 0.08 },
  );
}

/** 魂の粒の 1 つ: 頭の 2 ドットと、来た向き (ux, uy) の後ろへ細る尾 */
function soulDot(frame, x, y, ux, uy, fade) {
  const level = Math.max(3, Math.round(3 + 3.6 * fade));
  dot(frame, x, y, level);
  if (fade > 0.5) dot(frame, x + uy * 0.9, y - ux * 0.9, level - 1);
  if (fade > 0.3) {
    dot(frame, x - ux * 1.2, y - uy * 1.2, Math.max(2, level - 1));
    dot(frame, x - ux * 2.4, y - uy * 2.4, Math.max(2, level - 3));
  }
}

/**
 * 魂の粒の群れ。age（フレーム）で動かす。spawn(i, rnd) → {x, y, vx, vy, life, wob, drag?}
 * （wob は進む向きに直交する揺れの幅）
 */
function souls(frame, age, count, seed, spawn) {
  if (age < 0) return;
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!s || age > s.life) continue;
    const drag = s.drag ?? 0.9;
    const travel = drag === 1 ? age : (1 - Math.pow(drag, age)) / (1 - drag);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / sp;
    const uy = s.vy / sp;
    const wob = (s.wob ?? 1.5) * Math.sin(age * 1.3 + i * 2.1);
    soulDot(frame, s.x + s.vx * travel - uy * wob, s.y + s.vy * travel + ux * wob, ux, uy, 1 - age / (s.life + 1));
  }
}

/**
 * 渦を巻いて中心へ吸い込まれる魂。p（0..1）で外周 r0 から中心の r1 へ、時計回りに turn ラジアン回りながら寄る。
 * 尾は渦の道を 2 ドット戻った所へ引く（直線の尾だと放射の星に見える）
 */
function spiralSoul(frame, a0, r0, r1, turn, p, fade) {
  const at = (q) => {
    const e = easeSwing(q);
    const r = r0 + (r1 - r0) * e;
    const a = a0 + turn * e;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };
  const now = at(p);
  const prev = at(Math.max(0, p - 0.08));
  const dx = now.x - prev.x;
  const dy = now.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  soulDot(frame, now.x, now.y, dx / len, dy / len, fade);
}

// -----------------------------------------------------------------------------
// 魂刈り（instant）: 行為 0 = 引き寄せ（半径 60）、行為 1 = 一周の薙ぎ（circle size 84 → 半径 42 論理 = 84 ドット）
// -----------------------------------------------------------------------------

/** 引き寄せの届き（半径 60 論理 px × 2） */
const PULL_R = 120;
/** 敵を引き寄せる先の距離（toDistance 22 論理 px × 2）。鉤の輪はここまで締まる */
const PULL_TO = 44;
const PULL_N = 9;
/** 鉤の数（輪を回る鎌の鉤。多いと歯車に見える） */
const PULL_HOOKS = 6;

/** 魂刈りの発動: 周りの魂が渦を巻いて自分へ集まり、満ちた瞬間に煙の輪が弾ける */
function soulReapCast(frame, f) {
  const N = 9;
  const gather = 5;
  if (f < gather) {
    const p = (f + 1) / gather;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU + hash1(i, 3101) * 0.4;
      const r0 = 52 + hash1(i, 3102) * 16;
      const q = clamp01(p * (0.9 + 0.3 * hash1(i, 3103)));
      if (q >= 0.97) continue;
      spiralSoul(frame, a0, r0, 6, 1.6, q, 0.55 + 0.45 * q);
    }
    // 締まる細い輪（闇が自分へ集まる）
    ring(frame, { radius: 40 - 26 * p, width: 1.8, erosion: 0.35 - 0.3 * p, bright: 0.3 + 0.35 * p, seed: 3104 });
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  // 弾けた煙の輪（小さな煙を輪に並べて揺らいだ輪に見せる）
  const r = 10 + k * 26;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + k * 0.4;
    smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 3.5 + k * 3, { erosion: Math.min(0.95, 0.05 + k * 0.85), bright: 0.3, seed: 3110 + i });
  }
  if (f === gather) sparkle(frame, 0, 0, 4);
  // 中心の鎌の閃き: 小さな鉤が 1 つ、時計回りに返る（大鎌を構え直す手応え）
  if (k < 0.8) sickle(frame, { ox: 0, oy: 0, R: 14 + k * 4, T: 5 * (1 - k * 0.5), from: -150 * DEG, to: 30 * DEG, erosion: k * 0.7, seed: 3120 });
}

/**
 * 1 つの引き寄せの鉤: 輪の上の角 a、半径 r に、外へ膨らんで内（中心）へ返る小さな鎌。
 * 敵の外側から掛けて中心へ引く向き
 */
function pullHook(frame, a, r, size, o = {}) {
  const cx = Math.cos(a) * (r - size * 0.7);
  const cy = Math.sin(a) * (r - size * 0.7);
  sickle(frame, { ox: cx, oy: cy, R: size, T: size * 0.5, from: a - 100 * DEG, to: a + 120 * DEG, bright: o.bright ?? 1, erosion: o.erosion ?? 0, seed: o.seed ?? 3201 });
}

/** 魂刈りの引き寄せ: 届きの縁に鎌の鉤が並んで掛かり、回りながら内へ締まる。鉤の外に引き戻す筋、縁の煙 */
function soulReapPull(frame, f) {
  const A = 5;
  const k = f < A ? 0 : (f - A + 1) / (PULL_N - A);
  // 締まり: 1 枚目で縁に現れ、active の間に引き寄せ先の少し外まで
  const p = f < A ? Math.pow(f / (A - 1), 1.25) : 1;
  const r = PULL_R - (PULL_R - PULL_TO - 10) * p;
  const turn = p * 0.9 + k * 0.2;
  // 届きの縁の薄い輪（1 枚目だけはっきり、締まるにつれ崩れる）
  if (f < A) ring(frame, { radius: PULL_R, width: 2, erosion: 0.25 + 0.7 * p, bright: 0.38, seed: 3202 });
  for (let i = 0; i < PULL_HOOKS; i++) {
    const a = (i / PULL_HOOKS) * TAU - Math.PI / 2 + turn;
    if (k < 0.9) pullHook(frame, a, r, 19 - 5 * p - 3 * k, { erosion: k * 0.9, bright: f === A - 1 ? 1.08 : 1, seed: 3203 + i });
    // 回りながら締まる鉤の通り道: 鉤の後ろ（反時計回りの側）へ、外から内へ下る細い弧。放射の筋は星に見えるので引かない
    if (f >= 1 && k < 0.6) {
      for (let j = 0; j < 2; j++) {
        const rr = r + 3 + j * 4 + (1 - p) * 6;
        arcLine(frame, { radius: rr, from: a - 0.55 - j * 0.1, to: a - 0.12, bright: (0.5 - j * 0.12) * (1 - k) });
      }
    }
    if (f === A - 1) sparkle(frame, Math.cos(a) * (r - 2), Math.sin(a) * (r - 2), 2);
  }
  // 縁から中心へ吸われる煙
  if (f >= 2) {
    const age = f - 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + hash1(i, 3220) * 0.5;
      const g = age / (PULL_N - 2);
      const rr = PULL_R - 6 - age * (8 + hash1(i, 3221) * 4);
      smoke(frame, Math.cos(a) * rr, Math.sin(a) * rr, 6 * (1 - g * 0.4), { erosion: Math.min(0.95, 0.1 + g), bright: 0.26, seed: 3222 + i });
    }
  }
}

/**
 * 魂刈りで掴んだ敵（原点 = 敵、+x = 自分から敵への向き。自分は −x の PULL_TO ドット先）。
 * 敵の向こう側から鉤が回り込んで掛かり、自分へ向かって魂の鎖が張って引き戻す
 */
function soulReapTarget(frame, f) {
  const N = 7;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  // 鉤: 敵の向こう（+x）を回って、自分の側（−x）へ尖る
  if (k < 0.9) {
    const grow = f === 0 ? 0.6 : 1;
    sickle(frame, { ox: 0, oy: 0, R: 17, T: 7 * (1 - 0.4 * k), from: -130 * DEG * grow, to: 110 * DEG, erosion: k * 0.85, seed: 3301 });
  }
  if (f === 1) sparkle(frame, 16, 0, 3);
  // 魂の鎖: 自分の側へ並ぶ短い環（楕円の輪）。自分に近い環ほど早く消える
  for (let i = 0; i < 5; i++) {
    const x = -16 - i * 7;
    const fade = k * 1.3 - (4 - i) * 0.12;
    if (fade >= 0.9 || f === 0) continue;
    ring(frame, { ox: x, radius: 2.6, width: 1.4, squash: 1.5, erosion: Math.max(0, fade), bright: 0.62 - i * 0.05, seed: 3302 + i });
  }
  // 引き戻しの筋（自分の側が明るい）
  if (k < 0.7) {
    for (let i = 0; i < 4; i++) {
      const y = (i < 2 ? -1 : 1) * (8 + (i % 2) * 5);
      const x0 = 10 - k * 14;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 22 - hash1(i, 3310) * 10, by: y * 0.6, bright: 0.45 * (1 - k) });
    }
  }
  souls(frame, f - 1, 5, 3311, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.2;
    const sp = 1.6 + rnd(2) * 1.6;
    return { x: -4, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), wob: 1 };
  });
}

/** 一周の薙ぎの半径（size 84 → 半径 42 論理 px × 2） */
const REAP_R = 84;
const REAP_T = 24;
const REAP_N = 11;
const REAP_A = 5;
/** 斬り始めの角（左。大鎌は後ろへ引いてから大きく回す） */
const REAP_FROM = Math.PI;

/** 魂刈りの薙ぎ: 巨大な鎌の刃が 1 周し、振り切ると刃が崩れて、刈った魂が渦を巻いて自分へ吸い込まれる */
function soulReapSwing(frame, f) {
  const A = REAP_A;
  const k = f < A ? 0 : (f - A + 1) / (REAP_N - A);
  const hookSpan = 26 * DEG;
  let head;
  let tail;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = REAP_FROM + TAU * p;
    tail = head - Math.min(TAU - hookSpan - 0.15, TAU * (0.12 + p * 0.78));
  } else {
    head = REAP_FROM + TAU + 0.3 * k;
    tail = head - (TAU - hookSpan - 0.15) * (1 - 0.8 * Math.pow(k, 0.8));
  }
  const T = REAP_T * (f < A ? 0.7 + 0.3 * ((f + 1) / A) : 1 - 0.45 * k);
  if (k < 0.92) {
    blade(frame, {
      R: REAP_R,
      T,
      head,
      tail,
      hookSpan: hookSpan * (1 - 0.5 * k),
      hookDepth: 24 * (1 - 0.5 * k),
      erosion: k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0,
      bright: f === A - 1 ? 1.1 : 1 - 0.3 * k,
      seed: 3401,
      wisp: 0.4,
    });
  }
  // 速度線: 刃の外側に 2 本
  if (f < A) {
    for (let i = 0; i < 2; i++) {
      const len = Math.min((head - tail) * 0.45, 0.6 + 0.7 * hash1(i, 3402));
      const end = head - 0.15 - 0.25 * hash1(i, 3403);
      arcLine(frame, { radius: REAP_R + 3 + i * 3.2, from: end - len, to: end, bright: 0.55 - i * 0.1 });
    }
  }
  if (f === A - 1) sparkle(frame, Math.cos(head + 0.2) * (REAP_R - 10), Math.sin(head + 0.2) * (REAP_R - 10), 4);
  const age = f - (A - 1);
  if (age < 0) return;
  // 刃の外縁から膨らむ煙
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + hash1(i, 3404) * 0.4;
    const g = age / (REAP_N - A + 1);
    const r = REAP_R - 6 + age * (1.6 + hash1(i, 3405) * 1.2);
    smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 6 * (0.8 + g * 0.8), { erosion: Math.max(0, g * 1.1 - 0.1), bright: 0.3 - g * 0.1, seed: 3406 + i });
  }
  // 刈った魂: 刃の通り道から渦を巻いて自分（中心）へ（倒した数だけ生命を取り戻す）
  for (let i = 0; i < 16; i++) {
    const delay = Math.floor(hash1(i, 3420) * 2);
    const q = (age - delay) / (REAP_N - A - 0.5);
    if (q < 0 || q >= 0.95) continue;
    const a0 = (i / 16) * TAU + hash1(i, 3421) * 0.3;
    spiralSoul(frame, a0, REAP_R - 8 - hash1(i, 3422) * 10, 8, 1.3, q, 1 - q * 0.5);
  }
  if (f === REAP_N - 2) sparkle(frame, 0, 0, 2);
}

/** 魂刈りの地面: 刃の通った周に残る死の輪。振り切ると全周が閉じ、内側の薄い輪と共に崩れる */
function soulReapGround(frame, f) {
  const A = REAP_A;
  const k = f < A ? 0 : (f - A + 1) / (REAP_N - A);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  trailRing(frame, REAP_R - 14, 2.2, REAP_FROM, TAU * p - 0.1, { erosion: Math.min(0.94, 0.25 + k * 0.7), bright: 0.4, seed: 3501 });
  if (f >= A - 1) ring(frame, { radius: REAP_R * 0.45 + k * 6, width: 1.6, erosion: Math.min(0.95, 0.35 + k * 0.6), bright: 0.3, seed: 3502 });
}

// -----------------------------------------------------------------------------
// 冥府の渦（instant）: circle size 90（半径 45 論理 = 90 ドット）・3 段ヒット
// 1 本の刃が渦を巻いて 3 周し、周るたびに内へ締まる（周の終わりが当たり）。足元に回る渦の腕
// -----------------------------------------------------------------------------

const VORTEX_R = 90;
/** 1 周ごとに締まる半径（ドット） */
const VORTEX_STEP = 11;
const VORTEX_N = 13;
const VORTEX_A = 8;
const VORTEX_LAPS = 3;
const VORTEX_FROM = -Math.PI / 2;
/** 1 ラジアン進むごとに締まる半径 */
const VORTEX_RATE = VORTEX_STEP / TAU;

/** 渦の刃の先端の角（f は小数可）。active の間に 3 周、振り終わりは少しだけ惰性で進む */
function vortexHead(f) {
  if (f < VORTEX_A) return VORTEX_FROM + TAU * VORTEX_LAPS * ((f + 1) / VORTEX_A) ** 0.92;
  const k = (f - VORTEX_A + 1) / (VORTEX_N - VORTEX_A);
  return VORTEX_FROM + TAU * VORTEX_LAPS + 0.9 * Math.sin(k * Math.PI * 0.5);
}

/** 渦の半径（先端の進んだ角から） */
function vortexRadius(a) {
  return VORTEX_R - VORTEX_RATE * Math.max(0, a - VORTEX_FROM);
}

function netherVortexSwing(frame, f) {
  const A = VORTEX_A;
  const k = f < A ? 0 : (f - A + 1) / (VORTEX_N - A);
  const head = vortexHead(f);
  // 尾は 3/4 周まで（1 周を超えると 2 本目の刃に見える）
  const len = f < A ? Math.min(TAU * 0.75, (head - VORTEX_FROM) * 0.9 + 0.2) : TAU * 0.75 * (1 - 0.7 * Math.pow(k, 0.8));
  const tail = head - len;
  // 当たりの瞬間（周の終わり）に刃が明るむ
  const lapNow = Math.floor((head - VORTEX_FROM) / TAU + 0.08);
  const lapPrev = f === 0 ? 0 : Math.floor((vortexHead(f - 1) - VORTEX_FROM) / TAU + 0.08);
  const hitNow = f < A + 1 && lapNow > lapPrev;
  const T = 20 * (f < A ? 0.75 + 0.25 * Math.min(1, (f + 1) / 3) : 0.8 - 0.5 * k);
  if (k < 0.92) {
    blade(frame, {
      R: vortexRadius(tail),
      T,
      head,
      tail,
      spiral: VORTEX_RATE,
      hookSpan: 24 * DEG * (1 - 0.5 * k),
      hookDepth: 20 * (1 - 0.5 * k),
      erosion: k > 0 ? 0.05 + 0.85 * Math.pow(k, 1.1) : 0,
      bright: hitNow ? 1.12 : 1 - 0.3 * k,
      seed: 3601,
      wisp: 0.5,
    });
  }
  if (hitNow) {
    const a = head + 0.25;
    const r = vortexRadius(head) - 8;
    sparkle(frame, Math.cos(a) * r, Math.sin(a) * r, lapNow >= VORTEX_LAPS ? 4 : 3);
  }
  // 速度線: 刃の外側に 1 本だけ（渦なので外が回ってくる）
  if (f < A) {
    const end = head - 0.2;
    const from = end - Math.min(len * 0.4, 1.1);
    arcLine(frame, { radius: vortexRadius(end) + 4, from, to: end, bright: 0.5 });
  }
  // 吸い込まれる魂: 外周から渦に乗って中心へ（active の間から流れ始め、振り終わりで吸い切る）
  for (let i = 0; i < 18; i++) {
    const start = hash1(i, 3610) * 6;
    const q = (f - start) / 6;
    if (q < 0 || q >= 0.95) continue;
    const a0 = (i / 18) * TAU;
    spiralSoul(frame, a0, VORTEX_R + 14 + hash1(i, 3611) * 10, 10, 2.2, q, 0.9 - q * 0.4);
  }
  // 振り終わり: 中心で煙が渦を巻いて崩れる
  if (f >= A - 1) {
    const age = f - (A - 1);
    const g = age / (VORTEX_N - A + 1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + age * 0.5;
      const r = 12 + age * 2;
      smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 3.5 * (0.7 + g), { erosion: Math.max(0, g * 1.1 - 0.05), bright: 0.3 - g * 0.1, seed: 3620 + i });
    }
    if (age === 0) sparkle(frame, 0, 0, 3);
  }
}

/** 渦の腕の数（3 = 3 度の薙ぎ） */
const VORTEX_ARMS = 3;

/**
 * 冥府の渦の地面: 中心へ巻き込む 3 本の渦の腕と、届きの縁の輪。腕は刃と同じ向き（時計回り）に回り、
 * 振り終わりに中心から千切れて消える
 */
function netherVortexGround(frame, f) {
  const k = f < VORTEX_A ? 0 : (f - VORTEX_A + 1) / (VORTEX_N - VORTEX_A);
  const grow = Math.min(1, (f + 1) / 3);
  const turn = f * 0.45;
  const outer = VORTEX_R - 4;
  // 渦の腕: 半径が小さいほど角が進む（中心へ巻き込む螺旋）。r = outer で角 = 腕の根元
  const wind = 2.4;
  const erosion = k * 0.95;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > outer * grow || r < 10) return -1;
      const s = 1 - r / outer;
      const armAngle = Math.atan2(y, x) - turn - s * wind * TAU * 0.5;
      const arm = mod(armAngle * (VORTEX_ARMS / TAU), 1);
      const d = Math.min(arm, 1 - arm) * (TAU / VORTEX_ARMS) * r;
      const w = 2.4 + 3 * (1 - s);
      if (d > w / 2) return -1;
      if (!survives(x, y, erosion + s * 0.25, 1 - d / w, 3701)) return -1;
      return clamp01((0.42 - 0.16 * s) * (1 - (2 * d) / w * 0.4));
    },
    { bounds: { x0: -outer - 2, y0: -outer - 2, x1: outer + 2, y1: outer + 2 }, dither: 0 },
  );
  ring(frame, { radius: VORTEX_R - 2 - k * 6, width: 2, erosion: Math.min(0.95, 0.2 + erosion), bright: 0.36, seed: 3702 });
}

/** 冥府の渦の発動: 自分の周りに小さな渦が巻き起こり、煙の腕が締まって中心で閃く */
function netherVortexCast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  const outer = 26 + 26 * Math.min(1, (f + 1) / 4) - (f > 5 ? (f - 5) * 8 : 0);
  const turn = f * 0.7;
  const erosion = f > 5 ? (f - 5) / 3.5 : 0.1;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > outer || r < 5) return -1;
      const s = 1 - r / outer;
      const armAngle = Math.atan2(y, x) - turn - s * 3.2;
      const arm = mod(armAngle * (VORTEX_ARMS / TAU), 1);
      const d = Math.min(arm, 1 - arm) * (TAU / VORTEX_ARMS) * r;
      const w = 2 + 3.5 * (1 - s);
      if (d > w / 2) return -1;
      if (!survives(x, y, erosion, 1 - d / w, 3801)) return -1;
      return Math.min(BODY_CAP, clamp01(0.35 + 0.4 * s));
    },
    { bounds: { x0: -outer - 2, y0: -outer - 2, x1: outer + 2, y1: outer + 2 }, dither: 0 },
  );
  // 外から吸い込まれる魂
  for (let i = 0; i < 9; i++) {
    const q = (f - hash1(i, 3802) * 2) / 6;
    if (q < 0 || q >= 0.95) continue;
    spiralSoul(frame, (i / 9) * TAU, 56 + hash1(i, 3803) * 10, 8, 2, q, 0.9 - q * 0.3);
  }
  if (f === 5) sparkle(frame, 0, 0, 4);
  if (f === 6) sparkle(frame, 0, 0, 2);
  if (k > 0.6) ring(frame, { radius: 8 + (f - 5) * 9, width: 2, erosion: Math.min(0.95, (k - 0.6) * 2.2), bright: 0.5, seed: 3804 });
}

// -----------------------------------------------------------------------------
// 死神の間合い（持続）: 頭上に幻の大鎌が浮かび、魂が腰の周りを回り続ける。dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/** キャラの足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 幻の鎌の刃の円の中心（頭の上・少し後ろ）と外縁の半径 */
const PHANTOM = { x: 2, y: -26, R: 30, T: 9 };
/** 幻の鎌の刃が回る範囲（左上から頭上を越えて右へ。右端で内へ返る鉤） */
const PHANTOM_TAIL = -165 * DEG;
const PHANTOM_HEAD = -25 * DEG;
/** 纏いの 1 巡のフレーム数 */
const REACH_N = 12;

/** 幻の大鎌: 柄（左下へ伸びる細い線）と、頭上に弧を描く刃。bob で上下に揺れる */
function phantomScythe(frame, o) {
  const bob = o.bob ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const grow = o.grow ?? 1;
  const cy = PHANTOM.y + bob;
  // 柄: 刃の根元（左端）から、キャラの左の背を通って足元へ（顔を横切らない）
  const rootA = PHANTOM_TAIL + 0.1;
  const rx = PHANTOM.x + Math.cos(rootA) * (PHANTOM.R - 4);
  const ry = cy + Math.sin(rootA) * (PHANTOM.R - 4);
  const ex = rx + (-18 - rx) * grow;
  const ey = ry + (FEET_Y + 8 - ry) * grow;
  if (erosion < 0.8) streakLine(frame, { ax: ex, ay: ey, bx: rx, by: ry, width: 1.8, bright: 0.5 * bright * (1 - erosion) });
  const head = PHANTOM_TAIL + (PHANTOM_HEAD - PHANTOM_TAIL) * grow;
  blade(frame, {
    ox: PHANTOM.x,
    oy: cy,
    R: PHANTOM.R,
    T: PHANTOM.T,
    head,
    tail: PHANTOM_TAIL,
    hookSpan: 40 * DEG * grow,
    hookDepth: 14 * grow,
    erosion,
    bright,
    seed: o.seed ?? 3901,
    wisp: 0.3,
    edge: 1.3,
  });
}

/** 腰の周りを回る魂の軌道（上下に潰した楕円） */
const ORBIT = { rx: 30, ry: 11, y: 4 };
const ORBIT_SOULS = 3;

/** 死神の間合いの発動: 足元から煙が噴き、幻の大鎌が頭上に引き抜かれるように現れて一度閃く */
function reaperReachCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 足元の輪（地面に置いた輪）
  ring(frame, { oy: FEET_Y, radius: 8 + f * 5, width: 2.4 - k, squash: 2.2, erosion: Math.min(0.94, k * 0.95), bright: 0.8 - k * 0.3, seed: 3951 });
  // 噴き上がる煙
  for (let i = 0; i < 6; i++) {
    const s = i - 2.5;
    const age = f - Math.abs(s) * 0.4;
    if (age < 0) continue;
    const g = age / 7;
    if (g >= 1) continue;
    smoke(frame, s * 12, FEET_Y - age * 6 - hash1(i, 3952) * 4, 5 + age * 1.2, { erosion: Math.max(0, g * 1.15 - 0.1), bright: 0.3, seed: 3953 + i });
  }
  // 幻の大鎌: 2 枚目から刃が頭上を走って現れ、5 枚目で満ちて閃き、あとは纏いへ引き継ぐ
  if (f >= 1) {
    const grow = Math.min(1, easeSwing(f / 4));
    const fade = f > 6 ? (f - 6) / 3 : 0;
    phantomScythe(frame, { grow, bright: f === 4 ? 1.12 : 1, erosion: fade * 0.6, seed: 3960 });
  }
  if (f === 4) sparkle(frame, PHANTOM.x + Math.cos(PHANTOM_HEAD + 0.3) * (PHANTOM.R - 8), PHANTOM.y + Math.sin(PHANTOM_HEAD + 0.3) * (PHANTOM.R - 8), 4);
  // 刃の通り道から外へ漂う魂
  souls(frame, f - 3, 10, 3970, (i, rnd) => {
    const a = PHANTOM_TAIL + (PHANTOM_HEAD - PHANTOM_TAIL) * rnd(1);
    const r = PHANTOM.R + 1 + rnd(2) * 3;
    const sp = 1.4 + rnd(3) * 1.4;
    return { x: PHANTOM.x + Math.cos(a) * r, y: PHANTOM.y + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), wob: 1.2 };
  });
}

/** 死神の間合いの纏い（持続中ずっと。位相が 1 巡で一周するので継ぎ目が出ない） */
function reaperReachSustain(frame, f) {
  const cycle = f / REACH_N;
  const breath = Math.sin(cycle * TAU);
  phantomScythe(frame, { bob: Math.round(breath * 1.5), bright: 0.9 + 0.08 * breath, seed: 3960 });
  // 刃の外縁から千切れて漂う煙（刃に沿った 3 か所。位相で外へ流れて薄れ、1 巡で戻る）
  for (let i = 0; i < 3; i++) {
    const t = (cycle + i / 3) % 1;
    const a = PHANTOM_TAIL + (PHANTOM_HEAD - PHANTOM_TAIL) * (0.25 + 0.3 * i);
    const r = PHANTOM.R + 2 + t * 10;
    smoke(frame, PHANTOM.x + Math.cos(a) * r, PHANTOM.y + Math.round(breath * 1.5) + Math.sin(a) * r, 3 + t * 3, { erosion: Math.max(0, t * 1.2 - 0.2), bright: 0.26, seed: 3980 + i });
  }
  // 腰の周りを回る魂: 奥（上半分）は暗く、手前は明るい
  for (let i = 0; i < ORBIT_SOULS; i++) {
    const a = cycle * TAU + (i / ORBIT_SOULS) * TAU;
    const x = Math.cos(a) * ORBIT.rx;
    const y = ORBIT.y + Math.sin(a) * ORBIT.ry;
    const front = Math.sin(a) > 0;
    // 奥を通る間はキャラの体に隠れる（中央は描かない）
    if (!front && Math.abs(x) < 12) continue;
    const ux = -Math.sin(a) * ORBIT.rx;
    const uy = Math.cos(a) * ORBIT.ry;
    const len = Math.hypot(ux, uy) || 1;
    soulDot(frame, x, y, ux / len, uy / len, front ? 0.95 : 0.45);
    // 通った跡の細い弧（2 ドット間隔で 3 つ、後ろへ薄れる）
    for (let j = 1; j <= 3; j++) {
      const b = a - j * 0.18;
      const bx = Math.cos(b) * ORBIT.rx;
      if (!front && Math.abs(bx) < 12) continue;
      dot(frame, bx, ORBIT.y + Math.sin(b) * ORBIT.ry, Math.max(2, (front ? 4 : 3) - j + 1));
    }
  }
  if (f === 3) sparkle(frame, PHANTOM.x + Math.cos(PHANTOM_HEAD + 0.35) * (PHANTOM.R - 9), PHANTOM.y + 1 + Math.sin(PHANTOM_HEAD + 0.35) * (PHANTOM.R - 9), 2);
}

/** 纏いの足元: 地面に置いた輪と、その上を回る 3 つの小さな鎌の鉤（3 回対称。1 巡で 1/3 周して継ぎ目なし） */
function reaperReachGround(frame, f) {
  const cycle = f / REACH_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 16 + pulse, width: 1.8, squash: 2.2, bright: 0.32 + 0.12 * pulse, seed: 3990 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3 + cycle / 3) * TAU;
    // 楕円の上の位置に、地面に寝かせた小さな鉤（上下に潰すため、描いてから縦を縮めた座標で描く）
    const cx = Math.cos(a) * 40;
    const cy = FEET_Y + Math.sin(a) * 18;
    sickle(squashY(frame, cy, 0.45), { ox: cx, oy: cy, R: 7, T: 3, from: a - 60 * DEG, to: a + 90 * DEG, bright: 0.5 + 0.15 * pulse, seed: 3991 + i });
  }
}

/** 縦を factor 倍に潰して描く作業面（地面に寝かせた形。paint / dot は toCanon / toGrid / raise しか使わない） */
function squashY(frame, cy, factor) {
  return {
    w: frame.w,
    h: frame.h,
    toCanon: (gx, gy) => {
      const c = frame.toCanon(gx, gy);
      return { x: c.x, y: cy + (c.y - cy) / factor };
    },
    toGrid: (x, y) => frame.toGrid(x, cy + (y - cy) * factor),
    get: (ix, iy) => frame.get(ix, iy),
    set: (ix, iy, v) => frame.set(ix, iy, v),
    raise: (ix, iy, v) => frame.raise(ix, iy, v),
  };
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 円の振り（reach 0）は出来事の大きさが 0 なので base 0（拡縮しない）。引き寄せの base は届きの半径
 */
const FX = {
  moveset: "scythe",
  ultimates: {
    "scythe.soulReap": {
      ramp: "dark",
      cast: { sheet: "scytheUlt.soulReapCast", life: 0.35 },
      acts: [
        { sheet: "scytheUlt.soulReapPull", life: 0.35, base: PULL_R / 2, pivot: "pos" },
        { sheet: "scytheUlt.soulReap", life: 0.6, base: 0, pivot: "pos", ground: "scytheUlt.soulReapGround" },
      ],
      target: { sheet: "scytheUlt.soulReapTarget", life: 0.3, pivot: "to" },
    },
    "scythe.netherVortex": {
      ramp: "dark",
      cast: { sheet: "scytheUlt.netherVortexCast", life: 0.4 },
      acts: [{ sheet: "scytheUlt.netherVortex", life: 0.75, base: 0, pivot: "pos", ground: "scytheUlt.netherVortexGround" }],
    },
    "scythe.reaperReach": {
      ramp: "dark",
      cast: { sheet: "scytheUlt.reaperReachCast", life: 0.55 },
      sustain: { sheet: "scytheUlt.reaperReach", period: 1, ground: "scytheUlt.reaperReachGround" },
    },
  },
};

export const ATLAS = {
  key: "scytheUlt",
  fx: FX,
  sheets: [
    { key: "scytheUlt.soulReapCast", dirs: 1, frames: 9, active: 0, size: 152, draw: soulReapCast },
    { key: "scytheUlt.soulReapPull", dirs: 1, frames: PULL_N, active: 5, size: 2 * (PULL_R + 40), draw: soulReapPull },
    { key: "scytheUlt.soulReapTarget", dirs: DIRS, frames: 7, active: 0, size: 128, draw: soulReapTarget },
    { key: "scytheUlt.soulReap", dirs: 1, frames: REAP_N, active: REAP_A, size: 2 * (REAP_R + 30), draw: soulReapSwing },
    { key: "scytheUlt.soulReapGround", dirs: 1, frames: REAP_N, active: REAP_A, size: 2 * (REAP_R + 4), draw: soulReapGround },
    { key: "scytheUlt.netherVortexCast", dirs: 1, frames: 9, active: 0, size: 156, draw: netherVortexCast },
    { key: "scytheUlt.netherVortex", dirs: 1, frames: VORTEX_N, active: VORTEX_A, size: 2 * (VORTEX_R + 30), draw: netherVortexSwing },
    { key: "scytheUlt.netherVortexGround", dirs: 1, frames: VORTEX_N, active: VORTEX_A, size: 2 * (VORTEX_R + 4), draw: netherVortexGround },
    { key: "scytheUlt.reaperReachCast", dirs: 1, frames: 10, active: 0, size: 160, draw: reaperReachCast },
    { key: "scytheUlt.reaperReach", dirs: 1, frames: REACH_N, active: 0, size: 128, draw: reaperReachSustain },
    { key: "scytheUlt.reaperReachGround", dirs: 1, frames: REACH_N, active: 0, size: 112, draw: reaperReachGround },
  ],
};
