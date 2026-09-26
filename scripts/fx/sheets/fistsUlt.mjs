// 拳（moveset "fists"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は fists.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/fists.json × 2 が目安
//
// 拳は斬撃ではなく打撃。通常の振りと同じ部品（衝撃の星・潰れた衝撃波の輪・風圧の線・衝撃の弓）を、奥義では大きく・長く・段を多くして使う。
// 奥義だけの部品として、地面の割れ（crack）・気の波（shockBand）・闘気の輪郭（spiritFlame）を足す。
// 決まり（fists.mjs と同じ）:
// - 風圧・気は刃ではないので縁を白くしない。白（段 7）は衝撃の芯の閃光と光点だけ
// - 1 回の打撃の衝撃波は 1 枚（同心の輪を重ねて渦に見せない。押し出す輪は位置を離す）
// - 振り終わりは崩れて消える（erosion・離れて飛ぶトゲ・粒）
// 部品は fists.mjs から写した（他の武器種のファイルは import しない決まりなので、同じ形をここに持つ）
import { ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 部品（fists.mjs から写したもの）
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

// -----------------------------------------------------------------------------
// 奥義の部品
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット。原点は体の中心） */
const FEET_Y = 18;

/** 地割れの 1 本の節の数（多いほど細かくギザギザ） */
const CRACK_STEPS = 7;

/**
 * 地割れの折れ線の点列。(x0, y0) から角 a へ長さ len、節ごとにハッシュで曲がる。
 * 枝（branch）は途中の節から横へ短く分かれる（放射線が揃って「車輪」に見えないように）
 */
function crackPoints(x0, y0, a, len, seed) {
  const pts = [{ x: x0, y: y0, d: 0 }];
  let x = x0;
  let y = y0;
  let ang = a;
  const step = len / CRACK_STEPS;
  for (let i = 1; i <= CRACK_STEPS; i++) {
    // 元の向きへ引き戻しながら曲げる（ぐるりと回り込まない）
    ang = a + (ang - a) * 0.4 + (hash1(i, seed) - 0.5) * 0.9;
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    pts.push({ x, y, d: i * step });
  }
  return pts;
}

/** 折れ線を reveal（0..len）まで塗る。根元が太く先へ細る。squash で上下に潰す（地面の奥行き） */
function drawCrack(frame, pts, o) {
  const reveal = o.reveal;
  const len = pts[pts.length - 1]?.d ?? 1;
  const w0 = o.width ?? 2.6;
  const bright = o.bright ?? 0.5;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const sq = o.squash ?? 1;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (!p || !q || p.d >= reveal) break;
    const t = Math.min(1, (reveal - p.d) / (q.d - p.d));
    const ax = p.x;
    const ay = p.y * sq;
    const bx = p.x + (q.x - p.x) * t;
    const by = (p.y + (q.y - p.y) * t) * sq;
    const pad = w0 + 2;
    paint(
      frame,
      (x, y) => {
        const s = segment(x, y, ax, ay, bx, by);
        const d = p.d + (q.d - p.d) * t * s.t;
        const u = d / len;
        const w = Math.max(0.9, w0 * (1 - 0.7 * u));
        if (s.d > w / 2) return -1;
        if (!survives(x, y, erosion, 1 - u, seed + i)) return -1;
        // 割れの口（根元）ほど明るい: 下から気が漏れる
        return clamp01(bright * (1 - 0.45 * u) * (1 - erosion * 0.4));
      },
      { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0 },
    );
  }
}

/** 放射状の地割れ一式。n 本の本線（角・長さをばらす）と、半分ほどに短い枝 */
function crackStar(frame, o) {
  const { x = 0, y = 0, n, len, reveal, seed } = o;
  const dirA = o.dirA ?? 0;
  const spread = o.spread ?? TAU;
  for (let i = 0; i < n; i++) {
    const a = spread >= TAU ? dirA + ((i + (hash1(i, seed) - 0.5) * 0.6) / n) * TAU : dirA + (i / Math.max(1, n - 1) - 0.5) * spread + (hash1(i, seed) - 0.5) * 0.3;
    const l = len * (0.6 + 0.4 * hash1(i, seed + 1));
    // r0: 窪みの輪の外から割る（輪の中まで割ると照準の十字に見える）
    const r0 = o.r0 ?? 0;
    const pts = crackPoints(x + Math.cos(a) * r0, y + Math.sin(a) * r0, a, l, seed + i * 17);
    drawCrack(frame, pts, { ...o, reveal: reveal * l, seed: seed + i });
    // 枝: 本線の 3〜4 節目から横へ
    if (hash1(i, seed + 2) < 0.35) continue;
    const at = pts[3 + (hash1(i, seed + 3) > 0.5 ? 1 : 0)];
    if (!at) continue;
    const side = hash1(i, seed + 4) > 0.5 ? 1 : -1;
    const bl = l * 0.38;
    const bPts = crackPoints(at.x, at.y, a + side * 0.75, bl, seed + i * 31);
    drawCrack(frame, bPts, { ...o, reveal: Math.max(0, reveal * l - at.d), width: (o.width ?? 2.6) * 0.6, seed: seed + i + 50 });
  }
}

/**
 * 気の波（周囲攻撃の衝撃波の帯）。外縁の半径 R、内へ厚み T。外縁（押す側）ほど明るく内へ薄れる。
 * 外縁は角のノイズで少しうねる（揃った円にせず、空気の塊が押し出される感じ）。刃ではないので白くしない（段 6 まで）
 */
function shockBand(frame, o) {
  const { R, T } = o;
  const bright = o.bright ?? 0.75;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const wobble = o.wobble ?? 3;
  const pad = R + wobble + 2;
  const inner = Math.max(0, R - T - wobble - 1);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > pad || r < inner) return -1;
      const a = Math.atan2(y, x);
      // 角のうねり: 周期の揃ったノイズ（sin の和）で、継ぎ目（±π）を出さない
      const wv = Math.sin(a * 7 + hash1(1, seed) * TAU) * 0.55 + Math.sin(a * 13 + hash1(2, seed) * TAU) * 0.45;
      const outer = R + wv * wobble;
      const d = outer - r;
      if (d < 0 || d > T) return -1;
      const q = d / T;
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      // 外縁の 2 ドットは明るく締める（面の輪郭をくっきり）、内側はなだらかに薄れる。
      // 内側は角ごとに明るさをばらした放射の筋目を入れる（外へ吹き抜ける気の流れ。同心の縞を作らない）
      const streak = 0.7 + 0.45 * hash1(Math.floor(((a + Math.PI) / TAU) * 72), seed + 3);
      const edge = d < 2 ? 1 : 0.85 * (1 - q) ** 1.2 * streak;
      return Math.min(0.78, clamp01(edge * bright * (1 - erosion * 0.4)));
    },
    { bounds: { x0: -pad, y0: -pad, x1: pad, y1: pad }, dither: 0.1 },
  );
}

// -----------------------------------------------------------------------------
// 発勁（nova 半径 44）: 足元から気の波が一気に広がって周りを押し飛ばし、地面が放射状に割れる
// dirs 1（向きのない周囲攻撃）
// -----------------------------------------------------------------------------

/** 発勁の当たりの半径（44 論理 px × 2） */
const HAKKEI_R = 88;
const HAKKEI_N = 11;
const HAKKEI_A = 4;

/** 気の波の外縁の半径（フレームごと。active で当たりの縁まで、崩れで少し先へ） */
function hakkeiWaveR(f) {
  if (f < HAKKEI_A) return 26 + (HAKKEI_R - 26) * ((f + 1) / HAKKEI_A) ** 0.85;
  return HAKKEI_R + (f - HAKKEI_A + 1) * 4;
}

function hakkeiBurst(frame, f) {
  const A = HAKKEI_A;
  const k = fadeOf(f, A, HAKKEI_N);
  const R = hakkeiWaveR(f);
  // 1) 掌の芯の爆ぜ: 大きな衝撃の星。弾けた後はトゲが離れて外へ飛ぶ（輪は気の波が担うので出さない）
  punchPop(frame, f, { R: 30, n: 13, seed: 1501, life: 4, width: 6, glint: 4, ring: false, core: 9 });
  // 2) 気の波（1 枚）: 厚い帯が外へ。崩れで薄く痩せて欠ける
  const T = f < A ? 12 + 8 * ((f + 1) / A) : 20 * (1 - 0.6 * k);
  shockBand(frame, { R, T, bright: f < A ? 0.72 + 0.06 * f : 0.78 - 0.35 * k, erosion: f < A ? 0 : 0.08 + 0.85 * k ** 1.1, seed: 1502, wobble: 1.2 + f * 0.25 });
  // 3) 波が巻き上げる塵: 波の縁に乗って外へ（棘のような筋は王冠・時計の目盛りに見えたので、粒だけにする）
  if (f >= 1 && f < A) {
    for (let i = 0; i < 26; i++) {
      const a = hash1(i, 1503) * TAU;
      const r = R + 1 + hash1(i, 1504) * 6 - (f % 2) * hash1(i, 1505) * 3;
      const lv = hash1(i, 1506) > 0.5 ? 5 : 4;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, lv);
      if (hash1(i, 1507) > 0.5) dot(frame, Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), lv - 1);
    }
  }
  // 4) 当たりの縁に届いた瞬間の光点（ばらけた 5 か所。揃えると時計の文字盤に見える）
  if (f === A - 1 || f === A) {
    for (let i = 0; i < 5; i++) {
      const a = ((i + hash1(i, 1508) * 0.8) / 5) * TAU;
      sparkle(frame, Math.cos(a) * (R - 3), Math.sin(a) * (R - 3), f === A - 1 ? 3 : 2);
    }
  }
  // 5) 押し飛ばされる塵: 波の縁から外へ
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 40, 1509, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = HAKKEI_R - 10 * rnd(2);
      const sp = 3 + rnd(3) * 5;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.82 };
    });
  }
}

/** 発勁の地面: 足元の窪みの輪と、気の波を追って走る放射状の地割れ。波が抜けたあとも少し残って薄れる */
function hakkeiGround(frame, f) {
  const A = HAKKEI_A;
  const k = fadeOf(f, A, HAKKEI_N);
  const R = Math.min(HAKKEI_R - 8, hakkeiWaveR(f) - 6);
  const erosion = f < A + 2 ? 0 : (f - A - 1) / (HAKKEI_N - A - 1);
  // 足元の窪み（踏み込んだ跡）
  ring(frame, { radius: 12 + Math.min(1, f / 2) * 4, width: 3, erosion: Math.min(0.92, erosion * 0.9), bright: 0.5 * (1 - k * 0.4), seed: 1511 });
  crackStar(frame, { n: 9, r0: 15, len: HAKKEI_R - 18, reveal: Math.min(1, (R - 15) / (HAKKEI_R - 18)), seed: 1512, width: 3, bright: 0.44 * (1 - k * 0.3), erosion: Math.min(0.95, erosion) });
}

/** 発勁の発動: 腰を沈めて気を練る。足元の潰れた輪が締まり、周りの気の粒が渦を巻いて掌（中心）へ集まり、満ちて小さく弾ける */
function hakkeiCast(frame, f) {
  const N = 8;
  const gather = 5;
  if (f < gather) {
    const p = (f + 1) / gather;
    ring(frame, { oy: FEET_Y, radius: 22 - 12 * p, width: 2.4, squash: 2.2, bright: 0.45 + 0.3 * p, seed: 1521 });
    // 渦を巻いて集まる気の筋: 前の位置から今の位置への短い線（渦の向きの尾）。集まるほど明るく
    for (let i = 0; i < 20; i++) {
      const a0 = hash1(i, 1522) * TAU;
      const r0 = 36 + 22 * hash1(i, 1523);
      const at = (pp) => {
        const r = r0 * (1 - pp * 0.8);
        const a = a0 + pp * 1.8;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 };
      };
      const cur = at(p);
      const prev = at(Math.max(0, p - 0.3));
      streakLine(frame, { ax: prev.x, ay: prev.y, bx: cur.x, by: cur.y, width: hash1(i, 1524) > 0.5 ? 1.8 : 1.2, bright: 0.35 + 0.35 * p });
    }
    // 掌の前で練られる気の玉（締まる小さな輪）
    if (f >= 2) ring(frame, { radius: 12 - (f - 2) * 2.5, width: 2, bright: 0.55 + 0.1 * f, seed: 1527 });
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather) / (N - gather - 1 || 1);
  impactStar(frame, { R: 20 + k * 8, n: 9, seed: 1525, width: 3.6, detach: Math.min(0.95, 0.2 + k * 0.7), bright: 0.9 - k * 0.3 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  ring(frame, { oy: FEET_Y, radius: 10 + k * 14, width: 2.2, squash: 2.2, erosion: Math.min(0.9, 0.2 + k * 0.7), bright: 0.7 - k * 0.3, seed: 1526 });
}

// -----------------------------------------------------------------------------
// 崩拳（lunge 48・止めに thrust 幅 30・heavy）: 踏み込みの風圧の束が通り道を走り、終点で巨大な星が弾けて衝撃波が前へ押し出される
// 原点 = 突進の始点、+x = 照準。base = 進んだ距離
// -----------------------------------------------------------------------------

/** 突進の長さ（48 論理 px × 2） */
const HOKEN_L = 96;
/** 止めの一撃の当たりの半分の幅（size 30 論理 px） */
const HOKEN_HALF = 30;
const HOKEN_N = 10;
const HOKEN_A = 4;

function collapseStrike(frame, f) {
  const A = HOKEN_A;
  const L = HOKEN_L;
  const k = fadeOf(f, A, HOKEN_N);
  // 1) 踏み込みの風圧の束: 始点から体の位置（front）まで、中央の太い 1 本と両脇の細い筋。崩れで前へ流れて痩せる
  const front = f === 0 ? L * 0.55 : L;
  if (k < 0.9) {
    const lanes = [0, -9, 9, -17, 17];
    lanes.forEach((y, i) => {
      const main = i === 0;
      const x1 = front - 12 - Math.abs(y) * 0.6 + k * 16;
      const x0 = Math.max(-10, x1 - (main ? L + 4 : L * (0.55 + 0.3 * hash1(i, 1601))) * (1 - k * 0.6));
      windStreak(frame, { ax: x0, ay: y, bx: x1, by: y, T: (main ? 12 : 5) * (1 - k * 0.5), bright: (main ? 0.66 : 0.52) * (1 - k * 0.5), erosion: k * 0.75, seed: 1602 + i });
    });
  }
  // 2) 拳の前に張り出す衝撃の弓（音の壁）: 踏み込みの間だけ。当たってからは星と輪に任せる（重ねると二重の弧に見える）
  if (f <= 1) bowShock(frame, { x: front - 34, R: 26 + f * 4, T: 8, half: 1.05, bright: 0.72, seed: 1606 });
  // 3) 止めの一撃: 大きな星（前へ伸びる）と、前へ押し出される平たい衝撃波
  punchPop(frame, f - 1, { x: L + 6, y: 0, R: 44, n: 14, seed: 1607, life: 8, width: 7.5, glint: 4, starSquash: 1.3, squash: 0.45, ringGrow: 9, ringW: 4.6, ringPush: 5, core: 11 });
  // 3b) 打ち抜く勁: 当たりの先へ扇に抜ける太い風圧の束（敵の体を貫いて壁まで届く力）。星のトゲより太く長く、前だけ
  if (f >= 2 && f <= 6) {
    const a = f - 2;
    const g = a / 4;
    for (let i = 0; i < 7; i++) {
      const ang = (i / 6 - 0.5) * 1.1 + (hash1(i, 1612) - 0.5) * 0.12;
      const r0 = 20 + a * 12;
      const l = (40 + 34 * hash1(i, 1613)) * (1 - Math.abs(ang) * 0.6) * (1 - g * 0.5);
      const x0 = L + 6 + Math.cos(ang) * r0;
      const y0 = Math.sin(ang) * r0;
      windStreak(frame, { ax: x0, ay: y0, bx: x0 + Math.cos(ang) * l, by: y0 + Math.sin(ang) * l, T: (i === 3 ? 9 : 5 + 2 * hash1(i, 1614)) * (1 - g * 0.4), bright: 0.66 * (1 - g * 0.5), erosion: g * 0.8, seed: 1615 + i });
    }
  }
  // 4) 壁へ叩きつける圧: 当たりの先へ離れて飛ぶ平たい輪 2 枚（主の輪とは位置を離し、同心の渦にしない）
  for (let j = 0; j < 2; j++) {
    const a = f - 3 - j * 2;
    if (a < 0 || a > 4) continue;
    ring(frame, { ox: L + 40 + j * 16 + a * 9, radius: 22 - j * 5 + a * 3, width: 3 - j * 0.5, squash: 0.36, erosion: Math.min(0.9, 0.15 + a * 0.2), bright: 0.68 - a * 0.08 - j * 0.06, seed: 1608 + j });
  }
  // 5) 前へ吹き飛ぶ塵と、当たりの幅の縁から横へ散る粒
  if (f >= 2) burstDust(frame, f - 2, { x: L + 8, y: 0, count: 18, seed: 1610, speed: 7, dirA: 0, spread: 2.2 });
  if (f >= 2) {
    shards(frame, f - 2, 10, 1611, (i, rnd) => {
      const side = rnd(1) > 0.5 ? 1 : -1;
      const sp = 2.5 + rnd(2) * 3;
      return { x: L - 10 + rnd(3) * 20, y: side * HOKEN_HALF * 0.6, vx: sp * 0.6, vy: side * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
}

/** 崩拳の地面: 通り道を擦った 2 本の足跡の筋と、終点の震脚（踏み込みの足）の割れ。前へ開いた扇に割れる */
function collapseGround(frame, f) {
  const L = HOKEN_L;
  const k = fadeOf(f, HOKEN_A, HOKEN_N);
  const erosion = k * 0.95;
  // 擦った跡（地面の低い段）
  const reach = f === 0 ? L * 0.5 : L - 18;
  for (const y of [-7, 7]) {
    paint(
      frame,
      (x, py) => {
        if (x < 4 || x > reach || Math.abs(py - y) > 1) return -1;
        if (!survives(x, py, erosion, 0.3, 1621)) return -1;
        return 0.3 * (0.5 + 0.5 * (x / L)) * (1 - erosion * 0.4);
      },
      { bounds: { x0: 0, y0: y - 3, x1: reach + 2, y1: y + 3 }, dither: 0 },
    );
  }
  if (f < 1) return;
  // 震脚の割れ: 足の位置から全周に短く、前へ長く
  const reveal = Math.min(1, f / 3);
  ring(frame, { ox: L - 10, radius: 7 + Math.min(1, f / 2) * 3, width: 2.6, squash: 0.8, erosion: Math.min(0.9, erosion), bright: 0.5, seed: 1622 });
  crackStar(frame, { x: L - 10, r0: 10, n: 7, len: 30, reveal, seed: 1623, width: 2.6, bright: 0.5, erosion });
  crackStar(frame, { x: L - 10, r0: 10, n: 3, len: 48, reveal, dirA: 0, spread: 1.1, seed: 1624, width: 2.8, bright: 0.52, erosion });
}

/** 崩拳の発動: 後ろ足で地を蹴る（後ろへ潰れた輪と砂）と、腰に溜めた拳の前の短い気の閃き */
function collapseCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  ring(frame, { ox: -10 - f * 2, radius: 8 + f * 4, width: 3 - k * 1.4, squash: 0.5, erosion: Math.min(0.9, k * 0.95), bright: 0.78 - k * 0.3, seed: 1631 });
  if (f <= 3) {
    // 溜めた拳の前へ細く伸びる気（前へ尖る扇の星）
    impactStar(frame, { x: 10, R: 14 + f * 5, n: 5, seed: 1632, width: 3.4, spread: 1.0, dirA: 0, detach: f < 2 ? 0 : 0.4 + (f - 2) * 0.3, bright: 0.9 - f * 0.1, core: 4 });
    if (f === 1) sparkle(frame, 10, 0, 3);
  }
  // 蹴った砂: 後ろへ扇に
  shards(frame, f, 12, 1633, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.5;
    const sp = 3 + rnd(2) * 4;
    return { x: -10, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.6 ? 2 : 1, drag: 0.8 };
  });
  // 後ろへ流れる短い風圧
  if (k < 0.8) {
    for (let i = 0; i < 4; i++) {
      const y = (i - 1.5) * 7;
      const x0 = -14 - f * 5 - hash1(i, 1634) * 6;
      windStreak(frame, { ax: x0, ay: y, bx: x0 - 16 - hash1(i, 1635) * 10, by: y, T: 4, bright: 0.5 * (1 - k), seed: 1636 + i });
    }
  }
}

// -----------------------------------------------------------------------------
// 闘気開放（持続）: 気合いで闘気が爆ぜ、持続中は体の輪郭を炎の形の闘気が縁取って燃え続ける。拳の周りで小さな衝撃が爆ぜる
// dirs 1（画面に揃える）: 燃え上がる向きは向きによらず画面の上
// -----------------------------------------------------------------------------

/** 闘気の明るさの上限（白は光点と拳の爆ぜだけ） */
const SPIRIT_CAP = 0.78;
/** 闘気の輪郭の中心（体の中心より少し下。上へ燃え上がるので） */
const SPIRIT_CY = 2;

/**
 * 闘気の輪郭（体を囲む炎の帯）。rx / ry = 体を包む楕円の半径、T = 帯の厚み、rise = 上側の炎の舌の伸び。
 * 中は空ける（キャラを覆わない）。舌は上ほど長く、cycle（0..1）で上へ流れる（整数の周期なので 1 巡で継ぎ目が出ない）。
 * 外縁が明るく内へ薄れる: 刃のように縁の 1 本線にはせず、段 4〜6 の厚い帯
 */
function spiritFlame(frame, o) {
  const { rx, ry, T, rise, cycle } = o;
  const cy = o.cy ?? SPIRIT_CY;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const top = ry + rise + T;
  paint(
    frame,
    (x, y) => {
      const dx = x / rx;
      const dy = (y - cy) / ry;
      const rn = Math.hypot(dx, dy);
      if (rn < 0.55) return -1;
      const a = Math.atan2(dy, dx);
      // 上向きの度合い（真上 1、横 0、下は 0）
      const up = Math.max(0, -Math.sin(a));
      // 炎の舌: 角の周波数を上ほど高くし、時間で上へ流す
      const flick = (0.5 + 0.5 * Math.sin(a * 9 + cycle * TAU * 2 + hash1(1, seed) * TAU)) ** 2.2;
      const flick2 = (0.5 + 0.5 * Math.sin(a * 15 - cycle * TAU * 3 + hash1(2, seed) * TAU)) ** 1.6;
      // 舌は尖らせる（べき乗で山を細く）。上ほど長く、横にも短い舌を残す
      const tongue = (0.15 + 0.85 * up ** 1.2) * rise * (0.2 + 0.55 * flick + 0.35 * flick2);
      // 帯の外縁（体の楕円 + 舌）と内縁（外縁 - 厚み）を、楕円の法線方向のドットで測る
      const scale = Math.hypot(Math.cos(a) * rx, Math.sin(a) * ry);
      const rDots = rn * scale;
      const outer = scale + T * 0.4 + tongue;
      const thick = T * (0.7 + 0.5 * up) + tongue * 0.5;
      const d = outer - rDots;
      if (d < 0 || d > thick) return -1;
      const q = d / thick;
      // 舌の先ほどちぎれやすい（上へ揺らめいて途切れる）
      const tip = tongue > 0 ? Math.max(0, 1 - d / Math.max(1, tongue)) * up : 0;
      if (!survives(x, y + cycle * 40, erosion + tip * 0.35, 1 - q, seed)) return -1;
      // 下半分（足元の側）は薄く: 地面に沈む
      const down = Math.max(0, Math.sin(a));
      // 足元は開ける（闘気は地面から立ちのぼる。閉じた卵の殻に見せない）
      if (down > 0.9) return -1;
      const low = 1 - 0.6 * down ** 1.5;
      const v = (q < 0.18 ? 1 : 0.9 * (1 - q) ** 0.9 + 0.1) * low * bright;
      return Math.min(SPIRIT_CAP, clamp01(v * (1 - erosion * 0.4)));
    },
    { bounds: { x0: -rx - T - 2, y0: cy - top - 2, x1: rx + T + 2, y1: cy + ry + T + 2 } },
  );
}

/** 千切れて昇る闘気のかけら: 上へ尖る涙形（下が丸く、上が細い炎の先）。(x, y) が下端 */
function flameBit(frame, x0, y0, h, w, bright, seed) {
  if (h < 2 || w < 1) return;
  paint(
    frame,
    (x, y) => {
      const t = (y0 - y) / h;
      if (t < 0 || t > 1) return -1;
      const half = (w / 2) * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9)) ** 0.6 * (1 - t) ** 0.8;
      const d = Math.abs(x - x0);
      if (half < 0.5 || d > half) return -1;
      const q = d / half;
      return Math.min(SPIRIT_CAP, clamp01(((1 - q) ** 0.7 * 0.6 + 0.4 * (1 - t)) * bright * (0.9 + 0.2 * hash1(Math.floor(y), seed))));
    },
    { bounds: { x0: x0 - w, y0: y0 - h - 1, x1: x0 + w, y1: y0 + 1 } },
  );
}

/** 闘気開放の発動: 気合いの爆ぜ（大きな星と外へ広がる輪）と、大きく燃え上がった闘気が体の輪郭まで締まる */
function spiritCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 気合いの爆ぜ: 全周の大きな星が弾け、トゲが離れて飛ぶ
  punchPop(frame, f, { R: 36, n: 14, seed: 1701, life: 6, width: 6, glint: 4, ring: false, core: 10 });
  // 足元から地面を走る衝撃の輪（潰れた 1 枚。立体の輪を足すと地球儀の針金に見えたので地面だけ）
  ring(frame, { oy: FEET_Y, radius: 8 + f * 6, width: 3.2 - k * 1.6, squash: 2.4, erosion: Math.min(0.92, 0.05 + k * 0.95), bright: 0.8 - k * 0.3, seed: 1703 });
  // 闘気: 大きく燃え上がり（舌が長い）、締まって纏いの大きさへ
  if (f >= 1) {
    const p = Math.min(1, (f - 1) / (N - 3));
    spiritFlame(frame, { rx: 30 - 10 * p, ry: 30 - 6 * p, T: 12 - 4 * p, rise: 50 - 30 * p, cycle: f / 6, bright: 1 - 0.15 * p, erosion: p > 0.7 ? (p - 0.7) * 1.2 : 0, seed: 1704 });
  }
  // 吹き上がる石くれ
  shards(frame, f, 14, 1705, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 70;
    return { x, y: FEET_Y + 2, vx: x * 0.05, vy: -(4 + rnd(2) * 6), life: 5 + Math.floor(rnd(3) * 4), size: rnd(4) > 0.4 ? 2 : 1, drag: 0.88 };
  });
}

/** 闘気の纏いの 1 巡のフレーム数 */
const SPIRIT_N = 12;
/** 拳の爆ぜの位置（体の左右の手元）と、爆ぜるフレーム */
const SPIRIT_POPS = [
  { x: -21, y: 0, f: 2, seed: 1721 },
  { x: 21, y: -2, f: 8, seed: 1722 },
];

/** 闘気開放の纏い（持続中ずっと。period 秒で 1 巡）: 輪郭の炎 + 上へ流れる火の粉 + 拳の周りで爆ぜる小さな衝撃 */
function spiritSustain(frame, f) {
  const cycle = f / SPIRIT_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU * 2);
  spiritFlame(frame, { rx: 20 + pulse, ry: 24, T: 7, rise: 18 + 4 * pulse, cycle, bright: 0.92, seed: 1711 });
  // 千切れて昇るかけら: 頭の上の舌の先から離れ、昇りながら痩せて消える（位相で 1 巡）
  for (let i = 0; i < 3; i++) {
    const t = (cycle + i / 3 + hash1(i, 1715) * 0.1) % 1;
    const x = (hash1(i, 1716) - 0.5) * 22 + Math.sin(t * TAU + i) * 2;
    const y = -30 - t * 26;
    flameBit(frame, x, y, 10 * (1 - t * 0.6), 7 * (1 - t * 0.7), 0.85 * (1 - t * 0.5), 1717 + i);
  }
  // 上へ流れる火の粉（位相で上へ、1 巡で元へ戻る）
  for (let i = 0; i < 12; i++) {
    const t = (cycle + hash1(i, 1712)) % 1;
    const x = (hash1(i, 1713) - 0.5) * 56 + Math.sin(t * TAU + i) * 2;
    const y = FEET_Y - 6 - t * 70;
    if (Math.abs(x) < 12 && y > -26) continue;
    const level = Math.max(2, Math.round(2 + 3.5 * Math.sin(Math.PI * t)));
    dot(frame, x, y, Math.min(5, level));
    if (hash1(i, 1714) > 0.6) dot(frame, x, y + 1, Math.max(2, level - 1));
  }
  // 拳の爆ぜ: 1 巡に 2 回、左右の手元で小さな星が弾けて離れる（振りが重い一撃になっている合図）
  for (const p of SPIRIT_POPS) {
    const age = (f - p.f + SPIRIT_N) % SPIRIT_N;
    if (age > 3) continue;
    impactStar(frame, { x: p.x, y: p.y, R: 12, n: 8, seed: p.seed, width: 3, detach: age === 0 ? 0 : Math.min(0.95, 0.35 + age * 0.2), bright: age === 0 ? 1 : 0.85 - age * 0.12, core: 3 });
    if (age === 0) sparkle(frame, p.x, p.y, 2);
  }
}

/** 纏いの地面: 足元の脈打つ潰れた輪と、闘気で浮き上がる小石（上がって落ちるを 1 巡で繰り返す）、足元の短い割れ */
function spiritSustainGround(frame, f) {
  const cycle = f / SPIRIT_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 13 + pulse * 1.5, width: 2, squash: 2.2, bright: 0.38 + 0.14 * pulse, seed: 1731 });
  crackStar(frame, { y: FEET_Y / 0.45, n: 5, len: 30, reveal: 1, seed: 1732, width: 2.2, bright: 0.34, squash: 0.45 });
  for (let i = 0; i < 7; i++) {
    const t = (cycle + hash1(i, 1733)) % 1;
    const a = hash1(i, 1734) * TAU;
    const gx = Math.cos(a) * (22 + 10 * hash1(i, 1735));
    const gy = FEET_Y + Math.sin(a) * 9;
    const lift = Math.sin(Math.PI * t) * (8 + 8 * hash1(i, 1736));
    const lv = 3 + Math.round(2 * Math.sin(Math.PI * t));
    dot(frame, gx, gy - lift, lv);
    dot(frame, gx + 1, gy - lift, lv - 1);
    dot(frame, gx, gy - lift + 1, lv - 1);
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 発勁の base は周囲攻撃の半径、崩拳の base は突進で進んだ距離（壁で止まれば縮む）。拳は属性の無い打撃なので ramp は light
 */
const FX = {
  moveset: "fists",
  ultimates: {
    "fists.hakkei": {
      ramp: "light",
      cast: { sheet: "fistsUlt.hakkeiCast", life: 0.35 },
      acts: [{ sheet: "fistsUlt.hakkei", life: 0.55, base: HAKKEI_R / 2, pivot: "pos", ground: "fistsUlt.hakkeiGround" }],
    },
    "fists.collapseFist": {
      ramp: "light",
      cast: { sheet: "fistsUlt.collapseFistCast", life: 0.3 },
      acts: [{ sheet: "fistsUlt.collapseFist", life: 0.55, base: HOKEN_L / 2, pivot: "pos", ground: "fistsUlt.collapseFistGround" }],
    },
    "fists.fightingSpirit": {
      ramp: "light",
      cast: { sheet: "fistsUlt.fightingSpiritCast", life: 0.6 },
      sustain: { sheet: "fistsUlt.fightingSpirit", period: 0.7, ground: "fistsUlt.fightingSpiritGround" },
    },
  },
};

export const ATLAS = {
  key: "fistsUlt",
  fx: FX,
  sheets: [
    { key: "fistsUlt.hakkei", dirs: 1, frames: HAKKEI_N, active: HAKKEI_A, size: 2 * (HAKKEI_R + 44), draw: hakkeiBurst },
    { key: "fistsUlt.hakkeiGround", dirs: 1, frames: HAKKEI_N, active: HAKKEI_A, size: 2 * (HAKKEI_R + 12), draw: hakkeiGround },
    { key: "fistsUlt.hakkeiCast", dirs: 1, frames: 8, active: 0, size: 128, draw: hakkeiCast },
    { key: "fistsUlt.collapseFist", dirs: DIRS, frames: HOKEN_N, active: HOKEN_A, size: 2 * (HOKEN_L + 124), draw: collapseStrike },
    { key: "fistsUlt.collapseFistGround", dirs: DIRS, frames: HOKEN_N, active: HOKEN_A, size: 2 * (HOKEN_L + 50), draw: collapseGround },
    { key: "fistsUlt.collapseFistCast", dirs: DIRS, frames: 7, active: 0, size: 128, draw: collapseCast },
    { key: "fistsUlt.fightingSpiritCast", dirs: 1, frames: 10, active: 0, size: 240, draw: spiritCast },
    { key: "fistsUlt.fightingSpirit", dirs: 1, frames: SPIRIT_N, active: 0, size: 160, draw: spiritSustain },
    { key: "fistsUlt.fightingSpiritGround", dirs: 1, frames: SPIRIT_N, active: 0, size: 112, draw: spiritSustainGround },
  ],
};
