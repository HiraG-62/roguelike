// 剣（moveset "sword"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/sword.json × 2 が目安
//
// 奥義は見せ場なので、剣の通常の振りより一段豪華にする（大きく・長く・崩れの段を多く）。ただし剣で固まった決まりは守る:
// - 1 回の斬撃は 1 本（円月は 1 本の弧が一周して輪に閉じる。内側に 2 本目の弧を重ねない）
// - 白（段 7）は刃の縁・閃光の細い線・光点だけ（剣気の揺らめきは段 6 までに抑える）
// - 振り終わりは崩れて消える（erosion・刃片・粒）
// 他の武器種の奥義はこのファイルを見本にする（行為ごとに 1 シート、発動 cast は奥義ごとに違う絵、地面の紋は別シート）
import { arcLine, crescentWidth, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

/** 角を [0, 2π) に（一周する弧は wrapAngle の (-π, π] では足りない） */
function wrapTau(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** 崩れの判定（shapes.mjs の survives と同じ考え: ノイズと芯からの近さで、縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

// -----------------------------------------------------------------------------
// 円月（nova 半径 64）: 1 本の弧が自分の周りを一周し、閉じて満月の輪になって外へ散る
// -----------------------------------------------------------------------------

/** 円月の輪の外縁の半径（半径 64 論理 px × 2） */
const MOON_R = 128;
/** 円月の刃の最も太い所 */
const MOON_T = 30;
/** 円月の斬撃のフレーム数と、一周に使う枚数 */
const MOON_N = 11;
const MOON_A = 5;
/** 斬り始めの角（真上。満月の弧が上から時計回りに走る） */
const MOON_FROM = -Math.PI / 2;

/**
 * 一周できる弧の刃。head = 先端の角、len = 先端から尾までの長さ（2π まで）。
 * closed（0..1）で太さを一様に寄せ、先端と尾がつながった 1 本の輪にする（2 本目の弧は作らない）
 */
function moonBlade(frame, o) {
  const { R, T, head, len } = o;
  const closed = o.closed ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const span = Math.max(1e-3, len);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R) return -1;
      const u = wrapTau(head - Math.atan2(y, x)) / span;
      if (u > 1) return -1;
      const w = T * Math.max(crescentWidth(u, 0.12, 0.7) * (1 - closed), closed * 0.62);
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u * (1 - closed)), seed)) return -1;
      // 外縁の細い線が刃の縁（白）。閉じた輪は全周が縁、走っている間は先端側 6 割だけ
      const edgeU = closed > 0.5 ? 1 : 0.6;
      if (R - r < 1.7 && u <= edgeU && erosion < 0.5) return clamp01(bright * (1.05 - 0.25 * u * (1 - closed)));
      const band = Math.floor((R - r) / 1.7);
      const grain = q > 0.2 ? 0.8 + 0.4 * hash1(band, seed) : 1;
      const fall = 0.92 - 0.5 * u * (1 - closed);
      return clamp01(Math.pow(1 - q, 1.05) * fall * grain * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

function fullMoonSlash(frame, f) {
  const A = MOON_A;
  const k = f <= A ? 0 : (f - A) / (MOON_N - 1 - A);
  let head;
  let len;
  let closed = 0;
  let T = MOON_T;
  let R = MOON_R;
  let bright = 1;
  let erosion = 0;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = MOON_FROM + TAU * p;
    // 尾は先端に遅れて伸び、一周しきる直前まで閉じない
    len = TAU * Math.min(0.93, 0.08 + p * 0.85);
    T = MOON_T * (0.6 + 0.4 * p);
    bright = 0.85 + 0.15 * p;
  } else {
    // 閉じた瞬間（f = A）に輪が満ち、そのあと外へ押し広がりながら崩れる（敵弾を払う押し出し）
    head = MOON_FROM + TAU;
    len = TAU;
    closed = 1;
    R = MOON_R + Math.round(k * 14);
    T = MOON_T * (f === A ? 0.72 : 0.62 * (1 - 0.55 * k));
    bright = f === A ? 1.1 : 1 - 0.3 * k;
    erosion = f === A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  }
  moonBlade(frame, { R, T, head, len, closed, erosion, bright, seed: 1101 });
  // 速度線: 刃の外側にだけ、先端の後ろへ沿わせる
  if (f < A) {
    // 間隔を 3 ドット空ける（詰めると網目の面に見える）
    for (let i = 0; i < 3; i++) {
      const lineLen = Math.min(len * 0.5, 0.7 + 0.8 * hash1(i, 1102));
      const end = head - 0.1 - 0.3 * hash1(i, 1103);
      arcLine(frame, { radius: R + 3 + i * 3.2, from: end - lineLen, to: end, bright: 0.6 - i * 0.1 });
    }
  } else if (k < 0.7) {
    // 押し広がる輪の外に、まばらな風の弧（4 本。刃ではなく風圧なので細く暗い）
    for (let i = 0; i < 4; i++) {
      const a = MOON_FROM + (i / 4) * TAU + hash1(i, 1104) * 0.8;
      arcLine(frame, { radius: R + 5 + k * 12, from: a, to: a + 0.5 + 0.4 * hash1(i, 1105), bright: 0.5 * (1 - k) });
    }
  }
  // 先端の光点（走っている間）と、閉じた瞬間の四方の光点
  if (f < A && f >= 1) {
    const tip = R - T * 0.3;
    sparkle(frame, Math.cos(head) * tip, Math.sin(head) * tip, f === A - 1 ? 4 : 3);
  }
  if (f === A || f === A + 1) {
    for (let i = 0; i < 4; i++) {
      const a = MOON_FROM + (i / 4) * TAU;
      sparkle(frame, Math.cos(a) * (R - 3), Math.sin(a) * (R - 3), f === A ? 4 : 2);
    }
  }
  // 刃片: 輪の全周から、接線（時計回り）と外向きへ
  if (f >= A) {
    shards(frame, f - A, 44, 1106, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = MOON_R - MOON_T * 0.5 * rnd(2);
      const sp = 4.5 + rnd(3) * 6;
      const out = 0.4 + 0.5 * rnd(4);
      const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp;
      const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.45 ? 2 : 1 };
    });
  }
}

/** 円月の地面の紋: 当たりの円の縁・内側の細い輪・12 の刻み。斬撃と同じフレームで広がり、薄れて消える */
function fullMoonGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 6 ? 0 : (f - 5) / (MOON_N - 6);
  const erosion = k * 0.9;
  const dim = 0.42 * (1 - k * 0.4);
  ring(frame, { radius: (MOON_R - 3) * (0.7 + 0.3 * grow), width: 2, erosion, bright: dim, seed: 1111 });
  ring(frame, { radius: MOON_R * 0.6 * grow, width: 1.4, erosion: Math.min(0.95, erosion + 0.1), bright: dim * 0.85, seed: 1112 });
  // 刻み: 2 つの輪の間の短い放射線。紋はゆっくり回る
  const turn = f * 0.03;
  const r0 = MOON_R * 0.64 * grow;
  const r1 = MOON_R * (0.7 + 0.2 * grow) - 8;
  // 刻みは輪が広がりきってから（広がる途中に出すと、中心からの放射の星に見える）
  if (grow < 1 || r1 <= r0 || k >= 0.85) return;
  for (let i = 0; i < 12; i++) {
    const a = MOON_FROM + (i / 12) * TAU + turn;
    const long = i % 3 === 0;
    const rr = long ? r1 : r0 + (r1 - r0) * 0.5;
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * rr, by: Math.sin(a) * rr, width: long ? 1.6 : 1.1, bright: dim * (long ? 1.1 : 0.8) * (1 - k) });
  }
}

/** 円月の発動: 気が自分へ集まって締まり（縮む輪と内向きの筋）、満ちた瞬間に小さく弾ける */
function fullMoonCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = (f + 1) / gather;
    const ringR = 50 - 38 * p;
    ring(frame, { radius: ringR, width: 2.2, bright: 0.45 + 0.4 * p, seed: 1121 });
    // 内向きの筋は輪の外側だけ（輪を横切ると歯車に見える）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const r0 = ringR + 4;
      const r1 = r0 + 16 * (1 - p * 0.5);
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: i % 2 === 0 ? 1.6 : 1.1, bright: 0.4 + 0.5 * p });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  ring(frame, { radius: 12 + k * 26, width: 3 - k * 1.2, erosion: Math.min(0.9, k * 0.8), bright: 0.9 - k * 0.3, seed: 1122 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  shards(frame, f - gather, 10, 1123, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 瞬閃（lunge 120・幅 28）: 極細の閃光が先に走り、遅れて太い切断線が通り道を割き、残像の筋が残る
// -----------------------------------------------------------------------------

/** 突進の長さ（120 論理 px × 2） */
const FLASH_L = 240;
/** 当たりの幅の半分（幅 28 論理 px） */
const FLASH_HALF = 28;
const FLASH_N = 10;
const FLASH_A = 4;

/** 極細の閃光（1〜2 ドットの直線）。x0 → x1、全長で均一に白い（streakLine は片側が暗くなる） */
function hairline(frame, x0, x1, y, width, bright) {
  paint(
    frame,
    (x, py) => {
      if (x < x0 || x > x1) return -1;
      if (Math.abs(py - y) > width / 2) return -1;
      // 両端 8 ドットだけ尖らせて暗くする
      const edge = Math.min(x - x0, x1 - x) / 8;
      return clamp01(bright * (0.55 + 0.45 * Math.min(1, edge)));
    },
    { bounds: { x0, y0: y - width - 1, x1, y1: y + width + 1 }, dither: 0 },
  );
}

function flashCutSlash(frame, f) {
  const A = FLASH_A;
  const k = f < A ? 0 : (f - A + 1) / (FLASH_N - A + 1);
  // 1) 閃光: 1 枚目で半分、2 枚目で終点まで。切断線が追いつくと消える
  if (f <= 2) {
    const reach = f === 0 ? FLASH_L * 0.6 : FLASH_L;
    hairline(frame, 0, reach, 0, f === 0 ? 1.2 : 1.6, 1);
    sparkle(frame, reach - 2, 0, f === 1 ? 4 : 3);
  }
  // 2) 遅れて走る切断線（1 本）: 2 枚目から始点側から伸び、振り終わりは始点側から終点へ崩れて痩せる
  if (f >= 1) {
    const grow = f < A ? Math.min(1, easeSwing((f) / (A - 1))) : 1;
    const T = 24 * (f < A ? 0.8 + 0.2 * grow : 1 - 0.6 * k);
    const ax = f < A ? 0 : FLASH_L * 0.45 * Math.pow(k, 1.3);
    lens(frame, { ax, ay: 0, bx: FLASH_L, by: 0, T, bias: 0, grow, erosion: f < A ? 0 : 0.05 + 0.85 * k, seed: 1201, bright: f === A - 1 ? 1.05 : 1 - k * 0.25 });
  }
  // 3) 通り道の残像: 当たりの幅の中を走る平行の筋。前へ流れて短くなる
  if (f >= 1 && k < 0.9) {
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (6 + ((i * 7) % 5) * 4 + hash1(i, 1202) * 3);
      if (Math.abs(y) > FLASH_HALF) continue;
      const len = (50 + 90 * hash1(i, 1203)) * (1 - k * 0.7);
      const x1 = FLASH_L * (0.55 + 0.4 * hash1(i, 1204)) + k * 30;
      const x0 = Math.max(-20, x1 - len);
      streakLine(frame, { ax: x0, ay: y, bx: Math.min(FLASH_L + 10, x1), by: y, width: i < 3 ? 1.4 : 1, bright: (0.6 - Math.abs(y) / 80) * (1 - k) });
    }
  }
  // 4) 終点の衝撃: 進む向きに潰れた輪が 2 枚遅れて広がる
  if (f >= 2) {
    const age = f - 2;
    ring(frame, { ox: FLASH_L - 6 - age * 2, radius: 8 + age * 6, width: 2.6, squash: 0.45, erosion: Math.min(0.9, age * 0.13), bright: 0.8 - age * 0.06, seed: 1205 });
    if (f >= 3) ring(frame, { ox: FLASH_L - 26 - age * 3, radius: 5 + age * 4, width: 1.6, squash: 0.45, erosion: Math.min(0.92, age * 0.16), bright: 0.6 - age * 0.05, seed: 1206 });
  }
  // 5) 断面の火花: 切断線に沿った位置から、線に直交する向きへ（通り道の敵を斬った手応え）
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 30, 1207, (i, rnd) => {
      const t = 0.1 + 0.85 * rnd(1);
      const side = rnd(2) > 0.5 ? 1 : -1;
      const sp = 2.5 + rnd(3) * 4;
      const along = 0.3 + rnd(4) * 0.6;
      return { x: FLASH_L * t, y: side * 2, vx: along * sp, vy: side * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
  if (f === A - 1) sparkle(frame, FLASH_L - 4, 0, 4);
}

/** 瞬閃の発動: 抜刀の閃き（前へ短く鋭い線）と、踏み切りの潰れた輪・後ろへ吹く砂の筋 */
function flashCutCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 2) {
    const g = (f + 1) / 3;
    lens(frame, { ax: -8, ay: 0, bx: -8 + 48 * g, by: 0, T: 6, bias: 0, seed: 1211, bright: 1 });
    if (f === 1) sparkle(frame, -8 + 48 * g - 2, 0, 3);
  }
  ring(frame, { ox: -6 - f * 2, radius: 6 + f * 5, width: 2.4 - k, squash: 0.5, erosion: Math.min(0.9, k * 0.9), bright: 0.8 - k * 0.3, seed: 1212 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (5 + Math.floor(i / 2) * 5 + hash1(i, 1213) * 2);
      const x0 = -10 - f * 6 - hash1(i, 1214) * 8;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 18 - hash1(i, 1215) * 16, by: y + side * 3, bright: 0.5 * (1 - k) });
    }
  }
  shards(frame, f, 8, 1216, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.6;
    const sp = 3 + rnd(2) * 3;
    return { x: -6, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

// -----------------------------------------------------------------------------
// 剣気解放（持続）: 刃の形の揺らめき（剣気）が足元から噴き上がり、持続中は周りで立ちのぼり続ける
// dirs 1（画面に揃える）: 立ちのぼる向きは向きによらず画面の上
// -----------------------------------------------------------------------------

/** 剣気の明るさの上限（白は光点だけに使う） */
const AURA_CAP = 0.78;

/**
 * 剣気の 1 本（下から上へ細る刃の形の炎）。(x, y) が根元、h が高さ、w が根元の太さ。
 * sway でしなり、erosion で千切れる。刃のように片側（左）の縁が明るい
 */
function wisp(frame, o) {
  const { x: bx, y: by, h, w } = o;
  const sway = o.sway ?? 0;
  const phase = o.phase ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const lean = o.lean ?? 0;
  if (h < 2 || w < 1 || bright <= 0) return;
  paint(
    frame,
    (x, y) => {
      const t = (by - y) / h;
      if (t < 0 || t > 1) return -1;
      // lean で先ほど外へ開く（噴き上がる勢い）、sway でしなる
      const cx = bx + sway * Math.sin(t * Math.PI * 1.4 + phase) * t + lean * t * t;
      // 根元は太く、先は刃の切っ先のように鋭く細る
      const prof = Math.pow(Math.sin((Math.PI * Math.min(1, (t + 0.06) / 0.22)) / 2), 0.5) * Math.pow(1 - t, 1.25);
      const half = (w / 2) * prof;
      const d = x - cx;
      if (half < 0.5 || Math.abs(d) > half) return -1;
      const q = Math.abs(d) / half;
      if (!survives(x, y, erosion + t * 0.25, 1 - q, seed)) return -1;
      const edge = d < 0 ? 0.1 : -0.04;
      return Math.min(AURA_CAP, clamp01(((1 - q) ** 0.9 * (0.55 + 0.45 * (1 - t)) + edge) * bright));
    },
    { bounds: { x0: bx - w - Math.abs(sway) - Math.max(0, -lean) - 2, y0: by - h - 2, x1: bx + w + Math.abs(sway) + Math.max(0, lean) + 2, y1: by + 2 } },
  );
}

/** 足元の輪の中心の高さ（キャラの足元。キャラは絵で 48 ドット） */
const FEET_Y = 18;

/** 剣気解放の発動: 足元で輪が弾け、刃の形の剣気が一斉に噴き上がって千切れる */
function swordAuraCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 足元の輪（上下に潰した楕円 = 地面に置いた輪）
  ring(frame, { oy: FEET_Y, radius: 8 + f * 5, width: 2.6 - k * 1.2, squash: 2.2, erosion: Math.min(0.92, k * 0.95), bright: 0.85 - k * 0.3, seed: 1301 });
  // 噴き上がる剣気: 7 本。中央寄りほど高く、時間差で伸びて千切れる
  for (let i = 0; i < 7; i++) {
    const s = i - 3;
    const delay = Math.abs(s) * 0.5;
    const age = f - delay;
    if (age < 0) continue;
    const rise = Math.min(1, (age + 1) / 3);
    const fade = Math.max(0, (age - 3) / 5);
    if (fade >= 1) continue;
    const h = (96 - Math.abs(s) * 12) * rise * (1 + fade * 0.3);
    wisp(frame, {
      x: s * 10 * (1 + fade * 0.4),
      y: FEET_Y + 4 - fade * 30,
      h,
      w: 14 - Math.abs(s) * 1.5,
      sway: (s || 1) * 2,
      lean: s * 7,
      phase: i,
      bright: 1.05 - fade * 0.4,
      erosion: fade * 0.85,
      seed: 1302 + i,
    });
  }
  if (f === 2) sparkle(frame, 0, FEET_Y - 92, 4);
  if (f === 3) sparkle(frame, 0, FEET_Y - 100, 2);
  // 立ちのぼる火の粉
  shards(frame, f, 16, 1310, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 60;
    return { x, y: FEET_Y, vx: x * 0.04, vy: -(4 + rnd(2) * 5), life: 4 + Math.floor(rnd(3) * 4), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.9 };
  });
}

/** 剣気の纏いの 1 巡のフレーム数 */
const AURA_N = 12;
/** 纏いの剣気の根元（x）と位相。キャラの顔を覆わないよう左右に寄せ、背の 1 本は頭の上から立てる */
const AURA_WISPS = [
  { x: -31, y: FEET_Y, h: 50, phase: 0.0 },
  { x: -22, y: FEET_Y + 4, h: 64, phase: 0.55 },
  { x: -13, y: FEET_Y + 6, h: 34, phase: 0.3 },
  { x: 13, y: FEET_Y + 6, h: 36, phase: 0.8 },
  { x: 22, y: FEET_Y + 4, h: 62, phase: 0.2 },
  { x: 31, y: FEET_Y, h: 48, phase: 0.65 },
  { x: 0, y: -22, h: 32, phase: 0.42 },
];

/** 剣気解放の纏い（持続中ずっと。period 秒で 1 巡し、位相が一周するので継ぎ目が出ない） */
function swordAuraSustain(frame, f) {
  const cycle = f / AURA_N;
  AURA_WISPS.forEach((wd, i) => {
    const t = (cycle + wd.phase) % 1;
    // 伸びて（前半）、根元から離れて上へ千切れる（後半）
    const grow = Math.min(1, t / 0.45);
    const lift = Math.max(0, (t - 0.45) / 0.55);
    wisp(frame, {
      x: wd.x + Math.sin((t + i) * TAU) * 1.5,
      y: wd.y - lift * 22,
      h: wd.h * (0.45 + 0.55 * grow) * (1 - lift * 0.35),
      w: 8 - lift * 3,
      sway: (i % 2 === 0 ? 1 : -1) * 4,
      lean: Math.sign(wd.x) * 4,
      phase: t * TAU,
      bright: 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)),
      erosion: lift * 0.75,
      seed: 1401 + i,
    });
  });
  // 立ちのぼる粒: 位相で上へ流れ、1 巡で元へ戻る
  for (let i = 0; i < 10; i++) {
    const t = (cycle + hash1(i, 1410)) % 1;
    const x = (hash1(i, 1411) - 0.5) * 70 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y + 2 - t * 64;
    if (Math.abs(x) < 10 && y > -24) continue;
    const level = Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)));
    dot(frame, x, y, Math.min(5, level));
  }
  // ときどき刃の光点（1 巡に 2 回、左右で交互）
  if (f === 2) sparkle(frame, -21, FEET_Y - 34, 2);
  if (f === 8) sparkle(frame, 21, FEET_Y - 32, 2);
}

/** 纏いの足元の輪（地面）: 脈打つ楕円と、ゆっくり回る 8 つの刻み（8 回対称なので 1 巡で継ぎ目が出ない） */
function swordAuraSustainGround(frame, f) {
  const cycle = f / AURA_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 15 + pulse, width: 1.8, squash: 2.2, bright: 0.35 + 0.15 * pulse, seed: 1420 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8 + cycle / 8) * TAU;
    const cx = Math.cos(a) * 33 * 1.12;
    const cy = FEET_Y + Math.sin(a) * 15;
    streakLine(frame, { ax: cx * 0.9, ay: FEET_Y + (cy - FEET_Y) * 0.9, bx: cx * 1.08, by: FEET_Y + (cy - FEET_Y) * 1.08, width: 1.4, bright: 0.3 + 0.12 * pulse });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 円月の base は周囲攻撃の半径、瞬閃の base は突進で進んだ距離（壁で止まれば縮む）
 */
const FX = {
  moveset: "sword",
  ultimates: {
    "sword.fullMoon": {
      ramp: "light",
      cast: { sheet: "swordUlt.fullMoonCast", life: 0.35 },
      acts: [{ sheet: "swordUlt.fullMoon", life: 0.55, base: MOON_R / 2, pivot: "pos", ground: "swordUlt.fullMoonGround" }],
    },
    "sword.flashCut": {
      ramp: "light",
      cast: { sheet: "swordUlt.flashCutCast", life: 0.3 },
      acts: [{ sheet: "swordUlt.flashCut", life: 0.5, base: FLASH_L / 2, pivot: "pos" }],
    },
    "sword.swordAura": {
      ramp: "light",
      cast: { sheet: "swordUlt.swordAuraCast", life: 0.6 },
      sustain: { sheet: "swordUlt.swordAura", period: 0.8, ground: "swordUlt.swordAuraGround" },
    },
  },
};

export const ATLAS = {
  key: "swordUlt",
  fx: FX,
  sheets: [
    { key: "swordUlt.fullMoon", dirs: 1, frames: MOON_N, active: MOON_A, size: 2 * (MOON_R + 40), draw: fullMoonSlash },
    { key: "swordUlt.fullMoonGround", dirs: 1, frames: MOON_N, active: MOON_A, size: 2 * (MOON_R + 8), draw: fullMoonGround },
    { key: "swordUlt.fullMoonCast", dirs: 1, frames: 8, active: 0, size: 136, draw: fullMoonCast },
    { key: "swordUlt.flashCut", dirs: DIRS, frames: FLASH_N, active: FLASH_A, size: 2 * (FLASH_L + 40), draw: flashCutSlash },
    { key: "swordUlt.flashCutCast", dirs: DIRS, frames: 7, active: 0, size: 128, draw: flashCutCast },
    { key: "swordUlt.swordAuraCast", dirs: 1, frames: 10, active: 0, size: 256, draw: swordAuraCast },
    { key: "swordUlt.swordAura", dirs: 1, frames: AURA_N, active: 0, size: 144, draw: swordAuraSustain },
    { key: "swordUlt.swordAuraGround", dirs: 1, frames: AURA_N, active: 0, size: 112, draw: swordAuraSustainGround },
  ],
};
