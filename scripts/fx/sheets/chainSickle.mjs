// moveset "chainSickle"（鎖鎌）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/chainSickle.json）× 2 が目安
//
// 絵の芯は「手元の鎌の鋭さ」と「鎖の長さ」の二面性:
// - 近い弧（左の段・鎌返し・鎖締め・引き斬り）は、半径の小さい鋭い三日月 + 先端の鉤（剣の大きな弧と見分ける）
// - 遠い突き（ダッシュ・分銅・鎌鼬・鎖縛り）は、輪の点列の鎖が一直線に伸び、先端の分銅が弾ける
// - 回転（鎖回し・巻き取り）は、鎖の点列の円 + 先端の分銅の光
import { arcLine, crescent, easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint } from "../raster.mjs";
import { DEG, DIRS, drawArcLines, drawArcShards } from "../motifs.mjs";

// -----------------------------------------------------------------------------
// 共通の部品: 鎖・分銅・鉤・打撃の星
// -----------------------------------------------------------------------------

/** 鎖の輪の間隔（絵のドット）。輪 1 つ = 論理 2px ほど。これより詰めると点列でなく太い線に見える */
const LINK_STEP = 4.2;

/** 点列 pts（[x, y] の配列。先頭 = 鎖の先）の弧長の表 */
function pathTable(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    acc.push((acc[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return acc;
}

/** 弧長 s の位置と接線 */
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
 * 鎖: 点列に沿って輪を等間隔に置く。偶数の輪は正面を向いた中抜きの楕円（明るい）、奇数は横を向いた短い棒（暗い）。
 * 1 輪おきの明暗で「鎖」と読ませる（ただの線だと鞭・槍の光条と区別できない）。
 * shade(u) で先（u=0）→ 根元（u=1）の明るさ、erosion で輪が 1 つずつ抜け落ちる
 */
function chain(frame, pts, o = {}) {
  const acc = pathTable(pts);
  const total = acc[acc.length - 1] ?? 0;
  const from = o.from ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const shade = o.shade ?? ((u) => 1 - 0.45 * u);
  for (let i = 0; ; i++) {
    const s = from + i * LINK_STEP;
    if (s > total) break;
    if (erosion > 0 && hash1(i, seed) < erosion * (0.6 + 0.6 * (s / Math.max(1, total)))) continue;
    const p = pathAt(pts, acc, s);
    const v = bright * shade(s / Math.max(1, total));
    link(frame, p, i % 2 === 0, v);
  }
}

/** 輪 1 つ。face = 正面（中抜きの楕円）、でなければ横向き（細い棒） */
function link(frame, p, face, v) {
  const { x, y, tx, ty } = p;
  const a = face ? 2.7 : 2.3;
  const b = face ? 1.9 : 0.7;
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
        // 中抜き: 真ん中は抜いて輪に見せる。縁の片側（+y 側）を明るく
        if (d < 0.42) return -1;
        return clamp01(v * (0.78 + 0.22 * (w > 0 ? 1 : 0)));
      }
      return clamp01(v * 0.42);
    },
    { bounds: { x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4 }, dither: 0 },
  );
}

/** 直線の鎖の点列（先 → 根元） */
function straight(tipX, baseX, y = 0) {
  return [
    [tipX, y],
    [baseX, y],
  ];
}

/** 円周の鎖の点列（先の角 head から、時計回りの逆へ span だけ戻る） */
function circlePath(R, head, span, cx = 0, cy = 0) {
  const n = Math.max(2, Math.ceil((R * span) / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = head - (span * i) / n;
    pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
  }
  return pts;
}

/** 分銅: 縁の暗い丸い塊に、前寄りの光点。r は半径 */
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

/**
 * 打撃の星: 長短の棘が放射する鈍い衝撃（刃の裂け目と違い、中心から外へ弾ける）。
 * age で棘が外へ抜けて中が空く。size は長い棘の長さ
 */
function impactStar(frame, x, y, size, age, o = {}) {
  const spikes = o.spikes ?? 8;
  const rot = o.rot ?? 0;
  const fade = o.fade ?? 0.22;
  const k = Math.min(1, age * fade);
  for (let i = 0; i < spikes; i++) {
    // 棘の角と長さを少しずつ崩す（等間隔・等長だと照準の十字に見える）
    const seed = o.seed ?? 1;
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.45) / spikes) * Math.PI * 2;
    const long = i % 2 === 0;
    const r1 = (long ? size : size * 0.55) * (0.8 + 0.4 * hash1(i, seed + 1)) * (1 + age * 0.18);
    const r0 = age === 0 ? 1 : Math.min(r1 - 1, size * 0.25 + age * size * 0.2);
    if (r1 - r0 < 1.5) continue;
    streakLine(frame, { ax: x + Math.cos(a) * r1, ay: y + Math.sin(a) * r1, bx: x + Math.cos(a) * r0, by: y + Math.sin(a) * r0, width: long ? 1.8 : 1.2, bright: (long ? 1 : 0.8) * (1 - k * 0.7) });
  }
}

/**
 * 鎌の鉤: 三日月の先端から内側へ小さく曲がり込む爪。鎌の刃先は柄に対して内へ折れるので、先を鉤にすると剣の弧と見分けられる。
 * (x, y) は先端、dir は刃の進む向き（接線の角）、inward は中心への向き（角）
 */
function hook(frame, x, y, dir, inward, len, T, bright = 1, erosion = 0, seed = 1) {
  // 進む向きと内向きの中間へ、少し前へふくらませて折る
  const a = dir * 0.35 + inward * 0.65;
  const bx = x + Math.cos(a) * len;
  const by = y + Math.sin(a) * len;
  lens(frame, { ax: x, ay: y, bx, by, T, bend: -T * 0.8, bias: 0.4, erosion, seed, bright });
}

// -----------------------------------------------------------------------------
// 近い弧: 鋭い鎌の三日月
// -----------------------------------------------------------------------------

/** 左 1 段（arc 100° reach 18）: 小さく鋭い三日月。剣（R 56）より半径も太さも小さい */
const L0 = { R: 40, T: 12, sweep: 112, tilt: -6, frames: 8, active: 4, tailLen: 0.75, overshoot: 0.06, erodeFrom: 0.04, lines: 2, shards: 4, shardSpeed: 3.5, glint: 2, seed: 1101, hook: 8, streak: 0.3 };
/** 左 2 段: 返し（描画側が上下反転）。少し前寄り・尾が長い */
const L1 = { R: 42, T: 11, sweep: 118, tilt: 8, frames: 8, active: 4, tailLen: 0.9, overshoot: 0.07, erodeFrom: 0.04, lines: 2, shards: 4, shardSpeed: 3.5, glint: 2, seed: 1202, hook: 8, streak: 0.3 };
/** 左 3 段: 鉤を深く、振り幅は短く鋭い（刻みの速い 3 連目） */
const L2 = { R: 38, T: 13, sweep: 100, tilt: -2, frames: 8, active: 4, tailLen: 0.7, overshoot: 0.05, erodeFrom: 0.04, lines: 2, shards: 5, shardSpeed: 4, glint: 3, seed: 1303, hook: 11, streak: 0.35 };
/** 左 4 段（終撃・arc 120° reach 20）: 1 本の太い鎌の三日月 + 大きな鉤 + 多めの刃片 */
const L3 = { R: 46, T: 19, sweep: 138, tilt: 0, frames: 9, active: 4, tailLen: 0.9, overshoot: 0.05, erodeFrom: 0.03, lines: 2, shards: 10, shardSpeed: 5, glint: 3, seed: 1404, hook: 13, streak: 0.45 };
/** 右: 鎌返し（arc 120° reach 20）。鎖で振り戻す鎌: 三日月の先端と手元を鎖が結ぶ */
const RETURN = { R: 44, T: 13, sweep: 140, tilt: -10, frames: 8, active: 4, tailLen: 0.8, overshoot: 0.08, erodeFrom: 0.04, lines: 2, shards: 5, shardSpeed: 4, glint: 2, seed: 1505, hook: 9, streak: 0.3 };
/** 派生: 引き斬り（arc 120° heavy）。前から手元へ引き込む速度線 + 太い鎌 */
const PULL = { R: 46, T: 20, sweep: 128, tilt: 6, frames: 9, active: 4, tailLen: 0.95, overshoot: 0.04, erodeFrom: 0.03, lines: 2, shards: 9, shardSpeed: 4.5, glint: 3, seed: 1606, hook: 12, streak: 0.45 };

/** 弧の進み（motifs.arcSlash と同じ時間割）。先端・尾の角と崩れを返す */
function swingState(f, spec) {
  const half = (spec.sweep * DEG) / 2;
  const from = -half + (spec.tilt ?? 0) * DEG;
  const sweep = half * 2;
  const A = spec.active;
  const fade = f - (A - 1);
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    return { from, sweep, p, k: 0, head: from + sweep * p, tail: from + sweep * Math.max(0, p - spec.tailLen) * 0.5, erosion: 0, bright: 0.82 + 0.18 * p, T: spec.T * (0.7 + 0.3 * ((f + 1) / A)) };
  }
  const k = fade / (spec.frames - A);
  return {
    from,
    sweep,
    p: 1,
    k,
    head: from + sweep * (1 + spec.overshoot * k),
    tail: from + sweep * Math.min(0.97, 1 - spec.tailLen + (spec.tailLen - 0.05) * Math.pow(k, 0.8)),
    erosion: spec.erodeFrom + (0.85 - spec.erodeFrom) * Math.pow(k, 1.3),
    bright: 1 - 0.3 * k,
    T: spec.T * (1 - 0.5 * k),
  };
}

/** 鎌の三日月 1 フレーム: 三日月 + 先端の鉤 + 外側の速度線 + 刃片 */
function sickleSwing(frame, f, spec) {
  const st = swingState(f, spec);
  const A = spec.active;
  crescent(frame, { R: spec.R, T: st.T, head: st.head, tail: st.tail, erosion: st.erosion, bright: st.bright, seed: spec.seed, streak: spec.streak, peak: 0.12, edge: 1.4 });
  // 鉤は振りの間と振り切り直後だけ。崩れが進むと先に消える（尾の粒と混ざらないように）
  if (st.k < 0.5) {
    const r = spec.R - 1.2;
    const x = Math.cos(st.head) * r;
    const y = Math.sin(st.head) * r;
    const scale = f < A ? 0.6 + 0.4 * st.p : 1 - st.k;
    hook(frame, x, y, st.head + Math.PI / 2, st.head + Math.PI, spec.hook * scale, Math.max(2.4, spec.T * 0.28), st.bright, st.k * 0.9, spec.seed + 5);
  }
  drawArcLines(frame, f, spec, st.head, st.tail);
  if (f >= A - 1) drawArcShards(frame, f - (A - 1), spec, st.from, st.sweep);
  if (f === A - 1 || f === A) {
    const tipR = spec.R - st.T * 0.3;
    sparkle(frame, Math.cos(st.head) * tipR, Math.sin(st.head) * tipR, f === A - 1 ? spec.glint : Math.max(1, spec.glint - 1));
  }
  return st;
}

function sickleSheet(key, spec, draw = sickleSwing) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size: (spec.R + 24) * 2, draw: (frame, f) => draw(frame, f, spec) };
}

/** 鎌返し: 三日月に、手元から鎌の先へ張った鎖を添える（鎖で振り戻している） */
function sickleReturn(frame, f, spec) {
  const st = sickleSwing(frame, f, spec);
  if (st.k >= 0.6) return;
  const r = spec.R - st.T * 0.6;
  const tx = Math.cos(st.head) * r;
  const ty = Math.sin(st.head) * r;
  const base = 8;
  chain(frame, [[tx, ty], [Math.cos(st.head) * base, Math.sin(st.head) * base]], { bright: 0.85 * (1 - st.k), erosion: st.k, seed: 1511 });
}

/** 引き斬り: 前方から手元へ向かう内向きの速度線（敵を引き寄せる）を三日月の前に重ねる */
function pullCut(frame, f, spec) {
  const st = sickleSwing(frame, f, spec);
  const A = spec.active;
  if (f > A) return;
  const age = f;
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.2 + (hash1(i, 1611) - 0.5) * 0.1;
    const r1 = 100 - age * 12 - hash1(i, 1612) * 10;
    const r0 = r1 - 14 - hash1(i, 1613) * 10;
    if (r0 < spec.R + 10) continue;
    // 外 → 内へ（内側の端が明るい＝手元へ向かう）
    streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, bright: 0.6 * (1 - st.k) });
  }
}

/**
 * 鎖締め（arc 120° heavy reach 20）: 斬線の代わりに鎖が弧を描いて払い、振り切ると内へ締まって先端の鉤が食い込む。
 * 鎌の三日月は描かない（「鎖で締める」段なので、刃の弧と見分ける）
 */
const CINCH = { R: 44, sweep: 130, tilt: 0, frames: 9, active: 4, seed: 1707 };
function chainCinch(frame, f) {
  const A = CINCH.active;
  const half = (CINCH.sweep * DEG) / 2;
  const from = -half;
  const sweep = half * 2;
  const k = f < A ? 0 : (f - A + 1) / (CINCH.frames - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const head = from + sweep * p;
  // 振り切ったあと半径が縮む（締まる）
  const R = CINCH.R - (f < A ? 0 : Math.min(1, k * 1.6) * 12);
  const span = f < A ? sweep * p * 0.95 : sweep * (1 - k * 0.3);
  chain(frame, circlePath(R, head, span), { bright: 1 - k * 0.3, erosion: Math.max(0, k - 0.25) * 1.2, seed: CINCH.seed, shade: (u) => 1 - 0.55 * u });
  // 先端の鎌（小さな鉤）
  if (k < 0.7) {
    const x = Math.cos(head) * R;
    const y = Math.sin(head) * R;
    hook(frame, x, y, head + Math.PI / 2, head + Math.PI, 11 * (1 - k * 0.6), 4.5, 1 - k * 0.3, k, CINCH.seed + 3);
  }
  // 締まる瞬間: 弧の中ほどに圧の閃き
  if (f === A || f === A + 1) {
    const a = from + sweep * 0.6;
    sparkle(frame, Math.cos(a) * R, Math.sin(a) * R, f === A ? 3 : 2);
    if (f === A) impactStar(frame, Math.cos(a) * R, Math.sin(a) * R, 8, 0, { spikes: 6, seed: CINCH.seed + 4 });
  }
  if (f >= A) {
    shards(frame, f - A, 8, CINCH.seed + 6, (i, rnd) => {
      const a = from + sweep * (0.3 + 0.7 * rnd(1));
      const sp = 2.5 + rnd(2) * 3;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: -Math.cos(a) * sp * 0.6 - Math.sin(a) * sp * 0.5, vy: -Math.sin(a) * sp * 0.6 + Math.cos(a) * sp * 0.5, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 遠い突き: 鎖が一直線に伸び、先端の分銅が弾ける
// -----------------------------------------------------------------------------

/**
 * 鎖を投げる突きの時間割。reach（絵のドット）まで鎖が伸び、振り切りで先端が弾ける。
 * 崩れでは鎖が手元へ巻き戻りながら輪が抜け落ちる。tipDraw(frame, x, f, k) で先端（分銅・鎌）を描く
 */
function chainThrow(frame, f, o) {
  const { reach, A, N, seed } = o;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const base = 8;
  // 振り終わりは先端が少し戻る（鎖を手繰る）
  const tip = base + (reach - base) * p - k * reach * 0.35;
  chain(frame, straight(tip - (o.tipGap ?? 5), base), { bright: 1 - k * 0.35, erosion: k * 1.1, seed, shade: (u) => 1 - 0.5 * u });
  // 鎖の両脇の短い速度線（伸びる速さ）
  if (k < 0.6) {
    for (let i = 0; i < (o.lines ?? 2); i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (7 + Math.floor(i / 2) * 4);
      const x1 = tip - 10 - hash1(i, seed + 1) * 12 - k * 20;
      const len = 16 + hash1(i, seed + 2) * 16;
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
    }
  }
  return { tip, p, k };
}

/** 分銅の先端と、振り切りの打撃の星 */
function weightTip(frame, f, st, o) {
  const { A } = o;
  if (st.k < 0.75) weight(frame, st.tip, 0, o.r * (1 - st.k * 0.3), 1 - st.k * 0.4);
  if (f >= A - 1) {
    const age = f - (A - 1);
    const hitX = o.reach;
    if (age <= 3) impactStar(frame, hitX, 0, o.star, age, { rot: Math.PI / 8, seed: o.seed + 7 });
    // 衝撃の輪は星の中の空いた所にだけ（棘と交差させると照準に見える）。進む向きに潰して打撃の向きを残す
    if (age >= 1 && o.ring) ring(frame, { ox: hitX - 2, radius: Math.max(3, o.star * 0.25 + age * o.star * 0.2 - 3), width: 2, squash: 0.6, erosion: Math.min(0.9, age * 0.22), bright: 0.7 - age * 0.08, seed: o.seed + 3 });
    if (age === 0) sparkle(frame, hitX, 0, 3);
    shards(frame, age, o.shards ?? 6, o.seed + 4, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.6;
      const sp = 3 + rnd(2) * 3;
      return { x: hitX, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/** ダッシュ攻撃（thrust reach 40）: 走り込みながら分銅を放つ。後ろに流れる速度線を足す */
const DASH = { reach: 80, A: 4, N: 8, seed: 2101, r: 5, star: 13, lines: 2, shards: 6 };
function dashThrow(frame, f) {
  const st = chainThrow(frame, f, DASH);
  weightTip(frame, f, st, DASH);
  if (st.k < 0.8) {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 7 + (hash1(i, 2111) - 0.5) * 3;
      if (Math.abs(y) < 4) continue;
      const x1 = -4 - hash1(i, 2112) * 8 - st.k * 20;
      streakLine(frame, { ax: x1 - 24 - hash1(i, 2113) * 20, ay: y, bx: x1, by: y, bright: 0.45 * (1 - st.k) });
    }
  }
}

/** 右: 分銅（thrust reach 64）。長い鎖の先の大きな分銅が、大きな星と輪で弾ける */
const WEIGHT = { reach: 128, A: 4, N: 8, seed: 2201, r: 7.5, star: 24, lines: 2, shards: 10, tipGap: 7, ring: true };
function chainWeight(frame, f) {
  const st = chainThrow(frame, f, WEIGHT);
  weightTip(frame, f, st, WEIGHT);
}

/** 小さな鎌の刃（鎌鼬の先端）: 先へ向かって下へ曲がる短い三日月 */
function smallSickle(frame, x, bright, erosion, seed) {
  crescent(frame, { ox: x - 11, oy: 3, R: 15, T: 7, head: -0.1, tail: -2.0, erosion, bright, seed, peak: 0.1 });
}

/**
 * 派生: 鎌鼬（thrust reach 50・2 段）。鎖の先は鎌。鎖に沿って細い風の刃が 2 本、時間をずらして上下を走る（2 回の当たり）
 */
const KAMAITACHI = { reach: 100, A: 4, N: 8, seed: 2301, lines: 0, tipGap: 2 };
function kamaitachi(frame, f) {
  const st = chainThrow(frame, f, KAMAITACHI);
  if (st.k < 0.7) smallSickle(frame, st.tip, 1 - st.k * 0.4, st.k, 2302);
  // 風の刃: 1 本目は f 0〜2 に上側、2 本目は f 2〜4 に下側（角度と時刻で分けて二重線に見せない）
  const blades = [
    { start: 0, side: -1, seed: 2303 },
    { start: 2, side: 1, seed: 2304 },
  ];
  for (const b of blades) {
    const t = f - b.start;
    if (t < 0 || t > 4) continue;
    const head = 20 + t * 28;
    const len = 44 - Math.max(0, t - 2) * 10;
    const fade = Math.max(0, t - 2) / 3;
    const y = b.side * (6 + t * 1.5);
    lens(frame, { ax: head - len, ay: y, bx: Math.min(head, 116), by: y + b.side * 2, T: 6 * (1 - fade * 0.5), bend: b.side * 3, bias: 0.4 * b.side, erosion: fade * 0.9, seed: b.seed, bright: 1 - fade * 0.3 });
    if (t === 2) sparkle(frame, Math.min(head, 114), y + b.side * 2, 2);
  }
  if (f >= KAMAITACHI.A - 1) {
    shards(frame, f - (KAMAITACHI.A - 1), 6, 2305, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.4;
      const sp = 3 + rnd(2) * 3;
      return { x: 100, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 派生: 鎖縛り（thrust reach 50）。伸びた鎖の先が敵の位置でとぐろを巻き、輪が締まって光る
 */
const BIND = { reach: 100, A: 3, N: 8, seed: 2401, lines: 2, tipGap: 5 };
function chainBind(frame, f) {
  const st = chainThrow(frame, f, BIND);
  const A = BIND.A;
  const cx = BIND.reach + 2;
  if (f < A) {
    weight(frame, st.tip, 0, 4, 1);
    return;
  }
  // とぐろ: f = A から 1 周を巻き、その後締まる
  const age = f - A;
  const wrap = Math.min(1, (age + 1) / 2);
  const R = 13 - Math.max(0, age - 1) * 2.2;
  const head = -Math.PI / 2 + wrap * Math.PI * 2;
  if (R > 3) chain(frame, circlePath(R, head, Math.PI * 2 * wrap * 0.96, cx, 0), { bright: 1 - st.k * 0.3, erosion: Math.max(0, age - 2) * 0.25, seed: 2402 });
  if (age <= 1) weight(frame, cx + Math.cos(head) * R, Math.sin(head) * R, 3.5, 1);
  if (age === 1 || age === 2) {
    sparkle(frame, cx, 0, age === 1 ? 3 : 2);
  }
  if (age >= 2) {
    shards(frame, age - 2, 7, 2404, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 2 + rnd(2) * 2.5;
      return { x: cx + Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 回転: 鎖の点列の円 + 先端の分銅の光
// -----------------------------------------------------------------------------

/** 右: 鎖回し（circle size 56・2 段）。分銅が自分の周りを 2 周し、鎖の点列が尾を引く */
const SPIN = { R: 50, frames: 10, active: 6, seed: 2501 };
function chainSpin(frame, f) {
  const A = SPIN.active;
  const k = f < A ? 0 : (f - A + 1) / (SPIN.frames - A + 1);
  const rot = f < A ? easeSwing((f + 1) / A) * Math.PI * 4 : Math.PI * 4 + Math.sin(k * Math.PI * 0.5) * Math.PI * 0.7;
  const R = SPIN.R + k * 4;
  const span = (f < A ? 1.3 + 2.2 * Math.min(1, (f + 1) / 3) : 3.5 * (1 - k * 0.5));
  chain(frame, circlePath(R, rot, span), { bright: 1 - k * 0.3, erosion: k * 1.1, seed: SPIN.seed, shade: (u) => 1 - 0.7 * u });
  // 手元から分銅までの鎖（今の向き）。暗く細く、円の鎖より控えめに
  if (k < 0.3) chain(frame, straight(R - 6, 10).map(([x, y]) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]), { bright: 0.55, seed: SPIN.seed + 1 });
  const flash = f === 2 || f === 4;
  if (k < 0.7) weight(frame, Math.cos(rot) * R, Math.sin(rot) * R, 6 * (1 - k * 0.4), flash ? 1.1 : 1 - k * 0.3);
  if (flash) sparkle(frame, Math.cos(rot) * (R + 1), Math.sin(rot) * (R + 1), 3);
  // 外周の速度線: 分銅の後ろ、円の外側だけ
  if (k < 0.6) arcLine(frame, { radius: R + 9, from: rot - 0.9, to: rot - 0.2, bright: 0.45 * (1 - k) });
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 8, SPIN.seed + 2, (i, rnd) => {
      const a = rot - rnd(1) * 2.5;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: (-Math.sin(a) * 0.7 + Math.cos(a) * 0.5) * sp, vy: (Math.cos(a) * 0.7 + Math.sin(a) * 0.5) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/** 派生: 巻き取り（circle size 56・2 段・長い active）。鎖の円が手元へ縮み、外から内へ速度線が集まる */
const REEL = { R: 56, frames: 10, active: 6, seed: 2601 };
function reelIn(frame, f) {
  const A = REEL.active;
  const k = f < A ? 0 : (f - A + 1) / (REEL.frames - A + 1);
  const p = f < A ? (f + 1) / A : 1;
  const R = REEL.R - 30 * easeSwing(p) - k * 6;
  const rot = p * Math.PI * 1.5 + k * 0.6;
  chain(frame, circlePath(R, rot, Math.PI * 2 * 0.92), { bright: 1 - k * 0.35, erosion: k * 1.1, seed: REEL.seed, shade: (u) => 1 - 0.5 * u });
  if (k < 0.6) weight(frame, Math.cos(rot) * R, Math.sin(rot) * R, 5, 1 - k * 0.4);
  // 内向きの速度線: 外の端が暗く、内の端が明るい（手元へ引き込む）
  if (k < 0.7) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + hash1(i, REEL.seed + 1) * 0.4 + p * 0.5;
      // 線は外から内へ流れる: フレームごとに内へずれ、長さもばらつかせる（放射の光に見せない）
      const off = ((f * 7 + hash1(i, REEL.seed + 2) * 20) % 20);
      const r1 = R + 30 - off;
      const r0 = r1 - 8 - hash1(i, REEL.seed + 3) * 10;
      if (r0 < R + 5) continue;
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, bright: 0.55 * (1 - k) });
    }
  }
  if (f === 2 || f === 5) sparkle(frame, 0, 0, f === 5 ? 3 : 2);
  if (f >= A) {
    // 引き寄せた先（手元）で粒が内へ集まる
    shards(frame, f - A, 10, REEL.seed + 4, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const r = R + 4 + rnd(2) * 8;
      const sp = 2.5 + rnd(3) * 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/**
 * 命中: 鎌の鉤状の切り傷（先が内へ折れた短い斬線）+ 分銅の打撃の星。heavy は星が大きく衝撃の輪が付く
 */
function hit(frame, f, heavy) {
  const N = heavy ? 7 : 6;
  const L = heavy ? 22 : 15;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  const grow = f === 0 ? 0.6 : 1;
  const T = (heavy ? 10 : 7) * (f === 0 ? 0.7 : 1 - k * 0.6);
  // 切り傷は反りを前（+x）ではなく刃の進む向きの外へ。先端（+x）で内側（+y）へ鉤に折れる
  lens(frame, { ax: -L * grow, ay: -2, bx: L * grow, by: -2, T, bend: -3, bias: 0.3, erosion: k * 0.9, seed: heavy ? 2701 : 2711 });
  if (f >= 1 && k < 0.6) hook(frame, L - 1, -2, 0, Math.PI / 2, heavy ? 10 : 7, heavy ? 4 : 3, 1 - k * 0.3, k, heavy ? 2702 : 2712);
  // 分銅の打撃の星（切り傷の少し後ろ、中心）
  if (f <= (heavy ? 2 : 3)) impactStar(frame, 0, 3, heavy ? 16 : 9, f, { spikes: heavy ? 8 : 6, rot: Math.PI / 8, fade: heavy ? 0.22 : 0.3, seed: heavy ? 2705 : 2715 });
  if (f <= 1) sparkle(frame, 0, 2, heavy ? 4 : 3);
  if (heavy && f >= 1) {
    const age = f - 1;
    // 星の棘の外に出てから広がる輪（棘と交差させない）
    if (age >= 2) ring(frame, { oy: 3, radius: 15 + (age - 2) * 5, width: 2.2, erosion: Math.min(0.9, 0.25 + (age - 2) * 0.22), bright: 0.7 - age * 0.06, seed: 2703 });
  }
  if (f >= 1) {
    shards(frame, f - 1, heavy ? 12 : 6, heavy ? 2704 : 2714, (i, rnd) => {
      const forward = rnd(1) > 0.4;
      const a = forward ? (rnd(2) - 0.5) * 1.0 : rnd(2) * Math.PI * 2;
      const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 4 : 2.5);
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.45 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot と base は sword.mjs の FX と同じ意味 */
const FX = {
  moveset: "chainSickle",
  motions: {
    "l:0": { sheet: "chainSickle.l0", pivot: "self", base: 18, measure: "reach" },
    "l:1": { sheet: "chainSickle.l1", pivot: "self", base: 18, measure: "reach" },
    "l:2": { sheet: "chainSickle.l2", pivot: "self", base: 18, measure: "reach" },
    "l:3": { sheet: "chainSickle.l3", pivot: "self", base: 20, measure: "reach" },
    dash: { sheet: "chainSickle.dash", pivot: "self", base: 40, measure: "reach" },
    "r:chainWeight": { sheet: "chainSickle.weight", pivot: "self", base: 64, measure: "reach" },
    "r:sickleReturn": { sheet: "chainSickle.return", pivot: "self", base: 20, measure: "reach" },
    "r:chainSpin": { sheet: "chainSickle.spin", pivot: "self", base: 56, measure: "size" },
    "r:chainCinch": { sheet: "chainSickle.cinch", pivot: "self", base: 20, measure: "reach" },
    "branch:reelIn": { sheet: "chainSickle.reelIn", pivot: "self", base: 56, measure: "size" },
    "branch:kamaitachi": { sheet: "chainSickle.kamaitachi", pivot: "self", base: 50, measure: "reach" },
    "branch:pullCut": { sheet: "chainSickle.pullCut", pivot: "self", base: 20, measure: "reach" },
    "branch:chainBind": { sheet: "chainSickle.bind", pivot: "self", base: 50, measure: "reach" },
  },
  hit: "chainSickle.hit",
  hitHeavy: "chainSickle.hitHeavy",
};

export const ATLAS = {
  key: "chainSickle",
  fx: FX,
  sheets: [
    sickleSheet("chainSickle.l0", L0),
    sickleSheet("chainSickle.l1", L1),
    sickleSheet("chainSickle.l2", L2),
    sickleSheet("chainSickle.l3", L3),
    sickleSheet("chainSickle.return", RETURN, sickleReturn),
    sickleSheet("chainSickle.pullCut", PULL, pullCut),
    { key: "chainSickle.cinch", dirs: DIRS, frames: CINCH.frames, active: CINCH.active, size: 128, draw: chainCinch },
    { key: "chainSickle.dash", dirs: DIRS, frames: DASH.N, active: DASH.A, size: 216, draw: dashThrow },
    { key: "chainSickle.weight", dirs: DIRS, frames: WEIGHT.N, active: WEIGHT.A, size: 320, draw: chainWeight },
    { key: "chainSickle.kamaitachi", dirs: DIRS, frames: KAMAITACHI.N, active: KAMAITACHI.A, size: 256, draw: kamaitachi },
    { key: "chainSickle.bind", dirs: DIRS, frames: BIND.N, active: BIND.A, size: 256, draw: chainBind },
    { key: "chainSickle.spin", dirs: 1, frames: SPIN.frames, active: SPIN.active, size: 144, draw: chainSpin },
    { key: "chainSickle.reelIn", dirs: 1, frames: REEL.frames, active: REEL.active, size: 184, draw: reelIn },
    { key: "chainSickle.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => hit(frame, f, false) },
    { key: "chainSickle.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => hit(frame, f, true) },
  ],
};
