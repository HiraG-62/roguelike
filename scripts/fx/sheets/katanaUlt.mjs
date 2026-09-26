// 刀（moveset "katana"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は katana.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/katana.json × 2 が目安
//
// 刀の奥義は「居合の美学」を大きくする。剣の奥義（太い刃・一周の輪・噴き上がる剣気）と見分けるために:
// - 刃の軌跡は細く速く、斬った後に「遅れて残る切断線」が一瞬白く光ってから点線にほどけて消える（katana.mjs の afterglow）
// - 粒は少なく小さく、漂うように（剣のような刃片の飛び散りはしない）
// - 纏いは噴き上がる炎ではなく、静けさ（波紋・舞い落ちる花弁・ふいに走る細い斬線）
// 決まり: 1 振り 1 本（燕舞は 3 度斬るので、時間と角度をはっきり分けた 3 本）・白は縁と光点だけ・反りは前へ
import { crescentWidth, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

/** 角を [0, 2π) に */
function wrapTau(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** 崩れの判定（縁から先に欠ける） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

// -----------------------------------------------------------------------------
// 共通の部品（katana.mjs から写して奥義向けに広げたもの）
// -----------------------------------------------------------------------------

/**
 * 切断線（直線）。a → b、太さ width。両端ほど暗く尖り、erosion で端から点線にほどける（中央が最後まで残る）
 */
function cutLine(frame, o) {
  const { ax, ay, bx, by } = o;
  const width = o.width ?? 1.6;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const pad = width + 2;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const f = (px * tx + py * ty) / len;
      if (f < 0 || f > 1) return -1;
      const across = -px * ty + py * tx;
      const mid = Math.sin(Math.PI * f);
      if (Math.abs(across) > (width / 2) * (0.55 + 0.45 * Math.pow(mid, 0.4))) return -1;
      if (erosion > 0 && valueNoise(f * len, 0, 5, seed) * 0.75 + mid * 0.4 - erosion * 1.15 < 0) return -1;
      return clamp01(bright * (0.45 + 0.6 * Math.pow(mid, 0.5)));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0 },
  );
}

/**
 * 余韻の時間割（age = 斬り終えてからの枚数）。0: 線が淡く現れる（遅れ）/ 1: 一瞬白く光る / 2〜: 点線にほどけて消える
 */
function afterglow(age, rest) {
  if (age < 0) return null;
  if (age === 0) return { bright: 0.6, erosion: 0 };
  if (age === 1) return { bright: 1.1, erosion: 0 };
  const k = (age - 1) / Math.max(1, rest - 1);
  if (k > 1) return null;
  return { bright: 0.85 - 0.45 * k, erosion: 0.25 + 0.72 * k };
}

/** 余韻の粒: 線から、ごく少数の小さな光点が線に直交して漂う。at(t) → {x, y, nx, ny, tx, ty} */
function lineMotes(frame, age, count, seed, at) {
  shards(frame, age, count, seed, (i, rnd) => {
    const p = at(0.1 + 0.8 * rnd(1));
    const side = rnd(2) > 0.5 ? 1 : -1;
    const sp = 0.8 + rnd(3) * 1.4;
    return { x: p.x, y: p.y, vx: p.nx * side * sp + p.tx * 0.6, vy: p.ny * side * sp + p.ty * 0.6, life: 3 + Math.floor(rnd(4) * 3), size: 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 一刀両断（lunge 84・幅 26・重い）: 細い一閃が通り道を走り抜け、一拍の「間」のあと、
// 通り道の全長に遅れて切断線が 2 度光る（1 度目で斬れ、2 度目で両断が届く）。最後は点線にほどけて静かに消える
// -----------------------------------------------------------------------------

/** 突進の長さ（84 論理 px × 2） */
const ITTOU_L = 168;
/** 当たりの幅の半分（幅 26 論理 px → 半分 13 × 2） */
const ITTOU_HALF = 26;
const ITTOU_N = 13;
const ITTOU_A = 3;
/** 切断線が光る枚数（1 度目・2 度目） */
const ITTOU_FLASH1 = 5;
const ITTOU_FLASH2 = 7;

function ittouSlash(frame, f) {
  const L = ITTOU_L;
  // 1) 踏み込みの一閃: 細いレンズが始点から終点へ一気に伸びる（剣の瞬閃より細く、白い芯が長く通る）
  if (f < ITTOU_A) {
    const p = easeSwing((f + 1) / ITTOU_A);
    const head = -6 + (L + 12) * p;
    lens(frame, { ax: -6, ay: 0, bx: L + 6, by: 0, T: 12, grow: p, bias: 0, seed: 3101, bright: 1 });
    streakLine(frame, { ax: -6 + (L + 12) * p * 0.12, ay: 0, bx: head - 10, by: 0, width: 1.1, bright: 1 });
    // 速度線: 刃の外側に上下 1 本ずつ。長さと位置をずらす（揃えると線路の二重線に見える）
    streakLine(frame, { ax: head - 80 * p, ay: -9, bx: head - 16, by: -9, bright: 0.45 });
    streakLine(frame, { ax: head - 50 * p - 20, ay: 10, bx: head - 34, by: 10, bright: 0.35 });
    if (f === ITTOU_A - 1) sparkle(frame, L + 2, 0, 3);
    return ittouDust(frame, f);
  }
  const age = f - ITTOU_A;
  // 2) 間: 一閃は痩せて消え、終点に納刀の小さな閃き（キン）だけが残る
  if (age === 0) {
    lens(frame, { ax: 0, ay: 0, bx: L + 6, by: 0, T: 4, bias: 0, erosion: 0.55, seed: 3101, bright: 0.6 });
    sparkle(frame, L + 6, 0, 2);
  }
  // 3) 遅れて来る切断線: 1 度目で淡く→白く、2 度目で両端へ抜けて再び白く光る
  const reach = f >= ITTOU_FLASH2 ? 26 : 12;
  let bright = 0;
  let width = 1.6;
  let erosion = 0;
  if (f === ITTOU_FLASH1 - 1) bright = 0.55;
  else if (f === ITTOU_FLASH1 || f === ITTOU_FLASH2) {
    bright = 1.12;
    width = f === ITTOU_FLASH2 ? 3 : 2.4;
  } else if (f === ITTOU_FLASH1 + 1) bright = 0.7;
  else if (f > ITTOU_FLASH2) {
    const k = (f - ITTOU_FLASH2) / (ITTOU_N - 1 - ITTOU_FLASH2);
    bright = 0.9 - 0.45 * k;
    erosion = 0.2 + 0.75 * k;
    width = 2 - 0.4 * k;
  }
  if (bright > 0) cutLine(frame, { ax: -reach, ay: 0, bx: L + reach, by: 0, width, bright, erosion, seed: 3102 });
  if (f === ITTOU_FLASH1) {
    for (const [t, s] of [
      [0.28, 2],
      [0.62, 3],
      [0.94, 2],
    ]) {
      sparkle(frame, L * t, 0, s);
    }
  }
  if (f === ITTOU_FLASH2) {
    sparkle(frame, L * 0.5, 0, 4);
    // 両断の一点: 通り道の中ほどに、当たりの幅いっぱいの直交する細い閃き
    cutLine(frame, { ax: L * 0.5, ay: -16, bx: L * 0.5, by: 16, width: 1.2, bright: 0.8, seed: 3107 });
    sparkle(frame, L + reach - 4, 0, 2);
  }
  // 4) 裂けた空気: 2 度目の光のあと、線の両側へ暗い細い筋が離れていく（当たりの幅まで）
  if (f >= ITTOU_FLASH2 && f <= ITTOU_FLASH2 + 3) {
    const k = (f - ITTOU_FLASH2) / 3;
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x0 = L * (0.1 + 0.22 * i + 0.06 * hash1(i, 3103));
      const len = 14 + 14 * hash1(i, 3104);
      const y = side * (5 + (k + 0.3 * hash1(i, 3108)) * (ITTOU_HALF - 8));
      streakLine(frame, { ax: x0, ay: y, bx: x0 + len * (1 - k * 0.5), by: y, bright: 0.36 * (1 - k * 0.7) });
    }
  }
  // 5) 余韻の粒（少なく、線から直交して漂う）
  lineMotes(frame, f - ITTOU_FLASH2, 12, 3105, (t) => ({ x: L * t, y: 0, nx: 0, ny: 1, tx: 1, ty: 0 }));
  ittouDust(frame, f);
}

/** 踏み切りの砂: 始点から後ろへ少しだけ（刀は粒を控えめに） */
function ittouDust(frame, f) {
  shards(frame, f, 7, 3106, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.4;
    const sp = 2 + rnd(2) * 2.5;
    return { x: -4, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1, bright: 0.35 };
  });
}

/** 一刀両断の発動: 前後から細い線が自分へ寄って一点に締まり（居合の構え）、鯉口が切れる閃きで弾ける */
function ittouCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = easeSwing((f + 1) / gather);
    const outer = 56 - 40 * p;
    const inner = Math.max(3, outer - 22);
    for (const s of [-1, 1]) {
      cutLine(frame, { ax: s * outer, ay: 0, bx: s * inner, by: 0, width: 1.4, bright: 0.55 + 0.4 * p, seed: 3201 });
    }
    // 鍔の位置の短い縦の刻み（構えた刀の鍔元）
    if (f >= 2) streakLine(frame, { ax: 0, ay: -5, bx: 0, by: 5, width: 1, bright: 0.5 + 0.2 * f });
    return;
  }
  const age = f - gather;
  const k = age / (N - gather - 1);
  if (age === 0) sparkle(frame, 2, 0, 4);
  // 抜刀の閃き: 前へ短く鋭い細線（1 本）が走って消える
  if (age <= 1) lens(frame, { ax: 0, ay: 0, bx: 34 + age * 12, by: 0, T: 4, bias: 0, erosion: age * 0.4, seed: 3202, bright: 1 - age * 0.2 });
  ring(frame, { radius: 6 + age * 6, width: 1.8 - k * 0.6, squash: 0.55, erosion: Math.min(0.92, k * 0.9), bright: 0.7 - k * 0.3, seed: 3203 });
  lineMotes(frame, age, 4, 3204, (t) => ({ x: -10 + 40 * t, y: 0, nx: 0, ny: 1, tx: 1, ty: 0 }));
}

// -----------------------------------------------------------------------------
// 燕舞（circle 半径 36・3 段・重い）: 燕が翻るように、螺旋に外へ抜ける細い弧が 3 度、角を変えて走る。
// 各弧は斬り終えると遅れて切断線が光り、点線にほどける。3 本は時間（3 枚ずつ）と角（120°ずつ）をはっきり分ける
// -----------------------------------------------------------------------------

/** 当たりの半径（36 論理 px × 2） */
const SWALLOW_R = 72;
/** 刃の最も太い所（剣の円月の 3 分の 1 ほど。刀は細い） */
const SWALLOW_T = 11;
const SWALLOW_N = 16;
/** 1 太刀が走る枚数と、太刀の間隔 */
const SWALLOW_A = 2;
const SWALLOW_GAP = 3;
/** 1 太刀の振り幅（度）。一周させず、翻る燕の軌跡の長さ */
const SWALLOW_SPAN = 220 * DEG;
/** 螺旋の内側の半径（太刀は内から外へ抜けて当たりの縁に届く） */
const SWALLOW_R0 = 0.5;
/** 3 太刀の斬り始めの角（120° ずつ回す） */
const SWALLOW_STARTS = [-110 * DEG, 10 * DEG, 130 * DEG];

/** 螺旋の太刀の半径（斬り始め s = 0 → 斬り終わり s = 1） */
function swoopRadius(s) {
  const k = clamp01(s);
  return SWALLOW_R * (SWALLOW_R0 + (1 - SWALLOW_R0) * (1 - Math.pow(1 - k, 1.6)));
}

/**
 * 螺旋の太刀（1 本の三日月）。start から時計回りに span。head / tail は斬り始めからの進み（0..1）。
 * 外縁（螺旋の外側）が刃の縁で白く、内側ほど暗い
 */
function swoopBlade(frame, o) {
  const { start, head, tail, T } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const len = Math.max(1e-3, head - tail);
  paint(
    frame,
    (x, y) => {
      const s = wrapTau(Math.atan2(y, x) - start) / SWALLOW_SPAN;
      if (s < tail || s > head) return -1;
      const u = (head - s) / len;
      const w = T * crescentWidth(u, 0.14, 0.7);
      if (w < 0.6) return -1;
      const R = swoopRadius(s);
      const r = Math.hypot(x, y);
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.5 && u < 0.7 && erosion < 0.5) return clamp01(bright * (1.05 - 0.3 * u));
      return clamp01(Math.pow(1 - q, 1.05) * (0.92 - 0.5 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -SWALLOW_R - 2, y0: -SWALLOW_R - 2, x1: SWALLOW_R + 2, y1: SWALLOW_R + 2 } },
  );
}

/** 螺旋の切断線（太刀の外縁の跡）。両端が尖り、erosion で端から点線にほどける */
function swoopCut(frame, o) {
  const { start } = o;
  const width = o.width ?? 1.6;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const arcLen = SWALLOW_SPAN * SWALLOW_R * 0.8;
  paint(
    frame,
    (x, y) => {
      const s = wrapTau(Math.atan2(y, x) - start) / SWALLOW_SPAN;
      if (s > 1) return -1;
      const mid = Math.sin(Math.PI * s);
      const R = swoopRadius(s) - 0.8;
      if (Math.abs(Math.hypot(x, y) - R) > (width / 2) * (0.55 + 0.45 * Math.pow(mid, 0.4))) return -1;
      if (erosion > 0 && valueNoise(s * arcLen, 0, 5, seed) * 0.75 + mid * 0.4 - erosion * 1.15 < 0) return -1;
      return clamp01(bright * (0.45 + 0.6 * Math.pow(mid, 0.5)));
    },
    { bounds: { x0: -SWALLOW_R - 3, y0: -SWALLOW_R - 3, x1: SWALLOW_R + 3, y1: SWALLOW_R + 3 }, dither: 0 },
  );
}

/** 螺旋の上の点（s = 0..1）と、その接線・法線 */
function swoopPoint(start, s) {
  const a = start + SWALLOW_SPAN * s;
  const r = swoopRadius(s);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a) };
}

function swallowSlash(frame, f) {
  SWALLOW_STARTS.forEach((start, i) => {
    const age = f - i * SWALLOW_GAP;
    if (age < 0) return;
    const seed = 3301 + i * 10;
    if (age < SWALLOW_A) {
      const p = easeSwing((age + 1) / SWALLOW_A);
      // 速い振りなので尾は長く、ほぼ振り幅全体に残る
      swoopBlade(frame, { start, head: p, tail: Math.max(0, p - 0.8), T: SWALLOW_T * (0.8 + 0.2 * p), seed });
      const tip = swoopPoint(start, p);
      if (age === SWALLOW_A - 1) sparkle(frame, tip.x - tip.nx * 2, tip.y - tip.ny * 2, 3);
      // 速度線: 刃の外側に 1 本だけ（螺旋の外、少し離して）
      for (let j = 0; j < 7; j++) {
        const s = p - 0.12 - j * 0.05;
        if (s < 0.05) break;
        const a = swoopPoint(start, s);
        const b = swoopPoint(start, s + 0.04);
        streakLine(frame, { ax: a.x + a.nx * 4, ay: a.y + a.ny * 4, bx: b.x + b.nx * 4, by: b.y + b.ny * 4, bright: 0.45 - j * 0.04 });
      }
      return;
    }
    const a2 = age - SWALLOW_A;
    // 三日月は 1 枚で痩せて消える
    if (a2 === 0) swoopBlade(frame, { start, head: 1, tail: 0.35, T: SWALLOW_T * 0.5, erosion: 0.45, bright: 0.75, seed });
    const g = afterglow(a2, SWALLOW_N - SWALLOW_A - 2 * SWALLOW_GAP - 2);
    if (!g) return;
    swoopCut(frame, { start, width: a2 === 1 ? 2.2 : 1.5, bright: g.bright, erosion: g.erosion, seed: seed + 5 });
    if (a2 === 1) {
      const m = swoopPoint(start, 0.62);
      sparkle(frame, m.x, m.y, i === 2 ? 4 : 3);
    }
    lineMotes(frame, a2 - 1, 5, seed + 7, (t) => swoopPoint(start, t));
  });
  // 3 太刀目が光った後、舞い散る羽のような粒が外へ漂う（燕が抜けた跡）
  shards(frame, f - (2 * SWALLOW_GAP + SWALLOW_A + 1), 14, 3340, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = SWALLOW_R * (0.55 + 0.4 * rnd(2));
    const sp = 1 + rnd(3) * 1.6;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: -Math.sin(a) * sp * 0.6 + Math.cos(a) * sp, vy: Math.cos(a) * sp * 0.6 + Math.sin(a) * sp, life: 4 + Math.floor(rnd(4) * 3), size: 1, drag: 0.8 };
  });
}

/** 燕舞の地面の紋: 当たりの縁の細い輪と、3 太刀の斬り始めを示す短い刻み。太刀ごとに刻みが灯り、薄れて消える */
function swallowGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 9 ? 0 : (f - 8) / (SWALLOW_N - 9);
  const dim = 0.38 * (1 - k * 0.5);
  ring(frame, { radius: (SWALLOW_R - 2) * (0.75 + 0.25 * grow), width: 1.6, erosion: k * 0.92, bright: dim, seed: 3350 });
  if (grow < 1 || k >= 0.85) return;
  SWALLOW_STARTS.forEach((start, i) => {
    if (f < i * SWALLOW_GAP) return;
    const a = start;
    const r0 = SWALLOW_R - 12;
    const r1 = SWALLOW_R - 4;
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, width: 1.5, bright: dim * 1.2 * (1 - k) });
  });
}

/** 燕舞の発動: 3 つの短い弧（燕）が自分の周りを速く旋回しながら締まり、弾けて外へ散る */
function swallowCast(frame, f) {
  const N = 8;
  const gather = 5;
  if (f < gather) {
    const p = (f + 1) / gather;
    const r = 30 - 12 * p;
    for (let i = 0; i < 3; i++) {
      const head = -Math.PI / 2 + (i / 3) * TAU + f * 55 * DEG;
      const span = 0.5 + 0.35 * p;
      paint(
        frame,
        (x, y) => {
          const d = Math.hypot(x, y);
          const s = wrapTau(head - Math.atan2(y, x)) / span;
          if (s > 1) return -1;
          // 先端が太く尾が細る短い三日月（燕の体と尾）
          const w = 1.2 + 2.2 * (1 - s);
          if (Math.abs(d - r) > w / 2) return -1;
          return clamp01((0.45 + 0.5 * p) * (1 - 0.6 * s));
        },
        { bounds: { x0: -r - 4, y0: -r - 4, x1: r + 4, y1: r + 4 } },
      );
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const age = f - gather;
  const k = age / (N - gather - 1);
  if (age === 0) sparkle(frame, 0, 0, 4);
  ring(frame, { radius: 12 + age * 9, width: 1.8 - k * 0.6, erosion: Math.min(0.92, k * 0.85), bright: 0.75 - k * 0.3, seed: 3360 });
  shards(frame, age, 9, 3361, (i, rnd) => {
    const a = (i / 9) * TAU + rnd(1) * 0.4;
    const sp = 3 + rnd(2) * 2;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp - Math.sin(a) * 1.5, vy: Math.sin(a) * sp + Math.cos(a) * 1.5, life: 3, size: 1 };
  });
}

// -----------------------------------------------------------------------------
// 無想（持続）: 明鏡止水。発動は一滴の光が落ちて一本の縦の線が光り、足元に波紋が広がる。
// 持続中は足元の波紋が静かに広がり続け、花弁のような粒が舞い落ち、周りの空をふいに細い斬線が走っては消える
// dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 地面の輪の潰し（上下に潰した楕円 = 地面に置いた輪） */
const GROUND_SQUASH = 2.2;

/** 無想の発動 */
function mushinCast(frame, f) {
  const N = 12;
  // 一滴: 頭上の光点が落ちる
  if (f <= 2) sparkle(frame, 0, -44 + f * 8, f === 0 ? 2 : 3);
  // 縦の一線（心の刃）: 頭上から足元まで伸び、遅れて白く光り、ほどける
  if (f >= 1 && f <= 2) lens(frame, { ax: 0, ay: -40, bx: 0, by: FEET_Y, T: 4, grow: f === 1 ? 0.5 : 1, bias: 0, seed: 3401, bright: 0.9 });
  const g = afterglow(f - 3, N - 5);
  if (g) {
    cutLine(frame, { ax: 0, ay: -48, bx: 0, by: FEET_Y + 4, width: f === 4 ? 2 : 1.5, bright: g.bright, erosion: g.erosion, seed: 3402 });
    if (f === 4) sparkle(frame, 0, -14, 4);
    lineMotes(frame, f - 4, 5, 3403, (t) => ({ x: 0, y: -48 + (FEET_Y + 52) * t, nx: 1, ny: 0, tx: 0, ty: 1 }));
  }
  // 足元の波紋: 3 重、2 枚ずつ遅れて広がる（時間を分けた別々の輪）
  for (let i = 0; i < 3; i++) {
    const age = f - 3 - i * 2;
    if (age < 0) continue;
    const k = age / (N - 4 - i * 2);
    if (k > 1) continue;
    ring(frame, { oy: FEET_Y, radius: 6 + age * 5.5, width: 1.6, squash: GROUND_SQUASH, erosion: Math.min(0.92, k * 0.9), bright: (0.8 - i * 0.12) * (1 - k * 0.5), seed: 3404 + i });
  }
}

/** 纏いの 1 巡のフレーム数 */
const MUSHIN_N = 16;
/** 斬線の生きる枚数（伸びる 1・光る 1・ほどける 3） */
const FLICK_LIFE = 5;
/** ふいに走る斬線: 出る枚数・中心・向き（度）。顔を覆わないよう左右と頭上に置き、向きを散らす */
const FLICKS = [
  { at: 0, x: -30, y: -6, deg: 62 },
  { at: 5, x: 28, y: -16, deg: -48 },
  { at: 10, x: 4, y: -40, deg: 12 },
  { at: 13, x: 26, y: 12, deg: 110 },
];
/** 斬線の長さ */
const FLICK_LEN = 26;

/** 無想の纏い（持続中ずっと。位相が一周するので継ぎ目が出ない） */
function mushinSustain(frame, f) {
  // ふいに走る細い斬線（居合の気配）: 伸びる → 白く光る → 点線にほどける
  FLICKS.forEach((c, i) => {
    const age = (f - c.at + MUSHIN_N) % MUSHIN_N;
    if (age >= FLICK_LIFE) return;
    const a = c.deg * DEG;
    const hx = (Math.cos(a) * FLICK_LEN) / 2;
    const hy = (Math.sin(a) * FLICK_LEN) / 2;
    const seed = 3410 + i;
    if (age === 0) {
      lens(frame, { ax: c.x - hx, ay: c.y - hy, bx: c.x + hx, by: c.y + hy, T: 3.5, bias: 0, seed, bright: 0.75 });
      return;
    }
    const g = afterglow(age, FLICK_LIFE - 1);
    if (!g) return;
    cutLine(frame, { ax: c.x - hx * 1.15, ay: c.y - hy * 1.15, bx: c.x + hx * 1.15, by: c.y + hy * 1.15, width: age === 1 ? 1.8 : 1.3, bright: g.bright * 0.95, erosion: g.erosion, seed });
    if (age === 1) sparkle(frame, c.x, c.y, 2);
  });
  // 舞い落ちる花弁の粒: 位相で下へ流れ、左右にゆらぐ。1 巡で元へ戻る
  const cycle = f / MUSHIN_N;
  for (let i = 0; i < 9; i++) {
    const t = (cycle + hash1(i, 3420)) % 1;
    const x = (hash1(i, 3421) - 0.5) * 76 + Math.sin(t * TAU * 2 + i) * 3;
    const y = -50 + t * (FEET_Y + 58);
    if (Math.abs(x) < 10 && y > -26 && y < FEET_Y - 4) continue;
    const level = Math.max(2, Math.round(1.5 + 3 * Math.sin(Math.PI * t)));
    dot(frame, x, y, Math.min(5, level));
    // 花弁は 2 ドット（横か縦に揺れて向きが変わる）
    if (level >= 3) dot(frame, x + (Math.sin(t * TAU * 2 + i) > 0 ? 1 : 0), y + (Math.sin(t * TAU * 2 + i) > 0 ? 0 : 1), level - 1);
  }
}

/** 纏いの足元（地面）: 半巡ずつずれた 2 つの波紋が広がり続ける。広がるほど薄れ、縁で消える（1 巡で継ぎ目が出ない） */
function mushinGround(frame, f) {
  const cycle = f / MUSHIN_N;
  for (let i = 0; i < 2; i++) {
    const t = (cycle + i * 0.5) % 1;
    ring(frame, { oy: FEET_Y, radius: 7 + t * 24, width: 1.4, squash: GROUND_SQUASH, erosion: Math.max(0, t - 0.6) * 1.8, bright: 0.34 * Math.sin(Math.PI * t), seed: 3430 + i });
  }
  // 静かな芯: 足元の小さな楕円（動かない水面）
  ring(frame, { oy: FEET_Y, radius: 5, width: 1.2, squash: GROUND_SQUASH, bright: 0.22, seed: 3432 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 一刀両断の base は突進で進んだ距離（壁で止まれば縮む）。燕舞の振りは reach 0 なので拡縮しない（base 0）
 */
const FX = {
  moveset: "katana",
  ultimates: {
    "katana.ittou": {
      ramp: "light",
      cast: { sheet: "katanaUlt.ittouCast", life: 0.35 },
      acts: [{ sheet: "katanaUlt.ittou", life: 0.75, base: ITTOU_L / 2, pivot: "pos" }],
    },
    "katana.swallowDance": {
      ramp: "light",
      cast: { sheet: "katanaUlt.swallowDanceCast", life: 0.35 },
      acts: [{ sheet: "katanaUlt.swallowDance", life: 0.9, base: 0, pivot: "pos", ground: "katanaUlt.swallowDanceGround" }],
    },
    "katana.mushin": {
      ramp: "light",
      cast: { sheet: "katanaUlt.mushinCast", life: 0.65 },
      sustain: { sheet: "katanaUlt.mushin", period: 1.3, ground: "katanaUlt.mushinGround" },
    },
  },
};

export const ATLAS = {
  key: "katanaUlt",
  fx: FX,
  sheets: [
    { key: "katanaUlt.ittou", dirs: DIRS, frames: ITTOU_N, active: ITTOU_A, size: 2 * (ITTOU_L + 34), draw: ittouSlash },
    { key: "katanaUlt.ittouCast", dirs: DIRS, frames: 8, active: 0, size: 136, draw: ittouCast },
    { key: "katanaUlt.swallowDance", dirs: 1, frames: SWALLOW_N, active: 2 * SWALLOW_GAP + SWALLOW_A, size: 2 * (SWALLOW_R + 24), draw: swallowSlash },
    { key: "katanaUlt.swallowDanceGround", dirs: 1, frames: SWALLOW_N, active: 2 * SWALLOW_GAP + SWALLOW_A, size: 2 * (SWALLOW_R + 6), draw: swallowGround },
    { key: "katanaUlt.swallowDanceCast", dirs: 1, frames: 8, active: 0, size: 112, draw: swallowCast },
    { key: "katanaUlt.mushinCast", dirs: 1, frames: 12, active: 0, size: 144, draw: mushinCast },
    { key: "katanaUlt.mushin", dirs: 1, frames: MUSHIN_N, active: 0, size: 128, draw: mushinSustain },
    { key: "katanaUlt.mushinGround", dirs: 1, frames: MUSHIN_N, active: 0, size: 128, draw: mushinGround },
  ],
};
