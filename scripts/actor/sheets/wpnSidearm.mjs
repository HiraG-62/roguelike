// 片手銃: 真鍮の輪胴を持つ重い回転式拳銃。長めの銃身・照星・木の銃把。銃口の位置を印で渡す
import { capsule, ellipse, paint, polygon } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

const K = 1.3;
const P = (pts) => pts.map(([x, y]) => [x * K, y * K]);

function draw(frame) {
  // 銃把（手の中から下後ろへ）
  paint(frame, polygon(P([[-1.5, -2], [2.5, -2], [1.5, 3], [-0.5, 5.5], [-3.5, 5], [-2.5, 1]]), { round: 1.5 }), WOOD);
  // 用心鉄
  paint(frame, capsule(2 * K, 1.8 * K, 4.8 * K, 1.8 * K, 0.8), DARK_STEEL, { rim: false });
  // 機関部
  paint(frame, polygon(P([[-2.5, -4.8], [6, -4.8], [6, -0.8], [-1.5, -0.8]]), { round: 1.2 }), DARK_STEEL);
  // 撃鉄
  paint(frame, polygon(P([[-3.8, -6.2], [-1.8, -6], [-1.2, -4.4], [-2.6, -4.4]])), DARK_STEEL);
  // 真鍮の輪胴
  paint(frame, ellipse(3.5 * K, -2.9 * K, 2.6 * K, 2.2 * K), GOLD);
  // 銃身と上の帯
  paint(frame, capsule(5.5 * K, -3.2 * K, 16 * K, -3.2 * K, 1.35 * K), STEEL);
  paint(frame, capsule(5.5 * K, -4.6 * K, 15 * K, -4.6 * K, 0.6), DARK_STEEL, { rim: false });
  // 照星
  paint(frame, polygon(P([[14.5, -5.9], [15.8, -5.9], [15.8, -4.4], [14.5, -4.4]])), GOLD, { rim: false });
  frame.anchor("muzzle", 17 * K, -3.2 * K);
}

export const ATLAS = { key: "wpnSidearm", sheets: weaponSheets("wpnSidearm", draw, { size: 56 }), meta: { offGrip: null } };
