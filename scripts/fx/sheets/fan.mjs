// moveset "fan"（扇子）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/fan.json）× 2 が目安
//
// 性格は「舞と風」。剣の三日月（太い刃の面）と見分けるため、弧は「扇の骨のような放射状の細い筋 + 外周の薄い風の帯」、
// 回転は「螺旋の風の線 + 周回する花びら」で描く。段は明るめ・薄め（面を太らせず、線と粒で見せる）
import { arcBounds, arcLine, crescentWidth, easeSwing, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, stamp, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（風の帯・扇の骨・花びら・螺旋）
// -----------------------------------------------------------------------------

/** 崩れの判定。ノイズと「芯からの近さ」で縁から欠ける */
function keep(x, y, erosion, core, seed) {
  if (erosion <= 0) return true;
  return valueNoise(x, y, 4, seed) * 0.7 + valueNoise(x, y, 1.6, seed + 3) * 0.2 + core * 0.3 - erosion * 1.1 > 0;
}

/**
 * 外周の薄い風の帯。半径 R の内側へ太さ T、角 tail → head（時計回りで head が先）。
 * 円周方向に流れる筋のむら（風の流れ）を付け、明部は外縁の 1 ドットだけ。sym = true なら両端が同じに細る（前へ押し出す帯）
 */
function windBand(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const edgeReach = o.edgeReach ?? 0.5;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const r = Math.hypot(dx, y);
      if (r > R) return -1;
      const s = wrapAngle(head - Math.atan2(y, dx));
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      const w = T * (o.sym ? Math.pow(Math.sin(Math.PI * u), 0.55) : crescentWidth(u, 0.1, 0.55));
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      const along = o.sym ? 1 - Math.abs(u - 0.5) : 1 - 0.55 * u;
      if (R - r < 1.2 && (o.sym ? Math.abs(u - 0.5) < edgeReach / 2 : u < edgeReach) && erosion < 0.5) return clamp01(0.78 * bright);
      // 風の筋: 円周方向に引き伸ばしたノイズで、帯の中に流れの縞を作る
      const n = valueNoise(s * R * 0.18, (R - r) * 1.1, 1.6, seed + 11);
      return clamp01(Math.pow(1 - q, 1.2) * along * (0.5 + 0.45 * n) * bright * (1 - erosion * 0.4));
    },
    { bounds: arcBounds(ox, 0, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/**
 * 扇の骨: 中心から外へ伸びる細い筋。angles の各角から r0..r1、curl で先が振りの後ろへしなる（風に押された骨）。
 * 外ほど明るく、根元は溶ける
 */
function ribs(frame, o) {
  const { angles, r0, r1 } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const curl = o.curl ?? 0;
  const width = o.width ?? 1.2;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 7;
  if (r1 - r0 < 2) return;
  angles.forEach((a, i) => {
    const bright = (o.bright ?? 0.6) * (o.brights?.[i] ?? 1);
    if (bright <= 0.05) return;
    paint(
      frame,
      (x, y) => {
        const dx = x - ox;
        const dy = y - oy;
        const r = Math.hypot(dx, dy);
        if (r < r0 || r > r1) return -1;
        const t = (r - r0) / (r1 - r0);
        const d = Math.abs(wrapAngle(Math.atan2(dy, dx) - (a + curl * t))) * r;
        const wt = width * (0.6 + 0.4 * t);
        if (d > wt / 2) return -1;
        if (!keep(x, y, erosion, t, seed + i)) return -1;
        return clamp01(bright * (0.3 + 0.7 * t));
      },
      { bounds: arcBounds(ox, oy, r0, r1, Math.min(a, a + curl) - 0.1, Math.max(a, a + curl) + 0.1), dither: 0, samples: 3 },
    );
  });
}

/** 花びらの形（画面に揃えて押す）。A = 明、B = 暗。フレームごとに形を替えて、ひらひら回って見せる */
const PETAL_SMALL = [["AAB"], [".A", "AB"], ["A", "A", "B"], ["A.", "AB"]];
const PETAL_LARGE = [[".A.", "AAB", ".B."], ["AA.", ".AB"], [".A", "AA", "BB"], [".AA", "BA."]];

function petal(frame, x, y, turn, level, large) {
  const set = large ? PETAL_LARGE : PETAL_SMALL;
  const shape = set[((turn % set.length) + set.length) % set.length] ?? set[0];
  const a = String(Math.min(7, level));
  const b = String(Math.max(4, level - 1));
  stamp(frame, x, y, shape.map((row) => row.replaceAll("A", a).replaceAll("B", b)));
}

/**
 * 舞う花びら。spawn(i, rnd) → {x, y, vx, vy, life, sway, large, delay}。
 * 減速しながら流れ、進む向きに直交して揺れる（ひらひら）
 */
function petals(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const rnd = (k) => hash1(i * 17 + k, seed);
    const s = spawn(i, rnd);
    if (!s) continue;
    const t = age - (s.delay ?? 0);
    if (t < 0 || t > s.life) continue;
    const drag = s.drag ?? 0.82;
    const travel = (1 - Math.pow(drag, t)) / (1 - drag);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const sway = (s.sway ?? 2) * Math.sin(t * 1.7 + rnd(9) * TAU);
    const x = s.x + s.vx * travel - (s.vy / sp) * sway;
    const y = s.y + s.vy * travel + (s.vx / sp) * sway;
    const fade = 1 - t / (s.life + 1);
    const level = Math.max(4, Math.round(4 + 3 * fade * (s.bright ?? 0.85)));
    petal(frame, x, y, t + i, level, s.large && fade > 0.35);
  }
}

/**
 * 螺旋の風の線（1 本の腕）。rot は内側の端の角、外へ行くほど sweep だけ後ろへ遅れる（時計回りの渦）。
 * 中ほどが太く明るく、両端は細く溶ける
 */
function spiralArm(frame, o) {
  const { rot, rIn, rOut } = o;
  const sweep = o.sweep ?? 1.2;
  const width = o.width ?? 2.4;
  const bright = o.bright ?? 0.7;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r < rIn || r > rOut) return -1;
      const t = (r - rIn) / (rOut - rIn);
      const d = Math.abs(wrapAngle(Math.atan2(y, x) - (rot - sweep * t))) * r;
      const bell = Math.pow(Math.sin(Math.PI * t), 0.6);
      const w = width * bell;
      if (w < 0.5 || d > w / 2) return -1;
      const q = d / (w / 2);
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.55 * q) * (0.45 + 0.55 * t) * (1 - erosion * 0.3));
    },
    { bounds: { x0: -rOut - 2, y0: -rOut - 2, x1: rOut + 2, y1: rOut + 2 } },
  );
}

/** active の間の進み（0..1）と、振り終わりの進み k（0 = まだ、1 = 消える直前） */
function phase(f, A, N) {
  return { p: f < A ? easeSwing((f + 1) / A) : 1, k: f < A ? 0 : (f - A + 1) / (N - A + 1) };
}

// -----------------------------------------------------------------------------
// 弧: 扇形に開く風（左 1〜4 段）
// -----------------------------------------------------------------------------

/**
 * 扇形の風の振り 1 フレーム。active の間に扇が時計回りに開き（帯の先端が走り、通り過ぎた所に骨が 1 本ずつ立つ）、
 * 振り終わりは風が外へ流れ出しながら、根元から骨がほどけ、帯が崩れて花びらが舞う
 */
function fanSwing(frame, f, s) {
  const half = (s.sweep * DEG) / 2;
  const from = -half + (s.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const { p, k } = phase(f, s.active, s.frames);
  const drift = k * (s.drift ?? 6);
  let head = from + sweep * p;
  let tail = from + sweep * Math.max(0, p - 1.05);
  if (k > 0) {
    head = from + sweep * (1 + 0.04 * k);
    tail = from + sweep * 0.7 * Math.pow(k, 0.8);
  }
  // 骨: 開いた範囲にだけ立つ。新しい骨ほど明るく、振り終わりは根元から外へ引いていく
  const angles = [];
  const brights = [];
  for (let i = 0; i < s.ribs; i++) {
    const a = from + (sweep * (i + 0.5)) / s.ribs;
    if (a > head - 0.05) continue;
    if (k > 0 && a < tail) continue;
    angles.push(a);
    brights.push(0.7 + 0.3 * clamp01(1 - (head - a) / sweep));
  }
  const rIn = s.R * (s.hub ?? 0.3);
  const rOut = s.R - s.T * 0.4 + drift;
  ribs(frame, { angles, brights, r0: rIn + (rOut - rIn) * Math.pow(k, 0.7) * 0.85, r1: rOut, curl: s.curl ?? -0.12, bright: (s.ribBright ?? 0.62) * (1 - k * 0.4), erosion: k * 0.8, seed: s.seed + 5 });
  const T = s.T * (f < s.active ? 0.75 + 0.25 * p : 1 - 0.45 * k);
  windBand(frame, { R: s.R + drift, T, head, tail, erosion: k * 0.85, bright: 1 - 0.25 * k, seed: s.seed });
  // 帯の外側に沿う 1 本の細い風の筋（外にだけ。内側に引くと二重の弧に見える）
  if (k < 0.7) arcLine(frame, { radius: s.R + drift + 2.5, from: head - (head - tail) * 0.45, to: head - 0.06, bright: 0.5 * (1 - k) });
  if (f === s.active - 1) {
    const tipR = s.R - 2;
    sparkle(frame, Math.cos(head) * tipR, Math.sin(head) * tipR, s.glint ?? 2);
  }
  // 花びら: 開いた扇の外周から、振りの向き（接線）と外へひらひら流れる
  petals(frame, f - (s.active - 2), s.petals, s.seed + 20, (i, rnd) => {
    const a = from + sweep * (0.2 + 0.8 * rnd(1));
    const r = s.R * (0.55 + 0.45 * rnd(2));
    const sp = 2 + rnd(3) * 2.5;
    const out = 0.3 + 0.4 * rnd(4);
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      delay: Math.floor(rnd(6) * 2),
      sway: 1.5 + rnd(7) * 1.5,
      large: rnd(8) > 0.6,
    };
  });
}

/** 左 1 段（arc 150° reach 24）: 5 本骨の軽い扇 */
const L1 = { R: 50, T: 7, sweep: 150, tilt: 0, frames: 8, active: 4, ribs: 5, curl: -0.12, petals: 6, seed: 1101 };
/** 左 2 段（返し。描画側が上下反転）: 骨を 6 本に増やし、しなりを強く、少し後ろへ傾ける */
const L2 = { R: 52, T: 6, sweep: 156, tilt: 8, frames: 8, active: 4, ribs: 6, curl: -0.22, hub: 0.4, petals: 7, seed: 1202 };
/** 左 4 段（arc 180° reach 30・終撃）: 9 本骨の大きな扇。花びらが最も多く、先端に光 */
const L4 = { R: 62, T: 10, sweep: 180, tilt: 0, frames: 9, active: 4, ribs: 9, curl: -0.14, petals: 16, ribBright: 0.7, glint: 3, drift: 10, seed: 1404 };

/**
 * 左 3 段（arc 200° reach 26・2 段ヒット）: 扇が大きく開ききった後（1 段目）、
 * 外周の風の帯が扇から離れて外へ押し出される（2 段目）。帯は常に 1 本（タイミングで 2 回を分ける）
 */
const L3 = { R: 52, T: 7, sweep: 200, frames: 9, active: 5, ribs: 8, seed: 1303 };
function fanDouble(frame, f) {
  const s = L3;
  const half = (s.sweep * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const A1 = 3;
  const p = f < A1 ? easeSwing((f + 1) / A1) : 1;
  const k = f < s.active ? 0 : (f - s.active + 1) / (s.frames - s.active + 1);
  const head = from + sweep * p;
  // 2 段目: 帯が外へ押し出される（f = 3, 4 で最も速く、以降は漂う）
  const push = f < A1 ? 0 : Math.min(1, (f - A1 + 1) / 2) * 12 + k * 6;
  const angles = [];
  for (let i = 0; i < s.ribs; i++) {
    const a = from + (sweep * (i + 0.5)) / s.ribs;
    if (a <= head - 0.05) angles.push(a);
  }
  const rIn = s.R * 0.3;
  const rOut = s.R - 3;
  const ribFade = f < A1 ? 0 : (f - A1 + 1) / (s.frames - A1 + 1);
  ribs(frame, { angles, r0: rIn + (rOut - rIn) * ribFade * 0.8, r1: rOut, curl: -0.12, bright: 0.62 * (1 - ribFade * 0.4), erosion: ribFade * 0.75, seed: s.seed + 5 });
  const tail = k > 0 ? from + sweep * 0.35 * k : from;
  const T = f < A1 ? s.T * (0.75 + 0.25 * p) : s.T * (1 - 0.4 * k);
  const pulse = f === A1 || f === A1 + 1 ? 1.1 : 1;
  windBand(frame, { R: s.R + push, T, head: from + sweep * (f < A1 ? p : 1), tail, erosion: k * 0.85, bright: pulse * (1 - 0.25 * k), seed: s.seed, sym: f >= A1, edgeReach: 0.8 });
  if (f === A1 - 1) sparkle(frame, Math.cos(head) * (s.R - 2), Math.sin(head) * (s.R - 2), 2);
  if (f === A1 + 1) sparkle(frame, s.R + push - 2, 0, 3);
  petals(frame, f - A1, 12, s.seed + 20, (i, rnd) => {
    const a = from + sweep * rnd(1);
    const r = s.R * (0.6 + 0.4 * rnd(2));
    const sp = 2.5 + rnd(3) * 2.5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a + 0.4) * sp, vy: Math.sin(a + 0.4) * sp, life: 3 + Math.floor(rnd(5) * 3), delay: Math.floor(rnd(6) * 2), sway: 2, large: rnd(8) > 0.55 };
  });
}

// -----------------------------------------------------------------------------
// 派生の弧: 颪（上から叩きつける風）・突風（遠くまで吹き抜ける風）
// -----------------------------------------------------------------------------

/**
 * 派生: 颪（arc 160° reach 30・重い）。扇は振らずに一度に開き、外から内へ風の筋が降り注いで床に叩きつけ、
 * 叩きつけた所から平たい波紋が 1 本、外へ広がる
 */
function downdraft(frame, f) {
  const N = 9;
  const A = 4;
  const R = 60;
  const half = 80 * DEG;
  const { k } = phase(f, A, N);
  // 降る筋: 外（高い所）から帯へ向かって縮みながら落ちる
  if (f < A) {
    const fall = (f + 1) / A;
    for (let i = 0; i < 9; i++) {
      const a = -half + (2 * half * (i + 0.5)) / 9 + (hash1(i, 1501) - 0.5) * 0.08;
      const head = R + 30 * (1 - fall) - 2;
      const len = 16 * (1 - fall * 0.6) + hash1(i, 1502) * 6;
      streakLine(frame, { ax: Math.cos(a) * (head + len), ay: Math.sin(a) * (head + len), bx: Math.cos(a) * head, by: Math.sin(a) * head, width: 1.3, bright: 0.55 + 0.3 * fall });
    }
  }
  // 扇: f = 1 から一度に開き、叩きつけ（f = A - 1）で最も明るい
  if (f >= 1) {
    const open = Math.min(1, f / 2);
    const angles = [];
    for (let i = 0; i < 7; i++) angles.push(-half * open + (2 * half * open * (i + 0.5)) / 7);
    const rOut = R - 4;
    ribs(frame, { angles, r0: 16 + (rOut - 16) * k * 0.85, r1: rOut, curl: 0, bright: 0.6 * (1 - k * 0.4), erosion: k * 0.8, seed: 1503 });
  }
  // 帯: 叩きつけまでは扇の外周、その後は帯そのものが平たい波紋になって外へ広がる（別の輪を重ねると二重に見える）
  if (f >= 1 && f < A) {
    const open = Math.min(1, f / 2);
    const slam = f === A - 1 ? 1.15 : 1;
    windBand(frame, { R, T: f === A - 1 ? 12 : 9, head: half * open, tail: -half * open, sym: true, edgeReach: 0.9, bright: slam, seed: 1504 });
  } else if (f >= A) {
    const age = f - A + 1;
    windBand(frame, { R: R + age * 7, T: 10 * (1 - 0.6 * k), head: half + 0.04 * age, tail: -half - 0.04 * age, sym: true, edgeReach: 0.7, erosion: k * 0.9, bright: 1 - 0.3 * k, seed: 1504 });
  }
  if (f === A - 1) {
    sparkle(frame, R - 3, 0, 4);
    sparkle(frame, Math.cos(half * 0.6) * (R - 3), Math.sin(half * 0.6) * (R - 3), 2);
    sparkle(frame, Math.cos(-half * 0.6) * (R - 3), Math.sin(-half * 0.6) * (R - 3), 2);
  }
  // 押し潰された花びら: 床を這うように外へ
  petals(frame, f - (A - 1), 14, 1506, (i, rnd) => {
    const a = -half + 2 * half * rnd(1);
    const r = R * (0.5 + 0.45 * rnd(2));
    const sp = 2.5 + rnd(3) * 3;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), sway: 1.2, large: rnd(5) > 0.5 };
  });
}

/**
 * 派生: 突風（arc 120° reach 44）。構えを離した一吹き。扇の骨の向きに長い風の筋が外へ走り、
 * 先頭の帯が扇形のまま遠くへ押し出される（振りで角を走る左の段と違い、半径が伸びる）
 */
function gust(frame, f) {
  const N = 8;
  const A = 4;
  const R = 88;
  const half = 60 * DEG;
  const { p, k } = phase(f, A, N);
  const front = 22 + (R - 22) * p + k * 8;
  for (let i = 0; i < 11; i++) {
    const a = -half + (2 * half * (i + 0.5)) / 11 + (hash1(i, 1601) - 0.5) * 0.06;
    const lag = hash1(i, 1602) * 14;
    const tip = front - 4 - lag;
    const len = 18 + hash1(i, 1603) * 16;
    const back = Math.max(10, tip - len * (1 - k * 0.5)) + k * 20;
    if (tip - back < 3 || k > 0.85) continue;
    const w = i % 3 === 1 ? 1.5 : 1.1;
    streakLine(frame, { ax: Math.cos(a) * back, ay: Math.sin(a) * back, bx: Math.cos(a) * tip, by: Math.sin(a) * tip, width: w, bright: (0.6 + 0.15 * (i % 2)) * (1 - k * 0.6) });
  }
  windBand(frame, { R: front, T: 8 * (0.7 + 0.3 * p) * (1 - 0.45 * k), head: half, tail: -half, sym: true, edgeReach: 0.7, erosion: k * 0.85, bright: 1 - 0.25 * k, seed: 1604 });
  if (f === A - 1) sparkle(frame, front - 2, 0, 3);
  petals(frame, f, 14, 1605, (i, rnd) => {
    const a = -half + 2 * half * rnd(1);
    const r = 14 + rnd(2) * 20;
    const sp = 6 + rnd(3) * 5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 + Math.floor(rnd(4) * 4), delay: Math.floor(rnd(5) * 3), drag: 0.86, sway: 2, large: rnd(6) > 0.55 };
  });
}

// -----------------------------------------------------------------------------
// 箱・突き: 扇打ち（閉じる閃光）・烈風（前へ飛ぶ風の刃）
// -----------------------------------------------------------------------------

/**
 * 右: 扇打ち（box reach 16 / size 24・当たりの中心が原点）。自分の側を要に開いていた骨が一気に閉じ、
 * 閉じた扇の先で「パチン」と鋭い閃光と短い放射が弾ける
 */
function fanSnap(frame, f) {
  const N = 7;
  const A = 3;
  const px = -30;
  const len = 44;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  if (f < A - 1) {
    const spread = (f === 0 ? 50 : 18) * DEG;
    const angles = [];
    for (let i = 0; i < 6; i++) angles.push(-spread + (2 * spread * i) / 5);
    ribs(frame, { ox: px, angles, r0: 12, r1: len, curl: 0, width: 1.3, bright: 0.72, seed: 1701 });
    arcLine(frame, { ox: px, radius: len - 1, from: -spread, to: spread, bright: 0.6 });
  } else if (f === A - 1) {
    // 閉じた扇: 1 本の細い光の線
    streakLine(frame, { ax: px + 10, ay: 0, bx: px + len + 2, by: 0, width: 2, bright: 0.8 * (1 - k) });
  }
  const tip = px + len;
  if (f === A - 1) {
    sparkle(frame, tip, 0, 4);
    ring(frame, { ox: tip, radius: 5, width: 2.4, bright: 0.9, seed: 1702 });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 放射: 8 方の短い閃き。長短を交互にして鋭く
    for (let i = 0; i < 8; i++) {
      // 十字に揃えると照準のように見えるので、斜めに半目ずらし、前寄りの放射を長くする
      const a = (i / 8) * TAU + Math.PI / 8;
      const long = i === 0 || i === 7 || i === 3 || i === 4;
      const r1 = (long ? 18 : 11) + age * 3;
      const r0 = 4 + age * (long ? 5 : 3.5);
      if (r0 >= r1 || age > 3) continue;
      streakLine(frame, { ax: tip + Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: tip + Math.cos(a) * r0, by: Math.sin(a) * r0, width: long ? 1.6 : 1.1, bright: (long ? 0.95 : 0.7) * (1 - age * 0.2) });
    }
    if (age >= 1) ring(frame, { ox: tip, radius: 5 + age * 4, width: 1.8, erosion: Math.min(0.9, 0.15 + age * 0.22), bright: 0.7 - age * 0.1, seed: 1703 });
    if (age === 1) sparkle(frame, tip, 0, 2);
  }
  petals(frame, f - (A - 1), 8, 1704, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.4;
    const sp = 3 + rnd(2) * 3;
    return { x: tip, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), sway: 1.2, large: rnd(4) > 0.6 };
  });
}

/**
 * 派生: 烈風（thrust reach 40）。前へ弓なりに反った細い風の刃（三日月）が飛び、後ろに風の筋と花びらの航跡を引く
 */
function galeCut(frame, f) {
  const N = 7;
  const A = 3;
  // 刃は飛ぶので、振りのような「始めが速い」緩急を付けず、ほぼ等速で前へ進める
  const p = f < A ? (f + 1) / A : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const X = 20 + 64 * p + k * 22;
  const Rm = 19;
  const reachY = 18 * (1 - k * 0.15);
  const thick = 7 * (1 - 0.45 * k);
  const erosion = k * 0.85;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(y) > reachY) return -1;
      // 外の円（前縁）と、少し後ろへずらした同じ半径の円の差 = 前へ反った三日月
      const dOut = Math.hypot(x - (X - Rm), y);
      if (dOut > Rm) return -1;
      if (Math.hypot(x - (X - Rm - thick), y) < Rm) return -1;
      const e = Math.abs(y) / reachY;
      const q = (Rm - dOut) / Math.max(0.6, thick * (1 - e * e));
      if (q > 1) return -1;
      if (!keep(x, y, erosion, 1 - q, 1801)) return -1;
      if (Rm - dOut < 1.1 && e < 0.55 && k < 0.4) return 0.9;
      return clamp01((1 - q) ** 1.1 * (1 - 0.45 * e) * 0.8 * (1 - erosion * 0.4));
    },
    { bounds: { x0: X - Rm - thick - 2, y0: -reachY - 1, x1: X + 1, y1: reachY + 1 } },
  );
  // 航跡: 刃の後ろに離して引く短い風の筋。長さと位置をばらして、筒のような平行線に見せない
  if (k < 0.85) {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 5 + (hash1(i, 1804) - 0.5) * 3;
      const edge = X - Rm + Math.sqrt(Math.max(0, Rm * Rm - y * y));
      const x1 = edge - thick - 5 - hash1(i, 1802) * 8 - k * 14;
      const len = (10 + hash1(i, 1803) * 22) * (1 - k * 0.5);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: (i === 2 ? 0.6 : 0.45) * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, X - 1, 0, 3);
  // 航跡に残る花びら: 刃が通った所から、少し遅れて前へ漂う
  petals(frame, f, 10, 1805, (i, rnd) => {
    const t0 = rnd(1);
    return { x: 16 + 64 * t0, y: (rnd(2) - 0.5) * 22, vx: 1.2 + rnd(3) * 2, vy: (rnd(4) - 0.5) * 2, life: 3 + Math.floor(rnd(5) * 3), delay: Math.floor(t0 * 3), sway: 2, large: rnd(6) > 0.6 };
  });
}

// -----------------------------------------------------------------------------
// 回転: 花びらを巻き上げる渦（ダッシュ・花舞・蝶舞・花吹雪）
// -----------------------------------------------------------------------------

/** 蝶の形（翅を開く / 閉じる）。画面に揃えて押す */
const BUTTERFLY = [
  ["66.66", "56765", ".5.5."],
  [".6.6.", "..7..", ".5.5."],
];

/**
 * 渦 1 フレーム。arms 本の螺旋の風の線が回り、外周を薄い風の帯が追い、花びらが周回しながら巻き上がる。
 * flashes のフレームで明るくなり（多段ヒットの拍）、振り終わりは花びらが接線へ散る
 */
function whirl(frame, f, s) {
  const { arms, frames: N, active: A } = s;
  // 巻き始めの 2 枚は渦が内から外へ広がる（出だしから満開だと唐突に見える）
  const R = s.R * Math.min(1, 0.65 + 0.175 * (f + 1));
  const { p, k } = phase(f, A, N);
  const turn = s.turn ?? 1.5;
  const rot = f < A ? p * turn * Math.PI : turn * Math.PI + Math.sin(k * Math.PI * 0.5) * 0.7;
  const flash = s.flashes.includes(f) ? 1.15 : 1;
  for (let i = 0; i < arms; i++) {
    const a = rot + (i * TAU) / arms;
    spiralArm(frame, { rot: a, rIn: R * 0.22 + k * R * 0.3, rOut: R * 0.95, sweep: 1.25, width: s.armWidth ?? 2.6, bright: 0.72 * flash * (1 - 0.35 * k), erosion: k * 0.85, seed: s.seed + i });
    // 腕の外の端から後ろへ流れる帯（外周の風）
    const tipA = a - 1.25 * 0.95;
    windBand(frame, { R: R + 3 + k * 5, T: 4 * (1 - 0.4 * k), head: tipA + 0.35, tail: tipA - 1.1, erosion: k * 0.9, bright: 0.85 * flash * (1 - 0.3 * k), seed: s.seed + 10 + i });
  }
  if (s.flashes.includes(f)) {
    for (let i = 0; i < arms; i++) {
      const a = rot + (i * TAU) / arms - 1.25 * 0.7;
      sparkle(frame, Math.cos(a) * R * 0.75, Math.sin(a) * R * 0.75, 2);
    }
  }
  // 周回する花びら: active の間は渦に乗って回り、振り終わりは接線へ放たれる
  for (let i = 0; i < s.petals; i++) {
    const rnd = (q) => hash1(i * 19 + q, s.seed + 30);
    const r0 = R * (0.35 + 0.6 * rnd(1));
    const speed = 0.9 + 0.5 * rnd(2);
    const base = rnd(3) * TAU;
    const lift = (rnd(4) - 0.5) * 6 * Math.sin(f * 1.3 + rnd(5) * TAU);
    let x;
    let y;
    const a = base + rot * speed * (1.2 - r0 / R * 0.4);
    if (k === 0) {
      x = Math.cos(a) * (r0 + lift);
      y = Math.sin(a) * (r0 + lift);
    } else {
      const t = f - A + 1;
      const sp = 3 + 3 * rnd(6);
      x = Math.cos(a) * r0 + (-Math.sin(a) * 0.7 + Math.cos(a) * 0.6) * sp * t;
      y = Math.sin(a) * r0 + (Math.cos(a) * 0.7 + Math.sin(a) * 0.6) * sp * t;
      if (rnd(7) < k * 0.9) continue;
    }
    const level = Math.round(6 - 2 * k + (flash > 1 ? 1 : 0));
    petal(frame, x, y, f + i, level, rnd(8) > 0.55);
  }
  // 蝶: 渦に乗って舞い、1 拍ごとに翅を開閉する（蝶舞だけ）
  for (let i = 0; i < (s.butterflies ?? 0); i++) {
    if (k > 0.7) continue;
    const a = rot * 1.1 + (i * TAU) / s.butterflies + 0.5;
    const r = R * (0.62 + 0.12 * Math.sin(f * 1.6 + i * 2)) + k * 12;
    stamp(frame, Math.cos(a) * r, Math.sin(a) * r, BUTTERFLY[(f + i) % 2] ?? BUTTERFLY[0]);
  }
}

/** ダッシュ攻撃（circle size 52）: 駆け抜けながら花びらを巻き上げる、軽い 2 本腕の渦 */
const DASH = { R: 50, arms: 2, frames: 8, active: 4, turn: 1.2, flashes: [2], petals: 10, armWidth: 2.2, seed: 1901 };
/** 右: 花舞（circle size 56・2 段ヒット）: 3 本腕の渦。2 拍で明滅 */
const WHIRL = { R: 54, arms: 3, frames: 9, active: 5, turn: 1.6, flashes: [1, 3], petals: 16, seed: 2001 };
/** 派生: 蝶舞（circle size 60・3 段ヒット）: 渦に乗って 3 匹の蝶が舞う。3 拍で明滅 */
const BUTTERFLY_DANCE = { R: 58, arms: 3, frames: 10, active: 6, turn: 2, flashes: [1, 3, 5], petals: 12, butterflies: 3, armWidth: 2.2, seed: 2101 };
/** 派生: 花吹雪（circle size 64・4 段ヒット）: 4 本腕の最も大きな渦と、最も多い花びら。4 拍で明滅 */
const STORM = { R: 62, arms: 4, frames: 10, active: 6, turn: 2.2, flashes: [1, 2, 4, 5], petals: 30, armWidth: 2.8, seed: 2201 };

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 風の渦の小さな輪（螺旋 2〜3 本）と、刃の進む向き（+x）へ流れる花びら。heavy は大きな輪と多くの花びら */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const k = f / (N - 1);
  const R = heavy ? 24 : 14;
  const arms = heavy ? 3 : 2;
  const rot = f * 0.9;
  for (let i = 0; i < arms; i++) {
    spiralArm(frame, { rot: rot + (i * TAU) / arms, rIn: 2 + k * R * 0.4, rOut: R * (0.7 + 0.3 * Math.min(1, (f + 1) / 2)) + k * 4, sweep: 1.5, width: heavy ? 2.6 : 2, bright: 0.85 * (1 - 0.4 * k), erosion: Math.max(0, k - 0.2) * 1.1, seed: (heavy ? 2301 : 2401) + i });
  }
  ring(frame, { radius: (heavy ? 8 : 5) + f * (heavy ? 5 : 3), width: heavy ? 2.4 : 1.6, squash: 0.85, erosion: Math.min(0.9, k * 0.9), bright: 0.8 - k * 0.3, seed: heavy ? 2302 : 2402 });
  if (f <= 1) sparkle(frame, 0, 0, heavy ? (f === 0 ? 3 : 4) : f === 0 ? 2 : 3);
  petals(frame, f, heavy ? 14 : 6, heavy ? 2303 : 2403, (i, rnd) => {
    const forward = rnd(1) > 0.3;
    const a = forward ? (rnd(2) - 0.5) * 1.4 : rnd(2) * TAU;
    const sp = (heavy ? 3.5 : 2.5) + rnd(3) * (heavy ? 3 : 2);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), sway: 1.5, large: heavy && rnd(5) > 0.4 };
  });
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "fan",
  motions: {
    "l:0": { sheet: "fan.l1", pivot: "self", base: 24, measure: "reach" },
    "l:1": { sheet: "fan.l2", pivot: "self", base: 24, measure: "reach" },
    "l:2": { sheet: "fan.l3", pivot: "self", base: 26, measure: "reach" },
    "l:3": { sheet: "fan.l4", pivot: "self", base: 30, measure: "reach" },
    dash: { sheet: "fan.dash", pivot: "self", base: 52, measure: "size" },
    "r:fanSnap": { sheet: "fan.snap", pivot: "anchor", base: 16, measure: "reach" },
    "r:petalWhirl": { sheet: "fan.whirl", pivot: "self", base: 56, measure: "size" },
    "branch:butterflyDance": { sheet: "fan.butterfly", pivot: "self", base: 60, measure: "size" },
    "branch:downdraft": { sheet: "fan.downdraft", pivot: "self", base: 30, measure: "reach" },
    "branch:galeCut": { sheet: "fan.gale", pivot: "self", base: 40, measure: "reach" },
    "branch:petalStorm": { sheet: "fan.storm", pivot: "self", base: 64, measure: "size" },
    "branch:fanning.release": { sheet: "fan.gust", pivot: "self", base: 44, measure: "reach" },
  },
  hit: "fan.hit",
  hitHeavy: "fan.hitHeavy",
};

const arcSize = (s) => Math.ceil(s.R + (s.drift ?? 6) + 16) * 2;
const whirlSheet = (key, s) => ({ key, dirs: 1, frames: s.frames, active: s.active, size: Math.ceil(s.R + 24) * 2, draw: (frame, f) => whirl(frame, f, s) });

export const ATLAS = {
  key: "fan",
  fx: FX,
  sheets: [
    { key: "fan.l1", dirs: DIRS, frames: L1.frames, active: L1.active, size: arcSize(L1), draw: (frame, f) => fanSwing(frame, f, L1) },
    { key: "fan.l2", dirs: DIRS, frames: L2.frames, active: L2.active, size: arcSize(L2), draw: (frame, f) => fanSwing(frame, f, L2) },
    { key: "fan.l3", dirs: DIRS, frames: L3.frames, active: L3.active, size: 176, draw: fanDouble },
    { key: "fan.l4", dirs: DIRS, frames: L4.frames, active: L4.active, size: arcSize(L4), draw: (frame, f) => fanSwing(frame, f, L4) },
    { key: "fan.downdraft", dirs: DIRS, frames: 9, active: 4, size: 200, draw: downdraft },
    { key: "fan.gust", dirs: DIRS, frames: 8, active: 4, size: 240, draw: gust },
    { key: "fan.snap", dirs: DIRS, frames: 7, active: 3, size: 112, draw: fanSnap },
    { key: "fan.gale", dirs: DIRS, frames: 7, active: 3, size: 240, draw: galeCut },
    whirlSheet("fan.dash", DASH),
    whirlSheet("fan.whirl", WHIRL),
    whirlSheet("fan.butterfly", BUTTERFLY_DANCE),
    whirlSheet("fan.storm", STORM),
    { key: "fan.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => hit(frame, f, false) },
    { key: "fan.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
