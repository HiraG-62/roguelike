// 爪: 両手にはめる手甲から伸びる 3 本の刃。原点 = 手の中心、+x = 刃の伸びる向き。
// 後ろに赤い革帯を巻いた黒鉄の手甲（前腕の覆い）、甲を覆う黒鉄の板、拳頭の金の台座から 3 本の鋼の刃が前へ反って伸びる
// （中の刃が一番長い。エフェクトの 3 本の爪痕と同じ並び）。刃は片側へ反るので写しの絵も持つ（edge）
import { capsule, paint, polygon, px } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, weaponSheets } from "../weapon.mjs";

/** 刃の付け根の x（拳頭の台座の前） */
const BLADE_ROOT_X = 4.2;
/** 刃の中心線を分ける数（多角形の点の数） */
const BLADE_STEPS = 10;
/** 3 本の刃: 付け根の y・長さ・反り（先で上へ寄る量）・付け根の半幅 */
const BLADES = [
  { y: -3.7, len: 13, curve: 3.6, w: 1.9 },
  { y: 0.2, len: 16, curve: 3.8, w: 2 },
  { y: 4, len: 12.5, curve: 3.2, w: 1.8 },
];

/** 刃の中心線（t = 0 付け根 → 1 切っ先） */
function centerAt(b, t) {
  return [BLADE_ROOT_X + b.len * t, b.y - b.curve * t * t];
}

/** 刃の半幅（付け根から切っ先へ細る） */
function halfAt(b, t) {
  return b.w * (1 - t) ** 0.75;
}

/** 刃 1 本: 下の面（基）と、中心線から上の面（稜線で光を割る）。同じ組で塗って境目に線を引かない */
function clawBlade(frame, b) {
  const top = [];
  const mid = [];
  const bot = [];
  for (let i = 0; i <= BLADE_STEPS; i++) {
    const t = i / BLADE_STEPS;
    const [x, y] = centerAt(b, t);
    // 中心線の法線（反りに沿って上下の縁を置く）
    const [x2, y2] = centerAt(b, Math.min(1, t + 0.05));
    const [x1, y1] = centerAt(b, Math.max(0, t - 0.05));
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const h = halfAt(b, t);
    top.push([x - nx * h, y - ny * h]);
    mid.push([x - nx * h * 0.1, y - ny * h * 0.1]);
    bot.push([x + nx * h, y + ny * h]);
  }
  const g = frame.newGroup();
  paint(frame, polygon([...top, ...bot.reverse()]), STEEL, { group: g, bias: 0.1 });
  paint(frame, polygon([...top, ...mid.reverse()], { tilt: { nx: 0.1, ny: -0.8 } }), STEEL, { group: g, rim: false });
}

function draw(frame) {
  // 手甲（前腕の覆い）: 手首から後ろへ広がる黒鉄の筒に、赤い革帯を 2 本
  paint(frame, polygon([[-9.6, -4.4], [-2.6, -3.2], [-2.6, 3.4], [-9.6, 4.6]], { round: 1.6 }), DARK_STEEL);
  for (const x of [-8, -5]) {
    paint(frame, polygon([[x, -4.4], [x + 1.3, -4.2], [x + 1.3, 4.4], [x, 4.6]], { round: 0.6 }), CLOTH_RED);
  }
  // 甲の板: 手を覆う黒鉄の板。上の縁が前へせり上がる
  paint(frame, polygon([[-3.2, -3.6], [2.4, -4.8], [4.4, -4.4], [4.6, 4.6], [-3.2, 3.8]], { round: 1.8 }), DARK_STEEL, { bias: 0.12 });
  px(frame, 0.4, -1.4, GOLD[3]);
  px(frame, 0.4, 1.6, GOLD[2]);
  // 刃（奥から: 下 → 上 → 中の順。中の刃を一番手前に）
  clawBlade(frame, BLADES[2]);
  clawBlade(frame, BLADES[0]);
  clawBlade(frame, BLADES[1]);
  // 拳頭の金の台座（刃の付け根を束ねる）
  paint(frame, capsule(BLADE_ROOT_X, -5, BLADE_ROOT_X, 5.2, 1.6), GOLD);
}

export const ATLAS = {
  key: "wpnClaws",
  sheets: weaponSheets("wpnClaws", draw, { size: 48, edge: true }),
  meta: {
    offGrip: null,
    stance: { grip: "dual", body: "light", worn: true, restDeg: -20, restHand: [7, 5], offHand: [4, 6], offDeg: -10, swayDeg: 5 },
  },
};
