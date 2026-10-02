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
import { brushStroke, enso, inkBlot, splatter } from "../brush.mjs";
import { smoothstep } from "../raster.mjs";
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

const FX = {
  skills: {
    // 汎用の技の絵（技の表に無い種類の行為）。見本の間は旋風・撃ち抜き・突進の絵を借りる（汎用の絵の担当が描き直す）
    "@art": {
      ramp: "steel",
      acts: {
        ring: { sheet: "skillArt.whirl", life: 0.45, base: WHIRL.radiusPx },
        line: { sheet: "skillArt.railPress", life: 0.32, beam: { sheet: "skillArt.railBeam", step: RAIL_STEP_PX }, tip: "skillArt.railTip" },
        dash: { sheet: "skillArt.lungeKick", life: 0.36, beam: { sheet: "skillArt.lungeTrail", step: LUNGE_STEP_PX }, tip: "skillArt.lungeCut" },
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
  ],
};
