// 鉈: 幅広で分厚い片刃の大鉈。先へ行くほど広がる四角い刃で、切っ先は角の立った平らな頭（エフェクトの鈍く四角い頭と同じ読み）。
// 黒鉄の分厚い峰に鋼の刃の二色、刃の縁に艶の線、刃の根元に真鍮の口金と鋲、先の近くに吊り穴。柄は革巻きに鉄の輪の柄頭
import { ellipse, paint, polygon, px, subtract } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, grip, weaponSheets } from "../weapon.mjs";

/** 刃の外形（-y が刃、+y が峰）。根元から先へ刃の側が広がり、頭は平らに断ち落とす */
const BLADE = [
  [5, -4.5],
  [12, -6],
  [20, -7.8],
  [28, -9.6],
  [32.5, -10.4],
  [34, -8.5],
  [34, 3.2],
  [32.5, 4.4],
  [5, 3.6],
];
/** 研いだ斜面（刃の縁に沿う帯） */
const BEVEL = [
  [7, -4.4],
  [12, -5.6],
  [20, -7.4],
  [28, -9.2],
  [32.2, -10],
  [33.4, -8.4],
  [33.4, -6],
  [28, -6.4],
  [20, -4.6],
  [12, -2.8],
  [7, -1.8],
];
/** 峰の帯（+y の縁、分厚い黒鉄） */
const SPINE = [
  [5, 0.4],
  [34, -0.4],
  [34, 3.2],
  [32.5, 4.4],
  [5, 3.6],
];
/** 刃の縁の艶（-y の縁に沿う線の両端） */
const EDGE_FROM = [7, -3.6];
const EDGE_TO = [31.5, -8.9];
const EDGE_DOTS = 26;

function draw(frame) {
  grip(frame, -6, 3, 1.7, LEATHER);
  // 柄頭: 鉄の輪（紐を通す穴）
  paint(frame, subtract(ellipse(-8.2, 0, 2.6, 2.6), ellipse(-8.4, 0, 1, 1)), DARK_STEEL);
  // 刃（鋼）。穴を抜く
  const hole = ellipse(29.5, -4.8, 1.3, 1.3);
  paint(frame, subtract(polygon(BLADE, { round: 1.6, tilt: { nx: 0.1, ny: -0.2 } }), hole), STEEL, { bias: -0.3 });
  // 刃の縁の面（研いだ斜面。-y の縁に沿う明るい帯）
  paint(frame, subtract(polygon(BEVEL, { round: 0.8 }), hole), STEEL, { rim: false, minShade: 2, maxShade: 2 });
  // 峰（黒鉄）
  paint(frame, subtract(polygon(SPINE, { round: 1.2, tilt: { nx: 0.15, ny: 0.1 } }), hole), DARK_STEEL, { rim: false, maxShade: 1 });
  // 峰と刃の境の稜線（鋼の明）
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    px(frame, 6.5 + 26 * t, 0.1 - 0.7 * t, STEEL[2]);
  }
  // 刃の縁の艶
  for (let i = 0; i <= EDGE_DOTS; i++) {
    const t = i / EDGE_DOTS;
    px(frame, EDGE_FROM[0] + (EDGE_TO[0] - EDGE_FROM[0]) * t, EDGE_FROM[1] + (EDGE_TO[1] - EDGE_FROM[1]) * t, STEEL[3]);
  }
  // 口金（刃の根元を挟む真鍮の板）と鋲
  paint(frame, polygon([[3, -5.6], [7.5, -6.2], [7.5, 4.8], [3, 4.4]], { round: 1.2 }), GOLD);
  paint(frame, ellipse(5.3, -2.6, 0.9, 0.9), DARK_STEEL, { rim: false });
  paint(frame, ellipse(5.3, 1.8, 0.9, 0.9), DARK_STEEL, { rim: false });
  // 峰の鋲（2 つ）
  px(frame, 14, 2, GOLD[2]);
  px(frame, 22, 1.7, GOLD[2]);
}

export const ATLAS = {
  key: "wpnCleaver",
  sheets: weaponSheets("wpnCleaver", draw, { size: 80, edge: true }),
  meta: { offGrip: null, stance: { grip: "one", body: "heavy", restDeg: 38, restHand: [6, 9], restMirror: true, swayDeg: 2 } },
};
