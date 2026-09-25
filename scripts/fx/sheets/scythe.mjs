// moveset "scythe"（大鎌）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/scythe.json）× 2 が目安
//
// 剣との描き分け: 弧は「鎌の刃」そのもの。剣の三日月より細く長く、先端が内側へ鉤状に巻き込む（blade の hook）。
// 尾は滑らかに消えず煙のように千切れ（wisp）、振り終わりは刃の外側へ薄い煙（smoke）と魂の粒（souls）が漂う。
// 粒は「上へ昇る」ではなく刃の外（中心から離れる向き）へ流すので、24 方向どれに回しても同じ読みになる
import { arcBounds, arcLine, easeSwing, lens, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS, WIDE_SWEEP } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 鉤の曲がりの冪。大きいほど刃先の近くで急に折れ、剣の三日月の先と見分けやすい「J」の返しになる */
const HOOK_POW = 2.6;

function mod(a, m) {
  return ((a % m) + m) % m;
}

/** 崩れの判定（shapes.mjs の survives と同じ考え方。そちらは export されていないので写す） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

// -----------------------------------------------------------------------------
// 形の部品（大鎌だけのもの）
// -----------------------------------------------------------------------------

/**
 * 鎌の刃の軌跡。中心 (ox, oy)、外縁の半径 R、最大の太さ T。tail → head へ時計回り（head > tail、差は 2π 未満）。
 * head の先に hookSpan（ラジアン）だけ刃先が続き、外縁が hookDepth ドット内側へ巻き込んで尖る（鎌の鉤）。
 * 太さは尾で細く、head の手前で最大、鉤で尖る。尾（wisp の割合）は煙のようにノイズで千切れる。
 * spiral（ドット / ラジアン）を渡すと、spiralFrom の角から進むほど半径が縮む（巻き込み）
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
  const spiralFrom = o.spiralFrom ?? tail;
  const edge = o.edge ?? 1.5;
  const rMin = Math.max(0, R - spiral * Math.max(0, head + hookSpan - spiralFrom) - T - hookDepth - 2);
  const bounds = total > Math.PI * 0.9 ? { x0: ox - R - 3, y0: oy - R - 3, x1: ox + R + 3, y1: oy + R + 3 } : arcBounds(ox, oy, rMin, R + 1, tail - 0.05, head + hookSpan + 0.05);
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + 1) return -1;
      const t = mod(Math.atan2(dy, dx) - tail, TAU);
      if (t > total) return -1;
      const Rb = R - spiral * Math.max(0, tail + t - spiralFrom);
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
      // 尾は煙のように千切れる（剣の滑らかな尾と見分ける）
      if (v < wisp && valueNoise(x, y, 3.5, seed + 3) < (1 - v / wisp) * 0.9) return -1;
      if (!survives(x, y, erosion, (1 - q) * v, seed)) return -1;
      // 外縁（刃の縁）だけ白い芯。鉤の先まで通して、先端が鋭く光る
      if (Ro - r < edge && v > 0.5 && erosion < 0.5) return clamp01(bright * (1.05 - 0.15 * h));
      const band = Math.floor((Ro - r) / 1.5);
      const grain = q > 0.25 ? 0.8 + 0.2 * hash1(band, seed) : 1;
      // 白（段 7）は縁だけに取っておくので、本体は段 6 までで止める
      return Math.min(0.78, clamp01(Math.pow(1 - q, 1.05) * (0.28 + 0.66 * v) * grain * bright * (1 - erosion * 0.45)));
    },
    { bounds },
  );
}

/**
 * 小さな鎌の鉤（鎖の先・命中の裂け目の返し）。中心 (ox, oy) の半径 R の円周上を、角 from（根元・太い）から
 * to（先端・尖る）へ。to < from なら反時計回りに巻く。外縁が白い縁
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
      return clamp01(Math.pow(1 - q, 0.9) * (0.9 - 0.3 * u) * bright * (1 - erosion * 0.4));
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
      // 刃に近い（新しい）所ほど明るい
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
  if (rad < 1) return;
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

/**
 * 魂の粒: 頭の明るいドットと、来た向きへ細る 2 ドットの尾。age（フレーム）で動かす。
 * spawn(i, rnd) → {x, y, vx, vy, life, wob}（wob は進む向きに直交する揺れの幅）
 */
function souls(frame, age, count, seed, spawn) {
  if (age < 0) return;
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!s || age > s.life) continue;
    const drag = s.drag ?? 0.9;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / sp;
    const uy = s.vy / sp;
    // ゆらゆらと漂う（直交方向の揺れ）
    const wob = (s.wob ?? 1.5) * Math.sin(age * 1.3 + i * 2.1);
    const x = s.x + s.vx * travel - uy * wob;
    const y = s.y + s.vy * travel + ux * wob;
    const fade = 1 - age / (s.life + 1);
    const level = Math.max(3, Math.round(3 + 3.6 * fade));
    dot(frame, x, y, level);
    // 頭は 2 ドット（進む向きに直交して並べる）で、火花の 1 ドットより丸く見せる
    if (fade > 0.5) dot(frame, x + uy * 0.9, y - ux * 0.9, level - 1);
    if (fade > 0.3) {
      dot(frame, x - ux * 1.2, y - uy * 1.2, Math.max(2, level - 1));
      dot(frame, x - ux * 2.4, y - uy * 2.4, Math.max(2, level - 3));
    }
  }
}

// -----------------------------------------------------------------------------
// 弧の刈り取り（左の段・ダッシュ・巻き込み・断ち・刈り取り）の時間割
// -----------------------------------------------------------------------------

/**
 * 1 フレーム。active のフレームで刃（先頭の鉤）が振り幅を走り、残りで尾が追いついて崩れ、
 * 通り道から煙と魂の粒が刃の外へ漂い出る
 */
function reapSlash(frame, f, spec) {
  const sweep = spec.sweep * DEG;
  const from = spec.from !== undefined ? spec.from * DEG : -sweep / 2 + (spec.tilt ?? 0) * DEG;
  const A = spec.active;
  const N = spec.frames;
  const ox = spec.ox ?? 0;
  const hookSpan = spec.hookSpan * DEG;
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  let hook = 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A);
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - spec.tailLen) * 0.6;
    bright = 0.84 + 0.16 * p;
  } else {
    head = from + sweep * (1 + (spec.overshoot ?? 0.04) * k);
    tail = from + sweep * Math.min(0.96, 1 - spec.tailLen + (spec.tailLen - 0.06) * Math.pow(k, 0.7));
    erosion = 0.05 + 0.85 * Math.pow(k, 1.2);
    bright = 1 - 0.3 * k;
    hook = 1 - 0.6 * k;
  }
  // 1 周以上の尾は描けないので詰める（刈り取りの 360°）
  if (head - tail > TAU - hookSpan - 0.1) tail = head - (TAU - hookSpan - 0.1);
  const T = spec.T * (f < A ? 0.72 + 0.28 * ((f + 1) / A) : 1 - 0.45 * k);
  const pulse = spec.pulses?.includes(f) ? 1.1 : 1;
  const spiralRate = spec.spiral ? spec.spiral / sweep : 0;
  if (k < 0.92) {
    blade(frame, {
      ox,
      R: spec.R,
      T,
      head,
      tail,
      hookSpan: hookSpan * hook,
      hookDepth: spec.hookDepth * hook,
      erosion,
      bright: bright * pulse,
      seed: spec.seed,
      wisp: spec.wisp ?? 0.4,
      spiral: spiralRate,
      spiralFrom: from,
    });
  }
  const radiusAt = (a) => spec.R - spiralRate * Math.max(0, a - from);
  // 速度線: 刃の外側に 1〜2 本だけ（内側には引かない。二重の弧に見える）
  if (k < 0.7) {
    for (let i = 0; i < (spec.lines ?? 2); i++) {
      const span = (head - tail) * (0.3 + 0.3 * hash1(i, spec.seed + 40)) * (1 - k);
      const end = head - (head - tail) * (0.08 + 0.1 * hash1(i, spec.seed + 41));
      if (span < 0.05 || spiralRate > 0) continue;
      arcLine(frame, { ox, radius: spec.R + 2.5 + i * 2 + k * 5, from: end - span, to: end, bright: (0.5 - i * 0.08) * (1 - k * 0.6) });
    }
  }
  // 刃先の閃き（多段は当たりのたびに）
  const flashes = spec.pulses ?? [A - 1];
  if (flashes.includes(f)) {
    const a = head + hookSpan * 0.4;
    const r = radiusAt(head) - spec.hookDepth * 0.3 - 1;
    sparkle(frame, ox + Math.cos(a) * r, Math.sin(a) * r, spec.glint ?? 3);
  }
  const age = f - (A - 1);
  if (age < 0) return;
  // 煙: 軌跡の外縁から、刃の外へ膨らみながら薄れる
  const puffs = spec.smoke ?? 5;
  for (let i = 0; i < puffs; i++) {
    const a = from + sweep * (0.15 + 0.8 * hash1(i, spec.seed + 70));
    const life = N - A + 1;
    const g = age / life;
    if (g >= 1) continue;
    const r = radiusAt(a) - spec.T * 0.3 + age * (1.2 + hash1(i, spec.seed + 71) * 1.4) * (spec.inward ? -1 : 1);
    const rad = (spec.smokeSize ?? 5) * (0.7 + 0.5 * hash1(i, spec.seed + 72)) * (0.8 + g * 0.8);
    smoke(frame, ox + Math.cos(a) * r, Math.sin(a) * r, rad, { erosion: Math.max(0, g * 1.1 - 0.1), bright: 0.3 - g * 0.1, seed: spec.seed + 73 + i });
  }
  // 魂の粒: 刃の外へ（巻き込みは中心へ）ゆっくり流れる
  souls(frame, age, spec.souls ?? 6, spec.seed + 80, (i, rnd) => {
    const a = from + sweep * (0.1 + 0.9 * rnd(1));
    // 刃の中から湧くと本体に白い点が混ざって見えるので、外縁（巻き込みは内縁）から出す
    const r = spec.inward ? radiusAt(a) - spec.T - 1 - rnd(2) * 3 : radiusAt(a) + 1 + rnd(2) * 3;
    const sp = (1.2 + rnd(3) * 1.6) * (spec.inward ? -1 : 1);
    const tan = (rnd(4) - 0.3) * 0.8;
    return {
      x: ox + Math.cos(a) * r,
      y: Math.sin(a) * r,
      vx: (Math.cos(a) - Math.sin(a) * tan) * sp,
      vy: (Math.sin(a) + Math.cos(a) * tan) * sp,
      life: 3 + Math.floor(rnd(5) * (N - A)),
      wob: 1 + rnd(6) * 1.5,
    };
  });
}

function reapSheet(key, spec, draw) {
  const size = Math.ceil(spec.R + Math.abs(spec.ox ?? 0) + (spec.pad ?? 26)) * 2;
  return { key, dirs: spec.dirs ?? (spec.sweep >= WIDE_SWEEP ? WIDE_DIRS : DIRS), frames: spec.frames, active: spec.active, size, draw: draw ?? ((frame, f) => reapSlash(frame, f, spec)) };
}

// -----------------------------------------------------------------------------
// モーションごとの定義
// -----------------------------------------------------------------------------

/** 左 1 段（arc 160° reach 30）: 細長い鎌の刃が走り、先端の鉤が巻き込む */
const L1 = { R: 60, T: 12, sweep: 150, tilt: 0, frames: 8, active: 4, tailLen: 0.75, hookSpan: 32, hookDepth: 26, lines: 2, smoke: 4, souls: 5, seed: 1101 };
/** 左 2 段（返し。描画側が上下反転）: 少し低い軌道で尾が長く、鉤が深い */
const L2 = { R: 62, T: 13, sweep: 160, tilt: 8, frames: 8, active: 4, tailLen: 0.85, hookSpan: 34, hookDepth: 28, lines: 2, smoke: 5, souls: 6, seed: 1202 };
/** 左 3 段（arc 200° reach 32・2 段ヒット）: 長い一振り。刃先が 2 回閃く（当たりの数） */
const L3 = { R: 64, T: 14, sweep: 200, tilt: 0, frames: 9, active: 5, tailLen: 0.7, hookSpan: 22, hookDepth: 15, lines: 2, smoke: 6, souls: 7, pulses: [1, 4], seed: 1303 };
/** 左 4 段（arc 270° reach 34・重い）: 大きく回り込む刈り。太く、鉤が深く、煙と魂が多い */
const L4 = { R: 70, T: 20, sweep: 270, tilt: 0, frames: 10, active: 5, tailLen: 0.65, hookSpan: 24, hookDepth: 20, lines: 2, smoke: 8, smokeSize: 6, souls: 11, glint: 4, seed: 1404 };
/** ダッシュ（arc 220° reach 30）: 走り抜けながら大きく払う。後ろへ速度線の束 */
const DASH = { R: 60, T: 13, sweep: 220, tilt: 0, frames: 8, active: 4, tailLen: 0.7, hookSpan: 20, hookDepth: 14, lines: 1, smoke: 5, souls: 6, seed: 1505 };
/** 右: 巻き込み（arc 200° reach 30）: 進むほど半径が縮む渦の刃。粒は中心へ吸い込まれる */
const WRAP = { R: 70, T: 13, sweep: 200, tilt: 0, frames: 9, active: 4, tailLen: 0.8, hookSpan: 30, hookDepth: 20, spiral: 34, inward: true, smoke: 5, souls: 9, seed: 1606 };
/** 右: 断ち（arc 120° reach 38・重い）: 最大の一撃。幅広の刃と大きな鉤、重い煙 */
const SEVER = { R: 80, T: 30, sweep: 130, tilt: 0, frames: 10, active: 4, tailLen: 0.9, hookSpan: 26, hookDepth: 28, lines: 2, smoke: 8, smokeSize: 8, souls: 12, glint: 4, wisp: 0.3, seed: 1707 };
/** 派生: 刈り取り（arc 360° reach 36・重い）: 鉤が 1 周し、通り道に死の輪（煙の輪）が残る */
const REAPING = { R: 74, T: 18, sweep: 360, from: -180, frames: 10, active: 5, tailLen: 0.7, hookSpan: 24, hookDepth: 18, lines: 1, smoke: 10, smokeSize: 6, souls: 14, glint: 4, seed: 1808 };

/** ダッシュ: 刃の弧 + 後ろへ流れる速度線 */
function dashReap(frame, f) {
  reapSlash(frame, f, DASH);
  const k = f < DASH.active ? 0 : (f - DASH.active + 1) / (DASH.frames - DASH.active + 1);
  if (k >= 0.8) return;
  for (let i = 0; i < 6; i++) {
    const y = (i - 2.5) * 9 + (hash1(i, 1551) - 0.5) * 4;
    const len = 22 + 26 * hash1(i, 1552);
    const x1 = -6 - hash1(i, 1553) * 14 - k * 26;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
  }
}

/** 刈り取り: 刃の 1 周 + 振り切ったあとに軌跡が薄い死の輪になって崩れる */
function reaping(frame, f) {
  reapSlash(frame, f, REAPING);
  const A = REAPING.active;
  if (f < A - 1) return;
  const age = f - (A - 1);
  const k = age / (REAPING.frames - A + 1);
  ring(frame, { radius: REAPING.R - 6 + age * 1.5, width: 2.2, erosion: Math.min(0.92, 0.15 + k * 0.9), bright: 0.34 * (1 - k * 0.4), seed: 1809 });
}

// -----------------------------------------------------------------------------
// 円（逆手回し・死の舞）: 自分を中心にした大きな死の輪
// -----------------------------------------------------------------------------

/** 上下を反転した作業面（逆回りの輪を描くため。paint / dot は toCanon / toGrid / raise しか使わない） */
function mirrored(frame) {
  return {
    w: frame.w,
    h: frame.h,
    toCanon: (gx, gy) => {
      const c = frame.toCanon(gx, gy);
      return { x: c.x, y: -c.y };
    },
    toGrid: (x, y) => frame.toGrid(x, -y),
    get: (ix, iy) => frame.get(ix, iy),
    set: (ix, iy, v) => frame.set(ix, iy, v),
    raise: (ix, iy, v) => frame.raise(ix, iy, v),
  };
}

/** 円の半径（circle size 64 → 絵のドットで半径 ≈ 64） */
const SPIN_R = 62;

/** 右: 逆手回し（circle size 64）。1 本の刃が逆回りに 1 周し、通った跡が薄い死の輪になる */
function reverseSpin(frame0, f) {
  const frame = mirrored(frame0);
  const A = 5;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A);
  const start = -Math.PI / 2;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = start + TAU * p + (f < A ? 0 : 0.35 * k);
  const tail = f < A ? head - Math.min(TAU * 0.55, TAU * p * 0.9) : head - TAU * 0.55 * (1 - Math.pow(k, 0.8)) - 0.05;
  if (k < 0.92) {
    blade(frame, { R: SPIN_R, T: 14 * (1 - 0.4 * k), head, tail, hookSpan: 22 * DEG * (1 - 0.5 * k), hookDepth: 15 * (1 - 0.5 * k), erosion: k > 0 ? 0.05 + 0.85 * k : 0, bright: 1 - 0.3 * k, seed: 1901, wisp: 0.5 });
  }
  // 死の輪: 刃の通った周に残る暗い輪
  trailRing(frame, SPIN_R - 10, 2, start, Math.min(TAU, head - start - 0.3), { erosion: Math.min(0.92, 0.38 + k * 0.6), bright: 0.36, seed: 1902 });
  if (f === A - 1) sparkle(frame, Math.cos(head) * (SPIN_R - 6), Math.sin(head) * (SPIN_R - 6), 3);
  const age = f - (A - 1);
  if (age < 0) return;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash1(i, 1903) * 0.6;
    const g = age / (N - A + 1);
    const r = SPIN_R - 6 + age * 1.6;
    smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 5 * (0.8 + g * 0.8), { erosion: Math.max(0, g * 1.1 - 0.1), bright: 0.28 - g * 0.08, seed: 1904 + i });
  }
  souls(frame, age, 12, 1905, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = SPIN_R - 4 - rnd(2) * 8;
    const sp = 1.3 + rnd(3) * 1.5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), wob: 1 + rnd(5) * 1.5 };
  });
}

/** 派生: 死の舞（circle size 64・3 段ヒット）。120° 離れた 3 つの鉤が輪を回り、当たりのたびに 1 本ずつ閃く */
function deathDance(frame, f) {
  const A = 6;
  const N = 10;
  const k = f < A ? 0 : (f - A + 1) / (N - A);
  const rot = f < A ? easeSwing((f + 1) / A) * TAU * 1.15 : TAU * 1.15 + Math.sin(k * Math.PI * 0.5) * 0.9;
  const spanA = 62 * DEG * (f < A ? 0.6 + 0.4 * ((f + 1) / A) : 1 - 0.5 * k);
  const hits = [0, 2, 4];
  for (let i = 0; i < 3; i++) {
    const head = rot + (i * TAU) / 3 - Math.PI / 2;
    const lit = hits[i] === f || hits[i] === f - 1 ? 1.12 : 1;
    if (k < 0.92) {
      blade(frame, { R: SPIN_R, T: 12 * (1 - 0.4 * k), head, tail: head - spanA, hookSpan: 22 * DEG * (1 - 0.5 * k), hookDepth: 15 * (1 - 0.5 * k), erosion: k > 0 ? 0.05 + 0.85 * k : 0, bright: lit * (1 - 0.3 * k), seed: 2001 + i, wisp: 0.45 });
    }
    if (hits[i] === f) sparkle(frame, Math.cos(head + 0.2) * (SPIN_R - 7), Math.sin(head + 0.2) * (SPIN_R - 7), 3);
  }
  // 死の輪: 3 つの鉤の内側を結ぶ細い輪（当たりの円の縁）
  for (let i = 0; i < 3; i++) {
    const start = (i * TAU) / 3 - Math.PI / 2 - spanA;
    trailRing(frame, SPIN_R - 16, 1.6, start, Math.min(TAU / 3 + 0.1, rot), { erosion: Math.min(0.92, 0.38 + k * 0.6), bright: 0.34, seed: 2004 + i * 10 });
  }
  const age = f - (A - 1);
  if (age < 0) return;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rot + hash1(i, 2005) * 0.5;
    const g = age / (N - A + 1);
    const r = SPIN_R - 8 + age * 1.8;
    smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 5 * (0.8 + g * 0.8), { erosion: Math.max(0, g * 1.1 - 0.1), bright: 0.28 - g * 0.08, seed: 2006 + i });
  }
  souls(frame, age, 14, 2007, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = SPIN_R - 6 - rnd(2) * 10;
    const sp = 1.3 + rnd(3) * 1.6;
    // 回転の余韻で接線方向にも流れる
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (Math.cos(a) - Math.sin(a) * 0.5) * sp, vy: (Math.sin(a) + Math.cos(a) * 0.5) * sp, life: 3 + Math.floor(rnd(4) * 3), wob: 1 + rnd(5) * 1.5 };
  });
}

// -----------------------------------------------------------------------------
// 引っ掛けて引き寄せる（鎌引き・引き倒し）
// -----------------------------------------------------------------------------

/**
 * 鎖の先の鉤: 先端 (x, y) から前へ張り出し、side の側へ回り込んで、自分の側（後ろ下）へ尖って返る「?」形。
 * 円の中心を先端の少し前・横に置き、根元（先端のすぐ横）から 240° 巻く
 */
function tipHook(frame, x, y, R, T, o = {}) {
  const side = o.side ?? -1;
  const start = -side * 70 * DEG;
  const cx = x - 3 - Math.cos(start) * R * 0.6;
  const cy = y + side * (R - 2);
  sickle(frame, { ox: cx, oy: cy, R, T, from: start, to: start + side * 240 * DEG, bright: o.bright ?? 1, erosion: o.erosion ?? 0, seed: o.seed ?? 21 });
}

/** 右: 鎌引き（thrust reach 44）。細い線が前へ伸び、先の鉤が掛かって、逆向きの速度線と共に引き戻る */
function hookPull(frame, f) {
  const A = 3;
  const N = 8;
  const reach = 86;
  const k = f < A ? 0 : (f - A + 1) / (N - A);
  const tip = f < A ? 8 + (reach - 8) * easeSwing((f + 1) / A) : reach - 58 * Math.pow(k, 0.75);
  if (k < 0.9) {
    lens(frame, { ax: 4, ay: 0, bx: tip, by: 0, T: 3.4, bias: 0, erosion: k * 0.6, seed: 2101, bright: 0.85 - k * 0.2 });
    tipHook(frame, tip, 0, 14, 7 * (1 - 0.3 * k), { erosion: k * 0.7, seed: 2102 });
  }
  if (f === A - 1) sparkle(frame, reach - 1, 0, 3);
  if (f < A) {
    // 伸びる間: 前向きの細い速度線
    for (let i = 0; i < 2; i++) {
      const y = i === 0 ? -6 : 6;
      streakLine(frame, { ax: tip - 40, ay: y, bx: tip - 16, by: y, bright: 0.4 });
    }
    return;
  }
  // 引き戻し: 自分の側が明るい（＝自分へ向かって流れる）逆向きの速度線
  if (k < 0.85) {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 6 + (hash1(i, 2103) - 0.5) * 3;
      if (Math.abs(y) < 3) continue;
      const x0 = tip + 18 + hash1(i, 2104) * 14;
      const len = 20 + 18 * hash1(i, 2105);
      streakLine(frame, { ax: x0, ay: y, bx: x0 - len, by: y, bright: 0.5 * (1 - k) });
    }
  }
  souls(frame, f - (A - 1), 6, 2106, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.6;
    const sp = 1.5 + rnd(2) * 1.5;
    return { x: reach - 6, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), wob: 1 };
  });
  smoke(frame, reach - 6 - k * 10, 0, 5 + k * 5, { erosion: Math.min(0.95, k * 1.1), bright: 0.26, seed: 2107 });
}

/** 派生: 引き倒し（thrust reach 44）。深く掛けた大きな鉤が、横へ弧を描いて手前へ引きずられ、抉った跡と煙が残る */
function dragDown(frame, f) {
  const A = 4;
  const N = 9;
  const reach = 86;
  const k = f < A ? 0 : (f - A + 1) / (N - A);
  // 引きずりの道: 先端 → 横（+y）へ膨らみながら手前へ
  const pathAt = (t) => ({ x: reach - 62 * t, y: 26 * Math.sin(Math.PI * 0.5 * t) });
  if (f < A) {
    const p = easeSwing((f + 1) / (A - 1));
    const tip = 8 + (reach - 8) * Math.min(1, p);
    lens(frame, { ax: 4, ay: 0, bx: tip, by: 0, T: 4.4, bias: 0, seed: 2201 });
    tipHook(frame, tip, 0, 17, 9, { side: 1, seed: 2202 });
    if (f === A - 1) sparkle(frame, reach - 1, 0, 3);
    for (let i = 0; i < 2; i++) {
      const y = i === 0 ? -7 : 7;
      streakLine(frame, { ax: tip - 44, ay: y, bx: tip - 18, by: y, bright: 0.4 });
    }
    return;
  }
  const t = Math.pow(k, 0.7);
  const pos = pathAt(t);
  // 抉った跡: 掛けた点から今の鉤までの太い溝（引いた向きへ反る）
  if (k < 0.95) {
    lens(frame, { ax: reach, ay: 0, bx: pos.x - 2, by: pos.y, T: 9 * (1 - 0.4 * k), bend: -9 * t, bias: 0.4, erosion: 0.1 + k * 0.8, seed: 2203, bright: 0.85 });
  }
  if (k < 0.8) {
    lens(frame, { ax: 4, ay: 0, bx: pos.x, by: pos.y, T: 3.6, bias: 0, erosion: k * 0.7, seed: 2204, bright: 0.75 });
    tipHook(frame, pos.x, pos.y, 17, 9 * (1 - 0.3 * k), { side: 1, erosion: k * 0.6, seed: 2202 });
  }
  // 逆向き（手前へ）の速度線: 引きずりの道に沿う
  if (k < 0.7) {
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 7;
      streakLine(frame, { ax: pos.x + 30, ay: pos.y + o - 8, bx: pos.x + 6, by: pos.y + o, bright: 0.45 * (1 - k) });
    }
  }
  for (let i = 0; i < 4; i++) {
    const q = pathAt(0.1 + 0.25 * i);
    const g = k;
    smoke(frame, q.x, q.y + 4, 5 * (0.8 + g), { erosion: Math.max(0, g * 1.1 - 0.15 * (i % 2)), bright: 0.28, seed: 2205 + i });
  }
  souls(frame, f - (A - 1), 8, 2209, (i, rnd) => {
    const q = pathAt(rnd(1) * 0.9);
    const a = Math.PI * 0.5 + (rnd(2) - 0.5) * 1.8;
    const sp = 1.2 + rnd(3) * 1.4;
    return { x: q.x, y: q.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), wob: 1.2 };
  });
}

// -----------------------------------------------------------------------------
// 当たりの中心に置く一閃（首刈り）
// -----------------------------------------------------------------------------

/** 派生: 首刈り（box reach 24 / size 30・重い）。当たりの中心を縦に走る短く鋭い一閃。鉤で締め、裂け目から魂が噴く */
const NECK = { ox: -78, R: 84, T: 9, sweep: 50, tilt: 0, frames: 8, active: 2, tailLen: 0.85, hookSpan: 12, hookDepth: 11, lines: 1, smoke: 3, smokeSize: 4, souls: 0, glint: 4, wisp: 0.25, seed: 2301 };

function neckReap(frame, f) {
  reapSlash(frame, f, NECK);
  const A = NECK.active;
  if (f < A - 1) return;
  const age = f - (A - 1);
  // 振り切った瞬間、首の高さ（当たりの中心）で閃く。切り口の線を別に引くと二重線に見えるので引かない
  if (age <= 1) sparkle(frame, 4, 0, age === 0 ? 4 : 3);
  souls(frame, age, 12, 2302, (i, rnd) => {
    const y = (rnd(1) - 0.5) * 50;
    const side = rnd(2) > 0.35 ? 1 : -1;
    const sp = 1.6 + rnd(3) * 2;
    return { x: 6, y, vx: side * sp, vy: (rnd(4) - 0.5) * 1.2, life: 3 + Math.floor(rnd(5) * 3), wob: 1.2 };
  });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 刃の進む向き（+x）へ走る曲がった裂け目。終わりが鉤に返り、粒が散る。heavy は太く大きく、煙の輪が広がる */
function hit(frame, f, heavy) {
  const N = heavy ? 8 : 6;
  const R = heavy ? 40 : 28;
  const T = heavy ? 11 : 7;
  const half = (heavy ? 46 : 42) * DEG;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const tail = -Math.PI / 2 - half;
  const head = tail + half * 2 * grow;
  if (k < 0.92) {
    blade(frame, { ox: 0, oy: R, R, T: T * (f === 0 ? 0.7 : 1 - 0.5 * k), head, tail, hookSpan: 26 * DEG * (1 - 0.4 * k), hookDepth: (heavy ? 12 : 8) * (1 - 0.4 * k), erosion: k > 0 ? 0.05 + 0.85 * k : 0, seed: heavy ? 2401 : 2411, wisp: 0.3 });
  }
  if (f <= 1) sparkle(frame, 0, 0, heavy ? 4 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    // 煙の輪: 小さな煙を輪に並べて重ね、ひと続きの揺らいだ輪に見せる
    const r = 9 + age * 4.5;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + age * 0.15;
      smoke(frame, Math.cos(a) * r, Math.sin(a) * r, 3.2 + age * 0.5, { erosion: Math.min(0.95, 0.05 + age * 0.14), bright: 0.26, seed: 2403 + i });
    }
  }
  if (f >= 1) {
    souls(frame, f - 1, heavy ? 12 : 7, heavy ? 2410 : 2420, (i, rnd) => {
      // 刃の進む向きに多く、残りは裂け目から左右へ
      const forward = rnd(1) > 0.4;
      const a = forward ? (rnd(2) - 0.5) * 1.1 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 0.9);
      const sp = (heavy ? 2.4 : 1.8) + rnd(4) * (heavy ? 2.2 : 1.6);
      return { x: (rnd(5) - 0.5) * 10, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(6) * (heavy ? 4 : 2)), wob: 1 };
    });
  }
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "scythe",
  motions: {
    "l:0": { sheet: "scythe.l1", pivot: "self", base: 30, measure: "reach" },
    "l:1": { sheet: "scythe.l2", pivot: "self", base: 30, measure: "reach" },
    "l:2": { sheet: "scythe.l3", pivot: "self", base: 32, measure: "reach" },
    "l:3": { sheet: "scythe.l4", pivot: "self", base: 34, measure: "reach" },
    dash: { sheet: "scythe.dash", pivot: "self", base: 30, measure: "reach" },
    // 突きの鉤は、手に持つ鎌の刃の側（向いている左右で入れ替わる）に合わせる。絵は左向きの鎌に合わせて描いてある
    "r:hookPull": { sheet: "scythe.hookPull", pivot: "self", base: 44, measure: "reach", mirror: "faceRight" },
    "r:scytheWrap": { sheet: "scythe.wrap", pivot: "self", base: 30, measure: "reach" },
    "r:reverseSpin": { sheet: "scythe.reverseSpin", pivot: "self", base: 64, measure: "size" },
    "r:scytheSever": { sheet: "scythe.sever", pivot: "self", base: 38, measure: "reach" },
    "branch:reaping": { sheet: "scythe.reaping", pivot: "self", base: 36, measure: "reach" },
    "branch:deathDance": { sheet: "scythe.deathDance", pivot: "self", base: 64, measure: "size" },
    "branch:neckReap": { sheet: "scythe.neckReap", pivot: "anchor", base: 24, measure: "reach" },
    "branch:dragDown": { sheet: "scythe.dragDown", pivot: "self", base: 44, measure: "reach" },
  },
  hit: "scythe.hit",
  hitHeavy: "scythe.hitHeavy",
};

export const ATLAS = {
  key: "scythe",
  fx: FX,
  sheets: [
    reapSheet("scythe.l1", L1),
    reapSheet("scythe.l2", L2),
    reapSheet("scythe.l3", L3),
    reapSheet("scythe.l4", L4),
    reapSheet("scythe.dash", DASH, dashReap),
    reapSheet("scythe.wrap", WRAP),
    reapSheet("scythe.sever", SEVER),
    reapSheet("scythe.reaping", REAPING, reaping),
    { key: "scythe.hookPull", dirs: DIRS, frames: 8, active: 3, size: 212, draw: hookPull },
    { key: "scythe.dragDown", dirs: DIRS, frames: 9, active: 4, size: 212, draw: dragDown },
    { key: "scythe.reverseSpin", dirs: 1, frames: 9, active: 5, size: 180, draw: reverseSpin },
    { key: "scythe.deathDance", dirs: 1, frames: 10, active: 6, size: 180, draw: deathDance },
    { key: "scythe.neckReap", dirs: DIRS, frames: NECK.frames, active: NECK.active, size: 120, draw: neckReap },
    { key: "scythe.hit", dirs: DIRS, frames: 6, active: 0, size: 96, draw: (frame, f) => hit(frame, f, false) },
    { key: "scythe.hitHeavy", dirs: DIRS, frames: 8, active: 0, size: 128, draw: (frame, f) => hit(frame, f, true) },
  ],
};
