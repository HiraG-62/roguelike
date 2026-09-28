// スキル石: 自分の周り・前方の範囲（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。
// 絵の大きさはスキルの数値（src/data/balance/skills/）の半径 × 2 ドットで描き、表の base にその半径（px）を書く
//
// 旋風斬り（whirl）: 「回転して周囲の敵を斬り払う」。半径 28px を 0.45 秒で 4 回斬る
// - 刃の軌跡が長い尾を引いて体の周りを 1 周と少し回る（剣の三日月より太く、尾が円周をほぼ一周する = 旋風）
// - 反対側に細い 2 本目の軌跡を追わせて、渦の厚みを出す
// - 外側を風の筋が巻き、斬り払った木の葉・砂粒が接線へ飛ぶ。足元には擦った砂埃の輪（地面の層）
import { arcLine, crescent } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, smoothstep } from "../raster.mjs";

const TAU = Math.PI * 2;

const WHIRL = {
  /** 半径（px）。SKILL.whirl.radius */
  radiusPx: 28,
  frames: 12,
  /** 回る周数（4 回の斬りを 1 周と少しに収める） */
  turns: 1.25,
  /** 刃の帯の太さ（ドット） */
  T: 20,
  /** 尾の長さの上限（rad。ほぼ一周） */
  trail: TAU * 0.82,
  seed: 3101,
};

/** 旋風の本体。進み p（0..1）で頭の角が時計回りに進み、終わりに崩れる */
function whirl(frame, f) {
  const s = WHIRL;
  const R = s.radiusPx * 2;
  const p = (f + 0.5) / s.frames;
  const head = -Math.PI / 2 + p * s.turns * TAU;
  const trail = Math.min(s.trail, p * s.turns * TAU + 0.3);
  const erosion = smoothstep(0.72, 1, p) * 0.9;
  // 主の軌跡: 外縁が刃の縁
  crescent(frame, { R, T: s.T, head, tail: head - trail, peak: 0.08, erosion, seed: s.seed, streak: 0.5, edge: 2, edgeReach: 0.45 });
  // 反対側を追う細い 2 本目（渦の厚み）
  const h2 = head - Math.PI;
  const t2 = Math.min(trail * 0.6, Math.max(0, p * s.turns * TAU - Math.PI));
  if (t2 > 0.2) crescent(frame, { R: R - 12, T: 9, head: h2, tail: h2 - t2, peak: 0.12, erosion: Math.min(1, erosion + 0.15), seed: s.seed + 1, bright: 0.75, edge: 1.2, edgeReach: 0.3 });
  // 外側を巻く風の筋（頭の少し後ろから尾へ）
  for (let i = 0; i < 6; i++) {
    const lag = 0.35 + i * 0.7;
    const to = head - lag;
    const from = to - (0.9 + 0.35 * hash1(i, s.seed));
    // 外側の筋と、刃の内側を回る筋を交互に（渦の巻き込み）
    const radius = i % 2 === 0 ? R + 4 + i * 2.2 : R - s.T - 3 - i * 1.5;
    if (p * s.turns * TAU < lag) continue;
    arcLine(frame, { radius, from, to, bright: 0.72 * (1 - erosion) * (1 - i * 0.08), width: i < 2 ? 2 : 1 });
  }
  debris(frame, f, s, R, head);
}

/** 斬り払った木の葉・砂粒: 頭の通った所から接線（時計回りの進む向き）へ流れて外へ散る */
function debris(frame, f, s, R, head) {
  const count = 16;
  for (let i = 0; i < count; i++) {
    const born = hash1(i, s.seed + 9) * (s.frames - 3);
    const age = f - born;
    if (age < 0 || age > 4) continue;
    const bornP = (born + 0.5) / s.frames;
    const a0 = -Math.PI / 2 + bornP * s.turns * TAU - 0.2;
    const r0 = R * (0.55 + 0.4 * hash1(i, s.seed + 4));
    const along = age * (5 + 3 * hash1(i, s.seed + 5));
    const out = age * (2 + 2 * hash1(i, s.seed + 6));
    const a = a0 + along / r0;
    const r = r0 + out;
    const level = Math.max(3, 7 - age);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    // 2x2 の粒に尾を 1 ドット（葉・砂粒が風に乗って流れる）
    dot(frame, x, y, level);
    dot(frame, x + 1, y, level - 1);
    dot(frame, x, y + 1, level - 1);
    dot(frame, Math.cos(a - 0.08) * r, Math.sin(a - 0.08) * r, Math.max(2, level - 3));
  }
  void head;
}

/** 足元の砂埃の輪: 刃の通った所の床が擦れて、薄い輪が広がって消える（地面の層） */
function whirlGround(frame, f) {
  const s = WHIRL;
  const R = s.radiusPx * 2;
  const p = (f + 0.5) / s.frames;
  // 擦り跡: 刃の通った円周に沿う短い筋（頭が通った所まで。すっきりした輪にすると砂埃に見えない）
  const swept = p * s.turns * TAU;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r < R * 0.6 || r > R * 0.98) return -1;
      const a = Math.atan2(y, x);
      // 頭が通った角だけ（-π/2 から時計回り）
      const passed = (((a + Math.PI / 2) % TAU) + TAU) % TAU;
      if (passed > swept) return -1;
      const band = Math.floor((a / TAU) * 40 + 40);
      if (hash1(band, s.seed + 21) < 0.5) return -1;
      const k = Math.abs(r - R * (0.66 + 0.3 * hash1(band, s.seed + 22)));
      if (k > 0.7) return -1;
      return clamp01(0.26 * (1 - smoothstep(0.6, 1, p)));
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
}

function sheetSize(radiusPx, pad) {
  return Math.ceil(radiusPx * 2 + pad) * 2;
}

/**
 * スキル → 絵（render/fxMotions.ts の SkillFx）。active は発動中（本動作の進み具合でフレームを流す）。
 * base は絵を描いたときの大きさ（px。ACTIVE_SIZE の値と比べて拡縮する）
 */
const FX = {
  skills: {
    whirl: {
      ramp: "steel",
      active: { sheet: "skillArea.whirl", base: WHIRL.radiusPx, ground: "skillArea.whirlGround" },
    },
  },
};

export const ATLAS = {
  key: "skillArea",
  fx: FX,
  sheets: [
    { key: "skillArea.whirl", dirs: 1, frames: WHIRL.frames, active: WHIRL.frames, size: sheetSize(WHIRL.radiusPx, 22), draw: whirl },
    { key: "skillArea.whirlGround", dirs: 1, frames: WHIRL.frames, active: WHIRL.frames, size: sheetSize(WHIRL.radiusPx, 8), draw: whirlGround },
  ],
};
