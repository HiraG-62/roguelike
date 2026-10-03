// 技（共通技）の墨のエフェクト その 2（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 見本は skillArt.mjs（旋風斬り・撃ち抜き・突進斬り）。技の行為の種類（acts.<種類>）ごとに、その技の名と説明から連想できる墨の絵を描く。
// 数値は src/data/balance/skills/ART/common.json（半径・幅・弾の半径）。当たりの px × 2 ドットで描き、表の base にその px を書く
//
// 投げ短刀（commonKnifeFan。shot・5 本 12° おき）: 手首の払いの弧と 5 本の投げ筋（shot）。飛ぶのは筆で描いた短刀と血の雫（fly）
// 流星（commonMeteor。ringTarget・半径 44px・火）: 斜め上から墨の星が筆の尾を引いて落ち、墨だまりが割れて四方へ飛び散る。
//   円相の火口の縁に炎の舌（筆の払い）が立つ。床は焦げの滲み
// 疾走（commonQuickstep。buff）: 体の後ろへ流れる乾いた筆の飛白の速さの筋と、前を切る風の払い、蹴りの飛沫
// 鉄身（commonIronSkin。buff）: 六枚の太い筆の板（鉄の甲羅）が体へ締まり、閉じた瞬間に墨が弾ける（鐘を打つ音の輪）
// 介錯（commonExecution。line・長さ 60px・幅 12px）: 起筆の押し込み → 細く鋭い突きの一筆（beam）→ 先端の尖りと、
//   止めの斜めの一閃と垂れる墨の雫（tip）
// 乱れ弾（commonBarrage。shot × 4）: 銃口の小さな墨の打ち込みと乱れた短い筆（shot）。飛ぶのは揺れる尾を引く墨の粒（fly）
// 地槍（commonGroundSpike。ring × 3・半径 16/18/20px）: 地面から筆の槍が数本突き上がって引っ込む（空中）。床は割れ目と土の滲み
// 氷輪（commonFrostNova。ring・半径 40px・氷）: 中心の六花から氷の円相が広がり、外へ氷柱の筆が尖る（空中）。床は氷の滲みと割れ目
// 血気（commonBloodSurge。buff）: 心臓の拍の太い円相と、足元から立ち昇る血の墨の煙、上へ跳ねる血の雫
// 風切り（commonWindCutter。shot・弾の半径 12px）: 大振りの弧の一筆（shot）。飛ぶのは重い三日月の筆と後ろへ流れる飛白（fly）
// 跳弾（commonRicochet。shot・弾の半径 5px）: 横投げの払い（shot）。飛ぶのは回る二枚刃の筆と回転の掠れ（fly）
// 散弾（commonScatter。shot・6 粒 10° おき）: 至近で墨が扇に吹き散る（shot）。飛ぶのは大粒の墨（fly）
// 気弾（commonKiBlast。shot・弾の半径 7px）: 渦を巻いて一点に練り込み前へ押し出す（shot）。飛ぶのは回る円相の玉（fly）
// 毒刃（commonVenomDart。shot・弾の半径 5px・毒）: 投げの払いと毒の滴り（shot）。飛ぶのは毒を塗った苦無と垂れる毒の雫（fly）
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, hash2, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEED = 7301;

/** コマの進み（0..1。コマの真ん中） */
const prog = (f, frames) => (f + 0.5) / frames;

/** 2 点の一筆 */
function stroke(frame, x0, y0, x1, y1, o) {
  brushStroke(frame, { ...o, pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
}

/** 根元が太く先が尖る筆圧（槍・氷柱・刃の先） */
const spikeProfile = (u) => Math.max(0, 1 - Math.pow(u, 1.3)) * 0.95 + 0.05;
/** 先が太い筆圧（落ちる星の頭） */
const headProfile = (u) => 0.2 + 0.8 * Math.pow(u, 1.4);
/** 真ん中が太く両端が尖る（三日月・木の葉の刃） */
const leafProfile = (u) => Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.7);

/** 塗ったドットを座標ハッシュで間引く（消えかけの滲みを掠れさせる。frac は消す割合） */
function thinOut(frame, frac, seed) {
  if (frac <= 0) return;
  for (let iy = 0; iy < frame.h; iy++) {
    for (let ix = 0; ix < frame.w; ix++) {
      if (!frame.get(ix, iy)) continue;
      if (hash2(ix >> 1, iy >> 1, seed) < frac) frame.set(ix, iy, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// 投げ短刀
// ---------------------------------------------------------------------------

const KNIFE = { count: 5, spreadDeg: 12, radiusPx: 3 };

/** 投げ（shot）: 手首の払いの弧と、扇に開く 5 本の投げ筋 */
function knifeThrow(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  brushStroke(frame, { pts: arcPoints(-8, 0, 24, -50 * DEG, 100 * DEG, 24), width: 3.2, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.35, 1, p) * 0.9, dry: 0.6, tail: 0.6, seed: SEED + 1 });
  const half = ((KNIFE.count - 1) / 2) * KNIFE.spreadDeg * DEG;
  for (let i = 0; i < KNIFE.count; i++) {
    const a = -half + i * KNIFE.spreadDeg * DEG;
    const r0 = 14 + 10 * smoothstep(0.2, 1, p);
    const r1 = r0 + 22 * smoothstep(0, 0.4, p);
    stroke(frame, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, { width: 2.2, fade: smoothstep(0.3, 1, p), dry: 0.7, press: 0.02, tail: 0.8, seed: SEED + 2 + i });
  }
  splatter(frame, f, 8, SEED + 9, (i, r) => {
    const a = (r(1) - 0.5) * 2 * half;
    return { x: Math.cos(a) * 16, y: Math.sin(a) * 16, vx: Math.cos(a) * (3 + 3 * r(2)), vy: Math.sin(a) * (3 + 3 * r(2)), size: r(3) > 0.6 ? 1.3 : 0.8, life: 5, level: 6 };
  });
}

/** 飛ぶ短刀: 尖った刃・鍔・柄と、後ろへ引く筆の尾、刃先から落ちる血の雫 */
function knifeFly(frame, f) {
  stroke(frame, -2, 0, 13, 0, { width: 3.2, profile: spikeProfile, dry: 0, core: lv(6), coreWidth: 0.25, seed: SEED + 10 });
  stroke(frame, -2.5, -3.5, -2.5, 3.5, { width: 1.3, profile: () => 1, dry: 0, seed: SEED + 11 });
  stroke(frame, -9, 0, -3, 0, { width: 1.6, profile: () => 1, dry: 0, seed: SEED + 12 });
  for (let i = 0; i < 2; i++) {
    const len = 8 + ((f + i * 2) % 4) * 3;
    stroke(frame, -11, (i - 0.5) * 2.4, -11 - len, (i - 0.5) * 3.4, { width: 1.1, profile: () => 1, dry: 0.5, fade: 0.25, seed: SEED + 13 + i });
  }
  // 血の雫（出血）: 刃の下へ垂れて後ろへ置いていかれる
  const k = f % 4;
  dot(frame, -4 - k * 3, 2.5 + k * 0.8, 6);
  dot(frame, -4.5 - k * 3, 2.5 + k * 0.8, 5);
}

// ---------------------------------------------------------------------------
// 流星
// ---------------------------------------------------------------------------

const METEOR = { radiusPx: 44, frames: 10 };
const METEOR_R = METEOR.radiusPx * 2;
/** 落ちてくる向き（左上から） */
const FALL = { x: -0.55, y: -0.83 };

/** 着弾（空中）: 星が尾を引いて落ち、墨だまりが割れ、四方へ飛沫。火口の縁に炎の舌 */
function meteorImpact(frame, f) {
  const frames = METEOR.frames;
  const p = prog(f, frames);
  // 落ちる星（最初の 2 コマ）: 頭が太い筆の尾
  if (p < 0.25) {
    const t = smoothstep(0, 0.22, p);
    const hx = FALL.x * 90 * (1 - t);
    const hy = FALL.y * 90 * (1 - t);
    stroke(frame, hx + FALL.x * 70, hy + FALL.y * 70, hx, hy, { width: 11, profile: headProfile, dry: 0.5, seed: SEED + 20 });
    inkBlot(frame, { x: hx, y: hy, radius: 10, seed: SEED + 21, coreWidth: 0.45, core: lv(7) });
  }
  // 着弾の墨だまり: 大きく打ち込まれて割れる
  if (p >= 0.15 && p < 0.6) {
    const q = smoothstep(0.15, 0.6, p);
    inkBlot(frame, { radius: 28 + 12 * q, seed: SEED + 22, coreWidth: 0.5 - 0.4 * q, core: lv(7) });
    if (q > 0.3) thinOut(frame, (q - 0.3) * 1.2, SEED + 23 + f);
  }
  // 火口の縁: 一筆の円相
  if (p >= 0.2) {
    const g = smoothstep(0.2, 0.55, p);
    enso(frame, { radius: METEOR_R * 0.88, a0: -2.2, sweep: TAU * 0.9, width: 7, grow: g, fade: smoothstep(0.6, 1, p) * 0.9, dry: 0.6, seed: SEED + 24 });
  }
  // 四方へ飛ぶ飛沫
  splatter(frame, f, 30, SEED + 25, (i, r) => {
    const a = r(1) * TAU;
    const sp = 6 + 8 * r(2);
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.6 ? 2.4 : 1.2, born: 2, life: 6, level: r(4) > 0.5 ? 7 : 5 };
  });
  // 炎の舌: 縁から上へ揺れて立つ筆の払い（芯は火の差し色）
  if (p >= 0.35) {
    const q = smoothstep(0.35, 0.75, p);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + hash1(i, SEED + 26) * 0.4;
      const bx = Math.cos(a) * METEOR_R * 0.82;
      const by = Math.sin(a) * METEOR_R * 0.6;
      const h = (14 + 10 * hash1(i, SEED + 27)) * q;
      const sway = Math.sin(f * 1.3 + i) * 4;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push({ x: bx + sway * t * t + Math.sin(t * 3 + i) * 2, y: by - h * t });
      }
      brushStroke(frame, { pts, width: 3.6, profile: spikeProfile, fade: smoothstep(0.7, 1, p), dry: 0.4, coreWidth: 0.2, seed: SEED + 30 + i });
    }
  }
}

/** 着弾（床）: 焦げの滲みが広がり、割れ目の筆が走る（炎の床の上の跡） */
function meteorScorch(frame, f) {
  const frames = METEOR.frames;
  const p = prog(f, frames);
  if (p < 0.15) return;
  const reach = smoothstep(0.15, 0.5, p);
  inkWash(frame, { radius: METEOR_R * 0.8, reach, seed: SEED + 40, rimWidth: 3, rimLevel: 5, tint: 6, density: 0.14, cell: 7 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash1(i, SEED + 41) * 0.6;
    const L = METEOR_R * (0.45 + 0.25 * hash1(i, SEED + 42));
    const mid = 0.5 + (hash1(i, SEED + 43) - 0.5) * 0.4;
    brushStroke(frame, {
      pts: [
        { x: Math.cos(a) * 14, y: Math.sin(a) * 14 },
        { x: Math.cos(a + 0.15) * L * mid, y: Math.sin(a + 0.15) * L * mid },
        { x: Math.cos(a - 0.05) * L, y: Math.sin(a - 0.05) * L },
      ],
      width: 2,
      grow: reach,
      dry: 0.3,
      press: 0.05,
      tail: 0.6,
      seed: SEED + 44 + i,
    });
  }
  thinOut(frame, smoothstep(0.65, 1, p) * 0.85, SEED + 49 + f);
}

// ---------------------------------------------------------------------------
// 疾走
// ---------------------------------------------------------------------------

/** 疾走（buff）: 後ろへ流れる飛白の速さの筋、前を切る風の払い、足元の蹴りの飛沫 */
function quickRun(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const rows = [-15, -6, 3, 12];
  rows.forEach((y, i) => {
    const slide = -22 * smoothstep(0.1, 1, p);
    const x0 = -6 + slide - 4 * hash1(i, SEED + 50);
    const len = (24 + 16 * hash1(i, SEED + 51)) * smoothstep(0, 0.35, p);
    stroke(frame, x0, y, x0 - len, y + 1, { width: 3.6, dry: 0.75, fade: smoothstep(0.4, 1, p) * 0.9, breakLen: 10, pitch: 1.2, tail: 0.7, seed: SEED + 52 + i });
  });
  // 前を切る風: 体の前を巻く弓なりの払い
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    pts.push({ x: 6 + 12 * Math.sin(t * Math.PI), y: -20 + 40 * t });
  }
  brushStroke(frame, { pts, width: 4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.35, 1, p) * 0.9, dry: 0.6, tail: 0.6, seed: SEED + 57 });
  splatter(frame, f, 10, SEED + 58, (i, r) => ({ x: -6, y: 12 + (r(1) - 0.5) * 6, vx: -(3 + 4 * r(2)), vy: (r(3) - 0.7) * 3, size: r(4) > 0.5 ? 1.5 : 0.8, life: 5, level: 6 }));
}

// ---------------------------------------------------------------------------
// 鉄身
// ---------------------------------------------------------------------------

/** 鉄身（buff）: 六枚の筆の板が体へ締まって甲羅になり、閉じた瞬間に墨が外へ弾ける */
function ironShell(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const close = smoothstep(0, 0.4, p);
  const R = 44 - 18 * close;
  const fade = smoothstep(0.6, 1, p) * 0.9;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU - Math.PI / 2 + 0.08;
    const a1 = ((i + 1) / 6) * TAU - Math.PI / 2 - 0.08;
    const g = smoothstep(i * 0.04, 0.3 + i * 0.04, p);
    stroke(frame, Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R, { width: 5.5, grow: g, fade, dry: 0.45, press: 0.15, tail: 0.3, sharp: 0.6, seed: SEED + 60 + i });
  }
  // 打ち締めた音の輪（細い円相が外へ）
  if (p > 0.4) {
    const q = smoothstep(0.4, 0.9, p);
    enso(frame, { radius: 30 + 22 * q, a0: 0.6, sweep: TAU * 0.8, width: 2.4, fade: 0.2 + 0.75 * q, dry: 0.7, seed: SEED + 67 });
  }
  splatter(frame, f, 16, SEED + 68, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 26, y: Math.sin(a) * 26, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.6 ? 1.6 : 0.9, born: 3, life: 5, level: 7 };
  });
}

// ---------------------------------------------------------------------------
// 介錯
// ---------------------------------------------------------------------------

const EXEC = { lengthPx: 60, widthPx: 12, stepPx: 12 };
/** 突きの筋の太さ（ドット。幅 12px より細い。鋭さを見せる） */
const EXEC_HALF = 6;

/** 起筆: 刃を押し込む小さな墨だまりと、後ろへ短い跳ね */
function execPress(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  if (p < 0.7) inkBlot(frame, { x: 6 + 6 * p, y: 0, radius: 9 * (1.2 - 0.6 * p), seed: SEED + 70 + f, coreWidth: 0.3 });
  stroke(frame, 2, 0, 24, 0, { width: 7, profile: spikeProfile, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.3, 1, p), dry: 0.4, seed: SEED + 71 });
  splatter(frame, f, 6, SEED + 72, (i, r) => ({ x: 2, y: 0, vx: -(1.5 + 2.5 * r(1)), vy: (r(2) - 0.5) * 5, size: r(3) > 0.5 ? 1.2 : 0.7, life: 4, level: 6 }));
}

/** 突きの 1 区間: 細く鋭い一筆。コマが進むと飛白が開いて消える */
function execBeam(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const half = EXEC.stepPx + 0.6;
  stroke(frame, -half, 0, half, 0, {
    width: EXEC_HALF * (1 - 0.6 * smoothstep(0.1, 1, p)) + 0.8,
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: smoothstep(0.25, 1, p) * 0.8,
    pitch: 1.2,
    breakLen: 30,
    coreWidth: 0.3,
    seed: SEED + 73,
  });
}

/** 止め: 突きの尖り、止めの斜めの一閃、垂れる墨の雫 */
function execTip(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  if (p < 0.6) stroke(frame, -16, 0, 12, 0, { width: 7, profile: spikeProfile, fade: smoothstep(0.2, 0.6, p), dry: 0, seed: SEED + 74 });
  // 一閃: 上から下へ斜めに切り下ろす
  if (p > 0.15) {
    const g = smoothstep(0.15, 0.45, p);
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push({ x: -12 + 26 * t + 4 * Math.sin(t * Math.PI), y: -30 + 60 * t });
    }
    brushStroke(frame, { pts, width: 6, grow: g, fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.5, press: 0.08, tail: 0.6, seed: SEED + 75 });
  }
  // 垂れる雫: 交点から墨が落ちる
  if (p > 0.4) {
    const q = smoothstep(0.4, 1, p);
    inkBlot(frame, { x: 2, y: 6 + 26 * q * q, radius: 3.2 - 1.2 * q, seed: SEED + 76, coreWidth: 0.4 });
    stroke(frame, 2, 4, 2, 4 + 24 * q * q, { width: 1.4, profile: () => 1, fade: q * 0.6, dry: 0.3, seed: SEED + 77 });
  }
  splatter(frame, f, 10, SEED + 78, (i, r) => ({ x: 4, y: (r(1) - 0.5) * 16, vx: 3 + 4 * r(2), vy: (r(3) - 0.5) * 6, size: r(4) > 0.5 ? 1.5 : 0.8, born: 1, life: 5, level: 7 }));
}

// ---------------------------------------------------------------------------
// 乱れ弾
// ---------------------------------------------------------------------------

const BARRAGE = { radiusPx: 3 };

/** 撃つ（shot）: 銃口の小さな墨の打ち込みと、乱れて散る短い筆 */
function barrageFlash(frame, f) {
  const frames = 5;
  const p = prog(f, frames);
  if (p < 0.6) inkBlot(frame, { x: 8, y: 0, radius: 6 * (1.1 - 0.7 * p), seed: SEED + 80 + f, coreWidth: 0.35 });
  for (let i = 0; i < 3; i++) {
    const a = (hash1(i, SEED + 81) - 0.5) * 1.1;
    const r0 = 10 + 6 * p;
    const L = 8 + 8 * hash1(i, SEED + 82);
    stroke(frame, 4 + Math.cos(a) * r0, Math.sin(a) * r0, 4 + Math.cos(a) * (r0 + L), Math.sin(a) * (r0 + L), { width: 2, fade: smoothstep(0.2, 1, p), dry: 0.6, tail: 0.8, seed: SEED + 83 + i });
  }
}

/** 飛ぶ粒: 墨の粒と、揺れる細い尾（乱れ） */
function barrageFly(frame, f) {
  const wave = Math.sin((f / 4) * TAU) * 1.6;
  brushStroke(frame, {
    pts: [
      { x: -16, y: wave },
      { x: -9, y: -wave * 0.6 },
      { x: -2, y: 0 },
    ],
    width: 2.2,
    profile: (u) => 0.3 + 0.7 * u,
    dry: 0.5,
    seed: SEED + 85,
  });
  inkBlot(frame, { x: 0, y: 0, radius: 4.2, seed: SEED + 86 + f, coreWidth: 0.35 });
}

// ---------------------------------------------------------------------------
// 地槍
// ---------------------------------------------------------------------------

/** 描く半径（px）: 近・中・遠の真ん中。表の base で拡縮する */
const SPIKE = { radiusPx: 18, frames: 9 };
const SPIKE_R = SPIKE.radiusPx * 2;
/** 槍の並び（横の位置・高さ・傾き・出る順） */
const SPIKES = [
  { x: -18, h: 30, lean: -6, born: 0.08 },
  { x: -7, h: 44, lean: -2, born: 0 },
  { x: 4, h: 52, lean: 2, born: 0.03 },
  { x: 15, h: 38, lean: 7, born: 0.1 },
  { x: -1, h: 26, lean: 0, born: 0.14, y: 8 },
];

/** 突き上がる槍（空中）: 根元が太く先が尖る筆が地面から突き出て、引っ込む */
function spikeAir(frame, f) {
  const p = prog(f, SPIKE.frames);
  for (let i = 0; i < SPIKES.length; i++) {
    const s = SPIKES[i];
    const up = smoothstep(s.born, s.born + 0.2, p) * (1 - smoothstep(0.6, 0.95, p));
    if (up < 0.03) continue;
    const by = s.y ?? 4;
    brushStroke(frame, {
      pts: [
        { x: s.x, y: by },
        { x: s.x + s.lean * 0.5, y: by - s.h * 0.5 },
        { x: s.x + s.lean, y: by - s.h },
      ],
      width: 6,
      profile: spikeProfile,
      coreWidth: 0.16,
      grow: up,
      fade: smoothstep(0.7, 1, p) * 0.6,
      dry: 0.35,
      seed: SEED + 90 + i,
    });
  }
  // 打ち上げた土くれ（墨の粒が上へ）
  splatter(frame, f, 16, SEED + 96, (i, r) => ({ x: (r(1) - 0.5) * 36, y: 4, vx: (r(2) - 0.5) * 4, vy: -(3 + 5 * r(3)), size: r(4) > 0.6 ? 1.6 : 0.9, born: 1, life: 5, level: r(5) > 0.5 ? 6 : 4 }));
}

/** 床: 割れ目の筆と、割れた土の淡い滲み */
function spikeCrack(frame, f) {
  const p = prog(f, SPIKE.frames);
  const reach = smoothstep(0, 0.3, p);
  inkWash(frame, { radius: SPIKE_R * 0.95, reach, seed: SEED + 100, rimWidth: 2, rimLevel: 5, tint: 3, density: 0.22, cell: 6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash1(i, SEED + 101) * 0.7;
    const L = SPIKE_R * (0.8 + 0.3 * hash1(i, SEED + 102));
    brushStroke(frame, {
      pts: [
        { x: 0, y: 0 },
        { x: Math.cos(a + 0.2) * L * 0.5, y: Math.sin(a + 0.2) * L * 0.5 },
        { x: Math.cos(a) * L, y: Math.sin(a) * L },
      ],
      width: 2,
      grow: reach,
      dry: 0.3,
      press: 0.05,
      tail: 0.6,
      seed: SEED + 103 + i,
    });
  }
  thinOut(frame, smoothstep(0.6, 1, p) * 0.85, SEED + 109 + f);
}

// ---------------------------------------------------------------------------
// 氷輪
// ---------------------------------------------------------------------------

const NOVA = { radiusPx: 40, terrainPx: 26, frames: 10 };
const NOVA_R = NOVA.radiusPx * 2;

/** 六花: 中心から 6 本の細い筆と、枝 */
function snowflake(frame, r, fade, seed) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    stroke(frame, 0, 0, Math.cos(a) * r, Math.sin(a) * r, { width: 2.2, fade, dry: 0.2, press: 0.05, tail: 0.5, seed: seed + i });
    for (const s of [-1, 1]) {
      const bx = Math.cos(a) * r * 0.55;
      const by = Math.sin(a) * r * 0.55;
      const b = a + s * 0.8;
      stroke(frame, bx, by, bx + Math.cos(b) * r * 0.3, by + Math.sin(b) * r * 0.3, { width: 1.4, fade, dry: 0.2, profile: () => 1, seed: seed + 10 + i });
    }
  }
}

/** 凍てつく（空中）: 六花から氷の円相が広がり、外へ氷柱が尖る */
function novaBurst(frame, f) {
  const p = prog(f, NOVA.frames);
  if (p < 0.45) snowflake(frame, 14 + 6 * p, smoothstep(0.2, 0.45, p), SEED + 110);
  const g = smoothstep(0, 0.45, p);
  const R = NOVA_R * (0.3 + 0.62 * g);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  enso(frame, { radius: R, a0: -1.9, sweep: TAU * 0.94, width: 6, fade, dry: 0.5, coreWidth: 0.18, seed: SEED + 130 });
  // 氷柱: 輪から外へ尖る（長短を交互に）
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.12;
    const L = (i % 2 === 0 ? 18 : 10) * smoothstep(0.1, 0.5, p);
    if (L < 1) continue;
    stroke(frame, Math.cos(a) * (R - 2), Math.sin(a) * (R - 2), Math.cos(a) * (R + L), Math.sin(a) * (R + L), { width: 4.5, profile: spikeProfile, fade, dry: 0.2, coreWidth: 0.18, seed: SEED + 140 + i });
  }
  splatter(frame, f, 18, SEED + 155, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * R * 0.9, y: Math.sin(a) * R * 0.9, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), size: r(3) > 0.6 ? 1.4 : 0.8, born: 2, life: 5, level: 7 };
  });
}

/** 氷床（床）: 氷の滲みと六角に折れる割れ目 */
function novaFrost(frame, f) {
  const p = prog(f, NOVA.frames);
  const reach = smoothstep(0.1, 0.5, p);
  const R = NOVA.terrainPx * 2;
  inkWash(frame, { radius: R, reach, seed: SEED + 160, rimWidth: 2, rimLevel: 5, tint: 6, density: 0.12, cell: 6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const b = a + 0.5;
    brushStroke(frame, {
      pts: [
        { x: Math.cos(a) * 6, y: Math.sin(a) * 6 },
        { x: Math.cos(a) * R * 0.5, y: Math.sin(a) * R * 0.5 },
        { x: Math.cos(b) * R * 0.8, y: Math.sin(b) * R * 0.8 },
      ],
      width: 1.8,
      grow: reach,
      dry: 0.2,
      press: 0.05,
      tail: 0.6,
      seed: SEED + 161 + i,
    });
  }
  thinOut(frame, smoothstep(0.7, 1, p) * 0.7, SEED + 169 + f);
}

// ---------------------------------------------------------------------------
// 血気
// ---------------------------------------------------------------------------

/** 血気（buff）: 心臓の拍の太い円相、足元から立ち昇る血の墨の煙、上へ跳ねる血の雫 */
function bloodSurge(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  // 拍: 締まってから外へ打つ
  if (p < 0.55) {
    const beat = smoothstep(0, 0.2, p) * (1 - smoothstep(0.3, 0.55, p));
    enso(frame, { radius: 18 + 8 * smoothstep(0.15, 0.4, p), a0: -1.3, sweep: TAU * 0.86, width: 6 * beat + 1, fade: smoothstep(0.3, 0.55, p), dry: 0.4, coreWidth: 0.2, seed: SEED + 170 });
  }
  // 立ち昇る煙: 揺れながら上へ伸びる筆
  for (let i = 0; i < 5; i++) {
    const x0 = -16 + i * 8;
    const h = 34 + 10 * hash1(i, SEED + 171);
    const g = smoothstep(0.05 + i * 0.04, 0.55, p);
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push({ x: x0 * (1 - 0.4 * t) + Math.sin(t * 5 + i * 1.7 + p * 4) * 3.5, y: 12 - h * t });
    }
    brushStroke(frame, { pts, width: 3.6, profile: spikeProfile, grow: g, fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.5, coreWidth: 0.2, seed: SEED + 172 + i });
  }
  splatter(frame, f, 14, SEED + 180, (i, r) => ({ x: (r(1) - 0.5) * 24, y: 4 - r(2) * 10, vx: (r(3) - 0.5) * 3, vy: -(3 + 4 * r(4)), size: r(5) > 0.5 ? 1.5 : 0.9, born: 1 + Math.floor(r(6) * 4), life: 5, level: 7 }));
}

// ---------------------------------------------------------------------------
// 風切り
// ---------------------------------------------------------------------------

const WIND = { radiusPx: 12 };

/** 放つ（shot）: 大振りの弧の一筆と、刃先から前へ飛ぶ飛沫 */
function windLaunch(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  brushStroke(frame, { pts: arcPoints(-4, 0, 28, -80 * DEG, 160 * DEG, 32), width: 8, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.6, seed: SEED + 190 });
  splatter(frame, f, 12, SEED + 191, (i, r) => {
    const a = (r(1) - 0.5) * 2.6;
    return { x: -4 + Math.cos(a) * 28, y: Math.sin(a) * 28, vx: 3 + 3 * r(2), vy: Math.sin(a) * 2, size: r(3) > 0.6 ? 1.5 : 0.8, born: 1, life: 5, level: 6 };
  });
}

/** 飛ぶ斬撃: 前へ膨らむ重い三日月の筆と、内側の細い追い筆、後ろへ流れる飛白 */
function windFly(frame, f) {
  const R = 24;
  const cx = 8 - R;
  brushStroke(frame, { pts: arcPoints(cx, 0, R, -72 * DEG, 144 * DEG, 32), width: 7, profile: leafProfile, dry: 0.3, coreWidth: 0.3, seed: SEED + 200 });
  brushStroke(frame, { pts: arcPoints(cx - 6, 0, R - 2, -56 * DEG, 112 * DEG, 24), width: 2.6, profile: leafProfile, dry: 0.6, fade: 0.2, seed: SEED + 201 });
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 9;
    const x0 = cx + Math.sqrt(Math.max(0, R * R - y * y)) - 8;
    const len = 12 + ((f + i * 2) % 6) * 3;
    stroke(frame, x0, y, x0 - len, y * 1.05, { width: 2, profile: () => 1, dry: 0.7, fade: 0.25, breakLen: 8, seed: SEED + 202 + i });
  }
}

// ---------------------------------------------------------------------------
// 跳弾
// ---------------------------------------------------------------------------

const RICO = { radiusPx: 5, frames: 8 };

/** 投げる（shot）: 横投げの払いと飛沫 */
function ricoThrow(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  brushStroke(frame, {
    pts: [
      { x: -6, y: -16 },
      { x: 6, y: -10 },
      { x: 16, y: 0 },
    ],
    width: 4.5,
    grow: smoothstep(0, 0.35, p),
    fade: smoothstep(0.35, 1, p) * 0.9,
    dry: 0.6,
    tail: 0.6,
    seed: SEED + 210,
  });
  splatter(frame, f, 7, SEED + 211, (i, r) => ({ x: 16, y: 0, vx: 3 + 3 * r(1), vy: (r(2) - 0.5) * 4, size: r(3) > 0.5 ? 1.2 : 0.7, life: 4, level: 6 }));
}

/** 飛ぶ刃: 回る二枚刃（三日月の筆）と、回転の掠れの弧、後ろの尾 */
function ricoFly(frame, f) {
  const spin = (f / RICO.frames) * Math.PI;
  for (let k = 0; k < 2; k++) {
    const a = spin + k * Math.PI;
    // 刃: 中心から外へ、回る向きに反って尖る
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = 2 + 10 * t;
      const b = a - 0.6 * t * t;
      pts.push({ x: Math.cos(b) * r, y: Math.sin(b) * r });
    }
    brushStroke(frame, { pts, width: 3, profile: spikeProfile, dry: 0, coreWidth: 0.3, seed: SEED + 212 + k });
    // 回転の掠れ: 刃先の後ろの細い弧
    brushStroke(frame, { pts: arcPoints(0, 0, 11, a - 0.6, -1.3, 10), width: 1.2, profile: () => 1, dry: 0.6, fade: 0.35, seed: SEED + 214 + k });
  }
  inkBlot(frame, { radius: 2.4, seed: SEED + 216, coreWidth: 0.3 });
  stroke(frame, -12, 0, -24, 0, { width: 1.4, profile: () => 1, dry: 0.7, fade: 0.3, seed: SEED + 217 });
}

// ---------------------------------------------------------------------------
// 散弾
// ---------------------------------------------------------------------------

const SCATTER = { count: 6, spreadDeg: 10, radiusPx: 4 };

/** 浴びせる（shot）: 銃口の墨だまりと、扇に吹き散る墨の筋と粒 */
function scatterBlast(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const half = ((SCATTER.count - 1) / 2) * SCATTER.spreadDeg * DEG;
  if (p < 0.55) inkBlot(frame, { x: 8, y: 0, radius: 7 * (1.1 - 0.8 * p), seed: SEED + 220 + f, coreWidth: 0.35 });
  for (let i = 0; i < SCATTER.count; i++) {
    const a = -half + i * SCATTER.spreadDeg * DEG + (hash1(i, SEED + 221) - 0.5) * 0.08;
    const r0 = 10 + 18 * smoothstep(0.2, 1, p);
    const r1 = r0 + (28 + 20 * hash1(i, SEED + 222)) * smoothstep(0, 0.35, p);
    stroke(frame, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, { width: 3.4, fade: smoothstep(0.45, 1, p), dry: 0.4, press: 0.02, tail: 0.5, seed: SEED + 223 + i });
  }
  splatter(frame, f, 24, SEED + 230, (i, r) => {
    const a = (r(1) - 0.5) * 2 * half * 1.2;
    const sp = 7 + 10 * r(2);
    return { x: 8, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.6 ? 1.8 : 1, life: 6, level: r(4) > 0.5 ? 7 : 5 };
  });
}

/** 飛ぶ粒: 大粒の墨と、短い尾 */
function scatterFly(frame, f) {
  stroke(frame, -14, 0, -3, 0, { width: 3, profile: (u) => 0.3 + 0.7 * u, dry: 0.6, fade: 0.1, seed: SEED + 235 + f });
  inkBlot(frame, { x: 0, y: 0, radius: 5.6, seed: SEED + 236 + f, coreWidth: 0.35 });
}

// ---------------------------------------------------------------------------
// 気弾
// ---------------------------------------------------------------------------

const KI = { radiusPx: 7, frames: 8 };

/** 練る（shot）: 渦を巻いて銃口の一点へ練り込み、前へ押し出す */
function kiCharge(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * TAU * 1.4;
    const r = 24 * (1 - t) + 2;
    pts.push({ x: 10 + Math.cos(a) * r, y: Math.sin(a) * r });
  }
  brushStroke(frame, { pts, width: 4, grow: smoothstep(0, 0.45, p), fade: smoothstep(0.45, 1, p) * 0.9, dry: 0.55, press: 0.05, tail: 0.2, sharp: 0.3, seed: SEED + 240 });
  if (p > 0.4 && p < 0.85) inkBlot(frame, { x: 12 + 10 * smoothstep(0.4, 0.85, p), y: 0, radius: 6, seed: SEED + 241 + f, coreWidth: 0.4 });
  splatter(frame, f, 10, SEED + 242, (i, r) => {
    const a = (r(1) - 0.5) * 1.6;
    return { x: 14, y: 0, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.8, born: 3, life: 4, level: 7 };
  });
}

/** 飛ぶ気の玉: 回る円相と、逆に巻く内の渦、後ろへ引く 2 本の尾 */
function kiFly(frame, f) {
  const spin = (f / KI.frames) * TAU;
  enso(frame, { radius: 10, a0: spin, sweep: TAU * 0.82, width: 4, dry: 0.4, tail: 0.5, seed: SEED + 250 });
  brushStroke(frame, { pts: arcPoints(0, 0, 5, -spin * 1.3, -TAU * 0.6, 16), width: 2.4, dry: 0.3, seed: SEED + 251 });
  dot(frame, 0, 0, 7);
  dot(frame, 0.5, 0, 7);
  for (const s of [-1, 1]) {
    const len = 12 + ((f + (s > 0 ? 3 : 0)) % 4) * 3;
    stroke(frame, -6, s * 8, -6 - len, s * 6, { width: 1.8, profile: () => 1, dry: 0.6, fade: 0.25, seed: SEED + 253 + s });
  }
}

// ---------------------------------------------------------------------------
// 毒刃
// ---------------------------------------------------------------------------

const VENOM = { radiusPx: 5, frames: 6 };

/** 投げる（shot）: 投げの払いと、まき散る毒の滴 */
function venomThrow(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  brushStroke(frame, { pts: arcPoints(-4, 0, 18, -60 * DEG, 100 * DEG, 20), width: 4.5, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.35, 1, p) * 0.9, dry: 0.6, tail: 0.6, seed: SEED + 260 });
  splatter(frame, f, 12, SEED + 261, (i, r) => {
    const a = (r(1) - 0.3) * 1.6;
    return { x: 10, y: 4, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)) + 1.5, size: r(3) > 0.5 ? 1.6 : 0.9, life: 6, level: 7 };
  });
}

/** 飛ぶ苦無: 木の葉形の刃（芯に毒の差し色）・柄・輪、刃から垂れて置いていかれる毒の雫 */
function venomFly(frame, f) {
  stroke(frame, -4, 0, 14, 0, { width: 3.6, profile: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.25 + 0.75 * u)), 0.7), dry: 0, coreWidth: 0.25, seed: SEED + 270 });
  stroke(frame, -11, 0, -4, 0, { width: 1.5, profile: () => 1, dry: 0, seed: SEED + 271 });
  brushStroke(frame, { pts: arcPoints(-13.5, 0, 2.6, 0, TAU * 0.9, 12), width: 1.1, profile: () => 1, dry: 0, seed: SEED + 272 });
  for (let i = 0; i < 3; i++) {
    const k = (f + i * 2) % VENOM.frames;
    const x = -2 - k * 3.5;
    const y = 2.5 + k * 1.1;
    dot(frame, x, y, 7);
    dot(frame, x + 0.5, y, 6);
    dot(frame, x, y + 0.5, 6);
  }
  stroke(frame, -17, 0, -28, 0, { width: 1.3, profile: () => 1, dry: 0.7, fade: 0.3, seed: SEED + 273 });
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

const S = (name) => `skillArtB.${name}`;

const FX = {
  skills: {
    commonKnifeFan: {
      ramp: "steel",
      fly: { sheet: S("knifeFly"), base: KNIFE.radiusPx, period: 0.16 },
      acts: { shot: { sheet: S("knifeThrow"), life: 0.28, base: 0 } },
    },
    commonMeteor: {
      ramp: "fire",
      // pos = 落ちた所（照準地点）、size = 半径
      acts: { ringTarget: { sheet: S("meteorImpact"), ground: S("meteorScorch"), life: 0.6, base: METEOR.radiusPx } },
    },
    commonQuickstep: {
      ramp: "steel",
      // angle = 向いている向き（速さの筋はその後ろへ流れる）
      acts: { buff: { sheet: S("quickRun"), life: 0.45, base: 0 } },
    },
    commonIronSkin: {
      ramp: "steel",
      acts: { buff: { sheet: S("ironShell"), life: 0.5, base: 0 } },
    },
    commonExecution: {
      ramp: "steel",
      // pos = 突いた所（起筆）、to = 突きの先（壁で止まる）
      acts: { line: { sheet: S("execPress"), life: 0.36, base: 0, beam: { sheet: S("execBeam"), step: EXEC.stepPx }, tip: S("execTip") } },
    },
    commonBarrage: {
      ramp: "steel",
      fly: { sheet: S("barrageFly"), base: BARRAGE.radiusPx, period: 0.16 },
      acts: { shot: { sheet: S("barrageFlash"), life: 0.16, base: 0 } },
    },
    commonGroundSpike: {
      ramp: "steel",
      // pos = 前方の槍の出る所、size = 半径（近・中・遠で 16 / 18 / 20px）
      acts: { ring: { sheet: S("spikeAir"), ground: S("spikeCrack"), life: 0.5, base: SPIKE.radiusPx } },
    },
    commonFrostNova: {
      ramp: "ice",
      acts: { ring: { sheet: S("novaBurst"), ground: S("novaFrost"), life: 0.55, base: NOVA.radiusPx } },
    },
    commonBloodSurge: {
      // 血の差し色（素性は無属性。血抜きと同じく火の配色のくすんだ赤を借りる）
      ramp: "fire",
      acts: { buff: { sheet: S("bloodSurge"), life: 0.6, base: 0 } },
    },
    commonWindCutter: {
      ramp: "steel",
      fly: { sheet: S("windFly"), base: WIND.radiusPx, period: 0.24 },
      acts: { shot: { sheet: S("windLaunch"), life: 0.32, base: 0 } },
    },
    commonRicochet: {
      ramp: "steel",
      fly: { sheet: S("ricoFly"), base: RICO.radiusPx, period: 0.2 },
      acts: { shot: { sheet: S("ricoThrow"), life: 0.24, base: 0 } },
    },
    commonScatter: {
      ramp: "steel",
      fly: { sheet: S("scatterFly"), base: SCATTER.radiusPx, period: 0.16 },
      acts: { shot: { sheet: S("scatterBlast"), life: 0.3, base: 0 } },
    },
    commonKiBlast: {
      ramp: "steel",
      fly: { sheet: S("kiFly"), base: KI.radiusPx, period: 0.32 },
      acts: { shot: { sheet: S("kiCharge"), life: 0.3, base: 0 } },
    },
    commonVenomDart: {
      ramp: "poison",
      fly: { sheet: S("venomFly"), base: VENOM.radiusPx, period: 0.3 },
      acts: { shot: { sheet: S("venomThrow"), life: 0.3, base: 0 } },
    },
  },
};

const sheet = (name, dirs, frames, size, draw, extra = {}) => ({ key: S(name), dirs, frames, active: 0, size, draw, ...extra });

export const ATLAS = {
  key: "skillArtB",
  fx: FX,
  sheets: [
    sheet("knifeThrow", DIRS, 7, 112, knifeThrow),
    sheet("knifeFly", DIRS, 4, 64, knifeFly),
    sheet("meteorImpact", 1, METEOR.frames, Math.ceil(METEOR_R + 70) * 2, meteorImpact),
    sheet("meteorScorch", 1, METEOR.frames, Math.ceil(METEOR_R + 16) * 2, meteorScorch),
    sheet("quickRun", DIRS, 8, 144, quickRun),
    sheet("ironShell", 1, 9, 136, ironShell),
    sheet("execPress", DIRS, 7, 80, execPress),
    sheet("execBeam", 1, 7, 48, execBeam, { ink: false }),
    sheet("execTip", DIRS, 8, 112, execTip),
    sheet("barrageFlash", DIRS, 5, 72, barrageFlash),
    sheet("barrageFly", DIRS, 4, 48, barrageFly),
    sheet("spikeAir", 1, SPIKE.frames, 136, spikeAir),
    sheet("spikeCrack", 1, SPIKE.frames, Math.ceil(SPIKE_R * 1.3 + 10) * 2, spikeCrack),
    sheet("novaBurst", 1, NOVA.frames, Math.ceil(NOVA_R + 30) * 2, novaBurst),
    sheet("novaFrost", 1, NOVA.frames, Math.ceil(NOVA.terrainPx * 2 * 1.2 + 10) * 2, novaFrost),
    sheet("bloodSurge", 1, 10, 128, bloodSurge),
    sheet("windLaunch", DIRS, 8, 112, windLaunch),
    sheet("windFly", DIRS, 6, 96, windFly),
    sheet("ricoThrow", DIRS, 6, 72, ricoThrow),
    sheet("ricoFly", DIRS, RICO.frames, 64, ricoFly),
    sheet("scatterBlast", DIRS, 7, 160, scatterBlast),
    sheet("scatterFly", DIRS, 4, 48, scatterFly),
    sheet("kiCharge", DIRS, 8, 96, kiCharge),
    sheet("kiFly", DIRS, KI.frames, 72, kiFly),
    sheet("venomThrow", DIRS, 7, 80, venomThrow),
    sheet("venomFly", DIRS, VENOM.frames, 72, venomFly),
  ],
};
