// 技（共通技）の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（照準の向き）
// 技は行為の列（arc / ring / line / dash …）で出るので、表は行為の種類ごと（acts.<種類>）に絵を持つ。
// 今の武器の型で行為の種類が変わっても、その技に無い種類は汎用の絵（@art）で描く
//
// 旋風斬り（commonWhirl。ring・半径 32px・3 度斬る）: 体の周りを一筆の円相が 1 周と少し走り、内側を 2 本目の細い筆が追う。
//   筆の先から墨の飛沫が接線へ飛ぶ。書き終えると終筆から掠れて消える
// 撃ち抜き（commonRailshot。line・長さ 100px・幅 14px・光）: 起筆で墨を押し込み（cast）、壁まで太い一文字が走る（beam）。
//   帯は毛筋が線に沿って通り、乾くにつれ飛白（掠れ）が開いて細る。終点は止めの墨だまりが前へ飛び散る（tip）
// 突進斬り（commonLunge。dash・72px・幅 18px）: 蹴った所に後ろへ墨が跳ね（pos）、通り道に乾いた筆の飛白が残り（beam）、
//   止まった所で縦の払いの一閃（tip）
import { arcPoints, brushStroke, enso, inkBlot, lv, splatter } from "../brush.mjs";
import { hash1, hash2, paint, smoothstep, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const SEED = 7101;

// ---------------------------------------------------------------------------
// 旋風斬り
// ---------------------------------------------------------------------------

const WHIRL = { radiusPx: 32, frames: 10 };

function whirl(frame, f) {
  const R = WHIRL.radiusPx * 2;
  const p = (f + 0.5) / WHIRL.frames;
  const grow = smoothstep(0, 0.65, p);
  const fade = smoothstep(0.62, 1, p) * 0.85;
  const a0 = Math.PI * 0.75;
  enso(frame, { radius: R * 0.86, a0, sweep: TAU * 1.12, width: 9, grow, fade, dry: 0.5, seed: SEED + 1 });
  // 内側を追う 2 本目（3 度目の斬り）
  const g2 = smoothstep(0.25, 0.8, p);
  if (g2 > 0.02) enso(frame, { radius: R * 0.62, a0: a0 + Math.PI, sweep: TAU * 0.7, width: 4.5, grow: g2, fade: Math.min(1, fade * 1.2), dry: 0.6, seed: SEED + 2 });
  // 筆の先から接線へ飛ぶ飛沫
  const head = a0 + TAU * 1.12 * grow;
  splatter(frame, f, 14, SEED + 3, (i, r) => {
    const born = r(1) * 6;
    const a = a0 + TAU * 1.12 * smoothstep(0, 0.65, (born + 0.5) / WHIRL.frames);
    const rr = R * (0.8 + 0.15 * r(2));
    return {
      x: Math.cos(a) * rr,
      y: Math.sin(a) * rr,
      vx: -Math.sin(a) * (3 + 3 * r(3)) + Math.cos(a) * 2,
      vy: Math.cos(a) * (3 + 3 * r(3)) + Math.sin(a) * 2,
      size: r(4) > 0.6 ? 1.6 : 0.9,
      born,
      life: 4,
      level: 7,
    };
  });
  void head;
}

// ---------------------------------------------------------------------------
// 撃ち抜き
// ---------------------------------------------------------------------------

/** 帯の太さ（ドット。幅 14px の半分 × 2） */
const RAIL_HALF = 12;
const RAIL_STEP_PX = 12;

/** 起筆: 銃口に墨を押し込む。丸い墨だまりがつぶれて前へ伸び、後ろへ小さく跳ねる */
function railPress(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const r = RAIL_HALF * (1.3 - 0.5 * p);
  if (p < 0.8) inkBlot(frame, { x: 6 + 4 * p, y: 0, radius: r, seed: SEED + 10 + f, coreWidth: 0.4 - 0.3 * p });
  splatter(frame, f, 8, SEED + 11, (i, r2) => ({ x: 2, y: 0, vx: -(1.5 + 3 * r2(1)), vy: (r2(2) - 0.5) * 6, size: r2(3) > 0.5 ? 1.4 : 0.8, life: 5, level: 6 }));
}

/** 一文字の 1 区間（step px）。毛筋が帯に沿って通り、コマが進むと飛白が開いて細る */
function railBeam(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = RAIL_STEP_PX + 0.6;
  const w = RAIL_HALF * (1 - 0.55 * smoothstep(0.2, 1, p)) + 1;
  brushStroke(frame, {
    pts: [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
    width: w,
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: smoothstep(0.3, 1, p) * 0.75,
    pitch: 1.4,
    breakLen: 40,
    seed: SEED + 20,
  });
}

/** 止め: 壁で墨がたまって前へ飛び散る */
function railTip(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.85) inkBlot(frame, { x: 0, y: 0, radius: RAIL_HALF * (0.9 + 0.5 * p), seed: SEED + 30, coreWidth: 0.4 - 0.3 * p });
  splatter(frame, f, 12, SEED + 31, (i, r) => ({ x: 0, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 9, size: r(3) > 0.5 ? 1.8 : 1, life: 6, level: 7 }));
}

// ---------------------------------------------------------------------------
// 突進斬り
// ---------------------------------------------------------------------------

const LUNGE_STEP_PX = 12;

/** 蹴り: 足元から後ろへ墨が跳ね、短く擦った跡 */
function lungeKick(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  brushStroke(frame, {
    pts: [
      { x: 4, y: 0 },
      { x: -22, y: 0 },
    ],
    width: 7,
    grow: smoothstep(0, 0.4, p),
    fade: smoothstep(0.4, 1, p),
    dry: 0.7,
    seed: SEED + 40,
  });
  splatter(frame, f, 10, SEED + 41, (i, r) => ({ x: -4, y: (r(1) - 0.5) * 8, vx: -(2 + 4 * r(2)), vy: (r(3) - 0.5) * 6, size: r(4) > 0.5 ? 1.6 : 0.9, life: 5, level: 6 }));
}

/** 通り道の飛白（beam の 1 区間）: 乾いた筆で擦った毛筋の帯。コマが進むと毛筋が途切れて消える */
function lungeTrail(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const half = LUNGE_STEP_PX + 0.6;
  brushStroke(frame, {
    pts: [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
    width: 9 * (1 - 0.4 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.35 + 0.6 * smoothstep(0.2, 1, p),
    pitch: 1.2,
    breakLen: 9,
    seed: SEED + 50,
  });
}

/** 斬り抜けの払い: 止まった所で縦の一筆が上から下へ走り、前へ飛沫 */
function lungeCut(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    // 進む向き（+x）へ膨らむ弓なり
    pts.push({ x: 8 + 9 * Math.sin(t * Math.PI), y: -30 + 60 * t });
  }
  brushStroke(frame, { pts, width: 7, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.45, 1, p) * 0.9, dry: 0.5, tail: 0.5, seed: SEED + 60 });
  splatter(frame, f, 9, SEED + 61, (i, r) => ({ x: 14, y: (r(1) - 0.5) * 34, vx: 3 + 4 * r(2), vy: (r(3) - 0.5) * 4, size: r(4) > 0.5 ? 1.5 : 0.8, life: 6, level: 7 }));
}

// ---------------------------------------------------------------------------
// 汎用の技の絵（@art）。技に専用の絵が無い行為・武器の型で形が変わった行為を描く。特定の技に寄せない素直な墨の形
//   扇（arc / arcWide / arcFull）: 弧の一筆。arcFull は一回りして払う
//   輪（ring）: 円相と外へ飛ぶ飛沫。照準地点（ringTarget）: 墨の一滴が落ちて弾け、花弁の筆が四方へ割れる
//   帯（line）: 起筆の墨だまり → 一文字 → 止めの墨だまり
//   踏み込み（dash / dashBack）: 蹴りの飛沫 → 飛白の通り道 → 着地の止め（後ろへは踏みとどまりの弧）
//   跳躍（blink）: 元の位置の墨の点がほどけ、通り道に筆の点の残像、着いた所に墨が落ちる
//   弾（shot / fly）: 筆を前へ払って墨を放ち、墨の雫が尾を引いて飛ぶ
//   連鎖（chain）: 筆の稲妻状の跳び線と、着いた所の小さな弾け
//   引き寄せ（pull）: 外から内へ巻く渦の筆と、内へ吸われる飛沫
//   自己強化（buff）: 体を巡って立ち昇る筆の渦と墨の煙
//   起爆（detonate）: 足元から四方へ跳ぶ飛沫と、掠れた輪
// ---------------------------------------------------------------------------

const GEN = 7300;
/** 扇の代表の届く距離（px）。技ごとの reach は実行時に拡縮する */
const ART_REACH_PX = 36;
const ART_RING_PX = 36;
const ART_BURST_PX = 32;
const ART_PULL_PX = 56;
/** 飛ぶ墨の雫の半径（px。弾の半径に合わせて拡縮） */
const ART_FLY_PX = 5;
const ART_LINE_HALF = 12;
const ART_LINE_STEP_PX = 12;
const ART_DASH_STEP_PX = 12;
const ART_BLINK_STEP_PX = 14;
const ART_CHAIN_STEP_PX = 16;

/** 扇の一筆: 半径 R の弧を -sweep/2 から +sweep/2 へ払う。弧の内側へ少し寄る三日月の筆圧 */
function artSweep(frame, f, frames, sweepDeg, seed) {
  const R = ART_REACH_PX * 2;
  const p = (f + 0.5) / frames;
  const sweep = (sweepDeg * Math.PI) / 180;
  const a0 = -sweep / 2;
  const grow = smoothstep(0, 0.45, p);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  const width = 7 + Math.min(4, sweepDeg / 60);
  const steps = Math.max(16, Math.round(sweepDeg / 5));
  // 外へ膨らむ弧（芯の半径 0.8R、中ほどで R 寄り）
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    const rr = R * (0.76 + 0.1 * Math.sin(t * Math.PI));
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  brushStroke(frame, { pts, width, grow, fade, dry: 0.55, press: 0.1, tail: 0.45, seed });
  // 内側を追う細い 2 本目（振りの勢いの余韻）
  const g2 = smoothstep(0.12, 0.6, p);
  if (sweepDeg >= 180 && g2 > 0.02) {
    const inner = arcPoints(0, 0, R * 0.56, a0 + sweep * 0.15, sweep * 0.7, Math.max(12, steps - 6), 0.03, seed + 1);
    brushStroke(frame, { pts: inner, width: 3.5, grow: g2, fade: Math.min(1, fade * 1.2), dry: 0.65, seed: seed + 1 });
  }
  // 払いの先から接線へ飛ぶ飛沫
  splatter(frame, f, 8 + Math.round(sweepDeg / 40), seed + 2, (i, r) => {
    const t = 0.35 + 0.65 * r(1);
    const a = a0 + sweep * t;
    const rr = R * (0.8 + 0.12 * r(2));
    const tan = 2.5 + 3 * r(3);
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: -Math.sin(a) * tan + Math.cos(a) * 1.5, vy: Math.cos(a) * tan + Math.sin(a) * 1.5, size: r(4) > 0.6 ? 1.5 : 0.9, born: Math.floor(t * frames * 0.45), life: 4, level: 7 };
  });
}

const ART_ARC_FRAMES = 8;
function artArc(frame, f) {
  artSweep(frame, f, ART_ARC_FRAMES, 110, GEN + 1);
}
function artArcWide(frame, f) {
  artSweep(frame, f, ART_ARC_FRAMES, 220, GEN + 5);
}
/** 一回りの薙ぎ: 背から始めて一周して払う（円相と違い、終筆が長く尖り、外へ開く） */
function artArcFull(frame, f) {
  const frames = 9;
  const R = ART_REACH_PX * 2;
  const p = (f + 0.5) / frames;
  const grow = smoothstep(0, 0.55, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  const a0 = Math.PI * 0.9;
  const sweep = TAU * 1.02;
  const pts = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    // 渦のように少しずつ外へ開く
    const rr = R * (0.66 + 0.2 * t);
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  brushStroke(frame, { pts, width: 9, grow, fade, dry: 0.55, press: 0.08, tail: 0.3, seed: GEN + 10 });
  splatter(frame, f, 16, GEN + 11, (i, r) => {
    const t = r(1);
    const a = a0 + sweep * t;
    const rr = R * (0.66 + 0.2 * t);
    const tan = 2.5 + 3 * r(3);
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: -Math.sin(a) * tan + Math.cos(a) * 2, vy: Math.cos(a) * tan + Math.sin(a) * 2, size: r(4) > 0.6 ? 1.5 : 0.9, born: Math.floor(t * frames * 0.55), life: 4, level: 7 };
  });
}

/** 輪: 一筆の円相（閉じきらない）が書かれ、外へ墨が飛ぶ */
function artRing(frame, f) {
  const frames = 9;
  const R = ART_RING_PX * 2;
  const p = (f + 0.5) / frames;
  const grow = smoothstep(0, 0.45, p);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  enso(frame, { radius: R * 0.88, a0: -Math.PI * 0.6, sweep: TAU * 0.93, width: 8, grow, fade, dry: 0.55, seed: GEN + 20 });
  splatter(frame, f, 18, GEN + 21, (i, r) => {
    const a = (i / 18) * TAU + r(1) * 0.3;
    const rr = R * (0.8 + 0.1 * r(2));
    const sp = 2.5 + 3 * r(3);
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(4) > 0.55 ? 1.6 : 0.9, born: 1 + Math.floor(r(5) * 3), life: 5, level: 7 };
  });
}

/** 照準地点: 墨の一滴が落ちて弾け、花弁のような短い筆が四方へ割れ、縁の外へ飛沫 */
function artBurst(frame, f) {
  const frames = 9;
  const R = ART_BURST_PX * 2;
  const p = (f + 0.5) / frames;
  // 落ちた一滴（最初に大きく、割れると縮む）
  const blob = R * (0.42 - 0.22 * smoothstep(0.15, 0.7, p));
  if (p < 0.75) inkBlot(frame, { x: 0, y: 0, radius: blob, seed: GEN + 30, coreWidth: 0.35 - 0.3 * p });
  // 割れて飛ぶ花弁の筆（中心から外へ、払いで尖る）
  const petals = 9;
  const g = smoothstep(0.08, 0.5, p);
  const fade = smoothstep(0.45, 1, p) * 0.9;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU + hash1(i, GEN + 31) * 0.5;
    const r0 = R * 0.3;
    const r1 = R * (0.72 + 0.22 * hash1(i, GEN + 32));
    const bend = (hash1(i, GEN + 33) - 0.5) * 0.35;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const aa = a + bend * t;
      const rr = r0 + (r1 - r0) * t;
      pts.push({ x: Math.cos(aa) * rr, y: Math.sin(aa) * rr });
    }
    brushStroke(frame, { pts, width: 5.5 + 2 * hash1(i, GEN + 34), grow: g, fade, dry: 0.45, press: 0.15, tail: 0.6, seed: GEN + 35 + i });
  }
  splatter(frame, f, 20, GEN + 50, (i, r) => {
    const a = r(1) * TAU;
    const rr = R * (0.5 + 0.3 * r(2));
    const sp = 2 + 4 * r(3);
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(4) > 0.5 ? 1.7 : 1, born: 1 + Math.floor(r(5) * 2), life: 5, level: 7 };
  });
}

/** 帯の起筆: 墨を押し込む丸い墨だまりがつぶれて前へ伸びる */
function artLinePress(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.75) inkBlot(frame, { x: 4 + 5 * p, y: 0, radius: ART_LINE_HALF * (1.15 - 0.45 * p), seed: GEN + 60 + f, coreWidth: 0.3 - 0.25 * p });
  splatter(frame, f, 6, GEN + 61, (i, r) => ({ x: 0, y: 0, vx: -(1 + 2.5 * r(1)), vy: (r(2) - 0.5) * 5, size: r(3) > 0.5 ? 1.3 : 0.8, life: 4, level: 6 }));
}

/** 一文字の 1 区間: 太い一筆が擦れて細る（毛筋は線に沿う） */
function artLineBeam(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = ART_LINE_STEP_PX + 0.6;
  brushStroke(frame, {
    pts: [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
    width: ART_LINE_HALF * (1 - 0.5 * smoothstep(0.15, 1, p)) + 1,
    profile: () => 1,
    flat: true,
    dry: 0,
    coreWidth: 0.18,
    fade: smoothstep(0.25, 1, p) * 0.8,
    pitch: 1.3,
    breakLen: 30,
    seed: GEN + 62,
  });
}

/** 帯の止め: 終点で筆を止めて墨がたまり、少し前へ跳ねる */
function artLineTip(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.8) inkBlot(frame, { x: -2, y: 0, radius: ART_LINE_HALF * (0.95 + 0.25 * p), seed: GEN + 63, coreWidth: 0.3 - 0.25 * p });
  splatter(frame, f, 9, GEN + 64, (i, r) => ({ x: 2, y: 0, vx: 1.5 + 3.5 * r(1), vy: (r(2) - 0.5) * 7, size: r(3) > 0.5 ? 1.5 : 0.9, life: 5, level: 7 }));
}

/** 踏み込みの蹴り: 足元から後ろへ墨が跳ねる。back なら蹴りは前（動いた向きの逆 = -x）で同じ */
function artKick(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  inkBlot(frame, { x: -2, y: 0, radius: 5 * (1 - 0.6 * p), seed: GEN + 70 + f, coreWidth: 0.2 });
  splatter(frame, f, 9, GEN + 71, (i, r) => ({ x: -3, y: (r(1) - 0.5) * 8, vx: -(2 + 3.5 * r(2)), vy: (r(3) - 0.5) * 6, size: r(4) > 0.5 ? 1.5 : 0.9, life: 5, level: 6 }));
}

/** 通り道の飛白（1 区間）: 乾いた筆で擦った細めの毛筋 */
function artDashTrail(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const half = ART_DASH_STEP_PX + 0.6;
  brushStroke(frame, {
    pts: [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
    width: 7 * (1 - 0.4 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.4 + 0.55 * smoothstep(0.15, 1, p),
    pitch: 1.2,
    breakLen: 8,
    seed: GEN + 72,
  });
}

/** 踏み込みの止め: 着いた所で足の擦れが前へ短く伸び、墨が前へ散る */
function artDashStop(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  brushStroke(frame, {
    pts: [
      { x: -6, y: 0 },
      { x: 14, y: 0 },
    ],
    width: 8,
    grow: smoothstep(0, 0.35, p),
    fade: smoothstep(0.4, 1, p) * 0.9,
    dry: 0.6,
    tail: 0.6,
    seed: GEN + 73,
  });
  splatter(frame, f, 8, GEN + 74, (i, r) => ({ x: 10, y: (r(1) - 0.5) * 10, vx: 2 + 3 * r(2), vy: (r(3) - 0.5) * 5, size: r(4) > 0.5 ? 1.4 : 0.8, life: 5, level: 7 }));
}

/** 跳び退きの着地: 動いた向き（+x）へ足が滑り、踏みとどまる弧の一筆（凹みは進んだ向きの逆 = 敵の側を向く） */
function artBackStop(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push({ x: 4 + 8 * Math.sin(t * Math.PI), y: -22 + 44 * t });
  }
  brushStroke(frame, { pts, width: 6, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.45, 1, p) * 0.9, dry: 0.55, tail: 0.5, seed: GEN + 75 });
  // 前（+x）へ擦れて止まる短い 2 筋
  for (const y of [-6, 6]) {
    brushStroke(frame, { pts: [{ x: -10, y }, { x: 6, y: y * 1.1 }], width: 3.5, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.35, 1, p), dry: 0.7, seed: GEN + 76 + y });
  }
  splatter(frame, f, 7, GEN + 78, (i, r) => ({ x: 10, y: (r(1) - 0.5) * 30, vx: 2 + 2.5 * r(2), vy: (r(3) - 0.5) * 3, size: r(4) > 0.5 ? 1.3 : 0.8, life: 5, level: 7 }));
}

/** 跳躍の元の位置: 墨の点がほどけて飛白の粒に散る */
function artBlinkFrom(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const r = 13 * (1 - 0.35 * p);
  if (p < 0.8) {
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const edge = r * (0.85 + 0.3 * valueNoise(Math.cos(a) * 6 + 4, Math.sin(a) * 6 + 4, 3, GEN + 80));
        if (d > edge) return -1;
        // ほどける: 外から内へ粒に間引かれていく
        if (hash2(Math.floor(x * 2), Math.floor(y * 2), GEN + 81) < smoothstep(0.1, 0.8, p) * (0.5 + 0.6 * (d / edge))) return -1;
        return d / edge < 0.3 - 0.25 * p ? lv(7) : lv(5);
      },
      { bounds: { x0: -r * 1.4, y0: -r * 1.4, x1: r * 1.4, y1: r * 1.4 } },
    );
  }
  splatter(frame, f, 12, GEN + 82, (i, r2) => {
    const a = r2(1) * TAU;
    const sp = 1.5 + 2.5 * r2(2);
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp + 1.5, vy: Math.sin(a) * sp, size: r2(3) > 0.5 ? 1.3 : 0.8, born: Math.floor(r2(4) * 3), life: 4, level: 6 };
  });
}

/** 跳躍の通り道（1 区間）: 筆の点の残像。一区間に一つ、進む向きへ流れた点。コマが進むと乾いて粒になる */
function artBlinkDots(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  brushStroke(frame, {
    pts: [
      { x: -9, y: 0 },
      { x: 7, y: 0 },
    ],
    width: 8 * (1 - 0.35 * p),
    grow: 1,
    fade: 0.15 + 0.8 * smoothstep(0.2, 1, p),
    dry: 0.4,
    press: 0.35,
    tail: 0.55,
    seed: GEN + 84,
  });
}

/** 跳躍の着いた所: 墨がぽたりと落ちて、まわりへ小さく跳ねる */
function artBlinkTo(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const grow = smoothstep(0, 0.25, p);
  if (p < 0.85) inkBlot(frame, { x: 0, y: 0, radius: 4 + 10 * grow * (1 - 0.3 * smoothstep(0.5, 1, p)), seed: GEN + 86, coreWidth: 0.35 - 0.3 * p });
  splatter(frame, f, 12, GEN + 87, (i, r) => {
    const a = (i / 12) * TAU + r(1) * 0.4;
    const sp = 2 + 3 * r(2);
    return { x: Math.cos(a) * 9, y: Math.sin(a) * 9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 1.4 : 0.8, born: 1, life: 5, level: 7 };
  });
}

/** 弾を放つ: 筆を前へ短く払い、墨が前へ散る */
function artShot(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push({ x: 4 + 38 * t, y: 8 * Math.sin(t * Math.PI) * (1 - 0.6 * t) });
  }
  brushStroke(frame, { pts, width: 6, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.35, 1, p) * 0.9, dry: 0.5, press: 0.2, tail: 0.6, seed: GEN + 90 });
  splatter(frame, f, 9, GEN + 91, (i, r) => ({ x: 30, y: (r(1) - 0.5) * 4, vx: 3 + 4 * r(2), vy: (r(3) - 0.5) * 6, size: r(4) > 0.5 ? 1.3 : 0.8, life: 4, level: 7 }));
}

/** 飛ぶ墨の雫: 丸い頭（芯に差し色）と、後ろへ引く筆の尾。尾は揺れて、乾いた粒を落とす */
function artFly(frame, f) {
  const frames = 6;
  const R = ART_FLY_PX * 2;
  const ph = (f / frames) * TAU;
  // 尾: 頭から後ろへ細る一筆（揺れる）
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push({ x: R * 0.2 - t * R * 4.6, y: Math.sin(ph + t * 4) * R * 0.3 * t });
  }
  brushStroke(frame, { pts, width: R * 0.7, profile: (u) => 1 - 0.9 * u, dry: 0.6, coreWidth: 0.12, seed: GEN + 95 + f, pitch: 1 });
  // 頭（雫）
  paint(
    frame,
    (x, y) => {
      // 前が丸く後ろがすぼまる雫の形
      const sx = x < 0 ? x / 1.5 : x;
      const d = Math.hypot(sx, y);
      if (d > R * 0.85) return -1;
      if (Math.hypot(x - R * 0.15, y + R * 0.1) < R * 0.3) return lv(7);
      return d > R * 0.7 ? lv(4) : lv(5);
    },
    { bounds: { x0: -R * 1.5, y0: -R * 1.2, x1: R * 1.2, y1: R * 1.2 } },
  );
  // 尾から落ちる粒
  splatter(frame, 0, 4, GEN + 97 + f, (i, r) => ({ x: -R * (1.2 + 1.8 * r(1)), y: (r(2) - 0.5) * R * 0.7, vx: 0, vy: 0, size: 0.9, life: 1, level: 6 }));
}

/** 連鎖の 1 区間: 筆の稲妻（角で折れる鋭い跳び線）。両端は y = 0 に戻り、区間を並べると続く */
function artChainBolt(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const L = ART_CHAIN_STEP_PX + 0.6;
  const pts = [
    { x: -L, y: 0 },
    { x: -L * 0.45, y: -7 },
    { x: L * 0.05, y: 5 },
    { x: L * 0.5, y: -4 },
    { x: L, y: 0 },
  ];
  brushStroke(frame, { pts, width: 4.2 * (1 - 0.35 * smoothstep(0.3, 1, p)), profile: () => 1, flat: true, dry: 0, coreWidth: 0.2, fade: smoothstep(0.35, 1, p) * 0.85, pitch: 1, breakLen: 14, seed: GEN + 100 });
}

/** 連鎖の着いた所: 小さく墨が弾ける */
function artChainHit(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.7) inkBlot(frame, { x: 0, y: 0, radius: 8 * (1 - 0.4 * p), seed: GEN + 102, coreWidth: 0.4 - 0.35 * p });
  splatter(frame, f, 10, GEN + 103, (i, r) => {
    const a = r(1) * TAU;
    const sp = 2 + 3 * r(2);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 1.3 : 0.8, life: 4, level: 7 };
  });
}

/** 引き寄せ: 外から内へ巻く 3 本の渦の筆。外で起筆し、内へ向けて細って払う。粒も内へ吸われる */
function artPull(frame, f) {
  const frames = 9;
  const R = ART_PULL_PX * 2;
  const p = (f + 0.5) / frames;
  const grow = smoothstep(0, 0.6, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  const arms = 3;
  for (let k = 0; k < arms; k++) {
    const a0 = (k / arms) * TAU + 0.3;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = a0 + t * Math.PI * 1.15;
      const rr = R * (0.95 - 0.78 * t);
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    brushStroke(frame, { pts, width: 7, grow, fade, dry: 0.55, press: 0.08, tail: 0.55, seed: GEN + 110 + k });
  }
  splatter(frame, f, 18, GEN + 115, (i, r) => {
    const a = r(1) * TAU;
    const rr = R * (0.85 + 0.15 * r(2));
    const sp = 3 + 3 * r(3);
    // 内向き + 渦の向きへ少し
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: -Math.cos(a) * sp - Math.sin(a) * 1.5, vy: -Math.sin(a) * sp + Math.cos(a) * 1.5, size: r(4) > 0.55 ? 1.4 : 0.9, born: Math.floor(r(5) * 4), life: 5, level: 7 };
  });
}

/** 自己強化: 足元から体を巡って立ち昇る筆の渦（楕円の螺旋 3 本。細い筆で入り・抜きとも細る）と、上へ抜ける墨の煙 */
function artBuff(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.55, 1, p) * 0.9;
  const RX = 24;
  const RY = 8;
  const rise = 50;
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const a = Math.PI * 0.5 + (k * TAU) / 3 + t * TAU * 1.1;
      const rx = RX * (1 - 0.4 * t);
      pts.push({ x: Math.cos(a) * rx, y: 16 + Math.sin(a) * RY * (1 - 0.3 * t) - rise * t });
    }
    const grow = smoothstep(k * 0.06, 0.6 + k * 0.06, p);
    brushStroke(frame, { pts, width: 4 - k * 0.6, profile: (u) => 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.15)), grow, fade: Math.min(1, fade + k * 0.08), dry: 0.6, coreWidth: 0.2, seed: GEN + 120 + k });
  }
  // 立ち昇る墨の煙（小さな粒。上へ流れ、細る）
  splatter(frame, f, 12, GEN + 125, (i, r) => ({ x: (r(1) - 0.5) * 34, y: 8 - r(2) * 24, vx: (r(3) - 0.5) * 1, vy: -(2 + 2.5 * r(4)), size: r(5) > 0.5 ? 1.2 : 0.8, born: Math.floor(r(6) * 5), life: 5, level: r(7) > 0.5 ? 6 : 4 }));
}

/** 起爆: 足元から四方へ墨が跳ぶ。外の掠れた輪が一瞬走る */
function artDetonate(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = 52;
  // 四方へ跳ぶ短い筆（足元から外へ払う）
  const n = 12;
  const g = smoothstep(0, 0.4, p);
  const fade = smoothstep(0.35, 1, p) * 0.9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash1(i, GEN + 130) * 0.4;
    const r0 = 10 + 4 * hash1(i, GEN + 131);
    const r1 = R * (0.55 + 0.35 * hash1(i, GEN + 132));
    brushStroke(frame, { pts: [{ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 }], width: 3.5 + 2 * hash1(i, GEN + 133), grow: g, fade, dry: 0.5, press: 0.2, tail: 0.7, seed: GEN + 134 + i });
  }
  // 掠れた輪
  const g2 = smoothstep(0.1, 0.5, p);
  if (g2 > 0.02) enso(frame, { radius: R * 0.95, a0: Math.PI * 0.2, sweep: TAU * 0.85, width: 3.5, grow: g2, fade: Math.min(1, fade + 0.25), dry: 0.8, seed: GEN + 150 });
  splatter(frame, f, 24, GEN + 151, (i, r) => {
    const a = r(1) * TAU;
    const sp = 3 + 4 * r(2);
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.55 ? 1.6 : 0.9, born: Math.floor(r(4) * 2), life: 5, level: 7 };
  });
}

const FX = {
  skills: {
    // 汎用の技の絵（技の表に無い種類の行為・技の弾）。特定の技に寄せない素直な墨の形
    "@art": {
      ramp: "steel",
      // 技の弾（state.skills.shots）: 墨の雫と尾。弾の半径で拡縮
      fly: { sheet: "skillArt.artFly", base: ART_FLY_PX, period: 0.3 },
      acts: {
        // 扇: pos = 自分、angle = 扇の中心の向き、size = 届く距離
        arc: { sheet: "skillArt.artArc", life: 0.3, base: ART_REACH_PX },
        arcWide: { sheet: "skillArt.artArcWide", life: 0.34, base: ART_REACH_PX },
        arcFull: { sheet: "skillArt.artArcFull", life: 0.4, base: ART_REACH_PX },
        ring: { sheet: "skillArt.artRing", life: 0.42, base: ART_RING_PX },
        ringTarget: { sheet: "skillArt.artBurst", life: 0.42, base: ART_BURST_PX },
        // 帯: pos = 起筆、to = 止め。一文字は pos → to に並べる
        line: { sheet: "skillArt.artLinePress", life: 0.32, beam: { sheet: "skillArt.artLineBeam", step: ART_LINE_STEP_PX }, tip: "skillArt.artLineTip" },
        // 踏み込み: angle = 動いた向き。pos = 蹴り、to = 着地
        dash: { sheet: "skillArt.artKick", life: 0.34, beam: { sheet: "skillArt.artDashTrail", step: ART_DASH_STEP_PX }, tip: "skillArt.artDashStop" },
        dashBack: { sheet: "skillArt.artKick", life: 0.34, beam: { sheet: "skillArt.artDashTrail", step: ART_DASH_STEP_PX }, tip: "skillArt.artBackStop" },
        blink: { sheet: "skillArt.artBlinkFrom", life: 0.36, beam: { sheet: "skillArt.artBlinkDots", step: ART_BLINK_STEP_PX }, tip: "skillArt.artBlinkTo" },
        shot: { sheet: "skillArt.artShot", life: 0.22, base: 0 },
        // 連鎖の 1 跳び: pos → to（敵）
        chain: { sheet: "skillArt.artChainHit", life: 0.3, pivot: "to", beam: { sheet: "skillArt.artChainBolt", step: ART_CHAIN_STEP_PX } },
        pull: { sheet: "skillArt.artPull", life: 0.42, base: ART_PULL_PX },
        buff: { sheet: "skillArt.artBuff", life: 0.5, base: 0 },
        detonate: { sheet: "skillArt.artDetonate", life: 0.36, base: 0 },
      },
    },
    commonWhirl: {
      ramp: "steel",
      acts: { ring: { sheet: "skillArt.whirl", life: 0.45, base: WHIRL.radiusPx } },
    },
    commonRailshot: {
      ramp: "light",
      // pos = 撃った位置（起筆）、to = 帯の終点（止め）。帯は pos → to に並べる
      acts: { line: { sheet: "skillArt.railPress", life: 0.32, beam: { sheet: "skillArt.railBeam", step: RAIL_STEP_PX }, tip: "skillArt.railTip" } },
    },
    commonLunge: {
      ramp: "steel",
      // pos = 踏み込んだ所（蹴り）、to = 止まった所（払い）。飛白は pos → to に並べる
      acts: { dash: { sheet: "skillArt.lungeKick", life: 0.36, beam: { sheet: "skillArt.lungeTrail", step: LUNGE_STEP_PX }, tip: "skillArt.lungeCut" } },
    },
  },
};

export const ATLAS = {
  key: "skillArt",
  fx: FX,
  sheets: [
    { key: "skillArt.whirl", dirs: 1, frames: WHIRL.frames, active: 0, size: Math.ceil(WHIRL.radiusPx * 2 + 30) * 2, draw: whirl },
    { key: "skillArt.railPress", dirs: DIRS, frames: 7, active: 0, size: 96, draw: railPress },
    { key: "skillArt.railBeam", dirs: 1, frames: 7, active: 0, size: 64, ink: false, draw: railBeam },
    { key: "skillArt.railTip", dirs: DIRS, frames: 7, active: 0, size: 96, draw: railTip },
    { key: "skillArt.lungeKick", dirs: DIRS, frames: 6, active: 0, size: 96, draw: lungeKick },
    { key: "skillArt.lungeTrail", dirs: 1, frames: 8, active: 0, size: 48, ink: false, draw: lungeTrail },
    { key: "skillArt.lungeCut", dirs: DIRS, frames: 8, active: 0, size: 112, draw: lungeCut },
    // 汎用の技の絵
    { key: "skillArt.artArc", dirs: DIRS, frames: ART_ARC_FRAMES, active: 0, size: Math.ceil(ART_REACH_PX * 2 + 24) * 2, draw: artArc },
    { key: "skillArt.artArcWide", dirs: DIRS, frames: ART_ARC_FRAMES, active: 0, size: Math.ceil(ART_REACH_PX * 2 + 24) * 2, draw: artArcWide },
    { key: "skillArt.artArcFull", dirs: DIRS, frames: 9, active: 0, size: Math.ceil(ART_REACH_PX * 2 + 24) * 2, draw: artArcFull },
    { key: "skillArt.artRing", dirs: 1, frames: 9, active: 0, size: Math.ceil(ART_RING_PX * 2 + 26) * 2, draw: artRing },
    { key: "skillArt.artBurst", dirs: 1, frames: 9, active: 0, size: Math.ceil(ART_BURST_PX * 2 + 30) * 2, draw: artBurst },
    { key: "skillArt.artLinePress", dirs: DIRS, frames: 7, active: 0, size: 80, draw: artLinePress },
    { key: "skillArt.artLineBeam", dirs: 1, frames: 7, active: 0, size: 64, ink: false, draw: artLineBeam },
    { key: "skillArt.artLineTip", dirs: DIRS, frames: 7, active: 0, size: 80, draw: artLineTip },
    { key: "skillArt.artKick", dirs: DIRS, frames: 6, active: 0, size: 64, draw: artKick },
    { key: "skillArt.artDashTrail", dirs: 1, frames: 8, active: 0, size: 48, ink: false, draw: artDashTrail },
    { key: "skillArt.artDashStop", dirs: DIRS, frames: 7, active: 0, size: 72, draw: artDashStop },
    { key: "skillArt.artBackStop", dirs: DIRS, frames: 7, active: 0, size: 88, draw: artBackStop },
    { key: "skillArt.artBlinkFrom", dirs: 1, frames: 8, active: 0, size: 72, draw: artBlinkFrom },
    { key: "skillArt.artBlinkDots", dirs: 1, frames: 8, active: 0, size: 40, ink: false, draw: artBlinkDots },
    { key: "skillArt.artBlinkTo", dirs: 1, frames: 8, active: 0, size: 72, draw: artBlinkTo },
    { key: "skillArt.artShot", dirs: DIRS, frames: 6, active: 0, size: 120, draw: artShot },
    { key: "skillArt.artFly", dirs: DIRS, frames: 6, active: 0, size: 112, draw: artFly },
    { key: "skillArt.artChainBolt", dirs: 1, frames: 7, active: 0, size: 56, ink: false, draw: artChainBolt },
    { key: "skillArt.artChainHit", dirs: 1, frames: 7, active: 0, size: 56, draw: artChainHit },
    { key: "skillArt.artPull", dirs: 1, frames: 9, active: 0, size: Math.ceil(ART_PULL_PX * 2 + 24) * 2, draw: artPull },
    { key: "skillArt.artBuff", dirs: 1, frames: 10, active: 0, size: 112, draw: artBuff },
    { key: "skillArt.artDetonate", dirs: 1, frames: 8, active: 0, size: 160, draw: artDetonate },
  ],
};
