// 擲弾: 中折れ式の擲弾筒。太く短い鋼の筒（口の厚い輪と真鍮の帯）、筒の上に立てた梯子の照門、
// 機関部の蝶番と用心鉄、木の銃把と肩当ての銃床。後ろの手は筒の下の先台に添える。榴弾は筒口の印から出る
import { capsule, ellipse, paint, polygon } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから筒の先の側へ） */
const OFF_GRIP = 9;
/** 筒の中心の高さ（握りの線より上） */
const BORE_Y = -4.6;
/** 筒の半径 */
const BORE_R = 3.6;
const MUZZLE_X = 23;

/** 筒を巻く輪（中心 x、幅 w、半径 r）。角を丸めた板 */
function band(x, w, r) {
  return polygon([[x - w / 2, BORE_Y - r], [x + w / 2, BORE_Y - r], [x + w / 2, BORE_Y + r], [x - w / 2, BORE_Y + r]], { round: 0.9 });
}

function draw(frame) {
  // 銃床（握りの後ろ、肩へ向かって下がって太る）
  paint(frame, polygon([[-2, -6.8], [-16, -5.2], [-18.5, -4.5], [-19, 2.4], [-16.5, 3], [-6, 0.5], [-1, 1]], { round: 1.6 }), WOOD);
  // 床尾の当て板
  paint(frame, polygon([[-19.8, -4.9], [-17.8, -5.1], [-17.8, 2.9], [-19.8, 2.7]]), DARK_STEEL, { rim: false });
  // 銃把（手の中から下へ）
  paint(frame, polygon([[-2.5, -2.5], [2.2, -2.5], [1.5, 3.5], [-0.8, 6], [-3.6, 5.2], [-2.8, 1]], { round: 1.4 }), WOOD);
  // 用心鉄
  paint(frame, capsule(1.8, 1.9, 5.2, 1.9, 0.8), DARK_STEEL, { rim: false });
  // 機関部（蝶番の箱）
  paint(frame, polygon([[-3, BORE_Y - 3.4], [6, BORE_Y - 3.4], [6.5, 0.2], [-1.8, 0.2]], { round: 1.2 }), DARK_STEEL);
  // 蝶番の軸
  paint(frame, ellipse(5, -0.6, 1.3, 1.3), GOLD);
  // 先台（筒の下の木。後ろの手を添える）
  paint(frame, polygon([[5.5, -1.6], [14.5, -1.6], [13.5, 1.2], [6.5, 1.2]], { round: 1.1 }), WOOD);
  // 筒
  paint(frame, polygon([[5.5, BORE_Y - BORE_R], [MUZZLE_X - 1, BORE_Y - BORE_R], [MUZZLE_X - 1, BORE_Y + BORE_R], [5.5, BORE_Y + BORE_R]], { round: 2 }), STEEL);
  // 真鍮の帯
  for (const bx of [8.5, 15.5]) paint(frame, band(bx, 1.6, BORE_R + 0.6), GOLD);
  // 筒口の厚い輪と穴
  paint(frame, band(MUZZLE_X - 1.2, 2.8, BORE_R + 0.9), DARK_STEEL);
  paint(frame, ellipse(MUZZLE_X + 0.2, BORE_Y, 0.9, BORE_R - 0.8), ["#0c0a10", "#0c0a10", "#0c0a10", "#0c0a10"], { rim: false });
  // 筒の上の艶の帯
  paint(frame, polygon([[7, BORE_Y - 2.6], [MUZZLE_X - 3, BORE_Y - 2.6], [MUZZLE_X - 3, BORE_Y - 2], [7, BORE_Y - 2]]), STEEL, { minShade: 3, maxShade: 3, rim: false });
  // 梯子の照門（筒の上に立てる）
  paint(frame, polygon([[2.5, BORE_Y - 3.2], [4, BORE_Y - 3.2], [3.4, BORE_Y - 7.2], [2, BORE_Y - 7.2]]), DARK_STEEL);
  paint(frame, polygon([[1.6, BORE_Y - 7.8], [3.8, BORE_Y - 7.8], [3.8, BORE_Y - 6.8], [1.6, BORE_Y - 6.8]]), GOLD, { rim: false });
  // 照星
  paint(frame, polygon([[MUZZLE_X - 3.6, BORE_Y - BORE_R - 1.6], [MUZZLE_X - 2.4, BORE_Y - BORE_R - 1.6], [MUZZLE_X - 2.4, BORE_Y - BORE_R + 0.2], [MUZZLE_X - 3.6, BORE_Y - BORE_R + 0.2]]), GOLD, { rim: false });
  frame.anchor("muzzle", MUZZLE_X + 1, BORE_Y);
}

export const ATLAS = {
  key: "wpnGrenade",
  sheets: weaponSheets("wpnGrenade", draw, { size: 56 }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1 } },
};
