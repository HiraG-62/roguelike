// 爪（moveset "claws"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/claws.json）× 2 が目安
//
// 爪の絵の芯は「3 本の平行な爪痕」: 細く鋭い短い斬線 3 本を明確に離して並べ、長さと位置をわずかにずらす（中指が長い）。
// 剣の 1 本の三日月と見分けがつくよう、弧の斬撃（arcSlash）は使わない。多段は爪痕のセットが角度を変えて時間差で出る。
// 伸びは 1〜2 枚で終わり（最速の武器種）、崩れも速い。散る粒は出血の飛沫として刃の進む向きへ飛ばす
import { arcLine, crescent, easeSwing, lens, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 爪痕のセット（3 本の平行な斬線）
// -----------------------------------------------------------------------------

/** 爪の本数（獣の前足の 3 本爪） */
const CLAW_COUNT = 3;

/**
 * 爪痕のセット 1 つ。f はシートのフレーム、s.at で出るフレーム、s.grow 枚で伸び切り、s.life 枚で崩れて消える。
 * s.ang = 爪の走る向き（正準座標の角）、(s.x, s.y) = セットの中心、s.L = 長さ、s.gap = 爪の間隔、s.T = 太さ、s.bend = 反り。
 * 反りは常に前（+x）へふくらませる（剣の十字断ちで逆向きを指摘された）
 */
function clawSet(frame, f, s) {
  const age = f - s.at;
  if (age < 0) return;
  const G = s.grow ?? 2;
  const life = s.life ?? 4;
  const g = Math.min(1, (age + 1) / G);
  const k = age < G ? 0 : (age - G + 1) / (life + 1);
  if (k >= 1) return;
  const dx = Math.cos(s.ang);
  const dy = Math.sin(s.ang);
  // 爪を並べる向き（走る向きに直交）
  const nx = -dy;
  const ny = dx;
  const mid = (CLAW_COUNT - 1) / 2;
  const B = s.bend ?? 3;
  // 横に近い爪（前へ走る）は前後の区別が無いので、時計回りの側（bendSign）へ反らす。円周の爪は bendRaw でそのまま渡す
  const bend = s.bendRaw ?? (Math.abs(nx) < 0.4 ? B * (s.bendSign ?? 1) : B * Math.sign(nx));
  const seed = s.seed ?? 7;
  for (let i = 0; i < CLAW_COUNT; i++) {
    const side = i - mid;
    const off = side * s.gap;
    // 中の爪が長く少し前に出る。外の爪は短く、hash で位置をわずかにずらす
    const Li = s.L * (side === 0 ? 1 : 0.78 + 0.1 * hash1(i, seed));
    const shift = (side === 0 ? s.L * 0.06 : 0) + (hash1(i, seed + 1) - 0.5) * s.L * 0.14;
    const cx = (s.x ?? 0) + nx * off + dx * shift;
    const cy = (s.y ?? 0) + ny * off + dy * shift;
    // 外の爪がわずかに遅れて伸びる（1 本ずつ引っかく手触り）
    const gi = clamp01(g * 1.15 - Math.abs(side) * 0.12);
    if (gi <= 0) continue;
    // 崩れの間は尾が先端へ縮む
    const back = k * 0.55;
    const ax = cx - dx * Li * (0.5 - back);
    const ay = cy - dy * Li * (0.5 - back);
    const bx = cx + dx * Li * 0.5;
    const by = cy + dy * Li * 0.5;
    const T = s.T * (1 - k * 0.45) * (side === 0 ? 1 : 0.85);
    lens(frame, { ax, ay, bx, by, T, bend: bend * (1 - back), grow: gi, bias: 0.2, erosion: k * 0.9, seed: seed + 10 + i, bright: (s.bright ?? 1) * (1 - k * 0.25) });
  }
  // 伸び切った瞬間に中の爪の先端が光る
  if (age === G - 1 && s.glint) sparkle(frame, (s.x ?? 0) + dx * s.L * 0.5, (s.y ?? 0) + dy * s.L * 0.5, s.glint);
  // 出血の飛沫: 爪の先端付近から走る向きへ
  const drops = s.drops ?? 5;
  if (drops > 0 && age >= G - 1) {
    shards(frame, age - (G - 1), drops, seed + 30, (i, rnd) => {
      const t = 0.1 + 0.5 * rnd(1);
      const j = Math.floor(rnd(2) * CLAW_COUNT) - mid;
      const spread = (rnd(3) - 0.5) * 0.9;
      const sp = (s.dropSpeed ?? 3) * (0.6 + 0.8 * rnd(4));
      const vx = (dx + nx * spread) * sp;
      const vy = (dy + ny * spread) * sp;
      return { x: (s.x ?? 0) + nx * j * s.gap + dx * s.L * t, y: (s.y ?? 0) + ny * j * s.gap + dy * s.L * t, vx, vy, life: 2 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.55 ? 2 : 1 };
    });
  }
}

/** 角（度）→ ラジアン。爪痕のセットの表を読みやすくする */
const ang = (deg) => deg * DEG;

/** セットの表を順に描く（多段の段） */
function drawSets(frame, f, sets) {
  for (const s of sets) clawSet(frame, f, s);
}

// -----------------------------------------------------------------------------
// 左の段（box。当たりの中心に置く）
// -----------------------------------------------------------------------------

/** 左 1 段（box reach 12 / size 20・2 段ヒット）: 上から前下へ 2 回、角を変えて引っかく */
const L1_SETS = [
  { at: 0, life: 3, ang: ang(62), x: -9, y: -3, L: 30, gap: 6.5, T: 3.8, bend: 3, glint: 2, seed: 101 },
  { at: 1, ang: ang(96), x: 8, y: 3, L: 30, gap: 6.5, T: 3.8, bend: 3, glint: 2, seed: 111 },
];
/** 左 2 段（返し。描画側が上下反転）: 1 段目より少し長く、角の開きが広い */
const L2_SETS = [
  { at: 0, life: 3, ang: ang(112), x: 9, y: -4, L: 32, gap: 6.5, T: 3.8, bend: 3, glint: 2, seed: 201 },
  { at: 1, ang: ang(70), x: -8, y: 4, L: 32, gap: 6.5, T: 3.8, bend: 3, glint: 2, seed: 211 },
];
/** 左 3 段（size 22・3 段ヒット）: 扇に開く 3 つのセットを 1 枚ずつ */
const L3_SETS = [
  { at: 0, life: 2, ang: ang(50), x: -13, y: -6, L: 26, gap: 6, T: 3.6, bend: 3, glint: 2, seed: 301 },
  { at: 1, life: 2, ang: ang(88), x: 0, y: 0, L: 28, gap: 6, T: 3.6, bend: 3, glint: 2, seed: 311 },
  { at: 2, ang: ang(126), x: 13, y: 6, L: 26, gap: 6, T: 3.6, bend: 3, glint: 2, seed: 321 },
];
/** 左 4 段（踏み込み 8）: 前へ突き込む向きの浅い爪痕を上下から「く」の字に */
const L4_SETS = [
  { at: 0, life: 3, ang: ang(22), x: -2, y: -12, L: 28, gap: 6, T: 3.8, bend: 3, bendSign: -1, glint: 2, seed: 401, dropSpeed: 3.5 },
  { at: 1, ang: ang(-22), x: -2, y: 12, L: 28, gap: 6, T: 3.8, bend: 3, bendSign: 1, glint: 2, seed: 411, dropSpeed: 3.5 },
];
/** 左 5 段（終撃・heavy・size 26）: 深く太い 2 つのセット。2 つ目が大きく、振り切りで飛沫が多い */
const L5_SETS = [
  { at: 0, life: 2, ang: ang(58), x: -16, y: -4, L: 38, gap: 8, T: 5, bend: 4, glint: 3, seed: 501, drops: 7, dropSpeed: 4 },
  { at: 2, ang: ang(100), x: 10, y: 3, L: 50, gap: 10, T: 7, bend: 5, glint: 3, seed: 511, drops: 12, dropSpeed: 4.5, life: 5 },
];

/** ダッシュ攻撃（box reach 14 / size 24・踏み込み 20）: 前へ長く流れる爪痕と、後ろへ伸びる速度線 */
function dash(frame, f) {
  clawSet(frame, f, { at: 0, grow: 2, life: 5, ang: ang(10), x: -2, y: 0, L: 48, gap: 7, T: 4.5, bend: 3, bendSign: 1, glint: 3, seed: 601, drops: 6, dropSpeed: 4 });
  const k = f / 7;
  if (k >= 0.8) return;
  // 速度線は爪痕より暗く疎らに（本数が多いと爪痕が増えたように見える）
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 11 + (hash1(i, 611) - 0.5) * 4;
    const len = 14 + 16 * hash1(i, 612);
    const x1 = -26 - k * 20 - hash1(i, 613) * 8;
    streakLine(frame, { ax: x1 - len * (1 - k * 0.5), ay: y, bx: x1, by: y, bright: 0.32 * (1 - k) });
  }
}

// -----------------------------------------------------------------------------
// 右の段
// -----------------------------------------------------------------------------

/** 牙 1 本（三角）: 根元 (x, y0) の幅 w から、y 方向 dir へ len 伸びて尖る */
function fang(frame, x, y0, w, len, dir, o) {
  paint(
    frame,
    (px, py) => {
      const t = ((py - y0) * dir) / len;
      if (t < 0 || t > 1) return -1;
      const half = (w / 2) * (1 - t) ** 1.3;
      const d = Math.abs(px - x);
      if (d > half || half < 0.4) return -1;
      if (o.erosion > 0 && valueNoise(px, py, 3.5, o.seed) + (1 - t) * 0.3 - o.erosion * 1.1 < 0) return -1;
      // 先端と、刃の片側（前 = +x）が明るい
      const lit = px > x ? 0.15 : -0.1;
      return clamp01((0.55 + 0.45 * t + lit) * (1 - d / (half + 1)) ** 0.4 * o.bright);
    },
    { bounds: { x0: x - w, y0: Math.min(y0, y0 + dir * len) - 2, x1: x + w, y1: Math.max(y0, y0 + dir * len) + 2 } },
  );
}

/** 顎 1 つ: 両端が尖った弧（外へふくらむ）と、内へ向いた牙。sign = -1 が上顎、+1 が下顎 */
function jaw(frame, sign, gap, o) {
  const W = 22;
  // 顎の弧: 中央が外（sign の側）へふくらみ、両端は内へ寄る。lens の反りで表す
  lens(frame, { ax: -W, ay: sign * (gap + 2), bx: W, by: sign * (gap + 2), T: 6 * o.thick, bend: sign * 7, bias: -sign * 0.3, erosion: o.erosion, seed: o.seed, bright: o.bright });
  // 牙: 上顎 3 本・下顎 2 本を互い違いに（噛み合わせ）
  const xs = sign < 0 ? [-11, 0, 11] : [-6, 6];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] ?? 0;
    // 弧の中央ほど外にあるので、牙の根元も弧に合わせる
    const base = sign * (gap + 2 + 7 * (1 - (x / W) ** 2) * 0.9);
    const len = (i === 1 && sign < 0 ? 13 : 11) * o.thick;
    fang(frame, x, base, 6.5 * o.thick, len, -sign, { erosion: o.erosion, seed: o.seed + 3 + i, bright: o.bright });
  }
}

/** 右: 獣噛み（box reach 12 / size 22・heavy）。上下から顎が噛み合い、噛んだ瞬間に閃く */
function fangBite(frame, f) {
  const A = 3;
  const N = 8;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 開いた顎（20）→ 噛み合う（両端が触れ、牙が互い違いに交差する -2）→ 崩れながらわずかに離れる
  const gap = f < A ? 20 - 22 * p : -2 + k * 5;
  const o = { erosion: k * 0.9, bright: 1 - k * 0.3, thick: 1 - k * 0.3 };
  jaw(frame, -1, gap, { ...o, seed: 701 });
  jaw(frame, 1, gap, { ...o, seed: 711 });
  if (f === A - 1) {
    sparkle(frame, 0, 0, 4);
    streakLine(frame, { ax: -14, ay: 0, bx: 14, by: 0, width: 1, bright: 0.8 });
  }
  if (f === A) sparkle(frame, 0, 0, 2);
  if (f >= A - 1) {
    // 噛み口から左右と前へ飛沫
    shards(frame, f - (A - 1), 10, 721, (i, rnd) => {
      const a = (rnd(1) > 0.5 ? 0 : Math.PI) + (rnd(2) - 0.5) * 1.4;
      const sp = 3 + rnd(3) * 3;
      return { x: (rnd(4) - 0.5) * 20, y: (rnd(5) - 0.5) * 4, vx: Math.cos(a) * sp * 0.8 + 1, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(6) * 2), size: rnd(7) > 0.5 ? 2 : 1 };
    });
  }
}

/** 右: 引っ掻き（arc 140° reach 18・2 段ヒット）。自分を中心に 3 本の細い弧が間をあけて広く払う（内の爪ほど遅れる） */
function rake(frame, f) {
  const A = 4;
  const N = 8;
  const sweep = 140 * DEG;
  const from = -sweep / 2;
  const radii = [38, 30, 22];
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  for (let i = 0; i < radii.length; i++) {
    const R = radii[i] ?? 30;
    // 3 本の先端をずらす（中の爪が先行）。後の 2 本目のヒットは先端が振り切る所
    const lag = i === 1 ? -0.06 : 0.06 * i;
    const p = f < A ? easeSwing(clamp01((f + 1) / A - lag)) : 1;
    const head = from + sweep * (f < A ? p : 1 + 0.04 * k);
    const tail = f < A ? from + sweep * Math.max(0, p - 0.55) : from + sweep * Math.min(0.96, 0.45 + 0.55 * k);
    if (head - tail < 0.05) continue;
    crescent(frame, { R, T: 4.2 * (1 - k * 0.4), head, tail, erosion: 0.03 + k * 0.85, bright: 1 - k * 0.3, seed: 801 + i, streak: 0.2, edge: 1.2, peak: 0.12 });
    if (f === A - 1) sparkle(frame, Math.cos(head) * (R - 1), Math.sin(head) * (R - 1), 2);
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 9, 811, (i, rnd) => {
      const a = from + sweep * (0.6 + 0.4 * rnd(1));
      const r = 22 + 16 * rnd(2);
      const sp = 3 + rnd(3) * 2.5;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: -Math.sin(a) * sp, vy: Math.cos(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/** 右: 跳び退き（box reach 12 / size 22）。爪を手前へ引き戻す爪痕（前から自分の側へ走る）と、後ろへ流れる速度線 */
function leapBack(frame, f) {
  clawSet(frame, f, { at: 0, grow: 2, life: 4, ang: ang(150), x: 0, y: 0, L: 34, gap: 6.5, T: 4.2, bend: 3, glint: 2, seed: 901, drops: 0 });
  // 飛沫は前（敵の側）へ置き去りに散る
  if (f >= 1) {
    shards(frame, f - 1, 6, 911, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.2;
      const sp = 2 + rnd(2) * 2.5;
      return { x: 6 + rnd(3) * 8, y: (rnd(4) - 0.5) * 18, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
    });
  }
  const k = f / 7;
  if (k >= 0.7) return;
  for (let i = 0; i < 3; i++) {
    const y = (i - 1) * 12 + (hash1(i, 921) - 0.5) * 3;
    const x0 = -26 - k * 16 - hash1(i, 922) * 6;
    // 後ろ（自分が跳ぶ側）が明るい速度線。爪痕と混ざらないよう暗く短く
    streakLine(frame, { ax: x0 + 12 + 8 * hash1(i, 923), ay: y, bx: x0, by: y, bright: 0.3 * (1 - k) });
  }
}

/** 右: 乱れ爪（circle size 40・4 段ヒット）。周囲に向きも位置もばらばらの爪痕が次々に出る */
function clawFlurry(frame, f) {
  for (let j = 0; j < 4; j++) {
    const a = j * 1.9 + 0.5 + hash1(j, 1001) * 0.6;
    const r = 16 + 8 * hash1(j, 1002);
    const dir = a + Math.PI / 2 + (hash1(j, 1003) - 0.5) * 1.6;
    clawSet(frame, f, { at: j * 1.5 > 4 ? 4 : Math.round(j * 1.4), grow: 2, life: 4, ang: dir, x: Math.cos(a) * r, y: Math.sin(a) * r, L: 28, gap: 5.5, T: 3.8, bend: 3, glint: 2, seed: 1011 + j * 10, drops: 5, dropSpeed: 3.5 });
  }
}

/** 右: 喉裂き（box reach 14 / size 24・heavy・2 段ヒット）。細く長い鋭い一閃が走り、2 段目で裂け目が開いて飛沫が噴く */
function throatSlit(frame, f) {
  const A = 3;
  const N = 9;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const ax = -10;
  const ay = -30;
  const bx = 10;
  const by = 30;
  // 2 段目（f = A）で裂け目が開く: 一瞬だけ太くなってから痩せて崩れる
  const T = f < A ? 5 : f === A ? 8 : 7 * (1 - k * 0.6);
  lens(frame, { ax, ay, bx, by, T, bend: -4, grow: p, bias: 0.15, erosion: k * 0.9, seed: 1101 });
  if (f === A - 1) sparkle(frame, bx - 1, by - 3, 3);
  if (f === A) sparkle(frame, 0, 0, 3);
  if (f >= A) {
    // 断面から前（+x）へ噴く飛沫
    shards(frame, f - A, 14, 1111, (i, rnd) => {
      const t = 0.2 + 0.6 * rnd(1);
      const a = (rnd(2) - 0.5) * 1.3;
      const sp = 3 + rnd(3) * 4;
      // 反りで前へふくらんだ線の上から出す（弦の上だと線の後ろから湧いて見える）
      const bulge = 4 * 4 * t * (1 - t);
      return { x: ax + (bx - ax) * t + 0.95 * bulge + 2, y: ay + (by - ay) * t - 0.32 * bulge, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 派生
// -----------------------------------------------------------------------------

/** 派生: 牙駆け（thrust reach 30・踏み込み 34・2 段ヒット）。前へ長く伸びる 3 本の爪と、穂先で横に裂く 2 つ目の爪痕 */
function fangRush(frame, f) {
  const A = 4;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  clawSet(frame, f, { at: 0, grow: 3, life: 5, ang: 0, x: 34, y: 0, L: 56, gap: 7, T: 4.5, bend: 2, bendSign: 1, glint: 0, seed: 1201, drops: 0 });
  clawSet(frame, f, { at: 2, grow: 2, life: 4, ang: ang(95), x: 60, y: 0, L: 26, gap: 5.5, T: 4, bend: 3, glint: 3, seed: 1211, drops: 7, dropSpeed: 3.5 });
  if (k >= 0.7) return;
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 12 + (hash1(i, 1221) - 0.5) * 3;
    const x1 = 2 - hash1(i, 1222) * 10 - k * 18;
    streakLine(frame, { ax: x1 - 16 - 14 * hash1(i, 1223), ay: y, bx: x1, by: y, bright: 0.32 * (1 - k) });
  }
}

/** 派生: 裂傷舞（circle size 44・3 段ヒット）。円周に沿う向きの爪痕が 3 つ、時計回りに舞いながら出る + 外周の渦の線 */
function lacerationDance(frame, f) {
  const A = 6;
  const N = 10;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const spin = f * 0.28;
  for (let j = 0; j < 3; j++) {
    const a = -Math.PI / 2 + j * ((Math.PI * 2) / 3) + spin * 0.4;
    // 接線（時計回りの進む向き）に走る爪痕。外へふくらむ弧になるよう反りを大きめに
    // 接線の爪の並べる向き（法線）は内向きなので、負の反りで外へふくらむ
    clawSet(frame, f, { at: j * 2, grow: 2, life: 4, ang: a + Math.PI / 2, x: Math.cos(a) * 32, y: Math.sin(a) * 32, L: 32, gap: 6, T: 4, bendRaw: -5, glint: 2, seed: 1301 + j * 10, drops: 4, dropSpeed: 3 });
    // 舞いの軌跡: 爪痕の後ろ（反時計の側）にだけ外周の線を引く
    const age = f - j * 2;
    if (age >= 0 && age <= 3) arcLine(frame, { radius: 42, from: a - 1.0, to: a - 0.4, bright: 0.5 * (1 - age / 4) });
  }
}

/** 派生: 十字爪（box reach 14 / size 26・heavy・2 段ヒット）。2 つのセットが直交して交わり、交点が弾ける */
function crossClaw(frame, f) {
  clawSet(frame, f, { at: 0, grow: 2, life: 5, ang: ang(45), x: 0, y: 0, L: 46, gap: 8, T: 5.5, bend: 4, glint: 0, seed: 1401, drops: 0 });
  clawSet(frame, f, { at: 2, grow: 2, life: 4, ang: ang(135), x: 0, y: 0, L: 46, gap: 8, T: 5.5, bend: 4, glint: 0, seed: 1411, drops: 0 });
  // 交点の閃き（輪は爪痕を囲んで球に見えるので使わない）
  if (f === 3) sparkle(frame, 0, 0, 4);
  if (f === 4) sparkle(frame, 0, 0, 2);
  if (f >= 3) {
    shards(frame, f - 3, 12, 1431, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 3.5 + rnd(2) * 3.5;
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.4 ? 2 : 1 };
    });
  }
}

/** 派生: 跳び食らい（box reach 14 / size 24・heavy・踏み込み 26）。飛びかかった前足の 3 本爪が前へ開いて叩きつけ、着地の衝撃が広がる */
function pounce(frame, f) {
  const A = 3;
  const N = 9;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 前足の爪は前へ開く（扇）。セットではなく 1 本ずつ角を変えて描く
  const spread = [-14, 0, 14];
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  for (let i = 0; i < 3; i++) {
    const a = (spread[i] ?? 0) * DEG;
    const L = i === 1 ? 50 : 42;
    const sx = -24;
    const sy = (i - 1) * 5;
    const back = k * 0.5;
    lens(frame, {
      ax: sx + Math.cos(a) * L * back,
      ay: sy + Math.sin(a) * L * back,
      bx: sx + Math.cos(a) * L,
      by: sy + Math.sin(a) * L,
      T: (i === 1 ? 7 : 6) * (1 - k * 0.45),
      bend: i === 0 ? 3 : i === 2 ? -3 : 0,
      grow: clamp01(p * 1.1 - Math.abs(i - 1) * 0.08),
      bias: 0.2,
      erosion: k * 0.9,
      seed: 1501 + i,
    });
  }
  if (f === A - 1) sparkle(frame, 24, 0, 4);
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 着地の衝撃: 爪先の前に広がる弧（前だけ。輪で囲むと爪痕が球に見える）
    if (age <= 3) arcLine(frame, { ox: -4, radius: 26 + age * 4, from: -0.6, to: 0.6, width: 1.6, bright: 0.65 - age * 0.12 });
    shards(frame, age, 12, 1521, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.4;
      const sp = 3 + rnd(2) * 4;
      return { x: 10 + rnd(3) * 12, y: (rnd(4) - 0.5) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.45 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 刃の進む向き（+x）に走る 3 本の短い裂け目 + 飛び散る粒。heavy は深く太く長い */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const L = heavy ? 40 : 26;
  const gap = heavy ? 10 : 7;
  const T0 = heavy ? 7 : 3.4;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  for (let i = 0; i < 3; i++) {
    const side = i - 1;
    const Li = L * (side === 0 ? 1 : 0.8);
    const sx = (hash1(i, heavy ? 1601 : 1611) - 0.5) * 6 + (side === 0 ? 2 : 0);
    const grow = f === 0 ? 0.6 : 1;
    const back = k * 0.5;
    lens(frame, { ax: sx - Li / 2 + Li * back, ay: side * gap, bx: sx + Li / 2, by: side * gap, T: T0 * (f === 0 ? 0.8 : 1 - k * 0.55) * (side === 0 ? 1 : 0.85), bend: 0, grow, bias: 0.25, erosion: k * 0.9, seed: (heavy ? 1621 : 1631) + i });
  }
  if (f <= 1) sparkle(frame, heavy ? 6 : 4, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (heavy && f >= 1 && f <= 3) sparkle(frame, 12, -gap, 2);
  if (f >= 1) {
    shards(frame, f - 1, heavy ? 14 : 8, heavy ? 1641 : 1651, (i, rnd) => {
      const forward = rnd(1) > 0.3;
      const a = forward ? (rnd(2) - 0.5) * 1.1 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 0.9);
      const sp = (heavy ? 4 : 3) + rnd(4) * (heavy ? 4 : 2.5);
      return { x: (rnd(5) - 0.5) * 10, y: (Math.floor(rnd(6) * 3) - 1) * gap, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(7) * 2), size: rnd(8) > 0.45 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * box の段は当たりの中心（anchor）に置く: 爪痕は相手の体の上に刻まれるもので、自分を中心に振る弧ではないから
 */
const FX = {
  moveset: "claws",
  motions: {
    "l:0": { sheet: "claws.l1", pivot: "anchor", base: 12, measure: "reach" },
    "l:1": { sheet: "claws.l2", pivot: "anchor", base: 12, measure: "reach" },
    "l:2": { sheet: "claws.l3", pivot: "anchor", base: 12, measure: "reach" },
    "l:3": { sheet: "claws.l4", pivot: "anchor", base: 12, measure: "reach" },
    "l:4": { sheet: "claws.l5", pivot: "anchor", base: 14, measure: "reach" },
    dash: { sheet: "claws.dash", pivot: "anchor", base: 14, measure: "reach" },
    "r:fangBite": { sheet: "claws.fangBite", pivot: "anchor", base: 12, measure: "reach" },
    "r:rake": { sheet: "claws.rake", pivot: "self", base: 18, measure: "reach" },
    "r:leapBack": { sheet: "claws.leapBack", pivot: "anchor", base: 12, measure: "reach" },
    "r:clawFlurry": { sheet: "claws.flurry", pivot: "anchor", base: 40, measure: "size" },
    "r:throatSlit": { sheet: "claws.throatSlit", pivot: "anchor", base: 14, measure: "reach" },
    "branch:fangRush": { sheet: "claws.fangRush", pivot: "self", base: 30, measure: "reach" },
    "branch:lacerationDance": { sheet: "claws.dance", pivot: "anchor", base: 44, measure: "size" },
    "branch:crossClaw": { sheet: "claws.cross", pivot: "anchor", base: 14, measure: "reach" },
    "branch:pounce": { sheet: "claws.pounce", pivot: "anchor", base: 14, measure: "reach" },
  },
  hit: "claws.hit",
  hitHeavy: "claws.hitHeavy",
};

/** 爪痕のセットの表を描くシート */
function setSheet(key, sets, frames, active, size) {
  return { key, dirs: DIRS, frames, active, size, draw: (frame, f) => drawSets(frame, f, sets) };
}

export const ATLAS = {
  key: "claws",
  fx: FX,
  sheets: [
    setSheet("claws.l1", L1_SETS, 7, 3, 96),
    setSheet("claws.l2", L2_SETS, 7, 3, 96),
    setSheet("claws.l3", L3_SETS, 8, 4, 96),
    setSheet("claws.l4", L4_SETS, 7, 3, 96),
    setSheet("claws.l5", L5_SETS, 9, 4, 128),
    { key: "claws.dash", dirs: DIRS, frames: 8, active: 3, size: 112, draw: dash },
    { key: "claws.fangBite", dirs: DIRS, frames: 8, active: 3, size: 96, draw: fangBite },
    { key: "claws.rake", dirs: DIRS, frames: 8, active: 4, size: 104, draw: rake },
    { key: "claws.leapBack", dirs: DIRS, frames: 7, active: 3, size: 96, draw: leapBack },
    { key: "claws.flurry", dirs: 1, frames: 10, active: 6, size: 112, draw: clawFlurry },
    { key: "claws.throatSlit", dirs: DIRS, frames: 9, active: 3, size: 96, draw: throatSlit },
    { key: "claws.fangRush", dirs: DIRS, frames: 9, active: 4, size: 176, draw: fangRush },
    { key: "claws.dance", dirs: 1, frames: 10, active: 6, size: 128, draw: lacerationDance },
    { key: "claws.cross", dirs: DIRS, frames: 9, active: 4, size: 112, draw: crossClaw },
    { key: "claws.pounce", dirs: DIRS, frames: 9, active: 3, size: 112, draw: pounce },
    { key: "claws.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "claws.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
