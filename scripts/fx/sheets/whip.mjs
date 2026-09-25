// moveset "whip" のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/whip.json）× 2 が目安
//
// 鞭らしさの芯は 3 つ: 「細く長い線（太さ 2〜3 ドット、先端ほど細い）」「波が手元から先端へ伝わるしなり」「伸び切った先端の破裂」。
// 剣の三日月（面の広い斬撃）と見分けるため、面で塗る形は使わず、1 本の曲線（tube）と先端の閃光で描く
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 鞭の手元（キャラの手の辺り。キャラは絵のドットで 48 なので、中心から少し出た所） */
const HAND = 10;
/** 1 本の曲線を何点の折れ線で描くか（細かいほど波が滑らか。多いと遅い） */
const LINE_POINTS = 64;

// -----------------------------------------------------------------------------
// 部品: 鞭の曲線・先端の破裂
// -----------------------------------------------------------------------------

/**
 * 鞭の本体（折れ線 pts に沿う細い管）。太さは手元 w0 → 先端 w1（半幅）で細る。
 * 明るさは本体を段 4〜5 に抑え、白（段 7）は glow（先端から glowLen の範囲）だけに乗せる（白い塊を作らない）
 */
function tube(frame, pts, o) {
  const n = pts.length;
  if (n < 2) return;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = Math.max(1e-3, cum[n - 1]);
  const w0 = o.w0 ?? 1.5;
  const w1 = o.w1 ?? 0.8;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const glow = o.glow ?? 0;
  const glowLen = o.glowLen ?? 0.15;
  const from = o.from ?? 0;
  const lum = o.lum ?? ((u) => 0.66 + 0.18 * u);
  const CH = 6;
  for (let c = 0; c < n - 1; c += CH) {
    const i0 = Math.max(0, c - 1);
    const i1 = Math.min(n - 1, c + CH + 1);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = i0; i <= i1; i++) {
      x0 = Math.min(x0, pts[i].x);
      y0 = Math.min(y0, pts[i].y);
      x1 = Math.max(x1, pts[i].x);
      y1 = Math.max(y1, pts[i].y);
    }
    const pad = w0 + 2;
    paint(
      frame,
      (x, y) => {
        let best = Infinity;
        let bu = 0;
        // segment() を展開して書く（1 フレームで数十万回呼ぶので、戻り値のオブジェクトを作らない）
        for (let i = i0; i < i1; i++) {
          const ax = pts[i].x;
          const ay = pts[i].y;
          const dx = pts[i + 1].x - ax;
          const dy = pts[i + 1].y - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - x;
          const ey = ay + dy * t - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < best) {
            best = d2;
            bu = (cum[i] + (cum[i + 1] - cum[i]) * t) / total;
          }
        }
        best = Math.sqrt(best);
        if (bu < from) return -1;
        const hw = o.width ? o.width(bu) : w0 + (w1 - w0) * Math.pow(bu, 0.8);
        if (best > hw) return -1;
        const q = best / hw;
        if (erosion > 0 && valueNoise(x, y, 4, seed) * 0.7 + (1 - q) * 0.25 + (1 - bu) * 0.1 - erosion * 1.1 < 0) return -1;
        let v = Math.pow(1 - q, 0.55) * lum(bu);
        if (glow > 0 && bu > 1 - glowLen) v += glow * ((bu - (1 - glowLen)) / glowLen) * (1 - q * 0.8);
        return clamp01(v * bright * (1 - erosion * 0.35));
      },
      { bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } },
    );
  }
}

/** 直線の軸に沿う鞭の折れ線。s（0..1）で x を手元 → 先端へ、y = wave(s) で横に振る */
function linePts(xa, xb, wave, from = 0) {
  const pts = [];
  for (let i = 0; i <= LINE_POINTS; i++) {
    const s = from + ((1 - from) * i) / LINE_POINTS;
    pts.push({ x: xa + (xb - xa) * s, y: wave(s) });
  }
  return pts;
}

/**
 * 先端の破裂（「パァン」）。age 0 = 弾けた瞬間: 星の閃光 + 短い放射線 + 小さな輪。
 * 以後は放射線が外へ抜けながら短くなり、輪が広がって欠け、火花が散る
 */
function burst(frame, x, y, age, o) {
  const size = o.size ?? 3;
  const lines = o.lines ?? 8;
  const len = o.len ?? 12;
  const seed = o.seed ?? 71;
  const life = o.life ?? 4;
  if (age < 0 || age > life + 2) return;
  const k = age / life;
  if (age <= 1) sparkle(frame, x, y, age === 0 ? size : Math.max(2, size - 1));
  // 放射線: 弾けた瞬間は中心から外へ長く、以後は根元が外へ抜けて短い線の輪になる（中心は空く）
  if (k < 1) {
    for (let i = 0; i < lines; i++) {
      const a = (i / lines) * TAU + (o.rot ?? 0.2) + (hash1(i, seed) - 0.5) * 0.3;
      const long = i % 2 === 0 ? 1 : 0.55;
      const r1 = len * long * (0.85 + 0.3 * hash1(i, seed + 1)) * (1 + age * 0.3);
      const r0 = age === 0 ? 3 : Math.min(r1 - 2, len * (0.35 + age * 0.35) * long);
      if (r1 - r0 < 1.5) continue;
      streakLine(frame, { ax: x + Math.cos(a) * r0, ay: y + Math.sin(a) * r0, bx: x + Math.cos(a) * r1, by: y + Math.sin(a) * r1, width: age === 0 && long === 1 ? 1.6 : 1.1, bright: (0.7 + 0.3 * long) * (1 - k * 0.55) });
    }
  }
  // 輪: 弾けた次のフレームから、放射線の根元の内側に広がる（瞬間に輪を出すと照準の印に見える）
  if ((o.ring ?? 1) > 0 && age >= 1) {
    const rr = (o.ringR ?? 4) + (age - 1) * (o.ringSpeed ?? 4);
    ring(frame, { ox: x, oy: y, radius: rr, width: 1.8, erosion: Math.min(0.92, 0.1 + age * 0.2), bright: 0.75 - age * 0.08, seed: seed + 2 });
  }
  shards(frame, age, o.shards ?? 6, seed + 3, (i, rnd) => {
    const a = (o.spray ?? 0) + (rnd(1) - 0.5) * (o.spread ?? TAU);
    const sp = 2.5 + rnd(2) * 3.5;
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

/** 波の伝わる音の輪（鞭鳴らし）: 先端の前に、進む向きへ開いた短い弧が並んで広がる */
function soundArcs(frame, x, age) {
  for (let i = 0; i < 3; i++) {
    const r = 8 + i * 7 + age * 6;
    const half = (0.9 - i * 0.12) * (1 - age * 0.12);
    if (half <= 0.15) continue;
    arcLine(frame, { ox: x, radius: r, from: -half, to: half, width: 1.2, bright: (0.8 - i * 0.15) * (1 - age * 0.2) });
  }
}

// -----------------------------------------------------------------------------
// 突き型（手元から先端へ波打ちながら伸び、伸び切った先端で破裂する）
// -----------------------------------------------------------------------------

/**
 * 突きの鞭 1 フレーム。active の間は S 字の波が手元 → 先端へ流れながら伸び、最後の active で真っ直ぐに張って先端が弾ける。
 * 振り終わりは緩んで垂れ、手元から崩れて消える
 */
function whipThrust(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const reach = spec.reach;
  let tipX;
  let wave;
  let erosion = 0;
  let bright = 1;
  let glow = 0;
  let wScale = 1;
  if (f < A) {
    const p = (f + 1) / A;
    const ext = easeSwing(p);
    tipX = HAND + (reach - HAND) * (0.3 + 0.7 * ext);
    // 波の山は p とともに先端へ進み、振り切り（p = 1）で振幅が 0 近くまで縮む（鞭が張る）
    const amp = spec.amp * (1 - 0.82 * p * p);
    const travel = spec.travel ?? 0.9;
    wave = (s) => amp * Math.sin(TAU * (s * spec.waves - p * travel) + (spec.phase ?? 0)) * Math.pow(s, 0.6) + (spec.bow ?? 0) * Math.sin(Math.PI * s) * (1 - p);
    glow = f === A - 1 ? 0.55 : 0.15 * p;
    wScale = 0.85 + 0.15 * p;
  } else {
    const k = (f - A + 1) / (N - A + 1);
    tipX = reach - k * 10;
    // 緩み: 小さなうねりと、片側への垂れ
    const amp = spec.amp * 0.22 * (1 - k * 0.5);
    wave = (s) => amp * Math.sin(TAU * (s * 1.4 + k * 0.6)) * s + (spec.sag ?? 8) * k * Math.sin(Math.PI * s * 0.9);
    erosion = 0.08 + 0.85 * Math.pow(k, 1.1);
    bright = 1 - 0.3 * k;
    wScale = 1 - 0.35 * k;
    glow = k < 0.3 ? 0.2 : 0;
  }
  const pts = linePts(HAND, tipX, wave);
  tube(frame, pts, { w0: (spec.w0 ?? 1.5) * wScale, w1: 0.8, bright, erosion, glow, seed: spec.seed });
  const tip = pts[pts.length - 1];
  return { tipX: reach, tipY: 0, tip };
}

/** 左 1 段（thrust reach 56）: 基本の一打ち。1 つの S 字の波が先端へ流れて、小さく弾ける */
const L0 = { reach: 112, amp: 12, waves: 1, travel: 0.9, frames: 8, active: 4, w0: 1.5, seed: 801, sag: 7 };
function lash0(frame, f) {
  whipThrust(frame, f, L0);
  burst(frame, L0.reach, 0, f - (L0.active - 1), { size: 4, lines: 8, len: 14, seed: 802, shards: 6, spray: 0, spread: 2.4 });
}

/** 左 4 段（終撃・thrust reach 60）: 頭上から大きく振り下ろす。波が大きく 1.5 周期、破裂は二重の輪と長い放射 */
const L3 = { reach: 120, amp: 22, waves: 1.5, travel: 1.2, bow: -10, frames: 9, active: 4, w0: 1.8, seed: 811, sag: 10 };
function lash3(frame, f) {
  whipThrust(frame, f, L3);
  const age = f - (L3.active - 1);
  burst(frame, L3.reach, 0, age, { size: 4, lines: 12, len: 16, seed: 812, ringR: 6, ringSpeed: 5, shards: 12, spray: 0, spread: 3 , life: 5});
  if (age >= 1) ring(frame, { ox: L3.reach - 2, radius: 4 + age * 3, width: 1.4, erosion: Math.min(0.9, age * 0.22), bright: 0.65 - age * 0.07, seed: 813 });
}

/** 右: 鞭鳴らし（thrust reach 64・長い硬直）。ほぼ真っ直ぐ張ってから弾く。音の弧が前へ広がる（恐怖を与える「音」） */
const CRACK = { reach: 128, amp: 8, waves: 2, travel: 1.6, frames: 9, active: 4, w0: 1.5, seed: 821, sag: 6 };
function whipCrack(frame, f) {
  whipThrust(frame, f, CRACK);
  const age = f - (CRACK.active - 1);
  burst(frame, CRACK.reach, 0, age, { size: 4, lines: 10, len: 14, seed: 822, ring: 0, shards: 8, life: 5 });
  if (age >= 0) soundArcs(frame, CRACK.reach, age);
}

/** 派生: 蛇打ち（thrust reach 60・2 段）。細かい蛇行（2.5 周期）が 2 度走り、2 度弾ける。2 度目は少し横へずれる */
const SNAKE = { reach: 120, amp: 9, waves: 2.6, travel: 1.4, frames: 8, active: 4, w0: 1.4, seed: 831, sag: 6 };
function snakeLash(frame, f) {
  // 1 打目: active の前半（f 0〜1）で伸びて弾け、少し引いてから 2 打目（f 2〜3）
  const first = f < 2;
  const sub = { ...SNAKE, active: 2, frames: first ? 4 : SNAKE.frames - 2, phase: first ? 0 : Math.PI, reach: first ? SNAKE.reach - 18 : SNAKE.reach };
  whipThrust(frame, first ? f : f - 2, sub);
  burst(frame, SNAKE.reach - 18, 0, f - 1, { size: 3, lines: 6, len: 9, seed: 832, shards: 4, life: 3, ringR: 4 });
  burst(frame, SNAKE.reach, 0, f - 3, { size: 3, lines: 8, len: 11, seed: 833, shards: 7, spray: 0, spread: 2.4 });
}

/** 螺旋の点（中心 cx, cy・半径 r0 → r1・角 a0 から turns 周。dir = 巻く向き） */
function spiralPts(cx, cy, r0, r1, a0, turns, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + turns * TAU * t;
    const r = r0 + (r1 - r0) * t;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** 右: 巻き付け（thrust reach 64）。伸びた先端が相手に螺旋で巻き付き、締めながら手元へ引き寄せる */
const ENT = { reach: 128, frames: 9, active: 4, seed: 841 };
function entangle(frame, f) {
  const A = ENT.active;
  const N = ENT.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? (f + 1) / A : 1;
  // 巻く中心（当たり判定の先端の少し手前）。振り終わりは手元へ引かれて近づく
  const cx = ENT.reach - 12 - k * 22;
  const R0 = 14 * (1 - k * 0.35);
  const turns = f < A ? Math.max(0, (p - 0.35) / 0.65) * 1.75 : 1.75 + k * 0.4;
  const entry = { x: cx, y: -R0 };
  const straightTip = HAND + (ENT.reach - HAND) * easeSwing(Math.min(1, p / 0.5));
  const erosion = k > 0 ? 0.1 + 0.8 * Math.pow(k, 1.2) : 0;
  let pts;
  if (turns <= 0) {
    // 巻き始める前: 波打ちながら真っ直ぐ伸びる
    pts = linePts(HAND, straightTip, (s) => 9 * Math.sin(TAU * (s * 1.2 - p)) * Math.pow(s, 0.6));
  } else {
    // 手元 → 螺旋の入口は、少し反った線。入口から中心の周りを時計回りに巻き込み、半径を詰める
    const body = [];
    for (let i = 0; i <= 40; i++) {
      const s = i / 40;
      body.push({ x: HAND + (entry.x - HAND) * s, y: entry.y * Math.pow(s, 1.6) + 5 * Math.sin(Math.PI * s) * (1 - k) });
    }
    const coil = spiralPts(cx, 0, R0, R0 * (0.45 - k * 0.1), -Math.PI / 2, turns, Math.ceil(24 * turns) + 2);
    pts = body.concat(coil.slice(1));
  }
  tube(frame, pts, { w0: 1.5, w1: 0.8, erosion, bright: 1 - 0.3 * k, glow: f === A - 1 ? 0.45 : 0.1, glowLen: 0.2, seed: ENT.seed });
  // 締めた瞬間の閃き（巻いた中心）と、手元へ引く速度線
  if (f === A - 1) sparkle(frame, cx, 0, 3);
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 引き寄せの速度線: 本体の来る上側を避け、螺旋の下半分から手元へ向けて引く（本体に平行な 2 本目に見せない）
    if (k < 0.8) {
      for (let i = 0; i < 2; i++) {
        const y = R0 * (0.35 + i * 0.6);
        const x1 = cx - R0 - 6 - hash1(i, ENT.seed + 2) * 6;
        streakLine(frame, { ax: x1 + 2, ay: y, bx: x1 - 18 - 10 * hash1(i, ENT.seed + 3), by: y, bright: 0.5 * (1 - k) });
      }
    }
    shards(frame, age, 6, ENT.seed + 4, (i, rnd) => {
      const a = rnd(1) * TAU;
      return { x: cx + Math.cos(a) * R0, y: Math.sin(a) * R0, vx: -2 - rnd(2) * 2, vy: Math.sin(a) * 1.5, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 鞭の途中の輪（ループ）を足した折れ線。c = 輪の位置（0..1）、rl = 輪の半径。
 * 輪の区間だけ x を戻し y を持ち上げて、ひと巻きの輪を作る
 */
function loopPts(xa, xb, c, rl, width, wave) {
  const pts = [];
  const L = xb - xa;
  const n = LINE_POINTS + 24;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    let x = xa + L * s;
    let y = wave(s);
    const t = (s - (c - width)) / (2 * width);
    if (t > 0 && t < 1) {
      const th = TAU * t;
      x += -rl * Math.sin(th) + L * width * 2 * (0 - (t - 0.5)) * 0 ;
      y += -rl * (1 - Math.cos(th));
    }
    pts.push({ x, y });
  }
  return pts;
}

/** 派生: 巻き上げ（thrust reach 56）。鞭の途中にできた輪が先端へ転がり、先端が上へ跳ね上がって弾ける */
const COIL = { reach: 112, frames: 8, active: 4, seed: 851 };
function coilUp(frame, f) {
  const A = COIL.active;
  const N = COIL.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? (f + 1) / A : 1;
  const tipX = HAND + (COIL.reach - HAND) * (0.45 + 0.55 * easeSwing(p));
  let pts;
  if (f < A - 1) {
    // 輪が手元寄りから先端寄りへ移る
    const c = 0.25 + 0.55 * (f / (A - 2));
    pts = loopPts(HAND, tipX, c, 7 + 2 * f, 0.1, (s) => 4 * Math.sin(Math.PI * s));
  } else {
    // 輪が先端へ抜けて、先端が上（-y）へ鉤のように跳ねる
    const lift = 16 + k * 6;
    pts = linePts(HAND, tipX - k * 8, (s) => (s > 0.7 ? -lift * Math.pow((s - 0.7) / 0.3, 1.8) : 0) + 3 * k * Math.sin(Math.PI * s));
  }
  const erosion = k > 0 ? 0.08 + 0.85 * Math.pow(k, 1.1) : 0;
  tube(frame, pts, { w0: 1.5, w1: 0.8, erosion, bright: 1 - 0.3 * k, glow: f === A - 1 ? 0.5 : 0.12, seed: COIL.seed });
  const tx = COIL.reach - 4;
  const ty = -16;
  const age = f - (A - 1);
  burst(frame, tx, ty, age, { size: 3, lines: 8, len: 11, seed: COIL.seed + 1, shards: 0, rot: 0.2 });
  // 跳ね上げの火花: 上へ巻き上がるように散る
  shards(frame, age, 9, COIL.seed + 2, (i, rnd) => {
    const a = -Math.PI / 2 + (rnd(1) - 0.3) * 1.4;
    const sp = 3 + rnd(2) * 3;
    return { x: tx, y: ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** 派生: 引き裂き（thrust reach 56）。真っ直ぐ伸びた先端を横へ引き、相手の上に裂け目を 1 本刻む */
const REND = { reach: 112, frames: 8, active: 4, seed: 861 };
function rend(frame, f) {
  const A = REND.active;
  const N = REND.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 先端の道: f 0〜1 で伸び、f 2〜3 で (reach, -18) → (reach - 8, +18) へ引き下ろす
  const ya = -18;
  const yb = 18;
  let tipX;
  let tipY;
  if (f <= 1) {
    const p = easeSwing((f + 1) / 2);
    tipX = HAND + (REND.reach - HAND) * (0.4 + 0.6 * p);
    tipY = ya * p;
  } else {
    const g = f < A ? easeSwing((f - 1) / 2) : 1;
    tipX = REND.reach - 8 * g;
    tipY = ya + (yb - ya) * g;
  }
  const erosion = k > 0 ? 0.1 + 0.85 * Math.pow(k, 1.1) : 0;
  // 本体: 先端の側へ引かれて、手元側がふくらむ弓なり
  // 本体: 伸びる間は波が先端へ流れ、引き下ろす間は先端に引かれて手元側が少し弓なりになる
  const p = Math.min(1, (f + 1) / 2);
  const wav = f <= 1 ? 10 * (1 - 0.6 * p) : 0;
  const bow = f >= 2 ? 4 : 0;
  const pts = linePts(HAND, tipX - k * 8, (s) => tipY * Math.pow(s, 1.8) + wav * Math.sin(TAU * (s * 1.2 - p * 0.9)) * Math.pow(s, 0.6) - bow * Math.sin(Math.PI * s));
  tube(frame, pts, { w0: 1.5, w1: 0.8, erosion, bright: 1 - 0.3 * k, glow: f === A - 1 ? 0.45 : 0.12, seed: REND.seed });
  // 裂け目: 先端の通り道に沿う 1 本のレンズ（前へふくらむ反り）
  if (f >= 2) {
    const g = f < A ? easeSwing((f - 1) / 2) : 1;
    lens(frame, { ax: REND.reach, ay: ya, bx: REND.reach - 8, by: yb, T: 7 * (1 - k * 0.5), bend: -5, grow: g, bias: 0.3, erosion: k * 0.9, seed: REND.seed + 1 });
  }
  if (f === A - 1) sparkle(frame, REND.reach - 6, yb - 4, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, REND.seed + 2, (i, rnd) => {
      const t = 0.2 + 0.7 * rnd(1);
      const sp = 2.5 + rnd(2) * 3;
      const a = (rnd(3) - 0.5) * 1.2;
      return { x: REND.reach - 8 * t, y: ya + (yb - ya) * t, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1.5, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 薙ぎ（arc）: 手元から外へ伸び、外周に沿って後ろへしなる J 字の鞭が振られる
// -----------------------------------------------------------------------------

/**
 * 薙ぎの鞭の折れ線。手元（角 head + lead）から外へ出て、しなりで遅れた先端（角 head・半径 R）に至り、
 * そこから外周に沿って trail だけ後ろへ流れる帯（先端の通った跡）が続く。帯には先端へ進む波（ripple）を乗せる。
 * 1 本の線として描く（体と帯を別々に描くと、弧が 2 本あるように見える）。戻り値の tipU は先端の位置（0..1）
 */
/** 薙ぎの体（手元 → 先端）の反り。真っ直ぐだと棒に見えるので、常に進む向きへ少しふくらませる */
const BODY_BOW = 9 * DEG;

function sweepPts(head, lead, R, trail, ripple, phase, waves) {
  const body = [];
  const nb = 28;
  for (let i = 0; i <= nb; i++) {
    const s = i / nb;
    const r = HAND + (R - HAND) * Math.sin((s * Math.PI) / 2);
    // 手元は先へ出て、先端へ向かうほど遅れる（外側ほど強く曲がる）
    const a = head + lead * (1 - s * s) + BODY_BOW * Math.sin(Math.PI * s);
    body.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const band = [];
  const nt = Math.max(8, Math.ceil(LINE_POINTS * (trail / Math.PI)));
  for (let i = 1; i <= nt; i++) {
    const t = i / nt;
    const a = head - trail * t;
    const r = R + ripple * Math.sin(TAU * (t * waves + phase)) * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - 0.5 * t);
    band.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const lenBody = R - HAND + lead * R * 0.5;
  const lenBand = trail * R;
  return { pts: body.concat(band), tipU: lenBody / (lenBody + lenBand) };
}

/**
 * 薙ぎ 1 フレーム。先端の角が振り幅を走り、その後ろに外周の帯が流れる。手元は先へ出て（lead）、振り切りで先端が追いついて弾ける
 */
function whipSweep(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  let head;
  let lead;
  let trail;
  let erosion = 0;
  let bright = 1;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    head = from + sweep * p;
    lead = spec.lead * (1 - p);
    trail = Math.max(0.25, sweep * p * spec.trail);
  } else {
    head = from + sweep * (1 + 0.05 * k);
    lead = -spec.lead * 0.25 * k;
    trail = sweep * spec.trail * (1 - 0.6 * k);
    erosion = 0.08 + 0.85 * Math.pow(k, 1.1);
    bright = 1 - 0.3 * k;
  }
  const flash = f === A - 1 || (spec.flashes ?? []).includes(f);
  const { pts, tipU } = sweepPts(head, lead, spec.R, trail, spec.ripple * (1 - k * 0.5), (f + 1) / A, spec.waves);
  // 明るさ: 手元は控えめ、先端で最も明るく（振り切りは白い点）、帯の尾へ向けて暗く細る
  const lum = (u) => {
    if (u <= tipU) return 0.56 + 0.26 * Math.pow(u / tipU, 1.5) + (flash && u > tipU - 0.04 ? 0.35 : 0);
    const t = (u - tipU) / (1 - tipU);
    return 0.82 * (1 - 0.55 * t) + (flash && t < 0.04 ? 0.35 : 0);
  };
  tube(frame, pts, { w0: spec.w0 ?? 1.4, w1: 0.7, erosion, bright, seed: spec.seed, lum });
  // 速度線は引かない（帯のすぐ外に弧を足すと、帯が 2 本あるように見える。帯そのものが軌跡）
  const age = f - (A - 1);
  if (age >= 0 && !spec.noBurst) {
    const tipA = from + sweep;
    burst(frame, Math.cos(tipA) * spec.R, Math.sin(tipA) * spec.R, age, { size: 3, lines: 8, len: 11, seed: spec.seed + 7, shards: spec.shards ?? 6, spray: tipA + Math.PI / 2, spread: 2 });
  }
  return { head, trail, pts, tip: { x: Math.cos(head) * spec.R, y: Math.sin(head) * spec.R } };
}

/** 左 2 段（arc 120° reach 44）: 帯は振り幅の 7 割まで流れる。波 2 つ */
const S1 = { R: 88, sweep: 120, tilt: 0, lead: 40 * DEG, trail: 0.7, ripple: 4, waves: 2, frames: 8, active: 4, seed: 871 };
/** 左 3 段（arc 180° reach 48・2 段）: 大きく長い帯、波 3 つ。途中（1 段目の当たり）でも先端が閃く */
const S2 = { R: 96, sweep: 180, tilt: 6, lead: 50 * DEG, trail: 0.75, ripple: 5, waves: 3, frames: 9, active: 5, seed: 881, shards: 8, w0: 1.6, flashes: [1] };
/** 右: 打ち払い（arc 180° reach 44）: 低く平たく払う。うねりは小さく、払った帯から土埃の粒がこぼれる */
const SW = { R: 88, sweep: 180, tilt: -4, lead: 15 * DEG, trail: 0.95, ripple: 0.8, waves: 1, frames: 8, active: 4, seed: 891, shards: 10, w0: 1.7, noBurst: true };

function sweep1(frame, f) {
  whipSweep(frame, f, S1);
}

function sweep2(frame, f) {
  const r = whipSweep(frame, f, S2);
  if (f === 1) sparkle(frame, r.tip.x, r.tip.y, 3);
}

function sweepLow(frame, f) {
  const r = whipSweep(frame, f, SW);
  // 払い: 先端で弾けず、帯の上から土埃の粒が外へ払い出される（重い払い飛ばし）
  const age = f - 1;
  if (age < 0) return;
  shards(frame, age, 20, SW.seed + 9, (i, rnd) => {
    const a = r.head - r.trail * (0.05 + 0.9 * rnd(1));
    const rr = SW.R - 2 + rnd(2) * 4;
    const sp = 1.5 + rnd(3) * 2.5;
    // 外向きと、振る向き（接線）を混ぜる
    const vx = Math.cos(a) * 0.7 - Math.sin(a) * 0.7;
    const vy = Math.sin(a) * 0.7 + Math.cos(a) * 0.7;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: vx * sp, vy: vy * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.72 };
  });
  // 土埃の塊: 帯の外側に、ふわっと膨らんで欠けていく小さな粒の雲
  for (let i = 0; i < 5; i++) {
    const born = 1 + (i % 3);
    const t = f - born;
    if (t < 0 || t > 4) continue;
    const a = r.head - r.trail * (0.15 + 0.17 * i) - 0.1 * t;
    const rr = SW.R + 4 + t * 3;
    puff(frame, Math.cos(a) * rr, Math.sin(a) * rr, 2 + t * 0.9, t / 4, SW.seed + 20 + i);
  }
  if (f === SW.active - 1) sparkle(frame, r.tip.x, r.tip.y, 3);
}

/** 小さな土埃の雲（半径 rad・崩れ k 0..1）。縁ほど暗く、ノイズで欠ける */
function puff(frame, cx, cy, rad, k, seed) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d > 1) return -1;
      if (valueNoise(x, y, 2.2, seed) * 0.8 + (1 - d) * 0.3 - k * 0.9 < 0.1) return -1;
      return clamp01((0.55 - 0.3 * d) * (1 - k * 0.5));
    },
    { bounds: { x0: cx - rad - 1, y0: cy - rad - 1, x1: cx + rad + 1, y1: cy + rad + 1 } },
  );
}

// -----------------------------------------------------------------------------
// 回転（circle）: 自分の周りを大きくうねる円
// -----------------------------------------------------------------------------

/**
 * 回る鞭の折れ線。手元の角 head から、先へ反った根元（lead）で外へ出て、半径 R の円を後ろ（反時計回り）へ span だけ引きずる。
 * 円の半径に lobes 山のうねりを乗せる。先端は引きずられた端
 */
function circlePts(head, R, span, amp, lobes, phase) {
  const pts = [];
  const n = Math.max(24, Math.ceil(LINE_POINTS * (0.5 + span / TAU)));
  const lead = 0.6;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const out = Math.min(1, s / 0.18);
    const back = s < 0.1 ? 0 : (s - 0.1) / 0.9;
    // 根元は回る向きへ反らせる（真っ直ぐだと時計の針に見える）
    const a = head - span * back + lead * (1 - out) * (1 - out);
    const r = HAND + (R - HAND) * Math.sin((out * Math.PI) / 2) + amp * Math.sin(lobes * a - phase) * back;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 回転のフレーム f の形（手元の角・引きずる長さ・うねりの位相） */
function circleState(f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? (f + 1) / A : 1;
  const head = -Math.PI / 2 + spec.turns * TAU * (f < A ? easeSwing(p) : 1 + 0.08 * k);
  const span = f < A ? spec.span * (0.35 + 0.65 * p) : spec.span * (1 - 0.3 * k);
  const pts = circlePts(head, spec.R + k * 4, span, spec.amp * (1 - 0.4 * k), spec.lobes, TAU * p * 1.3);
  return { k, head, pts };
}

/** 回転 1 フレーム。hits の数だけ先端で弾ける（flashes はフレーム番号）。速度線は引かない（外に弧を足すと鞭が 2 本に見える） */
function whipCircle(frame, f, spec) {
  const { k, head, pts } = circleState(f, spec);
  const erosion = k > 0 ? 0.08 + 0.85 * Math.pow(k, 1.1) : 0;
  const flash = spec.flashes.includes(f);
  tube(frame, pts, { w0: spec.w0 ?? 1.6, w1: 0.8, erosion, bright: 1 - 0.3 * k, glow: flash ? 0.5 : 0.1, glowLen: 0.08, seed: spec.seed, lum: (u) => 0.52 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.3)) });
  // 破裂: 弾けたフレームの先端の位置に置き、以後もその場で広がる（回り続ける鞭からは離れていく）
  const impacts = [];
  for (const [j, ff] of spec.flashes.entries()) {
    const age = f - ff;
    if (age < 0 || age > 5) continue;
    const t = circleState(ff, spec).pts.at(-1);
    const at = Math.atan2(t.y, t.x);
    impacts.push({ x: t.x, y: t.y, age, j });
    burst(frame, t.x, t.y, age, { size: j === spec.flashes.length - 1 ? 4 : 3, lines: 8, len: 11, seed: spec.seed + 10 + j, shards: 5, spray: at, spread: 2.2, life: 3 });
  }
  return { head, pts, impacts };
}

/** ダッシュ攻撃（circle size 70）: 走り抜けながら 1 周大きく回す。うねり 5 山 */
const DASH = { R: 70, span: 250 * DEG, amp: 5, lobes: 5, turns: 1, frames: 8, active: 4, seed: 901, flashes: [3] };
/** 右: 地打ち（circle size 48・2 段）: 小さめの円を 2 度地面へ叩きつける。当たりごとに閃き、地面の割れ目の短い放射 */
const GROUND = { R: 50, span: 300 * DEG, amp: 4, lobes: 6, turns: 1.2, frames: 9, active: 5, seed: 911, flashes: [1, 4] };
/** 派生: 巻き打ち（circle size 80・3 段）: 螺旋のように何度も巻いて大きく回す。3 回の閃き */
const WHIRL = { R: 80, span: 320 * DEG, amp: 7, lobes: 4, turns: 1.6, frames: 10, active: 6, seed: 921, flashes: [1, 3, 5] };

function dash(frame, f) {
  whipCircle(frame, f, DASH);
}

function groundLash(frame, f) {
  const { impacts } = whipCircle(frame, f, GROUND);
  // 地面を打った所から土煙が外へ膨らむ（地打ちの重さ。弧や輪は足さない）
  for (const imp of impacts) {
    if (imp.age < 1) continue;
    const a0 = Math.atan2(imp.y, imp.x);
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i - 1) * 0.35;
      const rr = Math.hypot(imp.x, imp.y) + 3 + imp.age * 3;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr, 2.2 + imp.age * 0.8, (imp.age - 1) / 4, GROUND.seed + 40 + i + imp.j * 3);
    }
  }
}

function whirl(frame, f) {
  whipCircle(frame, f, WHIRL);
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中: 鞭の跡（ミミズ腫れのような短い曲線。進む向き +x に沿って、前へふくらむ）+ 破裂の火花。
 * heavy は跡が長く太く、破裂が大きい（二重の輪・長い放射）
 */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const L = heavy ? 30 : 20;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    // 跡は後ろ（-x）から前へ走り、f = 0 では途中まで
    // 崩れの間は後ろの端から縮む（跡の尾が先に消える）
    const s0 = k * 0.45;
    const s = s0 + (i / 32) * (grow - s0);
    pts.push({ x: -L + 2 * L * s, y: -(heavy ? 6 : 4) * Math.sin(Math.PI * s) + 2 * Math.sin(TAU * s) });
  }
  // 両端の尖ったミミズ腫れ（中央が太い）
  const wMax = heavy ? 2.1 : 1.5;
  const width = (u) => 0.6 + (wMax - 0.6) * Math.pow(Math.sin(Math.PI * (grow < 1 ? 0.5 + 0.5 * u : u)), 0.8);
  tube(frame, pts, { width, w0: wMax, erosion: Math.min(1, k * 1.1), bright: 1 - 0.3 * k, glow: f <= 1 ? 0.3 : 0, glowLen: 0.35, seed: heavy ? 931 : 941, lum: (u) => 0.5 + 0.3 * Math.sin(Math.PI * u) });
  if (heavy) {
    burst(frame, 0, 0, f, { size: 4, lines: 12, len: 18, seed: 932, ringR: 6, ringSpeed: 6, shards: 12, spray: 0, spread: 3.2, life: 5 });
  } else {
    burst(frame, 0, 0, f, { size: 3, lines: 8, len: 10, seed: 942, ringR: 4, ringSpeed: 3.5, shards: 7, spray: 0, spread: 2.6, life: 4 });
  }
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 突き型は pivot self（手元から伸びるので自分が原点）、base は reach。回転は size
 */
const FX = {
  moveset: "whip",
  motions: {
    "l:0": { sheet: "whip.lash", pivot: "self", base: 56, measure: "reach" },
    "l:1": { sheet: "whip.sweep", pivot: "self", base: 44, measure: "reach" },
    "l:2": { sheet: "whip.sweepWide", pivot: "self", base: 48, measure: "reach" },
    "l:3": { sheet: "whip.lashHeavy", pivot: "self", base: 60, measure: "reach" },
    dash: { sheet: "whip.dash", pivot: "self", base: 70, measure: "size" },
    "r:entangle": { sheet: "whip.entangle", pivot: "self", base: 64, measure: "reach" },
    "r:whipSweep": { sheet: "whip.sweepLow", pivot: "self", base: 44, measure: "reach" },
    "r:groundLash": { sheet: "whip.ground", pivot: "self", base: 48, measure: "size" },
    "r:whipCrack": { sheet: "whip.crack", pivot: "self", base: 64, measure: "reach" },
    "branch:whirl": { sheet: "whip.whirl", pivot: "self", base: 80, measure: "size" },
    "branch:snakeLash": { sheet: "whip.snake", pivot: "self", base: 60, measure: "reach" },
    "branch:coilUp": { sheet: "whip.coil", pivot: "self", base: 56, measure: "reach" },
    "branch:rend": { sheet: "whip.rend", pivot: "self", base: 56, measure: "reach" },
  },
  hit: "whip.hit",
  hitHeavy: "whip.hitHeavy",
};

export const ATLAS = {
  key: "whip",
  fx: FX,
  sheets: [
    { key: "whip.lash", dirs: DIRS, frames: L0.frames, active: L0.active, size: 280, draw: lash0 },
    { key: "whip.lashHeavy", dirs: DIRS, frames: L3.frames, active: L3.active, size: 300, draw: lash3 },
    { key: "whip.crack", dirs: DIRS, frames: CRACK.frames, active: CRACK.active, size: 340, draw: whipCrack },
    { key: "whip.snake", dirs: DIRS, frames: SNAKE.frames, active: SNAKE.active, size: 300, draw: snakeLash },
    { key: "whip.entangle", dirs: DIRS, frames: ENT.frames, active: ENT.active, size: 310, draw: entangle },
    { key: "whip.coil", dirs: DIRS, frames: COIL.frames, active: COIL.active, size: 280, draw: coilUp },
    { key: "whip.rend", dirs: DIRS, frames: REND.frames, active: REND.active, size: 280, draw: rend },
    { key: "whip.sweep", dirs: DIRS, frames: S1.frames, active: S1.active, size: 230, draw: sweep1 },
    { key: "whip.sweepWide", dirs: WIDE_DIRS, frames: S2.frames, active: S2.active, size: 250, draw: sweep2 },
    { key: "whip.sweepLow", dirs: WIDE_DIRS, frames: SW.frames, active: SW.active, size: 230, draw: sweepLow },
    { key: "whip.dash", dirs: 1, frames: DASH.frames, active: DASH.active, size: 200, draw: dash },
    { key: "whip.ground", dirs: 1, frames: GROUND.frames, active: GROUND.active, size: 160, draw: groundLash },
    { key: "whip.whirl", dirs: 1, frames: WHIRL.frames, active: WHIRL.active, size: 220, draw: whirl },
    { key: "whip.hit", dirs: DIRS, frames: 6, active: 0, size: 90, draw: (frame, f) => hit(frame, f, false) },
    { key: "whip.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 120, draw: (frame, f) => hit(frame, f, true) },
  ],
};
