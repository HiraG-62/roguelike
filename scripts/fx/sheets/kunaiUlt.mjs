// クナイの奥義（アトラス kunaiUlt）。docs/ideas/fx-sprites.md 9.2・docs/ideas/gun-bases-review.md 2-9
// 単位は絵のドット（論理 0.5px）。dirs 1（画面に揃える）。原点 = 自分の中心、足元は FEET_Y
//
// 影縫いの陣（一撃・pinNova 半径 80）: 自分から全周へ 12 本のクナイが走り、当たりの縁で一斉に地へ突き立つ。走った跡に影の糸が残り、
//   縁に影の輪が締まる（刺さった敵への線は手続きの spawnLine が引く）
// 爆ぜクナイ（一撃・炎）: 刺さったクナイの炸裂そのものは刺さった所で手続きが描く。こちらは自分から全周へ火の合図が走る
//   （印を結ぶ手元の火花 → 八方へ点の導火が走って弾ける）
// 暗器（持続）: 袖の内からクナイが一瞬だけ覗いては消え、足元の影の輪の刻みが回り続ける
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 地面の輪の潰し（横に長い楕円 = 地面に置いた輪） */
const GROUND_SQUASH = 2.2;

/** 崩れの判定（shapes.mjs の survives と同じ考え） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * クナイの本体 1 本（kunai.mjs の kunaiBody と同じ形。アトラスは 1 ファイルで完結させるので写して持つ）:
 * 中心 (x, y)、角 a、全長 len。前 55% が木の葉の両刃、後ろに細い柄と輪の柄頭
 */
function kunaiBody(frame, o) {
  const { x = 0, y = 0, a, len } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 41;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const blade = len * 0.55;
  const grip = len * 0.3;
  const ringR = len * 0.09 + 0.8;
  const wide = len * 0.13 + 0.6;
  const pad = len / 2 + ringR + 3;
  const root = len / 2 - blade;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s - root;
      const across = -dx * s + dy * c;
      if (along >= 0) {
        if (along > blade) return -1;
        const u = along / blade;
        const half = (u < 0.3 ? 0.45 + (u / 0.3) * 0.55 : ((1 - u) / 0.7) ** 0.8) * wide + 0.3;
        if (Math.abs(across) > half) return -1;
        const q = Math.abs(across) / half;
        if (!survives(px, py, erosion, 1 - q, seed)) return -1;
        if (Math.abs(across) < 0.6 && u > 0.2 && u < 0.85 && erosion < 0.35) return clamp01(0.95 * bright);
        return clamp01((0.78 - 0.18 * q) * bright);
      }
      const back = -along;
      const rd = Math.hypot(back - grip - ringR, across);
      if (rd <= ringR) return rd > ringR - 1.3 ? clamp01(0.7 * bright) : -1;
      if (back > grip) return -1;
      if (Math.abs(across) > 1.2) return -1;
      if (!survives(px, py, erosion, 0.5, seed)) return -1;
      return clamp01(0.5 * bright);
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad } },
  );
}

// -----------------------------------------------------------------------------
// 影縫いの陣
// -----------------------------------------------------------------------------

/** 当たりの半径（80 論理 px × 2） */
const STITCH_R = 160;
const STITCH_N = 12;
/** クナイが縁に届くまでの枚数 */
const STITCH_A = 4;
/** 走るクナイの本数（30° おき。半分ずらした 2 組が少し時間差で出る） */
const STITCH_BLADES = 12;
const STITCH_LEN = 22;

/** 影縫いの陣の発動: 足元の影の輪が締まり、体の周りに 8 本のクナイが外向きに浮かんで構えられる */
function stitchCast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  const r = 34 - 22 * easeSwing(Math.min(1, (f + 1) / 4));
  ring(frame, { oy: FEET_Y, radius: r, width: 2, squash: GROUND_SQUASH, erosion: Math.max(0, k - 0.6) * 2, bright: 0.7, seed: 6101 });
  if (f < 2) return;
  const age = f - 2;
  const g = Math.min(1, (age + 1) / 3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + age * 4 * DEG;
    const rr = 18 + 8 * g;
    kunaiBody(frame, { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.8 - 6, a, len: 12 * g + 2, bright: 0.9, erosion: Math.max(0, k - 0.75) * 3, seed: 6102 + i });
  }
  if (age === 2) sparkle(frame, 0, -6, 3);
}

/**
 * 影縫いの陣: 12 本のクナイが全周へ走り（2 組を 1 枚ずらす）、縁で地へ突き立って震える。
 * 走った跡は細い影の糸（中心から縁へ）になって残り、突き立つと縁に影の輪が締まる
 */
function stitch(frame, f) {
  for (let i = 0; i < STITCH_BLADES; i++) {
    const a = (i / STITCH_BLADES) * TAU + 7 * DEG;
    const delay = i % 2;
    const t = f - delay;
    if (t < 0) continue;
    const p = t < STITCH_A ? easeSwing((t + 1) / STITCH_A) : 1;
    const landed = t >= STITCH_A;
    const age = t - STITCH_A;
    const fade = landed ? age / (STITCH_N - STITCH_A - delay) : 0;
    const r = 14 + (STITCH_R - STITCH_LEN / 2 - 14) * p;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // 影の糸: 走るうちは手元から刃の尻まで、刺さった後はほどけて消える
    if (fade < 0.8) streakLine(frame, { ax: c * 10, ay: s * 10, bx: c * (r - STITCH_LEN / 2), by: s * (r - STITCH_LEN / 2), width: 1, bright: 0.45 * (1 - fade) });
    const quiver = landed ? ([6, -4, 2, -1][age] ?? 0) * DEG : 0;
    kunaiBody(frame, { x: c * r, y: s * r, a: a + quiver, len: STITCH_LEN, bright: 1 - fade * 0.4, erosion: Math.max(0, fade - 0.55) * 2, seed: 6201 + i });
    if (!landed) streakLine(frame, { ax: c * (r - 26), ay: s * (r - 26), bx: c * (r - STITCH_LEN / 2), by: s * (r - STITCH_LEN / 2), width: 1.4, bright: 0.65 });
    if (age === 0) sparkle(frame, c * (r + STITCH_LEN / 2), s * (r + STITCH_LEN / 2), 2);
  }
  if (f >= STITCH_A) {
    const age = f - STITCH_A;
    const k = age / (STITCH_N - STITCH_A);
    ring(frame, { radius: STITCH_R + 8 - Math.min(8, age * 3), width: 2.4, erosion: Math.min(0.92, Math.max(0, k - 0.3) * 1.4), bright: 0.7 - k * 0.3, seed: 6210 });
  }
}

/** 影縫いの陣の地面: 影の滲みが当たりの縁まで広がり、縁の内側にうっすら残って消える */
function stitchGround(frame, f) {
  const p = easeSwing(Math.min(1, (f + 1) / (STITCH_A + 1)));
  const k = f / (STITCH_N - 1);
  const R = 20 + (STITCH_R - 20) * p;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d > R) return -1;
      const u = d / R;
      // 縁ほど濃い（影が縁へ寄って溜まる）。内側はむらを間引く
      if (u < 0.75 && valueNoise(x, y, 6, 6301) < 0.55 + (0.75 - u)) return -1;
      if (!survives(x, y, Math.max(0, k - 0.45) * 1.8, u, 6302)) return -1;
      return clamp01(0.18 + 0.3 * u ** 2);
    },
    { bounds: { x0: -R - 1, y0: -R - 1, x1: R + 1, y1: R + 1 } },
  );
}

// -----------------------------------------------------------------------------
// 爆ぜクナイ
// -----------------------------------------------------------------------------

/** 爆ぜクナイの発動: 頭上に立てたクナイの柄から切っ先へ火花が走り（導火）、切っ先で弾ける */
function blastCast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  kunaiBody(frame, { x: 0, y: -30, a: -Math.PI / 2, len: 22, bright: 1 - k * 0.4, erosion: Math.max(0, k - 0.6) * 2.2, seed: 6401 });
  if (f <= 4) {
    // 導火の火花: 柄頭から切っ先へ上る
    const y = -20 - f * 5;
    sparkle(frame, 0, y, f % 2 === 0 ? 2 : 1);
    dot(frame, 1, y + 3, 5);
    dot(frame, -1, y + 5, 4);
  }
  if (f >= 5) {
    const age = f - 5;
    if (age === 0) sparkle(frame, 0, -44, 4);
    ring(frame, { oy: -42, radius: 4 + age * 5, width: 2, erosion: Math.min(0.92, age * 0.25), bright: 0.85 - age * 0.12, seed: 6402 });
    shards(frame, age, 10, 6403, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 0, y: -42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
    });
  }
}

/** 爆ぜクナイの合図の半径 */
const BLAST_R = 84;

/**
 * 爆ぜクナイ: 自分の周りで印の輪が弾け、八方へ点の導火（火の粒の列）が走って先で小さく弾ける。
 * 刺さったクナイへの合図（炸裂は刺さった所で手続きが描く）
 */
function blast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  if (f <= 1) sparkle(frame, 0, 0, 4);
  ring(frame, { radius: 8 + f * 5, width: 3 - k * 1.4, erosion: Math.min(0.92, k * 1.1), bright: 0.9 - k * 0.4, seed: 6501 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 22.5 * DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const head = 12 + (BLAST_R - 12) * easeSwing(Math.min(1, (f + 1) / 6));
    // 導火: 頭ほど明るい点の列。尾は消えていく
    for (let j = 0; j < 6; j++) {
      const r = head - j * 6;
      if (r < 10) break;
      const level = Math.max(2, 7 - j - Math.floor(k * 3));
      const px = c * r + (hash1(i * 7 + j, 6502) - 0.5) * 2;
      const py = s * r + (hash1(i * 7 + j, 6503) - 0.5) * 2;
      // 頭の 2 粒は 2x2 で太らせる（遠くでも合図の筋が読める）
      dot(frame, px, py, level);
      if (j < 2) {
        dot(frame, px + 1, py, level);
        dot(frame, px, py + 1, level);
        dot(frame, px + 1, py + 1, Math.max(2, level - 1));
      }
    }
    if (f === 5) sparkle(frame, c * BLAST_R, s * BLAST_R, 3);
    if (f >= 5) {
      shards(frame, f - 5, 3, 6510 + i, (j, rnd) => {
        const b = a + (rnd(1) - 0.5) * 2;
        const sp = 1.5 + rnd(2) * 2;
        return { x: c * BLAST_R, y: s * BLAST_R, vx: Math.cos(b) * sp, vy: Math.sin(b) * sp, life: 3, size: 1 };
      });
    }
  }
}

// -----------------------------------------------------------------------------
// 暗器
// -----------------------------------------------------------------------------

/** 暗器の発動: 6 本のクナイが袖から扇に開いて見せ、すっと体の内へ消える（隠し持つ） */
function hiddenCast(frame, f) {
  const N = 10;
  const open = f < 4 ? easeSwing((f + 1) / 4) : 1 - easeSwing((f - 3) / (N - 4));
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const j = i % 3;
    const a = side < 0 ? Math.PI + (j - 1) * 28 * DEG : (j - 1) * 28 * DEG;
    const r = 8 + 18 * open;
    kunaiBody(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r - 2, a, len: 8 + 8 * open, bright: 0.6 + 0.4 * open, erosion: f >= N - 2 ? 0.6 : 0, seed: 6601 + i });
  }
  if (f === 3) {
    sparkle(frame, -26, -2, 2);
    sparkle(frame, 26, -2, 2);
  }
  if (f >= 6) {
    const age = f - 6;
    ring(frame, { oy: FEET_Y, radius: 6 + age * 4, width: 1.8, squash: GROUND_SQUASH, erosion: Math.min(0.92, age * 0.22), bright: 0.65 - age * 0.1, seed: 6602 });
  }
}

const HIDDEN_N = 16;
/** 覗くクナイ: 出る枚数・袖の位置・向き（度）。左右の袖と腰から交互に */
const PEEKS = [
  { at: 0, x: -14, y: -2, deg: 160 },
  { at: 4, x: 14, y: 0, deg: 20 },
  { at: 8, x: -12, y: 8, deg: 200 },
  { at: 12, x: 13, y: 7, deg: -15 },
];
const PEEK_LIFE = 4;

/** 暗器の纏い: 袖からクナイの切っ先が一瞬だけ覗き、光って引っ込む。体の周りを細い影の粒が昇る */
function hiddenSustain(frame, f) {
  PEEKS.forEach((c, i) => {
    const age = (f - c.at + HIDDEN_N) % HIDDEN_N;
    if (age >= PEEK_LIFE) return;
    const out = [0.5, 1, 0.8, 0.35][age] ?? 0;
    const a = c.deg * DEG;
    kunaiBody(frame, { x: c.x + Math.cos(a) * 6 * out, y: c.y + Math.sin(a) * 6 * out, a, len: 8 + 6 * out, bright: 0.7 + 0.3 * out, seed: 6701 + i });
    if (age === 1) sparkle(frame, c.x + Math.cos(a) * 13, c.y + Math.sin(a) * 13, 2);
  });
  const cycle = f / HIDDEN_N;
  for (let i = 0; i < 6; i++) {
    const t = (cycle + hash1(i, 6702)) % 1;
    const x = (hash1(i, 6703) > 0.5 ? 1 : -1) * (12 + hash1(i, 6704) * 10);
    const y = FEET_Y - t * 46;
    dot(frame, x + Math.sin(t * TAU + i) * 2, y, Math.max(2, Math.round(4 * Math.sin(Math.PI * t))));
  }
}

/** 暗器の足元: 影の輪と、その上を回り続ける 4 つの短い刻み（隠した刃の気配） */
function hiddenGround(frame, f) {
  ring(frame, { oy: FEET_Y, radius: 13, width: 1.4, squash: GROUND_SQUASH, bright: 0.3, seed: 6801 });
  const rot = (f / HIDDEN_N) * TAU;
  for (let i = 0; i < 4; i++) {
    const a = rot + (i / 4) * TAU;
    const x = Math.cos(a) * 13 * GROUND_SQUASH;
    const y = FEET_Y + Math.sin(a) * 13;
    streakLine(frame, { ax: x - Math.sin(a) * 4, ay: y + Math.cos(a) * 2, bx: x + Math.sin(a) * 4, by: y - Math.cos(a) * 2, width: 1.2, bright: 0.55 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 影縫いの陣は当たりの半径（pinNova の radius）で拡縮、爆ぜクナイ・暗器は大きさを持たない（base 0）
 */
const FX = {
  moveset: "kunai",
  ultimates: {
    "kunai.shadowStitch": {
      ramp: "steel",
      cast: { sheet: "kunaiUlt.stitchCast", life: 0.4 },
      acts: [{ sheet: "kunaiUlt.stitch", life: 0.75, base: STITCH_R / 2, pivot: "pos", ground: "kunaiUlt.stitchGround" }],
    },
    "kunai.blastKunai": {
      ramp: "fire",
      cast: { sheet: "kunaiUlt.blastCast", life: 0.4 },
      acts: [{ sheet: "kunaiUlt.blast", life: 0.55, base: 0, pivot: "pos" }],
    },
    "kunai.hiddenArms": {
      ramp: "steel",
      cast: { sheet: "kunaiUlt.hiddenCast", life: 0.5 },
      sustain: { sheet: "kunaiUlt.hidden", period: 1.2, ground: "kunaiUlt.hiddenGround" },
    },
  },
};

export const ATLAS = {
  key: "kunaiUlt",
  fx: FX,
  sheets: [
    { key: "kunaiUlt.stitchCast", dirs: 1, frames: 9, active: 0, size: 112, draw: stitchCast },
    { key: "kunaiUlt.stitch", dirs: 1, frames: STITCH_N, active: STITCH_A, size: 2 * (STITCH_R + 24), draw: stitch },
    { key: "kunaiUlt.stitchGround", dirs: 1, frames: STITCH_N, active: STITCH_A, size: 2 * (STITCH_R + 6), draw: stitchGround },
    { key: "kunaiUlt.blastCast", dirs: 1, frames: 9, active: 0, size: 112, draw: blastCast },
    { key: "kunaiUlt.blast", dirs: 1, frames: 10, active: 0, size: 2 * (BLAST_R + 16), draw: blast },
    { key: "kunaiUlt.hiddenCast", dirs: 1, frames: 10, active: 0, size: 112, draw: hiddenCast },
    { key: "kunaiUlt.hidden", dirs: 1, frames: HIDDEN_N, active: 0, size: 96, draw: hiddenSustain },
    { key: "kunaiUlt.hiddenGround", dirs: 1, frames: HIDDEN_N, active: 0, size: Math.ceil(2 * (13 * GROUND_SQUASH + 8)), draw: hiddenGround },
  ],
};
