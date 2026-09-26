// 鎖鎌（moveset "chainSickle"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/chainSickle.json × 2 が目安
//
// 近接の絵（chainSickle.mjs）の言葉をそのまま大きくする: 「1 輪おきに明暗の鎖の点列」「先端の鉤に折れる鎌」「丸い分銅と打撃の星」。
// - 蜘蛛の巣: 8 本の鎖が放射に張られ、地面に網の糸が掛かり、手元へ手繰られる → 鎖の輪が一周して外へ弾ける
// - 縛り首: 1 本の長い鎖が伸びて戻り、掴んだ敵の首に鎖の輪が締まる → 太い鎌の三日月で断つ
// - 分銅回し: 手元から分銅が鎖で回り続ける（持続）
// 剣で固まった決まりは守る（1 振りの斬撃は 1 本・白は縁と光点だけ・崩れて消える）。鎖の部品は chainSickle.mjs から写した
import { arcLine, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（chainSickle.mjs と同じ形の言葉）
// -----------------------------------------------------------------------------

/** 鎖の輪の間隔。奥義は輪を少し大きくするので間隔も広げる（詰めると太い線に見える） */
const LINK_STEP = 4.8;

function pathTable(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    acc.push((acc[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return acc;
}

function pathAt(pts, acc, s) {
  let i = 1;
  while (i < pts.length - 1 && (acc[i] ?? 0) < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const s0 = acc[i - 1] ?? 0;
  const len = Math.max(1e-6, (acc[i] ?? 0) - s0);
  const t = clamp01((s - s0) / len);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len };
}

/**
 * 鎖: 点列（先頭 = 鎖の先）に沿って輪を置く。偶数は正面の中抜きの楕円、奇数は横向きの棒（1 輪おきの明暗で鎖と読ませる）。
 * scale で輪を大きく（奥義は 1.2 倍）。erosion で輪が 1 つずつ抜け落ちる
 */
function chain(frame, pts, o = {}) {
  const acc = pathTable(pts);
  const total = acc[acc.length - 1] ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const scale = o.scale ?? 1.2;
  const step = LINK_STEP * (scale / 1.2);
  const shade = o.shade ?? ((u) => 1 - 0.45 * u);
  for (let i = 0; ; i++) {
    const s = i * step;
    if (s > total) break;
    if (erosion > 0 && hash1(i, seed) < erosion * (0.6 + 0.6 * (s / Math.max(1, total)))) continue;
    const p = pathAt(pts, acc, s);
    link(frame, p, i % 2 === 0, bright * shade(s / Math.max(1, total)), scale);
  }
}

function link(frame, p, face, v, scale) {
  const { x, y, tx, ty } = p;
  const a = (face ? 2.7 : 2.3) * scale;
  const b = (face ? 1.9 : 0.7) * scale;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = dx * tx + dy * ty;
      const w = -dx * ty + dy * tx;
      const d = Math.hypot(u / a, w / b);
      if (d > 1) return -1;
      if (face) {
        if (d < 0.42) return -1;
        return clamp01(v * (0.78 + 0.22 * (w > 0 ? 1 : 0)));
      }
      return clamp01(v * 0.42);
    },
    { bounds: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }, dither: 0 },
  );
}

/** 2 点の鎖（先 → 根元） */
function seg(ax, ay, bx, by) {
  return [
    [ax, ay],
    [bx, by],
  ];
}

/** 極座標の点 */
function polar(r, a, cx = 0, cy = 0) {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/** 円周の鎖の点列（先の角 head から、時計回りの逆へ span だけ戻る） */
function circlePath(R, head, span, cx = 0, cy = 0) {
  const n = Math.max(2, Math.ceil((R * span) / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(polar(R, head - (span * i) / n, cx, cy));
  return pts;
}

/** 分銅: 縁の暗い丸い塊に、前寄りの光点 */
function weight(frame, x, y, r, bright = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      if (d > 0.78) return 0.28 * bright;
      const hl = Math.hypot(px - (x + r * 0.3), py - (y - r * 0.3)) / r;
      return clamp01((0.55 + 0.45 * (1 - hl * 1.4)) * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 打撃の星: 長短の棘が中心から外へ弾ける。age で棘が外へ抜けて中が空く */
function impactStar(frame, x, y, size, age, o = {}) {
  const spikes = o.spikes ?? 8;
  const rot = o.rot ?? 0;
  const seed = o.seed ?? 1;
  const k = Math.min(1, age * (o.fade ?? 0.22));
  for (let i = 0; i < spikes; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.45) / spikes) * TAU;
    const long = i % 2 === 0;
    const r1 = (long ? size : size * 0.55) * (0.8 + 0.4 * hash1(i, seed + 1)) * (1 + age * 0.18);
    const r0 = age === 0 ? 1 : Math.min(r1 - 1, size * 0.25 + age * size * 0.2);
    if (r1 - r0 < 1.5) continue;
    streakLine(frame, { ax: x + Math.cos(a) * r1, ay: y + Math.sin(a) * r1, bx: x + Math.cos(a) * r0, by: y + Math.sin(a) * r0, width: long ? 2 : 1.3, bright: (long ? 1 : 0.8) * (1 - k * 0.7) });
  }
}

/** 鎌の鉤: (x, y) の先端から、進む向き dir と内向き inward の間へ折れる短い爪 */
function hook(frame, x, y, dir, inward, len, T, bright = 1, erosion = 0, seed = 1) {
  const a = dir * 0.35 + inward * 0.65;
  lens(frame, { ax: x, ay: y, bx: x + Math.cos(a) * len, by: y + Math.sin(a) * len, T, bend: -T * 0.8, bias: 0.4, erosion, seed, bright });
}

/** 外 → 内へ流れる速度線（内の端が明るい = 手元へ引き込む） */
function inwardStreak(frame, a, r1, r0, bright) {
  if (r1 - r0 < 3) return;
  streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, bright });
}

// -----------------------------------------------------------------------------
// 蜘蛛の巣（行為 0: pull 半径 70 / 行為 1: nova 半径 40）
// 8 本の鎖が放射に張られ、先の鉤が掛かり、地面に網の糸が張る → 鎖が手元へ手繰られる → 鎖の輪が一周して外へ弾ける
// -----------------------------------------------------------------------------

/** 引き寄せの半径（70 論理 px × 2） */
const WEB_R = 140;
/** 手繰り終わりの距離（toDistance 30 × 2） */
const WEB_TO = 60;
const WEB_N = 11;
const WEB_A = 4;
/** 放射の鎖の本数（網の糸の角の数） */
const WEB_SPOKES = 8;

/** 放射の鎖 i の角。等間隔から少し崩す（正多角形の歯車に見せない） */
function spokeAngle(i) {
  return (i / WEB_SPOKES) * TAU - Math.PI / 2 + (hash1(i, 3001) - 0.5) * 0.22;
}

/** 放射の鎖 i の先の半径（f のとき）。伸び → 掛かる → 手繰る */
function spokeReach(i, f) {
  const lenMul = 0.9 + 0.1 * hash1(i, 3002);
  if (f < WEB_A) {
    // 1 本ずつわずかに遅れて伸びる
    const p = easeSwing(clamp01((f + 1 - (i % 3) * 0.25) / WEB_A));
    return 10 + (WEB_R * lenMul - 10) * p;
  }
  const k = (f - WEB_A + 1) / (WEB_N - WEB_A);
  return WEB_TO + (WEB_R * lenMul - WEB_TO) * (1 - Math.pow(Math.min(1, k * 1.6), 0.8));
}

function spiderWeb(frame, f) {
  const A = WEB_A;
  const k = f < A ? 0 : (f - A + 1) / (WEB_N - A);
  for (let i = 0; i < WEB_SPOKES; i++) {
    const a = spokeAngle(i);
    const r = spokeReach(i, f);
    const [tx, ty] = polar(r, a);
    const [bx, by] = polar(10, a);
    chain(frame, seg(tx, ty, bx, by), { bright: 1 - k * 0.3, erosion: Math.max(0, k - 0.45) * 1.6, seed: 3010 + i, shade: (u) => 1 - 0.5 * u });
    // 先の鎌: 内へ折れる鉤（掛かった手応え）。手繰りの後半で崩れて消える
    if (k < 0.7) hook(frame, tx, ty, a + Math.PI / 2, a + Math.PI, 11 * (1 - k * 0.5), 4, 1 - k * 0.3, k * 0.9, 3020 + i);
    // 掛かった瞬間の光点（1 本おき）
    if (f === A - 1 && i % 2 === 0) sparkle(frame, tx, ty, 3);
    if (f === A && i % 2 === 1) sparkle(frame, tx, ty, 2);
    // 手繰る間の内向きの速度線: 鎖の両脇を外 → 内へ
    if (f >= A && k < 0.75) {
      for (const side of [-1, 1]) {
        const off = side * 0.09;
        const r1 = r + 18 - hash1(i * 2 + side, 3030) * 8;
        inwardStreak(frame, a + off, r1, r1 - 16 - hash1(i, 3031) * 10, 0.5 * (1 - k));
      }
    }
  }
  // 手繰り終わり: 鎖の先から刃片が内へ零れる
  if (f >= A + 1) {
    shards(frame, f - A - 1, 24, 3040, (i, rnd) => {
      const s = Math.floor(rnd(1) * WEB_SPOKES);
      const a = spokeAngle(s) + (rnd(2) - 0.5) * 0.3;
      const r = WEB_TO + 10 + rnd(3) * 40;
      const sp = 2 + rnd(4) * 3;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 蜘蛛の巣の地面: 放射の鎖の間に掛かる網の糸（3 重の多角形。辺は内へたわむ）。
 * 鎖が伸びきると外の糸から張られ、手繰る間は鎖と一緒に縮んで千切れる
 */
function spiderWebGround(frame, f) {
  const A = WEB_A;
  const k = f < A ? 0 : (f - A + 1) / (WEB_N - A);
  const levels = [0.38, 0.66, 0.94];
  levels.forEach((lv, li) => {
    // 外の糸ほど遅く張られる（鎖の先が届いてから）
    const appear = f - (A - 3) - li * 0.5;
    if (appear < 0) return;
    const dim = (0.5 - li * 0.06) * Math.min(1, (appear + 1) / 2) * (1 - k * 0.6);
    for (let i = 0; i < WEB_SPOKES; i++) {
      const j = (i + 1) % WEB_SPOKES;
      const a0 = spokeAngle(i);
      const a1 = spokeAngle(j) + (j === 0 ? TAU : 0);
      // 糸の端は鎖の今の先の半径の割合（鎖と一緒に縮む）
      const r0 = spokeReach(i, f) * lv;
      const r1 = spokeReach(j, f) * lv;
      // 辺は 3 分割して中ほどを内へたわませる（糸の張り）
      const am = (a0 + a1) / 2;
      const rm = ((r0 + r1) / 2) * (0.95 - 0.02 * li);
      const pts = [polar(r0, a0), polar(rm, am), polar(r1, a1)];
      // 手繰りの後半は辺が 1 本ずつ千切れる
      if (k > 0.3 && hash1(i + li * 11, 3050) < (k - 0.3) * 1.8) continue;
      for (let s = 0; s < 2; s++) {
        const p = pts[s];
        const q = pts[s + 1];
        if (!p || !q) continue;
        streakLine(frame, { ax: p[0], ay: p[1], bx: q[0], by: q[1], width: 1.2, bright: dim });
      }
    }
  });
  // 中心の小さな輪（網の芯）
  if (f >= 1 && k < 0.8) ring(frame, { radius: 14, width: 1.6, bright: 0.4 * (1 - k), erosion: k * 0.8, seed: 3051 });
}

/** 蜘蛛の巣の発動: 手元で鎖が小さく 1 周巻き、8 方向へ短い鎖の芽が弾ける（これから張る網の予告） */
function spiderWebCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  if (f < 4) {
    const p = easeSwing((f + 1) / 4);
    const head = -Math.PI / 2 + p * TAU;
    chain(frame, circlePath(18, head, TAU * (0.3 + 0.6 * p)), { bright: 0.8 + 0.2 * p, seed: 3060, shade: (u) => 1 - 0.6 * u });
    weight(frame, ...polar(18, head), 4, 1);
    if (f === 3) sparkle(frame, 0, 0, 3);
    return;
  }
  const age = f - 4;
  ring(frame, { radius: 20 + age * 8, width: 2.4 - age * 0.3, erosion: Math.min(0.9, age * 0.25), bright: 0.8 - age * 0.12, seed: 3061 });
  for (let i = 0; i < WEB_SPOKES; i++) {
    const a = spokeAngle(i);
    const r0 = 12 + age * 6;
    const r1 = r0 + 14 - age * 2;
    if (age < 3) chain(frame, seg(...polar(r1, a), ...polar(r0, a)), { bright: 0.85 - age * 0.2, erosion: age * 0.3, seed: 3062 + i, scale: 1 });
  }
  if (f === 4) sparkle(frame, 0, 0, 4);
  shards(frame, age, 10, 3070, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: Math.cos(a) * 14, y: Math.sin(a) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
  void k;
}

/** 蜘蛛の巣の掴み（敵ごと。原点 = 敵、−x = 自分）: 鉤が敵に食い込み、自分へ張った鎖と崩しの星、来た側（+x）の引きずりの筋 */
function spiderWebTarget(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  // 自分へ張った鎖（手繰りきった距離 30 論理 = 60 ドット）
  if (k < 0.8) chain(frame, seg(-10, 0, -WEB_TO + 10, 0), { bright: 0.85 - k * 0.3, erosion: Math.max(0, k - 0.3) * 1.4, seed: 3080, scale: 1 });
  // 鉤: 敵の向こう側（+x）から回り込んで手前へ食い込む短い三日月
  if (k < 0.75) {
    crescent(frame, { ox: 0, oy: 0, R: 15, T: 6 * (1 - k * 0.5), head: Math.PI * 0.85, tail: -Math.PI * 0.1, erosion: k * 0.9, bright: 1 - k * 0.3, seed: 3081, peak: 0.12, edge: 1.2 });
  }
  // 崩し: 食い込んだ瞬間の小さな打撃の星
  if (f <= 3) impactStar(frame, 2, 0, 11, f, { spikes: 6, rot: Math.PI / 6, fade: 0.3, seed: 3082 });
  if (f === 0) sparkle(frame, 0, 0, 3);
  // 引きずりの筋: 敵が来た側（+x）に、敵へ向かう短い筋
  if (f <= 4) {
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 5 + (hash1(i, 3083) - 0.5) * 2;
      const x0 = 16 + f * 6 + hash1(i, 3084) * 6;
      streakLine(frame, { ax: x0 + 20 + hash1(i, 3085) * 16, ay: y, bx: x0, by: y, bright: 0.5 * (1 - f / 5) });
    }
  }
}

/** 蜘蛛の巣の打ち（nova 半径 40 × 2）: 鎖の輪が分銅を先に一周し、閉じた瞬間に 6 か所で分銅が弾けて外へ押し出す */
const BURST_R = 80;
const BURST_N = 10;
const BURST_A = 4;

function spiderWebBurst(frame, f) {
  const A = BURST_A;
  const k = f < A ? 0 : (f - A + 1) / (BURST_N - A + 1);
  const from = -Math.PI / 2;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    const head = from + TAU * p;
    const span = TAU * Math.min(0.94, 0.15 + 0.8 * p);
    chain(frame, circlePath(BURST_R, head, span), { bright: 0.85 + 0.15 * p, seed: 3101, shade: (u) => 1 - 0.55 * u });
    weight(frame, ...polar(BURST_R, head), 7, 1);
    // 分銅の後ろ、輪の外側にだけ速度線
    for (let i = 0; i < 2; i++) arcLine(frame, { radius: BURST_R + 9 + i * 3.5, from: head - 0.9 + i * 0.2, to: head - 0.15, bright: 0.55 - i * 0.12 });
    if (f === A - 1) sparkle(frame, ...polar(BURST_R + 1, head), 4);
    return;
  }
  // 閉じた輪が外へ押し広がって千切れる
  const R = BURST_R + Math.round(k * 16);
  chain(frame, circlePath(R, from + TAU, TAU), { bright: 1 - k * 0.35, erosion: 0.05 + k * 1.05, seed: 3102, shade: () => 1 });
  // 6 か所の打撃の星（崩れた敵を打つ）。輪の上、等間隔から少し崩す
  const age = f - A;
  for (let i = 0; i < 6; i++) {
    const a = from + (i / 6) * TAU + (hash1(i, 3103) - 0.5) * 0.3;
    const [x, y] = polar(R, a);
    if (age <= 3) impactStar(frame, x, y, 14, age, { spikes: 6, rot: a, fade: 0.25, seed: 3104 + i });
    if (age === 0) sparkle(frame, x, y, i % 2 === 0 ? 3 : 2);
  }
  // 押し出しの風圧: 輪の外に潰れた薄い輪
  if (age >= 1) ring(frame, { radius: R + 12 + age * 6, width: 2, erosion: Math.min(0.92, 0.2 + age * 0.15), bright: 0.55 - age * 0.06, seed: 3110 });
  shards(frame, age, 30, 3111, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3.5 + rnd(2) * 4.5;
    return { x: Math.cos(a) * BURST_R, y: Math.sin(a) * BURST_R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.45 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 縛り首（行為 0: pull 単体 半径 120 / 行為 1: swing box reach 16 size 32 heavy）
// 1 本の長い鎖が照準へ伸びて手繰られ、掴んだ敵の首に鎖の輪が締まる → 太い鎌の三日月で断つ
// -----------------------------------------------------------------------------

/** 鎖が届く長さ（120 論理 px × 2） */
const HANG_L = 240;
/** 手繰り終わりの距離（toDistance 18 × 2） */
const HANG_TO = 36;
const HANG_N = 10;
const HANG_A = 4;

/** 先の鎌: 先へ向かって下へ曲がる三日月 + 内へ折れる鉤（近接の鎌鼬の先より大きい） */
function bigSickleTip(frame, x, bright, erosion, seed) {
  crescent(frame, { ox: x - 15, oy: 4, R: 20, T: 9, head: -0.05, tail: -2.1, erosion, bright, seed, peak: 0.1, edge: 1.3 });
  if (erosion < 0.5) hook(frame, x + 4, 3, Math.PI / 2, Math.PI, 8, 3, bright, erosion, seed + 1);
}

function hangmanThrow(frame, f) {
  const A = HANG_A;
  const k = f < A ? 0 : (f - A + 1) / (HANG_N - A + 1);
  // 伸び（ease）→ 掛かる → 手繰る（加速して一気に戻る）
  const tip = f < A ? 10 + (HANG_L - 10) * easeSwing((f + 1) / A) : HANG_TO + (HANG_L - HANG_TO) * (1 - Math.pow(Math.min(1, k * 1.25), 1.6));
  chain(frame, seg(tip - 8, 0, 10, 0), { bright: 1 - k * 0.3, erosion: Math.max(0, k - 0.5) * 1.8, seed: 3201, shade: (u) => 1 - 0.5 * u });
  if (k < 0.8) bigSickleTip(frame, tip, 1 - k * 0.35, k * 0.8, 3202);
  if (f === A - 1) sparkle(frame, tip + 2, 0, 4);
  if (f === A) sparkle(frame, tip + 2, 0, 2);
  // 伸びる間: 鎖の両脇に前へ流れる速度線
  if (f < A) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (8 + Math.floor(i / 2) * 5);
      const x1 = tip - 14 - hash1(i, 3203) * 16;
      streakLine(frame, { ax: Math.max(12, x1 - 30 - hash1(i, 3204) * 20), ay: y, bx: x1, by: y, bright: 0.5 });
    }
  } else if (k < 0.8) {
    // 手繰る間: 手元へ向かう速度線（内の端が明るい）
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (6 + Math.floor(i / 2) * 5 + hash1(i, 3205) * 2);
      const x0 = Math.max(14, tip - 10 + hash1(i, 3206) * 20);
      streakLine(frame, { ax: x0 + 24 + hash1(i, 3207) * 30, ay: y, bx: x0, by: y, bright: 0.55 * (1 - k) });
    }
  }
  if (f >= A) {
    shards(frame, f - A, 10, 3208, (i, rnd) => {
      const sp = 3 + rnd(1) * 3;
      return { x: HANG_L * (0.3 + 0.7 * rnd(2)), y: (rnd(3) - 0.5) * 6, vx: -sp, vy: (rnd(4) - 0.5) * 2, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
}

/** 縛り首の発動: 手元で鎖を頭上に小さく 2 周回し、照準へ放る鋭い閃き */
function hangmanCast(frame, f) {
  const N = 8;
  if (f < 5) {
    const p = easeSwing((f + 1) / 5);
    const head = p * Math.PI * 4;
    const R = 16 + p * 4;
    chain(frame, circlePath(R, head, TAU * 0.7), { bright: 0.8 + 0.2 * p, seed: 3220, shade: (u) => 1 - 0.7 * u, scale: 1 });
    weight(frame, ...polar(R, head), 4.5, 1);
    arcLine(frame, { radius: R + 8, from: head - 1, to: head - 0.2, bright: 0.5 });
    if (f === 4) sparkle(frame, ...polar(R, head), 3);
    return;
  }
  // 放る: 前へ鋭いレンズの閃き（剣の抜刀より細く長い）と、手元の潰れた輪
  const age = f - 5;
  const g = Math.min(1, (age + 1) / 2);
  lens(frame, { ax: 8 + age * 10, ay: 0, bx: 20 + 44 * g, by: 0, T: 4 - age, bias: 0.3, erosion: age * 0.3, seed: 3221, bright: 1 - age * 0.2 });
  ring(frame, { ox: 4, radius: 8 + age * 5, width: 2.2, squash: 0.5, erosion: Math.min(0.9, age * 0.35), bright: 0.75 - age * 0.15, seed: 3222 });
  if (age === 0) sparkle(frame, 18 + 44 * g, 0, 3);
  void N;
}

/** 縛り首の輪（原点 = 掴んだ敵、−x = 自分）: 鎖が敵の首を 1 周巻いて締まり、自分へ張る。来た側（+x）に引きずりの筋 */
const NOOSE_R = 22;
function hangmanNoose(frame, f) {
  const N = 9;
  const k = f < 4 ? 0 : (f - 3) / (N - 4);
  // 巻く（f 0..2）→ 締まる（f 3..4）→ 崩れる
  const wrap = Math.min(1, (f + 1) / 3);
  const R = f < 3 ? NOOSE_R : Math.max(12, NOOSE_R - (f - 2) * 3.5);
  const head = Math.PI + wrap * TAU;
  chain(frame, circlePath(R, head, TAU * wrap * 0.95), { bright: 1 - k * 0.35, erosion: k * 1.1, seed: 3230, shade: (u) => 1 - 0.35 * u });
  // 自分への鎖（輪の手前の縁から自分の近くまで）
  if (k < 0.7) chain(frame, seg(-R - 3, 0, -HANG_TO + 6, 0), { bright: 0.8 - k * 0.3, erosion: k, seed: 3231, scale: 1 });
  if (f < 3) weight(frame, ...polar(R, head), 4, 1);
  // 締まった瞬間: 輪の上下に光点と圧の星
  if (f === 3 || f === 4) {
    sparkle(frame, 0, -R, f === 3 ? 3 : 2);
    sparkle(frame, 0, R, f === 3 ? 2 : 1);
  }
  // 締まる圧: 輪の外にだけ短い棘（輪を横切ると照準に見える）
  if (f === 3 || f === 4) {
    for (let i = 0; i < 8; i++) {
      const a = ((i + (hash1(i, 3232) - 0.5) * 0.4) / 8) * TAU + Math.PI / 8;
      const r0 = R + 3 + (f - 3) * 4;
      const r1 = r0 + (i % 2 === 0 ? 12 : 7) * (1 - (f - 3) * 0.4);
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: i % 2 === 0 ? 1.8 : 1.2, bright: f === 3 ? 0.95 : 0.6 });
    }
  }
  // 引きずりの筋: 敵が来た側（+x）
  if (f <= 4) {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 6 + (hash1(i, 3233) - 0.5) * 2;
      const x0 = NOOSE_R + 6 + f * 8 + hash1(i, 3234) * 6;
      streakLine(frame, { ax: x0 + 26 + hash1(i, 3235) * 24, ay: y, bx: x0, by: y, bright: 0.55 * (1 - f / 5) });
    }
  }
  if (f >= 3) {
    shards(frame, f - 3, 12, 3236, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2 + rnd(2) * 3;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 縛り首の断ち（box reach 16 size 32 heavy）: 太い鎌の三日月 1 本が前を上から下へ断ち、先が大きな鉤に折れる。
 * 振り切りで刃の通り道に大きな打撃の星（地割れは地面のシート）
 */
const CHOP = { R: 58, T: 30, sweep: 150, frames: 10, active: 4, hook: 18, seed: 3301 };
/** 断ちの着点（刃の通り道の中ほど。box は前へ 64 ドットまで） */
const CHOP_HIT_X = 50;

function chopState(f) {
  const half = (CHOP.sweep * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const A = CHOP.active;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    return { from, sweep, p, k: 0, head: from + sweep * p, tail: from + sweep * Math.max(0, p - 0.85) * 0.5, erosion: 0, bright: 0.85 + 0.2 * p, T: CHOP.T * (0.7 + 0.3 * p) };
  }
  const k = (f - A + 1) / (CHOP.frames - A + 1);
  return {
    from,
    sweep,
    p: 1,
    k,
    head: from + sweep * (1 + 0.05 * k),
    tail: from + sweep * Math.min(0.97, 0.15 + 0.82 * Math.pow(k, 0.8)),
    erosion: 0.03 + 0.85 * Math.pow(k, 1.25),
    bright: 1 - 0.3 * k,
    T: CHOP.T * (1 - 0.5 * k),
  };
}

function hangmanChop(frame, f) {
  const st = chopState(f);
  const A = CHOP.active;
  crescent(frame, { R: CHOP.R, T: st.T, head: st.head, tail: st.tail, erosion: st.erosion, bright: st.bright, seed: CHOP.seed, streak: 0.5, peak: 0.12, edge: 1.7 });
  if (st.k < 0.55) {
    const [x, y] = polar(CHOP.R - 1.5, st.head);
    const scale = f < A ? 0.6 + 0.4 * st.p : 1 - st.k;
    hook(frame, x, y, st.head + Math.PI / 2, st.head + Math.PI, CHOP.hook * scale, Math.max(3, CHOP.T * 0.26), st.bright, st.k * 0.9, CHOP.seed + 1);
  }
  // 速度線: 刃の外側にだけ、先端の後ろへ沿わせる
  if (st.k < 0.5) {
    for (let i = 0; i < 3; i++) {
      const len = 0.5 + 0.4 * hash1(i, CHOP.seed + 2);
      const end = st.head - 0.08 - 0.2 * hash1(i, CHOP.seed + 3);
      arcLine(frame, { radius: CHOP.R + 4 + i * 3.4, from: Math.max(st.tail, end - len), to: end, bright: (0.6 - i * 0.1) * (1 - st.k) });
    }
  }
  // 着点の打撃: 大きな星 → 棘の外に出てから潰れた輪
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 3) impactStar(frame, CHOP_HIT_X, 0, 30, age, { spikes: 10, rot: Math.PI / 10, fade: 0.2, seed: CHOP.seed + 4 });
    if (age === 0) sparkle(frame, CHOP_HIT_X, 0, 4);
    if (age === 1) sparkle(frame, CHOP_HIT_X, 0, 2);
    shards(frame, age, 26, CHOP.seed + 6, (i, rnd) => {
      const forward = rnd(1) > 0.35;
      const a = forward ? (rnd(2) - 0.5) * 1.6 : rnd(2) * TAU;
      const sp = 4 + rnd(3) * 5;
      return { x: CHOP_HIT_X, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1 };
    });
  }
}

/** 断ちの地面: 着点から前と左右へ走る地割れ（ぎざぎざの線）。振り切りから走り、薄れて消える */
function hangmanChopGround(frame, f) {
  const A = CHOP.active;
  if (f < A - 1) return;
  const age = f - (A - 1);
  const grow = Math.min(1, (age + 1) / 3);
  const k = Math.max(0, (age - 2) / (CHOP.frames - A - 1));
  const dim = 0.5 * (1 - k * 0.7);
  for (let i = 0; i < 7; i++) {
    // 前寄りに扇形（振り下ろした刃が地を割る）
    const base = (i - 3) * 0.42 + (hash1(i, 3310) - 0.5) * 0.2;
    const len = (30 + hash1(i, 3311) * 36) * grow;
    let x = CHOP_HIT_X;
    let y = 0;
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const a = base + (hash1(i * 7 + s, 3312) - 0.5) * 0.7;
      const nx = x + Math.cos(a) * (len / steps);
      const ny = y + Math.sin(a) * (len / steps);
      if (hash1(i * 7 + s, 3313) < k * 1.2) break;
      streakLine(frame, { ax: x, ay: y, bx: nx, by: ny, width: s === 0 ? 1.8 : 1.2, bright: dim * (1 - s * 0.15) });
      x = nx;
      y = ny;
    }
  }
  ring(frame, { ox: CHOP_HIT_X, radius: 9 + age, width: 2, squash: 0.7, erosion: Math.min(0.9, k), bright: dim, seed: 3314 });
}

// -----------------------------------------------------------------------------
// 分銅回し（持続）: 手元から鎖で分銅を回し続ける。dirs 1（向きは画面に揃え、回転の位相だけで動かす）
// -----------------------------------------------------------------------------

/** 纏いの分銅の回る半径（キャラ 24 論理 = 48 ドットのすぐ外） */
const SPIN_R = 46;
const SPIN_N = 12;

/** 分銅回しの発動: 手元から鎖が渦を描いて繰り出され、回る半径まで広がった瞬間に分銅が光って風が弾ける */
function weightSpinCast(frame, f) {
  const N = 10;
  const G = 5;
  if (f < G) {
    const p = easeSwing((f + 1) / G);
    const head = -Math.PI / 2 + p * Math.PI * 3;
    // 渦: 先 = 回る半径 × p、根元 = 手元（角が戻るほど内へ）
    const pts = [];
    const turns = 1.1;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      pts.push(polar(8 + (SPIN_R * (0.3 + 0.7 * p) - 8) * (1 - u), head - u * TAU * turns));
    }
    chain(frame, pts, { bright: 0.8 + 0.2 * p, seed: 3401, shade: (u) => 1 - 0.65 * u });
    weight(frame, ...polar(SPIN_R * (0.3 + 0.7 * p), head), 4 + 3 * p, 1);
    if (f === G - 1) sparkle(frame, ...polar(SPIN_R, head), 4);
    return;
  }
  // 弾ける風: 回る半径の外に広がる輪と、接線へ流れる風の弧（4 本）
  const age = f - G;
  const k = age / (N - G);
  ring(frame, { radius: SPIN_R + 8 + age * 9, width: 2.6 - k * 1.2, erosion: Math.min(0.9, 0.1 + k * 0.9), bright: 0.8 - k * 0.3, seed: 3402 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + age * 0.35 + hash1(i, 3403) * 0.5;
    arcLine(frame, { radius: SPIN_R + 4 + age * 5, from: a, to: a + 0.6, bright: 0.55 * (1 - k) });
  }
  if (age === 0) sparkle(frame, 0, 0, 3);
  shards(frame, age, 16, 3404, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 4;
    return { x: Math.cos(a) * SPIN_R, y: Math.sin(a) * SPIN_R, vx: (-Math.sin(a) * 0.7 + Math.cos(a) * 0.5) * sp, vy: (Math.cos(a) * 0.7 + Math.sin(a) * 0.5) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

/**
 * 分銅回しの纏い（持続中ずっと。1 巡 = 分銅 1 周なので継ぎ目が出ない）: 手元から分銅への放射の鎖 1 本、
 * 分銅の後ろの風の尾（暗い三日月 1 本）、外側の速度線。分銅は 1 周に 2 回光る
 */
function weightSpinSustain(frame, f) {
  const rot = -Math.PI / 2 + (f / SPIN_N) * TAU;
  // 風の尾: 分銅の軌跡のぶれ（刃ではないので暗く、白い縁を作らない）
  crescent(frame, { R: SPIN_R + 5, T: 10, head: rot - 0.12, tail: rot - 1.6, bright: 0.5, seed: 3410, peak: 0.08, edge: 0, streak: 0.6 });
  arcLine(frame, { radius: SPIN_R + 10, from: rot - 1.0, to: rot - 0.25, bright: 0.45 });
  chain(frame, seg(...polar(SPIN_R - 7, rot), ...polar(10, rot)), { bright: 0.9, seed: 3411, scale: 1, shade: (u) => 1 - 0.5 * u });
  const flash = f === 0 || f === SPIN_N / 2;
  weight(frame, ...polar(SPIN_R, rot), 7, flash ? 1.1 : 0.95);
  if (flash) sparkle(frame, ...polar(SPIN_R + 1, rot), 2);
}

/** 纏いの足元: 分銅の回る道の薄い輪と、回る 6 つの刻み（6 回対称で 1 巡に 1/6 回るので継ぎ目が出ない） */
function weightSpinGround(frame, f) {
  const cycle = f / SPIN_N;
  ring(frame, { radius: SPIN_R, width: 1.4, bright: 0.26, seed: 3420 });
  for (let i = 0; i < 6; i++) {
    const a = ((i + cycle) / 6) * TAU;
    streakLine(frame, { ax: Math.cos(a) * (SPIN_R - 5), ay: Math.sin(a) * (SPIN_R - 5), bx: Math.cos(a + 0.12) * (SPIN_R + 5), by: Math.sin(a + 0.12) * (SPIN_R + 5), width: 1.3, bright: 0.3 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 引き寄せの base は半径、周囲攻撃は半径、振りは reach。target は掴んだ敵ごと（原点 = 敵、+x = 自分から敵への向き）
 */
const FX = {
  moveset: "chainSickle",
  ultimates: {
    "chainSickle.spiderWeb": {
      // 鎖の網は鋼の色（引き寄せと打ちの 2 行為とも物理の鎖）
      ramp: "steel",
      cast: { sheet: "chainSickleUlt.spiderWebCast", life: 0.32 },
      acts: [
        { sheet: "chainSickleUlt.spiderWeb", life: 0.55, base: WEB_R / 2, pivot: "pos", ground: "chainSickleUlt.spiderWebGround" },
        { sheet: "chainSickleUlt.spiderWebBurst", life: 0.5, base: BURST_R / 2, pivot: "pos" },
      ],
      target: { sheet: "chainSickleUlt.spiderWebTarget", life: 0.4, pivot: "to" },
    },
    "chainSickle.hangman": {
      // 処刑の一撃なので闇の配色（属性は無い。見た目だけ）
      ramp: "dark",
      cast: { sheet: "chainSickleUlt.hangmanCast", life: 0.32 },
      acts: [
        { sheet: "chainSickleUlt.hangman", life: 0.45, base: HANG_L / 2, pivot: "pos" },
        { sheet: "chainSickleUlt.hangmanChop", life: 0.5, base: 16, pivot: "pos", ground: "chainSickleUlt.hangmanChopGround" },
      ],
      target: { sheet: "chainSickleUlt.hangmanNoose", life: 0.45, pivot: "to" },
    },
    "chainSickle.weightSpin": {
      ramp: "light",
      cast: { sheet: "chainSickleUlt.weightSpinCast", life: 0.5 },
      sustain: { sheet: "chainSickleUlt.weightSpin", period: 0.5, ground: "chainSickleUlt.weightSpinGround" },
    },
  },
};

export const ATLAS = {
  key: "chainSickleUlt",
  fx: FX,
  sheets: [
    { key: "chainSickleUlt.spiderWebCast", dirs: 1, frames: 8, active: 0, size: 128, draw: spiderWebCast },
    { key: "chainSickleUlt.spiderWeb", dirs: 1, frames: WEB_N, active: WEB_A, size: 2 * (WEB_R + 24), draw: spiderWeb },
    { key: "chainSickleUlt.spiderWebGround", dirs: 1, frames: WEB_N, active: WEB_A, size: 2 * (WEB_R + 8), draw: spiderWebGround },
    { key: "chainSickleUlt.spiderWebTarget", dirs: DIRS, frames: 8, active: 0, size: 2 * (WEB_TO + 16), draw: spiderWebTarget },
    { key: "chainSickleUlt.spiderWebBurst", dirs: 1, frames: BURST_N, active: BURST_A, size: 2 * (BURST_R + 44), draw: spiderWebBurst },
    { key: "chainSickleUlt.hangmanCast", dirs: DIRS, frames: 8, active: 0, size: 144, draw: hangmanCast },
    { key: "chainSickleUlt.hangman", dirs: DIRS, frames: HANG_N, active: HANG_A, size: 2 * (HANG_L + 30), draw: hangmanThrow },
    { key: "chainSickleUlt.hangmanNoose", dirs: DIRS, frames: 9, active: 0, size: 2 * (NOOSE_R + 80), draw: hangmanNoose },
    { key: "chainSickleUlt.hangmanChop", dirs: DIRS, frames: CHOP.frames, active: CHOP.active, size: 2 * (CHOP.R + 44), draw: hangmanChop },
    { key: "chainSickleUlt.hangmanChopGround", dirs: DIRS, frames: CHOP.frames, active: CHOP.active, size: 2 * (CHOP_HIT_X + 60), draw: hangmanChopGround },
    { key: "chainSickleUlt.weightSpinCast", dirs: 1, frames: 10, active: 0, size: 2 * (SPIN_R + 60), draw: weightSpinCast },
    { key: "chainSickleUlt.weightSpin", dirs: 1, frames: SPIN_N, active: 0, size: 2 * (SPIN_R + 22), draw: weightSpinSustain },
    { key: "chainSickleUlt.weightSpinGround", dirs: 1, frames: SPIN_N, active: 0, size: 2 * (SPIN_R + 12), draw: weightSpinGround },
  ],
};
