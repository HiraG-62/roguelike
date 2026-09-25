// 剣（moveset "sword"）のエフェクト。docs/ideas/fx-sprites.md 5 章
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（weapons/WEAPON/movesets/sword.json・PLAYER_MELEE.json）× 2 が目安
import { arcLine, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";

const DEG = Math.PI / 180;
/** 方向の数（15° 刻み）。反時計回りは −θ の絵の上下反転で引くので、0 を含む偶数にする */
const DIRS = 24;

// -----------------------------------------------------------------------------
// 弧の斬撃（左 1〜3 段・斬り上げ）の共通の時間割
// -----------------------------------------------------------------------------

/**
 * 弧の斬撃 1 フレーム。spec の数値でモーションごとの形を決める。
 * active のフレームで先端が振り幅を走り、残りで尾が先端へ追いつきながら崩れる
 */
function arcSlash(frame, f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  const fade = f - (A - 1);
  let head;
  let tail;
  let erosion = 0;
  let bright = 1;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    tail = from + sweep * Math.max(0, p - spec.tailLen) * 0.5;
    bright = 0.82 + 0.18 * p;
  } else {
    const k = fade / (spec.frames - A);
    head = from + sweep * (1 + spec.overshoot * k);
    tail = from + sweep * Math.min(0.97, 1 - spec.tailLen + (spec.tailLen - 0.05) * Math.pow(k, 0.8));
    erosion = spec.erodeFrom + (0.85 - spec.erodeFrom) * Math.pow(k, 1.3);
    bright = 1 - 0.3 * k;
  }
  // 振り終わりは内側から痩せて、外縁（刃の通り道）だけが細く残る
  const T = spec.T * (f < A ? 0.7 + 0.3 * ((f + 1) / A) : 1 - 0.5 * (fade / (spec.frames - A)));
  const ox = spec.ox ?? 0;
  crescent(frame, { ox, R: spec.R, T, head, tail, erosion, bright, seed: spec.seed, streak: spec.streak ?? 0.35 });
  drawArcLines(frame, f, spec, head, tail);
  if (f >= A - 1) drawArcShards(frame, f - (A - 1), spec, from, sweep);
  if (f === A - 1 || f === A) {
    const tipR = spec.R - T * 0.35;
    sparkle(frame, ox + Math.cos(head) * tipR, Math.sin(head) * tipR, f === A - 1 ? spec.glint : spec.glint - 1);
  }
}

/** 速度線: 外縁のすぐ外に、先端の後ろへ伸びる 1px の弧。崩れの間は外へずれて短くなる */
function drawArcLines(frame, f, spec, head, tail) {
  const A = spec.active;
  const k = f < A ? 0 : (f - A + 1) / (spec.frames - A + 1);
  const span = head - tail;
  for (let i = 0; i < spec.lines; i++) {
    const r0 = hash1(i, spec.seed + 40);
    // 速度線は刃の外側にだけ沿わせる（内側に離して引くと、弧がもう 1 本あるように見える）
    const radius = spec.R + 2 + i * 1.5 + k * 6;
    const len = span * (0.35 + 0.45 * hash1(i, spec.seed + 41)) * (1 - k * 0.8);
    const end = head - span * (0.06 + 0.12 * r0) + k * span * 0.25;
    if (len <= 0.02 || k >= 0.95) continue;
    arcLine(frame, { ox: spec.ox ?? 0, radius, from: end - len, to: end, bright: (0.62 - i * 0.04) * (1 - k * 0.6) });
  }
}

/** 刃片: 振り切りの瞬間に先端付近から、刃の進む向き（接線）へ飛ぶ */
function drawArcShards(frame, age, spec, from, sweep) {
  shards(frame, age, spec.shards, spec.seed + 60, (i, rnd) => {
    const a = from + sweep * (0.55 + 0.45 * rnd(1));
    const r = spec.R - spec.T * (0.2 + 0.6 * rnd(2));
    const speed = spec.shardSpeed * (0.6 + 0.8 * rnd(3));
    // 接線（時計回りの進む向き）と外向きを混ぜる
    const out = 0.35 + 0.5 * rnd(4);
    const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * speed;
    const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * speed;
    return { x: (spec.ox ?? 0) + Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// モーションごとの定義
// -----------------------------------------------------------------------------

/** 左 1 段: 細めの三日月。当たり判定 box reach 16 / size 26（弧の半径 ≈ 29 論理 px） */
const L1 = { R: 56, T: 20, sweep: 130, tilt: 0, frames: 8, active: 4, tailLen: 0.8, overshoot: 0.06, erodeFrom: 0.04, lines: 3, shards: 5, shardSpeed: 4, glint: 3, seed: 101 };
/** 左 2 段: 返しの振り（描画側が上下反転で逆回りにする）。少し大きく、尾が長い */
const L2 = { R: 60, T: 21, sweep: 140, tilt: 6, frames: 8, active: 4, tailLen: 0.9, overshoot: 0.07, erodeFrom: 0.04, lines: 4, shards: 6, shardSpeed: 4.5, glint: 3, seed: 202 };
/** 左 3 段（終撃）: box reach 22 / size 38。1 本の太い三日月 + 多めの刃片（2 本目の弧は重ねない。二重に見えて読みにくい） */
const L3 = {
  R: 80,
  T: 40,
  sweep: 150,
  tilt: 0,
  frames: 9,
  active: 4,
  tailLen: 0.95,
  overshoot: 0.05,
  erodeFrom: 0.03,
  lines: 6,
  shards: 12,
  shardSpeed: 6,
  glint: 4,
  seed: 303,
  streak: 0.45,
};
/** 右: 斬り上げ（arc 150° reach 26）。大きく跳ね上がる三日月 */
const RISING = {
  R: 54,
  T: 34,
  sweep: 175,
  tilt: -8,
  frames: 9,
  active: 4,
  tailLen: 0.9,
  overshoot: 0.08,
  erodeFrom: 0.03,
  lines: 5,
  shards: 10,
  shardSpeed: 5.5,
  glint: 4,
  seed: 404,
  streak: 0.4,
};

/** 作業面の大きさ（原点が中心。切り詰めるので余白は気にしない） */
function workSize(spec) {
  return Math.ceil(spec.R + Math.abs(spec.ox ?? 0) + 14) * 2;
}

function arcSheet(key, spec) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size: workSize(spec), draw: (frame, f) => arcSlash(frame, f, spec) };
}

/** ダッシュ攻撃（box reach 26 / size 30）: 後ろに中心を置いた大きな弧で、前方を横一文字に払う */
const DASH = {
  ox: -44,
  R: 112,
  T: 18,
  sweep: 72,
  tilt: 0,
  frames: 8,
  active: 4,
  tailLen: 0.9,
  overshoot: 0.08,
  erodeFrom: 0.04,
  lines: 2,
  shards: 6,
  shardSpeed: 5,
  glint: 3,
  seed: 505,
  streak: 0.5,
};

/** ダッシュ攻撃の後ろへ流れる速度線の束（突進の速さ） */
function dashSlash(frame, f) {
  arcSlash(frame, f, DASH);
  const k = f < DASH.active ? 0 : (f - DASH.active + 1) / (DASH.frames - DASH.active + 1);
  if (k >= 0.9) return;
  for (let i = 0; i < 7; i++) {
    const y = (i - 3) * 8 + (hash1(i, 551) - 0.5) * 5;
    const len = 26 + 34 * hash1(i, 552);
    const x1 = 52 - Math.abs(y) * 0.5 - k * 30 - hash1(i, 553) * 10;
    streakLine(frame, { ax: x1 - len * (1 - k * 0.5), ay: y, bx: x1, by: y, bright: 0.55 * (1 - k) });
  }
}

// -----------------------------------------------------------------------------
// 突き・一閃
// -----------------------------------------------------------------------------

/** 右: 返し斬り（thrust reach 30）。刺突の光条 + 穂先の衝撃の輪 2 枚 + 平行の速度線 */
function thrust(frame, f) {
  const A = 3;
  const N = 7;
  const reach = 64;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const tip = 10 + (reach - 10) * p + k * 4;
  const back = 4 + k * (tip - 12) * 0.85;
  const T = 14 * (1 - k * 0.55);
  lens(frame, { ax: back, ay: 0, bx: tip, by: 0, T, bias: 0, erosion: k * 0.8, seed: 611, bright: 1 - k * 0.2 });
  if (k < 0.7) streakLine(frame, { ax: back + (tip - back) * 0.25, ay: 0, bx: tip - 2, by: 0, width: 1.3, bright: 1 });
  // 穂先の衝撃の輪: 進む向きに潰れた楕円が、穂先から少し戻った所で広がる
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { ox: tip - 8 - age * 2, radius: 5 + age * 3.2, width: 2, squash: 0.4, erosion: Math.min(0.9, age * 0.17), bright: 0.75 - age * 0.06, seed: 612 });
    if (f >= 2) ring(frame, { ox: tip - 20 - age * 3, radius: 3 + age * 2.6, width: 1.6, squash: 0.4, erosion: Math.min(0.9, age * 0.2), bright: 0.6 - age * 0.06, seed: 613 });
  }
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (T / 2 + 3 + Math.floor(i / 2) * 4 + k * 3);
    const len = 22 + 18 * hash1(i, 614);
    const x1 = tip - 14 - hash1(i, 615) * 10 - k * 16;
    if (k < 0.85) streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
  }
  if (f === A - 1) sparkle(frame, tip - 1, 0, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 6, 616, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.6;
      const sp = 3 + rnd(2) * 3;
      return { x: tip - 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/** 派生: 踏み込み斬り（thrust reach 30・踏み込み 24）。背後から前へ抜ける細く長い一閃が、2 本に割れて消える */
function steppingCut(frame, f) {
  const A = 3;
  const N = 7;
  const from = -40;
  const to = 70;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const head = from + (to - from) * p;
  if (k === 0) {
    lens(frame, { ax: from, ay: 0, bx: head, by: 0, T: 7, bias: 0, seed: 621 });
    streakLine(frame, { ax: from + 20, ay: 0, bx: head - 3, by: 0, width: 1.2, bright: 1 });
  } else {
    // 振り終わり: 一閃が上下に割れて離れていく
    const gap = 1.5 + k * 7;
    for (const side of [-1, 1]) {
      lens(frame, { ax: from + k * 30, ay: side * gap, bx: to, by: side * gap, T: 5 * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed: 622 + side, bright: 0.9 - k * 0.3 });
    }
  }
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 5 + (hash1(i, 623) - 0.5) * 3;
    if (y === 0 || k > 0.8) continue;
    const x1 = head - 18 - hash1(i, 624) * 20 - k * 20;
    streakLine(frame, { ax: x1 - 20 - hash1(i, 625) * 24, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
  }
  if (f === A - 1) sparkle(frame, to - 2, 0, 3);
}

// -----------------------------------------------------------------------------
// 当たりの中心に置く派生（十字断ち・逆袈裟・巴）
// -----------------------------------------------------------------------------

/** 十字断ちの斬線の反り（絵のドット） */
const BEND = 6;

/** 派生: 十字断ち（box reach 22 / size 40）。2 本の斬線が時間差で交差し、交点が閃光で弾ける */
function crossCut(frame, f) {
  const N = 9;
  const L = 38;
  const k = f < 5 ? 0 : (f - 4) / (N - 4);
  const g1 = Math.min(1, (f + 1) / 2);
  const g2 = f < 2 ? 0 : Math.min(1, (f - 1) / 2);
  const T = 15 * (1 - k * 0.55);
  // 反り（bend）で線の中央が法線方向へずれるので、その分だけ戻して交点を原点に合わせる
  // 2 本とも中央が前（+x、敵の側）へふくらむ向きに反らす。後ろへ反ると、振った刃の軌跡と逆の弓なりに見える
  const c = BEND * Math.SQRT1_2;
  lens(frame, { ax: -L - c, ay: -L + c, bx: L - c, by: L + c, T, bend: -BEND, grow: g1, erosion: k * 0.85, seed: 631 });
  if (g2 > 0) lens(frame, { ax: -L - c, ay: L - c, bx: L - c, by: -L - c, T, bend: BEND, grow: g2, erosion: k * 0.85, seed: 632 });
  if (f === 4) {
    sparkle(frame, 0, 0, 4);
    ring(frame, { radius: 8, width: 3, bright: 0.9, seed: 633 });
  }
  if (f >= 5) {
    const age = f - 4;
    ring(frame, { radius: 8 + age * 6, width: 2.4, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.08, seed: 634 });
    if (age <= 1) sparkle(frame, 0, 0, 3);
  }
  if (f >= 4) {
    shards(frame, f - 4, 12, 635, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 3.5 + rnd(2) * 4;
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.4 ? 2 : 1 };
    });
  }
}

/** 派生: 逆袈裟（box reach 22 / size 40）。左下から右上へ抜ける太い一本の斜線。断面から火花 */
function reverseKesa(frame, f) {
  const A = 4;
  const N = 8;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const ax = -40;
  const ay = 34;
  const bx = 42;
  const by = -36;
  const T = 22 * (1 - k * 0.5);
  lens(frame, { ax, ay, bx, by, T, bend: 10, grow: p, bias: 0.35, erosion: k * 0.85, seed: 641 });
  // 残像: 少しずれた位置に細く暗い写し
  if (f >= 1) lens(frame, { ax: ax - 5, ay: ay - 5, bx: bx - 5, by: by - 5, T: T * 0.35, bend: 10, grow: Math.max(0, p - 0.15), bias: 0, erosion: Math.min(0.95, k + 0.3), seed: 642, bright: 0.55 });
  if (f === A - 1) sparkle(frame, bx - 4, by + 4, 4);
  if (f >= A - 1) {
    // 断面の火花: 斬線に沿った位置から、線に直交する向きへ
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    shards(frame, f - (A - 1), 12, 643, (i, rnd) => {
      const t = 0.15 + 0.7 * rnd(1);
      const side = rnd(2) > 0.5 ? 1 : -1;
      const sp = 2.5 + rnd(3) * 3.5;
      const along = (rnd(4) - 0.5) * 0.8;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, vx: (nx * side + ((bx - ax) / len) * along) * sp, vy: (ny * side + ((by - ay) / len) * along) * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
}

/** 巴の 1 つ（勾玉形）: 頭の円から尾が円周に沿って細く伸びる。rot は頭の角 */
function comma(frame, rot, o) {
  const { Rh, head, tailLen, erosion, bright, seed } = o;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const s = wrapAngle(rot - Math.atan2(y, x));
      const hx = Math.cos(rot) * Rh;
      const hy = Math.sin(rot) * Rh;
      const dh = Math.hypot(x - hx, y - hy);
      let q;
      let u;
      if (dh < head) {
        q = dh / head;
        u = 0;
      } else {
        if (s < 0 || s > tailLen) return -1;
        u = s / tailLen;
        // 尾は外へ少し膨らみながら細る
        const rs = Rh + 6 * u;
        const w = head * Math.pow(1 - u, 0.9);
        const d = Math.abs(r - rs);
        if (d > w || w < 0.6) return -1;
        q = d / w;
      }
      if (erosion > 0 && valueNoise(x, y, 4.5, seed) * 0.7 + (1 - q) * 0.35 - erosion * 1.1 < 0) return -1;
      // 外側（進む側）ほど明るく、頭は芯が白い
      const outer = r > Rh ? 0.12 : -0.12;
      return clamp01(((1 - q) ** 0.9 * (1 - 0.55 * u) + outer) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -Rh - head - 10, y0: -Rh - head - 10, x1: Rh + head + 10, y1: Rh + head + 10 } },
  );
}

/** 派生: 巴（circle size 44・2 段ヒット）。2 つの巴の渦が 1 周し、2 回の当たりに合わせて明滅する */
function tomoe(frame, f) {
  const A = 6;
  const N = 10;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // active で 1 周、その後は減速して半周ほど流れる
  const rot = f < A ? easeSwing((f + 1) / A) * Math.PI * 2 : Math.PI * 2 + Math.sin(k * Math.PI * 0.5) * Math.PI * 0.6;
  const flash = f === 1 || f === 4 ? 1.12 : 1;
  for (let i = 0; i < 2; i++) {
    comma(frame, rot + i * Math.PI - Math.PI / 2, { Rh: 34, head: 10 * (1 - k * 0.35), tailLen: 2.3 * (1 - k * 0.4), erosion: k * 0.85, bright: flash * (1 - k * 0.3), seed: 651 + i });
  }
  // 当たり判定の円の縁と、外周の速度線
  if (k < 0.6) {
    for (let i = 0; i < 3; i++) {
      const a = rot + i * ((Math.PI * 2) / 3) + 0.4;
      arcLine(frame, { radius: 46 + i * 2, from: a - 1.4, to: a, bright: 0.5 * (1 - k) });
    }
  }
  if (f === 1 || f === 4) {
    for (let i = 0; i < 2; i++) {
      const a = rot + i * Math.PI - Math.PI / 2;
      sparkle(frame, Math.cos(a) * 38, Math.sin(a) * 38, 3);
    }
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 653, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * 36, y: Math.sin(a) * 36, vx: (-Math.sin(a) * 0.7 + Math.cos(a) * 0.5) * sp, vy: (Math.cos(a) * 0.7 + Math.sin(a) * 0.5) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中・受け流し
// -----------------------------------------------------------------------------

/** 命中: 刃の進む向き（+x）の鋭い裂け目 + 十字の閃き + 刃片。heavy は太く長く、衝撃の輪が付く */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const L = heavy ? 34 : 22;
  const T0 = heavy ? 13 : 9;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.55 : 1;
  const T = T0 * (f === 0 ? 0.7 : 1 - k * 0.6);
  lens(frame, { ax: -L * grow, ay: 0, bx: L * grow, by: 0, T, bias: 0.3, erosion: k * 0.9, seed: heavy ? 661 : 671 });
  if (f <= 1) streakLine(frame, { ax: 0, ay: -(heavy ? 14 : 9), bx: 0, by: heavy ? 14 : 9, width: f === 0 ? 1.4 : 1, bright: 0.85 });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : heavy ? 3 : 2);
  if (heavy && f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 7 + age * 5, width: 2.6 - age * 0.2, erosion: Math.min(0.9, age * 0.16), bright: 0.8 - age * 0.07, seed: 662 });
  }
  if (f >= 1) {
    shards(frame, f - 1, heavy ? 12 : 7, heavy ? 663 : 673, (i, rnd) => {
      // 刃の進む向きに多く飛び、残りは直交方向へ
      const forward = rnd(1) > 0.35;
      const a = forward ? (rnd(2) - 0.5) * 0.9 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 0.8);
      const sp = (heavy ? 4 : 3) + rnd(4) * (heavy ? 4 : 2.5);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.45 ? 2 : 1 };
    });
  }
}

/** 受け流し成功: 金属の火花の放射 + 八方の閃き + 広がる輪 */
function parry(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const grow = Math.min(1, (f + 1) / 3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const long = i % 2 === 0;
    const r1 = (long ? 40 : 24) * grow + k * 10;
    const r0 = f < 3 ? 4 : 4 + (f - 2) * (long ? 7 : 5);
    if (r0 >= r1) continue;
    streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: long ? 2 : 1.4, bright: (long ? 1 : 0.8) * (1 - k * 0.5) });
  }
  ring(frame, { radius: 10 + f * 6, width: 3 - f * 0.25, erosion: Math.min(0.9, k * 0.9), bright: 0.85 - k * 0.3, seed: 681 });
  if (f <= 3) sparkle(frame, 0, 0, f <= 1 ? 4 : 3);
  shards(frame, f, 16, 682, (i, rnd) => {
    const a = rnd(1) * Math.PI * 2;
    const sp = 4 + rnd(2) * 4;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.4 ? 2 : 1, drag: 0.8 };
  });
}

export const SWORD_ATLAS = {
  key: "sword",
  sheets: [
    arcSheet("sword.l1", L1),
    arcSheet("sword.l2", L2),
    arcSheet("sword.l3", L3),
    arcSheet("sword.rising", RISING),
    { key: "sword.dash", dirs: DIRS, frames: DASH.frames, active: DASH.active, size: 176, draw: dashSlash },
    { key: "sword.thrust", dirs: DIRS, frames: 7, active: 3, size: 160, draw: thrust },
    { key: "sword.step", dirs: DIRS, frames: 7, active: 3, size: 176, draw: steppingCut },
    { key: "sword.cross", dirs: DIRS, frames: 9, active: 5, size: 128, draw: crossCut },
    { key: "sword.kesa", dirs: DIRS, frames: 8, active: 4, size: 128, draw: reverseKesa },
    { key: "sword.tomoe", dirs: 1, frames: 10, active: 6, size: 128, draw: tomoe },
    { key: "sword.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "sword.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
    { key: "sword.parry", dirs: 1, frames: 8, active: 0, size: 128, draw: parry },
  ],
};
