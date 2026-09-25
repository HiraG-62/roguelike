// 拳（moveset "fists"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/fists.json）× 2 が目安
//
// 拳は斬撃ではなく打撃。刃の三日月は使わず、次の 4 つの部品だけで組む:
//   衝撃の星（impactStar）: 当たりの位置で弾ける不揃いな放射状のトゲ + 中心の白い閃光。弾けた後はトゲが芯から離れて飛ぶ
//   衝撃波の輪（ring の squash）: 進行方向に少し潰れた楕円が広がって欠ける
//   風圧の線（windStreak）: 拳の通り道の短く太い空気の筋。白くしない
//   風圧の帯（airBand）: 蹴りの太く短い弧。刃ではなく空気の塊なので縁を白くせず段 4〜5 の厚い帯
import { arcBounds, easeSwing, ring, shards, sparkle } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 衝撃の星。(x, y) を中心に n 本の不揃いなトゲ（長さ・太さ・角をハッシュでばらす）と、芯の円。
 * detach（0..1）でトゲが芯から離れて外へ飛ぶ短い衝撃線になり、芯は消える。
 * dirA / spread でトゲを扇に絞れる（spread = TAU なら全周）。squash は進行方向（x）の潰れ
 */
function impactStar(frame, o) {
  const x0 = o.x ?? 0;
  const y0 = o.y ?? 0;
  const R = o.R;
  const n = o.n ?? 9;
  const seed = o.seed ?? 1;
  const bright = o.bright ?? 1;
  const detach = o.detach ?? 0;
  const width = o.width ?? 3;
  const erosion = o.erosion ?? 0;
  const spread = o.spread ?? TAU;
  const dirA = o.dirA ?? 0;
  const squash = o.squash ?? 1;
  const coreR = detach > 0.3 ? 0 : (o.core ?? R * 0.22) * (1 - detach) ** 1.5;
  const full = spread >= TAU - 1e-6;
  const spikes = [];
  for (let i = 0; i < n; i++) {
    const jit = (hash1(i, seed) - 0.5) * (full ? 0.55 : 0.35);
    const a = full ? dirA + ((i + jit) / n) * TAU : dirA + (n === 1 ? 0 : (i / (n - 1) - 0.5 + jit / n) * spread);
    // 長いトゲと短いトゲを不規則に混ぜて、揃った花形・車輪の輻に見せない
    const isLong = i % 2 === 0 ? hash1(i, seed + 3) > 0.15 : hash1(i, seed + 3) > 0.8;
    const long = isLong ? 1 : 0.6;
    const len = R * long * (0.65 + 0.5 * hash1(i, seed + 1));
    const w = width * (0.75 + 0.6 * hash1(i, seed + 2)) * (isLong ? 1 : 0.8);
    // 離れたトゲの飛ぶ速さ（同じ円周上に揃わないように）
    const v = 0.6 + 0.8 * hash1(i, seed + 4);
    // 離れて飛ぶのは長いトゲだけ（短いトゲまで残すと、輪の内側に目盛りが並んだ「時計」に見える）
    if (detach > 0.3 && !isLong) continue;
    spikes.push({ c: Math.cos(a), s: Math.sin(a), len, w, v });
  }
  const reach = R * 1.2 + R * 1.4 * detach + width + 2;
  // 標本ごとの早い棄却（生成時間のため）: トゲの届く範囲の外と、離れたトゲの内端より内側の空洞
  let rMax = coreR;
  let rMin = Infinity;
  for (const sp of spikes) {
    rMax = Math.max(rMax, sp.len * (1 + detach * 0.95 * sp.v) + sp.w);
    rMin = Math.min(rMin, detach * sp.len * 1.05 * sp.v);
  }
  const rMax2 = rMax * rMax;
  const wideR = width * 3;
  const hole2 = Math.max(0, rMin - 1) ** 2;
  paint(
    frame,
    (px, py) => {
      const dx = (px - x0) / squash;
      const dy = py - y0;
      const r2 = dx * dx + dy * dy;
      if (r2 > rMax2 || (r2 < hole2 && coreR <= 0)) return -1;
      const r = Math.sqrt(r2);
      let best = -1;
      if (r < coreR) {
        const q = r / coreR;
        best = 1 - 0.35 * q;
      }
      // 全周の星は、標本の角に近い 3 本だけ調べる（生成時間のため）。芯の近くは太いトゲが角をまたぐので全部
      let list = spikes;
      if (full && spikes.length === n && r > wideR) {
        const sector = Math.round((wrapAngle(Math.atan2(dy, dx) - dirA) / TAU) * n);
        list = [spikes[(sector - 1 + 2 * n) % n], spikes[(sector + 2 * n) % n], spikes[(sector + 1 + 2 * n) % n]];
      }
      for (const sp of list) {
        const t = dx * sp.c + dy * sp.s;
        // 離れたトゲ: 内端が外へ逃げ、先端も少し伸びる
        const r0 = detach * sp.len * 1.05 * sp.v;
        const r1 = sp.len * (1 + detach * 0.95 * sp.v);
        if (t < r0 || t > r1) continue;
        const perp = Math.abs(-dx * sp.s + dy * sp.c);
        const u = (t - r0) / Math.max(1e-3, r1 - r0);
        // 内側が太く先端で尖る。離れたら両端が細る短い線
        const prof = detach > 0.05 ? Math.sin(Math.PI * Math.min(1, u * (1 - detach * 0.3) + detach * 0.15)) ** 0.7 : (1 - u) ** 0.85;
        const w = sp.w * 0.5 * prof * (1 - detach * 0.35);
        if (perp > Math.max(0.5, w)) continue;
        const v = (1 - 0.6 * u) * (1 - 0.4 * (perp / Math.max(0.5, w))) * (1 - detach * 0.35);
        if (v > best) best = v;
      }
      if (best < 0) return -1;
      if (!survives(px, py, erosion, best, seed + 11)) return -1;
      return clamp01(best * bright);
    },
    { bounds: { x0: x0 - reach * squash, y0: y0 - reach, x1: x0 + reach * squash, y1: y0 + reach } },
  );
}

/** 風圧の線: 拳の通り道の短く太い空気の筋（両端が細る）。白くしない（段 5〜6 まで） */
function windStreak(frame, o) {
  const { ax, ay, bx, by } = o;
  const T = o.T ?? 4;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 3;
  const len = Math.hypot(bx - ax, by - ay);
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  const pad = T + 2;
  paint(
    frame,
    (x, y) => {
      const px = x - ax;
      const py = y - ay;
      const f = (px * tx + py * ty) / len;
      if (f < 0 || f > 1) return -1;
      // 後ろ（a）ほど細く、前寄りが太い涙形: 空気が押し出される向きが読める
      const w = T * 0.5 * Math.sin(Math.PI * Math.pow(f, 0.7)) ** 0.6;
      const across = Math.abs(-px * ty + py * tx);
      if (w < 0.5 || across > w) return -1;
      const q = across / w;
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01((1 - 0.55 * q) * (0.45 + 0.55 * f) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad } },
  );
}

/** 風圧の帯の気流の筋の間隔（絵のドット） */
const STRAND = 5;

/**
 * 風圧の帯（蹴りの弧）。中心 (ox, oy)・外縁の半径 R・最大の太さ T、先端の角 head・尾の角 tail（時計回りなので head > tail）。
 * 刃ではないので縁を白くしない。厚みの中ほどが明るく（段 5）、両縁は段 2〜3。円周方向の気流の筋を混ぜる
 */
function airBand(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 7;
  const span = Math.max(1e-3, head - tail);
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R + 1) return -1;
      const s = wrapAngle(head - Math.atan2(dy, dx));
      const u = s / span;
      if (u < 0 || u > 1) return -1;
      // 先端は丸く鈍く（押し出された空気の塊の頭。尖らせると刃に見える）、尾は細る
      const HEAD = 0.1;
      const w = u < HEAD ? T * Math.sqrt(Math.max(0, 1 - (1 - u / HEAD) ** 2)) : T * (1 - ((u - HEAD) / (1 - HEAD)) ** 1.4);
      if (w < 0.8) return -1;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      // 気流の筋: 厚みを 4 ドットごとの帯に分け、帯の境目に 1 ドットの隙間を尾の側から入れる。頭は塊のまま、尾は糸のようにほどける
      const depth = R - r;
      const strand = Math.floor(depth / STRAND);
      const splitAt = 0.3 + 0.35 * hash1(strand, seed + 9);
      if (depth % STRAND < 1 && u > splitAt && strand > 0) return -1;
      if (!survives(x, y, erosion, 1 - Math.abs(q - 0.4), seed)) return -1;
      const grain = 0.8 + 0.3 * hash1(strand, seed);
      const body = Math.max(0, 1 - Math.abs(q - 0.4) * 1.45) ** 0.7;
      return clamp01(body * (1 - 0.5 * u) * grain * bright * (1 - erosion * 0.4));
    },
    { bounds: arcBounds(ox, oy, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05) },
  );
}

/** 弧の外縁に沿う風の筋（帯の外側だけ。内側には引かない＝二重の弧に見せない） */
function airLines(frame, o) {
  const { R, head, span, k, count, seed } = o;
  const ox = o.ox ?? 0;
  for (let i = 0; i < count; i++) {
    const radius = R + 2 + i * 2 + k * 5;
    const len = span * (0.25 + 0.35 * hash1(i, seed)) * (1 - k * 0.8);
    const end = head - span * (0.1 + 0.15 * hash1(i, seed + 1)) + k * span * 0.2;
    if (len <= 0.03 || k >= 0.9) continue;
    const from = end - len;
    paint(
      frame,
      (x, y) => {
        const dx = x - ox;
        const r = Math.hypot(dx, y);
        if (Math.abs(r - radius) > 0.6) return -1;
        const f = wrapAngle(Math.atan2(y, dx) - from) / len;
        if (f < 0 || f > 1) return -1;
        return 0.5 * (0.35 + 0.65 * f) * (1 - k * 0.6);
      },
      { bounds: arcBounds(ox, 0, radius - 1, radius + 1, from, end), dither: 0, samples: 2 },
    );
  }
}

/**
 * 1 発の打撃の時間割。age = 当たってからのフレーム（0 = 閃光）。
 * 0: 芯の白い閃光と短いトゲ → 1: 星が最大 + 輪が出る → 2 以降: トゲが離れて飛び、輪が広がって欠ける
 */
function punchPop(frame, age, o) {
  if (age < 0) return;
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const R = o.R;
  const life = o.life ?? 5;
  if (age > life) return;
  const seed = o.seed ?? 1;
  const n = o.n ?? 9;
  const width = o.width ?? 3;
  const squash = o.squash ?? 0.8;
  const k = age <= 1 ? 0 : (age - 1) / (life - 1);
  const scale = age === 0 ? 0.6 : 1;
  impactStar(frame, {
    x,
    y,
    R: R * scale,
    n,
    seed,
    width: width * (age === 0 ? 1.15 : 1),
    detach: age <= 1 ? 0 : Math.min(0.95, 0.35 + k * 0.6),
    erosion: age <= 2 ? 0 : k * 0.55,
    bright: age <= 1 ? 1 : 0.92 - k * 0.35,
    dirA: o.dirA ?? 0,
    spread: o.spread ?? TAU,
    squash: o.starSquash ?? 1,
    core: o.core,
  });
  if (age <= 1) sparkle(frame, x, y, age === 0 ? (o.glint ?? 3) - 1 : (o.glint ?? 3));
  // 輪は星が最大になった次の枚から、トゲの先のすぐ外に出て広がる（星と重なって「車輪」に見えないように）
  if (age >= 2 && (o.ring ?? true)) {
    const a = age - 2;
    const r0 = o.ringR ?? R * 1.0;
    const grow = o.ringGrow ?? R * 0.3;
    ring(frame, {
      ox: x + (o.ringPush ?? 0) * (a + 1),
      oy: y,
      radius: r0 + a * grow,
      width: (o.ringW ?? 2.2) * (1 - a * 0.12),
      squash,
      erosion: Math.min(0.92, 0.32 + a * (1.1 / life)),
      bright: 0.72 - a * (0.5 / life),
      seed: seed + 5,
    });
  }
}

/** 拳の通り道: pop の後ろ（自分の側）に並ぶ短く太い風圧の線 */
function fistTrail(frame, o) {
  const { x, y, len, k, seed } = o;
  const count = o.count ?? 3;
  const T = (o.T ?? 4) * 1.4;
  const gap = o.gap ?? 5;
  if (k >= 0.95) return;
  for (let i = 0; i < count; i++) {
    const side = i - (count - 1) / 2;
    const yy = y + side * gap + (hash1(i, seed) - 0.5) * 2;
    // 中央の線ほど長く前へ（拳の芯）。外側は短く後ろに退く
    const l = len * (1 - Math.abs(side) * 0.28) * (0.8 + 0.3 * hash1(i, seed + 1));
    const bx = x - 4 - Math.abs(side) * 3 - k * 10;
    windStreak(frame, { ax: bx - l * (1 - k * 0.6), ay: yy, bx, by: yy, T: T * (1 - Math.abs(side) * 0.25) * (1 - k * 0.5), bright: (0.62 - Math.abs(side) * 0.08) * (1 - k * 0.5), erosion: k * 0.6, seed: seed + i });
  }
}

/** 飛び散る粒（衝撃で弾けた空気と塵）。heavy は多く速い */
function burstDust(frame, age, o) {
  const { x = 0, y = 0, count, seed, speed = 4, dirA = 0, spread = TAU } = o;
  shards(frame, age, count, seed, (i, rnd) => {
    const a = spread >= TAU ? rnd(1) * TAU : dirA + (rnd(1) - 0.5) * spread;
    const sp = speed * (0.6 + 0.8 * rnd(2));
    return { x: x + Math.cos(a) * 4, y: y + Math.sin(a) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** active の後の崩れの進み（0..1） */
function fadeOf(f, A, N) {
  return f < A ? 0 : (f - A + 1) / (N - A + 1);
}

// -----------------------------------------------------------------------------
// 左の段（突き・連打・終撃）。原点 = 当たりの中心（anchor）。自分は -reach×2 の位置
// -----------------------------------------------------------------------------

/** 左 1 段: 素早い突き（box reach 10）。短い風圧の線 3 本 + 小さな衝撃の星 */
function jab(frame, f) {
  const A = 3;
  const N = 7;
  const k = fadeOf(f, A, N);
  if (f === 0) fistTrail(frame, { x: -2, y: -2, len: 18, k: 0, seed: 111, count: 3, T: 4, gap: 5 });
  else fistTrail(frame, { x: 0, y: -2, len: 14, k: Math.min(0.9, 0.3 + k), seed: 111, count: 3, T: 4, gap: 5 });
  punchPop(frame, f - 1, { x: 2, y: -2, R: 16, n: 9, seed: 112, life: 5, width: 3.2 });
  if (f >= 2) burstDust(frame, f - 2, { x: 2, y: -2, count: 5, seed: 113, speed: 3.5 });
}

/** 左 2 段: 逆の手の突き（描画側で上下反転）。1 段目より少し伸び、星のトゲが前へ偏る */
function cross(frame, f) {
  const A = 3;
  const N = 7;
  const k = fadeOf(f, A, N);
  fistTrail(frame, { x: f === 0 ? 0 : 3, y: 2, len: f === 0 ? 22 : 16, k: f === 0 ? 0 : Math.min(0.9, 0.3 + k), seed: 121, count: 2, T: 5, gap: 6 });
  punchPop(frame, f - 1, { x: 4, y: 2, R: 17, n: 8, seed: 122, life: 5, width: 3.4, starSquash: 1.15, squash: 0.7 });
  if (f >= 2) burstDust(frame, f - 2, { x: 4, y: 2, count: 5, seed: 123, speed: 3.8, dirA: 0, spread: 2.4 });
}

/** 左 3 段: 横からのフック。自分の脇を中心に -y 側から回り込む短く太い風圧の帯が、当たりの位置で星になって弾ける */
function hook(frame, f) {
  const A = 3;
  const N = 7;
  const k = fadeOf(f, A, N);
  const cx = -16;
  const R = 18;
  const from = -1.9;
  const head = f < A ? from + (0 - from) * easeSwing((f + 1) / A) : 0.12 * k;
  const tail = f < A ? Math.max(from, head - 1.6) : head - 1.6 * (1 - k * 0.8);
  if (k < 0.5) airBand(frame, { ox: cx, R: R + 4, T: 8 * (1 - k * 0.5), head, tail, bright: 0.6 * (1 - k * 0.4), erosion: k * 0.75, seed: 131 });
  punchPop(frame, f - 1, { x: 2, y: 0, R: 16, n: 10, seed: 132, life: 5, width: 3, squash: 0.85 });
  if (f >= 2) burstDust(frame, f - 2, { x: 2, y: 0, count: 6, seed: 133, speed: 3.5, dirA: 0.5, spread: 2.2 });
}

/** 左 4 段（連打 3 発・box reach 10）: 小さな衝撃が位置をずらしてポンポンと 3 回弾ける */
const RUSH3 = [
  { x: -3, y: -7, R: 12, seed: 141 },
  { x: 3, y: 6, R: 12, seed: 142 },
  { x: 6, y: -1, R: 14, seed: 143 },
];
function rush3(frame, f) {
  RUSH3.forEach((p, i) => {
    const age = f - i;
    if (age === 0 || age === 1) fistTrail(frame, { x: p.x, y: p.y, len: 12, k: age * 0.45, seed: p.seed + 20, count: 2, T: 4, gap: 5 });
    // 輪は最後の 1 発だけ（連打の輪が重なると絡まった円の束に見える）
    punchPop(frame, age, { ...p, n: 8, life: 4, width: 3, glint: 3, ring: i === RUSH3.length - 1 });
    if (age >= 1) burstDust(frame, age - 1, { x: p.x, y: p.y, count: 3, seed: p.seed + 40, speed: 3 });
  });
}

/** 前へ張り出す衝撃の弓（音の壁のような面）。中心 x の円の一部を、角 ±half で両端が細るように塗る */
function bowShock(frame, o) {
  const { x, R, T, half } = o;
  const bright = o.bright ?? 0.7;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const r = Math.hypot(dx, py);
      const a = Math.atan2(py, dx);
      const u = Math.abs(a) / half;
      if (u > 1) return -1;
      const w = (T / 2) * Math.cos((Math.PI / 2) * u) ** 0.6;
      const d = r - R;
      if (w < 0.5 || Math.abs(d) > w) return -1;
      const q = Math.abs(d) / w;
      if (!survives(px, py, erosion, 1 - q, seed)) return -1;
      // 外縁（進む側）ほど明るい
      return clamp01((1 - 0.6 * q) * (d > 0 ? 1 : 0.8) * (1 - 0.4 * u) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x - R - T, y0: -R - T, x1: x + R + T, y1: R + T } },
  );
}

/** 左 5 段（終撃・heavy・box reach 12 / size 20）: 太い風圧の線から、大きな星と 2 重の衝撃波。太い衝撃線が四方へ飛ぶ */
function finisher(frame, f) {
  const A = 4;
  const N = 9;
  const k = fadeOf(f, A, N);
  if (f <= 2) fistTrail(frame, { x: f === 0 ? -6 : 0, y: 0, len: f === 0 ? 34 : 26, k: f * 0.3, seed: 151, count: 3, T: 5, gap: 9 });
  punchPop(frame, f - 1, { x: 4, y: 0, R: 30, n: 12, seed: 152, life: 7, width: 5.5, glint: 4, squash: 0.8, ringGrow: 8, ringW: 4 });
  if (f >= 2) burstDust(frame, f - 2, { x: 4, y: 0, count: 12, seed: 154, speed: 6 });
  void k;
}

/** ダッシュ攻撃（heavy・box reach 12 / size 20）: 後ろへ流れる風圧の束 + 前に張り出す衝撃の弓 + 大きな星 */
function dashPunch(frame, f) {
  const A = 4;
  const N = 8;
  const k = fadeOf(f, A, N);
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 9 + (hash1(i, 161) - 0.5) * 3;
    const len = 30 + 22 * hash1(i, 162) - Math.abs(i - 2) * 6;
    const x1 = -6 - Math.abs(i - 2) * 4 - k * 18;
    if (k < 0.9) windStreak(frame, { ax: x1 - len * (1 - k * 0.5), ay: y, bx: x1, by: y, T: (i === 2 ? 7 : 4) * (1 - k * 0.5), bright: 0.6 * (1 - k * 0.5), erosion: k * 0.7, seed: 163 + i });
  }
  if (f >= 1 && f <= 5) bowShock(frame, { x: -10, R: 18 + (f - 1) * 4, T: 6 - (f - 1) * 0.8, half: 1.05, bright: 0.72 - (f - 1) * 0.08, erosion: Math.max(0, (f - 2) * 0.2), seed: 164 });
  punchPop(frame, f - 1, { x: 6, y: 0, R: 24, n: 11, seed: 165, life: 6, width: 4.5, glint: 4, squash: 0.55, ringGrow: 7, ringW: 3.4, ringPush: 2 });
  if (f >= 2) burstDust(frame, f - 2, { x: 6, y: 0, count: 10, seed: 166, speed: 5.5, dirA: 0, spread: 2.6 });
}

// -----------------------------------------------------------------------------
// 右の段
// -----------------------------------------------------------------------------

/** 投げの軌跡の細い弧（to の側ほど明るい）。arcLine と同じだが太さを持つ */
function throwLine(frame, o) {
  const { ox, radius, from, to, width, bright } = o;
  const span = Math.max(1e-3, to - from);
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      if (Math.abs(Math.hypot(dx, y) - radius) > width / 2) return -1;
      const u = wrapAngle(Math.atan2(y, dx) - from) / span;
      if (u < 0 || u > 1) return -1;
      return bright * (0.25 + 0.75 * u);
    },
    { bounds: arcBounds(ox, 0, radius - width, radius + width, from, to), dither: 0 },
  );
}

/** 飛ばされる塊（投げた敵の位置）: 縁が暗く芯が明るい小さな玉 */
function blob(frame, x, y, r, bright, seed) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      return clamp01((1 - d * 0.7) * bright * (0.9 + 0.2 * valueNoise(px, py, 3, seed)));
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 右: 掴み投げ（heavy・box reach 10 / size 20）。掴みの小さな閃光 → 敵が自分の上を越えて背後へ飛ぶ軌跡 → 背後の着地の衝撃 */
function grabThrow(frame, f) {
  const A = 4;
  const N = 9;
  // 掴み: トゲの少ない締まった閃光（殴りの星より小さく、芯が強い）
  if (f <= 2) {
    impactStar(frame, { x: 0, y: 0, R: f === 1 ? 13 : 10, n: 4, seed: 171, width: 3.4, core: 3, dirA: Math.PI / 4, detach: f === 2 ? 0.5 : 0, bright: f === 2 ? 0.8 : 1 });
    if (f <= 1) sparkle(frame, 0, 0, f === 0 ? 2 : 3);
  }
  // 投げ: 自分（-20, 0）を中心に、当たりの位置（角 0）から +y 側を回って背後（角 π）へ。
  // 刃の三日月に見えないよう、帯ではなく「飛ばされる塊（頭の玉）」と、その後ろに引く 2 本の細い軌跡の線で描く
  const cx = -20;
  const R = 22;
  if (f >= 1 && f <= 5) {
    // 等速に近い送り（easeSwing だと終わりの 2 枚が同じ位置に止まる）
    const p = Math.min(1, (f / 4) ** 0.85);
    const head = Math.PI * p;
    const fade = f === 5 ? 0.5 : 1;
    const tail = Math.max(0, head - 1.9);
    for (const dr of [-3.5, 3.5]) throwLine(frame, { ox: cx, radius: R + dr, from: tail, to: head - 0.12, width: 1.6, bright: 0.62 * fade });
    if (f <= 4) {
      const hx = cx + Math.cos(head) * R;
      const hy = Math.sin(head) * R;
      blob(frame, hx, hy, 5.5, 0.85 * fade, 176);
    }
  }
  // 着地: 背後に叩きつけた衝撃（星 + 広い輪 + 塵）
  const land = f - 5;
  punchPop(frame, land, { x: cx - R, y: 0, R: 18, n: 9, seed: 174, life: 4, width: 4, glint: 3, squash: 1, ringGrow: 6, ringW: 3 });
  if (land >= 1) burstDust(frame, land - 1, { x: cx - R, y: 0, count: 8, seed: 175, speed: 4 });
  void A;
}

/** 右: 肘打ち（heavy・box reach 8）。短い斜めの風圧から、前へ鋭く細いトゲが伸びる星と平たい輪 */
function elbow(frame, f) {
  if (f <= 1) windStreak(frame, { ax: -14, ay: -12, bx: -2, by: -2, T: 6, bright: 0.6 * (1 - f * 0.4), seed: 181 });
  punchPop(frame, f - 1, { x: 2, y: 0, R: 22, n: 7, seed: 182, life: 4, width: 2.6, glint: 3, dirA: 0, spread: 2.3, core: 4, squash: 0.45, ringR: 9, ringGrow: 4, ringW: 2.2 });
  // 当たりの瞬間だけ全周の小さな芯を足す（前へのトゲだけだと、当たった点が抜けて見える）
  if (f === 1) impactStar(frame, { x: 2, y: 0, R: 9, n: 6, seed: 183, width: 3 });
  if (f >= 2) burstDust(frame, f - 2, { x: 2, y: 0, count: 5, seed: 184, speed: 4.5, dirA: 0, spread: 1.6 });
}

/** 右: 膝蹴り（box reach 8）。短く太い突き上げの風圧 1 本と、トゲの詰まった太い星。輪は横に平たく小さい（至近の重い一点） */
function knee(frame, f) {
  if (f <= 1) windStreak(frame, { ax: -16, ay: 0, bx: -3, by: 0, T: 9 * (1 - f * 0.4), bright: 0.62 * (1 - f * 0.4), seed: 191 });
  punchPop(frame, f - 1, { x: 0, y: 0, R: 15, n: 12, seed: 192, life: 4, width: 4.4, glint: 3, core: 4, squash: 0.5, ringR: 9, ringGrow: 4, ringW: 2.6 });
  if (f >= 2) burstDust(frame, f - 2, { x: 0, y: 0, count: 7, seed: 194, speed: 4 });
}

/** 右: 回し蹴り（arc 180° reach 22）。原点は自分。太く短い空気の帯が半周を払う。刃ではないので縁は白くしない */
function roundKick(frame, f) {
  const A = 5;
  const N = 9;
  const R = 50;
  const from = -Math.PI / 2 - 0.1;
  const sweep = Math.PI + 0.2;
  const k = fadeOf(f, A, N);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = from + sweep * (p + k * 0.06);
  const tail = f < A ? from + sweep * Math.max(0, p - 0.55) : from + sweep * Math.min(0.97, 0.45 + 0.52 * k);
  airBand(frame, { R, T: 22 * (f < A ? 0.75 + 0.25 * p : 1 - 0.45 * k), head, tail, bright: 0.6 * (1 - k * 0.35), erosion: k * 0.85, seed: 201 });
  airLines(frame, { R, head, span: head - tail, k, count: 3, seed: 202 });
  // 足の甲が当たる位置の打撃（振りの中ほど）
  const hitA = 0.1;
  if (f >= 2) punchPop(frame, f - 2, { x: Math.cos(hitA) * (R - 8), y: Math.sin(hitA) * (R - 8), R: 14, n: 8, seed: 203, life: 4, width: 3.4, glint: 3, ring: false });
  if (f >= A - 1) burstDust(frame, f - (A - 1), { x: Math.cos(head) * (R - 10), y: Math.sin(head) * (R - 10), count: 6, seed: 204, speed: 3.5, dirA: head + Math.PI / 2, spread: 1.4 });
}

/** 右: 正拳（heavy・box reach 14）。太い風圧の柱から、前へ伸びた星と前へ押し出される 3 枚の潰れた輪 */
function straightPunch(frame, f) {
  const A = 4;
  const N = 9;
  const k = fadeOf(f, A, N);
  if (k < 0.9) {
    windStreak(frame, { ax: -36 + k * 20, ay: 0, bx: -4 + k * 4, by: 0, T: 13 * (1 - k * 0.6), bright: 0.64 * (1 - k * 0.5), erosion: k * 0.8, seed: 211 });
    for (const side of [-1, 1]) windStreak(frame, { ax: -30 + k * 14, ay: side * 10, bx: -10, by: side * 9, T: 4 * (1 - k * 0.5), bright: 0.5 * (1 - k * 0.5), erosion: k * 0.7, seed: 212 + side });
  }
  punchPop(frame, f - 1, { x: 4, y: 0, R: 26, n: 10, seed: 214, life: 7, width: 4.8, glint: 4, starSquash: 1.35, squash: 0.42, ringGrow: 5, ringW: 3.4, ringPush: 5 });
  // 前へ抜ける 2 枚目の小さな輪（拳圧が当たりの先まで届く）。主の輪と離して置き、同心の渦に見せない
  if (f >= 3 && f <= 7) {
    const a = f - 3;
    ring(frame, { ox: 30 + a * 8, radius: 9 + a * 2, width: 2.2, squash: 0.42, erosion: Math.min(0.9, 0.2 + a * 0.18), bright: 0.66 - a * 0.08, seed: 216 });
  }
  if (f >= 2) burstDust(frame, f - 2, { x: 6, y: 0, count: 9, seed: 218, speed: 5.5, dirA: 0, spread: 1.8 });
}

// -----------------------------------------------------------------------------
// 派生
// -----------------------------------------------------------------------------

/** 派生: 百裂拳（box reach 12 / size 22・6 段ヒット）。当たりの範囲のあちこちで小さな衝撃が 1 フレームごとに弾ける */
const HUNDRED = [
  { x: -4, y: -9 },
  { x: 6, y: 7 },
  { x: -2, y: 4 },
  { x: 9, y: -6 },
  { x: 1, y: -2 },
  { x: 7, y: 1 },
];
function hundredFists(frame, f) {
  HUNDRED.forEach((p, i) => {
    const age = f - i;
    const last = i === HUNDRED.length - 1;
    const seed = 221 + i * 3;
    if (age === 0) fistTrail(frame, { x: p.x, y: p.y, len: 10, k: 0, seed: seed + 1, count: 2, T: 4, gap: 4 });
    punchPop(frame, age, { x: p.x, y: p.y, R: last ? 16 : 11, n: last ? 10 : 7, seed, life: last ? 5 : 3, width: last ? 3.4 : 2.8, glint: last ? 3 : 2, ring: last, ringGrow: 6, ringW: 2 });
  });
  if (f >= 6) burstDust(frame, f - 6, { x: 4, y: 0, count: 10, seed: 240, speed: 4.5 });
}

/** 派生: 昇り拳（heavy・box reach 12）。下（+y）から上（-y）へ突き上げる縦の風圧の柱、上で星が弾け、衝撃線が上へ抜ける */
function uppercut(frame, f) {
  const A = 4;
  const N = 8;
  const k = fadeOf(f, A, N);
  if (k < 0.9) {
    const top = f === 0 ? 10 : 2;
    windStreak(frame, { ax: 0, ay: 34 - k * 16, bx: 0, by: top + k * 4, T: 11 * (1 - k * 0.6), bright: 0.64 * (1 - k * 0.5), erosion: k * 0.8, seed: 251 });
    for (const side of [-1, 1]) windStreak(frame, { ax: side * 8, ay: 28 - k * 10, bx: side * 7, by: 10 + k * 4, T: 4 * (1 - k * 0.5), bright: 0.5 * (1 - k * 0.5), erosion: k * 0.7, seed: 252 + side });
  }
  punchPop(frame, f - 1, { x: 0, y: -2, R: 26, n: 9, seed: 255, life: 6, width: 4.6, glint: 4, dirA: -Math.PI / 2, spread: 2.6, core: 5, squash: 1.6, ringR: 10, ringGrow: 5, ringW: 3 });
  // 扇のトゲだけだと下側が抜けるので、当たりの瞬間は全周の小さな星も重ねる
  if (f === 1 || f === 2) impactStar(frame, { x: 0, y: -2, R: 11, n: 7, seed: 254, width: 3 });
  // 上へ抜ける衝撃線
  if (f >= 2 && f <= 6) {
    const a = f - 2;
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 7;
      const y1 = -30 - a * 9 - hash1(i, 256) * 4 + Math.abs(i - 1) * 5;
      windStreak(frame, { ax: x, ay: y1 + 18 - a * 2, bx: x, by: y1, T: (i === 1 ? 6 : 4) * (1 - a * 0.15), bright: 0.7 - a * 0.1, erosion: a * 0.2, seed: 257 + i });
    }
  }
  if (f >= 2) burstDust(frame, f - 2, { x: 0, y: -4, count: 9, seed: 260, speed: 5, dirA: -Math.PI / 2, spread: 1.8 });
}

/** 派生: 崩し突き（box reach 10）。掌底: 横に平たい星（面で押す）と、前へ大きく押し出される平たい輪 */
function breakThrust(frame, f) {
  if (f <= 1) fistTrail(frame, { x: -2, y: 0, len: 14, k: f * 0.4, seed: 261, count: 3, T: 5, gap: 5 });
  punchPop(frame, f - 1, { x: 0, y: 0, R: 22, n: 11, seed: 262, life: 5, width: 3.6, glint: 3, starSquash: 0.45, squash: 0.4, ringR: 14, ringGrow: 3, ringW: 3, ringPush: 6 });
  if (f >= 2) burstDust(frame, f - 2, { x: 2, y: 0, count: 6, seed: 264, speed: 4.5, dirA: 0, spread: 1.2 });
}

/** 派生: 二段蹴り（arc 150° reach 20・2 段ヒット）。原点は自分。低い 1 本目の帯が消えかけたところで、外側を 2 本目の帯が払う */
function doubleKick(frame, f) {
  const kicks = [
    { start: 0, R: 40, T: 16, from: -88 * DEG, to: -4 * DEG, seed: 271 },
    { start: 2, R: 44, T: 18, from: 4 * DEG, to: 88 * DEG, seed: 274 },
  ];
  for (const kk of kicks) {
    const t = f - kk.start;
    if (t < 0) continue;
    const act = 3;
    const life = 4;
    const k = t < act ? 0 : (t - act + 1) / (life + 1);
    if (k >= 1) continue;
    const p = t < act ? easeSwing((t + 1) / act) : 1;
    const sweep = kk.to - kk.from;
    const head = kk.from + sweep * (p + k * 0.05);
    const tail = t < act ? kk.from + sweep * Math.max(0, p - 0.6) : kk.from + sweep * Math.min(0.97, 0.4 + 0.57 * k);
    airBand(frame, { R: kk.R, T: kk.T * (1 - 0.45 * k), head, tail, bright: 0.6 * (1 - k * 0.35), erosion: k * 0.9, seed: kk.seed });
    airLines(frame, { R: kk.R, head, span: head - tail, k, count: 2, seed: kk.seed + 1 });
    if (t >= 1) punchPop(frame, t - 1, { x: Math.cos(head) * (kk.R - 7), y: Math.sin(head) * (kk.R - 7), R: 12, n: 8, seed: kk.seed + 2, life: 3, width: 3, glint: 3, ring: false });
  }
}

/** 派生: 連ね打ち（box reach 10・4 段ヒット）。左右の拳が交互に、前へ一歩ずつ詰めながら弾ける */
const CHAIN = [
  { x: -8, y: -5, R: 11 },
  { x: -2, y: 5, R: 12 },
  { x: 4, y: -4, R: 13 },
  { x: 10, y: 3, R: 16 },
];
function chainFists(frame, f) {
  CHAIN.forEach((p, i) => {
    const age = f - i;
    const seed = 281 + i * 4;
    if (age === 0 || age === 1) fistTrail(frame, { x: p.x, y: p.y, len: 18, k: age * 0.5, seed: seed + 1, count: 1, T: 4 });
    punchPop(frame, age, { ...p, n: i === 3 ? 10 : 8, seed, life: i === 3 ? 5 : 3, width: 3, glint: i === 3 ? 3 : 2, ring: i === 3, squash: 0.6, ringGrow: 4, ringW: 2 });
  });
  if (f >= 4) burstDust(frame, f - 4, { x: 10, y: 3, count: 7, seed: 300, speed: 4.5, dirA: 0, spread: 2 });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 打撃の星形の閃光 + 飛び散る衝撃線（前に多め）。heavy は大きな輪と太い放射線 */
function hit(frame, f, heavy) {
  const life = heavy ? 6 : 5;
  const R = heavy ? 30 : 18;
  punchPop(frame, f, {
    x: 0,
    y: 0,
    R,
    n: heavy ? 12 : 9,
    seed: heavy ? 311 : 321,
    life,
    width: heavy ? 6 : 3.4,
    glint: heavy ? 4 : 3,
    core: heavy ? 6 : 4,
    squash: 0.85,
   
    ringGrow: heavy ? 8 : 5,
    ringW: heavy ? 4 : 2.2,
  });
  if (f >= 1) burstDust(frame, f - 1, { count: heavy ? 12 : 6, seed: heavy ? 314 : 324, speed: heavy ? 6 : 4, dirA: 0, spread: heavy ? TAU : 3 });
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * box は当たりの中心（anchor = 自分から reach 先）に置く: 拳は「当たった所で弾ける」絵なので。蹴り（arc）は自分を中心に振る
 */
const FX = {
  moveset: "fists",
  motions: {
    "l:0": { sheet: "fists.jab", pivot: "anchor", base: 10, measure: "reach" },
    "l:1": { sheet: "fists.cross", pivot: "anchor", base: 10, measure: "reach" },
    "l:2": { sheet: "fists.hook", pivot: "anchor", base: 10, measure: "reach" },
    "l:3": { sheet: "fists.rush", pivot: "anchor", base: 10, measure: "reach" },
    "l:4": { sheet: "fists.finisher", pivot: "anchor", base: 12, measure: "reach" },
    dash: { sheet: "fists.dash", pivot: "anchor", base: 12, measure: "reach" },
    "r:grabThrow": { sheet: "fists.grab", pivot: "anchor", base: 10, measure: "reach" },
    "r:elbow": { sheet: "fists.elbow", pivot: "anchor", base: 8, measure: "reach" },
    "r:knee": { sheet: "fists.knee", pivot: "anchor", base: 8, measure: "reach" },
    "r:roundKick": { sheet: "fists.roundKick", pivot: "self", base: 22, measure: "reach" },
    "r:straightPunch": { sheet: "fists.straight", pivot: "anchor", base: 14, measure: "reach" },
    "branch:hundredFists": { sheet: "fists.hundred", pivot: "anchor", base: 12, measure: "reach" },
    "branch:uppercut": { sheet: "fists.uppercut", pivot: "anchor", base: 12, measure: "reach" },
    "branch:breakThrust": { sheet: "fists.breakThrust", pivot: "anchor", base: 10, measure: "reach" },
    "branch:doubleKick": { sheet: "fists.doubleKick", pivot: "self", base: 20, measure: "reach" },
    "branch:chainFists": { sheet: "fists.chain", pivot: "anchor", base: 10, measure: "reach" },
  },
  hit: "fists.hit",
  hitHeavy: "fists.hitHeavy",
};

export const ATLAS = {
  key: "fists",
  fx: FX,
  sheets: [
    { key: "fists.jab", dirs: DIRS, frames: 7, active: 3, size: 96, draw: jab },
    { key: "fists.cross", dirs: DIRS, frames: 7, active: 3, size: 96, draw: cross },
    { key: "fists.hook", dirs: DIRS, frames: 7, active: 3, size: 96, draw: hook },
    { key: "fists.rush", dirs: DIRS, frames: 8, active: 4, size: 80, draw: rush3 },
    { key: "fists.finisher", dirs: DIRS, frames: 9, active: 4, size: 128, draw: finisher },
    { key: "fists.dash", dirs: DIRS, frames: 8, active: 4, size: 128, draw: dashPunch },
    { key: "fists.grab", dirs: DIRS, frames: 9, active: 4, size: 136, draw: grabThrow },
    { key: "fists.elbow", dirs: DIRS, frames: 6, active: 3, size: 80, draw: elbow },
    { key: "fists.knee", dirs: DIRS, frames: 6, active: 3, size: 80, draw: knee },
    { key: "fists.roundKick", dirs: DIRS, frames: 9, active: 5, size: 128, draw: roundKick },
    { key: "fists.straight", dirs: DIRS, frames: 9, active: 4, size: 128, draw: straightPunch },
    { key: "fists.hundred", dirs: DIRS, frames: 10, active: 6, size: 80, draw: hundredFists },
    { key: "fists.uppercut", dirs: DIRS, frames: 8, active: 4, size: 112, draw: uppercut },
    { key: "fists.breakThrust", dirs: DIRS, frames: 7, active: 3, size: 96, draw: breakThrust },
    { key: "fists.doubleKick", dirs: DIRS, frames: 9, active: 5, size: 120, draw: doubleKick },
    { key: "fists.chain", dirs: DIRS, frames: 8, active: 4, size: 96, draw: chainFists },
    { key: "fists.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "fists.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
