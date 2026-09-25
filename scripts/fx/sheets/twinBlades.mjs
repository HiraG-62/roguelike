// 双剣（moveset "twinBlades"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/twinBlades.json）× 2 が目安
//
// 性格: 2 本の短刀で素早く刻む。剣より細く・短く・鋭い斬線を、角度とタイミングをずらして手数で見せる。
// 崩れも速く（振り終わりは 3〜4 枚）、粒は細かい（刃片は 1 ドットが多い）。突進は細く長い一閃 + 後ろへ流れる影の残像
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { hash1 } from "../raster.mjs";
import { DEG, DIRS, arcSlash } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 共通の道具
// -----------------------------------------------------------------------------

/**
 * 作業面を「ずらして回した」座標系で塗るための写し。部品（arcSlash・lens など）は原点と +x を前提に描くので、
 * 1 枚の中で角度と位置の違う短い斬線を何本も置くには、座標系ごと動かすのが一番素直。flip は上下反転（逆回りの振り）
 */
function place(frame, o) {
  const tx = o.x ?? 0;
  const ty = o.y ?? 0;
  const rot = (o.rot ?? 0) * DEG;
  const fy = o.flip ? -1 : 1;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const view = Object.create(frame);
  view.toGrid = (x, y) => {
    const ly = y * fy;
    return frame.toGrid(tx + x * c - ly * s, ty + x * s + ly * c);
  };
  view.toCanon = (gx, gy) => {
    const p = frame.toCanon(gx, gy);
    const dx = p.x - tx;
    const dy = p.y - ty;
    return { x: dx * c + dy * s, y: (-dx * s + dy * c) * fy };
  };
  return view;
}

/** 短い弧の一振り。start フレームから spec の時間割で描く（範囲外は描かない）。at で位置・角度・反転 */
function arcCut(frame, f, spec, at = {}) {
  const g = f - (spec.start ?? 0);
  if (g < 0 || g >= spec.frames) return;
  arcSlash(at.x || at.y || at.rot || at.flip ? place(frame, at) : frame, g, spec);
}

/**
 * ほぼ直線の短い斬線（短刀の一閃）。a → b へ grow フレームで伸び、fade フレームで痩せて崩れる。
 * bend は前（法線 +）へのふくらみ。伸び切りの瞬間に先端へ小さな光点、崩れで細かい粒が線に沿って散る
 */
function quickCut(frame, f, o) {
  const g = f - (o.start ?? 0);
  const grow = o.grow ?? 2;
  const fade = o.fade ?? 3;
  if (g < 0 || g >= grow + fade) return;
  const p = g < grow ? easeSwing((g + 1) / grow) : 1;
  const k = g < grow ? 0 : (g - grow + 1) / (fade + 1);
  const bright = o.bright ?? 1;
  // 崩れは尾（a 側）から先に食われて、先端側へ縮む
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
      const sp = 1.8 + rnd(3) * 2.4;
      // 刃の進む向きへ流れ、少しだけ横へ
      const vx = tx * sp - ty * side * sp * 0.35;
      const vy = ty * sp + tx * side * sp * 0.35;
      return { x: o.ax + (o.bx - o.ax) * t, y: o.ay + (o.by - o.ay) * t, vx, vy, life: 2 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.75 ? 2 : 1 };
    });
  }
}

/** 影の速度線の束（突進の後ろに流れる）。x0 = 束の先頭、len = 長さ、k = 崩れ（0..1）。暗い段で残像に見せる */
function shadowLines(frame, o) {
  const { x0, len, k, count, spread, seed } = o;
  if (k >= 0.95) return;
  for (let i = 0; i < count; i++) {
    const y = (i - (count - 1) / 2) * spread + (hash1(i, seed) - 0.5) * spread * 0.6;
    if (Math.abs(y) < 2) continue;
    const l = len * (0.45 + 0.55 * hash1(i, seed + 1)) * (1 - k * 0.6);
    const x1 = x0 - Math.abs(y) * 0.8 - hash1(i, seed + 2) * 10 - k * 18;
    streakLine(frame, { ax: x1 - l, ay: y, bx: x1, by: y, bright: (o.bright ?? 0.4) * (1 - k) });
  }
}

/** 残像（影踏み）: 一閃の後ろに、暗く細いレンズを間を空けて並べる。後ろほど暗く短い */
function afterimages(frame, o) {
  const { from, to, count, k, seed } = o;
  for (let i = 0; i < count; i++) {
    const u = (i + 1) / (count + 1);
    const cx = to + (from - to) * u - k * 10;
    const l = (o.len ?? 16) * (1 - u * 0.5);
    const b = (0.55 - u * 0.2) * (1 - k * 0.8);
    if (b < 0.08) continue;
    lens(frame, { ax: cx - l, ay: 0, bx: cx, by: 0, T: 5 * (1 - u * 0.35), bias: 0, erosion: Math.min(0.9, k * 0.75 + u * 0.1), seed: seed + i, bright: b });
  }
}

// -----------------------------------------------------------------------------
// 左の段（5 連撃）。1 振りごとに違う形: 小さな三日月 → ほぼ直線の返し → 2 回刻み → 低い払い → 挟み斬り
// -----------------------------------------------------------------------------

/** 1 段目（box reach 14 / size 22）: 前に寄せた小さな半径の三日月。剣の l1 より半径も太さも半分ほど */
const L1 = { ox: 6, R: 34, T: 9, sweep: 118, tilt: -4, frames: 7, active: 3, tailLen: 0.75, overshoot: 0.05, erodeFrom: 0.08, lines: 1, shards: 5, shardSpeed: 3.2, glint: 3, seed: 1101, streak: 0.3 };
/** 2 段目（返し。描画側が上下反転）: 後ろに中心を置いた大きな半径で、ほぼ直線の短い斬線にする */
const L2 = { ox: -34, R: 66, T: 8, sweep: 44, tilt: 6, frames: 7, active: 3, tailLen: 0.8, overshoot: 0.06, erodeFrom: 0.08, lines: 0, shards: 5, shardSpeed: 3.5, glint: 3, seed: 1202, streak: 0.3 };

/** 3 段目（box reach 14 / size 24・2 回斬る）: 上から袈裟に 1 本、1 フレーム半遅れて下から逆袈裟にもう 1 本。角度をはっきり変える */
function l3(frame, f) {
  quickCut(frame, f, { start: 0, grow: 2, fade: 3, ax: 4, ay: -26, bx: 40, by: 12, T: 7, bend: -5, seed: 1301, glint: 2, dust: 4 });
  quickCut(frame, f, { start: 3, grow: 2, fade: 4, ax: 8, ay: 24, bx: 44, by: -10, T: 7.5, bend: 5, seed: 1311, glint: 3, dust: 5 });
}

/** 4 段目（box reach 14 / size 22・逆回り）: 低く横へ払う浅い三日月。1 段目より平たく、前寄り */
const L4 = { ox: 12, R: 30, T: 8, sweep: 104, tilt: 18, frames: 7, active: 3, tailLen: 0.7, overshoot: 0.05, erodeFrom: 0.08, lines: 1, shards: 5, shardSpeed: 3.2, glint: 3, seed: 1404, streak: 0.3 };

/**
 * 5 段目（終撃・box reach 16 / size 30・heavy）: 2 本の短刀の挟み斬り。上からの三日月と、1 フレーム遅れて下からの三日月（上下反転）が
 * 前で噛み合い、合わさった所で光点と細かい刃片が弾ける
 */
const L5_UP = { ox: 0, R: 36, T: 11, sweep: 96, tilt: -44, frames: 7, active: 3, tailLen: 0.75, overshoot: 0.04, erodeFrom: 0.06, lines: 2, shards: 6, shardSpeed: 3.8, glint: 2, seed: 1501, streak: 0.3 };
const L5_DN = { ...L5_UP, start: 1, R: 34, seed: 1511 };
function l5(frame, f) {
  arcCut(frame, f, L5_UP, { x: 10, y: 0 });
  arcCut(frame, f, L5_DN, { x: 10, y: 0, flip: true });
  if (f === 3) sparkle(frame, 44, 0, 3);
  if (f >= 3) {
    shards(frame, f - 3, 10, 1521, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.2;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 42, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.7 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 突進の一閃（ダッシュ・影踏み・影裂き）と突き（交差突き）
// -----------------------------------------------------------------------------

/**
 * 細く長い一閃の時間割（原点 = 自分）。from → to へ A フレームで走り、以後は尾から痩せて消える。
 * 返り値の k（崩れ 0..1）と head（先端）を、残像や速度線の配置に使う
 */
function flash(frame, f, o) {
  const { A, N, from, to, T, seed } = o;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const head = from + (to - from) * p + k * 4;
  const back = f < A ? Math.max(from, head - (to - from) * 0.75) : from + (to - from) * (0.25 + 0.7 * k);
  if (head - back > 4) {
    lens(frame, { ax: back, ay: 0, bx: head, by: 0, T: T * (1 - k * 0.5), bias: 0, erosion: k * 0.85, seed, bright: 1 - k * 0.2 });
    // 刃の縁の細い芯（段 7 は線だけ）
    if (k < 0.5) streakLine(frame, { ax: back + (head - back) * 0.35, ay: 0, bx: head - 2, by: 0, width: 1, bright: 1 });
  }
  if (f === A - 1) sparkle(frame, head - 1, 0, o.glint ?? 3);
  return { k, head, p };
}

/** ダッシュ攻撃（thrust reach 34）: 細く長い一閃 + 後ろへ流れる影の速度線 */
function dash(frame, f) {
  const { k, head } = flash(frame, f, { A: 3, N: 7, from: -8, to: 72, T: 5, seed: 2101 });
  shadowLines(frame, { x0: head - 10, len: 40, k, count: 6, spread: 5, seed: 2102, bright: 0.42 });
  if (f >= 2) {
    shards(frame, f - 2, 6, 2103, (i, rnd) => ({ x: 68, y: (rnd(1) - 0.5) * 4, vx: 2 + rnd(2) * 3, vy: (rnd(3) - 0.5) * 3, life: 2 + Math.floor(rnd(4) * 2), size: 1 }));
  }
}

/** 右: 影踏み（thrust reach 34・踏み込み 28）: 背後から抜ける一閃と、踏み込みの道に残る影の残像 3 つ */
function shadowStep(frame, f) {
  const { k, head } = flash(frame, f, { A: 3, N: 8, from: -16, to: 72, T: 4.5, seed: 2201, glint: 3 });
  // 残像は踏み込む前の道（自分の後ろ）。一閃と重ならないので、影が置き去りにされたように見える
  if (f >= 1) afterimages(frame, { from: -84, to: -14, count: 3, k, seed: 2202, len: 20 });
  shadowLines(frame, { x0: head - 16, len: 46, k, count: 4, spread: 7, seed: 2205, bright: 0.34 });
  if (f >= 2) {
    shards(frame, f - 2, 7, 2206, (i, rnd) => ({ x: 70, y: (rnd(1) - 0.5) * 4, vx: 1.5 + rnd(2) * 3, vy: (rnd(3) - 0.5) * 3.5, life: 2 + Math.floor(rnd(4) * 2), size: 1 }));
  }
}

/**
 * 派生: 影裂き（thrust reach 40・2 回・踏み込み 30）: 長い一閃が抜けた直後、先端で縦に短く裂く 2 本目。
 * 1 本目は前へ、2 本目は直交するので二重線にならない。後ろには影の残像
 */
function shadowRend(frame, f) {
  const { k, head } = flash(frame, f, { A: 3, N: 9, from: -20, to: 82, T: 4.5, seed: 2301, glint: 2 });
  if (f >= 1) afterimages(frame, { from: -96, to: -18, count: 4, k, seed: 2302, len: 18 });
  shadowLines(frame, { x0: head - 16, len: 50, k, count: 4, spread: 7, seed: 2307, bright: 0.32 });
  quickCut(frame, f, { start: 3, grow: 2, fade: 4, ax: 66, ay: -22, bx: 74, by: 22, T: 6.5, bend: -4, seed: 2311, glint: 3, dust: 7 });
}

/**
 * 右: 交差突き（thrust reach 30・2 回）: 上の後ろ・下の後ろから細い突きが 1 本ずつ、1 フレーム半ずらして穂先で交わる。
 * 交点は前方の小さな X（穂先の閃き）
 */
function crossThrust(frame, f) {
  const tip = 62;
  quickCut(frame, f, { start: 0, grow: 2, fade: 3, ax: 4, ay: -14, bx: tip + 4, by: 3, T: 4.5, seed: 2401, dust: 3 });
  quickCut(frame, f, { start: 2, grow: 2, fade: 4, ax: 4, ay: 14, bx: tip + 4, by: -3, T: 4.5, seed: 2411, dust: 3 });
  if (f === 1 || f === 3) sparkle(frame, tip, 0, f === 3 ? 3 : 2);
  if (f >= 3) {
    shards(frame, f - 3, 7, 2421, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.8;
      const sp = 2 + rnd(2) * 3;
      return { x: tip, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.7 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 右の段の斬り（舞い斬り・逆手斬り・影止め）
// -----------------------------------------------------------------------------

/** 右: 舞い斬り（arc 200° reach 22・2 回）: 前半 100° を 1 本目、1 フレーム半遅れて後半 100° を半径を変えた 2 本目。身を回して刻む */
const DANCE_A = { R: 44, T: 9, sweep: 100, tilt: -50, frames: 6, active: 3, tailLen: 0.8, overshoot: 0.04, erodeFrom: 0.1, lines: 1, shards: 4, shardSpeed: 3, glint: 2, seed: 2501, streak: 0.3 };
const DANCE_B = { R: 48, T: 10, sweep: 100, tilt: 52, frames: 6, active: 3, tailLen: 0.8, overshoot: 0.05, erodeFrom: 0.08, lines: 1, shards: 6, shardSpeed: 3.4, glint: 3, seed: 2511, streak: 0.3, start: 3 };
function danceCut(frame, f) {
  arcCut(frame, f, DANCE_A);
  arcCut(frame, f, DANCE_B);
}

/** 右: 逆手斬り（box reach 16 / size 26）: 逆手の刃で下から上へ跳ね上げる小さな鉤形の三日月（上下反転して下から振る）。前寄りで半径が最小 */
const BACKHAND = { R: 28, T: 9, sweep: 150, tilt: 0, frames: 7, active: 3, tailLen: 0.7, overshoot: 0.06, erodeFrom: 0.08, lines: 1, shards: 6, shardSpeed: 3.4, glint: 3, seed: 2601, streak: 0.3 };
function backhandCut(frame, f) {
  arcCut(frame, f, BACKHAND, { x: 16, y: 0, flip: true });
}

/**
 * 右: 影止め（box reach 16 / size 30・heavy。原点 = 当たりの中心）: 2 本の短刀を影に突き立てる。
 * 左右から斜めの短い突きが中心へ刺さり、刺さった所に潰れた暗い影の輪と、影を縫う細い棘が放射する
 */
function shadowPin(frame, f) {
  quickCut(frame, f, { start: 0, grow: 2, fade: 5, ax: -30, ay: -20, bx: -2, by: -2, T: 5, seed: 2701, glint: 2, dust: 3 });
  quickCut(frame, f, { start: 1, grow: 2, fade: 5, ax: -30, ay: 20, bx: -2, by: 2, T: 5, seed: 2711, glint: 3, dust: 3 });
  if (f >= 2) {
    const age = f - 2;
    const e = Math.min(0.9, age * 0.2);
    if (age < 4) ring(frame, { radius: 6 + age * 3, width: 2.4, squash: 0.55, erosion: Math.min(0.9, e + age * 0.1), bright: 0.36 - age * 0.04, seed: 2721 });
    if (age < 4) {
      // 影を縫い止める棘: 暗い段の細い線が 6 方向へ
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const r0 = 6 + age * 3;
        const r1 = 12 + age * 3 + hash1(i, 2722) * 6;
        streakLine(frame, { ax: Math.cos(a) * r0 * 0.6, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1 * 0.6, by: Math.sin(a) * r1, bright: 0.42 * (1 - age / 4) });
      }
    }
    if (age <= 1) sparkle(frame, 0, 0, 3 - age);
    shards(frame, age, 8, 2723, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 2 + rnd(2) * 3;
      return { x: 0, y: 0, vx: Math.cos(a) * sp * 0.7, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 派生（交差斬り・十字架・乱れ斬り・影分かれ）
// -----------------------------------------------------------------------------

/** 小さな X の片方の線（反りは前へ）。c は反りでずれた中央を交点へ戻す量 */
const X_BEND = 4;

/** 派生: 交差斬り（box reach 16 / size 34・heavy・2 回。原点 = 当たりの中心）: 細い 2 本が時間差で小さな X に交わる */
function crossing(frame, f) {
  const L = 26;
  const c = X_BEND * Math.SQRT1_2;
  quickCut(frame, f, { start: 0, grow: 2, fade: 5, ax: -L - c, ay: -L + c, bx: L - c, by: L + c, T: 7, bend: -X_BEND, bias: 0, seed: 3101, dust: 4 });
  quickCut(frame, f, { start: 2, grow: 2, fade: 5, ax: -L - c, ay: L - c, bx: L - c, by: -L - c, T: 7, bend: X_BEND, bias: 0, seed: 3111, dust: 4 });
  if (f === 3) sparkle(frame, 0, 0, 3);
  if (f === 4) sparkle(frame, 0, 0, 2);
  if (f >= 3) {
    shards(frame, f - 3, 10, 3121, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.7 ? 2 : 1 };
    });
  }
}

/**
 * 派生: 十字架（box reach 16 / size 34・heavy。原点 = 当たりの中心）: 2 本の短刀を同時に振る正十字。
 * 縦（振りに直交）の長い 1 本と横の短い 1 本が同じフレームで伸び、交点の閃きが四方へ伸びて十字架を刻む。交差斬りの X と形で見分ける
 */
function crossForm(frame, f) {
  quickCut(frame, f, { start: 0, grow: 2, fade: 6, ax: -2, ay: -34, bx: 2, by: 34, T: 7.5, bend: -3, bias: 0, seed: 3201, dust: 5 });
  quickCut(frame, f, { start: 0, grow: 2, fade: 6, ax: -18, ay: -8, bx: 30, by: -8, T: 6.5, bend: 0, bias: 0, seed: 3211, dust: 4 });
  if (f === 1 || f === 2) sparkle(frame, 0, -8, f === 1 ? 4 : 3);
  if (f >= 1 && f <= 3) {
    // 交点から四方へ伸びる細い閃き（十字架の輝き）
    const age = f - 1;
    const r0 = 3 + age * 4;
    const r1 = 10 + age * 5;
    const b = 0.7 * (1 - age / 3);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      streakLine(frame, { ax: dx * r0, ay: -8 + dy * r0, bx: dx * r1, by: -8 + dy * r1, bright: b });
    }
  }
  if (f >= 2) {
    shards(frame, f - 2, 10, 3221, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 2 + rnd(2) * 3;
      return { x: 0, y: -8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.75 ? 2 : 1 };
    });
  }
}

/**
 * 派生: 乱れ斬り（circle size 36・4 回。原点 = 自分）: 円周上に小さな斬線が次々と刻まれる乱舞。
 * 1 フレームに 1〜2 本ずつ、角度を黄金角で散らして現れ、それぞれ速く崩れる
 */
const FLURRY_CUTS = 11;
const GOLDEN = 137.5;
function flurry(frame, f) {
  for (let i = 0; i < FLURRY_CUTS; i++) {
    const start = Math.floor(i * 0.6);
    const a = (i * GOLDEN + 20) * DEG;
    const r = 22 + hash1(i, 3301) * 16;
    const len = 12 + hash1(i, 3302) * 8;
    // 円周の接線に対して ±35° ほど傾けた短い斬線（全部同じ向きだと輪に見えるので崩す）
    const tilt = a + Math.PI / 2 + (hash1(i, 3303) - 0.5) * 70 * DEG;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r;
    const dx = Math.cos(tilt) * len;
    const dy = Math.sin(tilt) * len;
    quickCut(frame, f, { start, grow: 1, fade: 3, ax: cx - dx, ay: cy - dy, bx: cx + dx, by: cy + dy, T: 5, bend: -3, bias: 0.2, seed: 3310 + i * 7, glint: i % 3 === 0 ? 2 : 0, dust: 2 });
  }
}

/**
 * 派生: 影分かれ（circle size 44・3 回。原点 = 自分）: 影の分身 3 体が 120° おきに同時に斬る。
 * 3 回の当たりに合わせて、組の角度を 40° ずつ回して 3 回刻む。斬線の後ろに暗い残像の影が引く
 */
function shadowSplit(frame, f) {
  for (let h = 0; h < 3; h++) {
    const start = h * 2;
    const g = f - start;
    for (let j = 0; j < 3; j++) {
      const a = (j * 120 + h * 40 - 30) * DEG;
      const r = 36 + h * 3;
      const len = 14;
      const tan = a + Math.PI / 2;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const dx = Math.cos(tan) * len;
      const dy = Math.sin(tan) * len;
      quickCut(frame, f, { start, grow: 1, fade: 3, ax: cx - dx, ay: cy - dy, bx: cx + dx, by: cy + dy, T: 6, bend: -4, bias: 0.2, seed: 3401 + h * 10 + j, glint: h === 2 ? 2 : 0, dust: 2 });
      // 分身の影: 斬線の内側から中心へ向かって薄く流れる暗い筋（踏み込んできた道）
      if (g >= 0 && g < 3) {
        const k = g / 3;
        streakLine(frame, { ax: Math.cos(a) * r * 0.4, ay: Math.sin(a) * r * 0.4, bx: Math.cos(a) * (r - 7), by: Math.sin(a) * (r - 7), bright: 0.24 * (1 - k) });
      }
    }
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中（+x = 刃の進む向き）: 細く鋭い小さな切り傷が 2 本、1 フレームずらして浅い角度で交差する（二刀の感触）。
 * heavy は少し大きく、刃片が多く、中心の閃きが強い
 */
function hit(frame, f, heavy) {
  const L = heavy ? 24 : 16;
  const T = heavy ? 6 : 4.5;
  const ang = 24 * DEG;
  const c = Math.cos(ang) * L;
  const s = Math.sin(ang) * L;
  quickCut(frame, f, { start: 0, grow: 1, fade: heavy ? 4 : 3, ax: -c, ay: -s, bx: c, by: s, T, bias: 0.2, seed: heavy ? 4101 : 4201 });
  quickCut(frame, f, { start: 1, grow: 1, fade: heavy ? 4 : 3, ax: -c, ay: s, bx: c, by: -s, T, bias: 0.2, seed: heavy ? 4111 : 4211 });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? (heavy ? 4 : 3) : 2);
  if (f >= 1) {
    shards(frame, f - 1, heavy ? 14 : 7, heavy ? 4121 : 4221, (i, rnd) => {
      const forward = rnd(1) > 0.3;
      const a = forward ? (rnd(2) - 0.5) * 1.3 : (rnd(2) > 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd(3) - 0.5) * 1);
      const sp = (heavy ? 3.2 : 2.4) + rnd(4) * (heavy ? 3.5 : 2);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(5) * 3), size: heavy && rnd(6) > 0.55 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "twinBlades",
  motions: {
    "l:0": { sheet: "twinBlades.l1", pivot: "self", base: 14, measure: "reach" },
    "l:1": { sheet: "twinBlades.l2", pivot: "self", base: 14, measure: "reach" },
    "l:2": { sheet: "twinBlades.l3", pivot: "self", base: 14, measure: "reach" },
    "l:3": { sheet: "twinBlades.l4", pivot: "self", base: 14, measure: "reach" },
    "l:4": { sheet: "twinBlades.l5", pivot: "self", base: 16, measure: "reach" },
    dash: { sheet: "twinBlades.dash", pivot: "self", base: 34, measure: "reach" },
    "r:shadowStep": { sheet: "twinBlades.shadowStep", pivot: "self", base: 34, measure: "reach" },
    "r:crossThrust": { sheet: "twinBlades.crossThrust", pivot: "self", base: 30, measure: "reach" },
    "r:danceCut": { sheet: "twinBlades.danceCut", pivot: "self", base: 22, measure: "reach" },
    "r:backhandCut": { sheet: "twinBlades.backhand", pivot: "self", base: 16, measure: "reach" },
    "r:shadowPin": { sheet: "twinBlades.shadowPin", pivot: "anchor", base: 16, measure: "reach" },
    "branch:crossing": { sheet: "twinBlades.crossing", pivot: "anchor", base: 16, measure: "reach" },
    "branch:flurry": { sheet: "twinBlades.flurry", pivot: "anchor", base: 36, measure: "size" },
    "branch:shadowSplit": { sheet: "twinBlades.shadowSplit", pivot: "anchor", base: 44, measure: "size" },
    "branch:crossForm": { sheet: "twinBlades.crossForm", pivot: "anchor", base: 16, measure: "reach" },
    "branch:shadowRend": { sheet: "twinBlades.shadowRend", pivot: "self", base: 40, measure: "reach" },
  },
  hit: "twinBlades.hit",
  hitHeavy: "twinBlades.hitHeavy",
};

/** 弧の斬撃のシート（作業面は位置のずれ分も含める） */
function arcSheetAt(key, spec, draw, size) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size, draw };
}

export const ATLAS = {
  key: "twinBlades",
  fx: FX,
  sheets: [
    arcSheetAt("twinBlades.l1", L1, (frame, f) => arcSlash(frame, f, L1), 104),
    arcSheetAt("twinBlades.l2", L2, (frame, f) => arcSlash(frame, f, L2), 104),
    { key: "twinBlades.l3", dirs: DIRS, frames: 8, active: 5, size: 112, draw: l3 },
    arcSheetAt("twinBlades.l4", L4, (frame, f) => arcSlash(frame, f, L4), 104),
    { key: "twinBlades.l5", dirs: DIRS, frames: 8, active: 4, size: 120, draw: l5 },
    { key: "twinBlades.dash", dirs: DIRS, frames: 7, active: 3, size: 176, draw: dash },
    { key: "twinBlades.shadowStep", dirs: DIRS, frames: 8, active: 3, size: 176, draw: shadowStep },
    { key: "twinBlades.crossThrust", dirs: DIRS, frames: 7, active: 4, size: 150, draw: crossThrust },
    { key: "twinBlades.danceCut", dirs: DIRS, frames: 9, active: 6, size: 128, draw: danceCut },
    { key: "twinBlades.backhand", dirs: DIRS, frames: 7, active: 3, size: 112, draw: backhandCut },
    { key: "twinBlades.shadowPin", dirs: DIRS, frames: 8, active: 3, size: 96, draw: shadowPin },
    { key: "twinBlades.crossing", dirs: DIRS, frames: 9, active: 4, size: 96, draw: crossing },
    { key: "twinBlades.crossForm", dirs: DIRS, frames: 9, active: 3, size: 96, draw: crossForm },
    { key: "twinBlades.flurry", dirs: 1, frames: 10, active: 6, size: 112, draw: flurry },
    { key: "twinBlades.shadowSplit", dirs: 1, frames: 9, active: 6, size: 128, draw: shadowSplit },
    { key: "twinBlades.shadowRend", dirs: DIRS, frames: 9, active: 5, size: 200, draw: shadowRend },
    { key: "twinBlades.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => hit(frame, f, false) },
    { key: "twinBlades.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 80, draw: (frame, f) => hit(frame, f, true) },
  ],
};
