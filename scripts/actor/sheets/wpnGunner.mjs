// 二丁拳銃（両手に同じ絵を持ち、両方とも照準へ向ける。grip "dual"）: 角張った重い自動拳銃。
// 厚い遊底に滑り止めの刻み、遊底の下から覗く太い銃身、真鍮の装飾帯と銃把の底、木の銃把。銃口の位置を印で渡す
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

const K = 1.25;
const P = (pts) => pts.map(([x, y]) => [x * K, y * K]);
/** 銃身の高さ（握りの線から上へ） */
const BARREL_Y = -3.4;
/** 刻みの暗い色（遊底の暗の段より一段沈める） */
const NOTCH = "#1c1c24";

function draw(frame) {
  // 銃把（手の中から下後ろへ傾く）と真鍮の底
  paint(frame, polygon(P([[-2.6, -1.4], [2.4, -1.4], [1.2, 5.2], [-3.6, 5.2]]), { round: 1.4 }), WOOD);
  paint(frame, polygon(P([[-3.9, 4.6], [1.5, 4.6], [1.3, 6.2], [-4.1, 6.2]]), { round: 0.8 }), GOLD);
  // 用心鉄
  paint(frame, capsule(1.8 * K, 1.9 * K, 5.2 * K, 1.9 * K, 0.8), DARK_STEEL, { rim: false });
  paint(frame, capsule(5.2 * K, 0.4 * K, 5.2 * K, 1.9 * K, 0.8), DARK_STEEL, { rim: false });
  // 遊底の下の枠（銃身の下の張り出し）
  paint(frame, polygon(P([[-1.5, -2.4], [12.5, -2.4], [12.5, -0.6], [2.5, -0.6], [-1.5, -0.6]]), { round: 0.8 }), DARK_STEEL);
  // 太い銃身（枠の先から少し覗く）
  paint(frame, capsule(10 * K, BARREL_Y * K, 14.2 * K, BARREL_Y * K, 1.25 * K), STEEL);
  // 遊底（厚い箱。上の面は光を受ける）
  paint(frame, polygon(P([[-3.2, -6.4], [13.2, -6.4], [13.6, -2.6], [-3.2, -2.6]]), { round: 1.3 }), DARK_STEEL, { bias: 0.08 });
  // 遊底の真鍮の帯（識別の差し色）
  paint(frame, polygon(P([[4.2, -3.6], [12.8, -3.6], [12.8, -2.9], [4.2, -2.9]])), GOLD, { rim: false, minShade: 1 });
  // 撃鉄
  paint(frame, polygon(P([[-4.8, -7.2], [-2.8, -6.8], [-2.6, -5], [-4, -5.2]])), DARK_STEEL);
  // 照門・照星
  paint(frame, polygon(P([[-2.4, -7.3], [-0.8, -7.3], [-0.8, -6.2], [-2.4, -6.2]])), DARK_STEEL, { rim: false });
  paint(frame, polygon(P([[11.4, -7.4], [12.6, -7.4], [12.6, -6.2], [11.4, -6.2]])), GOLD, { rim: false });
  // 遊底後ろの滑り止めの刻み（縦の 1 ドット線）
  for (const x of [-1.6, -0.2, 1.2]) {
    for (const y of [-5.6, -4.7, -3.8]) px(frame, x * K, y * K, NOTCH);
  }
  // 引き金
  paint(frame, polygon(P([[2.6, 0], [3.4, 0], [3.2, 2.2], [2.6, 2]])), GOLD, { rim: false });
  // 銃把の留め鋲
  paint(frame, ellipse(-0.8 * K, 2 * K, 0.7, 0.7), GOLD, { rim: false });
  frame.anchor("muzzle", 14.8 * K, BARREL_Y * K);
}

export const ATLAS = {
  key: "wpnGunner",
  sheets: weaponSheets("wpnGunner", draw, { size: 48 }),
  meta: { offGrip: null, stance: { grip: "dual", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1, offHand: [6, 5], offDeg: 0 } },
};
