// 爪（moveset "claws"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs、形の言葉は claws.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/claws.json × 2 が目安
//
// 爪の形の言葉（3 本の平行な爪痕・中の爪が長い・出血の飛沫）を、奥義では大きく・多く・長くする。決まり:
// - 爪痕は 3 本 1 組（爪の本数）。組どうしは位置か時間をはっきり分け、重なった二重線に見せない
// - 反りは前（外）へふくらむ。白（段 7）は爪の縁・光点だけ
// - 振り終わりは崩れ（erosion）と飛沫で消える
import { arcLine, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1 } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 爪の本数（獣の前足の 3 本爪） */
const CLAW_COUNT = 3;
/** 足元の輪の中心の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

/**
 * 爪痕のセット 1 つ（claws.mjs の clawSet を奥義向けに写したもの: 飛沫の数・速さ・崩れの長さを大きく取れる）。
 * s.at で出て s.grow 枚で伸び切り、s.life 枚で崩れる。s.ang = 走る向き、(s.x, s.y) = 組の中心、L = 長さ、gap = 爪の間隔
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
  const nx = -dy;
  const ny = dx;
  const mid = (CLAW_COUNT - 1) / 2;
  const B = s.bend ?? 3;
  const bend = s.bendRaw ?? (Math.abs(nx) < 0.4 ? B * (s.bendSign ?? 1) : B * Math.sign(nx));
  const seed = s.seed ?? 7;
  const ox = s.x ?? 0;
  const oy = s.y ?? 0;
  for (let i = 0; i < CLAW_COUNT; i++) {
    const side = i - mid;
    const off = side * s.gap;
    const Li = s.L * (side === 0 ? 1 : 0.78 + 0.1 * hash1(i, seed));
    const shift = (side === 0 ? s.L * 0.06 : 0) + (hash1(i, seed + 1) - 0.5) * s.L * 0.12;
    const cx = ox + nx * off + dx * shift;
    const cy = oy + ny * off + dy * shift;
    // 外の爪がわずかに遅れて伸びる（1 本ずつ引っかく手触り）
    const gi = clamp01(g * 1.15 - Math.abs(side) * 0.12);
    if (gi <= 0) continue;
    const back = k * 0.55;
    const T = s.T * (1 - k * 0.45) * (side === 0 ? 1 : 0.85);
    lens(frame, {
      ax: cx - dx * Li * (0.5 - back),
      ay: cy - dy * Li * (0.5 - back),
      bx: cx + dx * Li * 0.5,
      by: cy + dy * Li * 0.5,
      T,
      bend: bend * (1 - back),
      grow: gi,
      bias: 0.2,
      erosion: k * 0.9,
      seed: seed + 10 + i,
      bright: (s.bright ?? 1) * (1 - k * 0.25),
    });
  }
  if (age === G - 1 && s.glint) sparkle(frame, ox + dx * s.L * 0.5, oy + dy * s.L * 0.5, s.glint);
  const drops = s.drops ?? 5;
  if (drops > 0 && age >= G - 1) {
    shards(frame, age - (G - 1), drops, seed + 30, (i, rnd) => {
      const t = 0.1 + 0.6 * rnd(1);
      const j = Math.floor(rnd(2) * CLAW_COUNT) - mid;
      const spread = (rnd(3) - 0.5) * 0.9;
      const sp = (s.dropSpeed ?? 3) * (0.6 + 0.8 * rnd(4));
      return {
        x: ox + nx * j * s.gap + dx * s.L * (t - 0.3),
        y: oy + ny * j * s.gap + dy * s.L * (t - 0.3),
        vx: (dx + nx * spread) * sp,
        vy: (dy + ny * spread) * sp,
        life: 3 + Math.floor(rnd(5) * 3),
        size: rnd(6) > 0.5 ? 2 : 1,
      };
    });
  }
}

/**
 * 重さのある血の滴（shards は等速の減速だけなので、落ちる滴は自前で動かす）。
 * spawn(i, rnd) → {x, y, vx, vy, life, size}。1 フレームごとに vy へ grav が足される
 */
function drips(frame, age, count, seed, grav, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const x = s.x + s.vx * age;
    const y = s.y + s.vy * age + 0.5 * grav * age * age;
    const fade = 1 - age / (s.life + 1);
    const level = Math.max(2, Math.round(2 + 4 * fade));
    dot(frame, x, y, level);
    // 大きい滴は落ちる向きに 1 ドットの尾
    if ((s.size ?? 1) >= 2) dot(frame, x - s.vx * 0.4, y - (s.vy + grav * age) * 0.4, Math.max(1, level - 2));
  }
}

// -----------------------------------------------------------------------------
// 爪嵐（nova 半径 40・6 段ヒット）: 自分の周りを 3 本爪の組が時計回りに 6 度引き裂き、渦の風と飛沫の輪が残る
// -----------------------------------------------------------------------------

/** 爪嵐の当たりの半径（40 論理 px × 2） */
const STORM_R = 80;
const STORM_N = 13;
const STORM_A = 7;
/** 6 段ヒット = 6 組。1 枚に 1 組ずつ、60° ずつ時計回りに進む（嵐が回って見える）。内外を交互に */
const STORM_SETS = Array.from({ length: 6 }, (_, j) => {
  const a = -Math.PI / 2 + j * (TAU / 6) + (hash1(j, 2001) - 0.5) * 0.3;
  const r = j % 2 === 0 ? 50 : 38;
  // 接線（時計回りの進む向き）から少し外へ傾ける: 引き裂きながら外へ払う
  const tilt = -0.35 + (hash1(j, 2002) - 0.5) * 0.3;
  return { a, r, tilt, last: j === 5 };
});

function clawStormSlash(frame, f) {
  STORM_SETS.forEach((st, j) => {
    const big = st.last ? 1.2 : 1;
    clawSet(frame, f, {
      at: j,
      grow: 2,
      life: st.last ? 5 : 4,
      ang: st.a + Math.PI / 2 + st.tilt,
      x: Math.cos(st.a) * st.r,
      y: Math.sin(st.a) * st.r,
      L: 56 * big,
      gap: 8 * big,
      T: 5.2 * big,
      bendRaw: -5,
      glint: st.last ? 4 : 3,
      seed: 2011 + j * 10,
      drops: 7,
      dropSpeed: 4,
    });
  });
  // 渦の風: 当たりの縁の外を、爪の組を追って時計回りに走る細い弧（刃ではないので暗く細い）
  if (f < STORM_A + 1) {
    const head = -Math.PI / 2 + (f + 1) * (TAU / 6);
    // 2 本を長さと先端でずらす（同じ長さで並べると二重線に見える）
    for (let i = 0; i < 2; i++) {
      const end = head - 0.15 - 0.45 * i;
      const len = 1.1 - 0.45 * i;
      arcLine(frame, { radius: STORM_R + 2 + i * 6, from: end - len, to: end, bright: 0.5 - i * 0.15 });
    }
  }
  // 最後の組を裂き切った瞬間: 全周から外へ飛沫の輪が弾ける
  if (f >= STORM_A - 1) {
    const age = f - (STORM_A - 1);
    shards(frame, age, 40, 2041, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = 26 + 40 * rnd(2);
      const sp = 3.5 + rnd(3) * 5;
      // 渦の向き（時計回り）に少し流す
      const vx = Math.cos(a) * sp - Math.sin(a) * sp * 0.35;
      const vy = Math.sin(a) * sp + Math.cos(a) * sp * 0.35;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, life: 3 + Math.floor(rnd(4) * 4), size: rnd(5) > 0.4 ? 2 : 1 };
    });
    if (age <= 3) ring(frame, { radius: STORM_R - 6 + age * 5, width: 2.4 - age * 0.4, erosion: 0.2 + age * 0.22, bright: 0.6 - age * 0.1, seed: 2042 });
  }
}

/** 爪嵐の地面: 当たりの縁の輪と、爪の組が裂いた所に落ちる血の染み（組が出た順に増え、最後に薄れる） */
function clawStormGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < 8 ? 0 : (f - 7) / (STORM_N - 8);
  const dim = 0.4 * (1 - k * 0.5);
  ring(frame, { radius: (STORM_R - 2) * (0.75 + 0.25 * grow), width: 2, erosion: k * 0.9, bright: dim, seed: 2051 });
  STORM_SETS.forEach((st, j) => {
    if (f < j + 1) return;
    for (let i = 0; i < 6; i++) {
      const a = st.a + (hash1(i, 2052 + j) - 0.5) * 0.7;
      const r = st.r + (hash1(i, 2053 + j) - 0.5) * 22;
      if (hash1(i + f * 7, 2054 + j) < k) continue;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, i % 3 === 0 ? 3 : 2);
    }
  });
}

/** 爪嵐の発動: 3 本の鉤爪（小さな三日月）が自分の周りを回りながら締まり、締まりきって外へ弾ける */
function clawStormCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = (f + 1) / gather;
    const R = 40 - 18 * p;
    const spin = p * 2.2;
    for (let i = 0; i < 3; i++) {
      const head = spin + (i * TAU) / 3;
      crescent(frame, { R, T: 5 + 2 * p, head, tail: head - 1.1, erosion: 0.03, bright: 0.7 + 0.3 * p, seed: 2061 + i, streak: 0.2, edge: 1.2, peak: 0.15 });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  // 弾ける鉤爪: 3 本が外へ開きながら崩れる
  for (let i = 0; i < 3; i++) {
    const head = 2.2 + 0.5 * k + (i * TAU) / 3;
    crescent(frame, { R: 22 + k * 22, T: 7 * (1 - k * 0.5), head, tail: head - 1.1 + k * 0.4, erosion: 0.1 + k * 0.8, bright: 1 - k * 0.3, seed: 2064 + i, streak: 0.2, edge: 1.2, peak: 0.15 });
  }
  if (f === gather) sparkle(frame, 0, 0, 4);
  shards(frame, f - gather, 12, 2067, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 首狩り跳び（lunge 90・幅 30・heavy）: 通り道に 3 本の長い爪痕が走り、跳んだ先で首を刈る大きな爪痕が交わる
// -----------------------------------------------------------------------------

/** 跳ぶ長さ（90 論理 px × 2） */
const LEAP_L = 180;
/** 当たりの幅の半分（幅 30 論理 px） */
const LEAP_HALF = 30;
const LEAP_N = 11;
const LEAP_A = 4;

function neckLeapSlash(frame, f) {
  const A = LEAP_A;
  const k = f < A ? 0 : (f - A + 1) / (LEAP_N - A + 1);
  // 1) 通り道の 3 本の爪痕（1 組）: 始点から終点へ 3 枚で伸び、振り終わりは始点側から崩れて終点へ縮む
  const grow = f < 3 ? easeSwing((f + 1) / 3) : 1;
  for (let i = 0; i < CLAW_COUNT; i++) {
    const side = i - 1;
    const y = side * 11;
    const x0 = (side === 0 ? 0 : 14) + LEAP_L * 0.55 * Math.pow(k, 1.2);
    const x1 = LEAP_L - (side === 0 ? 4 : 22);
    const gi = clamp01(grow * 1.1 - Math.abs(side) * 0.08);
    if (gi <= 0 || x1 - x0 < 4) continue;
    lens(frame, { ax: x0, ay: y, bx: x1, by: y, T: (side === 0 ? 6 : 5) * (1 - k * 0.5), bend: side * 3, grow: gi, bias: 0.2, erosion: f < A ? 0.02 : 0.05 + 0.85 * k, seed: 2101 + i, bright: 1 - k * 0.25 });
  }
  // 2) 跳んだ先（終点）で首を刈る大きな爪痕: 通り道に斜めに交わる 1 組。重い一撃なので太く長く、飛沫が多い
  clawSet(frame, f, { at: 2, grow: 2, life: 6, ang: 62 * DEG, x: LEAP_L - 14, y: 0, L: 80, gap: 13, T: 8.5, bend: 5, glint: 4, seed: 2111, drops: 16, dropSpeed: 5 });
  // 3) 通り道の風: 当たりの幅の縁を、前へ流れる速度線（爪痕より暗く疎らに）
  if (f >= 1 && k < 0.8) {
    // 爪痕から離して当たりの幅の縁に置く（近いと 4 本目・5 本目の爪に見える）
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (LEAP_HALF + 2 + hash1(i, 2121) * 6);
      const len = (24 + 30 * hash1(i, 2122)) * (1 - k * 0.6);
      const x1 = LEAP_L * (0.35 + 0.4 * hash1(i, 2123)) + k * 24;
      streakLine(frame, { ax: Math.max(-10, x1 - len), ay: y, bx: x1, by: y, bright: 0.28 * (1 - k) });
    }
  }
  // 4) 通り道の出血: 3 本の爪痕の上から、左右（爪痕に直交）へ飛沫
  if (f >= 2) {
    shards(frame, f - 2, 26, 2131, (i, rnd) => {
      const t = 0.1 + 0.8 * rnd(1);
      const j = Math.floor(rnd(2) * CLAW_COUNT) - 1;
      const side = j === 0 ? (rnd(3) > 0.5 ? 1 : -1) : j;
      const sp = 2 + rnd(4) * 3.5;
      return { x: LEAP_L * t, y: j * 11, vx: (0.4 + 0.5 * rnd(5)) * sp, vy: side * sp, life: 3 + Math.floor(rnd(6) * 3), size: rnd(7) > 0.5 ? 2 : 1 };
    });
  }
  // 5) 首を刈った瞬間の閃き（弧を足すと 4 本目の爪に見えるので光点だけ）
  if (f === 3) sparkle(frame, LEAP_L - 14, 0, 4);
}

/** 首狩り跳びの発動: 身を沈める踏み切り（後ろに潰れた輪と蹴り上げた砂）と、前へ開く 3 本の爪の構え */
function neckLeapCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  // 爪の構え: 前へ扇に開く 3 本（跳び食らいの形を小さく鋭く）
  if (f <= 3) {
    const p = easeSwing((f + 1) / 3);
    const back = f === 3 ? 0.5 : 0;
    for (let i = 0; i < 3; i++) {
      // 根元を上下に離す（1 点から開くと矢じりに見える）
      const a = (i - 1) * 14 * DEG;
      const L = i === 1 ? 36 : 30;
      const sy = (i - 1) * 7;
      lens(frame, { ax: 2 + Math.cos(a) * L * back, ay: sy + Math.sin(a) * L * back, bx: 2 + Math.cos(a) * L, by: sy + Math.sin(a) * L, T: i === 1 ? 4.5 : 3.8, bend: (1 - i) * 2, grow: clamp01(p * 1.1 - Math.abs(i - 1) * 0.1), bias: 0.2, erosion: back * 0.6, seed: 2141 + i });
    }
    if (f === 1) sparkle(frame, 36, 0, 3);
  }
  ring(frame, { ox: -8 - f * 2, radius: 6 + f * 5, width: 2.4 - k, squash: 0.5, erosion: Math.min(0.9, k * 0.9), bright: 0.75 - k * 0.3, seed: 2151 });
  shards(frame, f, 12, 2152, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.8;
    const sp = 3 + rnd(2) * 3.5;
    return { x: -8, y: (rnd(3) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.6 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 血の疾走（持続）: 足元から血が噴き、爪痕が上へ裂けて昂ぶる。持続中は 3 本爪の印が周りを駆け回り、血が滴る
// dirs 1（画面に揃える）: 落ちる滴と立ちのぼる向きは向きによらず画面の上下
// -----------------------------------------------------------------------------

/** 血の疾走の発動: 左右で爪痕が下から上へ裂け、血が噴き上がって落ちる。足元で輪が弾ける */
function bloodRunCast(frame, f) {
  const N = 11;
  const k = f / (N - 1);
  ring(frame, { oy: FEET_Y, radius: 8 + f * 5, width: 2.6 - k * 1.2, squash: 2.2, erosion: Math.min(0.92, k * 0.95), bright: 0.8 - k * 0.3, seed: 2201 });
  // 上へ裂ける爪痕: 左右の 2 組を 1 枚ずらして（昂ぶって自分を掻き立てる）
  clawSet(frame, f, { at: 0, grow: 2, life: 5, ang: -100 * DEG, x: -24, y: -6, L: 58, gap: 8, T: 5.5, bend: 4, glint: 3, seed: 2211, drops: 0 });
  clawSet(frame, f, { at: 1, grow: 2, life: 5, ang: -80 * DEG, x: 24, y: -6, L: 58, gap: 8, T: 5.5, bend: 4, glint: 3, seed: 2221, drops: 0 });
  // 噴き上がって落ちる血
  if (f >= 1) {
    drips(frame, f - 1, 30, 2231, 1.1, (i, rnd) => {
      const x = (rnd(1) - 0.5) * 50;
      return { x, y: FEET_Y - 4 - rnd(2) * 20, vx: x * 0.06 + (rnd(3) - 0.5) * 2, vy: -(5 + rnd(4) * 5), life: 5 + Math.floor(rnd(5) * 4), size: rnd(6) > 0.45 ? 2 : 1 };
    });
  }
  if (f === 3) sparkle(frame, 0, -30, 3);
}

/** 纏いの 1 巡のフレーム数 */
const RUN_N = 12;
/** 纏いの爪の印の軌道（楕円。キャラの顔を覆わないよう横に広く） */
const RUN_RX = 34;
const RUN_RY = 24;

/** 3 本爪の小さな印（軌道の接線に並ぶ短い 3 本）。位相で伸び縮みして、駆け抜ける爪の閃きに見せる */
function clawGlyph(frame, x, y, ang, t, seed) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const nx = -dy;
  const ny = dx;
  // 出て（前半）伸び、後半は尾から縮んで消える
  const grow = Math.min(1, t / 0.35);
  const back = Math.max(0, (t - 0.5) / 0.5);
  if (back >= 1) return;
  for (let i = 0; i < CLAW_COUNT; i++) {
    const side = i - 1;
    const L = side === 0 ? 22 : 17;
    const cx = x + nx * side * 6 + dx * (side === 0 ? 1.5 : 0);
    const cy = y + ny * side * 5 + dy * (side === 0 ? 1.5 : 0);
    lens(frame, {
      ax: cx - dx * L * (0.5 - back * 0.9),
      ay: cy - dy * L * (0.5 - back * 0.9),
      bx: cx + dx * L * 0.5,
      by: cy + dy * L * 0.5,
      T: 3.8 * (1 - back * 0.4),
      bend: -2,
      grow: clamp01(grow * 1.1 - Math.abs(side) * 0.1),
      bias: 0.2,
      erosion: back * 0.7,
      seed: seed + i,
      bright: 0.9 * (1 - back * 0.3),
    });
  }
}

/** 血の疾走の纏い（持続中ずっと。period 秒で 1 巡。2 つの印が半周ずれて回るので 1 巡で継ぎ目が出ない） */
function bloodRunSustain(frame, f) {
  const cycle = f / RUN_N;
  // 駆け回る 3 本爪の印: 楕円の軌道を時計回りに、半周ずつ遅れて 2 つ。1 巡で半周（2 つが入れ替わる）
  for (let j = 0; j < 2; j++) {
    const a = -Math.PI / 2 + (cycle + j) * Math.PI;
    const x = Math.cos(a) * RUN_RX;
    const y = Math.sin(a) * RUN_RY;
    // 接線（時計回りの進む向き）
    const tang = Math.atan2(Math.cos(a) * RUN_RY, -Math.sin(a) * RUN_RX);
    // 印は軌道の半周ごとに 1 度閃く（位相は 1 巡で一周）
    clawGlyph(frame, x, y, tang, cycle, 2301 + j * 10);
    // 印の後ろに軌道の風（外へふくらむ細い線）
    for (let s = 1; s <= 3; s++) {
      const b = a - s * 0.22;
      dot(frame, Math.cos(b) * (RUN_RX + 5), Math.sin(b) * (RUN_RY + 5), Math.max(2, 5 - s));
    }
  }
  // 滴る血: 手元（左右）と周りから落ち、1 巡で元へ戻る
  for (let i = 0; i < 12; i++) {
    const t = (cycle + hash1(i, 2311)) % 1;
    const x = (hash1(i, 2312) - 0.5) * 72;
    const y0 = -14 + hash1(i, 2313) * 22;
    const y = y0 + t * t * 34;
    if (Math.abs(x) < 10 && y < 14) continue;
    const level = Math.max(2, Math.round(5 - 3 * t));
    dot(frame, x, y, level);
    if (t < 0.6) dot(frame, x, y - 1, Math.max(1, level - 2));
  }
}

/** 纏いの足元: 脈打つ楕円の輪と、3 か所の短い爪の引っかき傷（3 回対称で 1 巡に 1/3 回るので継ぎ目が出ない） */
function bloodRunSustainGround(frame, f) {
  const cycle = f / RUN_N;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU);
  ring(frame, { oy: FEET_Y, radius: 16 + pulse, width: 1.8, squash: 2.2, bright: 0.32 + 0.14 * pulse, seed: 2321 });
  for (let j = 0; j < 3; j++) {
    const a = (j / 3 + cycle / 3) * TAU;
    const cx = Math.cos(a) * 44;
    const cy = FEET_Y + Math.sin(a) * 18;
    // 接線に沿う 3 本の短い傷（地面に残る爪痕）
    const tx = -Math.sin(a) * 44;
    const ty = Math.cos(a) * 18;
    const tl = Math.hypot(tx, ty);
    const ux = tx / tl;
    const uy = ty / tl;
    for (let i = -1; i <= 1; i++) {
      const ox = cx + -uy * i * 3;
      const oy = cy + ux * i * 3;
      streakLine(frame, { ax: ox - ux * 5, ay: oy - uy * 5, bx: ox + ux * 5, by: oy + uy * 5, width: 1.2, bright: 0.28 + 0.12 * pulse });
    }
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 配色: 爪嵐は爪の鋼（steel）、首狩り跳びは見せ場の閃き（light）、血の疾走は血の赤に寄せて fire
 */
const FX = {
  moveset: "claws",
  ultimates: {
    "claws.clawStorm": {
      ramp: "steel",
      cast: { sheet: "clawsUlt.clawStormCast", life: 0.3 },
      acts: [{ sheet: "clawsUlt.clawStorm", life: 0.6, base: STORM_R / 2, pivot: "pos", ground: "clawsUlt.clawStormGround" }],
    },
    "claws.neckLeap": {
      ramp: "light",
      cast: { sheet: "clawsUlt.neckLeapCast", life: 0.25 },
      acts: [{ sheet: "clawsUlt.neckLeap", life: 0.5, base: LEAP_L / 2, pivot: "pos" }],
    },
    "claws.bloodRun": {
      ramp: "fire",
      cast: { sheet: "clawsUlt.bloodRunCast", life: 0.55 },
      sustain: { sheet: "clawsUlt.bloodRun", period: 0.7, ground: "clawsUlt.bloodRunGround" },
    },
  },
};

export const ATLAS = {
  key: "clawsUlt",
  fx: FX,
  sheets: [
    { key: "clawsUlt.clawStorm", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 40), draw: clawStormSlash },
    { key: "clawsUlt.clawStormGround", dirs: 1, frames: STORM_N, active: STORM_A, size: 2 * (STORM_R + 8), draw: clawStormGround },
    { key: "clawsUlt.clawStormCast", dirs: 1, frames: 8, active: 0, size: 112, draw: clawStormCast },
    { key: "clawsUlt.neckLeap", dirs: DIRS, frames: LEAP_N, active: LEAP_A, size: 2 * (LEAP_L + 56), draw: neckLeapSlash },
    { key: "clawsUlt.neckLeapCast", dirs: DIRS, frames: 7, active: 0, size: 112, draw: neckLeapCast },
    { key: "clawsUlt.bloodRunCast", dirs: 1, frames: 11, active: 0, size: 176, draw: bloodRunCast },
    { key: "clawsUlt.bloodRun", dirs: 1, frames: RUN_N, active: 0, size: 128, draw: bloodRunSustain },
    { key: "clawsUlt.bloodRunGround", dirs: 1, frames: RUN_N, active: 0, size: 128, draw: bloodRunSustainGround },
  ],
};
