// 大剣: 両手で振る分厚い両刃の大剣。黒鉄の縁に鋼の刃（二色）、長い樋、刃元の鈍い部分（リカッソ）、
// 角の張った黒鉄と金の大きな鍔、長い革巻きの柄と重い柄頭
import { capsule, ellipse, paint, polygon, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, grip, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄頭の側へ） */
const OFF_GRIP = -6;
/** 刃の始まり・切っ先（ドット） */
const BLADE_X0 = 8;
const BLADE_X1 = 50;
/** 刃の半幅（根元 → 先）と切っ先の長さ */
const BLADE_W0 = 5;
const BLADE_W1 = 4.2;
const TIP = 7;

/** 刃の半幅（切っ先で細る） */
function halfW(x) {
  if (x < BLADE_X0 || x > BLADE_X1) return -1;
  const t = (x - BLADE_X0) / (BLADE_X1 - BLADE_X0);
  const w = BLADE_W0 + (BLADE_W1 - BLADE_W0) * t;
  if (x < BLADE_X1 - TIP) return w;
  return w * Math.pow((BLADE_X1 - x) / TIP, 0.75);
}

/** 刃の面: 稜線（y = 0）で上下に割る。inset だけ内側の形（縁を抜いた芯の鋼） */
function bladeShape(inset) {
  return (x, y) => {
    const w = halfW(x) - inset;
    if (w <= 0 || Math.abs(y) > w) return null;
    return y < 0 ? { nx: 0.15, ny: -0.75 } : { nx: 0.15, ny: 0.55 };
  };
}

function draw(frame) {
  // 柄（両手ぶんの長さ）と柄頭
  grip(frame, -10, 4, 1.8, LEATHER);
  paint(frame, union(ellipse(-12, 0, 2.6, 2.6), capsule(-10.5, 0, -9.5, 0, 2)), GOLD);
  paint(frame, ellipse(-12.4, -0.4, 0.9, 0.9), DARK_STEEL, { rim: false });
  // 刃: 研いだ明るい刃先の帯（縁）と、黒鉄の芯（二色の刃）
  paint(frame, bladeShape(0), STEEL, { minShade: 2 });
  paint(frame, bladeShape(1.9), DARK_STEEL, { rim: false, bias: 0.35 });
  // 刃元の鈍い部分（リカッソ）: 刃の根元を黒鉄の帯で覆う
  paint(frame, polygon([[BLADE_X0 - 1, -5], [BLADE_X0 + 4, -5], [BLADE_X0 + 5, -3.4], [BLADE_X0 + 5, 3.4], [BLADE_X0 + 4, 5], [BLADE_X0 - 1, 5]], { round: 1.2 }), DARK_STEEL);
  // 樋: 長い溝（暗）と、その上の縁の艶
  paint(frame, polygon([[BLADE_X0 + 6, -0.9], [37, -0.6], [37, 0.6], [BLADE_X0 + 6, 0.9]]), STEEL, { minShade: 0, maxShade: 0, rim: false });
  paint(frame, polygon([[BLADE_X0 + 6, -1.9], [36, -1.5], [36, -0.9], [BLADE_X0 + 6, -1.2]]), DARK_STEEL, { minShade: 3, maxShade: 3, rim: false });
  // 切っ先の稜線の艶
  paint(frame, polygon([[38, -0.4], [48, -0.1], [48, 0.2], [38, 0.4]]), DARK_STEEL, { minShade: 2, maxShade: 3, rim: false });
  // 鍔: 黒鉄の太い横木。先が前へ反り、端に金の飾り
  paint(frame, polygon([[4, -9.5], [7, -10.2], [7.4, -4.5], [7.4, 4.5], [7, 10.2], [4, 9.5], [5, 0]], { round: 1.6 }), DARK_STEEL);
  paint(frame, union(ellipse(6.2, -9.6, 1.8, 1.8), ellipse(6.2, 9.6, 1.8, 1.8)), GOLD);
  // 鍔の中央の金の台座と黒鉄の鋲
  paint(frame, polygon([[3.4, -3.4], [8.6, -3.4], [9.6, 0], [8.6, 3.4], [3.4, 3.4]], { round: 1.4 }), GOLD);
  paint(frame, ellipse(6.2, 0, 1.3, 1.3), DARK_STEEL, { bias: 0.4 });
}

export const ATLAS = {
  key: "wpnGreatsword",
  sheets: weaponSheets("wpnGreatsword", draw, { size: 110 }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "heavy", restDeg: -55, restHand: [6, 9], swayDeg: 2, parry: { hand: [4, -11], deg: 42, off: [10, -2], contact: 20 } } },
};
