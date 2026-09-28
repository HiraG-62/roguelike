// スキル石: 弾・ビーム・鎖（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（撃つ向き）
//
// 撃ち抜き（railshot）: 「照準してから、壁まで貫通するビームを撃つ」。照準 0.35 秒 → 光の素性（light）のビーム
// - 照準（active）: 構えた先（体の前）へ光が吸い込まれて玉に育ち、照準の四隅の括弧が締まっていく
// - 発射（act）: 銃口の閃光と、撃った反動の衝撃の輪（進む向きに潰れた楕円）
// - ビーム（beam。step px ごとに並べる 1 区間）: 白い芯と光の帯、その周りを螺旋が巻く（区間の長さで周期が切れ目なく続く）。細って消える
// - 着弾（tip）: 壁で光が弾けて、手前へ火花が返る
import { ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, paint, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const SEED = 5101;
/** 光の玉の位置（体の中心からの前、ドット） */
const MUZZLE = 20;

/** 照準: 周りから前の一点へ光の筋が吸い込まれ、玉が育つ。四隅の括弧が締まる */
function charge(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  // 吸い込まれる筋（外から玉へ、進み具合で短くなる）
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 11 + k, SEED);
    const a = (i / 9) * Math.PI * 2 + r(1) * 0.5;
    const phase = (p * 1.6 + r(2)) % 1;
    const far = 34 * (1 - phase) + 6;
    const near = far * 0.55;
    streakLine(frame, { ax: MUZZLE + Math.cos(a) * far, ay: Math.sin(a) * far, bx: MUZZLE + Math.cos(a) * near, by: Math.sin(a) * near, bright: 0.35 + 0.45 * phase });
  }
  // 玉: 進み具合で大きく、芯は白
  const rad = 2 + 5 * smoothstep(0, 1, p);
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - MUZZLE, y) / rad;
      if (d > 1) return -1;
      return clamp01(1.05 - 0.6 * d);
    },
    { bounds: { x0: MUZZLE - rad - 1, y0: -rad - 1, x1: MUZZLE + rad + 1, y1: rad + 1 } },
  );
  if (p > 0.5) glint(frame, MUZZLE, 0, p > 0.85 ? 3 : 2);
  // 照準の括弧（四隅の L 字）が外から締まる
  const box = 22 - 12 * p;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = MUZZLE + sx * box;
      const cy = sy * box;
      streakLine(frame, { ax: cx, ay: cy, bx: cx - sx * 5, by: cy, bright: 0.55 + 0.3 * p });
      streakLine(frame, { ax: cx, ay: cy, bx: cx, by: cy - sy * 5, bright: 0.55 + 0.3 * p });
    }
  }
}

/** 発射の閃光: 前へ伸びる光の舌と、反動の衝撃の輪 */
function muzzle(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.2, 1, p);
  // 前へ伸びる舌（菱形に近い閃光）
  const len = 26 * (1 - p * 0.6);
  const wid = 9 * fade + 1;
  paint(
    frame,
    (x, y) => {
      const u = (x - MUZZLE + 4) / len;
      if (u < 0 || u > 1) return -1;
      const w = wid * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u * 0.5);
      if (Math.abs(y) > w) return -1;
      return clamp01((1.1 - Math.abs(y) / Math.max(1, w)) * fade);
    },
    { bounds: { x0: MUZZLE - 6, y0: -wid - 2, x1: MUZZLE + len, y1: wid + 2 } },
  );
  // 反動の輪: 銃口のまわりで横に潰れた楕円が広がる
  ring(frame, { ox: MUZZLE, radius: 4 + 16 * p, width: 3 - p * 1.5, squash: 0.4, bright: 0.85 * fade });
  if (p < 0.3) glint(frame, MUZZLE, 0, 4);
  shards(frame, f, 7, SEED + 3, (i, r) => ({ x: MUZZLE, y: 0, vx: -1 + 3 * r(1), vy: (r(2) - 0.5) * 7, life: 3 + Math.floor(3 * r(3)) }));
}

/** ビームの 1 区間（step px）。芯・帯・螺旋。フレームが進むと帯が細り、螺旋がほどける */
const BEAM_STEP_PX = 12;
const HELIX_TURNS = 1;
function beam(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = BEAM_STEP_PX + 0.6;
  const band = 7 * (1 - p) + 1.2;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half) return -1;
      const d = Math.abs(y);
      // 芯（白）
      if (d < 1.1 && p < 0.8) return 1;
      if (d > band) return -1;
      return clamp01((0.85 - 0.55 * (d / band)) * (1 - p * 0.5));
    },
    { bounds: { x0: -half - 1, y0: -band - 2, x1: half + 1, y1: band + 2 }, dither: 0.02 },
  );
  // 螺旋: 区間の長さ（2 × half ドット）でちょうど HELIX_TURNS 周するので、並べても切れ目が続く
  if (p < 0.85) {
    const amp = band + 3 - p * 2;
    for (let x = -BEAM_STEP_PX; x < BEAM_STEP_PX; x += 0.5) {
      const ph = ((x + BEAM_STEP_PX) / (BEAM_STEP_PX * 2)) * Math.PI * 2 * HELIX_TURNS + f * 0.9;
      const y = Math.sin(ph) * amp;
      // 手前（cos > 0）は明るく、奥は暗く
      dot(frame, x, y, Math.cos(ph) > 0 ? 6 : 3);
    }
  }
}

/** 着弾: 壁で光が弾け、手前（-x）へ火花が返る */
function tip(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.2, 1, p);
  const rad = 4 + 8 * p;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y) / rad;
      if (d > 1) return -1;
      return clamp01((1.05 - 0.7 * d) * fade);
    },
    { bounds: { x0: -rad - 1, y0: -rad - 1, x1: rad + 1, y1: rad + 1 } },
  );
  if (p < 0.4) glint(frame, 0, 0, 4);
  shards(frame, f, 10, SEED + 7, (i, r) => ({ x: 0, y: 0, vx: -(2 + 5 * r(1)), vy: (r(2) - 0.5) * 9, life: 3 + Math.floor(4 * r(3)), size: r(4) > 0.5 ? 2 : 1 }));
  ring(frame, { radius: 3 + 14 * p, width: 2, squash: 0.5, bright: 0.7 * fade });
}

const FX = {
  skills: {
    railshot: {
      ramp: "light",
      active: { sheet: "skillShot.railCharge", base: 0 },
      // act: pos = 撃った位置（銃口の閃光）、to = 壁（着弾）。ビームは pos → to に並べる
      act: { sheet: "skillShot.railMuzzle", life: 0.3, beam: { sheet: "skillShot.railBeam", step: BEAM_STEP_PX }, tip: "skillShot.railTip" },
    },
  },
};

export const ATLAS = {
  key: "skillShot",
  fx: FX,
  sheets: [
    { key: "skillShot.railCharge", dirs: DIRS, frames: 8, active: 8, size: 128, draw: charge },
    { key: "skillShot.railMuzzle", dirs: DIRS, frames: 7, active: 0, size: 120, draw: muzzle },
    { key: "skillShot.railBeam", dirs: 1, frames: 7, active: 0, size: 64, draw: beam },
    { key: "skillShot.railTip", dirs: DIRS, frames: 7, active: 0, size: 80, draw: tip },
  ],
};
