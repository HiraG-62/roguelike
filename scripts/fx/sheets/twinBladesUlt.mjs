// 双剣（moveset "twinBlades"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。見本は swordUlt.mjs、形の言葉は twinBlades.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/twinBlades.json × 2 が目安
//
// 双剣の性格（細く短く鋭い斬線を、角度とタイミングをずらして手数で見せる・影の残像・細かい粒）を、奥義では数と広がりで豪華にする:
// - 千刃: 8 回の当たりに合わせて、8 波の短い斬線が周り一面に刻まれる嵐（剣の円月の「1 本の輪」とは逆に、無数の細い線）
// - 朧渡り: 通り道に影の残像が並び、2 度の斬りは道の 2 か所で逆向きの斜めの長い斬線（重ならない位置と時間）
// - 残影: 2 本の短刀が腰の高さを周回し、後ろに間を空けた影の残像を引く（持続のループ）
// 決まり: 1 振り 1 本（複数の線は多段・二刀のときだけで、位置か時間を分ける）・白は縁と光点だけ・反りは前へ・崩れて消える
import { arcLine, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { dot, hash1 } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の道具（twinBlades.mjs の quickCut を写し、奥義用に太さ・崩れの段を足したもの）
// -----------------------------------------------------------------------------

/**
 * ほぼ直線の短い斬線。a → b へ grow フレームで伸び、fade フレームで尾から痩せて崩れる。
 * bend は法線 + 側（a → b の左手）へのふくらみ。伸び切りの瞬間に先端へ光点、崩れで粒が刃の進む向きへ散る
 */
function quickCut(frame, f, o) {
  const g = f - (o.start ?? 0);
  const grow = o.grow ?? 2;
  const fade = o.fade ?? 3;
  if (g < 0 || g >= grow + fade) return;
  const p = g < grow ? easeSwing((g + 1) / grow) : 1;
  const k = g < grow ? 0 : (g - grow + 1) / (fade + 1);
  const bright = o.bright ?? 1;
  const shrink = k * 0.45;
  const ax = o.ax + (o.bx - o.ax) * shrink;
  const ay = o.ay + (o.by - o.ay) * shrink;
  lens(frame, { ax, ay, bx: o.bx, by: o.by, T: o.T * (1 - k * 0.5), bend: (o.bend ?? 0) * (1 - shrink), grow: p, bias: o.bias ?? 0.3, erosion: k * 0.9, seed: o.seed, bright: bright * (1 - k * 0.25) });
  if (g === grow - 1 && o.glint) sparkle(frame, o.bx - (o.bx - o.ax) * 0.06, o.by - (o.by - o.ay) * 0.06, o.glint);
  if (g >= grow - 1 && o.dust) {
    const len = Math.hypot(o.bx - o.ax, o.by - o.ay);
    const tx = (o.bx - o.ax) / len;
    const ty = (o.by - o.ay) / len;
    shards(frame, g - (grow - 1), o.dust, o.seed + 9, (i, rnd) => {
      const t = 0.35 + 0.65 * rnd(1);
      const side = rnd(2) > 0.5 ? 1 : -1;
      const sp = (o.dustSpeed ?? 2) + rnd(3) * 2.4;
      const vx = tx * sp - ty * side * sp * 0.35;
      const vy = ty * sp + tx * side * sp * 0.35;
      return { x: o.ax + (o.bx - o.ax) * t, y: o.ay + (o.by - o.ay) * t, vx, vy, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.7 ? 2 : 1 };
    });
  }
}

/** 影の残像（暗く細いレンズ）。中心 (cx, cy)、向き ang、長さ len。段 2〜4 に収めて刃（明部）と見分ける */
function ghostBlade(frame, o) {
  const { cx, cy, ang, len } = o;
  const c = Math.cos(ang) * len * 0.5;
  const s = Math.sin(ang) * len * 0.5;
  if ((o.bright ?? 0.5) < 0.08) return;
  lens(frame, { ax: cx - c, ay: cy - s, bx: cx + c, by: cy + s, T: o.T ?? 5, bias: 0, erosion: o.erosion ?? 0, seed: o.seed ?? 1, bright: o.bright ?? 0.5 });
}

// -----------------------------------------------------------------------------
// 千刃（nova 半径 40・8 回）: 8 波の短い斬線が周り一面に刻まれる刃の嵐。外周を風の弧が回り、最後に刃片が外へ散る
// dirs 1（向きのない嵐）
// -----------------------------------------------------------------------------

/** 当たりの半径（40 論理 px × 2） */
const STORM_R = 80;
const STORM_N = 15;
/** 8 回の当たりに合わせて 8 波を 1 枚ずつ刻む */
const STORM_A = 8;
/** 1 波あたりの斬線の数（120° おき。波ごとに黄金角で回すので、重ならずに周り一面へ散る） */
const STORM_PER_WAVE = 3;
const GOLDEN = 137.5;

function thousandBlades(frame, f) {
  // 1) 8 波の斬線: 波 h は f = h で伸びる。外ほど長く、後の波ほど外へ（嵐が広がって見える）
  for (let h = 0; h < STORM_A; h++) {
    for (let j = 0; j < STORM_PER_WAVE; j++) {
      const i = h * STORM_PER_WAVE + j;
      const a = (h * GOLDEN + j * 120 + 15) * DEG;
      const r = 26 + (h / (STORM_A - 1)) * 26 + hash1(i, 5101) * 24;
      const len = 12 + r * 0.16 + hash1(i, 5102) * 6;
      // 接線から ±30° 崩す（全部接線だと輪に見える）。時計回りに刻むので接線は a + 90°
      const tilt = a + Math.PI / 2 + (hash1(i, 5103) - 0.5) * 60 * DEG;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const dx = Math.cos(tilt) * len;
      const dy = Math.sin(tilt) * len;
      // 反りは外（敵の側）へ: a → b の左手の法線が外を向くかで符号を決める
      const nx = -Math.sin(tilt);
      const ny = Math.cos(tilt);
      const outward = nx * Math.cos(a) + ny * Math.sin(a) > 0 ? 1 : -1;
      const last = h === STORM_A - 1;
      quickCut(frame, f, { start: h, grow: 1, fade: last ? 6 : 4, ax: cx - dx, ay: cy - dy, bx: cx + dx, by: cy + dy, T: 6 + hash1(i, 5104) * 2, bend: 3.5 * outward, bias: 0.2, seed: 5110 + i * 7, glint: j === 0 && h % 2 === 0 ? 2 : 0, dust: 3, dustSpeed: 2.4 });
    }
  }
  // 2) 外周を回る風の弧（刃の外側にだけ。時計回りに流れ、嵐の間ずっと回る）
  if (f < STORM_A + 2) {
    const k = f < STORM_A ? 0 : (f - STORM_A + 1) / 3;
    for (let i = 0; i < 5; i++) {
      const head = (i / 5) * TAU + f * 0.55 + hash1(i, 5120) * 0.6;
      const span = 0.5 + 0.4 * hash1(i, 5121);
      arcLine(frame, { radius: STORM_R + 4 + (i % 3) * 3.5, from: head - span, to: head, bright: (0.58 - (i % 3) * 0.08) * (1 - k) });
    }
  }
  // 3) 嵐の芯: 自分の周りで回る 2 本の短刀の閃き（双剣が回っている手元）。波ごとに 45° ずつ進む
  if (f < STORM_A) {
    const a = f * 45 * DEG;
    for (let j = 0; j < 2; j++) {
      const b = a + j * Math.PI;
      const cx = Math.cos(b) * 28;
      const cy = Math.sin(b) * 28;
      const t = b + Math.PI / 2;
      lens(frame, { ax: cx - Math.cos(t) * 8, ay: cy - Math.sin(t) * 8, bx: cx + Math.cos(t) * 8, by: cy + Math.sin(t) * 8, T: 4, bias: 0.3, seed: 5130 + j, bright: 0.85 });
    }
  }
  // 4) 締め: 最後の波の直後に全周の光点 4 つと、細い輪が外へ抜けて崩れる
  if (f === STORM_A) {
    for (let i = 0; i < 4; i++) {
      const a = (45 + i * 90) * DEG;
      sparkle(frame, Math.cos(a) * (STORM_R - 8), Math.sin(a) * (STORM_R - 8), 3);
    }
  }
  if (f >= STORM_A) {
    const age = f - STORM_A;
    const e = Math.min(0.95, 0.1 + age * 0.16);
    if (age < 6) ring(frame, { radius: STORM_R - 6 + age * 5, width: 2 - age * 0.2, erosion: e, bright: 0.55 - age * 0.07, seed: 5140 });
    // 刃片: 全周から外へ・接線へ（1 ドットが多い。双剣の細かい粒）
    shards(frame, age, 52, 5141, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = 20 + rnd(2) * (STORM_R - 20);
      const sp = 3 + rnd(3) * 5;
      const out = 0.35 + 0.55 * rnd(4);
      const vx = (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp;
      const vy = (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(5) * 4), size: rnd(6) > 0.72 ? 2 : 1 };
    });
  }
}

/** 千刃の地面: 当たりの縁の輪と、8 回の当たりに合わせて 1 つずつ灯る 8 つの短い刻み。嵐が止むと薄れて消える */
function thousandBladesGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 2);
  const k = f < STORM_A ? 0 : (f - STORM_A + 1) / (STORM_N - STORM_A);
  if (k >= 1) return;
  const dim = 0.4 * (1 - k * 0.5);
  ring(frame, { radius: (STORM_R - 2) * (0.75 + 0.25 * grow), width: 1.6, erosion: k * 0.9, bright: dim, seed: 5150 });
  for (let i = 0; i < STORM_A; i++) {
    if (i > f) break;
    const a = (i * 45 - 90) * DEG + f * 0.04;
    const r = STORM_R - 8;
    const t = a + Math.PI / 2;
    const l = 5;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r;
    streakLine(frame, { ax: cx - Math.cos(t) * l, ay: cy - Math.sin(t) * l, bx: cx + Math.cos(t) * l, by: cy + Math.sin(t) * l, width: 1.4, bright: (i === f ? 0.6 : 0.42) * (1 - k) });
  }
}

/** 千刃の発動: 散った刃が渦を巻いて自分へ集まり（内へ回る 6 本の小さな刃）、揃った瞬間に X の閃きと輪が弾ける */
function thousandBladesCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = easeSwing((f + 1) / gather);
    for (let i = 0; i < 6; i++) {
      // 時計回りに 1/3 周しながら半径 52 → 12 へ
      const a = (i / 6) * TAU + p * (TAU / 3);
      const r = 52 - 40 * p;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const t = a + Math.PI / 2;
      lens(frame, { ax: cx - Math.cos(t) * 7, ay: cy - Math.sin(t) * 7, bx: cx + Math.cos(t) * 7, by: cy + Math.sin(t) * 7, T: 4, bias: 0.3, seed: 5160 + i, bright: 0.55 + 0.4 * p });
      // 通ってきた道の暗い残像（刃の後ろ、間を空けて 1 つ）
      const ga = a - 0.45;
      const gr = r + 10 * (1 - p);
      ghostBlade(frame, { cx: Math.cos(ga) * gr, cy: Math.sin(ga) * gr, ang: ga + Math.PI / 2, len: 10, T: 3.5, bright: 0.32 * (1 - p * 0.5), seed: 5170 + i });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const age = f - gather;
  const k = (age + 1) / (N - gather);
  // X の閃き: 2 本の短刀を交差させた一瞬（1 フレームずらして 2 本目）
  quickCut(frame, age, { start: 0, grow: 1, fade: 3, ax: -14, ay: -14, bx: 14, by: 14, T: 5, bias: 0, seed: 5180 });
  quickCut(frame, age, { start: 1, grow: 1, fade: 2, ax: -14, ay: 14, bx: 14, by: -14, T: 5, bias: 0, seed: 5181 });
  ring(frame, { radius: 10 + k * 30, width: 2.6 - k * 1.2, erosion: Math.min(0.9, k * 0.85), bright: 0.85 - k * 0.3, seed: 5182 });
  if (age === 0) sparkle(frame, 0, 0, 4);
  shards(frame, age, 12, 5183, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3.5;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.7 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 朧渡り（lunge 100・幅 28・2 回）: 通り道に影の残像が点々と並び、道の 2 か所を逆向きの斜めの長い斬線が時間差で割く。
// 斬った所から暗い血の粒がこぼれる（出血）
// -----------------------------------------------------------------------------

/** 突進の長さ（100 論理 px × 2） */
const HAZE_L = 200;
/** 当たりの幅の半分（幅 28 論理 px） */
const HAZE_HALF = 28;
const HAZE_N = 12;
const HAZE_A = 5;
/** 2 度の斬りの位置（道の割合）と始まるフレーム。1 度目は右上→左下、2 度目は左上→右下で逆向きにして二重線に見せない */
const HAZE_CUTS = [
  { at: 0.42, start: 1, dir: 1, seed: 5210 },
  { at: 0.84, start: 3, dir: -1, seed: 5220 },
];
/** 斬線の半分の長さ（道の幅より長く、帯からはみ出して抜ける） */
const HAZE_CUT_HALF = 40;

function hazeWalk(frame, f) {
  const A = HAZE_A;
  const k = f < A ? 0 : (f - A + 1) / (HAZE_N - A + 1);
  // 1) すり抜けた体の線: 極細の閃きが 2 枚で終点まで走り、以後は始点側から痩せる（刃ではないので細く、白は先端の光点だけ）
  const head = HAZE_L * Math.min(1, (f + 1) / 2);
  const tail = f < 2 ? 0 : HAZE_L * Math.min(0.95, (f - 1) * 0.16);
  if (head - tail > 8 && f < HAZE_N - 3) {
    lens(frame, { ax: tail, ay: 0, bx: head, by: 0, T: 3.2, bias: 0, erosion: k * 0.7, seed: 5201, bright: 0.72 - k * 0.3 });
  }
  if (f <= 1) sparkle(frame, head - 2, 0, 3);
  // 2) 影の残像: 通り道に置き去りにされた人影（縦長の暗いレンズ）が間を空けて 4 つ。通った順に現れ、前へ流れて崩れる
  for (let i = 0; i < 4; i++) {
    const u = (i + 0.6) / 4.4;
    const appear = u * 1.6;
    if (f < appear) continue;
    const age = f - appear;
    const b = 0.44 * (1 - age / 10) * (0.7 + 0.3 * u);
    if (b < 0.08) continue;
    const x = HAZE_L * u * 0.9 + age * 2.5;
    const h = HAZE_HALF * 0.72 - age * 0.8;
    lens(frame, { ax: x, ay: -h, bx: x, by: h, T: 9 - age * 0.4, bias: 0, erosion: Math.min(0.92, age * 0.11 + k * 0.4), seed: 5203 + i, bright: b });
  }
  // 4) 2 度の斬り: 帯を斜めに割く長い 1 本ずつ。反りは前（+x）へ
  for (const c of HAZE_CUTS) {
    const cx = HAZE_L * c.at;
    const dx = HAZE_CUT_HALF * 0.55;
    const dy = HAZE_CUT_HALF * c.dir;
    // a → b の左手の法線は dy > 0 なら −x を向く。前（+x）へふくらませるため bend の符号を合わせる
    const bend = dy > 0 ? -7 : 7;
    quickCut(frame, f, { start: c.start, grow: 2, fade: 6, ax: cx + dx, ay: -dy, bx: cx - dx, by: dy, T: 10, bend, bias: 0.25, seed: c.seed, glint: 4, dust: 8, dustSpeed: 2.6 });
    // 出血: 斬った所から、暗い大粒が前へ流れつつ下へ落ちる
    const g = f - c.start - 1;
    if (g >= 0) {
      shards(frame, g, 12, c.seed + 5, (i, rnd) => {
        const side = rnd(1) > 0.5 ? 1 : -1;
        return { x: cx + (rnd(2) - 0.5) * 10, y: (rnd(3) - 0.5) * 16, vx: 1 + rnd(4) * 2.5, vy: side * (0.8 + rnd(5) * 2) + 0.6, life: 4 + Math.floor(rnd(6) * 3), size: rnd(7) > 0.4 ? 2 : 1, bright: 0.25, drag: 0.8 };
      });
    }
  }
  // 5) 終点: 抜けた所に進む向きへ潰れた暗い輪と、後ろへ流れる影の速度線
  if (f >= 2) {
    const age = f - 2;
    if (age < 7) ring(frame, { ox: HAZE_L + 4 - age * 2, radius: 7 + age * 4, width: 2.2, squash: 0.45, erosion: Math.min(0.92, age * 0.13), bright: 0.6 - age * 0.06, seed: 5230 });
  }
  if (f >= 1 && k < 0.9) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (5 + Math.floor(i / 2) * 7 + hash1(i, 5231) * 3);
      const x1 = HAZE_L * (0.5 + 0.45 * hash1(i, 5232)) + k * 20;
      const len = (40 + 50 * hash1(i, 5233)) * (1 - k * 0.6);
      streakLine(frame, { ax: x1 - len, ay: y, bx: Math.min(HAZE_L + 8, x1), by: y, bright: 0.36 * (1 - k) });
    }
  }
}

/** 朧渡りの発動: 身が影に溶ける。自分の位置に暗い残像が前後にぶれて 3 つ並び、踏み切りの潰れた輪と後ろへの影の筋 */
function hazeWalkCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  // 残像: 縦長の暗いレンズ（人影の幅）を前後にずらして。前ほど明るく、時間で前へ抜ける
  for (let i = 0; i < 3; i++) {
    const x = -14 + i * 12 + f * (2 + i);
    const b = (0.3 + i * 0.12) * (1 - k);
    lens(frame, { ax: x, ay: -22, bx: x, by: 22, T: 10 - i * 2, bias: 0, erosion: Math.min(0.9, k * 0.8 + (2 - i) * 0.1), seed: 5240 + i, bright: b });
  }
  // 抜刀の 2 閃: 上と下から斜めに、2 フレームずらして前の 1 点で交わる（平行に並べると二重線に見える）
  quickCut(frame, f, { start: 0, grow: 1, fade: 3, ax: 0, ay: -14, bx: 42, by: 3, T: 4.5, seed: 5250, glint: 2 });
  quickCut(frame, f, { start: 2, grow: 1, fade: 3, ax: 0, ay: 14, bx: 42, by: -3, T: 4.5, seed: 5251, glint: 3 });
  ring(frame, { ox: -8 - f * 2, radius: 6 + f * 4.5, width: 2.2 - k, squash: 0.5, erosion: Math.min(0.9, k * 0.9), bright: 0.65 - k * 0.3, seed: 5252 });
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (4 + Math.floor(i / 2) * 6 + hash1(i, 5253) * 2);
      const x0 = -14 - f * 5 - hash1(i, 5254) * 8;
      streakLine(frame, { ax: x0, ay: y, bx: x0 - 16 - hash1(i, 5255) * 14, by: y, bright: 0.4 * (1 - k) });
    }
  }
}

// -----------------------------------------------------------------------------
// 残影（持続）: 2 本の短刀が腰の高さの楕円を周回し、後ろに間を空けた影の残像を引く。dirs 1
// -----------------------------------------------------------------------------

const ORBIT_N = 12;
/** 周回の楕円（横の半径・縦の半径・中心の高さ）。キャラの顔を隠さないよう腰に置く */
const ORBIT_RX = 38;
const ORBIT_RY = 15;
const ORBIT_Y = 6;
/** 刃の後ろに引く残像の数と角の間隔（詰めると 1 本の太い帯に見えるので空ける） */
const GHOSTS = 3;
const GHOST_GAP = 0.42;

/** 楕円の角 a の点と、時計回りの接線の角 */
function orbitAt(a, rx = ORBIT_RX, ry = ORBIT_RY, oy = ORBIT_Y) {
  return { x: Math.cos(a) * rx, y: oy + Math.sin(a) * ry, t: Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx) };
}

/** 周回する短刀 1 本と、その残像 */
function orbitBlade(frame, a, o) {
  const len = o.len ?? 18;
  const p = orbitAt(a, o.rx, o.ry, o.oy);
  const c = Math.cos(p.t) * len * 0.5;
  const s = Math.sin(p.t) * len * 0.5;
  // 奥（楕円の上半分）は少し暗く、手前は明るい
  const near = 0.8 + 0.2 * Math.sin(a);
  lens(frame, { ax: p.x - c, ay: p.y - s, bx: p.x + c, by: p.y + s, T: o.T ?? 5, bias: 0.35, seed: o.seed, bright: (o.bright ?? 0.95) * near });
  for (let j = 1; j <= (o.ghosts ?? GHOSTS); j++) {
    const ga = a - j * GHOST_GAP;
    const g = orbitAt(ga, o.rx, o.ry, o.oy);
    ghostBlade(frame, { cx: g.x, cy: g.y, ang: g.t, len: len * (1 - j * 0.12), T: (o.T ?? 5) * (1 - j * 0.15), bright: (0.5 - j * 0.12) * (o.ghostBright ?? 1), erosion: j * 0.18, seed: o.seed + j * 3 });
  }
}

function afterimageSustain(frame, f) {
  const cycle = f / ORBIT_N;
  // 2 本は反対側。1 巡で一周するので継ぎ目が出ない
  for (let i = 0; i < 2; i++) {
    const a = cycle * TAU + i * Math.PI + 0.3;
    orbitBlade(frame, a, { seed: 5301 + i * 20 });
  }
  // 外側に沿う短い風の点線: 刃の少し先を走る粒（刃の外にだけ）
  for (let i = 0; i < 8; i++) {
    const a = cycle * TAU + (i / 8) * TAU + hash1(i, 5310) * 0.4;
    const p = orbitAt(a, ORBIT_RX + 7, ORBIT_RY + 4);
    const level = 2 + Math.round(2 * (0.5 + 0.5 * Math.sin(a * 2 + i)));
    dot(frame, p.x, p.y, level);
  }
  // 1 巡に 2 回、手前を通る刃の光点
  if (f === 3 || f === 9) {
    const a = cycle * TAU + (f === 3 ? 0 : Math.PI) + 0.3;
    const p = orbitAt(a);
    sparkle(frame, p.x, p.y, 2);
  }
}

/** 残影の足元: 潰れた輪と、刃に合わせて回る 2 つの刻み（2 回対称なので 1 巡で継ぎ目が出ない） */
function afterimageSustainGround(frame, f) {
  const cycle = f / ORBIT_N;
  const feet = 20;
  ring(frame, { oy: feet, radius: 14, width: 1.6, squash: 2.4, bright: 0.34, seed: 5320 });
  for (let i = 0; i < 2; i++) {
    const a = cycle * TAU + i * Math.PI + 0.3;
    const p = orbitAt(a, 33, 13.5, feet);
    const t = p.t;
    streakLine(frame, { ax: p.x - Math.cos(t) * 5, ay: p.y - Math.sin(t) * 5, bx: p.x + Math.cos(t) * 5, by: p.y + Math.sin(t) * 5, width: 1.4, bright: 0.42 });
  }
}

/** 残影の発動: 2 本の短刀が大きな輪から一周して腰の周回へ締まり、残像を多く引く。締まった瞬間に輪が弾ける */
function afterimageCast(frame, f) {
  const N = 10;
  const spin = 6;
  if (f < spin) {
    const p = easeSwing((f + 1) / spin);
    const rx = ORBIT_RX + 34 * (1 - p);
    const ry = ORBIT_RY + 26 * (1 - p);
    for (let i = 0; i < 2; i++) {
      const a = p * TAU * 1.25 + i * Math.PI - 0.6;
      orbitBlade(frame, a, { rx, ry, oy: ORBIT_Y, len: 22 - 4 * p, T: 6, ghosts: 4, ghostBright: 1.1, seed: 5330 + i * 20 });
    }
    if (f === spin - 1) sparkle(frame, 0, ORBIT_Y, 3);
    return;
  }
  const age = f - spin;
  const k = (age + 1) / (N - spin);
  ring(frame, { oy: ORBIT_Y, radius: ORBIT_RY + 4 + age * 5, width: 2 - k * 0.8, squash: ORBIT_RX / ORBIT_RY, erosion: Math.min(0.92, k * 0.9), bright: 0.8 - k * 0.3, seed: 5350 });
  if (age === 0) sparkle(frame, 0, ORBIT_Y, 4);
  shards(frame, age, 14, 5351, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 3.5;
    return { x: Math.cos(a) * ORBIT_RX * 0.8, y: ORBIT_Y + Math.sin(a) * ORBIT_RY, vx: -Math.sin(a) * sp, vy: Math.cos(a) * sp * 0.5, life: 3, size: rnd(3) > 0.7 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 配色: 千刃は鋼の刃の嵐なので steel、朧渡りと残影は影の技なので dark
 */
const FX = {
  moveset: "twinBlades",
  ultimates: {
    "twinBlades.thousandBlades": {
      ramp: "steel",
      cast: { sheet: "twinBladesUlt.thousandBladesCast", life: 0.3 },
      acts: [{ sheet: "twinBladesUlt.thousandBlades", life: 0.7, base: STORM_R / 2, pivot: "pos", ground: "twinBladesUlt.thousandBladesGround" }],
    },
    "twinBlades.hazeWalk": {
      ramp: "dark",
      cast: { sheet: "twinBladesUlt.hazeWalkCast", life: 0.3 },
      acts: [{ sheet: "twinBladesUlt.hazeWalk", life: 0.6, base: HAZE_L / 2, pivot: "pos" }],
    },
    "twinBlades.afterimage": {
      ramp: "dark",
      cast: { sheet: "twinBladesUlt.afterimageCast", life: 0.5 },
      sustain: { sheet: "twinBladesUlt.afterimage", period: 0.6, ground: "twinBladesUlt.afterimageGround" },
    },
  },
};

export const ATLAS = {
  key: "twinBladesUlt",
  fx: FX,
  sheets: [
    { key: "twinBladesUlt.thousandBlades", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 40), draw: thousandBlades },
    { key: "twinBladesUlt.thousandBladesGround", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 8), draw: thousandBladesGround },
    { key: "twinBladesUlt.thousandBladesCast", dirs: 1, frames: 8, active: 0, size: 136, draw: thousandBladesCast },
    { key: "twinBladesUlt.hazeWalk", dirs: DIRS, frames: HAZE_N, active: HAZE_A, size: 2 * (HAZE_L + 40), draw: hazeWalk },
    { key: "twinBladesUlt.hazeWalkCast", dirs: DIRS, frames: 8, active: 0, size: 128, draw: hazeWalkCast },
    { key: "twinBladesUlt.afterimageCast", dirs: 1, frames: 10, active: 0, size: 200, draw: afterimageCast },
    { key: "twinBladesUlt.afterimage", dirs: 1, frames: ORBIT_N, active: 0, size: 128, draw: afterimageSustain },
    { key: "twinBladesUlt.afterimageGround", dirs: 1, frames: ORBIT_N, active: 0, size: 96, draw: afterimageSustainGround },
  ],
};
