// 仕掛け: 地雷を撃ち出す仕掛け弓。木の台に鋼の弓（先に滑車）と張った弦、台の先の溝に信号灯の赤い地雷を載せる。
// 台の横に巻き上げの歯車と引き金の梃子。後ろの手は台の先に添える。設置弾は地雷の前の印から出る
import { capsule, ellipse, paint, polygon, px, subtract } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから台の先の側へ） */
const OFF_GRIP = 8;
/** 台（溝）の中心の高さ */
const RAIL_Y = -3;
/** 弓の位置（台の先） */
const BOW_X = 16;
const MINE_X = 11;
const SIGNAL = ["#4a0f14", "#b0202a", "#ff4a3a", "#ffd0a0"];

function draw(frame) {
  // 台尻（握りの後ろ）
  paint(frame, polygon([[-1, -5], [-12, -4.2], [-13.5, -3], [-13, 1.8], [-5, 0.8], [-1, 0.6]], { round: 1.4 }), WOOD);
  // 銃把
  paint(frame, polygon([[-2.2, -2.2], [2, -2.2], [1.2, 3.5], [-0.8, 5.8], [-3.4, 5], [-2.6, 1]], { round: 1.4 }), LEATHER);
  // 引き金の梃子
  paint(frame, polygon([[1.5, 0.5], [6.5, 2.3], [6.4, 3.3], [1.3, 1.8]]), DARK_STEEL, { rim: false });
  // 台（溝の木）
  paint(frame, polygon([[-1.5, RAIL_Y - 2.4], [BOW_X + 5, RAIL_Y - 2], [BOW_X + 5, RAIL_Y + 2.4], [-1, RAIL_Y + 3.2]], { round: 1.2 }), WOOD);
  // 巻き上げの歯車（台の横）
  paint(frame, ellipse(2.5, RAIL_Y + 0.4, 2.6, 2.6), DARK_STEEL);
  paint(frame, ellipse(2.5, RAIL_Y + 0.4, 1, 1), GOLD, { rim: false });
  // 弦（弓の先から地雷の尻へ）
  const tipY = 13;
  paint(frame, capsule(BOW_X - 3.5, -tipY + RAIL_Y, MINE_X - 3.8, RAIL_Y, 0.45), ["#6a6258", "#b8ad96", "#d8ceb4", "#d8ceb4"], { rim: false });
  paint(frame, capsule(BOW_X - 3.5, tipY + RAIL_Y, MINE_X - 3.8, RAIL_Y, 0.45), ["#6a6258", "#b8ad96", "#d8ceb4", "#d8ceb4"], { rim: false });
  // 鋼の弓: 台の先から上下へ、先が後ろへ反る
  const limb = (sy) =>
    polygon(
      [
        [BOW_X + 1.6, RAIL_Y],
        [BOW_X + 1.2, RAIL_Y + sy * 7],
        [BOW_X - 2.6, RAIL_Y + sy * 12.6],
        [BOW_X - 4.2, RAIL_Y + sy * 12],
        [BOW_X - 1.8, RAIL_Y + sy * 6.2],
        [BOW_X - 1.6, RAIL_Y],
      ],
      { round: 1 },
    );
  paint(frame, limb(-1), STEEL);
  paint(frame, limb(1), STEEL);
  // 弓の先の滑車
  for (const sy of [-1, 1]) paint(frame, subtract(ellipse(BOW_X - 3.5, RAIL_Y + sy * tipY, 1.6, 1.6), ellipse(BOW_X - 3.5, RAIL_Y + sy * tipY, 0.5, 0.5)), GOLD);
  // 弓の留め金
  paint(frame, capsule(BOW_X - 1, RAIL_Y, BOW_X + 2.2, RAIL_Y, 2.3), DARK_STEEL);
  // 載せた地雷: 鋲の縁の円盤と赤い信号灯
  paint(frame, ellipse(MINE_X, RAIL_Y, 4.4, 4.4), DARK_STEEL);
  paint(frame, subtract(ellipse(MINE_X, RAIL_Y, 3.6, 3.6), ellipse(MINE_X, RAIL_Y, 2.7, 2.7)), GOLD, { rim: false });
  paint(frame, ellipse(MINE_X, RAIL_Y, 1.9, 1.9), SIGNAL, { bias: 0.45 });
  frame.anchor("muzzle", BOW_X + 5, RAIL_Y);
  void px;
}

export const ATLAS = {
  key: "wpnTrapper",
  sheets: weaponSheets("wpnTrapper", draw, { size: 48 }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1 } },
};
