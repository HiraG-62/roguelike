// 扇子（moveset "fan"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は fan.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/fan.json × 2 が目安
//
// 扇子の性格は「舞と風」。通常の振りと同じ形の言葉（扇の骨 = 放射の細い筋・外周の薄い風の帯・螺旋の風・花びら・蝶）を、
// 奥義では大きく・長く・段の多い崩れで見せる。剣で固まった決まりは守る:
// - 1 回の振り（1 拍）の帯は 1 本。多段（大旋風の 3 拍）は明滅のタイミングで分け、重なった二重の弧にしない
// - 白（段 7）は帯の外縁の細い線と光点だけ。風の面は段 5 までの薄い筋で見せる
// - 振り終わりは崩れて消える（帯は欠け、骨は根元からほどけ、花びらが散る）
// 大旋風 = 螺旋の渦（回る風）、胡蝶の舞 = 一周に開く扇（放射の骨と押し出す輪）と蝶、風纏い = 体を巻く楕円の風、で描き分ける
import { arcBounds, arcLine, crescentWidth, easeSwing, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, stamp, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG } from "../motifs.mjs";

const TAU = Math.PI * 2;

/** 角を [0, 2π) に（一周する帯は wrapAngle の (-π, π] では足りない） */
function wrapTau(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

// -----------------------------------------------------------------------------
// 共通の部品（fan.mjs の部品を写して、一周できる形に作り変えたもの）
// -----------------------------------------------------------------------------

/** 崩れの判定。ノイズと「芯からの近さ」で縁から欠ける */
function keep(x, y, erosion, core, seed) {
  if (erosion <= 0) return true;
  return valueNoise(x, y, 4, seed) * 0.7 + valueNoise(x, y, 1.6, seed + 3) * 0.2 + core * 0.3 - erosion * 1.1 > 0;
}

/**
 * 風の帯（一周まで伸ばせる）。半径 R の内側へ太さ T、先端の角 head から後ろへ len（2π まで）。
 * closed（0..1）で太さを一様に寄せ、先端と尾がつながった 1 本の輪にする。明部は外縁の 1 ドットだけ、
 * 帯の中は円周方向に引き伸ばしたノイズで風の流れの縞を作る（剣の刃の面と見分ける）
 */
function galeBand(frame, o) {
  const { R, T, head, len } = o;
  const closed = o.closed ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 1;
  const edgeReach = o.edgeReach ?? 0.55;
  const span = Math.max(1e-3, len);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < R - T - 1) return -1;
      const s = wrapTau(head - Math.atan2(y, x));
      const u = s / span;
      if (u > 1) return -1;
      const w = T * Math.max(crescentWidth(u, 0.1, 0.55) * (1 - closed), closed * 0.6);
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      const edgeU = closed > 0.5 ? 1 : edgeReach;
      if (R - r < 1.2 && u <= edgeU && erosion < 0.5) return clamp01(0.8 * bright);
      const n = valueNoise(s * R * 0.16, (R - r) * 1.1, 1.6, seed + 11);
      const along = 1 - 0.55 * u * (1 - closed);
      return clamp01(Math.pow(1 - q, 1.2) * along * (0.5 + 0.45 * n) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

/**
 * 部分の風の帯（fan.mjs の windBand と同じ形。span は π まで）。R の内側へ太さ T、tail → head
 */
function windArc(frame, o) {
  const { R, T, head, tail } = o;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R) return -1;
      const s = wrapAngle(head - Math.atan2(y, x));
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      const w = T * crescentWidth(u, 0.1, 0.55);
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      if (R - r < 1.2 && u < 0.4 && erosion < 0.5) return clamp01(0.78 * bright);
      const n = valueNoise(s * R * 0.18, (R - r) * 1.1, 1.6, seed + 11);
      return clamp01(Math.pow(1 - q, 1.2) * (1 - 0.55 * u) * (0.5 + 0.45 * n) * bright * (1 - erosion * 0.4));
    },
    { bounds: arcBounds(0, 0, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/**
 * 扇の骨: 中心 (ox, oy) から外へ伸びる細い筋。angles の各角から r0..r1、curl で先が後ろへしなる。外ほど明るく、根元は溶ける
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

/**
 * 螺旋の風の線（1 本の腕）。rot は内側の端の角、外へ行くほど sweep だけ後ろへ遅れる（時計回りの渦）。中ほどが太く明るい
 */
function spiralArm(frame, o) {
  const { rot, rIn, rOut } = o;
  const sweep = o.sweep ?? 1.2;
  const width = o.width ?? 2.4;
  const bright = o.bright ?? 0.7;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  if (rOut - rIn < 3) return;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r < rIn || r > rOut) return -1;
      const t = (r - rIn) / (rOut - rIn);
      const d = Math.abs(wrapAngle(Math.atan2(y, x) - (rot - sweep * t))) * r;
      const w = width * Math.pow(Math.sin(Math.PI * t), 0.6);
      if (w < 0.5 || d > w / 2) return -1;
      const q = d / (w / 2);
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.55 * q) * (0.45 + 0.55 * t) * (1 - erosion * 0.3));
    },
    { bounds: { x0: -rOut - 2, y0: -rOut - 2, x1: rOut + 2, y1: rOut + 2 } },
  );
}

/** 花びらの形（画面に揃えて押す）。A = 明、B = 暗。フレームごとに形を替えて、ひらひら回って見せる */
const PETAL_SMALL = [["AAB"], [".A", "AB"], ["A", "A", "B"], ["A.", "AB"]];
const PETAL_LARGE = [[".A.", "AAB", ".B."], ["AA.", ".AB"], [".A", "AA", "BB"], [".AA", "BA."]];

function petal(frame, x, y, turn, level, large) {
  const set = large ? PETAL_LARGE : PETAL_SMALL;
  const shape = set[((turn % set.length) + set.length) % set.length] ?? set[0];
  const a = String(Math.min(6, level));
  const b = String(Math.max(3, Math.min(6, level) - 1));
  stamp(frame, x, y, shape.map((row) => row.replaceAll("A", a).replaceAll("B", b)));
}

/**
 * 舞う花びら。spawn(i, rnd) → {x, y, vx, vy, life, sway, large, delay}。減速しながら流れ、進む向きに直交して揺れる
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
    const level = Math.max(3, Math.round(3 + 3 * fade * (s.bright ?? 1)));
    petal(frame, x, y, t + i, level, s.large && fade > 0.35);
  }
}

/** 蝶の形（翅を開く / 半開き / 閉じる）。画面に揃えて押す。白は胴の 1 ドットだけ */
const BUTTERFLY = [
  ["66.66", "56765", ".5.5."],
  [".6.6.", "56765", "..5.."],
  ["..6..", "..7..", "..5.."],
];
/** 中くらいの蝶（胡蝶の舞の群れ。翅を開く / 閉じる） */
const BUTTERFLY_MID = [
  ["6...6", "56.65", "55755", ".4.4.", "4...4"],
  [".6.6.", ".565.", "..7..", ".4.4.", "....."],
];
/** 大きな蝶（胡蝶の舞の主役。翅の縁が明るく、内側は暗い） */
const BUTTERFLY_BIG = [
  ["55...55", "665.566", "5647465", ".44744.", ".5.5.5.", "5.....5"],
  ["...5...", ".56.65.", ".64746.", "..474..", ".5.5.5.", "......."],
];

// -----------------------------------------------------------------------------
// 大旋風（nova 半径 60・3 段ヒット・敵弾を消す）: 6 本腕の大きな螺旋の渦が 3 拍で明滅し、
// 外周の風の壁が回りながら押し広がって崩れる。花びらが渦に乗って巻き、最後に外へ吹き飛ぶ
// -----------------------------------------------------------------------------

/** 渦の外縁の半径（60 論理 px × 2） */
const GALE_R = 120;
const GALE_N = 12;
const GALE_A = 6;
/** 3 段ヒットの拍（明滅するフレーム） */
const GALE_BEATS = [1, 3, 5];
const GALE_ARMS = 6;
/** 外周の風の壁の数（渦の腕とは別に、外縁を追いかける帯） */
const GALE_WALLS = 3;

function greatGale(frame, f) {
  const A = GALE_A;
  const k = f < A ? 0 : (f - A + 1) / (GALE_N - A + 1);
  // 出だしの 3 枚は渦が内から外へ広がる（出だしから満開だと唐突に見える）
  const R = GALE_R * Math.min(1, 0.55 + 0.15 * (f + 1));
  const p = f < A ? (f + 1) / A : 1;
  const rot = f < A ? p * 2.4 * Math.PI : 2.4 * Math.PI + Math.sin(k * Math.PI * 0.5) * 0.9;
  const beat = GALE_BEATS.includes(f) ? 1.15 : 1;
  for (let i = 0; i < GALE_ARMS; i++) {
    const a = rot + (i * TAU) / GALE_ARMS;
    spiralArm(frame, { rot: a, rIn: R * 0.16 + k * R * 0.35, rOut: R * 0.9 + k * 10, sweep: 1.6, width: i % 2 === 0 ? 7 : 5, bright: 0.86 * beat * (1 - 0.35 * k), erosion: k * 0.9, seed: 3101 + i });
  }
  // 外周の風の壁: 3 本の帯が外縁を回る。振り終わりは外へ押し広がって崩れる（敵弾を払う押し出し）
  const push = k * 26;
  for (let i = 0; i < GALE_WALLS; i++) {
    const head = rot * 1.1 + (i * TAU) / GALE_WALLS + 0.6;
    windArc(frame, { R: R + 4 + push, T: (10 + (f < A ? 2 * p : 0)) * (1 - 0.5 * k), head, tail: head - 1.7 * (1 - 0.3 * k), erosion: k * 0.95, bright: beat * (1 - 0.3 * k), seed: 3111 + i });
  }
  // 帯の外に沿う細い風の筋（外にだけ。内側に引くと二重の弧に見える）
  if (k < 0.6) {
    for (let i = 0; i < GALE_WALLS; i++) {
      const head = rot * 1.1 + (i * TAU) / GALE_WALLS + 0.6;
      arcLine(frame, { radius: R + 8 + push, from: head - 0.9, to: head - 0.08, bright: 0.5 * (1 - k) });
    }
  }
  // 拍の光点: 腕の中ほど
  if (GALE_BEATS.includes(f)) {
    for (let i = 0; i < GALE_ARMS; i += 2) {
      const a = rot + (i * TAU) / GALE_ARMS - 1.6 * 0.6;
      sparkle(frame, Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, f === GALE_BEATS[2] ? 3 : 2);
    }
  }
  // 周回する花びら: active の間は渦に乗って回り、振り終わりは接線と外へ吹き飛ぶ
  for (let i = 0; i < 44; i++) {
    const rnd = (q) => hash1(i * 19 + q, 3130);
    const r0 = R * (0.3 + 0.68 * rnd(1));
    const base = rnd(3) * TAU;
    const a = base + rot * (0.8 + 0.5 * rnd(2)) * (1.2 - (r0 / R) * 0.4);
    let x = Math.cos(a) * r0;
    let y = Math.sin(a) * r0;
    if (k > 0) {
      const t = f - A + 1;
      const sp = 5 + 5 * rnd(6);
      x += (-Math.sin(a) * 0.6 + Math.cos(a) * 0.8) * sp * t;
      y += (Math.cos(a) * 0.6 + Math.sin(a) * 0.8) * sp * t;
      if (rnd(7) < k * 0.95) continue;
    }
    petal(frame, x, y, f + i, Math.round(6 - 2 * k), rnd(8) > 0.35);
  }
  // 吹き飛ぶ風の粒（最後の崩れ）
  if (k > 0) {
    for (let i = 0; i < 30; i++) {
      const a = hash1(i, 3140) * TAU;
      const r = R * (0.8 + 0.3 * hash1(i, 3141)) + push * (1 + hash1(i, 3142));
      if (hash1(i, 3143) < k * 0.6) continue;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, Math.max(2, Math.round(5 - 3 * k)));
    }
  }
}

/** 大旋風の地面の紋: 外縁の輪と、渦と逆に回る 16 本の扇の骨（短い放射）。広がって、薄れて消える */
function greatGaleGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < GALE_A ? 0 : (f - GALE_A + 1) / (GALE_N - GALE_A + 1);
  const dim = 0.4 * (1 - k * 0.5);
  ring(frame, { radius: (GALE_R - 2) * (0.6 + 0.4 * grow), width: 2, erosion: k * 0.9, bright: dim, seed: 3151 });
  ring(frame, { radius: GALE_R * 0.42 * grow, width: 1.4, erosion: Math.min(0.95, k * 0.9 + 0.1), bright: dim * 0.8, seed: 3152 });
  // 骨は輪が広がりきってから（途中に出すと中心から放射する星に見える）
  if (grow < 1 || k >= 0.85) return;
  const turn = -f * 0.05;
  const angles = [];
  for (let i = 0; i < 16; i++) angles.push((i / 16) * TAU + turn);
  ribs(frame, { angles, r0: GALE_R * 0.48, r1: GALE_R * 0.9, curl: 0.18, width: 1.3, bright: dim * 1.1 * (1 - k), erosion: k * 0.8, seed: 3153 });
}

/** 大旋風の発動: 4 本の螺旋の風が外から巻き込んで締まり、満ちた瞬間に一周の扇（12 本の骨）がぱっと開いて散る */
function greatGaleCast(frame, f) {
  const gather = 4;
  if (f < gather) {
    const p = (f + 1) / gather;
    const rOut = 64 - 34 * p;
    for (let i = 0; i < 4; i++) {
      spiralArm(frame, { rot: p * 2.2 + (i * TAU) / 4, rIn: rOut * 0.3, rOut, sweep: -1.4, width: 2.6, bright: 0.5 + 0.35 * p, seed: 3161 + i });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / 4;
  const angles = [];
  for (let i = 0; i < 12; i++) angles.push((i / 12) * TAU - Math.PI / 2);
  const rOut = 20 + 26 * Math.min(1, k * 1.6);
  ribs(frame, { angles, r0: 8 + rOut * 0.6 * k, r1: rOut, curl: 0.12, width: 1.4, bright: 0.78 * (1 - 0.3 * k), erosion: Math.max(0, k - 0.3) * 1.1, seed: 3165 });
  galeBand(frame, { R: rOut + 2, T: 5 * (1 - 0.5 * k), head: -Math.PI / 2, len: TAU, closed: 1, erosion: Math.max(0, k - 0.2) * 1.1, bright: 1 - 0.3 * k, seed: 3166 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  petals(frame, f - gather, 12, 3167, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: Math.cos(a) * 16, y: Math.sin(a) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, sway: 1.5, large: rnd(3) > 0.6 };
  });
}

// -----------------------------------------------------------------------------
// 胡蝶の舞: 発動で大きな蝶の翅（扇の骨でできた 4 枚の翅）が開いて羽ばたき、
// 行為 0（buff 無敵と加速）で蝶の群れが体の周りを舞い、行為 1（nova 半径 40）で一周に開く扇が押し返す
// -----------------------------------------------------------------------------

/** 翅の定義（画面に揃えた右の翅。左は x を鏡に写す）。角は画面の上が負 */
const WINGS = [
  { from: -80 * DEG, to: -8 * DEG, R: 50, ribs: 6 },
  { from: 12 * DEG, to: 62 * DEG, R: 34, ribs: 4 },
];

/** 翅 1 枚: 扇の骨と外縁の帯。open（0..1）で骨の開き、side = 1（右）/ -1（左） */
function wing(frame, w, side, open, o) {
  const mid = (w.from + w.to) / 2;
  const half = ((w.to - w.from) / 2) * open;
  const angles = [];
  for (let i = 0; i < w.ribs; i++) {
    const a = mid - half + (2 * half * (i + 0.5)) / w.ribs;
    angles.push(side > 0 ? a : Math.PI - a);
  }
  const R = w.R * o.scale;
  ribs(frame, { angles, r0: 6 + (R - 6) * o.retract, r1: R - 3, curl: 0, width: 1.3, bright: 0.66 * o.bright, erosion: o.erosion, seed: o.seed });
  // 翅の縁の帯: 右の翅は時計回り（tail = 上端側）、左は鏡に写した角
  const head = side > 0 ? mid + half : Math.PI - (mid - half);
  const tail = side > 0 ? mid - half : Math.PI - (mid + half);
  windArc(frame, { R, T: 6 * o.bright, head, tail, erosion: o.erosion, bright: o.bright, seed: o.seed + 5 });
}

/** 胡蝶の舞の発動: 4 枚の翅が開き（0〜2）、一度羽ばたいて（3〜4）、骨がほどけて蝶と花びらになって散る */
function butterflyCast(frame, f) {
  const N = 9;
  const open = Math.min(1, easeSwing((f + 1) / 3));
  // 羽ばたき: 3 枚目で翅が縮み、4 枚目で広がる
  const flap = f === 3 ? 0.78 : f === 4 ? 1.08 : 1;
  const k = f < 5 ? 0 : (f - 4) / (N - 4);
  WINGS.forEach((w, i) => {
    for (const side of [1, -1]) {
      wing(frame, w, side, open * (f === 3 ? 0.8 : 1), { scale: flap * (1 + k * 0.2), retract: k * 0.85, bright: 1 - 0.3 * k, erosion: k * 0.9, seed: 3201 + i * 10 + (side > 0 ? 0 : 5) });
    }
  });
  if (f === 2) sparkle(frame, 0, -4, 3);
  if (f === 4) {
    sparkle(frame, 40, -32, 2);
    sparkle(frame, -40, -32, 2);
  }
  // 翅の骨がほどけて小さな蝶になって飛び立つ
  if (f >= 5) {
    const t = f - 4;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const a = -Math.PI / 2 + side * (0.5 + 0.35 * hash1(i, 3210));
      const x = side * 30 + Math.cos(a) * t * 5;
      const y = -18 + Math.sin(a) * t * 5 + Math.sin(t + i) * 2;
      if (hash1(i, 3211) < k * 0.7) continue;
      stamp(frame, x, y, BUTTERFLY[(f + i) % 2] ?? BUTTERFLY[0]);
    }
  }
  petals(frame, f - 4, 14, 3212, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const a = -Math.PI / 2 + side * (0.3 + rnd(2) * 1.6);
    const r = 20 + rnd(3) * 24;
    const sp = 2 + rnd(4) * 2.5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 3 + Math.floor(rnd(5) * 2), sway: 1.8, large: rnd(6) > 0.55 };
  });
}

/** 胡蝶の舞 行為 0（buff）のフレーム数。約 1 秒で流す（無敵の間に蝶が体を離れていく） */
const SWARM_N = 12;
/** 群れの蝶の数と、周回の半径 */
const SWARM_COUNT = 8;
const SWARM_R = 36;

/**
 * 胡蝶の舞 行為 0（buff: 無敵と加速）: 大きな蝶 1 匹と小さな蝶の群れが体の周りを回りながら舞い、
 * 後半は上へ流れて離れていく。蝶の軌跡に細い光の粒を残す（残像の弧は引かない）
 */
function butterflySwarm(frame, f) {
  const k = f / (SWARM_N - 1);
  const leave = Math.max(0, (f - 6) / (SWARM_N - 7));
  // 足元の薄い楕円: 無敵の間の舞台（最初だけ強く、すぐ薄れる）
  if (f < 7) ring(frame, { oy: 18, radius: 14 + f * 2.4, width: 1.6, squash: 2.2, erosion: Math.min(0.9, f * 0.13), bright: 0.5 - f * 0.05, seed: 3301 });
  for (let i = 0; i < SWARM_COUNT; i++) {
    const rnd = (q) => hash1(i * 7 + q, 3302);
    const a0 = (i / SWARM_COUNT) * TAU + rnd(1) * 0.4;
    const speed = 0.42 + 0.18 * rnd(2);
    const r = SWARM_R * (0.8 + 0.45 * rnd(3)) + leave * 20;
    const bob = Math.sin(f * 1.4 + i * 2) * 3;
    const trail = (t) => {
      const a = a0 + t * speed;
      // 楕円（画面で横長）の周回。後半は上へ流れる
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.55 - 4 + bob - leave * leave * 40 };
    };
    if (rnd(4) < leave * 0.8) continue;
    const pos = trail(f);
    // 軌跡: 蝶が通った楕円に沿う短い風の筋（1 匹 1 本。後半は上へ流れるので粒だけにする）
    if (leave < 0.3) {
      const head = Math.atan2((pos.y + 4 - bob) / 0.55, pos.x);
      veilStreak(frame, { cy: -4 + bob, rx: r, ry: r * 0.55, head: head - 0.12, len: 0.9, width: 1.6, bright: 0.6 * (1 - leave * 2), seed: 3310 + i });
    }
    for (let j = 1; j <= 3; j++) {
      const q = trail(f - j * 0.6);
      dot(frame, q.x, q.y + (hash1(i * 5 + j, 3311) - 0.5) * 3, Math.max(2, 5 - j));
    }
    stamp(frame, pos.x, pos.y, (rnd(5) > 0.5 ? BUTTERFLY_MID : BUTTERFLY)[(f + i) % 2] ?? BUTTERFLY[0]);
  }
  // 主役の大きな蝶: 頭の上で羽ばたき、最後に高く舞い上がる
  if (k < 0.9) {
    const y = -34 - leave * 30 + Math.sin(f * 0.9) * 2;
    stamp(frame, Math.sin(f * 0.7) * 6, y, BUTTERFLY_BIG[f % 2] ?? BUTTERFLY_BIG[0]);
  }
  if (f === 1) sparkle(frame, 0, -34, 3);
  if (f === 5) sparkle(frame, -24, -8, 2);
  if (f === 8) sparkle(frame, 22, -20, 2);
}

/** 胡蝶の舞 行為 1（nova 半径 40）の外縁の半径（40 × 2） */
const FAN_R = 80;
const FAN_N = 10;
const FAN_A = 4;
/** 一周に開く扇の骨の数 */
const FAN_RIBS = 18;
/** 開き始めの角（真上から時計回りに開く） */
const FAN_FROM = -Math.PI / 2;

/**
 * 胡蝶の舞 行為 1: 自分を要に、扇が一周に開く（帯の先端が時計回りに走り、通り過ぎた所に骨が立つ）。
 * 閉じた瞬間に帯が 1 本の輪になり、外へ押し出されて崩れる（押し返し）。骨は根元からほどけ、花びらが外へ吹かれる
 */
function butterflyNova(frame, f) {
  const A = FAN_A;
  const k = f < A ? 0 : (f - A + 1) / (FAN_N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = FAN_FROM + TAU * p;
  const push = k * 22;
  // 骨: 開いた範囲にだけ立つ。振り終わりは根元から外へ引き、押し出す輪を追う
  const angles = [];
  const brights = [];
  for (let i = 0; i < FAN_RIBS; i++) {
    const a = FAN_FROM + (TAU * (i + 0.5)) / FAN_RIBS;
    if (f < A && a > head - 0.05) continue;
    angles.push(a);
    brights.push(f < A ? 0.7 + 0.3 * clamp01(1 - (head - a) / TAU) : 1);
  }
  const rIn = FAN_R * 0.24;
  const rOut = FAN_R - 5 + push * 0.6;
  ribs(frame, { angles, brights, r0: rIn + (rOut - rIn) * Math.pow(k, 0.7) * 0.85, r1: rOut, curl: -0.14, width: 1.4, bright: 0.66 * (1 - k * 0.4), erosion: k * 0.85, seed: 3401 });
  if (f < A) {
    galeBand(frame, { R: FAN_R, T: 9 * (0.7 + 0.3 * p), head, len: TAU * Math.min(0.94, p * 0.97), seed: 3402 });
    if (f >= 1) sparkle(frame, Math.cos(head) * (FAN_R - 3), Math.sin(head) * (FAN_R - 3), f === A - 1 ? 3 : 2);
    arcLine(frame, { radius: FAN_R + 3, from: head - Math.min(1.4, TAU * p * 0.4), to: head - 0.06, bright: 0.5 });
  } else {
    galeBand(frame, { R: FAN_R + push, T: 10 * (f === A ? 1 : 0.9 - 0.5 * k), head: FAN_FROM + TAU, len: TAU, closed: 1, erosion: f === A ? 0 : 0.05 + 0.85 * Math.pow(k, 1.1), bright: f === A ? 1.1 : 1 - 0.3 * k, seed: 3402 });
  }
  if (f === A) {
    for (let i = 0; i < 4; i++) {
      const a = FAN_FROM + (i / 4) * TAU + Math.PI / 4;
      sparkle(frame, Math.cos(a) * (FAN_R - 3), Math.sin(a) * (FAN_R - 3), 3);
    }
  }
  // 花びら: 扇の外周から外へ（押し返す風に乗る）
  petals(frame, f - (A - 1), 26, 3403, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r = FAN_R * (0.5 + 0.45 * rnd(2));
    const sp = 3 + rnd(3) * 3.5;
    const out = 0.6 + 0.35 * rnd(4);
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
      vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
      life: 3 + Math.floor(rnd(5) * 3),
      delay: Math.floor(rnd(6) * 2),
      sway: 1.8,
      large: rnd(7) > 0.55,
    };
  });
}

// -----------------------------------------------------------------------------
// 風纏い（持続）: 体を横に巻く楕円の風（地面に置いた輪を立体に見せる）が上下に重なって回り、
// 花びらが輪に乗って周回する。dirs 1（画面に揃える）
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 纏いの 1 巡のフレーム数 */
const VEIL_N = 12;

/**
 * 楕円の風の筋（体を横に巻く輪の一部）。中心 (0, cy)、横半径 rx・縦半径 ry、角 head から後ろへ len、太さ width。
 * 手前の半周（下側、sin > 0）は明るく太く、奥の半周は暗く細い（体の裏へ回る）
 */
function veilStreak(frame, o) {
  const { cy, rx, ry, head, len } = o;
  const width = o.width ?? 2.4;
  const bright = o.bright ?? 0.8;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  paint(
    frame,
    (x, y) => {
      const ex = x / rx;
      const ey = (y - cy) / ry;
      const r = Math.hypot(ex, ey);
      const t = Math.atan2(ey, ex);
      const scale = Math.hypot(rx * Math.cos(t), ry * Math.sin(t));
      const d = Math.abs(r - 1) * scale;
      const s = wrapTau(head - t);
      const u = s / len;
      if (u > 1) return -1;
      const front = 0.5 + 0.5 * Math.sin(t);
      const w = width * (0.55 + 0.45 * front) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.04)), 0.6);
      if (w < 0.5 || d > w / 2) return -1;
      const q = d / (w / 2);
      if (!keep(x, y, erosion, 1 - q, seed)) return -1;
      // 先端近くの手前だけ細く明るい芯（段 6 まで）
      const tip = 1 - u;
      return clamp01(bright * (1 - 0.5 * q) * (0.35 + 0.65 * tip) * (0.55 + 0.45 * front));
    },
    { bounds: { x0: -rx - 3, y0: cy - ry - 3, x1: rx + 3, y1: cy + ry + 3 } },
  );
}

/** 纏いの風の輪（高さ・大きさ・回る速さ・位相）。速さは 1 巡で整数周（継ぎ目が出ない） */
const VEIL_RINGS = [
  { cy: FEET_Y + 2, rx: 34, ry: 9, turns: 1, phase: 0.0, len: 3.2 },
  { cy: -3, rx: 30, ry: 8, turns: 1, phase: 0.5, len: 2.8 },
  { cy: -20, rx: 24, ry: 6, turns: 2, phase: 0.2, len: 2.4 },
];

/** 風纏いの纏い（持続中ずっと）: 3 段の楕円の風が回り、花びらが輪に乗って巡る */
function windVeilSustain(frame, f) {
  const cycle = f / VEIL_N;
  VEIL_RINGS.forEach((vr, i) => {
    const head = (cycle * vr.turns + vr.phase) * TAU;
    veilStreak(frame, { cy: vr.cy, rx: vr.rx, ry: vr.ry, head, len: vr.len, width: i === 0 ? 4.4 : 3.6, bright: 0.9, seed: 3501 + i });
  });
  // 輪に乗って巡る花びら（手前は明るく、奥は暗い）。1 巡で整数周
  for (let i = 0; i < 9; i++) {
    const vr = VEIL_RINGS[i % VEIL_RINGS.length] ?? VEIL_RINGS[0];
    const t = (cycle * vr.turns + hash1(i, 3510)) * TAU;
    const x = Math.cos(t) * (vr.rx + 3);
    const y = vr.cy + Math.sin(t) * (vr.ry + 2);
    const front = Math.sin(t) > 0;
    // 奥を通る花びらは体に隠れる（中央の奥は描かない）
    if (!front && Math.abs(x) < 10) continue;
    petal(frame, x, y, f + i, front ? 6 : 4, front && hash1(i, 3511) > 0.5);
  }
  // 立ちのぼる風の粒
  for (let i = 0; i < 6; i++) {
    const t = (cycle + hash1(i, 3520)) % 1;
    const x = (hash1(i, 3521) - 0.5) * 70;
    const y = FEET_Y - t * 56;
    if (Math.abs(x) < 10 && y > -24) continue;
    dot(frame, x, y, Math.max(2, Math.round(2 + 3 * Math.sin(Math.PI * t))));
  }
  if (f === 3) sparkle(frame, 30, FEET_Y, 2);
  if (f === 9) sparkle(frame, -26, 2, 2);
}

/** 纏いの足元（地面）: 薄い楕円と、ゆっくり回る 6 本の扇の骨の刻み（6 回対称なので 1 巡で 1/6 回せば継ぎ目が出ない） */
function windVeilGround(frame, f) {
  const cycle = f / VEIL_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 17 + pulse, width: 1.6, squash: 2.4, bright: 0.32 + 0.12 * pulse, seed: 3531 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6 + cycle / 6) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    streakLine(frame, { ax: c * 30, ay: FEET_Y + s * 12, bx: c * 42, by: FEET_Y + s * 17, width: 1.3, bright: 0.28 + 0.12 * pulse });
  }
}

/** 風纏いの発動: 足元から 3 つの楕円の風が時間差で巻き上がって体を包み、頭の上で締まって光る。花びらが螺旋に昇る */
function windVeilCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  ring(frame, { oy: FEET_Y, radius: 10 + f * 3, width: 2.2 - k, squash: 2.2, erosion: Math.min(0.92, k * 0.95), bright: 0.8 - k * 0.3, seed: 3601 });
  for (let i = 0; i < 3; i++) {
    const age = f - i * 1.2;
    if (age < 0) continue;
    const rise = Math.min(1, age / 5);
    const fade = Math.max(0, (age - 4) / 4);
    if (fade >= 1) continue;
    // 下から上へ昇りながら細る楕円（外から巻き込む）
    const cy = FEET_Y + 4 - rise * 50;
    const rx = 46 - rise * 20;
    const head = age * 1.5 + i * 2;
    veilStreak(frame, { cy, rx, ry: rx * 0.3, head, len: 3.4 - fade * 1.4, width: 3.4 - rise, bright: 1 - fade * 0.4, erosion: fade * 0.9, seed: 3602 + i });
  }
  if (f === 5) sparkle(frame, 0, -34, 3);
  if (f === 6) sparkle(frame, 0, -38, 2);
  // 螺旋に昇る花びら
  for (let i = 0; i < 12; i++) {
    const t = f - hash1(i, 3610) * 3;
    if (t < 0 || t > 6) continue;
    const a = hash1(i, 3611) * TAU + t * 0.9;
    const r = 34 - t * 3;
    petal(frame, Math.cos(a) * r, FEET_Y - t * 9 + Math.sin(a) * r * 0.3, f + i, Math.round(6 - t * 0.4), hash1(i, 3612) > 0.6);
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 大旋風・胡蝶の舞の行為 1 の base は周囲攻撃の半径。胡蝶の舞の行為 0（buff）は自分の位置に蝶の群れを出す（拡縮しない）
 */
const FX = {
  moveset: "fan",
  ultimates: {
    "fan.greatGale": {
      ramp: "light",
      cast: { sheet: "fanUlt.greatGaleCast", life: 0.35 },
      acts: [{ sheet: "fanUlt.greatGale", life: 0.7, base: GALE_R / 2, pivot: "pos", ground: "fanUlt.greatGaleGround" }],
    },
    "fan.butterflyStep": {
      ramp: "light",
      cast: { sheet: "fanUlt.butterflyStepCast", life: 0.4 },
      acts: [
        { sheet: "fanUlt.butterflySwarm", life: 1.1, base: 0, pivot: "pos" },
        { sheet: "fanUlt.butterflyStep", life: 0.5, base: FAN_R / 2, pivot: "pos" },
      ],
    },
    "fan.windVeil": {
      ramp: "light",
      cast: { sheet: "fanUlt.windVeilCast", life: 0.55 },
      sustain: { sheet: "fanUlt.windVeil", period: 0.9, ground: "fanUlt.windVeilGround" },
    },
  },
};

export const ATLAS = {
  key: "fanUlt",
  fx: FX,
  sheets: [
    { key: "fanUlt.greatGale", dirs: 1, frames: GALE_N, active: GALE_A, size: 2 * (GALE_R + 48), draw: greatGale },
    { key: "fanUlt.greatGaleGround", dirs: 1, frames: GALE_N, active: GALE_A, size: 2 * (GALE_R + 8), draw: greatGaleGround },
    { key: "fanUlt.greatGaleCast", dirs: 1, frames: 8, active: 0, size: 150, draw: greatGaleCast },
    { key: "fanUlt.butterflyStepCast", dirs: 1, frames: 9, active: 0, size: 160, draw: butterflyCast },
    { key: "fanUlt.butterflySwarm", dirs: 1, frames: SWARM_N, active: 0, size: 160, draw: butterflySwarm },
    { key: "fanUlt.butterflyStep", dirs: 1, frames: FAN_N, active: FAN_A, size: 2 * (FAN_R + 40), draw: butterflyNova },
    { key: "fanUlt.windVeilCast", dirs: 1, frames: 10, active: 0, size: 180, draw: windVeilCast },
    { key: "fanUlt.windVeil", dirs: 1, frames: VEIL_N, active: 0, size: 120, draw: windVeilSustain },
    { key: "fanUlt.windVeilGround", dirs: 1, frames: VEIL_N, active: 0, size: 100, draw: windVeilGround },
  ],
};
