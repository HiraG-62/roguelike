// スキル石: 移動（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（突進の向き）
//
// 突進斬り（lunge）: 「カーソル方向へ突進して斬る」。90px を 0.14 秒で駆け抜け、触れた敵を斬る
// - 踏み込み（cast）: 蹴った床から後ろへ土煙が噴き、踏み込みの足跡の割れ
// - 突進中（active）: 体の前に空気を裂く楔（弓なりの衝撃）、後ろへ長い速度線が流れる
// - 斬り抜け（end）: 通った道筋に一本の斬線が走り（beam。始点へ向けて並べる）、止まった所で刃を払う一閃と火花
import { crescent, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const SEED = 4101;

/**
 * 踏み込み: 蹴った足元から後ろ（-x）へ山形の衝撃の筋が弾け、床に潰れた輪が広がる。
 * 土煙の塊は鋼の配色だと青い煙に見えるので、線と輪だけで「床を蹴った」勢いを出す
 */
function kick(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.35, 1, p);
  // 山形（<）の筋を 3 本、後ろへ流す
  for (let i = 0; i < 3; i++) {
    const back = -6 - i * 9 - p * 16;
    const open = 7 + i * 2.5;
    const bright = (0.85 - i * 0.18) * fade;
    if (bright <= 0.05) continue;
    streakLine(frame, { ax: back - 5, ay: -open, bx: back, by: 0, bright, width: i === 0 ? 2 : 1 });
    streakLine(frame, { ax: back - 5, ay: open, bx: back, by: 0, bright, width: i === 0 ? 2 : 1 });
  }
  // 床の輪（進む向きに潰れた楕円が後ろ寄りに広がる）
  ring(frame, { ox: -4 - p * 6, radius: 5 + p * 18, width: 3 - p * 1.5, squash: 0.55, bright: 0.7 * fade, erosion: p * 0.5, seed: SEED + 30 });
  // 割れ: 足元から後ろへ短い筋
  if (p < 0.6) {
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 0.5;
      streakLine(frame, { ax: 0, ay: 0, bx: Math.cos(a) * (8 + 3 * i), by: Math.sin(a) * (8 + 3 * i), bright: 0.5 * (1 - p) });
    }
  }
}

/** 突進中: 前の楔（弓なりの空気の衝撃）と、後ろへ流れる速度線 */
function dash(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  // 前の楔: 進む向きへ開く細い三日月 2 枚（上下対称）
  const R = 22;
  crescent(frame, { ox: -8, oy: 0, R, T: 5, head: 0.95, tail: -0.05, peak: 0.25, seed: SEED + 1, bright: 0.95, edge: 1.4, edgeReach: 0.8 });
  crescent(frame, { ox: -8, oy: 0, R, T: 5, head: 0.05, tail: -0.95, peak: 0.75, seed: SEED + 2, bright: 0.95, edge: 1.4, edgeReach: 0.2 });
  // 速度線: 体の後ろへ長く、ずれながら流れる
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 5 + k + f * 31, SEED + 3);
    const y = (i - 3) * 4.5 + (r(1) - 0.5) * 2;
    const len = 40 + 60 * r(2);
    const x0 = -10 - 20 * r(3);
    streakLine(frame, { ax: x0 - len, ay: y, bx: x0, by: y, bright: 0.55 + 0.3 * (1 - Math.abs(i - 3) / 3), width: i === 3 ? 2 : 1 });
  }
  void p;
}

/** 斬り抜けの一閃: 止まった所で、進む向きに垂直な弓なりの斬線が走り、火花が前へ散る */
function cut(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const grow = Math.min(1, p * 3);
  const erosion = smoothstep(0.4, 1, p);
  lens(frame, { ax: 6, ay: -30, bx: 14, by: 30, T: 9, bend: 7, grow, erosion, seed: SEED + 5, bright: 1.05 });
  shards(frame, f, 9, SEED + 6, (i, r) => ({ x: 10, y: (r(1) - 0.5) * 30, vx: 4 + 4 * r(2), vy: (r(3) - 0.5) * 5, life: 4 + Math.floor(3 * r(4)), size: r(5) > 0.5 ? 2 : 1 }));
  if (p < 0.4) ring(frame, { ox: 10, radius: 6 + p * 30, width: 3, squash: 0.45, bright: 0.7 * (1 - p * 2) });
}

/** 通った道筋の斬線（beam で step ごとに並べる 1 区間）。細い白い芯が走り、だんだん細って消える */
const TRAIL_STEP_PX = 12;
function trail(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const half = TRAIL_STEP_PX + 1;
  const width = 3.2 * (1 - p) + 0.6;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half) return -1;
      const d = Math.abs(y) / width;
      if (d > 1) return -1;
      return clamp01((1.05 - 0.6 * d) * (1 - 0.55 * p));
    },
    { bounds: { x0: -half - 1, y0: -width - 2, x1: half + 1, y1: width + 2 }, dither: 0 },
  );
  // 芯の上に残る細かい光の粒（区間ごとに違う位置）
  if (p < 0.6) for (let i = 0; i < 2; i++) dot(frame, (hash1(i + f * 3, SEED + 8) - 0.5) * half * 2, (hash1(i, SEED + 9) - 0.5) * 6, 5);
}

const FX = {
  skills: {
    lunge: {
      ramp: "steel",
      cast: { sheet: "skillMove.lungeKick", life: 0.3 },
      active: { sheet: "skillMove.lungeDash", base: 0 },
      // end: pos = 止まった所、to = 始点。道筋の斬線は pos → to に並べる
      end: { sheet: "skillMove.lungeCut", life: 0.32, beam: { sheet: "skillMove.lungeTrail", step: TRAIL_STEP_PX } },
    },
  },
};

export const ATLAS = {
  key: "skillMove",
  fx: FX,
  sheets: [
    { key: "skillMove.lungeKick", dirs: DIRS, frames: 6, active: 0, size: 112, draw: kick },
    { key: "skillMove.lungeDash", dirs: DIRS, frames: 6, active: 6, size: 300, draw: dash },
    { key: "skillMove.lungeCut", dirs: DIRS, frames: 8, active: 0, size: 112, draw: cut },
    { key: "skillMove.lungeTrail", dirs: 1, frames: 8, active: 0, size: 48, draw: trail },
  ],
};
