// 戦鎚（moveset "hammer"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/hammer.json）× 2 が目安
//
// 戦鎚は最重量の打撃なので、刃の三日月は使わない。
// - 叩きつけ: 当たりの位置の「地面」に衝撃を描く（地面に沿って潰れた楕円の輪・放射状の地割れ・四角い石の破片・低い砂煙）
// - 振り: 刃の縁ではなく厚い空気の帯（風圧）。鎚頭の位置だけが明るい
// 地面の物（輪・亀裂・破片・煙）は画面の座標で描く（向きで回すと楕円が斜めに傾き、地面に見えなくなる）。
// 画面の上下に対して対称な形にしておけば、反時計回りの段の上下反転でも崩れない
import { arcLine, easeSwing, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, levelOf, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

/** 地面の楕円の潰れ（縦 / 横）。見下ろしの画面で「床に沿った輪」に見える比 */
const SQ = 0.58;
/** 4x4 の順序ディザ（raster.mjs と同じ並び。画面の座標で塗る paintScreen 用） */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// -----------------------------------------------------------------------------
// 画面の座標で塗る道具
// -----------------------------------------------------------------------------

/**
 * 画面に揃った座標（原点からの画面のずれ。回さない）で形を塗る。fn(sx, sy) の約束は raster.paint と同じ。
 * 地面の物は向きで回さないので、こちらで塗る
 */
function paintScreen(frame, fn, b, opts = {}) {
  const samples = opts.samples ?? 3;
  const dither = opts.dither ?? 0.04;
  const x0 = Math.max(0, Math.floor(frame.cx + b.x0) - 1);
  const y0 = Math.max(0, Math.floor(frame.cy + b.y0) - 1);
  const x1 = Math.min(frame.w - 1, Math.ceil(frame.cx + b.x1) + 1);
  const y1 = Math.min(frame.h - 1, Math.ceil(frame.cy + b.y1) + 1);
  const inv = 1 / samples;
  const need = (samples * samples) / 2;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      let inside = 0;
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const v = fn(ix + (sx + 0.5) * inv - frame.cx, iy + (sy + 0.5) * inv - frame.cy);
          if (v < 0) continue;
          inside++;
          sum += v;
        }
      }
      if (inside < need) continue;
      const bay = (BAYER4[(iy & 3) * 4 + (ix & 3)] ?? 0) / 16 - 0.5;
      frame.raise(ix, iy, levelOf(clamp01(sum / inside + bay * dither * 2)));
    }
  }
}

/** 画面の座標の 1 ドット */
function screenDot(frame, sx, sy, level) {
  frame.raise(Math.floor(frame.cx + sx), Math.floor(frame.cy + sy), level);
}

/** 崩れの判定（ノイズと芯からの近さ）。shapes.mjs の survives と同じ考え方 */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

function easeOut(t) {
  return 1 - Math.pow(1 - clamp01(t), 2.4);
}

// -----------------------------------------------------------------------------
// 地面の衝撃の部品
// -----------------------------------------------------------------------------

/**
 * 地面の衝撃波の輪（画面で横長に潰れた楕円）。手前（画面の下）の縁を太く明るく、奥を細くして床に寝かせる
 */
function groundRing(frame, o) {
  const { r, width } = o;
  const cx = o.cx ?? 0;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.8;
  const seed = o.seed ?? 11;
  paintScreen(
    frame,
    (sx, sy) => {
      const dx = sx - cx;
      const dy = sy / SQ;
      const d = Math.hypot(dx, dy);
      const near = d > 0 ? dy / d : 0;
      // 手前（画面の下）ほど太く、奥は細い: 床に寝た輪の厚み
      const w = width * 1.25 * (0.62 + 0.38 * near);
      const off = d - r;
      // 外縁（進む側）は細く明るい縁、内側は w の 2 倍まで暗く尾を引く（押し出される空気と土の帯）
      // 輪が小さいうちは尾を短くする（円盤に塗りつぶされて輪に見えなくなる）
      const trail = Math.min(w * 1.6, r * 0.3 + w * 0.5);
      if (off > w * 0.4 || off < -trail) return -1;
      const q = off > 0 ? off / (w * 0.4) : -off / trail;
      if (!survives(sx, sy, erosion, 1 - q, seed)) return -1;
      const lead = off > -w * 0.45 ? 1 : 0.55 * (1 - q);
      return clamp01(bright * lead * (off > 0 ? 1 - 0.4 * q : 1) * (0.76 + 0.24 * near) * (1 - erosion * 0.35));
    },
    { x0: cx - r - width - 2, y0: -(r + width) * SQ - 2, x1: cx + r + width + 2, y1: (r + width) * SQ + 2 },
  );
}

/**
 * 放射状の地割れ（折れ線）。画面の座標で、向き aim を中心に spread の範囲へ count 本。
 * 1 本ごとに折れ点を持ち、branch で途中から枝分かれする。地面なので縦は SQ で潰す
 */
function makeCracks(aim, o) {
  const lines = [];
  const { count, len, spread, seed } = o;
  const r0 = o.r0 ?? 5;
  const segs = o.segs ?? 4;
  for (let i = 0; i < count; i++) {
    const even = count > 1 ? i / (count - 1) - 0.5 : 0;
    const a = spread >= Math.PI * 2 - 0.01 ? aim + (i / count) * Math.PI * 2 + (hash1(i, seed) - 0.5) * 0.4 : aim + spread * even + (hash1(i, seed) - 0.5) * (spread / Math.max(2, count)) * 0.8;
    // 向き（aim）に近い亀裂ほど長い: 叩いた向きへ地面が割れていく
    const facing = 0.5 + 0.5 * Math.cos(wrapAngle(a - aim));
    const L = len * (0.55 + 0.25 * hash1(i, seed + 1) + 0.2 * facing * (o.forward ?? 1));
    const pts = [];
    // 折れ線: 折れ点ごとに進む向きへ直交する側へ左右交互にずらす（まっすぐな放射線だと車輪の輻に見える）
    const J = 1 + L * 0.035;
    const start = r0 + hash1(i, seed + 8) * 4;
    const sign0 = hash1(i, seed + 9) > 0.5 ? 1 : -1;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const r = start + (L - start) * (t + (k > 0 && k < segs ? (hash1(i * 17 + k, seed + 10) - 0.5) * (0.5 / segs) : 0));
      const side = k === 0 ? 0 : (k % 2 === 0 ? 1 : -1) * sign0 * J * (0.5 + hash1(i * 17 + k, seed + 2));
      const x = ca * r - sa * side;
      const y = sa * r + ca * side;
      pts.push({ x, y: y * SQ, t });
    }
    lines.push({ pts, width: o.width ?? 2.4, from: 0 });
    // 枝: 中ほどの折れ点から斜めに短く
    if ((o.branch ?? 0) > hash1(i, seed + 3)) {
      const k = 1 + Math.floor(hash1(i, seed + 4) * (segs - 2));
      const p = pts[k];
      if (p) {
        const side = hash1(i, seed + 5) > 0.5 ? 1 : -1;
        const ba = a + side * (0.5 + 0.3 * hash1(i, seed + 6));
        const bl = L * (0.3 + 0.15 * hash1(i, seed + 7));
        const q = { x: p.x + Math.cos(ba) * bl * 0.55, y: p.y + Math.sin(ba) * bl * 0.55 * SQ };
        const e = { x: p.x + Math.cos(ba + side * 0.25) * bl, y: p.y + Math.sin(ba + side * 0.25) * bl * SQ };
        lines.push({ pts: [{ ...p, t: 0 }, { ...q, t: 0.5 }, { ...e, t: 1 }], width: (o.width ?? 2.4) * 0.7, from: p.t });
      }
    }
  }
  return lines;
}

/**
 * 地割れを描く。grow（0..1）で根元から先へ伸びる。芯は光り（衝撃が地面を走る）、縁は暗い溝。
 * 時間が経つと芯が冷えて暗い溝だけが残り、ノイズで欠けて消える
 */
function drawCracks(frame, lines, o) {
  const { grow, glow, erosion, seed } = o;
  for (const line of lines) {
    // 枝は幹がそこまで伸びてから伸びる
    const g = line.from > 0 ? clamp01((grow - line.from) / (1 - line.from)) : grow;
    if (g <= 0) continue;
    const n = line.pts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = line.pts[k];
      const b = line.pts[k + 1];
      if (!a || !b || a.t >= g) continue;
      const cut = b.t > g ? (g - a.t) / (b.t - a.t) : 1;
      const bx = a.x + (b.x - a.x) * cut;
      const by = a.y + (b.y - a.y) * cut;
      const w0 = line.width * (1 - a.t * 0.55);
      const w1 = line.width * (1 - Math.min(b.t, g) * 0.55);
      const pad = w0 + 2;
      paintScreen(
        frame,
        (sx, sy) => {
          const s = segment(sx, sy, a.x, a.y, bx, by);
          const w = (w0 + (w1 - w0) * s.t) / 2 + 0.5;
          if (s.d > w) return -1;
          const q = s.d / w;
          if (!survives(sx, sy, erosion, 1 - q, seed + k)) return -1;
          // 芯（光る割れ目）と縁（暗い溝）
          const tipFade = 1 - 0.35 * (a.t + (b.t - a.t) * s.t);
          if (q < 0.5) return clamp01((0.26 + glow * 0.48) * tipFade);
          return 0.16;
        },
        { x0: Math.min(a.x, bx) - pad, y0: Math.min(a.y, by) - pad, x1: Math.max(a.x, bx) + pad, y1: Math.max(a.y, by) + pad },
        { dither: 0 },
      );
    }
  }
}

/**
 * 四角い石の破片。地面に沿って外へ飛び、減速する。宙へ跳ねた感じは「途中で大きく見えて、落ちると小さくなる」で出す
 * （画面の上へ動かすと、反時計回りの段の上下反転で下へ跳ねてしまう）
 */
function rocks(frame, age, o) {
  if (age < 0) return;
  const { count, seed, aim, spread, speed } = o;
  const r0 = o.r0 ?? 6;
  const big = o.size ?? 3;
  for (let i = 0; i < count; i++) {
    const rnd = (k) => hash1(i * 13 + k, seed);
    const life = 3 + Math.floor(rnd(1) * 3) + (o.life ?? 0);
    if (age > life) continue;
    const a = spread >= Math.PI * 2 - 0.01 ? aim + rnd(2) * Math.PI * 2 : aim + (rnd(2) - 0.5) * spread;
    const sp = speed * (0.55 + 0.7 * rnd(3));
    const drag = 0.78;
    const travel = ((1 - Math.pow(drag, age + 1)) / (1 - drag)) * 2;
    const r = r0 + rnd(4) * 4 + sp * travel;
    const sx = Math.cos(a) * r;
    const sy = Math.sin(a) * r * SQ;
    const t = age / life;
    const base = 2 + Math.floor(rnd(5) * big);
    const s = Math.max(1, Math.round(base * (0.8 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.3)))) - (t > 0.8 ? 1 : 0));
    const L = Math.max(4, Math.round(6.4 - 2.6 * t));
    const x0 = Math.floor(frame.cx + sx - s / 2);
    const y0 = Math.floor(frame.cy + sy - s / 2);
    // 暗い縁取り（段 1）で塊に見せる。亀裂や輪の上に乗っても色が溶けない
    for (let yy = -1; yy <= s; yy++) for (let xx = -1; xx <= s; xx++) frame.raise(x0 + xx, y0 + yy, 1);
    // 石の陰影: 左上が明るく、右下が暗い
    for (let yy = 0; yy < s; yy++) {
      for (let xx = 0; xx < s; xx++) {
        let lv = L - 1;
        if (yy === 0 || xx === 0) lv = L;
        if (s > 1 && (yy === s - 1 || xx === s - 1)) lv = Math.max(2, L - 2);
        frame.set(x0 + xx, y0 + yy, lv);
      }
    }
    // 真下の地面に小さな影（跳ねている感じ）
    if (s >= 3 && t < 0.7) for (let xx = 0; xx < s; xx++) frame.raise(x0 + xx, y0 + s + 1, 1);
  }
}

/**
 * 低い砂煙。輪の縁に沿った小さな塊が外へ広がりながら薄れる。暗い段（1〜3）だけで、主役（輪・亀裂）を邪魔しない
 */
function dust(frame, age, o) {
  if (age < 0) return;
  const { count, r0, r1, seed, span } = o;
  const aim = o.aim ?? 0;
  const spread = o.spread ?? Math.PI * 2;
  const t = clamp01(age / span);
  for (let i = 0; i < count; i++) {
    const a = spread >= Math.PI * 2 - 0.01 ? aim + (i / count) * Math.PI * 2 + (hash1(i, seed) - 0.5) * 0.5 : aim + (hash1(i, seed) - 0.5) * spread;
    const r = r0 + (r1 - r0) * easeOut(t) * (0.8 + 0.3 * hash1(i, seed + 1));
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r * SQ;
    const size = (o.size ?? 5) * (0.7 + 0.5 * hash1(i, seed + 2)) * (0.8 + 0.7 * t);
    const thin = 0.3 + t * 0.75;
    paintScreen(
      frame,
      (sx, sy) => {
        const dx = (sx - cx) / size;
        const dy = (sy - cy) / (size * 0.62);
        const d = Math.hypot(dx, dy);
        if (d > 1) return -1;
        if (valueNoise(sx + i * 31, sy, 3.2, seed + 3) + (1 - d) * 0.45 < thin + 0.35) return -1;
        return clamp01((0.42 - 0.22 * t) * (0.6 + 0.6 * (1 - d)));
      },
      { x0: cx - size - 1, y0: cy - size - 1, x1: cx + size + 1, y1: cy + size + 1 },
      { dither: 0.02 },
    );
  }
}

/** 打撃の星（画面に揃った 4 本の太い光芒 + 短い斜め）。中心だけ白い */
function impactStar(frame, sx0, sy0, R, bright = 1) {
  paintScreen(
    frame,
    (sx, sy) => {
      const dx = sx - sx0;
      const dy = (sy - sy0) / 0.8;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const main = R * (0.34 + 0.66 * Math.pow(Math.abs(Math.cos(2 * th)), 5));
      const diag = R * 0.62 * (0.4 + 0.6 * Math.pow(Math.abs(Math.sin(2 * th)), 6));
      const lim = Math.max(main, diag);
      if (r > lim) return -1;
      return clamp01(Math.pow(1 - r / lim, 0.8) * 1.15 * bright);
    },
    { x0: sx0 - R - 1, y0: sy0 - R - 1, x1: sx0 + R + 1, y1: sy0 + R + 1 },
    { dither: 0 },
  );
}

/** 叩いた跡のくぼみ（潰れた楕円の暗い面 + 明るい縁の欠け） */
function crater(frame, r, o) {
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 21;
  paintScreen(
    frame,
    (sx, sy) => {
      const d = Math.hypot(sx, sy / SQ) / r;
      if (d > 1) return -1;
      if (!survives(sx, sy, erosion, 1 - d, seed)) return -1;
      // 縁は盛り上がった土（中間）、底は暗い
      if (d > 0.72) return 0.42 * (o.bright ?? 1);
      return 0.13;
    },
    { x0: -r - 1, y0: -r * SQ - 1, x1: r + 1, y1: r * SQ + 1 },
    { dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 叩きつけの共通の時間割
// -----------------------------------------------------------------------------

/**
 * 叩きつけ 1 フレーム。f = 0 で鎚が地面に当たり（星と亀裂の根元）、active の間に輪と亀裂が走り、
 * 振り終わりで輪が崩れ、亀裂が冷えて暗い溝になり、石が落ちて砂煙が残る
 */
function slam(frame, f, S, layer) {
  const A = S.active;
  const N = S.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const aim = frame.angle + (S.aimOffset ?? 0);
  if (layer === "air") {
    // 空中の層（キャラより上）: 跳ねる石と打撃の星
    if (S.rocks) rocks(frame, f - 1, { ...S.rocks, aim, seed: S.seed + 4 });
    if (S.star) {
      if (f === 0) impactStar(frame, 0, 0, S.star * 1.1, 1);
      if (f === 1) impactStar(frame, 0, 0, S.star * 1.4, 1);
      if (f === 2) impactStar(frame, 0, 0, S.star * 0.8, 0.75);
    }
    if ((S.extraLayer ?? "ground") === "air") S.extra?.(frame, f, k, aim);
    return;
  }
  // 地面の層（キャラより下）: 亀裂・くぼみ・砂煙・地面の輪
  if (S.cracks) {
    const lines = makeCracks(aim, S.cracks);
    const grow = clamp01((f + 1) / (S.cracks.growFrames ?? A));
    drawCracks(frame, lines, { grow, glow: f < A ? 1 - f * 0.12 : Math.max(0, 0.55 - k * 0.8), erosion: k > 0.3 ? (k - 0.3) * 1.3 : 0, seed: S.seed + 1 });
  }
  if (S.crater && k < 0.95) crater(frame, S.crater, { erosion: k * 0.9, seed: S.seed + 2, bright: f < A ? 1 : 0.7 });
  if (S.dust) dust(frame, f - (S.dust.delay ?? 1), { ...S.dust, aim, seed: S.seed + 3, span: N - 1 });
  for (const [i, ring] of (S.rings ?? []).entries()) {
    const age = f - ring.delay;
    if (age < 0) continue;
    const span = ring.span ?? N - ring.delay - 1;
    const t = clamp01(age / span);
    if (t >= 1) continue;
    groundRing(frame, {
      r: ring.R * (ring.start ?? 0.25) + ring.R * (1 - (ring.start ?? 0.25)) * easeOut(age / (span * 0.6)),
      width: ring.width * (1 - 0.45 * t),
      erosion: t > 0.3 ? (t - 0.3) * 1.25 : 0,
      bright: (ring.bright ?? 0.9) * (1 - 0.35 * t),
      seed: S.seed + 10 + i,
    });
  }
  if ((S.extraLayer ?? "ground") === "ground") S.extra?.(frame, f, k, aim);
}

/**
 * 叩きつけのシートを 2 枚に分ける: key（空中の層。石・星）と key.ground（地面の層。亀裂・くぼみ・砂煙・地面の輪）。
 * 地面の物をキャラより下に描くため（実行時は FX の motions の ground で同じフレームを流す）
 */
function slamSheets(key, S) {
  const base = { dirs: S.dirs ?? DIRS, frames: S.frames, active: S.active, size: S.size };
  return [
    { key, ...base, draw: (frame, f) => slam(frame, f, S, "air") },
    { key: `${key}.ground`, ...base, draw: (frame, f) => slam(frame, f, S, "ground") },
  ];
}

/** 左 1 段: circle reach 14 / size 36（半径 36 ドット）。軽めの叩き: 輪 1 枚・前へ短い亀裂 4 本・小石 */
const L1 = {
  frames: 7,
  active: 3,
  size: 112,
  seed: 1100,
  star: 9,
  crater: 5,
  rings: [{ delay: 0, R: 34, width: 3.4 }],
  cracks: { count: 4, len: 26, spread: 150 * DEG, seed: 1110, branch: 0, width: 2 },
  rocks: { count: 5, spread: 200 * DEG, speed: 3, size: 2 },
  dust: { count: 6, r0: 22, r1: 38, size: 4 },
};
/** 左 2 段: 同じ大きさの返し。亀裂は少なく長く、砂煙が厚い（1 段目と絵を分ける） */
const L2 = {
  frames: 7,
  active: 3,
  size: 112,
  seed: 1200,
  star: 10,
  crater: 6,
  rings: [{ delay: 0, R: 36, width: 4 }],
  cracks: { count: 3, len: 32, spread: 110 * DEG, seed: 1210, branch: 0.6, width: 2.2 },
  rocks: { count: 6, spread: Math.PI * 2, speed: 3.2, size: 2 },
  dust: { count: 10, r0: 24, r1: 42, size: 5 },
};
/** 左 3 段（重）: box reach 18 / size 30。くぼみ・枝の付いた亀裂 6 本・石 9 個 */
const L3 = {
  frames: 8,
  active: 3,
  size: 128,
  seed: 1300,
  star: 12,
  crater: 7,
  rings: [{ delay: 0, R: 40, width: 4.4 }],
  cracks: { count: 6, len: 38, spread: 200 * DEG, seed: 1310, branch: 0.5, width: 2.6 },
  rocks: { count: 9, spread: 260 * DEG, speed: 3.8, size: 3 },
  dust: { count: 9, r0: 26, r1: 46, size: 5 },
};
/** 左 4 段（終撃）: box reach 20 / size 34。輪 2 枚を時間差・長い亀裂 8 本・石 14 個 */
const L4 = {
  frames: 9,
  active: 4,
  size: 152,
  seed: 1400,
  star: 15,
  crater: 9,
  rings: [
    { delay: 0, R: 50, width: 5 },
    { delay: 2, R: 34, width: 3.2, bright: 0.7 },
  ],
  cracks: { count: 8, len: 50, spread: 260 * DEG, seed: 1410, branch: 0.6, width: 3 },
  rocks: { count: 14, spread: Math.PI * 2, speed: 4.4, size: 3, life: 1 },
  dust: { count: 12, r0: 32, r1: 58, size: 6 },
};
/** 溜め叩き: circle reach 10 / size 50（最大）。長い亀裂 11 本・大きな輪 2 枚・石 20 個 */
const CHARGE = {
  frames: 10,
  active: 4,
  size: 200,
  seed: 1500,
  star: 18,
  crater: 11,
  rings: [
    { delay: 0, R: 64, width: 6 },
    { delay: 2, R: 46, width: 4, bright: 0.75 },
  ],
  cracks: { count: 11, len: 74, spread: Math.PI * 2, seed: 1510, branch: 0.7, width: 3.4, segs: 5, forward: 1.6 },
  rocks: { count: 20, spread: Math.PI * 2, speed: 5.2, size: 4, life: 1 },
  dust: { count: 16, r0: 40, r1: 74, size: 7 },
};
/** 右: 振り下ろし（box reach 18 / size 30）。真上から落とすので、深いくぼみと全周に均等な短い亀裂・まっすぐ散る石 */
const DOWN = {
  frames: 8,
  active: 3,
  size: 128,
  seed: 1600,
  star: 14,
  crater: 11,
  rings: [{ delay: 1, R: 36, width: 3.6, start: 0.45 }],
  cracks: { count: 7, len: 30, spread: Math.PI * 2, seed: 1610, branch: 0.2, width: 2.6, forward: 0 },
  rocks: { count: 10, spread: Math.PI * 2, speed: 4, size: 3 },
  dust: { count: 7, r0: 24, r1: 42, size: 5 },
};
/** 右: 大地叩き（circle size 60・自分の周り）。広がる波が主役: 大きな輪 2 枚と広い砂煙、亀裂は控えめ */
const EARTH = {
  dirs: 1,
  frames: 10,
  active: 4,
  size: 176,
  seed: 1700,
  star: 14,
  crater: 10,
  rings: [
    { delay: 0, R: 64, width: 6 },
    { delay: 2, R: 58, width: 4.4, bright: 0.8 },
  ],
  cracks: { count: 8, len: 42, spread: Math.PI * 2, seed: 1710, branch: 0.2, width: 2.6, forward: 0 },
  rocks: { count: 12, spread: Math.PI * 2, speed: 4.6, size: 3 },
  dust: { count: 18, r0: 42, r1: 76, size: 7 },
};

/** 地砕きの同心の亀裂: 全周の折れ線（多角形）。大きな石板が割れた縁 */
function ringCrack(frame, f, k) {
  const R = 30;
  const n = 11;
  const g = clamp01((f - 0.5) / 2);
  if (g <= 0) return;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R * (0.86 + 0.28 * hash1(i % n, 1851));
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * SQ, t: i / n });
  }
  drawCracks(frame, [{ pts, width: 2.4, from: 0 }], { grow: g, glow: f < 4 ? 0.9 : Math.max(0, 0.5 - k * 0.8), erosion: k > 0.3 ? (k - 0.3) * 1.3 : 0, seed: 1852 });
}

/** 派生: 地砕き（circle size 60・自分の周り）。割れる地面が主役: 長い枝分かれの亀裂 12 本 + 同心の割れ + 大きな石板 */
const BREAKER = {
  dirs: 1,
  frames: 10,
  active: 4,
  size: 176,
  seed: 1800,
  star: 13,
  crater: 8,
  rings: [{ delay: 1, R: 60, width: 4.6 }],
  cracks: { count: 12, len: 66, spread: Math.PI * 2, seed: 1810, branch: 0.9, width: 3.2, segs: 5, forward: 0 },
  rocks: { count: 16, spread: Math.PI * 2, speed: 4.4, size: 5, life: 1, r0: 22 },
  dust: { count: 10, r0: 38, r1: 68, size: 6, delay: 2 },
  extra: ringCrack,
};

/** 派生: 鉄槌（box reach 20 / size 34）。一点に全重量: 大きなくぼみ・極太の輪 1 枚・太い亀裂・大きな石 */
const IRON = {
  frames: 9,
  active: 4,
  size: 152,
  seed: 1900,
  star: 17,
  crater: 13,
  rings: [{ delay: 0, R: 46, width: 7.5, start: 0.4 }],
  cracks: { count: 9, len: 48, spread: 300 * DEG, seed: 1910, branch: 0.8, width: 4, segs: 4 },
  rocks: { count: 14, spread: Math.PI * 2, speed: 4.2, size: 5, life: 1, r0: 12 },
  dust: { count: 10, r0: 30, r1: 54, size: 6 },
};

/** 打ち上げのすくい: 前へ吹き上がる短い速度線（石の飛ぶ向きに沿う） */
function launcherLines(frame, f, k, aim) {
  if (f < 1 || k > 0.7) return;
  for (let i = 0; i < 6; i++) {
    const a = aim + (hash1(i, 2051) - 0.5) * 0.9;
    const r0 = 8 + f * 5 + hash1(i, 2052) * 6;
    const r1 = r0 + 14 + hash1(i, 2053) * 10;
    const ax = Math.cos(a) * r0;
    const ay = Math.sin(a) * r0 * SQ;
    const bx = Math.cos(a) * r1;
    const by = Math.sin(a) * r1 * SQ;
    paintScreen(
      frame,
      (sx, sy) => {
        const s = segment(sx, sy, ax, ay, bx, by);
        if (s.d > 0.6) return -1;
        return 0.6 * (1 - k) * (0.3 + 0.7 * s.t);
      },
      { x0: Math.min(ax, bx) - 2, y0: Math.min(ay, by) - 2, x1: Math.max(ax, bx) + 2, y1: Math.max(ay, by) + 2 },
      { dither: 0 },
    );
  }
}

/** 派生: 打ち上げ（box reach 18 / size 30）。前へすくい上げる: 小さな輪と、前方の円錐へ勢いよく飛ぶ石の束 */
const LAUNCHER = {
  frames: 8,
  active: 3,
  size: 144,
  seed: 2000,
  star: 11,
  crater: 6,
  rings: [{ delay: 0, R: 28, width: 3.4 }],
  cracks: { count: 2, len: 32, spread: 70 * DEG, seed: 2010, branch: 0, width: 2.4 },
  rocks: { count: 16, spread: 80 * DEG, speed: 6.5, size: 3, life: 1 },
  dust: { count: 6, r0: 18, r1: 44, size: 5, spread: 120 * DEG },
  extra: launcherLines,
  // 吹き上がる速度線は空中の層（キャラより上）
  extraLayer: "air",
};

/** ダッシュの地面の掻き跡: 後ろ（-x）から当たりまで地面を削った 2 本の溝と、後ろへ流れる砂煙 */
function dashFurrow(frame, f, k, aim) {
  const back = aim + Math.PI;
  const L = 60 * clamp01((f + 1) / 3);
  // 1 本の太い溝（2 本にするとレールや二重線に見える）。縁が少しがたつく折れ線
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const r = 6 + L * t;
    const j = (hash1(i, 2151) - 0.5) * 3;
    pts.push({ x: Math.cos(back) * r + Math.cos(back + Math.PI / 2) * j, y: (Math.sin(back) * r + Math.sin(back + Math.PI / 2) * j) * SQ, t });
  }
  drawCracks(frame, [{ pts, width: 4.4, from: 0 }], { grow: 1, glow: f < 4 ? 0.6 : Math.max(0, 0.35 - k), erosion: k > 0.2 ? (k - 0.2) * 1.3 : 0, seed: 2152 });
  dust(frame, f, { count: 7, r0: 20, r1: 70, size: 6, aim: back, spread: 70 * DEG, seed: 2153, span: 8 });
}

/** ダッシュ攻撃（circle size 44・自分の周り）。突っ込んで叩く: 後ろに地面を削った溝、前へ伸びる亀裂、輪 */
const DASH = {
  frames: 8,
  active: 4,
  size: 176,
  seed: 2100,
  star: 12,
  crater: 7,
  rings: [{ delay: 0, R: 44, width: 4.4 }],
  cracks: { count: 5, len: 40, spread: 130 * DEG, seed: 2110, branch: 0.4, width: 2.6, forward: 1.5 },
  rocks: { count: 10, spread: 180 * DEG, speed: 4.6, size: 3 },
  extra: dashFurrow,
};

// -----------------------------------------------------------------------------
// 振り（風圧の帯）
// -----------------------------------------------------------------------------

/**
 * 重い振りの風圧: 刃の縁ではなく厚い空気の帯。帯は外縁も内縁もぼけて、鎚頭の位置（先端）だけが明るい塊になる。
 * 帯の中には円周に沿った気流の筋（ノイズ）を入れて「空気の層」に見せる
 */
function airBand(frame, o) {
  const { R, T, head, tail } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 31;
  const span = Math.max(1e-3, head - tail);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const s = wrapAngle(head - Math.atan2(y, x));
      const u = s / span;
      if (u < -0.02 || u > 1) return -1;
      // 帯の太さ: 先端で最も太く、尾へ細る（先端は丸く）
      const w = T * (u < 0.08 ? Math.sqrt(Math.max(0, (u + 0.02) / 0.1)) : Math.pow(1 - (u - 0.08) / 0.92, 0.6));
      const mid = R - T * 0.45;
      const q = Math.abs(r - mid) / (w / 2);
      if (q > 1 || w < 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      // 気流の筋（半径の帯ごと・角で流れる）
      const band = Math.floor((r - mid) / 2.2);
      const flow = valueNoise(s * R * 0.35, band * 7, 6, seed + band) * 0.35;
      const cross = Math.pow(1 - q, 0.7);
      return clamp01((cross * (0.62 - 0.4 * u) + flow * (1 - u) * cross) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 4, y0: -R - 4, x1: R + 4, y1: R + 4 } },
  );
}

/** 鎚頭の塊（進む向きに少し長い楕円）。中心は明部、白は芯の数ドットだけ */
function hammerHead(frame, a, rad, size, bright) {
  const hx = Math.cos(a) * rad;
  const hy = Math.sin(a) * rad;
  const tx = -Math.sin(a);
  const ty = Math.cos(a);
  paint(
    frame,
    (x, y) => {
      const dx = x - hx;
      const dy = y - hy;
      const along = dx * tx + dy * ty;
      const across = dx * Math.cos(a) + dy * Math.sin(a);
      const d = Math.hypot(along / (size * 1.25), across / size);
      if (d > 1) return -1;
      // 白（段 7）は芯の数ドットだけ。塊の大半は明部（段 5〜6）
      return clamp01((0.5 + 0.42 * Math.pow(1 - d, 1.6)) * bright);
    },
    { bounds: { x0: hx - size * 1.4 - 2, y0: hy - size * 1.4 - 2, x1: hx + size * 1.4 + 2, y1: hy + size * 1.4 + 2 } },
  );
}

/**
 * 重い振り 1 フレーム。active で鎚頭が振り幅を走り（振り始めは遅く、途中で最も速い: 重さ）、
 * 振り終わりで帯が外へ膨らみながら散り、鎚頭の塊は消える
 */
function heavySwing(frame, f, W) {
  const half = (W.sweep * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const A = W.active;
  const N = W.frames;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 重い物の振り: 溜めてから一気に（ease-in-out）
  const p = f < A ? (1 - Math.cos(Math.PI * ((f + 1) / A))) / 2 : 1;
  const head = from + sweep * (p + W.overshoot * k);
  const tail = f < A ? from + sweep * Math.max(0, p - W.tailLen) : from + sweep * Math.min(0.96, 1 - W.tailLen + W.tailLen * Math.pow(k, 0.75));
  const R = W.R + k * 5;
  const T = W.T * (f < A ? 0.75 + 0.25 * p : 1 - 0.35 * k);
  airBand(frame, { R, T, head, tail, erosion: k > 0 ? 0.08 + 0.8 * Math.pow(k, 1.2) : 0, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k, seed: W.seed });
  if (k < 0.34) hammerHead(frame, head, W.R - W.T * 0.45, W.head * (1 - k), f < A ? 1 : 0.8);
  // 速度線は帯の外側だけ
  if (k < 0.8) {
    for (let i = 0; i < W.lines; i++) {
      const len = (head - tail) * (0.4 + 0.35 * hash1(i, W.seed + 5)) * (1 - k);
      const end = head - (head - tail) * (0.1 + 0.15 * hash1(i, W.seed + 6));
      if (len > 0.05) arcLine(frame, { radius: R + 4 + i * 5 + k * 4, from: end - len, to: end, width: 1.2, bright: (0.55 - i * 0.12) * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, Math.cos(head) * (W.R - W.T * 0.45), Math.sin(head) * (W.R - W.T * 0.45), 3);
  W.extra?.(frame, f, k, head, from, sweep);
}

/** 振りの尾で巻き上がる砂煙（鎚頭が地面すれすれを通った跡） */
function swingDust(frame, f, k, head, from, sweep, W) {
  if (f < 2) return;
  const age = f - 2;
  for (let i = 0; i < W.dustCount; i++) {
    const a = from + sweep * (0.25 + 0.75 * hash1(i, W.seed + 7));
    if (a > head) continue;
    const r = W.R - W.T * 0.2 + hash1(i, W.seed + 8) * 6 + age * 2.2;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r;
    const size = 4 + hash1(i, W.seed + 9) * 3 + age * 0.9;
    const thin = 0.35 + age * 0.09;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / size;
        if (d > 1) return -1;
        if (valueNoise(x + i * 17, y, 3, W.seed + 10) + (1 - d) * 0.5 < thin + 0.25) return -1;
        return clamp01((0.32 - 0.03 * age) * (0.6 + 0.6 * (1 - d)));
      },
      { bounds: { x0: cx - size - 1, y0: cy - size - 1, x1: cx + size + 1, y1: cy + size + 1 } },
    );
  }
}

/** 右: 大薙ぎ（arc 200° reach 32）。広く厚い風圧の帯。砂煙を尾に引く */
const SWEEP = { R: 70, T: 30, sweep: 200, frames: 9, active: 5, tailLen: 0.75, overshoot: 0.06, lines: 2, head: 9, seed: 3100, dustCount: 9 };
SWEEP.extra = (frame, f, k, head, from, sweep) => swingDust(frame, f, k, head, from, sweep, SWEEP);

/** 横殴りの終わりの衝撃: 振り切った鎚頭の位置で星が弾け、接線の向きへ石と風が抜ける */
function sideImpact(frame, f, k, head, from, sweep) {
  const W = SIDE;
  const end = from + sweep;
  const rad = W.R - W.T * 0.45;
  const ex = Math.cos(end) * rad;
  const ey = Math.sin(end) * rad;
  if (f === W.active - 1 || f === W.active) {
    const R = f === W.active - 1 ? 28 : 18;
    paint(
      frame,
      (x, y) => {
        const dx = x - ex;
        const dy = y - ey;
        const r = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx) - end;
        const lim = R * (0.3 + 0.7 * Math.pow(Math.abs(Math.cos(2 * th)), 9));
        if (r > lim) return -1;
        return clamp01(Math.pow(1 - r / lim, 0.8) * 1.1);
      },
      { bounds: { x0: ex - R - 1, y0: ey - R - 1, x1: ex + R + 1, y1: ey + R + 1 } },
    );
  }
  if (f >= W.active - 1) {
    const age = f - (W.active - 1);
    for (let i = 0; i < 9; i++) {
      const rnd = (j) => hash1(i * 13 + j, W.seed + 20);
      const life = 3 + Math.floor(rnd(1) * 2);
      if (age > life) continue;
      // 接線（時計回りの進む向き）寄りに飛ぶ
      const a = end + Math.PI / 2 + (rnd(2) - 0.5) * 1.3;
      const sp = 3.5 + rnd(3) * 3;
      const travel = (1 - Math.pow(0.8, age + 1)) / 0.2;
      const px = ex + Math.cos(a) * sp * travel;
      const py = ey + Math.sin(a) * sp * travel;
      const g = frame.toGrid(px, py);
      const s = Math.max(2, 2 + Math.floor(rnd(4) * 3) - (age > 2 ? 1 : 0));
      const L = Math.max(3, 6 - age);
      const gx = Math.floor(g.x);
      const gy = Math.floor(g.y);
      // 帯の上でも石に見えるよう、暗い縁取りの上に塗り替える
      for (let yy = -1; yy <= s; yy++) for (let xx = -1; xx <= s; xx++) frame.set(gx + xx, gy + yy, 1);
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) frame.set(gx + xx, gy + yy, yy === 0 || xx === 0 ? L : L - 1);
    }
  }
}

/** 右: 横殴り（arc 160° reach 30・重）。大薙ぎより狭く太い帯・大きな鎚頭・振り切りで衝撃が弾ける */
const SIDE = { R: 64, T: 36, sweep: 160, frames: 8, active: 4, tailLen: 0.6, overshoot: 0.04, lines: 2, head: 12, seed: 3200, dustCount: 0, extra: sideImpact };

/** 派生: 鎚車（circle size 56・2 段ヒット）。鎚頭が自分の周りを 1 周し、厚い風圧の輪を引く。2 回の当たりで明滅 */
function hammerWheel(frame, f) {
  const A = 6;
  const N = 10;
  const R = 56;
  const T = 26;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = -Math.PI / 2 + Math.PI * 2 * p + k * 0.8;
  const tailLen = f < A ? Math.min(Math.PI * 1.35, Math.PI * 2 * p * 0.9) : Math.PI * 1.35 * (1 - k * 0.8);
  const flash = f === 1 || f === 4 ? 1.1 : 1;
  airBand(frame, { R: R + k * 4, T: T * (1 - k * 0.3), head, tail: head - tailLen, erosion: k > 0 ? 0.1 + 0.8 * Math.pow(k, 1.1) : 0, bright: flash * (1 - 0.3 * k), seed: 3300 });
  const rad = R - T * 0.45;
  if (k < 0.3) hammerHead(frame, head, rad, 11 * (1 - k), f < A ? flash : 0.8);
  if (f === 1 || f === 4) sparkle(frame, Math.cos(head) * rad, Math.sin(head) * rad, 3);
  if (k < 0.8) {
    for (let i = 0; i < 2; i++) {
      const len = tailLen * (0.45 + 0.2 * i) * (1 - k);
      const end = head - 0.25 - i * 0.2;
      arcLine(frame, { radius: R + 3 + i * 2.5 + k * 4, from: end - len, to: end, width: 1.2, bright: 0.55 * (1 - k) });
    }
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中: 重い打撃の星（進む向き +x に長い光芒）と、足もとの地面へ抜ける衝撃（潰れた輪）。
 * heavy は輪が大きく 2 段になり、四角い破片と短い亀裂が付く
 */
function hit(frame, f, heavy) {
  const N = heavy ? 8 : 6;
  const k = f / (N - 1);
  const R = heavy ? 22 : 15;
  // 星: 進む向きへ長く、後ろへ短い（打ち抜いた向き）
  if (f <= 2) {
    const s = f === 0 ? 0.7 : f === 1 ? 1 : 0.55;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const th = Math.atan2(y, x);
        const len = R * s * (x > 0 ? 1.25 : 0.8);
        // 剣の細い閃きと分けるため、光芒は太く短く、中心の塊を大きく
        const main = len * (0.36 + 0.64 * Math.pow(Math.abs(Math.cos(2 * th)), 4));
        const diag = len * 0.62 * (0.4 + 0.6 * Math.pow(Math.abs(Math.sin(2 * th)), 5));
        const lim = Math.max(main, diag);
        if (r > lim) return -1;
        return clamp01((0.35 + 0.6 * Math.pow(1 - r / lim, 1.2)) * (f === 2 ? 0.85 : 1.1));
      },
      { bounds: { x0: -R * 1.3 - 2, y0: -R - 2, x1: R * 1.3 + 2, y1: R + 2 } },
    );
  }
  // 打ち抜く向きの太い衝撃の筋
  if (f >= 1 && f <= 3) {
    for (let i = 0; i < (heavy ? 5 : 3); i++) {
      const y = (i - (heavy ? 2 : 1)) * 5;
      const x0 = 6 + f * 5 + Math.abs(y) * 0.4;
      streakLine(frame, { ax: x0, ay: y, bx: x0 + (heavy ? 16 : 11) - f * 2, by: y * 1.2, width: i === (heavy ? 2 : 1) ? 2 : 1.3, bright: 0.75 - f * 0.12 });
    }
  }
  // 地面へ抜ける衝撃（足もとの潰れた輪）
  if (f >= 1) {
    const age = f - 1;
    const span = N - 2;
    const t = age / span;
    groundRing(frame, { r: (heavy ? 12 : 8) + (heavy ? 30 : 16) * easeOut((age + 1) / (span * 0.75)), width: (heavy ? 4.4 : 3) * (1 - 0.4 * t), erosion: t > 0.3 ? (t - 0.3) * 1.3 : 0, bright: 0.8 * (1 - 0.3 * t), seed: heavy ? 4101 : 4001 });
    if (heavy && f >= 2) {
      const age2 = f - 2;
      const t2 = age2 / (N - 3);
      groundRing(frame, { r: 8 + 20 * easeOut((age2 + 1) / ((N - 3) * 0.75)), width: 3 * (1 - 0.4 * t2), erosion: t2 > 0.25 ? (t2 - 0.25) * 1.3 : 0, bright: 0.6 * (1 - 0.3 * t2), seed: 4102 });
    }
  }
  if (heavy) {
    const lines = makeCracks(frame.angle, { count: 4, len: 22, spread: 200 * DEG, seed: 4110, r0: 4, width: 2 });
    drawCracks(frame, lines, { grow: clamp01((f + 1) / 3), glow: f < 3 ? 0.9 : Math.max(0, 0.5 - k), erosion: k > 0.4 ? (k - 0.4) * 1.5 : 0, seed: 4111 });
    rocks(frame, f - 1, { count: 10, aim: frame.angle, spread: 220 * DEG, speed: 4.2, size: 3, seed: 4112, r0: 4 });
  } else {
    rocks(frame, f - 1, { count: 5, aim: frame.angle, spread: 160 * DEG, speed: 3.2, size: 2, seed: 4012, r0: 3 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 叩きつけは当たりの中心（anchor）に置き、大きさは size で測る（地面の輪が当たりの円・箱の広さに合う）
 */
const FX = {
  moveset: "hammer",
  motions: {
    "l:0": { sheet: "hammer.l1", ground: "hammer.l1.ground", pivot: "anchor", base: 36, measure: "size" },
    "l:1": { sheet: "hammer.l2", ground: "hammer.l2.ground", pivot: "anchor", base: 36, measure: "size" },
    "l:2": { sheet: "hammer.l3", ground: "hammer.l3.ground", pivot: "anchor", base: 30, measure: "size" },
    "l:3": { sheet: "hammer.l4", ground: "hammer.l4.ground", pivot: "anchor", base: 34, measure: "size" },
    dash: { sheet: "hammer.dash", ground: "hammer.dash.ground", pivot: "anchor", base: 44, measure: "size" },
    charge: { sheet: "hammer.charge", ground: "hammer.charge.ground", pivot: "anchor", base: 50, measure: "size" },
    "r:hammerSweep": { sheet: "hammer.sweep", pivot: "self", base: 32, measure: "reach" },
    "r:hammerDown": { sheet: "hammer.down", ground: "hammer.down.ground", pivot: "anchor", base: 30, measure: "size" },
    "r:hammerSide": { sheet: "hammer.side", pivot: "self", base: 30, measure: "reach" },
    "r:earthSlam": { sheet: "hammer.earthSlam", ground: "hammer.earthSlam.ground", pivot: "anchor", base: 60, measure: "size" },
    "branch:groundBreaker": { sheet: "hammer.groundBreaker", ground: "hammer.groundBreaker.ground", pivot: "anchor", base: 60, measure: "size" },
    "branch:hammerWheel": { sheet: "hammer.wheel", pivot: "anchor", base: 56, measure: "size" },
    "branch:launcher": { sheet: "hammer.launcher", ground: "hammer.launcher.ground", pivot: "anchor", base: 30, measure: "size" },
    "branch:ironHammer": { sheet: "hammer.ironHammer", ground: "hammer.ironHammer.ground", pivot: "anchor", base: 34, measure: "size" },
  },
  hit: "hammer.hit",
  hitHeavy: "hammer.hitHeavy",
};

export const ATLAS = {
  key: "hammer",
  fx: FX,
  sheets: [
    ...slamSheets("hammer.l1", L1),
    ...slamSheets("hammer.l2", L2),
    ...slamSheets("hammer.l3", L3),
    ...slamSheets("hammer.l4", L4),
    ...slamSheets("hammer.dash", DASH),
    ...slamSheets("hammer.charge", CHARGE),
    ...slamSheets("hammer.down", DOWN),
    ...slamSheets("hammer.earthSlam", EARTH),
    ...slamSheets("hammer.groundBreaker", BREAKER),
    ...slamSheets("hammer.launcher", LAUNCHER),
    ...slamSheets("hammer.ironHammer", IRON),
    { key: "hammer.sweep", dirs: DIRS, frames: SWEEP.frames, active: SWEEP.active, size: 176, draw: (frame, f) => heavySwing(frame, f, SWEEP) },
    { key: "hammer.side", dirs: DIRS, frames: SIDE.frames, active: SIDE.active, size: 176, draw: (frame, f) => heavySwing(frame, f, SIDE) },
    { key: "hammer.wheel", dirs: 1, frames: 10, active: 6, size: 160, draw: hammerWheel },
    { key: "hammer.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "hammer.hitHeavy", dirs: DIRS, frames: 8, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
